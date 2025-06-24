// SPOTIFY INTEGRATION - WITH SEAMLESS SEARCH-TO-PLAYER TRANSITION AND PLAYLIST MANAGEMENT

// Config
const SPOTIFY_CLIENT_ID = '46637d8f5adb41c0a4be34e0df0c1597';
const SPOTIFY_REDIRECT_URI = 'https://looopz.vercel.app/';
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

// Audio analysis caches
const audioAnalysisCache = new Map();
const trackFeaturesCache = new Map();

// Transition sample configuration
const transitionSamples = {
    enabled: false,
    volume: 0.7, // 0-1 range
    samples: {
        short: '/assets/sounds/scratch_short.MP3', // 0.5s for short loops
        medium: '/assets/sounds/scratch_med.MP3', // 1s for medium
        long: '/assets/sounds/scratch_long.MP3', // 2s for long tracks
        // Add more as needed
    },
    audioContext: null,
    loadedBuffers: new Map()
};

// State
let spotifyPlayer = null, spotifyDeviceId = null, spotifyAccessToken = null;
let isConnected = false, isPlaying = false, currentTrack = null;
let currentTime = 0, duration = 0, loopStart = 0, loopEnd = 30;
let loopEnabled = false, loopCount = 0, loopTarget = 1, loopStartTime = 0;
let updateTimer = null, savedLoops = [], isLooping = false, isDragging = false;
let currentView = 'login', currentSearchResults = [], currentEditingLoopId = null;
let currentContextMenuTrackIndex = null;

// UNIFIED LOOP SYSTEM - Fixed timing and state management
let lastSeekTime = 0; // For debouncing seeks
const SEEK_DEBOUNCE_MS = 500; // Minimum time between seeks
const LOOP_END_THRESHOLD = 0.05; // More precise timing (50ms)

// Playlist state
let savedPlaylists = [];
let currentPlaylist = null;
let currentPlaylistIndex = 0;
let isPlaylistMode = false;
let currentEditingPlaylistId = null;
let pendingPlaylistItem = null; // For adding items to playlists
let playlistEngine = null; // Will hold the playlist engine instance

// Search state
let searchState = {
  isSecondLevel: false,
  currentLevel: 'tracks',
  currentEntity: null,
  currentOffset: 0,
  totalTracks: 0,
  hasMore: false,
  query: ''
};

// Elements
let els = {};

// Utils
function formatTime(seconds, showMs = true) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (showMs) {
      const ms = Math.floor((seconds % 1) * 1000);
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTimeInput(input) {
  if (typeof input === 'number') return input;
  if (!input || typeof input !== 'string') return 0;

  const parts = input.trim().split(':');
  if (parts.length === 2) {
      const minutes = parseInt(parts[0]) || 0;
      const secondsParts = parts[1].split('.');
      const seconds = parseInt(secondsParts[0]) || 0;
      const milliseconds = secondsParts[1] ? parseInt(secondsParts[1].padEnd(3, '0').slice(0, 3)) || 0 : 0;
      return minutes * 60 + seconds + milliseconds / 1000;
  } else {
      const secondsParts = parts[0].split('.');
      const seconds = parseInt(secondsParts[0]) || 0;
      const milliseconds = secondsParts[1] ? parseInt(secondsParts[1].padEnd(3, '0').slice(0, 3)) || 0 : 0;
      return seconds + milliseconds / 1000;
  }
}

function showStatus(message, duration = 3000) {
  els.statusText.textContent = message;
  els.statusBar.classList.add('show');
  setTimeout(() => els.statusBar.classList.remove('show'), duration);
}

function updateProgress() {
  if (!duration) return;
  const percent = (currentTime / duration) * 100;
  els.progressBar.style.width = `${percent}%`;
  els.currentTime.textContent = formatTime(currentTime);
  els.duration.textContent = formatTime(duration);
}

function updatePlayPauseButton() {
  els.playPauseBtn.innerHTML = isPlaying 
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>' 
    : '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
}

function updateNowPlayingIndicator(track = null) {
  const indicator = els.nowPlayingIndicator;
  if (track && isPlaying && currentView !== 'player') {
      els.miniTrackTitle.textContent = track.name;
      els.miniTrackArtist.textContent = track.artist;
      indicator.classList.add('show');
  } else {
      indicator.classList.remove('show');
  }
}

function updateConnectionStatus() {
  els.connectionStatus.classList.toggle('show', isConnected);
}

function updateLoopCountBadge() {
  els.loopCountBadge.textContent = savedLoops.length;
  els.loopCountBadge.style.display = savedLoops.length > 0 ? 'inline-block' : 'none';
}

function updatePlaylistCountBadge() {
  els.playlistCountBadge.textContent = savedPlaylists.length;
  els.playlistCountBadge.style.display = savedPlaylists.length > 0 ? 'inline-block' : 'none';
}

function updateRepeatDisplay() {
  els.repeatValue.textContent = `${loopTarget}×`;
}

function updateLoopVisuals() {
  if (!duration || duration <= 0) return;

  if (loopStart < 0) loopStart = 0;
  if (loopEnd > duration) loopEnd = duration;
  if (loopStart >= loopEnd) {
      loopStart = 0;
      loopEnd = Math.min(30, duration);
  }

  const startPercent = (loopStart / duration) * 100;
  const endPercent = (loopEnd / duration) * 100;

  els.loopStartHandle.style.left = `${startPercent}%`;
  els.loopEndHandle.style.left = `${endPercent}%`;
  els.loopRegion.style.left = `${startPercent}%`;
  els.loopRegion.style.width = `${Math.max(0, endPercent - startPercent)}%`;

  els.startPopup.textContent = formatTime(loopStart);
  els.endPopup.textContent = formatTime(loopEnd);
  els.precisionStart.value = formatTime(loopStart);
  els.precisionEnd.value = formatTime(loopEnd);

// FIX 6: Show/hide loop handles based on loop enabled state
if (loopEnabled) {
    els.loopStartHandle.classList.add('show');    // add() is a method!
    els.loopEndHandle.classList.add('show');
    els.loopRegion.classList.add('show');
} else {
    els.loopStartHandle.classList.remove('show');  // remove in else block!
    els.loopEndHandle.classList.remove('show');
    els.loopRegion.classList.remove('show');
}
}

// Context Menu Functions - IMPROVED
function showTrackContextMenu(trackIndex, buttonElement) {
  currentContextMenuTrackIndex = trackIndex;
  const menu = els.contextMenu;
  const overlay = els.contextMenuOverlay;

  // Always position at bottom center - consistent positioning
  menu.style.left = '50%';
  menu.style.bottom = '120px';
  menu.style.transform = 'translateX(-50%) translateY(20px) scale(0.95)';

  // Show overlay first
  overlay.classList.add('show');

  // Show menu with improved animation timing
  requestAnimationFrame(() => {
      menu.classList.add('show');
  });
}

function hideTrackContextMenu() {
  const menu = els.contextMenu;
  const overlay = els.contextMenuOverlay;

  menu.classList.remove('show');
  overlay.classList.remove('show');
  currentContextMenuTrackIndex = null;
}

function getCurrentContextTrack() {
  if (currentContextMenuTrackIndex === null || !currentSearchResults) return null;
  return currentSearchResults[currentContextMenuTrackIndex];
}

// Context Menu Action Handlers - IMPROVED RESPONSIVENESS
async function handleDiscoverMoments() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  showStatus(`🔍 Discovering moments in "${track.name}"...`);
  // TODO: Navigate to discovery view for this track
  console.log('Discover moments for:', track);
}

async function handleAddToPlaylist() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();

  // Create a pending playlist item for this track
  pendingPlaylistItem = {
      type: 'track',
      uri: track.uri,
      name: track.name,
      artist: track.artists[0].name,
      duration: track.duration_ms / 1000,
      image: track.album.images[0]?.url || '',
      playCount: 1
  };

  showAddToPlaylistPopup();
}

async function handleCreateLoop() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  // Same as clicking the + button - select the track
  await selectTrack(track.uri, track.name, track.artists[0].name, track.duration_ms, track.album.images[0]?.url || '');
}

async function handleShare() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();

  const shareUrl = `https://open.spotify.com/track/${track.id}`;
  const shareText = `🎵 Check out "${track.name}" by ${track.artists[0].name}`;

  try {
      if (navigator.share && navigator.canShare && navigator.canShare({ url: shareUrl })) {
          await navigator.share({
              title: `${track.name} - ${track.artists[0].name}`,
              text: shareText,
              url: shareUrl
          });
          // No feedback needed - share window opens immediately
      } else {
          await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
          showStatus('📋 Link copied to clipboard!');
      }
  } catch (error) {
      showStatus('❌ Failed to share');
      console.error('Share error:', error);
  }
}

async function handleListenInSpotify() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();

  const spotifyUrl = `spotify:track:${track.id}`;
  const webUrl = `https://open.spotify.com/track/${track.id}`;

  try {
      // Try to open in Spotify app first
      window.location.href = spotifyUrl;

      // Fallback to web player after a short delay
      setTimeout(() => {
          window.open(webUrl, '_blank');
      }, 500);

      showStatus('🎵 Opening in Spotify...');
  } catch (error) {
      // Fallback to web player
      window.open(webUrl, '_blank');
      showStatus('🎵 Opening in Spotify...');
  }
}

// PKCE Auth
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getSpotifyAuthUrl() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  localStorage.setItem('code_verifier', codeVerifier);
  return `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&scope=${encodeURIComponent(SPOTIFY_SCOPES)}&code_challenge_method=S256&code_challenge=${codeChallenge}&show_dialog=true`;
}

async function connectSpotify() {
  els.connectBtn.innerHTML = '<span class="loading"></span> Connecting...';
  els.connectBtn.disabled = true;
  try {
      const authUrl = await getSpotifyAuthUrl();
      showStatus('Redirecting to Spotify...');
      window.location.href = authUrl;
  } catch (error) {
      showStatus('Connection failed: ' + error.message);
      els.connectBtn.innerHTML = 'Connect Spotify Premium';
      els.connectBtn.disabled = false;
  }
}

async function exchangeCodeForToken(code) {
  const codeVerifier = localStorage.getItem('code_verifier');
  if (!codeVerifier) throw new Error('Code verifier not found');

  const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: SPOTIFY_REDIRECT_URI,
          client_id: SPOTIFY_CLIENT_ID,
          code_verifier: codeVerifier,
      }),
  });

  const data = await response.json();
  if (data.access_token) {
      spotifyAccessToken = data.access_token;
      localStorage.setItem('spotify_access_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
      localStorage.removeItem('code_verifier');
      window.history.replaceState({}, document.title, window.location.pathname);
      initializeSpotifyPlayer();
      showStatus('Successfully authenticated!');
  } else {
      throw new Error(data.error_description || 'Token exchange failed');
  }
}

function disconnectSpotify() {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  spotifyAccessToken = null;
  isConnected = false;
  if (spotifyPlayer) spotifyPlayer.disconnect();
  updateConnectionStatus();
  updateNowPlayingIndicator();
  showView('login');
  showStatus('Disconnected from Spotify');
}

