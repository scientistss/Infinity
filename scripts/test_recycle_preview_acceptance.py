"""Offline recycle-preview acceptance contracts. No Node/build/browser execution."""
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
SCRIPT=ROOT/'scripts/browser-recycle-preview.py'
FIXTURE=ROOT/'scripts/recycle-preview-fixture.ts'
spec=importlib.util.spec_from_file_location('recycle_preview_native',SCRIPT)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def definition(name):
    source=SCRIPT.read_text(); tree=ast.parse(source)
    return ast.get_source_segment(source,next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name==name))


def digest(text): return hashlib.sha256(text.encode()).hexdigest()


def offline_fixture():
    """Minimal explicitly synthetic validator-only sample; never native evidence."""
    source={'sourceSha':'a'*40,'fullTree':'b'*40,'sourceCode':{'scripts/recycle-preview-fixture.ts':'c'*64,
      'scripts/deep-fixture.ts':'d'*64,'package-lock.json':'e'*64}}
    origin={'fleets':[],'research':{'levels':{'hyperspace_tech':2}},'deepSpace':{'debris':[],'reports':[]}}
    envelope={'version':9,'revision':14,'savedAt':1,'lastTickAt':1,'state':origin}
    original=json.dumps(envelope)
    producer={'sourceSha':source['sourceSha'],'fullTree':source['fullTree'],'scriptSha256':'c'*64,
      'inputProducerSha256':'d'*64,'dependencyLockSha256':'e'*64,'runtimeNode':'v22.0.0'}
    value={'schema':'infinity-recycle-preview-fixture-v1','source':producer,
      'classification':'explicit-synthetic-origin-real-engine-transitions',
      'provenance':{'syntheticInitialFunds':True,'syntheticInitialPrerequisites':True,'seedSelectedForPirate':True,
        'naturalProgression':False,'nativeBrowserPayments':False,'directStatePatchesAfterInput':False},
      'input':{'raw':original,'rawSha256':digest(original),'envelope':envelope,'producer':'scripts/deep-fixture.ts pirate'},'steps':[]}
    field={'target':{'galaxy':1,'system':50,'position':16},'metal':'40000','crystal':'20000'}
    prior=origin
    for index,name in enumerate(['paid-dispatch','outbound-arrival','pirate-battle','survivors-returned']):
        state=copy.deepcopy(prior)
        if index==2:
            state['deepSpace']={'debris':[field],'reports':[{'symbol':'pirate','battle':{'rounds':[{}]},'returned':False}]}
        if index==3: state['deepSpace']['reports'][0]['returned']=True
        raw=json.dumps({**envelope,'state':state})
        value['steps'].append({'name':name,'before':copy.deepcopy(prior),'result':state,
          'raw':raw,'rawSha256':digest(raw),'operation':{'kind':'sendFleet' if index==0 else 'tick'}})
        prior=state
    value.update(initialRaw=raw,initialRawSha256=digest(raw),base=json.loads(raw),adoptedRaw=raw,adoptedRawSha256=digest(raw),
      adoptionScope='Expected bytes after native load and explicit Save; loading alone retains initialRaw',field=field,cases=[])
    for name,recyclers,cargo,speed in [('one-recycler',1,['0','0','0'],100),('two-recyclers',2,['0','0','0'],100),
                                      ('carried-cargo',1,['1000','1000','500'],100),('speed-change',1,['1000','1000','500'],50)]:
        cargo=dict(zip(('metal','crystal','deuterium'),cargo))
        value['cases'].append({'name':name,'request':{'mission':'recycle','target':field['target'],
          'ships':{'recycler':recyclers},'cargo':cargo,'speedPercent':speed},'expected':m.independent_amounts(field,recyclers,cargo),'quote':{'ok':True}})
    value['literalGoldens']={'classification':'independent-synthetic-arithmetic-only-not-browser-fixtures',
      'debris':{'metal':'40000','crystal':'20000'},'hyperspace':2,
      'one':value['cases'][0]['expected'],'carried':value['cases'][2]['expected']}
    return value,original.encode(),source


