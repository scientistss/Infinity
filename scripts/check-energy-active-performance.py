#!/usr/bin/env python3
"""Independent stdlib-only evidence audit, not 100-world/1,000-fleet acceptance.
CPU intervals are exact CDP Timestamp intervals. Native manual-save snapshots
bracket them but are not their endpoints. Rational endpoint-wallet differences
provide only a bounded per-contribution flooring check, not infinite-precision
engine simulation or cross-frame equality. No game/producer helper is imported.
"""
from __future__ import annotations
import argparse
from collections import Counter
from copy import deepcopy
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE_SHA = '6af7a5e85a522ba89478c5e95d919a2c04fb2e55'
VERSION = '0.6.32-alpha.1'
KEY = 'infinity.original-p4.save.v1'
PROFILES = {'ordinary-1world': (1, 0), 'capital-assisted-4world-8fleet': (4, 8)}
PANELS = ('overview', 'curvature', 'fleet')
RESOURCES = ('metal', 'crystal', 'deuterium')
WEIGHTS = (1, 3, 10)
PROOFS = ('metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant')
GOAL, QUANTUM, MAX_BYTES = 10**18, 10**12, 128*1024*1024
DURATION_METRICS = ('TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration')
COUNT_METRICS = ('LayoutCount', 'RecalcStyleCount')


def check(condition, message):
    if not condition: raise AssertionError(message)


def sha(raw):
    return hashlib.sha256(raw.encode() if isinstance(raw, str) else raw).hexdigest()


def canonical(value):
    """Sorted JSON with ECMAScript's ordinary finite-number presentation.

    Preserve exact canonical decimal wallet strings. Python's shortest binary64
    repr is rendered with JS's fixed/exponent threshold and exponent spelling;
    no engine arithmetic or wallet float conversion occurs here.
    """
    def number(x):
        check(math.isfinite(x), 'Nonfinite canonical number')
        if x == 0: return '0'
        if x.is_integer() and abs(x) < 1e21: return str(int(x))
        text = repr(x).lower()
        if 'e' not in text: return text
        mantissa, exponent = text.split('e'); exponent = int(exponent)
        negative = mantissa.startswith('-'); mantissa = mantissa.lstrip('-')
        digits = mantissa.replace('.', '').rstrip('0')
        sign = '-' if negative else ''
        if -6 <= exponent < 21:
            point = 1 + exponent
            if point <= 0: return sign+'0.'+'0'*(-point)+digits
            if point >= len(digits): return sign+digits+'0'*(point-len(digits))
            return sign+digits[:point]+'.'+digits[point:]
        coefficient = digits[0]+('.'+digits[1:] if len(digits)>1 else '')
        return sign+coefficient+'e'+('+' if exponent>=0 else '-')+str(abs(exponent))
    def render(x):
        if x is None: return 'null'
        if x is True: return 'true'
        if x is False: return 'false'
        if type(x) is int: return str(x)
        if type(x) is float: return number(x)
        if type(x) is str: return json.dumps(x, ensure_ascii=False)
        if type(x) is list: return '['+','.join(render(v) for v in x)+']'
        check(type(x) is dict and all(type(k) is str for k in x), 'Unsupported canonical JSON type')
        return '{'+','.join(json.dumps(k,ensure_ascii=False)+':'+render(x[k]) for k in sorted(x))+'}'
    return render(value).encode()


def same(a, b): return canonical(a) == canonical(b)


def decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            check(key not in result, 'Duplicate JSON key'); result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda value: check(False, 'Nonfinite JSON number'))


def original(path):
    path = Path(path)
    check(path.is_file() and not path.is_symlink(), 'Missing ordinary original bytes: '+str(path))
    check(path.stat().st_size <= MAX_BYTES, 'Oversized original')
    return path.read_bytes()


