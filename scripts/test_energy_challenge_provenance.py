"""Exact r16 adoption on A, retaining every historical seal and assertion.

Python/Git only. Independent rows bind complete production files, modes, patches
and hunks. A finite support delta binds release/legacy adapters. Reproducing the
manifest cannot approve new source. Provenance never substitutes for native CI.
"""
import copy
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest
from unittest.mock import patch

import test_building_batch_provenance as batch
from test_lab_blockers_provenance import ObjectDatabase
import energy_challenge_source_pins as pins

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = pins.REFERENCE
MANIFEST = 'tests/fixtures/energy-challenge-provenance.json'
MANIFEST_SHA256 = pins.MANIFEST_SHA256
SCHEMA = 'infinity-ring-protection-energy-challenge-provenance-v1'
CONTRACT = 'exact-declared-energy-challenge-source-delta'
CANDIDATE = 'HEAD'
PRODUCTION_PATHS = ('src','public')
SUPPORT_AREAS = ('scripts','tests','.github','package.json','package-lock.json','tsconfig.json','vite.config.ts')
PIN_FILE = 'scripts/energy_challenge_source_pins.py'
EXCLUDED_SUPPORT = (MANIFEST, PIN_FILE)
CHANGED_PATHS = tuple(item['path'] for item in pins.APPROVED_ROWS)
SUPPORT_PATHS = tuple(item['path'] for item in pins.SUPPORT_ROWS)
changed,entry,row,manifest_bytes = batch.changed,batch.entry,batch.row,batch.manifest_bytes
ordinary_bytes,source_inventory,assert_worktree_inventory = batch.ordinary_bytes,batch.source_inventory,batch.assert_worktree_inventory
digest = batch.digest
git_read = batch.git_read
module = batch.module


def previous_manifests(ring):
    return [*batch.previous_manifests(ring),(batch.MANIFEST,batch.MANIFEST_SHA256)]


def approved_rows():
    assert re.fullmatch('[0-9a-f]{40}',REFERENCE) and pins.APPROVED_ROWS, 'Energy source is not frozen'
    assert CHANGED_PATHS == tuple(sorted(set(CHANGED_PATHS)))
    return copy.deepcopy(pins.APPROVED_ROWS)


def expected_inventory(git):
    inventory=source_inventory(git,REFERENCE)
    for item in approved_rows():
        if item['after'] is None: inventory.pop(item['path'])
        else: inventory[item['path']]=item['after']
    return dict(sorted(inventory.items()))


def manifest_fields(ring,git,rows,inventory):
    prior=json.loads(git('show',REFERENCE+':'+batch.MANIFEST))
    return {'schema':SCHEMA,'historicalBaselineSha':ring.BASELINE,'previousAdoptionSourceSha':REFERENCE,
      'previousManifests':[{'path':path,'sha256':sha} for path,sha in previous_manifests(ring)],
      'referenceStatus':'Exact A source is the immutable predecessor. Every prior source adoption is recursively checked without changing historical seals.',
      'scope':'Complete src/public inventory, file modes, bytes, deterministic patches and hunks. Support adapters have separate independently frozen finite rows. No file or directory exemption.',
      'approvedDelta':'Bounded energy-tightening-v1 production/proof scoring, explicit legal-curvature lifecycle, strict v9/r16 save consistency, active two-slot and receipted three-slot new admissions, and scoped native controls. No r15 adoption.',
      'productionPaths':list(PRODUCTION_PATHS),'domainPaths':list(ring.DOMAIN_PATHS),
      'originalRingCriticalPaths':list(ring.RING_CRITICAL_PATHS),
      'exactDomainDeltaPaths':[p for p in CHANGED_PATHS if any(p==d or p.startswith(d+'/') for d in ring.DOMAIN_PATHS)],
      'exactRingCriticalDeltaPaths':[p for p in CHANGED_PATHS if p in ring.RING_CRITICAL_PATHS],
      'productionInventory':inventory,'originalUiBaseline':prior['originalUiBaseline'],'changedPaths':rows}


