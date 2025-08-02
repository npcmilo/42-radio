import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("youtube-api-key-pool");

// YouTube API quota costs per operation
const QUOTA_COSTS = {
  SEARCH: 100,      // search.list
  VIDEO_DETAILS: 1, // videos.list (for details)
  BATCH_VIDEO_DETAILS: 1, // videos.list (for up to 50 videos)
};

// Configuration for API key pool
const API_KEY_CONFIG = {
  DAILY_QUOTA_LIMIT: 10000, // YouTube API default quota per project
  KEYS: [
    { id: "key1", env: "YOUTUBE_API_KEY" },
    { id: "key2", env: "YOUTUBE_API_KEY_2" },
  ],
};

// Get Pacific Time date string (YouTube quota resets at midnight PT)
function getPacificTimeDate(): string {
  const now = new Date();
  const pacificTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  return pacificTime.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Get current Pacific Time midnight timestamp for quota reset
function getPacificTimeMidnight(): number {
  const today = getPacificTimeDate();
  const midnight = new Date(`${today}T00:00:00-08:00`); // PST/PDT
  return midnight.getTime();
}

// Get API key usage for today
export const getKeyUsageToday = query({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const today = getPacificTimeDate();
    
    const usage = await ctx.db
      .query("youtubeApiUsage")
      .withIndex("by_key_and_date", (q) => 
        q.eq("keyId", args.keyId).eq("date", today)
      )
      .first();
    
    return usage || {
      keyId: args.keyId,
      date: today,
      quotaUsed: 0,
      callsSuccessful: 0,
      callsFailed: 0,
      quotaExhausted: false,
      lastQuotaReset: getPacificTimeMidnight(),
      createdAt: Date.now(),
      lastUpdatedAt: Date.now(),
    };
  },
});

// Update API key usage statistics
export const updateKeyUsage = mutation({
  args: {
    keyId: v.string(),
    quotaCost: v.number(),
    success: v.boolean(),
    errorCode: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const today = getPacificTimeDate();
    
    const existing = await ctx.db
      .query("youtubeApiUsage")
      .withIndex("by_key_and_date", (q) => 
        q.eq("keyId", args.keyId).eq("date", today)
      )
      .first();
    
    const now = Date.now();
    const quotaExhausted = args.errorCode === 403 || (existing?.quotaExhausted === true && !args.success);
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        quotaUsed: existing.quotaUsed + args.quotaCost,
        callsSuccessful: existing.callsSuccessful + (args.success ? 1 : 0),
        callsFailed: existing.callsFailed + (args.success ? 0 : 1),
        quotaExhausted: quotaExhausted || (existing.quotaExhausted === true),
        lastUpdatedAt: now,
      });
    } else {
      await ctx.db.insert("youtubeApiUsage", {
        keyId: args.keyId,
        date: today,
        quotaUsed: args.quotaCost,
        callsSuccessful: args.success ? 1 : 0,
        callsFailed: args.success ? 0 : 1,
        quotaExhausted: quotaExhausted,
        lastQuotaReset: getPacificTimeMidnight(),
        createdAt: now,
        lastUpdatedAt: now,
      });
    }
    
    return { updated: true, quotaExhausted };
  },
});

// Get the best available API key for use
export const getBestAvailableKey = action({
  args: {
    operation: v.union(v.literal("search"), v.literal("video_details"), v.literal("batch_video_details")),
  },
  handler: async (ctx, args): Promise<{
    keyId: string;
    apiKey: string;
    quotaRemaining: number;
    quotaUsed: number;
  }> => {
    return await withTiming(ctx, logger, "get-best-available-key", async (): Promise<{
      keyId: string;
      apiKey: string;
      quotaRemaining: number;
      quotaUsed: number;
    }> => {
      const quotaCost = QUOTA_COSTS[args.operation.toUpperCase() as keyof typeof QUOTA_COSTS] || 100;
      
      await logToDatabase(ctx, logger.debug("Finding best available API key", {
        operation: args.operation,
        quotaCost,
      }));

      // Check usage for all keys
      const keyUsages = [];
      for (const keyConfig of API_KEY_CONFIG.KEYS) {
        const usage: any = await ctx.runQuery(api.youtubeApiKeyPool.getKeyUsageToday, {
          keyId: keyConfig.id,
        });
        
        const apiKey = process.env[keyConfig.env];
        if (!apiKey) {
          await logToDatabase(ctx, logger.warn("API key not configured", {
            keyId: keyConfig.id,
            envVar: keyConfig.env,
          }));
          continue;
        }
        
        keyUsages.push({
          ...keyConfig,
          usage,
          apiKey,
          canUse: !usage.quotaExhausted && (usage.quotaUsed + quotaCost) <= API_KEY_CONFIG.DAILY_QUOTA_LIMIT,
        });
      }

      // Filter to available keys
      const availableKeys: any[] = keyUsages.filter((k: any) => k.canUse);
      
      if (availableKeys.length === 0) {
        await logToDatabase(ctx, logger.error("All API keys exhausted", {
          operation: args.operation,
          quotaCost,
          keyUsages: keyUsages.map(k => ({
            keyId: k.id,
            quotaUsed: k.usage.quotaUsed,
            quotaExhausted: k.usage.quotaExhausted,
          })),
        }));
        throw new Error("All YouTube API keys have exhausted their daily quota");
      }

      // Select key with lowest usage
      const bestKey: any = availableKeys.reduce((best: any, current: any) => 
        current.usage.quotaUsed < best.usage.quotaUsed ? current : best
      );

      await logToDatabase(ctx, logger.info("Selected API key", {
        keyId: bestKey.id,
        operation: args.operation,
        quotaUsed: bestKey.usage.quotaUsed,
        quotaRemaining: API_KEY_CONFIG.DAILY_QUOTA_LIMIT - bestKey.usage.quotaUsed,
        availableKeysCount: availableKeys.length,
      }));

      return {
        keyId: bestKey.id,
        apiKey: bestKey.apiKey,
        quotaUsed: bestKey.usage.quotaUsed,
        quotaRemaining: API_KEY_CONFIG.DAILY_QUOTA_LIMIT - bestKey.usage.quotaUsed,
      };
    });
  },
});

