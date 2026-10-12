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
from types import SimpleNamespace
from unittest.mock import patch

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
                     'set_input_files','separate paid send','five-term fuel equation',
                     'exact independently expected seed losses and survivors全文','expose_round_cell',
                     'keyboard_and_paid_completion','len(backup_keys)==1'):
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

    def test_paid_completion_reruns_in_same_panel_before_full_state_save(self):
        source=SCRIPT.read_text()
        body=source[source.index('def keyboard_and_paid_completion'):source.index('def leaf_retirement_boundaries')]
        self.assertLess(body.index('trusted same-panel stale rerun'),body.index("whole_state(f'actual-paid-completion-step-{index}'"))
        for evidence in ('oldDetached:old.every','newDistinct:','samePanel:panel===','fillEnabled:',"trusted_click(page,'#npc-rehearsal-run')",'card.dispose()'):
            self.assertIn(evidence,body)

    def test_bounded_worker_supervisor_and_no_check_count_dilution(self):
        source=SCRIPT.read_text()
        for text in ('signal.alarm(900)','time.monotonic()+910','NativeCheckJournal(journal_path)',
                     "journal.append('seal'",'recover_native_report','matching PID/start time'):
            self.assertIn(text,source)
        self.assertNotIn('checks = checks[',source)
        self.assertNotIn('checks.clear()',source)


class AuthorityAtomicityTests(unittest.TestCase):
    def draft(self):
        return {'mission':'transport','target':['1','50','9'],'speed':'100',
                'ships':[[ship,'0'] for ship in module.SHIPS], 'cargo':['0','0','0']}

    def verify_draft(self, actual, expected):
        module.load_shared_helpers()
        def check(name, condition, detail=None):
            if not condition: raise AssertionError(name)
        with patch.object(module, 'draft_values', return_value=actual), patch.object(module, 'check', check):
            module.unchanged_authority_draft(object(), 'offline mutated refusal', expected)

    def test_exact_unchanged_draft_is_accepted(self):
        value=self.draft();self.verify_draft(copy.deepcopy(value), value)

    def test_non_attack_mission_cannot_hide_any_partial_draft_edit(self):
        baseline=self.draft()
        mutations={
            'mission':lambda d:d.update(mission='scout'),
            'target':lambda d:d['target'].__setitem__(1,'56'),
            'speed':lambda d:d.update(speed='70'),
            'one_ship':lambda d:d['ships'][2].__setitem__(1,'6'),
            'zero_ship_missing':lambda d:d['ships'].pop(),
            'reordered_ships':lambda d:d['ships'].reverse(),
            'cargo':lambda d:d['cargo'].__setitem__(0,'17'),
            'extra_field':lambda d:d.update(permission='invented'),
            'wrong_type':lambda d:d['target'].__setitem__(0,1),
        }
        for name, change in mutations.items():
            with self.subTest(name=name):
                actual=copy.deepcopy(baseline);change(actual)
                self.assertNotEqual(actual['mission'],'attack')
                with self.assertRaisesRegex(AssertionError,'complete ordinary draft unchanged'):
                    self.verify_draft(actual,baseline)

    def test_all_unprotected_authority_cases_save_and_compare_full_live_state(self):
        source=SCRIPT.read_text()
        body=source[source.index('def authority_boundaries'):source.index('def save_without_navigation')]
        self.assertIn('draft_before = draft_values(page)',body)
        self.assertNotIn("draft_values(page)['mission'] != 'attack'",body)
        self.assertIn("unchanged_authority_draft(page, 'authority-' + kind, draft_before)",body)
        self.assertIn("if kind != 'conflict':",body)
        self.assertIn("expected = copy.deepcopy(before_row['expected'])",body)
        self.assertIn("if kind == 'planet': expected['activePlanetId'] = 'colony-1'",body)
        self.assertIn("whole_state('authority-' + kind + '-live-state', save(page), expected)",body)
        self.assertLess(body.index("unchanged_authority_draft(page, 'authority-'"),body.index("whole_state('authority-'"))
        leaf=source[source.index('def leaf_retirement_boundaries'):source.index('def curvature_and_eviction')]
        self.assertIn("whole_state('leaf-' + selector + '-' + attribute + '-live-state', save(page), row['expected'])",leaf)

    def test_conflict_uses_blocked_save_and_protected_export_before_reload(self):
        source=SCRIPT.read_text()
        body=source[source.index("            # Genuine same-origin storage event"):source.index('def save_without_navigation')]
        for text in ("storage(page) == {**before, KEY: competing_raw}",
                     "trusted_click(page, '[data-action=\"save\"]')",
                     "storage(page) == protected_disk",'with page.expect_download()',
                     "protected_export.read_bytes() == before[KEY].encode()"):
            self.assertIn(text,body)
        self.assertLess(body.index('protected_export.read_bytes()'),body.index('page.reload('))
        self.assertNotIn("whole_state('protected",body)


