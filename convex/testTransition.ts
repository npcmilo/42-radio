import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Logger, logToDatabase, withTiming } from "./logger";

const logger = new Logger("test-transition");

// Test just the transition audio generation
export const testTransitionAudio = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    genre: v.optional(v.string()),
    useClaudeScript: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    script?: string;
    wordCount?: number;
    isClaudeGenerated?: boolean;
    hasAudioUrl?: boolean;
    audioUrlSample?: string;
    error?: string;
  }> => {
    return await withTiming(ctx, logger, "test-transition-audio", async () => {
      await logToDatabase(ctx, logger.info("Testing transition audio generation", {
        artist: args.artist,
        title: args.title,
        useClaudeScript: args.useClaudeScript,
      }));

      try {
        const result = await ctx.runAction(api.scriptGenerator.generateTransitionAudio, {
          artist: args.artist,
          title: args.title,
          year: args.year,
          label: args.label,
          genre: args.genre,
          useClaudeScript: args.useClaudeScript !== false,
        });

        await logToDatabase(ctx, logger.info("Transition audio test completed", {
          artist: args.artist,
          title: args.title,
          script: result.script,
          wordCount: result.wordCount,
          isClaudeGenerated: result.isClaudeGenerated,
          hasAudioUrl: !!result.audioUrl,
          audioUrlLength: result.audioUrl?.length,
          error: result.error,
        }));

        return {
          success: true,
          script: result.script,
          wordCount: result.wordCount,
          isClaudeGenerated: result.isClaudeGenerated,
          hasAudioUrl: !!result.audioUrl,
          audioUrlSample: result.audioUrl ? result.audioUrl.substring(0, 100) + "..." : undefined,
          error: result.error,
        };

      } catch (error) {
        await logToDatabase(ctx, logger.error("Transition audio test failed", {
          artist: args.artist,
          title: args.title,
          error: error instanceof Error ? error.message : String(error),
        }));

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  },
});

// Test API connections
export const testAPIConnections = action({
  args: {},
  handler: async (ctx): Promise<{
    claude: { success: boolean; error?: string; message?: string };
    elevenlabs: { success: boolean; error?: string; message?: string };
  }> => {
    return await withTiming(ctx, logger, "test-api-connections", async () => {
      const results = {
        claude: { success: false, error: "", message: "" },
        elevenlabs: { success: false, error: "", message: "" },
      };

      // Test Claude API
      try {
        const claudeResult = await ctx.runAction(api.scriptGenerator.testConnection);
        results.claude = {
          success: claudeResult.success,
          error: claudeResult.error || "",
          message: claudeResult.message || "",
        };
      } catch (error) {
        results.claude.error = error instanceof Error ? error.message : String(error);
      }

      // Test ElevenLabs API
      try {
        const elevenlabsResult = await ctx.runAction(api.elevenlabs.testConnection);
        results.elevenlabs = {
          success: elevenlabsResult.success,
          error: elevenlabsResult.error || "",
          message: elevenlabsResult.message || "",
        };
      } catch (error) {
        results.elevenlabs.error = error instanceof Error ? error.message : String(error);
      }

      await logToDatabase(ctx, logger.info("API connection tests completed", {
        claudeSuccess: results.claude.success,
        elevenlabsSuccess: results.elevenlabs.success,
      }));

      return results;
    });
  },
});

// Add a simple test track with transition audio
export const addTestTrack = action({
  args: {
    artist: v.string(),
    title: v.string(),
    youtubeId: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    genre: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    forceClaudeScript: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    queueId?: string;
    transitionAudio?: {
      script: string;
      wordCount: number;
      isClaudeGenerated: boolean;
      hasAudioUrl: boolean;
      error?: string;
    };
    error?: string;
  }> => {
    return await withTiming(ctx, logger, "add-test-track", async () => {
      await logToDatabase(ctx, logger.info("Adding test track with transition audio", {
        artist: args.artist,
        title: args.title,
        youtubeId: args.youtubeId,
        forceClaudeScript: args.forceClaudeScript,
      }));

      try {
        // Generate transition audio first
        let transitionResult: any = null;
        let transitionAudioUrl: string | undefined;
        
        try {
          transitionResult = await ctx.runAction(api.scriptGenerator.generateTransitionAudio, {
            artist: args.artist,
            title: args.title,
            year: args.year,
            label: args.label,
            genre: args.genre,
            useClaudeScript: args.forceClaudeScript !== false,
          });

          if (transitionResult.audioUrl) {
            transitionAudioUrl = transitionResult.audioUrl;
          }
        } catch (error) {
          await logToDatabase(ctx, logger.warn("Transition audio generation failed, continuing without", {
            artist: args.artist,
            title: args.title,
            error: error instanceof Error ? error.message : String(error),
          }));
        }

        // Add to queue
        const queueId = await ctx.runMutation(api.radio.addToQueue, {
          discogsId: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: args.title,
          artist: args.artist,
          year: args.year,
          label: args.label,
          youtubeId: args.youtubeId,
          durationSeconds: args.durationSeconds || 180,
          transitionAudioUrl,
        });

        await logToDatabase(ctx, logger.info("Test track added successfully", {
          queueId,
          artist: args.artist,
          title: args.title,
          hasTransitionAudio: !!transitionAudioUrl,
        }));

        return {
          success: true,
          queueId: queueId?.toString(),
          transitionAudio: transitionResult ? {
            script: transitionResult.script,
            wordCount: transitionResult.wordCount,
            isClaudeGenerated: transitionResult.isClaudeGenerated,
            hasAudioUrl: !!transitionResult.audioUrl,
            error: transitionResult.error,
          } : undefined,
        };

      } catch (error) {
        await logToDatabase(ctx, logger.error("Test track addition failed", {
          artist: args.artist,
          title: args.title,
          error: error instanceof Error ? error.message : String(error),
        }));

        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  },
});