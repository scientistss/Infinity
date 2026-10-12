"""Read-only r14 scout fixture identity. No Node, build, browser, or writes.

Call only after validating the real workspace against clean_source_summary.
The summary must contain sourceSha and sourceCode (path -> SHA256).
Returned identity proves binding only; mandatory CI/native success is separate.
"""
import copy
import hashlib
import io
import json
import re
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

SOURCE_PIN = '7554c662e3ac1f27876a60d8aa706e5d4a4dcd52'
RAW_PIN = 'fae7a73c01fe9dec87d22564023a601e28853a218fc301185ba1a53463a5096b'
LOCK_ORIGIN = 'cc19bf5e1a459cf8e667ca55f4891ca9ffd25a71'
POOL_PATH = 'tests/fixtures/npc-scout-legacy.json'
NATURAL_PATH = 'scout-rehearsal-source-evidence/natural-report.json'
HISTORY_PATH = 'scout-rehearsal-source-evidence/historical-verification.json'
MILESTONES = ('migrated-paid31-final', 'scout11-paid-outbound', 'scout11-partial-reload',
              'scout11-arrived-once', 'scout11-returned', 'run-cancel-reopen-fill-still-unpaid',
              'attack12-paid-outbound', 'attack12-actual-battle', 'attack12-return-delivered-once',
              'scout13-after-real-battle', 'scout13-returned')


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _pairs(pairs):
    out = {}
    for key, value in pairs:
        _require(key not in out, 'Duplicate JSON object key: ' + key)
        out[key] = value
    return out


def _json(raw):
    def constant(value):
        raise ValueError('Non-finite JSON number: ' + value)
    return json.loads(raw, object_pairs_hook=_pairs, parse_constant=constant)


def _git(workspace, *args):
    return subprocess.check_output(['git', '-C', str(workspace), *args])


def _read(workspace, relative):
    path = PurePosixPath(relative)
    _require(not path.is_absolute() and '..' not in path.parts, 'Non-local path: ' + relative)
    target = workspace
    for part in path.parts:
        target /= part
        _require(not target.is_symlink(), 'Symlinked input: ' + relative)
    _require(target.is_file(), 'Missing input: ' + relative)
    return target.read_bytes()


def _source_file(workspace, current, relative):
    raw = _read(workspace, relative)
    _require(_sha(raw) == current['sourceCode'][relative], 'Tracked source digest mismatch: ' + relative)
    return raw


def _historical_source_bindings(workspace, pool):
    """Read exact Git objects; retain original list order in returned identity."""
    bindings = pool['sourceBindings']
    _require(set(bindings) == {str(n) for n in range(2, 14)}, 'Historical revision set differs')
    for revision, binding in bindings.items():
        _require(type(binding['revision']) is int and binding['revision'] == int(revision), 'Historical revision mismatch')
        sha = binding['sourceSha']
        _require(isinstance(sha, str) and re.fullmatch('[0-9a-f]{40}', sha), 'Invalid historical SHA')
        _require(_git(workspace, 'rev-parse', sha + ':src').decode().strip() == binding['sourceTree'], 'Historical src tree mismatch')
        archive = _git(workspace, 'archive', sha, 'src', 'package.json', 'package-lock.json', 'tsconfig.json')
        actual = {}
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for entry in tar:
                if entry.isdir():
                    continue
                _require(entry.isfile(), 'Non-regular historical source file')
                _require(entry.name not in actual, 'Duplicate archived source path')
                actual[entry.name] = _sha(tar.extractfile(entry).read())
        files = binding['sourceFiles']
        expected = {item['path']: item['sha256'] for item in files}
        _require(len(files) == len(expected) and expected == actual, 'Historical source file set or bytes mismatch: r' + revision)
        _require(binding['serializerSha256'] == actual['src/game/save.ts'], 'Historical serializer mismatch')
    _require(bindings['13']['sourceSha'] == SOURCE_PIN, 'Wrong r13 source pin')
    return bindings


