import { Group, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { getPlacementSquareBounds } from '../../../config/placeablePlacementConfig';
import type { PlacementPreviewPlan } from '../../placement/placementValidation';
import { FOUNDATION_FOOTPRINTS, BUILDING } from './buildingPlan';
import { groundPosition } from './groundAnchor';
import { ModelKit } from './modelKit';
import { placementModel } from './placementModel';
import type { PlacementModel } from './placementModel';
import { GROUND_Y_SCALE, WORLD_3D, worldToScene } from './visualContract';

/** Solid-model ghost and ground outline. Owns only its four preview materials;
 * all geometry remains owned by the production model kit. */
export class PlacementPreview3d {
  readonly root = new Group();
  private model: Group | null = null;
  private outline = new Group();
  private signature = '';
  private outlineSignature = '';
  private readonly validMaterial = new MeshBasicMaterial({ color: 0x74cedd, transparent: true, opacity: 0.46, depthWrite: false });
  private readonly invalidMaterial = new MeshBasicMaterial({ color: 0xe57069, transparent: true, opacity: 0.54, depthWrite: false });
  private readonly validLine = new MeshBasicMaterial({ color: 0x8be0e7, transparent: true, opacity: 0.92, depthWrite: false });
  private readonly invalidLine = new MeshBasicMaterial({ color: 0xf19c88, transparent: true, opacity: 0.92, depthWrite: false });

  constructor(private readonly kit: ModelKit) { this.root.name = 'placement-preview-3d'; this.root.visible = false; this.root.add(this.outline); }

  update(plan: PlacementPreviewPlan | null, createModel: (descriptor: PlacementModel) => Group, floorAt: (x: number, y: number) => number): void {
    this.root.visible = Boolean(plan);
    if (!plan) return;
    const descriptor = placementModel(plan);
    const { kind, row } = descriptor;
    const signature = [kind, row.boxType, row.furnaceType, row.lanternType, row.doorType, plan.shape, plan.edge, plan.tier, plan.item?.iconAssetName].join(':');
    if (!this.model || signature !== this.signature) {
      if (this.model) this.root.remove(this.model);
      this.signature = signature;
      this.model = createModel(descriptor);
      this.model.traverse(object => { if (object instanceof Mesh) { object.castShadow = false; object.receiveShadow = false; object.renderOrder = 10; } });
      const fire = this.model.getObjectByName('fire'); if (fire) fire.visible = false;
      this.root.add(this.model);
    }
    const position = groundPosition(kind, row);
    const point = worldToScene(position.x, position.y);
    const boundary = ['foundationCells', 'wallCells', 'doors', 'fences'].includes(kind);
    this.model.position.set(point.x, boundary ? 0 : floorAt(position.x, position.y), point.z);
    this.model.traverse(object => { if (object instanceof Mesh) object.material = plan.valid ? this.validMaterial : this.invalidMaterial; });
    const outlineSignature = [plan.kind, plan.shape, plan.grid?.gridSize.widthQuarters, plan.grid?.gridSize.heightQuarters].join(':');
    if (outlineSignature !== this.outlineSignature) {
      this.outlineSignature = outlineSignature;
      this.outline.clear();
      const footprint = plan.kind === 'foundation' ? (FOUNDATION_FOOTPRINTS[plan.shape] ?? []).map(([x, z]) => [x * WORLD_3D.tilePixels, z * WORLD_3D.tilePixels])
      : (() => { const bounds = plan.grid ? getPlacementSquareBounds(0, 0, plan.grid)
        : { x: -(plan.kind === 'item' ? 24 : BUILDING.cellPixels / 2), y: -(plan.kind === 'item' ? 24 : BUILDING.cellPixels / 2),
          width: plan.kind === 'item' ? 48 : BUILDING.cellPixels, height: plan.kind === 'item' ? 48 : BUILDING.cellPixels };
      return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]]; })();
      for (let i = 0; i < footprint.length; i++) {
      const a = worldToScene(footprint[i][0], footprint[i][1]);
      const b = worldToScene(footprint[(i + 1) % footprint.length][0], footprint[(i + 1) % footprint.length][1]);
      const dx = b.x - a.x, dz = b.z - a.z;
      const edge = new Mesh(this.kit.geometry('box'), this.validLine);
      edge.scale.set(Math.hypot(dx, dz), 0.015, 0.025 * GROUND_Y_SCALE);
      edge.rotation.y = -Math.atan2(dz, dx);
      edge.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      edge.renderOrder = 11;
      this.outline.add(edge);
      }
    }
    const outlinePosition = worldToScene(plan.x, plan.y);
    this.outline.position.set(outlinePosition.x, floorAt(plan.x, plan.y) + 0.025, outlinePosition.z);
    this.outline.traverse(object => { if (object instanceof Mesh) object.material = plan.valid ? this.validLine : this.invalidLine; });
  }

  dispose(): void { this.validMaterial.dispose(); this.invalidMaterial.dispose(); this.validLine.dispose(); this.invalidLine.dispose(); this.root.clear(); }
}
