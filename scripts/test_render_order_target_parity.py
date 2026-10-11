"""Offline contracts for the one-option historical presentation adapter.

Run: python -m unittest discover -s scripts -p 'test_render_order_target_parity.py' -v
Optionally set RENDER_PARITY_EVIDENCE to the extracted render-scheduling-evidence
directory from CI 38120133416 (9824547881361afbcc310eaaa461a037f85e7353).
Only helper AST nodes execute. Native identity witnesses below are explicit
offline doubles, reconstructed from archived HTML/control values for replay;
they are not live-browser proof. The browser suite captures those properties
from the actual native nodes and retains them in every new raw artifact.
"""
import ast
import copy
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('browser-render-scheduling.py')
SOURCE = SCRIPT.read_text(encoding='utf-8')
LEGACY = [line.split('|') for line in '''metal_mine|金属矿
crystal_mine|晶体矿
deuterium_synth|重氢合成器
solar_plant|太阳能电站
fusion_reactor|核聚变反应堆
metal_storage|金属仓库
crystal_storage|晶体仓库
deuterium_tank|重氢罐
robotics_factory|机器人工厂
nanite_factory|纳米机器人工厂
shipyard|造船厂
research_lab|研究实验室
missile_silo|导弹井'''.splitlines()]
KINDS = [('building', '建筑'), ('research', '研究'), ('shipyard', '造船 / 防御')]
TERRA = '<option value="terraformer">地形改造器</option>'


def namespace():
    def check(name, condition, detail=None):
        if not condition:
            raise AssertionError(name)
    wanted = {'order_target_base_snapshot', 'order_quote_base_snapshot'}
    nodes = [n for n in ast.parse(SOURCE).body if isinstance(n, ast.FunctionDef) and n.name in wanted]
    scope = dict(check=check, copy=copy, json=json, HTMLParser=HTMLParser, audits=[])
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SCRIPT), 'exec'), scope)
    return scope


def select_html(id, options, required=False):
    return '<select id="'+id+'"'+(' required=""' if required else '')+'>'+''.join(
        f'<option value="{value}">{text}</option>' for value, text in options)+'</select>'


class SelectParser(HTMLParser):
    """Read archived attributes/text; never claim to run browser selection."""
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.attrs, self.options = {}, []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'select':
            self.attrs = dict(attrs)
        if tag == 'option':
            self.options.append({'attrs': dict(attrs), 'text': ''})

    def handle_data(self, text):
        self.options[-1]['text'] += text


def witness(fields, controls):
    result = {'formCount': 1, 'fieldsHTML': fields, 'exactPlacement': True,
              'goalLabel': '<span id="order-goal-label">目标等级</span>'}
    for name, title in [('kind', '计划类型'), ('target', '目标')]:
        id = 'order-'+name
        html = re.search(r'<select id="'+id+r'"[^>]*>.*?</select>', fields, re.S).group()
        parser = SelectParser(html)
        index = next(i for i, c in enumerate(controls) if c['id'] == id)
        control = controls[index]
        options = [{'value': o['attrs']['value'], 'text': o['text'],
                    'disabled': 'disabled' in o['attrs'], 'selected': o['attrs']['value'] == control['value'],
                    'native': True, 'direct': True, 'html': raw}
                   for o, raw in zip(parser.options, re.findall(r'<option\b[^>]*>.*?</option>', html, re.S))]
        result[name] = {'tag': 'SELECT', 'id': id, 'html': html,
                        'labelText': title+'\n'+'\n'.join(o['text'] for o in options),
                        'native': True, 'connected': True, 'visible': True, 'owner': True,
                        'count': 1, 'index': index, 'type': control['type'], 'value': control['value'],
                        'disabled': control['disabled'], 'multiple': 'multiple' in parser.attrs,
                        'required': 'required' in parser.attrs,
                        'selectedIndex': next(i for i, o in enumerate(options) if o['selected']), 'options': options}
    return result


def specimen(label):
    options = LEGACY+([('terraformer', '地形改造器')] if label == 'after' else [])
    fields = ('<div class="order-fields"><label>固定付款 / 执行星球<select id="order-planet"><option value="homeworld">母星</option></select></label>'
              '<label>计划类型'+select_html('order-kind', KINDS)+'</label>'
              '<label>目标'+select_html('order-target', options, True)+'</label>'
              '<label><span id="order-goal-label">目标等级</span><input id="order-goal" max="1000"></label></div>')
    controls = [{'id': id, 'action': None, 'type': 'select-one', 'value': value,
                 'disabled': False, 'checked': None, 'text': None}
                for id, value in [('order-planet', 'homeworld'), ('order-kind', 'building'), ('order-target', 'metal_mine')]]
    evidence = witness(fields, controls)
    projected = {'tab': 'orders', 'text': '原样前文\n'+evidence['kind']['labelText']+'\n'+evidence['target']['labelText']+'\n目标等级\n原样后文',
                 'shared': {'amount-metal': '100'}, 'inputs': controls}
    return projected, evidence


