"""Python/Git-only source-contract tests, never native or CI acceptance.

Git mutations live in a temporary object database with read-only access to the
real historical commits. No repository refs, index, production files or browser
are modified. Synthetic approved bytes exercise the checker independently of
the eventual production pin; the final test separately checks that real pin.
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
import tempfile
import unittest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / 'scripts/browser-ring-protection.py'
REFERENCE = 'ac3cce98403bea1e7162bcb4092e4cfeeb448a9a'


def module():
    spec = importlib.util.spec_from_file_location('ring_source_contract', SCRIPT)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def digest(value):
    return hashlib.sha256(value).hexdigest()


class DemolitionSourceContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='demolition-source-contract-')
        cls.tmp = Path(cls.temporary.name)
        cls.db = cls.tmp / 'objects.git'
        subprocess.run(['git', 'init', '--bare', '--quiet', str(cls.db)], check=True)
        objects = subprocess.check_output(['git', 'rev-parse', '--git-path', 'objects'], cwd=ROOT).decode().strip()
        cls.env = dict(os.environ, GIT_DIR=str(cls.db), GIT_INDEX_FILE=str(cls.tmp / 'index'),
                       GIT_ALTERNATE_OBJECT_DIRECTORIES=str((ROOT / objects).resolve()),
                       GIT_AUTHOR_NAME='Offline source contract', GIT_AUTHOR_EMAIL='offline@example.invalid',
                       GIT_COMMITTER_NAME='Offline source contract', GIT_COMMITTER_EMAIL='offline@example.invalid')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    @classmethod
    def git(cls, *args, input=None):
        return subprocess.check_output(['git', *args], cwd=ROOT, env=cls.env, input=input, stderr=subprocess.PIPE)

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
        return self.git('commit-tree', tree, '-p', base, input=b'Offline source contract only\n').decode().strip()

    def entry(self, ref, path):
        row = self.git('ls-tree', ref, '--', path)
        if not row:
            return None
        mode, kind, oid = row.decode().split('\t')[0].split()
        self.assertEqual(kind, 'blob')
        return {'mode': mode, 'sha256': digest(self.git('cat-file', 'blob', oid))}

    def setUp(self):
        self.ring = module()
        self.view = self.tmp / 'view'
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST):
            local = self.view / path
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(self.git('show', REFERENCE + ':' + path))
        self.approved = {
            'src/automation/engine.ts': ('100644', self.git('show', REFERENCE + ':src/automation/engine.ts') + b'\n// offline exact approval A\n'),
            'src/core/offline.ts': ('100644', self.git('show', REFERENCE + ':src/core/offline.ts') + b'\n// offline exact approval B\n'),
            'src/game/offline-source-contract.ts': ('100644', b'export const offlineContractOnly = true;\n'),
        }
        self.ring.DEMOLITION_CHANGED_PATHS = tuple(sorted(self.approved))
        provisional = self.make(REFERENCE, self.approved)
        rows = []
        for path in sorted(self.approved):
            patch = self.ring.source_delta_patch(self.git, REFERENCE, provisional, path)
            rows.append({'path': path, 'before': self.entry(REFERENCE, path), 'after': self.entry(provisional, path),
                         'patchSha256': digest(patch), 'hunks': self.ring.source_delta_hunks(patch)})
        self.manifest = {
            'schema': 'infinity-ring-protection-demolition-provenance-v1',
            'historicalBaselineSha': self.ring.BASELINE, 'previousAdoptionSourceSha': REFERENCE,
            'previousManifests': [
                {'path': self.ring.DOMAIN_MANIFEST, 'sha256': self.ring.DOMAIN_MANIFEST_SHA256},
                {'path': self.ring.IRN_MANIFEST, 'sha256': self.ring.IRN_MANIFEST_SHA256}],
            'domainPaths': list(self.ring.DOMAIN_PATHS),
            'originalRingCriticalPaths': list(self.ring.RING_CRITICAL_PATHS),
            'exactRingCriticalDeltaPaths': list(self.ring.DEMOLITION_RING_DELTAS), 'changedPaths': rows,
        }
        self.raw = (json.dumps(self.manifest, indent=2) + '\n').encode()
        self.ring.DEMOLITION_MANIFEST_SHA256 = digest(self.raw)
        self.manifest_path = self.ring.DEMOLITION_MANIFEST
        (self.view / self.manifest_path).write_bytes(self.raw)
        self.candidate = self.make(provisional, {self.manifest_path: ('100644', self.raw)})

    def evaluate(self, candidate=None, ring=None):
        checks = []
        def check(name, passed, detail=None):
            checks.append((name, bool(passed)))
            if not passed:
                raise AssertionError(name)
        result = (ring or self.ring).synchronized_domain_provenance(self.view, candidate or self.candidate, self.git, check)
        self.assertTrue(all(passed for _, passed in checks))
        return result

    def reject(self, candidate):
        with self.assertRaises((AssertionError, FileNotFoundError, subprocess.CalledProcessError)):
            self.evaluate(candidate)

    def test_exact_source_adoption_revalidates_the_real_prior_chain(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], 'exact-declared-demolition-semantic-delta')
        self.assertEqual(result['previousProvenance']['contract'], 'exact-declared-irn-semantic-delta')
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertEqual(result['candidateSourceSha'], self.candidate)
        self.assertFalse(result['historicalDomainByteIdentity'])
        self.assertIn('not native or CI acceptance', result['verificationScope'])

    def test_all_original_positive_source_branches_still_apply(self):
        for ref, expected in ((self.ring.BASELINE, 'historical-domain-byte-identity'),
                              ('4afa5331d6e54509a643572570dc3cd194c78ebf', 'exact-declared-r10-terraformer-delta'),
                              (REFERENCE, 'exact-declared-irn-semantic-delta')):
            with self.subTest(ref=ref):
                self.assertEqual(self.evaluate(ref)['contract'], expected)

    def test_real_production_pins_do_not_accept_synthetic_unit_approvals(self):
        with self.assertRaises(AssertionError):
            self.evaluate(ring=module())

    def test_any_approved_file_byte_mode_deletion_or_reversion_is_rejected(self):
        for path, (mode, content) in self.approved.items():
            for value in (None, (mode, content + b'\n// not approved\n'), ('100755', content), ('120000', content)):
                with self.subTest(path=path, value=None if value is None else value[0]):
                    self.reject(self.make(self.candidate, {path: value}))
            if self.entry(REFERENCE, path):
                self.reject(self.make(self.candidate, {path: ('100644', self.git('show', REFERENCE + ':' + path))}))

    def test_every_protected_directory_still_rejects_extra_changes(self):
        for directory in self.ring.DOMAIN_PATHS:
            with self.subTest(directory=directory):
                self.reject(self.make(self.candidate, {directory + '/unapproved.ts': ('100644', b'export const forbidden = 1;\n')}))
        for path in ('src/game/save-session.ts', 'src/game/arcade.ts', 'src/data/arcade.ts', 'src/data/protocol-cards.ts', 'src/data/ring-art.json'):
            original = self.git('show', REFERENCE + ':' + path)
            for value in (None, ('100644', original + b'\n'), ('100755', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: value}))

    def test_ring_ui_outside_the_domain_directories_is_still_immutable(self):
        for path in (path for path in self.ring.RING_CRITICAL_PATHS if path.startswith('src/ui/')):
            original = self.git('show', REFERENCE + ':' + path)
            for value in (None, ('100644', original + b'\n'), ('100755', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: value}))

    def test_old_manifests_keep_exact_bytes_and_modes_in_the_new_candidate(self):
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST):
            original = self.git('show', REFERENCE + ':' + path)
            for value in (None, ('100644', original + b'\n'), ('100755', original), ('120000', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: value}))

    def test_new_manifest_must_be_exact_local_and_committed_ordinary_bytes(self):
        for value in (None, ('100644', self.raw + b'\n'), ('100755', self.raw), ('120000', self.raw)):
            self.reject(self.make(self.candidate, {self.manifest_path: value}))
        local = self.view / self.manifest_path
        local.write_bytes(self.raw + b'\n')
        self.reject(self.candidate)
        local.unlink()
        self.reject(self.candidate)

    def test_structural_scope_and_every_record_are_checked_beyond_the_manifest_digest(self):
        mutations = [
            lambda m: m.update(schema='different-schema'),
            lambda m: m.update(previousAdoptionSourceSha=self.candidate),
            lambda m: m.update(domainPaths=['src/game']),
            lambda m: m.update(originalRingCriticalPaths=[]),
            lambda m: m.update(exactRingCriticalDeltaPaths=['src/automation']),
            lambda m: m['changedPaths'].pop(),
            lambda m: m['changedPaths'][0]['before'].update(sha256='0' * 64),
            lambda m: m['changedPaths'][0]['after'].update(sha256='0' * 64),
            lambda m: m['changedPaths'][0]['after'].update(mode='100755'),
            lambda m: m['changedPaths'][0].update(patchSha256='0' * 64),
            lambda m: m['changedPaths'][0]['hunks'][0].update(sha256='0' * 64),
            lambda m: m['changedPaths'][0]['hunks'][0].update(header='@@ unrelated @@'),
        ]
        for index, mutate in enumerate(mutations):
            changed = copy.deepcopy(self.manifest)
            mutate(changed)
            raw = (json.dumps(changed, indent=2) + '\n').encode()
            # Isolated unit override gets beyond the outer immutable-digest gate;
            # production never takes a manifest digest from the file itself.
            self.ring.DEMOLITION_MANIFEST_SHA256 = digest(raw)
            (self.view / self.manifest_path).write_bytes(raw)
            with self.subTest(index=index):
                self.reject(self.make(self.candidate, {self.manifest_path: ('100644', raw)}))

    def test_unrelated_presentation_is_outside_source_scope_not_a_native_pass(self):
        candidate = self.make(self.candidate, {'src/ui/present.ts': ('100644', b'// Deliberate non-ring UI change, no native acceptance.\n')})
        self.assertEqual(self.evaluate(candidate)['contract'], 'exact-declared-demolition-semantic-delta')

    def test_old_native_functions_and_all_original_provenance_statements_are_preserved(self):
        old = ast.parse(self.git('show', REFERENCE + ':scripts/browser-ring-protection.py').decode())
        new = ast.parse(SCRIPT.read_text())
        nodes = lambda tree: {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        before, after = nodes(old), nodes(new)
        dump = lambda node: ast.dump(node, include_attributes=False)
        self.assertEqual([name for name in before if dump(before[name]) != dump(after[name])], ['production_serializers', 'synchronized_domain_provenance', 'worker'])
        # The independently tested r11 observer repair changes only the handler
        # locator expression and adds its candidate-count diagnostic. Restore
        # exactly those two AST nodes, then require the whole original worker
        # (including every native assertion and CDP expression) to remain exact.
        old_locator = next(node for node in ast.walk(before['worker'])
                           if isinstance(node, ast.Assign) and len(node.targets) == 1
                           and isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'anchors')
        new_locator = dump(ast.parse('anchors = production_action_handlers(text)').body[0])
        diagnostic = dump(ast.parse("row['observerHandlerCandidates'] = len(anchors)").body[0])
        replaced = []

        class RestoreOnlyObserverLocator(ast.NodeTransformer):
            def visit_Assign(self, node):
                shape = dump(node)
                if shape == new_locator:
                    replaced.append('locator')
                    return copy.deepcopy(old_locator)
                if shape == diagnostic:
                    replaced.append('diagnostic')
                    return None
                return self.generic_visit(node)

        restored = RestoreOnlyObserverLocator().visit(copy.deepcopy(after['worker']))
        self.assertEqual(replaced, ['locator', 'diagnostic'])
        self.assertEqual(dump(restored), dump(before['worker']))
        # The only serializer delta is the independently tested exact r12 prefix.
        old_serializer = copy.deepcopy(before['production_serializers'])
        new_serializer = copy.deepcopy(after['production_serializers'])
        old_prefix = next(node for node in old_serializer.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'prefix' for target in node.targets))
        new_prefix = next(node for node in new_serializer.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == 'prefix' for target in node.targets))
        prefix_text = ast.unparse(new_prefix.value)
        self.assertIn('npcEconomy:', prefix_text)
        self.assertIn('terraformerGrantJobFloor:', prefix_text)
        new_serializer.body[0] = copy.deepcopy(old_serializer.body[0])
        new_serializer.body[new_serializer.body.index(new_prefix)] = old_prefix
        self.assertEqual(dump(new_serializer), dump(old_serializer))
        original = [dump(node) for node in before['synchronized_domain_provenance'].body]
        current = [dump(node) for node in after['synchronized_domain_provenance'].body]
        cursor = 0
        for node in current:
            if cursor < len(original) and node == original[cursor]:
                cursor += 1
        self.assertEqual(cursor, len(original))
        self.assertEqual(module().DOMAIN_PATHS, ('src/game', 'src/core', 'src/data', 'src/automation'))

    def test_frozen_current_production_sources_match_the_independent_manifest(self):
        production = module()
        self.assertIsInstance(production.DEMOLITION_MANIFEST_SHA256, str)
        self.assertRegex(production.DEMOLITION_MANIFEST_SHA256, r'^[0-9a-f]{64}$')
        raw = (ROOT / production.DEMOLITION_MANIFEST).read_bytes()
        self.assertEqual(digest(raw), production.DEMOLITION_MANIFEST_SHA256)
        # The demolition pin belongs to its exact verified ca5 source forever.
        # New NPC production bytes are validated by a separate successor contract.
        self.assertEqual(self.git('show', production.NPC_ADOPTION + ':' + production.DEMOLITION_MANIFEST), raw)
        (self.view / production.DEMOLITION_MANIFEST).write_bytes(raw)
        result = self.evaluate(production.NPC_ADOPTION, ring=production)
        self.assertEqual(result['contract'], 'exact-declared-demolition-semantic-delta')


class NpcSourceContractTests(unittest.TestCase):
    setUpClass = classmethod(DemolitionSourceContractTests.setUpClass.__func__)
    tearDownClass = classmethod(DemolitionSourceContractTests.tearDownClass.__func__)
    git = classmethod(DemolitionSourceContractTests.git.__func__)
    make = DemolitionSourceContractTests.make
    entry = DemolitionSourceContractTests.entry
    evaluate = DemolitionSourceContractTests.evaluate
    reject = DemolitionSourceContractTests.reject

    def setUp(self):
        self.ring = module()
        self.reference = self.ring.NPC_ADOPTION
        self.view = self.tmp / 'npc-view'
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST, self.ring.DEMOLITION_MANIFEST):
            local = self.view / path; local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(self.git('show', self.reference + ':' + path))
        self.approved = {
            'src/game/npc-unit-contract.ts': ('100644', b'export const unitOnly = true;\n'),
            'src/game/logic.ts': ('100644', self.git('show', self.reference + ':src/game/logic.ts') + b'\n// exact NPC unit adoption\n'),
            'src/ui/space-present.ts': ('100644', self.git('show', self.reference + ':src/ui/space-present.ts') + b'\n// exact display unit adoption\n'),
        }
        self.ring.NPC_CHANGED_PATHS = tuple(sorted(self.approved))
        provisional = self.make(self.reference, self.approved)
        rows = []
        for path in sorted(self.approved):
            patch = self.ring.source_delta_patch(self.git, self.reference, provisional, path)
            rows.append({'path': path, 'before': self.entry(self.reference, path), 'after': self.entry(provisional, path),
                         'patchSha256': digest(patch), 'hunks': self.ring.source_delta_hunks(patch)})
        self.manifest = {
            'schema': 'infinity-ring-protection-npc-provenance-v1',
            'historicalBaselineSha': self.ring.BASELINE, 'previousAdoptionSourceSha': self.reference,
            'previousManifests': [{'path': path, 'sha256': sha} for path, sha in (
                (self.ring.DOMAIN_MANIFEST, self.ring.DOMAIN_MANIFEST_SHA256),
                (self.ring.IRN_MANIFEST, self.ring.IRN_MANIFEST_SHA256),
                (self.ring.DEMOLITION_MANIFEST, self.ring.DEMOLITION_MANIFEST_SHA256))],
            'productionPaths': list(self.ring.NPC_PRODUCTION_PATHS), 'domainPaths': list(self.ring.DOMAIN_PATHS),
            'originalRingCriticalPaths': list(self.ring.RING_CRITICAL_PATHS),
            'exactRingCriticalDeltaPaths': [], 'changedPaths': rows,
        }
        self.raw = (json.dumps(self.manifest, indent=2) + '\n').encode()
        self.ring.NPC_MANIFEST_SHA256 = digest(self.raw)
        self.manifest_path = self.ring.NPC_MANIFEST
        (self.view / self.manifest_path).write_bytes(self.raw)
        self.candidate = self.make(provisional, {self.manifest_path: ('100644', self.raw)})

    def test_npc_adoption_preserves_all_three_frozen_prior_contracts(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], 'exact-declared-npc-semantic-delta')
        self.assertEqual(result['previousAdoptionSourceSha'], 'ca5ef0c769856f2c4c8925e76a5c7d322822fe1b')
        previous = result['previousProvenance']
        self.assertEqual(previous['contract'], 'exact-declared-demolition-semantic-delta')
        self.assertEqual(previous['candidateSourceSha'], self.reference)
        self.assertEqual(previous['previousProvenance']['contract'], 'exact-declared-irn-semantic-delta')
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertFalse(result['historicalDomainByteIdentity'])
        self.assertEqual(self.evaluate(self.reference)['contract'], 'exact-declared-demolition-semantic-delta')
        with self.assertRaises(AssertionError):
            self.evaluate(ring=module())

    def test_npc_approved_file_bytes_modes_deletions_and_reversions_are_exact(self):
        for path, (mode, content) in self.approved.items():
            options = [None, (mode, content+b'\n'), ('100755', content), ('120000', content)]
            if self.entry(self.reference, path):
                options.append(('100644', self.git('show', self.reference + ':' + path)))
            for option in options:
                with self.subTest(path=path, option=option and option[0]):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_npc_scope_is_all_production_and_ring_paths_are_not_exempt(self):
        for directory in ('src/game', 'src/core', 'src/data', 'src/automation', 'src/ui', 'src/other'):
            with self.subTest(directory=directory):
                self.reject(self.make(self.candidate, {directory+'/unapproved.ts': ('100644', b'// unapproved\n')}))
        for path in ('src/main.ts', 'src/ui/arcade-panel.ts', 'src/ui/ring-model.ts', 'src/game/arcade.ts', 'src/core/offline.ts'):
            original = self.git('show', self.reference + ':' + path)
            for option in (None, ('100644', original+b'\n'), ('100755', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_every_prior_manifest_remains_immutable(self):
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST, self.ring.DEMOLITION_MANIFEST):
            original = self.git('show', self.reference + ':' + path)
            for option in (None, ('100644', original+b'\n'), ('100755', original), ('120000', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_npc_manifest_exact_local_committed_regular_file_requirement(self):
        for option in (None, ('100644', self.raw+b'\n'), ('100755', self.raw), ('120000', self.raw)):
            self.reject(self.make(self.candidate, {self.manifest_path: option}))
        local = self.view / self.manifest_path
        local.write_bytes(self.raw+b'\n'); self.reject(self.candidate)
        local.unlink(); self.reject(self.candidate)

    def test_npc_scope_paths_hunks_and_modes_checked_beyond_outer_digest(self):
        mutations = [
            lambda m: m.update(schema='wrong'), lambda m: m.update(previousAdoptionSourceSha=self.candidate),
            lambda m: m.update(productionPaths=['src/game']), lambda m: m.update(domainPaths=['src/game']),
            lambda m: m.update(originalRingCriticalPaths=[]), lambda m: m.update(exactRingCriticalDeltaPaths=['src/core']),
            lambda m: m['previousManifests'].pop(), lambda m: m['changedPaths'].pop(),
            lambda m: m['changedPaths'][0].update(before={'mode':'100644','sha256':'0'*64}),
            lambda m: m['changedPaths'][0]['after'].update(sha256='0'*64),
            lambda m: m['changedPaths'][0]['after'].update(mode='100755'),
            lambda m: m['changedPaths'][0].update(patchSha256='0'*64),
            lambda m: m['changedPaths'][0]['hunks'][0].update(header='@@ wrong @@'),
            lambda m: m['changedPaths'][0]['hunks'][0].update(sha256='0'*64),
        ]
        for index, mutate in enumerate(mutations):
            manifest = copy.deepcopy(self.manifest); mutate(manifest)
            raw = (json.dumps(manifest, indent=2)+'\n').encode()
            self.ring.NPC_MANIFEST_SHA256 = digest(raw)
            (self.view/self.manifest_path).write_bytes(raw)
            with self.subTest(index=index):
                self.reject(self.make(self.candidate, {self.manifest_path: ('100644', raw)}))

    def test_final_npc_source_matches_its_independent_manifest(self):
        production = module()
        self.assertRegex(production.NPC_MANIFEST_SHA256, r'^[0-9a-f]{64}$')
        raw = (ROOT/production.NPC_MANIFEST).read_bytes()
        self.assertEqual(digest(raw), production.NPC_MANIFEST_SHA256)
        tracked = subprocess.check_output(['git','diff','--name-only','--no-renames',production.NPC_ADOPTION,production.ATTACK_ADOPTION,'--',*production.NPC_PRODUCTION_PATHS],cwd=ROOT).decode().splitlines()
        untracked = []  # This is the immutable eef/r12 source proof, never the current working tree.
        self.assertEqual(sorted(set(tracked+untracked)),list(production.NPC_CHANGED_PATHS))
        edits = {}
        for path in production.NPC_CHANGED_PATHS:
            entry = self.git('ls-tree',production.ATTACK_ADOPTION,'--',path).decode().split()
            self.assertEqual(entry[1],'blob')
            edits[path] = (entry[0],self.git('show',production.ATTACK_ADOPTION+':'+path))
        edits[production.NPC_MANIFEST] = ('100644',raw)
        (self.view/production.NPC_MANIFEST).write_bytes(raw)
        result = self.evaluate(self.make(production.NPC_ADOPTION,edits),ring=production)
        self.assertEqual(result['contract'],'exact-declared-npc-semantic-delta')


class NpcAttackSourceContractTests(unittest.TestCase):
    setUpClass = classmethod(DemolitionSourceContractTests.setUpClass.__func__)
    tearDownClass = classmethod(DemolitionSourceContractTests.tearDownClass.__func__)
    git = classmethod(DemolitionSourceContractTests.git.__func__)
    make = DemolitionSourceContractTests.make
    entry = DemolitionSourceContractTests.entry
    evaluate = DemolitionSourceContractTests.evaluate
    reject = DemolitionSourceContractTests.reject

    def setUp(self):
        self.ring = module()
        self.reference = self.ring.ATTACK_ADOPTION
        self.view = self.tmp / 'npc-attack-view'
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST, self.ring.DEMOLITION_MANIFEST, self.ring.NPC_MANIFEST):
            local = self.view / path; local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(self.git('show', self.reference + ':' + path))
        self.approved = {
            'src/game/npc-unit-contract.ts': ('100644', b'export const unitOnly = true;\n'),
            'src/game/logic.ts': ('100644', self.git('show', self.reference + ':src/game/logic.ts') + b'\n// exact NPC unit adoption\n'),
            'src/ui/space-present.ts': ('100644', self.git('show', self.reference + ':src/ui/space-present.ts') + b'\n// exact display unit adoption\n'),
        }
        self.ring.ATTACK_CHANGED_PATHS = tuple(sorted(self.approved))
        self.ring.ATTACK_RING_DELTAS = ()
        provisional = self.make(self.reference, self.approved)
        rows = []
        for path in sorted(self.approved):
            patch = self.ring.source_delta_patch(self.git, self.reference, provisional, path)
            rows.append({'path': path, 'before': self.entry(self.reference, path), 'after': self.entry(provisional, path),
                         'patchSha256': digest(patch), 'hunks': self.ring.source_delta_hunks(patch)})
        self.manifest = {
            'schema': 'infinity-ring-protection-npc-attack-provenance-v1',
            'historicalBaselineSha': self.ring.BASELINE, 'previousAdoptionSourceSha': self.reference,
            'previousManifests': [{'path': path, 'sha256': sha} for path, sha in (
                (self.ring.DOMAIN_MANIFEST, self.ring.DOMAIN_MANIFEST_SHA256),
                (self.ring.IRN_MANIFEST, self.ring.IRN_MANIFEST_SHA256),
                (self.ring.DEMOLITION_MANIFEST, self.ring.DEMOLITION_MANIFEST_SHA256),
                (self.ring.NPC_MANIFEST, self.ring.NPC_MANIFEST_SHA256))],
            'productionPaths': list(self.ring.ATTACK_PRODUCTION_PATHS), 'domainPaths': list(self.ring.DOMAIN_PATHS),
            'originalRingCriticalPaths': list(self.ring.RING_CRITICAL_PATHS),
            'exactRingCriticalDeltaPaths': [], 'changedPaths': rows,
        }
        self.raw = (json.dumps(self.manifest, indent=2) + '\n').encode()
        self.ring.ATTACK_MANIFEST_SHA256 = digest(self.raw)
        self.manifest_path = self.ring.ATTACK_MANIFEST
        (self.view / self.manifest_path).write_bytes(self.raw)
        self.candidate = self.make(provisional, {self.manifest_path: ('100644', self.raw)})

    def test_attack_adoption_preserves_all_four_frozen_prior_contracts(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], 'exact-declared-npc-attack-semantic-delta')
        self.assertEqual(result['previousAdoptionSourceSha'], 'eefc0706e8bc2ce39fbfd732ab9d3b67ac190d81')
        previous = result['previousProvenance']
        self.assertEqual(previous['contract'], 'exact-declared-npc-semantic-delta')
        self.assertEqual(previous['candidateSourceSha'], self.reference)
        self.assertEqual(previous['previousProvenance']['contract'], 'exact-declared-demolition-semantic-delta')
        self.assertEqual(previous['previousProvenance']['previousProvenance']['contract'], 'exact-declared-irn-semantic-delta')
        self.assertIn('not native or CI acceptance', result['verificationScope'])
        self.assertFalse(result['historicalDomainByteIdentity'])
        self.assertEqual(self.evaluate(self.reference)['contract'], 'exact-declared-npc-semantic-delta')
        with self.assertRaises(AssertionError):
            self.evaluate(ring=module())

    def test_npc_approved_file_bytes_modes_deletions_and_reversions_are_exact(self):
        for path, (mode, content) in self.approved.items():
            options = [None, (mode, content+b'\n'), ('100755', content), ('120000', content)]
            if self.entry(self.reference, path):
                options.append(('100644', self.git('show', self.reference + ':' + path)))
            for option in options:
                with self.subTest(path=path, option=option and option[0]):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_npc_scope_is_all_production_and_ring_paths_are_not_exempt(self):
        for directory in ('src/game', 'src/core', 'src/data', 'src/automation', 'src/ui', 'src/other'):
            with self.subTest(directory=directory):
                self.reject(self.make(self.candidate, {directory+'/unapproved.ts': ('100644', b'// unapproved\n')}))
        for path in ('src/main.ts', 'src/ui/arcade-panel.ts', 'src/ui/ring-model.ts', 'src/game/arcade.ts', 'src/core/offline.ts'):
            original = self.git('show', self.reference + ':' + path)
            for option in (None, ('100644', original+b'\n'), ('100755', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_every_prior_manifest_remains_immutable(self):
        for path in (self.ring.DOMAIN_MANIFEST, self.ring.IRN_MANIFEST, self.ring.DEMOLITION_MANIFEST, self.ring.NPC_MANIFEST):
            original = self.git('show', self.reference + ':' + path)
            for option in (None, ('100644', original+b'\n'), ('100755', original), ('120000', original)):
                with self.subTest(path=path):
                    self.reject(self.make(self.candidate, {path: option}))

    def test_npc_manifest_exact_local_committed_regular_file_requirement(self):
        for option in (None, ('100644', self.raw+b'\n'), ('100755', self.raw), ('120000', self.raw)):
            self.reject(self.make(self.candidate, {self.manifest_path: option}))
        local = self.view / self.manifest_path
        local.write_bytes(self.raw+b'\n'); self.reject(self.candidate)
        local.unlink(); self.reject(self.candidate)

    def test_npc_scope_paths_hunks_and_modes_checked_beyond_outer_digest(self):
        mutations = [
            lambda m: m.update(schema='wrong'), lambda m: m.update(previousAdoptionSourceSha=self.candidate),
            lambda m: m.update(productionPaths=['src/game']), lambda m: m.update(domainPaths=['src/game']),
            lambda m: m.update(originalRingCriticalPaths=[]), lambda m: m.update(exactRingCriticalDeltaPaths=['src/core']),
            lambda m: m['previousManifests'].pop(), lambda m: m['changedPaths'].pop(),
            lambda m: m['changedPaths'][0].update(before={'mode':'100644','sha256':'0'*64}),
            lambda m: m['changedPaths'][0]['after'].update(sha256='0'*64),
            lambda m: m['changedPaths'][0]['after'].update(mode='100755'),
            lambda m: m['changedPaths'][0].update(patchSha256='0'*64),
            lambda m: m['changedPaths'][0]['hunks'][0].update(header='@@ wrong @@'),
            lambda m: m['changedPaths'][0]['hunks'][0].update(sha256='0'*64),
        ]
        for index, mutate in enumerate(mutations):
            manifest = copy.deepcopy(self.manifest); mutate(manifest)
            raw = (json.dumps(manifest, indent=2)+'\n').encode()
            self.ring.ATTACK_MANIFEST_SHA256 = digest(raw)
            (self.view/self.manifest_path).write_bytes(raw)
            with self.subTest(index=index):
                self.reject(self.make(self.candidate, {self.manifest_path: ('100644', raw)}))


    def test_final_attack_source_matches_its_independently_sealed_manifest(self):
        production=module()
        self.assertRegex(production.ATTACK_MANIFEST_SHA256,r'^[0-9a-f]{64}$')
        raw=(ROOT/production.ATTACK_MANIFEST).read_bytes()
        self.assertEqual(digest(raw),production.ATTACK_MANIFEST_SHA256)
        tracked=subprocess.check_output(['git','diff','--name-only','--no-renames',production.ATTACK_ADOPTION,'--',*production.ATTACK_PRODUCTION_PATHS],cwd=ROOT).decode().splitlines()
        untracked=subprocess.check_output(['git','ls-files','--others','--exclude-standard','--',*production.ATTACK_PRODUCTION_PATHS],cwd=ROOT).decode().splitlines()
        self.assertEqual(sorted(set(tracked+untracked)),list(production.ATTACK_CHANGED_PATHS))
        edits={}
        for path in production.ATTACK_CHANGED_PATHS:
            local=ROOT/path
            if not local.exists() and not local.is_symlink(): edits[path]=None; continue
            self.assertFalse(local.is_symlink());self.assertTrue(local.is_file())
            edits[path]=('100755' if local.stat().st_mode&stat.S_IXUSR else '100644',local.read_bytes())
        edits[production.ATTACK_MANIFEST]=('100644',raw)
        (self.view/production.ATTACK_MANIFEST).write_bytes(raw)
        result=self.evaluate(self.make(production.ATTACK_ADOPTION,edits),ring=production)
        self.assertEqual(result['contract'],'exact-declared-npc-attack-semantic-delta')
        self.assertEqual(result['previousProvenance']['candidateSourceSha'],production.ATTACK_ADOPTION)


if __name__ == '__main__':
    unittest.main()
