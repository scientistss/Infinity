"""Stdlib-only negative tests for the current native diagnostic; no browser."""
import importlib.util
from contextlib import ExitStack, contextmanager
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('current_fleet_profile', Path(__file__).with_name('profile-current-fleet.py'))
P = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P)


def profile():
    return {'startTime': 1000, 'endTime': 7000, 'nodes': [
        {'id': 1, 'callFrame': {'functionName': '(root)', 'scriptId': '0', 'url': ''}, 'children': [2, 4]},
        {'id': 2, 'callFrame': {'functionName': 'wrapper', 'scriptId': '5', 'url': 'http://test/app.js', 'lineNumber': 0, 'columnNumber': 3}, 'children': [3]},
        {'id': 3, 'callFrame': {'functionName': 'querySelector', 'scriptId': '0', 'url': ''}},
        {'id': 4, 'callFrame': {'functionName': 'currentFleetBubble', 'scriptId': '9', 'url': P.OBSERVER_URL}}],
        'samples': [2, 3, 4], 'timeDeltas': [1000, 2000, 3000]}


PRODUCTION_SOURCE = 'a🚀function wrapper(){}'
IDENTITIES = {'5': {'url': 'http://test/app.js', 'kind': 'production', 'sha256': P.digest(PRODUCTION_SOURCE)},
              '9': {'url': P.OBSERVER_URL, 'kind': 'diagnostic-observer', 'sha256': P.digest(P.OBSERVER_SOURCE)}}
SOURCES = {P.source_key('5', P.digest(PRODUCTION_SOURCE)): PRODUCTION_SOURCE,
           P.source_key('9', P.digest(P.OBSERVER_SOURCE)): P.OBSERVER_SOURCE}


@contextmanager
def automation_fixture():
    """Tiny synthetic official-file stand-ins; never real runtime evidence."""
    decoded = "module.exports = {InjectedScript: () => class {}};\n"
    generated = ("const source = '" + decoded.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "';\n").encode()
    wrapper = '\n        (() => {\n        const module = {};\n        ${rawInjectedScriptSource.source}\n        return new (module.exports.InjectedScript())(globalThis, ${JSON.stringify(options)});\n        })();\n      '
    dom = ('      const source = `' + wrapper + '`;\n      this._injectedScriptPromise = anything;').encode()
    payload = wrapper.replace('${rawInjectedScriptSource.source}', decoded).replace('${JSON.stringify(options)}', json.dumps(P.AUTOMATION_OPTIONS, separators=(',', ':')))
    shape = {'length': len(payload), 'startLine': 0, 'startColumn': 0, 'endLine': payload.count('\n'), 'endColumn': 6}
    with ExitStack() as stack:
        for name, value in {'AUTOMATION_FILES': {'generated/injectedScriptSource.js': P.digest(generated), 'server/dom.js': P.digest(dom)},
                            'AUTOMATION_DECODED_SHA256': P.digest(decoded), 'AUTOMATION_SHA256': P.digest(payload),
                            'AUTOMATION_SHAPE': shape}.items():
            stack.enter_context(patch.object(P, name, value))
        yield generated, dom, payload


def parsed_source(script_id, source, *, context_id=6, isolated=True):
    return {'scriptId': script_id, 'hash': P.digest(source), 'url': '',
            'length': len(source.encode('utf-16-le')) // 2, 'startLine': 0, 'startColumn': 0,
            'endLine': source.count('\n'), 'endColumn': len(source.rsplit('\n', 1)[-1]),
            'executionContextId': context_id, 'executionContextAuxData': {
                'isDefault': not isolated, 'type': 'isolated' if isolated else 'default', 'frameId': 'current'},
            'hasSourceURL': False, 'isModule': False, 'isLiveEdit': False}


def live_contexts(script):
    return {script['executionContextId']: {'id': script['executionContextId'], 'auxData': dict(script['executionContextAuxData'])}}

# The 48 signed entries and their original indices are copied verbatim from
# CI 38332131237's first fleet profile, SHA256
# 490b9c33f61b15f51f4b4e8995b956532dc1d31fd51d547aa03da225f3ad50fc.
# The tiny tree, positive padding and remaining sample identities below are
# deliberately synthetic test scaffolding, never substituted runtime evidence.
REAL_NEGATIVE_DELTAS = [
    (57, -329), (88, -340), (102, -481), (144, -423), (175, -418), (201, -427),
    (243, -266), (274, -265), (300, -192), (355, -1040), (480, -61), (491, -546),
    (505, -106), (525, -29), (593, -278), (619, -439), (635, -848), (676, -589),
    (704, -747), (718, -170), (734, -691), (817, -638), (832, -1002), (872, -506),
    (900, -433), (915, -500), (932, -28), (969, -1054), (971, -2), (1013, -647),
    (1030, -50), (1069, -1044), (1097, -843), (1111, -757), (1128, -146), (1168, -889),
    (1195, -899), (1210, -296), (1226, -766), (1243, -125), (1289, -1045), (1328, -574),
    (1342, -428), (1358, -960), (1398, -915), (1426, -143), (1441, -695), (1458, -193),
]


