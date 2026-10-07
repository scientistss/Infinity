"""Native HTTP/localStorage acceptance in isolated, disposable browser contexts.
Serve dist with npm run preview, then run this script. --url supports Pages.
Unlike browser-dom-smoke.py, this never replaces Storage or the game clock.
"""
from pathlib import Path
import argparse, hashlib, json, re, shutil, time, urllib.request, os
from concurrent.futures import ThreadPoolExecutor
from playwright.sync_api import sync_playwright
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
p.add_argument('--fixture',default='p4-review-save.json')
p.add_argument('--output',default='browser-evidence')
p.add_argument('--chromium',default=shutil.which('google-chrome') or shutil.which('chromium'))
p.add_argument('--verify-dist',action='store_true')
a=p.parse_args();root=Path(__file__).resolve().parents[1];out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
base=a.url.rstrip('/')+'/';version=json.loads((root/'package.json').read_text())['version']
checks=[];errors=[];failed=[]
report={'mode':'native HTTP navigation, native localStorage, isolated browser contexts','url':base,'version':version,'checks':checks,'pageErrors':errors,'failedRequests':failed}
def check(name,ok):
 checks.append({'name':name,'passed':bool(ok)})
 if not ok:raise AssertionError(name)
def read_url(path):
 with urllib.request.urlopen(base+path,timeout=30) as response:return response.read()
def ready(page):
 page.wait_for_selector('.cc-page-title')
 page.evaluate("document.querySelectorAll('img').forEach(i=>i.loading='eager')")
 page.wait_for_function("Array.from(document.images).every(i=>i.complete && i.naturalWidth>0)",timeout=20000)
def navigate(pg,tab):
 button=pg.locator('[data-tab="'+tab+'"]')
 if pg.locator('#cc-nav-toggle').is_visible() and pg.locator('#cc-nav-toggle').get_attribute('aria-expanded')!='true':
  pg.locator('#cc-nav-toggle').click()
 button.click()
 pg.wait_for_selector('[data-tab-panel="'+tab+'"]',state='visible')
def context(browser,raw=None):
 ctx=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1);pg=ctx.new_page()
 pg.on('pageerror',lambda e:errors.append(str(e)))
 pg.on('requestfailed',lambda r:failed.append({'url':r.url,'error':r.failure}))
 pg.on('dialog',lambda d:d.accept())
 if raw is not None:
  ctx.add_init_script('''(()=>{if(!sessionStorage.getItem('fixture-installed')){
   localStorage.setItem('infinity.save.v1',%s);sessionStorage.setItem('fixture-installed','1');
  }})();''' % json.dumps(raw))
 pg.goto(base,wait_until='networkidle',timeout=45000);ready(pg);return ctx,pg
