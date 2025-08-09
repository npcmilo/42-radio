import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("library");

// Upsert a track into the library using youtubeId as the primary key
export const upsertTrack = mutation({
  args: {
    discogsId: v.string(),
    youtubeId: v.string(),
    artist: v.string(),
    title: v.string(),
    durationSeconds: v.optional(v.number()),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"library">> => {
    return await withTiming(ctx, logger, "upsert-track", async () => {
      // Try to find existing record by youtubeId
      const existing = await ctx.db
        .query("library")
        .withIndex("byYoutubeId", (q) => q.eq("youtubeId", args.youtubeId))
        .first();

      if (existing) {
        // Merge updates (only provided fields overwrite)
        await ctx.db.patch(existing._id, {
          discogsId: args.discogsId || existing.discogsId,
          artist: args.artist || existing.artist,
          title: args.title || existing.title,
          durationSeconds: args.durationSeconds ?? existing.durationSeconds,
          year: args.year ?? existing.year,
          label: args.label ?? existing.label,
        });

        await logToDatabase(ctx, logger.info("Library upsert - updated existing", {
          libraryId: existing._id,
          youtubeId: args.youtubeId,
          discogsId: args.discogsId,
        }));

        return existing._id;
      }

      // Insert new record
      const libraryId = await ctx.db.insert("library", {
        discogsId: args.discogsId,
        youtubeId: args.youtubeId,
        artist: args.artist,
        title: args.title,
        durationSeconds: args.durationSeconds,
        year: args.year,
        label: args.label,
        // analysis fields intentionally left empty until queued/processed
      });

      await logToDatabase(ctx, logger.info("Library upsert - inserted new", {
        libraryId,
        youtubeId: args.youtubeId,
        discogsId: args.discogsId,
      }));

      return libraryId;
    });
  },
});

// Get a library entry by YouTube ID
export const getByYoutubeId = query({
  args: { youtubeId: v.string() },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "get-by-youtubeId", async () => {
      const item = await ctx.db
        .query("library")
        .withIndex("byYoutubeId", (q) => q.eq("youtubeId", args.youtubeId))
        .first();
      return item;
    });
  },
});

// Get one or many library entries by analysisStatus
export const getQueuedForAnalysis = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "get-queued-for-analysis", async () => {
      const items = await ctx.db
        .query("library")
        .withIndex("byAnalysisStatus", (q) => q.eq("analysisStatus", "queued"))
        .take(Math.min(Math.max(args.limit || 25, 1), 100));
      return items;
    });
  },
});

// Enqueue analysis for a library item
export const enqueueAnalysis = mutation({
  args: {
    youtubeId: v.optional(v.string()),
    libraryId: v.optional(v.id("library")),
    analysisVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "enqueue-analysis", async () => {
      let libraryItem: any | null = null;

      if (args.libraryId) {
        libraryItem = await ctx.db.get(args.libraryId);
      } else if (args.youtubeId) {
        libraryItem = await ctx.db
          .query("library")
          .withIndex("byYoutubeId", (q) => q.eq("youtubeId", args.youtubeId!))
          .first();
      }

      if (!libraryItem) {
        throw new Error("Library item not found for analysis enqueue");
      }

      // If already queued or processing, do not change
      if (libraryItem.analysisStatus === "queued" || libraryItem.analysisStatus === "processing") {
        return { libraryId: libraryItem._id, status: libraryItem.analysisStatus };
      }

      await ctx.db.patch(libraryItem._id, {
        analysisStatus: "queued",
        analysisVersion: args.analysisVersion ?? libraryItem.analysisVersion,
        analysisError: undefined,
      });

      await logToDatabase(ctx, logger.info("Analysis enqueued", {
        libraryId: libraryItem._id,
        youtubeId: libraryItem.youtubeId,
        analysisVersion: args.analysisVersion,
      }));

      return { libraryId: libraryItem._id, status: "queued" };
    });
  },
});

// Mark processing start
export const markProcessing = mutation({
  args: { libraryId: v.id("library"), analysisVersion: v.string() },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "mark-processing", async () => {
      const item = await ctx.db.get(args.libraryId);
      if (!item) throw new Error("Library item not found");

      await ctx.db.patch(args.libraryId, {
        analysisStatus: "processing",
        analysisVersion: args.analysisVersion,
        analysisError: undefined,
      });

      await logToDatabase(ctx, logger.info("Analysis processing started", {
        libraryId: args.libraryId,
        youtubeId: item.youtubeId,
        analysisVersion: args.analysisVersion,
      }));

      return { libraryId: args.libraryId, status: "processing" };
    });
  },
});

