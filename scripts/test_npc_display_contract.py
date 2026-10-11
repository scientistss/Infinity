"""Copied-data contract tests only; formal native DOM remains a separate gate."""
import copy
import unittest
from npc_display_contract import *

class NpcDisplayTests(unittest.TestCase):
    def state(self):return {'activePlanetId':'homeworld','planets':[{'id':'homeworld','name':'Home','npcResourceRemainder':{'metal':'0','crystal':'0','deuterium':'0'},'coordinates':{'galaxy':1,'system':50,'position':8}}],'universe':{'seed':42},'npcEconomy':{'sites':{}},'npcBattles':{'model':'npc-battle-receipts-v1','reports':[]}}
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
        snapshot={'tab':'galaxy','text':'\n'.join([r['text'] for r in rows]+[NEW_HINT]),'inputs':inputs};evidence={'tab':'galaxy','hintLast':True,'hint':NEW_HINT,'rows':rows}
        return snapshot,evidence,{'tab':'galaxy','text':'\n'.join(old_text+[OLD_HINT]),'inputs':old_inputs}
    def test_only_exact_npc_route_additions_are_removed(self):
        snapshot,evidence,expected=self.galaxy()
        self.assertEqual(normalize_npc_display(snapshot,evidence,self.state(),'after'),expected)
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
        return {'tab':'fleet','text':'任务\n'+text+'\n原有在途舰队','inputs':[]},{'tab':'fleet','options':options,'selected':'colonize','selectText':text,'hiddenAttack':{'hidden':True,'html':ATTACK_OPTIONS_HTML,'quota':'','status':''},'clear':{'hidden':True,'text':'清空货物草稿','visible':False,'index':-1}}
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
    def messages(self):
        head='航行消息\nHome [1:50:8]';message='原有消息。';text='\n\n'.join([head,INTRO,message,'NPC 轨道战报',HISTORY,'战斗规则'])
        a={'heading':'航行消息','origin':'Home [1:50:8]','intro':INTRO,'title':'NPC 轨道战报','history':HISTORY,'rulesText':RULES,'summary':'战斗规则','closed':True,'reportHTML':'','exactOrder':True,'headText':head}
        return {'tab':'messages','text':text,'inputs':[]},{'tab':'messages','current':True,'messageHTML':'<article>原有消息。</article>','messageText':message,'addition':a}
    def test_all_original_message_html_and_text_retained(self):
        snapshot,evidence=self.messages();result=normalize_npc_display(snapshot,evidence,self.state(),'after')
        self.assertEqual(result['text'],'原有消息。');self.assertEqual(result['historicalMessageHTML'],evidence['messageHTML'])
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
