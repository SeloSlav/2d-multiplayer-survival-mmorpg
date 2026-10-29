import type { TerrainTile } from './terrainField';
import { GROUND_Y_SCALE, WORLD_3D } from './visualContract';
export interface TerrainGroundData { positions:Float32Array; normals:Float32Array; coordinates:Float32Array; indices:Uint32Array }

/** Pure typed-array mesh builder; runs in the terrain worker without Three.js. */
export function createTerrainGroundData(tiles: readonly TerrainTile[], depthAt: (x:number,y:number)=>number): TerrainGroundData {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for (const tile of tiles) { const x=tile.worldX??0,y=tile.worldY??0; minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); }
  if (!tiles.length) return {positions:new Float32Array(),normals:new Float32Array(),coordinates:new Float32Array(),indices:new Uint32Array()};
  const width=(maxX-minX+1)*2+1,height=(maxY-minY+1)*2+1;
  const vertices=new Int32Array(width*height).fill(-1), p=new Float32Array(width*height*3), uv=new Float32Array(width*height*2);
  const indices=new Uint32Array(tiles.length*24); let count=0, cursor=0;
  const vertex=(x:number,y:number) => {
    const slot=(y-minY*2)*width+x-minX*2, previous=vertices[slot]; if (previous>=0) return previous;
    const i=count++,depth=depthAt(x*24,y*24); vertices[slot]=i;
    p[i*3]=x/2;p[i*3+1]=-depth;p[i*3+2]=y/2*GROUND_Y_SCALE-depth/Math.tan(WORLD_3D.elevationRadians);
    uv[i*2]=x/2;uv[i*2+1]=y/2;return i;
  };
  for (const tile of tiles) {
    const x=(tile.worldX??0)*2,y=(tile.worldY??0)*2;
    for (let j=0;j<2;j++) for (let i=0;i<2;i++) {
      const a=vertex(x+i,y+j),b=vertex(x+i+1,y+j),c=vertex(x+i+1,y+j+1),d=vertex(x+i,y+j+1);
      indices[cursor++]=a;indices[cursor++]=c;indices[cursor++]=b;indices[cursor++]=a;indices[cursor++]=d;indices[cursor++]=c;
    }
  }
  const positions=p.slice(0,count*3),coordinates=uv.slice(0,count*2),normals=new Float32Array(count*3);
  for (let i=0;i<indices.length;i+=3) {
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const ax=positions[a]-positions[b],ay=positions[a+1]-positions[b+1],az=positions[a+2]-positions[b+2];
    const cx=positions[c]-positions[b],cy=positions[c+1]-positions[b+1],cz=positions[c+2]-positions[b+2];
    const nx=cy*az-cz*ay,ny=cz*ax-cx*az,nz=cx*ay-cy*ax;
    for (const v of [a,b,c]) {normals[v]+=nx;normals[v+1]+=ny;normals[v+2]+=nz;}
  }
  for (let i=0;i<normals.length;i+=3) { const length=Math.hypot(normals[i],normals[i+1],normals[i+2])||1;normals[i]/=length;normals[i+1]/=length;normals[i+2]/=length; }
  return {positions,normals,coordinates,indices};
}
