"""Bind every old source byte, test-only additions, fresh build, and run identity.
Read-only source inspection. This is preparation for a bug proof, not a release gate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

BASE = '241a51de31364e9086abcc304884bf9df7cd6912'
PUBLISHED_RELEASE_SHA256 = '4e507e07499f551ecf5d66b937b62c739ab9c6469bd6302a2d4c13852d646843'
ADDITIONS = {
    '.github/workflows/manual-unit-old-proof.yml',
    'scripts/browser-manual-unit-proof.py',
    'scripts/manual-unit-proof-source.py',
    'scripts/test_manual_unit_proof.py',
    'scripts/manual-unit-published-241a-manifest.json',
}

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])

def tracked_files(root, revision):
    entries = {}
    for line in git(root, 'ls-tree', '-r', '-z', revision).split(b'\0'):
        if not line:
            continue
        metadata, path = line.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split()
        if kind != 'blob' or mode not in ('100644', '100755'):
            raise ValueError('Only reviewed ordinary source blobs are allowed')
        entries[path.decode()] = {'mode': mode, 'blob': blob}
    return entries

def verify_source(proof_root, baseline_root, archive, test_sha):
    if git(proof_root, 'rev-parse', 'HEAD').decode().strip() != test_sha:
        raise ValueError('Test checkout HEAD is not requested testSourceSha')
    if git(baseline_root, 'rev-parse', 'HEAD').decode().strip() != BASE:
        raise ValueError('Baseline checkout HEAD is not old published241a')
    if git(proof_root, 'status', '--porcelain', '--untracked-files=no') or git(baseline_root, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Tracked source is dirty')
    old = tracked_files(proof_root, BASE)
    current = tracked_files(proof_root, test_sha)
    if current.keys() - old.keys() != ADDITIONS or old.keys() - current.keys():
        raise ValueError('Candidate must add exactly the five dedicated proof files')
    if any(current[name] != value for name, value in old.items()):
        raise ValueError('A baseline tracked source/mode differs in the proof commit')
    z = zipfile.ZipFile(archive)
    names = {name.removeprefix('Infinity/') for name in z.namelist() if not name.endswith('/')}
    if names != set(old):
        raise ValueError('Readable source archive has additions or omissions')
    result = {}
    for name, identity in old.items():
        blob = git(proof_root, 'cat-file', 'blob', identity['blob'])
        base_bytes = (baseline_root / name).read_bytes()
        test_bytes = (proof_root / name).read_bytes()
        archived = z.read('Infinity/' + name)
        if not blob == base_bytes == test_bytes == archived:
            raise ValueError('Complete baseline/proof/archive source bytes differ: ' + name)
        result[name] = {**identity, 'sha256': sha256(blob), 'bytes': len(blob)}
    additions = {name: {'sha256': sha256((proof_root / name).read_bytes()), 'bytes': (proof_root / name).stat().st_size} for name in sorted(ADDITIONS)}
    return {'baselineFiles': result, 'testOnlyAdditions': additions, 'sourceArchiveSha256': sha256(archive.read_bytes())}

def verify_dist(dist, published):
    expected = json.loads(published.read_text())
    release = json.loads((dist / 'release.json').read_text())
    actual = {str(p.relative_to(dist)): sha256(p.read_bytes()) for p in dist.rglob('*') if p.is_file()}
    if sha256(published.read_bytes()) != PUBLISHED_RELEASE_SHA256 or release != expected:
        raise ValueError('Fresh release differs from published exact241a release')
    if release['sourceSha'] != BASE or len(release['files']) != 62:
        raise ValueError('Fresh production identity or 62-resource contract changed')
    if set(actual) != set(release['files']) | {'release.json'}:
        raise ValueError('Fresh dist has unexpected missing or extra files')
    if actual['release.json'] != PUBLISHED_RELEASE_SHA256 or any(actual[name] != digest for name, digest in release['files'].items()):
        raise ValueError('Fresh full production artifact bytes differ from old published artifact')
    return {'release': release, 'actualFiles': actual, 'releaseSha256': actual['release.json']}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('proof-root', 'baseline-root', 'source-archive', 'dist', 'published-manifest', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--test-sha', required=True)
    args = parser.parse_args()
    output = {'complete': False, 'codeSourceSha': BASE, 'testSourceSha': args.test_sha,
              'runIdentity': {name: os.environ.get(name) for name in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_REF', 'GITHUB_REPOSITORY')},
              'scope': 'Every old tracked source byte including src, public, package/version/lock/build configuration and exact old producer; only dedicated proof files added.'}
    try:
        output['source'] = verify_source(args.proof_root, args.baseline_root, args.source_archive, args.test_sha)
        output['dist'] = verify_dist(args.dist, args.published_manifest)
        output['complete'] = True
    finally:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'complete': output['complete'], 'codeSourceSha': BASE, 'testSourceSha': args.test_sha, 'files': len(output['source']['baselineFiles'])}))

if __name__ == '__main__':
    main()
