// LOOOPZ - Enhanced Spotify Track Looper
// State Variables
let spotifyPlayer = null;
let accessToken = null;
let deviceId = null;
let isConnected = false;
let retryCount = 0;
let syncCheckInterval = null;
let updateTimer = null;
let lastLoopSeek = 0;

// Track State
let currentTrack = null;
let currentTime = 0;
let duration = 0;
let isPlaying = false;

// Loop State - UNIFIED SYSTEM
let loopEnabled = false;
let loopStart = 0;
let loopEnd = 30;
let loopTarget = 1;
let loopCount = 0;
let isLooping = false;

// Views
let currentView = 'login';
let searchState = {
    query: '',
    currentOffset: 0,
    totalTracks: 0,
    hasMore: false,
    isSecondLevel: false,
    currentLevel: 'tracks',
    currentEntity: null
};

// Storage
let savedLoops = [];
let savedPlaylists = [];
let currentSearchResults = [];
let currentEditingLoopId = null;
let currentEditingPlaylistId = null;
let currentContextMenuTrackIndex = null;
let pendingPlaylistItem = null;

// Playlist Mode
let isPlaylistMode = false;
let currentPlaylist = null;
let currentPlaylistIndex = 0;
let playlistEngine = null;

// DOM Elements
let els = {};

// Format time helper
function formatTime(seconds, includeMs = true) {
    if (!seconds || seconds < 0) return includeMs ? '0:00.000' : '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    
    if (includeMs) {
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Parse time input helper
function parseTimeInput(str) {
    if (!str) return 0;
    const parts = str.split(':');
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

    // FIX 6: Show/hide loop handles based on loop state
    const handleVisibility = loopEnabled ? 'visible' : 'hidden';
    els.loopStartHandle.style.visibility = handleVisibility;
    els.loopEndHandle.style.visibility = handleVisibility;
    els.loopRegion.style.visibility = handleVisibility;
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
        trackId: track.id,
        name: track.name,
        artist: track.artists[0].name,
        image: track.album.images[0]?.url,
        duration: track.duration_ms / 1000,
        playCount: 1
    };

    showAddToPlaylistPopup();
}

async function handlePlayInBackground() {
    const track = getCurrentContextTrack();
    if (!track) return;

    hideTrackContextMenu();
    await playTrackInBackground(track);
}

// Spotify SDK Initialization
function initializeSpotifySDK() {
    console.log('🎵 Initializing Spotify SDK...');

    window.onSpotifyWebPlaybackSDKReady = () => {
        console.log('🎵 Spotify SDK ready!');

        spotifyPlayer = new Spotify.Player({
            name: 'LOOOPZ Player',
            getOAuthToken: cb => cb(accessToken),
            volume: 1.0
        });

        spotifyPlayer.addListener('ready', ({ device_id }) => {
            console.log('✅ Player ready with Device ID:', device_id);
            deviceId = device_id;
            isConnected = true;
            updateConnectionStatus();
            showStatus('Connected to Spotify!');

            if (playlistEngine) {
                playlistEngine.player = spotifyPlayer;
                playlistEngine.deviceId = deviceId;
            }
        });

        spotifyPlayer.addListener('not_ready', ({ device_id }) => {
            console.log('⚠️ Device has gone offline:', device_id);
            isConnected = false;
            updateConnectionStatus();
        });

        spotifyPlayer.addListener('player_state_changed', (state) => {
            if (!state) return;

            const track = state.track_window.current_track;
            if (track) {
                currentTime = state.position / 1000;
                duration = state.duration / 1000;
                isPlaying = !state.paused;

                updateProgress();
                updatePlayPauseButton();
                updateNowPlayingIndicator(currentTrack);

                // FIX 3: More precise loop detection (0.05 second buffer)
                if (loopEnabled && !isLooping && loopCount < loopTarget && !isPlaylistMode) {
                    if (currentTime >= loopEnd - 0.05) {
                        handleLoopEnd();
                    }
                }
            }
        });

        spotifyPlayer.connect();
    };

    if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
}

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
            els.loopToggle.checked = true;
            updateRepeatDisplay();
            updateLoopVisuals();
        } else {
            loopEnabled = false;
            els.loopToggle.checked = false;
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
}

// FIX 7: Enhanced progress update frequency (50ms)
function startProgressUpdates() {
    stopProgressUpdates();
    updateTimer = setInterval(async () => {
        if (isPlaying && spotifyPlayer && !isLooping) {
            try {
                const state = await spotifyPlayer.getCurrentState();
                if (state && state.position !== undefined) {
                    currentTime = state.position / 1000;
                    updateProgress();
                    
                    // FIX 9: Unified loop end handling
                    if (loopEnabled && currentTime >= loopEnd - 0.05 && loopCount < loopTarget && !isPlaylistMode) {
                        handleLoopEnd();
                    }
                }
            } catch (error) {
                console.warn('State check failed:', error.message);
            }
        }
    }, 50); // FIX 7: Changed from 100ms to 50ms
}

