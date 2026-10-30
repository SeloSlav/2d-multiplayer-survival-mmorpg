import test from 'node:test';
import { TerrainWindow3d } from '../client/src/engine/presentation/world3d/TerrainWindow3d.ts';
import { GroundDetail3d, scatterForTile } from '../client/src/engine/presentation/world3d/GroundDetail3d.ts';
import { GrassCutEffects3d } from '../client/src/engine/presentation/world3d/GrassCutEffects3d.ts';
import { isGrassDestructionDelete, recordWorldGrassCut, worldGrassCutsAfter } from '../client/src/engine/presentation/world3d/presentationEffectEvents.ts';
import { bindGrassCutEvents } from '../client/src/engine/runtime/grassCutEventRuntime.ts';
import { CloudShadows3d } from '../client/src/engine/presentation/world3d/CloudShadows3d.ts';
import { worldLightAt } from '../client/src/engine/presentation/world3d/WorldLighting3d.ts';
import { mapLegacyCycleProgress } from '../client/src/config/dayNightConstants.ts';
import { createCombatTableBindings } from '../client/src/engine/adapters/spacetime/worldAndCombatTableBindings.ts';
import { keyboardMovement } from '../client/src/engine/runtime/keyboardMovement.ts';
import { movementPredictionRuntime } from '../client/src/engine/runtime/movementPredictionRuntime.ts';
import { advanceTurretYaw, turretDesiredYaw, turretRecoil } from '../client/src/engine/presentation/world3d/turretAnimation.ts';
import { interactionBounds, interactionVisualKey } from '../client/src/engine/presentation/world3d/interactionHighlight.ts';
import { ALK_FACILITY_LABELS } from '../client/src/engine/presentation/world3d/facilitySigns.ts';
import { preferNearestRelatedTargets, selectHighestPriorityTarget } from '../client/src/types/interactions.ts';

test('turret heads aim and scan independently of the platform, and recoil only briefly', () => {
  const kit=new ModelKit(), turret=createAlkTurret(kit,true), head=turret.getObjectByName('turret-head');
  assert.ok(head); const base=turret.children[0];
  const aimed=turretDesiredYaw({x:0,y:0},{x:100,y:0},0,1);
  assert.equal(aimed,Math.PI/2);
  head.rotation.y=advanceTurretYaw(0,aimed,1);
  assert.ok(head.rotation.y>1.5);assert.equal(base.rotation.y,0);
  assert.notEqual(turretDesiredYaw({x:0,y:0},null,0,1),turretDesiredYaw({x:0,y:0},null,5,1));
  assert.ok(turretRecoil(1000,1000) > 0);assert.equal(turretRecoil(1400,1000),0);
  const furnace=createAlkBuilding(kit,'furnace');assert.ok(furnace.getObjectByName('fire'));
  assert.equal(furnace.userData.facilityLabel,'FURNACE');
  for(const [asset,label] of Object.entries(ALK_FACILITY_LABELS))assert.equal(createAlkBuilding(kit,asset).userData.facilityLabel,label);
  assert.equal(COMPOUND_BUILDINGS.some(building=>building.id==='warehouse'),false,'the old SELO warehouse is removed');
  assert.ok(furnace.children.length < 6, 'compound geometry is consolidated');
  kit.dispose();
});

test('compound interaction selection chooses the closest facility and model bounds project to the UI', () => {
  const targets=[{type:'alk_station',id:0,distance:230,position:{x:0,y:0}},{type:'box',id:4,distance:60,position:{x:0,y:0}}];
  const chosen=selectHighestPriorityTarget(preferNearestRelatedTargets(targets,()=>true));
  assert.equal(chosen.type,'box');assert.equal(interactionVisualKey(chosen),'woodenStorageBoxes:4');
  const kit=new ModelKit(), model=createAlkTurret(kit,true);
  const camera=new OrthographicCamera(-10,10,10,-10,.1,100);camera.position.set(0,10,10);camera.lookAt(0,0,0);camera.updateProjectionMatrix();
  const box=interactionBounds(model,camera,800,800,{x:400,y:400});
  assert.ok(box && box.width>16 && box.height>16 && Math.abs(box.x-400)<10);
  kit.dispose();
});

test('terrain scatter is deterministic, terrain-specific and absent from water and tilled ground', () => {
  let grass=0, quarry=0;
  for(let y=0;y<30;y++) for(let x=0;x<30;x++) {
    const a=scatterForTile(x,y,'Grass');
    assert.deepEqual(a,scatterForTile(x,y,'Grass'));
    if(a) grass++;
    if(scatterForTile(x,y,'Quarry')) quarry++;
    assert.equal(scatterForTile(x,y,'Sea'),null);
    assert.equal(scatterForTile(x,y,'Tilled'),null);
  }
  assert.ok(quarry>grass && grass>0);
});

test('3D grass follows live grass state and excludes foundations and water', () => {
  const detail=new GroundDetail3d();
  const kinds=new Map([['0,0','Grass'],['1,0','TundraGrass'],['2,0','Sea']]);
  const grass=new Map([['a',{currentRenderPosX:12,currentRenderPosY:12,appearanceType:{tag:'PatchA'}}],['b',{currentRenderPosX:60,currentRenderPosY:12,appearanceType:{tag:'TundraPatchA'}}],['c',{currentRenderPosX:108,currentRenderPosY:12,appearanceType:{tag:'PatchA'}}]]);
  const mesh=detail.root.getObjectByName('gameplay-grass');
  detail.update(grass,kinds,1,true,()=>0); assert.equal(mesh.count,2);
  grass.delete('a');detail.update(grass,kinds,2,true,()=>0);assert.equal(mesh.count,1);
  detail.update(grass,kinds,3,false,()=>.16);assert.equal(mesh.count,0);
  detail.update(grass,kinds,4,true,()=>0);assert.equal(mesh.count,1);
  grass.set('b',{currentRenderPosX:60,currentRenderPosY:12,appearanceType:{tag:'BramblesA'}});
  detail.update(grass,kinds,5,true,()=>0);
  assert.equal(mesh.count,0);assert.equal(detail.root.getObjectByName('gameplay-bushes').count,1);
  grass.clear();detail.rebuild([]);detail.update(grass,kinds,6,true,()=>0);
  assert.equal(detail.root.getObjectByName('gameplay-bushes').count,0);
  detail.dispose();
});

test('biome grass colors follow the 2D species and tall clumps remain authoritative visual cover', () => {
  const detail = new GroundDetail3d();
  const kinds = new Map([['0,0','Grass'],['1,0','TundraGrass'],['2,0','Alpine'],['3,0','Beach']]);
  const grass = new Map(['TallGrassA','TallGrassTundraA','TallGrassAlpineA','BeachGrassA'].map((tag,i) =>
    [tag, {currentRenderPosX:(i+.5)*48,currentRenderPosY:24,appearanceType:{tag}}]));
  detail.update(grass,kinds,0,false,()=>0);
  const tall=detail.root.getObjectByName('gameplay-tall-grass');
  assert.equal(tall.count,4);
  tall.geometry.computeBoundingBox();
  assert.ok(tall.geometry.boundingBox.max.y > 2, 'tall grass rises above the standing survivor');
  assert.ok(tall.geometry.getAttribute('position').count >= 300, 'cover is made from overlapping blades');
  const colors = tall.instanceColor.array;
  assert.ok(colors[3] > colors[4] * 2, 'tundra grass is red');
  assert.ok(colors[7] > colors[6] && colors[10] > colors[9], 'alpine and beach grass are green');
  for (const mesh of detail.root.children) assert.ok(mesh.instanceColor, 'instance colors exist before shader compilation');
  grass.delete('TallGrassA'); detail.update(grass,kinds,1,false,()=>0); assert.equal(tall.count,3);
  detail.update(grass,kinds,2,false,()=>.1); assert.equal(tall.count,0);
  detail.dispose();
});

test('grass wind uses each chunk weather, preserves beach motion phase and honors animation settings', () => {
  const detail = new GroundDetail3d(), kinds = new Map([['0,0','Grass'],['1,0','Grass'],['2,0','Beach']]);
  const grass = new Map([
    ['calm',{currentRenderPosX:12,currentRenderPosY:12,appearanceType:{tag:'PatchA'},chunkIndex:1,swaySpeed:1,swayOffsetSeed:250}],
    ['storm',{currentRenderPosX:60,currentRenderPosY:12,appearanceType:{tag:'TallGrassA'},chunkIndex:2,swaySpeed:1.7,swayOffsetSeed:500}],
    ['beach',{currentRenderPosX:108,currentRenderPosY:12,appearanceType:{tag:'BeachGrassA'},chunkIndex:1,swayOffsetSeed:700}],
  ]);
  const weather = new Map([['1',{currentWeather:{tag:'Clear'}}],['2',{currentWeather:{tag:'HeavyStorm'}}]]);
  const update = (time, animated = true, map = weather) => detail.update(grass,kinds,time,animated,()=>0,map);
  update(3);
  const small = detail.root.getObjectByName('gameplay-grass').geometry.getAttribute('grassWind');
  const tall = detail.root.getObjectByName('gameplay-tall-grass').geometry.getAttribute('grassWind');
  assert.ok(Math.abs(small.getX(0)-.15)<1e-6 && Math.abs(tall.getX(0)-1.35)<1e-6, 'different chunks receive their own wind');
  assert.ok(Math.abs(small.getY(0)-2*Math.PI)<1e-6, 'the authoritative sway speed is used');
  const beachFrequency=tall.getY(1), beachPhase=tall.getZ(1), previousMatrix=detail.root.getObjectByName('gameplay-tall-grass').instanceMatrix.array.slice(0,32);
  weather.get('1').currentWeather.tag='HeavyRain'; update(4);
  assert.ok(Math.abs(small.getX(0)-1)<1e-6 && Math.abs(tall.getX(0)-1.35)<1e-6);
  assert.ok(tall.getY(1)>beachFrequency, 'beach grass moves faster in stronger weather');
  assert.ok(Math.abs((beachFrequency*4+beachPhase)-(tall.getY(1)*4+tall.getZ(1)))<1e-5, 'weather speed changes do not snap beach grass');
  assert.deepEqual(detail.root.getObjectByName('gameplay-tall-grass').instanceMatrix.array.slice(0,32), previousMatrix, 'wind does not move placement anchors');
  update(5,false); assert.equal(detail.wind.value,0); update(6,true); assert.equal(detail.wind.value,1);
  weather.delete('1'); update(7); assert.ok(Math.abs(small.getX(0)-.15)<1e-6, 'missing chunk weather falls back to clear');
  detail.dispose();
});

test('grass cut callbacks handle filtered deletes and full-state updates without treating unsubscribe as a cut', () => {
  const callbacks={};
  const table=name=>({onDelete:fn=>callbacks[`${name}:delete`]=fn, removeOnDelete:()=>{},
    onUpdate:fn=>callbacks[`${name}:update`]=fn, removeOnUpdate:()=>{}, onInsert:()=>{}, removeOnInsert:()=>{}});
  const db={grass_state:table('grass')};
  const detach=bindGrassCutEvents({db},state=>recordWorldGrassCut(String(state.grassId),96,144,'TallGrassTundraA'));
  const now=Date.now(), old={grassId:919001n,isAlive:true}, dead={...old,isAlive:false};
  callbacks['grass:delete']({event:{tag:'UnsubscribeApplied'}},old);
  assert.equal(worldGrassCutsAfter(0,now+10).filter(e=>e.id==='919001').length,0);
  callbacks['grass:update']({event:{tag:'Reducer'}},old,dead);
  callbacks['grass:delete']({event:{tag:'Reducer'}},old);
  const events=worldGrassCutsAfter(0,Date.now()+10).filter(e=>e.id==='919001');
  assert.equal(events.length,1);assert.deepEqual([events[0].x,events[0].y,events[0].appearance],[96,144,'TallGrassTundraA']);
  assert.equal(isGrassDestructionDelete({event:{tag:'SubscribeApplied'}}),false);
  detach();
});

test('grass cuts produce pooled, biome-colored blades that fly and expire', () => {
  const effect=new GrassCutEffects3d(), at=1000000;
  recordWorldGrassCut('red-fixture',96,144,'TallGrassTundraA',at);
  effect.update(at+100);assert.equal(effect.blades.count,8);assert.equal(effect.root.visible,true);
  const first=effect.blades.instanceMatrix.array.slice(0,16), color=effect.blades.instanceColor.array;
  assert.ok(color[0]>color[1]*2, 'tundra fragments retain their red color');
  effect.update(at+350);assert.notDeepEqual(effect.blades.instanceMatrix.array.slice(0,16),first,'blades travel after the cut');
  effect.update(at+400,true);assert.equal(effect.root.visible,false,'underwater view hides land debris');
  effect.update(at+801);assert.equal(effect.blades.count,0);effect.dispose();
});

test('cloud projection tracks interpolated positions and clears when disabled', () => {
  const shadows=new CloudShadows3d();
  const clouds=new Map([['c',{currentRenderPosX:96,currentRenderPosY:144,width:480,height:240,rotationDegrees:0,currentOpacity:.1}]]);
  shadows.update(clouds,96,144,true);
  assert.equal(shadows.shapes[0].value.x,2);assert.equal(shadows.shapes[0].value.y,3);
  assert.ok(shadows.properties[0].value.z>0);
  clouds.get('c').currentRenderPosX=144;shadows.update(clouds,96,144,true);assert.equal(shadows.shapes[0].value.x,3);
  shadows.update(clouds,96,144,false);assert.equal(shadows.properties[0].value.z,0);
});

test('world light follows the game day phases, keeps moonlight blue and crosses midnight smoothly', () => {
  const phase=p=>worldLightAt(mapLegacyCycleProgress(p));
  const morning=phase(.10),noon=phase(.4),sunset=phase(.72),twilight=phase(.77),night=phase(.9);
  assert.ok(morning.daylight>.9 && noon.daylight===1,'morning and midday are sunlit');
  assert.ok(sunset.direct.r>sunset.direct.b*3,'sunset is orange');
  assert.ok(twilight.sky.b>twilight.sky.g && night.direct.b>night.direct.r,'twilight and night are cool');
  assert.ok(night.directPower<sunset.directPower && night.skyPower<noon.skyPower);
  const full=worldLightAt(mapLegacyCycleProgress(.9),true,3);
  assert.ok(full.skyPower>night.skyPower && full.direct.b>full.direct.r,'full moon is brighter and silver-blue');
  const before=worldLightAt(1-1e-7,true,3),after=worldLightAt(0,false,4);
  assert.ok(Math.hypot(before.direct.r-after.direct.r,before.direct.g-after.direct.g,before.direct.b-after.direct.b)<1e-5);
  assert.ok(Math.abs(before.directPower-after.directPower)<1e-5);
  const firstFull=worldLightAt(0,true,0),regularDawn=worldLightAt(0,false);
  assert.ok(Math.abs(firstFull.directPower-regularDawn.directPower)<1e-6);
  const sunrise=phase(.02),late=phase(.74);
  assert.ok(sunrise.direction.x<0 && late.direction.x>0,'sun and shadow directions travel across the day');
  for(let i=0;i<1000;i++){const state=worldLightAt(i/1000);assert.ok(state.direction.y>0 && Number.isFinite(state.skyPower));}
});

test('clouds modulate the directional light shared by scene materials',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  assert.equal(renderer.sun.colorNode,renderer.terrainMaterials.cloudShadows.directLight);
  const state=worldLightAt(.45);renderer.updateLighting({tables:{}},0,[],state);
  assert.ok(renderer.terrainMaterials.cloudShadows.lightColor.value.r>0);
  assert.ok(Number.isFinite(renderer.terrainMaterials.cloudShadows.lightSlope.value.x));
  await renderer.dispose();
});
import { addWebGpuSample, webGpuProfilerTimings } from '../client/src/engine/presentation/world3d/world3dProfiler.ts';
import { startRecording, stopRecording, copyToClipboard } from '../client/src/utils/profilerRecording.ts';
import { FpsProfiler } from '../client/src/utils/profiler/FpsProfiler.ts';
import { TerrainBuildQueue } from '../client/src/engine/presentation/world3d/TerrainBuildQueue.ts';
import { buildTerrain } from '../client/src/engine/presentation/world3d/terrainBuild.ts';
import { PipelineWarmup3d } from '../client/src/engine/presentation/world3d/PipelineWarmup3d.ts';
import { CombatEffects3d } from '../client/src/engine/presentation/world3d/CombatEffects3d.ts';
import { ApparitionEffects3d, APPARITION_PALETTES } from '../client/src/engine/presentation/world3d/ApparitionEffects3d.ts';
import { combatCameraOffset } from '../client/src/engine/presentation/world3d/combatCamera.ts';
import { recordPredictedCombatHit, predictedImpactCameraShake } from '../client/src/utils/combatFeedbackEvents.ts';
import { TREE_IMPACT_MS } from '../client/src/engine/presentation/world3d/TreeFallEffects3d.ts';
import { recordTreeFallPlayback, treeFallPlayback } from '../client/src/utils/treeFallAudioSync.ts';
import './placement.test.mjs';
import './hot-springs.test.mjs';
import './collectible-glitter.test.mjs';
import './animation-world3d.test.mjs';
import assert from 'node:assert/strict';

function streamingChunks() {
  const chunks = new Map();
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) chunks.set(`${x},${y}`, {chunkSize:8, tileTypes:Uint8Array.from({length:64},(_,i)=>x * 8 + i % 8 > 38 ? 3 : 4)});
  return chunks;
}
function terrainFrame(cx = 44, cy = 44, zoom = 1) {
  return {width:1280,height:720,cameraOffset:{x:640-cx*48,y:360-cy*48},zoom};
}
test('local fire and torch changes keep exactly the same shader light list and inactive slots emit no light', async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}), frame={tables:{worldState:{cycleProgress:.5}}};
  const lightIds=()=>{const ids=[];renderer.scene.traverseVisible(o=>{if(o.isLight)ids.push(o.id);});return ids;};
  renderer.updateLighting(frame,0,[]);const initial=lightIds();
  for(const count of [1,8,3,0,2,0]){
    renderer.updateLighting(frame,2,Array.from({length:count},(_,i)=>({position:new Vector3(i,1,0),color:0xffaa33,intensity:4})));
    assert.deepEqual(lightIds(),initial);
    assert.equal(renderer.lights.filter(l=>l.intensity>0).length,count);
  }
  await renderer.dispose();
});

