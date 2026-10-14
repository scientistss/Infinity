"""Offline independent display negatives; no claim of browser/native coverage."""
from copy import deepcopy
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import energy_challenge_display_contract as C


STATE = {'energyChallenge': deepcopy(C.DEFAULT), 'orders': {'nextJobId': 1},
         'lifetime': {'metal': '0', 'crystal': '0', 'deuterium': '0'}, 'curvature': {'score_boost': 0},
         'planets': [{'id': 'homeworld', 'name': '母星', 'coordinates': {'galaxy': 1, 'system': 50, 'position': 8},
                      'buildings': dict.fromkeys((key for key, _ in C.BUILDINGS), 0)}]}
ANCHOR = '<div class="prestige-panel">Legacy launch</div>'
PREVIEW = '<section id="prestige-preview"><button id="old" type="button">Legacy preview</button></section>'
OLD_INPUT = {'id': 'old', 'action': None, 'type': 'button', 'value': '', 'disabled': False, 'checked': None, 'text': 'Legacy preview'}


def fixture(side='after', painted=False, whole=True, eligible=False):
    state = deepcopy(STATE)
    if eligible: state['lifetime']['metal'] = '1000000'
    after = side == 'after'
    block = C.expected_html(state, painted) if after else ''
    panel_html = '<section data-tab-panel="curvature"' + ('' if painted else ' hidden=""') + '>' + ANCHOR + block + PREVIEW + '</section>'
    body_html = '<body><main>' + panel_html + '<button id="later" type="button">Later control</button></main></body>'
    body = C._Tree(body_html).roots[0]; body_path = 'HTML/BODY:1'; nodes = dict(C._walk(body, body_path))
    panel_path = body_path + '/MAIN:0/SECTION:0'; panel = nodes[panel_path]
    all_fields = []
    for path, node in nodes.items():
        if node['tag'] in ('button', 'details'):
            all_fields.append({'path': path, 'value': '' if node['tag'] == 'button' else None, 'checked': None,
                               'disabled': 'disabled' in node['attrs'] if node['tag'] == 'button' else None,
                               'open': False if node['tag'] == 'details' else None, 'selectionStart': None, 'selectionEnd': None, 'selected': None})
    focus = next(path for path, node in nodes.items() if node['attrs'].get('id') == 'old')
    visible_inputs = [deepcopy(OLD_INPUT)] if painted else []
    addition = None
    block_text = ''
    if after:
        addition_path = panel_path + '/SECTION:1'; expected = nodes[addition_path]
        eligible, status = C.entry_status(state)
        block_text = '\n'.join((C.TITLE, C.SUMMARY, status, C.BUTTONS[0][1], C.RULE_TITLE)) if painted else C._text(expected)
        controls = [{'id': 'energy-challenge-' + name, 'native': True, 'connected': True, 'type': 'button', 'value': '',
                     'disabled': not (painted and name == 'enter' and eligible), 'hidden': painted and name in ('finish', 'abandon'),
                     'visible': painted and name == 'enter', 'text': label} for name, label in C.BUTTONS]
        addition = {'html': block, 'text': block_text, 'textContent': C._text(expected), 'path': addition_path, 'parentPath': panel_path,
                    'native': True, 'connected': True, 'hidden': False, 'visible': painted, 'exactPlacement': True, 'ids': list(C.IDS),
                    'fields': C._fields(expected, addition_path), 'controls': controls, 'interactiveCount': 7,
                    'rulesOpen': False, 'reviewHidden': True, 'reviewDetailsOpen': False}
        if painted:
            visible_inputs.insert(0, {'id': 'energy-challenge-enter', 'action': None, 'type': 'button', 'value': '', 'disabled': not eligible, 'checked': None, 'text': C.BUTTONS[0][1]})
    panel_text = ('Legacy launch\n' + (block_text + '\n' if after else '') + 'Legacy preview') if painted else C._text(panel)
    evidence = {'bodyHTML': body_html, 'bodyText': panel_text, 'bodyPath': body_path, 'bodyFields': all_fields, 'bodyFocus': focus,
                'panelHTML': panel_html, 'panelText': panel_text, 'panelPath': panel_path, 'panelCount': 1, 'panelNative': True, 'panelVisible': painted,
                'visibleControls': visible_inputs, 'anchorCount': 1, 'anchorHTML': ANCHOR, 'anchorPath': panel_path + '/DIV:0',
                'counts': dict.fromkeys(C.IDS, int(after)), 'prefixCount': len(C.IDS) if after else 0, 'addition': addition}
    snapshot = {'html': body_html, 'fields': deepcopy(all_fields), 'focus': focus, 'at': 100, 'events': [{'type': 'click', 'target': 'fleet'}],
                'raw': 'preserve original saved bytes', 'storage': {'original-key': 'original value'}, 'viewport': {'width': 1440, 'height': 900}}
    if not whole:
        snapshot = {'tab': 'curvature', 'text': panel_text, 'inputs': deepcopy(visible_inputs), 'shared': {'metal': '123.45', 'status': 'original status'}}
    if not after: del state['energyChallenge']
    return snapshot, evidence, state


