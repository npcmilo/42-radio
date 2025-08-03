import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Logger, logToDatabase } from "./logger";

const logger = new Logger("user-management");

// Get user by ID
export const getUserById = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

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
          genreTags: ["house"],
          yearRange: [2000, 2010],
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
      yearRange: v.array(v.number()),
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
          genreTags: ["house"],
          yearRange: [2000, 2010],
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

// Toggle like status for a track (enhanced version)
export const toggleLike = mutation({
  args: {
    userId: v.id("users"),
    trackInfo: v.object({
      discogsId: v.string(),
      title: v.string(),
      artist: v.string(),
      youtubeId: v.string(),
      year: v.optional(v.number()),
      label: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Get user to check role
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Check existing feedback
      const existingFeedback = await ctx.db
        .query("feedback")
        .withIndex("by_user_and_track", (q) => 
          q.eq("userId", args.userId).eq("discogsId", args.trackInfo.discogsId)
        )
        .first();

      const wasLiked = existingFeedback?.type === "like";
      const isNowLiked = !wasLiked;

      // Update or create feedback
      if (existingFeedback) {
        if (wasLiked) {
          // Unlike: remove the feedback entry
          await ctx.db.delete(existingFeedback._id);
        } else {
          // Change from skip to like
          await ctx.db.patch(existingFeedback._id, {
            type: "like",
            createdAt: Date.now(),
          });
        }
      } else {
        // Create new like feedback
        await ctx.db.insert("feedback", {
          userId: args.userId,
          discogsId: args.trackInfo.discogsId,
          type: "like",
          createdAt: Date.now(),
        });
      }

      // Handle saved tracks for controllers
      if (user.role === "controller") {
        const existingSaved = await ctx.db
          .query("savedTracks")
          .withIndex("by_user_and_track", (q) =>
            q.eq("userId", args.userId).eq("discogsId", args.trackInfo.discogsId)
          )
          .first();

        if (isNowLiked && !existingSaved) {
          // Add to saved tracks
          await ctx.db.insert("savedTracks", {
            userId: args.userId,
            discogsId: args.trackInfo.discogsId,
            title: args.trackInfo.title,
            artist: args.trackInfo.artist,
            youtubeId: args.trackInfo.youtubeId,
            year: args.trackInfo.year,
            label: args.trackInfo.label,
            savedAt: Date.now(),
          });
        } else if (!isNowLiked && existingSaved) {
          // Remove from saved tracks
          await ctx.db.delete(existingSaved._id);
        }
      }

      // Update history table's likedBy array
      const historyEntries = await ctx.db
        .query("history")
        .withIndex("by_discogsId", (q) => q.eq("discogsId", args.trackInfo.discogsId))
        .collect();

      for (const entry of historyEntries) {
        const likedBy = entry.likedBy || [];
        const userIndex = likedBy.indexOf(args.userId);
        
        if (isNowLiked && userIndex === -1) {
          // Add user to likedBy
          likedBy.push(args.userId);
          await ctx.db.patch(entry._id, { likedBy });
        } else if (!isNowLiked && userIndex !== -1) {
          // Remove user from likedBy
          likedBy.splice(userIndex, 1);
          await ctx.db.patch(entry._id, { likedBy });
        }
      }

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Track like toggled", {
        duration_ms: duration,
        userId: args.userId,
        discogsId: args.trackInfo.discogsId,
        wasLiked,
        isNowLiked,
        isController: user.role === "controller",
        savedToLibrary: user.role === "controller" && isNowLiked,
      }));

      return { 
        success: true, 
        isLiked: isNowLiked,
        savedToLibrary: user.role === "controller" && isNowLiked,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("toggleLike mutation failed", {
        duration_ms: duration,
        userId: args.userId,
        discogsId: args.trackInfo.discogsId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Record user feedback on tracks (kept for backwards compatibility)
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

// Check if a track is liked by a user
export const isTrackLiked = query({
  args: {
    userId: v.id("users"),
    discogsId: v.string(),
  },
  handler: async (ctx, args) => {
    const feedback = await ctx.db
      .query("feedback")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", args.userId).eq("discogsId", args.discogsId)
      )
      .first();
    
    return feedback?.type === "like";
  },
});

// Get user's saved tracks
export const getUserSavedTracks = query({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      // Only controllers have saved tracks
      if (user.role !== "controller") {
        return [];
      }

      const savedTracks = await ctx.db
        .query("savedTracks")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .take(args.limit || 100);

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.debug("Retrieved saved tracks", {
        duration_ms: duration,
        userId: args.userId,
        count: savedTracks.length,
      }));

      return savedTracks;
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("getUserSavedTracks query failed", {
        duration_ms: duration,
        userId: args.userId,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get like count for a track
export const getTrackLikeCount = query({
  args: {
    discogsId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get from feedback table
    const likes = await ctx.db
      .query("feedback")
      .filter((q) => 
        q.and(
          q.eq(q.field("discogsId"), args.discogsId),
          q.eq(q.field("type"), "like")
        )
      )
      .collect();
    
    return likes.length;
  },
});

// Toggle thumbs rating for a track (separate from like/save system)
export const toggleThumbsRating = mutation({
  args: {
    userId: v.id("users"),
    trackInfo: v.object({
      discogsId: v.string(),
      title: v.string(),
      artist: v.string(),
      youtubeId: v.string(),
      year: v.optional(v.number()),
      label: v.optional(v.string()),
    }),
    rating: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, args) => {
    const startTime = Date.now();
    
    try {
      // Get user to verify they exist
      const user = await ctx.db.get(args.userId);
      if (!user) {
        throw new Error("User not found");
      }

      const ratingType = args.rating === "up" ? "thumbs_up" : "thumbs_down";
      const oppositeType = args.rating === "up" ? "thumbs_down" : "thumbs_up";

      // Check existing thumbs rating (only for thumbs up/down, not like/skip)
      const existingThumbsRating = await ctx.db
        .query("feedback")
        .withIndex("by_user_and_track", (q) => 
          q.eq("userId", args.userId).eq("discogsId", args.trackInfo.discogsId)
        )
        .filter((q) => 
          q.or(
            q.eq(q.field("type"), "thumbs_up"),
            q.eq(q.field("type"), "thumbs_down")
          )
        )
        .first();

      const hadSameRating = existingThumbsRating?.type === ratingType;
      const hadOppositeRating = existingThumbsRating?.type === oppositeType;

      if (existingThumbsRating) {
        if (hadSameRating) {
          // Remove the existing rating (toggle off)
          await ctx.db.delete(existingThumbsRating._id);
        } else {
          // Switch to the new rating
          await ctx.db.patch(existingThumbsRating._id, {
            type: ratingType,
            createdAt: Date.now(),
          });
        }
      } else {
        // Create new thumbs rating
        await ctx.db.insert("feedback", {
          userId: args.userId,
          discogsId: args.trackInfo.discogsId,
          type: ratingType,
          createdAt: Date.now(),
        });
      }

      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.info("Thumbs rating toggled", {
        duration_ms: duration,
        userId: args.userId,
        discogsId: args.trackInfo.discogsId,
        rating: args.rating,
        hadSameRating,
        hadOppositeRating,
        newState: hadSameRating ? "none" : ratingType,
      }));

      return { 
        success: true, 
        rating: hadSameRating ? null : args.rating,
        previousRating: existingThumbsRating?.type || null,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await logToDatabase(ctx, logger.error("toggleThumbsRating mutation failed", {
        duration_ms: duration,
        userId: args.userId,
        discogsId: args.trackInfo.discogsId,
        rating: args.rating,
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    }
  },
});

// Get aggregate thumbs up/down counts for a track
export const getTrackRating = query({
  args: {
    discogsId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all thumbs ratings for this track
    const thumbsRatings = await ctx.db
      .query("feedback")
      .filter((q) => 
        q.and(
          q.eq(q.field("discogsId"), args.discogsId),
          q.or(
            q.eq(q.field("type"), "thumbs_up"),
            q.eq(q.field("type"), "thumbs_down")
          )
        )
      )
      .collect();
    
    const thumbsUp = thumbsRatings.filter(r => r.type === "thumbs_up").length;
    const thumbsDown = thumbsRatings.filter(r => r.type === "thumbs_down").length;
    
    return { thumbsUp, thumbsDown, total: thumbsUp + thumbsDown };
  },
});

// Get user's current thumbs rating for a track
export const getUserTrackRating = query({
  args: {
    userId: v.id("users"),
    discogsId: v.string(),
  },
  handler: async (ctx, args) => {
    const thumbsRating = await ctx.db
      .query("feedback")
      .withIndex("by_user_and_track", (q) =>
        q.eq("userId", args.userId).eq("discogsId", args.discogsId)
      )
      .filter((q) => 
        q.or(
          q.eq(q.field("type"), "thumbs_up"),
          q.eq(q.field("type"), "thumbs_down")
        )
      )
      .first();
    
    if (thumbsRating?.type === "thumbs_up") return "up";
    if (thumbsRating?.type === "thumbs_down") return "down";
    return null;
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
      const thumbsUp = feedback.filter(f => f.type === "thumbs_up").length;
      const thumbsDown = feedback.filter(f => f.type === "thumbs_down").length;

      const stats = {
        role: user.role,
        totalFeedback: feedback.length,
        likes,
        skips,
        thumbsUp,
        thumbsDown,
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