"""Exact minimal astrophysics unlock-copy adoption on immutable public 493 source.

Python/Git only. Disposable objects bind the full production inventory, complete
patch and every hunk, and recursively verify all thirteen earlier manifests.
Only the two explicitly removed lines are accepted. A regenerated or repinned
manifest cannot authorize a different implementation. Source provenance is not
native, functional, CI or release acceptance. No real index or refs are written.
"""
import copy
from functools import lru_cache
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_fleet_row_provenance as fleet
from test_lab_blockers_provenance import ObjectDatabase

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = '49303d3740cf223955386ff984b335ca9b110087'
MANIFEST = 'tests/fixtures/research-unlock-copy-provenance.json'
MANIFEST_SHA256 = 'ee3d929da35f41aef0aad587a11ab6acba0726abde44f0de5f753a74c4cb6999'
FLEET_MANIFEST_SHA256 = 'beccaeedea8e7783665f7b32cbc09131c112ad9653cfd16d5e8914bff5e133dd'
FILE_SHA256 = '9f40aa07c776b40cd2b3be866a9dcc11a72ffdbca55d86d96029251d1f0de6f3'
PATCH_SHA256 = '140006509a2e35fb4d7acfb3befd67ec249d93f42fefbfc7f64a383758157939'
SCHEMA = 'infinity-ring-protection-research-unlock-copy-provenance-v1'
CONTRACT = 'exact-declared-research-unlock-copy-source-delta'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src', 'public')
CHANGED_PATHS = ('src/ui/present.ts',)
ADAPTER_PATHS = ('scripts/browser-ring-protection.py', 'scripts/check-ui-baseline.mjs',
                 'scripts/test_fleet_row_provenance.py',
                 'scripts/test_rehearsal_formation_copy_provenance.py')
UNCHANGED_CHECKER_PATHS = ('scripts/test_manual_unit_provenance.py',
                           'scripts/test_recycle_preview_provenance.py')
RING_HOOK = "    if candidate != '49303d3740cf223955386ff984b335ca9b110087' and git('ls-tree', candidate, '--', 'tests/fixtures/research-unlock-copy-provenance.json'):\n        from test_research_unlock_copy_provenance import research_unlock_copy_provenance\n        return research_unlock_copy_provenance(repository, candidate, git, check)\n"
FORMATION_ANCHOR = "        if result['contract'] == 'exact-declared-fleet-row-source-delta':\n"
FORMATION_ADAPTER = ("        if result['contract'] == 'exact-declared-research-unlock-copy-source-delta':\n"
    "            from test_research_unlock_copy_provenance import verify_candidate as verify_research_candidate, REFERENCE as research_base\n"
    "            self.assertEqual(result, verify_research_candidate(candidate))\n"
    "            self.assertEqual(result['previousAdoptionSourceSha'], research_base)\n"
    "            result = result['previousProvenance']\n"
    "            self.assertEqual(result['contract'], 'exact-declared-fleet-row-source-delta')\n"
    "            self.assertEqual(result['candidateSourceSha'], research_base)\n")


def digest(raw): return hashlib.sha256(raw).hexdigest()


def git_read(*args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(ROOT), *args], stderr=subprocess.PIPE)


def module():
    spec = importlib.util.spec_from_file_location('research_unlock_copy_ring_contract', ROOT/'scripts/browser-ring-protection.py')
    ring = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ring)
    return ring


changed, entry, row, manifest_bytes = fleet.changed, fleet.entry, fleet.row, fleet.manifest_bytes
ordinary_bytes = fleet.ordinary_bytes
source_inventory, assert_worktree_inventory = fleet.source_inventory, fleet.assert_worktree_inventory
exact_replace = fleet.exact_replace


def previous_manifests(ring):
    return [*fleet.previous_manifests(ring), (fleet.MANIFEST, FLEET_MANIFEST_SHA256)]


def expected_present(git):
    before = git('show', REFERENCE+':'+CHANGED_PATHS[0])
    anchor = b'function researchEffect(state: GameState, def: ResearchDef, target: number): string {\n  const levels = state.research.levels;\n'
    assert before.count(anchor) == 1, 'Exact historical research-effect binding required'
    after = before.replace(anchor, anchor.replace(b'  const levels = state.research.levels;\n', b''), 1)
    expired = '  if (def.id === "astrophysics" && levels.astrophysics < 1) return `${def.effect}（第 2 阶段后续版本开放）`;\n'.encode()
    assert after.count(expired) == 1, 'Exact historical expired astrophysics branch required'
    return after.replace(expired, b'', 1)


