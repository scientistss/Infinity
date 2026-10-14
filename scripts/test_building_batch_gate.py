"""Exact additive multi-planet building job and release projection.

All seven published jobs retain every command and observation budget. The new
same-SHA eighth job is mandatory; raw-artifact census is independently rebuilt.
These offline contracts are not functional, native, or release acceptance.
"""
from functools import lru_cache
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import unittest
from unittest.mock import patch
from test_parallel_legacy_gate_split import WORKFLOW_PATH, jobs, steps
from building_batch_workflow import BUILDING_BATCH_JOB, AGGREGATE_ADDITION

ROOT = Path(__file__).resolve().parents[1]
BASE_SHA = '6f73735534ffc1b0e47a01935d8c6e3ff786c989'
BASE_WORKFLOW_SHA256 = '89796dfddafb55cfc29f8430492a8db3e24b3852595e6d2fca9389413974fdb0'
OLD_VERSION = '0.6.30-alpha.1'
VERSION = '0.6.31-alpha.1'
RELEASE_FILES = {'package.json':1, 'package-lock.json':2,
    'scripts/browser-manual-unit-orders.py':1, 'scripts/browser-lab-blockers.py':1,
    'scripts/browser-rehearsal-formation-copy.py':1, 'scripts/browser-recycle-preview.py':1,
    'scripts/manual_unit_census.py':2, 'scripts/test_manual_unit_census.py':2,
    'scripts/parallel-gate-identity.py':1, 'scripts/test_parallel_gate_identity.py':1,
    'scripts/scout_fixture_identity.py':2, 'scripts/test_scout_fixture_identity.py':2,
    'scripts/test_lab_blockers_gate.py':1, 'scripts/test_rehearsal_formation_copy_acceptance.py':3}
BUDGETS = {'verify':45,'verify-continuation':45,'npc-orbital':25,'scout-rehearsal':25,
    'lab-blockers':15,'manual-unit-payments':15,'manual-unit-authority':15,
    'building-batch':15,'required-gates':2}
AGGREGATE_TRANSITIONS = (
    ('    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-payments, manual-unit-authority]\n',
     '    needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-payments, manual-unit-authority, building-batch]\n'),
    ('Require all seven jobs and exact source asset runtime and fixture identities',
     'Require all eight jobs and exact source asset runtime and fixture identities'),
    ("'manual-unit-authority'}, jobs", "'manual-unit-authority', 'building-batch'}, jobs"),
)

def sha(raw): return hashlib.sha256(raw).hexdigest()

@lru_cache(maxsize=32)
def baseline_blob(repository, reference, path):
    assert str(Path(repository).resolve()) == repository
    assert reference == BASE_SHA and re.fullmatch('[0-9a-f]{40}',reference)
    assert path == WORKFLOW_PATH or path in RELEASE_FILES
    git=['git','--no-replace-objects','-C',repository]
    oid=subprocess.check_output([*git,'rev-parse','--verify',reference+':'+path]).decode().strip()
    assert re.fullmatch('[0-9a-f]{40}',oid)
    raw=subprocess.check_output([*git,'cat-file','blob',oid])
    assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==oid
    return raw

def baseline_bytes(path):
    assert path == WORKFLOW_PATH or path in RELEASE_FILES
    return baseline_blob(str(ROOT.resolve()),BASE_SHA,path)

def baseline_workflow():
    raw=baseline_bytes(WORKFLOW_PATH)
    assert sha(raw)==BASE_WORKFLOW_SHA256,'Pinned public research-copy workflow drift'
    return raw.decode()

def exact(body, old, new):
    assert old != new and body.count(old)==1 and new not in body,old
    return body.replace(old,new,1)

def expected_workflow(baseline):
    assert sha(baseline.encode())==BASE_WORKFLOW_SHA256
    assert baseline.count(OLD_VERSION)==7
    expected=baseline.replace(OLD_VERSION,VERSION)
    expected=exact(expected,'  required-gates:\n',BUILDING_BATCH_JOB+'\n  required-gates:\n')
    for before,after in AGGREGATE_TRANSITIONS: expected=exact(expected,before,after)
    return expected+AGGREGATE_ADDITION

def ordinary(path):
    item=ROOT/path
    assert item.is_file() and not item.is_symlink() and not item.stat().st_mode&0o111,('Expected ordinary batch release source',path)
    return item

def assert_gate(workflow,baseline):
    assert workflow==expected_workflow(baseline),'Unapproved building-batch eight-job workflow drift'

def assert_release_transitions():
    from test_energy_challenge_gate import previous_release_files
    projected = previous_release_files()
    for path,count in RELEASE_FILES.items():
        before=baseline_bytes(path)
        assert before.count(OLD_VERSION.encode())==count,(path,'historical literal count')
        assert projected[path]==before.replace(OLD_VERSION.encode(),VERSION.encode()),('Exact batch release-only transition',path)

def previous_workflow(workflow=None):
    baseline=baseline_workflow()
    from test_energy_challenge_gate import previous_workflow as successor_workflow
    assert_gate(successor_workflow(),baseline)
    if workflow is not None: assert_gate(workflow,baseline)
    assert_release_transitions()
    return baseline

def previous_release_bytes(path):
    assert path in RELEASE_FILES
    previous_workflow()
    return baseline_bytes(path)

def previous_release_files():
    previous_workflow()
    return {path:baseline_bytes(path) for path in RELEASE_FILES}

class BuildingBatchGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_energy_challenge_gate import previous_workflow as successor_workflow
        cls.workflow=successor_workflow();cls.baseline=baseline_workflow()
        cls.current=jobs(cls.workflow);cls.old=jobs(cls.baseline)

    def reject(self,before,after):
        self.assertEqual(self.workflow.count(before),1)
        changed=self.workflow.replace(before,after,1);self.assertNotEqual(changed,self.workflow)
        with self.assertRaises(AssertionError): previous_workflow(changed)

    def test_complete_eight_job_workflow_release_and_original_projection(self):
        self.assertEqual(previous_workflow(),self.baseline)
        self.assertEqual(previous_workflow(self.workflow),self.baseline)
        self.assertEqual(self.workflow,expected_workflow(self.baseline))
        self.assertEqual(tuple(self.current),tuple(BUDGETS))
        for name in self.old:
            if name!='required-gates':self.assertEqual(self.current[name],self.old[name].replace(OLD_VERSION,VERSION),name)
        self.assertEqual(previous_release_files(),{p:baseline_bytes(p) for p in RELEASE_FILES})
        for path in RELEASE_FILES:self.assertEqual(previous_release_bytes(path),baseline_bytes(path))
        self.assertEqual(self.workflow.split('\njobs:\n')[0],self.baseline.split('\njobs:\n')[0])

    def test_every_job_budget_identity_checkout_and_required_membership_stays_mandatory(self):
        for name,minutes in BUDGETS.items():
            block='  '+name+':\n'+self.current[name]
            self.assertIn(f'    timeout-minutes: {minutes}\n',block)
            for altered in ('',block*2,block.replace(f'timeout-minutes: {minutes}',f'timeout-minutes: {minutes+1}',1),
                            block.replace('    runs-on:','    continue-on-error: true\n    runs-on:',1),
                            block.replace('    runs-on:','    if: false\n    runs-on:',1)):
                self.reject(block,altered)
        self.assertNotIn('continue-on-error',self.workflow)
        self.reject(BUILDING_BATCH_JOB,BUILDING_BATCH_JOB.replace('node-version: 22','node-version: 24',1))
        self.reject(BUILDING_BATCH_JOB,BUILDING_BATCH_JOB.replace('persist-credentials: false','persist-credentials: true',1))
        with self.assertRaises(AssertionError):previous_workflow(self.workflow+'  extra:\n    runs-on: ubuntu-latest\n')

    def test_each_new_preparation_native_census_artifact_command_is_exact_and_unmasked(self):
        for block in (BUILDING_BATCH_JOB,AGGREGATE_ADDITION):
            self.assertEqual(self.workflow.count(block),1)
            self.reject(block,'');self.reject(block,block*2)
            lines=block.splitlines(keepends=True)
            for index,line in enumerate(lines):
                if not line.strip():continue
                for replacement in ('',line*2):
                    self.reject(block,''.join([*lines[:index],replacement,*lines[index+1:]]))
                if line.startswith('          ') and line.lstrip().startswith(('python ','node ','test ','timeout ','(cd ')):
                    self.reject(block,''.join([*lines[:index],line.rstrip('\n')+' || true\n',*lines[index+1:]]))
        for duration in ('659s','661s','900s'):
            self.reject(BUILDING_BATCH_JOB,BUILDING_BATCH_JOB.replace('660s',duration,1))
        self.assertIn('--require-clean --check-current-source --mutation-self-test',BUILDING_BATCH_JOB)
        self.assertIn('building_batch_census.py aggregate',AGGREGATE_ADDITION)

    def test_release_dependency_or_unknown_byte_changes_refuse_all_historical_projections(self):
        original=Path.read_bytes
        for path in (WORKFLOW_PATH,*RELEASE_FILES):
            target=ROOT/path;before=original(target)
            for altered in (before+b'\n',before.replace(VERSION.encode(),b'0.6.31-alpha.2',1)):
                if altered==before:continue
                def read(p):return altered if p==target else original(p)
                with self.subTest(path=path),patch.object(Path,'read_bytes',read),self.assertRaises(AssertionError):previous_workflow()
        self.assertRaises(AssertionError,previous_release_bytes,'src/game/save.ts')

    def test_actual_eight_job_aggregate_refuses_fail_skip_cancel_missing_extra_and_bad_identity(self):
        from test_manual_unit_gate import aggregate_code
        names=tuple(n for n in BUDGETS if n!='required-gates')
        value={n:{'result':'success','outputs':{'common-identity-sha256':'a'*64}} for n in names}
        for n in ('verify','verify-continuation','npc-orbital'):value[n]['outputs']['orbital-identity-sha256']='b'*64
        value['scout-rehearsal']['outputs']['scout-fixture-sha256']='c'*64
        code=compile(aggregate_code(self.workflow),'<actual-eight-job-required-gates>','exec')
        def run(v):
            with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(v)}),contextlib.redirect_stdout(io.StringIO()):exec(code,{})
        run(value)
        for name in names:
            for status in ('failure','cancelled','skipped','in_progress','',None):
                bad=copy.deepcopy(value);bad[name]['result']=status
                with self.assertRaises(AssertionError):run(bad)
            bad=copy.deepcopy(value);del bad[name]
            with self.assertRaises(AssertionError):run(bad)
            for digest in ('','d'*64,'g'*64):
                bad=copy.deepcopy(value);bad[name]['outputs']['common-identity-sha256']=digest
                with self.assertRaises(AssertionError):run(bad)
        bad=copy.deepcopy(value);bad['unexpected']=copy.deepcopy(value['building-batch'])
        with self.assertRaises(AssertionError):run(bad)

if __name__=='__main__':unittest.main()
