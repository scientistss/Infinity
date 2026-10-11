"""Offline preparation/diagnostic contracts; no Playwright, browser or Node runs.

Run: python3 -m unittest discover -s scripts -p 'test_terraformer_native_preparation.py' -v
The pinned prestige geometry is from failed CI 38118157883 / ba777e76f29b4020b340a3d62a013b4b62a6f75b.
Only helper AST nodes are loaded; importing the executable acceptance script
would launch its supervisor. These doubles test control flow, not browser proof.
"""
import ast
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import tempfile
import traceback
import unittest


SCRIPT = Path(__file__).with_name('browser-terraformer.py')
TREE = ast.parse(SCRIPT.read_text(encoding='utf-8'))
HELPERS = {'native_scroll_to', 'responsive', 'capture_failure', 'capture_live_failure'}


def helpers():
    namespace = {'contextmanager': contextmanager, 'hashlib': hashlib, 'traceback': traceback}
    nodes = [node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name in HELPERS]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), namespace)
    return namespace


class TargetPage:
    def __init__(self, *, in_header=False, position='sticky', y=19.90625, height=56,
                 stuck=False, visible=True, contained=True, occluded=False):
        self.box = {'x': 1213.734375, 'y': y, 'width': 146.265625, 'height': height}
        self.limits = {'width': 1440, 'height': 1100, 'inTopbar': in_header,
                       'headerPosition': position, 'headerBottom': 257.5625}
        self.proof = {'targets': [{'visible': visible, 'contained': contained,
                      'points': [{'unoccluded': not (occluded and i == 3)} for i in range(5)]}]}
        self.stuck = stuck
        self.mouse = self
        self.wheels, self.reads = [], []

    def locator(self, selector):
        self.reads.append(('locator', selector))
        return self

    def bounding_box(self):
        return dict(self.box)

    def evaluate(self, source):
        # The actual browser must derive membership/style from the current DOM.
        assert 'header.contains(element)' in source
        assert 'getComputedStyle(header).position' in source
        assert 'getBoundingClientRect().bottom' in source
        return dict(self.limits)

    def move(self, x, y):
        self.reads.append(('move', x, y))

    def wheel(self, x, y):
        self.wheels.append((x, y))
        if not self.stuck:
            self.box['y'] -= y
            if self.limits['headerPosition'] == 'static':
                self.limits['headerBottom'] -= y

    def wait_for_timeout(self, value):
        self.reads.append(('wait', value))