test('combat impacts use fresh damage events, deduplicate prediction confirmations and expire pooled effects',()=>{
  const kit=new ModelKit(),fx=new CombatEffects3d(kit),base=1000000;
  const hit=(kind,id,stamp,now,subtype='')=>fx.observe(kind,id,BigInt(stamp)*1000n,400,400,0,subtype,now);
  hit('players','target-test',0,base);
  recordPredictedCombatHit('players','target-test',base+20);
  hit('players','target-test',0,base+20);assert.equal(fx.impacts.length,1);assert.equal(fx.impacts[0].material,'blood');
  hit('players','target-test',base+70,base+110);assert.equal(fx.impacts.length,1,'confirmation must not repeat the predicted burst');
  hit('players','target-test',base+70,base+140);assert.equal(fx.impacts.length,1);
  hit('players','target-test',base+800,base+800);assert.equal(fx.impacts.length,2,'a later hit still produces feedback');
  hit('trees','tree-test',0,base+800);hit('trees','tree-test',base+810,base+810);assert.equal(fx.impacts.at(-1).material,'wood');
  hit('stones','stone-test',base+810,base+810);assert.equal(fx.impacts.at(-1).material,'stone');
  hit('wildAnimals','ghost-test',base+810,base+810,'Shardkin');assert.equal(fx.impacts.at(-1).material,'ethereal');
  const count=fx.impacts.length;hit('wildAnimals','stale-test',base-3000,base+810);assert.equal(fx.impacts.length,count,'old hits do not replay when entering view');
  fx.update(base+850);assert.ok(fx.root.visible&&fx.debris.count>0);fx.update(base+2000);assert.equal(fx.debris.count,0);assert.equal(fx.root.visible,false);
  fx.dispose();kit.dispose();
});

test('apparition hits flash only the affected rig and emit species-colored wisps once',()=>{
  const kit=new ModelKit(),fx=new CombatEffects3d(kit),now=7000000;
  for(const [i,species] of ['Shorebound','Shardkin','DrownedWatch'].entries()){
    const id=`flash-${species}`,rig=new AnimalRig(kit,species),neighbor=new AnimalRig(kit,species);
    const source=[];rig.root.traverse(o=>{if(o instanceof Mesh)source.push([o,o.material]);});
    fx.observe('wildAnimals',id,0n,400,400,0,species,now);
    recordPredictedCombatHit('wildAnimals',id,now+10);
    fx.observe('wildAnimals',id,0n,400,400,0,species,now+10);
    assert.equal(fx.isHitFlashing('wildAnimals',id,now+10),true);
    rig.setHitFlash(true,fx.apparitions.flashMaterial);
    assert.ok(source.length>0);for(const [mesh] of source)assert.equal(mesh.material,fx.apparitions.flashMaterial);
    neighbor.root.traverse(o=>{if(o instanceof Mesh)assert.notEqual(o.material,fx.apparitions.flashMaterial,'other entities retain their shared materials');});
    const bursts=fx.apparitions.activeCount;
    fx.observe('wildAnimals',id,BigInt(now+30)*1000n,400,400,0,species,now+40);
    assert.equal(fx.apparitions.activeCount,bursts,'server confirmation must not replay predicted hit');
    rig.setHitFlash(fx.isHitFlashing('wildAnimals',id,now+190),fx.apparitions.flashMaterial);
    for(const [mesh,original] of source)assert.equal(mesh.material,original,'original per-part materials are restored');
    assert.equal(fx.isHitFlashing('wildAnimals',id,now+190),false);
    assert.equal(fx.apparitions.bursts.at(-1).species,species);
    assert.notDeepEqual(APPARITION_PALETTES[species],APPARITION_PALETTES[['Shorebound','Shardkin','DrownedWatch'][(i+1)%3]]);
  }
  fx.update(now+70);assert.ok(fx.apparitions.wisps.count>=36);assert.equal(fx.debris.count,0,'apparitions use wisps instead of generic debris');
  fx.update(now+900);assert.equal(fx.apparitions.wisps.count,0);assert.equal(fx.root.visible,false);
  fx.dispose();kit.dispose();
});

test('apparition death bursts use the event position and species, deduplicate and expire',()=>{
  const kit=new ModelKit(),fx=new ApparitionEffects3d(kit),now=8000000;
  const event={id:'death-1',species:'DrownedWatch',x:480,y:240,timestamp:now};
  fx.observeDeaths([event],now,()=>true,()=>.16);fx.observeDeaths([event],now+30,()=>true,()=>.16);
  assert.equal(fx.activeCount,1);assert.equal(fx.bursts[0].species,'DrownedWatch');
  assert.equal(fx.bursts[0].x,10);assert.equal(fx.bursts[0].y,.16);
  fx.update(now+30);assert.equal(fx.wisps.count,98,'large apparition emits 80 wisps and 18 white flashes');
  fx.update(now+200);assert.ok(fx.wisps.count>0&&fx.wisps.count<=80);
  fx.observeDeaths([{...event,id:'hidden'}],now+200,()=>false,()=>0);
  fx.observeDeaths([{...event,id:'stale',timestamp:now-2000}],now+200,()=>true,()=>0);
  assert.equal(fx.activeCount,1,'hidden and stale deaths do not appear');
  fx.update(now+901);assert.equal(fx.activeCount,0);assert.equal(fx.wisps.count,0);
  fx.dispose();kit.dispose();
});

test('combat camera shake is bounded, temporary and never mutates the logical camera offset',()=>{
  const base={x:100,y:-50};recordPredictedCombatHit('barrels','camera-test',2000000);
  const shake=predictedImpactCameraShake(2000040),shown=combatCameraOffset(base,4,-3,2000040);
  assert.ok(Math.hypot(shake.x,shake.y)>0&&Math.hypot(shake.x,shake.y)<4);
  assert.deepEqual(shown,{x:104+shake.x,y:-53+shake.y});assert.deepEqual(base,{x:100,y:-50});
  assert.deepEqual(combatCameraOffset(base,0,0,2000200),base);
});

test('a destroyed target still emits its final impact before its model disappears',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),now=3000000;
  const row={posX:400,posY:400,health:0,lastHitTime:{microsSinceUnixEpoch:BigInt(now)*1000n}};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},nowMs:now,tables:{barrels:new Map([['destroyed-feedback-test',row]])}};
  const seen=new Set();renderer.syncTable('barrels',frame,.016,0,seen,[]);
  assert.equal(seen.size,0);assert.equal(renderer.combatEffects.impacts.length,1);assert.equal(renderer.combatEffects.impacts[0].material,'wood');
  await renderer.dispose();
});

test('terrain worker requests coalesce, reject obsolete results and stop after disposal',()=>{
  const sent=[],listeners={},completed=[];let terminated=false;
  const port={postMessage:job=>sent.push(job),addEventListener:(name,callback)=>listeners[name]=callback,terminate:()=>terminated=true};
  const queue=new TerrainBuildQueue(port,(result,tiles,reason)=>completed.push({result,tiles,reason}),message=>assert.fail(message));
  const tiles=[{worldX:0,worldY:0,tileType:{tag:'Sea'}}],result=buildTerrain(tiles);
  queue.request(tiles,'window');queue.request([],'obsolete');queue.request(tiles,'latest');
  assert.equal(sent.length,1);
  listeners.message({data:{id:sent[0].id,result}});
  assert.equal(sent.length,2);assert.equal(completed.length,0);
  listeners.message({data:{id:sent[1].id,result}});
  assert.equal(completed[0].reason,'latest');
  queue.request(tiles,'disposed');queue.dispose();
  listeners.message({data:{id:sent[2].id,result}});
  assert.equal(completed.length,1);assert.equal(terminated,true);
});

test('worker-built terrain retains continuous projected anchors and its normals match indexed triangle normals',()=>{
  const tiles=[];for(let y=0;y<12;y++)for(let x=0;x<16;x++)tiles.push({worldX:x,worldY:y,tileType:{tag:x<5?'Beach':x<10?'Sea':'DeepSea'}});
  const result=buildTerrain(tiles),geometry=createTerrainGround(tiles,(x,y)=>{
    const gx=x/48-result.field.minX-.5,gy=y/48-result.field.minY-.5;
    const at=(a,b)=>result.field.data[(Math.max(0,Math.min(result.field.height-1,b))*result.field.width+Math.max(0,Math.min(result.field.width-1,a)))*4+3]/255*4;
    const ix=Math.floor(gx),iy=Math.floor(gy),fx=gx-ix,fy=gy-iy;
    return (at(ix,iy)*(1-fx)+at(ix+1,iy)*fx)*(1-fy)+(at(ix,iy+1)*(1-fx)+at(ix+1,iy+1)*fx)*fy;
  });
  assert.deepEqual(geometry.attributes.position.array,result.ground.positions);
  const workerNormals=result.ground.normals;geometry.computeVertexNormals();
  for(let i=0;i<workerNormals.length;i++)assert.ok(Math.abs(workerNormals[i]-geometry.attributes.normal.array[i])<1e-5);
  for(let i=0;i<result.ground.positions.length;i+=3){
    const p=result.ground.positions,uv=result.ground.coordinates;
    assert.ok(Math.abs(p[i]-uv[i/3*2])<1e-5);
    assert.ok(Math.abs((p[i+2]-p[i+1]/Math.tan(WORLD_3D.elevationRadians))/GROUND_Y_SCALE-uv[i/3*2+1])<1e-5);
  }
  geometry.dispose();
});

test('unfamiliar render layouts compile asynchronously before drawing while prepared scenery continues',async()=>{
  const kit=new ModelKit(),scene=new Scene(),camera=new OrthographicCamera(),warmup=new PipelineWarmup3d();
  const group=new Group();kit.part(group,'box',0x445566,[1,1,1],[0,0,0]);scene.add(group);
  const mesh=group.children[0],second=mesh.clone();group.add(second);
  let complete,calls=0;const renderer={compileAsync:(object,cam,target)=>{
    calls++;assert.equal(object.visible,true);assert.equal(object.frustumCulled,false);assert.equal(target,scene);
    return new Promise(resolve=>complete=resolve);
  }};
  const restore=warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail);
  assert.equal(calls,1);assert.equal(mesh.visible,false);assert.equal(second.visible,false);
  restore();assert.equal(mesh.visible,true);assert.equal(mesh.frustumCulled,true);
  warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail)();assert.equal(calls,1,'only one compilation may be in flight');
  complete();await new Promise(resolve=>setImmediate(resolve));
  const restoreReady=warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail);
  assert.equal(mesh.visible,true);assert.equal(second.visible,true);assert.equal(calls,1,'clones reuse the prepared material/layout');restoreReady();
  warmup.dispose();kit.dispose();
});

test('unlit light effects are prepared in advance without becoming visible or recompiling when lit',async()=>{
  const kit=new ModelKit(),scene=new Scene(),camera=new OrthographicCamera(),warmup=new PipelineWarmup3d();
  const fire=new Group();fire.name='fire';fire.visible=false;scene.add(fire);
  const flame=kit.part(fire,'cone',0xffaa33,[1,1,1],[0,0,0],true);
  let finish,calls=0;
  const renderer={compileAsync:object=>{
    calls++;assert.equal(object,flame);assert.equal(object.visible,true);assert.equal(fire.visible,false);
    return new Promise(resolve=>finish=resolve);
  }};
  warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail,[fire])();
  assert.equal(calls,1);assert.equal(fire.visible,false);assert.equal(flame.visible,true);
  warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail,[fire])();assert.equal(calls,1);
  finish();await new Promise(resolve=>setImmediate(resolve));
  fire.visible=true;
  const restore=warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail,[]);
  assert.equal(flame.visible,true);assert.equal(calls,1);restore();
  fire.visible=false;warmup.prepare(scene,camera,renderer,scene,'lit',assert.fail,[fire])();
  assert.equal(fire.visible,false);assert.equal(calls,1);
  await warmup.dispose();kit.dispose();
});

test('direct model-slot compilation preserves Three.js transformed vertices and normals under nested nonuniform scale',()=>{
  const kit=new ModelKit(),root=new Group(),nested=new Group();root.add(nested);
  root.position.set(2,-1,4);root.rotation.set(.1,.4,-.2);nested.rotation.set(.3,-.2,.6);nested.scale.set(.6,1.7,.8);
  const source=kit.part(nested,'cone',0x456789,[.3,.8,.4],[.2,.4,-.3]);source.rotation.set(.6,.8,.1);
  root.updateMatrixWorld(true);
  const reference=source.geometry.clone().applyMatrix4(source.matrixWorld),compiled=kit.compile(root).children[0].geometry;
  for(const name of ['position','normal']){
    const a=compiled.attributes[name].array,b=reference.attributes[name].array;
    assert.equal(a.length,b.length);for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-b[i])<1e-6,`${name} at ${i}`);
  }
  reference.dispose();kit.dispose();
});

test('static pigment batching preserves linear paint colors and emissive parts while reducing opaque draws',()=>{
  const kit=new ModelKit(),root=new Group();
  kit.part(root,'box',0xcc5533,[1,1,1],[0,0,0]);kit.part(root,'cone',0x33aa66,[1,2,1],[1,0,0]);kit.part(root,'rock',0x3355aa,[1,1,1],[2,0,0]);
  kit.part(root,'cone',0xffaa22,[.1,.3,.1],[3,0,0],true);
  const source=kit.compile(root),colored=kit.compileColored(source);
  assert.equal(source.children.length,4);assert.equal(colored.children.length,2);
  const pigment=colored.children.find(mesh=>mesh.material.vertexColors),glow=colored.children.find(mesh=>!mesh.material.vertexColors);
  assert.equal(glow.material.emissive.getHex(),0xffaa22);
  const colors=pigment.geometry.attributes.color.array,expected=source.children.filter(m=>m.material.emissive.getHex()===0);
  let offset=0;
  for(const mesh of expected)for(let i=0;i<mesh.geometry.attributes.position.count;i++){
    for(const channel of ['r','g','b'])assert.ok(Math.abs(colors[offset++]-mesh.material.color[channel])<1e-7);
  }
  const second=kit.compileColored(source);assert.equal(second.children.find(m=>m.material.vertexColors).material,pigment.material,'all static pigments share the same shader material');
  kit.dispose();
});
test('streamed terrain stays fixed across tile crossings, reacts to chunk content and covers the zoomed view with a filter halo', () => {
  const chunks = streamingChunks(), window = new TerrainWindow3d();
  const first = window.update(chunks,terrainFrame(40,40));
  assert.equal(first.reason,'window');
  for (let i = 0; i < 80; i++) {
    const f = window.update(chunks,terrainFrame(40+i/10,40+i/10));
    assert.equal(f.reason,'none'); assert.equal(f.tiles,first.tiles);
  }
  assert.equal(window.update(chunks,terrainFrame(48,48)).reason,'window');
  const changed = chunks.get('6,6'); changed.tileTypes[0] = 13;
  const tilled = window.update(chunks,terrainFrame(48,48));
  assert.equal(tilled.reason,'tiles'); assert.equal(tilled.tiles.find(t=>t.worldX===48 && t.worldY===48).tileType.tag,'Tilled');
  chunks.delete('6,6');
  assert.equal(window.update(chunks,terrainFrame(48,48)).reason,'tiles','chunk departure invalidates the field');
  chunks.set('6,6',changed);
  assert.equal(window.update(chunks,terrainFrame(48,48)).reason,'tiles','late chunk arrival fills missing terrain');
  const f = terrainFrame(48,48,.5), wide = window.update(chunks,f);
  assert.equal(wide.reason,'window');
  const xs = wide.tiles.map(t=>t.worldX), ys=wide.tiles.map(t=>t.worldY);
  assert.ok(Math.min(...xs) <= 48-f.width/48/.5/2-9);
  assert.ok(Math.max(...xs)+1 >= 48+f.width/48/.5/2+9);
  assert.ok(Math.min(...ys) <= 48-f.height/48/.5/2-9);
  assert.ok(Math.max(...ys)+1 >= 48+f.height/48/.5/2+9);
});

test('the renderer reuses actual terrain GPU resources within a streamed window and ignores visible-map ordering', async () => {
  const renderer = new WebGpuWorldRenderer({dataset:{},style:{}}), chunks=streamingChunks();
  const frame = {...terrainFrame(40,40),tables:{worldChunkDataMap:chunks}};
  assert.equal(renderer.updateTerrain(frame),'window');
  const geometry = renderer.terrain.geometry, field = renderer.terrainMaterials.field.image.data;
  for (let i = 1; i <= 7; i++) {
    assert.equal(renderer.updateTerrain({...frame,...terrainFrame(40+i,40+i)}),'none');
    assert.equal(renderer.terrain.geometry,geometry); assert.equal(renderer.terrainMaterials.field.image.data,field);
  }
  let disposed = 0; geometry.addEventListener('dispose',()=>disposed++);
  chunks.get('5,5').tileTypes[0] = 14;
  assert.equal(renderer.updateTerrain(frame),'tiles'); assert.equal(disposed,1);
  const tiles = new Map([[1,{worldX:0,worldY:0,tileType:{tag:'Sea'}}],[2,{worldX:1,worldY:0,tileType:{tag:'Beach'}}]]);
  renderer.updateTerrain({...frame,tables:{visibleWorldTiles:tiles}});
  assert.equal(renderer.updateTerrain({...frame,tables:{visibleWorldTiles:new Map([...tiles].reverse())}}),'none');
  await renderer.dispose();
});

