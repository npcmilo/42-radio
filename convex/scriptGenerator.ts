import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Logger, logToDatabase, withTiming } from "./logger";

const logger = new Logger("script-generator");

// Claude API configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";

// Validate API key on module load
if (!ANTHROPIC_API_KEY) {
  console.warn("ANTHROPIC_API_KEY not found in environment variables");
}

// Helper function for generating DJ scripts
async function generateDJScriptHelper(ctx: any, args: {
  artist: string;
  title: string;
  year?: number;
  label?: string;
  genre?: string;
  previousTrack?: {
    artist: string;
    title: string;
  };
  upcomingTrack?: {
    artist: string;
    title: string;
    genre?: string;
  };
  timeOfDay?: string;
}): Promise<{
  script: string;
  wordCount: number;
  characterCount: number;
  isFallback?: boolean;
}> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not configured");
  }

  // Build context for the prompt
  const currentTrack = `${args.artist} - "${args.title}"`;
  const previousContext = args.previousTrack 
    ? `"${args.previousTrack.title}" by ${args.previousTrack.artist}` 
    : null;
  const upcomingContext = args.upcomingTrack 
    ? `"${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}` 
    : null;
  const upcomingGenreHint = args.upcomingTrack?.genre 
    ? ` (${args.upcomingTrack.genre})` 
    : "";

  // Build appropriate prompt based on available context
  let prompt: string;
  
  if (previousContext && upcomingContext) {
    // Full transition with both tracks
    prompt = `You are a radio DJ for 104.2 FM. Create a brief transition between tracks.

Previous track: ${previousContext}
Upcoming track: ${upcomingContext}${upcomingGenreHint}

Requirements:
- Maximum 15 words total
- Format: "That was [previous track]. Coming up, [upcoming track]."
- Occasionally (20% chance) add a brief descriptor about one of the tracks
- Examples of descriptors: "a tech house banger", "pure electronic bliss", "underground gold", "a dreamy ambient piece"
- Keep it conversational and natural
- No radio station mentions

Generate only the script text, nothing else.`;
  } else if (upcomingContext) {
    // Only upcoming track available (start of broadcast or after gap)
    prompt = `You are a radio DJ for 104.2 FM. Introduce the upcoming track.

Upcoming track: ${upcomingContext}${upcomingGenreHint}

Requirements:
- Maximum 12 words total
- Format options: "Here's [track]" or "Now playing [track]" or "Coming up, [track]"
- Occasionally (30% chance) add a brief descriptor about the track
- Examples of descriptors: "a tech house banger", "pure electronic bliss", "underground gold", "a dreamy ambient piece"
- Keep it conversational and natural
- No radio station mentions

Generate only the script text, nothing else.`;
  } else if (previousContext) {
    // Only previous track available (unusual case)
    prompt = `You are a radio DJ for 104.2 FM. Acknowledge the previous track.

Previous track: ${previousContext}

Requirements:
- Maximum 10 words total
- Format: "That was [previous track]." or similar acknowledgment
- Keep it conversational and natural
- No radio station mentions

Generate only the script text, nothing else.`;
  } else {
    // No context available - generic introduction
    prompt = `You are a radio DJ for 104.2 FM. Create a brief generic transition or station identifier.

Current track: ${currentTrack}

Requirements:
- Maximum 10 words total
- Format options: "Here's [track]" or "Now playing [track]" or "On 104.2 FM, [track]"
- Keep it conversational and natural
- Can mention the station briefly

Generate only the script text, nothing else.`;
  }

  await logToDatabase(ctx, logger.info("Generating DJ script with Claude", {
    artist: args.artist,
    title: args.title,
    year: args.year,
    hasLabel: !!args.label,
    hasGenre: !!args.genre,
    hasPreviousTrack: !!args.previousTrack,
    timeOfDay: args.timeOfDay,
  }));

  try {
    const response = await fetch(ANTHROPIC_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 150,
        temperature: 0.7,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await logToDatabase(ctx, logger.error("Claude API error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        artist: args.artist,
        title: args.title,
      }));
      throw new Error(`Claude API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const script = data.content?.[0]?.text?.trim();

    if (!script) {
      throw new Error("No script content received from Claude");
    }

    // Clean up the script (remove quotes if present, trim whitespace)
    const cleanScript = script.replace(/^["']|["']$/g, '').trim();

    await logToDatabase(ctx, logger.info("DJ script generated successfully", {
      artist: args.artist,
      title: args.title,
      scriptLength: cleanScript.length,
      wordCount: cleanScript.split(' ').length,
    }));

    return {
      script: cleanScript,
      wordCount: cleanScript.split(' ').length,
      characterCount: cleanScript.length,
      isFallback: false,
    };

  } catch (error) {
    await logToDatabase(ctx, logger.error("DJ script generation failed", {
      artist: args.artist,
      title: args.title,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

// Helper function for generating fallback scripts
async function generateFallbackScriptHelper(ctx: any, args: {
  artist: string;
  title: string;
  year?: number;
  previousTrack?: {
    artist: string;
    title: string;
  };
  upcomingTrack?: {
    artist: string;
    title: string;
    genre?: string;
  };
}): Promise<{
  script: string;
  wordCount: number;
  characterCount: number;
  isFallback: boolean;
}> {
  await logToDatabase(ctx, logger.info("Generating fallback script", {
    artist: args.artist,
    title: args.title,
    year: args.year,
  }));

  // Create context-appropriate fallback scripts
  const templates = [];
  
  if (args.previousTrack && args.upcomingTrack) {
    // Full transition format when we have both tracks
    const previousInfo = `That was "${args.previousTrack.title}" by ${args.previousTrack.artist}.`;
    const upcomingInfo = `Coming up, "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`;
    templates.push(
      `${previousInfo} ${upcomingInfo}`,
      `${previousInfo} Next, "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`,
      `${previousInfo} Up next, "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`
    );
  } else if (args.upcomingTrack) {
    // Only upcoming track - this is what we want for our current use case
    templates.push(
      `Coming up, "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`,
      `Next up, "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`,
      `Here's "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`,
      `Now playing "${args.upcomingTrack.title}" by ${args.upcomingTrack.artist}.`
    );
  } else if (args.previousTrack) {
    // Only previous track (unusual case)
    templates.push(
      `That was "${args.previousTrack.title}" by ${args.previousTrack.artist}.`,
      `You just heard "${args.previousTrack.title}" by ${args.previousTrack.artist}.`
    );
  } else {
    // No context - introduce current track being generated for
    templates.push(
      `Here's "${args.title}" by ${args.artist}.`,
      `Now playing "${args.title}" by ${args.artist}.`,
      `On 104.2 FM, "${args.title}" by ${args.artist}.`
    );
  }

  // Select a random template
  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

  await logToDatabase(ctx, logger.info("Fallback script generated", {
    artist: args.artist,
    title: args.title,
    script: randomTemplate,
    templateUsed: templates.indexOf(randomTemplate),
  }));

  return {
    script: randomTemplate,
    wordCount: randomTemplate.split(' ').length,
    characterCount: randomTemplate.length,
    isFallback: true,
  };
}

