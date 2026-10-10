"""Bounded Chromium before/after regression of the real building-template panel.

Isolated synthetic component harness, not production-app or SaveSession acceptance.
The reconstructed pre-repair candidate MUST exhibit its known unsafe actions.
Expected-vulnerable baseline checks never classify that implementation as secure.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.parse import urljoin, urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4177/')
parser.add_argument('--output', default='building-authority-evidence')
parser.add_argument('--chromium')
parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
report_path = out / 'building-authority-browser-report.json'
report = {'completed': False, 'classification': 'isolated synthetic component browser regression',
          'notEstablished': ['whole-app acceptance', 'SaveSession protection/recovery', 'historical execution of released code'],
          'url': args.url, 'checks': [], 'cases': [], 'errors': []}
scenario = variant = 'setup'


def persist():
    temporary = report_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(report_path)


def check(name, condition):
    report['checks'].append({'variant': variant, 'case': scenario, 'name': name, 'passed': bool(condition)})
    persist()
    if not condition:
        raise AssertionError(f'{variant}/{scenario}: {name}')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def snapshot(page):
    return page.evaluate('window.__buildingAuthority.snapshot()')


def retain(page, selector):
    page.evaluate('(s)=>window.__buildingAuthority.retain(s)', selector)


def review(page):
    page.locator('[data-building-template-action="select"]').click()
    page.locator('#building-template-payer').select_option('homeworld')
    page.locator('#building-template-review').click()
    check('explicit review grants original confirm authority', not page.locator('#building-template-confirm-apply').is_disabled())
    retain(page, '#building-template-confirm-apply')


# expectedBeforeUnsafe is deliberately separate from checks passing. Zero before
# means a legitimate-path control that should already reject stale confirmation.
CASES = [
    ('order-aba', 1, 'Real domain paused -> running -> paused while details folded; no full panel update'),
    ('template-edit-aba', 0, 'Real edit twice restores intent while revisions increase 1 -> 2 -> 3'),
    ('template-snapshot-replay', 1, 'Real edit followed by explicitly synthetic old-state replay'),
    ('payer-aba', 1, 'Synthetic payer select value A -> B -> A with observe but no input/change events'),
    ('payer-native-change', 0, 'Native select change A -> B -> A retires review in both versions'),
    ('protected-review', 1, 'Synthetic writable observation true -> false -> true; old apply confirmation'),
    ('protected-editor', 1, 'Synthetic writable observation true -> false -> true; old editor save'),
    ('protected-delete', 1, 'Synthetic writable observation true -> false -> true; old delete confirmation'),
    ('detached-editor', 1, 'Same editor detached/reinserted then synthetic no-submitter submit'),
    ('detached-panel', 1, 'Entire original panel detached/reinserted then old confirm replayed'),
    ('normal-enter', 0, 'Native keyboard Enter must create exactly once using the actual Save submitter'),
]


def worker():
    global variant, scenario
    # Import and launch only in the watchdog-supervised child. Preparation and
    # syntax checking need neither Playwright nor a browser.
    from playwright.sync_api import sync_playwright
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('An actual HTTP(S) component server is required')
    base = args.url.rstrip('/') + '/'
    browser = page = None
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(executable_path=args.chromium or shutil.which('google-chrome') or shutil.which('chromium'),
                                                 headless=True, args=['--no-sandbox'], timeout=20000)
            report['browserVersion'] = browser.version
            context = browser.new_context(viewport={'width': 1100, 'height': 1000})
            response = context.request.get(urljoin(base, 'provenance.json'), timeout=10000)
            check('generated source provenance served over HTTP 200', response.status == 200)
            raw = response.body(); provenance = json.loads(raw)
            (out / 'provenance.json').write_bytes(raw)
            report['provenanceSha256'] = digest(raw)
            report['sourceCommit'] = provenance['sourceCommit']
            # Verify served bytes actually match the audited build, not just a
            # matching source manifest beside a stale or unrelated component.
            for variant in ('before', 'after'):
                for item in provenance['variants'][variant]['files']:
                    response = context.request.get(urljoin(base, f"{variant}/{item['path']}"), timeout=10000)
                    check('served artifact matches build hash: ' + item['path'], response.status == 200 and digest(response.body()) == item['sha256'])
                for scenario, expected_before, description in CASES:
                    page = context.new_page(); page.set_default_timeout(5000)
                    scripts = []
                    page.on('response', lambda response: scripts.append(response) if response.request.resource_type == 'script' else None)
                    page.on('pageerror', lambda error: report['errors'].append(str(error)))
                    page.on('requestfailed', lambda request: report['errors'].append(request.url))
                    response = page.goto(urljoin(base, f'{variant}/?case={scenario}'), wait_until='networkidle', timeout=10000)
                    check('real HTTP component page loaded', response is not None and response.status == 200)
                    page.wait_for_function('window.__buildingAuthority !== undefined', timeout=5000)
                    component_hash = next(item['sha256'] for item in provenance['variants'][variant]['files'] if item['path'] == 'component.js')
                    check('actual executed component script matches recorded build', len(scripts) == 1 and scripts[0].status == 200 and digest(scripts[0].body()) == component_hash)
                    if scenario in ('normal-enter', 'detached-editor', 'protected-editor'):
                        page.locator('#building-template-new').click()
                        page.locator('#building-template-name').fill('Native Enter fixture')
                        if scenario == 'protected-editor': retain(page, '#building-template-save')
                    elif scenario == 'protected-delete':
                        page.locator('[data-building-template-action="delete"]').click()
                        retain(page, '#building-template-confirm-delete')
                    else:
                        review(page)
                    before = snapshot(page)
                    at_attempt = before
                    replay = None
                    if scenario == 'normal-enter':
                        page.locator('#building-template-name').press('Enter')
                    elif scenario == 'detached-editor':
                        page.evaluate('window.__buildingAuthority.detachEditor()')
                    elif scenario == 'detached-panel':
                        replay = page.evaluate('window.__buildingAuthority.detachPanel()')
                    elif scenario == 'payer-native-change':
                        page.locator('#building-template-payer').select_option('authority-colony')
                        page.locator('#building-template-payer').select_option('homeworld')
                        at_attempt = snapshot(page)
                        replay = page.evaluate('window.__buildingAuthority.replay()')
                    else:
                        page.evaluate('window.__buildingAuthority.transition()')
                        at_attempt = snapshot(page)
                        replay = page.evaluate('window.__buildingAuthority.replay()')
                    after = snapshot(page)
                    # Save complete synthetic inputs, observations and resulting
                    # domain actions before asserting, including on failures.
                    evidence_name = f'{variant}-{scenario}.json'
                    evidence = {'description': description, 'before': before, 'atAttempt': at_attempt, 'after': after, 'replay': replay,
                                'executedScriptSha256': component_hash}
                    raw = (json.dumps(evidence, ensure_ascii=False, indent=2) + '\n').encode()
                    (out / evidence_name).write_bytes(raw)
                    emitted = len(after['actions']) - len(before['actions'])
                    accepted = sum(action['ok'] for action in after['actions'][len(before['actions']):])
                    normal = scenario == 'normal-enter'
                    expected = 1 if normal else expected_before if variant == 'before' else 0
                    row = {'variant': variant, 'case': scenario, 'description': description,
                           'classification': 'legitimate native control' if normal else 'expected-vulnerable reconstructed baseline' if variant == 'before' and expected_before else 'stale action must be denied',
                           'expectedEmittedActions': expected, 'emittedActions': emitted, 'domainAcceptedActions': accepted,
                           'unsafeActionCount': 0 if normal else emitted,
                           'evidenceFile': evidence_name, 'evidenceSha256': digest(raw)}
                    report['cases'].append(row); persist()
                    check('exact expected action count (baseline is expected vulnerable)', emitted == expected)
                    check('actual domain result matches expected mutation count', accepted == expected)
                    if expected == 0:
                        check('denied old control leaves complete domain state unchanged', after['state'] == at_attempt['state'])
                    if normal:
                        check('genuine Enter supplies trusted Save submitter', after['submissions'] == [{'trusted': True, 'submitter': 'building-template-save'}])
                        check('normal create stores intended template once', len(after['state']['buildingTemplates']['templates']) == len(before['state']['buildingTemplates']['templates']) + 1)
                    if scenario == 'order-aba':
                        observed = after['observations']
                        statuses = [item['state']['orders']['tasks'][0]['status'] for item in observed]
                        check('intermediate real running state was observed while folded', statuses == ['paused', 'running', 'paused'] and all(item['folded'] for item in observed))
                        check('semantic A differs from B and returns to A', observed[0]['authorityKey'] != observed[1]['authorityKey'] and observed[0]['authorityKey'] == observed[2]['authorityKey'])
                        check('intermediate observation actually retires fixed review', observed[1]['reviewHidden'] == (variant == 'after') and observed[1]['confirmDisabled'] == (variant == 'after'))
                    if scenario == 'template-edit-aba':
                        check('real edits monotonically increase revisions', [item['state']['buildingTemplates']['templates'][0]['revision'] for item in after['observations']] == [1, 2, 3])
                    check('no JavaScript or network errors', not report['errors'])
                    page.close(); page = None
            context.close()
            report['beforeUnsafeActionCount'] = sum(row['unsafeActionCount'] for row in report['cases'] if row['variant'] == 'before')
            report['afterUnsafeActionCount'] = sum(row['unsafeActionCount'] for row in report['cases'] if row['variant'] == 'after')
            check('known unsafe original behavior is preserved, fixed stale actions are zero', report['beforeUnsafeActionCount'] == sum(item[1] for item in CASES) and report['afterUnsafeActionCount'] == 0)
            report['completed'] = True
        except BaseException as error:
            report.update(error=repr(error), traceback=traceback.format_exc(), failedVariant=variant, failedCase=scenario)
            persist()
            if page is not None:
                try: page.screenshot(path=str(out / 'failure.png'), full_page=True, timeout=2000)
                except Exception: pass
            raise
        finally:
            persist()
            if browser is not None: browser.close()


if args.worker:
    worker()
else:
    persist()
    # Independent wall-time limit covers stuck protocol calls as well as launch.
    # Playwright detaches Chromium into another process group. Track only this
    # worker's actual descendants by Linux PID/start time; never kill by name.
    owned = {}

    def identity(pid):
        try:
            return Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()[19]
        except (OSError, IndexError):
            return None

    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid); birth = identity(pid)
            if birth is None or (pid in owned and owned[pid] != birth):
                continue
            owned[pid] = birth
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass

    def terminate_owned(process, sig):
        for pid, birth in reversed(list(owned.items())):
            if identity(pid) == birth:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        # Guard the group fallback against PID reuse after the worker exits.
        if identity(process.pid) == owned.get(process.pid) and process.pid in owned:
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass

    expired, code = False, 1
    with (out / 'worker.log').open('w') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'],
                                   stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.monotonic() + 150
        try:
            while True:
                collect(process.pid)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    expired = True
                    break
                try:
                    code = process.wait(timeout=min(.25, remaining))
                    break
                except subprocess.TimeoutExpired:
                    pass
        finally:
            collect(process.pid)
            terminate_owned(process, signal.SIGTERM)
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
            time.sleep(.1)
            terminate_owned(process, signal.SIGKILL)
            process.wait(timeout=2)
    report = json.loads(report_path.read_text())
    if expired:
        report.update(completed=False, error='Independent watchdog expired', timeoutSeconds=150)
        code = 1
    if code:
        report['completed'] = False
    report['workerExitCode'] = code
    report['processCleanup'] = 'Worker session and PID/start-time-verified descendants targeted; unrelated processes untouched.'
    persist()
    print(json.dumps({'completed': report['completed'], 'beforeUnsafeActionCount': report.get('beforeUnsafeActionCount'),
                      'afterUnsafeActionCount': report.get('afterUnsafeActionCount'), 'workerExitCode': code,
                      'report': str(report_path)}))
    sys.exit(code if code else (0 if report.get('completed') else 1))
