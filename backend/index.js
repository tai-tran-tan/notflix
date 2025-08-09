const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');
const { spawn } = require('child_process');

const app = express();
const port = 3001;

// Use CORS to allow requests from the React frontend
app.use(cors());

// Define the directory where your movie folders are located.
// You can change this path as needed.
const MOVIE_DIRECTORY = process.env.MOVIE_DIRECTORY;

// A mapping for language codes to full names for display in the frontend
const languageMap = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'vn': 'Vietnamese',
    'vi': 'Vietnamese',
};

let movies = [];

// Helper function to create a URL-friendly slug from a string
const createSlug = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w-]+/g, '') // Remove all non-word chars
        .replace(/--+/g, '-'); // Replace multiple - with single -
};

/**
 * Parses subtitle content from either WebVTT or SRT format into an array of subtitle cues.
 * This is a server-side version of the function you provided.
 *
 * @param {string} subtitleContent - The raw content of the subtitle file.
 * @returns {Array<Object>} An array of subtitle cue objects, each with startTime, endTime, and text properties.
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

/**
 * Initializes the movie list by scanning the MOVIE_DIRECTORY.
 * This function is called once when the server starts.
 */
const initMovies = async () => {
    try {
        console.log(`Scanning for movies in: ${MOVIE_DIRECTORY}`);
        const movieFolders = fs.readdirSync(MOVIE_DIRECTORY, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        if (movieFolders.length === 0) {
            console.warn("No movie directories found. Please check your MOVIE_DIRECTORY path.");
        }

        // Filter out folders that do not contain a video file
        const validMovieFolders = movieFolders.filter(folderName => {
            const folderPath = path.join(MOVIE_DIRECTORY, folderName);
            const filesInFolder = fs.readdirSync(folderPath);
            // Now includes '.mkv' in the list of supported video files
            return filesInFolder.some(file => ['.mp4', '.mov', '.mkv'].includes(path.extname(file).toLowerCase()));
        });

        const filteredOutCount = movieFolders.length - validMovieFolders.length;
        if (filteredOutCount > 0) {
            console.log(`Filtered out ${filteredOutCount} folders that did not contain video files.`);
        }

        movies = validMovieFolders.map(folderName => {
            const moviePath = path.join(MOVIE_DIRECTORY, folderName);
            const files = fs.readdirSync(moviePath);
            // Create a unique ID by combining the slug and a nanoid
            const movieId = `${createSlug(folderName)}-${nanoid(10)}`;

            const movie = {
                id: movieId,
                title: folderName.replace(/-/g, ' ').split(' ').map(s => s.charAt(0).toUpperCase() + s.substring(1)).join(' '),
                videoUrl: null,
                videoExtension: null, // New field to store the video file extension
                length: 'N/A', // Video length would require a separate library to extract
                lastUpdated: fs.statSync(moviePath).mtime,
                subtitles: [],
                originalFolderName: folderName // Store the original folder name for file path lookups
            };

            files.forEach(file => {
                const fileExtension = path.extname(file).toLowerCase();

                // Find the video file
                // Now includes '.mkv' in the list of supported video files
                if (['.mp4', '.mov', '.mkv'].includes(fileExtension)) {
                    movie.videoUrl = `/movies/${folderName}/${file}`;
                    movie.videoExtension = fileExtension; // Store the extension
                }

                // Find the subtitle files
                if (['.vtt', '.srt'].includes(fileExtension)) {
                    const langCodeMatch = file.match(/\.([a-zA-Z]{2})\.(vtt|srt)$/);
                    if (langCodeMatch) {
                        const langCode = langCodeMatch[1];
                        movie.subtitles.push({
                            language: languageMap[langCode.toLowerCase()] || langCode.toUpperCase(),
                            // The language code is now a query parameter
                            vttUrl: `/api/subtitles/${movieId}?fileName=${encodeURIComponent(file)}`
                        });
                    } else {
                        // New logic: if no language code is found, add the subtitle with 'Undetermined' language
                        movie.subtitles.push({
                            language: 'Undetermined',
                            vttUrl: `/api/subtitles/${movieId}?fileName=${encodeURIComponent(file)}`
                        });
                    }
                }
            });
            return movie;
        });
        console.log(`Found ${movies.length} movies.`);
    } catch (error) {
        console.error("Failed to initialize movies:", error);
        movies = [];
    }
};

// Check if ffmpeg is available
const checkFFmpeg = () => {
    return new Promise((resolve) => {
        const child = spawn('ffmpeg', ['-version']);
        child.on('error', () => resolve(false));
        child.on('exit', (code) => {
            resolve(code === 0);
        });
    });
};

// API endpoint to get all movies
app.get('/api/movies', (req, res) => {
    res.json(movies);
});

// API endpoint to get specific subtitle content
app.get('/api/subtitles/:movieId', (req, res) => {
    const { movieId } = req.params;
    const fileName = req.query.fileName;
    if (!fileName) {
        return res.status(400).send('fileName is required');
    }
    
    const movie = movies.find(m => m.id === movieId);
    if (!movie) {
        return res.status(404).send('Movie not found');
    }

    const moviePath = path.join(MOVIE_DIRECTORY, movie.originalFolderName);
    
    // If a filename is provided, use it directly to find the file
    const subtitlePath = path.join(moviePath, fileName);

    if (subtitlePath && fs.existsSync(subtitlePath)) {
        const file = readSubtitleFile(subtitlePath)
        res.send(file);
    } else {
        res.status(404).send('Subtitle file not found');
    }
});

/**
 * Reads a file, detects its encoding using a Byte Order Mark (BOM),
 * and returns the content as a string.
 *
 * @param {string} filePath - The path to the subtitle file.
 * @returns {string} The decoded file content.
 */
const readSubtitleFile = (filePath) => {
    // Read the first 4 bytes to check for a BOM.
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);
  
    let encoding = 'utf8';
    let bomLength = 0;
  
    // Check for UTF-8 BOM: EF BB BF
    if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      encoding = 'utf8';
      bomLength = 3;
    } 
    // Check for UTF-16 LE BOM: FF FE
    else if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      encoding = 'utf16le';
      bomLength = 2;
    }
    // Check for UTF-16 BE BOM: FE FF
    else if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      encoding = 'utf16be';
      bomLength = 2;
    }
  
    // Read the entire file content using the detected encoding, skipping the BOM.
    // The slice method is used to remove the BOM from the buffer before decoding.
    const fileContentBuffer = fs.readFileSync(filePath);
    return fileContentBuffer.slice(bomLength).toString(encoding);
  };

