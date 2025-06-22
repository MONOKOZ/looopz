// Spotify Configuration
const SPOTIFY_CLIENT_ID = '00c5bfadb97c4d4580faca4b1d0ae33f';
const SPOTIFY_REDIRECT_URI = window.location.hostname === 'localhost' 
    ? 'http://localhost:5173/' 
    : 'https://looopz.vercel.app/';
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-library-read user-library-modify user-read-playback-state user-modify-playback-state';

// App State
let spotifyAccessToken = null;
let spotifyPlayer = null;
let spotifyDeviceId = null;
let currentTrack = null;
let currentSearchResults = [];
let currentTime = 0;
let duration = 0;
let loopStart = 0;
let loopEnd = 30;
let isLooping = false;
let repeatCount = 1;
let loopCounter = 0;
let progressInterval = null;
let savedLoops = [];
let savedPlaylists = [];
let isDragging = false;
let isConnected = false;
let isPlaying = false;
let isResuming = false;
let playlistEngine = null;
let isPlaylistMode = false;
let currentPlaylist = null;
let currentPlaylistIndex = 0;
let pendingPlaylistItem = null;
let currentEditingPlaylistId = null;
let currentContextMenuTrackIndex = null;

// Audio Analysis Caches for Smart Transitions
const audioAnalysisCache = new Map();
const trackFeaturesCache = new Map();

// Search state
const searchState = {
    currentOffset: 0,
    totalTracks: 0,
    hasMore: false,
    query: '',
    currentEntity: null,
    currentLevel: 'tracks',
    isSecondLevel: false
};

// DOM Elements
let els = {};

// Spotify Player Functions
function initializeSpotifyPlayer() {
    if (!window.Spotify) {
        showStatus('Spotify SDK not loaded. Please refresh.');
        return;
    }

    spotifyPlayer = new Spotify.Player({
        name: 'LOOOPZ Music Loop Player',
        getOAuthToken: cb => { cb(spotifyAccessToken); },
        volume: 1.0
    });

    spotifyPlayer.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
        isConnected = true;
        updateConnectionStatus(true);
        showStatus('✅ Connected to Spotify!');
        console.log('Ready with Device ID', device_id);
    });

    spotifyPlayer.addListener('not_ready', ({ device_id }) => {
        console.log('Device ID has gone offline', device_id);
        isConnected = false;
        updateConnectionStatus(false);
    });

    spotifyPlayer.addListener('player_state_changed', (state) => {
        if (!state) return;

        isPlaying = !state.paused;
        updatePlayPauseButton();

        if (state.paused) {
            stopProgressUpdates();
        } else {
            startProgressUpdates();
        }

        if (isLooping && !state.paused && currentTrack && !isResuming) {
            const position = state.position / 1000;
            if (position >= loopEnd || position < loopStart - 0.5) {
                performLoop();
            }
        }
        isResuming = false;
    });

    spotifyPlayer.addListener('initialization_error', ({ message }) => {
        console.error('Initialization Error:', message);
        showStatus('❌ Failed to initialize player');
    });

    spotifyPlayer.addListener('authentication_error', ({ message }) => {
        console.error('Authentication Error:', message);
        showStatus('❌ Authentication failed. Please reconnect.');
        disconnectSpotify();
    });

    spotifyPlayer.addListener('account_error', ({ message }) => {
        console.error('Account Error:', message);
        showStatus('❌ Spotify Premium required');
    });

    spotifyPlayer.addListener('playback_error', ({ message }) => {
        console.error('Playback Error:', message);
        showStatus('❌ Playback error occurred');
    });

    spotifyPlayer.connect().then(success => {
        if (success) {
            console.log('✅ Successfully connected to Spotify!');
        }
    });
}

window.onSpotifyWebPlaybackSDKReady = () => {
    if (spotifyAccessToken) {
        initializeSpotifyPlayer();
    }
};

async function loadTrackIntoSpotify(track, startPositionMs = null) {
    if (!spotifyAccessToken || !spotifyDeviceId) {
        showStatus('Not connected to Spotify');
        return;
    }

    try {
        const payload = {
            uris: [track.uri],
            position_ms: startPositionMs || 0
        };

        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        if (startPositionMs === null && duration > 0) {
            updateProgress();
            updateLoopVisuals();
        }
    } catch (error) {
        console.error('🚨 Error loading track:', error);
        showStatus('Failed to load track');
    }
}

async function togglePlayPause() {
    if (!spotifyPlayer) return;

    try {
        await spotifyPlayer.togglePlay();
    } catch (error) {
        console.error('Toggle play/pause error:', error);
    }
}

async function seekToPosition(positionMs) {
    if (!spotifyPlayer) return;

    try {
        isResuming = true;
        await spotifyPlayer.seek(positionMs);
    } catch (error) {
        console.error('Seek error:', error);
    }
}

