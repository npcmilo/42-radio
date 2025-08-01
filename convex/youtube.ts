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
    liveBroadcastContent?: string;
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
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error("YOUTUBE_API_KEY not configured");
      }

      // Simple single search query: just "artist title"
      const query = `${args.artist} ${args.title}`;
      
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        q: query,
        maxResults: (args.maxResults || 1).toString(), // Default to 1 result
        videoCategoryId: "10", // Music category
        key: apiKey,
      });

      if (args.durationFilter) {
        params.append("videoDuration", args.durationFilter);
      }

      const searchUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;

      await logToDatabase(ctx, logger.debug("YouTube search", {
        query,
        artist: args.artist,
        title: args.title,
        maxResults: args.maxResults || 1,
      }));

      const response = await fetch(searchUrl);

      if (!response.ok) {
        const errorText = await response.text();
        await logToDatabase(ctx, logger.warn("YouTube search failed", {
          query,
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
        }));
        return [];
      }

      const data: YouTubeSearchResponse = await response.json();
      
      if (!data.items || data.items.length === 0) {
        await logToDatabase(ctx, logger.warn("No YouTube results found", {
          artist: args.artist,
          title: args.title,
          query,
        }));
        return [];
      }

      const bestResults = data.items;

      // Results found - log success
      await logToDatabase(ctx, logger.info("YouTube search successful", {
        query,
        resultsFound: bestResults.length,
        totalResults: data.pageInfo.totalResults,
      }));

      // Simple processing - just return the result(s) as-is
      const processedResults = bestResults.map((item, index) => ({
        videoId: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        channelTitle: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.medium.url,
        publishedAt: item.snippet.publishedAt,
        score: 100, // Simple default score
        searchRank: index,
      }));

      return processedResults;
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
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error("YOUTUBE_API_KEY not configured");
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
        isLive: video.snippet.liveBroadcastContent !== "none" && video.snippet.liveBroadcastContent !== undefined,
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

