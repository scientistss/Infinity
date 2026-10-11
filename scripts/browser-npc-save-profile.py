"""CI-only, one full-load startup and trusted save CPU-attribution experiment.

Raw sampling profiles are not unprofiled timing or optimization evidence. The
unchanged pressure runner remains the timing experiment. No production patch,
clock/storage replacement, breakpoint, precise coverage, or cross-action cache.
"""
import argparse
from bisect import bisect_right
from collections import Counter
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback
from urllib.parse import urljoin, urlparse

SPEC = importlib.util.spec_from_file_location('npc_pressure', Path(__file__).with_name('browser-npc-pressure.py'))
PRESSURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PRESSURE)
sha, require, atomic_json = PRESSURE.sha, PRESSURE.require, PRESSURE.atomic_json
REPORT = 'npc-save-profile-report.json'
WHOLE_SECONDS, ACTION_MS, SAMPLING_INTERVAL_US = 90, 10000, 1000
GAME_SHA = 'a8454529ee5abf8d915fee7f4cc1c5d77d6a8ef7'
PRESSURE_SAVE_SHA = 'c2dd3c6406c286ec48b83186759261deb6138ad60152450736d5bcfb2abe03d9'
FIXTURE_SCRIPT_SHA = 'bb875d0629fa5700fc2dae0d2c85ceb665fab781b6e557d4c640e4748db18059'
BUNDLE_SHA = '88a8a7181a3439d2171452181e56e6e62131408a40ad6120f1b17c9e3bdc743c'
RELEASE_SHA = 'b0fe72b68783b7fdbeab83827439146adeb3880873d22880f058ae5188c72934'
OBSERVER_URL = 'npc-save-profile-observer.js'
PROBE = PRESSURE.PROBE + '\n//# sourceURL=' + OBSERVER_URL
B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'


def vlq(segment):
    values, value, shift = [], 0, 0
    for character in segment:
        require(character in B64, 'Invalid source-map VLQ character')
        digit = B64.index(character)
        value |= (digit & 31) << shift
        if digit & 32:
            shift += 5
            require(shift < 55, 'Unbounded source-map VLQ')
        else:
            values.append(-(value >> 1) if value & 1 else value >> 1)
            value, shift = 0, 0
    require(shift == 0, 'Truncated source-map VLQ')
    return values


def decode_map(value):
    require(value['version'] == 3 and not value.get('sourceRoot') and 'sections' not in value,
            'Only ordinary version-3 Vite source maps supported')
    source, original_line, original_column, name = 0, 0, 0, 0
    lines = []
    for encoded_line in value['mappings'].split(';'):
        column, rows = 0, []
        for encoded in encoded_line.split(',') if encoded_line else []:
            fields = vlq(encoded)
            require(len(fields) in (1, 4, 5), 'Invalid source-map segment arity')
            column += fields[0]
            require(column >= 0 and (not rows or column > rows[-1][0]), 'Duplicate or unordered source-map columns')
            mapped = None
            if len(fields) >= 4:
                source += fields[1]; original_line += fields[2]; original_column += fields[3]
                require(0 <= source < len(value['sources']) and original_line >= 0 and original_column >= 0,
                        'Invalid original source-map position')
                mapped = {'sourceIndex': source, 'originalLine0': original_line, 'originalColumn0': original_column}
                if len(fields) == 5:
                    name += fields[4]
                    require(0 <= name < len(value['names']), 'Invalid source-map name index')
                    mapped['mappedTokenName'] = value['names'][name]
            rows.append((column, mapped))
        lines.append(rows)
    return lines


def mapped_position(value, lines, line, column):
    if not (0 <= line < len(lines)) or column < 0:
        return None
    rows = lines[line]
    index = bisect_right([row[0] for row in rows], column) - 1
    if index < 0 or rows[index][1] is None:
        return None
    begin, position = rows[index]
    source_index = position['sourceIndex']
    source_lines = (value['sourcesContent'][source_index] or '').splitlines()
    original_line = position['originalLine0']
    return {**position, 'source': value['sources'][source_index], 'generatedSegmentColumn0': begin,
            'generatedColumnGap': column - begin,
            'originalSourceLine': source_lines[original_line] if original_line < len(source_lines) else None,
            'semantics': 'Nearest preceding mapped token on this generated line; not an exact original function identity.'}


