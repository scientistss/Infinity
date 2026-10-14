"""Exact r16 whole-function observers retain every historical match contract."""
import unittest
from test_ring_protection_observer import RING, R14_CURRENT, HANDLER_MANUAL_UNIT_CURRENT
from test_energy_challenge_native import R16, HANDLER

class EnergySourceBindingTests(unittest.TestCase):
    def test_exact_r16_wrapper_and_all_historical_fields(self):
        matches=RING.production_serializers(R16)
        self.assertEqual(len(matches),1);self.assertEqual(matches[0].group('challenge'),'challenge')
        self.assertEqual(len(RING.production_serializers(R16+R16)),2)
        self.assertEqual(len(RING.production_serializers(R14_CURRENT)),1)
        for before,after in [('challenge=readEnergy(e.energyChallenge)','challenge=readEnergy(other.energyChallenge)'),
           ('energyChallenge:challenge','energyChallenge:other'),('validateEnergy(e,challenge)','validateEnergy(e,other)'),
           ('rejectEnergy(e,!1);',''),('sd(e,!1),',''),('e.orders','other.orders'),('messages:t','messages:other')]:
            self.assertIn(before,R16)
            self.assertEqual(RING.production_serializers(R16.replace(before,after,1)),[],before)
    def test_exact_four_retirements_preserve_numbered_old_session_capture(self):
        current=RING.production_action_handlers(HANDLER)
        self.assertEqual(len(current),1)
        match=current[0]
        self.assertEqual(match.group(3),match.group('session'))
        self.assertEqual(len(RING.production_action_handlers(HANDLER_MANUAL_UNIT_CURRENT)),1)
        for replacement in ('','other.retireEnergyChallenge()','view.retireEnergyChallenge(1)','view.retireEnergyChallenge(),evil()'):
            changed=HANDLER.replace('view.retireEnergyChallenge()',replacement)
            self.assertEqual(RING.production_action_handlers(changed),[])

if __name__=='__main__':unittest.main()
