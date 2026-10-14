"""Pure Python negatives for isolated same-browser reference boundaries."""
from copy import deepcopy
import ast
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import energy_challenge_solar_reference as R


def tape():
    actions=[('createInitialState',{'worldSeed':R.SEED,'arcadeSeed':R.SEED})]
    actions += [('enqueue',{'target':'metal_mine','source':'manual','count':None,'label':None})]*149
    actions += [('enqueueResearch',{'target':'energy_tech','source':'manual','count':None,'label':None})]*4
    actions += [('challengeCandidate',{'action':action}) for action in ('enter','finish')]
    actions += [('checkpoint',{'name':'cp'+str(i),'file':'solar/cp'+str(i)+'.json','appliedSeconds':0,'adoptsReader':True}) for i in range(22)]
    actions += [('reject',{'api':name,'freshQuote':True}) for name in ('enterEnergyChallenge','finishEnergyChallenge')]
    actions += [('reject',{'api':'enqueue','building':'deuterium_synth','fourth':True}),('reject',{'api':'enqueueResearch','tech':'computer_tech','fourth':True})]
    actions += [('tick',{'dt':1,'mode':'live','reason':'fixed test chronology'})]*4201
    return [{'index':index,'stage':'first-curvature','api':api,'request':deepcopy(req)} for index,(api,req) in enumerate(actions,1)]


def runtime():
    return {'version':{'protocolVersion':'1.3','product':'Chrome/154.0.0.0','revision':'test','userAgent':'Chrome154','jsVersion':'15.4'},
            'pid':125,'processStart':'678','executable':'/test/chrome','executableSha256':'a'*64,'executableBytes':1024}


def chronology():
    ref={'browserContextId':'reference-context','targetId':'reference-target'};native={'browserContextId':'native-context','targetId':'native-target'}
    rows=[]
    for index,kind in enumerate(('reference-context-created','reference-bundle-executed','reference-output-sealed','reference-context-closed','native-context-created','native-navigation-start')):
        row={'sequence':index,'kind':kind,'monotonic':100+index,'context':deepcopy(ref if index<4 else native)}
        if index==2:row.update(manifestSha256='a'*64,outputSha256='b'*64)
        if index==3:row.update(closed=True,browserContextIds=[])
        if index in (0,4):row['browserContextIds']=[(ref if index==0 else native)['browserContextId']]
        rows.append(row)
    return rows,ref,native


def payment():
    wallet={'metal':'500','crystal':'500','deuterium':'0'};after={'metal':'440','crystal':'485','deuterium':'0'};cost={'metal':'60','crystal':'15','deuterium':'0'}
    job={'jobId':1,'taskId':None,'building':'metal_mine','targetLevel':1,'paid':cost,'totalSeconds':1,'remainingSeconds':1,'source':'manual'}
    before={'orders':{'nextJobId':1},'planets':[{'resources':wallet,'buildQueue':[]}]}
    state={'orders':{'nextJobId':2},'planets':[{'resources':after,'buildQueue':[job]}]}
    event={'api':'enqueue','stage':'first-curvature','before':{'logicalSeconds':0},'request':{'target':'metal_mine','label':None},
           'payment':{'kind':'building','target':'metal_mine','targetLevel':1,'jobId':1,'cost':cost,'actualJob':{**job,'kind':'building','planetId':'homeworld'},
                      'stage':'first-curvature','logicalSeconds':0,'beforeWallet':wallet,'afterWallet':after,'label':None}}
    return deepcopy(event),deepcopy(before),deepcopy(state)


