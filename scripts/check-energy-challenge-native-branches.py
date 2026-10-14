#!/usr/bin/env python3
"""Independent native-boundary preparation audit. Imports no game/production modules.

Reconstructs complete payment, refund, acceleration, challenge-delta and selection
states against declared full ordinary-curvature baselines. Ordinary baseline
outputs are identified as domain baselines, not an independent economic engine.
Checks every setup against its original real natural checkpoint. A passing
preparation is never evidence that a native control was actually exercised.
"""
import argparse
from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
import hashlib
import importlib.util
import json
from math import isqrt
from pathlib import Path
import re

SCHEMA = 'infinity-energy-challenge-native-supplements-v1'
IDS = ('paid-job-cancel', 'paid-job-accelerate', 'auto-card-disable-config', 'active-auto-guard',
       'enter-active-planet-aba', 'abandon-active-planet-aba', 'finish-active-planet-aba',
       'receipt-ordinary-curvature', 'new-game-clear', 'external-storage-protection',
       'external-r16-misplaced-authority')
PROOFS = ('metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant')
EMPTY_CHALLENGE = {'model': 'energy-tightening-v1', 'nextAttemptId': 1, 'active': None, 'completion': None}
RES = ('metal', 'crystal', 'deuterium')
SEED_PATHS = ['universe.seed', 'arcade.seed', 'deepSpace.seed', 'planets.0.coordinates']
CHECKPOINTS = dict(zip(IDS, ('entered', 'entered', 'entry-ready', 'finish-ready',
    'entry-ready', 'active-progress', 'finish-ready', 'completed', 'completed', 'entry-ready', 'entry-ready')))


def check(ok, message):
    if not ok:
        raise AssertionError(message)


def read_ref(ref, root):
    check(type(ref) is dict and set(ref) >= {'file', 'sha256', 'bytes'}, 'Complete immutable artifact reference required')
    check(type(ref['file']) is str and bool(ref['file']), 'Artifact path must be nonempty text')
    check(type(ref['bytes']) is int and ref['bytes'] >= 0 and type(ref['sha256']) is str
          and re.fullmatch('[0-9a-f]{64}', ref['sha256']), 'Invalid immutable artifact identity')
    name = Path(ref['file']); check('..' not in name.parts, 'Parent traversal in artifact reference')
    path = name if name.is_absolute() else Path(root) / name
    check(path.is_file() and not path.is_symlink(), f'Missing ordinary original: {path}')
    raw = path.read_bytes()
    check(len(raw) == ref['bytes'] and hashlib.sha256(raw).hexdigest() == ref['sha256'], f'Artifact identity mismatch: {path}')
    return raw


def source_map(records, root=None):
    check(type(records) is list and bool(records), 'Full source inventory required')
    result = {}
    for record in records:
        check(type(record) is dict and set(record) == {'path', 'sha256'}, 'Invalid source inventory row')
        name, digest = record['path'], record['sha256']
        check(type(name) is str and name and not Path(name).is_absolute() and '..' not in Path(name).parts,
              'Source inventory path must be repository-relative')
        check(name not in result and type(digest) is str and re.fullmatch('[0-9a-f]{64}', digest),
              'Duplicate or malformed source inventory identity')
        if root is not None:
            path = Path(root) / name
            check(path.is_file() and not path.is_symlink(), f'Missing ordinary source: {name}')
            check(hashlib.sha256(path.read_bytes()).hexdigest() == digest, f'Stale boundary source: {name}; regenerate preparation')
        result[name] = digest
    return result


def state(ref, root):
    value = json.loads(read_ref(ref, root))
    return value.get('state', value)


def home(value):
    return next(p for p in value['planets'] if p['id'] == value['activePlanetId'])


def amount(value):
    result = format(Decimal(value), 'f')
    return result.rstrip('0').rstrip('.') if '.' in result else result


def coordinate_random(seed, galaxy, system, position, salt):
    """Independent uint32 coordinate hash; never calls or advances game RNG."""
    mask = 0xffffffff
    x = (seed ^ ((galaxy * 73856093) & mask) ^ ((system * 19349663) & mask)
         ^ ((position * 83492791) & mask) ^ ((salt * 2654435761) & mask)) & mask
    x ^= x >> 16; x = (x * 0x7feb352d) & mask
    x ^= x >> 15; x = (x * 0x846ca68b) & mask; x ^= x >> 16
    return x


