"""CI-only native acceptance for a read-only pair of retained scout observations.

Natural input is the exact public paid31 raw. Replay the unchanged economic tape
through native, trusted controls to produce scouts 11 and 13 in THIS browser.
The pre-existing engine report supplies checkpoint oracles, never UI observations.
Comparison expectations subtract Decimal values of numeric tokens in the browser's
own JSON.stringify raw, without assuming Python float repr equals Number.toString.
No model import, private game object, economic injection, intercepted response,
or screenshot caret mutation is permitted. Explicit synthetic boundaries are
separate contexts and never presented as natural paid-source evidence.
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
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
HOST_STARTED_MONOTONIC = time.monotonic()
WIDTHS = (320, 390, 768, 1440)
SOURCE_PIN = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52'
RAW_PIN = 'fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b'
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship',
         'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'colony_ship')
PREFIX = '#npc-scout-comparison-'
PANEL = PREFIX + 'panel'
RESOURCE_NAMES = ('metal', 'crystal', 'deuterium')
NUMERIC_FIELDS = ('stock.metal', 'stock.crystal', 'stock.deuterium',
                  'garrison.light_fighter', 'garrison.heavy_fighter',
                  'defenderTech.weapons', 'defenderTech.shields', 'defenderTech.armour')


def load_reviewed_helpers():
    """Compile only named public-evidence helpers, never the old runner or main.
    Shared observer/clock/geometry/source binding files stay byte-for-byte intact.
    All calls resolve this runner's check/flush/snap, so its journal is independent.
    """
    names = {'valid_natural_report', 'load_shared_helpers', 'advance', 'tab', 'raw', 'storage',
             'storage_check', 'capture_live_failure', 'live_failure_evidence', 'boot',
             'configure_scout', 'import_file', 'draft_values', 'dispose_capture_handles'}
    tree = ast.parse((ROOT / 'scripts/browser-scout-rehearsal.py').read_text())
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    if {node.name for node in nodes} != names:
        raise RuntimeError('Reviewed scout helper contract changed')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed-scout-comparison-helpers>', 'exec'), globals())
    load_shared_helpers()


def decimal_text(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Only finite JSON numbers are comparison input')
    return Decimal(str(value))


def independent_pair(state, anchor_id='scout-11', other_id='scout-13', *, lexical_state=None):
    """Read retained browser messages; no production comparison code or oracle.
    Native callers supply lexical_state parsed from the SAME browser raw with
    parse_float=Decimal. Float-only calls are offline arithmetic tests, not a
    claim that Python repr and JavaScript Number.toString always agree.
    """
    messages = state['messages']
    left = [row for row in messages if row['id'] == anchor_id]
    right = [row for row in messages if row['id'] == other_id]
    if len(left) != 1 or len(right) != 1 or anchor_id == other_id:
        raise ValueError('Two distinct retained messages required')
    a, b = (copy.deepcopy(row[0]['npcScoutSnapshot']) for row in (left, right))
    for value in (a, b):
        if not isinstance(value, dict) or value.get('model') != 'npc-scout-snapshot-v1':
            raise ValueError('V1 retained snapshot required')
    if a['target'] != b['target']:
        raise ValueError('Same target required')
    # Retained message array order is the declared before/after meaning.
    # Neither lossy numeric list time nor canonical observation time is a sort key.
    if messages.index(left[0]) < messages.index(right[0]):
        before, after, ids = a, b, (anchor_id, other_id)
    else:
        before, after, ids = b, a, (other_id, anchor_id)
    def fields(value, message_id):
        if lexical_state is None:
            stock = [decimal_text(number) for number in value['stock']]
        else:
            matched = [row for row in lexical_state['messages'] if row['id'] == message_id]
            if len(matched) != 1: raise ValueError('Exact lexical observation required')
            raw_stock = matched[0]['npcScoutSnapshot']['stock']
            if len(raw_stock) != 3 or any(type(number) not in (int, Decimal) for number in raw_stock):
                raise ValueError('Stock must retain exact JSON numeric tokens')
            stock = [Decimal(number) for number in raw_stock]
            if any(not number.is_finite() for number in stock): raise ValueError('Finite lexical stock required')
        return {**{'stock.' + key: stock[index] for index, key in enumerate(RESOURCE_NAMES)},
                **{group + '.' + key: decimal_text(number) for group in ('garrison', 'defenderTech')
                   for key, number in value[group].items()}}
    older, newer = fields(before, ids[0]), fields(after, ids[1])
    if set(older) != set(NUMERIC_FIELDS) or set(newer) != set(NUMERIC_FIELDS):
        raise ValueError('Complete V1 numeric fields required')
    with localcontext() as context:
        context.prec = 400
        delta = {key: str(newer[key] - older[key]) for key in NUMERIC_FIELDS}
        elapsed = str(Decimal(after['observedAt']) - Decimal(before['observedAt']))
    return {'beforeId': ids[0], 'afterId': ids[1], 'before': before, 'after': after,
            'values': {'before': {key: str(value) for key, value in older.items()},
                       'after': {key: str(value) for key, value in newer.items()}, 'delta': delta},
            'elapsed': elapsed}


def independent_pair_from_raw(raw_text, anchor_id='scout-11', other_id='scout-13'):
    # The actual browser save is JSON.stringify output: its finite numeric tokens
    # are the authoritative displayed Number decimal representation. Preserve
    # those tokens for subtraction, while retaining ordinary JSON originals for
    # complete state witnesses. No JS evaluation or production model is invoked.
    ordinary = json.loads(raw_text)['state']
    lexical = json.loads(raw_text, parse_float=Decimal)['state']
    return independent_pair(ordinary, anchor_id, other_id, lexical_state=lexical)


def synthetic_eviction(raw_text, evict_id):
    """Explicit FIFO-only fixture from an ACTUAL browser arrival checkpoint.
    Keep both genuine snapshots unchanged; no resources, technology, fleet,
    timers, random stream, or target wallet changes. Existing paid return evicts.
    """
    value = json.loads(raw_text)
    state = value['state']
    pair = {row['id']: row for row in state['messages'] if row['id'] in ('scout-11', 'scout-13')}
    if set(pair) != {'scout-11', 'scout-13'} or evict_id not in pair:
        raise ValueError('Two real browser snapshot messages required')
    remaining = next(row for row in state['fleets'] if row['id'] == 13 and row['returning'] is True)['remaining']
    if not (0 < remaining <= 120):
        raise ValueError('A bounded actual already-paid return is required')
    state['messages'] = [pair[evict_id], pair['scout-13' if evict_id == 'scout-11' else 'scout-11'],
                         *[{'id': f'comparison-filler-{index}', 'at': 0,
                            'text': 'Explicit synthetic FIFO-only filler', 'npcScoutSnapshot': None}
                           for index in range(148)]]
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')), math.ceil(remaining)


def metadata(full=False):
    value = {'schema': 'infinity-scout-comparison-native-v1', 'completed': completed,
             'result': 'passed' if completed else 'incomplete', 'case': case,
             'sourceSha': args.expected_sha, 'sourceTree': source_tree,
             'naturalReportSha256': fixture_sha256, 'originRawSha256': RAW_PIN,
             'sourceScriptHashes': script_hashes, 'failure': failure,
             'checkCount': len(checks), 'evidenceCount': len(evidence),
             'passed': passed_count, 'failed': failed_count,
             'hostElapsedSeconds': time.monotonic() - HOST_STARTED_MONOTONIC,
             'classification': 'Actual native paid scouts 11 and 13 replay unchanged economic tape from public paid31. Controlled functional clocks. Existing read-only rehearsal omitted; ordinary native attack draft carries the identical request. Explicit synthetic lifecycle boundaries are separate. No timing, paint or production-rate claim.',
             'acceptanceRule': 'This report is additional evidence only; existing required CI jobs and aggregate must pass on the same exact source SHA.'}
    if full:
        value.update(checks=checks, evidence=evidence, sourceBindings=source_bindings,
                     errors=errors, failedRequests=failed_requests)
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


def comparison_entry(ident='scout-11'):
    return f'article.space-message[data-message-id="{ident}"] button[data-npc-scout-comparison]'


def open_comparison(page, anchor='scout-11'):
    tab(page, 'messages'); trusted_click(page, comparison_entry(anchor))
    expect(page.locator(PANEL)).to_be_visible()
    check('fresh anchor requires explicitly choosing another retained observation',
          page.locator(PREFIX + 'other').input_value() == ''
          and page.locator(PREFIX + 'results').inner_text() == ''
          and page.locator(PREFIX + 'run').is_disabled())


def choose_other(page, other='scout-13'):
    fleet_id = other.removeprefix('scout-')
    options = page.locator(PREFIX + 'other').evaluate('(e)=>[...e.options].map(o=>({value:o.value,text:o.textContent}))')
    matches = [row for row in options if row['text'].startswith(f'舰队 #{fleet_id} · ')]
    check('explicit other snapshot is one unique visible native option', len(matches) == 1, options)
    select(page, PREFIX + 'other', matches[0]['value'])
    check('choosing another snapshot alone does not compute a result', page.locator(PREFIX + 'results').inner_text() == '')
    expect(page.locator(PREFIX + 'run')).to_be_enabled()


def run_comparison(page, other='scout-13'):
    choose_other(page, other)
    trusted_click(page, PREFIX + 'run')
    expect(page.locator(PREFIX + 'summary')).to_be_visible()


def configure_paid_request(page, operation):
    """Exact tape request, ordinary fleet controls; never a comparison Fill."""
    if operation['kind'] == 'scout':
        configure_scout(page)
    else:
        tab(page, 'fleet'); select(page, '#flight-mission', 'attack')
        for key, value in operation['target'].items(): input_number(page, '#flight-' + key, value)
        for ship in SHIPS:
            value = str(operation['count']) if ship == 'light_fighter' else '0'
            if page.locator(f'[data-ship="{ship}"]').input_value() != value:
                input_number(page, f'[data-ship="{ship}"]', value)
    select(page, '#flight-speed', '100')
    for resource in RESOURCE_NAMES:
        if page.locator('#cargo-' + resource).input_value() != '0': input_number(page, '#cargo-' + resource, 0)
    expected = {'mission': operation['kind'], 'target': [str(operation['target'][key]) for key in ('galaxy', 'system', 'position')],
                'speed': '100', 'ships': [[ship, str(operation['count']) if ship == 'light_fighter' and operation['kind'] == 'attack'
                                         else '1' if ship == 'espionage_probe' and operation['kind'] == 'scout' else '0'] for ship in SHIPS],
                'cargo': ['0', '0', '0']}
    check('native economic request equals complete original tape input', draft_values(page) == expected,
          {'actual': draft_values(page), 'expected': expected})


def replay_natural_pair(page):
    rows = {row['name']: row for row in fixtures['milestones']}
    captures = {}; executed = []
    for index, operation in enumerate(fixtures['tape']):
        kind = operation['kind']; executed.append({'index': index, 'operation': operation, 'status': 'started'})
        if kind == 'advance':
            advance(page, int(operation['seconds'] * 1000))
        elif kind == 'checkpoint':
            row = rows[operation['name']]
            actual_state = save(page)
            captures[operation['name']] = raw(page)
            persist_json('natural-browser-' + operation['name'], {'raw': captures[operation['name']],
                         'storage': storage(page),
                         'rawSha256': hashlib.sha256(captures[operation['name']].encode()).hexdigest()})
            whole_state(operation['name'], actual_state, row['expected'])
            if row['reload']:
                prior = raw(page); reload_bound(page)
                reloaded_storage = storage(page)
                reload_reference = persist_json('natural-browser-' + operation['name'] + '-reload',
                                                {'priorRaw': prior, 'actualRaw': reloaded_storage[KEY], 'storage': reloaded_storage})
                check('native partial scout reload retains exact raw', reloaded_storage[KEY] == prior, reload_reference)
                whole_state(operation['name'] + '-native-reload', save(page), row['expected'])
        elif kind == 'rehearsal':
            executed[-1]['classification'] = 'Omitted existing read-only rehearsal; no game-state effect. Next economic action uses explicit ordinary native draft with identical tape request.'
        elif kind in ('scout', 'attack'):
            configure_paid_request(page, operation)
            before_storage = storage(page)
            persist_json('native-paid-before-' + str(operation['fleetId']), {'operation': operation, 'storage': before_storage})
            before = json.loads(before_storage[KEY])['state']
            expect(page.locator('#space-send')).to_be_visible(); expect(page.locator('#space-send')).to_be_enabled()
            trusted_click(page, '#space-send')
            after_storage = storage(page)
            reference = persist_json('native-paid-' + str(operation['fleetId']), {'operation': operation,
                                     'beforeStorage': before_storage, 'afterStorage': after_storage})
            after = json.loads(after_storage[KEY])['state']
            check('separate actual trusted dispatch allocates exactly its one original fleet ID',
                  after['nextFleetId'] == before['nextFleetId'] + 1
                  and any(fleet['id'] == operation['fleetId'] for fleet in after['fleets']), reference)
            a, b = before['planets'][0], after['planets'][0]
            check('each real scout and attack pays the exact five-term fuel equation',
                  Fraction(a['resources']['deuterium']) + Fraction(a['npcResourceRemainder']['deuterium']) - Fraction(operation['expectedFuel'])
                  == Fraction(b['resources']['deuterium']) + Fraction(b['npcResourceRemainder']['deuterium']), reference)
        else:
            raise AssertionError('Unknown economic tape operation: ' + kind)
        executed[-1]['status'] = 'omitted-readonly' if kind == 'rehearsal' else 'executed'
        evidence.append({'kind': 'natural-native-operation', **executed[-1]}); flush()
    pair = independent_pair_from_raw(captures['scout13-returned'])
    persist_json('natural-browser-genuine-pair', {'pair': pair, 'originRawSha256': RAW_PIN,
                 'classification': 'Two snapshots read from the same browser after two actual paid scouts; no model oracle or injected snapshot.'})
    check('same browser naturally retained distinct observations after actual intervening battle',
          pair['before']['fleetId'] == 11 and pair['after']['fleetId'] == 13
          and pair['before']['target'] == fixtures['target'] == pair['after']['target']
          and Decimal(pair['elapsed']) > 0 and any(Decimal(value) != 0 for value in pair['values']['delta'].values()))
    return captures, pair


CAPTURE_REFERENCES = '''()=>{const panel=document.querySelector('#npc-scout-comparison-panel');
const nodes=panel?[panel,...panel.querySelectorAll('*')]:[];const ancestors=[];
for(let n=panel?.parentElement;n;n=n.parentElement)ancestors.push(n);return{panel,nodes,ancestors};}'''
CAPTURE_STATE = '''refs=>{const panel=document.querySelector('#npc-scout-comparison-panel');
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
    witness = {'schema': 'infinity-scout-comparison-screenshot-v1', 'caret': 'initial', 'case': case}
    try:
        witness['before'] = refs.evaluate(CAPTURE_STATE); atomic_json(witness_path, witness)
        try:
            witness['status'] = 'started'; atomic_json(witness_path, witness)
            page.screenshot(path=str(path), full_page=False, timeout=7000, caret='initial')
            witness['status'] = 'captured'
            witness['screenshotSha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            evidence.append({'kind': 'screenshot', 'case': case, 'file': name, 'sha256': witness['screenshotSha256']})
        except BaseException:
            witness['status'] = 'failed'; witness['error'] = traceback.format_exc()
            raise
        finally:
            try: witness['after'] = refs.evaluate(CAPTURE_STATE)
            except BaseException: witness['afterReadError'] = traceback.format_exc()
            atomic_json(witness_path, witness)
            reference = {'kind': 'screenshot-state-witness', 'file': witness_path.name,
                         'sha256': hashlib.sha256(witness_path.read_bytes()).hexdigest()}
            evidence.append(reference); flush()
        check('caret=initial screenshot preserves exact panel nodes values styles and results',
              witness['before'] == witness['after'] and all(witness['after'][key] is True
              for key in ('samePanel', 'sameNodes', 'sameAncestors', 'allConnected')), reference)
    finally:
        dispose_capture_handles(refs)


def control_proof(page, selector, label, capture=False):
    native_scroll_to(page, selector)
    proof = visibility(page, [selector]); glyphs = text_leaf_visibility(page, [selector])
    check(label + ': complete target has five genuine unobstructed native hit points',
          len(proof['targets']) == 1 and all(row['visible'] and row['contained'] and len(row['points']) == 5
          and all(point['unoccluded'] for point in row['points']) for row in proof['targets']), proof)
    check(label + ': all actual glyphs fit viewport and ancestor clips', all(row['passed'] for row in glyphs['leaves']), glyphs)
    check(label + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    if capture: snap(page, label + '.png')


def native_select_proof(page, label):
    selector = PREFIX + 'other'
    native_scroll_to(page, selector)
    proof = visibility(page, [selector])
    selected = page.locator(selector).evaluate('''e=>({value:e.value,disabled:e.disabled,
      selected:[...e.selectedOptions].map(o=>({value:o.value,text:o.textContent})),
      options:[...e.options].map(o=>({value:o.value,text:o.textContent}))})''')
    check(label + ': complete native select has five unobstructed hit points',
          len(proof['targets']) == 1 and all(row['visible'] and row['contained'] and len(row['points']) == 5
          and all(point['unoccluded'] for point in row['points']) for row in proof['targets']), proof)
    check(label + ': native selected option has one explicit value and label',
          len(selected['selected']) == 1 and selected['selected'][0]['value'] == selected['value']
          and bool(selected['selected'][0]['text']), selected)
    evidence.append({'kind': 'native-select-boundary', 'case': case, 'selected': selected,
        'boundary': 'Actual select hit geometry, semantic option labels and screenshot only. Closed native option painting has no DOM Range glyph claim. Trusted keyboard change is checked separately by select().'})
    check(label + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    snap(page, label + '.png')


def reveal_exact(page):
    selector = PREFIX + 'exact > summary'
    control_proof(page, selector, 'exact-details-toggle')
    summary = page.locator(selector)
    # <summary> is native trusted input, not a button; retain its own trusted witness.
    summary.evaluate("e=>e.addEventListener('click',event=>window.__comparisonSummaryClick={trusted:event.isTrusted}, {once:true})")
    summary.click(); advance(page)
    check('exact original-value disclosure opens through actual trusted summary click',
          page.locator(PREFIX + 'exact').evaluate('(e)=>e.open')
          and page.evaluate('window.__comparisonSummaryClick.trusted') is True)


def observe_comparison(page):
    return page.evaluate('''()=>({summary:document.querySelector('#npc-scout-comparison-summary')?.textContent,
      source:document.querySelector('#npc-scout-comparison-source')?.textContent,
      warning:document.querySelector('#npc-scout-comparison-warning')?.textContent,
      exact:document.querySelector('#npc-scout-comparison-exact-body')?.textContent,
      fields:[...document.querySelectorAll('#npc-scout-comparison-exact-body [data-comparison-field]')]
        .map(e=>({field:e.dataset.comparisonField,side:e.dataset.comparisonSide,text:e.textContent}))})''')


def assert_comparison(page, pair):
    actual = observe_comparison(page)
    reference = persist_json(f'{len(checks):05d}-comparison-original-values', {'actual': actual, 'expected': pair})
    rows = {(row['side'], row['field']): row['text'] for row in actual['fields']}
    check('every exact original-value field has one unique public DOM leaf', len(rows) == len(actual['fields']), reference)
    for side in ('before', 'after', 'delta'):
        for field in NUMERIC_FIELDS:
            text = rows.get((side, field))
            try: correct = text is not None and Decimal(text) == Decimal(pair['values'][side][field])
            except Exception: correct = False
            check(f'{side} {field}: exact original or independent decimal-string difference', correct,
                  {'reference': reference, 'actual': text, 'expected': pair['values'][side][field]})
    for side in ('before', 'after'):
        value = pair[side]
        expected = {'model': value['model'], 'fleetId': str(value['fleetId']), 'originId': value['originId'],
                    'target': ':'.join(str(value['target'][key]) for key in ('galaxy', 'system', 'position')),
                    'observedAt': value['observedAt'], 'messageId': pair[side + 'Id']}
        for field, text in expected.items():
            check(f'{side} {field}: exact historical identity and canonical time', rows.get((side, field)) == text, reference)
    check('visible concise summary clearly limits meaning of historical differences',
          isinstance(actual['warning'], str) and all(text in actual['warning'] for text in ('净产量', '战利品', '当前库存')), reference)
    check('comparison exposes no draft-fill or dispatch control', page.locator(PANEL + ' [data-ship], ' + PANEL + ' #space-send, ' + PANEL + ' #npc-rehearsal-fill').count() == 0)


def natural_four_widths(page, pair):
    before = save(page); disk = storage(page)
    # Deliberately dirty every ordinary draft field; comparison must not touch it.
    tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
    for ship in SHIPS: input_number(page, f'[data-ship="{ship}"]', 1)
    for resource in RESOURCE_NAMES: input_number(page, '#cargo-' + resource, 7)
    dirty = draft_values(page)
    for width in WIDTHS:
        begin_case(f'natural-same-browser-readonly-comparison-{width}')
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        open_comparison(page)
        native_select_proof(page, f'{width}-choose-other')
        run_comparison(page)
        storage_check('selection and run preserve every raw byte including saved space-subtab preference', page, disk,
                      initial_tab='save', visible_tab='messages', condition=draft_values(page) == dirty)
        control_proof(page, PREFIX + 'summary', f'{width}-historical-summary', capture=True)
        control_proof(page, PREFIX + 'warning', f'{width}-meaning-warning', capture=True)
        check('exact values are collapsed and lazily absent before explicit disclosure',
              not page.locator(PREFIX + 'exact').evaluate('(e)=>e.open')
              and page.locator(PREFIX + 'exact-body').inner_text() == '')
        reveal_exact(page); assert_comparison(page, pair)
        control_proof(page, PREFIX + 'source', f'{width}-canonical-anchor', capture=True)
        for side in ('before', 'after', 'delta'):
            fields = NUMERIC_FIELDS if side == 'delta' else (*NUMERIC_FIELDS, 'model', 'messageId', 'fleetId', 'originId', 'target', 'observedAt')
            for field in fields:
                selector = PREFIX + f'exact-body [data-comparison-side="{side}"][data-comparison-field="{field}"]'
                control_proof(page, selector, f'{width}-{side}-{field.replace(".", "-")}')
            control_proof(page, PREFIX + f'exact-body [data-comparison-side="{side}"][data-comparison-field="stock.metal"]',
                          f'{width}-{side}-exact-values', capture=True)
        control_proof(page, PREFIX + 'cancel', f'{width}-cancel', capture=True)
        trusted_click(page, PREFIX + 'cancel')
        expect(page.locator(PANEL)).to_be_hidden()
        storage_check('closing comparison preserves every raw string and all ordinary draft fields', page, disk,
                      initial_tab='save', visible_tab='messages', condition=draft_values(page) == dirty)
        whole_state(f'{width}-readonly-comparison', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)


def retired_result(page, refs, label):
    """Never force a hidden/disabled negative target. Click only real availability.
    Persist raw before/after prior to asserting whether old result remains retired.
    """
    before = storage(page)
    persist_json(f'{len(checks):05d}-{label}-retired-before', {'before': before})
    locator = page.locator(PREFIX + 'run')
    visible, enabled = locator.is_visible(), locator.is_enabled()
    start = page.evaluate('window.__npcClicks.length')
    if visible and enabled:
        action = 'trusted-click'; trusted_click(page, PREFIX + 'run')
    else:
        action = 'native-unavailable'
        # The complete pre/post raw witness is persisted before refusal assertions.
        pass
    state = refs.evaluate('''old=>({allOldDetached:old.every(e=>!e.isConnected&&e.getClientRects().length===0),
      resultCount:document.querySelector('#npc-scout-comparison-results')?.childElementCount,
      resultText:document.querySelector('#npc-scout-comparison-results')?.textContent,
      panelHidden:document.querySelector('#npc-scout-comparison-panel')?.hidden,
      currentRunVisible:!!document.querySelector('#npc-scout-comparison-run')?.getClientRects().length})''')
    events = page.evaluate('(n)=>window.__npcClicks.slice(n)', start)
    reference = persist_json(f'{len(checks):05d}-{label}-retired', {'before': before, 'after': storage(page),
                             'state': state, 'action': action, 'events': events, 'visible': visible, 'enabled': enabled})
    if action == 'native-unavailable':
        check(label + ': retired action is genuinely hidden or disabled, never force-clicked',
              not visible or not enabled, reference)
    check(label + ': no former exact result is reachable or revived',
          state['allOldDetached'] and state['resultCount'] == 0 and state['resultText'] == '', reference)
    check(label + ': unavailable means zero input, available refusal means a trusted click',
          events == [] if action == 'native-unavailable' else len(events) == 1 and events[0]['trusted'] is True, reference)
    storage_check(label + ': retired action leaves all storage bytes unchanged', page, before)


def result_refs(page):
    return page.evaluate_handle("()=>[...document.querySelectorAll('#npc-scout-comparison-results *')]")


def explicit_input_boundaries(natural_raw):
    begin_case('EXPLICIT-DOM-untrusted-events-cannot-authorize-comparison')
    context, page = boot(natural_raw); expected = save(page); before = storage(page)
    tab(page, 'messages')
    page.locator(comparison_entry()).evaluate('(e)=>e.click()'); advance(page)
    check('synthetic opener click grants no historical-comparison session', page.locator(PANEL).is_hidden())
    open_comparison(page); choose_other(page)
    page.locator(PREFIX + 'run').evaluate('(e)=>e.click()'); advance(page)
    check('synthetic Run never computes a result despite a native selected partner',
          page.locator(PREFIX + 'results').inner_text() == '' and page.locator(PREFIX + 'summary').count() == 0)
    trusted_click(page, PREFIX + 'run'); expect(page.locator(PREFIX + 'summary')).to_be_visible()
    refs = result_refs(page)
    try:
        page.locator(PREFIX + 'other').evaluate("e=>e.dispatchEvent(new Event('change',{bubbles:true}))")
        advance(page); retired_result(page, refs, 'untrusted-partner-change')
    finally: refs.dispose()
    storage_check('all untrusted controls leave complete native storage unchanged', page, before)
    whole_state('untrusted-input-complete-live-state', save(page), expected)
    open_comparison(page); run_comparison(page)
    page.locator(PREFIX + 'run').focus(); page.locator(PREFIX + 'run').press('Escape'); advance(page)
    expect(page.locator(PANEL)).to_be_hidden()
    check('native Escape closes history and returns focus to the precise original opener',
          page.locator(comparison_entry()).evaluate('(e)=>document.activeElement===e'))
    whole_state('native-Escape-complete-live-state', save(page), expected)
    context.close()


def lifecycle_boundaries(natural_raw):
    expected = json.loads(natural_raw)['state']
    for kind in ('new-selection', 'tab-away', 'cancelled-import', 'same-world-import', 'corrupt-import',
                 'cancelled-reset', 'accepted-reset', 'hidden-aba', 'style-aba', 'aria-hidden-aba',
                 'same-node-detach', 'same-id-replacement', 'result-replacement'):
        begin_case('explicit-boundary-' + kind)
        context, page = boot(natural_raw)
        whole_state(kind + '-baseline', save(page), expected)
        open_comparison(page); run_comparison(page); reveal_exact(page)
        before = storage(page); draft = draft_values(page); refs = result_refs(page)
        try:
            if kind == 'new-selection':
                select(page, PREFIX + 'other', '')
            elif kind == 'tab-away':
                tab(page, 'fleet'); tab(page, 'messages')
            elif kind in ('cancelled-import', 'same-world-import'):
                import_file(page, natural_raw, kind == 'same-world-import', kind)
                tab(page, 'messages')
            elif kind == 'corrupt-import':
                tab(page, 'save'); path = out / 'comparison-corrupt-import.json'; path.write_text('{broken')
                page.locator('[data-bind="import-file"]').set_input_files(str(path))
                expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败'); tab(page, 'messages')
            elif kind in ('cancelled-reset', 'accepted-reset'):
                tab(page, 'save'); dialogs = []
                def answer(dialog):
                    valid = dialog.type == 'confirm' and dialog.message == '备份当前原始存档并重新开始？新存档写入成功后才会替换当前进度。'
                    dialogs.append({'valid': valid, 'message': dialog.message})
                    dialog.accept() if valid and kind == 'accepted-reset' else dialog.dismiss()
                page.once('dialog', answer); trusted_click(page, '[data-action="reset"]')
                check('reset uses exact real native confirmation', len(dialogs) == 1 and dialogs[0]['valid'], dialogs)
                tab(page, 'messages')
            elif kind in ('hidden-aba', 'style-aba', 'aria-hidden-aba'):
                attribute = {'hidden-aba': 'hidden', 'style-aba': 'style', 'aria-hidden-aba': 'aria-hidden'}[kind]
                page.locator(PREFIX + 'run').evaluate('''(e,a)=>{const old=e.getAttribute(a);
                  e.setAttribute(a,a==='style'?'display:none':a==='aria-hidden'?'true':'');
                  if(old===null)e.removeAttribute(a);else e.setAttribute(a,old);}''', attribute)
                advance(page)
            else:
                selector = PREFIX + ('summary' if kind == 'result-replacement' else 'run')
                page.locator(selector).evaluate('''(e,kind)=>{if(kind==='same-node-detach'){
                  const p=e.parentNode,n=e.nextSibling;e.remove();p.insertBefore(e,n);
                }else e.replaceWith(e.cloneNode(true));}''', kind)
                advance(page)
            retired_result(page, refs, kind)
        finally:
            refs.dispose()
        if kind == 'accepted-reset':
            check('accepted reset removes historical pair entry rather than reviving old IDs', page.locator(comparison_entry()).count() == 0)
            # Reset changes state by design; retain exact before/after raw, no false equality.
            persist_json('accepted-reset-raw', {'before': before, 'after': storage(page), 'savedState': save(page)})
        else:
            if kind != 'same-world-import':
                storage_check(kind + ': complete raw survives lifecycle boundary', page, before,
                              condition=draft_values(page) == draft)
            whole_state(kind + '-whole-live-state', save(page), expected)
            if kind not in ('same-node-detach', 'same-id-replacement'):
                open_comparison(page)
                check(kind + ': reopening needs fresh explicit selection and click', page.locator(PREFIX + 'run').is_disabled())
                run_comparison(page)
        context.close()


def eviction_boundaries(arrival_raw):
    for evicted in ('scout-11', 'scout-13'):
        begin_case('EXPLICIT-SYNTHETIC-FIFO-evict-' + evicted)
        branch, seconds = synthetic_eviction(arrival_raw, evicted)
        persist_json('explicit-fifo-' + evicted, {'classification': 'Synthetic message FIFO only; both snapshots and already-paid scout13 return are genuine browser output.',
                     'originalRaw': arrival_raw, 'syntheticRaw': branch, 'changes': ['messages order and 148 ordinary fillers'], 'seconds': seconds})
        context, page = boot(branch)
        whole_state('strict-fifo-fixture-native-read', save(page), json.loads(branch)['state'])
        open_comparison(page); run_comparison(page); reveal_exact(page); refs = result_refs(page)
        try:
            for _ in range(seconds): advance(page, 1000)
            retired_result(page, refs, 'FIFO-' + evicted)
        finally: refs.dispose()
        state = save(page); tab(page, 'messages')
        check('actual already-paid return evicts chosen member of historical pair',
              len(state['messages']) == 150 and all(row['id'] != evicted for row in state['messages'])
              and not state['fleets'] and page.locator(comparison_entry(evicted)).count() == 0)
        survivor = 'scout-13' if evicted == 'scout-11' else 'scout-11'
        open_comparison(page, survivor)
        check('surviving message has no obsolete partner choice after FIFO eviction',
              all(not row.startswith(f'舰队 #{evicted.removeprefix("scout-")} · ')
                  for row in page.locator(PREFIX + 'other option').all_text_contents())
              and page.locator(PREFIX + 'run').is_disabled())
        context.close()


def protection_boundary(natural_raw):
    begin_case('native-cross-tab-protection-and-recovery')
    context, page = boot(natural_raw); open_comparison(page); run_comparison(page); reveal_exact(page)
    before = storage(page); refs = result_refs(page)
    other = context.new_page(); other.goto(args.url, wait_until='networkidle')
    competing = json.loads(natural_raw); competing['savedAt'] += 1
    competing_raw = json.dumps(competing, ensure_ascii=False)
    persist_json('cross-tab-raw-before-write', {'before': before, 'competingRaw': competing_raw})
    other.evaluate('([key,value])=>localStorage.setItem(key,value)', [KEY, competing_raw])
    page.bring_to_front(); advance(page)
    expect(page.locator('[data-bind="notice"]')).to_be_visible()
    events = page.evaluate('window.__npcStorage')
    check('protection receives exact real trusted cross-tab storage event',
          any(row['trusted'] is True and row['oldValue'] == before[KEY] and row['newValue'] == competing_raw for row in events), events)
    try: retired_result(page, refs, 'cross-tab-protected')
    finally: refs.dispose()
    storage_check('protected comparison keeps exact competing raw and all backups', page, before, {**before, KEY: competing_raw})
    opener = page.locator(comparison_entry())
    check('protection exposes no enabled historical-comparison entry', opener.count() == 0 or opener.is_disabled() or not opener.is_visible())
    other.close(); reload_bound(page)
    expect(page.locator(PANEL)).to_be_hidden()
    open_comparison(page)
    check('recovery reload never revives an earlier comparison result', page.locator(PREFIX + 'run').is_disabled())
    run_comparison(page); context.close()


def source_identity():
    actual_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    actual_tree = subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=ROOT, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain=v1', '--untracked-files=all', '--',
                                    'src', 'scripts', 'tests', 'package.json', 'package-lock.json'], cwd=ROOT, text=True).strip()
    if actual_sha != args.expected_sha or dirty:
        raise ValueError('Native acceptance requires the exact clean committed source, never a patched workspace')
    paths = ('scripts/browser-scout-comparison.py', 'scripts/browser-scout-rehearsal.py',
             'scripts/browser-npc-attack.py', 'scripts/scout-rehearsal-natural-route.ts',
             'tests/fixtures/npc-scout-legacy.json', 'package-lock.json')
    hashes = {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}
    source = fixtures['source']
    for key, path in (('routeScriptSha256', paths[3]), ('fixturePoolSha256', paths[4]), ('dependencyLockSha256', paths[5])):
        if source.get(key) != hashes[path]: raise ValueError('Natural report producer binding mismatch: ' + key)
    return actual_tree, hashes


def main():
    global args, out, report_path, journal_path, progress_path, fixture_sha256, fixtures, KEY, ORIGIN
    global checks, errors, failed_requests, evidence, source_bindings, page_sources, release_metadata
    global completed, active_page, source_sha, failure, case, journal, last_progress_at, browser, CLOCK, FAULT, expect
    global passed_count, failed_count, recorded_checks, recorded_evidence, recorded_sources, recorded_errors, recorded_requests
    global source_tree, script_hashes
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--natural-report', required=True); parser.add_argument('--expected-report-sha256', required=True)
    parser.add_argument('--expected-sha', default=os.environ.get('GITHUB_SHA')); parser.add_argument('--release')
    parser.add_argument('--output', required=True); parser.add_argument('--chromium')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true':
        parser.error('Native scout comparison acceptance is CI-only; local browser execution is not authorized.')
    if not args.expected_sha or not re.fullmatch(r'[0-9a-f]{40}', args.expected_sha): parser.error('Exact expected source SHA required')
    if not re.fullmatch(r'[0-9a-f]{64}', args.expected_report_sha256): parser.error('Exact complete natural report SHA256 required')
    out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
    report_path = out / 'scout-comparison-browser-report.json'
    journal_path = out / 'scout-comparison-checks.jsonl'; progress_path = out / 'scout-comparison-progress.json'
    load_reviewed_helpers()
    if not args.worker:
        supervise(); return
    from playwright.sync_api import sync_playwright, expect as native_expect
    expect = native_expect
    fixture_bytes = Path(args.natural_report).read_bytes(); fixture_sha256 = hashlib.sha256(fixture_bytes).hexdigest()
    if fixture_sha256 != args.expected_report_sha256: raise ValueError('Complete natural report hash mismatch')
    fixtures = json.loads(fixture_bytes)
    if not valid_natural_report(fixtures, args.expected_sha): raise ValueError('Natural provenance/completeness gate failed')
    fixtures['base'] = json.loads(fixtures['milestones'][0]['raw']); KEY = fixtures['key']
    source_tree, script_hashes = source_identity()
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
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('600-second comparison worker bound')))
    signal.alarm(600)
    try:
        with sync_playwright() as playwright, live_failure_evidence():
            browser = playwright.chromium.launch(headless=True, **({'executable_path': args.chromium} if args.chromium else {}))
            begin_case('natural-original-paid31-native-two-scout-route')
            context, page = boot(fixtures['origin']['raw'])
            captures, pair = replay_natural_pair(page)
            natural_four_widths(page, pair); context.close()
            explicit_input_boundaries(captures['scout13-returned'])
            lifecycle_boundaries(captures['scout13-returned'])
            eviction_boundaries(captures['scout13-after-real-battle'])
            protection_boundary(captures['scout13-returned'])
            check('no application error or failed request', not errors and not failed_requests,
                  {'errors': errors, 'requests': failed_requests})
            completed = True; flush(full=True, final=True); browser.close()
    finally: signal.alarm(0)


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


if __name__ == '__main__': main()
