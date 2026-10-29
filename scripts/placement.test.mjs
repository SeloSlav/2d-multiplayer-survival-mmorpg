import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three/webgpu';
import { evaluatePlacementPreview } from '../client/src/engine/placement/placementValidation.ts';
import { evaluateGameCanvasPlacement } from '../client/src/engine/placement/gameCanvasPlacement.ts';
import { placementModel } from '../client/src/engine/presentation/world3d/placementModel.ts';
import { PlacementPreview3d } from '../client/src/engine/presentation/world3d/PlacementPreview3d.ts';
import { WebGpuWorldRenderer } from '../client/src/engine/presentation/world3d/WebGpuWorldRenderer.ts';
import { groundPosition } from '../client/src/engine/presentation/world3d/groundAnchor.ts';
import { worldToScene } from '../client/src/engine/presentation/world3d/visualContract.ts';

function connectionFixture(overrides = {}, tileType = 1) {
  const data = { world_chunk_data: [{ chunkX: 0, chunkY: 0, chunkSize: 64, tileTypes: new Uint8Array(4096).fill(tileType) }], ...overrides };
  const db = new Proxy({}, { get: (_, table) => ({ iter: () => data[table] ?? [], grassId: { find: () => ({ isAlive: false }) } }) });
  return { db, identity: { toHexString: () => 'placement-fixture' } };
}
const definitions = new Map([['1', { id: 1n, name: 'Wood' }]]);
const inventory = quantity => new Map([['wood', { itemDefId: 1n, quantity }]]);
const item = (name, icon) => ({ itemName: name, iconAssetName: icon, itemDefId: 2n, instanceId: 3n });
function input(overrides = {}) {
  return { placementInfo: null, buildingState: null, worldMouseX: 1000, worldMouseY: 900, localPlayerX: 1000, localPlayerY: 945,
    isPlacementTooFar: false, placementError: null, connection: connectionFixture(), inventoryItems: inventory(100), itemDefinitions: definitions, ...overrides };
}
const building = (mode, shape = 1) => ({ isBuilding: true, mode, foundationShape: shape, buildingTier: 0, buildingEdge: 0, buildingFacing: 0, placementError: null });

test('placement decisions preserve grid, water, overlap, distance and stale-error behavior without a canvas', () => {
  const placementInfo = item('Wooden Storage Box', 'wooden_storage_box.png');
  const args = input({ placementInfo });
  let plan = evaluatePlacementPreview(args);
  assert.deepEqual([plan.x, plan.y, plan.valid], [984, 888, true]);
  assert.equal(evaluatePlacementPreview({ ...args, worldMouseX: null }), null);
  assert.equal(evaluatePlacementPreview({ ...args, isPlacementTooFar: true }).valid, false);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({}, 3) }).valid, false);
  const waterConnection = connectionFixture({}, 3);
  assert.equal(evaluatePlacementPreview({ ...args, connection: waterConnection }).valid, false);
  evaluatePlacementPreview({ ...args, connection: null, placementInfo: null });
  assert.equal(evaluatePlacementPreview({ ...args, connection: waterConnection }).valid, false, 'reconnecting must rebuild the terrain cache before validation');
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ campfire: [{ posX: 984, posY: 888 }] }) }).valid, false);
  plan = evaluatePlacementPreview({ ...args, connection: connectionFixture(), placementError: 'Blocked by existing structure' });
  assert.equal(plan.clearError, true);
  assert.equal(plan.valid, false, 'the original feedback clears the stale error before the next valid frame');
});

test('foundation previews check resource costs, occupied shapes and complementary triangles', () => {
  const args = input({ worldMouseX: 1008, worldMouseY: 1008, localPlayerX: 1008, localPlayerY: 1080, buildingState: building('foundation') });
  assert.equal(evaluatePlacementPreview(args).valid, true);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture(), inventoryItems: inventory(49) }).valid, false);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture(), inventoryItems: inventory(25), buildingState: building('foundation', 2) }).valid, true);
  const existing = { cellX: 10, cellY: 10, shape: 4, isDestroyed: false };
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ foundation_cell: [existing] }), buildingState: building('foundation', 2) }).valid, true);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ foundation_cell: [{ ...existing, shape: 1 }] }) }).valid, false);
});

test('wall and door previews work on the first frame and reject occupied shared edges', () => {
  const foundation = { cellX: 10, cellY: 10, shape: 1, isDestroyed: false };
  const args = input({ worldMouseX: 1008, worldMouseY: 961, localPlayerX: 1008, localPlayerY: 1040,
    buildingState: building('wall'), connection: connectionFixture({ foundation_cell: [foundation] }) });
  let plan = evaluatePlacementPreview(args);
  assert.deepEqual([plan.kind, plan.edge, plan.valid], ['wall', 0, true]);
  const neighbor = { cellX: 10, cellY: 9, edge: 2, isDestroyed: false };
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ foundation_cell: [foundation], wall_cell: [neighbor] }) }).valid, false);
  const doorArgs = { ...args, buildingState: null, placementInfo: item('Wood Door', 'wood_door.png') };
  plan = evaluatePlacementPreview({ ...doorArgs, connection: connectionFixture({ foundation_cell: [foundation] }) });
  assert.deepEqual([plan.x, plan.y, plan.edge, plan.valid], [1008, 960, 0, true]);
  assert.equal(evaluatePlacementPreview({ ...doorArgs, connection: connectionFixture({ foundation_cell: [foundation], door: [neighbor] }) }).valid, false);
});