def make_manifest(ring, git, candidate):
    assert changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS), 'Only the exact research effect copy path may change'
    assert git('show', candidate+':'+CHANGED_PATHS[0]) == expected_present(git), 'Only the two exact obsolete-copy lines may be removed'
    approved = row(ring, git, REFERENCE, candidate, CHANGED_PATHS[0])
    assert approved['before'] == entry(git, REFERENCE, CHANGED_PATHS[0])
    assert approved['after'] == {'mode': '100644', 'sha256': FILE_SHA256}, 'Research unlock source differs from the exact reviewed correction'
    assert approved['patchSha256'] == PATCH_SHA256, 'Complete research unlock patch differs from the exact reviewed correction'
    assert changed(git, REFERENCE, candidate, (*ring.DOMAIN_PATHS, *ring.RING_CRITICAL_PATHS)) == [], 'All domain and ring bytes must remain fixed at public 493'
    prior = json.loads(git('show', REFERENCE+':'+fleet.MANIFEST))
    baseline = {'baseline': '69eca71', 'expected': ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES,
                'exactDeltaPaths': list(fleet.recycle.manual.ORIGINAL_UI_PATHS),
                'changedPaths': [row(ring, git, fleet.recycle.manual.ORIGINAL_UI_REFERENCE, candidate, path)
                                 for path in fleet.recycle.manual.ORIGINAL_UI_PATHS]}
    assert baseline == prior['originalUiBaseline'], 'Original cumulative UI rows must remain exactly at public 493'
    inventory = source_inventory(git, candidate)
    return {
        'schema': SCHEMA, 'historicalBaselineSha': ring.BASELINE,
        'previousAdoptionSourceSha': REFERENCE,
        'previousManifests': [{'path': path, 'sha256': sha} for path, sha in previous_manifests(ring)],
        'referenceStatus': 'Exact minimal astrophysics copy correction on recursively verified public 493 fleet-row source. The historical fleet prototype and all earlier source contracts remain independently verifiable.',
        'scope': 'Every src/public file and mode, complete production inventory, exact before/after bytes, deterministic patch and every hunk are bound. All thirteen prior manifests and original cumulative UI rows remain unchanged.',
        'approvedDelta': 'Remove only the expired level-zero astrophysics future-release suffix and the now-unused research-level binding. No game, core, data, automation, ring behavior, research prerequisites, future-feature description, style, asset or unrelated presentation change.',
        'productionPaths': list(PRODUCTION_PATHS), 'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': [], 'exactRingCriticalDeltaPaths': [],
        'productionInventory': inventory,
        'originalUiBaseline': baseline, 'changedPaths': [approved],
    }


@lru_cache(maxsize=1)
def frozen_manifest_bytes():
    """Cache only a deterministic projection of immutable 493 Git objects."""
    db = ObjectDatabase()
    try:
        candidate = db.make(REFERENCE, {CHANGED_PATHS[0]: ('100644', expected_present(db.git))})
        return manifest_bytes(make_manifest(module(), db.git, candidate))
    finally: db.close()


def read_manifest(repository):
    raw = ordinary_bytes(repository/MANIFEST)
    assert re.fullmatch('[0-9a-f]{64}', MANIFEST_SHA256) and digest(raw) == MANIFEST_SHA256, 'Research unlock manifest is not the exact frozen seal'
    assert raw == frozen_manifest_bytes(), 'Research unlock fields must exactly describe the independently fixed two-line source correction'
    def pairs(rows):
        value = {}
        for key, item in rows:
            assert key not in value, 'Duplicate research unlock manifest key'
            value[key] = item
        return value
    value = json.loads(raw, object_pairs_hook=pairs)
    assert value['schema'] == SCHEMA and value['previousAdoptionSourceSha'] == REFERENCE, 'Unknown research unlock schema or reference'
    assert value['productionPaths'] == list(PRODUCTION_PATHS)
    assert [item['path'] for item in value['changedPaths']] == list(CHANGED_PATHS), 'Unknown research unlock source scope'
    assert value['previousManifests'] == [{'path': path, 'sha256': sha} for path, sha in previous_manifests(module())], 'Unknown or altered earlier seal'
    return raw, value


