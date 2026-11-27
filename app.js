import {ZERO,OVAL,COLOURS,SKIN_KEYS,isActive} from './engine.js';
import {detectAll,detectRegion,faceBox,sameFace} from './faces.js';
import * as store from './store.js';

const $=s=>document.querySelector(s),view=$('#view'),ctx=view.getContext('2d');
const PREVIEW=2048,MAX_PIXELS=50e6;
const GROUPS={
  skin:[['smooth','Smoothing'],['texture','Pore detail'],['lines','Soften lines'],['tone','Even tone'],['redness','Less redness'],['shine','Less shine']],
  eyes:[['underEye','Under-eyes'],['eyeWhite','Eye whites'],['iris','Iris pop'],['eyeSharp','Eye sharpness'],['catchlight','Catchlight'],['teeth','Whiten teeth']],
  makeup:[['lips','Lip colour'],['lipColor','Lip shade'],['blush','Blush'],['blushColor','Blush shade'],['shadow','Eyeshadow'],['shadowColor','Shadow shade'],['liner','Eyeliner'],['brows','Darken brows']]};
const TAP_SLIDERS=[['eyeWhite','Brighten'],['iris','Iris pop'],['eyeSharp','Sharpness'],['catchlight','Catchlight']];
const fresh=()=>({targets:[{id:'paint',pts:null}],params:{},strokes:[],heals:[],eyes:[]});
let group='skin',scanning=false;
let state=fresh(),history=[],future=[],selected='paint',tool='move',maskMode='add',findMode=false;
let photo=null,full=null,before=null,after=null,overlay=null,showBefore=false,exported=null;
const base=document.createElement('canvas'),done=document.createElement('canvas'),orig=document.createElement('canvas'),tint=document.createElement('canvas');
let cam={s:1,x:0,y:0},live=null;

/* worker */
const worker=new Worker('worker.js',{type:'module'}),waiting=new Map();let seq=0;
worker.onmessage=e=>{const w=waiting.get(e.data.id);waiting.delete(e.data.id);if(!w)return;e.data.error?w.no(new Error(e.data.error)):w.ok(e.data);};
worker.onerror=()=>{for(const w of waiting.values())w.no(new Error('The editing engine stopped. Reload the app.'));waiting.clear();badge('The editing engine could not run. Reload the app.');};
const call=(msg,transfer=[])=>new Promise((ok,no)=>{const id=++seq;waiting.set(id,{ok,no});worker.postMessage({...msg,id},transfer);});

let badgeTimer;
function badge(text,ms){const b=$('#badge');clearTimeout(badgeTimer);b.hidden=!text;b.textContent=text||'';if(ms)badgeTimer=setTimeout(()=>b.hidden=true,ms);}

let busy=false,dirty=false,generation=0;
async function refresh(){
  if(!photo)return;
  if(busy){dirty=true;return;}
  busy=true;const g=generation;
  try{
    const r=await call({type:'render',state,maskFor:tool==='mask'?selected:null});
    if(g===generation){
      after=r.image;done.getContext('2d').putImageData(new ImageData(after.data,after.width,after.height),0,0);
      overlay=r.overlay;if(overlay)paintTint();draw();
    }
  }catch(e){badge(e.message,6000);}
  busy=false;if(dirty){dirty=false;refresh();}
}
function paintTint(){
  tint.width=overlay.w;tint.height=overlay.h;const d=new ImageData(overlay.w,overlay.h);
  for(let i=0;i<overlay.mask.length;i++){d.data[i*4]=255;d.data[i*4+1]=40;d.data[i*4+2]=60;d.data[i*4+3]=overlay.mask[i]*115;}
  tint.getContext('2d').putImageData(d,0,0);
}

