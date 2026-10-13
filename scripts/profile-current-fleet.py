#!/usr/bin/env python3
"""Bounded native attribution of the exact published 7ab production release.

This diagnostic serves unchanged production bytes. CPU/trace runs are never
latency benchmarks. Three separate contexts measure the Save event span with
Profiler, Tracing and Debugger disabled. No engine, clock, storage or DOM-method
replacement is used. Run only in the authorized native GitHub CI environment.
"""
import argparse
import base64
import hashlib
import importlib.metadata
import json
import math
import platform
import shutil
import signal
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

TARGET_SHA = '7ab569045996a1a6ad8ce1aee477092144dfad74'
RELEASE_SHA256 = 'c9411d7c952c217feb5c796d8c0653877ae650caa67fdc17941cfa2ce6c92e6f'
FIXTURE_SHA256 = '51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98'
SAVE_SHA256 = '27e53db00f583e45db975d5b4421991de58a776d633c81da3efddca933340301'
TARGET_JS = {'assets/index-B7y-m5_J.js': '84480c365eb3d5dd45b9b7552c8e3d9439195f2eae8db36906dfc5b75a4866ff'}
TARGET_CSS = {'assets/index-Dxlsq7ae.css': '933b22bb315129b2869c408736a9602a0180312aa2d5d053fb44e2208a02f8ed'}
DURATION_METRICS = ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')
COUNT_METRICS = ('LayoutCount', 'RecalcStyleCount')
MAX_TRACE_BYTES = 64 * 1024 * 1024
OBSERVER_URL = 'infinity-diagnostic://current-fleet/observer-v1.js'
BODY_DEADLINE = None

# The Save interval contains timestamp reads and diagnostic assignments only.
# The event reference is inspected AFTER the interval. In particular, no storage
# read, JSON conversion, DOM snapshot, trace marker or status read occurs here.
OBSERVER_SOURCE = r'''(() => {
 if (Object.prototype.hasOwnProperty.call(window, '__currentFleetObservation')) throw Error('Observer already installed');
 const button = document.querySelector('[data-action="save"]');
 if (!button) throw Error('Missing original Save button');
 const record = {button, event:null, start:null, end:null, duplicates:0, navigation:[], visibility:[], focus:[]};
 Object.defineProperty(window, '__currentFleetObservation', {value:record});
 document.addEventListener('click', function currentFleetCapture(event) {
   if (event.target === button || button.contains(event.target)) {
     const at = performance.now();
     if (record.event !== null) { record.duplicates++; return; }
     record.start = at; record.event = event;
   } else {
     const tab = event.target instanceof Element ? event.target.closest('[data-tab]') : null;
     if (tab) record.navigation.push({tab:tab.dataset.tab,trusted:event.isTrusted});
   }
 }, true);
 document.addEventListener('click', function currentFleetBubble(event) {
   if (event !== record.event || record.end !== null) return;
   const at = performance.now();
   record.end = at;
 }, false);
 document.addEventListener('visibilitychange', function currentFleetVisibility() { record.visibility.push(document.visibilityState); });
 window.addEventListener('blur', function currentFleetBlur() { record.focus.push('blur'); });
 window.addEventListener('focus', function currentFleetFocus() { record.focus.push('focus'); });
})();'''

SEED = r'''({key, raw}) => {
 const save = JSON.parse(raw), now = Date.now();
 save.savedAt = save.lastTickAt = now;
 const seeded = JSON.stringify(save, null, 2);
 localStorage.setItem(key, seeded); localStorage.setItem('infinity.ui.tab', 'overview');
 if (localStorage.getItem(key) !== seeded) throw Error('Native seed readback failed');
 return {raw:seeded, now};
}'''

SNAPSHOT = r'''key => {
 const native = fn => /\[native code\]/.test(Function.prototype.toString.call(fn));
 const p = window.__currentFleetObservation;
 const status = document.querySelector('[data-bind="status"]')?.textContent || '';
 const notice = document.querySelector('[data-bind="notice-text"]')?.textContent || '';
 return {wallAt:Date.now(), monotonicAt:performance.now(), timeOrigin:performance.timeOrigin,
  hidden:document.hidden, focused:document.hasFocus(), visibility:document.visibilityState,
  panels:[...document.querySelectorAll('[data-tab-panel]')].filter(e=>!e.hidden).map(e=>e.dataset.tabPanel),
  fleetRows:document.querySelectorAll('#space-fleets [data-flight]').length,
  firstFleetTime:document.querySelector('#space-fleets .flight-time')?.textContent || null,
  status, notice, protected:/受保护|自动保存暂停|已暂停写入|本地存储不可用|临时初始画面/.test(status+notice),
  raw:localStorage.getItem(key), backupKeys:Object.keys(localStorage).filter(k=>k.startsWith(key+'.backup')).sort(),
  native:{date:native(Date.now),performance:native(performance.now),raf:native(requestAnimationFrame),
   interval:native(setInterval),timeout:native(setTimeout),get:native(Storage.prototype.getItem),
   set:native(Storage.prototype.setItem),selector:native(Element.prototype.querySelector),fileText:native(File.prototype.text)},
  observation:p?{start:p.start,end:p.end,trusted:p.event?.isTrusted??null,duplicates:p.duplicates,
   buttonConnected:p.button.isConnected,buttonEnabled:!p.button.disabled,navigation:p.navigation,
   visibility:p.visibility,focus:p.focus}:null};
}'''

HIT_TARGET = r'''selector => {
 const button=document.querySelector(selector);
 if(!button||button.disabled||!button.isConnected)throw Error('Missing enabled connected input target');
 button.scrollIntoView({block:'center',inline:'center',behavior:'instant'});
 const rect=button.getBoundingClientRect(),x=rect.x+rect.width/2,y=rect.y+rect.height/2;
 const hit=document.elementFromPoint(x,y);
 return {x,y,clear:hit===button||button.contains(hit),enabled:!button.disabled,connected:button.isConnected};
}'''


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def strict_equal(a, b):
    # Python considers True == 1 and 1 == 1.0. Preserve JSON scalar spelling too.
    return json.dumps(a, ensure_ascii=False, sort_keys=True, separators=(',', ':')) == json.dumps(b, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def exclusive_bytes(path, value):
    with path.open('xb') as handle:
        handle.write(value)


def exclusive_json(path, value):
    exclusive_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


def asset_path(dist, relative):
    path = Path(relative)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in relative, 'Unsafe release asset path')
    resolved = (dist / path).resolve()
    require(resolved.is_relative_to(dist.resolve()), 'Release asset escapes dist')
    require(resolved.is_file(), 'Release asset missing: ' + relative)
    return resolved


