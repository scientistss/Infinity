#!/usr/bin/env python3
"""Prepare immutable historical source inputs; never execute Node or edit old fixtures.

python scripts/scout-historical-fixtures.py --artifact-root /path/to/infinity-7554-result \
  --work-root /tmp/infinity-scout-historical
Then, under the shared Node execution lease, run the .mjs producer with prepared.json.
The companion producer creates genuine source exports and independently runs old readers.
"""
import argparse, hashlib, io, json, pathlib, subprocess, tarfile

SOURCES = {
 2:'3d29c3942225e161977f4f298d970413738553f2',
 3:'ebf75a755aa87f0b452bf427eb6cda833e26990d',
 4:'55f7aa9e483c69901a560dd51d1b9c1ce1ad1514',
 5:'b58c8816ad1d7e7e5e0b3d839f1668e18de22de4',
 6:'bc6f5a475336dca1bb02d4f1061ee01ba9c5d9c4',
 7:'090d3124f799f4dadb890922268c2cc1d32e9ad8',
 8:'4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b',
 9:'f96894eb1b32737ab403890ed83fdb3da41a0644',
 10:'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a',
 11:'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b',
 12:'eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81',
 13:'7554c662e3ac1f27876a60d8aa706e5d4a4dcd52',
}
REPORTS = {
 'r12': ('npc-attack-source-evidence/r12-natural-report.json','e6a3799a0bfcf1b537b0f2fa3611bc217d486a631a5e2bb8e496edc846a8733e'),
 'r13': ('npc-attack-native-report.json','3fefd6e519d5e62c02e7c23c1ac299759e882600580da62542710342b99d785f'),
}
sha=lambda b:hashlib.sha256(b).hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--artifact-root',type=pathlib.Path,required=True);p.add_argument('--work-root',type=pathlib.Path,required=True);a=p.parse_args()
 repo=pathlib.Path(__file__).resolve().parent.parent;work=a.work_root.resolve();work.mkdir(parents=True,exist_ok=True)
 def git(*args):return subprocess.check_output(['git','-C',str(repo),*args])
 bindings={}
 for revision,commit in SOURCES.items():
  root=work/f'r{revision}';root.mkdir(exist_ok=True)
  # All executable production source is extracted unmodified, not selected current files.
  archive=git('archive',commit,'src','package.json','package-lock.json','tsconfig.json')
  with tarfile.open(fileobj=io.BytesIO(archive)) as tar:tar.extractall(root,filter='data')
  deps=root/'node_modules'
  if not deps.exists():deps.symlink_to(repo/'node_modules',target_is_directory=True)
  files=[]
  for name in git('ls-tree','-r','--name-only',commit,'src','package.json','package-lock.json','tsconfig.json').decode().splitlines():
   expected=git('show',f'{commit}:{name}');actual=(root/name).read_bytes();assert actual==expected,name
   files.append({'path':name,'sha256':sha(actual)})
  bindings[str(revision)]={'revision':revision,'sourceSha':commit,'sourceTree':git('rev-parse',commit+':src').decode().strip(),'serializerSha256':sha((root/'src/game/save.ts').read_bytes()),'sourceFiles':files,'root':str(root)}
 reports={};rows=[]
 for kind,(relative,expected) in REPORTS.items():
  file=a.artifact_root/relative;data=file.read_bytes();assert sha(data)==expected,(file,'report hash changed')
  report=json.loads(data);revision=int(kind[1:]);assert report['source']['sourceSha']==SOURCES[revision]
  assert report['outcome']['status']=='passed'
  for entry in report['source']['sourceFiles']:
   assert sha(git('show',f"{SOURCES[revision]}:{entry['path']}"))==entry['sha256'],entry['path']
  reports[kind]={'reportPath':relative,'reportSha256':expected,'reportBytes':len(data),'sourceSha':SOURCES[revision],'producerSha256':report['source']['scriptSha256'],'sourceScopeStatusPorcelain':report['source'].get('sourceScopeStatusPorcelain'),'originalOutcome':report['outcome'],'provenance':report['provenance'],'ciRunId':None,'ciRunNote':'No run ID is present in the original report; none inferred.'}
  names=({'first-scout-outbound','second-scout-halfway-native-free-strict-reload','second-snapshot-returning','final-returned-and-reloaded'} if revision==12 else {'new-scout6-outbound','new-scout6-historical-garrison','new-scout6-returned','attack7-paid-outbound','attack7-live-loop-3','win8-loot-delivered-once','rescout9-outbound','rescout9-dead-garrison-still-zero','empty10-zero-round-loot-delivered'})
  for index,m in enumerate(report['milestones']):
   if m['name'] not in names:continue
   raw=m['raw'];assert sha(raw.encode())==m['rawSha256'];envelope=json.loads(raw);assert envelope['revision']==revision
   rows.append({'id':f"r{revision}-{m['name']}",'revision':revision,'raw':raw,'rawSha256':m['rawSha256'],'rawBytes':len(raw.encode()),'sourceSha':SOURCES[revision],'synthetic':False,'naturalProgression':True,'provenance':{'kind':'original-source-export-string','report':kind,'jsonPath':f"milestones[{index}].raw",'milestone':m['name'],'strictRoundtrips':m.get('strictRoundtrips'),'stateAdoptedFromReload':m.get('stateAdoptedFromReload'),'bytes':'Decoded original JSON raw string, no parse/reserialize or state edit.'}})
  assert len([r for r in rows if r['revision']==revision])==len(names)
  if revision==12:assert [r for r in rows if r['id']=='r12-final-returned-and-reloaded'][0]['rawSha256']=='047d49cbf04fd5424bca4d7d45e861e0439a0d51c4ac54700f77e263bb8eadcc'
 preparation={'schema':'infinity-scout-historical-preparation-v1','repo':str(repo),'sourceBindings':bindings,'originalReports':reports,'rows':rows}
 target=work/'prepared.json';target.write_text(json.dumps(preparation,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'prepared':str(target),'sources':len(bindings),'originalRawRows':len(rows),'originalRawSha256':[r['rawSha256'] for r in rows]},indent=2))

if __name__=='__main__':main()