class IndependentPresenterTests(unittest.TestCase):
    def fixture(self):
        snapshot={'model':'npc-scout-snapshot-v1','fleetId':11,'originId':'old-origin',
                  'target':{'galaxy':1,'system':56,'position':15},'observedAt':'32.5',
                  'stock':[662.5,331.25,32.5],'garrison':{'light_fighter':4,'heavy_fighter':0},
                  'defenderTech':{'weapons':0,'shields':0,'armour':0}}
        examples={'snapshot':snapshot,'selectedShips':{'light_fighter':6},
                  'attackerTech':{'weapons':1,'shields':5,'armour':0},'cargoFactor':1.4,
                  'expected':[{'seed':seed,'undefended':False,'loot':[0,0,0],
                    'battle':{'winner':'draw','rounds':[{}]*6,'attackerBefore':{'light_fighter':6},
                              'defenderBefore':{'light_fighter':4},'attackerAfter':{'light_fighter':6}}} for seed in (608135816,2242054355,320440878)]}
        state={'activePlanetId':'current-origin','planets':[{'id':'current-origin','name':'当前星球',
               'coordinates':{'galaxy':1,'system':50,'position':9}}],
               'research':{'levels':{'weapons_tech':1,'shielding_tech':5,'armour_tech':0,'hyperspace_tech':8}},
               'messages':[{'id':'scout-11','text':'Original exact historical report.', 'npcScoutSnapshot':copy.deepcopy(snapshot)}]}
        return examples,state

    def verify(self,actual,expected,state):
        module.load_shared_helpers()
        def check(name,condition,detail=None):
            if not condition: raise AssertionError(name)
        with patch.object(module,'check',check): module.assert_natural_presenter_copy(actual,expected,state)

    def test_complete_independent_literal_copy_matches_retained_history_and_own_inputs(self):
        expected,state=self.fixture();module.load_shared_helpers()
        wanted=module.natural_presenter_copy(expected,state);self.verify(copy.deepcopy(wanted),expected,state)
        self.assertEqual(wanted['resultParagraphs'][0],
            '三个固定公开种子的示例，不代表胜率、所有结果或损失/战利品保证。仅使用这份侦察抵达时的库存和驻军；真实抵达时情况可能不同。')
        self.assertEqual(wanted['source'],'历史情报，之后可能变化 · 侦察抵达时间 32.5 秒 · npc-scout-snapshot-v1')
        self.assertIn('当前星球 [1:50:9] → 历史目标 [1:56:15]',wanted['origin'])
        self.assertIn('历史出发星球 old-origin；舰队 #11',wanted['history'][1])
        self.assertIn('金属 662.5 · 晶体 331.25 · 重氢 32.5',wanted['history'][3])
        self.assertIn('货舱倍率 ×1.4',wanted['resultParagraphs'][2])
        self.assertIn('真实出征在派遣时冻结货舱倍率，在抵达时读取战斗科技',wanted['resultParagraphs'][2])

    def test_wrong_or_extra_probability_guarantee_time_target_stock_or_result_copy_fails(self):
        expected,state=self.fixture();module.load_shared_helpers();wanted=module.natural_presenter_copy(expected,state)
        mutations={
          'missing_warning':lambda d:d['resultParagraphs'].pop(0),
          'win_probability':lambda d:d['resultParagraphs'].__setitem__(0,'这三个结果代表胜率。'),
          'appended_guarantee':lambda d:d['resultParagraphs'].__setitem__(0,d['resultParagraphs'][0]+'保证安全。'),
          'extra_warning':lambda d:d['resultParagraphs'].append('实际胜率100%。'),
          'time':lambda d:d.update(source=d['source'].replace('32.5','33.5')),
          'freshness':lambda d:d.update(source=d['source'].replace('历史情报，之后可能变化','当前实时情报')),
          'target':lambda d:d['history'].__setitem__(2,d['history'][2].replace('1:56:15','1:56:6')),
          'current_origin':lambda d:d.update(origin=d['origin'].replace('当前星球','旧星球')),
          'historical_origin':lambda d:d['history'].__setitem__(1,d['history'][1].replace('old-origin','current-origin')),
          'rounded_stock':lambda d:d['history'].__setitem__(3,d['history'][3].replace('331.25','331.2')),
          'garrison':lambda d:d['history'].__setitem__(3,d['history'][3].replace('战斗机 4','战斗机 8')),
          'captured_tech':lambda d:d['resultParagraphs'].__setitem__(2,d['resultParagraphs'][2].replace('武器 1','武器 2')),
          'cargo_factor':lambda d:d['resultParagraphs'].__setitem__(2,d['resultParagraphs'][2].replace('×1.4','×1.5')),
          'extra_summary':lambda d:d['summaries'].append(d['summaries'][0]),
          'reordered_samples':lambda d:d['summaries'].reverse(),
          'sample_loot':lambda d:d['summaries'].__setitem__(0,d['summaries'][0].replace('金属 0','金属 100')),
        }
        for name,change in mutations.items():
            with self.subTest(name=name):
                actual=copy.deepcopy(wanted);change(actual)
                with self.assertRaisesRegex(AssertionError,'complete independent historical-source'):
                    self.verify(actual,expected,state)

    def test_oracle_rejects_wrong_history_reference_seed_and_completed_inputs(self):
        module.load_shared_helpers()
        for kind in ('retained_time','retained_fleet','wrong_seed','extra_seed','wrong_defenders','weapons','cargo'):
            with self.subTest(kind=kind):
                expected,state=self.fixture()
                if kind=='retained_time':state['messages'][0]['npcScoutSnapshot']['observedAt']='33.5'
                elif kind=='retained_fleet':state['messages'][0]['id']='scout-13'
                elif kind=='wrong_seed':expected['expected'][0]['seed']=42
                elif kind=='extra_seed':expected['expected'].append(copy.deepcopy(expected['expected'][0]))
                elif kind=='wrong_defenders':expected['expected'][0]['battle']['defenderBefore']={'light_fighter':8}
                elif kind=='weapons':state['research']['levels']['weapons_tech']=2
                else:state['research']['levels']['hyperspace_tech']=9
                with self.assertRaises(ValueError):module.natural_presenter_copy(expected,state)

    def test_native_flow_reads_and_proves_every_required_copy_region_at_all_four_widths(self):
        source=SCRIPT.read_text();body=source[source.index('def inspect_examples'):source.index('def draft_values')]
        for selector in ('#npc-rehearsal-source','#npc-rehearsal-origin','#npc-rehearsal-history-body > p',
                         '#npc-rehearsal-results > p','#npc-rehearsal-results > details.npc-battle-report > summary'):
            self.assertIn(selector,body)
        self.assertIn('assert_natural_presenter_copy(actual, expected, retained)',body)
        self.assertIn('for index in (1,2,3,4,5):',body)
        self.assertIn('for index in (1,2,3):',body)
        self.assertIn('exact-public-example-warning-and-inputs',body)
        self.assertNotIn('NPC_REHEARSAL_WARNING',source)
        self.assertNotIn('all(x in source_text',body)


