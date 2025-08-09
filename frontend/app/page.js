'use client';
import { useState, useEffect, useRef, useMemo } from 'react';
import { ArrowLeft, Play, Pause, RotateCcw, RotateCw, ClosedCaption, CaptionsOff, Volume2, VolumeX, Fullscreen, Plus, Minus } from 'lucide-react';

// Define the base URL for the backend API
const API_URL = 'http://192.168.1.11:3001';

/**
 * Parses either WebVTT or SRT subtitle content.
 * This is crucial for displaying subtitles correctly.
 */
const parseSubtitles = (subtitleContent) => {
  // Array to hold the parsed subtitle cues.
  const parsedSubtitles = [];

  // Split the content by lines and filter out any empty lines.
  const lines = subtitleContent.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
  
  // The first line determines if it's a WebVTT file.
  const isVTT = lines[0] === 'WEBVTT';

  /**
   * Helper function to parse a timestamp string into seconds.
   * Handles both VTT (with '.') and SRT (with ',') decimal separators.
   *
   * @param {string} timeString - The timestamp string (e.g., '00:01:23.456' or '00:01:23,456').
   * @returns {number} The time in seconds.
   */
  const parseTimestamp = (timeString) => {
    // Replace the comma with a dot to normalize for floating-point parsing.
    const normalizedTime = timeString.replace(',', '.');
    const parts = normalizedTime.split(':');
    
    // Check if the time string includes hours (e.g., 'hh:mm:ss.sss').
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const seconds = parseFloat(parts[2]);
      return (hours * 3600) + (minutes * 60) + seconds;
    } else if (parts.length === 2) {
      // Handle timestamps without hours (e.g., 'mm:ss.sss').
      const minutes = parseInt(parts[0], 10);
      const seconds = parseFloat(parts[1]);
      return (minutes * 60) + seconds;
    }
    return 0; // Return 0 if the format is unrecognized.
  };
  
  let currentCue = null;
  let textBuffer = [];

  // Iterate over each line of the subtitle content.
  for (const line of lines) {
    // Skip the 'WEBVTT' header and any cue numbers in SRT files.
    if (isVTT && line === 'WEBVTT') continue;
    if (!isVTT && line.match(/^\d+$/)) continue;

    // A line containing '-->' indicates the start of a new cue's timestamp.
    if (line.includes('-->')) {
      // If we've been processing a cue, save it before starting a new one.
      if (currentCue) {
        currentCue.text = textBuffer.join(' ').trim();
        parsedSubtitles.push(currentCue);
      }

      // Reset the buffer for the new cue.
      textBuffer = [];
      const [start, end] = line.split('-->').map(t => parseTimestamp(t));
      currentCue = { startTime: start, endTime: end, text: '' };
    } else if (currentCue) {
      // This line is part of the current cue's text.
      textBuffer.push(line);
    }
  }
  
  // After the loop, add the very last cue.
  if (currentCue) {
    currentCue.text = textBuffer.join(' ').trim();
    parsedSubtitles.push(currentCue);
  }

  return parsedSubtitles;
};

