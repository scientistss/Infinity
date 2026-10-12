"""Copied-data contract tests only; formal native DOM remains a separate gate."""
import copy
import unittest
from npc_display_contract import *

class NpcDisplayTests(unittest.TestCase):
    def state(self):return {'activePlanetId':'homeworld','planets':[{'id':'homeworld','name':'Home','npcResourceRemainder':{'metal':'0','crystal':'0','deuterium':'0'},'coordinates':{'galaxy':1,'system':50,'position':8}}],'universe':{'seed':42},'npcEconomy':{'sites':{}},'npcBattles':{'model':'npc-battle-receipts-v1','reports':[]},'messages':[{'id':'send-1','at':3,'text':'原有消息。','npcScoutSnapshot':None},{'id':'scout-2','at':60,'text':'原有侦察情报。','npcScoutSnapshot':None}]}
    def unit_panel(self,tab,side):
        # Deliberately copied evidence only. Live SAMPLE_JS and complete native
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
        return {'tab':'fleet','text':'任务\n'+text+'\n原有在途舰队','inputs':[]},{'tab':'fleet','options':options,'selected':'colonize','selectText':text,'hiddenAttack':{'hidden':True,'html':ATTACK_OPTIONS_HTML,'quota':'','status':''},'rehearsalNotice':{'count':1,'html':DRAFT_NOTICE_HTML,'hidden':True,'visible':False,'exactOrder':True},'clear':{'hidden':True,'text':'清空货物草稿','visible':False,'index':-1}}
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
                parts.append({'html':f'<button type="button">{OPEN_REHEARSAL}</button>','text':OPEN_REHEARSAL})
                controls=[{'tag':'BUTTON','type':'button','disabled':False,'text':OPEN_REHEARSAL}]
            opening=f'<article class="space-message" data-message-id="{m["id"]}">' if scout else '<article class="space-message">'
            rows.append({'html':opening+''.join(p['html'] for p in parts)+'</article>','text':'\n\n'.join(p['text'] for p in parts),
                'key':m['id'] if scout else None,'direct':True,'children':parts,'controls':controls})
        return {'count':1,'rows':rows,'html':''.join(r['html'] for r in rows) if rows else '<p class="muted">尚无航行记录。</p>',
                'text':'\n\n'.join(r['text'] for r in rows) if rows else '尚无航行记录。'}
    def messages(self):
        head='航行消息\nHome [1:50:8]';rows=self.copied_rows(self.state()['messages']);message=rows['text'];text='\n\n'.join([head,INTRO,message,'NPC 轨道战报',HISTORY,'战斗规则'])
        a={'counts':{'panels':1,'lists':1,'titles':1,'reports':1,'rules':1},'headHTML':'<div class="panel-head"><h2 id="space-messages-title">航行消息</h2><p class="space-location">Home [1:50:8]</p></div>','heading':'航行消息','origin':'Home [1:50:8]','intro':INTRO,'title':'NPC 轨道战报','history':HISTORY,'rulesText':RULES,'summary':'战斗规则','closed':True,'reportHTML':'','exactOrder':True,'headText':head,
           'rehearsal':{'count':1,'html':initial_rehearsal_html(),'hidden':True,'visible':False,'exactIds':True,'controls':initial_rehearsal_controls()}}
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
    def test_fleet_rehearsal_draft_notice_is_only_exact_hidden_empty_addition(self):
        for mutation in ('missing','count','html','hidden','visible','order'):
            snapshot,evidence=self.fleet();notice=evidence['rehearsalNotice']
            if mutation=='missing':evidence['rehearsalNotice']=None
            if mutation=='count':notice['count']=2
            if mutation=='html':notice['html']=notice['html'].replace('</p>','unapproved</p>')
            if mutation=='hidden':notice['hidden']=False
            if mutation=='visible':notice['visible']=True
            if mutation=='order':notice['exactOrder']=False
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):normalize_npc_display(snapshot,evidence,self.state(),'after')
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

if __name__=='__main__':unittest.main()
