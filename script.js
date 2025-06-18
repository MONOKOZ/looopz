// SPOTIFY INTEGRATION - RESTRUCTURED WITH UNIFIED LOOP SYSTEM AND PRECISE TIMING

// Config
const SPOTIFY_CLIENT_ID = '46637d8f5adb41c0a4be34e0df0c1597';
const SPOTIFY_REDIRECT_URI = 'https://looopz.vercel.app/';
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

// Core State
let spotifyPlayer = null, spotifyDeviceId = null, spotifyAccessToken = null;
let isConnected = false, isPlaying = false, currentTrack = null;
let currentTime = 0, duration = 0, loopStart = 0, loopEnd = 30;

// UNIFIED Loop System - Single source of truth for all loop operations
let loopEnabled = false;
let loopCount = 0;          // Current loop iteration
let loopTarget = 1;         // Target loop iterations
let loopStartTime = 0;      // Timestamp when loop session started
let lastSeekTime = 0;       // Prevent rapid seeks

// Timing Control
let updateTimer = null;
let isLooping = false;      // Prevents concurrent loop operations
let isDragging = false;

// UI State
let currentView = 'login';
let currentSearchResults = [];
let currentEditingLoopId = null;
let currentContextMenuTrackIndex = null;

// Playlist State - Simplified and unified
let savedPlaylists = [];
let currentPlaylist = null;
let currentPlaylistIndex = 0;
let isPlaylistMode = false;
let currentEditingPlaylistId = null;
let pendingPlaylistItem = null;

// Search State
let searchState = {
    isSecondLevel: false,
    currentLevel: 'tracks',
    currentEntity: null,
    currentOffset: 0,
    totalTracks: 0,
    hasMore: false,
    query: ''
};

// Storage
let savedLoops = [];

// Elements
let els = {};

// ===== UTILITY FUNCTIONS =====

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

// ===== UI UPDATE FUNCTIONS =====

function updateProgress() {
    if (!duration) return;
    const percent = (currentTime / duration) * 100;
    els.progressBar.style.width = `${percent}%`;
    els.currentTime.textContent = formatTime(currentTime);
    els.duration.textContent = formatTime(duration);
}

function updatePlayPauseButton() {
    els.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
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
}

// ===== CORE PLAYBACK FUNCTIONS =====

