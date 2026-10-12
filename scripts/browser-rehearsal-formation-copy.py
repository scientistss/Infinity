"""CI-only native named-formation -> historical-rehearsal quantity acceptance.

Actual paid31 raw and unchanged economic tape earn both retained scouts. At the
original rehearsal checkpoint, real UI saves the named six-fighter design; all
later complete state oracles explicitly add only that saved formation record.
Copy, Run, historical examples and Fill remain separate from actual paid dispatch.
Explicit DOM attacks and synthetic upper-limit inputs are labeled and isolated.
This is additional evidence: verify, verify-continuation, npc-orbital,
scout-rehearsal and required-gates must all pass for this exact committed SHA.
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
from scout_fixture_identity import scout_fixture_identity

ROOT = Path(__file__).resolve().parents[1]
HOST_STARTED_MONOTONIC = time.monotonic()
WIDTHS = (320, 390, 768, 1440)
SOURCE_PIN = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52'
RAW_PIN = 'fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b'
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship',
         'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'colony_ship')
RESOURCE_NAMES = ('metal', 'crystal', 'deuterium')
PREFIX = '#npc-rehearsal-'
PANEL = PREFIX + 'panel'
MAX_FORMATION_QUANTITY = 1_000_000
MAX_MANUAL_QUANTITY = 1_000_000_000_000
NATURAL_FORMATION_NAME = '原生护航 <舰&🚀>'
CANDIDATE_VERSION = '0.6.23-alpha.1'
SOURCE_AREAS = ('src', 'scripts', 'tests', 'public', '.github')


def load_reviewed_helpers():
    """Named definitions only: no other runner, top-level CLI, browser, or model.
    Reused helpers resolve this runner's own bounded append journal and witness.
    """
    names = {'valid_natural_report', 'load_shared_helpers', 'advance', 'tab', 'raw', 'storage',
             'storage_check', 'capture_live_failure', 'live_failure_evidence', 'boot',
             'configure_scout', 'import_file', 'draft_values', 'dispose_capture_handles',
             'snap', 'open_report', 'rehearsal_opener', 'natural_presenter_copy',
             'assert_natural_presenter_copy'}
    constants = {'REHEARSAL_CAPTURE_REFERENCES', 'REHEARSAL_CAPTURE_STATE'}
    tree = ast.parse((ROOT / 'scripts/browser-scout-rehearsal.py').read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names
             or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in constants for target in node.targets)]
    if {node.name for node in nodes if isinstance(node, (ast.FunctionDef, ast.ClassDef))} != names:
        raise RuntimeError('Reviewed formation-copy helper contract changed')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed-formation-copy-helpers>', 'exec'), globals())
    load_shared_helpers()


def dense_counts(ships, *, limit=MAX_FORMATION_QUANTITY):
    """Independent JSON-contract oracle. Never imports production formation code."""
    if (type(ships) is not dict or not ships or set(ships) - set(SHIPS)
            or any(type(value) is not int or not 1 <= value <= limit for value in ships.values())):
        raise ValueError('Sparse saved formation requires positive bounded flying counts')
    return {ship: str(ships.get(ship, 0)) for ship in SHIPS}


def expected_deficits(ships, landed):
    dense = dense_counts(ships)
    if (type(landed) is not dict or any(type(landed.get(ship, 0)) is not int
            or not 0 <= landed.get(ship, 0) <= 2**53-1 for ship in SHIPS)):
        raise ValueError('Landed inventory must contain safe nonnegative integers')
    return [{'unit': ship, 'target': int(dense[ship]), 'landed': landed.get(ship, 0),
             'deficit': max(0, int(dense[ship]) - landed.get(ship, 0))} for ship in SHIPS]


def with_formations(expected, formations):
    value = copy.deepcopy(expected)
    if formations is not None:
        value['formations'] = copy.deepcopy(formations)
    return value


def original_natural_formations():
    """Literal paid31 source library; the older saved design is never removed."""
    return {'nextFormationId': 2, 'entries': [{'id': 1, 'revision': 1,
            'name': '首轮母星运输护航编队', 'ships': {'small_cargo': 2, 'light_fighter': 1}}]}


def natural_copy_design(state):
    """Resolve the one UI-created design without confusing it with source #1."""
    wanted = original_natural_formations()
    design = {'id': 2, 'revision': 1, 'name': NATURAL_FORMATION_NAME, 'ships': {'light_fighter': 6}}
    wanted['entries'].append(design)
    wanted['nextFormationId'] = 3
    actual = state.get('formations')
    # JSON equality keeps numeric booleans distinct and binds every library field.
    if json.dumps(actual, sort_keys=True, ensure_ascii=False, allow_nan=False) != json.dumps(wanted, sort_keys=True, ensure_ascii=False):
        raise AssertionError('Natural library must retain exact source #1 and the sole UI-created design #2')
    return copy.deepcopy(design)


def natural_source_change_expected(baseline, design, action):
    """Independent oracle changes only the explicitly selected new library ID."""
    if design != natural_copy_design(baseline):
        raise AssertionError('Source mutation must target the exact UI-created design')
    expected = copy.deepcopy(baseline)
    if action == 'edit':
        edited = next(row for row in expected['formations']['entries'] if row['id'] == design['id'])
        edited['ships']['light_fighter'] = 5
        edited['revision'] += 1
    elif action == 'delete':
        expected['formations']['entries'] = [row for row in expected['formations']['entries'] if row['id'] != design['id']]
    else:
        raise AssertionError('Unknown native source mutation')
    return expected


def metadata(full=False):
    value = {'schema': 'infinity-rehearsal-formation-copy-native-v1', 'completed': completed,
             'result': 'passed' if completed else 'incomplete', 'case': case,
             'sourceSha': args.expected_sha, 'sourceTree': source_tree,
             'naturalReportSha256': fixture_sha256, 'originRawSha256': RAW_PIN,
             'sourceScriptHashes': script_hashes, 'fixtureIdentitySha256': fixture_identity['identitySha256'],
             'fullSourceBindingSha256': full_source_reference['sha256'], 'failure': failure,
             'checkCount': len(checks), 'evidenceCount': len(evidence), 'passed': passed_count, 'failed': failed_count,
             'timing': {'hostElapsedSeconds': time.monotonic() - HOST_STARTED_MONOTONIC,
                        'workerBoundSeconds': 600, 'supervisorBoundSeconds': 610},
             'classification': 'Natural paid31 main with actual UI-saved formation and paid scouts 11/13. Controlled functional clocks. Explicit synthetic upper limits and DOM attacks are isolated. No timing, paint or production-rate claim.',
             'acceptanceRule': 'All four independent jobs (verify, verify-continuation, npc-orbital, scout-rehearsal) and required-gates must pass for this exact source SHA. This additional native report cannot replace any existing gate.'}
    if full:
        value.update(checks=checks, evidence=evidence, sourceBindings=source_bindings,
                     errors=errors, failedRequests=failed_requests, fixtureIdentity=fixture_identity,
                     fullSourceBinding=full_source_reference)
    return value


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