function stopProgressUpdates() {
    if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
    }
}

// FIX 4: Debouncing for rapid seek prevention
async function handleLoopEnd() {
    // Prevent rapid seeks with debouncing
    const now = Date.now();
    if (now - lastLoopSeek < 500) return; // 500ms debounce
    lastLoopSeek = now;

    try {
        isLooping = true;
        loopCount++;

        if (loopCount >= loopTarget) {
            await togglePlayPause();
            showStatus(`Loop completed! (${loopTarget}×)`);
            loopCount = 0;
            isLooping = false;
        } else {
            await seekToPosition(loopStart * 1000);
            showStatus(`Loop ${loopCount}/${loopTarget}`);
            setTimeout(() => { isLooping = false; }, 200);
        }
    } catch (error) {
        console.error('Loop end error:', error);
        isLooping = false;
    }
}

// Audio Controls
async function togglePlayPause() {
    if (!spotifyPlayer) {
        showStatus('Not connected to Spotify');
        return;
    }

    try {
        if (isPlaying) {
            await spotifyPlayer.pause();
            showStatus('Paused');
        } else {
            await spotifyPlayer.resume();
            showStatus('Playing');
        }
    } catch (error) {
        console.error('Toggle play/pause error:', error);
        showStatus('Playback error');
    }
}

async function seekBackward() {
    await seekToPosition(Math.max(0, currentTime - 10) * 1000);
}

async function seekForward() {
    await seekToPosition(Math.min(duration, currentTime + 10) * 1000);
}

async function seekToPosition(positionMs) {
    if (!spotifyPlayer) return;

    try {
        await spotifyPlayer.seek(positionMs);
        currentTime = positionMs / 1000;
        updateProgress();
    } catch (error) {
        console.error('Seek error:', error);
    }
}

async function playFromPosition(positionMs) {
    try {
        await seekToPosition(positionMs);
        if (!isPlaying) {
            await togglePlayPause();
        }
    } catch (error) {
        console.error('Play from position error:', error);
    }
}

// FIX 2: Renamed from startLoop to setLoop - only sets loop points
async function setLoop() {
    if (!currentTrack || !loopEnabled) {
        showStatus('Please select a track and enable loop mode');
        return;
    }
    
    // Only set loop counts, don't seek
    loopCount = 0;
    showStatus(`Loop set: ${formatTime(loopStart)} - ${formatTime(loopEnd)} (${loopTarget}×)`);
}

// Track Loading
async function loadTrackIntoSpotify(track, startPositionMs = 0) {
    if (!spotifyPlayer || !deviceId) {
        showStatus('Player not ready');
        return;
    }

    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [track.uri],
                position_ms: startPositionMs
            })
        });

        if (!response.ok) throw new Error('Failed to play track');

        await new Promise(resolve => setTimeout(resolve, 300));

        duration = track.duration;
        isPlaying = true;
        updatePlayPauseButton();
        updateNowPlayingIndicator(track);
        startProgressUpdates();
        console.log('✅ Track loaded successfully');

    } catch (error) {
        console.error('Load track error:', error);
        showStatus('Failed to load track');
        throw error;
    }
}

