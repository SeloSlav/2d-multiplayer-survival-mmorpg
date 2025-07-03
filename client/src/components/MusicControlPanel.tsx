import React, { useState } from 'react';
import { useMusicSystem } from '../hooks/useMusicSystem';

// Style constants matching DayNightCycleTracker
const UI_BG_COLOR = 'linear-gradient(135deg, rgba(30, 15, 50, 0.9), rgba(20, 10, 40, 0.95))';
const UI_BORDER_COLOR = '#00aaff';
const UI_SHADOW = '0 0 20px rgba(0, 170, 255, 0.4), inset 0 0 10px rgba(0, 170, 255, 0.1)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';

interface MusicControlPanelProps {
    musicSystem: ReturnType<typeof useMusicSystem>;
    musicVolume: number;
    onMusicVolumeChange: (volume: number) => void;
    isVisible: boolean;
}

// Custom Tooltip Component
interface TooltipProps {
    text: string;
    children: React.ReactNode;
}

const CustomTooltip: React.FC<TooltipProps> = ({ text, children }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    const handleMouseEnter = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPosition({
            x: rect.left + rect.width / 2,
            y: rect.top - 10
        });
        setIsVisible(true);
    };

    const handleMouseLeave = () => {
        setIsVisible(false);
    };

    return (
        <>
            <div
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                style={{ position: 'relative', display: 'inline-block' }}
            >
                {children}
            </div>
            {isVisible && (
                <div
                    style={{
                        position: 'fixed',
                        left: `${position.x}px`,
                        top: `${position.y}px`,
                        transform: 'translateX(-50%) translateY(-100%)',
                        background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.95), rgba(20, 10, 40, 0.95))',
                        color: '#00ffff',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: UI_FONT_FAMILY,
                        border: '1px solid #00aaff',
                        boxShadow: '0 0 15px rgba(0, 170, 255, 0.6)',
                        zIndex: 1000,
                        textShadow: '0 0 4px rgba(0, 255, 255, 0.8)',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none'
                    }}
                >
                    {text}
                    <div
                        style={{
                            position: 'absolute',
                            top: '100%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            width: 0,
                            height: 0,
                            borderLeft: '6px solid transparent',
                            borderRight: '6px solid transparent',
                            borderTop: '6px solid #00aaff',
                        }}
                    />
                </div>
            )}
        </>
    );
};

