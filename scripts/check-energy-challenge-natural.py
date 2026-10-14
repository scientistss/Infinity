#!/usr/bin/env python3
"""Independent anonymous artifact checker. Imports no production/game modules.

python scripts/check-energy-challenge-natural.py --fixture DIR [--require-clean]
The producer's full action replay is corroborated here with exact decimal
production/payment/proof/queue arithmetic. This is not browser-play evidence.
"""
import argparse
import hashlib
import json
from decimal import Decimal, ROUND_FLOOR, localcontext
from fractions import Fraction
from pathlib import Path

RES = ('metal', 'crystal', 'deuterium')
PROOFS = ('metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant')
GOAL = 10**18
WEIGHTS = (1, 3, 10)
BUILD_PRICES = {
    'metal_mine': (60, 15, 0, '1.5'), 'crystal_mine': (48, 24, 0, '1.6'),
    'deuterium_synth': (225, 75, 0, '1.5'), 'solar_plant': (75, 30, 0, '1.5'),
    'robotics_factory': (400, 120, 200, '2'), 'shipyard': (400, 200, 100, '2'),
    'research_lab': (200, 400, 200, '2'), 'metal_storage': (1000, 0, 0, '2'),
    'crystal_storage': (1000, 500, 0, '2'), 'deuterium_tank': (1000, 1000, 0, '2'),
}
TECH_PRICES = {'energy_tech': (0, 800, 400, '2'), 'computer_tech': (0, 400, 600, '2'), 'combustion_drive': (400, 0, 600, '2')}


def check(value, message):
    if not value:
        raise AssertionError(message)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verified_file(root, manifest):
    path = (root / manifest['file']).resolve()
    check(path.is_relative_to(root.resolve()), 'Artifact path escapes fixture directory')
    raw = path.read_bytes()
    check(sha(raw) == manifest['sha256'], f"Artifact hash mismatch: {manifest['file']}")
    return raw


def price(payment):
    row = BUILD_PRICES[payment['target']] if payment['kind'] == 'building' else TECH_PRICES[payment['target']] if payment['kind'] == 'research' else (0, 2000, 500, '1')
    level = payment['targetLevel'] or 1
    with localcontext() as context:
        context.prec = 100
        return {r: str(int((Decimal(row[i]) * Decimal(row[3]) ** (level - 1)).to_integral_value(rounding=ROUND_FLOOR))) for i, r in enumerate(RES)}


