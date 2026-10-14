"""Copied-data contract tests only; formal native DOM remains a separate gate."""
import copy
import ast
import hashlib
import unittest
from pathlib import Path
from npc_display_contract import *

# Independent native r14 golden, copied from the retained failed CI capture.
# Do not construct this witness from the implementation's expected constant.
CAPTURED_DRAFT_NOTICE_HTML = '<p id="npc-rehearsal-draft-notice" class="npc-rehearsal-draft-notice muted" role="status" hidden=""></p>'
# Independent reviewed closed-state addition, not a native-execution claim.
# Keep this literal separate from the contract's construction and production.
FORMATION_ADDITION_HTML = '''<div class="space-controls"><label for="npc-rehearsal-formation">保存编成<select id="npc-rehearsal-formation" aria-label="保存编成" disabled=""><option value="">选择命名编成</option></select></label><button id="npc-rehearsal-copy" type="button" disabled="">填入演练数量</button></div>
    <p id="npc-rehearsal-formation-source" class="muted"></p>
    <details id="npc-rehearsal-deficits"><summary id="npc-rehearsal-deficit-summary">数量与当前停泊库存</summary><div id="npc-rehearsal-deficit-body" class="npc-report-details"></div></details>'''
FORMATION_ADDITION_IDS = ('npc-rehearsal-formation', 'npc-rehearsal-copy', 'npc-rehearsal-formation-source',
                          'npc-rehearsal-deficits', 'npc-rehearsal-deficit-summary', 'npc-rehearsal-deficit-body')

# Independent complete native section from the failed 337c verify artifact:
# panel-parity-npc-after-messages-32-raw.json, SHA256
# cb12b4320728038188ac74cba9f66dd13cd0da3d0b98d1cb2ddd9de85a2d352b.
# This is the state after real tab navigation, not freshly constructed markup.
CAPTURED_CLOSED_COMPARISON_HTML = '''<section id="npc-scout-comparison-panel" class="ov-card npc-scout-comparison" aria-labelledby="npc-scout-comparison-title" hidden="">
    <h3 id="npc-scout-comparison-title" tabindex="-1">历史侦察对照</h3>
    <p id="npc-scout-comparison-source" class="chip"></p>
    <label for="npc-scout-comparison-other">同坐标的另一份报告<select id="npc-scout-comparison-other" disabled=""></select></label>
    <div class="space-controls"><button id="npc-scout-comparison-run" type="button" disabled="">查看差值</button><button id="npc-scout-comparison-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-scout-comparison-status" class="muted" role="status" aria-live="polite">对照已关闭；请从当前保留的侦察消息重新打开。</p>
    <p id="npc-scout-comparison-warning" class="muted">只是两次观察差，不代表净产量、战利品或当前库存。</p>
    <div id="npc-scout-comparison-results" hidden=""></div>
  </section>'''

def energy_tab_retirement_before(current):
    """Expose only the original tab clause after complete reviewed source binding."""
    from test_energy_challenge_provenance import approved_rows, historical_bytes, read_manifest
    root=Path(__file__).resolve().parents[1]
    read_manifest(root)
    path='src/ui/space-panel.ts'
    row=next(item for item in approved_rows() if item['path']==path)
    before=historical_bytes(path)
    assert hashlib.sha256(before).hexdigest()==row['before']['sha256'], 'Exact A space controller source'
    assert hashlib.sha256(current.encode()).hexdigest()==row['after']['sha256'], 'Exact reviewed r16 space controller source'
    old='if(b.dataset.tab){npcAttack.retirePending();npcRehearsal.close();recyclePanel.invalidate();selected=null;return;}'
    new='if(b.dataset.tab){energyChallengePanel.retire();npcAttack.retirePending();npcRehearsal.close();recyclePanel.invalidate();selected=null;return;}'
    assert before.decode().count(old)==1 and current.count(new)==1, 'Exact single tab retirement extension'
    return current.replace(new,old,1)


