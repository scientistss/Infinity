"""Python/Git-only exact laboratory-blockers source adoption tests.

All synthetic commits and index writes use a temporary object database. The real
repository is read-only except when the explicit --build-manifest command writes
its named output file. No browser, Node process, refs or production files change.
The final test verifies a committed candidate (HEAD by default), not a synthetic
replacement for the candidate. This is source provenance, never native or CI
acceptance. Before the candidate is committed, run LabBlockersSyntheticTests.
"""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts/browser-ring-protection.py'
REFERENCE = 'c80a6728fe9e1769ca4e67fe794b8f0eedfb8627'
CANDIDATE = 'HEAD'


def module():
    spec = importlib.util.spec_from_file_location('lab_blockers_source_contract', SCRIPT)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def digest(value):
    return hashlib.sha256(value).hexdigest()


def previous_manifests(ring):
    return [(ring.DOMAIN_MANIFEST, ring.DOMAIN_MANIFEST_SHA256),
            (ring.IRN_MANIFEST, ring.IRN_MANIFEST_SHA256),
            (ring.DEMOLITION_MANIFEST, ring.DEMOLITION_MANIFEST_SHA256),
            (ring.NPC_MANIFEST, ring.NPC_MANIFEST_SHA256),
            (ring.ATTACK_MANIFEST, ring.ATTACK_MANIFEST_SHA256),
            (ring.NPC_REPORT_UI_MANIFEST, ring.NPC_REPORT_UI_MANIFEST_SHA256),
            (ring.NPC_SCOUT_REHEARSAL_MANIFEST, ring.NPC_SCOUT_REHEARSAL_MANIFEST_SHA256),
            (ring.NPC_SCOUT_COMPARISON_MANIFEST, ring.NPC_SCOUT_COMPARISON_MANIFEST_SHA256),
            (ring.NPC_REHEARSAL_FORMATION_COPY_MANIFEST, ring.NPC_REHEARSAL_FORMATION_COPY_MANIFEST_SHA256)]


