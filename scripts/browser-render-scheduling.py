"""Controlled render scheduling correctness on real before/after HTTP bundles.

Date.now, performance.now, RAF and autosave callbacks are explicitly controlled.
Native Storage is delegated unchanged except named injected faults. The counter
wraps native DOMTokenList.toggle, observing the unchanged original energy chip
once per original view update; it is NOT a timing or compositor paint metric.
All normal clicks/typing are trusted browser input. Adversarial old-node replay,
synthetic hidden state and native File.text completion gates are clearly labeled.
"""
import argparse
from npc_display_contract import SAMPLE_JS as NPC_DISPLAY_SAMPLE_JS, normalize_npc_display
from demolition_display_contract import FACILITY_DEMOLITION_SAMPLE_JS, normalize_demolition_display
from r14_compatibility import expected_npc_economy, advance_expected_npc_wallet, CURRENT_REVISION, assert_zero_grant_metadata, lift_legacy_state_to_r14
import base64
import copy
import hashlib
import json
import platform
import shutil
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, urljoin
from playwright.sync_api import sync_playwright, expect

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--before-url',required=True)
parser.add_argument('--fixture',default='render-scheduling-review-save.json')
parser.add_argument('--output',default='render-scheduling-evidence')
parser.add_argument('--chromium')
args=parser.parse_args()
CURRENT_PACKAGE_VERSION=json.loads((Path(__file__).resolve().parents[1]/'package.json').read_text())['version']
fixtures=json.loads(Path(args.fixture).read_text())
KEY,BACKUP,EPOCH=fixtures['key'],fixtures['backupKey'],fixtures['epoch']
HOME,COLONY=fixtures['homeId'],fixtures['colonyId']
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
MODE='controlled Date/performance/RAF/autosave callbacks; actual HTTP, native Storage and trusted browser input'
checks,errors,failed_requests,audits,differentials,parity_captures=[],[],[],[],[],[]
case,completed,active_page,diagnostics='setup',False,None,None

INIT=r"""(() => {
 window.__fileImportConfirmations=[];
 const nativeConfirm=window.confirm.bind(window);
 window.confirm=message=>{window.__fileImportConfirmations.push(String(message));return nativeConfirm(message);};
 const key=__KEY__,epoch=__EPOCH__,get=Storage.prototype.getItem,set=Storage.prototype.setItem;
 let elapsed=0,next=0,updates=0;const callbacks=new Map(),intervals=new Map();
 const native=fn=>/\[native code\]/.test(Function.prototype.toString.call(fn));
 const backing={get:native(get),set:native(set),toggle:native(DOMTokenList.prototype.toggle),storage:localStorage instanceof Storage};
 Date.now=()=>epoch+elapsed;Object.defineProperty(performance,'now',{value:()=>elapsed});
 window.requestAnimationFrame=fn=>{const id=++next;callbacks.set(id,fn);return id;};
 window.cancelAnimationFrame=id=>callbacks.delete(id);
 window.setInterval=(fn,ms,...args)=>{const id=++next;intervals.set(id,{fn,ms,args});return id;};
 window.clearInterval=id=>intervals.delete(id);
 const toggle=DOMTokenList.prototype.toggle;
 DOMTokenList.prototype.toggle=function(...args){
  if(this===document.querySelector('[data-bind="energy-chip"]')?.classList&&args[0]==='short')updates++;
  return toggle.apply(this,args);
 };
 const p={events:[],fault:null,files:[],gateFiles:false};
 Storage.prototype.setItem=function(k,v){
  if(this===localStorage&&String(k)===key){
   p.events.push({type:'write',key:String(k),fault:p.fault,at:elapsed,chars:String(v).length,injected:p.fault==='write'||p.fault==='drop'});
   if(p.fault==='write')throw new DOMException('Labeled controlled current-slot fault','QuotaExceededError');
   if(p.fault==='drop')return; // Labeled acknowledged-but-dropped write; native readback must reject it.
  }
  return set.call(this,k,v);
 };
 window.addEventListener('storage',event=>{if(event.storageArea===localStorage&&event.key===key)p.events.push({type:'storage',trusted:event.isTrusted,at:elapsed});});
 for(const type of ['click','input','change','compositionstart','compositionupdate','compositionend','toggle'])document.addEventListener(type,event=>p.events.push({type,trusted:event.isTrusted,target:event.target.id||event.target.dataset?.action||event.target.dataset?.tab||event.target.tagName,at:elapsed}),true);
 const text=File.prototype.text;
 File.prototype.text=async function(){
  if(!p.gateFiles)return text.call(this);
  const entry={name:this.name,ready:false,release:null};p.files.push(entry);
  const result=await text.call(this);entry.ready=true;await new Promise(resolve=>entry.release=resolve);return result;
 };
 window.__renderProbe={
  at:()=>elapsed,advance:ms=>{if(ms<elapsed)throw Error('Controlled clock cannot move backwards');elapsed=ms;},
  frame:()=>{const due=[...callbacks.values()];callbacks.clear();for(const fn of due)fn(elapsed);return due.length;},
  autosave:()=>{const due=[...intervals.values()].filter(x=>x.ms===15000);for(const x of due)x.fn(...x.args);return due.length;},
  raw:()=>get.call(localStorage,key),updates:()=>updates,resetUpdates:()=>updates=0,
  snapshot:()=>({at:elapsed,updates,pendingRAF:callbacks.size,backing,events:p.events}),
  fault:value=>p.fault=value,gate:()=>p.gateFiles=true,files:p.files,
 };
})();""".replace('__KEY__',json.dumps(KEY)).replace('__EPOCH__',str(EPOCH))


def check(name,condition,detail=None):
    row={'case':case,'name':name,'passed':bool(condition),'classification':MODE}
    if detail is not None:row['detail']=detail
    checks.append(row)
    if not condition:raise AssertionError(f'{case}: {name}')


def confirmation_count(page):
    return page.evaluate('window.__fileImportConfirmations.length')


def accept_file_confirmation(page, incoming, current):
    # Install only around this successful current read, never on every page/dialog.
    active = next(planet for planet in current['planets'] if planet['id'] == current['activePlanetId'])
    progress = f'第 {current["stats"]["launches"] + 1} 轮，{len(current["planets"])} 颗星球，当前“{active["name"]}”'
    seen = []
    def answer(dialog):
        seen.append({'type': dialog.type, 'message': dialog.message})
        assertions = [
            ('file import presents a native confirm', dialog.type == 'confirm'),
            ('file confirmation identifies the actual source version and revision', dialog.message.startswith(f'已读取存档 v{incoming["version"]}/r{incoming["revision"]}。')),
            ('file confirmation names the current round and planet progress', f'是否替换当前进度（{progress}）？' in dialog.message),
            ('file confirmation warns that read-time changes will be replaced', '读取期间产生的变化也会被替换' in dialog.message),
            ('file confirmation promises adoption only after verified persistence', '写入校验成功后才采用' in dialog.message),
        ]
        if not all(condition for _, condition in assertions):
            dialog.dismiss()
        for name, condition in assertions:
            check(name, condition)
        dialog.accept()
    page.once('dialog', answer)
    return seen


def frame(page,at=None):
    if at is not None:page.evaluate('at=>window.__renderProbe.advance(at)',at)
    count=page.evaluate('window.__renderProbe.frame()')
    check('explicit RAF wave contains an application callback',count>=1)


def click(page,selector,flush=True):
    # force avoids RAF-based actionability stability polling, but still dispatches
    # real browser pointer input through Playwright, not element.click(). Center
    # first: a long retained draft can leave the next tab under the sticky header,
    # and forced clicks deliberately skip Playwright's ordinary hit-target check.
    target=page.locator(selector)
    hit=target.evaluate('''element => {
      element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
      const rect=element.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
      const actual=document.elementFromPoint(x,y);
      return {clear:actual===element||element.contains(actual),x,y,actual:actual?.id||actual?.tagName||null};
    }''')
    check('trusted pointer target is unobscured: '+selector,hit['clear'],hit)
    target.click(force=True)
    if flush:frame(page)


def tab(page,name):
    if page.locator('[data-bind="offline-modal"]').is_visible():click(page,'[data-action="dismiss-offline"]')
    click(page,f'[data-tab="{name}"]')
    expect(page.locator(f'[data-tab-panel="{name}"]')).to_be_visible()


def raw(page):return page.evaluate('window.__renderProbe.raw()')
def saved(page):return json.loads(raw(page))['state']
def updates(page):return page.evaluate('window.__renderProbe.updates()')
def clear_updates(page):page.evaluate('window.__renderProbe.resetUpdates()')


def save(page):
    tab(page,'save');click(page,'[data-action="save"]')
    return saved(page)


def exact_state(actual, expected):
    # JSON scalar types and array ordering are part of the whole-state contract.
    return json.dumps(actual,sort_keys=True,separators=(',',':')) == json.dumps(expected,sort_keys=True,separators=(',',':'))


def lift_r8_state(state, grant_job_floor, *, npc_wallet):
    return lift_legacy_state_to_r14(state, source_revision=8, grant_job_floor=grant_job_floor, npc_wallet=npc_wallet)


def expected_npc_wallet(name):
    # These are independently witnessed additions from the actual fixed r8
    # engine, after each separate source is migrated at age zero. Historical
    # totalTime and the current candidate's NPC field are never age inputs.
    witness = fixtures['npcAdoptedTime']
    assert witness['sourceSha'] == '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b'
    assert witness['observation'] == 'old-totalTime-add; full unobserved old-state equivalence verified'
    assert set(witness['traces']) == set(fixtures['expected'])
    row = witness['traces'][name]
    assert type(row['oldObservedAndUnobservedStateEqual']) is bool and row['oldObservedAndUnobservedStateEqual']
    age = expected_npc_economy(row['adoptedSegmentsSeconds'])
    assert exact_state(row['npcWallet'], age)
    if name.endswith('.initial') or name in ('ring.single', 'ring.all', 'ring.singleAll'):
        assert row['adoptedSegmentsSeconds'] == [] and age == expected_npc_economy()
    return age


def expected_floor(name):
    # Bind to the actual migrated input, not a later trace's issued job counter.
    if name == 'automatic.skipped':
        state = fixtures['expected'][name]
        assert state['stats']['launches'] == fixtures['automatic']['state']['stats']['launches'] + 1
        assert not state['research']['queue'] and all(not p['buildQueue'] and not p['shipyardQueue'] for p in state['planets'])
        # This oracle is immediately after its real prestige boundary; no paid
        # job survives or is issued afterwards. The reset explicitly rebases floor.
        return state['orders']['nextJobId']
    source = name.split('.')[0] if '.' in name else {'fresh60': 'fresh', 'rollover60': 'rollover'}.get(name, 'base')
    return fixtures[source]['state']['orders']['nextJobId']


def expected_state(name, page=None):
    state = fixtures['expected'][name]
    return state if page is not None and page.url.startswith(args.before_url) else lift_r8_state(state, expected_floor(name), npc_wallet=expected_npc_wallet(name))


def whole(page,expected,label='complete serialized engine state matches independent production-engine oracle'):
    value=save(page)
    if not page.url.startswith(args.before_url):
        check('every new field independently matches its fixed migration/reset boundary',assert_zero_grant_metadata(value,fixtures['expected'][expected],grant_job_floor=expected_floor(expected),npc_wallet=expected_npc_wallet(expected)))
    check(label,exact_state(value,expected_state(expected,page)),{'expected':expected})
    return value


