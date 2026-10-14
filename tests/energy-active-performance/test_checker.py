"""Independent negative evidence tests. These never claim a native browser pass."""
import copy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('active_evidence_checker',ROOT/'scripts/check-energy-active-performance.py')
C=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(C)


def minimal_state():
    proofs={p:{'jobId':i+1,'targetLevel':1,'source':'manual','taskId':None,'paid':{'metal':'1','crystal':'0','deuterium':'0'}} for i,p in enumerate(C.PROOFS)}
    return {'planets':[{'id':'homeworld','resources':{'metal':'100','crystal':'100','deuterium':'100'},
        'buildings':{**{p:1 for p in C.PROOFS},'solar_plant':4,'fusion_reactor':0,'metal_storage':1,'crystal_storage':1,'deuterium_tank':1},
        'productionPct':{p:100 for p in (*C.PROOFS,'fusion_reactor')},'units':{'solar_satellite':0},'buildQueue':[],'shipyardQueue':[],'demolition':None}],
        'activePlanetId':'homeworld','universe':{'seed':20261013},'arcade':{'seed':20261013,'beaconProgress':0},
        'fleets':[],'energyChallenge':{'model':'energy-tightening-v1','completion':None,'nextAttemptId':2,
            'active':{'scoreUnits':'1000','proofs':proofs,'homeworldId':'homeworld','universeSeed':20261013,'entryJobFloor':1}},
        'orders':{'nextJobId':5,'accumulator':0},'protocols':{'slots':[{'card':None}],'accumulator':0},
        'manualClicks':0,'stats':{'automatedLaunches':0},'research':{'queue':[]},'boosters':[],
        'lifetime':{'metal':'100','crystal':'100','deuterium':'100'},'totalTime':'1','npcEconomy':{'now':1}}


def metrics(timestamp=1,cpu=1):
    return {'metrics':[{'name':'Timestamp','value':timestamp}]+[
        {'name':k,'value':cpu} for k in (*C.DURATION_METRICS,*C.COUNT_METRICS)]}


def progressed(before, gain='1'):
    after=copy.deepcopy(before); after['planets'][0]['resources']['metal']=str(100+int(gain))
    after['energyChallenge']['active']['scoreUnits']=str(1000+int(gain)*C.QUANTUM)
    return after


def samples():
    return [{**plan,'panel':panel,'metrics':{'durationMsPerSecond':{m:(10 if plan['variant']=='active' else 8) for m in C.DURATION_METRICS}}}
            for plan in C.expected_schedule() for panel in C.PANELS]


class DecimalAndScore(unittest.TestCase):
    def test_exact_fraction_does_not_round_wallet(self):
        self.assertEqual(C.amount('100000000000000.000000000001')-C.amount('100000000000000'),Fraction(1,10**12))
        self.assertEqual(C.amount('1.2345e-7'),Fraction(12345,10**11))
        self.assertEqual(C.amount('1e+2'),100)

    def test_noncanonical_negative_nonfinite_and_huge_amounts_rejected(self):
        for value in ('01','+1','-1','-0','1E3','.1','1.',' 1','1\n','1e01','Infinity','NaN','1e1000000',1,True,None):
            with self.subTest(value=value),self.assertRaises(AssertionError): C.amount(value)

    def test_score_caps_and_injections_rejected(self):
        for value in (str(C.GOAL),str(C.GOAL+1),'-1','01',1,True,'Infinity'):
            with self.subTest(value=value),self.assertRaises(AssertionError): C.score(value)

    def test_positive_score_uses_exact_wallet_upper(self):
        before=minimal_state(); after=progressed(before)
        result=C.retained_score_bound(before,after,120)
        self.assertEqual(result['upperUnits'],str(C.QUANTUM))
        self.assertEqual(result['segmentsPerCallbackUpper'],302)
        self.assertEqual(result['floorLossBoundUnits'],str(3*302*122))

    def test_per_contribution_floor_loss_permitted_only_within_bound(self):
        before=minimal_state(); after=progressed(before)
        bound=3*302*122
        after['energyChallenge']['active']['scoreUnits']=str(1000+C.QUANTUM-bound)
        C.retained_score_bound(before,after,120)
        after['energyChallenge']['active']['scoreUnits']=str(1000+C.QUANTUM-bound-1)
        with self.assertRaisesRegex(AssertionError,'flooring'): C.retained_score_bound(before,after,120)

    def test_score_injection_one_unit_above_wallet_rejected(self):
        before=minimal_state(); after=progressed(before)
        after['energyChallenge']['active']['scoreUnits']=str(1001+C.QUANTUM)
        with self.assertRaisesRegex(AssertionError,'injection'): C.retained_score_bound(before,after,120)

    def test_zero_progress_rejected(self):
        before=minimal_state()
        with self.assertRaises(AssertionError): C.retained_score_bound(before,before,120)

    def test_negative_wallet_gain_rejected(self):
        before=minimal_state(); after=progressed(before); after['planets'][0]['resources']['crystal']='99'
        with self.assertRaisesRegex(AssertionError,'Negative'): C.retained_score_bound(before,after,120)

    def test_proof_or_attempt_change_rejected(self):
        before=minimal_state(); after=progressed(before); after['energyChallenge']['active']['proofs']['metal_mine']['jobId']=99
        with self.assertRaisesRegex(AssertionError,'identity/proofs'): C.retained_score_bound(before,after,120)

    def test_callback_census_must_exist(self):
        for count in (0,-1,True,1.2):
            with self.subTest(count=count),self.assertRaises(AssertionError): C.retained_score_bound(minimal_state(),progressed(minimal_state()),count)