def check_route(root, row):
    policy = row['policy']
    check(row['status'] == 'passed', f'{policy}: producer did not pass')
    cps = row['checkpoints']
    required = ['initial', 'entry-ready', 'entered', 'active-progress', 'finish-ready', 'completed',
                'before-third-build-paid', 'third-build-paid', 'third-build-paid-reloaded', 'third-build-completed',
                'before-third-research-paid', 'third-research-paid', 'third-research-paid-reloaded', 'third-research-completed', 'abandoned']
    required += [f'proof-{building}-{status}' for building in PROOFS for status in ('paid', 'completed')]
    check(set(required).issubset(cps), f'{policy}: missing required checkpoints')
    states = {}
    for name, cp in cps.items():
        envelope = json.loads(verified_file(root, cp))
        check(envelope['version'] == 9 and envelope['revision'] == 16, f'{name}: expected actual v9/r16 envelope')
        check(envelope['savedAt'] == envelope['lastTickAt'], f'{name}: hidden offline catchup')
        state = envelope['state']; states[name] = state
        check(len(state['planets']) == 1 and state['activePlanetId'] == 'homeworld', f'{name}: unapproved economy branch')
        check(state['energyChallenge'] == cp['summary']['challenge'], f'{name}: saved challenge differs from visible receipt')
        check(state['planets'][0]['resources'] == cp['summary']['wallets']['homeworld'], f'{name}: saved wallet mismatch')
        check(state['planets'][0]['buildings'] == cp['summary']['buildings'], f'{name}: saved levels mismatch')
        check(state['research']['levels'] == cp['summary']['researchLevels'], f'{name}: saved research mismatch')
        check(state['manualClicks'] == 0, f'{name}: manual collection used')
        check(all(slot['card'] is None for slot in state['protocols']['slots']), f'{name}: in-tick automation invalidates pure production audit')
        check(state['planets'][0]['buildings']['fusion_reactor'] == 0, f'{name}: undeclared fusion use')
        check(state['universe']['seed'] == 20261013, f'{name}: frozen seed changed')
    initial = states['initial']
    check(initial['planets'][0]['resources'] == {'metal': '500', 'crystal': '500', 'deuterium': '0'}, 'Not a real ordinary new game')
    check(all(level == 0 for level in initial['planets'][0]['buildings'].values()), 'Initial levels injected')
    check(all(level == 0 for level in initial['research']['levels'].values()), 'Initial research injected')
    check(initial['orders']['nextJobId'] == 1 and initial['stats']['launches'] == 0, 'Initial identity/curvature mutation')
    for name in ('entry-ready', 'finish-ready'):
        check(Decimal(cps[name]['summary']['warpGain']) >= 1, f'{name}: ordinary curvature not legal')
    check(states['entry-ready']['research']['levels']['energy_tech'] >= 1, 'First cycle lacks paid research completion')
    entered = states['entered']['energyChallenge']['active']
    check(entered and entered['scoreUnits'] == '0' and all(v is None for v in entered['proofs'].values()), 'Entry did not create empty attempt')
    check(states['entered']['stats']['launches'] == 1, 'First legal curvature not applied once')
    attempt = states['finish-ready']['energyChallenge']['active']
    check(attempt['scoreUnits'] == str(GOAL), 'Finish not backed by exact bounded goal')
    completion = states['completed']['energyChallenge']['completion']
    check(completion and completion['attempt'] == attempt, 'Completion did not preserve exact winning attempt')
    check(states['completed']['stats']['launches'] == 2, 'Second legal curvature not applied once')
    check(all(states['finish-ready']['planets'][0]['buildings'][b] >= 1 for b in PROOFS), 'Finish home prerequisites absent')
    check(states['abandoned']['energyChallenge']['active'] is None and states['abandoned']['energyChallenge']['completion'] is None, 'Abandonment incorrectly grants reward')
    active_projection = dict(states['active-progress']); abandoned_projection = dict(states['abandoned'])
    del active_projection['energyChallenge']; del abandoned_projection['energyChallenge']
    check(active_projection == abandoned_projection, 'Abandonment changed actual economy')

    payments = row['payments']; ids = [p['jobId'] for p in payments]
    check(ids == list(range(1, row['final']['nextJobId'])), 'Paid identity trace missing, duplicated or reordered')
    by_id = {p['jobId']: p for p in payments}
    for payment in payments:
        check(payment['cost'] == price(payment), f"Job {payment['jobId']}: independent ordinary price mismatch")
        actual = payment['actualJob']
        check(actual['jobId'] == payment['jobId'] and actual['source'] == 'manual' and actual['taskId'] is None, 'Unverified actual payment job')
        check(actual.get('paid', actual.get('paidPerUnit')) == payment['cost'], 'Paid quote absent from real queue')
        for resource in RES:
            before, after, cost = (Decimal(payment[k][resource]) for k in ('beforeWallet', 'afterWallet', 'cost'))
            check(before >= cost and after >= 0, 'Payment not naturally affordable')
            # Wallet engine uses floating mantissas. This tolerance only corroborates its
            # debit; production score arithmetic below is entirely exact, with no epsilon.
            check(abs((before - after) - cost) <= max(abs(before), Decimal(1)) * Decimal('1e-14'), 'Wallet did not pay recorded ordinary cost')
    completed_ids = [c['jobId'] for c in row['completions']]
    check(len(completed_ids) == len(set(completed_ids)), 'A paid job completed more than once')
    for building in PROOFS:
        proof = attempt['proofs'][building]
        check(proof and entered['entryJobFloor'] <= proof['jobId'] < completion['finish']['jobCeiling'], 'Proof outside real attempt payment bounds')
        payment = by_id[proof['jobId']]
        check(payment['kind'] == 'building' and payment['target'] == building and payment['targetLevel'] == proof['targetLevel'] == 1, 'Proof target mismatches actual paid building')
        check(proof['paid'] == payment['cost'] and proof['jobId'] in completed_ids, 'Proof not backed by real paid completion')
    if policy == 'satellite':
        satellite = [p for p in row['satellitePayments'] if p['stage'] == 'challenge-growth']
        check(satellite and all(p['cost'] == {'metal': '0', 'crystal': '2000', 'deuterium': '500'} for p in satellite), 'Satellite route lacks actual satellite purchases')
        check(any(p['jobId'] in completed_ids for p in satellite), 'Satellite route bought no completed supply')

    for kind, queue in (('build', 'buildQueue'), ('research', 'queue')):
        before = states[f'before-third-{kind}-paid']; paid = states[f'third-{kind}-paid']; reread = states[f'third-{kind}-paid-reloaded']
        q = lambda state: state['planets'][0][queue] if kind == 'build' else state['research'][queue]
        check(len(q(before)) == 2 and len(q(paid)) == 3, f'Actual third {kind} admission absent')
        check(paid == reread, f'Reload replay changed third {kind} payment or timers')
        ids = row['reward']['buildingJobIds' if kind == 'build' else 'researchJobIds']
        check([job['jobId'] for job in q(paid)] == ids, f'{kind}: wrong actual stable IDs')
        check(all(identity in completed_ids for identity in ids), f'{kind}: paid jobs did not complete')
        check(not q(states[f'third-{kind}-completed']), f'{kind}: completion queue not empty')
    check(len(row['rejections']) == 4, 'Missing duplicate curvature/fourth-queue rejection probes')
    trace = [json.loads(line) for line in verified_file(root, row['productionTrace']).splitlines()]
    cumulative = 0
    for index, sample in enumerate(trace, 1):
        check(sample['dt'] == 1, 'Undeclared simulation dt')
        delta = 0
        for resource, weight in zip(RES, WEIGHTS):
            gained = Fraction(sample['after'][resource]) - Fraction(sample['before'][resource])
            check(gained >= 0, 'Pure integration decreased stock without declared fusion')
            delta += gained * weight * 10**12 // 1
        cumulative += delta
        check(str(delta) == sample['independentUpperDeltaUnits'] and str(cumulative) == sample['independentUpperCumulativeUnits'], 'Independent retained-production arithmetic mismatch')
        score = int(sample['actualScoreUnits'])
        check(min(GOAL, cumulative - index * 798) <= score <= min(GOAL, cumulative), 'Score outside strict production-only quantization bounds')
    check(cumulative >= GOAL and trace[-1]['actualScoreUnits'] == str(GOAL), 'Natural production never reached the goal')
    check(row['productionAudit']['independentUpperUnits'] == str(cumulative), 'Production report not linked to trace')
    events = json.loads(verified_file(root, row['receipts']))
    check(len(events) == row['receipts']['count'], 'Action trace count mismatch')
    previous = None
    for index, event in enumerate(events, 1):
        check(event['index'] == index and event['before'] == previous, f'Action chain discontinuity at {index}')
        previous = event['after']
        if event['api'] not in ('tick', 'checkpoint') and event['before'] is not None:
            check(event['before']['challenge'] == event['after']['challenge'], 'Non-production action directly changed adopted challenge state')
        if event['api'] == 'tick':
            check(event['request']['dt'] == 1 and event['request']['mode'] == 'live', 'Simulation schedule changed')
            check(event['after']['logicalSeconds'] - event['before']['logicalSeconds'] == 1, 'Hidden simulation clock change')
        if event['after']['challenge']['active']:
            energy = event['after']['energy']; check(energy['demand'] == energy['ordinaryDemand'] * 2, 'Demand not exactly doubled')
    check(row['replay']['status'] == 'passed' and row['replay']['kind'] == 'fresh-seed-complete-action-transcript' and row['replay']['eventCount'] == len(events), 'Full fresh-seed domain replay absent')
    check(row['nativeProofSteps'] and all(step['kind'] in ('build', 'advance') for step in row['nativeProofSteps']), 'Native proof replay steps absent')
    return {'policy': policy, 'payments': len(payments), 'challengeSeconds': row['stages']['challenge']['seconds'], 'satellitePayments': len(row['satellitePayments']), 'productionUnitsAtLeast': str(cumulative)}