async function playFromPosition(positionMs) {
    if (!spotifyAccessToken || !spotifyDeviceId || !currentTrack) return;

    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [currentTrack.uri],
                position_ms: positionMs
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
    } catch (error) {
        console.error('Play from position error:', error);
    }
}

function startProgressUpdates() {
    stopProgressUpdates();
    
    progressInterval = setInterval(async () => {
        if (!spotifyPlayer || !isPlaying) return;

        try {
            const state = await spotifyPlayer.getCurrentState();
            if (state && !state.paused) {
                currentTime = state.position / 1000;
                updateProgress();
                handleLoopCheck(currentTime);
                
                if (playlistEngine && isPlaylistMode) {
                    playlistEngine.handlePlaybackProgress(currentTime);
                }
            }
        } catch (error) {
            console.error('Progress update error:', error);
        }
    }, 100);
}

function stopProgressUpdates() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

function handleLoopCheck(position) {
    if (!isLooping || isPlaylistMode) return;

    if (position >= loopEnd - 0.1) {
        loopCounter++;
        
        if (loopCounter >= repeatCount) {
            loopCounter = 0;
            
            if (playlistEngine && playlistEngine.hasNext()) {
                playlistEngine.skipToNext();
                return;
            }
        }
        
        performLoop();
    }
}

async function performLoop() {
    if (!isLooping || !currentTrack) return;
    
    try {
        isResuming = true;
        await playFromPosition(loopStart * 1000);
    } catch (error) {
        console.error('Loop error:', error);
    }
}

// UI Update Functions
function updateProgress() {
    if (!duration) return;

    const percent = (currentTime / duration) * 100;
    els.progressBar.style.width = `${percent}%`;
    els.currentTime.textContent = formatTime(currentTime);
    els.duration.textContent = formatTime(duration);
}

function updateLoopVisuals() {
    if (!duration) return;

    const startPercent = (loopStart / duration) * 100;
    const endPercent = (loopEnd / duration) * 100;
    
    els.loopRegion.style.left = `${startPercent}%`;
    els.loopRegion.style.width = `${endPercent - startPercent}%`;
    
    els.loopStartHandle.style.left = `${startPercent}%`;
    els.loopEndHandle.style.left = `${endPercent}%`;
    
    els.startPopup.textContent = formatTime(loopStart);
    els.endPopup.textContent = formatTime(loopEnd);
}

function updatePlayPauseButton() {
    if (els.playPauseBtn) {
        els.playPauseBtn.innerHTML = isPlaying ? '⏸' : '▶';
    }
}

function updateConnectionStatus(connected) {
    const statusEl = els.connectionStatus;
    if (!statusEl) return;

    const statusDot = statusEl.querySelector('.status-dot');
    const statusText = statusEl.querySelector('span');
    const disconnectBtn = els.disconnectBtn;

    if (connected) {
        statusDot.style.background = '#1DB954';
        statusText.textContent = 'Connected';
        disconnectBtn.style.display = 'inline-block';
    } else {
        statusDot.style.background = '#666';
        statusText.textContent = 'Disconnected';
        disconnectBtn.style.display = 'none';
    }
}

function updateNowPlayingIndicator(track) {
    if (!track) return;

    const indicator = els.nowPlayingIndicator;
    if (indicator) {
        els.miniTrackTitle.textContent = track.name;
        els.miniTrackArtist.textContent = track.artist;
        indicator.classList.add('show');
        
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 5000);
    }
}

// Loop Management
async function startLoop() {
    if (!currentTrack) {
        showStatus('Please select a track first');
        return;
    }

    if (loopStart >= loopEnd) {
        showStatus('Invalid loop range');
        return;
    }

    loopCounter = 0;
    isLooping = true;
    els.loopToggle.checked = true;
    
    await seekToPosition(loopStart * 1000);
    
    if (!isPlaying) {
        await togglePlayPause();
    }
    
    showStatus(`🔄 Loop started: ${repeatCount}×`);
}

async function saveCurrentLoop() {
    if (!currentTrack) {
        showStatus('No track selected');
        return;
    }

    if (loopStart >= loopEnd) {
        showStatus('Invalid loop range');
        return;
    }

    const loop = {
        id: Date.now().toString(),
        trackUri: currentTrack.uri,
        trackName: currentTrack.name,
        trackArtist: currentTrack.artist,
        trackImage: currentTrack.image,
        trackDuration: currentTrack.duration,
        start: loopStart,
        end: loopEnd,
        duration: loopEnd - loopStart,
        playCount: repeatCount,
        created: new Date().toISOString(),
        plays: 0
    };

    savedLoops.unshift(loop);
    saveLoopsToStorage();
    renderLoopsList();
    showStatus('✅ Loop saved!');
}

