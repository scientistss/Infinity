"""Python-only protected export contracts; no browser, Node or native claim.

AST-extracted runner helpers execute with explicit storage/download doubles.
python -m unittest discover -s scripts -p 'test_npc_export_preparation.py' -v
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
import hashlib
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('browser-npc-economy.py')
TREE = ast.parse(SCRIPT.read_text(encoding='utf-8'))
KEY = 'infinity.original-p4.save.v1'
TAB = 'infinity.ui.tab'
ORIGINAL = '{ "完整原件": true, "space": "保留空格" }\n'


class PageDouble:
    def __init__(self, storage):
        self.storage = deepcopy(storage)
        self.selected = storage[TAB]
        self.download = ORIGINAL.encode('utf-8')
        self.clicks = []
        self.after_click = lambda _page, _selector: None

    def locator(self, selector):
        assert selector == '[data-tab="save"]'
        return self

    def get_attribute(self, name):
        assert name == 'aria-selected'
        return 'true' if self.selected == 'save' else 'false'

    @contextmanager
    def expect_download(self):
        self.value = self
        yield self

    def save_as(self, path):
        Path(path).write_bytes(self.download)


def helpers(out):
    names = {'exact_json', 'prepare_protected_export', 'export_protected'}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in names]
    namespace = {'out': out, 'hashlib': hashlib, 'case': 'explicit offline double', 'evidence': []}

    def check(name, condition, detail=None):
        if not condition:
            raise AssertionError(name)

    def trusted_click(page, selector):
        # A test double only. The runner's real trusted_click remains responsible
        # for native input, five hit points and its isTrusted assertion in CI.
        page.clicks.append(selector)
        if selector == '[data-tab="save"]':
            page.storage[TAB] = 'save'
            page.selected = 'save'
        elif selector != '[data-action="export"]':
            raise AssertionError(selector)
        page.after_click(page, selector)

    namespace.update(check=check, storage=lambda page: deepcopy(page.storage), trusted_click=trusted_click)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


class ProtectedExportPreparationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.out = Path(self.directory.name)
        self.helper = helpers(self.out)
        self.before = {
            KEY: 'competing or uncertain native current bytes',
            KEY + '.backup': ORIGINAL,
            KEY + '.backup.2': 'older backup bytes',
            'infinity.save.v1': 'legacy exact bytes',
            TAB: 'overview',
            'infinity.ui.unknown': 'unknown UI preference must remain exact',
            'unrelated-key': 'unknown non-UI bytes must remain exact',
        }

    def prepare(self, page):
        return self.helper['prepare_protected_export'](page, deepcopy(self.before))

    def export(self, page):
        self.helper['export_protected'](page, ORIGINAL, 'original.json')

    def test_navigation_changes_only_tab_then_export_preserves_every_save_page_byte(self):
        page = PageDouble(self.before)
        baseline = self.prepare(page)
        self.assertEqual(baseline, {**self.before, TAB: 'save'})
        self.assertNotEqual(baseline, self.before)  # The original conflated assertion was wrong.
        self.export(page)
        self.assertEqual(page.storage, baseline)
        self.assertEqual(page.clicks, ['[data-tab="save"]', '[data-action="export"]'])
        self.assertEqual((self.out / 'original.json').read_bytes(), ORIGINAL.encode('utf-8'))
        self.assertEqual(self.before[TAB], 'overview')
        self.assertEqual(len(self.helper['evidence']), 1)

    def test_navigation_requires_unchanged_overview_before_clicking(self):
        for key in self.before:
            page = PageDouble(self.before)
            page.storage[key] += ' '
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, 'unchanged overview'):
                self.prepare(page)
            self.assertEqual(page.clicks, [])
        for value in ('save', None):
            before = {**self.before, TAB: value}
            with self.subTest(tab=value), self.assertRaisesRegex(AssertionError, 'unchanged overview'):
                self.helper['prepare_protected_export'](PageDouble(before), before)

    def test_navigation_rejects_changed_removed_or_added_keys_including_unknown_ui(self):
        for key in self.before:
            for operation in ('change', 'remove'):
                page = PageDouble(self.before)
                def mutate(current, _selector, key=key, operation=operation):
                    if operation == 'remove':
                        del current.storage[key]
                    else:
                        current.storage[key] += ' '
                page.after_click = mutate
                with self.subTest(key=key, operation=operation), self.assertRaisesRegex(AssertionError, 'only the exact tab preference'):
                    self.prepare(page)
        page = PageDouble(self.before)
        page.after_click = lambda current, _selector: current.storage.update({'new-unknown-key': 'no'})
        with self.assertRaisesRegex(AssertionError, 'only the exact tab preference'):
            self.prepare(page)

    def test_export_requires_save_page_and_does_not_navigate_to_create_its_baseline(self):
        page = PageDouble(self.before)
        with self.assertRaisesRegex(AssertionError, 'already selected save page'):
            self.export(page)
        self.assertEqual(page.clicks, [])
        page.storage[TAB] = 'save'
        with self.assertRaisesRegex(AssertionError, 'already selected save page'):
            self.export(page)
        self.assertEqual(page.clicks, [])

    def test_export_rejects_any_changed_removed_or_added_key_even_the_tab_preference(self):
        for key in self.before:
            for operation in ('change', 'remove'):
                page = PageDouble(self.before); self.prepare(page)
                def mutate(current, _selector, key=key, operation=operation):
                    if operation == 'remove':
                        del current.storage[key]
                    else:
                        current.storage[key] += ' '
                page.after_click = mutate
                with self.subTest(key=key, operation=operation), self.assertRaisesRegex(AssertionError, 'without any key exception'):
                    self.export(page)
        page = PageDouble(self.before); self.prepare(page)
        page.after_click = lambda current, _selector: current.storage.update({'new-unknown-key': 'no'})
        with self.assertRaisesRegex(AssertionError, 'without any key exception'):
            self.export(page)

    def test_export_retains_exact_original_file_validation(self):
        for invalid in (ORIGINAL.rstrip().encode(), b'{}', self.before[KEY].encode()):
            page = PageDouble(self.before); self.prepare(page)
            page.download = invalid
            with self.subTest(bytes=invalid), self.assertRaisesRegex(AssertionError, 'byte-exact cached original'):
                self.export(page)

    def test_both_native_call_sites_prepare_a_new_full_baseline_before_export(self):
        calls = sorted((node for node in ast.walk(TREE) if isinstance(node, ast.Call)
                        and isinstance(node.func, ast.Name)
                        and node.func.id in {'prepare_protected_export', 'export_protected'}), key=lambda node: node.lineno)
        self.assertEqual([node.func.id for node in calls],
                         ['prepare_protected_export', 'export_protected'] * 2)
        source = SCRIPT.read_text(encoding='utf-8')
        self.assertIn('exact_json(storage(page), export_baseline)', source)
        self.assertIn('storage(page) == export_baseline', source)
        for name in ('prepare_protected_export', 'export_protected'):
            node = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == name)
            self.assertIn('trusted_click(page,', ast.unparse(node))
            self.assertNotIn('tab(page,', ast.unparse(node))
        view = (SCRIPT.parent.parent / 'src/ui/view.ts').read_text(encoding='utf-8')
        self.assertIn('const TAB_KEY = "infinity.ui.tab";', view)
        self.assertIn('localStorage.setItem(TAB_KEY, tab);', view)


if __name__ == '__main__':
    unittest.main()