class TargetParityTests(unittest.TestCase):
    def setUp(self):
        self.scope = namespace()

    def adapt(self, label, projected=None, evidence=None):
        if projected is None:
            projected, evidence = specimen(label)
        return self.scope['order_target_base_snapshot'](label, projected, evidence)

    def test_exact_single_added_option_goes_from_red_to_equal(self):
        before, before_evidence = specimen('before')
        after, after_evidence = specimen('after')
        self.assertNotEqual(before, after)
        self.assertEqual(self.adapt('before', before, before_evidence), self.adapt('after', after, after_evidence))

    def test_raw_witness_and_all_other_fields_remain_untouched(self):
        projected, evidence = specimen('after')
        saved_evidence, saved_inputs, saved_shared = copy.deepcopy(evidence), copy.deepcopy(projected['inputs']), copy.deepcopy(projected['shared'])
        self.adapt('after', projected, evidence)
        self.assertEqual(evidence, saved_evidence)
        self.assertEqual(projected['inputs'], saved_inputs)
        self.assertEqual(projected['shared'], saved_shared)

    def test_option_values_labels_selected_disabled_and_native_identity_fail_closed(self):
        for name in ('kind', 'target'):
            for index in range(len(specimen('after')[1][name]['options'])):
                for key, wrong in [('value', 'forged'), ('text', '伪造'), ('disabled', True),
                                   ('native', False), ('direct', False), ('html', '<option>伪造</option>')]:
                    with self.subTest(name=name, index=index, key=key):
                        projected, evidence = specimen('after')
                        evidence[name]['options'][index][key] = wrong
                        with self.assertRaises(AssertionError):
                            self.adapt('after', projected, evidence)
                projected, evidence = specimen('after')
                evidence[name]['options'][index]['selected'] = index != 0
                with self.assertRaises(AssertionError):
                    self.adapt('after', projected, evidence)

    def test_missing_duplicate_reordered_extra_and_moved_terra_options_fail_closed(self):
        for change in (lambda o: o.pop(), lambda o: o.pop(1), lambda o: o.append(copy.deepcopy(o[-1])),
                       lambda o: o.reverse(), lambda o: o.insert(2, o.pop()),
                       lambda o: o.append({'value': 'alliance_depot'})):
            projected, evidence = specimen('after')
            change(evidence['target']['options'])
            with self.assertRaises(AssertionError):
                self.adapt('after', projected, evidence)

    def test_select_identity_default_permissions_and_placement_fail_closed(self):
        for name in ('kind', 'target'):
            for key, wrong in [('tag', 'DIV'), ('id', 'other'), ('native', False), ('owner', False),
                               ('connected', False), ('visible', False), ('count', 2), ('index', 3),
                               ('type', 'select-multiple'), ('value', 'terraformer'), ('disabled', True),
                               ('multiple', True), ('selectedIndex', 13), ('html', '<select></select>'), ('labelText', '伪造')]:
                with self.subTest(name=name, key=key):
                    projected, evidence = specimen('after')
                    evidence[name][key] = wrong
                    with self.assertRaises(AssertionError):
                        self.adapt('after', projected, evidence)
        for key, wrong in [('formCount', 2), ('exactPlacement', False), ('goalLabel', '<span>伪造</span>')]:
            projected, evidence = specimen('after')
            evidence[key] = wrong
            with self.assertRaises(AssertionError):
                self.adapt('after', projected, evidence)

    def test_visible_control_tampering_is_not_normalized(self):
        for index in (1, 2):
            for change in (lambda p: p['inputs'][index].update(value='terraformer'),
                           lambda p: p['inputs'][index].update(disabled=True),
                           lambda p: p['inputs'].append(copy.deepcopy(p['inputs'][index]))):
                projected, evidence = specimen('after')
                change(projected)
                with self.assertRaises(AssertionError):
                    self.adapt('after', projected, evidence)

    def test_ambiguous_or_changed_text_and_dom_boundaries_fail_closed(self):
        for change in (lambda p, e: p.update(text=p['text']+'\n'+e['target']['labelText']),
                       lambda p, e: p.update(text=p['text'].replace('地形改造器\n目标等级', '地形改造器\n伪造\n目标等级')),
                       lambda p, e: e.update(fieldsHTML=e['fieldsHTML'].replace('</div>', TERRA+'</div>')),
                       lambda p, e: e.update(fieldsHTML=e['fieldsHTML'].replace('<label>目标<', '<label>伪造<'))):
            projected, evidence = specimen('after')
            change(projected, evidence)
            with self.assertRaises(AssertionError):
                self.adapt('after', projected, evidence)

    def test_unrelated_terra_text_is_preserved_and_remainder_changes_still_fail_parity(self):
        for label in ('before', 'after'):
            projected, evidence = specimen(label)
            projected['text'] += '\n地形改造器\n其他名字中的地形改造器'
            result = self.adapt(label, projected, evidence)
            self.assertTrue(result['text'].endswith('\n地形改造器\n其他名字中的地形改造器'))
        before = self.adapt('before')
        for change in (lambda p, e: p.update(text=p['text']+'\n地形改造器'),
                       lambda p, e: p['shared'].update({'amount-metal': '999'}),
                       lambda p, e: e.update(fieldsHTML=e['fieldsHTML'].replace('max="1000"', 'max="999"'))):
            projected, evidence = specimen('after')
            change(projected, evidence)
            self.assertNotEqual(before, self.adapt('after', projected, evidence))

    def test_wrong_side_tab_or_old_bundle_with_added_option_rejected(self):
        for label, source in [('before', 'after'), ('after', 'before'), ('unknown', 'before')]:
            projected, evidence = specimen(source)
            with self.assertRaises(AssertionError):
                self.adapt(label, projected, evidence)
        projected, evidence = specimen('after')
        projected['tab'] = 'facilities'
        with self.assertRaises(AssertionError):
            self.adapt('after', projected, evidence)

    def test_browser_capture_keeps_raw_native_witnesses_and_all_three_orders_paths(self):
        for source in ('e instanceof HTMLSelectElement', 'o instanceof HTMLOptionElement',
                       'form?.elements.namedItem(e.id)===e', 'selected:o.selected', 'disabled:o.disabled',
                       'targetSelect:{formCount:', "evidence['targetSelect']",
                       "page.locator('[data-tab-panel=\"orders\"]').evaluate('(node)=>node.outerHTML')==evidence['panelHTML']"):
            self.assertIn(source, SOURCE)
        self.assertEqual(SOURCE.count("order_base=label if name=='orders' else None"), 2)
        self.assertIn("label if name=='orders' else None, label if name=='facilities' else None", SOURCE)


