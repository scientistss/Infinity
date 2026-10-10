#!/usr/bin/env python3
"""Read-only Chrome CPU attribution of the exact published c7 production bundle.

Run from this branch AFTER building a clean git archive of TARGET_SHA, generating
its two existing fixtures, and serving its dist at a real /Infinity/ HTTP URL:
  xvfb-run -a python scripts/profile-fleet-dom.py --dist /tmp/c7/dist \
    --fixture /tmp/combined.json --moderate-fixture /tmp/moderate.json
The workflow supplies this setup. --self-test is stdlib-only and needs no browser.
This is an attribution experiment, never a before/after speedup benchmark.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import signal
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

TARGET_SHA = 'c7b8217bfcd63b0fc13264383be93476e5989a78'
# Independently checked against the published green c7 artifact, not generated
# from the profiling branch. A mislabeled/modified build must fail closed.
TARGET_JS = {'assets/index-n541njFN.js': '1f6694d67ccf2a533367fd60af6e7e337b02f8c68b0248effc13d5284e71fb52'}
DURATION_METRICS = ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')
COUNT_METRICS = ('LayoutCount', 'RecalcStyleCount')


def digest(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def save_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def source_snippet(source, frame):
    """CDP positions are zero-based UTF-16 columns, not Python codepoint offsets."""
    lines = source.splitlines()
    line, column = frame.get('lineNumber', -1), frame.get('columnNumber', -1)
    if line < 0 or column < 0 or line >= len(lines):
        return None
    text = lines[line]
    prefix = text.encode('utf-16-le')[:column * 2].decode('utf-16-le', errors='ignore')
    offset = len(prefix)
    return {'lineNumber': line, 'columnNumber': column,
            'before': text[max(0, offset - 90):offset], 'atAndAfter': text[offset:offset + 310]}


def attribute(profile, sources):
    nodes = {node['id']: node for node in profile['nodes']}
    require(len(nodes) == len(profile['nodes']), 'Duplicate CPU profile node IDs')
    parents = {}
    for node in nodes.values():
        for child in node.get('children', []):
            require(child in nodes and child not in parents, 'Invalid CPU profile tree')
            parents[child] = node['id']
    samples, deltas = profile.get('samples', []), profile.get('timeDeltas', [])
    require(samples and len(samples) == len(deltas), 'Missing/mismatched CPU samples and time deltas')
    self_us, inclusive_us = {}, {}
    for leaf, elapsed in zip(samples, deltas):
        require(leaf in nodes and elapsed >= 0, 'Invalid CPU sample')
        self_us[leaf] = self_us.get(leaf, 0) + elapsed
        current, visited = leaf, set()
        while current is not None:
            require(current not in visited, 'Cycle in CPU profile')
            visited.add(current)
            inclusive_us[current] = inclusive_us.get(current, 0) + elapsed
            current = parents.get(current)
    rows = []
    for node_id, node in nodes.items():
        frame = node['callFrame']
        row = {'nodeId': node_id, 'parentId': parents.get(node_id), 'callFrame': frame,
               'sampledSelfMs': self_us.get(node_id, 0) / 1000,
               'sampledInclusiveMs': inclusive_us.get(node_id, 0) / 1000,
               'hitCount': node.get('hitCount', 0)}
        if frame.get('url') in sources:
            row['sourceSnippet'] = source_snippet(sources[frame['url']], frame)
        rows.append(row)
    rows.sort(key=lambda row: row['sampledSelfMs'], reverse=True)
    # Built-ins are not consistently exposed as separate nodes by V8. Preserve
    # explicit observations without attributing JS caller samples to native code.
    selectors = [row for row in rows if 'queryselector' in row['callFrame'].get('functionName', '').lower()]
    return {'sampleCount': len(samples), 'sampledMs': sum(deltas) / 1000,
            'profileDurationMs': (profile['endTime'] - profile['startTime']) / 1000,
            'timeAccounting': 'Each timeDelta weights its corresponding sample. Inclusive time overlaps ancestors and must not be summed across rows.',
            'explicitSelectorFrames': selectors, 'nodesBySelfTime': rows,
            'nodesByInclusiveTime': sorted(rows, key=lambda row: row['sampledInclusiveMs'], reverse=True)[:40],
            'nativeAttributionLimitation': 'V8 sampling may charge native selector/DOM/formatting work to a JS caller or omit its frame. A querySelector callsite snippet is not proof that all caller self time is native selector work. No causal speedup or exclusive native breakdown is claimed.'}


OBSERVE = """() => {
 const observation = {clicks: [], visibility: [], focus: []};
 Object.defineProperty(window, '__fleetProfileObservation', {value: observation});
 document.addEventListener('click', event => {
   const tab = event.target instanceof Element ? event.target.closest('[data-tab]') : null;
   if (tab) observation.clicks.push({tab: tab.dataset.tab, trusted: event.isTrusted});
 }, true);
 document.addEventListener('visibilitychange', () => observation.visibility.push(document.visibilityState));
 window.addEventListener('blur', () => observation.focus.push('blur'));
 window.addEventListener('focus', () => observation.focus.push('focus'));
} """
SNAPSHOT = """() => {
 const native = fn => /\\[native code\\]/.test(Function.prototype.toString.call(fn));
 return {wallAt: Date.now(), monotonicAt: performance.now(), hidden: document.hidden,
   focused: document.hasFocus(), visibility: document.visibilityState,
   visiblePanels: [...document.querySelectorAll('[data-tab-panel]')].filter(e => !e.hidden).map(e => e.dataset.tabPanel),
   fleetRows: document.querySelectorAll('#space-fleets [data-flight]').length,
   firstFleetTime: document.querySelector('#space-fleets .flight-time')?.textContent || null,
   native: {date: native(Date.now), performance: native(performance.now), raf: native(requestAnimationFrame),
     interval: native(setInterval), storageGet: native(Storage.prototype.getItem), storageSet: native(Storage.prototype.setItem),
     querySelector: native(Element.prototype.querySelector), fileText: native(File.prototype.text)},
   observation: window.__fleetProfileObservation};
} """
SEED = """({key, save}) => {
 const value = JSON.parse(save), now = Date.now();
 value.savedAt = value.lastTickAt = now;
 const seeded = JSON.stringify(value, null, 2);
 localStorage.setItem(key, seeded);
 localStorage.setItem('infinity.ui.tab', 'overview');
 if (localStorage.getItem(key) !== seeded) throw Error('Native fixture seed mismatch');
 return {seeded, now};
} """


def metrics(cdp):
    values = {item['name']: item['value'] for item in cdp.send('Performance.getMetrics')['metrics']}
    require(all(name in values for name in (*DURATION_METRICS, *COUNT_METRICS)), 'Missing required CDP metrics')
    return values


def relative_asset(url, base):
    parsed, origin = urlparse(url), urlparse(base)
    require((parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc), 'Unexpected executed production script origin: ' + url)
    require(parsed.path.startswith(origin.path) and not parsed.query and not parsed.fragment, 'Unexpected script URL: ' + url)
    return parsed.path[len(origin.path):]


def verify_scripts(cdp, parsed_scripts, responses, manifest, base, dist):
    bodies, executed, sources = {}, [], {}
    for response in responses:
        url = response.url
        relative = relative_asset(url, base)
        require(relative in TARGET_JS and response.status == 200, 'Unexpected script response: ' + url)
        body = response.body()
        require(digest(body) == manifest['files'][relative] == TARGET_JS[relative], 'HTTP script body differs from pinned c7: ' + url)
        require(body == (dist / relative).read_bytes(), 'HTTP script differs from exact archive dist: ' + url)
        bodies[url] = body
    for script in parsed_scripts:
        url = script.get('url', '')
        if not url:
            # Official Playwright 1.57.0 chromium/crExecutionContext.ts passes
            # expressions unchanged; javascript.ts/dom.ts utility sources have
            # no sourceURL. These outside-window evaluations are inventoried,
            # not trusted for execution in the CPU window merely for no URL.
            continue
        relative = relative_asset(url, base)
        require(relative in TARGET_JS and url in bodies, 'Executed script lacks pinned HTTP body: ' + url)
        source = cdp.send('Debugger.getScriptSource', {'scriptId': script['scriptId']})['scriptSource']
        require(digest(source) == TARGET_JS[relative], 'Executed script source differs from HTTP c7 bytes: ' + url)
        sources[url] = source
        executed.append({'scriptId': script['scriptId'], 'url': url, 'sha256': digest(source),
                         'httpBodySha256': digest(bodies[url]), 'bytes': len(bodies[url])})
    require(executed and {relative_asset(url, base) for url in sources} == set(TARGET_JS), 'Missing executed c7 production scripts')
    return {'executedScripts': executed,
            'parsedScriptInventory': [{'scriptId': row['scriptId'], 'url': row.get('url', ''),
                                       'executionContextId': row.get('executionContextId')} for row in parsed_scripts],
            'inspectorSourceReference': 'https://github.com/microsoft/playwright/blob/v1.57.0/packages/playwright-core/src/server/chromium/crExecutionContext.ts'}, sources


def run_case(browser, fixture, tab, repetition, args, manifest, report, write_report):
    name = f"{fixture['label']}-{tab}-r{repetition + 1}"
    row = {'case': name, 'fixture': fixture['label'], 'tab': tab, 'repetition': repetition + 1, 'valid': False}
    report['runs'].append(row)
    report['phase'] = name
    write_report()
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, service_workers='block')
    try:
        page = context.new_page()
        page.set_default_timeout(20000)
        page.set_default_navigation_timeout(20000)
        errors, responses, parsed_scripts = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('requestfailed', lambda request: errors.append(f'Request failed: {request.url}: {request.failure}'))
        page.on('response', lambda response: responses.append(response) if response.request.resource_type == 'script' else None)
        cdp = context.new_cdp_session(page)
        cdp.send('Network.enable')
        cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
        cdp.send('Performance.enable', {'timeDomain': 'timeTicks'})
        cdp.on('Debugger.scriptParsed', lambda event: parsed_scripts.append(event))
        cdp.send('Debugger.enable')
        # No route interception or init-script replacement. Native storage is
        # seeded on this same origin's plain JSON document before app execution.
        release = page.goto(urljoin(args.url, 'release.json'), wait_until='load')
        require(release and release.status == 200, 'HTTP release response failed')
        actual_release = json.loads(release.body())
        require(actual_release == manifest and actual_release['sourceSha'] == TARGET_SHA, 'HTTP release identity mismatch')
        row['release'] = {'url': release.url, 'sourceSha': actual_release['sourceSha'], 'sha256': digest(release.body())}
        seed = page.evaluate(SEED, {'key': fixture['key'], 'save': fixture['save']})
        seeded = json.loads(seed['seeded'])
        expected = dict(json.loads(fixture['save']))
        expected['savedAt'] = expected['lastTickAt'] = seed['now']
        require(seeded == expected, 'Fixture changed beyond savedAt/lastTickAt envelope timestamps')
        row['seed'] = {'sha256': digest(seed['seeded']), 'savedAt': seed['now'], 'stateUnchanged': True}
        response = page.goto(args.url, wait_until='load')
        require(response and response.status == 200 and digest(response.body()) == manifest['files']['index.html'], 'HTTP application HTML identity mismatch')
        page.locator('[data-tab="fleet"]').wait_for(state='visible')
        page.bring_to_front()
        require(not page.locator('[data-bind="offline-modal"]').is_visible(), 'Unexpected offline modal after fresh timestamp seed')
        page.evaluate(OBSERVE)
        # Every sample uses trusted navigation. Overview first visits fleet, then
        # returns, so both targets are reached by a native pointer interaction.
        for selected in (('fleet', 'overview') if tab == 'overview' else ('fleet',)):
            page.locator(f'[data-tab="{selected}"]').click()
            page.locator(f'[data-tab-panel="{selected}"]').wait_for(state='visible')
        page.wait_for_timeout(args.warmup_ms)
        before = page.evaluate(SNAPSHOT)
        require(before['fleetRows'] == fixture['fleets'], 'Unexpected fixture fleet row count')
        cdp.send('Profiler.enable')
        cdp.send('Profiler.setSamplingInterval', {'interval': 1000})
        before_metrics = metrics(cdp)
        host_start = time.monotonic()
        cdp.send('Profiler.start')
        try:
            # No page-evaluated loops/observers/clock hooks run during this window.
            page.wait_for_timeout(args.sample_ms)
        finally:
            profile = cdp.send('Profiler.stop')['profile']
            save_json(args.output / (name + '.cpuprofile'), profile)
        host_ms = (time.monotonic() - host_start) * 1000
        after_metrics = metrics(cdp)
        after = page.evaluate(SNAPSHOT)
        cdp.send('Profiler.disable')
        row.update({'before': before, 'after': after, 'hostWindowMs': host_ms,
                    'profileFile': name + '.cpuprofile',
                    'metrics': {key + 'Ms': (after_metrics[key] - before_metrics[key]) * 1000 for key in DURATION_METRICS},
                    'metricCounts': {key: after_metrics[key] - before_metrics[key] for key in COUNT_METRICS}})
        row['metricWindowNote'] = 'CDP metric window encloses Profiler start/stop. It is slightly wider than CPU profile timestamps and includes inspector overhead.'
        identity, sources = verify_scripts(cdp, parsed_scripts, responses, manifest, args.url, args.dist)
        row['identity'] = identity
        for url, source in sources.items():
            (args.output / Path(urlparse(url).path).name).write_text(source, encoding='utf-8')
        # Empty URLs do not excuse unknown JS in the CPU window. V8's native/
        # synthetic frames have scriptId 0; every other frame must match an
        # exact executed production script ID AND URL. Inspector work in this
        # window is contamination, preserved and rejected rather than hidden.
        verified_ids = {item['scriptId']: item['url'] for item in identity['executedScripts']}
        row['unverifiedProfileFrames'] = [node['callFrame'] for node in profile['nodes']
            if not ((node['callFrame'].get('scriptId') == '0' and not node['callFrame'].get('url'))
                    or verified_ids.get(node['callFrame'].get('scriptId')) == node['callFrame'].get('url'))]
        require(not row['unverifiedProfileFrames'], 'CPU profile contains unverified or inspector JS frames; inspect report and full profile')
        attribution = attribute(profile, sources)
        save_json(args.output / (name + '-attribution.json'), attribution)
        row['attributionFile'] = name + '-attribution.json'
        row['sampledMs'] = attribution['sampledMs']
        row['topSelf'] = attribution['nodesBySelfTime'][:25]
        row['explicitSelectorFrames'] = attribution['explicitSelectorFrames']
        for snapshot in (before, after):
            require(not snapshot['hidden'] and snapshot['focused'] and snapshot['visibility'] == 'visible', 'Sample page was not visible and focused')
            require(snapshot['visiblePanels'] == [tab], 'Unexpected selected panel')
            require(all(snapshot['native'].values()), 'Native platform primitive replaced')
        observation = after['observation']
        require(observation['clicks'] and all(item['trusted'] for item in observation['clicks']), 'Navigation lacks trusted input evidence')
        require(not observation['visibility'] and 'blur' not in observation['focus'], 'Visibility/focus changed during this case')
        require(after['wallAt'] - before['wallAt'] >= args.sample_ms * .8 and after['monotonicAt'] - before['monotonicAt'] >= args.sample_ms * .8, 'Native clocks did not advance')
        if tab == 'fleet':
            require(before['firstFleetTime'] != after['firstFleetTime'], 'Fleet countdown did not advance with the active game clock')
        require(not errors, 'Page/runtime errors: ' + repr(errors))
        require(all(value >= 0 for value in row['metrics'].values()), 'Invalid negative CDP metric delta')
        row['valid'] = True
        print(json.dumps({'case': name, 'valid': True, 'metrics': row['metrics'], 'profileFile': row['profileFile']}), flush=True)
    finally:
        write_report()
        context.close()


def self_test():
    profile = {'startTime': 0, 'endTime': 6000, 'nodes': [
        {'id': 1, 'callFrame': {'functionName': '(root)'}, 'children': [2]},
        {'id': 2, 'callFrame': {'functionName': 'wrapper', 'url': 'http://test/a.js', 'lineNumber': 0, 'columnNumber': 3}, 'children': [3]},
        {'id': 3, 'callFrame': {'functionName': 'querySelector'}}], 'samples': [2, 3, 3], 'timeDeltas': [1000, 2000, 3000]}
    result = attribute(profile, {'http://test/a.js': 'a🚀function wrapper(){}'})
    rows = {row['nodeId']: row for row in result['nodesBySelfTime']}
    require(rows[2]['sampledSelfMs'] == 1 and rows[2]['sampledInclusiveMs'] == 6 and rows[3]['sampledSelfMs'] == 5, 'Attribution weighting self-test')
    require(rows[2]['sourceSnippet']['atAndAfter'].startswith('function'), 'UTF-16 source coordinate self-test')
    require(len(result['explicitSelectorFrames']) == 1, 'Explicit native-frame self-test')
    try:
        attribute({**profile, 'timeDeltas': []}, {})
    except AssertionError:
        pass
    else:
        raise AssertionError('Invalid evidence was accepted')
    print('Stdlib attribution, UTF-16 source positions, and invalid-evidence checks passed; no browser run.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dist', type=Path)
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--moderate-fixture', type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:4176/Infinity/')
    parser.add_argument('--output', type=Path, default=Path('fleet-dom-profile-evidence'))
    parser.add_argument('--repetitions', type=int, choices=(2, 3), default=2)
    parser.add_argument('--sample-ms', type=int, default=2500)
    parser.add_argument('--warmup-ms', type=int, default=1000)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not all((args.dist, args.fixture, args.moderate_fixture)):
        parser.error('--dist, --fixture and --moderate-fixture are required')
    if not (2000 <= args.sample_ms <= 4000 and 500 <= args.warmup_ms <= 1500):
        parser.error('Bounded sampling requires sample-ms 2000..4000 and warmup-ms 500..1500')
    parsed = urlparse(args.url)
    if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or not args.url.endswith('/Infinity/'):
        parser.error('Use a local real HTTP /Infinity/ server, without credentials or remote player data')
    args.output.mkdir(parents=True, exist_ok=True)
    report = {'targetSourceSha': TARGET_SHA, 'pinnedProductionJs': TARGET_JS, 'completed': False, 'runs': [], 'errors': [],
              'design': 'Fresh isolated context for each fixture/tab/repetition; cold HTTP loads with cache disabled and service workers blocked; one headed Google Chrome page visible at a time. Existing anonymous exact-target fixtures; only envelope savedAt/lastTickAt rebased using native Date.now. Clocks and game engine active. Trusted native tab clicks followed by fixed warmup. Two counter-ordered repetitions by default.',
              'limitations': ['This is sampling attribution with Profiler, Debugger script-source inventory, and CDP metric overhead; never compare these timings as benchmark speedups.',
                             'Profiles contain unmodified minified production functions with zero-based URL/line/UTF-16-column and nearby exact source. No sourcemaps or source transformation.',
                             'Native selector, DOM, and formatting costs may be charged to callers. Use explicit frames and callsite evidence; unresolved native attribution remains a limitation.',
                             'No persistence/import exercise, clock replacement, route interception, engine hooks, or querySelector wrappers. Small outside-window DOM snapshots and trusted-input/visibility listeners are observations only.'],
              'settings': {'repetitions': args.repetitions, 'sampleMs': args.sample_ms, 'warmupMs': args.warmup_ms, 'samplingIntervalUs': 1000}}
    write_report = lambda: save_json(args.output / 'report.json', report)
    browser = playwright = None
    def deadline(signum, frame):
        raise TimeoutError('180-second experiment deadline or bounded cleanup deadline exceeded')
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(180)
    try:
        manifest = json.loads((args.dist / 'release.json').read_text())
        require(manifest['sourceSha'] == TARGET_SHA, 'Local dist sourceSha is not the exact c7 target')
        require({key: value for key, value in manifest['files'].items() if key.endswith('.js')} == TARGET_JS, 'Local dist JS manifest differs from independently pinned c7 bytes')
        for relative, expected in TARGET_JS.items():
            require(digest((args.dist / relative).read_bytes()) == expected, 'Local c7 JS bytes mismatch')
        report['localManifest'] = manifest
        fixtures = []
        for label, path in (('moderate', args.moderate_fixture), ('combined', args.fixture)):
            source = json.loads(path.read_text())
            raw = source['save']
            ready = json.loads(raw)
            require(ready == source['ready'], 'Fixture save/ready mismatch')
            fleets = len(ready['state']['fleets'])
            require(fleets == (1000 if label == 'combined' else 1), 'Unexpected existing fixture fleet population')
            fixtures.append({'label': label, 'key': source['key'], 'save': raw, 'fleets': fleets})
        report['fixtures'] = [{'label': item['label'], 'sourceSaveSha256': digest(item['save']), 'fleets': item['fleets']} for item in fixtures]
        chrome = shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        require(chrome and os.environ.get('DISPLAY'), 'Headed official Google Chrome and DISPLAY are required; run under xvfb-run')
        require(importlib.metadata.version('playwright') == '1.57.0', 'This exact experiment requires Playwright 1.57.0')
        from playwright.sync_api import sync_playwright
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch(executable_path=chrome, headless=False, timeout=20000)
        report['environment'] = {'playwright': importlib.metadata.version('playwright'), 'browser': browser.version, 'executable': chrome, 'python': platform.python_version(), 'platform': platform.platform(), 'headless': False}
        for repetition in range(args.repetitions):
            for fixture in (fixtures if repetition % 2 == 0 else list(reversed(fixtures))):
                for tab in (('overview', 'fleet') if repetition % 2 == 0 else ('fleet', 'overview')):
                    run_case(browser, fixture, tab, repetition, args, manifest, report, write_report)
        report['completed'] = len(report['runs']) == 4 * args.repetitions and all(row['valid'] for row in report['runs'])
    except Exception as error:
        report['errors'].append({'phase': report.get('phase', 'setup'), 'type': type(error).__name__, 'message': str(error)[:2000]})
        print(json.dumps(report['errors'][-1]), file=sys.stderr, flush=True)
    finally:
        # Separate short cleanup bounds prevent a stalled close masking failure.
        for label, closer in (('browser', browser.close if browser else None), ('playwright', playwright.stop if playwright else None)):
            if closer:
                signal.alarm(5)
                try:
                    closer()
                except Exception as error:
                    report['errors'].append({'phase': 'cleanup-' + label, 'type': type(error).__name__, 'message': str(error)[:500]})
        signal.alarm(0)
        report['completed'] = report['completed'] and not report['errors']
        report['phase'] = 'complete' if report['completed'] else 'invalid-or-incomplete'
        write_report()
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    sys.exit(main())