class IndependentAmounts(unittest.TestCase):
    def test_literal_one_recycler_and_crystal_residual(self):
        expected={'capacity':'22000','collector':'22000','used':'0','room':'22000','metal':'14666',
          'crystal':'7334','leftMetal':'25334','leftCrystal':'12666'}
        self.assertEqual(m.independent_amounts({'metal':'40000','crystal':'20000'},1,{'metal':'0','crystal':'0','deuterium':'0'}),expected)

    def test_two_recyclers(self):
        value=m.independent_amounts({'metal':'40000','crystal':'20000'},2,{'metal':'0','crystal':'0','deuterium':'0'})
        self.assertEqual(value,{'capacity':'44000','collector':'44000','used':'0','room':'44000','metal':'29333',
          'crystal':'14667','leftMetal':'10667','leftCrystal':'5333'})

    def test_every_carried_resource_and_no_second_fuel_debit(self):
        value=m.independent_amounts({'metal':'40000','crystal':'20000'},1,{'metal':'1000','crystal':'1000','deuterium':'500'})
        self.assertEqual(value,{'capacity':'22000','collector':'22000','used':'2500','room':'19500','metal':'13000',
          'crystal':'6500','leftMetal':'27000','leftCrystal':'13500'})

    def test_zero_fractional_and_one_sided_fields(self):
        cargo={'metal':'0','crystal':'0','deuterium':'0'}
        for metal,crystal,want in [('0','0',('0','0')),('0.5','0.5',('0','0')),('123','0',('123','0')),('0','456',('0','456'))]:
            value=m.independent_amounts({'metal':metal,'crystal':crystal},1,cargo)
            self.assertEqual((value['metal'],value['crystal']),want)

    def test_rejects_invalid_inputs(self):
        for bad in ('NaN','Infinity','-1'):
            with self.assertRaises(ValueError): m.independent_amounts({'metal':bad,'crystal':'1'},1,{'metal':'0','crystal':'0','deuterium':'0'})
        for count in (-1,0.5,True):
            with self.assertRaises(ValueError): m.independent_amounts({'metal':'1','crystal':'1'},count,{'metal':'0','crystal':'0','deuterium':'0'})

    def test_inputs_are_never_changed(self):
        field={'metal':'40000','crystal':'20000'}; cargo={'metal':'1000','crystal':'1000','deuterium':'500'}
        before=copy.deepcopy((field,cargo)); m.independent_amounts(field,1,cargo)
        self.assertEqual((field,cargo),before)