// Dynamic route to serve video files, with transcoding for MKV
app.get('/movies/:folder/:file', (req, res) => {
    const { folder, file } = req.params;
    const filePath = path.join(MOVIE_DIRECTORY, folder, file);
    const fileExtension = path.extname(file).toLowerCase();

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found');
    }

    if (fileExtension === '.mkv') {
        // Transcode MKV on the fly to a playable MP4 stream
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
        });

        console.log(`Transcoding ${file} on the fly...`);

        const ffmpegProcess = spawn('ffmpeg', [
            '-i', filePath,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-f', 'mp4',
            '-movflags', 'frag_keyframe+empty_moov',
            'pipe:1'
        ], {
            stdio: ['inherit', 'pipe', 'inherit']
        });

        ffmpegProcess.stdout.pipe(res);

        ffmpegProcess.on('error', (err) => {
            console.error('FFmpeg failed to start:', err);
            res.end();
        });

        ffmpegProcess.on('exit', (code) => {
            if (code !== 0) {
                console.error(`FFmpeg process exited with code ${code}`);
            } else {
                console.log('FFmpeg process finished successfully.');
            }
        });

        req.on('close', () => {
            console.log('Client disconnected, killing ffmpeg process.');
            ffmpegProcess.kill();
        });

    } else {
        // For other formats, stream the file directly
        res.sendFile(filePath);
    }
});


// Start the server
app.listen(port, async () => {
    console.log(`Video player backend listening at http://localhost:${port}`);
    await initMovies();
    const hasFFmpeg = await checkFFmpeg();
    if (hasFFmpeg) {
        console.log('ffmpeg is installed and ready.');
    } else {
        console.error('ffmpeg not found. Please install it to enable video transcoding for unsupported formats.');
    }
});
