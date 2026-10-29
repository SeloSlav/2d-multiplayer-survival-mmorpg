import test from 'node:test';
import { TerrainWindow3d } from '../client/src/engine/presentation/world3d/TerrainWindow3d.ts';
import { addWebGpuSample, webGpuProfilerTimings } from '../client/src/engine/presentation/world3d/world3dProfiler.ts';
import { startRecording, stopRecording, copyToClipboard } from '../client/src/utils/profilerRecording.ts';
import { FpsProfiler } from '../client/src/utils/profiler/FpsProfiler.ts';
import { TerrainBuildQueue } from '../client/src/engine/presentation/world3d/TerrainBuildQueue.ts';
import { buildTerrain } from '../client/src/engine/presentation/world3d/terrainBuild.ts';
import { PipelineWarmup3d } from '../client/src/engine/presentation/world3d/PipelineWarmup3d.ts';
import { TREE_IMPACT_MS } from '../client/src/engine/presentation/world3d/TreeFallEffects3d.ts';
import { recordTreeFallPlayback, treeFallPlayback } from '../client/src/utils/treeFallAudioSync.ts';
import './placement.test.mjs';
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
    assert.ok(size.y > 1 && size.y < 7.5 && size.x < 7, `${type}: growth bounds`);
    assert.equal(model.userData.treeSpecies, type); assert.ok(model.userData.growth.branchCount >= 20);
    let triangles = 0, signature = '';
    model.traverse(o => { if (o instanceof Mesh) { triangles += o.geometry.attributes.position.count / 3; signature += Array.from(o.geometry.attributes.position.array).slice(0, 120).join(','); assert.ok(signedVolume(o) > 0, type); } });
    assert.ok(triangles < 18000 && model.children.length <= 7, `${type}: ${triangles} triangles / ${model.children.length} slots`);
    assert.ok(!signatures.has(signature), `${type} shares a species silhouette`); signatures.add(signature);
  }
  assert.throws(() => createTree(kit, 'FutureTree', 0), /Unfinished tree/); kit.dispose();
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

test('regular swimming kicks more slowly while sprint swimming keeps its original kick cadence',()=>{
  const kit=new ModelKit(),regular=new SurvivorRig(kit),sprint=new SurvivorRig(kit);
  const pose={speed:2,sprinting:false,swimming:true,crouching:false,dead:false,jump:0,roll:0,attack:0,yaw:0,weapon:''};
  for(let i=0;i<300;i++){
    regular.update(pose,1/60,i/60);
    sprint.update({...pose,sprinting:true},1/60,i/60);
  }
  assert.ok(regular.swimKickPhase < regular.swimPhase*.6,'regular kicks run at roughly half the arm stroke rate');
  assert.ok(Math.abs(sprint.swimKickPhase-sprint.swimPhase)<1e-9,'sprinting retains the previous phase and cadence');
  assert.ok(Math.abs(sprint.leftLeg.rotation.x-(-.2+Math.sin(sprint.swimPhase)*.7))<1e-7,'sprinting retains the previous kick range');
  let previous=regular.swimKickPhase;
  for(let i=0;i<60;i++){
    regular.update({...pose,sprinting:true},1/60,5+i/60);
    assert.ok(regular.swimKickPhase>previous&&regular.swimKickPhase-previous<.18,'changing speed keeps the kick phase continuous');
    previous=regular.swimKickPhase;
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
    model.traverse(o=>{if(o instanceof Mesh){triangles+=o.geometry.attributes.position.count/3;assert.ok(signedVolume(o)>0,'closed, outward solids');const a=o.geometry.getAttribute('color');if(a)colors.push(...Array.from(a.array).slice(0,120));}});
    assert.ok(triangles>1000&&triangles<18000,`${profile.name}: ${triangles} triangles`);signatures.add(colors.join(','));
    for(const x of [-150,-80,0,80,150])for(const z of [-62.5,0,62.5]){
      const ray=new Raycaster(new Vector3(x/48,8,z/48),new Vector3(0,-1,0));
      const hits=ray.intersectObject(roof,true);assert.ok(hits.length&&hits[0].point.y>1.25,`protected roof gap at ${x},${z} for ${profile.name}`);
    }
  });
  assert.equal(signatures.size,4);kit.dispose();
});