// Load track with optional start position
async function loadTrackIntoSpotify(track, startPositionMs = 0) {
  if (!spotifyDeviceId || !spotifyAccessToken) {
      throw new Error('Spotify not ready');
  }

  try {
      console.log('🎵 Loading track:', track.name, 'at position:', startPositionMs);

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      if (isMobile && spotifyPlayer) {
          try {
              await spotifyPlayer.activateElement();
          } catch (e) {
              console.log('📱 Mobile activation:', e.message);
          }
      }

      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
          method: 'PUT',
          body: JSON.stringify({
              uris: [track.uri],
              position_ms: startPositionMs
          }),
          headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${spotifyAccessToken}`
          },
      });

      if (!response.ok) {
          throw new Error(`Load failed: ${response.status}`);
      }

      let synced = false;
      let attempts = 0;

      while (!synced && attempts < 8) {
          await new Promise(resolve => setTimeout(resolve, 200));
          try {
              const state = await spotifyPlayer.getCurrentState();
              if (state && state.track_window?.current_track) {
                  console.log('✅ SDK synced with track:', state.track_window.current_track.name);
                  synced = true;
                  isPlaying = !state.paused;
                  currentTime = state.position / 1000;
                  duration = state.track_window.current_track.duration_ms / 1000;

                  // Update current track info
                  currentTrack = {
                      uri: track.uri,
                      name: track.name,
                      artist: track.artist,
                      duration: duration,
                      image: track.image
                  };

                  // Update UI
                  els.currentTrack.textContent = track.name;
                  els.currentArtist.textContent = track.artist;
                  updateProgress();
                  updatePlayPauseButton();
                  updateNowPlayingIndicator(currentTrack);

                  // Start progress updates if playing
                  if (isPlaying) {
                      startProgressUpdates();
                  }
              }
          } catch (e) {
              console.log(`⏳ Sync attempt ${attempts + 1} failed`);
          }
          attempts++;
      }

      if (!synced) {
          console.warn('⚠️ SDK sync incomplete, but track should be loaded');
          // Start progress updates anyway
          if (isPlaying) {
              startProgressUpdates();
          }
      }

      console.log('✅ Track loaded and ready for SDK control');
      return true;

  } catch (error) {
      console.error('🚨 Track loading error:', error);
      throw error;
  }
}

// Fast play/pause with smart fallbacks
async function togglePlayPause() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  try {
      if (spotifyPlayer) {
          if (isPlaying) {
              await spotifyPlayer.pause();
              console.log('⏸ SDK pause success');
          } else {
              await spotifyPlayer.resume();
              console.log('▶ SDK resume success');
          }

          isPlaying = !isPlaying;
          updatePlayPauseButton();
          updateNowPlayingIndicator(isPlaying ? currentTrack : null);

          if (isPlaying) {
              startProgressUpdates();
              showStatus('Playing!');
          } else {
              stopProgressUpdates();
              showStatus('Paused');
          }
          return;
      }
  } catch (sdkError) {
      console.log('⚠️ SDK control failed, trying Web API:', sdkError.message);
  }

  try {
      if (isPlaying) {
          await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${spotifyDeviceId}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
          });
      } else {
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
          });
      }

      isPlaying = !isPlaying;
      updatePlayPauseButton();
      updateNowPlayingIndicator(isPlaying ? currentTrack : null);

      if (isPlaying) {
          startProgressUpdates();
          showStatus('Playing!');
      } else {
          stopProgressUpdates();
          showStatus('Paused');
      }

  } catch (apiError) {
      console.error('🚨 Both SDK and API failed:', apiError);
      showStatus('Playback control failed');
  }
}

// Fast positioning
async function playFromPosition(positionMs = 0) {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  try {
      if (spotifyPlayer) {
          await spotifyPlayer.seek(positionMs);
          if (!isPlaying) {
              await spotifyPlayer.resume();
          }

          isPlaying = true;
          currentTime = positionMs / 1000;
          updatePlayPauseButton();
          updateNowPlayingIndicator(currentTrack);
          updateProgress();
          startProgressUpdates();
          showStatus('Playing!');
          console.log('✅ SDK play from position success');
          return;
      }
  } catch (sdkError) {
      console.log('⚠️ SDK seek/play failed, using Web API:', sdkError.message);
  }

  try {
      await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}&device_id=${spotifyDeviceId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (!isPlaying) {
          await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
          });
      }

      isPlaying = true;
      currentTime = positionMs / 1000;
      updatePlayPauseButton();
      updateNowPlayingIndicator(currentTrack);
      updateProgress();
      startProgressUpdates();
      showStatus('Playing!');

  } catch (apiError) {
      showStatus('Failed to play from position');
  }
}

// Quick seeking with debouncing
async function seekToPosition(positionMs) {
  // FIX 4: Implement seek debouncing
  const now = Date.now();
  if (now - lastSeekTime < SEEK_DEBOUNCE_MS) {
      console.log('⏳ Seek debounced - too soon after last seek');
      return;
  }
  lastSeekTime = now;

  try {
      if (spotifyPlayer) {
          await spotifyPlayer.seek(positionMs);
          currentTime = positionMs / 1000;
          updateProgress();
          return;
      }
  } catch (sdkError) {
      console.log('⚠️ SDK seek failed, using API:', sdkError.message);
  }

  try {
      await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}&device_id=${spotifyDeviceId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });
      currentTime = positionMs / 1000;
      updateProgress();
  } catch (apiError) {
      showStatus('Seek failed');
  }
}

// DJ SMART TRANSITION FUNCTIONS MODULE
// Enhancing track by track listening experience for playlists

// ===========================================
// 1. AUDIO ANALYSIS CACHE & DATA FETCHING
// ===========================================

// Keep existing cache references to maintain compatibility
// const audioAnalysisCache = new Map(); // Already defined above
// const trackFeaturesCache = new Map(); // Renamed to maintain compatibility with existing audioFeaturesCache

/**
 * Fetches Spotify's audio analysis for a track (beats, bars, sections)
 * @param {string} trackId - Spotify track ID
 * @returns {Object|null} Audio analysis data or null if failed
 */
async function getAudioAnalysis(trackId) {
    if (audioAnalysisCache.has(trackId)) {
        return audioAnalysisCache.get(trackId);
    }

    try {
        const response = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        if (!response.ok) {
            throw new Error(`Audio analysis failed: ${response.status}`);
        }

        const analysis = await response.json();
        audioAnalysisCache.set(trackId, analysis);
        return analysis;
    } catch (error) {
        console.warn('🎵 Audio analysis unavailable:', error.message);
        return null;
    }
}

/**
 * Fetches Spotify's audio features for a track (tempo, key, energy, etc.)
 */
async function getAudioFeatures(trackId) {
    if (trackFeaturesCache.has(trackId)) {
        return trackFeaturesCache.get(trackId);
    }

    try {
        const response = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        if (!response.ok) {
            throw new Error(`Audio features failed: ${response.status}`);
        }

        const features = await response.json();
        trackFeaturesCache.set(trackId, features);
        return features;
    } catch (error) {
        console.warn('🎵 Audio features unavailable:', error.message);
        return null;
    }
}

// ===========================================
// 2. BEAT ALIGNMENT FUNCTIONS
// ===========================================

/**
 * Finds a beat-aligned endpoint for seamless transitions
 * @param {Object} analysis - Audio analysis object
 * @param {number} targetTime - Target time in seconds
 * @returns {number} Beat-aligned time in seconds
 */
function findBeatAlignedEndPoint(analysis, targetTime) {
    if (!analysis?.beats) return targetTime;

    const beats = analysis.beats;
    let closestBeat = beats[0];
    let minDistance = Math.abs(beats[0].start - targetTime);

    for (const beat of beats) {
        const distance = Math.abs(beat.start - targetTime);
        if (distance < minDistance) {
            minDistance = distance;
            closestBeat = beat;
        }
    }

    // Find the end of the current bar (assuming 4/4 time)
    const currentBeatIndex = beats.indexOf(closestBeat);
    const beatsPerBar = 4;
    const barEndIndex = Math.floor(currentBeatIndex / beatsPerBar) * beatsPerBar + (beatsPerBar - 1);
    
    if (barEndIndex < beats.length) {
        return beats[barEndIndex].start + beats[barEndIndex].duration;
    }

    return closestBeat.start + closestBeat.duration;
}

/**
 * Finds a beat-aligned start point for seamless transitions
 * @param {Object} analysis - Audio analysis object
 * @param {number} targetTime - Target time in seconds (default: 0)
 * @returns {number} Beat-aligned time in seconds
 */
function findBeatAlignedStartPoint(analysis, targetTime = 0) {
    if (!analysis?.beats) return targetTime;

    const beats = analysis.beats;
    
    // Find the first strong downbeat after targetTime
    for (const beat of beats) {
        if (beat.start >= targetTime && beat.confidence > 0.5) {
            return beat.start;
        }
    }

    return targetTime;
}

// ===========================================
// 3. TRANSITION QUALITY ASSESSMENT
// ===========================================

/**
 * Calculates optimal crossfade duration based on track compatibility
 * @param {Object} currentFeatures - Audio features of current track
 * @param {Object} nextFeatures - Audio features of next track
 * @returns {number} Optimal crossfade duration in seconds (3-12s)
 */
function calculateOptimalCrossfade(currentFeatures, nextFeatures) {
    if (!currentFeatures || !nextFeatures) {
        return 6; // Default crossfade duration
    }

    // Calculate tempo difference
    const tempoDiff = Math.abs(currentFeatures.tempo - nextFeatures.tempo);
    
    // Calculate key compatibility (circle of fifths distance)
    const keyDistance = Math.abs(currentFeatures.key - nextFeatures.key);
    const keyCompatibility = keyDistance <= 1 || keyDistance >= 11 ? 1 : 0.5;
    
    // Calculate energy difference
    const energyDiff = Math.abs(currentFeatures.energy - nextFeatures.energy);
    
    // Determine optimal crossfade duration
    let crossfadeDuration = 4; // Base duration
    
    if (tempoDiff > 20) crossfadeDuration += 2; // Longer for big tempo changes
    if (energyDiff > 0.4) crossfadeDuration += 2; // Longer for energy jumps
    if (keyCompatibility < 1) crossfadeDuration += 1; // Longer for key clashes
    
    return Math.min(Math.max(crossfadeDuration, 3), 12); // Between 3-12 seconds
}

/**
 * Assesses the quality of a transition between two tracks
 * @param {Object} currentFeatures - Audio features of current track
 * @param {Object} nextFeatures - Audio features of next track
 * @returns {Object} Quality assessment with score and factors
 */
function assessTransitionQuality(currentFeatures, nextFeatures) {
    if (!currentFeatures || !nextFeatures) {
        return { quality: 'unknown', score: 0.5 };
    }

    let score = 0;
    const factors = [];

    // Tempo compatibility (30% weight)
    const tempoDiff = Math.abs(currentFeatures.tempo - nextFeatures.tempo);
    const tempoScore = Math.max(0, 1 - (tempoDiff / 50));
    score += tempoScore * 0.3;
    factors.push(`Tempo: ${tempoScore.toFixed(2)}`);

    // Key compatibility (25% weight)  
    const keyDistance = Math.abs(currentFeatures.key - nextFeatures.key);
    const keyScore = keyDistance <= 1 || keyDistance >= 11 ? 1 : 0.3;
    score += keyScore * 0.25;
    factors.push(`Key: ${keyScore.toFixed(2)}`);

    // Energy flow (25% weight)
    const energyDiff = Math.abs(currentFeatures.energy - nextFeatures.energy);
    const energyScore = Math.max(0, 1 - energyDiff);
    score += energyScore * 0.25;
    factors.push(`Energy: ${energyScore.toFixed(2)}`);

    // Valence/mood compatibility (20% weight)
    const valenceDiff = Math.abs(currentFeatures.valence - nextFeatures.valence);
    const valenceScore = Math.max(0, 1 - valenceDiff);
    score += valenceScore * 0.2;
    factors.push(`Mood: ${valenceScore.toFixed(2)}`);

    let quality = 'poor';
    if (score >= 0.8) quality = 'excellent';
    else if (score >= 0.6) quality = 'good';
    else if (score >= 0.4) quality = 'fair';

    console.log(`🎵 Transition quality: ${quality} (${score.toFixed(2)}) - ${factors.join(', ')}`);

    return { quality, score, factors };
}

// ===========================================
// 4. VOLUME CONTROL & CROSSFADING
// ===========================================

/**
 * Sets Spotify volume with SDK and API fallback
 * @param {number} volumePercent - Volume percentage (0-100)
 * @returns {boolean} Success status
 */
async function setSpotifyVolume(volumePercent) {
    try {
        if (spotifyPlayer) {
            await spotifyPlayer.setVolume(volumePercent / 100);
            return true;
        }
    } catch (error) {
        console.warn('🔊 Volume control via SDK failed:', error.message);
    }

    try {
        await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volumePercent)}&device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });
        return true;
    } catch (error) {
        console.warn('🔊 Volume control via API failed:', error.message);
        return false;
    }
}

/**
 * Performs a smooth crossfade between two volume levels
 * @param {number} fromVolume - Starting volume (0-100)
 * @param {number} toVolume - Target volume (0-100)
 * @param {number} durationMs - Duration in milliseconds
 * @param {Function} callback - Optional callback at midpoint
 */
async function performSmootCrossfade(fromVolume, toVolume, durationMs, callback = null) {
    const steps = 20; // Number of volume steps
    const stepDuration = durationMs / steps;
    const volumeStep = (toVolume - fromVolume) / steps;

    for (let i = 0; i <= steps; i++) {
        const currentVolume = fromVolume + (volumeStep * i);
        await setSpotifyVolume(Math.max(0, Math.min(100, currentVolume)));
        
        if (callback && i === Math.floor(steps / 2)) {
            callback(); // Execute callback at midpoint (e.g., track switch)
        }
        
        if (i < steps) {
            await new Promise(resolve => setTimeout(resolve, stepDuration));
        }
    }
}

// ===========================================
// 5. SMART TRANSITION UTILITIES
// ===========================================

/**
 * Extracts track ID from Spotify URI
 * @param {string} uri - Spotify URI (e.g., 'spotify:track:123')
 * @returns {string|null} Track ID or null
 */
function extractTrackId(uri) {
    if (!uri) return null;
    const parts = uri.split(':');
    return parts.length >= 3 ? parts[2] : null;
}

/**
 * Pre-analyzes upcoming tracks for optimal performance
 * @param {Array} tracks - Array of track objects with URIs
 */
async function preAnalyzeUpcomingTracks(tracks) {
    for (const track of tracks) {
        const trackId = extractTrackId(track.uri);
        if (trackId) {
            // Fire and forget - populate cache in background
            getAudioAnalysis(trackId).catch(() => {});
            getAudioFeatures(trackId).catch(() => {});
        }
    }
}

/**
 * Prepares transition data between two tracks
 * @param {Object} fromTrack - Current track object
 * @param {Object} toTrack - Next track object
 * @returns {Object|null} Transition data or null if failed
 */
async function prepareSmartTransition(fromTrack, toTrack) {
    try {
        const fromTrackId = extractTrackId(fromTrack.uri);
        const toTrackId = extractTrackId(toTrack.uri);

        if (!fromTrackId || !toTrackId) return null;

        // Get audio analysis and features for both tracks
        const [fromFeatures, toFeatures, fromAnalysis, toAnalysis] = await Promise.all([
            getAudioFeatures(fromTrackId),
            getAudioFeatures(toTrackId),
            getAudioAnalysis(fromTrackId),
            getAudioAnalysis(toTrackId)
        ]);

        if (fromFeatures && toFeatures) {
            // Calculate transition parameters
            const crossfadeDuration = calculateOptimalCrossfade(fromFeatures, toFeatures);
            const transitionQuality = assessTransitionQuality(fromFeatures, toFeatures);

            // Calculate beat-aligned points
            const fromEndTime = fromTrack.duration || 180;
            const toStartTime = 0;

            const optimalFromEnd = findBeatAlignedEndPoint(fromAnalysis, fromEndTime);
            const optimalToStart = findBeatAlignedStartPoint(toAnalysis, toStartTime);

            return {
                fromTrack,
                toTrack,
                fromEndTime: optimalFromEnd,
                toStartTime: optimalToStart,
                crossfadeDuration,
                transitionQuality,
                fromFeatures,
                toFeatures
            };
        }

        return null;

    } catch (error) {
        console.warn('🎛️ Smart transition preparation failed:', error.message);
        return null;
    }
}

// ===========================================
// 6. EXPORT ALL DJ FUNCTIONS
// ===========================================

const DJFunctions = {
    // Audio Analysis
    getAudioAnalysis,
    getAudioFeatures,
    
    // Beat Alignment
    findBeatAlignedEndPoint,
    findBeatAlignedStartPoint,
    
    // Transition Quality
    calculateOptimalCrossfade,
    assessTransitionQuality,
    
    // Volume & Crossfading
    setSpotifyVolume,
    performSmootCrossfade,
    
    // Utilities
    extractTrackId,
    preAnalyzeUpcomingTracks,
    prepareSmartTransition,
    
    // Caches (for external access if needed)
    audioAnalysisCache,
    trackFeaturesCache
};

/**
 * Initialize the Web Audio API context and load samples
 */
async function initializeTransitionSamples() {
    try {
        console.log('🎵 Initializing transition samples system...');
        
        // Create audio context
        transitionSamples.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('✅ Created audio context');
        
        // Load all transition samples
        let loadedCount = 0;
        const totalSamples = Object.keys(transitionSamples.samples).length;
        
        for (const [key, url] of Object.entries(transitionSamples.samples)) {
            try {
                console.log(`🔄 Attempting to load sample: ${key} from ${url}`);
                const buffer = await loadAudioBuffer(url);
                transitionSamples.loadedBuffers.set(key, buffer);
                loadedCount++;
                console.log(`✅ Loaded transition sample (${loadedCount}/${totalSamples}): ${key} from ${url}`);
            } catch (error) {
                console.warn(`⚠️ Failed to load transition sample ${key} from ${url}:`, error);
                
                // Try multiple path variations for maximum compatibility
                const altPaths = [
                    // Case sensitivity variations
                    url.replace('.MP3', '.mp3'),
                    url.replace('.mp3', '.MP3'),
                    // Path format variations
                    url.startsWith('/') ? url.substring(1) : `/${url}`,
                    // Different directory structure variations
                    url.includes('/sounds/') ? url : url.replace('assets/', 'assets/sounds/'),
                    `assets/sounds/${key}.MP3`,
                    `assets/sounds/${key}.mp3`,
                    `/assets/sounds/${key}.MP3`,
                    `/assets/sounds/${key}.mp3`
                ];
                
                let loaded = false;
                for (const altPath of altPaths) {
                    if (altPath === url) continue;
                    
                    try {
                        console.log(`🔄 Trying alternate path: ${altPath}`);
                        const buffer = await loadAudioBuffer(altPath);
                        transitionSamples.loadedBuffers.set(key, buffer);
                        loadedCount++;
                        console.log(`✅ Loaded transition sample with alternate path: ${key} from ${altPath}`);
                        loaded = true;
                        
                        // Update the original path to the working one for future references
                        transitionSamples.samples[key] = altPath;
                        break;
                    } catch (altError) {
                        console.warn(`⚠️ Alternate path ${altPath} also failed`);
                    }
                }
                
                if (!loaded) {
                    console.error(`❌ All paths failed for sample: ${key}`);
                }
            }
        }
        
        if (loadedCount === 0) {
            console.error('❌ Failed to load ANY transition samples');
            return false;
        }
        
        // Display loaded samples for diagnostic purposes
        console.log(`🎵 Transition samples initialized (${loadedCount}/${totalSamples} samples loaded)`);
        console.log('📊 Loaded samples:', 
          Array.from(transitionSamples.loadedBuffers.keys())
            .map(key => `${key}: ${transitionSamples.samples[key]}`).join(', '));
            
        // Test play a sample to verify audio system works
        if (transitionSamples.loadedBuffers.has('short')) {
            console.log('🔈 Testing sample playback...');
            setTimeout(() => {
                playTransitionSample('short', true, true)
                    .then(duration => console.log(`✅ Test sample played (${duration}ms)`))
                    .catch(err => console.error('❌ Test sample failed:', err));
            }, 1000);
        }
        
        return loadedCount > 0;
    } catch (error) {
        console.error('🚨 Failed to initialize transition samples:', error);
        return false;
    }
}

/**
 * Load an audio file into a buffer
 */
async function loadAudioBuffer(url) {
    console.log(`🔄 Loading audio buffer from: ${url}`);
    try {
        // Handle both absolute and relative URLs
        const fullUrl = url.startsWith('http') ? url : new URL(url, window.location.href).href;
        console.log(`🔄 Full URL: ${fullUrl}`);
        
        const response = await fetch(fullUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio file: ${response.status} ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await transitionSamples.audioContext.decodeAudioData(arrayBuffer);
        console.log(`✅ Successfully loaded and decoded audio from: ${url}`);
        return audioBuffer;
    } catch (error) {
        console.error(`❌ Error loading audio buffer from ${url}:`, error);
        throw error;
    }
}

/**
 * Play a transition sample
 * Note: This plays through Web Audio API, completely independent of Spotify
 * Both audio streams mix naturally in the browser
 */
async function playTransitionSample(sampleKey = 'short', fadeOut = false, fadeIn = false) {
    if (!transitionSamples.enabled || !transitionSamples.audioContext) return;
    
    const buffer = transitionSamples.loadedBuffers.get(sampleKey);
    if (!buffer) {
        console.warn(`Transition sample '${sampleKey}' not loaded`);
        return;
    }
    
    try {
        // Create nodes
        const source = transitionSamples.audioContext.createBufferSource();
        const gainNode = transitionSamples.audioContext.createGain();
        
        // Connect nodes
        source.buffer = buffer;
        source.connect(gainNode);
        gainNode.connect(transitionSamples.audioContext.destination);
        
        // Set initial volume
        const now = transitionSamples.audioContext.currentTime;
        gainNode.gain.setValueAtTime(transitionSamples.volume, now);
        
        // Apply fades if requested
        if (fadeIn) {
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(transitionSamples.volume, now + 0.1);
        }
        
        if (fadeOut) {
            const fadeStart = now + buffer.duration - 0.1;
            gainNode.gain.setValueAtTime(transitionSamples.volume, fadeStart);
            gainNode.gain.linearRampToValueAtTime(0, fadeStart + 0.1);
        }
        
        // Play the sample
        source.start(0);
        
        console.log(`🎵 Playing transition sample: ${sampleKey}`);
        
        // Return duration for timing purposes
        return buffer.duration * 1000; // Convert to milliseconds
        
    } catch (error) {
        console.error('Error playing transition sample:', error);
        return 0;
    }
}

/**
 * Choose appropriate sample based on context
 */
function selectTransitionSample(fromItem, toItem) {
    // Logic to choose sample based on track characteristics
    if (!fromItem || !toItem) return 'short';
    
    const fromDuration = fromItem.type === 'loop' 
        ? (fromItem.end - fromItem.start) 
        : fromItem.duration;
    
    const toDuration = toItem.type === 'loop' 
        ? (toItem.end - toItem.start) 
        : toItem.duration;
    
    // Choose sample based on track lengths
    if (fromDuration < 20 || toDuration < 20) {
        return 'short'; // Quick transition for short loops
    } else if (fromDuration < 60 || toDuration < 60) {
        return 'medium'; // Medium transition
    } else {
        return 'long'; // Longer transition for full tracks
    }
}

/**
 * Toggle transition samples on/off
 */
function toggleTransitionSamples(enabled) {
    transitionSamples.enabled = enabled;
    
    // Initialize on first enable
    if (enabled && !transitionSamples.audioContext) {
        initializeTransitionSamples();
    }
    
    console.log(`🎵 Transition samples ${enabled ? 'enabled' : 'disabled'}`);
    showStatus(`Transition samples ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Set transition sample volume
 */
function setTransitionSampleVolume(volume) {
    transitionSamples.volume = Math.max(0, Math.min(1, volume));
    console.log(`🔊 Transition sample volume: ${Math.round(volume * 100)}%`);
}

/**
 * Add custom transition sample
 */
async function addTransitionSample(key, url) {
    try {
        transitionSamples.samples[key] = url;
        const buffer = await loadAudioBuffer(url);
        transitionSamples.loadedBuffers.set(key, buffer);
        console.log(`✅ Added transition sample: ${key}`);
        return true;
    } catch (error) {
        console.error(`Failed to add transition sample ${key}:`, error);
        return false;
    }
}

// PLAYLIST DJ ENGINE - SMART TRANSITION METHODS
class PlaylistTransitionEngine {
    constructor(spotifyPlayer, spotifyAccessToken, spotifyDeviceId) {
        this.spotifyPlayer = spotifyPlayer;
        this.spotifyAccessToken = spotifyAccessToken;
        this.spotifyDeviceId = spotifyDeviceId;

        // Playlist state
        this.currentPlaylist = null;
        this.currentItemIndex = 0;
        this.isPlaying = false;
        this.transitionInProgress = false;
        
        // Smart transition state
        this.smartTransitionsEnabled = true;
        this.isTransitioning = false;
        this.currentTransitionData = null;
        this.crossfadeInProgress = false;

        // Event callbacks
        this.onItemChange = null;
        this.onPlaylistComplete = null;
        this.onSmartTransition = null;
    }

    /**
     * Pre-analyzes upcoming tracks for optimal transitions
     * Caches audio analysis and features in background
     */
    async preAnalyzeUpcomingTracks() {
        if (!this.currentPlaylist || !this.smartTransitionsEnabled) return;

        const upcomingItems = this.currentPlaylist.items.slice(
            this.currentItemIndex, 
            Math.min(this.currentItemIndex + 3, this.currentPlaylist.items.length)
        );

        for (const item of upcomingItems) {
            const trackId = this.extractTrackId(item.type === 'loop' ? item.trackUri : item.uri);
            if (trackId) {
                // Fetch analysis and features in background (fire and forget)
                getAudioAnalysis(trackId).catch(() => {});
                getAudioFeatures(trackId).catch(() => {});
            }
        }
    }

    /**
     * Prepares smart transition between two playlist items
     * @param {number} fromIndex - Current item index
     * @param {number} toIndex - Next item index
     */
    async prepareSmartTransition(fromIndex, toIndex) {
        try {
            const fromItem = this.currentPlaylist.items[fromIndex];
            const toItem = this.currentPlaylist.items[toIndex];

            const fromTrackId = this.extractTrackId(fromItem.type === 'loop' ? fromItem.trackUri : fromItem.uri);
            const toTrackId = this.extractTrackId(toItem.type === 'loop' ? toItem.trackUri : toItem.uri);

            if (!fromTrackId || !toTrackId) return;

            // Get audio analysis and features for both tracks
            const [fromFeatures, toFeatures, fromAnalysis, toAnalysis] = await Promise.all([
                getAudioFeatures(fromTrackId),
                getAudioFeatures(toTrackId),
                getAudioAnalysis(fromTrackId),
                getAudioAnalysis(toTrackId)
            ]);

            if (fromFeatures && toFeatures) {
                // Calculate transition parameters
                const crossfadeDuration = calculateOptimalCrossfade(fromFeatures, toFeatures);
                const transitionQuality = assessTransitionQuality(fromFeatures, toFeatures);

                // Calculate beat-aligned points
                const fromEndTime = fromItem.type === 'loop' ? fromItem.end : fromItem.duration;
                const toStartTime = toItem.type === 'loop' ? toItem.start : 0;

                const optimalFromEnd = findBeatAlignedEndPoint(fromAnalysis, fromEndTime);
                const optimalToStart = findBeatAlignedStartPoint(toAnalysis, toStartTime);

                this.currentTransitionData = {
                    fromItem,
                    toItem,
                    fromEndTime: optimalFromEnd,
                    toStartTime: optimalToStart,
                    crossfadeDuration,
                    transitionQuality,
                    fromFeatures,
                    toFeatures
                };

                console.log(`🎛️ Smart transition prepared: ${crossfadeDuration}s crossfade, ${transitionQuality.quality} quality`);

                if (this.onSmartTransition) {
                    this.onSmartTransition(this.currentTransitionData);
                }
            }

        } catch (error) {
            console.warn('🎛️ Smart transition preparation failed:', error.message);
            this.currentTransitionData = null;
        }
    }

    /**
     * Handles smart transition timing for full tracks
     * @param {number} currentTime - Current playback time in seconds
     */
    async handleSmartTransitionTiming(currentTime) {
        if (!this.currentTransitionData || this.crossfadeInProgress) return;

        const { fromEndTime, crossfadeDuration } = this.currentTransitionData;
        const crossfadeStartTime = fromEndTime - crossfadeDuration;

        // Check if it's time to start the crossfade
        if (currentTime >= crossfadeStartTime - 0.1 && currentTime <= crossfadeStartTime + 0.1) {
            console.log('🎛️ Starting smart crossfade transition');
            await this.executeSmartCrossfade();
        }
    }

    /**
     * Execute transition with optional sample OVERLAPPING both tracks
     * This is for non-smart transitions (e.g., short loops)
     */
    async executeTransitionWithSample() {
        if (!this.currentPlaylist || this.transitionInProgress) return;
        
        this.transitionInProgress = true;
        
        try {
            const currentItem = this.currentPlaylist.items[this.currentItemIndex];
            const nextItem = this.currentPlaylist.items[this.currentItemIndex + 1];
            
            if (!nextItem) {
                // Playlist complete
                if (this.onPlaylistComplete) this.onPlaylistComplete();
                return;
            }
            
            // For short transitions where smart crossfade isn't suitable
            if (transitionSamples.enabled && !this.smartTransitionsEnabled) {
                // Manual transition with sample overlay
                
                const sampleKey = selectTransitionSample(currentItem, nextItem);
                const sampleDuration = transitionSamples.loadedBuffers.get(sampleKey)?.duration * 1000 || 1000;
                
                // Calculate timing
                const overlapDuration = Math.min(sampleDuration * 0.8, 1500); // Max 1.5s overlap
                
                // 1. Start playing the transition sample
                playTransitionSample(sampleKey, true, true);
                
                // 2. Start fading out current track
                performSmootCrossfade(100, 20, overlapDuration);
                
                // 3. Load next track at 40% through the sample
                setTimeout(async () => {
                    this.currentItemIndex++;
                    await this.loadPlaylistItem(this.currentItemIndex);
                    
                    // Start at 0 volume
                    await setSpotifyVolume(20);
                    
                    // Fade in the new track
                    await performSmootCrossfade(20, 100, overlapDuration * 0.6);
                }, sampleDuration * 0.4);
                
                showStatus(`🎵 Quick transition with sample`);
                
            } else if (this.smartTransitionsEnabled && this.currentTransitionData) {
                // Use smart crossfade (with or without samples)
                await this.executeSmartCrossfade();
            } else {
                // Simple gap-less transition
                this.currentItemIndex++;
                await this.loadPlaylistItem(this.currentItemIndex);
            }
            
        } catch (error) {
            console.error('🚨 Transition error:', error);
            // Fallback: just skip to next
            this.currentItemIndex++;
            await this.loadPlaylistItem(this.currentItemIndex);
        } finally {
            this.transitionInProgress = false;
        }
    }

    /**
     * Handle loop completion with optional sample
     */
    async handleLoopEndWithSample() {
        const currentItem = this.currentPlaylist.items[this.currentItemIndex];
        
        if (this.currentLoopCount >= this.currentLoopTarget) {
            // Loop complete, transition to next item
            if (transitionSamples.enabled) {
                await this.executeTransitionWithSample();
            } else {
                await this.skipToNext();
            }
        } else {
            // Continue looping - no sample needed
            await this.performLoopSeek();
        }
    }

    /**
     * Enhanced smart crossfade with optional sample overlay
     */
    async executeSmartCrossfadeWithSample() {
        if (this.crossfadeInProgress || !this.currentTransitionData) return;

        try {
            this.crossfadeInProgress = true;
            const { toItem, toStartTime, crossfadeDuration, transitionQuality } = this.currentTransitionData;

            console.log(`🎛️ Executing ${crossfadeDuration}s crossfade with sample overlay`);

            // If samples enabled, play during crossfade
            if (transitionSamples.enabled) {
                const sampleKey = selectTransitionSample(
                    this.currentPlaylist.items[this.currentItemIndex],
                    toItem
                );
                
                // Start sample slightly before crossfade for buildup
                setTimeout(() => {
                    playTransitionSample(sampleKey, true, true);
                }, (crossfadeDuration * 0.2) * 1000); // Start 20% into crossfade
            }

            // Execute the actual crossfade
            await performSmootCrossfade(100, 0, crossfadeDuration * 1000, async () => {
                // At midpoint: switch to next track
                await this.loadPlaylistItem(this.currentItemIndex + 1);
                await seekToPosition(toStartTime * 1000);
                
                // Start fading in the new track
                await performSmootCrossfade(0, 100, (crossfadeDuration / 2) * 1000);
            });

            this.currentItemIndex++;
            this.currentTransitionData = null;

            showStatus(`🎛️ Smart transition complete ${transitionSamples.enabled ? 'with sample' : ''}`);

        } catch (error) {
            console.error('🎛️ Smart crossfade failed:', error);
            await this.skipToNext();
        } finally {
            this.crossfadeInProgress = false;
        }
    }

    /**
     * Executes smart crossfade transition between tracks
     */
    async executeSmartCrossfade() {
        // If samples are enabled, use the enhanced version
        if (transitionSamples.enabled) {
            return this.executeSmartCrossfadeWithSample();
        }

        if (this.crossfadeInProgress || !this.currentTransitionData) return;

        try {
            this.crossfadeInProgress = true;
            const { toItem, toStartTime, crossfadeDuration, transitionQuality } = this.currentTransitionData;

            console.log(`🎛️ Executing ${crossfadeDuration}s crossfade (${transitionQuality.quality} quality)`);

            // Start crossfade: fade out current, fade in next
            await performSmootCrossfade(100, 0, crossfadeDuration * 1000, async () => {
                // At midpoint: switch to next track
                await this.loadPlaylistItem(this.currentItemIndex + 1);
                await seekToPosition(toStartTime * 1000);
                
                // Start fading in the new track
                await performSmootCrossfade(0, 100, (crossfadeDuration / 2) * 1000);
            });

            this.currentItemIndex++;
            this.currentTransitionData = null;

            showStatus(`🎛️ Smart transition complete (${transitionQuality.quality})`);

        } catch (error) {
            console.error('🎛️ Smart crossfade failed:', error);
            // Fallback to regular transition
            await this.skipToNext();
        } finally {
            this.crossfadeInProgress = false;
        }
    }

    /**
     * Enhanced playback progress handler with smart transitions
     * @param {number} currentTime - Current playback time in seconds
     */
    async handlePlaybackProgress(currentTime) {
        if (!this.currentPlaylist || this.transitionInProgress || this.crossfadeInProgress) return;

        const currentItem = this.currentPlaylist.items[this.currentItemIndex];

        // Handle loop items
        if (currentItem.type === 'loop' && this.currentLoop) {
            await this.handleLoopProgress(currentTime, currentItem);
        }

        // Handle smart transition timing for full tracks
        if (currentItem.type === 'track' && this.currentTransitionData && this.smartTransitionsEnabled) {
            await this.handleSmartTransitionTiming(currentTime);
        }
    }

    /**
     * Initialize playlist playback
     * @param {Object} playlist - Playlist to load
     * @param {number} startIndex - Starting item index
     */
    async loadPlaylist(playlist, startIndex = 0) {
        try {
            console.log('🎵 Loading playlist:', playlist.name);

            this.currentPlaylist = playlist;
            this.currentItemIndex = startIndex;

            if (playlist.items.length === 0) {
                throw new Error('Empty playlist');
            }

            // Load first track
            await this.loadPlaylistItem(this.currentItemIndex);
            
            // Pre-analyze upcoming tracks for transitions
            if (this.smartTransitionsEnabled) {
                this.preAnalyzeUpcomingTracks();
            }

            console.log('✅ Playlist loaded and ready');
            return true;

        } catch (error) {
            console.error('🚨 Playlist load error:', error);
            throw error;
        }
    }

    /**
     * Enhanced load playlist item with transition planning
     * @param {number} itemIndex - Index of item to load
     */
    async loadPlaylistItem(itemIndex) {
        if (!this.currentPlaylist || itemIndex >= this.currentPlaylist.items.length) {
            console.log('📝 Playlist complete');
            if (this.onPlaylistComplete) this.onPlaylistComplete();
            return;
        }

        const item = this.currentPlaylist.items[itemIndex];
        console.log('🔄 Loading playlist item:', item);

        try {
            // Reset loop state
            this.currentLoopCount = 0;
            this.currentLoopTarget = item.playCount || 1;
            this.loopStartTime = Date.now();

            // Calculate smart transition if coming from previous item
            if (itemIndex > 0 && this.smartTransitionsEnabled) {
                await this.prepareSmartTransition(itemIndex - 1, itemIndex);
            }

            // Load track into Spotify
            const startPosition = item.type === 'loop' ? item.start * 1000 : 0;

            await loadTrackIntoSpotify({
                uri: item.type === 'loop' ? item.trackUri : item.uri,
                name: item.name || 'Unknown Track',
                artist: item.artist || 'Unknown Artist',
                duration: item.duration || 180,
                image: item.image || ''
            }, startPosition);

            // Set up loop parameters if this is a loop item
            if (item.type === 'loop') {
                this.setupLoopItem(item);
            }

            // Notify UI of track change
            if (this.onItemChange) {
                this.onItemChange(item, itemIndex);
            }

            console.log('✅ Playlist item loaded');

        } catch (error) {
            console.error('🚨 Failed to load playlist item:', error);
            // Skip to next item on error
            await this.skipToNext();
        }
    }

    /**
     * Sets up loop item parameters
     * @param {Object} item - Loop item
     */
    setupLoopItem(item) {
        // This function is implemented to maintain compatibility with the existing code
        // The main player handles the loop logic, so we just need to ensure this method exists
        console.log(`🔄 Setting up loop item: ${item.name} (${formatTime(item.start)} - ${formatTime(item.end)})`);
    }

    /**
     * Handle loop playback progress
     * @param {number} currentTime - Current playback time
     * @param {Object} item - Loop item
     */
    async handleLoopProgress(currentTime, item) {
        // This function is implemented to maintain compatibility with the existing code
        // The main player handles the loop logic, so we just need to ensure this method exists
        console.log(`🔄 Handling loop progress: ${formatTime(currentTime)}`);
    }

    /**
     * Skip to next playlist item
     */
    async skipToNext() {
        if (this.transitionInProgress) return;

        this.transitionInProgress = true;
        this.currentItemIndex++;

        try {
            if (this.currentItemIndex >= this.currentPlaylist.items.length) {
                // Playlist complete
                console.log('🏁 Playlist finished');
                if (this.onPlaylistComplete) this.onPlaylistComplete();
                return;
            }

            // Load next item
            await this.loadPlaylistItem(this.currentItemIndex);

        } catch (error) {
            console.error('🚨 Skip to next error:', error);
        } finally {
            this.transitionInProgress = false;
        }
    }

    /**
     * Skip to previous playlist item
     */
    async skipToPrevious() {
        if (this.transitionInProgress || this.currentItemIndex === 0) return;

        this.transitionInProgress = true;
        this.currentItemIndex--;

        try {
            await this.loadPlaylistItem(this.currentItemIndex);
        } catch (error) {
            console.error('🚨 Skip to previous error:', error);
        } finally {
            this.transitionInProgress = false;
        }
    }

    /**
     * Get current playlist state
     * @returns {Object|null} Playlist state
     */
    getPlaylistState() {
        if (!this.currentPlaylist) return null;

        return {
            playlist: this.currentPlaylist,
            currentIndex: this.currentItemIndex,
            currentItem: this.currentPlaylist.items[this.currentItemIndex]
        };
    }

    /**
     * Notify that current item is complete (called by main player)
     */
    async notifyItemComplete() {
        console.log('📢 Main player notified item complete');
        
        // Use sample-enabled transition if samples are enabled
        if (transitionSamples.enabled) {
            console.log('🎵 Using sample-enabled transition');
            await this.executeTransitionWithSample();
        } else {
            await this.skipToNext();
        }
    }

    /**
     * Toggle smart transitions on/off
     * @param {boolean} enabled - Enable or disable smart transitions
     */
    setSmartTransitions(enabled) {
        this.smartTransitionsEnabled = enabled;
        console.log(`🎛️ Smart transitions ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Extract track ID from Spotify URI
     * @param {string} uri - Spotify URI
     * @returns {string|null} Track ID or null
     */
    extractTrackId(uri) {
        if (!uri) return null;
        const parts = uri.split(':');
        return parts.length >= 3 ? parts[2] : null;
    }

    /**
     * Stop playlist and cleanup
     */
    stopPlaylist() {
        this.currentPlaylist = null;
        this.currentItemIndex = 0;
        this.transitionInProgress = false;
        this.currentTransitionData = null;
        this.crossfadeInProgress = false;
        console.log('⏹️ Playlist stopped');
    }
}

function initializeSpotifyPlayer() {
  showStatus('Connecting to Spotify...');

  // Define the callback function in the global scope BEFORE loading the SDK
  window.onSpotifyWebPlaybackSDKReady = () => {
      spotifyPlayer = new Spotify.Player({
          name: 'LOOOPZ Player',
          getOAuthToken: cb => cb(spotifyAccessToken),
          volume: 0.8
      });

      spotifyPlayer.addListener('initialization_error', ({ message }) => showStatus('Failed to initialize: ' + message));
      spotifyPlayer.addListener('authentication_error', ({ message }) => {
          localStorage.removeItem('spotify_access_token');
          showView('login');
          showStatus('Authentication failed. Please reconnect.');
      });
      spotifyPlayer.addListener('account_error', ({ message }) => showStatus('Spotify Premium required'));
      spotifyPlayer.addListener('playback_error', ({ message }) => showStatus('Playback error: ' + message));

      spotifyPlayer.addListener('ready', ({ device_id }) => {
          console.log('🎵 Spotify player ready with Device ID:', device_id);
          spotifyDeviceId = device_id;
          isConnected = true;
          updateConnectionStatus();
          showView('search');
          showStatus('Connected!');

          // Initialize playlist engine
          playlistEngine = new PlaylistTransitionEngine(spotifyPlayer, spotifyAccessToken, spotifyDeviceId);
          setupPlaylistEngineCallbacks();

          // Initialize transition samples
          console.log('🎵 Starting transition samples initialization...');
          initializeTransitionSamples().then(success => {
            if (success) {
              console.log('✅ Transition samples system ready');
              // Enable transition samples by default
              toggleTransitionSamples(true);
            } else {
              console.error('❌ Failed to initialize transition samples system');
            }
          });

          setTimeout(() => {
              console.log('🔗 Checking for shared loops after connection...');
              const hasSharedData = sessionStorage.getItem('shared_loop');
              if (hasSharedData) {
                  console.log('🔗 Found shared loop data, loading...');
                  loadSharedLoop();
              } else {
                  console.log('🔗 No shared loop data found');
              }
          }, 1000);
      });

      spotifyPlayer.addListener('not_ready', ({ device_id }) => {
          isConnected = false;
          updateConnectionStatus();
      });

      spotifyPlayer.addListener('player_state_changed', (state) => {
          if (!state) return;

          console.log('🎵 Player state changed - paused:', state.paused, 'position:', state.position);

          currentTime = state.position / 1000;
          isPlaying = !state.paused;

          updateProgress();
          updatePlayPauseButton();
          updateNowPlayingIndicator(currentTrack);

          if (state.track_window.current_track) {
              const track = state.track_window.current_track;
              duration = track.duration_ms / 1000;

              if (currentTrack && currentTrack.uri !== `spotify:track:${track.id}`) {
                  console.log('🔄 Track changed via Spotify, updating current track');
                  currentTrack.uri = `spotify:track:${track.id}`;
                  currentTrack.name = track.name;
                  currentTrack.artist = track.artists[0].name;
                  currentTrack.duration = duration;

                  els.currentTrack.textContent = track.name;
                  els.currentArtist.textContent = track.artists[0].name;
              }
          }
      });

      spotifyPlayer.connect();
  };

  // Check if Spotify SDK is already loaded
  if (window.Spotify) {
      window.onSpotifyWebPlaybackSDKReady();
  }
}

function setupPlaylistEngineCallbacks() {
  if (!playlistEngine) return;

  playlistEngine.onItemChange = (item, index) => {
      console.log('🎵 Playlist item changed:', item);
      updatePlaylistNowPlaying(item, index);

      // Update main player UI and let it handle the loops
      if (item.type === 'loop') {
          loopStart = item.start;
          loopEnd = item.end;
          loopTarget = item.playCount || 1;
          loopEnabled = true;
          loopCount = 0; // Reset loop count
          loopStartTime = Date.now(); // Reset loop timer
          els.loopToggle.checked = true;
          updateRepeatDisplay();
          updateLoopVisuals();

          console.log(`📢 Main player loop enabled: ${formatTime(loopStart)} - ${formatTime(loopEnd)} (${loopTarget}×)`);
      } else {
          // Full track - disable looping
          loopEnabled = false;
          loopCount = 0;
          els.loopToggle.checked = false;
          updateLoopVisuals(); // This will hide handles
      }
  };

  playlistEngine.onPlaylistComplete = () => {
      console.log('🏁 Playlist complete!');
      showStatus('Playlist finished!');
      stopPlaylistMode();
  };
  
  playlistEngine.onSmartTransition = (transitionData) => {
      console.log('🎛️ Smart transition data:', transitionData);
      const { transitionQuality, crossfadeDuration } = transitionData;
      showStatus(`🎛️ Smart transition: ${crossfadeDuration}s (${transitionQuality.quality})`);
  };
}

// FIX 7: Increased update frequency for better precision
function startProgressUpdates() {
  stopProgressUpdates();
  updateTimer = setInterval(async () => {
      if (isPlaying && spotifyPlayer && !isLooping) {
          try {
              const state = await spotifyPlayer.getCurrentState();
              if (state && state.position !== undefined) {
                  currentTime = state.position / 1000;
                  updateProgress();

                  // Check loops for both regular and playlist mode
                  if (loopEnabled) {
                      await checkLoopEnd();
                  }
              }
          } catch (error) {
              console.warn('State check failed:', error.message);
          }
      }
  }, 50); // Changed from 100ms to 50ms for better precision
}

function stopProgressUpdates() {
  if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
  }
}

// FIX 9: Unified loop end handling function
async function checkLoopEnd() {
  // Debug logging for playlist loops
  if (isPlaylistMode && loopEnabled) {
      console.log(`🔍 Checking playlist loop: time=${currentTime.toFixed(3)}s, end=${loopEnd.toFixed(3)}s, threshold=${LOOP_END_THRESHOLD}s, loopCount=${loopCount}/${loopTarget}`);
  }

  // Check if we've reached the loop end with precise timing
  if (currentTime >= loopEnd - LOOP_END_THRESHOLD && loopCount < loopTarget) {
      const timeSinceLoopStart = Date.now() - loopStartTime;
      if (timeSinceLoopStart > 800) {
          console.log(`🎯 Loop endpoint detected at ${currentTime.toFixed(3)}s!`);
          await handleLoopEnd();
      }
  }
}

// FIX 5: Unified loop end handling with debouncing and sample support
async function handleLoopEnd() {
  try {
      isLooping = true;
      loopCount++;

      if (loopCount >= loopTarget) {
          // Check if we're in playlist mode
          if (isPlaylistMode && playlistEngine) {
              // Notify playlist engine to move to next item
              console.log('🎵 Playlist item complete, moving to next');
              // This will now use sample-enabled transition when enabled
              await playlistEngine.notifyItemComplete();
          } else if (transitionSamples.enabled && currentTrack) {
              // Regular loop mode with transition sample
              console.log('🎵 Playing transition sample at loop end');
              // Play a transition sample as we finish the loop
              const sampleKey = 'short'; // Use short sample for loop end
              await playTransitionSample(sampleKey, true, true);
              // Then pause
              await togglePlayPause();
              showStatus(`Loop completed with transition! Played ${loopTarget} time(s)`);
          } else {
              // Regular loop mode without samples - just pause
              await togglePlayPause();
              showStatus(`Loop completed! Played ${loopTarget} time(s)`);
          }
          loopCount = 0;
      } else {
          showStatus(`Loop ${loopCount + 1}/${loopTarget}`);
          loopStartTime = Date.now();

          // Use debounced seek function
          await seekToPosition(loopStart * 1000);
      }
  } catch (error) {
      console.error('🚨 Loop error:', error);
      showStatus(`Loop error: ${error.message}`);
  } finally {
      isLooping = false;
  }
}

// Enhanced Search with pagination and navigation
async function searchTracks(query) {
  if (!spotifyAccessToken || query.length < 2) return;

  try {
      // Reset search state for new query
      if (query !== searchState.query) {
          searchState = {
              isSecondLevel: false,
              currentLevel: 'tracks',
              currentEntity: null,
              currentOffset: 0,
              totalTracks: 0,
              hasMore: false,
              query: query
          };
      }

      const limit = 10; // Reduced initial limit
      const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${searchState.currentOffset}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (response.status === 401) {
          localStorage.removeItem('spotify_access_token');
          showView('login');
          showStatus('Session expired. Please reconnect.');
          return;
      }

      const data = await response.json();
      const tracks = data.tracks?.items || [];

      // Update search state
      searchState.totalTracks = data.tracks?.total || 0;
      searchState.hasMore = searchState.currentOffset + tracks.length < searchState.totalTracks;

      if (searchState.currentOffset === 0) {
          currentSearchResults = tracks;
      } else {
          currentSearchResults = [...currentSearchResults, ...tracks];
      }

      displaySearchResults(currentSearchResults, searchState.hasMore);
      updateSearchNavigation();

  } catch (error) {
      showStatus('Search failed. Please try again.');
  }
}

async function loadMoreTracks() {
  if (!searchState.hasMore || !searchState.query) return;

  searchState.currentOffset += 10;
  showStatus('Loading more tracks...');
  await searchTracks(searchState.query);
}

function displaySearchResults(tracks, hasMore = false) {
  if (tracks.length === 0) {
      els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No results found</div>';
      return;
  }

  let html = tracks.map((track, index) => `
      <div class="track-item" data-track-index="${index}">
          <img src="${track.album.images[2]?.url || ''}" alt="Album cover" class="track-cover" onerror="this.style.display='none'">
          <div class="track-info">
              <div class="track-name">${track.name}</div>
              <div class="track-artist">${track.artists[0].name}</div>
          </div>
          <div class="track-duration">${formatTime(track.duration_ms / 1000, false)}</div>
          <div class="track-actions">
              <button class="track-action-btn play-track-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </button>
              <button class="track-action-btn secondary select-track-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-plus"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button class="track-action-btn menu track-menu-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-more-vertical"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
              </button>
          </div>
      </div>
  `).join('');

  // Add load more button if there are more results
  if (hasMore) {
      html += `
          <button class="load-more-btn" id="load-more-tracks">
              Load More Tracks (${searchState.totalTracks - currentSearchResults.length} remaining)
          </button>
      `;
  }

  els.searchResults.innerHTML = html;

  if (currentTrack) updateSearchTrackHighlighting(currentTrack.uri);
}

function updateSearchNavigation() {
  const backBtn = els.searchBackBtn;
  if (searchState.isSecondLevel) {
      backBtn.classList.remove('hidden');
  } else {
      backBtn.classList.add('hidden');
  }
}

function goBackToMainSearch() {
  searchState.isSecondLevel = false;
  searchState.currentLevel = 'tracks';
  searchState.currentEntity = null;
  searchState.currentOffset = 0;

  updateSearchNavigation();

  // Re-run the current search
  if (searchState.query) {
      searchTracks(searchState.query);
  }
}

function updateSearchTrackHighlighting(uri, isSelected = false) {
  document.querySelectorAll('.track-item').forEach(item => {
      item.classList.remove('playing', 'selected');
  });

  if (uri && currentSearchResults) {
      const trackIndex = currentSearchResults.findIndex(track => track.uri === uri);
      if (trackIndex !== -1) {
          const trackElement = document.querySelector(`[data-track-index="${trackIndex}"]`);
          if (trackElement) {
              if (isSelected) {
                  trackElement.classList.add('selected');
              } else if (isPlaying) {
                  trackElement.classList.add('playing');
              }
          }
      }
  }
}

// Background play without navigation
async function playTrackInBackground(track) {
  try {
      showStatus('🎵 Loading track...');

      currentTrack = {
          uri: track.uri,
          name: track.name,
          artist: track.artists[0].name,
          duration: track.duration_ms / 1000,
          image: track.album.images[0]?.url || ''
      };

      duration = currentTrack.duration;

      await loadTrackIntoSpotify(currentTrack);

      updateSearchTrackHighlighting(track.uri);
      updateNowPlayingIndicator(currentTrack);
      showStatus(`🎵 Playing: ${track.name}`);

  } catch (error) {
      console.error('🚨 Background play error:', error);
      showStatus('Failed to play track');
  }
}

// SEAMLESS SEARCH-TO-PLAYER TRANSITION - NEW IMPLEMENTATION
async function selectTrack(uri, name, artist, durationMs, imageUrl) {
  try {
      // 1. DETECTION LOGIC - Check if same track is already playing
      let seamlessTransition = false;
      let preservedPosition = 0;

      if (currentTrack && currentTrack.uri === uri && isPlaying) {
          console.log('🔄 Seamless transition detected - same track already playing');
          seamlessTransition = true;
          preservedPosition = currentTime * 1000; // Convert to milliseconds
          showStatus('🔄 Taking over playback seamlessly...');
      } else {
          showStatus('🎵 Loading selected track...');
      }

      // Update current track data
      currentTrack = { uri, name, artist, duration: durationMs / 1000, image: imageUrl };
      duration = currentTrack.duration;

      // Update UI display
      els.currentTrack.textContent = name;
      els.currentArtist.textContent = artist;

      // 2. MODIFIED TRACK LOADING - Use preserved position for seamless transitions
      if (seamlessTransition) {
          // Don't reload the track, just continue from current position
          console.log('✅ Seamless transition - continuing from position:', preservedPosition);

          // Ensure progress updates are running and UI is synced
          updateProgress();
          updatePlayPauseButton();
          updateNowPlayingIndicator(currentTrack);
          startProgressUpdates();
      } else {
          // Normal loading for different tracks
          await loadTrackIntoSpotify(currentTrack);

          // Only pause if it's a different track and currently playing
          if (isPlaying) {
              await togglePlayPause();
          }
      }

      // 3. LOOP HANDLE ADJUSTMENT - Position intelligently around current time
      if (seamlessTransition) {
          const currentPos = currentTime;

          // Ensure loop start doesn't exceed current position
          if (loopStart > currentPos) {
              loopStart = Math.max(0, currentPos - 10); // Start 10s before current
              console.log('🔄 Adjusted loop start to accommodate current position');
          }

          // Ensure loop end gives reasonable loop duration from current position
          if (loopEnd <= currentPos) {
              loopEnd = Math.min(duration, currentPos + 20); // End 20s after current
              console.log('🔄 Adjusted loop end to accommodate current position');
          }

          // If current position is way past our loop region, create a new sensible loop around it
          if (currentPos > loopEnd || currentPos + 30 < loopStart) {
              loopStart = Math.max(0, currentPos - 5); // 5s before current
              loopEnd = Math.min(duration, currentPos + 25); // 25s after current
              console.log('🔄 Created new loop region around current position');
          }

          showStatus(`✅ Seamless takeover: ${name} (continuing from ${formatTime(currentPos)})`);
      } else {
          // Normal loop positioning for new tracks
          loopStart = 0;
          loopEnd = Math.min(30, duration);
          showStatus(`✅ Selected: ${name}`);
      }

      updateLoopVisuals();
      updateProgress();
      showView('player');

  } catch (error) {
      console.error('🚨 Track selection error:', error);
      showStatus('Failed to load track');
  }
}

// Views
function showView(view) {
  currentView = view;

  els.loginScreen.classList.add('hidden');
  els.searchSection.classList.add('hidden');
  els.playerSection.classList.add('hidden');
  els.librarySection.classList.add('hidden');
  els.playlistsSection.classList.add('hidden');

  if (view === 'login') els.loginScreen.classList.remove('hidden');
  if (view === 'search') els.searchSection.classList.remove('hidden');
  if (view === 'player') els.playerSection.classList.remove('hidden');
  if (view === 'library') els.librarySection.classList.remove('hidden');
  if (view === 'playlists') {
      els.playlistsSection.classList.remove('hidden');
      renderPlaylistsList();
  }

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const navBtn = document.getElementById(`nav-${view}`);
  if (navBtn) navBtn.classList.add('active');

  if (view === 'library') {
      loadSavedLoops();
      renderLoopsList();
  }
}

// Loop Handles
function setupLoopHandles() {
  let dragTarget = null;

  function startDrag(e, target) {
      isDragging = true;
      dragTarget = target;
      target.classList.add('dragging');
      const popup = target.querySelector('.time-popup');
      if (popup) popup.classList.add('show');
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
  }

  function updateDrag(e) {
      if (!isDragging || !dragTarget || !duration) return;
      if (e.preventDefault) e.preventDefault();

      const rect = els.progressContainer.getBoundingClientRect();
      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const newTime = percent * duration;

      if (dragTarget === els.loopStartHandle) {
          const maxStart = Math.max(0, loopEnd - 0.1);
          loopStart = Math.max(0, Math.min(newTime, maxStart));
          els.startPopup.textContent = formatTime(loopStart);
      } else if (dragTarget === els.loopEndHandle) {
          const minEnd = Math.min(duration, loopStart + 0.1);
          loopEnd = Math.max(minEnd, Math.min(newTime, duration));
          els.endPopup.textContent = formatTime(loopEnd);
      }

      updateLoopVisuals();
  }

  function stopDrag(e) {
      if (isDragging && dragTarget) {
          dragTarget.classList.remove('dragging');
          const popup = dragTarget.querySelector('.time-popup');
          if (popup) setTimeout(() => popup.classList.remove('show'), 500);
          isDragging = false;
          dragTarget = null;
          if (e && e.preventDefault) e.preventDefault();
      }
  }

  els.loopStartHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopStartHandle));
  els.loopEndHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopEndHandle));
  document.addEventListener('mousemove', updateDrag);
  document.addEventListener('mouseup', stopDrag);

  els.loopStartHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopStartHandle), { passive: false });
  els.loopEndHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopEndHandle), { passive: false });
  document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateDrag(e.touches[0]); }, { passive: false });
  document.addEventListener('touchend', stopDrag, { passive: false });
}

// Loops Management
function loadSavedLoops() {
  try {
      const sessionData = sessionStorage.getItem('looopz_saved_loops');
      if (sessionData && !localStorage.getItem('looopz_saved_loops')) {
          localStorage.setItem('looopz_saved_loops', sessionData);
          sessionStorage.removeItem('looopz_saved_loops');
          showStatus('✅ Restored your saved loops!');
      }

      const saved = localStorage.getItem('looopz_saved_loops');
      savedLoops = saved ? JSON.parse(saved) : [];
      updateLoopCountBadge();
  } catch (error) {
      savedLoops = [];
  }
}

function saveLooopsToStorage() {
  try {
      localStorage.setItem('looopz_saved_loops', JSON.stringify(savedLoops));
      updateLoopCountBadge();
  } catch (error) {
      showStatus('Error saving loops');
  }
}

async function saveCurrentLoop() {
  if (!currentTrack) {
      showStatus('No track selected to save');
      return;
  }

  const existingLoop = savedLoops.find(l =>
      l.track.uri === currentTrack.uri &&
      Math.abs(l.loop.start - loopStart) < 0.1 &&
      Math.abs(l.loop.end - loopEnd) < 0.1 &&
      l.loop.repeat === loopTarget
  );

  if (existingLoop) {
      showStatus('This exact loop is already saved');
      return;
  }

  const loop = {
      id: `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      track: {
          uri: currentTrack.uri,
          name: currentTrack.name,
          artist: currentTrack.artist,
          duration: currentTrack.duration,
          image: currentTrack.image
      },
      loop: { start: loopStart, end: loopEnd, repeat: loopTarget },
      savedAt: new Date().toISOString(),
      playCount: 0
  };

  savedLoops.unshift(loop);
  saveLooopsToStorage();

  const saveBtn = els.saveLoopBtn;
  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML = 'Saved!';
  saveBtn.style.background = 'linear-gradient(135deg, #27ae60, #22c55e)';

  setTimeout(() => {
      saveBtn.innerHTML = originalText;
      saveBtn.style.background = '';
  }, 2000);

  showStatus(`Loop saved! Total: ${savedLoops.length}`);
}

function renderLoopsList() {
  if (savedLoops.length === 0) {
      els.loopsList.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
              <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-archive"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
              </div>
              <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No saved loops yet</div>
              <div style="color: var(--light-gray); font-size: 13px;">Create and save loops to build your collection</div>
          </div>
      `;
      return;
  }

  els.loopsList.innerHTML = savedLoops.map((loop, index) => `
      <div class="saved-loop" data-loop-id="${loop.id}">
          <div class="loop-header">
              <img src="${loop.track.image || ''}" alt="${loop.track.name}" class="loop-thumbnail" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 60\"%3E%3Crect width=\"60\" height=\"60\" fill=\"%23333\"/%3E%3C/svg%3E'">
              <div class="loop-details">
                  <div class="loop-track-name">${loop.track.name}</div>
                  <div class="loop-artist">${loop.track.artist}</div>
              </div>
          </div>

          <div class="loop-stats">
              <div class="loop-stat">
                  <span class="loop-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-clock"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  </span>
                  <span>${formatTime(loop.loop.start, false)} - ${formatTime(loop.loop.end, false)}</span>
              </div>
              <div class="loop-stat">
                  <span class="loop-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-repeat"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                  </span>
                  <span>${loop.loop.repeat}×</span>
              </div>
              <div class="loop-stat">
                  <span class="loop-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-calendar"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </span>
                  <span>${new Date(loop.savedAt).toLocaleDateString()}</span>
              </div>
          </div>

          <div class="loop-actions">
              <button class="loop-action-btn load-btn" data-loop-id="${loop.id}">Load</button>
              <button class="loop-action-btn add-to-playlist-btn" data-loop-id="${loop.id}">+ Playlist</button>
              <button class="loop-action-btn edit-btn" data-loop-id="${loop.id}">Edit</button>
              <button class="loop-action-btn share-btn" data-loop-id="${loop.id}">Share</button>
              <button class="loop-action-btn danger delete-btn" data-loop-id="${loop.id}">Delete</button>
          </div>

          <div class="loop-edit-form" id="edit-form-${loop.id}">
              <div class="edit-grid">
                  <div class="edit-field">
                      <label class="edit-label">Start Time</label>
                      <input type="text" class="edit-input" id="edit-start-${loop.id}" value="${formatTime(loop.loop.start)}">
                  </div>
                  <div class="edit-field">
                      <label class="edit-label">End Time</label>
                      <input type="text" class="edit-input" id="edit-end-${loop.id}" value="${formatTime(loop.loop.end)}">
                  </div>
                  <div class="edit-field">
                      <label class="edit-label">Repeat Count</label>
                      <input type="number" class="edit-input" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="99">
                  </div>
              </div>
              <div class="edit-actions">
                  <button class="btn secondary" onclick="saveLoopEdits('${loop.id}')">💾 Save</button>
                  <button class="btn" onclick="cancelEdit('${loop.id}')">❌ Cancel</button>

</div>
          </div>
      </div>
  `).join('');
}

// Library loop loading - starts from loop start position
async function loadSavedLoop(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) {
      showStatus('Loop not found');
      return;
  }

  try {
      showStatus('🔄 Loading saved loop...');

      loop.playCount = (loop.playCount || 0) + 1;
      saveLooopsToStorage();

      currentTrack = {
          uri: loop.track.uri,
          name: loop.track.name,
          artist: loop.track.artist,
          duration: loop.track.duration,
          image: loop.track.image || ''
      };

      duration = currentTrack.duration;
      els.currentTrack.textContent = loop.track.name;
      els.currentArtist.textContent = loop.track.artist;

      loopStart = loop.loop.start;
      loopEnd = loop.loop.end;
      loopTarget = loop.loop.repeat;
      loopEnabled = true;

      if (els.loopToggle) els.loopToggle.checked = true;
      updateRepeatDisplay();
      updateLoopVisuals();

      await loadTrackIntoSpotify(currentTrack, loopStart * 1000);

      loopCount = 0;
      loopStartTime = Date.now();

      updateProgress();
      updatePlayPauseButton();
      updateNowPlayingIndicator(currentTrack);
      startProgressUpdates();

      showView('player');
      showStatus(`🔄 Loop playing: ${loop.track.name} (1/${loopTarget})`);

  } catch (error) {
      console.error('🚨 Load saved loop error:', error);
      showStatus('Failed to load loop');
  }
}

function editLoop(loopId) {
  document.querySelectorAll('.loop-edit-form').forEach(form => form.classList.remove('active'));
  const editForm = document.getElementById(`edit-form-${loopId}`);
  if (editForm) {
      editForm.classList.add('active');
      currentEditingLoopId = loopId;
  }
}

function cancelEdit(loopId) {
  const editForm = document.getElementById(`edit-form-${loopId}`);
  if (editForm) editForm.classList.remove('active');
  currentEditingLoopId = null;
}

function saveLoopEdits(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  const newStart = parseTimeInput(document.getElementById(`edit-start-${loopId}`).value);
  const newEnd = parseTimeInput(document.getElementById(`edit-end-${loopId}`).value);
  const newRepeat = parseInt(document.getElementById(`edit-repeat-${loopId}`).value);

  if (newStart < 0 || newStart >= loop.track.duration || newEnd <= newStart || newEnd > loop.track.duration || newRepeat < 1 || newRepeat > 99) {
      showStatus('❌ Invalid values');
      return;
  }

  loop.loop.start = newStart;
  loop.loop.end = newEnd;
  loop.loop.repeat = newRepeat;
  saveLooopsToStorage();
  renderLoopsList();
  currentEditingLoopId = null;
  showStatus('✅ Loop updated!');
}

// Share button with Web Share API + Open Graph
async function shareSavedLoop(loopId, shareBtn = null) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  if (!shareBtn) {
      shareBtn = document.querySelector(`.share-btn[data-loop-id="${loopId}"]`);
  }

  try {
      if (shareBtn) {
          shareBtn.innerHTML = 'Sharing...';
          shareBtn.style.background = '#f39c12';
          shareBtn.style.color = 'white';
          shareBtn.disabled = true;
      }

      const shareData = {
          track: loop.track.uri,
          start: loop.loop.start.toFixed(1),
          end: loop.loop.end.toFixed(1),
          repeat: loop.loop.repeat,
          name: encodeURIComponent(loop.track.name),
          artist: encodeURIComponent(loop.track.artist)
      };

      const loopUrl = `${window.location.origin}${window.location.pathname}?${new URLSearchParams(shareData).toString()}`;

      // Update Open Graph meta tags
      document.querySelector('meta[property="og:title"]').content = `🎵 ${loop.track.name} - Loop`;
      document.querySelector('meta[property="og:description"]').content = `Perfect loop: ${formatTime(loop.loop.start)} → ${formatTime(loop.loop.end)} (${loop.loop.repeat}×) | Created with LOOOPZ`;
      document.querySelector('meta[property="og:url"]').content = loopUrl;

      // Create formatted share content
      const repeatText = loop.loop.repeat > 1 ? ` (${loop.loop.repeat}×)` : '';
      const shareText = `🎵 Check out this perfect loop I created!

🎤 "${loop.track.name}"
👨‍🎤 ${loop.track.artist}
⏱️ ${formatTime(loop.loop.start)} → ${formatTime(loop.loop.end)}${repeatText}

🔗 Play it here:`;

      // Try Web Share API first
      if (navigator.share && navigator.canShare && navigator.canShare({ url: loopUrl })) {
          await navigator.share({
              title: `🎵 ${loop.track.name} - Loop`,
              text: shareText,
              url: loopUrl
          });

          if (shareBtn) {
              shareBtn.innerHTML = 'Shared!';
              shareBtn.style.background = 'linear-gradient(135deg, #27ae60, #22c55e)';
          }
          showStatus('🔗 Loop shared successfully!');
      } else {
          // Fallback to clipboard with formatted content
          const fullShareContent = `${shareText}\n${loopUrl}`;
          await navigator.clipboard.writeText(fullShareContent);

          if (shareBtn) {
              shareBtn.innerHTML = 'Copied!';
              shareBtn.style.background = 'linear-gradient(135deg, #27ae60, #22c55e)';
          }
          showStatus('🔗 Formatted loop content copied to clipboard!');
      }

      setTimeout(() => {
          if (shareBtn) {
              shareBtn.innerHTML = 'Share';
              shareBtn.style.background = '';
              shareBtn.style.color = '';
              shareBtn.disabled = false;
          }
      }, 3000);

  } catch (err) {
      console.error('Share error:', err);
      showStatus('Failed to share loop');

      if (shareBtn) {
          shareBtn.innerHTML = 'Share';
          shareBtn.style.background = '';
          shareBtn.style.color = '';
          shareBtn.disabled = false;
      }
  }
}

function deleteLoop(loopId) {
  if (!confirm('Delete this loop?')) return;
  savedLoops = savedLoops.filter(l => l.id !== loopId);
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('🗑️ Loop deleted');
}

function clearAllLoops() {
  if (!confirm('Clear all loops?')) return;
  savedLoops = [];
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('🗑️ All loops cleared');
}

// Playlist Management Functions
function loadSavedPlaylists() {
  try {
      const saved = localStorage.getItem('looopz_saved_playlists');
      savedPlaylists = saved ? JSON.parse(saved) : [];
      updatePlaylistCountBadge();
  } catch (error) {
      savedPlaylists = [];
  }
}

function savePlaylistsToStorage() {
  try {
      localStorage.setItem('looopz_saved_playlists', JSON.stringify(savedPlaylists));
      updatePlaylistCountBadge();
  } catch (error) {
      showStatus('Error saving playlists');
  }
}

function createPlaylist(name, description = '') {
  const playlist = {
      id: `playlist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: name || 'Untitled Playlist',
      description: description,
      items: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalDuration: 0,
      playCount: 0
  };

  savedPlaylists.unshift(playlist);
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus(`✅ Playlist "${playlist.name}" created!`);
  return playlist;
}

function deletePlaylist(playlistId) {
  if (!confirm('Delete this playlist?')) return;
  savedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus('🗑️ Playlist deleted');
}

function addItemToPlaylist(playlistId, item) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  // Check if item already exists
  const exists = playlist.items.some(i =>
      i.type === item.type &&
      i.uri === item.uri &&
      i.start === item.start &&
      i.end === item.end
  );

  if (exists) {
      showStatus('This item is already in the playlist');
      return;
  }

  playlist.items.push(item);
  playlist.updatedAt = new Date().toISOString();

  // Update total duration
  const itemDuration = item.type === 'loop'
      ? (item.end - item.start) * item.playCount
      : item.duration * item.playCount;
  playlist.totalDuration += itemDuration;

  savePlaylistsToStorage();
  showStatus(`✅ Added to "${playlist.name}"`);
}

function removeItemFromPlaylist(playlistId, itemIndex) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || itemIndex < 0 || itemIndex >= playlist.items.length) return;

  const item = playlist.items[itemIndex];
  const itemDuration = item.type === 'loop'
      ? (item.end - item.start) * item.playCount
      : item.duration * item.playCount;
  playlist.totalDuration -= itemDuration;

  playlist.items.splice(itemIndex, 1);
  playlist.updatedAt = new Date().toISOString();

  savePlaylistsToStorage();
  showStatus('✅ Removed from playlist');
}