test('copied profiler data includes real cadence, full WebGPU costs, separate weather and explicitly sourced GPU timing', async () => {
  const s = {frame:7,startMs:100,cpuMs:34,cameraMs:1,terrainMs:12,waterMs:2,entitiesMs:5,batchesMs:1,lightingMs:1,submitMs:12,
    terrainRebuilt:1,terrainTiles:2240,terrainReason:'window',newVisuals:4,newPrototypes:2,drawCalls:533,triangles:90000,gpuMs:null,gpuFrame:null,
    frameGapMs:80,preparationMs:3,totalCpuMs:40,weatherMs:.5,uiMs:2.5};
  const timings = webGpuProfilerTimings(s);
  assert.equal(timings.t1-timings.t0,16); assert.equal(timings.t2-timings.t1,2);
  assert.equal(timings.t3g-timings.t3f,.5); assert.equal(timings.worldCacheUpdateMs,12);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis,'navigator'); let copied='';
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text=>{copied=text;}}}});
  try {
    startRecording(); addWebGpuSample(s);
    new FpsProfiler().recordIfActive(timings,s.frameGapMs,23); stopRecording();
    assert.equal(await copyToClipboard(),true);
    assert.match(copied,/Avg Frame: 80\.00ms.*FPS: 12\.5/);
    assert.match(copied,/WebGPU Profiler Recording \(1 samples\)/);
    assert.match(copied,/Max terrain: 12\.00ms.*weather: 0\.50ms/);
    assert.match(copied,/GPU time is asynchronous timestamp-query work/);
    const csv = copied.split('\n').find(line=>line.startsWith('7.000,100.000,'));
    assert.ok(csv.includes('90000.000,,,80.000'),'unsupported GPU timing stays blank, never fabricated from CPU time');
  } finally {
    stopRecording(); if (descriptor) Object.defineProperty(globalThis,'navigator',descriptor); else delete globalThis.navigator;
  }
});
import { readFile } from 'node:fs/promises';
import { Box3, Group, Mesh, OrthographicCamera, Quaternion, Vector3, Scene, Matrix4, Raycaster } from 'three/webgpu';
import { SHELTER_PROFILES, ShelterRig, ShelterVisibility, shelterOwnerInside } from '../client/src/engine/presentation/world3d/shelterModels.ts';
import { COASTAL_DROP_MODELS, createDroppedModel } from '../client/src/engine/presentation/world3d/droppedModels.ts';
import { VILLAGE_BUILDINGS, VILLAGE_PROPS, villageAsset } from '../client/src/engine/presentation/world3d/villagePlans.ts';
import { createVillageModel, VillageRig } from '../client/src/engine/presentation/world3d/villageModels.ts';
import { worldToScene, sceneToWorld, seedFromId, seededRandom, GROUND_Y_SCALE, WORLD_3D } from '../client/src/engine/presentation/world3d/visualContract.ts';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { createTree, createRock, createCampfire } from '../client/src/engine/presentation/world3d/environmentModels.ts';
import { createFoundationModel as createFoundation, createWallModel, createFenceModel, DoorRig } from '../client/src/engine/presentation/world3d/buildingModels.ts';
import { planFoundation, planBoundary, pointOnFoundation, polygonArea, BUILDING } from '../client/src/engine/presentation/world3d/buildingPlan.ts';
import { createStorageModel, STORAGE_MODELS } from '../client/src/engine/presentation/world3d/storageModels.ts';
import { createAlkBuilding, createAlkTurret, ALK_PLANS } from '../client/src/engine/presentation/world3d/alkModels.ts';
import { COMPOUND_BUILDINGS, getWorldCenter } from '../client/src/config/compoundBuildings.ts';
import { createFurnace, createBarbecue, createLantern, createHearth, createBrothPot, createSleepingBag, createStash, createShelter, createRainCollector } from '../client/src/engine/presentation/world3d/campModels.ts';
import { SurvivorRig } from '../client/src/engine/presentation/world3d/survivor.ts';
import { AnimalRig, AUTHORED_ANIMAL_SPECIES } from '../client/src/engine/presentation/world3d/animals.ts';
import { WebGpuWorldRenderer } from '../client/src/engine/presentation/world3d/WebGpuWorldRenderer.ts';
import { WebGpuWorldSurface } from '../client/src/engine/presentation/world3d/WebGpuWorldSurface.ts';
import { StaticWorldBatches } from '../client/src/engine/presentation/world3d/StaticWorldBatches.ts';
import { resolveWorldRenderer } from '../client/src/engine/presentation/world3d/rendererRollout.ts';
import { GameCanvasPointerRuntime } from '../client/src/engine/runtime/gameCanvasPointerRuntime.ts';
import { groundOffset, groundPosition, insideShelter } from '../client/src/engine/presentation/world3d/groundAnchor.ts';
import { getTreeCollisionOffset, getBarrelCollisionOffset, SHELTER_DIMS } from '../client/src/config/entityGroundGeometry.ts';
import { createInspectionWorld } from '../client/src/engine/presentation/world3d/inspectionWorld.ts';
import { pixelCameraPlan } from '../client/src/engine/presentation/world3d/pixelCamera.ts';
import { SwimmingEffects3d } from '../client/src/engine/presentation/world3d/SwimmingEffects3d.ts';
import { PLANT_PROFILES } from '../client/src/engine/presentation/world3d/plantCatalog.ts';
import { createPlant } from '../client/src/engine/presentation/world3d/plantModels.ts';
import { createWeapon, WEAPON_MODELS } from '../client/src/engine/presentation/world3d/weaponModels.ts';
import { TREE_PROFILES } from '../client/src/engine/presentation/world3d/treeModels.ts';
import { ANIMAL_PROFILES } from '../client/src/engine/presentation/world3d/animals.ts';
import { NATURAL_OBJECT_TABLES, createRuneStone, createCairn, createCoral, createKelp, createGeologicalObject } from '../client/src/engine/presentation/world3d/naturalObjects.ts';
import { WaterWorld3d, WATER_DEPTH, seabedAnchor, waterDoodad } from '../client/src/engine/presentation/world3d/WaterWorld3d.ts';
import { TERRAIN_KINDS, TerrainMaterials3d, createPaintedAtlases, createTerrainField } from '../client/src/engine/presentation/world3d/terrainMaterials.ts';
import { createTerrainGround } from '../client/src/engine/presentation/world3d/terrainGround.ts';
import { createBuoy, floatingPose } from '../client/src/engine/presentation/world3d/buoy.ts';
import { resolveClientCollision, getCollisionShapesForDebug } from '../client/src/utils/clientCollision.ts';
import { getVillageCampfireCollisionShapes } from '../client/src/utils/monumentCollision.ts';
import { villageWallSegments } from '../client/src/config/villageGeometry.ts';

test('surface swimmers pass over coral; only the local diver collides, including after surfacing and harvest', () => {
  const localId = 'coral-swimmer';
  const localPlayer = { identity: { toHexString: () => localId }, positionX: 870, positionY: 1000, isOnWater: true, isSnorkeling: false };
  const coral = { id: 1n, posX: 1000, posY: 1060, health: 500, respawnAt: { microsSinceUnixEpoch: 0n } };
  const entities = Object.fromEntries(['trees', 'stones', 'runeStones', 'cairns', 'boxes', 'rainCollectors', 'furnaces', 'barbecues', 'shelters',
    'players', 'wildAnimals', 'barrels', 'seaStacks', 'wallCells', 'foundationCells', 'homesteadHearths', 'basaltColumns', 'doors', 'livingCorals'].map(key => [key, new Map()]));
  entities.players.set(localId, localPlayer);
  entities.players.set('another-diver', { identity: { toHexString: () => 'another-diver' }, isSnorkeling: true, isOnline: false });
  entities.livingCorals.set('1', coral);
  const walk = (startX, endX) => {
    let x = startX, collided = false;
    for (let step = 0; step < 80 && x < endX; step++) {
      const result = resolveClientCollision(x, 1000, Math.min(endX, x + 4), 1000, localId, entities, () => true);
      x = result.x; collided ||= result.collided;
    }
    return { x, collided };
  };
  const debug = () => getCollisionShapesForDebug(entities, 1000, 1000, localId, () => true).filter(shape => shape.type.startsWith('living_coral-'));
  assert.deepEqual(walk(870, 1130), { x: 1130, collided: false }, 'surface swimming ignores coral even while another player is diving');
  assert.equal(debug().length, 0);
  localPlayer.isSnorkeling = true;
  const submerged = walk(870, 1130);
  assert.ok(submerged.collided && submerged.x < 1000, 'the same reef blocks a submerged player');
  assert.equal(debug().length, 1);
  localPlayer.isSnorkeling = false;
  assert.deepEqual(walk(submerged.x, 1130), { x: 1130, collided: false }, 'surfacing releases the reef immediately without cached collision');
  localPlayer.isSnorkeling = true; coral.respawnAt.microsSinceUnixEpoch = 100n;
  assert.deepEqual(walk(870, 1130), { x: 1130, collided: false }, 'a fully harvested reef is passable underwater too');
  assert.equal(debug().length, 0);
  entities.players.delete(localId); coral.respawnAt.microsSinceUnixEpoch = 0n;
  assert.deepEqual(walk(870, 1130), { x: 1130, collided: false }, 'an absent local row must not borrow another diver\'s collision state');
});

test('every terrain has a unique seamless painterly albedo, relief normal and roughness identity', () => {
  const atlas = createPaintedAtlases(), signatures = new Set();
  assert.equal(TERRAIN_KINDS.length, 15);
  for (let i = 0; i < TERRAIN_KINDS.length; i++) {
    let low = 255, high = 0, tilted = 0, roughLow = 255, roughHigh = 0;
    const sample = (x, y) => ((Math.floor(i / 4) * 136 + 4 + y) * atlas.size + i % 4 * 136 + 4 + x) * 4;
    const signature = [];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const p = sample(x, y); low = Math.min(low, atlas.albedo[p]); high = Math.max(high, atlas.albedo[p]);
      roughLow = Math.min(roughLow, atlas.albedo[p + 3]); roughHigh = Math.max(roughHigh, atlas.albedo[p + 3]);
      if (Math.abs(atlas.normal[p] - 127) > 1 || Math.abs(atlas.normal[p + 2] - 127) > 1) tilted++;
      if (x % 16 === 0 && y % 16 === 0) signature.push(...atlas.albedo.slice(p, p + 3));
    }
    assert.ok(high - low >= 8 && tilted > 100, `${TERRAIN_KINDS[i]} needs visible pigment and relief`);
    assert.ok(roughLow >= 150 && roughHigh > roughLow, `${TERRAIN_KINDS[i]} roughness must follow relief`);
    const key = signature.join(','); assert.ok(!signatures.has(key)); signatures.add(key);
    for (let y = 0; y < 128; y++) {
      assert.deepEqual(atlas.albedo.slice(sample(-1, y), sample(-1, y) + 4), atlas.albedo.slice(sample(127, y), sample(127, y) + 4), 'atlas gutters must wrap the same surface');
    }
  }
});

test('the signed coastline is derived from authoritative tiles and remains stable across map ordering', () => {
  const tiles = [];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) tiles.push({ worldX: x + 100, worldY: y + 200, tileType: { tag: x < 7 ? 'Beach' : 'Sea' } });
  const a = createTerrainField(tiles), b = createTerrainField([...tiles].reverse());
  assert.deepEqual(a.data, b.data); assert.equal(a.coast.get('106,205'), -.5); assert.equal(a.coast.get('107,205'), .5);
  assert.ok(a.coast.get('112,205') > a.coast.get('108,205'));
  const water = new WaterWorld3d(new ModelKit()); water.rebuild(tiles);
  const surface = water.root.getObjectByName('Sea-surface');
  assert.ok(surface.count > tiles.filter(t => t.tileType.tag === 'Sea').length, 'surface includes coastal swash cells');
  water.dispose();
});

test('the beach and ocean shelf are a continuous sloped mesh with preserved world anchors', () => {
  const tiles = [];
  for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) tiles.push({ worldX: x, worldY: y, tileType: { tag: x < 7 ? 'Beach' : x < 17 ? 'Sea' : 'DeepSea' } });
  const materials = new TerrainMaterials3d(); materials.rebuild(tiles);
  const geometry = createTerrainGround(tiles, (x, y) => materials.depthAt(x, y));
  const p = geometry.attributes.position, uv = geometry.attributes.terrainCoordinate, n = geometry.attributes.normal;
  assert.ok(p.count < geometry.index.count / 2, 'neighbors share seam vertices');
  let submerged = 0, slopes = 0;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Math.abs(p.getX(i) - uv.getX(i)) < 1e-5);
    assert.ok(Math.abs(p.getZ(i) * Math.sin(WORLD_3D.elevationRadians) - p.getY(i) * Math.cos(WORLD_3D.elevationRadians) - uv.getY(i)) < 1e-5);
    assert.ok(n.getY(i) > .05, 'shelf must not fold or turn inside out');
    if (p.getY(i) < -.02) submerged++;
    if (Math.abs(n.getX(i)) + Math.abs(n.getZ(i)) > .03) slopes++;
  }
  assert.ok(submerged > 100 && slopes > 100);
  let previous = materials.depthAt(3 * 48, 9 * 48);
  for (let x = 3; x < 29; x += .25) {
    const depth = materials.depthAt(x * 48, 9 * 48); assert.ok(Math.abs(depth - previous) < .2, 'depth changes continuously across shallow/deep tile boundary'); previous = depth;
  }
  assert.ok(materials.depthAt(27 * 48, 9 * 48) > materials.depthAt(13 * 48, 9 * 48) + 1);
  geometry.dispose(); materials.dispose();
});

test('variant-6 buoys bob and switch the red beacon and point light with the original night cycle', async () => {
  const kit = new ModelKit(); auditMeshes(createBuoy(kit)); kit.dispose();
  assert.notDeepEqual(floatingPose(0, 400, 400), floatingPose(1, 400, 400));
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, tables: { worldState: { cycleProgress: .4 }, barrels: new Map([['buoy', { posX: 400, posY: 400, variant: 6, health: 100 }]]) } };
  let lights = []; renderer.syncTable('barrels', frame, .016, 0, new Set(), lights);
  const visual = renderer.visuals.get('barrels:buoy'); assert.equal(visual.root.userData.staticBatch, undefined);
  assert.equal(visual.root.getObjectByName('buoy-led').visible, false); assert.equal(lights.length, 0);
  const daytime = visual.root.position.y;
  frame.tables.worldState.cycleProgress = .9; lights = []; renderer.syncTable('barrels', frame, .016, 1, new Set(), lights);
  assert.equal(visual.root.getObjectByName('buoy-led').visible, true); assert.equal(lights.length, 1); assert.equal(lights[0].color, 0xff554b);
  assert.notEqual(visual.root.position.y, daytime);
  frame.tables.worldState.cycleProgress = .4; lights = []; renderer.syncTable('barrels', frame, .016, 2, new Set(), lights);
  assert.equal(visual.root.getObjectByName('buoy-led').visible, false); assert.equal(lights.length, 0); await renderer.dispose();
});

test('all 14 authoritative tree species retain distinct seeded growth and solid material budgets', async () => {
  const source = await readFile('server/src/tree.rs', 'utf8');
  const species = [...source.match(/pub enum TreeType \{([\s\S]*?)\n\}/)[1].matchAll(/^\s*(\w+),/gm)].map(m => m[1]);
  assert.deepEqual(Object.keys(TREE_PROFILES).sort(), species.sort());
  const kit = new ModelKit(), signatures = new Set();
  for (const type of species) {
    const model = createTree(kit, type, 73021); auditMeshes(model);
    const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
    assert.ok(size.y > 1 && size.y < 12 && size.x < 7, `${type}: growth bounds`);
    assert.equal(model.userData.treeSpecies, type); assert.ok(model.userData.growth.branchCount >= 20);
    let triangles = 0, signature = '';
    model.traverse(o => { if (o instanceof Mesh) { triangles += o.geometry.attributes.position.count / 3; signature += Array.from(o.geometry.attributes.position.array).slice(0, 120).join(','); assert.ok(signedVolume(o) > 0, type); } });
    assert.ok(triangles < 18000 && model.children.length <= 7, `${type}: ${triangles} triangles / ${model.children.length} slots`);
    assert.ok(!signatures.has(signature), `${type} shares a species silhouette`); signatures.add(signature);
  }
  assert.throws(() => createTree(kit, 'FutureTree', 0), /Unfinished tree/); kit.dispose();
});

test('every tree variant exposes a substantial trunk through the production depth transform and camera', () => {
  const elevation = WORLD_3D.elevationRadians, vertex = new Vector3(), zoom = .7;
  const camera = new OrthographicCamera(-1280 / 96, 1280 / 96, 720 / 96, -720 / 96, .1, 160);
  camera.position.set(0, Math.sin(elevation) * 50, Math.cos(elevation) * 50);
  camera.lookAt(0, 0, 0); camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const prominentTrunks = new Set(['DwarfPine', 'MountainHemlockSnow', 'KrummholzSpruce', 'CrabAppleTree', 'HazelnutTree', 'RowanberryTree', 'OliveTree']);
  for (const [type, profile] of Object.entries(TREE_PROFILES)) {
    const kit = new ModelKit();
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 73021, 0xffffffff]) {
      const tree = createTree(kit, type, seed);
      const presentation = new Group(); presentation.scale.z = GROUND_Y_SCALE; presentation.add(tree);
      let crownFloorPixels = Infinity;
      for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        tree.rotation.y = yaw; presentation.updateMatrixWorld(true);
        tree.traverse(mesh => {
          if (!(mesh instanceof Mesh) || [profile.bark, 0x505954].includes(mesh.material.color.getHex())) return;
          const positions = mesh.geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(camera);
            crownFloorPixels = Math.min(crownFloorPixels, vertex.y * 720 / 2);
          }
        });
      }
      tree.rotation.y = 0; presentation.updateMatrixWorld(true);
      const label = `${type}, seed ${seed}`;
      assert.ok(crownFloorPixels >= profile.trunkClearance * Math.cos(elevation) * WORLD_3D.tilePixels * zoom - 1e-4, `${label}: actual camera projection leaves the trunk clear after depth compensation`);
      assert.ok(crownFloorPixels >= (prominentTrunks.has(type) ? 45 : type === 'ArcticWillow' ? 30 : 40), `${label}: the trunk remains prominent even at far zoom (${crownFloorPixels.toFixed(1)}px)`);
      const bounds = new Box3().setFromObject(presentation);
      assert.ok(bounds.min.y < .02 && bounds.min.y > -.1, `${label}: roots remain on the ground`);
      assert.ok(bounds.max.y <= 12, `${label}: fits the taller-tree culling budget`);
      for (const height of [.3, profile.trunkClearance * .6]) {
        const target = new Vector3(0, height, 0), direction = new Vector3(0, -Math.sin(elevation), -Math.cos(elevation));
        const hit = new Raycaster(target.clone().addScaledVector(direction, -20), direction).intersectObject(presentation, true)[0];
        assert.ok(hit, `${label}: trunk is solid at ${height}`);
        assert.ok([profile.bark, 0x505954].includes(hit.object.material.color.getHex()), `${label}: camera sees bark below the canopy`);
      }
      const batched = kit.compileColored(tree);
      const batchedBounds = new Box3().setFromObject(batched);
      assert.ok(batchedBounds.min.distanceTo(bounds.min) < 1e-5 && batchedBounds.max.distanceTo(bounds.max) < 1e-5, `${label}: production batching preserves the extended trunk`);
      assert.equal(batched.userData.treeHeight, tree.userData.treeHeight);
    }
    kit.dispose();
  }
});

test('taller tree crowns remain visible when their roots are below the viewport at every supported zoom', async () => {
  for (const zoom of [.5, .7, 1, 1.6, 2]) {
    const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
    const groundY = 720 + 300 * zoom;
    const tree = { posX: 640, posY: groundY + 68, health: 100, treeType: { tag: 'MountainHemlock2' } };
    const frame = { width: 1280, height: 720, zoom, cameraOffset: { x: 0, y: 360 - groundY + (groundY - 360) / zoom }, tables: { trees: new Map([['tall-tree', tree]]) } };
    const seen = new Set();
    renderer.syncTable('trees', frame, .016, 0, seen, []);
    assert.ok(seen.has('trees:tall-tree'), `zoom ${zoom}: visible crown is not culled with its offscreen roots`);
    await renderer.dispose();
  }
});

