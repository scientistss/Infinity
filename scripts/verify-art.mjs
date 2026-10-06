/** Build-time binary and path integrity; no dependency beyond Node. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('../src/data/art-manifest.json',import.meta.url),'utf8'));
let total=0;
for(const[id,a]of Object.entries(manifest.assets)){
 assert.match(a.file,/^art\/v1\/[a-z-]+\.[a-f0-9]{12}\.webp$/);
 const b=readFileSync(new URL('../public/'+a.file,import.meta.url));
 assert.equal(b.length,a.bytes,id);assert.equal(createHash('sha256').update(b).digest('hex'),a.sha256,id);
 assert.ok(a.file.includes(a.sha256.slice(0,12)));
 assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');
 assert.ok(a.width>0&&a.height>0&&a.alt.length>0);total+=b.length;
}
assert.equal(readdirSync(new URL('../public/art/v1/',import.meta.url)).length,Object.keys(manifest.assets).length);
console.log(`Art integrity: ${Object.keys(manifest.assets).length} files, ${total} bytes, all SHA-256 checks passed.`);
