import { v } from "convex/values";
import { action } from "./_generated/server";
import { Logger, logToDatabase, withTiming } from "./logger";
import { api } from "./_generated/api";

const logger = new Logger("discogs-search");

// Discogs API response types
interface DiscogsSearchResult {
  id: number;
  title: string;
  year?: number;
  label?: string[];
  genre?: string[];
  style?: string[];
  master_id?: number;
  master_url?: string;
  resource_url: string;
  type: string;
  thumb: string;
}

interface DiscogsSearchResponse {
  results: DiscogsSearchResult[];
  pagination: {
    pages: number;
    page: number;
    per_page: number;
    items: number;
    urls: {
      next?: string;
      prev?: string;
    };
  };
}

// Search Discogs for tracks based on user preferences
export const searchDiscogs = action({
  args: {
    genreTags: v.optional(v.array(v.string())),
    yearRange: v.optional(v.tuple([v.number(), v.number()])),
    styles: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    randomOffset: v.optional(v.boolean()), // For discovering varied content
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "discogs-search", async () => {
      const token = process.env.DISCOGS_API_TOKEN;
      if (!token) {
        throw new Error("DISCOGS_API_TOKEN not configured");
      }

      // Build search query
      let query = "";
      const params = new URLSearchParams();

      // Add genre filters
      if (args.genreTags && args.genreTags.length > 0) {
        // Use the first genre as primary search term
        query = `genre:"${args.genreTags[0]}"`;
        
        // Add additional genres as OR conditions
        if (args.genreTags.length > 1) {
          const additionalGenres = args.genreTags.slice(1).map(genre => `genre:"${genre}"`).join(" OR ");
          query = `(${query} OR ${additionalGenres})`;
        }
      }

      // Add year range
      if (args.yearRange) {
        const [minYear, maxYear] = args.yearRange;
        if (minYear === maxYear) {
          params.append("year", minYear.toString());
        } else {
          params.append("year", `${minYear}-${maxYear}`);
        }
      }

      // Set search parameters
      params.append("type", "release");
      params.append("format", "album,ep,single");
      params.append("per_page", (args.limit || 50).toString());

      // Add random offset for variety
      if (args.randomOffset) {
        const randomPage = Math.floor(Math.random() * 10) + 1; // Random page 1-10
        params.append("page", randomPage.toString());
      }

      if (query) {
        params.append("q", query);
      }

      const searchUrl = `https://api.discogs.com/database/search?${params.toString()}`;

      await logToDatabase(ctx, logger.info("Starting Discogs API search", {
        searchUrl: searchUrl.replace(token, "***"),
        query,
        genreTags: args.genreTags,
        yearRange: args.yearRange,
        limit: args.limit,
        randomOffset: args.randomOffset,
      }));

      // Make API request
      const response = await fetch(searchUrl, {
        headers: {
          "Authorization": `Discogs token=${token}`,
          "User-Agent": "104.2FM-RadioApp/1.0",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        await logToDatabase(ctx, logger.error("Discogs API request failed", {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
          searchUrl: searchUrl.replace(token, "***"),
        }));
        
        // Handle rate limiting
        if (response.status === 429) {
          throw new Error("Discogs rate limit reached. Please try again later.");
        }
        
        throw new Error(`Discogs API error: ${response.status} ${response.statusText}`);
      }

      const data: DiscogsSearchResponse = await response.json();

      await logToDatabase(ctx, logger.info("Discogs API search completed", {
        totalResults: data.pagination.items,
        returnedResults: data.results.length,
        currentPage: data.pagination.page,
        totalPages: data.pagination.pages,
      }));

      // Filter and process results
      const processedResults: Array<{
        discogsId: string;
        title: string;
        artist: string;
        year?: number;
        label?: string;
        genres: string[];
        styles: string[];
        thumb: string;
      }> = [];

      for (const result of data.results) {
        try {
          // Parse artist and title from Discogs format "Artist - Title"
          const titleParts = result.title.split(" - ");
          if (titleParts.length < 2) {
            await logToDatabase(ctx, logger.debug("Skipping result with invalid title format", {
              discogsId: result.id,
              title: result.title,
            }));
            continue;
          }

          const artist = titleParts[0].trim();
          const title = titleParts.slice(1).join(" - ").trim();

          // Skip if we've played this recently
          const recentCheck = await ctx.runQuery(api.radio.isTrackRecent, {
            discogsId: result.id.toString(),
            hoursBack: 24,
          });

          if (recentCheck.isRecent) {
            await logToDatabase(ctx, logger.debug("Skipping recently played track", {
              discogsId: result.id,
              title,
              artist,
              lastPlayedAt: recentCheck.lastPlayedAt,
            }));
            continue;
          }

          processedResults.push({
            discogsId: result.id.toString(),
            title,
            artist,
            year: result.year,
            label: result.label?.[0],
            genres: result.genre || [],
            styles: result.style || [],
            thumb: result.thumb,
          });

          await logToDatabase(ctx, logger.debug("Processed Discogs result", {
            discogsId: result.id,
            title,
            artist,
            year: result.year,
            genres: result.genre,
            styles: result.style,
          }));

        } catch (error) {
          await logToDatabase(ctx, logger.error("Error processing Discogs result", {
            discogsId: result.id,
            title: result.title,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }

      await logToDatabase(ctx, logger.info("Discogs search processing completed", {
        originalCount: data.results.length,
        processedCount: processedResults.length,
        filteredOut: data.results.length - processedResults.length,
      }));

      return {
        results: processedResults,
        pagination: {
          totalResults: data.pagination.items,
          currentPage: data.pagination.page,
          totalPages: data.pagination.pages,
          hasMore: data.pagination.page < data.pagination.pages,
        },
      };
    }, {
      genreTags: args.genreTags,
      yearRange: args.yearRange,
      requestedLimit: args.limit,
    });
  },
});

// Get detailed information about a specific Discogs release
export const getDiscogsRelease = action({
  args: {
    discogsId: v.string(),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "discogs-release-details", async () => {
      const token = process.env.DISCOGS_API_TOKEN;
      if (!token) {
        throw new Error("DISCOGS_API_TOKEN not configured");
      }

      const releaseUrl = `https://api.discogs.com/releases/${args.discogsId}`;

      await logToDatabase(ctx, logger.info("Fetching Discogs release details", {
        discogsId: args.discogsId,
        releaseUrl,
      }));

      const response = await fetch(releaseUrl, {
        headers: {
          "Authorization": `Discogs token=${token}`,
          "User-Agent": "104.2FM-RadioApp/1.0",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        await logToDatabase(ctx, logger.error("Discogs release API request failed", {
          discogsId: args.discogsId,
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText,
        }));
        
        if (response.status === 404) {
          throw new Error(`Discogs release ${args.discogsId} not found`);
        }
        
        throw new Error(`Discogs API error: ${response.status} ${response.statusText}`);
      }

      const releaseData = await response.json();

      await logToDatabase(ctx, logger.info("Discogs release details retrieved", {
        discogsId: args.discogsId,
        title: releaseData.title,
        year: releaseData.year,
        tracklist: releaseData.tracklist?.length || 0,
      }));

      return {
        id: releaseData.id,
        title: releaseData.title,
        artists: releaseData.artists || [],
        year: releaseData.year,
        labels: releaseData.labels || [],
        genres: releaseData.genres || [],
        styles: releaseData.styles || [],
        tracklist: releaseData.tracklist || [],
        images: releaseData.images || [],
        notes: releaseData.notes,
        country: releaseData.country,
        released: releaseData.released,
      };
    }, {
      discogsId: args.discogsId,
    });
  },
});

// Smart search that combines user preferences with discovery logic
export const smartSearch = action({
  args: {
    userId: v.optional(v.id("users")),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "smart-search", async () => {
      // Get controller preferences
      const preferences = await ctx.runQuery(api.users.getControllerPreferences);

      await logToDatabase(ctx, logger.info("Starting smart search", {
        userId: args.userId,
        requestedCount: args.count || 5,
        preferences: preferences,
      }));

      // Perform Discogs search with some randomization for variety
      const searchResults = await ctx.runAction(api.discogs.searchDiscogs, {
        genreTags: preferences.genreTags,
        yearRange: preferences.yearRange,
        limit: Math.min((args.count || 5) * 3, 50), // Get more than needed for filtering
        randomOffset: true,
      });

      if (searchResults.results.length === 0) {
        await logToDatabase(ctx, logger.warn("Smart search returned no results", {
          preferences,
        }));
        return [];
      }

      // Shuffle results for variety and take requested count
      const shuffledResults = searchResults.results
        .sort(() => Math.random() - 0.5)
        .slice(0, args.count || 5);

      await logToDatabase(ctx, logger.info("Smart search completed", {
        foundResults: searchResults.results.length,
        returnedResults: shuffledResults.length,
        preferences,
      }));

      return shuffledResults;
    }, {
      userId: args.userId,
      requestedCount: args.count,
    });
  },
});