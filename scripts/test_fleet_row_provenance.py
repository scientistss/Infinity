"""Exact single-render fleet-row adoption on immutable public 7ab source.

Python/Git only. Synthetic objects are disposable; --build-manifest writes only
its named output and never changes its approved digest, refs, or production.
Every prior seal and every production path remain covered. Source identity is
not functional equivalence, measured benefit, native acceptance, or release.
"""
import copy
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import stat
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_recycle_preview_provenance as recycle
from test_lab_blockers_provenance import ObjectDatabase

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = '7ab569045996a1a6ad8ce1aee477092144dfad74'
PROTOTYPE = '5359676473c3b55e09acce33487ffd5f3ce8925a'
MANIFEST = 'tests/fixtures/fleet-row-provenance.json'
MANIFEST_SHA256 = 'beccaeedea8e7783665f7b32cbc09131c112ad9653cfd16d5e8914bff5e133dd'
RECYCLE_MANIFEST_SHA256 = 'b9e0d5f457580c0ea5fb5afae30baf3a37247c7b876c29830ccbb4db372c46f8'
FILE_SHA256 = '970c1f8a9102ef14f9680b3e34d22354abb4bb71353e4778c1a5fce6c777f65e'
PATCH_SHA256 = 'a488d9df9f99bba7ad408936bbbf963c9a5400a1e3eae19daebb0a8fca02e176'
SCHEMA = 'infinity-ring-protection-fleet-row-provenance-v1'
CONTRACT = 'exact-declared-fleet-row-source-delta'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src', 'public')
CHANGED_PATHS = ('src/ui/space-panel.ts',)
RING_HOOK = "    if candidate != '7ab569045996a1a6ad8ce1aee477092144dfad74' and git('ls-tree', candidate, '--', 'tests/fixtures/fleet-row-provenance.json'):\n        from test_fleet_row_provenance import fleet_row_provenance\n        return fleet_row_provenance(repository, candidate, git, check)\n"
FORMATION_ANCHOR = "        if result['contract'] == 'exact-declared-recycle-preview-source-delta':\n"
FORMATION_ADAPTER = ("        if result['contract'] == 'exact-declared-fleet-row-source-delta':\n"
    "            from test_fleet_row_provenance import verify_candidate as verify_fleet_candidate, REFERENCE as fleet_base\n"
    "            self.assertEqual(result, verify_fleet_candidate(candidate))\n"
    "            self.assertEqual(result['previousAdoptionSourceSha'], fleet_base)\n"
    "            result = result['previousProvenance']\n"
    "            self.assertEqual(result['contract'], 'exact-declared-recycle-preview-source-delta')\n"
    "            self.assertEqual(result['candidateSourceSha'], fleet_base)\n")
UNCHANGED_CHECKER_PATHS = ('scripts/test_manual_unit_provenance.py',)
ADAPTER_PATHS = ('scripts/browser-ring-protection.py', 'scripts/check-ui-baseline.mjs',
                 'scripts/test_recycle_preview_provenance.py',
                 'scripts/test_rehearsal_formation_copy_provenance.py')


def digest(raw): return hashlib.sha256(raw).hexdigest()


def git_read(*args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(ROOT), *args], stderr=subprocess.PIPE)


def module():
    spec = importlib.util.spec_from_file_location('fleet_row_ring_contract', ROOT/'scripts/browser-ring-protection.py')
    ring = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ring)
    return ring


changed, entry, row, manifest_bytes = recycle.changed, recycle.entry, recycle.row, recycle.manifest_bytes


def previous_manifests(ring):
    return [*recycle.previous_manifests(ring), (recycle.MANIFEST, RECYCLE_MANIFEST_SHA256)]


def ordinary_bytes(path):
    assert path.is_file() and not path.is_symlink(), ('Expected ordinary source file', str(path))
    assert stat.S_ISREG(path.lstat().st_mode) and not path.lstat().st_mode & 0o111, ('Executable or irregular source', str(path))
    return path.read_bytes()


