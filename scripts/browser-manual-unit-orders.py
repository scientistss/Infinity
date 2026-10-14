"""CI-only native two-stage manual ship/defense order acceptance.
The original immutable 241a natural driver is run fresh by this job. Its unchanged
05/09 handoffs seed anonymous contexts. Every later natural payment is actual UI
input and every natural funding/completion step is a controlled one-second tick.
Unlocked, hostile DOM and capacity cases are explicitly synthetic. No mock app,
request interception, internal game-state access, or new quote import is used.
Functional Date/performance/RAF and actual host/native-frame clocks are distinct.
"""
import argparse
from r16_compatibility import lift_r14_state_to_r16
import ast
import copy
import hashlib
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
CANDIDATE_VERSION = '0.6.32-alpha.1'
OLD_SHA = '241a51de31364e9086abcc304884bf9df7cd6912'
REPORT_SHA = '9102da6f8fc52427b642883389d186726a8cf0c02747aa6c135150566458d8ea'
WIDTHS = (320, 390, 768, 1440)
RESOURCES = ('metal', 'crystal', 'deuterium')
SOURCE_AREAS = ('src', 'scripts', 'tests', 'public', '.github')
INVALID = ('', '0', '-1', '1.5', '1e3', 'NaN', 'Infinity', '9' * 512, '9007199254740992')
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'solar_satellite', 'colony_ship')
# Fixed exhaustive partition, not a user-selectable case/unit filter.
GROUP_UNITS = {
 'payments': ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'solar_satellite', 'colony_ship'),
 'authority': ('rocket_launcher', 'light_laser', 'heavy_laser', 'gauss_cannon', 'ion_cannon', 'plasma_turret', 'small_shield_dome', 'large_shield_dome', 'anti_ballistic_missile', 'interplanetary_missile'),
}
GROUP_CASES = {
 'payments': ('natural05-real-count-fill-max-payments', 'natural09-paid-flight-does-not-cover-fill')
   + tuple('SYNTHETIC-all24-'+unit for unit in GROUP_UNITS['payments'])
   + ('SYNTHETIC-native-trim-leading-zero-raw-preserved',)
   + tuple('SYNTHETIC-full-canonical-price-width-'+str(width) for width in WIDTHS),
 'authority': tuple('SYNTHETIC-all24-'+unit for unit in GROUP_UNITS['authority']) + (
   'SYNTHETIC-reject-queue-full-small_cargo', 'SYNTHETIC-reject-insufficient-small_cargo', 'SYNTHETIC-reject-unit-cap-small_cargo',
   'SYNTHETIC-reject-owned-small_shield_dome-small_shield_dome', 'SYNTHETIC-reject-owned-large_shield_dome-large_shield_dome',
   'SYNTHETIC-reject-queued-small_shield_dome-small_shield_dome', 'SYNTHETIC-reject-queued-large_shield_dome-large_shield_dome',
   'SYNTHETIC-reject-silo-39-interplanetary_missile', 'SYNTHETIC-reject-silo-40-anti_ballistic_missile', 'SYNTHETIC-reject-silo-40-interplanetary_missile',
   'SYNTHETIC-silo39-one-slot-abm-succeeds', 'SYNTHETIC-latest-plan-retires-old-max', 'SYNTHETIC-latest-plan-retires-old-fill',
   'SYNTHETIC-authority-tab-away', 'SYNTHETIC-authority-switch-planet-return', 'SYNTHETIC-authority-same-id-import', 'SYNTHETIC-authority-reset',
   'SYNTHETIC-authority-duplicate', 'SYNTHETIC-authority-detach', 'SYNTHETIC-authority-detach-reinsert', 'SYNTHETIC-authority-crosslabel',
   'SYNTHETIC-authority-ancestor-reinsert', 'SYNTHETIC-authority-quote-hidden', 'SYNTHETIC-authority-total-hidden',
   'SYNTHETIC-authority-quote-hide-show', 'SYNTHETIC-authority-ancestor-hide-show', 'SYNTHETIC-authority-class-hide-show',
   'SYNTHETIC-authority-style-visibility-hide-show', 'SYNTHETIC-authority-quote-text-tamper', 'SYNTHETIC-authority-total-text-tamper',
   'SYNTHETIC-authority-same-text-hidden-child', 'SYNTHETIC-cancelled-import-retires-visible-quote', 'SYNTHETIC-failed-import-retires-visible-quote',
   'SYNTHETIC-real-cross-tab-protection', 'SYNTHETIC-consumed-native-hidden-resume'),
}
INFRASTRUCTURE_CASES = ('setup', 'suite-integrity')
GROUP_JOBS = {'payments':'manual-unit-payments', 'authority':'manual-unit-authority'}
RUNTIME_KEYS = {'githubRunId':'GITHUB_RUN_ID','githubRunAttempt':'GITHUB_RUN_ATTEMPT','githubJob':'GITHUB_JOB',
 'githubWorkflow':'GITHUB_WORKFLOW','githubSha':'GITHUB_SHA','githubRef':'GITHUB_REF','githubRepository':'GITHUB_REPOSITORY'}
# Independent literal ordinary-flight form census; solar satellites cannot fly.
TRANSIT_FLYING_IDS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'colony_ship')
GOLDEN = {
 'small_cargo':(2000,2000,0),'large_cargo':(6000,6000,0),'light_fighter':(3000,1000,0),'heavy_fighter':(6000,4000,0),
 'cruiser':(20000,7000,2000),'battleship':(45000,15000,0),'battlecruiser':(30000,40000,15000),'bomber':(50000,25000,15000),
 'destroyer':(60000,50000,15000),'deathstar':(5000000,4000000,1000000),'recycler':(10000,6000,2000),'espionage_probe':(0,1000,0),
 'solar_satellite':(0,2000,500),'colony_ship':(10000,20000,10000),'rocket_launcher':(2000,0,0),'light_laser':(1500,500,0),
 'heavy_laser':(6000,2000,0),'gauss_cannon':(20000,15000,2000),'ion_cannon':(2000,6000,0),'plasma_turret':(50000,50000,30000),
 'small_shield_dome':(10000,10000,0),'large_shield_dome':(50000,50000,0),'anti_ballistic_missile':(8000,0,2000),'interplanetary_missile':(12500,2500,10000)}
HOST_STARTED = time.monotonic()


