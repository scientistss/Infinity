"""Twelve successful jobs, unchanged eleven-job records, and separate solar proof.

The original three census commands still run independently. This adapter never
changes one of their records or treats a successful job as raw native evidence.
"""
import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import re

from energy_challenge_workflow import OLD_JOBS, NEW_JOBS
from energy_challenge_census import canonical, original, sha

LEGACY_JOBS = (*OLD_JOBS, *NEW_JOBS)
SOLAR_JOB = 'energy-solar-route'
REQUIRED_JOBS = (*LEGACY_JOBS, SOLAR_JOB)
SOLAR_SCHEMA = 'infinity-energy-challenge-solar-native-census-v1'
SOLAR_CASE = 'continuous-solar-newgame-to-third-queues'


def project_legacy_jobs(jobs):
    """Validate every actual job, then copy all original records without edits."""
    assert type(jobs) is dict and set(jobs) == set(REQUIRED_JOBS), 'Exactly twelve actual jobs required'
    unchanged=canonical(jobs)
    identities=[]
    for name in REQUIRED_JOBS:
        row=jobs[name]
        assert type(row) is dict and set(row)=={'result','outputs'}, ('Exact job record required',name)
        assert row['result']=='success', ('Mandatory job did not succeed',name,row['result'])
        assert type(row['outputs']) is dict, ('Exact job outputs required',name)
        identity=row['outputs'].get('common-identity-sha256')
        assert type(identity) is str and re.fullmatch('[0-9a-f]{64}',identity), ('Complete common identity required',name)
        identities.append(identity)
    assert len(set(identities))==1, 'All twelve source asset runtime identities must match'
    projected=deepcopy({name:jobs[name] for name in LEGACY_JOBS})
    assert canonical(jobs)==unchanged, 'Input job records must never be rewritten'
    assert canonical(projected)==canonical({name:jobs[name] for name in LEGACY_JOBS})
    return projected


def aggregate(solar_artifact, energy_census, expected_sha, jobs):
    """Reopen solar originals and compare the prior, independently rederived 68."""
    from energy_challenge_solar_census import validate
    legacy=project_legacy_jobs(jobs)
    assert re.fullmatch('[0-9a-f]{40}',expected_sha), 'Full exact source SHA required'
    root=Path(solar_artifact)
    solar=validate(root/'energy-solar-evidence',expected_sha)
    claimed=json.loads(original(root/'energy-solar-census.json'))
    assert claimed==solar, 'Declared solar census must equal independently reopened originals'
    assert solar['schema']==SOLAR_SCHEMA and solar['sourceSha']==expected_sha
    assert type(solar['caseCount']) is int and solar['caseCount']==1 and solar['caseId']==SOLAR_CASE
    common=legacy[LEGACY_JOBS[0]]['outputs']['common-identity-sha256']
    assert solar['commonIdentitySha256']==common
    output=jobs[SOLAR_JOB]['outputs']
    assert output.get('energy-solar-census-sha256')==sha(canonical(solar)), 'Exact original solar census hash required'
    assert output.get('energy-solar-case-count')=='1', 'Exactly one continuous solar route required'
    previous=json.loads(original(Path(energy_census)))
    assert set(previous)=={'schema','sourceSha','caseCount','lanes'}
    assert previous['schema']=='infinity-energy-challenge-native-aggregate-v1' and previous['sourceSha']==expected_sha
    assert type(previous['caseCount']) is int and previous['caseCount']==68
    lanes=previous['lanes']
    assert [row['lane'] for row in lanes]==['controls','lifecycle','migrations']
    assert [row['caseCount'] for row in lanes]==[18,35,15]
    assert all(row['sourceSha']==expected_sha and row['commonIdentitySha256']==common for row in lanes)
    assert len({row['runId'] for row in lanes})==3 and solar['runId'] not in {row['runId'] for row in lanes}
    documents=[doc for row in lanes for doc in row['documentIds']]
    assert len(documents)==len(set(documents))
    assert solar['documentCount']==len(solar['documentIds'])==len(set(solar['documentIds']))==23
    assert not set(solar['documentIds']).intersection(documents), 'Solar native documents cannot reuse the 68-case documents'
    # Bind each already rederived old lane to its complete original job output.
    for name,row in zip(NEW_JOBS,lanes):
        assert legacy[name]['outputs']['energy-census-sha256']==sha(canonical(row))
        assert legacy[name]['outputs']['energy-case-count']==str(row['caseCount'])
    return {'schema':'infinity-energy-challenge-solar-native-aggregate-v1','sourceSha':expected_sha,
            'mandatoryJobCount':12,'commonIdentitySha256':common,'originalEnergyCaseCount':68,
            'originalEnergyCensusSha256':sha(canonical(previous)),'solar':solar}


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    commands.add_parser('project-legacy-jobs')
    child=commands.add_parser('aggregate')
    child.add_argument('--solar-artifact',type=Path,required=True)
    child.add_argument('--energy-census',type=Path,required=True)
    child.add_argument('--expected-sha',required=True)
    child.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(argv)
    jobs=json.loads(os.environ['JOB_RESULTS'])
    if args.command=='project-legacy-jobs':
        print(canonical(project_legacy_jobs(jobs)).decode())
    else:
        result=aggregate(args.solar_artifact,args.energy_census,args.expected_sha,jobs)
        with args.output.open('x') as output:output.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