def source_inventory(git, reference):
    result = {}
    for raw in git('ls-tree', '-r', '-z', reference, '--', *PRODUCTION_PATHS).split(b'\0'):
        if not raw: continue
        metadata, name = raw.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        path = name.decode('utf-8')
        assert kind == 'blob' and mode == '100644', ('Unexpected production object or mode', path)
        result[path] = {'mode': mode, 'sha256': digest(git('cat-file', 'blob', oid))}
    assert result and all(any(path.startswith(root+'/') for root in PRODUCTION_PATHS) for path in result)
    return result


def assert_worktree_inventory(repository, expected):
    actual = {}
    for root in PRODUCTION_PATHS:
        base = repository/root
        assert base.is_dir() and not base.is_symlink(), ('Invalid production root', root)
        for path in base.rglob('*'):
            assert not path.is_symlink(), ('Symlink in production inventory', str(path))
            if path.is_dir(): continue
            relative = path.relative_to(repository).as_posix()
            actual[relative] = {'mode': '100644', 'sha256': digest(ordinary_bytes(path))}
    assert actual == expected, 'Complete local production inventory, bytes or modes differ'


def make_manifest(ring, git, candidate):
    assert changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS), 'Exactly one fleet-row production path is permitted'
    approved = row(ring, git, REFERENCE, candidate, CHANGED_PATHS[0])
    assert approved['before'] == entry(git, REFERENCE, CHANGED_PATHS[0])
    assert approved['after'] == {'mode': '100644', 'sha256': FILE_SHA256}, 'Fleet-row source differs from reviewed prototype'
    assert approved['patchSha256'] == PATCH_SHA256, 'Complete fleet-row patch differs from reviewed prototype'
    assert entry(git, PROTOTYPE, CHANGED_PATHS[0]) == approved['after'], 'Immutable prototype pin differs'
    assert changed(git, PROTOTYPE, candidate, PRODUCTION_PATHS) == [], 'All production bytes and modes must equal the reviewed prototype'
    assert changed(git, REFERENCE, candidate, (*ring.DOMAIN_PATHS, *ring.RING_CRITICAL_PATHS)) == [], 'Domain and ring bytes must remain fixed at public 7ab'
    prior = json.loads(git('show', REFERENCE+':'+recycle.MANIFEST))
    baseline = {'baseline': '69eca71', 'expected': ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES,
                'exactDeltaPaths': list(recycle.manual.ORIGINAL_UI_PATHS),
                'changedPaths': [row(ring, git, recycle.manual.ORIGINAL_UI_REFERENCE, candidate, path)
                                 for path in recycle.manual.ORIGINAL_UI_PATHS]}
    assert baseline == prior['originalUiBaseline'], 'Original cumulative UI rows must stay exactly at public 7ab'
    inventory = source_inventory(git, candidate)
    return {
        'schema': SCHEMA, 'historicalBaselineSha': ring.BASELINE,
        'previousAdoptionSourceSha': REFERENCE, 'reviewedPrototypeSourceSha': PROTOTYPE,
        'previousManifests': [{'path': path, 'sha256': sha} for path, sha in previous_manifests(ring)],
        'referenceStatus': 'Exact fleet-row source adoption on recursively verified public 7ab recycle-preview source. The prototype is a source identity reference; its measured evidence is separate from release acceptance.',
        'scope': 'Every src/public file and mode, complete production inventory, exact before/after bytes, deterministic patch and every hunk are bound. All twelve prior seals and the original cumulative UI rows remain unchanged.',
        'approvedDelta': 'Only the reviewed fresh per-render first-match fleet-row lookup and detached-row fallback. No control authority, game, core, data, automation, save schema, economy, dispatch, style, view or public asset change.',
        'productionPaths': list(PRODUCTION_PATHS), 'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': [], 'exactRingCriticalDeltaPaths': [],
        'productionInventory': inventory,
        'originalUiBaseline': baseline, 'changedPaths': [approved],
    }


@lru_cache(maxsize=1)
def frozen_manifest_bytes():
    """Only immutable 7ab/535 Git objects are cached; never live source or adapters."""
    return manifest_bytes(make_manifest(module(), git_read, PROTOTYPE))


