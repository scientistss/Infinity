"""Offline exact current save-notice contract; no browser or runner execution."""
import ast
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/browser-expansion-navigation.py'
SOURCE = SCRIPT.read_text(encoding='utf-8')


def checker():
    nodes = [node for node in ast.parse(SOURCE).body
             if isinstance(node, ast.FunctionDef) and node.name == 'current_save_notice_matches']
    assert len(nodes) == 1
    scope = {}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), scope)
    return scope['current_save_notice_matches']


CURRENT = ('接受 schema=infinity-original-p4 的 v9 / r16 存档；'
           '有效 r2–r14 先备份后升级；未发布的 r15 不支持。')


class ExpansionSaveNoticeContract(unittest.TestCase):
    def test_exact_current_notice_passes(self):
        self.assertTrue(checker()(CURRENT))

    def test_actual_production_notice_matches_current_constants(self):
        content = (ROOT / 'src/game/content.ts').read_text(encoding='utf-8')
        tokens = {'SAVE_SCHEMA': 'infinity-original-p4'}
        for name in ('SAVE_VERSION', 'SAVE_REVISION'):
            tokens[name] = re.search(r'export const ' + name + r' = (\d+);', content).group(1)
        source = (ROOT / 'src/ui/planet-selector.ts').read_text(encoding='utf-8')
        notice = next(line for line in source.splitlines() if '接受 schema=${SAVE_SCHEMA}' in line)
        for name, value in tokens.items():
            notice = notice.replace('${' + name + '}', value)
        self.assertTrue(checker()(notice))

    def test_stale_and_unsupported_revision_notices_fail(self):
        for before, after in (
            ('v9 / r16', 'v9 / r14'),
            ('v9 / r16', 'v9 / r15'),
            ('v9 / r16', 'v8 / r16'),
            ('r2–r14', 'r2–r13'),
            ('r2–r14', 'r2–r15'),
            ('先备份后升级', '直接升级'),
            ('未发布的 r15 不支持。', ''),
            ('未发布的 r15 不支持。', 'r15 支持。'),
        ):
            with self.subTest(before=before, after=after):
                self.assertFalse(checker()(CURRENT.replace(before, after)))

    def test_native_runner_uses_the_tested_predicate(self):
        run = next(node for node in ast.parse(SOURCE).body
                   if isinstance(node, ast.FunctionDef) and node.name == 'run_cases')
        matches = [node for node in ast.walk(run) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Name) and node.func.id == 'current_save_notice_matches']
        self.assertEqual(len(matches), 1)
        self.assertEqual(ast.unparse(matches[0]), 'current_save_notice_matches(note)')


if __name__ == '__main__':
    unittest.main()
