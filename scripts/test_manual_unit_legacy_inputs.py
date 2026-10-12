"""Offline runner-preparation contracts, never browser or production-UI evidence.

Execute only the five reviewed input blocks against an explicitly independent
small double. No runner imports, Playwright, Node, sockets or browser startup.
"""
import ast
import copy
import json
from pathlib import Path
import re
import textwrap
import unittest


ROOT = Path(__file__).resolve().parent
BLOCKS = {
    'orders': ('browser-orders.py',
        '                quantity = page.locator(\'[data-bind="uqty-light_fighter"]\')',
        '            after_new = read(page)'),
    'locked-probe': ('browser-npc-economy.py',
        "        tab(page, 'shipyard')\n        # Locked units",
        "        tab(page, 'research');"),
    'paid-probe': ('browser-npc-economy.py',
        "        tab(page, 'shipyard')\n        check('probe manual quantity",
        "        probe_paid = save(page"),
    'attack': ('browser-npc-attack.py',
        "            tab(page, 'shipyard'); input_number(page, '[data-bind=\"uqty-'",
        "        elif kind in ('scout', 'attack'):"),
    'scout': ('browser-scout-rehearsal.py',
        "    tab(page,'shipyard');input_number(page,'[data-bind=\"uqty-light_fighter\"]',1)",
        "    whole_state('actual-paid-seventh-fighter-queue'"),
}


def block(name):
    filename, start, end = BLOCKS[name]
    source = (ROOT / filename).read_text()
    assert source.count(start) == 1, 'Review the changed preparation boundary'
    offset = source.index(start)
    return textwrap.dedent(source[offset:source.index(end, offset)])


class ControlDouble:
    def __init__(self, page, role):
        self.page, self.role = page, role
        self.disabled = role == 'pay'
        self.attrs = {'aria-pressed': 'false'}
        if role == 'mode':
            self.attrs.update({'data-action': 'manual-unit-mode', 'data-mode': 'count', 'data-id': page.unit})
        elif role == 'pay':
            self.attrs.update({'data-action': 'manual-unit-pay', 'data-id': page.unit})

    def input_value(self):
        assert self.role == 'quantity'
        return self.page.quantity

    def fill(self, value):
        assert self.role == 'quantity' and not self.disabled
        self.page.quantity = value
        self.page.events.append(('input', value))

    def inner_text(self):
        if self.role in ('reason', 'manual-reason'):
            return '需要 燃烧引擎 3'
        assert self.role == 'total'
        count = int(self.page.quantity)
        metal = 0 if self.page.unit == 'espionage_probe' else 3000 * count
        return f'金属 {metal:,} · 晶体 {1000 * count:,} · 重氢 0'

    def click(self):
        assert not self.disabled, 'Disabled controls cannot be clicked'
        self.page.events.append(('click', self.role))
        if self.role == 'mode':
            self.attrs['aria-pressed'] = 'true'
            self.page.controls['pay'].disabled = self.page.locked
            if self.page.regression == 'mode-pays':
                self.page.state['payments'] += 1
        else:
            assert self.role == 'pay' and not self.page.locked
            assert self.page.controls['mode'].attrs['aria-pressed'] == 'true'
            self.page.state['payments'] += 1
            self.page.state['queue'].append({'unit': self.page.unit, 'count': int(self.page.quantity)})
            self.disabled = self.page.regression != 'reusable-payment'


class PageDouble:
    def __init__(self, unit, locked=False, regression=None):
        self.unit, self.locked, self.regression = unit, locked, regression
        self.quantity, self.events = '1', []
        self.state = {'payments': 0, 'queue': [], 'unrelated': {'unchanged': [1, 2, 3]}}
        self.controls = {role: ControlDouble(self, role)
                         for role in ('quantity', 'mode', 'pay', 'total', 'reason', 'manual-reason')}

    def locator(self, selector):
        attrs = dict(re.findall(r'\[([^=]+)="([^"]+)"\]', selector))
        if 'data-bind' in attrs:
            prefix, unit = attrs.pop('data-bind').rsplit('-', 1)
            assert unit == self.unit
            role = {'uqty': 'quantity', 'ubuild': 'mode', 'upay': 'pay', 'utotal': 'total',
                    'ureason': 'reason', 'umanual-reason': 'manual-reason'}[prefix]
        else:
            role = {'manual-unit-mode': 'mode', 'manual-unit-pay': 'pay'}[attrs['data-action']]
        control = self.controls[role]
        assert all(control.attrs.get(key) == value for key, value in attrs.items()), selector
        return control


