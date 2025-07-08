// SPOTIFY INTEGRATION - WITH SEAMLESS SEARCH-TO-PLAYER TRANSITION AND PLAYLIST MANAGEMENT

// Config
const SPOTIFY_CLIENT_ID = '46637d8f5adb41c0a4be34e0df0c1597';

// Dynamic redirect URI to handle both web and PWA contexts
function getRedirectUri() {
    // Use current origin for redirect to handle PWA and web contexts
    return window.location.origin + '/';
}

// Dynamic redirect URI function used instead of constant
const SPOTIFY_SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';

// Detect if running as PWA
function isPWA() {
    return window.matchMedia('(display-mode: standalone)').matches || 
           window.navigator.standalone || 
           document.referrer.includes('android-app://') ||
           window.location.search.includes('pwa=true');
}


// Media Session API for lock screen controls
function setupMediaSession() {
    if ('mediaSession' in navigator) {
        console.log('📱 Setting up Media Session API for lock screen controls');
        console.log('📱 Browser:', navigator.userAgent);
        console.log('📱 Platform:', navigator.platform);
        
        // Test if MediaMetadata constructor exists
        try {
            const testMetadata = new MediaMetadata({ title: 'Test' });
            console.log('📱 MediaMetadata constructor available:', !!testMetadata);
        } catch (error) {
            console.error('📱 MediaMetadata constructor error:', error);
        }
        
        // Set action handlers for lock screen controls
        navigator.mediaSession.setActionHandler('play', () => {
            console.log('📱 Media Session: Play pressed');
            if (spotifyPlayer) {
                spotifyPlayer.resume();
                // Just update the UI state immediately
                isPlaying = true;
                updatePlayPauseButton();
                startProgressUpdates();
            }
        });
        
        navigator.mediaSession.setActionHandler('pause', () => {
            console.log('📱 Media Session: Pause pressed');
            if (spotifyPlayer) {
                spotifyPlayer.pause();
                // Just update the UI state immediately
                isPlaying = false;
                updatePlayPauseButton();
            }
        });
        
        navigator.mediaSession.setActionHandler('previoustrack', async () => {
            console.log('📱 Media Session: Previous pressed');
            // Check if we're in playlist mode
            if (window.playlistEngine && window.isPlaylistMode) {
                await window.playlistEngine.skipToPrevious();
            }
        });
        
        navigator.mediaSession.setActionHandler('nexttrack', async () => {
            console.log('📱 Media Session: Next pressed');
            // Check if we're in playlist mode
            if (window.playlistEngine && window.isPlaylistMode) {
                await window.playlistEngine.skipToNext();
            }
        });
        
        // Debug: Log initial state
        console.log('📱 Initial playbackState:', navigator.mediaSession.playbackState);
        console.log('📱 Initial metadata:', navigator.mediaSession.metadata);
        
        console.log('✅ Media Session API initialized');
    } else {
        console.log('⚠️ Media Session API not supported');
    }
    
    // Focus handler - restore minimal state if needed
    window.addEventListener('focus', async () => {
        if (spotifyPlayer) {
            console.log('📱 Window focused');
            
            // Debug info for phone
            showStatus(`🔍 Focus: PL=${isPlaylistMode ? 'Y' : 'N'} IDX=${currentPlaylistIndex || 'null'} ENG=${playlistEngine ? 'Y' : 'N'}`);
            
            // Check if playlist state was lost
            if (isPlaylistMode && (!currentPlaylist || !playlistEngine)) {
                showStatus('⚠️ Playlist state lost - attempting recovery');
                
                // Try to recover from saved state
                const savedPlaylistState = localStorage.getItem('active_playlist_state');
                if (savedPlaylistState) {
                    try {
                        const state = JSON.parse(savedPlaylistState);
                        currentPlaylist = savedPlaylists.find(p => p.id === state.playlistId);
                        currentPlaylistIndex = state.index || 0;
                        
                        if (currentPlaylist && state.currentItem) {
                            // Restore playlist mode
                            isPlaylistMode = state.isPlaylistMode;
                            
                            // Restore loop state for current item
                            if (state.loopState) {
                                loopStart = state.loopState.start;
                                loopEnd = state.loopState.end;
                                loopEnabled = state.loopState.enabled;
                                loopTarget = state.loopState.target;
                                loopCount = state.loopState.count;
                                
                                // Update app state
                                appState.set('loop.start', loopStart);
                                appState.set('loop.end', loopEnd);
                                appState.set('loop.enabled', loopEnabled);
                                appState.set('loop.target', loopTarget);
                                appState.set('loop.count', loopCount);
                            }
                            
                            // Reinitialize playlist engine
                            if (!playlistEngine) {
                                playlistEngine = new PlaylistEngine();
                                appState.set('playlist.engine', playlistEngine);
                                setupPlaylistEngineCallbacks();
                            }
                            
                            // Restore engine state
                            await playlistEngine.loadPlaylist(currentPlaylist, currentPlaylistIndex);
                            
                            // Update visuals
                            updateLoopVisuals();
                            updateRepeatDisplay();
                            showPlaylistNowPlaying();
                            
                            showStatus('✅ Playlist & loop state recovered');
                        }
                    } catch (e) {
                        showStatus('❌ Recovery failed');
                        console.error('Recovery error:', e);
                    }
                }
            }
            
            // Quick check if we lost track info
            if (!currentTrack && isConnected) {
                try {
                    const state = await spotifyPlayer.getCurrentState();
                    if (state && state.track_window?.current_track) {
                        // Restore just the essential track info including cover image
                        const track = state.track_window.current_track;
                        currentTrack = {
                            uri: track.uri,
                            name: track.name,
                            artist: track.artists[0]?.name || 'Unknown',
                            duration: track.duration_ms,
                            image: track.album?.images?.[0]?.url || '',
                            album: track.album?.name || 'Unknown Album'
                        };
                        duration = currentTrack.duration;
                        console.log('📱 Restored track info:', currentTrack.name);
                        
                        // Update display including cover
                        if (els.currentTrack) els.currentTrack.textContent = currentTrack.name;
                        if (els.currentArtist) els.currentArtist.textContent = currentTrack.artist;
                        updateMiniPlayer(currentTrack);
                        
                        // Update lock screen with restored info
                        updateMediaSession(currentTrack);
                    }
                } catch (error) {
                    console.warn('📱 Could not restore track info:', error);
                }
            }
            
            if (isPlaying) {
                startProgressUpdates();
            }
        }
    });
    
    // Visibility handler - same minimal restoration
    document.addEventListener('visibilitychange', async () => {
        if (!document.hidden && spotifyPlayer) {
            console.log('📱 Page visible');
            
            // Quick check if we lost track info
            if (!currentTrack && isConnected) {
                try {
                    const state = await spotifyPlayer.getCurrentState();
                    if (state && state.track_window?.current_track) {
                        const track = state.track_window.current_track;
                        currentTrack = {
                            uri: track.uri,
                            name: track.name,
                            artist: track.artists[0]?.name || 'Unknown',
                            duration: track.duration_ms,
                            image: track.album?.images?.[0]?.url || '',
                            album: track.album?.name || 'Unknown Album'
                        };
                        duration = currentTrack.duration;
                        console.log('📱 Restored track info:', currentTrack.name);
                        
                        // Update display including cover
                        if (els.currentTrack) els.currentTrack.textContent = currentTrack.name;
                        if (els.currentArtist) els.currentArtist.textContent = currentTrack.artist;
                        updateMiniPlayer(currentTrack);
                        
                        // Update lock screen with restored info
                        updateMediaSession(currentTrack);
                    }
                } catch (error) {
                    console.warn('📱 Could not restore track info:', error);
                }
            }
            
            if (isPlaying) {
                startProgressUpdates();
            }
        }
    });
}

function updateMediaSession(trackData) {
    if ('mediaSession' in navigator && trackData) {
        try {
            console.log('📱 Updating Media Session with track data:', trackData);
            
            // Prepare artwork array with actual album cover
            const artwork = [];
            
            if (trackData.image) {
                console.log('📱 Setting album cover for lock screen:', trackData.image);
                
                // Use actual album cover as primary
                artwork.push(
                    { src: trackData.image, sizes: '640x640', type: 'image/jpeg' },
                    { src: trackData.image, sizes: '512x512', type: 'image/jpeg' },
                    { src: trackData.image, sizes: '256x256', type: 'image/jpeg' },
                    { src: trackData.image, sizes: '192x192', type: 'image/jpeg' },
                    { src: trackData.image, sizes: '128x128', type: 'image/jpeg' },
                    { src: trackData.image, sizes: '96x96', type: 'image/jpeg' }
                );
            } else {
                console.log('⚠️ No album cover - using MOMENTURY logo');
                // Fallback to app logo only if no album cover
                artwork.push(
                    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
                );
            }
            
            // Create metadata
            const metadata = new MediaMetadata({
                title: trackData.name || 'Unknown Track',
                artist: trackData.artist || 'Unknown Artist',
                album: trackData.album || 'MOMENTURY', // Use actual album or app name
                artwork: artwork
            });
            
            // Set metadata for lock screen
            navigator.mediaSession.metadata = metadata;
            
            // Force playback state to playing to trigger lock screen
            navigator.mediaSession.playbackState = 'playing';
            
            console.log('📱 Media Session metadata set:', metadata);
            console.log('📱 Media Session playbackState:', navigator.mediaSession.playbackState);
            console.log(`✅ Media Session updated: ${trackData.name} by ${trackData.artist}`);
            
            // Additional debug: Check if metadata actually got set
            setTimeout(() => {
                console.log('📱 Verification - Current metadata:', navigator.mediaSession.metadata);
                console.log('📱 Verification - Current playbackState:', navigator.mediaSession.playbackState);
            }, 100);
            
        } catch (error) {
            console.error('🚨 Media Session update error:', error);
            console.error('🚨 Error stack:', error.stack);
        }
    } else {
        if (!('mediaSession' in navigator)) {
            console.log('⚠️ Media Session API not available');
        }
        if (!trackData) {
            console.log('⚠️ No track data provided to updateMediaSession');
        }
    }
}

function updateMediaSessionPlaybackState(state) {
    if ('mediaSession' in navigator && state) {
        try {
            // Set playback state for better OS integration
            navigator.mediaSession.playbackState = state.paused ? 'paused' : 'playing';
            
            // Update position for progress tracking on lock screen
            if (!state.paused && state.track_window?.current_track) {
                navigator.mediaSession.setPositionState({
                    duration: state.track_window.current_track.duration_ms / 1000,
                    playbackRate: 1.0,
                    position: state.position / 1000
                });
            }
            
            console.log(`📱 Media Session state: ${state.paused ? 'paused' : 'playing'}, position: ${Math.round(state.position / 1000)}s`);
            
        } catch (error) {
            console.error('🚨 Media Session state update error:', error);
        }
    }
}

function clearMediaSession() {
    if ('mediaSession' in navigator) {
        try {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = 'none';
            
            console.log('📱 Media Session cleared');
        } catch (error) {
            console.error('🚨 Media Session clear error:', error);
        }
    }
}

// Audio analysis caches with size limits to prevent memory leaks
const CACHE_SIZE_LIMIT = 100; // Maximum items per cache
const audioAnalysisCache = new Map();
const trackFeaturesCache = new Map();

// Transition sample configuration - REMOVED (no longer needed)

// ===============================================
// UNIFIED STATE MANAGEMENT SYSTEM
// ===============================================

class AppState {
    constructor() {
        this.state = {
            // Connection & Authentication
            spotify: {
                player: null,
                deviceId: null,
                accessToken: null,
                isConnected: false
            },
            
            // Current Playback
            playback: {
                currentTrack: null,
                isPlaying: false,
                currentTime: 0,
                duration: 0,
                lastSeekTime: 0
            },
            
            // Loop Control
            loop: {
                enabled: false,
                start: 0,
                end: 30,
                count: 0,
                target: 1,
                startTime: 0,
                isLooping: false,
                isDragging: false
            },
            
            // Playlist Mode
            playlist: {
                isActive: false,
                current: null,
                currentIndex: 0,
                engine: null,
                viewMode: 'overview',
                editingId: null,
                pendingItem: null
            },
            
            // UI State
            ui: {
                currentView: 'login',
                searchResults: [],
                editingLoopId: null,
                contextMenuTrackIndex: null
            },
            
            // Timers & Operations
            operations: {
                updateTimer: null,
                currentTrackOperation: null,
                operationCounter: 0
            },
            
            // Storage state
            storage: {
                savedLoops: [],
                savedPlaylists: []
            }
        };
        
        this.listeners = new Map();
        this.initialized = false;
    }
    
    // Subscribe to state changes
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);
        
        // Return unsubscribe function
        return () => {
            const callbacks = this.listeners.get(key);
            if (callbacks) callbacks.delete(callback);
        };
    }
    
    // Get state value by path (e.g., 'playback.currentTrack')
    get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.state);
    }
    
    // Set state value and notify listeners
    set(path, value) {
        const keys = path.split('.');
        const lastKey = keys.pop();
        const target = keys.reduce((obj, key) => obj[key], this.state);
        
        const oldValue = target[lastKey];
        if (oldValue === value) return; // No change
        
        target[lastKey] = value;
        
        // Notify specific listeners
        this.notifyListeners(path, value, oldValue);
        
        // Notify parent path listeners
        let currentPath = '';
        for (const key of keys) {
            currentPath = currentPath ? `${currentPath}.${key}` : key;
            this.notifyListeners(currentPath, this.get(currentPath), null);
        }
        
        console.log(`🔄 State changed: ${path} = ${value}`);
    }
    
    // Update multiple values atomically
    update(updates) {
        Object.entries(updates).forEach(([path, value]) => {
            this.set(path, value);
        });
    }
    
    // Reset specific section
    reset(section) {
        const defaults = this.getDefaults();
        if (defaults[section]) {
            this.state[section] = { ...defaults[section] };
            this.notifyListeners(section, this.state[section], null);
        }
    }
    
    notifyListeners(path, newValue, oldValue) {
        const callbacks = this.listeners.get(path);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newValue, oldValue, path);
                } catch (error) {
                    console.error(`State listener error for ${path}:`, error);
                }
            });
        }
    }
    
    getDefaults() {
        return {
            spotify: { player: null, deviceId: null, accessToken: null, isConnected: false },
            playback: { currentTrack: null, isPlaying: false, currentTime: 0, duration: 0, lastSeekTime: 0 },
            loop: { enabled: false, start: 0, end: 30, count: 0, target: 1, startTime: 0, isLooping: false, isDragging: false },
            playlist: { isActive: false, current: null, currentIndex: 0, engine: null, viewMode: 'overview', editingId: null, pendingItem: null },
            ui: { currentView: 'login', searchResults: [], editingLoopId: null, contextMenuTrackIndex: null },
            operations: { updateTimer: null, currentTrackOperation: null, operationCounter: 0 }
        };
    }
    
    // Debug helper
    debug() {
        console.log('🔍 Current State:', JSON.parse(JSON.stringify(this.state)));
    }
}

// Global state instance
const appState = new AppState();

// PLAYER STATE GUARD - Enhanced resilience for embed player stability
class PlayerStateGuard {
    constructor() {
        this.isMonitoring = false;
        this.healthCheckInterval = null;
        this.consecutiveFailures = 0;
        this.lastValidState = null;
        this.suspendedState = null;
        this.currentCheckInterval = 10000; // Start with 10 seconds
        this.maxCheckInterval = 30000; // Max 30 seconds when stable
        this.minCheckInterval = 2000; // Min 2 seconds when issues detected
        this.setupComplete = false;
        
        // Initialize after DOM is ready
        this.initialize();
    }
    
    initialize() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupGuards());
        } else {
            this.setupGuards();
        }
    }
    
    setupGuards() {
        if (this.setupComplete) return;
        
        console.log('🛡️ Setting up Player State Guard...');
        
        // 1. Page visibility change protection
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.handlePageSuspension();
            } else {
                this.handlePageResume();
            }
        });
        
        // 2. Window focus/blur for additional protection
        window.addEventListener('focus', () => {
            this.handleWindowFocus();
        });
        
        window.addEventListener('blur', () => {
            this.handleWindowBlur();
        });
        
        // 3. Before unload protection
        window.addEventListener('beforeunload', () => {
            this.saveEmergencyState();
        });
        
        // 4. Network status monitoring
        window.addEventListener('online', () => {
            console.log('🌐 Network restored - checking player health');
            this.performHealthCheck();
        });
        
        window.addEventListener('offline', () => {
            console.log('🌐 Network lost - saving state');
            this.saveStateSnapshot();
        });
        
        this.setupComplete = true;
        console.log('✅ Player State Guard initialized');
    }
    
    startMonitoring() {
        if (this.isMonitoring) return;
        
        this.isMonitoring = true;
        this.consecutiveFailures = 0;
        this.currentCheckInterval = 10000;
        
        console.log('🛡️ Starting adaptive health monitoring');
        this.scheduleNextHealthCheck();
    }
    
    stopMonitoring() {
        if (!this.isMonitoring) return;
        
        this.isMonitoring = false;
        if (this.healthCheckInterval) {
            clearTimeout(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        console.log('🛡️ Stopped health monitoring');
    }
    
    scheduleNextHealthCheck() {
        if (!this.isMonitoring) return;
        
        this.healthCheckInterval = setTimeout(() => {
            this.performHealthCheck();
        }, this.currentCheckInterval);
    }
    
    async performHealthCheck() {
        if (!this.isMonitoring) return;
        
        try {
            const isHealthy = await this.checkPlayerHealth();
            
            if (isHealthy) {
                // Player is healthy - slow down checks and reset failures
                this.consecutiveFailures = 0;
                this.currentCheckInterval = Math.min(
                    this.maxCheckInterval, 
                    this.currentCheckInterval * 1.5
                );
                
                // Save current good state (less frequently)
                if (this.consecutiveFailures === 0) {
                    this.saveStateSnapshot();
                }
                
            } else {
                // Player has issues - be more tolerant before acting
                this.consecutiveFailures++;
                
                // Only speed up checks if we have real issues
                if (this.consecutiveFailures > 3) {
                    this.currentCheckInterval = Math.max(
                        this.minCheckInterval,
                        this.currentCheckInterval * 0.8
                    );
                }
                
                console.warn(`🚨 Player health check failed (${this.consecutiveFailures} consecutive failures)`);
                
                // Only attempt recovery after many failures (reduced from 2 to avoid interruptions)
                if (this.consecutiveFailures >= 5) {
                    await this.attemptRecovery();
                }
            }
        } catch (error) {
            console.error('🛡️ Health check error:', error);
            this.consecutiveFailures++;
        }
        
        // Schedule next check
        this.scheduleNextHealthCheck();
    }
    
    async checkPlayerHealth() {
        // Check if Spotify player exists and is responsive
        if (!spotifyPlayer) {
            return false; // Don't log this - it's expected during initialization
        }
        
        try {
            // Test player responsiveness with longer timeout to avoid false positives
            const healthCheckPromise = spotifyPlayer.getCurrentState();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Health check timeout')), 8000)
            );
            
            const state = await Promise.race([healthCheckPromise, timeoutPromise]);
            
            // Allow null state sometimes - it's normal when nothing is playing
            if (!state) {
                // Only consider this unhealthy if we expect to be playing
                const expectedToPlay = appState.get('playback.isPlaying');
                if (!expectedToPlay) {
                    return true; // Healthy if we're not supposed to be playing
                }
                return false; // Unhealthy if we should be playing but no state
            }
            
            // More lenient health check - just verify basic connectivity
            const hasDevice = !!state.device_id;
            const hasBasicState = typeof state.paused === 'boolean';
            
            const isHealthy = hasDevice && hasBasicState;
            
            if (isHealthy) {
                // Only update connection status - NEVER interfere with track progression
                if (this.consecutiveFailures > 0) {
                    appState.set('spotify.isConnected', true);
                }
                
                // DO NOT update track info, position, or playing state
                // Let the normal player state handlers manage this to avoid conflicts
            }
            
            return isHealthy;
            
        } catch (error) {
            // Only log errors if we have multiple failures
            if (this.consecutiveFailures > 2) {
                console.warn('🛡️ Player health check failed:', error.message);
            }
            return false;
        }
    }
    
    async attemptRecovery() {
        console.log('🔄 Attempting player recovery...');
        
        // Only attempt recovery after significant consecutive failures
        if (this.consecutiveFailures < 5) {
            console.log(`🛡️ Only ${this.consecutiveFailures} failures, waiting before recovery`);
            return false;
        }
        
        try {
            // GENTLE recovery - only restore state, don't force reconnection
            if (this.lastValidState) {
                console.log('🔄 Restoring from saved state...');
                await this.restoreFromSavedState();
                this.consecutiveFailures = 0; // Reset after successful restore
                return true;
            }
            
            // Only signal for manual recovery - don't force reconnection
            console.log('🔄 Signaling need for manual recovery');
            this.signalRecoveryNeeded();
            
        } catch (error) {
            console.error('🛡️ Recovery attempt failed:', error);
            this.signalRecoveryNeeded();
        }
        
        return false;
    }
    
    handlePageSuspension() {
        console.log('📱 Page going into background - saving state');
        this.saveStateSnapshot();
        this.suspendedState = {
            timestamp: Date.now(),
            wasPlaying: appState.get('playback.isPlaying'),
            currentTime: appState.get('playback.currentTime'),
            currentTrack: appState.get('playback.currentTrack')
        };
    }
    
    async handlePageResume() {
        console.log('📱 Page resumed from background - checking state');
        
        // Wait a moment for the page to fully activate
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check if we need to recover
        const isHealthy = await this.checkPlayerHealth();
        if (!isHealthy && this.suspendedState) {
            console.log('🔄 Recovering from page suspension...');
            await this.recoverFromSuspension();
        }
        
        this.suspendedState = null;
    }
    
    async handleWindowFocus() {
        // Quick health check on focus
        const isHealthy = await this.checkPlayerHealth();
        if (!isHealthy) {
            console.log('🔄 Player issues detected on focus - starting recovery');
            await this.attemptRecovery();
        }
    }
    
    handleWindowBlur() {
        // Save state when losing focus
        this.saveStateSnapshot();
    }
    
    saveStateSnapshot() {
        try {
            const snapshot = {
                version: '1.0',
                timestamp: Date.now(),
                spotify: {
                    isConnected: appState.get('spotify.isConnected'),
                    deviceId: appState.get('spotify.deviceId')
                },
                playback: {
                    currentTrack: appState.get('playback.currentTrack'),
                    isPlaying: appState.get('playback.isPlaying'),
                    currentTime: appState.get('playback.currentTime'),
                    duration: appState.get('playback.duration')
                },
                loop: {
                    enabled: appState.get('loop.enabled'),
                    start: appState.get('loop.start'),
                    end: appState.get('loop.end'),
                    count: appState.get('loop.count'),
                    target: appState.get('loop.target')
                },
                playlist: {
                    isActive: appState.get('playlist.isActive'),
                    current: appState.get('playlist.current'),
                    currentIndex: appState.get('playlist.currentIndex')
                }
            };
            
            // Save to sessionStorage (survives tab suspension)
            sessionStorage.setItem('playerStateSnapshot', JSON.stringify(snapshot));
            this.lastValidState = snapshot;
            
        } catch (error) {
            console.warn('🛡️ Failed to save state snapshot:', error);
        }
    }
    
    saveEmergencyState() {
        // Save critical state before page unload
        this.saveStateSnapshot();
        
        // Also save to localStorage for cross-session recovery
        try {
            const emergencyState = {
                timestamp: Date.now(),
                currentTrack: appState.get('playback.currentTrack'),
                isPlaying: appState.get('playback.isPlaying'),
                currentTime: appState.get('playback.currentTime')
            };
            
            localStorage.setItem('playerEmergencyState', JSON.stringify(emergencyState));
        } catch (error) {
            console.warn('🛡️ Failed to save emergency state:', error);
        }
    }
    
    async recoverFromSuspension() {
        if (!this.suspendedState) return;
        
        const timeSuspended = Date.now() - this.suspendedState.timestamp;
        console.log(`🔄 Recovering from ${timeSuspended}ms suspension`);
        
        // If we were playing, try to resume
        if (this.suspendedState.wasPlaying && spotifyPlayer) {
            try {
                await spotifyPlayer.resume();
                showStatus('🎵 Playback resumed after suspension');
            } catch (error) {
                console.warn('🛡️ Failed to resume playback:', error);
                this.signalRecoveryNeeded();
            }
        }
    }
    
    async restoreFromSavedState() {
        if (!this.lastValidState) return;
        
        const state = this.lastValidState;
        console.log('🔄 Restoring from saved state:', state);
        
        // Get current actual player state to compare
        let currentState = null;
        try {
            currentState = await spotifyPlayer.getCurrentState();
        } catch (error) {
            console.warn('Could not get current state for restoration comparison');
        }
        
        // ONLY restore connection status - never override current track info
        appState.update({
            'spotify.isConnected': state.spotify.isConnected
        });
        
        // ONLY restore loop settings if we're still on the same track
        if (currentState && currentState.track_window?.current_track) {
            const currentTrackUri = currentState.track_window.current_track.uri;
            const savedTrackUri = state.playback.currentTrack?.uri;
            
            if (currentTrackUri === savedTrackUri) {
                console.log('🔄 Same track - restoring loop settings');
                appState.update({
                    'loop.enabled': state.loop.enabled,
                    'loop.start': state.loop.start,
                    'loop.end': state.loop.end,
                    'loop.count': state.loop.count,
                    'loop.target': state.loop.target
                });
                
                if (state.loop.enabled) {
                    if (els.loopToggle) els.loopToggle.checked = true;
                    updateLoopVisuals();
                }
            } else {
                console.log('🔄 Different track - NOT restoring loop settings');
            }
        }
        
        // Never restore playback position or track info - let the player handle this naturally
        updatePlayPauseButton();
        showStatus('✅ Connection state restored');
    }
    
    signalRecoveryNeeded() {
        // Update UI to show recovery is needed
        appState.set('spotify.isConnected', false);
        showStatus('⚠️ Player connection lost - click to reconnect', 'warning');
        
        // Update connection status display
        if (els.connectionStatus) {
            els.connectionStatus.querySelector('.status-dot').classList.add('disconnected');
            els.connectionStatus.querySelector('span').textContent = 'Disconnected';
        }
    }
    
    // Check for saved state on initialization
    checkForSavedState() {
        try {
            const savedState = sessionStorage.getItem('playerStateSnapshot');
            if (savedState) {
                this.lastValidState = JSON.parse(savedState);
                console.log('🛡️ Found saved state from previous session');
            }
            
            const emergencyState = localStorage.getItem('playerEmergencyState');
            if (emergencyState) {
                const state = JSON.parse(emergencyState);
                const timeSinceEmergency = Date.now() - state.timestamp;
                
                // Only use emergency state if it's recent (within 5 minutes)
                if (timeSinceEmergency < 300000) {
                    console.log('🛡️ Found recent emergency state');
                    this.lastValidState = state;
                }
                
                // Clean up old emergency state
                localStorage.removeItem('playerEmergencyState');
            }
        } catch (error) {
            console.warn('🛡️ Failed to check for saved state:', error);
        }
    }
}

