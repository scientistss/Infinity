"""Bounded, anonymous native proof of a known bug in unchanged released 6b.
Explicit synthetic reader-valid state; no player data or natural-progression claim.
The browser executes only the original HTTP bundle and genuine fill/click actions.
Date/performance/RAF are controlled, with zero positive advances. No business API
is invoked from the browser. A successful proof is NOT a product safety gate.
"""
import argparse
import ast
import copy
import hashlib
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
import traceback
from urllib.parse import urlparse
import zipfile

BASE = '6b985b88ec6b263a3eeb8f34252525383a9f110f'
RELEASE_HASH = 'c11a121a91fc891fa196bb71b271966884e09a888b50a254820d79218a2b1da7'
CLOCK_HASH = '4e8983032230a4ccb43857b6e5f21aff62435d27b2450ed78b6a7b885666dfe2'
KEY = 'infinity.original-p4.save.v1'
ADDITIONS = {'.github/workflows/merchant-transfer-proof.yml',
             'scripts/merchant-transfer-proof-fixture.ts',
             'scripts/browser-merchant-transfer-proof.py', 'scripts/test_merchant_transfer_proof.py'}
CASES = ['ordinary-control', 'unrepresentable-seller']


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def files_at(root, revision):
    result = {}
    for row in git(root, 'ls-tree', '-r', '-z', revision).split(b'\0'):
        if not row:
            continue
        meta, name = row.split(b'\t', 1)
        mode, kind, blob = meta.decode().split()
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('Unexpected nonordinary source entry')
        result[name.decode()] = {'mode': mode, 'blob': blob}
    return result


def source_binding(proof_root, baseline_root, archive, test_sha):
    if git(proof_root, 'rev-parse', 'HEAD').decode().strip() != test_sha:
        raise ValueError('Proof HEAD differs from exact test identity')
    if git(baseline_root, 'rev-parse', 'HEAD').decode().strip() != BASE:
        raise ValueError('Wrong baseline HEAD')
    for root in (proof_root, baseline_root):
        if git(root, 'status', '--porcelain', '--untracked-files=no'):
            raise ValueError('Tracked source changed')
    old, current = files_at(proof_root, BASE), files_at(proof_root, test_sha)
    if current.keys() - old.keys() != ADDITIONS or old.keys() - current.keys():
        raise ValueError('Exactly four dedicated proof-only additions are required')
    if any(current[name] != identity for name, identity in old.items()):
        raise ValueError('A preexisting source or mode changed')
    rows = {}
    with zipfile.ZipFile(archive) as z:
        names = {name.removeprefix('Infinity/') for name in z.namelist() if not name.endswith('/')}
        if names != set(old):
            raise ValueError('Source archive additions or omissions')
        for name, identity in old.items():
            blob = git(proof_root, 'cat-file', 'blob', identity['blob'])
            if not blob == (baseline_root / name).read_bytes() == (proof_root / name).read_bytes() == z.read('Infinity/' + name):
                raise ValueError('Actual baseline/proof/archive source byte mismatch: ' + name)
            rows[name] = {**identity, 'sha256': digest(blob), 'bytes': len(blob)}
    additions = {}
    for name in sorted(ADDITIONS):
        data = (proof_root / name).read_bytes()
        if data != git(proof_root, 'cat-file', 'blob', current[name]['blob']):
            raise ValueError('Proof script differs from its committed blob: ' + name)
        additions[name] = {**current[name], 'sha256': digest(data), 'bytes': len(data)}
    # The only copied executable addition in the baseline is the fixture itself.
    copied = baseline_root / 'scripts/merchant-transfer-proof-fixture.ts'
    if copied.read_bytes() != (proof_root / 'scripts/merchant-transfer-proof-fixture.ts').read_bytes():
        raise ValueError('Executed fixture is not the exact committed proof fixture')
    return {'codeSourceSha': BASE, 'testSourceSha': test_sha, 'complete': True,
            'sourceArchiveSha256': digest(archive.read_bytes()), 'baselineFiles': rows, 'proofAdditions': additions}


