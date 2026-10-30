import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, ShapeUtils, Vector2, Vector3 } from 'three/webgpu';
import { ModelKit } from './modelKit';
import { addKerchiefGather, createKerchiefHood, createShoulderKerchief, ScarfCloth } from './survivorFabric';

// Cosmetic coordinates are local to the existing head/torso. Never move joints
// or grip sockets to accommodate clothing; equipment owns the outer envelope.
const P = {
  scarf: 0xc93937, scarfLight: 0xe44d44, scarfDark: 0x963c3c,
  linen: 0xedd1a1, linenShade: 0xcab18b, stitch: 0xf2dfba,
  hair: 0xc4c6c1, hairShade: 0x929891, hairLight: 0xe1e0d8,
  skin: 0xf2ad82, cheek: 0xf28e73, nose: 0xee8d70, eye: 0x30261f,
  leather: 0x62432e, leatherLight: 0x88613f, vest: 0x514035,
  leaf: 0x8e9949, leafShade: 0x6c7c35,
} as const;
export const BABUSHKA_SKIN = P.skin;
type Point = [number, number, number];
const SKIRT_PROFILE = [[.24,.395,.305],[.30,.39,.30],[.53,.344,.266],[.73,.30,.231],[.92,.268,.208]] as const;

function skirtFront(x: number, y: number): number {
  let row=0;while(row<SKIRT_PROFILE.length-2&&y>SKIRT_PROFILE[row+1][0])row++;
  const a=SKIRT_PROFILE[row],b=SKIRT_PROFILE[row+1],t=Math.min(1,Math.max(0,(y-a[0])/(b[0]-a[0])));
  const rx=a[1]+(b[1]-a[1])*t,rz=a[2]+(b[2]-a[2])*t;
  return rz*Math.sqrt(Math.max(0,1-(x/rx)**2));
}

function vestFront(x: number, y: number): number {
  const torso=.195*Math.sqrt(Math.max(.01,1-(x/.29)**2-((y-1.02)/.32)**2));
  return Math.max(torso,y<.95?skirtFront(x,y):0)+.013;
}

export interface SurvivorClothing {
  headwear: Group;
  scarfTie: Group;
  face: Group;
  collar: Group;
  apron: Group;
  satchel: Group;
  vest: Group;
  belt: Group;
  boots: Group[];
  hands: Group[];
  drape: Mesh[];
}

const caches = new WeakMap<ModelKit, Map<string, Group>>();

/** Painted facets and textured cloth compile independently. Templates and the
 * floral texture are shared by players and owned by ModelKit. */
function layer(kit: ModelKit, parent: Group, name: string, key: string, build: (group: Group) => void): Group {
  let cache = caches.get(kit);
  if (!cache) { cache = new Map(); caches.set(kit, cache); }
  let template = cache.get(key);
  if (!template) {
    const source = new Group(); build(source);
    template = kit.compileColored(source);
    if(name==='babushka-skirt'||name==='babushka-apron')template.traverse(object=>{
      if(object instanceof Mesh)addStrideDrape(object);
    });
    // Broad deterministic pigment changes reinforce the painted facets without
    // introducing noisy textures or another draw call per color.
    const amount=name==='babushka-apron'?.24:name==='babushka-vest'||name==='babushka-skirt'?.16:0;
    if(amount)template.traverse(object=>{
      if(!(object instanceof Mesh))return;const pigment=object.geometry.getAttribute('color');if(!pigment)return;
      for(let i=0;i<pigment.count;i+=3){
        const shade=1+(((i*17)%13)/12-.5)*amount;
        for(let v=i;v<i+3;v++)pigment.setXYZ(v,pigment.getX(v)*shade,pigment.getY(v)*shade,pigment.getZ(v)*shade);
      }
    });
    cache.set(key, template);
  }
  const result = template.clone(true); result.name = name; result.userData.survivorAppearance = true; parent.add(result);
  return result;
}

/** Shared morph buffers let the skirt make room for the existing leg swing.
 * Influences belong to each mesh instance; bones, sockets and UVs stay fixed. */
