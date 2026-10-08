"""Ring-only acceptance. Default is real HTTP/native storage; --inline is an explicitly labeled fallback."""
import argparse,json,time,re,mimetypes,shutil
from pathlib import Path
from urllib.parse import unquote,urlparse
from playwright.sync_api import sync_playwright,expect
ap=argparse.ArgumentParser();ap.add_argument('--url',default='http://127.0.0.1:4173/Infinity/');ap.add_argument('--fixture',default='ring-review-save.json');ap.add_argument('--output',default='ring-evidence');ap.add_argument('--inline',action='store_true');a=ap.parse_args()
dist=Path('dist').resolve();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
key='infinity.original-p4.save.v1';checks=[];errors=[];failed=[];done=False
fixture=json.loads(Path(a.fixture).read_text());fixture['savedAt']=fixture['lastTickAt']=int(time.time()*1000)
def check(name,ok):
 checks.append({'name':name,'passed':bool(ok)})
 if not ok:raise AssertionError(name)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
 c=b.new_context(viewport={'width':1440,'height':1000},device_scale_factor=1,reduced_motion='reduce');page=c.new_page();page.set_default_timeout(8000)
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:failed.append(r.url))
 seed={key:json.dumps(fixture,ensure_ascii=False),'infinity.save.v1':'RETAIN LEGACY BYTES','infinity.ui.tab':'arcade','infinity.ui.arcadeSkip':'1'}
 try:
  if a.inline:
   def serve(route):
    f=(dist/unquote(urlparse(route.request.url).path).removeprefix('/Infinity/')).resolve()
    if f.is_relative_to(dist) and f.is_file():route.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
    else:route.abort()
   page.route('**/*',serve)
   h=(dist/'index.html').read_text();h=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',h);h=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',h)
   h=h.replace('<head>','<head><base href="http://ring.test/Infinity/"><style>'+next((dist/'assets').glob('*.css')).read_text()+'</style>');page.set_content(h)
   script="""(()=>{const data=new Map(Object.entries(SEED));Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});let frames=[],time=1000;const origin=Date.now();Date.now=()=>origin+time-1000;Object.defineProperty(performance,'now',{value:()=>time});window.requestAnimationFrame=cb=>(frames.push(cb),frames.length);window.cancelAnimationFrame=()=>{};window.__advance=ms=>{time+=ms;const f=frames;frames=[];f.forEach(cb=>cb(time));};})();""".replace('SEED',json.dumps(seed,ensure_ascii=False))
   page.add_script_tag(content=script);page.add_script_tag(content=next((dist/'assets').glob('*.js')).read_text(),type='module')
  else:
   c.add_init_script("if(!sessionStorage.getItem('ring-test-seeded')){for(const[k,v]of Object.entries(SEED))localStorage.setItem(k,v);sessionStorage.setItem('ring-test-seeded','1');}".replace('SEED',json.dumps(seed,ensure_ascii=False)))
   response=page.goto(a.url,wait_until='networkidle');check('actual HTTP 200',response.status==200)
  expect(page.locator('.ring-visual')).to_be_visible()
  def advance(ms=100):
   if a.inline:page.evaluate('(t)=>window.__advance(t)',ms)
   else:page.wait_for_timeout(ms)
  def snap(name):
   page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
   page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/name),full_page=True)
  def save():
   page.locator('[data-tab="save"]').click();page.locator('[data-action="save"]').click();return json.loads(page.evaluate('(k)=>localStorage.getItem(k)',key))
  def ring():page.locator('[data-tab="arcade"]').click();advance()
  check('original UI retained',page.locator('.command-ui').count()==0)
  check('24 individually imaged tiles',page.locator('[data-tile] img.ring-art').count()==24)
  check('15 distinct tile art files',len(set(page.locator('[data-tile] img').evaluate_all('(els)=>els.map(e=>e.src)')))==15)
  check('bet controls use image assets',page.locator('.arcade-bet img.ring-art').count()==4)
  check('history uses image assets',page.locator('.arcade-chip img.ring-art').count()>=7)
  check('rule explanations initially folded',not page.locator('#ring-rules').evaluate('(e)=>e.open'))
  check('waiting count includes capacity',' / 7' in page.locator('[data-bind="arcade-runs"]').inner_text())
  snap('ring-desktop.png')
  before=save();ring()
  page.locator('[data-tile="23"]').click();advance()
  check('beacon blackhole is zero','0.0%' in page.locator('#ring-tile-info').inner_text())
  page.locator('#ring-odds-source').select_option('charge-3');advance()
  check('charge blackhole is 1 percent','1.0%' in page.locator('#ring-tile-info').inner_text())
  check('blackhole consequences visible','全损' in page.locator('#ring-tile-info').inner_text())
  page.locator('[data-tile="1"]').click();check('three-slot empty chance 12 percent','12.0%' in page.locator('#ring-tile-info').inner_text())
  for value in ['beacon','charge-1','charge-2','charge-3']:
   page.locator('#ring-odds-source').select_option(value)
   vals=page.locator('[data-ring-odds]').all_text_contents();check(value+' actual displayed total 100',abs(sum(float(s[:-1]) for s in vals)-100)<1e-8)
  page.locator('[data-tile="23"]').focus();page.keyboard.press('ArrowRight');check('keyboard wraps the ring',page.locator('[data-tile="0"]').evaluate('(e)=>e===document.activeElement'))
  page.keyboard.press('End');page.keyboard.press('Enter');check('keyboard selects blackhole',page.locator('[data-tile="23"]').get_attribute('aria-pressed')=='true')
  history=page.locator('[data-ring-history]').last;history.focus();page.keyboard.press('Enter')
  expect(page.locator('.ring-history-detail')).to_be_visible();check('history summary retained',len(page.locator('#ring-history-lines li').all_text_contents())>0)
  check('history focus moves to accessible detail',page.locator('.ring-history-detail').evaluate('(e)=>e===document.activeElement'))
  snap('ring-history.png');page.keyboard.press('Escape');check('Escape closes history',page.locator('.ring-history-detail').is_hidden())
  after=save();check('inspection never changes rolls or RNG',all(before['state']['arcade'][k]==after['state']['arcade'][k] for k in ['seed','runs','history','stats','bets','pity','rollPity']));check('inspection never grants DM',before['state']['darkMatter']==after['state']['darkMatter']);ring()
  input_node=page.locator('#ring-odds-source').evaluate('(e)=>{window.__oddsNode=e;return true;}');advance(1000)
  check('refresh retains select node and chosen source',page.locator('#ring-odds-source').evaluate('(e)=>e===window.__oddsNode&&e.value==="charge-3"'))
  page.locator('[data-bind="arcade-skip"]').uncheck();page.locator('[data-action="arcade-run"]').click();advance()
  check('animation not replaced with immediate final title',page.locator('.ring-hero-title').inner_text()=='正在揭晓')
  for i in range(80):advance(100)
  check('animation finishes and exposes revealed result',page.locator('.ring-hero-title').inner_text()!='正在揭晓')
  after=save();check('one button consumes exactly one result',len(after['state']['arcade']['runs'])==len(before['state']['arcade']['runs'])-1);ring()
  page.locator('[data-bind="arcade-skip"]').check();page.locator('[data-action="arcade-all"]').click();advance();after=save();check('all reveals drain pending queue',not after['state']['arcade']['runs']);ring()
  check('empty queue button disabled',page.locator('[data-action="arcade-run"]').is_disabled())
  for width in [320,390,768,1440]:
   page.set_viewport_size({'width':width,'height':1000});advance()
   check(str(width)+'px ring no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
   box=page.locator('.arcade-board').bounding_box();check(str(width)+'px board is square',abs(box['width']-box['height'])<2)
   if width==390:snap('ring-mobile.png')
   page.locator('#ring-rules summary').first.click();advance();check(str(width)+'px open odds no overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));page.locator('#ring-rules summary').first.click()
  page.set_viewport_size({'width':1440,'height':1000});page.locator('[data-ring="charge"]').click();advance()
  check('charge shortcut opens real fleet form',page.locator('#space-fleet').is_visible() and page.locator('#flight-position').input_value()=='16' and page.locator('#flight-mission').input_value()=='charge')
  ring();page.locator('[data-ring="deep"]').click();advance();check('report shortcut opens actual reports',page.locator('#space-deep').is_visible())
  check('legacy save remains untouched',page.evaluate("localStorage.getItem('infinity.save.v1')")=='RETAIN LEGACY BYTES')
  ring();page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
  check('all ring images decode',page.locator('.ring-visual img.ring-art').evaluate_all('(els)=>els.every(e=>e.complete&&e.naturalWidth===128)'))
  if not a.inline:
   save();page.reload(wait_until='networkidle');ring();check('native reload restores prior history',page.locator('[data-ring-history]').count()>=7)
  check('no uncaught JS error',not errors);check('no failed resource requests',not failed);done=True
 finally:
  report={'completed':done,'mode':'inline DOM / memory Storage / controlled clock' if a.inline else 'HTTP / native localStorage / real-time','url':a.url,'passed':sum(x['passed']for x in checks),'checks':checks,'errors':errors,'failedRequests':failed,'fixture':'Explicitly pre-funded; results produced by real rules with fixture-only seed selection. Not normal progression or user save.'}
  (out/'ring-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False));b.close()
