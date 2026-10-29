import { CircleGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry } from 'three/webgpu';
import { color, float, mix, sin, smoothstep, uniform, uv, vec2 } from 'three/tsl';
import { GROUND_Y_SCALE, worldToScene } from './visualContract';

/** A stylized overhead dive view. The wash is composited over the world only;
 * surface objects become soft overhead silhouettes, not simulated refraction. */
export class UnderwaterView3d {
  readonly overlay = new Group();
  readonly silhouettes: InstancedMesh;
  private readonly time = uniform(0);
  private readonly overlayGeometry = new PlaneGeometry(1, 1);
  private readonly markerGeometry = new CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  private readonly overlayMaterial = new MeshBasicNodeMaterial({ transparent:true, depthTest:false, depthWrite:false, toneMapped:false });
  private readonly markerMaterial = new MeshBasicNodeMaterial({ transparent:true, depthTest:false, depthWrite:false, toneMapped:false });
  private readonly matrix = new Matrix4();
  private count = 0;

  constructor(camera: OrthographicCamera) {
    const p=uv(), centered=p.sub(.5), vignette=smoothstep(.22,.75,centered.length());
    // Sparse drifting particulate/bubble highlights; this is a view-space
    // atmosphere, while caustics remain anchored to the actual seabed.
    const grid=vec2(p.x.mul(24),p.y.mul(16).add(this.time.mul(.22)));
    const cell=grid.floor(), random=sin(cell.dot(vec2(127.1,311.7))).mul(43758.5453).fract();
    const dot=grid.fract().sub(vec2(random.mul(.55).add(.22),.5)).length();
    const motes=float(1).sub(smoothstep(.025,.07,dot)).mul(smoothstep(.78,.97,random));
    this.overlayMaterial.colorNode=mix(color(0x102e3d),color(0x92c2c1),motes.mul(.7));
    this.overlayMaterial.opacityNode=float(.68).add(vignette.mul(.12)).add(motes.mul(.1));
    const wash=new Mesh(this.overlayGeometry,this.overlayMaterial);
    wash.name='underwater-world-wash';wash.position.z=-1;wash.renderOrder=20;wash.frustumCulled=false;
    this.overlay.name='underwater-view';this.overlay.visible=false;this.overlay.add(wash);camera.add(this.overlay);
    const radius=uv().sub(.5).length().mul(2);
    this.markerMaterial.colorNode=color(0x092d3d);
    this.markerMaterial.opacityNode=float(1).sub(smoothstep(.48,1,radius)).mul(.6);
    this.silhouettes=new InstancedMesh(this.markerGeometry,this.markerMaterial,256);
    this.silhouettes.name='surface-object-silhouettes';this.silhouettes.frustumCulled=false;
    this.silhouettes.count=0;this.silhouettes.renderOrder=3;
  }

  beginFrame(camera:OrthographicCamera,diving:boolean,time:number):void {
    this.overlay.visible=diving;this.time.value=time;this.count=0;
    this.overlay.scale.set((camera.right-camera.left)/camera.zoom,(camera.top-camera.bottom)/camera.zoom,1);
  }
  mark(x:number,y:number,radiusX:number,radiusY:number):void {
    if(this.count>=this.silhouettes.instanceMatrix.count)return;
    const p=worldToScene(x,y);
    this.matrix.makeScale(radiusX,1,radiusY*GROUND_Y_SCALE);
    this.matrix.setPosition(p.x,.035,p.z);
    this.silhouettes.setMatrixAt(this.count++,this.matrix);
  }
  endFrame():void {this.silhouettes.count=this.count;this.silhouettes.visible=this.count>0;if(this.count)this.silhouettes.instanceMatrix.needsUpdate=true;}
  dispose():void {this.overlay.removeFromParent();this.silhouettes.removeFromParent();this.silhouettes.dispose();this.overlayGeometry.dispose();this.markerGeometry.dispose();this.overlayMaterial.dispose();this.markerMaterial.dispose();}
}
