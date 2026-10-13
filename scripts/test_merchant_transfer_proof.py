"""Offline fail-closed proof tests. Passing these never claims native execution."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('merchant_proof', ROOT / 'scripts/browser-merchant-transfer-proof.py')
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


def envelope(metal='100000'):
    return {'schema': 'infinity-original-p4', 'revision': 14, 'version': 9, 'savedAt': 1234, 'lastTickAt': 1234,
            'state': {'planets': [{'id': 'homeworld', 'resources': {'metal': metal, 'crystal': '0', 'deuterium': '0'}, 'units': {'small_cargo': 0}}],
                      'deepSpace': {'seed': 99, 'nextOfferId': 2, 'offers': [{'id': 'merchant-1', 'planetId': 'homeworld', 'startsAt': 0, 'expiresAt': 600,
                                                                       'ratios': {'metal': 3, 'crystal': 2, 'deuterium': 1}, 'remainingMe': '200000'}]},
                      'arcade': {'seed': 88, 'nextRunId': 1}, 'orders': {'nextJobId': 1}, 'totalTime': '0'}}


class IndependentExpectedOutcome(unittest.TestCase):
    def test_ordinary_control_charges_exactly_1000(self):
        before = envelope()
        after = proof.expected_envelope(before, 'ordinary-control')
        self.assertEqual(after['state']['planets'][0]['resources'], {'metal': '99000', 'crystal': '646', 'deuterium': '0'})
        self.assertEqual(after['state']['deepSpace']['offers'][0]['remainingMe'], '199000')
        self.assertEqual({r['path'] for r in proof.differences(before, after)}, {'/state/planets/0/resources/metal', '/state/planets/0/resources/crystal', '/state/deepSpace/offers/0/remainingMe'})

    def test_old_failure_has_credit_without_canonical_debit(self):
        before = envelope('1e+100')
        after = proof.expected_envelope(before, 'unrepresentable-seller')
        self.assertEqual(after['state']['planets'][0]['resources'], {'metal': '1e+100', 'crystal': '646', 'deuterium': '0'})
        self.assertEqual({r['path'] for r in proof.differences(before, after)}, {'/state/planets/0/resources/crystal', '/state/deepSpace/offers/0/remainingMe'})
        self.assertEqual(before, envelope('1e+100'), 'Independent oracle must not mutate original')

    def test_rng_ids_clocks_units_and_unknown_fields_are_not_excluded(self):
        before = envelope('1e+100')
        before['state']['futureField'] = {'opaque': ['retain this entire state']}
        expected = proof.expected_envelope(before, 'unrepresentable-seller')
        for section in ('arcade', 'orders', 'futureField'):
            self.assertEqual(expected['state'][section], before['state'][section])
        for field in ('seed', 'nextOfferId'):
            self.assertEqual(expected['state']['deepSpace'][field], before['state']['deepSpace'][field])
        self.assertEqual(expected['savedAt'], before['savedAt'])
        self.assertEqual(expected['lastTickAt'], before['lastTickAt'])
        self.assertEqual(expected['state']['totalTime'], before['state']['totalTime'])
        tampered = copy.deepcopy(expected)
        tampered['state']['orders']['nextJobId'] += 1
        self.assertNotEqual(tampered, expected)
        self.assertEqual(proof.differences(expected, tampered)[0]['path'], '/state/orders/nextJobId')

    def test_wrong_wallet_offer_planet_or_case_rejected(self):
        variants = [envelope('100001'), envelope(), envelope(), envelope()]
        variants[1]['state']['deepSpace']['offers'][0]['ratios']['metal'] = 2.8
        variants[2]['state']['planets'][0]['id'] = 'other'
        variants[3]['state']['deepSpace']['offers'][0]['remainingMe'] = '199999'
        for before in variants:
            with self.assertRaises(ValueError):
                proof.expected_envelope(before, 'ordinary-control')
        with self.assertRaises(ValueError):
            proof.expected_envelope(envelope(), 'invented-case')


class ReleaseBinding(unittest.TestCase):
    def make_dist(self, root):
        files = {}
        for i in range(62):
            name = 'index.html' if i == 0 else f'asset-{i}.js'
            data = str(i).encode()
            (root / name).write_bytes(data)
            files[name] = proof.digest(data)
        raw = json.dumps({'sourceSha': proof.BASE, 'files': files}).encode()
        (root / 'release.json').write_bytes(raw)
        return proof.digest(raw)

    def test_exact_dist_acceptance_and_no_added_missing_or_changed_files(self):
        for mutation in ('none', 'changed', 'missing', 'extra'):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                release_hash = self.make_dist(root)
                if mutation == 'changed':
                    (root / 'asset-1.js').write_text('tampered')
                elif mutation == 'missing':
                    (root / 'asset-1.js').unlink()
                elif mutation == 'extra':
                    (root / 'injected.js').write_text('not allowed')
                with patch.object(proof, 'RELEASE_HASH', release_hash):
                    if mutation == 'none':
                        self.assertEqual(len(proof.dist_binding(root)['actualFiles']), 63)
                    else:
                        with self.assertRaises(ValueError):
                            proof.dist_binding(root)

    def test_wrong_source_and_unpinned_manifest_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.make_dist(root)
            with self.assertRaises(ValueError):
                proof.dist_binding(root)
            value = json.loads((root / 'release.json').read_text())
            value['sourceSha'] = 'a' * 40
            raw = json.dumps(value).encode()
            (root / 'release.json').write_bytes(raw)
            with patch.object(proof, 'RELEASE_HASH', proof.digest(raw)), self.assertRaises(ValueError):
                proof.dist_binding(root)

    def test_actual_audited_clock_literal_and_tamper_refusal(self):
        source = (ROOT / 'scripts/browser-npc-attack.py').read_text()
        clock = proof.clock_template(source)
        self.assertEqual(proof.digest(clock.encode()), proof.CLOCK_HASH)
        self.assertIn('event.isTrusted', clock)
        self.assertIn('Storage.prototype.getItem', clock)
        with self.assertRaises(ValueError):
            proof.clock_template(source.replace('let elapsed=0;', 'let elapsed=1;'))

    def test_source_binding_is_complete_git_blob_comparison(self):
        source = (ROOT / 'scripts/browser-merchant-transfer-proof.py').read_text()
        self.assertIn("current.keys() - old.keys() != ADDITIONS", source)
        self.assertIn("old.keys() - current.keys()", source)
        self.assertIn("'cat-file', 'blob'", source)
        self.assertIn("== (proof_root / name).read_bytes() == z.read", source)
        self.assertEqual(len(proof.ADDITIONS), 4)


class BoundedNativeCleanup(unittest.TestCase):
    class Resource:
        def __init__(self, action):
            self.action = action

        def close(self):
            self.action()

    def valid_report(self):
        return {'nativeBodyCompleted': True, 'knownBugConfirmed': True,
                'nativeBrowserElapsedSeconds': 140, 'nativeLifecycleElapsedSeconds': 141,
                'cleanupErrors': [], 'cleanup': {'completed': True, 'deadlineExceeded': False,
                    'hostElapsedSeconds': 1, 'budgetSeconds': 10, 'errors': [],
                    'resources': [{'resource': str(i), 'status': 'closed'} for i in range(5)]}}

    def test_success_records_every_cleanup_resource(self):
        calls = []
        resources = [(str(i), self.Resource(lambda i=i: calls.append(i)), 'close') for i in range(5)]
        witness = proof.cleanup_native(resources, 1)
        self.assertTrue(witness['completed'])
        self.assertEqual(calls, list(range(5)))
        self.assertEqual([r['status'] for r in witness['resources']], ['closed'] * 5)
        self.assertEqual(witness['errors'], [])
        self.assertLessEqual(witness['hostElapsedSeconds'], 1)

    def test_cleanup_exception_blocks_completion_but_other_resources_attempted(self):
        calls = []
        def fail():
            raise OSError('synthetic browser close failure')
        witness = proof.cleanup_native([('browser', self.Resource(fail), 'close'),
                                        ('server', self.Resource(lambda: calls.append('server')), 'close')], 1)
        self.assertFalse(witness['completed'])
        self.assertEqual(calls, ['server'])
        self.assertEqual([r['status'] for r in witness['resources']], ['failed', 'closed'])
        self.assertEqual(len(witness['errors']), 1)

    def test_real_alarm_interrupts_stalled_cleanup_without_attempting_later_blockers(self):
        calls = []
        started = time.monotonic()
        witness = proof.cleanup_native([('stalled browser', self.Resource(lambda: time.sleep(0.5)), 'close'),
                                        ('later resource', self.Resource(lambda: calls.append('unexpected')), 'close')], 0.03)
        self.assertLess(time.monotonic() - started, 0.3)
        self.assertFalse(witness['completed'])
        self.assertTrue(witness['deadlineExceeded'])
        self.assertEqual([r['status'] for r in witness['resources']], ['timed-out', 'not-attempted'])
        self.assertEqual(calls, [])

    def test_missing_failed_unfinished_or_overbudget_cleanup_never_completes(self):
        good = self.valid_report()
        self.assertTrue(proof.native_completion_allowed(good))
        variants = []
        for field, value in [('completed', False), ('deadlineExceeded', True), ('hostElapsedSeconds', 11),
                             ('budgetSeconds', 11), ('resources', []), ('errors', [{'error': 'cleanup failed'}])]:
            bad = copy.deepcopy(good)
            bad['cleanup'][field] = value
            variants.append(bad)
        for field, value in [('nativeBodyCompleted', False), ('nativeBrowserElapsedSeconds', 150.1),
                             ('nativeLifecycleElapsedSeconds', 160.1), ('cleanupErrors', [{'error': 'failure'}])]:
            bad = copy.deepcopy(good)
            bad[field] = value
            variants.append(bad)
        for status in ('failed', 'running', 'not-attempted', 'timed-out'):
            bad = copy.deepcopy(good)
            bad['cleanup']['resources'][0]['status'] = status
            variants.append(bad)
        variants.append({})
        for bad in variants:
            self.assertFalse(proof.native_completion_allowed(bad), bad)

    def test_zero_budget_attempts_no_cleanup_and_is_incomplete(self):
        calls = []
        witness = proof.cleanup_native([('browser', self.Resource(lambda: calls.append(1)), 'close')], 0)
        self.assertEqual(calls, [])
        self.assertFalse(witness['completed'])
        self.assertTrue(witness['deadlineExceeded'])

    def test_cleanup_failure_is_blocked_in_python_reader_and_workflow(self):
        source = (ROOT / 'scripts/browser-merchant-transfer-proof.py').read_text()
        fixture = (ROOT / 'scripts/merchant-transfer-proof-fixture.ts').read_text()
        workflow = (ROOT / '.github/workflows/merchant-transfer-proof.yml').read_text()
        self.assertNotIn('signal.alarm(0)', source)
        self.assertIn('signal.alarm(150)', source)
        self.assertIn('cleanup_budget = max(0, min(10, remaining_lifecycle))', source)
        self.assertIn("raise RuntimeError('Native cleanup incomplete", source)
        self.assertIn("write('cleanup-witness.json'", source)
        self.assertIn('strictEqual(report.cleanup.completed, true)', fixture)
        self.assertIn('deepStrictEqual(report.cleanupErrors, [])', fixture)
        self.assertIn('report.nativeLifecycleElapsedSeconds <= 160', fixture)
        self.assertIn("report['cleanupErrors'] == []", workflow)
        self.assertIn("report['nativeLifecycleElapsedSeconds'] <= 160", workflow)


class NativeProofStructure(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / 'scripts/browser-merchant-transfer-proof.py').read_text()
        self.fixture = (ROOT / 'scripts/merchant-transfer-proof-fixture.ts').read_text()
        self.workflow = (ROOT / '.github/workflows/merchant-transfer-proof.yml').read_text()

    def test_workflow_is_separate_exact_bounded_readonly_branch(self):
        self.assertIn("branches: ['codex/infinity-merchant-transfer-proof-20261013']", self.workflow)
        self.assertIn("github.ref == 'refs/heads/codex/infinity-merchant-transfer-proof-20261013'", self.workflow)
        self.assertIn('timeout-minutes: 12', self.workflow)
        self.assertIn('contents: read', self.workflow)
        self.assertIn('persist-credentials: false', self.workflow)
        self.assertIn('GITHUB_SHA="$BASE_SHA" npm run build', self.workflow)
        self.assertIn('bash scripts/browser-prerequisites.sh', self.workflow)
        for forbidden in ('contents: write', 'git push', 'pull_request:', 'download-artifact', 'npm test'):
            self.assertNotIn(forbidden, self.workflow)
        self.assertIn("report['knownBugConfirmed'] is True", self.workflow)
        self.assertIn("report['productSafetyGate'] is False", self.workflow)
        self.assertIn("report['nativeBrowserElapsedSeconds'] <= 150", self.workflow)

    def test_fixture_explicit_synthetic_real_offer_no_transaction(self):
        self.assertIn('createOffer(fresh, fresh.activePlanetId, 42, true)', self.fixture)
        self.assertIn('createInitialState(42, 42)', self.fixture)
        self.assertIn('generatedOffer', self.fixture)
        self.assertIn('anonymous explicitly synthetic current-reader-valid', self.fixture)
        self.assertIn('originalSha256: hash(raw)', self.fixture)
        self.assertIn('readExactly(raw)', self.fixture)
        self.assertNotIn('trade(', self.fixture)
        self.assertNotIn('summonMerchant(', self.fixture)
        self.assertIn('"1e100"', self.fixture)
        self.assertIn('"100000"', self.fixture)

    def test_real_actions_no_browser_business_calls_or_storage_wrappers(self):
        self.assertIn("field.fill('1000')", self.source)
        self.assertIn("page.locator(selector).click()", self.source)
        self.assertIn('e.isTrusted', self.source)
        self.assertIn("page.reload(wait_until='networkidle')", self.source)
        self.assertIn('Debugger.getScriptSource', self.source)
        self.assertIn('complete-62-http-resources.json', self.source)
        self.assertIn('window.__npcAdvance(0)', self.source)
        self.assertIn('signal.alarm(150)', self.source)
        self.assertIn("os.environ.get('GITHUB_ACTIONS') != 'true'", self.source)
        for forbidden in ('localStorage.setItem(', 'Storage.prototype.setItem =', 'dispatchEvent(', '.route(', 'set_content(', 'evaluate("trade(', 'connect_over_cdp'):
            self.assertNotIn(forbidden, self.source)
        self.assertIn("before == startup['expectedFirstSaveEnvelope']", self.source)
        self.assertIn("startup_differences == startup['originalToAdoptedDifferences']", self.source)
        self.assertIn('after == expected', self.source)
        self.assertIn('reloaded == expected', self.source)

    def test_startup_uses_whole_old_reader_catchup_and_session_without_exclusions(self):
        for token in ('new SaveSession(store, EPOCH)', 'catchUp(state, 0)', 'readerEnvelope', 'catchUpEnvelope',
                      'sessionAdoptedEnvelope', 'expectedFirstSaveEnvelope', 'originalToAdoptedDifferences'):
            self.assertIn(token, self.fixture)
        self.assertIn('Current-revision startup must retain untouched original raw', self.fixture)
        self.assertIn('achievements and dark matter', self.source)
        self.assertNotIn("del before[", self.source)
        self.assertNotIn("del after[", self.source)

    def test_full_raw_reader_acceptance_required_after_native_stage(self):
        self.assertIn("report['nativeCompleted'] = native_completion_allowed(report)", self.source)
        self.assertNotIn("report['completed'] = True", self.source)
        self.assertIn('strictEqual(report.saveFiles.length, 10', self.fixture)
        self.assertIn('strictEqual(hash(raw), entry.sha256', self.fixture)
        self.assertIn('deepStrictEqual(accepted, envelope', self.fixture)
        self.assertIn('deepStrictEqual(serializeState(state), envelope.state', self.fixture)
        self.assertIn('report.completed = true', self.fixture)
        self.assertIn('--verify-native', self.workflow)

    def test_failure_live_capture_precedes_cleanup_and_hashes_rechecked(self):
        tree = ast.parse(self.source)
        main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
        outer = next(n for n in main.body if isinstance(n, ast.Try))
        calls = [n for h in outer.handlers for n in ast.walk(h) if isinstance(n, ast.Call)]
        self.assertTrue(any(isinstance(n.func, ast.Name) and n.func.id == 'snapshot' for n in calls))
        self.assertTrue(any(isinstance(n.func, ast.Attribute) and n.func.attr == 'screenshot' for n in calls))
        self.assertIn("('server socket', server, 'server_close')", self.source)
        self.assertIn('dist_binding(args.dist) == build', self.source)
        self.assertIn('args.fixture.read_bytes() == fixture_raw', self.source)


if __name__ == '__main__':
    unittest.main()
