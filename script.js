// SPOTIFY INTEGRATION - WITH SEAMLESS SEARCH-TO-PLAYER TRANSITION AND PLAYLIST MANAGEMENT

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
let pendingPlaylistItem = null;
let playlistEngine = null;

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

// Playlist Engine Class for proper playlist management
class PlaylistEngine {
    constructor() {
        this.playlist = null;
        this.currentIndex = 0;
        this.isPlaying = false;
        this.isLoopingTrack = false;
        this.trackLoopCount = 0;
        this.trackLoopTarget = 1;
    }

    setPlaylist(playlist) {
        this.playlist = playlist;
        this.currentIndex = 0;
    }

    getCurrentTrack() {
        if (!this.playlist || !this.playlist.items || this.playlist.items.length === 0) return null;
        return this.playlist.items[this.currentIndex];
    }

    async playNext() {
        if (!this.playlist || !this.playlist.items) return;
        
        // Check if we should loop the current track
        if (this.isLoopingTrack && this.trackLoopCount < this.trackLoopTarget) {
            this.trackLoopCount++;
            const currentTrack = this.getCurrentTrack();
            if (currentTrack) {
                await playTrackWithLoopPoints(currentTrack);
                return;
            }
        }

        // Reset track loop state
        this.isLoopingTrack = false;
        this.trackLoopCount = 0;
        
        // Move to next track
        this.currentIndex = (this.currentIndex + 1) % this.playlist.items.length;
        const nextTrack = this.getCurrentTrack();
        
        if (nextTrack) {
            updateStatus(`Playing track ${this.currentIndex + 1} of ${this.playlist.items.length}`);
            await playTrackWithLoopPoints(nextTrack);
        }
    }

    async playPrevious() {
        if (!this.playlist || !this.playlist.items) return;
        
        this.currentIndex = this.currentIndex > 0 ? this.currentIndex - 1 : this.playlist.items.length - 1;
        const prevTrack = this.getCurrentTrack();
        
        if (prevTrack) {
            updateStatus(`Playing track ${this.currentIndex + 1} of ${this.playlist.items.length}`);
            await playTrackWithLoopPoints(prevTrack);
        }
    }

    enableTrackLoop(loopTarget = 1) {
        this.isLoopingTrack = true;
        this.trackLoopTarget = loopTarget;
        this.trackLoopCount = 0;
    }

    disableTrackLoop() {
        this.isLoopingTrack = false;
        this.trackLoopCount = 0;
    }

    reset() {
        this.playlist = null;
        this.currentIndex = 0;
        this.isPlaying = false;
        this.isLoopingTrack = false;
        this.trackLoopCount = 0;
    }
}

// Initialize playlist engine
playlistEngine = new PlaylistEngine();

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

function updateStatus(message, isError = false) {
    els.statusText.textContent = message;
    els.statusBar.classList.toggle('error', isError);
    els.statusBar.classList.add('visible');
    
    if (!isError) {
        setTimeout(() => els.statusBar.classList.remove('visible'), 3000);
    }
}

// Auth
function getAuthUrl() {
    const params = new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        response_type: 'token',
        redirect_uri: SPOTIFY_REDIRECT_URI,
        scope: SPOTIFY_SCOPES,
        show_dialog: false
    });
    return `https://accounts.spotify.com/authorize?${params}`;
}

function getTokenFromUrl() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    return params.get('access_token');
}

function checkAuth() {
    const token = getTokenFromUrl();
    if (token) {
        spotifyAccessToken = token;
        localStorage.setItem('spotify_access_token', token);
        window.history.replaceState({}, document.title, window.location.pathname);
        initSpotifyPlayer();
        return true;
    }
    
    const savedToken = localStorage.getItem('spotify_access_token');
    if (savedToken) {
        spotifyAccessToken = savedToken;
        initSpotifyPlayer();
        return true;
    }
    
    return false;
}

// Player
function initSpotifyPlayer() {
    window.onSpotifyWebPlaybackSDKReady = () => {
        spotifyPlayer = new Spotify.Player({
            name: 'LOOOPZ Player',
            getOAuthToken: cb => cb(spotifyAccessToken),
            volume: 0.8
        });

        spotifyPlayer.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            spotifyDeviceId = device_id;
            onConnected();
        });

        spotifyPlayer.addListener('not_ready', ({ device_id }) => {
            console.log('Device not ready:', device_id);
        });

        spotifyPlayer.addListener('player_state_changed', state => {
            if (!state) return;

            // Update current track info
            if (state.track_window?.current_track) {
                currentTrack = state.track_window.current_track;
                updateNowPlaying(currentTrack);
            }

            // Update time and playback state
            currentTime = state.position / 1000;
            duration = state.duration / 1000;
            isPlaying = !state.paused;
            
            updatePlayPauseButton();
            updateProgress();

            // Handle track end for both loop and playlist modes
            if (state.position === 0 && state.paused && duration > 0) {
                handleTrackEnd();
            }

            // Handle looping within a track
            if (loopEnabled && !state.paused && currentTime >= loopEnd && !isLooping) {
                isLooping = true;
                if (loopCount < loopTarget - 1) {
                    loopCount++;
                    els.repeatValue.textContent = `${loopCount}/${loopTarget}`;
                    spotifyPlayer.seek(loopStart * 1000);
                    setTimeout(() => { isLooping = false; }, 100);
                } else {
                    // Loop complete
                    loopCount = 0;
                    els.repeatValue.textContent = '1/1';
                    if (isPlaylistMode && playlistEngine.playlist) {
                        // If in playlist mode, check if we should loop this track again
                        if (playlistEngine.isLoopingTrack) {
                            playlistEngine.trackLoopCount++;
                            if (playlistEngine.trackLoopCount < playlistEngine.trackLoopTarget) {
                                spotifyPlayer.seek(loopStart * 1000);
                                setTimeout(() => { isLooping = false; }, 100);
                            } else {
                                // Track loop complete, move to next
                                playlistEngine.playNext();
                            }
                        } else {
                            // No track loop, just move to next
                            playlistEngine.playNext();
                        }
                    } else {
                        // Not in playlist mode, just restart the loop
                        spotifyPlayer.seek(loopStart * 1000);
                        setTimeout(() => { isLooping = false; }, 100);
                    }
                }
            }
        });

        spotifyPlayer.addListener('initialization_error', ({ message }) => {
            console.error('Failed to initialize', message);
            updateStatus('Failed to initialize player', true);
        });

        spotifyPlayer.addListener('authentication_error', ({ message }) => {
            console.error('Failed to authenticate', message);
            localStorage.removeItem('spotify_access_token');
            updateStatus('Authentication failed. Please reconnect.', true);
            setTimeout(() => {
                showView('login');
                isConnected = false;
                updateConnectionStatus(false);
            }, 2000);
        });

        spotifyPlayer.connect();
    };

    // Load SDK if not already loaded
    if (!window.Spotify) {
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        document.body.appendChild(script);
    } else {
        window.onSpotifyWebPlaybackSDKReady();
    }
}

