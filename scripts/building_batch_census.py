#!/usr/bin/env python3
"""Recompute the fixed native census from original same-run artifact bytes.

Report mode validates before emitting a GitHub output. Aggregate mode reopens
all original source/fixture/native evidence from the downloaded artifact and
recomputes exactly the same census; report flags alone never constitute proof.
"""
import argparse
import hashlib
import importlib.util
import json
import io
import stat
import zipfile
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ('natural-payments-reload-no-replay', 'natural-unobserved-control', 'responsive-320', 'responsive-390', 'responsive-768', 'responsive-1440',
             'synthetic-three-planets', 'synthetic-four-planets', 'single-planet-blocked',
             'cloned-confirm', 'silent-budget-change', 'detached-confirm', 'ancestor-detach-reinsert',
             'tab-away-back', 'active-planet-aba', 'cancel-review', 'cancelled-import',
             'invalid-import', 'template-rename-stale', 'template-delete-stale', 'order-capacity-blocked', 'active-selection-fixed-payers', 'storage-write-failure', 'storage-readback-failure', 'external-storage-protection')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def original(path):
    assert path.is_file() and not path.is_symlink(), ('missing/nonordinary original', path)
    return path.read_bytes()


def load(path):
    return json.loads(original(path))


def resolve_reference(root, reference):
    name = reference['file']
    assert isinstance(name, str) and name and not Path(name).is_absolute() and '..' not in Path(name).parts
    path = root / name
    assert path.resolve().is_relative_to(root.resolve())
    raw = original(path)
    assert sha(raw) == reference['sha256'] and len(raw) == reference['bytes'], name
    return raw


