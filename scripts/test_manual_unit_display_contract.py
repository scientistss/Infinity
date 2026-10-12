"""Offline copied-data contracts only. No browser, Node or native-pass claim.

The witnesses below are independent reviewed synthetic DOM samples. They never
call the adapter's HTML constructors or import the production UI/quote module.
Historical max labels remain historical fixtures, not current button labels.
"""
import ast
import copy
from pathlib import Path
import unittest

from npc_display_contract import normalize_manual_unit_display

# Independent names and full-price strings, including zero-priced resources.
UNITS = [
    ('small_cargo', '小型运输舰', '金属 2,000 · 晶体 2,000 · 重氢 0'),
    ('large_cargo', '大型运输舰', '金属 6,000 · 晶体 6,000 · 重氢 0'),
    ('light_fighter', '轻型战斗机', '金属 3,000 · 晶体 1,000 · 重氢 0'),
    ('heavy_fighter', '重型战斗机', '金属 6,000 · 晶体 4,000 · 重氢 0'),
    ('cruiser', '巡洋舰', '金属 20,000 · 晶体 7,000 · 重氢 2,000'),
    ('battleship', '战列舰', '金属 45,000 · 晶体 15,000 · 重氢 0'),
    ('battlecruiser', '战列巡洋舰', '金属 30,000 · 晶体 40,000 · 重氢 15,000'),
    ('bomber', '轰炸机', '金属 50,000 · 晶体 25,000 · 重氢 15,000'),
    ('destroyer', '毁灭者', '金属 60,000 · 晶体 50,000 · 重氢 15,000'),
    ('deathstar', '死星', '金属 5,000,000 · 晶体 4,000,000 · 重氢 1,000,000'),
    ('recycler', '回收船', '金属 10,000 · 晶体 6,000 · 重氢 2,000'),
    ('espionage_probe', '间谍卫星', '金属 0 · 晶体 1,000 · 重氢 0'),
    ('solar_satellite', '太阳能卫星', '金属 0 · 晶体 2,000 · 重氢 500'),
    ('colony_ship', '殖民船', '金属 10,000 · 晶体 20,000 · 重氢 10,000'),
    ('rocket_launcher', '火箭发射器', '金属 2,000 · 晶体 0 · 重氢 0'),
    ('light_laser', '轻型激光炮', '金属 1,500 · 晶体 500 · 重氢 0'),
    ('heavy_laser', '重型激光炮', '金属 6,000 · 晶体 2,000 · 重氢 0'),
    ('gauss_cannon', '高斯炮', '金属 20,000 · 晶体 15,000 · 重氢 2,000'),
    ('ion_cannon', '离子炮', '金属 2,000 · 晶体 6,000 · 重氢 0'),
    ('plasma_turret', '等离子炮塔', '金属 50,000 · 晶体 50,000 · 重氢 30,000'),
    ('small_shield_dome', '小型护盾罩', '金属 10,000 · 晶体 10,000 · 重氢 0'),
    ('large_shield_dome', '大型护盾罩', '金属 50,000 · 晶体 50,000 · 重氢 0'),
    ('anti_ballistic_missile', '反弹道导弹', '金属 8,000 · 晶体 0 · 重氢 2,000'),
    ('interplanetary_missile', '星际导弹', '金属 12,500 · 晶体 2,500 · 重氢 10,000'),
]