def fixture(path):
    body = path.read_bytes()
    require(digest(body) == FIXTURE_SHA256, 'Fixture file differs from published 7ab artifact')
    source = json.loads(body)
    pair = source['pairedNative']
    require(pair['sourceSha'] == '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b', 'Wrong archived fixture source')
    raw = pair['afterSave']
    require(digest(raw) == SAVE_SHA256 == pair['afterSha256'], 'Wrong published current-version save bytes')
    ready = json.loads(raw)
    require(ready['revision'] == 14 and ready['version'] == 9, 'Wrong strict save revision/version')
    require(source['profile'] == 'combined-max-v1', 'Wrong workload profile')
    require(len(ready['state']['fleets']) == 1000 and len(ready['state']['planets']) == 100, 'Wrong fleet/world population')
    require(source['key'] == 'infinity.original-p4.save.v1', 'Unexpected native storage key')
    return {'key': source['key'], 'raw': raw, 'ready': ready, 'counts': source['manifest']['counts'],
            'fixtureSha256': digest(body), 'nativeSaveSha256': digest(raw), 'nativeUtf8Bytes': len(raw.encode())}


def source_snippet(source, frame):
    lines = source.splitlines()
    line, column = frame.get('lineNumber', -1), frame.get('columnNumber', -1)
    if line < 0 or column < 0 or line >= len(lines):
        return None
    text = lines[line]
    prefix = text.encode('utf-16-le')[:column * 2].decode('utf-16-le', errors='ignore')
    offset = len(prefix)
    return {'lineNumber': line, 'columnNumber': column,
            'before': text[max(0, offset - 90):offset], 'atAndAfter': text[offset:offset + 310]}


def attribute(profile, identities, sources):
    """Preserve raw sample order; unavailable weights never become durations."""
    nodes = {node['id']: node for node in profile['nodes']}
    require(len(nodes) == len(profile['nodes']), 'Duplicate CPU profile node IDs')
    parents = {}
    for node in nodes.values():
        for child in node.get('children', []):
            require(child in nodes and child not in parents, 'Invalid CPU profile tree')
            parents[child] = node['id']
    samples, deltas = profile.get('samples', []), profile.get('timeDeltas', [])
    require(samples and len(samples) == len(deltas), 'Missing/mismatched CPU samples and deltas')
    require(finite_number(profile['startTime']) and finite_number(profile['endTime'])
            and profile['endTime'] > profile['startTime'], 'Invalid CPU profile interval')
    kinds, unknown = {}, []
    for node_id, node in nodes.items():
        frame = node['callFrame']; ident = identities.get(frame.get('scriptId'))
        if frame.get('scriptId') == '0' and not frame.get('url'):
            kinds[node_id] = 'v8-native-or-synthetic'
        elif ident and ident['url'] == frame.get('url'):
            kinds[node_id] = ident['kind']
        else:
            kinds[node_id] = 'unverified'; unknown.append(frame)
    self_count, inclusive_count, inclusive_production_count = {}, {}, {}
    for leaf, elapsed in zip(samples, deltas):
        require(leaf in nodes and finite_number(elapsed), 'Invalid CPU sample structure or nonfinite delta')
        self_count[leaf] = self_count.get(leaf, 0) + 1
        current, visited = leaf, set()
        while current is not None:
            require(current not in visited, 'Cycle in CPU profile')
            visited.add(current)
            inclusive_count[current] = inclusive_count.get(current, 0) + 1
            if kinds[leaf] == 'production':
                inclusive_production_count[current] = inclusive_production_count.get(current, 0) + 1
            current = parents.get(current)
    for node_id in nodes:
        current, visited = node_id, set()
        while current is not None:
            require(current not in visited, 'Cycle in CPU profile, including unsampled nodes')
            visited.add(current); current = parents.get(current)
    negative = [{'sampleIndex': index, 'sampleNodeId': samples[index], 'deltaUs': elapsed}
                for index, elapsed in enumerate(deltas) if elapsed < 0]
    reasons = []
    if unknown: reasons.append('Unverified source frames prevent attribution qualification.')
    if negative: reasons.append('Original signed timeDeltas contain negative values; no duration attribution is computed.')
    if sum(deltas) <= 0: reasons.append('Original timeDeltas sum is not positive.')
    if sum(deltas) > profile['endTime'] - profile['startTime']:
        reasons.append('Original timeDeltas sum exceeds the recorded profile interval.')
    weighted = not reasons
    production_count = sum(count for node_id, count in self_count.items() if kinds[node_id] == 'production')
    observer_count = sum(count for node_id, count in self_count.items() if kinds[node_id] == 'diagnostic-observer')
    self_us, inclusive_us = {}, {}
    if weighted:
        for leaf, elapsed in zip(samples, deltas):
            self_us[leaf] = self_us.get(leaf, 0) + elapsed
            current = leaf
            while current is not None:
                inclusive_us[current] = inclusive_us.get(current, 0) + elapsed
                current = parents.get(current)
    rows = []
    for node_id, node in nodes.items():
        frame = node['callFrame']; count = self_count.get(node_id, 0)
        row = {'nodeId': node_id, 'parentId': parents.get(node_id), 'callFrame': frame, 'kind': kinds[node_id],
               'selfSampleCount': count, 'inclusiveSampleCount': inclusive_count.get(node_id, 0),
               'selfFractionOfAllRawSamples': count / len(samples),
               'inclusiveFractionOfAllRawSamples': inclusive_count.get(node_id, 0) / len(samples),
               'selfFractionOfVerifiedProductionJsLeaves': count / production_count if production_count and kinds[node_id] == 'production' else None,
               'inclusiveVerifiedProductionJsLeafCount': inclusive_production_count.get(node_id, 0),
               'inclusiveFractionOfVerifiedProductionJsLeaves': inclusive_production_count.get(node_id, 0) / production_count if production_count and kinds[node_id] == 'production' else None,
               'hitCount': node.get('hitCount', 0),
               'selfCountMinusReportedHitCount': count - node.get('hitCount', 0)}
        if weighted:
            row['sampledSelfMs'] = self_us.get(node_id, 0) / 1000
            row['sampledInclusiveMs'] = inclusive_us.get(node_id, 0) / 1000
        if frame.get('url') in sources:
            row['sourceSnippet'] = source_snippet(sources[frame['url']], frame)
        rows.append(row)
    result = {'valid': not unknown, 'structureValid': True, 'sourceValid': not unknown,
            'attributionMode': ('weighted-samples' if weighted else 'sample-frequency-only') if not unknown else 'invalid-source',
            'unverifiedFrames': unknown, 'sampleCount': len(samples),
            'rawProfileSpanUs': profile['endTime'] - profile['startTime'], 'rawSignedTimeDeltasSumUs': sum(deltas),
            'weightValidity': {'valid': weighted, 'reasons': reasons, 'negativeDeltaCount': len(negative), 'negativeDeltas': negative,
                               'preservation': 'Original deltas, sample order and samples are unchanged. No clamping, sorting, omission or hitCount substitution.'},
            'sampleDenominators': {'allRawSamples': len(samples), 'verifiedProductionJavaScriptLeafSamples': production_count,
                                  'diagnosticObserverLeafSamples': observer_count},
            'frequencyMeaning': 'Fractions are observed raw sample frequencies, not CPU shares or durations. The full denominator retains native/program/idle/GC/observer samples. The production-JS subset excludes them. Inclusive counts overlap ancestors.',
            'nodesBySelfSampleCount': sorted(rows, key=lambda row: row['selfSampleCount'], reverse=True),
            'nodesByInclusiveSampleCount': sorted(rows, key=lambda row: row['inclusiveSampleCount'], reverse=True),
            'hitCountComparison': {'rawSampleCount': len(samples), 'reportedHitCountSum': sum(node.get('hitCount', 0) for node in nodes.values()),
                                  'differingNodes': [{'nodeId': row['nodeId'], 'selfSampleCount': row['selfSampleCount'], 'reportedHitCount': row['hitCount'],
                                                     'difference': row['selfCountMinusReportedHitCount']} for row in rows if row['selfCountMinusReportedHitCount']]},
            'explicitSelectorFrames': [row for row in rows if 'queryselector' in row['callFrame'].get('functionName', '').lower()],
            'nativeAttributionLimitation': 'V8 may charge DOM/selector/formatting work to callers or omit native frames. Callsite text is not an exclusive native timing attribution. Unknown frames invalidate this profile.'}
    if weighted:
        result.update({'sampledMs': sum(deltas) / 1000,
                       'profileDurationMs': (profile['endTime'] - profile['startTime']) / 1000,
                       'timeAccounting': 'Original timeDeltas weight their corresponding samples. Inclusive ancestor values overlap.',
                       'nodesBySelfTime': sorted(rows, key=lambda row: row['sampledSelfMs'], reverse=True),
                       'nodesByInclusiveTime': sorted(rows, key=lambda row: row['sampledInclusiveMs'], reverse=True),
                       'observerSampledSelfMs': sum(row['sampledSelfMs'] for row in rows if row['kind'] == 'diagnostic-observer')})
    return result


