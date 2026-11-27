// Pure pixel processing. No DOM, so it runs in a worker and in Node tests.
export const OVAL=[10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const EYE_A=[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246];
const EYE_B=[362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398];
const LIPS=[61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185];
const BROW_A=[70,63,105,66,107,55,65,52,53,46];
const BROW_B=[300,293,334,296,336,285,295,282,283,276];
export const ZERO={smooth:0,texture:80,lines:0,tone:0,redness:0,shine:0};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

function box(src,w,h,r){
  const tmp=new Float32Array(w*h),out=new Float32Array(w*h),n=2*r+1;
  for(let y=0;y<h;y++){const o=y*w;let s=0;
    for(let i=-r;i<=r;i++)s+=src[o+clamp(i,0,w-1)];
    for(let x=0;x<w;x++){tmp[o+x]=s/n;s+=src[o+Math.min(w-1,x+r+1)]-src[o+Math.max(0,x-r)];}}
  const col=new Float64Array(w);
  for(let i=-r;i<=r;i++){const o=clamp(i,0,h-1)*w;for(let x=0;x<w;x++)col[x]+=tmp[o+x];}
  for(let y=0;y<h;y++){const a=Math.min(h-1,y+r+1)*w,b=Math.max(0,y-r)*w;
    for(let x=0;x<w;x++){out[y*w+x]=col[x]/n;col[x]+=tmp[a+x]-tmp[b+x];}}
  return out;
}
export function blur(src,w,h,sigma){
  const r=Math.max(1,Math.round(sigma));
  return box(box(box(src,w,h,r),w,h,r),w,h,r);
}
function maskedBlur(p,m,w,h,sigma,fallback){
  const pm=new Float32Array(p.length);for(let i=0;i<p.length;i++)pm[i]=p[i]*m[i];
  const a=blur(pm,w,h,sigma),b=blur(m,w,h,sigma);
  for(let i=0;i<p.length;i++)a[i]=b[i]>0.02?a[i]/b[i]:fallback;
  return a;
}
function guided(p,w,h,r,eps){
  const n=p.length,sq=new Float32Array(n);for(let i=0;i<n;i++)sq[i]=p[i]*p[i];
  const mu=box(p,w,h,r),mu2=box(sq,w,h,r),a=new Float32Array(n),b=new Float32Array(n);
  for(let i=0;i<n;i++){const v=Math.max(0,mu2[i]-mu[i]*mu[i]);a[i]=v/(v+eps);b[i]=mu[i]*(1-a[i]);}
  const ma=box(a,w,h,r),mb=box(b,w,h,r),q=new Float32Array(n);
  for(let i=0;i<n;i++)q[i]=ma[i]*p[i]+mb[i];
  return q;
}
function fillPoly(m,w,h,pts,val){
  let y0=Infinity,y1=-Infinity;for(const p of pts){y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  for(let y=Math.max(0,Math.floor(y0));y<=Math.min(h-1,Math.ceil(y1));y++){
    const xs=[],cy=y+0.5;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){const a=pts[i],b=pts[j];
      if((a[1]>cy)!==(b[1]>cy))xs.push(a[0]+(cy-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
    xs.sort((u,v)=>u-v);
    for(let k=0;k+1<xs.length;k+=2)for(let x=Math.max(0,Math.ceil(xs[k]-0.5));x<=Math.min(w-1,Math.floor(xs[k+1]-0.5));x++)m[y*w+x]=val;
  }
}
const grow=(pts,s)=>{let cx=0,cy=0;for(const p of pts){cx+=p[0];cy+=p[1];}cx/=pts.length;cy/=pts.length;
  return pts.map(p=>[cx+(p[0]-cx)*s,cy+(p[1]-cy)*s]);};
function stamp(m,w,h,pts,r,mode){
  const cover=new Float32Array(w*h);
  const dot=(px,py)=>{for(let y=Math.max(0,Math.floor(py-r));y<=Math.min(h-1,Math.ceil(py+r));y++)
    for(let x=Math.max(0,Math.floor(px-r));x<=Math.min(w-1,Math.ceil(px+r));x++){
      const d=Math.hypot(x+0.5-px,y+0.5-py)/r;if(d>=1)continue;
      const a=d<0.65?1:(1-d)/0.35,i=y*w+x;if(a>cover[i])cover[i]=a;}};
  for(let k=0;k<pts.length;k++){const a=pts[k],b=pts[Math.min(k+1,pts.length-1)];
    const steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/Math.max(1,r*0.3)));
    for(let s=0;s<=steps;s++)dot(a[0]+(b[0]-a[0])*s/steps,a[1]+(b[1]-a[1])*s/steps);}
  for(let i=0;i<m.length;i++){const c=cover[i];if(!c)continue;m[i]=mode==='add'?Math.max(m[i],c):m[i]*(1-c);}
}

/* target: {id, pts: landmarks normalised 0..1, or null for the painted area}
   strokes: [{target, mode:'add'|'erase', r: fraction of long edge, pts:[[x,y] normalised]}] */
export function prepare(img,target,strokes){
  const W=img.width,H=img.height,long=Math.max(W,H);
  const mine=strokes.filter(s=>s.target===target.id);
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  const add=(x,y,p)=>{x0=Math.min(x0,x-p);y0=Math.min(y0,y-p);x1=Math.max(x1,x+p);y1=Math.max(y1,y+p);};
  let U;
  if(target.pts){
    const o=OVAL.map(i=>[target.pts[i][0]*W,target.pts[i][1]*H]);
    U=Math.max(...o.map(p=>p[0]))-Math.min(...o.map(p=>p[0]));
    U=Math.max(U,24);
    for(const p of o)add(p[0],p[1],U*0.12);
  } else U=long*0.25;
  for(const s of mine)if(s.mode==='add')for(const p of s.pts)add(p[0]*W,p[1]*H,s.r*long+U*0.12);
  if(x0===Infinity)return null;
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));x1=Math.min(W,Math.ceil(x1));y1=Math.min(H,Math.ceil(y1));
  const rw=x1-x0,rh=y1-y0;if(rw<4||rh<4)return null;
  // Work at reduced size; only the correction is scaled back up, so original detail survives.
  const f=Math.max(1,U/700,Math.sqrt(rw*rh/1.6e6));
  const w=Math.max(4,Math.round(rw/f)),h=Math.max(4,Math.round(rh/f)),n=w*h,u=U/f;
  const Y=new Float32Array(n),Cb=new Float32Array(n),Cr=new Float32Array(n);
  const d=img.data,sx=rw/w,sy=rh/h;
  for(let j=0;j<h;j++){const ya=y0+Math.floor(j*sy),yb=Math.max(ya+1,y0+Math.floor((j+1)*sy));
    for(let i=0;i<w;i++){const xa=x0+Math.floor(i*sx),xb=Math.max(xa+1,x0+Math.floor((i+1)*sx));
      let r=0,g=0,b=0,c=0;for(let y=ya;y<yb;y++)for(let x=xa;x<xb;x++){const k=(y*W+x)*4;r+=d[k];g+=d[k+1];b+=d[k+2];c++;}
      r/=c;g/=c;b/=c;const k=j*w+i;
      Y[k]=0.299*r+0.587*g+0.114*b;Cb[k]=-0.168736*r-0.331264*g+0.5*b;Cr[k]=0.5*r-0.418688*g-0.081312*b;}}
  const local=p=>[(p[0]*W-x0)/sx,(p[1]*H-y0)/sy];
  let mask=new Float32Array(n);
  if(target.pts){
    const poly=ids=>ids.map(i=>local(target.pts[i]));
    fillPoly(mask,w,h,poly(OVAL),1);
    for(const [ids,s] of [[EYE_A,1.45],[EYE_B,1.45],[BROW_A,1.12],[BROW_B,1.12],[LIPS,1.08]])
      fillPoly(mask,w,h,grow(poly(ids),s),0);
    // Skin-colour gate: down-weights hair, beard shadow and frames that fall inside the outline.
    const med=a=>{a.sort((p,q)=>p-q);return a[a.length>>1]||0;};
    const ys=[],bs=[],rs=[];for(let i=0;i<n;i+=3)if(mask[i]){ys.push(Y[i]);bs.push(Cb[i]);rs.push(Cr[i]);}
    const mY=med(ys),mB=med(bs),mR=med(rs);
    for(let i=0;i<n;i++)if(mask[i]){
      const dc=Math.hypot(Cb[i]-mB,Cr[i]-mR),dark=Math.max(0,mY*0.74-Y[i]);
      mask[i]=clamp(1-(dc-14)/14,0,1)*clamp(1-dark/(mY*0.16+1),0,1);}
    mask=blur(mask,w,h,u*0.012);
  }
  const auto=mask.slice();
  for(const s of mine)stamp(mask,w,h,s.pts.map(local),Math.max(1,s.r*long/sx),s.mode);
  const stats=new Float32Array(n);let any=0;for(let i=0;i<n;i++){stats[i]=mask[i]>0.5?1:0;any+=stats[i];}
  const sm=any>20?stats:auto;
  let sw=1e-6,my=0,mb=0,mr=0,m2=0;for(let i=0;i<n;i++){const a=sm[i];sw+=a;my+=a*Y[i];m2+=a*Y[i]*Y[i];mb+=a*Cb[i];mr+=a*Cr[i];}
  my/=sw;mb/=sw;mr/=sw;const std=Math.sqrt(Math.max(0,m2/sw-my*my));
  const base=guided(Y,w,h,Math.max(2,Math.round(u*0.028)),20*20);
  const small=blur(Y,w,h,u*0.004);
  const narrow=blur(Y,w,h,u*0.007);
  const wide=maskedBlur(Y,sm,w,h,u*0.025,my);
  const lowY=blur(Y,w,h,u*0.025),veryY=maskedBlur(Y,sm,w,h,u*0.11,my);
  const lowB=maskedBlur(Cb,sm,w,h,u*0.018,mb),lowR=maskedBlur(Cr,sm,w,h,u*0.018,mr);
  const softB=blur(Cb,w,h,u*0.008),softR=blur(Cr,w,h,u*0.008);
  const planes=()=>new Float32Array(n);
  const mid=planes(),line=planes(),patch=planes(),dB=planes(),dR=planes(),red=planes(),sB=planes(),sR=planes();
  for(let i=0;i<n;i++){
    mid[i]=base[i]-small[i];
    line[i]=Math.min(28,Math.max(0,wide[i]-narrow[i]));
    patch[i]=clamp(veryY[i]-lowY[i],-22,22);
    dB[i]=mb-lowB[i];dR[i]=mr-lowR[i];
    red[i]=Math.max(0,lowR[i]-mr-1.5);
    sB[i]=softB[i]-Cb[i];sR[i]=softR[i]-Cr[i];
  }
  return {x0,y0,rw,rh,w,h,mask,small,mid,line,patch,dB,dR,red,sB,sR,shineAt:my+0.7*std};
}

