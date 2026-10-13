"""Exact recycle-preview source adoption on the immutable public 6b source.

Python/Git only. Synthetic objects live in a disposable object database. The
explicit --build-manifest command writes only its named output; it never changes
its own approved digest, an index, a ref, production, or acceptance evidence.
After production is frozen, generate the manifest and explicitly pin its printed
SHA256 in this module and scripts/check-ui-baseline.mjs. A seal is source evidence,
not functional equivalence, native acceptance, or permission to omit an old gate.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_manual_unit_provenance as manual
from test_lab_blockers_provenance import ObjectDatabase

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = '6b985b88ec6b263a3eeb8f34252525383a9f110f'
ARITHMETIC_REFERENCE = 'cafcdfdd140f4bcbf17e589e99f83f2d761f9e49'
MANIFEST = 'tests/fixtures/recycle-preview-provenance.json'
MANIFEST_SHA256 = 'b9e0d5f457580c0ea5fb5afae30baf3a37247c7b876c29830ccbb4db372c46f8'
MANUAL_MANIFEST_SHA256 = '0b48b25de339ee749b43d881e41c4da85df64798a978989000efde831ed3650b'
SCHEMA = 'infinity-ring-protection-recycle-preview-provenance-v1'
CONTRACT = 'exact-declared-recycle-preview-source-delta'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src', 'public')
CHANGED_PATHS = ('src/game/deep-space.ts', 'src/game/recycle-amounts.ts', 'src/style.css',
                 'src/ui/recycle-preview-model.ts', 'src/ui/recycle-preview-panel.ts',
                 'src/ui/space-panel.ts', 'src/ui/space-present.ts')
DOMAIN_DELTA_PATHS = ('src/game/deep-space.ts', 'src/game/recycle-amounts.ts')
UNCHANGED_PATHS = ('src/core', 'src/data', 'src/automation', 'public', 'src/main.ts',
                   'src/space.css', 'src/ui/view.ts', 'src/ui/manual-unit-controls.ts',
                   'src/ui/manual-unit-quote.ts', 'src/ui/shipyard-panel.ts')
RING_HOOK = "    if candidate != '6b985b88ec6b263a3eeb8f34252525383a9f110f' and git('ls-tree', candidate, '--', 'tests/fixtures/recycle-preview-provenance.json'):\n        from test_recycle_preview_provenance import recycle_preview_provenance\n        return recycle_preview_provenance(repository, candidate, git, check)\n"
STYLE_ANCHOR = b'.research-lab-blockers li + li { margin-top: 0.4rem; }\n'
STYLE_ADDITION = (b'.space-panel .recycle-preview { min-width: 0; max-width: 100%; overflow-wrap: anywhere; }\n'
                  b'.space-panel .recycle-preview p { margin: 0.4rem 0; }\n'
                  b'.space-panel .recycle-preview summary:focus-visible { outline: 2px solid var(--good); outline-offset: 3px; }\n')

# Exact compatibility adapters. Each projects the previous checker only after
# the new frozen manifest and the complete checker transition are validated.
MANUAL_TRANSITIONS = (
    ("    assert (ROOT/'scripts/browser-ring-protection.py').read_bytes()==expected, 'Only exact manual-unit provenance dispatch and observed retirement grammar may extend ring source'\n",
     "    current = (ROOT/'scripts/browser-ring-protection.py').read_bytes()\n"
     "    if current != expected:\n"
     "        from test_recycle_preview_provenance import previous_ring_bytes as recycle_previous_ring_bytes\n"
     "        current = recycle_previous_ring_bytes()\n"
     "    assert current==expected, 'Only exact manual-unit provenance dispatch and observed retirement grammar may extend ring source'\n"),
    ("    assert (ROOT / 'scripts/check-ui-baseline.mjs').read_bytes() == expected.encode(), 'Unapproved UI baseline checker drift'\n",
     "    current = (ROOT / 'scripts/check-ui-baseline.mjs').read_bytes()\n"
     "    if current != expected.encode():\n"
     "        from test_recycle_preview_provenance import previous_ui_baseline_bytes as recycle_previous_ui_baseline_bytes\n"
     "        current = recycle_previous_ui_baseline_bytes()\n"
     "    assert current == expected.encode(), 'Unapproved UI baseline checker drift'\n"),
    ("    assert candidate != REFERENCE\n",
     "    if git('ls-tree', candidate, '--', 'tests/fixtures/recycle-preview-provenance.json'):\n"
     "        from test_recycle_preview_provenance import verify_candidate as verify_recycle_candidate\n"
     "        result = verify_recycle_candidate(candidate)\n"
     "        assert result['contract'] == 'exact-declared-recycle-preview-source-delta'\n"
     "        return result['previousProvenance']\n"
     "    assert candidate != REFERENCE\n"),
)


FORMATION_ANCHOR = "        if result['contract'] == 'exact-declared-manual-unit-ui-delta':\n"
FORMATION_ADAPTER = ("        if result['contract'] == 'exact-declared-recycle-preview-source-delta':\n"
    "            from test_recycle_preview_provenance import verify_candidate as verify_recycle_candidate, REFERENCE as recycle_base\n"
    "            self.assertEqual(result, verify_recycle_candidate(candidate))\n"
    "            self.assertEqual(result['previousAdoptionSourceSha'], recycle_base)\n"
    "            result = result['previousProvenance']\n"
    "            self.assertEqual(result['contract'], 'exact-declared-manual-unit-ui-delta')\n"
    "            self.assertEqual(result['candidateSourceSha'], recycle_base)\n")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def module():
    spec = importlib.util.spec_from_file_location('recycle_preview_ring_contract', ROOT/'scripts/browser-ring-protection.py')
    ring = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ring)
    return ring


changed, entry, row, manifest_bytes = manual.changed, manual.entry, manual.row, manual.manifest_bytes


def previous_manifests(ring):
    return [*manual.previous_manifests(ring), (manual.MANIFEST, MANUAL_MANIFEST_SHA256)]


def expected_style(git):
    before = git('show', REFERENCE + ':src/style.css')
    assert before.count(STYLE_ANCHOR) == 1, 'Exact stylesheet insertion anchor'
    return before.replace(STYLE_ANCHOR, STYLE_ANCHOR + STYLE_ADDITION, 1)


def make_manifest(ring, git, candidate):
    assert changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS), 'Exact seven approved recycle-preview paths required'
    assert changed(git, REFERENCE, candidate, ring.DOMAIN_PATHS) == list(DOMAIN_DELTA_PATHS), 'Only the exact two-file arithmetic extraction may change domain'
    assert all(entry(git, candidate, path) == entry(git, ARITHMETIC_REFERENCE, path) for path in DOMAIN_DELTA_PATHS), 'Arithmetic extraction must retain its exact already-reviewed source bytes and modes'
    assert git('show', candidate + ':src/style.css') == expected_style(git), 'Only the exact three scoped recycle-preview style rules are approved'
    return {
        'schema': SCHEMA, 'historicalBaselineSha': ring.BASELINE,
        'previousAdoptionSourceSha': REFERENCE,
        'previousManifests': [{'path': path, 'sha256': value} for path, value in previous_manifests(ring)],
        'referenceStatus': 'Exact recycle-preview source adoption atop recursively verified public 6b manual-unit source. Source provenance is not native, CI, functional-equivalence or release acceptance.',
        'scope': 'Every src/public path and mode, full before/after byte hashes, complete deterministic patches and every hunk are bound. All eleven earlier seals, original art and previously sealed view.ts remain unchanged.',
        'approvedDelta': 'Read-only recycle preview and exact two-file extraction of existing settlement arithmetic. No other game, core, data, automation, save schema, combat, economy, dispatch, public asset or manual-unit behavior change is authorized.',
        'productionPaths': list(PRODUCTION_PATHS), 'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': list(DOMAIN_DELTA_PATHS), 'exactRingCriticalDeltaPaths': [],
        'unchangedPresentationPaths': list(UNCHANGED_PATHS),
        'arithmeticExtraction': {'sourceSha': ARITHMETIC_REFERENCE, 'exactPaths': list(DOMAIN_DELTA_PATHS),
            'verificationScope': 'Exact source identity only. Independent full-state old-oracle equivalence tests and every required functional/native gate remain mandatory.'},
        'originalUiBaseline': {'baseline': '69eca71', 'expected': ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES,
            'exactDeltaPaths': list(manual.ORIGINAL_UI_PATHS),
            'changedPaths': [row(ring, git, manual.ORIGINAL_UI_REFERENCE, candidate, path) for path in manual.ORIGINAL_UI_PATHS]},
        'changedPaths': [row(ring, git, REFERENCE, candidate, path) for path in CHANGED_PATHS],
    }


def read_manifest(repository):
    local = repository/MANIFEST
    assert local.is_file() and not local.is_symlink() and not local.stat().st_mode & 0o111, 'Recycle manifest must be an ordinary nonexecutable file'
    raw = local.read_bytes()
    assert re.fullmatch('[0-9a-f]{64}', MANIFEST_SHA256) and MANIFEST_SHA256 != '0'*64 and digest(raw) == MANIFEST_SHA256, 'Recycle manifest is not the exact frozen seal'
    value = json.loads(raw)
    assert value['schema'] == SCHEMA and value['previousAdoptionSourceSha'] == REFERENCE, 'Unknown recycle manifest schema or reference'
    assert value['productionPaths'] == list(PRODUCTION_PATHS) and [item['path'] for item in value['changedPaths']] == list(CHANGED_PATHS), 'Unknown recycle source scope'
    assert value['previousManifests'] == [{'path': path, 'sha256': sha} for path, sha in previous_manifests(module())], 'Unknown or altered earlier seal'
    return raw, value


def recycle_preview_provenance(repository, candidate, git, check):
    ring = module()
    check('Recycle preview integrates exact public 6b manual-unit source',
          git('merge-base', REFERENCE, candidate).decode().strip() == REFERENCE)
    prior = manual.manual_unit_provenance(repository, REFERENCE, git, check)
    check('Recycle preview recursively verifies the complete old manual-unit game/UI contract at 6b',
          prior['contract'] == 'exact-declared-manual-unit-ui-delta' and prior['candidateSourceSha'] == REFERENCE)
    for path, expected in previous_manifests(ring):
        local = repository/path
        check('Recycle preview preserves prior local and committed manifest bytes and modes: ' + path,
              local.is_file() and not local.is_symlink() and not local.stat().st_mode & 0o111
              and digest(local.read_bytes()) == expected
              and entry(git, candidate, path) == entry(git, REFERENCE, path) == {'mode': '100644', 'sha256': expected})
    raw, value = read_manifest(repository)
    check('Recycle manifest is the exact committed ordinary-file seal',
          entry(git, candidate, MANIFEST) == {'mode': '100644', 'sha256': MANIFEST_SHA256}
          and raw == git('show', candidate + ':' + MANIFEST))
    expected = make_manifest(ring, git, candidate)
    check('Recycle preview binds every field, before/after byte, mode, complete patch and hunk exactly', value == expected)
    check('Recycle preview approved sources remain ordinary nonexecutable files',
          all(item['after'] is not None and item['after']['mode'] == '100644'
              and (item['before'] is None or item['before']['mode'] == '100644') for item in value['changedPaths']))
    check('Recycle preview retains original UI anchors and only the previously declared two cumulative UI deltas',
          all(item['before'] == {'mode': '100644', 'sha256': ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES[item['path']]}
              and item['after']['mode'] == '100644' and item['hunks'] for item in value['originalUiBaseline']['changedPaths']))
    check('Recycle preview preserves ring, art, core, data, save and unrelated UI bytes',
          changed(git, REFERENCE, candidate, ring.RING_CRITICAL_PATHS) == []
          and changed(git, REFERENCE, candidate, UNCHANGED_PATHS) == []
          and changed(git, REFERENCE, candidate, ring.DOMAIN_PATHS) == list(DOMAIN_DELTA_PATHS))
    return {'contract': CONTRACT, 'historicalBaselineSha': ring.BASELINE, 'historicalDomainByteIdentity': False,
            'previousAdoptionSourceSha': REFERENCE, 'candidateSourceSha': candidate,
            'historicalChangedPaths': changed(git, ring.BASELINE, candidate, ring.DOMAIN_PATHS),
            'previousProvenance': prior, 'manifestPath': MANIFEST, 'manifestSha256': digest(raw), 'manifest': value,
            'verificationScope': 'Exact cumulative recycle-preview source adoption only; not native or CI acceptance. Full-state old-oracle tests and every previous mandatory native gate remain required.'}


def historical_bytes(path):
    return subprocess.check_output(['git', '-C', str(ROOT), 'show', REFERENCE + ':' + path])


def ring_transition(before):
    anchor = manual.RING_HOOK.encode()
    assert before.count(anchor) == 1, 'Exact previous manual-unit ring dispatch required'
    return before.replace(anchor, RING_HOOK.encode() + anchor, 1)


def ui_transition(before, manifest_sha256):
    expected = before.decode()
    for old, new, count in (
        ('MANUAL_UNIT_MANIFEST_SHA256', 'RECYCLE_PREVIEW_MANIFEST_SHA256', 4),
        (MANUAL_MANIFEST_SHA256, manifest_sha256, 1),
        (manual.MANIFEST, MANIFEST, 1),
        ('scripts/test_manual_unit_provenance.py', 'scripts/test_recycle_preview_provenance.py', 1),
        ('exact-declared-manual-unit-ui-delta', CONTRACT, 1),
        (manual.REFERENCE, REFERENCE, 1),
        ('complete original-to-manual-unit cumulative source seal', 'complete original-to-recycle-preview cumulative source seal', 1),
        ('ten earlier seals', 'eleven earlier seals', 1),
        ('manual-unit UI deltas', 'recycle-preview cumulative UI deltas', 1),
        ('手动数量 UI', '回收预览 UI', 4),
    ):
        assert expected.count(old) == count, ('Exact recycle UI checker transition cardinality', old)
        expected = expected.replace(old, new)
    return expected.encode()


def manual_transition(before):
    for old, new in MANUAL_TRANSITIONS:
        assert before.count(old.encode()) == 1, 'Exact previous manual-unit adapter anchor required'
        before = before.replace(old.encode(), new.encode(), 1)
    return before


def formation_transition(before):
    assert before.count(FORMATION_ANCHOR.encode()) == 1, 'Exact formation-copy compatibility anchor required'
    return before.replace(FORMATION_ANCHOR.encode(), (FORMATION_ADAPTER + FORMATION_ANCHOR).encode(), 1)


def previous_formation_bytes():
    read_manifest(ROOT)
    before = historical_bytes('scripts/test_rehearsal_formation_copy_provenance.py')
    assert (ROOT/'scripts/test_rehearsal_formation_copy_provenance.py').read_bytes() == formation_transition(before), 'Unapproved formation-copy contract drift'
    return before


def previous_ring_bytes():
    read_manifest(ROOT)
    before = historical_bytes('scripts/browser-ring-protection.py')
    assert (ROOT/'scripts/browser-ring-protection.py').read_bytes() == ring_transition(before), 'Unapproved ring source drift beyond exact recycle dispatch'
    return before


def previous_ui_baseline_bytes():
    read_manifest(ROOT)
    before = historical_bytes('scripts/check-ui-baseline.mjs')
    assert (ROOT/'scripts/check-ui-baseline.mjs').read_bytes() == ui_transition(before, MANIFEST_SHA256), 'Unapproved recycle UI checker drift'
    return before


def previous_manual_bytes():
    read_manifest(ROOT)
    before = historical_bytes('scripts/test_manual_unit_provenance.py')
    assert (ROOT/'scripts/test_manual_unit_provenance.py').read_bytes() == manual_transition(before), 'Unapproved prior manual-unit source contract drift'
    return before


def capture_worktree(db):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args])
    tracked = git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', REFERENCE, '--', *PRODUCTION_PATHS).decode().splitlines()
    extra = git('ls-files', '--others', '--exclude-standard', '--', *PRODUCTION_PATHS).decode().splitlines()
    ignored = git('ls-files', '--others', '--ignored', '--exclude-standard', '--', *PRODUCTION_PATHS).decode().splitlines()
    assert not ignored and sorted(set(tracked + extra)) == list(CHANGED_PATHS), ('Unexpected production or ignored source path', tracked, extra, ignored)
    ring = module()
    for path, expected in previous_manifests(ring):
        local = ROOT/path
        assert local.is_file() and not local.is_symlink() and not local.stat().st_mode & 0o111, path
        assert digest(local.read_bytes()) == expected and local.read_bytes() == db.git('show', REFERENCE + ':' + path), path
    edits = {}
    for path in CHANGED_PATHS:
        local = ROOT/path
        assert local.is_file() and not local.is_symlink() and not local.stat().st_mode & 0o111, path
        edits[path] = ('100644', local.read_bytes())
    candidate = db.make(REFERENCE, edits)
    return candidate, manifest_bytes(make_manifest(ring, db.git, candidate))


def build_worktree_manifest(destination):
    db = ObjectDatabase()
    try:
        _, raw = capture_worktree(db)
        Path(destination).write_bytes(raw)
        print(json.dumps({'path': str(destination), 'sha256': digest(raw), 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}))
    finally:
        db.close()


def verify_ui_baseline():
    db = ObjectDatabase()
    try:
        candidate, expected = capture_worktree(db)
        raw, _ = read_manifest(ROOT)
        assert raw == expected, 'Current production does not match frozen recycle-preview seal'
        candidate = db.make(candidate, {MANIFEST: ('100644', raw)})
        checks = []
        def check(name, passed, detail=None):
            assert passed, name
            checks.append(name)
        result = recycle_preview_provenance(ROOT, candidate, db.git, check)
        return {'contract': result['contract'], 'sourceScope': 'Exact current src/public bytes; disposable objects only',
                'sourceBaseline': REFERENCE, 'manifestSha256': digest(raw), 'checks': len(checks),
                'originalUiBaseline': result['manifest']['originalUiBaseline'], 'approvedSourceDeltaPaths': list(CHANGED_PATHS)}
    finally:
        db.close()


def verify_candidate(candidate):
    def git(*args):
        return subprocess.check_output(['git', '-C', str(ROOT), *args], stderr=subprocess.PIPE)
    candidate = git('rev-parse', candidate + '^{commit}').decode().strip()
    assert candidate != REFERENCE, 'Recycle candidate must be committed separately from its public baseline'
    for path in ('scripts/test_recycle_preview_provenance.py', 'scripts/test_manual_unit_provenance.py',
                 'scripts/browser-ring-protection.py', 'scripts/check-ui-baseline.mjs',
                 'scripts/test_rehearsal_formation_copy_provenance.py', MANIFEST):
        assert (ROOT/path).read_bytes() == git('show', candidate + ':' + path), ('Executed seal differs from candidate', path)
    previous_ring_bytes()
    previous_ui_baseline_bytes()
    previous_manual_bytes()
    previous_formation_bytes()
    checks = []
    def check(name, passed, detail=None):
        assert passed, name
        checks.append(name)
    result = recycle_preview_provenance(ROOT, candidate, git, check)
    scope = [*PRODUCTION_PATHS, MANIFEST, *(path for path, _ in previous_manifests(module()))]
    assert git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv', candidate, '--', *scope) == b'', 'Uncommitted source or historical seal drift'
    for flags in ((), ('--ignored',)):
        assert git('ls-files', '--others', *flags, '--exclude-standard', '--', *PRODUCTION_PATHS) == b'', 'Untracked production source'
    assert len(checks) > 115, 'Full prior provenance chain is required'
    return result


class RecyclePreviewSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db = ObjectDatabase()
    @classmethod
    def tearDownClass(cls): cls.db.close()

    def setUp(self):
        global MANIFEST_SHA256
        self.original_digest = MANIFEST_SHA256
        self.ring, self.git, self.make = module(), self.db.git, self.db.make
        self.view = self.db.tmp/'recycle-view'
        for path, _ in previous_manifests(self.ring):
            local = self.view/path
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(self.git('show', REFERENCE + ':' + path))
            local.chmod(0o644)
        self.edits = {path: ('100644', (self.git('show', REFERENCE + ':' + path) if entry(self.git, REFERENCE, path) else b'') + b'\n/* exact synthetic recycle preview */\n') for path in CHANGED_PATHS}
        for path in DOMAIN_DELTA_PATHS:
            self.edits[path] = ('100644', self.git('show', ARITHMETIC_REFERENCE + ':' + path))
        self.edits['src/style.css'] = ('100644', expected_style(self.git))
        provisional = self.make(REFERENCE, self.edits)
        self.manifest = make_manifest(self.ring, self.git, provisional)
        self.raw = manifest_bytes(self.manifest)
        MANIFEST_SHA256 = digest(self.raw)
        local = self.view/MANIFEST
        local.write_bytes(self.raw)
        local.chmod(0o644)
        self.candidate = self.make(provisional, {MANIFEST: ('100644', self.raw)})

    def tearDown(self):
        global MANIFEST_SHA256
        MANIFEST_SHA256 = self.original_digest

    def evaluate(self, candidate=None):
        def check(name, passed, detail=None): assert passed, name
        # The real module is imported separately by the ring dispatcher.
        with patch('test_recycle_preview_provenance.MANIFEST_SHA256', MANIFEST_SHA256):
            return self.ring.synchronized_domain_provenance(self.view, candidate or self.candidate, self.git, check)

    def reject(self, candidate=None):
        with self.assertRaises((AssertionError, FileNotFoundError, KeyError, TypeError, subprocess.CalledProcessError)):
            self.evaluate(candidate)

    def repin(self, value):
        global MANIFEST_SHA256
        raw = manifest_bytes(value)
        MANIFEST_SHA256 = digest(raw)
        (self.view/MANIFEST).write_bytes(raw)
        return self.make(self.candidate, {MANIFEST: ('100644', raw)})

    def test_exact_delta_recursively_preserves_all_eleven_seals_and_6b(self):
        result = self.evaluate()
        self.assertEqual(result['contract'], CONTRACT)
        self.assertEqual(result['previousProvenance']['contract'], 'exact-declared-manual-unit-ui-delta')
        self.assertEqual(result['previousProvenance']['candidateSourceSha'], REFERENCE)
        self.assertEqual(len(result['manifest']['previousManifests']), 11)
        self.assertIn('not native or CI acceptance', result['verificationScope'])

    def test_every_approved_file_rejects_bytes_modes_symlink_deletion_and_reversion(self):
        for path, (_, raw) in self.edits.items():
            values = [('100644', raw+b' '), ('100755', raw), ('120000', b'other.ts'), None]
            if entry(self.git, REFERENCE, path):
                values.append(('100644', self.git('show', REFERENCE + ':' + path)))
            for value in values:
                with self.subTest(path=path, value=value): self.reject(self.make(self.candidate, {path: value}))

    def test_complete_source_tree_rejects_unrelated_and_extra_files(self):
        for path in ('src/unknown.ts', 'src/ui/unknown.ts', 'src/game/unknown.ts', 'src/core/unknown.ts', 'src/data/unknown.ts', 'src/automation/unknown.ts', 'public/unknown.svg'):
            with self.subTest(path=path): self.reject(self.make(self.candidate, {path: ('100644', b'extra')}))
        for path in (*UNCHANGED_PATHS[5:], 'src/game/save.ts', 'src/game/logic.ts', 'src/core/offline.ts', 'src/data/units.ts', 'src/ui/lab-blockers-panel.ts', 'public/favicon-32.png'):
            with self.subTest(path=path):
                self.reject(self.make(self.candidate, {path: ('100644', self.git('show', REFERENCE + ':' + path) + b' ')}))

    def test_every_manifest_field_and_row_binding_fails_closed_even_if_repinned(self):
        for key in self.manifest:
            value = copy.deepcopy(self.manifest)
            del value[key]
            with self.subTest(field=key): self.reject(self.repin(value))
        for index in range(len(CHANGED_PATHS)):
            for key in ('before', 'after', 'patchSha256', 'hunks'):
                value = copy.deepcopy(self.manifest)
                value['changedPaths'][index][key] = None if value['changedPaths'][index][key] is not None else {'mode': '100644', 'sha256': '0'*64}
                with self.subTest(index=index, field=key): self.reject(self.repin(value))

    def test_unknown_schema_older_seal_and_widened_scope_fail_even_if_repinned(self):
        mutations = [lambda m: m.update(extra=True), lambda m: m.update(schema='unknown'),
                     lambda m: m['previousManifests'].append({'path': 'tests/fixtures/unknown-provenance.json', 'sha256': '0'*64}),
                     lambda m: m['previousManifests'].pop(), lambda m: m['productionPaths'].append('scripts'),
                     lambda m: m['exactDomainDeltaPaths'].append('src/game/save.ts'),
                     lambda m: m['originalUiBaseline']['exactDeltaPaths'].append('src/main.ts'),
                     lambda m: m['originalUiBaseline']['changedPaths'][0]['before'].update(sha256='0'*64),
                     lambda m: m['arithmeticExtraction'].update(sourceSha=REFERENCE)]
        for mutate in mutations:
            value = copy.deepcopy(self.manifest)
            mutate(value)
            self.reject(self.repin(value))

    def test_all_eleven_older_seals_reject_local_and_committed_bytes_and_modes(self):
        for path, _ in previous_manifests(self.ring):
            raw = self.git('show', REFERENCE + ':' + path)
            for change in (('100644', raw+b' '), ('100755', raw), None):
                with self.subTest(path=path, change=change): self.reject(self.make(self.candidate, {path: change}))
            local = self.view/path
            local.write_bytes(raw+b' ')
            self.reject()
            local.write_bytes(raw)
            local.chmod(0o755)
            self.reject()
            local.chmod(0o644)

    def test_current_manifest_rejects_local_bytes_mode_symlink_and_committed_mode(self):
        local = self.view/MANIFEST
        local.write_bytes(self.raw+b' ')
        self.reject()
        local.write_bytes(self.raw)
        local.chmod(0o755)
        self.reject()
        local.chmod(0o644)
        self.reject(self.make(self.candidate, {MANIFEST: ('100755', self.raw)}))
        local.unlink()
        target = self.db.tmp/'manifest-target.json'
        target.write_bytes(self.raw)
        local.symlink_to(target)
        self.reject()
        local.unlink()
        local.write_bytes(self.raw)

    def test_unrelated_ancestry_cannot_adopt_identical_source_tree(self):
        tree = self.git('rev-parse', self.candidate + '^{tree}').decode().strip()
        orphan = self.git('commit-tree', tree, input=b'Unrelated source tree\n').decode().strip()
        self.reject(orphan)

    def test_domain_or_css_changes_cannot_be_admitted_by_regenerating_manifest(self):
        for path in (*DOMAIN_DELTA_PATHS, 'src/style.css'):
            candidate = self.make(self.candidate, {path: ('100644', self.edits[path][1]+b' ' )})
            with self.subTest(path=path), self.assertRaises(AssertionError):
                make_manifest(self.ring, self.git, candidate)

    def test_prior_public_6b_still_uses_its_own_manual_contract(self):
        def check(name, passed, detail=None): assert passed, name
        self.assertEqual(self.ring.synchronized_domain_provenance(self.view, REFERENCE, self.git, check)['contract'], 'exact-declared-manual-unit-ui-delta')

    def test_only_exact_dispatch_and_three_narrow_compatibility_adapters_are_added(self):
        self.assertEqual((ROOT/'scripts/browser-ring-protection.py').read_bytes(), ring_transition(historical_bytes('scripts/browser-ring-protection.py')))
        self.assertEqual((ROOT/'scripts/test_manual_unit_provenance.py').read_bytes(), manual_transition(historical_bytes('scripts/test_manual_unit_provenance.py')))
        self.assertEqual((ROOT/'scripts/test_rehearsal_formation_copy_provenance.py').read_bytes(), formation_transition(historical_bytes('scripts/test_rehearsal_formation_copy_provenance.py')))

    def test_old_checker_projection_requires_exact_manifest_schema_hash_and_transition(self):
        with patch(__name__ + '.ROOT', self.view):
            for path, transition in (('scripts/browser-ring-protection.py', ring_transition),
                                     ('scripts/check-ui-baseline.mjs', lambda raw: ui_transition(raw, MANIFEST_SHA256))):
                # Read immutable bytes with the actual repository before redirecting.
                before = self.git('show', REFERENCE + ':' + path)
                local = self.view/path
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(transition(before))
            # read_manifest imports the actual unchanged ring constants.
        with patch(__name__ + '.ROOT', self.view), patch(__name__ + '.module', return_value=self.ring), patch(__name__ + '.historical_bytes', side_effect=lambda path: self.git('show', REFERENCE + ':' + path)):
            self.assertEqual(previous_ring_bytes(), self.git('show', REFERENCE + ':scripts/browser-ring-protection.py'))
            self.assertEqual(previous_ui_baseline_bytes(), self.git('show', REFERENCE + ':scripts/check-ui-baseline.mjs'))
            local = self.view/MANIFEST
            local.write_bytes(self.raw+b' ')
            with self.assertRaises(AssertionError): previous_ring_bytes()
            local.write_bytes(self.raw)
            (self.view/'scripts/browser-ring-protection.py').write_bytes(b'unapproved checker')
            with self.assertRaises(AssertionError): previous_ring_bytes()


class RecyclePreviewCommittedCandidateTests(unittest.TestCase):
    def test_actual_committed_candidate_matches_complete_frozen_source(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'], CONTRACT)


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