def signed_regression_profile():
    deltas = [1000] * 1526
    for index, value in REAL_NEGATIVE_DELTAS:
        deltas[index] = value
    return {'startTime': 0, 'endTime': 2_000_000,
            'nodes': [
                {'id': 1, 'callFrame': {'functionName': '(root)', 'scriptId': '0', 'url': ''}, 'children': [2, 3]},
                {'id': 2, 'callFrame': {'functionName': '(program)', 'scriptId': '0', 'url': ''}, 'hitCount': 460},
                {'id': 3, 'callFrame': {'functionName': 'syntheticJsLeaf', 'scriptId': '5', 'url': 'http://test/app.js'}, 'hitCount': 975}],
            'samples': [2] * 551 + [3] * 975, 'timeDeltas': deltas}


class ProfileTests(unittest.TestCase):
    def test_original_weighting_and_separate_observer_cost(self):
        result = P.attribute(profile(), IDENTITIES, SOURCES)
        rows = {row['nodeId']: row for row in result['nodesBySelfTime']}
        self.assertTrue(result['valid'])
        self.assertEqual(rows[2]['sampledSelfMs'], 1)
        self.assertEqual(rows[2]['sampledInclusiveMs'], 3)
        self.assertEqual(rows[1]['sampledInclusiveMs'], 6)
        self.assertEqual(result['observerSampledSelfMs'], 3)
        self.assertEqual(result['sampleCount'], 3)
        self.assertEqual(result['sampledMs'], 6)
        self.assertEqual(len(result['explicitSelectorFrames']), 1)

    def test_utf16_source_positions(self):
        result = P.source_snippet(PRODUCTION_SOURCE, {'lineNumber': 0, 'columnNumber': 3})
        self.assertTrue(result['atAndAfter'].startswith('function'))

    def test_invalid_source_positions(self):
        self.assertIsNone(P.source_snippet('one', {'lineNumber': -1, 'columnNumber': 0}))
        self.assertIsNone(P.source_snippet('one', {'lineNumber': 2, 'columnNumber': 0}))

    def test_empty_url_does_not_whitelist_javascript(self):
        value = profile(); value['nodes'][1]['callFrame']['url'] = ''
        self.assertFalse(P.attribute(value, IDENTITIES, SOURCES)['valid'])

    def test_wrong_script_id_fails_even_for_same_url(self):
        value = profile(); value['nodes'][1]['callFrame']['scriptId'] = '6'
        self.assertFalse(P.attribute(value, IDENTITIES, SOURCES)['valid'])

    def test_observer_url_alone_does_not_authorize_frame(self):
        value = profile(); value['nodes'][3]['callFrame']['scriptId'] = 'unknown'
        self.assertFalse(P.attribute(value, IDENTITIES, SOURCES)['valid'])

    def test_sample_delta_mismatch(self):
        value = profile(); value['timeDeltas'].pop()
        with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_nonfinite_and_boolean_deltas_remain_hard_failures(self):
        for invalid in (float('nan'), float('inf'), True):
            with self.subTest(invalid=invalid):
                value = profile(); value['timeDeltas'][0] = invalid
                with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_unknown_leaf(self):
        value = profile(); value['samples'][0] = 123
        with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_duplicate_node(self):
        value = profile(); value['nodes'].append(value['nodes'][0])
        with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_multiple_parents(self):
        value = profile(); value['nodes'][3]['children'] = [3]
        with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_cycle(self):
        value = profile(); value['nodes'][2]['children'] = [1]
        with self.assertRaises(AssertionError): P.attribute(value, IDENTITIES, SOURCES)

    def test_zero_and_excess_sample_coverage(self):
        for values in ([0, 0, 0], [100000, 2000, 3000]):
            value = profile(); value['timeDeltas'] = values
            result = P.attribute(value, IDENTITIES, SOURCES)
            self.assertTrue(result['valid'])
            self.assertFalse(result['weightValidity']['valid'])
            self.assertEqual(result['attributionMode'], 'sample-frequency-only')
            self.assertNotIn('nodesBySelfTime', result)

    def test_invalid_profile_bounds(self):
        for value in (0, float('nan'), True):
            data = profile(); data['endTime'] = value
            with self.assertRaises(AssertionError): P.attribute(data, IDENTITIES, SOURCES)

    def test_real_negative_entries_preserve_order_and_disable_all_weights(self):
        value = signed_regression_profile(); original = json.dumps(value)
        result = P.attribute(value, IDENTITIES, SOURCES)
        self.assertEqual(json.dumps(value), original)
        self.assertTrue(result['valid'])
        self.assertFalse(result['weightValidity']['valid'])
        self.assertEqual(result['weightValidity']['negativeDeltaCount'], 48)
        self.assertEqual([(row['sampleIndex'], row['deltaUs']) for row in result['weightValidity']['negativeDeltas']], REAL_NEGATIVE_DELTAS)
        self.assertEqual(result['sampleCount'], 1526)
        for absent in ('sampledMs', 'profileDurationMs', 'nodesBySelfTime', 'nodesByInclusiveTime', 'observerSampledSelfMs', 'automationHelperSampledSelfMs'):
            self.assertNotIn(absent, result)
        for row in result['nodesBySelfSampleCount']:
            self.assertNotIn('sampledSelfMs', row)
            self.assertNotIn('sampledInclusiveMs', row)

    def test_raw_frequency_does_not_substitute_reported_hit_count(self):
        result = P.attribute(signed_regression_profile(), IDENTITIES, SOURCES)
        rows = {row['nodeId']: row for row in result['nodesBySelfSampleCount']}
        self.assertEqual(rows[2]['selfSampleCount'], 551)
        self.assertEqual(rows[2]['hitCount'], 460)
        self.assertEqual(rows[2]['selfCountMinusReportedHitCount'], 91)
        self.assertEqual(result['hitCountComparison']['reportedHitCountSum'], 1435)
        self.assertEqual(rows[2]['selfFractionOfAllRawSamples'], 551 / 1526)
        self.assertIsNone(rows[2]['selfFractionOfVerifiedProductionJsLeaves'])
        self.assertIsNone(rows[1]['inclusiveFractionOfVerifiedProductionJsLeaves'])
        self.assertEqual(rows[3]['selfFractionOfVerifiedProductionJsLeaves'], 1)
        self.assertEqual(result['sampleDenominators']['allRawSamples'], 1526)
        self.assertEqual(result['sampleDenominators']['verifiedProductionJavaScriptLeafSamples'], 975)

    def test_unavailable_weights_do_not_qualify_unknown_sources(self):
        value = signed_regression_profile(); value['nodes'][2]['callFrame']['scriptId'] = 'unverified'
        result = P.attribute(value, IDENTITIES, SOURCES)
        self.assertFalse(result['valid'])
        self.assertFalse(result['sourceValid'])
        self.assertEqual(result['attributionMode'], 'invalid-source')
        self.assertTrue(result['unverifiedFrames'])

    def test_source_content_must_match_script_id_and_hash(self):
        missing = dict(SOURCES); del missing[P.source_key('5', P.digest(PRODUCTION_SOURCE))]
        wrong = dict(SOURCES); wrong[P.source_key('5', P.digest(PRODUCTION_SOURCE))] = 'changed'
        for sources in (missing, wrong, {'http://test/app.js': PRODUCTION_SOURCE}):
            self.assertFalse(P.attribute(profile(), IDENTITIES, sources)['sourceValid'])

    def test_automation_costs_stay_separate_and_negative_deltas_disable_them(self):
        identities = dict(IDENTITIES)
        identities['16'] = {'url': '', 'kind': 'automation-helper', 'sha256': P.digest('helper')}
        sources = dict(SOURCES); sources[P.source_key('16', P.digest('helper'))] = 'helper'
        value = profile(); value['nodes'][2]['callFrame'] = {'functionName': 'listener', 'scriptId': '16', 'url': '', 'lineNumber': 0, 'columnNumber': 0}
        result = P.attribute(value, identities, sources)
        helper = next(row for row in result['nodesBySelfSampleCount'] if row['kind'] == 'automation-helper')
        self.assertEqual(result['sampleDenominators']['automationHelperLeafSamples'], 1)
        self.assertEqual(result['sampleDenominators']['allRawSamples'], 3)
        self.assertEqual(result['sampleDenominators']['verifiedProductionJavaScriptLeafSamples'], 1)
        self.assertIsNone(helper['selfFractionOfVerifiedProductionJsLeaves'])
        self.assertIsNone(helper['inclusiveFractionOfVerifiedProductionJsLeaves'])
        self.assertEqual(helper['sourceSnippet']['atAndAfter'], 'helper')
        self.assertEqual(result['automationHelperSampledSelfMs'], 2)
        value['timeDeltas'][1] = -1
        result = P.attribute(value, identities, sources)
        self.assertTrue(result['valid'])
        self.assertEqual(result['sampleDenominators']['automationHelperLeafSamples'], 1)
        self.assertNotIn('automationHelperSampledSelfMs', result)
        self.assertTrue(all('sampledSelfMs' not in row for row in result['nodesBySelfSampleCount']))


