"""Offline structure and fail-closed source/dist checks; never a native bug proof."""
import ast
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('manual_unit_proof_source', ROOT / 'scripts/manual-unit-proof-source.py')
source = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(source)

class ManualUnitProofStructure(unittest.TestCase):
    def test_dedicated_workflow_is_bounded_read_only_and_exact_branch(self):
        text = (ROOT / '.github/workflows/manual-unit-old-proof.yml').read_text()
        self.assertIn('timeout-minutes: 10', text)
        self.assertIn('contents: read', text)
        self.assertNotIn('contents: write', text)
        self.assertNotIn('pull_request:', text)
        self.assertIn("branches: ['codex/infinity-research-manual-unit-repro-20261012']", text)
        self.assertIn("github.ref == 'refs/heads/codex/infinity-research-manual-unit-repro-20261012'", text)
        self.assertIn('node-version: 22', text)
        self.assertIn('bash scripts/browser-prerequisites.sh', text)
        self.assertIn('node --import tsx scripts/natural-growth-journey.ts', text)
        self.assertIn('GITHUB_SHA="$BASE_SHA" npm run build', text)
        self.assertIn("report['bugConfirmed'] is True", text)
        self.assertNotIn('git push', text)
        self.assertNotIn('download-artifact', text)

    def test_native_runner_preserves_observation_and_identity_contract(self):
        text = (ROOT / 'scripts/browser-manual-unit-proof.py').read_text()
        tree = ast.parse(text)
        self.assertIn("('default-one',None),('empty',''),('zero','0'),('negative-one','-1'),('fraction-one-point-five','1.5')", text)
        self.assertIn('field.fill(value)', text)
        self.assertIn('.click()', text)
        self.assertIn('event.isTrusted', (ROOT / 'scripts/browser-npc-attack.py').read_text())
        self.assertIn("'trusted':", repr({'trusted': True}))
        self.assertIn("'positiveClockAdvances':0", text)
        self.assertIn("window.__npcAdvance(0)", text)
        self.assertIn('Debugger.getScriptSource', text)
        self.assertIn("len(release['files'])==62", text)
        self.assertIn('complete-62-http-resources.json', text)
        self.assertIn("actual=", text)
        self.assertIn("after['state']==expected", text)
        self.assertIn("before['state']==initial['state']", text)
        self.assertIn("observed['origins'][0]['localStorage']", text)
        self.assertIn("seedBeforeApp']==initial_raw", text)
        self.assertIn("saved_again['state']==expected", text)
        self.assertIn("report['bugConfirmed']=True", text)
        self.assertNotIn('/workspace/', text)
        self.assertNotIn('/tmp/infinity', text)
        self.assertNotIn('localStorage.setItem(', text)
        self.assertNotIn('dispatchEvent(', text)
        self.assertNotIn('set_content(', text)
        self.assertNotIn('.route(', text)
        call_names = {n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
        self.assertFalse({'route', 'add_cookies', 'connect_over_cdp'} & call_names)

    def test_live_failure_capture_precedes_playwright_cleanup(self):
        tree = ast.parse((ROOT / 'scripts/browser-manual-unit-proof.py').read_text())
        outer = next(node for node in tree.body if isinstance(node, ast.Try))
        body_calls = [node for statement in outer.body for node in ast.walk(statement)
                      if isinstance(node, ast.Call)]
        self.assertTrue(any(isinstance(call.func, ast.Attribute) and call.func.attr == 'start'
                            and isinstance(call.func.value, ast.Name)
                            and call.func.value.id == 'playwright_manager' for call in body_calls))
        self.assertFalse(any(isinstance(node, ast.With) for node in ast.walk(outer)))
        handler_calls = [node for handler in outer.handlers for node in ast.walk(handler)
                         if isinstance(node, ast.Call)]
        self.assertTrue(any(isinstance(call.func, ast.Name) and call.func.id == 'snapshot'
                            for call in handler_calls))
        screenshots = [call for call in handler_calls if isinstance(call.func, ast.Attribute)
                       and call.func.attr == 'screenshot']
        self.assertEqual(len(screenshots), 1)
        self.assertTrue(any(keyword.arg == 'caret' and isinstance(keyword.value, ast.Constant)
                            and keyword.value.value == 'initial' for keyword in screenshots[0].keywords))
        final_calls = [node for statement in outer.finalbody for node in ast.walk(statement)
                       if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)]
        stops = [call for call in final_calls if call.func.attr == 'stop'
                 and isinstance(call.func.value, ast.Name) and call.func.value.id == 'pw']
        closes = [call for call in final_calls if call.func.attr in ('close', 'server_close')]
        self.assertEqual(len(stops), 1)
        self.assertTrue(closes)
        self.assertGreater(stops[0].lineno, max(call.lineno for call in closes))
        self.assertLess(screenshots[0].lineno, stops[0].lineno)
        self.assertIn('signal.alarm(180)', (ROOT / 'scripts/browser-manual-unit-proof.py').read_text())

    def test_native_report_keeps_decimal_string_game_clock_exact(self):
        tree = ast.parse((ROOT / 'scripts/browser-manual-unit-proof.py').read_text())
        expression = next(value for node in ast.walk(tree) if isinstance(node, ast.Dict)
                          for key, value in zip(node.keys, node.values)
                          if isinstance(key, ast.Constant) and key.value == 'elapsedGameTime')
        code = compile(ast.Expression(body=expression), '<actual-report-clock-expression>', 'eval')
        for before, after, expected in [('1437', '1437', '0'), ('1437', '1438', '1'), ('1437.25', '1437.25', '0.00')]:
            result = eval(code, {'Decimal': Decimal, 'before': {'state': {'totalTime': before}},
                                'after': {'state': {'totalTime': after}}})
            self.assertEqual(result, expected)
            self.assertIsInstance(result, str)

    def test_all_added_files_are_dedicated_and_no_report_archive_added(self):
        self.assertEqual(len(source.ADDITIONS), 5)
        self.assertTrue(all(p.startswith(('scripts/', '.github/workflows/')) for p in source.ADDITIONS))
        self.assertFalse(any(p.endswith(('.gz', '.zip')) or 'natural-report' in p for p in source.ADDITIONS))

    def test_published_manifest_pins_all_sixty_two_original_resources(self):
        path = ROOT / 'scripts/manual-unit-published-241a-manifest.json'
        self.assertEqual(source.sha256(path.read_bytes()), source.PUBLISHED_RELEASE_SHA256)
        value = json.loads(path.read_text())
        self.assertEqual(value['sourceSha'], source.BASE)
        self.assertEqual(len(value['files']), 62)
        self.assertEqual((value['saveVersion'], value['saveRevision']), (9, 14))
        self.assertEqual(value['files']['assets/index-FFw3IJvx.js'], 'c4e55889def2a9ed779bed16fd6db8db66f3c4acad983663b240189486512c51')

    def test_dist_verifier_rejects_modified_missing_and_extra_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dist = root / 'dist'; dist.mkdir()
            files = {}
            for index in range(62):
                name = str(index) + '.txt'; data = name.encode()
                (dist / name).write_bytes(data); files[name] = source.sha256(data)
            release = {'sourceSha': source.BASE, 'files': files}
            data = (json.dumps(release) + '\n').encode()
            published = root / 'published.json'; published.write_bytes(data)
            (dist / 'release.json').write_bytes(data)
            with patch.object(source, 'PUBLISHED_RELEASE_SHA256', source.sha256(data)):
                self.assertEqual(len(source.verify_dist(dist, published)['actualFiles']), 63)
                (dist / 'extra.txt').write_text('extra')
                with self.assertRaisesRegex(ValueError, 'missing or extra'):
                    source.verify_dist(dist, published)
                (dist / 'extra.txt').unlink()
                (dist / '0.txt').write_text('edited')
                with self.assertRaisesRegex(ValueError, 'artifact bytes differ'):
                    source.verify_dist(dist, published)
                (dist / '0.txt').unlink()
                with self.assertRaisesRegex(ValueError, 'missing or extra'):
                    source.verify_dist(dist, published)

if __name__ == '__main__':
    unittest.main()