function handleTrackEnd() {
    if (isPlaylistMode && playlistEngine.playlist) {
        // In playlist mode, let the engine handle next track
        playlistEngine.playNext();
    } else if (loopEnabled) {
        // In single track mode with loop enabled, restart
        spotifyPlayer.seek(loopStart * 1000);
        spotifyPlayer.resume();
    }
}

function onConnected() {
    isConnected = true;
    localStorage.setItem('spotify_access_token', spotifyAccessToken);
    updateConnectionStatus(true);
    showView('search');
    updateStatus('Connected to Spotify');
}

function updateConnectionStatus(connected) {
    els.connectionStatus.style.display = connected ? 'flex' : 'none';
    els.loginScreen.style.display = connected ? 'none' : 'flex';
}

// Search functionality
async function performSearch() {
    const query = els.searchInput.value.trim();
    if (!query) return;

    updateStatus('Searching...');
    els.searchResults.innerHTML = '<div class="loading-state">Searching...</div>';

    try {
        let endpoint;
        let searchParams = `q=${encodeURIComponent(query)}&type=track&limit=20`;

        if (searchState.isSecondLevel && searchState.currentEntity) {
            switch (searchState.currentLevel) {
                case 'artist-top':
                    endpoint = `https://api.spotify.com/v1/artists/${searchState.currentEntity.id}/top-tracks?market=US`;
                    searchParams = '';
                    break;
                case 'artist-albums':
                    endpoint = `https://api.spotify.com/v1/artists/${searchState.currentEntity.id}/albums?include_groups=album,single&limit=20`;
                    searchParams = '';
                    break;
                case 'album':
                    endpoint = `https://api.spotify.com/v1/albums/${searchState.currentEntity.id}/tracks?limit=50`;
                    searchParams = '';
                    break;
                default:
                    endpoint = 'https://api.spotify.com/v1/search';
            }
        } else {
            endpoint = 'https://api.spotify.com/v1/search';
        }

        const url = searchParams ? `${endpoint}?${searchParams}` : endpoint;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
        });

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();
        displaySearchResults(data);
        updateStatus('Search complete');
    } catch (error) {
        console.error('Search error:', error);
        updateStatus('Search failed', true);
        els.searchResults.innerHTML = '<div class="error-state">Search failed. Please try again.</div>';
    }
}

function displaySearchResults(data) {
    els.searchResults.innerHTML = '';
    let tracks = [];

    if (searchState.isSecondLevel) {
        if (searchState.currentLevel === 'artist-top' && data.tracks) {
            tracks = data.tracks;
        } else if (searchState.currentLevel === 'artist-albums' && data.items) {
            displayAlbums(data.items);
            return;
        } else if (searchState.currentLevel === 'album' && data.items) {
            tracks = data.items;
        }
    } else if (data.tracks?.items) {
        tracks = data.tracks.items;
        displayMixedResults(data);
        return;
    }

    if (tracks.length === 0) {
        els.searchResults.innerHTML = '<div class="empty-state">No tracks found</div>';
        return;
    }

    currentSearchResults = tracks.map(track => ({
        uri: track.uri,
        name: track.name,
        artist: track.artists?.[0]?.name || 'Unknown Artist',
        album: track.album?.name || 'Unknown Album',
        albumArt: track.album?.images?.[0]?.url || '',
        duration: track.duration_ms
    }));

    tracks.forEach((track, index) => displayTrack(track, index));
}

function displayMixedResults(data) {
    els.searchResults.innerHTML = '';

    if (data.artists?.items?.length > 0) {
        const artistSection = document.createElement('div');
        artistSection.className = 'result-section';
        artistSection.innerHTML = '<div class="section-title">Artists</div>';
        
        data.artists.items.slice(0, 3).forEach(artist => {
            const artistEl = createArtistElement(artist);
            artistSection.appendChild(artistEl);
        });
        
        els.searchResults.appendChild(artistSection);
    }

    if (data.albums?.items?.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'result-section';
        albumSection.innerHTML = '<div class="section-title">Albums</div>';
        
        data.albums.items.slice(0, 3).forEach(album => {
            const albumEl = createAlbumElement(album);
            albumSection.appendChild(albumEl);
        });
        
        els.searchResults.appendChild(albumSection);
    }

    if (data.tracks?.items?.length > 0) {
        const trackSection = document.createElement('div');
        trackSection.className = 'result-section';
        trackSection.innerHTML = '<div class="section-title">Tracks</div>';
        
        currentSearchResults = data.tracks.items.map(track => ({
            uri: track.uri,
            name: track.name,
            artist: track.artists?.[0]?.name || 'Unknown Artist',
            album: track.album?.name || 'Unknown Album',
            albumArt: track.album?.images?.[0]?.url || '',
            duration: track.duration_ms
        }));
        
        data.tracks.items.forEach((track, index) => {
            const trackEl = createTrackElement(track, index);
            trackSection.appendChild(trackEl);
        });
        
        els.searchResults.appendChild(trackSection);
    }
}