// Adds this target's correction onto dst. Layers are always read from src.
export function render(src,dst,L,params){
  const p={...ZERO,...params},s=p.smooth/100,t=p.texture/100,li=p.lines/100,to=p.tone/100,re=p.redness/100,sh=p.shine/100;
  if(!(s||li||to||re||sh))return;
  const W=src.width,S=src.data,D=dst.data,{x0,y0,rw,rh,w,h}=L,kx=w/rw,ky=h/rh;
  const cx=new Int32Array(rw),fx=new Float32Array(rw);
  for(let x=0;x<rw;x++){const u=clamp((x+0.5)*kx-0.5,0,w-1);cx[x]=Math.min(w-2,u|0);fx[x]=u-cx[x];}
  for(let y=0;y<rh;y++){
    const v=clamp((y+0.5)*ky-0.5,0,h-1),j=Math.min(h-2,v|0),fy=v-j;
    for(let x=0;x<rw;x++){
      const a=j*w+cx[x],b=a+1,c=a+w,e=c+1,q=fx[x];
      const wa=(1-q)*(1-fy),wb=q*(1-fy),wc=(1-q)*fy,we=q*fy;
      const at=P=>P[a]*wa+P[b]*wb+P[c]*wc+P[e]*we;
      const m=at(L.mask);if(m<0.004)continue;
      const k=((y0+y)*W+x0+x)*4,r=S[k],g=S[k+1],bl=S[k+2];
      const Y=0.299*r+0.587*g+0.114*bl,Cr=0.5*r-0.418688*g-0.081312*bl;
      let dY=0,dCb=0,dCr=0;
      if(s){const fine=Y-at(L.small);dY+=s*(at(L.mid)-(1-t)*fine);dCb+=s*0.7*at(L.sB);dCr+=s*0.7*at(L.sR);}
      if(li)dY+=li*0.85*(1-0.6*s)*at(L.line);
      if(to){dY+=to*0.55*at(L.patch);dCb+=to*0.8*at(L.dB);dCr+=to*0.8*at(L.dR);}
      if(re)dCr-=re*0.9*Math.min(at(L.red),Math.max(0,Cr+dCr));
      if(sh){const over=Y+dY-L.shineAt;if(over>0)dY-=sh*0.65*over*over/(over+10);}
      D[k]+=Math.round(m*(dY+1.402*dCr));
      D[k+1]+=Math.round(m*(dY-0.344136*dCb-0.714136*dCr));
      D[k+2]+=Math.round(m*(dY+1.772*dCb));
    }
  }
}

