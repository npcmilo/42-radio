# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

104.2 FM is a minimalist, AI-curated internet radio station that streams a continuous, globally-synced feed of obscure and underground music. The system uses:
- **Remix** for the React-based SSR frontend
- **Convex** for real-time database and state management
- **Clerk** for authentication
- **Discogs API** for music discovery
- **YouTube API** for playback
- **ElevenLabs** for AI voice generation
- **Claude Sonnet** for script generation

## Common Commands

Since this is a new project, the following commands will be typical once setup:

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run Convex development
npx convex dev

# Deploy to production
npm run build
vercel deploy
```

## Architecture Overview

The system consists of several interconnected modules:

1. **Radio Playback Engine**: Synchronizes playback across all listeners using Convex state management
2. **Track Discovery Engine**: Sources music from Discogs API based on vibe filters
3. **AI Voice Host Generator**: Creates DJ announcements using Claude + ElevenLabs
4. **Authentication**: Manages controller permissions via Clerk
5. **Vibe Control Panel**: Interface for controllers to shape the musical direction
6. **Track Queue Management**: FIFO queue system managed by Convex

## Key Implementation Details

### Convex Schema Location
Database schema is defined in `convex/schema.ts` with these main tables:
- `currentTrack`: Single source of truth for synchronized playback
- `history`: Prevents track repetition
- `queue`: Upcoming tracks (FIFO)
- `users`: Stores authentication and vibe preferences
- `feedback`: User interactions (likes/skips)

### Real-time Sync
All clients sync to `currentTrack.startedAt` timestamp to ensure simultaneous playback.

### Controller Role
Only users with `role: "controller"` can:
- Skip/rewind tracks
- Modify vibe settings
- Manage the queue

### API Integration Points
- Discogs API: Music discovery based on genre/style/year filters
- YouTube API: Track playback via embedded player
- ElevenLabs API: Voice synthesis for track introductions
- Claude API: Generate radio host scripts

## Development Workflow

When implementing features:
1. Start with Convex schema/functions for data layer
2. Build Remix routes and components
3. Integrate external APIs (Discogs, YouTube, etc.)
4. Add real-time sync via Convex subscriptions
5. Implement role-based access control