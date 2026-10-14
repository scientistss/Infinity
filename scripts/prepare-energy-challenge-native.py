#!/usr/bin/env python3
"""Compose the fixed 68-case native plan from immutable producer originals.

Python-only preparation. Executes no producer/JavaScript/game code and grants no
acceptance. Final clean source identity is required across all input producers.
"""
import argparse
import json
import importlib.util
from pathlib import Path
from energy_challenge_census import (ACTIONS, CONTROLS, LIFECYCLE, MIGRATIONS, RETIREMENTS,
    WIDTHS, LANES, PLAN_SCHEMA, canonical, original, reference, sha, validate_plan, validate_migration_manifest)


def build(natural_path, supplement_path, migrations_path, expected_sha, runtime_node):
    for checker_path,source_path in [('check-energy-challenge-natural.py',natural_path),('check-energy-challenge-native-branches.py',supplement_path)]:
        spec=importlib.util.spec_from_file_location('native_preparation_checker',Path(__file__).with_name(checker_path))
        checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
        checker.run(Path(source_path).resolve().parent,require_clean=True)
    roots=[Path(p).resolve().parent for p in (natural_path,supplement_path,migrations_path)]
    natural,supplements,migrations=[json.loads(original(p)) for p in (natural_path,supplement_path,migrations_path)]
    assert natural['schema']=='energy-challenge-natural-v1' and natural['status']=='passed'
    assert natural['sourceSha']==supplements['sourceSha']==expected_sha
    assert natural['sourceClassification']=='clean-candidate-source' and natural['dirtyPaths']==[], 'Diagnostic dirty route is not a release input'
    assert natural['nodeVersion']==supplements['runtimeNode']==runtime_node
    assert supplements['schema']=='infinity-energy-challenge-native-supplements-v1'
    assert migrations['schema']=='infinity-energy-challenge-migration-fixtures-v2'
    assert migrations['status']=='prepared' and migrations['producer']['node']==runtime_node
    assert migrations['missingArchivedInputs']==[] and migrations['allowedAddedStateFields']==['energyChallenge']
    validate_migration_manifest(migrations,runtime_node)
    assert migrations['producer']['sha256']==sha(original(Path(__file__).with_name('energy-challenge-migration-fixtures.mjs')))
    cases={}
    def file(root,ref):
        result=reference(root/ref['file']);assert result['sha256']==ref['sha256']
        if 'bytes' in ref:assert result['bytes']==ref['bytes']
        return result
    routes={r['policy']:r for r in natural['routes']}
    def cp(name,policy='solar'):return file(roots[0],routes[policy]['checkpoints'][name])
    def baseline(ident,name,policy='solar',classification='natural-producer-checkpoint-native-replay'):
        source=cp(name,policy)
        return {'id':ident,'epoch':json.loads(original(source['file']))['savedAt'],'classification':classification,'input':source,'initialExpected':source}
    def input_step(ref):return {'kind':'import','input':ref,'expected':ref}
    def proof_steps(policy):
        result=[]
        for row in routes[policy]['nativeProofSteps']:
            step={'kind':row['kind'],'expected':cp(row['checkpoint'],policy)}
            if row['kind']=='build':step['id']=row['building']
            else:step['seconds']=row['seconds']
            result.append(step)
        return result
    for policy in routes:
        case=baseline('natural-'+policy,'entry-ready',policy)
        steps=[{'kind':'challenge','action':'enter','expected':cp('entered',policy)},*proof_steps(policy),
               input_step(cp('finish-ready',policy)),{'kind':'challenge','action':'finish','expected':cp('completed',policy)}]
        for kind in ('build','research'):
            before,after=cp('before-third-'+kind+'-paid',policy),cp('third-'+kind+'-paid',policy)
            state=json.loads(original(after['file']))['state']
            job=(state['planets'][0]['buildQueue'] if kind=='build' else state['research']['queue'])[-1]
            steps.extend([input_step(before),{'kind':kind,'id':job['building' if kind=='build' else 'tech'],'thirdQueue':True,'expected':after},
                          {'kind':'reload','expected':cp('third-'+kind+'-paid-reloaded',policy)}])
        case.update(steps=steps,finalExpected=cp('third-research-paid-reloaded',policy),naturalPolicy=policy)
        cases[case['id']]=case
    case=baseline('paid-proof-score','entered');case.update(steps=proof_steps('solar'),finalExpected=cp('proof-deuterium_synth-completed'));cases[case['id']]=case
    phases={'enter':'entry-ready','abandon':'active-progress','finish':'finish-ready'}
    for width in WIDTHS:
        case=baseline('responsive-'+str(width),'entry-ready')
        case.update(width=width,phases=[{'action':action,'input':cp(name),'expected':cp(name)} for action,name in phases.items()]);cases[case['id']]=case
    for action,name in phases.items():
        case=baseline('dialog-cancel-'+action,name)
        case.update(steps=[{'kind':'challenge','action':action,'accept':False,'expected':cp(name)}],finalExpected=cp(name));cases[case['id']]=case
        for reason in RETIREMENTS:
            if reason=='active-planet-aba':continue
            case=baseline(action+'-'+reason,name,classification='explicit-adversarial-lifecycle');case['action']=action
            cases[case['id']]=case
        for fault in ('storage-write-failure','storage-readback-failure'):
            case=baseline(action+'-'+fault,name,classification='explicit-adversarial-lifecycle');case['action']=action
            candidate={'enter':'entered','abandon':'abandoned','finish':'completed'}[action]
            case['faultExpected']=cp(name if fault=='storage-write-failure' else candidate);cases[case['id']]=case
    case=baseline('completion-reload','completed');case.update(steps=[{'kind':'reload','expected':cp('completed')}],finalExpected=cp('completed'));cases[case['id']]=case
    def resolve_refs(value):
        if isinstance(value,dict):
            if set(value)>={'file','sha256','bytes'}:return file(roots[1],value)
            return {key:resolve_refs(item) for key,item in value.items()}
        if isinstance(value,list):return list(map(resolve_refs,value))
        return value
    supplied=set()
    for case in supplements['cases']:
        assert case['id'] in (*CONTROLS,*LIFECYCLE) and case['id'] not in supplied
        supplied.add(case['id']);cases[case['id']]=resolve_refs(case)
    invalid=supplements.get('invalidInput')
    if invalid is not None:invalid=file(roots[1],invalid)
    else:
        external=cases.get('external-storage-protection',{}).get('externalInput')
        assert external and not json_valid(original(external['file'])), 'Exact malformed raw required for invalid native file selection'
        invalid=external
    for action in ACTIONS:cases[action+'-invalid-import']['invalidInput']=invalid
    rows=migrations['cases']
    for revision in range(2,15):
        row=next(r for r in rows if r['revision']==revision and r['id'].endswith('-positive-61_25-seconds'))
        source=reference(roots[2]/row['sourceFile']);assert source['sha256']==row['sourceSha256'] and source['bytes']==row['sourceBytes']
        oracle=reference(roots[2]/row['oracleFile']);assert oracle['sha256']==row['oracleSha256']
        expected=reference(roots[2]/row['expectedStateFile']);assert expected['sha256']==row['expectedStateSha256']
        cases['migrate-r'+str(revision)]={'id':'migrate-r'+str(revision),'classification':'genuine-historical-migration',
            'epoch':row['now'],'revision':revision,'input':source,'initialExpected':expected,'historicalOracle':oracle,
            'offlineSeconds':row['clock']['rawGapSeconds'],'realClockTrace':revision==14}
    for ident,source_id in [('unknown-r15','unknown-r15'),('malformed-r16-completion','malformed-r16-completion-receipt')]:
        row=next(r for r in rows if r['id']==source_id)
        source=reference(roots[2]/row['sourceFile']);assert source['sha256']==row['sourceSha256'] and source['bytes']==row['sourceBytes']
        cases[ident]={'id':ident,'epoch':row['now'],'classification':'protected-malformed-input','input':source,'expectedMode':'protected'}
    assert set(cases)==set((*CONTROLS,*LIFECYCLE,*MIGRATIONS)), ('missing/extra fixed cases',set((*CONTROLS,*LIFECYCLE,*MIGRATIONS))-set(cases),set(cases)-set((*CONTROLS,*LIFECYCLE,*MIGRATIONS)))
    plan={'schema':PLAN_SCHEMA,'sourceSha':expected_sha,'runtimeNode':runtime_node,
          'classification':'compressed-logical-time-native-browser; not-whole-human-play',
          'producerOriginals':{'natural':reference(natural_path),'supplements':reference(supplement_path),'migrations':reference(migrations_path)},
          'cases':[cases[ident] for lane in LANES.values() for ident in lane]}
    validate_plan(plan,Path.cwd())
    return plan


def json_valid(raw):
    try:json.loads(raw);return True
    except (ValueError,UnicodeError):return False


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('natural','supplements','migrations','expected-sha','runtime-node','output'):parser.add_argument('--'+key,required=True)
    args=parser.parse_args();plan=build(args.natural,args.supplements,args.migrations,args.expected_sha,args.runtime_node)
    with Path(args.output).open('xb') as handle:handle.write(canonical(plan)+b'\n')
    print(json.dumps({'plan':reference(args.output),'caseCount':len(plan['cases'])}))


if __name__=='__main__':main()
