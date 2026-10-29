import { Group, InstancedMesh, Matrix4, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { attribute, cameraPosition, cameraViewMatrix, color, cos, dFdx, dFdy, float, max, min, mix, positionWorld, sin, smoothstep, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { GROUND_Y_SCALE, WORLD_3D, worldToScene } from './visualContract';
import { createCoral, createKelp } from './naturalObjects';
import { ModelKit } from './modelKit';
import { TerrainMaterials3d, WATER_DEPTH } from './terrainMaterials';
import { StaticWorldBatches } from './StaticWorldBatches';

export type WaterKind = 'Sea' | 'DeepSea' | 'HotSpringWater';
export { WATER_DEPTH } from './terrainMaterials';
export function seabedAnchor(x: number, y: number, kind: WaterKind, depth = WATER_DEPTH[kind] as number): { x: number; y: number; z: number } {
  const p = worldToScene(x, y);
  // Authored orthographic bathymetry: retain the old world/interaction anchor
  // while lowering the seabed. No change to server tiles or collision rules.
  return { x: p.x, y: -depth, z: p.z - depth / Math.tan(WORLD_3D.elevationRadians) };
}
export function waterDoodad(x: number, y: number, kind: WaterKind): { type: 'kelp' | 'coral' | 'shell'; variant: number } | null {
  if (kind === 'HotSpringWater') return null;
  const hash = (salt: number) => Math.abs(((x + salt) * 374761393 + y * 668265263) ^ (x * 1013904223)) >>> 0;
  if (hash(12345) % 1000 >= (kind === 'DeepSea' ? 40 : 80)) return null;
  const index = hash(67890) % (kind === 'DeepSea' ? 4 : 7);
  return { type: index === 0 ? 'coral' : index === 3 || index === 4 ? 'kelp' : 'shell', variant: hash(67890) % 4 };
}

interface Layer { kind: WaterKind; surface: InstancedMesh; material: MeshStandardNodeMaterial; surfaceCount: number }
const WAVES = [[.94, .32, .026, 5.5], [-.42, .91, .018, 3.4], [.78, -.52, .012, 1.9]] as const;

/** Flat analytic water: coherent normals/glints, absorbed seabed and caustic light.
 * No scene-color refraction or FFT claim; all fields are world anchored. */
export class WaterWorld3d {
  readonly root = new Group();
  private readonly clock = uniform(0);
  private readonly daylight = uniform(1);
  private readonly dive = uniform(0);
  private readonly geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly layers: Layer[] = [];
  private readonly matrix = new Matrix4();
  private readonly decorations = new Group();
  private readonly decorationTiles = new Map<string, Group>();
  private readonly decorationBatches = new StaticWorldBatches(this.root);
  private readonly prototypes = new Map<string, Group>();
  private readonly terrain: TerrainMaterials3d;
  private readonly ownsTerrain: boolean;

  constructor(private readonly kit: ModelKit, terrain?: TerrainMaterials3d) {
    this.terrain = terrain ?? new TerrainMaterials3d(); this.ownsTerrain = !terrain;
    this.root.name = 'water-and-seabed';
    let gx = float(0).add(0), gz = float(0).add(0), crest = float(0).add(0);
    const footprint = max(dFdx(positionWorld.xz).length(), dFdy(positionWorld.xz).length());
    for (const [dx, dz, amplitude, wavelength] of WAVES) {
      const k = Math.PI * 2 / wavelength;
      const phase = positionWorld.x.mul(dx * k).add(positionWorld.z.mul(dz * k)).sub(this.clock.mul(Math.sqrt(9.81 * k)));
      const filtered = float(1).sub(smoothstep(.35, 1.2, footprint.mul(k)));
      gx = gx.add(cos(phase).mul(dx * k * amplitude).mul(filtered));
      gz = gz.add(cos(phase).mul(dz * k * amplitude).mul(filtered));
      crest = crest.add(sin(phase).mul(amplitude * 8).mul(filtered));
    }
    const normal = vec3(gx.negate(), 1, gz.negate()).normalize();
    const facing = normal.dot(cameraPosition.sub(positionWorld).normalize()).abs();
    const fresnel = float(.02).add(float(1).sub(facing).pow(5).mul(.98));
    const groundCoordinate = attribute('terrainCoordinate', 'vec2');
    const causticUV = groundCoordinate.mul(1.8).add(vec2(gx, gz).mul(7.5));
    const cell = causticUV.floor(), local = causticUV.fract();
    let first = float(20).add(0), second = float(20).add(0);
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
      const id = cell.add(vec2(x, y));
      const rx = sin(id.dot(vec2(127.1, 311.7))).mul(43758.5453).fract();
      const ry = sin(id.dot(vec2(269.5, 183.3))).mul(43758.5453).fract();
      const point = vec2(rx, ry).mul(.64).add(.18).add(vec2(cos(this.clock.mul(.48).add(rx.mul(6.28))), sin(this.clock.mul(.43).add(ry.mul(6.28)))).mul(.13));
      const delta = vec2(x, y).add(point).sub(local), distance = delta.dot(delta);
      second = min(second, max(first, distance)).toVar(); first = min(first, distance).toVar();
    }
    const lines = float(1).sub(smoothstep(.02, .16, second.sqrt().sub(first.sqrt())));
    const logical = vec2(positionWorld.x, positionWorld.z.div(GROUND_Y_SCALE));
    const shore = this.terrain.coastAt(logical.add(vec2(sin(logical.y.mul(2.3).add(sin(logical.x))).mul(.09), sin(logical.x.mul(2.8)).mul(.09))));
    const swash = sin(this.clock.mul(1.25).add(logical.x.mul(.73)).add(sin(logical.y.mul(.51)))).mul(.14);
    const wetEdge = shore.add(swash), coverage = smoothstep(-.15, .35, wetEdge);
    const edgeFoam = float(1).sub(smoothstep(.025, .12, wetEdge.abs()));
    const shoreWave = sin(shore.mul(11).sub(this.clock.mul(2.4)).add(logical.x.mul(.24))).max(0).pow(9)
      .mul(float(1).sub(smoothstep(.1, 1.15, shore)));
    const foam = max(edgeFoam.mul(.6), shoreWave.mul(.36));
    const shelf = smoothstep(.8, 2.7, this.terrain.depthAtNode(logical));
    this.terrain.material.emissiveNode = color(0x9fbeb0).mul(lines).mul(this.daylight).mul(.26)
      .mul(smoothstep(.03, .45, this.terrain.depthAtNode(groundCoordinate)))
      .mul(this.terrain.depthAtNode(groundCoordinate).mul(-.3).exp());
    for (const kind of ['Sea', 'DeepSea', 'HotSpringWater'] as const) {
      const hot = kind === 'HotSpringWater';
      const material = new MeshStandardNodeMaterial({ transparent: true, depthWrite: false, roughness: .35, metalness: .12 });
      material.colorNode = mix(mix(hot ? color(0x76aaa0) : mix(color(0x4b8b94), color(0x285e76), shelf), color(0x99c0b5), smoothstep(.1, .48, crest).mul(.16)), color(0xa6c0bc), fresnel.mul(.5));
      material.colorNode = mix(material.colorNode, color(0xd0daca), foam.mul(float(1).sub(this.dive)));
      material.normalNode = cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize();
      // Reduced opacity while snorkeling restores the seabed's readability.
      material.opacityNode = mix(hot ? float(.3) : mix(.33, .57, shelf), mix(.14, .26, shelf), this.dive).add(fresnel.mul(.25)).add(foam.mul(.45).mul(float(1).sub(this.dive))).mul(coverage);
      const surface = new InstancedMesh(this.geometry, material, 8192);
      surface.name = `${kind}-surface`; surface.renderOrder = 1; surface.frustumCulled = false;
      surface.receiveShadow = false; surface.count = 0;
      this.root.add(surface); this.layers.push({ kind, surface, material, surfaceCount: 0 });
    }
  }
  rebuild(tiles: Iterable<{ worldX?: number; worldY?: number; tileType?: unknown }>): void {
    const tileRows = [...tiles];
    if (this.ownsTerrain) this.terrain.rebuild(tileRows);
    this.layers.forEach(layer => { layer.surfaceCount = 0; });
    const seenDecorations = new Set<string>();
    const tileKinds = new Map(tileRows.map(tile => [`${tile.worldX},${tile.worldY}`, typeof tile.tileType === 'string' ? tile.tileType : (tile.tileType as { tag?: string })?.tag]));
    for (const tile of tileRows) {
      const type = tile.tileType as { tag?: string }, layer = this.layers.find(l => l.kind === (typeof type === 'string' ? type : type?.tag));
      if (!layer || layer.surfaceCount >= 8192) continue;
      const x = tile.worldX ?? 0, y = tile.worldY ?? 0, p = worldToScene((x + .5) * 48, (y + .5) * 48);
      this.matrix.makeScale(1, 1, GROUND_Y_SCALE); this.matrix.setPosition(p.x, .012, p.z);
      layer.surface.setMatrixAt(layer.surfaceCount++, this.matrix);
      const bottom = seabedAnchor((x + .5) * 48, (y + .5) * 48, layer.kind, this.terrain.depthAt((x + .5) * 48, (y + .5) * 48));
      const doodad = waterDoodad(x, y, layer.kind);
      if (!doodad) continue;
      const key = `${doodad.type}:${doodad.variant}`;
      let prototype = this.prototypes.get(key);
      if (!prototype) {
        if (doodad.type === 'kelp') { prototype = createKelp(this.kit, doodad.variant); prototype.scale.setScalar(.45); }
        else if (doodad.type === 'coral') prototype = createCoral(this.kit, doodad.variant, doodad.variant, true);
        else {
          const shell = new Group(); this.kit.part(shell, 'rock', 0x9fb2a3, [.18, .06, .14], [0, .03, 0]);
          this.kit.part(shell, 'cone', 0xbfc2a6, [.09, .11, .09], [.06, .05, -.02]); prototype = this.kit.compile(shell);
        }
        this.prototypes.set(key, prototype);
      }
      const tileKey = `${x},${y}:${key}`; seenDecorations.add(tileKey);
      let model = this.decorationTiles.get(tileKey);
      if (!model) {
        model = prototype.clone(true); model.scale.z *= GROUND_Y_SCALE;
        this.decorationTiles.set(tileKey, model); this.decorations.add(model);
      }
      model.position.set(bottom.x, bottom.y + .015, bottom.z);
      model.scale.y = prototype.scale.y * Math.min(1, -bottom.y / .55);
    }
    // A thin overlap onto dry coastal cells lets swash advance/recede over sand.
    // Its shader coverage comes from the same signed coast field as wet terrain.
    for (const tile of tileRows) {
      const x = tile.worldX ?? 0, y = tile.worldY ?? 0, kind = tileKinds.get(`${x},${y}`);
      if (this.layers.some(l => l.kind === kind)) continue;
      const adjacent = [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([dx, dy]) => tileKinds.get(`${x + dx},${y + dy}`));
      const layer = this.layers.find(l => adjacent.includes(l.kind));
      if (!layer || layer.surfaceCount >= 8192) continue;
      const p = worldToScene((x + .5) * 48, (y + .5) * 48);
      this.matrix.makeScale(1, 1, GROUND_Y_SCALE); this.matrix.setPosition(p.x, .012, p.z);
      layer.surface.setMatrixAt(layer.surfaceCount++, this.matrix);
    }
    for (const layer of this.layers) {
      layer.surface.count = layer.surfaceCount; layer.surface.instanceMatrix.needsUpdate = true;
    }
    for (const [key, model] of this.decorationTiles) if (!seenDecorations.has(key)) { this.decorations.remove(model); this.decorationTiles.delete(key); }
  }
  setDebug(mode: string): void { for (const layer of this.layers) layer.material.wireframe = mode === 'wireframe'; }
  beginFrame(time: number, daylight: number, diving: boolean): void {
    this.clock.value = time; this.daylight.value = daylight; this.dive.value = Number(diving);
    this.decorationBatches.beginFrame();
    this.decorations.children.forEach(object => {
      // Root stays on the seabed. Only the fronds lean with the current.
      const phase = object.position.x * .71 + object.position.z * .37;
      if (object.userData.naturalObject === 'kelp') { object.rotation.z = Math.sin(time * 1.3 + phase) * .06; object.rotation.x = Math.sin(time * 1.1 + phase) * .045; }
      this.decorationBatches.submit(object as Group);
    });
    this.decorationBatches.flush();
  }
  dispose(): void {
    this.layers.forEach(layer => { layer.surface.dispose(); layer.material.dispose(); });
    this.geometry.dispose(); this.root.clear(); this.prototypes.clear();
    this.decorationBatches.dispose(); this.decorations.clear(); this.decorationTiles.clear();
    if (this.ownsTerrain) this.terrain.dispose();
  }
}
