import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

// Define scheduled functions for radio automation
const crons = cronJobs();

// Maintain queue every 30 minutes (reduced frequency for quota efficiency)
// With larger queue size, less frequent maintenance needed
crons.interval(
  "maintain-queue",
  { minutes: 30 },
  api.queueManager.maintainQueue
);

// Post-advance queue update every 10 minutes (reduced frequency)
// Larger queue means less urgent need for immediate replenishment
crons.interval(
  "post-advance-queue-update",
  { minutes: 10 },
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
// Large batch to fill queue for the entire day
crons.cron(
  "daily-track-discovery",
  "0 6 * * *", // Daily at 6 AM
  api.queueManager.discoverAndQueueTracks,
  { count: 80, forceRefresh: true }
);

export default crons;