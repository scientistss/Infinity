"""Stdlib-only diagnostic contracts; never claims actual native browser coverage."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location('dom_diagnostic',Path(__file__).with_name('browser-fleet-row-dom.py'))
D=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(D)
ROOT=Path(__file__).resolve().parents[1]


def handle(title='DOM-DIAGNOSTIC:first:title',connected=True):
    return {'title':title,'html':title,'connected':connected,'progress':'0.123%','hidden':False}


def snapshots():
    before={'handles':{'ids':['340','341','342'],'refs':{name:handle() for name in ('list','first','second','third','duplicate','leading','decimal','missing','replacement','newFirst','newestFirst','oldButton')}}}
    return before,copy.deepcopy(before)


def paint(name='first',value='actual production title',snapshot=None):
    snapshot['handles']['refs'][name]['title']=value;snapshot['handles']['refs'][name]['html']=value


class DiagnosticContracts(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()

    def test_fixed_complete_schedule_and_bounded_cleanup(self):
        self.assertEqual(len(D.SCENARIOS),8);self.assertEqual(len(set(D.SCENARIOS)),8)
        self.assertEqual(sum(len(D.steps(s)) for s in D.SCENARIOS),40)
        self.assertEqual(1+2*len(D.SCENARIOS)+2*sum(len(D.steps(s)) for s in D.SCENARIOS),97)
        self.assertEqual(len(D.GROUPS)+2*len(D.SCENARIOS)+2*sum(len(D.steps(s)) for s in D.SCENARIOS),98)
        self.assertEqual((D.BODY_SECONDS,D.CLEANUP_SECONDS,D.OUTER_SECONDS),(120,5,150))
        self.assertLess(D.BODY_SECONDS+4*D.CLEANUP_SECONDS,D.OUTER_SECONDS)
        self.assertLess(D.OUTER_SECONDS+4,160)

    def test_error_names_and_messages_preserved_and_only_stack_separated(self):
        raw={'at':250,'callbacks':None,'error':{'name':'Error','message':'缺少界面节点 .flight-progress','stack':'original full native stack'}}
        old=copy.deepcopy(raw);value=D.semantic_frame(raw)
        self.assertEqual(raw,old);self.assertEqual(value['error'],{'name':'Error','message':'缺少界面节点 .flight-progress'})
        self.assertEqual(D.error_expected('removed-last-match','painted',['340','341']),{'name':'Error','message':'缺少界面节点 [data-flight="341"]'})
        self.assertIsNone(D.error_expected('raw-id-root','painted',['340','341']))
        self.assertEqual(D.error_expected('raw-id-root','repainted',['340','341'])['message'],'缺少界面节点 [data-flight="340"]')

    def test_no_production_renderer_or_business_api_invocation(self):
        scripts='\n'.join([D.FRAME,D.MUTATE,D.SECOND_MUTATION,D.HANDLES])
        for forbidden in ('new Function','eval(','.dispatchEvent(','.click(', 'createFleetRowLookup(', 'updateSpaceFleet(', 'sendFleet(', 'recallFleet(', 'saveSession', 'mountView(', 'prototype.'):
            self.assertNotIn(forbidden,scripts)
        self.assertIn('window.__fleetRowClock.frame()',D.FRAME)
        self.assertIn('cloneNode(true)',D.MUTATE);self.assertIn('replaceWith(replacement)',D.MUTATE)
        self.assertIn('r.first.remove()',D.SECOND_MUTATION);self.assertIn('list.hidden=true',D.MUTATE)

    def test_snapshot_retains_every_original_critical_field(self):
        for required in ('document.body.outerHTML','document.activeElement','selectionStart','selectionEnd','checked','disabled','open','storage:Object.fromEntries','localStorage.getItem(key)'):
            self.assertIn(required,D.P.DOM_SNAPSHOT)
        for required in ('html:e.outerHTML','connected:e.isConnected','inCurrentList','fields:fields(e)'):
            self.assertIn(required,D.HANDLES)
        source=Path(D.__file__).read_text()
        self.assertLess(source.index("P.exclusive_json(directory/('frame-'+label+'.json'),value)"),source.index('result=semantic_frame(value)'))
        self.assertLess(source.index('P.exclusive_json(path,value)'),source.index("qualify_snapshot(value,work['key'])"))
        self.assertLess(source.index("after=snap('painted')"),source.index("qualify_paint(scenario,'painted'"))
        self.assertIn("P.exclusive_json(directory/'failure-dom.json',value)",source)

    def test_snapshot_rejects_missing_storage_or_untrusted_inputs(self):
        value={'focused':True,'events':[{'trusted':True}],'viewport':{'width':1440,'height':1100,'deviceScaleFactor':1},'reducedMotion':True,
               'raw':'{"whole":"save"}','storage':{'key':'{"whole":"save"}'},'pageErrors':[],'requestFailures':[]}
        D.qualify_snapshot(value,'key')
        for key,bad in [('focused',False),('events',[{'trusted':False}]),('raw',None),('storage',{}),('pageErrors',[{'message':'oops'}]),('requestFailures',[{'url':'failed'}]),('reducedMotion',1)]:
            changed=copy.deepcopy(value);changed[key]=bad
            with self.subTest(key=key),self.assertRaises(AssertionError):D.qualify_snapshot(changed,'key')

    def test_success_requires_actual_callback_and_real_write(self):
        a,b=snapshots();frame={'error':None,'callbacks':1}
        with self.assertRaisesRegex(AssertionError,'did not change'):D.qualify_paint('ordinary','painted',a,b,frame)
        paint(snapshot=b);D.qualify_paint('ordinary','painted',a,b,frame)
        for bad in (0,False,1.0,None):
            with self.subTest(callbacks=bad),self.assertRaises(AssertionError):D.qualify_paint('ordinary','painted',a,b,{'error':None,'callbacks':bad})

    def test_nested_duplicate_first_match_and_reorder(self):
        a,b=snapshots();paint('duplicate',snapshot=b);frame={'error':None,'callbacks':1}
        D.qualify_paint('nested-duplicate','painted',a,b,frame)
        paint('first',snapshot=b)
        with self.assertRaisesRegex(AssertionError,'non-first'):D.qualify_paint('nested-duplicate','painted',a,b,frame)
        a,b=snapshots();paint('first',snapshot=b);D.qualify_paint('nested-duplicate','repainted',a,b,frame)

    def test_removed_duplicate_fallback_and_detached_handle(self):
        a,b=snapshots();paint('first',snapshot=b);paint('second',snapshot=b);b['handles']['refs']['duplicate']['connected']=False
        D.qualify_paint('removed-duplicate','painted',a,b,{'error':None,'callbacks':1})
        paint('duplicate',snapshot=b)
        with self.assertRaisesRegex(AssertionError,'detachment'):D.qualify_paint('removed-duplicate','painted',a,b,{'error':None,'callbacks':1})

    def test_missing_row_exception_and_partial_write_boundary(self):
        a,b=snapshots();paint('first',snapshot=b);b['handles']['refs']['second']['connected']=False
        frame={'error':D.error_expected('removed-last-match','painted',a['handles']['ids']),'callbacks':None}
        D.qualify_paint('removed-last-match','painted',a,b,frame)
        wrong=copy.deepcopy(frame);wrong['error']['message']='different original error'
        with self.assertRaisesRegex(AssertionError,'exception'):D.qualify_paint('removed-last-match','painted',a,b,wrong)
        paint('third',snapshot=b)
        with self.assertRaisesRegex(AssertionError,'handle mutation'):D.qualify_paint('removed-last-match','painted',a,b,frame)

    def test_missing_child_keeps_partial_text_writes_and_later_rows(self):
        a,b=snapshots();paint('first',snapshot=b);paint('second',snapshot=b);b['handles']['refs']['second']['progress']=None
        frame={'error':D.error_expected('missing-child','painted',a['handles']['ids']),'callbacks':None}
        D.qualify_paint('missing-child','painted',a,b,frame)
        b['handles']['refs']['missing']['html']='mutated detached node'
        with self.assertRaises(AssertionError):D.qualify_paint('missing-child','painted',a,b,frame)

    def test_raw_id_root_exclusion_and_error(self):
        a,b=snapshots();paint('first',snapshot=b)
        D.qualify_paint('raw-id-root','painted',a,b,{'error':None,'callbacks':1})
        a,b=snapshots();frame={'error':D.error_expected('raw-id-root','repainted',a['handles']['ids']),'callbacks':None}
        D.qualify_paint('raw-id-root','repainted',a,b,frame)
        paint('decimal',snapshot=b)
        with self.assertRaises(AssertionError):D.qualify_paint('raw-id-root','repainted',a,b,frame)

    def test_remounted_list_and_old_row_never_written(self):
        a,b=snapshots()
        for value in (a,b):value['handles']['refs']['list']['connected']=False
        paint('newFirst',snapshot=b)
        D.qualify_paint('remount-old-handles','painted',a,b,{'error':None,'callbacks':1})
        paint('first',snapshot=b)
        with self.assertRaises(AssertionError):D.qualify_paint('remount-old-handles','painted',a,b,{'error':None,'callbacks':1})

    def test_hidden_list_still_paints_without_unhiding(self):
        a,b=snapshots();paint('first',snapshot=b);b['handles']['refs']['list']['hidden']=True
        D.qualify_paint('hidden-list','painted',a,b,{'error':None,'callbacks':1})
        b['handles']['refs']['list']['hidden']=False
        with self.assertRaisesRegex(AssertionError,'Hidden'):D.qualify_paint('hidden-list','painted',a,b,{'error':None,'callbacks':1})

    def make_report(self,scenarios=D.SCENARIOS,root=None):
        root=root or self.root;report={'runs':[]}
        for scenario in scenarios:
            for side in ('baseline','candidate'):
                case=scenario+'-'+side;directory=root/case;directory.mkdir()
                row={'case':case,'scenario':scenario,'side':side,'valid':True,'cleanupComplete':True,'snapshots':{}}
                for step in D.steps(scenario):
                    path=directory/(step+'.json');D.P.exclusive_json(path,{'full':'DOM','allState':{'lateField':'retained'},'raw':'complete save'})
                    row['snapshots'][step]={'file':case+'/'+step+'.json','sha256':D.digest(path.read_bytes())}
                report['runs'].append(row)
        return report

    def test_exact_all_pairs_without_projection(self):
        report=self.make_report();result=D.compare_runs(report,self.root)
        self.assertEqual(set(result),set(D.SCENARIOS));self.assertTrue(all(v['equal'] for v in result.values()))
        record=report['runs'][1]['snapshots']['manual-save'];path=self.root/record['file']
        value=json.loads(path.read_bytes());value['allState']['lateField']='changed';path.write_text(json.dumps(value));record['sha256']=D.digest(path.read_bytes())
        with self.assertRaisesRegex(AssertionError,'semantic mismatch'):D.compare_runs(report,self.root)
        self.assertFalse(report['comparison']['ordinary']['checkpoints']['manual-save'])

    def test_no_missing_reordered_invalid_or_failed_cleanup_subset_pass(self):
        original=self.make_report()
        for variant in ('missing','reordered','invalid','cleanup','checkpoint','hash','path'):
            report=copy.deepcopy(original)
            if variant=='missing':report['runs'].pop()
            if variant=='reordered':report['runs'][0],report['runs'][1]=report['runs'][1],report['runs'][0]
            if variant=='invalid':report['runs'][0]['valid']=False
            if variant=='cleanup':report['runs'][0]['cleanupComplete']=False
            if variant=='checkpoint':report['runs'][0]['snapshots'].pop('manual-save')
            if variant=='hash':report['runs'][0]['snapshots']['ready']['sha256']='forged'
            if variant=='path':report['runs'][0]['snapshots']['ready']['file']='../outside'
            with self.subTest(variant=variant),self.assertRaises(AssertionError):D.compare_runs(report,self.root)

    def test_supervisor_reuses_owned_cleanup_without_mutating_original_configuration(self):
        previous=(D.P.__file__,D.P.EQUIVALENCE_OUTER_SECONDS)
        def supervise(args):
            self.assertEqual(D.P.__file__,D.__file__)
            self.assertEqual(D.P.EQUIVALENCE_OUTER_SECONDS,150)
            self.assertTrue(args.equivalence_only)
            return 0
        with patch.object(D.P,'supervise',side_effect=supervise):
            self.assertEqual(D.supervise(SimpleNamespace()),0)
        self.assertEqual((D.P.__file__,D.P.EQUIVALENCE_OUTER_SECONDS),previous)
        with patch.object(D.P,'supervise',side_effect=InterruptedError('cleanup')):
            with self.assertRaises(InterruptedError):D.supervise(SimpleNamespace())
        self.assertEqual((D.P.__file__,D.P.EQUIVALENCE_OUTER_SECONDS),previous)

    def test_exact_target_and_four_new_files_only(self):
        self.assertEqual(D.TARGET,'5359676473c3b55e09acce33487ffd5f3ce8925a')
        self.assertEqual(len(D.ADDITIONS),4)
        for path in D.ADDITIONS:self.assertTrue((ROOT/path).is_file())
        source=Path(D.__file__).read_text()
        self.assertIn("all(after[p]==entry for p,entry in before.items())",source)
        self.assertIn('C.verify_sources(args.baseline,args.target,TARGET)',source)
        self.assertIn('C.STRICT_READERS',source)

    def group_report(self,group,root,driver='f'*40):
        report=self.make_report(D.GROUPS[group],root)
        watch={'workerExitCode':0,'timedOut':False,'error':None,'remainingLiveOwnedPids':[],
               'noObservedLiveOwnedDescendants':True,'outerDeadlineSeconds':150}
        report.update(group=group,mode='real-dom-boundaries',completed=True,observationsComplete=True,globalCleanupComplete=True,errors=[],
                      baselineSourceSha=D.P.BASELINE_SHA,candidateSourceSha=D.TARGET,driverSourceSha=driver,
                      settings={'bodySeconds':120,'outerSeconds':150,'playwright':'1.57.0'},supervisor=watch)
        return report,watch

    def test_fixed_groups_are_disjoint_complete_and_equal_size(self):
        self.assertEqual(tuple(D.GROUPS),('A','B'))
        self.assertEqual(D.GROUPS['A'],D.SCENARIOS[:4]);self.assertEqual(D.GROUPS['B'],D.SCENARIOS[4:])
        self.assertFalse(set(D.GROUPS['A'])&set(D.GROUPS['B']))
        self.assertEqual(D.GROUPS['A']+D.GROUPS['B'],D.SCENARIOS)
        self.assertEqual([sum(len(D.steps(s)) for s in values) for values in D.GROUPS.values()],[20,20])
        workflow=(ROOT/'.github/workflows/fleet-row-dom.yml').read_text()
        self.assertIn('for group in A B; do',workflow);self.assertIn('--group "$group"',workflow)
        self.assertIn('--output "$EVIDENCE/browser/group-$group"',workflow)
        self.assertIn('exit "$status"',workflow);self.assertIn('Required full browser aggregate',workflow)
        for group in ('A','B'):self.assertIn('saves --group '+group,workflow)
        self.assertIn('Required full 196-receipt aggregate',workflow)

    def test_group_headers_reject_missing_duplicate_false_completed_and_identity_changes(self):
        report,watch=self.group_report('A',self.root)
        D.validate_group_header(report,watch,'A','f'*40)
        for kind in ('missing','duplicate','completed','cleanup','source','group','bounds','watch'):
            changed=copy.deepcopy(report);w=copy.deepcopy(watch)
            if kind=='missing':changed['runs'].pop()
            if kind=='duplicate':changed['runs'][-1]=copy.deepcopy(changed['runs'][0])
            if kind=='completed':changed['completed']=False
            if kind=='cleanup':changed['globalCleanupComplete']=False
            if kind=='source':changed['candidateSourceSha']='e'*40
            if kind=='group':changed['group']='B'
            if kind=='bounds':changed['settings']['bodySeconds']=121
            if kind=='watch':w['workerExitCode']=False;changed['supervisor']=w
            with self.subTest(kind=kind),self.assertRaises(AssertionError):D.validate_group_header(changed,w,'A','f'*40)

    def test_raw_inventory_binds_bytes_and_rejects_symlinks(self):
        path=self.root/'original.json';path.write_text('original raw')
        before=D.evidence_inventory(self.root);path.write_text('modified raw')
        self.assertNotEqual(before,D.evidence_inventory(self.root))
        (self.root/'alias.json').symlink_to(path)
        with self.assertRaisesRegex(AssertionError,'Symlink'):D.evidence_inventory(self.root)

    def test_runtime_validation_recomputes_original_v8_http_and_dist_bytes(self):
        dist=self.root/'dist';dist.mkdir();(dist/'app.js').write_bytes(b'exact production source')
        case=self.root/'case';case.mkdir();url='http://127.0.0.1:4173/Infinity/app.js'
        variant={'url':'http://127.0.0.1:4173/Infinity/','dist':dist,'release':{'scripts':{'app.js':D.digest(b'exact production source')}}}
        row={'productionScripts':{'18':{'url':url,'kind':'production','sha256':D.digest(b'exact production source')}}}
        D.P.exclusive_json(case/'initial-script-inventory.json',[{'url':url,'scriptId':'18'},{'url':'','scriptId':'19'}])
        for name in ('http-app.js','v8-script-18.js'):(case/name).write_bytes(b'exact production source')
        D.validate_runtime_evidence(case,row,variant)
        (case/'v8-script-18.js').write_bytes(b'changed runtime source')
        with self.assertRaisesRegex(AssertionError,'source mismatch'):D.validate_runtime_evidence(case,row,variant)
        (case/'v8-script-18.js').write_bytes(b'exact production source');row['productionScripts']['18']['sha256']='forged'
        with self.assertRaisesRegex(AssertionError,'identity differs'):D.validate_runtime_evidence(case,row,variant)

    def aggregate_fixture(self):
        output=self.root/'browser';output.mkdir();driver='f'*40
        fixture=self.root/'fixture.json';fixture.write_bytes(b'complete original fixture')
        source={'source':'recomputed exact identity'};D.P.exclusive_json(self.root/'driver-source-check.json',source)
        work={'raw':'{"full":"save"}','profile':'combined'}
        for group in D.GROUPS:
            root=output/('group-'+group);root.mkdir();report,watch=self.group_report(group,root,driver)
            report['environment']={'browser':'same official browser'};report['fixture']={'profile':'combined'}
            D.P.exclusive_bytes(root/'combined-original-fixture.json',fixture.read_bytes())
            D.P.exclusive_bytes(root/'combined-original-afterSave.json',work['raw'].encode())
            D.P.exclusive_bytes(root/'controlled-clock-source.js',D.P.CONTROLLED_SOURCE.encode())
            D.compare_runs(report,root,D.GROUPS[group]);report['evidenceInventory']=D.evidence_inventory(root)
            D.P.exclusive_json(root/'report.json',report);D.P.exclusive_json(root/'watchdog.json',watch)
        args=SimpleNamespace(output=output,driver_sha=driver,combined_fixture=fixture,baseline=self.root,target=self.root,
                             baseline_dist=self.root,candidate_dist=self.root,baseline_url='http://127.0.0.1:4176/Infinity/',candidate_url='http://127.0.0.1:4173/Infinity/')
        return args,source,work

    def run_aggregate_fixture(self,args,source,work):
        with patch.object(D,'source_identity',return_value=source),patch.object(D.C,'verify_sources'), \
             patch.object(D.P,'release_identity',return_value={}),patch.object(D.P,'qualify_release_pair'), \
             patch.object(D.P,'workload',return_value=work),patch.object(D,'validate_release_evidence'), \
             patch.object(D,'validate_case_evidence'):
            return D.aggregate_groups(args)

    def test_required_aggregate_recomputes_complete_union_and_retains_both_origins(self):
        args,source,work=self.aggregate_fixture();result=self.run_aggregate_fixture(args,source,work)
        self.assertTrue(result['completed']);self.assertEqual(len(result['runs']),16)
        self.assertEqual(sum(len(r['checkpoints']) for r in result['comparison'].values()),40)
        self.assertEqual(len(result['fixtureOrigins']),2)
        self.assertEqual((args.output/result['canonicalFixtureOrigin']['file']).read_text(),work['raw'])
        self.assertEqual([json.loads((args.output/origin['file']).read_text()) for origin in result['fixtureOrigins']],[json.loads(work['raw'])]*2)
        self.assertTrue(all(row['case'].startswith('group-') for row in result['runs']))

    def test_aggregate_rejects_changed_raw_even_when_pair_claim_still_true(self):
        args,source,work=self.aggregate_fixture()
        (args.output/'group-A/ordinary-baseline/painted.json').write_text('{"changed":"raw"}')
        with self.assertRaisesRegex(AssertionError,'raw group evidence'):self.run_aggregate_fixture(args,source,work)
        self.assertFalse(json.loads((args.output/'report.json').read_bytes())['completed'])

    def test_aggregate_rejects_forged_equal_claim_after_raw_hashes_are_updated(self):
        args,source,work=self.aggregate_fixture();root=args.output/'group-A';path=root/'ordinary-baseline/painted.json'
        path.write_text('{"changed":"raw"}');report=json.loads((root/'report.json').read_bytes())
        report['runs'][0]['snapshots']['painted']['sha256']=D.digest(path.read_bytes());report['evidenceInventory']=D.evidence_inventory(root)
        (root/'report.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(AssertionError,'semantic mismatch'):self.run_aggregate_fixture(args,source,work)

    def test_aggregate_rejects_missing_group(self):
        args,source,work=self.aggregate_fixture();(args.output/'group-B').rename(args.output/'wrong-group')
        with self.assertRaisesRegex(AssertionError,'both fixed groups'):self.run_aggregate_fixture(args,source,work)

    def test_aggregate_rejects_disagreeing_group_original_after_updated_inventory(self):
        args,source,work=self.aggregate_fixture();root=args.output/'group-B'
        (root/'combined-original-afterSave.json').write_text('{"different":"origin"}')
        report=json.loads((root/'report.json').read_bytes());report['evidenceInventory']=D.evidence_inventory(root);(root/'report.json').write_text(json.dumps(report))
        with self.assertRaisesRegex(AssertionError,'afterSave differs'):self.run_aggregate_fixture(args,source,work)

    def test_aggregate_rejects_runtime_environment_disagreement(self):
        args,source,work=self.aggregate_fixture();path=args.output/'group-B/report.json'
        report=json.loads(path.read_bytes());report['environment']['browser']='different browser';path.write_text(json.dumps(report))
        with self.assertRaisesRegex(AssertionError,'runtime environments differ'):self.run_aggregate_fixture(args,source,work)

    def fake_journal(self,items):
        rows=[]
        def add(event,**kwargs):rows.append({'event':event,'atMs':len(rows),**kwargs})
        add('startup',nodeVersion='v24.15.0',sourceCount=2,saveCount=49)
        for source in ('baseline','candidate'):
            add('reader-start',source=source);add('reader-ready',source=source,durationMs=1)
            for item in items:
                add('item-start',source=source,path=item['relative'])
                add('item-complete',durationMs=1,receipt={'source':source,'path':item['relative'],'strictReaderAccepted':True,'fullEnvelopeEqual':True,'canonicalFixedPoint':True})
        add('complete',checkCount=98)
        return ''.join(json.dumps(row)+'\n' for row in rows)

    def test_both_physical_origins_receive_all_196_reader_receipts(self):
        args,source,work=self.aggregate_fixture();report=self.run_aggregate_fixture(args,source,work)
        for row in report['runs']:(args.output/row['case']/'seeded-current.json').write_text(work['raw'])
        def readers(command,**kwargs):
            self.assertEqual(command[:3],['node','--import','tsx']);self.assertEqual(kwargs['cwd'],args.target)
            self.assertEqual(kwargs['timeout'],75);self.assertNotIn('capture_output',kwargs)
            inputs=json.loads(kwargs['input']);self.assertEqual(len(inputs['saves']),49)
            self.assertEqual(inputs['saves'][0]['relative'],f'group-{args.group}/combined-original-afterSave.json')
            kwargs['stdout'].write(json.dumps(D.expected_receipts(inputs['saves'])).encode())
            kwargs['stderr'].write(self.fake_journal(inputs['saves']).encode())
            return SimpleNamespace(returncode=0)
        with patch.object(D,'verified_aggregate',return_value=report),patch.object(D.C,'verify_sources'), \
             patch.object(D.P,'workload',return_value={**work,'key':'synthetic'}),patch.object(D,'qualify_snapshot'), \
             patch.object(D.subprocess,'run',side_effect=readers):
            for group in D.GROUPS:args.group=group;D.saves(args)
            D.aggregate_readers(args)
        value=json.loads((args.output/'strict-saves-check.json').read_bytes())
        self.assertTrue(value['completed']);self.assertEqual(value['physicalEnvelopeOccurrences'],98)
        self.assertEqual(value['actualReaderExportChecks'],196);self.assertEqual(len(value['checks']),196)
        self.assertEqual(value['logicalEnvelopeOccurrences'],97);self.assertEqual(value['logicalReaderExportChecks'],194)
        self.assertEqual([value['groups'][g]['actualChecks'] for g in D.GROUPS],[98,98])

    def test_reader_instrumentation_is_exactly_reversible_without_assertion_changes(self):
        changed=D.instrumented_readers();original=changed
        for index,(anchor,addition) in reversed(list(enumerate(D.READER_INSERTIONS))):
            altered=(addition+anchor) if index==0 else (anchor+addition)
            self.assertEqual(original.count(altered),1);original=original.replace(altered,anchor,1)
            self.assertNotIn('assert.',addition);self.assertNotIn('save.import',addition);self.assertNotIn('save.export',addition)
        self.assertEqual(original,D.C.STRICT_READERS)
        self.assertEqual(changed.count('await import(pathToFileURL(source.module).href)'),1)
        self.assertIn('writeSync(2,',changed);self.assertIn("event:'item-complete',receipt:checks[checks.length-1]",changed)
        with patch.object(D.C,'STRICT_READERS',D.C.STRICT_READERS.replace('checks=[]','checks = []')):
            with self.assertRaisesRegex(AssertionError,'anchor changed'):D.instrumented_readers()

    def test_timed_out_reader_preserves_flushed_original_prefix_and_result(self):
        args=SimpleNamespace(group='A',output=self.root,driver_sha='f'*40,baseline=self.root,target=self.root)
        items=[{'relative':str(n),'path':str(self.root/str(n))} for n in range(49)]
        prefix=''.join(self.fake_journal(items).splitlines(keepends=True)[:5])
        def timeout(command,**kwargs):
            kwargs['stderr'].write(prefix.encode());kwargs['stderr'].flush()
            raise D.subprocess.TimeoutExpired(command,75)
        with patch.object(D.subprocess,'run',side_effect=timeout):
            with self.assertRaises(D.subprocess.TimeoutExpired):D.run_reader_batch(args,items)
        self.assertEqual((self.root/'reader-A-journal.jsonl').read_text(),prefix)
        result=json.loads((self.root/'reader-A-result.json').read_bytes())
        self.assertFalse(result['completed']);self.assertTrue(result['timedOut']);self.assertEqual(result['timeoutSeconds'],75)
        self.assertEqual(result['journalSha256'],D.digest(prefix));self.assertEqual(result['error']['type'],'TimeoutExpired')

    def test_reader_journal_rejects_missing_duplicate_reordered_or_changed_receipts(self):
        items=[{'relative':str(n)} for n in range(49)];raw=self.fake_journal(items)
        self.assertEqual(D.validate_journal(raw,items)['checkCount'],98)
        for kind in ('missing','duplicate','reorder','receipt','timing'):
            rows=[json.loads(line) for line in raw.splitlines()]
            if kind=='missing':rows.pop()
            if kind=='duplicate':rows[6]=copy.deepcopy(rows[4])
            if kind=='reorder':rows[3],rows[4]=rows[4],rows[3]
            if kind=='receipt':rows[4]['receipt']['fullEnvelopeEqual']=False
            if kind=='timing':rows[4]['durationMs']=-1
            with self.subTest(kind=kind),self.assertRaises(AssertionError):D.validate_journal('\n'.join(json.dumps(row) for row in rows),items)

    def test_final_reader_aggregate_rejects_failed_missing_and_changed_raw_receipts(self):
        args=SimpleNamespace(output=self.root,driver_sha='f'*40,baseline=self.root,target=self.root)
        plans={group:[{'relative':f'group-{group}/{n}','path':str(self.root/f'group-{group}/{n}'),'sha256':str(n),'planets':100,'fleets':1000} for n in range(49)] for group in D.GROUPS}
        def readers(command,**kwargs):
            items=json.loads(kwargs['input'])['saves'];kwargs['stdout'].write(json.dumps(D.expected_receipts(items)).encode())
            kwargs['stderr'].write(self.fake_journal(items).encode());return SimpleNamespace(returncode=0)
        with patch.object(D.subprocess,'run',side_effect=readers):
            for group in D.GROUPS:args.group=group;D.run_reader_batch(args,plans[group])
        originals={p.name:p.read_bytes() for p in self.root.iterdir() if p.is_file()}
        for change in ('incomplete','missing-group','source','stdout','journal','receipt','duplicate','input'):
            for name,raw in originals.items():(self.root/name).write_bytes(raw)
            final=self.root/'strict-saves-check.json'
            if final.exists():final.unlink()
            path=self.root/'reader-A-result.json';record=json.loads(path.read_bytes())
            if change=='incomplete':record['completed']=False
            if change=='missing-group':(self.root/'reader-B-result.json').unlink()
            if change=='source':record['originalReaderSha256']='forged'
            if change=='stdout':(self.root/'reader-A-stdout.json').write_text('changed raw output')
            if change=='journal':(self.root/'reader-A-journal.jsonl').write_text('')
            if change in ('receipt','duplicate'):
                stdout=self.root/'reader-A-stdout.json';values=json.loads(stdout.read_bytes())
                if change=='receipt':values[0]['canonicalFixedPoint']=False
                else:values[1]=copy.deepcopy(values[0])
                stdout.write_text(json.dumps(values));record['stdoutSha256']=D.digest(stdout.read_bytes())
            if change=='input':
                inp=self.root/'reader-A-input.json';value=json.loads(inp.read_bytes());value['saves'][0]['sha256']='forged';inp.write_text(json.dumps(value));record['inputSha256']=D.digest(inp.read_bytes())
            path.write_text(json.dumps(record))
            with patch.object(D,'verified_aggregate',return_value={'fixtureOrigins':[]}), \
                 patch.object(D,'collect_group_saves',side_effect=lambda args,report,group,export:plans[group]):
                with self.subTest(change=change),self.assertRaises((AssertionError,FileNotFoundError)):D.aggregate_readers(args)
            self.assertFalse(json.loads(final.read_bytes())['completed'])

    def test_every_tsx_loader_starts_in_an_installed_worktree(self):
        workflow=(ROOT/'.github/workflows/fleet-row-dom.yml').read_text()
        commands=[line.strip() for line in workflow.splitlines() if 'node --import tsx' in line]
        self.assertEqual(len(commands),2)
        for command in commands:
            self.assertTrue(command.startswith('(cd "$RUNNER_TEMP/fleet-dom-baseline" && node --import tsx '),command)
        self.assertIn('(cd "$RUNNER_TEMP/fleet-dom-baseline" && node --import tsx "$RUNNER_TEMP/fleet-dom-fixture/scripts/performance-fixture.ts") > "$EVIDENCE/r8-combined.json"',commands)
        self.assertIn('ln -s "$RUNNER_TEMP/fleet-dom-baseline/node_modules" "$RUNNER_TEMP/fleet-dom-fixture/node_modules"',workflow)
        tree=ast.parse(Path(D.__file__).read_text())
        saves=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='run_reader_batch')
        calls=[node for node in ast.walk(saves) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute)
               and isinstance(node.func.value,ast.Name) and node.func.value.id=='subprocess' and node.func.attr=='run']
        self.assertEqual(len(calls),1)
        self.assertEqual([ast.literal_eval(arg) for arg in calls[0].args[0].elts[:3]],['node','--import','tsx'])
        cwd=next(keyword.value for keyword in calls[0].keywords if keyword.arg=='cwd')
        self.assertEqual(ast.unparse(cwd),'args.target')

    def test_branch_only_workflow_and_separate_exact_worktrees(self):
        workflow=(ROOT/'.github/workflows/fleet-row-dom.yml').read_text()
        self.assertIn("branches: ['codex/infinity-fleet-row-dom-20261013']",workflow)
        self.assertNotIn('workflow_dispatch',workflow);self.assertNotIn('continue-on-error',workflow)
        self.assertIn('timeout-minutes: 10',workflow);self.assertIn('160s python',workflow)
        self.assertIn('git archive "$GITHUB_SHA"',workflow);self.assertIn('git archive "$TARGET_SHA"',workflow)
        self.assertIn('GITHUB_SHA="$TARGET_SHA" node scripts/write-release.mjs',workflow)
        self.assertIn('GITHUB_SHA="$BASELINE_SHA" npm run build',workflow)
        self.assertIn('"$RUNNER_TEMP/fleet-dom-target/scripts/check-fleet-row-experiment.py" source',workflow)
        self.assertIn('git diff --exit-code "$TARGET_SHA" HEAD -- src public package.json package-lock.json',workflow)


if __name__=='__main__':unittest.main()
