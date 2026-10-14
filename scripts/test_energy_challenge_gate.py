"""Exact eleven mandatory jobs; offline mutation checks are not native proof."""
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from energy_challenge_workflow import *
from test_parallel_legacy_gate_split import jobs

RELEASE_FILES = ('package.json','package-lock.json','scripts/browser-manual-unit-orders.py','scripts/browser-lab-blockers.py',
 'scripts/browser-rehearsal-formation-copy.py','scripts/browser-recycle-preview.py','scripts/manual_unit_census.py',
 'scripts/test_manual_unit_census.py','scripts/parallel-gate-identity.py','scripts/test_parallel_gate_identity.py',
 'scripts/scout_fixture_identity.py','scripts/test_scout_fixture_identity.py','scripts/test_lab_blockers_gate.py',
 'scripts/test_rehearsal_formation_copy_acceptance.py')


def ordinary(path):
    item=ROOT/path
    assert item.is_file() and not item.is_symlink() and not item.stat().st_mode&0o111, ('Ordinary exact source required',path)
    return item


def assert_gate(workflow):
    assert workflow==expected_workflow(), 'Unapproved energy eleven-job workflow drift'


def previous_workflow(workflow=None):
    from energy_challenge_solar_workflow import previous_workflow as solar_previous_workflow
    assert_gate(solar_previous_workflow(ordinary(WORKFLOW_PATH).read_bytes().decode()))
    if workflow is not None:assert_gate(workflow)
    from test_energy_challenge_provenance import previous_bytes, historical_bytes
    for path in RELEASE_FILES:
        # This entry always checks the actual current r16 release files before
        # returning immutable A bytes to historical callers. A complete revert
        # must not select an unchecked historical branch.
        assert previous_bytes(path)==historical_bytes(path)
    return original_workflow()


def previous_release_files():
    previous_workflow()
    from test_energy_challenge_provenance import historical_bytes
    return {path:historical_bytes(path) for path in RELEASE_FILES}


def previous_release_bytes(path):
    assert path in RELEASE_FILES
    return previous_release_files()[path]