def dist_binding(dist):
    raw = (dist / 'release.json').read_bytes()
    release = json.loads(raw)
    if digest(raw) != RELEASE_HASH or release['sourceSha'] != BASE or len(release['files']) != 62:
        raise ValueError('Fresh production build is not exact known released 6b')
    actual = {str(p.relative_to(dist)): digest(p.read_bytes()) for p in dist.rglob('*') if p.is_file()}
    if set(actual) != set(release['files']) | {'release.json'}:
        raise ValueError('Unexpected missing or added production artifact')
    if any(actual[name] != value for name, value in release['files'].items()):
        raise ValueError('Production resource byte mismatch')
    return {'release': release, 'actualFiles': actual, 'releaseSha256': digest(raw)}


def clock_template(source):
    tree = ast.parse(source)
    node = next(n for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'CLOCK' for t in n.targets))
    value = node.value
    # Extract only the literal from the audited assignment, never execute its module.
    while isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute) and value.func.attr == 'replace':
        value = value.func.value
    clock = ast.literal_eval(value)
    if digest(clock.encode()) != CLOCK_HASH:
        raise ValueError('Audited zero-time native clock helper changed')
    return clock


def differences(a, b, path=''):
    if type(a) is not type(b):
        return [{'path': path, 'before': a, 'after': b}]
    if isinstance(a, dict):
        return [r for k in sorted(a.keys() | b.keys()) for r in differences(a.get(k), b.get(k), path + '/' + k)]
    if isinstance(a, list):
        if len(a) != len(b):
            return [{'path': path, 'before': a, 'after': b}]
        return [r for i, (x, y) in enumerate(zip(a, b)) for r in differences(x, y, path + '/' + str(i))]
    return [] if a == b else [{'path': path, 'before': a, 'after': b}]


def expected_envelope(before, case):
    """Literal independent oracle: never production trade() or float arithmetic."""
    if case not in CASES:
        raise ValueError('Unknown case')
    expected = copy.deepcopy(before)
    planet = expected['state']['planets'][0]
    if planet['id'] != 'homeworld' or len(expected['state']['planets']) != 1:
        raise ValueError('Unexpected fixture planets')
    before_metal = '100000' if case == 'ordinary-control' else '1e+100'
    if planet['resources'] != {'metal': before_metal, 'crystal': '0', 'deuterium': '0'}:
        raise ValueError('Wrong source wallet')
    offer = expected['state']['deepSpace']['offers'][0]
    if offer != {'id': 'merchant-1', 'planetId': 'homeworld', 'startsAt': 0, 'expiresAt': 600,
                 'ratios': {'metal': 3, 'crystal': 2, 'deuterium': 1}, 'remainingMe': '200000'}:
        raise ValueError('Wrong original offer')
    planet['resources']['metal'] = '99000' if case == 'ordinary-control' else '1e+100'
    planet['resources']['crystal'] = '646'
    offer['remainingMe'] = '199000'
    return expected


class CleanupDeadlineExceeded(BaseException):
    """Interrupt even cleanup libraries that catch ordinary Exception."""


