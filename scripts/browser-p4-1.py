"""Production-browser acceptance. --inline is explicitly an isolated DOM fallback, not HTTP/storage acceptance."""
import argparse, json, mimetypes, re, shutil, time
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright

ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
ap.add_argument('--fixture',default='p4-1-review-save.json')
ap.add_argument('--output',default='browser-evidence')
ap.add_argument('--inline',action='store_true')
ap.add_argument('--chromium',default=None)
a=ap.parse_args()
root=Path.cwd();dist=root/'dist';out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
fixture=json.loads(Path(a.fixture).read_text());key='infinity.original-p4.save.v1'
checks=[];errors=[];network=[];completed=False
def check(name,condition):
 checks.append({'name':name,'passed':bool(condition)})
 if not condition: raise AssertionError(name)
def snapshot(page,name):
 page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
 page.screenshot(path=str(out/name),full_page=False)

def init_code(value):
 seed={key:json.dumps(value,ensure_ascii=False),'infinity.save.v1':'DO NOT OVERWRITE EXISTING LIVE SAVE','infinity.ui.tab':'facilities'} if value is not None else {'infinity.save.v1':'DO NOT OVERWRITE EXISTING LIVE SAVE','infinity.ui.tab':'facilities'}
 if isinstance(value,str):seed[key]=value
 if a.inline:
  return '''(() => { const data = new Map(Object.entries(SEED));
 Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.has(String(k))?data.get(String(k)):null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear()}});
 let time=1000, frames=[]; const origin=NOW; Date.now=()=>origin+time-1000;
 Object.defineProperty(performance,'now',{value:()=>time});
 window.requestAnimationFrame=cb=>(frames.push(cb),frames.length);window.cancelAnimationFrame=()=>{};
 window.__advance=ms=>{time+=ms;const jobs=frames;frames=[];jobs.forEach(f=>f(time));};
 })();'''.replace('SEED',json.dumps(seed,ensure_ascii=False)).replace('NOW',str(int(time.time()*1000)))
 return '( () => { const s = '+json.dumps(seed,ensure_ascii=False)+'; for(const [k,v] of Object.entries(s))localStorage.setItem(k,v); })();'