// Track Selection
async function selectTrack(uri) {
    try {
        let track = currentSearchResults.find(t => t.uri === uri);
        
        if (!track) {
            console.error('Track not found in search results');
            return;
        }

        const { name, artists, album, duration_ms } = track;
        
        currentTrack = {
            uri,
            name,
            artist: artists[0].name,
            image: album.images[0]?.url,
            duration: duration_ms / 1000
        };

        els.currentTrack.textContent = name;
        els.currentArtist.textContent = artists[0].name;
        els.albumCover.src = album.images[0]?.url || '';
        els.albumCover.style.display = album.images[0]?.url ? 'block' : 'none';

        duration = duration_ms / 1000;

        // Check for seamless transition
        let seamlessTransition = false;
        let preservedPosition = 0;

        if (currentTrack && currentTrack.uri === uri && isPlaying) {
            seamlessTransition = true;
            preservedPosition = currentTime * 1000;
            console.log('🎵 Same track - seamless transition mode');
        }

        // MODIFIED TRACK LOADING - Use preserved position for seamless transitions
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

        // LOOP HANDLE ADJUSTMENT - Position intelligently around current time
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

    const navButtons = [els.navSearch, els.navPlayer, els.navLibrary, els.navPlaylists];
    navButtons.forEach(btn => btn?.classList.remove('active'));

    if (view === 'search') els.navSearch?.classList.add('active');
    if (view === 'player') els.navPlayer?.classList.add('active');
    if (view === 'library') els.navLibrary?.classList.add('active');
    if (view === 'playlists') els.navPlaylists?.classList.add('active');

    updateNowPlayingIndicator(isPlaying ? currentTrack : null);

    if (view === 'library') renderLoopsList();
    if (view === 'playlists') renderPlaylistsList();
}

// Spotify Authentication
function checkForSharedLoop() {
    const urlParams = new URLSearchParams(window.location.search);
    const sharedData = urlParams.get('loop');
    
    if (sharedData) {
        try {
            const decoded = atob(sharedData);
            const loopData = JSON.parse(decoded);
            
            console.log('🔗 Found shared loop:', loopData);
            sessionStorage.setItem('pending_shared_loop', JSON.stringify(loopData));
            
            return true;
        } catch (error) {
            console.error('Failed to parse shared loop:', error);
        }
    }
    
    return false;
}

async function handleSharedLoop() {
    const pendingData = sessionStorage.getItem('pending_shared_loop');
    if (!pendingData) return;

    try {
        const loopData = JSON.parse(pendingData);
        console.log('📥 Loading shared loop:', loopData);

        showStatus('🔄 Loading shared loop...');

        const choice = await showSharedLoopDialog(loopData);
        
        if (choice === 'load') {
            currentTrack = loopData.track;
            loopStart = loopData.loop.start;
            loopEnd = loopData.loop.end;
            loopTarget = loopData.loop.repeat;
            loopEnabled = true;

            await selectTrack(loopData.track.uri);

            showStatus(`✅ Loaded loop: ${loopData.track.name}`);
        }

        sessionStorage.removeItem('pending_shared_loop');
        cleanupSharedUrl();

    } catch (error) {
        console.error('Failed to handle shared loop:', error);
        showStatus('Failed to load shared loop');
    }
}

async function showSharedLoopDialog(loopData) {
    return new Promise((resolve) => {
        const dialog = document.createElement('div');
        dialog.className = 'shared-loop-dialog';
        dialog.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; 
                        background: rgba(0,0,0,0.8); display: flex; align-items: center; 
                        justify-content: center; z-index: 1000;">
                <div style="background: #282828; padding: 24px; border-radius: 12px; 
                            max-width: 400px; text-align: center;">
                    <h3 style="color: #1DB954; margin-bottom: 16px;">🎵 Shared Loop</h3>
                    <p style="color: white; margin-bottom: 8px;">
                        <strong>${loopData.track.name}</strong> by ${loopData.track.artist}
                    </p>
                    <p style="color: #999; margin-bottom: 16px;">
                        Loop: ${formatTime(loopData.loop.start)} - ${formatTime(loopData.loop.end)} 
                        (${loopData.loop.repeat}×)
                    </p>
                    <button id="load-btn" style="background: #1DB954; color: white; 
                            border: none; padding: 12px 24px; border-radius: 24px; 
                            margin: 8px; cursor: pointer;">
                        🎧 Load Loop
                    </button>
                    <button id="cancel-btn" style="background: #444; color: white; 
                            border: none; padding: 12px 24px; border-radius: 24px; 
                            margin: 8px; cursor: pointer;">
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
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const storedToken = localStorage.getItem('spotify_access_token');

    if (code) {
        console.log('🔐 Found auth code, exchanging for token...');
        handleCallback(code);
    } else if (storedToken) {
        console.log('✅ Found stored token');
        accessToken = storedToken;
        showView('search');
        initializeSpotifySDK();
        loadSpotifyScript();
        
        if (hasSharedLoop) {
            setTimeout(handleSharedLoop, 1000);
        }
    } else {
        console.log('❌ No auth found');
        showView('login');
    }
}

function login() {
    const clientId = '46637d8f5adb41c0a4be34e0df0c1597';
    const redirectUri = window.location.origin + window.location.pathname;
    const scopes = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-read-playback-state',
        'user-modify-playback-state'
    ];

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        show_dialog: true
    });

    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleCallback(code) {
    console.log('🔄 Handling auth callback...');
    
    try {
        const response = await fetch('https://looopz-auth.onrender.com/callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                redirect_uri: window.location.origin + window.location.pathname
            })
        });

        if (!response.ok) throw new Error('Token exchange failed');

        const data = await response.json();
        
        localStorage.setItem('spotify_access_token', data.access_token);
        if (data.refresh_token) {
            localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
        
        accessToken = data.access_token;

        window.history.replaceState({}, document.title, window.location.pathname);

        showView('search');
        initializeSpotifySDK();
        loadSpotifyScript();
        showStatus('✅ Successfully connected!');

        const hasSharedLoop = sessionStorage.getItem('pending_shared_loop');
        if (hasSharedLoop) {
            setTimeout(handleSharedLoop, 1000);
        }

    } catch (error) {
        console.error('🚨 Auth error:', error);
        showStatus('Authentication failed. Please try again.');
        showView('login');
    }
}

async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) {
        console.error('No refresh token available');
        logout();
        return null;
    }

    try {
        const response = await fetch('https://looopz-auth.onrender.com/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        if (!response.ok) throw new Error('Token refresh failed');

        const data = await response.json();
        localStorage.setItem('spotify_access_token', data.access_token);
        accessToken = data.access_token;
        
        console.log('✅ Token refreshed successfully');
        return data.access_token;

    } catch (error) {
        console.error('🚨 Token refresh error:', error);
        logout();
        return null;
    }
}