def attach(page):
    page.set_default_timeout(10000)
    page.on('pageerror',lambda error:errors.append({'case':case,'error':str(error)}))
    page.on('requestfailed',lambda request:failed_requests.append({'case':case,'url':request.url}))


def boot(which='base',url=None,initial_tab='overview',corrupt=False):
    global active_page
    url=url or args.url;parsed=urlparse(url)
    check('production bundle is served over HTTP(S)',parsed.scheme in ('http','https'))
    seed=copy.deepcopy(fixtures[which]);seed['savedAt']=seed['lastTickAt']=EPOCH
    check('controlled shared fixture is genuine r8 with no r9 library',seed['revision']==8 and 'buildingTemplates' not in seed['state'])
    if corrupt:seed['state']['formations']['nextFormationId']=0
    context=browser.new_context(viewport={'width':1440,'height':1100},reduced_motion='reduce',accept_downloads=True,
        storage_state={'cookies':[],'origins':[{'origin':f'{parsed.scheme}://{parsed.netloc}','localStorage':[
            {'name':KEY,'value':json.dumps(seed,ensure_ascii=False)}, {'name':'infinity.ui.tab','value':initial_tab}]}]})
    context.add_init_script(INIT);page=context.new_page();active_page=page;attach(page)
    response=page.goto(url,wait_until='networkidle')
    check('actual HTTP production response',response is not None and response.status==200)
    page.locator('[data-bind="energy-chip"]').wait_for()
    check('counter and healthy Storage delegate to captured native implementations',all(page.evaluate('window.__renderProbe.snapshot().backing').values()))
    if not corrupt and url == args.url:
        stored=json.loads(raw(page))
        check('controlled startup independently validates fixed floor and zero grants',assert_zero_grant_metadata(stored['state'],seed['state'],grant_job_floor=seed['state']['orders']['nextJobId'],npc_wallet=expected_npc_economy()))
        check('controlled current startup observes actual r8 migration and only approved metadata',stored['revision']==CURRENT_REVISION and exact_state(stored['state'],lift_r8_state(seed['state'],seed['state']['orders']['nextJobId'],npc_wallet=expected_npc_economy())))
        check('controlled migration preserves exact historical native seed bytes',page.evaluate('key=>localStorage.getItem(key)',BACKUP)==json.dumps(seed,ensure_ascii=False))
    return context,page