def reference(root, ref):
    check(type(ref) is dict and {'file', 'sha256', 'bytes'} <= set(ref), 'Complete original reference required')
    name = ref['file']; check(type(name) is str and name and '\\' not in name, 'Unsafe original path')
    p = Path(name)
    check(not p.is_absolute() and '..' not in p.parts, 'Original path escapes evidence')
    root = Path(root).resolve(); path = root/p
    check(path.resolve().is_relative_to(root), 'Original path escapes evidence')
    check(all(not (root/Path(*p.parts[:i])).is_symlink() for i in range(1, len(p.parts)+1)), 'Symlink original path')
    check(type(ref['bytes']) is int and 0 <= ref['bytes'] <= MAX_BYTES, 'Invalid original byte count')
    check(type(ref['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}', ref['sha256']), 'Invalid original digest')
    raw = original(path)
    check(len(raw) == ref['bytes'] and sha(raw) == ref['sha256'], 'Original byte digest/count mismatch: '+name)
    return raw


def integer(value, low=0, high=2**53-1):
    check(type(value) is int and low <= value <= high, 'Invalid bounded integer'); return value


def finite(value): return type(value) in (int, float) and math.isfinite(value)


def amount(text):
    """Parse bounded canonical decimals without JS helpers or float conversion."""
    check(type(text) is str and 0 < len(text) <= 512, 'Invalid decimal amount type/length')
    m = re.fullmatch(r'(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:e([+-]?(?:0|[1-9][0-9]*)))?', text)
    check(m is not None, 'Noncanonical or nonfinite decimal amount')
    exponent = int(m[3] or '0') - len(m[2] or '')
    check(abs(exponent) <= 100, 'Decimal exponent outside ordinary diagnostic')
    n = int(m[1]+(m[2] or ''))
    return Fraction(n*10**max(0, exponent), 10**max(0, -exponent))


def score(value):
    check(type(value) is str and re.fullmatch(r'0|[1-9][0-9]*', value) and len(value) <= 19, 'Noncanonical score')
    result = int(value); check(0 <= result < GOAL, 'Capped or overflowing score is outside diagnostic'); return result


def envelope(raw):
    value = decode(raw)
    check(type(value) is dict and value.get('schema') == 'infinity-original-p4' and type(value.get('version')) is int and value['version'] == 9
          and type(value.get('revision')) is int and value['revision'] == 16, 'Exact public v9/r16 envelope required')
    for k in ('savedAt', 'lastTickAt'):
        check(finite(value.get(k)) and 0 <= value[k] <= 2**53-1, 'Invalid save clock')
    check(value['savedAt'] >= value['lastTickAt'], 'Save tick timestamp is in the future')
    check(type(value.get('state')) is dict, 'Missing complete serialized state')
    return value


def validate_abandon(active, control):
    check(active['energyChallenge']['active'] is not None, 'No active source for abandonment')
    expected = deepcopy(active); expected['energyChallenge']['active'] = None
    check(same(expected, control), 'Abandon control changed fields other than energyChallenge.active')


def validate_profile_state(state, profile, variant, minimum_remaining=0):
    worlds, fleets = PROFILES[profile]
    check(len(state['planets']) == worlds and len(state['fleets']) == fleets, 'Wrong independently counted workload population')
    ids = [p['id'] for p in state['planets']]
    check(len(set(ids)) == worlds and ids[0] == 'homeworld' and state['activePlanetId'] in ids, 'Invalid world identity')
    check(state['universe']['seed'] == 20261013, 'Wrong pristine seeds')
    c = state['energyChallenge']
    check(c['model'] == 'energy-tightening-v1' and c['completion'] is None, 'Completed/foreign challenge')
    check((c['active'] is not None) == (variant == 'active'), 'Wrong active/control phase')
    if variant == 'active':
        a = c['active']; score(a['scoreUnits'])
        check(a['homeworldId'] == 'homeworld' and a['universeSeed'] == 20261013, 'Challenge source identity')
        check(set(a['proofs']) == set(PROOFS) and all(type(p) is dict for p in a['proofs'].values()), 'Four real home proofs required')
        jobs = [p['jobId'] for p in a['proofs'].values()]
        check(len(set(jobs)) == 4, 'Duplicate proof jobs')
        for j in jobs: integer(j, a['entryJobFloor'], state['orders']['nextJobId']-1)
    check(state['manualClicks'] == 0 and state['stats']['automatedLaunches'] == 0, 'Collection/automated launch contamination')
    check(not state['research']['queue'] and not state['boosters'], 'Outstanding research/boosters')
    check(all(slot['card'] is None for slot in state['protocols']['slots']), 'Protocol action contamination')
    for p in state['planets']:
        b = p['buildings']
        check(all(b[m] == 1 for m in PROOFS[:3]) and b['solar_plant'] == 4 and b['fusion_reactor'] == 0, 'Wrong mine/solar/no-fusion baseline')
        check(all(p['productionPct'][m] == 100 for m in (*PROOFS, 'fusion_reactor')), 'Production throttle contamination')
        check(not p['buildQueue'] and not p['shipyardQueue'] and p['demolition'] is None, 'Outstanding economic jobs')
        check(p['units']['solar_satellite'] == 0, 'Satellite baseline contamination')
        for r, storage in zip(RESOURCES, ('metal_storage', 'crystal_storage', 'deuterium_tank')):
            cap = 5000*math.floor(2.5*math.exp(20*integer(b[storage], 0, 40)/33))
            check(amount(p['resources'][r]) < cap, 'Full/overflow warehouse invalidates uncapped wallet bound')
        # Three L1 mines consume44 ordinary units, doubled88; solar L4=117.128.
        check(20*4*Fraction(11, 10)**4 >= 44*(2 if variant == 'active' else 1), 'Energy factor below one')
    ids = []
    for f in state['fleets']:
        ids.append(integer(f['id'], 1))
        check(f['mission'] == 'transport' and f['returning'] is False and f.get('orderTransport') is None, 'Only actual manual outbound transports allowed')
        check(finite(f['remaining']) and f['remaining'] > minimum_remaining and finite(f['duration'])
              and f['duration'] >= f['remaining'] > 0, 'Fleet arrival inside diagnostic horizon')
        check(f['originId'] in {p['id'] for p in state['planets']} and sum(f['ships'].values()) > 0, 'Invalid actual fleet')
        check(not f.get('charge') and not f.get('npcAttack'), 'Extra fleet mechanisms')
        for v in f['cargo'].values(): amount(v)
    check(len(set(ids)) == fleets, 'Duplicate actual fleet identity')
    return {'worlds': worlds, 'fleets': fleets}


def retained_score_bound(before, after, native_frames):
    """Exact endpoint rational bound; source-guard count is intentionally loose."""
    integer(native_frames, 1, 100000)
    bs = {p['id']: p for p in before['planets']}; ads = {p['id']: p for p in after['planets']}
    check(set(bs) == set(ads), 'World set changed during score window')
    check(len(before['fleets']) == len(after['fleets']), 'Fleet arrival/count change')
    weighted = Fraction(0)
    for pid, p in bs.items():
        for r, weight in zip(RESOURCES, WEIGHTS):
            gain = amount(ads[pid]['resources'][r])-amount(p['resources'][r])
            check(gain >= 0, 'Negative retained wallet gain invalidates production-only bound')
            weighted += gain*weight*QUANTUM
    # Pinned tick guard for live dt<5: ceil(dt)+ceil(dt/10)+
    # 8*worlds*ceil(dt/1)+4*fleets+256 <=262+40W+4F.
    segments = 262+40*len(bs)+4*len(before['fleets'])
    contributions = 3*len(bs)*segments*(native_frames+2)
    lower, upper = max(0, math.floor(weighted)-contributions), math.floor(weighted)
    a, b = deepcopy(before['energyChallenge']['active']), deepcopy(after['energyChallenge']['active'])
    check(a is not None and b is not None, 'Active score bound needs two active snapshots')
    start, end = score(a.pop('scoreUnits')), score(b.pop('scoreUnits'))
    check(same(a, b), 'Challenge identity/proofs changed during measurement')
    actual = end-start
    check(0 < actual and lower <= actual <= upper, 'Score injection/loss outside retained-wallet flooring bound')
    check(upper+start < GOAL, 'Potential score cap invalidates bound')
    return {'scoreDeltaUnits': str(actual), 'retainedWeightedNumerator': str(weighted.numerator),
            'retainedWeightedDenominator': str(weighted.denominator), 'lowerUnits': str(lower), 'upperUnits': str(upper),
            'floorLossBoundUnits': str(contributions), 'nativeCallbacks': native_frames, 'segmentsPerCallbackUpper': segments}


def metric_values(raw):
    check(type(raw) is dict and type(raw.get('metrics')) is list, 'Missing raw CDP metrics')
    values = {}
    for r in raw['metrics']:
        check(type(r) is dict and type(r.get('name')) is str and r['name'] not in values, 'Duplicate/malformed raw CDP metric')
        check(finite(r.get('value')), 'Nonfinite raw CDP metric'); values[r['name']] = r['value']
    check(all(k in values for k in ('Timestamp', *DURATION_METRICS, *COUNT_METRICS)), 'Incomplete raw CDP metric census')
    return values


def metric_delta(before, after):
    a, b = metric_values(before), metric_values(after); elapsed = b['Timestamp']-a['Timestamp']
    check(2 <= elapsed < 5, 'CDP timestamp window outside native two-second diagnostic')
    check(all(b[k] >= a[k] >= 0 for k in (*DURATION_METRICS, *COUNT_METRICS)), 'Decreasing/negative cumulative CDP metric')
    durations = {k: (b[k]-a[k])*1000 for k in DURATION_METRICS}
    check(all(v <= elapsed*1000 for v in durations.values()), 'CPU duration exceeds timestamp interval')
    return {'elapsedMs': elapsed*1000, 'durationMs': durations,
            'durationMsPerSecond': {k: v/elapsed for k, v in durations.items()},
            'counts': {k: b[k]-a[k] for k in COUNT_METRICS}}


def expected_schedule():
    return [{'profile': p, 'repetition': rep, 'position': position, 'variant': variant}
            for p in PROFILES for rep in range(1, 4)
            for position, variant in enumerate(('active', 'control') if rep % 2 else ('control', 'active'), 1)]


def summarize(rows):
    """Read no producer-derived success, mean, sample count or pairing."""
    check(len(rows) == 36, 'Complete 36-window sample census required')
    expected = {(r['profile'], r['repetition'], r['variant'], panel) for r in expected_schedule() for panel in PANELS}
    actual = [(r['profile'], r['repetition'], r['variant'], r['panel']) for r in rows]
    check(len(set(actual)) == len(actual) and set(actual) == expected, 'Missing/duplicate/mispaired raw sample')
    result = []
    for p in PROFILES:
        for panel in PANELS:
            item = {'profile': p, 'panel': panel, 'samplesPerSide': 3, 'metrics': {}}
            for metric in DURATION_METRICS:
                sides = {side: [next(r for r in rows if (r['profile'], r['panel'], r['variant'], r['repetition']) == (p, panel, side, rep))['metrics']['durationMsPerSecond'][metric]
                               for rep in range(1, 4)] for side in ('active', 'control')}
                delta = [a-b for a, b in zip(sides['active'], sides['control'])]
                item['metrics'][metric] = {'active': sides['active'], 'control': sides['control'],
                    'activeMedianMsPerSecond': statistics.median(sides['active']), 'controlMedianMsPerSecond': statistics.median(sides['control']),
                    'pairedDeltasMsPerSecond': delta, 'pairedMedianDeltaMsPerSecond': statistics.median(delta)}
            result.append(item)
    return result

SOURCE_TREE = '24bcfa662e8cb47a5f2d24016d34986c3ea15617'
INITIAL_STATE_SHA = '503b9b52259803c440c429617b517a64db615e5c8c524f45c04530bf8a09a0ef'
FIXTURE_CENSUS = {
 'ordinary-1world': {'createInitialState':1,'checkpoint':13,'enqueue':76,'tick':1805,'enqueueResearch':1,'enterEnergyChallenge':1},
 'capital-assisted-4world-8fleet': {'createInitialState':1,'checkpoint':13,'enqueue':127,'tick':2255,'enqueueResearch':22,
     'enterEnergyChallenge':1,'walletTopup':77,'orderUnits':2,'coordinateCandidate':31,'sendFleet':11,'selectPlanet':5},
}


def verify_source(root):
    root = Path(root).resolve()
    def git(*args): return subprocess.check_output(['git','--no-replace-objects','-C',str(root),*args])
    check(git('rev-parse','HEAD').strip().decode() == SOURCE_SHA, 'Not the approved immutable application source')
    check(git('rev-parse','HEAD^{tree}').strip().decode() == SOURCE_TREE, 'Wrong immutable application tree')
    entries = git('ls-tree','-rz','HEAD').split(b'\0'); files = {}
    for entry in filter(None, entries):
        meta, path = entry.split(b'\t'); mode, kind, digest = meta.decode().split(); path = path.decode()
        check(mode in ('100644','100755') and kind == 'blob', 'Nonordinary immutable source file')
        raw = original(root/path)
        check(hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == digest, 'Application source bytes changed: '+path)
        files[path] = sha(raw)
    check(len(files) == 719, 'Incomplete immutable application source census')
    return files


def match_summary(state, summary):
    check(summary['stateSha256'] == sha(canonical(state)), 'Summary state hash detached from full raw state')
    for k, sk in (('totalTime','totalTime'),('energyChallenge','challenge'),('activePlanetId','activePlanetId'),
                  ('lifetime','lifetime'),('warpCores','warpCores'),('research','research'),('fleets','fleets')):
        check(same(state[k], summary[sk]), 'Summary differs from raw state '+k)
    check(state['orders']['nextJobId'] == summary['nextJobId'] and state['stats']['launches'] == summary['launches'], 'Summary order/stat mismatch')
    check(len(state['planets']) == len(summary['planets']), 'Summary world census mismatch')
    for actual, displayed in zip(state['planets'], summary['planets']):
        for k in ('id','coordinates','resources','buildings','units','buildQueue','shipyardQueue','productionPct'):
            check(same(actual[k], displayed[k]), 'Summary world field mismatch '+k)


def wallet_grant(event):
    before, after, receipt = event['beforeState'], event['afterState'], event['grant']
    pid = receipt['planetId']
    b = next(p for p in before['planets'] if p['id'] == pid)
    a = next(p for p in after['planets'] if p['id'] == pid)
    check(same(b['resources'], receipt['beforeWallet']) and same(a['resources'], receipt['afterWallet']), 'Grant wallet receipt mismatch')
    expected = deepcopy(before)
    next(p for p in expected['planets'] if p['id'] == pid)['resources'] = deepcopy(a['resources'])
    check(same(expected, after), 'Capital grant changed non-wallet state or score')
    positive = False
    for r in RESOURCES:
        gain = amount(a['resources'][r])-amount(b['resources'][r])
        check(gain >= 0 and gain == amount(receipt['granted'][r]), 'Grant receipt is not exact rational wallet increase')
        positive |= gain > 0
    check(positive and receipt['scoreBefore'] == receipt['scoreAfter'] == before['energyChallenge']['active']['scoreUnits'], 'Grant fabricated challenge progress')
    check(same(event['request']['afterWallet'], a['resources']) and event['request']['planetId'] == pid, 'Grant request mismatch')


def actual_jobs(state):
    result = []
    for p in state['planets']:
        result += [{'kind':'building','planetId':p['id'],**j} for j in p['buildQueue']]
        result += [{'kind':'shipyard','planetId':p['id'],**j} for j in p['shipyardQueue']]
    result += [{'kind':'research',**j} for j in state['research']['queue']]
    return result


def payment(event):
    before, after, p = event['beforeState'], event['afterState'], event['payment']
    job_id = p['jobId']; integer(job_id, 1)
    check(before['orders']['nextJobId'] == job_id and after['orders']['nextJobId'] == job_id+1, 'Paid job ID not actually allocated')
    check(same(before['energyChallenge'], after['energyChallenge']), 'Non-production payment injected score/proofs')
    jobs = [j for j in actual_jobs(after) if j['jobId'] == job_id]
    check(len(jobs) == 1 and same(jobs[0], p['actualJob']), 'Missing actual paid queue job')
    j = jobs[0]; check(j['source'] == 'manual' and j['taskId'] is None, 'Nonmanual payment')
    paid = j['paidPerUnit'] if p['kind'] == 'shipyard' else j['paid']
    count = integer(p['count'], 1)
    for r in RESOURCES:
        cost = amount(p['cost'][r]); check(cost == amount(paid[r])*(count if p['kind']=='shipyard' else 1), 'Payment does not match actual job debit')
        b = next(w for w in before['planets'] if w['id'] == p['planetId'])['resources'][r]
        a = next(w for w in after['planets'] if w['id'] == p['planetId'])['resources'][r]
        check(p['beforeWallet'][r] == b and p['afterWallet'][r] == a and amount(b) >= cost and amount(a) <= amount(b), 'Paid wallet receipt mismatch')
    check(any(amount(x)>0 for x in p['cost'].values()), 'Unpaid development action')


def tick_score(event):
    b, a = event['before'], event['after']
    if b['challenge']['active'] is None:
        check(a['challenge']['active'] is None, 'Tick fabricated challenge entry'); return
    before, after = b['challenge']['active'], a['challenge']['active']
    check(after is not None, 'Tick abandoned/completed challenge')
    bs = {p['id']:p for p in b['planets']}; ads = {p['id']:p for p in a['planets']}
    check(set(bs) <= set(ads), 'Tick removed owned world')
    total = Fraction(0)
    for pid, p in bs.items():
        for r,w in zip(RESOURCES,WEIGHTS):
            delta = amount(ads[pid]['resources'][r])-amount(p['resources'][r])
            check(delta >= 0, 'Tick unexpectedly consumed wallet resources')
            total += delta*w*QUANTUM
    # Real colonization creates zero wallets, then the remainder of this tick
    # may produce on the new worlds. Count their final retained stock as gain.
    for pid in set(ads)-set(bs):
        for r,w in zip(RESOURCES,WEIGHTS): total += amount(ads[pid]['resources'][r])*w*QUANTUM
    loss = 3*len(ads)*(258+8*len(bs)+4*len(b['fleets']))
    delta = score(after['scoreUnits'])-score(before['scoreUnits'])
    check(max(0, math.floor(total)-loss) <= delta <= math.floor(total), 'Fixture tick score injected or outside independent flooring bound')


def validate_fixture(directory, source_files=None):
    directory = Path(directory); report = decode(original(directory/'report.json'))
    check(report['schema'] == 'energy-active-performance-fixtures-v1' and report['status'] == 'passed', 'Wrong fixture report')
    check(report['evidenceKind'] == 'fresh-domain-fixtures-not-native-performance-proof', 'Fixture misclassified as browser proof')
    check(report['sourceSha'] == SOURCE_SHA and report['sourceTree'] == SOURCE_TREE and report['storageKey'] == KEY
          and report['saveVersion'] == 9 and report['saveRevision'] == 16, 'Fixture source identity mismatch')
    check(report['sourceInput'] == {'kind':'createInitialState','worldSeed':20261013,'arcadeSeed':20261013,
          'importedSaves':[],'importedReports':[], 'permittedSyntheticChange':'capital profile after natural checkpoint: receipt-backed wallet topups only'}, 'Fixture ancestry changed')
    files = report['sourceFiles']; check(len({r['path'] for r in files}) == len(files), 'Duplicate source manifest file')
    check(sha(canonical(files)) == report['sourceManifestSha256'], 'Source manifest digest mismatch')
    if source_files is not None:
        expected = {k:v for k,v in source_files.items() if k.startswith('src/') or k in ('package.json','package-lock.json','scripts/energy-challenge-natural-fixture.mjs')}
        harness = 'scripts/energy-active-performance-fixture.mjs'
        expected[harness] = sha(original(ROOT/harness))
        check({x['path']:x['sha256'] for x in files} == expected, 'Fixture executed-source manifest mismatch')
    check([p['id'] for p in report['profiles']] == list(PROFILES), 'Incomplete fixture profile census')
    checked = {}; checkpoints_by_profile = {}
    for profile in report['profiles']:
        pid = profile['id']; check(profile['capitalAssisted'] == (pid != 'ordinary-1world'), 'Capital profile misclassified')
        rows = [decode(line) for line in reference(directory, profile['transcript']).splitlines()]
        check(dict(Counter(e['api'] for e in rows)) == FIXTURE_CENSUS[pid], 'Missing/extra fixture action receipt')
        check([r['index'] for r in rows] == list(range(1,len(rows)+1)), 'Incomplete ordered fixture transcript')
        raw_states = {}; raw_envelopes = {}
        for name, ref in profile['checkpoints'].items():
            e = envelope(reference(directory, ref)); s = e['state']
            check(sha(canonical(s)) == ref['stateSha256'], 'Checkpoint state hash mismatch')
            match_summary(s, ref['summary']); raw_states[name] = s; raw_envelopes[name] = e
        check(sha(canonical(raw_states['initial'])) == INITIAL_STATE_SHA, 'Fresh seed state differs from independently reviewed initial source')
        check(set(raw_states) == {'initial','entry-ready','entered','natural-checkpoint','active',*[f'proof-{p}-{stage}' for p in PROOFS for stage in ('paid','completed')]}, 'Incomplete raw checkpoint set')
        prev = INITIAL_STATE_SHA; previous_summary = None; seconds = 0; payments = []; grants = []; completions = []; dispatches = []; colonies = []
        natural_index = profile['checkpoints']['natural-checkpoint']['eventIndex']
        for e in rows:
            check(e['beforeHash'] == prev and e['before']['stateSha256'] == e['beforeHash'] and e['after']['stateSha256'] == e['afterHash'], 'Broken fixture state-hash chain')
            if previous_summary is not None: check(same(e['before'], previous_summary), 'Fixture summary chain break')
            for side in ('before','after'):
                if side+'State' in e: match_summary(e[side+'State'], e[side])
            api = e['api']
            if api == 'tick':
                check(e['request']['dt'] == 1 and type(e['request']['dt']) is int and e['request']['mode'] == 'live', 'Fixture tick schedule changed')
                seconds += 1; tick_score(e)
                completions.extend(e.get('completed',[]))
                old = {p['id'] for p in e['before']['planets']}; new = {p['id'] for p in e['after']['planets']}
                if new-old:
                    check('afterState' in e and 'beforeState' in e, 'Colony creation lacks full raw state receipt')
                    colonies.extend(new-old)
            elif api in ('enqueue','enqueueResearch','orderUnits'):
                payment(e); payments.append(e['payment'])
            elif api == 'walletTopup':
                check(pid != 'ordinary-1world' and e['index'] > natural_index, 'Grant outside permitted capital setup')
                wallet_grant(e); grants.append(e['grant'])
            elif api == 'enterEnergyChallenge':
                check(e['quote']['ok'] is True and e['quote']['action'] == 'enter' and e['quote']['gain'] == '1', 'No legal real challenge-entry quote')
                check(same(e['beforeState'], raw_states['entry-ready']) and same(e['afterState'],raw_states['entered']), 'Entry candidate disconnected from raw persisted states')
                a = e['afterState']['energyChallenge']['active']
                check(a['scoreUnits']=='0' and all(v is None for v in a['proofs'].values()) and a['entryJobFloor']==e['afterState']['orders']['nextJobId'], 'Entry injected proof/score')
            elif api == 'checkpoint':
                name = e['request']['name']; check(e['beforeHash'] == e['afterHash'] == sha(canonical(raw_states[name])), 'Checkpoint adopted different state')
                check(raw_envelopes[name]['savedAt'] == raw_envelopes[name]['lastTickAt'] == 1791849600000+seconds*1000, 'Checkpoint logical clock mismatch')
            elif api == 'sendFleet':
                check(e['quote']['ok'] is True and e['fleetId'] == e['beforeState']['nextFleetId'], 'Fleet not admitted by actual API')
                old = e['beforeState']['fleets']; new = e['afterState']['fleets']
                check(len(new)==len(old)+1 and same(new[:-1],old) and new[-1]['id']==e['fleetId'], 'Missing actual dispatched fleet')
                check(new[-1]['mission']==e['request']['mission'] and same(new[-1]['target'],e['request']['target']) and same(new[-1]['ships'],e['request']['ships']), 'Dispatch request mismatch')
                check(same(e['beforeState']['energyChallenge'],e['afterState']['energyChallenge']), 'Fleet injected score')
                dispatches.append(e)
            elif api in ('createInitialState','coordinateCandidate'):
                check(e['beforeHash']==e['afterHash'], 'Read-only fixture action changed state')
            elif api == 'selectPlanet':
                check(e['after']['activePlanetId'] == e['request']['planetId'], 'Selection mismatch')
            check(e['after']['logicalSeconds'] == seconds, 'Hidden fixture clock change')
            if api not in ('tick','enterEnergyChallenge'):
                check(same(e['before']['challenge'],e['after']['challenge']), 'Nonproduction fixture action injected score')
            prev = e['afterHash']; previous_summary = e['after']
        check(same(payments,profile['payments']) and same(grants,profile['grants']) and same(completions,profile['completions']), 'Detached/missing fixture payment, grant or completion receipt')
        check(len({p['jobId'] for p in payments})==len(payments), 'Reused paid job ID')
        check(set(c['jobId'] for c in completions)==set(p['jobId'] for p in payments), 'Uncompleted or unpaid setup job')
        variants = {}
        for variant in ('active','control'):
            e = envelope(reference(directory, profile['variants'][variant])); s = e['state']
            check(sha(canonical(s)) == profile['variants'][variant]['stateSha256'], 'Variant state digest mismatch')
            match_summary(s,profile['variants'][variant]['summary']); validate_profile_state(s,pid,variant,180)
            variants[variant] = s
        check(prev == sha(canonical(variants['active'])) and same(raw_states['active'],variants['active']), 'Final fixture not chained to raw action transcript')
        validate_abandon(variants['active'], variants['control'])
        d = profile['controlDerivation']
        check(d['api']=='quoteEnergyChallenge + abandonEnergyChallenge + SaveSession.save + new SaveSession' and d['quote']['ok'] is True and d['quote']['action']=='abandon'
              and same(d['beforeState'],variants['active']) and same(d['afterState'],variants['control']), 'Missing actual legal abandonment receipt')
        for proof, receipt in variants['active']['energyChallenge']['active']['proofs'].items():
            matches = [p for p in payments if p['jobId']==receipt['jobId']]
            check(len(matches)==1 and matches[0]['target']==proof and matches[0]['planetId']=='homeworld'
                  and matches[0]['targetLevel']==receipt['targetLevel'] and same(matches[0]['cost'],receipt['paid']), 'Proof lacks actual owned payment')
            paid = raw_states['proof-'+proof+'-paid']; done = raw_states['proof-'+proof+'-completed']
            check(any(j['jobId']==receipt['jobId'] for j in actual_jobs(paid)) and done['energyChallenge']['active']['proofs'][proof]==receipt, 'Proof lacks paid/completed raw checkpoint')
        if pid=='ordinary-1world': check(not grants and not dispatches and not colonies, 'Natural profile contaminated')
        else:
            check(len(grants)==77 and len(set(colonies))==3 and Counter(e['request']['mission'] for e in dispatches)=={'colonize':3,'transport':8}, 'Missing capital grant/colony/transport proof')
        checked[pid] = variants; checkpoints_by_profile[pid] = raw_states
    check(same(checkpoints_by_profile['ordinary-1world']['natural-checkpoint'], checkpoints_by_profile['capital-assisted-4world-8fleet']['natural-checkpoint']), 'Capital profile did not start from identical natural checkpoint')
    return report, checked

RELEASE_SHA = '327ead4aa33749136c24ff966a6b4337e9ad00114dd39907f8324abf4179d030'
JS_PATH = 'assets/index-DlOkUbpE.js'
JS_SHA = '45b064cc53431b87ed312dd5fecf450c5d5085485a42b620dce5b978cb173df9'


def verify_build(build):
    build = Path(build).resolve(); raw = original(build/'release.json')
    check(sha(raw) == RELEASE_SHA, 'Not exact published release bytes')
    release = decode(raw)
    check(release['sourceSha']==SOURCE_SHA and release['version']==VERSION and release['saveRevision']==16 and release['saveVersion']==9, 'Release identity changed')
    expected = {**release['files'],'release.json':RELEASE_SHA}
    check(len(release['files'])==62 and release['files'][JS_PATH]==JS_SHA, 'Wrong approved asset census')
    files = {str(p.relative_to(build)):sha(original(p)) for p in build.rglob('*') if p.is_file()}
    check(files==expected, 'Build has missing, extra or changed asset bytes')
    check(not any(p.is_symlink() for p in build.rglob('*')), 'Symlink build asset')
    return release, files


def source_literal(path, name):
    import ast
    nodes = ast.parse(original(path).decode()).body
    matches = [n.value for n in nodes if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets)]
    check(len(matches)==1, 'Missing/duplicate source literal '+name)
    return ast.literal_eval(matches[0])