/* history and saving */
const snap=()=>JSON.stringify(state);
let committed=snap(),saveTimer;
function commit(){const now=snap();if(now===committed)return;history.push(committed);if(history.length>80)history.shift();future=[];committed=now;buttons();save();}
function travel(from,to){if(!from.length)return;to.push(committed);committed=from.pop();state=JSON.parse(committed);state.eyes=state.eyes||[];if(!state.targets.some(t=>t.id===selected))selected=state.targets[0].id;buttons();panel();refresh();save();}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>store.put('edit',{state,selected}).catch(()=>badge('Could not save this edit for later.',3000)),400);}
function buttons(){$('#undo').disabled=!history.length;$('#redo').disabled=!future.length;$('#compare').disabled=$('#export').disabled=!photo;}

/* panel */
const label=t=>t.pts?'Face '+(state.targets.filter(x=>x.pts).indexOf(t)+1):'Painted area';
function panel(){
  $('#targets').replaceChildren(...[...state.targets].sort((a,b)=>!a.pts-!b.pts).map(t=>{
    const b=document.createElement('button');b.textContent=label(t);b.className=t.id===selected?'on':'';
    b.onclick=()=>{const again=selected===t.id;selected=t.id;if(t.pts){again&&cam.zoomed?fit():zoomTo(t);}panel();refresh();draw();};return b;}));
  const p={...ZERO,...state.params[selected]};
  for(const rows of Object.values(GROUPS))for(const [k] of rows){const i=$('#s-'+k);i.value=p[k];if(!COLOURS[k])i.nextElementSibling.textContent=p[k];}
  const tp={...ZERO,...state.params.eyes};
  for(const [k] of TAP_SLIDERS){const i=$('#e-'+k);i.value=tp[k];i.nextElementSibling.textContent=tp[k];}
  const needsFace=group!=='skin'&&selected==='paint';
  for(const g of Object.keys(GROUPS))$('#g-'+g).hidden=g!==group||needsFace;
  $('#needsFace').hidden=!needsFace;
  for(const b of $('#groups').children)b.classList.toggle('on',b.dataset.group===group);
  for(const el of document.querySelectorAll('[data-for]'))el.hidden=el.dataset.for!==tool;
  for(const b of $('#tools').children)b.classList.toggle('on',b.dataset.tool===tool);
}
function control(parent,id,key,name,owner){
  const l=document.createElement('label');l.className='slide';
  const s=document.createElement('span');s.textContent=name;
  const set=v=>{const t=owner();state.params[t]={...ZERO,...state.params[t],[key]:v};refresh();};
  if(COLOURS[key]){
    const i=document.createElement('select');i.id=id;COLOURS[key].forEach((c,n)=>i.add(new Option(c[0],n)));
    i.onchange=()=>{set(+i.value);commit();};l.append(s,i);
  }else{
    const i=document.createElement('input');i.type='range';i.min=0;i.max=100;i.id=id;
    const o=document.createElement('output');l.append(s,i,o);
    i.oninput=()=>{o.textContent=i.value;set(+i.value);
      if(owner()==='paint'&&SKIN_KEYS.includes(key)&&!state.strokes.some(s=>s.target==='paint'&&s.mode==='add'))badge('Use Mask → Add skin to paint an area first.',3000);
      if(owner()==='eyes'&&!state.eyes.length)badge('Tap the photo to place an eye first.',3000);};
    i.onchange=commit;
  }
  parent.append(l);
}
for(const [g,rows] of Object.entries(GROUPS)){const d=document.createElement('div');d.id='g-'+g;$('#sliders').append(d);for(const [k,name] of rows)control(d,'s-'+k,k,name,()=>selected);}
for(const [k,name] of TAP_SLIDERS)control($('#tapSliders'),'e-'+k,k,name,()=>'eyes');
$('#groups').onclick=e=>{const g=e.target.dataset.group;if(!g)return;group=g;panel();};
$('#eyeUndo').onclick=()=>{state.eyes.pop();commit();refresh();draw();};
$('#eyeClear').onclick=()=>{state.eyes=[];commit();refresh();draw();};
$('#rescan').onclick=()=>scan();
$('#tools').onclick=e=>{const t=e.target.dataset.tool;if(!t)return;tool=t;findMode=false;badge('');panel();refresh();draw();};
$('#applyAll').onclick=()=>{const p=state.params[selected]||ZERO;for(const t of state.targets)if(t.pts)state.params[t.id]={...ZERO,...p};commit();refresh();badge('Copied to all faces.',2000);};
$('#reset').onclick=()=>{delete state.params[selected];commit();panel();refresh();};
$('#find').onclick=()=>{findMode=true;badge('Tap the middle of the missed face.');};
const maskButtons=m=>{maskMode=m;$('#maskAdd').classList.toggle('on',m==='add');$('#maskErase').classList.toggle('on',m==='erase');};
$('#maskAdd').onclick=()=>maskButtons('add');$('#maskErase').onclick=()=>maskButtons('erase');
$('#maskClear').onclick=()=>{state.strokes=state.strokes.filter(s=>s.target!==selected);commit();refresh();};
for(const id of ['#healSize','#maskSize','#eyeSize']){const i=$(id),show=()=>i.nextElementSibling.textContent=i.value;i.oninput=show;show();}
$('#undo').onclick=()=>travel(history,future);$('#redo').onclick=()=>travel(future,history);
const cmp=$('#compare'),setBefore=v=>{showBefore=v;draw();};
cmp.onpointerdown=e=>{cmp.setPointerCapture(e.pointerId);setBefore(true);};
cmp.onpointerup=cmp.onpointercancel=cmp.onlostpointercapture=()=>setBefore(false);
cmp.oncontextmenu=e=>e.preventDefault();

