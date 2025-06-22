// SPOTIFY INTEGRATION - WITH SEAMLESS SEARCH-TO-PLAYER TRANSITION AND PLAYLIST MANAGEMENT
// ENHANCED WITH SMART DJ TRANSITIONS AND BEAT ALIGNMENT

// Config
const SPOTIFY_CLIENT_ID = '46637d8f5adb41c0a4be34e0df0c1597';
const SPOTIFY_REDIRECT_URI = 'https://looopz.vercel.app/';
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

// State
let spotifyPlayer = null, spotifyDeviceId = null, spotifyAccessToken = null;
let isConnected = false, isPlaying = false, currentTrack = null;
let currentTime = 0, duration = 0, loopStart = 0, loopEnd = 30;
let loopEnabled = false, loopCount = 0, loopTarget = 1, loopStartTime = 0;
let updateTimer = null, savedLoops = [], isLooping = false, isDragging = false;
let currentView = 'login', currentSearchResults = [], currentEditingLoopId = null;
let currentContextMenuTrackIndex = null;

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

// NEW: Audio Analysis Cache for Smart Transitions
let audioAnalysisCache = new Map();
let trackFeaturesCache = new Map();

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

// Complete saveLoop function
async function saveLoop() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  const loop = {
      id: Date.now().toString(),
      track: { ...currentTrack },
      loop: {
          start: loopStart,
          end: loopEnd,
          repeat: loopTarget
      },
      created: new Date().toISOString()
  };

  savedLoops.unshift(loop);
  saveLooopsToStorage();
  renderLoopsList();
  
  const saveBtn = els.saveLoopBtn;
  if (saveBtn) {
      const originalText = saveBtn.innerHTML;
      saveBtn.innerHTML = '✅ Saved!';
      saveBtn.style.background = 'linear-gradient(135deg, #27ae60, #22c55e)';

      setTimeout(() => {
          saveBtn.innerHTML = originalText;
          saveBtn.style.background = '';
      }, 2000);
  }

  showStatus(`Loop saved! Total: ${savedLoops.length}`);
}