async function loadTrackIntoSpotify(track, startPositionMs = 0) {
    if (!spotifyPlayer || !spotifyDeviceId || !track) return;

    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            body: JSON.stringify({
                uris: [track.uri],
                position_ms: startPositionMs
            }),
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${spotifyAccessToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Spotify API error: ${response.status} - ${errorText}`);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
    } catch (error) {
        console.error('🚨 Failed to load track:', error);
        throw error;
    }
}

async function togglePlayPause() {
    if (!spotifyPlayer) return;

    try {
        if (isPlaying) {
            await spotifyPlayer.pause();
        } else {
            await spotifyPlayer.resume();
        }
    } catch (error) {
        console.error('🚨 Play/pause failed:', error);
        showStatus('Playback control failed');
    }
}

async function seek(position) {
    if (!spotifyPlayer) return;
    
    // Prevent rapid seeks
    const now = Date.now();
    if (now - lastSeekTime < 300) return;
    lastSeekTime = now;
    
    try {
        await spotifyPlayer.seek(position * 1000);
        currentTime = position;
        updateProgress();
    } catch (error) {
        console.error('🚨 Seek failed:', error);
    }
}

async function skipForward() {
    if (!spotifyPlayer) return;
    const newTime = Math.min(currentTime + 10, duration);
    await seek(newTime);
}

async function skipBackward() {
    if (!spotifyPlayer) return;
    const newTime = Math.max(currentTime - 10, 0);
    await seek(newTime);
}

// ===== UNIFIED LOOP SYSTEM =====

// FIXED: Renamed from startLoop to setLoop - just sets loop points without auto-playing
async function setLoop() {
    if (!currentTrack) {
        showStatus('No track selected');
        return;
    }

    // Reset counters for new loop session
    loopCount = 0;
    loopStartTime = Date.now();
    loopEnabled = true;
    els.loopToggle.checked = true;
    
    if (isPlaylistMode) {
        showStatus(`🔄 Loop set: ${loopTarget}× (Playlist mode)`);
    } else {
        showStatus(`🔄 Loop set: ${loopTarget}×`);
    }
    
    updateRepeatDisplay();
}

// FIXED: Unified loop end handling for both regular and playlist modes
async function handleLoopEnd() {
    // Prevent concurrent loop operations
    if (isLooping) return;
    
    try {
        isLooping = true;
        loopCount++;
        
        console.log(`🔄 Loop ${loopCount}/${loopTarget} (${isPlaylistMode ? 'Playlist' : 'Regular'} mode)`);
        
        if (loopCount >= loopTarget) {
            // Loop target reached
            if (isPlaylistMode) {
                // Move to next playlist item
                await moveToNextPlaylistItem();
            } else {
                // Stop regular loop
                await togglePlayPause();
                showStatus(`✅ Loop completed! (${loopCount}×)`);
                loopEnabled = false;
                els.loopToggle.checked = false;
                loopCount = 0;
            }
        } else {
            // Continue looping
            await seek(loopStart);
            const remaining = loopTarget - loopCount;
            showStatus(`🔄 Loop ${loopCount}/${loopTarget} (${remaining} remaining)`);
        }
        
    } catch (error) {
        console.error('🚨 Loop end handling error:', error);
    } finally {
        // Reset looping flag after short delay
        setTimeout(() => {
            isLooping = false;
        }, 200);
    }
}

// FIXED: Enhanced progress tracking with precise timing
function startProgressUpdates() {
    stopProgressUpdates();
    updateTimer = setInterval(async () => {
        if (isPlaying && spotifyPlayer && !isLooping) {
            try {
                const state = await spotifyPlayer.getCurrentState();
                if (state && state.position !== undefined) {
                    currentTime = state.position / 1000;
                    updateProgress();
                    
                    // FIXED: Precise loop detection for both modes
                    if (loopEnabled && currentTime >= loopEnd - 0.03) { // Reduced buffer for precision
                        if (loopCount < loopTarget) {
                            const timeSinceLoopStart = Date.now() - loopStartTime;
                            if (timeSinceLoopStart > 400) { // Minimum time between loop operations
                                await handleLoopEnd();
                            }
                        }
                    }
                }
            } catch (error) {
                console.warn('State check failed:', error.message);
            }
        }
    }, 50); // Higher frequency for better precision
}

function stopProgressUpdates() {
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
}

// ===== PLAYLIST FUNCTIONS =====

async function moveToNextPlaylistItem() {
    if (!currentPlaylist || !isPlaylistMode) return;
    
    currentPlaylistIndex++;
    
    if (currentPlaylistIndex >= currentPlaylist.items.length) {
        // Playlist completed
        console.log('🏁 Playlist completed!');
        showStatus('🏁 Playlist finished!');
        stopPlaylistMode();
        return;
    }
    
    // Load next item
    const nextItem = currentPlaylist.items[currentPlaylistIndex];
    await loadPlaylistItem(nextItem);
}

async function loadPlaylistItem(item) {
    try {
        console.log('🎵 Loading playlist item:', item);
        
        // Reset unified loop system for new item
        loopCount = 0;
        loopTarget = item.playCount || 1;
        loopStartTime = Date.now();
        
        // Set up loop parameters
        if (item.type === 'loop') {
            loopStart = item.start;
            loopEnd = item.end;
            loopEnabled = true;
            els.loopToggle.checked = true;
            
            // Load track and start at loop start
            const trackData = {
                uri: item.trackUri || item.uri,
                name: item.name,
                artist: item.artist,
                duration_ms: (item.duration || item.end) * 1000
            };
            
            currentTrack = trackData;
            duration = trackData.duration_ms / 1000;
            
            await loadTrackIntoSpotify(trackData, loopStart * 1000);
            
        } else {
            // Full track
            loopEnabled = false;
            els.loopToggle.checked = false;
            
            const trackData = {
                uri: item.uri,
                name: item.name,
                artist: item.artist,
                duration_ms: (item.duration || 180) * 1000
            };
            
            currentTrack = trackData;
            duration = trackData.duration_ms / 1000;
            loopStart = 0;
            loopEnd = duration;
            
            await loadTrackIntoSpotify(trackData, 0);
        }
        
        // Update UI
        els.currentTrack.textContent = item.name;
        els.currentArtist.textContent = item.artist;
        updateLoopVisuals();
        updateRepeatDisplay();
        updateProgress();
        
        showStatus(`🎵 ${item.name} (${loopTarget}×)`);
        
    } catch (error) {
        console.error('🚨 Failed to load playlist item:', error);
        showStatus('Failed to load playlist item');
    }
}

function stopPlaylistMode() {
    isPlaylistMode = false;
    currentPlaylist = null;
    currentPlaylistIndex = 0;
    
    // Reset unified loop system
    loopCount = 0;
    loopTarget = 1;
    
    // Hide playlist controls
    document.querySelectorAll('.playlist-now-playing').forEach(el => el.style.display = 'none');
    
    updateRepeatDisplay();
}

async function playPlaylist(playlistId, startIndex = 0) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist || playlist.items.length === 0) {
        showStatus('Playlist is empty');
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

        // Load first item
        const firstItem = playlist.items[startIndex];
        await loadPlaylistItem(firstItem);

        // Show player view with playlist controls
        showView('player');
        showPlaylistNowPlaying();

        showStatus(`🎵 Playing playlist: ${playlist.name}`);

    } catch (error) {
        console.error('🚨 Playlist play error:', error);
        showStatus('Failed to play playlist');
    }
}

function showPlaylistNowPlaying() {
    if (!currentPlaylist) return;
    
    // Show playlist controls in player
    const playlistControls = document.querySelector('.playlist-now-playing');
    if (playlistControls) {
        playlistControls.style.display = 'flex';
        const playlistTitle = playlistControls.querySelector('.playlist-title');
        const playlistProgress = playlistControls.querySelector('.playlist-progress');
        
        if (playlistTitle) playlistTitle.textContent = currentPlaylist.name;
        if (playlistProgress) {
            playlistProgress.textContent = `${currentPlaylistIndex + 1} / ${currentPlaylist.items.length}`;
        }
    }
}

// ===== SEARCH FUNCTIONS =====

async function playTrackInBackground(track, trackIndex) {
    try {
        showStatus(`▶ Playing: ${track.name}`);
        
        // Set current track for seamless transition support
        currentTrack = {
            uri: track.uri,
            name: track.name,
            artist: track.artists[0].name,
            duration_ms: track.duration_ms
        };
        
        duration = track.duration_ms / 1000;
        await loadTrackIntoSpotify(currentTrack);
        
        // Update UI highlighting
        updateSearchTrackHighlighting(track.uri);
        updateNowPlayingIndicator(currentTrack);
        startProgressUpdates();
    } catch (error) {
        console.error('🚨 Background play failed:', error);
        showStatus('Failed to play track');
    }
}

// SEAMLESS SEARCH-TO-PLAYER TRANSITION - Enhanced
async function selectTrack(uri, trackIndex) {
    if (!currentSearchResults || trackIndex < 0 || trackIndex >= currentSearchResults.length) return;

    const track = currentSearchResults[trackIndex];
    hideTrackContextMenu();

    try {
        let seamlessTransition = false;

        // Detection logic - Check if same track is already playing
        if (currentTrack && currentTrack.uri === uri && isPlaying) {
            seamlessTransition = true;
            console.log('🔄 Seamless transition detected - same track already playing');
        }

        // Track data setup
        currentTrack = {
            uri: track.uri,
            name: track.name,
            artist: track.artists[0].name,
            duration_ms: track.duration_ms
        };

        duration = track.duration_ms / 1000;
        
        // Update main player UI immediately
        els.currentTrack.textContent = currentTrack.name;
        els.currentArtist.textContent = currentTrack.artist;

        // Modified track loading
        if (seamlessTransition) {
            console.log('✅ Seamless transition - continuing from position:', currentTime);
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

        // Loop handle adjustment for seamless transitions
        if (seamlessTransition) {
            const currentPos = currentTime;
            
            if (loopStart > currentPos) {
                loopStart = Math.max(0, currentPos - 10);
            }
            
            if (loopEnd <= currentPos) {
                loopEnd = Math.min(duration, currentPos + 20);
            }
            
            if (currentPos > loopEnd || currentPos + 30 < loopStart) {
                loopStart = Math.max(0, currentPos - 5);
                loopEnd = Math.min(duration, currentPos + 25);
            }

            showStatus(`✅ Seamless takeover: ${currentTrack.name} (continuing from ${formatTime(currentPos)})`);
        } else {
            loopStart = 0;
            loopEnd = Math.min(30, duration);
            showStatus(`✅ Selected: ${currentTrack.name}`);
        }

        updateLoopVisuals();
        updateProgress();
        showView('player');

    } catch (error) {
        console.error('🚨 Track selection error:', error);
        showStatus('Failed to load track');
    }
}

// ===== CONTEXT MENU FUNCTIONS =====

function showTrackContextMenu(trackIndex, buttonElement) {
    currentContextMenuTrackIndex = trackIndex;
    const menu = els.contextMenu;
    const overlay = els.contextMenuOverlay;
    
    menu.style.left = '50%';
    menu.style.bottom = '120px';
    menu.style.top = 'auto';
    menu.style.transform = 'translateX(-50%)';
    
    menu.classList.add('show');
    overlay.classList.add('show');
}

function hideTrackContextMenu() {
    els.contextMenu.classList.remove('show');
    els.contextMenuOverlay.classList.remove('show');
    currentContextMenuTrackIndex = null;
}

// ===== VIEW MANAGEMENT =====

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

// ===== LOOP HANDLES =====

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

// ===== LOOPS MANAGEMENT =====

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
        console.error('Failed to load loops:', error);
        savedLoops = [];
    }
}

function saveLoopsToStorage() {
    try {
        localStorage.setItem('looopz_saved_loops', JSON.stringify(savedLoops));
        updateLoopCountBadge();
    } catch (error) {
        console.error('Failed to save loops:', error);
    }
}

async function saveCurrentLoop() {
    if (!currentTrack || loopStart >= loopEnd) {
        showStatus('Invalid loop settings');
        return;
    }

    const loop = {
        id: `loop_${Date.now()}`,
        track: currentTrack,
        loop: { start: loopStart, end: loopEnd, repeat: loopTarget },
        savedAt: new Date().toISOString()
    };

    savedLoops.push(loop);
    saveLoopsToStorage();
    showStatus(`💾 Loop saved! (${savedLoops.length} total)`);
}

function renderLoopsList() {
    if (savedLoops.length === 0) {
        els.loopsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No saved loops yet</div>';
        return;
    }

    els.loopsList.innerHTML = savedLoops.map(loop => `
        <div class="loop-card">
            <div class="loop-header">
                <img src="https://via.placeholder.com/56x56/1a1a1a/888?text=♪" alt="Loop" class="loop-thumbnail">
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
                    <span>${loop.loop.repeat}×</span>
                </div>
                <div class="loop-stat">
                    <span class="loop-stat-icon">📅</span>
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
                        <input type="number" class="edit-input" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="100">
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

function loadLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    currentTrack = loop.track;
    duration = currentTrack.duration_ms / 1000;
    loopStart = loop.loop.start;
    loopEnd = loop.loop.end;
    loopTarget = loop.loop.repeat;

    els.currentTrack.textContent = currentTrack.name;
    els.currentArtist.textContent = currentTrack.artist;

    updateLoopVisuals();
    updateRepeatDisplay();
    showView('player');
    showStatus(`✅ Loaded: ${currentTrack.name}`);
}

function editLoop(loopId) {
    document.querySelectorAll('.loop-edit-form').forEach(form => form.classList.remove('active'));
    const form = document.getElementById(`edit-form-${loopId}`);
    if (form) {
        form.classList.add('active');
        currentEditingLoopId = loopId;
    }
}

function cancelEdit(loopId) {
    const form = document.getElementById(`edit-form-${loopId}`);
    if (form) form.classList.remove('active');
    currentEditingLoopId = null;
}

function saveLoopEdits(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    const startInput = document.getElementById(`edit-start-${loopId}`);
    const endInput = document.getElementById(`edit-end-${loopId}`);
    const repeatInput = document.getElementById(`edit-repeat-${loopId}`);

    const newStart = parseTimeInput(startInput.value);
    const newEnd = parseTimeInput(endInput.value);
    const newRepeat = parseInt(repeatInput.value) || 1;

    if (newStart >= newEnd) {
        showStatus('Invalid time range');
        return;
    }

    loop.loop.start = newStart;
    loop.loop.end = newEnd;
    loop.loop.repeat = newRepeat;
    
    saveLoopsToStorage();
    renderLoopsList();
    showStatus('✅ Loop updated!');
}

function deleteLoop(loopId) {
    if (confirm('Delete this loop?')) {
        savedLoops = savedLoops.filter(l => l.id !== loopId);
        saveLoopsToStorage();
        renderLoopsList();
        showStatus('🗑 Loop deleted');
    }
}

function clearAllLoops() {
    if (confirm('Delete all saved loops? This cannot be undone.')) {
        savedLoops = [];
        saveLoopsToStorage();
        renderLoopsList();
        showStatus('🗑 All loops cleared');
    }
}

async function shareLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    const shareText = `🔥 Check out this loop I made on LOOOPZ!\n\n🎵 ${loop.track.name} by ${loop.track.artist}\n⏱ ${formatTime(loop.loop.start, false)} - ${formatTime(loop.loop.end, false)}\n🔄 ${loop.loop.repeat}x repeat\n\nCreate your own loops at https://looopz.vercel.app`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'LOOOPZ Loop',
                text: shareText,
                url: 'https://looopz.vercel.app'
            });
        } catch (error) {
            console.log('Share cancelled or failed');
        }
    } else {
        try {
            await navigator.clipboard.writeText(shareText);
            showStatus('📋 Loop details copied to clipboard!');
        } catch (error) {
            showStatus('❌ Could not copy to clipboard');
        }
    }
}