def snapshot(page, omit_building_addition=False, ring_base=None, order_base=None, facility_base=None, research_base=None, npc_base=None):
    result=page.evaluate('''({omitBuilding,ringBase,orderBase,facilityBase,researchBase}) => {
      const panel=[...document.querySelectorAll('[data-tab-panel]')].find(e=>!e.hidden);
      const visible=e=>{
        // Chromium may return geometry for closed-details content. Its first
        // summary remains visible; all other descendants are actually hidden.
        for(let ancestor=e;ancestor;ancestor=ancestor.parentElement){
          if(ancestor.hidden||getComputedStyle(ancestor).display==='none')return false;
          if(ancestor instanceof HTMLDetailsElement&&!ancestor.open){
            const summary=[...ancestor.children].find(child=>child.tagName==='SUMMARY');
            if(!summary?.contains(e))return false;
          }
        }
        const visibility=getComputedStyle(e).visibility;
        return e.getClientRects().length>0&&visibility!=='hidden'&&visibility!=='collapse';
      };
      let text=panel?.innerText;
      if(omitBuilding){
        const addition=panel.querySelector('#building-templates');
        const summary='建筑意图模板 · 保存目标，按需创建有限计划';
        if(panel.dataset.tabPanel!=='orders'||!addition||addition.parentElement!==panel||panel.lastElementChild!==addition||addition.open||addition.innerText!==summary)
          throw Error('New building-library parity exception must be the exact closed final region');
        const suffix='\\n'+summary;
        if(!text.endsWith(suffix)||text.indexOf(summary)!==text.lastIndexOf(summary))throw Error('Unexpected new-region text boundary');
        text=text.slice(0,-suffix.length);
      }
      const inputs=[...panel.querySelectorAll('input,select,textarea,button')].filter(visible);
      const result={tab:panel?.dataset.tabPanel,text,
       shared:Object.fromEntries(['amount-metal','amount-crystal','amount-deuterium','energy-top','played','status','gain','score','multiplier'].map(k=>[k,document.querySelector(`[data-bind="${k}"]`)?.textContent])),
       inputs:inputs.map(e=>({id:e.id,action:e.dataset.action??e.dataset.space??null,type:e.type,value:e.value,disabled:e.disabled,checked:e.checked??null,text:e.tagName==='BUTTON'?e.textContent:null}))};
      if(researchBase){
        const later=panel.querySelector('[data-bind="rlater-intergalactic_research_network"]');
        const card=panel.querySelector('[data-bind="rcard-intergalactic_research_network"]');
        result.researchEvidence={panelHTML:panel.outerHTML,laterHTML:later?.outerHTML??null,laterText:later?.textContent??null,
          count:panel.querySelectorAll('[data-bind="rlater-intergalactic_research_network"]').length,
          cardBindings:[...panel.querySelectorAll('article.rcard')].map(e=>e.dataset.bind),
          buttonIds:[...panel.querySelectorAll('[data-action="research"]')].map(e=>e.dataset.id),
          exactPlacement:panel.dataset.tabPanel==='research'&&later?.parentElement===card&&
            later.previousElementSibling?.dataset.bind==='reffect-intergalactic_research_network'&&
            later.nextElementSibling?.dataset.bind==='rchain-intergalactic_research_network',
          activeDetails:[...panel.querySelectorAll('[data-bind="rqueue-list"] [data-q="detail"]')].map(e=>e.textContent),
        };
      }
      if(facilityBase){
        const cards=[...panel.querySelectorAll('article.bld')],terra=panel.querySelector('[data-bind="bld-terraformer"]');
        const grids=[...panel.querySelectorAll(':scope > .bld-grid')],last=grids.at(-1);
        result.facilityEvidence={panelHTML:panel.outerHTML,
          count:document.querySelectorAll('[data-bind="bld-terraformer"]').length,cardHTML:terra?.outerHTML??null,
          cardText:terra?.innerText??null,leftText:panel.querySelector('[data-bind="bld-missile_silo"]')?.innerText??null,cardBindings:cards.map(e=>e.dataset.bind),
          exactPlacement:panel.dataset.tabPanel==='facilities'&&grids.length===2&&panel.lastElementChild===last&&
            last.previousElementSibling?.matches('h3.group-title')&&last.previousElementSibling.textContent==='设施'&&
            (facilityBase==='before'?last.lastElementChild?.dataset.bind==='bld-missile_silo':
              terra?.parentElement===last&&last.lastElementChild===terra&&terra.previousElementSibling?.dataset.bind==='bld-missile_silo'),
          controls:[...(terra?.querySelectorAll('input,select,textarea,button')??[])].map(e=>({tag:e.tagName,id:e.id,action:e.dataset.action,building:e.dataset.id,
            bind:e.dataset.bind,type:e.type,value:e.value,disabled:e.disabled,hidden:e.hidden,visible:visible(e),index:inputs.indexOf(e)})),
          invariantDOM:[...panel.children].map(child=>child.matches('.bld-grid')?
            {tag:child.tagName,attributes:[...child.attributes].map(a=>[a.name,a.value]),children:[...child.children].filter(e=>e!==terra).map(e=>e.outerHTML)}:
            {html:child.outerHTML}),
        };
      }
      if(orderBase){
        const form=panel.querySelector('#order-form'),fieldset=form?.querySelector(':scope > fieldset');
        const budgets=fieldset?.querySelector(':scope > .order-budgets'),quote=panel.querySelector('#order-quote');
        const toggle=fieldset?.nextElementSibling;
        const fields=form?.querySelector(':scope > .order-fields'),kind=panel.querySelector('#order-kind'),target=panel.querySelector('#order-target');
        const goal=panel.querySelector('#order-goal-label');
        const describeSelect=e=>e?{tag:e.tagName,id:e.id,html:e.outerHTML,labelText:e.parentElement?.innerText,
          native:e instanceof HTMLSelectElement,connected:e.isConnected,visible:visible(e),
          owner:e.form===form&&form?.elements.namedItem(e.id)===e&&document.getElementById(e.id)===e,
          count:document.querySelectorAll('#'+e.id).length,index:inputs.indexOf(e),
          type:e.type,value:e.value,disabled:e.disabled,multiple:e.multiple,required:e.required,selectedIndex:e.selectedIndex,
          options:[...e.options].map(o=>({value:o.value,text:o.text,disabled:o.disabled,selected:o.selected,
            native:o instanceof HTMLOptionElement,direct:o.parentElement===e,html:o.outerHTML}))}:null;
        result.orderQuoteEvidence={panelHTML:panel.outerHTML,count:panel.querySelectorAll('#order-quote').length,
          targetSelect:{formCount:document.querySelectorAll('#order-form').length,fieldsHTML:fields?.outerHTML??null,
            exactPlacement:panel.dataset.tabPanel==='orders'&&form instanceof HTMLFormElement&&form.firstElementChild===fields&&
              fields?.children.length===4&&kind?.parentElement===fields.children[1]&&target?.parentElement===fields.children[2]&&
              goal?.parentElement===fields.children[3]&&[...fields.children].every(e=>e.tagName==='LABEL')&&
              kind.parentElement.lastElementChild===kind&&target.parentElement.lastElementChild===target,
            goalLabel:goal?.outerHTML??null,kind:describeSelect(kind),target:describeSelect(target)},
          quoteHTML:quote?.outerHTML??null,quoteText:quote?.innerText??null,
          partVisibility:quote?Object.fromEntries(['order-quote','order-quote-status','order-quote-cost','order-quote-note'].map(id=>[id,visible(panel.querySelector('#'+id))])):null,
          exactPlacement:panel.dataset.tabPanel==='orders'&&fieldset?.parentElement===form&&budgets?.parentElement===fieldset&&
            toggle?.matches('label.order-transport-toggle')&&toggle.querySelector('#order-transport-enabled')?.checked===false&&
            (orderBase==='before'?fieldset.lastElementChild===budgets:
              quote?.parentElement===fieldset&&quote.previousElementSibling===budgets&&fieldset.lastElementChild===quote),
          leftText:budgets?.innerText,rightText:toggle?.innerText,
          caps:[...(budgets?.querySelectorAll('input')??[])].map(e=>[e.id,e.value,e.disabled]),
          controls:[...(quote?.querySelectorAll('input,select,textarea,button')??[])].map(e=>({tag:e.tagName,id:e.id,type:e.type,
            value:e.value,disabled:e.disabled,hidden:e.hidden,visible:visible(e),index:inputs.indexOf(e)})),
        };
      }
      if(ringBase){
        const auto=panel.querySelector('section.ring-auto'),progress=panel.querySelector('[data-bind="arcade-auto"]');
        const side=panel.querySelector('.arcade-side'),manual=side?.querySelector('.arcade-controls'),topup=side?.querySelector('[data-action="arcade-topup"]');
        const describe=e=>e?{html:e.outerHTML,text:e.innerText,hidden:e.hidden,display:getComputedStyle(e).display,visible:visible(e)}:null;
        result.ringEvidence={panelHTML:panel.outerHTML,auto:describe(auto),progress:describe(progress),
          counts:[panel.querySelectorAll('section.ring-auto').length,panel.querySelectorAll('[data-bind="arcade-auto"]').length,panel.querySelectorAll('#ring-manual-progress').length],
          exactPlacement:!!auto&&!!progress&&auto.parentElement===side&&auto.nextElementSibling===topup&&
            (ringBase==='before'?auto.previousElementSibling===manual&&progress.parentElement.matches('details.ring-details')&&
              !progress.parentElement.open&&progress.parentElement.querySelector(':scope > summary')?.textContent==='押注、奖池与自动开奖'&&progress.parentElement.lastElementChild===progress:
              progress.parentElement===side&&manual.nextElementSibling===progress&&progress.nextElementSibling===auto),
          manualText:manual?.innerText,topupText:topup?.innerText,
          controls:[...(auto?.querySelectorAll('input,select,textarea,button')??[])].map(e=>({tag:e.tagName,id:e.id,ring:e.dataset.ring??null,
            type:e.type,value:e.value,disabled:e.disabled,hidden:e.hidden,visible:visible(e),index:inputs.indexOf(e)})),
          invariants:Object.fromEntries(['.arcade-board','.arcade-controls','.arcade-bets','.ring-queue','#ring-rules',
            '[data-bind="arcade-history"]','.ring-history-detail','[data-bind="status-arcade"]','[data-action="arcade-topup"]'].map(selector=>{
              const nodes=panel.querySelectorAll(selector);return [selector,{count:nodes.length,html:nodes[0]?.outerHTML}];})),
        };
      }
      return result;
    }''',{'omitBuilding':omit_building_addition,'ringBase':ring_base,'orderBase':order_base,'facilityBase':facility_base,'researchBase':research_base})
    # Keep every panel before any copied-evidence adapter or later equality
    # assertion can fail. A first mismatch must not hide the other panel pairs.
    side='before' if page.url.startswith(args.before_url) else 'after'
    artifact=f'panel-parity-complete-{side}-{result["tab"]}-{len(parity_captures)}-raw.json'
    (out/artifact).write_text(json.dumps({'snapshot':result,
        'panelHTML':page.locator('[data-tab-panel="'+result['tab']+'"]').evaluate('(node)=>node.outerHTML'),
        'stored':raw(page),'controlledClock':page.evaluate('window.__renderProbe.at()')},ensure_ascii=False,indent=2))
    parity_captures.append({'side':side,'tab':result['tab'],'rawArtifact':artifact})
    if npc_base:
        stored=raw(page);at=page.evaluate('window.__renderProbe.at()');evidence=page.evaluate(NPC_DISPLAY_SAMPLE_JS)
        artifact=f'panel-parity-npc-{npc_base}-{result["tab"]}-{len(audits)}-raw.json'
        (out/artifact).write_text(json.dumps({'snapshot':result,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
        check('NPC exact display exception starts from the complete independent old state: '+npc_base,exact_state(json.loads(stored)['state'],expected_state('base.initial',page)))
        result=normalize_npc_display(result,evidence,json.loads(stored)['state'],npc_base)
        check('NPC display adapter never mutates DOM, storage, state or time',raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at and page.locator('[data-tab-panel="'+result['tab']+'"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML'])
        audits.append({'kind':'exact-no-attack-NPC-display-delta','side':npc_base,'rawArtifact':artifact,'constraint':'Exact full shipyard/defense introductory paragraph in its unique native sibling boundary, old coordinate identities, one attack route per NPC, one mission option, hidden attack controls, exact empty closed report region, fully bound hidden rehearsal controls, and only keyed old scout unavailable notices. Complete remaining shipyard/defense DOM is compared. Every original message node/text/time is retained. No generic message/text/control deletion.'})
    if facility_base:
        stored=raw(page);at=page.evaluate('window.__renderProbe.at()')
        evidence=page.evaluate(FACILITY_DEMOLITION_SAMPLE_JS)
        artifact=f'panel-parity-demolition-{facility_base}-{len(audits)}-raw.json'
        (out/artifact).write_text(json.dumps({'snapshot':result,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
        state=json.loads(stored)['state']
        check('demolition display exception starts from the complete fixed old trajectory: '+facility_base,
              exact_state(state,expected_state('base.initial',page)))
        result=normalize_demolition_display(result,evidence,state,facility_base)
        check('only independently identified demolition additions were projected from copied evidence: '+facility_base,True)
        check('demolition display adapter never writes native DOM, storage or simulated time: '+facility_base,
              raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at and
              page.locator('[data-tab-panel="facilities"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML'])
        audits.append({'kind':'exact-manual-demolition-null-state-additions','side':facility_base,'rawArtifact':artifact,
            'constraint':'Exact unchanged state, thirteen fixed levels/ordered native rows, six visible manual buttons, seven hidden buttons, two empty hidden sections, twelve empty hidden protocol warnings and every parent/sibling identity are independently asserted before copied removal. All other content is retained.'})
        result=facility_base_snapshot(page,facility_base,result)
    if order_base:result=order_quote_base_snapshot(page,order_base,result)
    if research_base:result=research_base_snapshot(page,research_base,result)
    return ring_base_snapshot(page,ring_base,result) if ring_base else result


def research_base_snapshot(page,label,projected):
    evidence=projected.pop('researchEvidence');stored=raw(page);at=page.evaluate('window.__renderProbe.at()')
    artifact=f'panel-parity-research-{label}-raw.json'
    (out/artifact).write_text(json.dumps({'snapshot':projected,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
    state=json.loads(stored)['state'];source=fixtures['base']['state'];after=label=='after'
    check('research copy exception starts from complete unchanged historical base state: '+label,
          exact_state(state,expected_state('base.initial',page)))
    check('research copy exception independently fixes IRN zero, both primary/support labs and all queued research: '+label,
          source['activePlanetId']==state['activePlanetId']==HOME=='homeworld' and
          source['research']['levels']['intergalactic_research_network']==state['research']['levels']['intergalactic_research_network']==0 and
          [(planet['id'],planet['buildings']['research_lab']) for planet in source['planets']]==[(HOME,2),(COLONY,2)] and
          source['research']['queue']==[{'planetId':HOME,'tech':'energy_tech','targetLevel':1,
            'paid':{'metal':'0','crystal':'800','deuterium':'400'},'totalSeconds':1.6,'remainingSeconds':1.6,
            'source':'manual','jobId':2,'taskId':None}] and
          state['research']==source['research'])
    ids=['energy_tech','laser_tech','ion_tech','hyperspace_tech','plasma_tech','combustion_drive','impulse_drive','hyperspace_drive',
         'espionage_tech','computer_tech','astrophysics','intergalactic_research_network','graviton_tech','weapons_tech','shielding_tech','armour_tech']
    check('research copy exception retains all sixteen cards and action identities in original order: '+label,
          label in ('before','after') and projected['tab']=='research' and evidence['count']==1 and evidence['exactPlacement'] and
          evidence['cardBindings']==['rcard-'+tech for tech in ids] and evidence['buttonIds']==ids)
    old='后续：多星球后生效（第 4 阶段）';expected_text='' if after else old
    expected_node='<p class="bld-blurb" data-bind="rlater-intergalactic_research_network">'+expected_text+'</p>'
    check('complete old/new IRN later node is exactly the declared text-only difference: '+label,
          evidence['laterText']==expected_text and evidence['laterHTML']==expected_node and evidence['panelHTML'].count(expected_node)==1)
    check('research copy exception keeps the sole active timer entirely unchanged: '+label,
          evidence['activeDetails']==['剩余 2 秒 / 共 2 秒'])
    # Compare the complete remaining panel DOM, including every cost, time,
    # prerequisite, disabled/title attribute, queue node and card order. Only
    # the already asserted whole paragraph's exact text changes in the copy.
    projected['researchInvariantDOM']=evidence['panelHTML'].replace(expected_node,
        '<p class="bld-blurb" data-bind="rlater-intergalactic_research_network"><verified-irn-copy></verified-irn-copy></p>',1)
    text=projected['text'];left='联通 L 个额外研究实验室（只有一颗星球时没有效果）';right='✗ 研究实验室 2/10'
    check('research copy has unique exact old effect and prerequisite boundaries: '+label,
          text.count(left)==1 and text.count(right)==1 and text.count(old)==int(not after))
    left_end=text.index(left)+len(left);right_start=text.index(right)
    boundary=text[left_end:right_start]
    allowed=('\n','\n\n') if after else tuple(a+old+b for a in ('\n','\n\n') for b in ('\n','\n\n'))
    check('only the verified IRN paragraph and native sibling linebreaks occupy that boundary: '+label,
          left_end<right_start and boundary in allowed)
    projected['text']=text[:left_end]+'\n'+text[right_start:]
    check('research copy comparison never mutates DOM, native storage or the controlled clock: '+label,
          raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at and
          page.locator('[data-tab-panel="research"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML'])
    audits.append({'kind':'exact-irn-zero-obsolete-copy-exception','side':label,'rawArtifact':artifact,
        'oldNode':'<p class="bld-blurb" data-bind="rlater-intergalactic_research_network">'+old+'</p>',
        'newNode':'<p class="bld-blurb" data-bind="rlater-intergalactic_research_network"></p>',
        'observedTextBoundary':boundary,
        'constraint':'Complete unchanged base state, literal IRN-zero/lab/paid-active-job premises, unique exact old/new paragraph and all sixteen card/action identities asserted before replacing only the obsolete text and its native linebreak boundary in copied evidence. Every remaining DOM node, field, cost, time, attribute, control and state stays exact.'})
    return projected



def facility_base_snapshot(page,label,projected):
    evidence=projected.pop('facilityEvidence');stored=raw(page);at=page.evaluate('window.__renderProbe.at()')
    artifact=f'panel-parity-facilities-{label}-{len(audits)}-raw.json'
    (out/artifact).write_text(json.dumps({'snapshot':projected,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
    state=json.loads(stored)['state'];planet=next(p for p in state['planets'] if p['id']==state['activePlanetId'])
    check('facility exception begins from complete unchanged independent base state: '+label,exact_state(state,expected_state('base.initial',page)))
    check('facility exception proves old initial finished prerequisites and supply have not changed: '+label,
          planet['id']==HOME and planet['buildings']['terraformer']==0 and planet['buildings']['nanite_factory']==0 and
          planet['buildings']['robotics_factory']==2 and state['research']['levels']['energy_tech']==0 and
          planet['buildings']['solar_plant']==planet['buildings']['fusion_reactor']==planet['units']['solar_satellite']==0 and
          all(job['building']!='terraformer' for job in planet['buildQueue']))
    old_ids=['metal_mine','crystal_mine','deuterium_synth','solar_plant','fusion_reactor','metal_storage','crystal_storage','deuterium_tank',
             'robotics_factory','nanite_factory','shipyard','research_lab','missile_silo']
    after=label=='after'
    check('only one specifically identified final facility is added; all old identities and order remain: '+label,
          label in ('before','after') and projected['tab']=='facilities' and evidence['exactPlacement'] and
          evidence['count']==int(after) and evidence['cardBindings']==['bld-'+name for name in old_ids+(['terraformer'] if after else [])])
    if after:
        old_planet=next(p for p in fixtures['base']['state']['planets'] if p['id']==HOME)
        check('added card field display derives only from the exact historical base fixture',
              sum(old_planet['buildings'].values())==18 and old_planet['fieldsMax']==163 and len(old_planet['buildQueue'])==1)
        missing='纳米机器人工厂 等级 1、能源技术 等级 12'
        icon_path=urlparse(args.url).path.rstrip('/')+'/icons/'
        expected=f'''<article class="bld locked" data-bind="bld-terraformer">
          <div class="bld-head"><img class="icon icon-robotics_factory icon-row" src="{icon_path}robotics_factory.webp" srcset="{icon_path}robotics_factory.webp 128w, {icon_path}robotics_factory-256.webp 256w" sizes="56px" alt="地形改造器" width="128" height="128" loading="lazy" decoding="async" draggable="false">
          <div class="bld-title"><h3>地形改造器 <small>Terraformer</small></h3><p class="bld-level">等级 <strong data-bind="level-terraformer">0</strong></p></div></div>
          <p class="bld-blurb">新版付款升级完成后总格 +5；该级占 1 格，可用格净增 4。</p>
          <p class="bld-effect" data-bind="effect-terraformer">本版新付款入队每级 +5 总格，建筑占 1 格（净 +4）</p>
          <p class="bld-payback" data-bind="payback-terraformer">格子 18 / 163 · 已付预留 1</p>
          <p class="bld-requires" data-bind="requires-terraformer">前置未满足：{missing}</p>
          <dl class="bld-facts"><div><dt>下一级成本</dt><dd data-bind="cost-terraformer">金属 0.00 · 晶体 5.00e4 · 重氢 1.00e5 · 供能 0.00 / 需要 1.00e3（不消耗）</dd></div><div><dt>耗时</dt><dd data-bind="time-terraformer">建造时间 12 秒</dd></div></dl>
          <button type="button" class="buy-btn" data-action="enqueue" data-id="terraformer" data-bind="enqueue-terraformer" disabled="" title="需要 {missing}"><span class="buy-label" data-bind="upgrade-terraformer">升级到 等级 1</span><span class="btn-cost" data-bind="reason-terraformer">需要 {missing}</span></button></article>'''
        class Tokens(HTMLParser):
            def __init__(self):super().__init__(convert_charrefs=True);self.tokens=[]
            def handle_starttag(self,tag,attrs):self.tokens.append(('start',tag,sorted(attrs)))
            def handle_endtag(self,tag):self.tokens.append(('end',tag))
            def handle_data(self,data):
                if data.strip():self.tokens.append(('text',data.strip()))
            def handle_comment(self,data):self.tokens.append(('comment',data))
        def tokens(html):
            parser=Tokens();parser.feed(html);parser.close();return parser.tokens
        check('added terra card has exact complete DOM, prices, energy, level, prerequisites and disabled action',tokens(evidence['cardHTML'])==tokens(expected))
        controls=evidence['controls'];last_index=len(projected['inputs'])-1
        check('only the uniquely identified disabled final terra button is excluded',controls==[{'tag':'BUTTON','id':'','action':'enqueue','building':'terraformer','bind':'enqueue-terraformer',
            'type':'button','value':'','disabled':True,'hidden':False,'visible':True,'index':last_index}])
        check('excluded snapshot input is precisely the independently verified terra action',projected['inputs'][last_index]=={'id':'','action':'enqueue','type':'button','value':'','disabled':True,'checked':None,
            'text':page.locator('[data-bind="enqueue-terraformer"]').text_content()})
        text=projected['text'];block=evidence['cardText'];left=evidence['leftText']
        check('one complete verified terra card and old final sibling occur exactly once',bool(block) and bool(left) and text.count(block)==1 and text.count(left)==1 and text.endswith(block))
        left_end=text.index(left)+len(left);start=text.index(block)
        check('verified final terra card has only the exact old-card sibling linebreak boundary',left_end<start and text[left_end:start] in ('\n','\n\n'))
        projected['text']=text[:left_end]
        projected['inputs']=projected['inputs'][:-1]
    else:
        check('archived facilities has no terra node, text or action to suppress',evidence['cardHTML'] is None and evidence['cardText'] is None and evidence['controls']==[])
    projected['facilityInvariantDOM']=evidence['invariantDOM']
    check('facility exception never rewrites DOM, stored bytes or the controlled clock: '+label,raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at)
    audits.append({'kind':'explicit-terraformer-card-parity-exception','side':label,'rawArtifact':artifact,
        'removedNode':'[data-bind="bld-terraformer"]' if after else None,
        'constraint':'Exact complete legal old state, ordered old cards, unique final added card, full added DOM/text and disabled action independently asserted; every remaining facility node, text and control compares exactly.'})
    return projected


def order_target_base_snapshot(label,projected,evidence):
    # A copied-evidence adapter for precisely one newly legal building choice.
    # No generic name filtering: the native controls, full ordered options and
    # unique adjacent label boundary must all match before removing that option.
    after=label=='after'
    check('order target exception is the unique native original form row: '+label,
          label in ('before','after') and projected['tab']=='orders' and evidence['formCount']==1 and
          evidence['exactPlacement'] and evidence['goalLabel']=='<span id="order-goal-label">目标等级</span>')
    old=[('metal_mine','金属矿'),('crystal_mine','晶体矿'),('deuterium_synth','重氢合成器'),
         ('solar_plant','太阳能电站'),('fusion_reactor','核聚变反应堆'),('metal_storage','金属仓库'),
         ('crystal_storage','晶体仓库'),('deuterium_tank','重氢罐'),('robotics_factory','机器人工厂'),
         ('nanite_factory','纳米机器人工厂'),('shipyard','造船厂'),('research_lab','研究实验室'),('missile_silo','导弹井')]
    choices=old+([('terraformer','地形改造器')] if after else [])
    kind_choices=[('building','建筑'),('research','研究'),('shipyard','造船 / 防御')]
    for name,title,options,required,index in [('kind','计划类型',kind_choices,False,1),('target','目标',choices,True,2)]:
        observed=evidence[name];id='order-'+name
        expected_options=[{'value':value,'text':text,'disabled':False,'selected':i==0,'native':True,'direct':True,
                           'html':f'<option value="{value}">{text}</option>'} for i,(value,text) in enumerate(options)]
        expected_html=f'<select id="{id}"'+(' required=""' if required else '')+'>'+''.join(o['html'] for o in expected_options)+'</select>'
        expected={'tag':'SELECT','id':id,'html':expected_html,'labelText':title+'\n'+'\n'.join(text for _,text in options),
                  'native':True,'connected':True,'visible':True,'owner':True,'count':1,'index':index,
                  'type':'select-one','value':options[0][0],'disabled':False,'multiple':False,'required':required,
                  'selectedIndex':0,'options':expected_options}
        check('order target exception retains exact '+id+' identity, default, ordered option values/text/permissions: '+label,
              observed==expected)
        check('order target exception keeps the exact original visible select control: '+id+' '+label,
              projected['inputs'][index]=={'id':id,'action':None,'type':'select-one','value':options[0][0],
                  'disabled':False,'checked':None,'text':None} and sum(item['id']==id for item in projected['inputs'])==1)
        check('order target exception binds the complete select HTML to its unique original label: '+id+' '+label,
              evidence['fieldsHTML'].count(expected_html)==1 and
              evidence['fieldsHTML'].count('<label>'+title+expected_html+'</label>')==1)
    kind_text=evidence['kind']['labelText'];target_text=evidence['target']['labelText']
    boundary=kind_text+'\n'+target_text+'\n目标等级'
    check('order target exception binds the exact native option text to one adjacent kind/target/goal boundary: '+label,
          projected['text'].count(boundary)==1 and projected['text'].count(target_text)==1)
    terra='<option value="terraformer">地形改造器</option>'
    check('order target exception adds exactly one final terra option after the thirteen unchanged old options: '+label,
          evidence['fieldsHTML'].count(terra)==int(after) and
          (not after or evidence['target']['html'].endswith('<option value="missile_silo">导弹井</option>'+terra+'</select>')))
    # Preserve all other fields and text, including any unrelated occurrence of
    # this name elsewhere. The full remaining snapshot still compares exactly.
    if after:
        legacy_target='目标\n'+'\n'.join(text for _,text in old)
        projected['text']=projected['text'].replace(boundary,kind_text+'\n'+legacy_target+'\n目标等级',1)
    projected['orderFieldsInvariantDOM']=evidence['fieldsHTML'].replace(terra,'',1) if after else evidence['fieldsHTML']
    return projected


def order_quote_base_snapshot(page,label,projected):
    # Preserve raw snapshots before either narrowly verified orders exception:
    # the read-only quote region and the one appended native building option.
    evidence=projected.pop('orderQuoteEvidence')
    original=copy.deepcopy(projected);stored=raw(page);at=page.evaluate('window.__renderProbe.at()')
    artifact=f'panel-parity-orders-{label}-{len(audits)}-raw.json'
    (out/artifact).write_text(json.dumps({'snapshot':original,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
    check('order quote exception starts from exact legal unchanged base state: '+label,
          exact_state(json.loads(stored)['state'],expected_state('base.initial',page)))
    after=label=='after'
    check('order quote exception has unique exact original budget/toggle boundaries: '+label,
          label in ('before','after') and projected['tab']=='orders' and evidence['exactPlacement'] and evidence['count']==int(after))
    check('order quote exception preserves three zero editable budgets: '+label,
          evidence['caps']==[[f'order-budget-{resource}','0',False] for resource in ('metal','crystal','deuterium')])
    expected=('<div id="order-quote" class="order-quote">'
      '<div class="order-actions"><button id="order-quote-view" type="button">查看当前费用</button><button id="order-quote-fill" type="button" hidden="" disabled="">按当前报价填入预算</button></div>'
      '<p id="order-quote-status" class="muted" role="status">尚未查看当前费用；预算仍由你确认。</p><p id="order-quote-cost" hidden=""></p>'
      '<p id="order-quote-note" class="muted">按当前规则估算未付工作，不含燃料；价格与条件可能变化。查看不付款，填入只改草稿，仍需确认创建。</p></div>')
    class Tokens(HTMLParser):
        def __init__(self):super().__init__(convert_charrefs=True);self.tokens=[]
        def handle_starttag(self,tag,attrs):self.tokens.append(('start',tag,sorted(attrs)))
        def handle_endtag(self,tag):self.tokens.append(('end',tag))
        def handle_data(self,data):
            if data.strip():self.tokens.append(('text',data))
        def handle_comment(self,data):self.tokens.append(('comment',data))
    def tokens(html):
        parser=Tokens();parser.feed(html);parser.close();return parser.tokens
    check('order quote exception has exact complete initial structure and literal text: '+label,
          tokens(evidence['quoteHTML'])==tokens(expected) if after else evidence['quoteHTML'] is None)
    expected_lines=['查看当前费用','尚未查看当前费用；预算仍由你确认。','按当前规则估算未付工作，不含燃料；价格与条件可能变化。查看不付款，填入只改草稿，仍需确认创建。']
    check('order quote exception presents every exact initial visible text block and no hidden cost: '+label,
          evidence['partVisibility']=={'order-quote':True,'order-quote-status':True,'order-quote-cost':False,'order-quote-note':True} and
          [line for line in evidence['quoteText'].splitlines() if line] == expected_lines if after else
          evidence['partVisibility'] is None and evidence['quoteText'] is None)
    controls=evidence['controls']
    check('order quote exception excludes only one enabled view button and one hidden disabled fill button: '+label,
          [(c['tag'],c['id'],c['type'],c['value'],c['disabled'],c['hidden'],c['visible']) for c in controls]==
          ([('BUTTON','order-quote-view','button','',False,False,True),('BUTTON','order-quote-fill','button','',True,True,False)] if after else []))
    text=projected['text'];left=evidence['leftText'];right=evidence['rightText'];block=evidence['quoteText']
    check('order quote exception has unique complete budget and transport labels: '+label,
          bool(left) and right=='授权单源真实运输（默认关闭）' and text.count(left)==1 and text.count(right)==1)
    left_end=text.index(left)+len(left);right_start=text.index(right)
    if after:
        check('order quote exception whole verified block occurs exactly once: '+label,bool(block) and text.count(block)==1)
        start=text.index(block);end=start+len(block)
        separators=[text[left_end:start],text[end:right_start]]
        check('order quote exception exact sibling linebreak boundaries: '+label,left_end<start<end<right_start and all(x in ('\n','\n\n') for x in separators))
        indices=[c['index'] for c in controls]
        check('order quote exception removes exact view control identity only: '+label,
              len(indices)==2 and indices[0]>=0 and indices[1]==-1 and projected['inputs'][indices[0]]==
              {'id':'order-quote-view','action':None,'type':'button','value':'','disabled':False,'checked':None,'text':'查看当前费用'})
        projected['inputs']=[item for i,item in enumerate(projected['inputs']) if i!=indices[0]]
    else:
        separators=[text[left_end:right_start]]
        check('original budget to transport boundary has only native linebreaks: '+label,left_end<right_start and separators[0] in ('\n','\n\n'))
    projected['text']=text[:left_end]+'\n'+text[right_start:]
    projected=order_target_base_snapshot(label,projected,evidence['targetSelect'])
    check('order snapshot exceptions never mutate DOM, storage or advance time: '+label,
          raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at and
          page.locator('[data-tab-panel="orders"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML'])
    audits.append({'kind':'explicit-order-quote-parity-exception','side':label,'rawArtifact':artifact,
      'removedNode':'#order-quote' if after else None,'removedText':block,'adjacentSiblingSeparators':separators,
      'constraint':'Exact zero-budget no-quote state, full added DOM/controls/text asserted before only its visible region is excluded; all remaining old text, controls and state are compared.'})
    audits.append({'kind':'exact-terraformer-order-option-parity-exception','side':label,'rawArtifact':artifact,
      'removedNode':'#order-target > option[value="terraformer"]' if after else None,
      'constraint':'Complete unchanged base state; unique native form/select identities, original building kind and metal_mine default, all thirteen literal ordered legacy options with native selected/disabled properties, and exactly one final legal terraformer option are asserted. Only its unique kind/target/goal text-bound occurrence is removed from copied evidence. All remaining text, controls, full original form-row DOM and state compare exactly; raw native option witnesses are retained for folded/open/reopened captures.'})
    return projected


def ring_base_snapshot(page,label,projected):
    # Read-only, narrowly scoped exception for the approved manual-first base UI.
    # Keep the unfiltered visible snapshot and full DOM even if a precheck fails.
    evidence=projected.pop('ringEvidence')
    original=copy.deepcopy(projected);stored=raw(page);at=page.evaluate('window.__renderProbe.at()');state=json.loads(stored)['state']
    artifact=f'panel-parity-arcade-{label}-raw.json'
    (out/artifact).write_text(json.dumps({'snapshot':original,'evidence':evidence,'stored':stored,'controlledClock':at},ensure_ascii=False,indent=2))
    check('ring exception has the exact legal complete base state: '+label,exact_state(state,expected_state('base.initial',page)))
    arcade=state['arcade']
    check('ring exception is only manual zero, no batch, no card and no ready slot: '+label,
          arcade['stats']['manualRuns']==0 and arcade['autoBatch'] is None and 'auto_runner' not in state['unlockedCards'] and
          all(slot['card'] is None or slot['card']['id']!='auto_runner' for slot in state['protocols']['slots']) and state['research']['levels']['astrophysics']==4)
    check('ring exception retains every original queued outcome and zero stake: '+label,
          exact_state(arcade,fixtures['expected']['base.initial']['arcade']) and
          arcade['bets']=={'metal':0,'crystal':0,'deuterium':0,'drifter':0} and len(arcade['runs'])==1)
    after=label=='after'
    check('ring exception nodes are unique and at the exact original/manual-first boundaries: '+label,
          label in ('before','after') and projected['tab']=='arcade' and evidence['counts']==[1,1,1 if after else 0] and evidence['exactPlacement'])
    source=next(planet for planet in state['planets'] if planet['id']==state['activePlanetId']);coords=source['coordinates']
    source_text=escape(f'当前来源星球：{source["name"]} [{coords["galaxy"]}:{coords["system"]}:{coords["position"]}]')
    disabled=' disabled=""' if after else ''
    setup=(f'<p id="ring-auto-source">{source_text}</p><p id="ring-auto-bets">待授权押注：无押注（每次扣费 0 重氢）</p>'
        '<div class="ring-auto-fields"><label>自动跑灯槽位<select id="ring-auto-slot" aria-describedby="ring-auto-prerequisite"'+disabled+'><option value="-1">暂无可用槽位</option></select></label>'
        '<label>本批次数<input id="ring-auto-count" type="number" min="0" max="1" step="1" value="0" inputmode="numeric"'+disabled+'></label>'
        '<label>总扣费上限（重氢）<input id="ring-auto-cap" type="text" value="0" inputmode="decimal" maxlength="100"'+disabled+'></label></div>')
    validation='<p id="ring-auto-validation" role="status"></p>'
    expected_auto=('<section class="ring-auto" aria-labelledby="ring-auto-title"'+(' hidden=""' if after else '')+'>'
        '<h3 id="ring-auto-title">有限自动开奖</h3><p id="ring-auto-status" role="status" aria-live="polite">关闭 · 默认未授权</p>'
        '<p id="ring-auto-progress">已完成 0/0 次 · 已扣重氢 0 / 上限 0</p><p id="ring-auto-frozen">授权时固定来源星球、当前待揭晓队列前缀和押注。</p>'+
        ('<div id="ring-auto-setup" hidden="">'+setup+validation+'</div>' if after else setup)+
        '<p id="ring-auto-prerequisite">先手动开奖 10 次解锁「自动跑灯」，再到协议页装配到已开启槽位。</p>'+('' if after else validation)+
        '<div class="ring-auto-actions"><button type="button" data-ring="auto-arm" disabled=""'+(' hidden=""' if after else '')+'>授权本批次</button><button type="button" data-ring="auto-stop" disabled="">停止自动开奖</button></div>'
        '<p id="ring-auto-stop-reason" role="status"></p><small>只包含授权时已有的前 N 次；重氢上限按总扣费计算，赢回不补充额度。不会自动加注购买次数，未来信标、顺风奖励不续入。手动开奖或改押注会停止本批次；装配或开关卡片不等于授权。离线也只执行已授权范围。</small></section>')
    # Compare all DOM tokens/text; attribute order alone has no DOM meaning.
    # Parse strings in Python, never clone, rewrite or hide live browser nodes.
    class Tokens(HTMLParser):
        def __init__(self):super().__init__(convert_charrefs=True);self.tokens=[]
        def handle_starttag(self,tag,attrs):self.tokens.append(('start',tag,sorted(attrs)))
        def handle_endtag(self,tag):self.tokens.append(('end',tag))
        def handle_data(self,data):self.tokens.append(('text',data))
        def handle_comment(self,data):self.tokens.append(('comment',data))
    def tokens(html):
        parser=Tokens();parser.feed(html);parser.close();return parser.tokens
    check('ring automatic region has exact complete structure, text and attributes: '+label,
          tokens(evidence['auto']['html'])==tokens(expected_auto))
    expected_progress=('<p class="muted ring-manual-progress" data-bind="arcade-auto" id="ring-manual-progress">手动开奖 0/10 次 · 达标后解锁「自动跑灯」。</p>' if after else
                       '<p class="muted" data-bind="arcade-auto">手动开奖 0/10 次后解锁协议卡「自动跑灯」。</p>')
    check('ring progress is the exact 0/10 node, visible only after its approved move: '+label,
          tokens(evidence['progress']['html'])==tokens(expected_progress) and evidence['progress']['visible']==after and not evidence['progress']['hidden'])
    check('ring automatic region is visible before and genuinely hidden after: '+label,
          evidence['auto']['hidden']==after and evidence['auto']['visible']==(not after) and (evidence['auto']['display']=='none')==after)
    expected_controls=[('SELECT','ring-auto-slot',None,'select-one','-1',after,False),
                       ('INPUT','ring-auto-count',None,'number','0',after,False),('INPUT','ring-auto-cap',None,'text','0',after,False),
                       ('BUTTON','','auto-arm','button','',True,after),('BUTTON','','auto-stop','button','',True,False)]
    check('ring exact five-control contract uses data-ring to distinguish both no-id buttons: '+label,
          [(c['tag'],c['id'],c['ring'],c['type'],c['value'],c['disabled'],c['hidden']) for c in evidence['controls']]==expected_controls and
          all(c['visible']==(not after) for c in evidence['controls']))
    check('ring invariant board, manual controls, bets, queue, odds, history and status remain unique: '+label,
          all(row['count']==1 for row in evidence['invariants'].values()))
    removed=evidence['progress'] if after else evidence['auto']
    block=removed['text'];text=projected['text'];left=evidence['manualText'];right=evidence['topupText']
    check('ring removed complete visible block occurs exactly once: '+label,bool(block) and text.count(block)==1 and text.count(left)==1 and text.count(right)==1)
    start=text.index(block);end=start+len(block);left_end=text.index(left)+len(left);right_start=text.index(right)
    separators=(text[left_end:start],text[end:right_start])
    check('ring removed block has only exact adjacent sibling line-break boundaries: '+label,
          left_end<start<end<right_start and all(s in ('\n','\n\n') for s in separators))
    projected['text']=text[:left_end]+'\n'+text[right_start:]
    indices=[c['index'] for c in evidence['controls']]
    check('ring exclusion addresses only the verified visible old five controls: '+label,
          indices==([-1]*5 if after else list(range(3,8))))
    if not after:projected['inputs']=[control for i,control in enumerate(projected['inputs']) if i not in indices]
    projected['ringInvariantDOM']=evidence['invariants']
    check('ring snapshot exception never mutates stored state or advances the clock: '+label,raw(page)==stored and page.evaluate('window.__renderProbe.at()')==at)
    audits.append({'kind':'manual-first-ring-parity-exception','side':label,'rawArtifact':artifact,
        'removedNode':'#ring-manual-progress' if after else 'section.ring-auto','removedText':block,
        'adjacentSiblingSeparators':separators,'removedVisibleControlIndices':[] if after else indices,
        'constraint':'Exact base state; old full unauthorized region versus new hidden disabled region and accurate manual 0/10. All remaining visible text/controls and captured invariant DOM compare exactly.'})
    return projected


def differential_trace(name,url):
    context,page=boot(url=url);tab(page,'overview');clear_updates(page)
    for step in fixtures['traces'][name]:
        frame(page,step['atMs'])
        if step.get('action')=='scrape':click(page,'[data-bind="action-scrape-ov"]')
    count=updates(page)
    value=whole(page,name)
    row={'trace':name,'url':url,'originalViewUpdates':count,'stateSha256':hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()}
    differentials.append(row);context.close()
    return value,count


def forms(page):
    tab(page,'fleet')
    if not page.locator('#fleet-formations').evaluate('(e)=>e.open'):click(page,'#fleet-formations > summary')
    check('trusted native summary opens the formation library',page.locator('#fleet-formations').evaluate('(e)=>e.open'))


def arm_old(page):
    forms(page)
    click(page,'[data-formation-id="1"] [data-formation-action="select"]')
    page.locator('#formation-payer').select_option(HOME);frame(page)
    click(page,'#formation-fill');click(page,'#formation-preview')
    expect(page.locator('#formation-confirm-replenish')).to_be_enabled()
    page.evaluate('''() => {
      window.__retiredControls=[document.querySelector('#formation-fill'),document.querySelector('#formation-confirm-replenish')];
    }''')


def replay_old(page):
    # Deliberate adversarial replay, not normal input nor a native-event claim.
    forms(page)
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const old of window.__retiredControls){
        root.append(old);old.disabled=false;old.click();
        const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();
      }
    }''');frame(page)


def import_text(page,which='incoming'):
    tab(page,'save');seed=copy.deepcopy(fixtures[which]);now=EPOCH+page.evaluate('window.__renderProbe.at()')
    seed['savedAt']=seed['lastTickAt']=now
    page.locator('#transfer').fill(json.dumps(seed,ensure_ascii=False));frame(page)
    click(page,'[data-action="import-text"]')


def protected_masks(page):
    for name,selector in [('order draft','#order-form'),('template library','#research-templates'),('formation library','#fleet-formations')]:
        check(name+' mounted inputs and actions are immediately disabled',page.locator(selector+' input,'+selector+' select,'+selector+' button').evaluate_all('(xs)=>xs.length>0&&xs.every(x=>x.disabled)'))
    check('all existing order row actions are immediately disabled',page.locator('#order-list button').evaluate_all('(xs)=>xs.every(x=>x.disabled)'))


def retain_ready_controls(page):
    tab(page,'orders');page.locator('#order-budget-metal').fill('12345');frame(page)
    click(page,'#research-templates > summary');click(page,'#template-new')
    page.locator('#template-name').fill('待保存研究草稿');frame(page)
    click(page,'[data-template-id="1"] [data-template-action="select"]')
    page.locator('#template-payer').select_option(HOME);frame(page)
    forms(page);click(page,'#formation-new');page.locator('#formation-name').fill('待保存编成草稿')
    page.locator('[data-formation-unit="small_cargo"]').fill('2');frame(page);arm_old(page)
    check('ready setup includes existing order rows',page.locator('#order-list button').count()>0)
    check('ready setup includes live editor and review authority',page.locator('#template-save').is_enabled() and page.locator('#formation-save').is_enabled() and page.locator('#formation-confirm-replenish').is_enabled())
    page.evaluate('''() => {
      const selectors=['#order-list button','#template-save','#formation-save','#formation-fill','#formation-confirm-replenish'];
      window.__protectedControls=selectors.flatMap(selector=>[...document.querySelectorAll(selector)]);
      const selector='#order-form input,#order-form select,#order-form button,#order-list button,#research-templates input,#research-templates select,#research-templates button,#fleet-formations input,#fleet-formations select,#fleet-formations button';
      window.__maskNodes={selector,body:document.body,nodes:[...document.querySelectorAll(selector)].map(node=>({node,value:node.value}))};
    }''')


def replay_protected_controls(page,reattach=False):
    # Deliberate hostile DOM replay, not normal/trusted input. Disabling is a UI
    # mask; registered-node and current-session authority must still guard writes.
    page.evaluate('''reattach => {
      for(const old of window.__protectedControls){
        const root=document.querySelector(old.dataset.orderAction?'#order-list':old.dataset.templateAction?'#research-templates':'#fleet-formations');
        const wasDisabled=old.disabled;
        if(reattach)root.append(old);
        old.disabled=false;old.click();
        const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();clone.remove();
        if(old.id==='template-save'||old.id==='formation-save'){
          const form=document.querySelector(old.id==='template-save'?'#template-editor':'#formation-editor');
          form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:old}));
        }
        old.disabled=wasDisabled;
        if(reattach)old.remove();
      }
      document.querySelector('#order-form').dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));
    }''',reattach)


def run_cases():
    global case,completed
    case='initial protected boot masks folded hidden controls before any RAF'
    context,page=boot(corrupt=True);baseline=raw(page)
    check('protected boot stays on overview with both libraries folded',page.locator('[data-tab-panel="overview"]').is_visible() and not page.locator('#research-templates').evaluate('(e)=>e.open') and not page.locator('#fleet-formations').evaluate('(e)=>e.open'))
    protected_masks(page)
    check('protected boot does not build hidden library or order rows',page.locator('#formation-library article,#template-library article,#order-list article').count()==0)
    clear_updates(page)
    page.evaluate('''() => {
      for(const id of ['formation-new','template-new']){const button=document.getElementById(id);button.disabled=false;button.click();button.disabled=true;}
      for(const id of ['order-form','formation-editor','template-editor'])document.getElementById(id).dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true}));
      window.__renderProbe.autosave();
    }''')
    check('initial protected forced clicks/submits grant no editor authority',page.locator('#formation-editor').is_hidden() and page.locator('#template-editor').is_hidden())
    check('initial protected replay never writes or paints',raw(page)==baseline and updates(page)==0 and not any(row['type']=='write' for row in page.evaluate('window.__renderProbe.snapshot().events')))
    context.close()

    for failure in ('autosave-write','import-readback'):
        case=failure+': hidden mode transition masks controls without projection'
        context,page=boot();retain_ready_controls(page);tab(page,'save')
        incoming=copy.deepcopy(fixtures['incoming']);incoming['savedAt']=incoming['lastTickAt']=EPOCH+1
        page.locator('#transfer').fill(json.dumps(incoming,ensure_ascii=False));frame(page)
        page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
        baseline=raw(page);clear_updates(page)
        page.evaluate('window.__renderProbe.advance(1)')
        page.evaluate('fault=>window.__renderProbe.fault(fault)','write' if failure=='autosave-write' else 'drop')
        if failure=='autosave-write':page.evaluate('window.__renderProbe.autosave()')
        else:click(page,'[data-action="import-text"]',flush=False)
        protected_masks(page)
        check('transition injected an actual current-slot write failure',any(row['type']=='write' and row['injected'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
        check('hidden protection preserves every mounted node and draft value',page.evaluate('''() => {
          const {selector,body,nodes}=window.__maskNodes,current=[...document.querySelectorAll(selector)];
          return document.body===body&&current.length===nodes.length&&nodes.every(({node,value},i)=>current[i]===node&&node.value===value);
        }'''))
        check('hidden protection requires no original body projection or RAF',updates(page)==0)
        writes=len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])
        replay_protected_controls(page)
        check('forced protected controls and submissions never write or change native bytes',raw(page)==baseline and len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])==writes)
        check('forced protected replay still performs no original projection',updates(page)==0)
        page.evaluate('window.__renderProbe.fault(null)')
        page.evaluate('window.__renderProbe.autosave()')
        protected_masks(page)
        check('clearing storage fault does not implicitly recover authority',raw(page)==baseline)
        click(page,'[data-action="import-text"]',flush=False)
        check('explicit verified import recovers the complete incoming state',saved(page)==expected_state('incoming.initial'))
        check('recovery masks retire old editor and review authority before a paint',page.locator('#template-save').is_disabled() and page.locator('#formation-save').is_disabled() and page.locator('#formation-confirm-replenish').is_disabled() and page.locator('#template-confirm-apply').is_disabled())
        check('recovery restores only fresh entry controls without hidden lists',page.locator('#template-new').is_enabled() and page.locator('#formation-new').is_enabled() and page.locator('#order-create').is_enabled() and page.locator('#order-transport-fields input,#order-transport-fields select').evaluate_all('(xs)=>xs.every(x=>x.disabled)') and page.locator('#formation-library article,#template-library article,#order-list article').count()==0)
        recovered=raw(page);writes=len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])
        replay_protected_controls(page,reattach=True)
        check('reattached originals, clones and retired draft submissions have no recovered authority',raw(page)==recovered and len([row for row in page.evaluate('window.__renderProbe.snapshot().events') if row['type']=='write'])==writes)
        check('recovery and stale replay never project while document is hidden',updates(page)==0)
        page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
        tab(page,'orders');click(page,'#order-create')
        check('visible retired order draft still needs explicit new authority',raw(page)==recovered)
        click(page,'#order-new');click(page,'#order-create')
        check('explicit fresh order draft creates exactly one plan after recovery',len(saved(page)['orders']['tasks'])==len(fixtures['expected']['incoming.initial']['orders']['tasks'])+1)
        click(page,'#template-new');check('explicit new template alone restores its editor',page.locator('#template-save').is_enabled())
        forms(page);click(page,'#formation-new');check('explicit new formation alone restores its editor',page.locator('#formation-save').is_enabled())
        context.close()

    for name in ('steady60','steady120','actions'):
        case='before/after identical controlled trace '+name
        before,count_before=differential_trace(name,args.before_url)
        after,count_after=differential_trace(name,args.url)
        check('trace metadata retains its original migration boundary even after new payments',assert_zero_grant_metadata(after,before,grant_job_floor=fixtures['base']['state']['orders']['nextJobId'],npc_wallet=expected_npc_wallet(name)))
        check('every archived field matches on identical trace with only exact r9/r10/r11/r14 metadata',exact_state(after,lift_r8_state(before,fixtures['base']['state']['orders']['nextJobId'],npc_wallet=expected_npc_wallet(name))))
        if name.startswith('steady'):
            check('old bundle updates on every requested frame',count_before==len(fixtures['traces'][name]))
            check('ordinary latest-only rendering is bounded at 10Hz',18<=count_after<=21,{'before':count_before,'after':count_after})
            check('render coalescing does not alter any serialized field',before==fixtures['expected'][name])

    case='visible panel parity against unchanged archived full projection'
    snapshots={}
    tabs=('overview','facilities','research','shipyard','defense','darkmatter','protocol','curvature','achievements','save','orders','galaxy','fleet','messages','deep','arcade')
    for label,url in [('before',args.before_url),('after',args.url)]:
        context,page=boot(url=url);snapshots[label]={}
        release=context.request.get(urljoin(url,'release.json'))
        check('served parity release manifest is available',release.status==200)
        expected_version='0.6.7-alpha.1' if label=='before' else CURRENT_PACKAGE_VERSION
        check('served version is the explicit expected before/after metadata',release.json()['version']==expected_version)
        check('served save revision matches the exact before/after reader metadata',release.json()['saveRevision']==(8 if label=='before' else CURRENT_REVISION))
        check('only current bundle has the exact default-folded new building region',page.locator('#building-templates').count()==(1 if label=='after' else 0))
        if label=='after':
            check('new building region is last and folded with original explanatory text',page.locator('#building-templates').evaluate('(node)=>node.parentElement.id==="space-orders"&&node.parentElement.lastElementChild===node&&!node.open') and page.locator('#building-templates > summary').text_content()=='建筑意图模板 · 保存目标，按需创建有限计划')
        # Observe the new reader's migration above, then perform the same genuine
        # manual save on both bundles. This sets the same status through real UI
        # work; no status text or other visible field is projected away.
        whole(page,'base.initial','paired visible review starts from identical historical state after a real manual save')
        for name in tabs:
            button=page.locator(f'[data-tab="{name}"]')
            if button.is_hidden():continue
            tab(page,name);snapshots[label][name]=snapshot(page, label=='after' and name=='orders', label if name=='arcade' else None, label if name=='orders' else None, label if name=='facilities' else None, label if name=='research' else None, npc_base=label if name in ('shipyard','defense','galaxy','fleet','messages') else None)
            if name=='galaxy':
                # The intentional package version change is the only galaxy
                # exception. Restrict normalization to the exact #space-range
                # paragraph, never to names, controls or arbitrary panel text.
                range_text=page.locator('#space-range').inner_text();token='v'+expected_version
                check('galaxy phase has exactly its verified release version token',range_text.count(token)==1)
                check('visible galaxy snapshot contains exact phase paragraph once',snapshots[label][name]['text'].count(range_text)==1)
                normalized=range_text.replace(token,'v<verified-release-version>',1)
                snapshots[label][name]['text']=snapshots[label][name]['text'].replace(range_text,normalized,1)
            if name=='save':
                revision=8 if label=='before' else CURRENT_REVISION
                paragraph=page.locator('[data-tab-panel="save"] p').first.inner_text()
                cap=page.locator('[data-tab-panel="save"] p [data-bind="offline-cap"]').inner_text()
                expected_paragraph=(f'原版 P4 开发存档使用独立位置，不读取或覆盖线上版本。接受 schema=infinity-original-p4 的 v9 / r{revision} 存档；'
                    f'有效 r2–r{revision-1} 先备份后升级，仅 r2 / r3 的旧自动跑灯授权不会沿用。v8 和其他分支格式不会导入。'
                    '读取失败时保留原件并暂停保存，可用“导出”取回。离线进度最多结算 '+cap+'。')
                check('entire save metadata paragraph is the exact original text with its verified revision values',paragraph==expected_paragraph)
                tokens={f'v9 / r{revision} 存档': 'v9 / r<current> 存档',
                        f'有效 r2–r{revision-1} 先备份后升级': '有效 r2–r<previous> 先备份后升级'}
                normalized=paragraph
                for token,replacement in tokens.items():
                    check('save notice contains its exact supported revision metadata once',paragraph.count(token)==1)
                    normalized=normalized.replace(token,replacement,1)
                check('visible save snapshot contains the complete metadata paragraph once',snapshots[label][name]['text'].count(paragraph)==1)
                snapshots[label][name]['text']=snapshots[label][name]['text'].replace(paragraph,normalized,1)
            if name in ('orders','fleet'):
                details_id='research-templates' if name=='orders' else 'fleet-formations'
                new_id='template-new' if name=='orders' else 'formation-new'
                check('folded library controls are absent from actual-visible snapshot: '+details_id,
                      not any(control['id']==new_id for control in snapshots[label][name]['inputs']))
                click(page,f'#{details_id} > summary')
                check('native summary opens library for full visible parity: '+details_id,
                      page.locator('#'+details_id).evaluate('(element)=>element.open'))
                opened=snapshot(page, label=='after' and name=='orders', order_base=label if name=='orders' else None,npc_base=label if name=='fleet' else None)
                check('opened library controls enter the complete paired snapshot: '+details_id,
                      any(control['id']==new_id for control in opened['inputs']) and
                      len(opened['inputs'])>=len(snapshots[label][name]['inputs'])+4)
                snapshots[label][name+'-library-open']=opened
                click(page,f'#{details_id} > summary')
                check('library returns to folded state after parity observation: '+details_id,
                      not page.locator('#'+details_id).evaluate('(element)=>element.open'))
                click(page,f'#{details_id} > summary')
                reopened=snapshot(page, label=='after' and name=='orders', order_base=label if name=='orders' else None,npc_base=label if name=='fleet' else None)
                check('closed then reopened library retains complete visible snapshot: '+details_id,reopened==opened)
                snapshots[label][name+'-library-reopened']=reopened
                click(page,f'#{details_id} > summary')
        whole(page,'base.initial','read-only navigation leaves complete engine state unchanged');context.close()
    (out/'panel-parity-all.json').write_text(json.dumps(snapshots,ensure_ascii=False,indent=2))
    # Retain all paired mismatches before asserting the first one. Unknown
    # differences still fail the original exact comparator without filtering.
    for name in snapshots['before'].keys() & snapshots['after'].keys():
        if snapshots['before'][name]!=snapshots['after'][name]:
            (out/f'panel-parity-{name}.json').write_text(json.dumps({key:value[name] for key,value in snapshots.items()},ensure_ascii=False,indent=2))
    check('both bundles expose the same unlocked panels',set(snapshots['before'])==set(snapshots['after']))
    for name in snapshots['before']:
        equal=snapshots['before'][name]==snapshots['after'][name]
        check('fresh visible text/control parity: '+name,equal)
    differentials.append({'kind':'visible-panel-parity','tabs':list(snapshots['after'])})

    case='capture-stopped navigation and initial fixed payer defaults'
    context,page=boot()
    check('hidden extension heavy fleet rows are not eagerly projected',page.locator('#space-fleets [data-flight]').count()==0)
    page.locator('#planet-select').select_option(COLONY);frame(page)
    tab(page,'orders')
    check('first hidden orders visit preserves startup payer',page.locator('#order-planet').input_value()==HOME)
    check('first hidden orders visit preserves startup donor',page.locator('#order-donor').input_value()==COLONY)
    check('first hidden orders visit preserves real preferred donor ship',page.locator('#order-ship').input_value()=='large_cargo')
    page.locator('#order-transport-enabled').check(force=True);frame(page)
    page.locator('#order-budget-metal').fill('12345');frame(page)
    check('capture-stopped input updates visible review on next RAF','12345' in page.locator('#order-review').inner_text())
    tab(page,'galaxy');page.locator('#browse-system').fill('52');click(page,'[data-space="browse"]')
    check('capture-stopped galaxy browse refreshes rendered actual cursor',':52:' in page.locator('#space-worlds').inner_text())
    tab(page,'fleet');check('fresh navigation projects real in-flight row',page.locator('#space-fleets [data-flight]').count()==1)
    check('native navigation event path is trusted',any(row['type']=='click' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    context.close()

    case='folded details, focus, selection and actual composition survive paints'
    context,page=boot();forms(page);click(page,'#formation-new')
    name=page.locator('#formation-name');name.fill('保存中的中文草稿');name.focus()
    name.evaluate('(e)=>{window.__focusedDraft=e;e.setSelectionRange(2,5);}')
    for at in (17,34,50,101,150,201):frame(page,at)
    check('paint preserves focused input identity',name.evaluate('(e)=>e===window.__focusedDraft&&document.activeElement===e'))
    check('paint preserves selection and draft',name.evaluate('(e)=>e.selectionStart===2&&e.selectionEnd===5&&e.value==="保存中的中文草稿"'))
    cdp=context.new_cdp_session(page)
    cdp.send('Input.imeSetComposition',{'text':'中文输入','selectionStart':4,'selectionEnd':4})
    composing=name.input_value();frame(page,220);frame(page,310)
    check('actual IME composition text and focus survive scheduled projection',name.input_value()==composing and name.evaluate('(e)=>document.activeElement===e'))
    cdp.send('Input.insertText',{'text':'中文输入'});frame(page)
    check('composition events were genuine browser events',any(row['type']=='compositionstart' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    cdp.detach()
    click(page,'#fleet-formations > summary');check('native details closes',not page.locator('#fleet-formations').evaluate('(e)=>e.open'))
    frame(page,450);click(page,'#fleet-formations > summary')
    check('native details reopens without losing draft identity',page.locator('#fleet-formations').evaluate('(e)=>e.open') and name.evaluate('(e)=>e===window.__focusedDraft'))
    # True native implicit form submission exercises default action after click/keydown.
    name.fill('原生键盘提交编成');page.locator('[data-formation-unit="small_cargo"]').fill('2')
    name.press('Enter');frame(page)
    check('native keyboard form default action creates exactly one design',len(saved(page)['formations']['entries'])==2)
    context.close()

    case='fresh explicit preview sees state adopted between ordinary paint deadlines'
    context,page=boot('fresh');tab(page,'orders');click(page,'#research-templates > summary')
    click(page,'[data-template-id="1"] [data-template-action="select"]')
    page.locator('#template-payer').select_option(HOME);frame(page)
    frame(page,60)
    click(page,'#template-review')
    check('fresh review sees actual completed research','已达成' in page.locator('#template-review-rows').inner_text() or page.locator('[data-template-map-tech="energy_tech"]').get_attribute('data-template-map-status')=='achieved')
    whole(page,'fresh60');context.close()

    case='native pointer held across paid-head rollover cannot purchase newer head'
    context,page=boot('rollover');tab(page,'research')
    button=page.locator('[data-tab-panel="research"] [data-action="dm-speedup"][data-target="research"][data-mode="halve"]').first
    expect(button).to_be_enabled();button.evaluate("e=>e.scrollIntoView({block: 'center'})");box=button.bounding_box()
    check('old head speedup has a native pointer target',box is not None)
    page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down()
    frame(page,60);page.mouse.up();frame(page)
    whole(page,'rollover60','head-rollover pointer sequence does not spend on replacement work');context.close()

    case='synthetic hidden page skips projection and resumes latest engine state'
    context,page=boot();clear_updates(page)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    frame(page,40);frame(page,80)
    check('hidden page performs no original view update',updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    check('visibility resume paints latest snapshot immediately',updates(page)==1)
    whole(page,'hidden');context.close()

    case='locked persisted original tab projects fallback on initial render'
    context,page=boot('locked',initial_tab='research')
    expect(page.locator('[data-tab-panel="facilities"]')).to_be_visible()
    check('fallback facilities has fresh actual level text',bool(page.locator('[data-bind="level-metal_mine"]').inner_text()))
    whole(page,'locked.initial');context.close()

    for replacement in ('automatic-skipped','same-id-import','reset'):
        case=replacement+': adoption retires old hidden authority'
        context,page=boot('automatic' if replacement=='automatic-skipped' else 'base');arm_old(page);tab(page,'overview')
        if replacement=='automatic-skipped':
            for n in range(1,10):frame(page,n*1000)
            frame(page,9950);frame(page,10000)
            expected='automatic.skipped'
        elif replacement=='same-id-import':import_text(page);expected='incoming.initial'
        else:
            tab(page,'save');page.once('dialog',lambda dialog:dialog.accept());click(page,'[data-action="reset"]');expected=None
        before=save(page)
        if expected:check('replacement equals complete independent engine result',before==expected_state(expected))
        replay_old(page)
        check('retired original and cloned controls have no effect',save(page)==before)
        check('adoption clears old dispatch fill',page.locator('[data-ship="small_cargo"]').input_value()=='0')
        context.close()

    case='hidden automatic adoption retires old capabilities before any visible paint'
    context,page=boot('automatic');arm_old(page);tab(page,'overview')
    for n in range(1,10):frame(page,n*1000)
    frame(page,9950)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    clear_updates(page);frame(page,10000)
    check('automatic adoption occurs while original view painting is actually suppressed',updates(page)==0)
    page.evaluate('''() => {
      const root=document.querySelector('#fleet-formations');
      for(const old of window.__retiredControls){root.append(old);old.disabled=false;old.click();const clone=old.cloneNode(true);root.append(clone);clone.disabled=false;clone.click();}
    }''');frame(page)
    check('hidden retired-capability replay never forces a paint',updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    whole(page,'automatic.skipped','retirement occurred before the first visible post-adoption paint')
    context.close()

    case='navigation-only invalidation does not cancel delayed native file import'
    context,page=boot();tab(page,'save');page.evaluate('window.__renderProbe.gate()')
    before_confirmations = confirmation_count(page)
    page.locator('[data-bind="import-file"]').set_input_files({'name':'delayed-native.json','mimeType':'application/json','buffer':json.dumps(fixtures['incoming'],ensure_ascii=False).encode()})
    page.wait_for_function('window.__renderProbe.files[0]?.ready&&typeof window.__renderProbe.files[0].release==="function"',polling=20)
    for name in ('galaxy','orders','fleet','overview'):tab(page,name)
    check('pending file and ordinary navigation never confirm before read completion', confirmation_count(page) == before_confirmations)
    # This scenario runs on args.url only. Archived before traces never install
    # an import handler, so a later reset cannot accidentally consume one.
    file_dialogs = accept_file_confirmation(page, fixtures['incoming'], saved(page))
    page.evaluate('window.__renderProbe.files[0].release()')
    page.wait_for_function('document.querySelector("[data-bind=\\"status\\"]")?.textContent.includes("已导入")',polling=20)
    check('current navigation-only file asks exactly one replacement confirmation', len(file_dialogs) == 1 and confirmation_count(page) == before_confirmations + 1)
    frame(page);whole(page,'incoming.initial');context.close()

    case='labeled injected save failure freezes simulation and bounds protected painting'
    context,page=boot();tab(page,'save');baseline=raw(page)
    # Migration already wrote canonical r14 at time zero. Re-saving identical
    # bytes is a legitimate no-op, so make only the save envelope 1 ms newer.
    before_events=page.evaluate('window.__renderProbe.snapshot().events')
    page.evaluate('window.__renderProbe.advance(1)')
    check('fault preparation advances no RAF or persisted game state',raw(page)==baseline and page.evaluate('window.__renderProbe.snapshot().events')==before_events)
    page.evaluate('window.__renderProbe.fault("write")')
    click(page,'[data-action="save"]');status=page.locator('[data-bind="status"]').inner_text()
    injected=[event for event in page.evaluate('window.__renderProbe.snapshot().events')[len(before_events):] if event['type']=='write' and event['injected']]
    check('the labelled current-slot setItem fault actually executes once in its own phase',len(injected)==1 and injected[0]['at']==1 and injected[0]['key']==KEY and injected[0]['fault']=='write')
    check('native delegated Storage fault exposes protection','失败' in status or '无法' in status or '暂停' in status)
    clear_updates(page)
    for at in (17,34,51,100,200,1000):frame(page,at)
    check('unchanged protected screen does not repaint every RAF',updates(page)==0)
    check('protected failure keeps exact native stored bytes',raw(page)==baseline)
    context.close()

    case='genuine cross-tab storage event immediately protects current authority'
    context,page=boot();retain_ready_controls(page);tab(page,'overview');baseline=raw(page)
    page.evaluate('''() => {Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));}''')
    clear_updates(page)
    other=context.new_page();attach(other);other.goto(args.url,wait_until='networkidle')
    import_text(other);page.bring_to_front()
    page.wait_for_function('window.__renderProbe.snapshot().events.some(row=>row.type==="storage"&&row.trusted)',polling=20)
    protected_masks(page)
    check('trusted storage conflict masks hidden controls without any original projection',updates(page)==0)
    replacement=raw(page);replay_protected_controls(page)
    check('hidden conflict rejects forced old controls without overwriting replacement',raw(page)==replacement and updates(page)==0)
    page.evaluate('''() => {delete document.hidden;delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));}''');frame(page)
    expect(page.locator('[data-bind="status"]')).to_contain_text('其他标签页')
    check('cross-tab event is actual trusted browser storage event',any(row['type']=='storage' and row['trusted'] for row in page.evaluate('window.__renderProbe.snapshot().events')))
    frozen=page.locator('[data-bind="amount-metal"]').text_content();clear_updates(page);frame(page,1000)
    check('cross-tab protected frames remain frozen without repaint loop',updates(page)==0 and page.locator('[data-bind="amount-metal"]').text_content()==frozen)
    check('other tab committed a replacement rather than copied old bytes',raw(page)!=baseline)
    context.close()

    case='original arcade every-RAF path and exact single/batch reward settlement'
    context,page=boot('ring');tab(page,'arcade');clear_updates(page)
    for _ in range(60):frame(page)
    check('visible idle original arcade receives every RAF including attract mode',updates(page)==60)
    click(page,'[data-action="arcade-run"]')
    check('manual single reward commits exactly once',saved(page)==expected_state('ring.single'))
    # Original animator may disable its button while showing the result. Advancing
    # zero engine time still gives every original RAF; use the separate all case
    # rather than fabricate animation completion or force a disabled control.
    whole(page,'ring.single');context.close()
    context,page=boot('ring');tab(page,'arcade');click(page,'[data-action="arcade-all"]')
    check('manual batch reward commits exactly once',saved(page)==expected_state('ring.all'))
    for _ in range(20):frame(page)
    whole(page,'ring.all','repeated original animation frames never settle rewards twice');context.close()

    case='suite integrity'
    check('no JavaScript page errors',not errors)
    check('no failed production requests',not failed_requests)
    completed=True


with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
    try:run_cases()
    except BaseException:
        diagnostics={'case':case}
        if active_page is not None and not active_page.is_closed():
            try:
                diagnostics['probe']=active_page.evaluate('window.__renderProbe.snapshot()')
                diagnostics['status']=active_page.locator('[data-bind="status"]').all_text_contents()
                diagnostics['stored']=raw(active_page)
                cdp=active_page.context.new_cdp_session(active_page)
                shot=cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True})
                (out/'render-scheduling-failure.png').write_bytes(base64.b64decode(shot['data']));cdp.detach()
            except Exception as error:diagnostics['captureError']=str(error)
        raise
    finally:
        report={'completed':completed,'mode':MODE,'url':args.url,'beforeUrl':args.before_url,'fixture':fixtures['description'],
            'stateSchemaAddition':'Actual r8 source input is migrated by the current reader; every old state field stays exact; empty buildingTemplates, fixed migration floor and zero per-planet grant ledgers are independently asserted. Before visible snapshots, both bundles perform the same genuine manual save; all status text remains compared.',
            'parityMetadataException':f'Only the exact galaxy package-version token (verified releases 0.6.7-alpha.1 / {CURRENT_PACKAGE_VERSION}, with current version independently loaded from package.json) and the two exact save-notice current/previous revision tokens (verified r8/r7 and r14/r13) are normalized. The exact final closed #building-templates summary is separately asserted and omitted only from the paired orders snapshot; its independent browser suite checks the new region. Outside the separately recorded manual-first ring, exact initial order-quote, final terraformer option, IRN-copy and precisely asserted demolition-control additions, complete paragraph boundaries, all other visible text, status, and controls remain exact. New NPC metadata is independently checked against fixed-old-engine adopted segment witnesses before every old-state comparison.',
            'parityNpcDisplayException':'The copied r8 base comparison retains every original message HTML node, text, time, and order. Only independently bound keyed old scout unavailable notices and the exact initial hidden rehearsal region are removed after full node-count/order/HTML/control-value checks; typed observations cannot use this projection. The copied evidence records all hidden data. Current state receives only validated null snapshot fields, and raw bytes, DOM and clock remain unchanged.',
            'parityResearchException':'At the complete unchanged historical base state, completed IRN is exactly zero, both labs are exactly level two, and only the literal paid active energy-1 job exists. Only the exact obsolete IRN later paragraph text becomes empty. Both complete old/new nodes, unique sibling boundaries, unchanged active detail and all sixteen ordered cards/actions are asserted before copied-evidence normalization. Full remaining research DOM, every price/time/control/attribute and whole state compare exactly; raw before/after evidence is retained. No queue detail or time exception applies to this base fixture.',
            'parityShipyardDefenseException':'Only each complete literal old/new NPC explanation in the unique p.blurb introductory node is compared through a copied-text adapter. Its exact class, native heading/queue/grid/status sibling identities, order and counts are asserted; the complete remaining panel DOM, all visible controls, queue/card content, costs, timers, status, stored state and controlled time remain exact. Every raw panel is saved before adapters and all paired snapshots/mismatches before the first parity assertion.',
            'parityTerraformerException':'Only the uniquely identified final terraformer card is excluded after complete old-state, unmet prerequisite, zero-supply, ordered old-card, exact full added DOM/text/cost/time and disabled-button identity checks. Raw panel/state evidence and complete remaining facilities DOM are retained and compared; no other facility text or controls are removed.',
            'parityRingException':'Only the exact base manual-first UI difference is excluded: before complete default-unauthorized section.ring-auto and after exact visible #ring-manual-progress 0/10. Complete state, all five old controls (including data-ring button identities), hidden/disabled new region, exact node structure/text and unique adjacent sibling boundaries are checked first. Raw snapshots, complete panel DOM and stored bytes are retained in panel-parity-arcade-before-raw.json and panel-parity-arcade-after-raw.json. All remaining text/controls plus board, manual controls, stakes, queue, odds, history and status DOM remain exact; no DOM, state, storage or clock mutation is used to obtain parity.',
            'parityOrderQuoteException':'Only the uniquely placed initial #order-quote region is excluded after exact DOM, literal text, two-button permission, zero-cap and full-base-state assertions. Before/after raw snapshots are retained. Budgets, existing create/transport controls and all remaining visible content remain exact. No DOM or state is rewritten.',
            'parityOrderTargetException':'The same guarded adapter covers folded, open and reopened orders-library snapshots. Both unique native selects retain the original building kind and metal_mine default, exact literal ordered values/text/selected/disabled properties and complete original HTML. Only the current fourteenth final terraformer option, after the thirteen unchanged legacy choices, is omitted from copied evidence inside its uniquely verified kind/target/goal text boundary. Full remaining form-row DOM, all visible snapshot fields and state compare exactly. Each raw capture retains native option/identity witnesses; live DOM, storage and controlled time remain unchanged.',
            'counterMeaning':'Native DOMTokenList.toggle delegated energy-chip update calls, one per unchanged original view.update. These are instrumented render invocation counts, never CPU/presentation timings.',
            'scope':'New controlled scheduler coverage supplements, never replaces, original 13 suites and Stage6A accounted-clock controlled/native-background suites. Native performance belongs exclusively to browser-presentation-performance.py.',
            'environment':{'platform':platform.platform(),'python':platform.python_version(),'browser':browser.version},
            'passed':sum(row['passed'] for row in checks),'checks':checks,'errors':errors,'failedRequests':failed_requests,
            'differentials':differentials,'audit':audits,'parityRawCaptures':parity_captures,'failureDiagnostics':diagnostics}
        (out/'render-scheduling-browser-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':completed,'passed':report['passed'],'total':len(checks),'failedCase':None if completed else case},ensure_ascii=False))
        browser.close()
