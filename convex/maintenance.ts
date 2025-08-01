import { v } from "convex/values";
import { action, mutation } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("maintenance");

// Clean up old logs to prevent database bloat
export const cleanupOldLogs = action({
  args: {
    daysToKeep: v.optional(v.number()),
    maxLogsToDelete: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ deleted: number; remaining: number; cutoffTime?: number; }> => {
    return await withTiming(ctx, logger, "cleanup-old-logs", async (): Promise<{ deleted: number; remaining: number; cutoffTime?: number; }> => {
      const daysToKeep = args.daysToKeep || 7; // Keep 7 days by default
      const maxLogsToDelete = args.maxLogsToDelete || 10000; // Safety limit
      
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      await logToDatabase(ctx, logger.info("Starting log cleanup", {
        daysToKeep,
        cutoffTime,
        maxLogsToDelete,
      }));

      // Get old logs in batches
      const oldLogs: any[] = await ctx.runQuery(api.logger.getLogs, {
        limit: maxLogsToDelete,
        since: 0, // From beginning of time
      });

      const logsToDelete = oldLogs.filter((log: any) => log.timestamp < cutoffTime);

      if (logsToDelete.length === 0) {
        await logToDatabase(ctx, logger.info("No old logs to cleanup", {
          totalLogs: oldLogs.length,
          cutoffTime,
        }));
        return { deleted: 0, remaining: oldLogs.length };
      }

      // Delete logs in batches
      let deletedCount = 0;
      const batchSize = 100;

      for (let i = 0; i < logsToDelete.length; i += batchSize) {
        const batch = logsToDelete.slice(i, i + batchSize);
        
        for (const log of batch) {
          try {
            await ctx.runMutation(api.maintenance.deleteLog, { logId: log._id });
            deletedCount++;
          } catch (error) {
            await logToDatabase(ctx, logger.error("Failed to delete log", {
              logId: log._id,
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }

        // Small delay between batches to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await logToDatabase(ctx, logger.info("Log cleanup completed", {
        deletedCount,
        remainingLogs: oldLogs.length - deletedCount,
        daysToKeep,
      }));

      return {
        deleted: deletedCount,
        remaining: oldLogs.length - deletedCount,
        cutoffTime,
      };
    }, {
      daysToKeep: args.daysToKeep,
      maxLogsToDelete: args.maxLogsToDelete,
    });
  },
});

// Helper mutation to delete a single log entry
export const deleteLog = mutation({
  args: {
    logId: v.id("logs"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.logId);
  },
});

// Clean up old history entries to prevent database bloat
export const cleanupOldHistory = action({
  args: {
    daysToKeep: v.optional(v.number()),
    maxHistoryToDelete: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ deleted: number; remaining: number; cutoffTime?: number; }> => {
    return await withTiming(ctx, logger, "cleanup-old-history", async (): Promise<{ deleted: number; remaining: number; cutoffTime?: number; }> => {
      const daysToKeep = args.daysToKeep || 30; // Keep 30 days by default
      const maxHistoryToDelete = args.maxHistoryToDelete || 5000; // Safety limit
      
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

      await logToDatabase(ctx, logger.info("Starting history cleanup", {
        daysToKeep,
        cutoffTime,
        maxHistoryToDelete,
      }));

      // Get old history entries
      const oldHistory: any[] = await ctx.runQuery(api.radio.getTrackHistory, {
        limit: maxHistoryToDelete,
      });

      const historyToDelete = oldHistory.filter((entry: any) => entry.playedAt < cutoffTime);

      if (historyToDelete.length === 0) {
        await logToDatabase(ctx, logger.info("No old history to cleanup", {
          totalHistory: oldHistory.length,
          cutoffTime,
        }));
        return { deleted: 0, remaining: oldHistory.length };
      }

      // Delete history entries
      let deletedCount = 0;

      for (const entry of historyToDelete) {
        try {
          await ctx.runMutation(api.maintenance.deleteHistoryEntry, { entryId: entry._id });
          deletedCount++;
        } catch (error) {
          await logToDatabase(ctx, logger.error("Failed to delete history entry", {
            entryId: entry._id,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      await logToDatabase(ctx, logger.info("History cleanup completed", {
        deletedCount,
        remainingHistory: oldHistory.length - deletedCount,
        daysToKeep,
      }));

      return {
        deleted: deletedCount,
        remaining: oldHistory.length - deletedCount,
        cutoffTime,
      };
    }, {
      daysToKeep: args.daysToKeep,
      maxHistoryToDelete: args.maxHistoryToDelete,
    });
  },
});

// Helper mutation to delete a single history entry
export const deleteHistoryEntry = mutation({
  args: {
    entryId: v.id("history"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.entryId);
  },
});

// System health check
export const systemHealthCheck = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "system-health-check", async () => {
      const checks = {
        timestamp: Date.now(),
        database: { healthy: true, message: "OK" },
        queue: { healthy: true, message: "OK", size: 0 },
        currentTrack: { healthy: true, message: "OK", hasTrack: false },
        apis: {
          discogs: { healthy: true, message: "Not tested" },
          youtube: { healthy: true, message: "Not tested" },
        },
        logs: { healthy: true, message: "OK", recentErrors: 0 },
      };

      try {
        // Check queue health
        const queueHealth = await ctx.runAction(api.queueManager.getQueueHealth);
        checks.queue = {
          healthy: queueHealth.isHealthy,
          message: queueHealth.isHealthy ? "OK" : "Queue needs attention",
          size: queueHealth.queueLength,
        };

        checks.currentTrack = {
          healthy: queueHealth.hasCurrentTrack,
          message: queueHealth.hasCurrentTrack ? "OK" : "No current track",
          hasTrack: queueHealth.hasCurrentTrack,
        };

        // Check for recent errors in logs
        const recentErrors = await ctx.runQuery(api.logger.getRecentErrors, {
          since: Date.now() - (60 * 60 * 1000), // Last hour
          limit: 10,
        });

        checks.logs = {
          healthy: recentErrors.length < 5, // Less than 5 errors in last hour is OK
          message: `${recentErrors.length} errors in last hour`,
          recentErrors: recentErrors.length,
        };

        // Overall health
        const allHealthy = Object.values(checks).every(check => 
          typeof check === 'object' && 'healthy' in check ? check.healthy : true
        );

        await logToDatabase(ctx, logger.info("System health check completed", {
          overallHealthy: allHealthy,
          checks,
        }));

        return {
          healthy: allHealthy,
          checks,
          timestamp: checks.timestamp,
        };

      } catch (error) {
        checks.database = {
          healthy: false,
          message: error instanceof Error ? error.message : String(error),
        };

        await logToDatabase(ctx, logger.error("System health check failed", {
          error: error instanceof Error ? error.message : String(error),
          checks,
        }));

        return {
          healthy: false,
          checks,
          timestamp: checks.timestamp,
        };
      }
    });
  },
});

// Get system statistics
export const getSystemStats = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "system-stats", async () => {
      const stats = {
        timestamp: Date.now(),
        queue: {
          length: 0,
          estimatedPlaytimeMinutes: 0,
        },
        history: {
          totalTracks: 0,
          uniqueTracks: 0,
        },
        users: {
          total: 0,
          controllers: 0,
          listeners: 0,
        },
        feedback: {
          totalLikes: 0,
          totalSkips: 0,
        },
        logs: {
          totalLogs: 0,
          recentErrors: 0,
        },
      };

      try {
        // Queue stats
        const queueHealth = await ctx.runAction(api.queueManager.getQueueHealth);
        stats.queue = {
          length: queueHealth.queueLength,
          estimatedPlaytimeMinutes: queueHealth.estimatedPlaytimeMinutes,
        };

        // Get more detailed stats by querying the database
        // Note: In a real app, you might want to cache these or run them less frequently
        
        await logToDatabase(ctx, logger.info("System statistics generated", {
          stats,
        }));

        return stats;

      } catch (error) {
        await logToDatabase(ctx, logger.error("Failed to generate system stats", {
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    });
  },
});