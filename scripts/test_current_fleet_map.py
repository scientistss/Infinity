#!/usr/bin/env python3
"""Offline, standard-library tests. Uses temporary synthetic Git repositories."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('fleet_map', Path(__file__).with_name('bind-current-fleet-map.py'))
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode())


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fleet-map-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'target'
        self.repo.mkdir()
        self.mapping = self.base / 'mapping'
        self.js = 'assets/main.js'
        self.map_path = self.mapping / (self.js + '.map')
        self.node_modules = self.base / 'shared/node_modules'
        self.node_modules.mkdir(parents=True)
        (self.repo / 'node_modules').symlink_to(self.node_modules, target_is_directory=True)
        write(self.repo / '.gitignore', 'dist/\nnode_modules\n')
        write(self.repo / 'src/main.ts', 'const main = 1;\n')
        deps, packages = {}, {}
        for package, file, body in [('pad-end', 'index.js', 'const pad = 2;\n'),
                                     ('break_infinity.js', 'dist/break_infinity.esm.js', 'const infinity = 3;\n')]:
            deps[package] = (file, M.digest(body.encode()))
            packages['node_modules/' + package] = {
                'version': '1.0.0', 'resolved': 'https://registry.npmjs.org/' + package + '/-/' + package + '-1.0.0.tgz',
                'integrity': 'sha512-synthetic-fixture-identity',
            }
            write(self.node_modules / package / file, body)
            write(self.node_modules / package / 'package.json', json.dumps({'name': package, 'version': '1.0.0'}))
        lock = json.dumps({'lockfileVersion': 3, 'packages': packages})
        write(self.repo / 'package-lock.json', lock)
        write(self.node_modules / '.package-lock.json', lock)
        for args in (['init', '-q'], ['add', '.'],
                     ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'],
                     ['checkout', '-q', '--detach']):
            subprocess.run(['git', '-C', str(self.repo), *args], check=True, capture_output=True)
        target_sha = M.git(self.repo, 'rev-parse', 'HEAD').decode().strip()
        assets = {self.js: b'main(); pad(); infinity();\n', 'assets/main.css': b'body{}\n'}
        assets.update({f'icons/{n:02}.txt': str(n).encode() for n in range(60)})
        files = {name: M.digest(body) for name, body in assets.items()}
        for name, body in assets.items():
            write(self.repo / 'dist' / name, body)
            write(self.mapping / name, body)
        manifest = json.dumps({'sourceSha': target_sha, 'files': files}).encode()
        write(self.repo / 'dist/release.json', manifest)
        self.pins = patch.multiple(M, TARGET_SHA=target_sha, RELEASE_SHA256=M.digest(manifest),
                                   TARGET_JS={self.js: files[self.js]}, TARGET_CSS={'assets/main.css': files['assets/main.css']},
                                   DEPENDENCIES=deps)
        self.pins.start()
        self.addCleanup(self.pins.stop)
        source_paths = [self.repo / 'src/main.ts', self.node_modules / 'pad-end/index.js',
                        self.node_modules / 'break_infinity.js/dist/break_infinity.esm.js']
        self.source_map = {'version': 3, 'file': 'main.js',
                           'sources': [os.path.relpath(p, self.map_path.parent) for p in source_paths],
                           'sourcesContent': [p.read_text() for p in source_paths], 'names': [],
                           'mappings': 'AAAA,QCAA,MCAA', 'x_google_ignoreList': [1, 2]}
        self.save_map()

    def save_map(self):
        write(self.map_path, json.dumps(self.source_map))

    def bind(self):
        return M.bind_map(self.repo, self.mapping)

    def rejects(self, pattern):
        with self.assertRaisesRegex(M.BindingError, pattern):
            self.bind()

    def test_positive_exact_asset_source_and_lock_binding(self):
        summary, retained, indexes = self.bind()
        self.assertTrue(summary['valid'])
        self.assertEqual(summary['verifiedAssetCount'], 62)
        row = summary['maps'][0]
        self.assertEqual(row['sourceCount'], 3)
        self.assertEqual(row['mappingSegments'], 3)
        self.assertEqual(row['sources'][0]['kind'], 'git-blob')
        self.assertEqual(row['sources'][1]['kind'], 'installed-dependency')
        self.assertEqual(row['sources'][1]['committedLockSha256'], M.digest((self.repo / 'package-lock.json').read_bytes()))
        self.assertEqual(retained[self.js + '.map'], self.map_path.read_bytes())
        self.assertEqual(row['rawMapSha256'], M.digest(retained[self.js + '.map']))
        self.assertEqual(indexes[self.js].locate(0, 9)['sourceIndex'], 1)

    def test_changed_production_bundle(self):
        write(self.repo / 'dist' / self.js, 'changed')
        self.rejects('Production asset hash differs')

    def test_changed_debug_bundle(self):
        write(self.mapping / self.js, 'changed')
        self.rejects('Mapping build asset differs')

    def test_changed_css(self):
        write(self.mapping / 'assets/main.css', 'changed')
        self.rejects('Mapping build asset differs')

    def test_changed_other_asset(self):
        write(self.repo / 'dist/icons/00.txt', 'changed')
        self.rejects('Production asset hash differs')

    def test_changed_manifest(self):
        write(self.repo / 'dist/release.json', '{}')
        self.rejects('Release manifest hash')

    def test_extra_production_asset(self):
        write(self.repo / 'dist/extra.js', 'extra')
        self.rejects('Production distribution inventory')

    def test_extra_debug_asset(self):
        write(self.mapping / 'extra.js', 'extra')
        self.rejects('Mapping distribution inventory')

    def test_untracked_target_file(self):
        write(self.repo / 'extra.txt', 'extra')
        self.rejects('not clean')

    def test_changed_working_source(self):
        write(self.repo / 'src/main.ts', 'changed')
        self.rejects('not clean')

    def test_changed_embedded_source(self):
        self.source_map['sourcesContent'][0] += '// changed\n'
        self.save_map()
        self.rejects('sourcesContent differs')

    def test_missing_content(self):
        self.source_map['sourcesContent'][1] = None
        self.save_map()
        self.rejects('sourcesContent')

    def test_wrong_target_head(self):
        with patch.object(M, 'TARGET_SHA', '0' * 40):
            self.rejects('HEAD is not pinned')

    def test_target_head_must_be_detached(self):
        subprocess.run(['git', '-C', str(self.repo), 'checkout', '-qb', 'unexpected-branch'], check=True, capture_output=True)
        self.rejects('must be detached')

    def test_map_traversal_to_unregistered_file(self):
        write(self.base / 'secret.ts', self.source_map['sourcesContent'][0])
        self.source_map['sources'][0] = '../../secret.ts'
        self.save_map()
        self.rejects('Unbound or escaping map source')

    def test_unregistered_symlink_alias(self):
        (self.base / 'alias.ts').symlink_to(self.repo / 'src/main.ts')
        self.source_map['sources'][0] = '../../alias.ts'
        self.save_map()
        self.rejects('Unregistered symlink alias')

    def test_unknown_dependency(self):
        write(self.node_modules / 'unknown/index.js', self.source_map['sourcesContent'][1])
        self.source_map['sources'][1] = '../../shared/node_modules/unknown/index.js'
        self.save_map()
        self.rejects('Unbound or escaping map source')

    def test_duplicate_normalized_source(self):
        self.source_map['sources'][1] = '../../target/src/../src/main.ts'
        self.source_map['sourcesContent'][1] = self.source_map['sourcesContent'][0]
        self.save_map()
        self.rejects('Ambiguous aliases')

    def test_map_names_another_bundle(self):
        self.source_map['file'] = 'wrong.js'
        self.save_map()
        self.rejects('executed bundle')

    def test_changed_installed_dependency(self):
        write(self.node_modules / 'pad-end/index.js', 'changed')
        self.rejects('Installed dependency bytes differ')

    def test_changed_dependency_lock(self):
        path = self.node_modules / '.package-lock.json'
        lock = json.loads(path.read_bytes())
        lock['packages']['node_modules/pad-end']['integrity'] = 'sha512-changed'
        write(path, json.dumps(lock))
        self.rejects('lock identity differs')

    def test_changed_dependency_metadata(self):
        write(self.node_modules / 'pad-end/package.json', '{"name":"pad-end","version":"9.9.9"}')
        self.rejects('package metadata differs')

    def test_symlinked_asset(self):
        path = self.mapping / self.js
        path.unlink()
        path.symlink_to(self.repo / 'dist' / self.js)
        self.rejects('symlink')

    def test_unsupported_mapping(self):
        self.source_map['mappings'] = 'AA'
        self.save_map()
        self.rejects('Unsupported mapping segment arity')


class MappingTests(unittest.TestCase):
    def setUp(self):
        self.example = {'version': 3, 'file': 'test.js', 'sources': ['src/test.ts'],
                        'sourcesContent': ['0123456789\nsecond\n'], 'names': ['sample'],
                        'mappings': 'AAAAA,EAAE,E;AACA'}

    def test_zero_based_segment_lookup_and_unmapped_gap(self):
        index = M.SourceMapIndex(self.example, 'abcdef\nsecond\n')
        self.assertEqual(index.locate(0, 0)['name'], 'sample')
        self.assertTrue(index.locate(0, 2)['exactSegmentStart'])
        between = index.locate(0, 3)
        self.assertFalse(between['exactSegmentStart'])
        self.assertEqual(between['originalColumn'], 2)
        self.assertEqual(between['mappingGeneratedColumn'], 2)
        self.assertIsNone(index.locate(0, 4))
        self.assertEqual(index.locate(1, 0)['originalLine'], 1)
        self.assertEqual(index.locate(1, 0)['originalColumn'], 2)
        self.assertIsNone(index.locate(2, 0))

    def test_utf16_coordinates(self):
        example = copy.deepcopy(self.example)
        example['sourcesContent'] = ['😀x']
        example['mappings'] = 'AAAA,EAAE'
        index = M.SourceMapIndex(example, '😀x')
        self.assertEqual(index.locate(0, 3)['originalColumn'], 2)
        with self.assertRaisesRegex(M.BindingError, 'out of bounds'):
            index.locate(0, 4)

    def test_malformed_maps_fail_closed(self):
        for change in [
            {'version': 2}, {'version': True}, {'sections': []}, {'sourceRoot': '/outside'},
            {'sourcesContent': []}, {'sourcesContent': [None]}, {'names': [1]},
            {'x_google_ignoreList': [True]}, {'x_google_ignoreList': [0, 0]},
            {'mappings': '?'}, {'mappings': 'AA'}, {'mappings': 'g'}, {'mappings': 'gA'},
            {'mappings': 'B'}, {'mappings': 'AAAA,AAAA'}, {'mappings': 'CAAA,DAAA'},
            {'mappings': 'ACAA'}, {'mappings': 'AAGA'}, {'mappings': 'AAAW'},
            {'mappings': 'AAAAC'}, {'mappings': 'AAAA,'}, {'mappings': ''},
            {'mappings': 'AAAA;;;;'}, {'mappings': 'oBAAA'}, {'mappings': 'A'},
        ]:
            with self.subTest(change=change):
                source_map = copy.deepcopy(self.example)
                source_map.update(change)
                with self.assertRaises(M.BindingError):
                    M.SourceMapIndex(source_map, 'abcdef\nsecond\n')

    def test_bad_coordinates(self):
        index = M.SourceMapIndex(self.example, 'abcdef\nsecond\n')
        for line, column in [(-1, 0), (0, -1), (True, 0), (0, 1.5), (99, 0), (0, 99)]:
            with self.subTest(line=line, column=column), self.assertRaises(M.BindingError):
                index.locate(line, column)

    def test_duplicate_json_and_nonfinite_values(self):
        for body in [b'{"version":3,"version":2}', b'{"number":NaN}', b'not json']:
            with self.subTest(body=body), self.assertRaises(M.BindingError):
                M.load_json(body)


if __name__ == '__main__':
    unittest.main()
