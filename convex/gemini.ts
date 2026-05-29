"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { randomUUID } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerativeModel, Part } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

// The whole pipeline is split across many small chained actions so that NO
// single action runs near the Convex limits (10 min wall-clock, 512 MiB RAM):
//
//   transcribeAudio  -> start a Gemini resumable upload session
//   uploadChunk      -> upload one ~16 MiB slice, then chain the next slice
//   waitForActive    -> poll the File API once, re-scheduling itself
//   transcribeWindow -> transcribe one ~20 min window, then chain the next
//
// Each step carries a runId and aborts if it no longer owns the row, so a
// duplicate chain (e.g. a retried scheduled action) can't clobber the output.

// Resumable-upload slice size. Must be a multiple of 256 KiB for non-final
// chunks; 16 MiB satisfies that and uploads in a couple of seconds.
const CHUNK_SIZE = 16 * 1024 * 1024;
// One Gemini call per WINDOW_SECONDS of audio — bounds output tokens per call
// (a long single call can fall into a repetition loop and exhaust the budget).
const WINDOW_SECONDS = 20 * 60;
// Safety cap when we don't know the duration up front (iterate-until-empty).
const MAX_WINDOWS = 36; // 12h
// Max File-API processing polls (~2s apart) before giving up.
const MAX_ACTIVE_POLLS = 150; // ~5 min

// ---------------------------------------------------------------------------
// Step 1: claim ownership of the row, start a Gemini resumable upload session,
// and kick off the chunked upload.
// ---------------------------------------------------------------------------
export const transcribeAudio = internalAction({
  args: {
    transcriptionId: v.id("transcriptions"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await fail(ctx, args.transcriptionId, "GEMINI_API_KEY not configured");
      return;
    }

    const runId = randomUUID();
    const report = makeProgressReporter(ctx, args.transcriptionId);
    try {
      // Claim the row for this run and reset any prior partial output / error.
      await ctx.runMutation(api.transcriptions.updateTranscription, {
        id: args.transcriptionId,
        status: "processing",
        progress: 2,
        transcription: "",
        errorMessage: "",
        activeRunId: runId,
      });

      const fileUrl = await ctx.storage.getUrl(args.fileId);
      if (!fileUrl) throw new Error("File not found in storage");

      const normalizedMimeType = normalizeMimeType(args.mimeType, args.fileName);
      if (!normalizedMimeType) {
        throw new Error("Unsupported file type for transcription");
      }

      const totalSize = await getRemoteSize(fileUrl);
      const uploadUrl = await startResumableUpload(
        apiKey,
        normalizedMimeType,
        args.fileName,
        totalSize
      );
      await report(4);

      await ctx.scheduler.runAfter(0, internal.gemini.uploadChunk, {
        transcriptionId: args.transcriptionId,
        runId,
        fileUrl,
        uploadUrl,
        offset: 0,
        totalSize,
        durationSeconds: args.durationSeconds,
      });
    } catch (error) {
      console.error("Transcription setup error:", error);
      await fail(ctx, args.transcriptionId, errorMessage(error));
    }
  },
});

// ---------------------------------------------------------------------------
// Step 2 (chained, one per ~16 MiB): read a byte range from Convex storage and
// upload it to the Gemini resumable session, then chain the next slice.
// ---------------------------------------------------------------------------
export const uploadChunk = internalAction({
  args: {
    transcriptionId: v.id("transcriptions"),
    runId: v.string(),
    fileUrl: v.string(),
    uploadUrl: v.string(),
    offset: v.number(),
    totalSize: v.number(),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (await superseded(ctx, args.transcriptionId, args.runId)) return;
    try {
      const end = Math.min(args.offset + CHUNK_SIZE, args.totalSize);
      const isLast = end >= args.totalSize;

      // Pull just this slice — never the whole file — to stay well under the
      // 512 MiB action memory limit.
      const rangeRes = await fetch(args.fileUrl, {
        headers: { Range: `bytes=${args.offset}-${end - 1}` },
      });
      if (!rangeRes.ok && rangeRes.status !== 206) {
        throw new Error(`Failed to read file slice: ${rangeRes.status}`);
      }
      const chunk = new Uint8Array(await rangeRes.arrayBuffer());

      const uploadRes = await fetch(args.uploadUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Offset": String(args.offset),
          "X-Goog-Upload-Command": isLast ? "upload, finalize" : "upload",
        },
        body: chunk,
      });
      if (!uploadRes.ok) {
        throw new Error(
          `Gemini upload failed (${uploadRes.status}): ${await uploadRes.text()}`
        );
      }

      const report = makeProgressReporter(ctx, args.transcriptionId);
      await report(4 + (end / args.totalSize) * 14); // 4 -> 18

      if (!isLast) {
        await ctx.scheduler.runAfter(0, internal.gemini.uploadChunk, {
          ...args,
          offset: end,
        });
        return;
      }

      const body = (await uploadRes.json()) as {
        file?: { name?: string; uri?: string; mimeType?: string };
      };
      const file = body.file;
      if (!file?.name || !file?.uri) {
        throw new Error("Gemini upload finalized without a file reference");
      }

      await ctx.scheduler.runAfter(0, internal.gemini.waitForActive, {
        transcriptionId: args.transcriptionId,
        runId: args.runId,
        geminiFileName: file.name,
        geminiFileUri: file.uri,
        geminiMimeType: file.mimeType ?? "audio/mp4",
        attempts: 0,
        durationSeconds: args.durationSeconds,
      });
    } catch (error) {
      console.error("Upload chunk error:", error);
      await fail(ctx, args.transcriptionId, errorMessage(error));
    }
  },
});

