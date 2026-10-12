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
        return {'schema':'infinity-scout-rehearsal-natural-route-v1','key':'infinity.original-p4.save.v1',
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
            'missing_key':lambda d:d.pop('key'),
            'wrong_key':lambda d:d.update(key='infinity.save.v1'),
            'empty_key':lambda d:d.update(key=''),
            'object_key':lambda d:d.update(key={'key':'infinity.original-p4.save.v1'}),
            'list_key':lambda d:d.update(key=['infinity.original-p4.save.v1']),
            'ui_preference_key':lambda d:d.update(key='infinity.ui.tab'),
            'number_key':lambda d:d.update(key=42),
            'null_key':lambda d:d.update(key=None),
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

    def test_http_v8_release_identity_and_same_sha_three_jobs_and_aggregate_are_required(self):
        source=SCRIPT.read_text();shared=(ROOT/'scripts/browser-npc-attack.py').read_text()
        for text in ('verify_bundle(page)','verify_document_response(response)','expected_report_sha256',
                     "sourceScopeStatusPorcelain",'All three independent jobs (verify, npc-orbital, scout-rehearsal)',
                     'required-gates aggregate must be green for this exact source SHA.'):
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
        for text in ("page, before, {**before, KEY: competing_raw}",
                     "trusted_click(page, '[data-action=\"save\"]')",
                     "page, protected_disk",'with page.expect_download()',
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
        m.out=root;m.active_page=None;m.report_path=root/'report.json';m.progress_path=root/'progress.json';m.journal_path=root/'journal.jsonl'
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


class StorageDiagnosticsTests(unittest.TestCase):
    def baseline(self):
        return {'infinity.ui.tab':'save', 'save-key':' {"wallet":31,"ids":[11],"rng":42}\n',
                'save-key.backup':'historical raw\n', 'infinity.save.v1':'legacy sentinel'}

    def run_comparison(self, root, before, actual, *, expected=None, initial_tab='save', dom=None, condition=True):
        m = RecorderLinearityTests().runner(root)
        dom = dom if dom is not None else {'selected':['messages'], 'visible':['messages']}
        page = SimpleNamespace(evaluate=lambda expression:copy.deepcopy(dom))
        with patch.object(m, 'storage', return_value=copy.deepcopy(actual)):
            try:
                m.storage_check('offline exact-storage boundary', page, before, expected,
                                initial_tab=initial_tab, visible_tab='messages', condition=condition)
            finally:
                os.close(m.journal.fd)
        return m

    def test_unchanged_storage_does_not_rewrite_persisted_save_to_visible_space_tab(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);before=self.baseline();m=self.run_comparison(root,before,copy.deepcopy(before))
            record=json.loads((root/'storage-comparison-00001.json').read_bytes())
            self.assertEqual(record['before'],before);self.assertEqual(record['expected'],before)
            self.assertEqual(record['actual'],before)
            self.assertEqual(record['initialPreference'],{'present':True,'value':'save'})
            self.assertEqual(record['domTabs'],{'selected':['messages'],'visible':['messages']})
            self.assertEqual(record['changedFromBefore'],[])
            entry=m.checks[-1]['detail'];self.assertEqual(entry['sha256'],hashlib.sha256((root/entry['file']).read_bytes()).hexdigest())
            self.assertEqual((m.passed_count,m.failed_count),(1,0))

    def test_every_raw_key_or_byte_mutation_fails_and_full_comparison_precedes_assertion(self):
        mutations={
            'save_wallet':lambda d:d.update({'save-key':d['save-key'].replace('31','32')}),
            'save_rng':lambda d:d.update({'save-key':d['save-key'].replace('42','43')}),
            'save_whitespace':lambda d:d.update({'save-key':d['save-key']+' '}),
            'backup':lambda d:d.update({'save-key.backup':'changed historical raw'}),
            'legacy':lambda d:d.update({'infinity.save.v1':'changed sentinel'}),
            'visible_tab_substituted':lambda d:d.update({'infinity.ui.tab':'messages'}),
            'extra_key':lambda d:d.update({'unrelated':'must also fail'}),
            'deleted_key':lambda d:d.pop('save-key.backup'),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);before=self.baseline();actual=copy.deepcopy(before);mutate(actual)
                with self.assertRaisesRegex(AssertionError,'offline exact-storage boundary'):
                    self.run_comparison(root,before,actual)
                record=json.loads((root/'storage-comparison-00001.json').read_bytes())
                self.assertEqual(record['before'],before);self.assertEqual(record['expected'],before)
                self.assertEqual(record['actual'],actual);self.assertTrue(record['differentFromExpected'])
                entries=[json.loads(line)['entry'] for line in (root/'journal.jsonl').read_bytes().splitlines()]
                failed=[entry['value']['record'] for entry in entries if entry['kind']=='check'][-1]
                self.assertFalse(failed['passed'])
                self.assertEqual(failed['detail']['sha256'],hashlib.sha256((root/failed['detail']['file']).read_bytes()).hexdigest())
                self.assertEqual(before,self.baseline())

    def test_full_raw_comparison_exists_when_failing_check_is_called(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root)
            before=self.baseline();actual={**before,'save-key':'unexpected mutation'}
            page=SimpleNamespace(evaluate=lambda _: {'selected':['messages'],'visible':['messages']})
            original=m.check;observed=[]
            def check(name,condition,detail=None):
                record=json.loads((root/detail['file']).read_bytes())
                self.assertEqual(record['before'],before);self.assertEqual(record['expected'],before)
                self.assertEqual(record['actual'],actual);self.assertFalse(condition);observed.append(name)
                original(name,condition,detail)
            with patch.object(m,'storage',return_value=actual), patch.object(m,'check',check):
                with self.assertRaisesRegex(AssertionError,'already persisted'):
                    m.storage_check('already persisted',page,before,initial_tab='save',visible_tab='messages')
            os.close(m.journal.fd);self.assertEqual(observed,['already persisted'])

    def test_dom_read_failure_preserves_prior_full_raw_comparison_and_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root)
            before=self.baseline();actual={**before,'save-key':'raw after failure'}
            def evaluate(_):
                record=json.loads((root/'storage-comparison-00001.json').read_bytes())
                self.assertEqual(record['before'],before);self.assertEqual(record['expected'],before)
                self.assertEqual(record['actual'],actual)
                raise RuntimeError('DOM probe unavailable')
            with patch.object(m,'storage',return_value=actual):
                with self.assertRaisesRegex(RuntimeError,'DOM probe unavailable'):
                    m.storage_check('DOM read fails',SimpleNamespace(evaluate=evaluate),before)
            os.close(m.journal.fd)
            record=json.loads((root/'storage-comparison-00001.json').read_bytes())
            self.assertEqual(record['actual'],actual);self.assertIn('DOM probe unavailable',record['domReadError'])
            self.assertEqual(m.evidence[-1]['sha256'],hashlib.sha256((root/m.evidence[-1]['file']).read_bytes()).hexdigest())
            entries=[json.loads(line)['entry'] for line in m.journal_path.read_bytes().splitlines()]
            self.assertTrue(any(e['kind']=='evidence' and e['value']['record']['kind']=='storage-comparison' for e in entries))

    def test_initial_preference_missing_or_wrong_is_not_normalized_away(self):
        for value in (None,'messages','fleet','overview'):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                before=self.baseline()
                if value is None:before.pop('infinity.ui.tab')
                else:before['infinity.ui.tab']=value
                with self.assertRaises(AssertionError):
                    self.run_comparison(Path(directory),before,copy.deepcopy(before))
                record=json.loads((Path(directory)/'storage-comparison-00001.json').read_bytes())
                self.assertEqual(record['initialPreference'],{'present':value is not None,'value':value})
                self.assertEqual(record['actual'],before)

    def test_wrong_missing_or_extra_visible_dom_tab_blocks_even_when_storage_matches(self):
        for dom in ({'selected':['fleet'],'visible':['fleet']},{'selected':['messages'],'visible':[]},
                    {'selected':['messages'],'visible':['fleet','messages']},
                    {'selected':[],'visible':['messages']}):
            with self.subTest(dom=dom), tempfile.TemporaryDirectory() as directory:
                before=self.baseline()
                with self.assertRaises(AssertionError):self.run_comparison(Path(directory),before,before,dom=dom)
                record=json.loads((Path(directory)/'storage-comparison-00001.json').read_bytes())
                self.assertEqual(record['domTabs'],dom);self.assertEqual(record['before'],before)

    def test_explicit_conflict_replacement_preserves_all_other_raw_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            before=self.baseline();expected={**before,'save-key':'exact competing raw'}
            m=self.run_comparison(Path(directory),before,expected,expected=expected)
            record=json.loads((Path(directory)/'storage-comparison-00001.json').read_bytes())
            self.assertEqual(record['changedFromBefore'],['save-key'])
            self.assertEqual(record['differentFromExpected'],[]);self.assertTrue(m.checks[-1]['passed'])

    def test_additional_authority_predicate_remains_mandatory(self):
        with tempfile.TemporaryDirectory() as directory:
            before=self.baseline()
            with self.assertRaises(AssertionError):self.run_comparison(Path(directory),before,before,condition=False)
            self.assertFalse(json.loads((Path(directory)/'storage-comparison-00001.json').read_bytes())['additionalCondition'])

    def test_paid_completion_storage_baseline_precedes_fill(self):
        body=SCRIPT.read_text().split('def keyboard_and_paid_completion():',1)[1].split('def leaf_retirement_boundaries():',1)[0]
        self.assertIn("before=storage(page);trusted_click(page,'#npc-rehearsal-fill')",body)
        self.assertIn("storage_check('fresh Fill after real completion is still unpaid', page, before)",body)

    def test_report_metadata_requires_three_named_jobs_and_aggregate(self):
        with tempfile.TemporaryDirectory() as directory:
            m=RecorderLinearityTests().runner(Path(directory));rule=m.metadata()['acceptanceRule'];os.close(m.journal.fd)
            for job in ('verify','npc-orbital','scout-rehearsal','required-gates'):
                self.assertIn(job,rule)
            self.assertIn('exact source SHA',rule)
            self.assertNotIn('both',rule)

    def test_source_contract_distinguishes_dom_only_space_navigation_from_persisted_original_tab(self):
        space=(ROOT/'src/ui/space-panel.ts').read_text();view=(ROOT/'src/ui/view.ts').read_text()
        choose=space[space.index('  function choose('):space.index('  function number(')]
        self.assertNotIn('localStorage',choose)
        self.assertIn('p.hidden=p.dataset.tabPanel!==id',choose)
        self.assertIn('b.setAttribute("aria-selected",String(active))',choose)
        self.assertIn('if(b.dataset.spaceTab){event.stopImmediatePropagation();choose(b.dataset.spaceTab);return;}',space)
        handler=space[space.index('  root.addEventListener("click",event=>{'):space.index('  const updateSpaceChrome=')]
        self.assertTrue(handler.rstrip().endswith('},true);'))
        self.assertIn('choose("fleet");transportLoad.edited();npcAttack.edited(true);',space)
        original=view[view.index('function selectTab('):view.index('/** Research art')]
        self.assertIn('localStorage.setItem(TAB_KEY, tab)',original)
        self.assertIn('TABS.some((entry) => entry.id === id) ? id : DEFAULT_TAB',original)
        body=SCRIPT.read_text().split('def natural_rehearsal(page):',1)[1].split('def configure_scout',1)[0]
        self.assertIn("initial_tab='save', visible_tab='save'",body)
        self.assertIn("initial_tab='save', visible_tab='messages'",body)
        self.assertIn("initial_tab='save', visible_tab='fleet'",body)
        self.assertNotIn("'infinity.ui.tab':'messages'",body)
        self.assertNotIn("'infinity.ui.tab':'fleet'",body)


class RetiredFillBoundaryTests(unittest.TestCase):
    def state(self, same_node=False):
        return {'initial':{'panelHidden':False,'fillDisabled':False,'fillConnected':True,
                           'cardCount':3,'cardsConnected':True},
                'samePanel':True,'sameResults':True,'sameFill':same_node,'fillCount':1,
                'panelConnected':True,'panelHidden':True,'currentFillConnected':True,
                'currentFillDisabled':same_node,'currentFillRectCount':0,
                'originalFillConnected':same_node,'originalFillDisabled':True,
                'originalCardsDetached':True,'resultsHidden':True,'resultCount':0,'runDisabled':True}

    def run_boundary(self, before=None, after=None, *, same_node=False, visible=False, enabled=True,
                     click_events=None, unexpected_events=None):
        before=self.state(same_node) if before is None else before
        after=copy.deepcopy(before) if after is None else after
        owner=self;checks=[];calls=[];events=[]
        class References:
            reads=0
            def evaluate(self, expression):
                owner.assertEqual(expression,module.RETIRED_FILL_STATE)
                self.reads+=1
                return copy.deepcopy(before if self.reads==1 else after)
        class Node:
            def is_visible(self):return visible
            def is_enabled(self):return enabled
            def click(self):raise AssertionError('direct or forced click is forbidden')
            def evaluate(self,*args):raise AssertionError('synthetic hidden click is forbidden')
        class Page:
            def locator(self, selector):
                owner.assertEqual(selector,'#npc-rehearsal-fill');return Node()
            def evaluate(self, expression, *args):
                if expression=='window.__npcClicks.length':return len(events)
                owner.assertEqual(expression,'(n)=>window.__npcClicks.slice(n)')
                return copy.deepcopy(events[args[0]:] if unexpected_events is None else unexpected_events)
        page=Page()
        def trusted_click(actual,selector):
            owner.assertIs(actual,page);owner.assertEqual(selector,'#npc-rehearsal-fill')
            calls.append('trusted-click')
            events.extend([{'id':'npc-rehearsal-fill','trusted':True}] if click_events is None else click_events)
        def check(name, condition, detail=None):
            checks.append({'name':name,'passed':bool(condition),'detail':detail})
            if not condition:raise AssertionError(name)
        with patch.object(module,'check',check),patch.object(module,'trusted_click',trusted_click,create=True):
            module.retired_fill_boundary(page,References(),same_node=same_node)
        return calls,checks

    def test_hidden_enabled_clone_has_explicit_unavailable_zero_event_witness(self):
        calls,checks=self.run_boundary()
        self.assertEqual(calls,[])
        witness=checks[-1]['detail']
        self.assertEqual(witness['action'],'native-unavailable');self.assertEqual(witness['events'],[])
        self.assertFalse(witness['visibleBefore']);self.assertTrue(witness['enabledBefore'])
        self.assertTrue(witness['after']['originalFillDisabled'])
        self.assertFalse(witness['after']['currentFillDisabled'])

    def test_detach_and_leaf_aba_keep_original_identity_but_retire_authority(self):
        calls,checks=self.run_boundary(same_node=True,enabled=False)
        self.assertEqual(calls,[])
        self.assertTrue(checks[-1]['detail']['after']['sameFill'])
        self.assertTrue(checks[-1]['detail']['after']['originalFillConnected'])

    def test_visible_enabled_fill_must_receive_one_trusted_click(self):
        before=self.state();before.update(panelHidden=False,currentFillRectCount=1)
        calls,checks=self.run_boundary(before,visible=True,enabled=True)
        self.assertEqual(calls,['trusted-click'])
        witness=checks[-1]['detail']
        self.assertEqual(witness['action'],'trusted-click')
        self.assertEqual(witness['events'],[{'id':'npc-rehearsal-fill','trusted':True}])

    def test_visible_disabled_original_has_explicit_disabled_witness(self):
        before=self.state(True);before.update(panelHidden=False,currentFillRectCount=1)
        calls,checks=self.run_boundary(before,same_node=True,visible=True,enabled=False)
        self.assertEqual(calls,[]);self.assertEqual(checks[-1]['detail']['action'],'native-unavailable')

    def test_hidden_classification_never_accepts_missing_geometry_or_wrong_disabled_state(self):
        for changes,visible,enabled in (({'panelHidden':False},False,True),
                                       ({'currentFillRectCount':1},False,True),
                                       ({'currentFillDisabled':False},True,False)):
            with self.subTest(changes=changes):
                before=self.state();before.update(changes)
                with self.assertRaisesRegex(AssertionError,'explicitly disabled or hidden'):
                    self.run_boundary(before,visible=visible,enabled=enabled)

    def test_missing_or_wrong_original_identity_cannot_be_skipped(self):
        for changes in ({'samePanel':False},{'sameResults':False},{'fillCount':0},{'fillCount':2},
                        {'panelConnected':False},{'currentFillConnected':False},
                        {'sameFill':True},{'originalFillConnected':True},
                        {'initial':{**self.state()['initial'],'cardCount':0}}):
            with self.subTest(changes=changes):
                before=self.state();before.update(changes)
                with self.assertRaisesRegex(AssertionError,'exact expected original/replacement Fill'):
                    self.run_boundary(before)

    def test_unretired_original_or_review_nodes_fail_even_when_native_control_unavailable(self):
        for changes in ({'originalFillDisabled':False},{'runDisabled':False},
                        {'originalCardsDetached':False},{'resultsHidden':False},{'resultCount':3},
                        {'sameFill':True},{'originalFillConnected':True},{'samePanel':False},
                        {'sameResults':False},{'fillCount':0},{'currentFillConnected':False}):
            with self.subTest(changes=changes):
                after=self.state();after.update(changes)
                with self.assertRaisesRegex(AssertionError,'old Fill capability stays retired'):
                    self.run_boundary(after=after)

    def test_unavailable_branch_cannot_claim_zero_events_if_any_were_observed(self):
        with self.assertRaisesRegex(AssertionError,'exact zero-event or trusted-event witness'):
            self.run_boundary(unexpected_events=[{'id':'npc-rehearsal-fill','trusted':False}])

    def test_unavailable_control_cannot_silently_become_actionable_during_witness(self):
        after=self.state();after.update(panelHidden=False,currentFillRectCount=1)
        with self.assertRaisesRegex(AssertionError,'exact zero-event or trusted-event witness'):
            self.run_boundary(after=after)

    def test_missing_untrusted_duplicate_or_wrong_target_click_never_proves_trusted_refusal(self):
        for events in ([],[{'id':'npc-rehearsal-fill','trusted':False}],
                       [{'id':'npc-rehearsal-run','trusted':True}],
                       [{'id':'npc-rehearsal-fill','trusted':True}]*2):
            with self.subTest(events=events):
                with self.assertRaisesRegex(AssertionError,'exact zero-event or trusted-event witness'):
                    self.run_boundary(visible=True,click_events=events)

    def test_mutations_keep_native_negative_full_draft_storage_and_live_state_contracts(self):
        source=SCRIPT.read_text()
        authority=source.split('def authority_boundaries():',1)[1].split('def save_without_navigation',1)[0]
        leaf=source.split('def leaf_retirement_boundaries():',1)[1].split('def curvature_and_eviction',1)[0]
        for body in (authority,leaf):
            self.assertIn('page.evaluate_handle(RETIRED_FILL_REFERENCES)',body)
            self.assertIn('finally:dispose_capture_handles(refs)',body)
            self.assertLess(body.index('retired_fill_boundary('),body.index('whole_state('))
        self.assertIn("retired_fill_boundary(page,refs,same_node=kind=='detach')",authority)
        self.assertIn('retired_fill_boundary(page,refs,same_node=True)',leaf)
        self.assertIn('e.remove();p.insertBefore(e,n)',authority)
        self.assertIn('e.cloneNode(true);e.replaceWith(c)',authority)
        self.assertIn("storage_check('cloned detached or same-ID replacement cannot fill stale draft'",authority)
        self.assertIn('condition=exact_json(draft_values(page), draft_before)',authority)
        self.assertIn('condition=draft_values(page)==draft',leaf)
        self.assertIn("unchanged_authority_draft(page, 'authority-' + kind, draft_before)",authority)
        self.assertIn("unchanged_authority_draft(page, 'leaf-' + selector + '-' + attribute, draft)",leaf)
        helper=source.split('def retired_fill_boundary(',1)[1].split('def authority_boundaries',1)[0]
        for forbidden in ('.click(', 'force=', 'dispatchEvent', 'setAttribute', '.hidden=', 'except '):
            self.assertNotIn(forbidden,helper)
        for forbidden in ('if node.is_enabled(): node.click()', 'if fill.is_visible() and fill.is_enabled():fill.click()'):
            self.assertNotIn(forbidden,source)


class ScreenshotNoninterferenceTests(unittest.TestCase):
    def state(self):
        return {'samePanel':True,'sameNodes':True,'sameAncestors':True,'allOriginalNodesConnected':True,
                'panelPresent':True,'panelHidden':False,'resultCount':3,'panelHtml':'<input id="original"><details>three retained samples</details>',
                'nodes':[{'id':'original','connected':True,'style':None,'hidden':None,'ariaHidden':None,
                          'display':'block','visibility':'visible','opacity':'1','disabled':False,'value':'6','open':None}],
                'ancestors':[{'id':'space-messages','connected':True,'style':None,'hidden':None}]}

    def page(self,root,before,after,*,capture_error=None,read_error=None):
        events=[];owner=self
        class References:
            reads=0
            def evaluate(self,expression):
                owner.assertEqual(expression,module.REHEARSAL_CAPTURE_STATE)
                self.reads+=1;events.append('before' if self.reads==1 else 'after')
                if self.reads>1 and read_error:raise RuntimeError(read_error)
                return copy.deepcopy(before if self.reads==1 else after)
            def dispose(self):events.append('dispose')
        class Page:
            def evaluate(self,expression):
                owner.assertIn('i.decode()',expression);events.append('images')
            def evaluate_handle(self,expression):
                owner.assertEqual(expression,module.REHEARSAL_CAPTURE_REFERENCES);events.append('retain');return References()
            def screenshot(self,*,path,full_page,timeout,caret):
                witness=json.loads((root/'source-capture-witness.json').read_bytes())
                owner.assertEqual(witness['before'],before);owner.assertIsNone(witness['after'])
                owner.assertEqual(witness['screenshotStatus'],'not-attempted')
                owner.assertEqual((full_page,timeout,caret),(False,7000,'initial'));events.append('screenshot')
                if capture_error:raise RuntimeError(capture_error)
                Path(path).write_bytes(b'offline-screenshot-only')
        return Page(),events

    def test_runner_owns_snap_after_loading_helpers_and_options_cover_every_screenshot(self):
        own=module.snap;module.load_shared_helpers();self.assertIs(module.snap,own)
        tree=ast.parse(SCRIPT.read_text())
        calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='screenshot']
        self.assertEqual(len(calls),3)
        ordinary=[call for call in calls if any(k.arg=='caret' and isinstance(k.value,ast.Constant) for k in call.keywords)]
        self.assertEqual(len(ordinary),2)
        for call in ordinary:self.assertEqual(ast.literal_eval(next(k.value for k in call.keywords if k.arg=='caret')),'initial')
        diagnostic=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='screenshot_caret_diagnostic')
        self.assertIn("for caret in ('hide', 'initial'):",ast.unparse(diagnostic))
        self.assertEqual(sum(isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='screenshot' for n in ast.walk(diagnostic)),1)
        helpers=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='load_shared_helpers')
        self.assertNotIn("'snap'",ast.unparse(helpers))
        self.assertEqual((ROOT/'scripts/browser-requirements.txt').read_text().splitlines()[0],'playwright==1.57.0')

    def test_identical_original_dom_is_recorded_around_image_with_no_private_token_or_dom_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root);before=self.state();page,events=self.page(root,before,before)
            m.snap(page,'source.png');os.close(m.journal.fd)
            self.assertEqual(events,['images','retain','before','screenshot','after','dispose'])
            self.assertEqual((m.passed_count,m.failed_count),(1,0))
            witness=json.loads((root/'source-capture-witness.json').read_bytes())
            self.assertEqual(witness['before'],witness['after']);self.assertEqual(witness['screenshotStatus'],'captured')
            for reference in m.evidence:
                self.assertEqual(reference['sha256'],hashlib.sha256((root/reference['file']).read_bytes()).hexdigest())
            self.assertEqual(m.checks[-1]['detail'],m.evidence[-1])
        for js in (module.REHEARSAL_CAPTURE_REFERENCES,module.REHEARSAL_CAPTURE_STATE):
            for forbidden in ('setAttribute(', 'removeAttribute(', 'setProperty(', 'replaceChildren(', 'appendChild(',
                              '.focus(', '.click(', 'MutationObserver', 'window.', 'session'):
                self.assertNotIn(forbidden,js)
        for required in ("getAttribute('style')",'getComputedStyle(node)','node.disabled','node.value',
                         'panel?.hidden','panel?.innerHTML','same(refs.nodes,nodes)','node.isConnected'):
            self.assertIn(required,module.REHEARSAL_CAPTURE_STATE)

    def test_retirement_or_any_original_identity_style_value_or_result_change_fails(self):
        mutations={
            'panel_hidden':lambda d:d.update(panelHidden=True),
            'panel_absent':lambda d:d.update(panelPresent=False),
            'panel_replaced':lambda d:d.update(samePanel=False),
            'result_replaced':lambda d:d.update(sameNodes=False),
            'ancestor_replaced':lambda d:d.update(sameAncestors=False),
            'original_detached':lambda d:d.update(allOriginalNodesConnected=False),
            'results_cleared':lambda d:d.update(panelHtml=''),
            'caret_style':lambda d:d['nodes'][0].update(style='caret-color: transparent !important;'),
            'restored_style_attribute':lambda d:d['nodes'][0].update(style=''),
            'input_zeroed':lambda d:d['nodes'][0].update(value='0'),
            'input_disabled':lambda d:d['nodes'][0].update(disabled=True),
            'ancestor_style':lambda d:d['ancestors'][0].update(style='display:none'),
        }
        for name,mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);m=RecorderLinearityTests().runner(root);before=self.state();after=copy.deepcopy(before);mutate(after)
                page,events=self.page(root,before,after)
                with self.assertRaisesRegex(AssertionError,'screenshot preserves original'):m.snap(page,'source.png')
                os.close(m.journal.fd);self.assertEqual(events[-1],'dispose')
                witness=json.loads((root/'source-capture-witness.json').read_bytes())
                self.assertEqual(witness['before'],before);self.assertEqual(witness['after'],after)
                self.assertEqual((m.passed_count,m.failed_count),(0,1))
                self.assertEqual(m.evidence[-1]['sha256'],hashlib.sha256((root/m.evidence[-1]['file']).read_bytes()).hexdigest())

    def test_missing_panel_before_and_after_never_vacuously_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root);state=self.state()
            state.update(panelPresent=False,panelHidden=None,panelHtml=None,nodes=[],ancestors=[])
            page,events=self.page(root,state,state)
            with self.assertRaisesRegex(AssertionError,'screenshot preserves original'):m.snap(page,'source.png')
            os.close(m.journal.fd);self.assertFalse(m.checks[-1]['passed']);self.assertEqual(events[-1],'dispose')

    def test_probe_disposal_attempts_every_handle_and_never_masks_an_active_failure(self):
        events=[]
        def fail(name):
            events.append(name);raise RuntimeError('cleanup '+name)
        handles=[SimpleNamespace(dispose=lambda name=name:fail(name)) for name in ('probe','references')]
        with self.assertRaisesRegex(ValueError,'original screenshot failure'):
            try:raise ValueError('original screenshot failure')
            finally:module.dispose_capture_handles(*handles)
        self.assertEqual(events,['probe','references']);events.clear()
        with self.assertRaisesRegex(RuntimeError,'cleanup probe'):module.dispose_capture_handles(*handles)
        self.assertEqual(events,['probe','references'])

    def test_screenshot_failure_keeps_original_error_and_both_available_dom_states(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root);state=self.state()
            page,events=self.page(root,state,state,capture_error='native capture failed')
            with self.assertRaisesRegex(RuntimeError,'native capture failed'):m.snap(page,'source.png')
            os.close(m.journal.fd)
            witness=json.loads((root/'source-capture-witness.json').read_bytes())
            self.assertEqual(witness['screenshotStatus'],'failed');self.assertEqual(witness['after'],state)
            self.assertIn('native capture failed',witness['screenshotError']);self.assertEqual(events[-1],'dispose')
            self.assertEqual((m.passed_count,m.failed_count),(0,0))

    def test_after_read_failure_is_durable_and_cannot_claim_noninterference(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root);state=self.state()
            page,events=self.page(root,state,state,read_error='read-only witness unavailable')
            with self.assertRaisesRegex(AssertionError,'screenshot preserves original'):m.snap(page,'source.png')
            os.close(m.journal.fd)
            witness=json.loads((root/'source-capture-witness.json').read_bytes())
            self.assertEqual(witness['before'],state);self.assertIsNone(witness['after'])
            self.assertIn('read-only witness unavailable',witness['afterReadError']);self.assertEqual(events[-1],'dispose')
            self.assertFalse(m.checks[-1]['passed'])

    def test_production_style_guard_and_every_native_own_leaf_aba_negative_case_remain(self):
        production=(ROOT/'src/ui/npc-rehearsal-panel.ts').read_text()
        for required in ('record.attributeName === "style"','...fields.map(field => field.input)',
                         'anchors.some(node => target === node || target.contains(node))) abandon()',
                         'for (const node of mounted) watch(node)',
                         'attributeFilter: ["hidden", "style", "aria-hidden"]'):
            self.assertIn(required,production)
        native=SCRIPT.read_text().split('def leaf_retirement_boundaries():',1)[1].split('def curvature_and_eviction():',1)[0]
        for required in ("for attribute in ('hidden','style','aria-hidden')",'e.setAttribute(a',
                         'e.removeAttribute(a)',"'#npc-rehearsal-ship-light_fighter'",
                         'same-turn own leaf hide/restore permanently retires old review capability',
                         "whole_state('leaf-'"):
            self.assertIn(required,native)


