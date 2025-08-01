import { v } from "convex/values";
import { action } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("youtube-search");

// YouTube API response types
interface YouTubeSearchItem {
  id: {
    kind: string;
    videoId: string;
  };
  snippet: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
    };
    channelTitle: string;
    liveBroadcastContent: string;
  };
}

interface YouTubeSearchResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  regionCode: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubeSearchItem[];
}

interface YouTubeVideoDetails {
  id: string;
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
  };
  contentDetails: {
    duration: string; // ISO 8601 format like "PT4M13S"
    definition: string;
    caption: string;
  };
  statistics: {
    viewCount: string;
    likeCount?: string;
    commentCount?: string;
  };
}

// Convert ISO 8601 duration to seconds
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || "0");
  const minutes = parseInt(match[2] || "0");
  const seconds = parseInt(match[3] || "0");
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Search YouTube for a specific track
export const searchYouTube = action({
  args: {
    artist: v.string(),
    title: v.string(),
    maxResults: v.optional(v.number()),
    durationFilter: v.optional(v.string()), // "short", "medium", "long"
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "youtube-search", async () => {
      const apiKey = process.env.VITE_YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error("VITE_YOUTUBE_API_KEY not configured");
      }

      // Build search query - prioritize official releases and clean audio
      const queries = [
        `"${args.artist}" "${args.title}"`, // Exact match
        `${args.artist} ${args.title} official`, // Prefer official releases
        `${args.artist} ${args.title} audio`, // Prefer audio-only versions
        `${args.artist} ${args.title}`, // Fallback broad search
      ];

      let bestResults: YouTubeSearchItem[] = [];
      let queryUsed = "";

      // Try queries in order of preference
      for (const query of queries) {
        try {
          const params = new URLSearchParams({
            part: "snippet",
            type: "video",
            q: query,
            maxResults: (args.maxResults || 10).toString(),
            videoCategoryId: "10", // Music category
            key: apiKey,
          });

          if (args.durationFilter) {
            params.append("videoDuration", args.durationFilter);
          }

          const searchUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

          await logToDatabase(ctx, logger.debug("Trying YouTube search query", {
            query,
            artist: args.artist,
            title: args.title,
            searchUrl: searchUrl.replace(apiKey, "***"),
          }));

          const response = await fetch(searchUrl);

          if (!response.ok) {
            const errorText = await response.text();
            await logToDatabase(ctx, logger.warn("YouTube search query failed", {
              query,
              status: response.status,
              statusText: response.statusText,
              errorBody: errorText,
            }));
            continue; // Try next query
          }

          const data: YouTubeSearchResponse = await response.json();

          if (data.items && data.items.length > 0) {
            bestResults = data.items;
            queryUsed = query;
            
            await logToDatabase(ctx, logger.info("YouTube search successful", {
              query: queryUsed,
              resultsFound: data.items.length,
              totalResults: data.pageInfo.totalResults,
            }));
            break; // Found results, stop trying other queries
          }

        } catch (error) {
          await logToDatabase(ctx, logger.error("YouTube search query error", {
            query,
            error: error instanceof Error ? error.message : String(error),
          }));
          continue; // Try next query
        }
      }

      if (bestResults.length === 0) {
        await logToDatabase(ctx, logger.warn("No YouTube results found for track", {
          artist: args.artist,
          title: args.title,
          queriesTried: queries.length,
        }));
        return [];
      }

      // Process and score results
      const processedResults = bestResults.map((item, index) => {
        const title = item.snippet.title.toLowerCase();
        const channelTitle = item.snippet.channelTitle.toLowerCase();
        const description = item.snippet.description.toLowerCase();
        
        // Scoring algorithm to find best match
        let score = 0;
        
        // Prefer official channels
        if (channelTitle.includes("official") || 
            channelTitle.includes(args.artist.toLowerCase()) ||
            channelTitle.includes("records") ||
            channelTitle.includes("music")) {
          score += 10;
        }
        
        // Prefer videos with "official" in title
        if (title.includes("official")) score += 8;
        if (title.includes("audio")) score += 5;
        if (title.includes("video")) score += 3;
        
        // Penalize covers, remixes, live versions (unless it's what we want)
        if (title.includes("cover") && !args.title.toLowerCase().includes("cover")) score -= 5;
        if (title.includes("remix") && !args.title.toLowerCase().includes("remix")) score -= 3;
        if (title.includes("live") && !args.title.toLowerCase().includes("live")) score -= 2;
        if (title.includes("karaoke")) score -= 10;
        if (title.includes("lyrics")) score -= 2;
        
        // Prefer newer uploads (slight bias)
        const uploadDate = new Date(item.snippet.publishedAt);
        const daysSinceUpload = (Date.now() - uploadDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpload < 365) score += 1; // Uploaded within last year
        
        return {
          videoId: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          channelTitle: item.snippet.channelTitle,
          thumbnailUrl: item.snippet.thumbnails.medium.url,
          publishedAt: item.snippet.publishedAt,
          score,
          searchRank: index, // Original search ranking
        };
      });

      // Sort by score (descending) and log the ranking
      const rankedResults = processedResults.sort((a, b) => b.score - a.score);

      await logToDatabase(ctx, logger.info("YouTube results processed and ranked", {
        artist: args.artist,
        title: args.title,
        queryUsed,
        totalResults: rankedResults.length,
        topResult: rankedResults[0] ? {
          videoId: rankedResults[0].videoId,
          title: rankedResults[0].title,
          score: rankedResults[0].score,
          channelTitle: rankedResults[0].channelTitle,
        } : null,
      }));

      return rankedResults;
    }, {
      artist: args.artist,
      title: args.title,
      maxResults: args.maxResults,
    });
  },
});

