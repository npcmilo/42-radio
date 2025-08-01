import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";

export default defineSchema({
  // The single track currently playing for all listeners
  currentTrack: defineTable({
    discogsId: v.string(), // ID from Discogs for metadata
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    youtubeId: v.string(), // ID for the YouTube player
    durationSeconds: v.optional(v.number()), // Duration of the YouTube video in seconds
    startedAt: v.number(), // UTC timestamp when the track began, for client sync
    transitionAudioUrl: v.optional(v.string()), // URL to the AI voiceover
  }),

  // A history of all tracks played to avoid repeats
  history: defineTable({
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    youtubeId: v.string(),
    durationSeconds: v.optional(v.number()), // Duration of the YouTube video in seconds
    playedAt: v.number(), // UTC timestamp
    likedBy: v.optional(v.array(v.id("users"))), // Track who liked it
  }).index("by_discogsId", ["discogsId"]), // Index for fast deduplication checks

  // Upcoming tracks to be played
  queue: defineTable({
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    youtubeId: v.string(),
    durationSeconds: v.optional(v.number()), // Duration of the YouTube video in seconds
    createdAt: v.number(), // Timestamp when added to the queue
    transitionAudioUrl: v.optional(v.string()), // Pre-generated voiceover URL
  }).index("by_createdAt", ["createdAt"]), // To ensure FIFO playback order

  // User accounts and their settings
  users: defineTable({
    clerkId: v.string(), // Corresponds to the ID from Clerk auth
    role: v.union(v.literal("listener"), v.literal("controller")),
    // Controller-specific settings for track discovery
    preferences: v.optional(
      v.object({
        genreTags: v.array(v.string()),
        yearRange: v.array(v.number()),
        energy: v.optional(v.union(v.literal("Low"), v.literal("Medium"), v.literal("High"))),
        region: v.optional(v.string()),
      })
    ),
  }).index("by_clerkId", ["clerkId"]), // For quickly finding users

  // User feedback on tracks
  feedback: defineTable({
    userId: v.id("users"),
    discogsId: v.string(), // Use Discogs ID to reference the track
    type: v.union(v.literal("like"), v.literal("skip")),
    createdAt: v.number(),
  }).index("by_user_and_track", ["userId", "discogsId"]), // To prevent duplicate feedback

  // Application logs for debugging and monitoring
  logs: defineTable({
    timestamp: v.number(), // UTC timestamp
    level: v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error")),
    component: v.string(), // e.g., "discogs-search", "youtube-search", "queue-manager"
    message: v.string(), // Human-readable log message
    metadata: v.optional(v.any()), // Structured data (API responses, errors, timing)
    userId: v.optional(v.id("users")), // Associate logs with specific users when relevant
    trackId: v.optional(v.string()), // Associate with specific tracks (discogsId or youtubeId)
  })
    .index("by_timestamp", ["timestamp"]) // For time-based queries
    .index("by_level", ["level"]) // For filtering by log level
    .index("by_component", ["component"]) // For component-specific logs
    .index("by_level_and_timestamp", ["level", "timestamp"]), // For efficient error queries
});