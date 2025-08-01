import { v } from "convex/values";
import { action } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";

const logger = new Logger("elevenlabs");

// ElevenLabs API configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

// Voice configuration - using Rachel for a warm, professional DJ voice
const VOICE_ID = "kPzsL2i3teMYv0FxEYQ6"; // Rachel voice
const VOICE_SETTINGS = {
  stability: 0.5,       // Lower for more expressive
  similarity_boost: 0.9, // Higher for more natural voice
  style: 0.4,           // Higher for more expressive style
  use_speaker_boost: true,
};

// Validate API key on module load
if (!ELEVENLABS_API_KEY) {
  console.warn("ELEVENLABS_API_KEY not found in environment variables");
}

// Helper function for generating speech
async function generateSpeechHelper(ctx: any, args: {
  text: string;
  voiceId?: string;
  modelId?: string;
}): Promise<{
  audioBase64: string;
  mimeType: string;
  sizeBytes: number;
}> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ElevenLabs API key not configured");
  }

  const voiceId = args.voiceId || VOICE_ID;
  const modelId = args.modelId || "eleven_turbo_v2_5"; // Better quality model

  await logToDatabase(ctx, logger.info("Generating speech with ElevenLabs", {
    textLength: args.text.length,
    voiceId,
    modelId,
  }));

  try {
    const response = await fetch(
      `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: args.text,
          model_id: modelId,
          voice_settings: VOICE_SETTINGS,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      await logToDatabase(ctx, logger.error("ElevenLabs API error", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        textLength: args.text.length,
      }));
      throw new Error(`ElevenLabs API error: ${response.status} ${errorText}`);
    }

    // Get the audio data as buffer and convert to base64
    const audioBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(audioBuffer);
    const audioBase64 = btoa(String.fromCharCode(...uint8Array));

    await logToDatabase(ctx, logger.info("Speech generated successfully", {
      textLength: args.text.length,
      audioSizeBytes: audioBuffer.byteLength,
      voiceId,
    }));

    return {
      audioBase64,
      mimeType: "audio/mpeg",
      sizeBytes: audioBuffer.byteLength,
    };

  } catch (error) {
    await logToDatabase(ctx, logger.error("Speech generation failed", {
      textLength: args.text.length,
      voiceId,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

// Generate speech from text using ElevenLabs API
export const generateSpeech = action({
  args: {
    text: v.string(),
    voiceId: v.optional(v.string()),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "generate-speech", async () => {
      return await generateSpeechHelper(ctx, args);
    }, {
      textLength: args.text.length,
      voiceId: args.voiceId || VOICE_ID,
    });
  },
});

// Generate speech and return a data URL for immediate playback
export const generateSpeechDataUrl = action({
  args: {
    text: v.string(),
    voiceId: v.optional(v.string()),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "generate-speech-data-url", async () => {
      const result = await generateSpeechHelper(ctx, {
        text: args.text,
        voiceId: args.voiceId,
        modelId: args.modelId,
      });

      const dataUrl = `data:${result.mimeType};base64,${result.audioBase64}`;

      await logToDatabase(ctx, logger.info("Generated speech data URL", {
        textLength: args.text.length,
        dataUrlLength: dataUrl.length,
        audioSize: result.sizeBytes,
      }));

      return dataUrl;
    });
  },
});

// Test ElevenLabs API connectivity
export const testConnection = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "test-connection", async () => {
      if (!ELEVENLABS_API_KEY) {
        return {
          success: false,
          error: "API key not configured",
        };
      }

      try {
        // Test with a simple phrase
        const testResult = await generateSpeechHelper(ctx, {
          text: "Testing ElevenLabs connection.",
        });

        await logToDatabase(ctx, logger.info("ElevenLabs connection test successful", {
          audioSize: testResult.sizeBytes,
        }));

        return {
          success: true,
          audioSize: testResult.sizeBytes,
          message: "ElevenLabs API is working correctly",
        };

      } catch (error) {
        await logToDatabase(ctx, logger.error("ElevenLabs connection test failed", {
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

// Get available voices from ElevenLabs
export const getAvailableVoices = action({
  args: {},
  handler: async (ctx) => {
    return await withTiming(ctx, logger, "get-available-voices", async () => {
      if (!ELEVENLABS_API_KEY) {
        throw new Error("ElevenLabs API key not configured");
      }

      try {
        const response = await fetch(`${ELEVENLABS_BASE_URL}/voices`, {
          headers: {
            "xi-api-key": ELEVENLABS_API_KEY,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch voices: ${response.status}`);
        }

        const data = await response.json();

        await logToDatabase(ctx, logger.info("Retrieved available voices", {
          voiceCount: data.voices?.length || 0,
        }));

        return data.voices || [];

      } catch (error) {
        await logToDatabase(ctx, logger.error("Failed to get available voices", {
          error: error instanceof Error ? error.message : String(error),
        }));
        throw error;
      }
    });
  },
});