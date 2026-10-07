"""Production UI smoke: real HTTP by default; --inline explicitly uses a controlled DOM fallback."""
import argparse,json,re,mimetypes,shutil,time
from pathlib import Path
from urllib.parse import urlparse,unquote
from playwright.sync_api import sync_playwright,expect
ap=argparse.ArgumentParser();ap.add_argument('--url',default='http://127.0.0.1:4173/Infinity/');ap.add_argument('--fixture',default='space-review-save.json');ap.add_argument('--output',default='space-evidence');ap.add_argument('--inline',action='store_true');a=ap.parse_args()
root=Path.cwd();dist=root/'dist';out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
fixture=json.loads(Path(a.fixture).read_text());key='infinity.original-p4.save.v1';checks=[];errors=[];failures=[];complete=False

def check(name,value):
 checks.append({'name':name,'passed':bool(value)})
 if not value:raise AssertionError(name)

with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1440,'height':1050},device_scale_factor=1)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:failures.append(r.url))
 fixture['savedAt']=fixture['lastTickAt']=int(time.time()*1000)
 seed={key:json.dumps(fixture,ensure_ascii=False),'infinity.save.v1':'PRESERVE LIVE SAVE','infinity.ui.tab':'facilities'}
 def load(data):
  if a.inline:
   def serve(route):
    name=unquote(urlparse(route.request.url).path).removeprefix('/Infinity/');f=(dist/name).resolve()
    if f.is_relative_to(dist.resolve()) and f.is_file():route.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    else:route.abort()
   page.route('**/*',serve)
   html=(dist/'index.html').read_text();html=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',html);html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',html)
   html=html.replace('<head>','<head><base href="http://space.test/Infinity/"><style>'+next((dist/'assets').glob('*.css')).read_text()+'</style>')
   page.set_content(html)
   script='''(()=>{const data=new Map(Object.entries(SEED));Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});let frames=[],time=1000;const origin=Date.now();Date.now=()=>origin+time-1000;Object.defineProperty(performance,'now',{value:()=>time});window.requestAnimationFrame=cb=>(frames.push(cb),frames.length);window.cancelAnimationFrame=()=>{};window.__advance=ms=>{time+=ms;const fs=frames;frames=[];fs.forEach(f=>f(time));};})();'''.replace('SEED',json.dumps(data,ensure_ascii=False))
   page.add_script_tag(content=script);page.add_script_tag(content=next((dist/'assets').glob('*.js')).read_text(),type='module')
  else:
   context.add_init_script('''if(!sessionStorage.getItem('spaceSeeded')){for(const [k,v]of Object.entries(SEED))localStorage.setItem(k,v);sessionStorage.setItem('spaceSeeded','yes');}'''.replace('SEED',json.dumps(data,ensure_ascii=False)))
   response=page.goto(a.url,wait_until='networkidle');check('HTTP response',response.status==200)
  page.locator('[data-bind="amount-metal"]').wait_for()
 def advance(seconds=.1):
  if a.inline:page.evaluate('(ms)=>window.__advance(ms)',seconds*1000)
  else:page.wait_for_timeout(seconds*1000)
 def tab(name):page.locator(f'[data-tab="{name}"]').click();advance();expect(page.locator(f'[data-tab-panel="{name}"]')).to_be_visible()
 def snap(name):
  page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
  page.screenshot(path=str(out/name),full_page=True)
 def read():return json.loads(page.evaluate('(k)=>localStorage.getItem(k)',key))
 try:
  load(seed);check('prepared fixture contains only one homeworld',len(fixture['state']['planets'])==1);check('no command UI redesign',page.locator('.command-ui').count()==0)
  snap('original-facilities.png');tab('galaxy');check('16 target positions',page.locator('#space-worlds tr').count()==16);check('deep-space locked honestly','充能待开放' in page.locator('#space-worlds tr').last.inner_text());snap('galaxy-desktop.png')
  page.locator('#browse-system').fill('1');page.locator('[data-space="prev"]').click();advance();check('system wrap backward',page.locator('#browse-system').input_value()=='100');page.locator('[data-space="next"]').click();advance();check('system wrap forward',page.locator('#browse-system').input_value()=='1');page.locator('[data-space="home"]').click();advance()
  page.locator('[data-space="route"][data-mission="colonize"]').first.click();advance();expect(page.locator('#space-fleet')).to_be_visible()
  page.locator('[data-ship="colony_ship"]').fill('1');page.locator('[data-ship="small_cargo"]').fill('2');page.locator('#cargo-metal').fill('-1');advance();check('invalid cargo blocks dispatch',page.locator('#space-send').is_disabled())
  page.locator('#cargo-metal').fill('1000');page.locator('#cargo-crystal').fill('500');page.locator('#cargo-deuterium').fill('200');advance();expect(page.locator('#space-send')).to_be_enabled();snap('fleet-compose.png')
  page.locator('#cargo-metal').focus();advance(.3);check('input stable across render',page.locator('#cargo-metal').input_value()=='1000' and page.evaluate("document.activeElement.id")=='cargo-metal')
  page.locator('#space-send').click();advance();issued=read();check('fleet persisted after dispatch',len(issued['state']['fleets'])==1);check('colony is not injected at departure',len(issued['state']['planets'])==1);check('ship cost paid',issued['state']['planets'][0]['units']['colony_ship']==2);snap('fleet-outbound.png')
  duration=issued['state']['fleets'][0]['duration'];advance(duration+.1)
  expect(page.locator('#planet-select option')).to_have_count(2);check('real flight created second world',page.locator('#planet-select option').count()==2)
  advance(duration+.1);tab('save');page.locator('[data-action="save"]').click();settled=read();check('return completed exactly once',len(settled['state']['fleets'])==0);check('escorts returned',settled['state']['planets'][0]['units']['small_cargo']==20);check('one colony ship consumed',settled['state']['planets'][0]['units']['colony_ship']==2)
  new_id=settled['state']['planets'][1]['id'];page.locator('#planet-select').select_option(new_id);advance();tab('facilities');check('new colony starts without free buildings','等级 0' in page.locator('[data-bind="bld-metal_mine"]').inner_text());snap('new-colony-desktop.png')
  tab('messages');check('colony and return messages exist','已建立' in page.locator('#space-messages').inner_text() and '已返航' in page.locator('#space-messages').inner_text());snap('messages-desktop.png')
  page.locator('#planet-select').select_option('homeworld');advance();tab('galaxy');page.locator('[data-space="route"][data-mission="transport"]').first.click();advance();page.locator('#flight-mission').select_option('transport');page.locator('[data-ship="colony_ship"]').fill('0');advance();expect(page.locator('#space-send')).to_be_enabled();page.locator('#space-send').click();advance();dispatched=read();check('transport is an actual persisted mission',dispatched['state']['fleets'][0]['mission']=='transport')
  page.locator('[data-space="recall"]').first.click();advance(.4);check('recall produces message','召回' in page.locator('#space-messages').inner_text())
  tab('arcade');check('existing 24-cell ring board preserved',page.locator('[data-tile]').count()==24);snap('ring-unchanged.png')
  for width in [390,768,1440]:
   page.set_viewport_size({'width':width,'height':1000})
   for t in ['facilities','research','shipyard','arcade','galaxy','fleet','messages']:
    tab(t);check(f'{width}px {t} layout',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   tab('fleet')
   if width==390:snap('fleet-mobile.png')
  tab('save');page.locator('[data-action="save"]').click();before=read()
  check('live-site save untouched',page.evaluate("localStorage.getItem('infinity.save.v1')")=='PRESERVE LIVE SAVE')
  if not a.inline:
   page.reload(wait_until='networkidle');tab('save');page.locator('[data-action="save"]').click();after=read();check('native reload retains planets',len(after['state']['planets'])==len(before['state']['planets']));check('native reload does not duplicate ships',after['state']['planets'][0]['units']['colony_ship']==before['state']['planets'][0]['units']['colony_ship'])
  check('no JavaScript exceptions',not errors);check('no failed resource requests',not failures);complete=True
 finally:
  report={'completed':complete,'mode':'isolated DOM; inline assets; memory Storage; controlled clock' if a.inline else 'real HTTP; native localStorage; real-time simulation','source':a.url if not a.inline else 'local dist','passed':sum(c['passed'] for c in checks),'checks':checks,'errors':errors,'failedRequests':failures,'fixture':'single prepared homeworld; colonies created through UI fleet dispatch'}
  (out/'space-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));browser.close()
