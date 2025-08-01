import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// Log levels for filtering and alerting
export type LogLevel = "debug" | "info" | "warn" | "error";

// Logger interface for structured logging
export interface LogEntry {
  level: LogLevel;
  component: string;
  message: string;
  metadata?: any;
  userId?: Id<"users">;
  trackId?: string;
}

// Internal mutation to write logs to database
export const writeLog = mutation({
  args: {
    level: v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error")),
    component: v.string(),
    message: v.string(),
    metadata: v.optional(v.any()),
    userId: v.optional(v.id("users")),
    trackId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("logs", {
      timestamp: Date.now(),
      level: args.level,
      component: args.component,
      message: args.message,
      metadata: args.metadata,
      userId: args.userId,
      trackId: args.trackId,
    });
  },
});

// Query to retrieve logs with filtering
export const getLogs = query({
  args: {
    level: v.optional(v.union(v.literal("debug"), v.literal("info"), v.literal("warn"), v.literal("error"))),
    component: v.optional(v.string()),
    limit: v.optional(v.number()),
    since: v.optional(v.number()), // timestamp
  },
  handler: async (ctx, args) => {
    let logsQuery = ctx.db.query("logs");

    // Filter by level if specified
    if (args.level) {
      logsQuery = logsQuery.withIndex("by_level", (q) => q.eq("level", args.level));
    }

    // Filter by component if specified
    if (args.component) {
      logsQuery = logsQuery.withIndex("by_component", (q) => q.eq("component", args.component));
    }

    // Filter by timestamp if specified
    if (args.since) {
      logsQuery = logsQuery.withIndex("by_timestamp", (q) => q.gte("timestamp", args.since));
    }

    // Order by most recent first and limit results
    const logs = await logsQuery
      .order("desc")
      .take(args.limit || 100);

    return logs;
  },
});

// Query to get recent errors for monitoring
export const getRecentErrors = query({
  args: {
    since: v.optional(v.number()), // timestamp, defaults to last 24 hours
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.since || (Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    const errors = await ctx.db
      .query("logs")
      .withIndex("by_level_and_timestamp", (q) => 
        q.eq("level", "error").gte("timestamp", since)
      )
      .order("desc")
      .take(args.limit || 50);

    return errors;
  },
});

// Utility class for structured logging throughout the application
export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  // Create a log entry object
  private createLogEntry(
    level: LogLevel,
    message: string,
    metadata?: any,
    userId?: Id<"users">,
    trackId?: string
  ): LogEntry {
    return {
      level,
      component: this.component,
      message,
      metadata,
      userId,
      trackId,
    };
  }

  // Debug level logging
  debug(message: string, metadata?: any, userId?: Id<"users">, trackId?: string): LogEntry {
    return this.createLogEntry("debug", message, metadata, userId, trackId);
  }

  // Info level logging
  info(message: string, metadata?: any, userId?: Id<"users">, trackId?: string): LogEntry {
    return this.createLogEntry("info", message, metadata, userId, trackId);
  }

  // Warning level logging
  warn(message: string, metadata?: any, userId?: Id<"users">, trackId?: string): LogEntry {
    return this.createLogEntry("warn", message, metadata, userId, trackId);
  }

  // Error level logging
  error(message: string, metadata?: any, userId?: Id<"users">, trackId?: string): LogEntry {
    return this.createLogEntry("error", message, metadata, userId, trackId);
  }

  // Performance timing helper
  time(label: string): () => LogEntry {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      return this.info(`${label} completed`, { duration_ms: duration });
    };
  }
}

// Helper function to log to database from any Convex function
export async function logToDatabase(
  ctx: any, // MutationCtx or ActionCtx
  logEntry: LogEntry
): Promise<void> {
  try {
    if (ctx.runMutation) {
      // Called from an action
      await ctx.runMutation(writeLog, logEntry);
    } else {
      // Called from a mutation
      await writeLog(ctx, logEntry);
    }
  } catch (error) {
    // Fallback to console if database logging fails
    console.error("Failed to write log to database:", error);
    console.log("Original log:", logEntry);
  }
}

// Performance monitoring helper
export async function withTiming<T>(
  ctx: any,
  logger: Logger,
  label: string,
  operation: () => Promise<T>,
  metadata?: any
): Promise<T> {
  const stopTimer = logger.time(label);
  const startTime = Date.now();
  
  try {
    const result = await operation();
    const logEntry = stopTimer();
    await logToDatabase(ctx, {
      ...logEntry,
      metadata: { ...logEntry.metadata, ...metadata, success: true },
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const logEntry = logger.error(`${label} failed`, {
      duration_ms: duration,
      error: error instanceof Error ? error.message : String(error),
      ...metadata,
    });
    await logToDatabase(ctx, logEntry);
    throw error;
  }
}