def manifest_bytes(manifest):
    return (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


class ObjectDatabase:
    """Write throwaway Git objects while only reading named historical objects."""
    def __init__(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='lab-blockers-source-')
        self.tmp = Path(self.temporary.name)
        self.db = self.tmp / 'objects.git'
        subprocess.run(['git', 'init', '--bare', '--quiet', str(self.db)], check=True)
        objects = subprocess.check_output(
            ['git', 'rev-parse', '--path-format=absolute', '--git-path', 'objects'], cwd=ROOT).decode().strip()
        self.env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
        self.env.update(GIT_DIR=str(self.db), GIT_INDEX_FILE=str(self.tmp / 'index'),
                        GIT_ALTERNATE_OBJECT_DIRECTORIES=objects,
                        GIT_AUTHOR_NAME='Offline source contract', GIT_AUTHOR_EMAIL='offline@example.invalid',
                        GIT_COMMITTER_NAME='Offline source contract', GIT_COMMITTER_EMAIL='offline@example.invalid')
        self.immutable_reads = {}

    def close(self):
        self.temporary.cleanup()

    def git(self, *args, input=None):
        # These tests address read operations only by full immutable object IDs.
        # Cache repeated historical reads; never cache mutable index operations.
        immutable = input is None and args[0] in ('ls-tree', 'show', 'cat-file', 'diff')
        if immutable and args in self.immutable_reads:
            return self.immutable_reads[args]
        result = subprocess.check_output(['git', *args], cwd=ROOT, env=self.env, input=input,
                                         stderr=subprocess.PIPE)
        if immutable:
            self.immutable_reads[args] = result
        return result

    def make(self, base, changes):
        self.git('read-tree', base)
        for path, change in changes.items():
            if change is None:
                self.git('update-index', '--index-info', input=('0 ' + '0' * 40 + '\t' + path + '\n').encode())
            else:
                mode, content = change
                oid = self.git('hash-object', '-w', '--stdin', input=content).decode().strip()
                self.git('update-index', '--add', '--cacheinfo', mode, oid, path)
        tree = self.git('write-tree').decode().strip()
        return self.git('commit-tree', tree, '-p', base,
                        input=b'Offline laboratory-blockers source contract only\n').decode().strip()

    def entry(self, ref, path):
        row = self.git('ls-tree', ref, '--', path)
        if not row:
            return None
        mode, kind, oid = row.decode().split('\t')[0].split()
        if kind != 'blob':
            raise AssertionError('Source record must be an ordinary file: ' + path)
        return {'mode': mode, 'sha256': digest(self.git('cat-file', 'blob', oid))}


def make_manifest(ring, db, candidate):
    delta = db.git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                   REFERENCE, candidate, '--', *ring.LAB_BLOCKERS_PRODUCTION_PATHS).decode().splitlines()
    if delta != list(ring.LAB_BLOCKERS_CHANGED_PATHS):
        raise AssertionError('Only the exact six laboratory-blockers source paths may be sealed: ' + repr(delta))
    rows = []
    for path in delta:
        patch = ring.source_delta_patch(db.git, REFERENCE, candidate, path)
        rows.append({'path': path, 'before': db.entry(REFERENCE, path), 'after': db.entry(candidate, path),
                     'patchSha256': digest(patch), 'hunks': ring.source_delta_hunks(patch)})
    return {
        'schema': 'infinity-ring-protection-lab-blockers-provenance-v1',
        'historicalBaselineSha': ring.BASELINE,
        'previousAdoptionSourceSha': REFERENCE,
        'previousManifests': [{'path': path, 'sha256': value} for path, value in previous_manifests(ring)],
        'referenceStatus': 'Exact read-only laboratory UI adoption atop the recursively verified c80 formation-copy source. c80 CI was not all green; source provenance does not claim native, CI or release acceptance.',
        'scope': 'All production src/public paths, file modes, before/after bytes, complete deterministic Git patches and individual hunks are bound. All nine historical manifests, full domain and ring-critical scopes, original public art, report and comparison UI remain unchanged.',
        'approvedDelta': 'Read-only laboratory blockers model and panel with exact lab view/presentation, local-source space wiring and scoped style additions. No domain, persistence schema, combat, economy, wallet, dispatch, ring or art changes.',
        'productionPaths': list(ring.LAB_BLOCKERS_PRODUCTION_PATHS),
        'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': [],
        'exactRingCriticalDeltaPaths': [],
        'unchangedPresentationPaths': list(ring.LAB_BLOCKERS_UNCHANGED_PATHS),
        'originalUiBaseline': {'baseline': '69eca71', 'expected': ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES,
            'exactDeltaPaths': list(ring.LAB_BLOCKERS_BASELINE_DELTAS),
            'changedPaths': [row for row in rows if row['path'] in ring.LAB_BLOCKERS_BASELINE_DELTAS]},
        'changedPaths': rows,
    }


