"""Finite additive solar wiring and immutable complete legacy-record projection."""
import contextlib
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import textwrap
import tempfile
import types
import unittest
from unittest.mock import patch

import energy_challenge_solar_workflow as wiring
import energy_challenge_solar_aggregate as census
from energy_challenge_census import canonical, sha
from test_parallel_legacy_gate_split import jobs

ROOT=Path(__file__).resolve().parents[1]


def job_results():
    result={name:{'result':'success','outputs':{'common-identity-sha256':'a'*64,'untouched':name+'\nvalue'}} for name in census.REQUIRED_JOBS}
    for name in ('verify','verify-continuation','npc-orbital'):result[name]['outputs']['orbital-identity-sha256']='b'*64
    result['scout-rehearsal']['outputs']['scout-fixture-sha256']='c'*64
    return result


class SolarWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before=wiring.original_workflow()
        cls.current=(ROOT/wiring.WORKFLOW_PATH).read_bytes().decode()

    def reject(self,before,after):
        assert self.current.count(before)==1,before
        with self.assertRaises(AssertionError):wiring.assert_workflow(self.current.replace(before,after,1),self.before)

    def test_ten_worker_blocks_and_exact_lab_import_fix_preserve_all_commands_and_budgets(self):
        wiring.assert_workflow(self.current,self.before)
        old,new=jobs(self.before),jobs(self.current)
        self.assertEqual(tuple(new),(*census.REQUIRED_JOBS,'required-gates'))
        for name in census.LEGACY_JOBS:
            expected=old[name]
            if name=='verify':
                anchor="          python -m unittest discover -s scripts -p 'test_research_unlock_copy_browser.py' -v\n"
                command="          python -m unittest discover -s scripts -p 'test_energy_verified_input.py' -v\n"
                self.assertEqual(expected.count(anchor),1)
                expected=wiring.exact(expected,anchor,anchor+command)
            if name=='lab-blockers':
                before="          import importlib.util\n          from pathlib import Path\n"
                after="          import importlib.util, sys\n          from pathlib import Path\n          sys.path.insert(0, str(Path('scripts').resolve()))\n"
                self.assertEqual(expected.count(before),1)
                expected=expected.replace(before,after,1)
            self.assertEqual(new[name],expected,name)
        self.assertEqual(self.current.split('\njobs:\n')[0],self.before.split('\njobs:\n')[0])
        self.assertEqual(wiring.previous_workflow(),self.before)
        self.assertEqual(new['required-gates'].count('JOB_RESULTS: ${{ steps.legacy_job_results.outputs.jobs }}'),3)
        self.assertIn('timeout-minutes: 2',new['required-gates'])

    def test_sealed_input_command_is_unique_mandatory_and_stays_in_verify(self):
        command="          python -m unittest discover -s scripts -p 'test_energy_verified_input.py' -v\n"
        self.assertEqual(self.current.count(command),1)
        self.reject(command,'')
        self.reject(command,command*2)
        self.reject(command,command.rstrip()+' || true\n')
        current=jobs(self.current)
        self.assertEqual(current['verify'].count(command),1)
        continuation=current['verify-continuation']
        anchor='        run: |\n'
        offset=continuation.index(anchor)+len(anchor)
        altered=continuation[:offset]+command+continuation[offset:]
        moved=self.current.replace(command,'',1).replace(continuation,altered,1)
        with self.assertRaises(AssertionError):wiring.assert_workflow(moved,self.before)

    def test_exact_lab_path_fix_cannot_disappear_duplicate_or_change_source(self):
        self.reject(wiring.LAB_IMPORT_AFTER,wiring.LAB_IMPORT_BEFORE)
        self.reject(wiring.LAB_IMPORT_AFTER,wiring.LAB_IMPORT_AFTER*2)
        self.reject(wiring.LAB_IMPORT_AFTER,wiring.LAB_IMPORT_AFTER.replace("Path('scripts')","Path('other')"))
        self.assertIn('1acb454d5a8bffcefa680d6bcb091ea4014a4bf4621c44eb157deef2053e3f2d',self.current)

    def test_exact_current_entry_rejects_whole_eleven_job_reversion_and_any_byte(self):
        original=Path.read_bytes;target=ROOT/wiring.WORKFLOW_PATH
        for raw in (self.before.encode(),self.current.encode()+b'\n',self.current.replace('\n','\r\n').encode()):
            def read(path):return raw if path==target else original(path)
            with patch.object(Path,'read_bytes',read),self.assertRaises(AssertionError):wiring.previous_workflow()
        for bad in (self.before+'\n',self.before.replace('\n','\r\n')):
            with self.assertRaises(AssertionError):wiring.expected_workflow(bad)

    def test_current_entry_preserves_the_ordinary_mode_and_symlink_guards(self):
        target=ROOT/wiring.WORKFLOW_PATH
        original=Path.is_symlink
        def symlink(path):return path==target or original(path)
        with patch.object(Path,'is_symlink',symlink),self.assertRaises(AssertionError):wiring.previous_workflow()
        original_stat=Path.stat
        def executable(path,*args,**kwargs):
            value=original_stat(path,*args,**kwargs)
            if path==target:return os.stat_result((value.st_mode|0o111,*tuple(value)[1:]))
            return value
        with patch.object(Path,'stat',executable),self.assertRaises(AssertionError):wiring.previous_workflow()

    def test_every_new_step_line_is_mandatory_and_no_optional_or_softened_command_is_allowed(self):
        for block in (wiring.SOLAR_JOB,wiring.LEGACY_JOB_PROJECTION,wiring.SOLAR_AGGREGATE_ADDITION):
            self.reject(block,'');self.reject(block,block*2)
            lines=block.splitlines(keepends=True)
            for index,line in enumerate(lines):
                if not line.strip():continue
                for changed in ('',line*2):self.reject(block,''.join([*lines[:index],changed,*lines[index+1:]]))
                if line.lstrip().startswith(('python ','node ','timeout ','test ','(cd ','run: ')):
                    self.reject(block,''.join([*lines[:index],line.rstrip()+' || true\n',*lines[index+1:]]))
        self.assertNotIn('continue-on-error',self.current)

    def test_new_budget_source_runtime_and_raw_artifact_choices_are_exact(self):
        for old,new in (('timeout-minutes: 15','timeout-minutes: 16'),('node-version: 22','node-version: 24'),
                        ('persist-credentials: false','persist-credentials: true'),('fetch-depth: 0','fetch-depth: 1'),
                        ('--kill-after=20s 600s','--kill-after=5s 660s'),('--require-clean','--allow-dirty'),
                        ('--natural energy-natural','--natural energy-natural/report.json')):
            self.reject(wiring.SOLAR_JOB,wiring.SOLAR_JOB.replace(old,new,1))
        self.reject(wiring.LEGACY_JOB_PROJECTION,wiring.LEGACY_JOB_PROJECTION.replace('project-legacy-jobs','true',1))
        self.reject('energy-controls, energy-lifecycle, energy-migration, energy-solar-route]',
                    'energy-controls, energy-lifecycle, energy-migration]')

    def test_original_aggregate_scripts_and_all_original_commands_survive_exact_projection(self):
        old,new=jobs(self.before)['required-gates'],jobs(self.current)['required-gates']
        for line in old.splitlines():
            if line.strip().startswith(('run: python ','python ')):
                self.assertIn(line,new)
        for command in ('python scripts/manual_unit_census.py aggregate','python scripts/building_batch_census.py aggregate',
                        'python scripts/energy_challenge_census.py --expected-sha'):
            exact='          JOB_RESULTS: ${{ steps.legacy_job_results.outputs.jobs }}\n        run: '+command
            self.assertEqual(new.count(exact),1)
            self.reject(exact,exact.replace('steps.legacy_job_results.outputs.jobs','toJSON(needs)',1))

    def test_actual_twelve_job_inline_aggregate_refuses_failures_extra_missing_and_identity_drift(self):
        from test_manual_unit_gate import aggregate_code
        code=compile(aggregate_code(self.current),'<actual-twelve-job-aggregate>','exec')
        def run(value):
            with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(value)}),contextlib.redirect_stdout(io.StringIO()):exec(code,{})
        good=job_results();run(good)
        for name in census.REQUIRED_JOBS:
            for result in ('failure','cancelled','skipped','in_progress','',None):
                bad=deepcopy(good);bad[name]['result']=result
                with self.assertRaises(AssertionError):run(bad)
            bad=deepcopy(good);del bad[name]
            with self.assertRaises(AssertionError):run(bad)
            bad=deepcopy(good);bad[name]['outputs']['common-identity-sha256']='d'*64
            with self.assertRaises(AssertionError):run(bad)
        bad=deepcopy(good);bad['extra']=deepcopy(good[census.SOLAR_JOB])
        with self.assertRaises(AssertionError):run(bad)


