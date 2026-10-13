#!/usr/bin/env python3
"""Bounded new-feature native acceptance from an independent fresh-start fixture.

Real HTTP/V8 production, native file import/confirmation/Storage, trusted normal
inputs. Logical Date/performance/RAF time is controlled; no real-time claim.
Explicit DOM/storage attacks and 3/4-planet synthetic boundaries stay labeled.
HTTP caching is explicitly disabled for exact cold-reload source identity;
this suite does not measure browser cache or rendering performance.
"""
import argparse
from contextlib import contextmanager
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.parse import unquote, urljoin, urlparse
import uuid

ROOT = Path(__file__).resolve().parents[1]
KEY = 'infinity.original-p4.save.v1'
WORK_SECONDS, SUPERVISOR_SECONDS = 630, 650
WIDTHS = (320, 390, 768, 1440)
SCENARIOS = ('natural-payments-reload-no-replay', 'natural-unobserved-control', *(f'responsive-{width}' for width in WIDTHS),
             'synthetic-three-planets', 'synthetic-four-planets', 'single-planet-blocked',
             'cloned-confirm', 'silent-budget-change', 'detached-confirm', 'ancestor-detach-reinsert',
             'tab-away-back', 'active-planet-aba', 'cancel-review', 'cancelled-import',
             'invalid-import', 'template-rename-stale', 'template-delete-stale', 'order-capacity-blocked', 'active-selection-fixed-payers', 'storage-write-failure', 'storage-readback-failure', 'external-storage-protection')


def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def http_response_evidence(response):
    request, chain, seen = response.request, [], set()
    while request is not None:
        if id(request) in seen or len(chain) >= 16:
            raise ValueError('Nonfinite HTTP redirect chain')
        seen.add(id(request))
        chain.append({'url': request.url, 'resourceType': request.resource_type})
        request = request.redirected_from
    return {'url': response.url, 'status': response.status,
            'requestChainFinalFirst': chain,
            'cacheHeaders': {key: value for key, value in response.headers.items()
                             if key.lower() in ('cache-control', 'etag', 'last-modified', 'age')}}


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def identity(pid):
    try:
        values = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return {'pid': pid, 'start': values[19], 'state': values[0]}
    except (OSError, IndexError):
        return None