def pristine_reset_expected(template, observed_seed):
    """Full native-reset expectation from pristine template and ONE observed uint32.

    Only seed-dependent fields change. No RNG replacement/search, arbitrary
    observed-state copying, candidate reader, or game helper is permitted.
    """
    check(type(observed_seed) is int and 0 <= observed_seed <= 0xffffffff, 'Reset seed must be uint32')
    check(template['energyChallenge'] == EMPTY_CHALLENGE and template['totalTime'] == '0', 'Nonpristine reset template')
    check(len(template['planets']) == 1 and template['activePlanetId'] == 'homeworld', 'Pristine planet template required')
    result = deepcopy(template)
    result['universe']['seed'] = observed_seed
    result['arcade']['seed'] = observed_seed
    result['deepSpace']['seed'] = observed_seed ^ 0x9e3779b9
    result['planets'][0]['coordinates'] = {
        'galaxy': 1,
        'system': 40 + coordinate_random(observed_seed, 1, 50, 8, 20) * 21 // 2**32,
        'position': 4 + coordinate_random(observed_seed, 1, 50, 8, 21) * 9 // 2**32,
    }
    return result


def paid_expected(before):
    expected = deepcopy(before); planet = home(expected)
    check(planet['buildQueue'] == [] and planet['buildings']['solar_plant'] == 0, 'First real solar payment boundary required')
    check(planet['buildings']['robotics_factory'] == planet['buildings']['nanite_factory'] == 0, 'Unexpected time discount')
    paid = {'metal': '75', 'crystal': '30', 'deuterium': '0'}
    for resource in RES:
        check(Decimal(planet['resources'][resource]) >= Decimal(paid[resource]), 'Unfunded payment')
        planet['resources'][resource] = amount(Decimal(planet['resources'][resource]) - Decimal(paid[resource]))
    # Independent fixed catalog L1 solar cost and max(1, 105 / (2500*3.5)*3600/600) = 1 second.
    planet['buildQueue'].append({'jobId': before['orders']['nextJobId'], 'taskId': None, 'building': 'solar_plant',
                                'targetLevel': 1, 'paid': paid, 'totalSeconds': 1, 'remainingSeconds': 1, 'source': 'manual'})
    expected['orders']['nextJobId'] += 1
    expected['stats']['manualActions'] += 1
    return expected


def cancelled_expected(before):
    expected = deepcopy(before); planet = home(expected)
    check(len(planet['buildQueue']) == 1, 'One actual cancelled paid job required')
    job = planet['buildQueue'].pop()
    for resource in RES:
        planet['resources'][resource] = amount(Decimal(planet['resources'][resource]) + Decimal(job['paid'][resource]))
    return expected


def accelerated_expected(before):
    expected = deepcopy(before); planet = home(expected)
    check(len(planet['buildQueue']) == 1, 'One actual accelerated paid job required')
    job = planet['buildQueue'].pop()
    check(job['building'] == 'solar_plant' and job['targetLevel'] == 1 and job['remainingSeconds'] == 1, 'Unexpected accelerated head')
    check(Decimal(expected['darkMatter']) >= 750, 'Accelerated finish must actually be funded')
    expected['darkMatter'] = amount(Decimal(expected['darkMatter']) - 750)
    planet['buildings']['solar_plant'] = 1
    expected['stats']['buildsCompleted'] += 1
    expected['stats']['seenQueueIdle'] = True
    attempt = expected['energyChallenge']['active']
    check(attempt is not None and attempt['proofs']['solar_plant'] is None, 'Proof must originate at this completion')
    check(attempt['entryJobFloor'] <= job['jobId'] < expected['orders']['nextJobId'], 'Paid ID outside actual attempt')
    attempt['proofs']['solar_plant'] = {key: deepcopy(job[key]) for key in ('jobId', 'targetLevel', 'source', 'taskId', 'paid')}
    return expected


