import { v } from "convex/values";
import { mutation, action } from "./_generated/server";
import { api } from "./_generated/api";

// Manual fix to clear exhausted status for testing
export const clearExhaustedStatus = mutation({
  args: {
    keyId: v.string(),
  },
  handler: async (ctx, args) => {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    const usage = await ctx.db
      .query("youtubeApiUsage")
      .withIndex("by_key_and_date", (q) => 
        q.eq("keyId", args.keyId).eq("date", today)
      )
      .first();
    
    if (usage) {
      await ctx.db.patch(usage._id, {
        quotaExhausted: false,
        quotaUsed: 0,
        callsFailed: 0,
        callsSuccessful: 0,
        lastUpdatedAt: Date.now(),
      });
      return { success: true, message: `Cleared exhausted status for ${args.keyId}` };
    }
    
    return { success: false, message: `No usage record found for ${args.keyId}` };
  },
});

// Test the rotation by making multiple YouTube calls
export const testRotation = action({
  args: {},
  handler: async (ctx): Promise<{
    testResults: Array<{
      track: string;
      keySelected?: string;
      quotaRemaining?: number;
      success: boolean;
      error?: string;
    }>;
    finalUsage: any;
  }> => {
    const results = [];
    
    // Test multiple searches to see rotation in action
    const testTracks = [
      { artist: "Aphex Twin", title: "Windowlicker" },
      { artist: "Boards of Canada", title: "Roygbiv" },
      { artist: "Burial", title: "Archangel" },
    ];
    
    for (const track of testTracks) {
      try {
        // Check which key will be used
        const keyInfo: any = await ctx.runAction(api.youtubeApiKeyPool.getBestAvailableKey, {
          operation: "search",
        });
        
        results.push({
          track: `${track.artist} - ${track.title}`,
          keySelected: keyInfo.keyId,
          quotaRemaining: keyInfo.quotaRemaining,
          success: true,
        });
        
        // Simulate API call by updating usage
        await ctx.runMutation(api.youtubeApiKeyPool.updateKeyUsage, {
          keyId: keyInfo.keyId,
          quotaCost: 100,
          success: true,
        });
        
      } catch (error) {
        results.push({
          track: `${track.artist} - ${track.title}`,
          error: error instanceof Error ? error.message : String(error),
          success: false,
        });
      }
    }
    
    // Get final usage stats
    const finalUsage: any = await ctx.runQuery(api.youtubeApiKeyPool.getAllKeyUsage);
    
    return {
      testResults: results,
      finalUsage: finalUsage.summary,
    };
  },
});