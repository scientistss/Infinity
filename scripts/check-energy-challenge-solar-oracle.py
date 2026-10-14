#!/usr/bin/env python3
"""Independent fixed-solar expected-state artifact validation; no game or Node imports.
This checks complete rows, originals and the fixed chronology, not native provenance.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess

FIXED = {'createInitialState': 1, 'tick': 4201, 'enqueue': 149, 'enqueueResearch': 4, 'challengeCandidate': 2, 'checkpoint': 22, 'reject': 4}
EPOCH = 1791849600000
SEED = 20261013
ROOT = Path(__file__).resolve().parents[1]


def check(value, message):
    if not value:
        raise AssertionError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        check(key not in value, 'Duplicate JSON key')
        value[key] = item
    return value


def decode(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(AssertionError('Non-finite JSON')))


def original(path, maximum=256 * 1024 * 1024):
    path = Path(path)
    check(path.is_file() and not path.is_symlink(), f'Ordinary original required: {path}')
    check(path.stat().st_size <= maximum, 'Bounded original size')
    return path.read_bytes()


def reference(root, value):
    check(type(value) is dict and set(value) == {'file', 'sha256', 'bytes'}, 'Exact original reference keys')
    name = value['file']; check(type(name) is str and name and '..' not in Path(name).parts, 'Unsafe reference path')
    check(type(value['bytes']) is int and 0 <= value['bytes'] <= 256 * 1024 * 1024, 'Bounded reference bytes')
    check(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}', value['sha256']), 'Reference digest')
    path = Path(name) if Path(name).is_absolute() else Path(root) / name
    raw = original(path)
    check(len(raw) == value['bytes'] and sha(raw) == value['sha256'], 'Changed original bytes')
    return raw


def scaffold(initial, state, path='state'):
    """No omitted/added fields in any non-null fixed object of the pristine schema."""
    if type(initial) is dict:
        check(type(state) is dict and set(state) == set(initial), f'Complete fixed object keys: {path}')
        for key in initial:
            scaffold(initial[key], state[key], path + '.' + key)
    elif type(initial) is list:
        check(type(state) is list, f'Complete array: {path}')
        if initial:
            for item in state:
                scaffold(initial[0], item, path + '[]')
    elif initial is not None:
        check(type(state) is type(initial) or (type(initial) in (float, int) and type(state) in (float, int)), f'Serialized value type: {path}')


def matches_summary(state, summary):
    check(type(state) is dict and len(state['planets']) == 1 and state['activePlanetId'] == 'homeworld', 'Full ordinary home state required')
    home = state['planets'][0]
    pairs = [(state['totalTime'], summary['totalTime']), (home['resources'], summary['wallets']['homeworld']),
             (state['lifetime'], summary['lifetime']), (state['stats']['launches'], summary['launches']),
             (state['warpCores'], summary['warpCores']), (state['orders']['nextJobId'], summary['nextJobId']),
             (state['energyChallenge'], summary['challenge']), (home['buildings'], summary['buildings']),
             (home['productionPct'], summary['productionPct']), (home['units']['solar_satellite'], summary['satellites']),
             (state['research']['levels'], summary['researchLevels']), (home['buildQueue'], summary['buildingQueue']),
             (state['research']['queue'], summary['researchQueue']), (home['shipyardQueue'], summary['shipyardQueue'])]
    check(all(a == b for a, b in pairs), 'Complete serialized row disagrees with original receipt summary')
    check(state['manualClicks'] == state['stats']['automatedLaunches'] == 0, 'No collection or automation')
    check(state['universe']['seed'] == SEED and state['arcade']['seed'] == SEED, 'Only fixed pristine seeds')
    check(not state['fleets'] and home['buildings']['fusion_reactor'] == 0 and home['units']['solar_satellite'] == 0, 'No extra solar-route resource mechanisms')
    check(all(slot['card'] is None for slot in state['protocols']['slots']), 'No automated business actions')
    capacity = 3 if state['energyChallenge']['completion'] is not None else 2
    check(summary['buildingCapacity'] == summary['researchCapacity'] == capacity, 'Exact queue capacity')


def validate_row(row, event, initial_state, previous, pending, checkpoint_raw, logical_seconds):
    keys = {'index', 'state'} | ({'candidate'} if event['api'] == 'challengeCandidate' else set()) | ({'raw'} if event['api'] == 'checkpoint' else set())
    check(type(row) is dict and set(row) == keys, 'Exact full-state row keys; no exclusions or surplus payload')
    check(type(row['index']) is int and row['index'] == event['index'], 'Exact ordered row index')
    state = row['state']; scaffold(initial_state, state); matches_summary(state, event['after'])
    check(event['after']['logicalSeconds'] == logical_seconds, 'Exact one-second chronology')
    if event['api'] == 'challengeCandidate':
        check(pending is None and state == previous, 'Challenge quote may not silently adopt economic state')
        scaffold(initial_state, row['candidate']); matches_summary(row['candidate'], event['candidate'])
        pending = row['candidate']
    elif event['api'] == 'checkpoint':
        raw = checkpoint_raw[event['request']['name']]
        check(type(row['raw']) is str and row['raw'].encode() == raw, 'Exact original checkpoint bytes')
        envelope = decode(raw)
        check(envelope['state'] == state and envelope['savedAt'] == envelope['lastTickAt'] == EPOCH + logical_seconds * 1000, 'Whole checkpoint and clock equality')
        check(state == (pending if pending is not None else previous), 'Only the actual pending candidate or complete previous state can be adopted')
        pending = None
    else:
        check(pending is None, 'Only an immediately following checkpoint may adopt a pending candidate')
        if event['api'] == 'reject':
            check(state == previous, 'Rejected action must preserve every field')
        elif event['api'] == 'createInitialState':
            check(previous is None and state == initial_state, 'Only exact pristine state may initialize the replay')
    return state, pending


def run(oracle_path, require_clean=False):
    oracle_path = Path(oracle_path).resolve(); manifest = decode(original(oracle_path, 1024 * 1024))
    check(manifest['schema'] == 'infinity-energy-challenge-solar-oracle-v1' and manifest['status'] == 'prepared', 'Prepared fixed-solar oracle required')
    check(manifest['classification'] == 'fixed-fresh-seed-domain-replay-expected-states-not-native-evidence', 'Domain preparation is not native evidence')
    root = oracle_path.parent
    natural_raw = reference(root, manifest['naturalReport']); natural = decode(natural_raw)
    check(natural['schema'] == 'energy-challenge-natural-v1' and natural['status'] == 'passed', 'Validated natural report required')
    check(manifest['sourceSha'] == natural['sourceSha'] and manifest['sourceTree'] == natural['sourceTree'], 'Exact common source')
    check(manifest['runtimeNode'] == natural['nodeVersion'] and re.fullmatch(r'v\d+\.\d+\.\d+', manifest['runtimeNode']), 'Actual common runtime')
    check(manifest['census'] == FIXED and manifest['rows'] == 4383 and manifest['logicalSeconds'] == 4201, 'Fixed complete census')
    check(manifest['sourceClassification'] == natural['sourceClassification'] == 'clean-candidate-source' and manifest['dirtyPaths'] == natural['dirtyPaths'] == [], 'No dirty evidence')
    check(natural['sourceInput'] == {'kind': 'createInitialState', 'worldSeed': SEED, 'arcadeSeed': SEED, 'importedSaves': [], 'importedReports': [], 'stockGrants': [], 'directStatePatches': []}, 'Pristine-only construction')
    check(manifest['provenance'] == {'inputStateAdoptions': 0, 'initialStateConstructor': 'createInitialState(20261013,20261013)', 'onlyAdoptions': 'locally generated SaveSession write/readback at the original 22 checkpoints', 'expectedStatesNeverSuppliedToCandidate': True, 'importedPlayerSaves': [], 'injectedState': []}, 'No expected-state adoption')
    route, = [r for r in natural['routes'] if r['policy'] == 'solar']
    receipts_raw = reference(root, manifest['receipts']); initial_raw = reference(root, manifest['initial']); states_raw = reference(root, manifest['expectedStates'])
    check(sha(receipts_raw) == route['receipts']['sha256'] and sha(initial_raw) == route['checkpoints']['initial']['sha256'], 'Original fixed solar references')
    natural_ref = Path(manifest['naturalReport']['file']); natural_path = natural_ref if natural_ref.is_absolute() else root / natural_ref
    natural_dir = natural_path.parent
    spec = importlib.util.spec_from_file_location('natural_solar_validation', Path(__file__).with_name('check-energy-challenge-natural.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    module.check_route(natural_dir, route)
    events = decode(receipts_raw); check(len(events) == 4383 and dict(Counter(e['api'] for e in events)) == FIXED, 'Fixed 4383-event chronology')
    check([e['index'] for e in events] == list(range(1, 4384)), 'Original event indices')
    check([e['request']['action'] for e in events if e['api'] == 'challengeCandidate'] == ['enter', 'finish'], 'Exactly the two original challenges')
    check([e['request']['api'] for e in events if e['api'] == 'reject'] == ['enterEnergyChallenge', 'finishEnergyChallenge', 'enqueue', 'enqueueResearch'], 'Original four rejections')
    check(events[0]['request'] == {'worldSeed': SEED, 'arcadeSeed': SEED} and events[-1]['request']['name'] == 'third-research-completed', 'Fixed endpoints')
    initial_envelope = decode(initial_raw); initial = initial_envelope['state']
    check(initial_envelope['savedAt'] == initial_envelope['lastTickAt'] == EPOCH and initial_envelope['version'] == 9 and initial_envelope['revision'] == 16, 'Exact pristine envelope')
    check(initial['totalTime'] == initial['warpCores'] == '0' and initial['orders']['nextJobId'] == 1 and initial['stats']['launches'] == 0, 'Pristine clock and identities')
    check(initial['planets'][0]['resources'] == {'metal': '500', 'crystal': '500', 'deuterium': '0'}, 'Pristine wallet')
    checkpoint_raw = {e['request']['name']: module.verified_file(natural_dir, route['checkpoints'][e['request']['name']]) for e in events if e['api'] == 'checkpoint'}
    check(len(checkpoint_raw) == 22, 'Exactly 22 distinct checkpoint originals')
    previous = pending = None; seconds = rows = 0; stream = io.BytesIO(states_raw)
    for event in events:
        line = stream.readline(2 * 1024 * 1024)
        check(line.endswith(b'\n'), 'Missing/truncated/unbounded JSONL row')
        row = decode(line)
        if event['api'] == 'tick':
            check(event['request'] == {'dt': 1, 'mode': 'live', 'reason': event['request']['reason']}, 'One exact live tick')
            seconds += 1
        previous, pending = validate_row(row, event, initial, previous, pending, checkpoint_raw, seconds); rows += 1
    check(not stream.read(1) and pending is None and rows == 4383 and seconds == 4201, 'No extra rows or unfinished state adoption')
    check(manifest['finalStateSha256'] == route['replay']['finalStateSha256'] == route['checkpoints']['third-research-completed']['stateSha256'], 'Complete final state binding')
    check(manifest['producer']['path'] == 'scripts/energy-challenge-solar-oracle.mjs' and re.fullmatch('[0-9a-f]{64}', manifest['producer']['sha256']), 'Exact producer identity')
    if require_clean:
        check(subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain=v1', '--untracked-files=all'], text=True).strip() == '', 'Checker requires the actual clean checkout')
        check(subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD^{tree}'], text=True).strip() == manifest['sourceTree'], 'Actual committed tree identity')
        check(subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip() == manifest['sourceSha'], 'Checker must read the same committed source')
        check(sha(original(ROOT / manifest['producer']['path'])) == manifest['producer']['sha256'], 'Actual producer bytes')
        for file in natural['sourceFiles']:
            check(not Path(file['path']).is_absolute() and '..' not in Path(file['path']).parts, 'Safe source path')
            check(sha(original(ROOT / file['path'])) == file['sha256'], 'Actual complete natural source inventory')
    return {'status': 'passed', 'classification': manifest['classification'], 'rows': rows, 'logicalSeconds': seconds, 'checkpoints': 22, 'sourceSha': manifest['sourceSha'], 'runtimeNode': manifest['runtimeNode']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--oracle', required=True, type=Path)
    parser.add_argument('--require-clean', action='store_true')
    args = parser.parse_args()
    print(json.dumps(run(args.oracle, args.require_clean), indent=2))
