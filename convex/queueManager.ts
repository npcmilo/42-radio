import { v } from "convex/values";
import { action, mutation } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("queue-manager");

// Configuration constants
const MIN_QUEUE_SIZE = 5; // Minimum tracks to maintain in queue
const MAX_QUEUE_SIZE = 20; // Maximum tracks to avoid over-queuing
const DISCOVERY_BATCH_SIZE = 10; // How many tracks to discover at once

// Discover and add new tracks to the queue
export const discoverAndQueueTracks = action({
  args: {
    count: v.optional(v.number()),
    forceRefresh: v.optional(v.boolean()), // Ignore recent play checks
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "discover-and-queue-tracks", async () => {
      const requestedCount = args.count || DISCOVERY_BATCH_SIZE;

      await logToDatabase(ctx, logger.info("Starting track discovery", {
        requestedCount,
        forceRefresh: args.forceRefresh,
      }));

      // Check current queue size
      const queueStatus = await ctx.runQuery(api.radio.getQueueStatus);
      
      if (queueStatus.queueLength >= MAX_QUEUE_SIZE && !args.forceRefresh) {
        await logToDatabase(ctx, logger.info("Queue full, skipping discovery", {
          currentQueueSize: queueStatus.queueLength,
          maxQueueSize: MAX_QUEUE_SIZE,
        }));
        return { added: 0, skipped: 0, errors: 0, reason: "queue_full" };
      }

      // Get tracks from Discogs
      const discogsResults = await ctx.runAction(api.discogs.smartSearch, {
        count: requestedCount,
      });

      if (discogsResults.length === 0) {
        await logToDatabase(ctx, logger.warn("No tracks found from Discogs search", {
          requestedCount,
        }));
        return { added: 0, skipped: 0, errors: 0, reason: "no_discogs_results" };
      }

      let addedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      // Process each Discogs result
      for (const track of discogsResults) {
        try {
          await logToDatabase(ctx, logger.debug("Processing Discogs track", {
            discogsId: track.discogsId,
            artist: track.artist,
            title: track.title,
          }));

          // Find YouTube match
          const youtubeMatch = await ctx.runAction(api.youtube.findBestMatch, {
            artist: track.artist,
            title: track.title,
            year: track.year,
            minDurationSeconds: 60, // At least 1 minute
            maxDurationSeconds: 1200, // At most 20 minutes
          });

          if (!youtubeMatch) {
            await logToDatabase(ctx, logger.warn("No YouTube match found for track", {
              discogsId: track.discogsId,
              artist: track.artist,
              title: track.title,
            }));
            skippedCount++;
            continue;
          }

          // Add to queue
          const queueId = await ctx.runMutation(api.radio.addToQueue, {
            discogsId: track.discogsId,
            title: track.title,
            artist: track.artist,
            year: track.year,
            label: track.label,
            youtubeId: youtubeMatch.videoId,
          });

          await logToDatabase(ctx, logger.info("Track added to queue", {
            queueId,
            discogsId: track.discogsId,
            artist: track.artist,
            title: track.title,
            youtubeId: youtubeMatch.videoId,
            youtubeDuration: youtubeMatch.durationSeconds,
          }));

          addedCount++;

          // Check if we've reached max queue size
          const updatedStatus = await ctx.runQuery(api.radio.getQueueStatus);
          if (updatedStatus.queueLength >= MAX_QUEUE_SIZE) {
            await logToDatabase(ctx, logger.info("Queue reached maximum size, stopping discovery", {
              currentQueueSize: updatedStatus.queueLength,
              processedTracks: addedCount + skippedCount + errorCount,
            }));
            break;
          }

        } catch (error) {
          await logToDatabase(ctx, logger.error("Error processing track", {
            discogsId: track.discogsId,
            artist: track.artist,
            title: track.title,
            error: error instanceof Error ? error.message : String(error),
          }));
          errorCount++;
        }
      }

      const result = {
        added: addedCount,
        skipped: skippedCount,  
        errors: errorCount,
        totalProcessed: addedCount + skippedCount + errorCount,
      };

      await logToDatabase(ctx, logger.info("Track discovery completed", {
        ...result,
        requestedCount,
        discogsResultsFound: discogsResults.length,
      }));

      return result;
    }, {
      requestedCount: args.count || DISCOVERY_BATCH_SIZE,
      forceRefresh: args.forceRefresh,
    });
  },
});