def relative_asset(url, base):
    parsed, origin = urlparse(url), urlparse(base)
    require((parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc), 'Unexpected script origin: ' + url)
    require(parsed.path.startswith(origin.path) and not parsed.query and not parsed.fragment, 'Unexpected script URL: ' + url)
    return parsed.path[len(origin.path):]


def metrics(cdp):
    values = {item['name']: item['value'] for item in cdp.send('Performance.getMetrics')['metrics']}
    require(all(key in values for key in ('Timestamp', *DURATION_METRICS, *COUNT_METRICS)), 'Missing CDP metrics')
    return values


def metric_delta(before, after):
    require(all(finite_number(value[key]) for value in (before, after)
                for key in ('Timestamp', *DURATION_METRICS, *COUNT_METRICS)), 'Nonfinite CDP metric')
    require(after['Timestamp'] > before['Timestamp'], 'Nonpositive metric window')
    return {'elapsedMs': (after['Timestamp'] - before['Timestamp']) * 1000,
            'durationMs': {key: (after[key] - before[key]) * 1000 for key in DURATION_METRICS},
            'counts': {key: after[key] - before[key] for key in COUNT_METRICS}}


def snapshot(page, key, directory, label):
    value = page.evaluate(SNAPSHOT, key)
    raw = value.pop('raw')
    exclusive_json(directory / (label + '-snapshot.json'), value)
    if raw is not None:
        exclusive_bytes(directory / (label + '-current.json'), raw.encode())
    value['currentSha256'] = digest(raw) if isinstance(raw, str) else None
    return value, raw


def qualified_snapshot(value, panel):
    require(value['visibility'] == 'visible' and not value['hidden'] and value['focused'], 'Page not genuinely visible/focused')
    require(value['panels'] == [panel], 'Wrong visible panel')
    require(all(value['native'].values()), 'A native platform primitive was replaced')
    require(not value['protected'], 'Native save session is protected')
    require(not value['backupKeys'], 'Unexpected backup in fresh current-version context')
    observation = value['observation']
    require(observation and not observation['visibility'] and 'blur' not in observation['focus'], 'Observed visibility/focus change')
    require(observation['navigation'] and all(row['trusted'] for row in observation['navigation']), 'Missing trusted navigation')


def navigate(page, tab):
    page.locator('[data-tab="' + tab + '"]').click(timeout=15000)
    page.locator('[data-tab-panel="' + tab + '"]').wait_for(state='visible', timeout=15000)