// Formats a time in seconds to MM:SS format
const formatTime = (time) => {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export default function Home() {
  // --- STATE MANAGEMENT ---
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [movies, setMovies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('title');
  const [sortDirection, setSortDirection] = useState('asc');

  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [subtitles, setSubtitles] = useState([]);
  const [currentSubtitle, setCurrentSubtitle] = useState('');
  const [selectedSubtitleUrl, setSelectedSubtitleUrl] = useState(null);
  const [volume, setVolume] = useState(1);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  // New state for subtitle font size
  const [subtitleFontSize, setSubtitleFontSize] = useState(1.125); // Initial font size in rem

  // Refs for direct DOM access
  const videoRef = useRef(null);
  const progressBarRef = useRef(null);

  // --- LIFECYCLE HOOKS ---
  // Fetches movies from the Express backend when the component mounts
  useEffect(() => {
    const fetchMovies = async () => {
      try {
        const response = await fetch(`${API_URL}/api/movies`);
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const data = await response.json();
        const moviesWithDates = data.map(movie => ({
          ...movie,
          lastUpdated: new Date(movie.lastUpdated),
        }));
        setMovies(moviesWithDates);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchMovies();
  }, []);

  // Effect to handle subtitle fetching when a new subtitle URL is selected
  useEffect(() => {
    const fetchSubtitles = async () => {
      if (!selectedSubtitleUrl) {
        setSubtitles([]);
        setCurrentSubtitle('');
        return;
      }

      try {
        const response = await fetch(`${API_URL}${selectedSubtitleUrl}`);
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const subtitleContent = await response.text();
        const parsedSubs = parseSubtitles(subtitleContent);
        setSubtitles(parsedSubs);
      } catch (err) {
        console.error("Failed to fetch subtitles:", err);
        setSubtitles([]);
      }
    };

    fetchSubtitles();
  }, [selectedSubtitleUrl]);

  // Effect to reset video player state when a new movie is selected
  useEffect(() => {
    if (selectedMovie && videoRef.current) {
      const video = videoRef.current;
      
      // Use the videoUrl from the backend directly, no special logic needed
      const videoSrc = `${API_URL}${selectedMovie.videoUrl}`;

      video.src = videoSrc;
      video.load();
      video.volume = volume;
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);

      // Set default subtitle for the new movie
      if (selectedMovie.subtitles && selectedMovie.subtitles.length > 0) {
        setSelectedSubtitleUrl(selectedMovie.subtitles[0].vttUrl);
      } else {
        setSelectedSubtitleUrl(null);
      }
    }
  }, [selectedMovie, volume]);

  // --- COMPUTED PROPERTIES (memoized for performance) ---
  const sortedMovies = useMemo(() => {
    return [...movies].sort((a, b) => {
      let aValue;
      let bValue;

      if (sortKey === 'length') {
        const aParts = a.length.split(':').map(Number);
        const bParts = b.length.split(':').map(Number);
        aValue = aParts.length === 2 ? aParts[0] * 60 + aParts[1] : 0;
        bValue = bParts.length === 2 ? bParts[0] * 60 + bParts[1] : 0;
      } else if (sortKey === 'lastUpdated') {
        aValue = a.lastUpdated.getTime();
        bValue = b.lastUpdated.getTime();
      } else {
        aValue = a[sortKey].toLowerCase();
        bValue = b[sortKey].toLowerCase();
      }

      if (aValue < bValue) {
        return sortDirection === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortDirection === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [movies, sortKey, sortDirection]);

  const isSubtitlesOn = useMemo(() => selectedSubtitleUrl !== null && selectedMovie?.subtitles.length > 0, [selectedSubtitleUrl, selectedMovie]);
  const hasSubtitles = useMemo(() => selectedMovie?.subtitles && selectedMovie.subtitles.length > 0, [selectedMovie]);
  const isMuted = useMemo(() => volume === 0, [volume]);

  // --- EVENT HANDLERS ---
  const handleMovieSelection = (movie) => {
    setSelectedMovie(movie);
  };

  const handleGoBack = () => {
    setSelectedMovie(null);
  };

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (key) => {
    if (sortKey === key) {
      return sortDirection === 'asc' ? '▲' : '▼';
    }
    return '';
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const newCurrentTime = videoRef.current.currentTime;
      setCurrentTime(newCurrentTime);

      const activeSubtitle = subtitles.find(
        sub => newCurrentTime >= sub.startTime && newCurrentTime <= sub.endTime
      );
      setCurrentSubtitle(activeSubtitle ? activeSubtitle.text : '');

      if (progressBarRef.current) {
        const progress = (newCurrentTime / videoRef.current.duration) * 100;
        progressBarRef.current.style.width = `${progress}%`;
      }
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (video) {
      if (isPlaying) {
        video.pause();
      } else {
        video.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (videoRef.current.parentElement.requestFullscreen) {
        videoRef.current.parentElement.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const handleVolumeChange = (e) => {
    const newVolume = parseFloat(e.target.value);
    const video = videoRef.current;
    if (video) {
      video.volume = newVolume;
      setVolume(newVolume);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (video) {
      if (video.volume > 0) {
        setVolume(0);
        video.volume = 0;
      } else {
        setVolume(1);
        video.volume = 1;
      }
    }
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    if (video) {
      const progressBarContainerWidth = e.currentTarget.offsetWidth;
      const clickPosition = e.nativeEvent.offsetX;
      const newTime = (clickPosition / progressBarContainerWidth) * video.duration;
      video.currentTime = Math.max(0, Math.min(newTime, video.duration));
      setCurrentTime(video.currentTime);
    }
  };

  const handleFastForward = () => {
    const video = videoRef.current;
    if (video) {
      const newTime = Math.min(video.currentTime + 10, video.duration);
      video.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleRewind = () => {
    const video = videoRef.current;
    if (video) {
      const newTime = Math.max(video.currentTime - 10, 0);
      video.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleSubtitleSelection = (subtitleUrl) => {
    setSelectedSubtitleUrl(subtitleUrl);
    setShowSubtitleMenu(false);
  };

  // New handler to increase font size
  const handleIncreaseFontSize = () => {
    setSubtitleFontSize(prevSize => Math.min(prevSize + 0.2, 2.0)); // Max size is 2.0rem
  };

  // New handler to decrease font size
  const handleDecreaseFontSize = () => {
    setSubtitleFontSize(prevSize => Math.max(prevSize - 0.2, 0.8)); // Min size is 0.8rem
  };


  // --- RENDER LOGIC ---
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white font-sans text-xl">
        Loading movies...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-red-400 font-sans p-4">
        <div className="text-xl mb-2">Error: {error}</div>
        <div className="text-md text-gray-400 text-center">
          Please make sure the Express backend server is running on <code className="bg-gray-700 p-1 rounded">http://localhost:3001</code>.
        </div>
      </div>
    );
  }

  return (
    <main>
      {/* Movie List View */}
      {!selectedMovie && (
        <div className="flex flex-col items-center justify-center p-4 min-h-screen bg-gray-900 text-white font-sans">
          <div className="w-full max-w-4xl p-6 bg-gray-800 rounded-xl shadow-lg">
            <h1 className="text-4xl font-bold mb-4 text-center text-blue-400">Choose a Movie</h1>
            <div className="flex justify-center space-x-2 mb-8">
              <button
                onClick={() => handleSort('title')}
                className="flex items-center space-x-2 p-2 bg-gray-700 hover:bg-blue-600 rounded-lg transition-colors duration-200"
              >
                <span className="text-sm font-semibold">Sort by Title</span>
                <span className="text-blue-400">{getSortIcon('title')}</span>
              </button>
              <button
                onClick={() => handleSort('length')}
                className="flex items-center space-x-2 p-2 bg-gray-700 hover:bg-blue-600 rounded-lg transition-colors duration-200"
              >
                <span className="text-sm font-semibold">Sort by Length</span>
                <span className="text-blue-400">{getSortIcon('length')}</span>
              </button>
              <button
                onClick={() => handleSort('lastUpdated')}
                className="flex items-center space-x-2 p-2 bg-gray-700 hover:bg-blue-600 rounded-lg transition-colors duration-200"
              >
                <span className="text-sm font-semibold">Sort by Updated</span>
                <span className="text-blue-400">{getSortIcon('lastUpdated')}</span>
              </button>
            </div>
            <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2">
              {sortedMovies.map(movie => (
                <div
                  key={movie.id}
                  onClick={() => handleMovieSelection(movie)}
                  className="cursor-pointer bg-gray-700 rounded-lg shadow-md p-4 transform transition-all duration-300 hover:scale-105 hover:shadow-xl"
                >
                  <h3 className="text-lg font-bold mb-1">{movie.title}</h3>
                  <div className="flex items-center text-sm text-gray-400 space-x-2">
                    <span>Length: {movie.length}</span>
                    <span>|</span>
                    <span>Subtitles: {movie.subtitles.length}</span>
                    {movie.videoExtension && (
                      <>
                        <span>|</span>
                        <span className="px-2 py-1 bg-gray-600 rounded-md text-xs font-semibold uppercase">
                          {movie.videoExtension.replace('.', '')}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Video Player View */}
      {selectedMovie && (
        <div className="flex flex-col items-center justify-center p-4 min-h-screen bg-gray-900 text-white font-sans">
          <div className="w-[70vw] max-w-7xl p-4 bg-gray-800 rounded-xl shadow-lg relative">
            <button
              onClick={handleGoBack}
              className="absolute top-4 left-4 p-2 bg-gray-700 hover:bg-gray-600 text-white rounded-full transition-colors duration-200 z-10"
              title="Back"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-3xl font-bold mb-6 text-center text-blue-400">
              {selectedMovie?.title || 'Video Player'} <span className="text-lg text-gray-400">({selectedMovie?.length})</span>
            </h1>
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                className="w-full h-full object-cover"
              ></video>
              {isSubtitlesOn && currentSubtitle && (
                <div className="absolute bottom-20 left-0 w-full text-center p-2">
                  <p
                    className="inline-block px-4 py-2 bg-black bg-opacity-70 text-white rounded-lg"
                    style={{ fontSize: `${subtitleFontSize}rem` }}
                  >
                    {currentSubtitle}
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 mt-4 bg-gray-700 rounded-lg shadow-md">
              {/* Playback Controls */}
              <div className="flex items-center justify-between space-x-4 mb-4">
                <div className="flex items-center space-x-4">
                  <button
                    onClick={togglePlay}
                    className="p-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors duration-200"
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                  </button>
                  <button
                    onClick={handleRewind}
                    className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                    title="Rewind 10 seconds"
                  >
                    <RotateCcw size={24} />
                  </button>
                  <button
                    onClick={handleFastForward}
                    className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                    title="Fast Forward 10 seconds"
                  >
                  <RotateCw size={24} />
                  </button>
                </div>
                {/* Time Display and Volume Control */}
                <div className="flex items-center space-x-4">
                  <div className="flex space-x-2">
                    <button
                      onClick={handleDecreaseFontSize}
                      className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                      title="Decrease font size"
                    >
                      <Minus size={24} />
                    </button>
                    <button
                      onClick={handleIncreaseFontSize}
                      className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                      title="Increase font size"
                    >
                      <Plus size={24} />
                    </button>
                  </div>
                  <div className="relative">
                    {hasSubtitles && (
                      <button
                        onClick={() => setShowSubtitleMenu(!showSubtitleMenu)}
                        className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                        title="Select Subtitles"
                      >
                        {isSubtitlesOn ? <ClosedCaption size={24} /> : <CaptionsOff size={24} />}
                      </button>
                    )}
                    {showSubtitleMenu && hasSubtitles && (
                      <div className="absolute bottom-16 right-0 w-48 bg-gray-800 rounded-lg shadow-lg overflow-hidden z-20">
                        <div
                          className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer"
                          onClick={() => handleSubtitleSelection(null)}
                        >
                          Off
                        </div>
                        {selectedMovie.subtitles.map(sub => (
                          <div
                            key={sub.vttUrl}
                            className={`px-4 py-2 text-sm cursor-pointer transition-colors duration-200 ${
                              selectedSubtitleUrl === sub.vttUrl ? 'bg-blue-500 text-white' : 'text-gray-300 hover:bg-gray-700'
                            }`}
                            onClick={() => handleSubtitleSelection(sub.vttUrl)}
                          >
                            {sub.language}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={toggleMute}
                    className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                    title={isMuted ? "Unmute" : "Mute"}
                  >
                    {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-24 h-2 bg-gray-500 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-400 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:appearance-none"
                  />
                  <button
                    onClick={toggleFullscreen}
                    className="p-3 bg-gray-600 hover:bg-gray-500 text-white rounded-full transition-colors duration-200"
                    title="Fullscreen"
                  >
                    <Fullscreen size={24} />
                  </button>
                </div>
              </div>
              {/* Progress Bar */}
              <div className="relative w-full h-2 bg-gray-500 rounded-full cursor-pointer" onClick={handleSeek}>
                <div
                  ref={progressBarRef}
                  className="absolute top-0 left-0 h-full bg-blue-400 rounded-full transition-all duration-100"
                  style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between text-sm font-mono mt-2">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
