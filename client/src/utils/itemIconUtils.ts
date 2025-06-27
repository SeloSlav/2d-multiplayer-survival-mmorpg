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
import potatoIcon from '../assets/items/potato.png';
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
import cookedPotatoIcon from '../assets/items/cooked_potato.png';
import burntPotatoIcon from '../assets/items/burnt_potato.png';
import pumpkinIcon from '../assets/items/pumpkin.png';
import cookedPumpkinIcon from '../assets/items/cooked_pumpkin.png';
import burntPumpkinIcon from '../assets/items/burnt_pumpkin.png';
import combatLadleIcon from '../assets/items/combat_ladle.png';
import deathMarkerIcon from '../assets/items/death_marker.png';
import stoneSpearIcon from '../assets/items/stone_spear.png';
import burlapCapeIcon from '../assets/items/burlap_cape.png';
import woodenArrowIcon from '../assets/items/wooden_arrow.png';
import boneArrowIcon from '../assets/items/bone_arrow.png';
import huntingBowIcon from '../assets/items/bow.png'; 
import boneFragmentsIcon from '../assets/items/bone_fragments.png';
import boneClubIcon from '../assets/items/bone_club.png';
import boneKnifeIcon from '../assets/items/bone_knife.png';
import skullIcon from '../assets/items/skull.png';
import animalFatIcon from '../assets/items/animal_fat.png';
import boneIcon from '../assets/items/bone.png';
import rawHumanFleshIcon from '../assets/items/human_meat.png';
import blueprintIcon from '../assets/items/blueprint.png';
import tallowIcon from '../assets/items/tallow.png';
import repairHammerIcon from '../assets/items/repair_hammer.png';
import cookedHumanFleshIcon from '../assets/items/cooked_human_meat.png';
import burntHumanFleshIcon from '../assets/items/burnt_human_meat.png';
import shelterIcon from '../assets/items/shelter.png';
import fireArrowIcon from '../assets/items/fire_arrow.png';
import tallowLampIcon from '../assets/items/lantern_off.png';
import tallowHeadLampIcon from '../assets/items/tallow_head_lamp.png';
import crossbowIcon from '../assets/items/crossbow.png';
import flashlightIcon from '../assets/items/flashlight.png';
import metalOreIcon from '../assets/items/metal_ore.png';
import metalFragmentsIcon from '../assets/items/metal_fragments.png';
import seloOliveOilIcon from '../assets/items/selo_olive_oil.png';
import ropeIcon from '../assets/items/rope.png';
import reedStalkIcon from '../assets/items/reed_stalk.png';
import reedSnorkelIcon from '../assets/items/reed_snorkel.png';
import boneHookIcon from '../assets/items/fishing_gaff_hook.png';
import fishingRodIcon from '../assets/items/reed_fishing_rod.png';
import rawTwigfishIcon from '../assets/items/raw_twigfish.png';
import tinCanIcon from '../assets/items/tin_can.png';
import cookedTwigfishIcon from '../assets/items/cooked_twigfish.png';
import burntTwigfishIcon from '../assets/items/burnt_twigfish.png';
import seedPotatoIcon from '../assets/items/seed_potato.png';
import cornSeedsIcon from '../assets/items/corn_seeds.png';
import hempSeedsIcon from '../assets/items/hemp_seeds.png';
import reedRhizomeIcon from '../assets/items/reed_rhizome.png';
import mushroomSporeIcon from '../assets/items/mushroom_spore.png';
import pumpkinSeedsIcon from '../assets/items/pumpkin_seeds.png';
import hollowReedArrowIcon from '../assets/items/hollow_reed_arrow.png';
import reedBellowsIcon from '../assets/items/reed_bellows.png';
import reedRainCollectorIcon from '../assets/items/reed_rain_collector.png';
import reedWaterBottleIcon from '../assets/items/reed_water_bottle.png';
import tinOfSpratsIcon from '../assets/items/tin_of_sprats.png';
import fermentedCabbageJarIcon from '../assets/items/fermented_cabbage_jar.png';
import oldHardtackBiscuitsIcon from '../assets/items/old_hardtack_biscuits.png';
import expiredSovietChocolateIcon from '../assets/items/expired_soviet_chocolate.png';
import mysteryCanIcon from '../assets/items/mystery_can.png';
import waterJugIcon from '../assets/items/water_jug.png';
import antiVenomIcon from '../assets/items/anti_venom.png';
import cableViperGlandIcon from '../assets/items/cable_viper_gland.png';

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
  'potato.png': potatoIcon,
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
  'cooked_potato.png': cookedPotatoIcon,
  'burnt_potato.png': burntPotatoIcon,
  'pumpkin.png': pumpkinIcon,
  'cooked_pumpkin.png': cookedPumpkinIcon,
  'burnt_pumpkin.png': burntPumpkinIcon,
  'combat_ladle.png': combatLadleIcon,
  'death_marker.png': deathMarkerIcon,
  'stone_spear.png': stoneSpearIcon,
  'burlap_cape.png': burlapCapeIcon,
  'wooden_arrow.png': woodenArrowIcon,
  'bone_arrow.png': boneArrowIcon,
  'bow.png': huntingBowIcon,
  'bone_fragments.png': boneFragmentsIcon,
  'bone_club.png': boneClubIcon,
  'bone_knife.png': boneKnifeIcon,
  'skull.png': skullIcon,
  'animal_fat.png': animalFatIcon,
  'bone.png': boneIcon,
  'human_meat.png': rawHumanFleshIcon,
  'blueprint.png': blueprintIcon,
  'tallow.png': tallowIcon,
  'repair_hammer.png': repairHammerIcon,
  'cooked_human_meat.png': cookedHumanFleshIcon,
  'burnt_human_meat.png': burntHumanFleshIcon,
  'shelter.png': shelterIcon,
  'fire_arrow.png': fireArrowIcon,
  'lantern_off.png': tallowLampIcon,
  'tallow_head_lamp.png': tallowHeadLampIcon,
  'crossbow.png': crossbowIcon,
  'flashlight.png': flashlightIcon,
  'metal_ore.png': metalOreIcon,
  'metal_fragments.png': metalFragmentsIcon,
  'selo_olive_oil.png': seloOliveOilIcon,
  'rope.png': ropeIcon,
  'reed_stalk.png': reedStalkIcon,
  'reed_snorkel.png': reedSnorkelIcon,
  'fishing_gaff_hook.png': boneHookIcon,
  'reed_fishing_rod.png': fishingRodIcon,
  'raw_twigfish.png': rawTwigfishIcon,
  'tin_can.png': tinCanIcon,
  'cooked_twigfish.png': cookedTwigfishIcon,
  'burnt_twigfish.png': burntTwigfishIcon,
  'seed_potato.png': seedPotatoIcon,
  'corn_seeds.png': cornSeedsIcon,
  'hemp_seeds.png': hempSeedsIcon,
  'reed_rhizome.png': reedRhizomeIcon,
  'mushroom_spore.png': mushroomSporeIcon,
  'pumpkin_seeds.png': pumpkinSeedsIcon,
  'hollow_reed_arrow.png': hollowReedArrowIcon,
  'reed_bellows.png': reedBellowsIcon,
  'reed_rain_collector.png': reedRainCollectorIcon,
  'reed_water_bottle.png': reedWaterBottleIcon,
  'tin_of_sprats.png': tinOfSpratsIcon,
  'fermented_cabbage_jar.png': fermentedCabbageJarIcon,
  'old_hardtack_biscuits.png': oldHardtackBiscuitsIcon,
  'expired_soviet_chocolate.png': expiredSovietChocolateIcon,
  'mystery_can.png': mysteryCanIcon,
  'water_jug.png': waterJugIcon,
  'anti_venom.png': antiVenomIcon,
  'cable_viper_gland.png': cableViperGlandIcon,
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