def verify_scripts(cdp, parsed, responses, dist, base, directory):
    bodies, identities, sources = {}, {}, {}
    for response in responses:
        url = response.url; relative = relative_asset(url, base)
        body = response.body()
        require(response.status == 200 and relative in TARGET_JS, 'Unexpected HTTP production script')
        exclusive_bytes(directory / ('http-script-' + str(len(bodies)) + '.js'), body)
        require(digest(body) == TARGET_JS[relative] and body == asset_path(dist, relative).read_bytes(), 'Production HTTP JS mismatch')
        bodies[url] = body
    for script in parsed:
        url = script.get('url', '')
        if not url or url == OBSERVER_URL:
            continue
        relative = relative_asset(url, base)
        require(relative in TARGET_JS and url in bodies, 'Executed script lacks pinned HTTP response')
        require(isinstance(script['scriptId'], str) and script['scriptId'].isdigit(), 'Unsafe V8 script identity')
        source = cdp.send('Debugger.getScriptSource', {'scriptId': script['scriptId']})['scriptSource']
        exclusive_bytes(directory / ('v8-script-' + script['scriptId'] + '.js'), source.encode())
        require(digest(source) == TARGET_JS[relative], 'Executed V8 source differs from exact published JS')
        identities[script['scriptId']] = {'url': url, 'kind': 'production', 'sha256': digest(source)}
        sources[url] = source
    require(identities and {relative_asset(url, base) for url in sources} == set(TARGET_JS), 'Incomplete executed production script identity')
    return identities, sources


def register_observer(cdp, identities, sources, directory):
    result = cdp.send('Runtime.compileScript', {'expression': OBSERVER_SOURCE, 'sourceURL': OBSERVER_URL, 'persistScript': True})
    require('exceptionDetails' not in result and result.get('scriptId'), 'Observer compilation failed')
    script_id = result['scriptId']
    actual = cdp.send('Debugger.getScriptSource', {'scriptId': script_id})['scriptSource']
    exclusive_bytes(directory / 'registered-observer.js', actual.encode())
    require(actual == OBSERVER_SOURCE, 'Compiled observer source changed')
    result = cdp.send('Runtime.runScript', {'scriptId': script_id, 'returnByValue': True})
    require('exceptionDetails' not in result, 'Observer execution failed')
    identities[script_id] = {'url': OBSERVER_URL, 'kind': 'diagnostic-observer', 'sha256': digest(actual)}
    sources[OBSERVER_URL] = actual


def begin_trace(cdp):
    completed = []
    listener = lambda event: completed.append(event)
    cdp.on('Tracing.tracingComplete', listener)
    cdp.send('Tracing.start', {'categories': 'toplevel,devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline',
                              'transferMode': 'ReturnAsStream', 'streamFormat': 'json'})
    return completed, listener


def end_trace(cdp, page, token, path):
    completed, listener = token
    cdp.send('Tracing.end')
    until = time.monotonic() + 10
    while not completed and time.monotonic() < until:
        page.wait_for_timeout(20)
    cdp.remove_listener('Tracing.tracingComplete', listener)
    require(len(completed) == 1 and completed[0].get('stream'), 'Missing native trace completion/stream')
    event = completed[0]; stream = event['stream']; size = 0
    try:
        with path.open('xb') as handle:
            while True:
                require(time.monotonic() < until, 'Native trace read deadline exceeded')
                part = cdp.send('IO.read', {'handle': stream, 'size': 1024 * 1024})
                value = base64.b64decode(part['data']) if part.get('base64Encoded') else part['data'].encode()
                size += len(value)
                require(size <= MAX_TRACE_BYTES, 'Native trace exceeds bounded artifact size')
                handle.write(value)
                if part.get('eof'):
                    break
    finally:
        cdp.send('IO.close', {'handle': stream})
    raw = json.loads(path.read_bytes())
    require(isinstance(raw.get('traceEvents'), list), 'Trace stream lacks original timeline events')
    require(not event.get('dataLossOccurred', False), 'Native trace reports dropped data')
    return {'path': path.name, 'bytes': size, 'sha256': digest(path.read_bytes()), 'eventCount': len(raw['traceEvents']),
            'completion': event, 'scope': 'Original native timeline GC/layout/script/task events. Overlapping event durations must not be summed as exclusive CPU costs.'}


def finalize_profile(cdp, page, token, directory, *, started=True, primary_error=None):
    """Attempt each independent evidence channel, preserving the first error."""
    first_error = primary_error
    errors = []
    if primary_error is not None:
        errors.append({'stage': 'capture', 'type': type(primary_error).__name__, 'message': str(primary_error)[:1000]})
    profile = trace = None
    def record(stage, error):
        nonlocal first_error
        if first_error is None:
            first_error = error
        errors.append({'stage': stage, 'type': type(error).__name__, 'message': str(error)[:1000]})
    try:
        try:
            if started:
                stopped = cdp.send('Profiler.stop')
                exclusive_json(directory / 'original-profiler-stop-response.json', stopped)
                require(isinstance(stopped, dict) and 'profile' in stopped, 'Missing CPU profile field in Profiler.stop response')
                profile = stopped['profile']
                exclusive_json(directory / 'original.cpuprofile', profile)
                require(isinstance(profile, dict), 'Missing CPU profile object from successful Profiler.stop response')
        except BaseException as error:
            record('profiler-stop-or-write', error)
        finally:
            try:
                cdp.send('Profiler.disable')
            except BaseException as error:
                record('profiler-disable', error)
            finally:
                # Trace is an independent evidence stream. A failed stop or
                # CPU artifact write must never prevent its finalization.
                try:
                    trace = end_trace(cdp, page, token, directory / 'original-trace.json')
                except BaseException as error:
                    record('trace-finalization', error)
    finally:
        exclusive_json(directory / 'profile-finalization.json', {
            'profileStarted': started, 'cpuProfileObtained': isinstance(profile, dict),
            'traceFinalized': trace is not None, 'errors': errors})
    if first_error is not None:
        raise first_error
    return profile, trace


