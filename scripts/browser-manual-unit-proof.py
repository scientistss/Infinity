"""Read-only old immutable production bundle, anonymous native UI functional repro.
Only fixture copy, evidence, and isolated browser storage are written. Production is unchanged.
Date/performance/RAF use the original reviewed CLOCK, with ZERO positive advances.
No claim of wall-clock play, natural-human browser provenance, or browser on user's PC.
"""
import argparse, ast, copy, hashlib, http.server, json, os, pathlib, signal, subprocess, threading, time, traceback, zipfile
from decimal import Decimal
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root',type=pathlib.Path,required=True)
parser.add_argument('--source-archive',type=pathlib.Path,required=True)
parser.add_argument('--source-binding',type=pathlib.Path,required=True)
parser.add_argument('--natural-report',type=pathlib.Path,required=True)
parser.add_argument('--dist',type=pathlib.Path,required=True)
parser.add_argument('--published-manifest',type=pathlib.Path,required=True)
parser.add_argument('--expected-source-sha',required=True)
parser.add_argument('--expected-test-sha',required=True)
parser.add_argument('--chromium',required=True)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
ROOT=args.source_root.resolve()
DIST=args.dist.resolve()
REPORT=args.natural_report.resolve()
SOURCE=args.source_archive.resolve()
OUT=args.output.resolve()
KEY='infinity.original-p4.save.v1'
SOURCE_SHA='241a51de31364e9086abcc304884bf9df7cd6912'
REPORT_SHA='9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea'
RELEASE_SHA='4e507e07499f551ecf5d66b937b62c739ab9c6469bd6302a2d4c13852d646843'
started=time.monotonic(); report={'schema':'infinity-manual-unit-native-counterexample-v1','completed':False,'bugConfirmed':False,'codeSourceSha':SOURCE_SHA,'testSourceSha':args.expected_test_sha,'runIdentity':{'repository':os.environ.get('GITHUB_REPOSITORY'),'runId':os.environ.get('GITHUB_RUN_ID'),'runAttempt':os.environ.get('GITHUB_RUN_ATTEMPT'),'job':os.environ.get('GITHUB_JOB'),'ref':os.environ.get('GITHUB_REF')},'classification':'Fresh GitHub runner system Chrome, headless, anonymous isolated contexts, actual native Playwright fill/click and unchanged HTTP production bundle. Unchanged natural-engine checkpoint; controlled functional Date/performance/RAF, zero positive advances. Not user WIN browser or wall-clock/natural-human UI play.','checks':[],'cases':[],'errors':[],'network':[]}
OUT.mkdir(exist_ok=False)
def digest(b):return hashlib.sha256(b).hexdigest()
def write(name,value):
 p=OUT/name
 if isinstance(value,bytes):p.write_bytes(value)
 else:p.write_text(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,indent=2)+'\n')
 return {'file':name,'sha256':digest(p.read_bytes()),'bytes':p.stat().st_size}
def flush():
 report['hostElapsedSeconds']=time.monotonic()-started
 write('report.json',report)
def check(name,ok,detail=None):
 report['checks'].append({'name':name,'passed':bool(ok),'detail':detail});flush()
 if not ok:raise AssertionError(name)
def diff(a,b,path=''):
 if type(a)!=type(b):return [{'path':path,'before':a,'after':b}]
 if isinstance(a,dict):
  result=[]
  for k in sorted(a.keys()|b.keys()):result+=diff(a.get(k),b.get(k),path+'/'+k)
  return result
 if isinstance(a,list):
  if len(a)!=len(b):return [{'path':path,'before':a,'after':b}]
  return [r for i,(x,y) in enumerate(zip(a,b)) for r in diff(x,y,path+'/'+str(i))]
 return [] if a==b else [{'path':path,'before':a,'after':b}]
def snapshot(page,label):
 value=page.evaluate('({key})=>({storage:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),raw:localStorage.getItem(key),clicks:window.__npcClicks,edits:window.__npcEdits,witness:window.__unitWitness,clock:Date.now(),performance:performance.now(),dom:document.documentElement.outerHTML})',{'key':KEY})
 write(label+'.json',value)
 return value

def advance(page):
 v=page.evaluate('window.__npcAdvance(0)');write('last-zero-frame.json',v)
 check('zero functional frame retains epoch',v['beforeAt']==v['afterAt'])