def make_manifest(ring,git,candidate):
    assert changed(git,REFERENCE,candidate,PRODUCTION_PATHS)==list(CHANGED_PATHS), 'Only the exact approved r16 production paths may change'
    rows=[row(ring,git,REFERENCE,candidate,path) for path in CHANGED_PATHS]
    assert rows==approved_rows(), 'Energy file, mode, patch or hunk differs from independent reviewed pins'
    assert changed(git,REFERENCE,candidate,('public',))==[], 'All original public art remains unchanged'
    original=json.loads(git('show',REFERENCE+':'+batch.MANIFEST))['originalUiBaseline']
    manual=batch.research.fleet.recycle.manual
    assert original['changedPaths']==[row(ring,git,manual.ORIGINAL_UI_REFERENCE,candidate,path) for path in manual.ORIGINAL_UI_PATHS], 'Original cumulative UI rows must remain unchanged'
    inventory=source_inventory(git,candidate)
    assert inventory==expected_inventory(git), 'Undeclared production inventory, mode or bytes'
    return manifest_fields(ring,git,rows,inventory)


@lru_cache(maxsize=1)
def frozen_manifest_bytes():
    return manifest_bytes(manifest_fields(module(),git_read,approved_rows(),expected_inventory(git_read)))


def read_manifest(repository):
    raw=ordinary_bytes(repository/MANIFEST)
    assert re.fullmatch('[0-9a-f]{64}',MANIFEST_SHA256) and digest(raw)==MANIFEST_SHA256, 'Energy manifest must be the exact frozen seal'
    assert raw==frozen_manifest_bytes(), 'Repinning cannot approve changed manifest fields, inventory, files, patches or hunks'
    return raw,json.loads(raw)


@lru_cache(maxsize=None)
def historical_bytes(path):
    return git_read('show',REFERENCE+':'+path)


def support_row(path):
    rows=[item for item in pins.SUPPORT_ROWS if item['path']==path]
    assert len(rows)==1 and rows[0]['after'] is not None, ('Unsupported finite energy compatibility projection',path)
    return rows[0]


def project_bytes(path,current,repository=None):
    repository=ROOT if repository is None else repository
    read_manifest(repository)
    item=support_row(path)
    assert isinstance(current,bytes) and digest(current)==item['after']['sha256'], ('Unapproved energy support bytes',path)
    assert item['before']==entry(git_read,REFERENCE,path), ('Exact predecessor support identity required',path)
    assert item['before'] is not None, ('New support files cannot impersonate historical files',path)
    return historical_bytes(path)


def previous_bytes(path,repository=None):
    repository=ROOT if repository is None else repository
    return project_bytes(path,ordinary_bytes(repository/path),repository)


@lru_cache(maxsize=1)
def historical_support_inventory():
    result={}
    for record in git_read('ls-tree','-r','-z',REFERENCE,'--',*SUPPORT_AREAS).split(b'\0'):
        if not record:continue
        metadata,path=record.split(b'\t');mode,kind,_=metadata.decode().split();path=path.decode()
        assert kind=='blob' and mode=='100644', ('Ordinary historical support required',path)
        result[path]={'mode':mode,'sha256':digest(historical_bytes(path))}
    return result


def verify_support(repository,candidate=None,git=None):
    read_manifest(repository)
    assert SUPPORT_PATHS==tuple(sorted(set(SUPPORT_PATHS))) and pins.SUPPORT_ROWS
    for item in pins.SUPPORT_ROWS:
        raw=ordinary_bytes(repository/item['path'])
        assert item['after']=={'mode':'100644','sha256':digest(raw)}, ('Exact reviewed support file and mode required',item['path'])
    if candidate is not None:
        paths=[p for p in changed(git,REFERENCE,candidate,SUPPORT_AREAS) if p not in EXCLUDED_SUPPORT]
        assert paths==list(SUPPORT_PATHS), ('Only finite reviewed support delta is allowed',paths)
        for item in pins.SUPPORT_ROWS:
            assert row(module(),git,REFERENCE,candidate,item['path'])==item, ('Complete exact support patch and hunks required',item['path'])
    # Old support files and undeclared new files remain independently visible.
    expected=dict(historical_support_inventory())
    for item in pins.SUPPORT_ROWS:expected[item['path']]=item['after']
    for path in expected:
        if path in SUPPORT_PATHS or path in EXCLUDED_SUPPORT:continue
        assert ordinary_bytes(repository/path)==historical_bytes(path), ('Unchanged historical support source drift',path)
    actual=set()
    for area in SUPPORT_AREAS:
        root=repository/area
        if root.is_dir():
            for local in root.rglob('*'):
                relative=str(local.relative_to(repository))
                if '__pycache__' in local.parts or local.suffix=='.pyc':continue
                assert not local.is_symlink(), ('No support source symlink',relative)
                if local.is_file():actual.add(relative)
        else:actual.add(area)
    assert actual==set(expected)|set(EXCLUDED_SUPPORT), ('Complete support inventory required',sorted(actual-(set(expected)|set(EXCLUDED_SUPPORT))),sorted((set(expected)|set(EXCLUDED_SUPPORT))-actual))


