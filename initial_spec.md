# 104.2 FM - Unified Specification Document (Revised)

## 🧭 Overview

**104.2 FM** is a minimalist, AI-curated internet radio station designed for the musically adventurous. It streams a continuous, globally-synced feed of obscure and underground music discovered from the Discogs database. The experience is uniquely tailored through user-defined "vibe" parameters, with tracks played via YouTube and introduced by a custom, AI-generated radio host.

This creates a shared, communal listening experience where everyone hears the same track simultaneously. Authenticated users, or "controllers," are granted the ability to guide the stream by adjusting vibe settings, managing the track queue, and skipping songs, ensuring a dynamic and collaborative musical journey.

---

## 🧰 Tech Stack

| Layer                 | Tool           | Purpose                                           |
| --------------------- | -------------- | ------------------------------------------------- |
| **Frontend**          | Remix          | React-based SSR for fast UI and route transitions |
|                       | Tailwind CSS   | Utility-first CSS for modern styling              |
|                       | Framer Motion  | Smooth transitions and motion effects for UX polish |
| **Backend & Realtime**| Convex         | Database, real-time sync, and stateful logic      |
| **Auth**              | Clerk          | Secure authentication for controller permissions  |
| **Media Discovery**   | Discogs API    | Record metadata and discovery source              |
| **Playback**          | YouTube API    | Song streaming via embedded iframe player         |
| **Voice Generation**  | ElevenLabs     | Lifelike AI radio host voiceovers                 |
| **AI / LLM**          | Claude Sonnet  | Script generation and search query enhancement    |
| **Analytics**         | PostHog        | User interaction and behavioral data tracking     |
| **Deployment**        | Vercel         | Hosting and continuous deployment infrastructure  |
| **Version Control**   | Git            | Project and codebase management                   |

---

## ✨ Core Features

- **Global Real-Time Sync:** All listeners experience the same music and AI host transitions simultaneously.
- **AI Radio Host:** An AI-generated voice provides brief, context-aware introductions for each track.
- **Vibe-Based Curation:** "Controllers" can adjust the musical direction by setting parameters like genre, style, year, and energy level.
- **Collaborative Control:** A single authenticated "controller" can skip tracks, go back, and manage the upcoming queue.
- **Continuous Playback:** The station runs 24/7, with an automated queue that refills based on the active vibe settings.
- **Minimalist Interface:** A clean, full-screen UI focuses on album art and track information, minimizing distractions.

---

## 🏗️ System Architecture

The system is composed of several interconnected modules, orchestrated by Convex.

### 1. 🎧 Radio Playback Engine
The core of the user experience, ensuring synchronized playback for all listeners.
- **Technology:** Remix frontend, `react-youtube`, Convex for state.
- **Functionality:**
    - Embeds a YouTube player with a minimal UI.
    - The `currentTrack` table in Convex is the single source of truth, with `startedAt` ensuring all clients are synced.
    - Plays AI-generated voiceovers from `transitionAudioUrl` before the YouTube track begins.
    - Preloads the next track's audio in a hidden element to minimize latency.

### 2. 🔍 Track Discovery Engine
Responsible for sourcing new music from Discogs.
- **Technology:** Discogs API, Convex, Claude Sonnet (optional).
- **Functionality:**
    - Searches the Discogs API using vibe filters (genre, style, year, country) from controller preferences.
    - Implements a deduplication strategy by checking against the `history` table to avoid repeats.
    - New discoveries are added to the `queue` table in Convex.
    - Optionally, Claude can be used to refine Discogs search queries based on more abstract vibe settings.

### 3. 🗣️ AI Voice Host Generator
Creates a unique DJ announcement for each track.
- **Technology:** Claude Sonnet, ElevenLabs, Convex.
- **Functionality:**
    - Claude generates a short, engaging script using track metadata (title, artist, year, label).
    - The script is sent to the ElevenLabs API to synthesize a voiceover audio file.
    - The resulting audio file is cached (e.g., in S3 or a similar service), and its URL is stored in `transitionAudioUrl` in the `queue` and `currentTrack` tables.

### 4. 🔐 Authentication & Permissions
Manages access for stream controllers.
- **Technology:** Clerk, Convex.
- **Functionality:**
    - Clerk handles the entire user authentication flow (signup, login, session management).
    - A user's `clerkId` is stored in the `users` table.
    - The application defines two roles: `listener` (default) and `controller`.
    - Only users with the `controller` role can access the Vibe Control Panel and modify the playback state (skip, back, queue).

### 5. 🎛️ Vibe Control Panel
The interface for the controller to shape the radio's musical direction.
- **Technology:** Remix, Convex.
- **Functionality:**
    - A UI available only to the `controller` role.
    - Allows selection of genre/style tags, a year range, energy level, and optional regional bias.
    - These settings are stored in the `users` table and directly influence the Track Discovery Engine.

### 6. 💾 Track Queue Management
Maintains the upcoming playlist.
- **Technology:** Convex.
- **Functionality:**
    - A global `queue` table holds upcoming tracks.
    - The queue operates on a First-In, First-Out (FIFO) basis.
    - A background Convex function automatically refills the queue from the Discovery Engine when it runs low.
    - The controller can view and manually reorder or remove items from the queue.

---

## 🗄️ Convex Schema (Detailed)