def click(page,selector,label):
 n=page.evaluate('window.__npcClicks.length');page.locator(selector).click();advance(page)
 events=page.evaluate('(n)=>window.__npcClicks.slice(n)',n);write(label+'-click.json',events)
 check(label+': exactly one genuine trusted button click',len(events)==1 and events[0]['trusted'],events)
def tab(page,name,label):click(page,'[data-tab="'+name+'"]',label)
def manual_save(page,label):
 tab(page,'save',label+'-tab');click(page,'[data-action="save"]',label)
 v=snapshot(page,label);check(label+': actual non-null full saved envelope',isinstance(v['raw'],str) and json.loads(v['raw'])['schema']=='infinity-original-p4',{'rawLength':len(v['raw'] or '')})
 return json.loads(v['raw'])
class Server(http.server.ThreadingHTTPServer):daemon_threads=True
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,fmt,*args):report['network'].append({'request':self.path,'message':fmt%args})
 def translate_path(self,path):
  path=urlparse(path).path
  if path.startswith('/Infinity/'):path=path[len('/Infinity/'):]
  else:path=path.lstrip('/')
  return str(DIST/path)
server=None;browser=None;context=None;page=None;playwright_manager=None;pw=None
try:
 signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('180 second bounded native repro exceeded')));signal.alarm(180)
 release=json.loads((DIST/'release.json').read_text());published=json.loads(args.published_manifest.read_text());source_binding=json.loads(args.source_binding.read_text())
 actual={str(p.relative_to(DIST)):digest(p.read_bytes()) for p in DIST.rglob('*') if p.is_file()}
 binding={'dist':str(DIST),'sourceSha':SOURCE_SHA,'release':release,'actualFiles':actual,'publishedManifest':published,'sourceBinding':source_binding,'sourceZipSha256':digest(SOURCE.read_bytes())}
 write('immutable-source-binding.json',binding)
 check('mandatory exact code and test identities',args.expected_source_sha==SOURCE_SHA and source_binding['codeSourceSha']==SOURCE_SHA and source_binding['testSourceSha']==args.expected_test_sha and source_binding['complete'] is True)
 check('release exact known immutable bytes and source',actual['release.json']==RELEASE_SHA and release['sourceSha']==SOURCE_SHA)
 check('all 62 release resource hashes exactly match immutable dist',len(release['files'])==62 and all(actual[k]==v for k,v in release['files'].items()))
 check('complete fresh dist matches published old manifest with no additions or omissions',release==published and set(actual)==set(published['files'])|{'release.json'} and all(actual[k]==v for k,v in published['files'].items()))
 check('fresh archive raw bytes match all-source git-blob binding',binding['sourceZipSha256']==source_binding['source']['sourceArchiveSha256'])
 z=zipfile.ZipFile(SOURCE);source_code={p:z.read('Infinity/'+p) for p in ['scripts/browser-npc-attack.py','src/ui/shipyard-panel.ts','src/ui/view.ts','src/main.ts','src/game/shipyard.ts','src/game/order-ledger.ts','src/data/units.ts']}
 for p,b in source_code.items():write('source-'+p.replace('/','--'),b)
 report['sourceEvidence']={p:digest(b) for p,b in source_code.items()}
 natural_bytes=REPORT.read_bytes();natural=json.loads(natural_bytes)
 write('natural-provenance.json',{'reportPath':str(REPORT),'sha256':digest(natural_bytes),'sourceSha':SOURCE_SHA,'producer':'Fresh node --import tsx scripts/natural-growth-journey.ts executed in exact baseline worktree; no saved report uploaded','provenance':natural['provenance'],'scope':'Fresh exact241a natural-engine driver handoff, not claimed as continuous natural UI play.'})
 check('fresh natural report reproduces deterministic public baseline report',digest(natural_bytes)==REPORT_SHA and natural['outcome']['status']=='passed' and natural['provenance']['injectedGameState'] is False and natural['seeds']=={'world':20261010,'arcade':20261010})
 milestone=next(m for m in natural['milestones'] if m['name']=='05-home-research-naturally-paid-and-completed')
 initial=milestone['save'];initial_raw=json.dumps(initial,ensure_ascii=False,separators=(',',':'))
 write('original-natural-milestone.json',milestone);write('original-natural-save.json',initial_raw)
 h=next(p for p in initial['state']['planets'] if p['id']=='homeworld')
 check('natural checkpoint qualifies small cargo without funds or queue injection',h['buildings']['shipyard']>=2 and initial['state']['research']['levels']['combustion_drive']>=2 and len(h['shipyardQueue'])==0 and Decimal(h['resources']['metal'])>=2000 and Decimal(h['resources']['crystal'])>=2000,{'wallet':h['resources'],'shipyard':h['buildings']['shipyard'],'combustion':initial['state']['research']['levels']['combustion_drive'],'queue':h['shipyardQueue']})
 server=Server(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 ORIGIN='http://127.0.0.1:'+str(server.server_port);url=ORIGIN+'/Infinity/'
 tree=ast.parse(source_code['scripts/browser-npc-attack.py'].decode())
 clocknode=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CLOCK' for t in n.targets))
 exec(compile(ast.Module(body=[clocknode],type_ignores=[]),'<unchanged-old-production-observer-clock>','exec'),globals())
 report['environment']={'origin':ORIGIN,'url':url,'browserBinary':args.chromium,'binaryVersion':subprocess.check_output([args.chromium,'--version'],text=True).strip(),'clockEpoch':initial['savedAt'],'positiveClockAdvances':0,'serviceScope':'loopback temporary immutable dist HTTP server'}
 OBSERVER=r'''\nwindow.__unitWitness={seedBeforeApp:localStorage.getItem(__KEY__),clicks:[]};
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-action="build-units"]');if(!b)return;
 const f=document.querySelector('[data-bind="uqty-'+b.dataset.id+'"]');const row={trusted:e.isTrusted,id:b.dataset.id,mode:b.dataset.mode,input:f.value,validity:{valid:f.validity.valid,rangeUnderflow:f.validity.rangeUnderflow,stepMismatch:f.validity.stepMismatch},beforeRaw:localStorage.getItem(__KEY__),clock:Date.now()};window.__unitWitness.clicks.push(row);
 },true);
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-action="build-units"]');if(!b)return;const row=window.__unitWitness.clicks.at(-1);row.afterRaw=localStorage.getItem(__KEY__);row.afterClock=Date.now();row.bubbleTrusted=e.isTrusted;},false);'''.replace('\\n','\n').replace('__KEY__',json.dumps(KEY))
 playwright_manager=sync_playwright();pw=playwright_manager.start()
 browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
 report['environment']['playwrightBrowserVersion']=browser.version;report['environment']['nodeVersion']=subprocess.check_output(['node','--version'],text=True).strip();flush()
 for label,value in [('default-one',None),('empty',''),('zero','0'),('negative-one','-1'),('fraction-one-point-five','1.5')]:
  row={'case':label,'requestedInput':value,'completed':False};report['cases'].append(row);flush()
  entries=[{'name':KEY,'value':initial_raw},{'name':'infinity.ui.tab','value':'overview'}]
  context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce',storage_state={'cookies':[],'origins':[{'origin':ORIGIN,'localStorage':entries}]})
  observed=context.storage_state();write(label+'-storage-seed-readback.json',observed)
  check(label+': anonymous context exact initial origin and raw bytes',observed['cookies']==[] and len(observed['origins'])==1 and observed['origins'][0]['origin']==ORIGIN and {x['name']:x['value'] for x in observed['origins'][0]['localStorage']}=={x['name']:x['value'] for x in entries})
  context.add_init_script(CLOCK.replace('__EPOCH__',str(initial['savedAt']))+OBSERVER)
  page=context.new_page();page.set_default_timeout(8000);page.set_default_navigation_timeout(15000)
  page.on('pageerror',lambda error:report['errors'].append(str(error)))
  responses=[];executed=[];cdp=context.new_cdp_session(page)
  page.on('response',lambda r:responses.append(r) if r.request.resource_type in ('script','stylesheet') else None)
  cdp.send('Network.enable');cdp.send('Network.setCacheDisabled',{'cacheDisabled':True});cdp.on('Debugger.scriptParsed',lambda e:executed.append(e) if e.get('url','').startswith(ORIGIN) else None);cdp.send('Debugger.enable')
  response=page.goto(url,wait_until='networkidle');advance(page)
  boot=snapshot(page,label+'-boot');check(label+': pre-app native storage seed exactly retained',boot['witness']['seedBeforeApp']==initial_raw)
  release_response=page.request.get(url+'release.json');release_http={'url':release_response.url,'status':release_response.status,'sha256':digest(release_response.body())};write(label+'-http-release.json',release_http)
  check(label+': actual HTTP200 release bytes pin old241a',release_http['status']==200 and release_http['url']==url+'release.json' and release_http['sha256']==RELEASE_SHA)
  if label=='default-one':
   full_http=[]
   for name,expected_hash in release['files'].items():
    fetched=page.request.get(url+name);item={'resource':name,'url':fetched.url,'status':fetched.status,'sha256':digest(fetched.body()),'expected':expected_hash};full_http.append(item);write('complete-62-http-resources.json',full_http)
    check('complete HTTP resource body matches old release: '+name,item['status']==200 and item['url']==url+name and item['sha256']==expected_hash,item)

  check(label+': native storage/file/confirm/timer implementations retained',page.evaluate('window.__npcNative'))
  http_rows=[];v8_rows=[];bodies={}
  for r in responses:
   name=r.url.removeprefix(url);body=r.body();bodies[r.url]=body
   item={'url':r.url,'status':r.status,'kind':r.request.resource_type,'sha256':digest(body),'expected':release['files'].get(name),'bytes':len(body)};http_rows.append(item);write(label+'-http-assets.json',http_rows)
   check(label+': actual HTTP JS/CSS full bytes and status bind exact release',r.status==200 and r.url==r.request.url and item['sha256']==item['expected'],item)
  for e in executed:
   src=cdp.send('Debugger.getScriptSource',{'scriptId':e['scriptId']})['scriptSource'];name=e['url'].removeprefix(url)
   item={'url':e['url'],'scriptId':e['scriptId'],'executedSourceSha256':digest(src.encode()),'httpSha256':digest(bodies[e['url']]),'releaseSha256':release['files'].get(name)};v8_rows.append(item);write(label+'-v8-source.json',v8_rows)
   check(label+': actual V8 full source equals HTTP bytes and pinned release',item['executedSourceSha256']==item['httpSha256']==item['releaseSha256'],item)
  check(label+': real JS and CSS plus V8 observed',bool(v8_rows) and {'script','stylesheet'}<=set(x['kind'] for x in http_rows))
  doc={'url':response.url,'status':response.status,'sha256':digest(response.body()),'expected':release['files']['index.html']};write(label+'-http-document.json',doc);check(label+': original HTTP200 document exact',doc['status']==200 and doc['url']==url and doc['sha256']==doc['expected'])
  cdp.send('Debugger.disable')
  before=manual_save(page,label+'-before-manual-save')
  check(label+': actual saved initial game exactly equals natural handoff with no exclusions',before['state']==initial['state'],write(label+'-baseline-comparison.json',{'actual':before,'expected':initial,'differences':diff(initial,before)}))
  tab(page,'shipyard',label+'-shipyard-tab')
  field=page.locator('[data-bind="uqty-small_cargo"]');button=page.locator('[data-bind="ubuild-small_cargo"]')
  if value is not None:
   count=page.evaluate('window.__npcEdits.length');field.fill(value);field.press('Tab');advance(page)
   edits=page.evaluate('(n)=>window.__npcEdits.slice(n)',count);write(label+'-native-edits.json',edits)
   check(label+': native fill retains exact requested string and trusted input',field.input_value()==value and any(e['trusted'] and e['type']=='input' for e in edits),edits)
  dom=field.evaluate('(e)=>({value:e.value,min:e.min,step:e.step,required:e.required,validity:{valid:e.validity.valid,rangeUnderflow:e.validity.rangeUnderflow,stepMismatch:e.validity.stepMismatch},buttonDisabled:document.querySelector("[data-bind=ubuild-small_cargo]").disabled,card:document.querySelector("[data-bind=ucard-small_cargo]").outerHTML})')
  write(label+'-input-before.json',dom);check(label+': actual build control remains enabled',not dom['buttonDisabled'],dom)
  button.scroll_into_view_if_needed();page.screenshot(path=str(OUT/(label+'-before.png')),caret='initial')
  before_click=snapshot(page,label+'-immediate-before-click');check(label+': typing did not mutate saved world',json.loads(before_click['raw'])['state']==before['state'])
  click(page,'[data-bind="ubuild-small_cargo"]',label+'-build')
  after_click=snapshot(page,label+'-immediate-after-click');after=json.loads(after_click['raw']);write(label+'-after-save-envelope.json',after)
  page.screenshot(path=str(OUT/(label+'-after.png')),caret='initial')
  expected=copy.deepcopy(before['state']);p=next(p for p in expected['planets'] if p['id']=='homeworld')
  for resource,cost in [('metal',2000),('crystal',2000)]:p['resources'][resource]=str(Decimal(p['resources'][resource])-cost)
  job={'jobId':expected['orders']['nextJobId'],'taskId':None,'unit':'small_cargo','count':1,'orderedCount':1,'paidPerUnit':{'metal':'2000','crystal':'2000','deuterium':'0'},'progress':0,'source':'manual'}
  p['shipyardQueue'].append(job);expected['orders']['nextJobId']+=1;expected['stats']['manualActions']+=1
  changes=diff(before['state'],after['state']);write(label+'-whole-world-diff.json',changes);write(label+'-whole-world-expected.json',expected)
  row.update({'beforeWallet':h['resources'],'afterWallet':next(p for p in after['state']['planets'] if p['id']=='homeworld')['resources'],'job':job,'inputDom':dom,'wholeWorldDifferences':changes,'trustedClickWitness':after_click['witness']['clicks'],'beforeGameTime':before['state']['totalTime'],'afterGameTime':after['state']['totalTime'],'elapsedGameTime':str(Decimal(after['state']['totalTime'])-Decimal(before['state']['totalTime'])),'beforeSavedAt':before['savedAt'],'afterSavedAt':after['savedAt']});flush()
  check(label+': complete actual saved game equals independent one-unit transaction and nothing else',after['state']==expected,write(label+'-whole-world-comparison.json',{'actual':after['state'],'expected':expected,'differences':diff(expected,after['state'])}))
  check(label+': no elapsed clock or production explains deductions',after['state']['totalTime']==before['state']['totalTime'] and after['savedAt']==before['savedAt']==initial['savedAt'] and after['lastTickAt']==before['lastTickAt']==initial['lastTickAt'])
  witnesses=after_click['witness']['clicks'];check(label+': single actual trusted build sees exact input and synchronous payment',len(witnesses)==1 and witnesses[0]['trusted'] and witnesses[0]['bubbleTrusted'] and witnesses[0]['input']==('1' if value is None else value) and json.loads(witnesses[0]['beforeRaw'])['state']==before['state'] and json.loads(witnesses[0]['afterRaw'])['state']==expected)
  saved_again=manual_save(page,label+'-after-manual-save');check(label+': real manual save retains entire charged world and stable job ID',saved_again['state']==expected)
  row['completed']=True;row['outcome']='normal default one' if value is None else 'native invalid input silently paid for one unit';flush()
  context.close();context=None;page=None
 check('all five independent native cases completed',len(report['cases'])==5 and all(x['completed'] for x in report['cases']))
 check('zero application errors',not report['errors'],report['errors'])
 report['completed']=True;report['bugConfirmed']=True;report['result']='PROOF PASS: old production silent one-unit purchase bug confirmed; this is not a product safety gate';flush()
except BaseException as error:
 report['failure']={'error':repr(error),'traceback':traceback.format_exc()};flush()
 if page:
  try:snapshot(page,'failure-live-observation')
  except BaseException as e:report['failure']['captureError']=repr(e)
  try:
   page.screenshot(path=str(OUT/'failure-live.png'),caret='initial',timeout=5000)
  except BaseException as e:report['failure']['screenshotError']=repr(e)
  flush()
 print(traceback.format_exc(),flush=True)
finally:
 signal.alarm(0)
 if context:
  try:context.close()
  except BaseException:pass
 if browser:
  try:browser.close()
  except BaseException:pass
 if server:
  try:server.shutdown();server.server_close()
  except BaseException as e:report.setdefault('cleanupErrors',[]).append({'service':repr(e)})
 if pw:
  try:pw.stop()
  except BaseException as e:report.setdefault('cleanupErrors',[]).append({'playwright':repr(e)})
 report['cleanup']='owned context/browser/service cleanup and final Playwright stop attempted after live failure capture';flush()
 print(json.dumps({'completed':report['completed'],'bugConfirmed':report['bugConfirmed'],'cases':len(report['cases']),'passed':sum(x['passed'] for x in report['checks']),'failed':sum(not x['passed'] for x in report['checks']),'out':str(OUT),'failure':report.get('failure')},ensure_ascii=False),flush=True)
 raise SystemExit(0 if report['completed'] and report['bugConfirmed'] else 1)