// Get usage statistics for all API keys
export const getAllKeyUsage = query({
  args: {},
  handler: async (ctx) => {
    const today = getPacificTimeDate();
    const keyUsages = [];
    
    for (const keyConfig of API_KEY_CONFIG.KEYS) {
      const usage = await ctx.db
        .query("youtubeApiUsage")
        .withIndex("by_key_and_date", (q) => 
          q.eq("keyId", keyConfig.id).eq("date", today)
        )
        .first();
      
      keyUsages.push({
        keyId: keyConfig.id,
        configured: !!process.env[keyConfig.env],
        usage: usage || {
          quotaUsed: 0,
          callsSuccessful: 0,
          callsFailed: 0,
          quotaExhausted: false,
        },
        quotaRemaining: API_KEY_CONFIG.DAILY_QUOTA_LIMIT - (usage?.quotaUsed || 0),
        utilizationPercent: Math.round(((usage?.quotaUsed || 0) / API_KEY_CONFIG.DAILY_QUOTA_LIMIT) * 100),
      });
    }
    
    const totalQuotaUsed = keyUsages.reduce((sum, k) => sum + k.usage.quotaUsed, 0);
    const totalQuotaAvailable = keyUsages.length * API_KEY_CONFIG.DAILY_QUOTA_LIMIT;
    const availableKeys = keyUsages.filter(k => k.configured && !k.usage.quotaExhausted);
    
    return {
      keys: keyUsages,
      summary: {
        totalKeys: API_KEY_CONFIG.KEYS.length,
        configuredKeys: keyUsages.filter(k => k.configured).length,
        availableKeys: availableKeys.length,
        exhaustedKeys: keyUsages.filter(k => k.usage.quotaExhausted).length,
        totalQuotaUsed,
        totalQuotaAvailable,
        totalQuotaRemaining: totalQuotaAvailable - totalQuotaUsed,
        overallUtilization: Math.round((totalQuotaUsed / totalQuotaAvailable) * 100),
      },
      date: today,
      lastUpdated: Date.now(),
    };
  },
});

// Clean up old usage records (keep 30 days)
export const cleanupOldUsageRecords = mutation({
  args: {
    daysToKeep: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const daysToKeep = args.daysToKeep || 30;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];
    
    const oldRecords = await ctx.db
      .query("youtubeApiUsage")
      .withIndex("by_date")
      .filter((q) => q.lt(q.field("date"), cutoffDateStr))
      .collect();
    
    let deletedCount = 0;
    for (const record of oldRecords) {
      await ctx.db.delete(record._id);
      deletedCount++;
    }
    
    return {
      deletedCount,
      cutoffDate: cutoffDateStr,
      daysKept: daysToKeep,
    };
  },
});

// Reset quota usage for new day (called by cron)
export const resetDailyQuota = mutation({
  args: {},
  handler: async (ctx) => {
    const today = getPacificTimeDate();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    // Mark all keys as available for today if they don't have records yet
    let resetCount = 0;
    for (const keyConfig of API_KEY_CONFIG.KEYS) {
      const todayUsage = await ctx.db
        .query("youtubeApiUsage")
        .withIndex("by_key_and_date", (q) => 
          q.eq("keyId", keyConfig.id).eq("date", today)
        )
        .first();
      
      if (!todayUsage) {
        await ctx.db.insert("youtubeApiUsage", {
          keyId: keyConfig.id,
          date: today,
          quotaUsed: 0,
          callsSuccessful: 0,
          callsFailed: 0,
          quotaExhausted: false,
          lastQuotaReset: getPacificTimeMidnight(),
          createdAt: Date.now(),
          lastUpdatedAt: Date.now(),
        });
        resetCount++;
      }
    }
    
    return {
      resetCount,
      date: today,
      message: `Reset quota for ${resetCount} API keys`,
    };
  },
});