"""Exact copied-evidence r13 display delta on the unchanged no-attack base.
No browser writes, arbitrary message deletion, or generic text/control filtering.
"""
from copy import deepcopy
OLD_HINT='NPC 当前仅提供基础侦察，不会反击；第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。'
NEW_HINT='侦察查看抵达时的历史情报；攻击 NPC 轨道驻军可能永久损失舰船。第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。'
MISSION_OPTIONS=[['colonize','殖民'],['transport','运输'],['deploy','部署'],['scout','侦察'],['charge','深空充能'],['recycle','残骸回收']]
INTRO='按游戏时间记录派遣、抵达、侦察和返航；保留最近 150 条。'
HISTORY='保留 60 份终端历史与全部尚未交付的战报。'
RULES='按舰种聚合结算，最多六轮。阵亡舰船永久损失，幸存者下一场恢复完整船体与护盾。仅获胜且有幸存舰船才装载战利品；按幸存货舱分配，返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益。空驻军收集为 0 回合。NPC 不会主动袭击母星。'
ATTACK_OPTIONS_HTML='<div id="npc-attack-options" hidden=""><p class="muted">武器技术 1 级 · 空载出航。空载出发，战后按幸存货舱装载；被毁舰船永久损失。</p><p id="npc-attack-quota" class="chip"></p><p id="npc-attack-draft-status" class="space-error" role="status"></p></div>'
SAMPLE_JS=r'''() => {
 const panel=[...document.querySelectorAll('[data-tab-panel]')].find(e=>!e.hidden),tab=panel.dataset.tabPanel;
 const visible=e=>{for(let a=e;a;a=a.parentElement){if(a.hidden||getComputedStyle(a).display==='none')return false;if(a instanceof HTMLDetailsElement&&!a.open&&!a.firstElementChild?.contains(e))return false;}return e.getClientRects().length>0;};
 const inputs=[...panel.querySelectorAll('input,select,textarea,button')].filter(visible);
 const result={tab,panelHTML:panel.outerHTML};
 if(tab==='galaxy'){
  // The existing folded navigator follows the hint. Bind the hint to the
  // unique coordinate table, never to its text or the panel's final child.
  const children=[...panel.children],tables=panel.querySelectorAll('.space-table-scroll'),worlds=document.querySelectorAll('#space-worlds');
  const table=tables[0],hint=table?.nextElementSibling,navigation=hint?.nextElementSibling,summary=navigation?.firstElementChild;
  result.hint=hint?.innerText;
  result.hintBoundary={
   counts:{tables:tables.length,worlds:worlds.length,hints:children.filter(e=>e.matches('p.muted')&&!e.id).length,
    navigation:document.querySelectorAll('#expansion-navigation').length,summaries:document.querySelectorAll('#expansion-navigation-summary').length},
   positions:{children:children.length,table:children.indexOf(table),hint:children.indexOf(hint),navigation:children.indexOf(navigation)},
   exactOrder:!!table&&!!hint&&!!navigation&&table.matches('div.space-table-scroll')&&table.parentElement===panel&&
    worlds[0]?.matches('tbody#space-worlds')&&worlds[0].parentElement?.matches('table.ov-table.space-table')&&table.contains(worlds[0])&&
    hint.parentElement===panel&&navigation.parentElement===panel&&panel.lastElementChild===navigation,
   hintHTML:hint?.outerHTML,
   navigation:{tag:navigation?.tagName,id:navigation?.id,className:navigation?.className,closed:navigation?.open===false,
    children:navigation?.children.length,summaryHTML:summary?.outerHTML,
    exactBody:navigation?.lastElementChild?.matches('div.expansion-navigation-body')&&navigation.querySelectorAll('summary').length===1}};
  result.rows=[...panel.querySelectorAll('#space-worlds > tr')].map(row=>({text:row.innerText,key:row.children[1].querySelector('small').textContent.slice(1,-1),kind:row.children[2].textContent,
   attacks:[...row.querySelectorAll('[data-mission="attack"]')].map(b=>({html:b.outerHTML,text:b.textContent,key:b.dataset.coordinate,action:b.dataset.space,type:b.type,disabled:b.disabled,index:inputs.indexOf(b),visible:visible(b),last:b.parentElement.lastElementChild===b,previous:b.previousElementSibling?.dataset.mission}))}));
 }
 if(tab==='fleet'){
  const select=panel.querySelector('#flight-mission'),options=panel.querySelector('#npc-attack-options'),clear=panel.querySelector('[data-space="attack-clear-cargo"]');
  result.options=[...select.options].map(o=>[o.value,o.text]);result.selected=select.value;result.selectText=select.innerText;
  result.hiddenAttack=options?{hidden:options.hidden,html:options.outerHTML,quota:options.querySelector('#npc-attack-quota').textContent,status:options.querySelector('#npc-attack-draft-status').textContent}:null;
  result.clear=clear?{hidden:clear.hidden,text:clear.textContent,visible:visible(clear),index:inputs.indexOf(clear)}:null;
 }
 if(tab==='messages'){
  const list=panel.querySelector('#space-message-list'),head=panel.querySelector('.panel-head'),rules=panel.querySelector('.npc-battle-rules'),reports=panel.querySelector('#npc-battle-reports');
  result.current=!!list;result.messageHTML=(list??panel).innerHTML;result.messageText=(list??panel).innerText;
  if(list)result.addition={headHTML:head.outerHTML,heading:head.querySelector('h2').textContent,origin:head.querySelector('.space-location').textContent,headText:head.innerText,intro:head.nextElementSibling.textContent,
   title:list.nextElementSibling.textContent,history:list.nextElementSibling.nextElementSibling.textContent,rulesText:rules.querySelector('p').textContent,summary:rules.querySelector('summary').textContent,closed:!rules.open,reportHTML:reports.innerHTML,
   exactOrder:panel.children.length===7&&panel.children[0]===head&&panel.children[2]===list&&panel.children[5]===rules&&panel.children[6]===reports};
 }
 return result;
}'''