def normalize(parts, side='after'): return C.normalize_energy_challenge_display(*parts, side)


def change_block(parts, old, new):
    snapshot, evidence, _ = parts
    for key in ('bodyHTML', 'panelHTML'): evidence[key] = evidence[key].replace(old, new)
    evidence['addition']['html'] = evidence['addition']['html'].replace(old, new)
    if 'html' in snapshot: snapshot['html'] = evidence['bodyHTML']


class EnergyChallengeDisplayContract(unittest.TestCase):
    def test_source_hashes_and_unique_install_fragments_are_bound(self):
        checked = C.assert_energy_challenge_source_contract()
        for name, digest in C.SOURCE_SHA256.items(): self.assertEqual(checked[name], digest)
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in C.SOURCE_SHA256.keys() | C.SOURCE_FRAGMENTS.keys():
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes((Path(C.__file__).resolve().parents[1] / name).read_bytes())
            C.assert_energy_challenge_source_contract(root)
            path = root / 'src/ui/energy-challenge-panel.ts'; path.write_text(path.read_text() + '\n// unreviewed change\n')
            with self.assertRaisesRegex(AssertionError, 'source drift'): C.assert_energy_challenge_source_contract(root)

    def test_hidden_default_projects_exact_whole_body_fields_and_focus_paths(self):
        current, old = fixture(), fixture('before'); frozen = deepcopy(current)
        projected = normalize(current)
        self.assertEqual(projected, old[0])
        self.assertEqual(current, frozen)
        for key in ('raw', 'storage', 'events', 'at', 'viewport'): self.assertEqual(projected[key], current[0][key])
        self.assertIsNot(projected['events'], current[0]['events'])
        self.assertEqual(len(current[0]['fields']) - len(projected['fields']), 7)
        self.assertIn('/SECTION:1/BUTTON:0', projected['focus'])

    def test_visible_inactive_projection_keeps_all_old_text_controls_and_shared_fields(self):
        for eligible in (False, True):
            current = fixture(painted=True, whole=False, eligible=eligible)
            old = fixture('before', painted=True, whole=False, eligible=eligible)
            frozen = deepcopy(current)
            self.assertEqual(normalize(current), old[0]); self.assertEqual(current, frozen)
            projected = C.project_energy_challenge_display(current[1], current[2], 'after')
            self.assertEqual(projected['panelHTML'], old[1]['panelHTML'])

    def test_historical_absence_and_no_current_authority_are_required(self):
        parts = fixture('before')
        self.assertEqual(normalize(parts, 'before'), parts[0])
        for mutate in (lambda p: p[2].update(energyChallenge=deepcopy(C.DEFAULT)),
                       lambda p: p[1].update(prefixCount=1),
                       lambda p: p[1]['counts'].update({'energy-challenge-title': 1}),
                       lambda p: p[1].update(addition={})):
            parts = fixture('before'); mutate(parts)
            with self.assertRaises(AssertionError): normalize(parts, 'before')

    def test_active_complete_replayed_attempt_and_review_fail_closed(self):
        for field, value in [('active', {'attemptId': 1}), ('completion', {'receipt': True}), ('nextAttemptId', 2), ('nextAttemptId', True)]:
            parts = fixture(); parts[2]['energyChallenge'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): normalize(parts)
        for field, value in [('rulesOpen', True), ('reviewHidden', False), ('reviewDetailsOpen', True)]:
            parts = fixture(); parts[1]['addition'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): normalize(parts)
        parts = fixture(); change_block(parts, 'id="energy-challenge-review-summary"></p>', 'id="energy-challenge-review-summary">stale intent</p>')
        with self.assertRaises(AssertionError): normalize(parts)

    def test_each_identifier_must_be_globally_unique_and_exactly_ordered(self):
        for identifier in C.IDS:
            for count in (0, 2):
                parts = fixture(); parts[1]['counts'][identifier] = count
                with self.subTest(identifier=identifier, count=count), self.assertRaises(AssertionError): normalize(parts)
        for mutate in (lambda p: p[1]['addition']['ids'].reverse(),
                       lambda p: p[1]['addition']['ids'].append('energy-challenge-extra'),
                       lambda p: p[1].update(prefixCount=len(C.IDS) + 1)):
            parts = fixture(); mutate(parts)
            with self.assertRaises(AssertionError): normalize(parts)

    def test_complete_markup_text_attributes_and_unexpected_controls_are_rejected(self):
        for old, new in [('规则与读档说明', 'changed rules'), ('自动曲率不可启用', '自动曲率可启用'),
                         ('role="status"', 'role="alert"'), ('aria-live="polite"', 'aria-live="assertive"'),
                         ('tabindex="-1"', 'tabindex="0"'), ('type="button"', 'type="submit"'),
                         ('disabled=""', ''), ('hidden=""', ''),
                         ('id="energy-challenge-rules">', 'id="energy-challenge-rules" open="">'),
                         ('</summary>', '</summary><a href="/other">unexpected action</a>'),
                         ('</summary>', '</summary><!-- hidden change -->')]:
            parts = fixture(); change_block(parts, old, new)
            with self.subTest(old=old), self.assertRaises(AssertionError): normalize(parts)

    def test_every_control_permission_and_property_is_checked(self):
        for index in range(5):
            for key, value in [('native', False), ('connected', False), ('disabled', False), ('type', 'submit'),
                               ('value', 'new'), ('hidden', True), ('visible', True), ('text', 'changed')]:
                parts = fixture(); parts[1]['addition']['controls'][index][key] = value
                with self.subTest(index=index, field=key), self.assertRaises(AssertionError): normalize(parts)
        parts = fixture(painted=True); parts[1]['addition']['controls'][0]['disabled'] = False
        with self.assertRaises(AssertionError): normalize(parts)

    def test_moved_wrapped_or_duplicate_addition_fails_even_with_claimed_correct_placement(self):
        for transform in (lambda panel, block: panel.replace(ANCHOR + block, block + ANCHOR),
                          lambda panel, block: panel.replace(block, block * 2),
                          lambda panel, block: panel.replace(block, '<div>' + block + '</div>')):
            parts = fixture(); snapshot, evidence, _ = parts
            old = evidence['panelHTML']; new = transform(old, evidence['addition']['html'])
            evidence['panelHTML'] = new; evidence['bodyHTML'] = evidence['bodyHTML'].replace(old, new); snapshot['html'] = evidence['bodyHTML']
            with self.assertRaises(AssertionError): normalize(parts)

    def test_snapshot_binding_and_field_or_focus_tampering_fail_closed(self):
        for mutate in (lambda p: p[0].update(html='different body'),
                       lambda p: p[0]['fields'].pop(),
                       lambda p: p[0].update(focus='HTML/BODY:1'),
                       lambda p: p[1]['addition']['fields'][0].update(disabled=False),
                       lambda p: p[1].update(panelPath='HTML/BODY:1/MAIN:0/SECTION:1')):
            parts = fixture(); mutate(parts)
            with self.assertRaises((AssertionError, KeyError)): normalize(parts)
        parts = fixture(); path = parts[1]['addition']['fields'][0]['path']
        parts[0]['focus'] = parts[1]['bodyFocus'] = path
        with self.assertRaisesRegex(AssertionError, 'inside removed addition'): normalize(parts)

    def test_old_content_and_storage_changes_survive_for_parity_to_reject(self):
        baseline = normalize(fixture())
        parts = fixture(); parts[0]['storage']['original-key'] = 'changed'; parts[0]['events'].append({'type': 'change'})
        projected = normalize(parts)
        self.assertEqual(projected['storage'], parts[0]['storage']); self.assertEqual(projected['events'], parts[0]['events'])
        self.assertNotEqual(projected, baseline)
        parts = fixture(); snapshot, evidence, _ = parts
        for key in ('bodyHTML', 'panelHTML', 'anchorHTML'): evidence[key] = evidence[key].replace('Legacy launch', 'Changed launch')
        evidence['panelText'] = evidence['panelText'].replace('Legacy launch', 'Changed launch'); snapshot['html'] = evidence['bodyHTML']
        projected = normalize(parts)
        self.assertIn('Changed launch', projected['html']); self.assertNotEqual(projected['html'], baseline['html'])

    def test_sample_is_observation_only_and_not_a_dom_rewrite(self):
        for token in ('.remove(', '.replaceWith(', '.append(', '.insertAdjacent', '.innerHTML=', '.outerHTML=', 'localStorage.setItem', '.click(', 'cloneNode('):
            self.assertNotIn(token, C.SAMPLE_JS)
        self.assertIn('document.body.outerHTML', C.SAMPLE_JS)
        self.assertIn('getComputedStyle', C.SAMPLE_JS)
        self.assertIn('anchor.nextSibling===addition', C.SAMPLE_JS)


if __name__ == '__main__': unittest.main()
