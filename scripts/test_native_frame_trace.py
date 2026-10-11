"""Python-only observer contracts. No Node, browser, network or acceptance claim."""
from copy import deepcopy
import hashlib
import json
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
URL = 'https://example.invalid/Infinity/assets/index-native.js'


def plan(source=SOURCE):
    data = source.encode('utf-8')
    return trace.prepare_plan(URL, data, hashlib.sha256(data).hexdigest())


class FakeCDP:
    def __init__(self):
        self.handlers, self.calls = {}, []
        self.source = SOURCE
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
        for before, after in replacements:
            self.assertIn(before, SOURCE)
            with self.subTest(before=before), self.assertRaises(AssertionError):
                plan(SOURCE.replace(before, after))

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
    def observer(self):
        cdp = FakeCDP()
        observer = trace.NativeFrameTrace(cdp, plan())
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