function logout() {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    sessionStorage.clear();
    if (spotifyPlayer) {
        spotifyPlayer.disconnect();
    }
    showView('login');
    showStatus('Logged out');
}

function loadSpotifyScript() {
    if (document.querySelector('script[src="https://sdk.scdn.co/spotify-player.js"]')) {
        console.log('✅ Spotify SDK script already loaded');
        return;
    }

    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.onerror = () => {
        console.error('Failed to load Spotify SDK');
        showStatus('Failed to load Spotify player');
    };
    document.body.appendChild(script);
    console.log('📦 Loading Spotify SDK script...');
}

// Search Functions
async function searchTracks(query) {
    if (!query || query.trim().length === 0) {
        els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">Search for tracks to start creating loops</div>';
        return;
    }

    searchState.query = query;

    try {
        let searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=${searchState.currentOffset}`;

        const response = await fetch(searchUrl, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (response.status === 401) {
            const newToken = await refreshAccessToken();
            if (newToken) {
                return searchTracks(query);
            }
            return;
        }

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();

        if (searchState.currentOffset === 0) {
            currentSearchResults = data.tracks.items;
        } else {
            currentSearchResults = [...currentSearchResults, ...data.tracks.items];
        }

        searchState.totalTracks = data.tracks.total;
        searchState.hasMore = data.tracks.next !== null;

        displaySearchResults(currentSearchResults, searchState.hasMore);

    } catch (error) {
        console.error('Search error:', error);
        els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--danger);">Search failed. Please try again.</div>';
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
        const trackIndex = currentSearchResults.findIndex(t => t.uri === uri);
        if (trackIndex !== -1) {
            const trackElement = document.querySelector(`.track-item[data-track-index="${trackIndex}"]`);
            if (trackElement) {
                trackElement.classList.add(isPlaying ? 'playing' : 'selected');
            }
        }
    }
}

async function playTrackInBackground(track) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [track.uri]
            })
        });

        if (!response.ok) throw new Error('Failed to play track');

        currentTrack = {
            uri: track.uri,
            name: track.name,
            artist: track.artists[0].name,
            image: track.album.images[0]?.url,
            duration: track.duration_ms / 1000
        };

        duration = track.duration_ms / 1000;
        isPlaying = true;
        
        updateSearchTrackHighlighting(track.uri, true);
        updateNowPlayingIndicator(currentTrack);
        showStatus(`Playing: ${track.name}`);
        
        startProgressUpdates();

    } catch (error) {
        console.error('Play track error:', error);
        showStatus('Failed to play track');
    }
}

// Loop Handles Setup
function setupLoopHandles() {
    let isDragging = false;
    let dragTarget = null;

    function startDrag(e, handle) {
        isDragging = true;
        dragTarget = handle;
        handle.classList.add('dragging');
        const popup = handle.querySelector('.time-popup');
        if (popup) popup.classList.add('show');
        if (e && e.preventDefault) e.preventDefault();
    }

    function updateDrag(e) {
        if (!isDragging || !dragTarget) return;

        const rect = els.progressContainer.getBoundingClientRect();
        const clientX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
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
        console.error('Error loading saved loops:', error);
        savedLoops = [];
    }
}

function saveLooopsToStorage() {
    try {
        localStorage.setItem('looopz_saved_loops', JSON.stringify(savedLoops));
        updateLoopCountBadge();
    } catch (error) {
        console.error('Error saving loops:', error);
        showStatus('Failed to save loops');
    }
}

function saveCurrentLoop() {
    if (!currentTrack) {
        showStatus('No track selected');
        return;
    }

    const loop = {
        id: Date.now().toString(),
        track: currentTrack,
        loop: {
            start: loopStart,
            end: loopEnd,
            repeat: loopTarget
        },
        savedAt: new Date().toISOString()
    };

    savedLoops.unshift(loop);
    saveLooopsToStorage();

    const saveBtn = els.saveLoopBtn;
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '✅ Saved!';
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
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">📦</div>
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
                        <input type="number" class="edit-input" id="edit-repeat-${loop.id}" value="${loop.loop.repeat}" min="1" max="99">
                    </div>
                </div>
                <div class="edit-actions">
                    <button class="edit-action-btn save" onclick="saveLoopEdits('${loop.id}')">Save</button>
                    <button class="edit-action-btn cancel" onclick="cancelEdit('${loop.id}')">Cancel</button>
                </div>
            </div>
        </div>
    `).join('');
}

async function loadSavedLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    try {
        currentTrack = loop.track;
        loopStart = loop.loop.start;
        loopEnd = loop.loop.end;
        loopTarget = loop.loop.repeat;
        loopEnabled = true;
        loopCount = 0;

        els.currentTrack.textContent = loop.track.name;
        els.currentArtist.textContent = loop.track.artist;
        els.albumCover.src = loop.track.image || '';
        els.albumCover.style.display = loop.track.image ? 'block' : 'none';
        els.loopToggle.checked = true;

        duration = loop.track.duration;
        updateLoopVisuals();
        updateRepeatDisplay();

        await loadTrackIntoSpotify(loop.track, loop.loop.start * 1000);

        isPlaying = true;
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

    const index = savedLoops.findIndex(l => l.id === loopId);
    if (index !== -1) {
        savedLoops.splice(index, 1);
        saveLooopsToStorage();
        renderLoopsList();
        showStatus('Loop deleted');
    }
}

function shareLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    const shareData = {
        track: loop.track,
        loop: loop.loop
    };

    const encoded = btoa(JSON.stringify(shareData));
    const shareUrl = `${window.location.origin}${window.location.pathname}?loop=${encoded}`;

    navigator.clipboard.writeText(shareUrl).then(() => {
        showStatus('🔗 Share link copied!');
    }).catch(() => {
        prompt('Copy this link to share:', shareUrl);
    });
}

// Playlist Management
function loadSavedPlaylists() {
    try {
        const saved = localStorage.getItem('looopz_playlists');
        savedPlaylists = saved ? JSON.parse(saved) : [];
        updatePlaylistCountBadge();
    } catch (error) {
        console.error('Error loading playlists:', error);
        savedPlaylists = [];
    }
}

function savePlaylistsToStorage() {
    try {
        localStorage.setItem('looopz_playlists', JSON.stringify(savedPlaylists));
        updatePlaylistCountBadge();
    } catch (error) {
        console.error('Error saving playlists:', error);
        showStatus('Failed to save playlists');
    }
}

function createPlaylist(name, description = '') {
    const playlist = {
        id: Date.now().toString(),
        name,
        description,
        items: [],
        createdAt: new Date().toISOString(),
        lastModified: new Date().toISOString()
    };

    savedPlaylists.unshift(playlist);
    savePlaylistsToStorage();
    renderPlaylistsList();
    showStatus(`✅ Created playlist: ${name}`);
    return playlist;
}

function deletePlaylist(playlistId) {
    if (!confirm('Delete this playlist?')) return;

    const index = savedPlaylists.findIndex(p => p.id === playlistId);
    if (index !== -1) {
        savedPlaylists.splice(index, 1);
        savePlaylistsToStorage();
        renderPlaylistsList();
        showStatus('Playlist deleted');
    }
}

function addItemToPlaylist(playlistId, item) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    playlist.items.push(item);
    playlist.lastModified = new Date().toISOString();
    savePlaylistsToStorage();
    showStatus(`✅ Added to ${playlist.name}`);
}

function removeItemFromPlaylist(playlistId, itemIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    playlist.items.splice(itemIndex, 1);
    playlist.lastModified = new Date().toISOString();
    savePlaylistsToStorage();
}

function reorderPlaylistItems(playlistId, fromIndex, toIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;

    const [item] = playlist.items.splice(fromIndex, 1);
    playlist.items.splice(toIndex, 0, item);
    playlist.lastModified = new Date().toISOString();
    savePlaylistsToStorage();
}

// Playlist Engine
class PlaylistEngine {
    constructor() {
        this.player = null;
        this.deviceId = null;
        this.accessToken = null;
        this.isPlaying = false;
        this.currentPlaylist = null;
        this.currentIndex = 0;
        this.currentItem = null;
        this.loopCount = 0;
        this.itemStartTime = 0;
        this.checkInterval = null;
        
        // Callbacks
        this.onItemChange = null;
        this.onLoopProgress = null;
        this.onPlaylistComplete = null;
    }

    async startPlaylist(playlist, startIndex = 0) {
        if (!playlist || !playlist.items || playlist.items.length === 0) {
            console.error('Invalid playlist');
            return;
        }

        this.currentPlaylist = playlist;
        this.currentIndex = startIndex;
        this.isPlaying = true;

        await this.playCurrentItem();
    }

    async playCurrentItem() {
        if (!this.currentPlaylist || this.currentIndex >= this.currentPlaylist.items.length) {
            this.handlePlaylistComplete();
            return;
        }

        this.currentItem = this.currentPlaylist.items[this.currentIndex];
        this.loopCount = 0;
        this.itemStartTime = Date.now();

        if (this.onItemChange) {
            this.onItemChange(this.currentItem, this.currentIndex);
        }

        if (this.currentItem.type === 'loop') {
            await this.playLoop();
        } else {
            await this.playFullTrack();
        }
    }

    async playLoop() {
        const { uri, start, end, playCount } = this.currentItem;
        
        try {
            await this.playTrack(uri, start * 1000);
            this.startLoopChecking(start, end, playCount);
        } catch (error) {
            console.error('Failed to play loop:', error);
            this.nextItem();
        }
    }

    async playFullTrack() {
        const { uri, playCount } = this.currentItem;
        
        try {
            await this.playTrack(uri, 0);
            this.startTrackChecking(playCount);
        } catch (error) {
            console.error('Failed to play track:', error);
            this.nextItem();
        }
    }