class SourceAndOriginals(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT); self.root=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()
    def ref(self,raw=b'{}',name='original.json'):
        (self.root/name).write_bytes(raw)
        return {'file':name,'sha256':C.sha(raw),'bytes':len(raw)}
    def test_preserves_original_bytes(self):
        ref=self.ref(b'{"a":1}\n'); self.assertEqual(C.reference(self.root,ref),b'{"a":1}\n')
    def test_missing_original_fails(self):
        ref=self.ref(); (self.root/ref['file']).unlink()
        with self.assertRaisesRegex(AssertionError,'Missing'): C.reference(self.root,ref)
    def test_rehashed_metadata_cannot_hide_changed_original(self):
        ref=self.ref(); (self.root/ref['file']).write_bytes(b'[]')
        with self.assertRaisesRegex(AssertionError,'digest'): C.reference(self.root,ref)
    def test_missing_raw_bytes_count_rejected(self):
        ref=self.ref(); ref.pop('bytes')
        with self.assertRaisesRegex(AssertionError,'Complete'): C.reference(self.root,ref)
    def test_path_escape_and_symlink_rejected(self):
        ref=self.ref()
        for name in ('../original.json','/tmp/original.json','x\\y'):
            with self.subTest(name=name),self.assertRaises(AssertionError): C.reference(self.root,{**ref,'file':name})
        (self.root/'linked').symlink_to(self.root/'original.json')
        with self.assertRaisesRegex(AssertionError,'Symlink'): C.reference(self.root,{**ref,'file':'linked'})
    def test_duplicate_json_and_nonfinite_rejected(self):
        for raw in ('{"x":1,"x":2}','{"x":NaN}','{"x":Infinity}'):
            with self.subTest(raw=raw),self.assertRaises(AssertionError): C.decode(raw)
    def test_old_revision_and_future_tick_rejected(self):
        good={'schema':'infinity-original-p4','version':9,'revision':16,'savedAt':100,'lastTickAt':99,'state':{}}
        self.assertEqual(C.envelope(json.dumps(good)),good)
        for patch in ({'revision':15},{'version':True},{'lastTickAt':101}):
            with self.subTest(patch=patch),self.assertRaises(AssertionError): C.envelope(json.dumps({**good,**patch}))


