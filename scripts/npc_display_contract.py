"""Exact copied-evidence r14 display delta on the unchanged no-attack base.
No browser writes, arbitrary message deletion, or generic text/control filtering.
"""
from copy import deepcopy
from html import escape
import math
OLD_HINT='NPC 当前仅提供基础侦察，不会反击；第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。'
NEW_HINT='侦察查看抵达时的历史情报；攻击 NPC 轨道驻军可能永久损失舰船。第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。'
MISSION_OPTIONS=[['colonize','殖民'],['transport','运输'],['deploy','部署'],['scout','侦察'],['charge','深空充能'],['recycle','残骸回收']]
INTRO='按游戏时间记录派遣、抵达、侦察和返航；保留最近 150 条。'
HISTORY='保留 60 份终端历史与全部尚未交付的战报。'
RULES='按舰种聚合结算，最多六轮。阵亡舰船永久损失，幸存者下一场恢复完整船体与护盾。仅获胜且有幸存舰船才装载战利品；按幸存货舱分配，返抵原出发星球后一次结算；不足 1 的部分保留为该星球待结算权益。空驻军收集为 0 回合。NPC 不会主动袭击母星。'
ATTACK_OPTIONS_HTML='<div id="npc-attack-options" hidden=""><p class="muted">武器技术 1 级 · 空载出航。空载出发，战后按幸存货舱装载；被毁舰船永久损失。</p><p id="npc-attack-quota" class="chip"></p><p id="npc-attack-draft-status" class="space-error" role="status"></p></div>'
SHIPYARD_INTRO='每艘耗时 = (金属 + 晶体) / (2500 × (1 + 造船厂) × 2^纳米) 小时 ÷ 宇宙速度。按批次下单、下单时扣全款，逐艘完成；舰船与防御共用一条造船队列。造船厂或纳米机器人工厂升级期间造船暂停。'
DEFENSE_INTRO='防御和舰船共用造船队列与造船时间公式。护盾罩每种限 1 个；导弹放在导弹井里（每级 10 格，反弹道导弹 1 格、星际导弹 2 格）。'
UNIT_PANEL_COPY={
 'shipyard':{
  'before':SHIPYARD_INTRO+'攻击、护盾、结构已计入武器、护盾、装甲技术（战斗第 5 阶段开放），速度已计入引擎（飞行第 4 阶段开放）。',
  'after':SHIPYARD_INTRO+'攻击、护盾、结构已计入武器、护盾、装甲技术；可飞舰船可参与 NPC 轨道战斗，速度已计入引擎。'},
 'defense':{
  'before':DEFENSE_INTRO+'第 1–4 阶段没有敌人，防御在第 5 阶段开始派上用场。',
  'after':DEFENSE_INTRO+'当前 NPC 轨道攻击仅派遣可飞舰船，防御与导弹不参与；NPC 不会主动袭击母星。'}}
UNAVAILABLE='没有可用的演练快照；需要新的付费侦察抵达'
OPEN_REHEARSAL='打开历史侦察演练'
FLYING_SHIPS=[('small_cargo','小型运输舰'),('large_cargo','大型运输舰'),('light_fighter','轻型战斗机'),
 ('heavy_fighter','重型战斗机'),('cruiser','巡洋舰'),('battleship','战列舰'),('battlecruiser','战列巡洋舰'),
 ('bomber','轰炸机'),('destroyer','毁灭者'),('deathstar','死星'),('recycler','回收船'),
 ('espionage_probe','间谍卫星'),('colony_ship','殖民船')]
DRAFT_NOTICE_HTML='<p id="npc-rehearsal-draft-notice" class="space-status" role="status" hidden=""></p>'