class EnergyChallengeGateTests(unittest.TestCase):
    def setUp(self):
        from energy_challenge_solar_workflow import previous_workflow as solar_previous_workflow
        self.workflow=solar_previous_workflow(ordinary(WORKFLOW_PATH).read_bytes().decode());self.old=original_workflow()
    def reject(self,before,after):
        assert self.workflow.count(before)==1,before
        with self.assertRaises(AssertionError):assert_gate(self.workflow.replace(before,after,1))
    def test_exact_eleven_job_workflow_retains_all_eight_commands_and_budgets(self):
        assert_gate(self.workflow)
        current,old=jobs(self.workflow),jobs(self.old)
        self.assertEqual(tuple(current),(*OLD_JOBS,*NEW_JOBS,'required-gates'))
        for job in OLD_JOBS:self.assertEqual(current[job],adopted_old_job(job,old[job]),job)
        self.assertEqual(self.workflow.split('\njobs:\n')[0],self.old.split('\njobs:\n')[0])
        self.assertEqual(sum(COUNTS.values()),68)
        self.assertEqual(COUNTS,{'controls':18,'lifecycle':35,'migrations':15})
        self.assertEqual(BUDGETS,{'controls':420,'lifecycle':420,'migrations':240})
        for job,lane in JOB_LANES.items():
            self.assertIn('timeout-minutes: 15',current[job]);self.assertIn(f'--lane {lane}',current[job])
            self.assertIn(f'--kill-after=20s {BUDGETS[lane]}s',current[job])
    def test_old_job_adaptations_are_finite_and_current_revision_is_exact(self):
        current, old = jobs(self.workflow), jobs(self.old)
        for job in ('verify', 'verify-continuation', 'npc-orbital'):
            block = current[job]
            for changed in (ORBITAL_RELEASE_R14, ORBITAL_RELEASE_R16.replace('== 16', '>= 14'), 'pass'):
                self.reject(block, block.replace(ORBITAL_RELEASE_R16, changed, 1))
            for revision in (14, 15, 16, 17, '16', True):
                scope = {'expected':'a'*40, 'release':{'sourceSha':'a'*40,'saveVersion':9,'saveRevision':revision}}
                if revision == 16 and type(revision) is int:
                    exec(ORBITAL_RELEASE_R16, scope)
                else:
                    with self.assertRaises(AssertionError):exec(ORBITAL_RELEASE_R16, scope)
        block = current['scout-rehearsal']
        for before, after in ((SCOUT_PRODUCER_R16, SCOUT_PRODUCER_R14),
                ('raw = project_bytes(generated[path_key], raw, repository=repo)', 'pass'),
                ('assert hashlib.sha256(raw).hexdigest() == generated[hash_key]', 'pass')):
            self.reject(block, block.replace(before, after, 1))
        # Even a single unrelated old assertion or old command cannot be removed.
        for job in OLD_JOBS:
            block = current[job]
            command = next(line for line in block.splitlines(True) if line.lstrip().startswith('python '))
            self.reject(block, block.replace(command, '', 1))

    def test_energy_checkers_receive_directories_but_plan_receives_original_files(self):
        for job, lane in JOB_LANES.items():
            block = job_block(job, lane)
            for before, after in (
                ('--fixture energy-natural --require-clean', '--fixture energy-natural/report.json --require-clean'),
                ('--fixture energy-supplements --require-clean', '--fixture energy-supplements/manifest.json --require-clean'),
                ('--natural energy-natural/report.json', '--natural energy-natural'),
                ('--supplements energy-supplements/manifest.json', '--supplements energy-supplements')):
                self.reject(block, block.replace(before, after, 1))

    def test_current_demolition_report_records_actual_serializer_revision(self):
        source = ordinary('scripts/demolition-natural-growth.ts').read_text()
        self.assertIn('import { SAVE_REVISION, SAVE_SCHEMA, SAVE_VERSION }', source)
        self.assertIn('m.save.revision === 10 && SAVE_REVISION === 16', source)
        self.assertIn('sourceRevision: 10, targetRevision: SAVE_REVISION', source)
        self.assertNotIn('sourceRevision: 10, targetRevision: 14', source)

    def test_all_new_job_and_aggregate_commands_are_mandatory_and_exact(self):
        for block in [*(job_block(j,l) for j,l in JOB_LANES.items()),AGGREGATE_ADDITION]:
            self.reject(block,'');self.reject(block,block*2)
            lines=block.splitlines(keepends=True)
            for index,line in enumerate(lines):
                if not line.strip():continue
                for replacement in ('',line*2):self.reject(block,''.join([*lines[:index],replacement,*lines[index+1:]]))
                if line.lstrip().startswith(('python ','node ','timeout ','test ','(cd ')):
                    self.reject(block,''.join([*lines[:index],line.rstrip()+' || true\n',*lines[index+1:]]))
        self.assertNotIn('continue-on-error',self.workflow)
    def test_cannot_change_budget_checkout_runtime_fixture_or_raw_artifact_source(self):
        for job,lane in JOB_LANES.items():
            block=job_block(job,lane)
            for before,after in [('timeout-minutes: 15','timeout-minutes: 16'),('node-version: 22','node-version: 24'),
                ('persist-credentials: false','persist-credentials: true'),('fetch-depth: 0','fetch-depth: 1'),
                ('--require-clean','--allow-dirty'),(f'{BUDGETS[lane]}s',f'{BUDGETS[lane]+1}s')]:
                self.reject(block,block.replace(before,after,1))
        with self.assertRaises(AssertionError):assert_gate(self.workflow+'  optional:\n    runs-on: ubuntu-latest\n')
    def test_actual_aggregate_rejects_every_failure_missing_extra_or_identity_drift(self):
        from test_manual_unit_gate import aggregate_code
        values={name:{'result':'success','outputs':{'common-identity-sha256':'a'*64}} for name in (*OLD_JOBS,*NEW_JOBS)}
        for name in OLD_JOBS[:3]:values[name]['outputs']['orbital-identity-sha256']='b'*64
        values['scout-rehearsal']['outputs']['scout-fixture-sha256']='c'*64
        code=compile(aggregate_code(self.workflow),'<actual-eleven-jobs>','exec')
        def run(value):
            with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(value)}),contextlib.redirect_stdout(io.StringIO()):exec(code,{})
        run(values)
        for name in values:
            for status in ('failure','cancelled','skipped','in_progress','',None):
                bad=copy.deepcopy(values);bad[name]['result']=status
                with self.assertRaises(AssertionError):run(bad)
            bad=copy.deepcopy(values);del bad[name]
            with self.assertRaises(AssertionError):run(bad)
            for digest in ('','d'*64,'g'*64):
                bad=copy.deepcopy(values);bad[name]['outputs']['common-identity-sha256']=digest
                with self.assertRaises(AssertionError):run(bad)
        bad=copy.deepcopy(values);bad['unexpected']=copy.deepcopy(values[NEW_JOBS[0]])
        with self.assertRaises(AssertionError):run(bad)

class EnergyReleaseProjectionTests(unittest.TestCase):
    def test_exact_projection_and_every_current_release_byte_remains_checked(self):
        self.assertEqual(previous_workflow(),original_workflow())
        original=Path.read_bytes
        for path in RELEASE_FILES:
            target=ROOT/path;raw=original(target)
            self.assertIn(VERSION.encode(),raw,path)
            for altered in (raw+b'\n',raw.replace(VERSION.encode(),OLD_VERSION.encode(),1)):
                def read(local):return altered if local==target else original(local)
                with self.subTest(path=path),patch.object(Path,'read_bytes',read),self.assertRaises(AssertionError):previous_workflow()
        self.assertRaises(AssertionError,previous_release_bytes,'src/game/save.ts')

if __name__=='__main__':unittest.main()