@unittest.skipUnless(os.environ.get('RENDER_PARITY_EVIDENCE'), 'optional exact CI artifact replay')
class ArchivedReplayTests(unittest.TestCase):
    def test_all_three_archived_orders_snapshots_become_equal_without_other_suppression(self):
        root = Path(os.environ['RENDER_PARITY_EVIDENCE'])
        scope = namespace()
        with tempfile.TemporaryDirectory(prefix='order-parity-replay-') as temporary:
            scope.update(out=Path(temporary), raw=lambda p: p.data['stored'],
                         exact_state=lambda a, b: a == b,
                         expected_state=lambda name, p: json.loads(p.data['stored'])['state'])

            class Page:
                def __init__(self, data): self.data = data
                def locator(self, selector):
                    assert selector == '[data-tab-panel="orders"]'
                    return self
                def evaluate(self, source):
                    if source == 'window.__renderProbe.at()': return self.data['controlledClock']
                    assert source == '(node)=>node.outerHTML'
                    return self.data['evidence']['panelHTML']

            for name, b, a in [('folded', 2, 8), ('library-open', 3, 9), ('library-reopened', 4, 10)]:
                with self.subTest(name=name):
                    results = {}
                    for label, n in [('before', b), ('after', a)]:
                        data = json.loads((root/f'panel-parity-orders-{label}-{n}-raw.json').read_text())
                        original = copy.deepcopy(data)
                        fields = re.search(r'<form id="order-form">(<div class="order-fields">.*?</div>)<fieldset>',
                                           data['evidence']['panelHTML'], re.S).group(1)
                        evidence = copy.deepcopy(data['evidence'])
                        evidence['targetSelect'] = witness(fields, data['snapshot']['inputs'])
                        projected = copy.deepcopy(data['snapshot'])
                        projected['orderQuoteEvidence'] = evidence
                        results[label] = scope['order_quote_base_snapshot'](Page(data), label, projected)
                        self.assertEqual(data, original)
                    self.assertEqual(results['before'], results['after'])
            raw_files = list(Path(temporary).glob('panel-parity-orders-*-raw.json'))
            self.assertEqual(len(raw_files), 6)
            self.assertTrue(all('targetSelect' in json.loads(f.read_text())['evidence'] for f in raw_files))


if __name__ == '__main__':
    unittest.main()