def light_marker(marker, observations, tab=None):
    check(marker['documentId']==observations['documentId'], 'Marker has wrong native document')
    check(marker['hidden'] is False and marker['visibility']=='visible', 'Hidden native timing window')
    expected = {'date','dateConstructor','performance','raf','cancelRaf','timeout','interval','clearTimeout','clearInterval','get','set','remove','clear','key','nativeCode','storage'}
    check(set(marker['native'])==expected and all(v is True for v in marker['native'].values()), 'Native API changed or witness incomplete')
    check(finite(marker['now']) and finite(marker['wallNow']), 'Invalid native marker clock')
    if tab is not None: check(marker['tab']==tab, 'Wrong observed native tab')
    count = integer(marker['rafCount'],0,len(observations['raf']))
    if count: check(observations['raf'][count-1]['at']<=marker['now'], 'RAF census after native marker')
    if count<len(observations['raf']): check(observations['raf'][count]['at']>=marker['now'], 'Missing RAF callbacks at marker')
    count = integer(marker['eventCount'],0,len(observations['events']))
    if count: check(observations['events'][count-1]['at']<=marker['now'], 'Input census after marker')
    if count<len(observations['events']): check(observations['events'][count]['at']>=marker['now'], 'Missing input events at marker')


def static_state(state):
    """Remove only known idle progress fields, preserving all economic structure."""
    state = deepcopy(state)
    for k in ('totalTime','lifetime'): state.pop(k)
    state['npcEconomy'].pop('now')
    state['protocols'].pop('accumulator'); state['orders'].pop('accumulator')
    state['arcade'].pop('beaconProgress')
    if state['energyChallenge']['active'] is not None: state['energyChallenge']['active'].pop('scoreUnits')
    for p in state['planets']: p.pop('resources')
    for f in state['fleets']: f.pop('remaining'); f.pop('elapsed')
    return state


