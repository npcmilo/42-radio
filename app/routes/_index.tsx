import type { MetaFunction } from "@remix-run/node";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";

export const meta: MetaFunction = () => {
  return [
    { title: "104.2 FM - AI-Curated Radio" },
    { name: "description", content: "Minimalist, AI-curated internet radio station for the musically adventurous" },
  ];
};

export default function Index() {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Header */}
      <header className="flex justify-between items-center p-6">
        <div className="flex items-center gap-4">
          <div className="text-2xl font-bold">104.2 FM</div>
          <div className="text-sm text-gray-400">AI-Curated Radio</div>
        </div>
        
        <div className="flex items-center gap-4">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-4 py-2 bg-white text-black rounded-md hover:bg-gray-200 transition-colors">
                Sign In
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </header>

      {/* Main Player Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          {/* Album Art Placeholder */}
          <div className="aspect-square bg-gray-900 rounded-lg mb-8 flex items-center justify-center">
            <div className="text-gray-500 text-center">
              <div className="text-4xl mb-2">🎵</div>
              <div>No track playing</div>
            </div>
          </div>

          {/* Track Info */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2">Welcome to 104.2 FM</h2>
            <p className="text-gray-400 mb-4">
              AI-curated internet radio for the musically adventurous
            </p>
            <p className="text-sm text-gray-500">
              Add your API keys to the .env file to get started
            </p>
          </div>

          {/* Player Controls Placeholder */}
          <div className="flex justify-center items-center gap-4">
            <button 
              className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-700 transition-colors"
              disabled
            >
              ⏮
            </button>
            <button 
              className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:bg-gray-200 transition-colors"
              disabled
            >
              ▶
            </button>
            <button 
              className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-700 transition-colors"
              disabled
            >
              ⏭
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6 text-center text-gray-500 text-sm">
        <p>Streaming underground music from around the world</p>
      </footer>
    </div>
  );
}