test('all authoritative animals have walk/run, event attacks and grounded terminal corpse poses', async () => {
  const source = await readFile('server/src/wild_animal_npc/core.rs', 'utf8');
  const species = [...source.match(/pub enum AnimalSpecies \{([\s\S]*?)\n\}/)[1].matchAll(/^\s*(\w+),/gm)].map(m => m[1]);
  assert.deepEqual(Object.keys(ANIMAL_PROFILES).sort(), species.sort());
  const kit = new ModelKit();
  const transforms = rig => { const m = []; rig.root.updateMatrixWorld(true); rig.root.traverse(o => { if (o instanceof Mesh) m.push(...o.matrixWorld.elements); }); return m.map(v => v.toFixed(5)).join(','); };
  for (const type of species) {
    const rig = new AnimalRig(kit, type), p = ANIMAL_PROFILES[type]; auditMeshes(rig.root);
    for (let i = 0; i < 60; i++) rig.update(p.runSpeed * .25, 0, 1 / 60, i / 60, false, false, { attackAge: -1 });
    const walk = transforms(rig); assert.equal(rig.root.userData.animation.state, 'walk', type);
    for (let i = 0; i < 60; i++) rig.update(p.runSpeed * 1.1, 0, 1 / 60, i / 60, false, false, { attackAge: -1 });
    assert.equal(rig.root.userData.animation.state, 'run', type); assert.notEqual(transforms(rig), walk, `${type}: run pose`);
    rig.update(0, 0, .05, 2, false, false, { attackAge: p.attackSeconds * .45 });
    assert.equal(rig.root.userData.animation.state, 'attack', type);
    rig.update(0, 0, .05, 3, false, false, { attackAge: 10 }); assert.notEqual(rig.root.userData.animation.state, 'attack', `${type}: expired attack`);
    rig.update(0, .7, .05, 3, true, false, { deathAge: .2 }); assert.equal(rig.root.userData.animation.state, 'death', type);
    rig.update(0, .7, .05, 4, true, false, { deathAge: 2 }); assert.equal(rig.root.userData.animation.state, 'corpse', type);
    assert.ok(Math.abs(new Box3().setFromObject(rig.root).min.y) < .00001, `${type}: corpse must touch ground`);
    const corpse = transforms(rig); rig.update(0, .7, 0, 50, true, false, { deathAge: 50 }); assert.equal(transforms(rig), corpse, `${type}: terminal pose must stop`);
  }
  kit.dispose();
});

test('natural world objects have solid geometry and living corals obey depletion', async () => {
  const kit = new ModelKit();
  for (const type of ['Green', 'Red', 'Blue']) auditMeshes(createRuneStone(kit, type, 3));
  auditMeshes(createCairn(kit, 3, 'alpine')); auditMeshes(createKelp(kit, 3));
  for (let i = 0; i < 4; i++) auditMeshes(createCoral(kit, i, 3));
  for (const [kind, variant] of [['seaStacks', 'Tall'], ['seaStacks', 'Wide'], ['basaltColumns', 'Type1'], ['basaltColumns', 'Type2'], ['fumaroles', ''], ['roadLampposts', '']]) auditMeshes(createGeologicalObject(kit, kind, variant, 3));
  kit.dispose();
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const row = { posX: 400, posY: 400, health: 100, respawnAt: { microsSinceUnixEpoch: 0n } };
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, tables: { livingCorals: new Map([['3', row]]) } };
  let seen = new Set(); renderer.syncTable('livingCorals', frame, .016, 0, seen, []);
  assert.ok(seen.has('livingCorals:3')); assert.equal(renderer.unfinished.size, 0);
  row.respawnAt.microsSinceUnixEpoch = 100n; seen = new Set(); renderer.syncTable('livingCorals', frame, .016, 1, seen, []); assert.equal(seen.size, 0);
  assert.ok(NATURAL_OBJECT_TABLES.includes('runeStones')); await renderer.dispose();
});

test('memory shard resources, dropped shards and ore use distinct emissive models and pooled light',async()=>{
  const kit=new ModelKit(),resource=createPlant(kit,'MemoryShard',1),drop=createDroppedModel(kit,'Memory Shard',1),ore=createRock(kit,'Memory',1);
  for(const model of [resource,drop,ore]){
    auditMeshes(model);let emissive=false;
    model.traverse(o=>{if(o instanceof Mesh && o.material.emissive?.getHex())emissive=true;});
    assert.ok(emissive,'each model has luminous geometry');
  }
  assert.equal(resource.userData.memoryShardKind,'resource');assert.equal(drop.userData.memoryShardKind,'pickup');assert.equal(ore.userData.memoryOre,true);
  assert.ok(new Box3().setFromObject(resource).getSize(new Vector3()).y>1,'harvestable shard is much larger than the old .36-unit bars');
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  const plant={posX:400,posY:400,plantType:{tag:'MemoryShard'},respawnAt:{microsSinceUnixEpoch:0n}};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},tables:{harvestableResources:new Map([['p',plant]]),
    droppedItems:new Map([['d',{posX:460,posY:400,itemDefId:7n}]]),itemDefinitions:new Map([['7',{name:'Memory Shard'}]]),
    stones:new Map([['s',{posX:520,posY:400,oreType:{tag:'Memory'},health:100}]]),worldState:{cycleProgress:.5}}};
  const render=()=>{const lights=[];renderer.shardGlow.beginFrame(0);for(const kind of ['harvestableResources','droppedItems','stones'])renderer.syncTable(kind,frame,.016,0,new Set(),lights);renderer.shardGlow.endFrame();return lights;};
  const lights=render();assert.equal(lights.length,3);assert.equal(renderer.shardGlow.halos.count,3);
  assert.equal(renderer.visuals.get('droppedItems:d').root.children[0].userData.itemName,'Memory Shard');
  plant.respawnAt.microsSinceUnixEpoch=1n;assert.equal(render().length,2);assert.equal(renderer.shardGlow.halos.count,2);
  const fire={position:new Vector3(100,0,0),color:0xffaa33,intensity:7};
  renderer.updateLighting(frame,0,[...lights,fire]);assert.equal(renderer.lights[0].intensity,7,'ordinary fire keeps priority when the fixed light pool is busy');
  await renderer.dispose();kit.dispose();
});

test('destroyed trees follow the existing fall timeline and scatter species-colored debris at the sound impact',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  const tree={posX:400,posY:400,health:100,treeType:{tag:'SiberianBirch'}};
  let falling=false,progress=0;
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},nowMs:10000,tables:{trees:new Map([['42',tree]]),
    isTreeFalling:()=>falling,getFallProgress:()=>progress,fallingTrees:new Map([['42',{startTime:10000}]])}};
  const sync=()=>{const seen=new Set();renderer.treeFallEffects.beginFrame();renderer.syncTable('trees',frame,.016,0,seen,[]);renderer.treeFallEffects.endFrame();return seen;};
  assert.ok(sync().has('trees:42'));const visual=renderer.visuals.get('trees:42'),model=visual.root.children[0];
  assert.equal(model.rotation.z,0);tree.health=0;falling=true;progress=.5;frame.nowMs=11250;
  assert.ok(sync().has('trees:42'));assert.equal(renderer.visuals.get('trees:42'),visual);
  assert.ok(model.rotation.z<-.7&&model.rotation.z>-.9);assert.equal(renderer.treeFallEffects.leaves.count,0);
  progress=.9928;frame.nowMs=10000+TREE_IMPACT_MS;sync();
  assert.ok(Math.abs(model.rotation.z+Math.PI/2)<1e-9);assert.equal(renderer.treeFallEffects.leaves.count,16);assert.equal(renderer.treeFallEffects.dirt.count,12);
  frame.nowMs+=1401;sync();assert.equal(renderer.treeFallEffects.leaves.count,0);assert.equal(renderer.treeFallEffects.dirt.count,0);
  falling=false;assert.equal(sync().has('trees:42'),false,'a previously destroyed tree must not replay when discovered later');
  tree.health=100;assert.ok(sync().has('trees:42'));assert.equal(model.rotation.z,0,'respawn restores the upright tree');
  await renderer.dispose();
});

test('tree landing follows actual spatial audio start and playback rate, with stale events rejected',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  const row={posX:520,posY:520,health:0,treeType:{tag:'SitkaSpruce'}};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},nowMs:10050,tables:{trees:new Map([['43',row]]),
    isTreeFalling:()=>true,getFallProgress:()=>.01,fallingTrees:new Map([['43',{startTime:10000}]])}};
  recordTreeFallPlayback(520,520,1.25,10050);
  assert.equal(treeFallPlayback(520,520,20000),undefined);assert.equal(treeFallPlayback(521,520,10000),undefined);
  const sync=()=>{renderer.treeFallEffects.beginFrame();renderer.syncTable('trees',frame,.016,0,new Set(),[]);renderer.treeFallEffects.endFrame();};
  sync();const visual=renderer.visuals.get('trees:43');assert.equal(visual.treeAudio.playbackRate,1.25);
  frame.nowMs=10050+TREE_IMPACT_MS/1.25-1;sync();assert.equal(renderer.treeFallEffects.leaves.count,0);
  frame.nowMs+=1;sync();assert.equal(renderer.treeFallEffects.leaves.count,16);
  assert.ok(Math.abs(visual.root.children[0].rotation.z+Math.PI/2)<1e-9);
  await renderer.dispose();
});

test('submerged fumaroles sit on the seabed, have an animated vent and never cast a campfire shadow',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  renderer.terrainMaterials.depthAt=()=>1.35;
  renderer.waterTiles.set('8,8','Sea');
  const row={posX:400,posY:400,isSubmerged:true};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},tables:{fumaroles:new Map([['vent',row]])}};
  renderer.syncTable('fumaroles',frame,.016,0,new Set(),[]);
  const vent=renderer.visuals.get('fumaroles:vent');
  assert.ok(vent.root.position.y < -1);assert.ok(vent.root.getObjectByName('volcanic-vent'));
  assert.equal(vent.root.getObjectByName('fire'),undefined);
  vent.root.traverse(object=>{if(object.isMesh)assert.equal(object.castShadow,false);});
  const particle=vent.root.getObjectByName('vent-emission').children[0], y=particle.position.y;
  renderer.syncTable('fumaroles',frame,.016,.5,new Set(),[]);assert.notEqual(particle.position.y,y);
  row.isSubmerged=false;renderer.syncTable('fumaroles',frame,.016,1,new Set(),[]);
  assert.equal(renderer.visuals.get('fumaroles:vent').root.position.y,0);
  await renderer.dispose();
});

test('diving places the player below water and replaces floating objects with overhead silhouettes',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});renderer.diving=true;
  renderer.terrainMaterials.depthAt=()=>1.35;renderer.waterTiles.set('8,8','Sea');renderer.waterTiles.set('8,6','Sea');
  const player={positionX:400,positionY:400,isOnWater:true,isSnorkeling:true,direction:'down'};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},localPlayerId:'local',predictedPosition:{x:400,y:400},tables:{
    players:new Map([['local',player]]),barrels:new Map([['buoy',{posX:400,posY:400,variant:6,health:100}]]),worldState:{cycleProgress:.9}}};
  renderer.underwater.beginFrame(renderer.camera,true,0);
  renderer.syncTable('players',frame,.016,0,new Set(),[]);
  const visual=renderer.visuals.get('players:local');assert.ok(visual.root.position.y < -.5);
  assert.equal(renderer.swimmingEffects.slots.filter(slot=>slot.active).length,0);
  const lights=[];renderer.syncTable('barrels',frame,.016,0,new Set(),lights);renderer.underwater.endFrame();
  assert.equal(renderer.visuals.get('barrels:buoy').root.visible,false);assert.equal(lights.length,0);
  assert.equal(renderer.underwater.silhouettes.count,1);assert.equal(renderer.underwater.overlay.visible,true);
  renderer.diving=false;renderer.underwater.beginFrame(renderer.camera,false,1);
  player.isSnorkeling=false;renderer.syncTable('players',frame,.016,1,new Set(),[]);renderer.syncTable('barrels',frame,.016,1,new Set(),[]);
  renderer.underwater.endFrame();assert.equal(visual.root.position.y,0);
  assert.equal(renderer.visuals.get('barrels:buoy').root.visible,true);assert.equal(renderer.underwater.silhouettes.count,0);
  assert.equal(renderer.underwater.overlay.visible,false);assert.ok(renderer.swimmingEffects.slots.some(slot=>slot.active));
  await renderer.dispose();
});

test('animals entering view repeatedly reuse compiled solids while their articulated poses stay independent', () => {
  const kit = new ModelKit(), first = new AnimalRig(kit, 'TundraWolf'), resources = kit.compiled.size;
  for (let i = 0; i < 20; i++) {
    const next = new AnimalRig(kit, 'TundraWolf'); next.update(4, i, .05, i, false, false, { attackAge: .3 });
    assert.notEqual(next.body, first.body); assert.equal(first.body.rotation.x, 0);
  }
  assert.equal(kit.compiled.size, resources, 'culling/re-entry must not retain new geometry'); kit.dispose();
});

test('corpse rows reuse the live species rig and play death from the authoritative timestamp', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, nowMs: 10000, tables: { wildAnimals: new Map([['42', { posX: 400, posY: 400, species: { tag: 'TundraWolf' }, directionX: 1, directionY: 0 }]]) } };
  renderer.syncTable('wildAnimals', frame, .016, 0, new Set(), []);
  const live = renderer.visuals.get('wildAnimals:42').animal;
  frame.tables.animalCorpses = new Map([['9', { posX: 400, posY: 400, animalSpecies: { tag: 'TundraWolf' }, animalId: 42n, health: 75, deathTime: { microsSinceUnixEpoch: 9900000n } }]]);
  renderer.syncTable('animalCorpses', frame, .016, 1, new Set(), []);
  const corpse = renderer.visuals.get('animalCorpses:9'); assert.equal(corpse.animal, live); assert.equal(live.root.userData.animation.state, 'death');
  frame.nowMs = 12000; renderer.syncTable('animalCorpses', frame, .016, 2, new Set(), []); assert.equal(live.root.userData.animation.state, 'corpse');
  await renderer.dispose();
});

test('water scenery retains overlapping decorations through streaming without duplicate swimming shadows', () => {
  for (const kind of ['Sea', 'DeepSea', 'HotSpringWater']) {
    const b = seabedAnchor(100, 200, kind), projectedY = b.z * Math.sin(WORLD_3D.elevationRadians) - b.y * Math.cos(WORLD_3D.elevationRadians);
    assert.ok(Math.abs(projectedY - 200 / 48) < 1e-10, 'seabed props keep their interaction anchor');
  }
  assert.ok(WATER_DEPTH.DeepSea > WATER_DEPTH.Sea);
  const kit = new ModelKit(), water = new WaterWorld3d(kit), rig = new SurvivorRig(kit), wrapper = new Group(); wrapper.add(rig.root); wrapper.scale.z = GROUND_Y_SCALE;
  rig.update({ speed: 0, sprinting: false, crouching: false, swimming: true, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' }, .05, 0);
  water.beginFrame(0, 1, false);
  let casters = 0; wrapper.traverse(o => { if (o instanceof Mesh && o.castShadow) casters++; }); assert.ok(casters > 5);
  for (const kind of ['Sea', 'DeepSea', 'HotSpringWater']) assert.equal(water.root.getObjectByName(`${kind}-surface`).receiveShadow, false);
  assert.equal(water.root.getObjectByName('swimmer-seafloor-shadow:player'), undefined);
  rig.update({ speed: 4, sprinting: true, crouching: false, swimming: true, dead: false, jump: 0, roll: 0, attack: 0, yaw: 1, weapon: '' }, .05, 1);
  const a = Array.from({ length: 200 }, (_, i) => waterDoodad(i, 17, 'Sea'));
  assert.deepEqual(a, Array.from({ length: 200 }, (_, i) => waterDoodad(i, 17, 'Sea'))); assert.ok(a.some(Boolean));
  assert.equal(waterDoodad(0, 0, 'HotSpringWater'), null);
  const tiles=Array.from({length:200},(_,i)=>({worldX:i,worldY:17,tileType:{tag:'Sea'}}));
  water.rebuild(tiles);const decorations=new Map(water.decorationTiles);
  assert.ok(decorations.size>0);
  water.rebuild(tiles.slice(1));
  for(const [key,model] of water.decorationTiles)if(decorations.has(key))assert.equal(model,decorations.get(key),'overlapping seabed scenery reuses its object and buffers');
  const scales=[...water.decorationTiles.values()].map(m=>m.scale.y);water.rebuild(tiles.slice(1));
  assert.deepEqual([...water.decorationTiles.values()].map(m=>m.scale.y),scales,'repeated updates do not compound the depth scale');
  water.dispose(); kit.dispose();
});

test('every authoritative plant species has deterministic, distinct solid geometry within the asset budget', async () => {
  const source = await readFile('server/src/plants_database.rs', 'utf8');
  const variants = [...source.match(/pub enum PlantType \{([\s\S]*?)\n\}/)[1].matchAll(/^\s*(\w+),/gm)].map(match => match[1]);
  assert.deepEqual(Object.keys(PLANT_PROFILES).sort(), variants.sort(), 'new server species must not silently inherit a generic plant');
  const kit = new ModelKit(), signatures = new Set();
  const fingerprint = root => {
    const parts = [];
    root.traverse(object => {
      assert.ok(!object.isSprite);
      if (!(object instanceof Mesh)) return;
      parts.push([...object.geometry.attributes.position.array].map(value => value.toFixed(5)).join(','));
    });
    return parts.join('|');
  };
  for (const type of variants) {
    const model = createPlant(kit, type, 73021);
    assert.equal(model.userData.plantSpecies, type);
    const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
    assert.ok(size.x > .02 && size.y > .02 && size.z > .02 && Math.max(...size.toArray()) < 3.6, `${type} has finite gameplay-scale bounds`);
    let triangles = 0;
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const { position, normal } = object.geometry.attributes;
      triangles += position.count / 3;
      assert.ok([...position.array, ...normal.array].every(Number.isFinite));
      assert.ok(!object.material.map && object.material.side === 0, 'foliage uses solid lit meshes, not double-sided image cards');
    });
    assert.ok(triangles > 0 && triangles < 12000, `${type}: ${triangles} triangles exceeds the close-view asset budget`);
    assert.ok(model.children.length <= 9, `${type} exceeds the material-slot budget`);
    const signature = fingerprint(model);
    assert.ok(!signatures.has(signature), `${type} duplicates another species' geometry`);
    signatures.add(signature);
    assert.equal(fingerprint(createPlant(kit, type, 73021)), signature);
  }
  assert.throws(() => createPlant(kit, 'UnknownFutureSpecies', 0), /Unfinished plant species/);
  kit.dispose();
});