// ===== PLAYLIST MANAGEMENT =====

function loadSavedPlaylists() {
    try {
        const saved = localStorage.getItem('looopz_saved_playlists');
        savedPlaylists = saved ? JSON.parse(saved) : [];
        updatePlaylistCountBadge();
    } catch (error) {
        console.error('Failed to load playlists:', error);
        savedPlaylists = [];
    }
}

function savePlaylistsToStorage() {
    try {
        localStorage.setItem('looopz_saved_playlists', JSON.stringify(savedPlaylists));
        updatePlaylistCountBadge();
    } catch (error) {
        console.error('Failed to save playlists:', error);
    }
}

function renderPlaylistsList() {
    if (savedPlaylists.length === 0) {
        els.playlistsList.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No playlists yet</div>';
        return;
    }

    els.playlistsList.innerHTML = savedPlaylists.map(playlist => `
        <div class="playlist-card">
            <div class="playlist-header">
                <div class="playlist-icon">🎵</div>
                <div class="playlist-details">
                    <div class="playlist-name">${playlist.name}</div>
                    <div class="playlist-description">${playlist.description || 'No description'}</div>
                </div>
            </div>

            <div class="playlist-stats">
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">🎵</span>
                    <span>${playlist.items.length} items</span>
                </div>
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">⏱</span>
                    <span>${Math.round(playlist.totalDuration / 60)}m</span>
                </div>
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">▶</span>
                    <span>${playlist.playCount || 0} plays</span>
                </div>
            </div>

            <div class="playlist-actions">
                <button class="playlist-action-btn play-playlist-btn" data-playlist-id="${playlist.id}">▶ Play</button>
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
    cancelPlaylistEdit(playlistId);
    showStatus('✅ Playlist updated!');
}

function setupPlaylistDragAndDrop(playlistId) {
    const container = document.getElementById(`playlist-items-${playlistId}`);
    if (!container) return;

    let draggedIndex = -1;

    container.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('playlist-item')) {
            draggedIndex = parseInt(e.target.dataset.itemIndex);
            e.target.classList.add('dragging');
        }
    });

    container.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('playlist-item')) {
            e.target.classList.remove('dragging');
        }
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        const afterElement = getDragAfterElement(container, e.clientY);
        const dragging = container.querySelector('.dragging');
        
        if (afterElement == null) {
            container.appendChild(dragging);
        } else {
            container.insertBefore(dragging, afterElement);
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();
        const allItems = [...container.querySelectorAll('.playlist-item')];
        const newIndex = allItems.findIndex(item => item.classList.contains('dragging'));
        
        if (draggedIndex !== -1 && newIndex !== -1 && draggedIndex !== newIndex) {
            reorderPlaylistItems(playlistId, draggedIndex, newIndex);
            renderPlaylistsList();
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

function removeFromPlaylist(playlistId, itemIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    const removedItem = playlist.items[itemIndex];
    playlist.items.splice(itemIndex, 1);

    // Update total duration
    const itemDuration = removedItem.type === 'loop'
        ? (removedItem.end - removedItem.start) * removedItem.playCount
        : removedItem.duration * removedItem.playCount;
    playlist.totalDuration -= itemDuration;
    playlist.updatedAt = new Date().toISOString();

    savePlaylistsToStorage();
    renderPlaylistsList();
    showStatus('Removed from playlist');
}

function reorderPlaylistItems(playlistId, fromIndex, toIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    const [item] = playlist.items.splice(fromIndex, 1);
    playlist.items.splice(toIndex, 0, item);

    playlist.updatedAt = new Date().toISOString();
    savePlaylistsToStorage();
}

function createPlaylist(name, description = '') {
    const playlist = {
        id: `playlist_${Date.now()}`,
        name: name,
        description: description,
        items: [],
        totalDuration: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        playCount: 0
    };

    savedPlaylists.push(playlist);
    savePlaylistsToStorage();
    renderPlaylistsList();
    showStatus(`✅ Playlist "${name}" created!`);
    return playlist.id;
}

function deletePlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    if (confirm(`Delete playlist "${playlist.name}"?`)) {
        savedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
        savePlaylistsToStorage();
        renderPlaylistsList();
        showStatus('🗑 Playlist deleted');
    }
}

async function addCurrentToPlaylist() {
    if (!currentTrack) {
        showStatus('No track loaded');
        return;
    }

    if (loopStart >= loopEnd) {
        showStatus('Invalid loop settings');
        return;
    }

    const item = {
        type: loopEnabled ? 'loop' : 'track',
        uri: currentTrack.uri,
        trackUri: currentTrack.uri,
        name: currentTrack.name,
        artist: currentTrack.artist,
        duration: duration,
        playCount: loopTarget,
        ...(loopEnabled && {
            start: loopStart,
            end: loopEnd
        })
    };

    pendingPlaylistItem = item;
    showAddToPlaylistPopup();
}

function showAddToPlaylistPopup() {
    renderPlaylistSelectionList();
    els.addToPlaylistPopup.classList.add('show');
}

function hideAddToPlaylistPopup() {
    els.addToPlaylistPopup.classList.remove('show');
    pendingPlaylistItem = null;
}

function renderPlaylistSelectionList() {
    if (savedPlaylists.length === 0) {
        els.playlistSelectionList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--light-gray);">No playlists yet</div>';
        return;
    }

    els.playlistSelectionList.innerHTML = savedPlaylists.map(playlist => `
        <button class="playlist-selection-item" data-playlist-id="${playlist.id}">
            <div class="playlist-selection-info">
                <div class="playlist-selection-name">${playlist.name}</div>
                <div class="playlist-selection-count">${playlist.items.length} items</div>
            </div>
        </button>
    `).join('');
}

function addToSelectedPlaylist(playlistId) {
    if (!pendingPlaylistItem) return;

    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    playlist.items.push(pendingPlaylistItem);

    // Update total duration
    const itemDuration = pendingPlaylistItem.type === 'loop'
        ? (pendingPlaylistItem.end - pendingPlaylistItem.start) * pendingPlaylistItem.playCount
        : pendingPlaylistItem.duration * pendingPlaylistItem.playCount;
    playlist.totalDuration += itemDuration;
    playlist.updatedAt = new Date().toISOString();

    savePlaylistsToStorage();
    hideAddToPlaylistPopup();
    showStatus(`✅ Added to "${playlist.name}"`);
}

function showCreatePlaylistForm(withPendingItem = false) {
    els.playlistFormTitle.textContent = 'Create Playlist';
    els.playlistNameInput.value = '';
    els.playlistDescriptionInput.value = '';
    els.playlistFormPopup.classList.add('show');
}

function hideCreatePlaylistForm() {
    els.playlistFormPopup.classList.remove('show');
}

function handleCreatePlaylistSubmit() {
    const name = els.playlistNameInput.value.trim();
    if (!name) {
        showStatus('Please enter a playlist name');
        return;
    }

    const description = els.playlistDescriptionInput.value.trim();
    const playlistId = createPlaylist(name, description);

    if (pendingPlaylistItem) {
        addToSelectedPlaylist(playlistId);
    }

    hideCreatePlaylistForm();
}

async function sharePlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    const shareText = `🎵 Check out my "${playlist.name}" playlist on LOOOPZ!\n\n${playlist.items.length} tracks • ${Math.round(playlist.totalDuration / 60)} minutes\n\nCreate your own playlists at https://looopz.vercel.app`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `LOOOPZ - ${playlist.name}`,
                text: shareText,
                url: 'https://looopz.vercel.app'
            });
        } catch (error) {
            console.log('Share cancelled or failed');
        }
    } else {
        try {
            await navigator.clipboard.writeText(shareText);
            showStatus('📋 Playlist details copied to clipboard!');
        } catch (error) {
            showStatus('❌ Could not copy to clipboard');
        }
    }
}