function createArtistElement(artist) {
    const el = document.createElement('div');
    el.className = 'artist-result';
    el.innerHTML = `
        <img src="${artist.images?.[0]?.url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${artist.name}">
        <div class="artist-info">
            <div class="artist-name">${artist.name}</div>
            <div class="artist-meta">${artist.followers?.total?.toLocaleString() || 0} followers</div>
        </div>
        <button class="more-btn" onclick="exploreArtist('${artist.id}', '${artist.name.replace(/'/g, "\\'")}')">→</button>
    `;
    return el;
}

function createAlbumElement(album) {
    const el = document.createElement('div');
    el.className = 'album-result';
    el.innerHTML = `
        <img src="${album.images?.[0]?.url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${album.name}">
        <div class="album-info">
            <div class="album-name">${album.name}</div>
            <div class="album-meta">${album.artists?.[0]?.name || 'Unknown'} • ${album.release_date?.split('-')[0] || ''}</div>
        </div>
        <button class="more-btn" onclick="exploreAlbum('${album.id}', '${album.name.replace(/'/g, "\\'")}')">→</button>
    `;
    return el;
}

function createTrackElement(track, index) {
    const el = document.createElement('div');
    el.className = 'search-result';
    el.innerHTML = `
        <img src="${track.album?.images?.[0]?.url || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${track.name}">
        <div class="track-info">
            <div class="track-name">${track.name}</div>
            <div class="track-meta">${track.artists?.[0]?.name || 'Unknown'} • ${track.album?.name || 'Unknown'}</div>
        </div>
        <button class="play-btn" onclick="playFromSearch(${index})">▶</button>
        <button class="menu-btn" onclick="showTrackMenu(event, ${index})">⋮</button>
    `;
    return el;
}

function displayTrack(track, index) {
    const resultEl = createTrackElement(track, index);
    els.searchResults.appendChild(resultEl);
}

function displayAlbums(albums) {
    els.searchResults.innerHTML = '';
    albums.forEach(album => {
        const albumEl = createAlbumElement(album);
        els.searchResults.appendChild(albumEl);
    });
}

// Playback
async function playFromSearch(index) {
    if (!currentSearchResults[index]) return;
    
    const track = currentSearchResults[index];
    
    // Exit playlist mode when playing from search
    isPlaylistMode = false;
    playlistEngine.reset();
    
    // Reset loop state
    loopEnabled = false;
    loopCount = 0;
    loopStart = 0;
    loopEnd = 30;
    updateLoopToggle();
    
    await playTrack(track);
    showView('player');
}

async function playTrack(track) {
    try {
        updateStatus('Loading track...');
        
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${spotifyAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ uris: [track.uri] })
        });

        if (!response.ok) throw new Error('Failed to play track');

        currentTrack = track;
        duration = track.duration / 1000;
        loopEnd = Math.min(30, duration);
        
        updateNowPlaying(track);
        updateLoopRegion();
        updateStatus(`Playing: ${track.name}`);
        
        // Start update timer
        if (updateTimer) clearInterval(updateTimer);
        updateTimer = setInterval(updateLoop, 100);
        
    } catch (error) {
        console.error('Play error:', error);
        updateStatus('Failed to play track', true);
    }
}

async function playTrackWithLoopPoints(item) {
    // Check if item has saved loop points
    if (item.loopStart !== undefined && item.loopEnd !== undefined) {
        loopStart = item.loopStart;
        loopEnd = item.loopEnd;
        loopEnabled = true;
        loopTarget = item.repeat || 1;
        loopCount = 0;
        updateLoopToggle();
        updateLoopRegion();
    } else {
        // Reset to defaults
        loopEnabled = false;
        loopStart = 0;
        loopEnd = 30;
        loopTarget = 1;
        updateLoopToggle();
    }
    
    await playTrack(item);
}

function updateLoop() {
    if (!spotifyPlayer || !isPlaying) return;
    
    spotifyPlayer.getCurrentState().then(state => {
        if (!state) return;
        
        currentTime = state.position / 1000;
        updateProgress();
        
        // Handle loop boundary
        if (loopEnabled && currentTime >= loopEnd && !isLooping) {
            isLooping = true;
            
            if (loopCount < loopTarget - 1) {
                loopCount++;
                els.repeatValue.textContent = `${loopCount}/${loopTarget}`;
                spotifyPlayer.seek(loopStart * 1000);
                setTimeout(() => { isLooping = false; }, 100);
            } else {
                // Loop complete
                loopCount = 0;
                els.repeatValue.textContent = '1/1';
                
                if (isPlaylistMode && playlistEngine.playlist) {
                    // Let playlist engine handle next action
                    playlistEngine.playNext();
                } else {
                    // Single track mode - restart loop
                    spotifyPlayer.seek(loopStart * 1000);
                    setTimeout(() => { isLooping = false; }, 100);
                }
            }
        }
    });
}

function updateNowPlaying(track) {
    els.currentTrack.textContent = track.name;
    els.currentArtist.textContent = track.artist;
    els.miniTrackTitle.textContent = track.name;
    els.miniTrackArtist.textContent = track.artist;
    els.nowPlayingIndicator.classList.add('visible');
}

function updateProgress() {
    if (!duration) return;
    const percent = (currentTime / duration) * 100;
    els.progressBar.style.width = `${percent}%`;
    els.currentTime.textContent = formatTime(currentTime);
    els.duration.textContent = formatTime(duration);
}