class SolarReferenceTests(unittest.TestCase):
    def test_action_only_projection_and_frozen_order(self):
        actions=tape();digest=R.C.sha(R.C.canonical(actions))
        with patch.object(R,'TAPE_SHA256',digest):
            self.assertEqual(R.validate_tape(actions),actions)
            mutations=[lambda t:t.pop(),lambda t:t.append(deepcopy(t[-1])),lambda t:t[0].update(state={}),
                       lambda t:t[0].update(before={}),lambda t:t[1].update(payment={}),lambda t:t[154].update(quote={}),
                       lambda t:t[1]['request'].update(wallet={'metal':'999'}),lambda t:t[1]['request'].update(state={}),
                       lambda t:t[1]['request'].update(target='solar_plant'),lambda t:t[0].update(index=True),
                       lambda t:t[-1]['request'].update(dt=True),lambda t:t[1].update(stage='invented'),
                       lambda t:t.__setitem__(slice(0,2),[t[1],t[0]])]
            for mutate in mutations:
                bad=deepcopy(actions);mutate(bad)
                with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_tape(bad)
            legacy=[{**row,'before':None,'after':{'wallet':'original outcome never copied'}} for row in actions]
            R.validate_tape(actions,legacy)
            legacy[1]['request']['target']='solar_plant'
            with self.assertRaises(AssertionError):R.validate_tape(actions,legacy)

    def test_same_actual_browser_version_v8_process_and_executable(self):
        ref=runtime();R.validate_runtime(ref,deepcopy(ref),'154.0.0.0')
        mutations=[lambda x:x['version'].update(jsVersion='other'),lambda x:x['version'].update(product='Chrome/155.0.0.0'),
                   lambda x:x.update(pid=126),lambda x:x.update(processStart='679'),lambda x:x.update(executableSha256='b'*64),
                   lambda x:x.update(executable='/other/chrome'),lambda x:x.update(extra='ignored')]
        for mutate in mutations:
            native=deepcopy(ref);mutate(native)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_runtime(ref,native,'154.0.0.0')
        with self.assertRaises(AssertionError):R.validate_runtime(ref,ref,'155.0.0.0')

    def test_reference_closed_and_sealed_before_pristine_native_context(self):
        rows,ref,native=chronology();R.validate_chronology(rows,ref,native)
        mutations=[lambda x:x.__setitem__(slice(2,4),[x[3],x[2]]),lambda x:x[3].update(closed=False),
                   lambda x:x[3].update(monotonic=105),lambda x:x[4].update(context=ref),lambda x:x.append(deepcopy(x[-1])),
                   lambda x:x[2].update(nativeObservation=True),lambda x:x[0].update(sequence=False)]
        for mutate in mutations:
            bad=deepcopy(rows);mutate(bad)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_chronology(bad,ref,native)
        with self.assertRaises(AssertionError):R.validate_chronology(rows,ref,ref)

    def test_full_payment_identity_and_last_digit_are_exact(self):
        event,old,new=payment();R.validate_payment(event,old,new)
        mutations=[lambda e:e['payment']['afterWallet'].update(metal='440.000000000001'),
                   lambda e:e['payment']['beforeWallet'].update(metal='500.000000000001'),lambda e:e['payment'].update(jobId=2),
                   lambda e:e['payment'].update(jobId=True),lambda e:e['payment']['cost'].update(metal='61'),
                   lambda e:e['payment']['actualJob'].update(remainingSeconds=0.9999999999999999),
                   lambda e:e['payment'].update(ignoredProof={}),lambda e:e['payment'].update(targetLevel=2)]
        for mutate in mutations:
            bad=deepcopy(event);mutate(bad)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_payment(bad,old,new)

    def test_independent_debit_rejects_self_consistent_underpayment(self):
        event,old,new=payment()
        event['payment']['afterWallet']['metal']='441';new['planets'][0]['resources']['metal']='441'
        with self.assertRaisesRegex(AssertionError,'Independent natural wallet debit'):
            R.validate_payment(event,old,new)

    def test_proofs_require_complete_actual_paid_identity(self):
        event,_,_=payment();p=event['payment'];proof={'jobId':1,'targetLevel':1,'source':'manual','taskId':None,'paid':p['cost']}
        state={'energyChallenge':{'model':'energy-tightening-v1','nextAttemptId':2,'completion':None,
               'active':{'attemptId':1,'universeSeed':R.SEED,'homeworldId':'homeworld','entryJobFloor':1,'enteredAt':'0','scoreUnits':'0',
                         'proofs':{target:deepcopy(proof) if target=='metal_mine' else None for target in R.NATURAL.PROOFS}}}}
        R.validate_proofs(state,{1:p},{1})
        mutations=[lambda s:s['energyChallenge']['active']['proofs']['metal_mine'].update(jobId=2),
                   lambda s:s['energyChallenge']['active']['proofs']['metal_mine']['paid'].update(metal='60.000000000001'),
                   lambda s:s['energyChallenge']['active']['proofs']['metal_mine'].update(ignored=True),
                   lambda s:s['energyChallenge']['active'].update(extra=True),lambda s:s['energyChallenge'].update(extra=True)]
        for mutate in mutations:
            bad=deepcopy(state);mutate(bad)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_proofs(bad,{1:p},{1})
        with self.assertRaises(AssertionError):R.validate_proofs(state,{1:p},set())

    def test_complete_quote_cannot_change_reward_or_attempt_identity(self):
        previous={'energyChallenge':{'nextAttemptId':1,'active':None},'universe':{'seed':R.SEED},'orders':{'nextJobId':68},'stats':{'launches':0},'warpCores':'0'}
        candidate={'stats':{'launches':1},'warpCores':'1'}
        event={'request':{'action':'enter'},'quote':{'action':'enter','expected':{'nextAttemptId':1,'attemptId':None,'universeSeed':R.SEED,'entryJobFloor':68},
               'ok':True,'reason':'','gain':'1','disabledPrestigeSlots':[]},'replayRejected':True}
        R.validate_quote(event,previous,candidate)
        mutations=[lambda x:x['quote'].update(gain='1.000000000001'),lambda x:x['quote']['expected'].update(entryJobFloor=69),
                   lambda x:x['quote']['expected'].update(nextAttemptId=True),lambda x:x['quote'].update(unknown=True),
                   lambda x:x.update(replayRejected=False),lambda x:x['quote'].update(disabledPrestigeSlots=[0])]
        for mutate in mutations:
            bad=deepcopy(event);mutate(bad)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_quote(bad,previous,candidate)

    def test_full_tick_log_and_completion_ids_are_bound_to_actual_queues(self):
        payment_event,_,previous=payment();previous['planets'][0]['buildings']={'metal_mine':0}
        previous['research']={'queue':[],'levels':{'energy_tech':0}}
        state=deepcopy(previous);state['planets'][0]['buildQueue']=[];state['planets'][0]['buildings']['metal_mine']=1
        event={'stage':'first-curvature','completed':[{'kind':'building','jobId':1,'target':'metal_mine','targetLevel':1,'stage':'first-curvature','logicalSeconds':1}],
               'log':{'completedBuilds':[{'building':'metal_mine','level':1}],'completedResearch':[],'completedUnits':[]}}
        R.validate_tick(event,previous,state,{1:payment_event['payment']},set(),1)
        mutations=[lambda x:x.update(log={}),lambda x:x['log'].update(extra=True),lambda x:x['log'].update(completedBuilds=[]),
                   lambda x:x['completed'][0].update(jobId=2),lambda x:x['completed'][0].update(jobId=True),
                   lambda x:x['log']['completedBuilds'][0].update(level=2),lambda x:x['log']['completedBuilds'][0].update(ignored=True)]
        for mutate in mutations:
            bad=deepcopy(event);mutate(bad)
            with self.subTest(mutate=mutate),self.assertRaises(AssertionError):R.validate_tick(bad,previous,state,{1:payment_event['payment']},set(),1)
        wrong=deepcopy(state);wrong['planets'][0]['buildings']['metal_mine']=2
        with self.assertRaises(AssertionError):R.validate_tick(event,previous,wrong,{1:payment_event['payment']},set(),1)

    def test_sealed_reference_reopens_bundle_raw_and_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def save(name,raw):
                (root/name).write_bytes(raw);return R.C.reference(root/name,root)
            bundle=b'bound test bundle';rows,ref,native=chronology();url='http://localhost/__solar_reference__/'+'a'*32+'/browser-reference.js'
            document=b'<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><script src="browser-reference.js"></script>'
            output=save('output.json',b'{}')
            sealed={'schema':R.SCHEMA,'classification':'same-Chrome-isolated-domain-reference-not-native-evidence','runtime':runtime(),'context':ref,
                    'sourceSha':'c'*40,'sourceTree':'d'*40,'actionTapeSha256':R.C.sha(R.C.canonical([])),'output':output,
                    'executedSource':{'url':url,'scriptId':'3','executionContextId':1,'v8Original':save('bundle.js',bundle)},
                    'document':save('document.html',document),'requests':[{'url':url.removesuffix('browser-reference.js')+name,'method':'GET','postData':None} for name in ('index.html','browser-reference.js')],
                    'invocation':'async tape => JSON.stringify(await InfinitySolarReference.replay(tape))','provenance':deepcopy(R.PROVENANCE),
                    'initialStorage':{'cookies':[],'origins':[]},'finalStorage':{'cookies':[],'origins':[]}}
            build={'bundle':bundle,'tape':[],'manifest':{'sourceSha':'c'*40,'sourceTree':'d'*40}}
            report={'sourceSha':'c'*40,'browserVersion':'154.0.0.0','nativeBrowserRuntime':runtime(),'nativeContext':native,'nativeStartedMonotonic':103.5}
            def run(value):
                report['browserReference']=save('manifest.json',R.C.canonical(value));report['contextChronology']=deepcopy(rows)
                report['contextChronology'][2].update(manifestSha256=report['browserReference']['sha256'],outputSha256=output['sha256'])
                return R.validate_reference(root,report,build,b'',[])
            with patch.object(R,'TAPE_SHA256',sealed['actionTapeSha256']),patch.object(R,'validate_replay',return_value=([],[])):
                self.assertEqual(run(sealed),([],[]))
                mutations=[lambda x:x['provenance'].update(nativeObservationAdoptions=1),lambda x:x['provenance'].update(nativeObservationsAvailable=True),
                           lambda x:x['executedSource'].update(extra=True),lambda x:x.update(unknown=True),
                           lambda x:x['finalStorage'].update(cookies=[{}]),lambda x:x.update(invocation='result => result')]
                for mutate in mutations:
                    bad=deepcopy(sealed);mutate(bad)
                    with self.subTest(mutate=mutate),self.assertRaises(AssertionError):run(bad)
                build['bundle']=b'wrong bundle'
                with self.assertRaises(AssertionError):run(sealed)
                build['bundle']=bundle;(root/'output.json').write_bytes(b'{ }')
                with self.assertRaises(AssertionError):run(sealed)

    def test_native_injection_ban_and_phase_budgets_are_explicit(self):
        runner=Path(__file__).with_name('browser-energy-challenge-solar.py').read_text()
        self.assertIn("signal.setitimer(signal.ITIMER_REAL,R.PREPARATION_BUDGET)",runner)
        self.assertIn("signal.setitimer(signal.ITIMER_REAL,S.BUDGET)",runner)
        self.assertIn('BUDGETS[args.lane]+R.PREPARATION_BUDGET+20-4',runner)
        self.assertEqual(R.PREPARATION_BUDGET,60)
        for forbidden in ('.route(','.add_script_tag(','localStorage.setItem(','Debugger.evaluateOnCallFrame'):
            self.assertNotIn(forbidden,runner)
        source=Path(R.__file__).read_text()
        self.assertIn('Fraction(state',source);self.assertIn('NATURAL.price(payment)',source)
        self.assertIn("page.evaluate(invocation,tape)",source)
        self.assertNotIn('page.evaluate(invocation,legacy_events)',source)

if __name__=='__main__':unittest.main()