def load_reviewed_helpers():
    """Definitions only; old runner top-level code and CLI cannot execute."""
    groups = {
      'browser-npc-attack.py': {'atomic_json','NativeCheckJournal','exact_json','visibility','text_leaf_visibility',
        'wait_for_scroll_settled','native_scroll_to','scroll_region_state','attach','select','import_confirmation'},
      'browser-rehearsal-formation-copy.py': {'scenario_directory','publish_new_bytes','publish_new_json','verify_file_references'},
      'browser-lab-blockers.py': {'source_identity'},
    }
    for filename, names in groups.items():
        tree = ast.parse((ROOT/'scripts'/filename).read_text())
        nodes = [n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
        if {n.name for n in nodes} != names: raise RuntimeError('Reviewed helper contract changed: '+filename)
        exec(compile(ast.Module(body=nodes,type_ignores=[]),'<reviewed-manual-unit-helpers>','exec'),globals())


def independent_total(unit, count):
    if unit not in GOLDEN or type(count) is not int or not 1 <= count <= 1000000: raise ValueError('Invalid independent price request')
    return {resource:str(GOLDEN[unit][index]*count) for index,resource in enumerate(RESOURCES)}


def independent_fill(state, unit, target):
    planet = next(p for p in state['planets'] if p['id']==state['activePlanetId'])
    # Only completed local stock and this planet's paid remaining queue count.
    return max(0,target-planet['units'][unit]-sum(j['count'] for j in planet['shipyardQueue'] if j['unit']==unit))


def b(name, unit): return f'[data-bind="{name}-{unit}"]'
def mode_selector(unit, mode): return f'[data-action="manual-unit-mode"][data-id="{unit}"][data-mode="{mode}"]'
def unit_tab(unit): return 'shipyard' if unit in SHIPS else 'defense'
def digest(body): return hashlib.sha256(body).hexdigest()


def runtime_identity():
    return {name:os.environ.get(env) for name,env in RUNTIME_KEYS.items()}


def valid_runtime_identity(group,value,expected_sha):
    return (group in GROUP_JOBS and isinstance(value,dict) and set(value)==set(RUNTIME_KEYS)
      and all(isinstance(item,str) and item for item in value.values())
      and value['githubJob']==GROUP_JOBS[group] and value['githubSha']==expected_sha)


def metadata():
    return {'schema':'infinity-manual-unit-native-v2','completed':completed,'result':'passed' if completed else 'incomplete',
      'group':args.group,'fixtureSha256':fixture_sha256,'sourceBindingSha256':source_binding_sha256,'runtimeNode':args.runtime_node,'sourceIdentity':source_identity_value,
      'runtimeIdentity':runtime_identity(),
      'caseCensus':case_census(),'releaseMetadata':release_metadata,'failureLifecycle':failure_lifecycle,
      'sourceSha':args.expected_sha,'candidateVersion':CANDIDATE_VERSION,'case':case,'checks':checks,'evidence':evidence,
      'sourceBindings':source_bindings,'errors':errors,'failedRequests':failed_requests,'failure':failure,
      'timing':{'hostElapsedSeconds':time.monotonic()-HOST_STARTED,'functionalAdvanceCalls':clock_calls,'functionalSeconds':clock_seconds},
      'classification':'Fresh immutable241a natural05/09 handoffs, actual native trusted input, unchanged HTTP/V8 production app. Controlled functional clocks. Explicit synthetic edges are separate; no wall-clock play or performance claim.',
      'acceptanceRule':'Two required fixed-partition manual-unit jobs. Their disjoint scenario union is the original complete suite; all existing five jobs and required aggregate remain mandatory on the same SHA.'}


def flush(final=False):
    global recorded_checks, recorded_evidence
    while recorded_evidence < len(evidence):
        journal.append('evidence',{'index':recorded_evidence,'record':evidence[recorded_evidence]}); recorded_evidence+=1
    while recorded_checks < len(checks):
        journal.append('check',{'index':recorded_checks,'record':checks[recorded_checks]}); recorded_checks+=1
    atomic_json(out/'manual-unit-progress.json',{'completed':completed,'group':args.group,'case':case,'phase':case_records[-1]['phase'] if case_records else None,'completedCases':[r['name'] for r in case_records if r['kind']=='scenario' and r['status']=='completed'],'checks':len(checks),'evidence':len(evidence),'elapsed':time.monotonic()-HOST_STARTED})
    if final:
        value=metadata(); verify_file_references(value)
        publish_new_json(out/'manual-unit-browser-report.json',value)
        journal.append('seal',{'reportSha256':digest((out/'manual-unit-browser-report.json').read_bytes()),'checkCount':len(checks),'evidenceCount':len(evidence),'recursiveReferencesVerified':True})


def check(name, condition, detail=None):
    # Raw originals are persisted by callers before every consequential assert.
    checks.append({'case':case,'name':name,'passed':bool(condition),'detail':detail}); flush()
    if not condition: raise AssertionError(name)


def case_census():
    return {'completedCases':[r['name'] for r in case_records if r['kind']=='scenario' and r['status']=='completed'],
      'infrastructureCases':[r['name'] for r in case_records if r['kind']=='infrastructure' and r['status']=='completed'],
      'records':copy.deepcopy(case_records)}


def set_phase(phase):
    record=case_records[-1]; observed=time.monotonic()
    record['phase']=phase; record['phases'].append({'phase':phase,'hostMonotonic':observed})
    journal.append('case-phase',{'case':case,'phase':phase,'hostMonotonic':observed})


def begin_case(name):
    global case,context_lifecycle
    if name in seen_cases: raise ValueError('Case identity must be unique: '+name)
    if name not in INFRASTRUCTURE_CASES and name not in GROUP_CASES[args.group]: raise ValueError('Case outside fixed group: '+name)
    if case_records and case_records[-1]['status']!='completed': raise ValueError('Previous case has not completed')
    case=name; seen_cases.add(name); observed=time.monotonic()
    context_lifecycle={'case':case,'contextCreated':False,'pageCreated':False,'navigationCompleted':False,'plannedSeed':None}
    case_records.append({'name':name,'kind':'infrastructure' if name in INFRASTRUCTURE_CASES else 'scenario','status':'running',
      'phase':'begin','hostStartedMonotonic':observed,'hostCompletedMonotonic':None,'hostElapsedSeconds':None,
      'phases':[{'phase':'begin','hostMonotonic':observed}]})
    journal.append('case-start',copy.deepcopy(case_records[-1])); scenario_directory(); flush()


def complete_case():
    record=case_records[-1]
    if record['name']!=case or record['status']!='running': raise ValueError('Only the current running case can complete')
    observed=time.monotonic(); record.update(status='completed',phase='completed',hostCompletedMonotonic=observed,hostElapsedSeconds=observed-record['hostStartedMonotonic'])
    record['phases'].append({'phase':'completed','hostMonotonic':observed})
    journal.append('case-complete',copy.deepcopy(record)); flush()


def persist_json(label,value):
    global evidence_sequence
    evidence_sequence+=1
    if not re.fullmatch(r'[A-Za-z0-9_-]+',label): raise ValueError('Unambiguous evidence label required')
    path=scenario_directory()/f'{evidence_sequence:06d}-{label}.json'
    publish_new_json(path,value)
    reference={'kind':'raw-before-assertion','case':case,'file':path.relative_to(out).as_posix(),'sha256':digest(path.read_bytes())}
    evidence.append(reference); flush(); return reference


def original_bytes(label,body,suffix):
    global evidence_sequence
    evidence_sequence+=1; path=scenario_directory()/f'{evidence_sequence:06d}-{label}.{suffix}'
    publish_new_bytes(path,body)
    reference={'case':case,'file':path.relative_to(out).as_posix(),'sha256':digest(body),'bytes':len(body)}
    evidence.append(reference); flush(); return reference


def storage(page):
    return page.evaluate('()=>Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)]))')
def all_storage(page):
    return {'local':storage(page),'session':page.evaluate('()=>Object.fromEntries(Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)]))')}
def raw(page): return page.evaluate('(key)=>localStorage.getItem(key)',KEY)


def advance(page,milliseconds=0):
    global clock_calls, clock_seconds
    if milliseconds not in (0,1000): raise ValueError('Only zero or one-second live functional steps')
    value=page.evaluate('(ms)=>window.__npcAdvance(ms)',milliseconds)
    if value['afterAt']-value['beforeAt'] != milliseconds: raise AssertionError('Functional clock delta differs')
    clock_calls+=1; clock_seconds+=milliseconds/1000
    return value


def trusted_click(page,selector,double=False):
    native_scroll_to(page,selector); before=page.evaluate('window.__npcClicks.length')
    page.locator(selector).dblclick(delay=40) if double else page.locator(selector).click()
    advance(page)
    events=page.evaluate('(n)=>window.__npcClicks.slice(n)',before)
    ref=persist_json('native-click',{'selector':selector,'double':double,'events':events,'storage':all_storage(page)})
    check('genuine native input produces only trusted button clicks',bool(events) and all(e['trusted'] for e in events) and (len(events)<=2 if double else len(events)==1),ref)


def tab(page,name):
    if page.locator('[data-bind="offline-modal"]').is_visible(): trusted_click(page,'[data-action="dismiss-offline"]')
    trusted_click(page,f'[data-tab="{name}"]')


def save(page,label='whole-memory-save'):
    tab(page,'save'); trusted_click(page,'[data-action="save"]')
    value=raw(page); ref=persist_json(label,{'raw':value,'storage':all_storage(page)})
    check('real Save witnesses complete current in-memory game state',isinstance(value,str) and json.loads(value).get('schema')=='infinity-original-p4',ref)
    return json.loads(value)['state']


def whole_state(label,actual,expected):
    ref=persist_json(label,{'actual':actual,'expected':expected,'excludedFields':[]})
    check(label+': exact entire current game, including resources queues IDs statistics and all other fields',exact_json(actual,expected),ref)


def edit_raw(page,unit,value):
    field=page.locator(b('uqty',unit)); before=page.evaluate('window.__npcEdits.length')
    field.fill(value); field.press('Tab'); advance(page)
    result={'requested':value,'actual':field.input_value(),'events':page.evaluate('(n)=>window.__npcEdits.slice(n)',before)}
    ref=persist_json('native-raw-edit',result)
    check('native text editing preserves exact raw string and trusted input',result['actual']==value and any(e['trusted'] and e['type']=='input' for e in result['events']),ref)


def card(page,unit):
    return page.locator(b('ucard',unit)).evaluate('''e=>({html:e.outerHTML,
      input:e.querySelector('[data-bind^="uqty-"]').value,inputDisabled:e.querySelector('[data-bind^="uqty-"]').disabled,
      quote:e.querySelector('[data-bind^="uquote-"]').textContent,total:e.querySelector('[data-bind^="utotal-"]').textContent,
      reason:e.querySelector('[data-bind^="umanual-reason-"]').textContent,hint:e.querySelector('[data-bind^="umode-hint-"]').textContent,
      payDisabled:e.querySelector('[data-action="manual-unit-pay"]').disabled,
      modes:[...e.querySelectorAll('[data-action="manual-unit-mode"]')].map(x=>({mode:x.dataset.mode,pressed:x.getAttribute('aria-pressed')}))})''')


def prepare(page,unit,mode,value):
    tab(page,unit_tab(unit)); trusted_click(page,mode_selector(unit,'count'))
    if page.locator(b('uqty',unit)).input_value()!=value: edit_raw(page,unit,value)
    trusted_click(page,mode_selector(unit,mode)); return card(page,unit)


def assert_quote(page,unit,count,expected_state):
    value=card(page,unit); total=independent_total(unit,count)
    planet=next(p for p in expected_state['planets'] if p['id']==expected_state['activePlanetId'])
    coord=planet['coordinates']; formatted=' · '.join(label+' '+format(int(total[r]),',') for r,label in zip(RESOURCES,('金属','晶体','重氢')))
    ref=persist_json('displayed-quote',{'actual':value,'expectedTotal':total,'expectedText':formatted,'expectedCount':count,'planet':planet['id']})
    check('independent golden all-three-resource full canonical price is displayed',value['total']==formatted,ref)
    check('quote names actual planet and exact added count',planet['name'] in value['quote'] and f'[{coord["galaxy"]}:{coord["system"]}:{coord["position"]}]' in value['quote'] and f'本次新增 {count:,}' in value['quote'],ref)
    check('valid prepared quote has separate enabled payment',not value['payDisabled'],ref)


def mode_only_then_pay(page,unit,mode,value,count,before,expected,double=False):
    persist_json('before-mode-original',{'state':before,'expectedAfter':expected,'storage':all_storage(page)})
    prepare(page,unit,mode,value); assert_quote(page,unit,count,before)
    # Real Save observes memory, not just unchanged old persisted bytes. It retires
    # the old UI quote; an explicit mode selection then prepares a fresh quote.
    full=save(page,'after-mode-complete-memory'); whole_state('mode-selection-only-no-payment',full,before)
    prepare(page,unit,mode,value); assert_quote(page,unit,count,before)
    prepared=card(page,unit); persist_json('before-payment-original',{'state':before,'expected':expected,'card':prepared,'storage':all_storage(page)})
    trusted_click(page,b('upay',unit),double=double)
    after_card=card(page,unit); paid_raw=raw(page)
    ref=persist_json('after-payment-original',{'raw':paid_raw,'card':after_card,'expected':expected,'storage':all_storage(page)})
    whole_state('synchronous-paid-world',json.loads(paid_raw)['state'],expected)
    check('success consumes quote and preserves exact raw input',after_card['payDisabled'] and after_card['input']==value,ref)
    for _ in range(3): advance(page)
    after_paint=card(page,unit); ref=persist_json('consumed-after-paint',after_paint)
    check('paint does not automatically resurrect consumed quote',after_paint['payDisabled'] and after_paint['input']==value,ref)
    whole_state('after-payment-real-save',save(page),expected)


def verify_bundle(page,response):
    global release_metadata
    release_url=urljoin(args.url,'release.json'); release_response=page.request.get(release_url)
    release_body=release_response.body(); release=json.loads(release_body)
    ref=original_bytes('http-release',release_body,'json')
    check('actual same-origin HTTP200 release pins exact SHA version and v9r16',release_response.status==200 and release_response.url==release_url and release['sourceSha']==args.expected_sha and release['version']==CANDIDATE_VERSION and release['saveVersion']==9 and release['saveRevision']==16,ref)
    if release_metadata is not None: check('every anonymous context receives identical production release',release==release_metadata,ref)
    release_metadata=release; capture=page_sources[page]; rows=[]; bodies={}; v8=[]
    for r in capture['responses']:
        body=r.body(); name=r.url.removeprefix(args.url); body_ref=original_bytes('http-asset',body,'bin')
        item={'url':r.url,'requestURL':r.request.url,'status':r.status,'kind':r.request.resource_type,'name':name,'sha256':digest(body),'expected':release['files'].get(name),'body':body_ref}; rows.append(item); bodies[r.url]=body
    for e in capture['executed']:
        body=capture['cdp'].send('Debugger.getScriptSource',{'scriptId':e['scriptId']})['scriptSource'].encode(); name=e['url'].removeprefix(args.url)
        v8.append({'url':e['url'],'sha256':digest(body),'httpSha256':digest(bodies[e['url']]) if e['url'] in bodies else None,'expected':release['files'].get(name),'body':original_bytes('v8-source',body,'js')})
    document=response.body(); doc={'url':response.url,'status':response.status,'sha256':digest(document),'expected':release['files']['index.html'],'body':original_bytes('http-document',document,'html')}
    binding={'assets':rows,'executed':v8,'document':doc}; ref=persist_json('complete-production-binding',binding); source_bindings.append(binding)
    check('original HTTP200 document and full JS CSS bytes match release',doc['status']==200 and doc['url']==args.url and doc['sha256']==doc['expected'] and {'script','stylesheet'}<={r['kind'] for r in rows} and all(r['status']==200 and r['url']==r['requestURL'] and r['sha256']==r['expected'] for r in rows),ref)
    check('actual V8 executed sources match original HTTP bytes and release',bool(v8) and all(r['sha256']==r['httpSha256']==r['expected'] for r in v8),ref)
    if len(source_bindings)==1:
        all_rows=[]
        for name,expected in release['files'].items():
            r=page.request.get(urljoin(args.url,name)); all_rows.append({'name':name,'url':r.url,'status':r.status,'sha256':digest(r.body()),'expected':expected})
        ref=persist_json('all-release-resources-http',all_rows)
        check('all release resources actual HTTP200 full hashes match',len(all_rows)==62 and all(r['status']==200 and r['url']==urljoin(args.url,r['name']) and r['sha256']==r['expected'] for r in all_rows),ref)
    capture['cdp'].send('Debugger.disable')


def boot(initial_raw,width=1440):
    global active_context,active_page,context_lifecycle
    active_context=active_page=None
    context_lifecycle={'case':case,'contextCreated':False,'pageCreated':False,'navigationCompleted':False,'plannedSeed':None}
    set_phase('boot-planned-seed')
    envelope=json.loads(initial_raw); entries=[{'name':KEY,'value':initial_raw},{'name':'infinity.ui.tab','value':'overview'}]
    context_lifecycle['plannedSeed']=persist_json('planned-anonymous-native-origin-seed',{'raw':initial_raw,'rawSha256':digest(initial_raw.encode()),'origin':ORIGIN,'localStorage':entries,'viewport':{'width':width,'height':1100},'savedAt':envelope['savedAt']})
    set_phase('boot-create-context')
    context=browser.new_context(viewport={'width':width,'height':1100},reduced_motion='reduce',storage_state={'cookies':[],'origins':[{'origin':ORIGIN,'localStorage':entries}]})
    active_context=context; context_lifecycle['contextCreated']=True; set_phase('boot-read-context-storage')
    original=context.storage_state(); ref=persist_json('anonymous-native-origin-seed',{'original':original,'expectedRaw':initial_raw})
    check('new anonymous context contains only exact input origin and save bytes',original['cookies']==[] and len(original['origins'])==1 and original['origins'][0]['origin']==ORIGIN and {r['name']:r['value'] for r in original['origins'][0]['localStorage']}=={r['name']:r['value'] for r in entries},ref)
    set_phase('boot-add-functional-clock')
    context.add_init_script(CLOCK.replace('__EPOCH__',str(envelope['savedAt'])))
    set_phase('boot-create-page'); page=context.new_page(); active_page=page; context_lifecycle['pageCreated']=True
    set_phase('boot-attach-observers'); attach(page)
    set_phase('boot-navigate'); response=page.goto(args.url,wait_until='networkidle'); context_lifecycle['navigationCompleted']=True
    set_phase('boot-initial-functional-frame'); advance(page)
    set_phase('boot-bind-production'); verify_bundle(page,response)
    ref=persist_json('native-implementations',page.evaluate('window.__npcNative'))
    check('actual native Storage File dialog and timers are retained',page.evaluate('window.__npcNative'),ref)
    return context,page


@contextmanager
def live_context(initial_raw,width=1440):
    global active_context,active_page
    try:
        context,page=boot(initial_raw,width)
        set_phase('case-actions'); yield context,page
    except BaseException:
        capture_failure(active_page); raise
    finally:
        if active_context is not None:
            set_phase('context-cleanup')
            try: active_context.close()
            except BaseException as error:
                if failure is None:
                    capture_failure(active_page); raise
                journal.append('diagnostic-error',{'name':'context-cleanup','error':repr(error)})
            finally: active_context=active_page=None
    complete_case()


def capture_failure(page):
    global failure,failure_lifecycle
    if failure is not None: return
    failure=traceback.format_exc()
    record=case_records[-1]; observed=time.monotonic()
    failure_lifecycle={**copy.deepcopy(context_lifecycle),'case':case,'failurePhase':record['phase'],
      'page':None if page is None else {'isClosed':page.is_closed()},'hostMonotonic':observed}
    record.update(status='failed',hostFailedMonotonic=observed,hostElapsedSeconds=observed-record['hostStartedMonotonic'])
    persist_json('failure-lifecycle',{'failure':failure,'lifecycle':failure_lifecycle})
    journal.append('case-failed',copy.deepcopy(record))
    # A failure before new_page has no app DOM. Never substitute a previous case.
    if page is None or page.is_closed(): return
    # Keep the context alive while saving originals. Evidence precedes cleanup.
    for name,action in [('failure-storage',lambda:all_storage(page)),('failure-dom',lambda:page.content())]:
        try: persist_json(name,action())
        except BaseException as error: journal.append('diagnostic-error',{'name':name,'error':repr(error)})
    try: original_bytes('failure-screen',page.screenshot(caret='initial',timeout=3000),'png')
    except BaseException as error: journal.append('diagnostic-error',{'name':'failure-screen','error':repr(error)})


CAPTURE_REFERENCES = '''unit=>{const panel=document.querySelector('[data-bind="ucard-'+unit+'"]');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);return{unit,panel,nodes,ancestors};}'''
CAPTURE_STATE = '''refs=>{const panel=document.querySelector('[data-bind="ucard-'+refs.unit+'"]');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
return{samePanel:refs.panel===panel,sameNodes:same(refs.nodes,nodes),sameAncestors:same(refs.ancestors,ancestors),
allConnected:[...refs.nodes,...refs.ancestors].every(n=>n.isConnected),html:panel?.outerHTML,
state:refs.nodes.map(n=>({style:n.getAttribute('style'),value:'value'in n?n.value:null,disabled:'disabled'in n?n.disabled:null}))};}'''


def snap(page,unit,label):
    refs=page.evaluate_handle(CAPTURE_REFERENCES,unit); witness={'caret':'initial','unit':unit}
    try:
        witness['before']=refs.evaluate(CAPTURE_STATE); before_ref=persist_json(label+'-before',witness)
        try: image_ref=original_bytes(label,page.screenshot(full_page=False,caret='initial',timeout=7000),'png'); witness['image']=image_ref
        finally:
            witness['after']=refs.evaluate(CAPTURE_STATE); after_ref=persist_json(label+'-after',witness)
        check('caret=initial screenshot preserves exact live DOM authority and values',witness['before']==witness['after'] and all(witness['after'][k] for k in ('samePanel','sameNodes','sameAncestors','allConnected')),{'before':before_ref,'after':after_ref})
    finally: refs.dispose()


def natural_route():
    begin_case('natural05-real-count-fill-max-payments')
    with live_context(fixtures['initialRaw']) as (_context,page):
        before=save(page); whole_state('untouched-natural05-handoff',before,lift_r14_state_to_r16(fixtures['base']['state']))
        tab(page,'shipyard'); default=card(page,'small_cargo'); ref=persist_json('first-visible-default-one',default)
        check('first visible card retains valid default one with a separate enabled payment',default['input']=='1' and not default['payDisabled'],ref)
        assert_quote(page,'small_cargo',1,before)
        tick_index=0
        for operation in fixtures['natural']['tape']:
            set_phase('natural-'+operation['kind']+'-'+operation.get('name','live-seconds'))
            persist_json('natural-operation',operation)
            if operation['kind']=='checkpoint':
                expected=fixtures['natural']['expected'][operation['name']]
                whole_state(operation['name'],save(page),expected); before=expected
            elif operation['kind']=='advance':
                for _ in range(operation['seconds']):
                    tick=fixtures['natural']['tickAudit'][tick_index]; tick_index+=1
                    observed=advance(page,1000)
                    ref=persist_json('natural-one-second-frame',{'tick':tick['second'],'api':'actual window.__npcAdvance(1000)',
                        'requestedMilliseconds':1000,'observedClock':observed,
                        'domainOracleBeforeSha256':digest(json.dumps(tick['before'],ensure_ascii=False,sort_keys=True).encode()),
                        'domainOracleAfterSha256':digest(json.dumps(tick['after'],ensure_ascii=False,sort_keys=True).encode()),
                        'stateObservation':'Complete independent domain states retained in fixture tickAudit; browser memory saved only at declared payment/partial/funding checkpoints.'})
                    check('each real functional live step advances exactly one second',observed['afterAt']-observed['beforeAt']==1000,ref)
            elif operation['kind']=='pay':
                expected=fixtures['natural']['expected'][operation['name']]
                if operation['mode']=='fill':
                    ref=persist_json('independent-natural-fill',{'state':before,'requested':5,'expectedAdded':independent_fill(before,'small_cargo',5)})
                    check('natural fill counts completed local plus actual paid remaining queue',independent_fill(before,'small_cargo',5)==2,ref)
                mode_only_then_pay(page,'small_cargo',operation['mode'],operation['raw'],operation['count'],before,expected,double=operation['mode']=='count' and operation['raw']=='1')
                before=expected
            else: raise ValueError('Unknown natural operation')


def invalid_and_all_units():
    fixture=fixtures['synthetic']['all-unlocked']; base=fixture['expected']
    for unit in GROUP_UNITS[args.group]:
        begin_case('SYNTHETIC-all24-'+unit)
        with live_context(fixture['raw']) as (_context,page):
            persist_json('classification',{'classification':fixture['classification'],'unit':unit})
            whole_state('strict-synthetic-start',save(page),base)
            for index,value in enumerate(INVALID):
                set_phase('invalid-raw-'+str(index))
                prepare(page,unit,'count',value); original=card(page,unit)
                before_ref=persist_json('invalid-before',{'invalidIndex':index,'raw':value,'card':original,'expected':base,'storage':all_storage(page)})
                # Genuine pointer input onto the disabled payment control, plus
                # explicitly adversarial DOM click, may never create authority.
                native_scroll_to(page,b('upay',unit)); box=page.locator(b('upay',unit)).bounding_box()
                page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2)
                page.locator(b('upay',unit)).evaluate('(e)=>e.click()'); advance(page)
                observed=card(page,unit); after_ref=persist_json('invalid-after',{'card':observed,'storage':all_storage(page),'expected':base})
                check('invalid text blocks payment and preserves raw exact bytes',original['payDisabled'] and observed['payDisabled'] and observed['input']==value,{'before':before_ref,'after':after_ref})
                whole_state('invalid-complete-memory-no-mutation',save(page),base)
            set_phase('positive-count-one'); expected=fixture['positive'][unit]['expected']
            mode_only_then_pay(page,unit,'count','1',1,base,expected)
            if unit=='solar_satellite':
                tab(page,'fleet'); ref=persist_json('satellite-fleet-exclusion',{'selectable':page.locator('[data-ship="solar_satellite"]').count()})
                check('solar satellite remains unselectable for flight',page.locator('[data-ship="solar_satellite"]').count()==0,ref)