def supervise(args):
    out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
    if any(out.iterdir()):
        raise ValueError('Native output must be a fresh empty directory')
    marker = '--building-batch-owner=' + uuid.uuid4().hex
    report_path = out / 'report.json'
    atomic_json(report_path, {'schema': 'infinity-building-batch-native-v1', 'completed': False, 'scenarios': []})
    owned, sent = {}, []
    def collect(root):
        pending = [root, *owned]
        for entry in Path('/proc').iterdir():
            if entry.name.isdigit():
                try:
                    if marker.encode() in (entry / 'cmdline').read_bytes().split(b'\0'):
                        pending.append(int(entry.name))
                except OSError:
                    pass
        seen = set()
        while pending:
            pid = pending.pop()
            if pid in seen:
                continue
            seen.add(pid)
            current = identity(pid)
            if not current or (pid in owned and current['start'] != owned[pid]['start']):
                continue
            owned[pid] = current
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(map(int, children.read_text().split()))
                except OSError:
                    pass
    def terminate(sig):
        for pid, observed in reversed(list(owned.items())):
            current = identity(pid)
            if current and current['start'] == observed['start'] and current['state'] != 'Z':
                try:
                    os.kill(pid, sig); sent.append({'pid': pid, 'start': current['start'], 'signal': sig})
                except ProcessLookupError:
                    pass
    def interrupted(signum, _frame):
        raise KeyboardInterrupt(f'Signal {signum}')
    signal.signal(signal.SIGTERM, interrupted)
    expired, error, code = False, None, 1
    with (out / 'worker.log').open('w') as log:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *sys.argv[1:], '--worker', '--owner-marker=' + marker],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + SUPERVISOR_SECONDS
        try:
            while process.poll() is None:
                collect(process.pid)
                if time.monotonic() >= deadline:
                    expired = True; break
                time.sleep(.2)
            code = process.poll() if process.poll() is not None else 1
        except BaseException as caught:
            error = repr(caught)
        finally:
            collect(process.pid); terminate(signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            collect(process.pid); terminate(signal.SIGKILL)
            process.wait(timeout=2)
    survivors = [identity(pid) for pid, observed in owned.items() if identity(pid)
                 and identity(pid)['start'] == observed['start'] and identity(pid)['state'] != 'Z']
    result = json.loads(report_path.read_text())
    result['supervisor'] = {'budgetSeconds': SUPERVISOR_SECONDS, 'expired': expired, 'error': error,
                            'workerExitCode': code, 'ownedProcesses': list(owned.values()), 'signals': sent, 'survivors': survivors}
    if expired or error or survivors or code != 0:
        result['completed'] = False
    atomic_json(report_path, result)
    print(json.dumps({'completed': result['completed'], 'scenarios': len(result['scenarios']), 'report': str(report_path)}))
    return 0 if result['completed'] else 1


CLOCK = r'''(() => {
 if(location.origin!==__ORIGIN__)return;
 const nativeRAF=requestAnimationFrame.bind(window), initial=__EPOCH__;
 let elapsed=Number(sessionStorage.getItem('batch-logical-elapsed')||0), originElapsed=elapsed;
 Date.now=()=>initial+elapsed;
 Object.defineProperty(performance,'now',{value:()=>elapsed-originElapsed});
 requestAnimationFrame=fn=>nativeRAF(()=>fn(elapsed-originElapsed));
 window.__batchAdvance=async ms=>{if(ms!==0&&ms!==1000)throw Error('Only one-second live ticks');elapsed+=ms;
  sessionStorage.setItem('batch-logical-elapsed',String(elapsed));await new Promise(nativeRAF);await new Promise(nativeRAF);return elapsed;};
 const navigationSequence=Number(sessionStorage.getItem('batch-navigation-sequence')||0)+1;sessionStorage.setItem('batch-navigation-sequence',String(navigationSequence));
 window.__batchObserveRequested=false;window.__batchLive=null;
 window.__batchWitness={documentId:crypto.randomUUID(),navigationSequence,events:[],nativeStorage:localStorage instanceof Storage && [Storage.prototype.getItem,Storage.prototype.setItem].every(fn=>/\[native code\]/.test(Function.prototype.toString.call(fn))),
 nativeFile: /\[native code\]/.test(Function.prototype.toString.call(File.prototype.text)), nativeConfirm:/\[native code\]/.test(Function.prototype.toString.call(confirm))};
 document.addEventListener('click',event=>{const node=event.target.closest?.('button,summary');if(node)window.__batchWitness.events.push({kind:'click',trusted:event.isTrusted,id:node.id,tab:node.dataset.tab||null,action:node.dataset.action||node.dataset.buildingTemplateBatchAction||null});},true);
 document.addEventListener('change',event=>{const node=event.target;window.__batchWitness.events.push({kind:'change',trusted:event.isTrusted,id:node.id,planet:node.dataset?.batchPlanet||null,
  file:node.files?.[0]?{name:node.files[0].name,size:node.files[0].size}:null});},true);
})();'''


def worker(args):
    from playwright.sync_api import sync_playwright, expect
    started = time.monotonic()
    out = Path(args.output)
    fixture_path = Path(args.fixture).resolve()
    fixture_raw = fixture_path.read_bytes(); fixture = json.loads(fixture_raw)
    assert sha(fixture_raw) == args.expected_fixture_sha256
    assert fixture['provenance']['classification'] == 'clean-candidate-source' and not fixture['provenance']['dirtyPaths']
    assert fixture['provenance']['sourceSha'] == args.expected_sha
    assert fixture['provenance']['runtimeNode'] == args.runtime_node and re.fullmatch(r'v22\.\d+\.\d+', args.runtime_node)
    common_raw = Path(args.common_identity).read_bytes(); common = json.loads(common_raw)
    assert common['identity']['source']['sourceSha'] == args.expected_sha
    assert common['identity']['runtimeNode'] == args.runtime_node
    parsed = urlparse(args.url)
    assert parsed.scheme in ('http', 'https') and parsed.path.endswith('/') and not parsed.query and not parsed.fragment
    origin = f'{parsed.scheme}://{parsed.netloc}'
    report = {'schema': 'infinity-building-batch-native-v1', 'completed': False, 'sourceSha': args.expected_sha,
              'version': args.expected_version, 'runtimeNode': args.runtime_node,
              'fixtureSha256': sha(fixture_raw), 'commonIdentitySha256': sha(common_raw),
              'classification': 'native-production-controls; independent natural source; controlled logical clock; explicit synthetic adversarial and boundary cases',
              'fixedScenarioCensus': list(SCENARIOS), 'scenarios': [], 'checks': [], 'evidence': [], 'assets': [], 'errors': [],
              'budgetSeconds': WORK_SECONDS, 'sourceScripts': {path: sha((ROOT / path).read_bytes()) for path in (
                  'scripts/browser-building-batch.py', 'scripts/building-batch-natural-fixture.mjs', 'scripts/check-building-batch-fixture.py', 'scripts/building_batch_census.py', 'scripts/browser-ring-protection.py')}}
    current = None; active_page = None
    observer_spec = importlib.util.spec_from_file_location('batch_readonly_production_shapes', ROOT / 'scripts/browser-ring-protection.py')
    observer_shapes = importlib.util.module_from_spec(observer_spec); observer_spec.loader.exec_module(observer_shapes)
    def flush():
        report['hostElapsedSeconds'] = time.monotonic() - started
        atomic_json(out / 'report.json', report)
    def dump(label, raw):
        if isinstance(raw, str): raw = raw.encode()
        filename = f'{len(report["evidence"]):04d}-{label}'
        path = out / filename; path.write_bytes(raw)
        reference = {'file': filename, 'sha256': sha(raw), 'bytes': len(raw), 'scenario': current['id'] if current else None}
        report['evidence'].append(reference); flush(); return reference
    def check(name, condition, detail=None):
        row = {'scenario': current['id'] if current else 'binding', 'name': name, 'passed': bool(condition), 'detail': detail}
        report['checks'].append(row); flush()
        assert condition, name
        assert time.monotonic() - started < WORK_SECONDS, 'Worker purpose-bound watchdog expired'
    def raw(page):
        return page.evaluate('(key)=>localStorage.getItem(key)', KEY)
    def advance(page, seconds=0):
        if seconds == 0: page.evaluate('window.__batchAdvance(0)')
        for _ in range(seconds): page.evaluate('window.__batchAdvance(1000)')
    def tab(page, name):
        if page.locator('[data-bind="offline-modal"]').is_visible(): page.locator('[data-action="dismiss-offline"]').click()
        page.locator(f'[data-tab="{name}"]').click(); advance(page)
    def observe_live(page, label):
        before = dump(current['id'] + '-' + label + '-observer-before-storage.json', raw(page))
        page.evaluate('window.__batchLive=null;window.__batchObserveRequested=true')
        advance(page)
        observed = page.evaluate('window.__batchLive')
        check('one-shot original-frame state observation completed', observed is not None and not page.evaluate('window.__batchObserveRequested'))
        reference = dump(current['id'] + '-' + label + '-engine.json', observed)
        after = dump(current['id'] + '-' + label + '-observer-after-storage.json', raw(page))
        check('read-only observer leaves complete native KEY raw bytes unchanged', (out / before['file']).read_bytes() == (out / after['file']).read_bytes())
        current.setdefault('engineObservations', []).append({'label': label, 'storageBefore': before, 'storageAfter': after, **reference})
        return json.loads(observed), reference
    def raw_unchanged(page, before_reference, label):
        before = (out / before_reference['file']).read_bytes()
        after = raw(page).encode()
        reference = dump(current['id'] + '-' + label + '-raw.json', after)
        current.setdefault('rawNoopProofs', []).append({'label': label, 'before': before_reference, 'after': reference})
        check('complete immediate KEY raw bytes unchanged: ' + label, after == before, {'before': before_reference, 'after': reference})
    def export_live(page):
        tab(page, 'save'); page.locator('[data-action="export"]').click(); advance(page)
        text = page.locator('[data-bind="transfer"]').input_value()
        reference = dump(current['id'] + '-live-export.json', text)
        return json.loads(text)['state'], reference
    def preserve(page, label):
        text = raw(page)
        reference = dump(current['id'] + '-' + label + '.json', text)
        current.setdefault('rawSnapshots', []).append({'label': label, **reference})
        return json.loads(text)['state'], reference
    def whole(name, actual, expected):
        proof = dump(current['id'] + '-whole-state.json', json.dumps({'actual': actual, 'expected': expected}, ensure_ascii=False, indent=2))
        check(name + ' (all fields and array order)', actual == expected, proof)
    def panel(page):
        tab(page, 'orders')
        if not page.locator('#building-template-batch').evaluate('(node)=>node.open'):
            page.locator('#building-template-batch > summary').click(); advance(page)
    def prepare(page, ids=None, fill=True, review=True):
        panel(page)
        page.locator('#building-template-batch-template').select_option(str(fixture['templateId'])); advance(page)
        for ident in (ids or fixture['planetIds']):
            page.locator(f'[data-batch-planet="{ident}"]').check(); advance(page)
        if fill: page.locator('#building-template-batch-fill-quotes').click(); advance(page)
        if review: page.locator('#building-template-batch-review').click(); advance(page)
    def import_file(page, path, accept=True):
        tab(page, 'save'); dialogs = []
        def answer(dialog):
            valid = dialog.type == 'confirm' and dialog.message.startswith('已读取存档 v9/r14。') and '是否替换当前进度' in dialog.message
            dialogs.append({'valid': valid, 'message': dialog.message, 'accepted': valid and accept})
            dialog.accept() if valid and accept else dialog.dismiss()
        page.once('dialog', answer)
        page.locator('[data-bind="import-file"]').set_input_files(str(path)); advance(page)
        expect(page.locator('[data-bind="status"]')).to_contain_text('已导入并存入本地' if accept else '已取消文件导入')
        check('native file import has one valid confirmation', len(dialogs) == 1 and dialogs[0]['valid'], dialogs)
        witness = page.evaluate('window.__batchWitness.events')
        check('native file selection is trusted and exact-size', any(event['kind'] == 'change' and event['trusted'] and event.get('file') == {'name': path.name, 'size': path.stat().st_size} for event in witness))
    def seal_scripts(page, capture):
        rows = []
        for event in capture['executed']:
            url = event['url']
            if not url.startswith(args.url): continue
            relative = unquote(urlparse(url).path).removeprefix(unquote(parsed.path))
            if not relative.endswith('.js'): continue
            responses = [response for response in capture['responses'] if response.url == url]
            identity_evidence = {'executed': event, 'relative': relative,
                                 'matchingResponseCount': len(responses),
                                 'responses': [http_response_evidence(response) for response in capture['responses']],
                                 'protocolResponses': capture['responseEvents'],
                                 'cachePolicy': 'Network.setCacheDisabled(true) before every initial navigation; inherited by reload'}
            identity_ref = dump(current['id'] + '-http-response-identity.json', json.dumps(identity_evidence, ensure_ascii=False, indent=2))
            current.setdefault('httpIdentityObservations', []).append(identity_ref)
            check('executed production asset has one real HTTP response', len(responses) == 1 and responses[0].status == 200 and relative in release['files'], identity_ref)
            code = capture['cdp'].send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
            row = {'file': relative, 'url': url, 'httpSha256': sha(responses[0].body()), 'v8Sha256': sha(code), 'releaseSha256': release['files'][relative],
                   'httpOriginal': dump(current['id'] + '-http-executed.js', responses[0].body()), 'v8Original': dump(current['id'] + '-v8-executed.js', code)}
            row.update(page.evaluate('({documentId:window.__batchWitness.documentId,navigationSequence:window.__batchWitness.navigationSequence})'))
            rows.append(row)
            check('full V8 source equals actual HTTP asset and release', row['httpSha256'] == row['v8Sha256'] == row['releaseSha256'], row)
            handlers = observer_shapes.production_action_handlers(code)
            if handlers and capture.get('enableObserver', True):
                serializers = observer_shapes.production_serializers(code)
                frames = list(re.finditer(r'window\.requestAnimationFrame\(([\w$]+)\);window\.setInterval', code))
                check('unchanged production state serializer handler and frame resolve uniquely', len(handlers) == len(serializers) == len(frames) == 1)
                handler = handlers[0]; serializer = serializers[0].group('name'); state_name = handler.group('state'); session = handler.group('session')
                declaration = re.search(r'function ' + re.escape(frames[0].group(1)) + r'\([\w$]+\)\{', code)
                check('exact original application frame declaration exists', declaration is not None)
                position = declaration.end(); line = code.count('\n', 0, position); column = position - (code.rfind('\n', 0, position) + 1)
                expression = f'(globalThis.__batchObserveRequested&&(globalThis.__batchLive=JSON.stringify({{state:{serializer}({state_name}),mode:{session}.mode,expectedRaw:{session}.expectedRaw,protectedRaw:{session}.protectedRaw,frameAt:performance.now(),wallAt:Date.now(),documentId:globalThis.__batchWitness.documentId,navigationSequence:globalThis.__batchWitness.navigationSequence}}),globalThis.__batchObserveRequested=false),false)'
                binding = capture['cdp'].send('Debugger.setBreakpointByUrl', {'url': url, 'lineNumber': line, 'columnNumber': column, 'condition': expression})
                check('one-shot read-only observer binds exactly one original frame location', len(binding.get('locations', [])) == 1)
                capture.setdefault('observerBreakpoints', []).append(binding['breakpointId'])
                current.setdefault('observerBindings', []).append({'documentId': row['documentId'], 'navigationSequence': row['navigationSequence'], 'sourceFile': relative,
                    'serializer': serializer, 'stateName': state_name, 'sessionName': session, 'position': position, 'line': line, 'column': column, 'expression': expression, 'binding': binding})
        check('nonempty exact executed asset inventory', bool(rows) and len({row['url'] for row in rows}) == len(rows))
        current.setdefault('executedSources', []).append(rows)
    def boot(browser, input_file=None, width=1440, enable_observer=True):
        nonlocal active_page
        context = browser.new_context(viewport={'width': width, 'height': 1000}, service_workers='block', reduced_motion='no-preference')
        context.add_init_script(CLOCK.replace('__ORIGIN__', json.dumps(origin)).replace('__EPOCH__', str(fixture['ready']['savedAt'])))
        page = context.new_page(); active_page = page
        page.set_default_timeout(8000); page.set_default_navigation_timeout(12000)
        capture = {'cdp': context.new_cdp_session(page), 'responses': [], 'executed': [], 'responseEvents': [], 'enableObserver': enable_observer}
        capture['cdp'].send('Network.enable')
        capture['cdp'].send('Network.setCacheDisabled', {'cacheDisabled': True})
        capture['cdp'].on('Network.responseReceived', lambda event: capture['responseEvents'].append(event)
                          if event.get('type') == 'Script' else None)
        capture['cdp'].send('Debugger.enable')
        capture['cdp'].on('Debugger.scriptParsed', lambda event: capture['executed'].append(event) if event.get('url', '').startswith(args.url) else None)
        page.on('response', lambda response: capture['responses'].append(response) if urlparse(response.url).path.endswith('.js') else None)
        page.on('pageerror', lambda error: report['errors'].append(str(error)))
        response = page.goto(args.url, wait_until='networkidle')
        check('real HTTP200 application', response is not None and response.status == 200)
        check('normal native Storage/File/confirm remain untouched', page.evaluate('window.__batchWitness.nativeStorage&&window.__batchWitness.nativeFile&&window.__batchWitness.nativeConfirm'))
        seal_scripts(page, capture)
        import_file(page, input_file or fixture_path.parent / 'ready.json')
        baseline, reference = preserve(page, 'imported')
        expected = json.loads((input_file or fixture_path.parent / 'ready.json').read_bytes())['state']
        whole('unchanged imported complete natural/boundary state', baseline, expected)
        live, live_ref = export_live(page); whole('visible live engine matches imported source', live, expected)
        current['initialRaw'] = reference; current['initialLiveExport'] = live_ref
        if enable_observer:
            observed, _ = observe_live(page, 'initial'); whole('actual original-frame complete engine equals imported source', observed['state'], expected)
        return context, page, capture, baseline
    def no_change(page, baseline):
        raw_unchanged(page, current.get('attemptBeforeRaw', current['initialRaw']), 'refused-or-read-only')
        observed, _ = observe_live(page, 'after-attempt'); whole('actual frame engine stays complete original state', observed['state'], baseline)
        saved, reference = preserve(page, 'after-attempt')
        whole('attempt leaves complete persisted state unchanged', saved, baseline)
        live, export_ref = export_live(page)
        whole('attempt leaves complete visible engine unchanged', live, baseline)
        current['afterRaw'] = reference; current['afterLiveExport'] = export_ref
    def retire_observer(page, capture):
        document = page.evaluate('({documentId:window.__batchWitness.documentId,navigationSequence:window.__batchWitness.navigationSequence})')
        for breakpoint_id in capture.get('observerBreakpoints', []):
            response = capture['cdp'].send('Debugger.removeBreakpoint', {'breakpointId': breakpoint_id})
            reference = dump(current['id'] + '-observer-retirement.json', json.dumps({**document, 'method': 'Debugger.removeBreakpoint', 'breakpointId': breakpoint_id, 'response': response}))
            current.setdefault('observerRetirements', []).append({**document, 'breakpointId': breakpoint_id, 'original': reference})
        capture['observerBreakpoints'] = []
    def seal_event_scope(page):
        witness = page.evaluate('window.__batchWitness')
        scopes = current.setdefault('eventScopes', [])
        assert all(scope['documentId'] != witness['documentId'] for scope in scopes), 'Duplicate document event sealing'
        reference = dump(current['id'] + '-document-events.json', json.dumps(witness, ensure_ascii=False, indent=2))
        scopes.append({'documentId': witness['documentId'], 'navigationSequence': witness['navigationSequence'], 'original': reference})
        current['events'] = [dict(event, documentId=scope['documentId'], navigationSequence=scope['navigationSequence'])
                             for scope in scopes for event in json.loads((out / scope['original']['file']).read_bytes())['events']]
    def finish(context, page):
        seal_event_scope(page)
        current['completed'] = True; flush(); context.close()
    def capture_failure(error, capture_page=True):
        # The outer fallback may see the same exception after Playwright stops.
        if 'failure' in report:
            return
        report['completed'] = False; report['result'] = 'failed'
        failure = report['failure'] = {'error': repr(error), 'traceback': traceback.format_exc(), 'scenario': current['id'] if current else 'binding'}
        def attempt(step, capture):
            try:
                capture()
            except BaseException as capture_error:
                failure.setdefault('captureErrors', []).append({'step': step, 'error': repr(capture_error)})
        attempt('original failure report', flush)
        if capture_page and active_page is not None:
            # Keep independent evidence available even when one capture fails.
            attempt('DOM', lambda: dump('failure-dom.html', active_page.content()))
            attempt('storage', lambda: dump('failure-storage.json', raw(active_page) or 'null'))
            attempt('events', lambda: dump('failure-events.json', json.dumps(active_page.evaluate('window.__batchWitness'), ensure_ascii=False, indent=2)))
            attempt('screenshot', lambda: active_page.screenshot(path=str(out / 'failure.png'), full_page=True, caret='initial'))
        attempt('final failure report', flush)
    @contextmanager
    def retain_before_teardown():
        try:
            yield
        except BaseException as error:
            try:
                capture_failure(error)
            except BaseException:
                # Even an unexpected diagnostic failure must not mask the test.
                pass
            raise
    try:
        with sync_playwright() as playwright, retain_before_teardown():
            browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'), headless=True,
                                                  args=['--no-sandbox', args.owner_marker])
            report['browserVersion'] = browser.version
            request_context = playwright.request.new_context()
            response = request_context.get(urljoin(args.url, 'release.json'), timeout=10000)
            release_raw = response.body(); release = json.loads(release_raw)
            report['release'] = dump('release.json', release_raw)
            check('release exact SHA version and unchanged schema', response.status == 200 and release['sourceSha'] == args.expected_sha and release['version'] == args.expected_version and release['saveVersion'] == 9 and release['saveRevision'] == 14)
            check('release is the common-identity original asset', sha(release_raw) == common['identity']['releaseSha256'])
            for name, digest in release['files'].items():
                check('safe exact asset path', '..' not in Path(name).parts and not name.startswith('/') and bool(re.fullmatch('[0-9a-f]{64}', digest)))
                response = request_context.get(urljoin(args.url, name), timeout=10000)
                asset = response.body()
                row = {'file': name, 'url': response.url, 'sha256': sha(asset), 'releaseSha256': digest, 'commonSha256': common['identity']['assets'][name], 'httpOriginal': dump('http-asset-' + name.replace('/', '_'), asset)}
                report['assets'].append(row)
                check('all actual HTTP assets equal release and common source build', response.status == 200 and response.url == urljoin(args.url, name) and row['sha256'] == digest == row['commonSha256'], row)
            request_context.dispose()
            for ident in SCENARIOS:
                current = {'id': ident, 'completed': False, 'classification': 'natural-source-native-controls' if ident.startswith('natural-') or ident.startswith('responsive-') else 'explicit-synthetic-boundary' if ident.startswith('synthetic-') else 'explicit-adversarial-lifecycle'}
                report['scenarios'].append(current); flush()
                if ident.startswith('synthetic-'):
                    count = 3 if 'three' in ident else 4
                    variant = next(branch for branch in fixture['syntheticBoundaries'] if branch['count'] == count)
                    context, page, capture, baseline = boot(browser, fixture_path.parent / variant['file'])
                    prepare(page, variant['planetIds'], fill=False)
                    check('all synthetic payers explicitly selected and all caps zero', page.locator('[data-batch-planet]:checked').count() == count and all(value == '0' for value in page.locator('[data-batch-budget-resource]').evaluate_all('(nodes)=>nodes.map(node=>node.value)')))
                    page.locator('#building-template-batch-apply').click(); advance(page)
                    actual, ref = preserve(page, 'authorized'); whole('full synthetic boundary authorization equals actual API oracle', actual, variant['authorized']['state'])
                    current['expectedTaskCount'] = count * 2; current['afterRaw'] = ref
                    live, ref = export_live(page); whole('synthetic authorized live engine is complete oracle', live, variant['authorized']['state']); current['afterLiveExport'] = ref
                    finish(context, page); continue
                width = int(ident.split('-')[-1]) if ident.startswith('responsive-') else 1440
                capacity_file = fixture_path.parent / fixture['lifecycleVariants']['capacity-blocked']['file'] if ident == 'order-capacity-blocked' else None
                context, page, capture, baseline = boot(browser, input_file=capacity_file, width=width, enable_observer=ident != 'natural-unobserved-control')
                if ident in ('natural-payments-reload-no-replay', 'natural-unobserved-control'):
                    prepare(page)
                    page.evaluate('window.__retainedBatchApply=document.querySelector("#building-template-batch-apply")')
                    page.locator('#building-template-batch-apply').click(); advance(page)
                    actual, ref = preserve(page, 'authorized'); whole('four unpaid authorizations match complete API expected state', actual, fixture['authorized']['state']); current['authorizedRaw'] = ref
                    before_duplicate = dump(ident + '-before-duplicate.json', raw(page))
                    page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    raw_unchanged(page, before_duplicate, 'duplicate-confirmation'); advance(page)
                    actual, _ = preserve(page, 'duplicate'); whole('duplicate native-control replay creates nothing', actual, fixture['authorized']['state'])
                    paid = {}
                    for second in range(fixture['checkpoints']['completed']['logicalSeconds'] - fixture['checkpoints']['ready']['logicalSeconds']):
                        advance(page, 1)
                        if ident == 'natural-unobserved-control': continue
                        observed, reference = observe_live(page, f'paid-second-{second + 1}')
                        for planet in observed['state']['planets']:
                            for job in planet['buildQueue']:
                                if job['taskId'] is not None:
                                    stable = {key: job[key] for key in ('jobId', 'taskId', 'source', 'building', 'targetLevel', 'paid')}
                                    stable['planetId'] = planet['id']
                                    owner = next(task for task in observed['state']['orders']['tasks'] if task['id'] == job['taskId'])
                                    if job['jobId'] in paid: check('paid job immutable identity remains exact', paid[job['jobId']]['job'] == stable)
                                    else:
                                        expected_owner = next(task for task in fixture['paid']['state']['orders']['tasks'] if task['id'] == job['taskId'])
                                        check('same-observation complete owner and active paid receipt match golden', owner == expected_owner and owner['activeJob'] == {'jobId': job['jobId'], 'quantity': 1, 'credited': 0}, {'actual': owner, 'expected': expected_owner, 'observation': reference})
                                        paid[job['jobId']] = {'job': stable, 'task': owner, 'observation': reference}
                        if second + 1 == fixture['checkpoints']['paid']['logicalSeconds'] - fixture['checkpoints']['ready']['logicalSeconds']:
                            whole('entire live paid-pass snapshot equals strict independent producer checkpoint', observed['state'], fixture['paid']['state'])
                            current['paidEngineSnapshot'] = reference
                    current['paidJobObservations'] = list(paid.values())
                    expected_paid = [{key: job[key] for key in ('jobId', 'taskId', 'source', 'building', 'targetLevel', 'paid', 'planetId')} for job in fixture['batchPaidJobs']]
                    if ident == 'natural-payments-reload-no-replay':
                        check('all four actual paid queues observed with exact task payer source and literal price', [entry['job'] for entry in paid.values()] == expected_paid, current['paidJobObservations'])
                    else:
                        check('unobserved control installed no state observer and gathered no observer evidence', not current.get('observerBindings') and not current.get('engineObservations') and not paid)
                    tab(page, 'save'); page.locator('[data-action="save"]').click(); advance(page)
                    actual, ref = preserve(page, 'completed'); whole('all four exact local payments and completed jobs match complete API oracle', actual, fixture['completed']['state']); current['completedRaw'] = ref
                    seal_event_scope(page)
                    retire_observer(page, capture)
                    capture['responses'].clear(); capture['executed'].clear(); capture['responseEvents'].clear()
                    page.reload(wait_until='networkidle'); seal_scripts(page, capture)
                    advance(page, 30); tab(page, 'save'); page.locator('[data-action="save"]').click(); advance(page)
                    actual, ref = preserve(page, 'no-replay'); whole('reload and three more passes do not renew finite orders', actual, fixture['noReplay']['state']); current['afterRaw'] = ref
                    live, ref = export_live(page); whole('complete live no-replay result matches independent API oracle', live, fixture['noReplay']['state']); current['afterLiveExport'] = ref
                    prepare(page)
                    check('real UI shows all-completed zero-operation confirmation', '零操作' in page.locator('#building-template-batch-apply').inner_text())
                    before_noop = dump(ident + '-before-completed-noop.json', raw(page))
                    page.locator('#building-template-batch-apply').click()
                    raw_unchanged(page, before_noop, 'all-completed-noop'); advance(page)
                    unchanged, ref = preserve(page, 'completed-noop'); whole('all-completed native confirmation changes no state or ID', unchanged, fixture['noReplay']['state']); current['afterRaw'] = ref
                    live, ref = export_live(page); whole('all-completed zero operation preserves complete live state', live, fixture['noReplay']['state']); current['afterLiveExport'] = ref
                elif ident.startswith('responsive-'):
                    prepare(page, fill=False, review=False)
                    check('all twelve per-payer/resource fields start at literal zero', page.locator('[data-batch-budget-resource]').count() == 12 and page.locator('[data-batch-budget-resource]').evaluate_all('(nodes)=>nodes.every(node=>node.value==="0")'))
                    page.locator('#building-template-batch-fill-quotes').click(); advance(page)
                    page.locator('#building-template-batch-review').click(); advance(page)
                    check('both payer summaries and total budget are present', page.locator('[data-batch-review-planet]').count() == 2 and '4' in page.locator('#building-template-batch-review-summary').inner_text())
                    witnesses = []
                    for selector in ('#building-template-batch-template', '#building-template-batch-review-summary', '#building-template-batch-total-budget', '#building-template-batch-apply'):
                        locator = page.locator(selector); locator.scroll_into_view_if_needed()
                        witness = locator.evaluate('''node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);const points=[[.5,.5],[.2,.5],[.8,.5]].map(([x,y])=>{const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return hit===node||node.contains(hit)});return {selector:node.id,width:innerWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:r.width>0&&r.height>0&&s.visibility!=="hidden"&&s.display!=="none",unoccluded:points.every(Boolean),text:node.innerText||node.value}}''')
                        file = f'{ident}-{len(witnesses)}.png'; page.screenshot(path=str(out / file), caret='initial'); witness['screenshot'] = dump(file, (out / file).read_bytes()); (out / file).unlink()
                        witnesses.append(witness)
                        check('actual viewport visible unobscured budget/authority control', witness['width'] == width and witness['visible'] and witness['unoccluded'] and witness['rect']['x'] >= -1 and witness['rect']['x'] + witness['rect']['width'] <= width + 1, witness)
                    budget_witnesses = []
                    for planet_id in fixture['planetIds']:
                        group = page.locator(f'[data-batch-budget-planet="{planet_id}"]')
                        if not group.evaluate('(node)=>node.open'):
                            group.locator(':scope > summary').click(); advance(page)
                        for building in ('metal_storage', 'deuterium_tank'):
                            for resource in ('metal', 'crystal', 'deuterium'):
                                locator = group.locator(f'[data-batch-budget-building="{building}"] [data-batch-budget-resource="{resource}"]')
                                locator.scroll_into_view_if_needed()
                                witness = locator.evaluate('''node=>{const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},visible:node.checkVisibility(),unoccluded:hit===node,value:node.value,label:node.getAttribute('aria-label')}}''')
                                witness.update(planetId=planet_id, building=building, resource=resource)
                                expected = '1000' if resource == 'metal' or resource == 'crystal' and building == 'deuterium_tank' else '0'
                                check('each literal independent payer/building/resource cap is visible and exact', witness['visible'] and witness['unoccluded'] and witness['value'] == expected and bool(witness['label']) and witness['rect']['x'] >= -1 and witness['rect']['x'] + witness['rect']['width'] <= width + 1, witness)
                                budget_witnesses.append(witness)
                        file = f'{ident}-{planet_id}-budgets.png'; page.screenshot(path=str(out / file), caret='initial'); group_shot = dump(file, (out / file).read_bytes()); (out / file).unlink()
                        for witness in budget_witnesses:
                            if witness['planetId'] == planet_id: witness['screenshot'] = group_shot
                    current['width'] = width; current['visibility'] = witnesses; current['budgetVisibility'] = budget_witnesses
                    no_change(page, baseline)
                elif ident == 'order-capacity-blocked':
                    prepare(page)
                    check('all-or-none batch is blocked by aggregate live order capacity', page.locator('#building-template-batch-apply').is_disabled() and '容量' in page.locator('#building-template-batch-review-summary').inner_text())
                    no_change(page, baseline)
                elif ident == 'active-selection-fixed-payers':
                    page.locator('#planet-select').select_option(fixture['colonyId']); advance(page)
                    prepare(page)
                    page.locator('#building-template-batch-apply').click(); advance(page)
                    expected = fixture['lifecycleVariants']['selected-colony-authorized']['envelope']['state']
                    actual, ref = preserve(page, 'authorized'); whole('top selection cannot redirect any fixed payer or cap', actual, expected); current['afterRaw'] = ref
                    live, ref = export_live(page); whole('fixed-payer authorization matches complete API oracle with colony selected', live, expected); current['afterLiveExport'] = ref
                elif ident == 'single-planet-blocked':
                    prepare(page, [fixture['homeId']], fill=False, review=False)
                    check('one payer cannot fill or review a batch', page.locator('#building-template-batch-fill-quotes').is_disabled() and page.locator('#building-template-batch-review').is_disabled())
                    no_change(page, baseline)
                else:
                    prepare(page); page.evaluate('window.__retainedBatchApply=document.querySelector("#building-template-batch-apply")')
                    current['attemptBeforeRaw'] = dump(ident + '-before-attempt.json', raw(page))
                    if ident == 'cloned-confirm':
                        page.evaluate('const original=window.__retainedBatchApply;const clone=original.cloneNode(true);original.after(clone);clone.click();clone.remove()')
                    elif ident == 'silent-budget-change':
                        page.evaluate('document.querySelector("[data-batch-budget-resource=metal]").value="999";window.__retainedBatchApply.click()')
                    elif ident in ('detached-confirm', 'ancestor-detach-reinsert'):
                        page.evaluate('''ancestor=>{const node=ancestor?document.querySelector('#space-orders'):window.__retainedBatchApply;const parent=node.parentNode,next=node.nextSibling;node.remove();parent.insertBefore(node,next);window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()}''', ident == 'ancestor-detach-reinsert')
                    elif ident == 'tab-away-back':
                        tab(page, 'overview'); panel(page); page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident == 'active-planet-aba':
                        page.locator('#planet-select').select_option(fixture['colonyId']); advance(page)
                        page.locator('#planet-select').select_option(fixture['homeId']); advance(page); panel(page)
                        page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident == 'cancel-review':
                        page.locator('#building-template-batch-cancel-review').click(); advance(page)
                        page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident == 'cancelled-import':
                        import_file(page, fixture_path.parent / 'ready.json', accept=False); panel(page)
                        page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident == 'invalid-import':
                        tab(page, 'save'); page.locator('[data-bind="transfer"]').fill('{invalid-json'); page.locator('[data-action="import-text"]').click(); advance(page); panel(page)
                        page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident in ('template-rename-stale', 'template-delete-stale'):
                        if not page.locator('#building-templates').evaluate('(node)=>node.open'):
                            page.locator('#building-templates > summary').click(); advance(page)
                        action = 'edit' if ident == 'template-rename-stale' else 'delete'
                        page.locator(f'#building-template-library [data-building-template-id="{fixture["templateId"]}"] [data-building-template-action="{action}"]').click(); advance(page)
                        if action == 'edit':
                            page.locator('#building-template-name').fill('已改名双星仓储验收'); page.locator('#building-template-save').click()
                        else:
                            page.locator('#building-template-confirm-delete').click()
                        advance(page)
                        baseline = fixture['lifecycleVariants']['renamed' if action == 'edit' else 'deleted']['envelope']['state']
                        modified, modified_ref = preserve(page, 'template-modified'); whole('real template edit/delete matches complete public API oracle', modified, baseline)
                        current['attemptBeforeRaw'] = modified_ref
                        page.evaluate('window.__retainedBatchApply.disabled=false;window.__retainedBatchApply.click()')
                    elif ident in ('storage-write-failure', 'storage-readback-failure'):
                        page.evaluate('''({key,afterWrite})=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;let armed=false;
                          window.__restoreBatchStorage=()=>{Storage.prototype.getItem=get;Storage.prototype.setItem=set};
                          Storage.prototype.setItem=function(k,v){if(this===localStorage&&k===key){if(!afterWrite)throw new DOMException('explicit test quota','QuotaExceededError');set.call(this,k,v);armed=true;return;}return set.call(this,k,v)};
                          Storage.prototype.getItem=function(k){if(this===localStorage&&k===key&&armed){armed=false;throw new DOMException('explicit test readback','SecurityError')}return get.call(this,k)};}''', {'key': KEY, 'afterWrite': ident == 'storage-readback-failure'})
                        page.locator('#building-template-batch-apply').click(); advance(page); page.evaluate('window.__restoreBatchStorage()')
                        if ident == 'storage-write-failure': raw_unchanged(page, current['attemptBeforeRaw'], 'failed-write')
                        observed, ref = observe_live(page, 'protected-after-write')
                        whole('actual protected in-memory engine remains complete pre-action state', observed['state'], baseline)
                        check('observer reports protected SaveSession and cached original raw', observed['mode'] == 'protected' and observed['protectedRaw'] == (out / current['attemptBeforeRaw']['file']).read_text())
                        disk, ref = preserve(page, 'uncertain-disk'); current['afterRaw'] = ref
                        whole('uncertain disk state is disclosed exactly', disk, fixture['authorized']['state'] if ident == 'storage-readback-failure' else baseline)
                        live, ref = export_live(page); current['afterLiveExport'] = ref; whole('protected cached export retains original complete state', live, baseline)
                        visible_orders = page.locator('#order-list').evaluate('(node)=>({html:node.outerHTML,rows:[...node.querySelectorAll("[data-order-id]")].map(row=>({id:row.dataset.orderId,text:row.textContent}))})')
                        current['protectedVisibleOrders'] = dump(ident + '-protected-visible-orders.json', json.dumps(visible_orders, ensure_ascii=False))
                        check('uncertain candidate orders never become visible', visible_orders['rows'] == [])
                        check('protected batch controls are disabled', page.locator('#building-template-batch button').evaluate_all('(nodes)=>nodes.every(node=>node.disabled)'))
                        finish(context, page); continue
                    elif ident == 'external-storage-protection':
                        foreign = context.new_page(); foreign.goto(args.url, wait_until='networkidle')
                        future = copy.deepcopy(fixture['ready']); future['revision'] = 999
                        future_raw = json.dumps(future, ensure_ascii=False)
                        foreign.evaluate('({key,raw})=>localStorage.setItem(key,raw)', {'key': KEY, 'raw': future_raw})
                        advance(page); disk, ref = preserve(page, 'external-original'); current['afterRaw'] = ref
                        check('external raw bytes remain untouched', raw(page) == future_raw)
                        observed, _ = observe_live(page, 'external-protected')
                        whole('actual external-conflict in-memory engine retains complete source', observed['state'], baseline)
                        check('actual external protection is a conflicted session', observed['mode'] == 'conflict')
                        live, ref = export_live(page); current['afterLiveExport'] = ref; whole('external protection cached export retains source', live, baseline)
                        check('external protection disables all batch actions', page.locator('#building-template-batch button').evaluate_all('(nodes)=>nodes.every(node=>node.disabled)'))
                        foreign.close(); finish(context, page); continue
                    advance(page); no_change(page, baseline)
                finish(context, page)
            check('all fixed scenarios completed once in exact order', [row['id'] for row in report['scenarios']] == list(SCENARIOS) and all(row['completed'] for row in report['scenarios']))
            check('no application exceptions', not report['errors'], report['errors'])
            report['completed'] = True; report['result'] = 'passed'; flush(); browser.close()
    except BaseException as error:
        if 'failure' not in report:
            try:
                # Startup/teardown errors can be recorded, but no page API is
                # usable here. Live failures must never be captured again.
                capture_failure(error, capture_page=False)
            except BaseException:
                pass
        raise
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True); parser.add_argument('--fixture', required=True)
    parser.add_argument('--expected-fixture-sha256', required=True); parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--expected-version', required=True); parser.add_argument('--runtime-node', required=True)
    parser.add_argument('--common-identity', required=True); parser.add_argument('--chromium')
    parser.add_argument('--output', required=True); parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--owner-marker', default='', help=argparse.SUPPRESS)
    args = parser.parse_args()
    assert re.fullmatch('[0-9a-f]{40}', args.expected_sha)
    assert re.fullmatch('[0-9a-f]{64}', args.expected_fixture_sha256)
    return worker(args) if args.worker else supervise(args)


if __name__ == '__main__':
    sys.exit(main())
