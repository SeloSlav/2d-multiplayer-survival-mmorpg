// client/src/utils/itemIconUtils.ts

// Import default/error icon
import errorIcon from '../assets/items/error.png'; // Adjust path if needed

// Import all potential item icons
import woodIcon from '../assets/items/wood.png';
import stoneIcon from '../assets/items/stone.png';
import woodHatchetIcon from '../assets/items/wood_hatchet.png';
import pickAxeIcon from '../assets/items/pick_axe.png';
import campFireIcon from '../assets/items/campfire.png';
import rockItemIcon from '../assets/items/rock_item.png';
import clothShirtIcon from '../assets/items/cloth_shirt.png';
import clothPantsIcon from '../assets/items/cloth_pants.png';
import clothHatIcon from '../assets/items/cloth_hood.png';
import clothGlovesIcon from '../assets/items/cloth_gloves.png';
import clothBootsIcon from '../assets/items/cloth_boots.png';
import burlapSackIcon from '../assets/items/burlap_sack.png';
import burlapBackpackIcon from '../assets/items/burlap_backpack.png';
import mushroomIcon from '../assets/items/mushroom.png';
import cornIcon from '../assets/items/corn.png';
import woodenStorageBoxIcon from '../assets/items/wooden_storage_box.png';
import sleepingBagIcon from '../assets/items/sleeping_bag.png';
import clothIcon from '../assets/items/cloth.png';
import plantFiberIcon from '../assets/items/plant_fiber.png';
import bandageIcon from '../assets/items/bandage.png';
import torchIcon from '../assets/items/torch.png';
import torchFlameIcon from '../assets/items/torch_on.png';
import charcoalIcon from '../assets/items/charcoal.png';
import spearIcon from '../assets/items/spear.png';
import stashIcon from '../assets/items/stash.png';
import cookedMushroomIcon from '../assets/items/cooked_mushroom.png';
import burntMushroomIcon from '../assets/items/burnt_mushroom.png';
import cookedCornIcon from '../assets/items/cooked_corn.png';
import burntCornIcon from '../assets/items/burnt_corn.png';
import pumpkinIcon from '../assets/items/pumpkin.png';
import cookedPumpkinIcon from '../assets/items/cooked_pumpkin.png';
import burntPumpkinIcon from '../assets/items/burnt_pumpkin.png';
import combatLadleIcon from '../assets/items/combat_ladle.png';
import deathMarkerIcon from '../assets/items/death_marker.png';
// We don't import the missing ones (hood, boots, etc.)

// Create a mapping from the asset name (stored in DB) to the imported module path
// Use a Proxy or a function to handle fallbacks gracefully
const iconMap: { [key: string]: string | undefined } = {
  'wood.png': woodIcon,
  'stone.png': stoneIcon,
  'wood_hatchet.png': woodHatchetIcon,
  'pick_axe.png': pickAxeIcon,
  'campfire.png': campFireIcon,
  'rock_item.png': rockItemIcon,
  'cloth_shirt.png': clothShirtIcon,
  'cloth_pants.png': clothPantsIcon,
  'cloth_hood.png': clothHatIcon,
  'cloth_gloves.png': clothGlovesIcon,
  'cloth_boots.png': clothBootsIcon,
  'burlap_sack.png': burlapSackIcon,
  'burlap_backpack.png': burlapBackpackIcon,
  'mushroom.png': mushroomIcon,
  'corn.png': cornIcon,
  'wooden_storage_box.png': woodenStorageBoxIcon,
  'sleeping_bag.png': sleepingBagIcon,
  'cloth.png': clothIcon,
  'plant_fiber.png': plantFiberIcon,
  'bandage.png': bandageIcon,
  'torch.png': torchIcon,
  'torch_on.png': torchFlameIcon,
  'charcoal.png': charcoalIcon,
  'spear.png': spearIcon,
  'stash.png': stashIcon,
  'cooked_mushroom.png': cookedMushroomIcon,
  'burnt_mushroom.png': burntMushroomIcon,
  'cooked_corn.png': cookedCornIcon,
  'burnt_corn.png': burntCornIcon,
  'pumpkin.png': pumpkinIcon,
  'cooked_pumpkin.png': cookedPumpkinIcon,
  'burnt_pumpkin.png': burntPumpkinIcon,
  'combat_ladle.png': combatLadleIcon,
  'death_marker.png': deathMarkerIcon,
  // Add mappings for existing icons only
};

// Export a function that provides the fallback logic
export function getItemIcon(assetName: string | undefined | null): string {
    if (!assetName) {
        console.log('[ItemIconUtils] assetName is missing, returning errorIcon');
        return errorIcon; // Return error icon if assetName is missing
    }
    const iconPath = iconMap[assetName];
    if (!iconPath) {
        // Log details if the specific assetName for spear is not found
        console.log(`[ItemIconUtils] No icon found in map for '${assetName}', returning errorIcon. Mapped value:`, iconPath);
    }
    return iconPath || errorIcon; // Return mapped icon or error icon
}

// Keep the itemIcons map export if it's used elsewhere, but prefer getItemIcon
export const itemIcons = iconMap; // Deprecate direct use of this?

// Deprecate this function? getItemIcon replaces it.
// export function getItemIconPath(assetName: string): string | undefined {
//   return itemIcons[assetName];
// } 