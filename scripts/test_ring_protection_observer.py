"""Offline parser contracts. No JavaScript, Node, Playwright or browser runs.

Run: python3 -m unittest discover -s scripts -p 'test_ring_protection_observer.py' -v
The r10 specimen is the exact complete 911-byte function from failed CI 4afa533,
asset index-mbKX6LBj.js (SHA-256
1f1dfdfd958c98c98a13635b2f5213f77091e6713e85f8d249106af8f1bfea27).
The r9 variant removes only the fixed-floor field, as independently checked in
7f17a121ff35822a85d6889a9823f76bccbff227:src/game/save.ts.
"""
import importlib.util
from pathlib import Path
import re
import unittest

SPEC = importlib.util.spec_from_file_location(
    'ring_protection', Path(__file__).with_name('browser-ring-protection.py'))
RING = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RING)
R10 = 'function na(e){return{terraformerGrantJobFloor:Np(e.terraformerGrantJobFloor,e.orders.nextJobId),buildingTemplates:jg(e.buildingTemplates),formations:Gh(e.formations),researchTemplates:Dg(e.researchTemplates),orders:ng(e.orders),planets:e.planets.map(Hb),activePlanetId:e.activePlanetId,deepSpace:structuredClone(e.deepSpace),universe:{...e.universe},fleets:Kg(e.fleets),messages:e.messages.map(t=>({...t})),nextFleetId:e.nextFleetId,research:ty(e.research),darkMatter:js(e.darkMatter),items:{...e.items},boosters:e.boosters.map(t=>({...t})),arcade:of(e.arcade),lifetime:Di(e.lifetime),warpCores:js(e.warpCores),curvature:{...e.curvature},totalTime:js(e.totalTime),manualClicks:e.manualClicks,seenEnergyShortage:e.seenEnergyShortage,hasPrestiged:e.hasPrestiged,unlockedCards:e.unlockedCards.slice(),protocols:py(e.protocols),unlocked:e.unlocked.slice(),stats:{...e.stats},offlineBonusHours:e.offlineBonusHours}}'
FLOOR = 'terraformerGrantJobFloor:Np(e.terraformerGrantJobFloor,e.orders.nextJobId),'
R9 = R10.replace(FLOOR, '')
# Exact handler-entry excerpts, including the entire recovery guard and original
# state binding. R10 is from the same 4afa asset above. R11 is from failed 52e7ed8
# asset index-DgNH2cNb.js: 634564 bytes, SHA-256
# b42de6329ee54704c3b71f56192ec20ff9d6ee52391e285cf1aae3986f27451a.
HANDLER_R10 = 'async function Qk(e){he.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(he.mode!=="ready"&&!t){ee=he.message,pi();return}const n=B,r=B.unlocked;'
HANDLER_R11 = 'async function Z1(e){var i;ge.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(ge.mode!=="ready"&&!t){te=ge.message,$i();return}const n=j,r=j.unlocked;'


class ProductionActionHandlerTests(unittest.TestCase):
    def assert_unique(self, text, name='Z1', action='e', session='ge', state='j'):
        matches = RING.production_action_handlers(text)
        self.assertEqual(len(matches), 1)
        match = matches[0]
        self.assertEqual([match.group(key) for key in ('name', 'action', 'session', 'state')],
                         [name, action, session, state])
        # Preserve the existing native observer's numbered captures exactly.
        self.assertEqual([match.group(i) for i in (1, 2, 3)], [name, action, session])
        return match

    def test_exact_failed_r11_entry_and_historical_r10_entry(self):
        self.assert_unique(HANDLER_R11)
        self.assert_unique(HANDLER_R10, 'Qk', 'e', 'he', 'B')

    def test_only_uninitialized_var_identifier_list_is_optional(self):
        for declaration in ('', 'var a;', 'var a,b,$temp,_local;'):
            with self.subTest(declaration=declaration):
                self.assert_unique(HANDLER_R11.replace('var i;', declaration))

    def test_variable_names_not_pinned(self):
        text = HANDLER_R11
        for before, after in [('Z1', '$handler'), ('e', '$action'), ('ge', '$session'), ('j', '$state')]:
            text = re.sub(r'(?<![\w$])' + re.escape(before) + r'(?![\w$])', lambda _: after, text)
        self.assert_unique(text, '$handler', '$action', '$session', '$state')

    def test_ambiguous_original_or_new_candidates_fail_native_uniqueness(self):
        for text in (HANDLER_R10 + HANDLER_R11, HANDLER_R11 * 2,
                     HANDLER_R11 + HANDLER_R11.replace('function Z1(', 'function other(')):
            with self.subTest(text=text):
                self.assertEqual(len(RING.production_action_handlers(text)), 2)

    def test_initializers_and_extra_executable_statements_rejected(self):
        for declaration in ('var i=1;', 'var i=sideEffect();', 'var i,a=0;',
                            'var {i}=source;', 'var [i]=source;', 'var i;var a;',
                            'let i;', 'const i=0;', 'i=0;', 'sideEffect();',
                            'var i;sideEffect();', 'var 1bad;', 'var i,;'):
            with self.subTest(declaration=declaration):
                self.assertEqual(RING.production_action_handlers(HANDLER_R11.replace('var i;', declaration)), [])

    def test_complete_original_recovery_guard_required(self):
        for before, after in (
            ('cancelPendingImport();', 'cancelPendingImport();sideEffect();'),
            ('"export-legacy",', ''), ('"dismiss-offline"', '"dismiss-offline","demolition-confirm"'),
            ('"save","export"', '"export","save"'), ('.includes(e.type)', '.includes(other.type)'),
            ('ge.mode', 'other.mode'), ('!=="ready"', '==="ready"'), ('&&!t', '||!t'),
            ('&&!t', '&&!other'), ('ge.message', 'other.message'),
            ('$i();return}', '$i();sideEffect();return}'), ('$i();return}', '$i();}'),
            ('const n=j,r=j.unlocked;', 'const n=j,r=other.unlocked;'),
            ('const n=j,r=j.unlocked;', 'const n=j,r=j.other;'),
            ('const n=j,r=j.unlocked;', 'sideEffect();const n=j,r=j.unlocked;'),
        ):
            with self.subTest(before=before, after=after):
                self.assertEqual(RING.production_action_handlers(HANDLER_R11.replace(before, after)), [])

    def test_non_declarations_and_incomplete_prefixes_rejected(self):
        for text in ('', 'not' + HANDLER_R11, HANDLER_R11.replace('async function', 'function'),
                     HANDLER_R11.replace('async function', 'async function*'),
                     HANDLER_R11[:HANDLER_R11.index('if(')], HANDLER_R11[:-1]):
            with self.subTest(text=text):
                self.assertEqual(RING.production_action_handlers(text), [])

    def test_breakpoint_position_remains_real_handler_entry(self):
        for text in (HANDLER_R10, HANDLER_R11):
            match = RING.production_action_handlers(text)[0]
            position = text.index('{', match.start()) + 1
            self.assertTrue(text[position:].startswith(('var i;', 'he.cancelPendingImport();')))
            # Native CDP still must resolve exactly one real location. Offline
            # parsing neither installs a breakpoint nor claims that it ran.
            self.assertEqual(text[:position].count('{'), 1)