test('only an owner inside gets the 30% shelter view and exact ground border; other shelters and occupants stay concealed',()=>{
  const kit=new ModelKit(),first=new ShelterRig(kit,0),other=new ShelterRig(kit,0);
  const row={posX:1000,posY:1200,placedBy:{toHexString:()=> 'owner'}},inside={x:1000,y:1000},outside={x:1000,y:1070};
  assert.equal(shelterOwnerInside(row,'owner',inside),true);assert.equal(shelterOwnerInside(row,'visitor',inside),false);assert.equal(shelterOwnerInside(row,'owner',outside),false);
  first.update(true,1050,1000);let faded=0;
  first.root.getObjectByName('shelter-shell').traverse(o=>{if(o instanceof Mesh&&!o.userData.cutawayDepth){assert.equal(o.material.opacity,.3);assert.equal(o.material.depthWrite,false);assert.equal(o.castShadow,false);faded++;}});
  assert.ok(faded);other.root.traverse(o=>{if(o instanceof Mesh)assert.equal(o.material.opacity,1,'shared source materials must remain opaque');});
  const depthPass=first.root.getObjectByName('cutaway-depth-envelope');assert.equal(depthPass.visible,true);
  depthPass.traverse(o=>{if(o instanceof Mesh){assert.equal(o.material.colorWrite,false);assert.equal(o.material.depthWrite,true);assert.equal(o.renderOrder,12);}});
  const border=first.root.getObjectByName('shelter-protected-border');assert.equal(border.visible,true);border.updateMatrixWorld(true);
  const bounds=new Box3().setFromObject(border);assert.ok(Math.abs(bounds.max.x-150/48)<.035&&Math.abs(bounds.max.z-62.5/48)<.035);
  first.update(false,1250,1000);assert.equal(border.visible,false);assert.equal(first.root.getObjectByName('shelter-shell').position.x,0);
  assert.equal(depthPass.visible,false);
  first.root.getObjectByName('shelter-shell').traverse(o=>{if(o instanceof Mesh&&!o.userData.cutawayDepth){assert.equal(o.material.opacity,1);assert.equal(o.castShadow,true);}});
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

test('village cutaways preserve open movement anchors, rotate in ground space and do not fade neighboring copies',async()=>{
  const kit=new ModelKit(),asset='hv_lodge.png',prototype=createVillageModel(kit,asset),a=new VillageRig(kit,asset,prototype),b=new VillageRig(kit,asset,prototype);
  const anchor={x:1000,y:1000},plan=VILLAGE_BUILDINGS[asset];
  a.update({x:1000,y:1000-plan.depth*24},anchor,0,1);
  assert.equal(a.root.userData.cutaway,true);a.root.getObjectByName('village-shell').traverse(o=>{if(o instanceof Mesh&&!o.userData.cutawayDepth)assert.equal(o.material.opacity,.4);});
  b.root.getObjectByName('village-shell').traverse(o=>{if(o instanceof Mesh)assert.equal(o.material.opacity,1);});
  a.update({x:1000+plan.depth*24,y:1000},anchor,Math.PI/2,2);assert.equal(a.root.userData.cutaway,true);assert.equal(a.root.rotation.y,-Math.PI/2);
  a.update({x:2000,y:2000},anchor,0,3);assert.equal(a.root.userData.cutaway,false);
  const weatherAsset='ws_station.png',weatherModel=createVillageModel(kit,weatherAsset),weatherRig=new VillageRig(kit,weatherAsset,weatherModel),rotors=[];
  weatherRig.root.traverse(o=>{if(o.name==='village-turbine')rotors.push(o);});assert.equal(rotors.length,3);
  const pivots=rotors.map(o=>o.position.toArray());weatherRig.update(null,anchor,0,2);assert.deepEqual(rotors.map(o=>o.position.toArray()),pivots);assert.ok(rotors.every(o=>o.rotation.z===2.8));
  const renderer=new WebGpuWorldRenderer({dataset:{},style:{}}),row={worldX:1000,worldY:1000,imagePath:asset,partType:'lodge',collisionRadius:0,rotationRad:Math.PI/2};
  const frame={width:1280,height:720,cameraOffset:{x:-360,y:-640},tables:{monumentParts:new Map([['village',row]])}};
  renderer.syncTable('monumentParts',frame,.016,0,new Set(),[]);const visual=renderer.visuals.get('monumentParts:village');
  assert.ok(visual.village);assert.equal(visual.root.position.x,1000/48);assert.equal(visual.root.position.z,1000/48*GROUND_Y_SCALE);assert.equal(row.collisionRadius,0);assert.equal(renderer.unfinished.has('table:monumentParts'),false);
  await renderer.dispose();kit.dispose();
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
