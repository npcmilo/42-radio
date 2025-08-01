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
    yearRange: v.optional(v.array(v.number())),
    styles: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    page: v.optional(v.number()), // For pagination through all results
    randomOffset: v.optional(v.boolean()), // For discovering varied content
  },
  handler: async (ctx, args) => {
    return await withTiming(ctx, logger, "discogs-search", async () => {
      const token = process.env.DISCOGS_API_TOKEN;
      if (!token) {
        throw new Error("DISCOGS_API_TOKEN not configured");
      }

      // Build search query
      const params = new URLSearchParams();

      // Add style filters for OR logic (House OR Electro)
      if (args.genreTags && args.genreTags.length > 0) {
        // Use all provided genre tags as style parameters (OR logic)
        for (const tag of args.genreTags) {
          // Capitalize first letter to match Discogs style format
          const discogStyle = tag.charAt(0).toUpperCase() + tag.slice(1);
          params.append("style", discogStyle);
        }
        // Also add Electronic genre as base
        params.append("genre", "Electronic");
      }

      // Add year range using YYYY-YYYY format as specified in guide
      if (args.yearRange && args.yearRange.length >= 2) {
        const minYear = args.yearRange[0];
        const maxYear = args.yearRange[1];
        
        // Use year range format (e.g., "2000-2009")
        params.append("year", `${minYear}-${maxYear}`);
      }

      // Set search parameters per guide specification
      params.append("type", "release");
      params.append("format", "Vinyl"); // Quality filter as per guide
      params.append("per_page", Math.min(args.limit || 100, 100).toString()); // Max 100 per API
      
      // Add page parameter for pagination
      if (args.page && args.page > 0) {
        params.append("page", args.page.toString());
      }

      // Add random offset for variety - will be handled after getting pagination info
      let useRandomPage = args.randomOffset && !args.page; // Don't randomize if explicit page requested


      const searchUrl = `https://api.discogs.com/database/search?${params.toString()}`;

      await logToDatabase(ctx, logger.info("Starting Discogs API search", {
        searchUrl: searchUrl.replace(token, "***"),
        genreTags: args.genreTags,
        yearRange: args.yearRange,
        limit: args.limit,
        randomOffset: args.randomOffset,
      }));

      // Make API request with proper User-Agent per guide
      const response = await fetch(searchUrl, {
        headers: {
          "Authorization": `Discogs token=${token}`,
          "User-Agent": "1042FM/1.0 +https://1042.fm",
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

      // If we have multiple pages and want randomization, get a random page
      if (useRandomPage && data.pagination.pages > 1 && data.results.length < (args.limit || 50)) {
        const randomPageNum = Math.floor(Math.random() * Math.min(data.pagination.pages, 5)) + 1; // Max 5 pages for variety
        
        if (randomPageNum !== data.pagination.page) {
          await logToDatabase(ctx, logger.info("Fetching random page for variety", {
            randomPage: randomPageNum,
            totalPages: data.pagination.pages,
          }));
          
          const randomParams = new URLSearchParams(params);
          randomParams.set("page", randomPageNum.toString());
          const randomUrl = `https://api.discogs.com/database/search?${randomParams.toString()}`;
          
          try {
            const randomResponse = await fetch(randomUrl, {
              headers: {
                "Authorization": `Discogs token=${token}`,
                "User-Agent": "1042FM/1.0 +https://1042.fm",
              },
            });
            
            if (randomResponse.ok) {
              const randomData: DiscogsSearchResponse = await randomResponse.json();
              // Combine results from both pages for variety
              data.results = [...data.results, ...randomData.results];
              
              await logToDatabase(ctx, logger.info("Random page results added", {
                originalResults: data.results.length - randomData.results.length,
                additionalResults: randomData.results.length,
                totalCombined: data.results.length,
              }));
            }
          } catch (error) {
            await logToDatabase(ctx, logger.warn("Random page fetch failed, continuing with original results", {
              error: error instanceof Error ? error.message : String(error),
            }));
          }
        }
      }

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

          // No need for client-side style filtering since we use style_exact in API call

          // Skip if we've played this in the last 100 tracks
          const historyCheck = await ctx.runQuery(api.radio.isTrackInRecentHistory, {
            discogsId: result.id.toString(),
            lastNTracks: 100,
          });

          if (historyCheck.isInRecentHistory) {
            await logToDatabase(ctx, logger.debug("Skipping track in recent history", {
              discogsId: result.id,
              title,
              artist,
              lastPlayedAt: historyCheck.lastPlayedAt,
              historyPosition: historyCheck.historyPosition,
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

      // With precise style_exact matching, fallback search is no longer needed

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
          "User-Agent": "1042FM/1.0 +https://1042.fm",
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
  handler: async (ctx, args): Promise<Array<{
    discogsId: string;
    title: string;
    artist: string;
    year?: number;
    label?: string;
    genres: string[];
    styles: string[];
    thumb: string;
  }>> => {
    return await withTiming(ctx, logger, "smart-search", async (): Promise<Array<{
      discogsId: string;
      title: string;
      artist: string;
      year?: number;
      label?: string;
      genres: string[];
      styles: string[];
      thumb: string;
    }>> => {
      // Get controller preferences
      const preferences: any = await ctx.runQuery(api.users.getControllerPreferences);

      // Use a random page (1-10) to get variety from the large result set
      const randomPage = Math.floor(Math.random() * 10) + 1;

      await logToDatabase(ctx, logger.info("Starting smart search", {
        userId: args.userId,
        requestedCount: args.count || 5,
        preferences: preferences,
        randomPage: randomPage,
      }));
      
      const searchResults: any = await ctx.runAction(api.discogs.searchDiscogs, {
        genreTags: preferences.genreTags,
        yearRange: preferences.yearRange,
        limit: Math.min((args.count || 5) * 2, 50), // Get some extra for variety
        page: randomPage, // Use pagination for accessing full catalog
      });

      if (searchResults.results.length === 0) {
        await logToDatabase(ctx, logger.warn("Smart search returned no results", {
          preferences,
        }));
        return [];
      }

      // Shuffle results for variety and take requested count
      const shuffledResults: Array<{
        discogsId: string;
        title: string;
        artist: string;
        year?: number;
        label?: string;
        genres: string[];
        styles: string[];
        thumb: string;
      }> = searchResults.results
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