test('pixel-locked camera keeps world sampling stable and preserves logical aiming at odd viewport sizes', () => {
  for (const [width, height] of [[1280, 720], [1323, 765], [390, 845]]) for (const zoom of [0.7, 1, 1.6]) {
    let previous;
    for (let step = 0; step < 90; step++) {
      const centerX = 16601 + step * 0.13, centerY = 22743 + step * 0.17;
      const plan = pixelCameraPlan(width, height, centerX, centerY, zoom);
      assert.equal(plan.cssWidth / plan.renderWidth, WORLD_3D.pixelScale);
      assert.equal(plan.cssHeight / plan.renderHeight, WORLD_3D.pixelScale);
      const screenX = (16700 - plan.centerX) * zoom + plan.cssWidth / 2 + plan.translateX;
      const screenY = (22800 - plan.centerY) * zoom + plan.cssHeight / 2 + plan.translateY;
      assert.ok(Math.abs(screenX - ((16700 - centerX) * zoom + width / 2)) < 1e-8);
      assert.ok(Math.abs(screenY - ((22800 - centerY) * zoom + height / 2)) < 1e-8);
      if (previous) {
        const rasterDx = (plan.centerX - previous.centerX) * zoom / WORLD_3D.pixelScale;
        const rasterDy = (plan.centerY - previous.centerY) * zoom / WORLD_3D.pixelScale;
        assert.ok(Math.abs(rasterDx - Math.round(rasterDx)) < 1e-8);
        assert.ok(Math.abs(rasterDy - Math.round(rasterDy)) < 1e-8);
      }
      previous = plan;
    }
  }
});

test('swimming pivots stay at one world center through cardinal turns, bobbing, strokes and fast swimming', () => {
  const kit = new ModelKit();
  const rig = new SurvivorRig(kit);
  for (const sprinting of [false, true]) for (const speed of [0, 2, 4.5]) {
    for (let frame = 0; frame < 240; frame++) {
      rig.update({ speed, sprinting, swimming: true, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: Math.floor(frame / 30) * Math.PI / 4, weapon: '' }, 1 / 60, frame / 60);
      rig.root.updateMatrixWorld(true);
      const anchor = rig.waterAnchor.getWorldPosition(new Vector3());
      assert.ok(Math.abs(anchor.x) < 1e-7 && Math.abs(anchor.z) < 1e-7, 'a direction change must not translate the swim center');
      assert.ok(Number.isFinite(anchor.y));
    }
  }
  kit.dispose();
});

test('normal swimming keeps a gentle continuous kick across speeds and eases into sprinting', () => {
  const kit = new ModelKit();
  const pose = { speed: 2, sprinting: false, swimming: true, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' };
  for (const speed of [0, 2, 2.7, 4.5, 8]) {
    const regular = new SurvivorRig(kit);
    for (let i = 0; i < 300; i++) regular.update({ ...pose, speed }, 1 / 60, i / 60);
    const start = regular.swimKickPhase;
    let previous = regular.leftLeg.rotation.x;
    for (let i = 0; i < 360; i++) {
      regular.update({ ...pose, speed }, 1 / 60, 5 + i / 60);
      assert.ok(Math.abs(regular.leftLeg.rotation.x + .2) <= .181, 'normal kicks stay small even above the former fast-swim speed threshold');
      assert.ok(Math.abs(regular.leftLeg.rotation.x - previous) < .007, 'normal kicks move smoothly between rendered frames');
      assert.ok(Math.abs(regular.leftLeg.rotation.x + regular.rightLeg.rotation.x + .4) < 1e-7, 'legs keep alternating through the same continuous stroke');
      previous = regular.leftLeg.rotation.x;
    }
    assert.ok(regular.swimKickPhase - start <= 2.2 * 6 + 1e-7, 'normal kick cycles take at least 2.8 seconds, regardless of travel speed');
  }
  const rig = new SurvivorRig(kit);
  for (let i = 0; i < 300; i++) rig.update(pose, 1 / 60, i / 60);
  const beforeSprint = rig.leftLeg.rotation.x;
  rig.update({ ...pose, sprinting: true }, 1 / 60, 5);
  assert.ok(Math.abs(rig.leftLeg.rotation.x - beforeSprint) < .06, 'starting a sprint eases the range instead of snapping the leg outward');
  for (let i = 1; i < 300; i++) rig.update({ ...pose, sprinting: true }, 1 / 60, 5 + i / 60);
  const sprintPhase = rig.swimKickPhase;
  rig.update({ ...pose, sprinting: true }, 1 / 60, 10);
  assert.ok(Math.abs((rig.swimKickPhase - sprintPhase) * 60 - 9.8) < 1e-7, 'settled sprinting keeps its original cadence');
  assert.ok(Math.abs(rig.leftLeg.rotation.x - (-.2 + Math.sin(rig.swimKickPhase) * .7)) < 1e-7, 'settled sprinting keeps its original kick range');
  let previous = rig.leftLeg.rotation.x;
  for (let i = 0; i < 180; i++) {
    const phase = rig.swimKickPhase;
    rig.update({ ...pose, speed: [0, 2.7, 8][i % 3] }, 1 / 60, 10 + (i + 1) / 60);
    assert.ok(rig.swimKickPhase > phase && rig.swimKickPhase - phase < .17, 'releasing sprint and changing speed never resets the leg cycle');
    assert.ok(Math.abs(rig.leftLeg.rotation.x - previous) < .13, 'releasing sprint eases the leg motion without a pose jump');
    previous = rig.leftLeg.rotation.x;
  }
  kit.dispose();
});

test('world mesh wakes emit while treading and moving, remain behind after movement and expire', () => {
  const effects = new SwimmingEffects3d(16);
  const ownedGeometry = effects.slots.map(slot => slot.mesh.geometry);
  let disposedGeometry = 0;
  ownedGeometry.forEach(geometry => geometry.addEventListener('dispose', () => disposedGeometry++));
  for (let frame = 0; frame < 80; frame++) {
    const time = frame / 60;
    effects.beginFrame(); effects.observe('player', 1000 + frame * 2, 900, Math.PI / 2, 2.5, true, false, false, time); effects.endFrame(time);
  }
  const active = effects.slots.filter(slot => slot.active);
  assert.ok(active.length >= 2 && active.length <= 4, 'wake cadence stays near the former 2–4 arcs per second');
  const oldestX = Math.min(...active.map(slot => slot.root.position.x));
  assert.ok(oldestX < worldToScene(1158, 900).x - 1, 'wakes stay at the emitted world position');
  effects.root.traverse(object => { assert.ok(!object.isSprite); if (object instanceof Mesh) assert.equal(object.material.depthWrite, false); });
  effects.beginFrame(); effects.endFrame(4);
  assert.equal(effects.slots.filter(slot => slot.active).length, 0);
  for (let frame = 0; frame < 80; frame++) {
    const time = 5 + frame / 60;
    effects.beginFrame(); effects.observe('idle', 1000, 900, 0, 0, true, false, true, time); effects.endFrame(time);
  }
  assert.ok(effects.slots.filter(slot => slot.active && slot.idle && slot.hot).length >= 2);
  assert.deepEqual(effects.slots.map(slot => slot.mesh.geometry), ownedGeometry, 'animated width and ripples reuse the pool buffers');
  effects.dispose();
  assert.equal(disposedGeometry, 16, 'each slot releases its owned dynamic geometry exactly once');
});

test('treading hands reach the water surface and fast swimming adopts a horizontal torso', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  const pose = { speed: 0, sprinting: false, swimming: true, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' };
  let surfaced = 0;
  for (let frame = 0; frame < 300; frame++) {
    rig.update(pose, 1 / 60, frame / 60);
    rig.root.updateMatrixWorld(true);
    if (frame >= 60) for (const name of ['left-hand', 'right-hand']) {
      const hand = rig.root.getObjectByName(name).getWorldPosition(new Vector3());
      if (hand.y > -.03) surfaced++;
      assert.ok(name === 'left-hand' ? hand.x < -.6 : hand.x > .6, 'sculling hands spread outside the torso instead of crossing inside it');
    }
  }
  assert.ok(surfaced > 360, 'hands must visibly scull at the waterline, rather than spending the whole idle cycle submerged');
  pose.speed = 4.5; pose.sprinting = true;
  for (let frame = 0; frame < 120; frame++) rig.update(pose, 1 / 60, 5 + frame / 60);
  rig.root.updateMatrixWorld(true);
  const bodyUp = new Vector3(0, 1, 0).transformDirection(rig.root.getObjectByName('survivor-body').matrixWorld);
  assert.ok(bodyUp.y < .4, 'fast swimming should lie forward through the water');
  kit.dispose();
});

test('a swimming torch stays upright in the raised left hand while the right arm keeps swimming', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit), wrapper = new Group();
  wrapper.scale.z = GROUND_Y_SCALE; wrapper.add(rig.root);
  const pose = { speed: 0, sprinting: false, swimming: true, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: 'Torch', torchLit: true };
  for (const speed of [0, 1.5, 4.5]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    pose.speed = speed; pose.sprinting = speed > 4; pose.yaw = yaw;
    for (let i = 0; i < 120; i++) rig.update(pose, 1 / 60, i / 60);
    const handPositions = [], rightRotations = [];
    for (let i = 0; i < 60; i++) {
      rig.update(pose, 1 / 60, 2 + i / 60); wrapper.updateMatrixWorld(true);
      const torch = rig.root.getObjectByName('held-weapon'), left = rig.root.getObjectByName('left-hand');
      assert.equal(torch.parent.name, 'left-hand-socket');
      assert.ok(new Vector3(0, 1, 0).transformDirection(torch.matrixWorld).y > .9999, 'torch shaft points up in world space');
      assert.ok(left.getWorldPosition(new Vector3()).y > .2, 'torch hand remains raised above the water');
      assert.ok(rig.torchFlame.visible && rig.torchFlame.getWorldPosition(new Vector3()).y > .7);
      handPositions.push(left.getWorldPosition(new Vector3()).y);
      rightRotations.push(rig.root.getObjectByName('right-upper-arm').rotation.x);
    }
    assert.ok(Math.max(...handPositions) - Math.min(...handPositions) < .12, 'raised hand does not stroke with the swim cycle');
    assert.ok(Math.max(...rightRotations) - Math.min(...rightRotations) > .1, 'free arm keeps swimming');
  }
  pose.torchLit = false; rig.update(pose, 1 / 60, 4); assert.equal(rig.torchFlame.visible, false);
  pose.swimming = false; rig.update(pose, 1 / 60, 5); assert.equal(rig.root.getObjectByName('held-weapon').parent.name, 'right-hand-socket');
  pose.swimming = true; pose.weapon = 'Stone Hatchet'; rig.update(pose, 1 / 60, 6); assert.equal(rig.root.getObjectByName('held-weapon').parent.name, 'right-hand-socket');
  kit.dispose();
});

test('consumed harvestable plants stop being submitted until the server clears their respawn timestamp', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const row = { posX: 400, posY: 400, plantType: { tag: 'Lingonberries' }, respawnAt: { microsSinceUnixEpoch: 0n } };
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, tables: { harvestableResources: new Map([['plant', row]]) } };
  let seen = new Set();
  renderer.syncTable('harvestableResources', frame, 1 / 60, 0, seen, []);
  assert.ok(seen.has('harvestableResources:plant'));
  row.respawnAt.microsSinceUnixEpoch = 100n;
  seen = new Set(); renderer.syncTable('harvestableResources', frame, 1 / 60, 1, seen, []);
  assert.equal(seen.size, 0);
  row.respawnAt.microsSinceUnixEpoch = 0n;
  renderer.syncTable('harvestableResources', frame, 1 / 60, 2, seen, []);
  assert.ok(seen.has('harvestableResources:plant'));
  await renderer.dispose();
});

test('3D model ground origins preserve existing predicted collision anchors', async () => {
  const cases = [
    ['trees', {}, 0, -68], ['trees', { treeType: { tag: 'RowanberryTree' } }, 0, -88],
    ['trees', { treeType: 'KrummholzSpruce' }, -40, -68], ['stones', {}, 0, -36],
    ['woodenStorageBoxes', { boxType: 0 }, 0, -50], ['woodenStorageBoxes', { boxType: 11 }, 0, -82],
    ['woodenStorageBoxes', { boxType: 12 }, 0, -82], ['furnaces', { furnaceType: 0 }, 0, -50],
    ['furnaces', { furnaceType: 1 }, 0, -80], ['rainCollectors', {}, 0, -30],
    ['homesteadHearths', {}, 0, -72.5], ['shelters', {}, 0, -200],
    ['lanterns', { lanternType: 0 }, 0, -34], ['lanterns', { lanternType: 1 }, 0, -80],
    ['sleepingBags', {}, 0, -48], ['stashes', {}, 0, -24], ['woodenStorageBoxes', { boxType: 14 }, 0, -48],
    ['barrels', { variant: 0 }, 0, -48], ['barrels', { variant: 4 }, 0, -96], ['barrels', { variant: 6 }, 0, -110],
    ['campfires', {}, 0, 0], ['doors', { cellX: 3, cellY: 4 }, 0, 0],
  ];
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  for (const [i, [kind, properties, dx, dy]] of cases.entries()) {
    const row = { posX: 400, posY: 400, ...properties };
    const expected = { x: 400 + dx, y: 400 + dy };
    assert.deepEqual(groundPosition(kind, row), expected);
    renderer.syncTable(kind, { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, tables: { [kind]: new Map([[String(i), row]]) } }, 1 / 60, 0, new Set(), []);
    const position = renderer.visuals.get(`${kind}:${i}`).root.position;
    const scene = worldToScene(expected.x, expected.y);
    assert.ok(Math.abs(position.x - scene.x) < 1e-8 && Math.abs(position.z - scene.z) < 1e-8, `${kind} must apply its offset once`);
  }
  assert.deepEqual(getTreeCollisionOffset({ treeType: { tag: 'KrummholzSpruce' } }), { x: -40, y: -68 });
  assert.deepEqual(getBarrelCollisionOffset({ variant: 0 }, true), { x: 52, y: 0 });
  assert.deepEqual(groundPosition('barrels', { posX: 400, posY: 400, variant: 2 }, true), { x: 452, y: 400 });
  assert.deepEqual(groundPosition('foundationCells', { cellX: 3, cellY: 4 }), { x: 336, y: 432 });
  await renderer.dispose();
});

test('inspection compositions encode stored row anchors and shelter roofs cover the collision footprint', () => {
  const world = createInspectionWorld(73021, 'camp');
  assert.deepEqual(groundPosition('furnaces', world.furnaces.get('kiln')), { x: 13 * 48, y: 12 * 48 });
  const center = groundPosition('shelters', world.shelters.get('tent'));
  assert.deepEqual(center, { x: 29 * 48, y: 17.5 * 48 });
  assert.ok(insideShelter(center.x + 149, center.y + 62, center));
  assert.ok(!insideShelter(center.x + 151, center.y, center));
  const kit = new ModelKit();
  const bounds = new Box3().setFromObject(createShelter(kit, 0));
  assert.ok(bounds.max.x * 48 >= SHELTER_DIMS.HALF_WIDTH && bounds.max.x * 48 < SHELTER_DIMS.HALF_WIDTH+45);
  assert.ok(bounds.max.z * 48 >= SHELTER_DIMS.HALF_HEIGHT && bounds.max.z * 48 < SHELTER_DIMS.HALF_HEIGHT+45);
  kit.dispose();
});

test('all biome shelters cover every protected corner with solid canopy and retain distinct brush construction',()=>{
  const kit=new ModelKit(),signatures=new Set();
  SHELTER_PROFILES.forEach((profile,variant)=>{
    const model=createShelter(kit,variant),roof=model.getObjectByName('shelter-roof');model.updateMatrixWorld(true);
    assert.equal(model.userData.shelterBiome,profile.name);
    let triangles=0;const colors=[];
    model.getObjectByName('shelter-opaque').traverse(o=>{if(o instanceof Mesh){triangles+=o.geometry.attributes.position.count/3;assert.ok(signedVolume(o)>0,'closed, outward solids');const a=o.geometry.getAttribute('color');if(a)colors.push(...Array.from(a.array).slice(0,120));}});
    assert.ok(triangles>1000&&triangles<18000,`${profile.name}: ${triangles} triangles`);signatures.add(colors.join(','));
    for(const x of [-150,-80,0,80,150])for(const z of [-62.5,0,62.5]){
      const ray=new Raycaster(new Vector3(x/48,8,z/48),new Vector3(0,-1,0));
      const hits=ray.intersectObject(roof,true);assert.ok(hits.length&&hits[0].point.y>1.25,`protected roof gap at ${x},${z} for ${profile.name}`);
    }
    const front=new Raycaster(new Vector3(0,.23,62.5/48+.35),new Vector3(0,0,-1),0,.6);
    assert.ok(front.intersectObject(model.getObjectByName('shelter-frame'),true).length,`${profile.name}: sticks cover the middle of the front`);
  });
  assert.equal(signatures.size,4);kit.dispose();
});

test('shelter cutaway leaves an opaque rim outside the protected screen area and keeps visitors concealed',()=>{
  const kit=new ModelKit(),other=new ShelterRig(kit,0);
  const row={posX:1000,posY:1200,placedBy:{toHexString:()=> 'owner'}},inside={x:1000,y:1000},outside={x:1000,y:1070};
  assert.equal(shelterOwnerInside(row,'owner',inside),true);assert.equal(shelterOwnerInside(row,'visitor',inside),false);assert.equal(shelterOwnerInside(row,'owner',outside),false);
  for(let variant=0;variant<4;variant++){
    const first=new ShelterRig(kit,variant),shell=first.root.getObjectByName('shelter-shell');
    const opaque=first.root.getObjectByName('shelter-opaque'),rim=first.root.getObjectByName('shelter-rim');
    first.update(true,1050,1000);assert.equal(shell.visible,true);assert.equal(opaque.visible,false);assert.equal(rim.visible,true);
    let triangles=0;
    rim.traverse(o=>{if(!(o instanceof Mesh))return;const p=o.geometry.getAttribute('position');
      for(let i=0;i<p.count;i+=3){
        const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
        const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
        const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3-y/(Math.tan(WORLD_3D.elevationRadians)*GROUND_Y_SCALE);
        assert.ok(Math.abs(x)>=150/48-1e-5||Math.abs(z)>=62.5/48-1e-5,'cutaway triangles stay outside the projected protected rectangle');triangles++;
      }
    });
    assert.ok(triangles>100,'the visible rim is retained');
    assert.equal(first.root.getObjectByName('cutaway-depth-envelope'),undefined);
    const border=first.root.getObjectByName('shelter-protected-border');assert.equal(border.visible,true);border.updateMatrixWorld(true);
    const bounds=new Box3().setFromObject(border);assert.ok(Math.abs(bounds.max.x-150/48)<.035&&Math.abs(bounds.max.z-62.5/48)<.035);
    first.update(false,1250,1000);assert.equal(border.visible,false);assert.equal(shell.visible,true);assert.equal(opaque.visible,true);assert.equal(rim.visible,false);assert.equal(shell.position.x,0);
    opaque.traverse(o=>{if(o instanceof Mesh){assert.equal(o.material.opacity,1);assert.equal(o.castShadow,true);}});
    rim.traverse(o=>{if(o instanceof Mesh){assert.equal(o.material.opacity,1);assert.equal(o.castShadow,false,'cutaway rim must not shadow the exposed interior');}});
  }
  other.root.traverse(o=>{if(o instanceof Mesh)assert.equal(o.material.opacity,1,'shared source materials must remain opaque');});
  const view=new ShelterVisibility();view.prepare([row],'visitor',outside);assert.equal(view.occludes(1000,1000),true);assert.equal(view.occludes(1151,1000),false);
  view.prepare([row],'owner',inside);assert.equal(view.occludes(1000,1000),false);
  view.prepare([row],'owner',outside);assert.equal(view.occludes(1000,1000),true);
  view.prepare([{...row,isDestroyed:true}],'visitor',inside);assert.equal(view.occludes(1000,1000),false);kit.dispose();
});