def native_summary(page, selector):
    native_scroll_to(page, selector)
    page.locator(selector).evaluate("e=>e.addEventListener('click',event=>window.__formationSummary={trusted:event.isTrusted},{once:true})")
    page.locator(selector).click(); advance(page)
    check('native disclosure is opened by an actual trusted click', page.evaluate('window.__formationSummary.trusted') is True)


def formation_library(page):
    tab(page, 'fleet')
    if not page.locator('#fleet-formations').evaluate('(e)=>e.open'):
        native_summary(page, '#fleet-formations > summary')


def create_formation(page, name, ships):
    """The only natural state addition: actual UI save, independently predicted."""
    dense_counts(ships)
    before = save(page); formation_library(page)
    next_id = before['formations']['nextFormationId']
    trusted_click(page, '#formation-new')
    input_number(page, '#formation-name', name)
    for ship, count in ships.items(): input_number(page, f'[data-formation-unit="{ship}"]', count)
    disk_before = storage(page)
    persist_json(f'formation-{next_id}-save-before', {'storage': disk_before, 'state': before})
    trusted_click(page, '#formation-save')
    disk_after = storage(page)
    reference = persist_json(f'formation-{next_id}-save-after', {'beforeStorage': disk_before, 'afterStorage': disk_after})
    actual = json.loads(disk_after[KEY])['state']
    design = {'id': next_id, 'revision': 1, 'name': name, 'ships': copy.deepcopy(ships)}
    expected = copy.deepcopy(before)
    expected['formations']['entries'].append(design)
    expected['formations']['nextFormationId'] += 1
    whole_state('UI formation save changes exactly its record and ID, no economy/RNG/orders/fleet changes', actual, expected)
    check('HTML-like saved name is literal text, never inserted markup',
          name in page.locator('#formation-library').inner_text()
          and page.locator('#formation-library img, #formation-library script').count() == 0, reference)
    return design, expected


def rehearsal_values(page):
    return {ship: page.locator(PREFIX + 'ship-' + ship).input_value() for ship in SHIPS}


def choose_formation(page, design):
    before = rehearsal_values(page); speed = page.locator(PREFIX + 'speed').input_value()
    draft = draft_values(page); disk = storage(page)
    persist_json(f'{len(checks):05d}-selection-before', {'values': before, 'speed': speed, 'draft': draft, 'storage': disk})
    label = f'#{design["id"]} {design["name"]} · r{design["revision"]}'
    options = page.locator(PREFIX + 'formation').evaluate('(e)=>[...e.options].map(o=>({value:o.value,text:o.textContent}))')
    matches = [option for option in options if option['text'] == label]
    check('saved design resolves by unique actual ID/revision/name native option', len(matches) == 1, options)
    select(page, PREFIX + 'formation', matches[0]['value'])
    reference = persist_json(f'{len(checks):05d}-selection-after', {'values': rehearsal_values(page),
        'speed': page.locator(PREFIX + 'speed').input_value(), 'draft': draft_values(page), 'storage': storage(page)})
    check('selection alone leaves complete dense13 numbers speed and actual draft untouched',
          rehearsal_values(page) == before and page.locator(PREFIX + 'speed').input_value() == speed
          and draft_values(page) == draft, reference)
    check('new or repeated explicit selection retires old examples and Fill',
          page.locator(PREFIX + 'results .npc-battle-report').count() == 0
          and page.locator(PREFIX + 'fill').is_disabled(), reference)
    storage_check('choosing source has no storage/RNG/payment/ID/order effect', page, disk)
    expect(page.locator(PREFIX + 'copy')).to_be_enabled()


def copy_formation(page, design):
    before = storage(page); draft = draft_values(page)
    speed = page.locator(PREFIX + 'speed').input_value()
    history = [page.locator(PREFIX + name).inner_text() for name in ('source', 'origin')]
    persist_json(f'{len(checks):05d}-copy-before', {'storage': before, 'draft': draft,
                 'values': rehearsal_values(page), 'speed': speed, 'history': history})
    trusted_click(page, PREFIX + 'copy')
    reference = persist_json(f'{len(checks):05d}-copy-after', {'storage': storage(page),
        'draft': draft_values(page), 'values': rehearsal_values(page), 'source': page.locator(PREFIX + 'formation-source').inner_text()})
    check('explicit copy atomically replaces all13 with exact targets and missing ships zero',
          rehearsal_values(page) == dense_counts(design['ships']), reference)
    check('copy preserves speed, retained report, current planet label and ordinary flight draft',
          page.locator(PREFIX + 'speed').input_value() == speed
          and [page.locator(PREFIX + name).inner_text() for name in ('source', 'origin')] == history
          and draft_values(page) == draft, reference)
    check('copied source is labeled with exact saved identity and revision',
          page.locator(PREFIX + 'formation-source').inner_text() == f'来自 #{design["id"]} {design["name"]} · r{design["revision"]}')
    check('one-shot copy consumes choice and does not run or preserve an earlier Fill',
          page.locator(PREFIX + 'formation').input_value() == '' and page.locator(PREFIX + 'copy').is_disabled()
          and page.locator(PREFIX + 'results .npc-battle-report').count() == 0 and page.locator(PREFIX + 'fill').is_disabled())
    storage_check('quantity copy preserves every storage key and exact raw before separate payment', page, before)