class NpcDisplayTests(unittest.TestCase):
    def state(self):return {'activePlanetId':'homeworld','planets':[{'id':'homeworld','name':'Home','npcResourceRemainder':{'metal':'0','crystal':'0','deuterium':'0'},'coordinates':{'galaxy':1,'system':50,'position':8}}],'universe':{'seed':42},'npcEconomy':{'sites':{}},'npcBattles':{'model':'npc-battle-receipts-v1','reports':[]},'messages':[{'id':'send-1','at':3,'text':'原有消息。','npcScoutSnapshot':None},{'id':'scout-2','at':60,'text':'原有侦察情报。','npcScoutSnapshot':None}]}
    def unit_panel(self,tab,side):
        # Historical r14 / pre-manual-quote copied evidence only, including the
        # old build-units / maximum-39 example. Current manual UI is tested by
        # test_manual_unit_display_contract.py. Live SAMPLE_JS and complete native
        # DOM/state preservation are verified by browser-render-scheduling.py.
        paragraph=UNIT_PANEL_COPY[tab][side];node=f'<p class="blurb">{paragraph}</p>'
        snapshot={'tab':tab,'text':'标题\n\n'+paragraph+'\n\n造船队列\n每艘 3.20 秒\n可造 39',
            'shared':{'status':'已保存到本地','amount-metal':'7.80e4'},
            'inputs':[{'id':'','action':'build-units','type':'button','value':'','disabled':False,'checked':None,'text':'最大 39'}]}
        evidence={'tab':tab,'intro':paragraph,'panelHTML':'<section><div class="panel-head">标题</div>'+node+
            '<div class="queue-panel">造船队列</div><div class="bld-grid">每艘 3.20 秒</div><p class="status">已保存到本地</p></section>',
            'introBoundary':{'counts':{'children':5,'blurbs':1,'heads':1,'queues':1,'grids':1,'statuses':1},
                'exactOrder':True,'introHTML':node}}
        return snapshot,evidence
    def test_complete_unit_panel_copy_has_exact_before_after_parity_without_mutation(self):
        for tab in UNIT_PANEL_COPY:
            results=[]
            for side in ('before','after'):
                snapshot,evidence=self.unit_panel(tab,side);state=self.state();original=copy.deepcopy((snapshot,evidence,state))
                results.append(normalize_npc_display(snapshot,evidence,state,side))
                self.assertEqual((snapshot,evidence,state),original)
                self.assertIsNot(results[-1],snapshot)
            self.assertEqual(results[0],results[1])
    def test_unit_panel_requires_its_complete_side_specific_literal(self):
        for tab in UNIT_PANEL_COPY:
            for side in ('before','after'):
                for mutation in ('literal','truncated','other-side','missing','duplicate'):
                    snapshot,evidence=self.unit_panel(tab,side)
                    if mutation=='literal':evidence['intro']+='changed'
                    if mutation=='truncated':evidence['intro']=evidence['intro'][:-1]
                    if mutation=='other-side':evidence['intro']=UNIT_PANEL_COPY[tab]['after' if side=='before' else 'before']
                    if mutation=='missing':snapshot['text']=snapshot['text'].replace(evidence['intro'],'')
                    if mutation=='duplicate':snapshot['text']+='\n'+evidence['intro']
                    with self.subTest(tab=tab,side=side,mutation=mutation),self.assertRaises(AssertionError):
                        normalize_npc_display(snapshot,evidence,self.state(),side)
    def test_unit_panel_rejects_missing_duplicate_or_reordered_native_siblings(self):
        for tab in UNIT_PANEL_COPY:
            for side in ('before','after'):
                for key in ('children','blurbs','heads','queues','grids','statuses'):
                    for count in (0,2,6):
                        snapshot,evidence=self.unit_panel(tab,side);evidence['introBoundary']['counts'][key]=count
                        with self.subTest(tab=tab,side=side,key=key,count=count),self.assertRaises(AssertionError):
                            normalize_npc_display(snapshot,evidence,self.state(),side)
                snapshot,evidence=self.unit_panel(tab,side);evidence['introBoundary']['exactOrder']=False
                with self.subTest(tab=tab,side=side),self.assertRaises(AssertionError):
                    normalize_npc_display(snapshot,evidence,self.state(),side)
    def test_unit_panel_rejects_changed_class_nested_markup_and_duplicate_dom_node(self):
        for tab in UNIT_PANEL_COPY:
            for side in ('before','after'):
                for mutation in ('class','tag','nested','attribute','duplicate','missing'):
                    snapshot,evidence=self.unit_panel(tab,side);node=evidence['introBoundary']['introHTML']
                    if mutation=='class':evidence['introBoundary']['introHTML']=node.replace('blurb','bld-blurb')
                    if mutation=='tag':evidence['introBoundary']['introHTML']=node.replace('<p ','<div ').replace('</p>','</div>')
                    if mutation=='nested':evidence['introBoundary']['introHTML']=node.replace('">','"><span>',1).replace('</p>','</span></p>')
                    if mutation=='attribute':evidence['introBoundary']['introHTML']=node.replace('<p ','<p id="other" ')
                    if mutation=='duplicate':evidence['panelHTML']+=node
                    if mutation=='missing':evidence['panelHTML']=evidence['panelHTML'].replace(node,'')
                    with self.subTest(tab=tab,side=side,mutation=mutation),self.assertRaises(AssertionError):
                        normalize_npc_display(snapshot,evidence,self.state(),side)
    def test_unit_panel_preserves_every_unrelated_text_control_shared_value_and_dom_change(self):
        for tab in UNIT_PANEL_COPY:
            before,old_evidence=self.unit_panel(tab,'before');expected=normalize_npc_display(before,old_evidence,self.state(),'before')
            for mutation in ('cost','timer','status','control','shared','hidden-attribute'):
                snapshot,evidence=self.unit_panel(tab,'after')
                if mutation=='cost':snapshot['text']=snapshot['text'].replace('可造 39','可造 40')
                if mutation=='timer':snapshot['text']=snapshot['text'].replace('3.20','3.21')
                if mutation=='status':snapshot['text']+='\n其他状态'
                if mutation=='control':snapshot['inputs'][0]['disabled']=True
                if mutation=='shared':snapshot['shared']['amount-metal']='0'
                if mutation=='hidden-attribute':evidence['panelHTML']=evidence['panelHTML'].replace('class="bld-grid"','class="bld-grid" hidden=""')
                original=copy.deepcopy((snapshot,evidence));actual=normalize_npc_display(snapshot,evidence,self.state(),'after')
                with self.subTest(tab=tab,mutation=mutation):
                    self.assertNotEqual(actual,expected)
                    self.assertEqual((snapshot,evidence),original)
                    self.assertEqual(actual['inputs'],snapshot['inputs']);self.assertEqual(actual['shared'],snapshot['shared'])
    def test_unit_panel_will_not_project_positive_rights_or_existing_battle_reports(self):
        for tab in UNIT_PANEL_COPY:
            for mutation in ('rights','report','site'):
                snapshot,evidence=self.unit_panel(tab,'after');state=self.state()
                if mutation=='rights':state['planets'][0]['npcResourceRemainder']['metal']='0.1'
                if mutation=='report':state['npcBattles']['reports'].append({'id':1})
                if mutation=='site':state['npcEconomy']['sites']['1:50:1']={}
                with self.subTest(tab=tab,mutation=mutation),self.assertRaises(AssertionError):
                    normalize_npc_display(snapshot,evidence,state,'after')
    def hint_boundary(self,hint):
        # Copied native evidence shape, not an offline execution of SAMPLE_JS.
        return {'counts':{'tables':1,'worlds':1,'hints':1,'navigation':1,'summaries':1},
            'positions':{'children':7,'table':4,'hint':5,'navigation':6},'exactOrder':True,
            'hintHTML':f'<p class="muted">{hint}</p>',
            'navigation':{'tag':'DETAILS','id':'expansion-navigation','className':'expansion-navigation','closed':True,
                'children':2,'summaryHTML':'<summary id="expansion-navigation-summary">开拓查看（只读）</summary>','exactBody':True}}
    def test_positive_rights_cannot_be_hidden_by_historical_ui_projection(self):
        snapshot,evidence=self.fleet();state=self.state();state['planets'][0]['npcResourceRemainder']['metal']='0.1'
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,state,'after')
    def galaxy(self):
        state=self.state();rows=[];inputs=[];old_inputs=[];old_text=[]
        for p in range(1,17):
            key=f'1:50:{p}';npc=p<16 and p!=8 and coordinate_random(42,1,50,p)<.25
            base=f'[{key}] '+('NPC 邻居' if npc else '空位')+'\n侦察';row={'key':key,'kind':'NPC 邻居' if npc else '空位','text':base,'attacks':[]};old_text.append(base)
            scout={'id':'','action':'route','type':'button','value':'','disabled':False,'checked':None,'text':'侦察'};inputs.append(scout);old_inputs.append(scout)
            if npc:
                row['text']+='\n攻击';row['attacks']=[{'html':f'<button type="button" data-space="route" data-coordinate="{key}" data-mission="attack">攻击</button>','text':'攻击','key':key,'action':'route','type':'button','disabled':False,'visible':True,'last':True,'previous':'scout','index':len(inputs)}]
                inputs.append({**scout,'text':'攻击'})
            rows.append(row)
        snapshot={'tab':'galaxy','text':'\n'.join([r['text'] for r in rows]+[NEW_HINT,'开拓查看（只读）']),'inputs':inputs};evidence={'tab':'galaxy','hintBoundary':self.hint_boundary(NEW_HINT),'hint':NEW_HINT,'rows':rows}
        return snapshot,evidence,{'tab':'galaxy','text':'\n'.join(old_text+[OLD_HINT,'开拓查看（只读）']),'inputs':old_inputs}
    def test_only_exact_npc_route_additions_are_removed(self):
        snapshot,evidence,expected=self.galaxy()
        self.assertEqual(normalize_npc_display(snapshot,evidence,self.state(),'after'),expected)
    def test_old_hint_before_closed_navigator_is_unchanged(self):
        _,evidence,snapshot=self.galaxy();evidence['hint']=OLD_HINT;evidence['hintBoundary']=self.hint_boundary(OLD_HINT)
        for row in evidence['rows']:
            if row['attacks']:row['text']=row['text'][:-len('\n攻击')];row['attacks']=[]
        state=self.state();original=copy.deepcopy((snapshot,evidence,state))
        result=normalize_npc_display(snapshot,evidence,state,'before')
        self.assertEqual(result,snapshot);self.assertIsNot(result,snapshot)
        self.assertEqual((snapshot,evidence,state),original)
    def test_wrong_hint_node_or_literal_is_rejected(self):
        for html in (f'<div class="muted">{NEW_HINT}</div>',f'<p class="muted" id="space-range">{NEW_HINT}</p>',
                     f'<p class="muted"><span>{NEW_HINT}</span></p>',f'<p class="muted">{NEW_HINT}changed</p>'):
            snapshot,evidence,_=self.galaxy();evidence['hintBoundary']['hintHTML']=html
            with self.subTest(html=html),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        snapshot,evidence,_=self.galaxy();evidence['hint']='开拓查看（只读）'
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_missing_duplicate_nested_or_reordered_boundary_is_rejected(self):
        for key in ('tables','worlds','hints','navigation','summaries'):
            for count in (0,2):
                snapshot,evidence,_=self.galaxy();evidence['hintBoundary']['counts'][key]=count
                with self.subTest(key=key,count=count),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        for key,value in (('children',8),('table',3),('hint',6),('navigation',5)):
            snapshot,evidence,_=self.galaxy();evidence['hintBoundary']['positions'][key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        snapshot,evidence,_=self.galaxy();evidence['hintBoundary']['exactOrder']=False
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_open_unknown_or_changed_navigation_is_rejected(self):
        for key,value in (('tag','DIV'),('id','unknown-navigation'),('className','unknown-navigation'),('closed',False),
                          ('children',3),('summaryHTML','<summary id="expansion-navigation-summary">changed</summary>'),
                          ('summaryHTML','<summary>开拓查看（只读）</summary>'),('exactBody',False)):
            snapshot,evidence,_=self.galaxy();evidence['hintBoundary']['navigation'][key]=value
            with self.subTest(key=key,value=value),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_galaxy_copies_and_all_unrelated_ui_remain_exact(self):
        snapshot,evidence,expected=self.galaxy();state=self.state()
        snapshot['text']+='\nunrelated change';snapshot['shared']={'status':'unchanged'}
        evidence['panelHTML']='<section>untouched copied DOM evidence</section>'
        original=copy.deepcopy((snapshot,evidence,state));result=normalize_npc_display(snapshot,evidence,state,'after')
        self.assertEqual((snapshot,evidence,state),original)
        self.assertEqual(result['text'],expected['text']+'\nunrelated change')
        self.assertEqual(result['inputs'],expected['inputs']);self.assertEqual(result['shared'],snapshot['shared'])
        self.assertNotEqual(result['text'],expected['text']) # The whole-UI comparator still sees unrelated differences.
    def test_coordinate_identity_button_authority_and_other_text_fail_closed(self):
        for mutation in ('coordinate','kind','html','index','text','hint','extra'):
            snapshot,evidence,_=self.galaxy();row=next(r for r in evidence['rows'] if r['attacks']);b=row['attacks'][0]
            if mutation=='coordinate':b['key']='1:1:1'
            if mutation=='kind':row['kind']='空位'
            if mutation=='html':b['html']=b['html'].replace('route','send')
            if mutation=='index':b['index']-=1
            if mutation=='text':row['text']+='unexpected'
            if mutation=='hint':evidence['hint']+='anything'
            if mutation=='extra':row['attacks'].append(copy.deepcopy(b))
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def fleet(self):
        options=copy.deepcopy(MISSION_OPTIONS);options.insert(4,['attack','NPC 轨道攻击']);text='\n'.join(label for _,label in options)
        return {'tab':'fleet','text':'任务\n'+text+'\n原有在途舰队','inputs':[]},{'tab':'fleet','options':options,'selected':'colonize','selectText':text,'hiddenAttack':{'hidden':True,'html':ATTACK_OPTIONS_HTML,'quota':'','status':''},'rehearsalNotice':{'count':1,'html':CAPTURED_DRAFT_NOTICE_HTML,'hidden':True,'visible':False,'exactOrder':True},'clear':{'hidden':True,'text':'清空货物草稿','visible':False,'index':-1}}
    def test_exact_one_mission_option_with_no_other_text_change(self):
        snapshot,evidence=self.fleet();before=copy.deepcopy((snapshot,evidence));result=normalize_npc_display(snapshot,evidence,self.state(),'after')
        self.assertEqual(result['text'],'任务\n'+'\n'.join(label for _,label in MISSION_OPTIONS)+'\n原有在途舰队')
        self.assertEqual((snapshot,evidence),before)
    def test_extra_option_hidden_change_or_wrong_authority_rejected(self):
        for mutation in ('extra','reorder','selected','visible','html','quota'):
            snapshot,evidence=self.fleet()
            if mutation=='extra':evidence['options'].append(['extra','anything'])
            if mutation=='reorder':evidence['options'].reverse()
            if mutation=='selected':evidence['selected']='attack'
            if mutation=='visible':evidence['clear']['visible']=True
            if mutation=='html':evidence['hiddenAttack']['html']+='anything'
            if mutation=='quota':evidence['hiddenAttack']['quota']='unexpected'
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def copied_rows(self,messages,current=True):
        rows=[]
        for m in reversed(messages):
            time=game_message_time(m['at']);parts=[{'html':f'<small>{time}</small>','text':time},{'html':f'<p>{dom_text(m["text"])}</p>','text':m['text']}]
            typed=m.get('npcScoutSnapshot');scout=current and (typed is not None or m['id'].startswith('scout-'))
            if scout:
                notice=UNAVAILABLE if typed is None else f"历史情报，之后可能变化 · 抵达时间 {typed['observedAt']} 秒 · {typed['model']}"
                parts.append({'html':f'<p class="muted">{notice}</p>','text':notice})
            controls=[]
            if typed is not None:
                parts.extend([{'html':'<button type="button">打开历史侦察演练</button>','text':'打开历史侦察演练'},
                              {'html':'<button type="button" data-npc-scout-comparison="">历史对照</button>','text':'历史对照'}])
                controls=[{'tag':'BUTTON','type':'button','disabled':False,'text':text} for text in ('打开历史侦察演练','历史对照')]
            opening=f'<article class="space-message" data-message-id="{m["id"]}">' if scout else '<article class="space-message">'
            rows.append({'html':opening+''.join(p['html'] for p in parts)+'</article>','text':'\n\n'.join(p['text'] for p in parts),
                'key':m['id'] if scout else None,'direct':True,'children':parts,'controls':controls})
        return {'count':1,'rows':rows,'html':''.join(r['html'] for r in rows) if rows else '<p class="muted">尚无航行记录。</p>',
                'text':'\n\n'.join(r['text'] for r in rows) if rows else '尚无航行记录。'}
    def messages(self):
        head='航行消息\nHome [1:50:8]';rows=self.copied_rows(self.state()['messages']);message=rows['text'];text='\n\n'.join([head,INTRO,message,'NPC 轨道战报',HISTORY,'战斗规则'])
        a={'counts':{'panels':1,'lists':1,'titles':1,'reports':1,'rules':1},'headHTML':'<div class="panel-head"><h2 id="space-messages-title">航行消息</h2><p class="space-location">Home [1:50:8]</p></div>','heading':'航行消息','origin':'Home [1:50:8]','intro':INTRO,'title':'NPC 轨道战报','history':HISTORY,'rulesText':RULES,'summary':'战斗规则','closed':True,'reportHTML':'','exactOrder':True,'headText':head,
           'rehearsal':{'count':1,'html':initial_rehearsal_html(),'hidden':True,'visible':False,'exactIds':True,'controls':initial_rehearsal_controls()},
           'comparisonNotice':{'count':1,'html':COMPARISON_NOTICE_HTML,'hidden':True,'visible':False,'exactOrder':True},
           'comparison':{'count':1,'html':CAPTURED_CLOSED_COMPARISON_HTML,'hidden':True,'visible':False,'exactIds':True,'controls':initial_comparison_controls()}}
        return {'tab':'messages','text':text,'inputs':[]},{'tab':'messages','current':True,'panelHTML':initial_message_panel_html('Home [1:50:8]',rows['html']),'messageHTML':message and rows['html'],'messageText':message,'messages':rows,'addition':a}
    def test_all_original_message_html_and_text_retained(self):
        snapshot,evidence=self.messages();state=self.state();original=copy.deepcopy((snapshot,evidence,state))
        result=normalize_npc_display(snapshot,evidence,state,'after')
        old_messages=[{key:value for key,value in m.items() if key!='npcScoutSnapshot'} for m in state['messages']]
        old=self.copied_rows(old_messages,False)
        self.assertEqual(result['text'],old['text']);self.assertEqual(result['historicalMessageHTML'],old['html'])
        self.assertNotIn(UNAVAILABLE,result['text']);self.assertEqual((snapshot,evidence,state),original)
        prior=copy.deepcopy(state);prior['messages']=old_messages
        old_snapshot={'tab':'messages','text':old['text'],'inputs':[]}
        old_evidence={'tab':'messages','current':False,'messageHTML':old['html'],'messageText':old['text'],'messages':old}
        self.assertEqual(normalize_npc_display(old_snapshot,old_evidence,prior,'before'),result)
    def test_message_identity_order_count_data_and_complete_html_are_bound(self):
        for mutation in ('id','reverse','extra','missing','count','nested','time','body','notice','attribute','injected_html','prefix','suffix','text','controls','child'):
            snapshot,evidence=self.messages();rows=evidence['messages'];row=rows['rows'][0]
            if mutation=='id':row['key']='scout-wrong'
            if mutation=='reverse':rows['rows'].reverse()
            if mutation=='extra':rows['rows'].append(copy.deepcopy(row))
            if mutation=='missing':rows['rows'].pop()
            if mutation=='count':rows['count']=2
            if mutation=='nested':row['direct']=False
            if mutation=='time':row['children'][0]['text']='游戏 61 秒'
            if mutation=='body':row['children'][1]['html']='<p>new message</p>'
            if mutation=='notice':row['children'][2]['text']+='changed'
            if mutation=='attribute':row['html']=row['html'].replace('space-message','space-message changed')
            if mutation=='injected_html':rows['html']+='<!-- hidden data -->'
            if mutation=='prefix':rows['text']='unknown\n'+rows['text']
            if mutation=='suffix':rows['text']+='\nunknown'
            if mutation=='text':row['text']+='\nunknown'
            if mutation=='controls':row['controls']=[{'type':'button'}]
            if mutation=='child':row['children'].append({'html':'<p hidden="">secret</p>','text':'secret'})
            evidence['messageHTML']=rows['html'];evidence['messageText']=rows['text']
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_hidden_rehearsal_region_requires_exact_nodes_data_and_properties(self):
        for mutation in ('count','shown','visible','id','text','hidden_data','control','value','enabled','order','extra','missing'):
            snapshot,evidence=self.messages();region=evidence['addition']['rehearsal']
            if mutation=='count':region['count']=2
            if mutation=='shown':region['hidden']=False
            if mutation=='visible':region['visible']=True
            if mutation=='id':region['exactIds']=False
            if mutation=='text':region['html']=region['html'].replace('历史侦察演练','changed',1)
            if mutation=='hidden_data':region['html']=region['html'].replace('</section>','<p hidden="">unexpected</p></section>')
            if mutation=='control':region['controls'][0]['id']='forged'
            if mutation=='value':region['controls'][0]['value']='1'
            if mutation=='enabled':region['controls'][0]['disabled']=False
            if mutation=='order':region['controls'].reverse()
            if mutation=='extra':region['controls'].append(copy.deepcopy(region['controls'][0]))
            if mutation=='missing':region['controls'].pop()
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_closed_formation_addition_has_one_exact_position_and_all_original_controls(self):
        snapshot,evidence=self.messages();state=self.state();original=copy.deepcopy((snapshot,evidence,state))
        region=evidence['addition']['rehearsal'];html=region['html']
        before='<p class="muted">仅选择当前星球已停泊舰船。演练不派遣、不付款；排队建造与研究不计入。</p>\n    '
        after='\n    <div class="space-ships">'
        self.assertEqual(html.count(FORMATION_ADDITION_HTML),1)
        self.assertIn(before+FORMATION_ADDITION_HTML+after,html)
        for ident in FORMATION_ADDITION_IDS:self.assertEqual(html.count(f'id="{ident}"'),1)
        self.assertEqual(region['controls'][:2],[
            {'id':'npc-rehearsal-formation','type':'select-one','value':'','disabled':True,'visible':False},
            {'id':'npc-rehearsal-copy','type':'button','value':'','disabled':True,'visible':False}])
        self.assertEqual(region['controls'][2:15],[
            {'id':'npc-rehearsal-ship-'+ident,'type':'number','value':'0','disabled':True,'visible':False}
            for ident,_ in FLYING_SHIPS])
        self.assertEqual(region['controls'][15:],[
            {'id':'npc-rehearsal-speed','type':'select-one','value':'100','disabled':True,'visible':False},
            {'id':'npc-rehearsal-run','type':'button','value':'','disabled':True,'visible':False},
            {'id':'npc-rehearsal-cancel','type':'button','value':'','disabled':False,'visible':False},
            {'id':'npc-rehearsal-fill','type':'button','value':'','disabled':True,'visible':False}])
        self.assertEqual(len(region['controls']),19)
        self.assertEqual(html.count(' max="1000000000000"'),13)
        self.assertEqual(html.count('演练数量'),14) # Copy label is not a fourteenth input.
        projected=normalize_npc_display(snapshot,evidence,state,'after')
        old_messages=[{key:value for key,value in row.items() if key!='npcScoutSnapshot'} for row in state['messages']]
        old=self.copied_rows(old_messages,False)
        self.assertEqual(projected['text'],old['text']);self.assertEqual(projected['historicalMessageHTML'],old['html'])
        self.assertEqual((snapshot,evidence,state),original)

    def test_formation_addition_rejects_missing_duplicate_or_relocated_complete_regions(self):
        for mutation in ('missing','duplicate','source_first','details_first','after_ships','outside_panel','nested'):
            snapshot,evidence=self.messages();region=evidence['addition']['rehearsal'];old_html=region['html']
            blocks=FORMATION_ADDITION_HTML.split('\n    ')
            if mutation=='missing':region['html']=old_html.replace(FORMATION_ADDITION_HTML,'')
            if mutation=='duplicate':region['html']=old_html.replace(FORMATION_ADDITION_HTML,FORMATION_ADDITION_HTML*2)
            if mutation=='source_first':region['html']=old_html.replace(FORMATION_ADDITION_HTML,'\n    '.join([blocks[1],blocks[0],blocks[2]]))
            if mutation=='details_first':region['html']=old_html.replace(FORMATION_ADDITION_HTML,'\n    '.join([blocks[2],blocks[0],blocks[1]]))
            if mutation=='after_ships':
                region['html']=old_html.replace(FORMATION_ADDITION_HTML+'\n    ','').replace('<div class="space-controls"><label>草稿速度',FORMATION_ADDITION_HTML+'\n    <div class="space-controls"><label>草稿速度')
            if mutation=='outside_panel':region['html']=old_html.replace(FORMATION_ADDITION_HTML,'')
            if mutation=='nested':region['html']=old_html.replace(FORMATION_ADDITION_HTML,'<div>'+FORMATION_ADDITION_HTML+'</div>')
            evidence['panelHTML']=evidence['panelHTML'].replace(old_html,region['html'],1)
            if mutation=='outside_panel':evidence['panelHTML']=evidence['panelHTML'].replace(region['html'],region['html']+FORMATION_ADDITION_HTML,1)
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,state=self.state(),side='after')

    def test_formation_addition_binds_every_complete_node_and_empty_initial_content(self):
        mutations={
            'missing_label_for':lambda h:h.replace(' for="npc-rehearsal-formation"',''),
            'forged_label_for':lambda h:h.replace(' for="npc-rehearsal-formation"',' for="npc-rehearsal-copy"'),
            'enabled_select':lambda h:h.replace('aria-label="保存编成" disabled=""','aria-label="保存编成"'),
            'enabled_copy':lambda h:h.replace('type="button" disabled=""','type="button"'),
            'select_label':lambda h:h.replace('aria-label="保存编成"','aria-label="任意编成"'),
            'selected_option':lambda h:h.replace('<option value="">','<option value="1" selected="">'),
            'option_text':lambda h:h.replace('选择命名编成','已选编成'),
            'extra_option':lambda h:h.replace('</select>','<option value="1">unexpected</option></select>'),
            'copy_type':lambda h:h.replace('type="button"','type="submit"'),
            'copy_text':lambda h:h.replace('填入演练数量','付费派遣'),
            'copy_value':lambda h:h.replace('type="button"','type="button" value="secret"'),
            'source_text':lambda h:h.replace('class="muted"></p>','class="muted">来自保存编成</p>'),
            'source_hidden_data':lambda h:h.replace('class="muted"></p>','class="muted"><span hidden="">secret</span></p>'),
            'source_status':lambda h:h.replace('class="muted"></p>','class="space-status"></p>'),
            'details_open':lambda h:h.replace('<details id="npc-rehearsal-deficits">','<details id="npc-rehearsal-deficits" open="">'),
            'details_hidden':lambda h:h.replace('<details id="npc-rehearsal-deficits">','<details id="npc-rehearsal-deficits" hidden="">'),
            'summary_text':lambda h:h.replace('数量与当前停泊库存','自动补造缺额'),
            'summary_nested':lambda h:h.replace('数量与当前停泊库存','<span>数量与当前停泊库存</span>'),
            'body_class':lambda h:h.replace('class="npc-report-details"','class="unknown"'),
            'body_data':lambda h:h.replace('class="npc-report-details"></div>','class="npc-report-details"><p>secret</p></div>'),
            'extra_control':lambda h:h.replace('</details>','<input value="secret"></details>'),
            'extra_attribute':lambda h:h.replace('<div class="space-controls">','<div class="space-controls" data-other="secret">'),
        }
        for ident in FORMATION_ADDITION_IDS:
            mutations['id-'+ident]=lambda h,ident=ident:h.replace(f'id="{ident}"',f'id="forged-{ident}"')
            mutations['duplicate-'+ident]=lambda h,ident=ident:h+f'<p id="{ident}"></p>'
        for name,mutate in mutations.items():
            snapshot,evidence=self.messages();region=evidence['addition']['rehearsal'];old_html=region['html']
            changed=mutate(FORMATION_ADDITION_HTML);self.assertNotEqual(changed,FORMATION_ADDITION_HTML)
            region['html']=old_html.replace(FORMATION_ADDITION_HTML,changed,1)
            evidence['panelHTML']=evidence['panelHTML'].replace(old_html,region['html'],1)
            with self.subTest(mutation=name),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_formation_initial_controls_require_native_empty_disabled_properties_and_exact_order(self):
        for index in (0,1):
            for field,value in (('id','forged'),('type','number'),('value','1'),('value',None),
                                ('disabled',False),('disabled',1),('visible',True),('visible',0)):
                snapshot,evidence=self.messages();evidence['addition']['rehearsal']['controls'][index][field]=value
                with self.subTest(index=index,field=field,value=value),self.assertRaises(AssertionError):
                    normalize_npc_display(snapshot,evidence,self.state(),'after')
        for mutation in ('missing','duplicate','reorder','after_inputs','extra_field','missing_field','duplicate_global_id'):
            snapshot,evidence=self.messages();region=evidence['addition']['rehearsal'];controls=region['controls']
            if mutation=='missing':del controls[0]
            if mutation=='duplicate':controls.insert(0,copy.deepcopy(controls[0]))
            if mutation=='reorder':controls[:2]=reversed(controls[:2])
            if mutation=='after_inputs':controls[:15]=controls[2:15]+controls[:2]
            if mutation=='extra_field':controls[0]['unknown']='secret'
            if mutation=='missing_field':del controls[1]['disabled']
            if mutation=='duplicate_global_id':region['exactIds']=False
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_formation_display_projection_never_hides_economy_or_inventory_changes(self):
        for mutation in ('rights','site','report','typed_snapshot'):
            snapshot,evidence=self.messages();state=self.state()
            if mutation=='rights':state['planets'][0]['npcResourceRemainder']['metal']='0.1'
            if mutation=='site':state['npcEconomy']['sites']['1:56:15']={'stock':[1,2,3]}
            if mutation=='report':state['npcBattles']['reports'].append({'id':1})
            if mutation=='typed_snapshot':state['messages'][0]['npcScoutSnapshot']={}
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,state,'after')
        snapshot,evidence=self.messages();snapshot['shared']={'stock-light_fighter':'6','amount-metal':'7.80e4'}
        expected=normalize_npc_display(snapshot,evidence,self.state(),'after')
        snapshot['shared']['stock-light_fighter']='5';original=copy.deepcopy(snapshot)
        actual=normalize_npc_display(snapshot,evidence,self.state(),'after')
        self.assertNotEqual(actual,expected);self.assertEqual(actual['shared'],snapshot['shared']);self.assertEqual(snapshot,original)
    def test_typed_message_is_exactly_checked_but_never_historical_projection(self):
        state=self.state();m=state['messages'][1]
        m['npcScoutSnapshot']={'model':'npc-scout-snapshot-v1','fleetId':2,'originId':'homeworld','target':{'galaxy':1,'system':56,'position':6},'observedAt':'60','stock':[800,400,60],'garrison':{'light_fighter':4,'heavy_fighter':0},'defenderTech':{'weapons':0,'shields':0,'armour':0}}
        evidence=self.copied_rows(state['messages']);before=copy.deepcopy((evidence,state))
        self.assertIsInstance(assert_message_rows(evidence,state['messages']),tuple)
        self.assertEqual((evidence,state),before)
        snapshot,panel=self.messages()
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,panel,state,'after')
        for mutation in ('disabled','missing_button','wrong_text','extra_button'):
            rows=copy.deepcopy(evidence);row=rows['rows'][0]
            if mutation=='disabled':row['controls'][0]['disabled']=True
            if mutation=='missing_button':row['controls']=[]
            if mutation=='wrong_text':row['controls'][0]['text']='派遣舰队'
            if mutation=='extra_button':row['controls'].append(copy.deepcopy(row['controls'][0]))
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):assert_message_rows(rows,state['messages'])
    def test_plain_null_message_has_no_notice_or_key_and_empty_state_stays_exact(self):
        state=self.state();plain=self.copied_rows(state['messages'])['rows'][1]
        self.assertIsNone(plain['key']);self.assertEqual(len(plain['children']),2)
        empty=self.copied_rows([]);self.assertEqual(assert_message_rows(empty,[]),(empty['html'],empty['text']))
        empty['html']+='<p hidden="">unknown</p>'
        with self.assertRaises(AssertionError):assert_message_rows(empty,[])
    def test_current_native_draft_notice_golden_keeps_the_exact_contract(self):
        self.assertEqual(DRAFT_NOTICE_HTML,CAPTURED_DRAFT_NOTICE_HTML)
        snapshot,evidence=self.fleet();state=self.state();original=copy.deepcopy((snapshot,evidence,state))
        result=normalize_npc_display(snapshot,evidence,state,'after')
        self.assertEqual(result,{**snapshot,'text':'任务\n'+'\n'.join(label for _,label in MISSION_OPTIONS)+'\n原有在途舰队'})
        self.assertEqual((snapshot,evidence,state),original)
    def test_fleet_rehearsal_draft_notice_is_only_exact_hidden_empty_addition(self):
        for mutation in ('missing','count','zero_count','boolean_count','html','old_class','missing_muted','extra_class',
                         'wrong_tag','wrong_id','wrong_role','extra_attribute','nested','duplicate_html','missing_hidden',
                         'hidden','visible','order','numeric_hidden','numeric_visible','numeric_order','extra_field','missing_field'):
            snapshot,evidence=self.fleet();notice=evidence['rehearsalNotice']
            if mutation=='missing':evidence['rehearsalNotice']=None
            if mutation=='count':notice['count']=2
            if mutation=='zero_count':notice['count']=0
            if mutation=='boolean_count':notice['count']=True
            if mutation=='html':notice['html']=notice['html'].replace('</p>','unapproved</p>')
            if mutation=='old_class':notice['html']=notice['html'].replace('class="npc-rehearsal-draft-notice muted"','class="space-status"')
            if mutation=='missing_muted':notice['html']=notice['html'].replace(' muted','')
            if mutation=='extra_class':notice['html']=notice['html'].replace(' muted',' muted space-status')
            if mutation=='wrong_tag':notice['html']=notice['html'].replace('<p ','<div ').replace('</p>','</div>')
            if mutation=='wrong_id':notice['html']=notice['html'].replace('id="npc-rehearsal-draft-notice"','id="other"')
            if mutation=='wrong_role':notice['html']=notice['html'].replace('role="status"','role="alert"')
            if mutation=='extra_attribute':notice['html']=notice['html'].replace(' role=', ' data-other="unknown" role=')
            if mutation=='nested':notice['html']=notice['html'].replace('</p>','<span hidden=""></span></p>')
            if mutation=='duplicate_html':notice['html']*=2
            if mutation=='missing_hidden':notice['html']=notice['html'].replace(' hidden=""','')
            if mutation=='hidden':notice['hidden']=False
            if mutation=='visible':notice['visible']=True
            if mutation=='order':notice['exactOrder']=False
            if mutation=='numeric_hidden':notice['hidden']=1
            if mutation=='numeric_visible':notice['visible']=0
            if mutation=='numeric_order':notice['exactOrder']=1
            if mutation=='extra_field':notice['unknown']=False
            if mutation=='missing_field':del notice['exactOrder']
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_notice_repair_never_filters_any_original_control_or_unrelated_snapshot_field(self):
        # A 33-control regression fixture probes every original position.
        # Distinct sentinels are synthetic; real CI data is replayed separately.
        snapshot,evidence=self.fleet();state=self.state()
        snapshot['inputs']=[{'id':f'original-{n}','action':None,'type':'number','value':str(n),
                            'disabled':False,'checked':False,'text':None} for n in range(33)]
        snapshot['shared']={'status':'已保存到本地','amount-metal':'7.80e4'}
        snapshot['unrelated']={'hiddenAttribute':'kept','timer':'3.20'}
        original=copy.deepcopy((snapshot,evidence,state));expected=normalize_npc_display(snapshot,evidence,state,'after')
        self.assertEqual((snapshot,evidence,state),original)
        self.assertEqual(expected['inputs'],snapshot['inputs']);self.assertEqual(len(expected['inputs']),33)
        self.assertIsNot(expected['inputs'],snapshot['inputs'])
        for index in range(33):
            for field,value in (('id','changed'),('action','changed'),('type','text'),('value','changed'),
                                ('disabled',True),('checked',True),('text','changed')):
                changed=copy.deepcopy(snapshot);changed['inputs'][index][field]=value
                result=normalize_npc_display(changed,evidence,state,'after')
                with self.subTest(index=index,field=field):
                    self.assertNotEqual(result,expected)
                    self.assertEqual(result['inputs'],changed['inputs'])
        for mutation in ('text','shared','unrelated','missing_control','extra_control','reordered_controls'):
            changed=copy.deepcopy(snapshot)
            if mutation=='text':changed['text']+='\nother status'
            if mutation=='shared':changed['shared']['amount-metal']='0'
            if mutation=='unrelated':changed['unrelated']['hiddenAttribute']='changed'
            if mutation=='missing_control':changed['inputs'].pop()
            if mutation=='extra_control':changed['inputs'].append(copy.deepcopy(changed['inputs'][0]))
            if mutation=='reordered_controls':changed['inputs'].reverse()
            copied=copy.deepcopy(changed);result=normalize_npc_display(changed,evidence,state,'after')
            with self.subTest(mutation=mutation):
                self.assertNotEqual(result,expected);self.assertEqual(changed,copied)
                self.assertEqual(result['inputs'],changed['inputs'])
                self.assertEqual(result['shared'],changed['shared'])
                self.assertEqual(result['unrelated'],changed['unrelated'])
    def test_new_dom_counts_and_booleans_are_not_interchangeable(self):
        snapshot,evidence=self.messages();evidence['messages']['count']=True
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        for key,value in (('count',True),('hidden',1),('visible',0),('exactIds',1)):
            snapshot,evidence=self.messages();evidence['addition']['rehearsal'][key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        snapshot,evidence=self.messages();evidence['addition']['rehearsal']['controls'][0]['disabled']=1
        with self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_full_added_panel_rejects_unknown_attributes_text_and_hidden_data(self):
        for mutation in ('attribute','intro','report_wrapper','hidden','extra','reorder','head'):
            snapshot,evidence=self.messages()
            if mutation=='attribute':evidence['panelHTML']=evidence['panelHTML'].replace('class="tab-panel space-panel"','class="tab-panel space-panel" data-other="unknown"')
            if mutation=='intro':evidence['panelHTML']=evidence['panelHTML'].replace(INTRO,INTRO+' changed')
            if mutation=='report_wrapper':evidence['panelHTML']=evidence['panelHTML'].replace('id="npc-battle-reports"','id="npc-battle-reports" data-other="unknown"')
            if mutation=='hidden':evidence['panelHTML']=evidence['panelHTML'].replace('</section>','<p hidden="">unknown</p></section>',1)
            if mutation=='extra':evidence['panelHTML']+='<!-- unknown -->'
            if mutation=='reorder':evidence['panelHTML']=evidence['panelHTML'].replace('<h3 class="group-title">NPC 轨道战报</h3>','<h3 class="group-title"><span>NPC 轨道战报</span></h3>')
            if mutation=='head':evidence['addition']['headHTML']+='<span hidden="">unknown</span>'
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        for key in ('panels','lists','titles','reports','rules'):
            for count in (0,2,True):
                snapshot,evidence=self.messages();evidence['addition']['counts'][key]=count
                with self.subTest(key=key,count=count),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
    def test_unapproved_paragraph_report_rule_or_reordering_rejected(self):
        for mutation in ('prefix','suffix','gap','rule','report','origin','open'):
            snapshot,evidence=self.messages()
            if mutation=='prefix':snapshot['text']='unapproved\n'+snapshot['text']
            if mutation=='suffix':snapshot['text']+='\nunapproved'
            if mutation=='gap':snapshot['text']=snapshot['text'].replace(INTRO,INTRO+'\nunknown')
            if mutation=='rule':evidence['addition']['rulesText']='anything'
            if mutation=='report':evidence['addition']['reportHTML']='<p>unexpected</p>'
            if mutation=='origin':evidence['addition']['origin']='wrong'
            if mutation=='open':evidence['addition']['closed']=False
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def typed_state(self):
        state=self.state()
        state['messages'][1]['npcScoutSnapshot']={'model':'npc-scout-snapshot-v1','fleetId':2,'originId':'homeworld',
            'target':{'galaxy':1,'system':56,'position':6},'observedAt':'60','stock':[800,400,60],
            'garrison':{'light_fighter':4,'heavy_fighter':0},'defenderTech':{'weapons':0,'shields':0,'armour':0}}
        return state

    def rebuild_typed_row(self,rows):
        row=rows['rows'][0]
        row['html']=f'<article class="space-message" data-message-id="{row["key"]}">'+''.join(p['html'] for p in row['children'])+'</article>'
        row['text']='\n\n'.join(p['text'] for p in row['children'])
        rows['html']=''.join(r['html'] for r in rows['rows']);rows['text']='\n\n'.join(r['text'] for r in rows['rows'])

    def test_typed_message_comparison_is_exactly_second_and_original_opener_unchanged(self):
        state=self.typed_state();rows=self.copied_rows(state['messages']);original=copy.deepcopy((rows,state))
        row=rows['rows'][0]
        self.assertEqual(row['children'][3:],[
            {'html':'<button type="button">打开历史侦察演练</button>','text':'打开历史侦察演练'},
            {'html':'<button type="button" data-npc-scout-comparison="">历史对照</button>','text':'历史对照'}])
        self.assertEqual(len(row['children']),5);self.assertEqual(len(row['controls']),2)
        projected=assert_message_rows(rows,state['messages'])
        self.assertEqual((rows,state),original)
        self.assertNotIn('历史对照',projected[0]);self.assertNotIn('历史对照',projected[1])
        self.assertIn('<small>游戏 1 分 0 秒</small><p>原有侦察情报。</p>',projected[0])

    def test_two_opener_witness_binds_complete_html_original_values_order_and_protected_state(self):
        expected={'children':5,'controls':[
            {'html':'<button type="button">打开历史侦察演练</button>','tag':'BUTTON','type':'button','value':'','disabled':False,'direct':True,'index':3},
            {'html':'<button type="button" data-npc-scout-comparison="">历史对照</button>','tag':'BUTTON','type':'button','value':'','disabled':False,'direct':True,'index':4}]}
        self.assertTrue(exact_copied_data(typed_message_openers(),expected))
        protected=copy.deepcopy(expected)
        protected['controls'][1]['html']='<button type="button" data-npc-scout-comparison="" disabled="">历史对照</button>'
        protected['controls'][1]['disabled']=True
        self.assertTrue(exact_copied_data(typed_message_openers(True),protected))
        self.assertFalse(exact_copied_data(typed_message_openers(),protected))
        for index in range(2):
            for field,value in (('html','<button>changed</button>'),('tag','INPUT'),('type','submit'),('value','injected'),
                                ('disabled',True),('disabled',0),('direct',False),('direct',1),('index',0),('index',True)):
                changed=copy.deepcopy(expected);changed['controls'][index][field]=value
                with self.subTest(index=index,field=field,value=value):
                    self.assertFalse(exact_copied_data(typed_message_openers(),changed))
        for mutation in ('missing','duplicate','reversed','extra_input','children','boolean_count','extra_field','missing_field'):
            changed=copy.deepcopy(expected)
            if mutation=='missing':changed['controls'].pop()
            if mutation=='duplicate':changed['controls'].append(copy.deepcopy(changed['controls'][1]))
            if mutation=='reversed':changed['controls'].reverse()
            if mutation=='extra_input':changed['controls'].append({'html':'<input value="secret">','tag':'INPUT'})
            if mutation=='children':changed['children']=6
            if mutation=='boolean_count':changed['children']=True
            if mutation=='extra_field':changed['controls'][1]['unknown']='secret'
            if mutation=='missing_field':del changed['controls'][1]['value']
            with self.subTest(mutation=mutation):self.assertFalse(exact_copied_data(typed_message_openers(),changed))

    def test_typed_message_rejects_missing_duplicate_retagged_changed_or_reordered_comparison(self):
        mutations=('missing','duplicate','tag','text','attribute','missing_attribute','wrong_attribute','type','disabled',
                   'value','nested','input','reordered','rehearsal_attribute','rehearsal_text','button_child_text')
        for mutation in mutations:
            state=self.typed_state();rows=self.copied_rows(state['messages']);row=rows['rows'][0];button=row['children'][4]
            if mutation=='missing':row['children'].pop();row['controls'].pop()
            if mutation=='duplicate':row['children'].append(copy.deepcopy(button));row['controls'].append(copy.deepcopy(row['controls'][1]))
            if mutation=='tag':button['html']=button['html'].replace('<button ','<input ').replace('</button>','');row['controls'][1]['tag']='INPUT'
            if mutation=='text':button['html']=button['html'].replace('历史对照','当前库存');button['text']='当前库存';row['controls'][1]['text']='当前库存'
            if mutation=='attribute':button['html']=button['html'].replace('>',' data-other="secret">',1)
            if mutation=='missing_attribute':button['html']=button['html'].replace(' data-npc-scout-comparison=""','')
            if mutation=='wrong_attribute':button['html']=button['html'].replace('data-npc-scout-comparison=""','data-npc-scout-comparison="forged"')
            if mutation=='type':button['html']=button['html'].replace('type="button"','type="submit"');row['controls'][1]['type']='submit'
            if mutation=='disabled':button['html']=button['html'].replace('>',' disabled="">',1);row['controls'][1]['disabled']=True
            if mutation=='value':button['html']=button['html'].replace('>',' value="secret">',1)
            if mutation=='nested':button['html']=button['html'].replace('历史对照','<span>历史对照</span>')
            if mutation=='input':button['html']+='<input value="secret">';row['controls'].append({'tag':'INPUT','type':'text','disabled':False,'text':''})
            if mutation=='reordered':row['children'][3:]=reversed(row['children'][3:]);row['controls'].reverse()
            if mutation=='rehearsal_attribute':row['children'][3]['html']=row['children'][3]['html'].replace('>',' data-other="secret">',1)
            if mutation=='rehearsal_text':row['children'][3]['text']='changed'
            if mutation=='button_child_text':button['text']='changed'
            self.rebuild_typed_row(rows)
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):assert_message_rows(rows,state['messages'])

    def test_only_new_adjacent_button_boundary_accepts_inline_text(self):
        state=self.typed_state()
        for gap in ('','\n','\n\n'):
            rows=self.copied_rows(state['messages']);row=rows['rows'][0]
            row['text']=row['text'].replace('打开历史侦察演练\n\n历史对照','打开历史侦察演练'+gap+'历史对照')
            rows['text']='\n\n'.join(r['text'] for r in rows['rows'])
            with self.subTest(gap=repr(gap)):assert_message_rows(rows,state['messages'])
        for boundary in range(1,5):
            for gap in (('',' ','\t','\n\n\n') if boundary!=4 else (' ','\t','\n\n\n')):
                rows=self.copied_rows(state['messages']);row=rows['rows'][0];texts=[p['text'] for p in row['children']]
                row['text']=texts[0]+''.join((gap if index==boundary else '\n\n')+text for index,text in enumerate(texts[1:],1))
                rows['text']='\n\n'.join(r['text'] for r in rows['rows'])
                with self.subTest(boundary=boundary,gap=repr(gap)),self.assertRaises(AssertionError):assert_message_rows(rows,state['messages'])

    def test_plain_null_and_legacy_messages_cannot_gain_comparison_content(self):
        for current in (True,False):
            state=self.state()
            if not current:
                for message in state['messages']:message.pop('npcScoutSnapshot')
            for index in range(2):
                for mutation in ('button','notice','hidden_input','attribute'):
                    rows=self.copied_rows(state['messages'],current);row=rows['rows'][index]
                    self.assertEqual(row['controls'],[])
                    if mutation=='button':row['html']=row['html'].replace('</article>',COMPARISON_OPENER_HTML+'</article>');row['controls']=self.copied_rows(self.typed_state()['messages'])['rows'][0]['controls'][1:]
                    if mutation=='notice':row['html']=row['html'].replace('</article>','<p class="muted">历史对照</p></article>')
                    if mutation=='hidden_input':row['html']=row['html'].replace('</article>','<input hidden="" value="secret"></article>')
                    if mutation=='attribute':row['html']=row['html'].replace('space-message"','space-message" data-npc-scout-comparison=""')
                    rows['html']=''.join(r['html'] for r in rows['rows'])
                    with self.subTest(current=current,index=index,mutation=mutation),self.assertRaises(AssertionError):assert_message_rows(rows,state['messages'],current)

    def test_hidden_comparison_region_requires_complete_unique_html_and_initial_controls(self):
        for mutation in ('missing','zero_count','duplicate_count','boolean_count','shown','numeric_hidden','visible','numeric_visible',
                         'ids','numeric_ids','tag','text','attribute','hidden_data','input','duplicate_html','missing_hidden',
                         'extra_field','missing_field'):
            snapshot,evidence=self.messages();region=evidence['addition']['comparison'];old_html=region['html']
            if mutation=='missing':evidence['addition']['comparison']=None
            if mutation=='zero_count':region['count']=0
            if mutation=='duplicate_count':region['count']=2
            if mutation=='boolean_count':region['count']=True
            if mutation=='shown':region['hidden']=False
            if mutation=='numeric_hidden':region['hidden']=1
            if mutation=='visible':region['visible']=True
            if mutation=='numeric_visible':region['visible']=0
            if mutation=='ids':region['exactIds']=False
            if mutation=='numeric_ids':region['exactIds']=1
            if mutation=='tag':region['html']=region['html'].replace('<section ','<div ').replace('</section>','</div>')
            if mutation=='text':region['html']=region['html'].replace('历史侦察对照','当前库存')
            if mutation=='attribute':region['html']=region['html'].replace('class="ov-card','data-other="secret" class="ov-card')
            if mutation=='hidden_data':region['html']=region['html'].replace('</section>','<p hidden="">secret</p></section>')
            if mutation=='input':region['html']=region['html'].replace('</section>','<input hidden="" value="secret"></section>')
            if mutation=='duplicate_html':region['html']*=2
            if mutation=='missing_hidden':region['html']=region['html'].replace(' hidden=""','',1)
            if mutation=='extra_field':region['unknown']='secret'
            if mutation=='missing_field':del region['exactIds']
            evidence['panelHTML']=evidence['panelHTML'].replace(old_html,region['html'],1)
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        for index in range(3):
            for field,value in (('id','forged'),('type','number'),('value','1'),('disabled',None),('disabled',0),('visible',True),('visible',0)):
                snapshot,evidence=self.messages();region=evidence['addition']['comparison'];region['controls'][index][field]=value
                with self.subTest(index=index,field=field,value=value),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
        for mutation in ('order','extra','missing','enable_select','enable_run','disable_cancel'):
            snapshot,evidence=self.messages();controls=evidence['addition']['comparison']['controls']
            if mutation=='order':controls.reverse()
            if mutation=='extra':controls.append(copy.deepcopy(controls[0]))
            if mutation=='missing':controls.pop()
            if mutation=='enable_select':controls[0]['disabled']=False
            if mutation=='enable_run':controls[1]['disabled']=False
            if mutation=='disable_cancel':controls[2]['disabled']=True
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_comparison_notice_requires_unique_hidden_empty_exact_position(self):
        for mutation in ('missing','count','zero','boolean_count','shown','visible','numeric_hidden','numeric_visible','order','numeric_order',
                         'text','tag','id','role','live','class','attribute','input','duplicate_html','missing_hidden','extra_field','missing_field'):
            snapshot,evidence=self.messages();notice=evidence['addition']['comparisonNotice'];old_html=notice['html']
            if mutation=='missing':evidence['addition']['comparisonNotice']=None
            if mutation=='count':notice['count']=2
            if mutation=='zero':notice['count']=0
            if mutation=='boolean_count':notice['count']=True
            if mutation=='shown':notice['hidden']=False
            if mutation=='visible':notice['visible']=True
            if mutation=='numeric_hidden':notice['hidden']=1
            if mutation=='numeric_visible':notice['visible']=0
            if mutation=='order':notice['exactOrder']=False
            if mutation=='numeric_order':notice['exactOrder']=1
            if mutation=='text':notice['html']=notice['html'].replace('</p>','secret</p>')
            if mutation=='tag':notice['html']=notice['html'].replace('<p ','<div ').replace('</p>','</div>')
            if mutation=='id':notice['html']=notice['html'].replace('npc-scout-comparison-notice','other-notice')
            if mutation=='role':notice['html']=notice['html'].replace('role="status"','role="alert"')
            if mutation=='live':notice['html']=notice['html'].replace('aria-live="polite"','aria-live="assertive"')
            if mutation=='class':notice['html']=notice['html'].replace('class="muted"','class="space-status"')
            if mutation=='attribute':notice['html']=notice['html'].replace(' role=',' data-other="secret" role=')
            if mutation=='input':notice['html']=notice['html'].replace('</p>','<input value="secret"></p>')
            if mutation=='duplicate_html':notice['html']*=2
            if mutation=='missing_hidden':notice['html']=notice['html'].replace(' hidden=""','')
            if mutation=='extra_field':notice['unknown']=True
            if mutation=='missing_field':del notice['exactOrder']
            evidence['panelHTML']=evidence['panelHTML'].replace(old_html,notice['html'],1)
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_comparison_panel_and_notice_cannot_be_missing_duplicated_nested_or_reordered(self):
        for mutation in ('missing_panel','missing_notice','duplicate_panel','duplicate_notice','swap','before_rehearsal','after_battle','nested','order_witness','numeric_order'):
            snapshot,evidence=self.messages();panel=CAPTURED_CLOSED_COMPARISON_HTML;notice=COMPARISON_NOTICE_HTML;pair=notice+'\n  '+panel
            if mutation=='missing_panel':evidence['panelHTML']=evidence['panelHTML'].replace(panel,'')
            if mutation=='missing_notice':evidence['panelHTML']=evidence['panelHTML'].replace(notice,'')
            if mutation=='duplicate_panel':evidence['panelHTML']=evidence['panelHTML'].replace(panel,panel+panel)
            if mutation=='duplicate_notice':evidence['panelHTML']=evidence['panelHTML'].replace(notice,notice+notice)
            if mutation=='swap':evidence['panelHTML']=evidence['panelHTML'].replace(pair,panel+'\n  '+notice)
            if mutation=='before_rehearsal':evidence['panelHTML']=evidence['panelHTML'].replace(initial_rehearsal_html()+pair,pair+initial_rehearsal_html())
            if mutation=='after_battle':evidence['panelHTML']=evidence['panelHTML'].replace(pair,'').replace('<div id="npc-battle-reports"></div>','<div id="npc-battle-reports"></div>'+pair)
            if mutation=='nested':evidence['panelHTML']=evidence['panelHTML'].replace(pair,'<div>'+pair+'</div>')
            if mutation=='order_witness':evidence['addition']['exactOrder']=False
            if mutation=='numeric_order':evidence['addition']['exactOrder']=1
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_comparison_addition_keeps_all_59_original_controls_and_values_exact(self):
        # Synthetic field-by-field canaries; this is not a native DOM count.
        snapshot,evidence=self.fleet();state=self.state()
        snapshot['inputs']=[{'id':f'original-{n}','action':None,'type':'number','value':str(n),
                            'disabled':False,'checked':False,'text':None} for n in range(59)]
        snapshot['shared']={'status':'已保存到本地','amount-metal':'7.80e4'}
        expected=normalize_npc_display(snapshot,evidence,state,'after')
        self.assertEqual(expected['inputs'],snapshot['inputs']);self.assertEqual(len(expected['inputs']),59)
        prior=copy.deepcopy(snapshot);prior['text']='任务\n'+'\n'.join(label for _,label in MISSION_OPTIONS)+'\n原有在途舰队'
        old_evidence={'tab':'fleet','options':copy.deepcopy(MISSION_OPTIONS),'selected':'colonize',
                      'selectText':'\n'.join(label for _,label in MISSION_OPTIONS),
                      'hiddenAttack':None,'rehearsalNotice':None,'clear':None}
        self.assertEqual(normalize_npc_display(prior,old_evidence,state,'before'),expected)
        for index in range(59):
            for field,value in (('id','changed'),('action','changed'),('type','text'),('value','changed'),
                                ('disabled',True),('checked',True),('text','changed')):
                changed=copy.deepcopy(snapshot);changed['inputs'][index][field]=value;original=copy.deepcopy(changed)
                result=normalize_npc_display(changed,evidence,state,'after')
                with self.subTest(index=index,field=field):
                    self.assertNotEqual(result,expected);self.assertEqual(changed,original)
                    self.assertEqual(result['inputs'],changed['inputs']);self.assertEqual(result['shared'],changed['shared'])

    def test_constructor_comparison_literal_remains_distinct_and_exact(self):
        expected='''<section id="npc-scout-comparison-panel" class="ov-card npc-scout-comparison" aria-labelledby="npc-scout-comparison-title" hidden="">
    <h3 id="npc-scout-comparison-title" tabindex="-1">历史侦察对照</h3>
    <p id="npc-scout-comparison-source" class="chip"></p>
    <label for="npc-scout-comparison-other">同坐标的另一份报告<select id="npc-scout-comparison-other" disabled=""><option value="">请明确选择一份报告</option></select></label>
    <div class="space-controls"><button id="npc-scout-comparison-run" type="button" disabled="">查看差值</button><button id="npc-scout-comparison-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-scout-comparison-status" class="muted" role="status" aria-live="polite"></p>
    <p id="npc-scout-comparison-warning" class="muted">只是两次观察差，不代表净产量、战利品或当前库存。</p>
    <div id="npc-scout-comparison-results" hidden=""></div>
  </section>'''
        self.assertEqual(initial_comparison_html(),expected)
        self.assertNotEqual(initial_comparison_html(),closed_comparison_html())

    def test_navigation_closed_comparison_matches_complete_captured_native_region(self):
        self.assertEqual(hashlib.sha256(CAPTURED_CLOSED_COMPARISON_HTML.encode()).hexdigest(),
                         '389e54e68380cc8dad0162240c970b6caaa426b8f6f80e4860516c740141f0d9')
        self.assertEqual(closed_comparison_html(),CAPTURED_CLOSED_COMPARISON_HTML)
        self.assertEqual(initial_comparison_controls(),[
            {'id':'npc-scout-comparison-other','type':'select-one','value':'','disabled':True,'visible':False},
            {'id':'npc-scout-comparison-run','type':'button','value':'','disabled':True,'visible':False},
            {'id':'npc-scout-comparison-cancel','type':'button','value':'','disabled':False,'visible':False}])
        snapshot,evidence=self.messages();original=copy.deepcopy((snapshot,evidence));result=normalize_npc_display(snapshot,evidence,self.state(),'after')
        self.assertEqual((snapshot,evidence),original);self.assertEqual(result['inputs'],snapshot['inputs'])

    def test_navigation_parity_rejects_constructor_mixed_or_arbitrary_closed_html(self):
        for mutation in ('constructor','placeholder_only','empty_status','wrong_status','extra_option','source','visible_notice','hidden_result'):
            snapshot,evidence=self.messages();region=evidence['addition']['comparison'];old=region['html']
            if mutation=='constructor':region['html']=initial_comparison_html()
            if mutation=='placeholder_only':region['html']=old.replace('</select>','<option value="">请明确选择一份报告</option></select>')
            if mutation=='empty_status':region['html']=old.replace('对照已关闭；请从当前保留的侦察消息重新打开。','')
            if mutation=='wrong_status':region['html']=old.replace('对照已关闭；请从当前保留的侦察消息重新打开。','历史消息身份无效，对照已关闭。')
            if mutation=='extra_option':region['html']=old.replace('</select>','<option value="1">secret</option></select>')
            if mutation=='source':region['html']=old.replace('class="chip"></p>','class="chip">secret</p>')
            if mutation=='visible_notice':evidence['addition']['comparisonNotice']['hidden']=False
            if mutation=='hidden_result':region['html']=old.replace('<div id="npc-scout-comparison-results" hidden=""></div>','<div id="npc-scout-comparison-results" hidden=""><p>secret</p></div>')
            evidence['panelHTML']=evidence['panelHTML'].replace(old,region['html'],1)
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')

    def test_render_trace_navigates_tabs_before_sampling_and_controller_closes_exactly(self):
        root=Path(__file__).resolve().parents[1]
        source=(root/'scripts/browser-render-scheduling.py').read_text();tree=ast.parse(source)
        tabs=next(node for node in ast.walk(tree) if isinstance(node,ast.Assign)
                  and any(isinstance(target,ast.Name) and target.id=='tabs' for target in node.targets))
        self.assertEqual(ast.literal_eval(tabs.value),('overview','facilities','research','shipyard','defense','darkmatter',
                         'protocol','curvature','achievements','save','orders','galaxy','fleet','messages','deep','arcade'))
        loop=next(node for node in ast.walk(tree) if isinstance(node,ast.For) and isinstance(node.iter,ast.Name) and node.iter.id=='tabs')
        calls=[node for node in ast.walk(loop) if isinstance(node,ast.Call) and isinstance(node.func,ast.Name)]
        navigate=next(node for node in calls if node.func.id=='tab');sample=next(node for node in calls if node.func.id=='snapshot')
        self.assertLess((navigate.lineno,navigate.col_offset),(sample.lineno,sample.col_offset))
        tab=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='tab')
        self.assertIn("click(page,f'[data-tab=\"{name}\"]')",ast.get_source_segment(source,tab))
        adapter=(root/'src/ui/space-panel.ts').read_bytes().decode();controller=(root/'src/ui/npc-scout-comparison-panel.ts').read_text()
        adapter=energy_tab_retirement_before(adapter)
        self.assertIn('if(b.dataset.tab){npcAttack.retirePending();npcRehearsal.close();recyclePanel.invalidate();selected=null;return;}',adapter)
        self.assertIn('close() { controller?.close(); comparison?.close(); }',adapter)
        self.assertIn('close() { abandon(RETIRED, true); }',controller)
        self.assertIn('const RETIRED = "对照已关闭；请从当前保留的侦察消息重新打开。";',controller)
        abandon=controller.split('  function abandon(',1)[1].split('  function retireRegistration(',1)[0]
        for statement in ('other.replaceChildren(); other.value = "";',
                          'panel.hidden = true; text(source, ""); text(status, reason); disable();'):
            self.assertIn(statement,abandon)

    def test_tab_retirement_projection_rejects_any_source_drift_or_old_reversion(self):
        from test_energy_challenge_provenance import historical_bytes
        current=(Path(__file__).resolve().parents[1]/'src/ui/space-panel.ts').read_bytes().decode()
        call='energyChallengePanel.retire();'
        for changed in (current+'\n',current.replace('\n','\r\n'),historical_bytes('src/ui/space-panel.ts').decode(),
                        current.replace('if(b.dataset.tab){'+call,'if(b.dataset.tab){',1),
                        current.replace('if(b.dataset.tab){'+call,'if(b.dataset.tab){'+call*2,1),
                        current.replace(call+'npcAttack.retirePending();','npcAttack.retirePending();'+call,1),
                        current.replace('comparison?.close();','comparison?.open();',1)):
            with self.subTest(sha256=hashlib.sha256(changed.encode()).hexdigest()),self.assertRaises(AssertionError):
                energy_tab_retirement_before(changed)

