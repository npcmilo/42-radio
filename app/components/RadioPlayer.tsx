import { useUser } from "@clerk/clerk-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import YouTube, { YouTubeProps } from "react-youtube";
import { api } from "../../convex/_generated/api";
import QueueCarousel from "./QueueCarousel";

interface RadioPlayerProps {
  isDarkMode: boolean;
}

export default function RadioPlayer({ isDarkMode }: RadioPlayerProps) {
  const { user } = useUser();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [isPlayingTransition, setIsPlayingTransition] = useState(false);
  const [transitionEnded, setTransitionEnded] = useState(false);
  const [previousTrackId, setPreviousTrackId] = useState<string | null>(null);
  const [playbackContinuity, setPlaybackContinuity] = useState(false);
  const playerRef = useRef<any>(null);
  const transitionAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayerActionRef = useRef<number>(0);
  
  // Convex queries and mutations
  const currentTrack = useQuery(api.radio.getCurrentTrack);
  const queue = useQuery(api.radio.getQueue, { limit: 5 });
  const history = useQuery(api.radio.getTrackHistory, { limit: 3 });
  const queueStatus = useQuery(api.radio.getQueueStatus);
  
  // Get user data including role
  const userData = useQuery(api.users.getUserByClerkId, 
    user ? { clerkId: user.id } : "skip"
  );
  
  // Like status for current track
  const isLiked = useQuery(api.users.isTrackLiked,
    userData && currentTrack 
      ? { userId: userData._id, discogsId: currentTrack.discogsId }
      : "skip"
  );
  
  const likeCount = useQuery(api.users.getTrackLikeCount,
    currentTrack ? { discogsId: currentTrack.discogsId } : "skip"
  );

  // Thumbs rating status for current track
  const userThumbsRating = useQuery(api.users.getUserTrackRating,
    userData && currentTrack 
      ? { userId: userData._id, discogsId: currentTrack.discogsId }
      : "skip"
  );

  const trackRatings = useQuery(api.users.getTrackRating,
    currentTrack ? { discogsId: currentTrack.discogsId } : "skip"
  );
  
  const advanceTrack = useAction(api.radio.advanceToNextTrackWithContext);
  const getOrCreateUser = useMutation(api.users.getOrCreateUser);
  const toggleLike = useMutation(api.users.toggleLike);
  const toggleThumbsRating = useMutation(api.users.toggleThumbsRating);
  
  // Create user on first visit
  useEffect(() => {
    if (user && !userData) {
      getOrCreateUser({ clerkId: user.id });
    }
  }, [user, userData, getOrCreateUser]);

  // Get track status with timing info
  const trackStatus = useQuery(api.trackMonitor.getCurrentTrackStatus);

  // Smart track change detection - only reset when truly necessary
  useEffect(() => {
    const currentId = currentTrack?._id;
    
    // If this is the first track or a genuinely new track
    if (currentId && currentId !== previousTrackId) {
      const isActualTrackChange = previousTrackId !== null;
      
      if (isActualTrackChange) {
        console.log('🎵 Track changing from', previousTrackId, 'to', currentId);
        
        // Enable playback continuity mode during track changes
        setPlaybackContinuity(true);
        
        // Only reset transition states, preserve playback intent
        setIsPlayingTransition(false);
        setTransitionEnded(false);
        
        // Don't immediately stop playback - let the new track take over
        // setIsPlaying(false); // REMOVED - this was causing the interruption
        
        // Reset continuity mode after a brief delay
        setTimeout(() => setPlaybackContinuity(false), 1000);
      } else {
        console.log('🎵 Initial track loaded:', currentId);
        // First track load - safe to reset everything
        setIsPlayingTransition(false);
        setTransitionEnded(false);
        setIsPlaying(false);
        setPlaybackContinuity(false);
      }
      
      setPreviousTrackId(currentId);
    } else if (!currentId && previousTrackId) {
      // Track was removed
      console.log('🎵 Track removed');
      setIsPlaying(false);
      setIsPlayingTransition(false);
      setTransitionEnded(false);
      setPlaybackContinuity(false);
      setPreviousTrackId(null);
    }
  }, [currentTrack?._id, previousTrackId]);

  // Handle transition audio when track changes
  useEffect(() => {
    if (currentTrack?.transitionAudioUrl && !isPlayingTransition && !transitionEnded) {
      console.log('🎤 Starting transition audio for:', currentTrack.title);
      
      // Smoothly transition from current playback to transition audio
      if (playerRef.current && playerReady && isPlaying) {
        try {
          // Gradually reduce volume instead of abrupt pause
          const currentVolume = playerRef.current.getVolume?.() || 100;
          playerRef.current.setVolume(Math.max(0, currentVolume * 0.3));
          
          // Mute but don't pause immediately - let transition audio start first
          setTimeout(() => {
            try {
              playerRef.current?.pauseVideo();
              playerRef.current?.mute();
            } catch (error) {
              console.warn("Error controlling YouTube player during transition:", error);
            }
          }, 200);
        } catch (error) {
          console.warn("Error controlling YouTube player:", error);
        }
      }
      
      // Start transition audio
      setIsPlayingTransition(true);
      setTransitionEnded(false);
      
      if (transitionAudioRef.current) {
        transitionAudioRef.current.src = currentTrack.transitionAudioUrl;
        transitionAudioRef.current.volume = 0.9;
        transitionAudioRef.current.play().catch((error) => {
          console.error('Error playing transition audio:', error);
          // Fallback: skip transition audio and go straight to track
          handleTransitionEnd();
        });
      }
    }
  }, [currentTrack, isPlayingTransition, transitionEnded, playerReady]);

  // Enhanced auto-play with continuity support
  useEffect(() => {
    if (currentTrack && playerReady && trackStatus && !trackStatus.timing.hasExpired) {
      const shouldAutoPlay = !isPlaying && (!currentTrack.transitionAudioUrl || transitionEnded);
      const isContinuityMode = playbackContinuity && !isPlayingTransition;
      
      if (shouldAutoPlay || isContinuityMode) {
        console.log('🎵 Auto-playing track:', currentTrack.title, { shouldAutoPlay, isContinuityMode, transitionEnded });
        
        // Wait for transition audio to complete if present
        if (currentTrack.transitionAudioUrl && !transitionEnded && !isPlayingTransition) {
          console.log('🎤 Waiting for transition audio to complete');
          return;
        }
        
        // Safe player operation with retry logic
        const playVideo = async () => {
          if (!playerRef.current) return;
          
          const now = Date.now();
          if (now - lastPlayerActionRef.current < 500) {
            console.log('🎵 Throttling player action');
            return;
          }
          lastPlayerActionRef.current = now;
          
          try {
            // Ensure player is ready and unmuted
            if (playerRef.current.unMute) {
              playerRef.current.unMute();
              playerRef.current.setVolume(100);
            }
            
            await playerRef.current.playVideo();
            setIsPlaying(true);
            console.log('🎵 Successfully started playback');
          } catch (error) {
            console.warn("Error playing video in auto-play:", error);
            // Retry once after a brief delay
            setTimeout(() => {
              try {
                playerRef.current?.playVideo();
                setIsPlaying(true);
              } catch (retryError) {
                console.error('Failed to start playback after retry:', retryError);
              }
            }, 1000);
          }
        };
        
        playVideo();
      }
    }
  }, [currentTrack, playerReady, trackStatus, transitionEnded, isPlaying, playbackContinuity, isPlayingTransition]);

  // Enhanced track monitoring with sync recovery
  useEffect(() => {
    if (!trackStatus || !currentTrack) return;
    
    let syncCheckCount = 0;
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - trackStatus.track.startedAt;
      const duration = (trackStatus.track.durationSeconds || 180) * 1000;
      
      if (elapsed >= duration) {
        console.log('🎵 Track expired on client side, stopping playback');
        // Track has expired - prepare for next track
        if (isPlaying) {
          setIsPlaying(false);
        }
      } else {
        // Periodic sync check (every 30 seconds) without disrupting playback
        syncCheckCount++;
        if (syncCheckCount >= 30 && playerRef.current && playerReady && isPlaying) {
          try {
            // Check if YouTube player is still playing
            const playerState = playerRef.current.getPlayerState?.();
            if (playerState === 2 || playerState === 0) { // Paused or ended
              console.log('🎵 Detected player desync, attempting recovery');
              // Attempt to resume playback
              playerRef.current.playVideo();
            }
            syncCheckCount = 0; // Reset counter
          } catch (error) {
            console.warn('Error during sync check:', error);
          }
        }
      }
    }, 1000); // Check every second
    
    return () => clearInterval(checkInterval);
  }, [trackStatus, currentTrack, isPlaying, playerReady]);

  const handlePlay = () => {
    if (playerRef.current && playerReady) {
      const now = Date.now();
      if (now - lastPlayerActionRef.current < 300) return; // Prevent rapid clicks
      lastPlayerActionRef.current = now;
      
      try {
        console.log('🎵 Manual play triggered');
        playerRef.current.playVideo();
        setIsPlaying(true);
      } catch (error) {
        console.warn("Error playing video:", error);
      }
    }
  };

  const handlePause = () => {
    if (playerRef.current && playerReady) {
      const now = Date.now();
      if (now - lastPlayerActionRef.current < 300) return; // Prevent rapid clicks
      lastPlayerActionRef.current = now;
      
      try {
        console.log('🎵 Manual pause triggered');
        playerRef.current.pauseVideo();
        setIsPlaying(false);
      } catch (error) {
        console.warn("Error pausing video:", error);
      }
    }
  };

  const handleSkip = async () => {
    if (userData?.role === "controller") {
      try {
        console.log('🎵 Controller skip initiated');
        // Enable continuity mode before skipping to minimize interruption
        setPlaybackContinuity(true);
        await advanceTrack();
        // Continuity mode will be disabled automatically by the track change effect
      } catch (error) {
        console.error("Error skipping track:", error);
        setPlaybackContinuity(false); // Reset on error
      }
    }
  };

  const handleLike = async () => {
    if (!userData || !currentTrack) return;
    
    try {
      console.log('❤️ Toggling like for track:', currentTrack.title);
      await toggleLike({
        userId: userData._id,
        trackInfo: {
          discogsId: currentTrack.discogsId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          youtubeId: currentTrack.youtubeId,
          year: currentTrack.year,
          label: currentTrack.label,
        },
      });
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const handleThumbsRating = async (rating: "up" | "down") => {
    if (!userData || !currentTrack) return;
    
    try {
      console.log(`👍/👎 Toggling thumbs ${rating} for track:`, currentTrack.title);
      await toggleThumbsRating({
        userId: userData._id,
        trackInfo: {
          discogsId: currentTrack.discogsId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          youtubeId: currentTrack.youtubeId,
          year: currentTrack.year,
          label: currentTrack.label,
        },
        rating,
      });
    } catch (error) {
      console.error("Error toggling thumbs rating:", error);
    }
  };

  const isController = userData?.role === "controller";

  // Calculate playback position for sync
  const getPlaybackPosition = () => {
    if (!trackStatus) return 0;
    return Math.max(0, trackStatus.timing.elapsedMs / 1000); // Convert to seconds
  };

  // Optimized YouTube player options with continuity support
  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      // Smart autoplay: only disable if transition is currently playing
      autoplay: isPlayingTransition ? 0 : 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3, // Hide annotations
      disablekb: 1, // Disable keyboard controls
      fs: 0, // Disable fullscreen
      playsinline: 1, // Better mobile support
      // Use calculated position for sync, but don't if in continuity mode
      start: playbackContinuity ? 0 : Math.floor(getPlaybackPosition()),
      origin: typeof window !== 'undefined' ? window.location.origin : '',
      enablejsapi: 1, // Ensure JS API is enabled
    },
  };

  // Handle player ready with enhanced continuity
  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    console.log('🎵 YouTube player ready for:', currentTrack?.title);
    playerRef.current = event.target;
    setPlayerReady(true);
    
    // Maintain playback continuity if we were previously playing
    const shouldContinuePlaying = playbackContinuity && !isPlayingTransition;
    
    // Auto-start logic with better transition handling
    if (trackStatus && !trackStatus.timing.hasExpired) {
      const canAutoStart = !isPlayingTransition && (!currentTrack?.transitionAudioUrl || transitionEnded);
      
      if (canAutoStart || shouldContinuePlaying) {
        console.log('🎵 Auto-starting playback on ready', { canAutoStart, shouldContinuePlaying });
        setIsPlaying(true);
        
        try {
          // Ensure proper volume and unmuted state
          event.target.unMute();
          event.target.setVolume(100);
          event.target.playVideo();
        } catch (error) {
          console.warn("Error playing video on ready:", error);
        }
      } else {
        console.log('🎵 Waiting for transition audio to complete before starting');
      }
    }
  };

  // Handle video end
  const onPlayerEnd: YouTubeProps['onEnd'] = () => {
    console.log('🎵 YouTube track ended naturally');
    setIsPlaying(false);
    // Server cron will handle track advancement, but we can be proactive
    // Don't immediately advance - let the server handle it to maintain sync
  };

  // Enhanced player state change handling
  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    const states = {
      '-1': 'unstarted',
      '0': 'ended', 
      '1': 'playing',
      '2': 'paused',
      '3': 'buffering',
      '5': 'cued'
    };
    
    const stateName = states[String(event.data) as keyof typeof states] || 'unknown';
    console.log('🎵 Player state changed to:', stateName);
    
    // Only update our state for definitive play/pause states
    // Ignore buffering and other transitional states to prevent UI flicker
    if (event.data === 1) { // Playing
      setIsPlaying(true);
    } else if (event.data === 2) { // Paused (but not ended - that's handled separately)
      // Only set to false if we're not in a transition state
      if (!isPlayingTransition && !playbackContinuity) {
        setIsPlaying(false);
      }
    } else if (event.data === 0) { // Ended
      setIsPlaying(false);
    }
    // Don't update state for buffering (3) or cued (5) to prevent interruptions
  };

  // Handle transition audio events with smooth handoff
  const handleTransitionEnd = () => {
    console.log('🎤 Transition audio ended, starting main track');
    setIsPlayingTransition(false);
    setTransitionEnded(true);
    
    // Smooth handoff to YouTube track
    if (currentTrack && playerReady && trackStatus && !trackStatus.timing.hasExpired) {
      // Brief delay to ensure smooth transition
      setTimeout(() => {
        if (playerRef.current) {
          try {
            console.log('🎵 Starting main track after transition');
            playerRef.current.unMute();
            playerRef.current.setVolume(100);
            playerRef.current.playVideo();
            setIsPlaying(true);
          } catch (error) {
            console.warn("Error starting YouTube player after transition:", error);
            // Retry mechanism
            setTimeout(() => {
              try {
                playerRef.current?.playVideo();
                setIsPlaying(true);
              } catch (retryError) {
                console.error('Failed to start track after transition retry:', retryError);
              }
            }, 500);
          }
        }
      }, 100);
    }
  };

  const handleTransitionError = (error?: any) => {
    console.warn("Transition audio failed to load, skipping to main track", error);
    
    // Reset transition states
    setIsPlayingTransition(false);
    setTransitionEnded(true);
    
    // Immediately start the main track as fallback
    if (currentTrack && playerReady && trackStatus && !trackStatus.timing.hasExpired) {
      console.log('🎵 Fallback: Starting main track immediately due to transition audio error');
      
      setTimeout(() => {
        if (playerRef.current) {
          try {
            playerRef.current.unMute();
            playerRef.current.setVolume(100);
            playerRef.current.playVideo();
            setIsPlaying(true);
          } catch (playerError) {
            console.error('Failed to start main track after transition error:', playerError);
          }
        }
      }, 100);
    }
  };

  return (
    <motion.div 
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="w-full max-w-md mx-auto"
    >
      {/* Track Info - Above CD */}
      <AnimatePresence mode="wait">
        <motion.div 
          key={currentTrack?._id || "empty"}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center mb-6"
        >
          {currentTrack ? (
            <div className="flex flex-col items-center justify-center gap-1">
              <h2 className={`text-2xl font-regular truncate transition-colors duration-300 ${
                isDarkMode ? 'text-white' : 'text-black'
              }`}>
                {currentTrack.title}
              </h2>
              <p className={`text-sm font-light truncate transition-colors duration-300 ${
                isDarkMode ? 'text-white/60' : 'text-black/60'
              }`}>
                {currentTrack.artist}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <h2 className={`text-lg font-medium transition-colors duration-300 ${
                isDarkMode ? 'text-white' : 'text-black'
              }`}>
                104.2 FM
              </h2>
              <span className={`text-sm transition-colors duration-300 ${
                isDarkMode ? 'text-white/40' : 'text-black/40'
              }`}>
                •
              </span>
              <p className={`text-sm transition-colors duration-300 ${
                isDarkMode ? 'text-white/60' : 'text-black/60'
              }`}>
                {queueStatus?.queueLength === 0 
                  ? "Loading..." 
                  : "Ready"}
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* CD Player Container */}
      <div className="relative mb-8">
        {/* Queue Carousel - positioned behind main CD */}
        <QueueCarousel
          currentTrack={currentTrack || null}
          upcomingTracks={queue || []}
          previousTracks={history || []}
          isDarkMode={isDarkMode}
          isController={isController}
          onTrackClick={(track) => {
            if (isController) {
              console.log("Track clicked:", track);
              // TODO: Implement track skip/selection functionality
            }
          }}
        />
        {/* CD Shape Player */}
        <motion.div 
          className="relative w-80 h-80 mx-auto"
          animate={isPlaying ? { } : {}}
          transition={isPlaying ? { 
            duration: 20, 
            repeat: Infinity, 
            ease: "linear" 
          } : {}}
        >
          <div className={`rounded-full w-full h-full p-4 modern-shadow transition-colors duration-300 ${
            isDarkMode 
              ? 'glass-card' 
              : 'bg-white/90 backdrop-blur-lg border border-black/20 shadow-2xl'
          }`}>
            <div className={`cd-shape relative ring-2 transition-colors duration-300 ${
              isDarkMode 
                ? 'bg-gradient-to-br from-gray-900 to-black ring-white/20' 
                : 'bg-gradient-to-br from-gray-100 to-white ring-black/20'
            }`}>
              {currentTrack && currentTrack.youtubeId ? (
                <>
                  {/* Video container with proper scaling */}
                  <div className="cd-video-container">
                    <YouTube
                      key={`player-${currentTrack.youtubeId}`} // Stable key to prevent unnecessary recreation
                      videoId={currentTrack.youtubeId}
                      opts={opts}
                      onReady={onPlayerReady}
                      onEnd={onPlayerEnd}
                      onStateChange={onPlayerStateChange}
                      onError={(error: any) => {
                        console.error('🎵 YouTube player error:', error);
                        // Could implement fallback logic here
                      }}
                      className="youtube-player"
                    />
                  </div>
                  {/* Hollow CD Center Hole */}
                  <div className={`cd-hole ${isDarkMode ? '' : 'light'}`}></div>
                </>
              ) : (
                <>
                  <div className="w-full h-full flex items-center justify-center text-center">
                    <div className={`transition-colors duration-300 ${
                      isDarkMode ? 'text-white/60' : 'text-black/60'
                    }`}>
                      <motion.div 
                        className="text-4xl mb-2"
                        animate={{ scale: [1, 1.1, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      >
                        🎵
                      </motion.div>
                      <div className="text-sm">
                        {queueStatus?.queueLength === 0 
                          ? "Building queue..." 
                          : "Loading track..."}
                      </div>
                    </div>
                  </div>
                  {/* Hollow CD Center Hole */}
                  <div className={`cd-hole ${isDarkMode ? '' : 'light'}`}></div>
                </>
              )}
            </div>
          </div>
        </motion.div>

      </div>

      {/* Rating Buttons - Above Controls */}
      {user && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col items-center mb-6 gap-3"
        >
          {/* Horizontal Button Layout: Thumbs Up | Heart | Thumbs Down */}
          <div className="flex items-center gap-4">
            {/* Thumbs Up Button */}
            <motion.button 
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                isDarkMode 
                  ? userThumbsRating === "up"
                    ? 'backdrop-blur-xl bg-gradient-to-br from-green-500/30 to-green-600/20 text-green-400 hover:from-green-500/40 hover:to-green-600/30 shadow-xl' 
                    : 'backdrop-blur-xl bg-gradient-to-br from-white/20 to-white/10 text-white/70 hover:from-white/25 hover:to-white/15 hover:text-white shadow-xl'
                  : userThumbsRating === "up"
                    ? 'backdrop-blur-xl bg-gradient-to-br from-green-500/20 to-green-600/10 text-green-600 hover:from-green-500/30 hover:to-green-600/20 shadow-xl'
                    : 'backdrop-blur-xl bg-gradient-to-br from-black/3 to-black/8 text-black/70 hover:from-black/5 hover:to-black/10 hover:text-black shadow-xl'
              }`}
              onClick={() => handleThumbsRating("up")}
              disabled={!currentTrack || !userData}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="Rate track positively"
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill={userThumbsRating === "up" ? "currentColor" : "none"} 
                xmlns="http://www.w3.org/2000/svg"
                className="transition-all duration-300"
              >
                <path 
                  d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>

            {/* Heart/Save Button */}
            <motion.button 
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 ${
                isDarkMode 
                  ? isLiked 
                    ? 'backdrop-blur-xl bg-gradient-to-br from-red-500/30 to-red-600/20 text-red-400 hover:from-red-500/40 hover:to-red-600/30 shadow-xl' 
                    : 'backdrop-blur-xl bg-gradient-to-br from-white/25 to-white/15 text-white/90 hover:from-white/30 hover:to-white/20 hover:text-white shadow-xl'
                  : isLiked
                    ? 'backdrop-blur-xl bg-gradient-to-br from-red-500/20 to-red-600/10 text-red-500 hover:from-red-500/30 hover:to-red-600/20 shadow-xl'
                    : 'backdrop-blur-xl bg-gradient-to-br from-black/5 to-black/10 text-black/90 hover:from-black/5 hover:to-black/10 hover:text-black shadow-xl'
              }`}
              onClick={handleLike}
              disabled={!currentTrack || !userData}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title={isLiked ? "Unlike track" : "Like track"}
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill={isLiked ? "currentColor" : "none"} 
                xmlns="http://www.w3.org/2000/svg"
                className="transition-all duration-300"
              >
                <path 
                  d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>

            {/* Thumbs Down Button */}
            <motion.button 
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                isDarkMode 
                  ? userThumbsRating === "down"
                    ? 'backdrop-blur-xl bg-gradient-to-br from-red-500/30 to-red-600/20 text-red-400 hover:from-red-500/40 hover:to-red-600/30 shadow-xl' 
                    : 'backdrop-blur-xl bg-gradient-to-br from-white/20 to-white/10 text-white/70 hover:from-white/25 hover:to-white/15 hover:text-white shadow-xl'
                  : userThumbsRating === "down"
                    ? 'backdrop-blur-xl bg-gradient-to-br from-red-500/20 to-red-600/10 text-red-600 hover:from-red-500/30 hover:to-red-600/20 shadow-xl'
                    : 'backdrop-blur-xl bg-gradient-to-br from-black/3 to-black/8 text-black/70 hover:from-black/5 hover:to-black/10 hover:text-black shadow-xl'
              }`}
              onClick={() => handleThumbsRating("down")}
              disabled={!currentTrack || !userData}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="Rate track negatively"
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill={userThumbsRating === "down" ? "currentColor" : "none"} 
                xmlns="http://www.w3.org/2000/svg"
                className="transition-all duration-300"
              >
                <path 
                  d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </motion.button>
          </div>

          {/* Rating Counts Row */}
          <div className="flex items-center gap-6 text-xs font-medium">
            {/* Thumbs Up Count */}
            <div className="flex items-center justify-center w-6">
              {trackRatings && trackRatings.thumbsUp > 0 && (
                <span className={`transition-colors duration-300 ${
                  isDarkMode ? 'text-green-400/80' : 'text-green-600/80'
                }`}>
                  {trackRatings.thumbsUp}
                </span>
              )}
            </div>

            {/* Heart Count */}
            <div className="flex items-center justify-center w-6">
              {likeCount && likeCount > 0 && (
                <span className={`transition-colors duration-300 ${
                  isDarkMode ? 'text-white/70' : 'text-black/70'
                }`}>
                  {likeCount}
                </span>
              )}
            </div>

            {/* Thumbs Down Count */}
            <div className="flex items-center justify-center w-6">
              {trackRatings && trackRatings.thumbsDown > 0 && (
                <span className={`transition-colors duration-300 ${
                  isDarkMode ? 'text-red-400/80' : 'text-red-600/80'
                }`}>
                  {trackRatings.thumbsDown}
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Play Controls */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex justify-center items-center gap-3 mb-6"
      >
        {isController && (
          <motion.button 
            className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 ${
              isDarkMode 
                ? 'backdrop-blur-xl bg-gradient-to-br from-white/25 to-white/15 text-white/90 hover:from-white/30 hover:to-white/20 hover:text-white shadow-xl' 
                : 'backdrop-blur-xl bg-gradient-to-br from-black/5 to-black/10 text-black/90 hover:from-black/5 hover:to-black/10 hover:text-black shadow-xl'
            }`}
            disabled={!currentTrack}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="Previous track"
          >
            ⏮
          </motion.button>
        )}
        
        {/* Play/Pause Button */}
        <motion.button
          className={`w-16 h-16 rounded-full backdrop-blur-xl flex items-center justify-center text-2xl font-bold transition-all duration-300 ${
            isDarkMode 
              ? 'bg-gradient-to-br from-white/30 to-white/20 text-white hover:from-white/35 hover:to-white/25 shadow-xl' 
              : 'bg-gradient-to-br from-black/5 to-black/10 text-black hover:from-black/5 hover:to-black/10 shadow-xl'
          }`}
          onClick={isPlaying ? handlePause : handlePlay}
          disabled={!currentTrack}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300 }}
        >
          {isPlaying ? "⏸" : "▶"}
        </motion.button>

        {isController && (
          <motion.button 
            className={`w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all duration-300 ${
              isDarkMode 
                ? 'backdrop-blur-xl bg-gradient-to-br from-white/25 to-white/15 text-white/90 hover:from-white/30 hover:to-white/20 hover:text-white shadow-xl' 
                : 'backdrop-blur-xl bg-gradient-to-br from-black/5 to-black/10 text-black/90 hover:from-black/5 hover:to-black/10 hover:text-black shadow-xl'
            }`}
            onClick={handleSkip}
            disabled={!currentTrack}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            title="Skip track"
          >
            ⏭
          </motion.button>
        )}
      </motion.div>

      {/* Hidden audio element for transition audio */}
      <audio
        ref={transitionAudioRef}
        onEnded={handleTransitionEnd}
        onError={handleTransitionError}
        onLoadStart={() => console.log('🎤 Transition audio loading started')}
        onCanPlay={() => console.log('🎤 Transition audio can play')}
        onPlay={() => console.log('🎤 Transition audio playing')}
        onPause={() => console.log('🎤 Transition audio paused')}
        onAbort={() => {
          console.warn('🎤 Transition audio aborted');
          handleTransitionError();
        }}
        onStalled={() => {
          console.warn('🎤 Transition audio stalled');
          // Give it a moment to recover, then fallback
          setTimeout(() => {
            if (isPlayingTransition && transitionAudioRef.current?.paused) {
              handleTransitionError();
            }
          }, 3000);
        }}
        preload="auto"
        style={{ display: 'none' }}
      />

    </motion.div>
  );
}