// ---------------------------------------------------------------------------
// Step 3 (self-rescheduling): poll the File API once. Each poll is its own
// short action so the ~5 min wait never ties up a single long-running action.
// ---------------------------------------------------------------------------
export const waitForActive = internalAction({
  args: {
    transcriptionId: v.id("transcriptions"),
    runId: v.string(),
    geminiFileName: v.string(),
    geminiFileUri: v.string(),
    geminiMimeType: v.string(),
    attempts: v.number(),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;
    if (await superseded(ctx, args.transcriptionId, args.runId)) return;

    const fileManager = new GoogleAIFileManager(apiKey);
    try {
      const info = await fileManager.getFile(args.geminiFileName);
      const report = makeProgressReporter(ctx, args.transcriptionId);

      if (info.state === FileState.ACTIVE) {
        await report(45);
        await ctx.scheduler.runAfter(0, internal.gemini.transcribeWindow, {
          transcriptionId: args.transcriptionId,
          runId: args.runId,
          geminiFileName: args.geminiFileName,
          geminiFileUri: info.uri ?? args.geminiFileUri,
          geminiMimeType: info.mimeType ?? args.geminiMimeType,
          windowIndex: 0,
          accumulated: "",
          durationSeconds: args.durationSeconds,
        });
        return;
      }

      if (info.state === FileState.FAILED) {
        await fileManager.deleteFile(args.geminiFileName).catch(() => {});
        throw new Error("Gemini failed to process the uploaded file");
      }

      // Still PROCESSING.
      if (args.attempts >= MAX_ACTIVE_POLLS) {
        await fileManager.deleteFile(args.geminiFileName).catch(() => {});
        throw new Error("Timed out waiting for Gemini to process the file");
      }
      await report(18 + (1 - Math.exp(-args.attempts / 6)) * 24); // 18 -> 42
      await ctx.scheduler.runAfter(2000, internal.gemini.waitForActive, {
        ...args,
        attempts: args.attempts + 1,
      });
    } catch (error) {
      console.error("Wait-for-active error:", error);
      await fail(ctx, args.transcriptionId, errorMessage(error));
    }
  },
});

