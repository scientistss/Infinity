"""CI-only native r14 paid-scout rehearsal acceptance.
Functional Date/performance/RAF timestamps are controlled and explicitly labeled.
A separate isolated upper-bound context keeps native clocks UNMODIFIED and uses
PerformanceObserver/performance.now/CDP metrics, never a CPU profiler. No paint claim.
The unchanged complete legacy job and this independent job must both pass same SHA.
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
from fractions import Fraction
from pathlib import Path
from urllib.parse import urljoin, urlparse

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
             'native_scroll_to', 'attach', 'verify_bundle', 'verify_document_response',
             'select', 'trusted_click', 'input_number', 'snap', 'import_confirmation'}
    tree = ast.parse((ROOT / 'scripts/browser-npc-attack.py').read_text())
    selected = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    if {node.name for node in selected} != names:
        raise RuntimeError('Shared native acceptance definitions changed; explicit review required')
    exec(compile(ast.Module(body=selected, type_ignores=[]), '<reviewed-native-helpers>', 'exec'), globals())


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
            'acceptanceRule': 'This independent native job and the unchanged complete original job must both be green for this exact source SHA.',
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
    if fault is not None:
        setup += '\n' + FAULT.replace('__ORIGIN__', json.dumps(ORIGIN)).replace('__KEY__', json.dumps(KEY)).replace('__FAULT__', json.dumps(fault))
    context.add_init_script(setup)
    page = context.new_page(); active_page = page; attach(page)
    response = page.goto(args.url, wait_until='networkidle')
    verify_bundle(page); verify_document_response(response)
    if not native_clock:
        check('functional storage/File/dialog/timers native before declared wrappers', page.evaluate('window.__npcNative'))
    return context, page


def open_report(page, ident=11):
    tab(page, 'messages')
    selector = f'article.space-message[data-message-id="scout-{ident}"] button'
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


def control_proof(page, selector, name):
    native_scroll_to(page, selector)
    proof = visibility(page, [selector]); glyphs = text_leaf_visibility(page, [selector])
    check(name + ': complete control five native hit points', all(row['visible'] and row['contained'] and all(p['unoccluded'] for p in row['points']) for row in proof['targets']), proof)
    check(name + ': every actual glyph visible within ancestor clips', all(row['passed'] for row in glyphs['leaves']), glyphs)
    check(name + ': no page-level horizontal overflow', page.evaluate('document.scrollingElement.scrollWidth <= innerWidth'))
    snap(page, name + '.png')


def inspect_examples(page, width):
    expected = fixtures['naturalExamples']; snapshot = expected['snapshot']
    source_text = page.locator('#npc-rehearsal-source').inner_text()
    check('historical source exact canonical timestamp and model shown', all(x in source_text for x in ('历史情报，之后可能变化', snapshot['observedAt'], 'npc-scout-snapshot-v1')))
    page.locator('#npc-rehearsal-history > summary').click(); advance(page)
    history = page.locator('#npc-rehearsal-history-body').inner_text()
    check('historical exact values shown without rounded-text recovery', all(str(n) in history for n in snapshot['stock']), history)
    control_proof(page, '#npc-rehearsal-history > summary', f'{width}-historical-detail')
    for index in (2,3,4,5):
        control_proof(page, f'#npc-rehearsal-history-body > p:nth-of-type({index})', f'{width}-exact-historical-stats-{index}')
    for i, sample in enumerate(expected['expected'], 1):
        selector = f'#npc-rehearsal-results > details.npc-battle-report:nth-of-type({i})'
        heading = page.locator(selector + ' > summary').inner_text()
        outcome = {'attacker': '胜', 'defender': '败', 'draw': '平'}[sample['battle']['winner']]
        lost = 6 - sample['battle']['attackerAfter'].get('light_fighter', 0)
        check('public sample summary exact independent golden', all(text in heading for text in
              (f'公开示例 {i}', outcome, f'{len(sample["battle"]["rounds"])} 回合', f'永久损失 {lost} 艘',
               f'金属 {sample["loot"][0]}', f'晶体 {sample["loot"][1]}', f'重氢 {sample["loot"][2]}')), heading)
        control_proof(page, selector + ' > summary', f'{width}-public-example-{i}')
        check('closed sample has no preformatted rounds', page.locator(selector + ' table').count() == 0)
        page.locator(selector + ' > summary').click(); advance(page)
        body = page.locator(selector).inner_text()
        check('opened sample displays literal public seed and frozen survivors', str(sample['seed']) in body and 'npc-rehearsal-public-v1' in body, body)
        nested = page.locator(selector + ' details > summary'); nested.click(); advance(page)
        rows = page.locator(selector + ' tbody tr').evaluate_all('(rows)=>rows.map(r=>[...r.cells].map(c=>Number(c.textContent)))')
        wanted = [[r[k] for k in ('round', 'attacker', 'defender', 'attackDamage', 'defendDamage')] for r in sample['battle']['rounds']]
        check('lazy actual native round cells match independent exact counts and predeclared damage tolerance', len(rows) == len(wanted) and all(
            a[:3] == b[:3] and all(abs(x-y) <= 1e-12 + 1e-14*abs(y) for x,y in zip(a[3:], b[3:])) for a,b in zip(rows,wanted)), rows)
        page.locator(selector + ' > summary').click(); advance(page)


def draft_values(page):
    return page.evaluate('''()=>({mission:document.querySelector('#flight-mission').value,
       target:['galaxy','system','position'].map(k=>document.querySelector('#flight-'+k).value),
       speed:document.querySelector('#flight-speed').value,
       ships:[...document.querySelectorAll('[data-ship]')].map(e=>[e.dataset.ship,e.value]),
       cargo:['metal','crystal','deuterium'].map(k=>document.querySelector('#cargo-'+k).value)})''')


def natural_rehearsal(page):
    before = save(page); disk_before = storage(page)
    # Separate ordinary DOM draft is deliberately dirty, with all13 and cargo.
    tab(page, 'fleet'); select(page, '#flight-mission', 'transport')
    for ship in SHIPS:
        input_number(page, f'[data-ship="{ship}"]', 1)
    for resource in ('metal', 'crystal', 'deuterium'):
        input_number(page, '#cargo-' + resource, 7)
    dirty = draft_values(page)
    open_report(page); check('open leaves every ordinary DOM draft field untouched', draft_values(page) == dirty)
    run_six(page); check('Run leaves every ordinary DOM draft field untouched', draft_values(page) == dirty)
    trusted_click(page, '#npc-rehearsal-cancel')
    expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
    check('Cancel leaves every progress byte untouched with exact messages-tab preference', storage(page) == {**disk_before, 'infinity.ui.tab':'messages'})
    whole_state('run-and-cancel-no-game-effects', save(page), before)
    for width in WIDTHS:
        page.set_viewport_size({'width': width, 'height': 1100}); advance(page)
        open_report(page); run_six(page); inspect_examples(page, width)
        control_proof(page, '#npc-rehearsal-run', f'{width}-explicit-run')
        control_proof(page, '#npc-rehearsal-fill', f'{width}-draft-fill')
        previous_bytes = storage(page)
        trusted_click(page, '#npc-rehearsal-fill')
        values = draft_values(page)
        check('Fill atomically replaces exactly mission/target/all13/speed/emptycargo', values == {
            'mission': 'attack', 'target': ['1','56','15'], 'speed': '100',
            'ships': [[ship, '6' if ship == 'light_fighter' else '0'] for ship in SHIPS], 'cargo': ['0','0','0']}, values)
        check('Fill causes no payment/save/IDs/RNG/wallet/history write; only exact fleet-tab preference changes', storage(page) == {**previous_bytes, 'infinity.ui.tab':'fleet'})
        for _ in range(3):advance(page)
        expect(page.locator('#npc-rehearsal-draft-notice')).to_have_text('仅已填入，尚未派遣或付款。请核对最新航程报价，再单独点击付费出征。')
        check('unpaid draft notice survives later production chrome frames and stale global status',storage(page)=={**previous_bytes,'infinity.ui.tab':'fleet'})
        whole_state(f'{width}-draft-only-fullstate', save(page), before)
    page.set_viewport_size({'width': 1440, 'height': 1100}); advance(page)
    # Last explicit new review/fill is left armed for the separately recorded send.
    open_report(page); run_six(page); trusted_click(page, '#npc-rehearsal-fill')


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
    else: check('cancelled import retains every native storage byte', storage(page) == before)
    return before


def authority_boundaries():
    before_row = next(r for r in fixtures['milestones'] if r['name'] == 'scout11-returned')
    for kind in ('forged', 'clone', 'detach', 'same-id-remount', 'planet', 'cancelled-import', 'corrupt-import', 'same-world-import', 'conflict'):
        begin_case('native-authority-' + kind)
        context,page = boot(before_row['raw']); open_report(page); run_six(page)
        before = save_without_navigation(page)
        if kind == 'forged':
            page.locator('#npc-rehearsal-fill').evaluate('(e)=>e.click()'); advance(page)
            check('untrusted synthetic Fill cannot change draft or state', draft_values(page)['mission'] != 'attack' and storage(page) == before)
        elif kind in ('clone', 'detach', 'same-id-remount'):
            selector = '#npc-rehearsal-fill'
            page.locator(selector).evaluate('''(e,kind)=>{if(kind==='detach'){const p=e.parentNode,n=e.nextSibling;e.remove();p.insertBefore(e,n);}else{const c=e.cloneNode(true);e.replaceWith(c);}}''', kind)
            advance(page)
            node = page.locator(selector)
            if node.is_enabled(): node.click(); advance(page)
            check('cloned detached or same-ID replacement cannot fill stale draft', draft_values(page)['mission'] != 'attack' and storage(page) == before)
        elif kind == 'planet':
            select(page, '#planet-select', 'colony-1'); expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
        elif kind == 'corrupt-import':
            tab(page,'save'); prior=storage(page); invalid=out/'explicit-corrupt-r14.json';invalid.write_text('{broken-current-envelope')
            page.locator('[data-bind="import-file"]').set_input_files(str(invalid))
            expect(page.locator('[data-bind="status"]')).to_contain_text('导入失败')
            check('corrupt prepared import never adopts or alters raw/backups',storage(page)==prior)
            tab(page,'messages');expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
        elif kind in ('cancelled-import', 'same-world-import'):
            import_file(page, before_row['raw'], kind == 'same-world-import', kind)
            tab(page,'messages'); expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
            open_report(page); check('world/cancel invalidation requires fresh explicit Run', page.locator('#npc-rehearsal-fill').is_disabled())
        else:
            # Genuine same-origin storage event from second native page. It changes only metadata bytes.
            other=context.new_page(); other.goto(args.url, wait_until='networkidle')
            competing = json.loads(before_row['raw']); competing['savedAt'] += 1
            other.evaluate('([key,value])=>localStorage.setItem(key,value)', [KEY,json.dumps(competing,ensure_ascii=False)])
            expect(page.locator('[data-bind="notice"]')).to_be_visible(); advance(page)
            expect(page.locator('#npc-rehearsal-panel')).to_be_hidden()
            open_report(page); check('protected history stays readable but edits Run Fill disabled', page.locator('#npc-rehearsal-run').is_disabled() and page.locator('#npc-rehearsal-fill').is_disabled())
            other.close();page.reload(wait_until='networkidle');advance(page);open_report(page)
            check('actual conflict refresh needs a fresh explicit review',page.locator('#npc-rehearsal-fill').is_disabled())
            run_six(page)
        context.close()


def save_without_navigation(page):
    # Exact native storage witness while panel remains open, no game globals.
    return storage(page)


def leaf_retirement_boundaries():
    row=next(r for r in fixtures['milestones'] if r['name']=='scout11-returned')
    for selector in ('#npc-rehearsal-run','#npc-rehearsal-fill','#npc-rehearsal-ship-light_fighter','#npc-rehearsal-speed'):
        for attribute in ('hidden','style','aria-hidden'):
            begin_case('EXPLICIT-DOM-own-leaf-retirement-'+selector+'-'+attribute)
            context,page=boot(row['raw']);open_report(page);run_six(page);before=storage(page);draft=draft_values(page)
            page.locator(selector).evaluate('''(e,a)=>{const old=e.getAttribute(a);e.setAttribute(a,a==='style'?'display:none':a==='aria-hidden'?'true':'');if(old===null)e.removeAttribute(a);else e.setAttribute(a,old);}''',attribute)
            advance(page)
            fill=page.locator('#npc-rehearsal-fill')
            if fill.is_visible() and fill.is_enabled():fill.click();advance(page)
            check('same-turn own leaf hide/restore permanently retires old review capability',
                  draft_values(page)==draft and storage(page)==before and (page.locator('#npc-rehearsal-panel').is_hidden() or fill.is_disabled()))
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
    page.locator('article.space-message[data-message-id="scout-11"] button').click()
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
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,**({'executable_path':args.chromium} if args.chromium else {}))
            begin_case('natural-unedited-paid31-migration')
            context,page=boot(fixtures['origin']['raw'])
            backups=storage(page)
            check('migration exact original r13 bytes backed up once',any(k.startswith(KEY+'.backup') and v==fixtures['origin']['raw'] for k,v in backups.items()))
            replay_natural(page);context.close()
            authority_boundaries();leaf_retirement_boundaries();curvature_and_eviction();storage_boundaries();measured_upper_bound()
            check('no application error or failed native request',not errors and not failed_requests,{'errors':errors,'requests':failed_requests})
            completed=True;flush(full=True,final=True);browser.close()
    except BaseException as error:
        completed=False;failure=traceback.format_exc()
        if active_page is not None:
            try:
                (out/'failure.html').write_text(active_page.content());active_page.screenshot(path=str(out/'failure.png'))
                atomic_json(out/'failure-storage.json',storage(active_page))
            except BaseException:pass
        flush(full=True);raise error
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