def current(pg):return pg.evaluate("JSON.parse(localStorage.getItem('infinity.save.v1'))")
try:
 release=json.loads(read_url('release.json'));report['release']=release
 check('expected release version',release['version']==version)
 check('50 art assets and save v9',release['assetCount']==50 and release['saveVersion']==9)
 if os.environ.get('GITHUB_SHA'):check('served release is this source commit',release['sourceRevision']==os.environ['GITHUB_SHA'])
 if a.verify_dist:
  m=json.loads((root/'src/data/art-manifest.json').read_text())
  with ThreadPoolExecutor(max_workers=8) as pool:
   results=list(pool.map(lambda x:hashlib.sha256(read_url(x['file'])).hexdigest()==x['sha256'],m['assets'].values()))
  check('all 50 served images pass SHA-256',all(results))
  html=read_url('').decode();expected=(root/'dist/index.html').read_text()
  for name in re.findall(r'assets/[^"\s]+\.(?:js|css)',expected):check('served bundle matches '+name,name in html and read_url(name)==(root/'dist'/name).read_bytes())
 with sync_playwright() as pw:
  if not a.chromium:raise RuntimeError('Chrome/Chromium executable not found')
  browser=pw.chromium.launch(executable_path=a.chromium,headless=True,args=['--no-sandbox'])
  ctx,pg=context(browser)
  check('new game renders current release',pg.locator('.release-badge').inner_text()=='v'+version)
  check('regenerated resource images loaded',pg.locator('.res-main img[data-art]').count()==3)
  check('new game fits desktop',pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
  pg.screenshot(path=str(out/'new-game-desktop.png'),full_page=True);ctx.close()
  fixture=json.loads(Path(a.fixture).read_text());fixture['savedAt']=fixture['lastTickAt']=int(time.time()*1000)
  ctx,pg=context(browser,json.dumps(fixture))
  check('five grouped navigation sections',pg.locator('.cc-nav-group').count()==5)
  check('promotional hero removed',pg.locator('.command-hero').count()==0)
  check('prestige next to its risk explanation',pg.locator('.topbar [data-action="prestige"]').count()==0 and pg.locator('[data-tab-panel="curvature"] [data-action="prestige"]').count()==1)
  navigate(pg,'facilities');check('same-tab title correct',pg.locator('.cc-page-title').inner_text()=='行星建设')
  check('one building inspector visible',pg.locator('[data-tab-panel="facilities"] .bld:visible').count()==1)
  levels=current(pg)['state']['planets'][0]['buildings'].copy()
  pg.locator('#cc-search-facilities').fill('晶体');check('Chinese name filter',pg.locator('[data-tab-panel="facilities"] .cc-index-row:visible').count()==2)
  pg.locator('#cc-search-facilities').fill('not-a-building');check('explicit no results',pg.locator('[data-tab-panel="facilities"] .cc-no-results').is_visible())
  pg.locator('#cc-search-facilities').fill('');pg.locator('[data-inspect="metal_mine"]').click()
  check('selection does not upgrade buildings',current(pg)['state']['planets'][0]['buildings']==levels)
  pg.evaluate("""window.__button=document.querySelector('[data-bind="enqueue-metal_mine"]')""")
  pg.wait_for_timeout(300);check('ticks retain inspector control identity',pg.evaluate("""window.__button===document.querySelector('[data-bind="enqueue-metal_mine"]')"""))
  pg.locator('[data-bind="enqueue-metal_mine"]').click();check('inspector orders actual upgrade',len(current(pg)['state']['planets'][0]['buildQueue'])==1)
  check('rail shows actual queue',pg.locator('.cc-rail [data-action="cancel-queue"]').count()==1)
  pg.locator('.cc-rail [data-action="cancel-queue"]').click();check('rail cancels actual order',len(current(pg)['state']['planets'][0]['buildQueue'])==0)
  navigate(pg,'research');pg.locator('#cc-search-research').fill('计算机');check('research filter',pg.locator('[data-tab-panel="research"] .cc-index-row:visible').count()==1);pg.locator('#cc-search-research').fill('')
  navigate(pg,'galaxy');check('fifteen selectable map positions',pg.locator('.cc-world').count()==15)
  pg.locator('[data-position="9"]').click();check('map selection updates detail',pg.locator('#cc-world-coordinate').inner_text()=='[1:50:9]')
  navigate(pg,'protocol');pg.locator('[data-bind="catalog-auto_build"]').click()
  check('protocol equips in real save',current(pg)['state']['protocols']['slots'][0]['card'] is not None)
  check('three parameter stages',pg.locator('[data-slot="0"] .cc-stage-block').count()==3)
  pg.locator('[data-bind="slot-enabled-0"]').uncheck();check('disabled state explicit',pg.locator('[data-slot="0"] .cc-slot-status').inner_text()=='已停用')
  control=pg.locator('[data-slot="0"] select').first;control.focus();pg.wait_for_timeout(250)
  check('parameter focus survives ticks',control.evaluate('(e)=>document.activeElement===e'))
  pg.screenshot(path=str(out/'protocol-desktop.png'),full_page=True)

  tabs=['facilities','overview','empire','galaxy','fleet','research','shipyard','defense','darkmatter','arcade','protocol','curvature','achievements','messages','save']
  for tab in tabs:
   navigate(pg,tab);ready(pg)
   check('visible desktop panel '+tab,pg.locator('[data-tab-panel="'+tab+'"]').is_visible())
   check('desktop no overflow '+tab,pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   if tab in ['facilities','galaxy','shipyard']:pg.screenshot(path=str(out/(tab+'-desktop.png')),full_page=True)
  pg.locator('#active-planet').select_option('review-colony')
  check('planet change persists',current(pg)['state']['activePlanetId']=='review-colony')
  pg.reload(wait_until='networkidle');ready(pg)
  check('planet choice survives reload',pg.locator('#active-planet').input_value()=='review-colony')
  pg.locator('#active-planet').select_option('home');navigate(pg,'galaxy')
  pg.locator('.cc-coordinate-list').evaluate('(e)=>e.open=true');pg.locator('.galaxy-row.empty [data-mission="colonize"]').first.click()
  pg.locator('#flight-ship-colony_ship').fill('1');pg.locator('#flight-ship-small_cargo').fill('1')
  pg.locator('#flight-metal').fill('2000');pg.locator('#flight-crystal').fill('1200');pg.locator('#flight-deuterium').fill('800')
  pg.wait_for_timeout(300);check('live ticks preserve typed cargo',pg.locator('#flight-metal').input_value()=='2000')
  pg.locator('[data-action="preview-flight"]').click();check('quote shows fuel','往返燃料' in pg.locator('#flight-feedback').inner_text())
  pg.locator('[data-action="send-fleet"]').click();check('mission dispatch persists',len(current(pg)['state']['fleets'])==1)
  pg.wait_for_function("document.querySelectorAll('#active-planet option').length===3",timeout=30000)
  check('real-time arrival establishes colony',pg.locator('#active-planet option').count()==3)
  pg.set_viewport_size({'width':390,'height':844})
  pg.wait_for_function("document.querySelector('#cc-sidebar').inert")
  check('mobile drawer initially closed',pg.locator('#cc-nav-toggle').get_attribute('aria-expanded')=='false')
  pg.locator('#cc-nav-toggle').click();check('mobile drawer opens',pg.locator('#cc-nav-toggle').get_attribute('aria-expanded')=='true')
  pg.keyboard.press('Escape');check('Escape closes drawer and returns focus',pg.locator('#cc-nav-toggle').get_attribute('aria-expanded')=='false' and pg.locator('#cc-nav-toggle').evaluate('(e)=>document.activeElement===e'))
  for tab in tabs:
   navigate(pg,tab);ready(pg)
   check('mobile no overflow '+tab,pg.evaluate('document.documentElement.scrollWidth<=innerWidth'))
   check('mobile stock values not truncated '+tab,pg.evaluate("Array.from(document.querySelectorAll('.res-amount')).every(x=>x.scrollWidth<=x.clientWidth+1)"))
   if tab in ['facilities','galaxy','fleet','protocol']:pg.screenshot(path=str(out/(tab+'-mobile.png')),full_page=True)
  navigate(pg,'save');pg.locator('[data-action="save"]').click();before=current(pg)['state']['activePlanetId']
  pg.locator('[data-bind="transfer"]').fill('{"version":8,"savedAt":1,"state":{}}');pg.locator('[data-action="import-text"]').click()
  check('invalid v8 import preserves the active empire',current(pg)['state']['activePlanetId']==before and len(current(pg)['state']['planets'])==3);ctx.close()
  legacy=json.loads((root/'tests/fixtures/v8-p3.json').read_text());legacy['savedAt']=legacy['lastTickAt']=int(time.time()*1000);original=json.dumps(legacy)
  ctx,pg=context(browser,original);migrated=current(pg)
  check('native v8 load migrated to v9',migrated['version']==9)
  check('migration preserves name and research',migrated['state']['planets'][0]['name']==legacy['state']['planet']['name'] and migrated['state']['research']['levels']==legacy['state']['research']['levels'])
  check('original native backup is byte exact',pg.evaluate("localStorage.getItem('infinity.save.backup.original')")==original)
  navigate(pg,'save')
  with pg.expect_download() as download:pg.locator('[data-action="export-backup"]').click()
  check('backup download is the exact old file',Path(download.value.path()).read_text()==original)
  pg.reload(wait_until='networkidle');ready(pg)
  check('refresh preserves original and migrated version',current(pg)['version']==9 and pg.evaluate("localStorage.getItem('infinity.save.backup.original')")==original)
  pg.screenshot(path=str(out/'save-migrated-desktop.png'),full_page=True);ctx.close()
  ctx,pg=context(browser,'{broken-original');navigate(pg,'save');pg.locator('[data-action="save"]').click()
  check('damaged original blocks explicit saves',pg.evaluate("localStorage.getItem('infinity.save.v1')")=='{broken-original')
  pg.reload(wait_until='networkidle');ready(pg)
  check('unload/reload retains damaged original',pg.evaluate("localStorage.getItem('infinity.save.v1')")=='{broken-original')
  check('recovery instructions shown','自动保存已暂停' in pg.locator('#save-protection').inner_text());ctx.close();browser.close()
 check('no uncaught JS exceptions',not errors);check('no failed network requests',not failed)
finally:
 report['passed']=sum(x['passed'] for x in checks);report['total']=len(checks)
 (out/'browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps({'passed':report['passed'],'total':report['total'],'mode':report['mode']},ensure_ascii=False))