def fixture(tab, current):
    ids = [ident for ident, _, _ in UNITS]
    prefixes = ['ucard', 'uqty', 'ubuild', 'umax', 'ufill', 'ureason', 'umode-hint', 'uquote', 'utotal', 'upay', 'umanual-reason']
    identity = {
        'panels': {'shipyard': 1, 'defense': 1},
        'bindings': {prefix: [prefix + '-' + ident for ident in ids] if current or n < 6 else [] for n, prefix in enumerate(prefixes)},
        'actions': {'build-units': 0 if current else 72, 'manual-unit-mode': 72 if current else 0, 'manual-unit-pay': 24 if current else 0},
        'hintIds': ['umode-hint-' + ident for ident in ids] if current else [],
    }
    queue_control = {'id': '', 'action': 'cancel-units', 'type': 'button', 'value': '', 'disabled': False, 'checked': None, 'text': '取消'}
    snapshot = {'tab': tab, 'text': '', 'inputs': [queue_control], 'shared': {'status': '已保存到本地', 'amount-metal': '7.80e4'}}
    rows = []
    catalog = UNITS[:14] if tab == 'shipyard' else UNITS[14:]
    for n, (ident, name, total) in enumerate(catalog):
        disabled = n % 2 == 1
        maximum = '最大 0' if disabled else f'最大 {39 + n}'
        reason = '需要 造船厂 等级 4' if disabled else f'可造 {39 + n}'
        q = (f'<input type="text" value="1" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="{name}数量" aria-describedby="umode-hint-{ident}" data-bind="uqty-{ident}">' if current else
             f'<input type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="{name}数量" data-bind="uqty-{ident}">')
        titles = ['预览输入数量的整批报价', '预览按当前资源能造的最大数量', '预览补到输入总量的报价（本星已有 + 排队中计入）'] if current else [reason, reason, '补到输入的数量（已有 + 排队中计入）']
        controls = [{'id': '', 'action': None, 'type': 'text' if current else 'number', 'value': '1', 'disabled': False, 'checked': False, 'text': None}]
        buttons = []
        for i, (mode, bind, label) in enumerate([('count', 'ubuild', '建造'), ('max', 'umax', '最大' if current else maximum), ('fill', 'ufill', '补到')]):
            action = 'manual-unit-mode' if current else 'build-units'
            attrs = f' aria-pressed="{"true" if i == 0 else "false"}"' if current else ''
            disabled_attr = ' disabled=""' if disabled and not current else ''
            buttons.append(f'<button type="button" class="unit-btn" data-action="{action}" data-mode="{mode}"{attrs} data-id="{ident}" data-bind="{bind}-{ident}" title="{titles[i]}"{disabled_attr}>{label}</button>')
            controls.append({'id': '', 'action': action, 'type': 'button', 'value': '', 'disabled': disabled and not current, 'checked': None, 'text': label})
        order = '<div class="unit-order">\n          ' + '\n          '.join([q] + buttons) + '\n        </div>'
        order_text = '\n'.join(control['text'] for control in controls[1:])
        original_reason = f'<p class="btn-cost unit-reason" data-bind="ureason-{ident}">{reason}</p>'
        summary = '当前星球 Home [1:50:8] · 本次新增 1'
        manual_reason = reason if disabled else ''
        pay_disabled = ' disabled=""' if disabled else ''
        addition = (f'<p class="muted unit-mode-hint" id="umode-hint-{ident}" data-bind="umode-hint-{ident}">建造输入的数量；选择模式只更新报价。</p>\n        '
            '<div class="unit-confirm">\n          '
            f'<p class="btn-cost unit-quote" data-bind="uquote-{ident}">{summary}</p>\n          '
            f'<p class="btn-cost unit-total" data-bind="utotal-{ident}">{total}</p>\n          '
            f'<button type="button" class="unit-btn unit-pay" data-action="manual-unit-pay" data-id="{ident}" data-bind="upay-{ident}"{pay_disabled}>支付并入队</button>\n        </div>\n        '
            f'<p class="btn-cost unit-reason" data-bind="umanual-reason-{ident}" role="status">{manual_reason}</p>') if current else None
        if current:
            controls.append({'id': '', 'action': 'manual-unit-pay', 'type': 'button', 'value': '', 'disabled': disabled, 'checked': None, 'text': '支付并入队'})
        witness = [{'index': len(snapshot['inputs']) + i, 'native': True, 'visible': True, 'snapshot': copy.deepcopy(control)} for i, control in enumerate(controls)]
        snapshot['inputs'].extend(controls)
        prefix = (f'<div class="bld-head">{name}</div><p class="bld-blurb">原有介绍</p>'
            '<p class="bld-effect">攻击 10</p><p class="bld-payback">速度 20</p>'
            '<ul class="req-chain"></ul><dl class="bld-facts">单价 1.23e4 · 每艘 3.20 秒</dl>'
            '<details class="unit-rf"><summary>快速射击</summary><p>原有隐藏快速射击</p></details>\n        ')
        body = prefix + order + '\n        ' + (addition + '\n        ' if current else '') + original_reason
        card_html = f'<article class="bld unit-card" data-bind="ucard-{ident}">' + body + '\n      </article>'
        tail = [order_text] + (['建造输入的数量；选择模式只更新报价。', summary, total, '支付并入队'] + ([manual_reason] if manual_reason else []) if current else []) + [reason]
        card_text = name + '\n原有介绍\n攻击 10\n速度 20\n单价 1.23e4 · 每艘 3.20 秒\n快速射击\n' + '\n\n'.join(tail)
        rows.append({'id': ident, 'html': card_html, 'text': card_text, 'children': 12 if current else 9, 'placement': True,
                     'orderHTML': order, 'orderText': order_text, 'reasonHTML': original_reason, 'reasonText': reason,
                     'additionHTML': addition, 'quoteVisible': [True, True, True] if current else None, 'controls': witness})
    snapshot['text'] = '造船队列\n取消\n\n' + '\n\n'.join(row['text'] for row in rows) + '\n\n已保存到本地'
    evidence = {'tab': tab, 'panelHTML': '<section><div class="queue-panel">取消</div><div class="bld-grid">' + ''.join(row['html'] for row in rows) + '</div><p class="status">已保存到本地</p></section>', 'manualUnits': {'identity': identity, 'cards': rows}}
    return {'snapshot': snapshot, 'evidence': evidence}