def sidecar_maps(source_root, map_root, release, out=None):
    """Map mismatch is an explicit unavailable map, never a substitute JS build."""
    source_root = Path(source_root).resolve()
    records, accepted = [], {}
    for name, expected in release['files'].items():
        if not name.endswith('.js'):
            continue
        row = {'asset': name, 'productionSha256': expected, 'eligible': False}
        records.append(row)
        try:
            require(map_root is not None, 'No hidden-map sidecar directory supplied')
            generated = Path(map_root) / name
            map_path = Path(str(generated) + '.map')
            row['sidecarGeneratedSha256'] = sha(generated.read_bytes())
            require(row['sidecarGeneratedSha256'] == expected, 'Sidecar generated JS differs; mapping disabled')
            raw = map_path.read_bytes(); value = json.loads(raw)
            row.update(mapSha256=sha(raw), sourceCount=len(value['sources']), sourceValidation=[])
            require(len(value['sourcesContent']) == len(value['sources']), 'Missing source-map original content')
            for source, content in zip(value['sources'], value['sourcesContent']):
                original = (map_path.parent / source).resolve()
                require(content is not None, 'Missing source-map source content')
                # First-party and library sources need actual byte equality. Vite's
                # virtual preload helper has no source entry in its regular map.
                dependency_root = (source_root / 'node_modules').resolve()
                require(original.is_relative_to(source_root) or original.is_relative_to(dependency_root),
                        'Source-map path leaves exact source worktree and its installed dependencies')
                require(sha(original.read_bytes()) == sha(content), 'Source-map original differs from exact source worktree')
                row['sourceValidation'].append({'source': source, 'relativePath': str(original.relative_to(source_root)) if original.is_relative_to(source_root)
                                                else 'node_modules/' + str(original.relative_to(dependency_root)),
                                                'sha256': sha(content)})
            decoded = decode_map(value)
            if out:
                target = Path(out) / 'source-map-sidecars' / (name + '.map')
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
                row['artifact'] = str(target.relative_to(out))
            accepted[name] = (value, decoded)
            row['eligible'] = True
        except (OSError, ValueError, KeyError, TypeError, AssertionError) as error:
            row['mappingUnavailableReason'] = str(error)
    return records, accepted


def profile_summary(profile, scripts, maps):
    """Preserve every profile node/stack. Counts are not durations or invocations."""
    nodes = {node['id']: node for node in profile['nodes']}
    require(nodes and len(nodes) == len(profile['nodes']), 'Missing or duplicate profile nodes')
    samples, deltas = profile.get('samples', []), profile.get('timeDeltas', [])
    require(samples and len(samples) == len(deltas), 'Raw sampled stacks and equal-length timeDeltas required')
    require(all(PRESSURE.finite_nonnegative(value) for value in deltas), 'Invalid profile time delta')
    require(PRESSURE.finite_nonnegative(profile['startTime']) and PRESSURE.finite_nonnegative(profile['endTime'])
            and profile['endTime'] >= profile['startTime'],
            'Invalid profile time range')
    parents = {}
    for node in nodes.values():
        for child in node.get('children', []):
            require(child in nodes and child not in parents, 'Invalid profile child or multiple parents')
            parents[child] = node['id']
    roots = set(nodes) - set(parents)
    require(len(roots) == 1, 'Expected a single rooted CPU profile')
    paths = {}
    for node_id in nodes:
        path, current = [], node_id
        while current is not None:
            require(current not in path, 'Cyclic CPU profile')
            path.append(current); current = parents.get(current)
        paths[node_id] = list(reversed(path))
    counts, inclusive = Counter(samples), Counter()
    for node_id, count in counts.items():
        require(node_id in nodes, 'Sample points to missing profile node')
        for parent in paths[node_id]:
            inclusive[parent] += count
    rows = []
    for node_id, node in nodes.items():
        frame = node['callFrame']; script = scripts.get(frame['scriptId'])
        production = bool(script and script['production'])
        require(not (frame.get('url', '').startswith(('http://', 'https://')) and not production),
                'HTTP profile frame lacks verified production script bytes')
        if script and frame.get('url'):
            require(frame['url'] == script['url'], 'Profile and verified script URL differ')
        mapping = None
        if production and script['asset'] in maps:
            value, decoded = maps[script['asset']]
            mapping = mapped_position(value, decoded, frame['lineNumber'], frame['columnNumber'])
        category = ('production' if production else 'read-only-observer' if frame.get('url') == OBSERVER_URL
                    else 'vm-or-idle' if frame['functionName'].startswith('(') else 'automation-or-unattributed')
        rows.append({'nodeId': node_id, 'parentNodeId': parents.get(node_id), 'stackNodeIds': paths[node_id],
                     'callFrame': frame, 'category': category, 'scriptSha256': script['sha256'] if script else None,
                     'selfSampleCount': counts[node_id], 'inclusiveSampleCount': inclusive[node_id],
                     'sourceMapPosition': mapping})
    return {'sampleCount': len(samples), 'requestedIntervalUs': SAMPLING_INTERVAL_US,
            'profileSpanUs': profile['endTime'] - profile['startTime'],
            'rawTimeDeltaSumUs': sum(deltas), 'observedTimeDeltaUs': PRESSURE.summary(deltas),
            'selfSampleCountsByCategory': dict(Counter({category: sum(row['selfSampleCount'] for row in rows if row['category'] == category)
                                                      for category in sorted({row['category'] for row in rows})})),
            'nodes': sorted(rows, key=lambda row: (-row['inclusiveSampleCount'], -row['selfSampleCount'], row['nodeId'])),
            'semantics': 'Self = sample leaf; inclusive = node occurs on sampled stack. Do not sum inclusive counts. Counts are not call counts or CPU milliseconds. Whole profile includes host/protocol waits and unrelated native work; no timestamps are spliced onto performance.now().' }