class RawCensusAndCpu(unittest.TestCase):
    def test_recomputes_cumulative_cpu_from_exact_timestamps(self):
        result=C.metric_delta(metrics(),metrics(3,1.25))
        self.assertEqual(result['elapsedMs'],2000)
        self.assertEqual(result['durationMs']['TaskDuration'],250)
        self.assertEqual(result['durationMsPerSecond']['TaskDuration'],125)
    def test_duplicate_missing_nonfinite_counter_rejected(self):
        invalid=[metrics(),metrics(),metrics()]
        invalid[0]['metrics'].append(invalid[0]['metrics'][0]); invalid[1]['metrics'].pop()
        invalid[2]['metrics'][1]['value']=float('nan')
        for raw in invalid:
            with self.assertRaises(AssertionError): C.metric_values(raw)
    def test_negative_cpu_and_wrong_window_rejected(self):
        for end in (metrics(3,.5),metrics(2,2),metrics(6,2)):
            with self.assertRaises(AssertionError): C.metric_delta(metrics(),end)
    def test_full_raw_census_and_paired_summary(self):
        result=C.summarize(samples()); self.assertEqual(len(result),6)
        self.assertEqual(result[0]['metrics']['TaskDuration']['pairedDeltasMsPerSecond'],[2,2,2])
        self.assertEqual(result[0]['metrics']['TaskDuration']['pairedMedianDeltaMsPerSecond'],2)
    def test_missing_window_rejected(self):
        with self.assertRaisesRegex(AssertionError,'36-window'): C.summarize(samples()[:-1])
    def test_duplicated_replacement_window_rejected(self):
        rows=samples(); rows[-1]=copy.deepcopy(rows[0])
        with self.assertRaisesRegex(AssertionError,'duplicate'): C.summarize(rows)
    def test_invented_repetition_or_side_rejected(self):
        for key,value in (('repetition',9),('variant','synthetic'),('profile','100-world')):
            rows=samples(); rows[0][key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError): C.summarize(rows)
    def test_fixed_ab_ba_ab_run_order(self):
        rows=C.expected_schedule()
        self.assertEqual(len(rows),12)
        self.assertEqual([r['variant'] for r in rows[:6]],['active','control','control','active','active','control'])


class StateAndReceipts(unittest.TestCase):
    def test_legal_abandon_changes_only_active_record(self):
        active=minimal_state(); control=copy.deepcopy(active); control['energyChallenge']['active']=None
        C.validate_abandon(active,control)
        for change in ('totalTime','wallet','proof'):
            bad=copy.deepcopy(control)
            if change=='totalTime': bad['totalTime']='2'
            elif change=='wallet': bad['planets'][0]['resources']['metal']='101'
            else: bad['energyChallenge']['nextAttemptId']=3
            with self.subTest(change=change),self.assertRaisesRegex(AssertionError,'other'): C.validate_abandon(active,bad)
    def test_ordinary_shape_valid(self): C.validate_profile_state(minimal_state(),'ordinary-1world','active')
    def test_full_or_overflow_warehouse_rejected(self):
        for amount in ('20000','20001','Infinity'):
            state=minimal_state(); state['planets'][0]['resources']['metal']=amount
            with self.subTest(amount=amount),self.assertRaises(AssertionError): C.validate_profile_state(state,'ordinary-1world','active')
    def test_missing_proof_rejected(self):
        state=minimal_state(); state['energyChallenge']['active']['proofs']['solar_plant']=None
        with self.assertRaisesRegex(AssertionError,'proof'): C.validate_profile_state(state,'ordinary-1world','active')
    def test_throttle_fusion_queues_and_counts_rejected(self):
        for change in ('throttle','fusion','queue','world'):
            state=minimal_state()
            if change=='throttle': state['planets'][0]['productionPct']['metal_mine']=90
            elif change=='fusion': state['planets'][0]['buildings']['fusion_reactor']=1
            elif change=='queue': state['research']['queue']=[{}]
            else: state['planets'].append(copy.deepcopy(state['planets'][0]))
            with self.subTest(change=change),self.assertRaises(AssertionError): C.validate_profile_state(state,'ordinary-1world','active')
    def test_exact_wallet_only_grant_and_score_unchanged(self):
        before=minimal_state(); after=copy.deepcopy(before); after['planets'][0]['resources']['metal']='101.000000000001'
        grant={'planetId':'homeworld','beforeWallet':before['planets'][0]['resources'],'afterWallet':after['planets'][0]['resources'],
               'granted':{'metal':'1.000000000001','crystal':'0','deuterium':'0'},'scoreBefore':'1000','scoreAfter':'1000'}
        event={'beforeState':before,'afterState':after,'grant':grant,'request':{'planetId':'homeworld','afterWallet':grant['afterWallet']}}
        C.wallet_grant(event)
        bad=copy.deepcopy(event); bad['grant']['granted']['metal']='1'
        with self.assertRaisesRegex(AssertionError,'exact rational'): C.wallet_grant(bad)
        bad=copy.deepcopy(event); bad['afterState']['energyChallenge']['active']['scoreUnits']='1001'
        with self.assertRaisesRegex(AssertionError,'non-wallet'): C.wallet_grant(bad)
    def test_idle_projection_retains_economic_and_proof_fields(self):
        before=minimal_state(); after=progressed(before); after['totalTime']='2'; after['npcEconomy']['now']=2
        C.idle_pair(before,after,'ordinary-1world','active')
        after['orders']['nextJobId']=6
        with self.assertRaisesRegex(AssertionError,'non-progress'): C.idle_pair(before,after,'ordinary-1world','active')



