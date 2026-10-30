import { AdditiveBlending, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { seedFromId, worldToScene } from './visualContract';

export const APPARITION_PALETTES: Readonly<Record<string, readonly number[]>> = {
  Shorebound: [0x22d3ee,0x06b6d4,0x0ea5e9,0x67e8f9,0xa5f3fc],
  Shardkin: [0xa855f7,0x8b5cf6,0xc084fc,0xd8b4fe,0xe9d5ff],
  DrownedWatch: [0x3b82f6,0x2563eb,0x60a5fa,0x93c5fd,0xbfdbfe],
};
const DEATH_COUNT: Readonly<Record<string,number>> = {Shorebound:45,Shardkin:25,DrownedWatch:80};
const HEIGHT: Readonly<Record<string,number>> = {Shorebound:1.58,Shardkin:.96,DrownedWatch:2.05};
const MAX_BURSTS=32, CAPACITY=2048, HIT_MS=600, DEATH_MS=900, FLASH_MS=120;
export interface ApparitionDeathEvent { id:string; x:number; y:number; species:string; timestamp:number }
interface Burst { kind:'hit'|'death'; species:string; x:number; y:number; z:number; at:number; seed:number }
function random(seed:number,index:number,salt:number):number {
  let n=Math.imul(seed^Math.imul(index+1,0x9e3779b1)^salt,0x85ebca6b);n=Math.imul(n^n>>>13,0xc2b2ae35);return ((n^n>>>16)>>>0)/4294967295;
}
/** Shared unlit flash and a bounded, analytic world-space wisp pool. */
export class ApparitionEffects3d {
  readonly root=new Group();
  readonly flashWarmup=new Group();
  readonly flashMaterial=new MeshBasicMaterial({color:0xffffff,toneMapped:false});
  readonly wisps:InstancedMesh;
  private readonly material=new MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.9,depthWrite:false,blending:AdditiveBlending,toneMapped:false});
  private readonly bursts:Burst[]=[];
  private readonly seenDeaths=new Map<string,number>();
  private readonly transform=new Object3D();
  private readonly color=new Color();
  constructor(kit:ModelKit){
    this.root.name='apparition-effects';
    this.wisps=new InstancedMesh(kit.geometry('rock'),this.material,CAPACITY);this.wisps.name='apparition-wisps';
    this.wisps.count=0;this.wisps.frustumCulled=false;this.wisps.castShadow=false;this.wisps.receiveShadow=false;
    this.wisps.setColorAt(0,this.color.setHex(0xffffff));this.root.add(this.wisps);
    // This dummy has the same layout and shadow flags as the articulated
    // animal solids, so the 180 ms flash is compiled before the first hit.
    const warm=new Mesh(kit.geometry('box'),this.flashMaterial);warm.castShadow=true;warm.receiveShadow=true;this.flashWarmup.add(warm);
  }
  hit(species:string,x:number,y:number,ground:number,at:number,seed:number):void {
    if(!APPARITION_PALETTES[species])return;
    const p=worldToScene(x,y);this.push({kind:'hit',species,x:p.x,y:ground,z:p.z,at,seed});
  }
  observeDeaths(events:unknown,now:number,allow:(x:number,y:number)=>boolean,groundAt:(x:number,y:number)=>number):void {
    if(Array.isArray(events))for(const event of events as ApparitionDeathEvent[]){
      if(!event||!APPARITION_PALETTES[event.species]||this.seenDeaths.has(event.id)||!Number.isFinite(event.timestamp))continue;
      this.seenDeaths.set(event.id,now);
      if(now-event.timestamp<0||now-event.timestamp>=DEATH_MS||!allow(event.x,event.y))continue;
      const p=worldToScene(event.x,event.y);this.push({kind:'death',species:event.species,x:p.x,y:groundAt(event.x,event.y),z:p.z,at:event.timestamp,seed:seedFromId(event.id)});
    }
    for(const [id,seen] of this.seenDeaths)if(now-seen>10000)this.seenDeaths.delete(id);
    while(this.seenDeaths.size>256)this.seenDeaths.delete(this.seenDeaths.keys().next().value!);
  }
  private push(burst:Burst):void { if(this.bursts.length>=MAX_BURSTS)this.bursts.shift();this.bursts.push(burst); }
  update(now:number):void {
    for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];if(now-b.at>= (b.kind==='hit'?HIT_MS:DEATH_MS)||now<b.at)this.bursts.splice(i,1);}
    let count=0;
    for(const b of this.bursts){
      const death=b.kind==='death',age=now-b.at,duration=death?DEATH_MS:HIT_MS,t=age/duration;
      const palette=APPARITION_PALETTES[b.species],amount=death?DEATH_COUNT[b.species]:12,height=HEIGHT[b.species];
      const white=death&&age<FLASH_MS?18:0;
      for(let i=0;i<amount+white&&count<CAPACITY;i++){
        const isWhite=i>=amount, angle=random(b.seed,i,1)*Math.PI*2;
        const speed=(death ? .8 : .45)+random(b.seed,i,2)*(death?1.8:1.3);
        const life=.68+random(b.seed,i,3)*.32, progress=isWhite?age/FLASH_MS:t/life;
        if(progress>=1)continue;
        const elapsed=age/1000,radial=speed*elapsed,initial=(.22+random(b.seed,i,4)*.66)*height;
        this.transform.position.set(b.x+Math.cos(angle)*radial,b.y+initial+elapsed*(death?1.5:1.05)+Math.sin(angle*2)*radial*.18,b.z+Math.sin(angle)*radial);
        this.transform.rotation.set(angle,angle*.7,angle*1.3+elapsed*2);
        const fade=Math.min(1,(1-progress)*4),size=(isWhite ? .105 : death ? .085 : .075)*(.7+random(b.seed,i,5)*.7)*fade;
        this.transform.scale.set(size,size*(isWhite?1.2:2.1),size);this.transform.updateMatrix();
        this.wisps.setMatrixAt(count,this.transform.matrix);this.wisps.setColorAt(count++,this.color.setHex(isWhite?0xffffff:palette[i%palette.length]));
      }
    }
    this.wisps.count=count;this.wisps.instanceMatrix.needsUpdate=true;if(this.wisps.instanceColor)this.wisps.instanceColor.needsUpdate=true;
  }
  get activeCount():number{return this.bursts.length;}
  dispose():void{this.root.removeFromParent();this.wisps.dispose();this.material.dispose();this.flashMaterial.dispose();this.flashWarmup.clear();this.root.clear();this.bursts.length=0;this.seenDeaths.clear();}
}