def legal_raw_payment():
    begin_case('SYNTHETIC-native-trim-leading-zero-raw-preserved')
    fixture=fixtures['synthetic']['all-unlocked']; legal=fixture['legalRaw']
    with live_context(fixture['raw']) as (_context,page):
        ref=persist_json('literal-legal-raw-golden',{'raw':legal['raw'],'count':2,'total':{'metal':'4000','crystal':'4000','deuterium':'0'},'classification':fixture['classification']})
        check('literal trimmed decimal input denotes exactly two and keeps original text',legal['raw']==' 0002 ' and legal['count']==2 and legal['total']=={'metal':'4000','crystal':'4000','deuterium':'0'},ref)
        mode_only_then_pay(page,'small_cargo','count',legal['raw'],2,fixture['expected'],legal['expected'])


def rejected_boundaries():
    pairs=[('queue-full','small_cargo'),('insufficient','small_cargo'),('unit-cap','small_cargo'),
      ('owned-small_shield_dome','small_shield_dome'),('owned-large_shield_dome','large_shield_dome'),
      ('queued-small_shield_dome','small_shield_dome'),('queued-large_shield_dome','large_shield_dome'),
      ('silo-39','interplanetary_missile'),('silo-40','anti_ballistic_missile'),('silo-40','interplanetary_missile')]
    for name,unit in pairs:
        begin_case('SYNTHETIC-reject-'+name+'-'+unit); fixture=fixtures['synthetic'][name]
        with live_context(fixture['raw']) as (_context,page):
            before=save(page); whole_state('exact-boundary-start',before,fixture['expected'])
            for mode in ('count','fill','max'):
                set_phase('boundary-'+mode)
                prepare(page,unit,mode,'1'); value=card(page,unit)
                ref=persist_json('boundary-rejection',{'mode':mode,'card':value,'expected':before,'classification':fixture['classification']})
                check('capacity resource or uniqueness boundary rejects separate payment',value['payDisabled'],ref)
                if mode=='max': check('max retains disabled raw field and says N is unused',value['input']=='1' and value['inputDisabled'] and ('不使用' in value['hint'] or '不读取' in value['hint']),ref)
                page.locator(b('upay',unit)).evaluate('(e)=>e.click()'); advance(page)
                whole_state('rejection-complete-current-memory',save(page),before)
    begin_case('SYNTHETIC-silo39-one-slot-abm-succeeds'); fixture=fixtures['synthetic']['silo-39']
    with live_context(fixture['raw']) as (_context,page):
        mode_only_then_pay(page,'anti_ballistic_missile','count','1',1,fixture['expected'],fixture['abmExpected'])


