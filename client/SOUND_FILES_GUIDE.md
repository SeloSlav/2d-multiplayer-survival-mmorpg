# 🔊 Sound Files Guide

This guide explains what sound files you need to create for the hybrid sound system.

## 📁 Directory Structure

Place all sound files in: `client/public/sounds/`

```
client/public/sounds/
├── tree_chop.mp3     # Tree chopping sounds + variations
├── tree_chop1.mp3    # (tree_chop1.mp3, tree_chop2.mp3, etc.)
├── tree_chop2.mp3    
├── stone_hit.mp3     # Stone hitting sounds + variations
├── stone_hit1.mp3    # (stone_hit1.mp3, stone_hit2.mp3, etc.)
├── stone_hit2.mp3    
├── weapon_swing.mp3  # Weapon/tool swing sounds + variations
├── weapon_swing1.mp3 # (weapon_swing1.mp3, weapon_swing2.mp3, etc.)
├── button_click.mp3  # UI and other sound effects
├── item_pickup.mp3   
├── error.mp3         
├── drinking_water.mp3 # Water drinking sound effect
├── throwing_up.mp3   # Throwing up sound (salt water, food poisoning)
├── eating_food.mp3    # Eating food sound effect
├── campfire_looping.mp3 # Campfire ambient loop
└── [other sounds]    # Add any additional sound files as needed
```

## 🎵 Sound Categories & Usage

### 🌳 **Resource Gathering** (PREDICT_CONFIRM Strategy)
- **Tree chopping**: Played when hitting trees with hatchets/axes
- **Stone hitting**: Played when hitting stones with pickaxes
- **Drinking water**: Played when drinking from fresh water sources
- **Throwing up**: Played when drinking salt water or eating poisonous food
- **Eating food**: Played when eating food
- **Characteristics**: Short (0.1-0.5s), punchy, satisfying impact sounds
- **Volume**: Medium-high impact for satisfying feedback

### ⚔️ **Combat & Tools** (PREDICT_CONFIRM Strategy)  
- **Weapon swinging**: Generic weapon/tool swinging sounds
- **Characteristics**: Whoosh sounds, tool-specific if desired
- **Volume**: Medium impact for responsive combat

### 🖱️ **UI Sounds** (IMMEDIATE Strategy - Local Only)
- **Button clicks**: Clean, short click sound for UI interactions
- **Success sounds**: Positive, light sound for successful actions
- **Error sounds**: Distinct, brief negative sound for failures
- **Crafting sounds**: Satisfying completion sound for crafting
- **Characteristics**: Short (0.05-0.2s), clear, not intrusive
- **Volume**: Lower volume to avoid overwhelming gameplay

### 🏗️ **Building** (PREDICT_CONFIRM Strategy)
- **Structure placement**: Solid placement sound for buildings
- **Characteristics**: Substantial but not too long (0.2-0.6s)
- **Volume**: Medium impact for construction feedback

## 🎛️ Technical Specifications

### Audio Format
- **Format**: MP3 (for broad browser support)
- **Sample Rate**: 44.1kHz or 48kHz
- **Bit Rate**: 128-320 kbps (balance quality vs file size)
- **Channels**: Mono or Stereo (Mono preferred for smaller files)

### Duration Guidelines
- **UI Sounds**: 0.05-0.2 seconds
- **Action Sounds**: 0.1-0.5 seconds  
- **Impact Sounds**: 0.2-0.6 seconds
- **Ambient**: 0.5-2.0 seconds (if added later)

### Volume Guidelines
- **Peak Volume**: Normalize to -3dB to -6dB (avoid clipping)
- **Dynamic Range**: Keep sounds punchy but not harsh
- **Frequency Balance**: Clear mids for impact, some low-end for weight

## 🔧 Sound Variation System

The system automatically selects random variations:
- `sound_name.mp3` = Base sound (variation 0)
- `sound_name1.mp3` = Variation 1  
- `sound_name2.mp3` = Variation 2
- `sound_name3.mp3` = Variation 3 (optional)

**Recommended**: 2-4 variations per sound type  
**Minimum**: Base file + 1 variation  
**Maximum**: Base file + 3 variations (4 total)

## 🎯 Smart Item Detection

The system automatically detects item types and plays appropriate sounds:

```typescript
// Automatic sound selection based on equipped item:
if (itemName.includes('hatchet') || itemName.includes('axe')) {
    // Plays tree chopping sounds + variations
} else if (itemName.includes('pickaxe') || itemName.includes('pick')) {
    // Plays stone hitting sounds + variations  
} else {
    // Plays weapon swing sounds + variations
}
```

## 🚀 Hybrid System Benefits

### ⚡ **Immediate Feedback** (0ms latency)
- Local sounds play instantly when you perform actions
- No waiting for server confirmation
- Responsive, satisfying gameplay

### 🌐 **Multiplayer Sync** (Server-authoritative)  
- Other players hear your actions via server events
- Spatial audio with distance-based volume
- Prevents sound spam/cheating

### 🎛️ **Performance Optimized**
- Automatic audio caching and preloading
- Concurrent sound limiting
- Distance culling for performance

## 🧪 Testing Your Sounds

1. **Place files** in `client/public/sounds/`
2. **Start the game** - sounds preload automatically
3. **Test actions**:
   - Equip hatchet → Hit tree → Should hear tree chopping sound variations
   - Equip pickaxe → Hit stone → Should hear stone hitting sound variations  
   - Use bandage → Should hear UI click sound
   - Unarmed swing → Should hear weapon swing sound

4. **Check console** for sound system logs:
   ```
   🔊 Preloading common sounds...
   🔊 Sound system initialized  
   🔊 Local sound: [filename] (vol: [volume])
   ```

## 🎨 Sound Design Tips

### For Resource Gathering:
- **Tree Chop**: Wood impact, axe bite, satisfying thunk
- **Stone Hit**: Rock crack, metal ring, sharp impact
- **Drinking Water**: Water sipping/gulping sound, refreshing liquid sound
- **Throwing Up**: Unpleasant retching/vomiting sound, brief but distinct
- **Eating Food**: Eating food sound
- **Variations**: Change pitch slightly, different impact angles

### For UI:
- **Button Click**: Clean, modern, subtle
- **Success**: Light, positive, brief chime  
- **Error**: Distinct but not harsh, brief buzz/beep

### For Combat:
- **Weapon Swing**: Air whoosh, tool-specific if desired
- **Impact**: Varies by weapon type (future expansion)

## 🔄 Easy Integration

Once you create the sound files, the system works automatically:

```typescript
// One line to trigger sounds anywhere in the code:
import { playTreeChopSound, playStoneHitSound } from '../utils/soundTriggers';

playTreeChopSound();      // Instant feedback + multiplayer sync
playStoneHitSound();      // Instant feedback + multiplayer sync  
playButtonClickSound();   // Local UI feedback only
```

## 🎵 Example Sound Sources

- **Freesound.org**: Free sound effects with proper licensing
- **Zapsplat**: Professional sound library (subscription)
- **Adobe Audition/Audacity**: For editing and creating variations
- **Record your own**: Foley sounds with everyday objects

---

**Ready to test?** Just drop your MP3 files into `client/public/sounds/` and start playing! 🎮 