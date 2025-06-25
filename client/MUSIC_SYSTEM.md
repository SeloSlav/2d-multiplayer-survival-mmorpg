# 🎵 Music System Documentation

## Overview

The music system provides ambient background music for the 2D multiplayer survival game with efficient preloading, crossfading, and shuffle functionality.

## Features

- **Efficient Preloading**: All music tracks are preloaded during the loading screen for seamless playback
- **Auto-Shuffle**: Randomized playlist that automatically reshuffles when completed
- **Crossfading**: Smooth 3-second transitions between tracks
- **Loading Screen Integration**: Shows preload progress in the cyberpunk loading screen
- **Debug Controls**: Developer panel for testing and control (Press `M` to toggle)

## Music Files

All music files are located in `/public/music/` directory:

```
public/music/
├── Aleut_Ashfall.mp3 (3.7MB)
├── Aleut_Ashfall1.mp3 (5.1MB)
├── Babushka_Circuit.mp3 (5.5MB)
├── Babushka_Circuit1.mp3 (4.4MB)
├── Deadwomans_Harbor.mp3 (4.4MB)
├── Deadwomans_Harbor1.mp3 (5.7MB)
├── Inlet Fog.mp3 (4.0MB)
├── Inlet_Fog1.mp3 (4.8MB)
├── Kindling_Ritual.mp3 (4.9MB)
├── Kindling_Ritual1.mp3 (4.6MB)
├── Latchkey_Depths.mp3 (5.1MB)
├── Latchkey_Depths1.mp3 (4.8MB)
├── Low_Tide_Cache.mp3 (2.8MB)
├── Saltwind.mp3 (3.9MB)
├── Shiver_Doctrine.mp3 (3.3MB)
├── Shiver_Doctrine1.mp3 (5.8MB)
├── Snowblind_Signal.mp3 (6.4MB)
├── Snowblind_Signal1.mp3 (4.4MB)
├── Soupline_Dirge.mp3 (2.7MB)
├── Soupline_Dirge1.mp3 (2.7MB)
├── Spoiled_Tallow.mp3 (4.3MB)
└── Whalebone_Relay.mp3 (4.2MB)
```

**Total**: 22 tracks (~100MB total)

## User Experience

### Music Flow
1. **Loading Screen**: Music preloads in background, progress shown in logs
2. **Game Start**: Music automatically starts when loading completes
3. **Continuous Play**: Tracks automatically transition with crossfade
4. **Infinite Loop**: Playlist reshuffles when complete

### Volume & Controls
- **Default Volume**: 25% (background ambient)
- **No UI Controls**: Music plays seamlessly without player interaction needed
- **Debug Panel**: Available for developers (Press `M`)

## Technical Implementation

### Architecture
- **Hook**: `useMusicSystem` - Main music management
- **Cache**: Smart preloading with timeout handling
- **Integration**: Seamless with existing sound system
- **Performance**: Optimized loading and memory management

### Configuration
```typescript
const musicSystem = useMusicSystem({
    enabled: true,
    volume: 0.25,              // 25% volume
    crossfadeDuration: 3000,   // 3-second crossfade
    shuffleMode: true,         // Auto-shuffle enabled
    preloadAll: true,          // Preload all tracks
});
```

### Loading Screen Integration
- Shows preload progress: `└─ [AUDIO] Preloading ambient soundtrack... 75%`
- Completion message: `└─ [AUDIO] Ambient soundtrack loaded. Environment ready.`

## Debug Controls (Press `M`)

When the debug panel is open, you can:

- **Play/Stop**: Control music playback
- **Next/Previous**: Skip tracks manually  
- **Volume**: Adjust music volume (0-100%)
- **Shuffle**: Toggle shuffle mode on/off
- **Track List**: See all available tracks and current playing

### Debug Panel Features
- Real-time status display
- Preload progress monitoring
- Error reporting
- Track position indicator
- Full tracklist view

## Development

### Adding New Music
1. Place `.mp3` files in `/public/music/`
2. Update `MUSIC_TRACKS` array in `useMusicSystem.ts`
3. Follow naming convention: `Track_Name.mp3` and `Track_Name1.mp3` for variants

### Customization
- **Volume**: Adjust `DEFAULT_CONFIG.volume` in hook
- **Crossfade**: Modify `crossfadeDuration` setting
- **Preloading**: Control via `preloadAll` flag
- **Shuffle**: Toggle via `shuffleMode` setting

## Browser Compatibility

- **Modern Browsers**: Full support with Web Audio API
- **Fallback**: HTML5 Audio for older browsers
- **Mobile**: Respects autoplay policies
- **Performance**: Optimized for low CPU usage

## Performance Characteristics

- **Memory**: ~100MB for all tracks preloaded
- **CPU**: Minimal during playback
- **Network**: Front-loaded during game start
- **Battery**: Low impact on mobile devices

## Integration Points

### Loading Screen
- `CyberpunkLoadingScreen.tsx` - Shows preload progress
- Updates logs with music loading status

### App Flow
- `App.tsx` - Manages music lifecycle
- Starts music when loading completes
- Stops music when returning to loading

### Debug System
- `DebugContext.tsx` - Toggle controls
- `MusicDebugPanel.tsx` - Developer interface
- `GameScreen.tsx` - Keyboard shortcuts

## Console Logging

The system provides detailed console logs:

```
🎵 Starting music preload...
🎵 Preloaded: Aleut Ashfall (1/22)
🎵 Preloaded: Babushka Circuit (2/22)
...
🎵 Music preload complete! Loaded 22/22 tracks
🎵 Starting music system...
🎵 Playing: Saltwind
```

## Error Handling

- **Network Issues**: Graceful fallback for failed loads
- **Browser Limitations**: Autoplay policy compliance
- **Performance**: Automatic quality adjustment
- **User Experience**: Silent failures don't interrupt gameplay

---

*The music system provides an immersive, seamless audio experience that enhances the survival game atmosphere without interfering with gameplay or requiring user interaction.* 