class AutomationSourceTests(unittest.TestCase):
    def test_exact_official_file_reconstruction_and_fixed_seven_options(self):
        with automation_fixture() as (generated, dom, expected):
            payload, provenance = P.reconstruct_automation(generated, dom, '1.57.0')
            self.assertEqual(payload, expected)
            self.assertEqual(provenance['payloadSha256'], P.digest(expected))
            self.assertEqual(list(provenance['optionsInOfficialOrder']), [
                'isUnderTest', 'sdkLanguage', 'testIdAttributeName', 'stableRafCount', 'browserName', 'isUtilityWorld', 'customEngines'])
            self.assertTrue(provenance['optionsInOfficialOrder']['isUtilityWorld'])

    def test_wrong_version_and_single_byte_official_file_changes_fail(self):
        with automation_fixture() as (generated, dom, _):
            for version, gen, wrapper in [('1.62.0', generated, dom), ('1.57.0', generated + b' ', dom), ('1.57.0', generated, dom + b' ')]:
                with self.assertRaises(AssertionError): P.reconstruct_automation(gen, wrapper, version)

    def test_complete_expected_payload_digest_is_mandatory(self):
        with automation_fixture() as (generated, dom, _), patch.object(P, 'AUTOMATION_SHA256', '0' * 64):
            with self.assertRaisesRegex(AssertionError, 'full automation payload differs'):
                P.reconstruct_automation(generated, dom, '1.57.0')

    def test_installed_originals_survive_hash_failure(self):
        class Distribution:
            version = '1.57.0'
            def locate_file(self, relative): return root / Path(relative).name
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); output = root / 'output'; output.mkdir()
            (root / 'injectedScriptSource.js').write_bytes(b'wrong generated')
            (root / 'dom.js').write_bytes(b'wrong wrapper')
            with patch.object(P.importlib.metadata, 'distribution', return_value=Distribution()):
                with self.assertRaisesRegex(AssertionError, 'source hash mismatch'): P.load_automation(output)
            self.assertEqual((output / 'official-generated-injectedScriptSource.js').read_bytes(), b'wrong generated')
            self.assertEqual((output / 'official-server-dom.js').read_bytes(), b'wrong wrapper')
            self.assertEqual(len(json.loads((output / 'automation-installed-source-observations.json').read_bytes())['files']), 2)

    def test_exact_payload_requires_isolated_live_current_frame_context(self):
        with automation_fixture() as (_, _, expected):
            script = parsed_source('16', expected); contexts = live_contexts(script)
            self.assertTrue(P.automation_matches(script, expected, expected, contexts, 'current'))
            self.assertFalse(P.automation_matches(script, expected, expected, {}, 'current'))
            self.assertFalse(P.automation_matches(script, expected, expected, contexts, 'other-frame'))
            self.assertFalse(P.automation_matches(script, expected + ' ', expected, contexts, 'current'))
            self.assertFalse(P.automation_matches(script, expected, expected + ' ', contexts, 'current'))
            changed_contexts = live_contexts(script); changed_contexts[6]['auxData']['frameId'] = 'another'
            self.assertFalse(P.automation_matches(script, expected, expected, changed_contexts, 'current'))
            default = parsed_source('16', expected, isolated=False)
            self.assertFalse(P.automation_matches(default, expected, expected, live_contexts(default), 'current'))

    def test_matching_hash_never_excuses_changed_metadata(self):
        with automation_fixture() as (_, _, expected):
            original = parsed_source('16', expected); contexts = live_contexts(original)
            for key, changed in [('url', 'fake.js'), ('hash', '0' * 64), ('length', len(expected) + 1),
                                 ('startLine', 1), ('startColumn', 1), ('endLine', 99), ('endColumn', 5),
                                 ('isLiveEdit', True), ('hasSourceURL', True), ('isModule', True), ('executionContextId', 7)]:
                script = dict(original); script[key] = changed
                with self.subTest(key=key): self.assertFalse(P.automation_matches(script, expected, expected, contexts, 'current'))

    def test_capture_retains_every_blank_source_without_url_aliasing(self):
        with automation_fixture() as (_, _, expected), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); bodies = {'16': expected, '17': 'unqualified blank JavaScript'}
            scripts = [parsed_source(key, body) for key, body in bodies.items()]
            class Fake:
                def send(self, method, params):
                    self.assert_method = method
                    if method != 'Debugger.getScriptSource': raise AssertionError('Only source reads permitted')
                    return {'scriptSource': bodies[params['scriptId']]}
            identities, sources = {}, {}
            result = P.capture_prepared_sources(Fake(), scripts, identities, sources, live_contexts(scripts[0]), 'current', expected, root)
            self.assertEqual(result['capturedScriptCount'], 2)
            self.assertEqual(result['automationHelperScriptIds'], ['16'])
            self.assertEqual(set(identities), {'16'})
            self.assertEqual(len(sources), 2)
            self.assertEqual(sources[P.source_key('16', P.digest(expected))], expected)
            self.assertEqual(sources[P.source_key('17', P.digest(bodies['17']))], bodies['17'])
            manifest = json.loads((root / 'prepared-script-sources.json').read_bytes())
            self.assertEqual([row['qualifiedKind'] for row in manifest], ['automation-helper', None])
            for row in manifest:
                self.assertEqual(P.digest((root / row['path']).read_bytes()), row['sha256'])
            value = profile(); value['nodes'][1]['callFrame'].update({'scriptId': '17', 'url': ''})
            self.assertFalse(P.attribute(value, identities, sources)['valid'])

    def test_archived_seed_contexts_are_not_retrieved_or_qualified(self):
        with automation_fixture() as (_, _, expected), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); old = parsed_source('3', 'destroyed seed source', context_id=3, isolated=False)
            parsed = [old]
            class Response:
                url = 'http://test/setup.js'
                status = 200
            responses = [Response()]; contexts = live_contexts(old)
            P.archive_pre_app_scripts(parsed, contexts, responses, root)
            self.assertEqual(json.loads((root / 'pre-app-script-inventory.json').read_bytes()), [old])
            self.assertEqual(json.loads((root / 'pre-app-execution-contexts.json').read_bytes())['3']['id'], 3)
            self.assertEqual(json.loads((root / 'pre-app-script-http-responses.json').read_bytes()), [{'url': Response.url, 'status': 200}])
            self.assertEqual(parsed, [])
            self.assertEqual(responses, [])
            self.assertEqual(contexts, live_contexts(old))  # Runtime events, not this boundary, track live contexts.
            app = parsed_source('16', expected); parsed.append(app)
            class Fake:
                def send(self, method, params):
                    if params['scriptId'] == '3': raise AssertionError('Destroyed pre-app source must not be requested')
                    return {'scriptSource': expected}
            identities, sources = {}, {}
            result = P.capture_prepared_sources(Fake(), parsed, identities, sources, live_contexts(app), 'current', expected, root)
            self.assertEqual(result['capturedScriptCount'], 1)
            self.assertNotIn('3', identities)
            self.assertNotIn(P.source_key('3', P.digest('destroyed seed source')), sources)
            value = profile(); value['nodes'][1]['callFrame'].update({'scriptId': '3', 'url': ''})
            self.assertFalse(P.attribute(value, identities, sources)['valid'])

    def test_archival_must_succeed_before_inventory_reset(self):
        parsed = [{'scriptId': '3'}]
        with patch.object(P, 'exclusive_json', side_effect=OSError('original archive failure')):
            with self.assertRaisesRegex(OSError, 'original archive failure'): P.archive_pre_app_scripts(parsed, {}, [], Path('/unused'))
        self.assertEqual(parsed, [{'scriptId': '3'}])

    def test_hash_mismatch_retains_actual_source_before_failure(self):
        with automation_fixture() as (_, _, expected), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); script = parsed_source('16', expected)
            class Fake:
                def send(self, method, params): return {'scriptSource': expected + 'changed'}
            with self.assertRaisesRegex(AssertionError, 'hash/length differs'):
                P.capture_prepared_sources(Fake(), [script], {}, {}, live_contexts(script), 'current', expected, root)
            rows = json.loads((root / 'prepared-script-sources.json').read_bytes())
            self.assertEqual((root / rows[0]['path']).read_text(), expected + 'changed')
            self.assertIsNone(rows[0]['qualifiedKind'])

    def test_reused_script_id_with_changed_hash_is_rejected(self):
        with automation_fixture() as (_, _, expected), tempfile.TemporaryDirectory() as temporary:
            first = parsed_source('16', expected); second = parsed_source('16', 'other')
            class Fake:
                def send(self, method, params): return {'scriptSource': expected}
            with self.assertRaisesRegex(AssertionError, 'scriptId metadata changed'):
                P.capture_prepared_sources(Fake(), [first, second], {}, {}, live_contexts(first), 'current', expected, Path(temporary))

    def test_missing_source_and_unsafe_ids_fail_closed(self):
        with automation_fixture() as (_, _, expected):
            class Fake:
                def send(self, method, params): return {}
            for script_id in ('16', '../escape', '-1'):
                with tempfile.TemporaryDirectory() as temporary:
                    script = parsed_source(script_id, expected)
                    with self.assertRaises(AssertionError):
                        P.capture_prepared_sources(Fake(), [script], {}, {}, live_contexts(script), 'current', expected, Path(temporary))

    def test_source_capture_bounds_fail_closed_with_partial_inventory(self):
        with automation_fixture() as (_, _, expected):
            script = parsed_source('16', expected)
            class Fake:
                def send(self, method, params): return {'scriptSource': expected}
            for bound, value in [('MAX_SCRIPT_SOURCES', 0), ('MAX_SCRIPT_SOURCE_BYTES', len(expected) - 1)]:
                with tempfile.TemporaryDirectory() as temporary, patch.object(P, bound, value):
                    directory = Path(temporary)
                    with self.assertRaisesRegex(AssertionError, 'bound'):
                        P.capture_prepared_sources(Fake(), [script], {}, {}, live_contexts(script), 'current', expected, directory)
                    self.assertTrue((directory / 'prepared-script-sources.json').exists())

    def test_previously_verified_source_cannot_change_its_prepared_identity(self):
        with automation_fixture() as (_, _, expected), tempfile.TemporaryDirectory() as temporary:
            script = parsed_source('16', expected)
            class Fake:
                def send(self, method, params): return {'scriptSource': expected}
            identities = {'16': {'url': 'different', 'kind': 'diagnostic-observer', 'sha256': P.digest(expected)}}
            sources = {P.source_key('16', P.digest(expected)): expected}
            with self.assertRaisesRegex(AssertionError, 'verified source identity changed'):
                P.capture_prepared_sources(Fake(), [script], identities, sources, live_contexts(script), 'current', expected, Path(temporary))

    def test_capture_is_after_prep_and_before_any_profiler_start(self):
        # Static scheduling guard complements fake-CDP source tests without
        # launching a local browser or executing any JavaScript.
        import inspect
        source = inspect.getsource(P.run_case)
        archival = source.index('archive_pre_app_scripts(parsed, contexts, responses, directory)')
        self.assertGreater(archival, source.index("strict_equal(json.loads(seeded['raw']), expected)"))
        self.assertLess(archival, source.index("response = page.goto(args.url, wait_until='domcontentloaded')"))
        capture = source.index('capture_prepared_sources(')
        self.assertGreater(capture, source.index("snapshot(page, workload['key'], directory, 'before')"))
        self.assertGreater(capture, source.index("page.mouse.move(hit['x'], hit['y'])"))
        self.assertLess(capture, source.index("cdp.send('Profiler.start')"))
        self.assertLess(capture, source.index("cdp.send('Debugger.disable')"))


class FixtureAndEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_evidence_never_overwrites(self):
        path = self.root / 'result.json'
        P.exclusive_json(path, {'a': 1})
        with self.assertRaises(FileExistsError): P.exclusive_json(path, {'a': 2})
        self.assertEqual(json.loads(path.read_bytes()), {'a': 1})

    def test_asset_traversal_and_symlink_rejected(self):
        dist = self.root / 'dist'; dist.mkdir()
        outside = self.root / 'outside'; outside.write_text('x')
        (dist / 'linked').symlink_to(outside)
        for relative in ('../outside', str(outside), 'a\\b', 'linked'):
            with self.subTest(relative=relative):
                with self.assertRaises(AssertionError): P.asset_path(dist, relative)

    def test_strict_scalar_and_array_equivalence(self):
        self.assertFalse(P.strict_equal({'a': True}, {'a': 1}))
        self.assertFalse(P.strict_equal({'a': 1}, {'a': 1.0}))
        self.assertFalse(P.strict_equal([1, 2], [2, 1]))
        self.assertTrue(P.strict_equal({'a': 1, 'b': 2}, {'b': 2, 'a': 1}))

    def test_script_origin_query_and_prefix(self):
        for url in ('https://test/Infinity/assets/a.js', 'http://evil/Infinity/a.js',
                    'http://test/else/a.js', 'http://test/Infinity/a.js?other', 'http://test/Infinity/a.js#x'):
            with self.assertRaises(AssertionError): P.relative_asset(url, 'http://test/Infinity/')

    def test_published_fixture_hash_is_mandatory(self):
        path = self.root / 'fixture.json'; path.write_text('{}')
        with self.assertRaisesRegex(AssertionError, 'Fixture file differs'): P.fixture(path)

    def test_fixture_adaptation_uses_after_save(self):
        ready = {'revision': 14, 'version': 9, 'savedAt': 1, 'lastTickAt': 1,
                 'state': {'fleets': [{}] * 1000, 'planets': [{}] * 100}}
        raw = json.dumps(ready)
        source = {'pairedNative': {'sourceSha': '4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b',
                                   'afterSave': raw, 'afterSha256': P.digest(raw)},
                  'profile': 'combined-max-v1', 'key': 'infinity.original-p4.save.v1', 'manifest': {'counts': {}}}
        path = self.root / 'fixture.json'; path.write_text(json.dumps(source))
        with patch.object(P, 'FIXTURE_SHA256', P.digest(path.read_bytes())), patch.object(P, 'SAVE_SHA256', P.digest(raw)):
            self.assertEqual(P.fixture(path)['raw'], raw)
            source['pairedNative']['afterSha256'] = 'false'
            path.write_text(json.dumps(source))
            with patch.object(P, 'FIXTURE_SHA256', P.digest(path.read_bytes())):
                with self.assertRaisesRegex(AssertionError, 'save bytes'): P.fixture(path)

    def test_observer_has_no_window_storage_or_json_reads(self):
        capture = P.OBSERVER_SOURCE.split('function currentFleetCapture')[1].split('}, true);')[0]
        bubble = P.OBSERVER_SOURCE.split('function currentFleetBubble')[1].split('}, false);')[0]
        for text in (capture, bubble):
            for forbidden in ('JSON.', 'localStorage', 'snapshot', 'performance.mark', 'setTimeout', 'requestAnimationFrame'):
                self.assertNotIn(forbidden, text)
            self.assertIn('performance.now()', text)

    def test_modified_compiled_observer_is_rejected(self):
        class Fake:
            def send(self, method, params):
                if method == 'Runtime.compileScript': return {'scriptId': '99'}
                if method == 'Debugger.getScriptSource': return {'scriptSource': 'changed'}
                raise AssertionError('Unverified observer must never run')
        with self.assertRaisesRegex(AssertionError, 'source changed'):
            P.register_observer(Fake(), {}, {}, self.root)
        self.assertEqual((self.root / 'registered-observer.js').read_text(), 'changed')


