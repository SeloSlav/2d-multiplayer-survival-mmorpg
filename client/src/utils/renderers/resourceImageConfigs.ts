// Resource Image Configuration
// Centralized location for all resource image imports and mappings

import type { HarvestableResourceType } from '../../types/resourceTypes';

// Import existing resource images
import cornImageSource from '../../assets/doodads/corn_stalk_b.png';
import borealNettleImageSource from '../../assets/doodads/hemp_c.png'; // Reusing hemp image for BorealNettle
import potatoImageSource from '../../assets/doodads/potato_b.png';
import pumpkinImageSource from '../../assets/doodads/pumpkin_b.png';
import reedImageSource from '../../assets/doodads/reed_stalk_b.png';
import beachLymeGrassImageSource from '../../assets/doodads/beach_lyme_grass_c.png';
import wheatImageSource from '../../assets/doodads/wheat_b.png';
import carrotsImageSource from '../../assets/doodads/carrot_b.png';
import tomatoesImageSource from '../../assets/doodads/tomato_b.png';
import cabbageImageSource from '../../assets/doodads/cabbage_b.png';
import radishImageSource from '../../assets/doodads/radish_b.png';
import beetsImageSource from '../../assets/doodads/beet_b.png';
import buckwheatImageSource from '../../assets/doodads/buckwheat_b.png';
import turnipsImageSource from '../../assets/doodads/turnip_b.png';
import onionsImageSource from '../../assets/doodads/onion_b.png';
import garlicImageSource from '../../assets/doodads/garlic_b.png';
import parsnipsImageSource from '../../assets/doodads/parsnip_b.png';
import horseradishImageSource from '../../assets/doodads/horseradish_b.png';
import chicoryImageSource from '../../assets/doodads/chicory_b.png';
import yarrowImageSource from '../../assets/doodads/yarrow_b.png';
import chamomileImageSource from '../../assets/doodads/chamomile_b.png';
import mintImageSource from '../../assets/doodads/mint_b.png';
import valerianImageSource from '../../assets/doodads/valerian_b.png';
import mugwortImageSource from '../../assets/doodads/mugwort_b.png';
import fennelImageSource from '../../assets/doodads/fennel_b.png';
import dillImageSource from '../../assets/doodads/dill_b.png';
import flaxImageSource from '../../assets/doodads/flax_b.png';
import wildGarlicImageSource from '../../assets/doodads/wild_garlic_b.png';
import siberianGinsengImageSource from '../../assets/doodads/siberian_ginseng_b.png';
import dogbaneImageSource from '../../assets/doodads/dogbane_b.png';
import bogCottonImageSource from '../../assets/doodads/bog_cotton_b.png';
import chanterelleImageSource from '../../assets/doodads/chanterelle_b.png';
import porciniImageSource from '../../assets/doodads/porcini_b.png';
import flyAgaricImageSource from '../../assets/doodads/fly_agaric_b.png';
import shaggyInkCapImageSource from '../../assets/doodads/shaggy_ink_cap_b.png';
import deadlyWebcapImageSource from '../../assets/doodads/deadly_webcap_b.png';
import destroyingAngelImageSource from '../../assets/doodads/destroying_angel_b.png';
import lingonberriesImageSource from '../../assets/doodads/lingonberries_b.png';
import cloudberriesImageSource from '../../assets/doodads/cloudberries_b.png';
import bilberriesImageSource from '../../assets/doodads/bilberries_b.png';
import wildStrawberriesImageSource from '../../assets/doodads/wild_strawberries_b.png';
import rowanBerriesImageSource from '../../assets/doodads/rowan_berries_b.png';
import cranberriesImageSource from '../../assets/doodads/cranberries_b.png';
import hazelnutsImageSource from '../../assets/doodads/hazelnuts_b.png';
import mandrakeImageSource from '../../assets/doodads/mandrake_b.png';
import belladonnaImageSource from '../../assets/doodads/belladonna_b.png';
import henbaneImageSource from '../../assets/doodads/henbane_b.png';
import daturaImageSource from '../../assets/doodads/datura_b.png';
import wolfsbaneImageSource from '../../assets/doodads/wolfsbane_b.png';
import sunflowersImageSource from '../../assets/doodads/sunflower_b.png';
import salsifyImageSource from '../../assets/doodads/salsify_b.png';

// TODO: Add proper images for all new plant types to assets/doodads/
// Currently using placeholders from existing images

// Default fallback image for missing specific plant images
const defaultPlantImageSource = beachLymeGrassImageSource; // Generic plant/grass image

