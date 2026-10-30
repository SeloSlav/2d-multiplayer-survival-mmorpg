import {
  BufferGeometry, DataTexture, Float32BufferAttribute, Group, LinearFilter,
  LinearMipmapLinearFilter, Mesh, RepeatWrapping, RGBAFormat, SRGBColorSpace,
} from 'three/webgpu';
import { ModelKit } from './modelKit';

type Point = [number, number, number];
type UV = [number, number];
const KERCHIEF_RIM = { radiusX: .198, radiusY: .218, z: .241, segments: 20 };
let kerchiefPixels: Uint8Array | undefined;

/** Deterministic painted cotton, including the flowers and leaves. There are
 * no ornament meshes, raised petals, normal maps, or per-flower draw calls. */
export function createKerchiefTexture(): DataTexture {
  const size=512,data=kerchiefPixels??new Uint8Array(size*size*4);
  const motifs=[[.22,.22,.078,.2],[.70,.39,.072,1.1],[.24,.75,.077,2.3],[.80,.87,.060,.7],[.73,.17,.077,1.6]];
  const wrap=(v:number)=>v-Math.round(v);
  if(!kerchiefPixels)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=(x+.5)/size,v=(y+.5)/size;
    const brush=Math.sin(u*31+Math.sin(v*19))*.018+Math.cos(v*43-u*13)*.012;
    let rgb=[197,48,48],shade=1+brush;
    for(const [cx,cy,r,rotation] of motifs){
      const dx=wrap(u-cx),dy=wrap(v-cy);
      // Pointed olive leaves on short stems beside each blossom.
      for(const sign of [-1,1]){
        const a=rotation+sign*.8,along=dx*Math.cos(a)+dy*Math.sin(a)-r*1.35;
        const across=-dx*Math.sin(a)+dy*Math.cos(a);
        const leafWidth=r*.34*Math.max(0,1-(along/(r*.8))**2);
        if(Math.abs(along)<r*.8&&Math.abs(across)<leafWidth){
          rgb=sign>0?[132,145,65]:[104,125,52];shade=1+brush+(across>0?.06:-.04);
        }
      }
      const angle=Math.atan2(dy,dx)-rotation,distance=Math.hypot(dx,dy);
      const edge=r*(.74+.23*Math.cos(angle*5)+.025*Math.sin(angle*11));
      if(distance<edge){rgb=[239,220,177];shade=1+brush+Math.sin(angle*3)*.025;}
      if(distance<r*.22){rgb=[210,130,81];shade=1+brush;}
    }
    const i=(y*size+x)*4;
    for(let c=0;c<3;c++)data[i+c]=Math.min(255,Math.max(0,Math.round(rgb[c]*shade)));
    data[i+3]=255;
  }
  kerchiefPixels=data;
  const texture=new DataTexture(data,size,size,RGBAFormat);
  texture.name='babushka-painted-floral-cotton';texture.colorSpace=SRGBColorSpace;
  texture.wrapS=texture.wrapT=RepeatWrapping;texture.generateMipmaps=true;
  texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.anisotropy=4;
  texture.needsUpdate=true;return texture;
}

