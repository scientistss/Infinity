"""Actual production UI acceptance. Default: HTTP + native storage + real clock.
--inline is clearly reported as memory-storage / controlled-clock auxiliary coverage.
"""
import argparse, json, time, re, mimetypes, shutil
from pathlib import Path
from urllib.parse import unquote,urlparse
from playwright.sync_api import sync_playwright,expect
ap=argparse.ArgumentParser();ap.add_argument('--url',default='http://127.0.0.1:4173/Infinity/');ap.add_argument('--fixtures',default='deep-fixtures');ap.add_argument('--output',default='deep-evidence');ap.add_argument('--inline',action='store_true');a=ap.parse_args()
out=Path(a.output);out.mkdir(parents=True,exist_ok=True);dist=Path('dist').resolve();key='infinity.original-p4.save.v1'
checks=[];errors=[];failures=[];complete=False
def check(n,c):
 checks.append({'name':n,'passed':bool(c)})
 if not c:raise AssertionError(n)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 def boot(name):
  data=json.loads((Path(a.fixtures)/(name+'.json')).read_text());data['savedAt']=data['lastTickAt']=int(time.time()*1000)
  c=b.new_context(viewport={'width':1440,'height':1050},device_scale_factor=1);page=c.new_page();page.set_default_timeout(8000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:failures.append(r.url))
  seed={key:json.dumps(data,ensure_ascii=False),'infinity.save.v1':'RETAIN ORIGINAL LIVE SAVE','infinity.ui.tab':'facilities'}
  if a.inline:
   def serve(route):
    f=(dist/unquote(urlparse(route.request.url).path).removeprefix('/Infinity/')).resolve()
    if f.is_relative_to(dist) and f.is_file():route.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    else:route.abort()
   page.route('**/*',serve)
   html=(dist/'index.html').read_text();html=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',html);html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',html)
   html=html.replace('<head>','<head><base href="http://deep.test/Infinity/"><style>'+next((dist/'assets').glob('*.css')).read_text()+'</style>');page.set_content(html)
   code="""(()=>{const data=new Map(Object.entries(SEED));Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});let frames=[],time=1000;const origin=Date.now();Date.now=()=>origin+time-1000;Object.defineProperty(performance,'now',{value:()=>time});window.requestAnimationFrame=cb=>(frames.push(cb),frames.length);window.cancelAnimationFrame=()=>{};window.__advance=ms=>{time+=ms;const fs=frames;frames=[];fs.forEach(f=>f(time));};})();""".replace('SEED',json.dumps(seed,ensure_ascii=False))
   page.add_script_tag(content=code);page.add_script_tag(content=next((dist/'assets').glob('*.js')).read_text(),type='module')
  else:
   c.add_init_script("if(!sessionStorage.getItem('deep-seed')){for(const[k,v]of Object.entries(SEED)){let value=v;if(k==='infinity.original-p4.save.v1'){const f=JSON.parse(v);f.savedAt=f.lastTickAt=Date.now();value=JSON.stringify(f);}localStorage.setItem(k,value);}sessionStorage.setItem('deep-seed','1');}".replace('SEED',json.dumps(seed,ensure_ascii=False)))
   r=page.goto(a.url,wait_until='networkidle',timeout=30000);check(name+': HTTP 200',r.status==200)
  page.locator('[data-bind="amount-metal"]').wait_for();dismiss_offline(page);return c,page
 def advance(page,seconds=.12):
  if a.inline:page.evaluate('(n)=>window.__advance(n)',seconds*1000)
  else:page.wait_for_timeout(seconds*1000)
  dismiss=page.locator('[data-action="dismiss-offline"]')
  if dismiss.count() and dismiss.is_visible():dismiss.click()
 def dismiss_offline(page):
  modal=page.locator('[data-bind="offline-modal"]')
  if modal.is_visible():
   page.locator('[data-action="dismiss-offline"]').click();expect(modal).to_be_hidden()
 def tab(page,t):dismiss_offline(page);page.locator('[data-tab="'+t+'"]').click();advance(page);expect(page.locator('[data-tab-panel="'+t+'"]').first).to_be_visible()
 def read(page):return json.loads(page.evaluate('(k)=>localStorage.getItem(k)',key))
 def save(page):tab(page,'save');page.locator('[data-action="save"]').click();return read(page)
 def snap(page,name):
  page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
  page.evaluate("window.scrollTo(0,0)")
  page.screenshot(path=str(out/name),full_page=True)
 def visible(page,selector):page.locator(selector).scroll_into_view_if_needed()
 try:
  c,page=boot('pirate');check('original UI retained',page.locator('.command-ui').count()==0)
  check('visible version is current and offline heading is preserved',page.locator('.brand .kicker').text_content().endswith('v'+json.loads(Path('package.json').read_text())['version']) and page.locator('[data-bind="offline-modal"] .kicker').text_content()=='Welcome back')
  tab(page,'galaxy');check('16th-position charging button',page.locator('[data-mission="charge"]').count()==1)
  page.locator('[data-mission="charge"]').click();advance(page)
  page.locator('[data-ship="small_cargo"]').fill('5');page.locator('[data-ship="light_fighter"]').fill('30');page.locator('[data-ship="cruiser"]').fill('8');advance(page)
  expect(page.locator('#space-send')).to_be_enabled();check('correct charge target',page.locator('#flight-position').input_value()=='16')
  check('three hold options',page.locator('#charge-slots option').count()==3)
  page.locator('#charge-slots').select_option('3');advance(page);check('3 segments shown in quote','3分' in page.locator('#space-quote').inner_text() or '180' in page.locator('#space-quote').inner_text())
  page.locator('#charge-slots').select_option('1');advance(page);check('preflight risk is honest','海盗与异星仍可造成战损' in page.locator('#charge-risk-preview').inner_text());check('preflight free cargo displayed','余舱' in page.locator('#charge-capacity-preview').inner_text());snap(page,'charge-compose.png')
  page.locator('#space-send').click();advance(page);dispatched=read(page);f=dispatched['state']['fleets'][0];check('charge persisted before travel',f['mission']=='charge' and f['charge']['phase']=='outbound')
  snap(page,'charge-outbound.png');advance(page,f['duration']+.2);s=save(page)
  check('arrived and holding',s['state']['fleets'][0]['charge']['phase']=='holding');check('no premature roll',s['state']['deepSpace']['completed']==0)
  tab(page,'fleet');visible(page,'#space-fleets');check('actual fleet content displayed','大型运输舰' in page.locator('#space-fleets').inner_text() or '小型运输舰' in page.locator('#space-fleets').inner_text());snap(page,'charge-holding.png');advance(page,61)
  s=save(page);check('charge completed once',s['state']['deepSpace']['completed']==1);r=s['state']['deepSpace']['reports'][0]
  check('pirate is actual battle',r['symbol']=='pirate' and r['battle'] is not None);check('six-round limit',0<len(r['battle']['rounds'])<=6);check('real wreckage generated',len(s['state']['deepSpace']['debris'])>0)
  if s['state']['fleets']:advance(page,s['state']['fleets'][0]['remaining']+.2)
  s=save(page);check('survivors returned',not s['state']['fleets']);check('return reported',s['state']['deepSpace']['reports'][0]['returned'] or s['state']['deepSpace']['reports'][0]['destroyed'])
  tab(page,'deep');page.locator('#deep-reports summary').first.click();visible(page,'#deep-reports');snap(page,'pirate-battle.png')
  page.locator('[data-deep="summon"]').click();advance(page);expect(page.locator('#deep-offer option')).to_have_count(1);check('merchant opened',page.locator('#deep-offer').input_value().startswith('merchant-'))
  page.locator('#deep-amount').fill('1000');advance(page);expect(page.locator('#deep-trade')).to_be_enabled();before=read(page);page.locator('#deep-trade').click();advance(page);after=read(page)
  check('merchant quota consumed',float(after['state']['deepSpace']['offers'][0]['remainingMe'])<float(before['state']['deepSpace']['offers'][0]['remainingMe']))
  visible(page,'#deep-offers');snap(page,'merchant-trade.png')
  page.locator('#deep-debris [data-mission="recycle"]').first.click();advance(page)
  for field in page.locator('[data-ship]').all():field.fill('0')
  page.locator('[data-ship="recycler"]').fill('20');advance(page);expect(page.locator('#space-send')).to_be_enabled();page.locator('#space-send').click();advance(page);s=read(page);rf=s['state']['fleets'][0]
  check('recycle actually dispatched',rf['mission']=='recycle');advance(page,rf['duration']+.2);s=save(page);rf=s['state']['fleets'][0];check('debris loaded on returning fleet',float(rf['cargo']['metal'])+float(rf['cargo']['crystal'])>0)
  tab(page,'fleet');visible(page,'#space-fleets');snap(page,'salvage-return.png');advance(page,rf['remaining']+.2);s=save(page);check('salvage returned',not s['state']['fleets'])
  tab(page,'arcade');page.locator('[data-bind="arcade-skip"]').check();before=save(page);tab(page,'arcade');page.locator('[data-action="arcade-all"]').click();advance(page);after=save(page)
  check('receipt consumed once',len(after['state']['arcade']['runs'])<len(before['state']['arcade']['runs']));check('no repeated charge event on replay',after['state']['deepSpace']['completed']==1);check('no new DM from replay',after['state']['darkMatter']==before['state']['darkMatter']);check('no new ships from replay',after['state']['planets'][0]['units']==before['state']['planets'][0]['units'])
  tab(page,'arcade');snap(page,'ring-charge-replay.png')
  for width in [390,768,1440]:
   page.set_viewport_size({'width':width,'height':1000})
   for t in ['facilities','galaxy','fleet','deep','arcade','save']:
    tab(page,t);check(str(width)+'px '+t+' no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   if width==390:tab(page,'deep');snap(page,'deep-mobile.png')
  save(page);check('old live save retained',page.evaluate("localStorage.getItem('infinity.save.v1')")=='RETAIN ORIGINAL LIVE SAVE')
  page.locator('[data-deep="export-legacy"]').click();check('can export old bytes',page.locator('[data-bind="transfer"]').input_value()=='RETAIN ORIGINAL LIVE SAVE')
  if not a.inline:
   before=read(page);page.reload(wait_until='networkidle');after=save(page);check('native refresh retains deep reports',after['state']['deepSpace']['reports']==before['state']['deepSpace']['reports']);check('native refresh retains ships',after['state']['planets'][0]['units']==before['state']['planets'][0]['units'])
  tab(page,'deep');page.locator('[data-deep="charge"]').click();advance(page);check('deep shortcut directly opens correct fleet target',page.locator('#space-fleet').is_visible() and page.locator('#flight-position').input_value()=='16');c.close()
  for mode,symbol in [('alien','alien'),('merchant','merchant'),('blackhole-protected','turbulence'),('blackhole-risk','blackhole')]:
   c,page=boot(mode);advance(page,2);s=save(page);r=s['state']['deepSpace']['reports'][0];check(mode+' actual result',r['symbol']==symbol)
   if mode=='blackhole-protected':check('blackhole changed to turbulence',bool(r['protection']) and not r['destroyed'])
   if mode=='blackhole-risk':check('unprotected blackhole is real total loss',r['destroyed'] and not s['state']['fleets'])
   if mode=='merchant':
    if s['state']['fleets']:advance(page,s['state']['fleets'][0]['remaining']+.3)
    s=save(page);check('encounter merchant activates on return',s['state']['deepSpace']['offers'][0]['startsAt']>=0)
   tab(page,'deep');page.locator('#deep-reports summary').first.click();visible(page,'#deep-reports');snap(page,mode+'.png');check(mode+' old save retained',page.evaluate("localStorage.getItem('infinity.save.v1')")=='RETAIN ORIGINAL LIVE SAVE');c.close()
  check('no JS exceptions',not errors);check('no failed requests',not failures);complete=True
 finally:
  if not complete:
   try:page.screenshot(path=str(out/'failure.png'),full_page=True)
   except Exception:pass
  report={'completed':complete,'mode':'inline DOM / memory Storage / controlled clock' if a.inline else 'HTTP / native localStorage / real-time','url':a.url,'passed':sum(x['passed'] for x in checks),'checks':checks,'errors':errors,'failedRequests':failures,'fixture':'Prepared one-homeworld fixtures. Main pirate run dispatched via UI and held for 60 game seconds. Other scenarios are real rule-engine snapshots one second before hold completion; not normal new games.'}
  (out/'deep-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));b.close()
