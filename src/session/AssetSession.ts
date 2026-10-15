/** Borrowed model/source references; GPU ownership stays with the scene inventory. */
export class AssetSession<Root,Source>{
 private loadSerial=0;
 private assetRoot:Root|null=null;
 private exportSource:Source|null=null;
 get loadRevision(){return this.loadSerial;}
 get root(){return this.assetRoot;}
 get source(){return this.exportSource;}
 beginLoad(){return ++this.loadSerial;}
 replace(root:Root,source:Source|null){this.assetRoot=root;this.exportSource=source;}
 clear(){this.beginLoad();this.assetRoot=null;this.exportSource=null;}
}