class NativePreparationTests(unittest.TestCase):
    def setUp(self):
        self.namespace = helpers()
        self.checks = []

        def check(name, condition, detail=None):
            self.checks.append((name, condition, detail))
            if not condition:
                raise AssertionError(name)

        self.namespace.update(check=check, advance=lambda page: None,
                              visibility=lambda page, selectors: page.proof)

    def prepare(self, page):
        self.namespace['native_scroll_to'](page, '[data-action="prestige"]')

    def test_exact_failed_topbar_geometry_needs_no_wheel_and_keeps_five_points(self):
        page = TargetPage(in_header=True)
        self.prepare(page)
        self.assertEqual(page.wheels, [])
        self.assertEqual(self.checks[0][2]['limits']['top'], 12)
        self.assertIn('five unoccluded hit-tests', self.checks[-1][0])
        self.assertEqual(len(self.checks[-1][2]['targets'][0]['points']), 5)

    def test_same_geometry_outside_sticky_header_requires_real_wheel(self):
        page = TargetPage()
        self.prepare(page)
        self.assertTrue(page.wheels)
        self.assertEqual(self.checks[0][2]['limits']['top'], 269.5625)
        self.assertGreaterEqual(page.box['y'], 269.5625)

    def test_static_header_can_scroll_away_instead_of_rejecting_tall_target(self):
        page = TargetPage(position='static', y=700, height=1000)
        self.prepare(page)
        self.assertTrue(page.wheels)
        self.assertEqual(self.checks[0][2]['limits']['top'], 12)

    def test_sticky_header_still_rejects_a_target_taller_than_content_region(self):
        page = TargetPage(y=700, height=1000)
        with self.assertRaisesRegex(AssertionError, 'fits its actual'):
            self.prepare(page)
        self.assertEqual(page.wheels, [])

    def test_fixed_header_still_reserves_its_actual_bottom(self):
        page = TargetPage(position='fixed')
        self.prepare(page)
        self.assertEqual(self.checks[0][2]['limits']['top'], 269.5625)

    def test_topbar_membership_never_bypasses_visibility_viewport_or_occlusion(self):
        for fault in ({'visible': False}, {'contained': False}, {'occluded': True}):
            with self.subTest(fault=fault):
                page = TargetPage(in_header=True, **fault)
                with self.assertRaisesRegex(AssertionError, 'five unoccluded hit-tests'):
                    self.prepare(page)
                self.assertEqual(page.wheels, [])

    def test_topbar_target_still_requires_all_five_points(self):
        page = TargetPage(in_header=True)
        page.proof['targets'][0]['points'].pop()
        with self.assertRaisesRegex(AssertionError, 'five unoccluded hit-tests'):
            self.prepare(page)

    def test_unmovable_offscreen_target_is_a_failure_after_bounded_native_wheels(self):
        page = TargetPage(in_header=True, y=1200, stuck=True)
        with self.assertRaisesRegex(AssertionError, 'Actual wheel input could not expose'):
            self.prepare(page)
        self.assertEqual(len(page.wheels), 5)

    def test_actual_ui_places_prestige_inside_header_and_uses_static_mobile_header(self):
        root = SCRIPT.parent.parent
        view = (root / 'src/ui/view.ts').read_text(encoding='utf-8')
        header = view.split('<header class="topbar">', 1)[1].split('</header>', 1)[0]
        self.assertIn('data-action="prestige"', header)
        css = (root / 'src/style.css').read_text(encoding='utf-8')
        self.assertIn('@media (max-width: 860px) {\n  .topbar { position: static; }', css)


class DiagnosticPage:
    RAW = ' {"note": "原始存档", "amount": "000.00"}\n'
    DOM = '<html><body>失败时原始 DOM</body></html>'

    def __init__(self, failures=()):
        self.alive = False
        self.failures = failures
        self.events = []

    def observe(self, name):
        if not self.alive:
            raise RuntimeError('Event loop is closed')
        self.events.append(name)
        if name in self.failures:
            raise RuntimeError(name + ' capture unavailable')

    def raw(self):
        self.observe('raw')
        return self.RAW

    def locator(self, selector):
        self.observe(selector)
        return self

    def all_text_contents(self):
        return ['captured text']

    def content(self):
        self.observe('DOM')
        return self.DOM

    def evaluate(self, source):
        self.observe('scroll diagnostics')
        assert 'slice(-200)' in source and 'scrollHeight' in source and 'scrollY' in source
        return {'width': 1440, 'height': 1100, 'scrollY': 0, 'scrollHeight': 3000,
                'wheelCount': 1, 'wheels': [{'trusted': True, 'deltaY': -100000}]}

    def screenshot(self, *, full_page, timeout):
        self.observe('screenshot')
        assert full_page is False and timeout == 2000
        return b'offline fake screenshot bytes'

    @contextmanager
    def live(self):
        self.alive = True
        try:
            yield self
        finally:
            self.alive = False
            self.events.append('Playwright stopped')


class FailureCaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='terraformer-offline-')
        self.addCleanup(temporary.cleanup)
        self.out = Path(temporary.name)
        self.namespace = helpers()
        self.reports = []
        self.namespace.update(out=self.out, case='deliberate offline failure', completed=True,
                              failure=None, evidence=[], CARD='card', QUEUE='queue',
                              raw=lambda page: page.raw())

        def flush():
            self.reports.append(json.loads(json.dumps(self.namespace['failure'])))
            (self.out / 'report.json').write_text(json.dumps(self.namespace['failure']), encoding='utf-8')

        self.namespace['flush'] = flush

    def fail_live(self, page):
        original = AssertionError('original acceptance failure')
        try:
            with page.live(), self.namespace['capture_live_failure']():
                self.namespace['active_page'] = page
                raise original
        except AssertionError as raised:
            self.assertIs(raised, original)
        else:
            self.fail('The original acceptance exception was swallowed')
        self.assertFalse(self.namespace['completed'])
        self.assertEqual(page.events[-1], 'Playwright stopped')
        self.assertIn('original acceptance failure', self.namespace['failure']['traceback'])
        return self.namespace['failure']

    def test_raw_dom_and_screenshot_captured_before_shutdown_and_exception_preserved(self):
        page = DiagnosticPage()
        failure = self.fail_live(page)
        self.assertEqual((self.out / 'failure-raw-save.json').read_bytes(), page.RAW.encode('utf-8'))
        self.assertEqual((self.out / 'failure-dom.html').read_bytes(), page.DOM.encode('utf-8'))
        self.assertEqual((self.out / 'failure.png').read_bytes(), b'offline fake screenshot bytes')
        self.assertNotIn('captureErrors', failure)
        self.assertNotIn('rawSave', self.reports[0])  # Original failure persisted first.
        self.assertEqual(failure['rawSave'], page.RAW)
        for artifact in self.namespace['evidence']:
            self.assertEqual(artifact['sha256'], hashlib.sha256((self.out / artifact['file']).read_bytes()).hexdigest())

    def test_raw_failure_does_not_prevent_dom_screenshot_or_original_exception(self):
        page = DiagnosticPage(failures={'raw'})
        failure = self.fail_live(page)
        self.assertTrue((self.out / 'failure-dom.html').exists())
        self.assertTrue((self.out / 'failure.png').exists())
        self.assertEqual(failure['captureErrors'][0]['step'], 'raw save')

    def test_dom_and_screenshot_failure_preserve_raw_and_original_exception(self):
        page = DiagnosticPage(failures={'DOM', 'screenshot'})
        failure = self.fail_live(page)
        self.assertTrue((self.out / 'failure-raw-save.json').exists())
        self.assertEqual([error['step'] for error in failure['captureErrors']], ['DOM', 'screenshot'])
        self.assertEqual(json.loads((self.out / 'report.json').read_text())['error'], failure['error'])

    def test_report_write_failure_never_masks_original_acceptance_exception(self):
        def unavailable():
            raise OSError('report filesystem unavailable')
        self.namespace['flush'] = unavailable
        failure = self.fail_live(DiagnosticPage())
        self.assertEqual([error['step'] for error in failure['captureErrors']],
                         ['original failure report', 'report before screenshot', 'final failure report'])
        self.assertTrue((self.out / 'failure.png').exists())

    def test_scroll_diagnostics_failure_never_prevents_other_live_evidence(self):
        failure = self.fail_live(DiagnosticPage(failures={'scroll diagnostics'}))
        self.assertEqual(failure['captureErrors'][0]['step'], 'scroll and wheel diagnostics')
        self.assertTrue((self.out / 'failure-dom.html').exists())
        self.assertTrue((self.out / 'failure.png').exists())

    def test_actual_script_exits_failure_guard_before_playwright_context(self):
        context = next(node for node in ast.walk(TREE) if isinstance(node, ast.With)
                       and any(isinstance(item.context_expr, ast.Call)
                               and isinstance(item.context_expr.func, ast.Name)
                               and item.context_expr.func.id == 'sync_playwright' for item in node.items))
        self.assertEqual([item.context_expr.func.id for item in context.items],
                         ['sync_playwright', 'capture_live_failure'])


