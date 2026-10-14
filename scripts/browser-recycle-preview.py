"""CI-only bounded readonly recycling-preview native acceptance.
The input is an explicitly funded/prerequisite/seed-selected synthetic deep fixture.
Only the fixture producer pays, arrives, battles and returns through real engine rules.
Browser evidence starts from that strict checkpoint: no natural-progression claim.
Date/performance/RAF are the established controlled functional clock, advanced ONLY
by zero. Native Storage/File/input/timers and production modules remain unchanged.
Existing paid native browser-deep and every existing gate remain independently required.
"""
import argparse
import ast
import copy
import hashlib
import json
import math
import os
import re
import signal
import subprocess
import sys
import time
import traceback
from contextlib import contextmanager
from decimal import Decimal, ROUND_FLOOR, localcontext
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
HOST_STARTED_MONOTONIC = time.monotonic()
WIDTHS = (320, 390, 768, 1440)
CANDIDATE_VERSION = '0.6.32-alpha.1'
NATIVE_CLASSIFICATION = 'Explicit synthetic-origin real-engine paid battle/debris/return checkpoint; native readonly UI evidence only. Zero-only controlled functional clock. No natural progression, native payment, timing or paint claim.'
SOURCE_AREAS = ('src', 'scripts', 'tests', 'public', '.github')
PANEL = '#recycle-preview'
DETAILS = '[data-recycle="details"]'
SUMMARY = DETAILS + ' > summary'
DRAFT_SELECTOR = '[data-ship],#flight-mission,#flight-speed,#flight-galaxy,#flight-system,#flight-position,#cargo-metal,#cargo-crystal,#cargo-deuterium,#charge-slots,#charge-bets'
REQUIRED_CASES = {'native-checkpoint-debris-route', 'one-recycler', 'two-recyclers', 'carried-cargo',
 'speed-change', 'missing-known-field', 'invalid-draft', 'other-missions', 'stable-details-focus',
 'width-320', 'width-390', 'width-768', 'width-1440', 'explicit-external-protection'}
NOTICE = '仅按当前可见残骸、当前舰船与货物及当前超空间科技计算；抵达前残骸或科技可能变化，实际以抵达时结算为准。燃料由正式派遣扣除，回收计算不再次扣除；回收货物返航后才入库。预览不会派遣、占用或预留残骸。'


def load_reviewed_helpers():
    """Bounded AST definitions only; never execute another runner or its main."""
    names = {'load_shared_helpers', 'tab', 'raw', 'storage', 'capture_live_failure',
             'live_failure_evidence', 'dispose_capture_handles'}
    tree = ast.parse((ROOT / 'scripts/browser-scout-rehearsal.py').read_text())
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]
    if {n.name for n in nodes} != names: raise RuntimeError('Reviewed native helper contract changed')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed-recycle-native-helpers>', 'exec'), globals())
    load_shared_helpers()


def independent_amounts(field, recyclers, cargo, hyperspace=2):
    """Independent Decimal rational oracle for bounded integer acceptance inputs.
    This imports no production helper/model. The TypeScript fixture additionally
    retains the pre-refactor engine Decimal operation order and both must agree.
    """
    if type(recyclers) is not int or recyclers < 0 or type(hyperspace) is not int or hyperspace < 0:
        raise ValueError('Nonnegative integer fleet and technology required')
    with localcontext() as context:
        context.prec = 100
        m, c = Decimal(field['metal']), Decimal(field['crystal'])
        values = [Decimal(cargo[key]) for key in ('metal', 'crystal', 'deuterium')]
        if any(not n.is_finite() or n < 0 for n in [m, c, *values]): raise ValueError('Finite nonnegative amounts required')
        capacity = Decimal(20000) * recyclers * (1 + Decimal('.05') * hyperspace)
        used = sum(values, Decimal(0)); room = min(max(capacity - used, Decimal(0)), capacity)
        total = m + c; take = min(room, total)
        metal = (take * m / total).to_integral_value(rounding=ROUND_FLOOR) if total > 0 else Decimal(0)
        crystal = min(take - metal, c).to_integral_value(rounding=ROUND_FLOOR)
        def text(value):
            result = format(value, 'f')
            return result.rstrip('0').rstrip('.') if '.' in result else result
        return {key: text(value) for key, value in {'capacity': capacity, 'collector': capacity, 'used': used,
            'room': room, 'metal': metal, 'crystal': crystal, 'leftMetal': m-metal, 'leftCrystal': c-crystal}.items()}