// Complete loadSavedLoop function
async function loadSavedLoop(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  try {
      showStatus('🔄 Loading loop...');

      currentTrack = { ...loop.track };
      duration = currentTrack.duration;
      loopStart = loop.loop.start;
      loopEnd = loop.loop.end;
      loopTarget = loop.loop.repeat;
      loopEnabled = true;
      loopCount = 0;
      loopStartTime = Date.now();

      els.currentTrack.textContent = currentTrack.name;
      els.currentArtist.textContent = currentTrack.artist;
      if (els.loopToggle) els.loopToggle.checked = true;
      updateRepeatDisplay();
      updateLoopVisuals();

      await loadTrackIntoSpotify(currentTrack);
      await playFromPosition(loopStart * 1000);

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

// Complete shareSavedLoop function
async function shareSavedLoop(loopId, shareBtn) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  try {
      if (shareBtn) {
          shareBtn.innerHTML = 'Sharing...';
          shareBtn.disabled = true;
          shareBtn.style.color = '#1DB954';
      }

      const shareText = `🎵 Check out this loop: "${loop.track.name}" by ${loop.track.artist} (${formatTime(loop.loop.start, false)} - ${formatTime(loop.loop.end, false)}) x${loop.loop.repeat}`;
      const loopUrl = `${window.location.origin}/?loop=${encodeURIComponent(JSON.stringify({
          trackUri: loop.track.uri,
          trackName: loop.track.name,
          trackArtist: loop.track.artist,
          start: loop.loop.start,
          end: loop.loop.end,
          repeat: loop.loop.repeat
      }))}`;

      if (navigator.share && navigator.canShare && navigator.canShare({ url: loopUrl })) {
          await navigator.share({
              title: `LOOOPZ - ${loop.track.name}`,
              text: shareText,
              url: loopUrl
          });

          if (shareBtn) {
              shareBtn.innerHTML = 'Shared!';
              shareBtn.style.background = 'linear-gradient(135deg, #27ae60, #22c55e)';
          }
          showStatus('🔗 Loop shared successfully!');
      } else {
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

// Additional loop management functions
function clearAllLoops() {
  if (!confirm('Clear all loops?')) return;
  savedLoops = [];
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('🗑️ All loops cleared');
}

function addLoopToPlaylist(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  pendingPlaylistItem = {
      type: 'loop',
      trackUri: loop.track.uri,
      trackName: loop.track.name,
      trackArtist: loop.track.artist,
      trackDuration: loop.track.duration,
      trackImage: loop.track.image,
      start: loop.loop.start,
      end: loop.loop.end,
      playCount: loop.loop.repeat,
      name: `${loop.track.name} (${formatTime(loop.loop.start)}-${formatTime(loop.loop.end)})`
  };

  showView('playlists');
  showStatus('Select a playlist to add loop to');
}

// Complete playlist management functions
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

function editPlaylist(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  const newName = prompt('Playlist name:', playlist.name);
  if (!newName || !newName.trim()) return;

  playlist.name = newName.trim();
  playlist.updatedAt = new Date().toISOString();
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus('✅ Playlist updated!');
}

// Context menu additional handlers
async function handleCreateLoop() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
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
      window.location.href = spotifyUrl;
      setTimeout(() => {
          window.open(webUrl, '_blank');
      }, 500);
      showStatus('🎵 Opening in Spotify...');
  } catch (error) {
      window.open(webUrl, '_blank');
      showStatus('🎵 Opening in Spotify...');
  }
}

// Complete loop rendering with all features
function renderLoopsList() {
  if (savedLoops.length === 0) {
      els.loopsList.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
              <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">📦</div>
              <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No saved loops yet</div>
              <div style="color: var(--light-gray); font-size: 13px;">Create and save loops to build your collection</div>
          </div>
      `;
      els.loopCountBadge.textContent = '0';
      return;
  }

  els.loopCountBadge.textContent = savedLoops.length.toString();

  const loopsHtml = savedLoops.map((loop, index) => `
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
                  <span class="loop-stat-icon">⏱</span>
                  <span>${formatTime(loop.loop.start, false)} - ${formatTime(loop.loop.end, false)}</span>
              </div>
              <div class="loop-stat">
                  <span class="loop-stat-icon">🔄</span>
                  <span>${loop.loop.repeat}× repeats</span>
              </div>
              <div class="loop-stat">
                  <span class="loop-stat-icon">⏳</span>
                  <span>${formatTime((loop.loop.end - loop.loop.start) * loop.loop.repeat, false)} total</span>
              </div>
          </div>

          <div class="loop-actions">
              <button class="action-btn load-btn" data-loop-id="${loop.id}" onclick="loadSavedLoop('${loop.id}')">
                  <span class="action-icon">▶</span>
                  <span class="action-text">Play</span>
              </button>
              <button class="action-btn add-to-playlist-btn" data-loop-id="${loop.id}" onclick="addLoopToPlaylist('${loop.id}')">
                  <span class="action-icon">➕</span>
                  <span class="action-text">Add to Playlist</span>
              </button>
              <button class="action-btn edit-btn" data-loop-id="${loop.id}" onclick="editLoop('${loop.id}')">
                  <span class="action-icon">✏</span>
                  <span class="action-text">Edit</span>
              </button>
              <button class="action-btn share-btn" data-loop-id="${loop.id}" onclick="shareSavedLoop('${loop.id}', this)">
                  <span class="action-icon">📤</span>
                  <span class="action-text">Share</span>
              </button>
              <button class="action-btn delete-btn" data-loop-id="${loop.id}" onclick="deleteLoop('${loop.id}')">
                  <span class="action-icon">🗑</span>
                  <span class="action-text">Delete</span>
              </button>
          </div>

          <div class="loop-edit-form" id="edit-form-${loop.id}">
              <div class="edit-form-content">
                  <div class="form-row">
                      <label>Start:</label>
                      <input type="text" id="edit-start-${loop.id}" value="${formatTime(loop.loop.start)}" placeholder="0:00.000">
                  </div>
                  <div class="form-row">
                      <label>End:</label>
                      <input type="text" id="edit-end-${loop.id}" value="${formatTime(loop.loop.end)}" placeholder="0:30.000">
                  </div>
                  <div class="form-row">
                      <label>Repeat:</label>
                      <input type="number" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="99">
                  </div>
                  <div class="edit-form-actions">
                      <button class="save-btn" onclick="saveLoopEdits('${loop.id}')">Save</button>
                      <button class="cancel-btn" onclick="cancelEdit('${loop.id}')">Cancel</button>
                  </div>
              </div>
          </div>
      </div>
  `).join('');

  els.loopsList.innerHTML = loopsHtml;
}

// Complete utility functions
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
  
  if (els.precisionStart) els.precisionStart.value = formatTime(loopStart);
  if (els.precisionEnd) els.precisionEnd.value = formatTime(loopEnd);
}

function updateLoopCountBadge() {
  els.loopCountBadge.textContent = savedLoops.length;
  els.loopCountBadge.style.display = savedLoops.length > 0 ? 'inline-block' : 'none';
}

function updatePlaylistCountBadge() {
  els.playlistCountBadge.textContent = savedPlaylists.length;
  els.playlistCountBadge.style.display = savedPlaylists.length > 0 ? 'inline-block' : 'none';
}

// Complete selectTrack function with seamless transitions
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

      // Ensure loop visuals are properly initialized
      updateLoopVisuals();
      updateProgress();
      
      // Make sure the player section shows the loop controls
      showView('player');

      // If loop was enabled before, make sure handles are visible
      if (loopEnabled && els.loopToggle) {
          els.loopToggle.checked = true;
      }

  } catch (error) {
      console.error('🚨 Track selection error:', error);
      showStatus('Failed to load track');
  }
}

// Complete loadTrackIntoSpotify with proper sync
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
              }
          } catch (e) {
              console.log(`⏳ Sync attempt ${attempts + 1} failed`);
          }
          attempts++;
      }

      if (!synced) {
          console.warn('⚠️ SDK sync incomplete, but track should be loaded');
      }

      console.log('✅ Track loaded and ready for SDK control');
      return true;

  } catch (error) {
      console.error('🚨 Track loading error:', error);
      throw error;
  }
}

// Complete playFromPosition function
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

async function seekToPosition(positionMs) {
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

// Complete addCurrentLoopToPlaylist function
async function addCurrentLoopToPlaylist() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  pendingPlaylistItem = {
      type: 'loop',
      trackUri: currentTrack.uri,
      trackName: currentTrack.name,
      trackArtist: currentTrack.artist,
      trackDuration: currentTrack.duration,
      trackImage: currentTrack.image,
      start: loopStart,
      end: loopEnd,
      playCount: loopTarget,
      name: `${currentTrack.name} (${formatTime(loopStart)}-${formatTime(loopEnd)})`
  };

  showView('playlists');
  showStatus('Select a playlist to add loop to');
}

// Complete loadSavedLoops function with session restore
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
      renderLoopsList();
      updateLoopCountBadge();
  } catch (error) {
      console.error('Failed to load loops:', error);
      savedLoops = [];
  }
}

// Complete playlist functions
async function startPlaylistMode(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || !playlist.items.length) {
      showStatus('Playlist is empty');
      return;
  }

  try {
      isPlaylistMode = true;
      currentPlaylist = playlist;
      currentPlaylistIndex = 0;

      // Show playlist UI
      els.playlistNowPlaying.classList.remove('hidden');
      updatePlaylistProgress();

      // Initialize playlist engine
      if (playlistEngine) {
          await playlistEngine.startPlaylist(playlist);
          showView('player');
          showStatus(`🎵 Playing playlist: ${playlist.name}`);
      } else {
          showStatus('Playlist engine not ready');
      }

  } catch (error) {
      console.error('🚨 Start playlist error:', error);
      showStatus('Failed to start playlist');
      stopPlaylistMode();
  }
}

function updatePlaylistProgress() {
  if (!currentPlaylist) return;
  els.playlistProgress.textContent = `${currentPlaylistIndex + 1}/${currentPlaylist.items.length}`;
}

async function playlistPrevious() {
  if (!isPlaylistMode || !playlistEngine) return;
  await playlistEngine.skipToPrevious();
}

async function playlistNext() {
  if (!isPlaylistMode || !playlistEngine) return;
  await playlistEngine.skipToNext();
}

// Additional setup function to handle drag events
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

  // Mouse events
  els.loopStartHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopStartHandle));
  els.loopEndHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopEndHandle));
  document.addEventListener('mousemove', updateDrag);
  document.addEventListener('mouseup', stopDrag);

  // Touch events
  els.loopStartHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopStartHandle), { passive: false });
  els.loopEndHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopEndHandle), { passive: false });
  document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateDrag(e.touches[0]); }, { passive: false });
  document.addEventListener('touchend', stopDrag, { passive: false });
}

// Authentication functions
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
      showStatus('Successfully authenticated! Setting up player...');
  } else {
      throw new Error(data.error_description || 'Authentication failed');
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

// Complete enhanced event listeners
function setupEnhancedEventListeners() {
  // Search input handling
  els.searchInput.addEventListener('input', function() {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = setTimeout(() => {
          searchState.currentOffset = 0;
          searchTracks(this.value);
      }, 300);
  });

  // Precision timing controls
  if (els.precisionStart) {
      els.precisionStart.addEventListener('change', function() {
          const newStart = parseTimeInput(this.value);
          if (newStart >= 0 && newStart < loopEnd && newStart <= duration) {
              loopStart = newStart;
              updateLoopVisuals();
          } else {
              this.value = formatTime(loopStart);
          }
      });
  }

  if (els.precisionEnd) {
      els.precisionEnd.addEventListener('change', function() {
          const newEnd = parseTimeInput(this.value);
          if (newEnd > loopStart && newEnd <= duration) {
              loopEnd = newEnd;
              updateLoopVisuals();
          } else {
              this.value = formatTime(loopEnd);
          }
      });
  }

  // Fine-tune buttons
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

  els.loopToggle.addEventListener('change', function() {
      loopEnabled = this.checked;
      loopCount = 0;
      els.startLoopBtn.disabled = !loopEnabled;
      updateLoopVisuals();
      showStatus(loopEnabled ? `Loop enabled: ${loopTarget} time(s)` : 'Loop disabled');
  });
}

// Additional utility functions
function searchTracks(query) {
  if (!query.trim()) {
      els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">Search for tracks to start creating loops</div>';
      return;
  }
  performSearch(query);
}

function loadMoreTracks() {
  return loadMoreResults();
}

function showAddToPlaylistPopup() {
  if (!pendingPlaylistItem) return;
  
  // This would show the playlist selection popup
  showView('playlists');
  showStatus('Select a playlist to add item to');
}

function hideCreatePlaylistForm() {
  // This would hide the create playlist form
  console.log('Hide create playlist form');
}

function showCreatePlaylistForm(isQuick = false) {
  // This would show the create playlist form
  const name = prompt('Playlist name:');
  if (name && name.trim()) {
      createPlaylist(name.trim());
  }
}

// Final initialization helpers
function goBackToMainSearch() {
  searchState.isSecondLevel = false;
  searchState.currentLevel = 'tracks';
  searchState.currentEntity = null;
  searchState.currentOffset = 0;
  
  if (searchState.query) {
      searchTracks(searchState.query);
  }
}
}
}

// Rename functions to match original script expectations
const loadSavedLoops = loadLooopsFromStorage;
const loadSavedPlaylists = loadPlaylistsFromStorage;

// Progress monitoring functions  
function startProgressUpdates() {
  stopProgressUpdates();
  updateTimer = setInterval(async () => {
      if (isPlaying && spotifyPlayer && !isLooping) {
          try {
              const state = await spotifyPlayer.getCurrentState();
              if (state && state.position !== undefined) {
                  currentTime = state.position / 1000;
                  updateProgress();
                  
                  // Handle playlist engine progress
                  if (isPlaylistMode && playlistEngine) {
                      await playlistEngine.handlePlaybackProgress(currentTime);
                  }
                  // Handle loop end for regular mode (not playlist mode)
                  else if (loopEnabled && currentTime >= loopEnd - 0.03 && loopCount < loopTarget && !isPlaylistMode) {
                      const timeSinceLoopStart = Date.now() - loopStartTime;
                      if (timeSinceLoopStart > 300) await handleLoopEnd();
                  }
              }
          } catch (error) {
              console.warn('State check failed:', error.message);
          }
      }
  }, 50); // 50ms for higher precision
}

function stopProgressUpdates() {
  if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
  }
}

// Setup playlist engine callbacks
function setupPlaylistEngineCallbacks() {
  if (!playlistEngine) return;

  playlistEngine.onItemChange = (item, index) => {
      console.log('🎵 Playlist item changed:', item);
      updatePlaylistNowPlaying(item, index);

      // Update main player UI
      if (item.type === 'loop') {
          loopStart = item.start;
          loopEnd = item.end;
          loopTarget = item.playCount || 1;
          loopEnabled = true;
          loopCount = 0;
          loopStartTime = Date.now();
          
          if (els.loopToggle) els.loopToggle.checked = true;
          updateRepeatDisplay();
          updateLoopVisuals();
          
          console.log(`🔄 Loop item loaded: ${formatTime(loopStart)} - ${formatTime(loopEnd)} × ${loopTarget}`);
      } else {
          loopEnabled = false;
          if (els.loopToggle) els.loopToggle.checked = false;
          updateLoopVisuals();
      }
  };

  playlistEngine.onLoopProgress = (current, target) => {
      console.log(`🔄 Playlist loop progress: ${current}/${target}`);
      showStatus(`Loop ${current}/${target}`);
  };

  playlistEngine.onPlaylistComplete = () => {
      console.log('🏁 Playlist complete!');
      showStatus('Playlist finished!');
      stopPlaylistMode();
  };

  // Smart transition callback
  playlistEngine.onSmartTransition = (transitionData) => {
      const { transitionQuality, crossfadeDuration } = transitionData;
      console.log(`🎛️ Smart transition: ${transitionQuality.quality} (${crossfadeDuration}s)`);
  };
}

// Context Menu Functions
function showTrackContextMenu(trackIndex, buttonElement) {
  currentContextMenuTrackIndex = trackIndex;
  const menu = els.contextMenu;
  const overlay = els.contextMenuOverlay;

  menu.style.left = '50%';
  menu.style.bottom = '120px';
  menu.style.transform = 'translateX(-50%) translateY(20px) scale(0.95)';

  overlay.classList.add('show');

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

async function handleDiscoverMoments() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  showStatus(`🔍 Discovering moments in "${track.name}"...`);
  console.log('Discover moments for:', track);
}

async function handleAddToPlaylist() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  pendingPlaylistItem = {
      type: 'track',
      uri: track.uri,
      name: track.name,
      artist: track.artists[0].name,
      duration: track.duration_ms / 1000,
      image: track.album.images[0]?.url || ''
  };
  showView('playlists');
  showStatus('Select a playlist to add track to');
}

async function handlePlayTrack() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  await playTrackInBackground(track);
}

async function handlePlayOnDevice() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  showStatus(`🎵 Playing "${track.name}" on your device...`);
  
  try {
      await fetch(`https://api.spotify.com/v1/me/player/play`, {
          method: 'PUT',
          headers: {
              'Authorization': `Bearer ${spotifyAccessToken}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              uris: [track.uri]
          })
      });
      showStatus(`✅ Playing on your device: ${track.name}`);
  } catch (error) {
      showStatus('Failed to play on device');
  }
}

// ENHANCED: Playlist Transition Engine with Smart DJ Features
class PlaylistTransitionEngine {
  constructor(spotifyPlayer, spotifyAccessToken, spotifyDeviceId) {
      this.spotifyPlayer = spotifyPlayer;
      this.spotifyAccessToken = spotifyAccessToken;
      this.spotifyDeviceId = spotifyDeviceId;
      
      // Playlist management
      this.currentPlaylist = null;
      this.currentItemIndex = 0;
      this.currentLoopCount = 0;
      this.currentLoopTarget = 1;
      this.isLooping = false;
      this.transitionInProgress = false;
      
      // Enhanced features
      this.smartTransitionsEnabled = true; // ✅ FIX: Enable smart transitions by default
      this.crossfadeInProgress = false;
      this.currentTransitionData = null;
      this.currentLoop = null;
      
      // Callbacks
      this.onItemChange = null;
      this.onLoopProgress = null;
      this.onPlaylistComplete = null;
      this.onSmartTransition = null;
      
      console.log('🎛️ Playlist engine initialized with smart transitions enabled');
  }

  // Load and start a playlist
  async startPlaylist(playlist) {
      try {
          this.currentPlaylist = playlist;
          this.currentItemIndex = 0;
          this.currentLoopCount = 0;
          this.transitionInProgress = false;
          this.crossfadeInProgress = false;
          
          console.log(`🎵 Starting playlist: ${playlist.name} (${playlist.items.length} items)`);
          
          await this.loadPlaylistItem(0);
          
          // Prepare smart transition for next item if available
          if (playlist.items.length > 1 && this.smartTransitionsEnabled) {
              await this.prepareSmartTransition(0, 1);
          }
          
      } catch (error) {
          console.error('🚨 Playlist start error:', error);
      }
  }

  // Load a specific playlist item
  async loadPlaylistItem(index) {
      if (!this.currentPlaylist || index >= this.currentPlaylist.items.length) {
          if (this.onPlaylistComplete) {
              this.onPlaylistComplete();
          }
          return;
      }

      try {
          this.currentItemIndex = index;
          const item = this.currentPlaylist.items[index];
          
          console.log(`🎵 Loading playlist item ${index + 1}/${this.currentPlaylist.items.length}:`, item);

          if (item.type === 'loop') {
              // Load loop item
              await this.loadLoopItem(item);
          } else {
              // Load regular track
              await this.loadTrackItem(item);
          }

          // Notify UI of item change
          if (this.onItemChange) {
              this.onItemChange(item, index);
          }

      } catch (error) {
          console.error('🚨 Load playlist item error:', error);
      }
  }

  // Load a loop item
  async loadLoopItem(loopItem) {
      // Load the track
      currentTrack = {
          uri: loopItem.trackUri,
          name: loopItem.trackName,
          artist: loopItem.trackArtist,
          duration: loopItem.trackDuration,
          image: loopItem.trackImage || ''
      };

      duration = currentTrack.duration;
      
      // Update UI
      els.currentTrack.textContent = loopItem.trackName;
      els.currentArtist.textContent = loopItem.trackArtist;

      // Set up loop parameters
      this.setupLoopItem(loopItem);

      // Load track into Spotify
      await loadTrackIntoSpotify(currentTrack);
      
      // Seek to loop start and play
      await playFromPosition(loopItem.start * 1000);
      
      console.log(`🔄 Loop item loaded: ${formatTime(loopItem.start)} - ${formatTime(loopItem.end)} × ${loopItem.playCount}`);
  }

  // Load a regular track item
  async loadTrackItem(trackItem) {
      currentTrack = {
          uri: trackItem.uri,
          name: trackItem.name,
          artist: trackItem.artist,
          duration: trackItem.duration,
          image: trackItem.image || ''
      };

      duration = currentTrack.duration;
      
      // Update UI
      els.currentTrack.textContent = trackItem.name;
      els.currentArtist.textContent = trackItem.artist;

      // Load track into Spotify
      await loadTrackIntoSpotify(currentTrack);
      
      // Start from beginning unless it's a smart transition
      if (!this.crossfadeInProgress) {
          await playFromPosition(0);
      }
      
      console.log(`🎵 Track item loaded: ${trackItem.name}`);
  }

  // Extract Spotify track ID from URI
  extractTrackId(uri) {
      if (!uri) return null;
      const match = uri.match(/spotify:track:(.+)/);
      return match ? match[1] : null;
  }

  // NEW: Prepare smart transition between items
  async prepareSmartTransition(fromIndex, toIndex) {
      if (!this.smartTransitionsEnabled || !this.currentPlaylist) return;

      try {
          const fromItem = this.currentPlaylist.items[fromIndex];
          const toItem = this.currentPlaylist.items[toIndex];

          if (!fromItem || !toItem) return;

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

  // Setup loop parameters for loop items
  setupLoopItem(loopItem) {
      // These would integrate with existing loop variables
      // For now, store in class properties
      this.currentLoop = {
          start: loopItem.start,
          end: loopItem.end,
          duration: loopItem.end - loopItem.start
      };
      
      this.currentLoopTarget = loopItem.playCount || 1;
      this.currentLoopCount = 0;

      console.log(`🔄 Loop setup: ${formatTime(loopItem.start)} - ${formatTime(loopItem.end)} × ${this.currentLoopTarget}`);
  }

  // ✅ FIXED: Handle track progression and loop logic with smart transitions
  async handlePlaybackProgress(currentTime) {
      if (!this.currentPlaylist || this.transitionInProgress || this.crossfadeInProgress) return;

      const currentItem = this.currentPlaylist.items[this.currentItemIndex];
      
      // Handle loop items
      if (currentItem.type === 'loop' && this.currentLoop) {
          await this.handleLoopProgress(currentTime);
      }
      // ✅ FIXED: Handle smart transition timing for full tracks
      else if (currentItem.type === 'track') {
          await this.handleTrackProgress(currentTime);
      }
  }

  // ✅ NEW: Handle progress for regular tracks
  async handleTrackProgress(currentTime) {
      const currentItem = this.currentPlaylist.items[this.currentItemIndex];
      if (!currentItem || currentItem.type !== 'track') return;

      // Check if we're near the end of the track
      const trackEndTime = currentItem.duration;
      const timeRemaining = trackEndTime - currentTime;

      // If we have smart transition data, handle crossfade timing
      if (this.currentTransitionData && this.smartTransitionsEnabled) {
          await this.handleSmartTransitionTiming(currentTime);
      }
      // Otherwise, handle regular transitions
      else if (timeRemaining <= 2.0) { // 2 seconds before end
          console.log('🎵 Near track end, preparing next transition');
          await this.skipToNext();
      }
  }

  // ✅ FIXED: Handle smart transition timing
  async handleSmartTransitionTiming(currentTime) {
      if (!this.currentTransitionData || this.crossfadeInProgress) return;

      const { fromEndTime, crossfadeDuration } = this.currentTransitionData;
      const crossfadeStartTime = fromEndTime - crossfadeDuration;

      // ✅ FIXED: More precise timing window
      if (currentTime >= crossfadeStartTime - 0.05 && currentTime <= crossfadeStartTime + 0.05) {
          console.log('🎛️ Starting smart crossfade transition');
          await this.executeSmartCrossfade();
      }
  }

  // NEW: Execute smart crossfade transition
  async executeSmartCrossfade() {
      if (this.crossfadeInProgress || !this.currentTransitionData) return;

      try {
          this.crossfadeInProgress = true;
          const { toItem, toStartTime, crossfadeDuration, transitionQuality } = this.currentTransitionData;

          console.log(`🎛️ Executing ${crossfadeDuration}s crossfade (${transitionQuality.quality} quality)`);

          // Start crossfade: fade out current, fade in next
          await performSmoothCrossfade(100, 0, crossfadeDuration * 1000, async () => {
              // At midpoint: switch to next track
              await this.loadPlaylistItem(this.currentItemIndex + 1);
              await seekToPosition(toStartTime * 1000);
              
              // Start fading in the new track
              await performSmoothCrossfade(0, 100, (crossfadeDuration / 2) * 1000);
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

  // ✅ FIXED: Handle loop progression within a loop item
  async handleLoopProgress(currentTime) {
      if (this.isLooping) return; // Prevent re-entry during seek

      // ✅ FIXED: More precise timing check
      if (currentTime >= this.currentLoop.end - 0.03) {
          this.currentLoopCount++;

          // Notify UI of loop progress
          if (this.onLoopProgress) {
              this.onLoopProgress(this.currentLoopCount, this.currentLoopTarget);
          }

          if (this.currentLoopCount >= this.currentLoopTarget) {
              // Loop complete, move to next item
              console.log(`✅ Loop complete: ${this.currentLoopCount}/${this.currentLoopTarget}`);
              await this.skipToNext();
          } else {
              // Continue looping
              await this.performLoopSeek();
          }
      }
  }

  // Perform the actual loop seek
  async performLoopSeek() {
      try {
          this.isLooping = true;
          this.loopStartTime = Date.now();

          // Use existing SDK seek function
          await this.spotifyPlayer.seek(this.currentLoop.start * 1000);

          console.log(`🔄 Loop ${this.currentLoopCount + 1}/${this.currentLoopTarget} - seek to ${formatTime(this.currentLoop.start)}`);

      } catch (error) {
          console.error('🚨 Loop seek error:', error);
      } finally {
          // ✅ FIXED: Reset looping flag after short delay
          setTimeout(() => {
              this.isLooping = false;
          }, 100);
      }
  }

  // Skip to next playlist item
  async skipToNext() {
      if (this.transitionInProgress) return;

      this.transitionInProgress = true;
      
      try {
          const nextIndex = this.currentItemIndex + 1;
          
          if (nextIndex >= this.currentPlaylist.items.length) {
              // Playlist complete
              if (this.onPlaylistComplete) {
                  this.onPlaylistComplete();
              }
              return;
          }

          // Reset loop count for next item
          this.currentLoopCount = 0;
          
          // Prepare smart transition for the next-next item
          if (nextIndex + 1 < this.currentPlaylist.items.length && this.smartTransitionsEnabled) {
              await this.prepareSmartTransition(nextIndex, nextIndex + 1);
          }

          await this.loadPlaylistItem(nextIndex);
          
      } catch (error) {
          console.error('🚨 Skip to next error:', error);
      } finally {
          this.transitionInProgress = false;
      }
  }

  // Skip to previous playlist item
  async skipToPrevious() {
      if (this.transitionInProgress) return;

      this.transitionInProgress = true;
      
      try {
          const prevIndex = this.currentItemIndex - 1;
          
          if (prevIndex < 0) {
              console.log('📍 Already at first item');
              return;
          }

          // Reset loop count
          this.currentLoopCount = 0;

          await this.loadPlaylistItem(prevIndex);
          
      } catch (error) {
          console.error('🚨 Skip to previous error:', error);
      } finally {
          this.transitionInProgress = false;
      }
  }

  // Stop playlist playback
  stop() {
      this.currentPlaylist = null;
      this.currentItemIndex = 0;
      this.currentLoopCount = 0;
      this.currentLoopTarget = 1;
      this.transitionInProgress = false;
      this.crossfadeInProgress = false;
      this.currentTransitionData = null;
      this.currentLoop = null;
      
      console.log('🛑 Playlist engine stopped');
  }
}

// NEW: Smart DJ Audio Analysis Functions
async function getAudioAnalysis(trackId) {
  if (audioAnalysisCache.has(trackId)) {
      return audioAnalysisCache.get(trackId);
  }

  try {
      const response = await fetch(`https://api.spotify.com/v1/audio-analysis/${trackId}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (response.ok) {
          const analysis = await response.json();
          audioAnalysisCache.set(trackId, analysis);
          return analysis;
      }
  } catch (error) {
      console.warn('Audio analysis failed:', error);
  }
  return null;
}

async function getAudioFeatures(trackId) {
  if (trackFeaturesCache.has(trackId)) {
      return trackFeaturesCache.get(trackId);
  }

  try {
      const response = await fetch(`https://api.spotify.com/v1/audio-features/${trackId}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (response.ok) {
          const features = await response.json();
          trackFeaturesCache.set(trackId, features);
          return features;
      }
  } catch (error) {
      console.warn('Audio features failed:', error);
  }
  return null;
}

function calculateOptimalCrossfade(fromFeatures, toFeatures) {
  // Base crossfade duration
  let duration = 4.0;

  // Tempo compatibility
  const tempoDiff = Math.abs(fromFeatures.tempo - toFeatures.tempo);
  if (tempoDiff < 5) duration = 3.0;  // Very compatible
  else if (tempoDiff > 20) duration = 6.0;  // Less compatible

  // Key compatibility (Circle of Fifths)
  const keyDiff = Math.abs(fromFeatures.key - toFeatures.key);
  if (keyDiff === 0 || keyDiff === 7) duration -= 1.0;  // Same key or perfect fifth
  else if (keyDiff === 5 || keyDiff === 2) duration -= 0.5;  // Compatible keys

  // Energy difference
  const energyDiff = Math.abs(fromFeatures.energy - toFeatures.energy);
  if (energyDiff > 0.5) duration += 2.0;  // Big energy jump needs more time

  // Clamp between 2-12 seconds
  return Math.max(2.0, Math.min(12.0, duration));
}

function assessTransitionQuality(fromFeatures, toFeatures) {
  let score = 100;
  let reasons = [];

  // Tempo compatibility (0-30 points)
  const tempoDiff = Math.abs(fromFeatures.tempo - toFeatures.tempo);
  if (tempoDiff < 5) score += 0; // Perfect
  else if (tempoDiff < 10) score -= 5;
  else if (tempoDiff < 20) score -= 15;
  else { score -= 30; reasons.push('Large tempo difference'); }

  // Key compatibility (0-25 points)
  const keyDiff = Math.abs(fromFeatures.key - toFeatures.key);
  if (keyDiff === 0) score += 0; // Same key
  else if (keyDiff === 7 || keyDiff === 5) score -= 5; // Compatible
  else if (keyDiff === 2 || keyDiff === 10) score -= 10; // Somewhat compatible
  else { score -= 25; reasons.push('Key clash'); }

  // Energy flow (0-20 points)
  const energyDiff = Math.abs(fromFeatures.energy - toFeatures.energy);
  if (energyDiff < 0.2) score += 0; // Smooth
  else if (energyDiff < 0.4) score -= 5;
  else if (energyDiff < 0.6) score -= 15;
  else { score -= 20; reasons.push('Energy mismatch'); }

  // Valence compatibility (0-15 points)
  const valenceDiff = Math.abs(fromFeatures.valence - toFeatures.valence);
  if (valenceDiff < 0.3) score += 0;
  else if (valenceDiff < 0.6) score -= 8;
  else { score -= 15; reasons.push('Mood clash'); }

  // Danceability flow (0-10 points)
  const danceabilityDiff = Math.abs(fromFeatures.danceability - toFeatures.danceability);
  if (danceabilityDiff > 0.4) { score -= 10; reasons.push('Danceability gap'); }

  const quality = score >= 80 ? 'excellent' : 
                 score >= 60 ? 'good' : 
                 score >= 40 ? 'fair' : 'poor';

  return { score, quality, reasons };
}

function findBeatAlignedEndPoint(analysis, targetTime) {
  if (!analysis || !analysis.beats) return targetTime;
  
  // Find the beat closest to target time
  let closestBeat = targetTime;
  let minDiff = Infinity;
  
  for (const beat of analysis.beats) {
      const diff = Math.abs(beat.start - targetTime);
      if (diff < minDiff && beat.start <= targetTime) {
          minDiff = diff;
          closestBeat = beat.start;
      }
  }
  
  return closestBeat;
}

function findBeatAlignedStartPoint(analysis, targetTime) {
  if (!analysis || !analysis.beats) return targetTime;
  
  // Find the beat closest to target time
  let closestBeat = targetTime;
  let minDiff = Infinity;
  
  for (const beat of analysis.beats) {
      const diff = Math.abs(beat.start - targetTime);
      if (diff < minDiff && beat.start >= targetTime) {
          minDiff = diff;
          closestBeat = beat.start;
      }
  }
  
  return closestBeat;
}

async function performSmoothCrossfade(fromVolume, toVolume, durationMs, midpointCallback) {
  // This would integrate with Spotify Web API's volume control
  // For now, it's a placeholder for the crossfade logic
  console.log(`🎛️ Crossfading from ${fromVolume}% to ${toVolume}% over ${durationMs}ms`);
  
  if (midpointCallback) {
      setTimeout(midpointCallback, durationMs / 2);
  }
}

// Authentication
function generateCodeVerifier() {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = crypto.getRandomValues(new Uint8Array(128));
  return Array.from(randomValues).map(x => possible[x % possible.length]).join('');
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
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
      showStatus('Successfully authenticated! Setting up player...');
  } else {
      throw new Error(data.error_description || 'Authentication failed');
  }
}

function initializeSpotifyPlayer() {
  window.onSpotifyWebPlaybackSDKReady = () => {
      spotifyPlayer = new Spotify.Player({
          name: 'LOOOPZ Player',
          getOAuthToken: cb => cb(spotifyAccessToken),
          volume: 0.5
      });

      spotifyPlayer.addListener('initialization_error', ({ message }) => showStatus('Initialization failed: ' + message));
      spotifyPlayer.addListener('authentication_error', ({ message }) => {
          showStatus('Authentication failed. Please reconnect.');
          localStorage.removeItem('spotify_access_token');
          localStorage.removeItem('spotify_refresh_token');
          spotifyAccessToken = null;
          showView('login');
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

  if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
}

// ✅ FIXED: Setup playlist engine callbacks
function setupPlaylistEngineCallbacks() {
  if (!playlistEngine) return;

  playlistEngine.onItemChange = (item, index) => {
      console.log('🎵 Playlist item changed:', item);
      updatePlaylistNowPlaying(item, index);

      // Update main player UI
      if (item.type === 'loop') {
          loopStart = item.start;
          loopEnd = item.end;
          loopTarget = item.playCount || 1;
          loopEnabled = true;
          loopCount = 0; // Reset loop count
          loopStartTime = Date.now();
          
          if (els.loopToggle) els.loopToggle.checked = true;
          updateRepeatDisplay();
          updateLoopVisuals();
          
          console.log(`🔄 Loop item loaded: ${formatTime(loopStart)} - ${formatTime(loopEnd)} × ${loopTarget}`);
      } else {
          loopEnabled = false;
          if (els.loopToggle) els.loopToggle.checked = false;
          updateLoopVisuals();
      }
  };

  playlistEngine.onLoopProgress = (current, target) => {
      console.log(`🔄 Playlist loop progress: ${current}/${target}`);
      showStatus(`Loop ${current}/${target}`);
  };

  playlistEngine.onPlaylistComplete = () => {
      console.log('🏁 Playlist complete!');
      showStatus('Playlist finished!');
      stopPlaylistMode();
  };

  // NEW: Smart transition callback
  playlistEngine.onSmartTransition = (transitionData) => {
      const { transitionQuality, crossfadeDuration } = transitionData;
      console.log(`🎛️ Smart transition: ${transitionQuality.quality} (${crossfadeDuration}s)`);
      // Could update UI to show transition quality
  };
}

// ✅ FIXED: Progress updates with playlist integration
function startProgressUpdates() {
  stopProgressUpdates();
  updateTimer = setInterval(async () => {
      if (isPlaying && spotifyPlayer && !isLooping) {
          try {
              const state = await spotifyPlayer.getCurrentState();
              if (state && state.position !== undefined) {
                  currentTime = state.position / 1000;
                  updateProgress();
                  
                  // ✅ FIXED: Handle playlist engine progress
                  if (isPlaylistMode && playlistEngine) {
                      await playlistEngine.handlePlaybackProgress(currentTime);
                  }
                  // Handle loop end for regular mode (not playlist mode)
                  else if (loopEnabled && currentTime >= loopEnd - 0.03 && loopCount < loopTarget && !isPlaylistMode) {
                      const timeSinceLoopStart = Date.now() - loopStartTime;
                      if (timeSinceLoopStart > 300) await handleLoopEnd(); // ✅ FIXED: Debouncing
                  }
              }
          } catch (error) {
              console.warn('State check failed:', error.message);
          }
      }
  }, 50); // Increased frequency from 100ms to 50ms
}

function stopProgressUpdates() {
  if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
  }
}

async function handleLoopEnd() {
  try {
      isLooping = true;
      loopCount++;

      if (loopCount >= loopTarget) {
          await togglePlayPause();
          showStatus(`Loop completed! (${loopCount}/${loopTarget})`);
          loopCount = 0;
      } else {
          showStatus(`Loop ${loopCount}/${loopTarget}`);
          loopStartTime = Date.now();
          await spotifyPlayer.seek(loopStart * 1000);
      }
  } catch (error) {
      console.error('🚨 Loop end handling error:', error);
  } finally {
      setTimeout(() => {
          isLooping = false;
      }, 100);
  }
}

// UI Functions
function showStatus(message) {
  els.statusText.textContent = message;
  els.statusBar.classList.add('show');
  setTimeout(() => els.statusBar.classList.remove('show'), 3000);
}

function updateConnectionStatus() {
  if (isConnected) {
      els.connectionStatus.innerHTML = '<div class="status-dot connected"></div><span>Connected</span><button class="disconnect-btn" id="disconnect-btn">Disconnect</button>';
      els.navSearch.classList.remove('disabled');
      els.navPlayer.classList.remove('disabled');
      els.navLibrary.classList.remove('disabled');
      els.navPlaylists.classList.remove('disabled');
  } else {
      els.connectionStatus.innerHTML = '<div class="status-dot"></div><span>Disconnected</span>';
      els.navSearch.classList.add('disabled');
      els.navPlayer.classList.add('disabled');
      els.navLibrary.classList.add('disabled');
      els.navPlaylists.classList.add('disabled');
  }
}

function updateProgress() {
  if (duration > 0) {
      const progressPercent = (currentTime / duration) * 100;
      els.progressBar.style.width = `${progressPercent}%`;
      els.currentTime.textContent = formatTime(currentTime);
      els.duration.textContent = formatTime(duration);
      updateLoopVisuals();
  }
}

function updateLoopVisuals() {
  if (duration > 0) {
      const startPercent = (loopStart / duration) * 100;
      const endPercent = (loopEnd / duration) * 100;
      const width = endPercent - startPercent;

      els.loopRegion.style.left = `${startPercent}%`;
      els.loopRegion.style.width = `${width}%`;

      els.loopStartHandle.style.left = `${startPercent}%`;
      els.loopEndHandle.style.left = `${endPercent}%`;

      els.startPopup.textContent = formatTime(loopStart);
      els.endPopup.textContent = formatTime(loopEnd);
  }
}

function updatePlayPauseButton() {
  els.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
}

function updateNowPlayingIndicator(track) {
  if (track) {
      els.nowPlayingIndicator.innerHTML = `
          <div style="font-weight: 600; font-size: 11px;">${track.name}</div>
          <div style="font-size: 10px; opacity: 0.8;">${track.artist}</div>
      `;
      els.nowPlayingIndicator.classList.add('show');
  } else {
      els.nowPlayingIndicator.classList.remove('show');
  }
}

function updateRepeatDisplay() {
  els.repeatValue.textContent = `${loopTarget}×`;
}

// Track Loading Functions
async function loadTrackIntoSpotify(track) {
  try {
      const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
          method: 'PUT',
          headers: {
              'Authorization': `Bearer ${spotifyAccessToken}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              uris: [track.uri]
          })
      });

      if (!response.ok) {
          throw new Error(`Failed to load track: ${response.status}`);
      }

      isPlaying = true;
      currentTime = 0;
      updatePlayPauseButton();
      updateNowPlayingIndicator(currentTrack);
      startProgressUpdates();

  } catch (error) {
      console.error('🚨 Load track error:', error);
      throw error;
  }
}