def supervise(args):
    out = Path(args.output)
    require(not out.exists() or not any(out.iterdir()), 'Use an empty output directory; preserve prior evidence')
    out.mkdir(parents=True, exist_ok=True)
    atomic_json(out / REPORT, {'completed': False, 'errors': [], 'phase': 'worker-start'})
    owned, started = {}, time.monotonic()
    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            info = PRESSURE.process_info(pid)
            if not info or (pid in owned and info['birth'] != owned[pid]):
                continue
            owned[pid] = info['birth']
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass
    def terminate(sig):
        for pid, birth in reversed(list(owned.items())):
            info = PRESSURE.process_info(pid)
            if info and info['birth'] == birth and info['state'] not in ('Z', 'X'):
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
    expired, code = False, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'], stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                collect(process.pid)
                if time.monotonic() - started >= WHOLE_SECONDS:
                    expired = True; break
                time.sleep(.1)
            if not expired:
                code = process.returncode
        finally:
            collect(process.pid); terminate(signal.SIGTERM)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            collect(process.pid); terminate(signal.SIGKILL); process.wait(timeout=2)
    report = json.loads((out / REPORT).read_text())
    residual = [info for pid, birth in owned.items() if (info := PRESSURE.process_info(pid)) and info['birth'] == birth]
    live = [info for info in residual if info['state'] not in ('Z', 'X')]
    report['supervisor'] = {'wholeBudgetSeconds': WHOLE_SECONDS, 'elapsedSeconds': time.monotonic() - started,
                           'workerExitCode': code, 'timedOut': expired, 'observedProcessCount': len(owned),
                           'residuals': residual, 'liveResiduals': live,
                           'scope': 'Only observed descendants with matching PID/start-time; sampled ancestry cannot exclude never-observed fast-orphaned processes.'}
    if expired or code or live:
        report['completed'] = False
        report['errors'].append('Supervisor timeout' if expired else 'Worker failed or live owned descendants remained')
    atomic_json(out / REPORT, report)
    print(json.dumps({'completed': report['completed'], 'report': str(out / REPORT)}))
    return 0 if report['completed'] else 1