// Find the best YouTube match for a Discogs track using progressive search strategy
export const findBestMatch = action({
  args: {
    artist: v.string(),
    title: v.string(),
    year: v.optional(v.number()),
    minDurationSeconds: v.optional(v.number()),
    maxDurationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl: string;
    duration: string;
    durationSeconds: number;
    viewCount: number;
    score: number;
    publishedAt: string;
  } | null> => {
    return await withTiming(ctx, logger, "youtube-best-match", async (): Promise<{
      videoId: string;
      title: string;
      channelTitle: string;
      thumbnailUrl: string;
      duration: string;
      durationSeconds: number;
      viewCount: number;
      score: number;
      publishedAt: string;
    } | null> => {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error("YOUTUBE_API_KEY not configured");
      }

      await logToDatabase(ctx, logger.info("Finding YouTube match with progressive search", {
        artist: args.artist,
        title: args.title,
        year: args.year,
        minDurationSeconds: args.minDurationSeconds,
        maxDurationSeconds: args.maxDurationSeconds,
      }));

      // Progressive search queries from most specific to broad
      const searchQueries = [
        `"${args.artist}" "${args.title}" official`,  // Most specific - official videos
        `"${args.artist}" "${args.title}" topic`,     // YouTube auto-generated topic videos
        `${args.artist} ${args.title}`                // Broad fallback
      ];

      for (let i = 0; i < searchQueries.length; i++) {
        const query = searchQueries[i];
        
        try {
          await logToDatabase(ctx, logger.debug("Trying YouTube search query", {
            queryIndex: i + 1,
            totalQueries: searchQueries.length,
            query,
            artist: args.artist,
            title: args.title,
          }));

          // Search API call (snippet only, no contentDetails available)
          const params = new URLSearchParams({
            part: "snippet", // Search API only supports snippet
            type: "video",
            q: query,
            maxResults: "1",
            videoCategoryId: "10", // Music category
            order: "relevance", // Best matches first
            key: apiKey,
          });

          const searchUrl = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
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

          if (!data.items || data.items.length === 0) {
            await logToDatabase(ctx, logger.debug("No results for query, trying next", {
              query,
              queryIndex: i + 1,
            }));
            continue; // Try next query
          }

          const video = data.items[0];
          
          // Get detailed video info including duration
          const detailsParams = new URLSearchParams({
            part: "snippet,contentDetails,statistics",
            id: video.id.videoId,
            key: apiKey,
          });

          const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?${detailsParams.toString()}`;
          const detailsResponse = await fetch(detailsUrl);

          if (!detailsResponse.ok) {
            await logToDatabase(ctx, logger.warn("Video details request failed", {
              videoId: video.id.videoId,
              status: detailsResponse.status,
            }));
            continue; // Try next query
          }

          const detailsData = await detailsResponse.json();
          if (!detailsData.items || detailsData.items.length === 0) {
            continue; // Try next query
          }

          const videoDetails = detailsData.items[0];
          const durationSeconds = parseDuration(videoDetails.contentDetails.duration);

          // Validate result
          if (videoDetails.snippet.liveBroadcastContent !== "none") {
            await logToDatabase(ctx, logger.debug("Skipping live video", {
              videoId: video.id.videoId,
              title: video.snippet.title,
            }));
            continue; // Try next query
          }

          // Apply duration filters
          if (args.minDurationSeconds && durationSeconds < args.minDurationSeconds) {
            await logToDatabase(ctx, logger.debug("Video too short, trying next query", {
              videoId: video.id.videoId,
              durationSeconds,
              minRequired: args.minDurationSeconds,
            }));
            continue; // Try next query
          }

          if (args.maxDurationSeconds && durationSeconds > args.maxDurationSeconds) {
            await logToDatabase(ctx, logger.debug("Video too long, trying next query", {
              videoId: video.id.videoId,
              durationSeconds,
              maxAllowed: args.maxDurationSeconds,
            }));
            continue; // Try next query
          }

          // Calculate simple relevance score
          let score = 100;
          const titleLower = video.snippet.title.toLowerCase();
          const channelLower = video.snippet.channelTitle.toLowerCase();
          const artistLower = args.artist.toLowerCase();

          // Bonus points for quality indicators
          if (titleLower.includes("official")) score += 20;
          if (titleLower.includes("topic")) score += 15;
          if (channelLower.includes(artistLower)) score += 15;
          if (channelLower.includes("official")) score += 10;
          if (titleLower.includes(artistLower)) score += 10;

          // Penalty for undesirable content
          if (titleLower.includes("cover")) score -= 10;
          if (titleLower.includes("karaoke")) score -= 20;
          if (titleLower.includes("lyrics")) score -= 5;

          const result = {
            videoId: video.id.videoId,
            title: video.snippet.title,
            channelTitle: video.snippet.channelTitle,
            thumbnailUrl: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default.url,
            duration: videoDetails.contentDetails.duration,
            durationSeconds,
            viewCount: parseInt(videoDetails.statistics.viewCount || "0"),
            score,
            publishedAt: video.snippet.publishedAt,
          };

          await logToDatabase(ctx, logger.info("YouTube match found", {
            artist: args.artist,
            title: args.title,
            queryUsed: query,
            queryIndex: i + 1,
            videoId: result.videoId,
            videoTitle: result.title,
            channelTitle: result.channelTitle,
            duration: result.duration,
            durationSeconds: result.durationSeconds,
            score: result.score,
            viewCount: result.viewCount,
          }));

          return result;

        } catch (error) {
          await logToDatabase(ctx, logger.error("Error in YouTube search query", {
            query,
            queryIndex: i + 1,
            error: error instanceof Error ? error.message : String(error),
          }));
          continue; // Try next query
        }
      }

      // All queries failed
      await logToDatabase(ctx, logger.warn("No valid YouTube match found after all queries", {
        artist: args.artist,
        title: args.title,
        queriesAttempted: searchQueries.length,
      }));

      return null;
    }, {
      artist: args.artist,
      title: args.title,
      year: args.year,
    });
  },
});