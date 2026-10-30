import { seedFromId, seededRandom, TERRAIN_PALETTE } from './visualContract';
import type { PresentationEntity } from './presentationEntity';
import { STORAGE_MODELS } from './storageModels';
import { groundOffset } from './groundAnchor';
import { PLANT_PROFILES } from './plantCatalog';
import { WEAPON_MODELS } from './weaponModels';
import { TREE_PROFILES } from './treeModels';
import { ANIMAL_PROFILES } from './animals';
import { COASTAL_DROP_MODELS } from './droppedModels';

export type InspectionScene = 'world' | 'construction' | 'storage' | 'camp' | 'plants-crops' | 'plants-herbs' | 'plants-forage' | 'plants-piles' | 'equipment' | 'weapons-1' | 'weapons-2' | 'weapons-3' | 'weapons-4' | 'trees-1' | 'trees-2' | 'wildlife-1' | 'wildlife-2' | 'corpses-1' | 'corpses-2' | 'natural' | 'reef' | 'terrain' | 'shelters' | 'shore-drops' | 'villages-fishing' | 'villages-hunting' | 'villages-alpine' | 'villages-other' | 'weather-station';

const FIRST_WEAPONS = ['Stone Hatchet', 'Hunting Bow', 'Wooden Spear', 'Rifle', 'Torch'];
export const INSPECTION_WEAPONS = [...FIRST_WEAPONS, ...Object.keys(WEAPON_MODELS).filter(name => !FIRST_WEAPONS.includes(name))];

interface InspectionAnimal {
  species: { tag: string }; posX: number; posY: number; directionX: number; directionY: number;
  facingDirection: string; state: { tag: string }; spawnX: number; spawnY: number; isFlying: boolean; phase: number;
  lastAttackTime?: { microsSinceUnixEpoch: bigint };
}