def initial_rehearsal_html():
    """Literal independent initially closed UI contract; no source import/parse."""
    ships=''.join(f'<label class="space-ship"><span>{name}<small id="npc-rehearsal-stock-{ident}"></small></span><input id="npc-rehearsal-ship-{ident}" type="number" min="0" max="1000000000000" step="1" value="0" aria-label="{name}演练数量" disabled=""></label>' for ident,name in FLYING_SHIPS)
    options=''.join(f'<option value="{n}">{n}%</option>' for n in range(100,0,-10))
    return f'''<section id="npc-rehearsal-panel" class="ov-card" aria-labelledby="npc-rehearsal-title" hidden="">
    <h3 id="npc-rehearsal-title" tabindex="-1">历史侦察演练</h3>
    <p id="npc-rehearsal-source" class="muted"></p><p id="npc-rehearsal-origin" class="chip"></p>
    <details id="npc-rehearsal-history"><summary>侦察抵达时的精确情报</summary><div id="npc-rehearsal-history-body" class="npc-report-details"></div></details>
    <p class="muted">仅选择当前星球已停泊舰船。演练不派遣、不付款；排队建造与研究不计入。</p>
    <div class="space-ships">{ships}</div>
    <div class="space-controls"><label>草稿速度<select id="npc-rehearsal-speed" disabled="">{options}</select></label>
    <button id="npc-rehearsal-run" type="button" disabled="">运行三个公开种子示例</button><button id="npc-rehearsal-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-rehearsal-status" class="space-error" role="status" aria-live="polite"></p>
    <div id="npc-rehearsal-results" hidden=""></div>
    <p id="npc-rehearsal-fill-explanation" class="muted">填入会替换舰队草稿的任务、目标、全部 13 类舰船数量、速度和货物（全部清零），保留当前所选星球。之后仍需单独点击付费出征。</p>
    <button id="npc-rehearsal-fill" type="button" aria-describedby="npc-rehearsal-fill-explanation" disabled="">填入攻击草稿（空载）</button>
  </section>'''


def initial_message_panel_html(origin,message_html):
    """Bind the complete added container, including hidden data and all wrappers."""
    return ('<section id="space-messages" class="tab-panel space-panel" data-tab-panel="messages" aria-labelledby="space-messages-title">'
      +f'<div class="panel-head"><h2 id="space-messages-title">航行消息</h2><p class="space-location">{dom_text(origin)}</p></div>'
      +f'<p class="muted">{INTRO}</p><div id="space-message-list">{message_html}</div>'
      +initial_rehearsal_html()+f'<h3 class="group-title">NPC 轨道战报</h3><p class="muted">{HISTORY}</p>'
      +f'<details class="npc-battle-rules"><summary>战斗规则</summary><p class="muted">{RULES}</p></details>'
      +'<div id="npc-battle-reports"></div></section>')


def initial_rehearsal_controls():
    return [{'id':'npc-rehearsal-ship-'+ident,'type':'number','value':'0','disabled':True,'visible':False} for ident,_ in FLYING_SHIPS]+[
      {'id':'npc-rehearsal-speed','type':'select-one','value':'100','disabled':True,'visible':False},
      {'id':'npc-rehearsal-run','type':'button','value':'','disabled':True,'visible':False},
      {'id':'npc-rehearsal-cancel','type':'button','value':'','disabled':False,'visible':False},
      {'id':'npc-rehearsal-fill','type':'button','value':'','disabled':True,'visible':False}]

# Read-only evidence from the exact list and its direct rows. Never clone,
# rewrite, remove or temporarily hide live nodes to derive old message evidence.
MESSAGE_ROWS_SAMPLE_JS=r'''() => {
 const list=document.querySelector('#space-message-list');
 const rows=list?[...list.children]:[];
 return {count:document.querySelectorAll('#space-message-list').length,html:list?.innerHTML,text:list?.innerText,
  rows:rows.filter(row=>row.matches('article.space-message')).map(row=>({html:row.outerHTML,text:row.innerText,key:row.getAttribute('data-message-id'),
   direct:row.parentElement===list,children:[...row.children].map(e=>({html:e.outerHTML,text:e.innerText})),
   controls:[...row.querySelectorAll('input,select,textarea,button')].map(e=>({tag:e.tagName,type:e.type,disabled:e.disabled,text:e.textContent}))}))};
}'''


def exact_copied_data(actual, expected):
    """DOM witness counts, booleans and field sets are never interchangeable."""
    if type(actual) is not type(expected): return False
    if type(actual) is dict:
        return actual.keys()==expected.keys() and all(exact_copied_data(actual[key],expected[key]) for key in actual)
    if type(actual) is list:
        return len(actual)==len(expected) and all(exact_copied_data(a,b) for a,b in zip(actual,expected))
    return actual==expected


def dom_text(value):
    return escape(value,quote=False).replace('\xa0','&nbsp;')