    async playTrack(uri, positionMs) {
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${this.deviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                uris: [uri],
                position_ms: positionMs
            })
        });

        if (!response.ok) throw new Error('Failed to play track');
    }

    startLoopChecking(start, end, targetCount) {
        if (this.checkInterval) clearInterval(this.checkInterval);

        this.checkInterval = setInterval(async () => {
            if (!this.isPlaying) {
                clearInterval(this.checkInterval);
                return;
            }

            try {
                const state = await this.player.getCurrentState();
                if (!state) return;

                const position = state.position / 1000;

                // FIX 1 & 3: Precise loop detection
                if (position >= end - 0.05) {
                    this.loopCount++;

                    if (this.onLoopProgress) {
                        this.onLoopProgress(this.loopCount, targetCount);
                    }

                    if (this.loopCount >= targetCount) {
                        clearInterval(this.checkInterval);
                        this.nextItem();
                    } else {
                        await this.player.seek(start * 1000);
                    }
                }
            } catch (error) {
                console.error('Loop check error:', error);
            }
        }, 50); // FIX 7: Enhanced update frequency
    }

    startTrackChecking(targetCount) {
        if (this.checkInterval) clearInterval(this.checkInterval);

        let previousPosition = 0;
        let playCount = 1;

        this.checkInterval = setInterval(async () => {
            if (!this.isPlaying) {
                clearInterval(this.checkInterval);
                return;
            }

            try {
                const state = await this.player.getCurrentState();
                if (!state) return;

                const position = state.position / 1000;
                const duration = state.duration / 1000;

                // Track restart detection
                if (position < previousPosition - 5) {
                    playCount++;
                    if (this.onLoopProgress) {
                        this.onLoopProgress(playCount, targetCount);
                    }
                }

                previousPosition = position;

                // Track end detection
                if (position >= duration - 0.5) {
                    if (playCount >= targetCount) {
                        clearInterval(this.checkInterval);
                        this.nextItem();
                    } else {
                        await this.player.seek(0);
                        playCount++;
                        if (this.onLoopProgress) {
                            this.onLoopProgress(playCount, targetCount);
                        }
                    }
                }
            } catch (error) {
                console.error('Track check error:', error);
            }
        }, 50); // FIX 7: Enhanced update frequency
    }

    nextItem() {
        this.currentIndex++;
        this.playCurrentItem();
    }

    stopPlaylist() {
        this.isPlaying = false;
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.currentPlaylist = null;
        this.currentIndex = 0;
        this.currentItem = null;
    }

    handlePlaylistComplete() {
        this.stopPlaylist();
        if (this.onPlaylistComplete) {
            this.onPlaylistComplete();
        }
    }
}

// Initialize playlist engine
playlistEngine = new PlaylistEngine();

