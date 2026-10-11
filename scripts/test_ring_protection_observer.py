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