// Generate a DJ script for a track introduction
export const generateDJScript = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    genre: v.optional(v.string()),
    previousTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
    })),
    upcomingTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
      genre: v.optional(v.string()),
    })),
    timeOfDay: v.optional(v.string()), // "morning", "afternoon", "evening", "night"
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "generate-dj-script", async () => {
      return await generateDJScriptHelper(ctx, args);
    }, {
      artist: args.artist,
      title: args.title,
      year: args.year,
    });
  },
});

// Generate a fallback script when Claude API is unavailable
export const generateFallbackScript = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    previousTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
    })),
    upcomingTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
      genre: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "generate-fallback-script", async () => {
      return await generateFallbackScriptHelper(ctx, args);
    });
  },
});



// Test Claude API connectivity
export const testConnection = action({
  args: {},
  handler: async (ctx): Promise<{
    success: boolean;
    error?: string;
    script?: string;
    wordCount?: number;
    message?: string;
  }> => {
    return await withTiming(ctx, logger, "test-connection", async (): Promise<{
      success: boolean;
      error?: string;
      script?: string;
      wordCount?: number;
      message?: string;
    }> => {
      if (!ANTHROPIC_API_KEY) {
        return {
          success: false,
          error: "API key not configured",
        };
      }

      try {
        // Test with a simple script generation
        const testResult = await generateDJScriptHelper(ctx, {
          artist: "Test Artist",
          title: "Test Track",
          year: 2024,
        });

        await logToDatabase(ctx, logger.info("Claude connection test successful", {
          scriptLength: testResult.script.length,
          wordCount: testResult.wordCount,
        }));

        return {
          success: true,
          script: testResult.script,
          wordCount: testResult.wordCount,
          message: "Claude API is working correctly",
        };

      } catch (error) {
        await logToDatabase(ctx, logger.error("Claude connection test failed", {
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

// Generate a complete transition audio script and data URL
export const generateTransitionAudio = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    genre: v.optional(v.string()),
    previousTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
    })),
    upcomingTrack: v.optional(v.object({
      artist: v.string(),
      title: v.string(),
      genre: v.optional(v.string()),
    })),
    useClaudeScript: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    script: string;
    audioUrl: string | null;
    wordCount: number;
    isClaudeGenerated: boolean;
    characterCount: number;
    error?: string;
  }> => {
    return await withTiming(ctx, logger, "generate-transition-audio", async (): Promise<{
      script: string;
      audioUrl: string | null;
      wordCount: number;
      isClaudeGenerated: boolean;
      characterCount: number;
      error?: string;
    }> => {
      let scriptResult;

      try {
        if (args.useClaudeScript !== false) {
          // Try to generate with Claude first
          scriptResult = await generateDJScriptHelper(ctx, {
            artist: args.artist,
            title: args.title,
            year: args.year,
            label: args.label,
            genre: args.genre,
            previousTrack: args.previousTrack,
            upcomingTrack: args.upcomingTrack,
            timeOfDay: getTimeOfDay(),
          });
        } else {
          throw new Error("Claude disabled, using fallback");
        }
      } catch (error) {
        await logToDatabase(ctx, logger.warn("Claude script generation failed, using fallback", {
          artist: args.artist,
          title: args.title,
          error: error instanceof Error ? error.message : String(error),
        }));

        // Use fallback script
        scriptResult = await generateFallbackScriptHelper(ctx, {
          artist: args.artist,
          title: args.title,
          year: args.year,
          previousTrack: args.previousTrack,
          upcomingTrack: args.upcomingTrack,
        });
      }

      // Generate speech with ElevenLabs
      try {
        const audioUrl: string = await ctx.runAction(api.elevenlabs.generateSpeechDataUrl, {
          text: scriptResult.script,
        });

        await logToDatabase(ctx, logger.info("Transition audio generated successfully", {
          artist: args.artist,
          title: args.title,
          script: scriptResult.script,
          wordCount: scriptResult.wordCount,
          isClaudeGenerated: !scriptResult.isFallback,
          audioUrlLength: audioUrl.length,
        }));

        return {
          script: scriptResult.script,
          audioUrl,
          wordCount: scriptResult.wordCount,
          isClaudeGenerated: !scriptResult.isFallback,
          characterCount: scriptResult.characterCount,
        };

      } catch (error) {
        await logToDatabase(ctx, logger.error("ElevenLabs speech generation failed", {
          artist: args.artist,
          title: args.title,
          script: scriptResult.script,
          error: error instanceof Error ? error.message : String(error),
        }));

        // Return script without audio URL for graceful degradation
        return {
          script: scriptResult.script,
          audioUrl: null,
          wordCount: scriptResult.wordCount,
          isClaudeGenerated: !scriptResult.isFallback,
          characterCount: scriptResult.characterCount,
          error: "Audio generation failed",
        };
      }
    }, {
      artist: args.artist,
      title: args.title,
    });
  },
});

// Helper function to determine time of day
function getTimeOfDay(): string {
  const hour = new Date().getHours();
  
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

