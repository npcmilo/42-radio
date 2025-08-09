import { useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Link } from "@remix-run/react";
import { api } from "../../convex/_generated/api";

export default function SavedTracks() {
  const { user } = useUser();
  
  // Get user data
  const userData = useQuery(api.users.getUserByClerkId, 
    user ? { clerkId: user.id } : "skip"
  );
  
  // Get saved tracks
  const savedTracks = useQuery(api.users.getUserSavedTracks,
    userData ? { userId: userData._id } : "skip"
  );

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Sign in to view saved tracks</h1>
          <Link to="/" className="text-blue-400 hover:text-blue-300 underline">
            Return to radio
          </Link>
        </div>
      </div>
    );
  }

  if (!userData || userData.role !== "controller") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-black">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Saved tracks are for controllers only</h1>
          <p className="text-gray-400 mb-6">Controllers can save tracks to research where to purchase them.</p>
          <Link to="/" className="text-blue-400 hover:text-blue-300 underline">
            Return to radio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="flex justify-between items-center">
            <h1 className="text-4xl font-bold">Saved Tracks</h1>
            <Link 
              to="/" 
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              Back to Radio
            </Link>
          </div>
          <p className="text-gray-400 mt-2">
            {savedTracks?.length || 0} tracks saved for purchasing
          </p>
        </motion.div>

        {savedTracks && savedTracks.length > 0 ? (
          <div className="grid gap-4">
            {savedTracks.map((track, index) => (
              <motion.div
                key={track._id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="bg-white/5 backdrop-blur-lg rounded-lg p-6 hover:bg-white/10 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold mb-1">{track.title}</h3>
                    <p className="text-gray-400 mb-2">{track.artist}</p>
                    <div className="flex gap-4 text-sm text-gray-500">
                      {track.year && <span>Year: {track.year}</span>}
                      {track.label && <span>Label: {track.label}</span>}
                      <span>Saved: {new Date(track.savedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-2 ml-4">
                    <a
                      href={`https://www.youtube.com/watch?v=${track.youtubeId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded text-sm transition-colors"
                    >
                      YouTube
                    </a>
                    <a
                      href={`https://www.discogs.com/search/?q=${encodeURIComponent(track.artist + ' ' + track.title)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1 bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded text-sm transition-colors"
                    >
                      Discogs
                    </a>
                    {track.bandcampUrl && (
                      <a
                        href={track.bandcampUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded text-sm transition-colors"
                      >
                        Bandcamp
                      </a>
                    )}
                    {track.beatportUrl && (
                      <a
                        href={track.beatportUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded text-sm transition-colors"
                      >
                        Beatport
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center py-20"
          >
            <p className="text-2xl text-gray-400 mb-4">No saved tracks yet</p>
            <p className="text-gray-500">
              Like tracks while listening to save them here for purchasing
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}