def energy_challenge_provenance(repository,candidate,git,check):
    ring=module()
    check('Energy candidate integrates exact A predecessor',git('merge-base',REFERENCE,candidate).decode().strip()==REFERENCE)
    # Fail altered current seals/source early; successful verification still
    # executes every historical assertion exactly once.
    raw,value=read_manifest(repository)
    check('Energy manifest is the exact committed ordinary-file seal',entry(git,candidate,MANIFEST)=={'mode':'100644','sha256':MANIFEST_SHA256} and raw==git('show',candidate+':'+MANIFEST))
    check('Energy complete source bytes modes patches hunks and inventory match',value==make_manifest(ring,git,candidate))
    for path,sha in previous_manifests(ring):
        check('Energy preserves local and committed historical seal: '+path,
          digest(ordinary_bytes(repository/path))==sha and entry(git,candidate,path)==entry(git,REFERENCE,path)=={'mode':'100644','sha256':sha})
    prior=batch.building_batch_provenance(repository,REFERENCE,git,check)
    check('Energy retains every A and earlier source assertion',prior['contract']==batch.CONTRACT and prior['candidateSourceSha']==REFERENCE)
    return {'contract':CONTRACT,'historicalBaselineSha':ring.BASELINE,'historicalDomainByteIdentity':False,
      'previousAdoptionSourceSha':REFERENCE,'candidateSourceSha':candidate,'previousProvenance':prior,
      'historicalChangedPaths':changed(git,ring.BASELINE,candidate,ring.DOMAIN_PATHS),
      'manifestPath':MANIFEST,'manifestSha256':digest(raw),'manifest':value,
      'verificationScope':'Exact source provenance only; not native, CI, release or human-play acceptance.'}


def capture_worktree(db):
    assert_worktree_inventory(ROOT,expected_inventory(db.git))
    for path,sha in previous_manifests(module()):assert digest(ordinary_bytes(ROOT/path))==sha
    candidate=db.make(REFERENCE,{path:('100644',ordinary_bytes(ROOT/path)) for path in CHANGED_PATHS})
    raw=manifest_bytes(make_manifest(module(),db.git,candidate))
    return db.make(candidate,{MANIFEST:('100644',raw)}),raw


def verify_ui_baseline():
    db=ObjectDatabase()
    try:
        candidate,raw=capture_worktree(db)
        assert read_manifest(ROOT)[0]==raw
        verify_support(ROOT)
        checks=[]
        def check(name,passed,detail=None):
            assert passed,name
            checks.append(name)
        result=energy_challenge_provenance(ROOT,candidate,db.git,check)
        assert len(checks)>193
        return {'contract':CONTRACT,'sourceScope':'Complete current production inventory and finite support delta; disposable objects only',
          'sourceBaseline':REFERENCE,'manifestSha256':digest(raw),'checks':len(checks),
          'originalUiBaseline':result['manifest']['originalUiBaseline'],'approvedSourceDeltaPaths':list(CHANGED_PATHS),
          'productionEntries':len(result['manifest']['productionInventory']),'previousSeals':len(previous_manifests(module()))}
    finally:db.close()


