"""Crop the conversation's 1536x1024 contact sheet (not Google Imagen).
Usage: python scripts/extract-art.py source.png
Requires Pillow. All filenames are content hashed; captions are excluded.
"""
from pathlib import Path
import sys, json, hashlib, io
from PIL import Image, ImageOps
ROOT=Path(__file__).resolve().parents[1]
SOURCE_SHA='bf44dd0310cf63b77945adb5deff733f83dc3972adbf00e28249d17ce16b14be'
CROPS={
 'galaxy-banner':([2,2,478,154],476,'旋涡星系与远方星光','scene'),
 'homeworld':([494,32,674,286],254,'母星上的未来城市','scene'),
 'galaxy':([690,33,874,285],252,'银河航线与恒星','scene'),
 'fleet':([889,34,1088,286],252,'行星轨道上的舰队','scene'),
 'colony':([1106,32,1294,285],253,'殖民地与穹顶设施','scene'),
 'deep-space':([1310,32,1521,287],255,'深空星云','scene'),
 'orbital':([15,882,303,1006],288,'行星轨道空间站','scene'),
 'metal':([17,373,96,474],96,'金属','resource'),
 'crystal':([109,373,191,474],96,'晶体','resource'),
 'deuterium':([205,373,280,474],96,'重氢','resource'),
 'energy':([299,373,374,474],96,'能源','resource'),
 'dark-matter':([392,373,468,474],96,'暗物质容器','resource'),
 'metal-mine':([494,376,590,474],96,'金属矿','building'),
 'crystal-mine':([611,375,711,474],96,'晶体矿','building'),
 'deuterium-synth':([734,375,829,474],96,'重氢合成器','building'),
 'solar-plant':([848,375,955,474],96,'太阳能电站','building'),
 'research-lab':([977,375,1079,474],96,'研究实验室','building'),
 'shipyard':([1102,375,1250,474],112,'环形造船厂','building'),
 'spaceport':([1277,375,1390,474],96,'轨道工程设施','building'),
 'defense':([1412,375,1519,474],96,'防御平台','building'),
 'transport':([18,552,145,637],128,'运输舰','ship'),
 'colonizer':([165,552,305,637],140,'殖民船','ship'),
 'scout':([325,552,444,637],128,'侦察舰','ship'),
 'frigate':([465,552,585,637],128,'轻型护航舰','ship'),
 'destroyer':([604,552,778,637],156,'重型攻击舰','ship'),
 'cruiser':([798,552,970,637],156,'巡洋舰','ship'),
 'battleship':([991,552,1219,637],176,'战列舰','ship'),
 'capital':([1240,552,1518,637],192,'旗舰','ship'),
 'badge-explorer':([1176,720,1232,802],82,'开拓者徽章','badge'),
 'badge-colonist':([1250,720,1318,802],82,'殖民者徽章','badge'),
 'badge-galaxy':([1334,720,1408,802],82,'银河徽章','badge'),
 'badge-infinity':([1426,720,1500,802],82,'无限徽章','badge'),
}
for name,x,alt in [('planet',15,'星球'),('galaxy',81,'银河'),('fleet',148,'舰队'),('build',216,'建造'),('research',282,'研究'),('trade',351,'贸易'),('messages',417,'消息'),('achievements',485,'成就'),('settings',553,'设置')]:
 CROPS['nav-'+name]=([x+6,712,x+53,750],48,alt,'navigation')
for name,x,alt in [('resource',15,'资源'),('warehouse',81,'仓储'),('production',148,'生产'),('dock',216,'船坞'),('shield',282,'防御'),('tasks',351,'任务'),('tree',417,'科技树'),('diplomacy',485,'外交'),('ranking',553,'排行榜')]:
 CROPS['nav-'+name]=([x+6,783,x+53,817],48,alt,'navigation')
def main():
 if len(sys.argv)!=2:raise SystemExit(__doc__)
 raw=Path(sys.argv[1]).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=SOURCE_SHA:raise SystemExit('Unreviewed image: source checksum mismatch')
 image=Image.open(io.BytesIO(raw)).convert('RGB')
 if image.size!=(1536,1024):raise SystemExit('Expected 1536x1024')
 out=ROOT/'public/art/v1';out.mkdir(parents=True,exist_ok=True)
 assets={}
 for name,(box,maximum,alt,group) in CROPS.items():
  crop=image.crop(box);crop.thumbnail((maximum,maximum),Image.Resampling.LANCZOS)
  if group in ('navigation','resource','building','badge'):
   n=max(crop.size);crop=ImageOps.pad(crop,(n,n),color=(3,12,21))
  buf=io.BytesIO();crop.save(buf,'WEBP',quality=80,method=6);data=buf.getvalue();sha=hashlib.sha256(data).hexdigest()
  filename=f'{name}.{sha[:12]}.webp';(out/filename).write_bytes(data)
  assets[name]={'file':f'art/v1/{filename}','width':crop.width,'height':crop.height,'alt':alt,'group':group,'crop':box,'bytes':len(data),'sha256':sha}
 manifest={'version':1,'source':{'kind':'conversation-image-generation','provider':'ChatGPT image generation (not Google Imagen)','sha256':SOURCE_SHA,'width':1536,'height':1024},'assets':assets}
 (ROOT/'src/data/art-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 favicon=Image.open(out/Path(assets['nav-planet']['file']).name).convert('RGB')
 for name,n in [('favicon-32.png',32),('favicon-64.png',64),('apple-touch-icon.png',180)]:
  favicon.resize((n,n),Image.Resampling.LANCZOS).quantize(colors=64,method=Image.Quantize.MEDIANCUT).save(ROOT/'public'/name,optimize=True)
 print(len(assets),'assets,',sum(a['bytes'] for a in assets.values()),'bytes')
if __name__=='__main__':main()
