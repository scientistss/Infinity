"""Offline acceptance-contract tests only. No Node or browser execution evidence."""
import ast
import copy
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/browser-scout-rehearsal.py'
spec = importlib.util.spec_from_file_location('scout_acceptance_contract', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeGateTests(unittest.TestCase):
    def fixture(self):
        pool = json.loads((ROOT / 'tests/fixtures/npc-scout-legacy.json').read_bytes())
        original = next(row for row in pool['rows'] if row['id'] == 'r13-empty10-zero-round-loot-delivered')
        names = ['migrated-paid31-final', 'scout11-paid-outbound', 'scout11-partial-reload', 'scout11-arrived-once',
                 'scout11-returned', 'run-cancel-reopen-fill-still-unpaid', 'attack12-paid-outbound',
                 'attack12-actual-battle', 'attack12-return-delivered-once', 'scout13-after-real-battle', 'scout13-returned']
        rows = [{'name': name, 'raw': '{}', 'rawSha256': hashlib.sha256(b'{}').hexdigest(), 'expected': {}, 'reload': False} for name in names]
        rows[2].update(reload=True,expected={'fleets':[{'id':11,'returning':False,'remaining':.5,'duration':1}],'messages':[{'npcScoutSnapshot':None}]})
        return {'schema':'infinity-scout-rehearsal-natural-route-v1',
            'source':{'sourceSha':'a'*40,'sourceScopeStatusPorcelain':'','oldSourceSha':module.SOURCE_PIN},
            'origin':{'historicalSourceSha':module.SOURCE_PIN,'rawSha256':module.RAW_PIN,'raw':original['raw']},
            'outcome':{'status':'passed','mainComplete':True},'checks':[{'passed':True}],
            'target':{'galaxy':1,'system':56,'position':15},'publicSeeds':[608135816,2242054355,320440878],
            'milestones':rows,'tape':[{'kind':'scout','fleetId':11},{'kind':'attack','fleetId':12},{'kind':'scout','fleetId':13},
                *[{'kind':'checkpoint','name':name} for name in names]]}

    def test_complete_exact_source_fixture_accepted(self):
        self.assertTrue(module.valid_natural_report(self.fixture(),'a'*40))

    def test_no_mislabeled_dirty_or_incomplete_oracle(self):
        mutations = {
            'dirty':lambda d:d['source'].update(sourceScopeStatusPorcelain=' M src/game/save.ts'),
            'different_sha':lambda d:d['source'].update(sourceSha='b'*40),
            'different_old_sha':lambda d:d['source'].update(oldSourceSha='b'*40),
            'edited_old_raw':lambda d:d['origin'].update(raw=d['origin']['raw']+' '),
            'wrong_raw_pin':lambda d:d['origin'].update(rawSha256='0'*64),
            'failed':lambda d:d['outcome'].update(status='failed'),
            'not_complete':lambda d:d['outcome'].update(mainComplete=False),
            'truthy_not_boolean':lambda d:d['outcome'].update(mainComplete=1),
            'failed_check':lambda d:d['checks'].append({'passed':False}),
            'no_checks':lambda d:d.update(checks=[]),
            'cleared_target':lambda d:d['target'].update(position=6),
            'real_seed':lambda d:d.update(publicSeeds=[3976087464]*3),
            'missing_checkpoint':lambda d:d['milestones'].pop(),
            'reordered':lambda d:d['milestones'].reverse(),
            'wrong_paid_id':lambda d:d['tape'][1].update(fleetId=13),
            'wrong_reload_type':lambda d:d['milestones'][0].update(reload=0),
            'misnamed_arrival_as_partial':lambda d:d['milestones'][2]['expected']['fleets'][0].update(returning=True),
            'partial_already_observed':lambda d:d['milestones'][2]['expected']['messages'][0].update(npcScoutSnapshot={'model':'fake'}),
            'edited_checkpoint_raw':lambda d:d['milestones'][0].update(raw=' { }'),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                data=self.fixture();mutate(data)
                self.assertFalse(module.valid_natural_report(data,'a'*40))

    def test_ci_only_gate_precedes_browser_import(self):
        source=SCRIPT.read_text()
        self.assertLess(source.index("if os.environ.get('CI') != 'true'"), source.index('from playwright.sync_api import'))
        env={**os.environ,'CI':'false','GITHUB_ACTIONS':'false'}
        with tempfile.TemporaryDirectory() as directory:
            result=subprocess.run([sys.executable,str(SCRIPT),'--natural-report','unused','--expected-report-sha256','0'*64,
                '--expected-sha','a'*40,'--output',directory],env=env,capture_output=True,text=True,timeout=10)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('CI-only',result.stderr)
        self.assertNotIn('playwright',result.stderr)

    def test_http_v8_release_identity_and_same_sha_both_jobs_are_required(self):
        source=SCRIPT.read_text();shared=(ROOT/'scripts/browser-npc-attack.py').read_text()
        for text in ('verify_bundle(page)','verify_document_response(response)','expected_report_sha256',
                     "sourceScopeStatusPorcelain",'unchanged complete original job must both be green'):
            self.assertIn(text,source)
        for text in ('Debugger.getScriptSource','httpSha256','executedSourceSha256','releaseSha256'):
            self.assertIn(text,shared)
        for forbidden in ('add_script_tag(', 'page.route(', 'route.fulfill(', 'window.__game', 'window.gameState', 'Profiler.start'):
            self.assertNotIn(forbidden,source)

    def test_shared_helpers_only_definitions_never_other_runner(self):
        module.load_shared_helpers()
        self.assertTrue(callable(module.NativeCheckJournal))
        self.assertTrue(callable(module.native_scroll_to))
        self.assertFalse(hasattr(module,'args'))
        self.assertNotIn('playwright',sys.modules)

    def test_append_journal_replay_requires_seal(self):
        module.load_shared_helpers()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'journal.jsonl';journal=module.NativeCheckJournal(path)
            checks=[{'name':'one','passed':True}];evidence=[]
            journal.sync(checks,evidence)
            journal.append('snapshot',{'completed':True,'result':'passed'})
            value=module.recover_native_report(path,root/'report.json',root/'progress.json',True)
            self.assertFalse(value['completed'])
            self.assertFalse(value['recording']['sealedReportVerified'])
            os.close(journal.fd)

    def test_journal_failure_retains_valid_prefix(self):
        module.load_shared_helpers()
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'journal.jsonl';journal=module.NativeCheckJournal(path)
            journal.sync([{'name':'durable-failure','passed':False}],[])
            os.close(journal.fd)
            with path.open('ab') as file:file.write(b'{broken-tail')
            value,meta=module.replay_native_journal(path)
            self.assertEqual(value['checks'][0]['name'],'durable-failure')
            self.assertIsNotNone(meta['error'])


class NaturalOracleTests(unittest.TestCase):
    def test_natural_main_never_injects_economy(self):
        source=(ROOT/'scripts/scout-rehearsal-natural-route.ts').read_text()
        main=source.split('// EXPLICIT SYNTHETIC BOUNDARY.')[0]
        for forbidden in ('state.planets[0]!.units','state.research.levels[','state.npcEconomy =',
                          'activePlanet(state).resources','state.nextFleetId =','state.messages ='):
            self.assertNotIn(forbidden,main)
        for text in ('sendFleet(state, request)','state = tick(state, seconds)',
                     'projectVerifiedScoutSnapshots(actual, snapshots','captureAdoptedSteps(control',
                     'old.save.serializeState(control)','old.save.importSave(row.raw)',
                     'complete r14 state equals unmodified archived 7554',
                     'all unchanged old domains and untouched old list times equal exact 7554'):
            self.assertIn(text,main)
        for line in source.splitlines():
            if line.startswith('import '):
                for forbidden in ('npc-battle"','npc-loot"','encounter-combat','npc-wallet"','npc-remainder"','galaxy"'):
                    self.assertNotIn(forbidden,line)

    def test_synthetic_changes_are_explicit_and_after_main(self):
        source=(ROOT/'scripts/scout-rehearsal-natural-route.ts').read_text()
        self.assertLess(source.index('mainComplete = true;'),source.index('performanceFixture.planets'))
        self.assertGreaterEqual(source.count('syntheticChanges:'),3)
        for text in ('all13 landed types1e12','150 typed messages IDs1000..1149','messages:FIFO150',
                     'synthetic branches never mutate natural main'):
            self.assertIn(text,source)

    def test_exact_genuine_paid_source_not_retagged(self):
        pool=json.loads((ROOT/'tests/fixtures/npc-scout-legacy.json').read_bytes())
        row=next(r for r in pool['rows'] if r['id']=='r13-empty10-zero-round-loot-delivered')
        self.assertFalse(row['synthetic']);self.assertTrue(row['naturalProgression'])
        self.assertEqual(row['sourceSha'],module.SOURCE_PIN)
        self.assertEqual(hashlib.sha256(row['raw'].encode()).hexdigest(),module.RAW_PIN)
        envelope=json.loads(row['raw']);state=envelope['state']
        self.assertEqual(envelope['revision'],13)
        self.assertEqual(state['nextFleetId'],11)
        self.assertEqual(state['planets'][0]['units']['light_fighter'],6)
        self.assertEqual(state['planets'][0]['units']['espionage_probe'],1)
        self.assertNotIn('1:56:15',state['npcEconomy']['sites'])
        self.assertEqual(state['npcEconomy']['sites']['1:56:6']['garrison'],{'light_fighter':0,'heavy_fighter':0})

    def test_independent_literal_existing_weak_target(self):
        def coordinate_random(seed,g,s,p,salt=0):
            x=(seed^(g*73856093)^(s*19349663)^(p*83492791)^((salt*2654435761)&0xffffffff))&0xffffffff
            x^=x>>16;x=x*0x7feb352d&0xffffffff;x^=x>>15;x=x*0x846ca68b&0xffffffff;x^=x>>16
            return x/4294967296
        self.assertEqual(coordinate_random(20261010,1,56,15),.23852863418869674)
        self.assertLess(coordinate_random(20261010,1,56,15),.25)
        self.assertEqual(coordinate_random(20261010,1,56,15,101),.08924779412336648)
        self.assertLess(coordinate_random(20261010,1,56,15,101),.75)

    def test_old_time_normalization_is_narrow_explicit(self):
        source=(ROOT/'scripts/scout-rehearsal-natural-route.ts').read_text()
        self.assertIn('historicalNumericAt: m.at',source)
        self.assertIn('canonicalObservedAt: row.snapshot.observedAt',source)
        self.assertIn('message.at = oldMessage.at',source)
        self.assertIn('if (!snapshots.has(message.id)) continue;',source)
        self.assertIn('Only newly typed-arrival at',source)
        self.assertNotIn('Math.round(message.at)',source)


class NativeCoverageTests(unittest.TestCase):
    def test_actual_native_controls_and_complete_dense_draft(self):
        source=SCRIPT.read_text()
        self.assertEqual(len(module.SHIPS),13)
        self.assertEqual(module.WIDTHS,(320,390,768,1440))
        for text in ('run_six(page)','inspect_examples(page, width)','control_proof(page',
                     '#npc-rehearsal-cancel','#npc-rehearsal-fill','#space-send',
                     'every game field equals independent snapshot oracle','emptycargo','expect_download()',
                     'set_input_files','separate paid send','five-term fuel equation'):
            self.assertIn(text,source)

    def test_lifecycle_and_storage_branches_explicit(self):
        source=SCRIPT.read_text()
        for text in ('same-id-remount','cancelled-import','same-world-import','conflict','curvature_and_eviction',
                     "'backup','operation':'readback'",'actual-typed-storage-bytes','totalUtf16',
                     'No unchanged-disk claim','r13 bytes backed up once','evicted report has no retained entry capability'):
            self.assertIn(text,source)

    def test_unmodified_clock_measurement_has_no_profiler_or_fake_duration(self):
        source=SCRIPT.read_text()
        tree=ast.parse(source)
        definition=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='NATIVE_TIMING' for t in n.targets))
        js=ast.literal_eval(definition.value)
        for prohibited in ('Date.now=','performance,\'now\'',"performance,'now'",'requestAnimationFrame=','Profiler.'):
            self.assertNotIn(prohibited,js)
        for required in ('performance.now()-start',"type:'longtask'",'e.isTrusted','__timingNative'):
            self.assertIn(required,js)
        self.assertIn("witness['runs'][0]['duration']<50",source)
        self.assertIn("r['duration']>=50",source)
        self.assertIn("performance_result['heapDeltaBytes']<16*1024*1024",source)
        self.assertIn('no paint claim',source)

    def test_fill_notice_is_checked_after_real_controller_frames(self):
        source=SCRIPT.read_text()
        self.assertIn("for _ in range(3):advance(page)",source)
        self.assertIn("to_have_text('仅已填入，尚未派遣或付款。请核对最新航程报价，再单独点击付费出征。')",source)
        self.assertIn('unpaid draft notice survives later production chrome frames',source)

    def test_own_leaf_roundtrip_authority_branches_cover_original_nodes(self):
        source=SCRIPT.read_text()
        self.assertIn("for attribute in ('hidden','style','aria-hidden')",source)
        self.assertIn("('#npc-rehearsal-run','#npc-rehearsal-fill','#npc-rehearsal-ship-light_fighter','#npc-rehearsal-speed')",source)
        self.assertIn('same-turn own leaf hide/restore permanently retires old review capability',source)
        self.assertIn('leaf_retirement_boundaries();curvature_and_eviction()',source)

    def test_bounded_worker_supervisor_and_no_check_count_dilution(self):
        source=SCRIPT.read_text()
        for text in ('signal.alarm(900)','time.monotonic()+910','NativeCheckJournal(journal_path)',
                     "journal.append('seal'",'recover_native_report','matching PID/start time'):
            self.assertIn(text,source)
        self.assertNotIn('checks = checks[',source)
        self.assertNotIn('checks.clear()',source)


if __name__=='__main__':unittest.main()
