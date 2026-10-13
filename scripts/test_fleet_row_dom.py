"""Stdlib-only diagnostic contracts; never claims actual native browser coverage."""
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

    def make_report(self):
        report={'runs':[]}
        for scenario in D.SCENARIOS:
            for side in ('baseline','candidate'):
                case=scenario+'-'+side;directory=self.root/case;directory.mkdir()
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