```ts
// convex/schema.ts
import { v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";

export default defineSchema({
  // The single track currently playing for all listeners
  currentTrack: defineTable({
    discogsId: v.string(), // ID from Discogs for metadata
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    youtubeId: v.string(), // ID for the YouTube player
    startedAt: v.number(), // UTC timestamp when the track began, for client sync
    transitionAudioUrl: v.optional(v.string()), // URL to the AI voiceover
  }).withoutIndex("by_creation_time"), // No need for the default index

  // A history of all tracks played to avoid repeats
  history: defineTable({
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    youtubeId: v.string(),
    playedAt: v.number(), // UTC timestamp
    likedBy: v.optional(v.array(v.id("users"))), // Track who liked it
  }).index("by_discogsId", ["discogsId"]), // Index for fast deduplication checks

  // Upcoming tracks to be played
  queue: defineTable({
    discogsId: v.string(),
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    label: v.optional(v.string()),
    youtubeId: v.string(),
    createdAt: v.number(), // Timestamp when added to the queue
    transitionAudioUrl: v.optional(v.string()), // Pre-generated voiceover URL
  }).index("by_createdAt", ["createdAt"]), // To ensure FIFO playback order

  // User accounts and their settings
  users: defineTable({
    clerkId: v.string(), // Corresponds to the ID from Clerk auth
    role: v.union(v.literal("listener"), v.literal("controller")),
    // Controller-specific settings for track discovery
    preferences: v.optional(
      v.object({
        genreTags: v.array(v.string()),
        yearRange: v.tuple([v.number(), v.number()]),
        energy: v.optional(v.union(v.literal("Low"), v.literal("Medium"), v.literal("High"))),
        region: v.optional(v.string()),
      })
    ),
  }).index("by_clerkId", ["clerkId"]), // For quickly finding users

  // User feedback on tracks
  feedback: defineTable({
    userId: v.id("users"),
    discogsId: v.string(), // Use Discogs ID to reference the track
    type: v.union(v.literal("like"), v.literal("skip")),
    createdAt: v.number(),
  }).index("by_user_and_track", ["userId", "discogsId"]), // To prevent duplicate feedback
});
```

---

## 🧠 Claude Prompt Examples

### Voice Transition Prompt
```text
You are a chill but enthusiastic radio host named SCOT. The current song is about to play on your crate-digging internet radio station, 104.2 FM.

Song info:
- Artist: {artist}
- Title: {title}
- Label: {label}
- Year: {year}
- Style: {style or genre}

Give a short 1–2 sentence intro for this song. Keep it cool, personable, and maybe mention the genre or the year if relevant. Feel free to inject some flavor but don't speak for too long.
```

### Discovery Prompt (Optional Future Use)
```text
You are helping curate a stream of underground electronic music for a crate-digging radio station. Based on the vibe settings provided, return a set of ideal Discogs search filters.

Vibe settings:
- Genre: {genre}
- Region: {region}
- Energy: {low/medium/high}
- Year range: {year_min} to {year_max}

Return a JSON object with fields: `genreTags`, `styleTags`, `country`, `yearRange`, `notes`.
```

---

## 🚧 MVP Constraints & Simplifications

- **Single Controller:** Only one user can have the `controller` role at a time. This can be managed manually in the database initially.
- **Hidden Queue:** The track queue is only visible to the controller.
- **Rate Limiting:** Skip/back actions will be rate-limited to prevent abuse (e.g., one skip every 30 seconds).
- **Stateful Refresh:** The player state (current track and position) will be restored upon browser refresh using Convex's real-time data.
- **No Voiceover Caching:** For the MVP, voiceovers can be generated on-demand without a complex caching layer.

---

## ✅ Implementation Roadmap

### Phase 1: Core Backend & Data Pipeline
1.  **Convex Setup:** Deploy the defined schema and create helper functions for querying tables.
2.  **Discogs -> YouTube Pipeline:**
    - Build a Convex action to search the Discogs API based on static filter criteria.
    - For a given Discogs result, implement a search on the YouTube API to find a suitable audio track.
    - Write a function to populate the `queue` table with valid track data.
3.  **Basic Queue Logic:** Implement a CRON job in Convex that moves the next track from `queue` to `currentTrack` when it's empty.

### Phase 2: Frontend Playback & UI
4.  **Player UI:** Build the minimal, full-screen player UI in Remix with Tailwind CSS.
5.  **YouTube Integration:** Embed the `react-youtube` player and connect it to the `currentTrack` table from Convex. Ensure it autoplays and syncs across clients.
6.  **Animation:** Add Framer Motion for smooth transitions between track info and other UI states.

### Phase 3: AI & Authentication
7.  **AI Voice Generation:**
    - Set up a Convex action that takes track info, calls the Claude API to generate a script, then calls the ElevenLabs API to generate audio.
    - Integrate this into the queueing logic so `transitionAudioUrl` is populated.
8.  **Clerk Auth:** Integrate Clerk for user signup/login. Create a Convex mutation to create a `users` document upon new user registration.
9.  **Controller Role:** Implement the Vibe Control Panel UI and logic to update user preferences in Convex. Secure this route to the `controller` role.

### Phase 4: Deployment & Analytics
10. **PostHog Integration:** Add PostHog to track key events (`song_started`, `track_skipped`, `vibe_changed`).
11. **Deployment:** Configure and deploy the entire application to Vercel.
12. **Testing & Refinement:** Conduct end-to-end testing, refine the UI, and gather initial user feedback.