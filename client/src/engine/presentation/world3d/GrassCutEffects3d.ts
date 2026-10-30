import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, MeshStandardMaterial, Object3D } from 'three/webgpu';
import { seedFromId, seededRandom, worldToScene } from './visualContract';
import { worldGrassCutsAfter } from './presentationEffectEvents';
import type { WorldGrassCut } from './presentationEffectEvents';

const CAPACITY = 384, LIFETIME_MS = 800, BLADES_PER_CUT = 8;
function palette(appearance: string): number[] {
  if (appearance.includes('Tundra')) return [0x8b2424,0xb83c37,0xdc5448,0xe67c60];
  if (appearance === 'AlpinePatchA' || appearance === 'AlpinePatchC') return [0xe9eee5,0xcfd9d2,0xfaf8e9];
  if (appearance === 'AlpinePatchB' || appearance === 'AlpinePatchD') return [0xd4af6a,0xe5c896,0xc9a86a];
  if (appearance.includes('Alpine')) return [0x3f9463,0x71b985,0xb4d9b6];
  return [0x4c823a,0x6ba649,0x90c45a,0xb0d574];
}

/** Small pooled, depth-tested grass blades emitted from authoritative cuts. */
export class GrassCutEffects3d {
  readonly root = new Group();
  readonly blades: InstancedMesh;
  private readonly geometry = new BufferGeometry();
  private readonly material = new MeshStandardMaterial({color:0xffffff,side:DoubleSide,roughness:1});
  private readonly transform = new Object3D();
  private readonly color = new Color();
  private readonly events: WorldGrassCut[] = [];
  private cursor = 0;

  constructor() {
    this.root.name = 'grass-cut-effects';
    this.geometry.setAttribute('position',new Float32BufferAttribute([-.18,0,0, .18,0,0, .1,.55,.03, -.1,.55,.03, .08,1,.09],3));
    this.geometry.setIndex([0,1,2,0,2,3,3,2,4]); this.geometry.computeVertexNormals();
    this.blades = new InstancedMesh(this.geometry,this.material,CAPACITY);
    this.blades.name='grass-cut-blades'; this.blades.count=0; this.blades.frustumCulled=false;
    this.blades.setColorAt(0,this.color.setHex(0xffffff)); this.root.add(this.blades); this.root.visible=false;
  }

  update(now: number, submerged = false): void {
    for (const event of worldGrassCutsAfter(this.cursor,now)) { this.events.push(event); this.cursor=Math.max(this.cursor,event.sequence); }
    while (this.events.length > CAPACITY / BLADES_PER_CUT) this.events.shift();
    for (let i=this.events.length-1;i>=0;i--) if(now<this.events[i].at || now-this.events[i].at>=LIFETIME_MS) this.events.splice(i,1);
    let count=0;
    for (const event of this.events) {
      const age=(now-event.at)/1000, p=worldToScene(event.x,event.y), colors=palette(event.appearance);
      const random=seededRandom(seedFromId(`grass-cut:${event.id}:${event.at}`));
      for(let i=0;i<BLADES_PER_CUT && count<CAPACITY;i++) {
        const angle=i*Math.PI*2/BLADES_PER_CUT+(random()-.5)*.6, speed=1.2+random()*1.5, rise=1.3+random()*1.5;
        const size=(.26+random()*.2)*Math.min(1,(LIFETIME_MS/1000-age)/.18);
        this.transform.position.set(p.x+Math.cos(angle)*speed*age,Math.max(.03,.18+rise*age-3.3*age*age),p.z+Math.sin(angle)*speed*age);
        this.transform.rotation.set(random()*3+age*6,angle,random()*3+age*4);
        this.transform.scale.setScalar(size);this.transform.updateMatrix();
        this.blades.setMatrixAt(count,this.transform.matrix); this.blades.setColorAt(count++,this.color.setHex(colors[i%colors.length]));
      }
    }
    this.blades.count=count;this.root.visible=!submerged && count>0;
    if(count) {this.blades.instanceMatrix.needsUpdate=true;this.blades.instanceColor!.needsUpdate=true;}
  }

  dispose(): void {this.root.removeFromParent();this.events.length=0;this.blades.dispose();this.geometry.dispose();this.material.dispose();}
}
