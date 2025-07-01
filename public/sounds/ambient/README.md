# 🌊 Ambient Sound Files for Aleutian Island

This directory contains atmospheric audio files for the 2D multiplayer survival game set on a remote Aleutian island.

## 📁 Required Audio Files

### Continuous/Looping Sounds (Wind, Ocean, Nature)
```
ambient_wind_light.mp3        - Gentle constant wind through grass and trees
ambient_wind_moderate.mp3     - Moderate wind with occasional gusts  
ambient_wind_strong.mp3       - Strong persistent wind for harsh weather
ambient_ocean.mp3             - General ocean waves and surf for island atmosphere
ambient_nature_general.mp3    - General nature ambience - insects, rustling
```

### Random/Periodic Sounds (Wildlife, Environment)
```
ambient_seagull_cry.mp3       - Seagulls crying in the distance
ambient_seagull_cry2.mp3      - (variation 2)
ambient_seagull_cry3.mp3      - (variation 3)

ambient_wolf_howl.mp3         - Distant wolf howls (night only)
ambient_wolf_howl2.mp3        - (variation 2)

ambient_raven_caw.mp3         - Ravens and crows cawing  
ambient_raven_caw2.mp3        - (variation 2)
ambient_raven_caw3.mp3        - (variation 3)

ambient_wind_gust.mp3         - Sudden wind gusts
ambient_wind_gust2.mp3        - (variation 2)

ambient_distant_thunder.mp3   - Very distant thunder for atmosphere
ambient_distant_thunder2.mp3  - (variation 2)
ambient_distant_thunder3.mp3  - (variation 3)

ambient_structure_creak.mp3   - Old structures creaking in the wind
ambient_structure_creak2.mp3  - (variation 2)

ambient_owl_hoot.mp3          - Owls hooting at night (night only)
ambient_owl_hoot2.mp3         - (variation 2)

ambient_grass_rustle.mp3      - Grass and vegetation rustling
ambient_grass_rustle2.mp3     - (variation 2)
```

## 🎵 Technical Specifications

- **Format**: MP3 (preferred) or OGG/WAV
- **Continuous sounds**: Should loop seamlessly (no gaps/clicks at loop point)
- **Random sounds**: 3-15 second one-shots that play periodically
- **Volume**: Already balanced in-game, so record at moderate levels
- **Quality**: 44.1kHz, stereo preferred but mono acceptable

## 🌍 Atmospheric Guidelines

The Aleutian Islands have a specific atmospheric character:
- **Wind**: Ever-present due to island location
- **Ocean**: Constant but distant waves, closer during storms  
- **Wildlife**: Seabirds (day), wolves/owls (night), ravens (anytime)
- **Weather**: Frequently overcast, rainy, stormy conditions
- **Isolation**: Remote, sparse human presence, old creaking structures

## 🔧 Integration Status

✅ **Fully Integrated**: 
- Seamless looping system with overlapping audio instances
- Weather-responsive wind intensity (Clear → Light → Moderate → Heavy → Storm)
- Time-of-day restrictions for nocturnal sounds
- Volume controlled by "ATMOSPHERIC SENSORS" in game settings menu
- Professional audio caching and performance optimization

## 🎮 Game Integration

The ambient sound system:
1. **Responds to weather**: Wind intensity changes based on server weather state
2. **Time-aware**: Nocturnal animals only play during night/midnight hours  
3. **Performance optimized**: Seamless looping prevents audio gaps
4. **User controllable**: Volume adjustable via game settings menu
5. **Resource efficient**: Smart caching and audio instance management

Place your audio files in this directory and the game will automatically detect and play them based on environmental conditions! 