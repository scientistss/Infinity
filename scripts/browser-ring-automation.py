"""Bounded-ring acceptance: real HTTP production bundle and native localStorage.

The fixtures are synthetic and pre-funded. Date.now/performance.now/frame timestamps
are deliberately controlled; native animation frames keep running for browser input
and layout. No intercepted app, fake Storage, inline bundle, or fallback is used.
These are deterministic control/budget checks, not natural progression timing claims.
"""
import argparse
import copy
import json
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
parser.add_argument('--fixture', default='ring-automation-review-save.json')
parser.add_argument('--output', default='ring-automation-evidence')
parser.add_argument('--chromium', default=None)
args = parser.parse_args()
fixtures = json.loads(Path(args.fixture).read_text())
KEY = fixtures['key']
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
checks, errors, failed_requests = [], [], []
completed = False
case = 'setup'
active_page = None
last_saved_synthetic_state = None
failure_diagnostics = None
browser = None
EPOCH = int(time.time() * 1000)
MODE = 'HTTP / native localStorage / synthetic controlled simulation timestamps'


def check(name, condition):
    checks.append({'case': case, 'name': name, 'passed': bool(condition), 'classification': MODE})
    if not condition:
        capture_failure(active_page)
        raise AssertionError(f'{case}: {name}')


# Date and performance values advance only when this suite requests it. Native RAF
# scheduling stays intact so Playwright's normal click/focus/visibility checks work.
# A sessionStorage clock marker preserves the exact test instant across real reloads.
CLOCK = r"""(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const saved = sessionStorage.getItem('ring-automation-clock');
  const epoch = saved ? Number(saved) : __EPOCH__;
  let time = 0;
  Date.now = () => epoch + time;
  Object.defineProperty(performance, 'now', {value: () => time});
  window.requestAnimationFrame = callback => raf(() => callback(time));
  window.__ringAdvance = async milliseconds => {
    time += milliseconds;
    sessionStorage.setItem('ring-automation-clock', String(epoch + time));
    await new Promise(raf);
    await new Promise(raf);
  };
  window.__ringNativeStorage = localStorage instanceof Storage &&
    /\[native code\]/.test(Function.prototype.toString.call(Storage.prototype.setItem));
})();""".replace('__EPOCH__', str(EPOCH))


def boot(which='equipped'):
    global active_page
    parsed = urlparse(args.url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError('Acceptance requires a real HTTP(S) server')
    fixture = copy.deepcopy(fixtures[which])
    fixture['savedAt'] = fixture['lastTickAt'] = EPOCH
    values = {KEY: json.dumps(fixture, ensure_ascii=False),
              'infinity.ui.tab': 'arcade', 'infinity.ui.arcadeSkip': '1',
              'infinity.save.v1': 'SYNTHETIC LEGACY BYTES: retain unchanged'}
    context = browser.new_context(
        viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce',
        storage_state={'cookies': [], 'origins': [{
            'origin': f'{parsed.scheme}://{parsed.netloc}',
            'localStorage': [{'name': k, 'value': v} for k, v in values.items()]}]})
    context.add_init_script(CLOCK)
    page = context.new_page()
    active_page = page
    page.set_default_timeout(8000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('requestfailed', lambda request: failed_requests.append(request.url))
    response = page.goto(args.url, wait_until='networkidle')
    check('production page served over actual HTTP', response is not None and response.status == 200)
    expect(page.locator('.ring-visual')).to_be_visible()
    check('native browser Storage backing retained', page.evaluate('window.__ringNativeStorage'))
    return context, page


def advance(page, milliseconds):
    page.evaluate('(ms) => window.__ringAdvance(ms)', milliseconds)


def ring(page):
    modal = page.locator('[data-bind="offline-modal"]')
    if modal.is_visible():
        page.locator('[data-action="dismiss-offline"]').click()
    page.locator('[data-tab="arcade"]').click()
    # On-demand updates are rendered by native frames, with zero simulation delta.
    advance(page, 0)
    expect(page.locator('.ring-visual')).to_be_visible()


def read(page):
    global last_saved_synthetic_state
    last_saved_synthetic_state = json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY))['state']
    return last_saved_synthetic_state


def save(page):
    page.locator('[data-tab="save"]').click()
    page.locator('[data-action="save"]').click()
    state = read(page)
    ring(page)
    return state


def configure(page, count, cap):
    page.locator('#ring-auto-count').fill(str(count))
    page.locator('#ring-auto-cap').fill(str(cap))


def arm(page, count, cap):
    configure(page, count, cap)
    expect(page.locator('[data-ring="auto-arm"]')).to_be_enabled()
    page.locator('[data-ring="auto-arm"]').click()
    expect(page.locator('#ring-auto-status')).to_have_text('已授权本批次')
    return read(page)


