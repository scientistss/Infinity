"""CI-only native r14 paid-scout rehearsal acceptance.
Functional Date/performance/RAF timestamps are controlled and explicitly labeled.
A separate isolated upper-bound context keeps native clocks UNMODIFIED and uses
PerformanceObserver/performance.now/CDP metrics, never a CPU profiler. No paint claim.
All three independent jobs (verify, npc-orbital, scout-rehearsal) and the
required-gates aggregate must pass for this exact source SHA.
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
from fractions import Fraction
from pathlib import Path
from urllib.parse import urljoin, urlparse
from npc_display_contract import MESSAGE_OPENERS_SAMPLE_JS, typed_message_openers, exact_copied_data

ROOT = Path(__file__).resolve().parents[1]
HOST_STARTED_MONOTONIC = time.monotonic()
HOST_STARTED_AT = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
WIDTHS = (320, 390, 768, 1440)
SOURCE_PIN = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52'
RAW_PIN = 'fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b'
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship',
         'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'colony_ship')


def valid_natural_report(value, expected_sha):
    if (value.get('schema') != 'infinity-scout-rehearsal-natural-route-v1'
            or value.get('key') != 'infinity.original-p4.save.v1'
            or value.get('source', {}).get('sourceSha') != expected_sha
            or value.get('source', {}).get('sourceScopeStatusPorcelain') != ''
            or value.get('source', {}).get('oldSourceSha') != SOURCE_PIN
            or value.get('origin', {}).get('historicalSourceSha') != SOURCE_PIN
            or value.get('origin', {}).get('rawSha256') != RAW_PIN
            or hashlib.sha256(value.get('origin', {}).get('raw', '').encode()).hexdigest() != RAW_PIN
            or value.get('outcome', {}).get('status') != 'passed'
            or value.get('outcome', {}).get('mainComplete') is not True
            or not value.get('checks') or not all(row.get('passed') is True for row in value['checks'])
            or value.get('target') != {'galaxy': 1, 'system': 56, 'position': 15}
            or value.get('publicSeeds') != [608135816, 2242054355, 320440878]):
        return False
    names = [row.get('name') for row in value.get('milestones', [])]
    expected = ['migrated-paid31-final', 'scout11-paid-outbound', 'scout11-partial-reload',
                'scout11-arrived-once', 'scout11-returned', 'run-cancel-reopen-fill-still-unpaid',
                'attack12-paid-outbound', 'attack12-actual-battle', 'attack12-return-delivered-once',
                'scout13-after-real-battle', 'scout13-returned']
    if names != expected or [r.get('name') for r in value.get('tape', []) if r.get('kind') == 'checkpoint'] != expected:
        return False
    partial=next(row for row in value['milestones'] if row['name']=='scout11-partial-reload')
    partial_fleets=partial['expected'].get('fleets',[])
    if not (partial['reload'] is True and len(partial_fleets)==1 and partial_fleets[0].get('id')==11
            and partial_fleets[0].get('returning') is False and 0<partial_fleets[0].get('remaining',0)<partial_fleets[0].get('duration',0)
            and all(m.get('npcScoutSnapshot') is None for m in partial['expected'].get('messages',[]))):
        return False
    return ([r.get('fleetId') for r in value['tape'] if r.get('kind') in ('scout', 'attack')] == [11, 12, 13]
            and all(type(row.get('reload')) is bool and isinstance(row.get('expected'), dict)
                    and hashlib.sha256(row.get('raw', '').encode()).hexdigest() == row.get('rawSha256')
                    for row in value['milestones']))


def load_shared_helpers():
    """Reuse established append-journal/watchdog/geometry code, never its runner.
    Only explicit top-level definitions are compiled; imports, CLI and browser work
    in browser-npc-attack.py cannot execute. Definitions resolve this runner's globals.
    """
    names = {'atomic_json', 'NativeCheckJournal', 'replay_native_journal', 'recover_native_report',
             'exact_json', 'visibility', 'text_leaf_visibility', 'wait_for_scroll_settled',
             'native_scroll_to', 'scroll_region_state', 'scroll_region_plan', 'scroll_pointer_hits', 'horizontal_wheel_proven',
             'attach', 'verify_bundle', 'verify_document_response',
             'select', 'trusted_click', 'input_number', 'import_confirmation'}
    tree = ast.parse((ROOT / 'scripts/browser-npc-attack.py').read_text())
    selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    if {node.name for node in selected} != names:
        raise RuntimeError('Shared native acceptance definitions changed; explicit review required')
    exec(compile(ast.Module(body=selected, type_ignores=[]), '<reviewed-native-helpers>', 'exec'), globals())


# Playwright v1.57.0 screenshotter.ts L87-L101 and L191-L196: the default
# caret='hide' writes inline caret-color on EVERY input, then restores it.
# https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/screenshotter.ts
# Those real style mutations correctly retire this panel's input capability.
# Keep the old shared helper and all production style/ABA guards unchanged.
# This runner uses the supported caret='initial' option and records read-only
# DOM identity/state before and after every capture. No private session access.
REHEARSAL_CAPTURE_REFERENCES = r'''()=>{
  const panel=document.querySelector('#npc-rehearsal-panel');
  const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];
  const ancestors=[];
  for(let parent=panel?.parentElement;parent;parent=parent.parentElement)ancestors.push(parent);
  return {panel,nodes,ancestors};
}'''
REHEARSAL_CAPTURE_STATE = r'''refs=>{
  const panel=document.querySelector('#npc-rehearsal-panel');
  const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];
  const ancestors=[];
  for(let parent=panel?.parentElement;parent;parent=parent.parentElement)ancestors.push(parent);
  const same=(old,current)=>old.length===current.length&&old.every((node,index)=>node===current[index]);
  const state=node=>{
    const css=getComputedStyle(node);
    return {tag:node.tagName,id:node.id,connected:node.isConnected,
      style:node.getAttribute('style'),hidden:node.getAttribute('hidden'),ariaHidden:node.getAttribute('aria-hidden'),
      display:css.display,visibility:css.visibility,opacity:css.opacity,
      disabled:'disabled' in node?node.disabled:null,value:'value' in node?node.value:null,
      open:'open' in node?node.open:null};
  };
  return {samePanel:refs.panel===panel,sameNodes:same(refs.nodes,nodes),sameAncestors:same(refs.ancestors,ancestors),
    allOriginalNodesConnected:[...refs.nodes,...refs.ancestors].every(node=>node.isConnected),
    panelPresent:panel!==null,panelHidden:panel?.hidden??null,panelHtml:panel?.innerHTML??null,
    resultCount:panel?.querySelectorAll('#npc-rehearsal-results > details.npc-battle-report').length??0,
    nodes:refs.nodes.map(state),ancestors:refs.ancestors.map(state)};
}'''


def dispose_capture_handles(*handles):
    """Release read-only probes without replacing an in-flight browser failure."""
    original_error=sys.exc_info()[0] is not None
    cleanup_error=None
    for handle in handles:
        try:handle.dispose()
        except BaseException as error:
            if cleanup_error is None:cleanup_error=error
    if cleanup_error is not None and not original_error:raise cleanup_error


def snap(page, name):
    """Capture with no caret-style writes; retain original nodes without DOM edits.
    The witness is public DOM session evidence, not a private session-token read.
    Persist the pre-state before capture, and final diagnostics even on failure.
    """
    page.evaluate('Promise.all([...document.images].filter(i=>i.getClientRects().length).map(i=>i.decode().catch(()=>null)))')
    refs=page.evaluate_handle(REHEARSAL_CAPTURE_REFERENCES)
    witness_path=out/(Path(name).stem+'-capture-witness.json')
    witness={'schema':'infinity-scout-screenshot-witness-v1','case':case,'screenshot':name,
             'caret':'initial','before':None,'after':None,'screenshotStatus':'not-attempted',
             'boundary':'Read-only public DOM identity/styles/values/results; no private session token, no observer bypass.'}
    try:
        witness['before']=refs.evaluate(REHEARSAL_CAPTURE_STATE)
        atomic_json(witness_path,witness)
        path=out/name
        try:
            page.screenshot(path=str(path),full_page=False,timeout=7000,caret='initial')
            witness['screenshotStatus']='captured'
            evidence.append({'case':case,'file':name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        except BaseException:
            witness['screenshotStatus']='failed';witness['screenshotError']=traceback.format_exc()
            raise
        finally:
            try:witness['after']=refs.evaluate(REHEARSAL_CAPTURE_STATE)
            except BaseException:witness['afterReadError']=traceback.format_exc()
            atomic_json(witness_path,witness)
            reference={'kind':'screenshot-state-witness','case':case,'file':witness_path.name,
                       'sha256':hashlib.sha256(witness_path.read_bytes()).hexdigest()}
            evidence.append(reference);flush()
        after=witness['after']
        check(name+': screenshot preserves original panel controls result nodes and exact public state',
              witness['before']==after and after is not None
              and all(after[key] is True for key in ('panelPresent','samePanel','sameNodes','sameAncestors','allOriginalNodesConnected')),
              reference)
    finally:
        dispose_capture_handles(refs)


def reset_recorder():
    global recorded_checks, recorded_evidence, recorded_sources, recorded_errors, recorded_requests, passed_count, failed_count
    recorded_checks=recorded_evidence=recorded_sources=recorded_errors=recorded_requests=passed_count=failed_count=0


def metadata(full=False):
    # Per-assertion metadata is constant-size. Growing rows live once in the
    # append journal. Only terminal output aggregates complete arrays.
    value={'schema': 'infinity-scout-rehearsal-native-v1', 'completed': completed,
            'result': 'passed' if completed else 'incomplete', 'case': case, 'sourceSha': args.expected_sha,
            'naturalReportSha256': fixture_sha256, 'originRawSha256': RAW_PIN,
            'sourceBindingCount':len(source_bindings),'errorCount':len(errors),'failedRequestCount':len(failed_requests),
            'failure': failure, 'performance': performance_result,
            'classification': 'Natural main uses untouched paid31 historical raw and actual trusted controls. Explicit synthetic edge contexts are separate. Functional clocks are controlled. Timing context clocks are native and unmodified; no paint or background-throttling claim.',
            'acceptanceRule': 'All three independent jobs (verify, npc-orbital, scout-rehearsal) and the required-gates aggregate must be green for this exact source SHA.',
            'timing': {'hostElapsedSeconds': time.monotonic() - HOST_STARTED_MONOTONIC,
                       'workerBoundSeconds': 900, 'supervisorBoundSeconds': 910},
            'checkCount':len(checks),'evidenceCount':len(evidence),'passed':passed_count,'failed':failed_count}
    if full:
        value.update(checks=checks,evidence=evidence,sourceBindings=source_bindings,errors=errors,failedRequests=failed_requests)
    return value


def flush(full=False, final=False):
    global last_progress_at,recorded_checks,recorded_evidence,recorded_sources,recorded_errors,recorded_requests
    # Shared helpers append immutable evidence/check rows. Only their new suffix
    # is serialized. A source binding is journaled once, never in every snapshot.
    while recorded_sources<len(source_bindings):
        evidence.append({'kind':'production-source-binding','sourceBindingIndex':recorded_sources,
                         'binding':source_bindings[recorded_sources]})
        recorded_sources+=1
    while recorded_errors<len(errors):
        evidence.append({'kind':'application-error','errorIndex':recorded_errors,'error':errors[recorded_errors]})
        recorded_errors+=1
    while recorded_requests<len(failed_requests):
        evidence.append({'kind':'failed-request','requestIndex':recorded_requests,'url':failed_requests[recorded_requests]})
        recorded_requests+=1
    while recorded_evidence<len(evidence):
        journal.append('evidence',{'index':recorded_evidence,'record':evidence[recorded_evidence]})
        recorded_evidence+=1
    while recorded_checks<len(checks):
        journal.append('check',{'index':recorded_checks,'record':checks[recorded_checks],'detailRef':None})
        recorded_checks+=1
    value=metadata(full=full)
    journal.append('snapshot',{k:v for k,v in value.items() if k not in ('checks','evidence')})
    if full:
        atomic_json(report_path,value)
        if final:
            journal.append('seal',{'reportSha256':hashlib.sha256(report_path.read_bytes()).hexdigest(),
                                   'checkCount':len(checks),'evidenceCount':len(evidence)})
    if full or time.monotonic()-last_progress_at>1:
        atomic_json(progress_path,{'completed':False,'case':case,'checkCount':len(checks),'passed':passed_count,'failed':failed_count,
            'journalSequence':journal.sequence,'journalSha256':journal.digest,
            'hostElapsedSeconds':time.monotonic()-HOST_STARTED_MONOTONIC})
        last_progress_at=time.monotonic()


def check(name, condition, detail=None):
    global passed_count,failed_count
    passed=bool(condition)
    checks.append({'case':case,'name':name,'passed':passed,'detail':detail})
    if passed:passed_count+=1
    else:failed_count+=1
    flush()
    if not passed:raise AssertionError(name)


def begin_case(label):
    global case
    case=label
    # Stage transitions are lightweight durable snapshots, not prefix rewrites.
    flush()


def advance(page, milliseconds=0):
    if milliseconds not in (0, 500, 1000):
        raise ValueError('Only zero-time review frames and fixed one-second game advances')
    value = page.evaluate('(ms)=>window.__npcAdvance(ms)', milliseconds)
    if value['afterAt'] - value['beforeAt'] != milliseconds:
        raise AssertionError('Controlled functional clock delta is wrong')


def tab(page, name):
    if page.locator('[data-bind="offline-modal"]').is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator(f'[data-tab="{name}"]').click()
    advance(page)


def raw(page):
    return page.evaluate('(key)=>window.__npcNativeRead?window.__npcNativeRead(key):localStorage.getItem(key)', KEY)


def storage(page):
    return page.evaluate('Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,(window.__npcNativeRead?window.__npcNativeRead(k):localStorage.getItem(k))]))')


def storage_check(name, page, before, expected=None, *, initial_tab=None, visible_tab=None, condition=True, detail=None):
    """Persist every key and raw value before asserting; never normalize storage.
    A DOM space tab is not the persisted original-view preference. Each caller
    must state any exact expected write; omitted expected means no write at all.
    """
    actual = storage(page)
    expected = before if expected is None else expected
    def preference(value):
        return {'present':'infinity.ui.tab' in value, 'value':value.get('infinity.ui.tab')}
    def changed(left, right):
        return [key for key in sorted(left.keys() | right.keys())
                if (key in left) != (key in right) or left.get(key) != right.get(key)]
    record = {'schema':'infinity-scout-storage-comparison-v1', 'case':case, 'name':name,
        'before':before, 'expected':expected, 'actual':actual,
        'initialPreference':preference(before), 'expectedPreference':preference(expected),
        'actualPreference':preference(actual), 'requiredInitialPreference':initial_tab,
        'domTabs':None, 'requiredVisibleTab':visible_tab,
        'changedFromBefore':changed(before, actual), 'differentFromExpected':changed(expected, actual),
        'additionalCondition':bool(condition), 'additionalDetail':detail,
        'boundary':'Complete native localStorage keys and unmodified raw strings; no ignored keys or game-field exclusions.'}
    path = out / f'storage-comparison-{len(checks)+1:05d}.json'
    # This first atomic file survives even if the next read-only DOM probe fails.
    atomic_json(path, record)
    def reference():
        return {'kind':'storage-comparison', 'case':case, 'name':name,
                'file':path.name, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    try:
        dom = page.evaluate('''()=>({
          selected:[...document.querySelectorAll('[data-tab][aria-selected="true"]')].map(e=>e.dataset.tab).sort(),
          visible:[...document.querySelectorAll('[data-tab-panel]')].filter(e=>!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden').map(e=>e.dataset.tabPanel).sort()
        })''')
    except BaseException:
        record['domReadError'] = traceback.format_exc()
        atomic_json(path, record); evidence.append(reference()); flush()
        raise
    record['domTabs'] = dom
    atomic_json(path, record)
    saved_reference = reference(); evidence.append(saved_reference)
    check(name, actual == expected and condition
          and (initial_tab is None or preference(before) == {'present':True,'value':initial_tab})
          and (visible_tab is None or dom == {'selected':[visible_tab],'visible':[visible_tab]}),
          {**saved_reference, 'changedFromBefore':record['changedFromBefore'],
           'differentFromExpected':record['differentFromExpected'],
           'initialPreference':record['initialPreference'], 'actualPreference':record['actualPreference'],
           'domTabs':dom})


def capture_live_failure(page):
    """Best-effort independent captures, while Playwright is live, within 6 s.
    Save storage first. A broken HTML or screenshot capture cannot hide it.
    The outer supervisor still owns its unchanged 910-second process bound.
    """
    result = {'schema':'infinity-scout-live-failure-capture-v1', 'case':case,
              'boundSeconds':6, 'pageAvailable':page is not None, 'captures':[]}
    if page is not None:
        expired = False
        def timeout(*_):
            nonlocal expired
            expired = True
            raise TimeoutError('Six-second live failure capture bound')
        previous_handler = signal.getsignal(signal.SIGALRM)
        previous_timer = signal.getitimer(signal.ITIMER_REAL)
        started = time.monotonic()
        signal.signal(signal.SIGALRM, timeout)
        signal.setitimer(signal.ITIMER_REAL, min(6, previous_timer[0]) if previous_timer[0] else 6)
        try:
            captures = (
                ('failure-storage.json', lambda path: atomic_json(path, storage(page))),
                ('failure.html', lambda path: path.write_text(page.content(), encoding='utf-8')),
                ('failure.png', lambda path: page.screenshot(path=str(path), timeout=2000, caret='initial')),
            )
            for filename, capture in captures:
                if expired:
                    result['captures'].append({'file':filename, 'status':'not-attempted', 'error':'Live capture bound expired'})
                    continue
                try:
                    path = out / filename; capture(path)
                    result['captures'].append({'file':filename, 'status':'captured',
                        'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
                except BaseException as error:
                    result['captures'].append({'file':filename, 'status':'failed',
                        'error':f'{type(error).__name__}: {error}'})
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous_handler)
            remaining = previous_timer[0] - (time.monotonic() - started)
            result['workerDeadlineElapsedDuringCapture'] = bool(previous_timer[0] and remaining <= 0)
            if previous_timer[0]:
                # Never swallow the original worker deadline, even if it expired
                # while best-effort diagnostics were running.
                signal.setitimer(signal.ITIMER_REAL, max(.001, remaining), previous_timer[1])
        result['boundExpired'] = expired
    path = out / 'failure-capture.json'; atomic_json(path, result)
    evidence.append({'kind':'live-failure-capture', 'case':case, 'file':path.name,
                     'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    return result


@contextmanager
def live_failure_evidence():
    """Must be nested inside sync_playwright so exceptions capture before exit."""
    global completed, failure
    try:
        yield
    except BaseException:
        completed = False; failure = traceback.format_exc()
        # Make the original failure durable before any diagnostic browser call.
        flush(full=True)
        try:
            capture_live_failure(active_page)
        except BaseException as capture_error:
            evidence.append({'kind':'live-failure-capture-error', 'case':case,
                             'error':f'{type(capture_error).__name__}: {capture_error}'})
        flush(full=True)
        raise


def whole_state(name, actual, expected):
    same = exact_json(actual, expected)
    if not same:
        atomic_json(out / (re.sub(r'[^a-zA-Z0-9-]', '-', name) + '-mismatch.json'), {'actual': actual, 'expected': expected})
    check(name + ': every game field equals independent snapshot oracle plus exact archived7554', same,
          {'actualSha256': hashlib.sha256(json.dumps(actual, sort_keys=True).encode()).hexdigest(),
           'expectedSha256': hashlib.sha256(json.dumps(expected, sort_keys=True).encode()).hexdigest(),
           'boundary': 'No field exclusions; old/new canonical-time distinctions were proved explicitly by route oracle'})


def save(page):
    tab(page, 'save'); trusted_click(page, '[data-action="save"]')
    return json.loads(raw(page))['state']


def boot(initial_raw, width=1440, fault=None, native_clock=False, extra_entries=None):
    global active_page
    envelope = json.loads(initial_raw)
    entries = [{'name': KEY, 'value': initial_raw}, {'name': 'infinity.ui.tab', 'value': 'overview'},
               {'name': 'infinity.save.v1', 'value': 'EXPLICIT LEGACY SENTINEL: retain unchanged'}]
    entries.extend(extra_entries or [])
    context = browser.new_context(viewport={'width': width, 'height': 1100}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{'origin': ORIGIN, 'localStorage': entries}]})
    if native_clock:
        # Synthetic fixture timestamp only. Native Date/performance/RAF stay untouched.
        setup = NATIVE_TIMING.replace('__KEY__', json.dumps(KEY)).replace('__ORIGIN__', json.dumps(ORIGIN))
    else:
        setup = CLOCK.replace('__EPOCH__', str(envelope['savedAt']))
    setup += "\nwindow.__scoutKeys=[];document.addEventListener('keydown',e=>window.__scoutKeys.push({key:e.key,trusted:e.isTrusted,id:e.target.id}),true);"
    if fault is not None:
        setup += '\n' + FAULT.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__FAULT__', json.dumps(fault))
    context.add_init_script(setup)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    verify_bundle(page); verify_document_response(response)
    if not native_clock:
        check('functional storage/File/dialog/timers native before declared wrappers', page.evaluate('window.__npcNative'))
    return context, page


def rehearsal_opener(page, ident=11, comparison_disabled=False):
    """Bind both complete direct controls before selecting the original action."""
    row_selector = f'#space-message-list > article.space-message[data-message-id="scout-{ident}"]'
    row = page.locator(row_selector)
    openers = row.evaluate(MESSAGE_OPENERS_SAMPLE_JS) if row.count() == 1 else None
    check('typed report has exactly ordered original rehearsal and comparison openers',
          exact_copied_data(openers, typed_message_openers(comparison_disabled)), openers)
    return row_selector + ' > button:not([data-npc-scout-comparison])'


def open_report(page, ident=11, comparison_disabled=False):
    tab(page, 'messages')
    selector = rehearsal_opener(page, ident, comparison_disabled)
    trusted_click(page, selector)
    expect(page.locator('#npc-rehearsal-panel')).to_be_visible()
    check('new panel zeroes separate dense13 selection and speed100',
          [page.locator('#npc-rehearsal-ship-' + ship).input_value() for ship in SHIPS] == ['0'] * 13
          and page.locator('#npc-rehearsal-speed').input_value() == '100')
    check('opening report does not run or format samples', page.locator('#npc-rehearsal-results .npc-battle-report').count() == 0)


def run_six(page):
    input_number(page, '#npc-rehearsal-ship-light_fighter', 6)
    trusted_click(page, '#npc-rehearsal-run')
    expect(page.locator('#npc-rehearsal-results > details.npc-battle-report')).to_have_count(3)
    expect(page.locator('#npc-rehearsal-fill')).to_be_enabled()


def control_proof(page, selector, name, capture=True, prepared=False):
    if not prepared:native_scroll_to(page, selector)
    proof = visibility(page, [selector]); glyphs = text_leaf_visibility(page, [selector])
    check(name + ': complete control five native hit points', all(row['visible'] and row['contained'] and all(p['unoccluded'] for p in row['points']) for row in proof['targets']), proof)
    check(name + ': every actual glyph visible within ancestor clips', all(row['passed'] for row in glyphs['leaves']), glyphs)
    check(name + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    if capture:snap(page, name + '.png')


def expose_round_cell(page, region, target):
    # Existing read-only geometry and exact trusted-wheel predicates. Each
    # attempt is recorded immutably once, without mutable growing audit aliases.
    wait_for_scroll_settled(page,target,region)
    for attempt in range(9):
        before=scroll_region_state(page,region,target)
        check('round target stays inside its original native scroller',before['region'] is not None and before['target'] is not None and before['target']['insideRegion'],before)
        plan=scroll_region_plan(before);proof=visibility(page,[target]);hits=scroll_pointer_hits(page,region,plan['points'])
        check('round cell fits actual horizontal clip and viewport height',plan['targetFitsX'] and plan['targetFitsY'],{'plan':plan,'state':before})
        fully_visible=all(row['visible'] and row['contained'] and len(row['points'])==5 and all(p['unoccluded'] for p in row['points']) for row in proof['targets'])
        if plan['targetContainedX'] and plan['targetContainedY'] and fully_visible:
            check('complete native round cell has all five unobstructed hit points',True,proof);return
        if attempt==8:break
        point=next((p for p in hits if p['insideRegion']),None)
        horizontal=plan['targetContainedY'] and not plan['targetContainedX'] and point is not None
        if not horizontal:point={'x':math.floor(before['viewport']['width']/2),'y':math.floor((before['viewport']['top']+before['viewport']['height'])/2)}
        page.mouse.move(point['x'],point['y']);before=scroll_region_state(page,region,target);plan=scroll_region_plan(before)
        point=scroll_pointer_hits(page,region,[point])[0]
        dx,dy=(plan['deltaX'],0) if horizontal else (0,plan['deltaY'])
        check('round scroll uses a real visible point and required nonzero delta',bool(point['hit']) and (dx!=0 or dy!=0),{'point':point,'dx':dx,'dy':dy})
        count=page.evaluate('window.__npcWheels.length');page.mouse.wheel(dx,dy)
        wait_for_scroll_settled(page,target,region)
        after=scroll_region_state(page,region,target);events=page.evaluate('(n)=>window.__npcWheels.slice(n)',count)
        record={'attempt':attempt+1,'axis':'horizontal' if horizontal else 'vertical','before':before,'point':point,'delta':{'x':dx,'y':dy},'after':after,'events':events}
        if horizontal:
            check('trusted round-table horizontal wheel hits exact scroller and advances offset',horizontal_wheel_proven(before,after,point,dx,events),record)
        else:
            check('trusted round-table vertical wheel advances document toward cell',(after['scrollY']-before['scrollY'])*dy>0 and bool(events) and all(e['trusted'] and e['deltaX']==0 and e['deltaY']==dy and e['clientX']==point['x'] and e['clientY']==point['y'] for e in events),record)
    check('round cell exposed within eight bounded native wheel inputs',False,{'target':target,'region':region})


def natural_presenter_copy(expected, state):
    """Independent literal copy contract for the earned six-LF scout11 case.
    No production presenter/constant import and no current NPC projection.
    The frozen examples must refer to the exact retained observation and the
    actually completed own inputs in the independent milestone state.
    """
    snapshot = expected['snapshot']
    messages = [m for m in state['messages'] if m['id'] == f'scout-{snapshot["fleetId"]}']
    if (len(messages) != 1 or not exact_json(messages[0]['npcScoutSnapshot'], snapshot)
            or snapshot['model'] != 'npc-scout-snapshot-v1'
            or [r['seed'] for r in expected['expected']] != [608135816, 2242054355, 320440878]
            or expected['selectedShips'] != {'light_fighter':6}
            or snapshot['garrison']['heavy_fighter'] != 0):
        raise ValueError('Natural presenter requires the exact retained history and three public LF examples')
    levels = state['research']['levels']; tech = expected['attackerTech']
    if (not exact_json(tech, {'weapons':levels['weapons_tech'],'shields':levels['shielding_tech'],'armour':levels['armour_tech']})
            or expected['cargoFactor'] != 1 + .05 * levels['hyperspace_tech']):
        raise ValueError('Natural presenter own inputs differ from completed milestone technology')
    origins = [p for p in state['planets'] if p['id'] == state['activePlanetId']]
    if len(origins) != 1: raise ValueError('Natural presenter requires one current selected origin')
    origin = origins[0]
    def coordinate(value): return ':'.join(str(value[k]) for k in ('galaxy','system','position'))
    def count(value): return f'轻型战斗机 {value}' if value else '无'
    def number(value):
        # The earned route has ordinary bounded decimal stock/cargo values.
        # Fail instead of using a rounding adapter for another numeric domain.
        if type(value) not in (int,float) or not math.isfinite(value) or value < 0 or value > 50000:
            raise ValueError('Natural presenter number is outside its declared route')
        result = str(int(value)) if value == int(value) else str(value)
        if 'e' in result.lower(): raise ValueError('Natural presenter requires ordinary decimal route numbers')
        return result
    def loot(value): return ' · '.join(f'{name} {number(n)}' for name,n in zip(('金属','晶体','重氢'),value))
    target = coordinate(snapshot['target']); model = 'npc-scout-snapshot-v1'
    summaries=[]
    for index,sample in enumerate(expected['expected'],1):
        battle=sample['battle']
        defenders = {'light_fighter':snapshot['garrison']['light_fighter']} if snapshot['garrison']['light_fighter'] else {}
        if (battle['attackerBefore'] != {'light_fighter':6} or battle['defenderBefore'] != defenders
                or set(battle['attackerAfter'])-{'light_fighter'}):
            raise ValueError('Natural presenter sample does not match the selected six light fighters and observed defenders')
        outcome='无驻军收集' if sample['undefended'] else {'attacker':'胜','defender':'败','draw':'平'}[battle['winner']]
        summaries.append(f'公开示例 {index} · {outcome} · {len(battle["rounds"])} 回合 · 永久损失 {6-battle["attackerAfter"].get("light_fighter",0)} 艘 · 历史可能装载：{loot(sample["loot"])}')
    return {
        'source':f'历史情报，之后可能变化 · 侦察抵达时间 {snapshot["observedAt"]} 秒 · {model}',
        'origin':f'当前所选星球：{origin["name"]} [{coordinate(origin["coordinates"])}] → 历史目标 [{target}]',
        'history':[
            messages[0]['text'],
            f'模型 {model}；历史出发星球 {snapshot["originId"]}；舰队 #{snapshot["fleetId"]}。',
            f'精确观察时间 {snapshot["observedAt"]} 秒；目标 [{target}]。历史情报，之后可能变化。',
            f'当时库存：{loot(snapshot["stock"])}。当时驻军：{count(snapshot["garrison"]["light_fighter"])}。',
            'NPC 当时武器 0 / 护盾 0 / 装甲 0。本页不会刷新或比对现在的 NPC 库存与驻军。'],
        'resultParagraphs':[
            '三个固定公开种子的示例，不代表胜率、所有结果或损失/战利品保证。仅使用这份侦察抵达时的库存和驻军；真实抵达时情况可能不同。',
            '种子组 npc-rehearsal-public-v1 · 本次编成：轻型战斗机 6 · 草稿速度 100%。',
            f'运行时已完成科技：武器 {tech["weapons"]} / 护盾 {tech["shields"]} / 装甲 {tech["armour"]}；货舱倍率 ×{number(expected["cargoFactor"])}。真实出征在派遣时冻结货舱倍率，在抵达时读取战斗科技，可能使用更新等级。'],
        'summaries':summaries,
    }


def assert_natural_presenter_copy(actual, expected, state):
    wanted = natural_presenter_copy(expected, state)
    check('complete independent historical-source public-example and captured-input copy',
          exact_json(actual, wanted), {'actual':actual,'expected':wanted})


def inspect_examples(page, width):
    expected = fixtures['naturalExamples']
    page.locator('#npc-rehearsal-history > summary').click(); advance(page)
    retained = next(row for row in fixtures['milestones'] if row['name'] == 'scout11-returned')['expected']
    actual = {
        'source':page.locator('#npc-rehearsal-source').inner_text(),
        'origin':page.locator('#npc-rehearsal-origin').inner_text(),
        'history':page.locator('#npc-rehearsal-history-body > p').all_inner_texts(),
        'resultParagraphs':page.locator('#npc-rehearsal-results > p').all_inner_texts(),
        'summaries':page.locator('#npc-rehearsal-results > details.npc-battle-report > summary').all_inner_texts(),
    }
    assert_natural_presenter_copy(actual, expected, retained)
    for key in ('source','origin'):
        control_proof(page, '#npc-rehearsal-' + key, f'{width}-exact-historical-{key}')
    control_proof(page, '#npc-rehearsal-history > summary', f'{width}-historical-detail')
    for index in (1,2,3,4,5):
        control_proof(page, f'#npc-rehearsal-history-body > p:nth-of-type({index})', f'{width}-exact-historical-stats-{index}')
    for index in (1,2,3):
        control_proof(page, f'#npc-rehearsal-results > p:nth-of-type({index})', f'{width}-exact-public-example-warning-and-inputs-{index}')
    for i, sample in enumerate(expected['expected'], 1):
        selector = f'#npc-rehearsal-results > details.npc-battle-report:nth-of-type({i})'
        control_proof(page, selector + ' > summary', f'{width}-public-example-{i}')
        check('closed sample has no preformatted rounds', page.locator(selector + ' table').count() == 0)
        page.locator(selector + ' > summary').click(); advance(page)
        battle=sample['battle']
        check('independent natural presenter accepts only literal light fighters',all(set(battle[key])<={'light_fighter'} for key in ('attackerBefore','attackerAfter','defenderAfter')))
        def count(n):return f'轻型战斗机 {n}' if n else '无'
        lost=battle['attackerBefore'].get('light_fighter',0)-battle['attackerAfter'].get('light_fighter',0)
        wanted_body=[f'公开种子 {sample["seed"]}；npc-rehearsal-public-v1；战斗模型 squadron-v1。',
            f'我方永久损失：{count(lost)}；幸存：{count(battle["attackerAfter"].get("light_fighter",0))}。NPC 剩余：{count(battle["defenderAfter"].get("light_fighter",0))}。']
        body=page.locator(selector+' > div > p').all_inner_texts()
        check('opened sample displays exact independently expected seed losses and survivors全文',body==wanted_body,{'actual':body,'expected':wanted_body})
        for paragraph in (1,2):control_proof(page,selector+f' > div > p:nth-of-type({paragraph})',f'{width}-sample-{i}-body-{paragraph}')
        nested = page.locator(selector + ' details > summary'); nested.click(); advance(page)
        rows = page.locator(selector + ' tbody tr').evaluate_all('(rows)=>rows.map(r=>[...r.cells].map(c=>Number(c.textContent)))')
        wanted = [[r[k] for k in ('round', 'attacker', 'defender', 'attackDamage', 'defendDamage')] for r in sample['battle']['rounds']]
        check('lazy actual native round cells match independent exact counts and predeclared damage tolerance', len(rows) == len(wanted) and all(
            a[:3] == b[:3] and all(abs(x-y) <= 1e-12 + 1e-14*abs(y) for x,y in zip(a[3:], b[3:])) for a,b in zip(rows,wanted)), rows)
        region=selector+' details > div.space-table-scroll'
        for column in range(1,6):
            for row in range(1,len(wanted)+1):
                cell=selector+f' tbody tr:nth-child({row}) td:nth-child({column})'
                expose_round_cell(page,region,cell)
                control_proof(page,cell,f'{width}-sample-{i}-round-{row}-column-{column}',capture=row==1,prepared=True)
        page.locator(selector + ' > summary').click(); advance(page)


# An isolated native A/B, not part of the historical natural action tape.
# This observer only reads input style mutations and keeps a bounded local log.
# disconnect() below stops this diagnostic observer, never a production observer.
SCREENSHOT_STYLE_PROBE = r'''()=>{
  const inputs=[...document.querySelectorAll('#npc-rehearsal-panel input')];
  const records=[];let overflow=false;
  const collect=batch=>{for(const record of batch){
    if(records.length>=64){overflow=true;continue;}
    const node=record.target;
    records.push({id:node.id,attribute:record.attributeName,oldStyle:record.oldValue,
      currentStyle:node.getAttribute('style'),caret:node.style.getPropertyValue('caret-color'),
      priority:node.style.getPropertyPriority('caret-color')});
  }};
  const observer=new MutationObserver(collect);
  for(const input of inputs)observer.observe(input,{attributes:true,attributeOldValue:true,attributeFilter:['style']});
  return {inputs:inputs.map(node=>node.id),records,observer,collect,overflow:()=>overflow};
}'''


def screenshot_caret_diagnostic():
    """Two fresh identical contexts prove actual screenshot mutation/retirement.
    Explicit hide is diagnostic only; acceptance pictures always keep initial.
    """
    row=next(r for r in fixtures['milestones'] if r['name']=='scout11-returned')
    for caret in ('hide','initial'):
        begin_case('EXPLICIT-INSTRUMENTATION-screenshot-caret-'+caret)
        context,page=boot(row['raw']);succeeded=False
        try:
            open_report(page);run_six(page)
            before_storage=storage(page);before_draft=draft_values(page)
            refs=page.evaluate_handle(REHEARSAL_CAPTURE_REFERENCES)
            probe=page.evaluate_handle(SCREENSHOT_STYLE_PROBE)
            name='instrumentation-caret-'+caret
            witness={'schema':'infinity-scout-caret-ab-v1','case':case,'caret':caret,
                     'before':None,'after':None,'trace':None,'screenshotStatus':'not-attempted',
                     'boundary':'Isolated screenshot instrumentation A/B on identical saved scout11 state; bounded read-only style observer; no production observer changes.'}
            witness_path=out/(name+'.json')
            try:
                witness['before']=refs.evaluate(REHEARSAL_CAPTURE_STATE);atomic_json(witness_path,witness)
                try:
                    path=out/(name+'.png');page.screenshot(path=str(path),full_page=False,timeout=2000,caret=caret)
                    witness['screenshotStatus']='captured'
                    evidence.append({'case':case,'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
                except BaseException:
                    witness['screenshotStatus']='failed';witness['screenshotError']=traceback.format_exc()
                    raise
                finally:
                    try:
                        witness['trace']=probe.evaluate('''probe=>{probe.collect(probe.observer.takeRecords());probe.observer.disconnect();
                          return {inputs:probe.inputs,records:probe.records,overflow:probe.overflow()};}''')
                    except BaseException:witness['traceReadError']=traceback.format_exc()
                    try:witness['after']=refs.evaluate(REHEARSAL_CAPTURE_STATE)
                    except BaseException:witness['afterReadError']=traceback.format_exc()
                    atomic_json(witness_path,witness)
                    reference={'kind':'screenshot-caret-ab','case':case,'file':witness_path.name,
                               'sha256':hashlib.sha256(witness_path.read_bytes()).hexdigest()}
                    evidence.append(reference);flush()
            finally:
                dispose_capture_handles(probe,refs)
            trace=witness['trace'];before=witness['before'];after=witness['after']
            check('isolated caret probe has complete before after and mutation evidence',
                  before is not None and after is not None and trace is not None,reference)
            expected_ids=['npc-rehearsal-ship-'+ship for ship in SHIPS]
            check('isolated caret probe observes exactly all thirteen rehearsal inputs without log overflow',
                  trace['inputs']==expected_ids and trace['overflow'] is False,reference)
            check('isolated caret probe begins with three enabled original public samples',
                  before['panelPresent'] and not before['panelHidden'] and before['sameNodes']
                  and before['resultCount']==3
                  and all(not node['disabled'] for node in before['nodes'] if node['id'] in ('npc-rehearsal-run','npc-rehearsal-fill')),
                  reference)
            if caret=='hide':
                records=trace['records']
                check('explicit caret hide writes transparent important and restores every rehearsal input style',
                      {r['id'] for r in records}==set(expected_ids)
                      and all(any(r['id']==ident and r['caret']=='transparent' and r['priority']=='important' for r in records)
                              and any(r['id']==ident and 'caret-color: transparent' in (r['oldStyle'] or '') and r['caret']=='' for r in records)
                              for ident in expected_ids),reference)
                check('explicit caret hide retires authority and removes original review result nodes',
                      after['samePanel'] and after['panelHidden'] and not after['sameNodes']
                      and not after['allOriginalNodesConnected']
                      and page.locator('#npc-rehearsal-results > details.npc-battle-report').count()==0
                      and page.locator('#npc-rehearsal-fill').is_disabled(),reference)
            else:
                check('explicit caret initial has no input style mutations and retains exact panel controls and results',
                      trace['records']==[] and before==after and after['allOriginalNodesConnected']
                      and page.locator('#npc-rehearsal-results > details.npc-battle-report').count()==3
                      and page.locator('#npc-rehearsal-fill').is_enabled(),reference)
            storage_check('isolated screenshot '+caret+' changes no complete native storage bytes',page,before_storage)
            unchanged_authority_draft(page,'isolated screenshot '+caret,before_draft)
            whole_state('isolated screenshot '+caret+' leaves every economic field unchanged',save(page),row['expected'])
            succeeded=True
        finally:
            # A failed active page must remain live for outer failure evidence.
            if succeeded:context.close()


def draft_values(page):
    return page.evaluate('''()=>({mission:document.querySelector('#flight-mission').value,
       target:['galaxy','system','position'].map(k=>document.querySelector('#flight-'+k).value),
       speed:document.querySelector('#flight-speed').value,
       ships:[...document.querySelectorAll('[data-ship]')].map(e=>[e.dataset.ship,e.value]),
       cargo:['metal','crystal','deuterium'].map(k=>document.querySelector('#cargo-'+k).value)})''')


def natural_rehearsal(page):
    before = save(page); disk_before = storage(page)
    storage_check('rehearsal baseline has exact persisted save preference and visible Save tab',
                  page, disk_before, initial_tab='save', visible_tab='save')
    # space-panel choose() is DOM-only and intercepts native space-tab clicks
    # before view.ts selectTab(). Every raw byte, including saved 'save', stays.
    # Separate ordinary DOM draft is deliberately dirty, with all13 and cargo.
    tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
    for ship in SHIPS:
        input_number(page, f'[data-ship="{ship}"]', 1)
    for resource in ('metal', 'crystal', 'deuterium'):
        input_number(page, '#cargo-' + resource, 7)
    dirty = draft_values(page)
    storage_check('ordinary dirty draft leaves every stored byte and saved preference unchanged',
                  page, disk_before, initial_tab='save', visible_tab='fleet')
    open_report(page)
    storage_check('opening report leaves every stored byte and saved preference unchanged',
                  page, disk_before, initial_tab='save', visible_tab='messages')
    check('open leaves every ordinary DOM draft field untouched', draft_values(page) == dirty)
    run_six(page)
    storage_check('Run leaves every stored byte and saved preference unchanged',
                  page, disk_before, initial_tab='save', visible_tab='messages')
    check('Run leaves every ordinary DOM draft field untouched', draft_values(page) == dirty)
    trusted_click(page, '#npc-rehearsal-cancel')
    expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
    storage_check('Cancel leaves every stored byte and saved preference unchanged',
                  page, disk_before, initial_tab='save', visible_tab='messages')
    whole_state('run-and-cancel-no-game-effects', save(page), before)
    for width in WIDTHS:
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        open_report(page); run_six(page); inspect_examples(page, width)
        control_proof(page, '#npc-rehearsal-run', f'{width}-explicit-run')
        control_proof(page, '#npc-rehearsal-fill', f'{width}-draft-fill')
        previous_bytes = storage(page)
        storage_check('four-width review leaves every stored byte and saved preference unchanged',
                      page, disk_before, initial_tab='save', visible_tab='messages')
        trusted_click(page, '#npc-rehearsal-fill')
        values = draft_values(page)
        check('Fill atomically replaces exactly mission/target/all13/speed/emptycargo', values == {
            'mission': 'attack', 'target': ['1','56','15'], 'speed': '100',
            'ships': [[ship, '6' if ship == 'light_fighter' else '0'] for ship in SHIPS], 'cargo': ['0','0','0']}, values)
        storage_check('Fill causes no payment/save/IDs/RNG/wallet/history or saved-preference write',
                      page, previous_bytes, initial_tab='save', visible_tab='fleet')
        for _ in range(3):advance(page)
        expect(page.locator('#npc-rehearsal-draft-notice')).to_have_text('仅已填入，尚未派遣或付款。请核对最新航程报价，再单独点击付费出征。')
        storage_check('unpaid draft notice survives later production chrome frames and stale global status',
                      page, previous_bytes, initial_tab='save', visible_tab='fleet')
        whole_state(f'{width}-draft-only-fullstate', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)
    # Last explicit new review/fill is left armed for the separately recorded send.
    open_report(page); run_six(page); trusted_click(page, '#npc-rehearsal-fill')
    storage_check('last explicit review and Fill retain every stored byte before separate paid send',
                  page, disk_before, initial_tab='save', visible_tab='fleet')


def configure_scout(page):
    tab(page, 'fleet'); select(page, '#flight-mission', 'scout')
    for key, value in fixtures['target'].items(): input_number(page, '#flight-' + key, value)
    for ship in SHIPS:
        value = '1' if ship == 'espionage_probe' else '0'
        if page.locator(f'[data-ship="{ship}"]').input_value() != value:
            input_number(page, f'[data-ship="{ship}"]', value)
    expect(page.locator('#space-send')).to_be_enabled()


def replay_natural(page):
    rows = {row['name']: row for row in fixtures['milestones']}
    for operation in fixtures['tape']:
        kind = operation['kind']
        if kind == 'advance': advance(page, int(operation['seconds']*1000))
        elif kind == 'checkpoint':
            row = rows[operation['name']]
            whole_state(operation['name'], save(page), row['expected'])
            if row['reload']:
                prior = raw(page); capture = page_sources[page]
                capture['cdp'].send('Debugger.enable'); capture['responses'].clear(); capture['executed'].clear()
                response = page.reload(wait_until='networkidle'); verify_bundle(page); verify_document_response(response)
                check('actual partial/paid/return reload retains exact raw bytes', raw(page) == prior)
                whole_state(operation['name'] + '-native-reload', save(page), row['expected'])
        elif kind == 'rehearsal': natural_rehearsal(page)
        elif kind in ('scout', 'attack'):
            if kind == 'scout': configure_scout(page)
            else:
                tab(page, 'fleet')
                check('separate paid send still uses explicit six-LF filled draft', page.locator('[data-ship="light_fighter"]').input_value() == '6')
            before = json.loads(raw(page))['state']; trusted_click(page, '#space-send')
            after = json.loads(raw(page))['state']
            check('separate trusted dispatch pays and allocates exactly one fresh ID', after['nextFleetId'] == before['nextFleetId'] + 1 and any(f['id'] == operation['fleetId'] for f in after['fleets']))
            if kind == 'attack':
                a,b = before['planets'][0],after['planets'][0]
                check('paid attack exact five-term fuel equation', Fraction(a['resources']['deuterium']) + Fraction(a['npcResourceRemainder']['deuterium']) - Fraction(operation['expectedFuel']) == Fraction(b['resources']['deuterium']) + Fraction(b['npcResourceRemainder']['deuterium']))
                check('successful actual send consumes selected draft', page.locator('[data-ship="light_fighter"]').input_value() == '0')
        else: raise AssertionError('Unknown natural tape operation: ' + kind)


def import_file(page, text, accept, label):
    envelope = json.loads(text); path = out / (label + '.json'); path.write_text(text)
    tab(page, 'save'); before = storage(page); dialogs = []
    state = json.loads(raw(page))['state']; planet = next(p for p in state['planets'] if p['id'] == state['activePlanetId'])
    confirmation = import_confirmation(envelope, f'第 {state["stats"]["launches"]+1} 轮，{len(state["planets"])} 颗星球，当前“{planet["name"]}”')
    def answer(dialog):
        valid = dialog.type == 'confirm' and dialog.message == confirmation
        dialogs.append({'valid': valid, 'message': dialog.message, 'accepted': bool(valid and accept)})
        dialog.accept() if valid and accept else dialog.dismiss()
    page.once('dialog', answer); page.locator('[data-bind="import-file"]').set_input_files(str(path))
    page.wait_for_timeout(100); advance(page)
    check('actual file read has exact expected confirmation once', len(dialogs) == 1 and dialogs[0]['valid'], dialogs)
    if accept: expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地')
    else: storage_check('cancelled import retains every native storage byte', page, before)
    return before


def unchanged_authority_draft(page, name, expected):
    # Capture every field before navigation/save can retire controls or mask a
    # partial edit. A non-attack mission alone is not an atomicity witness.
    actual = draft_values(page)
    check(name + ': complete ordinary draft unchanged', exact_json(actual, expected),
          {'actual': actual, 'expected': expected})


RETIRED_FILL_REFERENCES = r'''()=>{
  const panel=document.querySelector('#npc-rehearsal-panel');
  const fill=document.querySelector('#npc-rehearsal-fill');
  const results=document.querySelector('#npc-rehearsal-results');
  const cards=[...results.querySelectorAll('details.npc-battle-report')];
  return {panel,fill,results,cards,initial:{panelHidden:panel.hidden,fillDisabled:fill.disabled,
    fillConnected:fill.isConnected,cardCount:cards.length,cardsConnected:cards.every(e=>e.isConnected)}};
}'''
RETIRED_FILL_STATE = r'''refs=>{
  const panel=document.querySelector('#npc-rehearsal-panel');
  const fill=document.querySelector('#npc-rehearsal-fill');
  const results=document.querySelector('#npc-rehearsal-results');
  return {initial:refs.initial,samePanel:refs.panel===panel,sameResults:refs.results===results,
    sameFill:refs.fill===fill,fillCount:document.querySelectorAll('#npc-rehearsal-fill').length,
    panelConnected:panel?.isConnected??false,panelHidden:panel?.hidden??false,
    currentFillConnected:fill?.isConnected??false,currentFillDisabled:fill?.disabled??null,
    currentFillRectCount:fill?.getClientRects().length??null,
    originalFillConnected:refs.fill.isConnected,originalFillDisabled:refs.fill.disabled,
    originalCardsDetached:refs.cards.every(e=>!e.isConnected&&e.getClientRects().length===0),
    resultsHidden:results?.hidden??false,resultCount:results?.querySelectorAll('details.npc-battle-report').length??null,
    runDisabled:document.querySelector('#npc-rehearsal-run')?.disabled??null};
}'''


def retired_fill_boundary(page, refs, *, same_node):
    """Distinguish an unavailable native control from a real trusted refusal.
    Retain original capabilities across removal/ABA. A copied enabled property
    does not make a button in a hidden panel actionable. Never force visibility,
    script-click a hidden node, or treat absence as a passing negative case.
    """
    before=refs.evaluate(RETIRED_FILL_STATE)
    check('retirement starts from three live samples and the exact expected original/replacement Fill',
          before['initial']=={'panelHidden':False,'fillDisabled':False,'fillConnected':True,
                              'cardCount':3,'cardsConnected':True}
          and before['samePanel'] and before['sameResults'] and before['panelConnected']
          and before['fillCount']==1 and before['currentFillConnected']
          and before['sameFill'] is same_node and before['originalFillConnected'] is same_node,before)
    node=page.locator('#npc-rehearsal-fill')
    visible,enabled=node.is_visible(),node.is_enabled()
    start=page.evaluate('window.__npcClicks.length')
    if visible and enabled:
        action='trusted-click'
        trusted_click(page,'#npc-rehearsal-fill')
    else:
        action='native-unavailable'
        check('retired Fill is explicitly disabled or hidden with no native target geometry',
              (not enabled and before['currentFillDisabled'] is True)
              or (not visible and before['panelHidden'] and before['currentFillRectCount']==0),
              {'visible':visible,'enabled':enabled,'state':before})
    after=refs.evaluate(RETIRED_FILL_STATE)
    events=page.evaluate('(n)=>window.__npcClicks.slice(n)',start)
    witness={'action':action,'visibleBefore':visible,'enabledBefore':enabled,
             'before':before,'after':after,'events':events,
             'boundary':'Unavailable means no native action was attempted; only trusted-click tests event refusal.'}
    check('retired Fill native action has an exact zero-event or trusted-event witness',
          (events==[] and (after['currentFillDisabled'] is True
                          or after['panelHidden'] and after['currentFillRectCount']==0)
           if action=='native-unavailable' else len(events)==1
           and events[0]['trusted'] is True and events[0]['id']=='npc-rehearsal-fill'),witness)
    check('old Fill capability stays retired with disabled original controls and detached review cards',
          after['samePanel'] and after['sameResults'] and after['panelConnected']
          and after['fillCount']==1 and after['currentFillConnected']
          and after['sameFill'] is same_node and after['originalFillConnected'] is same_node
          and after['originalFillDisabled'] is True and after['runDisabled'] is True
          and after['originalCardsDetached'] and after['resultsHidden'] and after['resultCount']==0,witness)


FOREGROUND_STATE = r'''()=>({visibilityState:document.visibilityState,hidden:document.hidden,
  hasFocus:document.hasFocus(),dateNow:Date.now(),performanceNow:performance.now()})'''


def foreground_conflict_page(page):
    """Activate the real original tab, never synthesize visibility or clock state.
    Persist raw probes before each assertion and keep the final hashed witness
    even if activation, readiness or a read fails. Ordinary geometry checks follow.
    """
    selector='#space-message-list > article.space-message[data-message-id="scout-11"] > button:not([data-npc-scout-comparison])'
    path=out/'authority-conflict-foreground.json'
    witness={'schema':'infinity-scout-native-foreground-v1','case':case,'selector':selector,
             'before':None,'after':None,'frame':None,'afterFrame':None,
             'boundary':'Supported native bring_to_front and read-only visibility/focus/clock/frame probes; no synthetic visibility or clock changes.'}
    atomic_json(path,witness)
    try:
        witness['before']=page.evaluate(FOREGROUND_STATE);atomic_json(path,witness)
        page.bring_to_front()
        witness['after']=page.evaluate(FOREGROUND_STATE);atomic_json(path,witness)
        before,after=witness['before'],witness['after']
        check('actual original tab is visible and focused with unchanged clocks before protected controls',
              after['visibilityState']=='visible' and after['hidden'] is False and after['hasFocus'] is True
              and all(after[key]==before[key] for key in ('dateNow','performanceNow')),copy.deepcopy(witness))
        witness['frame']=page.evaluate('options=>window.__npcObserveFrame(options)',
                                       {'selector':selector,'timeoutMs':250})
        witness['afterFrame']=page.evaluate(FOREGROUND_STATE);atomic_json(path,witness)
        frame,final=witness['frame'],witness['afterFrame']
        timestamp=frame['nativeFrameTimestamp']
        check('foreground preparation receives a fresh native frame without advancing the game clock',
              frame['observerTimedOut'] is False and type(timestamp) in (int,float) and math.isfinite(timestamp)
              and frame['nativeFrameSequence']>0 and frame['controlledElapsed']==before['performanceNow']
              and frame['geometry']['rect'] is not None and final==after,copy.deepcopy(witness))
        # The real conflict retires comparison actions; historical rehearsal
        # reading stays enabled. Bind this exact protected shape after the frame.
        rehearsal_opener(page, comparison_disabled=True)
    finally:
        atomic_json(path,witness)
        evidence.append({'kind':'native-foreground-witness','case':case,'file':path.name,
                         'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        flush()


def authority_boundaries():
    before_row = next(r for r in fixtures['milestones'] if r['name'] == 'scout11-returned')
    for kind in ('forged', 'clone', 'detach', 'same-id-remount', 'planet', 'cancelled-import', 'corrupt-import', 'same-world-import', 'conflict'):
        begin_case('native-authority-' + kind)
        context,page = boot(before_row['raw']); open_report(page); run_six(page)
        before = save_without_navigation(page); draft_before = draft_values(page)
        if kind == 'forged':
            page.locator('#npc-rehearsal-fill').evaluate('(e)=>e.click()'); advance(page)
            storage_check('untrusted synthetic Fill cannot change draft or state', page, before,
                          condition=exact_json(draft_values(page), draft_before))
        elif kind in ('clone', 'detach', 'same-id-remount'):
            selector = '#npc-rehearsal-fill'
            refs=page.evaluate_handle(RETIRED_FILL_REFERENCES)
            try:
                page.locator(selector).evaluate('''(e,kind)=>{if(kind==='detach'){const p=e.parentNode,n=e.nextSibling;e.remove();p.insertBefore(e,n);}else{const c=e.cloneNode(true);e.replaceWith(c);}}''', kind)
                advance(page)
                retired_fill_boundary(page,refs,same_node=kind=='detach')
            finally:dispose_capture_handles(refs)
            storage_check('cloned detached or same-ID replacement cannot fill stale draft', page, before,
                          condition=exact_json(draft_values(page), draft_before))
        elif kind == 'planet':
            select(page, '#planet-select', 'colony-1'); expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
        elif kind == 'corrupt-import':
            tab(page,'save'); prior=storage(page); invalid=out/'explicit-corrupt-r14.json';invalid.write_text('{broken-current-envelope')
            page.locator('[data-bind="import-file"]').set_input_files(str(invalid))
            expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败')
            storage_check('corrupt prepared import never adopts or alters raw/backups', page, prior)
            tab(page,'messages');expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
        elif kind in ('cancelled-import', 'same-world-import'):
            import_file(page, before_row['raw'], kind == 'same-world-import', kind)
            tab(page,'messages'); expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
            open_report(page); check('world/cancel invalidation requires fresh explicit Run', page.locator('#npc-rehearsal-fill').is_disabled())
        else:
            # Genuine same-origin storage event from second native page. It changes only metadata bytes.
            other=context.new_page(); other.goto(args.url, wait_until='networkidle')
            competing = json.loads(before_row['raw']); competing['savedAt'] += 1
            competing_raw = json.dumps(competing,ensure_ascii=False)
            other.evaluate('([key,value])=>localStorage.setItem(key,value)', [KEY,competing_raw])
            foreground_conflict_page(page)
            expect(page.locator('[data-bind="notice"]')).to_be_visible(); advance(page)
            storage_events=page.evaluate('window.__npcStorage')
            check('real trusted cross-tab storage event carries exact original and competing bytes',
                  any(event['trusted'] is True and event['oldValue']==before[KEY]
                      and event['newValue']==competing_raw for event in storage_events),storage_events)
            expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
            open_report(page, comparison_disabled=True); check('protected history stays readable but edits Run Fill disabled', page.locator('#npc-rehearsal-run').is_disabled() and page.locator('#npc-rehearsal-fill').is_disabled())
            unchanged_authority_draft(page, 'protected conflict', draft_before)
            storage_check('protected history reading preserves exact competing disk and all backups',
                          page, before, {**before, KEY: competing_raw})
            # A conflict must not save/adopt the local in-memory state. Exercise
            # the ordinary blocked Save, then export its exact protected source.
            tab(page, 'save'); protected_disk = storage(page)
            trusted_click(page, '[data-action="save"]')
            storage_check('ordinary Save stays blocked under conflict without disk/backups changes', page, protected_disk)
            with page.expect_download() as pending:
                trusted_click(page, '[data-action="export"]')
            protected_export = out / 'authority-conflict-protected-original.json'
            pending.value.save_as(str(protected_export))
            check('conflict export is exact original protected bytes, never competing or freshly serialized state',
                  protected_export.read_bytes() == before[KEY].encode())
            storage_check('protected export does not modify disk or backups', page, protected_disk)
            other.close();page.reload(wait_until='networkidle');advance(page);open_report(page)
            check('actual conflict refresh needs a fresh explicit review',page.locator('#npc-rehearsal-fill').is_disabled())
            run_six(page)
        unchanged_authority_draft(page, 'authority-' + kind, draft_before)
        if kind != 'conflict':
            # Disk equality alone misses unsaved mutations. Normal Save exposes
            # the live state; compare every domain with the independent oracle.
            expected = copy.deepcopy(before_row['expected'])
            if kind == 'planet': expected['activePlanetId'] = 'colony-1'
            whole_state('authority-' + kind + '-live-state', save(page), expected)
        context.close()


def save_without_navigation(page):
    # Exact native storage witness while panel remains open, no game globals.
    return storage(page)


def keyboard_and_paid_completion():
    row=next(r for r in fixtures['milestones'] if r['name']=='scout11-returned')
    begin_case('native-keyboard-Escape-focus')
    context,page=boot(row['raw']);open_report(page)
    check('opening report focuses actual panel title',page.locator('#npc-rehearsal-title').evaluate('(e)=>document.activeElement===e'))
    field=page.locator('#npc-rehearsal-ship-light_fighter');field.focus();field.press('Escape');advance(page)
    expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
    opener=rehearsal_opener(page)
    check('trusted keyboard Escape retires review and restores exact opener focus',page.locator(opener).evaluate('(e)=>document.activeElement===e') and any(e['trusted'] and e['key']=='Escape' for e in page.evaluate('window.__scoutKeys')))
    whole_state('keyboard-cancel-does-not-change-game',save(page),row['expected']);context.close()
    begin_case('actual-paid-build-and-research-completion-invalidates-review')
    branch=fixtures['branches']['paidCompletion'];context,page=boot(branch['start']['raw'])
    tab(page,'shipyard');input_number(page,'[data-bind="uqty-light_fighter"]',1);trusted_click(page,'[data-bind="ubuild-light_fighter"]')
    whole_state('actual-paid-seventh-fighter-queue',save(page),branch['afterShip']['envelope']['state'])
    tab(page,'research');trusted_click(page,'[data-bind="research-weapons_tech"]')
    whole_state('actual-paid-weapons2-queue',save(page),branch['paid']['envelope']['state'])
    open_report(page);run_six(page)
    frozen=page.locator('#npc-rehearsal-results').inner_text()
    check('Run freezes completed weapons1 and six owned fighters despite paid queues','武器 1 / 护盾 5 / 装甲 0' in frozen and page.locator('#npc-rehearsal-stock-light_fighter').inner_text()=='可用 6')
    previous=branch['paid']['envelope']['state'];retired=0
    for index,step in enumerate(branch['steps']):
        advance(page,int(step['seconds']*1000));current=step['expected']
        changed=current['planets'][0]['units']['light_fighter']!=previous['planets'][0]['units']['light_fighter'] or current['research']['levels']['weapons_tech']!=previous['research']['levels']['weapons_tech']
        if changed:
            expect(page.locator('#npc-rehearsal-fill')).to_be_disabled();retired+=1
            check('real completed stock/research retires Fill while frozen historical samples stay unchanged',page.locator('#npc-rehearsal-results').inner_text()==frozen)
            old_cards=page.locator('#npc-rehearsal-results > details.npc-battle-report').element_handles()
            original_panel=page.locator('#npc-rehearsal-panel').element_handle()
            check('stale review still has three original connected cards before same-panel rerun',len(old_cards)==3 and all(card.evaluate('(e)=>e.isConnected') for card in old_cards))
            trusted_click(page,'#npc-rehearsal-run')
            expect(page.locator('#npc-rehearsal-panel')).to_be_visible();expect(page.locator('#npc-rehearsal-fill')).to_be_enabled()
            identity=page.evaluate('''({old,panel})=>({samePanel:panel===document.querySelector('#npc-rehearsal-panel'),
                oldDetached:old.every(e=>!e.isConnected&&e.getClientRects().length===0),
                newDistinct:[...document.querySelectorAll('#npc-rehearsal-results > details.npc-battle-report')].length===3&&[...document.querySelectorAll('#npc-rehearsal-results > details.npc-battle-report')].every(e=>!old.includes(e)),
                fillEnabled:!document.querySelector('#npc-rehearsal-fill').disabled})''',{'old':old_cards,'panel':original_panel})
            check('trusted same-panel stale rerun retires old DOM cards and authorizes exactly one new review',all(identity.values()),identity)
            check('same-panel rerun captures freshly completed levels and stock',f'武器 {current["research"]["levels"]["weapons_tech"]} / 护盾 5 / 装甲 0' in page.locator('#npc-rehearsal-results').inner_text() and page.locator('#npc-rehearsal-stock-light_fighter').inner_text()==f'可用 {current["planets"][0]["units"]["light_fighter"]}')
            for card in old_cards:card.dispose()
            original_panel.dispose()
        whole_state(f'actual-paid-completion-step-{index}',save(page),current)
        if index+1<len(branch['steps']):
            open_report(page);run_six(page);frozen=page.locator('#npc-rehearsal-results').inner_text()
        previous=current
    check('at least one actual paid completion retired review',retired>0)
    open_report(page);run_six(page)
    check('fresh explicit Run captures actual completed weapons2 and seven-stock bound','武器 2 / 护盾 5 / 装甲 0' in page.locator('#npc-rehearsal-results').inner_text() and page.locator('#npc-rehearsal-stock-light_fighter').inner_text()=='可用 7')
    before=storage(page);trusted_click(page,'#npc-rehearsal-fill')
    for _ in range(3):advance(page)
    storage_check('fresh Fill after real completion is still unpaid', page, before)
    trusted_click(page,'#space-send')
    whole_state('separate-fresh-send-after-completion',save(page),branch['sent']['expected'])
    context.close()


def leaf_retirement_boundaries():
    row=next(r for r in fixtures['milestones'] if r['name']=='scout11-returned')
    for selector in ('#npc-rehearsal-run','#npc-rehearsal-fill','#npc-rehearsal-ship-light_fighter','#npc-rehearsal-speed'):
        for attribute in ('hidden','style','aria-hidden'):
            begin_case('EXPLICIT-DOM-own-leaf-retirement-'+selector+'-'+attribute)
            context,page=boot(row['raw']);open_report(page);run_six(page);before=storage(page);draft=draft_values(page)
            refs=page.evaluate_handle(RETIRED_FILL_REFERENCES)
            try:
                page.locator(selector).evaluate('''(e,a)=>{const old=e.getAttribute(a);e.setAttribute(a,a==='style'?'display:none':a==='aria-hidden'?'true':'');if(old===null)e.removeAttribute(a);else e.setAttribute(a,old);}''',attribute)
                advance(page)
                retired_fill_boundary(page,refs,same_node=True)
            finally:dispose_capture_handles(refs)
            fill=page.locator('#npc-rehearsal-fill')
            storage_check('same-turn own leaf hide/restore permanently retires old review capability', page, before,
                          condition=draft_values(page)==draft and (page.locator('#npc-rehearsal-panel').is_hidden() or fill.is_disabled()))
            unchanged_authority_draft(page, 'leaf-' + selector + '-' + attribute, draft)
            whole_state('leaf-' + selector + '-' + attribute + '-live-state', save(page), row['expected'])
            context.close()


def curvature_and_eviction():
    branch = fixtures['branches'].get('curvature')
    check('natural earned curvature branch is available', bool(branch))
    for accepted in (False, True):
        begin_case('natural-curvature-' + str(accepted)); context,page = boot(branch['before']['raw'])
        open_report(page); run_six(page); tab(page,'curvature'); dialogs=[]
        def answer(dialog):
            valid=dialog.type=='confirm' and dialog.message==branch['confirmation'];dialogs.append({'valid':valid,'message':dialog.message}); dialog.accept() if accepted and valid else dialog.dismiss()
        page.once('dialog',answer); trusted_click(page,'[data-action="prestige"]')
        check('curvature requires actual explicit confirmation', len(dialogs)==1 and dialogs[0]['valid'])
        expected = branch['expected']['envelope']['state'] if accepted else branch['before']['envelope']['state']
        whole_state('curvature-' + str(accepted),save(page),expected)
        open_report(page); expect(page.locator('#npc-rehearsal-fill')).to_be_disabled()
        if accepted: check('historical report uses current post-curvature origin and zero stock selection', all(page.locator('#npc-rehearsal-ship-'+s).input_value()=='0' for s in SHIPS))
        context.close()
    begin_case('EXPLICIT-SYNTHETIC-FIFO-eviction'); context,page=boot(fixtures['branches']['eviction']['raw'])
    open_report(page); run_six(page); advance(page,1000)
    expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
    current=save(page); check('151st ordinary already-paid return message evicts exact open observation',len(current['messages'])==150 and all(m['id']!='scout-11' for m in current['messages']) and current['fleets']==[] and current['planets'][0]['units']['espionage_probe']==1)
    tab(page,'messages'); expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
    check('evicted report has no retained entry capability',page.locator('article[data-message-id="scout-11"]').count()==0)
    context.close()


def storage_boundaries():
    row = next(r for r in fixtures['milestones'] if r['name']=='scout11-returned')
    for fault in ({'target':'current','operation':'write','mode':'throw'}, {'target':'current','operation':'readback'},
                  {'target':'backup','operation':'write','mode':'throw'}, {'target':'backup','operation':'readback'}):
        begin_case('EXPLICIT-native-storage-fault-'+json.dumps(fault,sort_keys=True))
        initial = fixtures['origin']['raw'] if fault['target']=='backup' else row['raw']
        context,page=boot(initial,fault=fault)
        if fault['target']=='current':
            open_report(page); run_six(page); advance(page,1000); tab(page,'save'); trusted_click(page,'[data-action="save"]')
        expect(page.locator('[data-bind="notice"]')).to_be_visible()
        audit=page.evaluate('window.__npcFaultAudit')
        check('declared native storage fault reached',any(x['kind'].startswith(('write-','readback-')) for x in audit),audit)
        tab(page,'save')
        with page.expect_download() as pending:
            trusted_click(page,'[data-action="export"]')
        export_path=out/('protected-'+fault['target']+'-'+fault['operation']+'.json');pending.value.save_as(str(export_path))
        check('protected export retains exact original complete raw progress',export_path.read_bytes()==initial.encode())
        retained=storage(page)
        evidence.append({'kind':'storage-fault','fault':fault,'audit':audit,'retained':retained,
            'boundary':'Successful setItem then failing readback may have changed disk. No unchanged-disk claim.'})
        context.close()
    begin_case('EXPLICIT-native-full64-backup-archive')
    filled=[{'name':KEY+'.backup'+('' if i==0 else '.'+str(i)),'value':'Explicit preserved backup '+str(i)} for i in range(64)]
    context,page=boot(fixtures['origin']['raw'],extra_entries=filled)
    expect(page.locator('[data-bind="notice"]')).to_be_visible()
    kept=storage(page)
    check('full64 archive blocks migration without deleting any backup or current original',
          kept[KEY]==fixtures['origin']['raw'] and all(kept[r['name']]==r['value'] for r in filled))
    tab(page,'save')
    with page.expect_download() as pending:trusted_click(page,'[data-action="export"]')
    exported=out/'full64-original.json';pending.value.save_as(str(exported))
    check('full64 original remains byte-exact exportable',exported.read_bytes()==fixtures['origin']['raw'].encode())
    context.close()
    begin_case('EXPLICIT-synthetic150-native-storage-copies')
    pressure=fixtures['branches']['maxMessages']; context,page=boot(pressure['raw'])
    whole_state('actual150typed-native-reader',save(page),pressure['envelope']['state'])
    import_file(page,pressure['raw'],True,'150typed-reimport')
    whole_state('actual150typed-native-reimport',save(page),pressure['envelope']['state'])
    copies=storage(page); rows=[{'key':k,'utf8':len(v.encode()),'utf16':len(v.encode('utf-16-le')),'sha256':hashlib.sha256(v.encode()).hexdigest()} for k,v in copies.items() if k==KEY or k.startswith(KEY+'.backup')]
    check('actual native retained typed copies counted without assumed quota headroom',len(rows)>=2 and any('.backup' in r['key'] for r in rows),rows)
    evidence.append({'kind':'actual-typed-storage-bytes','copies':rows,'totalUtf8':sum(r['utf8'] for r in rows),'totalUtf16':sum(r['utf16'] for r in rows),'scope':'Actual synthetic150-message current/backup copies only, not whole-product maximum or64-backup bound'})
    context.close()


def measured_upper_bound():
    global performance_result
    begin_case('EXPLICIT-SYNTHETIC-native-unmodified-clock-upper13')
    context,page=boot(fixtures['branches']['performance']['raw'],native_clock=True)
    check('measurement clocks are native and unmodified',page.evaluate('window.__timingNative'))
    page.locator('[data-tab="messages"]').click()
    page.locator(rehearsal_opener(page)).click()
    for ship in SHIPS: page.locator('#npc-rehearsal-ship-'+ship).fill('1000000000000')
    cdp=page.context.new_cdp_session(page); cdp.send('Performance.enable')
    before={r['name']:r['value'] for r in cdp.send('Performance.getMetrics')['metrics']}
    page.evaluate('window.__timingArmed=true;window.__timingLongTasks=[];window.__timingRuns=[]')
    page.locator('#npc-rehearsal-run').click()
    expect(page.locator('#npc-rehearsal-results > details.npc-battle-report')).to_have_count(3)
    page.wait_for_timeout(100)
    after={r['name']:r['value'] for r in cdp.send('Performance.getMetrics')['metrics']}
    witness=page.evaluate('({runs:window.__timingRuns,longTasks:window.__timingLongTasks,native:window.__timingNative,userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency})')
    performance_result={**witness,'metricsBefore':before,'metricsAfter':after,
        'scriptSeconds':after['ScriptDuration']-before['ScriptDuration'],'taskSeconds':after['TaskDuration']-before['TaskDuration'],
        'heapDeltaBytes':after['JSHeapUsedSize']-before['JSHeapUsedSize'],
        'heapScope':'Net retained JS heap delta over observed window, not peak allocation.',
        'boundary':'Native unmodified performance.now measures trusted synchronous Run event capture-to-bubble. PerformanceObserver sees window longtasks. Read-only CDP metrics, no CPU profiler and no paint claim.',
        'machine':{'platform':sys.platform,'cpuCount':os.cpu_count(),'browserVersion':browser.version}}
    check('one explicit native Run dispatch performs three bounded upper13 samples',len(witness['runs'])==1 and witness['runs'][0]['trusted'],performance_result)
    check('upper13 Run actual native duration below50ms or acceptance blocks',witness['runs'][0]['duration']<50,performance_result)
    check('upper13 observation window contains no>=50ms native longtask',not any(r['duration']>=50 for r in witness['longTasks']),performance_result)
    check('upper13 actual script CPU and heap bounded',performance_result['scriptSeconds']<.05 and performance_result['heapDeltaBytes']<16*1024*1024,performance_result)
    page.evaluate('window.__timingArmed=false;window.__reviewNodes=[...document.querySelectorAll("#npc-rehearsal-results > details.npc-battle-report")]')
    page.locator('#npc-rehearsal-run').dblclick()
    check('trusted repeated Run clicks stay quote-only without result recreation or extra sample cache',
          page.evaluate('window.__reviewNodes.length===3&&window.__reviewNodes.every((n,i)=>n===document.querySelectorAll("#npc-rehearsal-results > details.npc-battle-report")[i])')
          and page.locator('#npc-rehearsal-results table').count()==0)
    context.close()


NATIVE_TIMING = r'''(()=>{if(location.origin!==__ORIGIN__)return;
 const k=__KEY__,e=JSON.parse(localStorage.getItem(k));e.savedAt=e.lastTickAt=Date.now();localStorage.setItem(k,JSON.stringify(e));
 window.__timingNative=[Date.now,performance.now,requestAnimationFrame,Storage.prototype.setItem].every(f=>/\[native code\]/.test(Function.prototype.toString.call(f)));
 window.__timingArmed=false;window.__timingRuns=[];window.__timingLongTasks=[];
 new PerformanceObserver(list=>{if(window.__timingArmed)window.__timingLongTasks.push(...list.getEntries().map(e=>({startTime:e.startTime,duration:e.duration,name:e.name})));}).observe({type:'longtask',buffered:false});
 let start=null;document.addEventListener('click',e=>{if(window.__timingArmed&&e.target.id==='npc-rehearsal-run')start=performance.now();},true);
 document.addEventListener('click',e=>{if(start!==null&&e.target.id==='npc-rehearsal-run'){window.__timingRuns.push({trusted:e.isTrusted,start,duration:performance.now()-start});start=null;}},false);
})();'''


def main():
    global args,out,report_path,journal_path,progress_path,fixture_sha256,fixtures,KEY,ORIGIN,checks,errors,failed_requests,evidence,source_bindings,page_sources,release_metadata,completed,active_page,source_sha,failure,case,journal,last_progress_at,performance_result,browser,CLOCK,FAULT,expect
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--natural-report',required=True);parser.add_argument('--expected-report-sha256',required=True)
    parser.add_argument('--expected-sha',default=os.environ.get('GITHUB_SHA'));parser.add_argument('--release')
    parser.add_argument('--output',required=True);parser.add_argument('--chromium');parser.add_argument('--worker',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('Native scout acceptance is CI-only; local browser execution is not authorized.')
    if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}',args.expected_sha):parser.error('Exact expected source SHA required')
    if not re.fullmatch(r'[0-9a-f]{64}',args.expected_report_sha256):parser.error('Exact complete natural report SHA256 required')
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    report_path=out/'scout-rehearsal-browser-report.json';journal_path=out/'scout-rehearsal-checks.jsonl';progress_path=out/'scout-rehearsal-progress.json'
    load_shared_helpers()
    if not args.worker:
        supervise();return
    # The CI gates above run before even importing the browser package.
    from playwright.sync_api import sync_playwright, expect as native_expect
    expect=native_expect
    fixture_bytes=Path(args.natural_report).read_bytes();fixture_sha256=hashlib.sha256(fixture_bytes).hexdigest()
    if fixture_sha256!=args.expected_report_sha256:raise ValueError('Natural oracle bytes do not match independently pinned hash')
    fixtures=json.loads(fixture_bytes)
    if not valid_natural_report(fixtures,args.expected_sha):raise ValueError('Natural oracle provenance/completeness gate failed')
    fixtures['base']=json.loads(fixtures['milestones'][0]['raw']);KEY=fixtures['key']
    parsed=urlparse(args.url)
    if parsed.scheme not in ('http','https'):raise ValueError('Actual production HTTP(S) required')
    ORIGIN=f'{parsed.scheme}://{parsed.netloc}'
    # Reuse exact existing controlled-clock and explicit storage-fault scripts.
    tree=ast.parse((ROOT/'scripts/browser-npc-attack.py').read_text())
    for name in ('CLOCK','FAULT'):
        node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets))
        exec(compile(ast.Module(body=[node],type_ignores=[]),'<shared-functional-clock>','exec'),globals())
    checks,errors,failed_requests,evidence,source_bindings=[],[],[],[],[]
    page_sources,release_metadata={},None;completed,active_page,source_sha,failure=False,None,None,None
    case='setup';journal=NativeCheckJournal(journal_path);last_progress_at=0;performance_result=None;reset_recorder()
    signal.signal(signal.SIGALRM,lambda *_: (_ for _ in ()).throw(TimeoutError('900-second native worker bound')));signal.alarm(900)
    try:
        with sync_playwright() as p, live_failure_evidence():
            browser=p.chromium.launch(headless=True,**({'executable_path':args.chromium} if args.chromium else {}))
            screenshot_caret_diagnostic()
            begin_case('natural-unedited-paid31-migration')
            context,page=boot(fixtures['origin']['raw'])
            backups=storage(page)
            backup_keys=[k for k,v in backups.items() if k.startswith(KEY+'.backup') and v==fixtures['origin']['raw']]
            check('migration exact original r13 bytes backed up once',len(backup_keys)==1,{'matchingBackupKeys':backup_keys})
            check('initial migration storage has only current save exact backup legacy sentinel and overview preference',set(backups)=={KEY,backup_keys[0],'infinity.save.v1','infinity.ui.tab'} and backups['infinity.save.v1']=='EXPLICIT LEGACY SENTINEL: retain unchanged' and backups['infinity.ui.tab']=='overview' and json.loads(backups[KEY])==fixtures['base'],backups)
            replay_natural(page);context.close()
            authority_boundaries();keyboard_and_paid_completion();leaf_retirement_boundaries();curvature_and_eviction();storage_boundaries();measured_upper_bound()
            check('no application error or failed native request',not errors and not failed_requests,{'errors':errors,'requests':failed_requests})
            completed=True;flush(full=True,final=True);browser.close()
    finally:
        signal.alarm(0)


def supervise():
    if any(out.iterdir()):raise SystemExit('Use a new empty evidence directory')
    atomic_json(report_path,{'completed':False,'result':'starting','checks':[]})
    owned={}
    def process_info(pid):
        try:
            fields=Path(f'/proc/{pid}/stat').read_text().rsplit(') ',1)[1].split()
            return {'pid':pid,'birth':fields[19],'state':fields[0]}
        except (OSError,IndexError,ValueError):return None
    def collect(root):
        pending,seen=[root,*owned],set()
        while pending:
            pid=pending.pop()
            if pid in seen:continue
            seen.add(pid);info=process_info(pid)
            if info is None or pid in owned and owned[pid]!=info['birth']:continue
            owned[pid]=info['birth']
            for path in Path(f'/proc/{pid}/task').glob('*/children'):
                try:pending.extend(map(int,path.read_text().split()))
                except OSError:pass
    def terminate(sig):
        for pid,birth in reversed(list(owned.items())):
            info=process_info(pid)
            if info and info['birth']==birth:
                try:os.kill(pid,sig)
                except ProcessLookupError:pass
    expired,code=False,1
    with (out/'worker.log').open('w') as log:
        worker=subprocess.Popen([sys.executable,__file__,*sys.argv[1:],'--worker'],stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        deadline=time.monotonic()+910
        try:
            while True:
                collect(worker.pid);remaining=deadline-time.monotonic()
                if remaining<=0:expired=True;break
                try:code=worker.wait(timeout=min(.2,remaining));break
                except subprocess.TimeoutExpired:pass
        finally:
            collect(worker.pid);terminate(signal.SIGTERM)
            try:worker.wait(timeout=2)
            except subprocess.TimeoutExpired:pass
            time.sleep(.1);terminate(signal.SIGKILL);worker.wait(timeout=2)
    residual=[info for pid,birth in owned.items() if (info:=process_info(pid)) and info['birth']==birth]
    live=[r for r in residual if r['state'] not in ('Z','X')]
    report=recover_native_report(journal_path,report_path,progress_path,not(expired or code or live))
    report['workerExitCode']=code;report['processCleanup']={'observedProcessCount':len(owned),'terminalObservedResiduals':residual,'terminalObservedLiveCount':len(live),
        'boundary':'Only observed descendants with matching PID/start time signaled; sampled observation does not prove absence of fast orphan processes.'}
    if expired or code or live:report.update(completed=False,result='watchdog-timeout' if expired else 'failed')
    atomic_json(report_path,report)
    print(json.dumps({'completed':report.get('completed'),'checks':len(report.get('checks',[])),'report':str(report_path)}))
    sys.exit(code if code else 0 if report.get('completed') else 1)


if __name__=='__main__':main()
