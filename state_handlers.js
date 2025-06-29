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

// Helper function to cancel pending operations
function cancelPendingOperations() {
    const currentOp = appState.get('operations.currentTrackOperation');
    if (currentOp) {
        currentOp.cancelled = true;
        console.log('🚫 Cancelled pending track operation');
    }
}