def native_input_proof(page, ship, expected_value, label):
    """Native input.value has no DOM text node. Prove geometry and exact value,
    plus the corresponding real label glyphs; do not claim Range value painting.
    """
    selector = PREFIX + 'ship-' + ship
    label_selector = f'label.space-ship:has({selector}) > span'
    native_scroll_to(page, selector)
    proof = visibility(page, [selector])
    actual = page.locator(selector).evaluate("""e=>({tag:e.tagName,type:e.type,value:e.value,min:e.min,max:e.max,step:e.step,
      connected:e.isConnected,unique:document.querySelectorAll('#'+e.id).length===1,
      current:e===document.getElementById(e.id),disabled:e.disabled})""")
    check(label + ': unique current numeric input retains exact copied value and bounds', actual == {
        'tag': 'INPUT', 'type': 'number', 'value': expected_value, 'min': '0', 'max': str(MAX_MANUAL_QUANTITY),
        'step': '1', 'connected': True, 'unique': True, 'current': True, 'disabled': False}, actual)
    check(label + ': complete native input has five unobstructed hit points',
          len(proof['targets']) == 1 and all(row['visible'] and row['contained'] and len(row['points']) == 5
          and all(point['unoccluded'] for point in row['points']) for row in proof['targets']), proof)
    # Readable label is real DOM text. Prepare its own geometry independently,
    # without pretending the form control's painted value is a DOM Range.
    native_scroll_to(page, label_selector)
    glyphs = text_leaf_visibility(page, [label_selector])
    check(label + ': corresponding actual ship and stock label glyphs fit all clips',
          len(glyphs['leaves']) == 1 and glyphs['leaves'][0]['passed'] is True, glyphs)
    evidence.append({'kind': 'native-input-boundary', 'case': case, 'selector': selector, 'actual': actual,
        'boundary': 'Actual native input identity/type/value and five-point geometry; separate DOM text glyph proof covers only its ship/stock label, not native value painting.'})
    check(label + ': no horizontal page overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))


def native_select_proof(page, label):
    selector = PREFIX + 'formation'; native_scroll_to(page, selector)
    proof = visibility(page, [selector])
    selected = page.locator(selector).evaluate('''e=>({value:e.value,disabled:e.disabled,
      selected:[...e.selectedOptions].map(o=>({value:o.value,text:o.textContent})),
      options:[...e.options].map(o=>({value:o.value,text:o.textContent}))})''')
    check(label + ': native select has exactly five unobstructed hit points',
          len(proof['targets']) == 1 and all(row['visible'] and row['contained'] and len(row['points']) == 5
          and all(point['unoccluded'] for point in row['points']) for row in proof['targets']), proof)
    check(label + ': exactly one actual native selected option has an explicit visible label',
          len(selected['selected']) == 1 and selected['selected'][0]['value'] == selected['value']
          and bool(selected['selected'][0]['text']), selected)
    evidence.append({'kind': 'native-select-boundary', 'case': case, 'selected': selected,
        'boundary': 'Actual select geometry and semantic option labels; no DOM Range glyph claim for closed native option painting.'})
    check(label + ': no horizontal page overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    snap(page, label + '.png')


def inspect_natural_examples(page, width):
    """Exact original history and all three public samples, using existing oracle.
    Existing scout-rehearsal keeps its full round-cell/horizontal-scroll coverage.
    This additional runner measures the newly connected quantity path only.
    """
    native_summary(page, PREFIX + 'history > summary')
    state = next(row['expected'] for row in fixtures['milestones'] if row['name'] == 'scout11-returned')
    actual = {'source': page.locator(PREFIX + 'source').inner_text(),
              'origin': page.locator(PREFIX + 'origin').inner_text(),
              'history': page.locator(PREFIX + 'history-body > p').all_inner_texts(),
              'resultParagraphs': page.locator(PREFIX + 'results > p').all_inner_texts(),
              'summaries': page.locator(PREFIX + 'results > details.npc-battle-report > summary').all_inner_texts()}
    persist_json(f'{width}-original-history-and-examples', actual)
    assert_natural_presenter_copy(actual, fixtures['naturalExamples'], state)
    control_proof(page, PREFIX + 'history > summary', f'{width}-retained-history')
    for index, sample in enumerate(fixtures['naturalExamples']['expected'], 1):
        selector = PREFIX + f'results > details.npc-battle-report:nth-of-type({index})'
        control_proof(page, selector + ' > summary', f'{width}-explicit-public-example-{index}')
        native_summary(page, selector + ' > summary')
        battle = sample['battle']
        def count(value): return f'轻型战斗机 {value}' if value else '无'
        expected = [f'公开种子 {sample["seed"]}；npc-rehearsal-public-v1；战斗模型 squadron-v1。',
            f'我方永久损失：{count(6-battle["attackerAfter"].get("light_fighter",0))}；幸存：{count(battle["attackerAfter"].get("light_fighter",0))}。NPC 剩余：{count(battle["defenderAfter"].get("light_fighter",0))}。']
        body = page.locator(selector + ' > div > p').all_inner_texts()
        check('three public samples retain exact independent historical outcome text', body == expected, {'actual': body, 'expected': expected})
        for paragraph in (1, 2):
            control_proof(page, selector + f' > div > p:nth-of-type({paragraph})', f'{width}-sample-{index}-body-{paragraph}')
        native_summary(page, selector + ' > summary')


def natural_four_widths(page, design, expected):
    whole_state('saved named source baseline', save(page), expected); disk = storage(page)
    tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
    for ship in SHIPS: input_number(page, f'[data-ship="{ship}"]', 1)
    for resource in RESOURCE_NAMES: input_number(page, '#cargo-' + resource, 7)
    dirty = draft_values(page)
    for width in WIDTHS:
        begin_case(f'natural-named-formation-copy-{width}')
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        open_report(page)
        for ship in SHIPS: input_number(page, PREFIX + 'ship-' + ship, 1)
        select(page, PREFIX + 'speed', '70')
        choose_formation(page, design); native_select_proof(page, f'{width}-select-named-source')
        control_proof(page, PREFIX + 'copy', f'{width}-explicit-copy', capture=True)
        copy_formation(page, design)
        for ship in SHIPS: native_input_proof(page, ship, dense_counts(design['ships'])[ship], f'{width}-dense13-{ship}')
        control_proof(page, PREFIX + 'formation-source', f'{width}-exact-source-label', capture=True)
        check('ordinary draft stays fully dirty through source choice and complete copy', draft_values(page) == dirty)
        select(page, PREFIX + 'speed', '100')
        trusted_click(page, PREFIX + 'run')
        expect(page.locator(PREFIX + 'results > details.npc-battle-report')).to_have_count(3)
        expect(page.locator(PREFIX + 'fill')).to_be_enabled()
        old_results = page.locator(PREFIX + 'results > details.npc-battle-report').element_handles()
        try:
            choose_formation(page, design)
            check('source reselection removes every earlier original result node', all(row.evaluate('(e)=>!e.isConnected') for row in old_results))
        finally:
            for row in old_results: row.dispose()
        copy_formation(page, design)
        control_proof(page, PREFIX + 'run', f'{width}-explicit-run')
        trusted_click(page, PREFIX + 'run')
        expect(page.locator(PREFIX + 'results > details.npc-battle-report')).to_have_count(3)
        inspect_natural_examples(page, width)
        storage_check('choice copy and public examples preserve every raw byte', page, disk,
                      initial_tab='save', visible_tab='messages', condition=draft_values(page) == dirty)
        control_proof(page, PREFIX + 'fill', f'{width}-independent-fill')
        trusted_click(page, PREFIX + 'fill')
        filled = {'mission': 'attack', 'target': ['1', '56', '15'], 'speed': '100',
                  'ships': [[ship, dense_counts(design['ships'])[ship]] for ship in SHIPS], 'cargo': ['0', '0', '0']}
        reference = persist_json(f'{width}-ordinary-filled-unpaid-draft', {'expected': filled, 'actual': draft_values(page), 'storage': storage(page)})
        check('independent Fill atomically replaces complete ordinary attack draft', draft_values(page) == filled, reference)
        for _ in range(3): advance(page)
        expect(page.locator(PREFIX + 'draft-notice')).to_have_text('仅已填入，尚未派遣或付款。请核对最新航程报价，再单独点击付费出征。')
        storage_check('Fill remains unpaid and preserves exact storage after later production frames', page, disk,
                      initial_tab='save', visible_tab='fleet')
        whole_state(f'{width}-read-only-copy-run-fill-entire-game', save(page), expected)
        # Later iterations deliberately preserve the last independently filled draft.
        dirty = filled
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)
    open_report(page); choose_formation(page, design); copy_formation(page, design)
    trusted_click(page, PREFIX + 'run'); trusted_click(page, PREFIX + 'fill')
    storage_check('final explicit Fill stays unpaid for next separate tape dispatch', page, disk)


def replay_natural_formation_route(page):
    rows = {row['name']: row for row in fixtures['milestones']}
    captures = {}; formations = None
    for index, operation in enumerate(fixtures['tape']):
        kind = operation['kind']
        if kind == 'advance': advance(page, int(operation['seconds'] * 1000))
        elif kind == 'checkpoint':
            row = rows[operation['name']]; actual = save(page)
            captures[operation['name']] = raw(page)
            persist_json('natural-browser-' + operation['name'], {'raw': captures[operation['name']], 'storage': storage(page)})
            whole_state(operation['name'], actual, with_formations(row['expected'], formations))
            if row['reload']:
                previous = raw(page); reload_bound(page)
                reference = persist_json('natural-reload-' + operation['name'], {'beforeRaw': previous, 'afterRaw': raw(page), 'storage': storage(page)})
                check('native partial/paid/return reload preserves exact original bytes', raw(page) == previous, reference)
                whole_state(operation['name'] + '-reload', save(page), with_formations(row['expected'], formations))
        elif kind == 'rehearsal':
            original = rows['scout11-returned']['expected']['formations']
            reference = persist_json('original-retained-formation-library', {
                'actual': original, 'expected': original_natural_formations(), 'newDesignAlreadyAdded': formations is not None})
            check('original natural history retains the exact prior paid31 formation before any new design',
                  formations is None and original == original_natural_formations(), reference)
            design, expected = create_formation(page, NATURAL_FORMATION_NAME, {'light_fighter': 6})
            created_actual = json.loads(raw(page))['state']
            reference = persist_json('natural-ui-formation-issued-id', {
                'original': original, 'actual': created_actual['formations'],
                'expected': expected['formations'], 'newDesign': design})
            check('real UI appends only fresh design #2 while retaining source formation #1',
                  natural_copy_design(created_actual) == design, reference)
            formations = copy.deepcopy(expected['formations'])
            natural_four_widths(page, design, expected)
        elif kind in ('scout', 'attack'):
            if kind == 'scout': configure_scout(page)
            else:
                tab(page, 'fleet')
                expected = {'mission': 'attack', 'target': ['1', '56', '15'], 'speed': '100',
                            'ships': [[ship, '6' if ship == 'light_fighter' else '0'] for ship in SHIPS], 'cargo': ['0', '0', '0']}
                check('actual attack reuses exactly the independently reviewed formation Fill', draft_values(page) == expected)
            disk_before = storage(page)
            persist_json('paid-before-' + str(operation['fleetId']), {'operation': operation, 'storage': disk_before})
            trusted_click(page, '#space-send')
            disk_after = storage(page)
            reference = persist_json('paid-after-' + str(operation['fleetId']), {'operation': operation,
                'beforeStorage': disk_before, 'afterStorage': disk_after})
            before, after = (json.loads(value[KEY])['state'] for value in (disk_before, disk_after))
            check('only separate real dispatch allocates the original one fresh paid fleet ID',
                  after['nextFleetId'] == before['nextFleetId'] + 1
                  and any(fleet['id'] == operation['fleetId'] for fleet in after['fleets']), reference)
            a, b = before['planets'][0], after['planets'][0]
            check('actual separate payment obeys exact five-term fuel equation',
                  Fraction(a['resources']['deuterium']) + Fraction(a['npcResourceRemainder']['deuterium']) - Fraction(operation['expectedFuel'])
                  == Fraction(b['resources']['deuterium']) + Fraction(b['npcResourceRemainder']['deuterium']), reference)
        else: raise AssertionError('Unknown original natural tape operation: ' + kind)
        evidence.append({'kind': 'natural-native-operation', 'index': index, 'operation': operation, 'status': 'executed'}); flush()
    final = json.loads(captures['scout13-returned'])['state']
    observed = [row['npcScoutSnapshot'] for row in final['messages'] if row['id'] in ('scout-11', 'scout-13')]
    check('same browser earns both exact retained reports after actual intervening paid battle',
          len(observed) == 2 and [row['fleetId'] for row in observed] == [11, 13]
          and all(row['target'] == fixtures['target'] for row in observed))
    return captures


def assert_deficits(page, design, state):
    origin = next(planet for planet in state['planets'] if planet['id'] == state['activePlanetId'])
    rows = expected_deficits(design['ships'], origin['units'])
    wanted = {row['unit']: row for row in rows if row['deficit'] > 0}
    if not page.locator(PREFIX + 'deficits').evaluate('(e)=>e.open'):
        native_summary(page, PREFIX + 'deficit-summary')
    actual = page.locator(PREFIX + 'deficit-body [data-rehearsal-deficit-unit]').evaluate_all(
        '(xs)=>xs.map(e=>({unit:e.dataset.rehearsalDeficitUnit,text:e.textContent}))')
    reference = persist_json(f'{len(checks):05d}-unclipped-deficits', {'actual': actual, 'expected': rows})
    check('deficit rows cover each actual shortage once and never count queued/inflight/other-planet stock',
          len(actual) == len(wanted) and {row['unit'] for row in actual} == set(wanted)
          and all(row['text'].endswith(f'：目标 {wanted[row["unit"]]["target"]} · 停泊 {wanted[row["unit"]]["landed"]} · 缺 {wanted[row["unit"]]["deficit"]}') for row in actual), reference)
    total = sum(row['deficit'] for row in rows)
    expect(page.locator(PREFIX + 'deficit-summary')).to_have_text(f'停泊缺额 {total} 艘 · 展开查看' if total else '停泊库存充足')
    return wanted


def insufficient_stock_boundaries(natural_raw):
    begin_case('natural-saved-1e6-targets-remain-unclipped-stock-shortage')
    context, page = boot(natural_raw)
    design, expected = create_formation(page, NATURAL_FORMATION_NAME, {ship: MAX_FORMATION_QUANTITY for ship in SHIPS})
    # Equal names are deliberately legal; actual option ID/revision still disambiguate.
    save(page); disk = storage(page); open_report(page); choose_formation(page, design); copy_formation(page, design)
    wanted = assert_deficits(page, design, expected)
    check('natural six-fighter inventory is genuinely insufficient for every saved target', len(wanted) == 13)
    for width in WIDTHS:
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        control_proof(page, PREFIX + 'deficit-summary', f'{width}-unclipped-deficit-summary', capture=True)
        for ship in SHIPS:
            control_proof(page, f'[data-rehearsal-deficit-unit="{ship}"]', f'{width}-unclipped-deficit-{ship}')
    trusted_click(page, PREFIX + 'run')
    check('insufficient landed inventory rejects Run without clipping targets or authorizing Fill',
          rehearsal_values(page) == dense_counts(design['ships']) and page.locator(PREFIX + 'results .npc-battle-report').count() == 0
          and page.locator(PREFIX + 'fill').is_disabled() and '当前停泊库存' in page.locator(PREFIX + 'status').inner_text())
    storage_check('stock-shortage selection copy and rejected Run change no stored byte', page, disk)
    whole_state('stock-shortage path changes no game field', save(page), expected)
    formation_library(page); trusted_click(page, '#formation-new')
    input_number(page, '#formation-name', '非法上限拒绝')
    input_number(page, '[data-formation-unit="light_fighter"]', MAX_FORMATION_QUANTITY + 1)
    before = storage(page)
    persist_json('formation-1e6-plus-one-before', {'storage': before, 'state': expected})
    trusted_click(page, '#formation-save')
    storage_check('saved-formation 1e6+1 remains invalid with no record or payment', page, before)
    whole_state('saved-formation bound remains 1e6 not rehearsal 1e12', save(page), expected)
    context.close()



def long_name_four_widths(natural_raw):
    begin_case('actual-native-64-codepoint-unbroken-source-name')
    context, page = boot(natural_raw)
    name = 'W' * 64
    design, expected = create_formation(page, name, {'light_fighter': 6})
    save(page); disk = storage(page)
    for width in WIDTHS:
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        open_report(page); choose_formation(page, design)
        native_select_proof(page, f'{width}-maximum-name-native-option')
        copy_formation(page, design)
        control_proof(page, PREFIX + 'formation-source', f'{width}-maximum-name-unbroken-source', capture=True)
        check('maximum legal unbroken name does not overflow the actual rehearsal panel',
              page.locator(PANEL).evaluate('e=>e.scrollWidth<=e.clientWidth'))
        storage_check('maximum legal name display and copy preserve exact storage', page, disk)
    whole_state('maximum source-name display changes no game field', save(page), expected)
    context.close()


def manual_limit_boundary():
    begin_case('EXPLICIT-SYNTHETIC-separate-manual-1e12-and-saved-1e6-contracts')
    branch = fixtures['branches']['performance']
    persist_json('explicit-manual-limit-input', {'classification': branch['classification'],
                 'syntheticChanges': branch['syntheticChanges'], 'raw': branch['raw']})
    context, page = boot(branch['raw'])
    expected = save(page); before = storage(page); open_report(page)
    for ship in SHIPS: input_number(page, PREFIX + 'ship-' + ship, MAX_MANUAL_QUANTITY)
    trusted_click(page, PREFIX + 'run')
    check('manual exact 1e12 each and 13e12 total still produce three bounded public samples',
          rehearsal_values(page) == {ship: str(MAX_MANUAL_QUANTITY) for ship in SHIPS}
          and page.locator(PREFIX + 'results > details.npc-battle-report').count() == 3)
    input_number(page, PREFIX + 'ship-light_fighter', MAX_MANUAL_QUANTITY + 1)
    trusted_click(page, PREFIX + 'run')
    check('manual 1e12+1 rejects instead of silently truncating',
          page.locator(PREFIX + 'ship-light_fighter').input_value() == str(MAX_MANUAL_QUANTITY + 1)
          and page.locator(PREFIX + 'results .npc-battle-report').count() == 0
          and page.locator(PREFIX + 'fill').is_disabled() and '1e12' in page.locator(PREFIX + 'status').inner_text())
    storage_check('explicit synthetic limit review has no economic/storage/RNG effects', page, before)
    whole_state('upper-bound complete game state unchanged', save(page), expected)
    context.close()


def retired_copy(page, original, label):
    """Native attempt only if genuinely visible/enabled; never force stale nodes."""
    before = rehearsal_values(page); draft = draft_values(page)
    # Read the retained node in one task, including after removal. Playwright's
    # is_enabled() throws on a detached handle; resolving its old ID instead
    # would silently replace the capability under test with a different node.
    control = original.evaluate('''e=>{const rect=e.getBoundingClientRect(),style=getComputedStyle(e);
      return {connected:e.isConnected,visible:style.visibility==='visible'&&rect.width>0&&rect.height>0,
        enabled:!e.matches(':disabled'),html:e.outerHTML,
        rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}};}''')
    connected, visible, enabled = (control[key] for key in ('connected', 'visible', 'enabled'))
    persist_json(f'{len(checks):05d}-retired-copy-before-{label}',
                 {'control': control, 'values': before, 'draft': draft, 'storage': storage(page)})
    clicks = page.evaluate('window.__npcClicks.length')
    action = 'native-unavailable'
    if connected and visible and enabled:
        # Native actionability remains authoritative; do not swallow a timeout
        # or skip an enabled clone merely because its source selection retired.
        original.click(timeout=2000); advance(page); action = 'actual-native-click'
    events = page.evaluate('(n)=>window.__npcClicks.slice(n)', clicks)
    reference = persist_json(f'{len(checks):05d}-retired-copy-{label}', {'action': action, 'control': control,
        'connected': connected, 'visible': visible,
        'enabled': enabled, 'events': events, 'beforeValues': before, 'afterValues': rehearsal_values(page),
        'beforeDraft': draft, 'afterDraft': draft_values(page), 'storage': storage(page)})
    check(label + ': retired control has no copy, Run or real-draft authority',
          rehearsal_values(page) == before and draft_values(page) == draft
          and page.locator(PREFIX + 'results .npc-battle-report').count() == 0
          and page.locator(PREFIX + 'fill').is_disabled()
          and (events == [] if action == 'native-unavailable' else len(events) == 1 and events[0]['trusted'] is True), reference)


def lifecycle_boundaries(natural_raw):
    baseline = json.loads(natural_raw)['state']; design = natural_copy_design(baseline)
    for kind in ('cancel', 'escape', 'tab-away', 'cancelled-import', 'same-world-import', 'corrupt-import',
                 'copy-hidden-aba', 'copy-style-aba', 'copy-aria-hidden-aba', 'select-hidden-aba',
                 'option-hidden-aba', 'option-style-aba', 'option-aria-hidden-aba', 'forged-option-value',
                 'same-node-detach', 'same-id-copy-replacement', 'same-id-input-replacement', 'option-clone'):
        begin_case('EXPLICIT-authority-boundary-' + kind)
        context, page = boot(natural_raw); whole_state(kind + '-baseline', save(page), baseline)
        open_report(page); choose_formation(page, design)
        before = storage(page); draft = draft_values(page); original = page.locator(PREFIX + 'copy').element_handle()
        try:
            if kind == 'cancel': trusted_click(page, PREFIX + 'cancel')
            elif kind == 'escape':
                page.locator(PREFIX + 'formation').focus(); page.locator(PREFIX + 'formation').press('Escape'); advance(page)
                check('native Escape focus returns to exact retained opener', page.locator(rehearsal_opener(page)).evaluate('(e)=>document.activeElement===e'))
            elif kind == 'tab-away': tab(page, 'fleet'); tab(page, 'messages')
            elif kind in ('cancelled-import', 'same-world-import'):
                import_file(page, natural_raw, kind == 'same-world-import', 'formation-' + kind); tab(page, 'messages')
            elif kind == 'corrupt-import':
                tab(page, 'save'); path = out / 'formation-corrupt-import.json'; path.write_text('{broken')
                page.locator('[data-bind="import-file"]').set_input_files(str(path))
                expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败'); tab(page, 'messages')
            elif kind.endswith('-aba'):
                part, attribute = kind.removesuffix('-aba').split('-', 1)
                selector = PREFIX + ('formation' if part in ('select', 'option') else 'copy')
                if part == 'option': selector += ' option:checked'
                page.locator(selector).evaluate('''(e,a)=>{const old=e.getAttribute(a);
                  e.setAttribute(a,a==='style'?'display:none':a==='aria-hidden'?'true':'');
                  if(old===null)e.removeAttribute(a);else e.setAttribute(a,old);}''', attribute); advance(page)
            elif kind == 'forged-option-value':
                page.locator(PREFIX + 'formation').evaluate("e=>e.selectedOptions[0].value='forged-source-id'"); advance(page)
            elif kind == 'option-clone':
                page.locator(PREFIX + 'formation').evaluate('e=>{const o=e.selectedOptions[0];o.replaceWith(o.cloneNode(true));}'); advance(page)
            else:
                selector = PREFIX + ('ship-light_fighter' if kind == 'same-id-input-replacement' else 'copy')
                page.locator(selector).evaluate('''(e,kind)=>{if(kind==='same-node-detach'){
                  const p=e.parentNode,n=e.nextSibling;e.remove();p.insertBefore(e,n);
                }else e.replaceWith(e.cloneNode(true));}''', kind); advance(page)
            retired_copy(page, original, kind)
            if kind == 'same-id-copy-replacement':
                replacement = page.locator(PREFIX + 'copy').element_handle()
                try:
                    identity = original.evaluate('''(e,replacement)=>({sameNode:e===replacement,
                      originalConnected:e.isConnected,replacementConnected:replacement.isConnected,
                      originalId:e.id,replacementId:replacement.id,
                      replacementIsCurrent:document.getElementById(e.id)===replacement,
                      sameIdCount:document.querySelectorAll('#npc-rehearsal-copy').length})''', replacement)
                    reference = persist_json('same-id-copy-replacement-exact-identity', identity)
                    check('same-ID copy replacement is distinct and connected while the exact original is detached',
                          identity['sameNode'] is False and identity['originalConnected'] is False
                          and identity['replacementConnected'] is True and identity['replacementIsCurrent'] is True
                          and identity['originalId'] == identity['replacementId'] == 'npc-rehearsal-copy'
                          and identity['sameIdCount'] == 1, reference)
                    retired_copy(page, replacement, 'forged same-ID replacement')
                finally: replacement.dispose()
        finally: original.dispose()
        if kind != 'same-world-import':
            storage_check(kind + ': no raw storage edit despite retired capability', page, before, condition=draft_values(page) == draft)
        else:
            persist_json('same-world-import-full-raw-boundary', {'before': before, 'after': storage(page), 'boundary': 'Explicit accepted import can create backups; world identity must still retire old selection.'})
        whole_state(kind + '-complete-live-state', save(page), baseline)
        context.close()


def untrusted_boundaries(natural_raw):
    begin_case('EXPLICIT-DOM-untrusted-copy-and-forged-selection')
    expected = json.loads(natural_raw)['state']; design = natural_copy_design(expected)
    context, page = boot(natural_raw); save(page); before = storage(page); open_report(page)
    values = rehearsal_values(page); draft = draft_values(page)
    selector = page.locator(PREFIX + 'formation')
    label = f'#{design["id"]} {design["name"]} · r{design["revision"]}'
    options = selector.evaluate('(e)=>[...e.options].map(o=>({value:o.value,text:o.textContent}))')
    matches = [option for option in options if option['text'] == label]
    reference = persist_json('untrusted-selection-exact-created-design', {'design': design, 'label': label, 'options': options})
    check('untrusted change targets the unique exact created source rather than option position', len(matches) == 1, reference)
    selector.evaluate("(e,value)=>{e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}", matches[0]['value'])
    page.locator(PREFIX + 'copy').evaluate('(e)=>e.click()'); advance(page)
    check('scripted change and untrusted click cannot authorize source copy',
          rehearsal_values(page) == values and draft_values(page) == draft and page.locator(PREFIX + 'copy').is_disabled())
    choose_formation(page, design)
    page.locator(PREFIX + 'copy').evaluate('(e)=>e.click()'); advance(page)
    check('untrusted click cannot consume a genuine trusted source selection', rehearsal_values(page) == values)
    copy_formation(page, design)
    input_number(page, PREFIX + 'ship-light_fighter', 5)
    expect(page.locator(PREFIX + 'formation-source')).to_have_text('数量已手改')
    page.locator(PREFIX + 'copy').evaluate('(e)=>e.click()'); advance(page)
    check('consumed copy cannot overwrite independently hand-edited numbers',
          page.locator(PREFIX + 'ship-light_fighter').input_value() == '5')
    storage_check('untrusted events and manual quantity edit preserve exact storage', page, before)
    whole_state('untrusted copy entire game state remains unchanged', save(page), expected)
    context.close()


def source_edit_delete_boundaries(natural_raw):
    baseline = json.loads(natural_raw)['state']; design = natural_copy_design(baseline)
    for action in ('edit', 'delete'):
        for stage in ('before-copy', 'after-independent-fill'):
            begin_case('actual-native-source-' + action + '-' + stage)
            context, page = boot(natural_raw); save(page); open_report(page); choose_formation(page, design)
            original = page.locator(PREFIX + 'copy').element_handle()
            try:
                if stage == 'after-independent-fill':
                    copy_formation(page, design); trusted_click(page, PREFIX + 'run'); trusted_click(page, PREFIX + 'fill')
                draft = draft_values(page)
                # Real library editing requires leaving the messages tab. The
                # normal lifecycle closes rehearsal; no hidden-control shortcut.
                formation_library(page)
                selector = f'#formation-library article[data-formation-id="{design["id"]}"] button[data-formation-action="{action}"]'
                trusted_click(page, selector)
                expected = natural_source_change_expected(baseline, design, action)
                if action == 'edit':
                    input_number(page, '[data-formation-unit="light_fighter"]', 5)
                    commit = '#formation-save'
                else:
                    commit = '#formation-confirm-delete'
                before = storage(page)
                persist_json(f'{action}-{stage}-before', {'storage': before, 'draft': draft})
                trusted_click(page, commit)
                reference = persist_json(f'{action}-{stage}-after', {'storage': storage(page), 'draft': draft_values(page)})
                check('actual source edit/delete does not rewrite independent ordinary draft', draft_values(page) == draft, reference)
                whole_state('source mutation changes exactly requested formation fields', json.loads(raw(page))['state'], expected)
                tab(page, 'messages'); retired_copy(page, original, action + '-' + stage)
                open_report(page)
                check('reopened history has fresh zero numbers and no inherited source permission',
                      rehearsal_values(page) == {ship: '0' for ship in SHIPS} and page.locator(PREFIX + 'copy').is_disabled())
                labels = page.locator(PREFIX + 'formation option').all_text_contents()
                old_label = f'#{design["id"]} {design["name"]} · r{design["revision"]}'
                check('old edited/deleted source revision no longer appears as selectable', old_label not in labels, labels)
                whole_state('source-boundary-complete-state', save(page), expected)
            finally: original.dispose()
            context.close()


def protection_boundary(natural_raw):
    begin_case('actual-cross-tab-protection-retires-formation-selection')
    expected = json.loads(natural_raw)['state']; design = natural_copy_design(expected)
    context, page = boot(natural_raw); save(page); open_report(page); choose_formation(page, design)
    before = storage(page); original = page.locator(PREFIX + 'copy').element_handle()
    other = context.new_page(); other.goto(args.url, wait_until='networkidle')
    competing = json.loads(natural_raw); competing['savedAt'] += 1
    competing_raw = json.dumps(competing, ensure_ascii=False)
    persist_json('cross-tab-protected-raw-before', {'before': before, 'competingRaw': competing_raw})
    other.evaluate('([key,value])=>localStorage.setItem(key,value)', [KEY, competing_raw])
    page.bring_to_front(); advance(page)
    events = page.evaluate('window.__npcStorage')
    check('native protection receives genuine trusted cross-tab storage event with exact bytes',
          any(row['trusted'] is True and row['oldValue'] == before[KEY] and row['newValue'] == competing_raw for row in events), events)
    try: retired_copy(page, original, 'cross-tab protection')
    finally: original.dispose()
    storage_check('protected copy keeps exact competing raw and all backups', page, before, {**before, KEY: competing_raw})
    other.close(); reload_bound(page)
    expect(page.locator(PANEL)).to_be_hidden(); open_report(page)
    check('recovery cannot revive a prior world source choice', page.locator(PREFIX + 'formation').input_value() == '' and page.locator(PREFIX + 'copy').is_disabled())
    choose_formation(page, design); copy_formation(page, design)
    whole_state('recovered fresh copy still changes no game field', save(page), expected)
    context.close()


def atomic_destination_boundary(natural_raw):
    begin_case('EXPLICIT-DOM-last-input-file-type-refuses-all13-before-any-write')
    expected = json.loads(natural_raw)['state']; design = natural_copy_design(expected)
    context, page = boot(natural_raw); save(page); disk = storage(page); open_report(page)
    for ship in SHIPS: input_number(page, PREFIX + 'ship-' + ship, 1)
    choose_formation(page, design)
    page.locator(PREFIX + 'ship-' + SHIPS[-1]).evaluate("e=>e.type='file'")
    before = rehearsal_values(page); draft = draft_values(page)
    persist_json('atomic-destination-before', {'storage': disk, 'values': before, 'draft': draft})
    original = page.locator(PREFIX + 'copy').element_handle()
    try: retired_copy(page, original, 'last-destination-file-type')
    finally: original.dispose()
    storage_check('malformed last destination cannot partially mutate any game/storage field', page, disk,
                  condition=rehearsal_values(page) == before and draft_values(page) == draft)
    whole_state('atomic-destination-rejection-complete-state', save(page), expected)
    context.close()


def source_identity(workspace, expected_sha, expected_version, runtime_node, natural_sha256):
    """Bind every tracked file and mode to Git, then verify full fixture identity.
    Nothing here runs Node. runtime_node is the CI job's separately observed
    node --version, also bound by the existing four-job aggregate.
    """
    workspace = Path(workspace)
    def git(*args): return subprocess.check_output(['git', '-C', str(workspace), *args])
    if (not re.fullmatch(r'[0-9a-f]{40}', expected_sha)
            or git('rev-parse', 'HEAD').decode().strip() != expected_sha
            or git('diff', 'HEAD', '--')):
        raise ValueError('Native acceptance requires exact clean committed source')
    dirty = git('status', '--porcelain=v1', '--untracked-files=all', '--', *SOURCE_AREAS,
                'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts')
    if dirty: raise ValueError('Dirty native acceptance source scope')
    for flag in ((), ('--ignored',)):
        if git('ls-files', '--others', *flag, '--exclude-standard', '--', *SOURCE_AREAS):
            raise ValueError('Untracked or ignored source-scope input is not accepted')
    files, modes = {}, {}
    for entry in git('ls-tree', '-r', '-z', expected_sha).split(b'\0'):
        if not entry: continue
        metadata, path_bytes = entry.split(b'\t', 1); mode, kind, blob = metadata.decode().split()
        relative = path_bytes.decode('utf-8'); path = workspace
        for part in Path(relative).parts:
            if part in ('..', '/') or path.is_symlink(): raise ValueError('Nonlocal or symlinked tracked source')
            path /= part
        if kind != 'blob' or mode not in ('100644', '100755') or path.is_symlink() or not path.is_file():
            raise ValueError('Tracked source must be an ordinary file: ' + relative)
        body = path.read_bytes()
        if (hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() != blob
                or bool(path.stat().st_mode & 0o111) != (mode == '100755')):
            raise ValueError('Tracked source bytes/mode differ from exact Git object: ' + relative)
        files[relative] = hashlib.sha256(body).hexdigest(); modes[relative] = mode
    summary = {'sourceSha': expected_sha, 'srcTree': git('rev-parse', 'HEAD:src').decode().strip(),
               'fullTree': git('rev-parse', 'HEAD^{tree}').decode().strip(), 'sourceCode': files, 'sourceModes': modes}
    package = json.loads((workspace / 'package.json').read_bytes())
    if expected_version != CANDIDATE_VERSION or package.get('version') != CANDIDATE_VERSION:
        raise ValueError('Explicit candidate version does not match this pinned committed successor')
    identity = scout_fixture_identity(workspace, summary, runtime_node)
    if identity['identity']['rawSha256']['natural'] != natural_sha256:
        raise ValueError('Native report input differs from complete fixture identity natural bytes')
    paths = ('scripts/browser-rehearsal-formation-copy.py', 'scripts/test_rehearsal_formation_copy_acceptance.py',
             'scripts/browser-scout-rehearsal.py', 'scripts/browser-npc-attack.py',
             'scripts/scout_fixture_identity.py', 'scripts/scout-rehearsal-natural-route.ts',
             'tests/fixtures/npc-scout-legacy.json', 'package-lock.json')
    return summary, identity, {path: files[path] for path in paths}


def main():
    global args, out, report_path, journal_path, progress_path, fixture_sha256, fixtures, KEY, ORIGIN
    global checks, errors, failed_requests, evidence, source_bindings, page_sources, release_metadata
    global completed, active_page, source_sha, failure, case, journal, last_progress_at, browser, CLOCK, FAULT, expect
    global passed_count, failed_count, recorded_checks, recorded_evidence, recorded_sources, recorded_errors, recorded_requests
    global source_tree, script_hashes, fixture_identity, full_source_reference
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--natural-report', required=True); parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA'))
    parser.add_argument('--expected-version', required=True); parser.add_argument('--runtime-node', required=True)
    parser.add_argument('--release'); parser.add_argument('--output', required=True); parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('Native formation-copy acceptance is CI-only; local browser execution is not authorized.')
    if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha): parser.error('Exact expected source SHA required')
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256): parser.error('Complete natural report SHA256 required')
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', args.runtime_node): parser.error('Actual CI node --version required')
    if args.expected_version != CANDIDATE_VERSION: parser.error('Exact formation-copy successor version ' + CANDIDATE_VERSION + ' required')
    out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    report_path = out / 'rehearsal-formation-copy-browser-report.json'
    journal_path = out / 'rehearsal-formation-copy-checks.jsonl'; progress_path = out / 'rehearsal-formation-copy-progress.json'
    load_reviewed_helpers()
    if not args.worker: supervise(); return
    from playwright.sync_api import sync_playwright, expect as native_expect
    expect = native_expect
    fixture_bytes = Path(args.natural_report).read_bytes(); fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
    if fixture_sha256 != args.expected_report_sha256: raise ValueError('Complete natural report hash mismatch')
    fixtures = json.loads(fixture_bytes)
    if not valid_natural_report(fixtures, args.expected_sha): raise ValueError('Natural provenance/completeness gate failed')
    fixtures['base'] = json.loads(fixtures['milestones'][0]['raw']); KEY = fixtures['key']
    source, fixture_identity, script_hashes = source_identity(ROOT, args.expected_sha, args.expected_version, args.runtime_node, fixture_sha256)
    source_tree = source['fullTree']
    full_source_path = out / 'formation-copy-full-source-binding.json'; atomic_json(full_source_path, source)
    full_source_reference = {'file': full_source_path.name, 'sha256': hashlib.sha256(full_source_path.read_bytes()).hexdigest(),
                             'fileCount': len(source['sourceCode']), 'excludedFields': []}
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'): raise ValueError('Actual production HTTP(S) required')
    ORIGIN = f'{parsed.scheme}://{parsed.netloc}'
    tree = ast.parse((ROOT / 'scripts/browser-npc-attack.py').read_text())
    for name in ('CLOCK', 'FAULT'):
        node = next(node for node in tree.body if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == name for target in node.targets))
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<unchanged-native-clock-and-explicit-fault>', 'exec'), globals())
    checks, errors, failed_requests, evidence, source_bindings = [], [], [], [], []
    page_sources, release_metadata = {}, None
    completed, active_page, source_sha, failure = False, None, None, None
    case = 'setup'; journal = NativeCheckJournal(journal_path); last_progress_at = 0
    passed_count = failed_count = recorded_checks = recorded_evidence = recorded_sources = recorded_errors = recorded_requests = 0
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('600-second formation-copy worker bound')))
    signal.alarm(600)
    try:
        with sync_playwright() as playwright, live_failure_evidence():
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            begin_case('natural-original-paid31-native-named-formation-route')
            context, page = boot(fixtures['origin']['raw'])
            check('served release has this explicit candidate version and unchanged v9/r14 schema',
                  release_metadata['version'] == args.expected_version and release_metadata['saveVersion'] == 9
                  and release_metadata['saveRevision'] == 14)
            captures = replay_natural_formation_route(page); context.close()
            natural_raw = captures['run-cancel-reopen-fill-still-unpaid']
            insufficient_stock_boundaries(natural_raw)
            long_name_four_widths(natural_raw)
            manual_limit_boundary()
            lifecycle_boundaries(natural_raw)
            untrusted_boundaries(natural_raw)
            atomic_destination_boundary(natural_raw)
            source_edit_delete_boundaries(natural_raw)
            protection_boundary(natural_raw)
            check('no application error or failed request', not errors and not failed_requests,
                  {'errors': errors, 'requests': failed_requests})
            completed = True; flush(full=True, final=True); browser.close()
    finally: signal.alarm(0)


if __name__ == '__main__': main()
