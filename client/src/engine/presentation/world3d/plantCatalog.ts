/** Authoritative PlantType names. Dimensions are scene units (one unit = 48px).
 * Presets own the silhouette; seeds vary growth within that identity. */
export interface PlantProfile {
  form: 'herb' | 'rosette' | 'grass' | 'berry' | 'mushroom' | 'vine' | 'sapling' | 'pile' | 'shard' | 'seaweed';
  height: number;
  spread: number;
  shoots: number;
  leaf: number;
  green: number;
  accent: number;
  detail: string;
}

export const PLANT_PROFILES = {
  BorealNettle: { form: 'herb', height: 1.08, spread: .45, shoots: 4, leaf: .28, green: 0x56734b, accent: 0xa6b67a, detail: 'opposite-serrated' },
  Potato: { form: 'herb', height: .55, spread: .58, shoots: 4, leaf: .3, green: 0x667a43, accent: 0xc4a5c8, detail: 'compound-tuber' },
  Pumpkin: { form: 'vine', height: .44, spread: .85, shoots: 4, leaf: .43, green: 0x657340, accent: 0xcb8238, detail: 'ribbed-gourd' },
  Reed: { form: 'grass', height: 1.65, spread: .4, shoots: 8, leaf: .07, green: 0x7a8857, accent: 0x9b7953, detail: 'plume' },
  BeachLymeGrass: { form: 'grass', height: .85, spread: .55, shoots: 13, leaf: .045, green: 0x819481, accent: 0xc4b784, detail: 'wheat-spike' },
  Carrot: { form: 'rosette', height: .54, spread: .4, shoots: 7, leaf: .03, green: 0x687c47, accent: 0xb7773d, detail: 'feather-root' },
  Beets: { form: 'rosette', height: .52, spread: .45, shoots: 6, leaf: .24, green: 0x63734c, accent: 0x8b4254, detail: 'red-stalk-root' },
  Horseradish: { form: 'rosette', height: .73, spread: .52, shoots: 8, leaf: .2, green: 0x718747, accent: 0xc9ba86, detail: 'long-root' },
  Corn: { form: 'grass', height: 1.85, spread: .57, shoots: 3, leaf: .19, green: 0x70804c, accent: 0xc8aa57, detail: 'cobs-tassel' },
  Cabbage: { form: 'rosette', height: .4, spread: .49, shoots: 9, leaf: .4, green: 0x8c9b6b, accent: 0xb1bd88, detail: 'folded-head' },
  Fennel: { form: 'herb', height: 1.02, spread: .46, shoots: 3, leaf: .025, green: 0x82926a, accent: 0xd7c66c, detail: 'feather-umbel-bulb' },
  KamchatkaLily: { form: 'herb', height: .84, spread: .32, shoots: 2, leaf: .12, green: 0x6d814e, accent: 0x604453, detail: 'whorl-bells' },
  WildCelery: { form: 'herb', height: 1.15, spread: .58, shoots: 3, leaf: .18, green: 0x698258, accent: 0xd5d4ae, detail: 'broad-umbel' },
  Silverweed: { form: 'rosette', height: .24, spread: .57, shoots: 6, leaf: .06, green: 0x91a08a, accent: 0xd9b74e, detail: 'silver-pinnate' },
  Nagoonberry: { form: 'berry', height: .36, spread: .44, shoots: 4, leaf: .2, green: 0x6c8455, accent: 0x9d4658, detail: 'raspberry' },
  AlpineBistort: { form: 'herb', height: .61, spread: .27, shoots: 3, leaf: .1, green: 0x7c895e, accent: 0xd7c1b5, detail: 'white-spike' },
  Chicory: { form: 'herb', height: .91, spread: .44, shoots: 4, leaf: .12, green: 0x657b58, accent: 0x8b9cc3, detail: 'blue-rays' },
  Yarrow: { form: 'herb', height: .73, spread: .4, shoots: 5, leaf: .025, green: 0x82927a, accent: 0xd6d4bd, detail: 'flat-umbel' },
  Chamomile: { form: 'herb', height: .54, spread: .48, shoots: 7, leaf: .025, green: 0x7b8d54, accent: 0xe4dfc0, detail: 'daisy' },
  Mint: { form: 'herb', height: .66, spread: .39, shoots: 5, leaf: .18, green: 0x648568, accent: 0xb4a1b8, detail: 'opposite-spike' },
  Valerian: { form: 'herb', height: 1.06, spread: .52, shoots: 3, leaf: .065, green: 0x758057, accent: 0xd8b9be, detail: 'pinnate-umbel' },
  Mugwort: { form: 'herb', height: .89, spread: .48, shoots: 4, leaf: .065, green: 0x8e9983, accent: 0xa99b70, detail: 'silver-branches' },
  BearGarlic: { form: 'rosette', height: .5, spread: .34, shoots: 5, leaf: .18, green: 0x71945c, accent: 0xe2dcc3, detail: 'white-star-bulb' },
  SiberianGinseng: { form: 'berry', height: .9, spread: .57, shoots: 3, leaf: .14, green: 0x687d4b, accent: 0x3e4450, detail: 'palmate-black-cluster' },
  Dogbane: { form: 'herb', height: 1.12, spread: .46, shoots: 3, leaf: .19, green: 0x718575, accent: 0xd0adb5, detail: 'paired-pods' },
  BogCotton: { form: 'grass', height: .88, spread: .42, shoots: 7, leaf: .035, green: 0x8b925f, accent: 0xe7e1c8, detail: 'cotton-tuft' },
  Flax: { form: 'herb', height: .91, spread: .33, shoots: 8, leaf: .035, green: 0x7c947d, accent: 0x899dc9, detail: 'blue-five-petal' },
  Salsify: { form: 'grass', height: .82, spread: .32, shoots: 5, leaf: .06, green: 0x7f9477, accent: 0xb294c2, detail: 'purple-star' },
  ScurvyGrass: { form: 'rosette', height: .29, spread: .32, shoots: 7, leaf: .16, green: 0x8a9b66, accent: 0xdfdbc0, detail: 'round-white-cross' },
  Crowberry: { form: 'berry', height: .24, spread: .65, shoots: 6, leaf: .04, green: 0x647663, accent: 0x373c4c, detail: 'needle-mat' },
  SeaPlantain: { form: 'rosette', height: .34, spread: .37, shoots: 12, leaf: .045, green: 0x86977b, accent: 0xb9a16b, detail: 'narrow-spikes' },
  Glasswort: { form: 'herb', height: .47, spread: .33, shoots: 5, leaf: .06, green: 0x8b9a6b, accent: 0xb16c5d, detail: 'jointed-succulent' },
  Fireweed: { form: 'herb', height: 1.39, spread: .38, shoots: 3, leaf: .09, green: 0x73815f, accent: 0xba699a, detail: 'pink-spire' },
  ArcticPoppy: { form: 'rosette', height: .53, spread: .33, shoots: 4, leaf: .09, green: 0x8b9676, accent: 0xe3bd55, detail: 'poppy-cup' },
  Chanterelle: { form: 'mushroom', height: .36, spread: .43, shoots: 5, leaf: .24, green: 0xa97d39, accent: 0xd1a34e, detail: 'funnel' },
  Porcini: { form: 'mushroom', height: .43, spread: .42, shoots: 3, leaf: .35, green: 0xc9b997, accent: 0x8c6445, detail: 'broad-bun' },
  FlyAgaric: { form: 'mushroom', height: .48, spread: .42, shoots: 3, leaf: .37, green: 0xdbd3b9, accent: 0xb95847, detail: 'spotted-cap' },
  ShaggyInkCap: { form: 'mushroom', height: .62, spread: .29, shoots: 4, leaf: .19, green: 0xc9c7b1, accent: 0xddd8c3, detail: 'shaggy-bell' },
  DeadlyWebcap: { form: 'mushroom', height: .38, spread: .38, shoots: 5, leaf: .24, green: 0xa78556, accent: 0x9c603f, detail: 'pointed-rust' },
  DestroyingAngel: { form: 'mushroom', height: .57, spread: .34, shoots: 3, leaf: .29, green: 0xd5d6c3, accent: 0xe8e4d2, detail: 'white-skirt' },
  Lingonberries: { form: 'berry', height: .38, spread: .49, shoots: 5, leaf: .11, green: 0x667c52, accent: 0xb7524c, detail: 'red-terminal-cluster' },
  Cloudberries: { form: 'berry', height: .27, spread: .42, shoots: 4, leaf: .24, green: 0x7d8a50, accent: 0xd8a258, detail: 'amber-compound' },
  Bilberries: { form: 'berry', height: .54, spread: .48, shoots: 5, leaf: .1, green: 0x6f8b66, accent: 0x606f9d, detail: 'blue-drooping' },
  WildStrawberries: { form: 'berry', height: .19, spread: .48, shoots: 5, leaf: .15, green: 0x71824b, accent: 0xb55246, detail: 'trifoliate-red' },
  RowanBerries: { form: 'berry', height: 1.02, spread: .65, shoots: 3, leaf: .065, green: 0x7c8757, accent: 0xc77945, detail: 'rowan-pinnate' },
  Cranberries: { form: 'berry', height: .21, spread: .64, shoots: 6, leaf: .06, green: 0x78825a, accent: 0xa64c59, detail: 'trailing-red' },
  Mandrake: { form: 'rosette', height: .26, spread: .51, shoots: 8, leaf: .23, green: 0x697a51, accent: 0xc5a355, detail: 'wrinkled-apple' },
  Belladonna: { form: 'herb', height: .86, spread: .54, shoots: 3, leaf: .24, green: 0x68784e, accent: 0x3f354d, detail: 'black-berry-bells' },
  Henbane: { form: 'herb', height: .64, spread: .46, shoots: 4, leaf: .21, green: 0x939977, accent: 0xc9bb7f, detail: 'purple-throat' },
  Datura: { form: 'herb', height: .82, spread: .56, shoots: 3, leaf: .26, green: 0x73845c, accent: 0xd9d4bd, detail: 'trumpet-pods' },
  Wolfsbane: { form: 'herb', height: 1.1, spread: .38, shoots: 3, leaf: .1, green: 0x667b5a, accent: 0x7a729f, detail: 'hooded-spire' },
  Sunflowers: { form: 'herb', height: 1.68, spread: .54, shoots: 2, leaf: .32, green: 0x76834d, accent: 0xd7ab49, detail: 'sunflower-disc' },
  MemoryShard: { form: 'shard', height: .36, spread: .35, shoots: 3, leaf: .12, green: 0x596f7a, accent: 0x8ac4cf, detail: 'fractured-archive' },
  SeaweedBed: { form: 'seaweed', height: .71, spread: .68, shoots: 8, leaf: .16, green: 0x637c57, accent: 0x9a9c5b, detail: 'forked-fronds' },
  WoodPile: { form: 'pile', height: .28, spread: .52, shoots: 7, leaf: .1, green: 0x776045, accent: 0xaa8960, detail: 'split-logs' },
  BeachWoodPile: { form: 'pile', height: .2, spread: .69, shoots: 5, leaf: .08, green: 0x9d9b81, accent: 0xc7bfa1, detail: 'driftwood' },
  StonePile: { form: 'pile', height: .25, spread: .45, shoots: 8, leaf: .16, green: 0x8d9690, accent: 0xb6baaa, detail: 'pebbles' },
  LeavesPile: { form: 'pile', height: .18, spread: .62, shoots: 18, leaf: .17, green: 0x8b8051, accent: 0xb8995a, detail: 'dry-leaves' },
  MetalOrePile: { form: 'pile', height: .31, spread: .45, shoots: 7, leaf: .15, green: 0x6c7374, accent: 0xb29473, detail: 'ore-veins' },
  SulfurPile: { form: 'pile', height: .23, spread: .48, shoots: 8, leaf: .12, green: 0xaaa272, accent: 0xd0bc59, detail: 'sulfur-crystals' },
  CharcoalPile: { form: 'pile', height: .18, spread: .5, shoots: 10, leaf: .11, green: 0x414948, accent: 0x66685b, detail: 'charred-splinters' },
  SoggyPlantFiberPile: { form: 'pile', height: .12, spread: .7, shoots: 19, leaf: .025, green: 0x777a53, accent: 0x96936a, detail: 'wet-fibers' },
  BonePile: { form: 'pile', height: .29, spread: .56, shoots: 7, leaf: .07, green: 0xc5bda2, accent: 0xe3d6b5, detail: 'bone-fragments' },
  ConiferSapling: { form: 'sapling', height: 1.19, spread: .4, shoots: 4, leaf: .12, green: 0x506f54, accent: 0x7d9167, detail: 'needle-whorls' },
  DeciduousSapling: { form: 'sapling', height: 1.07, spread: .43, shoots: 5, leaf: .12, green: 0x92a16d, accent: 0xc7c3a7, detail: 'white-birch' },
  CrabAppleSapling: { form: 'sapling', height: .92, spread: .48, shoots: 5, leaf: .17, green: 0x7d9054, accent: 0xb47a5c, detail: 'apple-ovate' },
  HazelnutSapling: { form: 'sapling', height: .81, spread: .57, shoots: 6, leaf: .23, green: 0x899b63, accent: 0xaf9560, detail: 'hazel-multistem' },
  RowanberrySapling: { form: 'sapling', height: 1.12, spread: .48, shoots: 4, leaf: .06, green: 0x7b8e5b, accent: 0xb1a06a, detail: 'pinnate-rowan' },
  OliveSapling: { form: 'sapling', height: .94, spread: .4, shoots: 5, leaf: .055, green: 0x91a18b, accent: 0xb8bd9c, detail: 'silver-lanceolate' },
} as const satisfies Record<string, PlantProfile>;

export type PlantSpecies = keyof typeof PLANT_PROFILES;
