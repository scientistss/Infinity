"""Stdlib adversarial tests for the fixed copied-evidence demolition adapter.

Synthetic dictionaries validate adapter strictness, not native DOM/layout.
Native evidence is separately sampled by browser-render-scheduling.py.
"""
from copy import deepcopy
import unittest

from demolition_display_contract import (
    BUILDINGS, JOB_HTML, LABEL, LEVELS, REVIEW_HTML,
    expected_row_html, normalize_demolition_display,
)


def fixture():
    state = {'activePlanetId': 'homeworld', 'planets': [{
        'id': 'homeworld', 'demolition': None,
        'buildings': {**LEVELS, 'terraformer': 0},
        'buildQueue': [{'building': 'metal_storage', 'targetLevel': 5}],
    }], 'protocols': {'slots': [{'card': {'id': 'auto_collect', 'enabled': True}}] + [{'card': None} for _ in range(11)]}}
    inputs, old_inputs, text, old_text, rows, cards, old_cards = [], [], [], [], [], [], []
    for building in BUILDINGS:
        shown = LEVELS[building] > 0
        buy = 'original-' + building
        control = dict(id='', action='enqueue', type='button', value='', disabled=False, checked=None, text=buy)
        inputs.append(control); old_inputs.append(deepcopy(control))
        index = len(inputs) if shown else -1
        if shown:
            inputs.append(dict(id='', action=None, type='button', value='', disabled=False, checked=None, text=LABEL))
        card_text = buy + ('\n' + LABEL if shown else '')
        text.append(card_text); old_text.append(buy)
        row_html = expected_row_html(building)
        old_card = '<article data-bind="bld-' + building + '"><button>' + buy + '</button></article>'
        cards.append(old_card.replace('</article>', row_html + '</article>')); old_cards.append(old_card)
        rows.append(dict(building=building, rowHTML=row_html, rowHidden=not shown, rowVisible=shown,
            cardBinding='bld-' + building, cardText=card_text, buyText=buy, exactPlacement=True,
            button=dict(tag='BUTTON', id='', type='button', value='', disabled=not shown, hidden=not shown, visible=shown, text=LABEL, index=index)))
    prefix, suffix = '<section><h3>资源建筑</h3><div>', '</div></section>'
    html = prefix + JOB_HTML + REVIEW_HTML + ''.join(cards) + suffix
    old_html = prefix + ''.join(old_cards) + suffix
    invariant = [{'html': JOB_HTML}, {'html': REVIEW_HTML}, {'tag': 'DIV', 'attributes': [['class', 'bld-grid']], 'children': cards}]
    projected = dict(tab='facilities', text='\n'.join(text), inputs=inputs, shared={'unchanged': 'exact'},
        facilityEvidence=dict(panelHTML=html, invariantDOM=invariant, controls=[]))
    expected = dict(tab='facilities', text='\n'.join(old_text), inputs=old_inputs, shared={'unchanged': 'exact'},
        facilityEvidence=dict(panelHTML=old_html, invariantDOM=[{'tag': 'DIV', 'attributes': [['class', 'bld-grid']], 'children': old_cards}], controls=[]))
    evidence = dict(panelHTML=html, counts=dict(rows=13, buttons=13, work=1, review=1, confirm=0, cancel=0),
        exactSectionPlacement=True, rows=rows,
        sections=[dict(id='demolition-job', html=JOB_HTML, hidden=True, visible=False), dict(id='demolition-review', html=REVIEW_HTML, hidden=True, visible=False)],
        protocolWarnings=[dict(index=str(index), hidden=True, text='', exactPlacement=True) for index in range(12)])
    return state, projected, evidence, expected


class DisplayContractTests(unittest.TestCase):
    def test_removes_only_verified_additions_from_copies(self):
        state, projected, evidence, expected = fixture()
        snapshots = deepcopy((state, projected, evidence))
        self.assertEqual(normalize_demolition_display(projected, evidence, state, 'after'), expected)
        self.assertEqual((state, projected, evidence), snapshots)

    def test_before_requires_absence_and_returns_unchanged_copy(self):
        state, _, _, before = fixture()
        del state['planets'][0]['demolition']
        evidence = dict(counts=dict(rows=0, buttons=0, work=0, review=0, confirm=0, cancel=0), rows=[], sections=[], protocolWarnings=[])
        result = normalize_demolition_display(before, evidence, state, 'before')
        self.assertEqual(result, before)
        self.assertIsNot(result, before)

    def test_rejects_wrong_fixed_economic_premises(self):
        for alter in (
            lambda state: state['planets'][0]['buildings'].__setitem__('metal_storage', 5),
            lambda state: state['planets'][0].__setitem__('demolition', {'jobId': 99}),
            lambda state: state['planets'][0]['buildQueue'][0].__setitem__('targetLevel', 6),
            lambda state: state['protocols']['slots'][1].__setitem__('card', {'id': 'extra', 'enabled': True}),
        ):
            with self.subTest(alter=alter):
                state, projected, evidence, _ = fixture(); alter(state)
                with self.assertRaises(AssertionError): normalize_demolition_display(projected, evidence, state, 'after')

    def test_rejects_missing_extra_or_moved_native_identity(self):
        for alter in (
            lambda e: e['counts'].__setitem__('buttons', 14),
            lambda e: e.__setitem__('exactSectionPlacement', False),
            lambda e: e['rows'][0].__setitem__('exactPlacement', False),
            lambda e: e['rows'][0].__setitem__('cardBinding', 'bld-terraformer'),
            lambda e: e['rows'][0]['button'].__setitem__('visible', True),
            lambda e: e['rows'][5]['button'].__setitem__('disabled', True),
            lambda e: e['rows'][5]['button'].__setitem__('index', 0),
            lambda e: e['sections'][0].__setitem__('visible', True),
            lambda e: e['protocolWarnings'][0].__setitem__('text', 'unexpected'),
            lambda e: e['protocolWarnings'][11].__setitem__('index', '10'),
        ):
            with self.subTest(alter=alter):
                state, projected, evidence, _ = fixture(); alter(evidence)
                with self.assertRaises(AssertionError): normalize_demolition_display(projected, evidence, state, 'after')

    def test_rejects_changed_complete_added_html_not_just_labels(self):
        for field in ('row', 'section'):
            state, projected, evidence, _ = fixture()
            if field == 'row': evidence['rows'][5]['rowHTML'] = evidence['rows'][5]['rowHTML'].replace('<button ', '<button title="unexpected" ')
            else: evidence['sections'][1]['html'] = REVIEW_HTML.replace('拆除核对', 'changed quote')
            with self.subTest(field=field), self.assertRaises(AssertionError):
                normalize_demolition_display(projected, evidence, state, 'after')

    def test_preserves_every_unrelated_dom_character_and_control(self):
        state, projected, evidence, _ = fixture()
        # This is deliberately outside every authorized removal. The existing
        # full old/new invariant comparator must still see and reject it.
        projected['facilityEvidence']['invariantDOM'][2]['children'][0] += '<strong>unrelated</strong>'
        result = normalize_demolition_display(projected, evidence, state, 'after')
        self.assertTrue(result['facilityEvidence']['invariantDOM'][0]['children'][0].endswith('<strong>unrelated</strong>'))
        self.assertEqual(result['shared'], projected['shared'])


if __name__ == '__main__':
    unittest.main()
