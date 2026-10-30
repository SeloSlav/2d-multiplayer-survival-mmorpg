import { BufferGeometry, Float32BufferAttribute, MeshStandardNodeMaterial, Vector4 } from 'three/webgpu';
import { attribute, float, floor, mix, modelWorldMatrix, positionLocal, sin, uniform, uniformArray, vec2, vec3, vec4 } from 'three/tsl';
import { gameConfig } from '../../../config/gameConfig';
import { calculateChunkIndex } from '../../../utils/chunkUtils';
import { VegetationWindField } from '../vegetationWind';
import { GROUND_Y_SCALE, WORLD_3D } from './visualContract';

export function attachVegetationWeights(geometry:BufferGeometry,flexibility:number):void {
  geometry.computeBoundingBox();
  const base=geometry.boundingBox!.min.y,top=geometry.boundingBox!.max.y,p=geometry.getAttribute('position'),weights=new Float32Array(p.count*4);
  for(let i=0;i<p.count;i++){weights[i*4]=((p.getY(i)-base)/Math.max(.001,top-base))**2;weights[i*4+3]=flexibility;}
  geometry.setAttribute('windData',new Float32BufferAttribute(weights,4));
}

/** One shared material retains instancing. Wind weights are authored in model
 * space; the deformation runs after the instance transform, in scene space. */
export class VegetationWind3d {
  readonly field=new VegetationWindField();
  readonly enabled=uniform(1);
  private readonly diagnostic = uniform(0);
  private readonly values=this.field.cells.map(cell=>new Vector4(cell.strength,cell.phase,cell.cadenceHz,0));
  private readonly chunks=uniformArray<'vec4'>(this.values,'vec4');
  private readonly materials=new Set<MeshStandardNodeMaterial>();
  readonly material=this.createMaterial();
  private focusIndex=0;
  get intensity():number{return this.field.cells[this.focusIndex]?.strength??.16;}

  createMaterial(parameters:ConstructorParameters<typeof MeshStandardNodeMaterial>[0]={},cadenceScale=1):MeshStandardNodeMaterial {
    const material=new MeshStandardNodeMaterial({color:0xffffff,roughness:.92,flatShading:true,...parameters});
    const responseRate=Math.max(.5,Math.min(1.25,cadenceScale));material.userData.vegetationCadenceScale=responseRate;
    const data = attribute('windData', 'vec4');
    const world=modelWorldMatrix.mul(vec4(positionLocal,1)).xyz;
    const cell=floor(vec2(world.x,world.z.div(GROUND_Y_SCALE)).div(gameConfig.chunkSizePx/WORLD_3D.tilePixels))
      .clamp(vec2(0),vec2(gameConfig.worldWidthChunks-1,gameConfig.worldHeightChunks-1));
    const weather=this.chunks.element(cell.y.mul(gameConfig.worldWidthChunks).add(cell.x).toUint());
    const spatial=world.x.mul(.065).add(world.z.mul(.035)),phase=weather.y.mul(responseRate).add(spatial);
    const gust=sin(weather.y.mul(.37).add(spatial.mul(.3))).mul(.5).add(.5).pow(2).mul(.45).add(.55);
    const primary=sin(phase).add(sin(phase.mul(1.63).add(.8)).mul(.18));
    const bend=primary.mul(data.x).mul(data.w).mul(weather.x).mul(gust).mul(this.enabled);
    const flutter=sin(phase.mul(3.1).add(data.z)).mul(data.y).mul(weather.x).mul(.012).mul(this.enabled);
    material.positionNode=positionLocal.add(vec3(bend.add(flutter),0,bend.mul(.36).sub(flutter.mul(.4))));
    if(!parameters.vertexColors)material.colorNode=mix(attribute('color','vec3'),vec3(data.x,data.y,float(1).sub(data.x)),this.diagnostic);
    this.materials.add(material);return material;
  }

  update(seconds:number,chunkWeather?:unknown,world?:{currentWeather?:unknown;rainIntensity?:number},diagnostic=false,focus?:{x:number;y:number}):void {
    this.field.update(seconds,chunkWeather,world);this.diagnostic.value=Number(diagnostic);
    if(focus)this.focusIndex=calculateChunkIndex(focus.x,focus.y);
    for(let index=0;index<this.values.length;index++){const cell=this.field.cells[index];this.values[index].set(cell.strength,cell.phase,cell.cadenceHz,0);}
  }

  setEnabled(enabled:boolean):void{this.enabled.value=Number(enabled);}
  setWireframe(enabled:boolean):void{for(const material of this.materials)material.wireframe=enabled;}
  releaseMaterial(material:MeshStandardNodeMaterial):void{this.materials.delete(material);material.dispose();}
  dispose():void{for(const material of this.materials)material.dispose();this.materials.clear();}
}