class ManualSaveTests(unittest.TestCase):
    def data(self):
        old = '{"old":true}'
        new = json.dumps({'revision': 14, 'version': 9, 'savedAt': 200, 'lastTickAt': 199, 'state': {}})
        after = {'observation': {'start': 10, 'end': 22, 'trusted': True, 'duplicates': 0,
                                 'buttonConnected': True, 'buttonEnabled': True},
                 'status': '已保存到本地', 'protected': False, 'wallAt': 210}
        return {'wallAt': 180, 'monotonicAt': 0}, after, old, new, [{'oldValue': old, 'newValue': new}]

    def test_valid_native_span(self):
        result = P.validate_manual(*self.data(), kind='save-profiled')
        self.assertEqual(result['captureToBubbleMs'], 12)
        self.assertEqual(result['nativeCurrentWrites'], 1)

    def test_untrusted_missing_duplicate_and_disabled(self):
        for key, invalid in [('trusted', False), ('duplicates', 1), ('buttonEnabled', False),
                             ('buttonConnected', False), ('start', None), ('start', True), ('end', float('nan')), ('end', 9)]:
            data = list(self.data()); data[1]['observation'][key] = invalid
            with self.subTest(key=key):
                with self.assertRaises(AssertionError): P.validate_manual(*data, kind='save-profiled')

    def test_wrong_write_bytes_or_extra_write_rejected(self):
        for events in ([], [{'oldValue': 'wrong', 'newValue': 'wrong'}], [self.data()[4][0]] * 2):
            data = list(self.data()); data[4] = events
            with self.assertRaises(AssertionError): P.validate_manual(*data, kind='save-profiled')

    def test_protected_and_status_failure(self):
        for key, value in [('protected', True), ('status', '已自动保存')]:
            data = list(self.data()); data[1][key] = value
            with self.assertRaises(AssertionError): P.validate_manual(*data, kind='save-profiled')

    def test_timestamp_watermark_violation(self):
        data = list(self.data()); value = json.loads(data[3]); value['lastTickAt'] = 201
        data[3] = json.dumps(value); data[4] = [{'oldValue': data[2], 'newValue': data[3]}]
        with self.assertRaisesRegex(AssertionError, 'watermark'): P.validate_manual(*data, kind='save-profiled')

    def test_unprofiled_save_uses_readback_without_write_count(self):
        data = list(self.data()); data[4] = []
        result = P.validate_manual(*data, kind='save-unprofiled')
        self.assertEqual(result['captureToBubbleMs'], 12)
        self.assertIsNone(result['nativeCurrentWrites'])
        self.assertFalse(result['writeCountObserved'])
        self.assertTrue(result['nativeCurrentChanged'])

    def test_unprofiled_save_rejects_protocol_observation(self):
        with self.assertRaisesRegex(AssertionError, 'must not receive DOMStorage'):
            P.validate_manual(*self.data(), kind='save-unprofiled')

    def test_unprofiled_policy_never_enables_domain_or_listener(self):
        class Fake:
            def on(self, *args): raise AssertionError('Must not subscribe')
            def send(self, *args): raise AssertionError('Must not enable domain')
        result = P.arm_storage_observer(Fake(), 'save-unprofiled', lambda event: None)
        self.assertFalse(result['enabled'])
        with self.assertRaisesRegex(AssertionError, 'Unknown fixed diagnostic kind'):
            P.arm_storage_observer(Fake(), 'unknown', lambda event: None)

    def test_saved_timestamp_must_belong_to_manual_click(self):
        data = list(self.data()); data[0]['wallAt'] = 100
        with self.assertRaisesRegex(AssertionError, 'trusted manual click span'):
            P.validate_manual(*data, kind='save-profiled')