def screenshot(page, name):
    page.evaluate('Promise.all([...document.images].filter(i => i.getClientRects().length).map(i => i.decode().catch(() => null)))')
    page.screenshot(path=str(out / name), full_page=True)


def capture_failure(page):
    global failure_diagnostics
    if failure_diagnostics is not None:
        return
    failure_diagnostics = {'case': case, 'lastSavedSyntheticState': last_saved_synthetic_state}
    if page is None:
        return
    try:
        failure_diagnostics['persistedSyntheticStateAtFailure'] = json.loads(page.evaluate('(key) => localStorage.getItem(key)', KEY))['state']
        failure_diagnostics['ui'] = page.evaluate('''() => Object.fromEntries(
            ['#ring-auto-status', '#ring-auto-progress', '#ring-auto-stop-reason',
             '#ring-auto-prerequisite', '[data-bind="status"]', '[data-bind="arcade-runs"]']
            .map(selector => [selector, document.querySelector(selector)?.textContent ?? null]))''')
        failure_diagnostics['clock'] = page.evaluate('''() => ({now: Date.now(),
            performanceNow: performance.now(), marker: sessionStorage.getItem('ring-automation-clock')})''')
    except Exception as error:
        failure_diagnostics['readError'] = str(error)
    try:
        screenshot(page, 'failure.png')
    except Exception as error:
        failure_diagnostics['screenshotError'] = str(error)


@contextmanager
def capture_before_playwright_closes():
    try:
        yield
    except BaseException:
        # Also catches Playwright expect/timeouts, before sync_playwright exits
        # and tears down the browser needed for the screenshot and native reads.
        capture_failure(active_page)
        raise


