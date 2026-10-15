/** One authority for export publication, save guards and stale completion. */
export class ExportCoordinator<Result>{
 private serial=0;
 private active=false;
 private cached:Result|null=null;
 get revision(){return this.serial;}
 get busy(){return this.active;}
 get result(){return this.cached;}
 begin(){if(this.active)throw new Error('An export operation is already active.');this.active=true;return ++this.serial;}
 invalidate(){this.serial++;this.active=false;this.cached=null;}
 clearResult(){this.cached=null;}
 isCurrent(ticket:number){return ticket===this.serial;}
 publish(ticket:number,result:Result){if(!this.isCurrent(ticket))return false;this.cached=result;return true;}
 finish(ticket:number){if(!this.isCurrent(ticket))return false;this.active=false;return true;}
}