function updatePlaylistItem(playlistId, itemIndex, updates) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || itemIndex < 0 || itemIndex >= playlist.items.length) return;

  const item = playlist.items[itemIndex];

  // Update play count if changed
  if (updates.playCount && updates.playCount !== item.playCount) {
      const oldDuration = item.type === 'loop'
          ? (item.end - item.start) * item.playCount
          : item.duration * item.playCount;
      const newDuration = item.type === 'loop'
          ? (item.end - item.start) * updates.playCount
          : item.duration * updates.playCount;

      playlist.totalDuration += (newDuration - oldDuration);
      item.playCount = updates.playCount;
  }

  playlist.updatedAt = new Date().toISOString();
  savePlaylistsToStorage();
}

function reorderPlaylistItems(playlistId, fromIndex, toIndex) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  // Remove item from original position
  const [item] = playlist.items.splice(fromIndex, 1);

  // Insert at new position
  playlist.items.splice(toIndex, 0, item);

  playlist.updatedAt = new Date().toISOString();
  savePlaylistsToStorage();
}

async function playPlaylist(playlistId, startIndex = 0) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || playlist.items.length === 0) {
      showStatus('Playlist is empty');
      return;
  }

  if (!playlistEngine) {
      showStatus('Playlist engine not ready');
      return;
  }

  try {
      // Update play count
      playlist.playCount = (playlist.playCount || 0) + 1;
      savePlaylistsToStorage();

      // Start playlist mode
      isPlaylistMode = true;
      currentPlaylist = playlist;
      currentPlaylistIndex = startIndex;

      // Load playlist into engine
      await playlistEngine.loadPlaylist(playlist, startIndex);

      // Show player view with playlist controls
      showView('player');
      showPlaylistNowPlaying();

      showStatus(`🎵 Playing playlist: ${playlist.name}`);

  } catch (error) {
      console.error('🚨 Playlist play error:', error);
      showStatus('Failed to play playlist');
      isPlaylistMode = false;
  }
}

