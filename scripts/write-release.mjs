import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
function walk(dir){return readdirSync(dir).flatMap(name=>statSync(`${dir}/${name}`).isDirectory()?walk(`${dir}/${name}`):[`${dir}/${name}`]);}
let sha=process.env.GITHUB_SHA??'local';
if(sha==='local'){try{sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{ /* Local archive build. */ }}
const files=Object.fromEntries(walk('dist').filter(p=>!p.endsWith('/release.json')).sort().map(p=>[p.slice(5),createHash('sha256').update(readFileSync(p)).digest('hex')]));
writeFileSync('dist/release.json',JSON.stringify({version:pkg.version,sourceSha:sha,lineage:'original-69eca71',saveVersion:9,saveRevision:3,ringVisualVersion:'ring-v1',ringIconCount:15,deepUiVersion:'deep-r2',features:['deep-dashboard','report-filter','ring-visual','ring-history','source-odds','charge','merchant','blackhole-protection','salvage','pirate-alien-combat'],files},null,2)+'\n');
console.log(`Release ${pkg.version} / ${sha}: ${Object.keys(files).length} files hashed`);
