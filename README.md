# 104.2 FM - AI-Curated Internet Radio

**104.2 FM** is a minimalist, AI-curated internet radio station designed for the musically adventurous. It streams a continuous, globally-synced feed of obscure and underground music discovered from the Discogs database.

## 🚀 Quick Start

### Prerequisites

Before you can run the application, you'll need to obtain API keys from the following services:

1. **Clerk** (Authentication) - [clerk.dev](https://clerk.dev)
2. **YouTube Data API v3** - [Google Cloud Console](https://console.cloud.google.com)
3. **Discogs API** - [discogs.com/settings/developers](https://www.discogs.com/settings/developers)
4. **ElevenLabs** (Voice Synthesis) - [elevenlabs.io](https://elevenlabs.io)
5. **Claude API** (Anthropic) - [console.anthropic.com](https://console.anthropic.com)

### Setup Instructions

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/npcmilo/42-radio.git
   cd 42-radio
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add your API keys:
   ```bash
   VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_clerk_key
   VITE_YOUTUBE_API_KEY=your_youtube_api_key
   DISCOGS_API_TOKEN=your_discogs_token
   ELEVENLABS_API_KEY=your_elevenlabs_key
   ANTHROPIC_API_KEY=your_anthropic_key
   ```

3. **Initialize Convex database:**
   ```bash
   npx convex dev
   ```
   Follow the prompts to create a new project and get your deployment URL.

4. **Run the development server:**
   ```bash
   npm run dev
   ```

## 🎵 How It Works

- **Global Sync**: All listeners hear the same track simultaneously
- **AI Host**: Generated voice introductions for each track
- **Vibe Control**: Authenticated controllers can adjust musical direction
- **Real-time**: Built on Convex for instant updates across all clients

## 🛠️ Tech Stack

- **Frontend**: React Router v7 (Remix) + Tailwind CSS
- **Backend**: Convex (database + real-time sync)
- **Auth**: Clerk
- **APIs**: Discogs, YouTube, ElevenLabs, Claude
- **Deployment**: Vercel

## 📋 API Key Setup Guide

### Clerk Authentication
1. Sign up at [clerk.dev](https://clerk.dev)
2. Create a new application
3. Copy the "Publishable Key" from your dashboard

### YouTube Data API v3
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable "YouTube Data API v3"
4. Create credentials → API Key
5. Restrict the key (optional but recommended)

### Discogs API
1. Create account at [discogs.com](https://www.discogs.com)
2. Go to [Developer Settings](https://www.discogs.com/settings/developers)
3. Generate a new token

### ElevenLabs Voice API
1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to your profile settings
3. Create an API key (free tier available)

### Claude API (Anthropic)
1. Create account at [console.anthropic.com](https://console.anthropic.com)
2. Add billing ($5 minimum)
3. Create API key

## 🚀 Deployment

Build for production:
```bash
npm run build
```

Deploy to Vercel:
```bash
vercel deploy
```

Make sure to add all environment variables to your Vercel project settings.

## 📖 Documentation

See [CLAUDE.md](./CLAUDE.md) for development guidance and architecture details.
