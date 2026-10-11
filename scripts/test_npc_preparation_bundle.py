import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('preparation_bundle', Path(__file__).with_name('verify-npc-preparation-bundle.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class BundleIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base, self.candidate = [Path(self.temp.name) / name for name in ('base', 'candidate')]
        for root in (self.base, self.candidate):
            (root / 'assets').mkdir(parents=True)
            (root / 'index.html').write_text('<script src="assets/app.js"></script>')
            (root / 'assets/app.js').write_bytes(b'console.log("exact");')
            (root / 'release.json').write_text('{}')

    def test_equal(self):
        self.assertTrue(MODULE.compare(self.base, self.candidate)['passed'])

    def test_only_explicit_release_identity_may_differ(self):
        (self.candidate / 'release.json').write_text('{"identity":"candidate"}')
        result = MODULE.compare(self.base, self.candidate)
        self.assertTrue(result['passed'])
        self.assertEqual(result['exclusions'], ['release.json'])

    def test_changed_javascript_rejected(self):
        (self.candidate / 'assets/app.js').write_bytes(b'console.log("changed");')
        self.assertEqual(MODULE.compare(self.base, self.candidate)['differences'], ['assets/app.js'])

    def test_new_file_rejected_even_if_not_referenced(self):
        (self.candidate / 'assets/extra.js').write_text('new')
        self.assertFalse(MODULE.compare(self.base, self.candidate)['passed'])

    def test_missing_asset_rejected(self):
        (self.base / 'art.svg').write_text('<svg/>')
        self.assertEqual(MODULE.compare(self.base, self.candidate)['differences'], ['art.svg'])

    def test_changed_entry_rejected(self):
        (self.candidate / 'index.html').write_text('different entry')
        self.assertFalse(MODULE.compare(self.base, self.candidate)['passed'])

    def test_missing_release_is_not_an_exemption(self):
        (self.candidate / 'release.json').unlink()
        with self.assertRaises(ValueError):
            MODULE.compare(self.base, self.candidate)

    def test_symlink_rejected(self):
        (self.candidate / 'alias.js').symlink_to(self.candidate / 'assets/app.js')
        with self.assertRaises(ValueError):
            MODULE.compare(self.base, self.candidate)


if __name__ == '__main__':
    unittest.main()