class CleanupTests(unittest.TestCase):
    def test_failed_context_close_invalidates_final_immutable_result(self):
        class FailingContext:
            def close(self):
                raise RuntimeError('fake context close failure')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            row = {'valid': True, 'phase': 'complete', 'case': 'fake'}
            persisted = []
            with self.assertRaisesRegex(RuntimeError, 'fake context close failure'):
                P.finalize_case(row, FailingContext(), directory,
                                lambda: persisted.append(json.loads(json.dumps(row))))
            observation = json.loads((directory / 'observation-result.json').read_bytes())
            final = json.loads((directory / 'case-result.json').read_bytes())
            cleanup = json.loads((directory / 'context-cleanup.json').read_bytes())
            self.assertEqual(observation['phase'], 'cleanup-pending')
            self.assertTrue(observation['observationsPassed'])
            self.assertNotIn('valid', observation)
            self.assertFalse(observation['cleanupComplete'])
            self.assertFalse(final['valid'])
            self.assertFalse(final['cleanupComplete'])
            self.assertEqual(final['phase'], 'cleanup-failed')
            self.assertEqual(final, row)
            self.assertEqual(persisted[-1], final)
            self.assertFalse(cleanup['completed'])
            self.assertEqual(cleanup['error'], final['cleanupError'])

    def test_successful_cleanup_does_not_requalify_failed_observations(self):
        class ClosingContext:
            def close(self):
                return None
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            row = {'valid': False, 'phase': 'measurement', 'error': {'message': 'prior failure'}}
            P.finalize_case(row, ClosingContext(), directory, lambda: None)
            final = json.loads((directory / 'case-result.json').read_bytes())
            self.assertFalse(final['valid'])
            self.assertTrue(final['cleanupComplete'])
            self.assertEqual(final['phase'], 'invalid-or-incomplete')
            self.assertEqual(final['error'], {'message': 'prior failure'})


