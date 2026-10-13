"""Fast offline negative contracts, not claims of native browser execution."""
import ast
import copy
import hashlib
from pathlib import Path
import tempfile
import unittest

import building_batch_display_contract as batch

ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / 'scripts/browser-render-scheduling.py'
LEGACY = '<details id="building-templates"><summary>' + batch.LEGACY_SUMMARY + '</summary><p>原有隐藏内容</p></details>'
PREFIX = '<section id="space-orders" data-tab-panel="orders"><p>原有正文</p><button id="old" type="button">旧操作</button>'
CONTROLS = [dict(id='old', action=None, type='button', value='', disabled=False, checked=None, text='旧操作')]


def specimen(side='after'):
    after = side == 'after'
    html = PREFIX + (LEGACY + batch.INITIAL_HTML if after else '') + '</section>'
    text = '原有正文\n旧操作' + ('\n' + batch.LEGACY_SUMMARY + '\n' + batch.SUMMARY if after else '')
    snapshot = dict(tab='orders', text=text, inputs=copy.deepcopy(CONTROLS), shared={'amount-metal': '123.45', 'status': '原样状态'},
                    orderQuoteEvidence={'panelHTML': html, 'untouchedNested': ['旧节点', {'paid': 123}]})
    evidence = dict(panelHTML=html, panelText=text, panelCount=1, panelNative=True, panelVisible=True,
                    counts=dict.fromkeys(batch.IDS, int(after)), visibleControls=copy.deepcopy(CONTROLS), addition=None)
    if after:
        evidence['addition'] = dict(html=batch.INITIAL_HTML, native=True, connected=True, hidden=False, open=False, visible=True,
            text=batch.SUMMARY, exactPlacement=True, ids=list(batch.IDS), controlCount=6, controls=batch.expected_controls(),
            summary=dict(html='<summary>' + batch.SUMMARY + '</summary>', native=True, direct=True, first=True, count=1, visible=True))
    state = dict(buildingTemplates=dict(nextTemplateId=1, templates=[])) if after else {}
    return snapshot, evidence, state


def adapt(parts, side='after'):
    return batch.normalize_building_batch_display(*parts, side)


def replace_html(parts, old, new):
    snapshot, evidence, _ = parts
    evidence['panelHTML'] = evidence['panelHTML'].replace(old, new)
    snapshot['orderQuoteEvidence']['panelHTML'] = evidence['panelHTML']
    evidence['addition']['html'] = evidence['addition']['html'].replace(old, new)