def arm_storage_observer(cdp, kind, listener):
    require(kind in ('fleet-profiled', 'save-profiled', 'save-unprofiled'), 'Unknown fixed diagnostic kind')
    enabled = kind != 'save-unprofiled'
    if enabled:
        cdp.on('DOMStorage.domStorageItemUpdated', listener)
        cdp.send('DOMStorage.enable')
    return {'enabled': enabled, 'scope': 'Native full-byte protocol observations add overhead; only instrumented diagnostic contexts use them.'
            if enabled else 'DOMStorage is never enabled or listened to in this unprofiled context; no write-count claim.'}


def validate_manual(before, after, old_raw, new_raw, mutations, *, kind):
    require(kind in ('save-profiled', 'save-unprofiled'), 'Unknown manual Save diagnostic kind')
    obs = after['observation']
    require(obs['trusted'] is True and obs['duplicates'] == 0 and obs['buttonConnected'] and obs['buttonEnabled'], 'Save not exactly one trusted enabled connected click')
    require(finite_number(obs['start']) and finite_number(obs['end']) and obs['end'] >= obs['start'], 'Incomplete Save capture/bubble span')
    require(after['status'] == '已保存到本地' and not after['protected'], 'Save did not finish successfully')
    require(isinstance(old_raw, str) and isinstance(new_raw, str) and new_raw, 'Missing native current bytes')
    require(old_raw != new_raw, 'Expected advancing native workload to produce an actual current-slot write')
    if kind == 'save-profiled':
        matching = [event for event in mutations if event.get('oldValue') == old_raw and event.get('newValue') == new_raw]
        require(len(mutations) == 1 and len(matching) == 1, 'Save interval was not exactly one matching native current update')
        writes = len(matching)
    else:
        require(not mutations, 'Unprofiled Save must not receive DOMStorage protocol observations')
        writes = None
    saved = json.loads(new_raw)
    require(saved['revision'] == 14 and saved['version'] == 9, 'Save changed revision/version')
    require(saved['savedAt'] >= saved['lastTickAt'], 'Saved wall time precedes accounted watermark')
    require(before['wallAt'] <= saved['savedAt'] <= after['wallAt'], 'Save timestamp is outside native surrounding observations')
    # Date.now rounds to milliseconds. The before snapshot pairs native wall
    # and monotonic observations; allow two milliseconds for this calibration,
    # never rebase the saved timestamp or claim exact native write counts here.
    expected_start = before['wallAt'] + obs['start'] - before['monotonicAt']
    expected_end = before['wallAt'] + obs['end'] - before['monotonicAt']
    require(expected_start - 2 <= saved['savedAt'] <= expected_end + 2, 'Saved timestamp does not belong to the trusted manual click span')
    return {'captureToBubbleMs': obs['end'] - obs['start'], 'captureAt': obs['start'], 'bubbleAt': obs['end'],
            'trusted': True, 'nativeCurrentWrites': writes, 'writeCountObserved': kind == 'save-profiled',
            'nativeCurrentChanged': True, 'beforeSha256': digest(old_raw), 'afterSha256': digest(new_raw),
            'savedAt': saved['savedAt'], 'lastTickAt': saved['lastTickAt'],
            'persistenceEvidence': 'One matching full-byte native DOMStorage event, with protocol observation overhead.' if kind == 'save-profiled'
                else 'Outside-span native readback bytes changed, successful status, unique trusted click and matching savedAt; native write count is not observed.',
            'scope': 'Document capture timestamp through post-app-root document bubble timestamp, including the production synchronous Save handler/render and tiny observer overhead. No storage read or JSON conversion inside this span; not input-to-paint or exclusive serialization cost.'}


def finalize_case(row, context, directory, persist):
    """Persist original observations, then qualify the final cleanup result."""
    pending = dict(row)
    pending['observationsPassed'] = pending.pop('valid')
    pending['phaseBeforeCleanup'] = pending.get('phase')
    pending['phase'] = 'cleanup-pending'
    pending['cleanupComplete'] = False
    pending['scope'] = 'Original pre-cleanup observations only; this is not the final case qualification.'
    exclusive_json(directory / 'observation-result.json', pending)
    persist()
    cleanup = {'completed': False, 'required': context is not None}
    try:
        if context is not None:
            if BODY_DEADLINE is not None:
                remaining = BODY_DEADLINE - time.monotonic()
                signal.setitimer(signal.ITIMER_REAL, min(5, max(.001, remaining)))
            context.close()
        cleanup['completed'] = True
        row['cleanupComplete'] = True
        row['phase'] = 'complete' if row['valid'] else 'invalid-or-incomplete'
    except BaseException as error:
        cleanup['error'] = {'type': type(error).__name__, 'message': str(error)[:500]}
        row['valid'] = False
        row['cleanupComplete'] = False
        row['cleanupError'] = cleanup['error']
        row['phase'] = 'cleanup-failed'
        raise
    finally:
        exclusive_json(directory / 'context-cleanup.json', cleanup)
        # The immutable final result is written only after close has succeeded
        # or failed. It cannot disagree with the mutable aggregate report.
        exclusive_json(directory / 'case-result.json', row)
        persist()
        if BODY_DEADLINE is not None:
            signal.setitimer(signal.ITIMER_REAL, max(.001, BODY_DEADLINE - time.monotonic()))


