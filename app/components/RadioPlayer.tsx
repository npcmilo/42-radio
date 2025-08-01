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
  const playerRef = useRef<any>(null);
  const transitionAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Convex queries and mutations
  const currentTrack = useQuery(api.radio.getCurrentTrack);
  const queue = useQuery(api.radio.getQueue, { limit: 5 });
  const history = useQuery(api.radio.getTrackHistory, { limit: 3 });
  const queueStatus = useQuery(api.radio.getQueueStatus);
  
  // Get user data including role
  const userData = useQuery(api.users.getUserByClerkId, 
    user ? { clerkId: user.id } : "skip"
  );
  
  const advanceTrack = useAction(api.radio.advanceToNextTrackWithContext);
  const getOrCreateUser = useMutation(api.users.getOrCreateUser);
  
  // Create user on first visit
  useEffect(() => {
    if (user && !userData) {
      getOrCreateUser({ clerkId: user.id });
    }
  }, [user, userData, getOrCreateUser]);

  // Get track status with timing info
  const trackStatus = useQuery(api.trackMonitor.getCurrentTrackStatus);

  // Reset transition state when track changes
  useEffect(() => {
    setIsPlayingTransition(false);
    setTransitionEnded(false);
    setIsPlaying(false);
  }, [currentTrack?._id]);

  // Handle transition audio when track changes
  useEffect(() => {
    if (currentTrack?.transitionAudioUrl && !isPlayingTransition && !transitionEnded) {
      // Pause and mute YouTube player first to prevent overlap (only if player is ready)
      if (playerRef.current && playerReady) {
        try {
          playerRef.current.pauseVideo();
          playerRef.current.mute(); // Mute YouTube during transition
        } catch (error) {
          console.warn("Error controlling YouTube player:", error);
        }
      }
      
      // Start transition audio
      setIsPlayingTransition(true);
      setTransitionEnded(false);
      
      if (transitionAudioRef.current) {
        transitionAudioRef.current.src = currentTrack.transitionAudioUrl;
        transitionAudioRef.current.volume = 0.9; // Set appropriate volume
        transitionAudioRef.current.play().catch(console.error);
      }
    }
  }, [currentTrack, isPlayingTransition, transitionEnded, playerReady]);

  // Auto-play when track is available and should be playing
  useEffect(() => {
    if (currentTrack && playerReady && !isPlaying && trackStatus) {
      // Check if track should still be playing
      if (!trackStatus.timing.hasExpired) {
        // If there's transition audio, wait for it to complete
        if (currentTrack.transitionAudioUrl && !transitionEnded) {
          // Pause the YouTube player to prevent simultaneous playback
          if (playerRef.current && playerReady) {
            try {
              playerRef.current.pauseVideo();
            } catch (error) {
              console.warn("Error pausing YouTube player:", error);
            }
          }
          return; // Wait for transition to complete
        }
        
        setIsPlaying(true);
        if (playerRef.current && playerReady) {
          try {
            playerRef.current.playVideo();
          } catch (error) {
            console.warn("Error playing video in auto-play:", error);
          }
        }
      }
    }
  }, [currentTrack, playerReady, trackStatus, transitionEnded]);

  // Check for track expiration periodically
  useEffect(() => {
    if (!trackStatus || !currentTrack) return;
    
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - trackStatus.track.startedAt;
      const duration = (trackStatus.track.durationSeconds || 180) * 1000;
      
      if (elapsed >= duration) {
        // Track has expired on client side
        // The server cron will handle the actual advancement
        setIsPlaying(false);
      }
    }, 1000); // Check every second
    
    return () => clearInterval(checkInterval);
  }, [trackStatus, currentTrack]);

  const handlePlay = () => {
    if (playerRef.current && playerReady) {
      try {
        playerRef.current.playVideo();
        setIsPlaying(true);
      } catch (error) {
        console.warn("Error playing video:", error);
      }
    }
  };

  const handlePause = () => {
    if (playerRef.current && playerReady) {
      try {
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
        await advanceTrack();
      } catch (error) {
        console.error("Error skipping track:", error);
      }
    }
  };

  const isController = userData?.role === "controller";

  // Calculate playback position for sync
  const getPlaybackPosition = () => {
    if (!trackStatus) return 0;
    return Math.max(0, trackStatus.timing.elapsedMs / 1000); // Convert to seconds
  };

  // YouTube player options
  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: (currentTrack?.transitionAudioUrl && !transitionEnded) ? 0 : 1, // Don't autoplay if transition audio is present
      controls: 0,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      start: Math.floor(getPlaybackPosition()),
      origin: typeof window !== 'undefined' ? window.location.origin : '',
    },
  };

  // Handle player ready
  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    playerRef.current = event.target;
    setPlayerReady(true);
    
    // Don't auto-start if there's transition audio playing
    if (trackStatus && !trackStatus.timing.hasExpired && !isPlayingTransition) {
      // Only start if no transition audio or transition has ended
      if (!currentTrack?.transitionAudioUrl || transitionEnded) {
        setIsPlaying(true);
        try {
          event.target.playVideo();
        } catch (error) {
          console.warn("Error playing video on ready:", error);
        }
      }
    }
  };

  // Handle video end
  const onPlayerEnd: YouTubeProps['onEnd'] = () => {
    setIsPlaying(false);
    // Server cron will handle track advancement
  };

  // Handle player state change
  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    // Update playing state based on player state
    if (event.data === 1) { // Playing
      setIsPlaying(true);
    } else if (event.data === 2 || event.data === 0) { // Paused or Ended
      setIsPlaying(false);
    }
  };

  // Handle transition audio events
  const handleTransitionEnd = () => {
    setIsPlayingTransition(false);
    setTransitionEnded(true);
    
    // Start YouTube track if it should be playing
    if (currentTrack && playerReady && trackStatus && !trackStatus.timing.hasExpired) {
      setIsPlaying(true);
      // Unmute and play YouTube track
      if (playerRef.current && playerReady) {
        try {
          playerRef.current.unMute();
          playerRef.current.setVolume(100);
          playerRef.current.playVideo();
        } catch (error) {
          console.warn("Error starting YouTube player after transition:", error);
        }
      }
    }
  };

  const handleTransitionError = () => {
    console.warn("Transition audio failed to load, skipping to main track");
    handleTransitionEnd();
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
                      videoId={currentTrack.youtubeId}
                      opts={opts}
                      onReady={onPlayerReady}
                      onEnd={onPlayerEnd}
                      onStateChange={onPlayerStateChange}
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
        preload="auto"
        style={{ display: 'none' }}
      />

    </motion.div>
  );
}