def build_worktree_manifest(destination):
    """Explicit freeze helper; never updates its own approved digest or real index."""
    ring, db = module(), ObjectDatabase()
    try:
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=ROOT)
        tracked = git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                      REFERENCE, '--', *ring.LAB_BLOCKERS_PRODUCTION_PATHS).decode().splitlines()
        untracked = git('ls-files', '--others', '--exclude-standard', '--', *ring.LAB_BLOCKERS_PRODUCTION_PATHS).decode().splitlines()
        if sorted(set(tracked + untracked)) != list(ring.LAB_BLOCKERS_CHANGED_PATHS):
            raise AssertionError('Worktree must contain only the exact six approved source deltas')
        if git('diff', '--name-only', '--no-renames', REFERENCE, '--',
               *ring.DOMAIN_PATHS, *ring.RING_CRITICAL_PATHS, *ring.LAB_BLOCKERS_UNCHANGED_PATHS):
            raise AssertionError('Protected domain, ring, art, report or comparison worktree changed')
        if git('ls-files', '--others', '--exclude-standard', '--', *ring.LAB_BLOCKERS_UNCHANGED_PATHS):
            raise AssertionError('Protected presentation worktree has additional paths')
        if git('diff', '--name-only', '--no-renames', REFERENCE, '--',
               *(path for path, _ in previous_manifests(ring))):
            raise AssertionError('Historical manifest worktree bytes or modes changed')
        for path, expected in previous_manifests(ring):
            raw = (ROOT / path).read_bytes()
            if digest(raw) != expected or raw != db.git('show', REFERENCE + ':' + path):
                raise AssertionError('Historical manifest changed: ' + path)
        edits = {}
        for path in ring.LAB_BLOCKERS_CHANGED_PATHS:
            local = ROOT / path
            if local.is_symlink() or not local.is_file():
                raise AssertionError('Laboratory-blockers source must be an ordinary file: ' + path)
            edits[path] = ('100755' if local.stat().st_mode & stat.S_IXUSR else '100644', local.read_bytes())
        candidate = db.make(REFERENCE, edits)
        raw = manifest_bytes(make_manifest(ring, db, candidate))
        Path(destination).write_bytes(raw)
        print(json.dumps({'manifest': str(destination), 'sha256': digest(raw),
                          'sourcePaths': list(ring.LAB_BLOCKERS_CHANGED_PATHS)}, indent=2))
    finally:
        db.close()


class LabBlockersSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = ObjectDatabase()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        self.ring = module()
        self.git, self.make, self.entry = self.db.git, self.db.make, self.db.entry
        self.view = self.db.tmp / 'view'
        self.previous = previous_manifests(self.ring)
        for path, _ in self.previous:
            local = self.view / path
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(self.git('show', REFERENCE + ':' + path))
        self.approved = {
            path: ('100644', (self.git('show', REFERENCE + ':' + path) if self.entry(REFERENCE, path) else b'')
                   + b'\n/* exact synthetic laboratory-blockers UI adoption */\n')
            for path in self.ring.LAB_BLOCKERS_CHANGED_PATHS}
        provisional = self.make(REFERENCE, self.approved)
        self.manifest = make_manifest(self.ring, self.db, provisional)
        self.raw = manifest_bytes(self.manifest)
        self.manifest_path = self.ring.LAB_BLOCKERS_MANIFEST
        self.ring.LAB_BLOCKERS_MANIFEST_SHA256 = digest(self.raw)
        (self.view / self.manifest_path).write_bytes(self.raw)
        self.candidate = self.make(provisional, {self.manifest_path: ('100644', self.raw)})

    def evaluate(self, candidate=None, ring=None):
        checks = []
        def check(name, passed, detail=None):
            checks.append((name, bool(passed)))
            if not passed:
                raise AssertionError(name)
        result = (ring or self.ring).synchronized_domain_provenance(
            self.view, candidate or self.candidate, self.git, check)
        self.assertTrue(checks)
        self.assertTrue(all(passed for _, passed in checks))
        return result

    def reject(self, candidate=None, ring=None):
        with self.assertRaises((AssertionError, FileNotFoundError, subprocess.CalledProcessError)):
            self.evaluate(candidate, ring)

    def repin_manifest(self, value, candidate=None):
        raw = manifest_bytes(value)
        self.ring.LAB_BLOCKERS_MANIFEST_SHA256 = digest(raw)
        (self.view / self.manifest_path).write_bytes(raw)
        return self.make(candidate or self.candidate, {self.manifest_path: ('100644', raw)})

    def test_exact_lab_delta_revalidates_real_c80_and_every_prior_contract(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], 'exact-declared-lab-blockers-ui-delta')
        self.assertEqual(result['candidateSourceSha'], self.candidate)
        self.assertEqual(result['previousAdoptionSourceSha'], REFERENCE)
        prior = result['previousProvenance']
        self.assertEqual(prior['contract'], 'exact-declared-npc-rehearsal-formation-copy-ui-delta')
        self.assertEqual(prior['candidateSourceSha'], REFERENCE)
        self.assertEqual(prior['previousProvenance']['candidateSourceSha'], self.ring.NPC_REHEARSAL_FORMATION_COPY_ADOPTION)
        self.assertFalse(result['historicalDomainByteIdentity'])
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertEqual(self.evaluate(REFERENCE)['contract'], 'exact-declared-npc-rehearsal-formation-copy-ui-delta')
        self.reject(ring=module())
        self.ring.NPC_SCOUT_REHEARSAL_MANIFEST_SHA256 = '0' * 64
        self.reject()

    def test_original_source_branches_keep_their_own_contracts(self):
        for ref, expected in (
            (self.ring.BASELINE, 'historical-domain-byte-identity'),
            (self.ring.DEMOLITION_ADOPTION, 'exact-declared-irn-semantic-delta'),
            (self.ring.NPC_ADOPTION, 'exact-declared-demolition-semantic-delta'),
            (self.ring.ATTACK_ADOPTION, 'exact-declared-npc-semantic-delta'),
            (self.ring.NPC_REPORT_UI_ADOPTION, 'exact-declared-npc-attack-semantic-delta'),
            (self.ring.NPC_SCOUT_REHEARSAL_ADOPTION, 'exact-declared-npc-report-ui-delta'),
            (self.ring.NPC_SCOUT_COMPARISON_ADOPTION, 'exact-declared-npc-scout-rehearsal-semantic-delta'),
            (self.ring.NPC_REHEARSAL_FORMATION_COPY_ADOPTION, 'exact-declared-npc-scout-comparison-ui-delta'),
            (REFERENCE, 'exact-declared-npc-rehearsal-formation-copy-ui-delta'),
        ):
            with self.subTest(ref=ref):
                self.assertEqual(self.evaluate(ref)['contract'], expected)

    def test_approved_file_bytes_modes_deletions_and_reversions_are_exact(self):
        for path, (mode, content) in self.approved.items():
            options = [None, (mode, content + b'\n'), ('100755', content), ('120000', content)]
            if self.entry(REFERENCE, path):
                options.append(('100644', self.git('show', REFERENCE + ':' + path)))
            for option in options:
                with self.subTest(path=path, mode=option and option[0]):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_complete_src_and_public_scopes_reject_unknown_paths_everywhere(self):
        for directory in ('src', 'src/game', 'src/core', 'src/data', 'src/automation', 'src/ui', 'src/new', 'public', 'public/icons', 'public/new'):
            with self.subTest(directory=directory):
                self.reject(self.make(self.candidate, {directory + '/unapproved.ts': ('100644', b'// extra\n')}))

    def test_domain_ring_art_report_and_existing_comparison_bytes_and_modes_are_protected(self):
        for path in ('src/main.ts', 'src/game/save.ts', 'src/game/types.ts', 'src/game/npc-scout.ts',
                     'src/game/npc-rehearsal.ts', 'src/game/encounter-combat.ts', 'src/game/npc-battle.ts',
                     'src/game/npc-economy.ts', 'src/game/npc-wallet.ts', 'src/core/offline.ts',
                     'src/automation/engine.ts', 'src/data/ring-art.json', 'src/ui/ring-model.ts',
                     'src/ui/npc-battle-panel.ts', 'src/ui/npc-battle-present.ts',
                     'src/ui/npc-scout-comparison-model.ts', 'src/ui/npc-scout-comparison-panel.ts',
                     'src/ui/npc-scout-comparison.css', 'public/icons/ring_machine.webp'):
            raw = self.git('show', REFERENCE + ':' + path)
            for option in (None, ('100644', raw + b'\n'), ('100755', raw), ('120000', raw)):
                with self.subTest(path=path, mode=option and option[0]):
                    self.reject(self.make(self.candidate, {path: option}))
        self.reject(self.make(self.candidate, {'public/icons/unapproved.svg': ('100644', b'<svg/>\n')}))

    def test_all_nine_prior_manifests_keep_local_and_committed_bytes_and_modes(self):
        self.assertEqual(len(self.previous), 9)
        for path, expected in self.previous:
            original = self.git('show', REFERENCE + ':' + path)
            self.assertEqual(digest(original), expected)
            self.assertEqual((ROOT / path).read_bytes(), original)
            for option in (None, ('100644', original + b'\n'), ('100755', original), ('120000', original)):
                with self.subTest(path=path, mode=option and option[0]):
                    self.reject(self.make(self.candidate, {path: option}))
            local = self.view / path
            local.write_bytes(original + b'\n')
            self.reject()
            local.unlink()
            self.reject()
            local.write_bytes(original)

    def test_new_manifest_requires_exact_local_and_committed_ordinary_file_bytes(self):
        for option in (None, ('100644', self.raw + b'\n'), ('100755', self.raw), ('120000', self.raw)):
            self.reject(self.make(self.candidate, {self.manifest_path: option}))
        local = self.view / self.manifest_path
        local.write_bytes(self.raw + b'\n')
        self.reject()
        local.unlink()
        self.reject()

    def test_every_approved_path_has_exact_before_after_patch_and_hunk_records(self):
        for index, row in enumerate(self.manifest['changedPaths']):
            mutations = [
                lambda value: value.update(before=None),
                lambda value: value.update(after=None),
                lambda value: value['after'].update(mode='100755'),
                lambda value: value['after'].update(sha256='0' * 64),
                lambda value: value.update(patchSha256='0' * 64),
                lambda value: value.update(hunks=[]),
                lambda value: value['hunks'][0].update(header='@@ wrong @@'),
                lambda value: value['hunks'][0].update(sha256='0' * 64),
            ]
            if row['before'] is None:
                mutations[0] = lambda value: value.update(before={'mode': '100644', 'sha256': '0' * 64})
            else:
                mutations.extend([
                    lambda value: value['before'].update(mode='100755'),
                    lambda value: value['before'].update(sha256='0' * 64),
                ])
            for mutation_index, mutate in enumerate(mutations):
                manifest = copy.deepcopy(self.manifest)
                mutate(manifest['changedPaths'][index])
                with self.subTest(path=row['path'], mutation=mutation_index):
                    self.reject(self.repin_manifest(manifest))

    def test_local_new_and_historical_manifests_are_non_executable_ordinary_files(self):
        for path, _ in [*self.previous, (self.manifest_path, digest(self.raw))]:
            local = self.view / path
            original = local.read_bytes()
            try:
                local.chmod(0o755)
                self.reject()
                local.chmod(0o644)
                target = self.db.tmp / 'manifest-target.json'
                target.write_bytes(original)
                local.unlink()
                local.symlink_to(target)
                self.reject()
            finally:
                if local.is_symlink():
                    local.unlink()
                local.write_bytes(original)
                local.chmod(0o644)

    def test_anchors_scopes_records_full_patches_and_hunks_are_checked_beyond_digest(self):
        mutations = [
            lambda m: m.update(schema='wrong'),
            lambda m: m.update(historicalBaselineSha=self.candidate),
            lambda m: m.update(previousAdoptionSourceSha=self.ring.NPC_SCOUT_REHEARSAL_ADOPTION),
            lambda m: m.update(productionPaths=['src/ui']),
            lambda m: m.update(domainPaths=['src/game']),
            lambda m: m.update(originalRingCriticalPaths=[]),
            lambda m: m.update(exactDomainDeltaPaths=['src/game/save.ts']),
            lambda m: m.update(exactRingCriticalDeltaPaths=['src/ui/ring-model.ts']),
            lambda m: m.update(unchangedPresentationPaths=[]),
            lambda m: m['previousManifests'].pop(),
            lambda m: m['previousManifests'].reverse(),
            lambda m: m['previousManifests'][-1].update(sha256='0' * 64),
            lambda m: m['changedPaths'].pop(),
            lambda m: m['changedPaths'].reverse(),
            lambda m: m['changedPaths'].append(copy.deepcopy(m['changedPaths'][0])),
            lambda m: m['changedPaths'][0].update(path='src/unapproved.ts'),
            lambda m: m['changedPaths'][1].update(before={'mode': '100644', 'sha256': '0' * 64}),
            lambda m: m['changedPaths'][-1]['before'].update(mode='100755'),
            lambda m: m['changedPaths'][-1]['before'].update(sha256='0' * 64),
            lambda m: m['changedPaths'][0]['after'].update(mode='100755'),
            lambda m: m['changedPaths'][0]['after'].update(sha256='0' * 64),
            lambda m: m['changedPaths'][0].pop('after'),
            lambda m: m['changedPaths'][0].update(patchSha256='0' * 64),
            lambda m: m['changedPaths'][0]['hunks'].pop(),
            lambda m: m['changedPaths'][0]['hunks'].append(copy.deepcopy(m['changedPaths'][0]['hunks'][0])),
            lambda m: m['changedPaths'][0]['hunks'][0].update(header='@@ wrong @@'),
            lambda m: m['changedPaths'][0]['hunks'][0].update(sha256='0' * 64),
        ]
        for index, mutate in enumerate(mutations):
            manifest = copy.deepcopy(self.manifest)
            mutate(manifest)
            with self.subTest(index=index):
                self.reject(self.repin_manifest(manifest))

    def test_protected_scopes_stay_fixed_even_beyond_a_synthetic_widened_file_gate(self):
        for path in ('src/game/save.ts', 'src/game/npc-battle.ts', 'src/game/npc-economy.ts',
                     'src/core/offline.ts', 'src/data/ring-art.json', 'src/automation/engine.ts',
                     'src/ui/ring-model.ts', 'src/ui/npc-scout-comparison-model.ts',
                     'src/ui/npc-scout-comparison-panel.ts', 'src/ui/npc-scout-comparison.css',
                     'src/ui/npc-battle-panel.ts', 'src/ui/npc-battle-present.ts',
                     'public/icons/ring_machine.webp'):
            content = self.git('show', REFERENCE + ':' + path) + b'\n// forbidden\n'
            candidate = self.make(self.candidate, {path: ('100644', content)})
            manifest = copy.deepcopy(self.manifest)
            patch = self.ring.source_delta_patch(self.git, REFERENCE, candidate, path)
            manifest['changedPaths'].append({'path': path, 'before': self.entry(REFERENCE, path),
                                            'after': self.entry(candidate, path), 'patchSha256': digest(patch),
                                            'hunks': self.ring.source_delta_hunks(patch)})
            manifest['changedPaths'].sort(key=lambda row: row['path'])
            self.ring.LAB_BLOCKERS_CHANGED_PATHS = tuple(row['path'] for row in manifest['changedPaths'])
            with self.subTest(path=path), self.assertRaisesRegex(AssertionError, 'preserves entire domain'):
                self.evaluate(self.repin_manifest(manifest, candidate))

    def test_wrong_actual_adoption_reference_cannot_use_the_c80_contract(self):
        self.ring.LAB_BLOCKERS_ADOPTION = self.ring.NPC_SCOUT_COMPARISON_ADOPTION
        self.reject()

    def test_adoption_uses_committed_production_bytes_not_mutable_worktree_copies(self):
        local = self.view / 'src/ui/space-panel.ts'
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text('This is not the candidate Git blob.\n')
        self.assertEqual(self.evaluate()['candidateSourceSha'], self.candidate)

    def test_c80_original_functions_constants_and_dispatch_are_preserved(self):
        original = self.git('show', REFERENCE + ':scripts/browser-ring-protection.py').decode()
        from test_manual_unit_provenance import previous_ring_bytes
        current = previous_ring_bytes().decode()
        old_tree, new_tree = ast.parse(original), ast.parse(current)
        keyed = lambda tree: {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        old, new = keyed(old_tree), keyed(new_tree)
        branch = "    if candidate != LAB_BLOCKERS_ADOPTION and git('ls-tree', candidate, '--', LAB_BLOCKERS_MANIFEST):\n        return lab_blockers_provenance(repository, candidate, git, check)\n"
        for name, node in old.items():
            old_text, new_text = ast.get_source_segment(original, node), ast.get_source_segment(current, new[name])
            if name == 'synchronized_domain_provenance':
                self.assertEqual(new_text.count(branch), 1)
                new_text = new_text.replace(branch, '', 1)
            self.assertEqual(new_text, old_text, name)
        constants = lambda tree: {node.targets[0].id: node for node in tree.body
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)}
        for name, node in constants(old_tree).items():
            self.assertEqual(ast.get_source_segment(original, node),
                             ast.get_source_segment(current, constants(new_tree)[name]), name)
        self.assertEqual(module().LAB_BLOCKERS_ADOPTION, REFERENCE)
        self.assertEqual(module().LAB_BLOCKERS_PRODUCTION_PATHS, ('src', 'public'))

    def test_exact_c80_ancestry_is_required_even_for_identical_source_tree(self):
        tree = self.git('rev-parse', self.candidate + '^{tree}').decode().strip()
        unrelated = self.git('commit-tree', tree, input=b'Unrelated source tree\n').decode().strip()
        self.reject(unrelated)

    def test_original_ui_baseline_records_cannot_be_deleted_widened_or_changed(self):
        mutations = [
            lambda m: m.pop('originalUiBaseline'),
            lambda m: m['originalUiBaseline'].update(baseline='c80'),
            lambda m: m['originalUiBaseline'].update(expected={}),
            lambda m: m['originalUiBaseline']['expected'].update({'src/ui/view.ts': '0' * 64}),
            lambda m: m['originalUiBaseline'].update(exactDeltaPaths=['src/ui']),
            lambda m: m['originalUiBaseline']['changedPaths'].pop(),
            lambda m: m['originalUiBaseline']['changedPaths'][0].update(hunks=[]),
            lambda m: m['originalUiBaseline']['changedPaths'][0].update(patchSha256='0' * 64),
        ]
        for mutate in mutations:
            manifest = copy.deepcopy(self.manifest)
            mutate(manifest)
            self.reject(self.repin_manifest(manifest))

    def test_original_ui_baseline_expected_hashes_stay_byte_identical(self):
        original = self.git('show', REFERENCE + ':scripts/check-ui-baseline.mjs').decode()
        from test_manual_unit_provenance import previous_ui_baseline_bytes
        current = previous_ui_baseline_bytes().decode()
        extract = lambda source: source.split('const expected = {', 1)[1].split('};', 1)[0]
        self.assertEqual(extract(current), extract(original))
        self.assertIn('verify-ui-baseline', current)
        self.assertIn('LAB_BLOCKERS_MANIFEST_SHA256', current)