class ProfileFinalizationTests(unittest.TestCase):
    def test_missing_profile_field_retains_original_stop_response(self):
        class Fake:
            def send(self, method):
                return {}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(P, 'end_trace', return_value={'retained': True}) as end:
                with self.assertRaisesRegex(AssertionError, 'Missing CPU profile field'):
                    P.finalize_profile(Fake(), None, None, directory)
                end.assert_called_once()
            self.assertEqual(json.loads((directory / 'original-profiler-stop-response.json').read_bytes()), {})
            self.assertFalse((directory / 'original.cpuprofile').exists())

    def test_null_cpu_capture_is_hard_failure_and_trace_still_finalizes(self):
        class Fake:
            def send(self, method):
                return {'profile': None} if method == 'Profiler.stop' else {}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(P, 'end_trace', return_value={'retained': True}) as end:
                with self.assertRaisesRegex(AssertionError, 'Missing CPU profile object'):
                    P.finalize_profile(Fake(), None, None, directory)
                end.assert_called_once()
            self.assertIsNone(json.loads((directory / 'original.cpuprofile').read_bytes()))
            finalization = json.loads((directory / 'profile-finalization.json').read_bytes())
            self.assertFalse(finalization['cpuProfileObtained'])
            self.assertTrue(finalization['traceFinalized'])

    def test_trace_is_finalized_when_profiler_stop_fails(self):
        calls = []
        class Fake:
            def send(self, method):
                calls.append(method)
                if method == 'Profiler.stop': raise RuntimeError('original stop failure')
                return {}
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            def finish_trace(cdp, page, token, path):
                P.exclusive_json(path, {'traceEvents': []})
                return {'path': path.name}
            with patch.object(P, 'end_trace', side_effect=finish_trace) as end:
                with self.assertRaisesRegex(RuntimeError, 'original stop failure'):
                    P.finalize_profile(Fake(), None, ('token', 'listener'), directory)
                end.assert_called_once()
            self.assertEqual(calls, ['Profiler.stop', 'Profiler.disable'])
            self.assertTrue((directory / 'original-trace.json').is_file())
            result = json.loads((directory / 'profile-finalization.json').read_bytes())
            self.assertTrue(result['traceFinalized'])
            self.assertFalse(result['cpuProfileObtained'])
            self.assertEqual(result['errors'][0]['stage'], 'profiler-stop-or-write')

    def test_trace_is_attempted_after_cpu_artifact_write_failure(self):
        class Fake:
            def send(self, method):
                return {'profile': profile()} if method == 'Profiler.stop' else {}
        original_writer = P.exclusive_json
        def writer(path, value):
            if path.name == 'original.cpuprofile': raise RuntimeError('original artifact write failure')
            original_writer(path, value)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(P, 'exclusive_json', side_effect=writer), patch.object(P, 'end_trace', return_value={'retained': True}) as end:
                with self.assertRaisesRegex(RuntimeError, 'original artifact write failure'):
                    P.finalize_profile(Fake(), None, None, directory)
                end.assert_called_once()
            result = json.loads((directory / 'profile-finalization.json').read_bytes())
            self.assertTrue(result['traceFinalized'])
            self.assertTrue(result['cpuProfileObtained'])

    def test_capture_error_is_not_masked_by_cleanup_errors(self):
        class Fake:
            def send(self, method): raise RuntimeError('later profiler failure')
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with patch.object(P, 'end_trace', side_effect=RuntimeError('later trace failure')):
                with self.assertRaisesRegex(ValueError, 'first input failure'):
                    P.finalize_profile(Fake(), None, None, directory, primary_error=ValueError('first input failure'))
            result = json.loads((directory / 'profile-finalization.json').read_bytes())
            self.assertEqual([row['stage'] for row in result['errors']],
                             ['capture', 'profiler-stop-or-write', 'profiler-disable', 'trace-finalization'])