export class ScarfCloth {
  private readonly positions:number[]=[];
  private readonly uvs:number[]=[];
  triangle(a:Point,b:Point,c:Point,ua:UV,ub:UV,uc:UV):void {
    this.positions.push(...a,...b,...c);this.uvs.push(...ua,...ub,...uc);
  }
  quad(a:Point,b:Point,c:Point,d:Point,ua:UV,ub:UV,uc:UV,ud:UV):void {
    this.triangle(a,b,c,ua,ub,uc);this.triangle(a,c,d,ua,uc,ud);
  }
  add(kit:ModelKit,parent:Group):Mesh {
    const geometry=new BufferGeometry();
    geometry.setAttribute('position',new Float32BufferAttribute(this.positions,3));
    geometry.setAttribute('uv',new Float32BufferAttribute(this.uvs,2));geometry.computeVertexNormals();
    const mesh=new Mesh(kit.ownGeometry(geometry),kit.texturedMaterial('babushka-cotton',createKerchiefTexture));
    mesh.name='babushka-textured-cloth';mesh.castShadow=mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
}

/** Closed hood behind a real face opening. UV distance follows the cloth. */
export function createKerchiefHood(kit:ModelKit,parent:Group):void {
  const count=KERCHIEF_RIM.segments,cloth=new ScarfCloth();
  const profiles=[[KERCHIEF_RIM.radiusX,KERCHIEF_RIM.radiusY,KERCHIEF_RIM.z,0],[.216,.236,.229,.05],[.269,.285,.070,.38],[.225,.245,-.178,.91],[.13,.15,-.25,1.14]];
  const rings=profiles.map(([rx,ry,z],row)=>Array.from({length:count},(_,i):Point=>{
    const a=i/count*Math.PI*2,drop=row>=3?Math.max(0,-Math.sin(a))**2*.065:0;
    return[Math.cos(a)*rx,.115+Math.sin(a)*ry-drop,z];
  }));
  for(let row=0;row<rings.length-1;row++)for(let i=0;i<count;i++){
    const j=(i+1)%count,u=i/count*3.35,next=(i+1)/count*3.35,v=profiles[row][3],nv=profiles[row+1][3];
    cloth.quad(rings[row][i],rings[row+1][i],rings[row+1][j],rings[row][j],[u,v],[u,nv],[next,nv],[next,v]);
  }
  for(let i=0;i<count;i++){
    const j=(i+1)%count,a=rings[rings.length-1][i],b=rings[rings.length-1][j];
    cloth.triangle(a,[0,.10,-.277],b,[a[0]/.5+.5,a[1]/.5+.5],[.5,.7],[b[0]/.5+.5,b[1]/.5+.5]);
  }
  cloth.add(kit,parent);
}

/** A broad fold joins the exact hood rim to the knot under the chin. It is
 * part of the ties so chest armor can replace all fabric below the jaw. */
export function addKerchiefGather(cloth:ScarfCloth):void {
  const {radiusX,radiusY,z,segments}=KERCHIEF_RIM;
  const rows=Array.from({length:7},(_,index)=>{
    const i=index+12,a=i/segments*Math.PI*2,gather=Math.max(0,-Math.sin(a))**6;
    const top:Point=[Math.cos(a)*radiusX,.115+Math.sin(a)*radiusY,z];
    const bottom:Point=[top[0],top[1]-gather*.065,z+gather*.016];
    return{top,bottom,u:i/segments*3.35,v:gather*.18};
  });
  const back=([x,y,z]:Point):Point=>[x,y,z-.008];
  for(let i=0;i<rows.length-1;i++){
    const a=rows[i],b=rows[i+1],at:UV=[a.u,0],ab:UV=[a.u,a.v],bt:UV=[b.u,0],bb:UV=[b.u,b.v];
    cloth.quad(a.top,a.bottom,b.bottom,b.top,at,ab,bb,bt);
    cloth.quad(back(b.top),back(b.bottom),back(a.bottom),back(a.top),bt,bb,ab,at);
    cloth.quad(a.top,b.top,back(b.top),back(a.top),at,bt,bt,at);
    cloth.quad(b.bottom,a.bottom,back(a.bottom),back(b.bottom),bb,ab,ab,bb);
  }
  for(const index of [0,rows.length-1]){
    const {top,bottom,u,v}=rows[index],points=[top,back(top),back(bottom),bottom];
    const uv:UV[]=[[u,0],[u,0],[u,v],[u,v]];
    if(index>0){points.reverse();uv.reverse();}
    cloth.quad(points[0],points[1],points[2],points[3],uv[0],uv[1],uv[2],uv[3]);
  }
}

/** A soft nape drape. The hood and hanging ties own the front of the neck;
 * keeping this cloth behind them avoids a razor-thin horizontal collar. */
export function createShoulderKerchief(kit:ModelKit,parent:Group):void {
  const count=20,cloth=new ScarfCloth();
  const rows=[[.145,.125,1.265],[.205,.18,1.20],[.238,.225,1.105]];
  const rings=rows.map(([rx,rz,y],row)=>Array.from({length:count},(_,i):Point=>{
    const a=.49*Math.PI+i/(count-1)*1.02*Math.PI,back=Math.max(0,-Math.cos(a));
    // Side edges fall vertically beneath the hood and into the shoulders.
    return[Math.sin(a)*rx,y-back*row*.018,Math.cos(a)*rz-.025];
  }));
  for(let row=0;row<rows.length-1;row++)for(let i=0;i<count-1;i++){
    const j=i+1,a=rings[row][i],b=rings[row+1][i],c=rings[row+1][j],d=rings[row][j];
    const uv=([x,,z]:Point):UV=>[x/.48+.7,z/.48+.39];
    cloth.quad(a,b,c,d,uv(a),uv(b),uv(c),uv(d));
    // The underside is the same woven cloth, not a floating ornament layer.
    const under=(p:Point):Point=>[p[0],p[1]-.006,p[2]];
    cloth.quad(under(d),under(c),under(b),under(a),uv(d),uv(c),uv(b),uv(a));
  }
  cloth.add(kit,parent);
}
