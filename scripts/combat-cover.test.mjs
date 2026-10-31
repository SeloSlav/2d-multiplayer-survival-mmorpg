import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Matrix4, Raycaster, Vector3 } from 'three/webgpu';
import { COMBAT_COVER, combatCoverProfile, coverTargetPoint } from '../client/src/config/combatCover.ts';
import { getBarrelCollisionOffset } from '../client/src/config/entityGroundGeometry.ts';
import { createCombatCover } from '../client/src/engine/presentation/world3d/combatCoverModels.ts';
import { CombatCoverDebris3d } from '../client/src/engine/presentation/world3d/CombatCoverDebris3d.ts';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { getCollisionShapesForDebug, resolveClientCollision } from '../client/src/utils/clientCollision.ts';

test('natural barricades match their ground footprint and shield a crouched torso',()=>{
  const kit=new ModelKit();
  try {
    for(const key of Object.keys(COMBAT_COVER.profiles)) {
      const variant=Number(key), profile=combatCoverProfile(variant), model=createCombatCover(kit,variant);
      model.updateMatrixWorld(true);
      const size=new Box3().setFromObject(model).getSize(new Vector3());
      assert.ok(size.x*48>=profile.width*.9 && size.x*48<=profile.width+12,`${profile.name}: width ${size.x*48}`);
      assert.ok(size.y*48>=63 && size.y*48<=profile.height+10,`${profile.name}: height ${size.y*48}`);
      assert.ok(size.z*48<=profile.depth+12,`${profile.name}: depth ${size.z*48}`);
      for(const x of [-.45,0,.45]) {
        const ray=new Raycaster(new Vector3(x,50/48,5),new Vector3(0,0,-1));
        assert.ok(ray.intersectObject(model,true).length>0,`${profile.name}: visible torso cover at ${x}`);
      }
      assert.deepEqual(getBarrelCollisionOffset({variant}),{x:0,y:0});
      let vertices=0;model.traverse(o=>{if(o.isMesh)vertices+=o.geometry.attributes.position.count;});
      assert.ok(vertices<12000,`${profile.name}: bounded geometry`);
    }
  } finally {kit.dispose();}
});

test('cover blocks predicted movement, disappears when destroyed, and returns on respawn',()=>{
  const entities=Object.fromEntries(['trees','stones','runeStones','cairns','boxes','rainCollectors','furnaces','barbecues','shelters','players','wildAnimals','barrels','seaStacks','wallCells','foundationCells','homesteadHearths','basaltColumns','doors','livingCorals'].map(k=>[k,new Map()]));
  const localId='cover-test';entities.players.set(localId,{identity:{toHexString:()=>localId},positionX:800,positionY:1000});
  const row={id:1n,posX:1000,posY:1000,variant:7,health:600,respawnAt:{microsSinceUnixEpoch:0n}};
  entities.barrels.set('1',row);
  const shapes=()=>getCollisionShapesForDebug(entities,1000,1000,localId).filter(s=>s.type==='barrel-1');
  assert.equal(shapes()[0].width,160);assert.equal(shapes()[0].height,56);
  let x=800;for(let i=0;i<100;i++)x=resolveClientCollision(x,1000,x+4,1000,localId,entities).x;
  assert.ok(x<920,'player cannot walk through the trunk');
  row.health=0;row.respawnAt={microsSinceUnixEpoch:1n};assert.equal(shapes().length,0);
  row.health=600;row.respawnAt={microsSinceUnixEpoch:0n};assert.equal(shapes().length,1);
  assert.deepEqual(coverTargetPoint(7,1000,1000,800,1000),{x:920,y:1000});
  assert.equal(combatCoverProfile(0),undefined);assert.equal(combatCoverProfile(6),undefined);
});

test('cover breaks use bounded debris which expires cleanly',()=>{
  const kit=new ModelKit(),debris=new CombatCoverDebris3d(kit);
  try {
    for(let i=0;i<30;i++)debris.spawn(String(i),7+i%5,1000,new Matrix4(),0);
    assert.equal(debris.activeCount,144);
    debris.update(1300);assert.equal(debris.root.visible,true);
    debris.update(3500);assert.equal(debris.activeCount,0);assert.equal(debris.root.visible,false);
  } finally {debris.dispose();kit.dispose();}
});
