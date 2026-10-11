"""Python-only observer contracts. No Node, browser, network or acceptance claim.

The local dist is checked when present. Additional frozen CI dist directories can
be checked with INFINITY_NATIVE_TRACE_RELEASES (os.pathsep-separated paths); their
complete asset bytes must agree with each release manifest before preparation.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re
import unittest

import native_frame_trace as trace
from test_ring_protection_observer import HANDLER_R11, R12

# Literal minified structure specimen. These tests do not execute this JavaScript.
FRAME = ('function frame(e){const t=clock.gapSeconds(e);if(ge.mode!=="ready"){render(!1,e),'
         'window.requestAnimationFrame(frame);return}if(t>=back){const n=catchup(j,t);'
         'j=n.state,observe(),clock.account(e),n.appliedSeconds>=modal&&(pending=n);'
         'const r=bannerFor(n.newAchievementIds);r&&(banner=r),persist("已追赶后台进度",!0)}'
         'else if(t>0){const n=j.unlocked;j=tick(j,t),observe(),clock.account(e);'
         'const r=bannerFor(j.unlocked.filter(i=>!n.includes(i)));r&&(banner=r)}'
         'render(!1,e),window.requestAnimationFrame(frame)}')
# Explicit r13 shape, retaining the entire original branches and final paint/RAF.
PROTECTED_FRAME = (
    'function frame(e){const t=clock.gapSeconds(e);if(ge.mode!=="ready"){render(!1,e),'
    'window.requestAnimationFrame(frame);return}const source=j;try{if(t>=back){'
    'const n=catchup(j,t);j=n.state,observe(),clock.account(e),'
    'n.appliedSeconds>=modal&&(pending=n);const r=bannerFor(n.newAchievementIds);'
    'r&&(banner=r),persist("已追赶后台进度",!0)}else if(t>0){const n=j.unlocked;'
    'j=tick(j,t),observe(),clock.account(e);'
    'const r=bannerFor(j.unlocked.filter(i=>!n.includes(i)));r&&(banner=r)}}'
    'catch(error){if(!(error instanceof SettlementError))throw error;protect(error,source)}'
    'render(!1,e),window.requestAnimationFrame(frame)}')
PROTECT = ('function protect(e,t){j=t,ge.freezeSimulation(e),status=ge.message,notice=ge.notice,'
           'view.invalidateOrderAuthority(),view.observeContexts(j,!1,ge.message),scheduler.invalidate()}')
SETTLEMENT_ERROR = (
    'class SettlementError extends Error{constructor(t){'
    'super(`NPC 结算异常，当前候选未采用：${t instanceof Error?t.message:String(t)}`,{cause:t}),'
    'this.name="NpcSettlementError"}}')
FREEZE = (
    'freezeSimulation(t){return this.mode!=="ready"?this.blocked():'
    '(this.protectedRaw??(this.protectedRaw=this.expectedRaw??null),'
    'this.mode="protected",this.notice=protectionNotice,'
    'this.message=`结算异常，当前候选未采用：${t instanceof Error?t.message:"未知错误"}。${protectionNotice}`,'
    'this.cancelPendingImport(),{ok:!1,code:"protected",message:this.message})}')
CANCEL = 'cancelPendingImport(){this.intent+=1,this.preparation+=1}'
SAVE = ('saveCurrent(t,n,r){if(this.mode!=="ready")return this.blocked();let i;'
        'try{i=this.prepare(t,n,r)}catch(s){return this.invalid(s)}'
        'const o=this.writeCandidate(i,!1);return o.ok&&(this.intent+=1),o}')
SOURCE = ('// Astral character proves CDP UTF-16 column accounting: 🛰\n' + R12 +
          'class Session{constructor(store,now=Date.now()){const raw=store.getItem(KEY);'
          'if(this.expectedRaw=raw,raw===null){return}}' + SAVE + '}' +
          'const auto=15e3,back=5,modal=30,app=document.querySelector("#app");'
          'const store=local(),sample=sampleClock(),clock=new Clock(sample),'
          'ge=new Session(store,sample.wallAt),loaded=ge.loaded;'
          'let notice=ge.notice,status=ge.message,j=loaded.state,other=0;'
          'render();window.requestAnimationFrame(frame);window.setInterval(()=>persist(),auto);' + FRAME +
          'function persist(e,t=!1){world();const n=status,r=notice,i=ge.mode,'
          'o=t?ge.saveBackground(j,Date.now(),clock.lastTickAt):ge.save(j,Date.now(),clock.lastTickAt);'
          'o.ok?e&&(status=e):(status=o.message,notice=ge.notice),'
          '(status!==n||notice!==r||ge.mode!==i)&&scheduler.invalidate(),'
          'view.observeContexts(j,ge.mode==="ready",ge.message)}' +
          'function sampleClock(){return{wallAt:Date.now(),frameAt:performance.now()}}' + HANDLER_R11 + '}')
PROTECTED_SOURCE = (SOURCE.replace(FRAME, PROTECTED_FRAME).replace(SAVE, FREEZE + SAVE + CANCEL) +
                    SETTLEMENT_ERROR + PROTECT)
URL = 'https://example.invalid/Infinity/assets/index-native.js'


def plan(source=SOURCE):
    data = source.encode('utf-8')
    return trace.prepare_plan(URL, data, hashlib.sha256(data).hexdigest())


class FakeCDP:
    def __init__(self, source=SOURCE):
        self.handlers, self.calls = {}, []
        self.source = source
        self.early = False

    def on(self, name, callback):
        self.handlers[name] = callback

    def send(self, name, arguments=None):
        self.calls.append((name, deepcopy(arguments)))
        if name == 'Debugger.setBreakpointByUrl':
            return {'breakpointId': f'b{len(self.calls)}', 'locations': [{'scriptId': 'late'}] if self.early else []}
        if name == 'Debugger.getScriptSource':
            return {'scriptSource': self.source}
        return {}

    def emit(self, name, payload):
        self.handlers[name](payload)

    def execute(self, observer, context=3, script='s1'):
        self.emit('Debugger.scriptParsed', {'url': URL, 'scriptId': script, 'executionContextId': context})
        for binding_id, binding in observer.bindings.items():
            self.emit('Debugger.breakpointResolved', {'breakpointId': binding_id,
                'location': {'scriptId': script, **trace.location(observer.plan.source, binding['probe'].start)}})

    def record(self, observer, event, context=3):
        self.emit('Runtime.bindingCalled', {'name': observer.binding,
            'executionContextId': context, 'payload': json.dumps(event)})


def events():
    rows = [
        {'kind': 'source-read', 'raw': '{"revision":12,"state":{"untrusted":"candidate"}}', 'constructorNow': 1000},
        {'kind': 'ready', 'startupClock': {'wallAt': 1000, 'frameAt': 10.25}, 'mode': 'ready',
         'lastTickAt': 1000, 'state': {'npcEconomy': {'elapsedSeconds': 987}, 'totalTime': 'wrong'}},
        {'kind': 'frame', 'now': 20.5, 'gapSeconds': 0.01025, 'mode': 'ready', 'lastTickAtBefore': 1000},
        {'kind': 'frame-end', 'now': 20.5, 'mode': 'ready', 'lastTickAt': 1010.25},
        {'kind': 'action', 'actionType': 'save', 'mode': 'ready'},
        {'kind': 'save-input', 'savedAt': 1040, 'lastTickAt': 1010.25, 'mode': 'ready',
         'state': {'npcEconomy': {'elapsedSeconds': 456}, 'totalTime': 'wrong'}, 'expectedRaw': 'previous'},
        {'kind': 'frame', 'now': 7020.5, 'gapSeconds': 7, 'mode': 'ready', 'lastTickAtBefore': 1010.25},
        {'kind': 'save-input', 'savedAt': 8100, 'lastTickAt': 8010.25, 'mode': 'ready',
         'state': {'totalTime': 'do not feed into model'}, 'expectedRaw': 'save'},
        {'kind': 'frame-end', 'now': 7020.5, 'mode': 'ready', 'lastTickAt': 8010.25},
    ]
    # Persist parameters and the exact return from the same original save call.
    expanded = []
    for row in rows:
        if row['kind'] == 'save-input':
            manual = row['savedAt'] == 1040
            expanded.append({'kind': 'persist-input', 'mode': 'ready', 'background': not manual,
                             'nextStatus': '已保存到本地' if manual else '已追赶后台进度'})
            expanded.append(row)
            raw = json.dumps({'savedAt': row['savedAt'], 'lastTickAt': row['lastTickAt'], 'state': row['state']})
            expanded.append({'kind': 'save-result', 'mode': 'ready', 'ok': True,
                             'savedAt': row['savedAt'], 'lastTickAt': row['lastTickAt'],
                             'candidateRaw': raw, 'expectedRaw': raw})
        else:
            expanded.append(row)
    return [{**row, 'sequence': index, 'executionContextId': 3} for index, row in enumerate(expanded)]


class StructureTests(unittest.TestCase):
    def test_complete_native_source_and_eight_distinct_original_probes(self):
        p = plan()
        self.assertEqual([probe.kind for probe in p.probes],
                         ['source-read', 'ready', 'frame', 'frame-end', 'save-input', 'save-result', 'persist-input', 'action'])
        self.assertEqual(len({probe.start for probe in p.probes}), 8)
        ready = next(probe for probe in p.probes if probe.kind == 'ready')
        self.assertEqual(p.source[ready.start:ready.end], 'window.requestAnimationFrame')
        self.assertIn('startupClock:{wallAt:sample.wallAt,frameAt:sample.frameAt}', ready.payload)
        self.assertNotIn('Date.now', ''.join(probe.payload for probe in p.probes))
        self.assertNotIn('performance.now', ''.join(probe.payload for probe in p.probes))

    def test_complete_protected_shape_preserves_all_original_probe_statements_and_payloads(self):
        def observations(p):
            return [(probe.kind, probe.payload, p.source[probe.start:probe.end]) for probe in p.probes]
        self.assertEqual(observations(plan(PROTECTED_SOURCE)), observations(plan()))

    def test_protected_identifiers_can_change_but_must_not_shadow_guard_dependencies(self):
        renamed = PROTECTED_SOURCE
        for before, after in [('frame', '$frame'), ('source', '$snapshot'), ('SettlementError', '$NpcError'),
                              ('protect', '$protect'), ('clock', '$clock'), ('view', '$view'),
                              ('scheduler', '$scheduler')]:
            renamed = re.sub(r'(?<![\w$])' + re.escape(before) + r'(?![\w$])', lambda _: after, renamed)
        self.assertEqual(len(plan(renamed).probes), 8)
        for dependency in ('clock', 'catchup', 'tick', 'render', 'observe', 'persist', 'bannerFor',
                           'back', 'modal', 'banner', 'SettlementError', 'protect', 'error',
                           'window', 'frame', 'pending'):
            mutated = PROTECTED_FRAME.replace('source', dependency)
            with self.subTest(shadow=dependency), self.assertRaisesRegex(AssertionError, 'shadow'):
                plan(PROTECTED_SOURCE.replace(PROTECTED_FRAME, mutated))
        for original, mutated in (
            (PROTECTED_FRAME, PROTECTED_FRAME.replace('error', 'protect')),
            (PROTECT, PROTECT.replace('protect(e,t)', 'protect(view,t)').replace('freezeSimulation(e)',
                                                                                    'freezeSimulation(view)')),
            (SETTLEMENT_ERROR, re.sub(r'\bt\b', 'Error', SETTLEMENT_ERROR)),
            (SETTLEMENT_ERROR, re.sub(r'\bt\b', 'String', SETTLEMENT_ERROR)),
            (FREEZE, re.sub(r'\bt\b', 'Error', FREEZE)),
            (FREEZE, re.sub(r'\bt\b', 'protectionNotice', FREEZE)),
        ):
            with self.subTest(mutated=mutated), self.assertRaises(AssertionError):
                plan(PROTECTED_SOURCE.replace(original, mutated))

    def test_protection_helper_parameters_cannot_shadow_any_rollback_dependency(self):
        # This helper accesses only these six outer bindings. Its error/source
        # parameters must leave all six intact, including after a consistent rename.
        for parameter in ('e', 't'):
            for dependency in ('j', 'ge', 'status', 'notice', 'view', 'scheduler'):
                mutated = re.sub(r'\b' + parameter + r'\b', dependency, PROTECT)
                with self.subTest(parameter=parameter, shadow=dependency), self.assertRaisesRegex(AssertionError, 'shadow'):
                    plan(PROTECTED_SOURCE.replace(PROTECT, mutated))

    def test_guard_names_cannot_alias_frame_parameters_locals_or_registered_callback(self):
        # Changing the outer guard names can introduce shadowing even when the
        # snapshot/catch variable declarations themselves are unchanged.
        for guard in ('SettlementError', 'protect'):
            for dependency in ('e', 't', 'source', 'error', 'frame', 'window', 'Error', 'String'):
                mutated = re.sub(r'\b' + guard + r'\b', dependency, PROTECTED_SOURCE)
                with self.subTest(guard=guard, shadow=dependency), self.assertRaises(AssertionError):
                    plan(mutated)
        with self.assertRaises(AssertionError):
            plan(re.sub(r'\bSettlementError\b', 'protect', PROTECTED_SOURCE))

    def test_available_complete_release_bundles_are_prepared_offline(self):
        local = Path(__file__).resolve().parents[1] / 'dist'
        roots = ([local] if (local / 'release.json').is_file() else [])
        roots.extend(Path(value) for value in os.environ.get('INFINITY_NATIVE_TRACE_RELEASES', '').split(os.pathsep)
                     if value)
        if not roots:
            self.skipTest('no complete local release; literal grammar contracts still run')
        for root in roots:
            with self.subTest(release=str(root)):
                manifest = json.loads((root / 'release.json').read_text(encoding='utf-8'))
                assets = [(name, digest) for name, digest in manifest['files'].items()
                          if name.startswith('assets/') and name.endswith('.js')]
                self.assertEqual(len(assets), 1, 'exactly one production JavaScript release asset required')
                name, digest = assets[0]
                data = (root / name).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
                p = trace.prepare_plan('https://example.invalid/Infinity/' + name, data, digest)
                self.assertEqual(p.http_bytes, data)
                self.assertEqual(p.source.encode('utf-8'), data)
                self.assertEqual(len(p.probes), 8)

    def test_protected_frame_catch_snapshot_and_extra_opcodes_fail_closed(self):
        replacements = [
            ('const source=j;', 'const source=other;'), ('const source=j;', ''),
            ('const source=j;try{', 'const source=j;mutate();try{'),
            ('const source=j;', 'const source=j;clock.account(e);'),
            ('if(!(error instanceof SettlementError))throw error;', ''),
            ('if(!(error instanceof SettlementError))', 'if(error instanceof SettlementError)'),
            ('error instanceof SettlementError', 'error instanceof Error'),
            ('throw error;', 'throw source;'), ('throw error;', 'return;'),
            ('protect(error,source)', 'protect(error,j)'), ('protect(error,source)', 'protect(source,error)'),
            ('protect(error,source)', 'protect(error,source),clock.account(e)'),
            ('protect(error,source)', 'protect(error,source);mutate()'),
            ('}}catch(error)', '}}finally{mutate()}catch(error)'),
            ('const source=j;', 'const e=j;'),
            ('const source=j;', 'const protect=j;'),
            ('catch(error){', 'catch(source){'),
        ]
        for before, after in replacements:
            self.assertIn(before, PROTECTED_FRAME)
            with self.subTest(before=before, after=after), self.assertRaises(AssertionError):
                plan(PROTECTED_SOURCE.replace(PROTECTED_FRAME, PROTECTED_FRAME.replace(before, after)))

    def test_protected_helper_error_and_freeze_semantics_fail_closed_on_mutation(self):
        replacements = [
            ('j=t,ge.freezeSimulation(e)', 'j=e,ge.freezeSimulation(e)'),
            ('j=t,ge.freezeSimulation(e)', 'ge.freezeSimulation(e),j=t'),
            ('ge.freezeSimulation(e)', 'other.freezeSimulation(e)'),
            ('status=ge.message', 'status=other.message'), ('notice=ge.notice', 'notice=other.notice'),
            ('view.invalidateOrderAuthority(),', ''),
            ('view.invalidateOrderAuthority()', 'other.invalidateOrderAuthority()'),
            ('view.observeContexts(j,!1,ge.message)', 'view.observeContexts(j,!0,ge.message)'),
            ('view.observeContexts(j,!1,ge.message)', 'view.observeContexts(t,!1,ge.message)'),
            ('scheduler.invalidate()}', 'other.invalidate()}'),
            ('function protect(e,t){j=t', 'function protect(e,j){j=j'),
            ('function protect(e,t){j=t', 'function protect(ge,t){j=t'),
            ('extends Error{', 'extends OtherError{'),
            ('this.name="NpcSettlementError"', 'this.name="Error"'),
            ('{cause:t}', '{cause:other}'),
            ('this.protectedRaw=this.expectedRaw??null', 'this.protectedRaw=null'),
            ('this.mode="protected"', 'this.mode="ready"'),
            ('this.notice=protectionNotice', 'this.notice=other'),
            ('this.cancelPendingImport(),{ok:!1', 'this.cancelPendingImport(),write(),{ok:!1'),
            ('this.cancelPendingImport(),{ok:!1', '{ok:!1'),
            ('this.intent+=1,this.preparation+=1', 'this.intent+=1'),
        ]
        for before, after in replacements:
            self.assertIn(before, PROTECTED_SOURCE)
            with self.subTest(before=before, after=after), self.assertRaises(AssertionError):
                plan(PROTECTED_SOURCE.replace(before, after))

    def test_legacy_protected_or_unknown_duplicate_declarations_fail_closed(self):
        for source in (SOURCE, PROTECTED_SOURCE):
            for extra in (FRAME, PROTECTED_FRAME, 'function frame(e){mutate()}',
                          PROTECTED_FRAME.replace('throw error;', 'throw other;')):
                with self.subTest(protected=source == PROTECTED_SOURCE, extra=extra), self.assertRaises(AssertionError):
                    plan(source + extra)
        for extra in (PROTECT, 'function protect(e,t){mutate()}', SETTLEMENT_ERROR,
                      'class SettlementError extends Error{}', FREEZE,
                      'freezeSimulation(e){mutate()}', CANCEL, 'cancelPendingImport(){mutate()}'):
            with self.subTest(extra=extra), self.assertRaises(AssertionError):
                plan(PROTECTED_SOURCE + extra)

    def test_complete_http_hash_and_safe_exact_url_are_mandatory(self):
        for url, raw, digest in [('file:///asset.js', SOURCE.encode(), '0' * 64),
                                 (URL, SOURCE.encode(), '0' * 64),
                                 (URL, SOURCE, '0' * 64)]:
            with self.subTest(url=url), self.assertRaises(AssertionError):
                trace.prepare_plan(url, raw, digest)

    def test_changed_source_paths_or_injected_frame_work_fail_closed(self):
        replacements = [
            ('t>=back', 't>back'), ('back=5', 'back=6'), ('modal=30', 'modal=31'),
            ('const t=clock.gapSeconds(e);', 'const t=clock.gapSeconds(e);mutate();'),
            ('j=tick(j,t)', 'j=tick(j,t+1)'), ('catchup(j,t)', 'catchup(j,Math.min(t,1))'),
            ('clock.account(e)', 'clock.account(e+1)'), ('render(!1,e),window.requestAnimationFrame(frame)}',
                                                        'render(!1,e);window.requestAnimationFrame(frame)}'),
            ('new Session(store,sample.wallAt)', 'new Session(store,Date.now())'),
            ('frameAt:performance.now()', 'frameAt:0'),
            ('this.prepare(t,n,r)', 'this.prepare(t,n,n)'),
            ('this.writeCandidate(i,!1)', 'this.writeCandidate(i,!0)'),
            ('function persist(e,t=!1)', 'function persist(e,t=!0)'),
            ('ge.saveBackground(j,Date.now(),clock.lastTickAt)', 'ge.saveBackground(j,Date.now(),Date.now())'),
            ('world();const n=status', 'world();mutate();const n=status'),
            ('npcSave(e.npcEconomy)', 'npcSave(other.npcEconomy)'),
        ]
        for source in (SOURCE, PROTECTED_SOURCE):
            for before, after in replacements:
                self.assertIn(before, source)
                with self.subTest(protected=source == PROTECTED_SOURCE, before=before), self.assertRaises(AssertionError):
                    plan(source.replace(before, after))

    def test_duplicate_or_missing_original_structures_rejected(self):
        for extra in (FRAME, SAVE, R12, HANDLER_R11, 'window.requestAnimationFrame(other);window.setInterval'):
            with self.subTest(extra=extra[:50]), self.assertRaises(AssertionError):
                plan(SOURCE + extra)
        with self.assertRaises(AssertionError):
            plan(SOURCE.replace(FRAME, ''))

    def test_cdp_utf16_columns_roundtrip_astral_characters(self):
        text = 'x🛰y\n汉🛰z'
        for offset in range(len(text)):
            actual = trace.location(text, offset)
            self.assertEqual(trace.source_offset(text, actual['lineNumber'], actual['columnNumber']), offset)
        self.assertEqual(trace.location(text, 2), {'lineNumber': 0, 'columnNumber': 3})


class ObserverTests(unittest.TestCase):
    def observer(self, source=SOURCE):
        cdp = FakeCDP(source)
        observer = trace.NativeFrameTrace(cdp, plan(source))
        observer.install()
        return cdp, observer

    def test_install_only_registers_trace_binding_and_false_conditions(self):
        cdp, observer = self.observer()
        methods = [name for name, _ in cdp.calls]
        self.assertEqual(set(methods), {'Runtime.enable', 'Runtime.addBinding', 'Debugger.enable', 'Debugger.setBreakpointByUrl'})
        self.assertEqual(methods.count('Debugger.setBreakpointByUrl'), 8)
        for _, arguments in (call for call in cdp.calls if call[0] == 'Debugger.setBreakpointByUrl'):
            condition = arguments['condition']
            self.assertTrue(condition.endswith(')),false'))
            for forbidden in ('Date.now', 'performance.now', 'requestAnimationFrame(', 'setItem(',
                              'gapSeconds(', '.account(', 'tick(', 'catchup(', 'cancelPendingImport('):
                self.assertNotIn(forbidden, condition)
        with self.assertRaises(AssertionError):
            observer.install()

    def test_protected_observer_is_read_only_and_never_fabricates_zero_or_positive_gap_frames(self):
        cdp, observer = self.observer(PROTECTED_SOURCE)
        self.assertEqual(observer.snapshot()['events'], [])
        cdp.execute(observer)
        observer.verify_executed(PROTECTED_SOURCE.encode())
        self.assertEqual(observer.document_events(3), [])
        # Synthetic CDP input tests the observer contract, not a native run.
        rows = events()[:2] + [
            {'kind': 'frame', 'now': 10.25, 'gapSeconds': 0, 'mode': 'ready', 'lastTickAtBefore': 1000},
            {'kind': 'frame-end', 'now': 10.25, 'mode': 'ready', 'lastTickAt': 1000},
        ] + events()[2:]
        rows = [{**row, 'sequence': index, 'executionContextId': 3} for index, row in enumerate(rows)]
        for event in rows:
            cdp.record(observer, {key: value for key, value in event.items()
                                  if key not in ('sequence', 'executionContextId')})
        observed = observer.document_events(3)
        self.assertEqual(observed, rows)
        self.assertEqual([row['path'] for row in trace.replay_inputs(observed)['events']
                          if row['kind'] == 'frame'], ['skip', 'tick', 'catchUp'])
        conditions = [arguments['condition'] for method, arguments in cdp.calls
                      if method == 'Debugger.setBreakpointByUrl']
        self.assertEqual(len(conditions), 8)
        for condition in conditions:
            self.assertTrue(condition.endswith(')),false'))
            for forbidden in ('freezeSimulation(', 'protect(', 'invalidateOrderAuthority(',
                              'Date.now', 'performance.now', 'requestAnimationFrame(', 'setItem(',
                              'gapSeconds(', '.account(', 'tick(', 'catchup(', 'cancelPendingImport('):
                self.assertNotIn(forbidden, condition)

    def test_protected_failure_is_retained_without_fake_clock_adoption_or_successful_replay(self):
        cdp, observer = self.observer(PROTECTED_SOURCE)
        cdp.execute(observer)
        observer.verify_executed(PROTECTED_SOURCE.encode())
        rows = events()[:3] + [
            {'kind': 'frame-end', 'now': 20.5, 'mode': 'protected', 'lastTickAt': 1000},
            {'kind': 'frame', 'now': 30.5, 'gapSeconds': .02025, 'mode': 'protected',
             'lastTickAtBefore': 1000},
        ]
        rows = [{**row, 'sequence': index, 'executionContextId': 3} for index, row in enumerate(rows)]
        for event in rows:
            cdp.record(observer, {key: value for key, value in event.items()
                                  if key not in ('sequence', 'executionContextId')})
        self.assertEqual(observer.document_events(3), rows)
        self.assertEqual(observer.snapshot()['events'][-1]['lastTickAtBefore'], 1000)
        with self.assertRaisesRegex(AssertionError, 'observed ready mode'):
            trace.replay_inputs(observer.document_events(3))
        with self.assertRaisesRegex(AssertionError, 'observed ready mode'):
            trace.to_replay_epoch(observer.document_events(3))

    def test_protected_source_keeps_full_http_v8_and_resolved_statement_verification(self):
        for change in ('http', 'v8', 'location'):
            cdp, observer = self.observer(PROTECTED_SOURCE)
            cdp.execute(observer)
            data = PROTECTED_SOURCE.encode()
            if change == 'http':
                data += b'\n'
            elif change == 'v8':
                cdp.source += '\n'
            else:
                observer.resolutions[2]['location'].update(lineNumber=0, columnNumber=0)
            with self.subTest(change=change), self.assertRaises(AssertionError):
                observer.verify_executed(data)

    def test_actual_full_v8_source_and_unique_locations_required(self):
        cdp, observer = self.observer()
        cdp.execute(observer)
        for event in events():
            cdp.record(observer, {key: value for key, value in event.items() if key not in ('sequence', 'executionContextId')})
        with self.assertRaises(AssertionError):
            observer.document_events(3)
        verified = observer.verify_executed(SOURCE.encode())
        self.assertEqual(len(verified['s1']['locations']), 8)
        self.assertEqual(observer.document_events(3), events())
        self.assertEqual(observer.snapshot()['schema'], trace.SCHEMA)
        with self.assertRaises(AssertionError):
            observer.verify_executed((SOURCE + '\n').encode())

    def test_reload_contexts_are_separate_and_each_source_is_verified(self):
        cdp, observer = self.observer()
        cdp.execute(observer)
        observer.verify_executed(SOURCE.encode())
        cdp.execute(observer, context=4, script='s2')
        self.assertEqual(len(observer.verify_executed(SOURCE.encode())), 2)
        cdp.execute(observer, context=5, script='s3')
        cdp.source += '\n'
        with self.assertRaises(AssertionError):
            observer.verify_executed(SOURCE.encode())

    def test_missing_duplicate_or_out_of_scope_resolution_rejected(self):
        for change in ('missing', 'duplicate', 'moved'):
            cdp, observer = self.observer()
            cdp.execute(observer)
            if change == 'missing':
                observer.resolutions.pop()
            elif change == 'duplicate':
                observer.resolutions.append(deepcopy(observer.resolutions[0]))
            else:
                observer.resolutions[0]['location'].update(lineNumber=0, columnNumber=0)
            with self.subTest(change=change), self.assertRaises(AssertionError):
                observer.verify_executed(SOURCE.encode())

    def test_late_install_or_unexpected_pause_cannot_claim_native_acceptance(self):
        cdp = FakeCDP(); cdp.early = True
        with self.assertRaises(AssertionError):
            trace.NativeFrameTrace(cdp, plan()).install()
        cdp, observer = self.observer()
        cdp.execute(observer)
        cdp.emit('Debugger.paused', {'reason': 'unexpected'})
        with self.assertRaises(AssertionError):
            observer.verify_executed(SOURCE.encode())
        self.assertTrue(observer.snapshot()['failures'])

    def test_invalid_payload_or_foreign_context_rejected(self):
        cdp, observer = self.observer(); cdp.execute(observer)
        cdp.record(observer, {'kind': 'frame', 'sequence': 8})
        with self.assertRaises(AssertionError):
            observer.verify_executed(SOURCE.encode())
        cdp, observer = self.observer(); cdp.execute(observer)
        cdp.record(observer, {'kind': 'frame'}, context=999)
        with self.assertRaises(AssertionError):
            observer.verify_executed(SOURCE.encode())


class ReplayInputTests(unittest.TestCase):
    def test_exact_raw_frame_order_and_fractional_watermark(self):
        output = trace.replay_inputs(events())
        self.assertEqual([row['kind'] for row in output['events']], ['frame', 'save-input', 'save-result', 'frame', 'save-input', 'save-result'])
        self.assertEqual([row['path'] for row in output['events'] if row['kind'] == 'frame'], ['tick', 'catchUp'])
        self.assertEqual(output['events'][-1]['lastTickAt'], 8010.25)
        self.assertEqual(output['constructorNow'], 1000)
        self.assertNotEqual(output['constructorNow'], output['events'][1]['savedAt'])

    def test_no_candidate_state_npc_age_or_total_time_in_independent_projection(self):
        rows = events()
        before = trace.replay_inputs(rows)
        for row in rows:
            if 'state' in row:
                row['state'] = {'arbitrarily': 'changed'}
        self.assertEqual(before, trace.replay_inputs(rows))
        for row in before['events']:
            self.assertNotIn('state', row)
            self.assertNotIn('npcEconomy', row)
            self.assertNotIn('totalTime', row)

    def test_no_rounding_fitted_gap_candidate_clock_or_missing_frame_is_admitted(self):
        changes = [
            (0, 'constructorNow', 1001), (1, 'lastTickAt', 999), (1, 'mode', 'protected'),
            (2, 'gapSeconds', .01), (2, 'lastTickAtBefore', 1001), (2, 'now', 20.5000000001),
            (3, 'now', 20.6), (3, 'lastTickAt', 1010), (4, 'actionType', 'reset'),
            (6, 'lastTickAt', 1040), (8, 'mode', 'conflict'), (10, 'lastTickAt', 8100),
            (12, 'lastTickAt', 8010.25000001), (12, 'sequence', 1), (6, 'executionContextId', 4),
            (7, 'ok', False), (7, 'ok', 1), (7, 'expectedRaw', 'wrong'), (7, 'savedAt', 1041),
            (5, 'nextStatus', '已自动保存'), (5, 'background', True), (9, 'background', False),
        ]
        for index, key, value in changes:
            rows = events(); rows[index][key] = value
            with self.subTest(index=index, key=key), self.assertRaises(AssertionError):
                trace.replay_inputs(rows)
        for index in range(13):
            rows = events(); rows.pop(index)
            with self.subTest(missing=index), self.assertRaises(AssertionError):
                trace.replay_inputs(rows)

    def test_nonfinite_boolean_negative_clocks_and_incomplete_trace_rejected(self):
        for bad in (True, None, float('nan'), float('inf'), -1, 2**53):
            rows = events(); rows[2]['now'] = bad
            with self.subTest(bad=bad), self.assertRaises(AssertionError):
                trace.replay_inputs(rows)
        with self.assertRaises(AssertionError):
            trace.replay_inputs(events()[:-1])

    def test_early_native_raf_timestamp_may_precede_paired_startup_sample(self):
        rows = events()[:2]
        rows.extend([
            {'kind': 'frame', 'now': 10, 'gapSeconds': 0, 'mode': 'ready', 'lastTickAtBefore': 1000,
             'sequence': 2, 'executionContextId': 3},
            {'kind': 'frame-end', 'now': 10, 'mode': 'ready', 'lastTickAt': 1000,
             'sequence': 3, 'executionContextId': 3},
        ])
        self.assertEqual(trace.replay_inputs(rows)['events'][0]['path'], 'skip')

    def test_oracle_adapter_keeps_states_only_as_unmodified_assertion_targets(self):
        rows = events(); before = deepcopy(rows)
        epoch = trace.to_replay_epoch(rows)
        self.assertEqual(epoch['sourceRaw'], rows[0]['raw'])
        self.assertEqual(epoch['ready']['state'], rows[1]['state'])
        self.assertEqual(epoch['events'][3]['state'], rows[6]['state'])
        self.assertNotIn('sequence', epoch['events'][0])
        self.assertNotIn('executionContextId', epoch['events'][0])
        self.assertEqual(rows, before)
        self.assertNotIn('migrationRaw', epoch)
        self.assertEqual([row['reason'] for row in epoch['events'] if row['kind'] == 'save'], ['manual', 'catchUp'])


    def test_manual_cutoff_is_original_synchronous_result_without_later_autosave(self):
        prefix = trace.through_manual_save(events(), after_sequence=3)
        self.assertEqual(prefix[-1]['kind'], 'save-result')
        self.assertEqual(prefix[-1]['savedAt'], 1040)
        self.assertEqual(len(prefix), 8)
        with self.assertRaises(AssertionError):
            trace.through_manual_save(events()[:7], after_sequence=3)
        with self.assertRaises(AssertionError):
            trace.through_manual_save(events(), after_sequence=4)
        broken = events(); broken[5]['nextStatus'] = '已自动保存'; broken[5]['background'] = True
        with self.assertRaises(AssertionError):
            trace.through_manual_save(broken, after_sequence=3)

    def test_beforeunload_then_hidden_are_two_distinct_real_saves_with_unchanged_watermark(self):
        rows = events()[:2]
        for reason, saved_at, background in [('beforeunload', 1200, False), ('visibility-hidden', 1206, True)]:
            raw = json.dumps({'savedAt': saved_at, 'lastTickAt': 1000, 'state': {'same': 'state'}})
            rows.extend([
                {'kind': 'persist-input', 'mode': 'ready', 'nextStatus': None, 'background': background},
                {'kind': 'save-input', 'mode': 'ready', 'savedAt': saved_at, 'lastTickAt': 1000,
                 'state': {'same': 'state'}, 'expectedRaw': 'source'},
                {'kind': 'save-result', 'mode': 'ready', 'savedAt': saved_at, 'lastTickAt': 1000,
                 'ok': True, 'candidateRaw': raw, 'expectedRaw': raw},
            ])
        rows = [{**row, 'sequence': index, 'executionContextId': 3} for index, row in enumerate(rows)]
        saved = [row for row in trace.to_replay_epoch(rows)['events'] if row['kind'] == 'save']
        self.assertEqual([row['reason'] for row in saved], ['beforeunload', 'visibility-hidden'])
        self.assertEqual([row['savedAt'] for row in saved], [1200, 1206])
        self.assertEqual([row['lastTickAt'] for row in saved], [1000, 1000])


if __name__ == '__main__':
    unittest.main()