def four_widths():
    fixture=fixtures['synthetic']['full-price']; unit='deathstar'
    for width in WIDTHS:
        begin_case('SYNTHETIC-full-canonical-price-width-'+str(width))
        with live_context(fixture['raw'],width) as (_context,page):
            prepare(page,unit,'count','1000000'); assert_quote(page,unit,1000000,fixture['expected'])
            for name in ('uqty','ubuild','ufill','umax','uquote','utotal','upay'):
                set_phase('native-geometry-'+name)
                selector=b(name,unit); native_scroll_to(page,selector)
                hits=visibility(page,[selector]); glyphs=None if name=='uqty' else text_leaf_visibility(page,[selector])
                ref=persist_json('four-width-native-geometry',{'width':width,'selector':selector,'hits':hits,'glyphs':glyphs})
                check('actual whole target has five unobstructed viewport hits',len(hits['targets'])==1 and all(row['visible'] and row['contained'] and len(row['points'])==5 and all(point['unoccluded'] for point in row['points']) for row in hits['targets']),ref)
                if glyphs: check('every amount glyph fits actual ancestor and viewport clips',all(row['passed'] for row in glyphs['leaves']),ref)
                snap(page,unit,f'width-{width}-{name}')
            whole_state('four-width-review-does-not-pay',save(page),fixture['expected'])