class EmptyLabBlockerParityTests(unittest.TestCase):
    """Independent copied source-layout goldens, not a native execution claim."""

    def fixture(self, side='after'):
        # Keep these literals independent of production and contract constants.
        addition = '''<details class="research-lab-blockers" data-bind="research-lab-blockers" hidden="">
    <summary data-bind="research-lab-blockers-summary"><span data-bind="research-lab-blockers-headline"></span><span data-bind="research-lab-blockers-protection" hidden=""></span></summary>
    <p data-bind="research-lab-blockers-note"></p>
    <ul data-bind="research-lab-blockers-list" data-key="[]"></ul>
  </details>'''
        intro = '<p class="blurb">整个帝国同一时间只研究 1 项，研究队列长度与建造队列相同。成本 ⌊基础×2^(L−1)⌋（天体物理学 ×1.75 并取整到百位），研究时间 = (金属+晶体)/(1000·(1+研究实验室等级)) 小时 ÷ 研究速度。研究进行中不能升级研究实验室，研究实验室升级中也不能开始研究。前置只看已完成的等级。</p>'
        queue = '<div class="queue-panel"><ol class="queue-list" data-bind="rqueue-list"><li>已付研究 · 剩余 2 秒</li></ol></div>'
        prefix = '<section class="tab-panel" data-tab-panel="research" aria-labelledby="research-title"><div class="panel-head">研究</div>\n        '
        suffix = '\n        <article class="rcard"><p>晶体 800.00</p><button disabled="">研究</button><details>原有详情</details></article></section>'
        panel = prefix + intro + ('\n        '+addition if side == 'after' else '') + '\n        \n      ' + queue + suffix
        keys = ('research-lab-blockers', 'research-lab-blockers-summary', 'research-lab-blockers-headline',
                'research-lab-blockers-protection', 'research-lab-blockers-note', 'research-lab-blockers-list')
        evidence = {'count': 1 if side == 'after' else 0, 'prefixCount': 6 if side == 'after' else 0,
            'bindingCounts': {key: 1 if side == 'after' else 0 for key in keys}, 'addition': None}
        if side == 'after':
            evidence['addition'] = {'html': addition, 'hidden': True, 'open': False, 'visible': False,
                'exactPlacement': True, 'children': 3, 'summaryChildren': 2, 'controls': 0,
                'introHTML': intro, 'queueHTML': queue}
        state = {'planets': [{'id': 'homeworld', 'buildQueue': [{'building': 'metal_mine'}], 'demolition': None},
                             {'id': 'colony', 'buildQueue': [], 'demolition': None}]}
        return panel, evidence, state

    def test_minimal_pre_adapter_full_dom_mismatch_is_fixed_only_for_exact_empty_addition(self):
        before, old_evidence, state = self.fixture('before')
        after, evidence, state = self.fixture()
        original = copy.deepcopy((after, evidence, state))
        self.assertNotEqual(before, after, 'The old complete-DOM comparator must see the new node')
        self.assertEqual(normalize_empty_lab_blockers(before, old_evidence, state, 'before'), before)
        self.assertEqual(normalize_empty_lab_blockers(after, evidence, state, 'after'), before)
        self.assertEqual((after, evidence, state), original)
        self.assertIn('<details>原有详情</details>', before)

    def test_every_binding_identity_and_native_count_is_required(self):
        for key in ('count', 'prefixCount'):
            for value in (0, 2, True, 6.0):
                panel, evidence, state = self.fixture(); evidence[key] = value
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    normalize_empty_lab_blockers(panel, evidence, state, 'after')
        for key in self.fixture()[1]['bindingCounts']:
            for value in (0, 2, True):
                panel, evidence, state = self.fixture(); evidence['bindingCounts'][key] = value
                with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                    normalize_empty_lab_blockers(panel, evidence, state, 'after')
        for key, value in (('hidden', False), ('open', True), ('visible', True), ('exactPlacement', False),
                           ('children', 4), ('summaryChildren', 1), ('controls', 1)):
            panel, evidence, state = self.fixture(); evidence['addition'][key] = value
            with self.subTest(key=key), self.assertRaises(AssertionError):
                normalize_empty_lab_blockers(panel, evidence, state, 'after')

    def test_complete_empty_hidden_closed_html_rejects_unreported_content_and_controls(self):
        for mutation in ('visible', 'open', 'headline', 'note', 'list', 'protection', 'title', 'control',
                         'unknown-child', 'unknown-attribute', 'wrong-binding', 'wrong-class', 'missing-key'):
            panel, evidence, state = self.fixture(); original = evidence['addition']['html']; changed = original
            if mutation == 'visible': changed = changed.replace(' hidden=""', '', 1)
            if mutation == 'open': changed = changed.replace('<details ', '<details open="" ', 1)
            if mutation == 'headline': changed = changed.replace('headline"></span>', 'headline">研究受阻</span>')
            if mutation == 'note': changed = changed.replace('note"></p>', 'note">未授权内容</p>')
            if mutation == 'list': changed = changed.replace('</ul>', '<li>额外任务</li></ul>')
            if mutation == 'protection': changed = changed.replace('protection" hidden=""></span>', 'protection" hidden="">冻结进度</span>')
            if mutation == 'title': changed = changed.replace('protection" hidden=""', 'protection" hidden="" title="保护中"')
            if mutation == 'control': changed = changed.replace('</ul>', '<button>取消</button></ul>')
            if mutation == 'unknown-child': changed = changed.replace('</details>', '<p hidden="">别的内容</p></details>')
            if mutation == 'unknown-attribute': changed = changed.replace('<details ', '<details data-other="1" ', 1)
            if mutation == 'wrong-binding': changed = changed.replace('blockers-headline', 'blockers-heading')
            if mutation == 'wrong-class': changed = changed.replace('class="research-lab-blockers"', 'class="other"')
            if mutation == 'missing-key': changed = changed.replace(' data-key="[]"', '')
            self.assertNotEqual(changed, original, mutation)
            evidence['addition']['html'] = changed; panel = panel.replace(original, changed, 1)
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                normalize_empty_lab_blockers(panel, evidence, state, 'after')

    def test_wrong_position_missing_duplicate_and_nested_node_are_rejected_even_with_claimed_placement(self):
        for mutation in ('missing', 'duplicate', 'before-intro', 'after-queue', 'nested', 'extra-binding'):
            panel, evidence, state = self.fixture(); addition = evidence['addition']; html = addition['html']
            if mutation == 'missing': panel = panel.replace(html, '', 1)
            if mutation == 'duplicate': panel = panel.replace(html, html+html, 1)
            if mutation == 'before-intro': panel = panel.replace('\n        '+html, '', 1).replace(addition['introHTML'], html+addition['introHTML'], 1)
            if mutation == 'after-queue': panel = panel.replace('\n        '+html, '', 1).replace(addition['queueHTML'], addition['queueHTML']+html, 1)
            if mutation == 'nested': panel = panel.replace(html, '<div>'+html+'</div>', 1)
            if mutation == 'extra-binding': panel = panel.replace('</section>', '<span data-bind="research-lab-blockers-extra"></span></section>')
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                normalize_empty_lab_blockers(panel, evidence, state, 'after')
        panel, evidence, state = self.fixture('before')
        with self.assertRaises(AssertionError):
            normalize_empty_lab_blockers(panel+self.fixture()[1]['addition']['html'], evidence, state, 'before')

    def test_any_real_paid_lab_head_tail_or_demolition_refuses_the_exception(self):
        for index in (0, 1):
            for kind in ('head', 'tail', 'demolition'):
                panel, evidence, state = self.fixture(); planet = state['planets'][index]
                if kind == 'head': planet['buildQueue'].insert(0, {'building': 'research_lab'})
                if kind == 'tail': planet['buildQueue'].append({'building': 'research_lab'})
                if kind == 'demolition': planet['demolition'] = {'building': 'research_lab'}
                with self.subTest(index=index, kind=kind), self.assertRaises(AssertionError):
                    normalize_empty_lab_blockers(panel, evidence, state, 'after')

    def test_all_unrelated_dom_and_whitespace_remain_in_exact_comparison(self):
        expected = self.fixture('before')[0]
        for old, new in (('晶体 800.00', '晶体 801.00'), ('<button disabled="">', '<button>'),
                         ('<details>原有详情</details>', '<details open="">原有详情</details>'),
                         ('<article class="rcard">', '<article class="rcard" hidden="">'),
                         ('</section>', '<p hidden="">额外节点</p></section>')):
            panel, evidence, state = self.fixture(); panel = panel.replace(old, new, 1)
            self.assertNotEqual(normalize_empty_lab_blockers(panel, evidence, state, 'after'), expected)
        panel, evidence, state = self.fixture(); queue = evidence['addition']['queueHTML']
        changed = queue.replace('剩余 2 秒', '剩余 3 秒')
        panel = panel.replace(queue, changed, 1); evidence['addition']['queueHTML'] = changed
        self.assertNotEqual(normalize_empty_lab_blockers(panel, evidence, state, 'after'), expected)

    def test_native_research_sampler_is_single_and_archives_before_the_narrow_projection(self):
        source = (Path(__file__).resolve().parents[1]/'scripts/browser-render-scheduling.py').read_text()
        tree = ast.parse(source)
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'research_base_snapshot')
        calls = [node for node in ast.walk(function) if isinstance(node, ast.Call)]
        project = [node for node in calls if isinstance(node.func, ast.Name) and node.func.id == 'normalize_empty_lab_blockers']
        self.assertEqual(len(project), 1)
        archive = next(node for node in calls if isinstance(node.func, ast.Attribute) and node.func.attr == 'write_text')
        self.assertLess(archive.lineno, project[0].lineno)
        self.assertEqual(source.count('result.researchEvidence='), 1)
        self.assertEqual(source.count("projected['researchInvariantDOM']=panel_html.replace"), 1)
        self.assertEqual(source.count("label if name=='research' else None"), 1)
        for literal in ('panel.children[2]===labs', 'panel.children[3]===labQueue',
                        "prefixCount:document.querySelectorAll('[data-bind^=\"research-lab-blockers\"]').length"):
            self.assertIn(literal, source)


if __name__=='__main__':unittest.main()