function stopPlaylistMode() {
  isPlaylistMode = false;
  currentPlaylist = null;
  currentPlaylistIndex = 0;

  if (playlistEngine) {
      playlistEngine.stopPlaylist();
  }

  hidePlaylistNowPlaying();
}

function showPlaylistNowPlaying() {
  const nowPlaying = document.getElementById('playlist-now-playing');
  if (nowPlaying) nowPlaying.classList.remove('hidden');
}

function hidePlaylistNowPlaying() {
  const nowPlaying = document.getElementById('playlist-now-playing');
  if (nowPlaying) nowPlaying.classList.add('hidden');
}

function updatePlaylistNowPlaying(item, index) {
  if (!currentPlaylist) return;

  const totalItems = currentPlaylist.items.length;
  document.getElementById('playlist-progress').textContent = `${index + 1}/${totalItems}`;

  const icon = document.getElementById('playlist-current-icon');
  const name = document.getElementById('playlist-current-name');
  const type = document.getElementById('playlist-current-type');

  if (item.type === 'loop') {
      icon.src = item.image || '';
      name.textContent = `${item.name} - ${item.artist}`;
      type.textContent = `Loop: ${formatTime(item.start)} - ${formatTime(item.end)} (${item.playCount}×)`;
  } else {
      icon.src = item.image || '';
      name.textContent = `${item.name} - ${item.artist}`;
      type.textContent = `Full Track (${item.playCount}×)`;
  }
}