def native_worker(args, fixture, envelopes):
    from playwright.sync_api import sync_playwright
    out, started = Path(args.output), time.monotonic()
    report = {'schema': 'infinity-npc-save-cpu-attribution-v1', 'completed': False, 'sourceSha': args.expected_sha,
              'fixtureSha256': args.expected_fixture_sha256, 'sourceIdentity': PRESSURE.source_identity(args.source_root, args.expected_sha, fixture),
              'profiles': {}, 'actions': [], 'pageErrors': [], 'failedRequests': [], 'errors': [],
              'limits': ['One explicitly synthetic full-load baseline; no repeated timing or performance improvement claim.',
                         'Profiler changes overhead. All timings here are profiled or setup observations; prior unprofiled pressure timings remain separate.',
                         'Startup begins on real about:blank before navigation and ends after Overview is visible. Network, parsing, initialization, observer and automation work are included.',
                         'Save begins after native target preparation and ends after dispatch plus the later timer and second RAF callback. Whole-window samples cannot be equated to the synchronous save interval.',
                         'The synchronous capture-to-document-bubble interval itself includes read-only observer/storage snapshot overhead.',
                         'Native clocks, storage, timers, autosave, and actual visibility are not patched. Other native callbacks may run in each window.',
                         'Sampling can miss short calls and cannot count validations or prove a duplicate full-ledger pass. VM/GC samples are not attributed to a caller without a stack.',
                         'All generated function positions and node ancestry are retained. Source-map token positions are approximate original function labels; mismatch disables mapping.',
                         'Headed official Google Chrome on GitHub Linux/Xvfb; not hardware compositor, mobile, natural gameplay, or mandatory formal acceptance.'],
              'protocolReference': 'https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/js_protocol.json'}
    # Preserve the actual complete byte-pinned fixture, not a reserialized copy.
    (out / 'fixtures.input.json').write_bytes(Path(args.fixture).read_bytes())
    def flush(phase):
        report['phase'] = phase; report['hostElapsedSeconds'] = time.monotonic() - started
        atomic_json(out / REPORT, report)
        print(json.dumps({'phase': phase}), flush=True)
    def read(page, expression='snapshot()'):
        return page.evaluate('window.__npcPressure.' + expression)
    profiles = {}
    def stop_profile(cdp, name, host, error):
        # Always preserve raw profile before source/observation qualification.
        profile = cdp.send('Profiler.stop')['profile']
        atomic_json(out / (name + '.cpuprofile'), profile); profiles[name] = profile
        report['profiles'][name] = {'rawFile': name + '.cpuprofile', 'rawSha256': sha((out / (name + '.cpuprofile')).read_bytes()),
                                    'hostBracketMs': (time.monotonic() - host) * 1000, 'actionError': str(error) if error else None,
                                    'debuggerEnabledDuringWindow': False}
        flush(name + ':raw-profile-preserved')
    try:
        official = shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        require(official is not None, 'Official Chrome prerequisite missing')
        version = subprocess.check_output([official, '--version'], text=True, timeout=10).strip()
        require(version.startswith('Google Chrome ') and os.environ.get('DISPLAY'), 'Headed official Google Chrome and Xvfb DISPLAY required')
        report['browser'] = {'executable': official, 'binaryVersion': version, 'headless': False, 'viewport': {'width': 1440, 'height': 1100}}
        with sync_playwright() as playwright:
            request = playwright.request.new_context(timeout=10000)
            try:
                response = request.get(urljoin(args.url, 'release.json'))
                require(response.status == 200 and response.url == urljoin(args.url, 'release.json'), 'Exact release HTTP200 required')
                raw = response.body(); release = json.loads(raw)
                require(sha(raw) == RELEASE_SHA, 'Complete frozen release manifest differs from prior unprofiled baseline')
                require(release['sourceSha'] == GAME_SHA and release['saveVersion'] == 9 and release['saveRevision'] == 13, 'Exact a845/v9/r13 release required')
                require(len(release['files']) == 62 and BUNDLE_SHA in release['files'].values(), 'Expected exact 62-asset baseline bundle')
                (out / 'release.json').write_bytes(raw)
                report['releaseIdentity'] = {'sha256': sha(raw), 'metadata': release, 'files': []}
                for name, expected in sorted(release['files'].items()):
                    path = PurePosixPath(name)
                    require(not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'Unsafe release path')
                    url = urljoin(args.url, name); asset = request.get(url); body = asset.body()
                    require(asset.status == 200 and asset.url == url and sha(body) == expected, 'Full production HTTP bytes mismatch: ' + name)
                    target = out / 'release-full-bytes' / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
                    report['releaseIdentity']['files'].append({'name': name, 'url': url, 'sha256': sha(body), 'bytes': len(body)})
            finally:
                request.dispose()
            # Decode/copy sidecars outside both profiled windows.
            report['sourceMaps'], maps = sidecar_maps(args.source_root, args.map_root, release, out)
            flush('release-and-optional-sidecar-identity-verified')
            browser = playwright.chromium.launch(executable_path=official, headless=False, args=['--no-sandbox'])
            report['browser']['protocolVersion'] = browser.version
            seeded_at = int(time.time() * 1000); seeded = PRESSURE.seed_now(fixture['pressure'], seeded_at)
            (out / 'pressure-seeded.json').write_text(seeded, encoding='utf-8')
            before_spans, after_spans = PRESSURE.envelope_spans(fixture['pressure']), PRESSURE.envelope_spans(seeded)
            report['input'] = {'pressureSaveSha256': sha(fixture['pressure']), 'seededSaveSha256': sha(seeded),
                               'originalStateTextSha256': sha(fixture['pressure'][slice(*before_spans['state'])]),
                               'seededStateTextSha256': sha(seeded[slice(*after_spans['state'])]),
                               'changedEnvelopeFields': ['savedAt', 'lastTickAt'], 'seededWallAt': seeded_at,
                               'counts': PRESSURE.state_counts(envelopes['pressure']['state'])}
            origin = f'{urlparse(args.url).scheme}://{urlparse(args.url).netloc}'
            context = browser.new_context(viewport={'width': 1440, 'height': 1100}, storage_state={'cookies': [], 'origins': [
                {'origin': origin, 'localStorage': [{'name': fixture['key'], 'value': seeded}, {'name': 'infinity.ui.tab', 'value': 'overview'}]}]})
            context.add_init_script(PROBE.replace('__KEY__', json.dumps(fixture['key'])))
            page = context.new_page(); page.set_default_timeout(ACTION_MS); page.set_default_navigation_timeout(15000)
            require(page.url == 'about:blank', 'Startup must begin from a true blank document')
            page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
            page.on('requestfailed', lambda request: report['failedRequests'].append(request.url))
            captured, parsed = [], []
            page.on('response', lambda value: captured.append(value) if value.request.resource_type in ('script', 'stylesheet') else None)
            cdp = context.new_cdp_session(page)
            cdp.send('Network.enable'); cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
            cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': SAMPLING_INTERVAL_US})
            report['startupBefore'] = {'url': page.url, 'hostMonotonic': time.monotonic()}
            flush('startup:profiling')
            error, response, host = None, None, time.monotonic()
            cdp.send('Profiler.start')
            try:
                response = page.goto(args.url, wait_until='domcontentloaded')
                page.locator('[data-tab-panel="overview"]').wait_for(state='visible')
            except Exception as caught:
                error = caught
            finally:
                stop_profile(cdp, 'startup', host, error)
            if error:
                raise error
            require(response and response.status == 200 and response.url == args.url and sha(response.body()) == release['files']['index.html'],
                    'Actual production document bytes mismatch')
            report['startupAfter'] = read(page)
            report['startupObservers'] = read(page, 'all()')
            require(all(report['startupObservers']['native'].values()), 'Browser primitives replaced')
            require(not report['startupAfter']['hidden'] and not report['startupAfter']['offlineModalVisible'], 'Startup is hidden or covered')
            require(report['startupAfter']['selectedTab'] == 'overview' and not read(page, 'fleet()')['rowIds'], 'Unexpected initial UI state')
            # Prepare/qualify normal Save-tab navigation completely outside profiling.
            page.evaluate('(x)=>window.__npcPressure.arm(x)', {'selector': '[data-tab="save"]', 'storage': False})
            before = read(page)['clickCount']; page.locator('[data-tab="save"]').click()
            page.wait_for_function('(n)=>{const r=window.__npcPressure.all().clicks;return r.length>n&&r.at(-1).secondRafCallbackAt!==null&&r.at(-1).postDispatchTaskAt!==undefined;}', arg=before)
            navigation = read(page, 'all()')['clicks'][before:]
            atomic_json(out / 'save-tab-native-click.json', navigation)
            PRESSURE.qualify_click(navigation, '[data-tab="save"]')
            page.locator('[data-tab-panel="save"]').wait_for(state='visible')
            selector = '[data-action="save"]'; button = page.locator(selector)
            require(button.count() == 1 and button.is_visible() and button.is_enabled(), 'Unique visible enabled Save button required')
            button.scroll_into_view_if_needed(); box = button.bounding_box()
            require(box and box['width'] > 0 and box['height'] > 0, 'Native Save target has no rectangle')
            point = {'x': box['x'] + box['width'] / 2, 'y': box['y'] + box['height'] / 2}
            require(page.evaluate('(p)=>document.elementFromPoint(p.x,p.y)?.closest("button")?.matches(\'[data-action="save"]\')===true', point), 'Save target is obscured')
            page.evaluate('(x)=>window.__npcPressure.arm(x)', {'selector': selector, 'storage': True})
            before = read(page); report['saveBefore'] = before; report['nativeMousePoint'] = point
            flush('save:profiling')
            error, host = None, time.monotonic()
            cdp.send('Profiler.start')
            try:
                # Real Input dispatch, no JS click and no actionability setup inside window.
                page.mouse.click(**point)
                page.wait_for_function('(n)=>{const r=window.__npcPressure.all().clicks;return r.length>n&&r.at(-1).secondRafCallbackAt!==null&&r.at(-1).postDispatchTaskAt!==undefined;}', arg=before['clickCount'])
            except Exception as caught:
                error = caught
            finally:
                stop_profile(cdp, 'save', host, error)
            cdp.send('Profiler.disable')
            rows = read(page, 'all()')['clicks'][before['clickCount']:]; after = read(page)
            raw_action = {'before': before, 'after': after, 'observedClicks': rows, 'actionError': str(error) if error else None}
            atomic_json(out / 'save-native-click-and-storage.json', raw_action)
            report['saveRawEvidenceFile'] = 'save-native-click-and-storage.json'; flush('save:raw-click-preserved')
            if error:
                raise error
            row = PRESSURE.qualify_click(rows, selector, storage=True)
            timing = PRESSURE.click_timing(row, after['now'], report['profiles']['save']['hostBracketMs'])
            report['profiledSaveWitnessTimingMs'] = timing
            require(row['afterStatus'] == '已保存到本地', 'Trusted native save did not succeed')
            require(row['beforeRaw'] != row['afterRaw'], 'Save did not write fresh accounted-clock bytes')
            saved = json.loads(row['afterRaw']); report['postSaveCounts'] = PRESSURE.state_counts(saved['state'])
            require(saved['version'] == 9 and saved['revision'] == 13, 'Save envelope changed version')
            require(report['postSaveCounts'] == report['input']['counts'], 'Full pressure counts changed')
            require(PRESSURE.stable_identity(saved['state']) == PRESSURE.stable_identity(envelopes['pressure']['state']), 'Input identities changed')
            require(int(time.time() * 1000) - seeded_at < fixture['minimumRemainingSeconds'] * 1000, 'Native fixture lifetime exceeded')
            # Debugger is first enabled only after both raw profiles are complete.
            cdp.on('Debugger.scriptParsed', lambda value: parsed.append(value))
            cdp.send('Debugger.enable')
            manifest = {urljoin(args.url, name): (name, digest) for name, digest in release['files'].items()}
            http = {}
            for asset in captured:
                body = asset.body(); entry = manifest.get(asset.url)
                require(entry and asset.status == 200 and asset.request.url == asset.url and sha(body) == entry[1], 'Actual loaded asset mismatch')
                http[asset.url] = {'url': asset.url, 'type': asset.request.resource_type, 'sha256': sha(body), 'bytes': len(body)}
            require(any(value['type'] == 'script' for value in http.values()) and any(value['type'] == 'stylesheet' for value in http.values()), 'Actual loaded JS and CSS required')
            scripts, source_errors = {}, []
            wanted = {node['callFrame']['scriptId'] for profile in profiles.values() for node in profile['nodes']}
            for event in parsed:
                script_id, url = event['scriptId'], event.get('url', '')
                if script_id not in wanted and url not in manifest:
                    continue
                try:
                    source = cdp.send('Debugger.getScriptSource', {'scriptId': script_id})['scriptSource']; digest = sha(source)
                    production = url in manifest
                    if production:
                        require(digest == manifest[url][1] == http[url]['sha256'], 'Actual V8 source differs from full served JS')
                    elif url.startswith(('http://', 'https://')):
                        raise AssertionError('Unexpected HTTP V8 script')
                    target = f'verified-v8-scripts/{script_id}.js'; (out / target).parent.mkdir(exist_ok=True)
                    (out / target).write_text(source, encoding='utf-8')
                    scripts[script_id] = {'url': url, 'scriptId': script_id, 'sha256': digest, 'production': production,
                                          'asset': manifest[url][0] if production else None, 'rawSourceFile': target}
                except Exception as caught:
                    if url in manifest or url.startswith(('http://', 'https://')):
                        raise
                    source_errors.append({'scriptId': script_id, 'url': url, 'error': str(caught)})
            cdp.send('Debugger.disable'); cdp.send('Network.disable')
            require(any(value['production'] for value in scripts.values()), 'No verified production V8 script')
            report['loadedHttpAssets'] = list(http.values()); report['verifiedScripts'] = list(scripts.values()); report['unavailableNonproductionScripts'] = source_errors
            for name, profile in profiles.items():
                result = profile_summary(profile, scripts, maps)
                require(result['selfSampleCountsByCategory'].get('production', 0) > 0, 'No actual production sample in ' + name)
                atomic_json(out / (name + '-attribution.json'), result)
                report['profiles'][name].update(attributionFile=name + '-attribution.json', sampleCount=result['sampleCount'],
                                               selfSampleCountsByCategory=result['selfSampleCountsByCategory'])
            final = read(page, 'all()'); report['allLongTasks'] = final['longTasks']; report['visibilityEvents'] = final['visibility']
            require(not any(value['state'] != 'visible' for value in final['visibility']) and not read(page)['hidden'], 'Actual visibility changed')
            require(not re.search('受保护|暂停写入|本地存储不可用', row['afterStatus'] + after['notice']), 'Save is protected')
            require(not report['pageErrors'] and not report['failedRequests'], 'Page errors or failed requests observed')
            page.screenshot(path=str(out / 'native-save-profile-final.png'), full_page=False)
            context.close(); browser.close(); report['completed'] = True
    except BaseException as error:
        report['errors'].append({'phase': report.get('phase'), 'error': str(error), 'traceback': traceback.format_exc()})
    finally:
        flush('completed' if report['completed'] else 'failed')
    return 0 if report['completed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4180/Infinity/')
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--expected-fixture-sha256', required=True)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--map-root')
    parser.add_argument('--output', default='npc-save-profile-evidence')
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not args.preflight:
        require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true', 'NPC CPU profiling is GitHub-CI-only; local browser execution is not authorized')
    require(args.expected_sha == GAME_SHA, 'This bounded attribution experiment uses only the pinned baseline source')
    require(bool(re.fullmatch('[0-9a-f]{64}', args.expected_fixture_sha256)), 'Complete fixture SHA-256 required')
    require(urlparse(args.url).scheme in ('http', 'https') and args.url.endswith('/'), 'HTTP production base URL required')
    fixture, envelopes = PRESSURE.load_fixture(args.fixture, args.expected_sha, args.expected_fixture_sha256)
    require(fixture['hashes']['pressureSave'] == PRESSURE_SAVE_SHA and fixture['hashes']['fixtureSource'] == FIXTURE_SCRIPT_SHA,
            'Exact previous full-load input and unchanged fixture generator required')
    source = PRESSURE.source_identity(args.source_root, args.expected_sha, fixture)
    if args.preflight:
        print(json.dumps({'classification': 'Python-only preparation; no native attribution evidence', 'source': source,
                          'pressureSaveSha256': PRESSURE_SAVE_SHA, 'counts': PRESSURE.state_counts(envelopes['pressure']['state'])}))
        return 0
    return native_worker(args, fixture, envelopes) if args.worker else supervise(args)


if __name__ == '__main__':
    sys.exit(main())
