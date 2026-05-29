"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";

export const transcribeAudio = internalAction({
  args: {
    transcriptionId: v.id("transcriptions"),
    fileId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(api.transcriptions.updateTranscription, {
        id: args.transcriptionId,
        status: "error",
        errorMessage: "GEMINI_API_KEY not configured",
      });
      return;
    }

    // Throttled progress reporter — writes at most ~1x/sec, and only when the
    // value actually moved forward, to avoid hammering the DB while streaming.
    const report = makeProgressReporter(ctx, args.transcriptionId);

    try {
      await report(4);

      // Get file from Convex storage
      const fileUrl = await ctx.storage.getUrl(args.fileId);
      if (!fileUrl) {
        throw new Error("File not found in storage");
      }

      // Fetch the file
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      await report(8);
      const normalizedMimeType = normalizeMimeType(args.mimeType, args.fileName);
      if (!normalizedMimeType) {
        throw new Error("Unsupported file type for transcription");
      }
      const fileBuffer = Buffer.from(arrayBuffer);

      // Initialize Gemini
      const genAI = new GoogleGenerativeAI(apiKey);
      const fileManager = new GoogleAIFileManager(apiKey);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        // 2.5-flash allows up to 65k output tokens — enough for the full
        // transcript of a ~1:45h recording in a single response.
        generationConfig: { maxOutputTokens: 65536 },
      });

      // Upload via the File API (supports up to ~2 GB / ~9.5h of audio,
      // unlike inline base64 which is capped at ~15 MB).
      const uploaded = await uploadWithFallback(
        fileManager,
        fileBuffer,
        normalizedMimeType,
        args.fileName
      );
      await report(18);

      try {
        // The File API processes the upload asynchronously; wait until ACTIVE.
        // Cap the wait (~5 min) so we never poll indefinitely. We don't know
        // how long this takes, so creep progress 18 -> 42 asymptotically.
        let fileInfo = await fileManager.getFile(uploaded.name);
        let attempts = 0;
        while (fileInfo.state === FileState.PROCESSING && attempts < 150) {
          await sleep(2000);
          fileInfo = await fileManager.getFile(uploaded.name);
          attempts++;
          await report(18 + (1 - Math.exp(-attempts / 6)) * 24);
        }
        if (fileInfo.state === FileState.PROCESSING) {
          throw new Error("Timed out waiting for Gemini to process the file");
        }
        if (fileInfo.state === FileState.FAILED) {
          throw new Error("Gemini failed to process the uploaded file");
        }
        await report(45);

        // Stream the transcription so the user sees real, incremental progress
        // (and the text materializing live) instead of one long opaque wait.
        const result = await model.generateContentStream(
          buildPrompt(fileInfo.mimeType, fileInfo.uri)
        );

        let transcription = "";
        for await (const chunk of result.stream) {
          transcription += chunk.text();
          // Output length is unbounded, so map accumulated chars onto 45 -> 99
          // asymptotically — it advances steadily but never claims to be done.
          const progress = 45 + (1 - Math.exp(-transcription.length / 4000)) * 54;
          await report(progress, transcription);
        }

        const finalResponse = await result.response;

        // If Gemini still hit the output cap, the transcript is incomplete —
        // be honest about it rather than silently dropping the tail.
        const finishReason = finalResponse.candidates?.[0]?.finishReason;
        if (finishReason === "MAX_TOKENS") {
          transcription +=
            "\n\n[⚠ A transcrição pode ter sido cortada por atingir o limite de tamanho do modelo.]";
        }

        // Update the transcription in the database
        await ctx.runMutation(api.transcriptions.updateTranscription, {
          id: args.transcriptionId,
          transcription,
          progress: 100,
          status: "completed",
        });
      } finally {
        // Clean up the uploaded file regardless of outcome.
        await fileManager.deleteFile(uploaded.name).catch(() => {});
      }
    } catch (error) {
      console.error("Transcription error:", error);
      await ctx.runMutation(api.transcriptions.updateTranscription, {
        id: args.transcriptionId,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // Even with text, don't write more than ~3x/sec.
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

// Upload to the Gemini File API, retrying once with a fallback mime type
// (e.g. audio/mp4 <-> video/mp4) if Gemini rejects the first one.
const uploadWithFallback = async (
  fileManager: GoogleAIFileManager,
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
) => {
  try {
    const { file } = await fileManager.uploadFile(fileBuffer, {
      mimeType,
      displayName: fileName,
    });
    return file;
  } catch (error) {
    const fallbackMimeType = getFallbackMimeType(mimeType);
    if (isInvalidArgumentError(error) && fallbackMimeType) {
      const { file } = await fileManager.uploadFile(fileBuffer, {
        mimeType: fallbackMimeType,
        displayName: fileName,
      });
      return file;
    }
    throw error;
  }
};

const buildPrompt = (mimeType: string, fileUri: string) => [
  {
    fileData: {
      mimeType,
      fileUri,
    },
  },
  {
    text: "Please transcribe the audio/video content. Return only the transcription text without any additional commentary, timestamps, or formatting. If there are multiple speakers, indicate speaker changes with line breaks.",
  },
];

const isInvalidArgumentError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("invalid argument") || lower.includes("400");
};

const getFallbackMimeType = (mimeType: string) => {
  if (mimeType === "video/mp4") return "audio/mp4";
  if (mimeType === "audio/mp4") return "video/mp4";
  if (mimeType === "video/webm") return "audio/webm";
  if (mimeType === "audio/webm") return "video/webm";
  return null;
};