test('coastal dropped loot has solid models and the real item-definition lookup replaces coral markers, including late definitions',async()=>{
  const kit=new ModelKit();for(const name of COASTAL_DROP_MODELS){const model=createDroppedModel(kit,name,3);assert.equal(model.userData.itemName,name);let count=0;model.traverse(o=>{if(o instanceof Mesh){count++;assert.ok(signedVolume(o)>0);assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));}});assert.ok(count>0);}
  const unlitTorch=createDroppedModel(kit,'Torch',0);unlitTorch.traverse(o=>{if(o instanceof Mesh)assert.equal(o.material.emissive.getHex(),0,'ground torches use the original unlit dropped-item state');});
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),item={itemDefId:200n,quantity:2,posX:1000,posY:1000};
  const frame={width:1280,height:720,cameraOffset:{x:-360,y:-640},tables:{droppedItems:new Map([['42',item]]),itemDefinitions:new Map()}};
  renderer.syncTable('droppedItems',frame,.016,0,new Set(),[]);
  assert.equal(renderer.visuals.get('droppedItems:42').root.children[0].userData.itemName,'');
  frame.tables.itemDefinitions.set('200',{name:'Coral Fragments'});renderer.syncTable('droppedItems',frame,.016,1,new Set(),[]);
  assert.equal(renderer.visuals.get('droppedItems:42').root.children[0].userData.itemName,'Coral Fragments');assert.equal(renderer.unfinished.has('table:droppedItems'),false);
  await renderer.dispose();kit.dispose();
});

test('the live entity adapter conceals shelter occupants and loot from visitors while collision still admits only the owner',async()=>{
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),shelter={id:1n,posX:1000,posY:1200,placedBy:{toHexString:()=> 'owner'},health:1000};
  const players=new Map([['owner',{identity:{toHexString:()=> 'owner'},positionX:1000,positionY:1000}],['visitor',{identity:{toHexString:()=> 'visitor'},positionX:1000,positionY:1200}]]);
  const frame={width:1280,height:720,cameraOffset:{x:-360,y:-640},localPlayerId:'visitor',predictedPosition:{x:1000,y:1200},tables:{players,droppedItems:new Map([['loot',{itemDefId:1n,posX:1000,posY:1000}]]),itemDefinitions:new Map([['1',{name:'Coral Fragments'}]])}};
  renderer.shelterVisibility.prepare([shelter],'visitor',frame.predictedPosition);
  let seen=new Set();renderer.syncTable('players',frame,.016,0,seen,[]);renderer.syncTable('droppedItems',frame,.016,0,seen,[]);
  assert.equal(seen.has('players:owner'),false);assert.equal(seen.has('players:visitor'),true);assert.equal(seen.has('droppedItems:loot'),false);
  frame.localPlayerId='owner';frame.predictedPosition={x:1000,y:1000};renderer.shelterVisibility.prepare([shelter],'owner',frame.predictedPosition);
  seen=new Set();renderer.syncTable('players',frame,.016,1,seen,[]);renderer.syncTable('droppedItems',frame,.016,1,seen,[]);
  assert.equal(seen.has('players:owner'),true);assert.equal(seen.has('droppedItems:loot'),true);
  const entities=Object.fromEntries(['trees','stones','runeStones','cairns','boxes','rainCollectors','furnaces','barbecues','shelters','players','wildAnimals','barrels','seaStacks','wallCells','foundationCells','homesteadHearths','basaltColumns','doors','livingCorals'].map(key=>[key,new Map()]));
  entities.shelters.set('1',shelter);
  const ownerShapes=getCollisionShapesForDebug(entities,1000,1000,'owner',()=>true),visitorShapes=getCollisionShapesForDebug(entities,1000,1000,'visitor',()=>true);
  assert.equal(ownerShapes.some(s=>s.type.startsWith('shelter-')),false);assert.equal(visitorShapes.some(s=>s.type.startsWith('shelter-')),true);
  await renderer.dispose();
});

test('every current village building and prop has an authored solid model with bounded geometry and preserved source identity',async()=>{
  const kit=new ModelKit();
  const assets=[...Object.keys(VILLAGE_BUILDINGS),...VILLAGE_PROPS];
  for(const asset of assets){
    const model=createVillageModel(kit,asset);assert.equal(model.userData.villageAsset,asset);let triangles=0;
    model.traverse(o=>{if(o instanceof Mesh){triangles+=o.geometry.attributes.position.count/3;assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite),asset);assert.ok(signedVolume(o)>0,`${asset}/${o.name} must be outward and closed`);}});
    assert.ok(triangles>30&&triangles<22000,`${asset}: ${triangles} triangles`);
    assert.equal(villageAsset({imagePath:`doodads/${asset}`}),asset);
  }
  const source=await readFile('server/src/monument.rs','utf8');
  const generated=new Set([...source.matchAll(/"((?:fv|hv|av)_[a-z0-9_]+\.png)"/g)].map(m=>m[1]));
  for(const asset of generated)assert.ok(assets.includes(asset),`missing authoritative village asset ${asset}`);
  kit.dispose();
});

test('village assembly and cutaway construction never submit missing scene objects',()=>{
  const kit=new ModelKit(),original=console.error,errors=[];console.error=(...args)=>errors.push(args.map(String).join(' '));
  try{
    for(const asset of [...Object.keys(VILLAGE_BUILDINGS),...VILLAGE_PROPS]){
      const rig=new VillageRig(kit,asset,createVillageModel(kit,asset));rig.update({x:1000,y:950},{x:1000,y:1000},0,1);
    }
    assert.deepEqual(errors,[]);
  }finally{console.error=original;kit.dispose();}
});

test('every village building uses an opaque projected rim and restores its exterior on exit',()=>{
  const kit=new ModelKit();
  for(const [asset,plan] of Object.entries(VILLAGE_BUILDINGS)){
    const rig=new VillageRig(kit,asset,createVillageModel(kit,asset)),roof=rig.root.getObjectByName('village-roof');
    assert.ok(roof&&roof.children.length>0,`${asset}: an independent roof exists`);
    rig.update({x:1000,y:1000-plan.depth*24},{x:1000,y:1000},0,1);
    assert.equal(rig.root.userData.cutaway,true);
    assert.equal(rig.root.getObjectByName('village-opaque').visible,false,`${asset}: full exterior hides`);
    const rim=rig.root.getObjectByName('village-rim');assert.equal(rim.visible,true);
    let triangles=0;rim.traverse(o=>{if(!(o instanceof Mesh))return;assert.equal(o.material.opacity,1);assert.equal(o.castShadow,false);
      const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i+=3){
        const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3;
        const y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;
        const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3-y/(Math.tan(WORLD_3D.elevationRadians)*GROUND_Y_SCALE);
        assert.ok(Math.abs(x)>=plan.width/2-1e-5||Math.abs(z)>=plan.depth/2-1e-5,`${asset}: opening stays clear`);triangles++;
      }});assert.ok(triangles>0,`${asset}: retains an exterior rim`);
    rig.update({x:1000,y:1100},{x:1000,y:1000},0,2);
    assert.equal(rig.root.getObjectByName('village-opaque').visible,true);assert.equal(rim.visible,false);
  }
  kit.dispose();
});

test('village cutaways preserve open movement anchors, rotate in ground space and do not fade neighboring copies',async()=>{
  const kit=new ModelKit(),asset='hv_lodge.png',prototype=createVillageModel(kit,asset),a=new VillageRig(kit,asset,prototype),b=new VillageRig(kit,asset,prototype);
  const anchor={x:1000,y:1000},plan=VILLAGE_BUILDINGS[asset];
  a.update({x:1000,y:1000-plan.depth*24},anchor,0,1);
  assert.equal(a.root.userData.cutaway,true);assert.equal(a.root.getObjectByName('village-opaque').visible,false);
  const firstRim=a.root.getObjectByName('village-rim');assert.equal(firstRim.visible,true);
  assert.equal(b.root.getObjectByName('village-roof').visible,true,'neighboring roofs stay opaque');
  b.root.getObjectByName('village-shell').traverse(o=>{if(o instanceof Mesh)assert.equal(o.material.opacity,1);});
  a.update({x:1000+plan.depth*24,y:1000},anchor,Math.PI/2,2);assert.equal(a.root.userData.cutaway,true);assert.equal(a.root.rotation.y,-Math.PI/2);assert.equal(firstRim.visible,false);
  const visibleRim=a.root.children[0].children.find(o=>o.name==='village-rim'&&o.visible);assert.ok(visibleRim);
  visibleRim.traverse(o=>{if(!(o instanceof Mesh))return;const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3-(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3/(Math.tan(WORLD_3D.elevationRadians)*GROUND_Y_SCALE);
    const z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    assert.ok(Math.abs(x)>=plan.width/2-1e-5||Math.abs(z)>=plan.depth/2-1e-5,'rotated screen opening remains clear');
  }});
  a.update({x:2000,y:2000},anchor,0,3);assert.equal(a.root.userData.cutaway,false);
  assert.equal(a.root.getObjectByName('village-opaque').visible,true,'the exterior returns when leaving');assert.equal(visibleRim.visible,false);
  const weatherAsset='ws_station.png',weatherModel=createVillageModel(kit,weatherAsset),weatherRig=new VillageRig(kit,weatherAsset,weatherModel),rotors=[];
  weatherRig.root.traverse(o=>{if(o.name==='village-turbine')rotors.push(o);});assert.equal(rotors.length,3);
  const pivots=rotors.map(o=>o.position.toArray());weatherRig.update(null,anchor,0,2);assert.deepEqual(rotors.map(o=>o.position.toArray()),pivots);assert.ok(rotors.every(o=>o.rotation.z===2.8));
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),row={worldX:1000,worldY:1000,imagePath:asset,partType:'lodge',collisionRadius:0,rotationRad:Math.PI/2};
  const frame={width:1280,height:720,cameraOffset:{x:-360,y:-640},tables:{monumentParts:new Map([['village',row]])}};
  renderer.syncTable('monumentParts',frame,.016,0,new Set(),[]);const visual=renderer.visuals.get('monumentParts:village');
  assert.ok(visual.village);assert.equal(visual.root.position.x,1000/48);assert.equal(visual.root.position.z,1000/48*GROUND_Y_SCALE);assert.equal(row.collisionRadius,0);assert.equal(renderer.unfinished.has('table:monumentParts'),false);
  await renderer.dispose();kit.dispose();
});

test('ALK landmarks, facilities, stations and both turret types produce solid 3D models at collision anchors',async()=>{
  const kit=new ModelKit();
  for(const [asset,plan] of Object.entries(ALK_PLANS)){
    const model=createAlkBuilding(kit,asset),bounds=new Box3().setFromObject(model),size=bounds.getSize(new Vector3());
    assert.ok(size.x>=plan.width&&size.y>=plan.height&&size.z>=plan.depth,`${asset} has full architectural mass`);
    let triangles=0;model.traverse(part=>{if(part.isMesh){const position=part.geometry.getAttribute('position');triangles+=(part.geometry.index?.count??position.count)/3;}});
    assert.ok(triangles>100&&triangles<15000,`${asset} has bounded 3D detail`);
    if(asset==='furnace')assert.ok(model.getObjectByName('fire'),'furnace retains a controllable fire');
  }
  for(const monument of [true,false]){
    const model=createAlkTurret(kit,monument);assert.ok(new Box3().setFromObject(model).getSize(new Vector3()).x>1);
  }
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),center=getWorldCenter(),worldX=center.x,worldY=center.y;
  assert.equal(renderer.compoundLandmarks.size,COMPOUND_BUILDINGS.length);
  const tables={compoundLandmarks:renderer.compoundLandmarks,
    alkStations:new Map([['0',{stationId:0,worldPosX:worldX,worldPosY:worldY,isActive:true}],['1',{stationId:1,worldPosX:worldX+500,worldPosY:worldY,isActive:true}],['2',{stationId:2,worldPosX:worldX,worldPosY:worldY,isActive:false}]]),
    turrets:new Map([['monument',{posX:worldX+400,posY:worldY,isMonument:true}],['player',{posX:worldX+500,posY:worldY,isMonument:false}]]),
    woodenStorageBoxes:new Map([3,5,6].map(t=>[String(t),{posX:worldX+t*10,posY:worldY,isMonument:true,boxType:t}])),
    furnaces:new Map([['furnace',{posX:worldX,posY:worldY,isMonument:true,furnaceType:1,isBurning:true}]]),
    rainCollectors:new Map([['water',{posX:worldX,posY:worldY,isMonument:true}]])};
  const frame={width:4000,height:3000,cameraOffset:{x:2000-worldX,y:1500-worldY},tables},seen=new Set();
  for(const kind of Object.keys(tables))renderer.syncTable(kind,frame,.016,0,seen,[]);
  for(const building of COMPOUND_BUILDINGS)assert.ok(seen.has(`compoundLandmarks:${building.id}`),building.id);
  assert.ok(seen.has('alkStations:0')&&seen.has('alkStations:1'));assert.ok(!seen.has('alkStations:2'));
  for(const key of ['turrets:monument','turrets:player','woodenStorageBoxes:3','woodenStorageBoxes:5','woodenStorageBoxes:6','furnaces:furnace','rainCollectors:water'])assert.ok(seen.has(key),key);
  assert.equal(renderer.unfinished.size,0);
  assert.deepEqual(groundPosition('alkStations',tables.alkStations.get('1')),{x:worldX+500,y:worldY-80});
  assert.deepEqual(groundPosition('turrets',tables.turrets.get('monument')),{x:worldX+400,y:worldY+40});
  assert.ok(renderer.visuals.get('furnaces:furnace').fire.visible);
  await renderer.dispose();kit.dispose();
});

test('village campfire graphics use the larger communal collision circle and its true anchor',()=>{
  const kit=new ModelKit(),model=createVillageModel(kit,'fv_campfire.png'),bounds=new Box3().setFromObject(model),size=bounds.getSize(new Vector3());
  assert.ok(size.x*48>120&&size.x*48<165,'the fire ring should fit the 140px collision circle');
  for(const type of ['FishingVillage','HuntingVillage','AlpineVillage']){
    const part={id:1n,worldX:1000,worldY:1000,partType:'campfire',imagePath:'fv_campfire.png',monumentType:{tag:type},isCenter:type==='FishingVillage',collisionRadius:70,rotationRad:0};
    const shapes=getVillageCampfireCollisionShapes(new Map([['1',part]]),1000,872);
    assert.equal(shapes.length,1);assert.deepEqual(groundPosition('monumentParts',part),{x:shapes[0].x,y:shapes[0].y});
    assert.equal(shapes[0].radius,70);assert.equal(shapes[0].y,872);
  }
  kit.dispose();
});

test('shared authored collision geometry matches the model and server reference cases',async()=>{
  const geometry=JSON.parse(await readFile('shared/config/collisionGeometry.json','utf8'));
  assert.equal(geometry.version,1);
  assert.deepEqual(Object.keys(VILLAGE_BUILDINGS).sort(),Object.keys(geometry.village.buildings).sort());
  for(const [asset,plan] of Object.entries(geometry.village.buildings)){
    assert.equal(VILLAGE_BUILDINGS[asset].form,plan.form);
    assert.equal(VILLAGE_BUILDINGS[asset].width,plan.width);
    assert.equal(VILLAGE_BUILDINGS[asset].depth,plan.depth);
  }
  const row={imagePath:'av_lodge.png',worldX:1000,worldY:1000,rotationRad:0};
  const wall=villageWallSegments(row);assert.equal(wall.length,5);
  assert.ok(Math.abs(wall[0].ax-841.6)<.001);assert.ok(Math.abs(wall[0].by-731.2)<.001);
  row.rotationRad=Math.PI/2;const rotated=villageWallSegments(row);
  assert.ok(Math.abs(rotated[0].ax-1000)<.001);assert.ok(Math.abs(rotated[0].ay-841.6)<.001);
  const round=villageWallSegments({imagePath:'hv_hut2.png',worldX:0,worldY:0,rotationRad:0});
  assert.equal(round.length,23);
  for(const [actual,expected] of [[round[0].ax,58.773565],[round[0].ay,-12.398223],[round[0].bx,78.892983],[round[0].by,-28.442924]])assert.ok(Math.abs(actual-expected)<.001);
  const expected=[[-48,-48,48,-48],[48,-48,48,48],[48,48,-48,48],[-48,48,-48,-48]];
  for(let edge=0;edge<4;edge++){
    const boundary=planBoundary(edge),actual=[...boundary.start,...boundary.end].map(value=>value*geometry.village.tilePixels);
    assert.deepEqual(actual,expected[edge]);
  }
  for(const [shape,edge,expectedEndpoints] of [[2,5,[-48,48,48,-48]],[4,5,[-48,48,48,-48]],[3,4,[-48,-48,48,48]],[5,4,[-48,-48,48,48]]]){
    const boundary=planBoundary(edge,shape);
    assert.deepEqual([...boundary.start,...boundary.end].map(value=>value*geometry.village.tilePixels),expectedEndpoints);
  }
});

test('generated village fires leave buildings and doorway approaches clear',async()=>{
  const source=await readFile('server/src/monument.rs','utf8');
  const alpineOffset=Number(source.match(/const ALPINE_FIRE_OFFSET_Y: f32 = ([\d.]+);/)?.[1]);
  assert.ok(source.includes('center_world_y + ALPINE_FIRE_OFFSET_Y, "av_campfire.png"'));
  assert.ok(source.includes('("campfire", "fv_campfire.png", 100.0, -250.0)'));
  const distanceToSegment=(x,y,{ax,ay,bx,by})=>{
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
    return Math.hypot(x-ax-t*dx,y-ay-t*dy);
  };
  const verify=(type,fire,buildings)=>{
    const parts=new Map();
    parts.set('fire',{id:1n,worldX:fire[0],worldY:fire[1],partType:'campfire',imagePath:type==='AlpineVillage'?'av_campfire.png':'fv_campfire.png',monumentType:{tag:type},isCenter:type==='FishingVillage',collisionRadius:70,rotationRad:0});
    const shape=getVillageCampfireCollisionShapes(parts,fire[0],fire[1]-128)[0];
    for(const [asset,x,y] of buildings){
      const building={id:2n,worldX:x,worldY:y,imagePath:asset,partType:'hut',monumentType:{tag:type},rotationRad:0};
      for(const wall of villageWallSegments(building))assert.ok(distanceToSegment(shape.x,shape.y,wall)>shape.radius+32,`${type} ${asset}: fire intersects a wall`);
      // The first 140 pixels directly outside the doorway must admit a player.
      assert.ok(distanceToSegment(shape.x,shape.y,{ax:x,ay:y,bx:x,by:y+140})>shape.radius+32,`${type} ${asset}: fire blocks the doorway approach`);
    }
  };
  verify('HuntingVillage',[100,-250],[['hv_lodge.png',-250,0],['hv_hut2.png',480,-320],['hv_hut3.png',0,-550]]);
  for(const dx of [0,100])for(const dy of [alpineOffset,450,500])
    verify('AlpineVillage',[dx,dy],[['av_lodge.png',0,0],['av_hut.png',-280,420],['av_banya.png',380,320]]);
  for(let i=0;i<64;i++){
    const a=i*Math.PI*2/64,wx=Math.cos(a),wy=Math.sin(a),sx=-wy,sy=wx;
    const at=(along,toward)=>[wx*toward+sx*along,wy*toward+sy*along];
    verify('FishingVillage',[0,0],[['fv_lodge.png',...at(-480,-500)],['fv_hut2.png',...at(480,-500)],['fv_hut3.png',...at(0,-700)]]);
  }
});