/* drawing and gestures */
function zoomTo(t){
  const b=faceBox(t.pts,base.width,base.height),w=view.clientWidth,h=view.clientHeight,s=Math.max(cam.min,Math.min(cam.min*16,Math.min(w/(b.w*1.35),h/(b.h*1.35))));
  cam={...cam,s,x:w/2-b.cx*s,y:h/2-b.cy*s,zoomed:true};
}
function fit(){if(!photo)return;const w=view.clientWidth,h=view.clientHeight,s=Math.min(w/base.width,h/base.height);cam={s,min:s,x:(w-base.width*s)/2,y:(h-base.height*s)/2};}
let size='';
new ResizeObserver(()=>{const d=devicePixelRatio||1,w=view.clientWidth,h=view.clientHeight,key=w+'x'+h;if(key===size)return;size=key;view.width=w*d;view.height=h*d;fit();draw();}).observe($('#stage'));
function draw(){
  const d=devicePixelRatio||1;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,view.width,view.height);if(!photo)return;
  ctx.setTransform(d*cam.s,0,0,d*cam.s,d*cam.x,d*cam.y);
  ctx.drawImage(showBefore?orig:done,0,0);
  if(showBefore)return;
  if(tool==='mask'&&overlay)ctx.drawImage(tint,overlay.x0,overlay.y0,overlay.rw,overlay.rh);
  if(live){ctx.strokeStyle=maskMode==='add'?'#ff4060aa':'#ffffffaa';ctx.lineCap=ctx.lineJoin='round';ctx.lineWidth=2*live.r*Math.max(base.width,base.height);ctx.beginPath();
    live.pts.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[0]*base.width,p[1]*base.height));if(live.pts.length===1)ctx.lineTo(live.pts[0][0]*base.width+0.1,live.pts[0][1]*base.height);ctx.stroke();}
  if(tool==='eyes')for(const e of state.eyes){ctx.beginPath();ctx.arc(e.x*base.width,e.y*base.height,e.r*Math.max(base.width,base.height),0,2*Math.PI);ctx.strokeStyle='#fffc';ctx.lineWidth=1.5/cam.s;ctx.stroke();}
  const faces=state.targets.filter(t=>t.pts);
  if(tool==='move'&&faces.length>1)faces.forEach((t,n)=>{const b=faceBox(t.pts,base.width,base.height);ctx.fillStyle='#fff';ctx.font=`600 ${13/cam.s}px system-ui`;ctx.textAlign='center';ctx.fillText(n+1,b.cx,b.y0-4/cam.s);});
  if(tool==='move'&&faces.length>1)for(const t of faces){ctx.beginPath();OVAL.forEach((i,k)=>ctx[k?'lineTo':'moveTo'](t.pts[i][0]*base.width,t.pts[i][1]*base.height));ctx.closePath();
    ctx.strokeStyle=t.id===selected?'#fffc':'#fff4';ctx.lineWidth=(t.id===selected?2:1)/cam.s;ctx.stroke();}
}
const pointers=new Map();let gesture=null;
const at=e=>{const r=view.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
const toImage=p=>[(p.x-cam.x)/cam.s/base.width,(p.y-cam.y)/cam.s/base.height];
const brush=id=>+$(id).value/cam.s/Math.max(base.width,base.height);
const pinch=()=>{const [a,b]=[...pointers.values()];return{d:Math.hypot(a.x-b.x,a.y-b.y)||1,x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
view.onpointerdown=e=>{
  if(!photo)return;view.setPointerCapture(e.pointerId);const p=at(e);pointers.set(e.pointerId,p);
  if(pointers.size===1){gesture={start:p,last:p,moved:false,multi:false};if(tool==='mask')live={target:selected,mode:maskMode,r:brush('#maskSize'),pts:[toImage(p)]};}
  else if(gesture){gesture.multi=true;gesture.pinch=pinch();live=null;}
  draw();
};
view.onpointermove=e=>{
  if(!pointers.has(e.pointerId)||!gesture)return;const p=at(e);pointers.set(e.pointerId,p);
  if(pointers.size>=2){const n=pinch(),o=gesture.pinch,s=Math.min(cam.min*16,Math.max(cam.min*0.8,cam.s*n.d/o.d)),k=s/cam.s;
    cam={...cam,s,x:n.x-(o.x-cam.x)*k,y:n.y-(o.y-cam.y)*k};gesture.pinch=n;}
  else if(!gesture.multi){
    if(Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>8)gesture.moved=true;
    if(live)live.pts.push(toImage(p));else if(tool==='move'&&gesture.moved){cam.x+=p.x-gesture.last.x;cam.y+=p.y-gesture.last.y;}
    gesture.last=p;
  }
  draw();
};
async function lift(e){
  if(!pointers.delete(e.pointerId)||pointers.size||!gesture)return;
  const g=gesture;gesture=null;const stroke=live;live=null;
  if(e.type==='pointercancel'||g.multi){draw();return;}
  if(stroke){state.strokes.push(stroke);commit();refresh();return;}
  if(g.moved)return;
  const [x,y]=toImage(g.start);if(x<0||y<0||x>1||y>1)return;
  if(tool==='heal'){
    const spot={x,y,r:brush('#healSize')},gen=generation;
    try{const {off}=await call({type:'pick',spot,heals:state.heals});if(gen!==generation)return;
      if(!off)return badge('No clean patch nearby. Try a smaller brush.',3000);
      state.heals.push({...spot,off});commit();refresh();}catch(err){badge(err.message,5000);}
  }else if(tool==='eyes'){state.eyes.push({x,y,r:brush('#eyeSize')});commit();refresh();draw();}
  else if(findMode){findMode=false;await findNear(x,y);}
  else if(tool==='move'){
    const hit=state.targets.find(t=>{if(!t.pts)return false;const xs=OVAL.map(i=>t.pts[i][0]),ys=OVAL.map(i=>t.pts[i][1]);return x>=Math.min(...xs)&&x<=Math.max(...xs)&&y>=Math.min(...ys)&&y<=Math.max(...ys);});
    if(hit){selected=hit.id;panel();draw();}
  }
}
view.onpointerup=view.onpointercancel=lift;

/* faces */
function addFaces(found){
  let added=null,count=0;const W=base.width,H=base.height;
  for(const f of found){
    const box=faceBox(f,W,H);
    if(state.targets.some(t=>t.pts&&sameFace(faceBox(t.pts,W,H),box)))continue;
    const t={id:'f'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),pts:f.map(p=>[+p[0].toFixed(5),+p[1].toFixed(5)])};
    state.targets.push(t);added=added||t;count++;
  }
  if(count){
    const extra=state.targets.slice(-count),put=j=>{const s=JSON.parse(j);for(const t of extra)if(!s.targets.some(x=>x.id===t.id))s.targets.push(t);return JSON.stringify(s);};
    history=history.map(put);future=future.map(put);committed=put(committed);save();
  }
  return {added,count};
}
async function scan(){
  if(scanning||!photo)return;scanning=true;const gen=generation;
  try{
    const found=await detectAll(full,full.naturalWidth,full.naturalHeight,(i,n)=>{if(gen!==generation)return false;badge(`Looking for faces… ${Math.round(100*i/n)}%`);});
    if(gen===generation){
      const {added,count}=addFaces(found),total=state.targets.filter(t=>t.pts).length;
      if(added&&selected==='paint')selected=added.id;
      badge(total?`${total} ${total===1?'face':'faces'} found${count&&count<total?` (${count} new)`:''}. Tap a face number below to zoom.`:'No human face found. Use Blemish, Mask or Eye tap.',4500);
      panel();refresh();
    }
  }catch(e){console.error(e);if(gen===generation)badge('Face finding failed to load or run. Mask, Blemish and Eye tap still work.',8000);}
  scanning=false;
  if(gen!==generation&&pending===generation)scan();
}
let pending=0;
async function findNear(x,y){
  badge('Looking for a face…');const gen=generation,W=full.naturalWidth,H=full.naturalHeight;
  try{
    for(const frac of [0.08,0.13,0.2,0.32,0.5]){
      const side=Math.max(W,H)*frac,r={x:Math.max(0,x*W-side/2),y:Math.max(0,y*H-side/2)};
      r.w=Math.min(side,W-r.x);r.h=Math.min(side,H-r.y);
      const found=await detectRegion(full,W,H,r);if(gen!==generation)return;
      const near=found.filter(f=>{const b=faceBox(f,W,H);return Math.hypot(b.cx-x*W,b.cy-y*H)<Math.max(b.w,b.h);});
      const {added}=addFaces(near);
      if(added){selected=added.id;save();panel();refresh();return badge('Face added.',2000);}
    }
    badge('No new face found there. Try Mask for skin, or Eye tap for the eyes.',5000);
  }catch(e){console.error(e);badge('Face finding failed to load or run. Mask and Blemish still work.',6000);}
}

/* loading */
async function decode(blob){
  const url=URL.createObjectURL(blob),img=new Image();img.src=url;
  try{await img.decode();}finally{URL.revokeObjectURL(url);}
  return img;
}
async function load(blob,saved){
  badge('Opening…');
  let img;try{img=await decode(blob);}catch{return badge('This file could not be opened as a photo.',5000);}
  const gen=++generation;
  photo=blob;full=img;
  const k=Math.min(1,PREVIEW/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.round(img.naturalWidth*k),h=Math.round(img.naturalHeight*k);
  for(const c of [base,done,orig]){c.width=w;c.height=h;}
  const o=orig.getContext('2d',{willReadFrequently:true});o.drawImage(img,0,0,w,h);done.getContext('2d').drawImage(img,0,0,w,h);
  const px=o.getImageData(0,0,w,h);
  await call({type:'load',image:{width:w,height:h,data:px.data}});
  state=saved?saved.state:fresh();selected=saved?saved.selected:'paint';history=[];future=[];committed=snap();overlay=null;tool='move';
  $('#empty').hidden=true;$('#panel').hidden=false;buttons();panel();size='';
  requestAnimationFrame(()=>{fit();draw();});
  state.eyes=state.eyes||[];
  if(saved){badge('');panel();refresh();return;}
  store.wipe().then(()=>store.put('photo',blob)).then(()=>store.put('edit',{state,selected})).catch(()=>badge('This edit cannot be saved for later.',3000));
  badge('Finding faces… the first time may take longer.');panel();refresh();
  pending=gen;scan();
}
$('#file').onchange=e=>{const f=e.target.files[0];e.target.value='';if(f)load(f).catch(err=>badge(err.message,6000));};
store.get('photo').then(p=>{if(p){$('#resume').hidden=$('#forget').hidden=false;}}).catch(()=>{});
$('#resume').onclick=async()=>{try{const [p,s]=[await store.get('photo'),await store.get('edit')];await load(p,s);}catch{badge('The saved edit could not be restored.',5000);}};
$('#forget').onclick=async()=>{await store.wipe().catch(()=>{});$('#resume').hidden=$('#forget').hidden=true;};

/* export */
function fullPixels(){
  let W=full.naturalWidth,H=full.naturalHeight;const k=Math.min(1,Math.sqrt(MAX_PIXELS/(W*H)));W=Math.round(W*k);H=Math.round(H*k);
  // Read in tiles so no single canvas exceeds iPhone canvas limits.
  const data=new Uint8ClampedArray(W*H*4),T=1024,c=document.createElement('canvas');c.width=c.height=T;
  const g=c.getContext('2d',{willReadFrequently:true}),kx=full.naturalWidth/W,ky=full.naturalHeight/H;
  for(let y=0;y<H;y+=T)for(let x=0;x<W;x+=T){const w=Math.min(T,W-x),h=Math.min(T,H-y);g.clearRect(0,0,T,T);g.drawImage(full,x*kx,y*ky,w*kx,h*ky,0,0,w,h);
    const t=g.getImageData(0,0,w,h).data;for(let r=0;r<h;r++)data.set(t.subarray(r*w*4,(r+1)*w*4),((y+r)*W+x)*4);}
  c.width=c.height=1;
  return {width:W,height:H,data};
}
$('#export').onclick=async()=>{
  $('#export').disabled=true;badge('Making your full-size photo. Keep the app open.');
  await new Promise(r=>setTimeout(r,50));
  try{
    const image=fullPixels(),{width:W,height:H}=image;
    const {jpg}=await call({type:'export',image,state},[image.data.buffer]);
    const file=new File([jpg],'retouched-'+Date.now()+'.jpg',{type:'image/jpeg'});
    if(exported)URL.revokeObjectURL(exported.url);
    exported={file,url:URL.createObjectURL(file)};
    $('#download').href=exported.url;$('#download').download=file.name;
    $('#share').hidden=!(navigator.canShare&&navigator.canShare({files:[file]}));
    const reduced=W<full.naturalWidth?' (reduced from '+full.naturalWidth+' × '+full.naturalHeight+')':'';
    $('#doneText').textContent=`JPEG ready: ${W} × ${H}${reduced}, ${(file.size/1e6).toFixed(1)} MB.`;
    badge('');$('#done').showModal();
  }catch(e){console.error(e);badge('Export failed: '+e.message,8000);}
  $('#export').disabled=false;
};
$('#share').onclick=()=>navigator.share({files:[exported.file]}).catch(()=>{});
$('#close').onclick=()=>$('#done').close();

if('serviceWorker' in navigator){
  const had=!!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)badge('An update is ready. Close the app completely and reopen it.');});
  navigator.serviceWorker.register('sw.js').catch(()=>{});
}
panel();