function updateLoopRegion() {
    if (!duration) return;
    const startPercent = (loopStart / duration) * 100;
    const widthPercent = ((loopEnd - loopStart) / duration) * 100;
    els.loopRegion.style.left = `${startPercent}%`;
    els.loopRegion.style.width = `${widthPercent}%`;
    els.loopRegion.style.display = loopEnabled ? 'block' : 'none';
}

function updatePlayPauseButton() {
    els.playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
}

function updateLoopToggle() {
    els.loopToggle.classList.toggle('active', loopEnabled);
    els.repeatValue.style.display = loopEnabled ? 'block' : 'none';
    els.repeatValue.textContent = `${loopCount}/${loopTarget}`;
    updateLoopRegion();
}

// Playlist functionality
async function playPlaylist(playlistId) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist || !playlist.items || playlist.items.length === 0) {
        updateStatus('Playlist is empty', true);
        return;
    }

    // Set up playlist mode
    isPlaylistMode = true;
    currentPlaylist = playlist;
    currentPlaylistIndex = 0;
    
    // Initialize playlist engine
    playlistEngine.setPlaylist(playlist);
    
    // Check if current track has loop settings
    const firstTrack = playlist.items[0];
    if (firstTrack.repeat && firstTrack.repeat > 1) {
        playlistEngine.enableTrackLoop(firstTrack.repeat);
    }
    
    updateStatus(`Playing playlist: ${playlist.name}`);
    await playTrackWithLoopPoints(firstTrack);
    
    showView('player');
}

async function playFromPlaylist(playlistId, trackIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist || !playlist.items || !playlist.items[trackIndex]) return;

    // Set up playlist mode
    isPlaylistMode = true;
    currentPlaylist = playlist;
    currentPlaylistIndex = trackIndex;
    
    // Initialize playlist engine
    playlistEngine.setPlaylist(playlist);
    playlistEngine.currentIndex = trackIndex;
    
    const track = playlist.items[trackIndex];
    if (track.repeat && track.repeat > 1) {
        playlistEngine.enableTrackLoop(track.repeat);
    }
    
    updateStatus(`Playing from playlist: ${playlist.name}`);
    await playTrackWithLoopPoints(track);
    
    showView('player');
}

// Loop management
function setLoopStart() {
    loopStart = currentTime;
    updateStatus(`Loop start: ${formatTime(loopStart)}`);
    if (loopEnd <= loopStart) {
        loopEnd = Math.min(loopStart + 10, duration);
    }
    updateLoopRegion();
}

function saveLoop() {
    if (!currentTrack) {
        updateStatus('No track playing', true);
        return;
    }

    const loop = {
        id: Date.now().toString(),
        trackUri: currentTrack.uri,
        trackName: currentTrack.name,
        artist: currentTrack.artist,
        album: currentTrack.album,
        albumArt: currentTrack.albumArt,
        loopStart,
        loopEnd,
        repeat: loopTarget,
        duration: currentTrack.duration,
        createdAt: new Date().toISOString()
    };

    savedLoops.push(loop);
    localStorage.setItem('savedLoops', JSON.stringify(savedLoops));
    updateLoopCount();
    updateStatus('Loop saved!');
}

function loadSavedLoops() {
    const saved = localStorage.getItem('savedLoops');
    if (saved) {
        savedLoops = JSON.parse(saved);
        updateLoopCount();
    }
}

function updateLoopCount() {
    els.loopCountBadge.textContent = savedLoops.length;
    els.loopCountBadge.style.display = savedLoops.length > 0 ? 'flex' : 'none';
}

function displaySavedLoops() {
    els.loopsList.innerHTML = '';
    
    if (savedLoops.length === 0) {
        els.loopsList.innerHTML = '<div class="empty-state">No saved loops yet. Create your first loop!</div>';
        return;
    }

    savedLoops.forEach(loop => {
        const loopEl = document.createElement('div');
        loopEl.className = 'loop-item';
        loopEl.id = `loop-${loop.id}`;
        loopEl.innerHTML = `
            <img src="${loop.albumArt || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${loop.trackName}">
            <div class="loop-info">
                <div class="loop-track">${loop.trackName}</div>
                <div class="loop-artist">${loop.artist}</div>
                <div class="loop-details">
                    <span class="loop-time">${formatTime(loop.loopStart, false)} - ${formatTime(loop.loopEnd, false)}</span>
                    <span class="loop-repeat">×${loop.repeat}</span>
                </div>
            </div>
            <div class="loop-actions">
                <button class="play-loop-btn" onclick="playLoop('${loop.id}')">▶</button>
                <button class="edit-loop-btn" onclick="editLoop('${loop.id}')">✏️</button>
                <button class="delete-loop-btn" onclick="deleteLoop('${loop.id}')">🗑️</button>
            </div>
        `;
        els.loopsList.appendChild(loopEl);
    });
}

async function playLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;

    // Exit playlist mode when playing a single loop
    isPlaylistMode = false;
    playlistEngine.reset();
    
    loopStart = loop.loopStart;
    loopEnd = loop.loopEnd;
    loopTarget = loop.repeat;
    loopCount = 0;
    loopEnabled = true;
    
    updateLoopToggle();
    updateLoopRegion();
    
    await playTrack({
        uri: loop.trackUri,
        name: loop.trackName,
        artist: loop.artist,
        album: loop.album,
        albumArt: loop.albumArt,
        duration: loop.duration
    });
    
    showView('player');
}

function deleteLoop(loopId) {
    savedLoops = savedLoops.filter(l => l.id !== loopId);
    localStorage.setItem('savedLoops', JSON.stringify(savedLoops));
    updateLoopCount();
    displaySavedLoops();
    updateStatus('Loop deleted');
}

// Playlist management
function loadSavedPlaylists() {
    const saved = localStorage.getItem('savedPlaylists');
    if (saved) {
        savedPlaylists = JSON.parse(saved);
        updatePlaylistCount();
    }
}

