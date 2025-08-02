import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Logger, logToDatabase } from "./logger";

const logger = new Logger("youtube-cache");

// Get cached YouTube match for a track
export const getCachedMatch = query({
  args: {
    artist: v.string(),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Normalize artist and title for consistent lookups
      const normalizedArtist = args.artist.toLowerCase().trim();
      const normalizedTitle = args.title.toLowerCase().trim();
      
      const cached = await ctx.db
        .query("youtubeCache")
        .withIndex("by_artist_title", (q) => 
          q.eq("artist", normalizedArtist).eq("title", normalizedTitle)
        )
        .first();
      
      if (cached) {
        await logToDatabase(ctx, logger.debug("Cache hit", {
          artist: args.artist,
          title: args.title,
          youtubeId: cached.youtubeId,
          cacheAge: Date.now() - cached.cachedAt,
          useCount: cached.useCount,
          duration_ms: Date.now() - startTime,
        }));
        
        return {
          videoId: cached.youtubeId,
          title: cached.videoTitle,
          channelTitle: cached.channelTitle,
          thumbnailUrl: cached.thumbnailUrl,
          durationSeconds: cached.durationSeconds,
          viewCount: cached.viewCount,
          publishedAt: cached.publishedAt,
          fromCache: true,
          cacheId: cached._id,
        };
      }
      
      await logToDatabase(ctx, logger.debug("Cache miss", {
        artist: args.artist,
        title: args.title,
        duration_ms: Date.now() - startTime,
      }));
      
      return null;
    } catch (error) {
      await logToDatabase(ctx, logger.error("Cache lookup error", {
        artist: args.artist,
        title: args.title,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      }));
      return null;
    }
  },
});

// Update cache usage statistics
export const updateCacheUsage = mutation({
  args: {
    cacheId: v.id("youtubeCache"),
  },
  handler: async (ctx, args) => {
    try {
      const cached = await ctx.db.get(args.cacheId);
      if (cached) {
        await ctx.db.patch(args.cacheId, {
          lastUsedAt: Date.now(),
          useCount: (cached.useCount || 0) + 1,
        });
      }
    } catch (error) {
      // Silently fail - cache usage tracking is not critical
    }
  },
});

// Save YouTube match to cache
export const saveToCache = mutation({
  args: {
    artist: v.string(),
    title: v.string(),
    youtubeId: v.string(),
    videoTitle: v.string(),
    channelTitle: v.string(),
    thumbnailUrl: v.string(),
    durationSeconds: v.number(),
    viewCount: v.number(),
    publishedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Normalize artist and title for consistent lookups
      const normalizedArtist = args.artist.toLowerCase().trim();
      const normalizedTitle = args.title.toLowerCase().trim();
      
      // Check if already cached
      const existing = await ctx.db
        .query("youtubeCache")
        .withIndex("by_artist_title", (q) => 
          q.eq("artist", normalizedArtist).eq("title", normalizedTitle)
        )
        .first();
      
      if (existing) {
        // Update existing cache entry
        await ctx.db.patch(existing._id, {
          youtubeId: args.youtubeId,
          videoTitle: args.videoTitle,
          channelTitle: args.channelTitle,
          thumbnailUrl: args.thumbnailUrl,
          durationSeconds: args.durationSeconds,
          viewCount: args.viewCount,
          publishedAt: args.publishedAt,
          cachedAt: Date.now(),
          lastUsedAt: Date.now(),
          useCount: existing.useCount + 1,
        });
        
        await logToDatabase(ctx, logger.debug("Cache updated", {
          artist: args.artist,
          title: args.title,
          youtubeId: args.youtubeId,
          duration_ms: Date.now() - startTime,
        }));
        
        return { action: "updated", id: existing._id };
      }
      
      // Create new cache entry
      const id = await ctx.db.insert("youtubeCache", {
        artist: normalizedArtist,
        title: normalizedTitle,
        youtubeId: args.youtubeId,
        videoTitle: args.videoTitle,
        channelTitle: args.channelTitle,
        thumbnailUrl: args.thumbnailUrl,
        durationSeconds: args.durationSeconds,
        viewCount: args.viewCount,
        publishedAt: args.publishedAt,
        cachedAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 1,
      });
      
      await logToDatabase(ctx, logger.info("Cache entry created", {
        artist: args.artist,
        title: args.title,
        youtubeId: args.youtubeId,
        duration_ms: Date.now() - startTime,
      }));
      
      return { action: "created", id };
    } catch (error) {
      await logToDatabase(ctx, logger.error("Cache save error", {
        artist: args.artist,
        title: args.title,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      }));
      throw error;
    }
  },
});