class FixtureValidation(unittest.TestCase):
    def test_complete_exact_classified_fixture(self):
        value,original,source=offline_fixture()
        self.assertTrue(m.validate_fixture(value,original,source,'v22.0.0'))

    def test_rejects_wrong_amount_or_skipped_scenario(self):
        for mutation in (lambda v:v['cases'][0]['expected'].update(metal='14667'),lambda v:v['cases'].pop(),
                         lambda v:v['steps'].pop(1),lambda v:v['literalGoldens']['carried'].update(crystal='6499')):
            value,original,source=offline_fixture(); mutation(value)
            with self.assertRaises((ValueError,KeyError,IndexError)): m.validate_fixture(value,original,source,'v22.0.0')

    def test_rejects_ambiguous_or_falsely_natural_source(self):
        for mutation in (lambda v:v.update(classification='natural'),lambda v:v['provenance'].update(naturalProgression=True),
                         lambda v:v['provenance'].pop('syntheticInitialFunds'),lambda v:v['provenance'].update(nativeBrowserPayments=True)):
            value,original,source=offline_fixture(); mutation(value)
            with self.assertRaises(ValueError): m.validate_fixture(value,original,source,'v22.0.0')

    def test_exact_raw_full_state_runtime_and_source_cannot_drift(self):
        for mutation in (lambda v:v['input'].update(raw=v['input']['raw']+' '),lambda v:v['steps'][1]['before'].update(injected=True),
                         lambda v:v['source'].update(runtimeNode='v20.0.0'),lambda v:v['source'].update(sourceSha='f'*40),
                         lambda v:v.update(initialRawSha256='0'*64),lambda v:v['base'].update(revision=15)):
            value,original,source=offline_fixture(); mutation(value)
            with self.assertRaises(ValueError): m.validate_fixture(value,original,source,'v22.0.0')

    def test_intermediate_reader_order_does_not_replace_original_export(self):
        source=FIXTURE.read_text()
        start=source.index("function checkpoint("); end=source.index("const request:",start)
        body=source[start:end]
        self.assertIn('deepStrictEqual(importSave(raw), JSON.parse(raw), "Checkpoint strict roundtrip changed");',body)
        self.assertIn('before: serializeState(before), result: serializeState(state), raw, rawSha256: hash(raw)',body)
        self.assertNotIn('state =',body)
        self.assertNotIn('.sort(',body)
        self.assertIn('check(JSON.stringify(input) === JSON.stringify(JSON.parse(inputRaw))',source)
        self.assertIn('deepStrictEqual(base, JSON.parse(initialRaw)',source)
        self.assertIn('deepStrictEqual(JSON.parse(adoptedRaw), base',source)
        self.assertIn('exportSave(deserializeState(importSave(adoptedRaw).state), epoch) === adoptedRaw',source)

    def test_rejects_missing_or_changed_explicit_save_original(self):
        for mutation in (lambda v:v.pop('adoptedRaw'),lambda v:v.update(adoptedRawSha256='0'*64),
          lambda v:v.update(adoptionScope='rewritten-on-load'),lambda v:v.update(adoptedRaw=v['adoptedRaw']+' ')):
            value,original,source=offline_fixture();mutation(value)
            with self.assertRaises((ValueError,KeyError)):m.validate_fixture(value,original,source,'v22.0.0')
        source=definition('main_cases')
        self.assertLess(source.index('before_raw=raw(page)'),source.index("save(page)"))
        self.assertIn("before_raw==fixtures['initialRaw']",source)
        self.assertIn("after_raw==fixtures['adoptedRaw']",source)

    def test_no_new_helper_or_preview_used_as_own_oracle(self):
        source=FIXTURE.read_text()
        imports=[line for line in source.splitlines() if line.startswith('import ')]
        self.assertFalse(any('recycle-amounts' in line or 'recycle-preview-model' in line or 'space-present' in line for line in imports))
        for text in ('sendFleet(state, request)','tick(state, seconds, "live")','tick(state, returnSeconds, "live")',
                     'before: serializeState(before)','rawSha256: hash(raw)','directStatePatchesAfterInput: false',
                     'metal: "14666", crystal: "7334"','metal: "13000", crystal: "6500"'):
            self.assertIn(text,source)