def coordinate_random(seed,g,s,p,salt=0):
    x=(seed^(g*73856093)^(s*19349663)^(p*83492791)^(salt*2654435761))&0xffffffff
    x^=x>>16;x=(x*0x7feb352d)&0xffffffff;x^=x>>15;x=(x*0x846ca68b)&0xffffffff;x^=x>>16
    return x/4294967296

def replace_once(text,old,new):
    assert old and text.count(old)==1,'One complete uniquely identified native text region required'
    return text.replace(old,new,1)

def parts_exact(text,parts):
    """Only native paragraph linebreaks may separate these complete exact parts."""
    cursor=0
    for index,part in enumerate(parts):
        assert part and text.count(part)==1
        at=text.index(part,cursor);gap=text[cursor:at]
        assert gap in (('',) if index==0 else ('\n','\n\n'))
        cursor=at+len(part)
    assert text[cursor:] in ('','\n')

def normalize_npc_display(snapshot,evidence,state,side):
    assert side in ('before','after') and snapshot['tab']==evidence['tab'] in ('galaxy','fleet','messages')
    out=deepcopy(snapshot);after=side=='after';tab=snapshot['tab']
    if after:
        assert state['npcBattles']=={'model':'npc-battle-receipts-v1','reports':[]}
        assert state['npcEconomy']['sites']=={},'Base has no materialized targets'
        for planet in state['planets']:
            assert planet.get('npcResourceRemainder')=={'metal':'0','crystal':'0','deuterium':'0'},'Zero-rights historical UI only; never hide a positive entitlement'
    if tab=='galaxy':
        hint=NEW_HINT if after else OLD_HINT
        assert evidence['hint']==hint
        assert evidence['hintBoundary']=={
            'counts':{'tables':1,'worlds':1,'hints':1,'navigation':1,'summaries':1},
            'positions':{'children':7,'table':4,'hint':5,'navigation':6},'exactOrder':True,
            'hintHTML':f'<p class="muted">{hint}</p>',
            'navigation':{'tag':'DETAILS','id':'expansion-navigation','className':'expansion-navigation','closed':True,
                'children':2,'summaryHTML':'<summary id="expansion-navigation-summary">开拓查看（只读）</summary>','exactBody':True}}
        home=next(p for p in state['planets'] if p['id']==state['activePlanetId']);g,s=home['coordinates']['galaxy'],home['coordinates']['system']
        occupied={tuple(p['coordinates'][k] for k in ('galaxy','system','position')) for p in state['planets']}
        assert len(evidence['rows'])==16;removed=[]
        for position,row in enumerate(evidence['rows'],1):
            key=f'{g}:{s}:{position}';assert row['key']==key
            npc=position<16 and (g,s,position) not in occupied and coordinate_random(state['universe']['seed'],g,s,position)<.25
            assert (row['kind']=='NPC 邻居')==npc
            assert len(row['attacks'])==(1 if after and npc else 0)
            if row['attacks']:
                b=row['attacks'][0]
                assert b=={**b,'text':'攻击','key':key,'action':'route','type':'button','disabled':False,'visible':True,'last':True,'previous':'scout'}
                assert b['html']==f'<button type="button" data-space="route" data-coordinate="{key}" data-mission="attack">攻击</button>'
                assert type(b['index']) is int and b['index']>=0
                expected={'id':'','action':'route','type':'button','value':'','disabled':False,'checked':None,'text':'攻击'}
                assert out['inputs'][b['index']]==expected and b['index'] not in removed;removed.append(b['index'])
                assert row['text'].count('攻击')==1 and row['text'].endswith(('侦察\n攻击','侦察攻击'))
                suffix='\n攻击' if row['text'].endswith('侦察\n攻击') else '攻击'
                out['text']=replace_once(out['text'],row['text'],row['text'][:-len(suffix)])
        if after:
            out['inputs']=[v for i,v in enumerate(out['inputs']) if i not in removed]
            out['text']=replace_once(out['text'],NEW_HINT,OLD_HINT)
    elif tab=='fleet':
        wanted=deepcopy(MISSION_OPTIONS)
        if after:wanted.insert(4,['attack','NPC 轨道攻击'])
        assert evidence['options']==wanted and evidence['selected']=='colonize'
        assert evidence['selectText']=='\n'.join(label for _,label in wanted)
        if after:
            assert evidence['hiddenAttack']=={'hidden':True,'html':ATTACK_OPTIONS_HTML,'quota':'','status':''}
            assert evidence['clear']=={'hidden':True,'text':'清空货物草稿','visible':False,'index':-1}
            out['text']=replace_once(out['text'],evidence['selectText'],'\n'.join(label for _,label in MISSION_OPTIONS))
        else:assert evidence['hiddenAttack'] is None and evidence['clear'] is None
    else:
        assert evidence['current']==after and not out['inputs']
        if after:
            a=evidence['addition'];home=next(p for p in state['planets'] if p['id']==state['activePlanetId']);c=home['coordinates']
            origin=f"{home['name']} [{c['galaxy']}:{c['system']}:{c['position']}]"
            assert a['heading']=='航行消息' and a['origin']==origin and a['intro']==INTRO
            assert a['title']=='NPC 轨道战报' and a['history']==HISTORY and a['rulesText']==RULES and a['summary']=='战斗规则'
            assert a['closed'] and a['reportHTML']=='' and a['exactOrder']
            parts_exact(a['headText'],['航行消息',origin])
            parts_exact(out['text'],[a['headText'],INTRO,evidence['messageText'],'NPC 轨道战报',HISTORY,'战斗规则'])
            out['text']=evidence['messageText']
        else:assert out['text']==evidence['messageText']
        # The paired old/current assertion compares every original message node.
        out['historicalMessageHTML']=evidence['messageHTML']
    return out
