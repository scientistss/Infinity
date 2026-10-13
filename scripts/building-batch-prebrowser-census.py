#!/usr/bin/env python3
"""Inventory the actual workflow commands before native browser acceptance.

Read-only, standard-library-only inspection. This does not execute, skip or
replace any gate. Complete run-block bytes remain available to the lead for
source-contract projection and dependency review.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = '.github/workflows/p4-original-verify.yml'
LEGACY_JOBS = ('verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal',
               'lab-blockers', 'manual-unit-payments', 'manual-unit-authority')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def blocks(text, expression):
    markers = list(re.finditer(expression, text, re.MULTILINE))
    return [(marker, text[marker.start():markers[index + 1].start()
                           if index + 1 < len(markers) else len(text)])
            for index, marker in enumerate(markers)]


def run_body(step):
    marker = re.search(r'^(?:      - |        )run: (.*)$', step, re.MULTILINE)
    if not marker:
        return ''
    if marker.group(1) != '|':
        return marker.group(1) + '\n'
    lines = []
    for line in step[marker.end() + 1:].splitlines():
        if line and not line.startswith('          '):
            break
        lines.append(line[10:] if line else '')
    return '\n'.join(lines) + '\n'


def native_commands(body):
    # The watchdog self-test belongs to preparation, not browser evidence.
    return [line.strip() for line in body.splitlines()
            if re.search(r'(?:python(?:3)?\s+scripts/browser-[\w-]+\.py|node\s+scripts/browser-[\w-]+\.mjs)', line)
            and '--watchdog-self-test' not in line]


def inspect(root):
    raw = (root / WORKFLOW).read_bytes()
    text = raw.decode('utf-8')
    assert '\njobs:\n' in text
    jobs = {marker.group(1): body for marker, body in blocks(
        text.split('\njobs:\n', 1)[1], r'^  ([a-z][a-z0-9-]*):\n')}
    report = {}
    acceptance_jobs = (*LEGACY_JOBS, *(name for name in jobs if name not in LEGACY_JOBS and name != 'required-gates'))
    for name in acceptance_jobs:
        assert name in jobs, ('missing required legacy job', name)
        body = jobs[name]
        timeout = re.search(r'^    timeout-minutes: (\d+)$', body, re.MULTILINE)
        entries, boundary, native = [], None, []
        for index, (_, step) in enumerate(blocks(body, r'^      - '), 1):
            code = run_body(step)
            label = re.search(r'^      - name: (.+)$', step, re.MULTILINE)
            label = label.group(1) if label else step.splitlines()[0].strip()
            commands = native_commands(code)
            if commands and boundary is None:
                boundary = {'step': index, 'name': label}
            native.extend(commands)
            if boundary is not None or not code:
                continue
            paths = set(re.findall(r'(?:src|scripts|tests|public)/[\w./-]+', code))
            paths.update('scripts/' + match for match in re.findall(r"-p ['\"]([^'\"]+\.py)['\"]", code))
            paths = sorted(path.rstrip('./') for path in paths)
            dependencies = []
            for path in paths:
                target = root / path
                dependencies.append({'path': path, 'existsInCurrentSource': target.is_file(),
                                     'sha256': sha(target.read_bytes()) if target.is_file() else None})
            entries.append({'step': index, 'name': label, 'run': code, 'runSha256': sha(code.encode()),
                            'dependencies': dependencies,
                            'pinnedCommits': sorted(set(re.findall(r'(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])', code))),
                            'significantLineCount': sum(bool(line.strip()) and not line.lstrip().startswith('#') for line in code.splitlines())})
        assert boundary, ('missing native browser boundary', name)
        report[name] = {'timeoutMinutes': int(timeout.group(1)), 'firstNativeStep': boundary,
                        'prebrowserRunBlockCount': len(entries),
                        'prebrowserSignificantLineCount': sum(entry['significantLineCount'] for entry in entries),
                        'prebrowserRunBlocks': entries, 'nativeCommands': native,
                        'prebrowserCensusSha256': sha(json.dumps(entries, sort_keys=True, separators=(',', ':')).encode())}
    return {'schema': 'infinity-building-batch-prebrowser-census-v1',
            'classification': 'read-only-source-census-not-execution-evidence',
            'workflow': WORKFLOW, 'workflowSha256': sha(raw),
            'sourceSha': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
            'jobs': report,
            'retainedLegacyJobs': list(LEGACY_JOBS),
            'actualAdditionalJobs': [{'id': name, 'timeoutMinutes': report[name]['timeoutMinutes'],
                 'firstNativeStep': report[name]['firstNativeStep'], 'prebrowserRunBlockCount': report[name]['prebrowserRunBlockCount']}
                 for name in acceptance_jobs if name not in LEGACY_JOBS]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = inspect(args.root.resolve())
    raw = json.dumps(report, indent=2, ensure_ascii=False) + '\n'
    if args.output:
        with args.output.open('x', encoding='utf-8') as output:
            output.write(raw)
        print(json.dumps({'output': str(args.output), 'workflowSha256': report['workflowSha256'],
                          'jobs': {name: {key: entry[key] for key in ('prebrowserRunBlockCount', 'prebrowserSignificantLineCount', 'firstNativeStep')}
                                   for name, entry in report['jobs'].items()}}, indent=2))
    else:
        print(raw, end='')


if __name__ == '__main__':
    main()
