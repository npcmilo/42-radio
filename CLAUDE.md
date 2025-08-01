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
6. **Test thoroughly** using the procedures below
7. **Monitor logs** for any errors or performance issues

## Testing & Quality Assurance

### Prerequisites for Testing
```bash
# Ensure all services are running
npx convex dev          # Start Convex backend
npm run dev            # Start frontend development server

# Verify environment variables are set
echo $VITE_CLERK_PUBLISHABLE_KEY
echo $VITE_YOUTUBE_API_KEY
echo $DISCOGS_API_TOKEN
echo $ELEVENLABS_API_KEY
echo $ANTHROPIC_API_KEY
```

### Backend Testing (Convex Functions)

#### Test Individual Functions
```bash
# Test basic queries
npx convex run radio:getCurrentTrack
npx convex run radio:getQueueStatus
npx convex run users:getControllerPreferences

# Test user management
npx convex run users:getOrCreateUser '{"clerkId": "test_user_123"}'

# Test queue operations  
npx convex run radio:getQueue
npx convex run queueManager:getQueueHealth
```

#### Test API Integrations
```bash
# Test Discogs search
npx convex run discogs:searchDiscogs '{"genreTags": ["electronic"], "limit": 5}'

# Test YouTube search  
npx convex run youtube:searchYouTube '{"artist": "Aphex Twin", "title": "Windowlicker"}'

# Test complete discovery pipeline
npx convex run queueManager:discoverAndQueueTracks '{"count": 3}'
```

#### Test System Maintenance
```bash
# Test logging system
npx convex run logger:getLogs '{"limit": 10}'
npx convex run logger:getRecentErrors

# Test system health
npx convex run maintenance:systemHealthCheck
npx convex run queueManager:getQueueHealth
```

### Frontend Testing

#### Component Testing
- Test authentication flows (sign in/out, role checking)
- Test real-time updates (queue changes, current track updates)
- Test player controls (play/pause, skip for controllers)
- Test responsive design across devices

#### User Flow Testing
```bash
# Test as listener
1. Open app without authentication
2. Sign in with Clerk
3. Verify listener role restrictions
4. Test real-time sync with another browser tab

# Test as controller  
1. Sign in as controller user
2. Test queue management (skip tracks, clear queue)
3. Test vibe preference updates
4. Verify changes sync across all clients
```

### Error Handling Testing

#### API Failure Scenarios
```bash
# Test with invalid API keys (temporarily modify .env)
# Test rate limit handling
# Test network connectivity issues
# Test malformed API responses
```

#### Database Error Testing
```bash
# Test with invalid data inputs
npx convex run radio:addToQueue '{"discogsId": "", "title": "", "artist": ""}'

# Test duplicate prevention
npx convex run users:recordFeedback '{"userId": "invalid", "discogsId": "test", "type": "like"}'
```

## Debugging & Monitoring

### Real-time Log Monitoring
```bash
# Watch logs in real-time during development
npx convex run logger:getLogs '{"limit": 50}' | jq

# Filter logs by component
npx convex run logger:getLogs '{"component": "discogs-search", "limit": 20}'

# Monitor errors only
npx convex run logger:getRecentErrors '{"limit": 20}'

# Check specific time periods
npx convex run logger:getLogs '{"since": 1640995200000, "limit": 100}'
```

### System Health Monitoring
```bash
# Complete system health check
npx convex run maintenance:systemHealthCheck

# Queue health and metrics
npx convex run queueManager:getQueueHealth

# Check system statistics
npx convex run maintenance:getSystemStats
```

### Debug Utilities

#### Manual Queue Management
```bash
# View current queue
npx convex run radio:getQueue '{"limit": 10}'

# Clear queue (controller only)
npx convex run queueManager:clearQueue '{"userId": "USER_ID"}'

# Force queue refill
npx convex run queueManager:discoverAndQueueTracks '{"count": 5, "forceRefresh": true}'

# Manual track advancement
npx convex run radio:advanceToNextTrack
```

#### User Management Debug
```bash
# List all users
npx convex data users

# Check user role and preferences  
npx convex run users:getUserByClerkId '{"clerkId": "YOUR_CLERK_ID"}'

# Update user role (admin function)
npx convex run users:updateUserRole '{"userId": "USER_ID", "newRole": "controller"}'
```