class ProductionSerializerTests(unittest.TestCase):
    def assert_unique(self, text, name='na', state='e'):
        matches = RING.production_serializers(text)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0].group('name'), name)
        self.assertEqual(matches[0].group('state'), state)
        return matches[0]

    def test_exact_failed_r10_complete_function(self):
        self.assertEqual(self.assert_unique(R10).group(), R10)

    def test_historical_r9_complete_function(self):
        self.assertEqual(self.assert_unique(R9).group(), R9)

    def test_minified_identifiers_are_not_pinned(self):
        text = re.sub(r'\be\b', '$input', R10).replace('function na(', 'function $save(')
        self.assert_unique(text, '$save', '$input')

    def test_surrounding_unrelated_functions_do_not_match(self):
        self.assert_unique('function x(e){return{buildingTemplates:e.buildingTemplates}}'
                           + R10 + 'function y(e){return{terraformerGrantJobFloor:1}}')

    def test_duplicate_functions_fail_uniqueness(self):
        for text in (R10 + R10, R9 + R10, R10 + R10.replace('function na(', 'function other(')):
            with self.subTest(text=text):
                # The native observer requires exactly one full-shape match.
                self.assertEqual(len(RING.production_serializers(text)), 2)

    def test_wrong_input_parameter_rejected(self):
        for old, new in (
            ('e.terraformerGrantJobFloor', 'x.terraformerGrantJobFloor'),
            ('e.orders.nextJobId', 'x.orders.nextJobId'),
            ('e.buildingTemplates', 'x.buildingTemplates'),
            ('e.planets.map', 'x.planets.map'),
            ('e.deepSpace', 'x.deepSpace'),
            ('...e.stats', '...x.stats'),
            ('e.unlocked.slice()', 'x.unlocked.slice()'),
            ('t=>({...t})', 't=>({...e})'),
        ):
            with self.subTest(old=old):
                self.assertEqual(RING.production_serializers(R10.replace(old, new)), [])

    def test_wrong_or_missing_fields_rejected(self):
        for text in (
            R10.replace('buildingTemplates:', 'unexpected:'),
            R10.replace('buildingTemplates:jg(e.buildingTemplates),', ''),
            R10.replace('offlineBonusHours:e.offlineBonusHours', 'offlineBonusHours:e.manualClicks'),
            R10.replace('orders.nextJobId', 'orders.otherId'),
            R10.replace('stats:{...e.stats}', 'stats:{...e.stats},extra:e.stats'),
            R10.replace('totalTime:js(e.totalTime)', 'totalTime:wrong(e.totalTime)'),
            R10[:-1],
        ):
            with self.subTest(text=text):
                self.assertEqual(RING.production_serializers(text), [])

    def test_mutations_and_extra_statements_rejected(self):
        for old, new in (
            ('{return{', '{e.manualClicks++;return{'),
            ('{return{', '{return(e.manualClicks++,{'),
            ('manualClicks:e.manualClicks', 'manualClicks:e.manualClicks++'),
            ('e.buildingTemplates)', 'e.buildingTemplates=other)'),
            ('e.unlocked.slice()', 'e.unlocked.splice(0)'),
            ('t=>({...t})', 't=>(sideEffect(),{...t})'),
            ('offlineBonusHours:e.offlineBonusHours}}',
             'offlineBonusHours:e.offlineBonusHours};sideEffect()}'),
        ):
            with self.subTest(old=old):
                self.assertEqual(RING.production_serializers(R10.replace(old, new)), [])

    def test_empty_or_prefix_only_rejected(self):
        for text in ('', 'function fake(e){return{buildingTemplates:',
                     'function fake(e){return{terraformerGrantJobFloor:'):
            self.assertEqual(RING.production_serializers(text), [])

    def test_only_synchronous_function_declaration_shape(self):
        for text in ('async ' + R10, 'not' + R10, R10.replace('function na(', 'function* na(')):
            self.assertEqual(RING.production_serializers(text), [])


if __name__ == '__main__':
    unittest.main()
