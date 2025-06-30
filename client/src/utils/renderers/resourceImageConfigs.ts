// Resource Image Configuration
// Centralized location for all resource image imports and mappings

import type { HarvestableResourceType } from '../../types/resourceTypes';

// Import existing resource images
import cornImageSource from '../../assets/doodads/corn_stalk_b.png';
import borealNettleImageSource from '../../assets/doodads/hemp_c.png'; // Reusing hemp image for BorealNettle
import potatoImageSource from '../../assets/doodads/potato_b.png';
import pumpkinImageSource from '../../assets/doodads/pumpkin_b.png';
import reedImageSource from '../../assets/doodads/reed_stalk_b.png';
import beachLymeGrassImageSource from '../../assets/doodads/beach_lyme_grass_b.png';
import wheatImageSource from '../../assets/doodads/wheat.png';
import carrotImageSource from '../../assets/doodads/carrot.png';
import tomatoeImageSource from '../../assets/doodads/tomato.png';
import cabbageImageSource from '../../assets/doodads/cabbage.png';
import radishImageSource from '../../assets/doodads/radish.png';
import beetsImageSource from '../../assets/doodads/beet.png';
import buckwheatImageSource from '../../assets/doodads/buckwheat.png';
import turnipImageSource from '../../assets/doodads/turnip.png';
import onionImageSource from '../../assets/doodads/onion.png';
import garlicImageSource from '../../assets/doodads/garlic.png';
import parsnipImageSource from '../../assets/doodads/parsnip.png';
import horseradishImageSource from '../../assets/doodads/horseradish.png';
import chicoryImageSource from '../../assets/doodads/chicory.png';
import yarrowImageSource from '../../assets/doodads/yarrow.png';
import chamomileImageSource from '../../assets/doodads/chamomile.png';
import mintImageSource from '../../assets/doodads/mint.png';
import valerianImageSource from '../../assets/doodads/valerian.png';
import mugwortImageSource from '../../assets/doodads/mugwort.png';
import fennelImageSource from '../../assets/doodads/fennel.png';
import dillImageSource from '../../assets/doodads/dill.png';
import flaxImageSource from '../../assets/doodads/flax.png';
import wildGarlicImageSource from '../../assets/doodads/wild_garlic.png';
import siberianGinsengImageSource from '../../assets/doodads/siberian_ginseng.png';
import dogbaneImageSource from '../../assets/doodads/dogbane.png';
import bogCottonImageSource from '../../assets/doodads/bog_cotton.png';
import chanterelleImageSource from '../../assets/doodads/chanterelle.png';
import porciniImageSource from '../../assets/doodads/porcini.png';
import flyAgaricImageSource from '../../assets/doodads/fly_agaric.png';
import shaggyInkCapImageSource from '../../assets/doodads/shaggy_ink_cap.png';
import deadlyWebcapImageSource from '../../assets/doodads/deadly_webcap.png';
import destroyingAngelImageSource from '../../assets/doodads/destroying_angel.png';
import lingonberriesImageSource from '../../assets/doodads/lingonberries.png';
import cloudberriesImageSource from '../../assets/doodads/cloudberries.png';
import bilberriesImageSource from '../../assets/doodads/bilberries.png';
import wildStrawberriesImageSource from '../../assets/doodads/wild_strawberries.png';
import rowanBerriesImageSource from '../../assets/doodads/rowan_berries.png';
import cranberriesImageSource from '../../assets/doodads/cranberries.png';
import hazelnutsImageSource from '../../assets/doodads/hazelnuts.png';
import mandrakeImageSource from '../../assets/doodads/mandrake.png';
import belladonnaImageSource from '../../assets/doodads/belladonna.png';
import henbaneImageSource from '../../assets/doodads/henbane.png';
import daturaImageSource from '../../assets/doodads/datura.png';
import wolfsbaneImageSource from '../../assets/doodads/wolfsbane.png';
import sunflowersImageSource from '../../assets/doodads/sunflower.png';
import salsifyImageSource from '../../assets/doodads/salsify.png';

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
  Wheat: wheatImageSource, // Grain placeholder
  Carrot: carrotImageSource, // Root vegetable placeholder
  Tomato: defaultPlantImageSource, // Round fruit placeholder
  Cabbage: defaultPlantImageSource, // TODO: Add cabbage.png
  Radish: defaultPlantImageSource, // Root vegetable placeholder
  Beets: defaultPlantImageSource, // Root vegetable placeholder
  Buckwheat: defaultPlantImageSource, // Grain placeholder
  Turnip: defaultPlantImageSource, // Root vegetable placeholder
  Onion: defaultPlantImageSource, // Root vegetable placeholder
  Garlic: defaultPlantImageSource, // Root vegetable placeholder
  Parsnip: defaultPlantImageSource, // Root vegetable placeholder
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
  BearGarlic: defaultPlantImageSource, // TODO: Add wild_garlic.png
  SiberianGinseng: defaultPlantImageSource, // Root medicine placeholder
  Dogbane: defaultPlantImageSource, // Fiber plant placeholder
  BogCotton: defaultPlantImageSource, // TODO: Add bog_cotton.png
  
  // Mushrooms - TODO: Replace with proper mushroom images
  Chanterelle: defaultPlantImageSource, // TODO: Add chanterelle.png
  Porcini: defaultPlantImageSource, // TODO: Add porcini.png
  FlyAgaric: defaultPlantImageSource, // TODO: Add fly_agaric.png
  ShaggyInkCap: defaultPlantImageSource, // TODO: Add shaggy_ink_cap.png
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