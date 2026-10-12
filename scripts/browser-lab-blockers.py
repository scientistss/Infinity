"""CI-only native paid cross-planet laboratory-blocker acceptance.
Natural source is the byte-pinned historical two-planet research-network report.
A fresh browser imports its unchanged milestone00 using real file/confirmation,
pays jobs183-186 through trusted controls, and reaches historical milestone01.
Controlled Date/performance/RAF timestamps drive only functional live one-second
ticks. Native observation RAF reads geometry without changing time or storage.
Synthetic input and external-storage protection cases are explicitly isolated.
No model import, interception, private state read/write, or production replacement
occurs in the browser. All original state/storage/expected evidence precedes asserts.
"""
import argparse
import ast
import copy
import gzip
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
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
HOST_STARTED_MONOTONIC = time.monotonic()
WIDTHS = (320, 390, 768, 1440)
CANDIDATE_VERSION = '0.6.24-alpha.1'
REPORT_SHA = '1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d'
GZIP_SHA = '0ddea5009ff9832630bf5621a1f51b1c1c8211bd253045c45025d43f5c1bc8db'
GZIP_PATH = 'tests/fixtures/lab-blockers-be0-research-network-report.json.gz'
PROVENANCE_PATH = 'tests/fixtures/lab-blockers-be0-research-network-provenance.json'
HISTORICAL_SHA = 'be0e112b964179fc15b89daa4ae6f6a722b78a92'
HOME, COLONY = 'homeworld', 'colony-1'
PANEL = '[data-bind="research-lab-blockers"]'
SUMMARY = '[data-bind="research-lab-blockers-summary"]'
NOTE = '[data-bind="research-lab-blockers-note"]'
LIST = '[data-bind="research-lab-blockers-list"]'
PAY = '[data-action="enqueue"][data-id="research_lab"]'
RESOURCES = ('metal', 'crystal', 'deuterium')
SOURCE_AREAS = ('src', 'scripts', 'tests', 'public', '.github')


