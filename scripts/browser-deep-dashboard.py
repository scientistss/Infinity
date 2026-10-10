"""Deep dashboard and offline-modal regression; default HTTP/native storage/real time."""
import argparse, json, mimetypes, re, shutil, time
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright, expect
ap=argparse.ArgumentParser()
ap.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
ap.add_argument('--fixture',default='deep-dashboard-review.json')
ap.add_argument('--output',default='dashboard-evidence')
ap.add_argument('--inline',action='store_true')
a=ap.parse_args();dist=Path('dist').resolve();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
fixture=json.loads(Path(a.fixture).read_text());key='infinity.original-p4.save.v1'
checks=[];errors=[];failed=[];complete=False

def check(name,passed):
    checks.append({'name':name,'passed':bool(passed)})
    print(name, bool(passed), flush=True)
    if not passed:raise AssertionError(name)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    context=browser.new_context(viewport={'width':1440,'height':1050},reduced_motion='reduce')
    page=context.new_page();page.set_default_timeout(10000)
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:failed.append(r.url))
    # Deliberately aged fixture: the normal offline dialog must appear and be acknowledged.
    fixture['savedAt']=fixture['lastTickAt']=int(time.time()*1000)-61000
    seed={key:json.dumps(fixture,ensure_ascii=False),'infinity.save.v1':'KEEP LEGACY SAVE','infinity.ui.tab':'facilities'}
    try:
        if a.inline:
            def serve(route):
                f=(dist/unquote(urlparse(route.request.url).path).removeprefix('/Infinity/')).resolve()
                if f.is_relative_to(dist) and f.is_file():route.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream')
                else:route.abort()
            page.route('**/*',serve)
            html=(dist/'index.html').read_text();html=re.sub(r'<script[^>]*src="[^"]+"[^>]*></script>','',html);html=re.sub(r'<link[^>]+rel="stylesheet"[^>]*>','',html)
            html=html.replace('<head>','<head><base href="http://deep.test/Infinity/"><style>'+next((dist/'assets').glob('*.css')).read_text()+'</style>')
            page.set_content(html)
            code="""(()=>{const data=new Map(Object.entries(SEED));Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}});let frames=[],time=1000;const origin=Date.now();Date.now=()=>origin+time-1000;Object.defineProperty(performance,'now',{value:()=>time});window.requestAnimationFrame=cb=>(frames.push(cb),frames.length);window.cancelAnimationFrame=()=>{};window.__advance=ms=>{time+=ms;const fs=frames;frames=[];fs.forEach(f=>f(time));};})();""".replace('SEED',json.dumps(seed,ensure_ascii=False))
            page.add_script_tag(content=code);page.add_script_tag(content=next((dist/'assets').glob('*.js')).read_text(),type='module')
        else:
            context.add_init_script("if(!sessionStorage.getItem('dashboard-seeded')){for(const[k,v]of Object.entries(SEED)){let value=v;if(k==='infinity.original-p4.save.v1'){const f=JSON.parse(v);f.savedAt=f.lastTickAt=Date.now()-61000;value=JSON.stringify(f);}localStorage.setItem(k,value);}sessionStorage.setItem('dashboard-seeded','1');}".replace('SEED',json.dumps(seed,ensure_ascii=False)))
            response=page.goto(a.url,wait_until='networkidle',timeout=45000);check('HTTP 200',response.status==200)
        page.locator('[data-bind="amount-metal"]').wait_for()
        modal=page.locator('[data-bind="offline-modal"]')
        expect(modal).to_be_visible();check('aged fixture shows real offline dialog',modal.is_visible())
        page.locator('[data-action="dismiss-offline"]').click();expect(modal).to_be_hidden()
        check('offline dialog closed through normal button',modal.is_hidden())
        def advance(seconds=.1):
            if a.inline:page.evaluate('(ms)=>window.__advance(ms)',seconds*1000)
            else:page.wait_for_timeout(seconds*1000)
        def tab(name):
            if modal.is_visible():page.locator('[data-action="dismiss-offline"]').click();expect(modal).to_be_hidden()
            page.locator('[data-tab="'+name+'"]').click();advance()
        def save():
            tab('save');page.locator('[data-action="save"]').click()
            return json.loads(page.evaluate('(k)=>localStorage.getItem(k)',key))
        def snap(name):
            page.evaluate("Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))")
            page.evaluate('scrollTo(0,0)');page.screenshot(path=str(out/name),full_page=True)
        tab('deep')
        check('original navigation and layout retained',page.locator('.command-ui').count()==0)
        check('in-flight charging shown in deep tab',page.locator('[data-deep-flight]').count()==1)
        check('holding phase matches actual state',page.locator('[data-deep-flight] [aria-current="step"]').get_attribute('data-phase')=='holding')
        check('critical risk stays visible','战损' in page.locator('#deep-protection').inner_text())
        check('help is folded, not removed',page.locator('.deep-help').count()==4 and page.locator('.deep-help[open]').count()==0)
        check('reports use the event images',page.locator('#deep-reports>details>summary .deep-event-icon').count()==2)
        check('round data initially folded',page.locator('.deep-rounds').count()==1 and page.locator('.deep-rounds[open]').count()==0)
        before=save();tab('deep')
        page.locator('[data-deep-flight] [data-space="recall"]').evaluate('(e)=>{window.__recall=e;e.focus()}')
        advance(1)
        check('timer refresh preserves recall button and focus',page.evaluate('window.__recall===document.activeElement && window.__recall.isConnected'))
        page.locator('#deep-amount').fill('1234');advance(1)
        check('trade input survives updates',page.locator('#deep-amount').input_value()=='1234')
        for value,n in [('merchant',1),('battle',1),('loss',0),('pending',0),('all',2)]:
            page.locator('#deep-report-filter').select_option(value)
            check(value+' report filter count',page.locator('#deep-reports>details:not([hidden])').count()==n)
        battle=page.locator('#deep-reports>details').filter(has=page.locator('.deep-rounds'))
        battle.locator(':scope>summary').click();battle.locator('.deep-rounds>summary').click();advance(1)
        check('expanded battle rounds survive refresh',battle.locator('.deep-rounds').evaluate('(e)=>e.open'))
        after=save()
        check('inspection cannot reroll or settle a charge',before['state']['deepSpace']==after['state']['deepSpace'])
        check('inspection does not change pending results',before['state']['arcade']['runs']==after['state']['arcade']['runs'])
        tab('deep');snap('deep-dashboard-desktop.png')
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':1050});advance()
            check(str(width)+'px no page overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
            if width==390:snap('deep-dashboard-mobile.png')
        # Actual same-ID import must retire both hidden dashboard row caches and
        # their rendered recall capabilities, not just the ordinary fleet tab.
        old_fleet_id=page.locator('[data-deep-flight] [data-space="recall"]').get_attribute('data-fleet')
        page.locator('[data-deep-flight] [data-space="recall"]').evaluate('(e)=>window.__preImportDeepRecall=e')
        incoming=save()
        page.locator('[data-bind="transfer"]').fill(json.dumps(incoming,ensure_ascii=False))
        page.locator('[data-action="import-text"]').click()
        expect(page.locator('[data-bind="status"]')).to_have_text('已导入并存入本地')
        check('import retires cached deep recall while dashboard is hidden',page.evaluate('!window.__preImportDeepRecall.isConnected'))
        tab('deep')
        check('same-ID import creates a fresh deep recall capability',page.locator('[data-deep-flight] [data-space="recall"]').get_attribute('data-fleet')==old_fleet_id and page.evaluate("""document.querySelector('[data-deep-flight] [data-space=\"recall\"]')!==window.__preImportDeepRecall"""))
        rejected=page.evaluate("""()=>{
          const status=document.querySelector('[data-bind="status"]').textContent;
          const old=window.__preImportDeepRecall;
          document.querySelector('#deep-flight-list').append(old);old.click();old.remove();
          const current=document.querySelector('[data-deep-flight] [data-space="recall"]');
          const clone=current.cloneNode(true);document.querySelector('#deep-flight-list').append(clone);clone.click();clone.remove();
          const id=current.dataset.fleet;current.dataset.fleet=String(Number(id)+1000);current.click();current.dataset.fleet=id;
          return document.querySelector('[data-bind="status"]').textContent===status && document.querySelector('[data-deep-flight] [aria-current="step"]').dataset.phase==='holding';
        }""")
        check('retired cloned and dataset-tampered deep recall nodes are rejected before action',rejected)
        page.locator('[data-deep-flight] [data-space="recall"]').evaluate('(e)=>{window.__freshDeepRecall=e;e.focus()}')
        # Ordinary fleet rows are intentionally projected only on their own tab.
        # Prepare a real visible capability before exercising its render boundary.
        tab('fleet')
        expect(page.locator('#space-fleets [data-space="recall"]')).to_be_visible()
        expect(page.locator('#space-fleets [data-space="recall"]')).to_be_enabled()
        # Explicit DOM-render boundary probe: invalidate only the ordinary list's
        # render cache, without changing or injecting any game state.
        page.evaluate("""()=>{window.__ordinaryRecall=document.querySelector('#space-fleets [data-space="recall"]');delete document.querySelector('#space-fleets').dataset.fleetSignature;}""")
        advance(1)
        check('ordinary fleet redraw cannot retire the independent deep capability',page.evaluate("""!window.__ordinaryRecall.isConnected && document.querySelector('#space-fleets [data-space="recall"]')!==window.__ordinaryRecall && document.querySelector('[data-deep-flight] [data-space="recall"]')===window.__freshDeepRecall"""))
        tab('deep')
        check('returning to deep preserves its capability after ordinary fleet redraw',page.evaluate("""document.querySelector('[data-deep-flight] [data-space="recall"]')===window.__freshDeepRecall"""))
        page.locator('[data-deep-flight] [data-space="recall"]').evaluate('(e)=>e.focus()');advance(1)
        check('fresh deep recall still retains focus across ordinary timer updates',page.evaluate('window.__freshDeepRecall===document.activeElement && window.__freshDeepRecall.isConnected'))
        page.locator('[data-deep-flight] [data-space="recall"]').click();advance()
        check('recall uses actual fleet action',page.locator('[data-deep-flight] [aria-current="step"]').get_attribute('data-phase')=='return')
        check('recall immediately disables duplicate action',page.locator('[data-deep-flight] [data-space="recall"]').is_disabled())
        check('cancelled task does not invent a report',page.locator('[data-deep-flight] .deep-view-report').is_hidden())
        snap('deep-dashboard-recalled.png')
        state=save();remaining=state['state']['fleets'][0]['remaining']
        advance(remaining+.3);state=save();check('recall returns and releases fleet',not state['state']['fleets'])
        check('recall does not award a completed charge',state['state']['deepSpace']['completed']==before['state']['deepSpace']['completed'])
        tab('deep');check('empty-state replaces returned fleet',page.locator('#deep-flight-empty').is_visible())
        check('legacy save remains intact',page.evaluate("localStorage.getItem('infinity.save.v1')")=='KEEP LEGACY SAVE')
        if not a.inline:
            previous=save();page.reload(wait_until='networkidle');restored=save()
            check('native reload retains reports',previous['state']['deepSpace']['reports']==restored['state']['deepSpace']['reports'])
        check('no JS exceptions',not errors);check('no failed resource requests',not failed);complete=True
    finally:
        if not complete:
            try:page.screenshot(path=str(out/'failure.png'),full_page=True)
            except Exception:pass
        report={'completed':complete,'mode':'inline DOM / memory storage / controlled clock' if a.inline else 'HTTP / native localStorage / real-time','url':a.url,'passed':sum(c['passed'] for c in checks),'checks':checks,'errors':errors,'failedRequests':failed,'fixture':'Pre-funded rule-generated events, deliberately 61 seconds old to test offline-modal acknowledgement; not player progress.'}
        (out/'dashboard-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));browser.close()