// Maintain optimal queue size
export const maintainQueue = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "maintain-queue", async () => {
      const queueStatus = await ctx.runQuery(api.radio.getQueueStatus);

      await logToDatabase(ctx, logger.debug("Queue maintenance check", {
        currentQueueSize: queueStatus.queueLength,
        minQueueSize: MIN_QUEUE_SIZE,
        hasCurrentTrack: queueStatus.hasCurrentTrack,
      }));

      // If queue is too small, add more tracks
      if (queueStatus.queueLength < MIN_QUEUE_SIZE) {
        const tracksNeeded = MIN_QUEUE_SIZE - queueStatus.queueLength + 2; // Add a few extra
        
        await logToDatabase(ctx, logger.info("Queue below minimum size, adding tracks", {
          currentSize: queueStatus.queueLength,
          minSize: MIN_QUEUE_SIZE,
          tracksNeeded,
        }));

        const discoveryResult = await ctx.runAction(api.queueManager.discoverAndQueueTracks, {
          count: tracksNeeded,
        });

        return {
          action: "discovery",
          queueSizeBefore: queueStatus.queueLength,
          queueSizeAfter: queueStatus.queueLength + discoveryResult.added,
          ...discoveryResult,
        };
      }

      // If no current track but queue has tracks, advance to next
      if (!queueStatus.hasCurrentTrack && queueStatus.queueLength > 0) {
        await logToDatabase(ctx, logger.info("No current track but queue has tracks, advancing", {
          queueLength: queueStatus.queueLength,
        }));

        const newTrackId = await ctx.runMutation(api.radio.advanceToNextTrack);

        return {
          action: "advance",
          newTrackId,
          queueSizeBefore: queueStatus.queueLength,
          queueSizeAfter: queueStatus.queueLength - 1,
        };
      }

      // Queue is healthy
      await logToDatabase(ctx, logger.debug("Queue maintenance complete - no action needed", {
        queueSize: queueStatus.queueLength,
        hasCurrentTrack: queueStatus.hasCurrentTrack,
      }));

      return {
        action: "none",
        queueSize: queueStatus.queueLength,
        hasCurrentTrack: queueStatus.hasCurrentTrack,
      };
    });
  },
});

// Skip current track (controller action)
export const skipCurrentTrack = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    try {
      // Verify user is a controller
      const user = await ctx.db.get(args.userId);
      if (!user || user.role !== "controller") {
        throw new Error("Only controllers can skip tracks");
      }

      const currentTrack = await ctx.db.query("currentTrack").first();
      if (!currentTrack) {
        await logToDatabase(ctx, logger.warn("Skip requested but no current track", {
          userId: args.userId,
          reason: args.reason,
        }));
        return { success: false, reason: "no_current_track" };
      }

      // Record the skip as feedback
      await ctx.db.insert("feedback", {
        userId: args.userId,
        discogsId: currentTrack.discogsId,
        type: "skip",
        createdAt: Date.now(),
      });

      // Advance to next track
      const newTrackId = await ctx.runAction(api.radio.advanceToNextTrack);

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Track skipped by controller", {
        duration_ms: duration,
        userId: args.userId,
        skippedTrack: {
          discogsId: currentTrack.discogsId,
          title: currentTrack.title,
          artist: currentTrack.artist,
        },
        newTrackId,
        reason: args.reason,
      }));

      return {
        success: true,
        skippedTrack: currentTrack.discogsId,
        newTrackId,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("Skip track failed", {
        duration_ms: duration,
        userId: args.userId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Clear queue (admin/controller action)
export const clearQueue = mutation({
  args: {
    userId: v.id("users"),
    keepCount: v.optional(v.number()), // Keep this many tracks at the front
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();

    try {
      // Verify user is a controller
      const user = await ctx.db.get(args.userId);
      if (!user || user.role !== "controller") {
        throw new Error("Only controllers can clear queue");
      }

      const queue = await ctx.db
        .query("queue")
        .withIndex("by_createdAt")
        .order("asc")
        .collect();

      const keepCount = args.keepCount || 0;
      const tracksToRemove = queue.slice(keepCount);

      // Remove tracks
      for (const track of tracksToRemove) {
        await ctx.db.delete(track._id);
      }

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Queue cleared by controller", {
        duration_ms: duration,
        userId: args.userId,
        originalQueueSize: queue.length,
        tracksRemoved: tracksToRemove.length,
        tracksKept: keepCount,
      }));

      return {
        success: true,
        originalSize: queue.length,
        newSize: keepCount,
        removedCount: tracksToRemove.length,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("Clear queue failed", {
        duration_ms: duration,
        userId: args.userId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get queue health metrics
export const getQueueHealth = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "queue-health-check", async () => {
      const queueStatus = await ctx.runQuery(api.radio.getQueueStatus);
      const queue = await ctx.runQuery(api.radio.getQueue, { limit: 50 });

      // Calculate health metrics
      const health = {
        queueLength: queueStatus.queueLength,
        hasCurrentTrack: queueStatus.hasCurrentTrack,
        isHealthy: queueStatus.queueLength >= MIN_QUEUE_SIZE && queueStatus.hasCurrentTrack,
        needsReplenishment: queueStatus.queueLength < MIN_QUEUE_SIZE,
        isOverfull: queueStatus.queueLength > MAX_QUEUE_SIZE,
        estimatedPlaytimeMinutes: 0,
        oldestTrackAge: 0,
        newestTrackAge: 0,
      };

      if (queue.length > 0) {
        // Calculate estimated playtime (assuming 4 minutes per track average)
        health.estimatedPlaytimeMinutes = queue.length * 4;
        
        // Calculate track ages
        const now = Date.now();
        const trackAges = queue.map(track => now - track.createdAt);
        health.oldestTrackAge = Math.max(...trackAges);
        health.newestTrackAge = Math.min(...trackAges);
      }

      await logToDatabase(ctx, logger.info("Queue health assessed", {
        ...health,
        minQueueSize: MIN_QUEUE_SIZE,
        maxQueueSize: MAX_QUEUE_SIZE,
      }));

      return health;
    });
  },
});