async function loadLoop(loop) {
    showStatus('Loading loop...');

    currentTrack = {
        uri: loop.trackUri,
        name: loop.trackName,
        artist: loop.trackArtist,
        duration: loop.trackDuration,
        image: loop.trackImage || ''
    };

    duration = currentTrack.duration;
    loopStart = loop.start;
    loopEnd = loop.end;
    repeatCount = loop.playCount || 1;
    els.repeatValue.textContent = `${repeatCount}×`;

    els.currentTrack.textContent = loop.trackName;
    els.currentArtist.textContent = loop.trackArtist;

    updateLoopVisuals();
    updateProgress();

    await loadTrackIntoSpotify(currentTrack);
    
    loop.plays++;
    saveLoopsToStorage();
    
    showStatus(`✅ Loaded: ${loop.trackName}`);
    showView('player');
}

function deleteLoop(loopId) {
    if (!confirm('Delete this loop?')) return;

    savedLoops = savedLoops.filter(loop => loop.id !== loopId);
    saveLoopsToStorage();
    renderLoopsList();
    showStatus('🗑 Loop deleted');
}

function clearAllLoops() {
    if (!confirm('Delete ALL saved loops? This cannot be undone.')) return;

    savedLoops = [];
    saveLoopsToStorage();
    renderLoopsList();
    showStatus('🗑 All loops cleared');
}