// Get detailed information about a YouTube video
export const getVideoDetails = action({
  args: {
    videoId: v.string(),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "youtube-video-details", async () => {
      const apiKey = process.env.VITE_YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error("VITE_YOUTUBE_API_KEY not configured");
      }

      const params = new URLSearchParams({
        part: "snippet,contentDetails,statistics",
        id: args.videoId,
        key: apiKey,
      });

      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;

      await logToDatabase(ctx, logger.debug("Fetching YouTube video details", {
        videoId: args.videoId,
        detailsUrl: detailsUrl.replace(apiKey, "***"),
      }));

      const response = await fetch(detailsUrl);

      if (!response.ok) {
        const errorText = await response.text();
        await logToDatabase(ctx, logger.error("YouTube video details request failed", {
          videoId: args.videoId,
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
        }));
        
        if (response.status === 404) {
          throw new Error(`YouTube video ${args.videoId} not found`);
        }
        
        throw new Error(`YouTube API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        await logToDatabase(ctx, logger.warn("YouTube video details not found", {
          videoId: args.videoId,
        }));
        return null;
      }

      const video: YouTubeVideoDetails = data.items[0];
      const durationSeconds = parseDuration(video.contentDetails.duration);

      const details = {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        channelTitle: video.snippet.channelTitle,
        publishedAt: video.snippet.publishedAt,
        duration: video.contentDetails.duration,
        durationSeconds,
        definition: video.contentDetails.definition,
        caption: video.contentDetails.caption,
        viewCount: parseInt(video.statistics.viewCount),
        likeCount: video.statistics.likeCount ? parseInt(video.statistics.likeCount) : undefined,
        isLive: video.snippet.liveBroadcastContent !== "none",
      };

      await logToDatabase(ctx, logger.info("YouTube video details retrieved", {
        videoId: args.videoId,
        title: details.title,
        duration: details.duration,
        durationSeconds: details.durationSeconds,
        viewCount: details.viewCount,
        channelTitle: details.channelTitle,
      }));

      return details;
    }, {
      videoId: args.videoId,
    });
  },
});

// Find the best YouTube match for a Discogs track
export const findBestMatch = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    minDurationSeconds: v.optional(v.number()), // Filter out very short videos
    maxDurationSeconds: v.optional(v.number()), // Filter out very long videos
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "youtube-best-match", async () => {
      await logToDatabase(ctx, logger.info("Finding best YouTube match", {
        artist: args.artist,
        title: args.title,
        year: args.year,
        minDurationSeconds: args.minDurationSeconds,
        maxDurationSeconds: args.maxDurationSeconds,
      }));

      // Search for candidates
      const searchResults = await ctx.runAction(api.youtube.searchYouTube, {
        artist: args.artist,
        title: args.title,
        maxResults: 5,
        durationFilter: "medium", // Prefer medium length videos (4-20 minutes)
      });

      if (searchResults.length === 0) {
        await logToDatabase(ctx, logger.warn("No YouTube candidates found", {
          artist: args.artist,
          title: args.title,
        }));
        return null;
      }

      // Get detailed info for top candidates and apply duration filtering
      const validCandidates = [];

      for (const candidate of searchResults.slice(0, 3)) { // Check top 3 candidates
        try {
          const details = await ctx.runAction(api.youtube.getVideoDetails, {
            videoId: candidate.videoId,
          });

          if (!details || details.isLive) {
            await logToDatabase(ctx, logger.debug("Skipping candidate (no details or live)", {
              videoId: candidate.videoId,
              title: candidate.title,
            }));
            continue;
          }

          // Apply duration filters
          if (args.minDurationSeconds && details.durationSeconds < args.minDurationSeconds) {
            await logToDatabase(ctx, logger.debug("Skipping candidate (too short)", {
              videoId: candidate.videoId,
              durationSeconds: details.durationSeconds,
              minRequired: args.minDurationSeconds,
            }));
            continue;
          }

          if (args.maxDurationSeconds && details.durationSeconds > args.maxDurationSeconds) {
            await logToDatabase(ctx, logger.debug("Skipping candidate (too long)", {
              videoId: candidate.videoId,
              durationSeconds: details.durationSeconds,
              maxAllowed: args.maxDurationSeconds,
            }));
            continue;
          }

          validCandidates.push({
            ...candidate,
            details,
          });

        } catch (error) {
          await logToDatabase(ctx, logger.error("Error checking candidate details", {
            videoId: candidate.videoId,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      if (validCandidates.length === 0) {
        await logToDatabase(ctx, logger.warn("No valid YouTube candidates after filtering", {
          artist: args.artist,
          title: args.title,
          originalCandidates: searchResults.length,
        }));
        return null;
      }

      // Return the best candidate (already sorted by score)
      const bestMatch = validCandidates[0];

      await logToDatabase(ctx, logger.info("Best YouTube match found", {
        artist: args.artist,
        title: args.title,
        selectedVideoId: bestMatch.videoId,
        selectedTitle: bestMatch.title,
        channelTitle: bestMatch.channelTitle,
        duration: bestMatch.details.duration,
        score: bestMatch.score,
        viewCount: bestMatch.details.viewCount,
      }));

      return {
        videoId: bestMatch.videoId,
        title: bestMatch.title,
        channelTitle: bestMatch.channelTitle,
        thumbnailUrl: bestMatch.thumbnailUrl,
        duration: bestMatch.details.duration,
        durationSeconds: bestMatch.details.durationSeconds,
        viewCount: bestMatch.details.viewCount,
        score: bestMatch.score,
        publishedAt: bestMatch.publishedAt,
      };
    }, {
      artist: args.artist,
      title: args.title,
      year: args.year,
    });
  },
});