function updatePlaylistCount() {
    els.playlistCountBadge.textContent = savedPlaylists.length;
    els.playlistCountBadge.style.display = savedPlaylists.length > 0 ? 'flex' : 'none';
}

function displayPlaylists() {
    els.playlistsList.innerHTML = '';
    
    if (savedPlaylists.length === 0) {
        els.playlistsList.innerHTML = '<div class="empty-state">No playlists yet. Create your first playlist!</div>';
        return;
    }

    savedPlaylists.forEach(playlist => {
        const playlistEl = document.createElement('div');
        playlistEl.className = 'playlist-item';
        playlistEl.id = `playlist-${playlist.id}`;
        
        const totalDuration = playlist.items.reduce((sum, item) => sum + (item.duration || 0), 0);
        const totalLoops = playlist.items.reduce((sum, item) => sum + (item.repeat || 1), 0);
        
        playlistEl.innerHTML = `
            <div class="playlist-header">
                <div class="playlist-info">
                    <h3 class="playlist-name">${playlist.name}</h3>
                    <p class="playlist-meta">${playlist.items.length} tracks • ${totalLoops} loops • ${formatTime(totalDuration / 1000, false)}</p>
                    ${playlist.description ? `<p class="playlist-description">${playlist.description}</p>` : ''}
                </div>
                <div class="playlist-actions">
                    <button class="playlist-play-btn" onclick="playPlaylist('${playlist.id}')">▶ Play</button>
                    <button class="playlist-edit-btn" onclick="editPlaylist('${playlist.id}')">✏️</button>
                    <button class="playlist-delete-btn" onclick="deletePlaylist('${playlist.id}')">🗑️</button>
                </div>
            </div>
            <div class="playlist-tracks" id="playlist-tracks-${playlist.id}" style="display: none;">
                ${playlist.items.map((item, index) => `
                    <div class="playlist-track">
                        <img src="${item.albumArt || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${item.trackName || item.name}">
                        <div class="track-info">
                            <div class="track-name">${item.trackName || item.name}</div>
                            <div class="track-meta">${item.artist} • ${formatTime(item.loopStart || 0, false)} - ${formatTime(item.loopEnd || 30, false)} ×${item.repeat || 1}</div>
                        </div>
                        <button class="play-btn" onclick="playFromPlaylist('${playlist.id}', ${index})">▶</button>
                        <button class="remove-btn" onclick="removeFromPlaylist('${playlist.id}', ${index})">×</button>
                    </div>
                `).join('')}
            </div>
            <button class="playlist-toggle" onclick="togglePlaylistTracks('${playlist.id}')">
                <span id="toggle-icon-${playlist.id}">▼</span> Show Tracks
            </button>
        `;
        
        els.playlistsList.appendChild(playlistEl);
    });
}

function createPlaylist(name, description = '') {
    const playlist = {
        id: Date.now().toString(),
        name: name || `Playlist ${savedPlaylists.length + 1}`,
        description,
        items: [],
        createdAt: new Date().toISOString()
    };
    
    savedPlaylists.push(playlist);
    localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
    updatePlaylistCount();
    displayPlaylists();
    updateStatus('Playlist created!');
    
    return playlist;
}

function deletePlaylist(playlistId) {
    savedPlaylists = savedPlaylists.filter(p => p.id !== playlistId);
    localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
    updatePlaylistCount();
    displayPlaylists();
    updateStatus('Playlist deleted');
}

function addToPlaylist(playlistId, item) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    // Check if item already exists in playlist
    const exists = playlist.items.some(i => 
        i.trackUri === item.trackUri && 
        i.loopStart === item.loopStart && 
        i.loopEnd === item.loopEnd
    );
    
    if (exists) {
        updateStatus('Item already in playlist', true);
        return;
    }
    
    playlist.items.push(item);
    localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
    updateStatus(`Added to ${playlist.name}`);
    
    if (currentView === 'playlists') {
        displayPlaylists();
    }
}

function removeFromPlaylist(playlistId, trackIndex) {
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    playlist.items.splice(trackIndex, 1);
    localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
    displayPlaylists();
    updateStatus('Track removed from playlist');
}

// UI Controls
function showView(view) {
    currentView = view;
    
    // Hide all sections
    els.loginScreen.style.display = 'none';
    els.searchSection.style.display = 'none';
    els.playerSection.style.display = 'none';
    els.librarySection.style.display = 'none';
    els.playlistsSection.style.display = 'none';
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    
    // Show selected section and activate nav button
    switch(view) {
        case 'login':
            els.loginScreen.style.display = 'flex';
            break;
        case 'search':
            els.searchSection.style.display = 'block';
            els.navSearch.classList.add('active');
            break;
        case 'player':
            els.playerSection.style.display = 'block';
            els.navPlayer.classList.add('active');
            break;
        case 'library':
            els.librarySection.style.display = 'block';
            els.navLibrary.classList.add('active');
            displaySavedLoops();
            break;
        case 'playlists':
            els.playlistsSection.style.display = 'block';
            els.navPlaylists.classList.add('active');
            displayPlaylists();
            break;
    }
}

function togglePlaylistTracks(playlistId) {
    const tracksEl = document.getElementById(`playlist-tracks-${playlistId}`);
    const toggleIcon = document.getElementById(`toggle-icon-${playlistId}`);
    
    if (tracksEl.style.display === 'none') {
        tracksEl.style.display = 'block';
        toggleIcon.textContent = '▲';
    } else {
        tracksEl.style.display = 'none';
        toggleIcon.textContent = '▼';
    }
}