// ---------------------------------------------------------------------------
// Step 4 (chained, one per window): transcribe a single [start, end) window,
// append it to the accumulated text, then schedule the next window — or
// finalize. The transcript is carried forward in `accumulated` (scheduler
// args), so a stale read or duplicate chain can't truncate it.
// ---------------------------------------------------------------------------
export const transcribeWindow = internalAction({
  args: {
    transcriptionId: v.id("transcriptions"),
    runId: v.string(),
    geminiFileName: v.string(),
    geminiFileUri: v.string(),
    geminiMimeType: v.string(),
    windowIndex: v.number(),
    accumulated: v.string(),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const fileManager = new GoogleAIFileManager(apiKey);
    const finish = (text: string) =>
      finalize(ctx, args.transcriptionId, fileManager, args.geminiFileName, text);

    // A superseded chain must stop without touching the row or the shared file.
    if (await superseded(ctx, args.transcriptionId, args.runId)) return;

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const report = makeProgressReporter(ctx, args.transcriptionId);

      const { windowIndex, durationSeconds } = args;
      const windowCount = durationSeconds
        ? Math.max(1, Math.ceil(durationSeconds / WINDOW_SECONDS))
        : undefined;

      const startSec = windowIndex * WINDOW_SECONDS;
      const endSec = durationSeconds
        ? Math.min(startSec + WINDOW_SECONDS, durationSeconds)
        : startSec + WINDOW_SECONDS;

      const prefix = args.accumulated.length ? args.accumulated + "\n\n" : "";
      const onProgress = (windowText: string) => {
        const [bandLo, bandHi] = progressBand(windowIndex, windowCount);
        const progress =
          bandLo +
          (1 - Math.exp(-windowText.length / 3000)) * (bandHi - bandLo);
        return report(progress, prefix + windowText);
      };

      const windowText = await runWindow(
        model,
        args.geminiMimeType,
        args.geminiFileUri,
        startSec,
        endSec,
        onProgress
      );

      const isLastKnown =
        windowCount !== undefined && windowIndex + 1 >= windowCount;
      const reachedCap = windowIndex + 1 >= MAX_WINDOWS;
      const [, bandHi] = progressBand(windowIndex, windowCount);

      let accumulated = args.accumulated;
      if (windowText !== null) {
        accumulated = prefix + windowText;
        await ctx.runMutation(api.transcriptions.updateTranscription, {
          id: args.transcriptionId,
          status: "processing",
          progress: Math.round(bandHi),
          transcription: accumulated,
        });
      } else if (windowCount === undefined) {
        // Unknown-duration mode: an empty window means end of audio.
        await finish(accumulated);
        return;
      }

      if (isLastKnown || reachedCap) {
        await finish(accumulated);
        return;
      }

      await ctx.scheduler.runAfter(0, internal.gemini.transcribeWindow, {
        ...args,
        windowIndex: windowIndex + 1,
        accumulated,
      });
    } catch (error) {
      console.error("Transcription window error:", error);
      await fileManager.deleteFile(args.geminiFileName).catch(() => {});
      await fail(ctx, args.transcriptionId, errorMessage(error));
    }
  },
});

// Mark the transcription complete and delete the reusable Gemini upload.
const finalize = async (
  ctx: ActionCtx,
  id: Id<"transcriptions">,
  fileManager: GoogleAIFileManager,
  geminiFileName: string,
  text: string
) => {
  await fileManager.deleteFile(geminiFileName).catch(() => {});
  if (!text.trim()) {
    await fail(ctx, id, "Gemini returned an empty transcription");
    return;
  }
  await ctx.runMutation(api.transcriptions.updateTranscription, {
    id,
    transcription: text,
    progress: 100,
    status: "completed",
  });
};

// Transcribe a single [startSec, endSec) window, streaming partial output via
// onProgress. Tolerates a blocked candidate (RECITATION/SAFETY) and a
// degenerate repetition loop: retries once with higher temperature, then trims
// the loop / records a marker so one bad window never fails the whole job.
// Returns null only when the window genuinely has no speech.
const runWindow = async (
  model: GenerativeModel,
  mimeType: string,
  fileUri: string,
  startSec: number,
  endSec: number,
  onProgress: (text: string) => Promise<void> | void
): Promise<string | null> => {
  const run = async (temperature: number, strongAntiRepeat: boolean) => {
    let text = "";
    let finishReason: string | undefined;
    try {
      const result = await model.generateContentStream({
        contents: [
          {
            role: "user",
            parts: buildWindowParts(
              mimeType,
              fileUri,
              startSec,
              endSec,
              strongAntiRepeat
            ),
          },
        ],
        generationConfig: { maxOutputTokens: 65536, temperature },
      });
      for await (const chunk of result.stream) {
        text += chunk.text();
        await onProgress(text);
        // Bail out the moment the tail starts looping, instead of letting the
        // model spin to MAX_TOKENS emitting "e, e, e, ..." for minutes.
        if (looksRunaway(text)) {
          finishReason = "RUNAWAY";
          break;
        }
      }
      if (finishReason !== "RUNAWAY") {
        const finalResponse = await result.response;
        finishReason = finalResponse.candidates?.[0]?.finishReason ?? undefined;
      }
    } catch {
      // RECITATION / SAFETY block or a stream error — keep whatever streamed.
      finishReason = finishReason ?? "BLOCKED";
    }
    return { text: cleanWindowText(text), finishReason };
  };

  const bad = (r: { text: string; finishReason?: string }) =>
    isBlocked(r.finishReason) || isEmptyWindow(r.text) || hasRepetitionLoop(r.text);

  let r = await run(0, false);
  if (bad(r)) {
    const retry = await run(0.4, true);
    if (!bad(retry)) {
      r = retry;
    } else {
      // Both attempts degenerate: keep the longer text and cut any loop.
      const cand = retry.text.length > r.text.length ? retry : r;
      r = { text: trimRepetitionLoop(cand.text), finishReason: cand.finishReason };
    }
  }

  if (isEmptyWindow(r.text)) {
    return isBlocked(r.finishReason)
      ? "[⚠ Trecho não transcrito: bloqueado pelo modelo (provável áudio repetitivo).]"
      : null;
  }

  let text = hasRepetitionLoop(r.text) ? trimRepetitionLoop(r.text) : r.text;
  if (r.finishReason === "MAX_TOKENS") {
    text += "\n[⚠ Este trecho pode ter sido cortado por tamanho.]";
  }
  return text;
};