test('all village buildings have solid walls, an accessible doorway and swept collision at every rotation',()=>{
  const entities=Object.fromEntries(['trees','stones','runeStones','cairns','boxes','rainCollectors','furnaces','barbecues','shelters','players','wildAnimals','barrels','seaStacks','wallCells','foundationCells','homesteadHearths','basaltColumns','doors','livingCorals','monumentParts'].map(key=>[key,new Map()]));
  const anchor={x:2000,y:2000};
  for(const [asset,plan] of Object.entries(VILLAGE_BUILDINGS))for(const rotation of [0,Math.PI/2,Math.PI/4]){
    const row={id:42n,worldX:anchor.x,worldY:anchor.y,imagePath:asset,partType:'hut',monumentType:{tag:'FishingVillage'},isCenter:false,collisionRadius:0,rotationRad:rotation};
    entities.monumentParts.set('42',row);
    const point=(x,y)=>({x:anchor.x+x*Math.cos(rotation)-y*Math.sin(rotation),y:anchor.y+x*Math.sin(rotation)+y*Math.cos(rotation)});
    const move=(a,b)=>{const from=point(...a),to=point(...b);return resolveClientCollision(from.x,from.y,to.x,to.y,'local',entities);};
    assert.ok(villageWallSegments(row).length>=5,`${asset}: walls exist`);
    const entrance=move([0,100],[0,-plan.depth*24]);
    assert.equal(entrance.collided,false,`${asset} ${rotation}: doorway must admit the player`);
    const exit=move([0,-plan.depth*24],[0,100]);assert.equal(exit.collided,false,`${asset} ${rotation}: doorway must allow exit`);
    const side=move([plan.width*24+100,-plan.depth*24],[0,-plan.depth*24]);
    assert.equal(side.collided,true,`${asset} ${rotation}: side wall blocks movement`);
    const sideX=(side.x-anchor.x)*Math.cos(rotation)+(side.y-anchor.y)*Math.sin(rotation);
    assert.ok(sideX>plan.width*24+25,`${asset} ${rotation}: player stays outside the side wall`);
    const back=move([0,-plan.depth*48-100],[0,-plan.depth*24]);
    assert.equal(back.collided,true,`${asset} ${rotation}: rear wall blocks movement`);
    const fast=move([plan.width*24+100,-plan.depth*24],[-plan.width*24-100,-plan.depth*24]);
    assert.equal(fast.collided,true,`${asset} ${rotation}: a fast roll cannot tunnel through walls`);
    const fastX=(fast.x-anchor.x)*Math.cos(rotation)+(fast.y-anchor.y)*Math.sin(rotation);
    assert.ok(fastX>plan.width*24+25,`${asset} ${rotation}: fast movement remains on the near side`);
  }
});

test('village walls allow sliding and let a player already overlapping move clear',()=>{
  const entities=Object.fromEntries(['trees','stones','runeStones','cairns','boxes','rainCollectors','furnaces','barbecues','shelters','players','wildAnimals','barrels','seaStacks','wallCells','foundationCells','homesteadHearths','basaltColumns','doors','livingCorals','monumentParts'].map(key=>[key,new Map()]));
  const plan=VILLAGE_BUILDINGS['hv_lodge.png'],half=plan.width*24;
  entities.monumentParts.set('1',{id:1n,worldX:2000,worldY:2000,imagePath:'hv_lodge.png',partType:'lodge',monumentType:{tag:'HuntingVillage'},rotationRad:0,collisionRadius:0});
  const start={x:2000+half+36,y:2000-plan.depth*36};
  const slide=resolveClientCollision(start.x,start.y,start.x-20,start.y+plan.depth*12,'local',entities);
  assert.equal(slide.collided,true);assert.ok(slide.x>2000+half+30);assert.ok(slide.y>start.y+plan.depth*10,'diagonal movement continues along the wall');
  const overlapping={x:2000+half+10,y:2000-plan.depth*24};
  const escape=resolveClientCollision(overlapping.x,overlapping.y,overlapping.x+45,overlapping.y,'local',entities);
  assert.ok(escape.x>=overlapping.x+44,'a player already at a wall can move away');
});

test('presentation scale matches the authoritative world config', async () => {
  const shared = JSON.parse(await readFile('shared/config/gameConfig.json', 'utf8'));
  assert.equal(WORLD_3D.tilePixels, shared.world.tileSizePx);
});

test('orthographic ground projection preserves aiming and placement at all viewport sizes', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [390, 844], [1281, 721]]) {
    for (const [centerX, centerY] of [[960, 720], [1_000_000, 850_000]]) {
      const center = worldToScene(centerX, centerY);
      const camera = new OrthographicCamera(-width / 96, width / 96, height / 96, -height / 96, 0.1, 160);
      camera.position.set(center.x, Math.sin(WORLD_3D.elevationRadians) * 50, center.z + Math.cos(WORLD_3D.elevationRadians) * 50);
      camera.lookAt(center.x, 0, center.z);
      camera.updateMatrixWorld();
      for (const [dx, dy] of [[0, 0], [-120, -90], [230, 110]]) {
        const point = worldToScene(centerX + dx, centerY + dy);
        const screen = new Vector3(point.x, 0, point.z).project(camera);
        assert.ok(Math.abs((screen.x + 1) * width / 2 - (width / 2 + dx)) < 1e-6);
        assert.ok(Math.abs((1 - screen.y) * height / 2 - (height / 2 + dy)) < 1e-6);
        const inverse = sceneToWorld(point.x, point.z);
        assert.ok(Math.abs(inverse.x - centerX - dx) < 1e-7);
        assert.ok(Math.abs(inverse.y - centerY - dy) < 1e-7);
      }
    }
  }
});

test('pointer mapping uses logical pixels on the low-resolution GPU canvas', () => {
  const listeners = new Map();
  const canvas = { width: 640, height: 360,
    getBoundingClientRect: () => ({ left: 50, top: 25, width: 1280, height: 720 }),
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) };
  const runtime = new GameCanvasPointerRuntime();
  runtime.configure({ canvasRef: { current: canvas }, canvasSize: { width: 1280, height: 720 }, cameraOffsetX: -100, cameraOffsetY: -200, isMobile: false });
  listeners.get('mousemove')({ clientX: 150, clientY: 125 });
  assert.deepEqual(runtime.getSnapshot().worldMousePos, { x: 200, y: 300 });
  assert.deepEqual(runtime.getSnapshot().canvasMousePos, { x: 100, y: 100 });
  runtime.stop();
  assert.equal(listeners.size, 0);
});

test('entity-ID variants are deterministic and distinct', () => {
  const a = seededRandom(seedFromId('tree:72'));
  const b = seededRandom(seedFromId('tree:72'));
  const c = seededRandom(seedFromId('tree:73'));
  const sampleA = Array.from({ length: 12 }, () => a());
  assert.deepEqual(sampleA, Array.from({ length: 12 }, () => b()));
  assert.notDeepEqual(sampleA, Array.from({ length: 12 }, () => c()));
});

test('WebGPU is the default and an explicit legacy choice survives authentication', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  values.set('broth:world-presentation-migration', 'legacy');
  assert.equal(resolveWorldRenderer('', storage), 'webgpu');
  assert.equal(resolveWorldRenderer('?worldRenderer=webgpu', storage), 'webgpu');
  assert.equal(resolveWorldRenderer('?code=returned-auth-code', storage), 'webgpu');
  assert.equal(resolveWorldRenderer('?worldRenderer=unknown', storage), 'webgpu');
  assert.equal(resolveWorldRenderer('?worldRenderer=legacy', storage), 'legacy');
  assert.equal(resolveWorldRenderer('?code=returned-auth-code', storage), 'legacy');
  assert.equal(resolveWorldRenderer('?worldRenderer=webgpu', storage), 'webgpu');
  assert.equal(resolveWorldRenderer('', storage), 'webgpu');
  const blockedStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(resolveWorldRenderer('', blockedStorage), 'webgpu');
});

function auditMeshes(group) {
  group.updateMatrixWorld(true);
  let meshes = 0;
  group.traverse(object => {
    assert.ok(!object.isSprite, 'world art cannot be a sprite');
    if (!(object instanceof Mesh)) return;
    meshes++;
    for (const attribute of ['position', 'normal']) {
      const values = object.geometry.getAttribute(attribute).array;
      assert.ok(values.every(Number.isFinite), `non-finite ${attribute}`);
    }
    assert.equal(object.material.map, null, 'initial meshes must not depend on sprite textures');
  });
  assert.ok(meshes > 0);
  const box = new Box3().setFromObject(group);
  assert.ok(!box.isEmpty());
  assert.ok(box.min.toArray().concat(box.max.toArray()).every(Number.isFinite));
}

test('model seeds and species produce finite solid mesh geometry', () => {
  const kit = new ModelKit();
  try {
    for (const species of ['SitkaSpruce', 'SiberianBirch', 'MountainHemlockSnow', 'DwarfPine', 'CrabAppleTree']) {
      for (const seed of [0, 73021, 0xffffffff]) auditMeshes(createTree(kit, species, seed));
    }
    for (const type of ['Stone', 'Metal', 'Sulfur']) auditMeshes(createRock(kit, type, 73021));
    for (const tier of [0, 1, 2, 3]) auditMeshes(createFoundation(kit, tier));
    auditMeshes(createCampfire(kit, 73021));
    for (const species of AUTHORED_ANIMAL_SPECIES) auditMeshes(new AnimalRig(kit, species).root);
  } finally { kit.dispose(); }
});

test('held equipment remains attached to the articulated hand across states', () => {
  const kit = new ModelKit();
  try {
    const rig = new SurvivorRig(kit);
    for (const weapon of ['Stone Hatchet', 'Hunting Bow', 'Wooden Spear', 'Rifle', 'Torch']) {
      for (const state of [{}, { speed: 3, sprinting: true }, { crouching: true }, { swimming: true }, { jump: 0.7 }, { roll: 0.5 }, { attack: 0.4 }, { dead: true }]) {
        rig.update({ speed: 0, sprinting: false, crouching: false, swimming: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 1.3, weapon, ...state }, 1 / 60, 2);
        auditMeshes(rig.root);
        assert.equal(rig.root.getObjectByName('held-weapon').parent.name,
          weapon === 'Hunting Bow' || weapon === 'Torch' && state.swimming ? 'left-hand-socket' : 'right-hand-socket');
      }
    }
  } finally { kit.dispose(); }
});

test('every authoritative weapon has closed solid geometry and its own authored model', async () => {
  const source = await readFile('server/src/items_database/weapons.rs', 'utf8');
  const names = [...source.matchAll(/ItemBuilder::new\("([^"]+)"/g)].map(match => match[1]);
  const kit = new ModelKit();
  for (const name of [...names, 'Combat Ladle', 'Stone Hatchet', 'Metal Hatchet', 'Stone Pickaxe', 'Metal Pickaxe', 'Diving Pick', 'Bone Gaff Hook', 'Torch']) {
    assert.ok(WEAPON_MODELS[name], `${name} needs an authored model, not a substring fallback`);
    const model = createWeapon(kit, name);
    assert.equal(model.userData.unfinishedWeapon, undefined);
    auditMeshes(model);
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      assert.ok(signedVolume(object) > 0, `${name} has an inside-out or open mesh`);
      assert.ok(!object.material.map && !object.isSprite);
    });
    const bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
    assert.ok(Math.max(...size.toArray()) < 3 && Math.min(...size.toArray()) > .015, `${name} has implausible item dimensions`);
  }
  kit.dispose();
});

test('weapon grips stay connected and cutting faces and gun muzzles aim forward through turns and gait', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  const pose = { speed: 0, sprinting: false, swimming: false, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' };
  for (const [weapon, spec] of Object.entries(WEAPON_MODELS)) for (const state of [{}, { speed: 2.8 }, { sprinting: true, speed: 5 }, { crouching: true }, { attack: .4 }, { jump: .7 }]) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      rig.update({ ...pose, ...state, weapon, yaw }, 1 / 30, 2);
      rig.root.updateMatrixWorld(true);
      const model = rig.root.getObjectByName('held-weapon');
      const primary = model.userData.primaryHand === 'left' ? 'left-hand' : 'right-hand';
      const mainPosition = rig.root.getObjectByName(primary).getWorldPosition(new Vector3());
      assert.ok(mainPosition.distanceTo(model.getObjectByName('primary-grip').getWorldPosition(new Vector3())) < .001, `${weapon} main hand misses its grip`);
      const support = model.getObjectByName('support-grip');
      if (support) {
        const hand = rig.root.getObjectByName(primary === 'left-hand' ? 'right-hand' : 'left-hand').getWorldPosition(new Vector3());
        assert.ok(hand.distanceTo(support.getWorldPosition(new Vector3())) < .025, `${weapon} support hand misses its grip by ${hand.distanceTo(support.getWorldPosition(new Vector3()))}`);
      } else assert.ok(spec.hold !== 'longgun' && spec.hold !== 'bow' && spec.hold !== 'staff');
      const edge = model.getObjectByName('outward-edge');
      const muzzle = model.getObjectByName('muzzle');
      const forward = new Vector3(0, 0, 1).transformDirection(rig.root.getObjectByName('survivor-body').matrixWorld);
      if (edge) {
        // Measure from the shaft at the edge's height: measuring from the hand
        // would let a sideways blade pass solely because the handle leans forward.
        const center = model.getObjectByName('strike-center').getWorldPosition(new Vector3());
        assert.ok(edge.getWorldPosition(new Vector3()).sub(center).dot(forward) > .04, `${weapon} cutting/striking side must face forward, not sideways`);
      }
      if (muzzle) assert.ok(muzzle.getWorldPosition(new Vector3()).sub(mainPosition).dot(forward) > .3, `${weapon} muzzle points into the survivor`);
      if (muzzle) assert.ok(Math.abs(new Vector3(0, 0, 1).applyQuaternion(model.getWorldQuaternion(new Quaternion())).y) < 1e-6, `${weapon} aims into the ground while crouching`);
      if (spec.hold === 'pistol') assert.equal(support, undefined, 'pistols retain a free left hand');
    }
  }
  const first = rig.root.getObjectByName('held-weapon');
  rig.update({ ...pose, weapon: 'Combat Ladle' }, 1 / 60, 3);
  rig.update({ ...pose, weapon: 'Revolver' }, 1 / 60, 3);
  assert.equal(rig.root.getObjectByName('held-weapon'), first, 'equipping an existing weapon reuses its owned model');
  kit.dispose();
});

test('actual cutting-head geometry lies in the forward swing plane while the shaft stays fixed', () => {
  const kit = new ModelKit();
  for (const [name, minReach, maxSideWidth] of [
    ['Stone Hatchet', .4, .22], ['Metal Hatchet', .4, .22], ['Battle Axe', .4, .22],
    ['Stone Pickaxe', .4, .15], ['Metal Pickaxe', .4, .15], ['Diving Pick', .4, .15],
    ['Stone Tiller', .4, .35], ['Scythe', .7, .15],
    ['Bush Knife', .14, .12], ['Naval Cutlass', .3, .12], ['AK74 Bayonet', .14, .12],
  ]) {
    const model = createWeapon(kit, name), length = WEAPON_MODELS[name].length;
    let forward = -Infinity, minX = Infinity, maxX = -Infinity, shaftMaxX = -Infinity;
    model.traverse(o => {
      if (!(o instanceof Mesh)) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (y > Math.max(.2, length * .42)) { forward = Math.max(forward, z); minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
        if (y > .01 && y < .1) shaftMaxX = Math.max(shaftMaxX, x);
      }
    });
    assert.ok(forward >= minReach - .001, `${name}: actual blade geometry must extend forward`);
    assert.ok(maxX - minX < maxSideWidth, `${name}: head must not lie across the character's sideways plane`);
    assert.ok(shaftMaxX > .025, `${name}: retain the original handle geometry/orientation`);
  }
  kit.dispose();
});

test('melee weapons remain rigid to the swinging forearm while spears retain a separate forward thrust', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  const pose = { speed: 0, sprinting: false, swimming: false, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '' };
  for (const weapon of ['Combat Ladle', 'Stone Hatchet', 'Metal Hatchet', 'Stone Pickaxe', 'Naval Cutlass', 'Bone Club', 'Repair Hammer', 'Battle Axe', 'War Hammer', 'Engineers Maul', 'Scythe']) {
    let bind;
    for (const attack of [0, .15, .35, .5, .75, .95, 1]) {
      rig.update({ ...pose, weapon, attack, yaw: attack * .8 }, 1 / 60, 2);
      rig.root.updateMatrixWorld(true);
      const forearm = rig.root.getObjectByName('right-forearm').getWorldQuaternion(new Quaternion());
      const item = rig.root.getObjectByName('held-weapon').getWorldQuaternion(new Quaternion());
      const relative = forearm.invert().multiply(item);
      if (bind) assert.ok(bind.angleTo(relative) < 1e-6, `${weapon} rotates independently of the swinging arm`);
      else bind = relative.clone();
    }
  }
  const spearRig = new SurvivorRig(kit);
  spearRig.update({ ...pose, weapon: 'Wooden Spear' }, 1 / 60, 3);
  spearRig.root.updateMatrixWorld(true);
  const rest = spearRig.root.getObjectByName('primary-grip').getWorldPosition(new Vector3());
  spearRig.update({ ...pose, weapon: 'Wooden Spear', attack: .5 }, 1 / 60, 3);
  spearRig.root.updateMatrixWorld(true);
  assert.ok(spearRig.root.getObjectByName('primary-grip').getWorldPosition(new Vector3()).z - rest.z > .08, 'spear attacks keep the forward reach instead of inheriting the axe swing');
  kit.dispose();
});