function addStrideDrape(mesh:Mesh):void {
  const geometry=mesh.geometry,p=geometry.getAttribute('position'),n=geometry.getAttribute('normal');
  geometry.computeBoundingBox(); // Grounding retains the original rest envelope.
  const positions:Float32BufferAttribute[]=[],normals:Float32BufferAttribute[]=[];
  for(const sign of [1,-1]){
    const target=geometry.clone(),tp=target.getAttribute('position'),delta=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++){
      const flex=Math.min(1,Math.max(0,(.90-p.getY(i))/.58));
      const side=Math.min(1,Math.max(0,sign*p.getZ(i)/.20));
      const shift=sign*.43*flex*side;
      tp.setZ(i,p.getZ(i)+shift);delta[i*3+2]=shift;
    }
    target.computeVertexNormals();const tn=target.getAttribute('normal'),normalDelta=new Float32Array(p.count*3);
    for(let i=0;i<p.count;i++)normalDelta.set([tn.getX(i)-n.getX(i),tn.getY(i)-n.getY(i),tn.getZ(i)-n.getZ(i)],i*3);
    positions.push(new Float32BufferAttribute(delta,3));normals.push(new Float32BufferAttribute(normalDelta,3));target.dispose();
  }
  geometry.morphTargetsRelative=true;geometry.morphAttributes.position=positions;geometry.morphAttributes.normal=normals;
  geometry.computeBoundingSphere();mesh.updateMorphTargets();
}

export function updateSurvivorDrape(clothing:SurvivorClothing,forward:number,backward:number):void {
  for(const mesh of clothing.drape){mesh.morphTargetInfluences![0]=forward;mesh.morphTargetInfluences![1]=backward;}
}