class LabBlockersCommittedCandidateTests(unittest.TestCase):
    def test_current_committed_candidate_matches_its_exact_source_seal(self):
        ring = module()
        def git(*args):
            return subprocess.check_output(['git', *args], cwd=ROOT, stderr=subprocess.PIPE)
        candidate = git('rev-parse', CANDIDATE + '^{commit}').decode().strip()
        actual_candidate = candidate
        executed_ring_bytes = SCRIPT.read_bytes()
        if git('ls-tree', candidate, '--', 'tests/fixtures/manual-unit-provenance.json'):
            from test_manual_unit_provenance import verify_candidate, previous_ring_bytes, REFERENCE as manual_base
            verify_candidate(candidate)
            candidate = manual_base
            executed_ring_bytes = previous_ring_bytes()
        self.assertNotEqual(candidate, REFERENCE, 'Laboratory-blockers candidate must be committed before final verification')
        self.assertEqual(git('merge-base', REFERENCE, candidate).decode().strip(), REFERENCE,
                         'The real committed candidate must integrate exact c80 ancestry')
        self.assertEqual(executed_ring_bytes, git('show', candidate + ':scripts/browser-ring-protection.py'),
                         'The executed source gate must be the committed candidate gate')
        self.assertRegex(ring.LAB_BLOCKERS_MANIFEST_SHA256, r'^[0-9a-f]{64}$')
        self.assertNotEqual(ring.LAB_BLOCKERS_MANIFEST_SHA256, '0' * 64)
        manifest_path = ROOT / ring.LAB_BLOCKERS_MANIFEST
        self.assertFalse(manifest_path.is_symlink())
        self.assertEqual(digest(manifest_path.read_bytes()), ring.LAB_BLOCKERS_MANIFEST_SHA256)
        checks = []
        def check(name, passed, detail=None):
            checks.append(name)
            self.assertTrue(passed, name)
        result = ring.synchronized_domain_provenance(ROOT, candidate, git, check)
        self.assertEqual(result['contract'], 'exact-declared-lab-blockers-ui-delta')
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertGreater(len(checks), 80)
        # No mutable source or manifest may quietly differ from the commit being certified.
        paths = ['src', 'public', ring.LAB_BLOCKERS_MANIFEST,
                 *(path for path, _ in previous_manifests(ring))]
        self.assertEqual(git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
                             actual_candidate, '--', *paths), b'')
        self.assertEqual(git('ls-files', '--others', '--exclude-standard', '--', 'src', 'public'), b'')


