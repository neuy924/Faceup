// Face finding. Everything is loaded from this site's own vendor folder.
import {OVAL} from './engine.js';
let landmarker=null,scratch=null;
async function load(){
  if(landmarker)return landmarker;
  const {FaceLandmarker,FilesetResolver}=await import('./vendor/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks('./vendor/wasm');
  landmarker=await FaceLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:'./vendor/face_landmarker.task',delegate:'CPU'},runningMode:'IMAGE',numFaces:20,minFaceDetectionConfidence:0.4});
  return landmarker;
}
// The detector is built for large, close faces, so the photo is also searched in overlapping squares.
export function planTiles(W,H){
  const long=Math.max(W,H),tiles=[{x:0,y:0,w:W,h:H}],seen=new Set();
  for(const frac of [0.55,0.34,0.22]){
    const side=long*frac,w=Math.min(side,W),h=Math.min(side,H);
    const places=(len,t)=>{if(len<=t)return [0];const n=Math.ceil((len-t)/(t*0.6))+1;return Array.from({length:n},(_,i)=>i*(len-t)/(n-1));};
    for(const y of places(H,h))for(const x of places(W,w)){const k=[x,y,w,h].map(Math.round).join();if(!seen.has(k)){seen.add(k);tiles.push({x,y,w,h});}}
  }
  return tiles;
}
export function faceBox(pts,W,H){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(const i of OVAL){const x=pts[i][0]*W,y=pts[i][1]*H;x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  return {x0,y0,x1,y1,w:x1-x0,h:y1-y0,cx:(x0+x1)/2,cy:(y0+y1)/2};
}
export function sameFace(a,b){
  const ix=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0)),iy=Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  return Math.hypot(a.cx-b.cx,a.cy-b.cy)<0.5*Math.max(a.w,b.w)||ix*iy>0.45*Math.min(a.w*a.h,b.w*b.h);
}
// found: [{pts, tile}]. Drops faces cut off by a square's edge, then removes repeats (largest square wins).
export function mergeFaces(found,W,H){
  const good=[];
  for(const f of found){
    const b=faceBox(f.pts,W,H),t=f.tile,m=Math.max(t.w,t.h)*0.01;
    const cut=(t.x>1&&b.x0<t.x+m)||(t.y>1&&b.y0<t.y+m)||(t.x+t.w<W-1&&b.x1>t.x+t.w-m)||(t.y+t.h<H-1&&b.y1>t.y+t.h-m);
    const shape=b.h/b.w;
    if(!cut&&shape>0.65&&shape<2.4&&b.w>Math.max(t.w,t.h)*0.08)good.push({...f,b,area:t.w*t.h});
  }
  good.sort((p,q)=>q.area-p.area);
  const kept=[];for(const f of good)if(!kept.some(k=>sameFace(k.b,f.b)))kept.push(f);
  return kept.slice(0,20).sort((p,q)=>p.b.cx-q.b.cx).map(f=>f.pts);
}
// A close-up square around a candidate. A real face should be found again here.
export function closeUp(pts,W,H){
  const b=faceBox(pts,W,H),side=Math.max(b.w,b.h)*2.2,w=Math.min(side,W),h=Math.min(side,H);
  return {x:Math.max(0,Math.min(W-w,b.cx-w/2)),y:Math.max(0,Math.min(H-h,b.cy-h/2)),w,h};
}
export function confirm(pts,again,W,H){
  const b=faceBox(pts,W,H);
  return again.find(a=>{const c=faceBox(a,W,H);return sameFace(b,c)&&c.w>b.w*0.7&&c.w<b.w*1.4;})||null;
}
async function detectTile(source,W,H,r){
  const lm=await load(),c=scratch||(scratch=document.createElement('canvas')),k=Math.min(4,1024/Math.max(r.w,r.h));
  c.width=Math.max(1,Math.round(r.w*k));c.height=Math.max(1,Math.round(r.h*k));
  c.getContext('2d').drawImage(source,r.x,r.y,r.w,r.h,0,0,c.width,c.height);
  return lm.detect(c).faceLandmarks.map(f=>f.map(p=>[(r.x+p.x*r.w)/W,(r.y+p.y*r.h)/H]));
}
// source is the full-size image. Returns landmarks normalised to the whole image.
export async function detectAll(source,W,H,progress){
  const tiles=planTiles(W,H),found=[];
  for(let i=0;i<tiles.length;i++){
    if(progress&&progress(i,tiles.length)===false)break;
    await new Promise(r=>setTimeout(r));
    for(const pts of await detectTile(source,W,H,tiles[i]))found.push({pts,tile:tiles[i]});
  }
  const out=[];
  for(const pts of mergeFaces(found,W,H)){
    await new Promise(r=>setTimeout(r));
    const sure=confirm(pts,await detectTile(source,W,H,closeUp(pts,W,H)),W,H);
    if(sure)out.push(sure);
  }
  return out;
}
export async function detectRegion(source,W,H,r){return detectTile(source,W,H,r);}
