// Face finding. Everything is loaded from this site's own vendor folder.
let landmarker=null;
async function load(){
  if(landmarker)return landmarker;
  const {FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks('./vendor/wasm');
  landmarker=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./vendor/face_landmarker.task',delegate:'CPU'},runningMode:'IMAGE',numFaces:10});
  return landmarker;
}
// region is in source pixels. Returns landmarks normalised to the whole image.
export async function detect(canvas,region){
  const lm=await load(),W=canvas.width,H=canvas.height,r=region||{x:0,y:0,w:W,h:H};
  const c=document.createElement('canvas'),k=Math.min(4,1280/Math.max(r.w,r.h));
  c.width=Math.round(r.w*k);c.height=Math.round(r.h*k);
  c.getContext('2d').drawImage(canvas,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
  return lm.detect(c).faceLandmarks.map(f=>f.map(p=>[(r.x+p.x*r.w)/W,(r.y+p.y*r.h)/H]));
}
