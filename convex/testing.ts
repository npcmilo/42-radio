import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";

// Test history fallback by clearing queue temporarily
export const testHistoryFallback = action({
  args: {},
  handler: async (ctx): Promise<any> => {
    console.log("Starting history fallback test...");
    
    // Get current queue status
    const initialStatus = await ctx.runQuery(api.radio.getQueueStatus);
    console.log("Initial queue status:", initialStatus);
    
    // Clear the queue temporarily (save tracks first)
    const queueBackup = await ctx.runQuery(api.radio.getQueue, { limit: 100 });
    console.log(`Backing up ${queueBackup.length} tracks from queue`);
    
    // Clear queue
    for (const track of queueBackup) {
      await ctx.runMutation(api.radio.removeFromQueue, { trackId: track._id });
    }
    
    // Verify queue is empty
    const emptyStatus = await ctx.runQuery(api.radio.getQueueStatus);
    console.log("Queue after clearing:", emptyStatus);
    
    // Test advancing to next track (should use history fallback)
    console.log("Testing track advancement with empty queue...");
    const result = await ctx.runMutation(api.radio.advanceToNextTrack);
    
    if (result) {
      console.log("Successfully advanced using history fallback!");
      
      // Get the new current track
      const currentTrack = await ctx.runQuery(api.radio.getCurrentTrack);
      console.log("New current track from history:", {
        title: currentTrack?.title,
        artist: currentTrack?.artist,
        discogsId: currentTrack?.discogsId,
      });
    } else {
      console.log("Failed to advance - no history available");
    }
    
    // Restore queue
    console.log("Restoring queue...");
    let restored = 0;
    for (const track of queueBackup) {
      try {
        await ctx.runMutation(api.radio.addToQueue, {
          discogsId: track.discogsId,
          title: track.title,
          artist: track.artist,
          year: track.year,
          label: track.label,
          youtubeId: track.youtubeId,
          durationSeconds: track.durationSeconds || 180,
        });
        restored++;
      } catch (e) {
        // Track might already be in queue or history
      }
    }
    
    const finalStatus = await ctx.runQuery(api.radio.getQueueStatus);
    console.log(`Restored ${restored} tracks. Final queue status:`, finalStatus);
    
    return {
      testResult: result ? "SUCCESS - History fallback working" : "FAILED - No fallback available",
      initialQueueSize: initialStatus.queueLength,
      finalQueueSize: finalStatus.queueLength,
      usedHistoryFallback: !!result,
    };
  },
});

// Get history statistics
export const getHistoryStats = query({
  args: {},
  handler: async (ctx) => {
    const history = await ctx.db.query("history").collect();
    
    const now = Date.now();
    const last24Hours = history.filter(t => now - t.playedAt < 24 * 60 * 60 * 1000);
    const last7Days = history.filter(t => now - t.playedAt < 7 * 24 * 60 * 60 * 1000);
    
    // Find tracks with replay data
    const replayedTracks = history.filter(t => t.replayCount && t.replayCount > 0);
    
    return {
      totalTracks: history.length,
      tracksLast24Hours: last24Hours.length,
      tracksLast7Days: last7Days.length,
      uniqueArtists: new Set(history.map(t => t.artist)).size,
      uniqueTitles: new Set(history.map(t => t.title)).size,
      replayedTracksCount: replayedTracks.length,
      totalReplays: replayedTracks.reduce((sum, t) => sum + (t.replayCount || 0), 0),
      oldestTrack: history.length > 0 ? {
        title: history[history.length - 1].title,
        artist: history[history.length - 1].artist,
        playedAt: new Date(history[history.length - 1].playedAt).toISOString(),
        hoursAgo: Math.floor((now - history[history.length - 1].playedAt) / (1000 * 60 * 60)),
      } : null,
      newestTrack: history.length > 0 ? {
        title: history[0].title,
        artist: history[0].artist,
        playedAt: new Date(history[0].playedAt).toISOString(),
        minutesAgo: Math.floor((now - history[0].playedAt) / (1000 * 60)),
      } : null,
    };
  },
});

// Test getting a random history track
export const testGetRandomHistoryTrack = action({
  args: {
    hoursBack: v.optional(v.number()),
    excludeRecent: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<any> => {
    const track = await ctx.runQuery(api.radio.getRandomHistoryTrack, {
      hoursBack: args.hoursBack || 24,
      excludeRecent: args.excludeRecent || 50,
    });
    
    if (track) {
      const now = Date.now();
      return {
        found: true,
        track: {
          title: track.title,
          artist: track.artist,
          discogsId: track.discogsId,
          youtubeId: track.youtubeId,
          lastPlayedAt: new Date(track.playedAt).toISOString(),
          hoursAgo: Math.floor((now - track.playedAt) / (1000 * 60 * 60)),
          replayCount: track.replayCount || 0,
        },
      };
    } else {
      return {
        found: false,
        message: "No eligible tracks found in history",
      };
    }
  },
});