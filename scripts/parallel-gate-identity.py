"""Fail-closed same-source/build/runtime binding for the three mandatory CI jobs.
Identity is not browser acceptance: required-gates separately requires all jobs green.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

SOURCE_AREAS = ('src', 'scripts', 'tests', 'public', '.github')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def exact_source(root, expected, clean=False):
    assert re.fullmatch('[0-9a-f]{40}', expected), expected
    assert git(root, 'rev-parse', 'HEAD').decode().strip() == expected
    if clean:
        assert git(root, 'status', '--porcelain=v1', '--untracked-files=all') == b'', root
    assert git(root, 'diff', 'HEAD', '--') == b'', root
    for flag in ((), ('--ignored',)):
        assert git(root, 'ls-files', '--others', *flag, '--exclude-standard', '--', *SOURCE_AREAS) == b'', root
    files, modes = {}, {}
    for entry in git(root, 'ls-tree', '-r', '-z', expected).split(b'\0'):
        if not entry:
            continue
        metadata, path_bytes = entry.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split()
        path = path_bytes.decode('utf-8')
        file = root / path
        assert kind == 'blob' and mode in ('100644', '100755'), path
        assert file.is_file() and not file.is_symlink(), path
        raw = file.read_bytes()
        assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == blob, path
        assert bool(file.stat().st_mode & 0o111) == (mode == '100755'), path
        files[path], modes[path] = sha(raw), mode
    return {'sourceSha': expected, 'srcTree': git(root, 'rev-parse', 'HEAD:src').decode().strip(),
            'fullTree': git(root, 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'sourceCode': files, 'sourceModes': modes}


def exact_assets(workspace, expected):
    assert (workspace / 'dist').is_dir() and not (workspace / 'dist').is_symlink()
    release_path = workspace / 'dist/release.json'
    assert release_path.is_file() and not release_path.is_symlink()
    release_raw = release_path.read_bytes()
    release = json.loads(release_raw)
    assert release['sourceSha'] == expected
    assert type(release['saveVersion']) is int and release['saveVersion'] == 9
    assert type(release['saveRevision']) is int and release['saveRevision'] == 16
    assert release['version'] == '0.6.32-alpha.1'
    assert type(release['files']) is dict and len(release['files']) == 62
    assets = {}
    for file in sorted((workspace / 'dist').rglob('*')):
        assert not file.is_symlink(), file
        if file.is_file():
            assets[str(file.relative_to(workspace / 'dist'))] = sha(file.read_bytes())
    assert len(assets) == 63
    assert {name: digest for name, digest in assets.items() if name != 'release.json'} == release['files']
    return {'assets': assets, 'releaseSha256': sha(release_raw), 'assetCount': 62,
            'saveVersion': release['saveVersion'], 'saveRevision': release['saveRevision']}


def common_identity(workspace, source_root, expected, runtime):
    assert re.fullmatch(r'v22\.\d+\.\d+', runtime), runtime
    source = exact_source(source_root, expected, clean=True)
    assert exact_source(workspace, expected) == source
    assets = exact_assets(workspace, expected)
    return {'schema': 'infinity-three-job-common-identity-v1',
            'source': source, **assets, 'runtimeNode': runtime,
            'sourceZipSha256': sha(git(workspace, 'archive', '--format=zip', '--prefix=Infinity/', 'HEAD'))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--scout-fixtures', action='store_true')
    args = parser.parse_args()
    workspace = Path(os.environ['GITHUB_WORKSPACE']).resolve()
    expected = os.environ['GITHUB_SHA']
    runtime = subprocess.check_output(['node', '--version'], text=True).strip()
    identity = common_identity(workspace, args.source_root.resolve(), expected, runtime)
    digest = sha(canonical(identity))
    (workspace / 'common-identity.json').write_bytes(canonical({'identitySha256': digest, 'identity': identity}) + b'\n')
    outputs = {'common-sha256': digest}
    if args.scout_fixtures:
        from scout_fixture_identity import scout_fixture_identity
        fixture = scout_fixture_identity(workspace, identity['source'], runtime)
        fixture_digest = fixture['identitySha256']
        assert re.fullmatch('[0-9a-f]{64}', fixture_digest)
        (workspace / 'scout-fixture-identity.json').write_bytes(canonical(fixture) + b'\n')
        outputs['scout-fixture-sha256'] = fixture_digest
    with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
        for name, value in outputs.items():
            output.write(name + '=' + value + '\n')
    print(json.dumps(outputs))


if __name__ == '__main__':
    main()