// A finish reason other than a clean stop / token cap means the candidate was
// blocked or errored.
const isBlocked = (finishReason?: string) =>
  finishReason !== undefined &&
  finishReason !== "STOP" &&
  finishReason !== "MAX_TOKENS";

// Map window index -> [lo, hi] sub-range of the 45..99 progress band.
const progressBand = (
  index: number,
  total: number | undefined
): [number, number] => {
  if (total) {
    const lo = 45 + (index / total) * 54;
    const hi = 45 + ((index + 1) / total) * 54;
    return [lo, hi];
  }
  const lo = 45 + (1 - Math.exp(-index / 4)) * 54;
  const hi = 45 + (1 - Math.exp(-(index + 1) / 4)) * 54;
  return [lo, hi];
};

const buildWindowParts = (
  mimeType: string,
  fileUri: string,
  startSec: number,
  endSec: number,
  strongAntiRepeat: boolean
): Part[] => [
  { fileData: { mimeType, fileUri } },
  {
    text:
      `Transcreva APENAS o trecho deste áudio entre ${formatTimestamp(startSec)} e ` +
      `${formatTimestamp(endSec)} (tempo medido desde o início do arquivo). ` +
      `Retorne somente o texto falado nesse intervalo, sem comentários, sem ` +
      `timestamps e sem formatação extra. Indique mudança de locutor com quebra ` +
      `de linha. Se um trecho estiver inaudível, escreva [inaudível] e continue. ` +
      `NUNCA repita a mesma palavra ou frase várias vezes seguidas. Se não houver ` +
      `fala nesse intervalo, responda exatamente com NO_AUDIO.` +
      (strongAntiRepeat
        ? ` ATENÇÃO: a tentativa anterior entrou em loop repetindo a mesma ` +
          `palavra/frase indefinidamente. Transcreva o conteúdo real do áudio, ` +
          `sem nenhuma repetição artificial.`
        : ""),
  },
];

// Normalize a window response and strip a trailing NO_AUDIO sentinel if the
// model appended one after some real speech.
const cleanWindowText = (text: string) =>
  text.replace(/\bNO_AUDIO\b\s*$/i, "").trim();

const isEmptyWindow = (text: string) =>
  text.length === 0 || /^NO_AUDIO\b/i.test(text);

// Degenerate-loop patterns. Long units need only a few repeats; short units
// (e.g. ", de um, ..." or "e, e, e, ...") need more, to avoid flagging natural
// repetition.
const LOOP_PATTERNS = [/(.{15,200}?)\1{2,}/s, /(.{2,40}?)\1{5,}/s];

const hasRepetitionLoop = (text: string) =>
  LOOP_PATTERNS.some((re) => re.test(text));

// Cheap check on the streamed tail: is the text currently ending in a runaway
// repetition? Run on every chunk, so it only scans the last stretch.
const RUNAWAY_TAIL = /(.{2,60}?)\1{5,}\s*$/s;
const looksRunaway = (text: string) =>
  text.length > 120 && RUNAWAY_TAIL.test(text.slice(-500));

// Cut a degenerate loop: keep everything before it plus two sample copies of
// the repeated unit, drop the runaway tail, and leave a visible marker.
const trimRepetitionLoop = (text: string) => {
  let earliest: RegExpMatchArray | null = null;
  for (const re of LOOP_PATTERNS) {
    const m = text.match(re);
    if (
      m &&
      m.index !== undefined &&
      (earliest === null || m.index < (earliest.index ?? Infinity))
    ) {
      earliest = m;
    }
  }
  if (!earliest || earliest.index === undefined) return text;
  const unit = earliest[1];
  const kept = text.slice(0, earliest.index) + unit + unit;
  return kept.trimEnd() + "\n[⚠ Trecho repetitivo removido automaticamente.]";
};

