import { motion } from "framer-motion";
import { useRef } from "react";

interface Track {
  _id: string;
  discogsId: string;
  title: string;
  artist: string;
  youtubeId?: string;
  durationSeconds?: number;
  year?: number;
  label?: string;
  startedAt?: number;
  playedAt?: number;
  createdAt?: number;
  transitionAudioUrl?: string;
}

interface QueueCarouselProps {
  currentTrack: Track | null;
  upcomingTracks: Track[];
  previousTracks: Track[];
  isDarkMode: boolean;
  isController?: boolean;
  onTrackClick?: (track: Track) => void;
}

export default function QueueCarousel({
  currentTrack,
  upcomingTracks,
  previousTracks,
  isDarkMode,
  isController = false,
  onTrackClick,
}: QueueCarouselProps) {

  // Get only 2 tracks: previous and upcoming (current track is shown in main player)
  const previousTrack = previousTracks.length > 0 ? previousTracks[0] : null;
  const upcomingTrack = upcomingTracks.length > 0 ? upcomingTracks[0] : null;
  
  const tracks = [
    previousTrack ? { ...previousTrack, position: 'previous' as const } : null,
    upcomingTrack ? { ...upcomingTrack, position: 'upcoming' as const } : null,
  ].filter(Boolean) as (Track & { position: string })[];

  const getTrackSize = () => {
    // 70% of main CD size (w-80 h-80 = 320px, so 70% = ~224px = w-56 h-56)
    return 'w-56 h-56';
  };

  const getTrackOpacity = () => {
    return 0.6;
  };

  // Mini CD component
  const MiniCD = ({ track, size, opacity, isPlaying = false }: {
    track: Track & { position: string };
    size: string;
    opacity: number;
    isPlaying?: boolean;
  }) => {
    const playerRef = useRef<any>(null);

    // For side CDs, we want to show only thumbnails, not playable videos
    const getYouTubeThumbnail = (videoId: string) => {
      return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    };

    return (
      <motion.div
        key={track._id}
        className={`relative ${size} flex-shrink-0`}
        style={{ opacity }}
        initial={{ scale: 0, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ 
          type: "spring", 
          stiffness: 300, 
          damping: 30,
          duration: 0.5 
        }}
      >
        {/* CD Container */}
        <div className={`w-full h-full rounded-full p-1 transition-all duration-300 ${
          isDarkMode 
            ? 'glass-card' 
            : 'bg-white/90 backdrop-blur-lg border border-black/20 shadow-lg'
        }`}>
          <div className={`cd-shape relative ring-1 transition-all duration-300 ${
            isDarkMode 
              ? 'bg-gradient-to-br from-gray-900 to-black ring-white/10' 
              : 'bg-gradient-to-br from-gray-100 to-white ring-black/10'
          } ${isPlaying ? 'animate-spin' : ''}`}
          style={{ animationDuration: isPlaying ? '20s' : undefined }}>
            
            {/* Static thumbnail only */}
            {track.youtubeId ? (
              <div className="cd-video-container">
                <img
                  src={getYouTubeThumbnail(track.youtubeId)}
                  alt={`${track.title} by ${track.artist}`}
                  className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[177.78%] h-full object-cover"
                  onError={(e) => {
                    // Fallback to lower quality thumbnail if maxres fails
                    const target = e.target as HTMLImageElement;
                    target.src = `https://img.youtube.com/vi/${track.youtubeId}/hqdefault.jpg`;
                  }}
                />
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <div className={`text-lg transition-colors duration-300 ${
                  isDarkMode ? 'text-white/40' : 'text-black/40'
                }`}>
                  🎵
                </div>
              </div>
            )}
            
            {/* CD hole */}
            <div className={`cd-hole-mini ${isDarkMode ? '' : 'light'}`}></div>
          </div>
        </div>

      </motion.div>
    );
  };

  if (tracks.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.3 }}
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ top: '50%', transform: 'translateY(-50%)' }}
    >
      {/* Side CDs positioned to align with main CD */}
      <div className="flex items-center mx-auto">
        {/* Previous track (left side) */}
        {previousTrack && (
          <div className="flex-shrink-0">
            <MiniCD
              key={previousTrack._id}
              track={{ ...previousTrack, position: 'previous' }}
              size={getTrackSize()}
              opacity={getTrackOpacity()}
              isPlaying={false}
            />
          </div>
        )}
        
        {/* Spacer for center (main CD area) - width of main CD + some padding */}
        <div className="w-80 flex-shrink-0" />
        
        {/* Upcoming track (right side) */}
        {upcomingTrack && (
          <div className="flex-shrink-0" style={{ marginLeft: '-10rem' }}>
            <MiniCD
              key={upcomingTrack._id}
              track={{ ...upcomingTrack, position: 'upcoming' }}
              size={getTrackSize()}
              opacity={getTrackOpacity()}
              isPlaying={false}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}