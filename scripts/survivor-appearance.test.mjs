import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelKit } from '../client/src/engine/presentation/world3d/modelKit.ts';
import { SurvivorRig } from '../client/src/engine/presentation/world3d/survivor.ts';
import { ARMOR_CATALOG, ARMOR_SLOTS } from '../client/src/engine/presentation/world3d/survivorArmor.ts';

const rest = { speed: 0, sprinting: false, crouching: false, swimming: false, dead: false, jump: 0, roll: 0, attack: 0, yaw: 0, weapon: 'Hunting Bow', loaded: true };

test('every gear slot replaces loose babushka clothing and restores it on unequip', () => {
  const kit = new ModelKit(), rig = new SurvivorRig(kit), other = new SurvivorRig(kit);
  const visible = name => rig.root.getObjectByName(name).visible;
  for (const slot of ARMOR_SLOTS) for (const name of ARMOR_CATALOG[slot]) {
    rig.update({ ...rest, armor: { [slot]: name } }, .016, 1);
    assert.equal(visible('babushka-kerchief'), slot !== 'head' || name === 'Headlamp', name);
    assert.equal(visible('babushka-scarf-tie'), slot !== 'chest' && (slot !== 'head' || name === 'Headlamp'), name);
    assert.equal(visible('babushka-face'), name !== "Reed Diver's Helm", name);
    assert.equal(visible('babushka-collar'), slot !== 'chest' && (slot !== 'head' || name === 'Headlamp'), name);
    assert.equal(visible('babushka-apron'), slot !== 'chest', name);
    assert.equal(visible('babushka-belt'), slot !== 'chest', name);
    assert.equal(visible('babushka-vest'), slot !== 'chest', name);
    assert.equal(visible('babushka-boot'), slot !== 'feet', name);
    assert.equal(visible('babushka-hand'), slot !== 'hands', name);
    assert.equal(visible('babushka-satchel'), slot !== 'back', name);
    assert.equal(visible('survivor-skirt'), slot !== 'legs', name);
    assert.equal(other.root.getObjectByName('babushka-kerchief').visible, true, 'visibility is per player');
    assert.equal(rig.root.getObjectByName('held-weapon').parent.name, 'left-hand-socket');
    rig.update(rest, .016, 1);
    for (const layer of ['babushka-kerchief', 'babushka-scarf-tie', 'babushka-face', 'babushka-collar', 'babushka-apron', 'babushka-satchel', 'babushka-vest', 'babushka-belt', 'babushka-boot', 'babushka-hand', 'survivor-skirt']) assert.equal(visible(layer), true, `${name} restores ${layer}`);
  }
  kit.dispose();
});

test('babushka pigment survives rig compilation and detailed geometry is shared within budget', () => {
  const kit = new ModelKit(), a = new SurvivorRig(kit), b = new SurvivorRig(kit);
  let draws = 0, triangles = 0;
  a.root.traverseVisible(object => {
    if (!object.isMesh) return;
    draws++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
    for (const key of ['position', 'normal']) assert.ok([...object.geometry.attributes[key].array].every(Number.isFinite));
  });
  assert.ok(draws <= 24, `${draws} base character draws`);
  assert.ok(triangles < 6500, `${triangles} base character triangles`);
  for (const layer of ['babushka-dress', 'babushka-face', 'babushka-apron']) {
    const first = a.root.getObjectByName(layer), second = b.root.getObjectByName(layer);
    assert.equal(first.children.length, 1, 'embroidery and paint are merged');
    assert.equal(first.children[0].geometry, second.children[0].geometry, 'players share geometry');
    assert.equal(first.children[0].material.vertexColors, true);
    assert.ok(first.children[0].geometry.attributes.color.count > 0);
  }
  kit.dispose();
});

test('scarf flowers are a shared filtered fabric texture and loose cloth yields to the original stride', () => {
  const kit=new ModelKit(),a=new SurvivorRig(kit),b=new SurvivorRig(kit);
  const fabric=a.root.getObjectByName('babushka-kerchief').children.find(mesh=>mesh.material?.map);
  const other=b.root.getObjectByName('babushka-kerchief').children.find(mesh=>mesh.material?.map);
  assert.ok(fabric.geometry.getAttribute('uv'));
  assert.equal(fabric.material.map,other.material.map);
  assert.equal(fabric.material.map.image.width,512);
  assert.equal(fabric.material.map.generateMipmaps,true);
  assert.ok(fabric.geometry.attributes.position.count/3<250,'the floral pattern does not add geometry');
  const apron=a.root.getObjectByName('babushka-apron').children[0];
  const otherApron=b.root.getObjectByName('babushka-apron').children[0];
  assert.equal(apron.geometry,otherApron.geometry,'drape target buffers are shared');
  assert.notEqual(apron.morphTargetInfluences,otherApron.morphTargetInfluences,'cloth motion belongs to each player');
  for(let i=0;i<90;i++)a.update({...rest,speed:4,sprinting:true},1/60,i/60);
  assert.ok(apron.morphTargetInfluences[0]>.1);
  assert.deepEqual(otherApron.morphTargetInfluences,[0,0]);
  a.update({...rest,swimming:true},1/60,2);
  assert.deepEqual(apron.morphTargetInfluences,[0,0],'swimming retains the original cloth envelope');
  let disposed=0;fabric.material.map.addEventListener('dispose',()=>disposed++);kit.dispose();
  assert.equal(disposed,1,'the owning kit releases the shared texture once');
});