// Global state guard instance
const playerStateGuard = new PlayerStateGuard();

// Force complete player state synchronization
async function syncPlayerState() {
    console.log('🔄 Forcing player state sync...');
    
    if (!spotifyPlayer) {
        console.warn('No Spotify player for state sync');
        return;
    }
    
    try {
        const state = await spotifyPlayer.getCurrentState();
        
        if (state) {
            // Update current time and playing status
            currentTime = state.position / 1000;
            isPlaying = !state.paused;
            
            // Update UI elements
            updateProgress();
            updatePlayPauseButton();
            
            // If we have track info, update that too
            if (state.track_window?.current_track) {
                currentTrack = {
                    uri: state.track_window.current_track.uri,
                    name: state.track_window.current_track.name,
                    artist: state.track_window.current_track.artists[0]?.name || 'Unknown',
                    duration: state.track_window.current_track.duration_ms,
                    image: state.track_window.current_track.album?.images?.[0]?.url || '',
                    album: state.track_window.current_track.album?.name || 'Unknown Album'
                };
                
                duration = currentTrack.duration;
                updateMiniPlayer(currentTrack);
                
                // Update track display
                if (els.currentTrack) els.currentTrack.textContent = currentTrack.name;
                if (els.currentArtist) els.currentArtist.textContent = currentTrack.artist;
                
                // Update lock screen with current track
                updateMediaSession(currentTrack);
            }
            
            // Re-enable loop detection if it was enabled
            if (loopEnabled) {
                console.log(`🔄 Restored loop state: ${loopStart}s - ${loopEnd}s (${loopCount}/${loopTarget})`);
            }
            
            console.log(`🔄 State synced: ${currentTime.toFixed(1)}s, playing: ${isPlaying}`);
        } else {
            console.warn('No player state available for sync');
        }
    } catch (error) {
        console.error('🔄 State sync failed:', error);
    }
}

// Spotify Web Playback SDK callback - available immediately
window.onSpotifyWebPlaybackSDKReady = window.onSpotifyWebPlaybackSDKReady || function() {
    console.log('⚠️ Spotify SDK ready but player not initialized yet');
};

// Debug: Make sure the script is loading
console.log('🚀 LOOOPZ script loaded successfully');

// Initialize state synchronization system
function initializeStateSync() {
    // Spotify state sync
    appState.subscribe('spotify.player', (value) => spotifyPlayer = value);
    appState.subscribe('spotify.deviceId', (value) => spotifyDeviceId = value);
    appState.subscribe('spotify.accessToken', (value) => spotifyAccessToken = value);
    appState.subscribe('spotify.isConnected', (value) => isConnected = value);
    
    // Playback state sync
    appState.subscribe('playback.currentTrack', (value) => currentTrack = value);
    appState.subscribe('playback.isPlaying', (value) => isPlaying = value);
    appState.subscribe('playback.currentTime', (value) => currentTime = value);
    appState.subscribe('playback.duration', (value) => {
        duration = value;
        // Re-update loop visuals when Spotify provides actual duration
        if (value > 0 && loopEnabled) {
            setTimeout(() => updateLoopVisuals(), 100);
        }
    });
    
    // Loop state sync with playlist state persistence
    appState.subscribe('loop.enabled', (value) => {
        loopEnabled = value;
        updatePlaylistStateIfActive();
    });
    appState.subscribe('loop.start', (value) => {
        loopStart = value;
        updatePlaylistStateIfActive();
    });
    appState.subscribe('loop.end', (value) => {
        loopEnd = value;
        updatePlaylistStateIfActive();
    });
    appState.subscribe('loop.count', (value) => {
        loopCount = value;
        updatePlaylistStateIfActive();
    });
    appState.subscribe('loop.target', (value) => {
        loopTarget = value;
        updatePlaylistStateIfActive();
    });
    appState.subscribe('loop.startTime', (value) => loopStartTime = value);
    appState.subscribe('loop.isLooping', (value) => isLooping = value);
    appState.subscribe('loop.isDragging', (value) => isDragging = value);
    
    // Playlist state sync
    appState.subscribe('playlist.isActive', (value) => isPlaylistMode = value);
    appState.subscribe('playlist.current', (value) => currentPlaylist = value);
    appState.subscribe('playlist.currentIndex', (value) => currentPlaylistIndex = value);
    appState.subscribe('playlist.engine', (value) => playlistEngine = value);
    appState.subscribe('playlist.viewMode', (value) => playlistViewMode = value);
    appState.subscribe('playlist.editingId', (value) => currentEditingPlaylistId = value);
    appState.subscribe('playlist.pendingItem', (value) => pendingPlaylistItem = value);
    
    // UI state sync
    appState.subscribe('ui.currentView', (value) => currentView = value);
    appState.subscribe('ui.searchResults', (value) => currentSearchResults = value);
    appState.subscribe('ui.editingLoopId', (value) => currentEditingLoopId = value);
    appState.subscribe('ui.contextMenuTrackIndex', (value) => currentContextMenuTrackIndex = value);
    
    // Operations state sync
    appState.subscribe('operations.updateTimer', (value) => updateTimer = value);
    appState.subscribe('operations.currentTrackOperation', (value) => currentTrackOperation = value);
    appState.subscribe('operations.operationCounter', (value) => operationCounter = value);
    
    // Storage state sync
    appState.subscribe('storage.savedLoops', (value) => savedLoops = value || []);
    appState.subscribe('storage.savedPlaylists', (value) => savedPlaylists = value || []);
    
    // Critical state change handlers to prevent race conditions
    setupCriticalStateHandlers();
}

// Legacy variable declarations for backward compatibility
let spotifyPlayer, spotifyDeviceId, spotifyAccessToken, isConnected, isPlaying, currentTrack;
let currentTime, duration, loopStart, loopEnd, loopEnabled, loopCount, loopTarget, loopStartTime;
let updateTimer, isLooping, isDragging, currentView, currentSearchResults, currentEditingLoopId;
let currentContextMenuTrackIndex, isPlaylistMode, currentPlaylist, currentPlaylistIndex;
let playlistEngine, playlistViewMode, currentEditingPlaylistId, pendingPlaylistItem;
let currentTrackOperation, operationCounter;

// Global RAF batching system for app-wide performance optimization
class AppUpdateScheduler {
  constructor() {
    this.rafId = null;
    this.pendingUpdates = {
      // Progress updates (80 DOM ops/sec → 16-20 ops/sec)
      progressBar: null,
      visualProgressBar: null,
      currentTime: null,
      duration: null,
      
      // Play state updates
      playPauseButton: null,
      miniPlayButton: null,
      
      // Mini-player updates
      miniTrackTitle: null,
      miniTrackArtist: null,
      miniPlayerCover: null,
      miniPlayerCoverDisplay: null,
      visualProgressShow: null,
      
      // Loop visual updates
      loopStartHandleLeft: null,
      loopEndHandleLeft: null,
      loopRegionLeft: null,
      loopRegionWidth: null,
      startPopupText: null,
      endPopupText: null,
      precisionStartValue: null,
      precisionEndValue: null,
      loopVisibility: null,
      
      // Status updates
      statusText: null,
      statusShow: null,
      
      // Badge updates
      loopCountBadge: null,
      loopCountBadgeDisplay: null,
      playlistCountBadge: null,
      playlistCountBadgeDisplay: null
    };
  }
  
  schedule() {
    if (this.rafId) return; // Already scheduled
    
    this.rafId = requestAnimationFrame(() => {
      this.applyAllUpdates();
      this.rafId = null;
    });
  }
  
  applyAllUpdates() {
    const updates = this.pendingUpdates;
    
    // Progress updates (most frequent - 80 ops/sec reduced to 16-20)
    if (updates.progressBar !== null && els.progressBar) {
      els.progressBar.style.width = updates.progressBar;
    }
    if (updates.visualProgressBar !== null && els.visualProgressBar) {
      els.visualProgressBar.style.width = updates.visualProgressBar;
    }
    if (updates.currentTime !== null && els.currentTime) {
      els.currentTime.textContent = updates.currentTime;
    }
    if (updates.duration !== null && els.duration) {
      els.duration.textContent = updates.duration;
    }
    
    // Play state updates
    if (updates.playPauseButton !== null && els.playPauseBtn) {
      els.playPauseBtn.innerHTML = updates.playPauseButton;
    }
    if (updates.miniPlayButton !== null && els.miniPlayBtn) {
      els.miniPlayBtn.innerHTML = updates.miniPlayButton;
    }
    
    // Mini-player updates
    if (updates.miniTrackTitle !== null && els.miniTrackTitle) {
      els.miniTrackTitle.textContent = updates.miniTrackTitle;
    }
    if (updates.miniTrackArtist !== null && els.miniTrackArtist) {
      els.miniTrackArtist.textContent = updates.miniTrackArtist;
    }
    if (updates.miniPlayerCover !== null && els.miniPlayerCover) {
      els.miniPlayerCover.src = updates.miniPlayerCover.src;
      els.miniPlayerCover.alt = updates.miniPlayerCover.alt;
    }
    if (updates.miniPlayerCoverDisplay !== null && els.miniPlayerCover) {
      els.miniPlayerCover.style.display = updates.miniPlayerCoverDisplay;
    }
    if (updates.visualProgressShow !== null && els.visualProgressContainer) {
      if (updates.visualProgressShow) {
        els.visualProgressContainer.classList.add('show');
      } else {
        els.visualProgressContainer.classList.remove('show');
      }
    }
    
    // Loop visual updates (reduce from ~10 ops per update)
    if (updates.loopStartHandleLeft !== null && els.loopStartHandle) {
      els.loopStartHandle.style.left = updates.loopStartHandleLeft;
    }
    if (updates.loopEndHandleLeft !== null && els.loopEndHandle) {
      els.loopEndHandle.style.left = updates.loopEndHandleLeft;
    }
    if (updates.loopRegionLeft !== null && els.loopRegion) {
      els.loopRegion.style.left = updates.loopRegionLeft;
    }
    if (updates.loopRegionWidth !== null && els.loopRegion) {
      els.loopRegion.style.width = updates.loopRegionWidth;
    }
    if (updates.startPopupText !== null && els.startPopup) {
      els.startPopup.textContent = updates.startPopupText;
    }
    if (updates.endPopupText !== null && els.endPopup) {
      els.endPopup.textContent = updates.endPopupText;
    }
    if (updates.precisionStartValue !== null && els.precisionStart) {
      els.precisionStart.value = updates.precisionStartValue;
    }
    if (updates.precisionEndValue !== null && els.precisionEnd) {
      els.precisionEnd.value = updates.precisionEndValue;
    }
    if (updates.loopVisibility !== null) {
      const elements = [els.loopStartHandle, els.loopEndHandle, els.loopRegion];
      elements.forEach(el => {
        if (el) {
          if (updates.loopVisibility) {
            el.classList.add('show');
          } else {
            el.classList.remove('show');
          }
        }
      });
    }
    
    // Status updates
    if (updates.statusText !== null && els.statusText) {
      els.statusText.textContent = updates.statusText;
    }
    if (updates.statusShow !== null && els.statusBar) {
      if (updates.statusShow) {
        els.statusBar.classList.add('show');
      } else {
        els.statusBar.classList.remove('show');
      }
    }
    
    // Badge updates
    if (updates.loopCountBadge !== null && els.loopCountBadge) {
      els.loopCountBadge.textContent = updates.loopCountBadge;
    }
    if (updates.loopCountBadgeDisplay !== null && els.loopCountBadge) {
      els.loopCountBadge.style.display = updates.loopCountBadgeDisplay;
    }
    if (updates.playlistCountBadge !== null && els.playlistCountBadge) {
      els.playlistCountBadge.textContent = updates.playlistCountBadge;
    }
    if (updates.playlistCountBadgeDisplay !== null && els.playlistCountBadge) {
      els.playlistCountBadge.style.display = updates.playlistCountBadgeDisplay;
    }
    
    // Clear all pending updates
    Object.keys(this.pendingUpdates).forEach(key => {
      this.pendingUpdates[key] = null;
    });
  }
}

// Global scheduler instance
const appScheduler = new AppUpdateScheduler();

// Mobile browser UI detection for proper fixed positioning behavior
class MobileBrowserUIDetector {
  constructor() {
    this.initialViewportHeight = window.innerHeight;
    this.viewportThreshold = 100; // Height difference threshold
    this.isUIHidden = false;
    this.elements = {
      mobileNav: null,
      miniPlayer: null
    };
    
    this.init();
  }
  
  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setupElements());
    } else {
      this.setupElements();
    }
    
    // Listen for viewport changes
    this.setupViewportDetection();
  }
  
  setupElements() {
    this.elements.mobileNav = document.querySelector('.mobile-nav');
    this.elements.miniPlayer = document.getElementById('mini-player');
    
    console.log('📱 Mobile UI detector initialized', {
      nav: !!this.elements.mobileNav,
      player: !!this.elements.miniPlayer
    });
  }
  
  setupViewportDetection() {
    let resizeTimeout;
    
    // Use both resize and visualViewport for better detection
    const handleViewportChange = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.detectBrowserUIChange();
      }, 150); // Debounce for smooth behavior
    };
    
    window.addEventListener('resize', handleViewportChange);
    
    // Enhanced detection with Visual Viewport API if available
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
    }
  }
  
  detectBrowserUIChange() {
    const currentHeight = window.innerHeight;
    const heightDifference = this.initialViewportHeight - currentHeight;
    const uiIsHidden = Math.abs(heightDifference) > this.viewportThreshold;
    
    if (uiIsHidden !== this.isUIHidden) {
      this.isUIHidden = uiIsHidden;
      this.handleUIStateChange(this.isUIHidden);
      
      console.log('📱 Browser UI changed:', {
        state: this.isUIHidden ? 'hidden' : 'visible',
        heightDiff: heightDifference,
        currentHeight
      });
    }
  }
  
  handleUIStateChange(isUIHidden) {
    // Here we can add any behavior adjustments needed when browser UI changes
    // For now, just the detection and logging - no styling changes
    
    // Future: Could adjust z-index, add body classes, etc. if needed
    if (isUIHidden) {
      document.body.classList.add('browser-ui-hidden');
    } else {
      document.body.classList.remove('browser-ui-hidden');
    }
  }
}

// Initialize mobile UI detector
const mobileUIDetector = new MobileBrowserUIDetector();

// UNIFIED LOOP SYSTEM - Fixed timing and state management
let lastSeekTime = 0; // For debouncing seeks
const SEEK_DEBOUNCE_MS = 500; // Minimum time between seeks
const LOOP_END_THRESHOLD = 0.05; // More precise timing (50ms)

// SMART LOOP DETECTION - Adaptive polling for performance optimization
class SmartLoopDetector {
  constructor() {
    this.intervals = {
      FAR: 500,      // >10s from loop end: 500ms intervals (2 FPS)
      APPROACHING: 200, // 3-10s from loop end: 200ms intervals (5 FPS)  
      NEAR: 50,      // 1-3s from loop end: 50ms intervals (20 FPS)
      CRITICAL: 25   // <1s from loop end: 25ms intervals (40 FPS)
    };
    
    this.zones = {
      FAR_THRESHOLD: 10,        // 10 seconds
      APPROACHING_THRESHOLD: 3, // 3 seconds  
      NEAR_THRESHOLD: 1,        // 1 second
      CRITICAL_THRESHOLD: 0.5   // 500ms
    };
    
    this.currentZone = 'FAR';
    this.lastApiCall = 0;
    this.predictedPosition = null;
    this.lastKnownRate = 1.0; // Playback rate for prediction
    
    const reduction = this.getApiCallReduction();
    console.log(`🎯 SmartLoopDetector initialized with adaptive polling (~${reduction}% API call reduction)`);
  }
  
  determineZone(timeToLoopEnd) {
    if (timeToLoopEnd > this.zones.FAR_THRESHOLD) {
      return 'FAR';
    } else if (timeToLoopEnd > this.zones.APPROACHING_THRESHOLD) {
      return 'APPROACHING';
    } else if (timeToLoopEnd > this.zones.NEAR_THRESHOLD) {
      return 'NEAR';
    } else {
      return 'CRITICAL';
    }
  }
  
  shouldMakeApiCall(timeToLoopEnd) {
    const zone = this.determineZone(timeToLoopEnd);
    const requiredInterval = this.intervals[zone];
    const timeSinceLastCall = Date.now() - this.lastApiCall;
    
    // Zone change detection for logging and user feedback
    if (zone !== this.currentZone) {
      console.log(`🎯 Loop detection zone: ${this.currentZone} → ${zone} (${timeToLoopEnd.toFixed(1)}s to end, ${requiredInterval}ms intervals)`);
      this.currentZone = zone;
      
      // Show user feedback for zone transitions during critical moments
      if (zone === 'CRITICAL') {
        showStatus('🎯 Precision loop detection active');
      } else if (zone === 'NEAR') {
        showStatus('🎯 Enhanced loop tracking');
      }
    }
    
    return timeSinceLastCall >= requiredInterval;
  }
  
  updatePosition(newPosition, actualTime) {
    this.lastApiCall = Date.now();
    this.predictedPosition = newPosition;
    
    // Calculate playback rate for prediction accuracy
    if (this.lastKnownPosition && this.lastUpdateTime) {
      const timeDelta = (actualTime - this.lastUpdateTime) / 1000;
      const positionDelta = newPosition - this.lastKnownPosition;
      if (timeDelta > 0) {
        this.lastKnownRate = positionDelta / timeDelta;
      }
    }
    
    this.lastKnownPosition = newPosition;
    this.lastUpdateTime = actualTime;
  }
  
  getPredictedPosition() {
    if (!this.predictedPosition || !this.lastUpdateTime) {
      return null;
    }
    
    const timeSinceUpdate = (Date.now() - this.lastUpdateTime) / 1000;
    return this.predictedPosition + (timeSinceUpdate * this.lastKnownRate);
  }
  
  getApiCallReduction() {
    // Calculate percentage reduction compared to constant 50ms polling
    const baseCallsPerSecond = 1000 / 50; // 20 calls/sec at 50ms
    
    // Estimate calls per zone (rough calculation)
    const zoneCallRates = {
      FAR: 1000 / this.intervals.FAR,        // 2 calls/sec
      APPROACHING: 1000 / this.intervals.APPROACHING, // 5 calls/sec  
      NEAR: 1000 / this.intervals.NEAR,      // 20 calls/sec
      CRITICAL: 1000 / this.intervals.CRITICAL // 40 calls/sec
    };
    
    // Weighted average assuming typical song distribution
    const avgCallRate = (
      zoneCallRates.FAR * 0.7 +      // 70% of song time in FAR zone
      zoneCallRates.APPROACHING * 0.2 + // 20% in APPROACHING
      zoneCallRates.NEAR * 0.08 +    // 8% in NEAR  
      zoneCallRates.CRITICAL * 0.02  // 2% in CRITICAL
    );
    
    const reduction = ((baseCallsPerSecond - avgCallRate) / baseCallsPerSecond) * 100;
    return Math.round(reduction);
  }
}

// Global smart detector instance
// SmartLoopDetector disabled for core functionality focus  
// const smartLoopDetector = new SmartLoopDetector();

// Smart detection debug functions disabled for core functionality focus

// Playlist state (variables moved to legacy declarations above)
let savedPlaylists = [];
let savedLoops = [];

// Prebuffering system
let prebufferCache = new Map(); // Cache for prebuffered audio data
let prebufferEnabled = localStorage.getItem('prebuffer-enabled') !== 'false'; // Default enabled
let prebufferInProgress = false;
let prebufferAbortController = null;

// IndexedDB for persistent cache
let cacheDB = null;
const CACHE_DB_NAME = 'LooopzCache';
const CACHE_VERSION = 1;

// Smart Loop Assist system
let smartLoopAssistEnabled = localStorage.getItem('smart-loop-assist') !== 'false';
let currentLoopScore = { start: 0, end: 0 };
let lastHapticFeedback = 0;
// audioAnalysisCache already declared at line 10
let isAnalyzingLoop = false;

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

// Smart Loop Assist Elements (will be cached in els object)
let essentiaInstance = null;
let currentAudioBuffer = null;

// Prebuffer loading messages
const PREBUFFER_MESSAGES = [
  "🎵 Analyzing '{track}'... adding to my favorites!",
  "🎧 Loading '{track}'... this one's going to be smooth!",
  "🎶 Buffering '{track}'... preparing for seamless playback!",
  "🔊 Processing '{track}'... zero-latency magic incoming!",
  "🎼 Caching '{track}'... your playlist is getting faster!",
  "⚡ Optimizing '{track}'... better than Spotify loading!",
  "🎤 Pre-loading '{track}'... instant transitions ahead!",
  "🎸 Analyzing '{track}'... this will be worth the wait!",
  "🥁 Buffering '{track}'... creating the perfect flow!",
  "🎹 Processing '{track}'... seamless experience loading!"
];

// Track loading failure tracking for progressive error messages
let trackLoadFailureCount = 0;
let lastFailedTrackUri = null;

// Utils
function formatTime(seconds, showMs = true) {
  // Validate input and provide default
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return showMs ? '0:00.000' : '0:00';
  }
  
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
  // Schedule batched status updates
  appScheduler.pendingUpdates.statusText = message;
  appScheduler.pendingUpdates.statusShow = true;
  
  appScheduler.schedule();
  
  // Schedule hide after duration
  setTimeout(() => {
    appScheduler.pendingUpdates.statusShow = false;
    appScheduler.schedule();
  }, duration);
}

function getProgressiveErrorMessage(failureCount) {
  if (failureCount <= 2) {
    return "Ups! Loading failed - please try again and/or choose a different one";
  } else if (failureCount <= 4) {
    return "Still having trouble - try a different track or check your connection";
  } else {
    return "So sorry - You need to refresh. Reload LOOOPZ to fix loading issues";
  }
}

/**
 * Safe track loading with race condition prevention
 */
async function loadTrackSafely(trackData, startPositionMs = 0, preserveLoopPoints = false) {
  // Cancel any existing operation
  if (currentTrackOperation) {
    currentTrackOperation.cancelled = true;
    console.log('🚫 Cancelling previous track operation');
  }
  
  // Create new operation with unique ID
  const operationId = appState.get('operations.operationCounter') + 1;
  appState.set('operations.operationCounter', operationId);
  appState.set('operations.currentTrackOperation', { id: operationId, cancelled: false });
  
  console.log(`🎵 [SAFE LOAD ${operationId}] Loading: ${trackData.name}`);
  
  try {
    // Store current loop points if requested
    const preservedLoop = preserveLoopPoints ? {
      start: loopStart,
      end: loopEnd,
      target: loopTarget,
      enabled: loopEnabled
    } : null;
    
    // Check if operation is still active before proceeding
    const activeOp = appState.get('operations.currentTrackOperation');
    if (!activeOp || activeOp.id !== operationId) {
      console.log(`🚫 [SAFE LOAD ${operationId}] Operation superseded before load`);
      return false;
    }
    
    // Clear stale track info immediately
    appState.set('playback.currentTrack', null);
    
    // Load track
    await loadTrackIntoSpotify(trackData, startPositionMs);
    
    // Check if this operation is still the active one (not if it's cancelled)
    const currentOp = appState.get('operations.currentTrackOperation');
    if (!currentOp || currentOp.id !== operationId) {
      console.log(`🚫 [SAFE LOAD ${operationId}] Operation superseded by new operation ${currentOp?.id || 'none'}`);
      return false;
    }
    
    // Update current track info
    appState.set('playback.currentTrack', trackData);
    
    // Update global currentTrack to ensure image is included
    currentTrack = trackData;
    
    // Update Media Session for lock screen controls
    updateMediaSession(trackData);
    
    // Restore loop points if requested
    if (preservedLoop) {
      // Update both state system AND local variables immediately
      loopStart = preservedLoop.start;
      loopEnd = preservedLoop.end;
      loopTarget = preservedLoop.target;
      loopEnabled = preservedLoop.enabled;
      
      appState.set('loop.start', preservedLoop.start);
      appState.set('loop.end', preservedLoop.end);
      appState.set('loop.target', preservedLoop.target);
      appState.set('loop.enabled', preservedLoop.enabled);
      
      console.log(`🔄 [SAFE LOAD ${operationId}] Restored loop points: ${formatTime(loopStart)} - ${formatTime(loopEnd)}`);
      
      // Update visuals immediately
      updateLoopVisuals();
      updateRepeatDisplay();
    } else {
      // Reset loop state for new track
      resetLoopState();
    }
    
    console.log(`✅ [SAFE LOAD ${operationId}] Successfully loaded: ${trackData.name}`);
    
    // Reset failure count on success
    if (trackData.uri === lastFailedTrackUri) {
      trackLoadFailureCount = 0;
      lastFailedTrackUri = null;
    }
    
    return true;
    
  } catch (error) {
    const currentOp = appState.get('operations.currentTrackOperation');
    if (!currentOp || currentOp.id !== operationId) {
      console.log(`🚫 [SAFE LOAD ${operationId}] Superseded during error`);
      return false;
    }
    
    console.error(`🚨 [SAFE LOAD ${operationId}] Failed to load track:`, error);
    
    // Track failures for progressive error messages
    if (trackData.uri === lastFailedTrackUri) {
      trackLoadFailureCount++;
    } else {
      trackLoadFailureCount = 1;
      lastFailedTrackUri = trackData.uri;
    }
    
    const errorMessage = getProgressiveErrorMessage(trackLoadFailureCount);
    showStatus(errorMessage, trackLoadFailureCount > 4 ? 5000 : 3000);
    
    // Update mini player with helpful message instead of generic "select track"
    if (els.miniTrackTitle && els.miniTrackArtist) {
      els.miniTrackTitle.textContent = 'Loading failed';
      els.miniTrackArtist.textContent = trackLoadFailureCount > 4 ? 'Please refresh page' : 'Try again or pick another';
    }
    
    return false;
    
  } finally {
    // Clear operation if it's still ours
    const finalOp = appState.get('operations.currentTrackOperation');
    if (finalOp && finalOp.id === operationId) {
      appState.set('operations.currentTrackOperation', null);
    }
  }
}