// Resource type to image source mapping
export const RESOURCE_IMAGE_SOURCES: Record<HarvestableResourceType, string> = {
  // Existing plants (Hemp -> BorealNettle, Mushroom removed)
  Corn: cornImageSource,
  BorealNettle: borealNettleImageSource,
  Potato: potatoImageSource,
  Pumpkin: pumpkinImageSource,
  Reed: reedImageSource,
  BeachLymeGrass: beachLymeGrassImageSource,
  
  // Vegetables - TODO: Replace with proper vegetable images
  Wheat: defaultPlantImageSource, // Grain placeholder
  Carrots: defaultPlantImageSource, // Root vegetable placeholder
  Tomatoes: defaultPlantImageSource, // Round fruit placeholder
  Cabbage: defaultPlantImageSource, // TODO: Add cabbage.png
  Radish: defaultPlantImageSource, // Root vegetable placeholder
  Beets: defaultPlantImageSource, // Root vegetable placeholder
  Buckwheat: defaultPlantImageSource, // Grain placeholder
  Turnips: defaultPlantImageSource, // Root vegetable placeholder
  Onions: defaultPlantImageSource, // Root vegetable placeholder
  Garlic: defaultPlantImageSource, // Root vegetable placeholder
  Parsnips: defaultPlantImageSource, // Root vegetable placeholder
  Horseradish: defaultPlantImageSource, // Root vegetable placeholder
  
  // Herbs & Medicinal Plants - TODO: Replace with proper herb images
  Chicory: defaultPlantImageSource, // TODO: Add chicory.png
  Yarrow: defaultPlantImageSource, // TODO: Add yarrow.png
  Chamomile: defaultPlantImageSource, // TODO: Add chamomile.png
  Mint: defaultPlantImageSource, // TODO: Add mint.png
  Valerian: defaultPlantImageSource, // TODO: Add valerian.png
  Mugwort: defaultPlantImageSource, // TODO: Add mugwort.png
  Fennel: defaultPlantImageSource, // TODO: Add fennel.png
  Dill: defaultPlantImageSource, // TODO: Add dill.png
  Flax: defaultPlantImageSource, // Fiber plant placeholder
  WildGarlic: defaultPlantImageSource, // TODO: Add wild_garlic.png
  SiberianGinseng: defaultPlantImageSource, // Root medicine placeholder
  
  Dogbane: defaultPlantImageSource, // Fiber plant placeholder
  BogCotton: defaultPlantImageSource, // TODO: Add bog_cotton.png
  
  // Mushrooms - TODO: Replace with proper mushroom images
  Chanterelle: defaultPlantImageSource, // TODO: Add chanterelle.png
  Porcini: defaultPlantImageSource, // TODO: Add porcini.png
  FlyAgaric: defaultPlantImageSource, // TODO: Add fly_agaric.png
  ShaggylnkCap: defaultPlantImageSource, // TODO: Add shaggy_ink_cap.png
  DeadlyWebcap: defaultPlantImageSource, // TODO: Add deadly_webcap.png
  DestroyingAngel: defaultPlantImageSource, // TODO: Add destroying_angel.png
  
  // Berries & Nuts - TODO: Replace with proper berry/nut images
  Lingonberries: defaultPlantImageSource, // TODO: Add lingonberries.png
  Cloudberries: defaultPlantImageSource, // TODO: Add cloudberries.png
  Bilberries: defaultPlantImageSource, // TODO: Add bilberries.png
  WildStrawberries: defaultPlantImageSource, // TODO: Add wild_strawberries.png
  RowanBerries: defaultPlantImageSource, // TODO: Add rowan_berries.png
  Cranberries: defaultPlantImageSource, // TODO: Add cranberries.png
  Hazelnuts: defaultPlantImageSource, // TODO: Add hazelnuts.png
  
  // Toxic/Medicinal - TODO: Replace with proper toxic plant images
  Mandrake: defaultPlantImageSource, // TODO: Add mandrake.png
  Belladonna: defaultPlantImageSource, // TODO: Add belladonna.png
  Henbane: defaultPlantImageSource, // TODO: Add henbane.png
  Datura: defaultPlantImageSource, // TODO: Add datura.png
  Wolfsbane: defaultPlantImageSource, // TODO: Add wolfsbane.png
  
  // Other - TODO: Replace with proper images
  Sunflowers: defaultPlantImageSource, // TODO: Add sunflowers.png
  Salsify: defaultPlantImageSource // TODO: Add salsify.png
};

// Helper function to get image source for a resource type
export function getResourceImageSource(resourceType: HarvestableResourceType): string {
  return RESOURCE_IMAGE_SOURCES[resourceType];
}

// Helper function to get all available resource types (useful for debugging/admin)
export function getAllResourceTypes(): HarvestableResourceType[] {
  return Object.keys(RESOURCE_IMAGE_SOURCES) as HarvestableResourceType[];
}

// Helper function to check if a resource type has an image configured
export function hasResourceImage(resourceType: HarvestableResourceType): boolean {
  return resourceType in RESOURCE_IMAGE_SOURCES;
} 