def game_message_time(at):
    assert type(at) in (int,float) and math.isfinite(at) and 0<=at<=1e12
    days,remaining=divmod(math.floor(at),86400);hours,remaining=divmod(remaining,3600);minutes,seconds=divmod(remaining,60)
    return '游戏 '+(f'{days} 天 {hours} 小时' if days else f'{hours} 小时 {minutes} 分' if hours else f'{minutes} 分 {seconds} 秒' if minutes else f'{seconds} 秒')


def ordered_text_projection(text,parts):
    """Preserve exact native paragraph gaps while projecting identified rows."""
    cursor=0;result=''
    for index,(native,prior) in enumerate(parts):
        assert native
        gap=''
        if index:
            while cursor<len(text) and text[cursor]=='\n':gap+='\n';cursor+=1
            assert gap in ('\n','\n\n')
        assert text.startswith(native,cursor)
        cursor+=len(native);result+=gap+prior
    assert cursor==len(text)
    return result


def assert_message_rows(evidence,messages,current=True):
    """Bind every full row to exact state identity/order/data before projection."""
    assert type(evidence['count']) is int and evidence['count']==1 and len(evidence['rows'])==len(messages)
    assert len({message['id'] for message in messages})==len(messages)
    old_html=[];projected=[]
    for row,message in zip(evidence['rows'],reversed(messages)):
        assert row['direct'] is True
        time=game_message_time(message['at']);body=message['text']
        parts=[f'<small>{dom_text(time)}</small>',f'<p>{dom_text(body)}</p>']
        child_texts=[time,body];controls=[]
        if current:
            assert set(message)=={'id','at','text','npcScoutSnapshot'}
            typed=message['npcScoutSnapshot'];is_scout=typed is not None or message['id'].startswith('scout-')
            if is_scout:
                notice=UNAVAILABLE if typed is None else f"历史情报，之后可能变化 · 抵达时间 {typed['observedAt']} 秒 · {typed['model']}"
                parts.append(f'<p class="muted">{dom_text(notice)}</p>');child_texts.append(notice)
            if typed is not None:
                parts.append(f'<button type="button">{OPEN_REHEARSAL}</button>');child_texts.append(OPEN_REHEARSAL)
                controls=[{'tag':'BUTTON','type':'button','disabled':False,'text':OPEN_REHEARSAL}]
            assert row['key']==(message['id'] if is_scout else None)
            opening=f'<article class="space-message" data-message-id="{escape(message["id"],quote=True)}">' if is_scout else '<article class="space-message">'
        else:
            assert set(message)=={'id','at','text'} and row['key'] is None
            opening='<article class="space-message">'
        assert exact_copied_data(row['controls'],controls) and row['html']==opening+''.join(parts)+'</article>'
        assert exact_copied_data(row['children'],[{'html':html,'text':text} for html,text in zip(parts,child_texts)])
        ordered_text_projection(row['text'],[(text,text) for text in child_texts])
        # The complete, verified first two native children survive unchanged.
        end=row['text'].find(body,len(time)) if body else len(time)
        assert end>=len(time)
        legacy_text=row['text'][:end+len(body)]
        old_html.append('<article class="space-message">'+''.join(parts[:2])+'</article>')
        projected.append((row['text'],legacy_text))
    if messages:
        assert evidence['html']==''.join(row['html'] for row in evidence['rows'])
        return ''.join(old_html),ordered_text_projection(evidence['text'],projected)
    assert evidence['html']=='<p class="muted">尚无航行记录。</p>' and evidence['text']=='尚无航行记录。'
    return evidence['html'],evidence['text']