// Get cache statistics
export const getCacheStats = query({
  handler: async (ctx) => {
    const startTime = Date.now();
    
    try {
      const allEntries = await ctx.db.query("youtubeCache").collect();
      
      const totalEntries = allEntries.length;
      const totalUses = allEntries.reduce((sum, entry) => sum + (entry.useCount || 0), 0);
      const avgUsesPerEntry = totalEntries > 0 ? totalUses / totalEntries : 0;
      
      // Find most used entries
      const mostUsed = allEntries
        .sort((a, b) => (b.useCount || 0) - (a.useCount || 0))
        .slice(0, 10)
        .map(entry => ({
          artist: entry.artist,
          title: entry.title,
          youtubeId: entry.youtubeId,
          useCount: entry.useCount || 0,
        }));
      
      // Find oldest entries
      const oldestEntries = allEntries
        .sort((a, b) => a.cachedAt - b.cachedAt)
        .slice(0, 10)
        .map(entry => ({
          artist: entry.artist,
          title: entry.title,
          cachedAt: entry.cachedAt,
          ageInDays: Math.floor((Date.now() - entry.cachedAt) / (1000 * 60 * 60 * 24)),
        }));
      
      const stats = {
        totalEntries,
        totalUses,
        avgUsesPerEntry: Math.round(avgUsesPerEntry * 100) / 100,
        mostUsed,
        oldestEntries,
        cacheAgeInDays: totalEntries > 0 
          ? Math.floor((Date.now() - Math.min(...allEntries.map(e => e.cachedAt))) / (1000 * 60 * 60 * 24))
          : 0,
      };
      
      await logToDatabase(ctx, logger.debug("Cache stats retrieved", {
        ...stats,
        duration_ms: Date.now() - startTime,
      }));
      
      return stats;
    } catch (error) {
      await logToDatabase(ctx, logger.error("Cache stats error", {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      }));
      throw error;
    }
  },
});

// Clean up old cache entries (for maintenance)
export const cleanupOldCache = mutation({
  args: {
    daysToKeep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    const daysToKeep = args.daysToKeep || 90; // Default to 90 days
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    try {
      // Find old, unused entries
      const oldEntries = await ctx.db
        .query("youtubeCache")
        .withIndex("by_cached_at")
        .filter((q) => q.lt(q.field("cachedAt"), cutoffTime))
        .collect();
      
      // Only delete entries that haven't been used recently
      let deletedCount = 0;
      for (const entry of oldEntries) {
        if (entry.lastUsedAt < cutoffTime) {
          await ctx.db.delete(entry._id);
          deletedCount++;
        }
      }
      
      await logToDatabase(ctx, logger.info("Cache cleanup completed", {
        daysToKeep,
        entriesChecked: oldEntries.length,
        entriesDeleted: deletedCount,
        duration_ms: Date.now() - startTime,
      }));
      
      return {
        entriesChecked: oldEntries.length,
        entriesDeleted: deletedCount,
      };
    } catch (error) {
      await logToDatabase(ctx, logger.error("Cache cleanup error", {
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startTime,
      }));
      throw error;
    }
  },
});