// Seconds -> "MM:SS" for the prompt. Gemini reads audio timestamps ONLY in
// MM:SS form (minutes may exceed 59, e.g. "74:33"); an "H:MM:SS" string is not
// recognized, so for windows past 1h the model ignores it and re-transcribes
// from the start. Always emit MM:SS.
const formatTimestamp = (totalSeconds: number) => {
  const s = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

// Start a Gemini File API resumable upload session; returns the per-upload URL.
const startResumableUpload = async (
  apiKey: string,
  mimeType: string,
  displayName: string,
  totalSize: number
) => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(totalSize),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to start Gemini upload (${res.status}): ${await res.text()}`
    );
  }
  const uploadUrl = res.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini did not return an upload URL");
  return uploadUrl;
};

// Determine a remote file's byte length without downloading it.
const getRemoteSize = async (url: string) => {
  const head = await fetch(url, { method: "HEAD" });
  const len = head.headers.get("content-length");
  if (len) return parseInt(len, 10);
  // Fallback: a 1-byte range reveals the total via Content-Range.
  const ranged = await fetch(url, { headers: { Range: "bytes=0-0" } });
  const contentRange = ranged.headers.get("content-range");
  const match = contentRange?.match(/\/(\d+)\s*$/);
  if (match) return parseInt(match[1], 10);
  throw new Error("Could not determine file size");
};

const normalizeMimeType = (mimeType: string, fileName: string) => {
  const lower = mimeType.toLowerCase();
  if (lower === "audio/mp3") return "audio/mpeg";
  if (lower === "audio/m4a" || lower === "audio/x-m4a") return "audio/mp4";
  if (lower === "audio/mpeg") return "audio/mpeg";
  if (lower === "audio/wav") return "audio/wav";
  if (lower === "audio/webm") return "audio/webm";
  if (lower === "audio/ogg") return "audio/ogg";
  if (lower === "audio/flac") return "audio/flac";
  if (lower === "audio/mp4") return "audio/mp4";
  if (lower === "video/mp4") return "video/mp4";
  if (lower === "video/webm") return "video/webm";

  const extension = fileName.toLowerCase().split(".").pop();
  if (!extension) return null;
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "wav") return "audio/wav";
  if (extension === "webm") return "audio/webm";
  if (extension === "ogg") return "audio/ogg";
  if (extension === "flac") return "audio/flac";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "mp4") return "video/mp4";
  return null;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unknown error";

const fail = async (
  ctx: ActionCtx,
  id: Id<"transcriptions">,
  message: string
) => {
  await ctx.runMutation(api.transcriptions.updateTranscription, {
    id,
    status: "error",
    errorMessage: message,
  });
};

// True if this chain no longer owns the row (a newer run took over, or the row
// already finished/errored). A superseded chain must stop quietly.
const superseded = async (
  ctx: ActionCtx,
  id: Id<"transcriptions">,
  runId: string
) => {
  const ctrl = await ctx.runQuery(internal.transcriptions.getControl, { id });
  if (!ctrl) return true;
  if (ctrl.status === "completed" || ctrl.status === "error") return true;
  return ctrl.activeRunId !== runId;
};

// Returns a function that patches the row's progress (and optionally the
// partial transcript), throttled so streaming doesn't trigger a write storm.
// Writes immediately when partial text is supplied so the live preview keeps
// up, otherwise at most once every ~800ms and only when progress increased.
const makeProgressReporter = (ctx: ActionCtx, id: Id<"transcriptions">) => {
  let lastWrite = 0;
  let lastValue = 0;
  return async (progress: number, partial?: string) => {
    const value = Math.min(99, Math.max(lastValue, Math.round(progress)));
    const now = Date.now();
    const hasText = partial !== undefined;
    if (!hasText && (value <= lastValue || now - lastWrite < 800)) return;
    if (hasText && now - lastWrite < 350 && value <= lastValue) return;
    lastWrite = now;
    lastValue = value;
    await ctx.runMutation(api.transcriptions.updateTranscription, {
      id,
      status: "processing",
      progress: value,
      ...(hasText ? { transcription: partial } : {}),
    });
  };
};