/** Reproducible authored composition, never a replacement for server world state. */
export function createInspectionWorld(seed = 73021, scene: InspectionScene = 'world') {
  const random = seededRandom(seed);
  const tiles = new Map<string, PresentationEntity>();
  const trees = new Map<string, PresentationEntity>();
  const stones = new Map<string, PresentationEntity>();
  const plants = new Map<string, PresentationEntity>();
  for (let y = 0; y < 30; y++) for (let x = 0; x < 44; x++) {
    const river = 30 + Math.sin(y * 0.25) * 1.8;
    const type = x > river + 3 ? 'Sea' : x > river + 1 ? 'Beach'
      : y < 5 && x > 16 ? 'Alpine' : x < 7 ? 'Forest'
      : Math.abs(y - (15 + Math.sin(x * 0.17) * 2)) < 0.8 ? 'DirtRoad'
      : x > 24 ? 'TundraGrass' : 'Grass';
    tiles.set(`${x}_${y}`, { worldX: x, worldY: y, tileType: { tag: type }, variant: 0 });
    const clearing = Math.hypot((x - 20) * 1.05, y - 15) < 6.5;
    if (!clearing && !['Sea', 'Beach', 'DirtRoad'].includes(type) && random() < 0.16) {
      trees.set(`tree-${x}-${y}`, { posX: (x + random()) * 48, posY: (y + random()) * 48,
        treeType: { tag: type === 'Alpine' ? 'MountainHemlockSnow' : random() > 0.3 ? 'SitkaSpruce' : 'SiberianBirch' }, health: 100 });
    }
    if (!['Sea', 'DirtRoad'].includes(type) && random() < 0.055) {
      plants.set(`plant-${x}-${y}`, { posX: (x + random()) * 48, posY: (y + random()) * 48,
        plantType: { tag: random() > 0.5 ? 'Lingonberries' : 'BorealNettle' } });
    }
  }
  const id = { toHexString: () => 'inspection-survivor' };
  const players = new Map([['inspection-survivor', { identity: id, positionX: 20 * 48, positionY: 16.5 * 48,
    direction: 'down', isSprinting: false, isCrouching: false, isOnWater: false, isSnorkeling: false, isDead: false, isTorchLit: true,
    jumpStartTimeMs: 0n }]]);
  const activeEquipments = new Map([['inspection-survivor', { equippedItemDefId: 1n, swingStartTimeMs: 0n, loadedAmmoCount: 1, isReadyToFire: true }]]);
  for (const [i, x, y, type] of [[0, 16, 12, 'Stone'], [1, 26, 12, 'Metal'], [2, 27, 18, 'Sulfur']] as const) {
    stones.set(`stone-${i}`, { posX: x * 48, posY: y * 48, oreType: { tag: type }, health: 100 });
  }
  const wildAnimals = new Map<string, InspectionAnimal>();
  for (const [i, species, x, y] of [
    [0, 'CinderFox', 15, 19], [1, 'Caribou', 25, 10], [2, 'TundraWolf', 13, 11],
    [3, 'Hare', 24, 20], [4, 'Crow', 28, 14], [5, 'ArcticWalrus', 32, 19],
  ] as const) {
    wildAnimals.set(`animal-${i}`, { species: { tag: species }, posX: x * 48, posY: y * 48,
      directionX: 0, directionY: 1, facingDirection: 'down', state: { tag: 'Patrolling' },
      spawnX: x * 48, spawnY: y * 48, isFlying: species === 'Crow', phase: seedFromId(species) % 100 });
  }
  const world = {
    visibleWorldTiles: tiles, trees, stones, harvestableResources: plants, players, activeEquipments, wildAnimals,
    campfires: new Map([['campfire-0', { posX: 21.8 * 48, posY: 15.8 * 48, isBurning: true }]]),
    woodenStorageBoxes: new Map<string, PresentationEntity>([['crate-0', { posX: 18 * 48, posY: 14.1 * 48 }]]),
    barrels: new Map([['barrel-0', { posX: 18.1 * 48, posY: 12.8 * 48, variant: 0, health: 100 }]]),
    foundationCells: new Map<string, PresentationEntity>([['foundation-0', { cellX: 9, cellY: 6, tier: 1 }], ['foundation-1', { cellX: 10, cellY: 6, tier: 1 }]]),
    wallCells: new Map<string, PresentationEntity>([['wall-0', { cellX: 9, cellY: 6, tier: 1, edge: 0 }], ['wall-1', { cellX: 10, cellY: 6, tier: 1, edge: 0 }]]),
    doors: new Map<string, PresentationEntity>(), fences: new Map<string, PresentationEntity>(),
    furnaces: new Map<string, PresentationEntity>(), barbecues: new Map<string, PresentationEntity>(),
    lanterns: new Map<string, PresentationEntity>(), homesteadHearths: new Map<string, PresentationEntity>(),
    brothPots: new Map<string, PresentationEntity>(), sleepingBags: new Map<string, PresentationEntity>(),
    stashes: new Map<string, PresentationEntity>(), shelters: new Map<string, PresentationEntity>(),
    rainCollectors: new Map<string, PresentationEntity>(),
    runeStones: new Map<string, PresentationEntity>(), cairns: new Map<string, PresentationEntity>(),
    livingCorals: new Map<string, PresentationEntity>(), seaStacks: new Map<string, PresentationEntity>(),
    basaltColumns: new Map<string, PresentationEntity>(), fumaroles: new Map<string, PresentationEntity>(), roadLampposts: new Map<string, PresentationEntity>(),
    animalCorpses: new Map<string, PresentationEntity>(),
    monumentParts:new Map<string,PresentationEntity>(),droppedItems:new Map<string,PresentationEntity>(),
    resolvedBuildingClusters: new Map<string, { isEnclosed: boolean; cellCoords: Set<string> }>(),
    itemDefinitions: new Map(INSPECTION_WEAPONS.map((name, i) => [String(i + 1), { name }])),
    worldState: { cycleProgress: 0.43, currentWeather: { tag: 'Clear' }, rainIntensity: 0 },
    interpolatedGrass: new Map<string, {currentRenderPosX:number;currentRenderPosY:number;appearanceType:{tag:string}}>(),
    interpolatedClouds: new Map<string, {currentRenderPosX:number;currentRenderPosY:number;width:number;height:number;rotationDegrees:number;currentOpacity:number}>(),
    terrainPalette: TERRAIN_PALETTE,
  };
  const addGroundDetail = () => {
    for (const [id,tile] of tiles) {
      const kind=(tile.tileType as {tag:string}).tag, x=tile.worldX??0, y=tile.worldY??0;
      if (!['Grass','Forest','TundraGrass','Tundra','Alpine','Beach'].includes(kind) || (x*17+y*31+seed)%3 !== 0) continue;
      world.interpolatedGrass.set(id,{currentRenderPosX:(x+.35)*48,currentRenderPosY:(y+.6)*48,appearanceType:{tag:kind==='Alpine'?'AlpinePatchA':kind.startsWith('Tundra')?'TundraPatchA':kind==='Beach'?'BeachGrassA':'PatchA'}});
    }
    world.interpolatedClouds.set('inspection-cloud',{currentRenderPosX:20*48,currentRenderPosY:16*48,width:600,height:350,rotationDegrees:20,currentOpacity:.18});
  };
  const applyStoredAnchors = () => {
    // Coordinates above describe the desired ground composition. Encode the
    // legacy row anchors once, so inspection exercises the real adapter.
    for (const [kind, table] of Object.entries(world)) if (table instanceof Map) {
      for (const row of table.values() as Iterable<PresentationEntity>) {
        if (typeof row.posX !== 'number' || typeof row.posY !== 'number') continue;
        const offset = groundOffset(kind, row);
        row.posX -= offset.x; row.posY -= offset.y;
      }
    }
  };
  if (scene === 'world') { addGroundDetail(); applyStoredAnchors(); return world; }
  // The asset yard uses real row families and the production renderer. The
  // composition changes; no alternate mesh implementation exists in the lab.
  world.trees.clear(); world.stones.clear(); world.harvestableResources.clear(); world.wildAnimals.clear();
  world.campfires.clear(); world.woodenStorageBoxes.clear(); world.barrels.clear();
  world.foundationCells.clear(); world.wallCells.clear();
  for (const tile of world.visibleWorldTiles.values()) tile.tileType = { tag: 'Dirt' };
  if(scene==='shelters'){
    for(let i=0;i<4;i++)world.shelters.set(`shelter-${i}`,{posX:(13+i%2*14)*48,posY:(14+Math.floor(i/2)*6)*48,terrainVariant:i,placedBy:i===0?'inspection-survivor':'another-owner',health:1000});
    world.players.set('other-owner',{...world.players.get('inspection-survivor')!,identity:{toHexString:()=> 'other-owner'},positionX:27*48,positionY:14*48,direction:'down'});
  }else if(scene==='shore-drops'){
    for(const tile of world.visibleWorldTiles.values())tile.tileType={tag:'Beach'};
    COASTAL_DROP_MODELS.forEach((name,i)=>{world.itemDefinitions.set(String(200+i),{name});world.droppedItems.set(`drop-${i}`,{itemDefId:BigInt(200+i),quantity:3,posX:(13+i%4*5)*48,posY:(14+Math.floor(i/4)*5)*48});});
  }else if(scene.startsWith('villages-')||scene==='weather-station'){
    const assets:Record<string,string[]>={
      'villages-fishing':['fv_lodge.png','fv_hut2.png','fv_hut3.png','fv_drying_rack.png','fv_campfire.png'],
      'villages-hunting':['hv_lodge.png','hv_hut2.png','hv_hut3.png','hv_drying_rack.png','scarecrow.png','fv_campfire.png'],
      'villages-alpine':['av_lodge.png','av_hut.png','av_banya.png','av_drying_rack.png','av_weather_station_mast.png','av_campfire.png'],
      'villages-other':['wbg_hermit_hut.png','hs_shack.png','fv_dock.png','fv_kayak.png'],
      'weather-station':['ws_station.png','ws_radar.png','av_weather_station_mast.png'],
    };
    assets[scene].forEach((asset,i)=>{
      const count=scene==='villages-other'?2:3,col=i%count,row=Math.floor(i/count);
      world.monumentParts.set(`village-${i}`,{imagePath:asset,partType:asset.includes('campfire')?'campfire':asset.includes('drying_rack')?'drying_rack':asset==='scarecrow.png'?'scarecrow':'hut',monumentType:{tag:scene==='villages-hunting'?'HuntingVillage':scene==='villages-alpine'?'AlpineVillage':'FishingVillage'},worldX:(count===2?13+col*14:10+col*10)*48,worldY:(17+row*8)*48,rotationRad:0,collisionRadius:0});
    });
    for(const tile of world.visibleWorldTiles.values())tile.tileType={tag:scene==='villages-alpine'||scene==='weather-station'?'Alpine':scene==='villages-fishing'?'Beach':'Grass'};
  }else if (scene === 'terrain') {
    const kinds = Object.keys(TERRAIN_PALETTE);
    for (const tile of world.visibleWorldTiles.values()) {
      const column = Math.max(0, Math.min(2, Math.floor(((tile.worldX ?? 0) - 9) / 7)));
      const row = Math.max(0, Math.min(4, Math.floor(((tile.worldY ?? 0) - 8) / 4)));
      tile.tileType = { tag: kinds[row * 3 + column] ?? 'Grass' };
    }
    addGroundDetail();
  } else if (scene.startsWith('trees-')) {
    Object.keys(TREE_PROFILES).slice((Number(scene.slice(-1)) - 1) * 8, Number(scene.slice(-1)) * 8).forEach((type, i) => {
      world.trees.set(`tree-${type}`, { treeType: { tag: type }, posX: (11 + i % 4 * 6) * 48, posY: (14 + Math.floor(i / 4) * 8) * 48, health: 100 });
    });
  } else if (scene.startsWith('wildlife-') || scene.startsWith('corpses-')) {
    Object.keys(ANIMAL_PROFILES).slice((Number(scene.slice(-1)) - 1) * 10, Number(scene.slice(-1)) * 10).forEach((species, i) => {
      const x = (12 + i % 5 * 4) * 48, y = (13 + Math.floor(i / 5) * 5) * 48;
      if (scene.startsWith('corpses-')) world.animalCorpses.set(String(100 + i), { posX: x, posY: y, animalSpecies: { tag: species }, animalId: BigInt(100 + i), deathTime: { microsSinceUnixEpoch: 0n }, health: 75 });
      else world.wildAnimals.set(`wildlife-${species}`, { posX: x, posY: y, species: { tag: species }, spawnX: x, spawnY: y, directionX: 1, directionY: 0, facingDirection: 'right', state: { tag: 'Patrolling' }, isFlying: false, phase: i * .7 });
    });
  } else if (scene === 'natural') {
    ['Green', 'Red', 'Blue'].forEach((type, i) => world.runeStones.set(`rune-${i}`, { posX: (13 + i * 5) * 48, posY: 13 * 48, runeType: { tag: type } }));
    ['beach', 'tundra', 'alpine'].forEach((type, i) => world.cairns.set(`cairn-${i}`, { posX: (13 + i * 4) * 48, posY: 18 * 48, loreId: type }));
    world.basaltColumns.set('column', { posX: 26 * 48, posY: 18 * 48, columnType: { tag: 'Type2' } });
    world.fumaroles.set('vent', { posX: 29 * 48, posY: 13 * 48 });
    world.roadLampposts.set('lamp', { posX: 29 * 48, posY: 21 * 48 });
  } else if (scene === 'reef') {
    for (const tile of world.visibleWorldTiles.values()) tile.tileType = { tag: (tile.worldX ?? 0) > 23 ? 'DeepSea' : 'Sea' };
    for (let i = 0; i < 4; i++) world.livingCorals.set(String(i), { posX: (13 + i * 4.5) * 48, posY: 13 * 48, health: 100, respawnAt: { microsSinceUnixEpoch: 0n } });
    for (let i = 0; i < 5; i++) world.harvestableResources.set(`kelp-${i}`, { plantType: { tag: 'Seaweed' }, posX: (12 + i * 4) * 48, posY: 18 * 48 });
    world.barrels.set('buoy-0', { posX: 24 * 48, posY: 18.5 * 48, variant: 6, health: 100 });
    world.fumaroles.set('reef-vent', { posX: 18 * 48, posY: 16 * 48, isSubmerged: true });
    players.get('inspection-survivor')!.isOnWater = true;
    world.seaStacks.set('stack', { posX: 30 * 48, posY: 21 * 48, variant: { tag: 'Tall' } as unknown as number, scale: .7 });
  } else if (scene === 'equipment') {
    applyStoredAnchors(); return world;
  } else if (scene.startsWith('weapons-')) {
    const page = Number(scene.slice(-1)) - 1;
    Object.keys(WEAPON_MODELS).slice(page * 15, (page + 1) * 15).forEach((name, index) => {
      const id = `weapon-holder-${index}`, definition = BigInt(100 + index);
      world.players.set(id, { ...players.get('inspection-survivor')!, identity: { toHexString: () => id },
        positionX: (13 + index % 5 * 3.5) * 48, positionY: (11.8 + Math.floor(index / 5) * 3.1) * 48, direction: 'down' });
      world.activeEquipments.set(id, { equippedItemDefId: definition, swingStartTimeMs: 0n, loadedAmmoCount: 1, isReadyToFire: true });
      world.itemDefinitions.set(String(definition), { name });
    });
  } else if (scene.startsWith('plants-')) {
    const page = ['plants-crops', 'plants-herbs', 'plants-forage', 'plants-piles'].indexOf(scene);
    Object.keys(PLANT_PROFILES).slice(page * 18, (page + 1) * 18).forEach((type, index) => {
      world.harvestableResources.set(`plant-${type}`, {
        posX: (13 + index % 5 * 3.5) * 48, posY: (11.8 + Math.floor(index / 5) * 2.8) * 48,
        plantType: { tag: type }, respawnAt: { microsSinceUnixEpoch: 0n },
      });
    });
  } else if (scene === 'storage') {
    STORAGE_MODELS.forEach((name, type) => world.woodenStorageBoxes.set(`storage-${type}`, {
      posX: (13 + type % 5 * 3.5) * 48, posY: (11.6 + Math.floor(type / 5) * 2.65) * 48, boxType: type, name,
    }));
  } else if (scene === 'camp') {
    world.furnaces.set('kiln', { posX: 13 * 48, posY: 12 * 48, furnaceType: 0, isBurning: true });
    world.furnaces.set('blast', { posX: 17 * 48, posY: 12 * 48, furnaceType: 1, isBurning: true });
    world.barbecues.set('grill', { posX: 21 * 48, posY: 12 * 48, isBurning: true });
    world.homesteadHearths.set('hearth', { posX: 26 * 48, posY: 12 * 48 });
    for (let i = 0; i < 4; i++) world.lanterns.set(`lantern-${i}`, { posX: (14 + i * 4) * 48, posY: 16 * 48, lanternType: i, isBurning: true });
    world.brothPots.set('pot', { posX: 13 * 48, posY: 20 * 48, waterLevelMl: 3800, maxWaterCapacityMl: 5000 });
    world.sleepingBags.set('bedroll', { posX: 17 * 48, posY: 20 * 48 });
    world.stashes.set('stash', { posX: 21 * 48, posY: 20 * 48 });
    world.rainCollectors.set('collector', { posX: 25 * 48, posY: 20 * 48 });
    world.shelters.set('tent', { posX: 29 * 48, posY: 17.5 * 48, terrainVariant: 0 });
  } else {
    for (let tier = 0; tier < 4; tier++) {
      const x = 6 + tier * 2;
      for (const y of [5, 6]) world.foundationCells.set(`foundation-${tier}-${y}`, { cellX: x, cellY: y, tier, shape: 1 });
      world.wallCells.set(`north-${tier}`, { cellX: x, cellY: 5, edge: 0, tier });
      world.wallCells.set(`west-${tier}`, { cellX: x, cellY: 5, edge: 3, tier });
      world.wallCells.set(`east-${tier}`, { cellX: x, cellY: 5, edge: 1, tier });
      world.wallCells.set(`west-bottom-${tier}`, { cellX: x, cellY: 6, edge: 3, tier });
      world.wallCells.set(`east-bottom-${tier}`, { cellX: x, cellY: 6, edge: 1, tier });
      world.doors.set(`door-${tier}`, { cellX: x, cellY: 6, edge: 2, doorType: tier >= 2 ? 1 : 0, isOpen: false,
        posX: (x + 0.5) * 96, posY: 7 * 96 });
      world.resolvedBuildingClusters.set(`building-${tier}`, { isEnclosed: true, cellCoords: new Set([`${x},5`, `${x},6`]) });
      world.sleepingBags.set(`bed-${tier}`, { posX: (x + 0.5) * 96, posY: 5.65 * 96 });
      for (let shape = 2; shape <= 5; shape++) world.foundationCells.set(`triangle-${tier}-${shape}`, {
        cellX: x + (shape - 2) % 2, cellY: 7 + Math.floor((shape - 2) / 2), shape, tier,
      });
      world.fences.set(`fence-${tier}`, { cellX: x, cellY: 9, edge: 2, tier: Math.max(1, tier), posX: (x + 0.5) * 96, posY: 10 * 96 });
    }
  }
  applyStoredAnchors();
  return world;
}
