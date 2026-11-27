// One unfinished edit, kept in this browser only. Failures are non-fatal.
const open=()=>new Promise((ok,no)=>{const q=indexedDB.open('retouch',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>ok(q.result);q.onerror=()=>no(q.error);});
async function tx(mode,fn){const db=await open();return new Promise((ok,no)=>{const t=db.transaction('kv',mode),r=fn(t.objectStore('kv'));t.oncomplete=()=>{db.close();ok(r&&r.result);};t.onerror=t.onabort=()=>{db.close();no(t.error);};});}
export const put=(k,v)=>tx('readwrite',s=>s.put(v,k));
export const get=k=>tx('readonly',s=>s.get(k));
export const wipe=()=>tx('readwrite',s=>s.clear());