function renderLoopsList() {
    const totalLoops = savedLoops.length;
    els.loopCountBadge.textContent = totalLoops > 0 ? totalLoops : '';
    els.loopCountBadge.style.display = totalLoops > 0 ? 'block' : 'none';

    if (savedLoops.length === 0) {
        els.loopsList.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">🎵</div>
                <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No saved loops yet</div>
                <div style="color: var(--light-gray); font-size: 13px;">Create loops from your favorite tracks</div>
            </div>
        `;
        return;
    }

    els.loopsList.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding: 0 4px;">
            <h3 style="color: var(--light); font-size: 16px; font-weight: 600;">Saved Loops (${totalLoops})</h3>
            <button class="clear-all-btn" id="clear-all-loops">Clear All</button>
        </div>
        ${savedLoops.map(loop => `
            <div class="loop-card">
                <div class="loop-info">
                    <div class="loop-track">${loop.trackName} - ${loop.trackArtist}</div>
                    <div class="loop-details">
                        <span class="loop-duration">
                            <span class="loop-icon">🔄</span>
                            ${formatTime(loop.start, false)} - ${formatTime(loop.end, false)} 
                            (${formatTime(loop.duration, false)})
                        </span>
                        <span class="loop-plays">${loop.plays || 0} plays</span>
                    </div>
                    <div class="loop-meta">
                        <span class="loop-repeat">${loop.playCount || 1}× repeat</span>
                        <span class="loop-date">${new Date(loop.created).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="loop-actions">
                    <button class="loop-action-btn play-loop-btn" onclick="loadLoop('${loop.id}')">▶</button>
                    <button class="loop-action-btn add-to-playlist-btn" onclick="addLoopToPlaylistPrompt('${loop.id}')">➕</button>
                    <button class="loop-action-btn danger delete-loop-btn" onclick="deleteLoop('${loop.id}')">🗑</button>
                </div>
            </div>
        `).join('')}
    `;
}

// Search Functions
async function searchTracks(query, isNewSearch = true) {
    if (!query || !spotifyAccessToken) return;

    if (isNewSearch) {
        searchState.currentOffset = 0;
        currentSearchResults = [];
    }

    try {
        showStatus('Searching...');
        
        const params = new URLSearchParams({
            q: query,
            type: 'track',
            market: 'US',
            limit: 10,
            offset: searchState.currentOffset
        });

        const response = await fetch(`https://api.spotify.com/v1/search?${params}`, {
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`
            }
        });

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        const tracks = data.tracks.items;
        
        if (isNewSearch) {
            currentSearchResults = tracks;
        } else {
            currentSearchResults = [...currentSearchResults, ...tracks];
        }
        
        searchState.totalTracks = data.tracks.total;
        searchState.hasMore = data.tracks.next !== null;
        searchState.query = query;

        displaySearchResults(currentSearchResults, searchState.hasMore);
        showStatus(`Found ${searchState.totalTracks} tracks`);
    } catch (error) {
        console.error('Search error:', error);
        showStatus('Search failed. Please try again.');
    }
}

async function loadMoreTracks() {
    if (!searchState.hasMore || !searchState.query) return;

    searchState.currentOffset += 10;
    showStatus('Loading more tracks...');
    await searchTracks(searchState.query, false);
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

        // Ensure loop visuals are properly initialized
        updateLoopVisuals();
        updateProgress();
        
        // Make sure the player view is shown
        showView('player');

    } catch (error) {
        console.error('🚨 Track selection error:', error);
        showStatus('Failed to select track');
    }
}

// Playlist Management - Enhanced with Smart Transitions
class PlaylistEngine {
    constructor(spotifyPlayer) {
        this.spotifyPlayer = spotifyPlayer;
        this.currentPlaylist = null;
        this.currentItemIndex = 0;
        this.currentLoopCount = 0;
        this.currentLoopTarget = 1;
        this.currentLoop = null;
        this.transitionInProgress = false;
        this.crossfadeInProgress = false;
        this.isLooping = false;
        this.loopStartTime = null;
        
        // Smart transition properties
        this.smartTransitionsEnabled = true;
        this.currentTransitionData = null;
        
        // Callbacks
        this.onItemChange = null;
        this.onPlaylistComplete = null;
        this.onLoopProgress = null;
        this.onSmartTransition = null;
    }

    // Play a playlist
    async playPlaylist(playlist) {
        if (!playlist || !playlist.items || playlist.items.length === 0) {
            console.error('Invalid playlist');
            return;
        }

        this.currentPlaylist = playlist;
        this.currentItemIndex = 0;
        this.currentLoopCount = 0;
        this.transitionInProgress = false;
        this.crossfadeInProgress = false;
        
        // Prepare smart transition for first->second item
        if (playlist.items.length > 1 && this.smartTransitionsEnabled) {
            await this.prepareSmartTransition(0, 1);
        }

        await this.loadPlaylistItem(0);
    }

    // Load a specific playlist item
    async loadPlaylistItem(itemIndex) {
        if (!this.currentPlaylist || itemIndex >= this.currentPlaylist.items.length) {
            return;
        }

        const item = this.currentPlaylist.items[itemIndex];
        this.currentItemIndex = itemIndex;
        this.currentLoopCount = 0;

        try {
            if (item.type === 'loop') {
                await this.loadLoopItem(item);
            } else {
                await this.loadTrackItem(item);
            }

            // Prepare next transition if available
            if (itemIndex + 1 < this.currentPlaylist.items.length && this.smartTransitionsEnabled) {
                await this.prepareSmartTransition(itemIndex, itemIndex + 1);
            }

        } catch (error) {
            console.error('🚨 Failed to load playlist item:', error);
            // Skip to next on error
            await this.skipToNext();
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

// Play playlist with enhanced engine
async function playPlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist || playlist.items.length === 0) {
        showStatus('Playlist is empty');
        return;
    }

    try {
        showStatus(`🎵 Playing playlist: ${playlist.name}`);
        
        // Initialize enhanced playlist engine
        if (!playlistEngine) {
            playlistEngine = new PlaylistEngine(spotifyPlayer);
            setupPlaylistEngineCallbacks();
        }

        // Update playlist play count
        playlist.playCount = (playlist.playCount || 0) + 1;
        savePlaylistsToStorage();

        // Switch to playlist mode
        isPlaylistMode = true;
        currentPlaylist = playlist;
        currentPlaylistIndex = 0;
        isLooping = false;
        els.loopToggle.checked = false;

        // Show playlist UI
        showPlaylistNowPlaying();
        showView('player');

        // Start playing
        await playlistEngine.playPlaylist(playlist);

    } catch (error) {
        console.error('🚨 Playlist playback error:', error);
        showStatus('Failed to play playlist');
        isPlaylistMode = false;
    }
}

function setupPlaylistEngineCallbacks() {
    // Item change callback
    playlistEngine.onItemChange = (item, index) => {
        updatePlaylistNowPlaying(item, index);
        
        if (item.type === 'loop') {
            loopStart = item.start;
            loopEnd = item.end;
            repeatCount = item.playCount || 1;
            isLooping = true;
            els.loopToggle.checked = true;
            els.repeatValue.textContent = `${repeatCount}×`;
            updateLoopVisuals();
        } else {
            isLooping = false;
            els.loopToggle.checked = false;
        }
    };

    // Loop progress callback
    playlistEngine.onLoopProgress = (currentLoop, targetLoop) => {
        console.log(`Loop progress: ${currentLoop}/${targetLoop}`);
    };

    // Playlist complete callback
    playlistEngine.onPlaylistComplete = () => {
        console.log('🏁 Playlist finished!');
        showStatus('Playlist finished!');
        stopPlaylistMode();
    };

    // Smart transition callback
    playlistEngine.onSmartTransition = (transitionData) => {
        const { transitionQuality, crossfadeDuration } = transitionData;
        console.log(`🎛️ Smart transition: ${transitionQuality.quality} (${crossfadeDuration}s)`);
    };
}

function stopPlaylistMode() {
    isPlaylistMode = false;
    currentPlaylist = null;
    currentPlaylistIndex = 0;

    if (playlistEngine) {
        playlistEngine.stop();
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
    const totalPlaylists = savedPlaylists.length;
    els.playlistCountBadge.textContent = totalPlaylists > 0 ? totalPlaylists : '';
    els.playlistCountBadge.style.display = totalPlaylists > 0 ? 'block' : 'none';

    if (savedPlaylists.length === 0) {
        els.playlistsList.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">🎵</div>
                <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No playlists yet</div>
                <div style="color: var(--light-gray); font-size: 13px;">Create playlists to mix loops and full tracks</div>
            </div>
        `;
        return;
    }

    els.playlistsList.innerHTML = savedPlaylists.map((playlist) => `
        <div class="playlist-card" data-playlist-id="${playlist.id}">
            <div class="playlist-header">
                <div class="playlist-icon">🎵</div>
                <div class="playlist-details">
                    <div class="playlist-name">${playlist.name}</div>
                    <div class="playlist-description">${playlist.description || `${playlist.items.length} items`}</div>
                </div>
            </div>

            <div class="playlist-stats">
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">🎵</span>
                    <span>${playlist.items.length} items</span>
                </div>
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">⏱</span>
                    <span>${formatTime(playlist.totalDuration, false)}</span>
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
    // Just close the editor - changes are saved automatically
    cancelPlaylistEdit(playlistId);
    showStatus('✅ Playlist updated!');
}

function deletePlaylist(playlistId) {
    if (!confirm('Delete this playlist?')) return;
    
    savedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
    savePlaylistsToStorage();
    renderPlaylistsList();
    showStatus('🗑 Playlist deleted');
}

async function sharePlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    const playlistData = {
        name: playlist.name,
        description: playlist.description,
        items: playlist.items.length,
        duration: formatTime(playlist.totalDuration, false),
        created: new Date().toLocaleDateString()
    };

    const shareText = `🎵 Check out my LOOOPZ playlist: "${playlist.name}"\n${playlist.items.length} items • ${playlistData.duration}`;
    const shareUrl = 'https://looopz.vercel.app';

    try {
        if (navigator.share && navigator.canShare && navigator.canShare({ text: shareText })) {
            await navigator.share({
                title: `LOOOPZ Playlist: ${playlist.name}`,
                text: shareText,
                url: shareUrl
            });
        } else {
            await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
            showStatus('📋 Playlist link copied!');
        }
    } catch (error) {
        showStatus('❌ Failed to share playlist');
    }
}

// Add Loop to Playlist
async function addLoopToPlaylistPrompt(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    pendingPlaylistItem = {
        type: 'loop',
        trackUri: loop.trackUri,
        trackName: loop.trackName,
        trackArtist: loop.trackArtist,
        trackImage: loop.trackImage,
        trackDuration: loop.trackDuration,
        start: loop.start,
        end: loop.end,
        duration: loop.duration,
        playCount: loop.playCount || 1,
        name: loop.trackName,
        artist: loop.trackArtist,
        image: loop.trackImage
    };

    showAddToPlaylistPopup();
}

// Current items to playlist
async function addCurrentToPlaylist() {
    if (!currentTrack) {
        showStatus('No track selected');
        return;
    }

    // Create playlist item based on current state
    if (isLooping && loopStart < loopEnd) {
        // Add as loop
        pendingPlaylistItem = {
            type: 'loop',
            trackUri: currentTrack.uri,
            trackName: currentTrack.name,
            trackArtist: currentTrack.artist,
            trackImage: currentTrack.image,
            trackDuration: currentTrack.duration,
            start: loopStart,
            end: loopEnd,
            duration: loopEnd - loopStart,
            playCount: repeatCount,
            name: currentTrack.name,
            artist: currentTrack.artist,
            image: currentTrack.image
        };
    } else {
        // Add as full track
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

function showAddToPlaylistPopup() {
    if (!pendingPlaylistItem) return;

    // Render playlist selection
    const html = savedPlaylists.map(playlist => `
        <div class="playlist-selection-item" data-playlist-id="${playlist.id}">
            <div class="playlist-selection-icon">🎵</div>
            <div class="playlist-selection-info">
                <div class="playlist-selection-name">${playlist.name}</div>
                <div class="playlist-selection-meta">${playlist.items.length} items</div>
            </div>
            <button class="playlist-selection-add" onclick="addToSelectedPlaylist('${playlist.id}')">Add</button>
        </div>
    `).join('');

    els.playlistSelectionList.innerHTML = html || '<div style="text-align: center; padding: 20px; color: var(--light-gray);">No playlists yet</div>';
    els.addToPlaylistPopup.classList.remove('hidden');
}

function hideAddToPlaylistPopup() {
    els.addToPlaylistPopup.classList.add('hidden');
    pendingPlaylistItem = null;
}

function addToSelectedPlaylist(playlistId) {
    if (!pendingPlaylistItem) return;

    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    // Add item to playlist
    playlist.items.push({ ...pendingPlaylistItem });
    
    // Update total duration
    const itemDuration = pendingPlaylistItem.type === 'loop' 
        ? (pendingPlaylistItem.duration * pendingPlaylistItem.playCount)
        : pendingPlaylistItem.duration;
    
    playlist.totalDuration = (playlist.totalDuration || 0) + itemDuration;

    savePlaylistsToStorage();
    hideAddToPlaylistPopup();
    showStatus(`✅ Added to ${playlist.name}`);

    // If we're in the playlists view, refresh it
    if (document.querySelector('#playlists-section:not(.hidden)')) {
        renderPlaylistsList();
    }
}

function showCreatePlaylistForm(withPendingItem = false) {
    if (withPendingItem && !pendingPlaylistItem) return;

    els.playlistFormTitle.textContent = 'Create Playlist';
    els.playlistNameInput.value = '';
    els.playlistDescriptionInput.value = '';
    els.playlistFormPopup.classList.remove('hidden');

    // Store pending item state
    els.playlistFormPopup.dataset.hasPendingItem = withPendingItem;
}

function hideCreatePlaylistForm() {
    els.playlistFormPopup.classList.add('hidden');
    delete els.playlistFormPopup.dataset.hasPendingItem;
}

async function saveNewPlaylist() {
    const name = els.playlistNameInput.value.trim();
    if (!name) {
        showStatus('Please enter a playlist name');
        return;
    }

    const playlist = {
        id: Date.now().toString(),
        name: name,
        description: els.playlistDescriptionInput.value.trim(),
        items: [],
        totalDuration: 0,
        created: new Date().toISOString(),
        playCount: 0
    };

    // If we have a pending item, add it
    const hasPendingItem = els.playlistFormPopup.dataset.hasPendingItem === 'true';
    if (hasPendingItem && pendingPlaylistItem) {
        playlist.items.push({ ...pendingPlaylistItem });
        
        const itemDuration = pendingPlaylistItem.type === 'loop' 
            ? (pendingPlaylistItem.duration * pendingPlaylistItem.playCount)
            : pendingPlaylistItem.duration;
        
        playlist.totalDuration = itemDuration;
    }

    savedPlaylists.unshift(playlist);
    savePlaylistsToStorage();
    renderPlaylistsList();
    hideCreatePlaylistForm();
    
    if (hasPendingItem) {
        hideAddToPlaylistPopup();
        showStatus(`✅ Created playlist "${name}" with 1 item`);
    } else {
        showStatus(`✅ Created playlist "${name}"`);
    }
}

// Drag and Drop for Playlist Items
function setupPlaylistDragAndDrop(playlistId) {
    const container = document.getElementById(`playlist-items-${playlistId}`);
    if (!container) return;

    let draggedElement = null;
    let draggedIndex = null;

    container.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('playlist-item')) {
            draggedElement = e.target;
            draggedIndex = parseInt(e.target.dataset.itemIndex);
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
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

    container.addEventListener('dragend', (e) => {
        if (draggedElement) {
            draggedElement.classList.remove('dragging');
            
            // Update the order in the actual playlist
            const playlist = savedPlaylists.find(p => p.id === playlistId);
            if (playlist) {
                const items = [...container.querySelectorAll('.playlist-item')];
                const newIndex = items.indexOf(draggedElement);
                
                if (draggedIndex !== newIndex) {
                    const [movedItem] = playlist.items.splice(draggedIndex, 1);
                    playlist.items.splice(newIndex, 0, movedItem);
                    savePlaylistsToStorage();
                    
                    // Re-render the items to update indices
                    container.innerHTML = renderPlaylistItems(playlist);
                    setupPlaylistDragAndDrop(playlistId);
                }
            }
            
            draggedElement = null;
            draggedIndex = null;
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
    if (!playlist || itemIndex < 0 || itemIndex >= playlist.items.length) return;

    if (!confirm('Remove this item from playlist?')) return;

    // Update total duration
    const removedItem = playlist.items[itemIndex];
    const itemDuration = removedItem.type === 'loop' 
        ? (removedItem.duration * removedItem.playCount)
        : removedItem.duration;
    
    playlist.totalDuration = Math.max(0, (playlist.totalDuration || 0) - itemDuration);

    playlist.items.splice(itemIndex, 1);
    savePlaylistsToStorage();
    renderPlaylistsList();
    showStatus('🗑 Item removed from playlist');
}

// Context Menu Functions
function showTrackContextMenu(trackIndex, buttonElement) {
    currentContextMenuTrackIndex = trackIndex;
    const menu = els.contextMenu;
    const overlay = els.contextMenuOverlay;

    // Position menu centered and above mobile nav
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
    showStatus('Select a playlist to add this track');
}

async function handleCreateLoopFromContext() {
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
        showView('search');
        return true;
    }
    throw new Error(data.error_description || 'Token exchange failed');
}

async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) {
        console.error('No refresh token available');
        return false;
    }

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: SPOTIFY_CLIENT_ID,
            }),
        });

        const data = await response.json();
        if (data.access_token) {
            spotifyAccessToken = data.access_token;
            localStorage.setItem('spotify_access_token', data.access_token);
            if (data.refresh_token) {
                localStorage.setItem('spotify_refresh_token', data.refresh_token);
            }
            return true;
        }
    } catch (error) {
        console.error('Token refresh failed:', error);
    }
    return false;
}

async function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
        try {
            await exchangeCodeForToken(code);
            return;
        } catch (error) {
            console.error('Auth error:', error);
            showStatus('Authentication failed: ' + error.message);
        }
    }

    spotifyAccessToken = localStorage.getItem('spotify_access_token');
    if (spotifyAccessToken) {
        try {
            const response = await fetch('https://api.spotify.com/v1/me', {
                headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
            });

            if (response.ok) {
                showView('search');
                initializeSpotifyPlayer();
                const data = await response.json();
                console.log('✅ Authenticated as:', data.display_name || data.email);
            } else if (response.status === 401) {
                const refreshed = await refreshAccessToken();
                if (refreshed) {
                    showView('search');
                    initializeSpotifyPlayer();
                } else {
                    throw new Error('Token refresh failed');
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            localStorage.removeItem('spotify_access_token');
            localStorage.removeItem('spotify_refresh_token');
            spotifyAccessToken = null;
            showView('login');
        }
    } else {
        showView('login');
    }
}

function disconnectSpotify() {
    if (!confirm('Disconnect from Spotify?')) return;

    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    spotifyAccessToken = null;

    if (spotifyPlayer) {
        spotifyPlayer.disconnect();
        spotifyPlayer = null;
    }

    spotifyDeviceId = null;
    isConnected = false;
    currentTrack = null;
    isPlaying = false;

    updateConnectionStatus(false);
    updatePlayPauseButton();
    showView('login');
    showStatus('Disconnected from Spotify');
}

// Helper Functions
function formatTime(seconds, showMillis = true) {
    if (isNaN(seconds) || seconds < 0) seconds = 0;
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    
    if (showMillis) {
        return `${mins}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
    } else {
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

function showStatus(message) {
    els.statusText.textContent = message;
    els.statusBar.classList.add('show');
    
    clearTimeout(window.statusTimeout);
    window.statusTimeout = setTimeout(() => {
        els.statusBar.classList.remove('show');
    }, 3000);
}

function showView(view) {
    document.querySelectorAll('.main-container > div').forEach(section => {
        section.classList.add('hidden');
    });

    const viewMap = {
        'login': 'login-screen',
        'search': 'search-section', 
        'player': 'player-section',
        'library': 'library-section',
        'playlists': 'playlists-section'
    };

    const sectionId = viewMap[view];
    if (sectionId) {
        document.getElementById(sectionId).classList.remove('hidden');
    }

    // Show/hide playlists section based on view
    els.playlistsSection.classList.toggle('hidden', view !== 'playlists');
    if (view === 'playlists') {
        renderPlaylistsList();
    }

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const navBtn = document.getElementById(`nav-${view}`);
    if (navBtn) navBtn.classList.add('active');

    // Load library if needed
    if (view === 'library') {
        loadSavedLoops();
        renderLoopsList();
    }
}

// Storage Functions
function saveLoopsToStorage() {
    try {
        localStorage.setItem('savedLoops', JSON.stringify(savedLoops));
    } catch (error) {
        console.error('Failed to save loops:', error);
        showStatus('Storage error - loops may not persist');
    }
}

function loadSavedLoops() {
    try {
        const stored = localStorage.getItem('savedLoops');
        if (stored) {
            savedLoops = JSON.parse(stored);
        }
    } catch (error) {
        console.error('Failed to load loops:', error);
        savedLoops = [];
    }
}

function savePlaylistsToStorage() {
    try {
        localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
    } catch (error) {
        console.error('Failed to save playlists:', error);
        showStatus('Storage error - playlists may not persist');
    }
}

function loadSavedPlaylists() {
    try {
        const stored = localStorage.getItem('savedPlaylists');
        if (stored) {
            savedPlaylists = JSON.parse(stored);
        }
    } catch (error) {
        console.error('Failed to load playlists:', error);
        savedPlaylists = [];
    }
}

// Precision Controls
function showPrecisionControls() {
    els.precisionStart.value = formatTime(loopStart);
    els.precisionEnd.value = formatTime(loopEnd);
    els.precisionPopup.classList.remove('hidden');
}

function hidePrecisionControls() {
    els.precisionPopup.classList.add('hidden');
}

function applyPrecisionTimes() {
    const startTime = parseTimeInput(els.precisionStart.value);
    const endTime = parseTimeInput(els.precisionEnd.value);

    if (startTime !== null && startTime >= 0 && startTime < duration) {
        loopStart = startTime;
    }

    if (endTime !== null && endTime > loopStart && endTime <= duration) {
        loopEnd = endTime;
    }

    updateLoopVisuals();
    hidePrecisionControls();
    showStatus('✅ Loop times updated');
}

function parseTimeInput(input) {
    const match = input.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
    if (!match) return null;

    const mins = parseInt(match[1]);
    const secs = parseInt(match[2]);
    const millis = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0;

    return mins * 60 + secs + millis / 1000;
}

function adjustLoopTime(target, amount) {
    if (target === 'start') {
        loopStart = Math.max(0, Math.min(loopStart + amount, loopEnd - 0.1));
        els.precisionStart.value = formatTime(loopStart);
    } else {
        loopEnd = Math.max(loopStart + 0.1, Math.min(loopEnd + amount, duration));
        els.precisionEnd.value = formatTime(loopEnd);
    }
    updateLoopVisuals();
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

    // Search functionality
    let searchTimeout;
    els.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();
        
        if (query.length > 2) {
            searchTimeout = setTimeout(() => {
                searchTracks(query);
            }, 300);
        } else if (query.length === 0) {
            currentSearchResults = [];
            els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">Search for tracks to start creating loops</div>';
        }
    });

    els.searchBackBtn.addEventListener('click', (e) => {
        e.preventDefault();
        goBackToMainSearch();
    });

    // Loop controls
    els.loopToggle.addEventListener('change', (e) => {
        isLooping = e.target.checked;
        if (!isLooping) {
            loopCounter = 0;
        }
    });

    // Repeat counter controls
    document.getElementById('repeat-decrease').addEventListener('click', () => {
        if (repeatCount > 1) {
            repeatCount--;
            els.repeatValue.textContent = `${repeatCount}×`;
        }
    });

    document.getElementById('repeat-increase').addEventListener('click', () => {
        if (repeatCount < 99) {
            repeatCount++;
            els.repeatValue.textContent = `${repeatCount}×`;
        }
    });

    // Progress bar click to seek
    els.progressContainer.addEventListener('click', (e) => {
        if (!duration || isDragging) return;
        
        const rect = els.progressContainer.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const seekTime = percent * duration;
        
        seekToPosition(seekTime * 1000);
    });

    // Precision controls
    els.precisionBtn.addEventListener('click', showPrecisionControls);
    els.precisionClose.addEventListener('click', hidePrecisionControls);

    // Fine tune buttons
    document.querySelectorAll('.fine-tune-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.dataset.target;
            const amount = parseFloat(e.target.dataset.amount);
            adjustLoopTime(target, amount);
        });
    });

    // Apply precision times on Enter
    [els.precisionStart, els.precisionEnd].forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                applyPrecisionTimes();
            }
        });
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

            // Loop controls
            else if (target.matches('#start-loop-btn')) {
                e.preventDefault();
                await startLoop();
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
                hideAddToPlaylistPopup();
                showCreatePlaylistForm(true);
            }

            // Playlist form
            else if (target.matches('#playlist-form-save')) {
                e.preventDefault();
                await saveNewPlaylist();
            }
            else if (target.matches('#playlist-form-cancel')) {
                e.preventDefault();
                hideCreatePlaylistForm();
            }

            // Context menu items
            else if (target.matches('.context-menu-item') || target.closest('.context-menu-item')) {
                e.preventDefault();
                const item = target.closest('.context-menu-item');
                const action = item.querySelector('.context-menu-text').textContent;

                if (action.includes('Discover')) await handleDiscoverMoments();
                else if (action.includes('Add to Playlist')) await handleCreateLoopFromContext();
                else if (action.includes('Create Loop')) await handleCreateLoop();
                else if (action.includes('Share')) await handleShare();
                else if (action.includes('Listen in Spotify')) await handleListenInSpotify();
            }

            // Context menu overlay
            else if (target.matches('#context-menu-overlay')) {
                hideTrackContextMenu();
            }

            // Load more tracks
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

        } catch (error) {
            console.error('Event handler error:', error);
            showStatus('Something went wrong. Please try again.');
        }
    });
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
window.loadLoop = loadLoop;
window.deleteLoop = deleteLoop;
window.addLoopToPlaylistPrompt = addLoopToPlaylistPrompt;
window.addToSelectedPlaylist = addToSelectedPlaylist;
window.removeFromPlaylist = removeFromPlaylist;
window.savePlaylistEdits = savePlaylistEdits;
window.cancelPlaylistEdit = cancelPlaylistEdit;

// Initialize the app
function init() {
    console.log('🎵 Initializing LOOOPZ...');

    // Cache DOM elements
    els = {
        statusBar: document.getElementById('status-bar'),
        statusText: document.getElementById('status-text'),
        connectionStatus: document.getElementById('connection-status'),
        disconnectBtn: document.getElementById('disconnect-btn'),
        nowPlayingIndicator: document.getElementById('now-playing-indicator'),
        miniTrackTitle: document.getElementById('mini-track-title'),
        miniTrackArtist: document.getElementById('mini-track-artist'),
        connectBtn: document.getElementById('connect-btn'),
        searchSection: document.getElementById('search-section'),
        searchInput: document.getElementById('search-input'),
        searchResults: document.getElementById('search-results'),
        searchBackBtn: document.getElementById('search-back-btn'),
        playerSection: document.getElementById('player-section'),
        librarySection: document.getElementById('library-section'),
        playlistsSection: document.getElementById('playlists-section'),
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