def run(root, require_clean=False):
    report = json.loads((root / 'report.json').read_text())
    check(report['schema'] == 'energy-challenge-natural-v1' and report['status'] == 'passed', 'Producer report is not a passing natural run')
    check(report['evidenceKind'] == 'pure-domain-compressed-logical-time-not-browser-proof', 'Evidence classification changed')
    inputs = report['sourceInput']
    check(inputs == {'kind': 'createInitialState', 'worldSeed': 20261013, 'arcadeSeed': 20261013, 'importedSaves': [], 'importedReports': [], 'stockGrants': [], 'directStatePatches': []}, 'Fresh-start provenance altered')
    if require_clean:
        check(report['sourceClassification'] == 'clean-candidate-source' and not report['dirtyPaths'], 'Diagnostic tree is not clean-source acceptance')
    check([row['policy'] for row in report['routes']] == ['solar', 'satellite', 'throttle'], 'Frozen policy matrix changed')
    rows = [check_route(root, row) for row in report['routes']]
    check(len({row['checkpoints']['entry-ready']['stateSha256'] for row in report['routes']}) == 1, 'Identical frozen-seed first-route controls diverged')
    return {'status': 'passed', 'evidenceKind': report['evidenceKind'], 'sourceClassification': report['sourceClassification'], 'routes': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', required=True, type=Path)
    parser.add_argument('--require-clean', action='store_true')
    arguments = parser.parse_args()
    print(json.dumps(run(arguments.fixture, arguments.require_clean), indent=2))
