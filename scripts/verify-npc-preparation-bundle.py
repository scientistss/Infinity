"""Require a dormant NPC preparation candidate to ship the exact baseline app.

Only the explicit release.json build-identity document may differ. This is a
preparation check, not gameplay, save migration, native-browser or release QA.
"""
import argparse
import hashlib
import json
from pathlib import Path


def inventory(root):
    root = Path(root)
    files = {}
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise ValueError('Build contains a symlink: ' + str(path))
        if path.is_file():
            files[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    if 'index.html' not in files or 'release.json' not in files:
        raise ValueError('Build is missing index.html or release.json')
    if not any(name.startswith('assets/') and name.endswith('.js') for name in files):
        raise ValueError('Build has no JavaScript asset')
    return files


def compare(base, candidate):
    before, after = inventory(base), inventory(candidate)
    names = set(before) | set(after)
    differences = [name for name in sorted(names) if name != 'release.json' and before.get(name) != after.get(name)]
    return {
        'passed': not differences,
        'scope': 'Compare every emitted app file by path and complete bytes; only release.json identity is excluded.',
        'exclusions': ['release.json'],
        'baseline': before, 'candidate': after, 'differences': differences,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--base-sha', required=True)
    parser.add_argument('--candidate-sha', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = compare(args.base, args.candidate)
    result.update(baselineSha=args.base_sha, candidateSha=args.candidate_sha)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    if not result['passed']:
        raise SystemExit('Dormant preparation changed application bytes: ' + ', '.join(result['differences']))
    print('Exact dormant application files:', len(result['candidate']) - 1)


if __name__ == '__main__':
    main()