def latest_plan():
    fixture=fixtures['synthetic']['latest-plan']; unit='small_cargo'
    for mode in ('max','fill'):
        begin_case('SYNTHETIC-latest-plan-retires-old-'+mode); fresh=fixture['fresh'][mode]
        with live_context(fixture['raw']) as (_context,page):
            before=save(page); whole_state('pending-plan-start',before,fixture['expected'])
            prepare(page,unit,mode,fresh['raw']); previous=card(page,unit); original=page.locator(b('upay',unit)).element_handle()
            persist_json('before-plan-live-tick',{'state':before,'card':previous,'expectedAfterTick':fixture['afterTick']})
            audit_ref=persist_json('real-plan-cadence-contract',{'seconds':fixture['advanceSeconds'],'steps':len(fixture['tickAudit']),'expected':fixture['afterTick']})
            check('real scheduler change uses exact ten one-second live steps',fixture['advanceSeconds']==len(fixture['tickAudit'])==10,audit_ref)
            for tick in fixture['tickAudit']:
                observed=advance(page,1000)
                ref=persist_json('plan-one-second-frame',{'step':tick['second'],'observedClock':observed,
                    'domainOracleBeforeSha256':digest(json.dumps(tick['before'],ensure_ascii=False,sort_keys=True).encode()),
                    'domainOracleAfterSha256':digest(json.dumps(tick['after'],ensure_ascii=False,sort_keys=True).encode())})
                check('actual plan-cadence frame advances exactly one second',observed['afterAt']-observed['beforeAt']==1000,ref)
            changed=card(page,unit)
            # The retained control is deliberately invoked without reselecting mode.
            original.evaluate('(e)=>e.click()'); advance(page)
            after=card(page,unit)
            ref=persist_json('after-stale-plan-payment-attempt',{'before':previous,'after':after,'changed':changed,'expected':fixture['afterTick']})
            check('latest scheduled payment retires the old quote and retains exact raw input',after['input']==fresh['raw'] and after['payDisabled'],ref)
            whole_state('latest-plan-only-entire-world',save(page),fixture['afterTick']); original.dispose()
            mode_only_then_pay(page,unit,mode,fresh['raw'],fresh['count'],fixture['afterTick'],fresh['expected'])


def file_observation(page):
    return page.evaluate('''()=>({files:window.__npcFiles.slice(),status:document.querySelector('[data-bind="status"]')?.textContent,
      visible:document.visibilityState,clock:Date.now(),fileName:document.querySelector('[data-bind="import-file"]')?.files[0]?.name})''')


def wait_file_result(page,before,file_name,expected_status,exact=True):
    first=file_observation(page); first_ref=persist_json('file-result-first-observation',{'before':before,'first':first,'expectedFile':file_name,'expectedStatus':expected_status,'exact':exact})
    started=time.monotonic(); final=None
    try:
        page.wait_for_function('''({count,name,status,exact,oldStatus})=>{
          const files=window.__npcFiles,text=document.querySelector('[data-bind="status"]')?.textContent;
          return files.length===count+1&&files.at(-1).name===name&&text!==oldStatus&&
            (exact?text===status:typeof text==='string'&&text.startsWith(status));}''',
          arg={'count':len(before['files']),'name':file_name,'status':expected_status,'exact':exact,'oldStatus':before['status']},timeout=5000)
    finally:
        final=file_observation(page)
        final_ref=persist_json('file-result-final-observation',{'before':before,'first':first,'final':final,'hostElapsedSeconds':time.monotonic()-started,'boundMilliseconds':5000})
    check('bounded native file result matches this exact new File event and new terminal status',len(final['files'])==len(before['files'])+1 and final['files'][-1]['name']==file_name and final['status']!=before['status'] and (final['status']==expected_status if exact else final['status'].startswith(expected_status)),{'first':first_ref,'final':final_ref})


def import_file(page,text,label,accept=True,navigate=True):
    path=scenario_directory()/(label+'.json'); publish_new_bytes(path,text.encode()); evidence.append({'file':path.relative_to(out).as_posix(),'sha256':digest(text.encode())}); flush()
    if navigate: tab(page,'save')
    state=json.loads(raw(page))['state']; p=next(p for p in state['planets'] if p['id']==state['activePlanetId'])
    expected=import_confirmation(json.loads(text),f'第 {state["stats"]["launches"]+1} 轮，{len(state["planets"])} 颗星球，当前“{p["name"]}”'); dialogs=[]
    def answer(dialog):
        valid=dialog.type=='confirm' and dialog.message==expected; dialogs.append({'type':dialog.type,'text':dialog.message,'valid':valid})
        dialog.accept() if valid and accept else dialog.dismiss()
    before=file_observation(page); persist_json('file-input-before',before)
    page.once('dialog',answer); page.locator('[data-bind="import-file"]').set_input_files(str(path))
    wait_file_result(page,before,path.name,'已导入并存入本地' if accept else '已取消文件导入，当前进度未改动'); advance(page)
    ref=persist_json('real-file-import',{'dialogs':dialogs,'storage':all_storage(page),'files':page.evaluate('window.__npcFiles')})
    check('real native File import has exact action-time confirmation',len(dialogs)==1 and dialogs[0]['valid'],ref)


def lifecycle_and_hostile_dom():
    fixture=fixtures['synthetic']['all-unlocked']; unit='small_cargo'
    for action in ('tab-away','switch-planet-return','same-id-import','reset','duplicate','detach','detach-reinsert','crosslabel','ancestor-reinsert','quote-hidden','total-hidden','quote-hide-show','ancestor-hide-show','class-hide-show','style-visibility-hide-show','quote-text-tamper','total-text-tamper','same-text-hidden-child'):
        begin_case('SYNTHETIC-authority-'+action)
        with live_context(fixture['raw']) as (_context,page):
            expected=save(page); saved_raw=raw(page)
            if action=='same-id-import':
                saved_envelope=json.loads(saved_raw)
                saved_ref=persist_json('same-id-real-save-import-source',{'raw':saved_raw,'rawSha256':digest(saved_raw.encode()),'envelope':saved_envelope,'expected':expected,'origin':'Exact bytes produced by this context real Save; no fixture serialization or unadopted setup raw.'})
                check('same-id import source is the complete just-saved world with original world and planet identities',exact_json(saved_envelope['state'],expected) and saved_envelope['state']['universe']==fixture['expected']['universe'] and saved_envelope['state']['activePlanetId']==fixture['expected']['activePlanetId'] and [p['id'] for p in saved_envelope['state']['planets']]==[p['id'] for p in fixture['expected']['planets']],saved_ref)
            prepare(page,unit,'count','1'); button=page.locator(b('upay',unit)).element_handle(); control=page.locator(b('ucard',unit)).element_handle()
            before_ref=persist_json('authority-before',{'state':expected,'card':card(page,unit),'storage':all_storage(page)})
            if action=='tab-away': tab(page,'overview')
            elif action=='switch-planet-return':
                select(page,'#planet-select','colony-1'); select(page,'#planet-select','homeworld')
            elif action=='same-id-import': import_file(page,saved_raw,'same-id-original')
            elif action=='reset':
                tab(page,'save'); dialogs=[]
                def accept_reset(dialog):
                    valid=dialog.type=='confirm' and dialog.message=='备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。'; dialogs.append({'valid':valid,'text':dialog.message}); dialog.accept() if valid else dialog.dismiss()
                page.once('dialog',accept_reset); trusted_click(page,'[data-action="reset"]'); expected=save(page)
                ref=persist_json('real-reset-baseline',{'dialogs':dialogs,'expected':expected}); check('reset used exact real confirmation',len(dialogs)==1 and dialogs[0]['valid'],ref)
            elif action=='duplicate':
                button.dispose(); button=control.evaluate_handle('e=>{const clone=e.cloneNode(true);e.after(clone);const button=clone.querySelector("[data-action=manual-unit-pay]");button.click();clone.remove();return button;}')
            elif action=='detach': control.evaluate('(e)=>e.remove()')
            elif action=='detach-reinsert': control.evaluate('(e)=>{const p=e.parentNode,n=e.nextSibling;e.remove();p.insertBefore(e,n);}')
            elif action=='ancestor-reinsert': control.evaluate('(e)=>{const a=e.parentNode,p=a.parentNode,n=a.nextSibling;a.remove();p.insertBefore(a,n);}')
            elif action in ('quote-hidden','total-hidden'):
                page.locator(b('uquote' if action=='quote-hidden' else 'utotal',unit)).evaluate('(e)=>{e.hidden=true;}')
            elif action=='quote-hide-show': page.locator(b('uquote',unit)).evaluate('(e)=>{e.hidden=true;e.hidden=false;}')
            elif action=='ancestor-hide-show': control.evaluate('(e)=>{e.parentElement.hidden=true;e.parentElement.hidden=false;}')
            elif action=='class-hide-show': control.evaluate('(e)=>{e.classList.add("hidden");e.classList.remove("hidden");}')
            elif action=='style-visibility-hide-show': control.evaluate('(e)=>{e.style.visibility="hidden";e.style.visibility="";}')
            elif action in ('quote-text-tamper','total-text-tamper'):
                page.locator(b('uquote' if action=='quote-text-tamper' else 'utotal',unit)).evaluate('(e)=>{e.textContent="金属 0 · 晶体 0 · 重氢 0";}')
            elif action=='same-text-hidden-child': page.locator(b('utotal',unit)).evaluate('(e)=>{const child=document.createElement("span");child.hidden=true;child.textContent=e.textContent;e.replaceChildren(child);}')
            elif action=='crosslabel': button.evaluate('(e)=>{e.dataset.id="large_cargo";e.click();e.dataset.id="small_cargo";}')
            advance(page); button.evaluate('(e)=>e.click()'); advance(page)
            after_ref=persist_json('authority-after-old-click',{'connected':button.evaluate('(e)=>e.isConnected'),'raw':raw(page),'expected':expected,'storage':all_storage(page)})
            whole_state('retired-or-untrusted-node-has-no-payment-authority',save(page),expected)
            check('every hostile action has persisted before and after originals',bool(before_ref['sha256'] and after_ref['sha256']),{'before':before_ref,'after':after_ref})
            button.dispose(); control.dispose()