// Playback Controls
async function togglePlayPause() {
  try {
      if (isPlaying) {
          await spotifyPlayer.pause();
          stopProgressUpdates();
      } else {
          await spotifyPlayer.resume();
          startProgressUpdates();
      }
  } catch (error) {
      console.error('🚨 Play/pause error:', error);
      showStatus('Playback control failed');
  }
}

// Search Functions
async function searchSpotify(query, limit = 20, offset = 0) {
  try {
      if (!query.trim()) return { tracks: [], total: 0 };

      const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      return {
          tracks: data.tracks.items,
          total: data.tracks.total
      };
  } catch (error) {
      console.error('🚨 Search error:', error);
      return { tracks: [], total: 0 };
  }
}

async function performSearch(query) {
  try {
      if (!query.trim()) {
          renderSearchResults([]);
          return;
      }

      showStatus('🔍 Searching...');
      searchState.query = query;
      searchState.currentOffset = 0;

      const result = await searchSpotify(query, 20, 0);
      currentSearchResults = result.tracks;
      searchState.totalTracks = result.total;
      searchState.hasMore = result.tracks.length === 20 && searchState.totalTracks > 20;

      renderSearchResults(result.tracks);
      showStatus(result.tracks.length > 0 ? `Found ${result.total} tracks` : 'No tracks found');

  } catch (error) {
      console.error('🚨 Search error:', error);
      showStatus('Search failed');
  }
}

