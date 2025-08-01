import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

// Define scheduled functions for radio automation
const crons = cronJobs();

// Maintain queue every 5 minutes
// Ensures we always have enough tracks queued up
crons.interval(
  "maintain-queue",
  { minutes: 5 },
  api.queueManager.maintainQueue
);

// Post-advance queue update every minute
// Ensures queue is immediately replenished after track changes
crons.interval(
  "post-advance-queue-update",
  { minutes: 1 },
  api.radio.postAdvanceQueueUpdate
);

// Health check every minute
// Quick check to ensure system is running properly
crons.interval(
  "queue-health-check", 
  { minutes: 1 },
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
// Keeps the logs table from growing too large
crons.cron(
  "cleanup-old-logs",
  "0 3 * * *", // Daily at 3 AM
  api.maintenance.cleanupOldLogs,
  {}
);

// Daily discovery refresh at 6 AM
// Ensures we have a good variety of fresh tracks
crons.cron(
  "daily-track-discovery",
  "0 6 * * *", // Daily at 6 AM
  api.queueManager.discoverAndQueueTracks,
  { count: 20, forceRefresh: true }
);

export default crons;