const MusicControlPanel: React.FC<MusicControlPanelProps> = ({
    musicSystem,
    musicVolume,
    onMusicVolumeChange,
    isVisible
}) => {
    const [isMinimized, setIsMinimized] = useState(false);
    // Optimistic UI state - show selected track immediately on click
    const [optimisticSelectedTrack, setOptimisticSelectedTrack] = useState<string | null>(null);

    if (!isVisible) return null;

    const {
        isPlaying,
        currentTrack,
        next: nextTrack,
        previous: previousTrack,
        start: startMusic,
        stop: stopMusic,
        toggleShuffle,
        tracklist: MUSIC_TRACKS,
        currentPosition,
        totalTracks,
        error,
        setVolume,
        shuffleMode,
        playSpecificTrack
    } = musicSystem;

    // Toggle play/pause
    const togglePlayPause = () => {
        if (isPlaying) {
            stopMusic();
        } else {
            startMusic();
        }
    };

    // Handle volume change - sync with both music system and parent
    const handleVolumeChange = (volume: number) => {
        setVolume(volume); // Update music system volume
        onMusicVolumeChange(volume); // Update parent/settings volume
    };

    // Handle shuffle toggle - toggleShuffle is synchronous, not async
    const handleShuffleToggle = () => {
        try {
            // console.log('🎵 Toggling shuffle from:', shuffleMode);
            toggleShuffle(); // This is synchronous, not async
            // console.log('🎵 Shuffle button clicked');
        } catch (error) {
            console.error('🎵 Failed to toggle shuffle:', error);
        }
    };

    // Handle track selection with optimistic UI
    const handleTrackClick = async (trackIndex: number) => {
        const selectedTrack = MUSIC_TRACKS[trackIndex];
        
        // Immediately update the visual selection (optimistic UI)
        setOptimisticSelectedTrack(selectedTrack.filename);
        
        try {
            // Start playing the track
            await playSpecificTrack(trackIndex);
            // Clear optimistic state once the real state updates
            setOptimisticSelectedTrack(null);
        } catch (error) {
            // If there's an error, clear the optimistic state
            setOptimisticSelectedTrack(null);
            console.error('Failed to play track:', error);
        }
    };

    // Handle next track with optimistic UI
    const handleNextTrack = async () => {
        try {
            // Get current state to calculate next track optimistically
            const currentPosition = musicSystem.currentPosition - 1; // Convert to 0-based index
            const totalTracks = MUSIC_TRACKS.length;
            let nextPosition = currentPosition + 1;
            
            // Handle wrap-around
            if (nextPosition >= totalTracks) {
                nextPosition = 0; // Go to first track
            }
            
            const nextTrack = MUSIC_TRACKS[nextPosition];
            if (nextTrack) {
                // Immediately show the next track as selected (optimistic UI)
                setOptimisticSelectedTrack(nextTrack.filename);
            }
            
            await musicSystem.next();
            // Clear optimistic state once the real state updates
            setOptimisticSelectedTrack(null);
        } catch (error) {
            // If there's an error, clear the optimistic state
            setOptimisticSelectedTrack(null);
            console.error('Failed to go to next track:', error);
        }
    };

    // Handle previous track with optimistic UI
    const handlePreviousTrack = async () => {
        try {
            // Get current state to calculate previous track optimistically
            const currentPosition = musicSystem.currentPosition - 1; // Convert to 0-based index
            const totalTracks = MUSIC_TRACKS.length;
            let prevPosition = currentPosition - 1;
            
            // Handle wrap-around
            if (prevPosition < 0) {
                prevPosition = totalTracks - 1; // Go to last track
            }
            
            const prevTrack = MUSIC_TRACKS[prevPosition];
            if (prevTrack) {
                // Immediately show the previous track as selected (optimistic UI)
                setOptimisticSelectedTrack(prevTrack.filename);
            }
            
            await musicSystem.previous();
            // Clear optimistic state once the real state updates
            setOptimisticSelectedTrack(null);
        } catch (error) {
            // If there's an error, clear the optimistic state
            setOptimisticSelectedTrack(null);
            console.error('Failed to go to previous track:', error);
        }
    };

    // Determine which track should appear selected (optimistic or actual)
    const getDisplaySelectedTrack = () => {
        if (optimisticSelectedTrack) {
            return optimisticSelectedTrack;
        }
        return currentTrack?.filename || null;
    };

    // Get the display track info for the current track display (optimistic or actual)
    const getDisplayTrackInfo = () => {
        if (optimisticSelectedTrack) {
            const optimisticTrack = MUSIC_TRACKS.find(track => track.filename === optimisticSelectedTrack);
            return optimisticTrack || currentTrack;
        }
        return currentTrack;
    };

    // Handle wheel events within the music panel to prevent Hotbar interference
    const handlePanelWheel = (event: React.WheelEvent) => {
        // Stop propagation to prevent Hotbar from handling this wheel event
        event.stopPropagation();
        // Let the default scrolling behavior work within the panel
    };

    // Calculate position below DayNightCycleTracker
    // DayNightCycleTracker: top: 15px, width: 240px, height: ~120-140px when expanded, ~40px when minimized
    const topPosition = '170px'; // Position well below the expanded tracker

    // Minimized view - just controls
    if (isMinimized) {
        return (
            <div 
                onWheel={handlePanelWheel}
                style={{
                    position: 'fixed',
                    top: topPosition,
                    right: '15px',
                    background: UI_BG_COLOR,
                    color: '#00ffff',
                    padding: '12px 16px', // Increased padding
                    borderRadius: '6px',
                    border: `2px solid ${UI_BORDER_COLOR}`,
                    boxShadow: UI_SHADOW,
                    zIndex: 49, // Below DayNightCycleTracker
                    fontSize: '14px', // Increased from 12px
                    fontFamily: UI_FONT_FAMILY,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px', // Increased gap
                    textShadow: '0 0 6px rgba(0, 255, 255, 0.6)',
                }}
            >
                <CustomTooltip text="Previous Track">
                    <button
                        onClick={handlePreviousTrack}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '14px', // Increased
                            padding: '6px', // Increased padding
                        }}
                    >
                        ⏮️
                    </button>
                </CustomTooltip>
                <CustomTooltip text={isPlaying ? 'Pause Music' : 'Play Music'}>
                    <button
                        onClick={togglePlayPause}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '16px', // Increased
                            padding: '6px', // Increased padding
                        }}
                    >
                        {isPlaying ? '⏸️' : '▶️'}
                    </button>
                </CustomTooltip>
                <CustomTooltip text="Next Track">
                    <button
                        onClick={handleNextTrack}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '14px', // Increased
                            padding: '6px', // Increased padding
                        }}
                    >
                        ⏭️
                    </button>
                </CustomTooltip>
                <CustomTooltip text="Expand Playlist">
                    <button
                        onClick={() => setIsMinimized(false)}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '12px', // Increased
                            padding: '6px', // Increased padding
                            opacity: 0.7,
                        }}
                    >
                        📋
                    </button>
                </CustomTooltip>
            </div>
        );
    }

    // Full expanded view
    return (
        <div 
            onWheel={handlePanelWheel}
            style={{
                position: 'fixed',
                top: topPosition,
                right: '15px',
                background: UI_BG_COLOR,
                color: '#00ffff',
                padding: '18px 22px', // Increased padding
                borderRadius: '8px',
                border: `2px solid ${UI_BORDER_COLOR}`,
                fontFamily: UI_FONT_FAMILY,
                boxShadow: UI_SHADOW,
                zIndex: 49, // Below DayNightCycleTracker
                width: '340px', // Increased width
                fontSize: '14px', // Increased base font size
                textShadow: '0 0 6px rgba(0, 255, 255, 0.6)',
            }}
        >
            {/* Header */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '16px', // Increased margin
                fontSize: '16px' // Increased header font
            }}>
                <span style={{ color: '#ff6b9d', textShadow: '0 0 8px #ff6b9d' }}>
                    🎵 NEURAL HARMONY
                </span>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <CustomTooltip text="Minimize Panel">
                        <button
                            onClick={() => setIsMinimized(true)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#00ffff',
                                cursor: 'pointer',
                                fontSize: '12px', // Increased
                                opacity: 0.7,
                            }}
                        >
                            ➖
                        </button>
                    </CustomTooltip>
                </div>
            </div>

            {/* Current Track Info */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ 
                    fontSize: '13px', // Increased from 11px
                    opacity: 0.9,
                    marginBottom: '8px', // Increased margin
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {getDisplayTrackInfo()?.displayName || 'No track selected'}
                </div>
                <div style={{ 
                    fontSize: '12px', // Increased from 10px
                    opacity: 0.6,
                    color: '#4ecdc4'
                }}>
                    Track {currentPosition} of {totalTracks} {shuffleMode ? '(Shuffled)' : '(Sequential)'}
                </div>
            </div>

            {/* Control Buttons */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                gap: '18px', // Increased gap
                marginBottom: '16px',
                alignItems: 'center'
            }}>
                <CustomTooltip text={shuffleMode ? 'Shuffle ON - Click to go Sequential' : 'Sequential - Click to Shuffle'}>
                    <button
                        onClick={handleShuffleToggle}
                        style={{
                            background: shuffleMode ? 'rgba(255, 107, 157, 0.5)' : 'rgba(255, 107, 157, 0.2)',
                            border: `2px solid ${shuffleMode ? '#ff6b9d' : '#ff6b9d66'}`,
                            color: shuffleMode ? '#ff6b9d' : '#ff6b9d99',
                            borderRadius: '6px', // Increased border radius
                            padding: '8px 10px', // Increased padding
                            cursor: 'pointer',
                            fontSize: '12px', // Increased
                            fontFamily: UI_FONT_FAMILY,
                            transition: 'all 0.2s ease',
                        }}
                    >
                        🔀
                    </button>
                </CustomTooltip>
                <CustomTooltip text="Previous Track">
                    <button
                        onClick={handlePreviousTrack}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '18px', // Increased
                        }}
                    >
                        ⏮️
                    </button>
                </CustomTooltip>
                <CustomTooltip text={isPlaying ? 'Pause Music' : 'Play Music'}>
                    <button
                        onClick={togglePlayPause}
                        style={{
                            background: isPlaying ? 'rgba(255, 107, 157, 0.3)' : 'rgba(78, 205, 196, 0.3)',
                            border: `2px solid ${isPlaying ? '#ff6b9d' : '#4ecdc4'}`,
                            color: isPlaying ? '#ff6b9d' : '#4ecdc4',
                            borderRadius: '50%',
                            width: '44px', // Increased size
                            height: '44px',
                            cursor: 'pointer',
                            fontSize: '18px', // Increased
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {isPlaying ? '⏸️' : '▶️'}
                    </button>
                </CustomTooltip>
                <CustomTooltip text="Next Track">
                    <button
                        onClick={handleNextTrack}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#00ffff',
                            cursor: 'pointer',
                            fontSize: '18px', // Increased
                        }}
                    >
                        ⏭️
                    </button>
                </CustomTooltip>
            </div>

            {/* Volume Control */}
            <div style={{ marginBottom: '16px' }}>
                <div style={{ 
                    fontSize: '12px', // Increased from 10px
                    marginBottom: '8px', // Increased margin
                    color: '#4ecdc4'
                }}>
                    Volume: {Math.round(musicVolume * 100)}%
                </div>
                <CustomTooltip text={`Music Volume: ${Math.round(musicVolume * 100)}%`}>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={musicVolume}
                        onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                        style={{
                            width: '100%',
                            height: '8px', // Increased height
                            background: 'rgba(0, 170, 255, 0.3)',
                            outline: 'none',
                            borderRadius: '4px', // Increased border radius
                            cursor: 'pointer',
                        }}
                    />
                </CustomTooltip>
            </div>

            {/* Playlist with custom scrollbar */}
            <div 
                style={{ 
                    maxHeight: '160px', // Increased height
                    overflowY: 'auto',
                    border: '1px solid rgba(0, 170, 255, 0.3)',
                    borderRadius: '6px', // Increased border radius
                    padding: '10px', // Increased padding
                    background: 'rgba(0, 0, 0, 0.3)'
                }}
                className="music-panel-scrollable"
            >
                <div style={{ 
                    fontSize: '12px', // Increased from 10px
                    marginBottom: '10px', // Increased margin
                    color: '#90ee90',
                    textAlign: 'center'
                }}>
                    TRACKLIST
                </div>
                {MUSIC_TRACKS.map((track, trackIndex) => {
                    const displaySelectedTrack = getDisplaySelectedTrack();
                    const isCurrentTrack = displaySelectedTrack === track.filename;
                    
                    return (
                        <div
                            key={`${track.filename}-${trackIndex}`}
                            onClick={() => handleTrackClick(trackIndex)}
                            style={{
                                fontSize: '11px', // Increased from 9px
                                padding: '6px 8px', // Increased padding
                                marginBottom: '4px', // Increased margin
                                cursor: 'pointer',
                                borderRadius: '4px', // Increased border radius
                                background: isCurrentTrack ? 'rgba(255, 107, 157, 0.3)' : 'transparent',
                                color: isCurrentTrack ? '#ff6b9d' : '#00ffff',
                                border: isCurrentTrack ? '1px solid #ff6b9d' : '1px solid transparent',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                transition: 'all 0.2s ease',
                                lineHeight: '1.4', // Better line spacing
                            }}
                            onMouseEnter={(e) => {
                                if (!isCurrentTrack) {
                                    e.currentTarget.style.background = 'rgba(78, 205, 196, 0.2)';
                                    e.currentTarget.style.color = '#4ecdc4';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isCurrentTrack) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = '#00ffff';
                                }
                            }}
                        >
                            {isCurrentTrack ? '▶ ' : `${trackIndex + 1}. `}
                            {track.displayName}
                            {optimisticSelectedTrack === track.filename && !currentTrack && (
                                <span style={{ 
                                    marginLeft: '4px', 
                                    fontSize: '9px', 
                                    opacity: 0.7,
                                    color: '#90ee90'
                                }}>
                                    Loading...
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Status */}
            {error && (
                <div style={{ 
                    marginTop: '12px', // Increased margin
                    fontSize: '11px', // Increased from 9px
                    color: '#ff4444',
                    textAlign: 'center',
                    padding: '8px', // Added padding
                    background: 'rgba(255, 68, 68, 0.1)',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 68, 68, 0.3)'
                }}>
                    Error: {error}
                </div>
            )}

            {/* Custom scrollbar styles */}
            <style>{`
                .music-panel-scrollable::-webkit-scrollbar {
                    width: 8px;
                }
                
                .music-panel-scrollable::-webkit-scrollbar-track {
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 4px;
                }
                
                .music-panel-scrollable::-webkit-scrollbar-thumb {
                    background: linear-gradient(180deg, #00aaff, #4ecdc4);
                    border-radius: 4px;
                    border: 1px solid rgba(0, 170, 255, 0.3);
                }
                
                .music-panel-scrollable::-webkit-scrollbar-thumb:hover {
                    background: linear-gradient(180deg, #00ccff, #5eeedd);
                }
                
                /* Firefox scrollbar */
                .music-panel-scrollable {
                    scrollbar-width: thin;
                    scrollbar-color: #00aaff rgba(0, 0, 0, 0.3);
                }
            `}</style>
        </div>
    );
};

export default MusicControlPanel; 