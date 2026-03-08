"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const transcribeAudio = action({
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

    try {
      // Get file from Convex storage
      const fileUrl = await ctx.storage.getUrl(args.fileId);
      if (!fileUrl) {
        throw new Error("File not found in storage");
      }

      // Fetch the file
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer();
      const normalizedMimeType = normalizeMimeType(args.mimeType, args.fileName);
      if (!normalizedMimeType) {
        throw new Error("Unsupported file type for transcription");
      }
      const base64Data = Buffer.from(arrayBuffer).toString("base64");

      // Initialize Gemini
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

      // Create the prompt for transcription
      const prompt = buildPrompt(base64Data);
      let result;
      try {
        result = await model.generateContent(prompt(normalizedMimeType));
      } catch (error) {
        if (isInvalidArgumentError(error)) {
          const fallbackMimeType = getFallbackMimeType(normalizedMimeType);
          if (fallbackMimeType) {
            result = await model.generateContent(prompt(fallbackMimeType));
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      const transcription = result.response.text();

      // Update the transcription in the database
      await ctx.runMutation(api.transcriptions.updateTranscription, {
        id: args.transcriptionId,
        transcription,
        status: "completed",
      });
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

const buildPrompt = (base64Data: string) => (mimeType: string) => [
  {
    inlineData: {
      mimeType,
      data: base64Data,
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