function renderSearchResults(tracks) {
  if (!tracks.length) {
      els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No tracks found</div>';
      return;
  }

  const tracksHtml = tracks.map((track, index) => {
      const minutes = Math.floor(track.duration_ms / 60000);
      const seconds = Math.floor((track.duration_ms % 60000) / 1000);
      return `
          <div class="search-result-item" data-track-index="${index}" onclick="selectTrack('${track.uri}', '${track.name.replace(/'/g, "\\'")}', '${track.artists[0].name.replace(/'/g, "\\'")}', ${track.duration_ms}, '${track.album.images[0]?.url || ''}')">
              <img src="${track.album.images[2]?.url || track.album.images[0]?.url || ''}" alt="${track.album.name}" onerror="this.style.display='none'">
              <div class="track-info">
                  <div class="track-name">${track.name}</div>
                  <div class="track-artist">${track.artists[0].name}</div>
              </div>
              <div class="track-meta">
                  <div class="track-duration">${minutes}:${seconds.toString().padStart(2, '0')}</div>
                  <button class="track-menu-btn" onclick="event.stopPropagation(); showTrackContextMenu(${index}, this)">⋮</button>
              </div>
          </div>
      `;
  }).join('');

  const loadMoreBtn = searchState.hasMore ? 
      '<button class="load-more-btn" onclick="loadMoreResults()">Load More Tracks</button>' : '';

  els.searchResults.innerHTML = tracksHtml + loadMoreBtn;
}

