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
# Explicit current shape built from the frozen old specimen, not from current output.
NPC = 'npcEconomy:npcSave(e.npcEconomy),'
R12 = R10.replace('{return{', '{return{' + NPC)
# Exact handler-entry excerpts, including the entire recovery guard and original
# state binding. R10 is from the same 4afa asset above. R11 is from failed 52e7ed8
# asset index-DgNH2cNb.js: 634564 bytes, SHA-256
# b42de6329ee54704c3b71f56192ec20ff9d6ee52391e285cf1aae3986f27451a.
HANDLER_R10 = 'async function Qk(e){he.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(he.mode!=="ready"&&!t){ee=he.message,pi();return}const n=B,r=B.unlocked;'
HANDLER_R11 = 'async function Z1(e){var i;ge.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(ge.mode!=="ready"&&!t){te=ge.message,$i();return}const n=j,r=j.unlocked;'

# Exact index-DWoykfzY.js (730893 bytes), SHA-256 f22c0e6c1138c2cbac4b3be3dd8cf07c68c5de211ff6110b39ad85008d55015f.
R14_CURRENT = 'function gl(e){sd(e,!1);const t=od(e.messages);du(e,!1),Kf(e),_h(e,t);const n=wa(e.universe.seed,ri,e.planets.map(r=>r.coordinates));return{npcEconomy:au(e.npcEconomy,n),npcBattles:cu(e.npcBattles,n),terraformerGrantJobFloor:Uh(e.terraformerGrantJobFloor,e.orders.nextJobId),buildingTemplates:fk(e.buildingTemplates),formations:V0(e.formations),researchTemplates:gk(e.researchTemplates),orders:lv(e.orders),planets:e.planets.map(y$),activePlanetId:e.activePlanetId,deepSpace:structuredClone(e.deepSpace),universe:{...e.universe},fleets:Ek(e.fleets),messages:t,nextFleetId:e.nextFleetId,research:M$(e.research),darkMatter:In(e.darkMatter),items:{...e.items},boosters:e.boosters.map(r=>({...r})),arcade:bg(e.arcade),lifetime:Ao(e.lifetime),warpCores:In(e.warpCores),curvature:{...e.curvature},totalTime:In(e.totalTime),manualClicks:e.manualClicks,seenEnergyShortage:e.seenEnergyShortage,hasPrestiged:e.hasPrestiged,unlockedCards:e.unlockedCards.slice(),protocols:B$(e.protocols),unlocked:e.unlocked.slice(),stats:{...e.stats},offlineBonusHours:e.offlineBonusHours}}'
HANDLER_R14_CURRENT = 'async function Xx(e){var i;["import-text","import-file","reset","prestige"].includes(e.type)&&xe.retireNpcRehearsal(),Ee.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(Ee.mode!=="ready"&&!t){le=Ee.message,tr();return}const n=U,r=U.unlocked;'
# Exact index-uJeA16cu.js (700817 bytes), SHA-256 dc8be0411492d1b63fd4d8a5be6561f7ddc062d50f2f9d47509f24d9b8ce13e2.
R13_FIXED = 'function tl(e){Zc(e,!1),kf(e);const t=pa(e.universe.seed,Kr,e.planets.map(n=>n.coordinates));return{npcEconomy:Fc(e.npcEconomy,t),npcBattles:Dc(e.npcBattles,t),terraformerGrantJobFloor:ch(e.terraformerGrantJobFloor,e.orders.nextJobId),buildingTemplates:_v(e.buildingTemplates),formations:f0(e.formations),researchTemplates:Mv(e.researchTemplates),orders:E0(e.orders),planets:e.planets.map(Ak),activePlanetId:e.activePlanetId,deepSpace:structuredClone(e.deepSpace),universe:{...e.universe},fleets:jv(e.fleets),messages:e.messages.map(n=>({...n})),nextFleetId:e.nextFleetId,research:Uk(e.research),darkMatter:gn(e.darkMatter),items:{...e.items},boosters:e.boosters.map(n=>({...n})),arcade:qh(e.arcade),lifetime:go(e.lifetime),warpCores:gn(e.warpCores),curvature:{...e.curvature},totalTime:gn(e.totalTime),manualClicks:e.manualClicks,seenEnergyShortage:e.seenEnergyShortage,hasPrestiged:e.hasPrestiged,unlockedCards:e.unlockedCards.slice(),protocols:Yk(e.protocols),unlocked:e.unlocked.slice(),stats:{...e.stats},offlineBonusHours:e.offlineBonusHours}}'
HANDLER_R13_FIXED = 'async function JE(e){var i;ge.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(ge.mode!=="ready"&&!t){re=ge.message,Qn();return}const n=q,r=q.unlocked;'