def run_case(browser, workload, kind, repetition, args, manifest, report, persist):
    name = kind + '-r' + str(repetition + 1)
    directory = args.output / name; directory.mkdir(exist_ok=False)
    row = {'case': name, 'kind': kind, 'repetition': repetition + 1, 'valid': False,
           'instrumented': kind != 'save-unprofiled', 'phase': 'setup'}
    report['runs'].append(row); report['phase'] = name; persist()
    context = None; cdp = None
    errors, parsed, responses, mutations = [], [], [], []
    try:
        context = browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce', service_workers='block')
        page = context.new_page(); page.set_default_timeout(15000); page.set_default_navigation_timeout(20000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('requestfailed', lambda request: errors.append(str(request.url) + ': ' + str(request.failure)))
        page.on('response', lambda response: responses.append(response) if response.request.resource_type == 'script' else None)
        cdp = context.new_cdp_session(page)
        cdp.send('Performance.enable', {'timeDomain': 'timeTicks'})
        cdp.send('Runtime.enable'); cdp.on('Debugger.scriptParsed', lambda event: parsed.append(event)); cdp.send('Debugger.enable')
        response = page.goto(urljoin(args.url, 'release.json'), wait_until='load')
        require(response and response.status == 200 and digest(response.body()) == RELEASE_SHA256, 'Native release navigation mismatch')
        seeded = page.evaluate(SEED, {'key': workload['key'], 'raw': workload['raw']})
        exclusive_bytes(directory / 'seeded-current.json', seeded['raw'].encode())
        expected = dict(workload['ready']); expected['savedAt'] = expected['lastTickAt'] = seeded['now']
        require(strict_equal(json.loads(seeded['raw']), expected), 'Seed changed outside envelope timestamps')
        row['seed'] = {'sha256': digest(seeded['raw']), 'savedAt': seeded['now'], 'stateExact': True}
        response = page.goto(args.url, wait_until='domcontentloaded')
        require(response and response.status == 200 and digest(response.body()) == manifest['files']['index.html'], 'Native app HTML mismatch')
        page.locator('[data-bind="energy-chip"]').wait_for(); page.wait_for_load_state('networkidle'); page.bring_to_front()
        require(not page.locator('[data-bind="offline-modal"]').is_visible(), 'Unexpected initial offline modal')
        identities, sources = verify_scripts(cdp, parsed, responses, args.dist, args.url, directory)
        register_observer(cdp, identities, sources, directory)
        row['scriptIdentities'] = identities
        exclusive_json(directory / 'script-identities.json', identities)
        for tab in ('overview', 'orders', 'fleet'):
            navigate(page, tab); page.wait_for_timeout(600)
            if tab != 'fleet' or kind != 'fleet-profiled':
                page.wait_for_timeout(1500)
        if kind != 'fleet-profiled':
            navigate(page, 'save'); page.wait_for_timeout(600)
            hit = page.evaluate(HIT_TARGET, '[data-action="save"]')
            exclusive_json(directory / 'native-click-target.json', hit)
            require(hit['clear'] and hit['enabled'] and hit['connected'], 'Save target is obscured or unavailable')
            page.mouse.move(hit['x'], hit['y'])
        else:
            hit = None
        panel = 'fleet' if kind == 'fleet-profiled' else 'save'
        before, old_raw = snapshot(page, workload['key'], directory, 'before')
        qualified_snapshot(before, panel)
        require(before['fleetRows'] == 1000, 'Fleet DOM does not contain the 1000-fleet workload')
        require(before['observation']['start'] is None, 'Save occurred before measurement')
        origin = urlparse(args.url); origin = origin.scheme + '://' + origin.netloc
        def storage_event(event):
            ident = event.get('storageId', {})
            if event.get('key') == workload['key'] and ident.get('isLocalStorage') and ident.get('securityOrigin') == origin:
                mutations.append(event)
        row['storageObservation'] = arm_storage_observer(cdp, kind, storage_event)
        if kind == 'save-unprofiled':
            cdp.send('Debugger.disable')
            row['unprofiledInspectorState'] = {'Profiler': 'never enabled', 'Tracing': 'never started', 'Debugger': 'disabled before click',
                'DOMStorage': 'never enabled; no event listener', 'Runtime': 'enabled; no evaluation inside click span',
                'Performance': 'enabled; metrics read outside click span', 'limitation': 'This is unprofiled, not entirely inspector-free.'}
        else:
            cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 1000})
        raw_before = metrics(cdp); row['rawMetricsBefore'] = raw_before
        token = profile = None; row['phase'] = 'measurement'; persist()
        if kind != 'save-unprofiled':
            token = begin_trace(cdp)
            try:
                cdp.send('Profiler.start')
            except BaseException as error:
                finalize_profile(cdp, page, token, directory, started=False, primary_error=error)
        host_start = time.monotonic()
        action_error = None
        try:
            if kind == 'fleet-profiled':
                # Native timers/RAF keep advancing. No evaluated JS or hooks.
                page.wait_for_timeout(1500)
            else:
                # Coordinates and hit testing are already qualified. Native
                # input only; no Playwright locator utility runs in the profile.
                page.mouse.down(button='left'); page.mouse.up(button='left')
        except BaseException as error:
            action_error = error
        finally:
            row['hostControlSpanMs'] = (time.monotonic() - host_start) * 1000
            if kind != 'save-unprofiled':
                profile, row['trace'] = finalize_profile(cdp, page, token, directory, primary_error=action_error)
        raw_after = metrics(cdp); row['rawMetricsAfter'] = raw_after
        after, new_raw = snapshot(page, workload['key'], directory, 'after')
        # Pump only OUTSIDE the Save interval; CDP storage notifications can
        # arrive after input acknowledgement. Retain all events, not just matches.
        if kind == 'save-profiled':
            until = time.monotonic() + 2
            while not mutations and time.monotonic() < until:
                page.wait_for_timeout(20)
        exclusive_json(directory / 'native-current-events.json', mutations)
        exclusive_json(directory / 'parsed-script-inventory.json', parsed)
        exclusive_json(directory / 'page-errors.json', errors)
        row['before'] = before; row['after'] = after; row['metrics'] = metric_delta(raw_before, raw_after)
        row['metricWindowScope'] = 'Outer diagnostic CDP window includes inspector/profile/trace retrieval overhead; not isolated handler CPU or a benchmark speedup.'
        require(kind == 'save-unprofiled' or isinstance(profile, dict), 'Profiled case is missing its CPU capture')
        if profile is not None:
            attribution = attribute(profile, identities, sources)
            exclusive_json(directory / 'attribution.json', attribution)
            row['attribution'] = {'valid': attribution['valid'], 'structureValid': attribution['structureValid'], 'sourceValid': attribution['sourceValid'],
                                  'sampleCount': attribution['sampleCount'], 'attributionMode': attribution['attributionMode'],
                                  'weightValidity': attribution['weightValidity'], 'sampleDenominators': attribution['sampleDenominators'],
                                  'unverifiedFrames': attribution['unverifiedFrames'], 'hitCountComparison': attribution['hitCountComparison'],
                                  'topSelfSampleCounts': attribution['nodesBySelfSampleCount'][:20]}
            if attribution['weightValidity']['valid']:
                row['attribution'].update({'sampledMs': attribution['sampledMs'], 'profileDurationMs': attribution['profileDurationMs'],
                                          'observerSampledSelfMs': attribution['observerSampledSelfMs'], 'topSelf': attribution['nodesBySelfTime'][:20]})
            require(attribution['valid'], 'Profile contains unknown/inspector JavaScript; original evidence retained')
        if action_error:
            raise action_error
        qualified_snapshot(after, panel)
        require(not errors, 'Page/runtime/request errors occurred')
        require(all(v >= 0 for v in row['metrics']['durationMs'].values()), 'Negative CDP metric delta')
        if kind == 'fleet-profiled':
            require(not mutations, 'Steady fleet profile included a persistence operation')
            require(before['firstFleetTime'] != after['firstFleetTime'], 'Native fleet countdown did not advance')
            require(after['monotonicAt'] - before['monotonicAt'] >= 1200, 'Native steady window did not advance')
        else:
            row['manualSave'] = validate_manual(before, after, old_raw, new_raw, mutations, kind=kind)
            row['manualSave']['instrumented'] = kind == 'save-profiled'
            row['manualSave']['comparisonRule'] = 'Only save-unprofiled spans are unprofiled wall observations; never combine with sampled/trace runs.'
        row['valid'] = True; row['phase'] = 'complete'
        print(json.dumps({'case': name, 'valid': True, 'instrumented': row['instrumented'],
                          'manualSaveSpanMs': row.get('manualSave', {}).get('captureToBubbleMs')}), flush=True)
    except BaseException as error:
        row['error'] = {'type': type(error).__name__, 'message': str(error)[:2400]}
        row['valid'] = False
        raise
    finally:
        # Originals and partial results survive assertion/cleanup failures.
        for filename, value in (('parsed-script-inventory.json', parsed), ('page-errors.json', errors),
                                ('native-current-events.json', mutations)):
            if not (directory / filename).exists():
                exclusive_json(directory / filename, value)
        finalize_case(row, context, directory, persist)