def rejected_import_attempts():
    fixture=fixtures['synthetic']['all-unlocked']; unit='small_cargo'
    for action in ('cancelled-import','failed-import'):
        begin_case('SYNTHETIC-'+action+'-retires-visible-quote')
        with live_context(fixture['raw']) as (_context,page):
            before=save(page); prepare(page,unit,'count','1'); original=page.locator(b('upay',unit)).element_handle()
            before_ref=persist_json('import-attempt-before',{'state':before,'card':card(page,unit),'storage':all_storage(page)})
            if action=='cancelled-import': import_file(page,fixture['raw'],'cancelled-real-file',accept=False,navigate=False)
            else:
                path=scenario_directory()/'malformed-real-file.json'; publish_new_bytes(path,b'{"invalid JSON"')
                evidence.append({'file':path.relative_to(out).as_posix(),'sha256':digest(path.read_bytes())}); flush()
                dialogs=[]
                def reject_unexpected(dialog): dialogs.append({'type':dialog.type,'message':dialog.message}); dialog.dismiss()
                before_file=file_observation(page); persist_json('failed-file-input-before',before_file)
                page.on('dialog',reject_unexpected); page.locator('[data-bind="import-file"]').set_input_files(str(path))
                wait_file_result(page,before_file,path.name,'导入失败，当前进度未改动：',exact=False); advance(page)
                page.remove_listener('dialog',reject_unexpected)
                ref=persist_json('failed-real-file-result',{'dialogs':dialogs,'status':page.locator('[data-bind="status"]').text_content(),'files':page.evaluate('window.__npcFiles')})
                check('malformed native File import fails before any confirmation',not dialogs,ref)
            original.evaluate('(e)=>e.click()'); advance(page); value=card(page,unit)
            after_ref=persist_json('import-attempt-after',{'card':value,'expected':before,'storage':all_storage(page)})
            check('failed or cancelled import keeps visible old quote retired and raw unchanged',value['payDisabled'] and value['input']=='1',{'before':before_ref,'after':after_ref})
            whole_state('import-attempt-entire-memory-unchanged',save(page),before); original.dispose()
            mode_only_then_pay(page,unit,'count','1',1,before,fixture['positive'][unit]['expected'])


def protection_boundary():
    begin_case('SYNTHETIC-real-cross-tab-protection'); fixture=fixtures['synthetic']['all-unlocked']; unit='small_cargo'
    with live_context(fixture['raw']) as (context,page):
        prepare(page,unit,'count','1'); old=page.locator(b('upay',unit)).element_handle(); before=storage(page)
        competing=json.loads(fixtures['initialRaw']); competing['savedAt']=json.loads(fixture['raw'])['savedAt']+1; competing['lastTickAt']=competing['savedAt']; competing_raw=json.dumps(competing,ensure_ascii=False,separators=(',',':'))
        before_ref=persist_json('protected-original-before',{'before':before,'competingRaw':competing_raw,'expected':{**before,KEY:competing_raw}})
        writer=context.new_page(); writer.goto(urljoin(args.url,'icons/save.webp'),wait_until='load'); writer.evaluate('([key,value])=>localStorage.setItem(key,value)',[KEY,competing_raw]); page.bring_to_front(); advance(page)
        old.evaluate('(e)=>e.click()'); advance(page); after=storage(page)
        ref=persist_json('protected-original-after',{'actual':after,'expected':{**before,KEY:competing_raw},'events':page.evaluate('window.__npcStorage')})
        check('real trusted competing raw storage event activates protection',any(e['trusted'] and e['oldValue']==before[KEY] and e['newValue']==competing_raw for e in page.evaluate('window.__npcStorage')),ref)
        check('protected rejection preserves all original storage bytes including competing save',after=={**before,KEY:competing_raw},{'before':before_ref,'after':ref})
        writer.close(); old.dispose()