# Actual precommit index-C_2plJQU.js: 771638 bytes, SHA256 13c1c19438a2003c7284a43a26e5444fb16f2d21bf4cdc9a65405156e35b8361.
# This exact parser specimen is not release or native acceptance.
HANDLER_MANUAL_UNIT_CURRENT = 'async function h_(e){var i;["import-text","import-file","reset","prestige"].includes(e.type)&&(Ee.retireNpcRehearsal(),Ee.retireManualUnits()),Me.cancelPendingImport();const t=["save","export","export-legacy","import-text","import-file","reset","dismiss-notice","dismiss-offline"].includes(e.type);if(Me.mode!=="ready"&&!t){fe=Me.message,vr();return}const n=W,r=W.unlocked;'

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

    def test_exact_fixed_r13_and_actual_r14_handler_entries(self):
        self.assert_unique(HANDLER_R13_FIXED, 'JE', 'e', 'ge', 'q')
        self.assert_unique(HANDLER_R14_CURRENT, 'Xx', 'e', 'Ee', 'U')
        for text in (HANDLER_R14_CURRENT * 2, HANDLER_R14_CURRENT + HANDLER_R13_FIXED,
                     HANDLER_R14_CURRENT + HANDLER_R10):
            self.assertEqual(len(RING.production_action_handlers(text)), 2)

    def test_actual_manual_unit_handler_preserves_historical_capture_positions(self):
        self.assert_unique(HANDLER_MANUAL_UNIT_CURRENT, 'h_', 'e', 'Me', 'W')
        renamed = HANDLER_MANUAL_UNIT_CURRENT.replace('Ee.', '$view.')
        self.assert_unique(renamed, 'h_', 'e', 'Me', 'W')
        for other in (HANDLER_MANUAL_UNIT_CURRENT, HANDLER_R14_CURRENT, HANDLER_R13_FIXED, HANDLER_R10):
            self.assertEqual(len(RING.production_action_handlers(HANDLER_MANUAL_UNIT_CURRENT + other)), 2)

    def test_manual_retirement_requires_exact_same_view_sequence_without_other_effects(self):
        for before, after in (
            ('"import-text","import-file","reset","prestige"', '"import-text","reset","prestige"'),
            ('"reset","prestige"', '"reset","prestige","save"'),
            ('includes(e.type)', 'includes(other.type)'),
            ('&&(Ee.', '||(Ee.'),
            ('Ee.retireNpcRehearsal(),Ee.retireManualUnits()', 'Ee.retireManualUnits(),Ee.retireNpcRehearsal()'),
            ('Ee.retireManualUnits()', 'other.retireManualUnits()'),
            ('retireManualUnits()', 'retireManualUnits(e)'),
            ('retireNpcRehearsal()', 'retireNpcRehearsal(e)'),
            ('Ee.retireManualUnits()', 'Ee.sendFleet()'),
            ('Ee.retireManualUnits()', 'Ee.retireManualUnits(),sideEffect()'),
            ('Ee.retireNpcRehearsal(),', 'Ee.retireNpcRehearsal(),sideEffect(),'),
            (',Ee.retireManualUnits()', ''),
            ('&&(Ee.retireNpcRehearsal(),Ee.retireManualUnits()),', '&&Ee.retireNpcRehearsal(),Ee.retireManualUnits(),'),
            ('var i;', 'var i=sideEffect();'),
            ('Me.cancelPendingImport();', 'Me.cancelPendingImport();sideEffect();'),
            ('const n=W,r=W.unlocked;', 'const n=W,r=other.unlocked;'),
        ):
            with self.subTest(before=before, after=after):
                self.assertIn(before, HANDLER_MANUAL_UNIT_CURRENT)
                self.assertEqual(RING.production_action_handlers(HANDLER_MANUAL_UNIT_CURRENT.replace(before, after, 1)), [])

    def test_r14_retirement_admits_only_exact_actions_method_and_arguments(self):
        for before, after in (
            ('"import-text","import-file","reset","prestige"', '"import-text","reset","prestige"'),
            ('"reset","prestige"', '"reset","prestige","save"'),
            ('"import-text","import-file"', '"import-file","import-text"'),
            ('includes(e.type)&&xe', 'includes(other.type)&&xe'),
            ('&&xe.retireNpcRehearsal()', '||xe.retireNpcRehearsal()'),
            ('retireNpcRehearsal()', 'retireNpcRehearsal(e)'),
            ('retireNpcRehearsal()', 'sendFleet()'),
            ('retireNpcRehearsal(),', 'retireNpcRehearsal(),sideEffect(),'),
            ('var i;', 'var i=sideEffect();'),
            ('Ee.cancelPendingImport();', 'Ee.cancelPendingImport();sideEffect();'),
            ('const n=U,r=U.unlocked;', 'const n=U,r=other.unlocked;'),
        ):
            with self.subTest(before=before):
                self.assertEqual(RING.production_action_handlers(HANDLER_R14_CURRENT.replace(before, after)), [])

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
        for text in (HANDLER_R10, HANDLER_R11, HANDLER_R13_FIXED, HANDLER_R14_CURRENT):
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


    def test_actual_r14_current_and_fixed_r13_complete_functions(self):
        self.assertEqual(self.assert_unique(R14_CURRENT, 'gl').group(), R14_CURRENT)
        self.assertEqual(self.assert_unique(R13_FIXED, 'tl').group(), R13_FIXED)
        self.assertEqual(self.assert_unique(R14_CURRENT.replace('du(e,!1),Kf(e),_h(e,t);',
                                                              'du(e,!1);Kf(e);_h(e,t);'), 'gl').group('messages'), 't')
        for text in (R14_CURRENT * 2, R14_CURRENT + R13_FIXED, R14_CURRENT + R12, R14_CURRENT + R9):
            self.assertEqual(len(RING.production_serializers(text)), 2)
        changed = re.sub(r'(?<![\w$])e(?![\w$])', '$input', R14_CURRENT).replace('function gl(', 'function $serialize(')
        self.assert_unique(changed, '$serialize', '$input')

    def test_r14_all_validation_steps_and_exact_message_local_are_required(self):
        for before, after in (
            ('sd(e,!1);', ''), ('sd(e,!1)', 'sd(e,!0)'), ('sd(e,!1)', 'sd(other,!1)'),
            ('const t=od(e.messages);', ''), ('od(e.messages)', 'od(other.messages)'),
            ('od(e.messages)', 'od(e.messages,extra)'), ('od(e.messages)', '(sideEffect(),od(e.messages))'),
            ('const t=', 'let t='), ('du(e,!1),', ''), ('du(e,!1)', 'du(e,!0)'),
            ('Kf(e),', ''), ('Kf(e)', 'Kf(other)'), ('_h(e,t);', ''), ('_h(e,t)', '_h(e,other)'),
            ('_h(e,t)', '_h(other,t)'), ('_h(e,t)', '_h(e,t,extra)'), ('_h(e,t);', '_h(e,t);sideEffect();'),
            ('messages:t,', 'messages:e.messages,'), ('messages:t,', 'messages:od(e.messages),'),
            ('messages:t,', 'messages:t.map(x=>({...x})),'), ('messages:t,', 'messages:(sideEffect(),t),'),
            ('messages:t,', ''), ('ri,e.planets', '513,e.planets'), ('r=>r.coordinates', 'r=>e.coordinates'),
            ('au(e.npcEconomy,n)', 'au(e.npcEconomy,t)'), ('cu(e.npcBattles,n)', 'cu(e.npcBattles,t)'),
            ('e.terraformerGrantJobFloor', 'other.terraformerGrantJobFloor'), ('e.orders.nextJobId', 'other.orders.nextJobId'),
            ('e.buildingTemplates', 'other.buildingTemplates'), ('e.deepSpace', 'other.deepSpace'),
            ('r=>({...r})', 'r=>({...e})'), ('In(e.totalTime)', 'other(e.totalTime)'),
            ('...e.stats', '...other.stats'), ('e.unlocked.slice()', 'e.unlocked.splice(0)'),
            ('offlineBonusHours:e.offlineBonusHours', 'offlineBonusHours:e.offlineBonusHours,extra:true'),
        ):
            with self.subTest(before=before):
                self.assertEqual(RING.production_serializers(R14_CURRENT.replace(before, after)), [])
        for text in ('async ' + R14_CURRENT, 'not' + R14_CURRENT, R14_CURRENT[:-1],
                     R14_CURRENT.replace('function gl(', 'function* gl(')):
            self.assertEqual(RING.production_serializers(text), [])

    def test_r13_exact_wallet_receipt_validation_prefix_and_all_old_fields(self):
        prefix = 'validate(e,!1);crosslinks(e);const c=context(e.universe.seed,512,e.planets.map(p=>p.coordinates));return{npcEconomy:wallet(e.npcEconomy,c),npcBattles:battles(e.npcBattles,c),'
        current = R12.replace('return{' + NPC, prefix)
        self.assertEqual(self.assert_unique(current).group(),current)
        self.assertEqual(self.assert_unique(current.replace('validate(e,!1);crosslinks(e);','validate(e,!1),crosslinks(e);')).group('state'),'e')
        for before,after in (
            ('validate(e,!1);',''), ('crosslinks(e);',''), ('validate(e,!1)','validate(e,!0)'),
            ('e.universe.seed','x.universe.seed'), ('512','513'), ('p.coordinates','x.coordinates'),
            ('wallet(e.npcEconomy,c)','wallet(e.npcEconomy,other)'), ('battles(e.npcBattles,c)','battles(e.npcBattles,other)'),
            ('npcBattles:battles(e.npcBattles,c),',''), ('c=context','c=(sideEffect(),context'),
            ('return{npcEconomy:','extra();return{npcEconomy:'), ('...e.stats','...x.stats'),
        ):
            with self.subTest(before=before):self.assertEqual(RING.production_serializers(current.replace(before,after)),[])

    def test_r12_exact_first_npc_call_and_unchanged_complete_historical_shape(self):
        self.assertEqual(self.assert_unique(R12).group(), R12)
        for old, new in (
            ('e.npcEconomy', 'x.npcEconomy'),
            ('e.npcEconomy', 'e.npcEconomy=other'),
            ('npcSave(e.npcEconomy)', 'npcSave(e.npcEconomy,other)'),
            ('npcSave(e.npcEconomy)', '(sideEffect(),npcSave(e.npcEconomy))'),
            (NPC, NPC + NPC), (NPC, 'npcEconomy:e.npcEconomy,'),
            (FLOOR, ''),
            ('offlineBonusHours:e.offlineBonusHours', 'offlineBonusHours:e.offlineBonusHours,extra:true'),
            ('{return{', '{sideEffect();return{'),
        ):
            with self.subTest(old=old, new=new):
                self.assertEqual(RING.production_serializers(R12.replace(old, new)), [])
        moved = R12.replace(NPC, '').replace(FLOOR, FLOOR + NPC)
        self.assertEqual(RING.production_serializers(moved), [])
        for text in (R12 * 2, R12 + R10, R12 + R9):
            self.assertEqual(len(RING.production_serializers(text)), 2)

    def test_r12_every_old_mutation_rejected_with_npc_prefix_retained(self):
        for before, after in (
            ('e.terraformerGrantJobFloor', 'x.terraformerGrantJobFloor'),
            ('e.orders.nextJobId', 'x.orders.nextJobId'),
            ('e.buildingTemplates', 'x.buildingTemplates'),
            ('e.planets.map', 'x.planets.map'),
            ('e.deepSpace', 'x.deepSpace'),
            ('...e.stats', '...x.stats'),
            ('e.unlocked.slice()', 'e.unlocked.splice(0)'),
            ('t=>({...t})', 't=>({...e})'),
            ('buildingTemplates:jg(e.buildingTemplates),', ''),
            ('totalTime:js(e.totalTime)', 'totalTime:wrong(e.totalTime)'),
        ):
            with self.subTest(before=before):
                self.assertEqual(RING.production_serializers(R12.replace(before, after)), [])

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