def verify_release(request, args):
    raw = (args.dist / 'release.json').read_bytes()
    require(digest(raw) == RELEASE_SHA256, 'Local release manifest is not published 7ab')
    manifest = json.loads(raw)
    require(manifest['sourceSha'] == TARGET_SHA and manifest['version'] == '0.6.27-alpha.1', 'Wrong source/version')
    require(manifest['saveRevision'] == 14 and len(manifest['files']) == 62, 'Wrong revision/asset inventory')
    require({k: v for k, v in manifest['files'].items() if k.endswith('.js')} == TARGET_JS, 'Wrong JS asset set')
    require({k: v for k, v in manifest['files'].items() if k.endswith('.css')} == TARGET_CSS, 'Wrong CSS asset set')
    observed = []
    for relative, expected in sorted(manifest['files'].items()):
        local = asset_path(args.dist, relative).read_bytes()
        require(digest(local) == expected, 'Local release asset mismatch: ' + relative)
        response = request.get(urljoin(args.url, relative), timeout=15000)
        body = response.body()
        observed.append({'path': relative, 'url': response.url, 'status': response.status, 'sha256': digest(body), 'bytes': len(body)})
        if response.status != 200 or body != local:
            exclusive_bytes(args.output / 'http-asset-mismatch.bin', body)
            exclusive_json(args.output / 'failed-http-asset-observations.json', observed)
        require(response.status == 200 and body == local, 'HTTP asset differs from published local bytes: ' + relative)
    response = request.get(urljoin(args.url, 'release.json'), timeout=15000)
    require(response.status == 200 and response.body() == raw, 'HTTP release manifest mismatch')
    exclusive_json(args.output / 'verified-release-assets.json', observed)
    exclusive_bytes(args.output / 'verified-release.json', raw)
    return manifest


def execute_schedule(action, report, persist, *, deadline=None):
    """Every fixed case is attempted despite earlier failures, within one budget."""
    planned = [(kind, repetition) for repetition in range(3)
               for kind in ('fleet-profiled', 'save-unprofiled', 'save-profiled')]
    report['plannedCases'] = [kind + '-r' + str(repetition + 1) for kind, repetition in planned]
    report['attemptedCases'] = []
    for kind, repetition in planned:
        name = kind + '-r' + str(repetition + 1)
        if deadline is not None and time.monotonic() >= deadline:
            report['errors'].append({'phase': name, 'type': 'TimeoutError',
                                     'message': 'Original overall deadline exhausted; remaining fixed windows were not attempted.'})
            break
        report['attemptedCases'].append(name)
        report['phase'] = name
        try:
            action(kind, repetition)
        except BaseException as error:
            report['errors'].append({'phase': name, 'type': type(error).__name__, 'message': str(error)[:2400]})
            if not any(row.get('case') == name for row in report['runs']):
                report['runs'].append({'case': name, 'kind': kind, 'repetition': repetition + 1,
                                       'valid': False, 'cleanupComplete': False, 'phase': 'failed-before-context',
                                       'error': {'type': type(error).__name__, 'message': str(error)[:2400]}})
        finally:
            persist()
    report['allPlannedWindowsAttempted'] = len(report['attemptedCases']) == len(planned)
    persist()


