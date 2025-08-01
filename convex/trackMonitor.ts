import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("track-monitor");

// Check if the current track has expired and needs advancement
export const checkAndAdvanceTrack = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    return await withTiming(ctx, logger, "check-and-advance-track", async (): Promise<any> => {
      // Get current track
      const currentTrack: any = await ctx.runQuery(api.radio.getCurrentTrack);
      
      if (!currentTrack) {
        await logToDatabase(ctx, logger.debug("No current track to monitor"));
        
        // Check if there are tracks in queue
        const queueStatus = await ctx.runQuery(api.radio.getQueueStatus);
        if (queueStatus.queueLength > 0) {
          await logToDatabase(ctx, logger.info("No current track but queue has tracks, advancing"));
          await ctx.runAction(api.radio.advanceToNextTrackWithContext);
          return { action: "advanced_from_empty", newTrack: true };
        }
        
        return { action: "none", reason: "no_current_track_no_queue" };
      }

      // Calculate if track has expired
      const now = Date.now();
      const trackStarted = currentTrack.startedAt;
      const trackDuration = (currentTrack.durationSeconds || 180) * 1000; // Default to 3 minutes if not set
      const trackEndTime = trackStarted + trackDuration;
      const timeRemaining = trackEndTime - now;

      await logToDatabase(ctx, logger.debug("Track timing check", {
        trackId: currentTrack.discogsId,
        title: currentTrack.title,
        durationSeconds: currentTrack.durationSeconds,
        startedAt: trackStarted,
        endTime: trackEndTime,
        timeRemainingMs: timeRemaining,
        hasExpired: timeRemaining <= 0,
      }));

      // If track has expired, advance to next
      if (timeRemaining <= 0) {
        await logToDatabase(ctx, logger.info("Current track has expired, advancing", {
          trackId: currentTrack.discogsId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          durationSeconds: currentTrack.durationSeconds,
          expiredBy: Math.abs(timeRemaining),
        }));

        const newTrackId: any = await ctx.runAction(api.radio.advanceToNextTrackWithContext);
        
        if (newTrackId) {
          return { 
            action: "advanced", 
            previousTrack: currentTrack.discogsId,
            newTrackId,
            expiredByMs: Math.abs(timeRemaining),
          };
        } else {
          return { 
            action: "advance_failed", 
            reason: "no_tracks_in_queue",
            previousTrack: currentTrack.discogsId,
          };
        }
      }

      // Track is still playing
      return {
        action: "none",
        reason: "track_still_playing",
        trackId: currentTrack.discogsId,
        timeRemainingMs: timeRemaining,
        timeRemainingSeconds: Math.floor(timeRemaining / 1000),
      };
    });
  },
});

// Get current track status with timing info
export const getCurrentTrackStatus = query({
  args: {},
  handler: async (ctx) => {
    const currentTrack = await ctx.db.query("currentTrack").first();
    
    if (!currentTrack) {
      return null;
    }

    const now = Date.now();
    const elapsed = now - currentTrack.startedAt;
    const duration = (currentTrack.durationSeconds || 180) * 1000; // Default to 3 minutes
    const remaining = duration - elapsed;
    const progress = elapsed / duration;
    const hasExpired = remaining <= 0;

    return {
      track: currentTrack,
      timing: {
        startedAt: currentTrack.startedAt,
        durationMs: duration,
        elapsedMs: elapsed,
        remainingMs: remaining,
        progress: Math.min(1, Math.max(0, progress)),
        hasExpired,
      },
    };
  },
});

// Force advance to next track (for debugging)
export const forceAdvance = action({
  args: {
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<any> => {
    const startTime = Date.now();
    
    try {
      await logToDatabase(ctx, logger.warn("Force advancing track", {
        reason: args.reason || "manual_force",
      }));

      const newTrackId: any = await ctx.runAction(api.radio.advanceToNextTrackWithContext);
      
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Track force advanced", {
        duration_ms: duration,
        newTrackId,
        reason: args.reason,
      }));

      return { success: true, newTrackId };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("Force advance failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});