/** Closed, shallow cloth relief. The outline is counter-clockwise from +Z. */
function panel(kit: ModelKit, group: Group, color: number, outline: Point[], depth = .008): void {
  const positions: number[] = [];
  const tri = (a: Point, b: Point, c: Point) => positions.push(...a, ...b, ...c);
  const back = outline.map(([x, y, z]): Point => [x, y, z - depth]);
  const normal=new Vector3();
  outline.forEach((point,i)=>normal.add(new Vector3(...point).cross(new Vector3(...outline[(i+1)%outline.length]))));
  const axis=Math.abs(normal.z)>=Math.max(Math.abs(normal.x),Math.abs(normal.y))?'z':Math.abs(normal.y)>Math.abs(normal.x)?'y':'x';
  const contour=outline.map(([x,y,z])=>axis==='z'?new Vector2(x,y):axis==='y'?new Vector2(x,z):new Vector2(y,z));
  for (const [a,b,c] of ShapeUtils.triangulateShape(contour,[])) {
    const cross=new Vector3(...outline[b]).sub(new Vector3(...outline[a])).cross(new Vector3(...outline[c]).sub(new Vector3(...outline[a])));
    if(cross.dot(normal)>=0){tri(outline[a],outline[b],outline[c]);tri(back[a],back[c],back[b]);}
    else {tri(outline[a],outline[c],outline[b]);tri(back[a],back[b],back[c]);}
  }
  outline.forEach((a, i) => {
    const j = (i + 1) % outline.length;
    tri(a, back[i], back[j]); tri(a, back[j], outline[j]);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  group.add(new Mesh(kit.ownGeometry(geometry), kit.material(color)));
}

function oval(kit: ModelKit, group: Group, color: number, size: Point, position: Point): Mesh {
  const geometry = new IcosahedronGeometry(.5, 2);
  geometry.deleteAttribute('uv');
  const mesh = new Mesh(kit.ownGeometry(geometry), kit.material(color));
  mesh.scale.set(...size); mesh.position.set(...position); group.add(mesh); return mesh;
}

/** A connected cloth sheet with a closed edge. Rows run from bottom to top,
 * columns from left to right; intermediate samples follow the body surface. */
function clothGrid(kit: ModelKit, group: Group, grid: Point[][], pigment: (row: number, col: number) => number): void {
  const positions:number[]=[],colors:number[]=[];
  const back=([x,y,z]:Point):Point=>[x,y,z-.006];
  const tri=(a:Point,b:Point,c:Point,color:number)=>{
    positions.push(...a,...b,...c);const p=new Color(color);for(let i=0;i<3;i++)colors.push(p.r,p.g,p.b);
  };
  for(let row=0;row<grid.length-1;row++)for(let col=0;col<grid[0].length-1;col++){
    const a=grid[row][col],b=grid[row][col+1],c=grid[row+1][col+1],d=grid[row+1][col],color=pigment(row,col);
    tri(a,b,c,color);tri(a,c,d,color);tri(back(a),back(c),back(b),color);tri(back(a),back(d),back(c),color);
  }
  const last=grid.length-1,right=grid[0].length-1;
  const rim=[...grid[0],...grid.slice(1).map(row=>row[right]),...grid[last].slice(0,-1).reverse(),...grid.slice(1,-1).reverse().map(row=>row[0])];
  rim.forEach((a,i)=>{const b=rim[(i+1)%rim.length];tri(a,back(a),back(b),pigment(0,0));tri(a,back(b),b,pigment(0,0));});
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  group.add(new Mesh(kit.ownGeometry(geometry),kit.material(0xffffff)));
}

function kerchiefTie(kit: ModelKit, g: Group): void {
  const cloth=new ScarfCloth();
  addKerchiefGather(cloth);
  for(const sign of [-1,1]){
    // Broad fabric folds emerge inside the knot, bow out over the chest and
    // taper to curled tips. Both surfaces and the hem belong to a closed mesh.
    const rows=[[0,.018,.019],[.18,.034,.037],[.45,.044,.055],[.72,.037,.073],[1,.002,.088]];
    const columns=[-1,-.5,0,.5,1];
    const front=rows.map(([t,width,x])=>columns.map((u):Point=>{
      const fold=Math.sin(Math.PI*t);
      return[sign*x+u*width,-.166-t*.235+u*t*.008*sign,
        .247+fold*.008+t*.010+(1-u*u)*(.010+fold*.029)+u*t*.008*sign];
    }));
    const back=front.map((row,i)=>row.map(([x,y,z]):Point=>[x,y,z-(i===rows.length-1?.006:.012)]));
    const uv=(row:number,col:number):[number,number]=>[
      columns[col]*rows[row][1]/.4+(sign<0?.22:.70),
      -rows[row][0]*.235/.4+(sign<0?.97:.64)];
    // Rows run downward: reverse the front winding to face out from the body.
    for(let row=0;row<rows.length-1;row++)for(let col=0;col<columns.length-1;col++){
      const a=front[row][col],b=front[row][col+1],c=front[row+1][col+1],d=front[row+1][col];
      const ua=uv(row,col),ub=uv(row,col+1),uc=uv(row+1,col+1),ud=uv(row+1,col);
      cloth.quad(d,c,b,a,ud,uc,ub,ua);
      cloth.quad(back[row][col],back[row][col+1],back[row+1][col+1],back[row+1][col],ua,ub,uc,ud);
    }
    const last=rows.length-1,right=columns.length-1;
    const rim:[number,number][]=[...columns.map((_,col):[number,number]=>[0,col]),
      ...rows.slice(1).map((_,i):[number,number]=>[i+1,right]),
      ...columns.slice(0,-1).map((_,i):[number,number]=>[last,right-i-1]),
      ...rows.slice(1,-1).map((_,i):[number,number]=>[last-i-1,0])];
    rim.forEach(([r,c],i)=>{
      const [nr,nc]=rim[(i+1)%rim.length];
      cloth.quad(front[r][c],front[nr][nc],back[nr][nc],back[r][c],uv(r,c),uv(nr,nc),uv(nr,nc),uv(r,c));
    });
  }
  cloth.add(kit,g);
  kit.part(g,'rock',P.scarfLight,[.087,.087,.082],[0,-.16,.267]);
}

function face(kit: ModelKit, g: Group): void {
  const skin = new IcosahedronGeometry(.5, 3);
  skin.deleteAttribute('uv'); skin.scale(.384, .418, .252); skin.translate(0, .079, .167);
  const p=skin.getAttribute('position'), colors=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i+=3){
    const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
    // Roughly half the old painted area, with a softer outer pigment edge.
    const cheekDistance=Math.hypot((Math.abs(x)-.125)/.047,(y-.022)/.0445);
    const blush=z>.218?Math.min(1,Math.max(0,(1-cheekDistance)*3)):0;
    const pigment=new Color(P.skin).lerp(new Color(P.cheek),blush).multiplyScalar(1+((i*13%11)-5)*.009);
    for(let v=i;v<i+3;v++)colors.set([pigment.r,pigment.g,pigment.b],v*3);
  }
  skin.setAttribute('color',new Float32BufferAttribute(colors,3));
  g.add(new Mesh(kit.ownGeometry(skin),kit.material(0xffffff)));
  // Eye paint follows the face; nose and lips are sculpted relief whose edges
  // sink into the same face surface instead of sitting on it as separate beads.
  const project=(x:number,y:number,offset=.006):Point=>[x,y,.167+.126*Math.sqrt(Math.max(.01,1-(x/.192)**2-((y-.079)/.209)**2))+offset];
  const paint=(color:number,points:[number,number][],offset=.006)=>panel(kit,g,color,points.map(([x,y])=>project(x,y,offset)),.002);
  const disc=(color:number,x:number,y:number,rx:number,ry:number,offset:number)=>paint(color,
    Array.from({length:12},(_,i)=>[x+Math.cos(i*Math.PI/6)*rx,y+Math.sin(i*Math.PI/6)*ry]),offset);
  for(const sign of [-1,1]){
    const mirror=(points:[number,number][])=>{
      const result=points.map(([x,y]):[number,number]=>[x*sign,y]);return sign<0?result.reverse():result;
    };
    paint(0xf8ead7,mirror([[.027,.096],[.047,.072],[.088,.067],[.137,.087],[.122,.123],[.087,.138],[.048,.124]]));
    disc(0x674326,sign*.080,.102,.040,.035,.009);
    disc(P.eye,sign*.078,.105,.029,.030,.012);
    disc(0xfff4de,sign*.078-.010,.121,.008,.010,.016);
    paint(P.eye,mirror([[.025,.096],[.048,.124],[.087,.138],[.122,.123],[.143,.087],[.161,.102],
      [.142,.101],[.127,.139],[.086,.155],[.041,.139]]),.018);
    const brow=Array.from({length:9},(_,i):[number,number]=>{
      // The inner end rises gently toward the nose; no semicircular arches.
      const t=i/8;return[.032+.10*t,.206-.034*t+.002*Math.sin(Math.PI*t)];
    });
    paint(P.hairShade,mirror([...brow,...[...brow].reverse().map(([x,y]):[number,number]=>[x,y+.017])]));
    paint(P.hair,mirror([...brow.map(([x,y]):[number,number]=>[x,y+.012]),...[...brow].reverse().map(([x,y]):[number,number]=>[x,y+.018])]),.009);
  }
  // Connected sections grow smoothly from the bridge into a rounded tip and
  // back into the philtrum. The perimeter sits inside the cheek/forehead mesh.
  const noseRows=[[-.012,.025,0],[.003,.034,.014],[.018,.044,.034],[.037,.041,.044],
    [.067,.033,.032],[.098,.026,.020],[.126,.023,.009],[.145,.022,0]];
  const noseColumns=[-1,-.72,-.38,0,.38,.72,1];
  clothGrid(kit,g,noseRows.map(([y,width,height])=>noseColumns.map(u=>
    project(u*width,y,-.006+height*(1-u*u)**1.4))),(row,col)=>{
      const tip=row>=1&&row<=3,center=col>0&&col<noseColumns.length-2;
      return new Color(P.skin).lerp(new Color(P.nose),tip&&center?.30:.06).getHex();
    });
  // A broad skin transition blends the lips into the muzzle; only the inner
  // ridges are lip-colored, so there is no raised outline around the mouth.
  const lipRows=[[-.030,-.010],[-.017,0],[-.009,.0035],[-.0012,.002],
    [.0012,.002],[.007,.0025],[.014,0],[.024,-.010]];
  const lipColumns=Array.from({length:17},(_,i)=>i/8-1);
  clothGrid(kit,g,lipRows.map(([dy,depth])=>lipColumns.map(u=>{
    const x=u*.082,taper=Math.max(0,1-(x/.067)**2),smile=-.040-.018*Math.max(0,1-(x/.064)**2);
    return project(x,smile+dy,-.010+(depth+.010)*taper);
  })),(row,col)=>{
    const x=(lipColumns[col]+lipColumns[col+1])*.041,taper=Math.max(0,1-(x/.067)**2);
    const color=row===3?0x9a5d45:row===2?0xde9e7c:row===4?0xd29376:P.skin;
    return new Color(P.skin).lerp(new Color(color),taper).getHex();
  });
  // The fleshy center relaxes into thin, lifted smile corners.
  for(const sign of [-1,1]){
    const corner=Array.from({length:7},(_,i):[number,number]=>{
      const x=.025+i/6*.039;return[sign*x,-.040-.018*(1-(x/.064)**2)];
    });
    const outline=[...corner,...[...corner].reverse().map(([x,y]):[number,number]=>[x,y+.002])];
    paint(0x9a5d45,sign<0?outline.reverse():outline,.006);
  }
}

function hair(kit: ModelKit, g: Group): void {
  for (const sign of [-1, 1]) {
    // Broad planar locks sweep from the central part down to the temples.
    const rim:Point[]=[[0,.300,.282],[.050,.252,.289],[.115,.195,.273],[.174,.145,.251],
      [.163,.254,.253],[.105,.297,.254],[.019,.326,.240]];
    for(let i=0;i<rim.length;i++){
      const points:Point[]=[[.105,.260,.281],rim[i],rim[(i+1)%rim.length]];
      const mirrored=points.map(([x,y,z]):Point=>[x*sign,y,z]);
      panel(kit,g,[P.hair,P.hairLight,P.hair,P.hairShade,P.hair,P.hairLight,P.hair][i],sign<0?mirrored.reverse():mirrored,.025);
    }
    const temple:Point[]=[[.181,.209,.260],[.184,.156,.250],[.170,.115,.244],[.159,.176,.267]];
    const mirrored=temple.map(([x,y,z]):Point=>[x*sign,y,z]);
    panel(kit,g,P.hairShade,sign<0?mirrored:mirrored.reverse(),.015);
  }
}

export function createSurvivorAppearance(kit: ModelKit, body: Group, torso: Group, head: Group, skirt: Group, coat: number): SurvivorClothing {
  layer(kit, torso, 'babushka-dress', `dress:${coat}`, g => {
    oval(kit, g, coat, [.58, .64, .39], [0, 1.02, 0]);
  });
  layer(kit, skirt, 'babushka-skirt', `skirt:${coat}`, g => {
    const profile = SKIRT_PROFILE;
    const count = 12;
    const rings = profile.map(([y,rx,rz])=>Array.from({length:count},(_,i):Point=>{
      const a=i/count*Math.PI*2; return [Math.sin(a)*rx,y,Math.cos(a)*rz];
    }));
    for(let row=0;row<rings.length-1;row++)for(let i=0;i<count;i++){
      const j=(i+1)%count, points=[rings[row][i],rings[row][j],rings[row+1][j],rings[row][i],rings[row+1][j],rings[row+1][i]];
      const pigment=new Color(row===0?P.leather:coat).multiplyScalar(1+(((i*7+row*3)%5)-2)*.035).getHex();
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(points.flat(),3));geometry.computeVertexNormals();
      g.add(new Mesh(kit.ownGeometry(geometry),kit.material(pigment)));
    }
    // Close both ends; the lower cap remains above the original boot soles.
    for(const row of [0,rings.length-1]){
      const positions:number[]=[];for(let i=0;i<count;i++){
        const j=(i+1)%count;positions.push(0,profile[row][0],0,...rings[row][row===0?j:i],...rings[row][row===0?i:j]);
      }
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
      g.add(new Mesh(kit.ownGeometry(geometry),kit.material(row===0?P.leather:coat)));
    }
  });
  const apron = layer(kit, skirt, 'babushka-apron', 'apron', g => {
    // Continuous curved cloth: colored bands share its surface, so the red
    // border cannot z-fight or detach from the apron as the camera turns.
    const point=(u:number,v:number):Point=>{
      const flare=Math.min(1,Math.max(0,(v-.28)/.72));
      const x=u*(.244+.031*flare*flare*(3-2*flare)),y=.895-v*.49+(u*u)*v*.018;
      // A straight, broad waist edge sits under the belt and over the vest
      // tails, so those dark panels cannot cut the apron into a tapered bib.
      const overlap=Math.min(1,Math.max(0,(y-.64)/.12));
      return[x,y,skirtFront(x,y)+.009+overlap*.024];
    };
    const rows=[1,.94,.80,.53,.23,0],cols=[-1,-.75,-.5,-.25,0,.25,.5,.75,1];
    clothGrid(kit,g,rows.map(v=>cols.map(u=>point(u,v))),(row,col)=>{
      const base=row===1?P.scarfDark:row===0?P.linenShade:P.linen;
      return new Color(base).multiplyScalar(1+(((col*3+row)%4)-1.5)*.025).getHex();
    });
  });
  const belt = layer(kit, body, 'babushka-belt', 'belt', g => {
    const band=kit.vessel(g,P.leatherLight,.292,.292,.016,.062,12);band.position.y=.875;band.scale.z=.8;
    const front=[.875,.937].map(y=>Array.from({length:13},(_,i):Point=>{
      const x=(i/12*2-1)*.28;
      return[x,y,Math.max(vestFront(x,y)+.006,skirtFront(x,y)+.009)+.022];
    }));
    clothGrid(kit,g,front,()=>P.leatherLight);
    kit.part(g, 'rock', P.leatherLight, [.095,.080,.055], [.202,.912,.18]);
    const end=kit.part(g,'box',P.leatherLight,[.068,.18,.029],[.222,.792,.190]);end.rotation.z=.14;
  });
  const satchel = layer(kit, body, 'babushka-satchel', 'satchel', g => {
    kit.part(g, 'rock', P.leather, [.23, .25, .15], [.18, .77, -.20]);
    kit.part(g, 'box', P.leatherLight, [.18, .065, .045], [.18, .846, -.267]);
    kit.part(g, 'box', P.linenShade, [.038, .042, .018], [.18, .81, -.292]);
  });
  const vest = layer(kit, torso, 'babushka-vest', 'vest', g => {
    for (const sign of [-1,1]) {
      const rows=[[.763,.22,.285],[.89,.07,.286],[1.03,.085,.29],[1.15,.11,.27],[1.26,.14,.21]];
      const surface:Point[][]=[];
      for(let i=0;i<(rows.length-1)*2+1;i++){
        const index=Math.min(rows.length-2,Math.floor(i/2)),t=i/2-index;
        const [y0,a0,b0]=rows[index],[y1,a1,b1]=rows[index+1],y=y0+(y1-y0)*t,a=a0+(a1-a0)*t,b=b0+(b1-b0)*t;
        const row=Array.from({length:5},(_,col):Point=>{const x=(a+(b-a)*col/4)*.9;return[sign*x,y,vestFront(x,y)+.006];});
        surface.push(sign<0?row.reverse():row);
      }
      clothGrid(kit,g,surface,()=>P.vest);
      const strap=Array.from({length:9},(_,i)=>{
        const t=i/8,y=.900+.360*t,a=.205-.050*t,b=.265-.050*t;
        const row=Array.from({length:3},(_,j):Point=>{const x=(a+(b-a)*j/2)*.9;return[sign*x,y,vestFront(x,y)+.019];});
        return sign<0?row.reverse():row;
      });
      clothGrid(kit,g,strap,()=>P.leatherLight);
    }
    kit.part(g, 'rock', P.vest, [.54,.54,.095], [0,1.01,-.164]);
  });
  const faceLayer = layer(kit, head, 'babushka-face', 'face', g => face(kit, g));
  const headwear = layer(kit, head, 'babushka-kerchief', 'kerchief', g => { createKerchiefHood(kit, g); hair(kit, g); });
  const scarfTie = layer(kit, head, 'babushka-scarf-tie', 'scarf-tie', g => kerchiefTie(kit, g));
  const collar = layer(kit, torso, 'babushka-collar', 'collar', g => createShoulderKerchief(kit,g));
  const drape:Mesh[]=[];skirt.traverse(object=>{if(object instanceof Mesh&&object.morphTargetInfluences)drape.push(object);});
  return { headwear, scarfTie, face: faceLayer, collar, apron, satchel, vest, belt, boots: [], hands: [], drape };
}

