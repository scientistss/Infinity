import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest=JSON.parse(readFileSync('src/data/ring-art.json','utf8'));
if(Object.keys(manifest).length!==15)throw Error('星环机图标必须恰有15类');
const paths=new Set();
for(const [id,item] of Object.entries(manifest)){
 if(!/^[a-z_]+$/.test(id)||!new RegExp(`^icons/ring-v1/${id}\\.[a-f0-9]{10}\\.svg$`).test(item.file)||!item.alt)throw Error('图标路径或文字无效');
 if(paths.has(item.file))throw Error('重复图标文件');paths.add(item.file);
 const bytes=readFileSync('public/'+item.file), text=bytes.toString('utf8');
 const hash=createHash('sha256').update(bytes).digest('hex');
 if(hash!==item.sha256||!item.file.includes(hash.slice(0,10)))throw Error('图标哈希不匹配：'+id);
 if(!text.includes('viewBox="0 0 128 128"')||/<(?:script|foreignObject|image|use|animate)\b|\bon\w+\s*=|(?:href|src)\s*=|<!DOCTYPE|<!ENTITY/i.test(text))throw Error('图标不是独立静态SVG：'+id);
}
if(readdirSync('public/icons/ring-v1').length!==15)throw Error('图标目录包含未登记文件');
console.log(JSON.stringify({icons:15,format:'standalone static SVG',provenance:'original vector artwork, not Imagen',result:'passed'}));
