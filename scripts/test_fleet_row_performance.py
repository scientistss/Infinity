"""Stdlib-only fail-closed tests; these do not assert a native browser pass."""
import copy
import importlib.util
import json
import tempfile
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('fleet_row',Path(__file__).with_name('browser-fleet-row-performance.py'))
P=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(P)


def raw_metrics(timestamp=1, value=1):
    return {'metrics':[{'name':'Timestamp','value':timestamp}]+[{'name':k,'value':value} for k in (*P.DURATION_METRICS,*P.COUNT_METRICS)]}


def runs():
    return [{**plan,'valid':True,'cleanupComplete':True,'windows':[
        {'number':number,'valid':True,'metrics':{'durationMsPerSecond':{key:float(10 if plan['side']=='baseline' else 12) for key in P.DURATION_METRICS}}}
        for number in (1,2,3)]} for plan in P.schedule()]


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
    def tearDown(self): self.temp.cleanup()

    def test_mode_budgets_leave_bounded_cleanup_and_outer_margin(self):
        self.assertEqual((P.EQUIVALENCE_BODY_SECONDS,P.EQUIVALENCE_OUTER_SECONDS),(75,100))
        self.assertEqual((P.BODY_SECONDS,P.OUTER_SECONDS),(560,590))
        self.assertLess(P.EQUIVALENCE_BODY_SECONDS+3*P.CLEANUP_SECONDS,P.EQUIVALENCE_OUTER_SECONDS)
        self.assertLess(P.BODY_SECONDS+3*P.CLEANUP_SECONDS,P.OUTER_SECONDS)
        self.assertLess(P.OUTER_SECONDS+4,600)

    def test_interrupted_supervisor_keeps_watchdog_and_owned_cleanup(self):
        class FakeProcess:
            pid=12345
            def poll(self): return None
            def wait(self,timeout): return 1
        args=SimpleNamespace(output=self.root/'interrupted',equivalence_only=True)
        with patch.object(P.subprocess,'Popen',return_value=FakeProcess()), \
             patch.object(P,'track_descendants',side_effect=[InterruptedError('stop'),None,None]) as track, \
             patch.object(P,'live_owned',return_value=[]), patch.object(P.signal,'signal'):
            self.assertEqual(P.supervise(args),1)
        value=json.loads((args.output/'watchdog.json').read_text())
        self.assertEqual(value['error']['type'],'InterruptedError')
        self.assertEqual(value['outerDeadlineSeconds'],100)
        self.assertEqual(value['remainingLiveOwnedPids'],[])
        self.assertEqual(track.call_count,3)

    def test_output_is_exclusive(self):
        path=self.root/'original'; P.exclusive_bytes(path,b'first')
        with self.assertRaises(FileExistsError): P.exclusive_bytes(path,b'changed')
        self.assertEqual(path.read_bytes(),b'first')

    def test_only_timestamps_can_change(self):
        work={'ready':{'revision':14,'version':9,'savedAt':1,'lastTickAt':1,'state':{'fleets':[{'id':1}]}}}
        seeded={'now':123,'raw':json.dumps({**work['ready'],'savedAt':123,'lastTickAt':123})}
        P.qualify_seed(seeded,work)
        value=json.loads(seeded['raw']); value['state']['fleets'][0]['id']=2; seeded['raw']=json.dumps(value)
        with self.assertRaisesRegex(AssertionError,'beyond'): P.qualify_seed(seeded,work)
        with self.assertRaises(AssertionError): P.qualify_seed({'now':True,'raw':'{}'},work)

    def test_json_scalars_and_array_order_are_exact(self):
        self.assertFalse(P.strict_equal(True,1)); self.assertFalse(P.strict_equal(1,1.0))
        self.assertFalse(P.strict_equal([1,2],[2,1])); self.assertTrue(P.strict_equal({'a':1,'b':2},{'b':2,'a':1}))

    def test_fixture_is_hard_pinned(self):
        path=self.root/'fixture'; path.write_text('{}')
        with self.assertRaisesRegex(AssertionError,'original'): P.workload(path,'combined')

    def test_only_after_save_is_consumed(self):
        ready={'revision':14,'version':9,'state':{'fleets':[{}],'planets':[{},{}]}}
        raw=json.dumps(ready)
        source={'key':'infinity.original-p4.save.v1','pairedNative':{'sourceSha':'4bceefee9bb70cae3a86f6c3c31a6d0b540dac2b',
                 'currentRevision':14,'afterSave':raw,'afterSha256':P.digest(raw),'beforeSave':'DO NOT USE'}}
        path=self.root/'fixture'; path.write_text(json.dumps(source))
        pinned={'moderate':{'fixture':P.digest(path.read_bytes()),'save':P.digest(raw),'fleets':1,'planets':2}}
        with patch.object(P,'FIXTURES',pinned): self.assertEqual(P.workload(path,'moderate')['raw'],raw)
        source['pairedNative']['afterSha256']='forged'; path.write_text(json.dumps(source)); pinned['moderate']['fixture']=P.digest(path.read_bytes())
        with patch.object(P,'FIXTURES',pinned):
            with self.assertRaisesRegex(AssertionError,'afterSave'): P.workload(path,'moderate')

    def test_paths_cannot_escape(self):
        dist=self.root/'dist'; dist.mkdir(); outside=self.root/'outside'; outside.write_text('x'); (dist/'linked').symlink_to(outside)
        for value in ('../outside',str(outside),'a\\b','linked'):
            with self.subTest(value=value),self.assertRaises(AssertionError): P.asset_path(dist,value)

    def test_http_urls_are_exact(self):
        base='http://localhost:4173/Infinity/'
        self.assertEqual(P.relative_asset(base+'assets/current.js',base),'assets/current.js')
        for url in ('https://localhost:4173/Infinity/x','http://evil/Infinity/x',base+'x?q=1',base+'x#f',base+'%2e%2e/x',base+'../x'):
            with self.subTest(url=url),self.assertRaises(AssertionError): P.relative_asset(url,base)

    def test_inline_script_rejected(self):
        with self.assertRaises(AssertionError): P.References().feed('<script>alert(1)</script>')

    def test_same_package_release_requires_static_bytes(self):
        common={'version':'0.6.27-alpha.1','saveVersion':9,'saveRevision':14,'files':{'index.html':'a','assets/a.js':'j','style.css':'s','icon.png':'i'}}
        a={'manifest':common,'scripts':{'assets/a.js':'j'}}
        b=copy.deepcopy(a); b['manifest']['files']['index.html']='b'; b['manifest']['files'].pop('assets/a.js'); b['manifest']['files']['assets/b.js']='k'; b['scripts']={'assets/b.js':'k'}
        P.qualify_release_pair(a,b)
        for key in ('style.css','icon.png'):
            changed=copy.deepcopy(b); changed['manifest']['files'][key]='changed'
            with self.assertRaisesRegex(AssertionError,'static'): P.qualify_release_pair(a,changed)
        changed=copy.deepcopy(b); changed['manifest']['saveRevision']=15
        with self.assertRaisesRegex(AssertionError,'metadata'): P.qualify_release_pair(a,changed)

    def test_observer_source_checked_before_execution(self):
        class Fake:
            def send(self,method,params):
                if method=='Runtime.compileScript': return {'scriptId':'10'}
                if method=='Debugger.getScriptSource': return {'scriptSource':'wrong'}
                raise AssertionError('Unverified observer must never execute')
        with self.assertRaisesRegex(AssertionError,'source changed'): P.register_observer(Fake(),self.root)
        self.assertEqual((self.root/'registered-observer.js').read_text(),'wrong')

    def test_observer_is_read_only_and_no_native_replacements(self):
        for forbidden in ('localStorage','Storage.','JSON.','innerHTML','outerHTML','performance.mark','Date.now=',
                          'requestAnimationFrame=','setInterval=','setTimeout=','Profiler.','Tracing.','DOMStorage.'):
            self.assertNotIn(forbidden,P.OBSERVER_SOURCE)
        self.assertIn('requestAnimationFrame(frame)',P.OBSERVER_SOURCE)
        self.assertIn('PerformanceObserver',P.OBSERVER_SOURCE)
        self.assertNotIn('OBSERVER_SOURCE',P.CONTROLLED_SOURCE)

    def test_actual_viewport_and_dpr_are_required(self):
        value={'visibility':'visible','hidden':False,'focused':True,'viewport':{'width':1440,'height':1100,'deviceScaleFactor':1},
               'reducedMotion':True,'panels':['fleet'],'fleetRows':1,'native':{'date':True},'protected':False,'backupKeys':[],
               'observation':{'visibility':[],'focus':[],'navigation':[{'tab':tab,'trusted':True} for tab in ('overview','orders','fleet')]}}
        P.qualify_snapshot(value,{'fleets':1})
        for bad in (False,1,None):
            changed=copy.deepcopy(value); changed['reducedMotion']=bad
            with self.subTest(reducedMotion=bad),self.assertRaisesRegex(AssertionError,'reduced-motion'): P.qualify_snapshot(changed,{'fleets':1})
        for key,bad in [('width',1280),('height',720),('deviceScaleFactor',2),('deviceScaleFactor',True)]:
            changed=copy.deepcopy(value); changed['viewport'][key]=bad
            with self.subTest(key=key,bad=bad),self.assertRaisesRegex(AssertionError,'viewport/DPR'): P.qualify_snapshot(changed,{'fleets':1})

    def test_pre_window_evidence_precedes_qualification(self):
        source=Path(P.__file__).read_text().split('def run_native(')[1].split('def run_equivalence(')[0]
        self.assertLess(source.index("archive_snapshot(directory,f'window-{number}-before'"),source.index('qualify_snapshot(before,work)'))
        self.assertLess(source.index("metrics-after.json'"),source.index("window.__fleetRowObservation.endWindow()"))
        self.assertLess(source.index("observer.json',observed"),source.index('after=page.evaluate(SNAPSHOT'))

    def test_null_and_valid_snapshot_readbacks_are_preserved(self):
        value={'raw':None,'focused':False,'protected':True}
        self.assertIsNone(P.archive_snapshot(self.root,'null',value))
        actual=json.loads((self.root/'null-snapshot.json').read_text())
        self.assertEqual(actual['currentReadback'],{'type':'null','value':None})
        self.assertFalse(actual['focused']); self.assertTrue(actual['protected'])
        value={'raw':'{"whole":"original"}','focused':True}
        self.assertEqual(P.archive_snapshot(self.root,'valid',value),'{"whole":"original"}')
        self.assertEqual((self.root/'valid-current.json').read_text(),'{"whole":"original"}')
        self.assertEqual(json.loads((self.root/'valid-snapshot.json').read_text())['currentSha256'],P.digest('{"whole":"original"}'))

    def test_raw_metric_phase_is_archived_before_validation(self):
        class Fake:
            def send(self,method): return {'metrics':[{'name':'Timestamp','value':1}]}
        path=self.root/'raw-metrics.json'
        with self.assertRaises(AssertionError): P.metrics(Fake(),path)
        self.assertEqual(json.loads(path.read_text()),{'metrics':[{'name':'Timestamp','value':1}]})

    def test_native_driver_never_enables_profiling_or_domstorage(self):
        source=Path(P.__file__).read_text()
        for forbidden in ("send('Profiler.","send('Tracing.","send('DOMStorage."):
            self.assertNotIn(forbidden,source)
        native=source.split('def run_native(')[1].split('def run_equivalence(')[0]
        self.assertNotIn('CONTROLLED_SOURCE',native); self.assertNotIn('add_init_script',native)
        self.assertLess(native.index("send('Debugger.disable')"),native.index("for tab in ('overview','orders','fleet')"))


