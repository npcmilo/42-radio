import { v } from "convex/values";
import { query, mutation, action } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("radio-core");

// Get a specific queue track by ID
export const getQueueTrackById = query({
  args: {
    trackId: v.id("queue"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.trackId);
  },
});

// Update transition audio URL for a queue track
export const updateQueueTrackTransition = mutation({
  args: {
    trackId: v.id("queue"),
    transitionAudioUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.trackId, {
      transitionAudioUrl: args.transitionAudioUrl,
    });
  },
});

// Remove a track from the queue
export const removeFromQueue = mutation({
  args: {
    trackId: v.id("queue"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.trackId);
  },
});

// Generate transition audio with proper previous/upcoming context
export const generateTransitionAudioWithContext = action({
  args: {
    trackId: v.id("queue"),
  },
  handler: async (ctx, args): Promise<{
    script: string;
    audioUrl: string | null;
    wordCount: number;
    isClaudeGenerated: boolean;
    characterCount: number;
    error?: string;
  }> => {
    return await withTiming(ctx, logger, "generate-transition-with-context", async (): Promise<{
      script: string;
      audioUrl: string | null;
      wordCount: number;
      isClaudeGenerated: boolean;
      characterCount: number;
      error?: string;
    }> => {
      // Get the track we're generating audio for
      const track = await ctx.runQuery(api.radio.getQueueTrackById, { trackId: args.trackId });
      if (!track) {
        throw new Error("Track not found");
      }

      // Get current track (will become previous)
      const currentTrack = await ctx.runQuery(api.radio.getCurrentTrack);
      
      // Generate transition audio with context
      // This transition introduces the track we're generating audio for
      const transitionResult = await ctx.runAction(api.scriptGenerator.generateTransitionAudio, {
        artist: track.artist,
        title: track.title,
        year: typeof track.year === 'string' ? parseInt(track.year) : track.year,
        label: track.label,
        previousTrack: currentTrack ? {
          artist: currentTrack.artist,
          title: currentTrack.title,
        } : undefined,
        upcomingTrack: {
          // The track we're generating audio for IS the upcoming track
          artist: track.artist,
          title: track.title,
        },
        useClaudeScript: true,
      });

      // Update the track with the new transition audio
      if (transitionResult.audioUrl) {
        await ctx.runMutation(api.radio.updateQueueTrackTransition, {
          trackId: args.trackId,
          transitionAudioUrl: transitionResult.audioUrl,
        });

        await logToDatabase(ctx, logger.info("Transition audio generated with context", {
          trackId: args.trackId,
          artist: track.artist,
          title: track.title,
          script: transitionResult.script,
          wordCount: transitionResult.wordCount,
          isClaudeGenerated: transitionResult.isClaudeGenerated,
          hasPrevious: !!currentTrack,
        }));
      }

      return transitionResult;
    });
  },
});

// Enhanced track advancement that generates transition audio with context
export const advanceToNextTrackWithContext = action({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    return await withTiming(ctx, logger, "advance-with-context", async (): Promise<string | null> => {
      // Get the next track from the queue
      const queueTracks = await ctx.runQuery(api.radio.getQueue, { limit: 1 });
      
      if (queueTracks.length === 0) {
        await logToDatabase(ctx, logger.warn("No tracks in queue to advance", {}));
        return null;
      }

      const nextTrack = queueTracks[0];

      // Generate transition audio with proper context before advancing
      try {
        await ctx.runAction(api.radio.generateTransitionAudioWithContext, {
          trackId: nextTrack._id,
        });
      } catch (error) {
        await logToDatabase(ctx, logger.warn("Failed to generate transition audio with context", {
          trackId: nextTrack._id,
          error: error instanceof Error ? error.message : String(error),
        }));
        // Continue with advancement even if transition audio fails
      }

      // Now advance the track
      const newCurrentTrackId = await ctx.runMutation(api.radio.advanceToNextTrack);
      
      // Trigger queue maintenance
      await ctx.runAction(api.radio.postAdvanceQueueUpdate);
      
      return newCurrentTrackId;
    });
  },
});

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

