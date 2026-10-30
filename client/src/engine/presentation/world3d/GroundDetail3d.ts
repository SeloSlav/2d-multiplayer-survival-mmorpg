import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedMesh, MeshStandardNodeMaterial, Object3D } from 'three/webgpu';
import { attribute, positionLocal, sin, uniform, vec3 } from 'three/tsl';
import { GROUND_Y_SCALE, seedFromId, seededRandom, WORLD_3D, worldToScene } from './visualContract';
import type { TerrainTile } from './terrainField';
import { GRASS_SWAY_BY_WEATHER, BEACH_GRASS_SPEED_BY_WEATHER, DEFAULT_GRASS_SWAY, DEFAULT_BEACH_GRASS_SPEED } from '../grassWindWeather';

interface Grass { currentRenderPosX: number; currentRenderPosY: number; appearanceType?: {tag?: string}; chunkIndex?: number; swaySpeed?: number; swayOffsetSeed?: number }
const LIMIT = 16000;
// Match the existing 2D vegetation: crimson tundra, green alpine and bright coastal grass.
const PALETTES: Record<string, number> = { Grass: 0x8abf58, Forest: 0x6b9d4d, TundraGrass: 0xc74846, Tundra: 0xc74846, Alpine: 0x57ad76, Beach: 0x9dcc51, Sand: 0x9dcc51 };
const SCATTER: Record<string, { density: number; color: number; twig: boolean }> = {
  Grass:{density:.28,color:0x92896a,twig:false}, Forest:{density:.55,color:0x70654c,twig:true}, Dirt:{density:.4,color:0x897560,twig:false},
  DirtRoad:{density:.16,color:0x8e806b,twig:false}, Tundra:{density:.42,color:0x999b8b,twig:false}, TundraGrass:{density:.35,color:0x8e8a70,twig:false},
  Alpine:{density:.5,color:0x9da69c,twig:false}, Beach:{density:.38,color:0xaaa18a,twig:false}, Sand:{density:.22,color:0xb8ab8e,twig:false}, Quarry:{density:.6,color:0x777b73,twig:false},
};
function kind(tile: TerrainTile): string { return typeof tile.tileType === 'string' ? tile.tileType : (tile.tileType as {tag?:string})?.tag ?? ''; }
export function scatterForTile(x: number, y: number, terrain: string) {
  const profile = SCATTER[terrain]; if (!profile) return null;
  const random = seededRandom(seedFromId(`scatter:${x}:${y}`));
  if (random() >= profile.density) return null;
  const px=x + .12 + random() * .76, py=y + .12 + random() * .76, scale=.55 + random() * .75, rotation=random() * Math.PI * 2;
  const type=profile.twig && random() < .48 ? 'twig' : terrain === 'Beach' && random() < .45 ? 'shell' : 'rock';
  return { x:px, y:py, scale, rotation, color:type === 'shell' ? 0xd3cbb3 : profile.color, type };
}
function grassGeometry(): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399, x = Math.cos(angle) * .09, z = Math.sin(angle) * .09, dx = Math.cos(angle + 1.2) * .035, dz = Math.sin(angle + 1.2) * .035;
    const n = positions.length / 3;
    positions.push(x-dx,0,z-dz, x+dx,0,z+dz, x+dx*.45,.25,z+dz*.45, x-dx*.45,.25,z-dz*.45, x+Math.cos(angle)*.12,.42,z+Math.sin(angle)*.12);
    colors.push(.8,.8,.8, .8,.8,.8, .94,.94,.94, .94,.94,.94, 1,1,1);
    indices.push(n,n+1,n+2,n,n+2,n+3,n+3,n+2,n+4);
  }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(positions,3)); g.setAttribute('color',new Float32BufferAttribute(colors,3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
/** Broad, overlapping curved blades provide real depth-tested visual cover. */
function tallGrassGeometry(): BufferGeometry {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], normals: number[] = [];
  const random = seededRandom(seedFromId('tall-grass-geometry'));
  for (let i = 0; i < 36; i++) {
    const angle = i * 2.399, rootRadius = Math.sqrt(random()) * .48;
    const rootX = Math.cos(angle) * rootRadius, rootZ = Math.sin(angle) * rootRadius;
    const bladeAngle = angle + (random() - .5) * 1.3, cx = Math.cos(bladeAngle), cz = Math.sin(bladeAngle);
    const height = 1.8 + random() * .75, width = .13 + random() * .09, lean = .5 + random() * .5;
    const shade = .86 + random() * .14, start = positions.length / 3;
    for (let s = 0; s <= 4; s++) {
      const t = s / 4, bend = lean * t * t, halfWidth = width * (1 - t * .92);
      for (const side of [-1, 1]) {
        positions.push(rootX + cx * bend - cz * halfWidth * side, height * t, rootZ + cz * bend + cx * halfWidth * side);
        const light = shade * (.82 + .18 * t); colors.push(light, light, light);
        normals.push(cx * .91, .42, cz * .91);
      }
      if (s < 4) { const n = start + s * 2; indices.push(n,n+1,n+2,n+1,n+3,n+2); }
    }
  }
  const g = new BufferGeometry(); g.setAttribute('position',new Float32BufferAttribute(positions,3));
  g.setAttribute('color',new Float32BufferAttribute(colors,3)); g.setAttribute('normal',new Float32BufferAttribute(normals,3)); g.setIndex(indices); return g;
}
/** Terrain-anchored detail. Grass is authoritative; decorative scatter is deterministic. */
export class GroundDetail3d {
  readonly root = new Group();
  private readonly clock = uniform(0);
  private readonly wind = uniform(1);
  private readonly grassGeometry = grassGeometry();
  private readonly tallGrassGeometry = tallGrassGeometry();
  private readonly grassWind = new InstancedBufferAttribute(new Float32Array(LIMIT * 3), 3);
  private readonly tallGrassWind = new InstancedBufferAttribute(new Float32Array(LIMIT * 3), 3);
  private readonly grassMaterial = new MeshStandardNodeMaterial({color:0xffffff, vertexColors:true, side:DoubleSide, roughness:1});
  private readonly grass = new InstancedMesh(this.grassGeometry,this.grassMaterial,LIMIT);
  private readonly tallGrass = new InstancedMesh(this.tallGrassGeometry,this.grassMaterial,LIMIT);
  private readonly rockGeometry = new IcosahedronGeometry(1,0);
  private readonly twigGeometry = new CylinderGeometry(.025,.035,1,5);
  private readonly shellGeometry = new ConeGeometry(1,1,6);
  private readonly scatterMaterial = new MeshStandardNodeMaterial({color:0xffffff,roughness:1,flatShading:true});
  private readonly rocks = new InstancedMesh(this.rockGeometry,this.scatterMaterial,LIMIT);
  private readonly bushes = new InstancedMesh(this.rockGeometry,this.scatterMaterial,LIMIT);
  private readonly twigs = new InstancedMesh(this.twigGeometry,this.scatterMaterial,LIMIT);
  private readonly shells = new InstancedMesh(this.shellGeometry,this.scatterMaterial,LIMIT);
  private readonly helper = new Object3D();
  private readonly color = new Color();
  private grassSignature: string | null = null;
  private grassPhases = new Map<string, { frequency: number; phase: number; seed: number }>();
  constructor() {
    this.root.name = 'terrain-ground-detail';
    this.grassGeometry.setAttribute('grassWind', this.grassWind); this.tallGrassGeometry.setAttribute('grassWind', this.tallGrassWind);
    const motion = attribute('grassWind', 'vec3');
    // Height-weighted bend keeps roots planted and remains visible on the
    // small, pixel-scaled grass patches even during clear weather.
    const sway = sin(this.clock.mul(motion.y).add(motion.z)).mul(positionLocal.y).mul(.22).mul(motion.x.mul(.6).add(.4)).mul(this.wind);
    this.grassMaterial.positionNode = positionLocal.add(vec3(sway,0,0));
    for(const mesh of [this.grass,this.tallGrass,this.bushes,this.rocks,this.twigs,this.shells]) { mesh.setColorAt(0, this.color.setHex(0xffffff)); mesh.count=0; mesh.frustumCulled=false; mesh.receiveShadow=true; this.root.add(mesh); }
    this.grass.name='gameplay-grass'; this.tallGrass.name='gameplay-tall-grass'; this.bushes.name='gameplay-bushes'; this.rocks.name='terrain-pebbles'; this.twigs.name='terrain-twigs'; this.shells.name='beach-shells';
  }
  rebuild(tiles: Iterable<TerrainTile>): void {
    let rocks=0, twigs=0, shells=0;
    for(const tile of tiles) {
      const x=tile.worldX??0,y=tile.worldY??0, item=scatterForTile(x,y,kind(tile)); if(!item) continue;
      const mesh=item.type==='twig'?this.twigs:item.type==='shell'?this.shells:this.rocks;
      const index=item.type==='twig'?twigs++:item.type==='shell'?shells++:rocks++; if(index>=LIMIT) continue;
      const p=worldToScene(item.x*WORLD_3D.tilePixels,item.y*WORLD_3D.tilePixels);
      this.helper.position.set(p.x,item.type==='twig' ? .025 : .035,p.z); this.helper.rotation.set(item.type==='twig'?Math.PI/2:0,item.rotation,0);
      this.helper.scale.set(item.type==='twig'?item.scale:item.scale*.13,item.type==='twig'?item.scale*.35:item.scale*.07,item.type==='twig'?item.scale:item.scale*.11);
      this.helper.updateMatrix(); mesh.setMatrixAt(index,this.helper.matrix); mesh.setColorAt(index,this.color.setHex(item.color));
    }
    this.rocks.count=Math.min(LIMIT,rocks); this.twigs.count=Math.min(LIMIT,twigs); this.shells.count=Math.min(LIMIT,shells);
    for(const mesh of [this.rocks,this.twigs,this.shells]) { mesh.instanceMatrix.needsUpdate=true; if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true; }
    this.grassSignature=null;
  }
  update(grass: unknown, kinds: Map<string,string>, time: number, animated: boolean, floorAt: (x:number,y:number)=>number, chunkWeather?: unknown, worldWeather?: unknown): void {
    this.clock.value=time; this.wind.value=Number(animated);
    const entries=grass instanceof Map ? [...grass.entries()] as [string,Grass][] : [];
    // Include the floor result so construction and removal update coverage immediately.
    let signature='';
    const weatherTag = (g: Grass): string => {
      const row = chunkWeather instanceof Map ? chunkWeather.get(String(g.chunkIndex)) : undefined;
      const weather = row?.currentWeather ?? (!(chunkWeather instanceof Map) ? worldWeather : undefined);
      return typeof weather === 'string' ? weather : weather?.tag ?? 'Clear';
    };
    for(const [id,g] of entries) signature+=`${id}:${g.currentRenderPosX},${g.currentRenderPosY},${g.appearanceType?.tag},${floorAt(g.currentRenderPosX,g.currentRenderPosY)},${weatherTag(g)},${g.swaySpeed},${g.swayOffsetSeed};`;
    if(signature===this.grassSignature)return; this.grassSignature=signature;
    let count=0, tallCount=0, bushes=0;
    const nextPhases = new Map<string, { frequency: number; phase: number; seed: number }>();
    for(const [id,g] of entries) {
      const x=g.currentRenderPosX,y=g.currentRenderPosY; if(!Number.isFinite(x)||!Number.isFinite(y)||floorAt(x,y)>0)continue;
      const terrain=kinds.get(`${Math.floor(x/48)},${Math.floor(y/48)}`); if(!terrain || ['Sea','DeepSea','HotSpringWater'].includes(terrain))continue;
      const appearance=g.appearanceType?.tag??'', palette=appearance.includes('Tundra')?'TundraGrass':appearance.includes('Alpine')?'Alpine':appearance.includes('Beach')?'Beach':terrain;
      const random=seededRandom(seedFromId(id)), p=worldToScene(x,y), tall=appearance.includes('Tall')||appearance.includes('Beach');
      if (/Bush|Brambles/.test(appearance)) {
        if(bushes>=LIMIT) continue;
        const size=.85+random()*.3;
        this.helper.position.set(p.x,.18*size,p.z);this.helper.rotation.set(0,random()*Math.PI*2,0);this.helper.scale.set(.35*size,.23*size,.35*size*GROUND_Y_SCALE);this.helper.updateMatrix();
        this.bushes.setMatrixAt(bushes,this.helper.matrix);this.bushes.setColorAt(bushes,this.color.setHex(appearance.includes('Brambles')?0x6c7043:0x617a45));bushes++;continue;
      }
      const mesh=tall?this.tallGrass:this.grass, index=tall?tallCount++:count++; if(index>=LIMIT) continue;
      this.helper.position.set(p.x,.015,p.z);this.helper.rotation.set(0,random()*Math.PI*2,0);
      const scale=tall?.95+random()*.2:.7+random()*.45;this.helper.scale.set(scale,scale,scale*GROUND_Y_SCALE*.7);this.helper.updateMatrix();
      mesh.setMatrixAt(index,this.helper.matrix);mesh.setColorAt(index,this.color.setHex(PALETTES[palette]??PALETTES.Grass).multiplyScalar(.9+random()*.2));
      const weather = weatherTag(g), sway = GRASS_SWAY_BY_WEATHER[weather] ?? DEFAULT_GRASS_SWAY;
      const beach = appearance.includes('Beach');
      const speed = beach ? 9.5 / 8 * (BEACH_GRASS_SPEED_BY_WEATHER[weather] ?? DEFAULT_BEACH_GRASS_SPEED)
        : Number.isFinite(g.swaySpeed) ? Math.max(0, g.swaySpeed!) : .1;
      const seed = Number.isFinite(g.swayOffsetSeed) ? g.swayOffsetSeed! : seedFromId(id);
      const frequency = speed * Math.PI * 2, previous = this.grassPhases.get(id);
      // Keep a beach clump's blade position continuous as weather changes its speed.
      const phase = previous?.seed === seed ? previous.phase + (previous.frequency - frequency) * time : (Math.abs(seed) % 1000) / 1000 * Math.PI;
      nextPhases.set(id,{frequency,phase,seed});
      (tall?this.tallGrassWind:this.grassWind).setXYZ(index,sway,frequency,phase);
    }
    for(const mesh of [this.grass,this.tallGrass]) { mesh.count=Math.min(LIMIT,mesh===this.grass?count:tallCount);mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true; }
    this.grassWind.needsUpdate=true; this.tallGrassWind.needsUpdate=true;
    this.grassPhases = nextPhases;
    this.bushes.count=bushes;this.bushes.instanceMatrix.needsUpdate=true;if(this.bushes.instanceColor)this.bushes.instanceColor.needsUpdate=true;
  }
  dispose(): void { for(const mesh of [this.grass,this.tallGrass,this.bushes,this.rocks,this.twigs,this.shells])mesh.dispose(); this.grassGeometry.dispose();this.tallGrassGeometry.dispose();this.rockGeometry.dispose();this.twigGeometry.dispose();this.shellGeometry.dispose();this.grassMaterial.dispose();this.scatterMaterial.dispose();this.root.clear(); }
}
