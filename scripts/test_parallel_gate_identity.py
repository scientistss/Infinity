"""Offline identity/aggregate negative tests. Never native-browser or CI evidence."""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('parallel_identity', ROOT/'scripts/parallel-gate-identity.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)
# Preserve the exact historical six-job test body only after full seven-job validation.
from test_manual_unit_gate import previous_six_workflow
WORKFLOW = previous_six_workflow()
AGGREGATE = textwrap.dedent(WORKFLOW.split('  required-gates:\n',1)[1].split("python - <<'PYCODE'\n",1)[1].split('          PYCODE',1)[0])
ORBITAL = textwrap.dedent(WORKFLOW.split('        id: orbital_identity\n',1)[1].split("python - <<'PY'\n",1)[1].split('          PY\n',1)[0])
POOL = ORBITAL[ORBITAL.index('pool = copy.deepcopy(reports)'):ORBITAL.index('\nidentity =')]


def gate(jobs):
    with patch.dict(os.environ, {'JOB_RESULTS':json.dumps(jobs)}), contextlib.redirect_stdout(io.StringIO()):
        exec(compile(AGGREGATE,'<actual-required-gates>','exec'),{})


class SixJobGateTests(unittest.TestCase):
    def jobs(self):
        return {
            'verify':{'result':'success','outputs':{'common-identity-sha256':'a'*64,'orbital-identity-sha256':'b'*64}},
            'verify-continuation':{'result':'success','outputs':{'common-identity-sha256':'a'*64,'orbital-identity-sha256':'b'*64}},
            'npc-orbital':{'result':'success','outputs':{'common-identity-sha256':'a'*64,'orbital-identity-sha256':'b'*64}},
            'scout-rehearsal':{'result':'success','outputs':{'common-identity-sha256':'a'*64,'scout-fixture-sha256':'c'*64}},
            'lab-blockers':{'result':'success','outputs':{'common-identity-sha256':'a'*64}},
            'manual-unit-orders':{'result':'success','outputs':{'common-identity-sha256':'a'*64}},
        }

    def test_all_six_success_with_exact_common_and_orbital_identity(self):
        gate(self.jobs())

    def test_each_failure_cancel_skip_missing_extra_or_empty_job_is_refused(self):
        for name in self.jobs():
            for result in ('failure','cancelled','skipped','in_progress',''):
                jobs=self.jobs();jobs[name]['result']=result
                with self.subTest(name=name,result=result),self.assertRaises(AssertionError):gate(jobs)
            jobs=self.jobs();del jobs[name]
            with self.subTest(missing=name),self.assertRaises(AssertionError):gate(jobs)
        jobs=self.jobs();jobs['unexpected']=copy.deepcopy(jobs['verify'])
        with self.assertRaises(AssertionError):gate(jobs)

    def test_all_common_and_orbital_hashes_are_required_exact(self):
        for name,job in self.jobs().items():
            for key in job['outputs']:
                for digest in ('','not-a-hash','0'*63,'A'*64,None):
                    jobs=self.jobs();jobs[name]['outputs'][key]=digest
                    with self.subTest(name=name,key=key,digest=digest),self.assertRaises((AssertionError,TypeError)):gate(jobs)
                jobs=self.jobs();del jobs[name]['outputs'][key]
                with self.subTest(name=name,key=key,missing=True),self.assertRaises(AssertionError):gate(jobs)
                if key!='scout-fixture-sha256':
                    jobs=self.jobs();jobs[name]['outputs'][key]='d'*64
                    with self.subTest(name=name,key=key,mismatch=True),self.assertRaises(AssertionError):gate(jobs)

    def test_workflow_has_independent_bounded_jobs_and_one_unmodified_orbital_browser(self):
        for name,minutes in (('verify',45),('verify-continuation',45),('npc-orbital',25),('scout-rehearsal',25),('lab-blockers',15),('manual-unit-orders',15)):
            job=WORKFLOW.split('  '+name+':\n',1)[1]
            next_names=[p for p in ('\n  verify:\n','\n  verify-continuation:\n','\n  npc-orbital:\n','\n  scout-rehearsal:\n','\n  lab-blockers:\n','\n  manual-unit-orders:\n','\n  required-gates:\n') if p in job]
            if next_names:job=job[:min(job.index(p) for p in next_names)]
            self.assertNotIn('    needs:',job)
            self.assertIn(f'    timeout-minutes: {minutes}\n',job)
            self.assertIn('          ref: ${{ github.sha }}',job)
            self.assertIn('common-identity-sha256: ${{ steps.common_identity.outputs.common-sha256 }}',job)
            self.assertIn('python scripts/parallel-gate-identity.py --source-root',job)
            self.assertIn('if: always()',job)
        self.assertNotIn('continue-on-error',WORKFLOW)
        self.assertEqual(WORKFLOW.count('python scripts/browser-npc-attack.py '),1)
        self.assertEqual(WORKFLOW.count('python scripts/browser-scout-rehearsal.py '),1)
        self.assertIn('needs: [verify, verify-continuation, npc-orbital, scout-rehearsal, lab-blockers, manual-unit-orders]',WORKFLOW)
        self.assertIn('PYTHONDONTWRITEBYTECODE: "1"',WORKFLOW)
        self.assertIn('--scout-fixtures',WORKFLOW)


class ExactIdentityTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        (self.root/'src').mkdir();(self.root/'scripts').mkdir()
        (self.root/'src/example.ts').write_text('export const x=1;\n')
        (self.root/'scripts/example.py').write_text('print(1)\n')
        (self.root/'.gitignore').write_text('dist/\n__pycache__/\n*.ignored\n')
        for command in (['init','-q'],['config','user.name','offline-test'],['config','user.email','offline@example.invalid'],['add','.'],['commit','-qm','synthetic source']):
            subprocess.run(['git','-C',str(self.root),*command],check=True,capture_output=True)
        self.sha=M.git(self.root,'rev-parse','HEAD').decode().strip()
        dist=self.root/'dist';dist.mkdir();files={}
        for i in range(62):
            raw=f'synthetic asset {i}'.encode();name=f'asset-{i}.js';(dist/name).write_bytes(raw);files[name]=M.sha(raw)
        self.release={'sourceSha':self.sha,'saveVersion':9,'saveRevision':16,'version':'0.6.32-alpha.1','files':files}
        self.write_release()

    def tearDown(self):self.tmp.cleanup()
    def write_release(self):(self.root/'dist/release.json').write_text(json.dumps(self.release))

    def test_clean_complete_source_assets_and_runtime_are_bound(self):
        actual=M.common_identity(self.root,self.root,self.sha,'v22.20.0')
        self.assertEqual(actual['assetCount'],62)
        self.assertEqual(len(actual['assets']),63)
        self.assertEqual(actual['source']['sourceSha'],self.sha)
        self.assertEqual(actual['runtimeNode'],'v22.20.0')
        self.assertEqual(actual['sourceZipSha256'],M.sha(M.git(self.root,'archive','--format=zip','--prefix=Infinity/','HEAD')))
        changed=M.common_identity(self.root,self.root,self.sha,'v22.21.0')
        self.assertNotEqual(M.sha(M.canonical(actual)),M.sha(M.canonical(changed)))

    def test_tracked_byte_mode_and_symlink_changes_refused(self):
        file=self.root/'src/example.ts';original=file.read_bytes();mode=file.stat().st_mode
        file.write_bytes(original+b' ')
        with self.assertRaises(AssertionError):M.exact_source(self.root,self.sha)
        file.write_bytes(original);file.chmod(mode|0o111)
        with self.assertRaises(AssertionError):M.exact_source(self.root,self.sha)
        file.chmod(mode);file.unlink();file.symlink_to(self.root/'scripts/example.py')
        with self.assertRaises(AssertionError):M.exact_source(self.root,self.sha)

    def test_untracked_and_ignored_executable_source_extras_refused(self):
        for name in ('extra.ts','extra.ignored','__pycache__/cached.pyc'):
            file=self.root/'scripts'/name;file.parent.mkdir(exist_ok=True);file.write_text('untrusted extra')
            with self.subTest(name=name),self.assertRaises(AssertionError):M.exact_source(self.root,self.sha)
            file.unlink()

    def test_wrong_sha_runtime_revision_asset_content_and_count_refused(self):
        with self.assertRaises(AssertionError):M.common_identity(self.root,self.root,'a'*40,'v22.20.0')
        for runtime in ('v24.19.0','22.20.0','v22.20.0\nother','unknown'):
            with self.subTest(runtime=runtime),self.assertRaises(AssertionError):M.common_identity(self.root,self.root,self.sha,runtime)
        for key,value in (('saveRevision',13),('saveRevision',True),('saveVersion',True),('sourceSha','a'*40),('version','0.6.21-alpha.1'),('version','0.6.22-alpha.2'),('version','0.6.23-alpha.1'),('version','0.6.23-alpha.2'),('version','0.6.24-alpha.1'),('version','0.6.24-alpha.2'),('version','0.6.26-alpha.2'),('version','0.6.23'),('version',None),('version',True)):
            before=self.release[key];self.release[key]=value;self.write_release()
            with self.subTest(key=key,value=value),self.assertRaises(AssertionError):M.exact_assets(self.root,self.sha)
            self.release[key]=before;self.write_release()
        (self.root/'dist/asset-0.js').write_text('changed')
        with self.assertRaises(AssertionError):M.exact_assets(self.root,self.sha)
        (self.root/'dist/asset-0.js').write_text('synthetic asset 0')
        (self.root/'dist/extra.js').write_text('extra')
        with self.assertRaises(AssertionError):M.exact_assets(self.root,self.sha)


class OrbitalFixtureNormalizationTests(unittest.TestCase):
    def reports(self):
        return {'r12':{'timing':{'startedAt':'first','wallElapsedSeconds':1,'gameTime':31},'source':{'runtimeNode':'v22.20.0'},'checks':[{'passed':True}]},
                'native':{'timing':{'wallElapsedSeconds':2,'gameTime':41},'source':{'baseReportSha256':'a'*64},'checks':[{'passed':True}],'states':{'money':1}}}
    def digest(self,reports):
        scope={'copy':copy,'reports':reports,'sha':M.sha,'canonical':M.canonical}
        exec(compile(POOL,'<actual-orbital-normalization>','exec'),scope)
        return M.sha(M.canonical(scope['pool']))
    def test_only_named_host_timing_and_preverified_link_are_normalized(self):
        original=self.reports();changed=copy.deepcopy(original)
        changed['r12']['timing'].update(startedAt='second',wallElapsedSeconds=99)
        changed['native']['timing']['wallElapsedSeconds']=44
        changed['native']['source']['baseReportSha256']='c'*64
        self.assertEqual(self.digest(original),self.digest(changed))
        for path in (('r12','source','runtimeNode'),('native','states','money'),('r12','checks'),('native','checks'),('r12','timing','gameTime')):
            changed=copy.deepcopy(original);target=changed
            for key in path[:-1]:target=target[key]
            target[path[-1]]='mutated'
            with self.subTest(path=path):self.assertNotEqual(self.digest(original),self.digest(changed))
    def test_orbital_fixture_runtime_matches_actual_common_job_runtime(self):
        tree=ast.parse(ORBITAL)
        assertion=next(n for n in tree.body if isinstance(n,ast.Assert) and ast.unparse(n.test)=="r12['source']['runtimeNode'] == common['identity']['runtimeNode']")
        code=compile(ast.Module(body=[assertion],type_ignores=[]),'<actual-runtime-link>','exec')
        scope={'r12':{'source':{'runtimeNode':'v22.20.0'}},'common':{'identity':{'runtimeNode':'v22.20.0'}}}
        exec(code,scope)
        scope['r12']['source']['runtimeNode']='v24.19.0'
        with self.assertRaises(AssertionError):exec(code,scope)

    def test_missing_fields_refused_and_raw_link_checked_before_normalization(self):
        reports=self.reports();del reports['r12']['timing']['startedAt']
        with self.assertRaises(KeyError):self.digest(reports)
        tree=ast.parse(ORBITAL)
        assertion=next(n for n in tree.body if isinstance(n,ast.Assert) and ast.unparse(n.test)=="native['source']['baseReportSha256'] == raw_hashes['r12']")
        with self.assertRaises(AssertionError):exec(compile(ast.Module(body=[assertion],type_ignores=[]),'<raw-link>','exec'),{'native':{'source':{'baseReportSha256':'a'*64}},'raw_hashes':{'r12':'b'*64}})


if __name__=='__main__':unittest.main()
