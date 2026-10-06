import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
const text=readFileSync('src/data/art-manifest.json','utf8'),m=JSON.parse(text);
writeFileSync('dist/release.json',JSON.stringify({version:pkg.version,sourceRevision:process.env.GITHUB_SHA||'local',saveVersion:9,featureStage:'P4 playable core',artVersion:m.version,assetCount:Object.keys(m.assets).length,artManifestSha256:createHash('sha256').update(text).digest('hex')},null,2)+'\n');