class ScreenshotCaretDiagnosticTests(unittest.TestCase):
    def run_diagnostic(self,root,*,broken_trace=None,events=None):
        m=RecorderLinearityTests().runner(root);events=[] if events is None else events;owner=self
        expected={'economy':'unchanged','fleets':[],'messages':['retained scout11']}
        class Probe:
            def __init__(self,page):self.page=page
            def evaluate(self,expression):
                owner.assertIn('takeRecords()',expression);owner.assertIn('disconnect()',expression)
                ids=['npc-rehearsal-ship-'+ship for ship in m.SHIPS]
                records=[]
                if self.page.caret=='hide':
                    for ident in ids:
                        records.extend([{'id':ident,'attribute':'style','oldStyle':None,'currentStyle':'caret-color: transparent !important;',
                                         'caret':'transparent','priority':'important'},
                                        {'id':ident,'attribute':'style','oldStyle':'caret-color: transparent !important;',
                                         'currentStyle':'','caret':'','priority':''}])
                if broken_trace=='no-hide-events':records=[]
                if broken_trace=='initial-mutates' and self.page.caret=='initial':records=[{'id':ids[0],'caret':'transparent'}]
                return {'inputs':ids,'records':records,'overflow':broken_trace=='overflow'}
            def dispose(self):events.append(('probe-disposed',self.page.caret))
        class References:
            def __init__(self,page):self.page=page
            def evaluate(self,expression):
                owner.assertEqual(expression,m.REHEARSAL_CAPTURE_STATE)
                value=ScreenshotNoninterferenceTests().state()
                value['nodes']=[{'id':'npc-rehearsal-run','disabled':False},{'id':'npc-rehearsal-fill','disabled':False}]
                if self.page.caret=='hide':value.update(panelHidden=True,sameNodes=False,allOriginalNodesConnected=False,resultCount=0,panelHtml='retired')
                return value
            def dispose(self):events.append(('references-disposed',self.page.caret))
        class Page:
            caret=None;closed=False
            def evaluate_handle(self,expression):
                return Probe(self) if expression==m.SCREENSHOT_STYLE_PROBE else References(self)
            def evaluate(self,expression):return {'selected':['messages'],'visible':['messages']}
            def screenshot(self,*,path,full_page,timeout,caret):
                owner.assertEqual((full_page,timeout),(False,2000));owner.assertIn(caret,('hide','initial'));self.caret=caret
                record=json.loads((root/('instrumentation-caret-'+caret+'.json')).read_bytes())
                owner.assertFalse(record['before']['panelHidden']);owner.assertIsNone(record['after'])
                events.append(('screenshot',caret));Path(path).write_bytes(b'offline-ab-only')
            def locator(self,selector):
                return SimpleNamespace(count=lambda:0 if self.caret=='hide' else 3,
                                       is_disabled=lambda:self.caret=='hide',is_enabled=lambda:self.caret=='initial')
        def boot(raw):
            owner.assertEqual(raw,'same saved scout11 raw');page=Page();m.active_page=page;events.append(('boot',raw))
            def close():page.closed=True;events.append(('closed',page.caret))
            return SimpleNamespace(close=close),page
        def open_report(page):
            if broken_trace=='pre-witness':raise RuntimeError('open report failed before witness')
        def capture_live_failure(page):
            owner.assertFalse(page.closed);events.append(('live-failure',page.caret));return {'pageAvailable':True}
        m.fixtures={'milestones':[{'name':'scout11-returned','raw':'same saved scout11 raw','expected':expected}]}
        with patch.object(m,'boot',boot),patch.object(m,'open_report',open_report),patch.object(m,'run_six',lambda page:None), \
             patch.object(m,'storage',return_value={'current':'exact raw','backup':'exact historical raw','infinity.ui.tab':'save'}), \
             patch.object(m,'draft_values',return_value=AuthorityAtomicityTests().draft()),patch.object(m,'save',return_value=expected), \
             patch.object(m,'capture_live_failure',capture_live_failure):
            try:
                with m.live_failure_evidence():m.screenshot_caret_diagnostic()
            finally:os.close(m.journal.fd)
        return m,events

    def test_both_fresh_contexts_capture_trace_and_preserve_full_storage_draft_and_economic_oracles(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m,events=self.run_diagnostic(root)
            self.assertEqual([e for e in events if e[0]=='screenshot'],[('screenshot','hide'),('screenshot','initial')])
            self.assertEqual(sum(e[0]=='boot' for e in events),2);self.assertEqual(sum(e[0]=='closed' for e in events),2)
            for caret in ('hide','initial'):
                record=json.loads((root/('instrumentation-caret-'+caret+'.json')).read_bytes())
                self.assertEqual(record['caret'],caret);self.assertEqual(record['screenshotStatus'],'captured')
                self.assertEqual(len(record['trace']['records']),26 if caret=='hide' else 0)
                self.assertTrue(any('screenshot '+caret+' changes no complete native storage bytes'==check['name'].removeprefix('isolated ') for check in m.checks))
                self.assertTrue(any('isolated screenshot '+caret+': complete ordinary draft unchanged' in check['name'] for check in m.checks))
                self.assertTrue(any('isolated screenshot '+caret+' leaves every economic field unchanged' in check['name'] for check in m.checks))
            self.assertEqual(m.failed_count,0)
            for reference in m.evidence:
                self.assertEqual(reference['sha256'],hashlib.sha256((root/reference['file']).read_bytes()).hexdigest())

    def test_missing_hide_records_initial_mutation_and_trace_overflow_cannot_pass(self):
        for broken in ('no-hide-events','initial-mutates','overflow'):
            with self.subTest(broken=broken),tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(AssertionError):self.run_diagnostic(Path(directory),broken_trace=broken)
                self.assertTrue((Path(directory)/'instrumentation-caret-hide.json').exists())

    def test_pre_witness_and_post_capture_failures_retain_live_page_for_outer_failure_evidence(self):
        for broken,message,caret,closed in (('pre-witness','open report failed before witness',None,[]),
                                           ('initial-mutates','explicit caret initial','initial',[('closed','hide')])):
            with self.subTest(broken=broken),tempfile.TemporaryDirectory() as directory:
                events=[]
                with self.assertRaisesRegex((AssertionError,RuntimeError),message):
                    self.run_diagnostic(Path(directory),broken_trace=broken,events=events)
                self.assertEqual([event for event in events if event[0]=='closed'],closed)
                self.assertEqual(events[-1],('live-failure',caret))
                report=json.loads((Path(directory)/'report.json').read_bytes())
                self.assertFalse(report['completed']);self.assertIn(message,report['failure'])

    def test_probe_is_bounded_read_only_and_diagnostic_precedes_unchanged_natural_tape(self):
        probe=module.SCREENSHOT_STYLE_PROBE
        for forbidden in ('setAttribute(', 'removeAttribute(', 'setProperty(', 'replaceChildren(', 'window.'):
            self.assertNotIn(forbidden,probe)
        for required in ('records.length>=64',"attributeFilter:['style']",'attributeOldValue:true',
                         "node.style.getPropertyValue('caret-color')",'oldStyle:record.oldValue'):
            self.assertIn(required,probe)
        source=SCRIPT.read_text();main=source.split('def main():',1)[1].split('def supervise():',1)[0]
        self.assertLess(main.index('screenshot_caret_diagnostic()'),main.index("begin_case('natural-unedited-paid31-migration')"))
        natural=source.split('def natural_rehearsal(page):',1)[1].split('def configure_scout',1)[0]
        self.assertNotIn('screenshot_caret_diagnostic',natural)


class LiveFailureDiagnosticsTests(unittest.TestCase):
    def test_failure_capture_occurs_before_outer_browser_teardown_and_original_error_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root);events=[]
            class BrowserLifetime:
                live=False
                def __enter__(self):self.live=True;events.append('enter');return self
                def __exit__(self,*_):self.live=False;events.append('teardown')
            life=BrowserLifetime()
            class Page:
                def content(self):
                    self.assert_live();events.append('html');return '<html>actual failure</html>'
                def assert_live(self):
                    if not life.live:raise AssertionError('Captured after teardown')
                def screenshot(self,path,timeout,caret):
                    self.assert_live();events.append('screenshot');Path(path).write_bytes(b'offline-png-stub')
                    if timeout!=2000:raise AssertionError('Screenshot was not bounded')
                    if caret!='initial':raise AssertionError('Failure capture mutates caret styles')
            page=Page();m.active_page=page
            def storage(_):page.assert_live();events.append('storage');return {'all':'exact raw\n','infinity.ui.tab':'save'}
            with patch.object(m,'storage',storage):
                with self.assertRaisesRegex(AssertionError,'original failure'):
                    with life, m.live_failure_evidence():
                        raise AssertionError('original failure')
            os.close(m.journal.fd)
            self.assertEqual(events,['enter','storage','html','screenshot','teardown'])
            self.assertFalse(m.completed);self.assertIn('original failure',m.failure)
            report=json.loads(m.report_path.read_bytes())
            self.assertIn('original failure',report['failure'])
            self.assertEqual(json.loads((root/'failure-storage.json').read_bytes()),{'all':'exact raw\n','infinity.ui.tab':'save'})
            capture=json.loads((root/'failure-capture.json').read_bytes())
            self.assertTrue(all(row['status']=='captured' for row in capture['captures']))
            tree=ast.parse(SCRIPT.read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main')
            contexts=[node for node in ast.walk(main) if isinstance(node,ast.With)]
            self.assertTrue(any([ast.unparse(item.context_expr) for item in node.items]==['sync_playwright()', 'live_failure_evidence()'] for node in contexts))

    def test_html_failure_does_not_discard_storage_or_prevent_screenshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root)
            class Page:
                def content(self):raise RuntimeError('HTML unavailable')
                def screenshot(self,path,timeout,caret):Path(path).write_bytes(b'offline-png-stub')
            with patch.object(m,'storage',return_value={'exact':'raw'}):result=m.capture_live_failure(Page())
            os.close(m.journal.fd)
            self.assertEqual([r['status'] for r in result['captures']],['captured','failed','captured'])
            self.assertEqual(json.loads((root/'failure-storage.json').read_bytes()),{'exact':'raw'})
            self.assertIn('HTML unavailable',result['captures'][1]['error'])
            self.assertTrue((root/'failure.png').exists())

    def test_live_capture_bound_records_failure_and_skips_remaining_attempts(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root)
            timer_handler=None
            def set_handler(_signal,handler):
                nonlocal timer_handler
                timer_handler=handler
            def storage(_):timer_handler(None,None)
            with patch.object(m,'storage',storage), patch.object(m.signal,'signal',set_handler), \
                 patch.object(m.signal,'setitimer') as timer, patch.object(m.signal,'getitimer',return_value=(0,0)):
                result=m.capture_live_failure(object())
            os.close(m.journal.fd)
            self.assertEqual(timer.call_args_list[0].args,(m.signal.ITIMER_REAL,6))
            self.assertTrue(result['boundExpired'])
            self.assertEqual([r['status'] for r in result['captures']],['failed','not-attempted','not-attempted'])
            self.assertIn('Six-second',result['captures'][0]['error'])

    def test_existing_worker_timer_is_restored_and_expired_deadline_is_never_dropped(self):
        for previous,elapsed,restored in ((20,.5,19.5),(.25,.5,.001)):
            with self.subTest(previous=previous), tempfile.TemporaryDirectory() as directory:
                root=Path(directory);m=RecorderLinearityTests().runner(root)
                class Page:
                    def content(self):return '<html>failure</html>'
                    def screenshot(self,path,timeout,caret):Path(path).write_bytes(b'png-stub')
                with patch.object(m,'storage',return_value={'raw':'exact'}), \
                     patch.object(m.signal,'signal'), patch.object(m.signal,'setitimer') as timer, \
                     patch.object(m.signal,'getitimer',return_value=(previous,0)), \
                     patch.object(m.time,'monotonic',side_effect=[100,100+elapsed]):
                    result=m.capture_live_failure(Page())
                os.close(m.journal.fd)
                self.assertEqual(timer.call_args_list[0].args,(m.signal.ITIMER_REAL,min(6,previous)))
                self.assertEqual(timer.call_args_list[-1].args,(m.signal.ITIMER_REAL,restored,0))
                self.assertEqual(result['workerDeadlineElapsedDuringCapture'],elapsed>=previous)

    def test_capture_error_does_not_replace_original_assertion_or_mark_passed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);m=RecorderLinearityTests().runner(root)
            with patch.object(m,'capture_live_failure',side_effect=RuntimeError('capture failed')):
                with self.assertRaisesRegex(AssertionError,'primary failure'):
                    with m.live_failure_evidence():raise AssertionError('primary failure')
            os.close(m.journal.fd)
            report=json.loads(m.report_path.read_bytes())
            self.assertFalse(report['completed']);self.assertIn('primary failure',report['failure'])
            self.assertEqual(report['evidence'][-1]['kind'],'live-failure-capture-error')
            self.assertIn('capture failed',report['evidence'][-1]['error'])

    def test_absent_page_is_explicit_diagnostic_not_silently_swallowed(self):
        with tempfile.TemporaryDirectory() as directory:
            m=RecorderLinearityTests().runner(Path(directory));result=m.capture_live_failure(None);os.close(m.journal.fd)
            self.assertFalse(result['pageAvailable']);self.assertEqual(result['captures'],[])
            self.assertTrue((Path(directory)/'failure-capture.json').exists())


if __name__=='__main__':unittest.main()
