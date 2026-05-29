import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const createTranscription = mutation({
  args: {
    fileName: v.string(),
    fileId: v.id("_storage"),
    mimeType: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("transcriptions", {
      fileName: args.fileName,
      fileId: args.fileId,
      mimeType: args.mimeType,
      status: "processing",
    });

    // Kick off transcription in the background so it survives the user
    // navigating away or closing the tab.
    await ctx.scheduler.runAfter(0, internal.gemini.transcribeAudio, {
      transcriptionId: id,
      fileId: args.fileId,
      fileName: args.fileName,
      mimeType: args.mimeType,
    });

    return id;
  },
});

export const updateTranscription = mutation({
  args: {
    id: v.id("transcriptions"),
    transcription: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    await ctx.db.patch(id, updates);
  },
});

export const getTranscription = query({
  args: { id: v.id("transcriptions") },
  handler: async (ctx, args) => {
    const transcription = await ctx.db.get(args.id);
    if (!transcription) return null;

    const fileUrl = await ctx.storage.getUrl(transcription.fileId);
    return { ...transcription, fileUrl };
  },
});

export const listTranscriptions = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("transcriptions")
      .order("desc")
      .take(20);
  },
});

export const deleteTranscription = mutation({
  args: { id: v.id("transcriptions") },
  handler: async (ctx, args) => {
    const transcription = await ctx.db.get(args.id);
    if (transcription) {
      await ctx.storage.delete(transcription.fileId);
      await ctx.db.delete(args.id);
    }
  },
});