def idle_pair(before, after, profile, variant):
    validate_profile_state(before,profile,variant); validate_profile_state(after,profile,variant)
    check(same(static_state(before),static_state(after)), 'Idle browser interval changed non-progress state')
    check(amount(after['totalTime'])>=amount(before['totalTime']), 'Live total time decreased')
    for b,a in zip(before['planets'],after['planets']):
        for r in RESOURCES: check(amount(a['resources'][r])>=amount(b['resources'][r]), 'Live wallet decreased')
    for r in RESOURCES: check(amount(after['lifetime'][r])>=amount(before['lifetime'][r]), 'Live lifetime decreased')
    for b,a in zip(before['fleets'],after['fleets']):
        check(0<a['remaining']<=b['remaining'] and a['elapsed']>=b['elapsed'], 'Fleet countdown/arrival mismatch')


def verify_observations(observations):
    check(re.fullmatch(r'[0-9a-f-]{36}',observations['documentId']), 'Invalid native document ID')
    check(observations['seedError'] is None and observations['reloaded'] is False and observations['errors']==[] and observations['visibility']==[], 'Native startup/error/visibility contamination')
    raf = observations['raf']; events = observations['events']
    check(len(raf)>=3 and [r['sequence'] for r in raf]==list(range(len(raf))), 'Incomplete native RAF census')
    check(raf[0]['interval'] is None, 'Missing first native callback')
    for prev,row in zip(raf,raf[1:]):
        check(finite(row['at']) and finite(row['wallAt']) and 0<row['at']-prev['at']<5000
              and row['interval']==row['at']-prev['at'], 'Non-native/duplicate/catch-up-sized RAF interval')
    check([r['sequence'] for r in events]==list(range(len(events))) and len(events)==48, 'Incomplete actual pointer/click census')
    expected_clicks = []
    for tab in PANELS: expected_clicks += [('save',None),(None,tab),(None,'save'),('save',None)]
    for i,(action,tab) in enumerate(expected_clicks):
        quartet = events[4*i:4*i+4]
        check([(r['type'],r['stage']) for r in quartet]==[('pointerdown','capture'),('pointerup','capture'),('click','capture'),('click','bubble')], 'Actual trusted input order changed')
        check(all(r['trusted'] is True and r['target']['disabled'] is False and r['target']['action']==action and r['target']['tab']==tab for r in quartet), 'Untrusted/disabled/mismatched input target')
        check(all(finite(r['at']) and finite(r['eventTimestamp']) for r in quartet), 'Invalid actual input time')
        check(all(a['at']<=b['at'] for a,b in zip(quartet,quartet[1:])), 'Reversed actual event chronology')
        check(quartet[2]['eventTimestamp']==quartet[3]['eventTimestamp'], 'Capture/bubble are different click events')
    check(all(a['at']<=b['at'] for a,b in zip(events,events[1:])), 'Reversed native input chronology')
    check(observations['statusChanges'], 'Missing startup/status observations')
    for row in observations['statusChanges']:
        check(not any(x in (row['status'] or '')+(row['notice'] or '') for x in ('追赶','保护','暂停写入','不可用','临时初始')), 'Protected/catch-up state observed')
    light_marker(observations['observation'],observations,'save')
    for row in observations['longTasks']:
        check(finite(row['start']) and finite(row['duration']) and row['duration']>=50, 'Malformed raw long task')
    for row in observations['eventTiming']:
        check(all(finite(row[k]) for k in ('start','duration','processingStart','processingEnd','interactionId')),
              'Malformed EventTiming entry')
        check(row['start']<=row['processingStart']<=row['processingEnd'] and row['duration']>=0, 'Invalid EventTiming chronology')
    return events