#### Log Analysis
```bash
# Search logs by keywords
npx convex data logs | grep "error"
npx convex data logs | grep "youtube-search"

# Performance analysis - find slow operations
npx convex run logger:getLogs '{"limit": 100}' | jq '.[] | select(.metadata.duration_ms > 1000)'
```

## Development Commands (Enhanced)

### Build & Validation
```bash
# Full build check
npm run build                    # Frontend build
npm run typecheck               # TypeScript validation  
npm run lint                    # ESLint check
npx convex deploy --dry-run     # Convex validation without deploy

# Pre-commit validation
npm run typecheck && npm run lint && npm run build
```

### Testing Commands
```bash
# Backend function testing
npm run test:backend           # Run Convex function tests
npm run test:api              # Test external API integrations

# Frontend testing  
npm run test                  # Run React component tests
npm run test:e2e             # End-to-end testing

# Integration testing
npm run test:integration     # Full system integration tests
```

### Debug & Development
```bash
# Development with debugging
npm run dev:debug            # Start with debug logging enabled
npx convex dev --verbose     # Verbose Convex logging

# Database inspection
npx convex data              # List all tables
npx convex data logs         # View logs table
npx convex data queue        # View queue contents

# Performance monitoring
npm run dev:perf            # Start with performance monitoring
```

## Error Handling & Recovery

### Common Issues & Solutions

#### Convex Connection Issues
```bash
# Check deployment key
echo $CONVEX_DEPLOY_KEY

# Reconnect to deployment
npx convex dev --once

# Clear local cache
rm -rf .convex-cache
npx convex dev --once
```

#### API Integration Failures
```bash
# Test API connectivity
curl "https://api.discogs.com/database/search?q=test" -H "Authorization: Discogs token=YOUR_TOKEN"
curl "https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&key=YOUR_KEY"

# Check API quotas and limits
npx convex run logger:getLogs '{"component": "discogs-search"}' | grep "rate limit"
```

#### Queue Management Issues
```bash
# Emergency queue reset
npx convex run queueManager:clearQueue '{"userId": "ADMIN_USER_ID"}'
npx convex run queueManager:maintainQueue

# Force system restart
npx convex run radio:advanceToNextTrack
npx convex run queueManager:discoverAndQueueTracks '{"count": 10}'
```

### System Recovery Procedures

#### Database Cleanup
```bash
# Clean old logs (keep 7 days)
npx convex run maintenance:cleanupOldLogs

# Clean old history (keep 30 days)  
npx convex run maintenance:cleanupOldHistory

# Reset queue completely
npx convex data delete --table queue --all
npx convex run queueManager:discoverAndQueueTracks '{"count": 10}'
```

#### Performance Recovery
```bash
# Check for performance bottlenecks
npx convex run logger:getLogs '{"limit": 100}' | jq '.[] | select(.metadata.duration_ms > 5000)'

# Clear excessive logs
npx convex run maintenance:cleanupOldLogs '{"daysToKeep": 1}'

# Restart all services
pkill -f "convex dev"
pkill -f "npm run dev"
npx convex dev &
npm run dev &
```

## Performance Monitoring

### Key Metrics to Monitor
- **API Response Times**: Monitor Discogs, YouTube, ElevenLabs response times
- **Queue Health**: Track queue length, refill frequency, advancement timing
- **Database Performance**: Monitor Convex function execution times
- **Error Rates**: Track error frequency by component
- **User Activity**: Monitor authentication, feedback, controller actions

### Performance Benchmarks
- Discogs API calls: < 2 seconds
- YouTube API calls: < 1 second  
- Queue advancement: < 500ms
- Log writes: < 100ms
- Database queries: < 200ms

### Optimization Procedures
```bash
# Identify slow functions
npx convex run logger:getLogs '{"limit": 200}' | jq '.[] | select(.metadata.duration_ms > 2000) | {component, message, duration: .metadata.duration_ms}'

# Monitor API usage patterns
npx convex run logger:getLogs '{"component": "discogs-search", "limit": 50}' | jq '.[] | .metadata.searchUrl'

# Check queue efficiency
npx convex run queueManager:getQueueHealth
```