// Playlist UI Rendering
function renderPlaylistsList() {
  if (savedPlaylists.length === 0) {
      els.playlistsList.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
              <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-music"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              </div>
              <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No playlists yet</div>
              <div style="color: var(--light-gray); font-size: 13px;">Create playlists to mix loops and full tracks</div>
          </div>
      `;
      return;
  }

  els.playlistsList.innerHTML = savedPlaylists.map((playlist) => `
      <div class="playlist-card" data-playlist-id="${playlist.id}">
          <div class="playlist-header">
              <div class="playlist-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-music"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              </div>
              <div class="playlist-details">
                  <div class="playlist-name">${playlist.name}</div>
                  <div class="playlist-description">${playlist.description || `${playlist.items.length} items`}</div>
              </div>
          </div>

          <div class="playlist-stats">
              <div class="playlist-stat">
                  <span class="playlist-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-list"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  </span>
                  <span>${playlist.items.length} items</span>
              </div>
              <div class="playlist-stat">
                  <span class="playlist-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-clock"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  </span>
                  <span>${formatTime(playlist.totalDuration, false)}</span>
              </div>
              <div class="playlist-stat">
                  <span class="playlist-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  </span>
                  <span>${playlist.playCount || 0} plays</span>
              </div>
          </div>

          <div class="playlist-actions">
              <button class="playlist-action-btn play-playlist-btn" data-playlist-id="${playlist.id}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                Play
              </button>
              <button class="playlist-action-btn edit-playlist-btn" data-playlist-id="${playlist.id}">Edit</button>
              <button class="playlist-action-btn share-playlist-btn" data-playlist-id="${playlist.id}">Share</button>
              <button class="playlist-action-btn danger delete-playlist-btn" data-playlist-id="${playlist.id}">Delete</button>
          </div>

          <div class="playlist-editor" id="playlist-editor-${playlist.id}">
              <div class="playlist-items" id="playlist-items-${playlist.id}">
                  ${renderPlaylistItems(playlist)}
              </div>
              <div class="edit-actions">
                  <button class="btn secondary" onclick="savePlaylistEdits('${playlist.id}')">💾 Save Changes</button>
                  <button class="btn" onclick="cancelPlaylistEdit('${playlist.id}')">❌ Cancel</button>
              </div>
          </div>
      </div>
  `).join('');
}

function renderPlaylistItems(playlist) {
  if (playlist.items.length === 0) {
      return '<div style="text-align: center; padding: 20px; color: var(--light-gray);">No items in playlist</div>';
  }

  return playlist.items.map((item, index) => `
      <div class="playlist-item" data-item-index="${index}" draggable="true">
          <div class="playlist-item-handle">☰</div>
          <div class="playlist-item-info">
              <div class="playlist-item-name">${item.name} - ${item.artist}</div>
              <div class="playlist-item-type">
                  ${item.type === 'loop'
                      ? `Loop: ${formatTime(item.start, false)} - ${formatTime(item.end, false)}`
                      : 'Full Track'}
              </div>
          </div>
          <div class="playlist-item-repeat">${item.playCount}×</div>
          <button class="playlist-item-remove" onclick="removeFromPlaylist('${playlist.id}', ${index})">×</button>
      </div>
  `).join('');
}

function editPlaylist(playlistId) {
  document.querySelectorAll('.playlist-editor').forEach(editor => editor.classList.remove('active'));
  const editor = document.getElementById(`playlist-editor-${playlistId}`);
  if (editor) {
      editor.classList.add('active');
      currentEditingPlaylistId = playlistId;
      setupPlaylistDragAndDrop(playlistId);
  }
}

function cancelPlaylistEdit(playlistId) {
  const editor = document.getElementById(`playlist-editor-${playlistId}`);
  if (editor) editor.classList.remove('active');
  currentEditingPlaylistId = null;
}

function savePlaylistEdits(playlistId) {
  // Just close the editor - changes are saved automatically
  cancelPlaylistEdit(playlistId);
  showStatus('✅ Playlist updated!');
}

function removeFromPlaylist(playlistId, itemIndex) {
  removeItemFromPlaylist(playlistId, itemIndex);

  // Re-render the playlist items
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (playlist) {
      const itemsContainer = document.getElementById(`playlist-items-${playlistId}`);
      if (itemsContainer) {
          itemsContainer.innerHTML = renderPlaylistItems(playlist);
      }
  }
}

// Drag and Drop for playlist reordering
function setupPlaylistDragAndDrop(playlistId) {
  const container = document.getElementById(`playlist-items-${playlistId}`);
  if (!container) return;

  let draggedElement = null;
  let draggedIndex = null;

  container.addEventListener('dragstart', (e) => {
      if (!e.target.classList.contains('playlist-item')) return;

      draggedElement = e.target;
      draggedIndex = parseInt(e.target.dataset.itemIndex);
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragend', (e) => {
      if (!e.target.classList.contains('playlist-item')) return;
      e.target.classList.remove('dragging');
  });

  container.addEventListener('dragover', (e) => {
      e.preventDefault();

      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement == null) {
          container.appendChild(draggedElement);
      } else {
          container.insertBefore(draggedElement, afterElement);
      }
  });

  container.addEventListener('drop', (e) => {
      e.preventDefault();

      const items = [...container.querySelectorAll('.playlist-item:not(.dragging)')];
      const newIndex = items.indexOf(draggedElement);

      if (newIndex !== draggedIndex) {
          reorderPlaylistItems(playlistId, draggedIndex, newIndex);

          // Re-render items
          const playlist = savedPlaylists.find(p => p.id === playlistId);
          if (playlist) {
              container.innerHTML = renderPlaylistItems(playlist);
              setupPlaylistDragAndDrop(playlistId);
          }
      }
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.playlist-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
      } else {
          return closest;
      }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Add to Playlist Popup
function showAddToPlaylistPopup() {
  loadSavedPlaylists(); // Ensure latest playlists

  const popup = els.addToPlaylistPopup;
  const list = els.playlistSelectionList;

  if (savedPlaylists.length === 0) {
      list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No playlists yet. Create one first!</div>';
  } else {
      list.innerHTML = savedPlaylists.map(playlist => `
          <div class="playlist-selection-item" data-playlist-id="${playlist.id}">
              <div class="playlist-selection-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-music"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
              </div>
              <div class="playlist-selection-info">
                  <div class="playlist-selection-name">${playlist.name}</div>
                  <div class="playlist-selection-count">${playlist.items.length} items</div>
              </div>
          </div>
      `).join('');
  }

  popup.classList.remove('hidden');
}

function hideAddToPlaylistPopup() {
  els.addToPlaylistPopup.classList.add('hidden');
  pendingPlaylistItem = null;
}

// Create Playlist Form
function showCreatePlaylistForm(fromAddToPlaylist = false) {
  els.playlistFormPopup.classList.remove('hidden');
  els.playlistFormTitle.textContent = 'Create Playlist';
  els.playlistNameInput.value = '';
  els.playlistDescriptionInput.value = '';

  els.playlistFormSave.onclick = () => {
      const name = els.playlistNameInput.value.trim();
      const description = els.playlistDescriptionInput.value.trim();

      if (!name) {
          showStatus('Please enter a playlist name');
          return;
      }

      const playlist = createPlaylist(name, description);
      els.playlistFormPopup.classList.add('hidden');

      // If creating from add to playlist flow, add the pending item
      if (fromAddToPlaylist && pendingPlaylistItem) {
          addItemToPlaylist(playlist.id, pendingPlaylistItem);
          hideAddToPlaylistPopup();
          pendingPlaylistItem = null;
      }
  };
}

function hideCreatePlaylistForm() {
  els.playlistFormPopup.classList.add('hidden');
}

// Share playlist
async function sharePlaylist(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  const shareData = {
      title: `🎵 ${playlist.name} - LOOOPZ Playlist`,
      text: `Check out my playlist "${playlist.name}" with ${playlist.items.length} items!`,
      url: window.location.origin + window.location.pathname
  };

  try {
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          await navigator.share(shareData);
          showStatus('🔗 Playlist shared!');
      } else {
          await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}`);
          showStatus('📋 Playlist link copied!');
      }
  } catch (error) {
      showStatus('Failed to share playlist');
  }
}