def validate_fixture(value, original_bytes, source, runtime_node):
    """Fail closed on provenance, exact raw, skipped real steps and wrong amounts."""
    expected_source = {'sourceSha': source['sourceSha'], 'fullTree': source['fullTree'],
        'scriptSha256': source['sourceCode']['scripts/recycle-preview-fixture.ts'],
        'inputProducerSha256': source['sourceCode']['scripts/deep-fixture.ts'],
        'dependencyLockSha256': source['sourceCode']['package-lock.json'], 'runtimeNode': runtime_node}
    if value.get('schema') != 'infinity-recycle-preview-fixture-v1' or value.get('source') != expected_source:
        raise ValueError('Exact committed fixture producer/runtime required')
    if value.get('classification') != 'explicit-synthetic-origin-real-engine-transitions':
        raise ValueError('Ambiguous source classification')
    p = value.get('provenance', {})
    if any(p.get(key) is not True for key in ('syntheticInitialFunds', 'syntheticInitialPrerequisites', 'seedSelectedForPirate')) or any(p.get(key) is not False for key in ('naturalProgression', 'nativeBrowserPayments', 'directStatePatchesAfterInput')):
        raise ValueError('Synthetic origin and real transition classification required')
    original = original_bytes.decode()
    if value['input']['raw'] != original or value['input']['rawSha256'] != hashlib.sha256(original_bytes).hexdigest() or value['input']['envelope'] != json.loads(original):
        raise ValueError('Complete original pirate bytes required')
    if value['input']['producer'] != 'scripts/deep-fixture.ts pirate': raise ValueError('Original producer required')
    steps = value['steps']
    if [row['name'] for row in steps] != ['paid-dispatch', 'outbound-arrival', 'pirate-battle', 'survivors-returned']:
        raise ValueError('Complete paid battle/return route required')
    prior = value['input']['envelope']['state']
    for index, row in enumerate(steps):
        if row['before'] != prior or json.loads(row['raw'])['state'] != row['result'] or hashlib.sha256(row['raw'].encode()).hexdigest() != row['rawSha256']:
            raise ValueError('Entire contiguous engine state and raw required')
        if row['operation']['kind'] != ('sendFleet' if index == 0 else 'tick'):
            raise ValueError('Actual paid send/tick operations required')
        prior = row['result']
    if value['base'] != json.loads(value['initialRaw']) or value['base']['state'] != prior or hashlib.sha256(value['initialRaw'].encode()).hexdigest() != value['initialRawSha256']:
        raise ValueError('Exact strict final checkpoint required')
    if (value.get('adoptionScope') != 'Expected bytes after native load and explicit Save; loading alone retains initialRaw'
      or hashlib.sha256(value['adoptedRaw'].encode()).hexdigest() != value['adoptedRawSha256']
      or json.loads(value['adoptedRaw']) != value['base']):
        raise ValueError('Separate exact post-load explicit Save bytes required')
    if value['base']['version'] != 9 or value['base']['revision'] != 16 or value['base']['savedAt'] != value['base']['lastTickAt']:
        raise ValueError('Unchanged v9/r16 zero-gap envelope required')
    battle = steps[2]['result']['deepSpace']['reports'][0]
    if battle['symbol'] != 'pirate' or not 1 <= len(battle['battle']['rounds']) <= 6 or not prior['deepSpace']['reports'][0]['returned'] or prior['fleets']:
        raise ValueError('Real pirate battle and survivor return required')
    if prior['deepSpace']['debris'] != [value['field']]: raise ValueError('Actual visible battle debris required')
    if [row['name'] for row in value['cases']] != ['one-recycler', 'two-recyclers', 'carried-cargo', 'speed-change']:
        raise ValueError('All exact native draft cases required')
    specs=[(1,('0','0','0'),100),(2,('0','0','0'),100),(1,('1000','1000','500'),100),(1,('1000','1000','500'),50)]
    for row,(count,cargo,speed) in zip(value['cases'],specs):
        req = row['request']
        if req['ships']!={'recycler':count} or req['cargo']!=dict(zip(('metal','crystal','deuterium'),cargo)) or req['speedPercent']!=speed:
            raise ValueError('Exact one/two/carried/speed drafts required')
        expected = independent_amounts(value['field'], req['ships']['recycler'], req['cargo'], prior['research']['levels']['hyperspace_tech'])
        if req['mission'] != 'recycle' or req['target'] != value['field']['target'] or not row['quote']['ok'] or row['expected'] != expected:
            raise ValueError('Independent salvage amount or legal quote mismatch')
    gold = value['literalGoldens']
    if gold['debris']!={'metal':'40000','crystal':'20000'} or gold['hyperspace']!=2: raise ValueError('Fixed literal golden inputs required')
    if gold['classification'] != 'independent-synthetic-arithmetic-only-not-browser-fixtures': raise ValueError('Arithmetic golden classification required')
    for label, cargo in [('one', {'metal':'0','crystal':'0','deuterium':'0'}), ('carried', {'metal':'1000','crystal':'1000','deuterium':'500'})]:
        if gold[label] != independent_amounts(gold['debris'], 1, cargo, gold['hyperspace']): raise ValueError('Literal arithmetic golden mismatch')
    return True


def metadata(full=False):
    result = {'schema': 'infinity-recycle-preview-native-v1', 'completed': completed,
      'result': 'passed' if completed else 'incomplete', 'case': case, 'sourceSha': args.expected_sha,
      'sourceTree': source_tree, 'candidateVersion': CANDIDATE_VERSION, 'fixtureSha256': fixture_sha256,
      'inputSha256': args.expected_input_sha256, 'failure': failure, 'checkCount': len(checks),
      'evidenceCount': len(evidence), 'passed': passed_count, 'failed': failed_count,
      'hostElapsedSeconds': time.monotonic()-HOST_STARTED_MONOTONIC, 'clockCalls': clock_calls,
      'clockMillisecondsAdvanced': 0, 'workerBoundSeconds': 220, 'supervisorBoundSeconds': 240,
      'classification': NATIVE_CLASSIFICATION,
      'acceptanceRule': 'Additional evidence only; all unchanged existing required CI jobs and aggregate must pass at this exact source SHA.',
      'completedCases': sorted(completed_cases)}
    if full: result.update(checks=checks, evidence=evidence, sourceBindings=source_bindings, errors=errors,
        failedRequests=failed_requests, fullSourceBinding=full_source_reference)
    return result


