import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base=process.argv[2]??'https://scientistss.github.io/Infinity/';
const expected=JSON.parse(readFileSync('dist/release.json','utf8'));
let found=null;
for(let i=0;i<45;i++) {
 try{const r=await fetch(`${base}release.json?verify=${expected.sourceSha}-${i}`,{signal:AbortSignal.timeout(15000)});if(r.ok){const v=await r.json();if(v.sourceSha===expected.sourceSha&&v.version===expected.version){found=v;break;}}}catch(e){console.log(`release retry ${i+1}: ${e.message}`);}
 await new Promise(r=>setTimeout(r,2000));
}
if(!found)throw Error('Public release has not reached the expected commit');
if(JSON.stringify(found.files)!==JSON.stringify(expected.files))throw Error('Release file manifest differs from tested build');
for(const [file,digest]of Object.entries(expected.files)){
 const response=await fetch(`${base}${file}?verify=${expected.sourceSha}`,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error(`${file}: HTTP ${response.status}`);
 const actual=createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex');
 if(actual!==digest)throw Error(`Public file hash mismatch: ${file}`);
}
console.log(JSON.stringify({verified:true,url:base,sourceSha:found.sourceSha,version:found.version,files:Object.keys(found.files).length}));