// Check if a track has been played in the last N tracks (for improved deduplication)
export const isTrackInRecentHistory = query({
  args: {
    discogsId: v.string(),
    lastNTracks: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const lastNTracks = args.lastNTracks || 100; // Default to last 100 tracks
    
    try {
      // Get the most recent N tracks from history
      const recentHistory = await ctx.db
        .query("history")
        .order("desc") // Most recent first
        .take(lastNTracks);

      // Check if our track is in this recent history
      const trackInHistory = recentHistory.find(track => track.discogsId === args.discogsId);
      const isInRecentHistory = !!trackInHistory;
      
      const duration = Date.now() - startTime;
      
      await logToDatabase(ctx, logger.debug("Track recent history check", {
        duration_ms: duration,
        discogsId: args.discogsId,
        lastNTracks,
        isInRecentHistory,
        lastPlayedAt: trackInHistory?.playedAt,
        historyPosition: trackInHistory ? recentHistory.indexOf(trackInHistory) + 1 : null,
      }));

      return {
        isInRecentHistory,
        lastPlayedAt: trackInHistory?.playedAt,
        historyPosition: trackInHistory ? recentHistory.indexOf(trackInHistory) + 1 : null,
        totalHistoryChecked: recentHistory.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("isTrackInRecentHistory query failed", {
        duration_ms: duration,
        discogsId: args.discogsId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Add track to queue manually (for controllers and debugging)
export const addTrackManually = mutation({
  args: {
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    youtubeId: v.string(),
    durationSeconds: v.number(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    userId: v.optional(v.id("users")), // For permission checking
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Check if user is a controller (if userId provided)
      if (args.userId) {
        const user = await ctx.db.get(args.userId);
        if (!user || user.role !== "controller") {
          throw new Error("Only controllers can manually add tracks");
        }
      }

      // Check for duplicates in queue
      const existingInQueue = await ctx.db
        .query("queue")
        .filter((q) => q.eq(q.field("discogsId"), args.discogsId))
        .first();

      if (existingInQueue) {
        await logToDatabase(ctx, logger.warn("Track already in queue", {
          discogsId: args.discogsId,
          existingId: existingInQueue._id,
        }));
        throw new Error("Track already in queue");
      }

      // Check if track is in recent history (last 100 tracks)
      const historyCheck = await ctx.runQuery(api.radio.isTrackInRecentHistory, {
        discogsId: args.discogsId,
        lastNTracks: 100,
      });

      if (historyCheck.isInRecentHistory) {
        await logToDatabase(ctx, logger.warn("Track in recent history", {
          discogsId: args.discogsId,
          lastPlayed: historyCheck.lastPlayedAt,
          historyPosition: historyCheck.historyPosition,
        }));
        throw new Error(`Track played recently (position ${historyCheck.historyPosition} in last 100 tracks)`);
      }

      const trackId = await ctx.db.insert("queue", {
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
        year: args.year,
        label: args.label,
        youtubeId: args.youtubeId,
        durationSeconds: args.durationSeconds,
        createdAt: Date.now(),
      });

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Track manually added to queue", {
        duration_ms: duration,
        trackId,
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
        youtubeId: args.youtubeId,
        addedByUser: args.userId,
      }));

      return trackId;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("Manual track addition failed", {
        duration_ms: duration,
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
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
    durationSeconds: v.number(),
    transitionAudioUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Check for duplicates in queue
      const existingInQueue = await ctx.db
        .query("queue")
        .filter((q) => q.eq(q.field("discogsId"), args.discogsId))
        .first();

      if (existingInQueue) {
        await logToDatabase(ctx, logger.warn("Track already in queue, skipping", {
          discogsId: args.discogsId,
          title: args.title,
          artist: args.artist,
          existingId: existingInQueue._id,
        }));
        return existingInQueue._id; // Return existing ID instead of throwing error
      }

      // Check if track is in recent history (last 100 tracks)
      const historyCheck = await ctx.runQuery(api.radio.isTrackInRecentHistory, {
        discogsId: args.discogsId,
        lastNTracks: 100,
      });

      if (historyCheck.isInRecentHistory) {
        await logToDatabase(ctx, logger.warn("Track in recent history, skipping", {
          discogsId: args.discogsId,
          title: args.title,
          artist: args.artist,
          lastPlayed: historyCheck.lastPlayedAt,
          historyPosition: historyCheck.historyPosition,
        }));
        return null; // Return null to indicate skip
      }

      const trackId = await ctx.db.insert("queue", {
        discogsId: args.discogsId,
        title: args.title,
        artist: args.artist,
        year: args.year,
        label: args.label,
        youtubeId: args.youtubeId,
        durationSeconds: args.durationSeconds,
        createdAt: Date.now(),
        transitionAudioUrl: args.transitionAudioUrl,
      });

      // Upsert into library to ensure canonical storage
      try {
        // @ts-ignore Generated API may not include library locally until Convex codegen runs
        await ctx.runMutation(api.library.upsertTrack, {
          discogsId: args.discogsId,
          youtubeId: args.youtubeId,
          artist: args.artist,
          title: args.title,
          durationSeconds: args.durationSeconds,
          year: args.year,
          label: args.label,
        });
      } catch (e) {
        await logToDatabase(ctx, logger.warn("Library upsert failed during addToQueue", {
          discogsId: args.discogsId,
          youtubeId: args.youtubeId,
          error: e instanceof Error ? e.message : String(e),
        }));
      }

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

// Get a random track from history for fallback playback
export const getRandomHistoryTrack = query({
  args: {
    hoursBack: v.optional(v.number()), // Minimum hours since last play
    excludeRecent: v.optional(v.number()), // Exclude N most recent tracks
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const hoursBack = args.hoursBack || 24; // Default to tracks older than 24 hours
    const excludeRecent = args.excludeRecent || 50; // Default exclude last 50 tracks
    const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
    
    try {
      // Get all history tracks older than cutoff
      const eligibleTracks = await ctx.db
        .query("history")
        .filter((q) => q.lt(q.field("playedAt"), cutoffTime))
        .order("desc")
        .collect();

      if (eligibleTracks.length === 0) {
        // If no old tracks, get any tracks excluding the most recent ones
        const allHistory = await ctx.db
          .query("history")
          .order("desc")
          .take(200); // Get more tracks to have selection variety
        
        // Skip the most recent tracks
        const fallbackTracks = allHistory.slice(excludeRecent);
        
        if (fallbackTracks.length === 0) {
          await logToDatabase(ctx, logger.warn("No history tracks available for fallback", {
            duration_ms: Date.now() - startTime,
            totalHistorySize: allHistory.length,
          }));
          return null;
        }
        
        // Select a random track from fallback
        const randomIndex = Math.floor(Math.random() * fallbackTracks.length);
        const selectedTrack = fallbackTracks[randomIndex];
        
        await logToDatabase(ctx, logger.info("Selected fallback track from recent history", {
          duration_ms: Date.now() - startTime,
          trackId: selectedTrack.discogsId,
          title: selectedTrack.title,
          artist: selectedTrack.artist,
          lastPlayedAt: selectedTrack.playedAt,
          fallbackPoolSize: fallbackTracks.length,
        }));
        
        return selectedTrack;
      }
      
      // Select a random track from eligible tracks
      const randomIndex = Math.floor(Math.random() * eligibleTracks.length);
      const selectedTrack = eligibleTracks[randomIndex];
      
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Selected history track for fallback", {
        duration_ms: duration,
        trackId: selectedTrack.discogsId,
        title: selectedTrack.title,
        artist: selectedTrack.artist,
        lastPlayedAt: selectedTrack.playedAt,
        hoursAgo: Math.floor((Date.now() - selectedTrack.playedAt) / (1000 * 60 * 60)),
        eligiblePoolSize: eligibleTracks.length,
      }));
      
      return selectedTrack;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getRandomHistoryTrack query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Move the next track from queue to currentTrack
export const advanceToNextTrack = mutation({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const startTime = Date.now();
    
    try {
      // Get the next track from the queue
      const nextTrack = await ctx.db
        .query("queue")
        .withIndex("by_createdAt")
        .order("asc")
        .first();

      // If no track in queue, try to use history as fallback
      if (!nextTrack) {
        await logToDatabase(ctx, logger.warn("No tracks in queue, attempting history fallback", {
          duration_ms: Date.now() - startTime,
        }));
        
        // Get a random track from history
        const historyTrack = await ctx.runQuery(api.radio.getRandomHistoryTrack, {
          hoursBack: 24,
          excludeRecent: 50,
        });
        
        if (!historyTrack) {
          await logToDatabase(ctx, logger.error("No tracks available in queue or history", {
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
            durationSeconds: currentTrack.durationSeconds,
            playedAt: currentTrack.startedAt,
          });

          // Delete the old current track
          await ctx.db.delete(currentTrack._id);
        }
        
        // Set the history track as current (with new startedAt time)
        const newCurrentTrackId = await ctx.db.insert("currentTrack", {
          discogsId: historyTrack.discogsId,
          title: historyTrack.title,
          artist: historyTrack.artist,
          youtubeId: historyTrack.youtubeId,
          durationSeconds: historyTrack.durationSeconds,
          startedAt: Date.now(),
          // Note: transition audio will be regenerated if needed
        });
        
        // Update the history entry to track the replay
        await ctx.db.patch(historyTrack._id, {
          replayCount: (historyTrack.replayCount || 0) + 1,
          lastReplayedAt: Date.now(),
        });
        
        const duration = Date.now() - startTime;
        await logToDatabase(ctx, logger.warn("Using history fallback for playback", {
          duration_ms: duration,
          newTrackId: newCurrentTrackId,
          discogsId: historyTrack.discogsId,
          title: historyTrack.title,
          artist: historyTrack.artist,
          lastPlayedAt: historyTrack.playedAt,
          hoursAgo: Math.floor((Date.now() - historyTrack.playedAt) / (1000 * 60 * 60)),
          isHistoryFallback: true,
          replayCount: (historyTrack.replayCount || 0) + 1,
        }));
        
        return newCurrentTrackId;
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
          durationSeconds: currentTrack.durationSeconds,
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
        durationSeconds: nextTrack.durationSeconds,
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

      // Note: Queue maintenance will be triggered by external monitoring
      // We can't call actions from mutations, so external cron/monitor handles this
      
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

// Post-advance queue maintenance (ensures queue stays healthy after track changes)
export const postAdvanceQueueUpdate = action({
  args: {},
  handler: async (ctx): Promise<{
    action: string;
    tracksAdded?: number;
    newQueueSize?: number;
    reason?: string;
    queueSize?: number;
    added?: number;
    skipped?: number;
    errors?: number;
  }> => {
    return await withTiming(ctx, logger, "post-advance-queue-update", async (): Promise<{
      action: string;
      tracksAdded?: number;
      newQueueSize?: number;
      reason?: string;
      queueSize?: number;
      added?: number;
      skipped?: number;
      errors?: number;
    }> => {
      await logToDatabase(ctx, logger.debug("Starting post-advance queue maintenance"));

      // Check current queue status
      const queueStatus: {
        queueLength: number;
        hasCurrentTrack: boolean;
        currentTrackId?: string;
        historyCount: number;
        lastUpdated: number;
      } = await ctx.runQuery(api.radio.getQueueStatus);
      
      // Target queue size: maintain 40+ tracks for optimal buffer
      const TARGET_QUEUE_SIZE: number = 40;
      const MAX_QUEUE_SIZE: number = 500;
      
      await logToDatabase(ctx, logger.debug("Queue status check", {
        currentQueueSize: queueStatus.queueLength,
        targetQueueSize: TARGET_QUEUE_SIZE,
        needsReplenishment: queueStatus.queueLength < TARGET_QUEUE_SIZE,
      }));

      // If queue is below target size, add tracks immediately
      if (queueStatus.queueLength < TARGET_QUEUE_SIZE) {
        const tracksNeeded: number = TARGET_QUEUE_SIZE - queueStatus.queueLength + 2; // Add buffer
        
        await logToDatabase(ctx, logger.info("Queue below target, adding tracks immediately", {
          currentSize: queueStatus.queueLength,
          targetSize: TARGET_QUEUE_SIZE,
          tracksNeeded,
        }));

        // Use queue manager to discover and add tracks
        const discoveryResult: {
          added: number;
          skipped: number;
          errors: number;
          totalProcessed?: number;
          reason?: string;
        } = await ctx.runAction(api.queueManager.discoverAndQueueTracks, {
          count: Math.min(tracksNeeded, MAX_QUEUE_SIZE - queueStatus.queueLength),
          forceRefresh: false,
        });

        await logToDatabase(ctx, logger.info("Post-advance queue update completed", {
          tracksAdded: discoveryResult.added,
          tracksSkipped: discoveryResult.skipped,
          errors: discoveryResult.errors,
          newQueueSize: queueStatus.queueLength + discoveryResult.added,
        }));

        return {
          action: "tracks_added",
          tracksAdded: discoveryResult.added,
          newQueueSize: queueStatus.queueLength + discoveryResult.added,
          ...discoveryResult,
        };
      } else {
        await logToDatabase(ctx, logger.debug("Queue healthy, no immediate replenishment needed", {
          queueSize: queueStatus.queueLength,
          targetSize: TARGET_QUEUE_SIZE,
        }));

        return {
          action: "none",
          reason: "queue_healthy",
          queueSize: queueStatus.queueLength,
        };
      }
    });
  },
});