class Chronology(unittest.TestCase):
    def pair(self):
        b=minimal_state(); b['totalTime']='1805'
        a=copy.deepcopy(b); a['totalTime']='1807'
        for state,elapsed,remaining in ((b,1,239),(a,3,237)):
            state['fleets']=[{'id':1,'duration':240,'elapsed':elapsed,'remaining':remaining,'mission':'transport'}]
        return {'state':b,'lastTickAt':1792000000000},{'state':a,'lastTickAt':1792000002000}
    def test_native_accounting_clock_not_observer_entry_clock(self):
        b,a=self.pair(); result=C.chronology(b,a,120,b['state'])
        self.assertEqual(result['accountedSeconds'],2)
        self.assertEqual(result['totalTimeResidualSeconds'],0)
        self.assertGreater(result['totalTimeErrorBoundSeconds'],0)
    def test_saved_advance_cannot_exceed_run_horizon(self):
        b,a=self.pair(); a['state']['totalTime']='1925'
        with self.assertRaisesRegex(AssertionError,'120-second'): C.chronology(b,a,120,b['state'])
    def test_false_last_tick_timestamp_rejected(self):
        b,a=self.pair(); a['lastTickAt']+=100
        with self.assertRaisesRegex(AssertionError,'lastTickAt/totalTime'): C.chronology(b,a,120,b['state'])
    def test_different_fleet_speed_rejected(self):
        for key,delta in (('elapsed',.01),('remaining',-.01)):
            b,a=self.pair(); a['state']['fleets'][0][key]+=delta
            with self.subTest(key=key),self.assertRaisesRegex(AssertionError,'different accounting speed'): C.chronology(b,a,120,b['state'])
    def test_bound_is_small_and_explicitly_source_derived(self):
        b,a=self.pair(); r=C.chronology(b,a,120,b['state'])
        self.assertLess(r['totalTimeErrorBoundSeconds'],.00001)
        self.assertLess(r['fleets'][0]['errorBoundSeconds'],.00001)
        self.assertEqual(r['guardedSegmentsUpper'],122*(262+40+4))


class CanonicalNumbers(unittest.TestCase):
    def test_ecmascript_exponent_spelling(self):
        self.assertEqual(C.canonical({'a':1e-7,'b':1e-6,'c':1.2e20,'d':1e21,'e':-0.0}),
          b'{"a":1e-7,"b":0.000001,"c":120000000000000000000,"d":1e+21,"e":0}')
    def test_boolean_not_numeric(self): self.assertFalse(C.same({'a':True},{'a':1}))


class PaymentReceipts(unittest.TestCase):
    def event(self):
        before=minimal_state(); before['orders']['nextJobId']=5
        after=copy.deepcopy(before); after['orders']['nextJobId']=6
        after['planets'][0]['resources']['metal']='90'
        job={'jobId':5,'taskId':None,'source':'manual','building':'metal_storage','targetLevel':2,
             'paid':{'metal':'10','crystal':'0','deuterium':'0'},'totalSeconds':1,'remainingSeconds':1}
        after['planets'][0]['buildQueue']=[job]
        payment={'jobId':5,'kind':'building','count':1,'planetId':'homeworld','cost':job['paid'],
            'actualJob':{'kind':'building','planetId':'homeworld',**job},'beforeWallet':before['planets'][0]['resources'],
            'afterWallet':after['planets'][0]['resources']}
        return {'beforeState':before,'afterState':after,'payment':payment}
    def test_real_paid_job_required(self):
        e=self.event(); C.payment(e); e['afterState']['planets'][0]['buildQueue']=[]
        with self.assertRaisesRegex(AssertionError,'actual paid'): C.payment(e)
    def test_paid_job_identity_not_reusable(self):
        e=self.event(); e['afterState']['orders']['nextJobId']=5
        with self.assertRaisesRegex(AssertionError,'allocated'): C.payment(e)
    def test_payment_cannot_grant_score(self):
        e=self.event(); e['afterState']['energyChallenge']['active']['scoreUnits']='1100'
        with self.assertRaisesRegex(AssertionError,'injected'): C.payment(e)
    def test_false_paid_cost_rejected(self):
        e=self.event(); e['payment']['cost']={'metal':'9','crystal':'0','deuterium':'0'}
        with self.assertRaisesRegex(AssertionError,'debit'): C.payment(e)

if __name__=='__main__': unittest.main()