test('resting melee weapons rise up and forward along the drawn 45-degree side-view guide, with upright fire', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit);
  const wrapper = new Group(); wrapper.scale.z = GROUND_Y_SCALE; wrapper.add(rig.root);
  const pose = { speed: 0, sprinting: false, swimming: false, crouching: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: '', torchLit: true };
  for (const weapon of ['Combat Ladle', 'Stone Hatchet', 'Metal Hatchet', 'Bone Knife', 'Repair Hammer', 'Torch', 'War Hammer', 'Wooden Spear']) {
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      rig.update({ ...pose, weapon, yaw }, 1 / 60, 2);
      wrapper.updateMatrixWorld(true);
      const model = rig.root.getObjectByName('held-weapon');
      const axis = new Vector3(0, 1, 0).transformDirection(model.matrixWorld);
      const forward = new Vector3(Math.sin(rig.root.rotation.y), 0, Math.cos(rig.root.rotation.y) * GROUND_Y_SCALE).normalize();
      const sideways = new Vector3(-forward.z, 0, forward.x);
      assert.ok(axis.y > .5 && axis.dot(forward) > .3, `${weapon} needs an upward/forward pitch`);
      assert.ok(Math.abs(axis.dot(sideways)) < 1e-6, `${weapon} tilts sideways instead of up`);
      if (weapon === 'Torch') {
        const fireUp = new Vector3(0, 1, 0).transformDirection(rig.torchFlame.matrixWorld);
        assert.ok(fireUp.distanceTo(new Vector3(0, 1, 0)) < 1e-6, 'torch fire rises upright from the angled wick');
      }
    }
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      const sideRig = new SurvivorRig(kit), sideWrapper = new Group(); sideWrapper.scale.z = GROUND_Y_SCALE; sideWrapper.add(sideRig.root);
      sideRig.update({ ...pose, weapon, yaw }, 1 / 60, 2); sideWrapper.updateMatrixWorld(true);
      const model = sideRig.root.getObjectByName('held-weapon');
      const camera = new OrthographicCamera(-10, 10, 10, -10, .1, 100);
      camera.position.set(0, Math.sin(WORLD_3D.elevationRadians) * 10, Math.cos(WORLD_3D.elevationRadians) * 10);
      camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
      const a = model.localToWorld(new Vector3()).project(camera);
      const b = model.localToWorld(new Vector3(0, .7, 0)).project(camera);
      assert.ok(Math.abs(Math.atan2(b.y - a.y, Math.abs(b.x - a.x)) - Math.PI / 4) < 1e-6, `${weapon} does not match the upward 45-degree image guide`);
    }
  }
  kit.dispose();
});

test('the server torch flag controls both the held flame and the WebGPU light source without replacing the model', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const player = { identity: 'test', positionX: 400, positionY: 400, isTorchLit: false };
  const equipment = { equippedItemDefId: 1n };
  const frame = { width: 1280, height: 720, cameraOffset: { x: 0, y: 0 }, localPlayerId: 'test',
    tables: { players: new Map([['test', player]]), activeEquipments: new Map([['test', equipment]]), itemDefinitions: new Map([['1', { name: 'Torch' }], ['2', { name: 'Combat Ladle' }]]) } };
  const sync = () => { const lights = []; renderer.syncTable('players', frame, 1 / 60, 1, new Set(), lights); return lights; };
  assert.equal(sync().length, 0);
  const torch = renderer.visuals.get('players:test').survivor.root.getObjectByName('held-weapon');
  assert.equal(torch.getObjectByName('held-torch-flame').visible, false);
  player.isTorchLit = true;
  assert.equal(sync().length, 1);
  assert.equal(torch.getObjectByName('held-torch-flame').visible, true);
  player.isTorchLit = false;
  assert.equal(sync().length, 0);
  assert.equal(torch.getObjectByName('held-torch-flame').visible, false);
  equipment.equippedItemDefId = 2n; player.isTorchLit = true;
  assert.equal(sync().length, 0, 'switching away from a lit torch cannot leave a light behind');
  await renderer.dispose();
});

test('headlamp follows the animated survivor and illuminates only while lit and alive', async () => {
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}});
  const player={identity:'test',positionX:400,positionY:400,isHeadlampLit:false,direction:'down'};
  const frame={width:1280,height:720,cameraOffset:{x:0,y:0},localPlayerId:'test',predictedPosition:{x:400,y:400},
    tables:{players:new Map([['test',player]]),activeEquipments:new Map([['test',{headItemInstanceId:123n}]]),
      inventoryItems:new Map([['123',{itemDefId:99n}]]),itemDefinitions:new Map([['99',{name:'Headlamp'}]])}};
  const sync=()=>{const lights=[];renderer.syncTable('players',frame,1/60,1,new Set(),lights);return lights;};
  assert.equal(sync().length,0);
  const survivor=renderer.visuals.get('players:test').survivor;
  assert.equal(survivor.headlampFlame.visible,false);
  player.isHeadlampLit=true;
  let lights=sync();assert.equal(lights.length,1);assert.equal(lights[0].distance,10);assert.equal(survivor.headlampFlame.visible,true);
  assert.ok(lights[0].position.distanceTo(survivor.headlampWorldPosition(new Vector3()))<1e-6);
  const before=lights[0].position.clone();frame.predictedPosition={x:496,y:400};lights=sync();
  assert.ok(Math.abs(lights[0].position.x-before.x-2)<1e-5,'light follows predicted movement');
  renderer.updateLighting(frame,0,lights);assert.equal(renderer.lights[0].distance,10);assert.ok(renderer.lights[0].intensity>0);
  player.isHeadlampLit=false;assert.equal(sync().length,0);assert.equal(survivor.headlampFlame.visible,false);
  renderer.updateLighting(frame,0,[]);assert.equal(renderer.lights[0].intensity,0);assert.equal(renderer.lights[0].distance,5);
  player.isHeadlampLit=true;player.isDead=true;assert.equal(sync().length,0);
  player.isDead=false;player.isSnorkeling=true;assert.equal(sync().length,0);
  await renderer.dispose();
});

test('headlamp toggles propagate immediately through player table updates', () => {
  let updates=0;
  const refs={playersRef:{current:new Map()},lastPlayerRenderTimeRef:{current:performance.now()},playerRenderPendingRef:{current:false},playerRenderTimerRef:{current:null}};
  const bindings=createCombatTableBindings({...refs,setPlayers:()=>updates++});
  const old={identity:{toHexString:()=> 'player'},health:100,stamina:100,hunger:100,thirst:100,warmth:100,isHeadlampLit:false};
  bindings.player.onUpdate({},old,{...old,isHeadlampLit:true});
  assert.equal(updates,1);assert.equal(refs.playerRenderTimerRef.current,null);
});

test('keyboard sprint follows either held shift during manual and auto-walk movement', () => {
  const keys=new Set(['KeyW','ShiftLeft']);
  assert.equal(keyboardMovement(keys,null).sprinting,true);
  keys.add('ShiftRight');keys.delete('ShiftLeft');assert.equal(keyboardMovement(keys,null).sprinting,true);
  keys.delete('ShiftRight');assert.equal(keyboardMovement(keys,null).sprinting,false);
  keys.clear();const auto={x:0,y:-1};
  assert.deepEqual(keyboardMovement(keys,auto),{direction:auto,sprinting:false});
  keys.add('ShiftLeft');assert.equal(keyboardMovement(keys,auto).sprinting,true);
  keys.delete('ShiftLeft');assert.deepEqual(keyboardMovement(keys,auto),{direction:auto,sprinting:false});
});

test('released sprint overrides stale server state in prediction and movement updates', () => {
  const sent=[];
  const connection={db:{active_consumable_effect:{iter:()=>[]}},reducers:{updatePlayerPositionSimple:args=>{sent.push(args);return Promise.resolve();}}};
  const entities=Object.fromEntries(['trees','stones','runeStones','cairns','boxes','rainCollectors','furnaces','barbecues','shelters','players','wildAnimals','barrels','seaStacks','wallCells','foundationCells','homesteadHearths','basaltColumns','doors','livingCorals','monumentParts'].map(key=>[key,new Map()]));
  const input={current:{direction:{x:1,y:0},sprinting:true}};
  const player={identity:{toHexString:()=> 'sprint-test'},positionX:4000,positionY:4000,direction:'right',isSprinting:true,isDead:false,isKnockedOut:false,isCrouching:false,isOnWater:false,jumpStartTimeMs:0};
  const config={connection,localPlayer:player,inputState:input.current,inputStateRef:input,isUIFocused:false,entities,isAutoWalking:false,stopAutoWalk:()=>{},isAutoAttacking:false};
  movementPredictionRuntime.configure(config);
  const start=movementPredictionRuntime.clientPosition.x;movementPredictionRuntime.lastSentTime=0;
  movementPredictionRuntime.stepPredictedMovement(20);const afterSprint=movementPredictionRuntime.clientPosition.x;
  assert.equal(sent.at(-1).isSprinting,true);
  input.current={direction:{x:1,y:0},sprinting:false};movementPredictionRuntime.lastSentTime=0;
  movementPredictionRuntime.stepPredictedMovement(20);const afterRelease=movementPredictionRuntime.clientPosition.x;
  assert.equal(sent.at(-1).isSprinting,false,'the next server update stops sprinting');
  assert.ok(afterSprint-start > (afterRelease-afterSprint)*1.5,'prediction returns to walking speed despite stale server sprint state');
  movementPredictionRuntime.configure({...config,mobileSprintOverride:true});movementPredictionRuntime.lastSentTime=0;
  movementPredictionRuntime.stepPredictedMovement(20);assert.equal(sent.at(-1).isSprinting,true,'mobile sprint remains independently controlled');
  movementPredictionRuntime.configure({...config,mobileSprintOverride:false});movementPredictionRuntime.lastSentTime=0;
  movementPredictionRuntime.stepPredictedMovement(20);assert.equal(sent.at(-1).isSprinting,false);
  movementPredictionRuntime.configure({...config,localPlayer:null});
});

function signedVolume(mesh) {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const positions = geometry.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let volume = 0;
  for (let i = 0; i < positions.count; i += 3) {
    a.fromBufferAttribute(positions, i); b.fromBufferAttribute(positions, i + 1); c.fromBufferAttribute(positions, i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  if (geometry !== mesh.geometry) geometry.dispose();
  return volume;
}

test('every foundation shape/tier has the right footprint and outward closed volume', () => {
  const kit = new ModelKit();
  try {
    for (let tier = 0; tier <= 3; tier++) for (let shape = 1; shape <= 5; shape++) {
      const plan = planFoundation(shape, tier);
      assert.equal(polygonArea(plan.footprint), shape === 1 ? 4 : 2);
      const model = createFoundation(kit, tier, shape);
      auditMeshes(model);
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        assert.ok(signedVolume(object) > 0, `inward foundation ${tier}/${shape}`);
        const p = object.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) assert.ok(pointOnFoundation(shape, p.getX(i), p.getZ(i)), 'panel crosses a triangle boundary');
      });
    }
    assert.equal(createFoundation(kit, 0, 0).children.length, 0);
  } finally { kit.dispose(); }
});

test('walls and fences follow all cardinal edges and triangle hypotenuses', () => {
  const kit = new ModelKit();
  try {
    for (let tier = 0; tier < 4; tier++) {
      for (let edge = 0; edge < 4; edge++) {
        const plan = planBoundary(edge);
        assert.equal(plan.length, BUILDING.cellSize);
        const wall = createWallModel(kit, tier, edge);
        auditMeshes(wall);
        const bounds = new Box3().setFromObject(wall);
        if (edge === 1 || edge === 3) assert.ok(bounds.max.z - bounds.min.z > 1.95 && bounds.max.x - bounds.min.x < 0.4);
        else assert.ok(bounds.max.x - bounds.min.x > 1.95 && bounds.max.z - bounds.min.z < 0.4);
        auditMeshes(createFenceModel(kit, Math.max(1, tier), edge));
      }
      for (const shape of [2, 3, 4, 5]) {
        const plan = planBoundary(shape === 2 || shape === 4 ? 5 : 4, shape);
        assert.ok(Math.abs(plan.length - Math.sqrt(8)) < 1e-10);
        assert.ok(pointOnFoundation(shape, ...plan.start) && pointOnFoundation(shape, ...plan.end));
        auditMeshes(createWallModel(kit, tier, shape === 2 || shape === 4 ? 5 : 4, shape));
      }
    }
  } finally { kit.dispose(); }
});

test('all 19 authoritative storage types have distinct solid models', async () => {
  const source = await readFile('server/src/wooden_storage_box.rs', 'utf8');
  const ids = [...source.matchAll(/pub const BOX_TYPE_\w+: u8 = (\d+);/g)].map(match => Number(match[1]));
  assert.deepEqual(ids.toSorted((a, b) => a - b), Array.from({ length: STORAGE_MODELS.length }, (_, i) => i));
  const kit = new ModelKit();
  try {
    const signatures = new Set();
    for (const type of ids) {
      const model = createStorageModel(kit, type);
      auditMeshes(model);
      const bounds = new Box3().setFromObject(model);
      const materials = [], counts = [];
      model.traverse(object => { if (object instanceof Mesh) { materials.push(object.material.color.getHex()); counts.push(object.geometry.getAttribute('position').count); } });
      signatures.add(JSON.stringify([bounds.getSize(new Vector3()).toArray().map(v => v.toFixed(3)), materials, counts]));
    }
    assert.equal(signatures.size, 19, 'different placeables must not all alias the crate');
    assert.throws(() => createStorageModel(kit, 99), /Unknown storage/);
  } finally { kit.dispose(); }
});

test('door leaves rotate around a fixed hinge for both materials and every edge', () => {
  const kit = new ModelKit();
  try {
    for (const type of [0, 1]) for (let edge = 0; edge < 4; edge++) {
      const rig = new DoorRig(kit, type, edge);
      rig.update(false, 1 / 60); rig.root.updateMatrixWorld(true);
      const hinge = rig.hinge.getWorldPosition(new Vector3());
      for (let i = 0; i < 90; i++) rig.update(true, 1 / 60);
      rig.root.updateMatrixWorld(true);
      assert.ok(rig.hinge.getWorldPosition(new Vector3()).distanceTo(hinge) < 1e-10);
      assert.ok(Math.abs(rig.hinge.rotation.y + Math.PI * 0.49) < 1e-6);
      auditMeshes(rig.root);
    }
  } finally { kit.dispose(); }
});

test('camp vessels have positive shell volume and every camp model is real geometry', () => {
  const kit = new ModelKit();
  try {
    const group = new Scene();
    const shell = kit.vessel(group, 0xffffff, 0.21, 0.72, 0.025, 0.57);
    assert.ok(signedVolume(shell) > 0);
    for (const model of [createFurnace(kit, false), createFurnace(kit, true), createBarbecue(kit), createHearth(kit),
      createBrothPot(kit), createSleepingBag(kit), createStash(kit), createShelter(kit, 0), createShelter(kit, 1), createRainCollector(kit),
      ...[0, 1, 2, 3].map(type => createLantern(kit, type))]) auditMeshes(model);
  } finally { kit.dispose(); }
});

test('static instancing preserves transforms through growth and removes stale instances', () => {
  const kit = new ModelKit();
  const scene = new Scene();
  const batches = new StaticWorldBatches(scene);
  const prototype = createFoundation(kit, 1);
  batches.beginFrame();
  for (let i = 0; i < 70; i++) {
    const root = prototype.clone(true);
    root.position.set(i * 2, 0, i * 3);
    batches.submit(root);
  }
  batches.flush();
  assert.ok(scene.children.length <= 3, 'shared models should compile into material batches');
  for (const batch of scene.children) {
    assert.equal(batch.count, 70);
    const matrix = new Matrix4();
    batch.getMatrixAt(69, matrix);
    assert.equal(matrix.elements[12], 138);
    assert.equal(matrix.elements[14], 207);
  }
  batches.beginFrame();
  batches.flush();
  scene.children.forEach(batch => { assert.equal(batch.count, 0); assert.equal(batch.visible, false); });
  batches.dispose();
  kit.dispose();
});

test('unavailable WebGPU fails visibly without attempting Canvas2D or WebGL', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const contexts = [];
  const states = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  const canvas = { dataset: {}, style: {}, getContext: type => { contexts.push(type); throw new Error('Fallback context requested'); } };
  const renderer = new WebGpuWorldRenderer(canvas, state => states.push(state));
  try {
    await renderer.initialize();
    assert.equal(states.at(-1).phase, 'error');
    assert.match(states.at(-1).message, /requires WebGPU/);
    assert.deepEqual(contexts, []);
    await renderer.initialize();
    assert.equal(states.length, 2, 'failure must not restart initialization on every frame');
  } finally {
    await renderer.dispose();
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    if (secureDescriptor) Object.defineProperty(globalThis, 'isSecureContext', secureDescriptor); else delete globalThis.isSecureContext;
  }
});

test('WebGPU world rendering leaves the original full-resolution UI/input canvas intact', async () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let inserted = false, removed = false;
  const contexts = [];
  const worldCanvas = { dataset: {}, style: {}, setAttribute: () => {}, remove: () => { removed = true; },
    getContext: type => { contexts.push(type); return null; } };
  const uiCanvas = { width: 1280, height: 720, style: { zIndex: '', filter: 'brightness(1.02)' },
    parentNode: { insertBefore: (node, reference) => { assert.equal(node, worldCanvas); assert.equal(reference, uiCanvas); inserted = true; } } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => worldCanvas } });
  const surface = new WebGpuWorldSurface(uiCanvas, () => {});
  try {
    assert.ok(inserted);
    assert.equal(surface.renderer.canvas, worldCanvas);
    assert.equal(surface.canvas, uiCanvas);
    assert.equal(uiCanvas.width, 1280); assert.equal(uiCanvas.height, 720);
    assert.equal(worldCanvas.style.pointerEvents, 'none');
    const disposal = surface.dispose();
    assert.equal(surface.dispose(), disposal);
    assert.ok(removed); assert.equal(uiCanvas.style.zIndex, '');
    await disposal;
    assert.deepEqual(contexts, []);
  } finally {
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else delete globalThis.document;
  }
});

test('unmount during adapter acquisition cancels device creation and releases once', async () => {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const secureDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  let releaseAdapter;
  let deviceRequests = 0;
  const adapter = new Promise(resolve => { releaseAdapter = resolve; });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: () => adapter } } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const init = renderer.initialize();
  await Promise.resolve();
  const disposal = renderer.dispose();
  assert.equal(renderer.dispose(), disposal, 'cleanup must be idempotent');
  releaseAdapter({ requestDevice: () => { deviceRequests++; throw new Error('A disposed renderer requested a device'); } });
  try {
    await init;
    await disposal;
    assert.equal(deviceRequests, 0);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
    if (secureDescriptor) Object.defineProperty(globalThis, 'isSecureContext', secureDescriptor); else delete globalThis.isSecureContext;
  }
});