function sample(d,W,H,x,y,c){
  x=clamp(x,0,W-1.001);y=clamp(y,0,H-1.001);const i=x|0,j=y|0,a=x-i,b=y-j,k=(j*W+i)*4+c;
  return d[k]*(1-a)*(1-b)+d[k+4]*a*(1-b)+d[k+W*4]*(1-a)*b+d[k+W*4+4]*a*b;
}
// Choose a nearby clean patch whose surroundings match. Returns a normalised offset.
export function pickSource(img,spot){
  const {width:W,height:H,data:d}=img,long=Math.max(W,H),cx=spot.x*W,cy=spot.y*H,r=spot.r*long;
  let best=null,score=Infinity;
  for(const dist of [2.2,2.8,3.6])for(let a=0;a<24;a++){
    const dx=Math.cos(a/24*2*Math.PI)*dist*r,dy=Math.sin(a/24*2*Math.PI)*dist*r;
    if(cx+dx-1.4*r<0||cy+dy-1.4*r<0||cx+dx+1.4*r>=W||cy+dy+1.4*r>=H)continue;
    const diff=[],inner=[];
    for(const q of [1.08,1.3])for(let k=0;k<32;k++){const t=k/32*2*Math.PI,x=cx+Math.cos(t)*r*q,y=cy+Math.sin(t)*r*q;
      diff.push([0,1,2].map(c=>sample(d,W,H,x,y,c)-sample(d,W,H,x+dx,y+dy,c)));}
    for(let v=-3;v<=3;v++)for(let u=-3;u<=3;u++)if(u*u+v*v<=9)inner.push(sample(d,W,H,cx+dx+u*r/3,cy+dy+v*r/3,1));
    let sc=0;for(let c=0;c<3;c++){const mean=diff.reduce((s,v)=>s+v[c],0)/diff.length;
      sc+=diff.reduce((s,v)=>s+(v[c]-mean)**2,0)/diff.length+0.12*mean*mean;}
    const mi=inner.reduce((s,v)=>s+v,0)/inner.length;
    sc+=1.5*inner.reduce((s,v)=>s+(v-mi)**2,0)/inner.length+dist;
    if(sc<score){score=sc;best=[dx/W,dy/H];}
  }
  return best;
}
// Copy the source patch and blend its edge into the surroundings.
export function heal(img,spot){
  if(!spot.off)return;
  const {width:W,height:H,data:d}=img,long=Math.max(W,H),cx=spot.x*W,cy=spot.y*H,r=Math.max(2,spot.r*long),ox=spot.off[0]*W,oy=spot.off[1]*H;
  const N=48,raw=[];
  for(let k=0;k<N;k++){const t=k/N*2*Math.PI,x=cx+Math.cos(t)*r,y=cy+Math.sin(t)*r;
    raw.push({x,y,v:[0,1,2].map(c=>sample(d,W,H,x,y,c)-sample(d,W,H,x+ox,y+oy,c))});}
  const ring=raw.map((p,k)=>({x:p.x,y:p.y,v:[0,1,2].map(c=>{const a=[];for(let j=-4;j<=4;j++)a.push(raw[(k+j+N)%N].v[c]);a.sort((u,v)=>u-v);return (a[3]+a[4]+a[5])/3;})}));
  const bx=Math.max(0,Math.floor(cx-r)),by=Math.max(0,Math.floor(cy-r)),ex=Math.min(W-1,Math.ceil(cx+r)),ey=Math.min(H-1,Math.ceil(cy+r)),out=[];
  for(let y=by;y<=ey;y++)for(let x=bx;x<=ex;x++){
    const q=Math.hypot(x-cx,y-cy)/r;if(q>=1)continue;
    let sw=0;const acc=[0,0,0];
    for(const p of ring){const w=1/(((x-p.x)**2+(y-p.y)**2)+1);sw+=w;acc[0]+=w*p.v[0];acc[1]+=w*p.v[1];acc[2]+=w*p.v[2];}
    const al=q<0.75?1:(1-q)/0.25,k=(y*W+x)*4;
    out.push([k,[0,1,2].map(c=>d[k+c]*(1-al)+al*(sample(d,W,H,x+ox,y+oy,c)+acc[c]/sw))]);
  }
  for(const [k,v] of out){d[k]=v[0];d[k+1]=v[1];d[k+2]=v[2];}
}