// Post analysis result and update summary
export const postAnalysisResult = mutation({
  args: {
    libraryId: v.id("library"),
    youtubeId: v.string(),
    analysisVersion: v.string(),
    analyzedAt: v.number(),
    analyzer: v.object({ name: v.string(), version: v.string() }),

    bpm: v.object({ value: v.number(), confidence: v.optional(v.number()), beatTimesBlobId: v.optional(v.id("_storage")) }),
    key: v.object({ value: v.string(), scale: v.optional(v.string()), confidence: v.optional(v.number()) }),

    energy: v.optional(v.number()),
    loudness: v.optional(v.object({
      integratedLufs: v.number(),
      loudnessRangeLufs: v.optional(v.number()),
      momentaryLufsBlobId: v.optional(v.id("_storage")),
    })),
    spectral: v.optional(v.object({
      centroidMean: v.optional(v.number()),
      flatnessMean: v.optional(v.number()),
      rolloffMean: v.optional(v.number()),
      balance: v.optional(v.object({ low: v.number(), mid: v.number(), high: v.number() })),
    })),
    timbre: v.optional(v.object({
      mfccMean: v.optional(v.array(v.number())),
      mfccStd: v.optional(v.array(v.number())),
    })),
    harmony: v.optional(v.object({
      chromaMean: v.optional(v.array(v.number())),
      inharmonicity: v.optional(v.number()),
      harmonicRichness: v.optional(v.number()),
    })),
    vocals: v.optional(v.object({
      present: v.boolean(),
      confidence: v.number(),
      activityBlobId: v.optional(v.id("_storage")),
    })),
    sections: v.optional(v.array(v.object({
      start: v.number(), duration: v.number(), label: v.optional(v.string()), confidence: v.optional(v.number()),
    }))),
    drops: v.optional(v.array(v.number())),

    waveformBlobId: v.optional(v.id("_storage")),
    audioHash: v.optional(v.string()),
    sampleRate: v.optional(v.number()),
    channels: v.optional(v.number()),
    processingMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "post-analysis-result", async () => {
      const libraryItem = await ctx.db.get(args.libraryId);
      if (!libraryItem) throw new Error("Library item not found");
      if (libraryItem.youtubeId !== args.youtubeId) {
        await logToDatabase(ctx, logger.warn("YouTube ID mismatch on analysis result", {
          libraryId: args.libraryId,
          expected: libraryItem.youtubeId,
          got: args.youtubeId,
        }));
      }

      // Create or update audioAnalyses entry (idempotent-ish by {libraryId, analysisVersion, analyzedAt})
      const existingLatest = await ctx.db
        .query("audioAnalyses")
        .withIndex("byLibraryId", (q) => q.eq("libraryId", args.libraryId))
        .order("desc")
        .first();

      const analysisId = await ctx.db.insert("audioAnalyses", {
        libraryId: args.libraryId,
        youtubeId: args.youtubeId,
        analysisVersion: args.analysisVersion,
        analyzedAt: args.analyzedAt,
        analyzer: args.analyzer,
        bpm: args.bpm,
        key: args.key,
        energy: args.energy,
        loudness: args.loudness,
        spectral: args.spectral,
        timbre: args.timbre,
        harmony: args.harmony,
        vocals: args.vocals,
        sections: args.sections,
        drops: args.drops,
        waveformBlobId: args.waveformBlobId,
        audioHash: args.audioHash,
        sampleRate: args.sampleRate,
        channels: args.channels,
        processingMs: args.processingMs,
      });

      // Build summary for the library row
      const keyString = args.key.scale ? `${args.key.value} ${args.key.scale}` : args.key.value;
      const summary = {
        bpm: args.bpm.value,
        bpmConfidence: args.bpm.confidence,
        key: keyString,
        keyConfidence: args.key.confidence,
        energy: args.energy,
        loudnessLufs: args.loudness?.integratedLufs,
        spectralBalance: args.spectral?.balance,
        vocals: args.vocals ? { present: args.vocals.present, confidence: args.vocals.confidence } : undefined,
        drops: args.drops,
        sections: args.sections,
        analyzer: args.analyzer,
      } as any;

      await ctx.db.patch(args.libraryId, {
        analysisId,
        analysisStatus: "complete",
        analysisVersion: args.analysisVersion,
        lastAnalyzedAt: args.analyzedAt,
        analysisError: undefined,
        analysisSummary: summary,
      });

      await logToDatabase(ctx, logger.info("Analysis result stored", {
        libraryId: args.libraryId,
        analysisId,
        youtubeId: args.youtubeId,
        previousAnalysisPresent: !!existingLatest,
      }));

      return { libraryId: args.libraryId, analysisId };
    });
  },
});