def verify_ui_baseline():
    """Audit all current production bytes via disposable Git objects; not committed acceptance."""
    ring, db = module(), ObjectDatabase()
    try:
        temporary_manifest = db.tmp / 'worktree-manifest.json'
        # Capture every source delta and reject all extra tracked/untracked drift.
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            build_worktree_manifest(temporary_manifest)
        raw = (ROOT / ring.LAB_BLOCKERS_MANIFEST).read_bytes()
        if raw != temporary_manifest.read_bytes() or digest(raw) != ring.LAB_BLOCKERS_MANIFEST_SHA256:
            raise AssertionError('Current production bytes do not match the frozen lab source seal')
        edits = {path: ('100755' if (ROOT / path).stat().st_mode & stat.S_IXUSR else '100644',
                        (ROOT / path).read_bytes()) for path in ring.LAB_BLOCKERS_CHANGED_PATHS}
        edits[ring.LAB_BLOCKERS_MANIFEST] = ('100644', raw)
        candidate = db.make(REFERENCE, edits)
        checks = []
        def check(name, passed, detail=None):
            if not passed:
                raise AssertionError(name)
            checks.append(name)
        result = ring.synchronized_domain_provenance(ROOT, candidate, db.git, check)
        return {'contract': result['contract'], 'sourceScope': 'exact current src/public bytes; temporary objects only',
                'sourceBaseline': REFERENCE, 'manifestSha256': digest(raw), 'checks': len(checks),
                'originalUiBaseline': result['manifest']['originalUiBaseline'],
                'approvedSourceDeltaPaths': list(ring.LAB_BLOCKERS_CHANGED_PATHS)}
    finally:
        db.close()


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--build-manifest':
        build_worktree_manifest(sys.argv[2])
    elif sys.argv[1:] == ['--verify-ui-baseline']:
        print(json.dumps(verify_ui_baseline(), ensure_ascii=False, indent=2))
    else:
        if len(sys.argv) >= 3 and sys.argv[1] == '--verify-candidate':
            CANDIDATE = sys.argv[2]
            del sys.argv[1:3]
        unittest.main()