def read_manifest(repository):
    raw = ordinary_bytes(repository/MANIFEST)
    assert re.fullmatch('[0-9a-f]{64}', MANIFEST_SHA256) and digest(raw) == MANIFEST_SHA256, 'Fleet manifest is not the exact frozen seal'
    assert raw == frozen_manifest_bytes(), 'Fleet manifest fields must exactly describe the immutable reviewed source'
    def pairs(rows):
        value = {}
        for key, item in rows:
            assert key not in value, 'Duplicate fleet manifest key'
            value[key] = item
        return value
    value = json.loads(raw, object_pairs_hook=pairs)
    assert value['schema'] == SCHEMA and value['previousAdoptionSourceSha'] == REFERENCE, 'Unknown fleet schema or reference'
    assert value['reviewedPrototypeSourceSha'] == PROTOTYPE and value['productionPaths'] == list(PRODUCTION_PATHS)
    assert [item['path'] for item in value['changedPaths']] == list(CHANGED_PATHS), 'Unknown fleet source scope'
    assert value['previousManifests'] == [{'path': path, 'sha256': sha} for path, sha in previous_manifests(module())], 'Unknown or altered earlier seal'
    return raw, value


def fleet_row_provenance(repository, candidate, git, check):
    ring = module()
    check('Fleet rows integrate exact public 7ab ancestry', git('merge-base', REFERENCE, candidate).decode().strip() == REFERENCE)
    prior = recycle.recycle_preview_provenance(repository, REFERENCE, git, check)
    check('Fleet rows recursively preserve the public recycle contract', prior['contract'] == recycle.CONTRACT and prior['candidateSourceSha'] == REFERENCE)
    for path, expected in previous_manifests(ring):
        check('Fleet rows preserve every local and committed earlier seal: '+path,
              digest(ordinary_bytes(repository/path)) == expected
              and entry(git, candidate, path) == entry(git, REFERENCE, path) == {'mode': '100644', 'sha256': expected})
    raw, value = read_manifest(repository)
    check('Fleet manifest is the exact committed ordinary-file seal',
          entry(git, candidate, MANIFEST) == {'mode': '100644', 'sha256': MANIFEST_SHA256}
          and raw == git('show', candidate+':'+MANIFEST))
    check('Fleet rows bind every inventory entry, field, source byte, mode, patch and hunk', value == make_manifest(ring, git, candidate))
    check('Fleet rows do not claim historical domain byte identity', prior['historicalDomainByteIdentity'] is False)
    return {'contract': CONTRACT, 'historicalBaselineSha': ring.BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': REFERENCE, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(git, ring.BASELINE, candidate, ring.DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': MANIFEST, 'manifestSha256': digest(raw), 'manifest': value,
            'verificationScope': 'Exact cumulative fleet-row source adoption only; not native or CI acceptance. All earlier native gates and complete release acceptance remain required.'}


def historical_bytes(path): return git_read('show', REFERENCE+':'+path)


def exact_replace(before, old, new):
    assert before.count(old) == 1 and old != new and new not in before, 'Exact adapter anchor cardinality required'
    return before.replace(old, new, 1)


def ring_transition(before):
    return exact_replace(before, recycle.RING_HOOK.encode(), (RING_HOOK+recycle.RING_HOOK).encode())


def ui_transition(before, manifest_sha256):
    expected = before.decode()
    for old, new, count in (
        ('RECYCLE_PREVIEW_MANIFEST_SHA256', 'FLEET_ROW_MANIFEST_SHA256', 4),
        (RECYCLE_MANIFEST_SHA256, manifest_sha256, 1),
        (recycle.MANIFEST, MANIFEST, 1),
        ('scripts/test_recycle_preview_provenance.py', 'scripts/test_fleet_row_provenance.py', 1),
        (recycle.CONTRACT, CONTRACT, 1), (recycle.REFERENCE, REFERENCE, 1),
        ('complete original-to-recycle-preview cumulative source seal', 'complete original-to-fleet-row cumulative source seal', 1),
        ('eleven earlier seals', 'twelve earlier seals', 1),
        ('recycle-preview cumulative UI deltas', 'unchanged public-7ab cumulative UI deltas with exact fleet-row adoption', 1),
        ('回收预览 UI', '舰队行 UI', 4),
    ):
        assert expected.count(old) == count, ('Exact fleet UI checker transition cardinality', old)
        expected = expected.replace(old, new)
    return expected.encode()