def validate_native_hidden_result(value, request, input_sha):
    """Independently bind the child originals before accepting its native checks."""
    def require(ok, name):
        if not ok: raise AssertionError('Native hidden result: '+name)
    require(type(value) is dict and value.get('schema')=='infinity-manual-unit-hidden-report-v1','schema')
    require(value.get('completed') is True and value.get('result')=='passed' and value.get('failure') is None,'successful terminal')
    require(value['inputSha256']==input_sha and value['sourceSha']==request['expectedSha'] and value['version']==request['expectedVersion'],'input/source/version')
    require(value['chrome']['version']['product']=='Chrome/'+request['expectedBrowserVersion'],'same browser binary version')
    require(value['chrome']['executable']==request['chromium'],'same browser path')
    require(value['releaseMetadata']==request['expectedRelease'],'complete release metadata')
    require(value['input']['sha256']==input_sha and value['clockScript']['sha256']==digest(request['clockScript'].encode()),'original input and unmodified functional clock')
    require(type(value['durationMs']) in (int,float) and 0<=value['durationMs']<45000,'bounded complete helper duration')
    require(value['boundsMs']['hidden']==5000 and value['boundsMs']['resume']==5000 and value['boundsMs']['whole']==45000,'original action bounds')
    require(value.get('errors')==[],'browser errors')
    cleanup=value['cleanup']
    require(all(cleanup.get(k) is True for k in ('socketClosed','processExited','processGroupGone','profileRemoved')) and not cleanup.get('error'),'owned cleanup')
    require(type(value['checks']) is list and value['checks'] and all(c.get('passed') is True and type(c.get('name')) is str for c in value['checks']),'all child checks')
    for key,expected in (('beforeSave',request['beforeState']),('beforePayment',request['beforeState']),('afterPayment',request['expectedState']),('finalSave',request['expectedState'])):
        row=value[key]; envelope=json.loads(row['raw'])
        require(exact_json(envelope['state'],expected) and exact_json(row['state'],expected),'whole state '+key)
        require(row['storage']['local'][request['key']]==row['raw'],'raw storage '+key)
    require(value['initial']['initialRaw']==request['initialRaw'],'unaltered input save')
    require(value['beforePayment']['card']['input']=='1' and value['beforePayment']['card']['payDisabled'] is False,'initial default quote')
    require(value['afterPayment']['card']['payDisabled'] is True and value['afterResumeCard']['payDisabled'] is True and value['afterResumeCard']['input']=='1','consumed quote remains retired')
    native_keys={'storageGet','storageSet','fileText','confirm','timeout','interval','hidden','visibility','noOwnHidden','noOwnVisibility','storageInstance'}
    initial=value['initial']; before=value['beforeHide']; hidden=value['hidden']; resumed=value['resumed']; final=value['finalProbe']; cover=value['coverBefore']
    for observation in (initial,before,hidden,resumed,final):
        require(observation['id']==initial['id'] and set(observation['native'])==native_keys and all(v is True for v in observation['native'].values()),'same document and actual native APIs')
        require(type(observation['seq']) is int and all(type(e['seq']) is int for e in observation['events']),'event sequence integers')
        require([e['seq'] for e in observation['events']]==sorted(set(e['seq'] for e in observation['events'])),'unique ordered events')
    require(before['hidden'] is False and before['state']=='visible' and cover['hidden'] is True and cover['state']=='hidden','native action preconditions')
    require(hidden['hidden'] is True and hidden['state']=='hidden' and resumed['hidden'] is False and resumed['state']=='visible','real hidden and visible')
    require(value['coverHidden']['hidden'] is False and value['coverHidden']['state']=='visible','cover genuinely visible during game hidden')
    he=value['hiddenEvent']; ve=value['resumedEvent']
    require(he in hidden['events'] and he['id']==initial['id'] and he['seq']>before['seq'] and he['type']=='visibilitychange' and he['trusted'] is True and he['hidden'] is True and he['state']=='hidden','new trusted hidden event')
    require(ve in resumed['events'] and ve['id']==initial['id'] and ve['seq']>hidden['seq'] and ve['type']=='visibilitychange' and ve['trusted'] is True and ve['hidden'] is False and ve['state']=='visible' and ve['nativeMono']>he['nativeMono'],'later trusted resume event')
    require(before['events']==hidden['events'][:len(before['events'])] and hidden['events']==resumed['events'][:len(hidden['events'])] and resumed['events']==final['events'][:len(resumed['events'])],'complete unmodified event prefixes')
    require(not any(e['type'] in ('pagehide','beforeunload') for e in final['events']),'no reload or document replacement')
    actions=value['actions']; covers=[a for a in actions if a['kind']=='activate-cover']; games=[a for a in actions if a['kind']=='activate-game']
    require(len(covers)==len(games)==1 and covers[0]['hostMono']<games[0]['hostMono'],'one ordered real activation each')
    windows=value['windows'];require(windows['gameTarget']!=windows['coverTarget'] and windows['game']['windowId']==windows['cover']['windowId'],'same real headed window')
    require(covers[0]['targetId']==windows['coverTarget'] and games[0]['targetId']==windows['gameTarget'],'actual activation targets')
    clicks=final['clicks']; require(len([c for c in clicks if c['action']=='manual-unit-pay'])==1 and all(c['trusted'] is True for c in clicks),'one trusted payment')
    advances=value['functionalAdvanceCalls']
    require(advances and all(a['completed'] is True and a['milliseconds']==0 and a['beforeAt']==a['afterAt'] for a in advances),'only zero-time visible functional advances')
    require(not any(covers[0]['hostMono']<=a['hostStartMs']<=games[0]['hostMono'] for a in advances),'no advance while hidden')
    files=request['expectedRelease']['files']; resources=value['releaseResources']
    require(len(resources)==len(files)==62 and {r['name'] for r in resources}==set(files),'all unique release resources')
    for row in resources:
        require(row['status']==200 and row['url']==row['requestURL']==urljoin(request['url'],row['name']) and row['sha256']==row['body']['sha256']==files[row['name']],'actual resource HTTP body')
    bindings=value['sourceBindings']; require(len(bindings)==1,'one actual executed production document')
    binding=bindings[0]; doc=binding['document']
    require(doc['url']==doc['requestURL']==request['url'] and doc['status']==200 and doc['sha256']==doc['body']['sha256']==files['index.html'],'actual document body')
    require({'script','stylesheet'}<={r['kind'] for r in binding['assets']},'actual JS and CSS HTTP responses')
    for row in binding['assets']:
        require(row['status']==200 and row['url']==row['requestURL']==urljoin(request['url'],row['name']) and row['sha256']==row['body']['sha256']==files[row['name']],'actual execution asset')
    require(binding['executed'],'actual V8 source')
    for row in binding['executed']:
        name=row['url'].removeprefix(request['url'])
        require(row['sha256']==row['httpSha256']==row['body']['sha256']==files[name],'V8 and HTTP byte identity')
    return True