def fixture_oracle(fixture, directory):
    spec = importlib.util.spec_from_file_location('building_batch_fixture_oracle', ROOT / 'scripts/check-building-batch-fixture.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.validate(fixture, directory, require_clean=True)


def census(report_path, fixture_path, common_path, expected):
    assert re.fullmatch('[0-9a-f]{40}', expected)
    report_raw, fixture_raw, common_raw = map(original, (report_path, fixture_path, common_path))
    report, fixture, common = map(json.loads, (report_raw, fixture_raw, common_raw))
    domain = fixture_oracle(fixture, fixture_path.parent)
    assert report['schema'] == 'infinity-building-batch-native-v1'
    assert report['completed'] is True and report['result'] == 'passed'
    assert report['sourceSha'] == fixture['provenance']['sourceSha'] == common['identity']['source']['sourceSha'] == expected
    assert fixture['provenance']['fullTree'] == common['identity']['source']['fullTree']
    assert report['fixtureSha256'] == sha(fixture_raw)
    assert report['commonIdentitySha256'] == sha(common_raw)
    assert report['runtimeNode'] == fixture['provenance']['runtimeNode'] == common['identity']['runtimeNode']
    assert re.fullmatch(r'v22\.\d+\.\d+', report['runtimeNode'])
    assert common['identitySha256'] == sha(canonical(common['identity']))
    source_inventory = common['identity']['source']['sourceCode']
    assert report['sourceScripts'] == {path: source_inventory[path] for path in report['sourceScripts']}
    for entry in fixture['provenance']['sourceFiles']:
        assert entry['sha256'] == source_inventory[entry['path']], ('fixture source mismatch', entry['path'])
    assert report['budgetSeconds'] == 630 and report['hostElapsedSeconds'] < 630
    supervisor = report['supervisor']
    assert supervisor['budgetSeconds'] == 650 and not supervisor['expired'] and not supervisor['error']
    assert supervisor['workerExitCode'] == 0 and not supervisor['survivors']
    assert report['errors'] == []
    assert report['fixedScenarioCensus'] == list(SCENARIOS)
    assert [row['id'] for row in report['scenarios']] == list(SCENARIOS)
    assert all(row['completed'] is True for row in report['scenarios'])
    evidence = report['evidence']
    assert len({row['file'] for row in evidence}) == len(evidence)
    by_name = {row['file']: row for row in evidence}
    for reference in evidence:
        resolve_reference(report_path.parent, reference)
    release = json.loads(resolve_reference(report_path.parent, report['release']))
    assert release['sourceSha'] == expected and release['version'] == report['version']
    assert release['saveVersion'] == 9 and release['saveRevision'] == 14
    assert report['release']['sha256'] == common['identity']['releaseSha256']
    assert len(report['assets']) == len(release['files'])
    assert {row['file']: row['sha256'] for row in report['assets']} == release['files']
    for row in report['assets']:
        assert row['sha256'] == row['releaseSha256'] == row['commonSha256'] == common['identity']['assets'][row['file']]
        assert sha(resolve_reference(report_path.parent, row['httpOriginal'])) == row['sha256']
    assert report['checks'] and all(check['passed'] is True for check in report['checks'])
    completed_scenarios = []
    for row in report['scenarios']:
        ident = row['id']
        checks = [check for check in report['checks'] if check['scenario'] == ident]
        assert len(checks) >= 8, ('missing scenario assertions', ident)
        scopes = row['eventScopes']
        assert len(scopes) == (2 if ident in ('natural-payments-reload-no-replay', 'natural-unobserved-control') else 1)
        assert len({scope['documentId'] for scope in scopes}) == len(scopes)
        assert [scope['navigationSequence'] for scope in scopes] == list(range(1, len(scopes) + 1))
        actual_events = []
        for scope in scopes:
            original_scope = json.loads(resolve_reference(report_path.parent, scope['original']))
            assert original_scope['documentId'] == scope['documentId'] and original_scope['navigationSequence'] == scope['navigationSequence']
            assert original_scope['nativeStorage'] and original_scope['nativeFile'] and original_scope['nativeConfirm']
            actual_events.extend(dict(event, documentId=scope['documentId'], navigationSequence=scope['navigationSequence']) for event in original_scope['events'])
        assert row['events'] == actual_events
        assert row['executedSources'] and all(group for group in row['executedSources'])
        assert len(row['executedSources']) == len(scopes)
        for group_index, group in enumerate(row['executedSources']):
            assert len({source['file'] for source in group}) == len(group)
            for source in group:
                assert source['httpSha256'] == source['v8Sha256'] == source['releaseSha256'] == release['files'][source['file']]
                assert sha(resolve_reference(report_path.parent, source['httpOriginal'])) == source['httpSha256']
                assert sha(resolve_reference(report_path.parent, source['v8Original'])) == source['v8Sha256']
                assert source['documentId'] == scopes[group_index]['documentId'] and source['navigationSequence'] == scopes[group_index]['navigationSequence']
        assert any(event['kind'] == 'change' and event['trusted'] and event.get('file') for event in row['events'])
        assert any(event['kind'] == 'click' and event['trusted'] and event.get('action') == 'export' for event in row['events'])
        trusted_applies = [event for event in row['events'] if event['kind'] == 'click' and event['trusted'] and event.get('id') == 'building-template-batch-apply']
        expected_applies = 2 if ident in ('natural-payments-reload-no-replay', 'natural-unobserved-control') else 1 if ident in ('synthetic-three-planets', 'synthetic-four-planets', 'active-selection-fixed-payers', 'storage-write-failure', 'storage-readback-failure') else 0
        assert len(trusted_applies) == expected_applies, ('wrong actual native confirmation census', ident)
        file_selections = [event for event in row['events'] if event['kind'] == 'change' and event['trusted'] and event.get('file')]
        assert len(file_selections) == (2 if ident == 'cancelled-import' else 1)
        if ident != 'single-planet-blocked':
            assert any(event['kind'] == 'click' and event['trusted'] and event.get('id') == 'building-template-batch-review' for event in row['events'])
        snapshots = {}
        for reference in row['rawSnapshots']:
            assert reference['file'] in by_name and by_name[reference['file']]['scenario'] == ident
            snapshots[reference['label']] = json.loads(resolve_reference(report_path.parent, reference))
        assert len(snapshots) == len(row['rawSnapshots']), ('duplicate snapshot label', ident)
        expected_ready = fixture['ready']['state']
        expected_after = expected_ready
        if ident.startswith('synthetic-'):
            count = 3 if 'three' in ident else 4
            variant = next(item for item in fixture['syntheticBoundaries'] if item['count'] == count)
            expected_ready = variant['ready']['state']; expected_after = variant['authorized']['state']
            assert row['expectedTaskCount'] == count * 2
            assert set(snapshots) == {'imported', 'authorized'}
            assert snapshots['authorized']['state'] == expected_after
        elif ident in ('natural-payments-reload-no-replay', 'natural-unobserved-control'):
            assert set(snapshots) == {'imported', 'authorized', 'duplicate', 'completed', 'no-replay', 'completed-noop'}
            for label, expected_state in (('authorized', fixture['authorized']['state']), ('duplicate', fixture['authorized']['state']),
                                          ('completed', fixture['completed']['state']), ('no-replay', fixture['noReplay']['state']), ('completed-noop', fixture['noReplay']['state'])):
                assert snapshots[label]['state'] == expected_state, (ident, label)
            expected_after = fixture['noReplay']['state']
        elif ident == 'order-capacity-blocked':
            expected_ready = fixture['lifecycleVariants']['capacity-blocked']['envelope']['state']; expected_after = expected_ready
            assert len(expected_ready['orders']['tasks']) == 29
            assert set(snapshots) == {'imported', 'after-attempt'} and snapshots['after-attempt']['state'] == expected_ready
        elif ident == 'active-selection-fixed-payers':
            expected_after = fixture['lifecycleVariants']['selected-colony-authorized']['envelope']['state']
            assert set(snapshots) == {'imported', 'authorized'} and snapshots['authorized']['state'] == expected_after
        elif ident in ('template-rename-stale', 'template-delete-stale'):
            expected_after = fixture['lifecycleVariants']['renamed' if ident == 'template-rename-stale' else 'deleted']['envelope']['state']
            assert set(snapshots) == {'imported', 'template-modified', 'after-attempt'}
            assert snapshots['template-modified']['state'] == snapshots['after-attempt']['state'] == expected_after
            button = 'building-template-save' if ident == 'template-rename-stale' else 'building-template-confirm-delete'
            assert len([event for event in row['events'] if event['kind'] == 'click' and event['trusted'] and event['id'] == button]) == 1
        elif ident.startswith('storage-'):
            assert set(snapshots) == {'imported', 'uncertain-disk'}
            expected_disk = fixture['authorized']['state'] if ident == 'storage-readback-failure' else expected_ready
            assert snapshots['uncertain-disk']['state'] == expected_disk
            assert json.loads(resolve_reference(report_path.parent, row['protectedVisibleOrders']))['rows'] == []
        elif ident == 'external-storage-protection':
            assert set(snapshots) == {'imported', 'external-original'}
            assert snapshots['external-original']['revision'] == 999
            assert snapshots['external-original']['state'] == expected_ready
        else:
            assert set(snapshots) == {'imported', 'after-attempt'}
            assert snapshots['after-attempt']['state'] == expected_ready
        assert snapshots['imported']['state'] == expected_ready
        observations = row.get('engineObservations', [])
        if ident == 'natural-unobserved-control':
            assert not observations and not row.get('observerBindings') and not row['paidJobObservations']
        else:
            assert row['observerBindings'] and len(row['observerBindings']) == len(scopes)
            retirements = row.get('observerRetirements', [])
            assert len(retirements) == (1 if ident == 'natural-payments-reload-no-replay' else 0)
            for retirement, prior in zip(retirements, row['observerBindings']):
                original_retirement = json.loads(resolve_reference(report_path.parent, retirement['original']))
                assert original_retirement == {key: retirement[key] for key in ('documentId', 'navigationSequence', 'breakpointId')} | {'method': 'Debugger.removeBreakpoint', 'response': {}}
                assert retirement['documentId'] == prior['documentId'] and retirement['navigationSequence'] == prior['navigationSequence']
                assert retirement['breakpointId'] == prior['binding']['breakpointId']
            for binding, scope in zip(row['observerBindings'], scopes):
                assert binding['documentId'] == scope['documentId'] and binding['navigationSequence'] == scope['navigationSequence']
                sources = [source for group in row['executedSources'] for source in group if source['file'] == binding['sourceFile'] and source['documentId'] == binding['documentId']]
                assert len(sources) == 1
                code = resolve_reference(report_path.parent, sources[0]['v8Original']).decode()
                observer_spec = importlib.util.spec_from_file_location('batch_census_readonly_shapes', ROOT / 'scripts/browser-ring-protection.py')
                observer_module = importlib.util.module_from_spec(observer_spec); observer_spec.loader.exec_module(observer_module)
                handlers = observer_module.production_action_handlers(code); serializers = observer_module.production_serializers(code)
                assert len(handlers) == len(serializers) == 1
                assert handlers[0].group('state') == binding['stateName'] and handlers[0].group('session') == binding['sessionName'] and serializers[0].group('name') == binding['serializer']
                serializer, state_name, session = binding['serializer'], binding['stateName'], binding['sessionName']
                expected_expression = f'(globalThis.__batchObserveRequested&&(globalThis.__batchLive=JSON.stringify({{state:{serializer}({state_name}),mode:{session}.mode,expectedRaw:{session}.expectedRaw,protectedRaw:{session}.protectedRaw,frameAt:performance.now(),wallAt:Date.now(),documentId:globalThis.__batchWitness.documentId,navigationSequence:globalThis.__batchWitness.navigationSequence}}),globalThis.__batchObserveRequested=false),false)'
                assert binding['expression'] == expected_expression and len(binding['binding']['locations']) == 1
                frames = list(re.finditer(r'window\.requestAnimationFrame\(([\w$]+)\);window\.setInterval', code)); assert len(frames) == 1
                declaration = re.search(r'function ' + re.escape(frames[0].group(1)) + r'\([\w$]+\)\{', code); assert declaration
                assert binding['position'] == declaration.end() and binding['line'] == code.count('\n', 0, binding['position']) and binding['column'] == binding['position'] - (code.rfind('\n', 0, binding['position']) + 1)
            assert observations and observations[0]['label'] == 'initial'
            assert json.loads(resolve_reference(report_path.parent, observations[0]))['state'] == expected_ready
            for observation in observations:
                observed = json.loads(resolve_reference(report_path.parent, observation))
                assert observed['documentId'] in {scope['documentId'] for scope in scopes}
                assert resolve_reference(report_path.parent, observation['storageBefore']) == resolve_reference(report_path.parent, observation['storageAfter'])
                assert isinstance(observed['frameAt'], (int, float)) and isinstance(observed['wallAt'], (int, float))
            if ident.startswith('storage-') or ident == 'external-storage-protection':
                observed = json.loads(resolve_reference(report_path.parent, observations[-1]))
                assert observed['state'] == expected_ready
                assert observed['mode'] == ('conflict' if ident == 'external-storage-protection' else 'protected')
        if ident == 'natural-payments-reload-no-replay':
            paid = row['paidJobObservations']
            expected_paid = [{key: job[key] for key in ('jobId', 'taskId', 'source', 'building', 'targetLevel', 'paid', 'planetId')} for job in fixture['batchPaidJobs']]
            assert [entry['job'] for entry in paid] == expected_paid
            assert json.loads(resolve_reference(report_path.parent, row['paidEngineSnapshot']))['state'] == fixture['paid']['state']
            for entry in paid:
                state = json.loads(resolve_reference(report_path.parent, entry['observation']))['state']
                task = next(task for task in state['orders']['tasks'] if task['id'] == entry['job']['taskId'])
                expected_task = next(task for task in fixture['paid']['state']['orders']['tasks'] if task['id'] == entry['job']['taskId'])
                assert task == entry['task'] == expected_task
                assert task['activeJob'] == {'jobId': entry['job']['jobId'], 'quantity': 1, 'credited': 0}
                assert task['kind'] == 'building' and task['planetId'] == entry['job']['planetId'] and task['building'] == entry['job']['building'] and task['targetLevel'] == 1
                assert task['budget'] == task['charged'] == entry['job']['paid'] and task['refunded'] == {'metal': '0', 'crystal': '0', 'deuterium': '0'}
                matches = [dict({key: job[key] for key in ('jobId', 'taskId', 'source', 'building', 'targetLevel', 'paid')}, planetId=planet['id']) for planet in state['planets'] for job in planet['buildQueue'] if job['jobId'] == entry['job']['jobId']]
                assert matches == [entry['job']]
        for proof in row.get('rawNoopProofs', []):
            assert resolve_reference(report_path.parent, proof['before']) == resolve_reference(report_path.parent, proof['after'])
        if ident.startswith('natural-'):
            assert {proof['label'] for proof in row['rawNoopProofs']} == {'duplicate-confirmation', 'all-completed-noop'}
        elif ident not in ('synthetic-three-planets', 'synthetic-four-planets', 'active-selection-fixed-payers', 'storage-readback-failure', 'external-storage-protection'):
            assert len(row['rawNoopProofs']) == 1
        assert json.loads(resolve_reference(report_path.parent, row['initialLiveExport']))['state'] == expected_ready
        assert json.loads(resolve_reference(report_path.parent, row['afterLiveExport']))['state'] == expected_after
        if ident.startswith('responsive-'):
            width = int(ident.split('-')[-1])
            assert row['width'] == width and len(row['visibility']) == 4
            for witness in row['visibility']:
                assert witness['width'] == width and witness['visible'] and witness['unoccluded']
                assert witness['rect']['width'] > 0 and witness['rect']['height'] > 0
                assert witness['rect']['x'] >= -1 and witness['rect']['x'] + witness['rect']['width'] <= width + 1
                screenshot = resolve_reference(report_path.parent, witness['screenshot'])
                assert screenshot.startswith(b'\x89PNG\r\n\x1a\n')
            caps = row['budgetVisibility']
            assert len(caps) == 12
            assert {(cap['planetId'], cap['building'], cap['resource']) for cap in caps} == {(planet, building, resource) for planet in fixture['planetIds'] for building in ('metal_storage', 'deuterium_tank') for resource in ('metal', 'crystal', 'deuterium')}
            for cap in caps:
                expected_cap = '1000' if cap['resource'] == 'metal' or cap['resource'] == 'crystal' and cap['building'] == 'deuterium_tank' else '0'
                assert cap['value'] == expected_cap and cap['visible'] and cap['unoccluded'] and cap['label']
                assert cap['rect']['x'] >= -1 and cap['rect']['x'] + cap['rect']['width'] <= width + 1
                assert resolve_reference(report_path.parent, cap['screenshot']).startswith(b'\x89PNG\r\n\x1a\n')
        completed_scenarios.append({'id': ident, 'checks': len(checks), 'snapshots': len(snapshots),
                                    'executedSourceBindings': sum(map(len, row['executedSources']))})
    return {'schema': 'infinity-building-batch-actual-census-v1', 'status': 'passed', 'sourceSha': expected,
            'fixtureSha256': sha(fixture_raw), 'reportSha256': sha(report_raw), 'commonIdentitySha256': sha(common_raw),
            'completeCommonIdentity': common['identitySha256'], 'releaseSha256': report['release']['sha256'],
            'domain': domain, 'scenarioCount': len(completed_scenarios), 'scenarios': completed_scenarios,
            'evidenceFileCount': len(evidence), 'evidenceInventorySha256': sha(canonical(evidence)),
            'checkCount': len(report['checks']), 'runtimeNode': report['runtimeNode'], 'version': report['version']}


def verify_original_artifact(root, result, expected, jobs):
    required = {'verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-payments', 'manual-unit-authority', 'building-batch'}
    assert set(jobs) == required and all(job['result'] == 'success' for job in jobs.values())
    outputs = jobs['building-batch']['outputs']
    assert set(outputs) == {'common-identity-sha256', 'building-batch-fixture-sha256', 'building-batch-census-sha256'}
    assert outputs['common-identity-sha256'] == result['completeCommonIdentity']
    assert outputs['building-batch-fixture-sha256'] == result['fixtureSha256']
    assert outputs['building-batch-census-sha256'] == sha(canonical(result))
    common = load(root / 'common-identity.json')['identity']
    archive_raw = original(root / 'building-batch-source.zip')
    assert sha(archive_raw) == common['sourceZipSha256']
    with zipfile.ZipFile(io.BytesIO(archive_raw)) as archive:
        assert archive.comment.decode() == expected
        entries = archive.infolist()
        assert len({entry.filename for entry in entries}) == len(entries), 'Duplicate source ZIP member'
        files, modes = {}, {}
        expected_dirs = {'Infinity/'} | {'Infinity/' + str(parent) + '/' for name in common['source']['sourceCode'] for parent in Path(name).parents if str(parent) != '.'}
        for entry in entries:
            name = entry.filename
            assert name.startswith('Infinity/') and not name.startswith('/') and '..' not in Path(name).parts and '\\' not in name
            mode = entry.external_attr >> 16
            assert mode == 0 or stat.S_IFMT(mode) in (stat.S_IFREG, stat.S_IFDIR), 'Nonordinary ZIP member'
            if entry.is_dir():
                assert name in expected_dirs
                assert mode in (0, 0o40755) and (mode != 0 or entry.create_system == 0)
                continue
            relative = name.removeprefix('Infinity/')
            assert relative and relative in common['source']['sourceCode']
            assert mode in (0, 0o100644, 0o100755) and (mode != 0 or entry.create_system == 0)
            files[relative] = sha(archive.read(entry))
            modes[relative] = '100755' if mode & 0o111 else '100644'
        assert files == common['source']['sourceCode'] and modes == common['source']['sourceModes']
    dist = root / 'dist'
    assert dist.is_dir() and not dist.is_symlink()
    actual = {}
    for path in dist.rglob('*'):
        assert not path.is_symlink()
        if path.is_file(): actual[str(path.relative_to(dist))] = sha(original(path))
    release = load(dist / 'release.json')
    assert len(actual) == 63 and len(release['files']) == 62
    assert actual == common['assets']
    assert {name: digest for name, digest in actual.items() if name != 'release.json'} == release['files']
    assert release['sourceSha'] == expected and release['version'] == result['version'] and release['saveVersion'] == 9 and release['saveRevision'] == 14
    assert actual['release.json'] == result['releaseSha256']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='mode', required=True)
    report = commands.add_parser('report')
    report.add_argument('--report', type=Path, required=True); report.add_argument('--fixture', type=Path, required=True)
    report.add_argument('--common-identity', type=Path, required=True)
    aggregate = commands.add_parser('aggregate'); aggregate.add_argument('--artifact', type=Path, required=True)
    for command in (report, aggregate):
        command.add_argument('--expected-sha', required=True); command.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.mode == 'report':
        result = census(args.report, args.fixture, args.common_identity, args.expected_sha)
    else:
        root = args.artifact
        result = census(root / 'building-batch-evidence/report.json', root / 'building-batch-source-evidence/fixture/fixture.json', root / 'common-identity.json', args.expected_sha)
        assert load(root / 'building-batch-census.json') == result, 'Published census does not recompute from original artifact'
        assert os.environ.get('JOB_RESULTS'), 'Original eight-job outputs are required'
        verify_original_artifact(root, result, args.expected_sha, json.loads(os.environ['JOB_RESULTS']))
    args.output.write_bytes(json.dumps(result, indent=2, ensure_ascii=False).encode() + b'\n')
    if args.mode == 'report' and os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('building-batch-fixture-sha256=' + result['fixtureSha256'] + '\n')
            output.write('building-batch-census-sha256=' + sha(canonical(result)) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