class SolarJobProjectionTests(unittest.TestCase):
    def test_twelve_successful_inputs_expose_exact_complete_original_records_without_aliasing(self):
        value=job_results();before=deepcopy(value)
        projected=census.project_legacy_jobs(value)
        self.assertEqual(value,before)
        self.assertEqual(projected,{name:before[name] for name in census.LEGACY_JOBS})
        self.assertEqual(tuple(projected),census.LEGACY_JOBS)
        projected['verify']['outputs']['untouched']='modified copy'
        self.assertEqual(value,before)

    def test_every_job_status_missing_extra_identity_and_record_shape_fails_closed(self):
        good=job_results()
        for name in census.REQUIRED_JOBS:
            for status in ('failure','cancelled','skipped','in_progress','',None,True):
                value=deepcopy(good);value[name]['result']=status
                with self.assertRaises(AssertionError):census.project_legacy_jobs(value)
            value=deepcopy(good);del value[name]
            with self.assertRaises(AssertionError):census.project_legacy_jobs(value)
            for digest in ('','g'*64,'A'*64,'d'*64,None,True):
                value=deepcopy(good);value[name]['outputs']['common-identity-sha256']=digest
                with self.assertRaises(AssertionError):census.project_legacy_jobs(value)
            value=deepcopy(good);value[name]['extra']='hidden'
            with self.assertRaises(AssertionError):census.project_legacy_jobs(value)
        value=deepcopy(good);value['extra']=deepcopy(good[census.SOLAR_JOB])
        with self.assertRaises(AssertionError):census.project_legacy_jobs(value)
        with self.assertRaises(AssertionError):census.project_legacy_jobs({n:good[n] for n in census.LEGACY_JOBS})

    def test_cli_projection_outputs_one_canonical_json_line_with_all_original_values(self):
        value=job_results();output=io.StringIO()
        with patch.dict(os.environ,{'JOB_RESULTS':json.dumps(value)}),contextlib.redirect_stdout(output):
            census.main(['project-legacy-jobs'])
        self.assertEqual(len(output.getvalue().splitlines()),1)
        self.assertEqual(json.loads(output.getvalue()),{name:value[name] for name in census.LEGACY_JOBS})


    def test_actual_projection_shell_propagates_python_failure_before_any_github_output(self):
        script=textwrap.dedent(wiring.LEGACY_JOB_PROJECTION.split('        run: |\n',1)[1])
        with tempfile.TemporaryDirectory(prefix='solar-job-projection-') as tmp:
            output=Path(tmp)/'outputs';value=job_results()
            env={**os.environ,'JOB_RESULTS':json.dumps(value),'GITHUB_OUTPUT':str(output)}
            result=subprocess.run(['bash','-e','-c',script],cwd=ROOT,env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(output.read_text().removeprefix('jobs=')),census.project_legacy_jobs(value))
            output.unlink();del value[census.SOLAR_JOB];env['JOB_RESULTS']=json.dumps(value)
            result=subprocess.run(['bash','-e','-c',script],cwd=ROOT,env=env,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(output.exists())


class SolarAggregateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='solar-aggregate-contract-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.artifact=self.root/'solar';self.artifact.mkdir()
        self.expected='1'*40;self.jobs=job_results()
        self.solar={'schema':census.SOLAR_SCHEMA,'sourceSha':self.expected,'runId':'solar-run',
                    'caseCount':1,'caseId':census.SOLAR_CASE,'commonIdentitySha256':'a'*64,'sealSha256':'e'*64,
                    'documentCount':23,'documentIds':['solar-'+str(i) for i in range(23)]}
        self.old={'schema':'infinity-energy-challenge-native-aggregate-v1','sourceSha':self.expected,'caseCount':68,'lanes':[]}
        for name,lane,count in zip(('energy-controls','energy-lifecycle','energy-migration'),('controls','lifecycle','migrations'),(18,35,15)):
            row={'lane':lane,'sourceSha':self.expected,'caseCount':count,'commonIdentitySha256':'a'*64,
                 'runId':lane+'-run','documentIds':[lane+'-document']}
            self.old['lanes'].append(row)
            self.jobs[name]['outputs'].update({'energy-census-sha256':sha(canonical(row)),'energy-case-count':str(count)})
        self.jobs[census.SOLAR_JOB]['outputs'].update({'energy-solar-census-sha256':sha(canonical(self.solar)),'energy-solar-case-count':'1'})
        self.energy=self.root/'energy-aggregate-census.json';self.write_claims()

    def write_claims(self):
        (self.artifact/'energy-solar-census.json').write_bytes(canonical(self.solar))
        self.energy.write_bytes(canonical(self.old))

    def run_aggregate(self,solar=None):
        calls=[]
        def validate(directory,expected):
            calls.append((directory,expected));return deepcopy(self.solar if solar is None else solar)
        with patch.dict(sys.modules,{'energy_challenge_solar_census':types.SimpleNamespace(validate=validate)}):
            value=census.aggregate(self.artifact,self.energy,self.expected,self.jobs)
        self.assertEqual(calls,[(self.artifact/'energy-solar-evidence',self.expected)])
        return value

    def test_solar_originals_reopened_and_original_68_census_kept_separate(self):
        value=self.run_aggregate()
        self.assertEqual(value['mandatoryJobCount'],12);self.assertEqual(value['originalEnergyCaseCount'],68)
        self.assertEqual(value['solar'],self.solar)

    def test_new_raw_census_outputs_and_document_reuse_are_rejected(self):
        for key,value in [('sourceSha','2'*40),('caseCount',2),('caseCount',True),('caseId','other'),
                          ('runId','controls-run'),('documentCount',22),('documentIds',['solar-0']*23),
                          ('documentIds',['controls-document']+self.solar['documentIds'][1:])]:
            old=deepcopy(self.solar);self.solar[key]=value;self.write_claims()
            self.jobs[census.SOLAR_JOB]['outputs']['energy-solar-census-sha256']=sha(canonical(self.solar))
            with self.subTest(key=key),self.assertRaises(AssertionError):self.run_aggregate()
            self.solar=old
        self.write_claims()
        self.jobs[census.SOLAR_JOB]['outputs']['energy-solar-census-sha256']=sha(canonical(self.solar))
        bad=deepcopy(self.solar);bad['sealSha256']='f'*64
        with self.assertRaises(AssertionError):self.run_aggregate(bad)
        for key,value in [('energy-solar-census-sha256','f'*64),('energy-solar-case-count','2')]:
            old=deepcopy(self.jobs);self.jobs[census.SOLAR_JOB]['outputs'][key]=value
            with self.assertRaises(AssertionError):self.run_aggregate()
            self.jobs=old

    def test_original_energy_records_cannot_be_rewritten_hidden_or_replaced(self):
        good=deepcopy(self.jobs)
        for name in ('energy-controls','energy-lifecycle','energy-migration'):
            for key,value in [('energy-census-sha256','f'*64),('energy-case-count','69')]:
                self.jobs=deepcopy(good);self.jobs[name]['outputs'][key]=value
                with self.assertRaises(AssertionError):self.run_aggregate()
        self.jobs=good
        for key,value in [('caseCount',69),('sourceSha','2'*40),('schema','other')]:
            old=deepcopy(self.old);self.old[key]=value;self.write_claims()
            with self.assertRaises(AssertionError):self.run_aggregate()
            self.old=old


if __name__=='__main__':unittest.main()