def formation_transition(before):
    return exact_replace(before, FORMATION_ANCHOR.encode(), (FORMATION_ADAPTER+FORMATION_ANCHOR).encode())


def recycle_transition(before):
    for name, path, expression, message in (
        ('formation', 'scripts/test_rehearsal_formation_copy_provenance.py', 'formation_transition(before)', 'Unapproved formation-copy contract drift'),
        ('ring', 'scripts/browser-ring-protection.py', 'ring_transition(before)', 'Unapproved ring source drift beyond exact recycle dispatch'),
        ('ui_baseline', 'scripts/check-ui-baseline.mjs', 'ui_transition(before, MANIFEST_SHA256)', 'Unapproved recycle UI checker drift'),
    ):
        old = f"    assert (ROOT/'{path}').read_bytes() == {expression}, '{message}'\n"
        new = (f"    current = (ROOT/'{path}').read_bytes()\n"
               f"    if current != {expression}:\n"
               f"        from test_fleet_row_provenance import previous_{name}_bytes as fleet_previous_bytes\n"
               f"        current = fleet_previous_bytes(ROOT)\n"
               f"    assert current == {expression}, '{message}'\n")
        before = exact_replace(before, old.encode(), new.encode())
    old = "    assert candidate != REFERENCE, 'Recycle candidate must be committed separately from its public baseline'\n"
    new = ("    if git('ls-tree', candidate, '--', 'tests/fixtures/fleet-row-provenance.json'):\n"
           "        from test_fleet_row_provenance import verify_candidate as verify_fleet_candidate\n"
           "        result = verify_fleet_candidate(candidate)\n"
           "        assert result['contract'] == 'exact-declared-fleet-row-source-delta'\n"
           "        return result['previousProvenance']\n"+old)
    before = exact_replace(before, old.encode(), new.encode())
    for name, path, expression in (
        ('ring', 'scripts/browser-ring-protection.py', "ring_transition(historical_bytes('scripts/browser-ring-protection.py'))"),
        ('formation', 'scripts/test_rehearsal_formation_copy_provenance.py', "formation_transition(historical_bytes('scripts/test_rehearsal_formation_copy_provenance.py'))"),
    ):
        old = f"        self.assertEqual((ROOT/'{path}').read_bytes(), {expression})\n"
        new = (f"        from test_fleet_row_provenance import previous_{name}_bytes as fleet_previous_{name}_bytes\n"
               f"        self.assertEqual(fleet_previous_{name}_bytes(ROOT), {expression})\n")
        before = exact_replace(before, old.encode(), new.encode())
    return before


def previous_bytes(path, repository=None):
    repository = ROOT if repository is None else repository
    read_manifest(repository)
    before = historical_bytes(path)
    transitions = {ADAPTER_PATHS[0]: ring_transition,
                   ADAPTER_PATHS[1]: lambda raw: ui_transition(raw, MANIFEST_SHA256),
                   ADAPTER_PATHS[2]: recycle_transition, ADAPTER_PATHS[3]: formation_transition}
    assert ordinary_bytes(repository/path) == transitions[path](before), ('Unapproved fleet compatibility adapter drift', path)
    return before


def previous_ring_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[0], repository)
def previous_ui_baseline_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[1], repository)
def previous_recycle_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[2], repository)
def previous_formation_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[3], repository)


def verify_unchanged_checker_bytes(repository):
    for path in UNCHANGED_CHECKER_PATHS:
        assert ordinary_bytes(repository/path) == historical_bytes(path), (
            'Prior checker must remain byte-identical to public 7ab', path)


def capture_worktree(db):
    expected = source_inventory(db.git, PROTOTYPE)
    assert_worktree_inventory(ROOT, expected)
    for path, expected_hash in previous_manifests(module()):
        assert digest(ordinary_bytes(ROOT/path)) == expected_hash
        assert ordinary_bytes(ROOT/path) == db.git('show', REFERENCE+':'+path)
    candidate = db.make(REFERENCE, {CHANGED_PATHS[0]: ('100644', ordinary_bytes(ROOT/CHANGED_PATHS[0]))})
    return candidate, manifest_bytes(make_manifest(module(), db.git, candidate))