// ===== SEARCH FUNCTIONS =====

async function searchTracks(query) {
    if (!query.trim()) {
        els.searchResults.innerHTML = '';
        return;
    }

    searchState.query = query;

    try {
        showStatus('Searching...');
        const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=${searchState.currentOffset}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        
        if (searchState.currentOffset === 0) {
            currentSearchResults = data.tracks.items;
        } else {
            currentSearchResults = [...currentSearchResults, ...data.tracks.items];
        }

        searchState.totalTracks = data.tracks.total;
        searchState.hasMore = currentSearchResults.length < data.tracks.total;

        displaySearchResults(currentSearchResults, searchState.hasMore);
        showStatus(`Found ${data.tracks.total} tracks`);

    } catch (error) {
        console.error('🚨 Search failed:', error);
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
                <button class="track-action-btn play-track-btn" data-track-index="${index}">▶</button>
                <button class="track-action-btn secondary select-track-btn" data-track-index="${index}">+</button>
                <button class="track-action-btn menu track-menu-btn" data-track-index="${index}">⋮</button>
            </div>
        </div>
    `).join('');

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

function updateSearchTrackHighlighting(uri, isSelected = false) {
    document.querySelectorAll('.track-item').forEach(item => {
        item.classList.remove('playing', 'selected');
    });

    if (uri && currentSearchResults) {
        const trackIndex = currentSearchResults.findIndex(track => track.uri === uri);
        if (trackIndex !== -1) {
            const trackElement = document.querySelector(`[data-track-index="${trackIndex}"]`);
            if (trackElement) {
                trackElement.classList.add(isSelected ? 'selected' : 'playing');
            }
        }
    }
}

// ===== SPOTIFY AUTH =====

function getHashParams() {
    const hashParams = {};
    const hash = window.location.hash.substring(1);
    const pairs = hash.split('&');
    
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i].split('=');
        hashParams[pair[0]] = decodeURIComponent(pair[1] || '');
    }
    
    return hashParams;
}

function checkAuth() {
    const hashParams = getHashParams();
    
    if (hashParams.access_token) {
        spotifyAccessToken = hashParams.access_token;
        history.replaceState({}, document.title, '/');
        initializeSpotify();
    } else {
        showView('login');
    }
}

function connectToSpotify() {
    const authUrl = `https://accounts.spotify.com/authorize?` +
        `client_id=${SPOTIFY_CLIENT_ID}&` +
        `response_type=token&` +
        `redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}&` +
        `scope=${encodeURIComponent(SPOTIFY_SCOPES)}`;
    
    window.location.href = authUrl;
}

function disconnect() {
    spotifyAccessToken = null;
    isConnected = false;
    if (spotifyPlayer) {
        spotifyPlayer.disconnect();
        spotifyPlayer = null;
    }
    stopProgressUpdates();
    showView('login');
    showStatus('Disconnected from Spotify');
}

// ===== SPOTIFY PLAYER INITIALIZATION =====

function initializeSpotify() {
    window.onSpotifyWebPlaybackSDKReady = () => {
        spotifyPlayer = new Spotify.Player({
            name: 'LOOOPZ Player',
            getOAuthToken: cb => cb(spotifyAccessToken),
            volume: 0.8
        });

        spotifyPlayer.addListener('ready', ({ device_id }) => {
            console.log('🎵 Spotify Player ready:', device_id);
            spotifyDeviceId = device_id;
            isConnected = true;
            updateConnectionStatus();
            showView('search');
            showStatus('✅ Connected to Spotify!');
        });

        spotifyPlayer.addListener('not_ready', ({ device_id }) => {
            console.log('⚠️ Spotify Player not ready:', device_id);
            isConnected = false;
            updateConnectionStatus();
        });

        spotifyPlayer.addListener('player_state_changed', (state) => {
            if (!state) return;

            isPlaying = !state.paused;
            currentTime = state.position / 1000;
            
            if (state.track_window?.current_track) {
                const track = state.track_window.current_track;
                duration = state.duration / 1000;
                
                if (!currentTrack || currentTrack.uri !== track.uri) {
                    currentTrack = {
                        uri: track.uri,
                        name: track.name,
                        artist: track.artists[0]?.name || 'Unknown Artist',
                        duration_ms: state.duration
                    };
                }
            }

            updateProgress();
            updatePlayPauseButton();
            updateNowPlayingIndicator(currentTrack);

            if (isPlaying && !updateTimer) {
                startProgressUpdates();
            } else if (!isPlaying && updateTimer) {
                stopProgressUpdates();
            }
        });

        spotifyPlayer.connect();
    };

    if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
}

// ===== EVENT LISTENERS =====

function setupEventListeners() {
    // Main navigation
    els.connectBtn.addEventListener('click', connectToSpotify);
    els.disconnectBtn.addEventListener('click', disconnect);

    // Navigation buttons
    els.navSearch.addEventListener('click', () => showView('search'));
    els.navPlayer.addEventListener('click', () => showView('player'));
    els.navLibrary.addEventListener('click', () => showView('library'));
    els.navPlaylists.addEventListener('click', () => showView('playlists'));
    els.navDiscovery.addEventListener('click', () => window.open('/discovery.html', '_blank'));

    // Player controls - FIXED: Updated startLoop to setLoop
    els.playPauseBtn.addEventListener('click', togglePlayPause);
    els.backwardBtn.addEventListener('click', skipBackward);
    els.forwardBtn.addEventListener('click', skipForward);
    els.startLoopBtn.addEventListener('click', setLoop); // FIXED: renamed function
    els.saveLoopBtn.addEventListener('click', saveCurrentLoop);
    els.addToPlaylistBtn.addEventListener('click', addCurrentToPlaylist);

    // Loop controls
    els.loopToggle.addEventListener('change', function() {
        loopEnabled = this.checked;
        showStatus(loopEnabled ? `Loop enabled: ${loopTarget} time(s)` : 'Loop disabled');
    });

    // Search
    els.searchInput.addEventListener('input', function() {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
            searchState.currentOffset = 0;
            searchTracks(this.value);
        }, 300);
    });

    // Precision controls
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

    // Repeat controls
    els.repeatValue.addEventListener('click', function() {
        const newTarget = prompt('Set repeat count:', loopTarget);
        if (newTarget && !isNaN(newTarget) && newTarget > 0) {
            loopTarget = parseInt(newTarget);
            updateRepeatDisplay();
        }
    });

    // Precision popup
    els.precisionBtn.addEventListener('click', () => els.precisionPopup.classList.add('show'));
    els.precisionClose.addEventListener('click', () => els.precisionPopup.classList.remove('show'));

    // Context menu
    els.contextMenuOverlay.addEventListener('click', hideTrackContextMenu);

    // Playlist forms
    els.addToPlaylistClose.addEventListener('click', hideAddToPlaylistPopup);
    els.playlistFormClose.addEventListener('click', hideCreatePlaylistForm);
    els.playlistFormCancel.addEventListener('click', hideCreatePlaylistForm);
    els.playlistFormSave.addEventListener('click', handleCreatePlaylistSubmit);
    els.quickCreatePlaylist.addEventListener('click', () => showCreatePlaylistForm(true));
    els.createPlaylistBtn.addEventListener('click', () => showCreatePlaylistForm(false));

    // Delegated event handling
    document.addEventListener('click', async (e) => {
        const target = e.target;

        // Search results
        if (target.matches('.play-track-btn')) {
            e.preventDefault();
            const trackIndex = parseInt(target.dataset.trackIndex);
            const track = currentSearchResults[trackIndex];
            if (track) await playTrackInBackground(track, trackIndex);
        }
        else if (target.matches('.select-track-btn')) {
            e.preventDefault();
            const trackIndex = parseInt(target.dataset.trackIndex);
            const track = currentSearchResults[trackIndex];
            if (track) await selectTrack(track.uri, trackIndex);
        }
        else if (target.matches('.track-menu-btn')) {
            e.preventDefault();
            const trackIndex = parseInt(target.dataset.trackIndex);
            showTrackContextMenu(trackIndex, target);
        }
        else if (target.matches('#load-more-tracks')) {
            e.preventDefault();
            await loadMoreTracks();
        }

        // Loop actions
        else if (target.matches('.load-btn')) {
            e.preventDefault();
            const loopId = target.dataset.loopId;
            loadLoop(loopId);
        }
        else if (target.matches('.edit-btn')) {
            e.preventDefault();
            const loopId = target.dataset.loopId;
            editLoop(loopId);
        }
        else if (target.matches('.share-btn')) {
            e.preventDefault();
            const loopId = target.dataset.loopId;
            await shareLoop(loopId);
        }
        else if (target.matches('.delete-btn')) {
            e.preventDefault();
            const loopId = target.dataset.loopId;
            deleteLoop(loopId);
        }
        else if (target.matches('.add-to-playlist-btn[data-loop-id]')) {
            e.preventDefault();
            const loopId = target.dataset.loopId;
            const loop = savedLoops.find(l => l.id === loopId);
            if (loop) {
                pendingPlaylistItem = {
                    type: 'loop',
                    uri: loop.track.uri,
                    trackUri: loop.track.uri,
                    name: loop.track.name,
                    artist: loop.track.artist,
                    duration: loop.track.duration_ms / 1000,
                    start: loop.loop.start,
                    end: loop.loop.end,
                    playCount: loop.loop.repeat
                };
                showAddToPlaylistPopup();
            }
        }
        else if (target.matches('#clear-all-loops')) {
            e.preventDefault();
            clearAllLoops();
        }

        // Playlist actions
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

        // Playlist controls (when in playlist mode)
        else if (target.matches('#playlist-prev-btn')) {
            e.preventDefault();
            if (isPlaylistMode && currentPlaylistIndex > 0) {
                currentPlaylistIndex--;
                const prevItem = currentPlaylist.items[currentPlaylistIndex];
                await loadPlaylistItem(prevItem);
            }
        }
        else if (target.matches('#playlist-stop-btn')) {
            e.preventDefault();
            stopPlaylistMode();
        }
        else if (target.matches('#playlist-next-btn')) {
            e.preventDefault();
            if (isPlaylistMode) {
                await moveToNextPlaylistItem();
            }
        }

        // Playlist selection
        else if (target.matches('.playlist-selection-item')) {
            e.preventDefault();
            const playlistId = target.dataset.playlistId;
            addToSelectedPlaylist(playlistId);
        }

        // Context menu actions
        else if (target.matches('#context-play')) {
            e.preventDefault();
            if (currentContextMenuTrackIndex !== null) {
                const track = currentSearchResults[currentContextMenuTrackIndex];
                if (track) await playTrackInBackground(track, currentContextMenuTrackIndex);
            }
            hideTrackContextMenu();
        }
        else if (target.matches('#context-select')) {
            e.preventDefault();
            if (currentContextMenuTrackIndex !== null) {
                const track = currentSearchResults[currentContextMenuTrackIndex];
                if (track) await selectTrack(track.uri, currentContextMenuTrackIndex);
            }
            hideTrackContextMenu();
        }
        else if (target.matches('#context-add-playlist')) {
            e.preventDefault();
            if (currentContextMenuTrackIndex !== null) {
                const track = currentSearchResults[currentContextMenuTrackIndex];
                if (track) {
                    pendingPlaylistItem = {
                        type: 'track',
                        uri: track.uri,
                        name: track.name,
                        artist: track.artists[0].name,
                        duration: track.duration_ms / 1000,
                        playCount: 1
                    };
                    showAddToPlaylistPopup();
                }
            }
            hideTrackContextMenu();
        }
    });
}

// ===== GLOBAL FUNCTION EXPORTS =====
// Make functions available globally for onclick handlers
window.editLoop = editLoop;
window.cancelEdit = cancelEdit;
window.saveLoopEdits = saveLoopEdits;
window.cancelPlaylistEdit = cancelPlaylistEdit;
window.savePlaylistEdits = savePlaylistEdits;
window.removeFromPlaylist = removeFromPlaylist;

// ===== INITIALIZATION =====

function init() {
    console.log('🚀 Initializing LOOOPZ with Unified Loop System...');

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

    console.log('✅ LOOOPZ initialization complete with Unified Loop System!');
}

// Initialize when DOM is ready
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