async function loadMoreResults() {
  if (!searchState.hasMore) return;

  try {
      showStatus('Loading more...');
      searchState.currentOffset += 20;

      const result = await searchSpotify(searchState.query, 20, searchState.currentOffset);
      
      currentSearchResults = [...currentSearchResults, ...result.tracks];
      searchState.hasMore = result.tracks.length === 20 && currentSearchResults.length < searchState.totalTracks;

      renderSearchResults(currentSearchResults);
      showStatus(`Loaded ${currentSearchResults.length} of ${searchState.totalTracks} tracks`);

  } catch (error) {
      console.error('🚨 Load more error:', error);
      showStatus('Failed to load more');
  }
}

function updateSearchTrackHighlighting(uri, isSelected = false, isPlaying = false) {
  document.querySelectorAll('.search-result-item').forEach(item => {
      item.classList.remove('selected', 'playing');
  });

  if (uri && currentSearchResults.length > 0) {
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
  if (view === 'playlists') els.playlistsSection.classList.remove('hidden');

  updateActiveNavButton(view);
}

function updateActiveNavButton(view) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  
  if (view === 'search') els.navSearch.classList.add('active');
  if (view === 'player') els.navPlayer.classList.add('active');
  if (view === 'library') els.navLibrary.classList.add('active');
  if (view === 'playlists') els.navPlaylists.classList.add('active');
}

// Loop Functions
async function startLoop() {
  if (!currentTrack) {
      showStatus('Please select a track first');
      return;
  }

  loopEnabled = true;
  loopCount = 0;
  els.loopToggle.checked = true;
  updateLoopVisuals();
  showStatus(`✅ Loop enabled: ${formatTime(loopStart)} - ${formatTime(loopEnd)} × ${loopTarget}`);
}

function saveLooopsToStorage() {
  try {
      localStorage.setItem('looopz_saved_loops', JSON.stringify(savedLoops));
  } catch (error) {
      console.error('Failed to save loops:', error);
  }
}

function loadLooopsFromStorage() {
  try {
      const stored = localStorage.getItem('looopz_saved_loops');
      if (stored) {
          savedLoops = JSON.parse(stored);
          renderLoopsList();
      }
  } catch (error) {
      console.error('Failed to load loops:', error);
      savedLoops = [];
  }
}

function renderLoopsList() {
  if (!savedLoops.length) {
      els.loopsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No loops saved yet</div>';
      els.loopCountBadge.textContent = '0';
      return;
  }

  els.loopCountBadge.textContent = savedLoops.length.toString();

  const loopsHtml = savedLoops.map(loop => `
      <div class="library-item">
          <div class="loop-item-content">
              <div class="loop-info">
                  <div class="loop-track-name">${loop.track.name}</div>
                  <div class="loop-details">${formatTime(loop.loop.start)} - ${formatTime(loop.loop.end)} × ${loop.loop.repeat}</div>
                  <div class="loop-artist">${loop.track.artist}</div>
              </div>
              <div class="loop-actions">
                  <button class="action-btn" onclick="loadSavedLoop('${loop.id}')">▶</button>
                  <button class="action-btn" onclick="editLoop('${loop.id}')">✏</button>
                  <button class="action-btn delete-btn" onclick="deleteLoop('${loop.id}')">🗑</button>
              </div>
          </div>
          <div class="loop-edit-form" id="edit-form-${loop.id}">
              <div class="edit-form-content">
                  <div class="form-row">
                      <label>Start:</label>
                      <input type="text" id="edit-start-${loop.id}" value="${formatTime(loop.loop.start)}" placeholder="0:00.000">
                  </div>
                  <div class="form-row">
                      <label>End:</label>
                      <input type="text" id="edit-end-${loop.id}" value="${formatTime(loop.loop.end)}" placeholder="0:30.000">
                  </div>
                  <div class="form-row">
                      <label>Repeat:</label>
                      <input type="number" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="99">
                  </div>
                  <div class="edit-form-actions">
                      <button class="save-btn" onclick="saveLoopEdits('${loop.id}')">Save</button>
                      <button class="cancel-btn" onclick="cancelEdit('${loop.id}')">Cancel</button>
                  </div>
              </div>
          </div>
      </div>
  `).join('');

  els.loopsList.innerHTML = loopsHtml;
}

function deleteLoop(loopId) {
  if (!confirm('Delete this loop?')) return;
  
  savedLoops = savedLoops.filter(l => l.id !== loopId);
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('🗑 Loop deleted');
}

// Playlist Functions  
function savePlaylistsToStorage() {
  try {
      localStorage.setItem('looopz_playlists', JSON.stringify(savedPlaylists));
  } catch (error) {
      console.error('Failed to save playlists:', error);
  }
}

function loadPlaylistsFromStorage() {
  try {
      const stored = localStorage.getItem('looopz_playlists');
      if (stored) {
          savedPlaylists = JSON.parse(stored);
          renderPlaylistsList();
      }
  } catch (error) {
      console.error('Failed to load playlists:', error);
      savedPlaylists = [];
  }
}

function renderPlaylistsList() {
  if (!savedPlaylists.length) {
      els.playlistsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No playlists created yet</div>';
      els.playlistCountBadge.textContent = '0';
      return;
  }

  els.playlistCountBadge.textContent = savedPlaylists.length.toString();

  const playlistsHtml = savedPlaylists.map(playlist => `
      <div class="library-item ${pendingPlaylistItem ? 'clickable' : ''}" onclick="${pendingPlaylistItem ? `addItemToPlaylist('${playlist.id}')` : ''}">
          <div class="playlist-info">
              <div class="playlist-name">${playlist.name}</div>
              <div class="playlist-details">${playlist.items.length} items</div>
          </div>
          <div class="playlist-actions">
              ${pendingPlaylistItem ? 
                  `<button class="action-btn add-btn" onclick="event.stopPropagation(); addItemToPlaylist('${playlist.id}')">➕</button>` : 
                  `<button class="action-btn" onclick="startPlaylistMode('${playlist.id}')">▶</button>
                   <button class="action-btn" onclick="editPlaylist('${playlist.id}')">✏</button>
                   <button class="action-btn delete-btn" onclick="deletePlaylist('${playlist.id}')">🗑</button>`
              }
          </div>
      </div>
  `).join('');

  els.playlistsList.innerHTML = playlistsHtml;
}