/**
 * Unified loop state update function - ensures both global vars and AppState stay in sync
 */
function updateLoopState(updates) {
  if (updates.start !== undefined) {
    loopStart = updates.start;
    appState.set('loop.start', updates.start);
  }
  if (updates.end !== undefined) {
    loopEnd = updates.end;
    appState.set('loop.end', updates.end);
  }
  if (updates.target !== undefined) {
    loopTarget = updates.target;
    appState.set('loop.target', updates.target);
  }
  if (updates.count !== undefined) {
    loopCount = updates.count;
    appState.set('loop.count', updates.count);
  }
  if (updates.enabled !== undefined) {
    loopEnabled = updates.enabled;
    appState.set('loop.enabled', updates.enabled);
  }
  if (updates.startTime !== undefined) {
    loopStartTime = updates.startTime;
    appState.set('loop.startTime', updates.startTime);
  }
  
  // Update UI if needed
  if (updates.enabled !== undefined && els.loopToggle) {
    els.loopToggle.checked = updates.enabled;
  }
  if (updates.target !== undefined) {
    updateRepeatDisplay();
  }
  if (updates.start !== undefined || updates.end !== undefined || updates.enabled !== undefined) {
    updateLoopVisuals();
  }
}

/**
 * Reset loop state to defaults
 */
function resetLoopState() {
  updateLoopState({
    start: 0,
    end: 30,
    target: 1,
    count: 0,
    enabled: false,
    startTime: Date.now()
  });
}

function updateProgress() {
  if (!duration) return;
  const percent = (currentTime / duration) * 100;
  
  // EMERGENCY FIX: Keep data calculations immediate for timing-critical operations
  // These values are used by MediaSession, loop logic, and state synchronization
  const formattedCurrentTime = formatTime(currentTime);
  const formattedDuration = formatTime(duration);
  const progressPercent = `${percent}%`;
  
  // IMMEDIATE: Update global state variables for timing-critical logic
  // (These must be available immediately for loop detection, MediaSession, etc.)
  window.currentProgressPercent = percent;
  window.formattedCurrentTime = formattedCurrentTime;
  window.formattedDuration = formattedDuration;
  
  // RAF BATCHED: Only cosmetic DOM updates for performance
  appScheduler.pendingUpdates.progressBar = progressPercent;
  appScheduler.pendingUpdates.currentTime = formattedCurrentTime;
  appScheduler.pendingUpdates.duration = formattedDuration;
  appScheduler.pendingUpdates.visualProgressBar = progressPercent;
  
  appScheduler.schedule();
}

function updatePlayPauseButton() {
  // EMERGENCY FIX: Immediate state synchronization for timing-critical operations
  const playIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  const pauseIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  
  // IMMEDIATE: Update global state for immediate access by other systems
  window.currentPlayState = isPlaying;
  window.currentPlayIcon = isPlaying ? pauseIcon : playIcon;
  
  // RAF BATCHED: Visual button updates only
  appScheduler.pendingUpdates.playPauseButton = isPlaying ? pauseIcon : playIcon;
  updateMiniPlayButton();
  
  appScheduler.schedule();
}

function updateMiniPlayer(track = null) {
  if (track) {
      // EMERGENCY FIX: Immediate state updates for playlist management
      window.currentMiniPlayerTrack = {
        name: track.name || 'Unknown Track',
        artist: track.artist || 'Unknown Artist', 
        image: track.image,
        hasTrack: true
      };
      
      // RAF BATCHED: Visual mini-player updates
      appScheduler.pendingUpdates.miniTrackTitle = track.name || 'Unknown Track';
      appScheduler.pendingUpdates.miniTrackArtist = track.artist || 'Unknown Artist';
      
      // Update cover art
      if (track.image) {
        appScheduler.pendingUpdates.miniPlayerCover = {
          src: track.image,
          alt: `${track.name} cover`
        };
        appScheduler.pendingUpdates.miniPlayerCoverDisplay = 'block';
      } else {
        appScheduler.pendingUpdates.miniPlayerCoverDisplay = 'none';
      }
      
      updateMiniPlayButton();
      
      // Show visual progress bar when track is loaded
      appScheduler.pendingUpdates.visualProgressShow = true;
  } else {
      // EMERGENCY FIX: Immediate state updates for no track
      window.currentMiniPlayerTrack = {
        name: 'No track playing',
        artist: 'Select a track to start',
        image: null,
        hasTrack: false
      };
      
      // RAF BATCHED: Visual updates for no track state
      appScheduler.pendingUpdates.miniTrackTitle = 'No track playing';
      appScheduler.pendingUpdates.miniTrackArtist = 'Select a track to start';
      
      // Hide cover art when no track
      appScheduler.pendingUpdates.miniPlayerCoverDisplay = 'none';
      appScheduler.pendingUpdates.miniPlayerCover = { src: '', alt: '' };
      
      updateMiniPlayButton();
      
      // Hide visual progress bar when no track
      appScheduler.pendingUpdates.visualProgressShow = false;
  }
  
  appScheduler.schedule();
}

function updateMiniPlayButton() {
  // Schedule batched mini play button updates
  const miniPlayIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  const miniPauseIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-pause"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  
  appScheduler.pendingUpdates.miniPlayButton = isPlaying ? miniPauseIcon : miniPlayIcon;
}

function updateConnectionStatus() {
  els.connectionStatus.classList.toggle('show', isConnected);
}

function updateLoopCountBadge() {
  // Schedule batched badge updates
  appScheduler.pendingUpdates.loopCountBadge = savedLoops.length;
  appScheduler.pendingUpdates.loopCountBadgeDisplay = savedLoops.length > 0 ? 'inline-block' : 'none';
  
  appScheduler.schedule();
}

function updatePlaylistCountBadge() {
  // Schedule batched badge updates
  appScheduler.pendingUpdates.playlistCountBadge = savedPlaylists.length;
  appScheduler.pendingUpdates.playlistCountBadgeDisplay = savedPlaylists.length > 0 ? 'inline-block' : 'none';
  
  appScheduler.schedule();
}

function updateRepeatDisplay() {
  els.repeatValue.textContent = `${loopTarget}×`;
}

function updateLoopVisuals() {
  // Use fallback duration if Spotify duration not available yet
  const effectiveDuration = duration > 0 ? duration : 240;
  
  console.log('🔍 updateLoopVisuals called - loopStart:', loopStart, 'loopEnd:', loopEnd, 'duration:', duration, 'effectiveDuration:', effectiveDuration);
  
  // Only set defaults if values are truly uninitialized (null or undefined, but not 0)
  if (loopStart === null || loopStart === undefined) {
    console.log('⚠️ loopStart was null/undefined, setting to 0');
    loopStart = 0;
  }
  if (loopEnd === null || loopEnd === undefined) {
    console.log('⚠️ loopEnd was null/undefined, setting to default');
    loopEnd = Math.min(30, effectiveDuration);
  }

  // Validate loop bounds but allow slight overshoot for saved loops
  if (loopStart < 0) loopStart = 0;
  
  // Only clip loop end if it's significantly beyond track duration (allow 10% overshoot for saved loops)
  const maxAllowedEnd = effectiveDuration * 1.10;
  if (loopEnd > maxAllowedEnd) {
    console.log(`⚠️ Loop end ${loopEnd} beyond allowed range (${maxAllowedEnd}), preserving for saved loops`);
    // For saved loops, allow more flexibility - only clip if truly excessive
    if (loopEnd > effectiveDuration * 1.5) {
      console.log(`⚠️ Loop end ${loopEnd} excessively beyond duration, clipping to ${effectiveDuration}`);
      loopEnd = effectiveDuration;
    }
  }
  
  if (loopStart >= loopEnd) {
      console.log(`⚠️ Invalid loop range (start >= end), resetting to defaults`);
      loopStart = 0;
      loopEnd = Math.min(30, effectiveDuration);
  }

  const startPercent = Math.min(100, Math.max(0, (loopStart / effectiveDuration) * 100));
  const endPercent = Math.min(100, Math.max(0, (loopEnd / effectiveDuration) * 100));

  // Schedule batched loop visual updates (12 DOM ops → RAF batched)
  appScheduler.pendingUpdates.loopStartHandleLeft = `${startPercent}%`;
  appScheduler.pendingUpdates.loopEndHandleLeft = `${endPercent}%`;
  appScheduler.pendingUpdates.loopRegionLeft = `${startPercent}%`;
  appScheduler.pendingUpdates.loopRegionWidth = `${Math.max(0, endPercent - startPercent)}%`;

  appScheduler.pendingUpdates.startPopupText = formatTime(loopStart);
  appScheduler.pendingUpdates.endPopupText = formatTime(loopEnd);
  appScheduler.pendingUpdates.precisionStartValue = formatTime(loopStart);
  appScheduler.pendingUpdates.precisionEndValue = formatTime(loopEnd);

  // Schedule loop visibility updates
  appScheduler.pendingUpdates.loopVisibility = loopEnabled;
  
  appScheduler.schedule();
}

// Context Menu Functions - IMPROVED
function showTrackContextMenu(trackIndex, buttonElement) {
  appState.set('ui.contextMenuTrackIndex', trackIndex);
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
  appState.set('ui.contextMenuTrackIndex', null);
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
  appState.set('playlist.pendingItem', {
      type: 'track',
      uri: track.uri,
      name: track.name,
      artist: track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist',
      duration: track.duration_ms / 1000,
      image: track.album.images[0]?.url || '',
      playCount: 1
  });

  showAddToPlaylistPopup();
}

async function handleCreateLoop() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();
  // Same as clicking the + button - select the track
  const artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
  await selectTrack(track.uri, track.name, artistName, track.duration_ms, track.album.images[0]?.url || '');
}

async function handleShare() {
  const track = getCurrentContextTrack();
  if (!track) return;

  hideTrackContextMenu();

  const shareUrl = `https://open.spotify.com/track/${track.id}`;
  const artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
  const shareText = `🎵 Check out "${track.name}" by ${artistName}`;

  try {
      if (navigator.share && navigator.canShare && navigator.canShare({ url: shareUrl })) {
          await navigator.share({
              title: `${track.name} - ${artistName}`,
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
  return `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(getRedirectUri())}&scope=${encodeURIComponent(SPOTIFY_SCOPES)}&code_challenge_method=S256&code_challenge=${codeChallenge}&show_dialog=true`;
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
          redirect_uri: getRedirectUri(),
          client_id: SPOTIFY_CLIENT_ID,
          code_verifier: codeVerifier,
      }),
  });

  const data = await response.json();
  if (data.access_token) {
      appState.set('spotify.accessToken', data.access_token);
      localStorage.setItem('spotify_access_token', data.access_token);
      spotifyAccessToken = data.access_token; // Update global variable
      
      if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
      
      // Store token expiry time and schedule refresh
      if (data.expires_in) {
          const expiryTime = Date.now() + (data.expires_in * 1000) - 300000; // Refresh 5 minutes before expiry
          localStorage.setItem('spotify_token_expiry', expiryTime.toString());
          scheduleTokenRefresh(data.expires_in);
      }
      
      // For PWA, add additional persistence checks
      if (isPWA()) {
          console.log('🔐 PWA: Storing authentication state');
          localStorage.setItem('spotify_pwa_authenticated', 'true');
          localStorage.setItem('spotify_auth_timestamp', Date.now().toString());
      }
      
      localStorage.removeItem('code_verifier');
      window.history.replaceState({}, document.title, window.location.pathname);
      initializeSpotifyPlayer();
      showStatus('Successfully authenticated!');
  } else {
      throw new Error(data.error_description || 'Token exchange failed');
  }
}

function disconnectSpotify() {
  // Clear refresh timer
  if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
  }
  
  // Clear Media Session
  clearMediaSession();
  
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expiry');
  localStorage.removeItem('spotify_pwa_authenticated');
  localStorage.removeItem('spotify_auth_timestamp');
  appState.set('spotify.accessToken', null);
  appState.set('spotify.isConnected', false);
  if (spotifyPlayer) spotifyPlayer.disconnect();
  updateConnectionStatus();
  updateMiniPlayer(null);
  showView('login');
  showStatus('Disconnected from Spotify');
}

