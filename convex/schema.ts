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
    replayCount: v.optional(v.number()), // Number of times replayed from history
    lastReplayedAt: v.optional(v.number()), // Last time this was replayed as fallback
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
    type: v.union(v.literal("like"), v.literal("skip"), v.literal("thumbs_up"), v.literal("thumbs_down")),
    createdAt: v.number(),
  }).index("by_user_and_track", ["userId", "discogsId"]), // To prevent duplicate feedback

  // Saved tracks for controllers to research purchasing
  savedTracks: defineTable({
    userId: v.id("users"),
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    youtubeId: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    savedAt: v.number(), // UTC timestamp
    // Purchase links (to be populated in future)
    bandcampUrl: v.optional(v.string()),
    beatportUrl: v.optional(v.string()),
    spotifyUrl: v.optional(v.string()),
    appleMusicUrl: v.optional(v.string()),
    discogsMarketplaceUrl: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_and_track", ["userId", "discogsId"]) // For checking if track is saved
    .index("by_saved_at", ["savedAt"]), // For sorting by save date

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

  // YouTube search cache to avoid redundant API calls
  youtubeCache: defineTable({
    artist: v.string(),
    title: v.string(),
    youtubeId: v.string(),
    videoTitle: v.string(),
    channelTitle: v.string(),
    thumbnailUrl: v.string(),
    durationSeconds: v.number(),
    viewCount: v.number(),
    publishedAt: v.string(),
    cachedAt: v.number(), // UTC timestamp when cached
    lastUsedAt: v.number(), // UTC timestamp when last used
    useCount: v.number(), // Number of times this cache entry was used
  })
    .index("by_artist_title", ["artist", "title"]) // For quick lookups
    .index("by_cached_at", ["cachedAt"]), // For cache cleanup

  // YouTube API key usage tracking for rotation
  youtubeApiUsage: defineTable({
    keyId: v.string(), // "key1", "key2", etc.
    date: v.string(), // Date in YYYY-MM-DD format (Pacific Time)
    quotaUsed: v.number(), // Units consumed today
    callsSuccessful: v.number(), // Successful API calls
    callsFailed: v.number(), // Failed API calls
    quotaExhausted: v.boolean(), // Whether this key hit quota limit today
    lastQuotaReset: v.number(), // Timestamp of last quota reset (midnight PT)
    createdAt: v.number(), // UTC timestamp
    lastUpdatedAt: v.number(), // UTC timestamp
  })
    .index("by_key_and_date", ["keyId", "date"]) // For daily usage lookup
    .index("by_date", ["date"]), // For cleanup and analytics

  // Canonical track library with analysis lifecycle and summary
  library: defineTable({
    // Identity / core metadata
    discogsId: v.string(),
    youtubeId: v.string(),
    artist: v.string(),
    title: v.string(),
    durationSeconds: v.optional(v.number()),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    // ... existing fields ... (room for enrichment like year/label/genres)

    // Analysis lifecycle
    analysisStatus: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("processing"),
        v.literal("complete"),
        v.literal("error")
      )
    ),
    analysisVersion: v.optional(v.string()),
    lastAnalyzedAt: v.optional(v.number()),
    analysisError: v.optional(
      v.object({
        code: v.string(),
        message: v.string(),
        at: v.number(),
      })
    ),

    // Fast-to-read summary (no big arrays)
    analysisSummary: v.optional(
      v.object({
        bpm: v.number(),
        bpmConfidence: v.optional(v.number()),
        key: v.string(), // e.g. "Am" or "C# major"
        keyConfidence: v.optional(v.number()),
        energy: v.optional(v.number()), // normalized 0-1 (RMS z-score)
        loudnessLufs: v.optional(v.number()),
        spectralBalance: v.optional(
          v.object({ low: v.number(), mid: v.number(), high: v.number() })
        ),
        vocals: v.optional(
          v.object({ present: v.boolean(), confidence: v.number() })
        ),
        drops: v.optional(v.array(v.number())), // seconds
        sections: v.optional(
          v.array(
            v.object({
              start: v.number(),
              duration: v.number(),
              label: v.optional(v.string()),
              confidence: v.optional(v.number()),
            })
          )
        ),
        analyzer: v.object({ name: v.string(), version: v.string() }),
      })
    ),

    // Optional pointer to detailed record
    analysisId: v.optional(v.id("audioAnalyses")),
  })
    .index("byYoutubeId", ["youtubeId"])
    .index("byAnalysisStatus", ["analysisStatus"]),

  // Detailed audio analyses stored separately to keep library small and fast
  audioAnalyses: defineTable({
    libraryId: v.id("library"),
    youtubeId: v.string(),
    analysisVersion: v.string(),
    analyzedAt: v.number(),
    audioHash: v.optional(v.string()),
    sampleRate: v.optional(v.number()),
    channels: v.optional(v.number()),
    processingMs: v.optional(v.number()),
    analyzer: v.object({ name: v.string(), version: v.string() }),

    // Core features
    bpm: v.object({
      value: v.number(),
      confidence: v.optional(v.number()),
      beatTimesBlobId: v.optional(v.id("_storage")),
    }),
    key: v.object({
      value: v.string(),
      scale: v.optional(v.string()),
      confidence: v.optional(v.number()),
    }),
    energy: v.optional(v.number()),
    loudness: v.optional(
      v.object({
        integratedLufs: v.number(),
        loudnessRangeLufs: v.optional(v.number()),
        momentaryLufsBlobId: v.optional(v.id("_storage")),
      })
    ),
    spectral: v.optional(
      v.object({
        centroidMean: v.optional(v.number()),
        flatnessMean: v.optional(v.number()),
        rolloffMean: v.optional(v.number()),
        balance: v.optional(
          v.object({ low: v.number(), mid: v.number(), high: v.number() })
        ),
      })
    ),
    timbre: v.optional(
      v.object({
        mfccMean: v.optional(v.array(v.number())),
        mfccStd: v.optional(v.array(v.number())),
      })
    ),
    harmony: v.optional(
      v.object({
        chromaMean: v.optional(v.array(v.number())),
        inharmonicity: v.optional(v.number()),
        harmonicRichness: v.optional(v.number()),
      })
    ),
    vocals: v.optional(
      v.object({
        present: v.boolean(),
        confidence: v.number(),
        activityBlobId: v.optional(v.id("_storage")),
      })
    ),
    sections: v.optional(
      v.array(
        v.object({
          start: v.number(),
          duration: v.number(),
          label: v.optional(v.string()),
          confidence: v.optional(v.number()),
        })
      )
    ),
    drops: v.optional(v.array(v.number())),

    // Optional downsampled waveform/env in storage
    waveformBlobId: v.optional(v.id("_storage")),
  })
    .index("byLibraryId", ["libraryId"])
    .index("byYoutubeId", ["youtubeId"]) 
    .index("byAnalyzedAt", ["analyzedAt"]),
});