class NativeContracts(unittest.TestCase):
    def test_ci_gate_rejects_before_importing_browser(self):
        source=SCRIPT.read_text()
        self.assertLess(source.index("if os.environ.get('CI')!='true'"),source.index('from playwright.sync_api import'))
        with tempfile.TemporaryDirectory() as directory:
            command=[sys.executable,str(SCRIPT),'--fixture','unused','--expected-fixture-sha256','0'*64,
              '--pirate-input','unused','--expected-input-sha256','0'*64,'--expected-sha','a'*40,
              '--expected-version',m.CANDIDATE_VERSION,'--runtime-node','v22.0.0','--chromium','unused','--output',directory]
            result=subprocess.run(command,capture_output=True,text=True,timeout=10,env={**os.environ,'CI':'false','GITHUB_ACTIONS':'false'})
        self.assertNotEqual(result.returncode,0); self.assertIn('CI-only',result.stderr); self.assertNotIn('playwright',result.stderr)

    def test_bounded_ast_helpers_are_import_only(self):
        m.load_reviewed_helpers()
        for name in ('NativeCheckJournal','verify_bundle','verify_document_response','native_scroll_to','input_number','trusted_click'):
            self.assertTrue(callable(getattr(m,name)))
        self.assertNotIn('playwright',sys.modules)
        self.assertNotIn('exec_module',definition('load_reviewed_helpers'))

    def test_zero_clock_native_browser_no_state_injection_or_model(self):
        source=SCRIPT.read_text()
        self.assertIn('if milliseconds != 0:',definition('advance'))
        self.assertIn('browser.new_context(',definition('boot'))
        self.assertIn('executable_path=args.chromium',definition('main'))
        for forbidden in ('connect_over_cdp','page.route(','route.fulfill(','window.__game','window.gameState',
                          'add_script_tag(','MutationObserver','PerformanceObserver','force=True',"caret='hide'"):
            self.assertNotIn(forbidden,source)
        self.assertEqual(source.count('localStorage.setItem('),1)
        self.assertIn('other.evaluate(',definition('protection_case'))

    def test_whole_memory_is_real_saved_and_edits_are_separate(self):
        self.assertIn("trusted_click(page,'[data-action=\"save\"]')",definition('save'))
        self.assertIn("'excludedFields':[]",definition('whole_state'))
        self.assertIn("'excludedDraftFields':[]",definition('configure'))
        observation=definition('readonly_observation')
        self.assertLess(observation.index("persist_json(label+'-before-readonly'"),observation.index('if action: action()'))
        self.assertIn("whole_state(label+'-after',save(page),baseline)",observation)
        self.assertIn("after['storage']==before['storage'] and after['controls']==before['controls']",observation)
        self.assertIn('sessionStorage',definition('all_storage'))

    def test_four_widths_native_geometry_details_focus_and_caret(self):
        self.assertEqual(m.WIDTHS,(320,390,768,1440))
        source=SCRIPT.read_text()
        for text in ("len(row['points']) == 5",'text_leaf_visibility(page',"caret='initial'",'native_scroll_to(page,SUMMARY)','native_width_wheel(page,width)',
                     "keyboard='Enter'","keyboard='Space'","before==after and page.locator(DETAILS)",
                     "witness['controlsBefore']==witness['controlsAfter']"):
            self.assertIn(text,source)
        self.assertLess(definition('snap').index("persist_json('screenshot-before'"),definition('snap').index('page.screenshot('))

    def test_missing_invalid_other_missions_and_protected_scope(self):
        source=definition('main_cases')
        for name in ('missing-known-field','invalid-draft','other-missions','stable-details-focus'):
            self.assertIn(name,source)
        self.assertIn("('transport','deploy','colonize','scout','charge','attack')",source)
        protected=definition('protection_case')
        for text in ("e['trusted'] is True",'冻结进度',"current['send']['disabled'] is True",'No private-memory claim'):
            self.assertIn(text,protected)

    def test_full_tree_http_v8_fixture_and_resources(self):
        source=SCRIPT.read_text()
        for text in ('HEAD^{tree}',"git('ls-tree', '-r', '-z'","b'blob '",'sourceModes',
                     'args.expected_fixture_sha256','args.expected_input_sha256','validate_fixture(fixtures,original,source,args.runtime_node)',
                     'len(assets)==62','verify_bundle(page)','verify_document_response(response)'):
            self.assertIn(text,source)
        shared=(ROOT/'scripts/browser-npc-attack.py').read_text()
        for text in ('Debugger.getScriptSource','httpSha256','executedSourceSha256','releaseSha256'):
            self.assertIn(text,shared)

    def test_watchdog_durable_cleanup_and_failure_alive(self):
        source=SCRIPT.read_text()
        self.assertIn('signal.alarm(220)',source); self.assertIn('deadline = time.monotonic() + 228',source)
        self.assertIn("info['birth'] == birth",definition('supervise'))
        self.assertIn('recover_native_report(',definition('supervise'))
        self.assertIn('with live_failure_evidence():',definition('main'))
        self.assertIn('browser.close()',definition('main'))
        self.assertIn('journal.sync(checks, evidence, full=full)',definition('flush'))
        self.assertIn("path.open('x'",definition('persist_json'))
        self.assertIn('os.fsync(handle.fileno())',definition('persist_json'))