// Add current loop/track to playlist
async function addCurrentToPlaylist() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  // Create pending item based on current state
  if (loopEnabled) {
      pendingPlaylistItem = {
          type: 'loop',
          trackUri: currentTrack.uri,
          name: currentTrack.name,
          artist: currentTrack.artist,
          duration: currentTrack.duration,
          image: currentTrack.image,
          start: loopStart,
          end: loopEnd,
          playCount: loopTarget
      };
  } else {
      pendingPlaylistItem = {
          type: 'track',
          uri: currentTrack.uri,
          name: currentTrack.name,
          artist: currentTrack.artist,
          duration: currentTrack.duration,
          image: currentTrack.image,
          playCount: 1
      };
  }

  showAddToPlaylistPopup();
}

// Add saved loop to playlist
function addLoopToPlaylist(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  pendingPlaylistItem = {
      type: 'loop',
      trackUri: loop.track.uri,
      name: loop.track.name,
      artist: loop.track.artist,
      duration: loop.track.duration,
      image: loop.track.image,
      start: loop.loop.start,
      end: loop.loop.end,
      playCount: loop.loop.repeat
  };

  showAddToPlaylistPopup();
}

// Shared Loops
function checkForSharedLoop() {
  const urlParams = new URLSearchParams(window.location.search);
  const sharedTrack = urlParams.get('track');
  const sharedStart = urlParams.get('start');
  const sharedEnd = urlParams.get('end');
  const sharedRepeat = urlParams.get('repeat');
  const sharedName = urlParams.get('name');
  const sharedArtist = urlParams.get('artist');

  console.log('🔗 Checking for shared loop...', { sharedTrack, sharedStart, sharedEnd });

  if (sharedTrack && sharedStart && sharedEnd) {
      console.log('🔗 Found shared loop in URL!');

      const sharedLoop = {
          track: sharedTrack,
          start: parseFloat(sharedStart),
          end: parseFloat(sharedEnd),
          repeat: parseInt(sharedRepeat) || 1,
          name: sharedName ? decodeURIComponent(sharedName) : null,
          artist: sharedArtist ? decodeURIComponent(sharedArtist) : null
      };

      sessionStorage.setItem('shared_loop', JSON.stringify(sharedLoop));
      console.log('🔗 Stored shared loop data:', sharedLoop);

      if (isConnected && spotifyAccessToken) {
          console.log('🔗 Already connected, loading shared loop...');
          setTimeout(() => loadSharedLoop(), 1000);
      } else {
          console.log('🔗 Not connected, showing preview...');
          showSharedLoopPreview(sharedLoop);
      }

      return true;
  }
  return false;
}

