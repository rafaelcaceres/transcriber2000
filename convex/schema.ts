import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  transcriptions: defineTable({
    fileName: v.string(),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    transcription: v.optional(v.string()),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  }),
});
