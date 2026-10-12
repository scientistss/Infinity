"""Exact manual-unit UI adoption atop sealed 9a27ed8. Python/Git only.

Synthetic tests write only disposable object databases. Source sealing is an
explicit command; this module never updates its own approved digest. Neither
source provenance nor the historical diagnostic is native or CI acceptance.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import unittest
from test_lab_blockers_provenance import ObjectDatabase

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = '9a27ed8c198a19f6bab9578e3d8d26ee22cdfc13'
MANIFEST = 'tests/fixtures/manual-unit-provenance.json'
MANIFEST_SHA256 = '0b48b25de339ee749b43d881e41c4da85df64798a978989000efde831ed3650b'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src', 'public')
CHANGED_PATHS = ('src/main.ts', 'src/style.css', 'src/ui/manual-unit-controls.ts',
                 'src/ui/manual-unit-quote.ts', 'src/ui/shipyard-panel.ts',
                 'src/ui/space-panel.ts', 'src/ui/view.ts')
ORIGINAL_UI_REFERENCE = '69eca7107980cce3c4c24ce4736a91993c051fbd'
ORIGINAL_UI_PATHS = ('src/style.css', 'src/ui/view.ts')
RING_HOOK = "    if candidate != '9a27ed8c198a19f6bab9578e3d8d26ee22cdfc13' and git('ls-tree', candidate, '--', 'tests/fixtures/manual-unit-provenance.json'):\n        from test_manual_unit_provenance import manual_unit_provenance\n        return manual_unit_provenance(repository, candidate, git, check)\n"

RING_OBSERVER_TRANSITIONS = (
    (r'''        rf'\.includes\((?P=action)\.type\)&&{identifier}\.retireNpcRehearsal\(\),)?'
''', r'''        rf'\.includes\((?P=action)\.type\)&&'
        rf'(?:{identifier}\.retireNpcRehearsal\(\)|'
        rf'\({identifier}\.retireNpcRehearsal\(\),{identifier}\.retireManualUnits\(\)\)),)?'
'''),
    (r'''    return list(re.finditer(pattern, text))
''', r'''    # Exact current paired retirement is optional only as a whole. Keep the
    # historical numbered name/action/session captures unchanged. A separate
    # read-only check requires both new calls to use the same view receiver.
    matches = list(re.finditer(pattern, text))
    valid = []
    for match in matches:
        paired = re.search(
            rf'&&\(({identifier})\.retireNpcRehearsal\(\),({identifier})\.retireManualUnits\(\)\),',
            match.group(0))
        if paired is not None and paired.group(1) != paired.group(2):
            continue
        valid.append(match)
    return valid
'''),
)


def digest(raw): return hashlib.sha256(raw).hexdigest()


def module():
    spec = importlib.util.spec_from_file_location('manual_unit_ring_contract', ROOT/'scripts/browser-ring-protection.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def previous_manifests(ring):
    from test_lab_blockers_provenance import previous_manifests as earlier
    return [*earlier(ring), (ring.LAB_BLOCKERS_MANIFEST, ring.LAB_BLOCKERS_MANIFEST_SHA256)]


def changed(git, before, after, paths):
    return git('diff', '--name-only', '--no-renames', '--no-ext-diff', '--no-textconv',
               before, after, '--', *paths).decode().splitlines()


def entry(git, reference, path):
    raw = git('ls-tree', reference, '--', path)
    if not raw: return None
    metadata, actual = raw.decode().rstrip('\n').split('\t')
    mode, kind, oid = metadata.split()
    assert actual == path and kind == 'blob', path
    return {'mode': mode, 'sha256': digest(git('cat-file', 'blob', oid))}


def row(ring, git, before, after, path):
    patch = ring.source_delta_patch(git, before, after, path)
    return {'path': path, 'before': entry(git, before, path), 'after': entry(git, after, path),
            'patchSha256': digest(patch), 'hunks': ring.source_delta_hunks(patch)}


def make_manifest(ring, git, candidate):
    assert changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS), 'Exact seven approved UI paths required'
    protected = tuple(path for path in ring.LAB_BLOCKERS_UNCHANGED_PATHS if path != 'src/main.ts')
    return {
        'schema': 'infinity-ring-protection-manual-unit-provenance-v1',
        'historicalBaselineSha': ring.BASELINE, 'previousAdoptionSourceSha': REFERENCE,
        'previousManifests': [{'path': path, 'sha256': value} for path, value in previous_manifests(ring)],
        'referenceStatus': 'Exact manual-unit UI adoption atop recursively verified laboratory source 9a27ed8. Historical diagnostic 1f666 is not release or native acceptance.',
        'scope': 'Every src/public path and mode, approved before/after bytes, full deterministic patches and each hunk are bound; all ten prior manifests and all domain, ring and public bytes remain unchanged.',
        'approvedDelta': 'Per-card transient raw unit text, strict integer quotes and explicit paid manual submission through unchanged game authority. No game, core, data, automation, save schema, combat, economy, dispatch or public asset changes.',
        'productionPaths': list(PRODUCTION_PATHS), 'domainPaths': list(ring.DOMAIN_PATHS),
        'originalRingCriticalPaths': list(ring.RING_CRITICAL_PATHS),
        'exactDomainDeltaPaths': [], 'exactRingCriticalDeltaPaths': [],
        'unchangedPresentationPaths': list(protected),
        'originalUiBaseline': {'baseline':'69eca71', 'expected':ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES,
            'exactDeltaPaths':list(ORIGINAL_UI_PATHS),
            'changedPaths':[row(ring, git, ORIGINAL_UI_REFERENCE, candidate, path) for path in ORIGINAL_UI_PATHS]},
        'changedPaths':[row(ring, git, REFERENCE, candidate, path) for path in CHANGED_PATHS],
    }


def manifest_bytes(value): return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()


def manual_unit_provenance(repository, candidate, git, check):
    ring = module()
    check('Manual units integrates the exact sealed 9a27ed8 laboratory source',
          git('merge-base', REFERENCE, candidate).decode().strip() == REFERENCE)
    prior = ring.lab_blockers_provenance(repository, REFERENCE, git, check)
    check('Manual units recursively verifies the complete previous laboratory source contract',
          prior['contract'] == 'exact-declared-lab-blockers-ui-delta' and prior['candidateSourceSha'] == REFERENCE)
    for path, expected in previous_manifests(ring):
        local = repository/path
        check('Manual units preserves prior local and committed manifest bytes and mode: '+path,
              local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
              and digest(local.read_bytes()) == expected
              and entry(git, candidate, path) == entry(git, REFERENCE, path) == {'mode':'100644','sha256':expected})
    local = repository/MANIFEST
    raw = local.read_bytes()
    check('Manual units manifest is the exact fixed ordinary-file seal locally and in candidate',
          local.is_file() and not local.is_symlink() and not (local.stat().st_mode & 0o111)
          and re.fullmatch('[0-9a-f]{64}', MANIFEST_SHA256) is not None
          and digest(raw) == MANIFEST_SHA256
          and entry(git, candidate, MANIFEST) == {'mode':'100644','sha256':MANIFEST_SHA256}
          and raw == git('show', candidate+':'+MANIFEST))
    value = json.loads(raw)
    check('Manual units production path set is exactly the seven approved UI files',
          changed(git, REFERENCE, candidate, PRODUCTION_PATHS) == list(CHANGED_PATHS))
    expected = make_manifest(ring, git, candidate)
    check('Manual units binds every field, before/after byte, mode, full patch and hunk exactly', value == expected)
    check('Manual units changed sources remain ordinary nonexecutable files',
          all(item['after'] is not None and item['after']['mode']=='100644'
              and (item['before'] is None or item['before']['mode']=='100644') for item in value['changedPaths']))
    check('Manual units retains exact original UI anchors and only two explicit presentation deltas',
          all(item['before'] == {'mode':'100644','sha256':ring.LAB_BLOCKERS_ORIGINAL_UI_HASHES[item['path']]}
              and item['after']['mode']=='100644' and item['hunks'] for item in value['originalUiBaseline']['changedPaths']))
    check('Manual units preserves complete domain, ring, public and unrelated presentation bytes',
          changed(git, REFERENCE, candidate, ring.DOMAIN_PATHS) == []
          and changed(git, REFERENCE, candidate, ring.RING_CRITICAL_PATHS) == []
          and changed(git, REFERENCE, candidate, expected['unchangedPresentationPaths']) == [])
    return {'contract':'exact-declared-manual-unit-ui-delta', 'historicalBaselineSha':ring.BASELINE,
            'historicalDomainByteIdentity':False, 'previousAdoptionSourceSha':REFERENCE,
            'candidateSourceSha':candidate, 'historicalChangedPaths':changed(git,ring.BASELINE,candidate,ring.DOMAIN_PATHS),
            'previousProvenance':prior, 'manifestPath':MANIFEST, 'manifestSha256':digest(raw), 'manifest':value,
            'verificationScope':'Exact same-schema manual-unit UI source adoption only; not native or CI acceptance. Every earlier mandatory native game gate remains required.'}


def previous_ring_bytes():
    before=subprocess.check_output(['git','-C',str(ROOT),'show',REFERENCE+':scripts/browser-ring-protection.py'])
    anchor=b'    if candidate != LAB_BLOCKERS_ADOPTION'
    assert before.count(anchor)==1
    expected=before.replace(anchor,RING_HOOK.encode()+anchor,1)
    for old, new in RING_OBSERVER_TRANSITIONS:
        assert expected.count(old.encode()) == 1, 'Exact ring observer transition cardinality'
        expected = expected.replace(old.encode(), new.encode(), 1)
    assert (ROOT/'scripts/browser-ring-protection.py').read_bytes()==expected, 'Only exact manual-unit provenance dispatch and observed retirement grammar may extend ring source'
    return before


def previous_ui_baseline_bytes(manifest_sha256=MANIFEST_SHA256):
    """Project the immutable prior UI checker only after every approved byte matches."""
    before = subprocess.check_output(['git', '-C', str(ROOT), 'show', REFERENCE + ':scripts/check-ui-baseline.mjs'])
    expected = before.decode()
    for old, new, count in (
        ('LAB_BLOCKERS_MANIFEST_SHA256', 'MANUAL_UNIT_MANIFEST_SHA256', 4),
        ('ea23cbbc562494b2e00ab37eac5f666c2fb2773904f2366d3f3f8b76d4c9afb8', manifest_sha256, 1),
        ('tests/fixtures/lab-blockers-provenance.json', MANIFEST, 1),
        ('scripts/test_lab_blockers_provenance.py', 'scripts/test_manual_unit_provenance.py', 1),
        ('exact-declared-lab-blockers-ui-delta', 'exact-declared-manual-unit-ui-delta', 1),
        ('c80a6728fe9e1769ca4e67fe794b8f0eedfb8627', REFERENCE, 1),
        ('complete c80-to-lab source seal', 'complete original-to-manual-unit cumulative source seal', 1),
        ('nine earlier seals', 'ten earlier seals', 1),
        ('laboratory UI deltas', 'manual-unit UI deltas', 1),
        ('实验室 UI', '手动数量 UI', 4),
    ):
        assert expected.count(old) == count, ('Exact UI baseline transition cardinality', old)
        expected = expected.replace(old, new)
    assert (ROOT / 'scripts/check-ui-baseline.mjs').read_bytes() == expected.encode(), 'Unapproved UI baseline checker drift'
    return before


def capture_worktree(db):
    def git(*args): return subprocess.check_output(['git', '-C',str(ROOT),*args])
    actual=git('diff','--name-only','--no-renames','--no-ext-diff','--no-textconv',REFERENCE,'--',*PRODUCTION_PATHS).decode().splitlines()
    extra=git('ls-files','--others','--exclude-standard','--',*PRODUCTION_PATHS).decode().splitlines()
    ignored=git('ls-files','--others','--ignored','--exclude-standard','--',*PRODUCTION_PATHS).decode().splitlines()
    assert not ignored and sorted(set(actual+extra))==list(CHANGED_PATHS), ('Unexpected production path or ignored source',actual,extra,ignored)
    ring=module()
    for path, expected in previous_manifests(ring):
        local=ROOT/path
        assert local.is_file() and not local.is_symlink() and not local.stat().st_mode&0o111
        assert digest(local.read_bytes())==expected and local.read_bytes()==db.git('show',REFERENCE+':'+path),path
    edits={}
    for path in CHANGED_PATHS:
        local=ROOT/path
        assert local.is_file() and not local.is_symlink() and not local.stat().st_mode&0o111,path
        edits[path]=('100644',local.read_bytes())
    candidate=db.make(REFERENCE,edits)
    return candidate,manifest_bytes(make_manifest(ring,db.git,candidate))


def build_worktree_manifest(destination):
    db=ObjectDatabase()
    try:
        _, raw=capture_worktree(db)
        Path(destination).write_bytes(raw)
        print(json.dumps({'path':str(destination),'sha256':digest(raw),'approvedSourceDeltaPaths':list(CHANGED_PATHS)}))
    finally: db.close()


def verify_ui_baseline():
    db=ObjectDatabase()
    try:
        candidate, expected=capture_worktree(db)
        raw=(ROOT/MANIFEST).read_bytes()
        assert raw==expected and digest(raw)==MANIFEST_SHA256,'Current production does not match frozen manual-unit seal'
        candidate=db.make(candidate,{MANIFEST:('100644',raw)})
        checks=[]
        def check(name, passed, detail=None):
            assert passed,name
            checks.append(name)
        result=manual_unit_provenance(ROOT,candidate,db.git,check)
        return {'contract':result['contract'],'sourceScope':'Exact current src/public bytes; disposable objects only',
                'sourceBaseline':REFERENCE,'manifestSha256':digest(raw),'checks':len(checks),
                'originalUiBaseline':result['manifest']['originalUiBaseline'],'approvedSourceDeltaPaths':list(CHANGED_PATHS)}
    finally: db.close()


def verify_candidate(candidate):
    def git(*args): return subprocess.check_output(['git','-C',str(ROOT),*args],stderr=subprocess.PIPE)
    candidate=git('rev-parse',candidate+'^{commit}').decode().strip()
    assert candidate != REFERENCE
    diagnostic = '1f66672f40556c61c4acfaeec23f1cb18c64636a'
    assert git('merge-base', diagnostic, candidate).decode().strip() == diagnostic, 'Exact diagnostic source ancestry is required independently of acceptance'
    for path in ('scripts/test_manual_unit_provenance.py','scripts/browser-ring-protection.py','scripts/check-ui-baseline.mjs',MANIFEST):
        assert (ROOT/path).read_bytes()==git('show',candidate+':'+path),('Executed seal differs from candidate',path)
    previous_ring_bytes()
    previous_ui_baseline_bytes()
    checks=[]
    def check(name, passed, detail=None):
        assert passed,name
        checks.append(name)
    result=manual_unit_provenance(ROOT,candidate,git,check)
    scope=['src','public',MANIFEST,*(path for path,_ in previous_manifests(module()))]
    assert git('diff','--name-only','--no-renames','--no-ext-diff','--no-textconv',candidate,'--',*scope)==b''
    for flags in ((),('--ignored',)):
        assert git('ls-files','--others',*flags,'--exclude-standard','--','src','public')==b''
    assert len(checks)>100
    return result


class ManualUnitSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.db=ObjectDatabase()
    @classmethod
    def tearDownClass(cls): cls.db.close()
    def setUp(self):
        global MANIFEST_SHA256
        self.original_digest=MANIFEST_SHA256
        self.ring=module(); self.git=self.db.git; self.make=self.db.make
        self.view=self.db.tmp/'manual-view'
        for path,_ in previous_manifests(self.ring):
            local=self.view/path; local.parent.mkdir(parents=True,exist_ok=True)
            local.write_bytes(self.git('show',REFERENCE+':'+path));local.chmod(0o644)
        self.edits={path:('100644',(self.git('show',REFERENCE+':'+path) if entry(self.git,REFERENCE,path) else b'')+b'\n/* exact synthetic manual unit delta */\n') for path in CHANGED_PATHS}
        provisional=self.make(REFERENCE,self.edits)
        self.manifest=make_manifest(self.ring,self.git,provisional)
        self.raw=manifest_bytes(self.manifest);MANIFEST_SHA256=digest(self.raw)
        local=self.view/MANIFEST;local.write_bytes(self.raw);local.chmod(0o644)
        self.candidate=self.make(provisional,{MANIFEST:('100644',self.raw)})
    def tearDown(self):
        global MANIFEST_SHA256
        MANIFEST_SHA256=self.original_digest
    def evaluate(self,candidate=None):
        def check(name,passed,detail=None): assert passed,name
        return manual_unit_provenance(self.view,candidate or self.candidate,self.git,check)
    def reject(self,candidate=None):
        with self.assertRaises((AssertionError,FileNotFoundError,subprocess.CalledProcessError)):self.evaluate(candidate)
    def repin(self,value):
        global MANIFEST_SHA256
        raw=manifest_bytes(value);MANIFEST_SHA256=digest(raw);(self.view/MANIFEST).write_bytes(raw)
        return self.make(self.candidate,{MANIFEST:('100644',raw)})
    def test_exact_delta_recursively_preserves_all_ten_prior_contracts(self):
        result=self.evaluate()
        self.assertEqual(result['contract'],'exact-declared-manual-unit-ui-delta')
        self.assertEqual(result['previousProvenance']['contract'],'exact-declared-lab-blockers-ui-delta')
        self.assertEqual(result['previousProvenance']['candidateSourceSha'],REFERENCE)
        self.assertEqual(len(result['manifest']['previousManifests']),10)
        self.assertIn('not native or CI acceptance',result['verificationScope'])
    def test_every_approved_file_bytes_modes_deletion_and_reversion_are_exact(self):
        for path,(mode,raw) in self.edits.items():
            for value in (('100644',raw+b' '),('100755',raw),None):
                with self.subTest(path=path,value=value):self.reject(self.make(self.candidate,{path:value}))
    def test_complete_production_tree_rejects_extra_files_and_domain_changes(self):
        for path in ('src/unknown.ts','src/ui/unknown.ts','src/game/unknown.ts','src/data/unknown.ts','src/core/unknown.ts','public/unknown.svg'):
            with self.subTest(path=path):self.reject(self.make(self.candidate,{path:('100644',b'extra')}))
        for path in ('src/game/save.ts','src/game/engine.ts','src/space.css','public/favicon-32.png','src/ui/lab-blockers-panel.ts'):
            if entry(self.git,REFERENCE,path):
                raw=self.git('show',REFERENCE+':'+path)
                self.reject(self.make(self.candidate,{path:('100644',raw+b' ')}))
    def test_every_manifest_field_and_all_exact_hunk_records_fail_closed_even_if_repinned(self):
        for key in self.manifest:
            value=copy.deepcopy(self.manifest);del value[key]
            self.reject(self.repin(value))
        for index in range(len(CHANGED_PATHS)):
            for key in ('before','after','patchSha256','hunks'):
                value=copy.deepcopy(self.manifest);value['changedPaths'][index][key]=({'mode':'100644','sha256':'0'*64} if value['changedPaths'][index][key] is None else None)
                self.reject(self.repin(value))
    def test_extra_manifest_fields_and_widened_scopes_fail_even_if_repinned(self):
        for mutate in (lambda x:x.update(extra=True),lambda x:x['productionPaths'].append('scripts'),
                       lambda x:x.update(exactDomainDeltaPaths=['src/game/save.ts']),
                       lambda x:x['originalUiBaseline']['exactDeltaPaths'].append('src/main.ts')):
            value=copy.deepcopy(self.manifest);mutate(value);self.reject(self.repin(value))
    def test_all_ten_historical_seals_preserve_committed_and_local_bytes(self):
        for path,_ in previous_manifests(self.ring):
            raw=self.git('show',REFERENCE+':'+path)
            self.reject(self.make(self.candidate,{path:('100644',raw+b' ')}))
            local=self.view/path;local.write_bytes(raw+b' ');self.reject();local.write_bytes(raw)
    def test_local_current_manifest_mutation_and_modes_fail_closed(self):
        local=self.view/MANIFEST
        local.write_bytes(self.raw+b' ');self.reject();local.write_bytes(self.raw)
        local.chmod(0o755);self.reject();local.chmod(0o644)
        self.reject(self.make(self.candidate,{MANIFEST:('100755',self.raw)}))
    def test_original_ui_hash_anchors_and_full_cumulative_patches_are_exact(self):
        value=copy.deepcopy(self.manifest)
        value['originalUiBaseline']['changedPaths'][0]['before']['sha256']='0'*64
        self.reject(self.repin(value))
    def test_new_manifest_does_not_project_unapproved_main_bytes_away(self):
        main=self.edits['src/main.ts'][1]
        self.reject(self.make(self.candidate,{'src/main.ts':('100644',main+b'paid authority bypass')}))
    def test_prior_9a_source_branch_still_evaluates_its_own_unmodified_lab_contract(self):
        def check(name,passed,detail=None):assert passed,name
        self.assertEqual(self.ring.synchronized_domain_provenance(self.view,REFERENCE,self.git,check)['contract'],'exact-declared-lab-blockers-ui-delta')
    def test_ring_source_only_adds_the_exact_provenance_dispatch(self): previous_ring_bytes()


class ManualUnitCommittedCandidateTests(unittest.TestCase):
    def test_actual_committed_candidate_matches_the_complete_frozen_source(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'],'exact-declared-manual-unit-ui-delta')


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--build-manifest':build_worktree_manifest(sys.argv[2])
    elif sys.argv[1:]==['--verify-ui-baseline']:print(json.dumps(verify_ui_baseline(),ensure_ascii=False,indent=2))
    else:
        if len(sys.argv)>=3 and sys.argv[1]=='--verify-candidate':CANDIDATE=sys.argv[2];del sys.argv[1:3]
        unittest.main()