def research_unlock_copy_provenance(repository, candidate, git, check):
    ring = module()
    check('Research unlock integrates exact public 493 ancestry', git('merge-base', REFERENCE, candidate).decode().strip() == REFERENCE)
    prior = fleet.fleet_row_provenance(repository, REFERENCE, git, check)
    check('Research unlock recursively preserves the public fleet contract', prior['contract'] == fleet.CONTRACT and prior['candidateSourceSha'] == REFERENCE)
    for path, expected in previous_manifests(ring):
        check('Research unlock preserves every local and committed earlier seal: '+path,
              digest(ordinary_bytes(repository/path)) == expected
              and entry(git, candidate, path) == entry(git, REFERENCE, path) == {'mode': '100644', 'sha256': expected})
    raw, value = read_manifest(repository)
    check('Research unlock manifest is the exact committed ordinary-file seal',
          entry(git, candidate, MANIFEST) == {'mode': '100644', 'sha256': MANIFEST_SHA256}
          and raw == git('show', candidate+':'+MANIFEST))
    check('Research unlock binds every inventory entry, field, source byte, mode, patch and hunk', value == make_manifest(ring, git, candidate))
    check('Research unlock does not claim historical domain byte identity', prior['historicalDomainByteIdentity'] is False)
    return {'contract': CONTRACT, 'historicalBaselineSha': ring.BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': REFERENCE, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(git, ring.BASELINE, candidate, ring.DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': MANIFEST, 'manifestSha256': digest(raw), 'manifest': value,
            'verificationScope': 'Exact cumulative research unlock copy source adoption only; not native or CI acceptance. All earlier native gates and complete release acceptance remain required.'}


def historical_bytes(path): return git_read('show', REFERENCE+':'+path)


def ring_transition(before):
    return exact_replace(before, fleet.RING_HOOK.encode(), (RING_HOOK+fleet.RING_HOOK).encode())


def ui_transition(before, manifest_sha256):
    expected = before.decode()
    for old, new, count in (
        ('FLEET_ROW_MANIFEST_SHA256', 'RESEARCH_UNLOCK_COPY_MANIFEST_SHA256', 4),
        (FLEET_MANIFEST_SHA256, manifest_sha256, 1),
        (fleet.MANIFEST, MANIFEST, 1),
        ('scripts/test_fleet_row_provenance.py', 'scripts/test_research_unlock_copy_provenance.py', 1),
        (fleet.CONTRACT, CONTRACT, 1), (fleet.REFERENCE, REFERENCE, 1),
        ('complete original-to-fleet-row cumulative source seal', 'complete original-to-research-unlock-copy cumulative source seal', 1),
        ('twelve earlier seals', 'thirteen earlier seals', 1),
        ('unchanged public-7ab cumulative UI deltas with exact fleet-row adoption', 'unchanged public-493 cumulative UI deltas with exact research unlock copy adoption', 1),
        ('舰队行 UI', '研究解锁文案 UI', 4),
    ):
        assert expected.count(old) == count, ('Exact research UI checker transition cardinality', old)
        expected = expected.replace(old, new)
    return expected.encode()


def formation_transition(before):
    return exact_replace(before, FORMATION_ANCHOR.encode(), (FORMATION_ADAPTER+FORMATION_ANCHOR).encode())


def fleet_transition(before):
    old = "    assert ordinary_bytes(repository/path) == transitions[path](before), ('Unapproved fleet compatibility adapter drift', path)\n"
    new = ("    current = ordinary_bytes(repository/path)\n"
           "    if current != transitions[path](before):\n"
           "        from test_research_unlock_copy_provenance import previous_bytes as research_previous_bytes\n"
           "        current = research_previous_bytes(path, repository)\n"
           "    assert current == transitions[path](before), ('Unapproved fleet compatibility adapter drift', path)\n")
    before = exact_replace(before, old.encode(), new.encode())
    old = "    assert candidate != REFERENCE, 'Fleet candidate must be committed separately from its public baseline'\n"
    new = ("    if git_read('ls-tree', candidate, '--', 'tests/fixtures/research-unlock-copy-provenance.json'):\n"
           "        from test_research_unlock_copy_provenance import verify_candidate as verify_research_candidate\n"
           "        result = verify_research_candidate(candidate)\n"
           "        assert result['contract'] == 'exact-declared-research-unlock-copy-source-delta'\n"
           "        return result['previousProvenance']\n"+old)
    return exact_replace(before, old.encode(), new.encode())


