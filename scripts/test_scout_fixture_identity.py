"""Offline identity contracts using EXPLICIT SYNTHETIC evidence, never game/CI proof.

Inputs are repository-local committed pool/scripts/lock; no archived CI or local
absolute paths. Only read-only Git operations run. No Node/build/browser runs.
"""
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scout_identity_contract_subject', Path(__file__).with_name('scout_fixture_identity.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
READ_ONLY_GIT = m._git
VERIFY_HISTORICAL = m._historical_source_bindings
FILES = (m.POOL_PATH, 'scripts/scout-historical-fixtures.mjs', 'scripts/scout-historical-fixtures.py',
         'scripts/scout-rehearsal-natural-route.ts', 'src/game/save.ts', 'package-lock.json')


def synthetic_natural(pool, source_code, source_sha, runtime):
    original = next(row for row in pool['rows'] if row['id'] == 'r13-empty10-zero-round-loot-delivered')
    milestones = []
    # Deliberately minimal, non-game states. This fixture exercises the binding
    # validator only; it cannot count as a successful natural/native execution.
    for name in m.MILESTONES:
        milestones.append({'name': name, 'raw': '{}', 'rawSha256': m._sha(b'{}'),
            'historicalRaw': '{}', 'historicalRawSha256': m._sha(b'{}'),
            'expected': {}, 'reload': False})
    milestones[2].update(reload=True, expected={
        'fleets': [{'id': 11, 'returning': False, 'remaining': .5, 'duration': 1}],
        'messages': [{'npcScoutSnapshot': None}]})
    return {'schema': 'infinity-scout-rehearsal-natural-route-v1',
        'classification': 'EXPLICIT SYNTHETIC offline provenance contract; not natural game evidence',
        'source': {'sourceSha': source_sha, 'sourceScopeStatusPorcelain': '',
            'fixturePoolSha256': source_code[m.POOL_PATH],
            'routeScriptSha256': source_code['scripts/scout-rehearsal-natural-route.ts'],
            'dependencyLockSha256': source_code['package-lock.json'], 'runtimeNode': runtime,
            'oldSourceSha': m.SOURCE_PIN, 'oldSourceBindings': copy.deepcopy(pool['sourceBindings']['13']['sourceFiles'])},
        'origin': {'id': original['id'], 'historicalSourceSha': m.SOURCE_PIN,
            'raw': original['raw'], 'rawSha256': original['rawSha256'], 'envelope': json.loads(original['raw'])},
        'outcome': {'status': 'passed', 'mainComplete': True, 'failure': None, 'checks': 1},
        'checks': [{'name': 'synthetic contract check, not a game assertion', 'passed': True}],
        'target': {'galaxy': 1, 'system': 56, 'position': 15}, 'publicSeeds': [608135816, 2242054355, 320440878],
        'milestones': milestones,
        'tape': [{'kind': 'scout', 'fleetId': 11}, {'kind': 'attack', 'fleetId': 12}, {'kind': 'scout', 'fleetId': 13},
            *[{'kind': 'checkpoint', 'name': name} for name in m.MILESTONES]],
        'branches': {name: {'classification': 'EXPLICIT SYNTHETIC offline contract'} for name in
            ('paidCompletion', 'performance', 'maxMessages', 'eviction', 'curvature')},
        'observations': [], 'naturalExamples': None, 'timeDistinctions': [],
        'nativeAcceptance': 'NEVER RUN: synthetic offline contract fixture'}


def synthetic_history(pool, source_code):
    return {'schema': 'infinity-scout-genuine-legacy-verification-v1',
        'classification': 'EXPLICIT SYNTHETIC offline contract; historical verification was not executed',
        'candidateSaveSha256': source_code['src/game/save.ts'], 'fixtureSha256': source_code[m.POOL_PATH],
        'rows': len(pool['rows']), 'status': 'passed', 'checks': [
            {'id': row['id'], 'revision': row['revision'], 'messages': len(row['r13ReaderOutput']['state']['messages']),
             'fullProjection': 'exact', 'actualCandidateRefusedByOldSource':
                 {'rejected': True, 'message': 'EXPLICIT SYNTHETIC offline refusal assertion'}} for row in pool['rows']]}


class ScoutFixtureIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pool = json.loads((ROOT / m.POOL_PATH).read_bytes())
        cls.source_sha = READ_ONLY_GIT(ROOT, 'rev-parse', 'HEAD').decode().strip()
        cls.runtime = 'v22.99.0'  # Explicit synthetic runtime; never execute Node.
        cls.old_lock = READ_ONLY_GIT(ROOT, 'show', m.LOCK_ORIGIN + ':package-lock.json')
        # Verify all twelve historical source sets once against real local Git
        # bytes. Repeated identity unit mutations mock this already-tested step.
        cls.bindings = VERIFY_HISTORICAL(ROOT, cls.pool)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='scout-identity-offline-')
        self.addCleanup(self.directory.cleanup)
        self.workspace = Path(self.directory.name)
        for relative in FILES:
            target = self.workspace / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, target)
        self.current = {'sourceSha': self.source_sha, 'sourceCode': {
            path: hashlib.sha256((self.workspace / path).read_bytes()).hexdigest() for path in FILES}}
        self.pool = copy.deepcopy(type(self).pool)
        self.natural = synthetic_natural(self.pool, self.current['sourceCode'], self.source_sha, self.runtime)
        self.history = synthetic_history(self.pool, self.current['sourceCode'])
        self.sync()
        patch = mock.patch.object(m, '_git', side_effect=self.git)
        patch.start(); self.addCleanup(patch.stop)
        patch = mock.patch.object(m, '_historical_source_bindings', return_value=self.bindings)
        patch.start(); self.addCleanup(patch.stop)

    def git(self, root, *args):
        self.assertEqual(args, ('show', m.LOCK_ORIGIN + ':package-lock.json'))
        return self.old_lock

    def sync(self):
        for relative, value in ((m.NATURAL_PATH, self.natural), (m.HISTORY_PATH, self.history)):
            path = self.workspace / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(json.dumps(value, ensure_ascii=False, indent=2).encode() + b'\n')

    def run_identity(self):
        self.sync()
        return m.scout_fixture_identity(self.workspace, self.current, self.runtime)

    def test_original_three_argument_signature_is_unchanged(self):
        self.assertEqual(str(inspect.signature(m.scout_fixture_identity)),
                         '(workspace, clean_source_summary, runtime)')

    def test_only_exact_candidate_lock_versions_and_original_dependencies_are_allowed(self):
        path = self.workspace / 'package-lock.json'
        original = path.read_bytes()
        lock = json.loads(original)
        self.assertEqual(lock['version'], '0.6.27-alpha.1')
        self.assertEqual(lock['packages']['']['version'], '0.6.27-alpha.1')
        for field in ('top', 'package'):
            for version in ('0.6.22-alpha.2', '0.6.23-alpha.1', '0.6.23-alpha.2', '0.6.24-alpha.1', '0.6.24-alpha.2', '0.6.26-alpha.2', '0.6.24', True, None):
                changed = copy.deepcopy(lock)
                target = changed if field == 'top' else changed['packages']['']
                target['version'] = version
                body = json.dumps(changed).encode('utf-8')
                path.write_bytes(body)
                self.current['sourceCode']['package-lock.json'] = m._sha(body)
                self.natural['source']['dependencyLockSha256'] = m._sha(body)
                with self.subTest(field=field, version=version), self.assertRaisesRegex(ValueError, 'Wrong r14 lock release'):
                    self.run_identity()
        changed = copy.deepcopy(lock)
        changed['packages']['node_modules/break_infinity.js']['version'] = '0.0.0'
        body = json.dumps(changed).encode('utf-8')
        path.write_bytes(body)
        self.current['sourceCode']['package-lock.json'] = m._sha(body)
        self.natural['source']['dependencyLockSha256'] = m._sha(body)
        with self.assertRaisesRegex(ValueError, 'Dependency contents differ from fixture producer'):
            self.run_identity()
        path.write_bytes(original)
        self.current['sourceCode']['package-lock.json'] = m._sha(original)
        self.natural['source']['dependencyLockSha256'] = m._sha(original)
        self.run_identity()

    def test_synthetic_contract_positive_full_hashes(self):
        value = self.run_identity()
        self.assertEqual(value['identity']['historicalRowCount'], len(self.pool['rows']))
        self.assertEqual(value['identity']['naturalCheckCount'], 1)
        self.assertEqual(value['identity']['excludedFields'], [])
        for name, relative in (('pool', m.POOL_PATH), ('historical', m.HISTORY_PATH), ('natural', m.NATURAL_PATH)):
            self.assertEqual(value['identity']['rawSha256'][name], m._sha((self.workspace / relative).read_bytes()))
        self.assertIn('binding only', value['classification'])

    def test_dirty_natural_and_stale_historical_reports_rejected(self):
        self.natural['source']['sourceScopeStatusPorcelain'] = ' M scripts/scout-rehearsal-natural-route.ts'
        with self.assertRaisesRegex(ValueError, 'stale or dirty'): self.run_identity()
        self.natural['source']['sourceScopeStatusPorcelain'] = ''
        self.history['candidateSaveSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Historical candidate source mismatch'): self.run_identity()

    def test_natural_provenance_and_completeness_fail_closed(self):
        cases = [('schema',), ('source', 'sourceSha'), ('source', 'sourceScopeStatusPorcelain'),
            ('source', 'fixturePoolSha256'), ('source', 'routeScriptSha256'), ('source', 'dependencyLockSha256'),
            ('source', 'runtimeNode'), ('source', 'oldSourceSha'), ('source', 'oldSourceBindings'),
            ('outcome', 'status'), ('outcome', 'mainComplete'), ('outcome', 'failure'), ('outcome', 'checks'),
            ('origin', 'raw'), ('origin', 'rawSha256'), ('origin', 'historicalSourceSha'), ('origin', 'envelope'),
            ('target',), ('publicSeeds',)]
        baseline = copy.deepcopy(self.natural)
        for path in cases:
            with self.subTest(path=path):
                self.natural = copy.deepcopy(baseline); target = self.natural
                for key in path[:-1]: target = target[key]
                target[path[-1]] = 'invalid-offline-mutation'
                with self.assertRaises((ValueError, TypeError, KeyError)): self.run_identity()

    def test_history_source_pool_counts_projection_and_refusal_fail_closed(self):
        baseline = copy.deepcopy(self.history)
        cases = [('schema',), ('status',), ('candidateSaveSha256',), ('fixtureSha256',), ('rows',),
            ('checks', 0, 'id'), ('checks', 0, 'revision'), ('checks', 0, 'messages'),
            ('checks', 0, 'fullProjection'), ('checks', 0, 'actualCandidateRefusedByOldSource', 'rejected')]
        for path in cases:
            with self.subTest(path=path):
                self.history = copy.deepcopy(baseline); target = self.history
                for key in path[:-1]: target = target[key]
                target[path[-1]] = 'invalid-offline-mutation'
                with self.assertRaises(ValueError): self.run_identity()
        self.history = copy.deepcopy(baseline); self.history['checks'].pop()
        with self.assertRaises(ValueError): self.run_identity()

    def test_missing_failed_or_truthy_checks_and_missing_branches_rejected(self):
        baseline = copy.deepcopy(self.natural)
        for name in ('empty', 'failed', 'truthy', 'milestone', 'tape', 'branch', 'raw', 'historicalRaw'):
            with self.subTest(name=name):
                self.natural = copy.deepcopy(baseline)
                if name == 'empty': self.natural['checks'] = []
                elif name in ('failed', 'truthy'): self.natural['checks'][0]['passed'] = False if name == 'failed' else 1
                elif name == 'milestone': self.natural['milestones'].pop()
                elif name == 'tape': self.natural['tape'].pop()
                elif name == 'branch': del self.natural['branches']['paidCompletion']
                else: self.natural['milestones'][0][name] += ' '
                with self.assertRaises(ValueError): self.run_identity()

    def test_complete_game_and_unknown_fields_remain_bound(self):
        baseline = copy.deepcopy(self.natural); digest = self.run_identity()['identitySha256']
        for key in ('observations', 'naturalExamples', 'branches', 'timeDistinctions', 'nativeAcceptance', 'unknownNewField'):
            with self.subTest(key=key):
                self.natural = copy.deepcopy(baseline)
                if key == 'branches': self.natural[key]['offline-extra-field'] = {'changed': True}
                else: self.natural[key] = {'changed': 'complete value retained in hash'}
                self.assertNotEqual(self.run_identity()['identitySha256'], digest)

    def test_hash_changes_for_raw_whitespace_not_canonical_content(self):
        first = self.run_identity(); path = self.workspace / m.NATURAL_PATH
        path.write_bytes(path.read_bytes() + b' \n')
        second = m.scout_fixture_identity(self.workspace, self.current, self.runtime)
        self.assertNotEqual(first['identity']['rawSha256']['natural'], second['identity']['rawSha256']['natural'])
        self.assertEqual(first['identity']['canonicalSha256']['natural'], second['identity']['canonicalSha256']['natural'])
        self.assertNotEqual(first['identitySha256'], second['identitySha256'])

    def test_duplicate_json_and_nonfinite_numbers_rejected(self):
        for raw in (b'{"key":1,"key":2}', b'{"key":NaN}', b'{"key":Infinity}'):
            with self.assertRaises(ValueError): m._json(raw)

    def test_source_tamper_missing_output_and_symlink_rejected(self):
        path = self.workspace / 'scripts/scout-rehearsal-natural-route.ts'
        old = path.read_bytes(); path.write_bytes(old + b' ')
        with self.assertRaisesRegex(ValueError, 'Tracked source digest mismatch'): self.run_identity()
        path.write_bytes(old); natural = self.workspace / m.NATURAL_PATH; natural.unlink()
        with self.assertRaisesRegex(ValueError, 'Missing input'): m.scout_fixture_identity(self.workspace, self.current, self.runtime)
        natural.symlink_to(self.workspace / m.POOL_PATH)
        with self.assertRaisesRegex(ValueError, 'Symlinked input'): m.scout_fixture_identity(self.workspace, self.current, self.runtime)

    def test_historical_source_binding_mutations_rejected(self):
        for name in ('sourceTree', 'sourceFile', 'duplicateFile', 'serializer'):
            with self.subTest(name=name):
                pool = copy.deepcopy(type(self).pool); binding = pool['sourceBindings']['2']
                if name == 'sourceTree': binding['sourceTree'] = '0' * 40
                elif name == 'sourceFile': binding['sourceFiles'][0]['sha256'] = '0' * 64
                elif name == 'duplicateFile': binding['sourceFiles'].append(copy.deepcopy(binding['sourceFiles'][0]))
                else: binding['serializerSha256'] = '0' * 64
                with mock.patch.object(m, '_git', READ_ONLY_GIT), self.assertRaises(ValueError): VERIFY_HISTORICAL(ROOT, pool)

    def test_producer_lock_and_current_pool_tamper_rejected(self):
        old = self.old_lock; self.old_lock += b' '
        with self.assertRaisesRegex(ValueError, 'Historical producer lock mismatch'): self.run_identity()
        self.old_lock = old; path = self.workspace / m.POOL_PATH
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'Tracked source digest mismatch'): m.scout_fixture_identity(self.workspace, self.current, self.runtime)

    def test_missing_required_fields_and_runtime_fail_closed(self):
        baseline = copy.deepcopy(self.natural)
        for field in ('source', 'outcome', 'checks', 'origin', 'milestones', 'tape', 'branches'):
            with self.subTest(field=field):
                self.natural = copy.deepcopy(baseline); del self.natural[field]
                with self.assertRaises(KeyError): self.run_identity()
        self.natural = baseline
        for runtime in ('', '22', None, 'v22.1.2\n'):
            with self.subTest(runtime=runtime), self.assertRaises(ValueError):
                m.scout_fixture_identity(self.workspace, self.current, runtime)

if __name__ == '__main__': unittest.main(verbosity=2)
