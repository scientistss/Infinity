"""CI-only native NPC pressure experiment with optional exact two-source comparison.

Three alternating pairs, each measured at Overview before a Fleet visit, Fleet,
and Overview after the real visit. Native clocks/RAF/storage/timers; no profiler,
clock patch, state global, synthetic visibility, request interception or CPU trace.
Python preflight is allowed anywhere; browser execution requires GitHub Actions.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import statistics
import subprocess
import sys
import time
import traceback
from urllib.parse import urljoin, urlparse

REPORT = 'npc-pressure-browser-report.json'
SAMPLE_MS, REPETITIONS, WHOLE_SECONDS, ACTION_MS = 5000, 3, 230, 10000
STAGES = ('overview-before-fleet', 'fleet-visible', 'overview-after-fleet')
PRESSURE_FIELDS = {'npcEconomy', 'npcBattles', 'fleets', 'nextFleetId', 'messages'}
COMPARE_SECONDS = 300
OLD_SOURCE_SHA = 'd97d37c9b664a450e83bd152c84848cf1e617d6a'
NEW_SOURCE_SHA = '8f2ea441a42f36ded7eeb60f03c3c2b0fbed073b'
SOURCE_TREES = {OLD_SOURCE_SHA: '900f78b5866d4cb9cc6e5c3026e415558ea07e3b',
                NEW_SOURCE_SHA: 'b982437c729910e705ef2e44b202ef03dc2034df'}
CPU_KEYS = ('ScriptDuration', 'TaskDuration')
ACTION_SELECTORS = ('[data-tab="fleet"]', '[data-tab="overview"]', '[data-tab="save"]',
                    '[data-action="save"]', '[data-action="import-text"]')
COMPARE_ARGUMENTS = ('compare_expected_sha', 'compare_source_root', 'compare_url', 'compare_fixture', 'compare_expected_fixture_sha256')
COUNTS = {'siteCount': 512, 'unfinishedAttackCount': 64, 'terminalReportCount': 60, 'pinnedReportCount': 0}


def sha(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def state_counts(state):
    attacks = [row for row in state['fleets'] if row['mission'] == 'attack']
    reports = state['npcBattles']['reports']
    return {'siteCount': len(state['npcEconomy']['sites']), 'unfinishedAttackCount': len(attacks),
            'terminalReportCount': sum(row['delivery'] != 'returning' for row in reports),
            'pinnedReportCount': sum(row['delivery'] == 'returning' for row in reports),
            'outboundAttackCount': sum(row['npcAttack']['phase']['kind'] == 'outbound' for row in attacks),
            'fleetCount': len(state['fleets'])}


def stable_identity(state):
    """Identity only: legitimate production, clocks, remaining time and autosaves run."""
    return {'sites': sorted(state['npcEconomy']['sites']), 'nextFleetId': state['nextFleetId'],
            'attacks': [{'id': row['id'], 'originId': row['originId'], 'target': row['target'],
                         'seed': row['npcAttack']['seed'], 'phase': row['npcAttack']['phase']}
                        for row in state['fleets'] if row['mission'] == 'attack'],
            'reports': [{'fleetId': row['fleetId'], 'seed': row['seed'], 'target': row['target'],
                         'delivery': row['delivery'], 'at': row['at']} for row in state['npcBattles']['reports']]}


def load_fixture(path, expected_sha, expected_fixture_sha, whole_seconds=WHOLE_SECONDS):
    data = Path(path).read_bytes()
    require(sha(data) == expected_fixture_sha, 'Complete fixture SHA-256 differs from independent CLI pin')
    fixture = json.loads(data)
    require(fixture['schemaVersion'] == 1 and fixture['synthetic'] is True, 'Expected explicitly synthetic schemaVersion 1 fixture')
    require(fixture['sourceSha'] == expected_sha, 'Fixture source commit differs from expected production commit')
    require(fixture['key'] == 'infinity.original-p4.save.v1', 'Unexpected save key')
    require(all(fixture['expected'][key] == value for key, value in COUNTS.items()), 'Fixture pressure requirement changed')
    envelopes = {}
    for variant in ('control', 'pressure'):
        raw = fixture[variant]
        require(sha(raw) == fixture['hashes'][variant + 'Save'], variant + ' complete save bytes changed')
        envelope = json.loads(raw)
        require(envelope['version'] == 9 and envelope['revision'] == 13, 'Current v9/r13 envelope required')
        require(envelope['state'] == fixture[variant + 'Raw'], variant + ' raw/envelope state mismatch')
        require(not (envelope['state']['arcade'].get('autoBatch') or {}).get('armed'), 'Auto reveal must not run during CPU samples')
        actual = state_counts(envelope['state'])
        expected = COUNTS if variant == 'pressure' else {key: 0 for key in COUNTS}
        require(all(actual[key] == value for key, value in expected.items()), variant + ' exact pressure counts mismatch')
        require(actual['outboundAttackCount'] == actual['unfinishedAttackCount'] == actual['fleetCount'], 'Only outbound attacks may populate pressure fleets')
        envelopes[variant] = envelope
    require({key: value for key, value in envelopes['control']['state'].items() if key not in PRESSURE_FIELDS} ==
            {key: value for key, value in envelopes['pressure']['state'].items() if key not in PRESSURE_FIELDS},
            'Ordinary same-engine control fields must be identical')
    minimum = min(row['remaining'] for row in envelopes['pressure']['state']['fleets'])
    require(minimum >= whole_seconds + 10 and minimum == fixture['minimumRemainingSeconds'], 'Attack lifetime cannot cover the bounded native experiment')
    return fixture, envelopes


def envelope_spans(raw):
    """Locate top-level values so fresh watermarks preserve every other byte."""
    decoder, spans, offset = json.JSONDecoder(), {}, 0
    def whitespace(at):
        while at < len(raw) and raw[at].isspace():
            at += 1
        return at
    offset = whitespace(offset)
    require(raw[offset] == '{', 'Expected object envelope')
    offset = whitespace(offset + 1)
    while raw[offset] != '}':
        key, offset = decoder.raw_decode(raw, offset)
        require(isinstance(key, str) and key not in spans, 'Duplicate or invalid envelope key')
        offset = whitespace(offset)
        require(raw[offset] == ':', 'Invalid envelope separator')
        begin = whitespace(offset + 1)
        _, offset = decoder.raw_decode(raw, begin)
        spans[key] = (begin, offset)
        offset = whitespace(offset)
        if raw[offset] == '}':
            break
        require(raw[offset] == ',', 'Invalid envelope delimiter')
        offset = whitespace(offset + 1)
    require(not raw[offset + 1:].strip(), 'Trailing envelope data')
    return spans


def seed_now(raw, wall_ms):
    require(type(wall_ms) is int and wall_ms > 0, 'Fresh wall time must be positive integer milliseconds')
    spans, original = envelope_spans(raw), json.loads(raw)
    result = raw
    for start, end in sorted((spans[key] for key in ('savedAt', 'lastTickAt')), reverse=True):
        result = result[:start] + str(wall_ms) + result[end:]
    expected = {**original, 'savedAt': wall_ms, 'lastTickAt': wall_ms}
    require(json.loads(result) == expected, 'Only savedAt/lastTickAt may change')
    after = envelope_spans(result)
    require(raw[slice(*spans['state'])] == result[slice(*after['state'])], 'Game-state bytes must remain exact')
    return result


def source_identity(source_root, expected_sha, fixture):
    root = Path(source_root).resolve()
    def git(*arguments):
        return subprocess.check_output(['git', '-C', str(root), *arguments], text=True, timeout=10).strip()
    head, tree = git('rev-parse', 'HEAD'), git('rev-parse', 'HEAD:src')
    status = git('status', '--porcelain', '--untracked-files=all', '--', '.', ':(exclude)scripts/npc-pressure-fixture.ts')
    require(head == expected_sha and tree == fixture['sourceTreeSha'], 'Source worktree commit/tree mismatch')
    require(not status, 'Production source worktree must be clean')
    return {'root': str(root), 'gitHead': head, 'srcTreeSha': tree, 'productionStatusPorcelain': status}


def metric_delta(before, after):
    return {key: (after[key] - before[key]) * (1000 if key.endswith('Duration') else 1)
            for key in ('ScriptDuration', 'TaskDuration', 'LayoutDuration', 'RecalcStyleDuration')}


def summary(values):
    require(all(math.isfinite(value) for value in values), 'Nonfinite measured value')
    ordered = sorted(values)
    return {'n': len(values), 'median': statistics.median(values) if values else None,
            'min': ordered[0] if values else None, 'max': ordered[-1] if values else None,
            'p95NearestRank': ordered[max(0, math.ceil(.95 * len(ordered)) - 1)] if values else None}


def run_schedule(comparing=False):
    result = []
    for repetition in range(REPETITIONS):
        order = (('old', 'control'), ('new', 'control'), ('new', 'pressure'), ('old', 'pressure')) if repetition % 2 == 0 else (
            ('new', 'pressure'), ('old', 'pressure'), ('old', 'control'), ('new', 'control'))
        if not comparing:
            order = tuple(('single', variant) for variant in (('control', 'pressure') if repetition % 2 == 0 else ('pressure', 'control')))
        for position, (source, variant) in enumerate(order):
            result.append({'source': source, 'variant': variant, 'repetition': repetition, 'position': position,
                           'order': [f'{name}-{kind}' if comparing else kind for name, kind in order]})
    return result


def compare_enabled(args):
    present = [getattr(args, name, None) is not None for name in COMPARE_ARGUMENTS]
    require(not any(present) or all(present), 'All five compare SHA/root/URL/fixture/hash parameters are required together')
    return all(present)


def comparison_source_identity(old, new):
    require(old['sha'] == OLD_SOURCE_SHA and new['sha'] == NEW_SOURCE_SHA, 'Comparison requires the exact designated old/new source commits')
    require(Path(old['root']).resolve() != Path(new['root']).resolve(), 'Comparison requires two independent source worktrees')
    require(old['url'] != new['url'], 'Comparison requires two distinct preview URLs')
    for source in (old, new):
        require(source['fixture']['sourceTreeSha'] == SOURCE_TREES[source['sha']], 'Comparison source tree is not the exact designated tree')
    paths = subprocess.check_output(['git', '-C', old['root'], 'diff', '--no-renames', '--name-only', OLD_SOURCE_SHA, NEW_SOURCE_SHA], text=True, timeout=10).splitlines()
    require('src/ui/npc-attack-controls.ts' in paths and set(paths) <= {'src/ui/npc-attack-controls.ts', 'tests/npc-attack-ui.test.ts'},
            'Only the exact observer production path and its test may differ between sources')
    return {'allChangedPaths': paths, 'productionChangedPaths': ['src/ui/npc-attack-controls.ts'],
            'unchangedScope': 'Every other tracked path, including public, index, package/lock, configuration and build scripts.'}


def compare_fixture_bytes(old, new):
    evidence = {}
    for variant, basename in (('control', 'control0'), ('pressure', 'max512')):
        row = {}
        for suffix, field in (('save.txt', variant + 'Save'), ('raw.json', variant + 'Raw')):
            left = (Path(old['path']).parent / f'{basename}.{suffix}').read_bytes()
            right = (Path(new['path']).parent / f'{basename}.{suffix}').read_bytes()
            require(left == right, f'{variant} complete {suffix} bytes differ across sources')
            for source, data in ((old, left), (new, right)):
                require(sha(data) == source['fixture']['hashes'][field], f'{variant} {suffix} artifact hash mismatch')
                if suffix == 'save.txt':
                    require(data == source['fixture'][variant].encode('utf-8'), f'{variant} envelope file differs from fixture original bytes')
                else:
                    require(json.loads(data) == source['fixture'][variant + 'Raw'], f'{variant} raw file differs from fixture raw state')
            row[suffix] = {'sha256': sha(left), 'bytes': len(left), 'equal': True}
        before, after = (source['fixture'][variant] for source in (old, new))
        a, b = envelope_spans(before), envelope_spans(after)
        left, right = before[slice(*a['state'])], after[slice(*b['state'])]
        require(left == right, f'{variant} original state text differs across sources')
        row['stateTextSha256'] = sha(left)
        evidence[variant] = row
    # No non-source fixture metadata, setup, operation, or generator-byte drift.
    allowed = {'sourceSha', 'sourceTreeSha', 'generatorSourceSha', 'generatorSourceTreeSha'}
    require({key: value for key, value in old['fixture'].items() if key not in allowed} ==
            {key: value for key, value in new['fixture'].items() if key not in allowed},
            'Cross-source fixture metadata differs outside source SHA/tree identity')
    require(old['fixture']['hashes']['fixtureSource'] == new['fixture']['hashes']['fixtureSource'], 'Generator bytes differ across sources')
    return evidence


def prepare_sources(args):
    comparing = compare_enabled(args)
    budget = COMPARE_SECONDS if comparing else WHOLE_SECONDS
    sources = {}
    for name, prefix in ((('old', ''), ('new', 'compare_')) if comparing else (('single', ''),)):
        source = {'sha': getattr(args, prefix + 'expected_sha'), 'root': getattr(args, prefix + 'source_root'),
                  'url': getattr(args, prefix + 'url'), 'path': getattr(args, prefix + 'fixture'),
                  'fixtureSha256': getattr(args, prefix + 'expected_fixture_sha256')}
        require(bool(re.fullmatch('[0-9a-f]{40}', source['sha'])), 'Exact 40-character source commit required')
        require(bool(re.fullmatch('[0-9a-f]{64}', source['fixtureSha256'])), 'Exact complete fixture SHA-256 required')
        require(urlparse(source['url']).scheme in ('http', 'https') and source['url'].endswith('/'), 'Actual HTTP(S) production base URL with trailing slash required')
        source['fixture'], source['envelopes'] = load_fixture(source['path'], source['sha'], source['fixtureSha256'], budget)
        source['identity'] = source_identity(source['root'], source['sha'], source['fixture'])
        if comparing:
            actual_generator = Path(source['root'], 'scripts/npc-pressure-fixture.ts').read_bytes()
            require(sha(actual_generator) == source['fixture']['hashes']['fixtureSource'] == sha(Path(__file__).with_name('npc-pressure-fixture.ts').read_bytes()),
                    'Actual per-source imported generator bytes differ from measurement generator')
        sources[name] = source
    comparison = {'enabled': comparing}
    if comparing:
        comparison.update(sourceDiff=comparison_source_identity(sources['old'], sources['new']),
                          identicalInputs=compare_fixture_bytes(sources['old'], sources['new']))
    return sources, comparison


def paired_summary(runs):
    result = []
    for source in dict.fromkeys(run.get('source', 'single') for run in runs):
        for stage in STAGES:
            rows = []
            for repetition in range(REPETITIONS):
                candidates = [run for run in runs if run.get('source', 'single') == source and run['repetition'] == repetition
                              and any(sample['stage'] == stage for sample in run['samples'])]
                require(len({run['variant'] for run in candidates}) == len(candidates), 'Duplicate source/repetition/variant run')
                pair = {run['variant']: next(sample for sample in run['samples'] if sample['stage'] == stage) for run in candidates}
                if len(pair) != 2:
                    continue
                rows.append({'repetition': repetition, 'pressureMinusControlMs':
                             {key: pair['pressure']['cpuMs'][key] - pair['control']['cpuMs'][key] for key in CPU_KEYS},
                             'comparison': 'same-stage, same-production, pressure minus control'})
            result.append({'source': source, 'stage': stage, 'pairedRawDifferences': rows,
                           'pairedDifferenceSummaryMs': {key: summary([row['pressureMinusControlMs'][key] for row in rows]) for key in CPU_KEYS}})
    return result


def validate_comparison_runs(runs):
    expected = [(row['source'], row['repetition'], row['variant']) for row in run_schedule(True)]
    actual = [(run['source'], run['repetition'], run['variant']) for run in runs]
    require(len(actual) == len(set(actual)), 'Duplicate source/repetition/variant run')
    require(actual == expected, 'Comparison requires all exact 12 independent runs in the fixed order')
    require(len({run['id'] for run in runs}) == 12, 'Comparison run IDs must be unique')
    require([run['context']['ordinal'] for run in runs] == list(range(1, 13)) and
            all(run['context']['independent'] and run['context']['closed'] for run in runs),
            'Exactly twelve independent completed contexts required')
    for run in runs:
        require(run['completed'] is True, 'Every comparison run must complete')
        require([sample['stage'] for sample in run['samples']] == list(STAGES), 'All three native sample stages must complete exactly once')
        require([action['selector'] for action in run['actions']] == list(ACTION_SELECTORS), 'All five native actions must complete in selector order')
        require(not run.get('pageErrors') and not run.get('failedRequests'), 'Failed native run cannot qualify comparison')
        for sample in run['samples']:
            require(all(finite_nonnegative(sample['cpuMs'][key]) for key in CPU_KEYS), 'Invalid native comparison CPU metric')
    return {'uniqueRuns': len(runs), 'windows': sum(len(run['samples']) for run in runs),
            'actions': sum(len(run['actions']) for run in runs), 'completeCrossSourcePairs': 6}


def raw_summary(values):
    return {'raw': values, **{key: value for key, value in summary(values).items() if key != 'p95NearestRank'}}


def comparative_summary(runs):
    validate_comparison_runs(runs)
    indexed = {(run['source'], run['repetition'], run['variant']): run for run in runs}
    result = {'stages': [], 'hiddenAfterMinusBefore': [], 'actions': [],
              'interpretation': 'Three paired repetitions, raw milliseconds and descriptive median/min/max only. No statistical significance, speedup, FPS or completed-paint claim.'}
    for stage in STAGES:
        rows = []
        for repetition in range(REPETITIONS):
            cells = {source: {variant: next(sample['cpuMs'] for sample in indexed[source, repetition, variant]['samples'] if sample['stage'] == stage)
                              for variant in ('control', 'pressure')} for source in ('old', 'new')}
            rows.append({'repetition': repetition, 'fourCellsCpuMs': cells,
                         'newMinusOldMs': {variant: {key: cells['new'][variant][key] - cells['old'][variant][key] for key in CPU_KEYS} for variant in ('control', 'pressure')},
                         'pressureMinusControlMs': {source: {key: cells[source]['pressure'][key] - cells[source]['control'][key] for key in CPU_KEYS} for source in ('old', 'new')},
                         'differenceInDifferencesMs': {key: (cells['new']['pressure'][key] - cells['new']['control'][key]) - (cells['old']['pressure'][key] - cells['old']['control'][key]) for key in CPU_KEYS}})
        result['stages'].append({'stage': stage, 'pairedRaw': rows,
            'fourCellsSummaryMs': {source: {variant: {key: raw_summary([row['fourCellsCpuMs'][source][variant][key] for row in rows]) for key in CPU_KEYS} for variant in ('control', 'pressure')} for source in ('old', 'new')},
            'newMinusOldSummaryMs': {variant: {key: raw_summary([row['newMinusOldMs'][variant][key] for row in rows]) for key in CPU_KEYS} for variant in ('control', 'pressure')},
            'pressureMinusControlSummaryMs': {source: {key: raw_summary([row['pressureMinusControlMs'][source][key] for row in rows]) for key in CPU_KEYS} for source in ('old', 'new')},
            'differenceInDifferencesSummaryMs': {key: raw_summary([row['differenceInDifferencesMs'][key] for row in rows]) for key in CPU_KEYS}})
    for variant in ('control', 'pressure'):
        rows = []
        for repetition in range(REPETITIONS):
            values = {source: {key: indexed[source, repetition, variant]['samples'][2]['cpuMs'][key] - indexed[source, repetition, variant]['samples'][0]['cpuMs'][key] for key in CPU_KEYS} for source in ('old', 'new')}
            rows.append({'repetition': repetition, 'sourceDeltasMs': values, 'newMinusOldChangeMs': {key: values['new'][key] - values['old'][key] for key in CPU_KEYS}})
        result['hiddenAfterMinusBefore'].append({'variant': variant, 'pairedRaw': rows,
            'sourceSummaryMs': {source: {key: raw_summary([row['sourceDeltasMs'][source][key] for row in rows]) for key in CPU_KEYS} for source in ('old', 'new')},
            'newMinusOldChangeSummaryMs': {key: raw_summary([row['newMinusOldChangeMs'][key] for row in rows]) for key in CPU_KEYS}})
    timings = ('eventToCaptureStartMs', 'captureToDocumentBubbleMs', 'eventToPostDispatchTaskMs', 'eventToFirstRafCallbackMs',
               'eventToSecondRafCallbackMs', 'rafFrameTimestampIntervalMs', 'hostToRequiredWitnessObservationMs')
    for index, selector in enumerate(ACTION_SELECTORS):
        for variant in ('control', 'pressure'):
            rows = []
            for repetition in range(REPETITIONS):
                cells = {source: {key: indexed[source, repetition, variant]['actions'][index].get(key) for key in timings} for source in ('old', 'new')}
                rows.append({'repetition': repetition, 'sourceTimingMs': cells,
                    'newMinusOldMs': {key: None if cells['new'][key] is None or cells['old'][key] is None else cells['new'][key] - cells['old'][key] for key in timings}})
            result['actions'].append({'selector': selector, 'variant': variant, 'pairedRaw': rows,
                'sourceSummaryMs': {source: {key: raw_summary([row['sourceTimingMs'][source][key] for row in rows]) if all(row['sourceTimingMs'][source][key] is not None for row in rows) else None for key in timings} for source in ('old', 'new')},
                'newMinusOldSummaryMs': {key: raw_summary([row['newMinusOldMs'][key] for row in rows]) if all(row['newMinusOldMs'][key] is not None for row in rows) else None for key in timings}})
    return result


def finalize_comparison(report, supervisor_ok):
    if not report.get('comparison', {}).get('enabled'):
        return
    report['comparativeCompleted'] = False
    report['availableCompleteComparisonPairs'] = 0
    report.pop('comparativeSummary', None)
    report.pop('comparisonCounts', None)
    if not supervisor_ok or not report.get('completed') or report.get('errors'):
        report['pairedSummary'] = []
        return
    try:
        counts = validate_comparison_runs(report['runs'])
        comparative = comparative_summary(report['runs'])
        paired = paired_summary(report['runs'])
        report.update(comparisonCounts=counts, comparativeSummary=comparative, pairedSummary=paired,
                      comparativeCompleted=True, availableCompleteComparisonPairs=counts['completeCrossSourcePairs'])
    except (AssertionError, KeyError, TypeError, ValueError) as error:
        report['completed'] = False
        report.setdefault('errors', []).append({'phase': 'comparative-finalization', 'error': str(error)})
        report['pairedSummary'] = []


# Adds observations only. No application functions or browser primitives are replaced.
PROBE = r'''(() => {
 const native = fn => /\[native code\]/.test(Function.prototype.toString.call(fn));
 const p = {frames:[],longTasks:[],events:[],clicks:[],visibility:[],supported:PerformanceObserver.supportedEntryTypes,
   native:{date:native(Date.now),performance:native(performance.now),raf:native(requestAnimationFrame),
   cancelRaf:native(cancelAnimationFrame),timeout:native(setTimeout),interval:native(setInterval),
   get:native(Storage.prototype.getItem),set:native(Storage.prototype.setItem),file:native(File.prototype.text)}};
 const nodeTokens=new WeakMap();let nextNodeToken=0;
 const token=node=>{if(!nodeTokens.has(node))nodeTokens.set(node,++nextNodeToken);return nodeTokens.get(node);};
 const eventRows=new WeakMap();
 let previous=null, armed=null;
 function frame(at){if(previous!==null)p.frames.push({at,interval:at-previous});previous=at;requestAnimationFrame(frame);}
 requestAnimationFrame(frame);
 if(p.supported.includes('longtask'))new PerformanceObserver(list=>{for(const e of list.getEntries())p.longTasks.push({start:e.startTime,duration:e.duration,name:e.name});}).observe({type:'longtask',buffered:true});
 if(p.supported.includes('event'))new PerformanceObserver(list=>{for(const e of list.getEntries())p.events.push({name:e.name,start:e.startTime,duration:e.duration,processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId});}).observe({type:'event',buffered:true,durationThreshold:16});
 document.addEventListener('visibilitychange',e=>p.visibility.push({at:performance.now(),state:document.visibilityState,trusted:e.isTrusted}));
 document.addEventListener('click',event=>{
   const captureStartAt=performance.now();
   const button=event.target.closest?.('button'); if(!button)return;
   const row={trusted:event.isTrusted,target:button.dataset.tab||button.dataset.action||button.dataset.ring||button.id,
     captureStartAt,eventTimestamp:event.timeStamp,firstRafFrameTimestamp:null,secondRafFrameTimestamp:null,
     firstRafCallbackAt:null,secondRafCallbackAt:null};p.clicks.push(row);
   if(armed&&button.matches(armed.selector)){eventRows.set(event,row);row.selector=armed.selector;row.wallAt=Date.now();row.enabled=!button.disabled;row.beforeStatus=document.querySelector('[data-bind="status"]')?.textContent;
     if(armed.storage)row.beforeRaw=localStorage.getItem(__KEY__);row.storage=armed.storage;armed=null;}
   // A real later timer task runs after this dispatch even if production navigation stops bubbling.
   setTimeout(()=>{row.postDispatchTaskAt=performance.now();},0);
   requestAnimationFrame(first=>{row.firstRafCallbackAt=performance.now();row.firstRafFrameTimestamp=first;
     requestAnimationFrame(second=>{row.secondRafCallbackAt=performance.now();row.secondRafFrameTimestamp=second;});});
 },true);
 document.addEventListener('click',event=>{const row=eventRows.get(event);if(row){row.documentBubbleAt=performance.now();row.afterStatus=document.querySelector('[data-bind="status"]')?.textContent;
   if(row.storage)row.afterRaw=localStorage.getItem(__KEY__);}});
 const snapshot=()=>({now:performance.now(),wallAt:Date.now(),visibility:document.visibilityState,hidden:document.hidden,
   frameCount:p.frames.length,longTaskCount:p.longTasks.length,eventCount:p.events.length,clickCount:p.clicks.length,
   status:document.querySelector('[data-bind="status"]')?.textContent??'',notice:document.querySelector('[data-bind="notice-text"]')?.textContent??'',
   selectedTab:document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab,
   offlineModalVisible:(()=>{const e=document.querySelector('[data-bind="offline-modal"]');return !!e&&!e.hidden&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';})()});
 const fleet=()=>{const panel=document.querySelector('#space-fleet'),rows=[...document.querySelectorAll('#space-fleets [data-flight]')],buttons=[...document.querySelectorAll('#space-fleets button')];
   return{hidden:panel.hidden,computedDisplay:getComputedStyle(panel).display,rowIds:rows.map(e=>Number(e.dataset.flight)),
   rowNodeTokens:rows.map(token),buttonNodeTokens:buttons.map(token),
   buttons:buttons.map(e=>({fleetId:e.dataset.fleet??null,action:e.dataset.space,disabled:e.disabled,connected:e.isConnected,hasClientRects:e.getClientRects().length>0}))};};
 window.__npcPressure={snapshot,fleet,all:()=>p,arm:request=>{armed=request;}};
})();'''


def finite_nonnegative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def qualify_click(rows, selector, storage=False):
    """Read-only evidence gates. Native navigation may intentionally stop bubbling."""
    require(len(rows) == 1, 'Expected exactly one native click, including unexpected nested clicks')
    row = rows[0]
    require(row.get('trusted') is True and row.get('enabled') is True and row.get('selector') == selector,
            'Expected one trusted enabled native click on the exact requested selector')
    require(all(finite_nonnegative(row.get(key)) for key in ('eventTimestamp', 'captureStartAt'))
            and row['eventTimestamp'] <= row['captureStartAt'],
            'Expected finite ordered event timestamp and capture entry time')
    require(finite_nonnegative(row.get('postDispatchTaskAt')) and row['postDispatchTaskAt'] >= row['captureStartAt'],
            'Expected a subsequent native task to witness completed click dispatch')
    require(all(finite_nonnegative(row.get(key)) for key in ('firstRafFrameTimestamp', 'secondRafFrameTimestamp',
                                                            'firstRafCallbackAt', 'secondRafCallbackAt'))
            and row['captureStartAt'] <= row['firstRafCallbackAt'] <= row['secondRafCallbackAt']
            and row['firstRafFrameTimestamp'] <= row['secondRafFrameTimestamp']
            and row['firstRafFrameTimestamp'] <= row['firstRafCallbackAt']
            and row['secondRafFrameTimestamp'] <= row['secondRafCallbackAt'],
            'Expected two native RAF callbacks with finite ordered entry times and separate frame timestamps')
    if storage:
        require(finite_nonnegative(row.get('documentBubbleAt'))
                and isinstance(row.get('beforeRaw'), str) and isinstance(row.get('afterRaw'), str),
                'Save/import requires its synchronous document-bubble storage witness')
    if 'documentBubbleAt' in row:
        require(finite_nonnegative(row['documentBubbleAt'])
                and row['captureStartAt'] <= row['documentBubbleAt'] <= min(row['postDispatchTaskAt'], row['firstRafCallbackAt']),
                'Synchronous document-bubble boundary must precede both later native callbacks')
    # Timer tasks and RAF callbacks need not run in a fixed order relative to each other.
    return row


def click_timing(row, browser_observed_at, host_elapsed_ms):
    """Qualified callback/task observations, never full-response or paint latency."""
    require(finite_nonnegative(browser_observed_at)
            and browser_observed_at >= max(row['postDispatchTaskAt'], row['secondRafCallbackAt']),
            'Browser observation must follow the native timer and second RAF callback')
    require(finite_nonnegative(host_elapsed_ms), 'Expected finite nonnegative host observation duration')
    return {'eventToCaptureStartMs': row['captureStartAt'] - row['eventTimestamp'],
            'captureToDocumentBubbleMs': row['documentBubbleAt'] - row['captureStartAt'] if 'documentBubbleAt' in row else None,
            'eventToPostDispatchTaskMs': row['postDispatchTaskAt'] - row['eventTimestamp'],
            'eventToFirstRafCallbackMs': row['firstRafCallbackAt'] - row['eventTimestamp'],
            'eventToSecondRafCallbackMs': row['secondRafCallbackAt'] - row['eventTimestamp'],
            'rafFrameTimestampIntervalMs': row['secondRafFrameTimestamp'] - row['firstRafFrameTimestamp'],
            'browserObservationAt': browser_observed_at, 'hostToRequiredWitnessObservationMs': host_elapsed_ms}


def process_info(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(') ', 1)[1].split()
        return {'pid': pid, 'birth': fields[19], 'state': fields[0]}
    except (OSError, IndexError, ValueError):
        return None


def supervise(args):
    out = Path(args.output)
    require(not out.exists() or not any(out.iterdir()), 'Use an empty output directory; prior evidence must remain intact')
    out.mkdir(parents=True, exist_ok=True)
    comparing = compare_enabled(args)
    budget = COMPARE_SECONDS if comparing else WHOLE_SECONDS
    atomic_json(out / REPORT, {'completed': False, 'comparativeCompleted': False, 'availableCompleteComparisonPairs': 0,
                               'comparison': {'enabled': comparing}, 'runs': [], 'errors': [], 'phase': 'worker-start'})
    owned, started = {}, time.monotonic()
    def collect(root):
        pending, visited = [root, *owned], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            info = process_info(pid)
            if not info or (pid in owned and info['birth'] != owned[pid]):
                continue
            owned[pid] = info['birth']
            for children in Path(f'/proc/{pid}/task').glob('*/children'):
                try:
                    pending.extend(int(value) for value in children.read_text().split())
                except OSError:
                    pass
    def terminate(sig):
        for pid, birth in reversed(list(owned.items())):
            info = process_info(pid)
            if info and info['birth'] == birth and info['state'] not in ('Z', 'X'):
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
    expired, code = False, 1
    with (out / 'worker.log').open('w', encoding='utf-8') as log:
        process = subprocess.Popen([sys.executable, __file__, *sys.argv[1:], '--worker'], stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                collect(process.pid)
                if time.monotonic() - started >= budget:
                    expired = True
                    break
                time.sleep(.1)
            if not expired:
                code = process.returncode
        finally:
            collect(process.pid); terminate(signal.SIGTERM)
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
            collect(process.pid); terminate(signal.SIGKILL); process.wait(timeout=2)
    report = json.loads((out / REPORT).read_text())
    residual = [info for pid, birth in owned.items() if (info := process_info(pid)) and info['birth'] == birth]
    live = [info for info in residual if info['state'] not in ('Z', 'X')]
    report['supervisor'] = {'wholeBudgetSeconds': budget, 'elapsedSeconds': time.monotonic() - started,
        'workerExitCode': code, 'timedOut': expired, 'observedProcessCount': len(owned), 'residuals': residual, 'liveResiduals': live,
        'scope': 'Only observed descendants with matching PID/start-time. Sampled ancestry cannot exclude never-observed fast-orphaned processes; zombies remain reported.'}
    if expired or code or live:
        report['completed'] = False
        report.setdefault('errors', []).append('Supervisor timeout' if expired else 'Worker failed or live owned descendants remained')
    finalize_comparison(report, not expired and code == 0 and not live)
    atomic_json(out / REPORT, report)
    print(json.dumps({'completed': report['completed'], 'report': str(out / REPORT), 'elapsedSeconds': report['supervisor']['elapsedSeconds']}))
    return 0 if report['completed'] else 1


def native_worker(args, fixture, envelopes, sources=None, comparison=None):
    from playwright.sync_api import sync_playwright
    out = Path(args.output)
    if sources is None:
        sources, comparison = prepare_sources(args)
    comparing = comparison['enabled']
    budget = COMPARE_SECONDS if comparing else WHOLE_SECONDS
    report = {'schema': 'infinity-npc-native-pressure-v2', 'completed': False, 'sourceSha': args.expected_sha,
        'fixtureSha256': args.expected_fixture_sha256, 'fixtureSourceTreeSha': fixture['sourceTreeSha'],
        'productionSourceWorktree': source_identity(args.source_root, args.expected_sha, fixture),
        'fixture': {key: fixture[key] for key in ('synthetic', 'setup', 'expected', 'minimumRemainingSeconds')},
        'comparison': comparison, 'comparativeCompleted': False, 'availableCompleteComparisonPairs': 0,
        'sources': {name: {'sourceSha': source['sha'], 'fixtureSha256': source['fixtureSha256'], 'productionSourceWorktree': source['identity']} for name, source in sources.items()},
        'runs': [], 'errors': [], 'flags': [], 'phase': 'start', 'timing': {'sampleMs': SAMPLE_MS, 'repetitions': REPETITIONS, 'wholeBudgetSeconds': budget},
        'actionTimingSemantics': {
            'browserClock': 'Native performance timeline milliseconds: eventTimestamp is event.timeStamp; captureStartAt, documentBubbleAt, postDispatchTaskAt and first/secondRafCallbackAt are performance.now() at their observer entry.',
            'documentBubbleAt': 'Synchronous document-bubble observer after production handling; absent when navigation stops propagation. Save/import raw storage bytes are read within this same event.',
            'postDispatchTaskAt': 'Later native timer task witnesses completed dispatch even when document bubble is not reached. Timer and RAF callbacks have no required relative order.',
            'rafFrameTimestamps': 'first/secondRafFrameTimestamp are native RAF arguments, retained for their interval only. They can precede the click and are not callback entry times.',
            'browserObservationAt': 'Browser snapshot time read after collecting the raw click witnesses.',
            'hostToRequiredWitnessObservationMs': 'Separate host monotonic elapsed time from before Playwright click until the wait for both timer and second RAF callback returns; includes automation and polling overhead.',
            'scope': 'Event-to-callback and capture-to-document-bubble intervals are separate observations. None measures complete response or proves a completed paint.'},
        'limits': ['Synthetic bounded saves; public-engine fixture transitions are preparation, never a natural gameplay journey.',
            'fixtureSha256 pins the original input fixture bytes. Output fixture.json is a parsed-value copy serialized with a final newline, not the byte-pinned input.',
            'Same production r13 engine sparse-control versus pressure only. No old-source or r12 improvement claim; r12 cannot represent these attacks.',
            'Headed Google Chrome in GitHub Linux/Xvfb, one visible page at a time. Not mobile, OS-hidden, real-display, or hardware-compositor performance.',
            'CDP ScriptDuration/TaskDuration are observed CPU metrics; requestAnimationFrame gaps are native frame-timestamp intervals, not FPS, CPU time, or completed paints.',
            'Read-only RAF, Long Tasks and Event Timing observers add symmetric overhead; Event Timing reports only entries meeting the browser threshold (16ms requested).',
            'No profiler/Debugger active inside CPU windows. Native timers, autosaves, RAF, clocks and visibility remain unmodified.',
            'Hidden Fleet DOM node identity is observed; CPU differences do not identify the cost of an individual internal function.',
            'No invented performance pass threshold. Long tasks overlapping CPU windows are flagged; allLongTasks separately preserves all observed run entries, including startup and actions. Action observations exceeding the requested 10-second budget are flagged.',
            'This independent experiment does not replace mandatory formal native CI acceptance.']}
    if comparing:
        report['limits'][2] = 'Exact two-source r13 observer comparison with byte-identical synthetic inputs; no r12 or natural progression claim.'
        report['limits'].append('The fixed order preserves within-source C/P, P/C, C/P and adjacent cross-source workloads. Three repetitions are not fully order-balanced; temporal/runner drift remains a limitation.')
    atomic_json(out / 'fixture.json', fixture)
    for name, source in sources.items():
        target = out / name / 'input'; target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source['path'], target / 'fixtures.json')
        for filename in ('control0.raw.json', 'control0.save.txt', 'max512.raw.json', 'max512.save.txt'):
            path = Path(source['path']).parent / filename
            if path.exists():
                shutil.copyfile(path, target / filename)
    started = time.monotonic()
    def flush(phase):
        report['phase'] = phase; report['hostElapsedSeconds'] = time.monotonic() - started
        atomic_json(out / REPORT, report)
        print(json.dumps({'phase': phase, 'elapsedSeconds': report['hostElapsedSeconds']}), flush=True)
    def read(page, expression='snapshot()'):
        return page.evaluate('window.__npcPressure.' + expression)
    def metrics(cdp):
        return {row['name']: row['value'] for row in cdp.send('Performance.getMetrics')['metrics']}
    def stored(page):
        return json.loads(page.evaluate('(key)=>localStorage.getItem(key)', fixture['key']))
    def click(page, selector, run, storage=False):
        page.evaluate('(request)=>window.__npcPressure.arm(request)', {'selector': selector, 'storage': storage})
        before_snapshot = read(page); before = before_snapshot['clickCount']; host = time.monotonic()
        action_error = None
        try:
            page.locator(selector).click(timeout=ACTION_MS)
            remaining = max(1, ACTION_MS - int((time.monotonic() - host) * 1000))
            page.wait_for_function('(n)=>{const rows=window.__npcPressure.all().clicks;return rows.length>n && rows.at(-1).secondRafCallbackAt!==null && rows.at(-1).postDispatchTaskAt!==undefined;}', arg=before, timeout=remaining)
        except Exception as error:
            action_error = error
            report['flags'].append({'kind': 'responsive-action-incomplete', 'run': run['id'], 'selector': selector, 'elapsedMs': (time.monotonic() - host) * 1000})
        elapsed = (time.monotonic() - host) * 1000
        # Persist unfiltered raw observations BEFORE every evidence gate. A failed
        # gate must not erase the trusted event or the reason it could not qualify.
        attempts = run.setdefault('actionAttempts', [])
        attempt_path = f'{run["id"]}-action-attempt-{len(attempts)}.json'
        attempt = {'selector': selector, 'storageWitnessRequired': storage, 'before': before_snapshot,
                   'hostElapsedMs': elapsed, 'actionError': str(action_error) if action_error else None}
        rows = []
        try:
            rows = read(page, 'all()')['clicks'][before:]
            attempt.update(after=read(page), observedClicks=rows)
        except Exception as error:
            attempt['observationError'] = str(error)
            if action_error is None:
                action_error = error
        atomic_json(out / attempt_path, attempt)
        attempts.append({'selector': selector, 'rawEvidenceFile': attempt_path, 'hostElapsedMs': elapsed,
                         'observedClickCount': len(rows), 'actionError': attempt['actionError']})
        flush(run['id'] + ':native-click-observed')
        if action_error is not None:
            raise action_error
        row = qualify_click(rows, selector, storage)
        row.update(click_timing(row, attempt['after']['now'], elapsed))
        row['dispatchWitness'] = 'Synchronous document bubble and subsequent native timer task' if 'documentBubbleAt' in row else 'Subsequent native timer task; document bubble not observed'
        for key in ('beforeRaw', 'afterRaw'):
            if key in row:
                raw = row.pop(key); row[key + 'Sha256'] = sha(raw or '')
                row[key + 'Envelope'] = json.loads(raw)
        run['actions'].append(row)
        if elapsed > ACTION_MS or row['eventToSecondRafCallbackMs'] > ACTION_MS:
            report['flags'].append({'kind': 'responsive-action-over-10-seconds', 'run': run['id'], 'selector': selector,
                                    'hostToRequiredWitnessObservationMs': elapsed, 'eventToSecondRafCallbackMs': row['eventToSecondRafCallbackMs']})
        return row
    def tab(page, name, run):
        click(page, f'[data-tab="{name}"]', run)
        page.locator(f'[data-tab-panel="{name}"]').wait_for(state='visible', timeout=ACTION_MS)
    browser = None
    try:
        official = shutil.which('google-chrome') or shutil.which('google-chrome-stable')
        require(official is not None, 'Use scripts/browser-prerequisites.sh official Google Chrome prerequisite')
        executable = args.chromium or official
        require(Path(executable).resolve() == Path(official).resolve(), 'Only discovered official Chrome executable is permitted')
        version = subprocess.check_output([executable, '--version'], text=True, timeout=10).strip()
        require(version.startswith('Google Chrome '), 'Official Google Chrome version required')
        require(os.environ.get('DISPLAY'), 'Headed native experiment requires existing Xvfb DISPLAY')
        report['browser'] = {'executable': executable, 'resolvedExecutable': str(Path(executable).resolve()), 'binaryVersion': version,
                             'headless': False, 'viewport': {'width': 1440, 'height': 1100}, 'platform': sys.platform}
        with sync_playwright() as playwright:
            for source_name, source in sources.items():
                source_out = out / source_name if comparing else out; source_out.mkdir(parents=True, exist_ok=True)
                request = playwright.request.new_context(timeout=10000)
                try:
                    release_url = urljoin(source['url'], 'release.json')
                    response = request.get(release_url)
                    require(response.status == 200 and response.url == release_url, 'Exact production release HTTP200 required')
                    release_bytes = response.body(); release = json.loads(release_bytes)
                    require(release['sourceSha'] == source['sha'] and release['saveVersion'] == 9 and release['saveRevision'] == 13, 'Exact source and v9/r13 release required')
                    (source_out / 'release.json').write_bytes(release_bytes)
                    report['sources'][source_name]['releaseIdentity'] = {'fileCount': len(release['files']), 'url': release_url, 'status': response.status, 'bytes': len(release_bytes), 'sha256': sha(release_bytes), 'metadata': release, 'files': []}
                    if not comparing:
                        report['releaseIdentity'] = report['sources'][source_name]['releaseIdentity']
                    require('index.html' in release['files'] and bool(release['files']), 'Complete release files required')
                    if comparing:
                        require(len(release['files']) == 62 and release['version'] == '0.6.20-alpha.1', 'Each exact comparison release requires version 0.6.20-alpha.1 and 62 files')
                    source['release'] = release
                    for name, expected in sorted(release['files'].items()):
                        path = PurePosixPath(name)
                        require(not path.is_absolute() and '..' not in path.parts and '\\' not in name, 'Unsafe release path')
                        url = urljoin(source['url'], name); asset = request.get(url)
                        body = asset.body()
                        require(asset.status == 200 and asset.url == url and sha(body) == expected, 'Complete production release file mismatch: ' + name)
                        target = source_out / 'release-full-bytes' / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
                        report['sources'][source_name]['releaseIdentity']['files'].append({'name': name, 'url': url, 'status': asset.status, 'bytes': len(body), 'sha256': sha(body)})
                finally:
                    request.dispose()
                flush('production-full-release-identity-complete')
            browser = playwright.chromium.launch(executable_path=executable, headless=False, args=['--no-sandbox'])
            report['browser']['protocolVersion'] = browser.version
            for scheduled in run_schedule(comparing):
                source_name, variant, repetition = scheduled['source'], scheduled['variant'], scheduled['repetition']
                source = sources[source_name]
                fixture, envelopes, release, url = source['fixture'], source['envelopes'], source['release'], source['url']
                order, position = scheduled['order'], scheduled['position']
                # A single Chrome, one separately created and closed context per scheduled run.
                run = {'id': f'{source_name}-{repetition}-{variant}' if comparing else f'{repetition}-{variant}', 'source': source_name, 'variant': variant, 'repetition': repetition, 'pairOrder': list(order), 'pairPosition': position,
                       'samples': [], 'actions': [], 'pageErrors': [], 'failedRequests': [], 'completed': False}
                report['runs'].append(run); flush(run['id'] + ':startup')
                seeded_at = int(time.time() * 1000)
                seeded = seed_now(fixture[variant], seeded_at)
                original_spans, seeded_spans = envelope_spans(fixture[variant]), envelope_spans(seeded)
                run['input'] = {'originalSaveSha256': sha(fixture[variant]), 'seededSaveSha256': sha(seeded), 'seededUtf8Bytes': len(seeded.encode()),
                                'counts': state_counts(envelopes[variant]['state']),
                                'changedEnvelopeFields': {key: {'before': envelopes[variant][key], 'after': seeded_at} for key in ('savedAt', 'lastTickAt')},
                                'originalStateTextSha256': sha(fixture[variant][slice(*original_spans['state'])]),
                                'seededStateTextSha256': sha(seeded[slice(*seeded_spans['state'])]),
                                'perContextInitialization': 'Independent paired input; only envelope watermarks refreshed before boot, never clocks or flight remaining.'}
                (out / (run['id'] + '-seeded.json')).write_text(seeded, encoding='utf-8')
                origin = f'{urlparse(url).scheme}://{urlparse(url).netloc}'
                context = browser.new_context(viewport={'width': 1440, 'height': 1100}, storage_state={'cookies': [], 'origins': [{'origin': origin, 'localStorage': [
                    {'name': fixture['key'], 'value': seeded}, {'name': 'infinity.ui.tab', 'value': 'overview'}]}]})
                run['context'] = {'ordinal': len(report['runs']), 'independent': True, 'closed': False}
                try:
                    context.add_init_script(PROBE.replace('__KEY__', json.dumps(fixture['key'])))
                    page = context.new_page(); page.set_default_timeout(ACTION_MS); page.set_default_navigation_timeout(15000)
                    page.on('pageerror', lambda error, row=run: row['pageErrors'].append(str(error)))
                    page.on('requestfailed', lambda failed, row=run: row['failedRequests'].append(failed.url))
                    capture, parsed = [], []
                    page.on('response', lambda value: capture.append(value) if value.request.resource_type in ('script', 'stylesheet') else None)
                    cdp = context.new_cdp_session(page)
                    cdp.send('Network.enable'); cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
                    cdp.on('Debugger.scriptParsed', lambda value: parsed.append(value) if value.get('url', '').startswith(('http://', 'https://')) else None)
                    cdp.send('Debugger.enable')
                    response = page.goto(url, wait_until='networkidle')
                    require(response and response.status == 200 and response.url == url and sha(response.body()) == release['files']['index.html'], 'Original production HTTP200 document bytes differ')
                    page.locator('[data-tab-panel="overview"]').wait_for(state='visible')
                    http, executed = [], []
                    manifest = {urljoin(url, name): expected for name, expected in release['files'].items()}
                    bodies = {}
                    for asset in capture:
                        body = asset.body(); digest = sha(body)
                        require(asset.status == 200 and asset.url == asset.request.url and digest == manifest.get(asset.url), 'Actual loaded HTTP asset differs from pinned release')
                        bodies[asset.url] = digest
                        http.append({'url': asset.url, 'status': asset.status, 'type': asset.request.resource_type, 'bytes': len(body), 'sha256': digest})
                    require(any(row['type'] == 'script' for row in http) and any(row['type'] == 'stylesheet' for row in http), 'Loaded script and CSS required')
                    for event in parsed:
                        source = cdp.send('Debugger.getScriptSource', {'scriptId': event['scriptId']})['scriptSource']
                        digest = sha(source)
                        require(digest == bodies.get(event['url']) == manifest.get(event['url']), 'Actual V8 source must equal full served HTTP and release bytes')
                        executed.append({'url': event['url'], 'scriptId': event['scriptId'], 'bytes': len(source.encode()), 'sha256': digest})
                    require(bool(executed), 'At least one production V8 script required')
                    run['sourceIdentity'] = {'http': http, 'executed': executed, 'documentSha256': sha(response.body())}
                    cdp.send('Debugger.disable'); cdp.send('Network.disable'); cdp.send('Performance.enable')
                    run['debuggerDisabledBeforeSamples'] = True
                    initial = read(page, 'all()')
                    require(all(initial['native'].values()), 'Native browser APIs were replaced')
                    require('longtask' in initial['supported'] and 'event' in initial['supported'], 'Long Tasks and Event Timing observations required')
                    run['nativeAPIs'] = initial['native']; run['supportedEntryTypes'] = initial['supported']
                    require(read(page)['selectedTab'] == 'overview', 'Overview must precede first Fleet visit')
                    require(not read(page)['offlineModalVisible'], 'Native startup displayed an offline modal; covered Overview cannot qualify')
                    require(not read(page, 'fleet()')['rowIds'], 'Fleet rows already mounted before first real visit')
                    for stage in STAGES:
                        if stage == 'fleet-visible':
                            tab(page, 'fleet', run)
                        elif stage == 'overview-after-fleet':
                            tab(page, 'overview', run)
                        page.wait_for_timeout(400)
                        fleet_before = read(page, 'fleet()')
                        expected_rows = [] if stage == 'overview-before-fleet' else [row['id'] for row in envelopes[variant]['state']['fleets']]
                        require(fleet_before['rowIds'] == expected_rows, 'Fleet mounted identities disagree with stage and fixture')
                        require(fleet_before['hidden'] == (stage != 'fleet-visible'), 'Actual Fleet visibility mismatch')
                        if stage == 'overview-after-fleet':
                            mounted = run['samples'][1]['fleetDomAfter']
                            require(fleet_before['rowNodeTokens'] == mounted['rowNodeTokens'] and fleet_before['buttonNodeTokens'] == mounted['buttonNodeTokens'], 'Hidden Fleet must retain the actual previously visited row/button objects')
                        if stage != 'fleet-visible':
                            require(all(not row['hasClientRects'] for row in fleet_before['buttons']), 'Hidden Fleet controls must have no layout rectangles')
                        flush(run['id'] + ':' + stage + ':measurement')
                        before_probe = read(page); before = metrics(cdp); host = time.monotonic()
                        # No full storage/DOM snapshots, file IO, profiler, or checkpoints in this CPU window.
                        page.wait_for_timeout(SAMPLE_MS)
                        after = metrics(cdp); host_ms = (time.monotonic() - host) * 1000; after_probe = read(page)
                        observations = read(page, 'all()'); fleet_after = read(page, 'fleet()')
                        start, end = before_probe['now'], after_probe['now']
                        frames = [row for row in observations['frames'] if start < row['at'] <= end]
                        longs = [row for row in observations['longTasks'] if row['start'] < end and row['start'] + row['duration'] > start]
                        events = [row for row in observations['events'] if start <= row['start'] < end]
                        cpu = metric_delta(before, after)
                        sample = {'stage': stage, 'start': before_probe, 'end': after_probe, 'hostElapsedMs': host_ms,
                                  'nativeElapsedMs': end - start, 'cdpElapsedMs': (after['Timestamp'] - before['Timestamp']) * 1000,
                                  'rawMetricsBefore': before, 'rawMetricsAfter': after, 'cpuMs': cpu, 'rafCallbacks': frames,
                                  'rafGapSummaryMs': summary([row['interval'] for row in frames]), 'longTasks': longs, 'eventTiming': events,
                                  'fleetDomBefore': fleet_before, 'fleetDomAfter': fleet_after}
                        run['samples'].append(sample)
                        require(all(math.isfinite(value) and value >= 0 for value in cpu.values()), 'Invalid native CPU metric delta')
                        require(sample['cdpElapsedMs'] >= SAMPLE_MS and end - start >= SAMPLE_MS, 'Native sample was not five real seconds')
                        require(not before_probe['hidden'] and not after_probe['hidden'] and
                                not any(start <= row['at'] <= end and row['state'] != 'visible' for row in observations['visibility']), 'Actual document visibility changed during sample')
                        require(fleet_after['rowIds'] == expected_rows and fleet_after['hidden'] == fleet_before['hidden'], 'Fleet stage changed during native sample')
                        require(fleet_after['rowNodeTokens'] == fleet_before['rowNodeTokens'] and fleet_after['buttonNodeTokens'] == fleet_before['buttonNodeTokens'], 'Fleet row/button objects were replaced during native sample')
                        require(not before_probe['offlineModalVisible'] and not after_probe['offlineModalVisible'], 'Offline modal obscured a native sample surface')
                        require(not re.search('受保护|暂停写入|本地存储不可用', before_probe['status'] + after_probe['status'] + before_probe['notice'] + after_probe['notice']), 'Protected state cannot qualify performance')
                        if longs:
                            report['flags'].append({'kind': 'native-main-thread-longtasks', 'run': run['id'], 'stage': stage, 'count': len(longs), 'maxDurationMs': max(row['duration'] for row in longs)})
                        flush(run['id'] + ':' + stage + ':complete')
                    tab(page, 'save', run)
                    saved = click(page, '[data-action="save"]', run, storage=True)
                    require(saved['afterStatus'] == '已保存到本地', 'Native save did not report success on that trusted dispatch')
                    require(saved['afterRawSha256'] != saved['beforeRawSha256'], 'Native save did not write fresh accounted-clock bytes')
                    require(state_counts(saved['afterRawEnvelope']['state']) == run['input']['counts'], 'Native save lost full pressure counts')
                    require(stable_identity(saved['afterRawEnvelope']['state']) == stable_identity(envelopes[variant]['state']), 'Live fixture identities changed during CPU stages')
                    page.locator('[data-bind="transfer"]').fill('EXPLICIT INVALID NPC PRESSURE INPUT')
                    rejected = click(page, '[data-action="import-text"]', run, storage=True)
                    require(rejected['afterStatus'].startswith('导入失败，当前进度未改动：'), 'Native invalid-import warning was not shown')
                    require(rejected['beforeRawSha256'] == rejected['afterRawSha256'], 'Rejected import changed native current-slot bytes inside its synchronous trusted dispatch')
                    require(stable_identity(rejected['beforeRawEnvelope']['state']) == stable_identity(rejected['afterRawEnvelope']['state']), 'Invalid import changed stable state identities')
                    require(rejected['afterRawEnvelope']['version'] == 9 and rejected['afterRawEnvelope']['revision'] == 13, 'Invalid import adopted unexpected envelope')
                    final_envelope = stored(page)
                    run['postActionCounts'] = state_counts(final_envelope['state'])
                    run['seedToFinalObservationMs'] = int(time.time() * 1000) - seeded_at
                    require(run['seedToFinalObservationMs'] < fixture['minimumRemainingSeconds'] * 1000, 'Fixture outbound flight lifetime was exceeded; no valid full-pressure claim')
                    run['finalStoredWatermarks'] = {key: final_envelope[key] for key in ('savedAt', 'lastTickAt')}
                    require(run['postActionCounts'] == run['input']['counts'], 'Final native counts changed')
                    run['optionalAutoReveal'] = {'run': False, 'reason': 'Optional reveal omitted: fixture has no configured auto protocol; required save and warning actions remain native.'}
                    page.screenshot(path=str(out / (run['id'] + '-final.png')), full_page=False)
                    final = read(page, 'all()')
                    run['allLongTasks'] = final['longTasks']; run['allEventTiming'] = final['events']; run['visibilityEvents'] = final['visibility']
                    # Full action envelopes remain separate reviewable artifacts, not duplicated in the summary.
                    for index, action in enumerate(run['actions']):
                        for key in ('beforeRawEnvelope', 'afterRawEnvelope'):
                            if key in action:
                                target = f'{run["id"]}-action-{index}-{key}.json'; atomic_json(out / target, action.pop(key)); action[key + 'File'] = target
                    require(not run['pageErrors'] and not run['failedRequests'], 'Browser page errors or failed requests were observed')
                    run['completed'] = True; flush(run['id'] + ':complete')
                finally:
                    context.close()
                    run['context']['closed'] = True
            if comparing:
                validate_comparison_runs(report['runs'])
            report['pairedSummary'] = [] if comparing else paired_summary(report['runs'])
            report['hiddenAfterVisitDeltas'] = [{'run': run['id'], 'source': run['source'], 'variant': run['variant'], 'repetition': run['repetition'],
                'afterMinusBeforeCpuMs': {key: run['samples'][2]['cpuMs'][key] - run['samples'][0]['cpuMs'][key] for key in ('ScriptDuration', 'TaskDuration')}} for run in report['runs']]
            report['completed'] = True
            browser.close(); browser = None
    except BaseException as error:
        report['errors'].append({'phase': report['phase'], 'error': str(error), 'traceback': traceback.format_exc()})
        report['completed'] = False
    finally:
        flush('completed' if report['completed'] else 'failed')
        # On exceptional exit sync_playwright has already stopped before this
        # finally block. Do not send browser.close through its dead event loop.
        # The independent supervisor still verifies/cleans observed owned PIDs.
    return 0 if report['completed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:4173/Infinity/')
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--source-root', required=True, help='Clean worktree of the exact production commit, separate from measurement scripts if needed')
    parser.add_argument('--expected-fixture-sha256', required=True)
    for name in COMPARE_ARGUMENTS:
        parser.add_argument('--' + name.replace('_', '-'), help='Optional exact old/new comparison; all five compare parameters are required together')
    parser.add_argument('--output', default='npc-pressure-evidence')
    parser.add_argument('--chromium')
    parser.add_argument('--preflight', action='store_true', help='Python-only validation; no browser or Node execution')
    parser.add_argument('--worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    compare_enabled(args)
    require(bool(re.fullmatch('[0-9a-f]{40}', args.expected_sha)), 'Exact 40-character source commit required')
    require(bool(re.fullmatch('[0-9a-f]{64}', args.expected_fixture_sha256)), 'Exact complete fixture SHA-256 required')
    require(urlparse(args.url).scheme in ('http', 'https') and args.url.endswith('/'), 'Actual HTTP(S) production base URL with trailing slash required')
    if not args.preflight:
        require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Native NPC pressure execution is GitHub-CI-only; local browser execution is not authorized')
    sources, comparison = prepare_sources(args)
    primary = sources['old' if comparison['enabled'] else 'single']
    fixture, envelopes, source = primary['fixture'], primary['envelopes'], primary['identity']
    if args.preflight:
        print(json.dumps({'classification': 'Python-only fixture preflight, no native evidence', 'sourceSha': fixture['sourceSha'], 'productionSourceWorktree': source,
                          'counts': {name: state_counts(value['state']) for name, value in envelopes.items()}, 'minimumRemainingSeconds': fixture['minimumRemainingSeconds'],
                          'comparison': comparison, 'wholeBudgetSeconds': COMPARE_SECONDS if comparison['enabled'] else WHOLE_SECONDS,
                          'sources': {name: value['identity'] for name, value in sources.items()}}))
        return 0
    return native_worker(args, fixture, envelopes, sources, comparison) if args.worker else supervise(args)


if __name__ == '__main__':
    sys.exit(main())