def verify_previous_ui_baseline():
    current=verify_ui_baseline();raw,prior=batch.read_manifest(ROOT)
    return {'contract':batch.CONTRACT,'sourceScope':'Historical A projection after complete r16 source and support verification',
      'sourceBaseline':batch.REFERENCE,'manifestSha256':digest(raw),'checks':current['checks'],
      'originalUiBaseline':prior['originalUiBaseline'],'approvedSourceDeltaPaths':list(batch.CHANGED_PATHS),'currentAdoption':current}


def verify_candidate(candidate):
    candidate=git_read('rev-parse',candidate+'^{commit}').decode().strip()
    assert candidate!=REFERENCE
    assert_worktree_inventory(ROOT,source_inventory(git_read,candidate))
    verify_support(ROOT,candidate,git_read)
    for path in (PIN_FILE,'scripts/test_energy_challenge_provenance.py',MANIFEST):
        raw=ordinary_bytes(ROOT/path)
        assert entry(git_read,candidate,path)=={'mode':'100644','sha256':digest(raw)} and raw==git_read('show',candidate+':'+path), ('Executed verifier must equal committed candidate',path)
    checks=[]
    def check(name,passed,detail=None):
        assert passed,name
        checks.append(name)
    result=energy_challenge_provenance(ROOT,candidate,git_read,check)
    assert len(checks)>193
    return result


class EnergyChallengeSyntheticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.db=ObjectDatabase()
    @classmethod
    def tearDownClass(cls):cls.db.close()
    def setUp(self):
        self.view=self.db.tmp/'energy-view';self.view.mkdir(exist_ok=True)
        for path,_ in previous_manifests(module()):
            local=self.view/path;local.parent.mkdir(parents=True,exist_ok=True);local.write_bytes(historical_bytes(path));local.chmod(0o644)
        self.sources={path:ordinary_bytes(ROOT/path) for path in CHANGED_PATHS}
        self.provisional=self.db.make(REFERENCE,{path:('100644',raw) for path,raw in self.sources.items()})
        self.manifest=make_manifest(module(),self.db.git,self.provisional);self.raw=manifest_bytes(self.manifest)
        self.assertEqual(digest(self.raw),MANIFEST_SHA256)
        (self.view/MANIFEST).write_bytes(self.raw)
        self.candidate=self.db.make(self.provisional,{MANIFEST:('100644',self.raw)})
    def evaluate(self,candidate=None):
        def check(name,passed,detail=None):assert passed,name
        return module().synchronized_domain_provenance(self.view,candidate or self.candidate,self.db.git,check)
    def reject(self,candidate=None):
        with self.assertRaises((AssertionError,KeyError,FileNotFoundError,TypeError,subprocess.CalledProcessError)):self.evaluate(candidate)
    def test_exact_delta_retains_fifteen_immutable_seals(self):
        result=self.evaluate();self.assertEqual(result['contract'],CONTRACT)
        self.assertEqual(result['previousProvenance']['contract'],batch.CONTRACT)
        self.assertEqual(len(result['manifest']['previousManifests']),15)
        self.assertFalse(result['historicalDomainByteIdentity'])
    def test_every_source_rejects_changed_bytes_mode_symlink_deletion(self):
        for path,raw in self.sources.items():
            for mutation in [('100644',raw+b' '),('100755',raw),('120000',b'other.ts'),None]:
                with self.subTest(path=path,mutation=mutation):self.reject(self.db.make(self.candidate,{path:mutation}))
    def test_complete_inventory_rejects_unknown_or_unchanged_source_drift(self):
        for path in ('src/.unknown.ts','src/game/unknown.ts','public/unknown.svg','src/ui/view.ts','src/style.css','src/game/research.ts'):
            raw=self.db.git('show',REFERENCE+':'+path) if entry(self.db.git,REFERENCE,path) else b''
            self.reject(self.db.make(self.candidate,{path:('100644',raw+b' ')}))
    def test_manifest_repins_do_not_change_independent_rows(self):
        for key in self.manifest:
            changed=copy.deepcopy(self.manifest);del changed[key]
            raw=manifest_bytes(changed);(self.view/MANIFEST).write_bytes(raw)
            candidate=self.db.make(self.candidate,{MANIFEST:('100644',raw)})
            with patch(__name__+'.MANIFEST_SHA256',digest(raw)),patch('test_energy_challenge_provenance.MANIFEST_SHA256',digest(raw)):self.reject(candidate)
        (self.view/MANIFEST).write_bytes(self.raw)
        for path,raw in self.sources.items():
            with self.assertRaises(AssertionError):make_manifest(module(),self.db.git,self.db.make(self.candidate,{path:('100644',raw+b' ')}))
    def test_every_row_hunk_and_inventory_field_is_independently_frozen(self):
        values=[]
        for index,item in enumerate(self.manifest['changedPaths']):
            for field in ('path','before','after','patchSha256','hunks'):
                value=copy.deepcopy(self.manifest);value['changedPaths'][index][field]='altered';values.append(value)
            for h in range(len(item['hunks'])):
                for field in ('header','sha256'):
                    value=copy.deepcopy(self.manifest);value['changedPaths'][index]['hunks'][h][field]='altered';values.append(value)
        for mutate in (lambda v:v['productionInventory'].pop('src/main.ts'),
                       lambda v:v['previousManifests'].reverse(),lambda v:v['changedPaths'].reverse(),
                       lambda v:v.update(unknown=True)):
            value=copy.deepcopy(self.manifest);mutate(value);values.append(value)
        for value in values:
            raw=manifest_bytes(value);(self.view/MANIFEST).write_bytes(raw)
            candidate=self.db.make(self.candidate,{MANIFEST:('100644',raw)})
            with patch(__name__+'.MANIFEST_SHA256',digest(raw)),patch('test_energy_challenge_provenance.MANIFEST_SHA256',digest(raw)):self.reject(candidate)
        (self.view/MANIFEST).write_bytes(self.raw)
    def test_manifest_modes_symlinks_and_unrelated_ancestry_fail(self):
        for value in [('100755',self.raw),('120000',b'other.json'),None]:self.reject(self.db.make(self.candidate,{MANIFEST:value}))
        local=self.view/MANIFEST;local.chmod(0o755);self.reject();local.chmod(0o644)
        local.unlink();target=self.db.tmp/'energy-target';target.write_bytes(self.raw);local.symlink_to(target);self.reject()
        local.unlink();local.write_bytes(self.raw)
        tree=self.db.git('rev-parse',self.candidate+'^{tree}').decode().strip()
        self.reject(self.db.git('commit-tree',tree,input=b'Unrelated source\n').decode().strip())
    def test_every_prior_manifest_is_still_immutable(self):
        for path,_ in previous_manifests(module()):
            raw=historical_bytes(path)
            for value in [('100644',raw+b' '),('100755',raw),('120000',b'other.json'),None]:self.reject(self.db.make(self.candidate,{path:value}))
    def test_support_projection_rejects_any_nonapproved_byte(self):
        for item in pins.SUPPORT_ROWS:
            if item['before'] is None:continue
            path=item['path'];raw=ordinary_bytes(ROOT/path)
            self.assertEqual(project_bytes(path,raw),historical_bytes(path))
            for mutation in (raw+b'\n',raw.replace(b'\n',b'\r\n'),b'unknown'):
                with self.assertRaises(AssertionError):project_bytes(path,mutation)
        with self.assertRaises(AssertionError):project_bytes('src/game/save.ts',b'anything')


class EnergyChallengeCommittedCandidateTests(unittest.TestCase):
    def test_actual_candidate_matches_source_support_and_every_prior_seal(self):
        self.assertEqual(verify_candidate(CANDIDATE)['contract'],CONTRACT)


if __name__=='__main__':
    if sys.argv[1:]==['--verify-ui-baseline']:print(json.dumps(verify_ui_baseline(),ensure_ascii=False,indent=2))
    elif len(sys.argv)==3 and sys.argv[1]=='--build-manifest':
        db=ObjectDatabase()
        try:
            _,raw=capture_worktree(db);assert raw==frozen_manifest_bytes();Path(sys.argv[2]).write_bytes(raw)
        finally:db.close()
    else:
        if len(sys.argv)>=3 and sys.argv[1]=='--verify-candidate':CANDIDATE=sys.argv[2];del sys.argv[1:3]
        unittest.main()
