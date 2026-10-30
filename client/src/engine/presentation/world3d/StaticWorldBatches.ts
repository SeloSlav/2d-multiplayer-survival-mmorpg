import { Group, InstancedMesh, Mesh, Object3D } from 'three/webgpu';

interface Batch { mesh: InstancedMesh; used: number; capacity: number }

/** Material/geometry sharing converts semantic static models into instanced draws. */
export class StaticWorldBatches {
  private readonly batches = new Map<string, Batch>();
  constructor(private readonly scene: Object3D) {}

  beginFrame(): void { this.batches.forEach(batch => { batch.used = 0; }); }

  submit(root: Group): void {
    root.updateMatrixWorld(true);
    root.traverseVisible(object => {
      if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
      const key = `${object.geometry.uuid}:${object.material.uuid}`;
      let batch = this.batches.get(key);
      if (!batch) {
        batch = { mesh: this.makeMesh(object, 32), used: 0, capacity: 32 };
        this.batches.set(key, batch);
      } else if (batch.used >= batch.capacity) {
        const replacement = this.makeMesh(object, batch.capacity * 2);
        replacement.instanceMatrix.array.set(batch.mesh.instanceMatrix.array);
        this.scene.remove(batch.mesh);
        batch.mesh.dispose();
        batch.mesh = replacement;
        batch.capacity *= 2;
      }
      batch.mesh.setMatrixAt(batch.used++, object.matrixWorld);
    });
  }

  private makeMesh(source: Mesh, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(source.geometry, source.material, capacity);
    mesh.name = 'static-world-batch';
    // Entity culling happens before submission; a batch may span many regions.
    mesh.frustumCulled = false;
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.count = 0;
    this.scene.add(mesh);
    return mesh;
  }

  flush(): void {
    this.batches.forEach(batch => {
      batch.mesh.count = batch.used;
      batch.mesh.visible = batch.used > 0;
      if (batch.used) batch.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  dispose(): void {
    this.batches.forEach(batch => { this.scene.remove(batch.mesh); batch.mesh.dispose(); });
    this.batches.clear();
  }
}