STATE = {'activePlanetId': 'home', 'planets': [{'id': 'home', 'name': 'Home', 'coordinates': {'galaxy': 1, 'system': 50, 'position': 8}}]}


def normalize(pair, tab='shipyard', old=None):
    return normalize_manual_unit_display(pair['snapshot'], pair['evidence'], STATE, 'after', old or fixture(tab, False))


class ManualUnitDisplayContractTests(unittest.TestCase):
    def test_all_24_current_cards_project_to_exact_legacy_without_mutation(self):
        for tab, count in [('shipyard', 14), ('defense', 10)]:
            old, new = fixture(tab, False), fixture(tab, True)
            before = copy.deepcopy((old, new, STATE))
            snapshot, evidence = normalize(new, tab, old)
            self.assertEqual(snapshot, old['snapshot'])
            self.assertEqual(evidence['panelHTML'], old['evidence']['panelHTML'])
            self.assertEqual((old, new, STATE), before)
            self.assertEqual(len(new['snapshot']['inputs']) - len(snapshot['inputs']), count)
            self.assertIsNot(snapshot['inputs'], old['snapshot']['inputs'])

    def test_every_catalog_price_and_zero_resource_is_exact(self):
        for tab in ('shipyard', 'defense'):
            for index in range(14 if tab == 'shipyard' else 10):
                new = fixture(tab, True)
                row = new['evidence']['manualUnits']['cards'][index]
                row['additionHTML'] = row['additionHTML'].replace('重氢 ', '重氢 1', 1)
                with self.subTest(tab=tab, unit=row['id']), self.assertRaises(AssertionError):
                    normalize(new, tab)

    def test_rejects_all_identity_count_order_and_action_regressions(self):
        for kind in ('duplicate', 'missing', 'reordered', 'unknown', 'wrong-tab-count', 'bool-count', 'legacy-action', 'missing-pay', 'duplicate-hint', 'extra-field'):
            new = fixture('shipyard', True)
            identity = new['evidence']['manualUnits']['identity']
            if kind == 'duplicate': identity['bindings']['ucard'].append(identity['bindings']['ucard'][0])
            if kind == 'missing': identity['bindings']['utotal'].pop()
            if kind == 'reordered': identity['bindings']['uqty'].reverse()
            if kind == 'unknown': identity['bindings']['upay'][-1] = 'upay-unknown'
            if kind == 'wrong-tab-count': identity['panels']['defense'] = 2
            if kind == 'bool-count': identity['panels']['shipyard'] = True
            if kind == 'legacy-action': identity['actions']['build-units'] = 1
            if kind == 'missing-pay': identity['actions']['manual-unit-pay'] = 23
            if kind == 'duplicate-hint': identity['hintIds'].append(identity['hintIds'][0])
            if kind == 'extra-field': identity['ignored'] = 'forbidden'
            with self.subTest(kind=kind), self.assertRaises(AssertionError): normalize(new)

    def test_rejects_native_control_values_types_actions_and_states(self):
        cases = [(0, 'type', 'number'), (0, 'value', '1.0'), (0, 'value', ' 1 '), (0, 'disabled', True),
                 (1, 'action', 'build-units'), (1, 'disabled', True), (1, 'disabled', 0),
                 (2, 'text', '最大 39'), (3, 'text', '补至'), (4, 'disabled', True), (4, 'action', 'manual-unit-mode')]
        for index, field, value in cases:
            new = fixture('shipyard', True)
            control = new['evidence']['manualUnits']['cards'][0]['controls'][index]
            control['snapshot'][field] = value
            new['snapshot']['inputs'][control['index']][field] = value
            with self.subTest(index=index, field=field, value=value), self.assertRaises(AssertionError): normalize(new)
        for field, value in [('native', False), ('visible', False), ('index', True), ('index', 900)]:
            new = fixture('shipyard', True)
            new['evidence']['manualUnits']['cards'][0]['controls'][0][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): normalize(new)

    def test_rejects_changed_new_markup_and_full_quote_not_just_cost_text(self):
        mutations = [('type="text"', 'type="number"'), ('autocomplete="off"', ''), ('aria-pressed="true"', 'aria-pressed="false"'),
                     ('data-mode="count"', 'data-mode="fill"'), ('title="预览输入数量的整批报价"', 'title="立即付款"'),
                     ('Home [1:50:8]', 'Elsewhere [1:50:8]'), ('本次新增 1', '本次新增 2'),
                     ('金属 2,000', '金属 2.00e3'), ('重氢 0', ''), ('支付并入队', '再次支付并入队'),
                     ('role="status"', 'role="alert"'), ('unit-confirm', 'unit-confirm hidden'),
                     ('建造输入的数量；选择模式只更新报价。', '点击会直接下单。')]
        for old, new_value in mutations:
            new = fixture('shipyard', True)
            row = new['evidence']['manualUnits']['cards'][0]
            for key in ('orderHTML', 'additionHTML', 'html'):
                row[key] = row[key].replace(old, new_value)
            with self.subTest(mutation=old), self.assertRaises(AssertionError): normalize(new)

    def test_rejects_structure_and_evidence_drift(self):
        for kind in ('missing-row', 'duplicate-row', 'reordered-row', 'children', 'placement', 'extra-control', 'missing-control', 'extra-evidence-field', 'hidden-quote', 'hidden-card-data', 'changed-timer'):
            new = fixture('shipyard', True)
            rows = new['evidence']['manualUnits']['cards']; row = rows[0]
            if kind == 'missing-row': rows.pop()
            if kind == 'duplicate-row': rows.append(copy.deepcopy(row))
            if kind == 'reordered-row': rows.reverse()
            if kind == 'children': row['children'] = 13
            if kind == 'placement': row['placement'] = False
            if kind == 'extra-control': row['controls'].append(copy.deepcopy(row['controls'][0]))
            if kind == 'missing-control': row['controls'].pop()
            if kind == 'extra-evidence-field': row['ignored'] = True
            if kind == 'hidden-quote': row['quoteVisible'][1] = False
            if kind == 'hidden-card-data': row['html'] = row['html'].replace('原有隐藏快速射击', '已改变隐藏数据')
            if kind == 'changed-timer': row['html'] = row['html'].replace('3.20 秒', '3.21 秒')
            with self.subTest(kind=kind), self.assertRaises(AssertionError): normalize(new)

    def test_rejects_missing_wrong_or_changed_historical_oracle(self):
        new = fixture('shipyard', True)
        with self.assertRaises(AssertionError): normalize_manual_unit_display(new['snapshot'], new['evidence'], STATE, 'after')
        for kind in ('wrong-tab', 'price-reason', 'max-label', 'control-disabled', 'quantity', 'original-type'):
            old = fixture('defense' if kind == 'wrong-tab' else 'shipyard', False)
            row = old['evidence']['manualUnits']['cards'][0]
            if kind == 'price-reason': row['reasonText'] = '可造 40'
            if kind == 'max-label': row['controls'][2]['snapshot']['text'] = '最大 40'
            if kind == 'control-disabled': row['controls'][1]['snapshot']['disabled'] = True
            if kind == 'quantity': row['controls'][0]['snapshot']['value'] = '2'
            if kind == 'original-type': row['controls'][0]['snapshot']['type'] = 'text'
            with self.subTest(kind=kind), self.assertRaises(AssertionError): normalize(new, old=old)

    def test_unrelated_panel_dom_text_queue_controls_and_shared_values_survive(self):
        original = fixture('shipyard', False)
        for kind in ('panel-dom', 'status-text', 'queue-control', 'shared-resource'):
            new = fixture('shipyard', True)
            if kind == 'panel-dom': new['evidence']['panelHTML'] = new['evidence']['panelHTML'].replace('class="queue-panel"', 'class="queue-panel" data-changed="yes"')
            if kind == 'status-text': new['snapshot']['text'] += '\n额外状态'
            if kind == 'queue-control': new['snapshot']['inputs'][0]['disabled'] = True
            if kind == 'shared-resource': new['snapshot']['shared']['amount-metal'] = '0'
            snapshot, evidence = normalize(new)
            with self.subTest(kind=kind):
                self.assertTrue(snapshot != original['snapshot'] or evidence['panelHTML'] != original['evidence']['panelHTML'])
                if kind == 'queue-control': self.assertTrue(snapshot['inputs'][0]['disabled'])
                if kind == 'shared-resource': self.assertEqual(snapshot['shared']['amount-metal'], '0')

    def test_added_or_removed_controls_cannot_be_erased(self):
        for change in ('add', 'remove'):
            new = fixture('shipyard', True)
            if change == 'add': new['snapshot']['inputs'].append(copy.deepcopy(new['snapshot']['inputs'][0]))
            else: new['snapshot']['inputs'].pop()
            with self.subTest(change=change), self.assertRaises(AssertionError): normalize(new)

    def test_runner_archives_raw_evidence_before_projection_and_checks_native_unchanged(self):
        root = Path(__file__).resolve().parent
        source = (root / 'browser-render-scheduling.py').read_text()
        ast.parse(source)
        capture = source.index("(out/artifact).write_text(json.dumps({'snapshot':result,'evidence':evidence")
        project = source.index('result,evidence=normalize_manual_unit_display(')
        self.assertLess(capture, project)
        self.assertIn("manual_unit_legacy[result['tab']]={'snapshot':copy.deepcopy(result),'evidence':copy.deepcopy(evidence)}", source)
        self.assertIn("==original_panel_html)", source)
        self.assertIn("stored)['state'],expected_state('base.initial',page)", source)
        self.assertIn("result=normalize_npc_display(result,evidence", source)


if __name__ == '__main__':
    unittest.main()