// Playlist Mode Functions
async function playPlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist || !playlist.items || playlist.items.length === 0) {
        showStatus('Playlist is empty');
        return;
    }

    try {
        isPlaylistMode = true;
        currentPlaylist = playlist;
        currentPlaylistIndex = 0;

        // Setup playlist engine
        playlistEngine.player = spotifyPlayer;
        playlistEngine.deviceId = deviceId;
        playlistEngine.accessToken = accessToken;
        
        setupPlaylistEngineCallbacks();
        
        showView('player');
        showPlaylistNowPlaying();
        
        await playlistEngine.startPlaylist(playlist);
        
        showStatus(`▶ Playing playlist: ${playlist.name}`);
        
    } catch (error) {
        console.error('Failed to play playlist:', error);
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
                <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.4;">🎵</div>
                <div style="color: var(--light-gray); font-size: 16px; margin-bottom: 8px;">No playlists yet</div>
                <div style="color: var(--light-gray); font-size: 13px;">Create playlists to organize your loops and tracks</div>
            </div>
        `;
        return;
    }

    els.playlistsList.innerHTML = savedPlaylists.map(playlist => `
        <div class="playlist-card" data-playlist-id="${playlist.id}">
            <div class="playlist-header">
                <div class="playlist-icon">🎵</div>
                <div class="playlist-info">
                    <div class="playlist-name">${playlist.name}</div>
                    <div class="playlist-description">${playlist.description || 'No description'}</div>
                </div>
            </div>

            <div class="playlist-stats">
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">📀</span>
                    <span>${playlist.items.length} items</span>
                </div>
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">⏱</span>
                    <span>${calculatePlaylistDuration(playlist)}</span>
                </div>
                <div class="playlist-stat">
                    <span class="playlist-stat-icon">📅</span>
                    <span>${new Date(playlist.createdAt).toLocaleDateString()}</span>
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
                <div class="playlist-editor-actions">
                    <button class="btn secondary" onclick="hidePlaylistEditor('${playlist.id}')">Done</button>
                </div>
            </div>
        </div>
    `).join('');
}

function renderPlaylistItems(playlist) {
    if (playlist.items.length === 0) {
        return '<div style="padding: 20px; text-align: center; color: var(--light-gray);">No items in playlist</div>';
    }

    return playlist.items.map((item, index) => `
        <div class="playlist-item" draggable="true" data-item-index="${index}">
            <div class="playlist-item-handle">≡</div>
            <div class="playlist-item-info">
                <div class="playlist-item-name">${item.name} - ${item.artist}</div>
                <div class="playlist-item-type">
                    ${item.type === 'loop' ? 
                        `Loop: ${formatTime(item.start)} - ${formatTime(item.end)}` : 
                        'Full Track'}
                </div>
            </div>
            <div class="playlist-item-repeat">${item.playCount}×</div>
            <button class="playlist-item-remove" onclick="removeFromPlaylist('${playlist.id}', ${index})">×</button>
        </div>
    `).join('');
}

function calculatePlaylistDuration(playlist) {
    let totalSeconds = 0;
    
    playlist.items.forEach(item => {
        if (item.type === 'loop') {
            const loopDuration = (item.end - item.start) * item.playCount;
            totalSeconds += loopDuration;
        } else {
            totalSeconds += item.duration * item.playCount;
        }
    });

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function showPlaylistEditor(playlistId) {
    const editor = document.getElementById(`playlist-editor-${playlistId}`);
    if (editor) {
        editor.classList.add('active');
        setupPlaylistDragAndDrop(playlistId);
    }
}

function hidePlaylistEditor(playlistId) {
    const editor = document.getElementById(`playlist-editor-${playlistId}`);
    if (editor) editor.classList.remove('active');
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
                <div class="playlist-selection-icon">🎵</div>
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

// Playlist Form
function showCreatePlaylistForm(quickCreate = false) {
    els.playlistFormPopup.classList.remove('hidden');
    els.playlistFormTitle.textContent = quickCreate ? 'Quick Create Playlist' : 'Create New Playlist';
    els.playlistNameInput.value = '';
    els.playlistDescriptionInput.value = '';
    els.playlistNameInput.focus();
}

function hideCreatePlaylistForm() {
    els.playlistFormPopup.classList.add('hidden');
}

function savePlaylistFromForm() {
    const name = els.playlistNameInput.value.trim();
    const description = els.playlistDescriptionInput.value.trim();
    
    if (!name) {
        showStatus('Please enter a playlist name');
        return;
    }
    
    const playlist = createPlaylist(name, description);
    hideCreatePlaylistForm();
    
    // If we have a pending item, add it immediately
    if (pendingPlaylistItem) {
        addItemToPlaylist(playlist.id, pendingPlaylistItem);
        hideAddToPlaylistPopup();
        pendingPlaylistItem = null;
    }
}

// Event Listeners Setup
function setupEventListeners() {
    // Main click event delegation
    document.addEventListener('click', async (e) => {
        const target = e.target;
        
        try {
            // Login
            if (target.matches('#connect-btn')) {
                e.preventDefault();
                login();
            }
            
            // Navigation
            else if (target.matches('#nav-search')) {
                e.preventDefault();
                showView('search');
            }
            else if (target.matches('#nav-player')) {
                e.preventDefault();
                if (currentTrack) showView('player');
                else showStatus('No track selected');
            }
            else if (target.matches('#nav-library')) {
                e.preventDefault();
                showView('library');
            }
            else if (target.matches('#nav-playlists')) {
                e.preventDefault();
                showView('playlists');
            }
            
            // Mini player
            else if (target.closest('.now-playing-indicator')) {
                e.preventDefault();
                if (currentTrack) showView('player');
            }
            
            // Track actions in search
            else if (target.matches('.play-track-btn')) {
                e.preventDefault();
                const trackIndex = parseInt(target.dataset.trackIndex);
                const track = currentSearchResults[trackIndex];
                if (track) await playTrackInBackground(track);
            }
            else if (target.matches('.select-track-btn')) {
                e.preventDefault();
                const trackIndex = parseInt(target.dataset.trackIndex);
                const track = currentSearchResults[trackIndex];
                if (track) await selectTrack(track.uri);
            }
            else if (target.matches('.track-menu-btn')) {
                e.preventDefault();
                const trackIndex = parseInt(target.dataset.trackIndex);
                showTrackContextMenu(trackIndex, target);
            }
            
            // Context menu
            else if (target.matches('#discover-moments-btn')) {
                e.preventDefault();
                await handleDiscoverMoments();
            }
            else if (target.matches('#add-to-playlist-btn-menu')) {
                e.preventDefault();
                await handleAddToPlaylist();
            }
            else if (target.matches('#play-in-background-btn')) {
                e.preventDefault();
                await handlePlayInBackground();
            }
            else if (target.matches('.context-menu-overlay')) {
                e.preventDefault();
                hideTrackContextMenu();
            }
            
            // Player controls
            else if (target.matches('#play-pause-btn')) {
                e.preventDefault();
                await togglePlayPause();
            }
            else if (target.matches('#backward-btn')) {
                e.preventDefault();
                await seekBackward();
            }
            else if (target.matches('#forward-btn')) {
                e.preventDefault();
                await seekForward();
            }
            
            // Loop controls - FIX 2: Changed from start-loop-btn to set-loop-btn
            else if (target.matches('#start-loop-btn')) {
                e.preventDefault();
                await setLoop();
            }
            else if (target.matches('#save-loop-btn')) {
                e.preventDefault();
                saveCurrentLoop();
            }
            else if (target.matches('#add-to-playlist-btn')) {
                e.preventDefault();
                if (!currentTrack) {
                    showStatus('No track selected');
                    return;
                }
                
                pendingPlaylistItem = {
                    type: 'loop',
                    uri: currentTrack.uri,
                    trackId: currentTrack.uri.split(':')[2],
                    name: currentTrack.name,
                    artist: currentTrack.artist,
                    image: currentTrack.image,
                    start: loopStart,
                    end: loopEnd,
                    duration: currentTrack.duration,
                    playCount: loopTarget
                };
                
                showAddToPlaylistPopup();
            }
            
            // Repeat controls
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
                await loadMoreTracks();
            }
            
            // Library actions
            else if (target.matches('.load-btn')) {
                e.preventDefault();
                const loopId = target.dataset.loopId;
                await loadSavedLoop(loopId);
            }
            else if (target.matches('.edit-btn')) {
                e.preventDefault();
                const loopId = target.dataset.loopId;
                editLoop(loopId);
            }
            else if (target.matches('.share-btn')) {
                e.preventDefault();
                const loopId = target.dataset.loopId;
                shareLoop(loopId);
            }
            else if (target.matches('.delete-btn')) {
                e.preventDefault();
                const loopId = target.dataset.loopId;
                deleteLoop(loopId);
            }
            else if (target.matches('.add-to-playlist-btn')) {
                e.preventDefault();
                const loopId = target.dataset.loopId;
                const loop = savedLoops.find(l => l.id === loopId);
                if (loop) {
                    pendingPlaylistItem = {
                        type: 'loop',
                        uri: loop.track.uri,
                        trackId: loop.track.uri.split(':')[2],
                        name: loop.track.name,
                        artist: loop.track.artist,
                        image: loop.track.image,
                        start: loop.loop.start,
                        end: loop.loop.end,
                        duration: loop.track.duration,
                        playCount: loop.loop.repeat
                    };
                    showAddToPlaylistPopup();
                }
            }
            
            // Playlist controls
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
                showPlaylistEditor(playlistId);
            }
            else if (target.matches('.share-playlist-btn')) {
                e.preventDefault();
                showStatus('Playlist sharing coming soon!');
            }
            else if (target.matches('.delete-playlist-btn')) {
                e.preventDefault();
                const playlistId = target.dataset.playlistId;
                deletePlaylist(playlistId);
            }
            
            // Playlist mode controls
            else if (target.matches('#playlist-prev-btn')) {
                e.preventDefault();
                if (playlistEngine && currentPlaylistIndex > 0) {
                    playlistEngine.currentIndex = currentPlaylistIndex - 1;
                    playlistEngine.playCurrentItem();
                }
            }
            else if (target.matches('#playlist-stop-btn')) {
                e.preventDefault();
                stopPlaylistMode();
                showStatus('Playlist stopped');
            }
            else if (target.matches('#playlist-next-btn')) {
                e.preventDefault();
                if (playlistEngine && currentPlaylist && currentPlaylistIndex < currentPlaylist.items.length - 1) {
                    playlistEngine.currentIndex = currentPlaylistIndex + 1;
                    playlistEngine.playCurrentItem();
                }
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
        updateLoopVisuals(); // FIX 6: Update visuals when toggling
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

// Global edit functions for inline editing
window.saveLoopEdits = saveLoopEdits;
window.cancelEdit = cancelEdit;
window.hidePlaylistEditor = hidePlaylistEditor;
window.removeFromPlaylist = removeFromPlaylist;

// Initialization
function init() {
    console.log('🚀 Initializing LOOOPZ...');
    
    els = {
        loginScreen: document.getElementById('login-screen'),
        searchSection: document.getElementById('search-section'),
        playerSection: document.getElementById('player-section'),
        librarySection: document.getElementById('library-section'),
        playlistsSection: document.getElementById('playlists-section'),
        searchInput: document.getElementById('search-input'),
        searchResults: document.getElementById('search-results'),
        searchBackBtn: document.getElementById('search-back-btn'),
        currentTrack: document.getElementById('current-track'),
        currentArtist: document.getElementById('current-artist'),
        albumCover: document.getElementById('album-cover'),
        statusBar: document.getElementById('status-bar'),
        statusText: document.getElementById('status-text'),
        connectionStatus: document.getElementById('connection-status'),
        nowPlayingIndicator: document.getElementById('now-playing-indicator'),
        miniTrackTitle: document.getElementById('mini-track-title'),
        miniTrackArtist: document.getElementById('mini-track-artist'),
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
    
    // Initialize loop handles visibility
    updateLoopVisuals();
    
    console.log('✅ LOOOPZ initialization complete with Playlist Management!');
}

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
