import type { MetaFunction } from "@remix-run/node";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { motion } from "framer-motion";
import { useState } from "react";
import RadioPlayer from "../components/RadioPlayer";

export const meta: MetaFunction = () => {
  return [
    { title: "104.2 FM - AI-Curated Radio" },
    { name: "description", content: "Minimalist, AI-curated internet radio station for the musically adventurous" },
  ];
};

export default function Index() {
  const [isDarkMode, setIsDarkMode] = useState(false);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  return (
    <div className={`min-h-screen overflow-hidden transition-colors duration-300 ${
      isDarkMode ? 'gradient-bg' : 'bg-white'
    }`}>
      {/* Header */}
      <motion.header 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6 }}
        className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
          isDarkMode ? 'backdrop-blur-xl bg-black/40' : 'backdrop-blur-xl bg-white/80'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-end items-center">
          <div className="flex items-center gap-4">
            {/* Theme Toggle */}
            <motion.button
              onClick={toggleTheme}
              className={`w-10 h-10 flex items-center justify-center text-lg transition-all duration-300 ${
                isDarkMode 
                  ? 'text-white/70 hover:text-white' 
                  : 'text-black/70 hover:text-black'
              }`}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className={isDarkMode ? 'text-white' : 'text-black'}
              >
                {isDarkMode ? (
                  <path 
                    d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  />
                ) : (
                  <path 
                    d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </motion.button>

            <SignedOut>
              <SignInButton mode="modal">
                <motion.button 
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-all duration-300 ${
                    isDarkMode 
                      ? 'bg-white text-black hover:bg-gray-100' 
                      : 'bg-black text-white hover:bg-gray-800'
                  }`}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  Sign In
                </motion.button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <UserButton 
                appearance={{
                  elements: {
                    avatarBox: {
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                    },
                    userButtonPopoverCard: {
                      pointerEvents: 'initial'
                    }
                  },
                  variables: {
                    colorPrimary: isDarkMode ? '#ffffff' : '#000000',
                    colorBackground: isDarkMode ? '#000000' : '#ffffff',
                    colorText: isDarkMode ? '#ffffff' : '#000000',
                  }
                }}
              />
            </SignedIn>
          </div>
        </div>
      </motion.header>

      {/* Main Player Area */}
      <main className="pt-20 pb-20 min-h-screen flex items-center justify-center">
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="w-full max-w-lg px-6"
        >
          <RadioPlayer isDarkMode={isDarkMode} />
        </motion.div>
      </main>

    </div>
  );
}

