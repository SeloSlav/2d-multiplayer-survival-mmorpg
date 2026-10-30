import { Color, Group, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three/webgpu';
import { predictedCombatHit } from '../../../utils/combatFeedbackEvents';
import type { CombatFeedbackKind } from '../../../utils/combatFeedbackEvents';
import { ModelKit } from './modelKit';
import { seedFromId, worldToScene, WORLD_3D } from './visualContract';
import { worldItemBreaksAfter } from './presentationEffectEvents';

type MaterialKind = 'blood'|'ethereal'|'wood'|'stone'|'metal';
interface HitState { server:bigint; predicted:number; predictionAt:number; reactionAt:number; seenAt:number }
interface Impact { at:number; x:number; y:number; z:number; ground:number; material:MaterialKind; seed:number }
const PARTICLES=512, DURATION=780;
const PREDICTABLE=new Set<string>(['players','wildAnimals','animalCorpses','playerCorpses','trees','stones','barrels','livingCorals']);
export const COMBAT_FEEDBACK_KINDS=new Set(['players','wildAnimals','animalCorpses','playerCorpses','trees','stones','barrels','livingCorals',
  'woodenStorageBoxes','campfires','furnaces','barbecues','lanterns','shelters','doors','wallCells','foundationCells','ceilings','fences',
  'homesteadHearths','rainCollectors','brothPots','sleepingBags','stashes','turrets']);

function impactMaterial(kind:string,subtype:string):MaterialKind {
  if(kind==='players'||kind==='animalCorpses'||kind==='playerCorpses')return 'blood';
  if(kind==='wildAnimals')return ['Shardkin','Shorebound','DrownedWatch'].includes(subtype)?'ethereal':'blood';
  if(kind==='stones'||kind==='livingCorals')return subtype==='Metal'?'metal':'stone';
  if(kind==='furnaces'||kind==='lanterns'||kind==='brothPots'||kind==='turrets')return 'metal';
  return 'wood';
}

/** Bounded, world-space 3D hit bursts and per-entity recoil. Hit timestamps
 * deduplicate local predictions and later server confirmations. */
export class CombatEffects3d {
  readonly root=new Group();
  readonly debris:InstancedMesh;
  readonly flashes:InstancedMesh;
  private readonly debrisMaterial=new MeshStandardMaterial({color:0xffffff,roughness:.9,flatShading:true});
  private readonly flashMaterial=new MeshBasicMaterial({color:0xffffff,toneMapped:false});
  private readonly states=new Map<string,HitState>();
  private readonly impacts:Impact[]=[];
  private readonly transform=new Object3D();
  private readonly color=new Color();
  private lastCleanup=0;
  private breakCursor=0;
  constructor(kit:ModelKit){
    this.root.name='combat-impact-effects';
    this.debris=new InstancedMesh(kit.geometry('rock'),this.debrisMaterial,PARTICLES);
    this.flashes=new InstancedMesh(kit.geometry('box'),this.flashMaterial,PARTICLES);
    for(const mesh of [this.debris,this.flashes]){
      mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=false;
      mesh.setColorAt(0,this.color.setHex(0xffffff));this.root.add(mesh);
    }
    this.root.visible=false;
  }
  observe(kind:string,id:string,hitMicros:bigint,x:number,y:number,groundY:number,subtype:string,now:number):number {
    if(!COMBAT_FEEDBACK_KINDS.has(kind))return 0;
    const key=`${kind}:${id}`;
    let state=this.states.get(key);const first=!state;
    const hitMs=Number(hitMicros/1000n);
    if(!state){state={server:hitMicros,predicted:0,predictionAt:0,reactionAt:0,seenAt:now};this.states.set(key,state);}
    state.seenAt=now;
    const predicted=PREDICTABLE.has(kind)?predictedCombatHit(kind as CombatFeedbackKind,id):undefined;
    if(predicted&&predicted.sequence>state.predicted){
      state.predicted=predicted.sequence;
      if(now-predicted.at>=0&&now-predicted.at<500){state.predictionAt=predicted.at;this.impact(state,key,kind,subtype,x,y,groundY,now);}
    }
    if(first&&hitMicros>0n&&now-hitMs>=-100&&now-hitMs<500&&!state.predictionAt)this.impact(state,key,kind,subtype,x,y,groundY,now);
    if(hitMicros>state.server){
      state.server=hitMicros;
      // A prediction already showed this same swing immediately; its later
      // server confirmation must not create a second burst/recoil.
      if(!state.predictionAt||now-state.predictionAt>650)this.impact(state,key,kind,subtype,x,y,groundY,now);
    } else if(hitMicros===0n)state.server=0n;
    const age=now-state.reactionAt;
    if(!state.reactionAt||age<0||age>=300)return 0;
    return Math.sin(age*.055)*(1-age/300)**2;
  }
  private impact(state:HitState,key:string,kind:string,subtype:string,x:number,y:number,groundY:number,now:number):void {
    state.reactionAt=now;
    const point=worldToScene(x,y);
    const material=impactMaterial(kind,subtype);
    const height=kind==='players'?1.05:kind==='trees'?1.05:kind==='wildAnimals' ? .65 : .55;
    this.impacts.push({at:now,x:point.x,y:groundY+height,z:point.z+(groundY<0?groundY/Math.tan(WORLD_3D.elevationRadians):0),ground:groundY,material,seed:seedFromId(`${key}:${now}`)});
    if(this.impacts.length>36)this.impacts.shift();
  }
  update(now:number):void {
    for (const event of worldItemBreaksAfter(this.breakCursor, now)) {
      this.breakCursor = Math.max(this.breakCursor, event.sequence);
      const point = worldToScene(event.x, event.y);
      this.impacts.push({at:event.at,x:point.x,y:.3,z:point.z,ground:0,material:'wood',seed:seedFromId(`break:${event.id}`)});
      if(this.impacts.length>36)this.impacts.shift();
    }
    while(this.impacts.length&&now-this.impacts[0].at>=DURATION)this.impacts.shift();
    let debris=0,flashes=0;
    for(const hit of this.impacts){
      const age=Math.max(0,(now-hit.at)/1000),fade=Math.max(0,1-age/(DURATION/1000));
      const rand=(i:number,salt:number)=>{let v=Math.imul(hit.seed^Math.imul(i+1,0x9e3779b1)^salt,0x85ebca6b);v=Math.imul(v^v>>>13,0xc2b2ae35);return ((v^v>>>16)>>>0)/4294967295;};
      const palette=hit.material==='blood'?[0x8d1f27,0xbf3035,0x641820]:hit.material==='ethereal'?[0xa7c9dc,0xb68de1,0x6ca8c5]:
        hit.material==='wood'?[0x98704a,0xc09a63,0x684934]:hit.material==='metal'?[0xc0bca8,0x9fa5a4,0xe7b75d]:[0x9d9b8d,0xb8b2a1,0x736f65];
      for(let i=0;i<12&&debris<PARTICLES;i++){
        const angle=rand(i,1)*Math.PI*2,speed=1.2+rand(i,2)*2.8,rise=.65+rand(i,3)*1.45;
        const height=Math.max(hit.ground+.04,hit.y+rise*age-4.2*age*age);
        this.transform.position.set(hit.x+Math.cos(angle)*speed*age,height,hit.z+Math.sin(angle)*speed*age);
        this.transform.rotation.set(age*6+rand(i,4)*3,angle,age*3+rand(i,5)*3);
        const size=(hit.material==='blood' ? .14 : .16)*(.7+rand(i,6)*.6)*Math.min(1,fade*3);
        this.transform.scale.set(size*(hit.material==='wood' ? .7 : 1),size*(hit.material==='blood' ? .8 : 1),size*(hit.material==='wood' ? 1.5 : 1));this.transform.updateMatrix();
        this.debris.setMatrixAt(debris,this.transform.matrix);this.debris.setColorAt(debris++,this.color.setHex(palette[i%palette.length]));
      }
      if(age<.17)for(let i=0;i<5&&flashes<PARTICLES;i++){
        const angle=i*Math.PI*2/5+rand(i,7)*.4,radius=.1+age*1.5;
        this.transform.position.set(hit.x+Math.cos(angle)*radius,hit.y+Math.sin(angle)*radius*.5,hit.z+Math.sin(angle)*radius);
        this.transform.rotation.set(0,angle,angle);const size=.075*(1-age/.17);
        this.transform.scale.set(size*2,size*.5,size);this.transform.updateMatrix();
        this.flashes.setMatrixAt(flashes,this.transform.matrix);this.flashes.setColorAt(flashes++,this.color.setHex(hit.material==='blood'?0xf2b8a1:0xffe5a4));
      }
    }
    this.debris.count=debris;this.flashes.count=flashes;this.root.visible=debris+flashes>0;
    for(const mesh of [this.debris,this.flashes])if(mesh.count){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    if(now-this.lastCleanup>5000){for(const [key,state] of this.states)if(now-state.seenAt>10000)this.states.delete(key);this.lastCleanup=now;}
  }
  dispose():void {this.root.removeFromParent();this.debris.dispose();this.flashes.dispose();this.debrisMaterial.dispose();this.flashMaterial.dispose();this.impacts.length=0;this.states.clear();}
}