function updatePlaylistNowPlaying(item, index) {
  if (!currentPlaylist) return;

  els.playlistProgress.textContent = `${index + 1}/${currentPlaylist.items.length}`;
  els.playlistCurrentName.textContent = item.name || (item.type === 'loop' ? `${item.trackName} (Loop)` : item.trackName);
  els.playlistCurrentType.textContent = item.type === 'loop' ? 
      `Loop: ${formatTime(item.start)}-${formatTime(item.end)} × ${item.playCount}` : 
      'Full Track';

  if (item.type === 'loop') {
      els.playlistCurrentIcon.src = item.trackImage || '';
  } else {
      els.playlistCurrentIcon.src = item.image || '';
  }
}

// Load shared loop function
function loadSharedLoop() {
  try {
      const sharedData = sessionStorage.getItem('shared_loop');
      if (!sharedData) return;

      const shared = JSON.parse(sharedData);
      console.log('🔗 Loading shared loop:', shared);

      showStatus('🔗 Loading shared loop...');
      sessionStorage.removeItem('shared_loop');

  } catch (error) {
      console.error('🚨 Load shared loop error:', error);
      sessionStorage.removeItem('shared_loop');
  }
}

// Replace checkAuth with checkForSharedLoop for consistency  
const checkAuth = checkForSharedLoop;

// Spotify SDK Initialization
function initializeSpotifyPlayer() {
  showStatus('Connecting to Spotify...');

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

          // Handle playlist mode progress
          if (isPlaylistMode && playlistEngine) {
              playlistEngine.handlePlaybackProgress(currentTime);
          }
          // Handle regular loop mode
          else if (loopEnabled && !isPlaylistMode && currentTime >= loopEnd - 0.03 && loopCount < loopTarget) {
              const timeSinceLoopStart = Date.now() - loopStartTime;
              if (timeSinceLoopStart > 300) handleLoopEnd();
          }

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

  if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
}

// Loop end handling for regular mode
async function handleLoopEnd() {
  try {
      isLooping = true;
      loopCount++;

      if (loopCount >= loopTarget) {
          await togglePlayPause();
          showStatus(`Loop completed! (${loopCount}/${loopTarget})`);
          loopCount = 0;
      } else {
          showStatus(`Loop ${loopCount}/${loopTarget}`);
          loopStartTime = Date.now();
          await spotifyPlayer.seek(loopStart * 1000);
      }
  } catch (error) {
      console.error('🚨 Loop end handling error:', error);
  } finally {
      setTimeout(() => {
          isLooping = false;
      }, 100);
  }
}

async function seekBackward() {
  const newTime = Math.max(0, currentTime - 10);
  await seekToPosition(newTime * 1000);
}

async function seekForward() {
  const newTime = Math.min(duration, currentTime + 10);
  await seekToPosition(newTime * 1000);
}

async function playFromPosition(positionMs) {
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

async function seekToPosition(positionMs) {
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

// Search Functions
async function searchSpotify(query, limit = 20, offset = 0) {
  try {
      if (!query.trim()) return { tracks: [], total: 0 };

      const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}&offset=${offset}`, {
          headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
      });

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      return {
          tracks: data.tracks.items,
          total: data.tracks.total
      };
  } catch (error) {
      console.error('🚨 Search error:', error);
      return { tracks: [], total: 0 };
  }
}

async function performSearch(query) {
  try {
      if (!query.trim()) {
          renderSearchResults([]);
          return;
      }

      showStatus('🔍 Searching...');
      searchState.query = query;
      searchState.currentOffset = 0;

      const result = await searchSpotify(query, 20, 0);
      currentSearchResults = result.tracks;
      searchState.totalTracks = result.total;
      searchState.hasMore = result.tracks.length === 20 && searchState.totalTracks > 20;

      renderSearchResults(result.tracks);
      showStatus(result.tracks.length > 0 ? `Found ${result.total} tracks` : 'No tracks found');

  } catch (error) {
      console.error('🚨 Search error:', error);
      showStatus('Search failed');
  }
}

async function loadMoreResults() {
  if (!searchState.hasMore) return;

  try {
      showStatus('Loading more...');
      searchState.currentOffset += 20;

      const result = await searchSpotify(searchState.query, 20, searchState.currentOffset);
      
      currentSearchResults = [...currentSearchResults, ...result.tracks];
      searchState.hasMore = result.tracks.length === 20 && currentSearchResults.length < searchState.totalTracks;

      renderSearchResults(currentSearchResults);
      showStatus(`Loaded ${currentSearchResults.length} of ${searchState.totalTracks} tracks`);

  } catch (error) {
      console.error('🚨 Load more error:', error);
      showStatus('Failed to load more');
  }
}

function renderSearchResults(tracks) {
  if (!tracks.length) {
      els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No tracks found</div>';
      return;
  }

  const tracksHtml = tracks.map((track, index) => {
      const minutes = Math.floor(track.duration_ms / 60000);
      const seconds = Math.floor((track.duration_ms % 60000) / 1000);
      return `
          <div class="search-result-item" data-track-index="${index}" onclick="selectTrack('${track.uri}', '${track.name.replace(/'/g, "\\'")}', '${track.artists[0].name.replace(/'/g, "\\'")}', ${track.duration_ms}, '${track.album.images[0]?.url || ''}')">
              <img src="${track.album.images[2]?.url || track.album.images[0]?.url || ''}" alt="${track.album.name}" onerror="this.style.display='none'">
              <div class="track-info">
                  <div class="track-name">${track.name}</div>
                  <div class="track-artist">${track.artists[0].name}</div>
              </div>
              <div class="track-meta">
                  <div class="track-duration">${minutes}:${seconds.toString().padStart(2, '0')}</div>
                  <button class="track-menu-btn" onclick="event.stopPropagation(); showTrackContextMenu(${index}, this)">⋮</button>
              </div>
          </div>
      `;
  }).join('');

  const loadMoreBtn = searchState.hasMore ? 
      '<button class="load-more-btn" onclick="loadMoreResults()">Load More Tracks</button>' : '';

  els.searchResults.innerHTML = tracksHtml + loadMoreBtn;
}

function updateSearchTrackHighlighting(uri, isSelected = false, isPlaying = false) {
  document.querySelectorAll('.search-result-item').forEach(item => {
      item.classList.remove('selected', 'playing');
  });

  if (uri && currentSearchResults.length > 0) {
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

async function selectTrack(uri, name, artist, durationMs, imageUrl) {
  try {
      let seamlessTransition = false;
      let preservedPosition = 0;

      if (currentTrack && currentTrack.uri === uri && isPlaying) {
          console.log('🔄 Seamless transition detected - same track already playing');
          seamlessTransition = true;
          preservedPosition = currentTime * 1000;
          showStatus('🔄 Taking over playback seamlessly...');
      } else {
          showStatus('🎵 Loading selected track...');
      }

      currentTrack = { uri, name, artist, duration: durationMs / 1000, image: imageUrl };
      duration = currentTrack.duration;

      els.currentTrack.textContent = name;
      els.currentArtist.textContent = artist;

      if (seamlessTransition) {
          console.log('✅ Seamless transition - continuing from position:', preservedPosition);
          updateProgress();
          updatePlayPauseButton();
          updateNowPlayingIndicator(currentTrack);
          startProgressUpdates();
      } else {
          await loadTrackIntoSpotify(currentTrack);
          if (isPlaying) {
              await togglePlayPause();
          }
      }

      if (seamlessTransition) {
          const currentPos = currentTime;
          if (loopStart > currentPos) {
              loopStart = Math.max(0, currentPos - 10);
              console.log('🔄 Adjusted loop start to accommodate current position');
          }
          if (loopEnd <= currentPos) {
              loopEnd = Math.min(duration, currentPos + 20);
              console.log('🔄 Adjusted loop end to accommodate current position');
          }
          if (currentPos > loopEnd || currentPos + 30 < loopStart) {
              loopStart = Math.max(0, currentPos - 5);
              loopEnd = Math.min(duration, currentPos + 25);
              console.log('🔄 Created new loop region around current position');
          }
          showStatus(`✅ Seamless takeover: ${name} (continuing from ${formatTime(currentPos)})`);
      } else {
          loopStart = 0;
          loopEnd = Math.min(30, duration);
          showStatus(`✅ Selected: ${name}`);
      }

      updateLoopVisuals();
      updateProgress();
      showView('player');

      if (loopEnabled && els.loopToggle) {
          els.loopToggle.checked = true;
      }

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
  if (view === 'playlists') els.playlistsSection.classList.remove('hidden');

  updateActiveNavButton(view);
}

function updateActiveNavButton(view) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  
  if (view === 'search') els.navSearch.classList.add('active');
  if (view === 'player') els.navPlayer.classList.add('active');
  if (view === 'library') els.navLibrary.classList.add('active');
  if (view === 'playlists') els.navPlaylists.classList.add('active');
}

// Context Menu Functions
function showTrackContextMenu(trackIndex, buttonElement) {
  currentContextMenuTrackIndex = trackIndex;
  const menu = els.contextMenu;
  const overlay = els.contextMenuOverlay;

  menu.style.left = '50%';
  menu.style.bottom = '120px';
  menu.style.transform = 'translateX(-50%) translateY(20px) scale(0.95)';

  overlay.classList.add('show');

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

async function handleDiscoverMoments() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  showStatus(`🔍 Discovering moments in "${track.name}"...`);
  console.log('Discover moments for:', track);
}

async function handleAddToPlaylist() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  pendingPlaylistItem = {
      type: 'track',
      uri: track.uri,
      name: track.name,
      artist: track.artists[0].name,
      duration: track.duration_ms / 1000,
      image: track.album.images[0]?.url || ''
  };
  showView('playlists');
  showStatus('Select a playlist to add track to');
}

async function handlePlayTrack() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  await playTrackInBackground(track);
}

async function handlePlayOnDevice() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  showStatus(`🎵 Playing "${track.name}" on your device...`);
  
  try {
      await fetch(`https://api.spotify.com/v1/me/player/play`, {
          method: 'PUT',
          headers: {
              'Authorization': `Bearer ${spotifyAccessToken}`,
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({
              uris: [track.uri]
          })
      });
      showStatus(`✅ Playing on your device: ${track.name}`);
  } catch (error) {
      showStatus('Failed to play on device');
  }
}

