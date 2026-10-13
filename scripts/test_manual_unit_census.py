"""Pure-Python adversarial tests for the two mandatory actual-report groups."""
import ast
import contextlib
import io
import os
import sys
import tempfile
import copy
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import manual_unit_census as M

ROOT=Path(__file__).resolve().parents[1]
ORIGINAL='123785c4f7fdb57a3968012d81aab74f6a3ad18b'
SHA='a'*40
RUNTIME='v22.22.2'


def sample(group):
    source={'sourceSha':SHA,'fullTree':'b'*40,'sourceCode':{'scripts/manual-unit-native-fixture.ts':'c'*64},'sourceModes':{'scripts/manual-unit-native-fixture.ts':'100644'}}
    identity={'source':{**source,'srcTree':'d'*40},'runtimeNode':RUNTIME,'assets':{'release.json':'e'*64}}
    common={'identitySha256':M.sha(M.canonical(identity)),'identity':identity}
    binding_runtime={'GITHUB_RUN_ID':'12345','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'manual-unit-'+group,'GITHUB_REF':'refs/heads/test','GITHUB_REPOSITORY':'test/infinity'}
    binding={'runIdentity':binding_runtime,'complete':True,'codeSourceSha':'241a51de31364e9086abcc304884bf9df7cd6912','testSourceSha':'1f66672f40556c61c4acfaeec23f1cb18c64636a','source':{'all':'original source bytes'},'dist':{'all':'original dist bytes'}}
    fixture={'historical':{'sourceBindingSha256':M.sha(M.canonical(binding))},'schema':'infinity-manual-unit-native-fixture-v1','source':{'sourceSha':SHA,'fullTree':source['fullTree'],'scriptSha256':'c'*64,'runtimeNode':RUNTIME},'allInputs':{'unchanged':'complete fixture specimen'}}
    fixture_raw=M.canonical(fixture)
    runtime={'githubRunId':'12345','githubRunAttempt':'1','githubJob':'manual-unit-'+group,'githubWorkflow':'Verify original P4','githubSha':SHA,'githubRef':'refs/heads/test','githubRepository':'test/infinity'}
    names=['setup',*M.GROUP_CASES[group],'suite-integrity']
    records=[{'name':name,'kind':'infrastructure' if name in M.INFRASTRUCTURE else 'scenario','status':'completed','phase':'completed',
        'hostStartedMonotonic':index*10,'hostCompletedMonotonic':index*10+2,'hostElapsedSeconds':2,
        'phases':[{'phase':'started','hostMonotonic':index*10},{'phase':'completed','hostMonotonic':index*10+2}]} for index,name in enumerate(names)]
    report={'schema':'infinity-manual-unit-native-v2','group':group,'completed':True,'result':'passed','failure':None,'failureLifecycle':None,'case':'suite-integrity',
        'errors':[],'failedRequests':[],'sourceSha':SHA,'candidateVersion':'0.6.29-alpha.1','sourceIdentity':source,'runtimeNode':RUNTIME,
        'runtimeIdentity':runtime,'sourceBindingSha256':M.sha(M.canonical(binding)),'fixtureSha256':M.sha(fixture_raw),'caseCensus':{'completedCases':list(M.GROUP_CASES[group]),'infrastructureCases':list(M.INFRASTRUCTURE),'records':records},
        'checks':[{'case':name,'name':'actual complete independent native check','passed':True,'detail':None} for name in names],
        'evidence':[{'file':'actual-native.json','sha256':'e'*64}],'sourceBindings':[{'assets':['actual HTTP and V8 binding']} ]}
    return report,fixture,common,runtime


def validate(report,fixture,common,group,runtime):
    binding_runtime={'GITHUB_RUN_ID':'12345','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'manual-unit-'+group,'GITHUB_REF':'refs/heads/test','GITHUB_REPOSITORY':'test/infinity'}
    binding={'runIdentity':binding_runtime,'complete':True,'codeSourceSha':'241a51de31364e9086abcc304884bf9df7cd6912','testSourceSha':'1f66672f40556c61c4acfaeec23f1cb18c64636a','source':{'all':'original source bytes'},'dist':{'all':'original dist bytes'}}
    return M.verify_report(M.canonical(report),M.canonical(fixture),M.canonical(common),group,SHA,runtime,M.canonical(binding),binding_runtime)


def states():
    jobs={}
    for group in ('payments','authority'):
        report,fixture,common,runtime=sample(group)
        value=validate(report,fixture,common,group,runtime)
        jobs['manual-unit-'+group]={'result':'success','outputs':{'common-identity-sha256':common['identitySha256'],
            'manual-fixture-sha256':value['fixtureSha256'],'manual-census-json':M.canonical(value).decode()}}
    return jobs


class NativeCensusTests(unittest.TestCase):
    def test_exact_independent_groups_cover_all_original_named_scenarios(self):
        M.fixed_contract()
        original=subprocess.check_output(['git','-C',str(ROOT),'show',ORIGINAL+':scripts/browser-manual-unit-orders.py'],text=True)
        tree=ast.parse(original)
        values={node.targets[0].id:ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and len(node.targets)==1
            and isinstance(node.targets[0],ast.Name) and node.targets[0].id in ('GOLDEN','SHIPS','WIDTHS')}
        functions={node.name:node for node in tree.body if isinstance(node,ast.FunctionDef)}
        expected=set()
        env=dict(values)
        def expr(node,bindings):
            if isinstance(node,ast.Constant):return node.value
            if isinstance(node,ast.Name):return bindings[node.id]
            if isinstance(node,ast.Tuple):return tuple(expr(x,bindings) for x in node.elts)
            if isinstance(node,ast.List):return [expr(x,bindings) for x in node.elts]
            if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add):return expr(node.left,bindings)+expr(node.right,bindings)
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='str':return str(expr(node.args[0],bindings))
            raise ValueError(ast.dump(node))
        def walk(statements,bindings):
            for node in statements:
                if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
                    try:bindings[node.targets[0].id]=expr(node.value,bindings)
                    except (ValueError,KeyError,TypeError):pass
                if isinstance(node,ast.Expr) and isinstance(node.value,ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id=='begin_case':
                    expected.add(expr(node.value.args[0],bindings))
                if isinstance(node,ast.For):
                    try:items=expr(node.iter,bindings)
                    except (ValueError,KeyError,TypeError):continue
                    for item in items:
                        local=dict(bindings)
                        if isinstance(node.target,ast.Name):local[node.target.id]=item
                        else:
                            for target,value in zip(node.target.elts,item):local[target.id]=value
                        walk(node.body,local)
        for name in ('natural_route','transit_fill','invalid_and_all_units','legal_raw_payment','rejected_boundaries','four_widths','latest_plan','lifecycle_and_hostile_dom','rejected_import_attempts','protection_boundary','hidden_resume'):
            walk(functions[name].body,dict(env))
        self.assertEqual(len(expected),66)
        self.assertEqual(expected,set(M.GROUP_CASES['payments'])|set(M.GROUP_CASES['authority']))
        self.assertEqual(M.sha(M.canonical(sorted(expected))),M.FULL_CENSUS_SHA256)
        self.assertFalse(set(M.GROUP_CASES['payments'])&set(M.GROUP_CASES['authority']))

    def test_both_actual_reports_bind_complete_raw_fixture_source_and_runtime(self):
        for group in M.GROUP_CASES:
            report,fixture,common,runtime=sample(group)
            result=validate(report,fixture,common,group,runtime)
            self.assertEqual(result['completedCases'],sorted(M.GROUP_CASES[group]))
            self.assertEqual(result['fixtureSha256'],M.sha(M.canonical(fixture)))
        self.assertEqual(M.verify_aggregate(states(),SHA)['scenarioCount'],66)

    def test_uncompleted_failed_skipped_unknown_and_false_native_checks_are_rejected(self):
        mutations=(lambda r:r.update(completed=False),lambda r:r.update(completed=1),lambda r:r.update(result='skipped'),
            lambda r:r.update(failure='continued after failure'),lambda r:r.update(failureLifecycle={'earlier':'failed'}),lambda r:r.update(errors=['error']),lambda r:r.update(failedRequests=['failed']),
            lambda r:r.update(checks=[]),lambda r:r['checks'][0].update(passed=False),lambda r:r['checks'][0].update(passed=1),
            lambda r:r['checks'].append({'case':'unknown','name':'extra','passed':True}),lambda r:r['checks'].pop(),
            lambda r:r.update(evidence=[]),lambda r:r.update(sourceBindings=[]),lambda r:r.update(case='setup'))
        for mutate in mutations:
            r,f,c,i=sample('payments');mutate(r)
            with self.subTest(mutation=mutate),self.assertRaises((AssertionError,KeyError,TypeError)):validate(r,f,c,'payments',i)

    def test_every_named_case_missing_duplicate_wrong_group_or_fabricated_census_is_rejected(self):
        for group in M.GROUP_CASES:
            r,f,c,i=sample(group)
            for name in M.GROUP_CASES[group]:
                for key in ('completedCases','records'):
                    bad=copy.deepcopy(r)
                    bad['caseCensus'][key]=[x for x in bad['caseCensus'][key] if (x if key=='completedCases' else x['name'])!=name]
                    with self.subTest(group=group,name=name,key=key),self.assertRaises(AssertionError):validate(bad,f,c,group,i)
            for key in ('completedCases','infrastructureCases','records'):
                bad=copy.deepcopy(r);bad['caseCensus'][key].append(copy.deepcopy(bad['caseCensus'][key][0]))
                with self.assertRaises(AssertionError):validate(bad,f,c,group,i)
            bad=copy.deepcopy(r);bad['caseCensus']['completedCases'][0]='SYNTHETIC-invented'
            with self.assertRaises(AssertionError):validate(bad,f,c,group,i)
            bad=copy.deepcopy(r);bad['group']='authority' if group=='payments' else 'payments'
            with self.assertRaises(AssertionError):validate(bad,f,c,group,i)
            bad=copy.deepcopy(r);bad['checks']=[row for row in bad['checks'] if row['case']!=M.GROUP_CASES[group][0]]
            with self.assertRaises(AssertionError):validate(bad,f,c,group,i)

    def test_case_records_must_all_finish_and_retain_actual_monotonic_phases(self):
        for key,value in (('status','running'),('status','failed'),('phase','running'),('kind','infrastructure'),
            ('hostCompletedMonotonic',None),('hostElapsedSeconds',True),('hostElapsedSeconds',0),('hostStartedMonotonic',-1),('phases',[])):
            r,f,c,i=sample('payments');r['caseCensus']['records'][1][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(AssertionError):validate(r,f,c,'payments',i)
        r,f,c,i=sample('payments');r['caseCensus']['records'][1]['phases'][-1]['phase']='failure-capture'
        with self.assertRaises(AssertionError):validate(r,f,c,'payments',i)

    def test_exact_fixture_bytes_source_tree_runtime_and_invocation_cannot_be_spoofed(self):
        for target,key,value in (('report','fixtureSha256','f'*64),('report','sourceSha','b'*40),('report','runtimeNode','v24.0.0'),
            ('report','candidateVersion','0.6.24-alpha.1'),('report','sourceIdentity',{}),('report','runtimeIdentity',{}),
            ('fixture','allInputs',{'mutated':'money'})):
            r,f,c,i=sample('payments');(r if target=='report' else f)[key]=value
            with self.subTest(target=target,key=key),self.assertRaises(AssertionError):validate(r,f,c,'payments',i)
        for key,value in (('sourceSha','b'*40),('fullTree','e'*40),('scriptSha256','f'*64),('runtimeNode','v24.0.0')):
            r,f,c,i=sample('payments');f['source'][key]=value;r['fixtureSha256']=M.sha(M.canonical(f))
            with self.subTest(key=key),self.assertRaises(AssertionError):validate(r,f,c,'payments',i)
        for key in M.RUNTIME_KEYS:
            r,f,c,i=sample('payments');r['runtimeIdentity']=dict(i);r['runtimeIdentity'][key]='another'
            with self.subTest(key=key),self.assertRaises(AssertionError):validate(r,f,c,'payments',i)
        r,f,c,i=sample('payments');c['identity']['source']['fullTree']='e'*40
        with self.assertRaises(AssertionError):validate(r,f,c,'payments',i)

    def test_aggregate_rejects_missing_scope_wrong_group_overlap_or_mismatched_actual_identity(self):
        for group in M.GROUP_CASES:
            name='manual-unit-'+group
            for mutate in (lambda v:v.pop('completedCases'),lambda v:v.update(group='unknown'),lambda v:v.update(sourceSha='b'*40),
                lambda v:v['completedCases'].pop(),lambda v:v['completedCases'].append(v['completedCases'][0]),
                lambda v:v['completedCases'].append(M.GROUP_CASES['authority' if group=='payments' else 'payments'][0]),
                lambda v:v.update(fixtureSha256='f'*64),lambda v:v.update(reportSha256='bad'),lambda v:v.update(originalFullCensusSha256='f'*64),
                lambda v:v.update(infrastructureCases=['setup']),lambda v:v['runtimeIdentity'].update(githubRunId='other')):
                jobs=states();value=M.strict_json(jobs[name]['outputs']['manual-census-json']);mutate(value)
                jobs[name]['outputs']['manual-census-json']=M.canonical(value).decode()
                with self.subTest(group=group,mutation=mutate),self.assertRaises((AssertionError,KeyError)):M.verify_aggregate(jobs,SHA)
            for status in ('failed','cancelled','skipped','in_progress',None):
                jobs=states();jobs[name]['result']=status
                with self.assertRaises(AssertionError):M.verify_aggregate(jobs,SHA)
            jobs=states();del jobs[name]['outputs']['manual-census-json']
            with self.assertRaises(KeyError):M.verify_aggregate(jobs,SHA)
        jobs=states();a=M.strict_json(jobs['manual-unit-payments']['outputs']['manual-census-json']);b=M.strict_json(jobs['manual-unit-authority']['outputs']['manual-census-json'])
        b['reportSha256']=a['reportSha256'];jobs['manual-unit-authority']['outputs']['manual-census-json']=M.canonical(b).decode()
        with self.assertRaises(AssertionError):M.verify_aggregate(jobs,SHA)

    def test_duplicate_json_fields_and_modified_fixed_group_contract_are_refused(self):
        with self.assertRaises(AssertionError):M.strict_json('{"group":"payments","group":"authority"}')
        with self.assertRaises(AssertionError):M.strict_json('{"value":NaN}')
        altered=dict(M.GROUP_CASES);altered['payments']=(*altered['payments'][:-1],'unknown')
        with patch.object(M,'GROUP_CASES',altered),self.assertRaises(AssertionError):M.fixed_contract()


def binding_sample(group):
    runtime={'GITHUB_RUN_ID':'12345','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'manual-unit-'+group,'GITHUB_REF':'refs/heads/test','GITHUB_REPOSITORY':'test/infinity'}
    value={'runIdentity':runtime,'complete':True,'codeSourceSha':'241a51de31364e9086abcc304884bf9df7cd6912','testSourceSha':'1f66672f40556c61c4acfaeec23f1cb18c64636a','source':{'all':'original source bytes'},'dist':{'all':'original dist bytes'}}
    return value,runtime


def artifact_samples(parent):
    roots={};jobs={};invocations={}
    for group in M.GROUP_CASES:
        root=parent/group;root.mkdir();roots[group]=root
        r,f,c,runtime=sample(group);binding,binding_runtime=binding_sample(group)
        dist={f'asset-{index}.js':f'exact production {index}'.encode() for index in range(62)}
        release={'sourceSha':SHA,'version':'0.6.29-alpha.1','saveVersion':9,'saveRevision':14,'files':{key:M.sha(value) for key,value in dist.items()}}
        dist['release.json']=M.canonical(release)
        c['identity']['assets']={key:M.sha(value) for key,value in dist.items()}
        c['identity']['sourceZipSha256']=M.sha(b'complete exact source archive')
        c['identitySha256']=M.sha(M.canonical(c['identity']))
        r['releaseMetadata']=release
        value=M.verify_report(M.canonical(r),M.canonical(f),M.canonical(c),group,SHA,runtime,M.canonical(binding),binding_runtime)
        files={'manual-unit-evidence/manual-unit-browser-report.json':M.canonical(r),
            'manual-unit-source-evidence/native-fixture.json':M.canonical(f),'manual-unit-source-evidence/old-source-binding.json':M.canonical(binding),
            'common-identity.json':M.canonical(c),'manual-unit-census.json':M.canonical(value),'manual-unit-source.zip':b'complete exact source archive',
            **{'dist/'+key:raw for key,raw in dist.items()}}
        for path,raw in files.items():
            target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
        jobs['manual-unit-'+group]={'result':'success','outputs':{'common-identity-sha256':value['commonIdentitySha256'],
            'manual-fixture-sha256':value['fixtureSha256'],'manual-census-json':M.canonical(value).decode()}}
        invocations[group]=(runtime,binding_runtime)
    return roots,jobs,invocations


class OriginalArtifactTests(unittest.TestCase):
    def test_two_exact_value_projections_preserve_every_other_original_byte(self):
        rows=[]
        for group in M.GROUP_CASES:
            binding,runtime=binding_sample(group)
            raw=(json.dumps(binding,ensure_ascii=False,indent=2)+'\n').encode()
            fixture={'before':'  untouched Unicode 星','historical':{'sourceBindingSha256':M.sha(raw)},'after':[1,2,3]}
            fixture_raw=(json.dumps(fixture,ensure_ascii=False,indent=4)+'\n').encode()
            before=(raw,fixture_raw)
            result=M.common_fixture_bindings(raw,fixture_raw,group,runtime)
            expected_binding=raw.replace(json.dumps('manual-unit-'+group).encode(),b'"manual-unit-group"',1)
            expected_fixture=fixture_raw.replace(json.dumps(M.sha(raw)).encode(),json.dumps(M.sha(expected_binding)).encode(),1)
            self.assertEqual(result['sourceBindingCommonSha256'],M.sha(expected_binding))
            self.assertEqual(result['fixtureCommonSha256'],M.sha(expected_fixture))
            self.assertEqual(before,(raw,fixture_raw));rows.append(result)
        self.assertNotEqual(rows[0]['sourceBindingSha256'],rows[1]['sourceBindingSha256'])
        self.assertEqual(rows[0]['sourceBindingCommonSha256'],rows[1]['sourceBindingCommonSha256'])
        self.assertEqual(rows[0]['fixtureCommonSha256'],rows[1]['fixtureCommonSha256'])

    def test_unknown_job_wrong_binding_duplicate_keys_and_non_job_differences_fail_or_change_common_digest(self):
        binding,runtime=binding_sample('payments');raw=M.canonical(binding)
        fixture=M.canonical({'historical':{'sourceBindingSha256':M.sha(raw)},'money':'unchanged'})
        original=M.common_fixture_bindings(raw,fixture,'payments',runtime)
        for value in ('manual-unit-unknown','manual-unit-authority',None):
            altered=copy.deepcopy(binding);altered['runIdentity']['GITHUB_JOB']=value
            changed=M.canonical(altered)
            with self.assertRaises(AssertionError):M.common_fixture_bindings(changed,fixture,'payments',runtime)
        with self.assertRaises(AssertionError):M.common_fixture_bindings(raw,fixture,'unknown',runtime)
        altered=copy.deepcopy(binding);altered['source']['all']='changed non-job source bytes';changed=M.canonical(altered)
        changed_fixture=M.canonical({'historical':{'sourceBindingSha256':M.sha(changed)},'money':'unchanged'})
        result=M.common_fixture_bindings(changed,changed_fixture,'payments',runtime)
        self.assertNotEqual(result['sourceBindingCommonSha256'],original['sourceBindingCommonSha256'])
        self.assertNotEqual(result['fixtureCommonSha256'],original['fixtureCommonSha256'])
        for changed_fixture in (fixture+b'\n',fixture.replace(b'unchanged',b'different')):
            self.assertNotEqual(M.common_fixture_bindings(raw,changed_fixture,'payments',runtime)['fixtureCommonSha256'],original['fixtureCommonSha256'])
        with self.assertRaises(AssertionError):M.common_fixture_bindings(raw,fixture.replace(M.sha(raw).encode(),b'0'*64),'payments',runtime)
        with self.assertRaises(AssertionError):M.common_fixture_bindings(raw.replace(b'"complete":true',b'"complete":true,"complete":false'),fixture,'payments',runtime)

    def test_actual_aggregate_cli_recomputes_both_downloaded_artifacts_and_all_assets(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);roots,jobs,invocations=artifact_samples(root)
            result=M.verify_artifacts(jobs,roots,SHA,invocations)
            self.assertEqual(result['scenarioCount'],66)
            self.assertNotEqual(*result['rawFixtureSha256'].values())
            env={M.RUNTIME_KEYS[key]:value for key,value in invocations['payments'][0].items()}
            env.update(GITHUB_JOB='required-gates',JOB_RESULTS=json.dumps(jobs))
            out=root/'aggregate.json'
            argv=['manual_unit_census.py','aggregate','--payments',str(roots['payments']),'--authority',str(roots['authority']),'--expected-sha',SHA,'--output',str(out)]
            with patch.dict(os.environ,env),patch.object(sys,'argv',argv),contextlib.redirect_stdout(io.StringIO()):M.main()
            self.assertEqual(M.strict_json(out.read_bytes()),result)

    def test_forged_job_common_hash_claims_cannot_replace_actual_artifact_recomputation(self):
        with tempfile.TemporaryDirectory() as directory:
            roots,jobs,invocations=artifact_samples(Path(directory))
            for key in ('fixtureCommonSha256','sourceBindingCommonSha256','fixtureSha256','reportSha256','sourceBindingSha256'):
                bad=copy.deepcopy(jobs)
                for name,job in bad.items():
                    value=M.strict_json(job['outputs']['manual-census-json']);value[key]='f'*64
                    job['outputs']['manual-census-json']=M.canonical(value).decode()
                with self.subTest(key=key),self.assertRaises(AssertionError):M.verify_artifacts(bad,roots,SHA,invocations)

    def test_original_job_common_and_raw_fixture_outputs_cannot_be_replaced_by_recomputed_values(self):
        with tempfile.TemporaryDirectory() as directory:
            roots,jobs,invocations=artifact_samples(Path(directory))
            for group in M.GROUP_CASES:
                for key in ('common-identity-sha256','manual-fixture-sha256'):
                    bad=copy.deepcopy(jobs);bad['manual-unit-'+group]['outputs'][key]='f'*64
                    with self.subTest(group=group,key=key),self.assertRaisesRegex(AssertionError,'original .*job output'):
                        M.verify_artifacts(bad,roots,SHA,invocations)

    def test_missing_group_case_failed_check_wrong_source_binding_and_altered_assets_reject(self):
        with tempfile.TemporaryDirectory() as directory:
            roots,jobs,invocations=artifact_samples(Path(directory))
            report_path=roots['authority']/'manual-unit-evidence/manual-unit-browser-report.json';original=report_path.read_bytes()
            for mutate in (lambda r:r['caseCensus']['completedCases'].pop(),lambda r:r['caseCensus']['completedCases'].append(r['caseCensus']['completedCases'][0]),
                lambda r:r['checks'][0].update(passed=False),lambda r:r.update(sourceSha='f'*40),lambda r:r.update(sourceBindingSha256='f'*64),
                lambda r:r.update(failureLifecycle={'earlier':'failure'}),lambda r:r['releaseMetadata'].update(saveRevision=15)):
                value=M.strict_json(original);mutate(value);report_path.write_bytes(M.canonical(value))
                with self.assertRaises((AssertionError,KeyError)):M.verify_artifacts(jobs,roots,SHA,invocations)
            report_path.write_bytes(original)
            report_path.rename(report_path.with_suffix('.missing'))
            with self.assertRaises(AssertionError):M.verify_artifacts(jobs,roots,SHA,invocations)
            report_path.with_suffix('.missing').rename(report_path)
            asset=roots['payments']/'dist/asset-0.js';asset.write_bytes(b'changed production')
            with self.assertRaises(AssertionError):M.verify_artifacts(jobs,roots,SHA,invocations)



if __name__=='__main__':unittest.main()