function showSharedLoopPreview(sharedLoop) {
  showView('login');
  const loginSubtitle = document.querySelector('.login-subtitle');
  if (loginSubtitle && sharedLoop.name && sharedLoop.artist) {
      const repeatText = sharedLoop.repeat > 1 ? ` (${sharedLoop.repeat}×)` : '';
      loginSubtitle.innerHTML = `
          <div style="background: linear-gradient(135deg, rgba(29, 185, 84, 0.2), rgba(153, 69, 219, 0.2));
                      padding: 20px; border-radius: 16px; border: 1px solid rgba(29, 185, 84, 0.3);
                      margin-bottom: 20px;">
              <div style="font-size: 16px; color: var(--primary); margin-bottom: 8px;">
                  🔗 Someone shared a loop with you!
              </div>
              <div style="font-size: 18px; font-weight: 600; margin-bottom: 4px;">
                  "${sharedLoop.name}"
              </div>
              <div style="color: var(--light-gray); margin-bottom: 8px;">
                  by ${sharedLoop.artist}
              </div>
              <div style="font-size: 14px; color: var(--light-gray);">
                  Loop: ${formatTime(sharedLoop.start)} - ${formatTime(sharedLoop.end)}${repeatText}
              </div>
          </div>
          <div style="color: var(--light-gray); font-size: 16px;">
              Connect Spotify to play this loop instantly!
          </div>
      `;
  }
}

