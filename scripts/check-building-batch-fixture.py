#!/usr/bin/env python3
"""Independent literal payment/census/source check for the new natural fixture.

This validates reported domain evidence; it never upgrades it to browser or CI
acceptance. No historical fixture or legacy generator is imported or executed.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONEY_ZERO = {'metal': '0', 'crystal': '0', 'deuterium': '0'}
PRICES = {'metal_storage': {'metal': '1000', 'crystal': '0', 'deuterium': '0'},
          'deuterium_tank': {'metal': '1000', 'crystal': '1000', 'deuterium': '0'}}
REJECTION_CASES = {'missing-later-planet-budget', 'duplicate-payer', 'unknown-later-payer',
                   'extra-later-budget-resource', 'stale-task-counter', 'stale-template-revision',
                   'stale-review', 'single-payer-is-not-a-batch'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def validate(report, directory, require_clean=False):
    assert report['schema'] == 'infinity-building-batch-natural-fixture-v1'
    assert report['status'] == 'passed'
    assert report['classification'] == 'independent-natural-domain-route-with-compressed-logical-seconds; not-native-browser-evidence'
    source = report['provenance']
    assert source['sourceInput'] == {'kind': 'createInitialState', 'worldSeed': 20261013,
        'arcadeSeed': 31415926, 'importedReports': [], 'importedSaves': [], 'stockGrants': [], 'directStatePatches': []}
    if require_clean:
        assert source['classification'] == 'clean-candidate-source' and not source['dirtyPaths']
    manifest_bytes = json.dumps(source['sourceFiles'], separators=(',', ':'), ensure_ascii=False).encode()
    assert sha(manifest_bytes) == source['sourceManifestSha256']
    assert report['planetIds'] == [report['homeId'], report['colonyId']]
    assert report['homeId'] == 'homeworld' and report['colonyId'].startswith('colony-')
    assert len(set(report['planetIds'])) == 2
    assert report['goldens']['perPlanet'] == {'metal': '2000', 'crystal': '1000', 'deuterium': '0'}
    assert report['goldens']['total'] == {'metal': '4000', 'crystal': '2000', 'deuterium': '0'}
    assert report['goldens']['taskCount'] == report['goldens']['paidJobCount'] == 4
    assert report['goldens']['newSchemaFields'] == []
    assert {row['building']: row['paid'] for row in report['goldens']['rows']} == PRICES
    assert all(row['targetLevel'] == 1 for row in report['goldens']['rows'])
    receipts = report['receipts']
    assert receipts[0]['api'] == 'createInitialState' and receipts[0]['before'] is None
    assert receipts[0]['request'] == {'worldSeed': 20261013, 'arcadeSeed': 31415926}
    assert receipts[0]['after']['wallets'] == {'homeworld': {'metal': '500', 'crystal': '500', 'deuterium': '0'}}
    assert receipts[0]['after']['stateSha256'] == report['initialStateSha256']
    allowed = {'createInitialState', 'enqueue', 'enqueueResearch', 'orderUnits', 'sendFleet',
               'tick', 'createBuildingTemplate', 'applyBuildingTemplateBatch', 'strictExportImport'}
    counted_seconds = 0
    for index, receipt in enumerate(receipts):
        assert receipt['index'] == index + 1
        assert receipt['api'] in allowed, receipt['api']
        if index:
            assert receipt['before'] == receipts[index - 1]['after'], ('broken action chain', index)
        if receipt['api'] == 'tick':
            args = receipt['request']
            assert args['secondsPerCall'] == 1 and args['mode'] == 'live'
            assert type(args['calls']) is int and args['calls'] > 0
            counted_seconds += args['calls']
            assert receipt['after']['logicalSeconds'] - receipt['before']['logicalSeconds'] == args['calls']
        elif index:
            assert receipt['after']['logicalSeconds'] == receipt['before']['logicalSeconds']
        if receipt.get('ok') is False:
            assert receipt['before'] == receipt['after']
            assert receipt['createdTaskIds'] == []
    assert counted_seconds == report['logicalSeconds'] <= 14400
    assert {case['name'] for case in report['negativeResults']} == REJECTION_CASES
    assert all(case['stateUnchanged'] and case['returnedOriginalIdentity'] for case in report['negativeResults'])
    assert {receipt['case'] for receipt in receipts if receipt.get('ok') is False} == REJECTION_CASES | {'duplicate-confirmation'}
    fleet = [receipt for receipt in receipts if receipt['api'] == 'sendFleet']
    assert len(fleet) == 1 and fleet[0]['request']['mission'] == 'colonize'
    assert fleet[0]['request']['ships'] == {'colony_ship': 1}
    assert fleet[0]['request']['cargo'] == {'metal': '2300', 'crystal': '1300', 'deuterium': '0'}
    research = [receipt['request']['tech'] for receipt in receipts if receipt['api'] == 'enqueueResearch']
    assert research == ['energy_tech'] + ['impulse_drive'] * 3 + ['espionage_tech'] * 4 + ['astrophysics']
    assert all(job['source'] == 'manual' for job in report['paidJobs'] if job['taskId'] is None)
    assert [job['jobId'] for job in report['paidJobs']] == list(range(1, receipts[-1]['after']['nextJobId']))
    jobs = report['batchPaidJobs']
    assert len(jobs) == 4 and {job['taskId'] for job in jobs} == {1, 2, 3, 4}
    assert {(job['planetId'], job['building']) for job in jobs} == {(planet, building) for planet in report['planetIds'] for building in PRICES}
    for job in jobs:
        assert job['paid'] == PRICES[job['building']]
        assert job['source'] == 'plan' and job['targetLevel'] == 1 and job['kind'] == 'building'
    assert set(report['checkpoints']) == {'ready', 'authorized', 'paid', 'completed', 'no-replay'}
    for name, checkpoint in report['checkpoints'].items():
        raw = (directory / checkpoint['file']).read_bytes()
        assert sha(raw) == checkpoint['sha256']
        envelope = json.loads(raw)
        assert envelope == report[{'no-replay': 'noReplay'}.get(name, name)]
        assert envelope['version'] == 9 and envelope['revision'] == 14
        assert len(envelope['state']['planets']) == 2
    paid_state = report['paid']['state']
    assert report['checkpoints']['paid']['logicalSeconds'] == 2487
    assert len(paid_state['orders']['tasks']) == 4
    for job in report['batchPaidJobs']:
        task = next(task for task in paid_state['orders']['tasks'] if task['id'] == job['taskId'])
        assert task['activeJob'] == {'jobId': job['jobId'], 'quantity': 1, 'credited': 0}
        assert task['kind'] == 'building' and task['planetId'] == job['planetId'] and task['building'] == job['building'] and task['targetLevel'] == 1
        assert task['status'] == 'running' and task['completedUnits'] == 0
        assert task['budget'] == task['charged'] == PRICES[job['building']] and task['refunded'] == MONEY_ZERO
        assert task['transport'] is None and task['formationOrigin'] is None
    ready = report['ready']['state']
    authorized = report['authorized']['state']
    completed = report['completed']['state']
    assert ready['orders']['tasks'] == []
    assert authorized['orders']['nextTaskId'] == completed['orders']['nextTaskId'] == 5
    assert all(task['charged'] == MONEY_ZERO for task in authorized['orders']['tasks'])
    assert [{key: planet[key] for key in ('id', 'resources', 'buildQueue')} for planet in ready['planets']] == [{key: planet[key] for key in ('id', 'resources', 'buildQueue')} for planet in authorized['planets']]
    assert report['noReplay']['state']['orders']['tasks'] == completed['orders']['tasks']
    for task in completed['orders']['tasks']:
        assert task['status'] == 'completed' and task['budget'] == task['charged'] == PRICES[task['building']]
        assert task['refunded'] == MONEY_ZERO and task['transport'] is None and task['formationOrigin'] is None
    assert [branch['count'] for branch in report['syntheticBoundaries']] == [3, 4]
    for branch in report['syntheticBoundaries']:
        count = branch['count']
        assert branch['classification'] == 'synthetic-legal-capacity-boundary; not-natural-colonization'
        assert branch['provenance']['stockGrants'] == [] and branch['provenance']['addedPlanetsVia'] == 'createPlanet'
        assert branch['expectedTaskCount'] == count * 2
        assert len(branch['planetIds']) == len(set(branch['planetIds'])) == count
        assert len(branch['ready']['state']['planets']) == count
        assert branch['ready']['state']['research']['levels']['astrophysics'] == count * 2 - 3
        assert branch['ready']['state']['orders']['tasks'] == []
        assert len(branch['authorized']['state']['orders']['tasks']) == count * 2
        assert branch['ready']['state']['planets'] == branch['authorized']['state']['planets']
        assert all(task['budget'] == task['charged'] == MONEY_ZERO for task in branch['authorized']['state']['orders']['tasks'])
        for file_key, hash_key, envelope_key in [('file', 'sha256', 'ready'), ('expectedFile', 'expectedSha256', 'authorized')]:
            raw = (directory / branch[file_key]).read_bytes()
            assert sha(raw) == branch[hash_key] and json.loads(raw) == branch[envelope_key]
    variants = report['lifecycleVariants']
    assert set(variants) == {'renamed', 'deleted', 'capacity-blocked', 'selected-colony-authorized'}
    for name, branch in variants.items():
        raw = (directory / branch['file']).read_bytes()
        assert sha(raw) == branch['sha256'] and json.loads(raw) == branch['envelope']
        assert branch['classification'] == 'public-API-branch-from-independent-natural-ready-source; not-browser-evidence'
        assert len(branch['envelope']['state']['planets']) == 2
    renamed = variants['renamed']['envelope']['state']
    assert renamed['buildingTemplates']['templates'][0]['revision'] == 2
    assert renamed['buildingTemplates']['templates'][0]['name'] == '已改名双星仓储验收'
    assert renamed['orders'] == ready['orders'] and renamed['planets'] == ready['planets']
    deleted = variants['deleted']['envelope']['state']
    assert deleted['buildingTemplates']['templates'] == [] and deleted['orders'] == ready['orders'] and deleted['planets'] == ready['planets']
    capacity = variants['capacity-blocked']['envelope']['state']
    assert len(capacity['orders']['tasks']) == 29 and len(variants['capacity-blocked']['actions']) == 58
    assert all(task['status'] == 'paused' and task['budget'] == task['charged'] == MONEY_ZERO and task['building'] not in PRICES for task in capacity['orders']['tasks'])
    assert capacity['planets'] == ready['planets']
    selected = variants['selected-colony-authorized']['envelope']['state']
    assert selected['activePlanetId'] == report['colonyId']
    normalized = copy.deepcopy(selected); normalized['activePlanetId'] = report['homeId']
    assert normalized == authorized
    return {'status': 'passed', 'kind': 'domain-evidence-only', 'actionReceiptCount': len(receipts),
            'naturalPaidJobCount': len(report['paidJobs']) - 4, 'batchPaidJobCount': 4,
            'atomicRejectionCount': len(REJECTION_CASES) + 1, 'logicalSeconds': counted_seconds}


def check_sources(report):
    files = report['provenance']['sourceFiles']
    assert len({entry['path'] for entry in files}) == len(files)
    expected = {str(path.relative_to(ROOT)) for path in (ROOT / 'src').rglob('*') if path.is_file()} | {'package.json', 'package-lock.json', 'scripts/building-batch-natural-fixture.mjs'}
    assert {entry['path'] for entry in files} == expected
    for entry in files:
        path = ROOT / entry['path']
        assert path.resolve().is_relative_to(ROOT) and path.is_file() and not path.is_symlink()
        assert sha(path.read_bytes()) == entry['sha256'], ('producer source changed', entry['path'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--require-clean', action='store_true')
    parser.add_argument('--check-current-source', action='store_true')
    parser.add_argument('--mutation-self-test', action='store_true')
    args = parser.parse_args()
    raw = args.fixture.read_bytes()
    report = json.loads(raw)
    result = validate(report, args.fixture.parent, args.require_clean)
    if args.check_current_source:
        check_sources(report)
    if args.mutation_self_test:
        mutations = [lambda r: r['goldens']['total'].update(metal='3999'),
                     lambda r: r['provenance']['sourceInput']['stockGrants'].append('invented'),
                     lambda r: r['batchPaidJobs'][0].update(planetId='wrong-payer'),
                     lambda r: r['negativeResults'].pop(),
                     lambda r: r['receipts'][1]['before'].update(stateSha256='0' * 64),
                     lambda r: r['receipts'][0]['after']['wallets']['homeworld'].update(metal='1000000')]
        for mutation in mutations:
            changed = copy.deepcopy(report)
            mutation(changed)
            try:
                validate(changed, args.fixture.parent, args.require_clean)
            except AssertionError:
                pass
            else:
                raise AssertionError('Mutation was not rejected')
        result['mutationCasesRejected'] = len(mutations)
    result['fixtureSha256'] = sha(raw)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