def scout_fixture_identity(workspace, clean_source_summary, runtime):
    """Return full raw/canonical hashes and verified provenance, never acceptance.

    The trusted caller obtains runtime from this job's actual node --version and
    validates current source/assets/runtime separately across all required jobs.
    This function does not run Node or mutate the workspace.
    """
    workspace = Path(workspace)
    current = clean_source_summary
    expected = current['sourceSha']
    _require(isinstance(expected, str) and re.fullmatch('[0-9a-f]{40}', expected), 'Invalid current source SHA')
    _require(isinstance(runtime, str) and re.fullmatch(r'v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?', runtime), 'Missing or invalid actual Node runtime')
    raw = {'pool': _source_file(workspace, current, POOL_PATH),
           'historical': _read(workspace, HISTORY_PATH),
           'natural': _read(workspace, NATURAL_PATH)}
    pool, historical, natural = (_json(raw[name]) for name in ('pool', 'historical', 'natural'))
    _require(pool['schema'] == 'infinity-scout-genuine-legacy-fixtures-v1', 'Wrong fixture schema')
    generated = pool['generatedBy']
    for path_key, digest_key, expected_path in (
        ('path', 'sha256', 'scripts/scout-historical-fixtures.mjs'),
        ('preparationPath', 'preparationSha256', 'scripts/scout-historical-fixtures.py')):
        _require(generated[path_key] == expected_path, 'Wrong fixture producer path')
        _require(generated[digest_key] == _sha(_source_file(workspace, current, expected_path)), 'Fixture producer bytes mismatch')
    # Historical generation really used Node 24 and the prior release lock.
    # Preserve that metadata; it must not be rewritten to look like this run.
    _require(isinstance(generated['runtimeNode'], str) and re.fullmatch(r'v\d+\.\d+\.\d+', generated['runtimeNode']), 'Invalid historical runtime')
    original_lock_raw = _git(workspace, 'show', LOCK_ORIGIN + ':package-lock.json')
    _require(_sha(original_lock_raw) == generated['dependencyLockSha256'], 'Historical producer lock mismatch')
    before_lock = _json(original_lock_raw)
    current_lock_raw = _source_file(workspace, current, 'package-lock.json')
    after_lock = _json(current_lock_raw)
    _require(before_lock['version'] == before_lock['packages']['']['version'] == '0.6.21-alpha.1', 'Wrong original lock release')
    _require(after_lock['version'] == after_lock['packages']['']['version'] == '0.6.23-alpha.1', 'Wrong r14 lock release')
    before_lock['version'] = before_lock['packages']['']['version'] = '0.6.23-alpha.1'
    _require(before_lock == after_lock, 'Dependency contents differ from fixture producer')
    _require(generated['decimalPackageVersion'] == after_lock['packages']['node_modules/break_infinity.js']['version'], 'Historical decimal package mismatch')
    bindings = _historical_source_bindings(workspace, pool)
    rows = pool['rows']
    _require(isinstance(rows, list) and len(rows) == 56, 'Incomplete historical fixture pool')
    _require(len({row['id'] for row in rows}) == len(rows), 'Duplicate historical fixture ID')
    _require({row['revision'] for row in rows} == set(range(2, 14)), 'Incomplete historical revision coverage')
    for row in rows:
        body = row['raw'].encode('utf-8')
        _require(type(row['revision']) is int and row['sourceSha'] == bindings[str(row['revision'])]['sourceSha'], 'Row historical source mismatch')
        _require(_sha(body) == row['rawSha256'] and len(body) == row['rawBytes'], 'Historical raw byte mismatch')
        _require(row['sourceRefusesR14']['rejected'] is True and row['sourceNegativeControl']['rejected'] is True, 'Historical negative-control missing')
    _require(historical['schema'] == 'infinity-scout-genuine-legacy-verification-v1' and historical['status'] == 'passed', 'Historical verification failed')
    _require(historical['candidateSaveSha256'] == _sha(_source_file(workspace, current, 'src/game/save.ts')), 'Historical candidate source mismatch')
    _require(historical['fixtureSha256'] == _sha(raw['pool']), 'Historical fixture byte mismatch')
    checks = historical['checks']
    _require(type(historical['rows']) is int and historical['rows'] == len(rows) == len(checks), 'Historical check count mismatch')
    for row, check in zip(rows, checks):
        _require(check['id'] == row['id'] and type(check['revision']) is int and check['revision'] == row['revision'], 'Historical check ordering or identity mismatch')
        _require(check['fullProjection'] == 'exact' and check['actualCandidateRefusedByOldSource']['rejected'] is True, 'Historical projection or refusal incomplete')
        _require(type(check['messages']) is int and check['messages'] == len(row['r13ReaderOutput']['state']['messages']), 'Historical message projection incomplete')
    _require(natural['schema'] == 'infinity-scout-rehearsal-natural-route-v1', 'Wrong natural schema')
    source = natural['source']
    _require(source['sourceSha'] == expected and source['sourceScopeStatusPorcelain'] == '', 'Natural source is stale or dirty')
    _require(source['fixturePoolSha256'] == _sha(raw['pool']), 'Natural fixture pool mismatch')
    _require(source['routeScriptSha256'] == _sha(_source_file(workspace, current, 'scripts/scout-rehearsal-natural-route.ts')), 'Natural producer script mismatch')
    _require(source['dependencyLockSha256'] == _sha(current_lock_raw), 'Natural lock mismatch')
    _require(source['runtimeNode'] == runtime, 'Natural runtime mismatch')
    _require(source['oldSourceSha'] == SOURCE_PIN and source['oldSourceBindings'] == bindings['13']['sourceFiles'], 'Natural historical source bindings mismatch')
    outcome = natural['outcome']
    _require(outcome['status'] == 'passed' and outcome['mainComplete'] is True and outcome['failure'] is None, 'Natural outcome incomplete')
    _require(natural['checks'] and all(check['passed'] is True for check in natural['checks']), 'Natural checks failed or empty')
    _require(type(outcome['checks']) is int and outcome['checks'] == len(natural['checks']), 'Natural check count mismatch')
    origin = natural['origin']
    original = next(row for row in rows if row['id'] == 'r13-empty10-zero-round-loot-delivered')
    _require(original['synthetic'] is False and original['naturalProgression'] is True, 'Origin is not natural')
    _require(origin['id'] == original['id'] and origin['historicalSourceSha'] == SOURCE_PIN, 'Natural origin provenance mismatch')
    _require(origin['rawSha256'] == original['rawSha256'] == RAW_PIN and origin['raw'] == original['raw'] and _sha(origin['raw'].encode()) == RAW_PIN, 'Natural origin raw mismatch')
    _require(origin['envelope'] == _json(origin['raw']), 'Natural origin envelope mismatch')
    _require(natural['target'] == {'galaxy': 1, 'system': 56, 'position': 15} and natural['publicSeeds'] == [608135816, 2242054355, 320440878], 'Natural target or public seeds mismatch')
    milestones = natural['milestones']
    _require([row['name'] for row in milestones] == list(MILESTONES), 'Natural milestone sequence incomplete')
    _require([row['name'] for row in natural['tape'] if row['kind'] == 'checkpoint'] == list(MILESTONES), 'Natural checkpoint tape incomplete')
    _require([row['fleetId'] for row in natural['tape'] if row['kind'] in ('scout', 'attack')] == [11, 12, 13], 'Natural paid fleet sequence differs')
    for row in milestones:
        _require(type(row['reload']) is bool and isinstance(row['expected'], dict), 'Natural milestone shape mismatch')
        for field in ('raw', 'historicalRaw'):
            _require(_sha(row[field].encode()) == row[field + 'Sha256'], 'Natural milestone byte mismatch: ' + field)
    partial = milestones[2]
    fleets = partial['expected']['fleets']
    _require(partial['reload'] is True and len(fleets) == 1 and fleets[0]['id'] == 11 and fleets[0]['returning'] is False and 0 < fleets[0]['remaining'] < fleets[0]['duration'], 'Natural partial scout boundary missing')
    _require(all(message.get('npcScoutSnapshot') is None for message in partial['expected']['messages']), 'Partial scout prematurely observed')
    _require({'paidCompletion', 'performance', 'maxMessages', 'eviction', 'curvature'} <= set(natural['branches']), 'Natural/synthetic branch coverage incomplete')
    canonical_hashes = {name: _sha(_canonical(_json(body))) for name, body in raw.items()}
    identity = {'schema': 'infinity-scout-fixture-identity-v1', 'sourceSha': expected,
                'runtimeNode': runtime, 'rawSha256': {name: _sha(body) for name, body in raw.items()},
                'canonicalSha256': canonical_hashes, 'rawBytes': {name: len(body) for name, body in raw.items()},
                'historicalSourceBindingsSha256': _sha(_canonical(bindings)),
                'historicalProducer': copy.deepcopy(generated), 'historicalRowCount': len(rows),
                'naturalCheckCount': len(natural['checks']), 'originRawSha256': RAW_PIN,
                'excludedFields': []}
    return {'identitySha256': _sha(_canonical(identity)), 'identity': identity,
            'classification': 'Complete scout fixture binding only; all three mandatory same-SHA jobs must still succeed.'}