def build_worktree_manifest(destination):
    db = ObjectDatabase()
    try:
        _, raw = capture_worktree(db)
        Path(destination).write_bytes(raw)
        print(json.dumps({'path': str(destination), 'sha256': digest(raw), 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}))
    finally: db.close()


def verify_ui_baseline():
    db = ObjectDatabase()
    try:
        candidate, expected = capture_worktree(db)
        raw, _ = read_manifest(ROOT)
        assert raw == expected, 'Current production does not match frozen fleet-row seal'
        for path in ADAPTER_PATHS: previous_bytes(path)
        verify_unchanged_checker_bytes(ROOT)
        candidate = db.make(candidate, {MANIFEST: ('100644', raw)})
        checks = []
        def check(name, passed, detail=None):
            assert passed, name
            checks.append(name)
        result = fleet_row_provenance(ROOT, candidate, db.git, check)
        return {'contract': result['contract'], 'sourceScope': 'Exact current src/public inventory, bytes and modes; disposable objects only',
                'sourceBaseline': REFERENCE, 'manifestSha256': digest(raw), 'checks': len(checks),
                'originalUiBaseline': result['manifest']['originalUiBaseline'], 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}
    finally: db.close()


def verify_candidate(candidate):
    candidate = git_read('rev-parse', candidate+'^{commit}').decode().strip()
    assert candidate != REFERENCE, 'Fleet candidate must be committed separately from its public baseline'
    for path in (*ADAPTER_PATHS, *UNCHANGED_CHECKER_PATHS, 'scripts/test_fleet_row_provenance.py', MANIFEST):
        assert ordinary_bytes(ROOT/path) == git_read('show', candidate+':'+path), ('Executed seal differs from committed candidate', path)
    for path in ADAPTER_PATHS: previous_bytes(path)
    verify_unchanged_checker_bytes(ROOT)
    assert_worktree_inventory(ROOT, source_inventory(git_read, candidate))
    checks = []
    def check(name, passed, detail=None):
        assert passed, name
        checks.append(name)
    result = fleet_row_provenance(ROOT, candidate, git_read, check)
    assert len(checks) > 130, 'Complete prior source-provenance chain required'
    return result


class FleetRowSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db = ObjectDatabase()
    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        self.ring, self.git, self.make = module(), self.db.git, self.db.make
        self.view = self.db.tmp/'fleet-view'
        for path, _ in previous_manifests(self.ring):
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            if local.is_symlink(): local.unlink()
            local.write_bytes(self.git('show', REFERENCE+':'+path)); local.chmod(0o644)
        self.source = self.git('show', PROTOTYPE+':'+CHANGED_PATHS[0])
        self.provisional = self.make(REFERENCE, {CHANGED_PATHS[0]: ('100644', self.source)})
        self.manifest = make_manifest(self.ring, self.git, self.provisional)
        self.raw = manifest_bytes(self.manifest)
        self.assertEqual(digest(self.raw), MANIFEST_SHA256)
        local = self.view/MANIFEST
        if local.is_symlink(): local.unlink()
        local.write_bytes(self.raw); local.chmod(0o644)
        self.candidate = self.make(self.provisional, {MANIFEST: ('100644', self.raw)})

    def evaluate(self, candidate=None):
        def check(name, passed, detail=None): assert passed, name
        return self.ring.synchronized_domain_provenance(self.view, candidate or self.candidate, self.git, check)

    def reject(self, candidate=None):
        with self.assertRaises((AssertionError, FileNotFoundError, KeyError, TypeError, subprocess.CalledProcessError)):
            self.evaluate(candidate)

    def reject_repinned(self, value):
        raw = manifest_bytes(value); (self.view/MANIFEST).write_bytes(raw)
        candidate = self.make(self.candidate, {MANIFEST: ('100644', raw)})
        with patch(__name__+'.MANIFEST_SHA256', digest(raw)), patch('test_fleet_row_provenance.MANIFEST_SHA256', digest(raw)):
            self.reject(candidate)
        (self.view/MANIFEST).write_bytes(self.raw)

    def test_exact_reviewed_delta_recursively_retains_all_twelve_seals(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], CONTRACT)
        self.assertEqual(result['previousProvenance']['contract'], recycle.CONTRACT)
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertEqual(len(result['manifest']['previousManifests']), 12)
        self.assertIs(result['historicalDomainByteIdentity'], False)
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertEqual(result['manifest']['originalUiBaseline'], result['previousProvenance']['manifest']['originalUiBaseline'])

    def test_fleet_file_bytes_modes_symlink_delete_and_reversion_fail(self):
        for value in [('100644', self.source+b' '), ('100755', self.source), ('120000', b'other.ts'), None,
                      ('100644', self.git('show', REFERENCE+':'+CHANGED_PATHS[0]))]:
            with self.subTest(value=value): self.reject(self.make(self.candidate, {CHANGED_PATHS[0]: value}))

    def test_full_source_scope_rejects_unrelated_additions_and_changes(self):
        for path in ('src/unknown.ts', 'src/ui/unknown.ts', 'src/game/unknown.ts', 'src/core/unknown.ts',
                     'src/data/unknown.ts', 'src/automation/unknown.ts', 'public/unknown.svg'):
            with self.subTest(path=path): self.reject(self.make(self.candidate, {path: ('100644', b'extra')}))
        for path in ('src/main.ts', 'src/style.css', 'src/space.css', 'src/ui/view.ts', 'src/game/save.ts',
                     'src/game/content.ts', 'src/core/offline.ts', 'src/data/units.ts',
                     'src/ui/recycle-preview-panel.ts', 'public/favicon-32.png'):
            raw = self.git('show', REFERENCE+':'+path)
            for value in [('100644', raw+b' '), ('100755', raw), None]:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))

    def test_manifest_regeneration_cannot_admit_a_changed_implementation(self):
        for path, raw in ((CHANGED_PATHS[0], self.source), ('src/game/save.ts', self.git('show', REFERENCE+':src/game/save.ts'))):
            with self.subTest(path=path), self.assertRaises(AssertionError):
                make_manifest(self.ring, self.git, self.make(self.candidate, {path: ('100644', raw+b' ')}))

    def test_all_manifest_fields_and_patch_inventory_bindings_fail_when_repinned(self):
        for key in self.manifest:
            value = copy.deepcopy(self.manifest); del value[key]
            with self.subTest(key=key): self.reject_repinned(value)
        mutations = [lambda m: m.update(unknown=True), lambda m: m.update(schema='unknown'),
            lambda m: m.update(previousAdoptionSourceSha=PROTOTYPE), lambda m: m.update(reviewedPrototypeSourceSha=REFERENCE),
            lambda m: m['productionPaths'].append('scripts'), lambda m: m['exactDomainDeltaPaths'].append('src/game/save.ts'),
            lambda m: m['previousManifests'].pop(), lambda m: m['productionInventory'].pop('src/main.ts'),
            lambda m: m['productionInventory']['src/main.ts'].update(sha256='0'*64),
            lambda m: m['originalUiBaseline']['changedPaths'][0]['before'].update(sha256='0'*64)]
        for field in ('before', 'after', 'patchSha256', 'hunks'):
            mutations.append(lambda m, field=field: m['changedPaths'][0].update({field: None}))
        for mutate in mutations:
            value = copy.deepcopy(self.manifest); mutate(value); self.reject_repinned(value)

    def test_all_twelve_older_seals_reject_local_and_committed_drift(self):
        for path, _ in previous_manifests(self.ring):
            raw = self.git('show', REFERENCE+':'+path)
            for value in [('100644', raw+b' '), ('100755', raw), ('120000', b'other.json'), None]:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))
            local = self.view/path
            local.write_bytes(raw+b' '); self.reject(); local.write_bytes(raw)
            local.chmod(0o755); self.reject(); local.chmod(0o644)

    def test_new_manifest_local_and_committed_bytes_modes_and_symlink_fail(self):
        local = self.view/MANIFEST
        local.write_bytes(self.raw+b' '); self.reject(); local.write_bytes(self.raw)
        local.chmod(0o755); self.reject(); local.chmod(0o644)
        for value in [('100755', self.raw), ('120000', b'other.json'), None]:
            self.reject(self.make(self.candidate, {MANIFEST: value}))
        local.unlink(); target = self.db.tmp/'fleet-manifest-target'; target.write_bytes(self.raw)
        local.symlink_to(target); self.reject(); local.unlink(); local.write_bytes(self.raw)

    def test_unrelated_ancestry_cannot_adopt_identical_source(self):
        tree = self.git('rev-parse', self.candidate+'^{tree}').decode().strip()
        self.reject(self.git('commit-tree', tree, input=b'Unrelated source\n').decode().strip())

    def test_old_public_source_keeps_its_own_recycle_contract(self):
        self.assertEqual(self.evaluate(REFERENCE)['contract'], recycle.CONTRACT)

    def test_exact_checker_and_prior_contract_transitions(self):
        verify_unchanged_checker_bytes(ROOT)
        for path in ADAPTER_PATHS:
            self.assertEqual(previous_bytes(path), historical_bytes(path))

    def test_projection_refuses_changed_manifest_or_any_adapter_byte(self):
        transitions = (ring_transition, lambda raw: ui_transition(raw, MANIFEST_SHA256), recycle_transition, formation_transition)
        for path, transition in zip(ADAPTER_PATHS, transitions):
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            expected = transition(historical_bytes(path)); local.write_bytes(expected); local.chmod(0o644)
            self.assertEqual(previous_bytes(path, self.view), historical_bytes(path))
            for bad in (expected+b'\n', expected.replace(b'\n', b'\r\n'), b'unapproved'):
                local.write_bytes(bad)
                with self.assertRaises(AssertionError): previous_bytes(path, self.view)
            local.write_bytes(expected)
            local.chmod(0o755)
            with self.assertRaises(AssertionError): previous_bytes(path, self.view)
            local.chmod(0o644)
        local = self.view/MANIFEST; local.write_bytes(self.raw+b' ')
        for path in ADAPTER_PATHS:
            with self.assertRaises(AssertionError): previous_bytes(path, self.view)
        local.write_bytes(self.raw)

    def test_prior_manual_checker_cannot_drift_behind_successor_projection(self):
        for path in UNCHANGED_CHECKER_PATHS:
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            expected = historical_bytes(path); local.write_bytes(expected); local.chmod(0o644)
            verify_unchanged_checker_bytes(self.view)
            local.write_bytes(expected+b'\n')
            with self.assertRaises(AssertionError): verify_unchanged_checker_bytes(self.view)
            local.write_bytes(expected); local.chmod(0o755)
            with self.assertRaises(AssertionError): verify_unchanged_checker_bytes(self.view)
            local.chmod(0o644)

    def test_complete_local_inventory_rejects_hidden_extra_symlink_mode_and_missing_files(self):
        root = self.db.tmp/'inventory-view'
        for directory in PRODUCTION_PATHS: (root/directory).mkdir(parents=True, exist_ok=True)
        path = root/'src/test.ts'; path.write_bytes(b'exact'); path.chmod(0o644)
        expected = {'src/test.ts': {'mode': '100644', 'sha256': digest(b'exact')}}
        assert_worktree_inventory(root, expected)
        for extra in ('src/.ignored.ts', 'public/extra.svg'):
            p = root/extra; p.write_bytes(b'extra')
            with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
            p.unlink()
        path.chmod(0o755)
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
        path.chmod(0o644); path.unlink(); path.symlink_to(self.view/MANIFEST)
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)
        path.unlink()
        with self.assertRaises(AssertionError): assert_worktree_inventory(root, expected)


class FleetRowCommittedCandidateTests(unittest.TestCase):
    def test_actual_committed_candidate_matches_complete_frozen_source(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'], CONTRACT)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--build-manifest': build_worktree_manifest(sys.argv[2])
    elif sys.argv[1:] == ['--verify-ui-baseline']: print(json.dumps(verify_ui_baseline(), ensure_ascii=False, indent=2))
    else:
        if len(sys.argv) >= 3 and sys.argv[1] == '--verify-candidate':
            CANDIDATE = sys.argv[2]; del sys.argv[1:3]
        unittest.main()
