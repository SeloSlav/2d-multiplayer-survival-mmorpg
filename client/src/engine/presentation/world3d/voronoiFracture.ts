import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, Vector3 } from 'three/webgpu';
import type { MeshStandardMaterial } from 'three/webgpu';
import { seededRandom } from './visualContract';

interface Face { points: Vector3[]; color: Color; paint: number }
export interface FracturePiece { geometry: BufferGeometry; center: Vector3; volume: number; radius: number }
const EPS = 1e-7;
const pointKey = (p: Vector3) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`;

/** Recover separate closed convex parts, including disconnected metal bands in
 * a compiled material slot. Capping them together would bridge empty space. */
function sourceSolids(source: Group, paintColor: number): Face[][] {
  const solids: Face[][] = []; source.updateMatrixWorld(true);
  source.traverse(object => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const material = object.material as MeshStandardMaterial, position = object.geometry.getAttribute('position'), index = object.geometry.index;
    const faces: Face[] = [], adjacency = new Map<string, number[]>();
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(object.matrixWorld));
      if (new Vector3().subVectors(points[1], points[0]).cross(new Vector3().subVectors(points[2], points[0])).lengthSq() < EPS * EPS) continue;
      const face = faces.length;
      faces.push({ points, color: material.color, paint: material.color.getHex() === paintColor ? 1 : 0 });
      for (const point of points) { const key = pointKey(point), neighbors = adjacency.get(key) ?? []; neighbors.push(face); adjacency.set(key, neighbors); }
    }
    const visited = new Set<number>();
    for (let i = 0; i < faces.length; i++) {
      if (visited.has(i)) continue;
      const queue = [i], solid: Face[] = []; visited.add(i);
      for (let k = 0; k < queue.length; k++) {
        const face = faces[queue[k]]; solid.push(face);
        for (const point of face.points) for (const neighbor of adjacency.get(pointKey(point))!)
          if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
      solids.push(solid);
    }
  });
  return solids;
}

/** Keep n·p <= offset. Every exposed cut gets an outward-facing cap. */
function clipSolid(faces: Face[], normal: Vector3, offset: number, cut: Color): Face[] {
  const result: Face[] = [], intersections = new Map<string, Vector3>();
  let inside = false, outside = false;
  for (const face of faces) {
    const points: Vector3[] = [];
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i], b = face.points[(i + 1) % face.points.length], da = normal.dot(a) - offset, db = normal.dot(b) - offset;
      const aInside = da <= EPS, bInside = db <= EPS;
      inside ||= da < -EPS; outside ||= da > EPS;
      if (aInside) points.push(a);
      if (aInside !== bInside) {
        const hit = a.clone().lerp(b, Math.max(0, Math.min(1, da / (da - db))));
        points.push(hit); intersections.set(pointKey(hit), hit);
      }
    }
    const unique = points.filter((p, i) => p.distanceToSquared(points[(i + points.length - 1) % points.length]) > EPS * EPS);
    if (unique.length >= 3) result.push({ ...face, points: unique });
  }
  if (inside && outside && intersections.size >= 3) {
    const points = [...intersections.values()], center = points.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / points.length);
    const u = new Vector3().crossVectors(Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), normal).normalize();
    const v = new Vector3().crossVectors(normal, u);
    points.sort((a, b) => Math.atan2(v.dot(a.clone().sub(center)), u.dot(a.clone().sub(center))) - Math.atan2(v.dot(b.clone().sub(center)), u.dot(b.clone().sub(center))));
    result.push({ points, color: cut, paint: 0 });
  }
  return result;
}

/** Deterministic, staggered seeds create irregular three-dimensional cells. */
export function barrelFractureSeeds(): Vector3[] {
  const random = seededRandom(5183), seeds: Vector3[] = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 6; i++) {
    const angle = (i + layer * .43 + (random() - .5) * .32) / 6 * Math.PI * 2, radius = .14 + random() * .15;
    seeds.push(new Vector3(Math.cos(angle) * radius, .14 + layer * .36 + (random() - .5) * .15, Math.sin(angle) * radius));
  }
  return seeds;
}

/** Partition the actual source solids, retaining their paint, bands and label.
 * This runs once when the effect owner is constructed, never on a hit. */
export function createVoronoiFragments(source: Group, seeds: readonly Vector3[], paintColor: number): FracturePiece[] {
  const solids = sourceSolids(source, paintColor), cut = new Color(0x666a64), pieces: FracturePiece[] = [];
  for (let cell = 0; cell < seeds.length; cell++) {
    const clipped: Face[] = [];
    for (const original of solids) {
      let faces = original;
      for (let neighbor = 0; neighbor < seeds.length && faces.length; neighbor++) {
        if (neighbor === cell) continue;
        const normal = seeds[neighbor].clone().sub(seeds[cell]);
        const offset = (seeds[neighbor].lengthSq() - seeds[cell].lengthSq()) / 2;
        const length = normal.length();
        if (length < EPS) throw new Error('Fracture seeds must be distinct');
        faces = clipSolid(faces, normal.multiplyScalar(1 / length), offset / length, cut);
      }
      clipped.push(...faces);
    }
    const triangles: { a: Vector3; b: Vector3; c: Vector3; color: Color; paint: number }[] = [];
    let volume = 0; const center = new Vector3();
    for (const face of clipped) for (let i = 1; i < face.points.length - 1; i++) {
      const [a, b, c] = [face.points[0], face.points[i], face.points[i + 1]];
      if (new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).lengthSq() < EPS * EPS) continue;
      const tetra = a.dot(new Vector3().crossVectors(b, c)) / 6;
      volume += tetra; center.addScaledVector(a.clone().add(b).add(c), tetra / 4);
      triangles.push({ a, b, c, color: face.color, paint: face.paint });
    }
    if (volume < EPS) continue;
    center.multiplyScalar(1 / volume);
    const positions: number[] = [], colors: number[] = [], paint: number[] = [];
    for (const tri of triangles) for (const p of [tri.a, tri.b, tri.c]) {
      positions.push(p.x - center.x, p.y - center.y, p.z - center.z); colors.push(tri.color.r, tri.color.g, tri.color.b); paint.push(tri.paint);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('paintMask', new Float32BufferAttribute(paint, 1));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    pieces.push({ geometry, center, volume, radius: geometry.boundingSphere!.radius });
  }
  return pieces;
}
