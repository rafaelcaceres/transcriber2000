import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  transcriptions: defineTable({
    fileName: v.string(),
    fileId: v.id("_storage"),
    mimeType: v.string(),
    // Total audio length in seconds, captured client-side. Used to slice the
    // transcription into time windows so a single repetition loop can't eat the
    // whole output-token budget. Optional: the action falls back to probing.
    durationSeconds: v.optional(v.number()),
    // Identifies the currently-owning processing chain. Each chained action
    // aborts if this no longer matches its own runId, so a duplicate chain
    // (e.g. a retried scheduled action) can't clobber the row.
    activeRunId: v.optional(v.string()),
    transcription: v.optional(v.string()),
    // 0-100, reflects real upload/processing/streaming milestones.
    progress: v.optional(v.number()),
    status: v.union(
      v.literal("uploading"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  }),
});