class SourceBindings(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        self.dist=self.root/'dist'; self.dist.mkdir(); (self.dist/'app.js').write_bytes(b'function original() {}')
        self.base='http://localhost/Infinity/'; self.url=self.base+'app.js'
        self.variant={'url':self.base,'dist':self.dist,'release':{'scripts':{'app.js':P.digest((self.dist/'app.js').read_bytes())}}}
        class Response:
            status=200
            def body(this): return b'function original() {}'
        self.response=Response(); self.response.url=self.url
        class Cdp:
            def send(this,method,params): return {'scriptSource':'function original() {}'}
        self.cdp=Cdp()
    def tearDown(self): self.temp.cleanup()
    def directory(self,name):
        directory=self.root/name; directory.mkdir(); return directory
    def test_exact_unique_script(self):
        value=P.verify_scripts(self.cdp,[{'scriptId':'1','url':self.url}],[self.response],self.variant,self.directory('ok'))
        self.assertEqual(value['1']['kind'],'production')
    def test_duplicate_http_is_rejected(self):
        with self.assertRaisesRegex(AssertionError,'Duplicate'): P.verify_scripts(self.cdp,[],[self.response,self.response],self.variant,self.directory('dup'))
    def test_duplicate_executed_url_is_rejected(self):
        scripts=[{'scriptId':str(n),'url':self.url} for n in (1,2)]
        with self.assertRaisesRegex(AssertionError,'duplicate'): P.verify_scripts(self.cdp,scripts,[self.response],self.variant,self.directory('dup'))
    def test_unknown_executed_named_script_is_rejected(self):
        with self.assertRaisesRegex(AssertionError,'Unknown'): P.verify_scripts(self.cdp,[{'scriptId':'2','url':'http://evil/x.js'}],[self.response],self.variant,self.directory('unknown'))
    def test_source_bytes_must_match(self):
        class Changed:
            def send(this,method,params): return {'scriptSource':'changed'}
        with self.assertRaisesRegex(AssertionError,'Executed source'): P.verify_scripts(Changed(),[{'scriptId':'1','url':self.url}],[self.response],self.variant,self.directory('bad'))


class Measurements(unittest.TestCase):
    def test_native_metric_units_and_original_unchanged(self):
        a,b=raw_metrics(10,1),raw_metrics(11.5,1.3); original=json.dumps([a,b])
        value=P.metric_delta(a,b)
        self.assertEqual(value['elapsedMs'],1500)
        self.assertAlmostEqual(value['durationMs']['ScriptDuration'],300)
        self.assertAlmostEqual(value['durationMsPerSecond']['ScriptDuration'],200)
        self.assertEqual(original,json.dumps([a,b]))
    def test_missing_negative_nonfinite_boolean_metric_rejected(self):
        for invalid in (True,float('nan'),float('inf'),-1):
            b=raw_metrics(2,invalid)
            with self.subTest(invalid=invalid),self.assertRaises(AssertionError): P.metric_delta(raw_metrics(),b)
        b=raw_metrics(2,2); b['metrics'].pop()
        with self.assertRaises(AssertionError): P.metric_delta(raw_metrics(),b)
        with self.assertRaises(AssertionError): P.metric_delta(raw_metrics(),raw_metrics())
    def test_frames_and_boundary_tasks_preserved(self):
        raw={'start':10,'end':100,'frames':[8,20,40,60,80],
             'longTasks':[{'startTime':15,'duration':50},{'startTime':5,'duration':50}]}
        original=json.dumps(raw); value=P.observed_window(raw)
        self.assertEqual(value['frameGapP95Ms'],20); self.assertEqual(value['longTaskCount'],1)
        self.assertEqual(value['boundaryFrameTimestamps'],[8]); self.assertEqual(len(value['boundaryLongTasks']),1)
        self.assertEqual(json.dumps(raw),original)
    def test_invalid_frames_or_tasks_rejected(self):
        for frames in ([],[1],[2,1],[1,float('nan')]):
            with self.subTest(frames=frames),self.assertRaises(AssertionError): P.observed_window({'start':0,'end':10,'frames':frames,'longTasks':[]})
        with self.assertRaises(AssertionError): P.observed_window({'start':0,'end':10,'frames':[1,2],'longTasks':[{'startTime':1,'duration':True}]})
    def test_fixed_abba_twice_two_workloads(self):
        plan=P.schedule(); self.assertEqual(len(plan),16)
        for profile in ('moderate','combined'):
            subset=[p for p in plan if p['profile']==profile]
            self.assertEqual([p['side'] for p in subset],['baseline','candidate','candidate','baseline']*2)
            self.assertEqual([p['pair'] for p in subset],[1,1,2,2,3,3,4,4])
    def test_regressions_all_pairs_are_reported(self):
        result=P.comparisons(runs())
        for profile in result.values():
            self.assertEqual(len(profile['pairs']),4)
            self.assertEqual(profile['aggregate']['ScriptDuration']['medianPairedRatio'],1.2)
            self.assertEqual(profile['aggregate']['ScriptDuration']['medianPairedDifferenceMsPerSecond'],2)
    def test_no_subset_summary_for_missing_invalid_cleanup_or_reorder(self):
        for change in ('missing','invalid','cleanup','reorder','window','invalid-window'):
            data=runs()
            if change=='missing': data.pop()
            if change=='invalid': data[0]['valid']=False
            if change=='cleanup': data[0]['cleanupComplete']=False
            if change=='reorder': data[0],data[1]=data[1],data[0]
            if change=='window': data[0]['windows'].pop()
            if change=='invalid-window': data[0]['windows'][0]['valid']=False
            with self.subTest(change=change),self.assertRaises(AssertionError): P.comparisons(data)
    def test_every_schedule_identity_field_is_bound(self):
        replacements={'case':'moderate-b1-2-candidate','profile':'combined','block':2,'position':2,'side':'candidate','pair':2}
        for field,replacement in replacements.items():
            data=runs(); data[0][field]=replacement
            with self.subTest(field=field),self.assertRaisesRegex(AssertionError,'plan identity'): P.comparisons(data)
        for field in ('block','position','pair'):
            data=runs(); data[0][field]=True
            with self.subTest(field=field),self.assertRaisesRegex(AssertionError,'plan identity'): P.comparisons(data)
        data=runs()
        for row in data: row['side']='candidate' if row['side']=='baseline' else 'baseline'
        with self.assertRaisesRegex(AssertionError,'plan identity'): P.comparisons(data)

    def test_window_identities_cannot_be_missing_duplicate_reordered_or_retyped(self):
        for numbers in ([1,1,3],[1,2,2],[3,2,1],[0,2,3],[True,2,3],[1.0,2,3],[None,2,3]):
            data=runs()
            for window,number in zip(data[0]['windows'],numbers): window['number']=number
            with self.subTest(numbers=numbers),self.assertRaisesRegex(AssertionError,'window identities'): P.comparisons(data)
        data=runs(); del data[0]['windows'][0]['number']
        with self.assertRaisesRegex(AssertionError,'window identities'): P.comparisons(data)

    def test_zero_denominator_ratio_not_invented(self):
        data=runs()
        for row in data:
            for window in row['windows']: window['metrics']['durationMsPerSecond']['LayoutDuration']=0
        result=P.comparisons(data)
        self.assertIsNone(result['combined']['aggregate']['LayoutDuration']['medianPairedRatio'])
    def test_nonfinite_derived_deltas_and_ratios_rejected(self):
        with self.assertRaisesRegex(AssertionError,'derived'): P.metric_delta(raw_metrics(0,0),raw_metrics(1,1e308))
        data=runs()
        for row in data:
            for window in row['windows']:
                window['metrics']['durationMsPerSecond']['ScriptDuration']=1e-300 if row['side']=='baseline' else 1e308
        with self.assertRaisesRegex(AssertionError,'ratio'): P.comparisons(data)

    def test_nonfinite_pair_is_rejected(self):
        data=runs(); data[0]['windows'][0]['metrics']['durationMsPerSecond']['ScriptDuration']=float('inf')
        with self.assertRaises(AssertionError): P.comparisons(data)


if __name__=='__main__': unittest.main()
