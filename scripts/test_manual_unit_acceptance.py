"""Offline native-acceptance contracts. No Node, browser or app execution."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/browser-manual-unit-orders.py'
FIXTURE=ROOT/'scripts/manual-unit-native-fixture.ts'
spec=importlib.util.spec_from_file_location('manual_unit_native_acceptance',SCRIPT)
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


def definition(name):
    text=SCRIPT.read_text(); tree=ast.parse(text)
    node=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name)
    return ast.get_source_segment(text,node)


class IndependentGoldenTests(unittest.TestCase):
    def test_exact_all24_catalog_and_three_resources(self):
        self.assertEqual(len(module.GOLDEN),24)
        self.assertEqual(len(module.SHIPS),14)
        self.assertEqual(module.independent_total('deathstar',1000000),{'metal':'5000000000000','crystal':'4000000000000','deuterium':'1000000000000'})
        self.assertEqual(module.independent_total('solar_satellite',1),{'metal':'0','crystal':'2000','deuterium':'500'})
        self.assertEqual(module.independent_total('anti_ballistic_missile',2),{'metal':'16000','crystal':'0','deuterium':'4000'})
        self.assertEqual(module.independent_total('interplanetary_missile',2),{'metal':'25000','crystal':'5000','deuterium':'20000'})
        for unit in module.GOLDEN:
            self.assertEqual(set(module.independent_total(unit,1)),set(module.RESOURCES))

    def test_literal_oracle_rejects_bad_price_request(self):
        for count in (0,-1,1.5,True,1000001,'1'):
            with self.assertRaises(ValueError): module.independent_total('small_cargo',count)
        with self.assertRaises(ValueError): module.independent_total('other',1)

    def test_fill_counts_paid_remaining_not_original_or_transit(self):
        state={'activePlanetId':'home','planets':[
          {'id':'home','units':{'small_cargo':1},'shipyardQueue':[{'unit':'small_cargo','count':2,'orderedCount':7},{'unit':'light_fighter','count':99}]},
          {'id':'other','units':{'small_cargo':500},'shipyardQueue':[{'unit':'small_cargo','count':100}]}],
          'fleets':[{'ships':{'small_cargo':1000}}],'orders':{'tasks':[{'unit':'small_cargo','quantity':1000,'status':'running'}]}}
        original=copy.deepcopy(state)
        self.assertEqual(module.independent_fill(state,'small_cargo',5),2)
        self.assertEqual(module.independent_fill(state,'small_cargo',3),0)
        self.assertEqual(state,original)

    def test_required_raw_invalid_corpus_has_no_coercion(self):
        for value in ('','0','-1','1.5','1e3','NaN','Infinity','9007199254740992'):
            self.assertIn(value,module.INVALID)
        self.assertTrue(any(len(value)>128 for value in module.INVALID))
        self.assertNotIn('float(',definition('edit_raw'))
        self.assertNotIn('int(',definition('edit_raw'))


class ExclusiveEvidenceTests(unittest.TestCase):
    def setUp(self):
        module.load_reviewed_helpers()
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        module.out=Path(self.temp.name); module.case='case-one'

    def test_exclusive_atomic_publish_never_replaces_original(self):
        path=module.out/'original.json'; module.publish_new_json(path,{'first':1})
        original=path.read_bytes()
        with self.assertRaises(FileExistsError): module.publish_new_json(path,{'second':2})
        self.assertEqual(path.read_bytes(),original)
        self.assertFalse(list(module.out.glob('.evidence-*.tmp')))

    def test_case_identity_cannot_alias_or_escape(self):
        for value in ('a/b','../x','a b','', 'a'*101):
            module.case=value
            with self.assertRaises(ValueError): module.scenario_directory()
        module.case='case-one'; one=module.scenario_directory()
        module.case='case-two'; self.assertNotEqual(one,module.scenario_directory())

    def test_recursive_references_fail_for_nested_tamper_missing_and_escape(self):
        path=module.out/'original.json'; path.write_bytes(b'first')
        reference={'file':'original.json','sha256':hashlib.sha256(b'first').hexdigest()}
        graph={'checks':[{'detail':{'before':reference,'after':{'nested':[reference]}}}]}
        module.verify_file_references(graph)
        path.write_bytes(b'changed')
        with self.assertRaises(ValueError): module.verify_file_references(graph)
        for filename in ('missing.json','../original.json','/original.json','a\\b','./original.json'):
            with self.assertRaises(ValueError): module.verify_file_references({'deep':[{'file':filename,'sha256':'0'*64}]})

    def test_recursive_references_refuse_symlinks(self):
        real=module.out/'real'; real.write_bytes(b'payload'); (module.out/'link').symlink_to(real)
        with self.assertRaises(ValueError): module.verify_file_references({'file':'link','sha256':hashlib.sha256(b'payload').hexdigest()})

    def test_final_seal_verifies_full_report_first(self):
        source=definition('flush')
        self.assertLess(source.index('verify_file_references(value)'),source.index("publish_new_json(out/'manual-unit-browser-report.json'"))
        self.assertLess(source.index("publish_new_json(out/'manual-unit-browser-report.json'"),source.index("journal.append('seal'"))
        self.assertIn("'recursiveReferencesVerified':True",source)

    def test_persist_is_sequenced_case_local_and_exclusive(self):
        source=definition('persist_json')
        self.assertIn('evidence_sequence+=1',source)
        self.assertIn('scenario_directory()',source)
        self.assertIn('publish_new_json(path,value)',source)
        self.assertNotIn('atomic_json(',source)
        self.assertNotIn('re.sub(',source)


class NativeContractTests(unittest.TestCase):
    def test_ci_only_precedes_playwright_import(self):
        source=definition('main')
        self.assertLess(source.index("os.environ.get('CI')!='true'"),source.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as out:
            command=[sys.executable,str(SCRIPT),'--fixture','unused','--expected-fixture-sha256','0'*64,
              '--natural-report','unused','--source-binding','unused','--expected-sha','a'*40,
              '--expected-version',module.CANDIDATE_VERSION,'--runtime-node','v22.0.0',
              '--output',out,'--chromium','unused']
            result=subprocess.run(command,capture_output=True,text=True,timeout=10,env={**os.environ,'CI':'false','GITHUB_ACTIONS':'false'})
        self.assertNotEqual(result.returncode,0); self.assertIn('CI-only',result.stderr)
        self.assertNotIn('playwright',result.stderr)

    def test_import_and_helpers_do_not_start_old_runner(self):
        module.load_reviewed_helpers()
        self.assertNotIn('playwright',sys.modules)
        self.assertIn('isinstance(n,(ast.FunctionDef,ast.ClassDef))',definition('load_reviewed_helpers'))
        self.assertNotIn('exec_module',definition('load_reviewed_helpers'))

    def test_native_anonymous_context_and_actual_production_binding(self):
        source=SCRIPT.read_text()
        for required in ('browser.new_context(',"'cookies':[]",'context.new_page()',"Debugger.getScriptSource",'r.body()',"'httpSha256'",'release[\'sourceSha\']==args.expected_sha'):
            self.assertIn(required,source)
        for forbidden in ('connect_over_cdp','window.gameState','window.__game','page.route(','route.fulfill(','add_script_tag(','Profiler.start'):
            self.assertNotIn(forbidden,source)

    def test_unmodified_clock_separate_host_and_native_geometry(self):
        self.assertIn('time.monotonic()',SCRIPT.read_text())
        self.assertIn('milliseconds not in (0,1000)',definition('advance'))
        self.assertIn("CLOCK.replace('__EPOCH__'",definition('boot'))
        self.assertNotIn('Date.now=',SCRIPT.read_text())
        self.assertIn('native_scroll_to(page,selector)',definition('four_widths'))

    def test_natural_step_audit_preserves_every_frame_without_extra_save_or_reload(self):
        source=definition('natural_route')
        step=source.split("elif operation['kind']=='advance':")[1].split("elif operation['kind']=='pay':")[0]
        self.assertIn("fixtures['natural']['tickAudit'][tick_index]",step)
        self.assertIn('observed=advance(page,1000)',step)
        self.assertIn("'observedClock':observed",step)
        self.assertNotIn('save(page)',step)
        self.assertNotIn('reload(',step)
        self.assertIn("whole_state(operation['name'],save(page),expected)",source)

    def test_money_and_mode_originals_precede_action_and_assert(self):
        source=definition('mode_only_then_pay')
        self.assertLess(source.index("persist_json('before-mode-original'"),source.index('prepare(page,'))
        self.assertLess(source.index("persist_json('before-payment-original'"),source.index("trusted_click(page,b('upay'"))
        self.assertLess(source.index("persist_json('after-payment-original'"),source.index("whole_state('synchronous-paid-world'"))
        self.assertIn("save(page,'after-mode-complete-memory')",source)
        self.assertIn('double=double',source)
        self.assertIn("after_card['input']==value",source)

    def test_legal_native_trim_and_leading_zero_preserve_raw_and_pay_exactly_two(self):
        source=definition('legal_raw_payment')
        self.assertIn("legal['raw']==' 0002 '",source)
        self.assertIn("{'metal':'4000','crystal':'4000','deuterium':'0'}",source)
        self.assertIn("mode_only_then_pay(page,'small_cargo','count',legal['raw'],2",source)
        self.assertIn('legalRaw:{raw:" 0002 ",count:2',FIXTURE.read_text())

    def test_invalid_complete_memory_not_just_stale_storage(self):
        source=definition('invalid_and_all_units')
        self.assertIn('for unit in GOLDEN:',source)
        self.assertIn('for index,value in enumerate(INVALID):',source)
        self.assertIn("whole_state('invalid-complete-memory-no-mutation',save(page),base)",source)
        self.assertIn("observed['input']==value",source)
        self.assertIn('page.mouse.click(',source)
        self.assertLess(source.index("persist_json('invalid-before'"),source.index('page.mouse.click('))

    def test_failure_originals_before_context_cleanup(self):
        source=definition('live_context')
        self.assertLess(source.index('capture_failure(page)'),source.index('context.close()'))
        self.assertIn("('failure-storage'",definition('capture_failure'))
        self.assertIn("caret='initial'",definition('capture_failure'))

    def test_screenshot_never_hides_caret_or_changes_authority(self):
        source=definition('snap')
        self.assertLess(source.index("witness['before']="),source.index('page.screenshot('))
        self.assertLess(source.index("witness['after']="),source.index("check('caret=initial"))
        self.assertIn('finally:',source)
        self.assertNotIn("caret='hide'",SCRIPT.read_text())
        self.assertNotIn('force=True',SCRIPT.read_text())
        self.assertEqual(module.WIDTHS,(320,390,768,1440))

    def test_hidden_price_and_ancestor_aba_retire_payment(self):
        source=definition('lifecycle_and_hostile_dom')
        for label in ('quote-hidden','total-hidden','quote-hide-show','ancestor-hide-show','class-hide-show','style-visibility-hide-show','quote-text-tamper','total-text-tamper','same-text-hidden-child'):
            self.assertIn(label,source)
        self.assertIn("whole_state('retired-or-untrusted-node-has-no-payment-authority',save(page),expected)",source)

    def test_changed_max_and_fill_require_reselection_before_new_payment(self):
        source=definition('latest_plan')
        self.assertIn("for mode in ('max','fill'):",source)
        self.assertIn("after['payDisabled']",source)
        self.assertLess(source.index("whole_state('latest-plan-only-entire-world'"),source.index('mode_only_then_pay('))
        self.assertIn("fresh['count']",source)

    def test_cancelled_and_failed_real_file_leave_visible_quote_retired(self):
        source=definition('rejected_import_attempts')
        self.assertIn("('cancelled-import','failed-import')",source)
        self.assertIn('accept=False,navigate=False',source)
        self.assertIn('.set_input_files(str(path))',source)
        self.assertIn("value['payDisabled'] and value['input']=='1'",source)
        self.assertIn("whole_state('import-attempt-entire-memory-unchanged',save(page),before)",source)
        self.assertLess(source.index("whole_state('import-attempt-entire-memory-unchanged'"),source.index('mode_only_then_pay('))

    def test_headed_native_visibility_restores_focus_without_faking_properties(self):
        source=definition('hidden_resume')
        self.assertEqual(source.count("Emulation.setFocusEmulationEnabled',{'enabled':False}"),2)
        self.assertIn('nativeHidden',source)
        self.assertIn('nativeVisibility',source)
        self.assertIn('e.trusted&&e.hidden',source)
        self.assertIn('e.trusted&&!e.hidden',source)
        self.assertIn('timeout=5000,polling=50',source)
        self.assertIn("windows['game']['windowId']==windows['cover']['windowId']",source)
        self.assertNotIn('Object.defineProperty',source)
        self.assertNotIn('dispatchEvent',source)
        self.assertIn('headless=False',definition('main'))

    def test_file_completion_uses_exact_new_event_and_bounded_terminal_observation(self):
        source=definition('wait_file_result')
        self.assertIn('files.length===count+1',source)
        self.assertIn('files.at(-1).name===name',source)
        self.assertIn('text!==oldStatus',source)
        self.assertIn('timeout=5000',source)
        self.assertIn('finally:',source)
        self.assertIn('file-result-first-observation',source)
        self.assertIn('file-result-final-observation',source)
        for name in ('import_file','rejected_import_attempts'):
            self.assertNotIn('wait_for_timeout',definition(name))
        self.assertNotIn('wait_for_timeout(100)',SCRIPT.read_text())

    def test_protection_exact_raw_is_separate_from_memory_save(self):
        source=definition('protection_boundary')
        self.assertIn('after=={**before,KEY:competing_raw}',source)
        self.assertIn("e['trusted']",source)
        self.assertNotIn('save(page)',source)

    def test_all_authority_boundaries_and_no_input_mutation(self):
        source=definition('lifecycle_and_hostile_dom')
        for name in ('tab-away','switch-planet-return','same-id-import','reset','duplicate','detach','detach-reinsert','crosslabel','ancestor-reinsert'):
            self.assertIn(name,source)
        self.assertIn("whole_state('retired-or-untrusted-node-has-no-payment-authority',save(page),expected)",source)
        self.assertIn("hidden=='hidden'",definition('hidden_resume'))
        self.assertIn("whole_state('latest-plan-only-entire-world',save(page),fixture['afterTick'])",definition('latest_plan'))


class FixtureProvenanceTests(unittest.TestCase):
    def test_fresh_immutable_natural_source_with_original_report(self):
        source=FIXTURE.read_text()
        for required in (module.OLD_SHA,module.REPORT_SHA,'sourceBinding.complete === true','natural.provenance.injectedGameState === false',
          '05-home-research-naturally-paid-and-completed','09-home-manufacturing-colony-research','fullTree:git("rev-parse","HEAD^{tree}")'):
            self.assertIn(required,source)
        self.assertNotIn('manual-unit-quote',source.split('import { SAVE_VERSION')[1])

    def test_natural_continuation_uses_only_paid_apis_and_live_ticks(self):
        source=FIXTURE.read_text(); route=source.split('checkpoint("natural05-original")')[1].split('function syntheticBase()')[0]
        self.assertIn('state = tick(state,1,"live")',route)
        self.assertIn('before,after:serializeState(state)',route)
        self.assertIn('resources.crystal.lt(10000)',route)
        self.assertIn('pay("fill","5",2',route)
        self.assertIn('accepted(sendFleet(transit,transitRequest))',route)
        for forbidden in ('resources=','resources =','buildings.','research.levels','units.small_cargo='):
            self.assertNotIn(forbidden,route)

    def test_natural_partial_paid_batch_distinguishes_remaining_from_ordered(self):
        source=FIXTURE.read_text()
        self.assertIn('natural-paid-two-now-one-remaining',source)
        self.assertIn('orderedCount===2',source)
        self.assertIn('units.small_cargo === 2',source)
        self.assertIn('tickAudit:naturalTickAudit',source)
        self.assertIn('paid(afterPlanTick,"small_cargo",freshMax)',source)
        self.assertIn('paid(afterPlanTick,"small_cargo",freshFill)',source)
        self.assertNotIn('paid(clone(afterPlanTick)',source)

    def test_synthetic_funding_is_explicit_and_all_edges_are_present(self):
        source=FIXTURE.read_text()
        self.assertIn('classification:"EXPLICIT SYNTHETIC: "+detail',source)
        for edge in ('all-unlocked','queue-full','insufficient','owned-','queued-','silo-','unit-cap','latest-plan','full-price'):
            self.assertIn('"'+edge,source)
        self.assertIn('paid(clone(s),"anti_ballistic_missile",1)',source)
        self.assertIn('unitById("solar_satellite").drives.length===0',source)


if __name__=='__main__': unittest.main()
