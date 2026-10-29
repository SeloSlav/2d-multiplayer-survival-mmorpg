import {
  BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry,
  EqualDepth, Float32BufferAttribute, Group, Matrix3, Mesh, MeshStandardMaterial, Quaternion, ShapeUtils, Vector2, Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GroundPoint } from './buildingPlan';

type PartKind = 'box' | 'rock' | 'cone' | 'cylinder' | 'skirt' | 'leaf';

/** Resource ownership belongs to the kit, never individual entity clones. */
export class ModelKit {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly compiled = new Set<BufferGeometry>();
  private readonly assemblies = new Map<string, Group>();
  private debugMode: 'lit' | 'unlit' | 'wireframe' = 'lit';

  material(color: number, emissive = false): MeshStandardMaterial {
    const key = `${color}:${emissive}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new MeshStandardMaterial({ color, roughness: 0.92, flatShading: true,
        emissive: emissive ? color : 0, emissiveIntensity: emissive ? 2.5 : 0 });
      material.wireframe = this.debugMode === 'wireframe';
      this.materials.set(key, material);
    }
    return material;
  }

  fadedMaterial(source:MeshStandardMaterial,opacity:number):MeshStandardMaterial {
    const key=`fade:${source.uuid}:${opacity}`;let material=this.materials.get(key);
    if(!material){material=source.clone();material.transparent=true;material.opacity=opacity;material.depthWrite=false;this.materials.set(key,material);}
    return material;
  }

  cutawayMaterials(source:MeshStandardMaterial,opacity:number):{color:MeshStandardMaterial;depth:MeshStandardMaterial} {
    const color=this.fadedMaterial(source,opacity);color.depthFunc=EqualDepth;
    const key=`cutaway-depth:${source.uuid}`;let depth=this.materials.get(key);
    if(!depth){depth=source.clone();depth.transparent=true;depth.opacity=1;depth.colorWrite=false;depth.depthWrite=true;this.materials.set(key,depth);}
    return {color,depth};
  }

  geometry(kind: PartKind): BufferGeometry {
    let geometry = this.geometries.get(kind);
    if (!geometry) {
      if (kind === 'leaf') {
        // A pointed, closed leaf with a raised midrib. The petiole is at z=0;
        // transforms pivot there, rather than at the middle of a flat card.
        const rim = [[0, 0, 0], [-0.4, 0, 0.28], [-0.5, 0, 0.58], [0, 0, 1], [0.5, 0, 0.58], [0.4, 0, 0.28]];
        const positions: number[] = [];
        rim.forEach((a, i) => {
          const b = rim[(i + 1) % rim.length];
          positions.push(0, 0.5, 0.48, ...a, ...b, 0, -0.5, 0.48, ...b, ...a);
        });
        geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
      } else geometry = kind === 'box' ? new BoxGeometry(1, 1, 1)
        : kind === 'rock' ? new DodecahedronGeometry(0.5, 0)
        : kind === 'cone' ? new ConeGeometry(0.5, 1, 7)
        : kind === 'skirt' ? new CylinderGeometry(0.34, 0.5, 1, 8)
        : new CylinderGeometry(0.5, 0.5, 1, 8);
      // Consistent attributes allow material-slot compilation.
      if (geometry.index) geometry = geometry.toNonIndexed();
      geometry.deleteAttribute('uv');
      this.geometries.set(kind, geometry);
    }
    return geometry;
  }

  part(parent: Group, kind: PartKind, color: number,
    size: [number, number, number], position: [number, number, number], emissive = false): Mesh {
    const mesh = new Mesh(this.geometry(kind), this.material(color, emissive));
    mesh.scale.set(...size);
    mesh.position.set(...position);
    mesh.castShadow = !emissive;
    mesh.receiveShadow = !emissive;
    parent.add(mesh);
    return mesh;
  }

  beam(parent: Group, color: number, start: Vector3, end: Vector3, radius: number): Mesh {
    const delta = end.clone().sub(start);
    const mesh = this.part(parent, 'cylinder', color, [radius * 2, delta.length(), radius * 2],
      start.clone().add(end).multiplyScalar(0.5).toArray() as [number, number, number]);
    mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), delta.normalize()));
    return mesh;
  }

  /** Closed tapered branch, with rings following the growth direction. */
  branch(parent: Group, color: number, points: readonly Vector3[], radii: readonly number[], segments = 6): Mesh {
    const key = `branch:${segments}:${points.map((p, i) => `${p.toArray().join(',')},${radii[i]}`).join(';')}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      const positions: number[] = [], rings: Vector3[][] = [];
      const normal = new Vector3(1, 0, 0);
      for (let i = 0; i < points.length; i++) {
        const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
        normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
        if (normal.lengthSq() < .1) normal.set(0, 0, 1).addScaledVector(tangent, -tangent.z).normalize();
        const binormal = new Vector3().crossVectors(tangent, normal).normalize();
        rings.push(Array.from({ length: segments }, (_, j) => points[i].clone()
          .addScaledVector(normal, Math.cos(j / segments * Math.PI * 2) * radii[i])
          .addScaledVector(binormal, Math.sin(j / segments * Math.PI * 2) * radii[i])));
      }
      const tri = (a: Vector3, b: Vector3, c: Vector3) => positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      for (let i = 1; i < rings.length; i++) for (let j = 0; j < segments; j++) {
        const k = (j + 1) % segments;
        tri(rings[i - 1][j], rings[i][k], rings[i][j]);
        tri(rings[i - 1][j], rings[i - 1][k], rings[i][k]);
      }
      for (let j = 1; j < segments - 1; j++) {
        tri(rings[0][0], rings[0][j + 1], rings[0][j]);
        const last = rings[rings.length - 1]; tri(last[0], last[j], last[j + 1]);
      }
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals(); this.geometries.set(key, geometry);
    }
    const mesh = new Mesh(geometry, this.material(color));
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }

  /** Closed simple-polygon extrusion with separate cap/side normals and outward winding. */
  prism(parent: Group, color: number, polygon: readonly GroundPoint[], bottom: number, top: number): Mesh {
    if (polygon.length < 3 || top <= bottom) throw new Error('A prism requires a positive volume');
    const key = `prism:${bottom}:${top}:${polygon.map(point => point.join(',')).join(';')}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      const positions: number[] = [];
      const vertex = (p: GroundPoint, y: number) => positions.push(p[0], y, p[1]);
      const caps = ShapeUtils.triangulateShape(polygon.map(point => new Vector2(...point)), []);
      for (const [a, b, c] of caps) {
        vertex(polygon[a], top); vertex(polygon[c], top); vertex(polygon[b], top);
        vertex(polygon[a], bottom); vertex(polygon[b], bottom); vertex(polygon[c], bottom);
      }
      polygon.forEach((a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        vertex(a, bottom); vertex(b, top); vertex(b, bottom);
        vertex(a, bottom); vertex(a, top); vertex(b, top);
      });
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      this.geometries.set(key, geometry);
    }
    const mesh = new Mesh(geometry, this.material(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Closed tapered vessel: outward/inner walls and both annular rims are owned. */
  vessel(parent: Group, color: number, bottomRadius: number, topRadius: number, thickness: number, height: number, segments = 12): Mesh {
    const key = `vessel:${bottomRadius}:${topRadius}:${thickness}:${height}:${segments}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      const positions: number[] = [];
      const point = (angle: number, radius: number, y: number): number[] => [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
      const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2;
        const b = (i + 1) / segments * Math.PI * 2;
        const aob = point(a, bottomRadius, 0), aot = point(a, topRadius, height);
        const bob = point(b, bottomRadius, 0), bot = point(b, topRadius, height);
        const aib = point(a, bottomRadius - thickness, 0), ait = point(a, topRadius - thickness, height);
        const bib = point(b, bottomRadius - thickness, 0), bit = point(b, topRadius - thickness, height);
        quad(aob, aot, bot, bob); quad(aib, bib, bit, ait);
        quad(aot, ait, bit, bot); quad(aob, bob, bib, aib);
      }
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      this.geometries.set(key, geometry);
    }
    const mesh = new Mesh(geometry, this.material(color));
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Static semantic assemblies compile to one geometry per material. */
  compileShared(group: Group, key: string): Group {
    let assembly = this.assemblies.get(key);
    if (!assembly) { assembly = this.compile(group); this.assemblies.set(key, assembly); }
    return assembly.clone(true);
  }

  /** Static semantic assemblies compile to one geometry per material. */
  compile(group: Group): Group {
    group.updateMatrixWorld(true);
    const slots = new Map<MeshStandardMaterial, Mesh[]>();
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      const list = slots.get(material) ?? [];
      list.push(object);
      slots.set(material, list);
    });
    const result = new Group(), normalMatrix = new Matrix3();
    for (const [material, meshes] of slots) {
      const count=meshes.reduce((n,mesh)=>n+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count),0);
      const positions=new Float32Array(count*3),normals=new Float32Array(count*3);let offset=0;
      // Write transformed vertices straight into their final material slot.
      // Cloning/transforming/discarding one BufferGeometry per leaf generated
      // thousands of short-lived buffers when a new tree variant entered view.
      for(const source of meshes){
        const geometry=source.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),index=geometry.index;
        const matrix=source.matrixWorld.elements;normalMatrix.getNormalMatrix(source.matrixWorld);const normal=normalMatrix.elements;
        const length=index?.count??p.count;
        for(let i=0;i<length;i++){
          const v=index?index.getX(i):i,x=p.getX(v),y=p.getY(v),z=p.getZ(v);
          const w=1/(matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15]);
          positions[offset]=(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])*w;
          positions[offset+1]=(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])*w;
          positions[offset+2]=(matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])*w;
          const nx=n.getX(v),ny=n.getY(v),nz=n.getZ(v);
          const ax=normal[0]*nx+normal[3]*ny+normal[6]*nz,ay=normal[1]*nx+normal[4]*ny+normal[7]*nz,az=normal[2]*nx+normal[5]*ny+normal[8]*nz;
          const magnitude=Math.hypot(ax,ay,az)||1;
          normals[offset]=ax/magnitude;normals[offset+1]=ay/magnitude;normals[offset+2]=az/magnitude;offset+=3;
        }
      }
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));
      geometry.computeBoundingSphere();
      this.compiled.add(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      result.add(mesh);
    }
    return result;
  }

  /** Static scenery uses per-vertex pigment instead of a draw per paint color.
   * Preserve the exact linear colors, normals and silhouettes. Glowing parts
   * retain their own emissive material and are never folded into the pigment. */
  compileColored(group: Group): Group {
    const result=new Group(), geometries:BufferGeometry[]=[];
    result.name=group.name;result.userData={...group.userData};group.updateMatrixWorld(true);
    group.traverse(object=>{
      if(!(object instanceof Mesh)||Array.isArray(object.material))return;
      const material=object.material as MeshStandardMaterial;
      if(material.emissive.getHex()!==0||material.transparent||material.map){
        const copy=object.clone();copy.matrix.copy(object.matrixWorld);copy.matrix.decompose(copy.position,copy.quaternion,copy.scale);result.add(copy);return;
      }
      const geometry=object.geometry.clone().applyMatrix4(object.matrixWorld);
      const colors=new Float32Array(geometry.attributes.position.count*3);
      for(let i=0;i<colors.length;i+=3){colors[i]=material.color.r;colors[i+1]=material.color.g;colors[i+2]=material.color.b;}
      geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometries.push(geometry);
    });
    if(geometries.length){
      const geometry=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());
      if(!geometry)throw new Error('Incompatible static pigment geometry');
      geometry.computeBoundingSphere();this.compiled.add(geometry);
      let material=this.materials.get('static-vertex-colors');
      if(!material){material=new MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.92,flatShading:true,wireframe:this.debugMode==='wireframe'});this.materials.set('static-vertex-colors',material);}
      const mesh=new Mesh(geometry,material);mesh.castShadow=mesh.receiveShadow=true;result.add(mesh);
    }
    return result;
  }

  setDebug(mode: 'lit' | 'unlit' | 'wireframe'): void {
    this.debugMode = mode;
    for (const material of this.materials.values()) {
      material.wireframe = mode === 'wireframe';
      material.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometries.forEach((geometry) => geometry.dispose());
    this.compiled.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries.clear();
    this.compiled.clear();
    this.assemblies.clear();
    this.materials.clear();
  }
}

export const COLORS = {
  bark: 0x66513c, barkLight: 0x8e7652, pineDark: 0x334c3c, pine: 0x4d6650,
  leaf: 0x788451, leafLight: 0x96a15f, stone: 0x8d9390, stoneDark: 0x626d6c,
  wood: 0x98724c, woodDark: 0x624a35, iron: 0x535e62, steel: 0xb3c2bb,
  cloth: 0x80918a, leather: 0x66513e, skin: 0xd0a17a, coal: 0x343b3c,
  ember: 0xe86d35, flame: 0xffbf63, bone: 0xe0d5b7,
  dress: 0x397e87, scarf: 0xa64b4c, scarfShadow: 0x773e43, apron: 0xa99b87,
} as const;