def ordinary_baseline_checks(before, ordinary, gain):
    weighted = sum(Fraction(before['lifetime'][resource]) * weight for resource, weight in zip(RES, (1, 3, 10)))
    score = weighted * (Fraction(5, 4) if before['curvature']['score_boost'] > 0 else 1) / 1000000
    expected_gain = isqrt(score.numerator // score.denominator)
    check(type(gain) is str and gain == str(expected_gain) and expected_gain >= 1, 'Curvature gain differs from independent score formula')
    check(ordinary['warpCores'] == amount(Decimal(before['warpCores']) + Decimal(gain)), 'Ordinary reward mismatch')
    check(ordinary['stats']['launches'] == before['stats']['launches'] + 1, 'Curvature must occur exactly once')
    check(ordinary['orders']['nextJobId'] == before['orders']['nextJobId'], 'Curvature must not issue/reset paid IDs')
    check(ordinary['terraformerGrantJobFloor'] == before['orders']['nextJobId'], 'Curvature job floor mismatch')
    check(ordinary['activePlanetId'] == 'homeworld' and len(ordinary['planets']) == 1, 'Ordinary reset home mismatch')
    check(ordinary['totalTime'] == before['totalTime'], 'Curvature must not simulate elapsed time')
    check(all(value == 0 for value in home(ordinary)['buildings'].values()), 'Ordinary reset failed to clear buildings')
    check(home(ordinary)['resources'] == {'metal': '500', 'crystal': '500', 'deuterium': '0'}, 'Ordinary starting stock mismatch')
    check(home(ordinary)['buildQueue'] == [] and ordinary['research']['queue'] == [], 'Ordinary reset failed to clear paid queues')
    check(ordinary['protocols'] == {**deepcopy(before['protocols']), 'accumulator': 0}, 'Ordinary curvature changed configured cards')


def challenge_expected(before, action, ordinary=None, quote=None):
    if quote is not None:
        check(set(quote) == {'gain', 'disabledPrestigeSlots'}, 'Unexpected challenge quote fields')
        targets = [i for i, slot in enumerate(before['protocols']['slots'])
                   if slot['card'] and slot['card']['action']['kind'] == 'prestige' and slot['card']['enabled']]
        check(quote['disabledPrestigeSlots'] == targets, 'Quote is not bound to all currently enabled prestige slots')
    if action == 'abandon':
        check(before['energyChallenge']['active'] is not None, 'Abandonment must retire an actual attempt')
        check(quote is None or quote['gain'] == '0', 'Abandonment cannot award curvature gain')
        result = deepcopy(before); result['energyChallenge']['active'] = None
        return result
    check(ordinary is not None and quote is not None, 'Full ordinary baseline required')
    ordinary_baseline_checks(before, ordinary, quote['gain'])
    result = deepcopy(ordinary); challenge = deepcopy(before['energyChallenge'])
    if action == 'enter':
        check(challenge['active'] is None and challenge['completion'] is None, 'Invalid entry source')
        challenge['active'] = {'attemptId': challenge['nextAttemptId'], 'universeSeed': before['universe']['seed'],
                               'homeworldId': 'homeworld', 'entryJobFloor': ordinary['orders']['nextJobId'],
                               'enteredAt': ordinary['totalTime'], 'scoreUnits': '0', 'proofs': dict.fromkeys(PROOFS)}
        challenge['nextAttemptId'] += 1
        targets = []
        for index, slot in enumerate(result['protocols']['slots']):
            card = slot['card']
            if card and card['action']['kind'] == 'prestige' and card['enabled']:
                targets.append(index); card['enabled'] = False
        check(targets == quote['disabledPrestigeSlots'], 'Quote omitted an enabled prestige slot')
    elif action == 'finish':
        attempt = challenge['active']; check(attempt['scoreUnits'] == '1000000000000000000', 'Unfinished goal')
        check(all(attempt['proofs'].values()), 'Completion must carry four real original proofs')
        homeworld = next(p for p in before['planets'] if p['id'] == attempt['homeworldId'])
        challenge['completion'] = {'attempt': deepcopy(attempt), 'finish': {'jobCeiling': before['orders']['nextJobId'],
            'finishedAt': before['totalTime'], 'ordinaryGain': quote['gain'],
            'homeLevels': {building: homeworld['buildings'][building] for building in PROOFS}}}
        challenge['active'] = None
    else:
        raise AssertionError('Unknown challenge action')
    result['energyChallenge'] = challenge
    return result


def configured_slots(original, enabled):
    slots = deepcopy(original['protocols']['slots'])
    check(len(slots) == 12, 'Fixed twelve-slot native configuration required')
    for index in (0, 1, 11):
        prestige = index != 1
        card = {'id': 'auto_prestige' if prestige else 'auto_collect', 'enabled': enabled if prestige else True,
                'trigger': {'kind': 'interval', 'seconds': 37 if index == 11 else 17},
                'conditions': [{'kind': 'resourceGte', 'res': 'metal', 'value': str(123 + index)}] if prestige else [],
                'action': {'kind': 'prestige', 'minGain': 13 if index == 11 else 9} if prestige else {'kind': 'collect'}}
        slots[index] = {'card': card, 'elapsed': index + 0.25, 'lamp': 'gray', 'reason': 'Synthetic native-boundary configuration'}
    return slots


def empty_aba_colony(original):
    planet = home(original)
    return {'id': 'boundary-colony', 'name': 'Explicit synthetic ABA colony',
            'coordinates': {**planet['coordinates'], 'position': planet['coordinates']['position'] + 1},
            'resources': dict.fromkeys(RES, '0'), 'npcResourceRemainder': dict.fromkeys(RES, '0'),
            'tempMax': 40, 'fieldsMax': 163, 'terraformerFields': {'base': 163, 'grantedLevels': 0},
            'buildings': dict.fromkeys(planet['buildings'], 0), 'productionPct': dict.fromkeys(planet['productionPct'], 100),
            'buildQueue': [], 'demolition': None, 'units': dict.fromkeys(planet['units'], 0), 'shipyardQueue': []}


def validate_setup(case, original, initial):
    expected = deepcopy(original)
    allowed = {'auto-card-disable-config': {('protocols', 'slots'), ('unlockedCards',)},
               'active-auto-guard': {('protocols', 'slots'), ('unlockedCards',)},
               'receipt-ordinary-curvature': {('lifetime',)}}
    if case['id'].endswith('-active-planet-aba'):
        allowed[case['id']] = {('planets',)}
    check({tuple(patch['path']) for patch in case['setup']} == allowed.get(case['id'], set()), 'Undeclared or missing synthetic setup scope')
    check(len(case['setup']) == len(allowed.get(case['id'], set())), 'Repeated setup field')
    for patch in case['setup']:
        check(patch['reason'] and 'synthetic' in patch['reason'].lower(), 'Explicit synthetic label required')
        owner = expected
        for key in patch['path'][:-1]:
            owner = owner[key]
        check(owner[patch['path'][-1]] == patch['before'], 'Synthetic setup source differs from original')
        owner[patch['path'][-1]] = deepcopy(patch['after'])
    check(expected == initial, 'Full initial state differs from original plus only declared setup')
    if case['id'] in ('auto-card-disable-config', 'active-auto-guard'):
        check(initial['protocols']['slots'] == configured_slots(original, case['id'] == 'auto-card-disable-config'),
              'Synthetic protocol setup changed outside the three fixed configured slots')
        check(initial['unlockedCards'] == list(dict.fromkeys([*original['unlockedCards'], 'auto_collect', 'auto_prestige'])),
              'Synthetic protocol setup changed unrelated catalog availability')
    if case['id'] == 'receipt-ordinary-curvature':
        check(initial['lifetime'] == {'metal': '100000000', 'crystal': '0', 'deuterium': '0'}, 'Fixed synthetic eligibility changed')
    if case['id'].endswith('-active-planet-aba'):
        check(len(initial['planets']) == 2 and initial['planets'][0] == original['planets'][0], 'ABA setup changed original home')
        colony = initial['planets'][1]
        check(colony == empty_aba_colony(original), 'ABA colony differs from exact empty, zero-receipt planet preparation')
        check(colony['id'] == 'boundary-colony' and colony['coordinates'] != original['planets'][0]['coordinates'], 'Distinct real planet identity required')
        check(colony['resources'] == dict.fromkeys(RES, '0') and all(v == 0 for v in colony['buildings'].values()), 'ABA colony cannot grant economy')
        check(colony['buildQueue'] == [] and colony['shipyardQueue'] == [] and colony['demolition'] is None, 'ABA colony cannot invent paid jobs')


def validate_case_contract(case):
    """A typed fixed census, never a fixture-programmable native execution plan."""
    ident = case['id']; check(ident in IDS, 'Unknown supplemental case')
    check(case['source']['checkpoint'] == CHECKPOINTS[ident] and case['source']['policy'] == 'solar', 'Wrong natural branch checkpoint')
    contracts = {
        'paid-job-cancel': [('enqueue', {'id': 'solar_plant', 'source': 'manual'}, {'kind': 'build', 'id': 'solar_plant'}),
                            ('cancel', {'index': 0}, {'kind': 'cancel-build', 'index': 0})],
        'paid-job-accelerate': [('enqueue', {'id': 'solar_plant', 'source': 'manual'}, {'kind': 'build', 'id': 'solar_plant'}),
                                ('speedUp', {'target': 'build', 'mode': 'finish'}, {'kind': 'accelerate-build'})],
        'auto-card-disable-config': [(kind + 'EnergyChallenge', {'action': kind}, {'kind': 'challenge', 'action': kind}) for kind in ('enter', 'abandon')],
        'active-auto-guard': [('toggleSlot', {'slot': 0, 'enabled': True}, {'kind': 'auto-toggle', 'slot': 0}),
                              ('patchSlot', {'slot': 1, 'path': 'action.kind', 'value': 'prestige'}, {'kind': 'auto-edit', 'slot': 1, 'path': 'action.kind', 'value': 'prestige'}),
                              ('finishEnergyChallenge', {'action': 'finish'}, {'kind': 'challenge', 'action': 'finish'})],
        'receipt-ordinary-curvature': [('prestige', {}, {'kind': 'ordinary-prestige'})],
    }
    if ident.endswith('-active-planet-aba'):
        contracts[ident] = [('selectPlanet', {'id': planet}, None) for planet in ('boundary-colony', 'homeworld')]
        check(case['action'] == ident.split('-')[0] and case['planetIds'] == ['homeworld', 'boundary-colony'], 'Wrong ABA intent/identity')
    if ident.startswith('external-'):
        check(case['action'] == 'enter', 'Wrong external conflict intent')
    expected = contracts.get(ident, [])
    check(type(case['domainActions']) is list and len(case['domainActions']) == len(expected), 'Missing/extra actual domain actions')
    steps = []
    for actual, (api, request, step) in zip(case['domainActions'], expected):
        check(actual['api'] == api and actual['request'] == request, 'Changed/reordered actual domain action')
        if step is not None:
            steps.append({**step, 'expected': actual['after']})
    if ident == 'new-game-clear':
        steps = [{'kind': 'reset', 'resetOracle': case['resetOracle']}]
        check('finalExpected' not in case, 'Native random reset cannot have pregenerated final state')
    else:
        expected_final = case['domainActions'][-1]['after'] if expected else case['initialExpected']
        check(case['finalExpected'] == expected_final, 'Final state must reference the final actual domain action')
    check(case['steps'] == steps, 'Native steps must exactly match the fixed domain action contract')


def validate_case(case, root):
    validate_case_contract(case)
    original = state(case['source']['original'], root)
    initial = state(case['initialExpected'], root)
    envelope = json.loads(read_ref(case['input'], root))
    check(envelope['state'] == initial and envelope['version'] == 9 and envelope['revision'] == 16, 'Input full-state/schema mismatch')
    check(envelope['savedAt'] == envelope['lastTickAt'] == case['epoch'], 'Zero-time fixture timestamp mismatch')
    check(case['strictRead'] == {'ready': True, 'appliedSeconds': 0, 'storageWrites': 0}, 'Strict source read missing')
    check(case['classification'] == ('explicit-adversarial-lifecycle' if case['id'].endswith('-active-planet-aba') or case['id'].startswith('external-') else 'explicit-synthetic-boundary'), 'Boundary evidence mislabeled')
    validate_setup(case, original, initial)
    previous = initial
    for action in case['domainActions']:
        before, after = state(action['before'], root), state(action['after'], root)
        check(before == previous, 'Domain action chain discontinuity')
        api = action['api']; request = action['request']
        if api == 'enqueue':
            check(request == {'id': 'solar_plant', 'source': 'manual'}, 'Payment API changed'); expected = paid_expected(before)
        elif api == 'cancel':
            check(request == {'index': 0}, 'Cancellation index changed'); expected = cancelled_expected(before)
        elif api == 'speedUp':
            check(request == {'target': 'build', 'mode': 'finish'}, 'Acceleration API changed'); expected = accelerated_expected(before)
        elif api in ('toggleSlot', 'patchSlot'):
            check(request == ({'slot': 0, 'enabled': True} if api == 'toggleSlot' else {'slot': 1, 'path': 'action.kind', 'value': 'prestige'}), 'Auto guard boundary changed')
            expected = before
        elif api in ('enterEnergyChallenge', 'abandonEnergyChallenge', 'finishEnergyChallenge'):
            expected = challenge_expected(before, request['action'], state(action['ordinaryBaseline'], root) if action.get('ordinaryBaseline') else None, action['quote'])
        elif api == 'selectPlanet':
            check(request['id'] in {p['id'] for p in before['planets']}, 'Selection of nonexistent planet')
            expected = deepcopy(before); expected['activePlanetId'] = request['id']
        elif api == 'prestige':
            expected = state(action['ordinaryBaseline'], root)
            check(expected['energyChallenge'] == EMPTY_CHALLENGE, 'Ordinary comparison baseline must omit reward authority')
            ordinary_baseline_checks(before, expected, action['gain'])
            expected['energyChallenge'] = deepcopy(before['energyChallenge'])
        else:
            raise AssertionError(f'Unknown API {api}')
        check(after == expected, f'{case["id"]}/{api}: full state differs from independent boundary expectation')
        previous = after
    if case.get('finalExpected'):
        check(state(case['finalExpected'], root) == previous, 'Final expectation not last actual domain result')
    for step in case['steps']:
        if step.get('expected'):
            check(any(step['expected'] == action['after'] for action in case['domainActions']), 'Native step not linked to actual API result')
    if case['id'].startswith('paid-job-'):
        check(case['setup'] == [] and [a['api'] for a in case['domainActions']] == ['enqueue', 'cancel' if case['id'].endswith('cancel') else 'speedUp'], 'Paid boundary must not synthesize funds/jobs')
        check(case['actualPaidJob'] == home(state(case['domainActions'][0]['after'], root))['buildQueue'][0], 'Actual paid job not retained')
    if case['id'] == 'paid-job-accelerate':
        check(case['accelerationCost'] == {'currency': 'darkMatter', 'amount': '750'}, 'Actual DM cost not retained')
    if case['id'] == 'auto-card-disable-config':
        targets = [i for i, s in enumerate(initial['protocols']['slots']) if s['card'] and s['card']['action']['kind'] == 'prestige' and s['card']['enabled']]
        check(targets == [0, 11] and case['lockedAutoSlot'] == 11 >= case['unlockedSlotCount'], 'Locked enabled card coverage absent')
        slots = min(12, 1 + min(1000, home(initial)['buildings']['robotics_factory']) // 2
                    + min(1000, initial['research']['levels']['computer_tech']) // 2 + (1 if initial['curvature']['slot_plus'] > 0 else 0))
        check(case['unlockedSlotCount'] == slots > 1, 'Declared locked-slot boundary differs from independent slot count')
    if case['id'] == 'new-game-clear':
        oracle = case['resetOracle']; template = state(oracle['template'], root)
        check(oracle['kind'] == 'pristine-template-from-observed-seed-v1' and oracle['permittedSeedPaths'] == SEED_PATHS and oracle['fixedTemplateSeed'] == 20261013, 'Pristine reset contract changed')
        check(template == state(oracle['pristineSource'], root), 'Pristine template must exactly match original fresh natural initial checkpoint')
        check(pristine_reset_expected(template, 20261013) == template, 'Independent reset seed reconstruction mismatch')
        check(template['planets'][0]['resources'] == {'metal': '500', 'crystal': '500', 'deuterium': '0'} and template['orders']['nextJobId'] == 1, 'Reset not fresh initial economy')
        check(case['steps'] == [{'kind': 'reset', 'resetOracle': oracle}] and case['domainActions'] == [], 'Never claim deterministic native reset was pregenerated')
    if case['id'].endswith('-active-planet-aba'):
        check([row['id'] for row in case['planetSelections']] == ['boundary-colony', 'homeworld'], 'Incomplete actual ABA sequence')
        check([row['expected'] for row in case['planetSelections']] == [row['after'] for row in case['domainActions']], 'ABA full states disconnected')
        check(previous == initial, 'ABA did not restore exact initial full state')
    if case['id'].startswith('external-'):
        check(case['protectionAudit'] == {'currentSession': 'conflict', 'oldVisibleStateRetained': True, 'foreignBytesRetained': True,
              'preConflictExportRetained': True, 'reloadMode': 'protected', 'startupOriginalRetained': True, 'storageWrites': 0}, 'External conflict/no-write probe missing')
        bad = read_ref(case['externalInput'], root)
        if case['id'] == 'external-storage-protection':
            check(bad == b'{"schema":"infinity-original-p4","state":', 'Malformed JSON fixture changed outside its fixed corruption')
            try:
                json.loads(bad)
            except json.JSONDecodeError:
                pass
            else:
                raise AssertionError('Expected invalid JSON protection fixture')
        else:
            value = json.loads(bad); expected = deepcopy(initial)
            expected['protocols']['energyChallenge'] = deepcopy(initial['energyChallenge'])
            check(value == {**envelope, 'state': expected}, 'Misplaced authority is not isolated corruption of actual original envelope')
    return {'id': case['id'], 'actualDomainActions': len(case['domainActions']), 'syntheticSetups': len(case['setup'])}


def run(directory, require_clean=False, verify_natural=True):
    root = Path(directory); manifest = json.loads((root / 'manifest.json').read_bytes())
    check(manifest['schema'] == SCHEMA and manifest['status'] == 'passed', 'No passing producer manifest')
    check(manifest['classification'] == 'explicit-boundary-preparation-not-natural-route-not-browser-proof', 'Preparation promoted to acceptance')
    check([c['id'] for c in manifest['cases']] == list(IDS), 'Fixed supplement census changed')
    natural = json.loads(read_ref(manifest['naturalReport'], root))
    check(type(manifest['sourceSha']) is str and re.fullmatch('[0-9a-f]{40}', manifest['sourceSha']) and natural['sourceSha'] == manifest['sourceSha'], 'Mixed/invalid source provenance')
    check(manifest['runtimeNode'] == natural['nodeVersion'], 'Natural/boundary runtime mismatch')
    sources = source_map(manifest['sourceFiles'], Path(__file__).resolve().parents[1] if require_clean else None)
    natural_sources = source_map(natural['sourceFiles'])
    check(all(sources.get(name) == digest for name, digest in natural_sources.items()), 'Natural/domain source hash mismatch')
    check(set(sources) == set(natural_sources) | {'scripts/energy-challenge-native-branches.mjs', 'scripts/check-energy-challenge-native-branches.py'}, 'Boundary source inventory is incomplete or has unrelated files')
    if require_clean:
        check(manifest['sourceClassification'] == natural['sourceClassification'] == 'clean-candidate-source' and not manifest['dirtyPaths'], 'Diagnostic preparation is not clean-source evidence')
    if verify_natural:
        spec = importlib.util.spec_from_file_location('natural_checker', Path(__file__).with_name('check-energy-challenge-natural.py'))
        checker = importlib.util.module_from_spec(spec); spec.loader.exec_module(checker)
        checker.run(Path(manifest['naturalReport']['file']).parent, require_clean)
    source_route = next(r for r in natural['routes'] if r['policy'] == 'solar')
    for case in manifest['cases']:
        checkpoint = source_route['checkpoints'][case['source']['checkpoint']]
        if case['id'] == 'new-game-clear':
            check(case['resetOracle']['pristineSource']['sha256'] == source_route['checkpoints']['initial']['sha256'], 'Reset template disconnected from real fresh route start')
        check(case['source']['policy'] == 'solar' and case['source']['original']['sha256'] == checkpoint['sha256'], 'Boundary disconnected from original natural checkpoint')
    return {'status': 'passed', 'classification': manifest['classification'], 'sourceSha': manifest['sourceSha'],
            'sourceClassification': manifest['sourceClassification'], 'cases': [validate_case(case, root) for case in manifest['cases']]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--require-clean', action='store_true')
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.fixture, arguments.require_clean), indent=2))