class RecorderLinearityTests(unittest.TestCase):
    def runner(self,root):
        spec=importlib.util.spec_from_file_location('isolated_scout_recorder',SCRIPT)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.load_shared_helpers()
        m.args=SimpleNamespace(expected_sha='a'*40)
        m.fixture_sha256='b'*64;m.completed=False;m.case='offline-recorder';m.failure=None;m.performance_result=None
        m.checks=[];m.evidence=[];m.source_bindings=[];m.errors=[];m.failed_requests=[]
        m.report_path=root/'report.json';m.progress_path=root/'progress.json';m.journal_path=root/'journal.jsonl'
        m.journal=m.NativeCheckJournal(m.journal_path);m.last_progress_at=0;m.reset_recorder()
        return m

    def test_actual_writer_seal_replays_every_assertion_and_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            m=self.runner(Path(directory))
            m.source_bindings.append({'case':'one','httpAssets':[{'httpSha256':'c'*64}],'executedScripts':[{'executedSourceSha256':'c'*64}]})
            m.check('first actual recorder assertion',True,{'width':320})
            m.evidence.append({'kind':'screenshot','file':'320-history.png','sha256':'d'*64})
            m.begin_case('second');m.check('second actual recorder assertion',True,{'width':390})
            m.completed=True;m.flush(full=True,final=True);os.close(m.journal.fd)
            full=json.loads(m.report_path.read_bytes())
            recovered=m.recover_native_report(m.journal_path,m.report_path,m.progress_path,True)
            self.assertTrue(recovered['completed']);self.assertTrue(recovered['recording']['sealedReportVerified'])
            self.assertEqual(recovered['checks'],full['checks']);self.assertEqual(recovered['evidence'],full['evidence'])
            self.assertEqual(recovered['sourceBindings'],full['sourceBindings'])
            self.assertEqual((recovered['passed'],recovered['failed']),(2,0))
            entries=[json.loads(line)['entry'] for line in m.journal_path.read_bytes().splitlines()]
            bindings=[e for e in entries if e['kind']=='evidence' and e['value']['record']['kind']=='production-source-binding']
            self.assertEqual(len(bindings),1)
            snapshots=[e['value'] for e in entries if e['kind']=='snapshot']
            self.assertTrue(all('sourceBindings' not in row and 'checks' not in row and 'evidence' not in row for row in snapshots[:-1]))
            self.assertEqual(len(snapshots[-1]['sourceBindings']),1)

    def test_actual_failed_assertion_is_durable_and_partial_prefix_recoverable(self):
        with tempfile.TemporaryDirectory() as directory:
            m=self.runner(Path(directory));m.check('before failure',True)
            with self.assertRaisesRegex(AssertionError,'meaningful failure'):
                m.check('meaningful failure',False,{'actual':'retained raw diagnostic'})
            m.failure='Offline injected assertion failure';m.flush(full=True);os.close(m.journal.fd)
            with m.journal_path.open('ab') as output:output.write(b'{torn-tail')
            recovered=m.recover_native_report(m.journal_path,m.report_path,m.progress_path,False)
            self.assertFalse(recovered['completed']);self.assertIsNotNone(recovered['recording']['replayError'])
            self.assertEqual(recovered['checks'][-1]['detail'],{'actual':'retained raw diagnostic'})
            self.assertEqual((recovered['passed'],recovered['failed']),(1,1))
            self.assertTrue(m.journal_path.read_bytes().endswith(b'{torn-tail'))

    def test_per_assertion_and_stage_flush_never_iterate_old_prefixes(self):
        class NoScanList(list):
            def __iter__(self):raise AssertionError('Old prefix was scanned during incremental flush')
        with tempfile.TemporaryDirectory() as directory:
            m=self.runner(Path(directory))
            for name in ('checks','evidence','source_bindings','errors','failed_requests'):setattr(m,name,NoScanList())
            for index in range(40):
                if index%5==0:m.source_bindings.append({'index':index,'body':'x'*2048})
                m.check('incremental-'+str(index),True)
                m.begin_case('stage-'+str(index))
            self.assertEqual((m.recorded_checks,m.passed_count,m.recorded_sources),(40,40,8))
            os.close(m.journal.fd)

    def test_n_and_twice_n_output_bytes_events_and_terminal_writes_are_linear(self):
        def run(count):
            with tempfile.TemporaryDirectory() as directory:
                m=self.runner(Path(directory));writes=[];write=m.atomic_json
                def observed(path,value):writes.append(path.name);write(path,value)
                m.atomic_json=observed
                for index in range(count):
                    if index%4==0:m.source_bindings.append({'index':index,'httpAssets':[{'body':'immutable source bytes '*400}]})
                    if index%8==0:m.begin_case('stage-'+str(index//8))
                    m.check('assertion-'+str(index),True,{'width':320,'observed':index})
                m.completed=True;m.flush(full=True,final=True);os.close(m.journal.fd)
                recovered=m.recover_native_report(m.journal_path,m.report_path,m.progress_path,True)
                self.assertTrue(recovered['recording']['sealedReportVerified'])
                self.assertEqual(len(recovered['checks']),count)
                self.assertEqual(sum(r['kind']=='production-source-binding' for r in recovered['evidence']),count//4)
                self.assertEqual(writes.count('report.json'),1)
                raw=m.journal_path.read_bytes()
                return len(raw)+m.report_path.stat().st_size,len(raw.splitlines())
        first,second=run(32),run(64)
        self.assertLess(second[0],first[0]*2.2)
        self.assertLess(second[1],first[1]*2.1)
        self.assertGreater(second[0],first[0]*1.8)


if __name__=='__main__':unittest.main()
