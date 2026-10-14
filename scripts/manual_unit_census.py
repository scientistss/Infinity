"""Fail-closed binding of two actual native reports to one complete manual suite.
No browser, Node, source mutation, or acceptance manufacture is performed here.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re

SCHEMA = 'infinity-manual-unit-group-census-v1'
INFRASTRUCTURE = ('setup', 'suite-integrity')
SHIPS = ('small_cargo', 'large_cargo', 'light_fighter', 'heavy_fighter', 'cruiser', 'battleship', 'battlecruiser', 'bomber', 'destroyer', 'deathstar', 'recycler', 'espionage_probe', 'solar_satellite', 'colony_ship')
DEFENSES = ('rocket_launcher', 'light_laser', 'heavy_laser', 'gauss_cannon', 'ion_cannon', 'plasma_turret', 'small_shield_dome', 'large_shield_dome', 'anti_ballistic_missile', 'interplanetary_missile')
BOUNDARIES = (('queue-full','small_cargo'), ('insufficient','small_cargo'), ('unit-cap','small_cargo'),
    ('owned-small_shield_dome','small_shield_dome'), ('owned-large_shield_dome','large_shield_dome'),
    ('queued-small_shield_dome','small_shield_dome'), ('queued-large_shield_dome','large_shield_dome'),
    ('silo-39','interplanetary_missile'), ('silo-40','anti_ballistic_missile'), ('silo-40','interplanetary_missile'))
HOSTILE_ACTIONS = ('tab-away','switch-planet-return','same-id-import','reset','duplicate','detach','detach-reinsert','crosslabel','ancestor-reinsert','quote-hidden','total-hidden','quote-hide-show','ancestor-hide-show','class-hide-show','style-visibility-hide-show','quote-text-tamper','total-text-tamper','same-text-hidden-child')
GROUP_CASES = {
    'payments': ('natural05-real-count-fill-max-payments', 'natural09-paid-flight-does-not-cover-fill',
        *('SYNTHETIC-all24-'+unit for unit in SHIPS), 'SYNTHETIC-native-trim-leading-zero-raw-preserved',
        *('SYNTHETIC-full-canonical-price-width-'+str(width) for width in (320,390,768,1440))),
    'authority': (*('SYNTHETIC-all24-'+unit for unit in DEFENSES),
        *('SYNTHETIC-reject-'+name+'-'+unit for name,unit in BOUNDARIES), 'SYNTHETIC-silo39-one-slot-abm-succeeds',
        'SYNTHETIC-latest-plan-retires-old-max', 'SYNTHETIC-latest-plan-retires-old-fill',
        *('SYNTHETIC-authority-'+action for action in HOSTILE_ACTIONS),
        'SYNTHETIC-cancelled-import-retires-visible-quote', 'SYNTHETIC-failed-import-retires-visible-quote',
        'SYNTHETIC-real-cross-tab-protection', 'SYNTHETIC-consumed-native-hidden-resume'),
}
# Fixed hash of the complete sorted 66-name original scenario census, not a count-only gate.
FULL_CENSUS_SHA256 = 'ef5e865ec30df882e69fe3d872c173b64c452978047892dab0e96b82f6b1c10f'
RUNTIME_KEYS = {'githubRunId':'GITHUB_RUN_ID', 'githubRunAttempt':'GITHUB_RUN_ATTEMPT',
    'githubJob':'GITHUB_JOB', 'githubWorkflow':'GITHUB_WORKFLOW', 'githubSha':'GITHUB_SHA',
    'githubRef':'GITHUB_REF','githubRepository':'GITHUB_REPOSITORY'}
SOURCE_KEYS = ('sourceSha','fullTree','sourceCode','sourceModes')


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def sha(raw): return hashlib.sha256(raw).hexdigest()


def require(value, message):
    if not value: raise AssertionError(message)


def strict_json(raw):
    def pairs(items):
        result={}
        for key,value in items:
            require(key not in result,'Duplicate JSON key: '+key)
            result[key]=value
        return result
    def constant(value): raise AssertionError('Nonfinite JSON token: '+value)
    return json.loads(raw,object_pairs_hook=pairs,parse_constant=constant)


def exact_names(value, expected, label):
    require(type(value) is list and all(type(name) is str for name in value),label+' must be a string list')
    require(len(value)==len(set(value)),label+' contains a duplicate')
    require(set(value)==set(expected),label+' has missing, unknown, or misplaced cases')


def fixed_contract():
    require(set(GROUP_CASES)=={'payments','authority'},'Exact two native groups required')
    a,b=(GROUP_CASES[group] for group in ('payments','authority'))
    require(len(a)==len(set(a))==21 and len(b)==len(set(b))==45,'Fixed group census changed')
    require(not set(a)&set(b),'Manual scenario groups overlap')
    require(not (set(a)|set(b))&set(INFRASTRUCTURE),'Infrastructure cannot replace a scenario')
    require(sha(canonical(sorted((*a,*b))))==FULL_CENSUS_SHA256,'Complete original scenario census changed')


def finite_number(value): return type(value) in (int,float) and math.isfinite(value)



def replace_json_value(raw, path, expected, replacement):
    """Project exactly one independently addressed JSON value; preserve every other byte."""
    document=strict_json(raw)
    current=document
    for key in path:current=current[key]
    require(current==expected and type(current) is type(expected),'Projection source value mismatch')
    text=raw.decode('utf-8');decoder=json.JSONDecoder()
    def whitespace(index):
        while index<len(text) and text[index] in ' \t\r\n':index+=1
        return index
    def locate(index, keys):
        index=whitespace(index)
        if not keys:
            _,end=decoder.raw_decode(text,index)
            return index,end
        require(text[index]=='{','Projection path does not address an object')
        index=whitespace(index+1)
        while text[index]!='}':
            key,end=decoder.raw_decode(text,index);require(type(key) is str,'Object key required')
            index=whitespace(end);require(text[index]==':','Object colon required')
            index=whitespace(index+1)
            if key==keys[0]:return locate(index,keys[1:])
            _,index=decoder.raw_decode(text,index);index=whitespace(index)
            if text[index]==',':index=whitespace(index+1)
            else:require(text[index]=='}','Object separator required')
        raise AssertionError('Missing exact projection path')
    start,end=locate(0,tuple(path))
    projected=text[:start]+json.dumps(replacement,ensure_ascii=False,separators=(',',':'))+text[end:]
    return projected.encode('utf-8')


def common_fixture_bindings(binding_raw,fixture_raw,group,binding_runtime):
    binding,fixture=map(strict_json,(binding_raw,fixture_raw))
    require(group in GROUP_CASES,'Unknown source binding group')
    require(type(binding_runtime) is dict and set(binding_runtime)=={'GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_JOB','GITHUB_REF','GITHUB_REPOSITORY'}
        and all(type(x) is str and x for x in binding_runtime.values()),'Complete actual old-binder invocation identity required')
    require(binding_runtime['GITHUB_JOB']=='manual-unit-'+group,'Unknown actual old-binder job')
    require(binding['runIdentity']==binding_runtime,'Original old-source binding has wrong real CI identity')
    require(binding['complete'] is True and binding['codeSourceSha']=='241a51de31364e9086abcc304884bf9df7cd6912'
        and binding['testSourceSha']=='1f66672f40556c61c4acfaeec23f1cb18c64636a','Original immutable old-source binding is incomplete or stale')
    require(type(binding['source']) is dict and binding['source'] and type(binding['dist']) is dict and binding['dist'],'Full original source and production binding required')
    binding_hash=sha(binding_raw)
    require(fixture['historical']['sourceBindingSha256']==binding_hash,'Actual fixture does not bind complete original source-binding bytes')
    projected_binding=replace_json_value(binding_raw,('runIdentity','GITHUB_JOB'),'manual-unit-'+group,'manual-unit-group')
    common_binding_hash=sha(projected_binding)
    projected_fixture=replace_json_value(fixture_raw,('historical','sourceBindingSha256'),binding_hash,common_binding_hash)
    return {'sourceBindingSha256':binding_hash,'sourceBindingCommonSha256':common_binding_hash,
        'fixtureCommonSha256':sha(projected_fixture)}


def verify_report(report_raw, fixture_raw, common_raw, group, expected_sha, runtime_identity, binding_raw, binding_runtime):
    fixed_contract()
    require(group in GROUP_CASES,'Unknown manual group')
    require(type(expected_sha) is str and re.fullmatch('[0-9a-f]{40}',expected_sha),'Invalid expected source SHA')
    report,fixture,common=map(strict_json,(report_raw,fixture_raw,common_raw))
    require(type(common) is dict and set(common)=={'identitySha256','identity'},'Exact common identity envelope required')
    identity=common['identity']
    require(common['identitySha256']==sha(canonical(identity)),'Common identity digest mismatch')
    require(identity['source']['sourceSha']==expected_sha,'Common source SHA mismatch')
    require(report['schema']=='infinity-manual-unit-native-v2' and report['group']==group,'Native report schema/group mismatch')
    require(report['completed'] is True and report['result']=='passed' and report['failure'] is None and report['failureLifecycle'] is None,'Native report is not completed successfully')
    require(report['case']=='suite-integrity' and report['errors']==[] and report['failedRequests']==[],'Native report final integrity failed')
    require(report['sourceSha']==expected_sha and report['candidateVersion']=='0.6.32-alpha.1','Native report source/version mismatch')
    require(report['sourceIdentity']=={key:identity['source'][key] for key in SOURCE_KEYS},'Actual native full source identity differs from common identity')
    require(type(runtime_identity) is dict and set(runtime_identity)==set(RUNTIME_KEYS)
        and all(type(value) is str and value for value in runtime_identity.values()),'Actual runtime identity is missing')
    require(runtime_identity['githubSha']==expected_sha and runtime_identity['githubJob']=='manual-unit-'+group,'Actual job/source identity mismatch')
    require(report['runtimeIdentity']==runtime_identity,'Native report was produced by another CI invocation')
    require(fixture['schema']=='infinity-manual-unit-native-fixture-v1','Unknown fixture schema')
    require(fixture['source']['sourceSha']==expected_sha and fixture['source']['fullTree']==identity['source']['fullTree'],'Actual fixture source/tree mismatch')
    require(fixture['source']['scriptSha256']==identity['source']['sourceCode']['scripts/manual-unit-native-fixture.ts'],'Actual fixture producer differs from common source')
    require(report['runtimeNode']==fixture['source']['runtimeNode']==identity['runtimeNode'],'Actual fixture/report/runtime mismatch')
    require(re.fullmatch(r'v22\.\d+\.\d+',report['runtimeNode']) is not None,'Node22 runtime required')
    projected=common_fixture_bindings(binding_raw,fixture_raw,group,binding_runtime)
    require(report['sourceBindingSha256']==projected['sourceBindingSha256'],'Native report does not bind complete original old-source binding bytes')
    fixture_hash=sha(fixture_raw)
    require(report['fixtureSha256']==fixture_hash,'Native report does not bind actual complete fixture bytes')
    census=report['caseCensus']
    require(type(census) is dict and set(census)=={'completedCases','infrastructureCases','records'},'Exact actual case census required')
    exact_names(census['completedCases'],GROUP_CASES[group],'Completed scenario census')
    exact_names(census['infrastructureCases'],INFRASTRUCTURE,'Completed infrastructure census')
    records=census['records'];require(type(records) is list,'Actual case records required')
    required=(*GROUP_CASES[group],*INFRASTRUCTURE)
    exact_names([record['name'] for record in records],required,'Actual case records')
    for record in records:
        require(set(record)=={'name','kind','status','phase','hostStartedMonotonic','hostCompletedMonotonic','hostElapsedSeconds','phases'},'Exact actual case record fields required')
        require(record['kind']==('infrastructure' if record['name'] in INFRASTRUCTURE else 'scenario'),'Case kind mismatch')
        require(record['status']=='completed' and record['phase']=='completed','A case did not complete all native work')
        start,end,elapsed=(record[key] for key in ('hostStartedMonotonic','hostCompletedMonotonic','hostElapsedSeconds'))
        require(all(finite_number(x) for x in (start,end,elapsed)) and 0<=start<=end and elapsed==end-start,'Invalid actual case timing')
        phases=record['phases'];require(type(phases) is list and phases,'Actual case phases required')
        require(all(type(row) is dict and set(row)=={'phase','hostMonotonic'} and type(row['phase']) is str
            and row['phase'] and finite_number(row['hostMonotonic']) and start<=row['hostMonotonic']<=end for row in phases),'Invalid actual case phases')
        require([row['hostMonotonic'] for row in phases]==sorted(row['hostMonotonic'] for row in phases),'Case phases are out of order')
        require(phases[-1]=={'phase':'completed','hostMonotonic':end},'Case final phase is not its actual completion')
    checks=report['checks'];require(type(checks) is list and checks,'Actual native checks missing')
    require(all(type(row) is dict and row.get('passed') is True and type(row.get('name')) is str and row['name'] for row in checks),'A native check failed or is malformed')
    require(all(type(row.get('case')) is str for row in checks),'Missing native check case identity')
    require(set(row['case'] for row in checks)==set(required),'Native checks do not cover the exact actual case census')
    require(type(report['evidence']) is list and report['evidence'],'Actual native evidence missing')
    require(type(report['sourceBindings']) is list and report['sourceBindings'],'Actual browser production binding missing')
    summary={'schema':SCHEMA,'group':group,'sourceSha':expected_sha,'runtimeNode':report['runtimeNode'],
        'fixtureSha256':fixture_hash,'reportSha256':sha(report_raw),'commonIdentitySha256':common['identitySha256'],
        'runtimeIdentity':runtime_identity,**projected,'completedCases':sorted(census['completedCases']),
        'infrastructureCases':list(INFRASTRUCTURE),'originalFullCensusSha256':FULL_CENSUS_SHA256,
        'comparisonScope':'Original per-job fixture and source-binding bytes remain untouched. Common source-binding digest projects only runIdentity.GITHUB_JOB after exact job validation; common fixture digest projects only historical.sourceBindingSha256 after verifying the full original binding digest. Every other byte is retained.'}
    return summary


def verify_aggregate(jobs, expected_sha):
    fixed_contract()
    groups={}
    for group in ('payments','authority'):
        name='manual-unit-'+group
        require(jobs[name]['result']=='success','Manual group is not successful: '+name)
        outputs=jobs[name]['outputs']
        value=strict_json(outputs['manual-census-json'])
        require(type(value) is dict and set(value)=={'schema','group','sourceSha','runtimeNode','fixtureSha256','reportSha256','commonIdentitySha256','runtimeIdentity','completedCases','infrastructureCases','originalFullCensusSha256','sourceBindingSha256','sourceBindingCommonSha256','fixtureCommonSha256','comparisonScope'},'Exact exported native census required')
        require(value['schema']==SCHEMA and value['group']==group and value['sourceSha']==expected_sha,'Exported native group/source mismatch')
        require(value['originalFullCensusSha256']==FULL_CENSUS_SHA256,'Exported original full census mismatch')
        exact_names(value['completedCases'],GROUP_CASES[group],'Exported completed scenarios')
        require(value['infrastructureCases']==list(INFRASTRUCTURE),'Exported infrastructure changed')
        for key in ('fixtureSha256','reportSha256','commonIdentitySha256','sourceBindingSha256','sourceBindingCommonSha256','fixtureCommonSha256'):
            require(type(value[key]) is str and re.fullmatch('[0-9a-f]{64}',value[key]),'Invalid exported identity hash: '+key)
        require(value['fixtureSha256']==outputs['manual-fixture-sha256'],'Exported fixture identities disagree')
        require(value['commonIdentitySha256']==outputs['common-identity-sha256'],'Exported common identities disagree')
        require(type(value['runtimeNode']) is str and re.fullmatch(r'v22\.\d+\.\d+',value['runtimeNode']),'Missing exported Node runtime')
        runtime=value['runtimeIdentity'];require(type(runtime) is dict and set(runtime)==set(RUNTIME_KEYS),'Exported runtime identity missing')
        require(all(type(x) is str and x for x in runtime.values()) and runtime['githubJob']==name and runtime['githubSha']==expected_sha,'Wrong actual native job identity')
        groups[group]=value
    a,b=(groups[name] for name in ('payments','authority'))
    for key in ('fixtureCommonSha256','sourceBindingCommonSha256','commonIdentitySha256','runtimeNode'):
        require(a[key]==b[key],'Independent manual groups differ: '+key)
    for key in ('githubRunId','githubRunAttempt','githubWorkflow','githubSha','githubRef','githubRepository'):
        require(a['runtimeIdentity'][key]==b['runtimeIdentity'][key],'Manual groups belong to different CI invocations')
    require(a['reportSha256']!=b['reportSha256'],'One report was reused for independent groups')
    require(not set(a['completedCases'])&set(b['completedCases']),'Actual manual scenario groups overlap')
    require(sha(canonical(sorted(a['completedCases']+b['completedCases'])))==FULL_CENSUS_SHA256,'Actual union does not equal the complete original scenario census')
    return {'fixtureCommonSha256':a['fixtureCommonSha256'],'sourceBindingCommonSha256':a['sourceBindingCommonSha256'],
            'classification':'Complete actual report census and exact single-field byte projections; raw per-job fixture hashes are not claimed equal.',
            'rawFixtureSha256':{name:value['fixtureSha256'] for name,value in groups.items()},'fullCensusSha256':FULL_CENSUS_SHA256,'scenarioCount':66,
            'groups':{name:len(value['completedCases']) for name,value in groups.items()}}



def invocation(group):
    runtime={key:os.environ.get(env) for key,env in RUNTIME_KEYS.items()}
    runtime['githubJob']='manual-unit-'+group
    binding={key:os.environ.get(key) for key in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_REF','GITHUB_REPOSITORY')}
    binding['GITHUB_JOB']='manual-unit-'+group
    return runtime,binding


def read_regular(root,relative):
    target=root
    for part in Path(relative).parts:
        require(part not in ('..','/') and not target.is_symlink(),'Nonlocal or symlinked artifact input')
        target/=part
    require(target.is_file() and not target.is_symlink(),'Missing ordinary artifact input: '+relative)
    return target.read_bytes()


def verify_artifacts(jobs,roots,expected_sha,invocations):
    recomputed={}
    for group in ('payments','authority'):
        root=Path(roots[group]);runtime,binding_runtime=invocations[group]
        value=verify_report(read_regular(root,'manual-unit-evidence/manual-unit-browser-report.json'),
            read_regular(root,'manual-unit-source-evidence/native-fixture.json'),read_regular(root,'common-identity.json'),
            group,expected_sha,runtime,read_regular(root,'manual-unit-source-evidence/old-source-binding.json'),binding_runtime)
        original_outputs=jobs['manual-unit-'+group]['outputs']
        require(original_outputs['common-identity-sha256']==value['commonIdentitySha256'],'Actual artifact common identity differs from the original seven-job output: '+group)
        require(original_outputs['manual-fixture-sha256']==value['fixtureSha256'],'Actual artifact raw fixture digest differs from the original job output: '+group)
        claimed=strict_json(jobs['manual-unit-'+group]['outputs']['manual-census-json'])
        require(value==claimed,'Exported census/digests do not match recomputed original artifacts: '+group)
        require(strict_json(read_regular(root,'manual-unit-census.json'))==value,'Archived census differs from actual recomputation: '+group)
        common=strict_json(read_regular(root,'common-identity.json'))
        require(sha(read_regular(root,'manual-unit-source.zip'))==common['identity']['sourceZipSha256'],'Archived full source ZIP differs from common identity')
        report=strict_json(read_regular(root,'manual-unit-evidence/manual-unit-browser-report.json'))
        release=strict_json(read_regular(root,'dist/release.json'))
        require(report['releaseMetadata']==release,'Actual native release metadata differs from archived production')
        require(release['sourceSha']==expected_sha and release['version']=='0.6.32-alpha.1' and type(release['saveVersion']) is int and release['saveVersion']==9 and type(release['saveRevision']) is int and release['saveRevision']==16,'Actual production release identity differs')
        require(type(release['files']) is dict and len(release['files'])==62,'Complete 62-file production release required')
        actual={str(path.relative_to(root/'dist')):sha(read_regular(root,'dist/'+str(path.relative_to(root/'dist')))) for path in (root/'dist').rglob('*') if path.is_file()}
        require(len(actual)==63 and actual==common['identity']['assets'] and {key:value for key,value in actual.items() if key!='release.json'}==release['files'],'Actual full production assets differ from common identity')
        recomputed['manual-unit-'+group]={'result':jobs['manual-unit-'+group]['result'],'outputs':{
            'common-identity-sha256':value['commonIdentitySha256'],'manual-fixture-sha256':value['fixtureSha256'],
            'manual-census-json':canonical(value).decode()}}
    return verify_aggregate(recomputed,expected_sha)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    report=sub.add_parser('report')
    for name in ('report','fixture','source-binding','common-identity','output'):report.add_argument('--'+name,type=Path,required=True)
    report.add_argument('--group',choices=tuple(GROUP_CASES),required=True);report.add_argument('--expected-sha',required=True)
    aggregate=sub.add_parser('aggregate')
    aggregate.add_argument('--payments',type=Path,required=True);aggregate.add_argument('--authority',type=Path,required=True)
    aggregate.add_argument('--expected-sha',required=True);aggregate.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.command=='report':
        require(os.environ.get('GITHUB_JOB')=='manual-unit-'+args.group,'Actual report verifier job mismatch')
        runtime,binding=invocation(args.group)
        value=verify_report(args.report.read_bytes(),args.fixture.read_bytes(),args.common_identity.read_bytes(),args.group,args.expected_sha,runtime,args.source_binding.read_bytes(),binding)
        raw=canonical(value);args.output.write_bytes(raw+b'\n')
        with open(os.environ['GITHUB_OUTPUT'],'a',encoding='utf-8') as stream:
            stream.write('manual-fixture-sha256='+value['fixtureSha256']+'\n')
            stream.write('manual-census-json='+raw.decode()+'\n')
    else:
        jobs=strict_json(os.environ['JOB_RESULTS'])
        value=verify_artifacts(jobs,{name:getattr(args,name) for name in GROUP_CASES},args.expected_sha,{name:invocation(name) for name in GROUP_CASES})
        args.output.write_bytes(canonical(value)+b'\n')
    print(canonical(value).decode())


if __name__=='__main__':main()