// Context menu
function showTrackMenu(event, trackIndex) {
    event.stopPropagation();
    currentContextMenuTrackIndex = trackIndex;
    
    const track = currentSearchResults[trackIndex];
    const hasLoop = loopEnabled && currentTrack?.uri === track.uri;
    
    els.contextMenu.innerHTML = `
        <button class="context-menu-item" onclick="playFromSearch(${trackIndex}); hideContextMenu();">
            <span class="context-icon">▶</span> Play
        </button>
        ${hasLoop ? `
            <button class="context-menu-item" onclick="saveLoopFromSearch(${trackIndex}); hideContextMenu();">
                <span class="context-icon">💾</span> Save Current Loop
            </button>
        ` : ''}
        <button class="context-menu-item" onclick="showAddToPlaylistPopup(${trackIndex}); hideContextMenu();">
            <span class="context-icon">➕</span> Add to Playlist
        </button>
    `;
    
    const rect = event.currentTarget.getBoundingClientRect();
    els.contextMenu.style.top = `${rect.bottom + 5}px`;
    els.contextMenu.style.left = `${rect.left}px`;
    els.contextMenu.classList.add('visible');
    els.contextMenuOverlay.classList.add('visible');
}

function hideContextMenu() {
    els.contextMenu.classList.remove('visible');
    els.contextMenuOverlay.classList.remove('visible');
    currentContextMenuTrackIndex = null;
}

function showAddToPlaylistPopup(trackIndex) {
    const track = currentSearchResults[trackIndex];
    pendingPlaylistItem = {
        trackUri: track.uri,
        trackName: track.name,
        artist: track.artist,
        album: track.album,
        albumArt: track.albumArt,
        duration: track.duration,
        loopStart: 0,
        loopEnd: Math.min(30, track.duration / 1000),
        repeat: 1
    };
    
    updatePlaylistSelection();
    els.addToPlaylistPopup.classList.add('visible');
}

function updatePlaylistSelection() {
    els.playlistSelectionList.innerHTML = '';
    
    if (savedPlaylists.length === 0) {
        els.playlistSelectionList.innerHTML = '<div class="empty-state">No playlists yet</div>';
        return;
    }
    
    savedPlaylists.forEach(playlist => {
        const option = document.createElement('div');
        option.className = 'playlist-option';
        option.innerHTML = `
            <span>${playlist.name}</span>
            <span class="playlist-option-meta">${playlist.items.length} tracks</span>
        `;
        option.onclick = () => {
            addToPlaylist(playlist.id, pendingPlaylistItem);
            els.addToPlaylistPopup.classList.remove('visible');
            pendingPlaylistItem = null;
        };
        els.playlistSelectionList.appendChild(option);
    });
}

function saveLoopFromSearch(trackIndex) {
    if (!loopEnabled || currentContextMenuTrackIndex === null) return;
    
    const track = currentSearchResults[trackIndex];
    const loop = {
        id: Date.now().toString(),
        trackUri: track.uri,
        trackName: track.name,
        artist: track.artist,
        album: track.album,
        albumArt: track.albumArt,
        loopStart,
        loopEnd,
        repeat: loopTarget,
        duration: track.duration,
        createdAt: new Date().toISOString()
    };
    
    savedLoops.push(loop);
    localStorage.setItem('savedLoops', JSON.stringify(savedLoops));
    updateLoopCount();
    updateStatus('Loop saved!');
}

// Edit functionality
function editLoop(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;
    
    currentEditingLoopId = loopId;
    const loopEl = document.getElementById(`loop-${loopId}`);
    
    loopEl.innerHTML = `
        <img src="${loop.albumArt || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23333"/></svg>'}" alt="${loop.trackName}">
        <div class="loop-info">
            <div class="loop-track">${loop.trackName}</div>
            <div class="loop-artist">${loop.artist}</div>
            <div class="edit-controls">
                <input type="text" class="edit-input" id="edit-start-${loopId}" value="${formatTime(loop.loopStart)}" placeholder="Start">
                <input type="text" class="edit-input" id="edit-end-${loopId}" value="${formatTime(loop.loopEnd)}" placeholder="End">
                <input type="number" class="edit-input" id="edit-repeat-${loopId}" value="${loop.repeat}" min="1" max="99" style="width: 60px;">
            </div>
        </div>
        <div class="edit-actions">
            <button class="btn secondary" onclick="saveLoopEdits('${loopId}')">💾</button>
            <button class="btn" onclick="cancelEdit('${loopId}')">❌</button>
        </div>
    `;
}

function cancelEdit(loopId) {
    currentEditingLoopId = null;
    displaySavedLoops();
}

function saveLoopEdits(loopId) {
    const loop = savedLoops.find(l => l.id === loopId);
    if (!loop) return;
    
    const startInput = document.getElementById(`edit-start-${loopId}`).value;
    const endInput = document.getElementById(`edit-end-${loopId}`).value;
    const repeatInput = parseInt(document.getElementById(`edit-repeat-${loopId}`).value) || 1;
    
    loop.loopStart = parseTimeInput(startInput);
    loop.loopEnd = parseTimeInput(endInput);
    loop.repeat = Math.max(1, Math.min(99, repeatInput));
    
    localStorage.setItem('savedLoops', JSON.stringify(savedLoops));
    currentEditingLoopId = null;
    displaySavedLoops();
    updateStatus('Loop updated');
}

function editPlaylist(playlistId) {
    currentEditingPlaylistId = playlistId;
    const playlist = savedPlaylists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    els.playlistFormTitle.textContent = 'Edit Playlist';
    els.playlistNameInput.value = playlist.name;
    els.playlistDescriptionInput.value = playlist.description || '';
    els.playlistFormPopup.classList.add('visible');
}

function cancelPlaylistEdit() {
    currentEditingPlaylistId = null;
    els.playlistFormPopup.classList.remove('visible');
    els.playlistNameInput.value = '';
    els.playlistDescriptionInput.value = '';
}

