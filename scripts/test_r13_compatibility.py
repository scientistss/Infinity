"""Exact independent wallet expectations; no current production imports."""
import copy
import unittest
from r13_compatibility import *
from r12_compatibility import npc_elapsed_from_segments

class R13Contracts(unittest.TestCase):
    def test_current_render_consumer_folds_complete_old_segments_at_horizon(self):
        import ast
        from pathlib import Path
        script=Path(__file__).with_name('browser-render-scheduling.py');tree=ast.parse(script.read_text())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='expected_npc_wallet')
        rows={'base.initial':{'adoptedSegmentsSeconds':[],'npcWallet':expected_npc_economy(),'oldObservedAndUnobservedStateEqual':True},
              'crossing':{'adoptedSegmentsSeconds':[11999,.5,.5,1],'npcWallet':expected_npc_economy([11999,.5,.5,1]),'oldObservedAndUnobservedStateEqual':True}}
        fixtures={'expected':{key:{} for key in rows},'npcAdoptedTime':{'sourceSha':'4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b','observation':'old-totalTime-add; full unobserved old-state equivalence verified','traces':rows}}
        ns={'fixtures':fixtures,'expected_npc_economy':expected_npc_economy,'exact_state':exact_json}
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(script),'exec'),ns)
        self.assertEqual(ns['expected_npc_wallet']('crossing'),expected_npc_economy([12000,1]))
        rows['crossing']['npcWallet']=expected_npc_economy([11900])
        with self.assertRaises(AssertionError):ns['expected_npc_wallet']('crossing')
    def test_endpoint_rebase_cannot_be_recovered_from_r12_capped_age(self):
        a,b = [11900,100],[11900,200]
        self.assertEqual(npc_elapsed_from_segments(a),npc_elapsed_from_segments(b))
        self.assertEqual(expected_npc_economy(a)['now'],0)
        self.assertEqual(expected_npc_economy(b)['now'],0)
        self.assertNotEqual(expected_npc_economy([11900]),expected_npc_economy(a))
        self.assertEqual(expected_npc_economy([11999,.5,.5,1])['now'],1)
        self.assertEqual(expected_npc_economy([12000,1])['baseline']['stock'],CAPS)
        with self.assertRaises(AssertionError):expected_npc_economy(11900)
    def test_actual_binary64_snapshot_becomes_zero_mark_baseline(self):
        age=.1+.2
        old={'npcEconomy':{'model':'fixed-production-v1','elapsedSeconds':age},'totalTime':'1e400','other':[1,'1',False],'planets':[{'id':'home'}]}
        before=copy.deepcopy(old);current=lift_r12_state_to_r13(old)
        self.assertEqual(current['npcEconomy']['now'],0)
        self.assertEqual(current['npcEconomy']['baseline']['stock'],[500+5*age,250+2.5*age,age])
        self.assertEqual(current['npcBattles'],expected_npc_battles())
        self.assertEqual(old,before)
    def test_ordered_fractional_numbers_and_zero_tail(self):
        self.assertEqual(expected_npc_economy([.1,.2,0])['now'],.1+.2)
        self.assertNotEqual(expected_npc_economy([.1,.2]),expected_npc_economy([.3]))
        for bad in (True,'1',-1,float('nan'),float('inf')):
            with self.assertRaises(AssertionError):expected_npc_economy([bad])
    def test_strict_projection_admits_only_exact_no_attack_fields(self):
        wallet=expected_npc_economy([1]);old={'totalTime':'1e400','allOld':[1,'1',False],'planets':[{'id':'home'}]};good=lift_r11_state_to_r13(old,npc_wallet=wallet)
        self.assertEqual(project_verified_npc_metadata(good,npc_wallet=wallet),old)
        for mutate in (lambda s:s['npcEconomy'].update(now=0),lambda s:s['npcEconomy'].update(extra=0),lambda s:s['npcEconomy']['baseline'].update(mark=1),lambda s:s['npcEconomy']['sites'].update({'1:1:1':{}}),lambda s:s['npcBattles']['reports'].append({}),lambda s:s['npcBattles'].update(extra=0)):
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(AssertionError):project_verified_npc_metadata(bad,npc_wallet=wallet)

    def test_exact_zero_planet_rights_only_and_legacy_smuggling_rejected(self):
        old={'planets':[{'id':'home','resources':{'metal':'123'}},{'id':'colony'}]};wallet=expected_npc_economy()
        good=lift_r11_state_to_r13(old,npc_wallet=wallet)
        self.assertEqual([p['npcResourceRemainder'] for p in good['planets']],[expected_npc_resource_remainder(),expected_npc_resource_remainder()])
        self.assertEqual(project_verified_npc_metadata(good,npc_wallet=wallet),old)
        for mutate in (lambda s:s['planets'][0].pop('npcResourceRemainder'),lambda s:s['planets'][0]['npcResourceRemainder'].update(metal='0.1'),lambda s:s['planets'][1]['npcResourceRemainder'].update(crystal=0),lambda s:s['planets'][0]['npcResourceRemainder'].update(extra='0')):
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(AssertionError):project_verified_npc_metadata(bad,npc_wallet=wallet)
        smuggled=copy.deepcopy(old);smuggled['planets'][0]['npcResourceRemainder']=expected_npc_resource_remainder()
        with self.assertRaises(AssertionError):lift_r11_state_to_r13(smuggled)

if __name__=='__main__':unittest.main()