// Mark analysis error
export const markAnalysisError = mutation({
  args: {
    libraryId: v.id("library"),
    code: v.string(),
    message: v.string(),
    at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "mark-analysis-error", async () => {
      const at = args.at || Date.now();
      await ctx.db.patch(args.libraryId, {
        analysisStatus: "error",
        analysisError: { code: args.code, message: args.message, at },
      });
      await logToDatabase(ctx, logger.warn("Analysis marked as error", {
        libraryId: args.libraryId,
        code: args.code,
      }));
      return { libraryId: args.libraryId, status: "error" };
    });
  },
});

// Get analyses by libraryId
export const getAnalysesByLibraryId = query({
  args: { libraryId: v.id("library"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "get-analyses-by-library", async () => {
      const items = await ctx.db
        .query("audioAnalyses")
        .withIndex("byLibraryId", (q) => q.eq("libraryId", args.libraryId))
        .order("desc")
        .take(args.limit || 10);
      return items;
    });
  },
});

// Get latest analysis by YouTube ID
export const getLatestAnalysisByYoutubeId = query({
  args: { youtubeId: v.string() },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "get-latest-analysis-by-youtubeId", async () => {
      const item = await ctx.db
        .query("audioAnalyses")
        .withIndex("byYoutubeId", (q) => q.eq("youtubeId", args.youtubeId))
        .order("desc")
        .first();
      return item;
    });
  },
});

// Backfill the library from existing tables with discogsId + youtubeId
export const backfillFromExistingData = mutation({
  args: { limitPerSource: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{
    inserted: number; updated: number; seen: number; sources: Record<string, number>;
  }> => {
    return await withTiming(ctx, logger, "backfill-library", async () => {
      const limit = Math.max(1, Math.min(args.limitPerSource || 1000, 5000));

      // Fetch candidates directly from tables
      const history = await ctx.db.query("history").order("desc").take(limit);
      const queue = await ctx.db.query("queue").withIndex("by_createdAt").order("asc").take(limit);
      const currentTrack = await ctx.db.query("currentTrack").first();

      const candidates: Array<{
        discogsId: string; youtubeId: string; artist: string; title: string; durationSeconds?: number; year?: number; label?: string;
      }> = [];

      const pushCandidate = (c: any) => {
        if (!c) return;
        if (c.discogsId && c.youtubeId) {
          candidates.push({
            discogsId: c.discogsId,
            youtubeId: c.youtubeId,
            artist: c.artist,
            title: c.title,
            durationSeconds: c.durationSeconds,
            year: typeof c.year === "string" ? parseInt(c.year) : c.year,
            label: c.label,
          });
        }
      };

      history?.forEach(pushCandidate);
      queue?.forEach(pushCandidate);
      pushCandidate(currentTrack);

      // Deduplicate by youtubeId
      const byYoutube = new Map<string, typeof candidates[number]>();
      for (const c of candidates) {
        if (!byYoutube.has(c.youtubeId)) byYoutube.set(c.youtubeId, c);
      }

      let inserted = 0;
      let updated = 0;
      let seen = 0;

      for (const c of byYoutube.values()) {
        seen++;
        const existing = await ctx.db
          .query("library")
          .withIndex("byYoutubeId", (q) => q.eq("youtubeId", c.youtubeId))
          .first();
        if (existing) {
          await ctx.db.patch(existing._id, {
            discogsId: c.discogsId || existing.discogsId,
            artist: c.artist || existing.artist,
            title: c.title || existing.title,
            durationSeconds: c.durationSeconds ?? existing.durationSeconds,
            year: c.year ?? existing.year,
            label: c.label ?? existing.label,
          });
          updated++;
        } else {
          await ctx.db.insert("library", {
            discogsId: c.discogsId,
            youtubeId: c.youtubeId,
            artist: c.artist,
            title: c.title,
            durationSeconds: c.durationSeconds,
            year: c.year,
            label: c.label,
          });
          inserted++;
        }
      }

      await logToDatabase(ctx, logger.info("Backfill completed", {
        sources: { history: history?.length || 0, queue: queue?.length || 0, currentTrack: currentTrack ? 1 : 0 },
        inserted,
        updated,
        seen,
      }));

      return {
        inserted,
        updated,
        seen,
        sources: { history: history?.length || 0, queue: queue?.length || 0, currentTrack: currentTrack ? 1 : 0 },
      };
    });
  },
});