function savePlaylistEdits() {
    const name = els.playlistNameInput.value.trim();
    const description = els.playlistDescriptionInput.value.trim();
    
    if (!name) {
        updateStatus('Please enter a playlist name', true);
        return;
    }
    
    if (currentEditingPlaylistId) {
        // Edit existing playlist
        const playlist = savedPlaylists.find(p => p.id === currentEditingPlaylistId);
        if (playlist) {
            playlist.name = name;
            playlist.description = description;
            localStorage.setItem('savedPlaylists', JSON.stringify(savedPlaylists));
            displayPlaylists();
            updateStatus('Playlist updated');
        }
    } else {
        // Create new playlist
        createPlaylist(name, description);
    }
    
    cancelPlaylistEdit();
}

// Event listeners
function setupEventListeners() {
    // Connection
    els.connectBtn.addEventListener('click', () => {
        window.location.href = getAuthUrl();
    });
    
    els.disconnectBtn.addEventListener('click', () => {
        localStorage.removeItem('spotify_access_token');
        spotifyAccessToken = null;
        isConnected = false;
        if (spotifyPlayer) {
            spotifyPlayer.disconnect();
            spotifyPlayer = null;
        }
        showView('login');
        updateConnectionStatus(false);
        updateStatus('Disconnected from Spotify');
    });
    
    // Search
    els.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    
    els.searchBackBtn.addEventListener('click', () => {
        if (searchState.isSecondLevel) {
            searchState.isSecondLevel = false;
            searchState.currentLevel = 'tracks';
            searchState.currentEntity = null;
            els.searchBackBtn.style.display = 'none';
            els.searchInput.value = searchState.query;
            performSearch();
        }
    });
    
    // Player controls
    els.playPauseBtn.addEventListener('click', () => {
        if (!spotifyPlayer) return;
        spotifyPlayer.togglePlay();
    });
    
    els.backwardBtn.addEventListener('click', () => {
        if (!spotifyPlayer) return;
        
        if (isPlaylistMode && playlistEngine.playlist) {
            playlistEngine.playPrevious();
        } else {
            const newTime = Math.max(0, currentTime - 5);
            spotifyPlayer.seek(newTime * 1000);
        }
    });
    
    els.forwardBtn.addEventListener('click', () => {
        if (!spotifyPlayer) return;
        
        if (isPlaylistMode && playlistEngine.playlist) {
            playlistEngine.playNext();
        } else {
            const newTime = Math.min(duration, currentTime + 5);
            spotifyPlayer.seek(newTime * 1000);
        }
    });
    
    els.startLoopBtn.addEventListener('click', setLoopStart);
    els.saveLoopBtn.addEventListener('click', saveLoop);
    
    els.loopToggle.addEventListener('click', () => {
        loopEnabled = !loopEnabled;
        if (loopEnabled) {
            loopCount = 0;
            loopStartTime = Date.now();
        }
        updateLoopToggle();
    });
    
    // Loop repeat controls
    els.repeatValue.addEventListener('click', () => {
        loopTarget = loopTarget >= 10 ? 1 : loopTarget + 1;
        els.repeatValue.textContent = `${loopCount}/${loopTarget}`;
    });
    
    // Precision popup
    els.precisionBtn.addEventListener('click', () => {
        els.precisionStart.value = formatTime(loopStart);
        els.precisionEnd.value = formatTime(loopEnd);
        els.precisionPopup.classList.add('visible');
    });
    
    els.precisionClose.addEventListener('click', () => {
        els.precisionPopup.classList.remove('visible');
    });
    
    els.precisionPopup.addEventListener('click', (e) => {
        if (e.target === els.precisionPopup) {
            els.precisionPopup.classList.remove('visible');
        }
    });
    
    // Precision inputs
    els.precisionStart.addEventListener('change', () => {
        const newStart = parseTimeInput(els.precisionStart.value);
        if (!isNaN(newStart) && newStart >= 0 && newStart < duration) {
            loopStart = newStart;
            if (loopEnd <= loopStart) {
                loopEnd = Math.min(loopStart + 10, duration);
                els.precisionEnd.value = formatTime(loopEnd);
            }
            updateLoopRegion();
            updateStatus(`Loop start: ${formatTime(loopStart)}`);
        }
    });
    
    els.precisionEnd.addEventListener('change', () => {
        const newEnd = parseTimeInput(els.precisionEnd.value);
        if (!isNaN(newEnd) && newEnd > loopStart && newEnd <= duration) {
            loopEnd = newEnd;
            updateLoopRegion();
            updateStatus(`Loop end: ${formatTime(loopEnd)}`);
        }
    });
    
    // Navigation
    els.navSearch.addEventListener('click', () => showView('search'));
    els.navPlayer.addEventListener('click', () => showView('player'));
    els.navLibrary.addEventListener('click', () => showView('library'));
    els.navPlaylists.addEventListener('click', () => showView('playlists'));
    els.navDiscovery.addEventListener('click', () => {
        window.open('/discovery.html', '_blank');
    });
    
    // Context menu
    els.contextMenuOverlay.addEventListener('click', hideContextMenu);
    
    // Add to playlist popup
    els.addToPlaylistClose.addEventListener('click', () => {
        els.addToPlaylistPopup.classList.remove('visible');
        pendingPlaylistItem = null;
    });
    
    els.quickCreatePlaylist.addEventListener('click', () => {
        const newPlaylist = createPlaylist();
        if (pendingPlaylistItem) {
            addToPlaylist(newPlaylist.id, pendingPlaylistItem);
            els.addToPlaylistPopup.classList.remove('visible');
            pendingPlaylistItem = null;
        }
    });
    
    // Playlist form
    els.createPlaylistBtn.addEventListener('click', () => {
        currentEditingPlaylistId = null;
        els.playlistFormTitle.textContent = 'Create Playlist';
        els.playlistNameInput.value = '';
        els.playlistDescriptionInput.value = '';
        els.playlistFormPopup.classList.add('visible');
    });
    
    els.playlistFormClose.addEventListener('click', cancelPlaylistEdit);
    els.playlistFormCancel.addEventListener('click', cancelPlaylistEdit);
    els.playlistFormSave.addEventListener('click', savePlaylistEdits);
    
    els.playlistFormPopup.addEventListener('click', (e) => {
        if (e.target === els.playlistFormPopup) {
            cancelPlaylistEdit();
        }
    });
}

