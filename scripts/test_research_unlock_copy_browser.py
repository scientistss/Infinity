"""Python-only adversarial contracts; these never claim native/browser success."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import argparse
import contextlib
import io
import itertools
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'scripts/browser-research-unlock-copy.py'
SPEC = importlib.util.spec_from_file_location('research_unlock_copy_browser', PATH)
BROWSER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BROWSER)


def specimen(side):
    cards = []
    controls = []
    for tech in BROWSER.IDS:
        effect = (BROWSER.OLD_EFFECT if side == 'before' else BROWSER.NEW_EFFECT) if tech == 'astrophysics' else tech + ' unchanged effect'
        node = '<p class="bld-effect" data-bind="reffect-' + tech + '">' + effect + '</p>'
        html = '<article data-bind="rcard-' + tech + '"><div>Original title</div>' + node + '<ul>Original requirements</ul><dl>Original cost/time</dl><button disabled="">Research1</button></article>'
        text = 'Original title\n' + effect + '\nOriginal requirements\nOriginal cost/time\nResearch1'
        cards.append(dict(id=tech, html=html, text=text, nodeCount=9, level='0', effect=effect, effectHTML=node,
                          effectCount=1, effectChildren=0, placement=True))
        controls.append(dict(id=tech, tag='BUTTON', html='<button disabled="">Research1</button>', type='button', value='', disabled=True, text='Research1'))
    return dict(panelHTML='<section>' + ''.join(row['html'] for row in cards) + '</section>',
                panelText='\n'.join(row['text'] for row in cards), panelNodes=150, cards=cards, controls=controls)


def synthetic_receipt():
    """Independent fake trace solely for exercising Python fail-closed validation."""
    snapshot = {'totalTime': '0', 'resources': {'metal': '500', 'crystal': '500', 'deuterium': '0'},
                'buildings': dict.fromkeys(('solar_plant', 'deuterium_synth', 'research_lab'), 0),
                'research': {'levels': dict.fromkeys(BROWSER.IDS, 0), 'queue': []}, 'buildQueue': [],
                'seeds': {'universe': 20261013, 'arcade': 49303029, 'deepSpace': 7}, 'darkMatter': '0', 'unlocked': [], 'stats': {}}
    initial = copy.deepcopy(snapshot)
    actions = []
    def enqueue(name, cost):
        before = copy.deepcopy(snapshot)
        job = dict(jobId=len([row for row in actions if row['kind'] == 'enqueue']) + 1, building=name, paid=cost, source='manual', taskId=None)
        for key, value in cost.items(): snapshot['resources'][key] = str(int(snapshot['resources'][key]) - int(value))
        snapshot['buildQueue'].append(job)
        actions.append(dict(index=len(actions) + 1, kind='enqueue', building=name, targetLevel=1, source='manual', jobId=job['jobId'], cost=cost, paidJob=job, before=before, after=copy.deepcopy(snapshot)))
    def tick():
        before = copy.deepcopy(snapshot)
        snapshot['totalTime'] = str(int(snapshot['totalTime']) + 1)
        for resource in snapshot['resources']: snapshot['resources'][resource] = str(int(snapshot['resources'][resource]) + 5)
        for job in snapshot['buildQueue']: snapshot['buildings'][job['building']] = 1
        snapshot['buildQueue'] = []
        if snapshot['buildings']['research_lab']:
            snapshot['darkMatter'] = '1000'; snapshot['unlocked'] = ['first_deuterium', 'first_lab']
        actions.append(dict(index=len(actions) + 1, kind='tick', reason='synthetic validator unit test', seconds=1, mode='live', completed={'completedResearch': [], 'completedUnits': []}, before=before, after=copy.deepcopy(snapshot)))
    enqueue('solar_plant', {'metal': '75', 'crystal': '30', 'deuterium': '0'})
    enqueue('deuterium_synth', {'metal': '225', 'crystal': '75', 'deuterium': '0'})
    for _ in range(87): tick()
    enqueue('research_lab', {'metal': '200', 'crystal': '400', 'deuterium': '200'})
    tick()
    def raw(value):
        state = {key: copy.deepcopy(value[key]) for key in ('totalTime', 'research', 'darkMatter', 'unlocked', 'stats')}
        state['planets'] = [{key: copy.deepcopy(value[key]) for key in ('resources', 'buildings', 'buildQueue')}]
        return json.dumps({'savedAt': 1000, 'lastTickAt': 1000, 'state': state}).encode()
    initial_bytes, final_bytes = raw(initial), raw(snapshot)
    files = [{'path': name, 'sha256': 'b' * 64} for name in sorted(('package.json', 'package-lock.json', 'src/data/research.ts', 'src/ui/present.ts'))]
    source = dict(sourceRoot='/fake', head='a' * 40, changedSourceFiles=[], files=files,
                  sourceManifestSha256=BROWSER.sha(json.dumps(files, ensure_ascii=False, separators=(',', ':'))),
                  generator={'path': '/fake/scripts/research-unlock-copy-fixture.mjs', 'sha256': 'c' * 64})
    receipt = dict(schema='infinity-research-unlock-natural-v1', status='passed', passed=True, completed=True, sourceSha='a' * 40, source=source,
                   method='Accelerated natural-domain engine progression; not elapsed browser/wall-clock play.',
                   initialFactory={'api': 'createInitialState(seed, arcadeSeed)', 'worldSeed': 20261013, 'arcadeSeed': 49303029, 'stateEdits': []},
                   bounds={'maxEngineSeconds': 300, 'maxActions': 320, 'maxTickSeconds': 1, 'mode': 'live'}, savedAt=1000, lastTickAt=1000,
                   initial=initial, actions=actions, rawInitial={'path': '/fake/raw-initial.json', 'sha256': BROWSER.sha(initial_bytes)}, exclusions=[],
                   final=copy.deepcopy(snapshot), totalEngineSeconds=88, actionCount=91, rawFirstLab={'path': '/fake/raw-first-lab.json', 'sha256': BROWSER.sha(final_bytes)},
                   expectedView={'path': '/fake/expected-view.json', 'effect': BROWSER.NEW_EFFECT}, researchVisible=True, arcadeUnlocked=False,
                   earnedAchievements=['first_deuterium', 'first_lab'], earnedDarkMatter='1000')
    return receipt, initial_bytes, final_bytes, 'a' * 40


class BrowserContracts(unittest.TestCase):
    def test_exact_change_only_and_input_evidence_immutable(self):
        before, after = specimen('before'), specimen('after')
        saved = copy.deepcopy((before, after))
        self.assertTrue(BROWSER.validate_pair(before, after)['completeRemainingDOMTextControlsEqual'])
        self.assertEqual(saved, (before, after))

    def test_unknown_missing_duplicate_reordered_cards_and_controls_rejected(self):
        for kind in ('unknown-top', 'unknown-card', 'missing-card', 'duplicate-card', 'reorder', 'duplicate-button', 'extra-button', 'missing-button', 'wrong-level', 'duplicate-effect', 'effect-child', 'misplaced', 'wrong-effect', 'unknown-effect-node'):
            after = specimen('after')
            if kind == 'unknown-top': after['ignored'] = True
            if kind == 'unknown-card': after['cards'][10]['ignored'] = True
            if kind == 'missing-card': after['cards'].pop()
            if kind == 'duplicate-card': after['cards'][1] = copy.deepcopy(after['cards'][0])
            if kind == 'reorder': after['cards'].reverse()
            if kind == 'duplicate-button': after['controls'][1] = copy.deepcopy(after['controls'][0])
            if kind == 'extra-button': after['controls'].append(copy.deepcopy(after['controls'][0]))
            if kind == 'missing-button': after['controls'].pop()
            if kind == 'wrong-level': after['cards'][10]['level'] = '1'
            if kind == 'duplicate-effect': after['cards'][10]['effectCount'] = 2
            if kind == 'effect-child': after['cards'][10]['effectChildren'] = 1
            if kind == 'misplaced': after['cards'][10]['placement'] = False
            if kind == 'wrong-effect': after['cards'][10]['effect'] += 'extra'
            if kind == 'unknown-effect-node': after['cards'][10]['effectHTML'] = after['cards'][10]['effectHTML'].replace('<p ', '<p hidden="" ')
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                BROWSER.validate_pair(specimen('before'), after)

    def test_every_other_effect_requirement_price_timer_button_and_dom_byte_preserved(self):
        for kind in ('other-effect', 'requirement', 'cost', 'timer', 'button-disabled', 'button-type', 'hidden-dom', 'panel-count', 'card-count', 'new-paragraph', 'other-stale-copy'):
            after = specimen('after')
            if kind == 'other-effect': after['cards'][0]['effect'] = 'changed'
            if kind == 'requirement': after['cards'][10]['html'] = after['cards'][10]['html'].replace('Original requirements', 'changed requirements')
            if kind == 'cost': after['cards'][10]['html'] = after['cards'][10]['html'].replace('Original cost/time', 'free')
            if kind == 'timer': after['panelText'] += '\nchanged timer'
            if kind == 'button-disabled': after['controls'][10]['disabled'] = False
            if kind == 'button-type': after['controls'][10]['type'] = 'submit'
            if kind == 'hidden-dom': after['panelHTML'] += '<p hidden="">invisible drift</p>'
            if kind == 'panel-count': after['panelNodes'] += 1
            if kind == 'card-count': after['cards'][10]['nodeCount'] += 1
            if kind == 'new-paragraph': after['panelText'] += '\nextra'
            if kind == 'other-stale-copy': after['panelText'] += BROWSER.OLD_EFFECT
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                BROWSER.validate_pair(specimen('before'), after)

    def test_duplicate_json_fields_rejected(self):
        for raw in ('{"sourceSha":"good","sourceSha":"evil"}', '{"files":{"asset.js":"good","asset.js":"evil"}}'):
            with self.assertRaises(ValueError): BROWSER.strict_json(raw)

    def test_bounded_real_browser_and_failure_contract_is_present(self):
        source = PATH.read_text()
        ast.parse(source)
        self.assertEqual(BROWSER.WIDTHS, (320, 390, 768, 1440))
        self.assertLessEqual(BROWSER.WORK_SECONDS, 180)
        self.assertLessEqual(BROWSER.SUPERVISOR_SECONDS, 210)
        for text in ('Debugger.getScriptSource', 'Network.setCacheDisabled', "relative in releases[side]['files']", "sha(http_bytes)", "sha(source)", "matches[0].status == 200", "len(matches) == 1", "len(set(script_urls)) == len(script_urls)", "data == (Path(root) / 'dist' / name).read_bytes()", "body == (Path(root) / 'dist/release.json').read_bytes()", 'source_binding(root, expected)', "'savedAfterDisplay'", "check('both real native Save actions fired exactly once in their phases'", "caret='initial'", "'native scroll geometry settled across two real RAF dispatches'", 'validate_fixture(receipt, initial_bytes, incoming_bytes, args.expected_sha)', "page.locator('[data-tab=\"research\"]').click()", "set_input_files(str(fixture / 'raw-first-lab.json'))", "dialog.accept() if accepted else dialog.dismiss()", "all(row['trusted'] for row in events)", "full_page=False", 'document.elementFromPoint', "window.scrollBy({top:top-desired", "[.1,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]", "'failure-document.html'", "'failure-storage.json'", "'failure-viewport.png'", "startTimeTicks", "'survivors': survivors"):
            with self.subTest(text=text): self.assertIn(text, source)
        for forbidden in ('add_style_tag', 'set_content(', '.set_viewport_size(', 'Storage.prototype.setItem=', 'File.prototype.text=', 'page.route(', "element.click()", "window.__advance"):
            self.assertNotIn(forbidden, source)
        self.assertLess(source.index("stage['rawCapture'] = dump"), source.index("check('real screenshot shows"))
        self.assertLess(source.index('failure_capture(error)', source.index('def retain_before_teardown')), source.index('raise\n', source.index('def retain_before_teardown')))
        self.assertIn('with sync_playwright() as playwright, retain_before_teardown():', source)

    def test_historical_level_four_panel_needs_no_new_copy_exception(self):
        fixture = (ROOT / 'scripts/render-scheduling-fixture.ts').read_text()
        self.assertIn('Object.assign(base.research.levels, {astrophysics:4,computer_tech:8,combustion_drive:6,impulse_drive:4});', fixture)
        source = (ROOT / 'scripts/browser-render-scheduling.py').read_bytes()
        self.assertEqual(hashlib.sha256(source).hexdigest(), '6e7e4e40acc8ac6ba8edc2bb450919612d8b19e287aa97057305ee6ee65af044')
        self.assertNotIn(b'normalize_astrophysics', source)
        # The existing historical test still freezes every prior comparator byte.
        original_test = (ROOT / 'scripts/test_recycle_preview_display_contract.py').read_bytes()
        self.assertEqual(hashlib.sha256(original_test).hexdigest(), 'bd19bd4e8116033ec004bf717347dad2ad643ef621ec61461caa3a991c8f97cd')

    def test_receipt_validates_complete_synthetic_contract_without_mutating_it(self):
        args = synthetic_receipt(); prior = copy.deepcopy(args)
        BROWSER.validate_fixture(*args)
        self.assertEqual(args, prior)

    def test_receipt_rejects_unknown_duplicate_source_drift_edited_inputs_and_false_natural_claims(self):
        for kind in ('unknown', 'failed', 'source-sha', 'dirty-source', 'duplicate-source', 'unknown-source', 'source-hash', 'generator', 'seed', 'state-edit', 'initial-funds', 'first-lab-hash', 'initial-hash', 'timestamps', 'order', 'missing-action', 'unknown-action', 'missing-payment', 'wrong-payment', 'paid-job', 'mode', 'time', 'discontinuity', 'rng', 'reward', 'arcade', 'research', 'count', 'unknown-expected'):
            args = list(synthetic_receipt()); receipt = args[0]
            if kind == 'unknown': receipt['ignored'] = True
            elif kind == 'failed': receipt['completed'] = False
            elif kind == 'source-sha': receipt['sourceSha'] = 'd' * 40
            elif kind == 'dirty-source': receipt['source']['changedSourceFiles'] = ['src/game/state.ts']
            elif kind == 'duplicate-source': receipt['source']['files'].append(copy.deepcopy(receipt['source']['files'][0]))
            elif kind == 'unknown-source': receipt['source']['ignored'] = True
            elif kind == 'source-hash': receipt['source']['sourceManifestSha256'] = 'd' * 64
            elif kind == 'generator': receipt['source']['generator']['path'] = '/evil/generator.mjs'
            elif kind == 'seed': receipt['initialFactory']['worldSeed'] += 1
            elif kind == 'state-edit': receipt['initialFactory']['stateEdits'] = ['resources']
            elif kind == 'initial-funds': receipt['initial']['resources']['metal'] = '99999999'
            elif kind == 'first-lab-hash': args[2] += b' '
            elif kind == 'initial-hash': args[1] += b' '
            elif kind == 'timestamps': receipt['lastTickAt'] += 1
            elif kind == 'order': receipt['actions'].reverse()
            elif kind == 'missing-action': receipt['actions'].pop()
            elif kind == 'unknown-action': receipt['actions'][0]['ignored'] = True
            elif kind == 'missing-payment': receipt['actions'][0]['kind'] = 'skip'
            elif kind == 'wrong-payment': receipt['actions'][0]['cost']['metal'] = '0'
            elif kind == 'paid-job': receipt['actions'][0]['paidJob']['taskId'] = 1
            elif kind == 'mode': receipt['actions'][2]['mode'] = 'offline'
            elif kind == 'time': receipt['actions'][2]['seconds'] = 2
            elif kind == 'discontinuity': receipt['actions'][3]['before']['resources']['metal'] = '9999999'
            elif kind == 'rng': receipt['actions'][3]['after']['seeds']['arcade'] += 1
            elif kind == 'reward': receipt['earnedDarkMatter'] = '0'
            elif kind == 'arcade': receipt['arcadeUnlocked'] = True
            elif kind == 'research': receipt['actions'][2]['after']['research']['levels']['astrophysics'] = 1
            elif kind == 'count': receipt['actionCount'] = True
            elif kind == 'unknown-expected': receipt['expectedView']['ignored'] = True
            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                BROWSER.validate_fixture(*args)

    def test_supervisor_never_upgrades_failure_missing_report_or_timeout_to_pass(self):
        # Mock process execution: this tests supervisor results and cleanup only,
        # never starts Node, a browser, HTTP or any real child process.
        real_iterdir = Path.iterdir
        for outcome in ('passed', 'worker-failed', 'missing-report', 'timeout'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / 'evidence'
                class Process:
                    pid = 2147483000
                    returncode = 1 if outcome == 'worker-failed' else 0
                    def __init__(self, *args, **kwargs):
                        if outcome != 'missing-report':
                            BROWSER.atomic_json(output / BROWSER.REPORT_NAME, {'completed': True, 'result': 'passed', 'checks': []})
                    def wait(self, timeout=None): return self.returncode
                counter = itertools.count(step=1000 if outcome == 'timeout' else 1)
                def directory_listing(path):
                    return iter(()) if str(path) == '/proc' else real_iterdir(path)
                with patch.object(BROWSER.subprocess, 'Popen', Process), patch.object(BROWSER, 'process_identity', return_value=None), patch.object(Path, 'iterdir', directory_listing), patch.object(BROWSER.time, 'monotonic', side_effect=lambda: next(counter)), patch.object(BROWSER.time, 'sleep'), patch.object(BROWSER.signal, 'signal'), contextlib.redirect_stdout(io.StringIO()):
                    result = BROWSER.supervise(argparse.Namespace(output=str(output)))
                report = json.loads((output / BROWSER.REPORT_NAME).read_text())
                self.assertEqual(result == 0, outcome == 'passed')
                self.assertEqual(bool(report['completed']), outcome == 'passed')
                self.assertEqual(report['supervisor']['survivors'], [])
                self.assertEqual(report['supervisor']['expired'], outcome == 'timeout')
                self.assertTrue((output / 'worker.log').exists())



if __name__ == '__main__':
    unittest.main()