// Loop Functions
async function startLoop() {
  if (!currentTrack) {
      showStatus('Please select a track first');
      return;
  }

  loopEnabled = true;
  loopCount = 0;
  els.loopToggle.checked = true;
  updateLoopVisuals();
  showStatus(`✅ Loop enabled: ${formatTime(loopStart)} - ${formatTime(loopEnd)} × ${loopTarget}`);
}

async function saveLoop() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  const loop = {
      id: Date.now().toString(),
      track: { ...currentTrack },
      loop: {
          start: loopStart,
          end: loopEnd,
          repeat: loopTarget
      },
      created: new Date().toISOString()
  };

  savedLoops.unshift(loop);
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('✅ Loop saved!');
}

async function addCurrentLoopToPlaylist() {
  if (!currentTrack) {
      showStatus('No track selected');
      return;
  }

  pendingPlaylistItem = {
      type: 'loop',
      trackUri: currentTrack.uri,
      trackName: currentTrack.name,
      trackArtist: currentTrack.artist,
      trackDuration: currentTrack.duration,
      trackImage: currentTrack.image,
      start: loopStart,
      end: loopEnd,
      playCount: loopTarget,
      name: `${currentTrack.name} (${formatTime(loopStart)}-${formatTime(loopEnd)})`
  };

  showView('playlists');
  showStatus('Select a playlist to add loop to');
}

function saveLooopsToStorage() {
  try {
      localStorage.setItem('looopz_saved_loops', JSON.stringify(savedLoops));
  } catch (error) {
      console.error('Failed to save loops:', error);
  }
}

function loadLooopsFromStorage() {
  try {
      const stored = localStorage.getItem('looopz_saved_loops');
      if (stored) {
          savedLoops = JSON.parse(stored);
          renderLoopsList();
      }
  } catch (error) {
      console.error('Failed to load loops:', error);
      savedLoops = [];
  }
}

function renderLoopsList() {
  if (!savedLoops.length) {
      els.loopsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No loops saved yet</div>';
      els.loopCountBadge.textContent = '0';
      return;
  }

  els.loopCountBadge.textContent = savedLoops.length.toString();

  const loopsHtml = savedLoops.map(loop => `
      <div class="library-item">
          <div class="loop-item-content">
              <div class="loop-info">
                  <div class="loop-track-name">${loop.track.name}</div>
                  <div class="loop-details">${formatTime(loop.loop.start)} - ${formatTime(loop.loop.end)} × ${loop.loop.repeat}</div>
                  <div class="loop-artist">${loop.track.artist}</div>
              </div>
              <div class="loop-actions">
                  <button class="action-btn" onclick="loadSavedLoop('${loop.id}')">▶</button>
                  <button class="action-btn" onclick="editLoop('${loop.id}')">✏</button>
                  <button class="action-btn delete-btn" onclick="deleteLoop('${loop.id}')">🗑</button>
              </div>
          </div>
          <div class="loop-edit-form" id="edit-form-${loop.id}">
              <div class="edit-form-content">
                  <div class="form-row">
                      <label>Start:</label>
                      <input type="text" id="edit-start-${loop.id}" value="${formatTime(loop.loop.start)}" placeholder="0:00.000">
                  </div>
                  <div class="form-row">
                      <label>End:</label>
                      <input type="text" id="edit-end-${loop.id}" value="${formatTime(loop.loop.end)}" placeholder="0:30.000">
                  </div>
                  <div class="form-row">
                      <label>Repeat:</label>
                      <input type="number" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="99">
                  </div>
                  <div class="edit-form-actions">
                      <button class="save-btn" onclick="saveLoopEdits('${loop.id}')">Save</button>
                      <button class="cancel-btn" onclick="cancelEdit('${loop.id}')">Cancel</button>
                  </div>
              </div>
          </div>
      </div>
  `).join('');

  els.loopsList.innerHTML = loopsHtml;
}

async function loadSavedLoop(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  try {
      showStatus('🔄 Loading loop...');

      currentTrack = { ...loop.track };
      duration = currentTrack.duration;
      loopStart = loop.loop.start;
      loopEnd = loop.loop.end;
      loopTarget = loop.loop.repeat;
      loopEnabled = true;
      loopCount = 0;
      loopStartTime = Date.now();

      els.currentTrack.textContent = currentTrack.name;
      els.currentArtist.textContent = currentTrack.artist;
      if (els.loopToggle) els.loopToggle.checked = true;
      updateRepeatDisplay();
      updateLoopVisuals();

      await loadTrackIntoSpotify(currentTrack);
      await playFromPosition(loopStart * 1000);

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

function deleteLoop(loopId) {
  if (!confirm('Delete this loop?')) return;
  
  savedLoops = savedLoops.filter(l => l.id !== loopId);
  saveLooopsToStorage();
  renderLoopsList();
  showStatus('🗑 Loop deleted');
}

// Playlist Functions
function savePlaylistsToStorage() {
  try {
      localStorage.setItem('looopz_playlists', JSON.stringify(savedPlaylists));
  } catch (error) {
      console.error('Failed to save playlists:', error);
  }
}

function loadPlaylistsFromStorage() {
  try {
      const stored = localStorage.getItem('looopz_playlists');
      if (stored) {
          savedPlaylists = JSON.parse(stored);
          renderPlaylistsList();
      }
  } catch (error) {
      console.error('Failed to load playlists:', error);
      savedPlaylists = [];
  }
}

function createPlaylist() {
  const name = prompt('Playlist name:');
  if (!name || !name.trim()) return;

  const playlist = {
      id: Date.now().toString(),
      name: name.trim(),
      items: [],
      created: new Date().toISOString()
  };

  savedPlaylists.unshift(playlist);
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus('✅ Playlist created!');
}

function renderPlaylistsList() {
  if (!savedPlaylists.length) {
      els.playlistsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No playlists created yet</div>';
      els.playlistCountBadge.textContent = '0';
      return;
  }

  els.playlistCountBadge.textContent = savedPlaylists.length.toString();

  const playlistsHtml = savedPlaylists.map(playlist => `
      <div class="library-item ${pendingPlaylistItem ? 'clickable' : ''}" onclick="${pendingPlaylistItem ? `addItemToPlaylist('${playlist.id}')` : ''}">
          <div class="playlist-info">
              <div class="playlist-name">${playlist.name}</div>
              <div class="playlist-details">${playlist.items.length} items</div>
          </div>
          <div class="playlist-actions">
              ${pendingPlaylistItem ? 
                  `<button class="action-btn add-btn" onclick="event.stopPropagation(); addItemToPlaylist('${playlist.id}')">➕</button>` : 
                  `<button class="action-btn" onclick="startPlaylistMode('${playlist.id}')">▶</button>
                   <button class="action-btn" onclick="editPlaylist('${playlist.id}')">✏</button>
                   <button class="action-btn delete-btn" onclick="deletePlaylist('${playlist.id}')">🗑</button>`
              }
          </div>
      </div>
  `).join('');

  els.playlistsList.innerHTML = playlistsHtml;
}

function addItemToPlaylist(playlistId) {
  if (!pendingPlaylistItem) return;

  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  playlist.items.push({ ...pendingPlaylistItem });
  savePlaylistsToStorage();
  renderPlaylistsList();
  
  const itemType = pendingPlaylistItem.type === 'loop' ? 'loop' : 'track';
  showStatus(`✅ ${itemType} added to "${playlist.name}"!`);
  
  pendingPlaylistItem = null;
}

async function startPlaylistMode(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || !playlist.items.length) {
      showStatus('Playlist is empty');
      return;
  }

  try {
      isPlaylistMode = true;
      currentPlaylist = playlist;
      currentPlaylistIndex = 0;

      // Show playlist UI
      els.playlistNowPlaying.classList.remove('hidden');
      updatePlaylistProgress();

      // Initialize playlist engine
      if (playlistEngine) {
          await playlistEngine.startPlaylist(playlist);
          showView('player');
          showStatus(`🎵 Playing playlist: ${playlist.name}`);
      } else {
          showStatus('Playlist engine not ready');
      }

  } catch (error) {
      console.error('🚨 Start playlist error:', error);
      showStatus('Failed to start playlist');
      stopPlaylistMode();
  }
}

function stopPlaylistMode() {
  isPlaylistMode = false;
  currentPlaylist = null;
  currentPlaylistIndex = 0;

  // Hide playlist UI
  els.playlistNowPlaying.classList.add('hidden');

  // Reset loop state
  loopEnabled = false;
  loopCount = 0;
  if (els.loopToggle) els.loopToggle.checked = false;
  updateLoopVisuals();

  // Stop playlist engine
  if (playlistEngine) {
      playlistEngine.stop();
  }

  console.log('🛑 Playlist mode stopped');
}

function updatePlaylistNowPlaying(item, index) {
  if (!currentPlaylist) return;

  els.playlistProgress.textContent = `${index + 1}/${currentPlaylist.items.length}`;
  els.playlistCurrentName.textContent = item.name || (item.type === 'loop' ? `${item.trackName} (Loop)` : item.trackName);
  els.playlistCurrentType.textContent = item.type === 'loop' ? 
      `Loop: ${formatTime(item.start)}-${formatTime(item.end)} × ${item.playCount}` : 
      'Full Track';

  if (item.type === 'loop') {
      els.playlistCurrentIcon.src = item.trackImage || '';
  } else {
      els.playlistCurrentIcon.src = item.image || '';
  }
}

function updatePlaylistProgress() {
  if (!currentPlaylist) return;
  els.playlistProgress.textContent = `${currentPlaylistIndex + 1}/${currentPlaylist.items.length}`;
}

async function playlistPrevious() {
  if (!isPlaylistMode || !playlistEngine) return;
  await playlistEngine.skipToPrevious();
}

async function playlistNext() {
  if (!isPlaylistMode || !playlistEngine) return;
  await playlistEngine.skipToNext();
}

function editPlaylist(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  console.log('Edit playlist:', playlist);
  showStatus('Playlist editing not implemented yet');
}

function deletePlaylist(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  if (!confirm(`Delete playlist "${playlist.name}"?`)) return;

  savedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus('🗑 Playlist deleted');
}

// Missing playlist functions
function cancelPlaylistEdit(playlistId) {
  const editForm = document.getElementById(`edit-form-${playlistId}`);
  if (editForm) editForm.classList.remove('active');
  currentEditingPlaylistId = null;
}

function savePlaylistEdits(playlistId) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  const newName = document.getElementById(`edit-name-${playlistId}`).value.trim();
  if (!newName) {
      showStatus('❌ Name cannot be empty');
      return;
  }

  playlist.name = newName;
  savePlaylistsToStorage();
  renderPlaylistsList();
  currentEditingPlaylistId = null;
  showStatus('✅ Playlist updated!');
}