class ScheduleQualificationTests(unittest.TestCase):
    def report(self):
        return {'runs': [], 'errors': [], 'globalCleanupComplete': True}

    def action(self, report, *, fail_first=False, unavailable=False):
        def invoke(kind, repetition):
            if fail_first and kind == 'fleet-profiled' and repetition == 0:
                raise AssertionError('first source verification failure')
            row = {'case': kind + '-r' + str(repetition + 1), 'kind': kind, 'valid': True, 'cleanupComplete': True}
            if kind != 'save-unprofiled':
                row['attribution'] = {'valid': True, 'structureValid': True, 'sourceValid': True,
                                      'weightValidity': {'valid': not unavailable, 'reasons': ['Negative deltas retained.'] if unavailable else []}}
            report['runs'].append(row)
        return invoke

    def test_first_failure_does_not_skip_remaining_fixed_windows(self):
        report = self.report()
        P.execute_schedule(self.action(report, fail_first=True), report, lambda: None)
        P.summarize_completion(report)
        self.assertEqual(len(report['attemptedCases']), 9)
        self.assertTrue(report['allPlannedWindowsAttempted'])
        self.assertEqual(len(report['runs']), 9)
        self.assertEqual(sum(row['kind'] == 'save-unprofiled' and row['valid'] for row in report['runs']), 3)
        self.assertEqual(len(report['errors']), 1)
        self.assertEqual(report['errors'][0]['message'], 'first source verification failure')
        self.assertFalse(report['completed'])
        self.assertFalse(report['weightedAttributionComplete'])

    def test_completed_does_not_imply_weighted_attribution_complete(self):
        report = self.report()
        P.execute_schedule(self.action(report, unavailable=True), report, lambda: None)
        P.summarize_completion(report)
        self.assertTrue(report['completed'])
        self.assertFalse(report['weightedAttributionComplete'])
        self.assertEqual(len(report['weightedUnavailableCases']), 6)
        self.assertTrue(report['summary']['completed'])
        self.assertFalse(report['summary']['weightedAttributionComplete'])
        self.assertFalse(report['summary']['weightedAggregationAllowed'])
        self.assertFalse(report['errors'])

    def test_all_weighted_windows_must_qualify(self):
        report = self.report()
        P.execute_schedule(self.action(report), report, lambda: None)
        P.summarize_completion(report)
        self.assertTrue(report['completed'])
        self.assertTrue(report['weightedAttributionComplete'])
        report['runs'][0]['cleanupComplete'] = False
        P.summarize_completion(report)
        self.assertFalse(report['completed'])
        self.assertFalse(report['weightedAttributionComplete'])

    def test_deadline_is_not_extended_to_force_more_windows(self):
        report = self.report(); times = iter([1, 3, 6])
        with patch.object(P.time, 'monotonic', side_effect=lambda: next(times)):
            P.execute_schedule(self.action(report), report, lambda: None, deadline=5)
        P.summarize_completion(report)
        self.assertEqual(len(report['attemptedCases']), 2)
        self.assertFalse(report['completed'])
        self.assertFalse(report['allPlannedWindowsAttempted'])
        self.assertIn('deadline exhausted', report['errors'][0]['message'])

    def test_global_cleanup_error_cannot_be_overwritten_by_successful_cases(self):
        report = self.report()
        P.execute_schedule(self.action(report), report, lambda: None)
        report['globalCleanupComplete'] = False
        report['errors'].append({'phase': 'cleanup-browser', 'message': 'failure'})
        P.summarize_completion(report)
        self.assertFalse(report['completed'])
        self.assertFalse(report['weightedAttributionComplete'])

    def test_missing_profile_attribution_is_not_weights_only_degradation(self):
        report = self.report()
        P.execute_schedule(self.action(report), report, lambda: None)
        del report['runs'][0]['attribution']
        P.summarize_completion(report)
        self.assertFalse(report['completed'])
        self.assertFalse(report['weightedAttributionComplete'])


if __name__ == '__main__':
    unittest.main()