def collect_storage(root, value, required):
    check(value['current'] is not None, 'Current raw save missing')
    raw = reference(root,value['current']); required[value['current']['file']] = value['current']; result = envelope(raw)
    keys = []
    for row in value['backups']:
        check(row['key'].startswith(KEY+'.backup'), 'Unexpected backup namespace')
        keys.append(row['key']); envelope(reference(root,row['raw'])); required[row['raw']['file']] = row['raw']
    check(len(set(keys))==len(keys), 'Duplicate raw backup key')
    # Fresh current-r16 ordinary save neither migrates nor replaces, hence no backups.
    check(keys==[], 'Unexpected backup in fresh current-r16 native context')
    check(value['readStartedAt']<=value['readEndedAt'] and value['readStartedWallAt']<=value['readEndedWallAt'], 'Reversed storage observation')
    return raw, result


def save_witness(root, ref, observations, required, expected_id):
    witness = decode(reference(root,ref))
    check(witness['id']==expected_id, 'Save witness belongs to another window')
    events=observations['events']; capture=witness['click']; bubble=witness['bubble']
    for row in (capture,bubble):
        index=integer(row['sequence'],0,len(events)-1); check(same(events[index],row), 'Save witness not bound to actual event census')
    check(capture['type']=='click' and capture['stage']=='capture' and bubble['sequence']==capture['sequence']+1 and bubble['stage']=='bubble', 'Save witness event boundary mismatch')
    check(capture['trusted'] is True and bubble['trusted'] is True and capture['target']['action']==bubble['target']['action']=='save', 'Untrusted/non-Save input')
    light_marker(witness['before'],observations,'save'); light_marker(witness['after'],observations,'save')
    before_raw,before=collect_storage(root,witness['beforeStorage'],required)
    after_raw,after=collect_storage(root,witness['afterStorage'],required)
    check(capture['at']<=witness['before']['now']<=witness['beforeStorage']['readStartedAt']<=witness['beforeStorage']['readEndedAt']
          <=bubble['at']<=witness['after']['now']<=witness['afterStorage']['readStartedAt'], 'Manual save readback is not synchronous capture-to-bubble')
    check(witness['after']['status']=='已保存到本地', 'Native manual save failed')
    check(capture['wallAt']<=after['savedAt']<=bubble['wallAt'] and after['savedAt']-after['lastTickAt']<5000, 'Save clock not tied to actual trusted input')
    check(after['savedAt']>=before['savedAt'] and after['lastTickAt']>=before['lastTickAt'], 'Persisted timestamps decreased')
    check(finite(witness['hostActionEndToEndMs']) and witness['hostActionEndToEndMs']>0, 'Missing end-to-end Save timing')
    # The observer's full raw witness must match these extracted original bytes.
    full=next((w for w in observations['witnesses'] if w['id']==expected_id),None)
    check(full is not None and full['beforeStorage']['currentRaw'].encode()==before_raw
          and full['afterStorage']['currentRaw'].encode()==after_raw, 'Save raw extraction detached from original browser observations')
    return witness, after