function removeFromPlaylist(playlistId, itemIndex) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || itemIndex < 0 || itemIndex >= playlist.items.length) return;

  if (!confirm('Remove this item from playlist?')) return;

  playlist.items.splice(itemIndex, 1);
  savePlaylistsToStorage();
  renderPlaylistsList();
  showStatus('🗑 Item removed from playlist');
}

// Setup loop handle dragging functionality
function setupLoopHandles() {
  let isDragging = false;
  let dragTarget = null;

  function startDrag(e, target) {
      if (!duration) return;
      isDragging = true;
      dragTarget = target;
      target.classList.add('dragging');
      const popup = target.querySelector('.time-popup');
      if (popup) popup.classList.add('show');
      if (e && e.preventDefault) e.preventDefault();
  }

  function updateDrag(e) {
      if (!isDragging || !dragTarget || !duration) return;

      const rect = els.progressContainer.getBoundingClientRect();
      const clientX = (e.touches ? e.touches[0].clientX : e.clientX);
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

  // Mouse events
  els.loopStartHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopStartHandle));
  els.loopEndHandle.addEventListener('mousedown', (e) => startDrag(e, els.loopEndHandle));
  document.addEventListener('mousemove', updateDrag);
  document.addEventListener('mouseup', stopDrag);

  // Touch events
  els.loopStartHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopStartHandle), { passive: false });
  els.loopEndHandle.addEventListener('touchstart', (e) => startDrag(e.touches[0], els.loopEndHandle), { passive: false });
  document.addEventListener('touchmove', (e) => { if (isDragging && e.touches[0]) updateDrag(e.touches[0]); }, { passive: false });
  document.addEventListener('touchend', stopDrag, { passive: false });
}

// Global function declarations for HTML onclick handlers
window.selectTrack = selectTrack;
window.showTrackContextMenu = showTrackContextMenu;
window.hideTrackContextMenu = hideTrackContextMenu;
window.handleDiscoverMoments = handleDiscoverMoments;
window.handleAddToPlaylist = handleAddToPlaylist;
window.handlePlayTrack = handlePlayTrack;
window.handlePlayOnDevice = handlePlayOnDevice;
window.loadMoreResults = loadMoreResults;
window.loadSavedLoop = loadSavedLoop;
window.editLoop = editLoop;
window.cancelEdit = cancelEdit;
window.saveLoopEdits = saveLoopEdits;
window.deleteLoop = deleteLoop;
window.startPlaylistMode = startPlaylistMode;
window.addItemToPlaylist = addItemToPlaylist;
window.editPlaylist = editPlaylist;
window.deletePlaylist = deletePlaylist;
window.cancelPlaylistEdit = cancelPlaylistEdit;
window.savePlaylistEdits = savePlaylistEdits;
window.removeFromPlaylist = removeFromPlaylist;
window.createPlaylist = createPlaylist;
window.stopPlaylistMode = stopPlaylistMode;
window.playlistPrevious = playlistPrevious;
window.playlistNext = playlistNext;

// Initialization
function initializeElements() {
  els = {
      loginScreen: document.getElementById('login-screen'),
      searchSection: document.getElementById('search-section'),
      playerSection: document.getElementById('player-section'),
      librarySection: document.getElementById('library-section'),
      playlistsSection: document.getElementById('playlists-section'),
      statusBar: document.getElementById('status-bar'),
      statusText: document.getElementById('status-text'),
      connectionStatus: document.getElementById('connection-status'),
      nowPlayingIndicator: document.getElementById('now-playing-indicator'),
      connectBtn: document.getElementById('connect-btn'),
      navSearch: document.getElementById('nav-search'),
      navPlayer: document.getElementById('nav-player'),
      navLibrary: document.getElementById('nav-library'),
      navPlaylists: document.getElementById('nav-playlists'),
      navDiscovery: document.getElementById('nav-discovery'),
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
      precisionPopup: document.getElementById('precision-popup'),
      precisionBtn: document.getElementById('precision-btn'),
      precisionClose: document.getElementById('precision-close'),
      precisionStart: document.getElementById('precision-start'),
      precisionEnd: document.getElementById('precision-end'),
      loopsList: document.getElementById('loops-list'),
      loopCountBadge: document.getElementById('loop-count-badge'),
      playlistsList: document.getElementById('playlists-list'),
      playlistCountBadge: document.getElementById('playlist-count-badge'),
      createPlaylistBtn: document.getElementById('create-playlist-btn'),
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
      repeatDecrease: document.getElementById('repeat-decrease'),
      repeatIncrease: document.getElementById('repeat-increase'),
      playlistNowPlaying: document.getElementById('playlist-now-playing'),
      playlistProgress: document.getElementById('playlist-progress'),
      playlistCurrentIcon: document.getElementById('playlist-current-icon'),
      playlistCurrentName: document.getElementById('playlist-current-name'),
      playlistCurrentType: document.getElementById('playlist-current-type'),
      playlistPrevBtn: document.getElementById('playlist-prev-btn'),
      playlistStopBtn: document.getElementById('playlist-stop-btn'),
      playlistNextBtn: document.getElementById('playlist-next-btn')
  };
}

function checkForSharedLoop() {
  const hasSharedLoop = sessionStorage.getItem('shared_loop');
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
      isConnected ? showView('library') : showView('login');
  });

  els.navPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      isConnected ? showView('playlists') : showView('login');
      pendingPlaylistItem = null;
  });

  // Connection
  els.connectBtn.addEventListener('click', connectSpotify);

  document.addEventListener('click', (e) => {
      if (e.target.id === 'disconnect-btn') {
          localStorage.removeItem('spotify_access_token');
          localStorage.removeItem('spotify_refresh_token');
          location.reload();
      }
  });

  // Search
  els.searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query) {
          clearTimeout(window.searchTimeout);
          window.searchTimeout = setTimeout(() => performSearch(query), 300);
      } else {
          renderSearchResults([]);
      }
  });

  els.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
          clearTimeout(window.searchTimeout);
          performSearch(e.target.value.trim());
      }
  });

  // Context menu
  els.contextMenuOverlay.addEventListener('click', hideTrackContextMenu);

  // Player controls
  els.playPauseBtn.addEventListener('click', togglePlayPause);
  els.backwardBtn.addEventListener('click', seekBackward);
  els.forwardBtn.addEventListener('click', seekForward);

  // Loop controls
  els.startLoopBtn.addEventListener('click', startLoop);
  els.saveLoopBtn.addEventListener('click', saveLoop);
  els.addToPlaylistBtn.addEventListener('click', addCurrentLoopToPlaylist);

  // Playlist controls
  els.playlistPrevBtn.addEventListener('click', playlistPrevious);
  els.playlistStopBtn.addEventListener('click', stopPlaylistMode);
  els.playlistNextBtn.addEventListener('click', playlistNext);

  // Repeat controls
  els.repeatDecrease.addEventListener('click', () => {
      loopTarget = Math.max(1, loopTarget - 1);
      updateRepeatDisplay();
  });

  els.repeatIncrease.addEventListener('click', () => {
      loopTarget = Math.min(99, loopTarget + 1);
      updateRepeatDisplay();
  });

  // Loop toggle
  els.loopToggle.addEventListener('change', (e) => {
      loopEnabled = e.target.checked;
      if (!loopEnabled) {
          loopCount = 0;
      }
      updateLoopVisuals();
  });

  // Create playlist
  els.createPlaylistBtn.addEventListener('click', createPlaylist);

  // Progress bar interactions
  setupProgressBarInteractions();
}

function setupProgressBarInteractions() {
  let isDraggingProgress = false;
  let isDraggingStart = false;
  let isDraggingEnd = false;

  function getProgressPosition(e) {
      const rect = els.progressContainer.getBoundingClientRect();
      const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  // Progress bar click
  els.progressContainer.addEventListener('click', (e) => {
      if (isDraggingStart || isDraggingEnd || !duration) return;
      
      const position = getProgressPosition(e);
      const time = position * duration;
      seekToPosition(time * 1000);
  });

  // Loop handle dragging
  function setupHandleDragging(handle, isStart) {
      let isDragging = false;

      function startDrag(e) {
          isDragging = true;
          if (isStart) isDraggingStart = true;
          else isDraggingEnd = true;
          
          handle.classList.add('dragging');
          document.body.style.userSelect = 'none';
          e.preventDefault();
      }

      function drag(e) {
          if (!isDragging || !duration) return;
          
          const position = getProgressPosition(e);
          const time = position * duration;
          
          if (isStart) {
              loopStart = Math.max(0, Math.min(time, loopEnd - 1));
          } else {
              loopEnd = Math.max(loopStart + 1, Math.min(time, duration));
          }
          
          updateLoopVisuals();
          e.preventDefault();
      }

      function stopDrag() {
          if (!isDragging) return;
          
          isDragging = false;
          isDraggingStart = false;
          isDraggingEnd = false;
          
          handle.classList.remove('dragging');
          document.body.style.userSelect = '';
      }

      // Mouse events
      handle.addEventListener('mousedown', startDrag);
      document.addEventListener('mousemove', drag);
      document.addEventListener('mouseup', stopDrag);

      // Touch events
      handle.addEventListener('touchstart', startDrag, { passive: false });
      document.addEventListener('touchmove', drag, { passive: false });
      document.addEventListener('touchend', stopDrag);
  }

  setupHandleDragging(els.loopStartHandle, true);
  setupHandleDragging(els.loopEndHandle, false);
}

function loadSharedLoop() {
  try {
      const sharedData = sessionStorage.getItem('shared_loop');
      if (!sharedData) return;

      const shared = JSON.parse(sharedData);
      console.log('🔗 Loading shared loop:', shared);

      showStatus('🔗 Loading shared loop...');
      sessionStorage.removeItem('shared_loop');

  } catch (error) {
      console.error('🚨 Load shared loop error:', error);
      sessionStorage.removeItem('shared_loop');
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initializeElements();
  setupEventListeners();
  loadLooopsFromStorage();
  loadPlaylistsFromStorage();
  checkForSharedLoop();
  
  // Load Spotify SDK
  const script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  script.async = true;
  document.head.appendChild(script);
});