class BuildingBatchDisplayContracts(unittest.TestCase):
    def test_exact_new_block_projects_to_every_old_byte_with_raw_witnesses_untouched(self):
        parts = specimen(); frozen = copy.deepcopy(parts)
        result, html = adapt(parts)
        self.assertEqual(html, PREFIX + LEGACY + '</section>')
        self.assertEqual(result['text'], '原有正文\n旧操作\n' + batch.LEGACY_SUMMARY)
        self.assertEqual(parts, frozen)
        for key in ('inputs', 'shared', 'orderQuoteEvidence'):
            self.assertEqual(result[key], parts[0][key])
        self.assertIsNot(result['inputs'], parts[0]['inputs'])
        self.assertIsNot(result['orderQuoteEvidence'], parts[0]['orderQuoteEvidence'])

    def test_historical_absence_is_required_and_not_a_blanket_orders_exception(self):
        parts = specimen('before')
        result, html = adapt(parts, 'before')
        self.assertEqual(result, parts[0]); self.assertEqual(html, parts[1]['panelHTML'])
        for mutate in (lambda p: p[1]['counts'].update({batch.IDS[0]: 1}),
                       lambda p: p[1].update(addition={}),
                       lambda p: p[2].update(buildingTemplates={'nextTemplateId': 1, 'templates': []})):
            parts = specimen('before'); mutate(parts)
            with self.assertRaises(AssertionError): adapt(parts, 'before')

    def test_all_ids_must_be_globally_unique_and_exactly_ordered(self):
        for id in batch.IDS:
            for count in (0, 2):
                parts = specimen(); parts[1]['counts'][id] = count
                with self.subTest(id=id, count=count), self.assertRaises(AssertionError): adapt(parts)
        for mutate in (lambda ids: ids.reverse(), lambda ids: ids.pop(), lambda ids: ids.append('other')):
            parts = specimen(); mutate(parts[1]['addition']['ids'])
            with self.assertRaises(AssertionError): adapt(parts)

    def test_native_identity_placement_visibility_and_folded_state_reject_mutations(self):
        for key, value in [('native', False), ('connected', False), ('hidden', True), ('open', True),
                           ('visible', False), ('exactPlacement', False), ('text', '伪造摘要'), ('controlCount', 7)]:
            parts = specimen(); parts[1]['addition'][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): adapt(parts)
        for key, value in [('panelCount', 2), ('panelNative', False), ('panelVisible', False)]:
            parts = specimen(); parts[1][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): adapt(parts)
        for key, value in [('html', '<summary>伪造摘要</summary>'), ('native', False), ('direct', False),
                           ('first', False), ('count', 2), ('visible', False)]:
            parts = specimen(); parts[1]['addition']['summary'][key] = value
            with self.subTest(summary=key), self.assertRaises(AssertionError): adapt(parts)

    def test_every_hidden_control_property_rejects_mutations(self):
        for index in range(6):
            for key, value in [('id', 'wrong-control'), ('tag', 'INPUT'), ('type', 'submit'), ('native', False),
                               ('connected', False), ('hidden', True), ('visible', True), ('checked', True),
                               ('index', 0), ('value', '1'), ('text', '变更'), ('action', 'other')]:
                parts = specimen(); parts[1]['addition']['controls'][index][key] = value
                with self.subTest(index=index, key=key), self.assertRaises(AssertionError): adapt(parts)
            parts = specimen(); controls = parts[1]['addition']['controls']; controls[index]['disabled'] = not controls[index]['disabled']
            with self.subTest(index=index, key='disabled'), self.assertRaises(AssertionError): adapt(parts)
        for change in (lambda c: c.pop(), lambda c: c.append(copy.deepcopy(c[-1])), lambda c: c.reverse()):
            parts = specimen(); change(parts[1]['addition']['controls'])
            with self.assertRaises(AssertionError): adapt(parts)

    def test_exact_native_default_option_is_required(self):
        for key, value in [('html', '<option></option>'), ('native', False), ('direct', False), ('value', '1'),
                           ('text', '变更'), ('selected', False), ('disabled', True)]:
            parts = specimen(); parts[1]['addition']['controls'][0]['options'][0][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): adapt(parts)
        parts = specimen(); parts[1]['addition']['controls'][0]['selectedIndex'] = -1
        with self.assertRaises(AssertionError): adapt(parts)

    def test_exact_all_markup_bytes_attributes_and_empty_fields_are_required(self):
        replacements = [
            ('<details id=', '<details open="" id='),
            ('class="building-template-batch"', 'class="building-template-batch changed"'),
            ('aria-live="polite"', 'aria-live="assertive"'),
            ('role="status"', 'role="alert"'),
            ('type="button"', 'type="submit"'),
            ('hidden=""', ''), ('disabled=""', ''),
            ('不运输、不补前置、不自动续开。', '自动运输。'),
            ('<option value="">请明确选择模板</option>', '<option value="1">未经选择模板</option>'),
            ('id="building-template-batch-status" role="status" aria-live="polite"></p>', 'id="building-template-batch-status" role="status" aria-live="polite">旧状态</p>'),
            ('class="batch-planet-choices"></div>', 'class="batch-planet-choices"><input type="checkbox"></div>'),
            ('class="batch-budgets"></div>', 'class="batch-budgets"><input value="100"></div>'),
            ('id="building-template-batch-review-summary"></p>', 'id="building-template-batch-review-summary">旧核对</p>'),
            ('id="building-template-batch-total-budget"></p>', 'id="building-template-batch-total-budget">100</p>'),
            ('class="batch-review-planets"></div>', 'class="batch-review-planets"><p>旧授权</p></div>'),
            ('</summary>', '</summary><a href="/other">未登记控件</a>'),
            ('</summary>', '</summary><!-- hidden addition -->'),
            ('\n    <p class="muted">', '\n  <p class="muted">'),
        ]
        for old, new in replacements:
            parts = specimen(); replace_html(parts, old, new)
            with self.subTest(old=old), self.assertRaises(AssertionError): adapt(parts)

    def test_duplicate_wrong_block_and_moved_boundaries_fail_even_with_forged_flags(self):
        for transform in (lambda h: h.replace(batch.INITIAL_HTML, batch.INITIAL_HTML * 2),
                          lambda h: h.replace(LEGACY + batch.INITIAL_HTML, batch.INITIAL_HTML + LEGACY),
                          lambda h: h.replace(batch.INITIAL_HTML, '<div>' + batch.INITIAL_HTML + '</div>'),
                          lambda h: h.replace(batch.INITIAL_HTML, batch.INITIAL_HTML + '<p>尾部变更</p>'),
                          lambda h: h.replace('id="building-templates"', 'id="wrong-library"'),
                          lambda h: h.replace('id="space-orders"', 'id="wrong-panel"')):
            parts = specimen(); parts[1]['panelHTML'] = transform(parts[1]['panelHTML']); parts[0]['orderQuoteEvidence']['panelHTML'] = parts[1]['panelHTML']
            with self.assertRaises(AssertionError): adapt(parts)

    def test_exact_text_suffix_and_snapshot_binding_fail_closed(self):
        for text in ('原样\n' + batch.SUMMARY + '\n尾部', '原样\n' + batch.SUMMARY + '\n' + batch.SUMMARY,
                     '原样' + batch.SUMMARY, '原样\n错误摘要'):
            parts = specimen(); parts[0]['text'] = parts[1]['panelText'] = text
            with self.assertRaises(AssertionError): adapt(parts)
        for change in (lambda p: p[0].update(text='不一致'), lambda p: p[1].update(panelHTML='<section></section>'),
                       lambda p: p[0]['inputs'].pop(), lambda p: p[0].update(tab='research')):
            parts = specimen(); change(parts)
            with self.assertRaises(AssertionError): adapt(parts)

    def test_library_state_cannot_hide_saved_templates_or_revision_changes(self):
        for state in ({'nextTemplateId': 2, 'templates': []}, {'nextTemplateId': 1, 'templates': [{'id': 1}]},
                      {'nextTemplateId': 1, 'templates': [], 'unexpected': True}):
            parts = specimen(); parts[2]['buildingTemplates'] = state
            with self.assertRaises(AssertionError): adapt(parts)

    def test_every_old_remainder_change_survives_projection_for_exact_parity_to_reject(self):
        baseline, html = adapt(specimen())
        for key, changed in [('shared', {'amount-metal': '999', 'status': '变更'}), ('extraOldField', {'unexpected': 1})]:
            parts = specimen(); parts[0][key] = changed; result, _ = adapt(parts)
            self.assertEqual(result[key], changed); self.assertNotEqual(result, baseline)
        parts = specimen(); parts[1]['panelHTML'] = parts[1]['panelHTML'].replace('原有正文', '旧内容变更'); parts[0]['orderQuoteEvidence']['panelHTML'] = parts[1]['panelHTML']
        parts[0]['text'] = parts[1]['panelText'] = parts[0]['text'].replace('原有正文', '旧内容变更')
        result, changed_html = adapt(parts)
        self.assertNotEqual(result['text'], baseline['text']); self.assertNotEqual(changed_html, html)
        self.assertIn('旧内容变更', changed_html)

    def test_previous_library_last_child_and_exact_summary_contract_survives(self):
        result, html = adapt(specimen())
        library = dict(count=1, native=True, connected=True, parentId='space-orders', open=False,
                       text=batch.LEGACY_SUMMARY, summary=batch.LEGACY_SUMMARY, html=LEGACY)
        normalized = batch.normalize_legacy_building_library(result, library, html)
        self.assertEqual(normalized['text'], '原有正文\n旧操作')
        for key, value in [('count', 2), ('native', False), ('connected', False), ('parentId', 'other'), ('open', True),
                           ('text', '变更'), ('summary', '变更'), ('html', '<details></details>')]:
            mutated = dict(library); mutated[key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError): batch.normalize_legacy_building_library(result, mutated, html)
        for mutation in (html.replace(LEGACY, LEGACY + '<p>other</p>'), html.replace(LEGACY, '<div>' + LEGACY + '</div>')):
            with self.assertRaises(AssertionError): batch.normalize_legacy_building_library(result, library, mutation)

    def test_source_literal_and_folded_host_gate_are_bound(self):
        batch.assert_building_batch_source_contract(ROOT)
        panel = (ROOT / 'src/ui/building-template-batch-panel.ts').read_text()
        host = (ROOT / 'src/ui/space-panel.ts').read_text()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); ui = root / 'src/ui'; ui.mkdir(parents=True)
            for target, old, new in [('panel', batch.SUMMARY, '变更'), ('panel', 'aria-live="polite"', 'aria-live="assertive"'),
                                     ('panel', 'select.disabled = !usable;', 'select.disabled = false;'),
                                     ('host', 'buildingTemplatesPanelHtml()+buildingTemplateBatchPanelHtml()', 'buildingTemplateBatchPanelHtml()+buildingTemplatesPanelHtml()'),
                                     ('host', '&&el<HTMLDetailsElement>(root,"#building-template-batch").open', '')]:
                (ui / 'building-template-batch-panel.ts').write_text(panel.replace(old, new, 1) if target == 'panel' else panel)
                (ui / 'space-panel.ts').write_text(host.replace(old, new, 1) if target == 'host' else host)
                with self.subTest(target=target, old=old), self.assertRaises(AssertionError): batch.assert_building_batch_source_contract(root)

    def test_all_three_orders_capture_paths_use_the_one_raw_first_adapter(self):
        source = RUNNER.read_text(); tree = ast.parse(source)
        snapshot = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'snapshot')
        body = ast.get_source_segment(source, snapshot)
        self.assertEqual(body.count('normalize_building_batch_display('), 1)
        self.assertLess(body.index("artifact=f'panel-parity-complete-"), body.index('normalize_building_batch_display('))
        self.assertLess(body.index("artifact=f'panel-parity-building-batch-"), body.index('normalize_building_batch_display('))
        self.assertLess(body.index('normalize_building_batch_display('), body.index('normalize_legacy_building_library('))
        self.assertLess(body.index('normalize_legacy_building_library('), body.index('order_quote_base_snapshot('))
        run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_cases')
        calls = [n for n in ast.walk(run) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'snapshot']
        self.assertEqual(len(calls), 3, 'Folded, opened and reopened captures all retain the same complete sampler')
        quote = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'order_quote_base_snapshot')
        self.assertIn("page.locator('[data-tab-panel=\"orders\"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML']", ast.get_source_segment(source, quote))

    def test_json_scalar_types_are_part_of_the_native_witness(self):
        for mutate in (lambda p: p[1]['counts'].update({batch.IDS[0]: True}),
                       lambda p: p[1]['addition'].update(open=0),
                       lambda p: p[1]['addition'].update(controlCount=6.0),
                       lambda p: p[1]['addition']['controls'][0].update(disabled=0),
                       lambda p: p[2]['buildingTemplates'].update(nextTemplateId=True)):
            parts = specimen(); mutate(parts)
            with self.assertRaises(AssertionError): adapt(parts)

    def test_complete_runner_source_projection_and_negative_mutations(self):
        source = RUNNER.read_text()
        baseline = batch.building_batch_render_contract_before(source)
        self.assertEqual(hashlib.sha256(baseline.encode()).hexdigest(), '6e7e4e40acc8ac6ba8edc2bb450919612d8b19e287aa97057305ee6ee65af044')
        for old, new in [('normalize_building_batch_display(result,evidence', 'normalize_building_batch_display(result,{}'),
                         ('assert_building_batch_source_contract()', '# source binding omitted'),
                         ("raw(page)==stored", 'True'),
                         ('text:e.tagName', 'text:None//e.tagName'),
                         ("len(opened['inputs'])>=", "len(opened['inputs'])<="),
                         ('exact_state(after,lift_r8_state', 'exact_state(before,lift_r8_state')]:
            self.assertIn(old, source)
            with self.subTest(old=old), self.assertRaises(AssertionError):
                batch.building_batch_render_contract_before(source.replace(old, new, 1))
        with self.assertRaises(AssertionError): batch.building_batch_render_contract_before(source + '\n# unreviewed change\n')
        # Existing complete quote/control/state assertions are retained byte for
        # byte. This source check does not execute a historical browser chain.
        old_tree, new_tree = ast.parse(baseline), ast.parse(source)
        for name in ('order_quote_base_snapshot', 'order_target_base_snapshot', 'whole', 'expected_state', 'differential_trace'):
            old_node = next(n for n in old_tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            new_node = next(n for n in new_tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(ast.get_source_segment(baseline, old_node), ast.get_source_segment(source, new_node))

    def test_native_cpu_probe_and_inputs_are_completely_unchanged(self):
        performance = (ROOT / 'scripts/browser-presentation-performance.py').read_bytes()
        self.assertEqual(hashlib.sha256(performance).hexdigest(), '3e74f638c84aabf479cd01c68d5f42c6b7f4807a4f5d44f642aaf5f0e66e709a')
        self.assertNotIn(b'building_batch', performance)
        self.assertNotIn('MutationObserver', batch.SAMPLE_JS)
        self.assertNotIn('.remove(', batch.SAMPLE_JS)
        self.assertNotIn('.replaceWith(', batch.SAMPLE_JS)
        self.assertNotIn('cloneNode', batch.SAMPLE_JS)


if __name__ == '__main__':
    unittest.main()