def load_reviewed_helpers():
    """Definitions only; never run another acceptance runner or model script."""
    names = {'load_shared_helpers', 'tab', 'raw', 'storage', 'storage_check',
             'capture_live_failure', 'live_failure_evidence', 'import_file', 'dispose_capture_handles'}
    tree = ast.parse((ROOT / 'scripts/browser-scout-rehearsal.py').read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    if {node.name for node in nodes} != names: raise RuntimeError('Reviewed native helper contract changed')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed-lab-native-helpers>', 'exec'), globals())
    load_shared_helpers()


def metadata(full=False):
    value = {'schema': 'infinity-lab-blockers-native-v1', 'completed': completed,
             'result': 'passed' if completed else 'incomplete', 'case': case,
             'sourceSha': args.expected_sha, 'sourceTree': source_tree,
             'candidateVersion': CANDIDATE_VERSION, 'naturalReportSha256': REPORT_SHA,
             'historicalArchive': {'path': GZIP_PATH, 'compressedSha256': GZIP_SHA, 'compressedBytes': 74414,
                                   'uncompressedSha256': REPORT_SHA, 'uncompressedBytes': 836611},
             'fixtureSha256': fixture_sha256, 'sourceScriptHashes': script_hashes,
             'fullSourceBindingSha256': full_source_reference['sha256'], 'failure': failure,
             'checkCount': len(checks), 'evidenceCount': len(evidence),
             'passed': passed_count, 'failed': failed_count,
             'timing': {'hostElapsedSeconds': time.monotonic() - HOST_STARTED_MONOTONIC,
                        'workerBoundSeconds': 600, 'supervisorBoundSeconds': 610,
                        'functionalAdvanceCalls': clock_calls, 'functionalSimulatedSeconds': clock_seconds},
             'classification': 'Real native import and payments183-186 from unchanged natural milestone00. Controlled functional clocks; no human elapsed-time or paint claim. Explicit synthetic setup and external-storage scenarios remain separate.',
             'acceptanceRule': 'Additional evidence only. All established independent CI gates and their aggregate must pass on this exact source SHA.'}
    if full:
        value.update(checks=checks, evidence=evidence, sourceBindings=source_bindings,
                     errors=errors, failedRequests=failed_requests, fullSourceBinding=full_source_reference)
    return value


def advance(page, milliseconds=0):
    global clock_calls, clock_seconds
    if milliseconds not in (0, 1000): raise ValueError('Only zero-frame review and one-second functional live ticks')
    value = page.evaluate('(ms)=>window.__npcAdvance(ms)', milliseconds)
    if value['afterAt'] - value['beforeAt'] != milliseconds: raise AssertionError('Controlled functional clock delta changed')
    clock_calls += 1; clock_seconds += milliseconds / 1000

def flush(full=False, final=False):
    global recorded_checks, recorded_evidence, recorded_sources, recorded_errors, recorded_requests, last_progress_at
    for items, kind, counter in ((source_bindings, 'production-source-binding', 'recorded_sources'),
                                 (errors, 'application-error', 'recorded_errors'),
                                 (failed_requests, 'failed-request', 'recorded_requests')):
        index = globals()[counter]
        while index < len(items):
            evidence.append({'kind': kind, 'index': index, 'record': items[index]}); index += 1
        globals()[counter] = index
    while recorded_evidence < len(evidence):
        journal.append('evidence', {'index': recorded_evidence, 'record': evidence[recorded_evidence]})
        recorded_evidence += 1
    while recorded_checks < len(checks):
        journal.append('check', {'index': recorded_checks, 'record': checks[recorded_checks], 'detailRef': None})
        recorded_checks += 1
    value = metadata(full=full)
    journal.append('snapshot', {key: item for key, item in value.items() if key not in ('checks', 'evidence')})
    if full:
        atomic_json(report_path, value)
        if final:
            journal.append('seal', {'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(),
                                    'checkCount': len(checks), 'evidenceCount': len(evidence)})
    now = time.monotonic()
    if full or now - last_progress_at >= 1:
        atomic_json(progress_path, metadata()); last_progress_at = now


def check(name, condition, detail=None):
    global passed_count, failed_count
    passed = bool(condition)
    checks.append({'case': case, 'name': name, 'passed': passed, 'detail': detail})
    if passed: passed_count += 1
    else: failed_count += 1
    flush()
    if not passed:
        raise AssertionError(name)


def begin_case(label):
    global case
    case = label; flush()


def persist_json(label, value):
    path = out / (re.sub(r'[^a-zA-Z0-9_-]', '-', label) + '.json')
    atomic_json(path, value)
    reference = {'kind': 'raw-before-assertion', 'case': case, 'file': path.name,
                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    evidence.append(reference); flush()
    return reference


def save(page):
    tab(page, 'save'); trusted_click(page, '[data-action="save"]')
    saved_raw = raw(page)
    persist_json(f'{len(checks):05d}-complete-native-save-raw', {'raw': saved_raw, 'storage': storage(page)})
    return json.loads(saved_raw)['state']


def whole_state(name, actual, expected):
    reference = persist_json(f'{len(checks):05d}-{name}-whole-state', {'actual': actual, 'expected': expected})
    check(name + ': complete saved game state equals independent oracle with no exclusions', exact_json(actual, expected), reference)


def reload_bound(page):
    capture = page_sources[page]
    capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
    response = page.reload(wait_until='networkidle')
    verify_bundle(page); verify_document_response(response); advance(page)


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
        deadline = time.monotonic() + 610
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


def independent_blockers(state):
    """Literal UI-contract oracle from serialized paid work, no presenter imports."""
    items, affected = [], set()
    for planet in state['planets']:
        coordinates = '[' + ':'.join(str(planet['coordinates'][key]) for key in ('galaxy', 'system', 'position')) + ']'
        def row(job, kind, position):
            target = job['targetLevel'] if kind == 'upgrade' else job['toLevel']
            status = '已付 · 施工中' if kind == 'demolition' or position == 1 and job['totalSeconds'] > 0 else '已付排队'
            location = '独立拆除位' if kind == 'demolition' else f'建造队列第 {position} 位'
            action = '升级' if kind == 'upgrade' else '拆除'
            affected.add(planet['id'])
            return {'planetId': planet['id'], 'jobId': str(job['jobId']), 'kind': kind,
                    'queuePosition': '' if position is None else str(position),
                    'text': f'{planet["name"]} {coordinates} · {action} → 等级 {target} · {location} · {status} · 工作 #{job["jobId"]}'}
        for index, job in enumerate(planet['buildQueue']):
            if job['building'] == 'research_lab': items.append(row(job, 'upgrade', index + 1))
        if planet.get('demolition') and planet['demolition']['building'] == 'research_lab':
            items.append(row(planet['demolition'], 'demolition', None))
    return {'planetCount': len(affected), 'jobCount': len(items), 'items': items,
            'summary': f'研究受阻：{len(affected)}处实验室施工' if items else '',
            'note': f'按星球计，共 {len(items)} 项已付工作（含排队）；以下仅列已付款的升级与拆除。' if items else ''}


def valid_natural_report(report):
    """Offline provenance guard supplements the mandatory whole-byte hash."""
    source = report.get('source', {}); provenance = report.get('provenance', {})
    rows = report.get('milestones', [])
    return (report.get('schema') == 'infinity-natural-research-network-journey-v1'
            and report.get('outcome', {}).get('status') == 'passed'
            and source.get('sourceSha') == source.get('gitHead') == HISTORICAL_SHA
            and source.get('sourceScopeStatusPorcelain') == source.get('worktreeStatusPorcelain') == ''
            and provenance.get('injectedGameState') is False
            and all(provenance.get(key) is True for key in ('noSyntheticFunds', 'noSyntheticTech', 'noSyntheticJobs',
                                                         'noRawSettingsPatches', 'noRingRewardReveals', 'noClockAssignments'))
            and len(rows) >= 2 and rows[0]['name'] == '00-unchanged-origin-full-world-imported-and-reloaded'
            and rows[1]['name'] == '01-four-real-paid-lab-upgrades-main10-colony3-and-reloaded'
            and [row.get('jobId') for row in report.get('paidJobs', [])[:4]] == [183, 184, 185, 186]
            and all(row.get('strictRoundtrips') == 2 and row.get('stateAdoptedFromReload') is True
                    and row.get('subsequentLiveTickObserved') is True and row['save']['version'] == 9
                    and row['save']['revision'] == 14 and row['save']['savedAt'] == row['save']['lastTickAt']
                    for row in rows[:2]))


def validated_historical_bytes(workspace=ROOT):
    """Check compressed bytes BEFORE decompression, then every original byte."""
    workspace = Path(workspace); packed = (workspace / GZIP_PATH).read_bytes()
    if len(packed) != 74414 or hashlib.sha256(packed).hexdigest() != GZIP_SHA:
        raise ValueError('Historical compressed source byte mismatch before decompression')
    original = gzip.decompress(packed)
    if len(original) != 836611 or hashlib.sha256(original).hexdigest() != REPORT_SHA:
        raise ValueError('Historical complete uncompressed source byte mismatch')
    metadata = json.loads((workspace / PROVENANCE_PATH).read_bytes())
    if (metadata.get('schema') != 'infinity-lab-blockers-historical-source-v1'
            or metadata.get('historicalSourceSha') != HISTORICAL_SHA
            or metadata.get('sourceRunId') != 38291221143 or metadata.get('sourceArtifactId') != 11766907819
            or metadata.get('compressed') != {'path': GZIP_PATH, 'format': 'gzip', 'mtime': 0, 'bytes': 74414, 'sha256': GZIP_SHA}
            or metadata.get('uncompressed') != {'bytes': 836611, 'sha256': REPORT_SHA}):
        raise ValueError('Historical source provenance metadata mismatch')
    report = json.loads(original)
    if (metadata.get('producerScriptPath') != report['source']['scriptPath']
            or metadata.get('producerScriptSha256') != report['source']['scriptSha256']):
        raise ValueError('Historical producer script provenance mismatch')
    return original


def boot(initial_raw, width=1440, empty=False):
    global active_page
    envelope = json.loads(initial_raw)
    entries = [{'name': 'infinity.ui.tab', 'value': 'overview'},
               {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    if not empty: entries.append({'name': KEY, 'value': initial_raw})
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': entries}]})
    setup = CLOCK.replace('__EPOCH__', str(envelope['savedAt']))
    setup += '''\nwindow.__labSummaryClicks=[];document.addEventListener('click',e=>{
      if(e.target.closest?.('[data-bind="research-lab-blockers-summary"]'))window.__labSummaryClicks.push({trusted:e.isTrusted});},true);'''
    context.add_init_script(setup)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    verify_bundle(page); verify_document_response(response)
    check('native Storage/File/confirm/timer implementations remain unchanged', page.evaluate('window.__npcNative'))
    return context, page


CAPTURE_REFERENCES = '''()=>{const panel=document.querySelector('[data-bind="research-lab-blockers"]');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);return{panel,nodes,ancestors};}'''
CAPTURE_STATE = '''refs=>{const panel=document.querySelector('[data-bind="research-lab-blockers"]');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);
const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
const state=n=>{const s=getComputedStyle(n);return{tag:n.tagName,id:n.id,connected:n.isConnected,
style:n.getAttribute('style'),hidden:n.getAttribute('hidden'),ariaHidden:n.getAttribute('aria-hidden'),
display:s.display,visibility:s.visibility,opacity:s.opacity,value:'value'in n?n.value:null,
disabled:'disabled'in n?n.disabled:null,open:'open'in n?n.open:null};};
return{samePanel:refs.panel===panel,sameNodes:same(refs.nodes,nodes),sameAncestors:same(refs.ancestors,ancestors),
allConnected:[...refs.nodes,...refs.ancestors].every(n=>n.isConnected),html:panel?.innerHTML,
nodes:refs.nodes.map(state),ancestors:refs.ancestors.map(state)};}'''


def snap(page, name):
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    refs = page.evaluate_handle(CAPTURE_REFERENCES)
    path = out / name; witness_path = out / (Path(name).stem + '-capture-witness.json')
    witness = {'schema': 'infinity-lab-blockers-screenshot-v1', 'caret': 'initial', 'case': case}
    try:
        witness['before'] = refs.evaluate(CAPTURE_STATE); atomic_json(witness_path, witness)
        try:
            witness['status'] = 'started'; atomic_json(witness_path, witness)
            page.screenshot(path=str(path), full_page=False, timeout=7000, caret='initial')
            witness['status'] = 'captured'; witness['screenshotSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            evidence.append({'kind': 'screenshot', 'case': case, 'file': name, 'sha256': witness['screenshotSha256']})
        except BaseException:
            witness['status'] = 'failed'; witness['error'] = traceback.format_exc(); raise
        finally:
            try: witness['after'] = refs.evaluate(CAPTURE_STATE)
            except BaseException: witness['afterReadError'] = traceback.format_exc()
            atomic_json(witness_path, witness)
            reference = {'kind': 'screenshot-state-witness', 'file': witness_path.name,
                         'sha256': hashlib.sha256(witness_path.read_bytes()).hexdigest()}
            evidence.append(reference); flush()
        check('caret=initial screenshot retains exact connected DOM nodes/style/content/open state',
              witness['before'] == witness['after'] and all(witness['after'][key] is True
              for key in ('samePanel', 'sameNodes', 'sameAncestors', 'allConnected')), reference)
    finally: dispose_capture_handles(refs)


def all_storage(page):
    return {'local': storage(page), 'session': page.evaluate('Object.fromEntries(Object.keys(sessionStorage).sort().map(k=>[k,sessionStorage.getItem(k)]))')}


def original_research_controls(page):
    return page.evaluate('''()=>({cards:[...document.querySelectorAll('[data-bind^="rcard-"]')].map(e=>({bind:e.dataset.bind,html:e.innerHTML})),
      buttons:[...document.querySelectorAll('[data-action="research"]')].map(e=>({id:e.dataset.id,disabled:e.disabled,text:e.textContent,title:e.title})),
      selectedPlanet:document.querySelector('#planet-select').value,
      queue:document.querySelector('[data-bind="rqueue-list"]').innerHTML})''')


def observed_blockers(page):
    return page.evaluate('''()=>{const d=document.querySelector('[data-bind="research-lab-blockers"]');return{
      hidden:d.hidden,open:d.open,summary:d.querySelector('[data-bind="research-lab-blockers-headline"]').textContent,
      note:d.querySelector('[data-bind="research-lab-blockers-note"]').textContent,
      rows:[...d.querySelectorAll('li')].map(e=>({planetId:e.dataset.planetId,jobId:e.dataset.jobId,kind:e.dataset.kind,queuePosition:e.dataset.queuePosition,text:e.textContent})),
      capabilities:d.querySelectorAll('button,a,input,select,textarea,[data-action],[data-planet],[data-order-action]').length,
      rowDescendants:[...d.querySelectorAll('li')].map(e=>e.children.length),
      protection:{hidden:d.querySelector('[data-bind="research-lab-blockers-protection"]').hidden,
        text:d.querySelector('[data-bind="research-lab-blockers-protection"]').textContent,
        title:d.querySelector('[data-bind="research-lab-blockers-protection"]').title}}}''')


def assert_blockers(page, state, label, protected=False):
    actual = observed_blockers(page); expected = independent_blockers(state)
    reference = persist_json(f'{len(checks):05d}-{label}-blocker-originals', {'actual': actual, 'expected': expected,
        'state': state, 'storage': all_storage(page), 'originalResearchControls': original_research_controls(page)})
    check(label + ': exact paid origins levels job IDs queue positions and distinct-planet count',
          actual['summary'] == expected['summary'] and actual['note'] == expected['note']
          and actual['rows'] == expected['items'] and actual['hidden'] == (not expected['items']), reference)
    check(label + ': display creates no action capability, HTML payload or countdown',
          actual['capabilities'] == 0 and all(value == 0 for value in actual['rowDescendants'])
          and not re.search(r'剩余|倒计时|\d+(?:\.\d+)?秒', ' '.join(row['text'] for row in actual['rows'])), reference)
    if expected['items']:
        buttons = original_research_controls(page)['buttons']
        check(label + ': all original research buttons retain the existing global lab interlock',
              bool(buttons) and all(row['disabled'] for row in buttons), reference)
        reason = page.locator('[data-bind="rreason-energy_tech"]').text_content()
        expected_reason = '研究实验室正在拆除，暂不能研究' if any(row['kind'] == 'demolition' for row in expected['items']) else '研究实验室正在升级，暂不能研究'
        reason_reference = persist_json(f'{len(checks):05d}-{label}-unchanged-domain-reason', {'actual': reason, 'expected': expected_reason})
        check(label + ': existing eligible energy-tech reason keeps exact domain interlock wording', reason == expected_reason, reason_reference)
    check(label + ': frozen-progress status exactly matches current protection mode',
          actual['protection']['hidden'] is (not protected)
          and (not protected or '保护中：显示冻结进度' in actual['protection']['text'] and bool(actual['protection']['title'])), reference)


def summary_toggle(page, opening, keyboard=None):
    native_scroll_to(page, SUMMARY)
    before = all_storage(page); controls = original_research_controls(page)
    reference_before = persist_json(f'{len(checks):05d}-toggle-before', {'storage': before, 'controls': controls, 'opening': opening})
    count = page.evaluate('window.__labSummaryClicks.length')
    if keyboard is None: page.locator(SUMMARY).click()
    else:
        if keyboard not in ('Enter', 'Space'): raise ValueError('Only native summary activation keys')
        page.locator(SUMMARY).focus(); page.locator(SUMMARY).press(keyboard)
    advance(page)
    events = page.evaluate('(n)=>window.__labSummaryClicks.slice(n)', count)
    after = all_storage(page); after_controls = original_research_controls(page)
    reference = persist_json(f'{len(checks):05d}-toggle-after', {'beforeRef': reference_before, 'before': before,
        'actual': after, 'expected': before, 'beforeControls': controls, 'afterControls': after_controls,
        'events': events, 'open': page.locator(PANEL).evaluate('(e)=>e.open')})
    check('native disclosure gets one trusted click and changes only its expected open state',
          len(events) == 1 and events[0]['trusted'] is True
          and page.locator(PANEL).evaluate('(e)=>e.open') is opening, reference)
    check('disclosure preserves all local/session storage bytes, original quotes/buttons/queue and selected planet',
          after == before and after_controls == controls, reference)


def four_widths(page, state, label):
    for width in WIDTHS:
        begin_case(f'{label}-{width}')
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        whole_state(f'{label}-{width}-before', save(page), state); tab(page, 'research')
        assert_blockers(page, state, label)
        check('fresh research disclosure starts collapsed', not page.locator(PANEL).evaluate('(e)=>e.open'))
        control_proof(page, SUMMARY, f'{label}-{width}-closed-summary', capture=True)
        summary_toggle(page, True)
        control_proof(page, NOTE, f'{label}-{width}-paid-only-note', capture=True)
        for index, row in enumerate(independent_blockers(state)['items']):
            control_proof(page, LIST + f' > li:nth-child({index + 1})', f'{label}-{width}-job-{row["jobId"]}', capture=True)
        assert_blockers(page, state, label)
        summary_toggle(page, False, keyboard='Enter')
        summary_toggle(page, True, keyboard='Space')
        summary_toggle(page, False)
        whole_state(f'{label}-{width}-after', save(page), state)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def assert_adopted_epoch(page, label, elapsed_seconds):
    """Independent natural tape epoch, not a host/wall-clock duration claim."""
    if elapsed_seconds not in (384, 418): raise ValueError('Only the two literal natural tape milestones')
    saved_raw = raw(page); envelope = json.loads(saved_raw)
    expected_at = fixtures['base']['savedAt'] + elapsed_seconds * 1000
    observed = {'savedAt': envelope['savedAt'], 'lastTickAt': envelope['lastTickAt'],
                'browserDateNow': page.evaluate('Date.now()')}
    expected = {key: expected_at for key in ('savedAt', 'lastTickAt', 'browserDateNow')}
    reference = persist_json(label + '-adopted-epoch', {'raw': saved_raw, 'storage': all_storage(page),
        'sourceEpoch': fixtures['base']['savedAt'], 'literalTapeSeconds': elapsed_seconds,
        'actual': observed, 'expected': expected,
        'classification': 'Controlled functional Date/performance/RAF epoch; elapsed tape seconds are not human wall-clock duration.'})
    check(label + ': saved and adopted clock equal independently counted natural tape epoch', observed == expected, reference)


def replay_natural_route(page):
    captures = {}
    for index, operation in enumerate(fixtures['tape']):
        kind = operation['kind']
        begin_case(f'natural-operation-{index}-{kind}')
        if kind == 'select': select(page, '#planet-select', operation['planetId'])
        elif kind == 'advance':
            for _ in range(operation['seconds']): advance(page, 1000)
        elif kind == 'pay':
            tab(page, 'facilities'); before = storage(page)
            before_reference = persist_json(f'natural-paid-{operation["jobId"]}-before', {'storage': before, 'operation': operation})
            expect(page.locator(PAY)).to_be_enabled(); trusted_click(page, PAY)
            after = storage(page)
            reference = persist_json(f'natural-paid-{operation["jobId"]}-after', {'beforeRef': before_reference,
                'before': before, 'actual': after, 'expectedState': fixtures['expected'][f'lab{operation["level"]}-paid']})
            a, b = json.loads(before[KEY])['state'], json.loads(after[KEY])['state']
            job = next(p for p in b['planets'] if p['id'] == HOME)['buildQueue'][0]
            check('real payment allocates exactly the historical job and unchanged literal laboratory price/duration',
                  job['jobId'] == operation['jobId'] and job['paid'] == operation['paid'] and job['source'] == 'manual'
                  and job['taskId'] is None and job['targetLevel'] == operation['level']
                  and job['totalSeconds'] == operation['totalSeconds'] and b['orders']['nextJobId'] == a['orders']['nextJobId'] + 1, reference)
            for resource in RESOURCES:
                expected_wallet = float(a['planets'][0]['resources'][resource]) - int(operation['paid'][resource])
                actual_wallet = float(b['planets'][0]['resources'][resource])
                check(resource + ': independent bounded Number subtraction confirms actual native payment',
                      abs(actual_wallet - expected_wallet) <= 1e-7 + abs(expected_wallet) * 2e-14, reference)
        elif kind == 'checkpoint':
            name = operation['name']; expected = fixtures['expected'][name]
            actual = save(page); captures[name] = raw(page)
            persist_json('natural-' + name + '-raw', {'raw': captures[name], 'storage': all_storage(page), 'expected': expected})
            whole_state(name, actual, expected)
            if name.endswith('-colony') or name.endswith('-complete'):
                tab(page, 'research'); assert_blockers(page, expected, name)
                check('expected actual planet remains selected', page.locator('#planet-select').input_value() == expected['activePlanetId'])
            if name == 'lab10-colony':
                prior = raw(page)
                persist_json('natural-paid186-before-native-reload', {'raw': prior, 'expected': expected, 'storage': all_storage(page)})
                reload_bound(page)
                reference = persist_json('natural-paid186-after-native-reload', {'beforeRaw': prior, 'actualRaw': raw(page),
                    'expected': expected, 'storage': all_storage(page)})
                check('actual paid186 cold reload retains exact durable raw bytes', raw(page) == prior, reference)
                whole_state('natural-paid186-native-reload-all-fields', save(page), expected)
                assert_adopted_epoch(page, 'natural-paid186-native-reload', 384)
        elif kind == 'four-widths': four_widths(page, fixtures['expected'][operation['checkpoint']], 'natural-paid-lab10')
        else: raise ValueError('Unknown natural tape operation: ' + kind)
        evidence.append({'kind': 'actual-natural-operation', 'index': index, 'operation': operation}); flush()
    whole_state('historical-milestone01-complete', save(page), fixtures['finalSave']['state'])
    assert_adopted_epoch(page, 'historical-milestone01-complete', 418)
    select(page, '#planet-select', COLONY); tab(page, 'research')
    assert_blockers(page, fixtures['expected']['completeColony'], 'actual-completion-clears-summary')
    return captures


def cancellation_boundary(natural_raw):
    begin_case('natural-native-paid186-separate-cancellation-branch')
    context, page = boot(natural_raw)
    tab(page, 'research'); assert_blockers(page, fixtures['expected']['lab10-colony'], 'retained-genuine-paid186')
    select(page, '#planet-select', HOME); whole_state('cancel-selected-home', save(page), fixtures['expected']['cancelHome'])
    tab(page, 'facilities'); before = storage(page)
    persist_json('natural-cancel-before', {'storage': before, 'expected': fixtures['expected']['cancelled']})
    trusted_click(page, '[data-bind="queue-list"] [data-action="cancel-queue"][data-index="0"]')
    whole_state('natural-actual-cancel-refund', save(page), fixtures['expected']['cancelled'])
    select(page, '#planet-select', COLONY); tab(page, 'research')
    assert_blockers(page, fixtures['expected']['cancelledColony'], 'actual-cancellation-clears-summary')
    whole_state('natural-cancel-colony', save(page), fixtures['expected']['cancelledColony']); context.close()


def synthetic_boundaries():
    for name, fixture in fixtures['synthetic'].items():
        begin_case('EXPLICIT-SYNTHETIC-' + name)
        persist_json('synthetic-origin-' + name, fixture)
        context, page = boot(fixture['raw']); whole_state(name + '-strict-cold-load', save(page), fixture['expected'])
        tab(page, 'research'); assert_blockers(page, fixture['expected'], name)
        if independent_blockers(fixture['expected'])['items']:
            if name == 'mixed-demolition-long-names': four_widths(page, fixture['expected'], 'synthetic-long-names-and-demolition')
            else:
                summary_toggle(page, True); assert_blockers(page, fixture['expected'], name)
                control_proof(page, SUMMARY, name + '-summary', capture=True)
                for index, row in enumerate(independent_blockers(fixture['expected'])['items']):
                    control_proof(page, LIST + f' > li:nth-child({index + 1})', name + '-job-' + row['jobId'], capture=True)
                summary_toggle(page, False)
        whole_state(name + '-readonly-after', save(page), fixture['expected']); context.close()


def lifecycle_boundaries(natural_raw):
    for kind in ('tab-away', 'cancelled-import', 'different-world-import', 'accepted-new-world'):
        begin_case('native-lifecycle-' + kind)
        context, page = boot(natural_raw); expected = fixtures['expected']['lab10-colony']
        tab(page, 'research'); summary_toggle(page, True)
        original = page.locator(LIST + ' > li').element_handle()
        before = all_storage(page); persist_json(kind + '-before', {'storage': before, 'expected': expected})
        if kind == 'tab-away': tab(page, 'facilities')
        elif kind in ('cancelled-import', 'different-world-import'):
            import_file(page, fixtures['initialRaw'], kind == 'different-world-import', kind)
            if kind == 'different-world-import': expected = fixtures['base']['state']
        else:
            tab(page, 'save'); dialogs = []
            def answer(dialog):
                valid = dialog.type == 'confirm' and dialog.message == '备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。'
                dialogs.append({'valid': valid, 'message': dialog.message}); dialog.accept() if valid else dialog.dismiss()
            page.once('dialog', answer); trusted_click(page, '[data-action="reset"]')
            reference = persist_json(kind + '-after', {'before': before, 'actual': all_storage(page), 'dialogs': dialogs})
            check('new world requires exact real native confirmation', len(dialogs) == 1 and dialogs[0]['valid'], reference)
        retired = {'connected': original.evaluate('(e)=>e.isConnected'), 'display': observed_blockers(page), 'storage': all_storage(page)}
        reference = persist_json(kind + '-old-row-retired', {'before': before, 'actual': retired, 'expectedOldRowConnected': False})
        check('leaving/import/new-world removes all old paid-detail nodes, never carries old capability',
              retired['connected'] is False and retired['display']['hidden'] and not retired['display']['rows']
              and retired['display']['capabilities'] == 0, reference)
        original.dispose()
        if kind == 'accepted-new-world':
            current = save(page)
            check('new world has no inherited paid laboratory queue or demolition', not independent_blockers(current)['items'])
        else:
            tab(page, 'research'); assert_blockers(page, expected, kind + '-fresh-research')
            check('returning fresh disclosure cannot revive prior open state', not page.locator(PANEL).evaluate('(e)=>e.open'))
            whole_state(kind + '-entire-state', save(page), expected)
        context.close()


def protection_boundary(natural_raw):
    begin_case('EXPLICIT-real-cross-tab-storage-conflict-freezes-old-paid186')
    context, page = boot(natural_raw); expected = fixtures['expected']['lab10-colony']
    tab(page, 'research'); summary_toggle(page, True); before = storage(page)
    competing = json.loads(fixtures['initialRaw']); competing['savedAt'] = json.loads(natural_raw)['savedAt'] + 1
    competing['lastTickAt'] = competing['savedAt']
    competing_raw = json.dumps(competing, ensure_ascii=False, separators=(',', ':'))
    persist_json('cross-tab-external-before', {'before': before, 'competingRaw': competing_raw,
        'classification': 'Explicit external competing valid raw in an isolated context; not a natural economic transition.'})
    other = context.new_page(); other.goto(args.url, wait_until='networkidle')
    other.evaluate('([key,value])=>localStorage.setItem(key,value)', [KEY, competing_raw])
    page.bring_to_front(); advance(page)
    events = page.evaluate('window.__npcStorage')
    reference = persist_json('cross-tab-external-after', {'before': before, 'actual': storage(page),
        'expected': {**before, KEY: competing_raw}, 'events': events})
    check('protection is a real trusted cross-tab event with exact old/new raw strings',
          any(row['trusted'] is True and row['oldValue'] == before[KEY] and row['newValue'] == competing_raw for row in events), reference)
    assert_blockers(page, expected, 'protected-frozen-old-progress', protected=True)
    summary_toggle(page, False); control_proof(page, SUMMARY, 'protected-collapsed-still-labeled', capture=True)
    summary_toggle(page, True); summary_toggle(page, False)
    storage_check('frozen display never writes over competing raw or backups', page, before, {**before, KEY: competing_raw})
    other.close(); reload_bound(page); tab(page, 'research')
    assert_blockers(page, fixtures['base']['state'], 'recovery-loads-current-world-no-old-details')
    # A one-millisecond stale metadata gap does not fund a whole simulation tick.
    whole_state('recovery-current-full-world', save(page), fixtures['base']['state']); context.close()


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


def main():
    global args, out, report_path, journal_path, progress_path, fixture_sha256, fixtures, KEY, ORIGIN
    global checks, errors, failed_requests, evidence, source_bindings, page_sources, release_metadata
    global completed, active_page, source_sha, failure, case, journal, last_progress_at, browser, CLOCK, expect
    global passed_count, failed_count, recorded_checks, recorded_evidence, recorded_sources, recorded_errors, recorded_requests
    global source_tree, script_hashes, full_source_reference, clock_calls, clock_seconds
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--fixture', required=True); parser.add_argument('--expected-fixture-sha256', required=True)
    parser.add_argument('--natural-report', required=True); parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA')); parser.add_argument('--release')
    parser.add_argument('--expected-version', required=True); parser.add_argument('--runtime-node', required=True)
    parser.add_argument('--output', required=True); parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('Native lab-blocker acceptance is CI-only; local browser execution is not authorized.')
    if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha): parser.error('Exact source SHA required')
    if args.expected_report_sha256 != REPORT_SHA: parser.error('Exact independently pinned historical natural report required')
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_fixture_sha256): parser.error('Exact fixture SHA256 required')
    if args.expected_version != CANDIDATE_VERSION: parser.error('Exact candidate version required')
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', args.runtime_node): parser.error('Actual CI node --version required')
    out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    report_path = out / 'lab-blockers-browser-report.json'
    journal_path = out / 'lab-blockers-checks.jsonl'; progress_path = out / 'lab-blockers-progress.json'
    load_reviewed_helpers()
    if not args.worker: supervise(); return
    from playwright.sync_api import sync_playwright, expect as native_expect
    expect = native_expect
    fixture_bytes = Path(args.fixture).read_bytes(); fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
    if fixture_sha256 != args.expected_fixture_sha256: raise ValueError('Full fixture byte mismatch')
    fixtures = json.loads(fixture_bytes); report_bytes = Path(args.natural_report).read_bytes()
    if report_bytes != validated_historical_bytes(ROOT): raise ValueError('Supplied historical source is not the complete verified lossless archive')
    if hashlib.sha256(report_bytes).hexdigest() != REPORT_SHA: raise ValueError('Full historical report byte mismatch')
    natural = json.loads(report_bytes)
    if not valid_natural_report(natural): raise ValueError('Natural source provenance failed')
    source = source_identity(ROOT, args.expected_sha); source_tree = source['fullTree']
    expected_producer = {'sourceSha': args.expected_sha, 'fullTree': source_tree,
        'scriptSha256': source['sourceCode']['scripts/lab-blockers-native-fixture.ts'],
        'dependencyLockSha256': source['sourceCode']['package-lock.json'], 'runtimeNode': args.runtime_node}
    if fixtures.get('schema') != 'infinity-lab-blockers-native-fixture-v1' or fixtures.get('source') != expected_producer:
        raise ValueError('Fixture is not from exact current committed producer/runtime')
    if (fixtures['historical']['reportSha256'] != REPORT_SHA or fixtures['historical']['sourceSha'] != HISTORICAL_SHA
            or fixtures['base'] != natural['milestones'][0]['save'] or json.loads(fixtures['initialRaw']) != fixtures['base']
            or hashlib.sha256(fixtures['initialRaw'].encode()).hexdigest() != fixtures['initialRawSha256']
            or fixtures['finalSave'] != natural['milestones'][1]['save']):
        raise ValueError('Fixture changed historical complete natural handoffs')
    script_hashes = {path: source['sourceCode'][path] for path in ('scripts/browser-lab-blockers.py',
        'scripts/lab-blockers-native-fixture.ts', 'scripts/test_lab_blockers_acceptance.py',
        'scripts/browser-scout-rehearsal.py', 'scripts/browser-npc-attack.py',
        'scripts/browser-render-scheduling.py', 'scripts/npc_display_contract.py',
        'scripts/test_npc_display_contract.py', GZIP_PATH, PROVENANCE_PATH, 'package-lock.json')}
    binding_path = out / 'lab-blockers-full-source-binding.json'; atomic_json(binding_path, source)
    full_source_reference = {'file': binding_path.name, 'sha256': hashlib.sha256(binding_path.read_bytes()).hexdigest(),
                             'fileCount': len(source['sourceCode']), 'excludedFields': []}
    KEY = fixtures['key']; parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'): raise ValueError('Actual production HTTP(S) required')
    ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
    tree = ast.parse((ROOT / 'scripts/browser-npc-attack.py').read_text())
    node = next(node for node in tree.body if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == 'CLOCK' for target in node.targets))
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<unchanged-functional-clock-native-observer>', 'exec'), globals())
    checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
    page_sources, release_metadata = {}, None
    completed, active_page, source_sha, failure = False, None, None, None
    case = 'setup'; journal = NativeCheckJournal(journal_path); last_progress_at = 0
    passed_count = failed_count = recorded_checks = recorded_evidence = recorded_sources = recorded_errors = recorded_requests = 0
    clock_calls = clock_seconds = 0
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('600-second lab-blocker worker bound')))
    signal.alarm(600)
    try:
        with sync_playwright() as playwright, live_failure_evidence():
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            begin_case('natural-cold-context-actual-native-file-import')
            context, page = boot(fixtures['initialRaw'], empty=True)
            check('served release exact candidate version and unchanged v9/r14', release_metadata['version'] == CANDIDATE_VERSION
                  and release_metadata['saveVersion'] == 9 and release_metadata['saveRevision'] == 14)
            save(page)  # Native new-world save supplies the genuine import-confirmation source.
            persist_json('native-file-import-before', {'storage': all_storage(page), 'fileRaw': fixtures['initialRaw'],
                'expectedEnvelope': fixtures['base'], 'expectedState': fixtures['base']['state']})
            import_file(page, fixtures['initialRaw'], True, 'unchanged-natural-milestone00')
            persist_json('native-file-import-after', {'storage': all_storage(page), 'raw': raw(page),
                'expectedEnvelope': fixtures['base'], 'expectedState': fixtures['base']['state']})
            whole_state('actual-native-file-import-complete-world', save(page), fixtures['base']['state'])
            captures = replay_natural_route(page); context.close()
            genuine_paid = captures['lab10-colony']
            cancellation_boundary(genuine_paid)
            synthetic_boundaries()
            lifecycle_boundaries(genuine_paid)
            protection_boundary(genuine_paid)
            check('no application error or failed request', not errors and not failed_requests,
                  {'errors': errors, 'requests': failed_requests})
            completed = True; flush(full=True, final=True); browser.close()
    finally: signal.alarm(0)


if __name__ == '__main__': main()