try:
    with sync_playwright() as playwright, capture_before_playwright_closes():
        executable = args.chromium or shutil.which('google-chrome') or shutil.which('chromium')
        options = {'headless': True, 'args': ['--no-sandbox']}
        if executable:
            options['executable_path'] = executable
        browser = playwright.chromium.launch(**options)

        case = 'locked prerequisites'
        context, page = boot('locked')
        check('manual unlock guidance is visible', '手动开奖 10 次' in page.locator('#ring-auto-prerequisite').inner_text())
        check('unavailable protocol is not automatically equipped', all(slot['card'] is None for slot in read(page)['protocols']['slots']))
        check('locked authorization is disabled', page.locator('[data-ring="auto-arm"]').is_disabled())
        context.close()

        case = 'equip and plain toggle default to no authority'
        context, page = boot('unequipped')
        check('unequipped guidance points to protocols', '装配' in page.locator('#ring-auto-prerequisite').inner_text())
        page.locator('[data-tab="protocol"]').click()
        page.locator('[data-action="equip-card"][data-card="auto_runner"]').click()
        check('actual UI equip leaves runner disabled', read(page)['protocols']['slots'][0]['card']['enabled'] is False)
        expect(page.locator('[data-bind="slot-enabled-0"]')).not_to_be_checked()
        ring(page)
        check('initial count and cap both zero', page.locator('#ring-auto-count').input_value() == '0' and page.locator('#ring-auto-cap').input_value() == '0')
        check('initial authorization remains off', '默认未授权' in page.locator('#ring-auto-status').inner_text())
        check('manual reveal stays first', page.locator('.arcade-side').evaluate('(e) => e.querySelector(".arcade-controls").compareDocumentPosition(e.querySelector(".ring-auto")) & Node.DOCUMENT_POSITION_FOLLOWING'))
        page.locator('[data-tab="protocol"]').click()
        page.locator('[data-bind="slot-enabled-0"]').check()
        ring(page)
        advance(page, 2100)
        before = save(page)
        check('plain toggle cannot authorize or consume a ticket', len(before['arcade']['runs']) == 4 and before['arcade']['stats']['autoRuns'] == 0 and before['arcade']['autoBatch'] is None)
        configure(page, 2, 2000)
        page.locator('[data-ring="auto-arm"]').evaluate('(button) => { button.click(); button.click(); }')
        armed = read(page)
        check('repeated arm captures exactly one bounded prefix', armed['arcade']['autoBatch']['ticketIds'] == [row['id'] for row in before['arcade']['runs'][:2]])
        check('arm persists budget without spending immediately', armed['arcade']['autoBatch']['maxDeuterium'] == '2000' and armed['arcade']['autoBatch']['spentDeuterium'] == '0')
        check('arm frozen bets match explicit current bets', armed['arcade']['autoBatch']['bets'] == before['arcade']['bets'])
        check('armed button cannot reset the budget', page.locator('[data-ring="auto-arm"]').is_disabled())
        advance(page, 1000)
        partial = save(page)
        check('one regular pass completes exactly one ticket', partial['arcade']['autoBatch']['completed'] == 1 and partial['arcade']['autoBatch']['spentDeuterium'] == '1000')
        screenshot(page, 'ring-batch-desktop.png')
        page.locator('[data-ring="auto-stop"]').evaluate('(button) => { button.click(); button.click(); }')
        stopped = read(page)
        check('stop preserves spent amount and disarms runner', stopped['arcade']['autoBatch']['armed'] is False and stopped['arcade']['autoBatch']['spentDeuterium'] == '1000' and stopped['protocols']['slots'][0]['card']['enabled'] is False)
        check('stop reason is visible', len(page.locator('#ring-auto-stop-reason').inner_text()) > 5)
        advance(page, 2000)
        check('stopped batch makes no further progress', save(page)['arcade']['stats']['autoRuns'] == 1)
        rearmed = arm(page, 1, 1000)
        check('explicit rearm uses only remaining current prefix', rearmed['arcade']['autoBatch']['ticketIds'] == [stopped['arcade']['runs'][0]['id']])
        advance(page, 1000)
        finished = save(page)
        check('completed batch stops at requested count', finished['arcade']['autoBatch']['completed'] == 1 and finished['arcade']['autoBatch']['armed'] is False and len(finished['arcade']['runs']) == 2)
        advance(page, 2000)
        check('finished batch cannot silently continue', save(page)['arcade']['stats']['autoRuns'] == 2)
        context.close()

        case = 'fixed source survives planet selection'
        context, page = boot()
        before = read(page)
        armed = arm(page, 1, 1000)
        page.locator('#planet-select').select_option('synthetic-colony')
        check('selection changes current planet without changing authorization source', read(page)['activePlanetId'] == 'synthetic-colony' and read(page)['arcade']['autoBatch']['planetId'] == armed['activePlanetId'])
        check('both current and fixed source are explained', '合成第二星球' in page.locator('#ring-auto-source').inner_text() and '合成固定来源母星' in page.locator('#ring-auto-frozen').inner_text())
        advance(page, 1100)
        after = save(page)
        check('fixed source pays exactly one gross bet', float(after['planets'][0]['resources']['deuterium']) == float(before['planets'][0]['resources']['deuterium']) - 1000)
        check('newly selected planet never pays the old batch', after['planets'][1]['resources']['deuterium'] == before['planets'][1]['resources']['deuterium'])
        check('automatic reveal preserves current UI selection', after['activePlanetId'] == 'synthetic-colony')
        context.close()

        for action in ('edit bet', 'clear bets', 'manual reveal'):
            case = action + ' stops the batch'
            context, page = boot()
            arm(page, 3, 3000)
            if action == 'edit bet':
                page.locator('[data-action="arcade-bet"][data-symbol="metal"][data-delta="1"]').click()
            elif action == 'clear bets':
                page.locator('[data-action="arcade-bet-clear"]').click()
            else:
                page.locator('[data-action="arcade-run"]').click()
            stopped = read(page)
            check('manual action immediately stops authorization', stopped['arcade']['autoBatch']['armed'] is False)
            check('manual stop preserves original frozen bet', stopped['arcade']['autoBatch']['bets']['metal'] == 1)
            advance(page, 2000)
            after = save(page)
            check('manual action cannot leave background auto activity', after['arcade']['stats']['autoRuns'] == 0)
            if action == 'manual reveal':
                check('manual reveal consumes only its own result', len(after['arcade']['runs']) == 3)
            else:
                check('manual bet change consumes no results', len(after['arcade']['runs']) == 4)
            context.close()

        case = 'armed native reload retains gross spending and prefix'
        context, page = boot()
        armed = arm(page, 3, 2000)
        advance(page, 1100)
        partial = save(page)
        check('reload case is genuinely armed and partly spent', partial['arcade']['autoBatch']['armed'] is True and partial['arcade']['autoBatch']['spentDeuterium'] == '1000')
        page.reload(wait_until='networkidle')
        ring(page)
        restored = read(page)
        check('real reload retains exact authorization ledger', restored['arcade']['autoBatch'] == partial['arcade']['autoBatch'])
        check('restored UI displays persisted gross spending', '已扣重氢 1000 / 上限 2000' in page.locator('#ring-auto-progress').inner_text())
        advance(page, 2200)
        ended = save(page)
        check('reload never replenishes budget', ended['arcade']['autoBatch']['spentDeuterium'] == '2000' and ended['arcade']['autoBatch']['completed'] == 2 and ended['arcade']['autoBatch']['armed'] is False)
        check('budget stop preserves unconsumed original tickets', len(ended['arcade']['runs']) == 2 and ended['arcade']['autoBatch']['ticketIds'] == armed['arcade']['autoBatch']['ticketIds'])
        check('budget reason is visible', '上限' in page.locator('#ring-auto-stop-reason').inner_text())
        context.close()

        case = 'zero-cap paid bets and valid zero-bet batch'
        context, page = boot()
        arm(page, 1, 0)
        advance(page, 1100)
        stopped = save(page)
        check('zero budget cannot make an existing paid bet', stopped['arcade']['autoBatch']['spentDeuterium'] == '0' and stopped['arcade']['autoBatch']['completed'] == 0 and len(stopped['arcade']['runs']) == 4)
        page.locator('[data-action="arcade-bet-clear"]').click()
        arm(page, 1, 0)
        advance(page, 1000)
        zero = save(page)
        check('zero-bet explicit batch completes without spending', zero['arcade']['autoBatch']['completed'] == 1 and zero['arcade']['autoBatch']['spentDeuterium'] == '0')
        context.close()

        case = 'tailwind creates a future ticket outside the frozen prefix'
        context, page = boot('tailwind')
        before = read(page)
        armed = arm(page, 2, 2000)
        advance(page, 1100)
        first = save(page)
        new_ids = [row['id'] for row in first['arcade']['runs'] if row['id'] not in armed['arcade']['autoBatch']['ticketIds']]
        check('actual tailwind rule creates a new ticket', len(new_ids) == 1 and first['arcade']['nextRunId'] == before['arcade']['nextRunId'] + 1)
        check('tailwind is revealed through actual rule history', first['arcade']['history'][-1]['symbol'] == 'tailwind')
        check('new ticket is absent from frozen authorization', new_ids[0] not in first['arcade']['autoBatch']['ticketIds'])
        advance(page, 2000)
        finished = save(page)
        check('only original two tickets are consumed', finished['arcade']['autoBatch']['completed'] == 2 and [row['id'] for row in finished['arcade']['runs']] == new_ids)
        check('new reward ticket never inherits previous permission', finished['arcade']['autoBatch']['armed'] is False and finished['arcade']['stats']['autoRuns'] == 2)
        screenshot(page, 'ring-tailwind-exclusion.png')
        context.close()

        case = 'narrow layout and persistent input/focus'
        context, page = boot()
        for width in (320, 390, 768, 1440):
            page.set_viewport_size({'width': width, 'height': 1000})
            configure(page, 2, '1234.50')
            page.locator('#ring-auto-cap').focus()
            page.locator('#ring-auto-cap').evaluate('(e) => { window.__ringCapNode=e; e.setSelectionRange(2,5); }')
            advance(page, 1000)
            check(f'{width}px update retains input node, value, focus and caret', page.locator('#ring-auto-cap').evaluate('(e) => e===window.__ringCapNode && e===document.activeElement && e.value==="1234.50" && e.selectionStart===2 && e.selectionEnd===5'))
            check(f'{width}px authorization controls do not overflow page', page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
            check(f'{width}px manual controls remain visible and enabled', page.locator('[data-action="arcade-run"]').is_visible() and page.locator('[data-action="arcade-run"]').is_enabled())
            if width == 390:
                screenshot(page, 'ring-batch-mobile.png')
        before = save(page)
        page.locator('#ring-odds-source').select_option('charge-3')
        page.locator('[data-tile="23"]').click()
        history = page.locator('[data-ring-history]').last
        history.click()
        page.keyboard.press('Escape')
        check('read-only history closes and restores focus', history.evaluate('(e) => e===document.activeElement'))
        after = save(page)
        check('odds/history inspection leaves batch and all rolls unchanged', all(after['arcade'][field] == before['arcade'][field] for field in ('autoBatch', 'runs', 'seed', 'bets', 'stats')))
        check('legacy storage bytes remain untouched', page.evaluate("localStorage.getItem('infinity.save.v1')") == 'SYNTHETIC LEGACY BYTES: retain unchanged')
        context.close()

        case = 'suite integrity'
        check('no uncaught JavaScript errors', not errors)
        check('no failed production resource requests', not failed_requests)
        completed = True
        browser.close()
        browser = None
finally:
    if not completed:
        capture_failure(active_page)
    report = {'completed': completed, 'mode': MODE, 'url': args.url,
              'fixture': fixtures.get('description'),
              'timing': 'Explicit synthetic Date.now, performance.now and RAF timestamps; native animation frames, browser input, HTTP and localStorage. No natural progression claim.',
              'passed': sum(row['passed'] for row in checks), 'checks': checks,
              'errors': errors, 'failedRequests': failed_requests,
              'failureDiagnostics': failure_diagnostics}
    (out / 'ring-automation-browser-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': completed, 'passed': report['passed'], 'total': len(checks),
                      'failedCase': None if completed else case, 'errors': errors}, ensure_ascii=False))
