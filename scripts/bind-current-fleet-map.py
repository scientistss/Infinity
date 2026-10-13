#!/usr/bin/env python3
"""Bind an offline V3 map to the unchanged, pinned 7ab production release.

No build, browser, network, or production instrumentation is performed. Map
positions are zero-based UTF-16 coordinates and identify mapping segment starts,
not exact function boundaries or exclusive native execution time.
"""
import argparse
from bisect import bisect_right
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


TARGET_SHA = '7ab569045996a1a6ad8ce1aee477092144dfad74'
RELEASE_SHA256 = 'c9411d7c952c217feb5c796d8c0653877ae650caa67fdc17941cfa2ce6c92e6f'
ASSET_COUNT = 62
TARGET_JS = {'assets/index-B7y-m5_J.js': '84480c365eb3d5dd45b9b7552c8e3d9439195f2eae8db36906dfc5b75a4866ff'}
TARGET_CSS = {'assets/index-Dxlsq7ae.css': '933b22bb315129b2869c408736a9602a0180312aa2d5d053fb44e2208a02f8ed'}
DEPENDENCIES = {
    'pad-end': ('index.js', '063c31f8b5eeb14835a8a358b0dc0099528a5b4719b25057db9e48c752f9c330'),
    'break_infinity.js': ('dist/break_infinity.esm.js', '1e1825ab4fa711c16fc7225790d0163cf6b5f5611ab77b39cbb2cd381cb8f71a'),
}
BASE64 = {char: value for value, char in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/')}
LIMIT = 32 * 1024 * 1024


class BindingError(ValueError):
    pass


def require(value, message):
    if not value:
        raise BindingError(message)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def load_json(body):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    try:
        return json.loads(body, object_pairs_hook=unique,
                          parse_constant=lambda value: (_ for _ in ()).throw(BindingError('Non-finite JSON value')))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise BindingError('Invalid UTF-8 JSON') from exc


def git(repo, *args):
    result = subprocess.run(['git', '--no-optional-locks', '-C', str(repo), *args],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    require(result.returncode == 0, 'Git operation failed: ' + ' '.join(args))
    return result.stdout


def verify_checkout(repo):
    require(git(repo, 'rev-parse', '--show-toplevel').decode().strip() == str(repo), 'Target is not the repository root')
    require(git(repo, 'rev-parse', 'HEAD').decode().strip() == TARGET_SHA, 'Target HEAD is not pinned 7ab')
    branch = subprocess.run(['git', '-C', str(repo), 'symbolic-ref', '-q', 'HEAD'], capture_output=True)
    require(branch.returncode == 1, 'Target HEAD must be detached')
    require(not git(repo, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'),
            'Target checkout is not clean')


def regular_file(root, relative):
    require(isinstance(relative, str) and relative and '\\' not in relative and '\x00' not in relative,
            'Unsafe asset path')
    parts = relative.split('/')
    require(not relative.startswith('/') and all(p not in ('', '.', '..') for p in parts), 'Unsafe asset path')
    cursor = root
    for part in parts:
        cursor = cursor / part
        require(not cursor.is_symlink(), 'Symlink is not allowed for asset/source: ' + relative)
    require(cursor.is_file() and cursor.resolve().is_relative_to(root), 'Missing or escaping file: ' + relative)
    require(cursor.stat().st_size <= LIMIT, 'File exceeds size bound: ' + relative)
    return cursor


def inventory(root):
    require(root.is_dir() and not root.is_symlink(), 'Missing or symlinked distribution directory')
    paths = set()
    for parent, dirs, files in os.walk(root, followlinks=False):
        for name in dirs + files:
            require(not (Path(parent) / name).is_symlink(), 'Distribution contains a symlink')
        paths.update(str((Path(parent) / name).relative_to(root)) for name in files)
    return paths


def verify_release(repo, mapping_dist):
    dist = repo / 'dist'
    manifest_body = regular_file(dist, 'release.json').read_bytes()
    require(digest(manifest_body) == RELEASE_SHA256, 'Release manifest hash does not match pin')
    manifest = load_json(manifest_body)
    require(manifest.get('sourceSha') == TARGET_SHA, 'Release source SHA differs')
    files = manifest.get('files')
    require(isinstance(files, dict) and len(files) == ASSET_COUNT, 'Release asset count differs')
    require(inventory(dist) == set(files) | {'release.json'}, 'Production distribution inventory differs')
    expected_maps = {name + '.map' for name in TARGET_JS}
    require(inventory(mapping_dist) == set(files) | expected_maps, 'Mapping distribution inventory differs')
    for name, expected in files.items():
        require(isinstance(expected, str) and re.fullmatch('[0-9a-f]{64}', expected), 'Invalid release asset hash')
        production = regular_file(dist, name).read_bytes()
        require(digest(production) == expected, 'Production asset hash differs: ' + name)
        debug = regular_file(mapping_dist, name).read_bytes()
        require(debug == production, 'Mapping build asset differs from production: ' + name)
    for name, expected in (TARGET_JS | TARGET_CSS).items():
        require(files.get(name) == expected, 'Pinned JS/CSS identity differs: ' + name)
    require({name for name in files if name.endswith('.js')} == set(TARGET_JS), 'Unbound executable JavaScript')
    require({name for name in files if name.endswith('.css')} == set(TARGET_CSS), 'Unbound CSS')
    return manifest


def tracked_sources(repo):
    rows = {}
    for record in git(repo, 'ls-tree', '-rz', '--full-tree', TARGET_SHA, '--', 'src', 'package-lock.json').split(b'\0'):
        if not record:
            continue
        metadata, raw_name = record.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split(' ')
        name = raw_name.decode('utf-8')
        require(mode in ('100644', '100755') and kind == 'blob', 'Unsupported tracked source kind: ' + name)
        path = regular_file(repo, name)
        body = git(repo, 'cat-file', 'blob', blob)
        require(path.read_bytes() == body, 'Working source differs from Git blob: ' + name)
        rows[path.resolve()] = {'normalizedSource': name, 'kind': 'git-blob', 'gitBlob': blob,
                                'sha256': digest(body), 'bytes': len(body), '_body': body}
    require(repo / 'package-lock.json' in rows, 'Missing tracked package-lock.json')
    return rows


def registered_dependencies(repo, tracked):
    lock_row = tracked[repo / 'package-lock.json']
    lock = load_json(lock_row['_body'])
    require(lock.get('lockfileVersion') == 3 and isinstance(lock.get('packages'), dict), 'Unsupported committed lock')
    # This explicitly registers the target's existing installation, including a
    # shared node_modules symlink. No map path itself can register another root.
    node_modules = (repo / 'node_modules').resolve(strict=True)
    require(node_modules.is_dir() and node_modules.name == 'node_modules', 'Invalid registered node_modules root')
    installed_lock_body = regular_file(node_modules, '.package-lock.json').read_bytes()
    installed_lock = load_json(installed_lock_body)
    require(installed_lock.get('lockfileVersion') == 3 and isinstance(installed_lock.get('packages'), dict),
            'Unsupported installed lock')
    result = {}
    for package, (file, pinned_hash) in DEPENDENCIES.items():
        key = 'node_modules/' + package
        entry, installed = lock['packages'].get(key), installed_lock['packages'].get(key)
        require(isinstance(entry, dict) and isinstance(installed, dict), 'Dependency absent from lock: ' + package)
        for field in ('version', 'resolved', 'integrity'):
            require(isinstance(entry.get(field), str) and entry[field] and installed.get(field) == entry[field],
                    'Installed dependency lock identity differs: ' + package + ':' + field)
        require(entry['resolved'].startswith('https://registry.npmjs.org/' + package + '/-/'),
                'Dependency is not from its registered npm package')
        require(entry['integrity'].startswith('sha512-'), 'Missing dependency integrity')
        package_body = regular_file(node_modules, package + '/package.json').read_bytes()
        metadata = load_json(package_body)
        require(metadata.get('name') == package and metadata.get('version') == entry['version'],
                'Installed package metadata differs: ' + package)
        path = regular_file(node_modules, package + '/' + file)
        body = path.read_bytes()
        require(digest(body) == pinned_hash, 'Installed dependency bytes differ from pin: ' + package)
        result[path.resolve()] = {
            'normalizedSource': key + '/' + file, 'kind': 'installed-dependency',
            'package': package, 'version': entry['version'], 'resolved': entry['resolved'],
            'integrity': entry['integrity'], 'packageJsonSha256': digest(package_body),
            'committedLockGitBlob': lock_row['gitBlob'], 'committedLockSha256': lock_row['sha256'],
            'installedLockSha256': digest(installed_lock_body),
            'sha256': digest(body), 'bytes': len(body), '_body': body,
        }
    return result


def source_identity(map_path, raw_source, allowed):
    require(isinstance(raw_source, str) and raw_source, 'Invalid source name')
    require(not any(char in raw_source for char in ('\\', '\x00', ':', '?', '#', '%')),
            'Unsupported source URL/path syntax')
    require(not PurePosixPath(raw_source).is_absolute(), 'Absolute map source is unsupported')
    # Vite emits leading ../ segments for an out-of-tree map. Allow these only
    # when canonical resolution ends at an explicitly registered exact file.
    try:
        path = (map_path.parent / raw_source).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise BindingError('Unresolvable map source') from exc
    require(Path(os.path.abspath(map_path.parent / raw_source)) == path,
            'Unregistered symlink alias in map source')
    require(path in allowed, 'Unbound or escaping map source: ' + raw_source)
    return allowed[path]


def utf16_lines(text):
    return [len(line.encode('utf-16-le')) // 2 for line in re.split(r'\r\n|[\r\n\u2028\u2029]', text)]


def decode_vlq(segment):
    values, value, shift = [], 0, 0
    for char in segment:
        require(char in BASE64, 'Unsupported mapping character')
        digit = BASE64[char]
        value |= (digit & 31) << shift
        if digit & 32:
            shift += 5
            require(shift <= 30, 'Mapping VLQ exceeds supported 32-bit range')
        else:
            require(value <= 0xffffffff, 'Mapping VLQ exceeds supported 32-bit range')
            require(value != 1, 'Ambiguous negative-zero VLQ')
            require(not shift or digit, 'Noncanonical mapping VLQ')
            values.append(-(value >> 1) if value & 1 else value >> 1)
            value, shift = 0, 0
    require(shift == 0, 'Truncated mapping VLQ')
    require(len(values) in (1, 4, 5), 'Unsupported mapping segment arity')
    return values


class SourceMapIndex:
    """Strict V3 ordinary map decoder. No indexed maps or URL fetching."""

    def __init__(self, source_map, generated):
        require(type(source_map.get('version')) is int and source_map['version'] == 3, 'Unsupported map version')
        require(set(source_map) <= {'version', 'file', 'sourceRoot', 'sources', 'sourcesContent', 'names',
                                    'mappings', 'x_google_ignoreList'}, 'Unsupported source-map field or indexed map')
        require(source_map.get('sourceRoot', '') == '', 'Nonempty sourceRoot is unsupported')
        sources, content, names = (source_map.get(key) for key in ('sources', 'sourcesContent', 'names'))
        require(isinstance(sources, list) and sources and all(isinstance(s, str) and s for s in sources), 'Missing map sources')
        require(len(set(sources)) == len(sources), 'Duplicate map source names')
        require(isinstance(content, list) and len(content) == len(sources)
                and all(isinstance(s, str) for s in content), 'Missing or invalid sourcesContent')
        require(isinstance(names, list) and all(isinstance(n, str) for n in names), 'Invalid map names')
        ignore = source_map.get('x_google_ignoreList', [])
        require(isinstance(ignore, list) and all(type(n) is int and 0 <= n < len(sources) for n in ignore)
                and len(set(ignore)) == len(ignore), 'Invalid ignore-list indexes')
        mappings = source_map.get('mappings')
        require(isinstance(mappings, str) and mappings, 'Missing map mappings')
        self.source_map = source_map
        self.generated_lengths = utf16_lines(generated)
        source_lengths = [utf16_lines(text) for text in content]
        lines = mappings.split(';')
        require(len(lines) <= len(self.generated_lengths), 'Mapping exceeds generated line count')
        self.lines, self.columns, self.mapped_sources = [], [], set()
        source = original_line = original_column = name = 0
        self.segment_count = 0
        for line_number, line in enumerate(lines):
            rows, columns, generated_column = [], [], 0
            for segment in line.split(',') if line else []:
                require(segment, 'Empty mapping segment')
                values = decode_vlq(segment)
                require(values[0] >= 0, 'Generated columns move backwards')
                generated_column += values[0]
                require(not columns or generated_column > columns[-1], 'Ambiguous duplicate generated position')
                require(generated_column <= self.generated_lengths[line_number], 'Mapping exceeds generated column count')
                row = None
                if len(values) > 1:
                    source += values[1]
                    original_line += values[2]
                    original_column += values[3]
                    require(0 <= source < len(sources), 'Mapping source index is out of bounds')
                    require(0 <= original_line < len(source_lengths[source]), 'Original line is out of bounds')
                    require(0 <= original_column <= source_lengths[source][original_line], 'Original column is out of bounds')
                    row = {'sourceIndex': source, 'originalLine': original_line, 'originalColumn': original_column}
                    if len(values) == 5:
                        name += values[4]
                        require(0 <= name < len(names), 'Mapping name index is out of bounds')
                        row['name'] = names[name]
                    self.mapped_sources.add(source)
                rows.append(row)
                columns.append(generated_column)
                self.segment_count += 1
            self.lines.append(rows)
            self.columns.append(columns)
        require(self.mapped_sources, 'Map contains no bound mappings')

    def locate(self, line, column):
        require(type(line) is int and type(column) is int and line >= 0 and column >= 0, 'Coordinates must be nonnegative integers')
        require(line < len(self.generated_lengths) and column <= self.generated_lengths[line], 'Generated coordinate is out of bounds')
        if line >= len(self.lines):
            return None
        at = bisect_right(self.columns[line], column) - 1
        if at < 0 or self.lines[line][at] is None:
            return None
        row = dict(self.lines[line][at])
        row.update({'source': self.source_map['sources'][row['sourceIndex']],
                    'generatedLine': line, 'generatedColumn': column,
                    'mappingGeneratedColumn': self.columns[line][at],
                    'exactSegmentStart': column == self.columns[line][at], 'coordinates': 'zero-based UTF-16'})
        return row


def bind_map(repo, mapping_dist):
    repo, mapping_dist = Path(repo).resolve(strict=True), Path(mapping_dist).resolve(strict=True)
    verify_checkout(repo)
    manifest = verify_release(repo, mapping_dist)
    tracked = tracked_sources(repo)
    dependencies = registered_dependencies(repo, tracked)
    allowed = {path: row for path, row in tracked.items() if row['normalizedSource'].startswith('src/')}
    allowed.update(dependencies)
    maps, raw_maps, indexes = [], {}, {}
    for asset, asset_hash in TARGET_JS.items():
        map_name = asset + '.map'
        map_path = regular_file(mapping_dist, map_name)
        raw = map_path.read_bytes()
        source_map = load_json(raw)
        require(isinstance(source_map, dict), 'Map root must be an object')
        require(source_map.get('file') == Path(asset).name, 'Map file does not name its executed bundle')
        generated = regular_file(repo / 'dist', asset).read_bytes().decode('utf-8')
        require('sourceMappingURL=' not in generated, 'Production bundle unexpectedly loads a source map')
        index = SourceMapIndex(source_map, generated)
        bindings, seen = [], set()
        for i, (source, content) in enumerate(zip(source_map['sources'], source_map['sourcesContent'])):
            row = source_identity(map_path, source, allowed)
            require(row['normalizedSource'] not in seen, 'Ambiguous aliases for the same source')
            seen.add(row['normalizedSource'])
            require(content.encode('utf-8') == row['_body'], 'sourcesContent differs from bound bytes: ' + row['normalizedSource'])
            bindings.append({key: value for key, value in row.items() if key != '_body'} |
                            {'sourceIndex': i, 'rawSource': source, 'referencedByMappings': i in index.mapped_sources})
        require(set(dependencies[path]['normalizedSource'] for path in dependencies) <= seen,
                'Expected registered dependencies are not bound')
        maps.append({'asset': asset, 'executedAssetSha256': asset_hash, 'rawMap': map_name,
                     'rawMapSha256': digest(raw), 'rawMapBytes': len(raw), 'sourceCount': len(bindings),
                     'mappingSegments': index.segment_count, 'sources': bindings})
        raw_maps[map_name] = raw
        indexes[asset] = index
    verify_checkout(repo)
    summary = {
        'schema': 'current-fleet-map-binding-v1', 'valid': True, 'targetSha': TARGET_SHA,
        'releaseSha256': RELEASE_SHA256, 'verifiedAssetCount': len(manifest['files']),
        'assets': manifest['files'], 'maps': maps, 'bindingScope':
        'Every production asset equals its pinned release manifest and the offline mapping build byte-for-byte. '
        'Every embedded source equals a target Git blob or an explicitly registered, pinned installed dependency '
        'with matching committed and installed lock identity. Raw maps are preserved unchanged.',
        'limitations': [
            'This is offline source/asset identity and mapping-format validation. It does not independently prove compiler mapping semantics.',
            'Dependency integrity fields identify the committed npm lock; no registry tarball was fetched or reverified.',
            'Mappings identify segment starts using zero-based UTF-16 coordinates; a lookup between starts uses the preceding segment on that line.',
            'CPU sample weights are statistical attribution, not exact elapsed time or exclusive native call costs.',
        ],
    }
    return summary, raw_maps, indexes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target-repo', required=True, type=Path)
    parser.add_argument('--mapping-dist', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New directory for binding.json and unchanged raw maps')
    parser.add_argument('--position', action='append', default=[], help='Optional zero-based generated LINE:COLUMN')
    args = parser.parse_args()
    try:
        output = args.output.resolve()
        require(not output.exists(), 'Output must be a new directory')
        require(not output.is_relative_to(args.target_repo.resolve()) and not output.is_relative_to(args.mapping_dist.resolve()),
                'Output cannot be inside either verified input')
        summary, raw_maps, indexes = bind_map(args.target_repo, args.mapping_dist)
        if args.position:
            require(len(indexes) == 1, 'Position lookup requires one executed bundle')
            asset, index = next(iter(indexes.items()))
            summary['positionLookups'] = []
            for coordinate in args.position:
                require(re.fullmatch(r'\d+:\d+', coordinate), 'Position must be LINE:COLUMN')
                line, column = map(int, coordinate.split(':'))
                result = index.locate(line, column)
                if result is not None:
                    result['normalizedSource'] = summary['maps'][0]['sources'][result['sourceIndex']]['normalizedSource']
                summary['positionLookups'].append({'asset': asset, 'line': line, 'column': column, 'mapping': result})
        output.mkdir(parents=True, exist_ok=False)
        for name, raw in raw_maps.items():
            path = output / name
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as handle:
                handle.write(raw)
            require(path.read_bytes() == raw, 'Raw map retention failed')
        with (output / 'binding.json').open('x', encoding='utf-8') as handle:
            json.dump(summary, handle, ensure_ascii=False, indent=2)
            handle.write('\n')
        print(json.dumps({'valid': True, 'binding': str(output / 'binding.json'),
                          'assetCount': summary['verifiedAssetCount'],
                          'maps': [{key: row[key] for key in ('rawMapSha256', 'sourceCount', 'mappingSegments')} for row in summary['maps']]}))
    except (BindingError, OSError, UnicodeError) as exc:
        print(json.dumps({'valid': False, 'error': str(exc)}), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