// Progress bar interaction
function setupLoopHandles() {
    let isDraggingStart = false;
    let isDraggingEnd = false;
    
    // Mouse events
    els.loopStartHandle.addEventListener('mousedown', (e) => {
        isDraggingStart = true;
        e.preventDefault();
    });
    
    els.loopEndHandle.addEventListener('mousedown', (e) => {
        isDraggingEnd = true;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDraggingStart && !isDraggingEnd) return;
        
        const rect = els.progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const time = percent * duration;
        
        if (isDraggingStart) {
            loopStart = Math.max(0, Math.min(time, loopEnd - 1));
            els.startPopup.textContent = formatTime(loopStart);
            els.startPopup.style.display = 'block';
            els.startPopup.style.left = `${(loopStart / duration) * 100}%`;
        } else if (isDraggingEnd) {
            loopEnd = Math.max(loopStart + 1, Math.min(time, duration));
            els.endPopup.textContent = formatTime(loopEnd);
            els.endPopup.style.display = 'block';
            els.endPopup.style.left = `${(loopEnd / duration) * 100}%`;
        }
        
        updateLoopRegion();
    });
    
    document.addEventListener('mouseup', () => {
        if (isDraggingStart || isDraggingEnd) {
            isDraggingStart = false;
            isDraggingEnd = false;
            els.startPopup.style.display = 'none';
            els.endPopup.style.display = 'none';
            updateStatus(`Loop: ${formatTime(loopStart)} - ${formatTime(loopEnd)}`);
        }
    });
    
    // Touch events
    els.loopStartHandle.addEventListener('touchstart', (e) => {
        isDraggingStart = true;
        e.preventDefault();
    });
    
    els.loopEndHandle.addEventListener('touchstart', (e) => {
        isDraggingEnd = true;
        e.preventDefault();
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isDraggingStart && !isDraggingEnd) return;
        
        const touch = e.touches[0];
        const rect = els.progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        const time = percent * duration;
        
        if (isDraggingStart) {
            loopStart = Math.max(0, Math.min(time, loopEnd - 1));
            els.startPopup.textContent = formatTime(loopStart);
            els.startPopup.style.display = 'block';
            els.startPopup.style.left = `${(loopStart / duration) * 100}%`;
        } else if (isDraggingEnd) {
            loopEnd = Math.max(loopStart + 1, Math.min(time, duration));
            els.endPopup.textContent = formatTime(loopEnd);
            els.endPopup.style.display = 'block';
            els.endPopup.style.left = `${(loopEnd / duration) * 100}%`;
        }
        
        updateLoopRegion();
    });
    
    document.addEventListener('touchend', () => {
        if (isDraggingStart || isDraggingEnd) {
            isDraggingStart = false;
            isDraggingEnd = false;
            els.startPopup.style.display = 'none';
            els.endPopup.style.display = 'none';
            updateStatus(`Loop: ${formatTime(loopStart)} - ${formatTime(loopEnd)}`);
        }
    });
    
    // Progress bar click to seek
    els.progressContainer.addEventListener('click', (e) => {
        if (!spotifyPlayer || !duration || isDragging) return;
        
        const rect = els.progressContainer.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const seekTime = percent * duration;
        
        spotifyPlayer.seek(seekTime * 1000);
        currentTime = seekTime;
        updateProgress();
    });
}

// Explore functions
window.exploreArtist = function(artistId, artistName) {
    searchState.isSecondLevel = true;
    searchState.currentLevel = 'artist-top';
    searchState.currentEntity = { id: artistId, name: artistName };
    els.searchInput.value = `${artistName} - Top Tracks`;
    els.searchBackBtn.style.display = 'flex';
    performSearch();
};

window.exploreAlbum = function(albumId, albumName) {
    searchState.isSecondLevel = true;
    searchState.currentLevel = 'album';
    searchState.currentEntity = { id: albumId, name: albumName };
    els.searchInput.value = `${albumName} - Tracks`;
    els.searchBackBtn.style.display = 'flex';
    performSearch();
};

// Global functions
window.playFromSearch = playFromSearch;
window.showTrackMenu = showTrackMenu;
window.playLoop = playLoop;
window.deleteLoop = deleteLoop;
window.editLoop = editLoop;
window.cancelEdit = cancelEdit;
window.saveLoopEdits = saveLoopEdits;
window.playPlaylist = playPlaylist;
window.playFromPlaylist = playFromPlaylist;
window.deletePlaylist = deletePlaylist;
window.editPlaylist = editPlaylist;
window.cancelPlaylistEdit = cancelPlaylistEdit;
window.savePlaylistEdits = savePlaylistEdits;
window.removeFromPlaylist = removeFromPlaylist;
window.togglePlaylistTracks = togglePlaylistTracks;

// Init
function init() {
    console.log('🚀 Initializing LOOOPZ with Playlist Management...');

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
        loopToggle: document.getElementById('loop-toggle'),
        repeatValue: document.getElementById('repeat-value'),
        precisionPopup: document.getElementById('precision-popup'),
        precisionBtn: document.getElementById('precision-btn'),
        precisionClose: document.getElementById('precision-close'),
        precisionStart: document.getElementById('precision-start'),
        precisionEnd: document.getElementById('precision-end'),
        loopsList: document.getElementById('loops-list'),
        playlistsList: document.getElementById('playlists-list'),
        loopCountBadge: document.getElementById('loop-count-badge'),
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
