import {prepare,render,heal,pickSource,renderFeatures,renderTapEyes,isActive,SKIN_KEYS} from './engine.js';
let original=null,healed=null,healKey=null,cache=new Map();
const copy=i=>({width:i.width,height:i.height,data:new Uint8ClampedArray(i.data)});
function applyHeals(img,heals){for(const s of heals)heal(img,s);return img;}
// All skin passes first, then eyes, teeth and makeup on top.
function compose(src,state,get){
  const out=copy(src);
  for(const t of state.targets)if(isActive(state.params[t.id],SKIN_KEYS)){const L=get(src,t,state);if(L)render(src,out,L,state.params[t.id]);}
  for(const t of state.targets)renderFeatures(out,t,state.params[t.id]);
  if(state.eyes&&state.eyes.length)renderTapEyes(out,state.eyes,state.params.eyes);
  return out;
}
self.onmessage=async e=>{
  const m=e.data;
  try{
    if(m.type==='load'){original=m.image;healKey=null;healed=null;cache.clear();self.postMessage({id:m.id});}
    else if(m.type==='pick'){const base=applyHeals(copy(original),m.heals);self.postMessage({id:m.id,off:pickSource(base,m.spot)});}
    else if(m.type==='render'){
      const st=m.state,key=JSON.stringify(st.heals);
      if(key!==healKey){healed=applyHeals(copy(original),st.heals);healKey=key;cache.clear();}
      const get=(src,t,state)=>{
        const k=JSON.stringify([t,state.strokes.filter(s=>s.target===t.id)]);
        const c=cache.get(t.id);if(c&&c.k===k)return c.L;
        const L=prepare(src,t,state.strokes);cache.set(t.id,{k,L});return L;};
      const out=compose(healed,st,get);
      let overlay=null;
      const t=st.targets.find(t=>t.id===m.maskFor);
      if(t){const L=get(healed,t,st);if(L)overlay={x0:L.x0,y0:L.y0,rw:L.rw,rh:L.rh,w:L.w,h:L.h,mask:L.mask.slice()};}
      self.postMessage({id:m.id,image:out,overlay},[out.data.buffer]);
    }
    else if(m.type==='export'){
      const {default:encode}=await import('./vendor/jpeg-encoder.js');
      const src=applyHeals(m.image,m.state.heals),st=m.state;
      const out=compose(src,st,(s,t,state)=>prepare(s,t,state.strokes));
      const jpg=encode(out,95).data;
      self.postMessage({id:m.id,jpg},[jpg.buffer]);
    }
  }catch(err){self.postMessage({id:m.id,error:String(err&&err.message||err)});}
};
