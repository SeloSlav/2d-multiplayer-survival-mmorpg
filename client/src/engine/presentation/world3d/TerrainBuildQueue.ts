import type { TerrainTile } from './terrainField';
import type { TerrainBuild } from './terrainBuild';
type WorkerPort=Pick<Worker,'postMessage'|'addEventListener'|'terminate'>;
interface Job { id:number;tiles:TerrainTile[];reason:string }
/** One running job and one latest request: fast travel never queues a backlog. */
export class TerrainBuildQueue {
  private serial=0;
  private active:Job|null=null;
  private next:Job|null=null;
  private disposed=false;
  constructor(private worker:WorkerPort,private complete:(result:TerrainBuild,tiles:TerrainTile[],reason:string)=>void,private error:(message:string)=>void) {
    worker.addEventListener('message',((event:MessageEvent<{id:number;result:TerrainBuild}>)=>{
      if (this.disposed || event.data.id!==this.active?.id) return;
      const finished=this.active;this.active=null;
      if (this.next) {const next=this.next;this.next=null;this.start(next);}
      else this.complete(event.data.result,finished.tiles,finished.reason);
    }) as EventListener);
    worker.addEventListener('error',(()=>{if(!this.disposed)this.error('Terrain worker failed. Reload to reconnect.');}) as EventListener);
  }
  request(tiles:TerrainTile[],reason:string):void {
    if(this.disposed)return;
    const job={id:++this.serial,tiles,reason};if(this.active)this.next=job;else this.start(job);
  }
  private start(job:Job):void {this.active=job;this.worker.postMessage({id:job.id,tiles:job.tiles});}
  dispose():void {this.disposed=true;this.active=null;this.next=null;this.worker.terminate();}
}
