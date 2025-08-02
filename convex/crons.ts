import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

// Define scheduled functions for radio automation
const crons = cronJobs();

// Maintain queue every 2 hours (with 500 track capacity, less frequent checks needed)
crons.interval(
  "maintain-queue",
  { hours: 2 },
  api.queueManager.maintainQueue
);

// Post-advance queue update every 30 minutes (reduced frequency)
// With larger queue, replenishment is less urgent
crons.interval(
  "post-advance-queue-update",
  { minutes: 30 },
  api.radio.postAdvanceQueueUpdate
);

// Health check every 5 minutes (reduced frequency)
crons.interval(
  "queue-health-check", 
  { minutes: 5 },
  api.queueManager.getQueueHealth
);

// Check if current track has expired every 30 seconds
// Ensures tracks advance automatically when they end
crons.interval(
  "track-expiration-check",
  { seconds: 30 },
  api.trackMonitor.checkAndAdvanceTrack
);

// Clean up old logs every day at 3 AM
crons.cron(
  "cleanup-old-logs",
  "0 3 * * *", // Daily at 3 AM
  api.maintenance.cleanupOldLogs,
  {}
);

// Major queue replenishment 4 times a day
// Large batches to minimize API calls
crons.cron(
  "morning-track-discovery",
  "0 6 * * *", // 6 AM
  api.queueManager.discoverAndQueueTracks,
  { count: 200, forceRefresh: true }
);

crons.cron(
  "noon-track-discovery",
  "0 12 * * *", // 12 PM
  api.queueManager.discoverAndQueueTracks,
  { count: 150 }
);

crons.cron(
  "evening-track-discovery",
  "0 18 * * *", // 6 PM
  api.queueManager.discoverAndQueueTracks,
  { count: 150 }
);

crons.cron(
  "night-track-discovery",
  "0 0 * * *", // Midnight
  api.queueManager.discoverAndQueueTracks,
  { count: 200 }
);

// Clean up old YouTube cache weekly
crons.cron(
  "cleanup-youtube-cache",
  "0 4 * * 0", // Weekly at 4 AM on Sunday
  api.youtubeCache.cleanupOldCache,
  { daysToKeep: 90 }
);

// Reset YouTube API key quotas daily at midnight Pacific Time
crons.cron(
  "reset-youtube-api-quotas",
  "0 0 * * *", // Daily at midnight PT
  api.youtubeApiKeyPool.resetDailyQuota,
  {}
);

// Clean up old API usage records monthly
crons.cron(
  "cleanup-api-usage-records",
  "0 2 1 * *", // Monthly at 2 AM on the 1st
  api.youtubeApiKeyPool.cleanupOldUsageRecords,
  { daysToKeep: 30 }
);

export default crons;