// Shared loop loading
async function loadSharedLoop() {
  const sharedLoopData = sessionStorage.getItem('shared_loop');
  if (!sharedLoopData) {
      console.log('🔗 No shared loop data found');
      return;
  }

  try {
      const sharedLoop = JSON.parse(sharedLoopData);
      console.log('🔗 Loading shared loop:', sharedLoop);

      showStatus('🔗 Loading shared loop...');

      const trackId = sharedLoop.track.split(':')[2];
      if (!trackId) {
          throw new Error('Invalid track URI format');
      }

      const response = await fetch(`https://api.spotify.com/v1/tracks/${trackId}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (!response.ok) {
          throw new Error(`Failed to load track: ${response.status}`);
      }

      const track = await response.json();
      console.log('🔗 Track loaded:', track.name);

      const choice = await showSharedLoopDialog(track, sharedLoop);

      if (choice === 'cancel') {
          sessionStorage.removeItem('shared_loop');
          cleanupSharedUrl();
          return;
      }

      if (choice === 'load') {
          currentTrack = {
              uri: track.uri,
              name: track.name,
              artist: track.artists[0].name,
              duration: track.duration_ms / 1000,
              image: track.album.images[0]?.url || ''
          };

          duration = currentTrack.duration;
          els.currentTrack.textContent = track.name;
          els.currentArtist.textContent = track.artists[0].name;

          loopStart = sharedLoop.start;
          loopEnd = sharedLoop.end;
          loopTarget = sharedLoop.repeat;
          loopEnabled = true;

          if (els.loopToggle) els.loopToggle.checked = true;
          updateRepeatDisplay();
          updateLoopVisuals();

          await loadTrackIntoSpotify(currentTrack, loopStart * 1000);

          loopCount = 0;
          loopStartTime = Date.now();

          updateProgress();
          updatePlayPauseButton();
          updateNowPlayingIndicator(currentTrack);
          startProgressUpdates();

          showView('player');
      }

      sessionStorage.removeItem('shared_loop');
      cleanupSharedUrl();

      const repeatText = sharedLoop.repeat > 1 ? ` (${sharedLoop.repeat}×)` : '';
      showStatus(`🔗 Shared loop loaded: "${track.name}" (${formatTime(sharedLoop.start)} - ${formatTime(sharedLoop.end)}${repeatText})`);

  } catch (error) {
      console.error('🔗 Error loading shared track:', error);
      showStatus('❌ Failed to load shared loop');
      sessionStorage.removeItem('shared_loop');
      cleanupSharedUrl();
  }
}

async function showSharedLoopDialog(track, sharedLoop) {
  return new Promise((resolve) => {
      const dialog = document.createElement('div');
      dialog.style.cssText = `
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(10, 10, 10, 0.95); backdrop-filter: blur(10px);
          z-index: 1001; display: flex; align-items: center; justify-content: center;
      `;

      const repeatText = sharedLoop.repeat > 1 ? ` (${sharedLoop.repeat}×)` : '';

      dialog.innerHTML = `
          <div style="background: linear-gradient(145deg, #1a1a1a, #2a2a2a);
                      border: 1px solid rgba(29, 185, 84, 0.3); border-radius: 20px;
                      padding: 30px; max-width: 400px; text-align: center; color: white;">
              <div style="font-size: 24px; margin-bottom: 8px;">🔗 Shared Loop</div>
              <div style="font-size: 18px; font-weight: 600; margin-bottom: 4px; color: #1DB954;">
                  "${track.name}"
              </div>
              <div style="color: #b3b3b3; margin-bottom: 8px;">by ${track.artists[0].name}</div>
              <div style="color: #b3b3b3; font-size: 14px; margin-bottom: 20px;">
                  Loop: ${formatTime(sharedLoop.start)} - ${formatTime(sharedLoop.end)}${repeatText}
              </div>
              <div style="display: flex; gap: 12px; justify-content: center;">
                  <button id="load-btn" style="background: linear-gradient(135deg, #1DB954, #1ed760);
                                                color: white; border: none; padding: 12px 24px;
                                                border-radius: 50px; font-weight: 600; cursor: pointer;">
                      🔄 Load & Play
                  </button>
                  <button id="cancel-btn" style="background: #444; color: white; border: none;
                                                padding: 12px 24px; border-radius: 50px;
                                                font-weight: 600; cursor: pointer;">
                      ❌ Cancel
                  </button>
              </div>
          </div>
      `;

      document.body.appendChild(dialog);

      dialog.querySelector('#load-btn').onclick = () => {
          document.body.removeChild(dialog);
          resolve('load');
      };

      dialog.querySelector('#cancel-btn').onclick = () => {
          document.body.removeChild(dialog);
          resolve('cancel');
      };

      dialog.onclick = (e) => {
          if (e.target === dialog) {
              document.body.removeChild(dialog);
              resolve('cancel');
          }
      };
  });
}

function cleanupSharedUrl() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
  console.log('🔗 Cleaned up shared URL');
}

// Enhanced Auth Check
function checkAuth() {
  console.log('🔐 Starting auth check...');

  const sessionToken = sessionStorage.getItem('spotify_access_token');
  if (sessionToken && !localStorage.getItem('spotify_access_token')) {
      console.log('🔄 Migrating auth from sessionStorage...');
      localStorage.setItem('spotify_access_token', sessionToken);
      sessionStorage.removeItem('spotify_access_token');
      const sessionRefresh = sessionStorage.getItem('spotify_refresh_token');
      if (sessionRefresh) {
          localStorage.setItem('spotify_refresh_token', sessionRefresh);
          sessionStorage.removeItem('spotify_refresh_token');
      }
  }

  const hasSharedLoop = checkForSharedLoop();
  console.log('🔗 Has shared loop:', hasSharedLoop);

  const storedToken = localStorage.getItem('spotify_access_token');
  if (storedToken && spotifyAccessToken && isConnected && spotifyDeviceId) {
      console.log('🔐 Already connected, checking for shared loops...');
      if (hasSharedLoop) {
          setTimeout(() => loadSharedLoop(), 1000);
      }
      return;
  }

  if (storedToken) {
      console.log('🔐 Found stored token, validating...');
      spotifyAccessToken = storedToken;
      validateToken(storedToken);
      return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  if (error) {
      console.log('🔐 Auth error:', error);
      showStatus('Authentication failed: ' + error);
      showView('login');
      return;
  }

  if (code) {
      console.log('🔐 Found auth code, exchanging for token...');
      exchangeCodeForToken(code);
      return;
  }

  console.log('🔐 No auth found, showing login...');
  showView('login');
}

async function validateToken(token) {
  try {
      const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
          initializeSpotifyPlayer();
      } else {
          localStorage.removeItem('spotify_access_token');
          localStorage.removeItem('spotify_refresh_token');
          spotifyAccessToken = null;
          showView('login');
          showStatus('Session expired. Please reconnect.');
      }
  } catch (error) {
      localStorage.removeItem('spotify_access_token');
      localStorage.removeItem('spotify_refresh_token');
      spotifyAccessToken = null;
      showView('login');
      showStatus('Connection error. Please reconnect.');
  }
}

// Enhanced Event Delegation
function setupEventListeners() {
  // Navigation
  els.navSearch.addEventListener('click', (e) => {
      e.preventDefault();
      isConnected ? showView('search') : showView('login');
  });

  els.navPlayer.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentTrack) {
          showView('player');
      } else {
          showStatus('Please select a track first');
          isConnected ? showView('search') : showView('login');
      }
  });

  els.navLibrary.addEventListener('click', (e) => {
      e.preventDefault();
      showView('library');
  });

  els.navPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      showView('playlists');
  });

  els.navDiscovery.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = 'discovery.html';
  });

  // ESC key to close popup or context menu
  document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
          if (!els.precisionPopup.classList.contains('hidden')) {
              els.precisionPopup.classList.add('hidden');
          } else if (els.contextMenuOverlay.classList.contains('show')) {
              hideTrackContextMenu();
          } else if (!els.addToPlaylistPopup.classList.contains('hidden')) {
              hideAddToPlaylistPopup();
          } else if (!els.playlistFormPopup.classList.contains('hidden')) {
              hideCreatePlaylistForm();
          }
      }
  });

  // Main event delegation with immediate response improvements
  document.addEventListener('click', async (e) => {
      const target = e.target;

      try {
          // Playback controls
          if (target.matches('#play-pause-btn')) {
              e.preventDefault();
              if (!currentTrack) {
                  showStatus('Please select a track first');
                  return;
              }
              target.disabled = true;
              try {
                  await togglePlayPause();
              } finally {
                  target.disabled = false;
              }
          }
          else if (target.matches('#backward-btn')) {
              e.preventDefault();
              const newTime = Math.max(0, currentTime - 10);
              await seekToPosition(newTime * 1000);
          }
          else if (target.matches('#forward-btn')) {
              e.preventDefault();
              const newTime = Math.min(duration, currentTime + 10);
              await seekToPosition(newTime * 1000);
          }

          // FIX 2: Changed "Start Loop" to "Set Loop" behavior
          else if (target.matches('#start-loop-btn')) {
              e.preventDefault();
              if (!currentTrack || !loopEnabled) {
                  showStatus('Please select a track and enable loop mode');
                  return;
              }
              // Just enable the loop, don't seek to start
              loopCount = 0;
              loopStartTime = Date.now();
              showStatus(`Loop set: ${formatTime(loopStart)} - ${formatTime(loopEnd)} (${loopTarget}×)`);
          }
          else if (target.matches('#repeat-decrease')) {
              e.preventDefault();
              if (loopTarget > 1) {
                  loopTarget--;
                  updateRepeatDisplay();
                  loopCount = 0;
              }
          }
          else if (target.matches('#repeat-increase')) {
              e.preventDefault();
              if (loopTarget < 99) {
                  loopTarget++;
                  updateRepeatDisplay();
                  loopCount = 0;
              }
          }

          // Precision popup
          else if (target.matches('#precision-btn')) {
              e.preventDefault();
              els.precisionPopup.classList.remove('hidden');
          }
          else if (target.matches('#precision-close')) {
              e.preventDefault();
              els.precisionPopup.classList.add('hidden');
          }
          else if (target.matches('.precision-popup') && !target.closest('.precision-popup-content')) {
              e.preventDefault();
              els.precisionPopup.classList.add('hidden');
          }

          // Search navigation
          else if (target.matches('#search-back-btn')) {
              e.preventDefault();
              goBackToMainSearch();
          }

          // Load more
          else if (target.matches('#load-more-tracks')) {
              e.preventDefault();
              target.disabled = true;
              target.innerHTML = 'Loading...';
              try {
                  await loadMoreTracks();
              } finally {
                  target.disabled = false;
              }
          }

          // Auth buttons
          else if (target.matches('#connect-btn')) {
              e.preventDefault();
              connectSpotify();
          }
          else if (target.matches('#disconnect-btn')) {
              e.preventDefault();
              disconnectSpotify();
          }

          // Search results
          else if (target.matches('.play-track-btn')) {
              e.stopPropagation();
              e.preventDefault();
              const index = parseInt(target.dataset.trackIndex);
              const track = currentSearchResults[index];
              if (track) await playTrackInBackground(track);
          }
          else if (target.matches('.select-track-btn')) {
              e.stopPropagation();
              e.preventDefault();
              const index = parseInt(target.dataset.trackIndex);
              const track = currentSearchResults[index];
              if (track) {
                  updateSearchTrackHighlighting(track.uri, true);
                  await selectTrack(track.uri, track.name, track.artists[0].name, track.duration_ms, track.album.images[0]?.url || '');
              }
          }
          else if (target.matches('.track-menu-btn')) {
              e.stopPropagation();
              e.preventDefault();
              const index = parseInt(target.dataset.trackIndex);
              showTrackContextMenu(index, target);
          }
          else if (target.closest('.track-item') && !target.closest('.track-actions')) {
              e.preventDefault();
              const item = target.closest('.track-item');
              const index = parseInt(item.dataset.trackIndex);
              const track = currentSearchResults[index];
              if (track) {
                  await selectTrack(track.uri, track.name, track.artists[0].name, track.duration_ms, track.album.images[0]?.url || '');
              }
          }

          // Context Menu Actions - IMMEDIATE RESPONSE
          else if (target.matches('#menu-discover-moments')) {
              e.preventDefault();
              await handleDiscoverMoments();
          }
          else if (target.matches('#menu-add-playlist')) {
              e.preventDefault();
              await handleAddToPlaylist();
          }
          else if (target.matches('#menu-create-loop')) {
              e.preventDefault();
              await handleCreateLoop();
          }
          else if (target.matches('#menu-share')) {
              e.preventDefault();
              await handleShare();
          }
          else if (target.matches('#menu-spotify')) {
              e.preventDefault();
              await handleListenInSpotify();
          }
          else if (target.matches('#context-menu-overlay')) {
              e.preventDefault();
              hideTrackContextMenu();
          }

          // Library actions
          else if (target.matches('.load-btn')) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              await loadSavedLoop(loopId);
          }
          else if (target.matches('.add-to-playlist-btn[data-loop-id]')) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              addLoopToPlaylist(loopId);
          }
          else if (target.matches('.edit-btn')) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              editLoop(loopId);
          }
          else if (target.matches('.share-btn')) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              await shareSavedLoop(loopId, target);
          }
          else if (target.matches('.delete-btn')) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              deleteLoop(loopId);
          }
          else if (target.matches('#save-loop-btn')) {
              e.preventDefault();
              await saveCurrentLoop();
          }
          else if (target.matches('#add-to-playlist-btn')) {
              e.preventDefault();
              await addCurrentToPlaylist();
          }
          else if (target.matches('#clear-all-loops')) {
              e.preventDefault();
              clearAllLoops();
          }

          // Playlist actions
          else if (target.matches('#create-playlist-btn')) {
              e.preventDefault();
              showCreatePlaylistForm();
          }
          else if (target.matches('.play-playlist-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              await playPlaylist(playlistId);
          }
          else if (target.matches('.edit-playlist-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              editPlaylist(playlistId);
          }
          else if (target.matches('.share-playlist-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              await sharePlaylist(playlistId);
          }
          else if (target.matches('.delete-playlist-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              deletePlaylist(playlistId);
          }

          // Playlist now playing controls
          else if (target.matches('#playlist-prev-btn')) {
              e.preventDefault();
              if (playlistEngine) await playlistEngine.skipToPrevious();
          }
          else if (target.matches('#playlist-stop-btn')) {
              e.preventDefault();
              stopPlaylistMode();
          }
          else if (target.matches('#playlist-next-btn')) {
              e.preventDefault();
              if (playlistEngine) await playlistEngine.skipToNext();
          }

          // Add to playlist popup
          else if (target.matches('#add-to-playlist-close')) {
              e.preventDefault();
              hideAddToPlaylistPopup();
          }
          else if (target.matches('#quick-create-playlist')) {
              e.preventDefault();
              showCreatePlaylistForm(true);
          }
          else if (target.closest('.playlist-selection-item')) {
              e.preventDefault();
              const item = target.closest('.playlist-selection-item');
              const playlistId = item.dataset.playlistId;
              if (pendingPlaylistItem) {
                  addItemToPlaylist(playlistId, pendingPlaylistItem);
                  hideAddToPlaylistPopup();
                  pendingPlaylistItem = null;
              }
          }

          // Playlist form
          else if (target.matches('#playlist-form-close')) {
              e.preventDefault();
              hideCreatePlaylistForm();
          }
          else if (target.matches('#playlist-form-cancel')) {
              e.preventDefault();
              hideCreatePlaylistForm();
          }

          // Progress bar click
          else if (target.matches('#progress-container') || target.closest('#progress-container')) {
              if (isDragging) return;
              if (target.classList.contains('loop-handle') || target.closest('.loop-handle')) return;

              e.preventDefault();
              const rect = els.progressContainer.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              const newTime = percent * duration;
              await seekToPosition(newTime * 1000);
          }
      } catch (error) {
          console.error('🚨 Event handler error:', error);
          showStatus('Action failed: ' + error.message);
      }
  });

  // Other specific event listeners
  els.loopToggle.addEventListener('change', function() {
      loopEnabled = this.checked;
      loopCount = 0;
      els.startLoopBtn.disabled = !loopEnabled;
      updateLoopVisuals(); // FIX 6: This will show/hide handles
      showStatus(loopEnabled ? `Loop enabled: ${loopTarget} time(s)` : 'Loop disabled');
  });

  els.searchInput.addEventListener('input', function() {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
          // Reset search state for new query
          searchState.currentOffset = 0;
          searchTracks(this.value);
      }, 300);
  });

  els.precisionStart.addEventListener('change', function() {
      const newStart = parseTimeInput(this.value);
      if (newStart >= 0 && newStart < loopEnd && newStart <= duration) {
          loopStart = newStart;
          updateLoopVisuals();
      } else {
          this.value = formatTime(loopStart);
      }
  });

  els.precisionEnd.addEventListener('change', function() {
      const newEnd = parseTimeInput(this.value);
      if (newEnd > loopStart && newEnd <= duration) {
          loopEnd = newEnd;
          updateLoopVisuals();
      } else {
          this.value = formatTime(loopEnd);
      }
  });

  // Fine-tune buttons - simple click only
  document.addEventListener('click', (e) => {
      if (e.target.matches('.fine-tune-btn')) {
          e.preventDefault();
          const targetType = e.target.dataset.target;
          const amount = parseFloat(e.target.dataset.amount);
          if (targetType === 'start') {
              loopStart = Math.max(0, Math.min(loopStart + amount, loopEnd - 0.1));
          } else {
              loopEnd = Math.max(loopStart + 0.1, Math.min(loopEnd + amount, duration));
          }
          updateLoopVisuals();
      }
  });
}

// Global edit functions
window.editLoop = editLoop;
window.cancelEdit = cancelEdit;
window.saveLoopEdits = saveLoopEdits;
window.cancelPlaylistEdit = cancelPlaylistEdit;
window.savePlaylistEdits = savePlaylistEdits;
window.removeFromPlaylist = removeFromPlaylist;

// Init
function init() {
  console.log('🚀 Initializing LOOOPZ with Playlist Management...');

  // Define the Spotify callback early in case SDK loads before we're ready
  window.onSpotifyWebPlaybackSDKReady = window.onSpotifyWebPlaybackSDKReady || function() {
      console.log('⚠️ Spotify SDK ready but player not initialized yet');
  };

  // Cache all elements
  els = {
      loginScreen: document.getElementById('login-screen'),
      searchSection: document.getElementById('search-section'),
      playerSection: document.getElementById('player-section'),
      librarySection: document.getElementById('library-section'),
      playlistsSection: document.getElementById('playlists-section'),
      connectBtn: document.getElementById('connect-btn'),
      disconnectBtn: document.getElementById('disconnect-btn'),
      connectionStatus: document.getElementById('connection-status'),
      statusBar: document.getElementById('status-bar'),
      statusText: document.getElementById('status-text'),
      nowPlayingIndicator: document.getElementById('now-playing-indicator'),
      miniTrackTitle: document.getElementById('mini-track-title'),
      miniTrackArtist: document.getElementById('mini-track-artist'),
      searchInput: document.getElementById('search-input'),
      searchResults: document.getElementById('search-results'),
      searchBackBtn: document.getElementById('search-back-btn'),
      currentTrack: document.getElementById('current-track'),
      currentArtist: document.getElementById('current-artist'),
      progressContainer: document.getElementById('progress-container'),
      progressBar: document.getElementById('progress-bar'),
      loopRegion: document.getElementById('loop-region'),
      loopStartHandle: document.getElementById('loop-start-handle'),
      loopEndHandle: document.getElementById('loop-end-handle'),
      startPopup: document.getElementById('start-popup'),
      endPopup: document.getElementById('end-popup'),
      currentTime: document.getElementById('current-time'),
      duration: document.getElementById('duration'),
      playPauseBtn: document.getElementById('play-pause-btn'),
      backwardBtn: document.getElementById('backward-btn'),
      forwardBtn: document.getElementById('forward-btn'),
      startLoopBtn: document.getElementById('start-loop-btn'),
      saveLoopBtn: document.getElementById('save-loop-btn'),
      addToPlaylistBtn: document.getElementById('add-to-playlist-btn'),
      loopToggle: document.getElementById('loop-toggle'),
      repeatValue: document.getElementById('repeat-value'),
      precisionPopup: document.getElementById('precision-popup'),
      precisionBtn: document.getElementById('precision-btn'),
      precisionClose: document.getElementById('precision-close'),
      precisionStart: document.getElementById('precision-start'),
      precisionEnd: document.getElementById('precision-end'),
      loopsList: document.getElementById('loops-list'),
      loopCountBadge: document.getElementById('loop-count-badge'),
      playlistsList: document.getElementById('playlists-list'),
      playlistCountBadge: document.getElementById('playlist-count-badge'),
      navSearch: document.getElementById('nav-search'),
      navPlayer: document.getElementById('nav-player'),
      navLibrary: document.getElementById('nav-library'),
      navPlaylists: document.getElementById('nav-playlists'),
      navDiscovery: document.getElementById('nav-discovery'),
      contextMenu: document.getElementById('track-context-menu'),
      contextMenuOverlay: document.getElementById('context-menu-overlay'),
      addToPlaylistPopup: document.getElementById('add-to-playlist-popup'),
      addToPlaylistClose: document.getElementById('add-to-playlist-close'),
      playlistSelectionList: document.getElementById('playlist-selection-list'),
      quickCreatePlaylist: document.getElementById('quick-create-playlist'),
      playlistFormPopup: document.getElementById('playlist-form-popup'),
      playlistFormTitle: document.getElementById('playlist-form-title'),
      playlistFormClose: document.getElementById('playlist-form-close'),
      playlistFormSave: document.getElementById('playlist-form-save'),
      playlistFormCancel: document.getElementById('playlist-form-cancel'),
      playlistNameInput: document.getElementById('playlist-name-input'),
      playlistDescriptionInput: document.getElementById('playlist-description-input'),
      createPlaylistBtn: document.getElementById('create-playlist-btn')
  };

  setupEventListeners();
  setupLoopHandles();
  checkAuth();
  loadSavedLoops();
  loadSavedPlaylists();

  console.log('✅ LOOOPZ initialization complete with Playlist Management!');
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