def hidden_resume():
    global active_context,active_page,context_lifecycle,clock_calls
    begin_case('SYNTHETIC-consumed-native-hidden-resume'); fixture=fixtures['synthetic']['all-unlocked']
    active_context=active_page=None
    request={'schema':'infinity-manual-unit-hidden-input-v1','url':args.url,'chromium':args.chromium,
      'expectedSha':args.expected_sha,'expectedVersion':CANDIDATE_VERSION,'expectedBrowserVersion':browser.version,
      'key':KEY,'initialRaw':fixture['raw'],'beforeState':fixture['expected'],'expectedState':fixture['positive']['small_cargo']['expected'],
      'clockScript':CLOCK.replace('__EPOCH__',str(json.loads(fixture['raw'])['savedAt'])),
      'expectedRelease':release_metadata,'evidenceRoot':str(out)}
    input_ref=persist_json('raw-native-hidden-input',request); input_path=out/input_ref['file']
    child_dir=scenario_directory()/'native-hidden'; started=time.monotonic(); process=None; stdout=stderr=b''; owned_group=None; invocation={}
    set_phase('independent-headed-native-hidden')
    try:
        process=subprocess.Popen(['node',str(ROOT/'scripts/browser-manual-unit-hidden.mjs'),'--input',str(input_path),'--output',str(child_dir)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        invocation={'pid':process.pid,'input':input_ref,'outputDirectory':str(child_dir.relative_to(out)),'startedHostMonotonic':started}
        ownership=child_dir/'chrome-owner.json'
        until=min(started+5,started+50)
        while not ownership.exists() and process.poll() is None and time.monotonic()<until: time.sleep(.02)
        if ownership.exists():
            if ownership.is_symlink(): raise AssertionError('Hidden ownership must be an ordinary file')
            owner=json.loads(ownership.read_text())
            if owner.get('schema')!='infinity-manual-unit-hidden-owner-v1' or owner.get('nodePid')!=process.pid or owner.get('parentPid')!=os.getpid() or owner.get('inputSha256')!=input_ref['sha256'] or type(owner.get('chromePid')) is not int or owner['chromePid']<=1 or owner.get('pgid')!=owner['chromePid']:
                raise AssertionError('Owned hidden Chrome group identity mismatch')
            if os.getpgid(owner['chromePid'])!=owner['chromePid']: raise AssertionError('Hidden Chrome must own its registered group')
            owned_group=owner['chromePid']; invocation['ownedProcess']=owner
        elif process.poll() is None: raise TimeoutError('Hidden Chrome ownership was not registered within five seconds')
        stdout,stderr=process.communicate(timeout=max(.001,50-(time.monotonic()-started)))
        invocation['returncode']=process.returncode
    finally:
        # Only groups established by this Popen and its verified launch handshake.
        for group in (owned_group,process.pid if process is not None else None):
            if group is None: continue
            try:
                os.killpg(group,0); invocation.setdefault('forcedCleanupGroups',[]).append(group)
                os.killpg(group,signal.SIGTERM)
                until=time.monotonic()+.5
                while time.monotonic()<until:
                    try: os.killpg(group,0)
                    except ProcessLookupError: break
                    time.sleep(.02)
                try: os.killpg(group,signal.SIGKILL)
                except ProcessLookupError: pass
            except ProcessLookupError: pass
        if process is not None:
            if process.poll() is None: process.wait(timeout=2)
            if not stdout and not stderr:
                stdout,stderr=process.communicate(timeout=1)
        invocation['endedHostMonotonic']=time.monotonic()
        invocation['stdout']=original_bytes('native-hidden-child-stdout',stdout,'txt')
        invocation['stderr']=original_bytes('native-hidden-child-stderr',stderr,'txt')
        persist_json('native-hidden-owned-invocation',invocation)
    child_path=child_dir/'report.json'
    if child_path.is_symlink(): raise AssertionError('Native hidden report must be an ordinary file')
    body=child_path.read_bytes(); child_ref=original_bytes('native-hidden-original-report',body,'json'); value=json.loads(body)
    result_ref=persist_json('native-hidden-result-before-assertion',{'report':child_ref,'result':value,'invocation':invocation,'input':input_ref})
    verify_file_references(value)
    check('independent native Chrome helper completes without forced cleanup',process.returncode==0 and not invocation.get('forcedCleanupGroups'),result_ref)
    check('independent original native hidden report satisfies full parent contract',validate_native_hidden_result(value,request,input_ref['sha256']),result_ref)
    for row in value['checks']: check('native hidden: '+row['name'],row['passed'],row.get('detail'))
    source_bindings.extend(value['sourceBindings']); clock_calls+=len(value['functionalAdvanceCalls'])
    whole_state('hidden-resume-entire-state',value['finalSave']['state'],request['expectedState'])
    set_phase('owned-native-hidden-cleanup'); complete_case()


def transit_flight_draft(page):
    return page.evaluate('''()=>({mission:document.querySelector('#flight-mission').value,
      target:Object.fromEntries(['galaxy','system','position'].map(k=>[k,document.querySelector('#flight-'+k).value])),
      speed:document.querySelector('#flight-speed').value,
      ships:[...document.querySelectorAll('[data-ship]')].map(e=>({unit:e.dataset.ship,raw:e.value})),
      cargo:Object.fromEntries(['metal','crystal','deuterium'].map(k=>[k,document.querySelector('#cargo-'+k).value]))})''')


def valid_transit_flight_draft(value,target):
    """Validate the full real draft without deleting zeroes or coercing inputs."""
    if not isinstance(value,dict) or set(value)!={'mission','target','speed','ships','cargo'}: return False
    if value['mission']!='transport' or value['speed']!='100': return False
    if value['target']!={key:str(target[key]) for key in ('galaxy','system','position')}: return False
    if value['cargo']!={'metal':'0','crystal':'0','deuterium':'0'}: return False
    rows=value['ships']
    if not isinstance(rows,list) or len(rows)!=13: return False
    if any(not isinstance(row,dict) or set(row)!={'unit','raw'} or not isinstance(row['unit'],str) for row in rows): return False
    if len({row['unit'] for row in rows})!=13 or {row['unit'] for row in rows}!=set(TRANSIT_FLYING_IDS): return False
    return all(row['raw']==('2' if row['unit']=='small_cargo' else '0') for row in rows)


def transit_fill():
    begin_case('natural09-paid-flight-does-not-cover-fill'); fixture=fixtures['transit']
    with live_context(fixture['raw']) as (_context,page):
        whole_state('untouched-natural09-start',save(page),fixture['before']); tab(page,'fleet'); select(page,'#flight-mission','transport')
        for key,value in fixture['request']['target'].items():
            page.locator('#flight-'+key).fill(str(value)); page.locator('#flight-'+key).press('Tab')
        page.locator('[data-ship="small_cargo"]').fill('2'); page.locator('[data-ship="small_cargo"]').press('Tab'); advance(page)
        draft=transit_flight_draft(page)
        ref=persist_json('before-natural-flight',{'before':fixture['before'],'expected':fixture['afterDispatch'],'request':fixture['request'],'draft':draft,'literalFlyingCensus':TRANSIT_FLYING_IDS,'storage':all_storage(page)})
        check('complete ordinary draft has exactly thirteen unique flying species, two small cargos, twelve literal zeroes, and exact mission target speed cargo',valid_transit_flight_draft(draft,fixture['request']['target']),ref)
        check('fixture request uses the same complete independent thirteen-field literal census',fixture['request']['ships']=={unit:2 if unit=='small_cargo' else 0 for unit in TRANSIT_FLYING_IDS},ref)
        trusted_click(page,'#space-send'); whole_state('actual-native-natural-two-cargo-flight',save(page),fixture['afterDispatch'])
        ref=persist_json('independent-transit-fill',{'state':fixture['afterDispatch'],'target':1,'added':independent_fill(fixture['afterDispatch'],'small_cargo',1)})
        check('two in-transit ships do not satisfy target-one local fill',independent_fill(fixture['afterDispatch'],'small_cargo',1)==1,ref)
        mode_only_then_pay(page,'small_cargo','fill','1',1,fixture['afterDispatch'],fixture['expected'])


def main():
    global args,out,KEY,ORIGIN,fixtures,browser,CLOCK,checks,evidence,source_bindings,errors,failed_requests,page_sources
    global completed,case,seen_cases,evidence_sequence,recorded_checks,recorded_evidence,journal,release_metadata,failure,clock_calls,clock_seconds,active_page,active_context
    global case_records,context_lifecycle,failure_lifecycle,fixture_sha256,source_binding_sha256,source_identity_value
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--group',required=True,choices=('payments','authority'))
    parser.add_argument('--fixture',required=True); parser.add_argument('--expected-fixture-sha256',required=True)
    parser.add_argument('--natural-report',required=True); parser.add_argument('--source-binding',required=True)
    parser.add_argument('--expected-sha',required=True); parser.add_argument('--expected-version',required=True)
    parser.add_argument('--runtime-node',required=True); parser.add_argument('--output',required=True); parser.add_argument('--chromium',required=True)
    parser.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
    args=parser.parse_args()
    if os.environ.get('CI')!='true' or os.environ.get('GITHUB_ACTIONS')!='true': parser.error('CI-only native acceptance; local browser execution is not authorized.')
    if args.expected_version!=CANDIDATE_VERSION or not re.fullmatch(r'[a-f0-9]{40}',args.expected_sha): parser.error('Exact candidate version and SHA required')
    load_reviewed_helpers()
    out=Path(args.output).resolve(); out.mkdir(parents=True,exist_ok=False)
    checks,evidence,source_bindings,errors,failed_requests=[],[],[],[],[]; page_sources={}; completed=False; case=None; seen_cases=set(); case_records=[]
    evidence_sequence=recorded_checks=recorded_evidence=clock_calls=clock_seconds=0; failure=release_metadata=active_page=active_context=None
    context_lifecycle={}; failure_lifecycle=fixture_sha256=source_binding_sha256=source_identity_value=browser=None
    journal=NativeCheckJournal(out/'manual-unit-checks.jsonl')
    try:
        begin_case('setup'); set_phase('source-and-fixture-binding')
        runtime_ref=persist_json('actual-native-job-identity',{'group':args.group,'identity':runtime_identity(),'expectedJob':GROUP_JOBS[args.group]})
        check('actual GitHub job source and role match the required fixed group',valid_runtime_identity(args.group,runtime_identity(),args.expected_sha),runtime_ref)
        source=source_identity(ROOT,args.expected_sha); source_identity_value=source; persist_json('full-committed-source-binding',source)
        fixture_bytes=Path(args.fixture).read_bytes(); natural_bytes=Path(args.natural_report).read_bytes(); binding_bytes=Path(args.source_binding).read_bytes()
        fixture_sha256=digest(fixture_bytes); source_binding_sha256=digest(binding_bytes)
        fixtures=json.loads(fixture_bytes); old_binding=json.loads(binding_bytes)
        refs={'fixture':original_bytes('fixture',fixture_bytes,'json'),'natural':original_bytes('fresh241a-natural-report',natural_bytes,'json'),'sourceBinding':original_bytes('fresh241a-source-binding',binding_bytes,'json')}
        check('fixture bound to current source runtime and exact fresh natural producer',digest(fixture_bytes)==args.expected_fixture_sha256 and fixtures['source']['sourceSha']==args.expected_sha and fixtures['source']['fullTree']==source['fullTree'] and fixtures['source']['runtimeNode']==args.runtime_node and digest(natural_bytes)==REPORT_SHA and fixtures['historical']['reportSha256']==REPORT_SHA and fixtures['historical']['sourceBindingSha256']==digest(binding_bytes) and old_binding['complete'] is True and old_binding['codeSourceSha']==OLD_SHA,refs)
        check('all24 independent literal catalog matches fixture golden',set(fixtures['golden'])==set(GOLDEN) and all(tuple(fixtures['golden'][k])==v for k,v in GOLDEN.items()),refs)
        KEY=fixtures['key']; parsed=urlparse(args.url); ORIGIN=f'{parsed.scheme}://{parsed.netloc}'
        if parsed.scheme not in ('http','https') or not args.url.endswith('/'): raise ValueError('Actual production origin URL required')
        tree=ast.parse((ROOT/'scripts/browser-npc-attack.py').read_text()); node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CLOCK' for t in n.targets))
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<unchanged-functional-clock>','exec'),globals())
        signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('660-second native worker bound'))); signal.alarm(660)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as playwright:
            try:
                set_phase('launch-headed-browser'); browser=playwright.chromium.launch(executable_path=args.chromium,headless=False)
                complete_case()
                if args.group=='payments':
                    natural_route(); transit_fill(); invalid_and_all_units(); legal_raw_payment(); four_widths()
                else:
                    invalid_and_all_units(); rejected_boundaries(); latest_plan(); lifecycle_and_hostile_dom(); rejected_import_attempts(); protection_boundary(); hidden_resume()
                begin_case('suite-integrity'); ref=persist_json('actual-browser-errors',{'errors':errors,'failedRequests':failed_requests})
                check('no application errors or failed production requests',not errors and not failed_requests,ref)
                census_ref=persist_json('actual-completed-case-census',case_census())
                check('fixed group completed every original scenario exactly once',case_census()['completedCases']==list(GROUP_CASES[args.group]) and seen_cases==set(GROUP_CASES[args.group])|set(INFRASTRUCTURE_CASES),census_ref)
                set_phase('browser-cleanup'); browser.close(); complete_case()
            except BaseException:
                # This boundary remains inside the live Playwright lifetime.
                capture_failure(active_page)
                if browser is not None:
                    try: browser.close()
                    except BaseException as error: journal.append('diagnostic-error',{'name':'browser-cleanup','error':repr(error)})
                raise
        completed=True; flush(final=True)
    except BaseException:
        completed=False
        # All live pages were captured before leaving Playwright. Setup failures
        # have no page, and must never reuse a previously closed app page.
        if failure is None: capture_failure(None)
        flush(final=True); raise
    finally: signal.alarm(0); os.close(journal.fd)


if __name__=='__main__': main()