def summarize_completion(report):
    runs = report['runs']
    all_attempted = bool(report.get('allPlannedWindowsAttempted')) and len(report.get('attemptedCases', [])) == 9
    completed = all_attempted and len(runs) == 9 and all(row.get('valid') and row.get('cleanupComplete') for row in runs)
    completed = bool(completed and report.get('globalCleanupComplete') and not report['errors'])
    profiles = [row for row in runs if row.get('kind') in ('fleet-profiled', 'save-profiled')]
    profile_captures_qualified = len(profiles) == 6 and all(
        all(row.get('attribution', {}).get(key) is True for key in ('valid', 'structureValid', 'sourceValid')) for row in profiles)
    completed = bool(completed and profile_captures_qualified)
    unavailable = [{'case': row['case'], 'reasons': row.get('attribution', {}).get('weightValidity', {}).get('reasons', ['No qualified profile attribution available.'])}
                   for row in profiles if not row.get('attribution', {}).get('weightValidity', {}).get('valid')]
    weighted_complete = completed and len(profiles) == 6 and not unavailable
    report['completed'] = completed
    report['weightedAttributionComplete'] = weighted_complete
    report['weightedUnavailableCases'] = unavailable
    report['summary'] = {'completed': completed, 'weightedAttributionComplete': weighted_complete,
                         'allPlannedWindowsAttempted': all_attempted, 'plannedWindowCount': 9,
                         'attemptedWindowCount': len(report.get('attemptedCases', [])),
                         'qualifiedWindowCount': sum(bool(row.get('valid') and row.get('cleanupComplete')) for row in runs),
                         'weightedUnavailableCases': unavailable, 'weightedAggregationAllowed': weighted_complete,
                         'completionMeaning': 'All nine native capture/source/structure/save/trace/cleanup contracts passed. This does not promise usable time weights.',
                         'weightMeaning': 'If any profile has unavailable weights, no pooled duration attribution or CPU-time shares are computed. Raw sample frequencies remain separately labeled.'}


def main():
    global BODY_DEADLINE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', required=True, type=Path)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:4176/Infinity/')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--chromium')
    args = parser.parse_args()
    url = urlparse(args.url)
    require(url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost') and url.path == '/Infinity/'
            and not url.username and not url.password and not url.query and not url.fragment, 'Only local real /Infinity/ HTTP is supported')
    args.output.mkdir(parents=True, exist_ok=True)
    exclusive_bytes(args.output / '.current-fleet-profile-owner', b'Exclusive evidence writer; refusing an accidental rerun.\n')
    report = {'targetSourceSha': TARGET_SHA, 'completed': False, 'weightedAttributionComplete': False,
              'globalCleanupComplete': False, 'runs': [], 'errors': [], 'phase': 'setup',
              'settings': {'repetitions': 3, 'fleetSampleMs': 1500, 'warmupMs': 600, 'samplingIntervalUs': 1000, 'bodyDeadlineSeconds': 180},
              'scope': 'Nine fresh native contexts: three extreme-fleet profiles, three unprofiled Save event spans, three separately profiled Saves. No production changes. No numerical speedup claim.',
              'limits': ['Headless foreground Chrome; not display-hardware, mobile or background performance.',
                         'Profile time is sampling attribution with observer/inspector overhead; inclusive ancestor times overlap.',
                         'Finite signed raw timeDeltas are preserved. If negative values or invalid coverage make weights unavailable, all weighted function durations/rankings are omitted; only explicitly labeled raw sample frequencies are retained.',
                         'completed and weightedAttributionComplete are independent qualifications. If any profile lacks valid weights, no pooled weighted duration attribution or CPU-time shares are computed.',
                         'Save capture/bubble spans are synchronous event wall observations, not next-paint or exclusive serializer time.',
                         'Unprofiled Save has no Profiler, Tracing, Debugger or DOMStorage observation during the span; Runtime/Performance domains remain enabled. No exact native write count is claimed for these three contexts.',
                         'Native storage bytes and source identity are observed outside measured event intervals.',
                         'Source maps are optional external evidence and are not required or assumed by this script.']}
    def persist():
        temporary = args.output / 'report.json.tmp'
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        temporary.replace(args.output / 'report.json')
    persist()
    playwright = browser = request = None
    def deadline(signum, frame):
        raise TimeoutError('180-second diagnostic body or bounded cleanup deadline exceeded')
    signal.signal(signal.SIGALRM, deadline); BODY_DEADLINE = time.monotonic() + 180; signal.alarm(180)
    try:
        workload = fixture(args.fixture)
        report['fixture'] = {k: v for k, v in workload.items() if k not in ('raw', 'ready')}
        chrome = args.chromium or shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        require(chrome and Path(chrome).is_file(), 'Official CI Chrome executable unavailable')
        require(importlib.metadata.version('playwright') == '1.57.0', 'Expected pinned Playwright 1.57.0')
        from playwright.sync_api import sync_playwright
        playwright = sync_playwright().start()
        request = playwright.request.new_context()
        manifest = verify_release(request, args)
        request.dispose(); request = None
        browser = playwright.chromium.launch(executable_path=chrome, headless=True, timeout=20000, args=['--no-sandbox'])
        report['environment'] = {'browser': browser.version, 'playwright': importlib.metadata.version('playwright'),
                                 'python': platform.python_version(), 'platform': platform.platform(), 'headless': True, 'executable': chrome}
        execute_schedule(lambda kind, repetition: run_case(browser, workload, kind, repetition, args, manifest, report, persist),
                         report, persist, deadline=BODY_DEADLINE)
    except BaseException as error:
        report['errors'].append({'phase': report['phase'], 'type': type(error).__name__, 'message': str(error)[:2400]})
    finally:
        persist()
        cleanup_ok = True
        # 180-second body + at most three 5-second cleanup operations < 200 s.
        for label, closer in (('request', request.dispose if request else None), ('browser', browser.close if browser else None),
                              ('playwright', playwright.stop if playwright else None)):
            if closer:
                signal.alarm(5)
                try:
                    closer()
                except BaseException as error:
                    cleanup_ok = False
                    report['errors'].append({'phase': 'cleanup-' + label, 'type': type(error).__name__, 'message': str(error)[:500]})
        signal.alarm(0)
        report['globalCleanupComplete'] = cleanup_ok
        summarize_completion(report)
        report['phase'] = 'complete' if report['completed'] else 'invalid-or-incomplete'
        persist()
    print(json.dumps({'completed': report['completed'], 'weightedAttributionComplete': report['weightedAttributionComplete'],
                      'cases': len(report['runs']), 'weightedUnavailableCases': report['weightedUnavailableCases'], 'errors': report['errors']}), flush=True)
    return 0 if report['completed'] else 1


if __name__ == '__main__':
    sys.exit(main())