def strict_readers(root, required, fixture_report):
    manifest=decode(original(root/'strict-reader-inputs.json'))
    check(set(manifest)=={'files'} and len(manifest['files'])==len(required), 'Strict-reader raw-input census mismatch')
    actual={r['file']:r for r in manifest['files']}
    check(len(actual)==len(manifest['files']) and same(actual,required), 'Strict-reader omitted or duplicated a current/backup/seed original')
    output=decode(original(root/'strict-reader-output.json'))
    check(output['schema']=='energy-active-performance-strict-reader-v1' and output['status']=='passed'
          and output['sourceSha']==SOURCE_SHA and same(output['sourceFiles'],fixture_report['sourceFiles'])
          and output['sourceManifestSha256']==fixture_report['sourceManifestSha256'], 'Strict-reader source/producer identity mismatch')
    check(len(output['inputs'])==len(required), 'Strict-reader result census incomplete')
    seen=set()
    for row in output['inputs']:
        path=Path(row['file']).resolve(); check(path.is_relative_to(root.resolve()), 'Strict-reader input escaped native artifacts')
        relative=str(path.relative_to(root.resolve())); check(relative in required and relative not in seen, 'Strict-reader duplicate/foreign result'); seen.add(relative)
        ref=required[relative]; raw=reference(root,ref); state=envelope(raw)['state']
        check(row['sha256']==ref['sha256'] and row['bytes']==ref['bytes'] and row['readerMode']=='ready' and row['appliedSeconds']==0,
              'Strict reader did not adopt exact raw save without time advance')
        check(same(row['serializedState'],state) and row['stateSha256']==sha(canonical(state)), 'Strict reader normalized or changed saved state')
        check(row['roundtripRawSha256']==sha(raw), 'Strict read/write/reload raw bytes changed')
    return len(seen)



def chronology(before, after, callbacks, seed_state):
    """Bound accounting-clock consistency, never equate observer and RAF clocks.

    Pinned tick() drops at most EPS=1e-9 of each live tick's tail. Its guard
    bounds segments. Fleet elapsed/remaining use binary64 add/sub; 8 ulps per
    guarded segment cover step representation, operation and serialization.
    Decimal.add uses a 1e14 mantissa grid: one full grid unit plus 16 binary64
    ulps per segment covers alignment/scaling/normalization. Decimal.toNumber
    additionally snaps within1e-10 of an integer; both endpoints are allowed.
    AccountedClock endpoint subtraction/addition is bounded separately at the
    epoch timestamp's ulp. These conservative error budgets are reported.
    """
    integer(callbacks,0,100000)
    bs,ads=before['state'],after['state']
    check(same(static_state(bs),static_state(ads)), 'Chronology structural state mismatch')
    clock=(Fraction(after['lastTickAt'])-Fraction(before['lastTickAt']))/1000
    elapsed=amount(ads['totalTime'])-amount(bs['totalTime'])
    from_seed=amount(ads['totalTime'])-amount(seed_state['totalTime'])
    check(0<=clock<120 and 0<=elapsed<120 and 0<=from_seed<120, 'Saved advancement exceeds 120-second native horizon')
    frames=callbacks+2
    segments=frames*(262+40*len(bs['planets'])+4*len(bs['fleets']))
    ulp=lambda x: Fraction(math.ulp(float(x)))
    clock_error=4*(ulp(before['lastTickAt'])+ulp(after['lastTickAt']))/1000
    shared=clock_error+frames*Fraction(1,10**9)+segments*8*ulp(5)
    max_total=max(float(amount(seed_state['totalTime'])+120),float(amount(bs['totalTime'])),float(amount(ads['totalTime'])))
    exponent=math.floor(math.log10(max_total))
    grid=Fraction(10**max(0,exponent-14),10**max(0,14-exponent))
    total_bound=shared+segments*(grid+16*ulp(max_total))+Fraction(2,10**10)
    residual=abs(elapsed-clock)
    check(residual<=total_bound, 'lastTickAt/totalTime exceeds source-derived accumulated rounding bound')
    fleets=[]
    for b,a in zip(bs['fleets'],ads['fleets']):
        maximum=max(b['duration'],a['duration'],b['elapsed']+120,a['elapsed']+120,120)
        bound=shared+(segments+2)*8*ulp(maximum)
        advanced=Fraction(a['elapsed'])-Fraction(b['elapsed'])
        consumed=Fraction(b['remaining'])-Fraction(a['remaining'])
        check(advanced>=0 and consumed>=0 and abs(advanced-clock)<=bound and abs(consumed-clock)<=bound,
              'Fleet elapsed/remaining advanced at a different accounting speed')
        fleets.append({'id':a['id'],'elapsedResidualSeconds':float(abs(advanced-clock)),
                       'remainingResidualSeconds':float(abs(consumed-clock)),'errorBoundSeconds':float(bound)})
    return {'accountedSeconds':float(clock),'totalTimeSeconds':float(elapsed),'totalTimeResidualSeconds':float(residual),
            'totalTimeErrorBoundSeconds':float(total_bound),'guardedSegmentsUpper':segments,
            'callbackCount':callbacks,'fleets':fleets}