def previous_bytes(path, repository=None):
    repository = ROOT if repository is None else repository
    assert path in ADAPTER_PATHS, ('Unsupported research compatibility projection', path)
    read_manifest(repository)
    before = historical_bytes(path)
    transitions = {ADAPTER_PATHS[0]: ring_transition,
                   ADAPTER_PATHS[1]: lambda raw: ui_transition(raw, MANIFEST_SHA256),
                   ADAPTER_PATHS[2]: fleet_transition, ADAPTER_PATHS[3]: formation_transition}
    current = ordinary_bytes(repository/path)
    if current != transitions[path](before):
        from test_building_batch_provenance import previous_bytes as batch_previous_bytes
        current = batch_previous_bytes(path, repository)
    assert current == transitions[path](before), ('Unapproved research compatibility adapter drift', path)
    return before


def previous_ring_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[0], repository)
def previous_ui_baseline_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[1], repository)
def previous_fleet_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[2], repository)
def previous_formation_bytes(repository=None): return previous_bytes(ADAPTER_PATHS[3], repository)


def verify_unchanged_checker_bytes(repository):
    for path in UNCHANGED_CHECKER_PATHS:
        assert ordinary_bytes(repository/path) == historical_bytes(path), (
            'Prior checker must remain byte-identical to public 493', path)


def capture_worktree(db):
    expected = source_inventory(db.git, REFERENCE)
    expected[CHANGED_PATHS[0]] = {'mode': '100644', 'sha256': digest(expected_present(db.git))}
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
    if (ROOT/'tests/fixtures/building-batch-provenance.json').exists():
        from test_building_batch_provenance import verify_previous_ui_baseline
        return verify_previous_ui_baseline()
    db = ObjectDatabase()
    try:
        candidate, expected = capture_worktree(db)
        raw, _ = read_manifest(ROOT)
        assert raw == expected, 'Current production does not match frozen research unlock seal'
        for path in ADAPTER_PATHS: previous_bytes(path)
        verify_unchanged_checker_bytes(ROOT)
        candidate = db.make(candidate, {MANIFEST: ('100644', raw)})
        checks = []
        def check(name, passed, detail=None):
            assert passed, name
            checks.append(name)
        result = research_unlock_copy_provenance(ROOT, candidate, db.git, check)
        return {'contract': result['contract'], 'sourceScope': 'Exact current src/public inventory, bytes and modes; disposable objects only',
                'sourceBaseline': REFERENCE, 'manifestSha256': digest(raw), 'checks': len(checks),
                'originalUiBaseline': result['manifest']['originalUiBaseline'], 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}
    finally: db.close()


def verify_candidate(candidate):
    candidate = git_read('rev-parse', candidate+'^{commit}').decode().strip()
    if git_read('ls-tree', candidate, '--', 'tests/fixtures/building-batch-provenance.json'):
        from test_building_batch_provenance import verify_candidate as verify_batch_candidate
        result = verify_batch_candidate(candidate)
        assert result['contract'] == 'exact-declared-building-batch-source-delta'
        return result['previousProvenance']
    assert candidate != REFERENCE, 'Research unlock candidate must be committed separately from its public baseline'
    for path in (*ADAPTER_PATHS, *UNCHANGED_CHECKER_PATHS, 'scripts/test_research_unlock_copy_provenance.py', MANIFEST):
        assert ordinary_bytes(ROOT/path) == git_read('show', candidate+':'+path), ('Executed seal differs from committed candidate', path)
    for path in ADAPTER_PATHS: previous_bytes(path)
    verify_unchanged_checker_bytes(ROOT)
    assert_worktree_inventory(ROOT, source_inventory(git_read, candidate))
    checks = []
    def check(name, passed, detail=None):
        assert passed, name
        checks.append(name)
    result = research_unlock_copy_provenance(ROOT, candidate, git_read, check)
    assert len(checks) > 145, 'Complete prior source-provenance chain required'
    return result


class ResearchUnlockCopySyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db = ObjectDatabase()
    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        self.ring, self.git, self.make = module(), self.db.git, self.db.make
        self.view = self.db.tmp/'research-unlock-view'
        for path, _ in previous_manifests(self.ring):
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            if local.is_symlink(): local.unlink()
            local.write_bytes(self.git('show', REFERENCE+':'+path)); local.chmod(0o644)
        self.source = expected_present(self.git)
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
        with patch(__name__+'.MANIFEST_SHA256', digest(raw)), patch('test_research_unlock_copy_provenance.MANIFEST_SHA256', digest(raw)):
            self.reject(candidate)
        (self.view/MANIFEST).write_bytes(self.raw)

    def test_exact_reviewed_delta_recursively_retains_all_thirteen_seals(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], CONTRACT)
        self.assertEqual(result['previousProvenance']['contract'], fleet.CONTRACT)
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertEqual(len(result['manifest']['previousManifests']), 13)
        self.assertIs(result['historicalDomainByteIdentity'], False)
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertEqual(result['manifest']['originalUiBaseline'], result['previousProvenance']['manifest']['originalUiBaseline'])

    def test_research_file_bytes_modes_symlink_delete_and_reversion_fail(self):
        for value in [('100644', self.source+b' '), ('100755', self.source), ('120000', b'other.ts'), None,
                      ('100644', self.git('show', REFERENCE+':'+CHANGED_PATHS[0]))]:
            with self.subTest(value=value): self.reject(self.make(self.candidate, {CHANGED_PATHS[0]: value}))

    def test_full_source_scope_rejects_unrelated_additions_and_changes(self):
        for path in ('src/unknown.ts', 'src/ui/unknown.ts', 'src/game/unknown.ts', 'src/core/unknown.ts',
                     'src/data/unknown.ts', 'src/automation/unknown.ts', 'public/unknown.svg'):
            with self.subTest(path=path): self.reject(self.make(self.candidate, {path: ('100644', b'extra')}))
        for path in ('src/main.ts', 'src/style.css', 'src/space.css', 'src/ui/view.ts', 'src/game/save.ts',
                     'src/game/content.ts', 'src/core/offline.ts', 'src/data/units.ts',
                     'src/ui/recycle-preview-panel.ts', 'src/ui/space-panel.ts',
                     'src/ui/ring-model.ts', 'src/game/arcade.ts', 'src/automation/engine.ts',
                     'src/data/ring-art.json', 'public/icons/ring_machine.webp', 'public/favicon-32.png'):
            raw = self.git('show', REFERENCE+':'+path)
            for value in [('100644', raw+b' '), ('100755', raw), ('120000', b'other.ts'), None]:
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
            lambda m: m.update(previousAdoptionSourceSha=fleet.REFERENCE),
            lambda m: m['productionPaths'].append('scripts'), lambda m: m['exactDomainDeltaPaths'].append('src/game/save.ts'),
            lambda m: m['previousManifests'].pop(), lambda m: m['productionInventory'].pop('src/main.ts'),
            lambda m: m['productionInventory']['src/main.ts'].update(sha256='0'*64),
            lambda m: m['originalUiBaseline']['changedPaths'][0]['before'].update(sha256='0'*64)]
        for field in ('before', 'after', 'patchSha256', 'hunks'):
            mutations.append(lambda m, field=field: m['changedPaths'][0].update({field: None}))
        for mutate in mutations:
            value = copy.deepcopy(self.manifest); mutate(value); self.reject_repinned(value)

    def test_all_thirteen_older_seals_reject_local_and_committed_drift(self):
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
        local.unlink(); target = self.db.tmp/'research-unlock-manifest-target'; target.write_bytes(self.raw)
        local.symlink_to(target); self.reject(); local.unlink(); local.write_bytes(self.raw)

    def test_unrelated_ancestry_cannot_adopt_identical_source(self):
        tree = self.git('rev-parse', self.candidate+'^{tree}').decode().strip()
        self.reject(self.git('commit-tree', tree, input=b'Unrelated source\n').decode().strip())

    def test_old_public_source_keeps_its_own_fleet_contract(self):
        self.assertEqual(self.evaluate(REFERENCE)['contract'], fleet.CONTRACT)

    def test_exact_checker_and_prior_contract_transitions(self):
        verify_unchanged_checker_bytes(ROOT)
        for path in ADAPTER_PATHS:
            self.assertEqual(previous_bytes(path), historical_bytes(path))

    def test_historical_493_fleet_and_immutable_prototype_remain_independent(self):
        def check(name, passed, detail=None): self.assertTrue(passed, name)
        prior = fleet.fleet_row_provenance(self.view, REFERENCE, self.git, check)
        self.assertEqual(prior['contract'], fleet.CONTRACT)
        self.assertEqual(prior['candidateSourceSha'], REFERENCE)
        self.assertEqual(source_inventory(self.git, REFERENCE), source_inventory(self.git, fleet.PROTOTYPE))
        self.assertEqual(fleet.make_manifest(self.ring, self.git, REFERENCE),
                         fleet.make_manifest(self.ring, self.git, fleet.PROTOTYPE))
        self.assertEqual(fleet.digest(fleet.manifest_bytes(prior['manifest'])), FLEET_MANIFEST_SHA256)

    def test_each_patch_hunk_and_inventory_field_is_fixed_even_after_repinning(self):
        mutations = [
            lambda m: m['previousManifests'].reverse(),
            lambda m: m['previousManifests'][0].update(sha256='0'*64),
            lambda m: m['productionInventory']['src/main.ts'].update(mode='100755'),
            lambda m: m['productionInventory'].update({'public/extra.svg': {'mode': '100644', 'sha256': '0'*64}}),
            lambda m: m['changedPaths'].append(copy.deepcopy(m['changedPaths'][0])),
            lambda m: m['changedPaths'][0].update(path='src/ui/space-panel.ts'),
            lambda m: m['changedPaths'][0]['before'].update(sha256='0'*64),
            lambda m: m['changedPaths'][0]['before'].update(mode='100755'),
            lambda m: m['changedPaths'][0]['after'].update(sha256='0'*64),
            lambda m: m['changedPaths'][0]['after'].update(mode='100755'),
            lambda m: m['changedPaths'][0].update(patchSha256='0'*64),
            lambda m: m['changedPaths'][0]['hunks'].pop(),
            lambda m: m['changedPaths'][0]['hunks'].reverse(),
            lambda m: m['changedPaths'][0]['hunks'].append(copy.deepcopy(m['changedPaths'][0]['hunks'][0])),
            lambda m: m['changedPaths'][0]['hunks'][0].update(header='@@ wrong @@'),
            lambda m: m['changedPaths'][0]['hunks'][0].update(sha256='0'*64),
        ]
        self.assertEqual(len(self.manifest['changedPaths'][0]['hunks']), 2)
        for index, mutate in enumerate(mutations):
            value = copy.deepcopy(self.manifest); mutate(value)
            with self.subTest(index=index): self.reject_repinned(value)

    def test_all_prior_local_manifests_reject_missing_and_symlinked_files(self):
        for path, _ in previous_manifests(self.ring):
            local = self.view/path; raw = local.read_bytes()
            local.unlink(); self.reject()
            target = self.db.tmp/'prior-seal-target'; target.write_bytes(raw)
            local.symlink_to(target); self.reject()
            local.unlink(); local.write_bytes(raw)

    def test_projection_refuses_changed_manifest_or_any_adapter_byte(self):
        transitions = (ring_transition, lambda raw: ui_transition(raw, MANIFEST_SHA256), fleet_transition, formation_transition)
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

    def test_prior_checkers_cannot_drift_behind_successor_projection(self):
        for path in UNCHANGED_CHECKER_PATHS:
            local = self.view/path; local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(historical_bytes(path)); local.chmod(0o644)
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


class ResearchUnlockCopyCommittedCandidateTests(unittest.TestCase):
    def test_actual_committed_candidate_matches_complete_frozen_source(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'], CONTRACT)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--build-manifest': build_worktree_manifest(sys.argv[2])
    elif sys.argv[1:] == ['--verify-ui-baseline']: print(json.dumps(verify_ui_baseline(), ensure_ascii=False, indent=2))
    else:
        if len(sys.argv) >= 3 and sys.argv[1] == '--verify-candidate':
            CANDIDATE = sys.argv[2]; del sys.argv[1:3]
        unittest.main()