/** Cloth contours slope inward at the shoulder while the anatomical joint and
 * both .31-unit segments remain exactly where weapons and IK expect them. */
export function createSurvivorSleeve(kit: ModelKit, parent: Group, coat: number, sign: number, forearm: boolean): void {
  layer(kit,parent,forearm?'babushka-cuff-sleeve':'babushka-shoulder-sleeve',`sleeve:${coat}:${sign}:${forearm}`,g=>{
    const profile=forearm?[[0,0,.077,.078],[-.11,0,.100,.107],[-.245,0,.085,.09],[-.29,0,.078,.08]]
      :[[.018,-sign*.064,.064,.08],[-.10,-sign*.035,.095,.107],[-.24,0,.094,.10],[-.31,0,.077,.078]];
    const count=10,rings=profile.map(([y,x,rx,rz],row)=>Array.from({length:count},(_,i):Point=>{
      const interior=row>0&&row<profile.length-1,a=i/count*Math.PI*2+(interior?.055:0);
      return[x+Math.sin(a)*rx,y+(interior?Math.sin(i*2.1+row)*.012:0),Math.cos(a)*rz];
    }));
    const positions:number[]=[],colors:number[]=[];
    const tri=(a:Point,b:Point,c:Point,pigment:number)=>{
      positions.push(...a,...b,...c);const color=new Color(pigment);for(let i=0;i<3;i++)colors.push(color.r,color.g,color.b);
    };
    for(let row=0;row<rings.length-1;row++)for(let i=0;i<count;i++){
      const j=(i+1)%count,color=new Color(coat).multiplyScalar(1+(((i*3+row*7)%7)-3)*.035).getHex();
      tri(rings[row+1][i],rings[row+1][j],rings[row][j],color);tri(rings[row+1][i],rings[row][j],rings[row][i],color);
    }
    for(const row of [0,rings.length-1])for(let i=0;i<count;i++){
      const j=(i+1)%count;tri([profile[row][1],profile[row][0],0],rings[row][row===0?i:j],rings[row][row===0?j:i],coat);
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
    g.add(new Mesh(kit.ownGeometry(geometry),kit.material(0xffffff)));
    if(forearm)kit.part(g,'box',0x805331,[.172,.065,.18],[0,-.26,0]);
  });
}

/** Closed painted sections, ordered from top to bottom around the Y axis. */
function paintedLoft(kit:ModelKit,group:Group,rings:Point[][],pigment:(row:number,side:number)=>number):void {
  const positions:number[]=[],colors:number[]=[];
  const tri=(a:Point,b:Point,c:Point,color:number)=>{
    positions.push(...a,...b,...c);const p=new Color(color);
    for(let i=0;i<3;i++)colors.push(p.r,p.g,p.b);
  };
  const count=rings[0].length;
  for(let row=0;row<rings.length-1;row++)for(let i=0;i<count;i++){
    const j=(i+1)%count,color=pigment(row,i);
    tri(rings[row+1][i],rings[row+1][j],rings[row][j],color);
    tri(rings[row+1][i],rings[row][j],rings[row][i],color);
  }
  for(const row of [0,rings.length-1]){
    const center=rings[row].reduce((a,p)=>a.map((v,i)=>v+p[i]/count) as Point,[0,0,0] as Point);
    for(let i=0;i<count;i++){
      const j=(i+1)%count;tri(center,rings[row][row===0?i:j],rings[row][row===0?j:i],pigment(row,i));
    }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeVertexNormals();
  group.add(new Mesh(kit.ownGeometry(geometry),kit.material(0xffffff)));
}

/** A rounded palm and closely curled fingers surround the unchanged grip.
 * Shallow knuckle contours read as one hand instead of detached finger bars. */
export function createSurvivorHand(kit:ModelKit,hand:Group,sign:number):Group {
  const result=layer(kit,hand,'babushka-hand',`hand:${sign}`,g=>{
    const palm=[[.075,.043,.043,.020,-.018],[.032,.062,.052,.027,-.020],
      [-.025,.060,.049,.028,-.018],[-.064,.046,.038,.022,-.011],[-.074,.027,.024,.016,.001]];
    const rings=palm.map(([y,rx,rz,x,z])=>Array.from({length:10},(_,i):Point=>{
      const a=i/10*Math.PI*2;return[sign*x+Math.sin(a)*rx,y,z+Math.cos(a)*rz];
    }));
    paintedLoft(kit,g,rings,(_,side)=>new Color(P.skin).multiplyScalar(.97+Math.cos(side/10*Math.PI*2)*.035).getHex());
    // Four fingers share the same curled envelope. Only a shallow change of
    // section separates the knuckles; every finger meets the palm behind it.
    const fingerRows=Array.from({length:9},(_,i)=>{
      const y=.043-i*.014,ridge=i%2===1?.003:0,taper=i===0||i===8?.82:1;
      return Array.from({length:10},(_,j):Point=>{
        const a=j/10*Math.PI*2;
        return[sign*.003+Math.sin(a)*.054*taper,y,.033+Math.cos(a)*(.029+ridge)*taper];
      });
    });
    paintedLoft(kit,g,fingerRows,(row,side)=>new Color(P.skin).multiplyScalar(side<3||side>7?(row%2===0?1:.96):.94).getHex());
    const thumb=[[.065,.022,.024,-.040,.017],[.041,.026,.027,-.054,.032],[.011,.021,.022,-.042,.049],[-.002,.011,.013,-.030,.053]];
    paintedLoft(kit,g,thumb.map(([y,rx,rz,x,z])=>Array.from({length:8},(_,i):Point=>{
      const a=i/8*Math.PI*2;return[sign*x+Math.sin(a)*rx,y,z+Math.cos(a)*rz];
    })),()=>P.skin);
  });
  // The compact sculpt fits within the original hand's contact envelope.
  // Retain those calibrated float32 bounds so falling/grounding poses do not
  // translate the entire rig when the cosmetic knuckles change shape.
  result.traverse(object=>{
    if(object instanceof Mesh)object.geometry.boundingBox=new Box3(
      new Vector3(sign<0?-.09572120010852814:-.08068973571062088,-.07473378628492355,-.08039206266403198),
      new Vector3(sign<0?.08068973571062088:.09572120010852814,.08470232784748077,.07500000298023224));
  });
  return result;
}

/** A continuous leather upper curves from calf through ankle into the toe.
 * The original sole footprint and height keep all ground contacts unchanged. */
export function createSurvivorBoot(kit: ModelKit, knee: Group): Group {
  return layer(kit, knee, 'babushka-boot', 'boot', g => {
    const outline:[number,number][]=[[-.064,-.125],[.064,-.125],[.090,-.103],[.102,-.060],
      [.103,.003],[.119,.078],[.12,.135],[.103,.200],[.065,.236],[.026,.245],
      [-.026,.245],[-.065,.236],[-.103,.200],[-.12,.135],[-.119,.078],[-.103,.003],[-.102,-.060],[-.090,-.103]];
    // Rounded heel/toe and a beveled welt retain the original sole extrema,
    // without the square ledges beside the narrower leather upper.
    const sole=[[ -.315,.985],[-.328,1],[-.35,.97]].map(([y,scale])=>
      [...outline].reverse().map(([x,z]):Point=>[x*scale,y,(z-.06)*scale+.06]));
    paintedLoft(kit,g,sole,row=>row===0?0x79583b:0x60452f);
    const profile=[[.025,.092,.095,-.016],[-.055,.079,.082,-.018],[-.128,.065,.070,-.014],
      [-.177,.069,.081,-.003],[-.214,.083,.110,.022],[-.249,.100,.148,.045],
      [-.281,.112,.177,.056],[-.317,.116,.180,.057]];
    const rings=profile.map(([y,rx,rz,z],row)=>Array.from({length:12},(_,i):Point=>{
      const a=i/12*Math.PI*2,power=row>4?.78:1;
      const rounded=(v:number)=>Math.sign(v)*Math.abs(v)**power;
      return[rounded(Math.sin(a))*rx,y,z+rounded(Math.cos(a))*rz];
    }));
    paintedLoft(kit,g,rings,(row,side)=>{
      const front=Math.cos((side+.5)/12*Math.PI*2),toe=row>=4&&row<7;
      return new Color(toe?0x785036:P.leather).multiplyScalar(1+front*.055+((side*7+row*3)%5-2)*.015).getHex();
    });
  });
}