SAMPLE_JS=r'''() => {
 const panel=[...document.querySelectorAll('[data-tab-panel]')].find(e=>!e.hidden),tab=panel.dataset.tabPanel;
 const visible=e=>{for(let a=e;a;a=a.parentElement){if(a.hidden||getComputedStyle(a).display==='none')return false;if(a instanceof HTMLDetailsElement&&!a.open&&!a.firstElementChild?.contains(e))return false;}return e.getClientRects().length>0;};
 const inputs=[...panel.querySelectorAll('input,select,textarea,button')].filter(visible);
 const result={tab,panelHTML:panel.outerHTML};
 if(tab==='shipyard'||tab==='defense'){
  // Bind the one complete introductory paragraph to the native panel head,
  // queue, card grid and status siblings, never to a text search.
  const children=[...panel.children],head=children[0],intro=head?.nextElementSibling,queue=intro?.nextElementSibling,
   grid=queue?.nextElementSibling,status=grid?.nextElementSibling,suffix=tab==='defense'?'-def':'';
  result.intro=intro?.innerText;
  result.introBoundary={
   counts:{children:children.length,blurbs:panel.querySelectorAll('p.blurb').length,heads:panel.querySelectorAll('.panel-head').length,
    queues:panel.querySelectorAll('.queue-panel').length,grids:panel.querySelectorAll('.bld-grid').length,
    statuses:panel.querySelectorAll(`[data-bind="status-${tab}"]`).length},
   exactOrder:panel.matches(`section.tab-panel[data-tab-panel="${tab}"][aria-labelledby="${tab}-title"]`)&&
    head?.matches('div.panel-head')&&head.parentElement===panel&&head.children.length===2&&
    head.firstElementChild?.matches(`h2#${tab}-title`)&&
    head.lastElementChild?.matches(`p[data-bind="${tab==='shipyard'?'shipyard-summary':'defense-silo'}"]`)&&
    intro?.matches('p.blurb')&&intro.parentElement===panel&&
    queue?.matches('div.queue-panel')&&queue.parentElement===panel&&
    queue.querySelectorAll(`ol.queue-list[data-bind="squeue-list${suffix}"]`).length===1&&
    grid?.matches('div.bld-grid')&&grid.parentElement===panel&&
    status?.matches(`p.status[data-bind="status-${tab}"][role="status"]`)&&status.parentElement===panel&&panel.lastElementChild===status,
   introHTML:intro?.outerHTML};
 }
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
  const notice=panel.querySelector('#npc-rehearsal-draft-notice');result.rehearsalNotice=notice?{count:document.querySelectorAll('#npc-rehearsal-draft-notice').length,html:notice.outerHTML,hidden:notice.hidden,visible:visible(notice),exactOrder:notice.previousElementSibling?.id==='formation-dispatch-source'&&notice.nextElementSibling?.id==='fleet-formations'}:null;
  result.clear=clear?{hidden:clear.hidden,text:clear.textContent,visible:visible(clear),index:inputs.indexOf(clear)}:null;
 }
 if(tab==='messages'){
  const list=panel.querySelector('#space-message-list'),head=panel.querySelector('.panel-head'),rules=panel.querySelector('.npc-battle-rules'),reports=panel.querySelector('#npc-battle-reports'),rehearsal=panel.querySelector('#npc-rehearsal-panel');
  const source=list??panel,rows=[...source.children];
  result.current=!!list;result.messageHTML=source.innerHTML;result.messageText=source.innerText;
  result.messages={count:list?document.querySelectorAll('#space-message-list').length:document.querySelectorAll('[data-tab-panel="messages"]').length,html:source.innerHTML,text:source.innerText,
   rows:rows.filter(row=>row.matches('article.space-message')).map(row=>({html:row.outerHTML,text:row.innerText,key:row.getAttribute('data-message-id'),direct:row.parentElement===source,
    children:[...row.children].map(e=>({html:e.outerHTML,text:e.innerText})),controls:[...row.querySelectorAll('input,select,textarea,button')].map(e=>({tag:e.tagName,type:e.type,disabled:e.disabled,text:e.textContent}))}))};
  if(list)result.addition={counts:{panels:document.querySelectorAll('#space-messages').length,lists:document.querySelectorAll('#space-message-list').length,titles:document.querySelectorAll('#space-messages-title').length,reports:document.querySelectorAll('#npc-battle-reports').length,rules:document.querySelectorAll('.npc-battle-rules').length},headHTML:head.outerHTML,heading:head.querySelector('h2').textContent,origin:head.querySelector('.space-location').textContent,headText:head.innerText,intro:head.nextElementSibling.textContent,
   title:rehearsal?.nextElementSibling.textContent,history:rehearsal?.nextElementSibling.nextElementSibling.textContent,rulesText:rules.querySelector('p').textContent,summary:rules.querySelector('summary').textContent,closed:!rules.open,reportHTML:reports.innerHTML,
   exactOrder:panel.children.length===8&&panel.children[0]===head&&panel.children[2]===list&&panel.children[3]===rehearsal&&panel.children[6]===rules&&panel.children[7]===reports,
   rehearsal:rehearsal?{count:document.querySelectorAll('#npc-rehearsal-panel').length,html:rehearsal.outerHTML,hidden:rehearsal.hidden,visible:visible(rehearsal),
    exactIds:[...rehearsal.querySelectorAll('[id]')].every(e=>document.querySelectorAll('#'+e.id).length===1),
    controls:[...rehearsal.querySelectorAll('input,select,textarea,button')].map(e=>({id:e.id,type:e.type,value:e.value,disabled:e.disabled,visible:visible(e)}))}:null};
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
    assert side in ('before','after') and snapshot['tab']==evidence['tab'] in ('shipyard','defense','galaxy','fleet','messages')
    out=deepcopy(snapshot);after=side=='after';tab=snapshot['tab']
    if after:
        assert state['npcBattles']=={'model':'npc-battle-receipts-v1','reports':[]}
        assert state['npcEconomy']['sites']=={},'Base has no materialized targets'
        for planet in state['planets']:
            assert planet.get('npcResourceRemainder')=={'metal':'0','crystal':'0','deuterium':'0'},'Zero-rights historical UI only; never hide a positive entitlement'
    if tab in UNIT_PANEL_COPY:
        paragraph=UNIT_PANEL_COPY[tab][side];node=f'<p class="blurb">{paragraph}</p>'
        assert evidence['intro']==paragraph
        assert evidence['introBoundary']=={
            'counts':{'children':5,'blurbs':1,'heads':1,'queues':1,'grids':1,'statuses':1},
            'exactOrder':True,'introHTML':node}
        # Assert both old/current complete literals and unique native nodes.
        # Only copied strings change; every card, cost, timer and control stays.
        assert evidence['panelHTML'].count(node)==1
        assert out['text'].count(paragraph)==1
        out['unitPanelInvariantDOM']=replace_once(evidence['panelHTML'],node,
            '<p class="blurb">'+UNIT_PANEL_COPY[tab]['before']+'</p>')
        out['text']=replace_once(out['text'],paragraph,UNIT_PANEL_COPY[tab]['before'])
    elif tab=='galaxy':
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
            assert exact_copied_data(evidence['rehearsalNotice'],{'count':1,'html':DRAFT_NOTICE_HTML,'hidden':True,'visible':False,'exactOrder':True})
            assert evidence['clear']=={'hidden':True,'text':'清空货物草稿','visible':False,'index':-1}
            out['text']=replace_once(out['text'],evidence['selectText'],'\n'.join(label for _,label in MISSION_OPTIONS))
        else:assert evidence['hiddenAttack'] is None and evidence['clear'] is None and evidence['rehearsalNotice'] is None
    else:
        assert evidence['current'] is after and not out['inputs']
        if after:assert all('npcScoutSnapshot' in message and message['npcScoutSnapshot'] is None for message in state['messages']), 'Historical parity cannot project real typed observations'
        assert evidence['messageHTML']==evidence['messages']['html'] and evidence['messageText']==evidence['messages']['text']
        historical_html,historical_text=assert_message_rows(evidence['messages'],state['messages'],after)
        if after:
            a=evidence['addition'];home=next(p for p in state['planets'] if p['id']==state['activePlanetId']);c=home['coordinates']
            origin=f"{home['name']} [{c['galaxy']}:{c['system']}:{c['position']}]"
            assert exact_copied_data(a['counts'],{'panels':1,'lists':1,'titles':1,'reports':1,'rules':1})
            assert a['headHTML']==f'<div class="panel-head"><h2 id="space-messages-title">航行消息</h2><p class="space-location">{dom_text(origin)}</p></div>'
            assert evidence['panelHTML']==initial_message_panel_html(origin,evidence['messageHTML'])
            assert a['heading']=='航行消息' and a['origin']==origin and a['intro']==INTRO
            assert a['title']=='NPC 轨道战报' and a['history']==HISTORY and a['rulesText']==RULES and a['summary']=='战斗规则'
            assert a['closed'] and a['reportHTML']=='' and a['exactOrder']
            assert exact_copied_data(a['rehearsal'],{'count':1,'html':initial_rehearsal_html(),'hidden':True,'visible':False,'exactIds':True,'controls':initial_rehearsal_controls()})
            parts_exact(a['headText'],['航行消息',origin])
            parts_exact(out['text'],[a['headText'],INTRO,evidence['messageText'],'NPC 轨道战报',HISTORY,'战斗规则'])
            out['text']=historical_text
        else:assert out['text']==evidence['messageText']
        # The paired old/current assertion compares every original message node.
        out['historicalMessageHTML']=historical_html
    return out