def run(evidence, fixtures, source_root, build_dir):
    from urllib.parse import urljoin, urlparse
    root=Path(evidence).resolve(); source_files=verify_source(source_root)
    release, build_files=verify_build(build_dir)
    fixture_report, variants=validate_fixture(fixtures,source_files)
    report=decode(original(root/'report.json'))
    check(report['schema']=='energy-active-performance-native-v1' and report['completed'] is True and report['qualified'] is True and report['errors']==[], 'Native run incomplete or failed; preserve every planned sample')
    check(report['parameters']=={'warmupMs':600,'sampleMs':2000,'wholeTimeoutSeconds':480,'phaseTimeoutSeconds':90,'runHorizonSeconds':120,
          'repetitions':3,'tabs':list(PANELS),'navigationInputsPerRun':6}, 'Frozen native diagnostic parameters changed')
    supervisor=report['supervisor']
    check(supervisor['invocationId']==report['invocationId'] and supervisor['wholeTimeoutSeconds']==480 and supervisor['phaseTimeoutSeconds']==90
          and supervisor['runHorizonSeconds']==120 and supervisor['timeoutReason'] is None and supervisor['workerExitCode']==0
          and 0<supervisor['elapsedSeconds']<480, 'Native watchdog expired or has wrong budget/identity')
    check(supervisor['cleanup']['remainingLiveOwnedPids']==[] and supervisor['cleanup']['noObservedLiveOwnedDescendants'] is True, 'Owned native worker cleanup incomplete')
    check(report['build']['sourceSha']==SOURCE_SHA and report['build']['sourceTree']==SOURCE_TREE and same(report['build']['release'],release), 'Native served build identity mismatch')
    check(reference(root,report['build']['releaseRaw'])==original(Path(build_dir)/'release.json'), 'Native release original bytes mismatch')
    check({r['path']:r['sha256'] for r in report['build']['files']}==build_files and len(report['build']['files'])==63, 'Native build inventory incomplete')
    runner_path=ROOT/'scripts/browser-energy-active-performance.py'
    check(reference(root,report['harness']['runner'])==original(runner_path), 'Executed harness differs from reviewed source')
    probe=source_literal(runner_path,'PROBE'); check(reference(root,report['harness']['observer'])==probe.encode(), 'Executed observer template differs')
    check(reference(root,report['fixtures']['manifest'])==original(Path(fixtures)/'report.json'), 'Native fixture manifest changed')
    check([p['id'] for p in report['fixtures']['profiles']]==list(PROFILES), 'Native fixture profile census mismatch')
    fixture_raw={}
    for p in report['fixtures']['profiles']:
        for side in ('active','control'):
            raw=reference(root,p['variants'][side]['raw']); expected=next(x for x in fixture_report['profiles'] if x['id']==p['id'])['variants'][side]
            check(raw==reference(fixtures,expected) and same(p['variants'][side]['metadata'],expected), 'Native uses wrong fixture bytes')
            fixture_raw[(p['id'],side)]=raw
    check(len(report['httpBuild'])==63 and len({r['file'] for r in report['httpBuild']})==63, 'Incomplete/duplicate original HTTP asset census')
    for row in report['httpBuild']:
        check(row['file'] in build_files and row['status']==200 and sha(reference(root,row['body']))==build_files[row['file']], 'HTTP build response differs from exact release')
    chrome=report['chrome']; executable=chrome['actualExecutable']; binary=Path(executable['path'])
    check(binary.is_file() and binary.stat().st_size==executable['bytes'], 'Recorded browser runtime unavailable/changed')
    digest=hashlib.sha256()
    with binary.open('rb') as handle:
        check(handle.read(4)==b'\x7fELF', 'Browser runtime record is not actual ELF engine')
        handle.seek(0)
        for chunk in iter(lambda:handle.read(1024*1024),b''): digest.update(chunk)
    check(digest.hexdigest()==executable['sha256'], 'Actual Chromium runtime bytes changed')
    check(executable['cdpProcess']['type']=='browser' and executable['cdpProcess']['id']==executable['processIdentity']['pid'], 'Browser PID/runtime witness mismatch')
    launcher=Path(chrome['launcherPath']); check(launcher.stat().st_size==chrome['launcherBytes'], 'Chrome launcher changed')
    digest=hashlib.sha256()
    with launcher.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''): digest.update(chunk)
    check(digest.hexdigest()==chrome['launcherSha256'] and chrome['browserVersion'] in chrome['commandVersion']
          and chrome['browserVersion'] in chrome['cdpVersion']['product'], 'Chrome launcher/CDP version identity mismatch')
    schedule=expected_schedule(); check(len(report['runs'])==12, 'Missing/extra native run')
    rows=[]; required={}; document_ids=set(); raw_metric_files=set(); raw_witness_files=set(); expected_samples=[]
    for actual,expected in zip(report['runs'],schedule):
        profile,side,rep=expected['profile'],expected['variant'],expected['repetition']-1
        run_id=f'{profile}-{rep}-{side}'
        check(actual['id']==run_id and actual['profile']==profile and actual['variant']==side and actual['repetition']==rep
              and actual['pairOrder']==(['active','control'] if rep%2==0 else ['control','active']), 'Native AB/BA order/pair identity mismatch')
        check(actual['started'] is True and actual['completed'] is True and actual['qualified'] is True
              and actual['errors']==actual['pageErrors']==actual['failedRequests']==[] and 0<actual['elapsedHostSeconds']<120, 'Failed/missing native run retained but cannot qualify')
        url=actual['url']; parsed=urlparse(url)
        check(parsed.scheme in ('http','https') and url.endswith('/') and not parsed.query and not parsed.fragment, 'Invalid served application URL')
        for asset in report['httpBuild']: check(asset['url']==urljoin(url,asset['file']), 'HTTP artifact from wrong application origin')
        installed=probe.replace('__ORIGIN__',json.dumps(f'{parsed.scheme}://{parsed.netloc}')).replace('__KEY__',json.dumps(KEY)).replace('__FIXTURE__',json.dumps(fixture_raw[(profile,side)].decode()))
        check(reference(root,actual['installedObserver'])==installed.encode(), 'Observer source/seed modified for native run')
        check(sha(reference(root,actual['nativeDocument']))==release['files']['index.html'], 'Native document differs from released HTML')
        check(len(actual['nativeScripts'])==1 and actual['debuggerDisabledBeforeWindows'] is True, 'Missing native V8 identity or Debugger exclusion')
        script=actual['nativeScripts'][0]
        check(script['file']==JS_PATH and script['url']==urljoin(url,JS_PATH) and script['status']==200
              and script['scriptParsed']['url']==script['url'], 'Unexpected executed native source')
        check(reference(root,script['http'])==reference(root,script['v8']) and script['http']['sha256']==JS_SHA, 'Executed V8 differs from HTTP/release bytes')
        observations=decode(reference(root,actual['observations'])); events=verify_observations(observations)
        check(observations['documentId'] not in document_ids, 'Reused document across planned native runs'); document_ids.add(observations['documentId'])
        initialization=decode(reference(root,actual['initialization']))
        check(initialization['documentId']==observations['documentId'] and initialization['seedError'] is None
              and initialization['reloaded'] is False and initialization['beforeSeed']['currentRaw'] is None
              and initialization['beforeSeed']['backups']==[], 'Context not freshly empty before seed')
        seeded=reference(root,actual['seededRaw']); required[actual['seededRaw']['file']]=actual['seededRaw']
        source=envelope(fixture_raw[(profile,side)]); expected_seed=deepcopy(source)
        expected_seed['savedAt']=expected_seed['lastTickAt']=integer(initialization['seededAt'])
        check(same(envelope(seeded),expected_seed), 'Native seed patched fields beyond envelope timestamps')
        check(initialization['seededRaw'].encode()==seeded and initialization['afterSeed']['currentRaw'].encode()==seeded
              and initialization['currentStorage']['currentRaw'].encode()==seeded and initialization['afterSeed']['backups']==[]
              and initialization['observation']['status']=='已读取本地存档', 'Native seed readback/startup adoption mismatch')
        light_marker(initialization['observation'],observations,'save')
        check(0<=initialization['observation']['now']-initialization['startedAt']<5000
              and 0<=initialization['observation']['wallNow']-initialization['seededAt']<5000, 'Startup exceeds live-frame horizon')
        check(len(actual['windows'])==3 and len(observations['witnesses'])==6, 'Incomplete native window/Save census')
        previous=source['state']; seeded_envelope=envelope(seeded)
        for index,(window,panel) in enumerate(zip(actual['windows'],PANELS)):
            ident=f'{run_id}-{panel}'
            check(window['id']==ident and window['index']==index and window['tab']==panel and window['started'] is True and window['completed'] is True and window['metricBlockCompleted'] is True, 'Missing/duplicate native window')
            for field,seen in (('metricsBefore',raw_metric_files),('metricsAfter',raw_metric_files),('preSave',raw_witness_files),('postSave',raw_witness_files)):
                check(window[field]['file'] not in seen, 'Reused raw metric/Save evidence'); seen.add(window[field]['file'])
            before_metrics=decode(reference(root,window['metricsBefore'])); after_metrics=decode(reference(root,window['metricsAfter']))
            metrics=metric_delta(before_metrics,after_metrics)
            check(window['metricElapsedMs']==metrics['elapsedMs'] and same(window['cpuMs'],metrics['durationMs']), 'Producer CPU delta differs from raw counters')
            pre,pre_envelope=save_witness(root,window['preSave'],observations,required,ident+'-pre')
            post,post_envelope=save_witness(root,window['postSave'],observations,required,ident+'-post')
            before_marker,after_marker=window['beforeMarker'],window['afterMarker']
            for marker in (before_marker,after_marker): light_marker(marker,observations,panel)
            check(pre['after']['now']<before_marker['now']<after_marker['now']<post['after']['now'], 'Saved state claimed simultaneous with CPU boundaries')
            check(before_marker['eventCount']==after_marker['eventCount'], 'Trusted input inside CPU interval')
            gap=window['boundaryGaps']
            check(gap['preSaveToBeforeMarkerMs']==before_marker['now']-pre['after']['now']
                  and gap['afterMarkerToPostSaveMs']==post['after']['now']-after_marker['now']
                  and gap['saveWitnessSpanMs']==post['after']['now']-pre['after']['now'], 'False manual-Save/CPU boundary gaps')
            check(after_marker['now']-before_marker['now']>=metrics['elapsedMs'], 'CDP interval outside native observer markers')
            host=window['hostWindow']; host_values=[host[k] for k in ('beforeStartCounter','afterStartCounter','beforeEndCounter','afterEndCounter')]
            check(all(finite(x) for x in host_values) and host_values==sorted(host_values) and host['elapsedMs']==(host_values[3]-host_values[0])*1000
                  and host['elapsedMs']>=metrics['elapsedMs'], 'CDP CPU boundary/host chronology mismatch')
            warmup=window['warmup']; check(warmup['requestedMs']==600 and warmup['after']['now']-warmup['before']['now']>=590, 'Missing native warmup')
            for nav,target in ((window['navigationTo'],panel),(window['navigationBack'],'save')):
                check(nav['target']==target and nav['after']['tab']==target and nav['before']['now']<=nav['after']['now'] and nav['hostActionEndToEndMs']>0, 'Invalid native navigation witness')
                clicks=[e for e in events if e['type']=='click' and e['stage']=='capture' and nav['before']['now']<=e['at']<=nav['after']['now']]
                check(len(clicks)==1 and clicks[0]['target']['tab']==target, 'Navigation not linked to one actual trusted click')
            a,b=pre_envelope['state'],post_envelope['state']
            idle_pair(previous,a,profile,side); idle_pair(a,b,profile,side); previous=b
            frame_rows=[r for r in observations['raf'] if pre['after']['now']<r['at']<=post['after']['now']]
            check(len(frame_rows)>=2 and pre['after']['rafCount']+len(frame_rows)==post['after']['rafCount'], 'Incomplete actual Save-to-Save callback census')
            time_audit=chronology(pre_envelope,post_envelope,len(frame_rows),source['state'])
            chronology(seeded_envelope,pre_envelope,pre['after']['rafCount'],source['state'])
            chronology(seeded_envelope,post_envelope,post['after']['rafCount'],source['state'])
            bound=retained_score_bound(a,b,len(frame_rows)) if side=='active' else None
            if side=='control': check(a['energyChallenge']['active'] is b['energyChallenge']['active'] is None, 'Inactive control manufactured challenge progress')
            result={'runId':run_id,**expected,'panel':panel,'metrics':metrics,'walletScoreAudit':bound,'chronologyAudit':time_audit,
                    'saveBoundaryGapsMs':{k:gap[k] for k in ('preSaveToBeforeMarkerMs','afterMarkerToPostSaveMs','saveWitnessSpanMs')},
                    'rafCallbackCount':len(frame_rows)}
            rows.append(result)
            expected_samples.append({'run':run_id,'variant':side,'tab':panel,'completed':True,'cpuMs':metrics['durationMs'],'metricElapsedMs':metrics['elapsedMs']})
        _,final=collect_storage(root,actual['finalStorage'],required)
        check(observations['currentStorage']['currentRaw'].encode()==reference(root,actual['finalStorage']['current']), 'Final current raw detached from native observations')
        idle_pair(previous,final['state'],profile,side)
        chronology(seeded_envelope,final,len(observations['raf']),source['state'])
    check(same(report['allSamples'],expected_samples), 'Producer omitted/reordered/changed a planned raw sample')
    check(len(raw_metric_files)==72 and len(raw_witness_files)==72 and len(document_ids)==12, 'Incomplete independently counted native originals')
    reader_count=strict_readers(root,required,fixture_report)
    phases=[decode(line) for line in original(root/'phase-history.jsonl').splitlines()]
    check(phases and all(p['invocationId']==report['invocationId'] for p in phases), 'Phase history from different invocation')
    check(all(a['monotonic']<=b['monotonic'] for a,b in zip(phases,phases[1:])), 'Native phase chronology reversed')
    for actual in report['runs']:
        own=[p for p in phases if p['identity'].get('run')==actual['id']]
        disabled=[i for i,p in enumerate(own) if p['phase']=='identity.debugger-disable' and p['state']=='after']
        measuring=[i for i,p in enumerate(own) if p['phase']=='window.native-measure']
        check(len(disabled)==1 and len(measuring)==6 and disabled[0]<min(measuring), 'Debugger active or missing CPU phase census')
        for index,window in enumerate(actual['windows']):
            paired=[p for p in own if p['phase']=='window.native-measure' and p['identity'].get('window')==window['id']]
            check([p['state'] for p in paired]==['before','after'], 'Missing/duplicate native CPU phase')
    return {'schema':'energy-active-performance-independent-check-v1','status':'passed','sourceSha':SOURCE_SHA,
            'sourceTree':SOURCE_TREE,'releaseSha256':RELEASE_SHA,'sourceFilesChecked':len(source_files),'releaseAssetsChecked':62,
            'runs':12,'windows':36,'strictReaderOriginals':reader_count,'samples':rows,'summary':summarize(rows),
            'limits':['Diagnostic covers one world/no fleets and wallet-assisted four worlds/eight real transports only.',
                      'The 100-world/1,000-fleet active-challenge gap remains open.',
                      'CPU counters include whole application and common observer overhead; no performance threshold asserted.',
                      'Save snapshots are outside CDP intervals; no simultaneous endpoint or exact cross-frame simulation claim.',
                      'Score audit uses exact decimal retained-wallet gain and a conservative per-contribution 1e-12-point floor bound.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',required=True,type=Path); parser.add_argument('--fixtures',required=True,type=Path)
    parser.add_argument('--source-root',required=True,type=Path); parser.add_argument('--build-dir',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    try: result=run(args.evidence,args.fixtures,args.source_root,args.build_dir)
    except Exception as error:
        result={'schema':'energy-active-performance-independent-check-v1','status':'failed','error':type(error).__name__+': '+str(error),
                'rawEvidencePreserved':True}
        with args.out.open('x') as handle: json.dump(result,handle,ensure_ascii=False,indent=2); handle.write('\n')
        print(json.dumps(result)); return 1
    with args.out.open('x') as handle: json.dump(result,handle,ensure_ascii=False,indent=2); handle.write('\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ('samples','summary')})); return 0


if __name__=='__main__': raise SystemExit(main())