def cleanup_native(resources, budget_seconds=10):
    """One bounded cleanup phase for this proof, with each owned resource recorded."""
    if not 0 <= budget_seconds <= 10:
        raise ValueError('Cleanup budget must be within ten seconds')
    started = time.monotonic()
    deadline = started + budget_seconds
    witness = {'budgetSeconds': budget_seconds, 'completed': False, 'deadlineExceeded': False,
               'resources': [], 'errors': []}
    previous_handler = signal.getsignal(signal.SIGALRM)

    def expired(*_):
        raise CleanupDeadlineExceeded('Native cleanup deadline exceeded')

    signal.signal(signal.SIGALRM, expired)
    # Replace the body timer directly; never leave an unbounded cleanup interval.
    if budget_seconds > 0:
        signal.setitimer(signal.ITIMER_REAL, budget_seconds)
    try:
        for name, resource, method in resources:
            row = {'resource': name, 'method': method, 'status': 'not-attempted'}
            witness['resources'].append(row)
            if resource is None:
                row['status'] = 'not-active'
                continue
            if witness['deadlineExceeded'] or time.monotonic() >= deadline:
                witness['deadlineExceeded'] = True
                continue
            operation_started = time.monotonic()
            row['status'] = 'running'
            try:
                getattr(resource, method)()
                row['status'] = 'closed'
            except CleanupDeadlineExceeded as error:
                row['status'] = 'timed-out'
                witness['deadlineExceeded'] = True
                witness['errors'].append({'resource': name, 'error': repr(error)})
            except BaseException as error:
                row['status'] = 'failed'
                witness['errors'].append({'resource': name, 'error': repr(error)})
            finally:
                row['hostElapsedSeconds'] = time.monotonic() - operation_started
    except CleanupDeadlineExceeded as error:
        witness['deadlineExceeded'] = True
        witness['errors'].append({'resource': 'cleanup phase', 'error': repr(error)})
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
    witness['hostElapsedSeconds'] = time.monotonic() - started
    witness['completed'] = (len(witness['resources']) == len(resources)
                            and all(row['status'] in ('closed', 'not-active') for row in witness['resources'])
                            and not witness['errors'] and not witness['deadlineExceeded']
                            and witness['hostElapsedSeconds'] <= budget_seconds)
    return witness