def flush(full=False, final=False):
    global last_progress_at
    journal.sync(checks, evidence, full=full)
    value = metadata(full)
    journal.append('snapshot', {key: item for key, item in value.items() if key not in ('checks','evidence')})
    if full:
        atomic_json(report_path, value)
        if final: journal.append('seal', {'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(), 'checkCount': len(checks), 'evidenceCount': len(evidence)})
    if full or time.monotonic()-last_progress_at >= 1:
        atomic_json(progress_path, metadata()); last_progress_at = time.monotonic()


def persist_json(label, value):
    global witness_sequence
    witness_sequence += 1
    directory = out / ('context-%02d' % context_sequence) / re.sub(r'[^a-zA-Z0-9_-]', '-', case)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ('%06d-' % witness_sequence + re.sub(r'[^a-zA-Z0-9_-]', '-', label) + '.json')
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False); handle.write('\n')
        handle.flush(); os.fsync(handle.fileno())
    ref = {'kind':'raw-before-assertion', 'case':case, 'file':path.relative_to(out).as_posix(), 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    evidence.append(ref)
    return ref


def check(name, condition, detail=None):
    global passed_count, failed_count
    # Helper observations also get exclusive durable originals before the assertion.
    ref = persist_json('assert-'+name, {'name':name, 'before': detail, 'expected':True, 'actual':bool(condition), 'originalObservation':detail})
    passed = bool(condition)
    checks.append({'case':case, 'name':name, 'passed':passed, 'detail':ref})
    passed_count += int(passed); failed_count += int(not passed); flush()
    if not passed: raise AssertionError(name)


def begin_case(label):
    global case
    case=label; flush()


def finish_case():
    completed_cases.add(case); flush()


def advance(page, milliseconds=0):
    global clock_calls
    if milliseconds != 0: raise ValueError('Readonly acceptance permits ONLY zero-time functional frames')
    value=page.evaluate('(ms)=>window.__npcAdvance(ms)', 0); clock_calls+=1
    check('functional observation advances zero milliseconds', value['afterAt']==value['beforeAt'], value)


def save(page):
    tab(page,'save'); trusted_click(page,'[data-action="save"]')
    value=raw(page)
    persist_json('real-save-memory-checkpoint', {'raw':value,'storage':all_storage(page),'state':json.loads(value)['state']})
    return json.loads(value)['state']


def whole_state(name, actual, expected):
    ref=persist_json(name, {'before':expected,'expected':expected,'actual':actual,'excludedFields':[]})
    check(name+': real save complete memory state unchanged', exact_json(actual, expected), ref)


def boot(initial_raw, width=1440):
    global active_page, context_sequence
    context_sequence += 1
    entries=[{'name':KEY,'value':initial_raw},{'name':'infinity.ui.tab','value':'overview'},
             {'name':'infinity.save.v1','value':'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    context=browser.new_context(viewport={'width':width,'height':1100}, reduced_motion='reduce',
        storage_state={'cookies':[],'origins':[{'origin':ORIGIN,'localStorage':entries}]})
    contexts.append(context)
    context.add_init_script(CLOCK.replace('__EPOCH__',str(json.loads(initial_raw)['savedAt'])))
    page=context.new_page(); active_page=page; attach(page)
    response=page.goto(args.url,wait_until='networkidle')
    verify_bundle(page); verify_document_response(response); advance(page)
    check('native Storage File confirmation timers remain unchanged',page.evaluate('window.__npcNative'))
    return context,page


def all_storage(page):
    return {'local': storage(page), 'session': page.evaluate('Object.fromEntries(Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)]))')}

def source_identity(workspace, expected_sha):
    """Read-only Git full-tree binding, including tracked bytes and file modes."""
    workspace = Path(workspace)
    def git(*arguments): return subprocess.check_output(['git', '-C', str(workspace), *arguments])
    if (not re.fullmatch(r'[0-9a-f]{40}', expected_sha)
            or git('rev-parse', 'HEAD').decode().strip() != expected_sha or git('diff', 'HEAD', '--')):
        raise ValueError('Exact clean committed source required')
    if git('status', '--porcelain=v1', '--untracked-files=all', '--', *SOURCE_AREAS,
           'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts'):
        raise ValueError('Dirty source scope')
    for flags in ((), ('--ignored',)):
        if git('ls-files', '--others', *flags, '--exclude-standard', '--', *SOURCE_AREAS):
            raise ValueError('Untracked or ignored source-scope input')
    files, modes = {}, {}
    for entry in git('ls-tree', '-r', '-z', expected_sha).split(b'\0'):
        if not entry: continue
        metadata, path_bytes = entry.split(b'\t', 1); mode, kind, blob = metadata.decode().split()
        relative = path_bytes.decode(); path = workspace
        for part in Path(relative).parts:
            if part in ('..', '/') or path.is_symlink(): raise ValueError('Nonlocal tracked source')
            path /= part
        if kind != 'blob' or mode not in ('100644', '100755') or path.is_symlink() or not path.is_file():
            raise ValueError('Ordinary tracked source file required: ' + relative)
        body = path.read_bytes()
        if (hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() != blob
                or bool(path.stat().st_mode & 0o111) != (mode == '100755')):
            raise ValueError('Tracked source bytes/mode mismatch: ' + relative)
        files[relative] = hashlib.sha256(body).hexdigest(); modes[relative] = mode
    if json.loads((workspace / 'package.json').read_bytes())['version'] != CANDIDATE_VERSION:
        raise ValueError('Candidate version must be exactly ' + CANDIDATE_VERSION)
    return {'sourceSha': expected_sha, 'fullTree': git('rev-parse', 'HEAD^{tree}').decode().strip(),
            'sourceCode': files, 'sourceModes': modes}

def control_proof(page, selector, label, capture=False):
    native_scroll_to(page, selector)
    proof = visibility(page, [selector]); glyphs = text_leaf_visibility(page, [selector])
    check(label + ': complete target has five genuine unobstructed native hit points',
          len(proof['targets']) == 1 and all(row['visible'] and row['contained'] and len(row['points']) == 5
          and all(point['unoccluded'] for point in row['points']) for row in proof['targets']), proof)
    check(label + ': all actual glyphs fit viewport and ancestor clips', all(row['passed'] for row in glyphs['leaves']), glyphs)
    check(label + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    if capture: snap(page, label + '.png')

def supervise():
    """Bounded process tree cleanup and durable prefix recovery, same old contract."""
    if any(out.iterdir()): raise SystemExit('Use a new empty evidence directory')
    atomic_json(report_path, {'completed': False, 'result': 'starting', 'checks': []})
    owned = {}
    def process_info(pid):
        try:
            fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
            return {'pid': pid, 'birth': fields[19], 'state': fields[0]}
        except (OSError, IndexError, ValueError): return None
    def collect(root):
        pending, seen = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in seen: continue
            seen.add(pid); info = process_info(pid)
            if info is None or pid in owned and owned[pid] != info['birth']: continue
            owned[pid] = info['birth']
            for path in Path(f'/proc/{pid}/task').glob('*/children'):
                try: pending.extend(map(int, path.read_text().split()))
                except OSError: pass
    def terminate(sig):
        for pid, birth in reversed(list(owned.items())):
            info = process_info(pid)
            if info and info['birth'] == birth:
                try: os.kill(pid, sig)
                except ProcessLookupError: pass
    expired, code = False, 1
    with (out / 'worker.log').open('w') as log:
        worker = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'], stdout=log,
                                  stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 228
        try:
            while True:
                collect(worker.pid); remaining = deadline - time.monotonic()
                if remaining <= 0: expired = True; break
                try: code = worker.wait(timeout=min(.2, remaining)); break
                except subprocess.TimeoutExpired: pass
        finally:
            collect(worker.pid); terminate(signal.SIGTERM)
            try: worker.wait(timeout=2)
            except subprocess.TimeoutExpired: pass
            time.sleep(.1); terminate(signal.SIGKILL); worker.wait(timeout=2)
    residual = [info for pid, birth in owned.items() if (info := process_info(pid)) and info['birth'] == birth]
    live = [row for row in residual if row['state'] not in ('Z', 'X')]
    report = recover_native_report(journal_path, report_path, progress_path, not (expired or code or live))
    report['workerExitCode'] = code
    report['processCleanup'] = {'observedProcessCount': len(owned), 'terminalObservedResiduals': residual,
                                'terminalObservedLiveCount': len(live),
                                'boundary': 'Only observed descendants with matching PID/start time signaled; no claim about unobserved fast orphans.'}
    if expired or code or live: report.update(completed=False, result='watchdog-timeout' if expired else 'failed')
    atomic_json(report_path, report)
    print(json.dumps({'completed': report.get('completed'), 'checks': len(report.get('checks', [])), 'report': str(report_path)}))
    sys.exit(code if code else 0 if report.get('completed') else 1)

CAPTURE_REFERENCES = '''()=>{const panel=document.querySelector('#recycle-preview');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);return{panel,nodes,ancestors};}'''
CAPTURE_STATE = '''refs=>{const panel=document.querySelector('#recycle-preview');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const state=n=>{const s=getComputedStyle(n);return{tag:n.tagName,id:n.id,connected:n.isConnected,
style:n.getAttribute('style'),hidden:n.getAttribute('hidden'),ariaHidden:n.getAttribute('aria-hidden'),
display:s.display,visibility:s.visibility,opacity:s.opacity,value:'value'in n?n.value:null,
disabled:'disabled'in n?n.disabled:null,open:'open'in n?n.open:null};};
return{samePanel:refs.panel===panel,sameNodes:same(refs.nodes,nodes),sameAncestors:same(refs.ancestors,ancestors),
allConnected:[...refs.nodes,...refs.ancestors].every(n=>n.isConnected),html:panel?.innerHTML,
activeId:document.activeElement?.id,nodes:refs.nodes.map(state),ancestors:refs.ancestors.map(state)};}'''


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    refs=page.evaluate_handle(CAPTURE_REFERENCES)
    directory=out/('context-%02d'%context_sequence)/case; directory.mkdir(parents=True,exist_ok=True)
    path=directory/name
    if path.exists(): raise ValueError('Screenshot evidence must be exclusive')
    witness={'caret':'initial','case':case,'before':refs.evaluate(CAPTURE_STATE),'storageBefore':all_storage(page),'controlsBefore':controls(page)}
    persist_json('screenshot-before',witness)
    try:
        try:
            page.screenshot(path=str(path),full_page=False,timeout=7000,caret='initial')
            evidence.append({'kind':'screenshot','case':case,'file':path.relative_to(out).as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        finally:
            witness['after']=refs.evaluate(CAPTURE_STATE)
            witness['storageAfter']=all_storage(page); witness['controlsAfter']=controls(page)
            ref=persist_json('screenshot-after',witness)
        check('caret=initial screenshot has zero input DOM state or storage mutation', witness['before']==witness['after']
              and witness['storageBefore']==witness['storageAfter'] and witness['controlsBefore']==witness['controlsAfter']
              and all(witness['after'][key] for key in ('samePanel','sameNodes','sameAncestors','allConnected')),ref)
    finally: dispose_capture_handles(refs)


def controls(page):
    return page.evaluate('''selector=>({draft:[...document.querySelectorAll(selector)].map(e=>({id:e.id,ship:e.dataset.ship||null,
      value:e.value,checked:'checked'in e?e.checked:null,disabled:e.disabled})),
      quote:document.querySelector('#space-quote').textContent,
      send:{disabled:document.querySelector('#space-send').disabled,text:document.querySelector('#space-send').textContent},
      selectedPlanet:document.querySelector('[data-bind="planet-select"]')?.value??null})''',DRAFT_SELECTOR)


def observed(page):
    return page.evaluate('''()=>{const p=document.querySelector('#recycle-preview');return {hidden:p.hidden,
      visible:!!p.getClientRects().length,detailsOpen:p.querySelector('details').open,detailsHidden:p.querySelector('details').hidden,
      fields:Object.fromEntries([...p.querySelectorAll('[data-recycle]')].filter(e=>e.dataset.recycle!=='details').map(e=>[e.dataset.recycle,e.textContent])),
      protectionHidden:p.querySelector('[data-recycle="protection"]').hidden};}''')


def expected_fields(spec):
    a=spec['expected']; field=fixtures['field']; target=field['target']; key=':'.join(str(target[k]) for k in ('galaxy','system','position'))
    return {'summary':f"预计回收（当前条件）：金属 {a['metal']} · 晶体 {a['crystal']}",
      'target':f'目标 [{key}]', 'field':f"当前可见残骸：金属 {field['metal']} · 晶体 {field['crystal']}",
      'capacity':f"总货舱 {a['capacity']} · 回收船上限 {a['collector']}",
      'room':f"现有货物占用 {a['used']} · 剩余可回收货舱 {a['room']}（受回收船上限约束）",
      'leftovers':f"按当前残骸计算的剩余：金属 {a['leftMetal']} · 晶体 {a['leftCrystal']}",
      'notice':NOTICE,'protection':''}


def assert_preview(page,spec):
    actual=observed(page); ordinary=controls(page)
    expected=expected_fields(spec)
    ref=persist_json('independent-preview-originals',{'before':fixtures['base']['state'],'expected':expected,'actual':actual,
        'request':spec['request'],'expectedQuote':spec['quote'],'expectedQuoteText':spec['quoteText'],'actualControls':ordinary})
    check('current known field preview equals independent exact amounts and notices',not actual['hidden'] and actual['visible']
          and not actual['detailsHidden'] and actual['protectionHidden'] and actual['fields']==expected,ref)
    check('original legal selected quote and dispatch eligibility are unchanged', ordinary['quote']==spec['quoteText'] and ordinary['send']['disabled'] is False,ref)


def configure(page,spec):
    request=spec['request']; original=controls(page); original_storage=all_storage(page); expected=copy.deepcopy(original)
    values={'flight-mission':'recycle','flight-speed':str(request['speedPercent']),
      **{'flight-'+key:str(value) for key,value in request['target'].items()},
      **{'cargo-'+key:str(value) for key,value in request['cargo'].items()}}
    for row in expected['draft']:
        if row['ship']: row['value']=str(request['ships'].get(row['ship'],0))
        elif row['id'] in values: row['value']=values[row['id']]
    persist_json('intentional-draft-edits-before',{'before':original,'expectedDraft':expected['draft'],'request':request,'storageBefore':original_storage})
    for field in page.locator('[data-ship]').all():
        value=str(request['ships'].get(field.get_attribute('data-ship'),0))
        if field.input_value()!=value: input_number(page,'[data-ship="'+field.get_attribute('data-ship')+'"]',value)
    for key,value in values.items():
        selector='#'+key
        if page.locator(selector).input_value()==value: continue
        if key in ('flight-mission','flight-speed'): select(page,selector,value)
        else: input_number(page,selector,value)
    advance(page)
    actual=controls(page)
    ref=persist_json('intentional-draft-edits-after',{'before':original,'expectedDraft':expected['draft'],'actual':actual,'storageBefore':original_storage,'storageAfter':all_storage(page),'excludedDraftFields':[]})
    check('only exact intentional draft edits occurred',actual['draft']==expected['draft'] and all_storage(page)==original_storage,ref)


def readonly_observation(page,spec,label,action=None):
    baseline=save(page); whole_state(label+'-before',baseline,fixtures['base']['state']); tab(page,'fleet')
    assert_preview(page,spec)
    before={'storage':all_storage(page),'controls':controls(page),'preview':observed(page)}
    persist_json(label+'-before-readonly',{'before':before,'expectedState':baseline})
    if action: action()
    else:
        for _ in range(2): advance(page)
    after={'storage':all_storage(page),'controls':controls(page),'preview':observed(page)}
    ref=persist_json(label+'-after-readonly',{'before':before,'expectedStorage':before['storage'],'expectedControls':before['controls'],'actual':after})
    check('readonly observation changes no draft quote authority local or session bytes',after['storage']==before['storage'] and after['controls']==before['controls'],ref)
    assert_preview(page,spec)
    whole_state(label+'-after',save(page),baseline); tab(page,'fleet')


def toggle(page,opening,keyboard=None):
    before={'storage':all_storage(page),'controls':controls(page),'preview':observed(page)}
    persist_json('details-toggle-before',{'before':before,'expectedOpen':opening})
    native_scroll_to(page,SUMMARY)
    if keyboard:
        page.locator(SUMMARY).focus(); page.locator(SUMMARY).press(keyboard)
    else: page.locator(SUMMARY).click()
    advance(page)
    after={'storage':all_storage(page),'controls':controls(page),'preview':observed(page)}
    ref=persist_json('details-toggle-after',{'before':before,'expectedOpen':opening,'actual':after})
    check('native details toggle changes only disclosure and never legal quote draft storage',after['preview']['detailsOpen'] is opening
      and before['controls']==after['controls'] and before['storage']==after['storage'],ref)


def native_width_wheel(page,width):
    before=page.evaluate('()=>({scrollY,height:innerHeight,documentHeight:document.scrollingElement.scrollHeight,eventCount:window.__npcWheels.length})')
    delta=-350 if before['scrollY']>0 else 350
    persist_json('native-width-wheel-before',{'before':before,'requestedDeltaY':delta})
    page.mouse.move(width-12,before['height']-12); page.mouse.wheel(0,delta)
    wait_for_scroll_settled(page,'#space-fleet')
    after=page.evaluate('(count)=>({scrollY,height:innerHeight,documentHeight:document.scrollingElement.scrollHeight,events:window.__npcWheels.slice(count)})',before['eventCount'])
    ref=persist_json('native-width-wheel-after',{'before':before,'requestedDeltaY':delta,'actual':after})
    scrollable=before['documentHeight']>before['height']
    check('four-width native wheel is trusted and settled with real scroll geometry',
      any(event['trusted'] and event['deltaY']==delta for event in after['events'])
      and (not scrollable or after['scrollY']!=before['scrollY']),ref)


def main_cases(page):
    begin_case('native-checkpoint-debris-route')
    before_raw=raw(page)
    ref=persist_json('cold-original-before-save',{'originalRaw':fixtures['initialRaw'],'actualRaw':before_raw})
    check('native load retains exact original raw before explicit Save',before_raw==fixtures['initialRaw'],ref)
    whole_state('cold-strict-checkpoint',save(page),fixtures['base']['state'])
    after_raw=raw(page)
    ref=persist_json('cold-explicit-save-bytes',{'originalRaw':before_raw,'expectedRaw':fixtures['adoptedRaw'],'actualRaw':after_raw})
    check('explicit Save emits exact independently stable adopted bytes',after_raw==fixtures['adoptedRaw'],ref)
    tab(page,'deep')
    target=':'.join(str(fixtures['field']['target'][key]) for key in ('galaxy','system','position'))
    button='#deep-debris [data-mission="recycle"][data-coordinate="'+target+'"]'
    ref=persist_json('actual-debris-route-before',{'state':fixtures['base']['state'],'expectedTarget':target,
        'debrisText':page.locator('#deep-debris').inner_text(),'buttonCount':page.locator(button).count(),'controls':controls(page)})
    check('actual visible debris offers exact recycle route',page.locator(button).count()==1,ref)
    trusted_click(page,button)
    check('actual debris route opens fleet with recycle mission and actual coordinates',page.locator('#space-fleet').is_visible()
        and page.locator('#flight-mission').input_value()=='recycle'
        and ':'.join(page.locator('#flight-'+key).input_value() for key in ('galaxy','system','position'))==target,controls(page))
    finish_case()
    for spec in fixtures['cases']:
        begin_case(spec['name']); configure(page,spec); readonly_observation(page,spec,spec['name']); finish_case()
    spec=fixtures['cases'][0]; configure(page,spec)
    begin_case('missing-known-field')
    old=controls(page); expected=copy.deepcopy(old['draft']); missing=1 if fixtures['field']['target']['position']!=1 else 2
    for row in expected:
        if row['id']=='flight-position': row['value']=str(missing)
    persist_json('missing-field-before',{'before':old,'expectedDraft':expected})
    input_number(page,'#flight-position',missing)
    value=observed(page); current=controls(page)
    ref=persist_json('missing-field-after',{'before':old,'expectedDraft':expected,'actual':current,'preview':value})
    check('missing field never fabricates zero amounts or keeps old salvage',current['draft']==expected and current['send']['disabled']
      and '当前没有可见残骸' in value['fields']['summary'] and all(value['fields'][key]=='' for key in ('capacity','room','leftovers')),ref)
    whole_state('missing-field-memory',save(page),fixtures['base']['state']); tab(page,'fleet'); finish_case()
    configure(page,spec)
    begin_case('invalid-draft'); before=controls(page)
    expected=copy.deepcopy(before['draft'])
    for row in expected:
        if row['ship']=='recycler': row['value']='0'
    persist_json('invalid-draft-before',{'before':before,'expectedDraft':expected})
    input_number(page,'[data-ship="recycler"]',0); value=observed(page); current=controls(page)
    ref=persist_json('invalid-draft-after',{'before':before,'expectedDraft':expected,'actual':current,'preview':value})
    check('invalid no-recycler draft stays unavailable without invented quantities',current['draft']==expected and current['send']['disabled']
       and '回收任务需要回收船' in value['fields']['summary'] and all(value['fields'][key]=='' for key in ('capacity','room','leftovers')),ref)
    whole_state('invalid-draft-memory',save(page),fixtures['base']['state']); tab(page,'fleet'); finish_case()
    configure(page,spec)
    begin_case('other-missions')
    for mission in ('transport','deploy','colonize','scout','charge','attack'):
        before=controls(page); expected=copy.deepcopy(before['draft'])
        for row in expected:
            if row['id']=='flight-mission': row['value']=mission
        persist_json('non-recycle-before',{'before':before,'expectedDraft':expected,'mission':mission})
        select(page,'#flight-mission',mission); actual=observed(page); current=controls(page)
        ref=persist_json('non-recycle-after',{'before':before,'expectedDraft':expected,'actual':current,'preview':actual})
        check('no recycling preview for '+mission,actual['hidden'] and not actual['visible'] and not actual['detailsOpen']
          and all(value=='' for value in actual['fields'].values()) and current['draft']==expected,ref)
    whole_state('other-missions-memory',save(page),fixtures['base']['state']); tab(page,'fleet'); finish_case()
    configure(page,spec)
    begin_case('stable-details-focus')
    def focus_case():
        toggle(page,True); field=page.locator('[data-ship="recycler"]'); field.focus()
        refs=page.evaluate_handle(CAPTURE_REFERENCES)
        try:
            before=refs.evaluate(CAPTURE_STATE); persist_json('focused-before',before)
            for _ in range(3): advance(page)
            after=refs.evaluate(CAPTURE_STATE); ref=persist_json('focused-after',{'before':before,'expected':before,'actual':after})
            check('ordinary frames preserve open details same nodes and focused native draft',before==after and page.locator(DETAILS).evaluate('(e)=>e.open')
              and field.evaluate('(e)=>e===document.activeElement'),ref)
        finally: dispose_capture_handles(refs)
        toggle(page,False,keyboard='Enter'); toggle(page,True,keyboard='Space'); toggle(page,False)
    readonly_observation(page,spec,'stable-details-focus',focus_case); finish_case()
    for width in WIDTHS:
        begin_case('width-'+str(width)); page.set_viewport_size({'width':width,'height':1100}); advance(page)
        def inspect_width():
            native_width_wheel(page,width)
            control_proof(page,'[data-recycle="summary"]',f'{width}-summary',capture=True)
            toggle(page,True)
            for key in ('target','field','capacity','room','leftovers','notice'):
                control_proof(page,'[data-recycle="'+key+'"]',f'{width}-{key}',capture=key in ('room','notice'))
            toggle(page,False)
        readonly_observation(page,spec,'width-'+str(width),inspect_width); finish_case()


def protection_case():
    begin_case('explicit-external-protection')
    context,page=boot(fixtures['initialRaw']); whole_state('pre-protection-memory',save(page),fixtures['base']['state'])
    tab(page,'fleet'); spec=fixtures['cases'][0]; configure(page,spec); assert_preview(page,spec); toggle(page,True)
    before=all_storage(page); before_controls=controls(page)
    competing=copy.deepcopy(fixtures['base']); competing['savedAt']+=1; competing['lastTickAt']=competing['savedAt']
    competing_raw=json.dumps(competing,ensure_ascii=False,separators=(',',':'))
    persist_json('external-writer-before',{'before':before,'expectedLocal':{**before['local'],KEY:competing_raw},'competingRaw':competing_raw,
       'classification':'explicit isolated native cross-tab external-storage scenario, not an economic transition'})
    other=context.new_page(); attach(other); response=other.goto(args.url,wait_until='networkidle')
    verify_bundle(other); verify_document_response(response)
    other.evaluate('([key,value])=>localStorage.setItem(key,value)',[KEY,competing_raw])
    page.bring_to_front(); advance(page)
    events=page.evaluate('window.__npcStorage'); actual=all_storage(page); display=observed(page); current=controls(page)
    ref=persist_json('protected-boundary-after',{'before':before,'expectedLocal':{**before['local'],KEY:competing_raw},
       'actual':actual,'events':events,'beforeControls':before_controls,'actualControls':current,'preview':display})
    check('trusted native competing storage event freezes preview without writeback',actual['local']=={**before['local'],KEY:competing_raw}
      and actual['session']==before['session'] and any(e['trusted'] is True and e['oldValue']==before['local'][KEY] and e['newValue']==competing_raw for e in events),ref)
    check('protected freeze hides quantities and grants no send permission',not display['hidden'] and display['visible'] and display['detailsHidden']
      and not display['detailsOpen'] and not display['protectionHidden'] and '冻结进度' in display['fields']['summary']
      and bool(display['fields']['protection']) and all(display['fields'][key]=='' for key in ('target','field','capacity','room','leftovers','notice'))
      and current['send']['disabled'] is True and current['draft']==before_controls['draft'],ref)
    baseline={'storage':actual,'controls':current,'preview':display}
    for _ in range(3): advance(page)
    after={'storage':all_storage(page),'controls':controls(page),'preview':observed(page)}
    ref=persist_json('protected-readonly-after',{'before':baseline,'expected':baseline,'actual':after,
      'memoryBoundary':'Normal Save is refused and protected Export is original raw. No private-memory claim is made for protected mode; ready cases use real Save.'})
    check('protected readonly observation changes zero storage draft quote or freeze display',after==baseline,ref)
    control_proof(page,'[data-recycle="protection"]','protected-freeze',capture=True)
    other.close(); context.close(); finish_case()


def referenced_files(value):
    if isinstance(value,dict):
        if isinstance(value.get('file'),str) and isinstance(value.get('sha256'),str): yield value
        for item in value.values(): yield from referenced_files(item)
    elif isinstance(value,list):
        for item in value: yield from referenced_files(item)


def seal_files(directory,report):
    """Recursively verify EVERY referenced artifact before sealing immutable files."""
    root=Path(directory).resolve(); seen=set(); pending=list(referenced_files(report))
    while pending:
        ref=pending.pop(); path=root/ref['file']
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root): raise ValueError('Missing/nonlocal evidence reference')
        body=path.read_bytes()
        if hashlib.sha256(body).hexdigest()!=ref['sha256']: raise ValueError('Evidence reference hash mismatch: '+ref['file'])
        if ref['file'] in seen: continue
        seen.add(ref['file'])
        if path.suffix=='.json': pending.extend(referenced_files(json.loads(body)))
    files={path.relative_to(root).as_posix():hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob('*') if path.is_file() and not path.is_symlink()
        and path.name not in ('recycle-preview-browser-report.json','recycle-preview-progress.json','recycle-preview-checks.jsonl','worker.log','final-files-seal.json')}
    return {'schema':'infinity-recycle-preview-files-seal-v1','files':files,'verifiedReferences':sorted(seen)}


def validate_report(report,directory,require_final_seal=True):
    if report.get('schema')!='infinity-recycle-preview-native-v1' or report.get('completed') is not True or report.get('failed')!=0:
        raise ValueError('Complete successful native report required')
    if set(report.get('completedCases',[]))!=REQUIRED_CASES: raise ValueError('Skipped/unknown acceptance case')
    if report.get('classification')!=NATIVE_CLASSIFICATION or report.get('candidateVersion')!=CANDIDATE_VERSION:
        raise ValueError('Unambiguous native scope and exact candidate required')
    if any(not re.fullmatch(r'[a-f0-9]{40}',report.get(key,'')) for key in ('sourceSha','sourceTree')) or any(not re.fullmatch(r'[a-f0-9]{64}',report.get(key,'')) for key in ('fixtureSha256','inputSha256')):
        raise ValueError('Exact source and fixture identities required')
    checks=report.get('checks',[])
    if not REQUIRED_CASES.issubset({row.get('case') for row in checks}) or report.get('checkCount')!=len(checks) or report.get('passed')!=len(checks):
        raise ValueError('Every case needs actual successful assertions and exact counts')
    if not checks or any(row.get('passed') is not True or not list(referenced_files(row.get('detail'))) for row in checks):
        raise ValueError('Every assertion needs original evidence reference')
    if report.get('clockMillisecondsAdvanced')!=0 or not report.get('sourceBindings') or not report.get('fullSourceBinding'):
        raise ValueError('Zero-only clock and complete production source required')
    for binding in report['sourceBindings']:
        if not binding.get('httpAssets') or not binding.get('executedScripts'): raise ValueError('HTTP and V8 source proof required')
        for row in binding['httpAssets']:
            if row.get('status')!=200 or row.get('httpSha256')!=row.get('releaseSha256') or not re.fullmatch(r'[a-f0-9]{64}',row.get('httpSha256','')):
                raise ValueError('Native HTTP asset identity mismatch')
        for row in binding['executedScripts']:
            if row.get('executedSourceSha256')!=row.get('httpSha256') or row.get('httpSha256')!=row.get('releaseSha256') or not re.fullmatch(r'[a-f0-9]{64}',row.get('httpSha256','')):
                raise ValueError('Native V8 executed source identity mismatch')
    if report.get('errors') or report.get('failedRequests'): raise ValueError('Native application/request failure')
    current=seal_files(directory,report)
    if require_final_seal:
        refs=[row for row in report.get('evidence',[]) if row.get('kind')=='final-recursive-files-seal']
        if len(refs)!=1: raise ValueError('Final recursive reference seal required')
        saved=json.loads((Path(directory)/refs[0]['file']).read_bytes())
        if saved.get('files')!=current['files']: raise ValueError('Final sealed file inventory/hash changed')
    return True


def main():
    global args,out,report_path,journal_path,progress_path,fixtures,fixture_sha256,KEY,ORIGIN,CLOCK,expect
    global checks,errors,failed_requests,evidence,source_bindings,page_sources,release_metadata
    global completed,active_page,source_sha,failure,case,journal,last_progress_at,browser
    global passed_count,failed_count,source_tree,full_source_reference,clock_calls,context_sequence,witness_sequence,contexts,completed_cases
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
    for option in ('fixture','expected-fixture-sha256','pirate-input','expected-input-sha256','expected-sha','expected-version','runtime-node','output','chromium'):
        parser.add_argument('--'+option,required=True)
    parser.add_argument('--release'); parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if os.environ.get('CI')!='true' or os.environ.get('GITHUB_ACTIONS')!='true':
        parser.error('Native recycle-preview acceptance is CI-only; local browser execution is not authorized.')
    if not re.fullmatch(r'[a-f0-9]{40}',args.expected_sha): parser.error('Exact source SHA required')
    if any(not re.fullmatch(r'[a-f0-9]{64}',value) for value in (args.expected_fixture_sha256,args.expected_input_sha256)): parser.error('Exact input and fixture hashes required')
    if args.expected_version!=CANDIDATE_VERSION: parser.error('Exact candidate version required')
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?',args.runtime_node): parser.error('Actual Node runtime version required')
    if not Path(args.chromium).is_file(): parser.error('Existing prerequisite Google Chrome executable required')
    out=Path(args.output).resolve(); out.mkdir(parents=True,exist_ok=True)
    report_path=out/'recycle-preview-browser-report.json'; journal_path=out/'recycle-preview-checks.jsonl'; progress_path=out/'recycle-preview-progress.json'
    load_reviewed_helpers()
    if not args.worker: supervise(); return
    from playwright.sync_api import sync_playwright, expect as native_expect
    expect=native_expect
    data=Path(args.fixture).read_bytes(); fixture_sha256=hashlib.sha256(data).hexdigest()
    original=Path(args.pirate_input).read_bytes()
    if fixture_sha256!=args.expected_fixture_sha256 or hashlib.sha256(original).hexdigest()!=args.expected_input_sha256: raise ValueError('Exact fixture/input bytes required')
    fixtures=json.loads(data); source=source_identity(ROOT,args.expected_sha); source_tree=source['fullTree']
    validate_fixture(fixtures,original,source,args.runtime_node)
    path=out/'full-source-binding.json'; atomic_json(path,source)
    full_source_reference={'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'excludedFields':[]}
    # Preserve exact producer/input files alongside full preparation, not a summary.
    (out/'fixture-original.json').write_bytes(data); (out/'pirate-input-original.json').write_bytes(original)
    KEY=fixtures['key']; parsed=urlparse(args.url)
    if parsed.scheme not in ('http','https'): raise ValueError('Actual HTTP production URL required')
    ORIGIN=f'{parsed.scheme}://{parsed.netloc}'
    tree=ast.parse((ROOT/'scripts/browser-npc-attack.py').read_text())
    clock=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CLOCK' for t in n.targets))
    exec(compile(ast.Module(body=[clock],type_ignores=[]),'<unchanged-zero-only-functional-clock>','exec'),globals())
    checks,errors,failed_requests,evidence,source_bindings=[],[],[],[],[]
    page_sources,release_metadata={},None
    completed,active_page,source_sha,failure=False,None,None,None
    case='setup'; journal=NativeCheckJournal(journal_path); last_progress_at=0
    passed_count=failed_count=clock_calls=context_sequence=witness_sequence=0
    contexts=[]; completed_cases=set()
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError('220-second readonly recycle-preview worker bound')))
    signal.alarm(220)
    try:
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True,executable_path=args.chromium)
            try:
                with live_failure_evidence():
                    chrome_version=subprocess.check_output([args.chromium,'--version'],text=True,timeout=8).strip()
                    check('official prerequisite browser reports Google Chrome',chrome_version.startswith('Google Chrome '),{'executable':args.chromium,'version':chrome_version})
                    info=browser.new_browser_cdp_session().send('Browser.getVersion')
                    ref=persist_json('actual-google-chrome',{'actual':info,'expectedExecutable':args.chromium})
                    check('actual prerequisite Google Chrome native browser',info['product'].startswith(('Chrome/','HeadlessChrome/')),ref)
                    context,page=boot(fixtures['initialRaw'])
                    check('exact candidate release and unchanged save schema',release_metadata['version']==CANDIDATE_VERSION and release_metadata['saveVersion']==9 and release_metadata['saveRevision']==16,release_metadata)
                    assets=[]
                    for name,digest in release_metadata['files'].items():
                        response=page.request.get(urljoin(args.url,name)); body=response.body()
                        row={'fileName':name,'status':response.status,'url':response.url,'expectedSha256':digest,'actualSha256':hashlib.sha256(body).hexdigest()}
                        assets.append(row)
                        check('all release resource bytes are native HTTP200 '+name,response.status==200 and response.url==urljoin(args.url,name) and row['actualSha256']==digest,row)
                    check('all 62 exact release resources verified',len(assets)==62,assets)
                    main_cases(page); context.close(); protection_case()
                    check('all required bounded readonly cases completed',completed_cases==REQUIRED_CASES,{'expected':sorted(REQUIRED_CASES),'actual':sorted(completed_cases)})
                    check('no native application exception or failed request',not errors and not failed_requests,{'errors':errors,'failedRequests':failed_requests})
                    completed=True; flush(full=True)
                    validate_report(metadata(full=True),out,require_final_seal=False)
                    seal=seal_files(out,metadata(full=True)); atomic_json(out/'final-files-seal.json',seal)
                    evidence.append({'kind':'final-recursive-files-seal','file':'final-files-seal.json','sha256':hashlib.sha256((out/'final-files-seal.json').read_bytes()).hexdigest()})
                    flush(full=True,final=True)
            finally:
                for context in contexts:
                    try: context.close()
                    except Exception: pass
                browser.close()
    finally: signal.alarm(0)


if __name__=='__main__': main()
