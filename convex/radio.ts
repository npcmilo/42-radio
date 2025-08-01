import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Logger, logToDatabase } from "./logger";

const logger = new Logger("radio-core");

// Get the currently playing track for all listeners
export const getCurrentTrack = query({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    
    try {
      const currentTrack = await ctx.db
        .query("currentTrack")
        .first();

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("getCurrentTrack query executed", {
        duration_ms: duration,
        found: !!currentTrack,
        trackId: currentTrack?.discogsId,
      }));

      return currentTrack;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getCurrentTrack query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get the upcoming tracks in the queue (for controllers)
export const getQueue = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const queue = await ctx.db
        .query("queue")
        .withIndex("by_createdAt")
        .order("asc") // FIFO order
        .take(args.limit || 10);

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("getQueue query executed", {
        duration_ms: duration,
        queueLength: queue.length,
        limit: args.limit || 10,
      }));

      return queue;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getQueue query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get recent track history
export const getTrackHistory = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const history = await ctx.db
        .query("history")
        .order("desc") // Most recent first
        .take(args.limit || 20);

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("getTrackHistory query executed", {
        duration_ms: duration,
        historyLength: history.length,
        limit: args.limit || 20,
      }));

      return history;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getTrackHistory query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get queue status (for monitoring)
export const getQueueStatus = query({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    
    try {
      const queueCount = await ctx.db
        .query("queue")
        .collect()
        .then(q => q.length);

      const currentTrack = await ctx.db
        .query("currentTrack")
        .first();

      const historyCount = await ctx.db
        .query("history")
        .collect()
        .then(h => h.length);

      const status = {
        queueLength: queueCount,
        hasCurrentTrack: !!currentTrack,
        currentTrackId: currentTrack?.discogsId,
        historyCount,
        lastUpdated: Date.now(),
      };

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Queue status checked", {
        duration_ms: duration,
        ...status,
      }));

      return status;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getQueueStatus query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Check if a track has been played recently (for deduplication)
export const isTrackRecent = query({
  args: {
    discogsId: v.string(),
    hoursBack: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const hoursBack = args.hoursBack || 24; // Default to 24 hours
    const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
    
    try {
      const recentTrack = await ctx.db
        .query("history")
        .withIndex("by_discogsId", (q) => q.eq("discogsId", args.discogsId))
        .filter((q) => q.gte(q.field("playedAt"), cutoffTime))
        .first();

      const isRecent = !!recentTrack;
      const duration = Date.now() - startTime;
      
      await logToDatabase(ctx, logger.debug("Track recency check", {
        duration_ms: duration,
        discogsId: args.discogsId,
        hoursBack,
        isRecent,
        lastPlayedAt: recentTrack?.playedAt,
      }));

      return {
        isRecent,
        lastPlayedAt: recentTrack?.playedAt,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("isTrackRecent query failed", {
        duration_ms: duration,
        discogsId: args.discogsId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Add a track to the queue
export const addToQueue = mutation({
  args: {
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    youtubeId: v.string(),
    transitionAudioUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const trackId = await ctx.db.insert("queue", {
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
        year: args.year,
        label: args.label,
        youtubeId: args.youtubeId,
        createdAt: Date.now(),
        transitionAudioUrl: args.transitionAudioUrl,
      });

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Track added to queue", {
        duration_ms: duration,
        trackId: trackId,
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
        youtubeId: args.youtubeId,
      }));

      return trackId;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("addToQueue mutation failed", {
        duration_ms: duration,
        discogsId: args.discogsId,
        title: args.title,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Move the next track from queue to currentTrack
export const advanceToNextTrack = mutation({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    
    try {
      // Get the next track from the queue
      const nextTrack = await ctx.db
        .query("queue")
        .withIndex("by_createdAt")
        .order("asc")
        .first();

      if (!nextTrack) {
        await logToDatabase(ctx, logger.warn("No tracks in queue to advance", {
          duration_ms: Date.now() - startTime,
        }));
        return null;
      }

      // Move current track to history if it exists
      const currentTrack = await ctx.db
        .query("currentTrack")
        .first();

      if (currentTrack) {
        await ctx.db.insert("history", {
          discogsId: currentTrack.discogsId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          youtubeId: currentTrack.youtubeId,
          playedAt: currentTrack.startedAt,
        });

        // Delete the old current track
        await ctx.db.delete(currentTrack._id);
      }

      // Set the new current track
      const newCurrentTrackId = await ctx.db.insert("currentTrack", {
        discogsId: nextTrack.discogsId,
        title: nextTrack.title,
        artist: nextTrack.artist,
        year: nextTrack.year,
        label: nextTrack.label,
        youtubeId: nextTrack.youtubeId,
        startedAt: Date.now(),
        transitionAudioUrl: nextTrack.transitionAudioUrl,
      });

      // Remove the track from the queue
      await ctx.db.delete(nextTrack._id);

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Advanced to next track", {
        duration_ms: duration,
        newTrackId: newCurrentTrackId,
        discogsId: nextTrack.discogsId,
        title: nextTrack.title,
        artist: nextTrack.artist,
        previousTrackId: currentTrack?.discogsId,
      }));

      return newCurrentTrackId;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("advanceToNextTrack mutation failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});