def native_completion_allowed(report):
    """Completion requires successful native behavior AND bounded full cleanup."""
    cleanup = report.get('cleanup', {})
    return (report.get('nativeBodyCompleted') is True and report.get('knownBugConfirmed') is True
            and cleanup.get('completed') is True and cleanup.get('deadlineExceeded') is False
            and report.get('cleanupErrors') == [] and cleanup.get('errors') == []
            and len(cleanup.get('resources', [])) == 5
            and all(row.get('status') in ('closed', 'not-active') for row in cleanup['resources'])
            and 0 <= cleanup.get('hostElapsedSeconds', -1) <= cleanup.get('budgetSeconds', -1) <= 10
            and 0 <= report.get('nativeBrowserElapsedSeconds', -1) <= 150
            and 0 <= report.get('nativeLifecycleElapsedSeconds', -1) <= 160)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('proof-root', 'baseline-root', 'source-archive', 'fixture', 'dist', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--expected-test-sha', required=True)
    parser.add_argument('--chromium', required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(exist_ok=False)
    started = time.monotonic()
    report = {'schema': 'infinity-merchant-native-counterexample-v1', 'completed': False,
              'nativeCompleted': False, 'nativeBodyCompleted': False, 'knownBugConfirmed': False, 'productSafetyGate': False,
              'codeSourceSha': BASE, 'testSourceSha': args.expected_test_sha,
              'classification': 'Anonymous explicitly synthetic current-reader-valid state. Fresh GitHub runner Chrome; actual HTTP/V8/native storage and trusted fill/click. Controlled Date/performance/RAF, zero positive advances. Not natural play or the user computer.',
              'runIdentity': {k: os.environ.get(k) for k in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_REF')},
              'checks': [], 'cases': [], 'saveFiles': [], 'errors': [], 'network': []}

    def write(name, value):
        data = value if isinstance(value, bytes) else (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
        (out / name).write_bytes(data)
        return {'file': name, 'sha256': digest(data), 'bytes': len(data)}

    def flush():
        report['hostElapsedSeconds'] = time.monotonic() - started
        write('report.json', report)

    def check(name, ok, detail=None):
        report['checks'].append({'name': name, 'passed': bool(ok), 'detail': detail})
        flush()
        if not ok:
            raise AssertionError(name)

    def save_raw(label, raw):
        check(label + ': full actual envelope available', isinstance(raw, str) and json.loads(raw)['schema'] == 'infinity-original-p4')
        entry = write(label + '.save.json', raw)
        report['saveFiles'].append(entry)
        flush()
        return json.loads(raw)

    def snapshot(page, label):
        value = page.evaluate('''(key)=>({raw:localStorage.getItem(key),storage:Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])),
            witness:window.__merchantWitness,clicks:window.__npcClicks,edits:window.__npcEdits,clock:Date.now(),performance:performance.now(),dom:document.documentElement.outerHTML})''', KEY)
        write(label + '.json', value)
        return value

    def advance(page):
        observed = page.evaluate('window.__npcAdvance(0)')
        check('Zero-time presentation frame only', observed['beforeAt'] == observed['afterAt'] == fixture['epoch'], observed)

    def click(page, selector, label):
        count = page.evaluate('window.__npcClicks.length')
        page.locator(selector).click()
        advance(page)
        events = page.evaluate('(n)=>window.__npcClicks.slice(n)', count)
        write(label + '-click.json', events)
        check(label + ': exactly one genuine trusted click', len(events) == 1 and events[0]['trusted'], events)

    def manual_save(page, label):
        click(page, '[data-tab="save"]', label + '-tab')
        click(page, '[data-action="save"]', label + '-button')
        value = snapshot(page, label)
        return save_raw(label, value['raw'])

    server = browser = context = page = pw = None
    browser_started = None
    try:
        if os.environ.get('GITHUB_ACTIONS') != 'true':
            raise RuntimeError('Native browser proof is CI-only; do not run on a local computer')
        source = source_binding(args.proof_root, args.baseline_root, args.source_archive, args.expected_test_sha)
        build = dist_binding(args.dist)
        report['sourceBinding'] = write('source-binding.json', source)
        report['distBinding'] = write('dist-binding.json', build)
        fixture_raw = args.fixture.read_bytes()
        fixture = json.loads(fixture_raw)
        write('original-fixture.json', fixture_raw)
        check('Pinned anonymous source fixture identity', fixture['codeSourceSha'] == BASE and [c['case'] for c in fixture['cases']] == CASES)
        clock = clock_template((args.baseline_root / 'scripts/browser-npc-attack.py').read_text())
        write('audited-clock-template.js', clock)
        source_paths = ['src/game/merchant.ts', 'src/game/save.ts', 'src/game/save-session.ts', 'src/ui/deep-panel.ts', 'src/main.ts']
        for name in source_paths:
            write('source-' + name.replace('/', '--'), (args.baseline_root / name).read_bytes())
        dist = args.dist.resolve()
        release = build['release']

        class Server(http.server.ThreadingHTTPServer):
            daemon_threads = True

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, fmt, *values):
                report['network'].append({'path': self.path, 'message': fmt % values})

            def translate_path(self, path):
                clean = urlparse(path).path.removeprefix('/Infinity/').lstrip('/')
                target = (dist / clean).resolve()
                if not target.is_relative_to(dist):
                    return str(dist / '__not_found__')
                return str(target)

        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('150-second native browser proof deadline')))
        signal.alarm(150)
        browser_started = time.monotonic()
        server = Server(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = 'http://127.0.0.1:' + str(server.server_port)
        url = origin + '/Infinity/'
        clock = clock.replace('__ORIGIN__', json.dumps(origin)).replace('__KEY__', json.dumps(KEY)).replace('__EPOCH__', str(fixture['epoch']))
        observer = r'''
window.__merchantWitness={seedBeforeApp:localStorage.getItem(__KEY__),trades:[]};
document.addEventListener('click',e=>{if(!e.target.closest?.('#deep-trade'))return;
 window.__merchantWitness.trades.push({trusted:e.isTrusted,amount:document.querySelector('#deep-amount').value,
 sell:document.querySelector('#deep-sell').value,buy:document.querySelector('#deep-buy').value,offer:document.querySelector('#deep-offer').value,
 beforeRaw:localStorage.getItem(__KEY__),clock:Date.now()});},true);
document.addEventListener('click',e=>{if(!e.target.closest?.('#deep-trade'))return;
 const row=window.__merchantWitness.trades.at(-1);row.bubbleTrusted=e.isTrusted;row.afterRaw=localStorage.getItem(__KEY__);row.afterClock=Date.now();},false);
'''.replace('__KEY__', json.dumps(KEY))
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = pw.chromium.launch(executable_path=args.chromium, headless=True)
        report['environment'] = {'origin': origin, 'url': url, 'browserBinary': args.chromium,
                                 'binaryVersion': subprocess.check_output([args.chromium, '--version'], text=True).strip(),
                                 'playwrightBrowserVersion': browser.version, 'positiveClockAdvances': 0,
                                 'clockEpoch': fixture['epoch'], 'clockTemplateSha256': CLOCK_HASH}
        flush()
        for fixture_case in fixture['cases']:
            label = fixture_case['case']
            row = {'case': label, 'completed': False}
            report['cases'].append(row)
            initial_raw = fixture_case['raw']
            check(label + ': exact original raw hash and reader preflight', digest(initial_raw.encode()) == fixture_case['originalSha256'] and fixture_case['readerAccepted'] is True)
            original = save_raw(label + '-original', initial_raw)
            entries = [{'name': KEY, 'value': initial_raw}, {'name': 'infinity.ui.tab', 'value': 'overview'}]
            context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce',
                                          storage_state={'cookies': [], 'origins': [{'origin': origin, 'localStorage': entries}]})
            storage = context.storage_state()
            write(label + '-storage-seed-readback.json', storage)
            check(label + ': anonymous exact storage seed', storage['cookies'] == [] and len(storage['origins']) == 1
                  and storage['origins'][0]['origin'] == origin and {e['name']: e['value'] for e in storage['origins'][0]['localStorage']} == {e['name']: e['value'] for e in entries})
            context.add_init_script(clock + observer)
            page = context.new_page()
            page.set_default_timeout(8000)
            page.set_default_navigation_timeout(15000)
            page.on('pageerror', lambda error: report['errors'].append(str(error)))
            responses, executed = [], []
            page.on('response', lambda response: responses.append(response) if response.request.resource_type in ('script', 'stylesheet') else None)
            cdp = context.new_cdp_session(page)
            cdp.send('Network.enable')
            cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            cdp.on('Debugger.scriptParsed', lambda event: executed.append(event) if event.get('url', '').startswith(origin) else None)
            cdp.send('Debugger.enable')
            response = page.goto(url, wait_until='networkidle')
            advance(page)
            boot = snapshot(page, label + '-boot')
            check(label + ': pre-app original bytes retained', boot['witness']['seedBeforeApp'] == initial_raw)
            check(label + ': unwrapped native storage/File/confirm/timers retained', page.evaluate('window.__npcNative'))
            check(label + ': exact original HTTP document', response.status == 200 and response.url == url and digest(response.body()) == release['files']['index.html'])
            fetched = page.request.get(url + 'release.json')
            check(label + ': pinned actual HTTP release', fetched.status == 200 and fetched.url == url + 'release.json' and digest(fetched.body()) == RELEASE_HASH)
            if label == 'ordinary-control':
                resources = []
                for name, expected_hash in release['files'].items():
                    fetched = page.request.get(url + name)
                    evidence = {'resource': name, 'url': fetched.url, 'status': fetched.status, 'sha256': digest(fetched.body()), 'expected': expected_hash}
                    resources.append(evidence)
                    write('complete-62-http-resources.json', resources)
                    check('Exact released HTTP resource: ' + name, fetched.status == 200 and fetched.url == url + name and evidence['sha256'] == expected_hash, evidence)
            bodies, http_rows, v8_rows = {}, [], []
            for asset in responses:
                body = asset.body()
                bodies[asset.url] = body
                entry = {'url': asset.url, 'status': asset.status, 'kind': asset.request.resource_type, 'sha256': digest(body), 'releaseSha256': release['files'].get(asset.url.removeprefix(url))}
                http_rows.append(entry)
                write(label + '-http-assets.json', http_rows)
                check(label + ': full HTTP JS/CSS equals released bytes', asset.status == 200 and asset.url == asset.request.url and entry['sha256'] == entry['releaseSha256'], entry)
            for event in executed:
                text = cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                entry = {'url': event['url'], 'scriptId': event['scriptId'], 'executedSha256': digest(text.encode()),
                         'httpSha256': digest(bodies[event['url']]), 'releaseSha256': release['files'].get(event['url'].removeprefix(url))}
                v8_rows.append(entry)
                write(label + '-v8-source.json', v8_rows)
                check(label + ': exact V8 executed source equals HTTP and release', entry['executedSha256'] == entry['httpSha256'] == entry['releaseSha256'], entry)
            check(label + ': actual JS/CSS and V8 observed', bool(v8_rows) and {'script', 'stylesheet'} <= {e['kind'] for e in http_rows})
            cdp.send('Debugger.disable')
            before = manual_save(page, label + '-before')
            startup = fixture_case['startup']
            write(label + '-complete-startup-oracle.json', startup)
            startup_differences = differences(original, before)
            write(label + '-original-to-adopted-differences.json', startup_differences)
            check(label + ': actual first save equals whole original 6b SaveSession/catchUp(0) adopted outcome',
                  before == startup['expectedFirstSaveEnvelope'] == startup['sessionAdoptedEnvelope'] == startup['catchUpEnvelope'],
                  differences(startup['expectedFirstSaveEnvelope'], before))
            check(label + ': every original-to-adopted change is independently accounted, including achievements and dark matter',
                  startup_differences == startup['originalToAdoptedDifferences'], startup_differences)
            click(page, '[data-tab="deep"]', label + '-deep-tab')
            field = page.locator('#deep-amount')
            edit_count = page.evaluate('window.__npcEdits.length')
            field.fill('')
            field.fill('1000')
            field.press('Tab')
            advance(page)
            edits = page.evaluate('(n)=>window.__npcEdits.slice(n)', edit_count)
            write(label + '-native-edits.json', edits)
            check(label + ': trusted native amount entry', field.input_value() == '1000' and any(e['id'] == 'deep-amount' and e['type'] == 'input' and e['trusted'] and e['value'] == '1000' for e in edits), edits)
            controls = page.evaluate('''()=>({amount:document.querySelector('#deep-amount').value,offer:document.querySelector('#deep-offer').value,
                sell:document.querySelector('#deep-sell').value,buy:document.querySelector('#deep-buy').value,
                disabled:document.querySelector('#deep-trade').disabled,quote:document.querySelector('#deep-trade-quote').textContent})''')
            check(label + ': actual visible controls quote valid 1000-to-646 trade', controls['amount'] == '1000' and controls['offer'] == 'merchant-1'
                  and controls['sell'] == 'metal' and controls['buy'] == 'crystal' and controls['disabled'] is False and '646' in controls['quote'], controls)
            immediate_before = snapshot(page, label + '-immediate-before')
            check(label + ': native typing did not alter saved game', json.loads(immediate_before['raw']) == before)
            page.locator('#deep-trade').scroll_into_view_if_needed()
            page.screenshot(path=str(out / (label + '-before.png')), caret='initial')
            click(page, '#deep-trade', label + '-confirm-trade')
            immediate_after = snapshot(page, label + '-immediate-after')
            after = save_raw(label + '-after', immediate_after['raw'])
            page.screenshot(path=str(out / (label + '-after.png')), caret='initial')
            expected = expected_envelope(before, label)
            delta = differences(before, after)
            write(label + '-whole-envelope-diff.json', delta)
            write(label + '-independent-expected.json', expected)
            check(label + ': whole actual persisted envelope equals independent literal outcome, without exclusions', after == expected, differences(expected, after))
            witnesses = immediate_after['witness']['trades']
            check(label + ': exactly one trusted confirmation with synchronous native persistence', len(witnesses) == 1 and witnesses[0]['trusted']
                  and witnesses[0]['bubbleTrusted'] and {k: witnesses[0][k] for k in ('amount', 'sell', 'buy', 'offer')} == fixture_case['action']
                  and json.loads(witnesses[0]['beforeRaw']) == before and json.loads(witnesses[0]['afterRaw']) == after
                  and witnesses[0]['clock'] == witnesses[0]['afterClock'] == fixture['epoch'], witnesses)
            again = manual_save(page, label + '-manual-after')
            check(label + ': actual manual save preserves entire transaction', again == expected)
            page.reload(wait_until='networkidle')
            advance(page)
            reloaded = manual_save(page, label + '-reload-after')
            check(label + ': native reader reload retains whole outcome', reloaded == expected, differences(expected, reloaded))
            row.update({'completed': True, 'originalSha256': digest(initial_raw.encode()), 'startupDifferences': startup_differences, 'beforeWallet': before['state']['planets'][0]['resources'],
                        'afterWallet': after['state']['planets'][0]['resources'], 'beforeQuota': '200000', 'afterQuota': '199000',
                        'controls': controls, 'wholeEnvelopeDifferences': delta, 'trustedTradeWitness': witnesses,
                        'gameSecondsElapsed': '0', 'rngAndIdsUnchanged': True,
                        'outcome': 'ordinary 1000 metal debit, 646 crystal credit' if label == 'ordinary-control' else 'known bug: zero canonical metal debit, 646 crystal credit, 1000 quota debit'})
            flush()
            context.close()
            context = page = None
        check('Both focused native cases completed', [c['case'] for c in report['cases']] == CASES and all(c['completed'] for c in report['cases']))
        check('Exactly ten complete original and actual saved envelopes preserved', len(report['saveFiles']) == 10)
        check('No application errors', not report['errors'], report['errors'])
        check('Production files remain exact after native run', dist_binding(args.dist) == build)
        check('Original fixture bytes remain unchanged', args.fixture.read_bytes() == fixture_raw)
        report['nativeBrowserElapsedSeconds'] = time.monotonic() - browser_started
        report['nativeBodyCompleted'] = True
        report['knownBugConfirmed'] = True
        report['outcome'] = 'Native known-bug evidence complete; exact production-reader acceptance of every saved byte still required.'
        flush()
    except BaseException as error:
        report['failure'] = {'error': repr(error), 'traceback': traceback.format_exc()}
        if page is not None and browser_started is not None and time.monotonic() - browser_started < 150:
            try:
                snapshot(page, 'failure-live')
                page.screenshot(path=str(out / 'failure-live.png'), caret='initial', timeout=5000)
            except BaseException as capture_error:
                report['failure']['captureError'] = repr(capture_error)
        flush()
        raise
    finally:
        remaining_lifecycle = 160 - (time.monotonic() - browser_started) if browser_started is not None else 10
        cleanup_budget = max(0, min(10, remaining_lifecycle))
        resources = [('context', context, 'close'), ('browser', browser, 'close'),
                     ('server', server, 'shutdown'), ('server socket', server, 'server_close'), ('playwright', pw, 'stop')]
        try:
            report['cleanup'] = cleanup_native(resources, cleanup_budget)
        except BaseException as cleanup_error:
            report['cleanup'] = {'completed': False, 'budgetSeconds': cleanup_budget, 'resources': [],
                                 'errors': [{'resource': 'cleanup phase', 'error': repr(cleanup_error)}]}
        report['cleanupErrors'] = report['cleanup']['errors']
        if browser_started is not None:
            report['nativeLifecycleElapsedSeconds'] = time.monotonic() - browser_started
        report['nativeCompleted'] = native_completion_allowed(report)
        if not report['nativeCompleted']:
            report['completed'] = False
        write('cleanup-witness.json', report['cleanup'])
        flush()
        if not report['cleanup']['completed'] or remaining_lifecycle < 0:
            raise RuntimeError('Native cleanup incomplete, failed, or exceeded its bounded lifecycle; proof cannot complete')
    if not report['nativeCompleted']:
        raise RuntimeError('Native lifecycle completion requirements not satisfied')
    print(json.dumps({'nativeCompleted': report['nativeCompleted'], 'completed': report['completed'], 'knownBugConfirmed': report['knownBugConfirmed'], 'productSafetyGate': False}))


if __name__ == '__main__':
    main()