with sync_playwright() as p:
 executable=a.chromium or shutil.which('google-chrome') or shutil.which('chromium')
 if not executable:raise RuntimeError('Chrome/Chromium is required')
 browser=p.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox'])
 def boot(value,width=1440):
  if isinstance(value,dict):value={**value,'savedAt':int(time.time()*1000),'lastTickAt':int(time.time()*1000)}
  context=browser.new_context(viewport={'width':width,'height':1000},device_scale_factor=1,accept_downloads=True)
  page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:network.append(r.url))
  if a.inline:
   def serve(route):
    path=unquote(urlparse(route.request.url).path)
    local=(dist/path.removeprefix('/Infinity/')).resolve()
    if local.is_relative_to(dist.resolve()) and local.is_file():route.fulfill(body=local.read_bytes(),content_type=mimetypes.guess_type(str(local))[0] or 'application/octet-stream')
    else:route.abort()
   page.route('**/*',serve)
   html=(dist/'index.html').read_text()
   html=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',html)
   html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',html)
   html=html.replace('<head>','<head><base href="http://p4-preview.test/Infinity/"><style>'+next((dist/'assets').glob('*.css')).read_text()+'</style>')
   page.set_content(html)
   page.add_script_tag(content=init_code(value))
   page.add_script_tag(content=next((dist/'assets').glob('*.js')).read_text(),type='module')
  else:
   context.add_init_script(init_code(value))
   response=page.goto(a.url,wait_until='networkidle',timeout=30000)
   check('HTTP page served',response is not None and response.status==200)
  page.locator('[data-bind="amount-metal"]').wait_for()
  return context,page
 def click_tab(page,tab):page.locator(f'[data-tab="{tab}"]').click();page.locator(f'[data-tab-panel="{tab}"]').wait_for(state='visible')
 def saved(page):
  click_tab(page,'save');page.locator('[data-action="save"]').click()
  return json.loads(page.evaluate('(key)=>localStorage.getItem(key)',key))
 try:
  c,page=boot(None)
  check('new game: original card layout',page.locator('.bld-grid').count()>0 and page.locator('.command-ui').count()==0)
  check('new game: no planet picker',page.locator('[data-bind="planet-selector"]').is_hidden())
  check('new game: no injected colonies',len(saved(page)['state']['planets'])==1)
  check('new game: deployed key untouched',page.evaluate("localStorage.getItem('infinity.save.v1')")=='DO NOT OVERWRITE EXISTING LIVE SAVE')
  click_tab(page,'facilities');snapshot(page,'new-game-desktop.png');c.close()

  c,page=boot(fixture)
  check('two-world fixture: picker visible',page.locator('#planet-select').is_visible())
  check('two-world fixture: exactly two options',page.locator('#planet-select option').count()==2)
  home=page.locator('[data-bind="amount-metal"]').inner_text()
  check('home has two construction orders',page.locator('[data-bind="queue-list"] .queue-item').count()==2)
  snapshot(page,'homeworld-desktop.png')
  page.locator('#planet-select').select_option('colony-review')
  check('switch changes current inventory',page.locator('[data-bind="amount-metal"]').inner_text()!=home)
  check('colony has its own construction queue',page.locator('[data-bind="queue-list"] .queue-item').count()==1)
  snapshot(page,'colony-desktop.png')
  click_tab(page,'overview');check('overview names the selected planet','冰海试验站' in page.locator('[data-bind="ov-planet"]').inner_text())
  snapshot(page,'colony-overview-desktop.png')
  click_tab(page,'research');check('shared research identifies the paying planet','母星' in page.locator('[data-bind="rqueue-list"]').inner_text())
  snapshot(page,'shared-research-desktop.png')
  click_tab(page,'shipyard');check('colony shipyard has its own order','小型运输舰' in page.locator('[data-bind="squeue-list"]').inner_text())
  page.locator('#planet-select').select_option('homeworld')
  check('home shipyard was not replaced','大型运输舰' in page.locator('[data-bind="squeue-list"]').inner_text())
  click_tab(page,'arcade');check('ring board preserved',page.locator('[data-tile]').count()==24)
  snapshot(page,'ring-machine-desktop.png')
  before=saved(page);pending=before['state']['arcade']['runs'];check('fixture has pending pre-rolled result',len(pending)>0)
  click_tab(page,'arcade');page.locator('[data-action="arcade-run"]').click()
  after=saved(page);check('ring reveal consumes one pending result',len(after['state']['arcade']['runs'])==len(pending)-1)
  check('ring reveal increments its counter once',after['state']['arcade']['stats']['runs']==before['state']['arcade']['stats']['runs']+1)
  page.locator('#planet-select').select_option('colony-review');click_tab(page,'facilities');page.locator('[data-bind="queue-list"] [data-action="cancel-queue"]').first.click()
  check('cancel clears only the active build queue',page.locator('[data-bind="queue-list"] .queue-item').count()==0)
  state=saved(page)['state'];check('other planet still has two construction orders',len(state['planets'][0]['buildQueue'])==2)
  check('active planet persisted',state['activePlanetId']=='colony-review')
  check('no old top-level inventory', 'planet' not in state and 'resources' not in state)
  check('deployed save still untouched',page.evaluate("localStorage.getItem('infinity.save.v1')")=='DO NOT OVERWRITE EXISTING LIVE SAVE')
  if not a.inline:
   # A fresh context with stored bytes (not injecting while an old page can overwrite on unload).
   previous=json.loads(page.evaluate('(key)=>localStorage.getItem(key)',key));c.close();c,page=boot(previous)
   check('HTTP saved selection round trip',page.locator('#planet-select').input_value()=='colony-review')
  for width in [390,768,1440]:
   page.set_viewport_size({'width':width,'height':900})
   for tab in ['facilities','overview','research','shipyard','defense','arcade','protocol','curvature','achievements','save']:
    click_tab(page,tab)
    dims=page.evaluate('({w:innerWidth,scroll:document.documentElement.scrollWidth})')
    if dims['scroll']>dims['w']+1:
     print(page.evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getClientRects().length).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,80),w:e.getBoundingClientRect().width}))"))
     snapshot(page,f'overflow-{tab}-{width}.png')
    check(f'{width}px {tab}: no horizontal overflow',dims['scroll']<=dims['w']+1)
   click_tab(page,'facilities')
   if width==390:snapshot(page,'colony-mobile.png')
  check('visible images decode',page.evaluate('[...document.images].filter(i=>i.getClientRects().length).every(i=>i.complete && i.naturalWidth>0)'))
  c.close()
  c,page=boot('{broken-json')
  check('corrupt save notice displayed','原件已保留' in page.locator('[data-bind="notice"]').inner_text())
  click_tab(page,'save');page.locator('[data-action="save"]').click()
  check('protected save not overwritten',page.evaluate('(key)=>localStorage.getItem(key)',key)=='{broken-json')
  check('save note describes branch isolation','独立位置' in page.locator('[data-tab-panel="save"]').inner_text())
  c.close()
  check('no uncaught JS errors',not errors);check('no failed resource requests',not network)
  completed=True
 finally:
  report={'completed':completed,'mode':'isolated DOM / memory Storage / controlled clock' if a.inline else 'HTTP / native localStorage', 'source':'local production bundle' if a.inline else a.url,'fixture':'two planets pre-seeded for testing, not a new-game or colonization unlock','passed':sum(x['passed'] for x in checks),'checks':checks,'errors':errors,'failedRequests':network}
  (out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
  print(json.dumps({'mode':report['mode'],'passed':report['passed'],'total':len(checks),'errors':errors,'failedRequests':network},ensure_ascii=False))
  browser.close()