class RecursiveEvidence(unittest.TestCase):
    def make_report(self,directory):
        p=Path(directory)/'witness.json'; p.write_text('{"before":{},"expected":{},"actual":{}}')
        ref={'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        report={'schema':'infinity-recycle-preview-native-v1','completed':True,'failed':0,
          'completedCases':sorted(m.REQUIRED_CASES),'clockMillisecondsAdvanced':0,
          'classification':m.NATIVE_CLASSIFICATION,'candidateVersion':m.CANDIDATE_VERSION,'sourceSha':'a'*40,'sourceTree':'b'*40,
          'fixtureSha256':'c'*64,'inputSha256':'d'*64,'checkCount':len(m.REQUIRED_CASES),'passed':len(m.REQUIRED_CASES),
          'sourceBindings':[{'httpAssets':[{'status':200,'httpSha256':'a'*64,'releaseSha256':'a'*64}],
                            'executedScripts':[{'executedSourceSha256':'a'*64,'httpSha256':'a'*64,'releaseSha256':'a'*64}]}],
          'fullSourceBinding':ref,'checks':[{'case':case,'passed':True,'detail':ref} for case in m.REQUIRED_CASES],
          'evidence':[],'errors':[],'failedRequests':[]}
        seal=m.seal_files(directory,report); path=Path(directory)/'final-files-seal.json'; path.write_text(json.dumps(seal))
        report['evidence'].append({'kind':'final-recursive-files-seal','file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        return report

    def test_complete_seal_and_refs(self):
        with tempfile.TemporaryDirectory() as directory:
            report=self.make_report(directory); self.assertTrue(m.validate_report(report,directory))

    def test_missing_ref_changed_bytes_skipped_case_or_missing_seal_fail(self):
        for mutation in ('missing','changed','skipped','seal','unreferenced-extra','failed','false-case','classification','v8'):
            with tempfile.TemporaryDirectory() as directory:
                report=self.make_report(directory)
                if mutation=='missing': (Path(directory)/'witness.json').unlink()
                if mutation=='changed': (Path(directory)/'witness.json').write_text('{}')
                if mutation=='skipped': report['completedCases'].pop()
                if mutation=='seal': report['evidence']=[]
                if mutation=='unreferenced-extra': (Path(directory)/'surprise.json').write_text('{}')
                if mutation=='failed': report['checks'][0]['passed']=False
                if mutation=='false-case': report['checks'][0]['case']='invented'
                if mutation=='classification': report['classification']='natural'
                if mutation=='v8': report['sourceBindings'][0]['executedScripts'][0]['executedSourceSha256']='b'*64
                with self.assertRaises(ValueError): m.validate_report(report,directory)

    def test_nested_reference_is_checked_recursively(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'outer.json'; p.write_text(json.dumps({'before':{'file':'missing.json','sha256':'0'*64}}))
            with self.assertRaises(ValueError): m.seal_files(directory,{'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})

    def test_symlink_outside_root_rejected(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as elsewhere:
            p=Path(elsewhere)/'secret.json'; p.write_text('{}'); (Path(directory)/'linked.json').symlink_to(p)
            with self.assertRaises(ValueError): m.seal_files(directory,{'file':'linked.json','sha256':hashlib.sha256(p.read_bytes()).hexdigest()})


if __name__=='__main__': unittest.main()