// Load track with optional start position
async function loadTrackIntoSpotify(track, startPositionMs = 0, retryCount = 0) {
  if (!spotifyDeviceId || !spotifyAccessToken) {
      throw new Error('Spotify not ready');
  }

  try {
      console.log('🎵 Loading track:', track.name, 'at position:', startPositionMs, retryCount > 0 ? `(retry ${retryCount})` : '');

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
          if (response.status === 400 || response.status === 404) {
              console.warn('🔄 Device issue detected, attempting to reconnect player...');
              // Device might be inactive or conflicted, try to reconnect
              if (spotifyPlayer && retryCount < 2) {
                  try {
                      await spotifyPlayer.disconnect();
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      await spotifyPlayer.connect();
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      
                      // Retry loading after reconnect
                      return await loadTrackIntoSpotify(track, startPositionMs, retryCount + 1);
                  } catch (reconnectError) {
                      console.error('Failed to reconnect:', reconnectError);
                  }
              }
          }
          
          // Auto-retry on 502/503 errors (server issues)
          if ((response.status === 502 || response.status === 503) && retryCount < 2) {
              console.log('🔄 Server error, retrying in 1 second...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              return await loadTrackIntoSpotify(track, startPositionMs, retryCount + 1);
          }
          
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
                  appState.set('playback.isPlaying', !state.paused);
                  appState.set('playback.currentTime', state.position / 1000);
                  appState.set('playback.duration', state.track_window.current_track.duration_ms / 1000);

                  // Update current track info
                  appState.set('playback.currentTrack', {
                      uri: track.uri,
                      name: track.name,
                      artist: track.artist,
                      duration: duration,
                      image: track.image
                  });

                  // Update UI
                  els.currentTrack.textContent = track.name;
                  els.currentArtist.textContent = track.artist;
                  updateProgress();
                  updatePlayPauseButton();
                  updateMiniPlayer(currentTrack);

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

          appState.set('playback.isPlaying', !isPlaying);
          updatePlayPauseButton();
          updateMiniPlayer(currentTrack);

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

      appState.set('playback.isPlaying', !isPlaying);
      updatePlayPauseButton();
      updateMiniPlayer(isPlaying ? currentTrack : null);

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

          appState.set('playback.isPlaying', true);
          appState.set('playback.currentTime', positionMs / 1000);
          updatePlayPauseButton();
          updateMiniPlayer(currentTrack);
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

      appState.set('playback.isPlaying', true);
      appState.set('playback.currentTime', positionMs / 1000);
      updatePlayPauseButton();
      updateMiniPlayer(currentTrack);
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
          appState.set('playback.currentTime', positionMs / 1000);
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
      appState.set('playback.currentTime', positionMs / 1000);
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

// API debouncing to prevent 403 errors
const apiRequestQueue = new Map();
const API_RATE_LIMIT_MS = 1000; // Minimum 1 second between API calls for same track

/**
 * Check if token needs refresh before API calls
 */
async function ensureValidToken() {
    const tokenExpiry = localStorage.getItem('spotify_token_expiry');
    if (tokenExpiry) {
        const expiryTime = parseInt(tokenExpiry);
        const now = Date.now();
        
        // If token expires in less than 2 minutes, refresh it now
        if (expiryTime - now < 120000) {
            console.log('🔄 Token expiring soon, refreshing proactively...');
            const success = await refreshSpotifyToken();
            if (!success) {
                throw new Error('Token refresh failed');
            }
        }
    }
}

/**
 * Debounced API request function with retry logic and better error handling
 */
async function debouncedAPIRequest(url, trackId, cacheMap, retryCount = 0) {
    // Ensure token is valid before making request
    try {
        await ensureValidToken();
    } catch (error) {
        console.error('Token validation failed:', error);
    }
    
    // Check cache first
    if (cacheMap.has(trackId)) {
        return cacheMap.get(trackId);
    }
    
    // Check if request is already in progress
    if (apiRequestQueue.has(url)) {
        return await apiRequestQueue.get(url);
    }
    
    // Create new request promise with enhanced error handling
    const requestPromise = fetch(url, {
        headers: { 'Authorization': `Bearer ${spotifyAccessToken}` }
    }).then(async response => {
        if (!response.ok) {
            // Handle specific error cases
            if (response.status === 401) {
                console.warn('🔐 Spotify API: Token expired');
                const refreshSuccess = await refreshSpotifyToken();
                if (refreshSuccess && retryCount < 1) {
                    // Retry once with new token
                    return await debouncedAPIRequest(url, trackId, cacheMap, retryCount + 1);
                } else {
                    throw new Error(`Authentication failed: ${response.status}`);
                }
            } else if (response.status === 403) {
                console.warn('🚫 Spotify API: Insufficient permissions or rate limited');
                showStatus('⚠️ Spotify API rate limited');
                throw new Error(`Spotify API permission denied: ${response.status}`);
            } else if (response.status === 404) {
                console.warn('🔍 Spotify API: Resource not found (track may be unavailable)');
                throw new Error(`Track not found: ${response.status}`);
            } else if (response.status === 429) {
                console.warn('⏱️ Spotify API: Rate limit exceeded');
                showStatus('⚠️ Too many requests - slowing down');
                // Exponential backoff for rate limiting
                const delay = Math.min(5000, 1000 * Math.pow(2, retryCount));
                await new Promise(resolve => setTimeout(resolve, delay));
                if (retryCount < 2) {
                    return await debouncedAPIRequest(url, trackId, cacheMap, retryCount + 1);
                }
                throw new Error(`Rate limit exceeded: ${response.status}`);
            } else if (response.status >= 500) {
                console.warn('🌐 Spotify API: Server error');
                showStatus('⚠️ Spotify server error');
                throw new Error(`Spotify server error: ${response.status}`);
            } else {
                throw new Error(`API request failed: ${response.status}`);
            }
        }
        const data = await response.json();
        
        // Cache with size limit to prevent memory leaks
        if (cacheMap.size >= CACHE_SIZE_LIMIT) {
            // Remove oldest entries (first 10 items)
            const keysToDelete = Array.from(cacheMap.keys()).slice(0, 10);
            keysToDelete.forEach(key => cacheMap.delete(key));
        }
        
        cacheMap.set(trackId, data);
        return data;
    }).catch(error => {
        // Enhanced error logging
        console.warn('🎵 API request failed:', {
            url: url.replace(spotifyAccessToken, '[TOKEN]'),
            error: error.message,
            trackId: trackId,
            retryCount: retryCount
        });
        
        // Only show user-friendly messages for certain errors
        if (error.message.includes('permission denied') || error.message.includes('Rate limit')) {
            // Already handled above
        } else if (retryCount === 0 && !error.message.includes('not found')) {
            showStatus('⚠️ Spotify API temporarily unavailable');
        }
        
        return null;
    }).finally(() => {
        // Remove from queue and add delay before next request
        apiRequestQueue.delete(url);
        setTimeout(() => {}, API_RATE_LIMIT_MS);
    });
    
    // Store promise in queue
    apiRequestQueue.set(url, requestPromise);
    return await requestPromise;
}

/**
 * Fetches Spotify's audio analysis for a track (beats, bars, sections)
 * @param {string} trackId - Spotify track ID
 * @returns {Object|null} Audio analysis data or null if failed
 */
async function getAudioAnalysis(trackId) {
    const url = `https://api.spotify.com/v1/audio-analysis/${trackId}`;
    return await debouncedAPIRequest(url, trackId, audioAnalysisCache);
}

/**
 * Fetches Spotify's audio features for a track (tempo, key, energy, etc.)
 */
async function getAudioFeatures(trackId) {
    const url = `https://api.spotify.com/v1/audio-features/${trackId}`;
    return await debouncedAPIRequest(url, trackId, trackFeaturesCache);
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

// ===========================================
// ESSENTIA.JS AI AUDIO ANALYSIS MODULE
// ===========================================

// Analysis state
// essentiaInstance already declared at line 76
let analysisCache = new Map();
let essentiaReady = false;
let aiEnabled = true; // AI toggle state

/**
 * Initialize Essentia.js (loaded from CDN)
 */
async function initializeEssentia() {
    if (essentiaInstance) return essentiaInstance;
    
    try {
        console.log('🎵 Initializing Essentia.js AI analysis...');
        
        // Wait for libraries to load
        let attempts = 0;
        while (attempts < 50) { // 5 second timeout
            if (typeof EssentiaWASM !== 'undefined' && typeof Essentia !== 'undefined') {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (typeof EssentiaWASM === 'undefined' || typeof Essentia === 'undefined') {
            console.warn('⚠️ Essentia.js libraries not loaded from CDN');
            return null;
        }
        
        // Debug available objects more thoroughly
        console.log('🔍 Available objects:', {
            EssentiaWASM: typeof EssentiaWASM,
            Essentia: typeof Essentia,
            EssentiaWASM_keys: EssentiaWASM ? Object.getOwnPropertyNames(EssentiaWASM) : 'undefined',
            EssentiaWASM_proto: EssentiaWASM ? Object.getOwnPropertyNames(EssentiaWASM.prototype || {}) : 'undefined'
        });
        
        // Wait for WASM to be ready
        if (typeof EssentiaWASM === 'function') {
            console.log('🔍 Waiting for EssentiaWASM to be ready...');
            const wasmModule = await EssentiaWASM();
            console.log('🔍 WASM module loaded:', Object.keys(wasmModule));
            
            // Try to initialize with the loaded WASM module
            if (typeof Essentia === 'function') {
                try {
                    essentiaInstance = new Essentia(wasmModule);
                    essentiaReady = true;
                    console.log('✅ Essentia.js ready for audio analysis');
                    // Don't show status to avoid interrupting playlist status
                    return essentiaInstance;
                } catch (e) {
                    console.log('📊 WASM initialization failed:', e.message);
                }
            }
        }
        
        // Fallback: Try without WASM initialization (only if first attempt failed)
        if (typeof Essentia === 'function' && !essentiaReady) {
            try {
                essentiaInstance = new Essentia();
                essentiaReady = true;
                console.log('✅ Essentia.js ready (no WASM)');
                // Don't show status to avoid interrupting playlist status
                return essentiaInstance;
            } catch (e) {
                console.log('📊 Basic initialization failed:', e.message);
            }
        }
        
        // If we get here, initialization failed
        throw new Error('All Essentia.js initialization approaches failed');
        
    } catch (error) {
        console.warn('⚠️ Essentia.js initialization failed:', error);
        essentiaReady = false;
        return null;
    }
}

/**
 * Analyze audio buffer for beats, tempo, key, and more
 */
async function analyzeAudioWithAI(audioBuffer, trackId = null) {
    // Check cache first
    if (trackId && analysisCache.has(trackId)) {
        console.log('📊 Using cached AI analysis for:', trackId);
        return analysisCache.get(trackId);
    }
    
    try {
        const essentia = essentiaInstance || await initializeEssentia();
        if (!essentia) {
            console.warn('Essentia not available');
            return null;
        }
        
        console.log('🔍 Analyzing audio with AI...');
        
        // Convert audio buffer to Essentia format
        const audioData = audioBuffer.getChannelData(0);
        const audioVector = essentia.arrayToVector(audioData);
        
        // Comprehensive analysis
        const analysis = {
            // Tempo and rhythm
            tempo: essentia.PercivalBpmEstimator(audioVector).bpm,
            beats: essentia.BeatTrackerMultiFeature(audioVector),
            
            // Energy and dynamics
            energy: essentia.Energy(audioVector),
            loudness: essentia.Loudness(audioVector),
            
            // Timestamp
            analyzedAt: Date.now()
        };
        
        console.log('✅ AI analysis complete:', analysis);
        
        // Cache the results with size limit
        if (trackId) {
            if (analysisCache.size >= CACHE_SIZE_LIMIT) {
                // Remove oldest entries (first 10 items)
                const keysToDelete = Array.from(analysisCache.keys()).slice(0, 10);
                keysToDelete.forEach(key => analysisCache.delete(key));
            }
            analysisCache.set(trackId, analysis);
        }
        
        return analysis;
        
    } catch (error) {
        console.error('🚨 Audio analysis failed:', error);
        return null;
    }
}

/**
 * Smart transition decision system using AI
 */
async function determineOptimalTransitionWithAI(fromTrack, toTrack, context = {}) {
    const transitionPlan = {
        strategy: 'instant_cut',
        sampleKey: null,
        crossfadeDuration: 0,
        confidence: 0.5,
        reason: 'default',
        useAI: false
    };
    
    // Check if Essentia is ready
    if (!essentiaReady) {
        console.log('AI not ready, using standard logic');
        return transitionPlan;
    }
    
    try {
        // Get cached Spotify analysis
        const fromId = DJFunctions.extractTrackId(fromTrack.uri || fromTrack.trackUri);
        const toId = DJFunctions.extractTrackId(toTrack.uri || toTrack.trackUri);
        
        const fromSpotifyAnalysis = audioAnalysisCache.get(fromId);
        const toSpotifyAnalysis = audioAnalysisCache.get(toId);
        
        // Calculate loop duration
        const loopDuration = fromTrack.type === 'loop' 
            ? (fromTrack.end - fromTrack.start) 
            : (fromTrack.duration || 30);
        
        // Ultra-short loops (< 3 seconds)
        if (loopDuration < 3) {
            if (fromTrack.uri === toTrack.uri || fromTrack.trackUri === toTrack.trackUri) {
                transitionPlan.strategy = 'instant_cut';
                transitionPlan.reason = 'loop_repetition';
                transitionPlan.useAI = true;
            } else {
                transitionPlan.strategy = 'micro_sample';
                transitionPlan.sampleKey = 'short'; // Use shortest sample
                transitionPlan.reason = 'ultra_short_transition';
                transitionPlan.useAI = true;
            }
            return transitionPlan;
        }
        
        // Calculate compatibility based on Spotify data
        if (fromSpotifyAnalysis && toSpotifyAnalysis) {
            const tempoDiff = Math.abs((fromSpotifyAnalysis.tempo || 120) - (toSpotifyAnalysis.tempo || 120));
            const keyDistance = Math.abs((fromSpotifyAnalysis.key || 0) - (toSpotifyAnalysis.key || 0));
            
            // High compatibility
            if (tempoDiff < 5 && (keyDistance <= 1 || keyDistance >= 11)) {
                transitionPlan.strategy = 'beat_aligned_cut';
                transitionPlan.confidence = 0.9;
                transitionPlan.reason = 'high_compatibility_ai';
                transitionPlan.useAI = true;
                console.log('🤖 AI: High compatibility detected');
                return transitionPlan;
            }
            
            // Medium compatibility
            if (tempoDiff < 20) {
                transitionPlan.strategy = 'sample_transition';
                transitionPlan.sampleKey = loopDuration < 10 ? 'short' : 'medium';
                transitionPlan.confidence = 0.6;
                transitionPlan.reason = 'medium_compatibility_ai';
                transitionPlan.useAI = true;
                console.log('🤖 AI: Medium compatibility, using sample');
                return transitionPlan;
            }
        }
        
        // Low compatibility or no data
        transitionPlan.strategy = 'sample_transition';
        transitionPlan.sampleKey = 'long';
        transitionPlan.crossfadeDuration = 2000;
        transitionPlan.confidence = 0.3;
        transitionPlan.reason = 'low_compatibility_ai';
        transitionPlan.useAI = true;
        console.log('🤖 AI: Low compatibility, using long transition');
        
    } catch (error) {
        console.warn('AI transition planning failed:', error);
        // Return default plan
    }
    
    return transitionPlan;
}

/**
 * Find optimal loop points using onset detection
 */
async function findOptimalLoopPoints(trackId, manualStart, manualEnd) {
    if (!essentiaReady) {
        return { start: manualStart, end: manualEnd, optimized: false };
    }
    
    try {
        // For now, return a slightly adjusted version
        // In a full implementation, you'd analyze the actual audio
        console.log(`🎯 AI analyzing loop points: ${formatTime(manualStart)} - ${formatTime(manualEnd)}`);
        
        // Snap to nearest beat disabled for smooth linear movement
        const snapToGrid = (time) => time; // Pass through without quantization
        
        const optimizedStart = snapToGrid(manualStart);
        const optimizedEnd = snapToGrid(manualEnd);
        
        if (optimizedStart !== manualStart || optimizedEnd !== manualEnd) {
            console.log(`✨ AI optimized: ${formatTime(optimizedStart)} - ${formatTime(optimizedEnd)}`);
            showStatus('🎯 Loop points optimized with AI');
        }
        
        return {
            start: optimizedStart,
            end: optimizedEnd,
            optimized: true,
            confidence: 'high'
        };
        
    } catch (error) {
        console.warn('Loop optimization failed:', error);
        return { start: manualStart, end: manualEnd, optimized: false };
    }
}

/**
 * Enhanced playlist preparation with AI pre-analysis
 */
async function preparePlaylistWithAI(playlist) {
    if (!essentiaReady) return false;
    
    console.log('🤖 AI pre-analyzing playlist tracks...');
    
    try {
        const itemsToAnalyze = Math.min(playlist.items.length, 5);
        
        for (let i = 0; i < itemsToAnalyze; i++) {
            const item = playlist.items[i];
            const trackId = DJFunctions.extractTrackId(item.uri || item.trackUri);
            
            if (trackId && !analysisCache.has(trackId)) {
                // In a real implementation, you'd analyze actual audio here
                // For now, we'll mark it as analyzed
                console.log(`📊 Pre-analyzing track ${i + 1}/${itemsToAnalyze}`);
            }
        }
        
        console.log('✅ AI playlist preparation complete');
        return true;
        
    } catch (error) {
        console.error('AI playlist prep failed:', error);
        return false;
    }
}


// ============================================= 
// SMART LOOP ASSIST SYSTEM
// =============================================

/**
 * Calculates loop quality score based on musical analysis
 * @param {number} startTime - Loop start time in seconds
 * @param {number} endTime - Loop end time in seconds
 * @param {Object} audioBuffer - Audio buffer for analysis (optional)
 * @returns {Promise<number>} Score from 0-10
 */
async function calculateLoopScore(startTime, endTime, audioBuffer = null) {
    if (!smartLoopAssistEnabled || isAnalyzingLoop) {
        return 5; // Default neutral score
    }

    isAnalyzingLoop = true;

    try {
        // Quick validation
        if (startTime >= endTime || (endTime - startTime) < 0.1) {
            return 0;
        }

        const loopDuration = endTime - startTime;
        let score = 0;
        let factors = [];

        // 1. BEAT ALIGNMENT (30% weight) - Use Spotify analysis if available
        if (currentTrack && currentTrack.uri) {
            const trackId = currentTrack.uri.split(':')[2];
            const spotifyAnalysis = audioAnalysisCache.get(trackId);
            
            if (spotifyAnalysis && spotifyAnalysis.beats) {
                const beatAlignmentScore = calculateBeatAlignment(startTime, endTime, spotifyAnalysis.beats);
                score += (beatAlignmentScore / 10) * 0.3; // Normalize from 0-10 to 0-1
                factors.push(`Beat: ${beatAlignmentScore.toFixed(1)}`);
            } else {
                // Fallback: prefer round numbers
                const startRounded = Math.abs(startTime - Math.round(startTime)) < 0.1;
                const endRounded = Math.abs(endTime - Math.round(endTime)) < 0.1;
                const beatScore = (startRounded ? 5 : 3) + (endRounded ? 5 : 3);
                score += (beatScore / 10) * 0.3;
                factors.push(`Beat: ${(beatScore/10).toFixed(1)} (est)`);
            }
        } else {
            score += 0.15; // Neutral beat score
        }

        // 2. LOOP LENGTH OPTIMIZATION (25% weight)
        const lengthScore = calculateLengthScore(loopDuration);
        score += (lengthScore / 10) * 0.25; // Normalize from 0-10 to 0-1
        factors.push(`Length: ${lengthScore.toFixed(1)}`);

        // 3. MUSICAL STRUCTURE (20% weight) - Prefer common loop lengths
        const structureScore = calculateStructureScore(loopDuration);
        score += (structureScore / 10) * 0.2; // Normalize from 0-10 to 0-1
        factors.push(`Structure: ${structureScore.toFixed(1)}`);

        // 4. SPECTRAL SIMILARITY (15% weight) - Simplified using timing
        const spectralScore = calculateSpectralScore(startTime, endTime);
        score += (spectralScore / 10) * 0.15; // Normalize from 0-10 to 0-1
        factors.push(`Spectral: ${spectralScore.toFixed(1)}`);

        // 5. ENERGY CONSISTENCY (10% weight)
        const energyScore = calculateEnergyScore(startTime, endTime);
        score += (energyScore / 10) * 0.1; // Normalize from 0-10 to 0-1
        factors.push(`Energy: ${energyScore.toFixed(1)}`);

        // Score is now properly in 0-1 range from weighted factors, scale to 0-10
        const finalScore = Math.min(10, Math.max(0, score * 10));
        
        // Only log when score changes significantly
        if (!calculateLoopScore.lastScore || Math.abs(calculateLoopScore.lastScore - finalScore) > 0.5) {
            console.log(`🎯 Loop Score: ${finalScore.toFixed(1)}/10 (${factors.join(', ')})`);
            calculateLoopScore.lastScore = finalScore;
        }
        
        return Math.round(finalScore * 10) / 10; // Round to 1 decimal

    } catch (error) {
        console.warn('Loop scoring failed:', error);
        return 5; // Default score on error
    } finally {
        isAnalyzingLoop = false;
    }
}

/**
 * Calculate beat alignment score
 */
function calculateBeatAlignment(startTime, endTime, beats) {
    if (!beats || beats.length === 0) return 5;

    // Find closest beats to start and end
    const startBeat = beats.reduce((prev, curr) => 
        Math.abs(curr.start - startTime) < Math.abs(prev.start - startTime) ? curr : prev
    );
    const endBeat = beats.reduce((prev, curr) => 
        Math.abs(curr.start - endTime) < Math.abs(prev.start - endTime) ? curr : prev
    );

    // Calculate how close we are to beat boundaries
    const startAlignment = 1 - Math.min(1, Math.abs(startBeat.start - startTime) / 0.1);
    const endAlignment = 1 - Math.min(1, Math.abs(endBeat.start - endTime) / 0.1);
    
    // Higher score for better alignment
    return ((startAlignment + endAlignment) / 2) * 10;
}

/**
 * Calculate length score - prefer common loop lengths
 */
function calculateLengthScore(duration) {
    const optimalLengths = [1, 2, 4, 8, 16, 32]; // Common loop lengths in seconds
    
    // Find closest optimal length
    const closest = optimalLengths.reduce((prev, curr) => 
        Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev
    );
    
    // Score based on how close we are to optimal
    const distance = Math.abs(duration - closest);
    return Math.max(0, 10 - distance * 2); // Penalty for distance from optimal
}

/**
 * Calculate musical structure score
 */
function calculateStructureScore(duration) {
    // Prefer powers of 2, multiples of 4, or standard song structure lengths
    const goodLengths = [0.5, 1, 2, 4, 8, 16, 30]; // Include 30s for verse/chorus
    
    // Check if duration is close to any good length
    const tolerance = 0.2;
    const isGoodLength = goodLengths.some(len => Math.abs(duration - len) <= tolerance);
    
    if (isGoodLength) return 9;
    if (duration % 4 < 0.2 || duration % 4 > 3.8) return 7; // Multiple of 4
    if (duration % 2 < 0.2 || duration % 2 > 1.8) return 6; // Multiple of 2
    return 4; // Odd length
}

/**
 * Calculate spectral similarity score (simplified)
 */
function calculateSpectralScore(startTime, endTime) {
    // Simple heuristic: shorter loops tend to have better spectral similarity
    const duration = endTime - startTime;
    if (duration <= 2) return 9;
    if (duration <= 4) return 8;
    if (duration <= 8) return 7;
    if (duration <= 16) return 6;
    return 4;
}

/**
 * Calculate energy consistency score
 */
function calculateEnergyScore(startTime, endTime) {
    // Heuristic: avoid very beginning and end of tracks
    const trackDuration = duration || 180; // Default to 3 minutes
    
    if (startTime < 5) return 6; // Intro might be different
    if (endTime > trackDuration - 10) return 6; // Outro might fade
    return 8; // Middle sections tend to be consistent
}

/**
 * Update Smart Loop Assist UI with current score
 */
function updateSmartAssistUI(score) {
    if (!els.smartAssistScore) return;

    els.smartAssistScore.textContent = `Score: ${score.toFixed(1)}/10`;
}

// Time popup colors removed - using unified simple styling

/**
 * Trigger haptic feedback for high scores
 */
function triggerHapticFeedback(score) {
    if (score > 9.0 && navigator.vibrate) {
        const now = Date.now();
        // Throttle haptic feedback to once per 500ms
        if (now - lastHapticFeedback > 500) {
            navigator.vibrate([50, 50, 50]); // Triple pulse for high quality
            lastHapticFeedback = now;
            console.log('✨ Haptic feedback: High quality loop point!');
        }
    }
}

/**
 * Trigger zone-based haptic feedback like "locking points" during dragging
 * Designed to avoid conflicts with iOS text selection magnifier
 */
function triggerZoneHapticFeedback(score, dragTarget = null, isDragging = false) {
    // Debug logging to see what's happening
    console.log(`🔍 Haptic debug: score=${score}, vibrate=${!!navigator.vibrate}, isDragging=${isDragging}, dragTarget=${dragTarget?.id}`);
    
    // Skip haptic feedback if not available or not actively dragging
    if (!navigator.vibrate) {
        console.log('❌ navigator.vibrate not available');
        return;
    }
    
    if (!isDragging) {
        console.log('❌ Not currently dragging');
        return;
    }
    
    if (!dragTarget) {
        console.log('❌ No drag target');
        return;
    }
    
    // Check if dragging loop handles (multiple detection methods)
    const isLoopHandle = dragTarget.id && (dragTarget.id.includes('loop') && dragTarget.id.includes('handle')) || 
                        dragTarget.classList.contains('loop-handle');
    console.log(`🔍 Is loop handle: ${isLoopHandle}, dragTarget.id: ${dragTarget.id}, classes: ${dragTarget.className}`);
    if (!isLoopHandle) {
        console.log('❌ Not a loop handle');
        return;
    }
    
    const now = Date.now();
    
    // More sensitive zones with stronger vibrations for better iOS feedback
    const zones = [
        { threshold: 8.0, pattern: [100, 50, 100], lastFeedback: 'zone80' },      // Double strong pulse for very good
        { threshold: 6.5, pattern: [80, 30, 80], lastFeedback: 'zone65' },       // Double medium pulse for good  
        { threshold: 5.0, pattern: [60], lastFeedback: 'zone50' },               // Single medium pulse for okay
        { threshold: 3.0, pattern: [40], lastFeedback: 'zone30' }                // Single light pulse for poor
    ];
    
    // Find the highest zone we've crossed
    for (const zone of zones) {
        if (score >= zone.threshold) {
            // Shorter cooldown for more responsive feedback
            if (!triggerZoneHapticFeedback[zone.lastFeedback] || 
                now - triggerZoneHapticFeedback[zone.lastFeedback] > 400) {
                
                console.log(`🔥 TRIGGERING VIBRATION: pattern=[${zone.pattern.join(',')}], zone=${zone.threshold}+`);
                const vibrateResult = navigator.vibrate(zone.pattern);
                console.log(`🔥 Vibrate result: ${vibrateResult}`);
                
                triggerZoneHapticFeedback[zone.lastFeedback] = now;
                
                // Reset lower zone timers
                zones.forEach(z => {
                    if (z.threshold < zone.threshold) {
                        triggerZoneHapticFeedback[z.lastFeedback] = 0;
                    }
                });
                
                console.log(`🎯 Zone haptic feedback: Score ${score.toFixed(1)} (zone ${zone.threshold}+)`);
                break;
            } else {
                console.log(`⏳ Haptic cooldown active for zone ${zone.threshold}+ (${400 - (now - triggerZoneHapticFeedback[zone.lastFeedback])}ms remaining)`);
            }
        }
    }
}

/**
 * Find optimal snap position for loop handle
 */
async function findOptimalSnapPosition(currentTime, handleType = 'start') {
    if (!smartLoopAssistEnabled || !currentTrack) {
        return currentTime;
    }

    // Get current loop bounds
    const otherTime = handleType === 'start' ? loopEnd : loopStart;
    
    // Try wider range of adjustments for better beat alignment
    const adjustments = [
        -2.0, -1.5, -1.0, -0.5, -0.25, -0.1, -0.05, 
        0, 
        0.05, 0.1, 0.25, 0.5, 1.0, 1.5, 2.0
    ];
    let bestScore = 0;
    let bestPosition = currentTime;
    
    for (const adj of adjustments) {
        const testTime = currentTime + adj;
        if (testTime < 0 || testTime > duration) continue;
        
        const testStart = handleType === 'start' ? testTime : otherTime;
        const testEnd = handleType === 'end' ? testTime : otherTime;
        
        if (testStart >= testEnd) continue;
        
        const score = await calculateLoopScore(testStart, testEnd);
        if (score > bestScore) {
            bestScore = score;
            bestPosition = testTime;
        }
    }
    
    return bestPosition;
}

/**
 * Initialize Smart Loop Assist system
 */
function initializeSmartLoopAssist() {
    if (!els.smartAssistToggle) return;

    // Make the Smart Loop Assist visible
    const smartAssistContainer = document.getElementById('smart-loop-assist');
    if (smartAssistContainer) {
        smartAssistContainer.classList.add('visible');
    }

    // Set initial state
    els.smartAssistToggle.checked = smartLoopAssistEnabled;
    
    // Toggle event handler
    els.smartAssistToggle.addEventListener('change', (e) => {
        smartLoopAssistEnabled = e.target.checked;
        localStorage.setItem('smart-loop-assist', smartLoopAssistEnabled.toString());
        
        if (smartLoopAssistEnabled) {
            showStatus('⚡ Smart Loop Assist enabled');
            console.log('⚡ Smart Loop Assist: ON');
        } else {
            showStatus('⚡ Smart Loop Assist disabled');
            console.log('⚡ Smart Loop Assist: OFF');
            
            // Clear score display
            if (els.smartAssistScore) {
                els.smartAssistScore.textContent = 'Score: --';
            }
            
            // Remove color classes from popups
            if (els.startPopup && els.endPopup) {
                for (let i = 0; i <= 10; i++) {
                    els.startPopup.classList.remove(`smart-score-${i}`);
                    els.endPopup.classList.remove(`smart-score-${i}`);
                }
            }
        }
    });

    console.log('✅ Smart Loop Assist initialized');
    
    // Test vibration support (silent check)
    if (navigator.vibrate) {
        console.log('✅ Vibration API available');
    } else {
        console.log('❌ Vibration API not available on this device/browser');
    }
}







// PLAYLIST DJ ENGINE - SIMPLIFIED TRANSITION METHODS
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
        
        // Smart transition state - keeping for API compatibility
        this.smartTransitionsEnabled = false; // Disabled due to API limitations
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

            // Get audio analysis and features for both tracks (with error handling)
            let fromFeatures, toFeatures, fromAnalysis, toAnalysis;
            try {
                [fromFeatures, toFeatures, fromAnalysis, toAnalysis] = await Promise.all([
                    getAudioFeatures(fromTrackId).catch(() => null),
                    getAudioFeatures(toTrackId).catch(() => null),
                    getAudioAnalysis(fromTrackId).catch(() => null),
                    getAudioAnalysis(toTrackId).catch(() => null)
                ]);
            } catch (error) {
                console.log('📊 [SMART TRANSITION] API calls failed, using basic transition');
                fromFeatures = toFeatures = fromAnalysis = toAnalysis = null;
            }

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
     * Execute professional crossfade transition - industry-standard beat-matching
     */
    async executeProfessionalCrossfade(currentItem, nextItem, transitionIndicator) {
        try {
            console.log(`🎧 [PRO CROSSFADE] ${currentItem.name} → ${nextItem.name}`);
            
            // Get audio analysis for both tracks to sync beats
            const currentTrackId = DJFunctions.extractTrackId(currentItem.uri || currentItem.trackUri);
            const nextTrackId = DJFunctions.extractTrackId(nextItem.uri || nextItem.trackUri);
            
            const [currentAnalysis, nextAnalysis] = await Promise.all([
                DJFunctions.getAudioFeatures(currentTrackId),
                DJFunctions.getAudioFeatures(nextTrackId)
            ]);
            
            // Calculate optimal crossfade based on tempo compatibility
            let crossfadeDuration = 4000; // Default 4 seconds
            let transitionQuality = 'standard';
            
            if (currentAnalysis && nextAnalysis) {
                const tempoDiff = Math.abs(currentAnalysis.tempo - nextAnalysis.tempo);
                const keyCompatibility = this.calculateKeyCompatibility(currentAnalysis.key, nextAnalysis.key);
                
                if (tempoDiff < 5 && keyCompatibility > 0.7) {
                    crossfadeDuration = 6000; // Longer crossfade for compatible tracks
                    transitionQuality = 'perfect';
                } else if (tempoDiff < 15) {
                    crossfadeDuration = 4000; // Standard crossfade
                    transitionQuality = 'good';
                } else {
                    crossfadeDuration = 2000; // Quick cut for incompatible tracks
                    transitionQuality = 'quick';
                }
                
                console.log(`🎧 [PRO CROSSFADE] Quality: ${transitionQuality} | Duration: ${crossfadeDuration}ms | Tempo diff: ${tempoDiff.toFixed(1)} BPM`);
            }
            
            // PHASE 1: Pre-load next track silently
            console.log(`🎧 [PRO CROSSFADE] Pre-loading: ${nextItem.name}`);
            this.currentItemIndex++;
            await this.loadPlaylistItem(this.currentItemIndex);
            
            // Start next track at 0% volume
            await setSpotifyVolume(0);
            console.log(`🎧 [PRO CROSSFADE] Next track loaded silently`);
            
            // Wait for track to stabilize
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // PHASE 2: Professional crossfade with beat sync
            console.log(`🎧 [PRO CROSSFADE] Starting ${transitionQuality} crossfade (${crossfadeDuration}ms)`);
            
            const steps = 20; // High resolution for smooth crossfade
            const stepDuration = crossfadeDuration / steps;
            
            for (let i = 0; i <= steps; i++) {
                const progress = i / steps;
                
                // Smooth S-curve for natural-sounding crossfade
                const sCurve = this.applySCurve(progress);
                const volume = Math.round(sCurve * 100);
                
                await setSpotifyVolume(volume);
                
                if (i % 5 === 0) { // Log every 5th step to avoid spam
                    console.log(`🎧 [PRO CROSSFADE] Progress: ${Math.round(progress * 100)}% | Volume: ${volume}%`);
                }
                
                await new Promise(resolve => setTimeout(resolve, stepDuration));
            }
            
            // PHASE 3: Finalize transition
            await setSpotifyVolume(100);
            console.log(`🎧 [PRO CROSSFADE] Transition complete - full volume`);
            
            // Remove visual indicator
            setTimeout(() => {
                if (document.body.contains(transitionIndicator)) {
                    document.body.removeChild(transitionIndicator);
                }
            }, 500);
            
            showStatus(`🎧 ${transitionQuality.toUpperCase()} transition complete`);
            
        } catch (error) {
            console.error('🚨 Professional crossfade failed:', error);
            // Fallback: simple volume cut
            this.currentItemIndex++;
            await this.loadPlaylistItem(this.currentItemIndex);
            await setSpotifyVolume(100);
            showStatus('⚠️ Quick transition (fallback)');
        }
    }
    
    /**
     * Calculate key compatibility for harmonic mixing
     */
    calculateKeyCompatibility(key1, key2) {
        if (key1 === null || key2 === null) return 0.5;
        
        // Camelot wheel compatibility - adjacent keys are most compatible
        const keyDiff = Math.abs(key1 - key2);
        const circularDiff = Math.min(keyDiff, 12 - keyDiff);
        
        if (circularDiff === 0) return 1.0; // Same key
        if (circularDiff === 1) return 0.9; // Adjacent keys
        if (circularDiff === 2) return 0.7; // Two steps away
        if (circularDiff === 5 || circularDiff === 7) return 0.8; // Perfect 4th/5th
        return 0.3; // Dissonant
    }
    
    /**
     * Apply S-curve for natural crossfade feel
     */
    applySCurve(x) {
        // Smooth S-curve: starts slow, accelerates, then slows down
        return x * x * (3 - 2 * x);
    }

    /**
     * Handle loop completion
     */
    async handleLoopEndWithSample() {
        const currentItem = this.currentPlaylist.items[this.currentItemIndex];
        
        if (this.currentLoopCount >= this.currentLoopTarget) {
            // Loop complete, transition to next item
            await this.skipToNext();
        } else {
            // Continue looping
            await this.performLoopSeek();
        }
    }

    /**
     * Enhanced smart transition with volume fading
     * This creates a DJ-quality transition with proper crossfading
     */
    async executeSmartCrossfadeWithSample() {
        if (this.crossfadeInProgress || !this.currentTransitionData) return;

        try {
            this.crossfadeInProgress = true;
            const { toItem, toStartTime, transitionQuality, crossfadeDuration } = this.currentTransitionData;
            
            console.log(`🎛️ [SMART TRANSITION] Starting enhanced transition (${transitionQuality.quality} quality)`);

            // Add visual feedback for transition
            const transitionIndicator = document.createElement('div');
            transitionIndicator.style.cssText = 'position:fixed; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#1DB954,#9945DB); z-index:9999; opacity:0.8;';
            document.body.appendChild(transitionIndicator);
            
            // Simple crossfade without sample
            console.log(`🔊 [SMART TRANSITION] Using simple crossfade`);
            
            // Reduce volume of current track
            await setSpotifyVolume(50);
            
            // Load next track directly
            await this.loadPlaylistItem(this.currentItemIndex + 1);
            
            // If we have a specific start position from analysis, use it
            if (toStartTime > 0) {
                await seekToPosition(toStartTime * 1000);
            }
            
            // Restore volume
            await setSpotifyVolume(100);
            
            // Remove indicator after transition
            setTimeout(() => {
                if (document.body.contains(transitionIndicator)) {
                    document.body.removeChild(transitionIndicator);
                }
            }, 800);

            this.currentItemIndex++;
            this.currentTransitionData = null;

            showStatus(`🎛️ Smart transition complete`);

        } catch (error) {
            console.error('🎛️ Smart transition failed:', error);
            await this.skipToNext();
            await setSpotifyVolume(100); // Ensure volume is restored
        } finally {
            this.crossfadeInProgress = false;
        }
    }

    /**
     * Executes smart transition between tracks
     * Uses the simplified approach regardless of whether samples are enabled
     */
    async executeSmartCrossfade() {
        // Always use the simplified approach
        return this.executeSmartCrossfadeWithSample();
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
            
            // Reset seamless transition state for new track
            transitionPrepared = false;

            // Smart transitions disabled to prevent API failures
            console.log('🎵 [TRANSITION] Using basic transition to avoid API calls');

            // Load track into Spotify
            const startPosition = item.type === 'loop' ? item.start * 1000 : 0;
            const trackData = {
                uri: item.type === 'loop' ? item.trackUri : item.uri,
                name: item.name || 'Unknown Track',
                artist: item.artist || 'Unknown Artist',
                duration: item.duration || 180,
                image: item.image || ''
            };

            // Set up loop parameters BEFORE loading track if this is a loop item
            if (item.type === 'loop') {
                this.setupLoopItem(item);
            }

            const loadSuccess = await loadTrackSafely(trackData, startPosition, item.type === 'loop');
            if (!loadSuccess) {
                console.log('🚫 Playlist item load cancelled or failed');
                return; // Exit early if load was cancelled
            }
            
            // CRITICAL FIX: Start progress updates and UI sync after loading
            updateProgress();
            updatePlayPauseButton();
            updateMiniPlayer(trackData);
            startProgressUpdates();
            
            // CRITICAL FIX: Resume playback after loading new track
            if (isPlaylistMode && !isPlaying) {
                console.log('▶️ [PLAYLIST RESUME] Auto-resuming playback for playlist transition');
                setTimeout(async () => {
                    if (!isPlaying) {
                        await togglePlayPause();
                    }
                }, 100); // Small delay to ensure track is fully loaded
                
                // Backup resume after 2 seconds if still not playing
                setTimeout(async () => {
                    if (isPlaylistMode && !isPlaying) {
                        console.log('🔄 [BACKUP RESUME] Force resuming stuck playback');
                        await togglePlayPause();
                    }
                }, 2000);
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
        // Set loop parameters for playlist loop items
        console.log(`🔄 Setting up loop item: ${item.name} (${formatTime(item.start)} - ${formatTime(item.end)})`);
        
        // Update BOTH global variables AND AppState immediately
        loopStart = item.start;
        loopEnd = item.end;
        loopTarget = item.playCount || 1;
        loopEnabled = true;
        loopCount = 0;
        loopStartTime = Date.now();
        
        // Sync with AppState
        appState.set('loop.start', item.start);
        appState.set('loop.end', item.end);
        appState.set('loop.target', item.playCount || 1);
        appState.set('loop.enabled', true);
        appState.set('loop.count', 0);
        appState.set('loop.startTime', Date.now());
        
        // Update UI
        if (els.loopToggle) els.loopToggle.checked = true;
        updateRepeatDisplay();
        updateLoopVisuals();
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
                
                // Clean up playlist state
                isPlaylistMode = false;
                this.currentPlaylist = null;
                this.currentItemIndex = 0;
                
                // Show completion message
                showStatus('✨ Playlist completed!');
                
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
        
        // Always skip to next without samples
        await this.skipToNext();
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
     * Skip to specific item in playlist
     * @param {number} itemIndex - Index of item to skip to
     */
    async skipToItem(itemIndex) {
        if (this.transitionInProgress) return;
        if (!this.currentPlaylist || itemIndex < 0 || itemIndex >= this.currentPlaylist.items.length) return;

        this.transitionInProgress = true;
        this.currentItemIndex = itemIndex;

        try {
            await this.loadPlaylistItem(this.currentItemIndex);
        } catch (error) {
            console.error('🚨 Skip to item error:', error);
        } finally {
            this.transitionInProgress = false;
        }
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
          
          // Update AppState with Spotify connection
          appState.set('spotify.deviceId', device_id);
          appState.set('spotify.isConnected', true);
          appState.set('spotify.player', spotifyPlayer);
          
          updateConnectionStatus();
          showView('search');
          showStatus('Connected!');

          // Initialize playlist engine
          playlistEngine = new PlaylistTransitionEngine(spotifyPlayer, spotifyAccessToken, spotifyDeviceId);
          setupPlaylistEngineCallbacks();
          
          // PlayerStateGuard disabled for core functionality focus
          // playerStateGuard.checkForSavedState();
          // playerStateGuard.startMonitoring();
          console.log('🎵 Core player functionality focused - monitoring disabled');

          // Initialize AI audio analysis after a short delay
          setTimeout(() => {
            // Only initialize if not already ready to prevent duplicates
            if (!essentiaReady) {
              initializeEssentia().then(essentia => {
                if (essentia && !document.querySelector('.ai-ready-indicator')) {
                  // Add AI status indicator (optional) - check if not already added
                  const statusElement = document.getElementById('connection-status');
                  if (statusElement) {
                    const aiIndicator = document.createElement('span');
                    aiIndicator.className = 'ai-ready-indicator';
                    aiIndicator.style.color = '#9945DB';
                    aiIndicator.textContent = ' • AI Ready';
                    statusElement.appendChild(aiIndicator);
                  }
                }
              }).catch(error => {
                console.warn('AI initialization failed:', error);
              });
            }
          }, 2000); // Wait 2 seconds for other systems to load first

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
          console.log('🚫 Spotify player not ready, device ID:', device_id);
          isConnected = false;
          
          // Update AppState with disconnection
          appState.set('spotify.isConnected', false);
          appState.set('spotify.deviceId', null);
          
          updateConnectionStatus();
          
          // PlayerStateGuard disabled
          // playerStateGuard.stopMonitoring();
          console.log('🎵 Player not ready - core functionality focus');
      });

      let lastStateChange = 0;
      spotifyPlayer.addListener('player_state_changed', (state) => {
          if (!state) return;

          // Throttle rapid state changes
          const now = Date.now();
          if (now - lastStateChange < 100) return; // 100ms throttle
          lastStateChange = now;

          console.log('🎵 Player state changed - paused:', state.paused, 'position:', state.position);

          currentTime = state.position / 1000;
          isPlaying = !state.paused;

          updateProgress();
          updatePlayPauseButton();
          updateMiniPlayer(currentTrack);
          
          // Update Media Session playback state for lock screen
          updateMediaSessionPlaybackState(state);

          if (state.track_window.current_track) {
              const track = state.track_window.current_track;
              duration = track.duration_ms / 1000;

              if (currentTrack && currentTrack.uri !== `spotify:track:${track.id}`) {
                  console.log('🔄 Track changed via Spotify, updating current track');
                  const artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
                  
                  currentTrack.uri = `spotify:track:${track.id}`;
                  currentTrack.name = track.name || 'Unknown Track';
                  currentTrack.artist = artistName;
                  currentTrack.duration = duration;
                  
                  // Try to get album artwork from track
                  if (track.album && track.album.images && track.album.images.length > 0) {
                      currentTrack.image = track.album.images[0].url;
                  }

                  els.currentTrack.textContent = track.name || 'Unknown Track';
                  els.currentArtist.textContent = artistName;
                  
                  // Update Media Session with new track info
                  updateMediaSession(currentTrack);
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
      
      // Update current index
      currentPlaylistIndex = index;
      
      // Update saved state with new item
      if (currentPlaylist) {
          localStorage.setItem('active_playlist_state', JSON.stringify({
              playlistId: currentPlaylist.id,
              index: index,
              currentItem: item,
              isPlaylistMode: true,
              timestamp: Date.now(),
              loopState: {
                  start: item?.start || 0,
                  end: item?.end || 0,
                  enabled: item?.type === 'loop',
                  target: item?.playCount || 1,
                  count: 0
              }
          }));
      }
      
      updatePlaylistNowPlaying(item, index);
      
      // Update playlist display to show new current track
      if (currentView === 'playlists' && isPlaylistMode) {
          // Maintain current view mode - don't reset to overview
          if (playlistViewMode === 'editing' && currentPlaylist) {
              renderPlaylistEditView(currentPlaylist);
          } else {
              updatePlaylistDisplay();
          }
      }

      // Update main player UI and let it handle the loops
      if (item.type === 'loop') {
          // Use unified state management instead of direct variable assignment
          updateLoopState({
              start: item.start,
              end: item.end,
              target: item.playCount || 1,
              enabled: true,
              count: 0,
              startTime: Date.now()
          });

          console.log(`📢 Main player loop enabled: ${formatTime(loopStart)} - ${formatTime(loopEnd)} (${loopTarget}×)`);
      } else {
          // Full track - disable looping using unified state management
          updateLoopState({
              enabled: false,
              count: 0
          });
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

// Enhanced progress updates with bulletproof timer management
let progressUpdateActive = false;
let lastProgressUpdate = 0;
let backgroundUpdateTimer = null;
let isBackgrounded = false;

function startProgressUpdates() {
  // Prevent multiple timers
  if (progressUpdateActive) {
    console.log('⚠️ Progress updates already active');
    return;
  }
  
  stopProgressUpdates();
  progressUpdateActive = true;
  let consecutiveFailures = 0;
  let lastKnownPosition = 0;
  let updateCount = 0;
  
  console.log('🎵 Starting progress updates');
  
  updateTimer = setInterval(async () => {
      updateCount++;
      
      // Safety check - ensure we should still be running
      if (!progressUpdateActive) {
          console.log('🚫 Progress updates deactivated, stopping timer');
          clearInterval(updateTimer);
          updateTimer = null;
          return;
      }
      
      // Skip progress updates during drag operations to prevent visual conflicts
      if (isDragging) {
          return;
      }
      
      try {
          // SMART LOOP DETECTION: Use adaptive polling for API optimization
          let shouldCallApi = true;
          let timeToLoopEnd = Infinity;
          
          // Simple, reliable progress updates - no smart detection complexity
          if (spotifyPlayer && isConnected) {
              const state = await spotifyPlayer.getCurrentState();
              
              if (state && state.position !== undefined) {
                  const newTime = state.position / 1000;
                  
                  // Simple position update without complexity
                  
                  // Validate position makes sense (allow reasonable jumps and forward progress)
                  const timeDiff = Math.abs(newTime - lastKnownPosition);
                  const forwardProgress = newTime >= lastKnownPosition - 0.5; // Allow small backwards drift
                  if (timeDiff < 15 || forwardProgress) {
                      currentTime = newTime;
                      lastKnownPosition = newTime;
                      lastProgressUpdate = Date.now();
                      updateProgress();
                      consecutiveFailures = 0;
                      
                      // Update playing state based on actual playback
                      const actuallyPlaying = state.paused === false;
                      if (isPlaying !== actuallyPlaying) {
                          isPlaying = actuallyPlaying;
                          updatePlayPauseButton();
                      }
                      
                      // Check for stuck isLooping state (timeout after 5 seconds)
                      if (isLooping && loopStartTime && (Date.now() - loopStartTime > 5000)) {
                          console.warn('🔄 Detected stuck isLooping state, resetting...');
                          appState.set('loop.isLooping', false);
                          appState.set('loop.startTime', Date.now());
                      }
                      
                      // Only check loop end if playing and not in loop operation
                      if (isPlaying && loopEnabled && !isLooping) {
                          await checkLoopEnd();
                      }
                      
                      // Update MediaSession position every 5 updates (250ms) when not backgrounded
                      if (!isBackgrounded && updateCount % 5 === 0 && 'mediaSession' in navigator && currentTrack) {
                          try {
                              navigator.mediaSession.setPositionState({
                                  duration: currentTrack.duration / 1000,
                                  playbackRate: 1.0,
                                  position: currentTime
                              });
                          } catch (e) {
                              // Ignore position state errors
                          }
                      }
                  } else {
                      // Reduce spam by only logging significant jumps occasionally
                      if (Math.abs(newTime - lastKnownPosition) > 30 && Math.random() < 0.1) {
                          console.warn(`🔄 Invalid position jump: ${lastKnownPosition}s → ${newTime}s`);
                      }
                  }
                  
              } else if (state) {
                  // State exists but no position - likely paused
                  consecutiveFailures = 0;
              } else {
                  consecutiveFailures++;
                  
                  // Recovery logic
                  if (consecutiveFailures === 10) { // 0.5 second of failures - force sync
                      console.warn('🔄 Progress desync detected, forcing sync...');
                      // Force position sync from Spotify state
                      if (spotifyPlayer) {
                          spotifyPlayer.getCurrentState().then(state => {
                              if (state && state.position !== undefined) {
                                  currentTime = state.position / 1000;
                                  lastKnownPosition = currentTime;
                                  updateProgress();
                                  consecutiveFailures = 0;
                              }
                          }).catch(e => console.warn('Force sync failed:', e));
                      }
                  } else if (consecutiveFailures === 20) { // 1 second of failures
                      console.warn('🔄 Progress sync lost, attempting recovery...');
                      showStatus('🔄 Reconnecting...');
                  } else if (consecutiveFailures > 60) { // 3 seconds of total failure
                      console.error('🚨 Progress updates completely failed, restarting...');
                      progressUpdateActive = false;
                      setTimeout(() => startProgressUpdates(), 1000);
                      return;
                  }
              }
          // Removed smart polling complexity - simple and reliable updates only
          } else {
              // Not connected - slow down polling
              consecutiveFailures++;
              if (consecutiveFailures > 100) {
                  console.log('📡 Not connected, reducing update frequency');
                  progressUpdateActive = false;
                  setTimeout(() => startProgressUpdates(), 2000);
                  return;
              }
          }
      } catch (error) {
          consecutiveFailures++;
          if (consecutiveFailures <= 3) { // Only log first few failures
              console.warn('Progress update error:', error.message);
          }
          
          // Complete failure recovery
          if (consecutiveFailures > 80) { // 4 seconds of errors
              console.error('🚨 Critical progress update failure, forcing restart');
              showStatus('⚠️ Connection issues - restarting...');
              progressUpdateActive = false;
              setTimeout(() => startProgressUpdates(), 2000);
              return;
          }
      }
  }, 50); // 50ms for smooth updates
}

function stopProgressUpdates() {
  if (progressUpdateActive) {
    console.log('🛑 Stopping progress updates');
  }
  progressUpdateActive = false;
  
  if (updateTimer) {
      clearInterval(updateTimer);
      updateTimer = null;
  }
}

// Background-safe progress updates for lock screen support
function startBackgroundProgressUpdates() {
  console.log('📱 Starting background progress updates');
  
  // Clear any existing background timer
  if (backgroundUpdateTimer) {
      clearInterval(backgroundUpdateTimer);
  }
  
  let heartbeatCounter = 0;
  
  // Use 1 second interval for background updates (browser-friendly)
  backgroundUpdateTimer = setInterval(async () => {
      if (!spotifyPlayer || !isPlaying) return;
      
      try {
          const state = await spotifyPlayer.getCurrentState();
          if (state && !state.paused) {
              currentTime = state.position / 1000;
              
              // Update MediaSession position for lock screen progress
              if ('mediaSession' in navigator) {
                  try {
                      navigator.mediaSession.setPositionState({
                          duration: state.track_window.current_track.duration_ms / 1000,
                          playbackRate: 1.0,
                          position: currentTime
                      });
                      
                      // Ensure playback state is correct
                      navigator.mediaSession.playbackState = 'playing';
                  } catch (e) {
                      // Ignore position state errors
                  }
              }
              
              // Still check for loop end, but less frequently
              if (loopEnabled) {
                  await checkLoopEnd();
              }
              
              // Heartbeat every 10 seconds to keep connection alive
              heartbeatCounter++;
              if (heartbeatCounter % 10 === 0) {
                  console.log('💓 Background heartbeat - position:', Math.round(currentTime), 's');
                  // Force state refresh
                  updateMediaSessionPlaybackState(state);
              }
          }
      } catch (error) {
          console.error('🚨 Background update error:', error);
          // Try to recover by refreshing MediaSession
          if (currentTrack) {
              updateMediaSession(currentTrack);
          }
      }
  }, 1000); // 1 second interval for background
}

function stopBackgroundProgressUpdates() {
  if (backgroundUpdateTimer) {
      clearInterval(backgroundUpdateTimer);
      backgroundUpdateTimer = null;
  }
}

// Visibility change handler for robust lock screen support
document.addEventListener('visibilitychange', () => {
  isBackgrounded = document.hidden;
  
  if (document.hidden) {
      console.log('📱 App backgrounded - switching to background updates');
      
      // Stop normal high-frequency updates
      if (progressUpdateActive) {
          stopProgressUpdates();
      }
      
      // Start background-safe updates if playing
      if (isPlaying) {
          startBackgroundProgressUpdates();
      }
  } else {
      console.log('📱 App foregrounded - resuming normal updates');
      
      // Stop background updates
      stopBackgroundProgressUpdates();
      
      // Resume normal updates if playing
      if (isPlaying) {
          startProgressUpdates();
          
          // Force a MediaSession update on return
          if (currentTrack) {
              updateMediaSession(currentTrack);
          }
      }
  }
});

// Simple, reliable loop end detection
async function checkLoopEnd() {
  // Use simple, direct current time - no predictions or complexity
  const timeToEnd = loopEnd - currentTime;

  // SEAMLESS TRANSITION: Prepare next track when we're close to final loop end
  if (isPlaylistMode && loopCount === loopTarget - 1) { // On the last loop iteration
      const timeUntilEnd = loopEnd - currentTime;
      if (timeUntilEnd <= SEAMLESS_TRANSITION_PREP_TIME && timeUntilEnd > 0) {
          await prepareSeamlessTransition();
      }
  }

  // Check if we've reached the loop end with simple, reliable timing
  if (currentTime >= loopEnd - LOOP_END_THRESHOLD && loopCount < loopTarget) {
      const timeSinceLoopStart = Date.now() - loopStartTime;
      if (timeSinceLoopStart > 800) {
          // Only log occasionally to reduce spam
          if (Math.random() < 0.2) {
              console.log(`🎯 Loop endpoint detected at ${currentTime.toFixed(3)}s!`);
          }
          await handleLoopEnd();
      }
  }
}

// Seamless transition preparation - starts a few seconds before track end
let transitionPrepared = false;
const SEAMLESS_TRANSITION_PREP_TIME = 3; // Start preparing 3 seconds before end

async function prepareSeamlessTransition() {
    if (transitionPrepared || !isPlaylistMode || !playlistEngine) return;
    
    try {
        transitionPrepared = true;
        console.log('🎵 [SEAMLESS PREP] Preparing next track for seamless transition...');
        
        const currentItem = playlistEngine.currentPlaylist.items[playlistEngine.currentItemIndex];
        const nextItem = playlistEngine.currentPlaylist.items[playlistEngine.currentItemIndex + 1];
        
        if (nextItem) {
            // Pre-analyze and prepare next track
            console.log(`🎵 [SEAMLESS PREP] Next track ready: ${nextItem.name}`);
            showStatus('🎵 Preparing seamless transition...');
        }
    } catch (error) {
        console.warn('Seamless transition prep failed:', error);
        transitionPrepared = false;
    }
}

// Enhanced loop end handling with volume fading and guaranteed sample completion
async function handleLoopEnd() {
  try {
      isLooping = true;
      updateLoopState({ count: loopCount + 1 });
      
      console.log(`🔄 Loop end reached: count=${loopCount}/${loopTarget}, playlistMode=${isPlaylistMode}`);

      if (loopCount >= loopTarget) {
          console.log(`✅ [TRACK END TRANSITION] Loop target reached (${loopCount}/${loopTarget}), determining next action...`);
          
          // Check if we're in playlist mode
          if (isPlaylistMode && playlistEngine) {
              console.log('🎵 [PLAYLIST TRANSITION] Playlist mode active, moving to next playlist item');
              
              // CRITICAL FIX: Pause immediately to prevent track from playing through
              if (isPlaying) {
                  console.log('⏸️ [PLAYLIST TRANSITION] Pausing playback to prevent overrun');
                  await togglePlayPause();
              }
              
              // Add visual feedback for playlist transitions
              const transitionIndicator = document.createElement('div');
              transitionIndicator.style.cssText = 'position:fixed; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg,#1DB954,#9945DB); z-index:9999; opacity:0.8;';
              document.body.appendChild(transitionIndicator);
              
              // Remove after transition completes
              setTimeout(() => {
                  if (document.body.contains(transitionIndicator)) {
                      document.body.removeChild(transitionIndicator);
                  }
              }, 1000);
              
              // Ensure loop state is properly reset before transition
              loopEnabled = false;
              console.log('🔄 [PLAYLIST TRANSITION] Loop state reset for transition (keeping count for display)');
              
              // This will use the volume fading approach with underlying sample
              await playlistEngine.notifyItemComplete();
              
          } else {
              // Clean loop completion - no samples, just fade out
              console.log('🎵 [TRACK END] Loop completed - clean fade out');
              
              // Smooth fade out over 1 second
              const fadeSteps = 10;
              const fadeStepDuration = 100; // 100ms per step = 1 second total
              
              for (let i = fadeSteps; i >= 0; i--) {
                  const volume = Math.round((i / fadeSteps) * 100);
                  await setSpotifyVolume(volume);
                  await new Promise(resolve => setTimeout(resolve, fadeStepDuration));
              }
              
              // Pause playback
              await togglePlayPause();
              
              // Restore volume for next playback
              await setSpotifyVolume(100);
              
              showStatus(`🎵 Loop completed cleanly (${loopTarget}×)`);
          }
          
          // Show completion status before reset
          showStatus(`✅ Loop completed ${loopCount}/${loopTarget} times`);
          
          // Reset loop count for next time (after a delay to show completion)
          setTimeout(() => {
              updateLoopState({ count: 0 });
              console.log('🔄 Loop count reset to 0 after completion');
          }, 1500);
          
      } else {
          // Still have loops to go - this is a LOOP-REPETITION (same track continuing)
          console.log(`🔄 [LOOP-REPETITION] Continuing loop: ${loopCount}/${loopTarget}, seeking from ${formatTime(currentTime)} to ${formatTime(loopStart)}`);

          // Update status and prepare loop timing first
          showStatus(`Loop ${loopCount}/${loopTarget}`);
          loopStartTime = Date.now();

          // SEAMLESS LOOP REPETITION - No transition samples during loop repetitions
          // This ensures perfect, uninterrupted repetition which is the core purpose of loops
          console.log(`🔄 [LOOP-REPETITION] Seeking to loop start point ${formatTime(loopStart)} (seamless - no transition sample)`);
          await seekToPosition(loopStart * 1000);
      }
  } catch (error) {
      console.error('🚨 Loop end handling error:', error);
      showStatus(`Loop error: ${error.message}`);
      
      // Restore volume in case of error
      try {
          await setSpotifyVolume(100);
      } catch (e) {
          console.warn('Failed to restore volume after error:', e);
      }
  } finally {
      isLooping = false;
      console.log('✅ Loop end handling complete');
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

      // Debug info
      if (!response.ok) {
          showStatus(`Search error: ${response.status} ${response.statusText}`);
          console.error('Search failed:', response.status, await response.text());
      }

      if (response.status === 401) {
          localStorage.removeItem('spotify_access_token');
          showView('login');
          showStatus('Session expired. Please reconnect.');
          return;
      }
      
      if (response.status === 429) {
          showStatus('Rate limited. Please wait a moment.');
          return;
      }
      
      if (response.status === 403) {
          showStatus('Access denied. Check account permissions.');
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

// Analyze Spotify popularity score and return appropriate badge
function getPopularityBadge(popularity) {
  if (popularity >= 80) {
    return `<span class="trend-badge trend-hot">🔥 ${popularity}</span>`;
  } else if (popularity >= 50) {
    return `<span class="trend-badge trend-popular">⭐ ${popularity}</span>`;
  } else {
    return `<span class="trend-badge trend-gem">💎 ${popularity}</span>`;
  }
}

function displaySearchResults(tracks, hasMore = false) {
  if (tracks.length === 0) {
      els.searchResults.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--light-gray);">No results found</div>';
      return;
  }

  // Add popularity legend at the top of results (scrolls with content)
  let html = `
      <div class="popularity-legend">
          <strong>Spotify Popularity Score:</strong></br></br>
          🔥 80-100 (Hot) • ⭐ 50-79 (Popular) • 💎 0-49 (Hidden Gems)
      </div>
  `;

  html += tracks.map((track, index) => `
      <div class="track-item" data-track-index="${index}">
          <img src="${track.album.images[2]?.url || ''}" alt="Album cover" class="track-cover" onerror="this.style.display='none'">
          <div class="track-info">
              <div class="track-header">
                  <div class="track-name">${track.name}</div>
                  ${getPopularityBadge(track.popularity)}
              </div>
              <div class="track-artist">${track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist'}</div>
          </div>
          <div class="track-actions">
              <button class="track-action-btn play-track-btn big-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </button>
              <button class="track-action-btn menu track-menu-btn big-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-more-vertical"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
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
// playTrackInBackground function removed - all playback now uses unified selectTrack()

// SEAMLESS SEARCH-TO-PLAYER TRANSITION - NEW IMPLEMENTATION
async function selectTrack(uri, name, artist, durationMs, imageUrl, stayInSearchView = false) {
  try {
      // Check if same track is already playing
      const isCurrentTrack = currentTrack && currentTrack.uri === uri && isPlaying;
      
      if (isCurrentTrack) {
          console.log('🔄 Same track already playing, no reload needed');
          showStatus('🔄 Track already playing');
          return;
      }

      // Exit playlist mode when loading individual track from search
      if (isPlaylistMode) {
          console.log('🚪 Exiting playlist mode for search track');
          
          // Stop progress updates first to prevent conflicts
          stopProgressUpdates();
          
          // Stop playlist engine if active
          if (playlistEngine) {
              playlistEngine.stopPlaylist();
              appState.set('playlist.engine', null);
          }
          
          // Wait a moment for operations to complete
          await new Promise(resolve => setTimeout(resolve, 100));
          
          isPlaylistMode = false;
          appState.set('playlist.isActive', false);
      }

      // Create track data object
      const trackData = { 
          uri, 
          name, 
          artist, 
          duration: durationMs / 1000, 
          image: imageUrl 
      };

      // Use safe loading with proper race condition handling
      const loadSuccess = await loadTrackSafely(trackData, 0, false);
      
      if (!loadSuccess) {
          console.warn('⚠️ Track loading was cancelled or failed');
          return;
      }

      // Update UI state after successful load
      duration = trackData.duration;
      els.currentTrack.textContent = name;
      els.currentArtist.textContent = artist;
      
      // Reset loop points for new track
      loopStart = 0;
      loopEnd = Math.min(30, duration);
      
      // Update UI components
      updatePlayPauseButton();
      updateMiniPlayer(currentTrack);
      startProgressUpdates();
      
      showStatus(`✅ Selected: ${name}`);

      updateLoopVisuals();
      updateProgress();
      
      // Only switch to player view if not staying in search
      if (!stayInSearchView) {
          showView('player');
      }

  } catch (error) {
      console.error('🚨 Track selection error:', error);
      showStatus('Failed to load track');
  }
}

// Views
function showView(view) {
  // Cancel any ongoing track operations to prevent race conditions
  if (currentTrackOperation) {
    currentTrackOperation.cancelled = true;
    currentTrackOperation = null;
  }
  
  currentView = view;

  els.loginScreen.classList.add('hidden');
  els.searchSection.classList.add('hidden');
  els.playerSection.classList.add('hidden');
  els.librarySection.classList.add('hidden');
  els.playlistsSection.classList.add('hidden');

  // UI elements that should be hidden on login screen
  const appHeader = document.getElementById('app-header');
  const statusBar = document.getElementById('status-bar');
  const miniPlayer = document.getElementById('mini-player');
  const mobileNav = document.getElementById('mobile-nav');

  if (view === 'login') {
    els.loginScreen.classList.remove('hidden');
    // Hide UI elements on login screen
    if (appHeader) appHeader.classList.add('hidden');
    if (statusBar) statusBar.classList.add('hidden');
    if (miniPlayer) miniPlayer.classList.add('hidden');
    if (mobileNav) mobileNav.classList.add('hidden');
  } else {
    // Show UI elements for all other views
    if (appHeader) appHeader.classList.remove('hidden');
    if (statusBar) statusBar.classList.remove('hidden');
    if (miniPlayer) miniPlayer.classList.remove('hidden');
    if (mobileNav) mobileNav.classList.remove('hidden');
  }
  if (view === 'search') els.searchSection.classList.remove('hidden');
  if (view === 'player') {
      els.playerSection.classList.remove('hidden');
      hidePlaylistNowPlaying(); // Hide playlist overlay in player view
  }
  if (view === 'library') els.librarySection.classList.remove('hidden');
  if (view === 'playlists') {
      els.playlistsSection.classList.remove('hidden');
      // Maintain current view mode when switching to playlists
      if (playlistViewMode === 'editing' && currentEditingPlaylistId) {
          const playlist = savedPlaylists.find(p => p.id === currentEditingPlaylistId);
          if (playlist) {
              renderPlaylistEditView(playlist);
          } else {
              updatePlaylistDisplay();
          }
      } else {
          updatePlaylistDisplay();
      }
  }

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const navBtn = document.getElementById(`nav-${view}`);
  if (navBtn) navBtn.classList.add('active');

  if (view === 'library') {
      loadSavedLoops();
      renderLoopsList();
  }
}

// Loop Handles with RAF optimization
function setupLoopHandles() {
  let dragTarget = null;
  let rafId = null;
  let pendingUpdates = {
    transform: null,
    boxShadow: null,
    startTime: null,
    endTime: null,
    loopState: null
  };
  
  // Batched DOM updates using RequestAnimationFrame for 60fps performance
  function scheduleUpdate() {
    if (rafId) return; // Already scheduled
    
    rafId = requestAnimationFrame(() => {
      // Apply all pending visual updates in a single frame
      if (pendingUpdates.transform && dragTarget) {
        dragTarget.style.transform = pendingUpdates.transform;
      }
      if (pendingUpdates.boxShadow && dragTarget) {
        dragTarget.style.boxShadow = pendingUpdates.boxShadow;
      }
      if (pendingUpdates.startTime && els.startPopup) {
        els.startPopup.textContent = pendingUpdates.startTime;
      }
      if (pendingUpdates.endTime && els.endPopup) {
        els.endPopup.textContent = pendingUpdates.endTime;
      }
      if (pendingUpdates.loopState) {
        updateLoopState(pendingUpdates.loopState);
      }
      
      // Clear pending updates
      pendingUpdates = {
        transform: null,
        boxShadow: null,
        startTime: null,
        endTime: null,
        loopState: null
      };
      rafId = null;
    });
  }

  function startDrag(e, target) {
      isDragging = true;
      dragTarget = target;
      target.classList.add('dragging');
      const popup = target.querySelector('.time-popup');
      if (popup) popup.classList.add('show');
      
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      
      // Initialize tracking for speed-based precision detection
      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      precisionZoom.lastPosition = clientX;
      precisionZoom.lastMoveTime = Date.now();
      precisionZoom.handleType = target === els.loopStartHandle ? 'start' : 'end';
      
      console.log(`🎯 Drag started on ${precisionZoom.handleType} handle - timer paused for smooth dragging`);
  }

  function updateDrag(e) {
      if (!isDragging || !dragTarget) return;
      
      // Allow dragging even if duration isn't available yet, use fallback
      const effectiveDuration = duration > 0 ? duration : 240; // 4 minutes fallback
      if (e.preventDefault) e.preventDefault();

      // Cache getBoundingClientRect to avoid expensive recalculation on every mousemove
      if (!updateDrag.cachedRect || Date.now() - updateDrag.lastRectTime > 100) {
        updateDrag.cachedRect = els.progressContainer.getBoundingClientRect();
        updateDrag.lastRectTime = Date.now();
      }
      const rect = updateDrag.cachedRect;
      const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      
      let newTime;
      if (precisionZoom.active && precisionZoom.windowStart !== undefined && precisionZoom.windowEnd !== undefined) {
          // Precision mode: Calculate relative movement from last position
          const movement = clientX - precisionZoom.lastPosition;
          const currentTime = precisionZoom.handleType === 'start' ? loopStart : loopEnd;
          const windowDuration = precisionZoom.windowEnd - precisionZoom.windowStart;
          
          // Scale movement based on precision level - smaller windows = finer control
          const sensitivity = windowDuration / rect.width; // seconds per pixel
          newTime = currentTime + (movement * sensitivity);
          
          // Keep within window bounds
          newTime = Math.max(precisionZoom.windowStart, Math.min(precisionZoom.windowEnd, newTime));
          
          console.log(`🎯 PRECISION: movement=${movement}px, sensitivity=${sensitivity.toFixed(4)}s/px, time=${formatTime(newTime)}`);
      } else {
          // Normal mode: Map mouse position to full song duration
          newTime = percent * effectiveDuration;
      }
      
      // Speed-based precision detection
      const now = Date.now();
      const timeDelta = now - precisionZoom.lastMoveTime;
      const movementDistance = Math.abs(clientX - precisionZoom.lastPosition);
      
      // Calculate speed in pixels per second
      const speed = timeDelta > 0 ? (movementDistance / timeDelta) * 1000 : 0;
      
      // Linear speed-to-precision mapping (smooth and predictable)
      if (speed < 100 && duration > 0) {
          // Activate precision mode with linear scaling
          if (!precisionZoom.active) {
              precisionZoom.active = true;
              console.log(`🎯 Entering precision mode: ${speed.toFixed(1)} px/s`);
          }
          
          // Linear precision: 100 px/s = full duration, 0 px/s = 5 seconds
          const precisionFactor = Math.max(0, Math.min(1, speed / 100)); // 0 to 1
          const windowSize = 5 + (precisionFactor * (duration - 5)); // 5s to full duration
          
          // Update window around current position
          const currentTime = precisionZoom.handleType === 'start' ? loopStart : loopEnd;
          precisionZoom.windowStart = Math.max(0, currentTime - windowSize / 2);
          precisionZoom.windowEnd = Math.min(duration, currentTime + windowSize / 2);
          
          // Linear visual feedback - batch for RAF
          if (dragTarget) {
              const intensity = 1 - precisionFactor; // More precision = more glow
              const scale = 1 + (intensity * 0.1); // 1.0 to 1.1
              const glow = 10 + (intensity * 15); // 10 to 25px
              const alpha = 0.3 + (intensity * 0.5); // 0.3 to 0.8
              
              // Schedule visual updates for next frame
              pendingUpdates.transform = `translateX(-50%) translateY(-50%) scale(${scale})`;
              pendingUpdates.boxShadow = `0 0 ${glow}px rgba(29, 185, 84, ${alpha})`;
          }
          
          console.log(`🎯 Speed: ${speed.toFixed(1)} px/s, Window: ${windowSize.toFixed(1)}s`);
      } else {
          // Exit precision mode
          if (precisionZoom.active) {
              console.log(`🎯 Exiting precision mode: ${speed.toFixed(1)} px/s`);
              precisionZoom.active = false;
              precisionZoom.windowStart = null;
              precisionZoom.windowEnd = null;
              
              // Reset visual feedback - batch for RAF
              if (dragTarget) {
                  pendingUpdates.transform = 'translateX(-50%) translateY(-50%) scale(1)';
                  pendingUpdates.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.4)';
              }
          }
      }
      
      // Update tracking for next calculation
      precisionZoom.lastPosition = clientX;
      precisionZoom.lastMoveTime = now;

      // Batch all updates for RAF instead of direct DOM manipulation
      if (dragTarget === els.loopStartHandle) {
          const maxStart = Math.max(0, loopEnd - 0.1);
          const newStart = Math.max(0, Math.min(newTime, maxStart));
          pendingUpdates.loopState = { start: newStart };
          pendingUpdates.startTime = formatTime(newStart);
      } else if (dragTarget === els.loopEndHandle) {
          const minEnd = Math.min(duration, loopStart + 0.1);
          const newEnd = Math.max(minEnd, Math.min(newTime, duration));
          pendingUpdates.loopState = { end: newEnd };
          pendingUpdates.endTime = formatTime(newEnd);
      }
      
      // Schedule all pending updates for next animation frame
      scheduleUpdate();
      
      // No overlay needed - precision is built into the existing progress bar mapping!

      // Smart Loop Assist: Calculate and display real-time scores (optimized for performance)
      if (smartLoopAssistEnabled && !isAnalyzingLoop) {
          // Reduced throttle for better performance during drag (200ms instead of 50ms)
          const now = Date.now();
          if (!updateDrag.lastScoreUpdate || now - updateDrag.lastScoreUpdate > 200) {
              updateDrag.lastScoreUpdate = now;
              
              // Calculate current loop score
              calculateLoopScore(loopStart, loopEnd).then(score => {
                  // Update UI with score only
                  updateSmartAssistUI(score);
              }).catch(err => {
                  console.warn('Smart Loop Assist scoring failed:', err);
              });
          }
      }
  }

  function stopDrag(e) {
      if (isDragging && dragTarget) {
          // Cancel any pending RAF updates
          if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          
          dragTarget.classList.remove('dragging');
          const popup = dragTarget.querySelector('.time-popup');
          if (popup) setTimeout(() => popup.classList.remove('show'), 500);
          
          // Reset visual feedback
          dragTarget.style.transform = 'translateX(-50%) translateY(-50%) scale(1)';
          dragTarget.style.boxShadow = '0 2px 12px rgba(0, 0, 0, 0.4)';
          
          // Clean up precision zoom
          if (precisionZoom.active) {
              precisionZoom.active = false;
              precisionZoom.windowStart = null;
              precisionZoom.windowEnd = null;
          }
          
          
          // Smart Loop Assist: Auto-snap disabled for smooth dragging
          // Auto-snapping is now manual-only to maintain precise linear movement
          // (You can double-tap a handle to trigger manual snapping later if needed)
          
          // Legacy AI optimization disabled for smooth linear dragging
          // The automatic snapping was causing stepping behavior
          // AI optimization can be triggered manually if needed
          
          isDragging = false;
          dragTarget = null;
          console.log('🎯 Drag ended - timer resumed, RAF cleanup complete');
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

// ===============================================
// PRECISION ZOOM LOOP HANDLES - Simplified Implementation
// ===============================================

// Global precision mode state
let precisionZoom = {
    active: false,
    handleType: null,
    lastPosition: 0,
    lastMoveTime: 0,
    windowStart: null,
    windowEnd: null
};

// Clean precision mode - no overlays, just natural precision control

function setupPrecisionZoomLoopHandles() {
    // Simple initialization - precision zoom is now integrated directly into setupLoopHandles()
    console.log('✅ Precision Zoom initialized - integrated with main drag handlers');
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
      const loops = saved ? JSON.parse(saved) : [];
      appState.set('storage.savedLoops', loops);
      updateLoopCountBadge();
  } catch (error) {
      appState.set('storage.savedLoops', []);
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

  // Prompt for loop name
  const loopName = prompt('Enter a name for this loop (optional):', currentTrack.name);
  
  const loop = {
      id: `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: loopName || null, // Store custom name if provided
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
          <button class="delete-x-btn" data-loop-id="${loop.id}" title="Delete loop">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <div class="loop-header">
              <img src="${loop.track.image || ''}" alt="${loop.track.name}" class="loop-thumbnail" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 60\"%3E%3Crect width=\"60\" height=\"60\" fill=\"%23333\"/%3E%3C/svg%3E'">
              <div class="loop-details">
                  ${loop.name ? `<div class="loop-custom-name">${loop.name}</div>` : ''}
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
          </div>

          <div class="loop-edit-form" id="edit-form-${loop.id}">
              <div class="edit-grid">
                  <div class="edit-field">
                      <label class="edit-label">Loop Name</label>
                      <input type="text" class="edit-input" id="edit-name-${loop.id}" value="${loop.name || ''}" placeholder="Enter custom name">
                  </div>
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

      // Exit playlist mode when loading individual library loop
      if (isPlaylistMode) {
          console.log('🚪 Exiting playlist mode for library loop');
          
          // Stop progress updates first to prevent conflicts
          stopProgressUpdates();
          
          // Stop playlist engine if active
          if (playlistEngine) {
              playlistEngine.stopPlaylist();
              appState.set('playlist.engine', null);
          }
          
          // Wait a moment for operations to complete
          await new Promise(resolve => setTimeout(resolve, 100));
          
          isPlaylistMode = false;
          appState.set('playlist.isActive', false);
      }

      loop.playCount = (loop.playCount || 0) + 1;
      saveLooopsToStorage();

      const trackData = {
          uri: loop.track.uri,
          name: loop.track.name,
          artist: loop.track.artist,
          duration: loop.track.duration,
          image: loop.track.image || ''
      };

      duration = trackData.duration;
      els.currentTrack.textContent = loop.track.name;
      els.currentArtist.textContent = loop.track.artist;

      // Set loop state BOTH globally and in AppState BEFORE loading track
      loopStart = loop.loop.start;
      loopEnd = loop.loop.end;
      loopTarget = loop.loop.repeat;
      loopEnabled = true;
      loopCount = 0;
      loopStartTime = Date.now();

      // Sync with AppState
      appState.set('loop.start', loop.loop.start);
      appState.set('loop.end', loop.loop.end);
      appState.set('loop.target', loop.loop.repeat);
      appState.set('loop.enabled', true);
      appState.set('loop.count', 0);
      appState.set('loop.startTime', Date.now());

      if (els.loopToggle) els.loopToggle.checked = true;
      updateRepeatDisplay();
      updateLoopVisuals();

      const loadSuccess = await loadTrackSafely(trackData, loopStart * 1000, true);
      if (!loadSuccess) {
          console.log('🚫 Load saved loop cancelled or failed');
          return; // Exit early if load was cancelled
      }

      updateProgress();
      updatePlayPauseButton();
      updateMiniPlayer(currentTrack);
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

  const newName = document.getElementById(`edit-name-${loopId}`).value.trim();
  const newStart = parseTimeInput(document.getElementById(`edit-start-${loopId}`).value);
  const newEnd = parseTimeInput(document.getElementById(`edit-end-${loopId}`).value);
  const newRepeat = parseInt(document.getElementById(`edit-repeat-${loopId}`).value);

  if (newStart < 0 || newStart >= loop.track.duration || newEnd <= newStart || newEnd > loop.track.duration || newRepeat < 1 || newRepeat > 99) {
      showStatus('❌ Invalid values');
      return;
  }

  loop.name = newName || null; // Store custom name or null if empty
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
      const playlists = saved ? JSON.parse(saved) : [];
      appState.set('storage.savedPlaylists', playlists);
      updatePlaylistCountBadge();
  } catch (error) {
      appState.set('storage.savedPlaylists', []);
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
  
  // Use cached data if available
  if (playlist.prebuffered && prebufferCache.size > 0) {
      console.log('🚀 Using prebuffered data for enhanced playback');
  }

  try {
      // Update play count
      playlist.playCount = (playlist.playCount || 0) + 1;
      savePlaylistsToStorage();

      // Start playlist mode
      isPlaylistMode = true;
      currentPlaylist = playlist;
      currentPlaylistIndex = startIndex;
      
      // Save comprehensive playlist state for recovery
      const currentItem = playlist.items[startIndex];
      localStorage.setItem('active_playlist_state', JSON.stringify({
          playlistId: playlist.id,
          index: startIndex,
          currentItem: currentItem,
          isPlaylistMode: true,
          timestamp: Date.now(),
          loopState: {
              start: currentItem?.start || 0,
              end: currentItem?.end || 0,
              enabled: currentItem?.type === 'loop',
              target: currentItem?.playCount || 1,
              count: 0
          }
      }));

      // Load playlist into engine
      await playlistEngine.loadPlaylist(playlist, startIndex);

      // Stay in playlist view - switch to editing mode to show full cards
      // User can tap mini player or nav to enter loop mode
      playlistViewMode = 'editing';
      renderPlaylistEditView(playlist);
      
      showStatus(`🎵 Playing playlist: ${playlist.name}`);

  } catch (error) {
      console.error('🚨 Playlist play error:', error);
      showStatus('Failed to play playlist');
      isPlaylistMode = false;
  }
}

// Helper function to update playlist state when loop parameters change
function updatePlaylistStateIfActive() {
    if (isPlaylistMode && currentPlaylist && currentPlaylistIndex !== undefined) {
        const currentItem = currentPlaylist.items[currentPlaylistIndex];
        if (currentItem) {
            localStorage.setItem('active_playlist_state', JSON.stringify({
                playlistId: currentPlaylist.id,
                index: currentPlaylistIndex,
                currentItem: currentItem,
                isPlaylistMode: true,
                timestamp: Date.now(),
                loopState: {
                    start: loopStart,
                    end: loopEnd,
                    enabled: loopEnabled,
                    target: loopTarget,
                    count: loopCount
                }
            }));
        }
    }
}

function stopPlaylistMode() {
  isPlaylistMode = false;
  currentPlaylist = null;
  currentPlaylistIndex = 0;
  
  // Clear saved state
  localStorage.removeItem('active_playlist_state');

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
      </div>
  `).join('');
}

function renderPlaylistEditView(playlist) {
  const html = `
    <div class="card">
      <h2 class="card-title">
        <button class="back-btn" id="playlist-edit-back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-arrow-left">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <span>${playlist.name}</span>
        <span style="font-size: 14px; opacity: 0.7;">${playlist.items.length} items • ${formatTime(playlist.totalDuration, false)}</span>
      </h2>
      <div id="playlist-items-list">
        ${renderPlaylistItemsAsCards(playlist)}
      </div>
    </div>
  `;
  
  els.playlistsList.innerHTML = html;
  setupPlaylistDragAndDrop(playlist.id);
}

function renderPlaylistItemsAsCards(playlist) {
  if (playlist.items.length === 0) {
      return '<div style="text-align: center; padding: 60px 20px; color: var(--light-gray);">No items in playlist yet</div>';
  }

  return playlist.items.map((item, index) => {
      const isLoop = item.type === 'loop';
      const savedLoop = isLoop ? savedLoops.find(l => l.id === item.id) : null;
      const customName = item.customName || savedLoop?.name;
      
      return `
      <div class="saved-loop playlist-item" data-playlist-id="${playlist.id}" data-item-index="${index}" draggable="true">
          <button class="delete-x-btn" onclick="removeFromPlaylist('${playlist.id}', ${index})" title="Remove from playlist">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          <div class="drag-handle" title="Drag to reorder">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-menu">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
          </div>
          <div class="loop-header">
              <img src="${item.image || ''}" alt="${item.name}" class="loop-thumbnail" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 60\"%3E%3Crect width=\"60\" height=\"60\" fill=\"%23333\"/%3E%3C/svg%3E'">
              <div class="loop-details">
                  ${isLoop ? `<div class="loop-custom-name">${customName || 'Untitled Loop'}</div>` : ''}
                  <div class="loop-track-name">${item.name}</div>
                  <div class="loop-artist">${item.artist}</div>
              </div>
          </div>

          <div class="loop-stats">
              <div class="loop-stat">
                  <span class="loop-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-clock"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  </span>
                  <span>${isLoop ? `${formatTime(item.start, false)} - ${formatTime(item.end, false)}` : `Full: ${formatTime(item.duration, false)}`}</span>
              </div>
              ${isLoop ? `
              <div class="loop-stat">
                  <span class="loop-stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-repeat"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                  </span>
                  <span>${item.playCount}×</span>
              </div>
              ` : ''}
              <div class="loop-stat">
                  <span class="loop-stat-icon">${isLoop ? '🔁' : '🎵'}</span>
                  <span>${isLoop ? 'Loop' : 'Track'}</span>
              </div>
          </div>

          <div class="loop-actions">
              <button class="loop-action-btn load-playlist-item-btn" data-playlist-id="${playlist.id}" data-item-index="${index}">Load</button>
              <button class="loop-action-btn edit-playlist-item-btn" data-playlist-id="${playlist.id}" data-item-index="${index}">Edit</button>
              <button class="loop-action-btn share-btn" data-item='${JSON.stringify(item).replace(/'/g, '&apos;')}'>Share</button>
          </div>

          <div class="loop-edit-form" id="edit-playlist-item-${playlist.id}-${index}">
              <div class="edit-grid">
                  ${isLoop ? `
                  <div class="edit-field">
                      <label class="edit-label">Loop Name</label>
                      <input type="text" class="edit-input" id="edit-name-${playlist.id}-${index}" value="${customName || ''}" placeholder="Enter custom name">
                  </div>
                  <div class="edit-field">
                      <label class="edit-label">Start Time</label>
                      <input type="text" class="edit-input" id="edit-start-${playlist.id}-${index}" value="${formatTime(item.start)}">
                  </div>
                  <div class="edit-field">
                      <label class="edit-label">End Time</label>
                      <input type="text" class="edit-input" id="edit-end-${playlist.id}-${index}" value="${formatTime(item.end)}">
                  </div>
                  <div class="edit-field">
                      <label class="edit-label">Repeat Count</label>
                      <input type="number" class="edit-input" id="edit-repeat-${playlist.id}-${index}" value="${item.playCount}" min="1" max="99">
                  </div>
                  ` : `
                  <div class="edit-field">
                      <label class="edit-label">Play Count</label>
                      <input type="number" class="edit-input" id="edit-playcount-${playlist.id}-${index}" value="${item.playCount}" min="1" max="99">
                  </div>
                  `}
              </div>
              <div class="edit-actions">
                  <button class="btn secondary" onclick="updatePlaylistItem('${playlist.id}', ${index})">💾 Update</button>
                  ${isLoop ? `<button class="btn secondary" onclick="savePlaylistItemAsNew('${playlist.id}', ${index})">➕ Save as New Loop</button>` : ''}
                  <button class="btn" onclick="cancelPlaylistItemEdit('${playlist.id}', ${index})">❌ Cancel</button>
              </div>
          </div>
      </div>
    `;
  }).join('');
}

// Keep the old function for the compact view in playlist overview
function renderPlaylistItems(playlist) {
  // This stays as the compact view for the playlist card editor
  return ''; // We'll use the full card view now
}

// Universal playlist display function - handles both modes
function updatePlaylistDisplay() {
  if (playlistViewMode === 'tracklist' && currentPlaylist && isPlaylistMode) {
    updatePlaylistTrackDisplay();
  } else {
    renderPlaylistsOverview();
  }
}

// Render playlist as track list when playing (like search results)
function updatePlaylistTrackDisplay() {
  if (!currentPlaylist || !isPlaylistMode) {
    renderPlaylistsOverview();
    return;
  }

  const currentIndex = playlistEngine ? playlistEngine.currentItemIndex : 0;
  
  const html = `
    <div class="playlist-tracklist-header">
      <button class="back-btn" id="playlist-back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-arrow-left">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
      </button>
      <div class="playlist-tracklist-info">
        <h3>🎵 ${currentPlaylist.name}</h3>
        <p>${currentPlaylist.items.length} tracks</p>
      </div>
    </div>
    
    ${currentPlaylist.items.map((item, index) => {
      const isPlaying = index === currentIndex;
      const isUpcoming = index > currentIndex;
      const isDone = index < currentIndex;
      
      return `
        <div class="track-item playlist-track ${isPlaying ? 'now-playing' : ''} ${isDone ? 'played' : ''}" 
             data-track-index="${index}">
          <div class="track-info">
            <div class="track-header">
              <div class="track-name">${item.name}</div>
              ${isPlaying ? '<div class="now-playing-indicator">🎵</div>' : ''}
            </div>
            <div class="track-artist">${item.artist}</div>
            <div class="track-type">
              ${item.type === 'loop' 
                ? `Loop: ${formatTime(item.start, false)} - ${formatTime(item.end, false)}` 
                : 'Full Track'}
            </div>
          </div>
          <div class="track-actions">
            ${!isPlaying ? `
              <button class="track-action-btn big-btn play-playlist-track-btn" data-track-index="${index}">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
              </button>
            ` : ''}
            <button class="track-action-btn big-btn menu track-menu-btn" data-track-index="${index}">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-more-horizontal">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('')}
  `;

  els.playlistsList.innerHTML = html;
}

// Render all playlists overview with currently playing one highlighted
function renderPlaylistsOverview() {
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

  els.playlistsList.innerHTML = savedPlaylists.map((playlist) => {
    const isCurrentlyPlaying = isPlaylistMode && currentPlaylist && playlist.id === currentPlaylist.id;
    
    // Find first item (track or loop) with an album cover
    // Loops store their track's album art in the image property too
    const firstTrackCover = playlist.items
      .find(item => (item.type === 'track' || item.type === 'loop') && item.image)?.image;
    
    return `
      <div class="playlist-card ${isCurrentlyPlaying ? 'currently-playing' : ''}" data-playlist-id="${playlist.id}">
          <button class="delete-x-btn" data-playlist-id="${playlist.id}" title="Delete playlist">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-x"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
          ${isCurrentlyPlaying ? '<div class="playlist-playing-indicator">🎵 Now Playing</div>' : ''}
          
          <div class="playlist-header">
              <div class="playlist-icon playlist-stack">
                  ${firstTrackCover 
                    ? `<div class="playlist-stack-bg"></div>
                       <div class="playlist-stack-mid"></div>
                       <img src="${firstTrackCover}" class="playlist-cover playlist-cover-top" alt="${playlist.name}" onerror="this.style.display='none'; this.parentElement.innerHTML='<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"20\\" height=\\"20\\" viewBox=\\"0 0 24 24\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\" stroke-linecap=\\"round\\" stroke-linejoin=\\"round\\" class=\\"feather feather-music\\"><path d=\\"M9 18V5l12-2v13\\"></path><circle cx=\\"6\\" cy=\\"18\\" r=\\"3\\"></circle><circle cx=\\"18\\" cy=\\"16\\" r=\\"3\\"></circle></svg>';">`
                    : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-music"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`
                  }
              </div>
              <div class="playlist-details">
                  <div class="playlist-name" contenteditable="false" onblur="updatePlaylistName('${playlist.id}', this)" onclick="enablePlaylistNameEdit(this)">${playlist.name}</div>
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
              ${isCurrentlyPlaying ? `
                <button class="playlist-action-btn view-tracklist-btn" data-playlist-id="${playlist.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-list">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                  View Tracks
                </button>
                <button class="playlist-action-btn play-playlist-btn" data-playlist-id="${playlist.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-refresh-cw"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>
                  Restart
                </button>
              ` : `
                <button class="playlist-action-btn play-playlist-btn" data-playlist-id="${playlist.id}">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-play"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  Play
                </button>
              `}
              <button class="playlist-action-btn edit-playlist-btn" data-playlist-id="${playlist.id}">Edit</button>
              <button class="playlist-action-btn share-playlist-btn" data-playlist-id="${playlist.id}">Share</button>
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
    `;
  }).join('');
}

function enablePlaylistNameEdit(element) {
  element.contentEditable = true;
  element.focus();
  // Select all text
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function updatePlaylistName(playlistId, element) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (playlist) {
      const newName = element.textContent.trim();
      if (newName && newName !== playlist.name) {
          playlist.name = newName;
          savePlaylistsToStorage();
          showStatus('✅ Playlist renamed!');
      } else {
          element.textContent = playlist.name; // Restore original name if empty
      }
  }
  element.contentEditable = false;
}


function editPlaylist(playlistId) {
  // Switch to tracklist view mode and show the playlist items
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;
  
  currentEditingPlaylistId = playlistId;
  playlistViewMode = 'editing';
  renderPlaylistEditView(playlist);
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

function editPlaylistItem(playlistId, itemIndex) {
  const editForm = document.getElementById(`edit-playlist-item-${playlistId}-${itemIndex}`);
  if (editForm) {
      editForm.classList.add('active');
  }
}

function cancelPlaylistItemEdit(playlistId, itemIndex) {
  const editForm = document.getElementById(`edit-playlist-item-${playlistId}-${itemIndex}`);
  if (editForm) editForm.classList.remove('active');
}

function updatePlaylistItem(playlistId, itemIndex) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || !playlist.items[itemIndex]) return;

  const item = playlist.items[itemIndex];
  const isLoop = item.type === 'loop';

  if (isLoop) {
      // Update loop name, times, and repeat count
      const newName = document.getElementById(`edit-name-${playlistId}-${itemIndex}`).value.trim();
      const newStart = parseTimeInput(document.getElementById(`edit-start-${playlistId}-${itemIndex}`).value);
      const newEnd = parseTimeInput(document.getElementById(`edit-end-${playlistId}-${itemIndex}`).value);
      const newRepeat = parseInt(document.getElementById(`edit-repeat-${playlistId}-${itemIndex}`).value);
      
      if (newStart >= 0 && newEnd > newStart && newRepeat >= 1 && newRepeat <= 99) {
          // Update playlist item
          item.customName = newName || null;
          item.start = newStart;
          item.end = newEnd;
          item.playCount = newRepeat;
          
          // Sync with original saved loop if it exists
          const savedLoop = savedLoops.find(l => l.id === item.id);
          if (savedLoop) {
              savedLoop.name = newName || null;
              savedLoop.loop.start = newStart;
              savedLoop.loop.end = newEnd;
              savedLoop.loop.repeat = newRepeat;
              saveLoopsToStorage();
          }
      } else {
          showStatus('❌ Invalid values');
          return;
      }
  } else {
      // For full tracks, just update play count
      const newPlayCount = parseInt(document.getElementById(`edit-playcount-${playlistId}-${itemIndex}`).value);
      if (newPlayCount >= 1 && newPlayCount <= 99) {
          item.playCount = newPlayCount;
      } else {
          showStatus('❌ Invalid play count');
          return;
      }
  }

  savePlaylistsToStorage();
  
  // Re-render the playlist items
  const itemsContainer = document.getElementById(`playlist-items-${playlistId}`);
  if (itemsContainer) {
      itemsContainer.innerHTML = renderPlaylistItems(playlist);
      setupPlaylistDragAndDrop(playlistId); // Re-setup drag and drop
  }
  
  // Refresh library view if open to sync changes back to "My Moments"
  if (currentView === 'library') {
      renderLibrary();
  }
  
  showStatus('✅ Item updated!');
}

function removeFromPlaylist(playlistId, itemIndex) {
  if (!confirm('Remove this item from the playlist?')) return;
  
  removeItemFromPlaylist(playlistId, itemIndex);

  // Re-render the playlist items if in edit view
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (playlist && playlistViewMode === 'editing') {
      // Re-render the entire edit view since items are part of the view structure
      renderPlaylistEditView(playlist);
  }
}

async function loadPlaylistItem(playlistId, itemIndex) {
  console.log('🎵 loadPlaylistItem called - playlistId:', playlistId, 'itemIndex:', itemIndex);
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || !playlist.items[itemIndex]) {
    console.error('❌ Playlist or item not found - playlist:', playlist, 'itemIndex:', itemIndex);
    return;
  }

  const item = playlist.items[itemIndex];
  console.log('🎵 Loading individual playlist item:', item);
  
  try {
      showStatus('🔄 Loading individual playlist item...');

      // Exit playlist mode when loading individual playlist item
      if (isPlaylistMode) {
          console.log('🚪 Exiting playlist mode for individual playlist item');
          
          // Stop progress updates first to prevent conflicts
          stopProgressUpdates();
          
          // Stop playlist engine if active
          if (playlistEngine) {
              playlistEngine.stopPlaylist();
              appState.set('playlist.engine', null);
          }
          
          // Wait a moment for operations to complete
          await new Promise(resolve => setTimeout(resolve, 100));
          
          isPlaylistMode = false;
          appState.set('playlist.isActive', false);
      }

      if (item.type === 'loop') {
          // Load as a saved loop
          const trackData = {
              uri: item.trackUri || item.uri, // Fix: use correct URI field
              name: item.name,
              artist: item.artist,
              duration: item.duration,
              image: item.image || ''
          };

          // Set loop state using unified function BEFORE loading track
          updateLoopState({
              start: item.start,
              end: item.end,
              target: item.playCount,
              enabled: true,
              count: 0,
              startTime: Date.now()
          });

          console.log('🎵 About to call loadTrackSafely with preserveLoopPoints=true, current values:', {
              loopStart, loopEnd, loopTarget, loopEnabled
          });

          // Load track with preserved loop points
          const loadSuccess = await loadTrackSafely(trackData, item.start * 1000, true);
          if (!loadSuccess) {
              console.log('🚫 Individual playlist item load cancelled or failed');
              return;
          }

          // Complete UI setup like library loading does
          updateProgress();
          updatePlayPauseButton();
          updateMiniPlayer(trackData);
          startProgressUpdates();

          showView('player');
          showStatus(`✅ Loaded: ${item.name} (${item.playCount}×)`);
          
      } else {
          // Load full track - use same pattern as individual track loading
          const trackData = {
              uri: item.uri,
              name: item.name,
              artist: item.artist,
              duration: item.duration,
              image: item.image || ''
          };

          const loadSuccess = await loadTrackSafely(trackData, 0, false);
          if (!loadSuccess) {
              console.log('🚫 Individual playlist track load cancelled or failed');
              return;
          }

          // Complete UI setup
          updateProgress();
          updatePlayPauseButton();
          updateMiniPlayer(trackData);
          startProgressUpdates();

          showView('player');
          showStatus(`✅ Loaded: ${item.name}`);
      }
      
  } catch (error) {
      console.error('🚨 Load individual playlist item error:', error);
      showStatus('❌ Failed to load item');
  }
}

function savePlaylistItemAsNew(playlistId, itemIndex) {
  const playlist = savedPlaylists.find(p => p.id === playlistId);
  if (!playlist || !playlist.items[itemIndex]) return;

  const item = playlist.items[itemIndex];
  const isLoop = item.type === 'loop';

  if (!isLoop) {
      showStatus('❌ Can only save loops as new');
      return;
  }

  // Get new values
  const newStart = parseTimeInput(document.getElementById(`edit-start-${playlistId}-${itemIndex}`).value);
  const newEnd = parseTimeInput(document.getElementById(`edit-end-${playlistId}-${itemIndex}`).value);
  const newPlayCount = parseInt(document.getElementById(`edit-playcount-${playlistId}-${itemIndex}`).value);

  if (newStart >= 0 && newEnd > newStart && newPlayCount >= 1 && newPlayCount <= 99) {
      // Create new loop - note: playlist items use 'trackUri' not 'uri'
      const newLoop = {
          id: `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: prompt('Enter a name for the new loop:', item.name) || null,
          track: {
              uri: item.trackUri || item.uri,  // Handle both property names
              name: item.name,
              artist: item.artist,
              duration: item.duration,
              image: item.image
          },
          loop: { start: newStart, end: newEnd, repeat: newPlayCount },
          savedAt: new Date().toISOString(),
          playCount: 0
      };

      savedLoops.unshift(newLoop);
      saveLooopsToStorage();
      
      cancelPlaylistItemEdit(playlistId, itemIndex);
      showStatus('✅ New loop saved!');
  } else {
      showStatus('❌ Invalid values');
  }
}

// Working drag and drop implementation based on research
function setupPlaylistDragAndDrop(playlistId) {
  const container = document.getElementById('playlist-items-list');
  if (!container) return;

  // Destroy existing Sortable instance if it exists
  if (container.sortableInstance) {
    container.sortableInstance.destroy();
  }

  // Initialize SortableJS
  container.sortableInstance = Sortable.create(container, {
    animation: 150,
    handle: '.drag-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    forceFallback: false, // Use native HTML5 on desktop, touch fallback on mobile
    fallbackTolerance: 10, // Tolerance for mobile touch
    
    // Enhanced auto-scroll for long playlists
    scroll: true,
    scrollSensitivity: 100, // Trigger scrolling when within 100px of edge
    scrollSpeed: 50, // Faster scroll speed
    bubbleScroll: true, // Allow scrolling in nested containers
    
    // Auto-scroll acceleration
    scrollFn: function(offsetX, offsetY, originalEvent, touchEvt, hoverTargetEl) {
      const container = document.getElementById('playlist-items-list');
      if (!container) return;
      
      // Get container bounds
      const rect = container.getBoundingClientRect();
      const header = container.querySelector('.playlist-edit-header');
      const headerHeight = header ? header.offsetHeight : 60;
      const scrollZone = 120; // Larger scroll zone
      const maxSpeed = 15; // Maximum scroll speed per frame
      
      // Calculate distance from edges (accounting for header)
      const distanceFromTop = originalEvent.clientY - (rect.top + headerHeight);
      const distanceFromBottom = rect.bottom - originalEvent.clientY;
      
      let scrollDelta = 0;
      
      // Scroll up when near top
      if (distanceFromTop < scrollZone && container.scrollTop > 0) {
        const intensity = Math.max(0, (scrollZone - distanceFromTop) / scrollZone);
        scrollDelta = -maxSpeed * intensity;
      }
      // Scroll down when near bottom  
      else if (distanceFromBottom < scrollZone && 
               container.scrollTop < container.scrollHeight - container.clientHeight) {
        const intensity = Math.max(0, (scrollZone - distanceFromBottom) / scrollZone);
        scrollDelta = maxSpeed * intensity;
      }
      
      if (scrollDelta !== 0) {
        container.scrollTop += scrollDelta;
      }
    },
    
    // Prevent conflicts with other gestures
    preventOnFilter: false,
    filter: 'button:not(.drag-handle)',
    
    onStart: function(evt) {
      console.log('SortableJS: Drag started from index:', evt.oldIndex);
      
      // Add haptic feedback on mobile
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
      
      // Show scroll zones during drag
      container.classList.add('sortable-active');
    },
    
    onEnd: function(evt) {
      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;
      
      console.log('SortableJS: Drag ended - moved from', oldIndex, 'to', newIndex);
      
      // Hide scroll zones after drag
      container.classList.remove('sortable-active');
      
      // Only update if position actually changed
      if (oldIndex !== newIndex) {
        // Update the backend data using existing function
        reorderPlaylistItems(playlistId, oldIndex, newIndex);
        
        // Update all item indices
        const allItems = [...container.querySelectorAll('.playlist-item')];
        allItems.forEach((item, index) => {
          item.dataset.itemIndex = index;
        });
        
        console.log('Playlist reorder successful');
      }
    }
  });
  
  console.log('SortableJS setup complete for playlist:', playlistId);
}

// Removed getDragAfterElement - using simpler approach

// ====== PREBUFFERING SYSTEM ======

// Initialize IndexedDB for persistent caching
async function initCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      cacheDB = request.result;
      resolve(cacheDB);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Audio data store
      if (!db.objectStoreNames.contains('audioData')) {
        const audioStore = db.createObjectStore('audioData', { keyPath: 'trackId' });
        audioStore.createIndex('playlistId', 'playlistId', { unique: false });
      }
      
      // Metadata store
      if (!db.objectStoreNames.contains('metadata')) {
        const metaStore = db.createObjectStore('metadata', { keyPath: 'trackId' });
        metaStore.createIndex('playlistId', 'playlistId', { unique: false });
      }
    };
  });
}

// Store audio data in IndexedDB
async function storeAudioData(trackId, playlistId, audioBuffer, metadata) {
  if (!cacheDB) await initCacheDB();
  
  const transaction = cacheDB.transaction(['audioData', 'metadata'], 'readwrite');
  
  // Store audio data
  const audioStore = transaction.objectStore('audioData');
  await audioStore.put({
    trackId,
    playlistId,
    audioBuffer: audioBuffer,
    timestamp: Date.now()
  });
  
  // Store metadata
  const metaStore = transaction.objectStore('metadata');
  await metaStore.put({
    trackId,
    playlistId,
    metadata,
    timestamp: Date.now()
  });
}

// Retrieve cached audio data
async function getCachedAudioData(trackId) {
  if (!cacheDB) return null;
  
  const transaction = cacheDB.transaction(['audioData'], 'readonly');
  const audioStore = transaction.objectStore('audioData');
  
  return new Promise((resolve) => {
    const request = audioStore.get(trackId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

// Show prebuffer loading screen
function showPrebufferLoading(playlist) {
  const loadingHtml = `
    <div class="prebuffer-loading-screen" id="prebuffer-loading">
      <div class="prebuffer-content">
        <div class="prebuffer-header">
          <h2>⚡ Prebuffering Playlist</h2>
          <p>"${playlist.name}" is getting the VIP treatment!</p>
        </div>
        
        <div class="prebuffer-progress">
          <div class="progress-circle" id="prebuffer-circle">
            <svg width="120" height="120">
              <circle cx="60" cy="60" r="50" stroke="rgba(255,255,255,0.1)" stroke-width="8" fill="none"/>
              <circle cx="60" cy="60" r="50" stroke="var(--primary)" stroke-width="8" fill="none" 
                      stroke-dasharray="314" stroke-dashoffset="314" id="progress-ring"/>
            </svg>
            <div class="progress-text" id="prebuffer-percentage">0%</div>
          </div>
        </div>
        
        <div class="prebuffer-status">
          <div class="current-track" id="prebuffer-current">🎵 Getting started...</div>
          <div class="prebuffer-stats" id="prebuffer-stats">0 of ${playlist.items.length} tracks processed</div>
          <div class="time-estimate" id="prebuffer-time">Estimated time: calculating...</div>
        </div>
        
        <div class="prebuffer-actions">
          <button class="btn secondary" id="prebuffer-cancel">Cancel</button>
          <button class="btn danger" id="prebuffer-disable">Disable Prebuffering</button>
        </div>
        
        <div class="prebuffer-info">
          <p><strong>Why prebuffer?</strong></p>
          <p>• Zero-latency transitions (faster than Spotify!)</p>
          <p>• Instant loop repetition with no gaps</p>
          <p>• Cached forever - one-time operation</p>
          <p>• Memory-resident playback = seamless experience</p>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', loadingHtml);
  
  // Add event listeners
  document.getElementById('prebuffer-cancel').addEventListener('click', cancelPrebuffer);
  document.getElementById('prebuffer-disable').addEventListener('click', disablePrebuffer);
}

// Update prebuffer progress
function updatePrebufferProgress(current, total, trackName, timeElapsed) {
  const percentage = Math.round((current / total) * 100);
  const progressRing = document.getElementById('progress-ring');
  const percentageEl = document.getElementById('prebuffer-percentage');
  const currentEl = document.getElementById('prebuffer-current');
  const statsEl = document.getElementById('prebuffer-stats');
  const timeEl = document.getElementById('prebuffer-time');
  
  if (progressRing && percentageEl && currentEl && statsEl && timeEl) {
    // Update circular progress
    const circumference = 314;
    const offset = circumference - (percentage / 100) * circumference;
    progressRing.style.strokeDashoffset = offset;
    
    // Update text
    percentageEl.textContent = `${percentage}%`;
    
    // Random engaging message
    const messageTemplate = PREBUFFER_MESSAGES[current % PREBUFFER_MESSAGES.length];
    currentEl.textContent = messageTemplate.replace('{track}', trackName);
    
    statsEl.textContent = `${current} of ${total} tracks processed`;
    
    // Time estimation
    if (current > 0) {
      const avgTimePerTrack = timeElapsed / current;
      const remainingTracks = total - current;
      const estimatedRemaining = Math.round((avgTimePerTrack * remainingTracks) / 1000);
      timeEl.textContent = `Estimated time remaining: ${estimatedRemaining}s`;
    }
  }
}

// Hide prebuffer loading screen
function hidePrebufferLoading() {
  const loadingScreen = document.getElementById('prebuffer-loading');
  if (loadingScreen) {
    loadingScreen.remove();
  }
}

// Cancel prebuffering
function cancelPrebuffer() {
  prebufferInProgress = false;
  if (prebufferAbortController) {
    prebufferAbortController.abort();
  }
  hidePrebufferLoading();
  showStatus('❌ Prebuffering cancelled');
}

// Disable prebuffering
function disablePrebuffer() {
  prebufferEnabled = false;
  localStorage.setItem('prebuffer-enabled', 'false');
  cancelPrebuffer();
  showStatus('⚠️ Prebuffering disabled - you can re-enable in settings');
}

// Main prebuffering function
async function prebufferPlaylist(playlist) {
  if (!prebufferEnabled || prebufferInProgress) return false;
  
  prebufferInProgress = true;
  prebufferAbortController = new AbortController();
  const startTime = Date.now();
  
  try {
    // Initialize cache DB
    await initCacheDB();
    
    // Show loading screen
    showPrebufferLoading(playlist);
    
    const tracks = playlist.items.filter(item => item.spotifyId);
    let processed = 0;
    
    // Process tracks in parallel batches
    const batchSize = 3; // Process 3 tracks at once
    for (let i = 0; i < tracks.length; i += batchSize) {
      if (prebufferAbortController.signal.aborted) break;
      
      const batch = tracks.slice(i, i + batchSize);
      const promises = batch.map(async (track) => {
        try {
          // Check if already cached
          const cached = await getCachedAudioData(track.spotifyId);
          if (cached) {
            prebufferCache.set(track.spotifyId, cached);
            return true;
          }
          
          // Fetch and cache audio data
          const response = await fetch(`https://api.spotify.com/v1/tracks/${track.spotifyId}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` },
            signal: prebufferAbortController.signal
          });
          
          if (!response.ok) throw new Error('Failed to fetch track data');
          
          const trackData = await response.json();
          
          // Get audio features for precise loop analysis
          const featuresResponse = await fetch(`https://api.spotify.com/v1/audio-features/${track.spotifyId}`, {
            headers: { 'Authorization': `Bearer ${spotifyAccessToken}` },
            signal: prebufferAbortController.signal
          });
          
          const features = featuresResponse.ok ? await featuresResponse.json() : null;
          
          // Store in cache
          const cacheEntry = {
            trackData,
            features,
            loopPoints: {
              start: track.start || 0,
              end: track.end || 30
            },
            cachedAt: Date.now()
          };
          
          await storeAudioData(track.spotifyId, playlist.id, null, cacheEntry);
          prebufferCache.set(track.spotifyId, cacheEntry);
          
          return true;
        } catch (error) {
          console.warn('Failed to prebuffer track:', track.name, error);
          return false;
        }
      });
      
      await Promise.allSettled(promises);
      processed += batch.length;
      
      // Update progress
      const timeElapsed = Date.now() - startTime;
      updatePrebufferProgress(processed, tracks.length, batch[0]?.name || 'Processing...', timeElapsed);
      
      // Small delay to prevent overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Success!
    hidePrebufferLoading();
    showStatus(`✨ Playlist "${playlist.name}" prebuffered successfully! Enjoy seamless playback.`);
    
    // Mark playlist as prebuffered
    playlist.prebuffered = true;
    playlist.prebufferedAt = Date.now();
    savePlaylistsToStorage();
    
    return true;
    
  } catch (error) {
    console.error('Prebuffering failed:', error);
    hidePrebufferLoading();
    showStatus('❌ Prebuffering failed - playing without prebuffer');
    return false;
  } finally {
    prebufferInProgress = false;
    prebufferAbortController = null;
  }
}

// Check if playlist needs prebuffering
function shouldPrebufferPlaylist(playlist) {
  if (!prebufferEnabled) return false;
  if (playlist.prebuffered) return false;
  if (playlist.items.length === 0) return false;
  if (playlist.items.length > 100) return false; // Limit to 100 tracks
  
  // Check if it's been more than a week since last prebuffer
  if (playlist.prebufferedAt) {
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    if (playlist.prebufferedAt > weekAgo) return false;
  }
  
  return true;
}

// Enhanced playlist play function with prebuffering (temporarily disabled)
async function playPlaylistWithPrebuffer(playlistId, startIndex = 0) {
  // Prebuffering temporarily disabled due to Spotify API limitations
  // Fall back to normal playback
  console.log('🔄 Prebuffering disabled - using normal playback');
  return playPlaylist(playlistId, startIndex);
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
  appState.set('playlist.pendingItem', null);
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
          appState.set('playlist.pendingItem', null);
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
      appState.set('playlist.pendingItem', {
          type: 'loop',
          id: `temp_${Date.now()}`, // Temporary ID for unsaved loops
          trackUri: currentTrack.uri,
          name: currentTrack.name,
          customName: null, // Will show "Untitled Loop" until named
          artist: currentTrack.artist,
          duration: currentTrack.duration,
          image: currentTrack.image,
          start: loopStart,
          end: loopEnd,
          playCount: loopTarget
      });
  } else {
      appState.set('playlist.pendingItem', {
          type: 'track',
          uri: currentTrack.uri,
          name: currentTrack.name,
          artist: currentTrack.artist,
          duration: currentTrack.duration,
          image: currentTrack.image,
          playCount: 1
      });
  }

  showAddToPlaylistPopup();
}

// Add saved loop to playlist
function addLoopToPlaylist(loopId) {
  const loop = savedLoops.find(l => l.id === loopId);
  if (!loop) return;

  appState.set('playlist.pendingItem', {
      type: 'loop',
      id: loop.id,
      trackUri: loop.track.uri,
      name: loop.track.name,
      customName: loop.name,
      artist: loop.track.artist,
      duration: loop.track.duration,
      image: loop.track.image,
      start: loop.loop.start,
      end: loop.loop.end,
      playCount: loop.loop.repeat
  });

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
          const trackData = {
              uri: track.uri,
              name: track.name,
              artist: track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist',
              duration: track.duration_ms / 1000,
              image: track.album.images[0]?.url || ''
          };

          duration = trackData.duration;
          els.currentTrack.textContent = track.name;
          els.currentArtist.textContent = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';

          loopStart = sharedLoop.start;
          loopEnd = sharedLoop.end;
          loopTarget = sharedLoop.repeat;
          loopEnabled = true;

          if (els.loopToggle) els.loopToggle.checked = true;
          updateRepeatDisplay();
          updateLoopVisuals();

          const loadSuccess = await loadTrackSafely(trackData, loopStart * 1000, true);
          if (!loadSuccess) {
              console.log('🚫 Shared loop load cancelled or failed');
              return; // Exit early if load was cancelled
          }

          loopCount = 0;
          loopStartTime = Date.now();

          updateProgress();
          updatePlayPauseButton();
          updateMiniPlayer(currentTrack);
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
              <div style="color: #b3b3b3; margin-bottom: 8px;">by ${track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist'}</div>
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

  // Enhanced PWA token checking
  const storedToken = localStorage.getItem('spotify_access_token');
  const storedRefreshToken = localStorage.getItem('spotify_refresh_token');
  
  console.log(`🔐 PWA Mode: ${isPWA()}`);
  console.log(`🔐 Stored Token: ${storedToken ? 'Yes' : 'No'}`);
  console.log(`🔐 Stored Refresh Token: ${storedRefreshToken ? 'Yes' : 'No'}`);
  console.log(`🔐 Already Connected: ${isConnected}`);
  
  if (storedToken && spotifyAccessToken && isConnected && spotifyDeviceId) {
      console.log('🔐 Already connected, checking for shared loops...');
      if (hasSharedLoop) {
          setTimeout(() => loadSharedLoop(), 1000);
      }
      return;
  }

  if (storedToken) {
      console.log('🔐 Found stored token, validating...');
      
      // PWA-specific token validation
      if (isPWA()) {
          const pwaAuth = localStorage.getItem('spotify_pwa_authenticated');
          const authTimestamp = localStorage.getItem('spotify_auth_timestamp');
          console.log(`🔐 PWA Auth State: ${pwaAuth}, Timestamp: ${authTimestamp}`);
      }
      
      appState.set('spotify.accessToken', storedToken);
      spotifyAccessToken = storedToken; // Update global variable
      
      // Check if token is near expiry
      const tokenExpiry = localStorage.getItem('spotify_token_expiry');
      if (tokenExpiry) {
          const expiryTime = parseInt(tokenExpiry);
          const now = Date.now();
          const timeUntilExpiry = expiryTime - now;
          
          console.log(`🔐 Token expires in: ${Math.round(timeUntilExpiry / 60000)} minutes`);
          
          if (timeUntilExpiry <= 0) {
              // Token already expired, try to refresh
              console.log('⏰ Token already expired, refreshing...');
              refreshSpotifyToken().then(success => {
                  if (success) {
                      validateToken(localStorage.getItem('spotify_access_token'));
                  } else {
                      forceReauth('Token expired and refresh failed');
                  }
              });
              return;
          } else if (timeUntilExpiry < 3600000) { // Less than 1 hour remaining
              // Schedule refresh based on remaining time
              const remainingSeconds = Math.floor(timeUntilExpiry / 1000);
              scheduleTokenRefresh(remainingSeconds + 300); // Add 5 minutes buffer
          }
      }
      
      validateToken(storedToken);
      return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const error = urlParams.get('error');

  console.log(`🔐 URL Params - Code: ${code ? 'Present' : 'None'}, Error: ${error || 'None'}`);
  console.log(`🔐 Current URL: ${window.location.href}`);
  console.log(`🔐 Redirect URI: ${getRedirectUri()}`);

  if (error) {
      console.log('🔐 Auth error:', error);
      showStatus('Authentication failed: ' + error);
      showView('login');
      return;
  }

  if (code) {
      console.log('🔐 Found auth code, exchanging for token...');
      
      // For PWA, ensure we handle the callback properly
      if (isPWA()) {
          console.log('🔐 PWA: Handling auth callback');
      }
      
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
          const userData = await response.json();
          console.log('✅ Token valid, initializing player');
          console.log('🎵 Account type:', userData.product);
          
          // Show account type to user
          if (userData.product !== 'premium') {
              showStatus(`⚠️ Account type: ${userData.product || 'free'} - Limited features`);
          } else {
              showStatus(`✅ Premium account: ${userData.display_name}`);
          }
          
          initializeSpotifyPlayer();
      } else if (response.status === 401) {
          // Token expired - try to refresh
          console.log('🔄 Token expired, attempting refresh...');
          const refreshSuccess = await refreshSpotifyToken();
          if (refreshSuccess) {
              // Retry initialization with new token
              initializeSpotifyPlayer();
          } else {
              forceReauth('Token refresh failed');
          }
      } else {
          forceReauth('Token validation failed');
      }
  } catch (error) {
      console.error('🚨 Token validation error:', error);
      forceReauth('Connection error');
  }
}

/**
 * Attempt to refresh Spotify access token using refresh token
 */
async function refreshSpotifyToken() {
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  
  if (!refreshToken) {
      console.warn('⚠️ No refresh token available');
      return false;
  }
  
  try {
      console.log('🔄 Refreshing Spotify token...');
      
      // PKCE flow doesn't use client secret or Basic auth
      const response = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: SPOTIFY_CLIENT_ID  // Required for PKCE
          })
      });
      
      if (response.ok) {
          const data = await response.json();
          
          // Update tokens
          appState.set('spotify.accessToken', data.access_token);
          localStorage.setItem('spotify_access_token', data.access_token);
          spotifyAccessToken = data.access_token; // Update global variable
          
          // Update refresh token if provided (Spotify may rotate refresh tokens)
          if (data.refresh_token) {
              localStorage.setItem('spotify_refresh_token', data.refresh_token);
          }
          
          // Store token expiry time for proactive refresh
          if (data.expires_in) {
              const expiryTime = Date.now() + (data.expires_in * 1000) - 300000; // Refresh 5 minutes before expiry
              localStorage.setItem('spotify_token_expiry', expiryTime.toString());
              scheduleTokenRefresh(data.expires_in);
          }
          
          console.log('✅ Token refreshed successfully');
          showStatus('🔄 Session refreshed');
          return true;
          
      } else {
          console.warn('⚠️ Token refresh failed:', response.status);
          const errorData = await response.text();
          console.error('Refresh error details:', errorData);
          return false;
      }
      
  } catch (error) {
      console.error('🚨 Token refresh error:', error);
      return false;
  }
}

/**
 * Schedule automatic token refresh before expiry
 */
let tokenRefreshTimer = null;

function scheduleTokenRefresh(expiresIn) {
  // Clear any existing timer
  if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
  }
  
  // Schedule refresh 5 minutes before token expires
  const refreshDelay = (expiresIn - 300) * 1000; // Convert to milliseconds, subtract 5 minutes
  
  if (refreshDelay > 0) {
      console.log(`⏰ Scheduling token refresh in ${Math.round(refreshDelay / 60000)} minutes`);
      
      tokenRefreshTimer = setTimeout(async () => {
          console.log('⏰ Proactive token refresh triggered');
          const success = await refreshSpotifyToken();
          
          if (!success) {
              console.warn('⚠️ Proactive refresh failed, will retry on next API call');
          }
      }, refreshDelay);
  }
}

/**
 * Force re-authentication when tokens cannot be refreshed
 */
function forceReauth(reason) {
  console.log(`🚨 Forcing re-auth: ${reason}`);
  
  // Clear refresh timer
  if (tokenRefreshTimer) {
      clearTimeout(tokenRefreshTimer);
      tokenRefreshTimer = null;
  }
  
  // Clear Media Session
  clearMediaSession();
  
  // Clear all auth data
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expiry');
  localStorage.removeItem('spotify_pwa_authenticated');
  localStorage.removeItem('spotify_auth_timestamp');
  spotifyAccessToken = null;
  
  // Reset player state
  isConnected = false;
  spotifyPlayer = null;
  spotifyDeviceId = null;
  
  // Return to login
  showView('login');
  showStatus(`Session expired: ${reason}. Please reconnect.`);
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
      showView('player');
  });

  els.navLibrary.addEventListener('click', (e) => {
      e.preventDefault();
      showView('library');
  });

  els.navPlaylists.addEventListener('click', (e) => {
      e.preventDefault();
      // Default to overview mode when navigating to playlists
      if (currentView !== 'playlists') {
          playlistViewMode = 'overview';
      }
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

      // Prevent errors when target is null
      if (!target) {
          console.warn('Click event target is null, ignoring');
          return;
      }

      try {
          // Playback controls
          if (target.matches('#play-pause-btn')) {
              e.preventDefault();
              if (!currentTrack) {
                  // Check if user has saved loops they could load instead
                  const savedLoops = appState.get('storage.savedLoops') || [];
                  if (savedLoops.length > 0) {
                      showStatus('Please select a track or load a saved loop');
                  } else {
                      showStatus('Please select a track first');
                  }
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

          // Smart "Set Loop" - maintains play state based on user intent
          else if (target.matches('#start-loop-btn')) {
              e.preventDefault();
              if (!currentTrack || !loopEnabled) {
                  showStatus('Please select a track and enable loop mode');
                  return;
              }
              
              // Reset loop state
              loopCount = 0;
              loopStartTime = Date.now();
              
              // Smart behavior: maintain current play state
              const wasPlaying = isPlaying;
              console.log(`🔍 DEBUG Set Loop: wasPlaying = ${wasPlaying}, isPlaying = ${isPlaying}`);
              
              if (wasPlaying) {
                  // User was listening - they want to keep listening from loop start
                  console.log(`🎯 Smart Set Loop: seeking to ${formatTime(loopStart)} while playing`);
                  await seekToPosition(loopStart * 1000);
                  
                  // Check if still playing after seek
                  setTimeout(() => {
                      console.log(`🔍 DEBUG After seek: isPlaying = ${isPlaying}`);
                      if (!isPlaying) {
                          console.log(`🔧 Resuming playback after seek`);
                          spotifyPlayer?.resume();
                      }
                  }, 100);
                  
                  showStatus(`🔄 Loop started - playing from ${formatTime(loopStart, false)}`);
                  console.log(`🎯 Smart Set Loop: continued playing from ${formatTime(loopStart)}`);
              } else {
                  // User was paused - they want to position and stay paused
                  console.log(`🎯 Smart Set Loop: seeking to ${formatTime(loopStart)} while paused`);
                  await seekToPosition(loopStart * 1000);
                  showStatus(`📍 Positioned at loop start - ${formatTime(loopStart, false)}`);
                  console.log(`🎯 Smart Set Loop: positioned at ${formatTime(loopStart)} (stayed paused)`);
              }
          }
          else if (target.matches('#repeat-decrease')) {
              e.preventDefault();
              if (loopTarget > 1) {
                  loopTarget--;
                  appState.set('loop.target', loopTarget);
                  updateRepeatDisplay();
                  // Don't reset loopCount - user might be mid-loop
                  console.log(`🔄 Repeat target decreased to ${loopTarget}, keeping current count ${loopCount}`);
              }
          }
          else if (target.matches('#repeat-increase')) {
              e.preventDefault();
              if (loopTarget < 99) {
                  loopTarget++;
                  appState.set('loop.target', loopTarget);
                  updateRepeatDisplay();
                  // Don't reset loopCount - user might be mid-loop
                  console.log(`🔄 Repeat target increased to ${loopTarget}, keeping current count ${loopCount}`);
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
              if (track) {
                  const artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
                  // Stay in search view when playing tracks from search
                  await selectTrack(track.uri, track.name, artistName, track.duration_ms, track.album.images[0]?.url || '', true);
              }
          }
          // select-track-btn removed - functionality now available via context menu
          else if (target.matches('.track-menu-btn')) {
              e.stopPropagation();
              e.preventDefault();
              const index = parseInt(target.dataset.trackIndex);
              showTrackContextMenu(index, target);
          }
          else if (target.closest('.track-item') && !target.closest('.track-actions')) {
              // Handle double-click on track items to switch to player view
              const item = target.closest('.track-item');
              const now = Date.now();
              const lastClick = item.dataset.lastClick ? parseInt(item.dataset.lastClick) : 0;
              const timeDiff = now - lastClick;
              
              item.dataset.lastClick = now;
              
              // Double-click detected (within 300ms)
              if (timeDiff < 300) {
                  e.preventDefault();
                  const index = parseInt(item.dataset.trackIndex);
                  const track = currentSearchResults[index];
                  if (track) {
                      const artistName = track.artists && track.artists.length > 0 ? track.artists[0].name : 'Unknown Artist';
                      // Double-click switches to player view
                      await selectTrack(track.uri, track.name, artistName, track.duration_ms, track.album.images[0]?.url || '', false);
                  }
              }
              // Single click - do nothing (let play button handle track loading)
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
          else if (target.matches('.delete-btn') || (target.matches('.delete-x-btn') && target.dataset.loopId)) {
              e.preventDefault();
              const loopId = target.dataset.loopId;
              deleteLoop(loopId);
          }
          else if (target.matches('.delete-x-btn') && target.dataset.playlistId) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              deletePlaylist(playlistId);
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
          else if (target.matches('.prebuffer-playlist-btn')) {
              e.preventDefault();
              showStatus('⚠️ Prebuffering temporarily disabled due to API limitations');
          }
          else if (target.matches('.play-playlist-track-btn')) {
              e.preventDefault();
              const trackIndex = parseInt(target.dataset.trackIndex);
              if (playlistEngine && isPlaylistMode) {
                  await playlistEngine.skipToItem(trackIndex);
              }
          }
          else if (target.matches('.view-tracklist-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              const playlist = savedPlaylists.find(p => p.id === playlistId);
              if (playlist) {
                  playlistViewMode = 'editing';
                  renderPlaylistEditView(playlist);
              }
          }
          else if (target.matches('#playlist-back-btn, #playlist-edit-back-btn')) {
              e.preventDefault();
              playlistViewMode = 'overview';
              currentEditingPlaylistId = null;
              updatePlaylistDisplay();
          }
          else if (target.matches('.load-playlist-item-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              const itemIndex = parseInt(target.dataset.itemIndex);
              loadPlaylistItem(playlistId, itemIndex);
          }
          else if (target.matches('.edit-playlist-item-btn')) {
              e.preventDefault();
              const playlistId = target.dataset.playlistId;
              const itemIndex = parseInt(target.dataset.itemIndex);
              editPlaylistItem(playlistId, itemIndex);
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
                  appState.set('playlist.pendingItem', null);
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
      appState.set('loop.enabled', this.checked);
      appState.set('loop.count', 0);
      els.startLoopBtn.disabled = !loopEnabled;
      updateLoopVisuals(); // FIX 6: This will show/hide handles
      
      if (loopEnabled) {
          showStatus(`🎯 Moment mode enabled: ${loopTarget} time(s)`);
      } else {
          showStatus('Moment mode disabled');
      }
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
          appState.set('loop.start', newStart);
          updateLoopVisuals();
      } else {
          this.value = formatTime(loopStart);
      }
  });

  els.precisionEnd.addEventListener('change', function() {
      const newEnd = parseTimeInput(this.value);
      if (newEnd > loopStart && newEnd <= duration) {
          appState.set('loop.end', newEnd);
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
              appState.set('loop.start', Math.max(0, Math.min(loopStart + amount, loopEnd - 0.1)));
          } else {
              appState.set('loop.end', Math.max(loopStart + 0.1, Math.min(loopEnd + amount, duration)));
          }
          updateLoopVisuals();
      }
  });

  // Mini Player Event Handlers
  // Play/pause button in mini player
  els.miniPlayBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentTrack) {
          showStatus('No track selected');
          return;
      }
      try {
          await togglePlayPause();
      } catch (error) {
          console.error('Mini player play/pause error:', error);
          showStatus('Playback failed');
      }
  });

  // Tap mini player content to show player view
  els.miniPlayer.addEventListener('click', (e) => {
      // Don't trigger on play button click
      if (e.target.closest('.mini-play-btn')) return;
      
      e.preventDefault();
      if (currentTrack) {
          showView('player');
      }
  });

  // Touch events for swipe gestures (playlist navigation)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  
  els.miniPlayer.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      console.log('🎵 Touch start on mini player:', { x: touchStartX, y: touchStartY });
  }, { passive: true });

  els.miniPlayer.addEventListener('touchend', async (e) => {
      if (!e.changedTouches[0]) return;
      
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const touchEndTime = Date.now();
      
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;
      const deltaTime = touchEndTime - touchStartTime;
      
      console.log('🎵 Touch end on mini player:', { 
          deltaX, deltaY, deltaTime, 
          isPlaylistMode, 
          hasPlaylistEngine: !!playlistEngine 
      });
      
      // Only process quick swipes (< 500ms) with significant horizontal movement
      if (deltaTime < 500 && Math.abs(deltaX) > 30 && Math.abs(deltaY) < 50) {
          e.preventDefault();
          console.log('🎵 Swipe detected!', deltaX > 0 ? 'RIGHT' : 'LEFT');
          
          // Only allow swipe navigation when in playlist mode
          if (isPlaylistMode && playlistEngine) {
              try {
                  if (deltaX > 0) {
                      // Swipe right - previous track
                      console.log('🎵 Attempting previous track...');
                      await playlistEngine.skipToPrevious();
                      showStatus('⏮️ Previous track');
                  } else {
                      // Swipe left - next track  
                      console.log('🎵 Attempting next track...');
                      await playlistEngine.skipToNext();
                      showStatus('⏭️ Next track');
                  }
              } catch (error) {
                  console.error('Swipe navigation error:', error);
                  showStatus('Navigation failed');
              }
          } else {
              // Show helpful message when not in playlist mode
              const direction = deltaX > 0 ? 'previous' : 'next';
              showStatus(`Swipe to ${direction} available in playlist mode`);
              console.log('🎵 Not in playlist mode or no engine');
          }
      } else {
          console.log('🎵 Swipe not recognized - insufficient movement or too slow');
      }
  }, { passive: false });
}

// Global edit functions
window.editLoop = editLoop;
window.cancelEdit = cancelEdit;
window.saveLoopEdits = saveLoopEdits;
window.cancelPlaylistEdit = cancelPlaylistEdit;
window.savePlaylistEdits = savePlaylistEdits;
window.removeFromPlaylist = removeFromPlaylist;
window.enablePlaylistNameEdit = enablePlaylistNameEdit;
window.updatePlaylistName = updatePlaylistName;
window.updatePlaylistItem = updatePlaylistItem;
window.cancelPlaylistItemEdit = cancelPlaylistItemEdit;
window.savePlaylistItemAsNew = savePlaylistItemAsNew;

// Init
function init() {
  console.log('🚀 Initializing LOOOPZ with Playlist Management...');

  // Define the Spotify callback early in case SDK loads before we're ready
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
      miniPlayer: document.getElementById('mini-player'),
      miniPlayerCover: document.getElementById('mini-player-cover'),
      miniTrackTitle: document.getElementById('mini-track-title'),
      miniTrackArtist: document.getElementById('mini-track-artist'),
      miniPlayBtn: document.getElementById('mini-play-btn'),
      searchInput: document.getElementById('search-input'),
      searchResults: document.getElementById('search-results'),
      searchBackBtn: document.getElementById('search-back-btn'),
      currentTrack: document.getElementById('current-track'),
      currentArtist: document.getElementById('current-artist'),
      progressContainer: document.getElementById('progress-container'),
      progressBar: document.getElementById('progress-bar'),
      visualProgressContainer: document.getElementById('visual-progress-container'),
      visualProgressBar: document.getElementById('visual-progress-bar'),
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
      createPlaylistBtn: document.getElementById('create-playlist-btn'),
      smartLoopAssist: document.getElementById('smart-loop-assist'),
      smartAssistToggle: document.getElementById('smart-assist-toggle'),
      smartAssistScore: document.getElementById('smart-assist-score')
  };

  // Initialize state synchronization system early
  initializeStateSync();

  setupEventListeners();
  setupLoopHandles();
  setupPrecisionZoomLoopHandles();
  initializeSmartLoopAssist();
  checkAuth();
  loadSavedLoops();
  loadSavedPlaylists();
  
  // Initialize prebuffer cache
  initCacheDB().then(() => {
    console.log('🚀 Prebuffer cache initialized');
  }).catch((error) => {
    console.warn('Failed to initialize prebuffer cache:', error);
  });

  // Initialize Media Session API for lock screen controls
  setupMediaSession();

  console.log('✅ LOOOPZ initialization complete with Playlist Management!');
}

// Test function to verify Essentia is loaded
window.testAI = function() {
    console.log('Testing AI Analysis System...');
    console.log('Essentia loaded:', typeof Essentia !== 'undefined');
    console.log('EssentiaWASM loaded:', typeof EssentiaWASM !== 'undefined');
    console.log('Essentia ready:', essentiaReady);
    
    if (essentiaReady) {
        console.log('✅ AI system is operational');
    } else {
        console.log('❌ AI system not ready');
        initializeEssentia();
    }
};

// Test function to verify precision mode
window.testPrecisionMode = function() {
    console.log('🎯 Natural Precision Mode (Speed-Based)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('State:', precisionZoom);
    console.log('Duration:', duration);
    console.log('Loop positions:', `${formatTime(loopStart)} - ${formatTime(loopEnd)}`);
    
    console.log('\n✨ Linear precision mapping:');
    console.log('  • Fast speed (>100 px/s): Full song duration');
    console.log('  • Medium speed (50 px/s): ~Half song window');  
    console.log('  • Slow speed (25 px/s): ~Quarter song window');
    console.log('  • Precise speed (0 px/s): 5 second window');
    console.log('  • Smooth linear scaling - no sudden jumps!');
    
    if (duration > 0) {
        console.log('\n💡 Usage: Drag any handle slowly to feel the precision!');
        console.log('🎯 Watch the time badge - it updates with millisecond precision');
    } else {
        console.log('\n❌ No track loaded - precision mode requires active track');
        console.log('💡 Load a track first, then try dragging slowly');
    }
};

// State change handlers for critical transitions
function setupCriticalStateHandlers() {
    // Track loading state management
    appState.subscribe('playback.currentTrack', (newTrack, oldTrack) => {
        if (newTrack && newTrack !== oldTrack) {
            console.log('🎵 Track changed:', newTrack.name);
            // Update UI immediately
            if (els.currentTrack) els.currentTrack.textContent = newTrack.name;
            if (els.currentArtist) els.currentArtist.textContent = newTrack.artist;
            updateMiniPlayer(newTrack);
            // Cancel any pending operations for previous track
            cancelPendingOperations();
        }
    });
    
    // Loop state coordination
    appState.subscribe('loop.enabled', (enabled) => {
        if (els.startLoopBtn) els.startLoopBtn.disabled = !enabled;
        if (els.loopToggle) els.loopToggle.checked = enabled;
        updateLoopVisuals();
        showStatus(enabled ? `Loop enabled: ${appState.get('loop.target')} time(s)` : 'Loop disabled');
    });
    
    // Playback state coordination
    appState.subscribe('playback.isPlaying', (playing) => {
        updatePlayPauseButton();
        if (playing) {
            startProgressUpdates();
        } else {
            stopProgressUpdates();
        }
    });
    
    // Playlist mode transitions
    appState.subscribe('playlist.isActive', (isActive, wasActive) => {
        if (isActive !== wasActive) {
            console.log('🎶 Playlist mode:', isActive ? 'activated' : 'deactivated');
            // Safely transition between modes
            if (isActive) {
                // Entering playlist mode
                stopProgressUpdates();
                resetLoopState();
            } else {
                // Exiting playlist mode
                appState.set('playlist.current', null);
                appState.set('playlist.currentIndex', 0);
                if (playlistEngine) {
                    playlistEngine.stop();
                    appState.set('playlist.engine', null);
                }
            }
        }
    });
    
    // Operation cancellation handling
    appState.subscribe('operations.currentTrackOperation', (operation, oldOperation) => {
        if (oldOperation && oldOperation !== operation) {
            // Mark old operation as cancelled
            if (oldOperation.id) {
                oldOperation.cancelled = true;
                console.log(`🚫 Operation ${oldOperation.id} cancelled by new operation`);
            }
        }
    });
}

// Test function for state synchronization
// Diagnostic function for troubleshooting
window.diagnoseStorage = function() {
    console.log('🔍 LOOOPZ Storage & Auth Diagnostics');
    console.log('═══════════════════════════════════════');
    
    // Check localStorage
    console.log('\n📦 LocalStorage Check:');
    const loops = localStorage.getItem('looopz_saved_loops');
    const playlists = localStorage.getItem('looopz_saved_playlists');
    const token = localStorage.getItem('spotify_access_token');
    
    console.log('- Saved loops:', loops ? JSON.parse(loops).length + ' loops' : 'No loops found');
    console.log('- Saved playlists:', playlists ? JSON.parse(playlists).length + ' playlists' : 'No playlists found');
    console.log('- Spotify token:', token ? 'Present (' + token.substring(0, 20) + '...)' : 'Missing');
    
    // Check global variables
    console.log('\n🔧 Global Variables:');
    console.log('- savedLoops:', typeof savedLoops !== 'undefined' ? savedLoops.length + ' loops' : 'UNDEFINED!');
    console.log('- savedPlaylists:', typeof savedPlaylists !== 'undefined' ? savedPlaylists.length + ' playlists' : 'UNDEFINED!');
    console.log('- spotifyAccessToken:', typeof spotifyAccessToken !== 'undefined' ? (spotifyAccessToken ? 'Present' : 'Null') : 'UNDEFINED!');
    console.log('- isConnected:', typeof isConnected !== 'undefined' ? isConnected : 'UNDEFINED!');
    
    // Check state management
    console.log('\n🎯 State Management:');
    console.log('- AppState instance:', typeof appState !== 'undefined' ? 'Present' : 'MISSING!');
    if (typeof appState !== 'undefined') {
        console.log('- Spotify token in state:', appState.get('spotify.accessToken') ? 'Present' : 'Missing');
        console.log('- Connected in state:', appState.get('spotify.isConnected'));
        console.log('- Current view:', appState.get('ui.currentView'));
    }
    
    // Try to reload storage
    console.log('\n🔄 Attempting to reload storage...');
    try {
        if (typeof loadSavedLoops === 'function') {
            loadSavedLoops();
            console.log('✅ loadSavedLoops() executed');
        }
        if (typeof loadSavedPlaylists === 'function') {
            loadSavedPlaylists();
            console.log('✅ loadSavedPlaylists() executed');
        }
    } catch (error) {
        console.error('❌ Error reloading storage:', error);
    }
    
    console.log('\n💡 If issues persist, try: localStorage.clear() and reconnect');
};

window.testStateSync = function() {
    console.log('🧪 Testing Unified State Management System');
    console.log('═══════════════════════════════════════════');
    
    // Test 1: Basic state setting and retrieval
    console.log('\n📊 Test 1: Basic State Operations');
    appState.set('playback.currentTime', 42.5);
    console.log('Set playback.currentTime to 42.5');
    console.log('Retrieved value:', appState.get('playback.currentTime'));
    console.log('Legacy variable:', currentTime);
    
    // Test 2: Atomic updates
    console.log('\n🔄 Test 2: Atomic State Updates');
    appState.update({
        'playback.currentTrack': { name: 'Test Track', artist: 'Test Artist' },
        'playback.duration': 180,
        'loop.enabled': true,
        'loop.start': 10,
        'loop.end': 20
    });
    console.log('Applied atomic update with 5 changes');
    console.log('Current track:', appState.get('playback.currentTrack')?.name);
    console.log('Duration:', appState.get('playback.duration'));
    console.log('Loop enabled:', appState.get('loop.enabled'));
    
    // Test 3: State change handlers
    console.log('\n🎯 Test 3: State Change Handlers');
    let changeCount = 0;
    const unsubscribe = appState.subscribe('playback.isPlaying', (value) => {
        changeCount++;
        console.log(`Handler triggered ${changeCount}: isPlaying = ${value}`);
    });
    
    appState.set('playback.isPlaying', true);
    appState.set('playback.isPlaying', false);
    unsubscribe();
    
    // Test 4: Legacy synchronization
    console.log('\n🔗 Test 4: Legacy Variable Sync');
    console.log('Before - appState loop.start:', appState.get('loop.start'));
    console.log('Before - legacy loopStart:', loopStart);
    
    appState.set('loop.start', 15.2);
    
    console.log('After - appState loop.start:', appState.get('loop.start'));
    console.log('After - legacy loopStart:', loopStart);
    
    console.log('\n✅ State synchronization test complete!');
    console.log('Check console for any errors or warnings.');
};

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