class WheelPage:
    def __init__(self, *, scroll_height=3000, move_down=True, move_up=True, trusted=True, audit=True):
        self.mouse = self
        self.scroll_y, self.scroll_height = 0, scroll_height
        self.move_down, self.move_up, self.trusted, self.audit = move_down, move_up, trusted, audit
        self.clicks, self.wheels, self.inputs, self.viewports = [], [], [], []

    def set_viewport_size(self, viewport):
        self.viewports.append(viewport)

    def locator(self, selector):
        assert selector == '[data-tab="facilities"]'
        return self

    def click(self):
        self.clicks.append({'trusted': True, 'action': 'facilities'})

    def evaluate(self, source, argument=None):
        if source == 'window.__terraClicks.length':
            return len(self.clicks)
        if source == '(n)=>window.__terraClicks.slice(n)':
            return self.clicks[argument:]
        if 'wheelCount:window.__terraWheels.length' in source:
            return {'scrollY': self.scroll_y, 'height': 1100, 'scrollHeight': self.scroll_height,
                    'wheelCount': len(self.wheels)}
        if source == '(n)=>({scrollY,wheels:window.__terraWheels.slice(n)})':
            return {'scrollY': self.scroll_y, 'wheels': self.wheels[argument:]}
        if source == 'window.__terraWheels':
            return self.wheels
        if source == 'document.documentElement.scrollWidth<=innerWidth+1':
            return True
        raise AssertionError('Unexpected read: ' + source)

    def move(self, x, y):
        self.inputs.append(('move', x, y))

    def wheel(self, x, y):
        self.inputs.append(('wheel', x, y))
        if self.audit:
            self.wheels.append({'trusted': self.trusted, 'deltaY': y})
        if (y > 0 and self.move_down) or (y < 0 and self.move_up):
            self.scroll_y = max(0, min(self.scroll_height - 1100, self.scroll_y + y))

    def wait_for_timeout(self, value):
        assert value == 80

    def wait_for_function(self, source, *, timeout, polling, arg=None):
        assert timeout == 1000 and polling == 20
        ready = self.scroll_y == 0 if source == 'scrollY === 0' else self.scroll_y > arg
        if not ready:
            raise TimeoutError('Real document did not move as requested')


class ResponsiveWheelTests(unittest.TestCase):
    def setUp(self):
        self.namespace = helpers()
        self.checks = []

        def check(name, condition, detail=None):
            self.checks.append((name, condition, detail))
            if not condition:
                raise AssertionError(name)

        self.namespace.update(check=check, advance=lambda page: None)

    def run_proof(self, page, widths=(320, 390, 768, 1440)):
        # Empty targets isolate per-width preparation; actual target assertions
        # remain in responsive() and run in CI against the real browser DOM.
        self.namespace['responsive'](page, 'old-paid-10000', [], widths)

    def test_each_width_has_actual_trusted_down_and_return_with_before_after(self):
        page = WheelPage()
        self.run_proof(page)
        down = [row for row in self.checks if 'actually moves document down' in row[0]]
        returned = [row for row in self.checks if 'actually returns document to top' in row[0]]
        self.assertEqual(len(down), 4)
        self.assertEqual(len(returned), 4)
        for row in down:
            self.assertEqual(row[2]['before']['scrollY'], 0)
            self.assertEqual(row[2]['after']['scrollY'], 480)
        for row in returned:
            self.assertEqual(row[2]['before']['scrollY'], 480)
            self.assertEqual(row[2]['after']['scrollY'], 0)
        self.assertEqual(sum(event['deltaY'] > 0 for event in page.wheels), 4)
        self.assertEqual(self.checks[-1][:2], ('responsive proof includes trusted native wheel input', True))

    def test_short_scrollable_document_uses_its_actual_available_travel(self):
        page = WheelPage(scroll_height=1150)
        self.run_proof(page, widths=(1440,))
        self.assertEqual([event['deltaY'] for event in page.wheels if event['deltaY'] > 0], [50])
        self.assertEqual(page.scroll_y, 0)

    def test_non_scrollable_document_is_rejected_without_synthetic_positive_event(self):
        page = WheelPage(scroll_height=1100)
        with self.assertRaisesRegex(AssertionError, 'actual vertical wheel travel'):
            self.run_proof(page)
        self.assertFalse(any(event['deltaY'] > 0 for event in page.wheels))

    def test_positive_event_without_actual_document_movement_is_rejected(self):
        page = WheelPage(move_down=False)
        with self.assertRaisesRegex(TimeoutError, 'did not move'):
            self.run_proof(page)
        self.assertTrue(any(event['deltaY'] > 0 for event in page.wheels))

    def test_return_event_without_actual_document_movement_is_rejected(self):
        with self.assertRaisesRegex(TimeoutError, 'did not move'):
            self.run_proof(WheelPage(move_up=False))

    def test_actual_movement_without_trusted_recorded_event_is_rejected(self):
        for fault in ({'trusted': False}, {'audit': False}):
            with self.subTest(fault=fault):
                with self.assertRaisesRegex(AssertionError, 'trusted positive wheel'):
                    self.run_proof(WheelPage(**fault))


if __name__ == '__main__':
    unittest.main()
