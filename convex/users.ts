import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Logger, logToDatabase } from "./logger";

const logger = new Logger("user-management");

// Get or create user on first login (called from Clerk webhook or frontend)
export const getOrCreateUser = mutation({
  args: {
    clerkId: v.string(),
    role: v.optional(v.union(v.literal("listener"), v.literal("controller"))),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Check if user already exists
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
        .first();

      if (existingUser) {
        const duration = Date.now() - startTime;
        await logToDatabase(ctx, logger.debug("Existing user retrieved", {
          duration_ms: duration,
          userId: existingUser._id,
          clerkId: args.clerkId,
          role: existingUser.role,
        }));
        return existingUser;
      }

      // Create new user
      const newUserId = await ctx.db.insert("users", {
        clerkId: args.clerkId,
        role: args.role || "listener",
        preferences: {
          genreTags: ["electronic", "experimental"],
          yearRange: [1990, 2024],
          energy: "Medium",
          region: undefined,
        },
      });

      const newUser = await ctx.db.get(newUserId);
      
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("New user created", {
        duration_ms: duration,
        userId: newUserId,
        clerkId: args.clerkId,
        role: args.role || "listener",
        defaultPreferences: true,
      }));

      return newUser;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getOrCreateUser mutation failed", {
        duration_ms: duration,
        clerkId: args.clerkId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get user by Clerk ID
export const getUserByClerkId = query({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId))
        .first();

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("User lookup by clerkId", {
        duration_ms: duration,
        clerkId: args.clerkId,
        found: !!user,
        userId: user?._id,
        role: user?.role,
      }));

      return user;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getUserByClerkId query failed", {
        duration_ms: duration,
        clerkId: args.clerkId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Update user role (admin function)
export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    newRole: v.union(v.literal("listener"), v.literal("controller")),
    updatedBy: v.optional(v.id("users")), // Track who made the change
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      const oldRole = user.role;
      await ctx.db.patch(args.userId, {
        role: args.newRole,
      });

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("User role updated", {
        duration_ms: duration,
        userId: args.userId,
        clerkId: user.clerkId,
        oldRole,
        newRole: args.newRole,
        updatedBy: args.updatedBy,
      }));

      return { success: true, oldRole, newRole: args.newRole };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("updateUserRole mutation failed", {
        duration_ms: duration,
        userId: args.userId,
        newRole: args.newRole,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Update user preferences (for controllers to set vibe)
export const updateUserPreferences = mutation({
  args: {
    userId: v.id("users"),
    preferences: v.object({
      genreTags: v.array(v.string()),
      yearRange: v.tuple([v.number(), v.number()]),
      energy: v.optional(v.union(v.literal("Low"), v.literal("Medium"), v.literal("High"))),
      region: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Only controllers can update preferences for vibe control
      if (user.role !== "controller") {
        throw new Error("Only controllers can update preferences");
      }

      const oldPreferences = user.preferences;
      await ctx.db.patch(args.userId, {
        preferences: args.preferences,
      });

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("User preferences updated", {
        duration_ms: duration,
        userId: args.userId,
        clerkId: user.clerkId,
        oldPreferences,
        newPreferences: args.preferences,
        genreTags: args.preferences.genreTags,
        yearRange: args.preferences.yearRange,
        energy: args.preferences.energy,
        region: args.preferences.region,
      }));

      return { success: true };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("updateUserPreferences mutation failed", {
        duration_ms: duration,
        userId: args.userId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get current controller preferences (for track discovery)
export const getControllerPreferences = query({
  args: {},
  handler: async (ctx) => {
    const startTime = Date.now();
    
    try {
      const controller = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("role"), "controller"))
        .first();

      if (!controller || !controller.preferences) {
        // Return default preferences if no controller found
        const defaultPrefs = {
          genreTags: ["electronic", "experimental"],
          yearRange: [1990, 2024] as [number, number],
          energy: "Medium" as const,
          region: undefined,
        };

        const duration = Date.now() - startTime;
        await logToDatabase(ctx, logger.warn("No controller found, using default preferences", {
          duration_ms: duration,
          defaultPreferences: defaultPrefs,
        }));

        return defaultPrefs;
      }

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("Controller preferences retrieved", {
        duration_ms: duration,
        controllerId: controller._id,
        preferences: controller.preferences,
      }));

      return controller.preferences;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getControllerPreferences query failed", {
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Record user feedback on tracks
export const recordFeedback = mutation({
  args: {
    userId: v.id("users"),
    discogsId: v.string(),
    type: v.union(v.literal("like"), v.literal("skip")),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Check if feedback already exists for this user/track combo
      const existingFeedback = await ctx.db
        .query("feedback")
        .withIndex("by_user_and_track", (q) => 
          q.eq("userId", args.userId).eq("discogsId", args.discogsId)
        )
        .first();

      if (existingFeedback) {
        // Update existing feedback
        await ctx.db.patch(existingFeedback._id, {
          type: args.type,
          createdAt: Date.now(),
        });

        const duration = Date.now() - startTime;
        await logToDatabase(ctx, logger.info("User feedback updated", {
          duration_ms: duration,
          userId: args.userId,
          discogsId: args.discogsId,
          oldType: existingFeedback.type,
          newType: args.type,
        }));
      } else {
        // Create new feedback
        const feedbackId = await ctx.db.insert("feedback", {
          userId: args.userId,
          discogsId: args.discogsId,
          type: args.type,
          createdAt: Date.now(),
        });

        const duration = Date.now() - startTime;
        await logToDatabase(ctx, logger.info("User feedback recorded", {
          duration_ms: duration,
          feedbackId,
          userId: args.userId,
          discogsId: args.discogsId,
          type: args.type,
        }));
      }

      return { success: true };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("recordFeedback mutation failed", {
        duration_ms: duration,
        userId: args.userId,
        discogsId: args.discogsId,
        type: args.type,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get user statistics
export const getUserStats = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Count user's feedback
      const feedback = await ctx.db
        .query("feedback")
        .filter((q) => q.eq(q.field("userId"), args.userId))
        .collect();

      const likes = feedback.filter(f => f.type === "like").length;
      const skips = feedback.filter(f => f.type === "skip").length;

      const stats = {
        role: user.role,
        totalFeedback: feedback.length,
        likes,
        skips,
        joinedAt: user._creationTime,
        hasPreferences: !!user.preferences,
      };

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("User stats retrieved", {
        duration_ms: duration,
        userId: args.userId,
        stats,
      }));

      return stats;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getUserStats query failed", {
        duration_ms: duration,
        userId: args.userId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});