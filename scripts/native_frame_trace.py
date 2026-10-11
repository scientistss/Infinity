"""Read-only native reload trace preparation (not a browser acceptance result).

Create a plan from the real release URL's complete, hash-verified HTTP bytes. Install
it on a fresh page's CDP session BEFORE goto, then verify each executed V8 source
and resolved location after navigation. Conditions always return false. Runtime's
new, trace-only binding delivers observations directly to the host; no INIT script,
clock/RAF/storage replacement, production assignment, or handler invocation occurs.

This intentionally narrow grammar fails closed on unsupported builds. The parent
must separately verify release/source provenance, HTTP responses for navigation,
native durable writes and the fixed-ca5 full-state oracle. This observer adds normal
observation overhead and MUST NOT be installed in CPU/performance measurement runs.
"""
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
from urllib.parse import urlparse
import uuid

_SPEC = importlib.util.spec_from_file_location(
    '_native_trace_ring_parsers', Path(__file__).with_name('browser-ring-protection.py'))
_RING = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_RING)
ID = r'[A-Za-z_$][A-Za-z0-9_$]*'
SCHEMA = 'infinity-native-frame-trace-v1'


def require(ok, message):
    if not ok:
        raise AssertionError(message)


def unique(pattern, text, label):
    matches = list(re.finditer(pattern, text))
    require(len(matches) == 1, f'{label}: expected one complete match, got {len(matches)}')
    return matches[0]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def location(text, offset):
    """CDP columns are UTF-16 units, not Python Unicode code points."""
    line_start = text.rfind('\n', 0, offset) + 1
    return {'lineNumber': text.count('\n', 0, offset),
            'columnNumber': len(text[line_start:offset].encode('utf-16-le')) // 2}


def source_offset(text, line, column):
    lines = text.splitlines(keepends=True)
    require(0 <= line < len(lines), 'resolved line is outside the source')
    encoded = lines[line].encode('utf-16-le')
    require(0 <= column * 2 <= len(encoded), 'resolved column is outside the source')
    return sum(len(part) for part in lines[:line]) + len(encoded[:column * 2].decode('utf-16-le'))


@dataclass(frozen=True)
class Probe:
    kind: str
    start: int
    end: int
    payload: str


@dataclass(frozen=True)
class Plan:
    url: str
    source: str
    http_bytes: bytes
    release_sha256: str
    probes: tuple


def prepare_plan(url, http_bytes, release_sha256):
    """Pure preparation; performs no HTTP/browser/Node work and changes no files."""
    parsed = urlparse(url)
    require(parsed.scheme in ('http', 'https') and parsed.netloc and not parsed.fragment,
            'an exact HTTP release asset URL is required')
    require(type(http_bytes) is bytes and re.fullmatch('[0-9a-f]{64}', release_sha256),
            'complete HTTP bytes and exact release SHA-256 are required')
    require(sha256(http_bytes) == release_sha256, 'HTTP asset differs from pinned release')
    source = http_bytes.decode('utf-8')
    require(source.encode('utf-8') == http_bytes, 'source must round-trip as exact UTF-8')
    handlers, serializers = _RING.production_action_handlers(source), _RING.production_serializers(source)
    require(len(handlers) == len(serializers) == 1, 'one original handler and complete pure serializer required')
    handler = handlers[0]
    session, state = handler.group('session'), handler.group('state')
    serializer = serializers[0].group('name')
    S, ST = re.escape(session), re.escape(state)
    startup = unique(
        rf'const (?P<store>{ID})={ID}\(\),(?P<sample>{ID})=(?P<sample_fn>{ID})\(\),'
        rf'(?P<clock>{ID})=new (?P<clock_class>{ID})\((?P=sample)\),'
        rf'{S}=new (?P<session_class>{ID})\((?P=store),(?P=sample)\.wallAt\),'
        rf'(?P<loaded>{ID})={S}\.loaded;let (?P<notice>{ID})={S}\.notice,(?P<status>{ID})={S}\.message,{ST}=(?P=loaded)\.state,',
        source, 'original paired-clock/session/state startup')
    sample, clock = startup.group('sample'), startup.group('clock')
    C = re.escape(clock)
    unique(r'function ' + re.escape(startup.group('sample_fn')) +
           r'\(\)\{return\{wallAt:Date.now\(\),frameAt:performance.now\(\)\}\}', source,
           'original paired native clock sampler')
    registration = unique(r'window\.requestAnimationFrame\((?P<frame>' + ID +
                          r')\);window\.setInterval', source, 'first application RAF registration')
    frame = registration.group('frame')
    F = re.escape(frame)
    # Match the ENTIRE original frame. No injected calls/branches or shortened
    # prefix can authorize a different simulation path.
    frame_match = unique(
        rf'function {F}\((?P<now>{ID})\)\{{const (?P<gap>{ID})={C}\.gapSeconds\((?P=now)\);'
        rf'(?P<start>if\({S}\.mode!=="ready"\))\{{(?P<render>{ID})\(!1,(?P=now)\),'
        rf'window\.requestAnimationFrame\({F}\);return\}}'
        rf'if\((?P=gap)>=(?P<threshold>{ID})\)\{{const (?P<result>{ID})=(?P<catchup>{ID})\({ST},(?P=gap)\);'
        rf'{ST}=(?P=result)\.state,(?P<observe>{ID})\(\),{C}\.account\((?P=now)\),'
        rf'(?P=result)\.appliedSeconds>=(?P<modal>{ID})&&\({ID}=(?P=result)\);'
        rf'const (?P<unlock>{ID})=(?P<banner_fn>{ID})\((?P=result)\.newAchievementIds\);'
        rf'(?P=unlock)&&\((?P<banner>{ID})=(?P=unlock)\),(?P<persist>{ID})\("已追赶后台进度",!0\)'
        rf'\}}else if\((?P=gap)>0\)\{{const (?P<before>{ID})={ST}\.unlocked;'
        rf'{ST}=(?P<tick>{ID})\({ST},(?P=gap)\),(?P=observe)\(\),{C}\.account\((?P=now)\);'
        rf'const (?P<live_unlock>{ID})=(?P=banner_fn)\({ST}\.unlocked\.filter\((?P<id>{ID})=>!'
        rf'(?P=before)\.includes\((?P=id)\)\)\);(?P=live_unlock)&&\((?P=banner)=(?P=live_unlock)\)\}}'
        rf'(?P<end>(?P=render)\(!1,(?P=now)\)),window\.requestAnimationFrame\({F}\)\}}',
        source, 'complete original native frame')
    unique(r'const ' + ID + r'=(?:15e3|15000),' + re.escape(frame_match.group('threshold')) +
           r'=5,' + re.escape(frame_match.group('modal')) + r'=30,', source, 'fixed original frame thresholds')
    ctor = unique(r'class ' + re.escape(startup.group('session_class')) +
                  rf'\{{constructor\((?P<store>{ID}),(?P<now>{ID})=Date.now\(\)\)\{{',
                  source, 'original SaveSession constructor')
    read = unique(rf'const (?P<raw>{ID})={re.escape(ctor.group("store"))}\.getItem\({ID}\);'
                  rf'(?P<at>if\(this.expectedRaw=(?P=raw),(?P=raw)===null\))',
                  source[ctor.end():], 'original SaveSession storage read')
    read_start, read_end = ctor.end() + read.start('at'), ctor.end() + read.end('at')
    save = unique(
        rf'saveCurrent\((?P<state>{ID}),(?P<now>{ID}),(?P<last>{ID})\)\{{'
        rf'(?P<at>if\(this.mode!=="ready"\))return this.blocked\(\);let (?P<raw>{ID});'
        rf'try\{{(?P=raw)=this.prepare\((?P=state),(?P=now),(?P=last)\)\}}catch\((?P<error>{ID})\)'
        rf'\{{return this.invalid\((?P=error)\)\}}const (?P<result>{ID})=this.writeCandidate\((?P=raw),!1\);'
        rf'(?P<result_at>return (?P=result)\.ok)&&\(this.intent\+=1\),(?P=result)\}}',
        source, 'complete original SaveSession saveCurrent')
    require(ctor.start() < read_start < save.start(), 'storage read belongs to the original constructor')
    status, notice = re.escape(startup.group('status')), re.escape(startup.group('notice'))
    persist = unique(
        r'function ' + re.escape(frame_match.group('persist')) +
        rf'\((?P<next>{ID}),(?P<background>{ID})=!1\)\{{(?P<at>{ID}\(\));'
        rf'const (?P<before_status>{ID})={status},(?P<before_notice>{ID})={notice},'
        rf'(?P<before_mode>{ID})={S}\.mode,(?P<result>{ID})=(?P=background)\?'
        rf'{S}\.saveBackground\({ST},Date.now\(\),{C}\.lastTickAt\):'
        rf'{S}\.save\({ST},Date.now\(\),{C}\.lastTickAt\);'
        rf'(?P=result)\.ok\?(?P=next)&&\({status}=(?P=next)\):'
        rf'\({status}=(?P=result)\.message,{notice}={S}\.notice\),'
        rf'\({status}!==(?P=before_status)\|\|{notice}!==(?P=before_notice)\|\|{S}\.mode!==(?P=before_mode)\)'
        rf'&&{ID}\.invalidate\(\),{ID}\.observeContexts\({ST},{S}\.mode===\"ready\",{S}\.message\)\}}',
        source, 'complete original persist wrapper')
    now, gap = frame_match.group('now'), frame_match.group('gap')
    state_json = f'{serializer}({state})'
    action_start = source.index('{', handler.start()) + 1
    # Handler's optional uninitialized var list has no side effects, and V8 can
    # resolve past it to cancelPendingImport; the action parameter already exists.
    action_end = source.index('.cancelPendingImport()', action_start) + len('.cancelPendingImport()')
    probes = (
        Probe('source-read', read_start, read_end,
              f'raw:{read.group("raw")},constructorNow:{ctor.group("now")}'),
        Probe('ready', registration.start(), registration.start() + len('window.requestAnimationFrame'),
              f'startupClock:{{wallAt:{sample}.wallAt,frameAt:{sample}.frameAt}},'
              f'mode:{session}.mode,lastTickAt:{clock}.lastTickAt,state:{state_json}'),
        Probe('frame', frame_match.start('start'), frame_match.end('start'),
              f'now:{now},gapSeconds:{gap},mode:{session}.mode,lastTickAtBefore:{clock}.lastTickAt'),
        Probe('frame-end', frame_match.start('end'), frame_match.end('end'),
              f'now:{now},mode:{session}.mode,lastTickAt:{clock}.lastTickAt'),
        Probe('save-input', save.start('at'), save.end('at'),
              f'savedAt:{save.group("now")},lastTickAt:{save.group("last")},mode:this.mode,'
              f'state:{serializer}({save.group("state")}),expectedRaw:this.expectedRaw'),
        Probe('save-result', save.start('result_at'), save.end('result_at'),
              f'ok:{save.group("result")}.ok,candidateRaw:{save.group("raw")},expectedRaw:this.expectedRaw,'
              f'savedAt:{save.group("now")},lastTickAt:{save.group("last")},mode:this.mode'),
        Probe('persist-input', persist.start('at'), persist.end('at'),
              f'nextStatus:typeof {persist.group("next")}==="undefined"?null:{persist.group("next")},'
              f'background:{persist.group("background")},mode:{session}.mode'),
        Probe('action', action_start, action_end,
              f'actionType:{handler.group("action")}.type,mode:{session}.mode'),
    )
    return Plan(url, source, http_bytes, release_sha256, probes)


class NativeFrameTrace:
    """Caller-owned CDP session; importing/constructing this class starts nothing.

    install() must precede the first navigation. Keep this session attached across
    reloads. verify_executed() validates each observed execution before its events
    may be used as acceptance evidence. snapshot() retains all raw observations,
    including failures. This class never launches/navigates/pauses a browser.
    """
    def __init__(self, cdp, plan):
        self.cdp, self.plan = cdp, plan
        self.binding = '__infinityNativeTrace_' + uuid.uuid4().hex
        self.events, self.scripts, self.resolutions, self.failures = [], [], [], []
        self.bindings, self.verified_scripts = {}, {}
        self.installed = False

    def install(self):
        require(not self.installed, 'trace can only be installed once, before navigation')
        self.cdp.on('Runtime.bindingCalled', self._record)
        self.cdp.on('Debugger.scriptParsed', self._script)
        self.cdp.on('Debugger.breakpointResolved', lambda row: self.resolutions.append(deepcopy(row)))
        self.cdp.on('Debugger.paused', lambda row: self.failures.append({'unexpectedPause': deepcopy(row)}))
        self.cdp.send('Runtime.enable')
        self.cdp.send('Runtime.addBinding', {'name': self.binding})
        self.cdp.send('Debugger.enable')
        require(not self.scripts, 'application already parsed: pre-navigation installation required')
        for probe in self.plan.probes:
            expression = (f'globalThis[{json.dumps(self.binding)}](JSON.stringify('
                          f'{{kind:{json.dumps(probe.kind)},{probe.payload}}})),false')
            result = self.cdp.send('Debugger.setBreakpointByUrl', {
                'url': self.plan.url, **location(self.plan.source, probe.start), 'condition': expression})
            require(not result.get('locations'), 'breakpoint resolved too early; first frame might be missed')
            require(result['breakpointId'] not in self.bindings, 'distinct probes must have distinct bindings')
            self.bindings[result['breakpointId']] = {'probe': probe, 'condition': expression}
        self.installed = True

    def _script(self, row):
        if row.get('url') == self.plan.url:
            self.scripts.append(deepcopy(row))

    def _record(self, row):
        if row.get('name') != self.binding:
            return
        try:
            event = json.loads(row['payload'])
            require(type(event) is dict and event.get('kind') in {p.kind for p in self.plan.probes},
                    'unknown observation kind')
            require(not ({'sequence', 'executionContextId'} & event.keys()), 'reserved observation keys')
            self.events.append({**event, 'sequence': len(self.events), 'executionContextId': row['executionContextId']})
        except (AssertionError, KeyError, ValueError, TypeError) as error:
            self.failures.append({'invalidObservation': deepcopy(row), 'error': str(error)})

    def verify_executed(self, response_bytes):
        """Supply actual navigation HTTP response body, not the prefetch body alone.

        A caller invokes this after every document load, before asserting its trace.
        All source contexts captured so far must remain byte-identical to the plan.
        """
        require(self.installed and not self.failures, 'uninstalled or failed trace')
        require(type(response_bytes) is bytes and response_bytes == self.plan.http_bytes,
                'actual navigation HTTP bytes differ from the preverified release asset')
        require(bool(self.scripts), 'actual V8 script execution has not been observed')
        contexts = set()
        for script in self.scripts:
            script_id, context = script['scriptId'], script['executionContextId']
            require(context not in contexts, 'application executes more than once in a document context')
            contexts.add(context)
            if script_id not in self.verified_scripts:
                source = self.cdp.send('Debugger.getScriptSource', {'scriptId': script_id})['scriptSource']
                require(source.encode('utf-8') == self.plan.http_bytes and
                        sha256(source.encode('utf-8')) == self.plan.release_sha256,
                        'actual V8 source differs from HTTP/release bytes')
                locations = []
                for binding_id, binding in self.bindings.items():
                    rows = [row['location'] for row in self.resolutions if row.get('breakpointId') == binding_id
                            and row.get('location', {}).get('scriptId') == script_id]
                    require(len(rows) == 1, f'{binding["probe"].kind}: exactly one real resolved location required')
                    offset = source_offset(source, rows[0]['lineNumber'], rows[0]['columnNumber'])
                    probe = binding['probe']
                    require(probe.start <= offset < probe.end,
                            f'{probe.kind}: V8 resolution escaped the safe observation statement')
                    locations.append({'kind': probe.kind, 'location': rows[0]})
                self.verified_scripts[script_id] = {'executionContextId': context,
                    'sha256': self.plan.release_sha256, 'bytes': len(self.plan.http_bytes), 'locations': locations}
        require(all(row['executionContextId'] in contexts for row in self.events), 'observation from unverified script context')
        return deepcopy(self.verified_scripts)

    def snapshot(self):
        return {'schema': SCHEMA, 'url': self.plan.url, 'releaseSha256': self.plan.release_sha256,
                'observationOnly': True, 'notForCpuMeasurement': True,
                'events': deepcopy(self.events), 'failures': deepcopy(self.failures),
                'executedScripts': deepcopy(self.verified_scripts)}

    def document_events(self, context_id):
        require(not self.failures, 'trace has observation failures')
        require(any(row['executionContextId'] == context_id for row in self.verified_scripts.values()),
                'V8 source/location identity must be verified first')
        return [deepcopy(row) for row in self.events if row['executionContextId'] == context_id]


def replay_inputs(events):
    """Validate ready-only, no-economic-action trace and project independent inputs.

    Candidate state/NPC age/totalTime never enter this projection. sourceRaw is an
    identity witness only: a later r12 document must be checked against the previous
    independently replayed save, never used to bootstrap its own economy oracle.
    Full ready/save-input states remain in the separate original trace for comparison.
    Native write success/raw bytes must be supplied independently by the parent.
    """
    require(type(events) is list and len(events) >= 2, 'complete document observations required')
    source, ready, active = None, None, None
    pending_persist, pending_save, manual = None, None, False
    active_path, active_saves = None, 0
    accounted, frame_at, wall_at = None, None, None
    operations = []
    prior_sequence = -1
    context = events[0].get('executionContextId')

    def number(value, label):
        require(type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 2**53 - 1,
                f'{label}: finite nonnegative safe number required')
        return value

    def watermark():
        return wall_at + (accounted - frame_at)

    for event in events:
        require(event.get('executionContextId') == context and type(event.get('sequence')) is int
                and event['sequence'] > prior_sequence, 'ordered observations from one context required')
        prior_sequence = event['sequence']
        kind = event.get('kind')
        if kind == 'source-read':
            require(source is None and ready is None, 'exactly one source read before startup required')
            require(type(event.get('raw')) is str, 'existing raw save required for native reload replay')
            number(event.get('constructorNow'), 'constructorNow')
            source = event
            continue
        if kind == 'ready':
            require(source is not None and ready is None, 'exactly one ready observation after the actual read required')
            sample = event.get('startupClock')
            require(type(sample) is dict and set(sample) == {'wallAt', 'frameAt'}, 'original paired clock required')
            wall_at, frame_at = number(sample['wallAt'], 'wallAt'), number(sample['frameAt'], 'frameAt')
            require(wall_at == source['constructorNow'], 'constructor must receive the captured paired wall clock')
            accounted = frame_at
            require(event.get('mode') == 'ready' and event.get('lastTickAt') == watermark(), 'ready startup watermark required')
            ready = event
            continue
        require(ready is not None and event.get('mode') == 'ready', 'all replayed work requires observed ready mode')
        if kind == 'frame':
            require(active is None and pending_persist is None and pending_save is None and not manual,
                    'prior frame/save/action must finish before another starts')
            now = number(event.get('now'), 'native RAF now')
            gap = number(event.get('gapSeconds'), 'actual frame gap')
            can_account = now >= accounted and 0 <= wall_at + (now - frame_at) <= 2**53 - 1
            expected_gap = (now - accounted) / 1000 if can_account else 0
            require(gap == expected_gap and event.get('lastTickAtBefore') == watermark(), 'frame gap/watermark disagrees with original paired inputs')
            active = now
            path = 'catchUp' if gap >= 5 else 'tick' if gap > 0 else 'skip'
            active_path, active_saves = path, 0
            operations.append({'kind': 'frame', 'sequence': event['sequence'], 'now': now,
                               'gapSeconds': gap, 'mode': 'ready', 'lastTickAtBefore': watermark(), 'path': path})
            if gap > 0:
                accounted = now
        elif kind == 'frame-end':
            require(active is not None and pending_persist is None and pending_save is None
                    and event.get('now') == active and event.get('lastTickAt') == watermark(),
                    'matching completed frame and adopted watermark required')
            require(active_saves == (1 if active_path == 'catchUp' else 0),
                    'exact original frame persistence count required')
            active = None
        elif kind == 'persist-input':
            require(pending_persist is None and pending_save is None, 'no overlapping native persist calls')
            pair = (event.get('nextStatus'), event.get('background'))
            require(type(pair[1]) is bool, 'actual persist background boolean required')
            reasons = {('已保存到本地', False): 'manual', ('已自动保存', True): 'autosave',
                       ('已追赶后台进度', True): 'catchUp', (None, True): 'visibility-hidden',
                       (None, False): 'beforeunload'}
            require(pair in reasons, 'unsupported native persist parameters')
            reason = reasons[pair]
            require((reason == 'manual') == manual, 'manual persist must match its actual save action')
            require((reason == 'catchUp') == (active is not None), 'only actual catchUp persists inside a frame')
            if active is not None:
                require(active_path == 'catchUp' and active_saves == 0, 'only one catchUp persistence is allowed')
            pending_persist = reason
        elif kind == 'save-input':
            require(pending_persist is not None and pending_save is None, 'save input needs its original persist entry')
            pending_save = event
            saved_at = number(event.get('savedAt'), 'actual persistence wall clock')
            require(event.get('lastTickAt') == watermark(), 'normal persistence must receive the actual accounted watermark')
            operations.append({'kind': 'save-input', 'sequence': event['sequence'], 'savedAt': saved_at,
                               'lastTickAt': event['lastTickAt'], 'mode': 'ready'})
        elif kind == 'save-result':
            require(pending_save is not None and pending_persist is not None, 'save result needs its exact original save input')
            require(event.get('ok') is True and type(event.get('candidateRaw')) is str
                    and event.get('candidateRaw') == event.get('expectedRaw'), 'successful original save/readback result required')
            require(event.get('savedAt') == pending_save['savedAt'] and event.get('lastTickAt') == pending_save['lastTickAt'],
                    'save result must retain the same original call arguments')
            envelope = json.loads(event['candidateRaw'])
            require(envelope.get('savedAt') == event['savedAt'] and envelope.get('lastTickAt') == event['lastTickAt'],
                    'candidate bytes must retain both actual persistence arguments')
            operations.append({'kind': 'save-result', 'sequence': event['sequence'], 'savedAt': event['savedAt'],
                               'lastTickAt': event['lastTickAt'], 'reason': pending_persist})
            if active is not None:
                active_saves += 1
            pending_save, pending_persist, manual = None, None, False
        elif kind == 'action':
            require(active is None and pending_persist is None and pending_save is None and not manual,
                    'native action cannot interleave a frame/save/action')
            require(event.get('actionType') in ('save', 'dismiss-notice', 'dismiss-offline'),
                    'economic/replacement actions are outside this native reload trace contract')
            manual = event['actionType'] == 'save'
        else:
            raise AssertionError(f'unsupported observation: {kind}')
    require(ready is not None and active is None and pending_persist is None and pending_save is None and not manual,
            'startup and every started frame/persist/action must be completely observed')
    return {'schema': SCHEMA, 'sourceRaw': source['raw'], 'constructorNow': source['constructorNow'],
            'startupClock': deepcopy(ready['startupClock']), 'events': operations}


def to_replay_epoch(events):
    """Map observed successful saves into the fixed-ca5 oracle's assertion schema.

    Candidate state/raw fields are only comparison targets. Before invoking the
    oracle the parent MUST independently verify these raw writes with the native
    Storage audit/CDP stream and final readback. Add migrationRaw separately from
    the actual initial migration write. This adapter never fabricates durable IO.
    """
    inputs = replay_inputs(events)
    ready = next(row for row in events if row['kind'] == 'ready')
    results = {row['sequence']: row for row in inputs['events'] if row['kind'] == 'save-result'}
    converted = []
    for row in events:
        if row['kind'] in ('source-read', 'ready', 'persist-input'):
            continue
        if row['kind'] == 'save-result':
            converted.append({'kind': 'save', 'raw': row['candidateRaw'], 'savedAt': row['savedAt'],
                              'lastTickAt': row['lastTickAt'], 'reason': results[row['sequence']]['reason']})
        else:
            converted.append({key: deepcopy(value) for key, value in row.items()
                              if key not in ('sequence', 'executionContextId')})
    return {'constructorNow': inputs['constructorNow'], 'startupClock': inputs['startupClock'],
            'sourceRaw': inputs['sourceRaw'],
            'ready': {key: deepcopy(ready[key]) for key in ('mode', 'lastTickAt', 'state')},
            'events': converted}


def through_manual_save(events, after_sequence):
    """Cut after the first complete manual save action following a host marker.

    The prefix retains every earlier frame/save. It is validated in full, so no
    truncated frame, wrong save cause, skipped result or later autosave can supply
    the requested manual boundary. Native external readback is still mandatory.
    """
    require(type(after_sequence) is int, 'exact pre-click host sequence marker required')
    action = next((index for index, row in enumerate(events) if row['sequence'] > after_sequence
                   and row['kind'] == 'action' and row.get('actionType') == 'save'), None)
    require(action is not None, 'actual manual save action has not been observed')
    end = next((index for index in range(action + 1, len(events)) if events[index]['kind'] == 'save-result'), None)
    require(end is not None, 'actual manual save has not returned')
    prefix = deepcopy(events[:end + 1])
    projected = replay_inputs(prefix)
    require(projected['events'][-1].get('reason') == 'manual', 'cutoff must be the requested manual save result')
    return prefix
