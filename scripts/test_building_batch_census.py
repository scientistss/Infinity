"""Fail-closed original-evidence contracts for the new native census."""
import importlib.util
import copy
import io
import zipfile
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('building_batch_census', ROOT / 'scripts/building_batch_census.py')
CENSUS = importlib.util.module_from_spec(spec); spec.loader.exec_module(CENSUS)


class OriginalEvidenceContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def test_reference_reopens_exact_original_bytes(self):
        raw = b'{"complete":"original"}\n'
        (self.root / 'evidence.json').write_bytes(raw)
        reference = {'file': 'evidence.json', 'bytes': len(raw), 'sha256': CENSUS.sha(raw)}
        self.assertEqual(CENSUS.resolve_reference(self.root, reference), raw)
        (self.root / 'evidence.json').write_bytes(raw.replace(b'original', b'rewritten'))
        with self.assertRaises(AssertionError):
            CENSUS.resolve_reference(self.root, reference)

    def test_missing_traversal_absolute_and_symlink_rejected(self):
        raw = b'{}'
        (self.root / 'original.json').write_bytes(raw)
        (self.root / 'alias.json').symlink_to(self.root / 'original.json')
        for name in ('missing.json', '../original.json', str(self.root / 'original.json'), 'alias.json'):
            with self.subTest(name=name), self.assertRaises(AssertionError):
                CENSUS.resolve_reference(self.root, {'file': name, 'bytes': len(raw), 'sha256': CENSUS.sha(raw)})

    def test_length_and_hash_cannot_be_report_only_claims(self):
        raw = b'original'
        (self.root / 'proof.json').write_bytes(raw)
        for digest, size in ((CENSUS.sha(raw), len(raw) + 1), ('0' * 64, len(raw))):
            with self.subTest(digest=digest, size=size), self.assertRaises(AssertionError):
                CENSUS.resolve_reference(self.root, {'file': 'proof.json', 'bytes': size, 'sha256': digest})

    def test_closed_census_covers_all_lifecycle_and_width_branches(self):
        self.assertEqual(len(CENSUS.SCENARIOS), 25)
        self.assertEqual([name for name in CENSUS.SCENARIOS if name.startswith('responsive-')],
                         ['responsive-320', 'responsive-390', 'responsive-768', 'responsive-1440'])
        self.assertTrue({'synthetic-three-planets', 'synthetic-four-planets', 'storage-readback-failure',
                         'ancestor-detach-reinsert', 'active-planet-aba', 'cancelled-import', 'invalid-import'} <= set(CENSUS.SCENARIOS))

    def test_canonical_identity_preserves_fields_types_and_array_order(self):
        left = {'b': 2, 'a': [1, '2']}
        self.assertEqual(CENSUS.canonical(left), CENSUS.canonical({'a': [1, '2'], 'b': 2}))
        for right in ({'a': ['2', 1], 'b': 2}, {'a': [1, 2], 'b': 2}, {'a': [1, '2'], 'b': 2, 'extra': None}):
            self.assertNotEqual(CENSUS.canonical(left), CENSUS.canonical(right))

    def artifact(self):
        expected = '1' * 40
        files = {'src/main.ts': b'export const original = true;'}
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, 'w') as archive:
            archive.comment = expected.encode()
            for name in ('Infinity/', 'Infinity/src/'):
                entry = zipfile.ZipInfo(name); entry.create_system = 0; entry.external_attr = 0x10
                archive.writestr(entry, b'')
            for name, raw in files.items():
                entry = zipfile.ZipInfo('Infinity/' + name); entry.create_system = 0; entry.external_attr = 0x20
                archive.writestr(entry, raw)
        archive_raw = archive_buffer.getvalue()
        (self.root / 'building-batch-source.zip').write_bytes(archive_raw)
        dist = self.root / 'dist'; dist.mkdir()
        asset_files = {'index.html': b'<html>original</html>', **{f'asset-{index}.txt': str(index).encode() for index in range(61)}}
        for name, raw in asset_files.items(): (dist / name).write_bytes(raw)
        release = {'sourceSha': expected, 'version': '0.6.32-alpha.1', 'saveVersion': 9, 'saveRevision': 16,
                   'files': {name: CENSUS.sha(raw) for name, raw in asset_files.items()}}
        release_raw = json.dumps(release).encode(); (dist / 'release.json').write_bytes(release_raw)
        common = {'sourceZipSha256': CENSUS.sha(archive_raw), 'source': {'sourceCode': {name: CENSUS.sha(raw) for name, raw in files.items()},
                  'sourceModes': {name: '100644' for name in files}}, 'assets': {**release['files'], 'release.json': CENSUS.sha(release_raw)}}
        (self.root / 'common-identity.json').write_text(json.dumps({'identity': common}))
        result = {'completeCommonIdentity': 'a' * 64, 'fixtureSha256': 'b' * 64, 'releaseSha256': CENSUS.sha(release_raw), 'version': release['version']}
        names = ('verify', 'verify-continuation', 'npc-orbital', 'scout-rehearsal', 'lab-blockers', 'manual-unit-payments', 'manual-unit-authority', 'building-batch', 'energy-controls', 'energy-lifecycle', 'energy-migration')
        jobs = {name: {'result': 'success', 'outputs': {}} for name in names}
        jobs['building-batch']['outputs'] = {'common-identity-sha256': result['completeCommonIdentity'], 'building-batch-fixture-sha256': result['fixtureSha256'], 'building-batch-census-sha256': CENSUS.sha(CENSUS.canonical(result))}
        return expected, result, jobs, common

    def test_complete_original_source_modes_assets_and_real_outputs_pass(self):
        expected, result, jobs, _ = self.artifact()
        CENSUS.verify_original_artifact(self.root, result, expected, jobs)

    def test_unknown_missing_failed_jobs_and_wrong_output_refuse(self):
        expected, result, jobs, _ = self.artifact()
        mutations = [lambda j: j.update(extra={'result': 'success', 'outputs': {}}),
                     lambda j: j.pop('verify'), lambda j: j['verify'].update(result='skipped'),
                     lambda j: j['building-batch']['outputs'].update(extra='ignored'),
                     lambda j: j['building-batch']['outputs'].update({'common-identity-sha256': '0' * 64}),
                     lambda j: j['building-batch']['outputs'].update({'building-batch-fixture-sha256': '0' * 64}),
                     lambda j: j['building-batch']['outputs'].update({'building-batch-census-sha256': '0' * 64})]
        for mutation in mutations:
            changed = copy.deepcopy(jobs); mutation(changed)
            with self.assertRaises(AssertionError): CENSUS.verify_original_artifact(self.root, result, expected, changed)

    def test_every_new_job_is_required_and_must_succeed(self):
        expected, result, jobs, _ = self.artifact()
        self.assertEqual(len(jobs), 11)
        for name in jobs:
            for status in ('failure', 'cancelled', 'skipped', 'in_progress', '', None):
                changed = copy.deepcopy(jobs); changed[name]['result'] = status
                with self.subTest(job=name, status=status), self.assertRaises(AssertionError):
                    CENSUS.verify_original_artifact(self.root, result, expected, changed)
            changed = copy.deepcopy(jobs); del changed[name]
            with self.subTest(job=name, missing=True), self.assertRaises(AssertionError):
                CENSUS.verify_original_artifact(self.root, result, expected, changed)

    def test_retagged_old_or_future_release_is_not_current(self):
        expected, result, jobs, common = self.artifact()
        release_path = self.root / 'dist/release.json'
        baseline = json.loads(release_path.read_bytes())
        for field, value in (('saveRevision', 14), ('saveRevision', 15), ('saveRevision', 17), ('version', '0.6.31-alpha.1')):
            release = copy.deepcopy(baseline); release[field] = value
            raw = json.dumps(release).encode(); release_path.write_bytes(raw)
            changed_common = copy.deepcopy(common); changed_common['assets']['release.json'] = CENSUS.sha(raw)
            (self.root / 'common-identity.json').write_text(json.dumps({'identity': changed_common}))
            changed_result = copy.deepcopy(result); changed_result['releaseSha256'] = CENSUS.sha(raw)
            changed_result['version'] = release['version']
            changed_jobs = copy.deepcopy(jobs)
            changed_jobs['building-batch']['outputs']['building-batch-census-sha256'] = CENSUS.sha(CENSUS.canonical(changed_result))
            with self.subTest(field=field, value=value), self.assertRaises(AssertionError):
                CENSUS.verify_original_artifact(self.root, changed_result, expected, changed_jobs)

    def test_source_mode_or_dist_byte_change_cannot_be_hidden(self):
        expected, result, jobs, common = self.artifact()
        changed = copy.deepcopy(common); changed['source']['sourceModes']['src/main.ts'] = '100755'
        (self.root / 'common-identity.json').write_text(json.dumps({'identity': changed}))
        with self.assertRaises(AssertionError): CENSUS.verify_original_artifact(self.root, result, expected, jobs)
        (self.root / 'common-identity.json').write_text(json.dumps({'identity': common}))
        (self.root / 'dist/index.html').write_text('different production bytes')
        with self.assertRaises(AssertionError): CENSUS.verify_original_artifact(self.root, result, expected, jobs)

    def test_duplicate_zip_member_and_symlink_mode_refuse(self):
        expected, result, jobs, common = self.artifact()
        for duplicate in (False, True):
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive:
                archive.comment = expected.encode()
                entry = zipfile.ZipInfo('Infinity/src/main.ts'); entry.create_system = 3; entry.external_attr = (0o120777 if not duplicate else 0o100644) << 16
                archive.writestr(entry, b'export const original = true;')
                if duplicate:
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore'); archive.writestr(entry, b'export const original = true;')
            raw = data.getvalue(); (self.root / 'building-batch-source.zip').write_bytes(raw)
            changed = copy.deepcopy(common); changed['sourceZipSha256'] = CENSUS.sha(raw)
            (self.root / 'common-identity.json').write_text(json.dumps({'identity': changed}))
            with self.assertRaises(AssertionError): CENSUS.verify_original_artifact(self.root, result, expected, jobs)

    def test_aggregate_recomputes_instead_of_trusting_census_flags(self):
        source = (ROOT / 'scripts/building_batch_census.py').read_text()
        self.assertIn("assert load(root / 'building-batch-census.json') == result", source)
        self.assertIn("fixture_oracle(fixture, fixture_path.parent)", source)
        self.assertIn("resolve_reference(report_path.parent, reference)", source)
        self.assertIn("snapshots[label]['state'] == expected_state", source)
        self.assertIn("source['httpSha256'] == source['v8Sha256'] == source['releaseSha256']", source)
        self.assertIn("common['identitySha256'] == sha(canonical(common['identity']))", source)


if __name__ == '__main__':
    unittest.main()