class ExpectDouble:
    def __init__(self, control):
        self.control = control

    def to_have_attribute(self, key, value):
        assert self.control.attrs[key] == value

    def to_be_enabled(self):
        assert not self.control.disabled

    def to_be_disabled(self):
        assert self.control.disabled

    def to_have_text(self, value):
        assert self.control.inner_text() == value


def execute(name, regression=None):
    page = PageDouble('espionage_probe' if 'probe' in name else 'light_fighter',
                      locked=name == 'locked-probe', regression=regression)

    def check(label, condition):
        assert condition, label

    scope = {'page': page, 'expect': ExpectDouble, 'check': check,
             'tab': lambda page, name: None,
             'input_number': lambda page, selector, value: page.locator(selector).fill(str(value)),
             'trusted_click': lambda page, selector: page.locator(selector).click(),
             'raw': lambda page: json.dumps(page.state),
             'read': lambda page: copy.deepcopy(page.state),
             'operation': {'unit': 'light_fighter', 'count': 3}}
    exec(compile(block(name), f'<offline-preparation-{name}>', 'exec'), scope)
    return page


class ManualUnitLegacyInputs(unittest.TestCase):
    def test_all_changed_runners_parse_without_importing_or_running_them(self):
        for filename in {row[0] for row in BLOCKS.values()}:
            with self.subTest(filename=filename):
                source = (ROOT / filename).read_text()
                ast.parse(source)
                self.assertNotIn('[data-action="build-units"]', source)

    def test_each_paid_site_preserves_quantity_then_selects_and_pays_once(self):
        for name, count in [('orders', 1), ('paid-probe', 1), ('attack', 3), ('scout', 1)]:
            with self.subTest(name=name):
                page = execute(name)
                expected = ([] if name == 'paid-probe' else [('input', str(count))])
                self.assertEqual(page.events, expected + [('click', 'mode'), ('click', 'pay')])
                self.assertEqual(page.state['payments'], 1)
                self.assertEqual(page.state['queue'], [{'unit': page.unit, 'count': count}])
                self.assertTrue(page.controls['pay'].disabled)

    def test_locked_probe_inspects_mode_without_authorizing_payment(self):
        page = execute('locked-probe')
        self.assertEqual(page.events, [('click', 'mode')])
        self.assertEqual(page.state['payments'], 0)
        self.assertEqual(page.state['queue'], [])
        self.assertFalse(page.controls['mode'].disabled)
        self.assertTrue(page.controls['pay'].disabled)

    def test_every_site_rejects_legacy_mode_click_that_pays(self):
        for name in BLOCKS:
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    execute(name, 'mode-pays')

    def test_paid_sites_require_consumption_of_the_separate_payment(self):
        for name in set(BLOCKS) - {'locked-probe'}:
            with self.subTest(name=name):
                with self.assertRaises(AssertionError):
                    execute(name, 'reusable-payment')

    def test_existing_economic_and_whole_state_oracles_are_retained(self):
        required = {
            'browser-orders.py': ['replacement gets new node and identity',
                                  'stale command cannot cancel replacement', 'old displayed command keeps exact home payer'],
            'browser-npc-economy.py': ["wallet_debit(research_done, probe_paid, {'metal': 0, 'crystal': 1000, 'deuterium': 0}, 'probe203')",
                                      "planet(probe_paid)['shipyardQueue'][0]['jobId'] == 203"],
            'browser-npc-attack.py': ["name = operation['name']; actual = save(page, name)",
                                     'native paid attack obeys exact W+r fuel equation'],
            'browser-scout-rehearsal.py': ["whole_state('actual-paid-seventh-fighter-queue',save(page),branch['afterShip']['envelope']['state'])",
                                         "whole_state('actual-paid-weapons2-queue',save(page),branch['paid']['envelope']['state'])"],
        }
        for filename, expectations in required.items():
            source = (ROOT / filename).read_text()
            for expected in expectations:
                with self.subTest(filename=filename, expected=expected):
                    self.assertIn(expected, source)


if __name__ == '__main__':
    unittest.main()
