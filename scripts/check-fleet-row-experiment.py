#!/usr/bin/env python3
"""Exact prototype source adoption and post-browser, dual-reader whole-save checks.

Only the saves command invokes Node; source checks and offline tests use Python/Git.
This narrowly replaces the older frozen source seal for this experiment, not release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

BASELINE = '7ab569045996a1a6ad8ce1aee477092144dfad74'
PATCH_SHA256 = 'a488d9df9f99bba7ad408936bbbf963c9a5400a1e3eae19daebb0a8fca02e176'
CANDIDATE_FILE_SHA256 = '970c1f8a9102ef14f9680b3e34d22354abb4bb71353e4778c1a5fce6c777f65e'
PRODUCTION_FILE = 'src/ui/space-panel.ts'
ADDITIONS = {
    '.github/workflows/fleet-row-lookup.yml', 'docs/FLEET_ROW_LOOKUP_EXPERIMENT.md',
    'scripts/browser-fleet-row-performance.py', 'scripts/test_fleet_row_performance.py',
    'scripts/check-fleet-row-experiment.py', 'scripts/test_fleet_row_experiment.py',
    'tests/fleet-row-index.test.ts',
}
FIXTURES = {
    'moderate': ('4947a1e9fcbb007edc52a2f2ebf0bddc4f4842eeefffd248a4af0c641cb38096',
                 'e88523176db7ff86949de409dfd046552ab39cc69c3a6d4c287cceaea4e0fd1f', 2, 1),
    'combined': ('51175269239ac45ac76b1ea8fc1f1bb3d6e9f42da58709b9ecdf6a171e680a98',
                 '27e53db00f583e45db975d5b4421991de58a776d633c81da3efddca933340301', 100, 1000),
}
STEPS = ['initial', 'tab-overview', 'tab-orders', 'tab-fleet', 'focused-draft',
         'fleet-250', 'fleet-750', 'fleet-1500', 'manual-save']


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(a, b):
    return json.dumps(a, sort_keys=True, allow_nan=False) == json.dumps(b, sort_keys=True, allow_nan=False)


def git(root, *args):
    return subprocess.check_output(['git', '--no-replace-objects', '-C', str(root), '-c', 'core.quotePath=true', *args])


def tree(root, sha):
    rows = {}
    for raw in git(root, 'ls-tree', '-rz', '--full-tree', sha).split(b'\0'):
        if raw:
            meta, path = raw.decode().split('\t'); mode, kind, oid = meta.split()
            require(kind == 'blob' and mode in ('100644', '100755'), 'Non-regular tracked source')
            rows[path] = (mode, oid)
    return rows


def validate_delta(before, after, patch):
    require(set(after) - set(before) == ADDITIONS, 'Experiment additions differ from exact inventory')
    require(not (set(before) - set(after)), 'Baseline tracked source was removed')
    changed = [path for path in before if before[path] != after[path]]
    require(changed == [PRODUCTION_FILE], 'Changes outside exact fleet-row production file')
    require(before[PRODUCTION_FILE][0] == after[PRODUCTION_FILE][0] == '100644', 'Production mode changed')
    require(digest(patch) == PATCH_SHA256, 'Full production patch differs from exact prototype')


def verify_files(root, expected):
    """Read every tracked file, including unchanged build tools, tests and seals."""
    records = {}
    for relative, (mode, oid) in expected.items():
        path = root / relative
        require(not any(p.is_symlink() for p in [path, *path.parents] if p != root.parent), 'Symlink in source path')
        actual = path.lstat()
        require(stat.S_ISREG(actual.st_mode), 'Non-regular source: ' + relative)
        require(('100755' if actual.st_mode & 0o111 else '100644') == mode, 'Source mode differs: ' + relative)
        raw = path.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        require(blob == oid, 'Actual source differs from archive: ' + relative)
        records[relative] = {'mode': mode, 'gitBlob': oid, 'sha256': digest(raw)}
    for directory in ('src', 'public'):
        entries = list((root / directory).rglob('*'))
        require(not any(p.is_symlink() for p in entries), 'Symlink in production inventory')
        actual = {str(p.relative_to(root)) for p in entries if not p.is_dir()}
        require(actual == {p for p in expected if p.startswith(directory + '/')}, 'Untracked production source')
    return records


def verify_sources(baseline, candidate, candidate_sha):
    require(re.fullmatch('[0-9a-f]{40}', candidate_sha) and candidate_sha != BASELINE, 'Distinct exact candidate SHA required')
    trees = {}
    for side, root, sha in [('baseline', baseline, BASELINE), ('candidate', candidate, candidate_sha)]:
        require(git(root, 'rev-parse', 'HEAD').decode().strip() == sha, 'Wrong ' + side + ' checkout')
        require(not git(root, 'status', '--porcelain', '--untracked-files=no'), 'Dirty tracked ' + side + ' source')
        require(not git(root, 'ls-files', '--others', '--exclude-standard'), 'Untracked ' + side + ' inputs')
        require(not list(root.glob('.env*')), 'Unexpected build environment file')
        trees[side] = tree(root, sha)
    require(tree(candidate, BASELINE) == trees['baseline'], 'Different baseline tree')
    patch = git(candidate, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', '--full-index',
                '--no-color', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/', BASELINE, candidate_sha, '--', PRODUCTION_FILE)
    validate_delta(trees['baseline'], trees['candidate'], patch)
    files = {side: verify_files(root, trees[side]) for side, root in [('baseline', baseline), ('candidate', candidate)]}
    require(files['candidate'][PRODUCTION_FILE]['sha256'] == CANDIDATE_FILE_SHA256, 'Wrong candidate file bytes')
    return {'baselineSourceSha': BASELINE, 'candidateSourceSha': candidate_sha, 'productionPatchSha256': digest(patch),
            'allTrackedFiles': files, 'scope': 'Exact single-file prototype adoption; all prior source seals remain unchanged. Not release approval.'}, patch


def schedule():
    return [{'profile': profile, 'block': block + 1, 'position': pos + 1, 'side': side, 'pair': block * 2 + pos // 2 + 1,
             'case': f'{profile}-b{block + 1}-{pos + 1}-{side}'}
            for profile in FIXTURES for block in range(2) for pos, side in enumerate(('baseline', 'candidate', 'candidate', 'baseline'))]


def validate_report(report, candidate_sha, mode):
    require(report['baselineSourceSha'] == BASELINE and report['candidateSourceSha'] == candidate_sha, 'Report source identity differs')
    require(report['mode'] == mode and report['completed'] is True and report['observationsComplete'] is True
            and report['globalCleanupComplete'] is True and report['errors'] == [], 'Incomplete browser report')
    s = report['supervisor']
    require(type(s['workerExitCode']) is int and s['workerExitCode'] == 0 and s['timedOut'] is False and s['error'] is None
            and s['noObservedLiveOwnedDescendants'] is True and s['remainingLiveOwnedPids'] == [], 'Incomplete supervisor cleanup')
    runs = report['runs']
    require(all(r['valid'] is True and r['cleanupComplete'] is True for r in runs), 'Invalid/incomplete context')
    if mode == 'native-timing':
        expected = schedule()
        require(exact(report['plannedCases'], expected) and exact([{k: r[k] for k in expected[0]} for r in runs], expected), 'Wrong fixed ABBA schedule')
        require(all(exact([w['number'] for w in r['windows']], [1, 2, 3]) and all(w['valid'] is True for w in r['windows']) for r in runs), 'Missing native window')
        require(set(report['comparisons']) == set(FIXTURES) and all(len(v['pairs']) == 4 for v in report['comparisons'].values()), 'Incomplete pairs')
    else:
        require([(r['profile'], r['side']) for r in runs] == [(p, s) for p in FIXTURES for s in ('baseline', 'candidate')], 'Wrong controlled contexts')
        require(all(list(r['snapshots']) == STEPS for r in runs), 'Incomplete controlled snapshots')
        require(set(report['equivalence']) == set(FIXTURES) and all(v['equal'] is True for v in report['equivalence'].values()), 'Controlled equality failed')


STRICT_READERS = r'''
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const input=JSON.parse(readFileSync(0,'utf8')), checks=[];
for(const source of input.sources) {
 const save=await import(pathToFileURL(source.module).href);
 for(const item of input.saves) {
  const raw=readFileSync(item.path,'utf8'), parsed=JSON.parse(raw);
  assert.equal(parsed.version,9); assert.equal(parsed.revision,14);
  assert.equal(parsed.state.planets.length,item.planets); assert.equal(parsed.state.fleets.length,item.fleets);
  const accepted=save.importSave(raw);
  assert.deepEqual(accepted,parsed,`${source.side}/${item.relative}: strict reader changed envelope`);
  const canonical=save.exportSave(save.deserializeState(accepted.state),accepted.savedAt,accepted.lastTickAt);
  assert.deepEqual(JSON.parse(canonical),parsed,`${source.side}/${item.relative}: full export changed envelope`);
  const again=save.importSave(canonical);
  assert.equal(save.exportSave(save.deserializeState(again.state),again.savedAt,again.lastTickAt),canonical,
   `${source.side}/${item.relative}: canonical serialization is unstable`);
  checks.push({source:source.side,path:item.relative,strictReaderAccepted:true,fullEnvelopeEqual:true,canonicalFixedPoint:true});
 }
}
process.stdout.write(JSON.stringify(checks));
'''


def collect_saves(root, report):
    saves = []
    def add(relative, profile, expected_sha=None):
        path = root / relative
        require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), 'Unsafe/missing native save')
        raw = path.read_bytes()
        if expected_sha is not None:
            require(digest(raw) == expected_sha, 'Native save hash mismatch: ' + relative)
        saves.append({'path': str(path.resolve()), 'relative': relative, 'profile': profile, 'bytes': len(raw),
                      'sha256': digest(raw), 'planets': FIXTURES[profile][2], 'fleets': FIXTURES[profile][3]})
    for profile, (fixture_sha, save_sha, _, _) in FIXTURES.items():
        raw = (root / (profile + '-original-fixture.json')).read_bytes()
        require(digest(raw) == fixture_sha, 'Wrong original fixture')
        pair = json.loads(raw)['pairedNative']
        require(digest(pair['afterSave'].encode()) == pair['afterSha256'] == save_sha, 'Wrong r14 fixture input')
        add(profile + '-original-afterSave.json', profile, save_sha)
    controlled = report['mode'] == 'controlled-equivalence'
    for row in report['runs']:
        case = row['profile'] + '-' + row['side'] if controlled else row['case']
        add(case + '/seeded-current.json', row['profile'], None if controlled else row['seed']['sha256'])
        if not controlled:
            for window in row['windows']:
                for side in ('before', 'after'):
                    add(f"{case}/window-{window['number']}-{side}-current.json", row['profile'], window[side]['currentSha256'])
        else:
            for step, record in row['snapshots'].items():
                require(record['file'] == case + '/' + step + '.json', 'Unexpected snapshot path')
                raw = (root / record['file']).read_bytes()
                require(digest(raw) == record['sha256'], 'Snapshot hash mismatch')
                snapshot = json.loads(raw)
                require(snapshot['storage']['infinity.original-p4.save.v1'] == snapshot['raw'], 'Snapshot storage differs')
                relative = 'strict-snapshot-saves/' + case + '/' + step + '.json'
                path = root / relative; path.parent.mkdir(parents=True, exist_ok=True)
                with path.open('xb') as handle:
                    handle.write(snapshot['raw'].encode())
                add(relative, row['profile'])
    require(len(saves) == (42 if controlled else 114), 'Incomplete whole-save inventory')
    return saves


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('source', 'saves'))
    parser.add_argument('--baseline', required=True, type=Path)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--candidate-sha', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--mode', choices=('native-timing', 'controlled-equivalence'))
    args = parser.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    result = {'completed': False, 'command': args.command}
    try:
        source, patch = verify_sources(args.baseline.resolve(), args.candidate.resolve(), args.candidate_sha)
        if args.command == 'source':
            result.update(source)
            with (args.output / 'production.patch').open('xb') as handle: handle.write(patch)
        else:
            require(args.evidence is not None and args.mode is not None, 'Provide evidence and expected mode')
            root = args.evidence.resolve(); report_raw = (root / 'report.json').read_bytes(); report = json.loads(report_raw)
            result.update({'mode': args.mode, 'browserReportSha256': digest(report_raw)})
            validate_report(report, args.candidate_sha, args.mode)
            require(json.loads((root / 'watchdog.json').read_bytes()) == report['supervisor'], 'Supervisor record differs')
            saves = collect_saves(root, report); result['rawSaves'] = saves
            inputs = {'sources': [{'side': side, 'module': str(path.resolve() / 'src/game/save.ts')}
                                  for side, path in [('baseline', args.baseline), ('candidate', args.candidate)]], 'saves': saves}
            checked = subprocess.run(['node', '--import', 'tsx', '--input-type=module', '-e', STRICT_READERS],
                                     input=json.dumps(inputs), text=True, capture_output=True, cwd=args.candidate, timeout=90)
            require(checked.returncode == 0, 'Actual whole-save reader/export check failed: ' + checked.stderr[-4000:])
            result['checks'] = json.loads(checked.stdout)
            require(len(result['checks']) == 2 * len(saves), 'Missing dual-reader check')
            result.update({k: source[k] for k in ('baselineSourceSha', 'candidateSourceSha', 'productionPatchSha256')})
            result['scope'] = 'Both exact source readers/exporters, every full r14 envelope after browser cleanup; no state projection or independent simulation oracle.'
        result['completed'] = True
    except BaseException as error:
        result['error'] = {'type': type(error).__name__, 'message': str(error)}
        raise
    finally:
        with (args.output / (args.command + '-check.json')).open('x') as handle:
            json.dump(result, handle, indent=2); handle.write('\n')
    print(json.dumps({'completed': True, 'command': args.command, 'checks': len(result.get('checks', []))}))


if __name__ == '__main__':
    main()