test('fence previews reject standing in the new fence and existing adjacent fences', () => {
  const args = input({ worldMouseX: 1008, worldMouseY: 961, localPlayerX: 1008, localPlayerY: 1020, buildingState: building('fence') });
  assert.equal(evaluatePlacementPreview(args).valid, true);
  assert.equal(evaluatePlacementPreview({ ...args, localPlayerY: 960 }).valid, false);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ fence: [{ cellX: 10, cellY: 9, edge: 2, isDestroyed: false }] }) }).valid, false);
});

test('cauldron previews snap to heat sources and reject occupied attachments', () => {
  const campfire = { id: 5, posX: 984, posY: 900, attachedBrothPotId: undefined };
  const args = input({ placementInfo: item('Cerametal Field Cauldron Mk. II', 'field_cauldron.png'), isPlacementTooFar: true,
    connection: connectionFixture({ campfire: [campfire] }) });
  const plan = evaluatePlacementPreview(args);
  assert.deepEqual([plan.x, plan.y, plan.valid], [984, 840, true]);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture({ campfire: [{ ...campfire, attachedBrothPotId: 0 }] }) }).valid, false);
  assert.equal(evaluatePlacementPreview({ ...args, connection: connectionFixture() }).valid, false);
});

test('the engine bridge feeds the existing placement feedback callbacks once', () => {
  let clears = 0, warnings = 0;
  const args = { ...input({ placementInfo: item('Wooden Storage Box', 'wooden_storage_box.png'), placementError: 'Old error' }),
    worldMousePosRef: { current: { x: 1000, y: 900 } }, predictedPositionRef: { current: { x: 1000, y: 945 } },
    placementActions: { clearPlacementError: () => { clears++; } }, lastPlacementWarningRef: { current: 'Old warning' }, setPlacementWarning: value => { assert.equal(value, null); warnings++; } };
  assert.equal(evaluateGameCanvasPlacement(args).clearError, true);
  args.placementError = null;
  assert.equal(evaluateGameCanvasPlacement(args).valid, true);
  assert.equal(clears, 1); assert.equal(warnings, 1);
});

test('placement ghosts predict inserted row offsets rather than reusing cursor coordinates as stored anchors', () => {
  const base = { kind: 'item', x: 1000, y: 900, cellX: 10, cellY: 9, shape: 1, tier: 0, edge: 0, valid: true, warning: null, clearError: false };
  for (const [name, icon, kind, storedY, groundY] of [
    ['Camp Fire', 'campfire.png', 'campfires', 942, 942], ['Furnace', 'furnace_simple.png', 'furnaces', 958, 908],
    ['Large Furnace', 'large_furnace.png', 'furnaces', 1028, 948], ['Wooden Storage Box', 'wooden_storage_box.png', 'woodenStorageBoxes', 952, 902],
    ['Wooden Beehive', 'beehive_wooden.png', 'woodenStorageBoxes', 1052, 970], ['Sleeping Bag', 'sleeping_bag.png', 'sleepingBags', 948, 900],
    ['Lantern', 'lantern_off.png', 'lanterns', 934, 900], ["Matron's Chest", 'hearth.png', 'homesteadHearths', 972.5, 900],
    ['Shelter', 'shelter.png', 'shelters', 1092, 892],
  ]) {
    const model = placementModel({ ...base, item: item(name, icon) });
    assert.equal(model.kind, kind); assert.equal(model.row.posY, storedY, name);
    assert.equal(groundPosition(kind, model.row).y, groundY, name);
  }
});

test('3D ghosts reuse geometry, preserve production materials, track movement and hide on cancellation', async () => {
  const renderer = new WebGpuWorldRenderer({ dataset: {}, style: {} });
  const preview = new PlacementPreview3d(renderer.kit);
  const args = input({ placementInfo: item('Wooden Storage Box', 'wooden_storage_box.png') });
  const plan = evaluatePlacementPreview(args);
  const material = renderer.kit.material(0xa78456);
  const original = material.color.getHex();
  let creations = 0;
  const factory = model => { creations++; return renderer.createVisual(model.kind, model.row, 'test-preview', 'box', 0, 0).root; };
  preview.update(plan, factory, () => 0.16);
  const firstModel = preview.model, firstOutline = preview.outline.children[0];
  for (let frame = 0; frame < 100; frame++) preview.update({ ...plan, x: plan.x + frame, valid: frame % 2 === 0 }, factory, () => 0.16);
  assert.equal(creations, 1); assert.equal(preview.model, firstModel); assert.equal(preview.outline.children[0], firstOutline);
  const expected = worldToScene(plan.x + 99, plan.y + 2);
  assert.ok(Math.abs(preview.model.position.x - expected.x) < 1e-8);
  assert.ok(Math.abs(preview.model.position.z - expected.z) < 1e-8);
  assert.equal(preview.model.position.y, 0.16);
  preview.root.traverse(object => { assert.ok(!object.isSprite); if (object instanceof Mesh) { assert.equal(object.material.depthWrite, false); assert.equal(object.castShadow, false); } });
  assert.equal(material.color.getHex(), original);
  preview.update(null, factory, () => 0); assert.equal(preview.root.visible, false);
  preview.dispose(); await renderer.dispose();
});
