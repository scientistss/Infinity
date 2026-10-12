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
from types import SimpleNamespace
from unittest.mock import patch

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


class DenseTransitDraftTests(unittest.TestCase):
    target={'galaxy':1,'system':56,'position':10}
    def draft(self):
        return {'mission':'transport','target':{'galaxy':'1','system':'56','position':'10'},'speed':'100',
          'ships':[{'unit':unit,'raw':'2' if unit=='small_cargo' else '0'} for unit in module.TRANSIT_FLYING_IDS],
          'cargo':{'metal':'0','crystal':'0','deuterium':'0'}}

    def test_exact_thirteen_dense_flying_species_with_all_twelve_zeroes(self):
        original=self.draft(); frozen=copy.deepcopy(original)
        self.assertEqual(len(module.TRANSIT_FLYING_IDS),13)
        self.assertEqual(len(set(module.TRANSIT_FLYING_IDS)),13)
        self.assertNotIn('solar_satellite',module.TRANSIT_FLYING_IDS)
        self.assertTrue(module.valid_transit_flight_draft(original,self.target))
        self.assertEqual(original,frozen)
        self.assertEqual(sum(row['raw']=='0' for row in original['ships']),12)

    def test_missing_and_duplicate_species_fail_even_with_same_total(self):
        missing=self.draft(); missing['ships'].pop()
        self.assertFalse(module.valid_transit_flight_draft(missing,self.target))
        duplicate=self.draft(); duplicate['ships'][-1]=copy.deepcopy(duplicate['ships'][1])
        self.assertFalse(module.valid_transit_flight_draft(duplicate,self.target))

    def test_satellite_or_extra_species_never_pass(self):
        for unit in ('solar_satellite','rocket_launcher','unknown_ship'):
            extra=self.draft(); extra['ships'].append({'unit':unit,'raw':'0'})
            self.assertFalse(module.valid_transit_flight_draft(extra,self.target))
            replacement=self.draft(); replacement['ships'][-1]={'unit':unit,'raw':'0'}
            self.assertFalse(module.valid_transit_flight_draft(replacement,self.target))

    def test_nonzero_other_ship_and_coerced_or_missing_values_fail(self):
        for raw in ('1','-1','0.0','',0,False,None):
            draft=self.draft(); draft['ships'][1]['raw']=raw
            self.assertFalse(module.valid_transit_flight_draft(draft,self.target))
        for raw in ('0','1','3','2.0',2):
            draft=self.draft(); draft['ships'][0]['raw']=raw
            self.assertFalse(module.valid_transit_flight_draft(draft,self.target))
        draft=self.draft(); del draft['ships'][1]['raw']
        self.assertFalse(module.valid_transit_flight_draft(draft,self.target))

    def test_complete_mission_target_speed_cargo_are_part_of_contract(self):
        for key,value in [('mission','attack'),('speed','90'),('target',{'galaxy':'1','system':'56','position':'11'}),('cargo',{'metal':'1','crystal':'0','deuterium':'0'})]:
            draft=self.draft(); draft[key]=value
            self.assertFalse(module.valid_transit_flight_draft(draft,self.target))
        draft=self.draft(); del draft['cargo']
        self.assertFalse(module.valid_transit_flight_draft(draft,self.target))

    def test_dense_source_and_native_census_precede_real_send_without_normalizing_world(self):
        source=definition('transit_fill')
        self.assertLess(source.index("persist_json('before-natural-flight'"),source.index('valid_transit_flight_draft('))
        self.assertLess(source.index('valid_transit_flight_draft('),source.index("trusted_click(page,'#space-send')"))
        self.assertIn("whole_state('actual-native-natural-two-cargo-flight',save(page),fixture['afterDispatch'])",source)
        fixture=FIXTURE.read_text()
        self.assertIn('ships:{small_cargo:2,large_cargo:0,light_fighter:0,heavy_fighter:0',fixture)
        self.assertIn('exact(transit.fleets.at(-1)!.ships,transitRequest.ships',fixture)
        self.assertNotIn('filter(',definition('valid_transit_flight_draft'))


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
            command=[sys.executable,str(SCRIPT),'--group','payments','--fixture','unused','--expected-fixture-sha256','0'*64,
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
        self.assertIn('for unit in GROUP_UNITS[args.group]:',source)
        self.assertIn('for index,value in enumerate(INVALID):',source)
        self.assertIn("whole_state('invalid-complete-memory-no-mutation',save(page),base)",source)
        self.assertIn("observed['input']==value",source)
        self.assertIn('page.mouse.click(',source)
        self.assertLess(source.index("persist_json('invalid-before'"),source.index('page.mouse.click('))

    def test_failure_originals_before_context_cleanup(self):
        source=definition('live_context')
        self.assertLess(source.index('try:'),source.index('boot(initial_raw,width)'))
        self.assertLess(source.index('capture_failure(active_page)'),source.index('active_context.close()'))
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


class FixedGroupCensusTests(unittest.TestCase):
    def test_only_two_required_cli_groups_and_no_arbitrary_filter(self):
        source=definition('main')
        self.assertIn("parser.add_argument('--group',required=True,choices=('payments','authority'))",source)
        for flag in ('--skip','--unit','--case','--subset','--timeout'):
            self.assertNotIn("add_argument('"+flag,source)
        required=['--fixture','unused','--expected-fixture-sha256','0'*64,'--natural-report','unused',
          '--source-binding','unused','--expected-sha','a'*40,'--expected-version',module.CANDIDATE_VERSION,
          '--runtime-node','v22.0.0','--output','unused','--chromium','unused']
        for group in ([],['--group','all'],['--group','small_cargo']):
            result=subprocess.run([sys.executable,str(SCRIPT),*required,*group],capture_output=True,text=True,timeout=10)
            self.assertNotEqual(result.returncode,0)
            self.assertIn('--group',result.stderr)
            self.assertNotIn('playwright',result.stderr)

    def test_fixed_literal_unit_partition_is_exhaustive_and_disjoint(self):
        payments=module.GROUP_UNITS['payments']; authority=module.GROUP_UNITS['authority']
        self.assertEqual(payments,module.SHIPS)
        self.assertEqual(authority,('rocket_launcher','light_laser','heavy_laser','gauss_cannon','ion_cannon','plasma_turret','small_shield_dome','large_shield_dome','anti_ballistic_missile','interplanetary_missile'))
        self.assertEqual((len(payments),len(authority)),(14,10))
        self.assertEqual(len(set(payments)),14); self.assertEqual(len(set(authority)),10)
        self.assertFalse(set(payments)&set(authority))
        self.assertEqual(set(payments)|set(authority),set(module.GOLDEN))

    def test_exact_original_sixty_six_scenarios_and_shared_infrastructure(self):
        payments=module.GROUP_CASES['payments']; authority=module.GROUP_CASES['authority']
        self.assertEqual((len(payments),len(authority)),(21,45))
        self.assertEqual(len(set(payments)),21); self.assertEqual(len(set(authority)),45)
        self.assertFalse(set(payments)&set(authority))
        self.assertEqual(module.INFRASTRUCTURE_CASES,('setup','suite-integrity'))
        original={'natural05-real-count-fill-max-payments','natural09-paid-flight-does-not-cover-fill',
          'SYNTHETIC-native-trim-leading-zero-raw-preserved','SYNTHETIC-silo39-one-slot-abm-succeeds',
          'SYNTHETIC-real-cross-tab-protection','SYNTHETIC-consumed-native-hidden-resume'}
        original.update('SYNTHETIC-all24-'+unit for unit in module.GOLDEN)
        original.update('SYNTHETIC-full-canonical-price-width-'+str(width) for width in (320,390,768,1440))
        original.update('SYNTHETIC-latest-plan-retires-old-'+mode for mode in ('max','fill'))
        original.update('SYNTHETIC-'+action+'-retires-visible-quote' for action in ('cancelled-import','failed-import'))
        original.update('SYNTHETIC-authority-'+action for action in ('tab-away','switch-planet-return','same-id-import','reset','duplicate','detach','detach-reinsert','crosslabel','ancestor-reinsert','quote-hidden','total-hidden','quote-hide-show','ancestor-hide-show','class-hide-show','style-visibility-hide-show','quote-text-tamper','total-text-tamper','same-text-hidden-child'))
        original.update('SYNTHETIC-reject-'+name+'-'+unit for name,unit in (
          ('queue-full','small_cargo'),('insufficient','small_cargo'),('unit-cap','small_cargo'),
          ('owned-small_shield_dome','small_shield_dome'),('owned-large_shield_dome','large_shield_dome'),
          ('queued-small_shield_dome','small_shield_dome'),('queued-large_shield_dome','large_shield_dome'),
          ('silo-39','interplanetary_missile'),('silo-40','anti_ballistic_missile'),('silo-40','interplanetary_missile')))
        self.assertEqual(set(payments)|set(authority),original)
        self.assertFalse(set(module.INFRASTRUCTURE_CASES)&original)

    def test_dispatch_preserves_every_original_function_and_660_second_bound(self):
        source=definition('main')
        self.assertIn("if args.group=='payments':\n                    natural_route(); transit_fill(); invalid_and_all_units(); legal_raw_payment(); four_widths()",source)
        self.assertIn('invalid_and_all_units(); rejected_boundaries(); latest_plan(); lifecycle_and_hostile_dom(); rejected_import_attempts(); protection_boundary(); hidden_resume()',source)
        self.assertIn('signal.alarm(660)',source)
        self.assertIn('fixture_sha256=digest(fixture_bytes)',source)
        self.assertIn("case_census()['completedCases']==list(GROUP_CASES[args.group])",source)
        report=definition('metadata')
        for field in ('group','fixtureSha256','sourceBindingSha256','runtimeNode','sourceIdentity','runtimeIdentity','caseCensus','releaseMetadata'):
            self.assertIn("'"+field+"':",report)

    def test_real_runtime_group_role_is_bound_and_never_erased_for_equal_hashes(self):
        # Explicitly synthetic environment for this pure validator unit test.
        environment={'GITHUB_RUN_ID':'synthetic-run','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'manual-unit-payments',
          'GITHUB_WORKFLOW':'synthetic-workflow','GITHUB_SHA':'a'*40,'GITHUB_REF':'refs/heads/synthetic',
          'GITHUB_REPOSITORY':'synthetic/fixture'}
        with patch.dict(os.environ,environment,clear=True): identity=module.runtime_identity()
        self.assertTrue(module.valid_runtime_identity('payments',identity,'a'*40))
        self.assertFalse(module.valid_runtime_identity('authority',identity,'a'*40))
        self.assertFalse(module.valid_runtime_identity('payments',identity,'b'*40))
        self.assertFalse(module.valid_runtime_identity('all',identity,'a'*40))
        for key in module.RUNTIME_KEYS:
            missing=copy.deepcopy(identity); missing.pop(key)
            self.assertFalse(module.valid_runtime_identity('payments',missing,'a'*40))
            empty=copy.deepcopy(identity); empty[key]=None
            self.assertFalse(module.valid_runtime_identity('payments',empty,'a'*40))
        source=definition('main')
        self.assertIn('source_binding_sha256=digest(binding_bytes)',source)
        self.assertIn("fixtures['historical']['sourceBindingSha256']==digest(binding_bytes)",source)
        self.assertIn('valid_runtime_identity(args.group,runtime_identity(),args.expected_sha)',source)
        self.assertNotIn('os.environ.pop(',SCRIPT.read_text())
        self.assertNotIn('os.environ.clear(',SCRIPT.read_text())


class LifecycleEvidenceTests(unittest.TestCase):
    def setUp(self):
        module.load_reviewed_helpers()
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        module.out=Path(self.temp.name); module.args=SimpleNamespace(group='payments')
        module.case_records=[]; module.seen_cases=set(); module.evidence=[]; module.evidence_sequence=0
        module.failure=None; module.failure_lifecycle=None; module.active_context=None; module.active_page=None
        module.context_lifecycle={}; module.KEY='save-key'; module.ORIGIN='http://127.0.0.1:4173'
        module.CLOCK='clock __EPOCH__'; self.events=[]
        module.journal=SimpleNamespace(append=lambda kind,value:self.events.append((kind,copy.deepcopy(value))))
        self.flush_patch=patch.object(module,'flush',lambda **_kwargs:None); self.flush_patch.start(); self.addCleanup(self.flush_patch.stop)
        module.begin_case('natural05-real-count-fill-max-payments')
        self.raw=json.dumps({'savedAt':100,'state':{'original':'unchanged'}})

    def test_completion_is_actual_unique_and_has_finite_monotonic_phase_times(self):
        self.assertEqual(module.case_census()['completedCases'],[])
        module.set_phase('case-actions'); module.complete_case()
        census=module.case_census(); record=census['records'][0]
        self.assertEqual(census['completedCases'],['natural05-real-count-fill-max-payments'])
        self.assertEqual(record['phase'],'completed'); self.assertEqual(record['phases'][-1]['phase'],'completed')
        self.assertGreaterEqual(record['hostCompletedMonotonic'],record['hostStartedMonotonic'])
        self.assertEqual(record['hostElapsedSeconds'],record['hostCompletedMonotonic']-record['hostStartedMonotonic'])
        self.assertEqual([p['hostMonotonic'] for p in record['phases']],sorted(p['hostMonotonic'] for p in record['phases']))
        census['records'][0]['status']='changed'; self.assertEqual(module.case_records[0]['status'],'completed')
        with self.assertRaises(ValueError): module.complete_case()
        with self.assertRaises(ValueError): module.begin_case('natural05-real-count-fill-max-payments')
        with self.assertRaises(ValueError): module.begin_case('SYNTHETIC-all24-rocket_launcher')

    def test_cannot_mark_next_case_until_previous_case_actually_completes(self):
        with self.assertRaises(ValueError): module.begin_case('natural09-paid-flight-does-not-cover-fill')
        self.assertEqual(module.case_census()['completedCases'],[])

    def test_storage_seed_failure_records_raw_before_context_creation_and_no_stale_page(self):
        closed=[]
        def new_context(**_kwargs):
            seeds=list(module.out.rglob('*planned-anonymous-native-origin-seed.json'))
            self.assertEqual(len(seeds),1)
            self.assertEqual(json.loads(seeds[0].read_text())['raw'],self.raw)
            return SimpleNamespace(storage_state=lambda:(_ for _ in ()).throw(TimeoutError('storage_state timeout')),
              close=lambda:closed.append('context closed'))
        module.browser=SimpleNamespace(new_context=new_context)
        module.active_page=SimpleNamespace(is_closed=lambda:True)  # A previous case must not be reused.
        with self.assertRaisesRegex(TimeoutError,'storage_state timeout'):
            with module.live_context(self.raw): self.fail('No app page was created')
        self.assertEqual(closed,['context closed'])
        self.assertIsNone(module.active_page); self.assertIsNone(module.active_context)
        self.assertEqual(module.failure_lifecycle['failurePhase'],'boot-read-context-storage')
        self.assertTrue(module.failure_lifecycle['contextCreated']); self.assertFalse(module.failure_lifecycle['pageCreated'])
        self.assertIsNone(module.failure_lifecycle['page'])
        self.assertEqual(module.case_census()['completedCases'],[])
        self.assertEqual(module.case_records[0]['status'],'failed')
        self.assertEqual(len(list(module.out.rglob('*failure-lifecycle.json'))),1)
        self.assertFalse(list(module.out.rglob('*failure-dom.json')))

    def test_live_page_failure_originals_are_captured_before_actual_cleanup(self):
        order=[]; closed=[False]
        page=SimpleNamespace(is_closed=lambda:closed[0],evaluate=lambda *_: {},
          content=lambda:order.append('dom') or '<html>actual app</html>',
          screenshot=lambda **_:order.append('screen') or b'actual screenshot')
        seed={'cookies':[],'origins':[{'origin':module.ORIGIN,'localStorage':[{'name':module.KEY,'value':self.raw},{'name':'infinity.ui.tab','value':'overview'}]}]}
        context=SimpleNamespace(storage_state=lambda:seed,add_init_script=lambda _:None,new_page=lambda:page,
          close=lambda: (order.append('closed'),closed.__setitem__(0,True)))
        module.browser=SimpleNamespace(new_context=lambda **_:context)
        with patch.object(module,'check',lambda *_:None),patch.object(module,'attach',side_effect=RuntimeError('observer failure')):
            with self.assertRaisesRegex(RuntimeError,'observer failure'):
                with module.live_context(self.raw): self.fail('Observer preparation failed')
        self.assertEqual(order,['dom','screen','closed'])
        self.assertEqual(module.failure_lifecycle['failurePhase'],'boot-attach-observers')
        self.assertTrue(module.failure_lifecycle['pageCreated'])
        self.assertFalse(module.failure_lifecycle['page']['isClosed'])
        self.assertEqual(module.case_census()['completedCases'],[])

    def test_success_is_not_completed_until_context_close_returns(self):
        def close():
            self.assertEqual(module.case_census()['completedCases'],[])
            self.events.append(('actual-close',{}))
        context=SimpleNamespace(close=close)
        def boot(*_):
            module.active_context=context; module.active_page=object(); return context,module.active_page
        with patch.object(module,'boot',side_effect=boot):
            with module.live_context(self.raw): self.assertEqual(module.case_census()['completedCases'],[])
        self.assertEqual(module.case_census()['completedCases'],['natural05-real-count-fill-max-payments'])
        self.assertLess([kind for kind,_ in self.events].index('actual-close'),[kind for kind,_ in self.events].index('case-complete'))

    def test_outer_failure_does_not_touch_closed_playwright_or_reuse_previous_page(self):
        source=definition('main')
        outer=source.split('except BaseException:')[-1]
        self.assertIn('capture_failure(None)',outer)
        self.assertNotIn('capture_failure(active_page)',outer)
        self.assertLess(definition('boot').index("persist_json('planned-anonymous-native-origin-seed'"),definition('boot').index('browser.new_context('))


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

    def test_latest_plan_reaches_true_ten_second_cadence_and_literal_receipt(self):
        source=FIXTURE.read_text()
        self.assertIn('planAdvanceSeconds < 12',source)
        self.assertIn('afterPlanTick = tick(afterPlanTick,1,"live")',source)
        self.assertIn('planAdvanceSeconds===10',source)
        self.assertIn('paidPlanJob?.jobId===87',source)
        self.assertIn('afterPlanTick.orders.nextJobId===88',source)
        self.assertIn('paidPlanJob.count===1000',source)
        self.assertIn('paidPlanTask.charged,{metal:"2000000",crystal:"2000000",deuterium:"0"}',source)
        self.assertIn('freshMax===9000 && freshFill===498',source)
        self.assertIn("fixture['advanceSeconds']==len(fixture['tickAudit'])==10",definition('latest_plan'))
        self.assertIn("for tick in fixture['tickAudit']:",definition('latest_plan'))

    def test_synthetic_oracles_share_real_zero_gap_cold_start_adoption(self):
        source=FIXTURE.read_text()
        put=source.split('function put(')[1].split('const unlocked=')[0]
        self.assertIn('raw=exportSave(s,epoch), original=JSON.parse(raw), file=importSave(raw)',put)
        self.assertIn('restored=deserializeState(file.state)',put)
        self.assertIn('startup=catchUp(restored,0), adopted=startup.state, expected=serializeState(adopted)',put)
        self.assertIn('extraExpected=extra(adopted)',put)
        self.assertIn('originalEnvelope:original,readerEnvelope:file,readerState,adoptedState:expected',put)
        self.assertIn('startup.appliedSeconds===0 && startup.rawSeconds===0',put)
        self.assertIn('["computer_4","plasma_1","first_defense"]',put)
        self.assertIn('500*expectedAchievements.length',put)
        for value in ('paid(adopted,id,1)','paid(adopted,"small_cargo",2)','paid(adopted,"anti_ballistic_missile",1)','paid(adopted,"deathstar",1000000)','let afterPlanTick = adopted'):
            self.assertIn(value,source)
        positive=source.split('const unlocked=syntheticBase();')[1].split('let full=clone(unlocked);')[0]
        self.assertNotIn('paid(clone(unlocked)',positive)
        for forbidden in ('paid(clone(wide)','paid(clone(s),"anti_ballistic_missile"','let afterPlanTick = clone(plan)'):
            self.assertNotIn(forbidden,source)
        self.assertIn('Natural unchanged handoff must also be unchanged through actual zero-gap startup',source)

    def test_same_id_import_uses_actual_saved_bytes_not_unadopted_setup(self):
        source=definition('lifecycle_and_hostile_dom')
        self.assertIn('expected=save(page); saved_raw=raw(page)',source)
        self.assertIn("'rawSha256':digest(saved_raw.encode())",source)
        self.assertIn("exact_json(saved_envelope['state'],expected)",source)
        self.assertIn("import_file(page,saved_raw,'same-id-original')",source)
        self.assertNotIn("import_file(page,fixture['raw'],'same-id-original')",source)
        self.assertLess(source.index("persist_json('same-id-real-save-import-source'"),source.index("prepare(page,unit,'count','1')"))
        self.assertLess(source.index("exact_json(saved_envelope['state'],expected)"),source.index("import_file(page,saved_raw"))

    def test_synthetic_funding_is_explicit_and_all_edges_are_present(self):
        source=FIXTURE.read_text()
        self.assertIn('classification:"EXPLICIT SYNTHETIC: "+detail',source)
        for edge in ('all-unlocked','queue-full','insufficient','owned-','queued-','silo-','unit-cap','latest-plan','full-price'):
            self.assertIn('"'+edge,source)
        self.assertIn('paid(adopted,"anti_ballistic_missile",1)',source)
        self.assertIn('unitById("solar_satellite").drives.length===0',source)


if __name__=='__main__': unittest.main()
