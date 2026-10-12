"""Exact copied-evidence r14 display delta on the unchanged no-attack base.
No browser writes, arbitrary message deletion, or generic text/control filtering.
"""
from copy import deepcopy
from html import escape
import math
LAB_BLOCKER_BINDINGS = ('research-lab-blockers', 'research-lab-blockers-summary',
    'research-lab-blockers-headline', 'research-lab-blockers-protection',
    'research-lab-blockers-note', 'research-lab-blockers-list')
EMPTY_LAB_BLOCKERS_HTML = '''<details class="research-lab-blockers" data-bind="research-lab-blockers" hidden="">
    <summary data-bind="research-lab-blockers-summary"><span data-bind="research-lab-blockers-headline"></span><span data-bind="research-lab-blockers-protection" hidden=""></span></summary>
    <p data-bind="research-lab-blockers-note"></p>
    <ul data-bind="research-lab-blockers-list" data-key="[]"></ul>
  </details>'''
RESEARCH_INTRO_HTML = '<p class="blurb">整个帝国同一时间只研究 1 项，研究队列长度与建造队列相同。成本 ⌊基础×2^(L−1)⌋（天体物理学 ×1.75 并取整到百位），研究时间 = (金属+晶体)/(1000·(1+研究实验室等级)) 小时 ÷ 研究速度。研究进行中不能升级研究实验室，研究实验室升级中也不能开始研究。前置只看已完成的等级。</p>'


def normalize_empty_lab_blockers(panel_html, evidence, state, side):
    """Only the exact empty addition in the fixed old research parity fixture.

    Busy or protected states are never projected away. Complete source DOM is
    archived by the caller, and every remaining byte stays in the comparison.
    """
    assert side in ('before', 'after')
    assert state['planets'] and all(
        all(job['building'] != 'research_lab' for job in planet['buildQueue']) and
        (planet.get('demolition') is None or planet['demolition']['building'] != 'research_lab')
        for planet in state['planets']), 'Cannot hide any paid lab work, including queue tails'
    after = side == 'after'
    expected = {
        'count': int(after), 'prefixCount': 6 if after else 0,
        'bindingCounts': {key: int(after) for key in LAB_BLOCKER_BINDINGS},
        'addition': None,
    }
    if after:
        addition = evidence['addition']
        assert addition is not None
        queue_html = addition['queueHTML']
        assert queue_html.startswith('<div class="queue-panel">') and queue_html.endswith('</div>')
        assert queue_html.count('data-bind="rqueue-list"') == 1
        expected['addition'] = {
            'html': EMPTY_LAB_BLOCKERS_HTML, 'hidden': True, 'open': False, 'visible': False,
            'exactPlacement': True, 'children': 3, 'summaryChildren': 2, 'controls': 0,
            'introHTML': RESEARCH_INTRO_HTML, 'queueHTML': queue_html,
        }
    assert exact_copied_data(evidence, expected), 'Exact unique empty, hidden, closed lab disclosure required'
    if not after:
        assert 'research-lab-blockers' not in panel_html
        return panel_html
    assert panel_html.count(EMPTY_LAB_BLOCKERS_HTML) == 1
    assert panel_html.count('research-lab-blockers') == 7
    assert panel_html.count(RESEARCH_INTRO_HTML) == 1
    assert panel_html.count(queue_html) == 1
    # Keep the original queue's leading template whitespace byte-for-byte.
    # Bind to both actual siblings before removing only this approved addition
    # and its one newly introduced line, never arbitrary details or content.
    region = RESEARCH_INTRO_HTML + '\n        ' + EMPTY_LAB_BLOCKERS_HTML + '\n        \n      ' + queue_html
    assert panel_html.count(region) == 1, 'Lab disclosure must be directly between research intro and queue'
    return panel_html.replace(region, RESEARCH_INTRO_HTML + '\n        \n      ' + queue_html, 1)


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
OPEN_COMPARISON='历史对照'
REHEARSAL_OPENER_HTML=f'<button type="button">{OPEN_REHEARSAL}</button>'
COMPARISON_OPENER_HTML=f'<button type="button" data-npc-scout-comparison="">{OPEN_COMPARISON}</button>'
COMPARISON_NOTICE_HTML='<p id="npc-scout-comparison-notice" class="muted" role="status" aria-live="polite" hidden=""></p>'
FLYING_SHIPS=[('small_cargo','小型运输舰'),('large_cargo','大型运输舰'),('light_fighter','轻型战斗机'),
 ('heavy_fighter','重型战斗机'),('cruiser','巡洋舰'),('battleship','战列舰'),('battlecruiser','战列巡洋舰'),
 ('bomber','轰炸机'),('destroyer','毁灭者'),('deathstar','死星'),('recycler','回收船'),
 ('espionage_probe','间谍卫星'),('colony_ship','殖民船')]
# The dedicated class must not join the shared .space-status renderer.
DRAFT_NOTICE_HTML='<p id="npc-rehearsal-draft-notice" class="npc-rehearsal-draft-notice muted" role="status" hidden=""></p>'
# Independent closed-state literals for the only formation-copy addition.
# The complete panel comparison binds their one position, every ID and all
# hidden content; the control witness also binds native disabled/value state.
REHEARSAL_FORMATION_CONTROLS_HTML='<div class="space-controls"><label for="npc-rehearsal-formation">保存编成<select id="npc-rehearsal-formation" aria-label="保存编成" disabled=""><option value="">选择命名编成</option></select></label><button id="npc-rehearsal-copy" type="button" disabled="">填入演练数量</button></div>'
REHEARSAL_FORMATION_SOURCE_HTML='<p id="npc-rehearsal-formation-source" class="muted"></p>'
REHEARSAL_FORMATION_DEFICITS_HTML='<details id="npc-rehearsal-deficits"><summary id="npc-rehearsal-deficit-summary">数量与当前停泊库存</summary><div id="npc-rehearsal-deficit-body" class="npc-report-details"></div></details>'


def initial_rehearsal_html():
    """Literal independent initially closed UI contract; no source import/parse."""
    ships=''.join(f'<label class="space-ship"><span>{name}<small id="npc-rehearsal-stock-{ident}"></small></span><input id="npc-rehearsal-ship-{ident}" type="number" min="0" max="1000000000000" step="1" value="0" aria-label="{name}演练数量" disabled=""></label>' for ident,name in FLYING_SHIPS)
    options=''.join(f'<option value="{n}">{n}%</option>' for n in range(100,0,-10))
    return f'''<section id="npc-rehearsal-panel" class="ov-card" aria-labelledby="npc-rehearsal-title" hidden="">
    <h3 id="npc-rehearsal-title" tabindex="-1">历史侦察演练</h3>
    <p id="npc-rehearsal-source" class="muted"></p><p id="npc-rehearsal-origin" class="chip"></p>
    <details id="npc-rehearsal-history"><summary>侦察抵达时的精确情报</summary><div id="npc-rehearsal-history-body" class="npc-report-details"></div></details>
    <p class="muted">仅选择当前星球已停泊舰船。演练不派遣、不付款；排队建造与研究不计入。</p>
    {REHEARSAL_FORMATION_CONTROLS_HTML}
    {REHEARSAL_FORMATION_SOURCE_HTML}
    {REHEARSAL_FORMATION_DEFICITS_HTML}
    <div class="space-ships">{ships}</div>
    <div class="space-controls"><label>草稿速度<select id="npc-rehearsal-speed" disabled="">{options}</select></label>
    <button id="npc-rehearsal-run" type="button" disabled="">运行三个公开种子示例</button><button id="npc-rehearsal-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-rehearsal-status" class="space-error" role="status" aria-live="polite"></p>
    <div id="npc-rehearsal-results" hidden=""></div>
    <p id="npc-rehearsal-fill-explanation" class="muted">填入会替换舰队草稿的任务、目标、全部 13 类舰船数量、速度和货物（全部清零），保留当前所选星球。之后仍需单独点击付费出征。</p>
    <button id="npc-rehearsal-fill" type="button" aria-describedby="npc-rehearsal-fill-explanation" disabled="">填入攻击草稿（空载）</button>
  </section>'''


def initial_comparison_html():
    """Independent constructor literal, before any navigation closes the UI."""
    return '''<section id="npc-scout-comparison-panel" class="ov-card npc-scout-comparison" aria-labelledby="npc-scout-comparison-title" hidden="">
    <h3 id="npc-scout-comparison-title" tabindex="-1">历史侦察对照</h3>
    <p id="npc-scout-comparison-source" class="chip"></p>
    <label for="npc-scout-comparison-other">同坐标的另一份报告<select id="npc-scout-comparison-other" disabled=""><option value="">请明确选择一份报告</option></select></label>
    <div class="space-controls"><button id="npc-scout-comparison-run" type="button" disabled="">查看差值</button><button id="npc-scout-comparison-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-scout-comparison-status" class="muted" role="status" aria-live="polite"></p>
    <p id="npc-scout-comparison-warning" class="muted">只是两次观察差，不代表净产量、战利品或当前库存。</p>
    <div id="npc-scout-comparison-results" hidden=""></div>
  </section>'''


def closed_comparison_html():
    """Exact post-navigation state: close -> abandon clears options, sets status.

    The render parity trace visits other tabs before messages. It must match
    this one complete closed state, never either constructor/closed on demand.
    """
    return '''<section id="npc-scout-comparison-panel" class="ov-card npc-scout-comparison" aria-labelledby="npc-scout-comparison-title" hidden="">
    <h3 id="npc-scout-comparison-title" tabindex="-1">历史侦察对照</h3>
    <p id="npc-scout-comparison-source" class="chip"></p>
    <label for="npc-scout-comparison-other">同坐标的另一份报告<select id="npc-scout-comparison-other" disabled=""></select></label>
    <div class="space-controls"><button id="npc-scout-comparison-run" type="button" disabled="">查看差值</button><button id="npc-scout-comparison-cancel" type="button">取消 / 返回消息</button></div>
    <p id="npc-scout-comparison-status" class="muted" role="status" aria-live="polite">对照已关闭；请从当前保留的侦察消息重新打开。</p>
    <p id="npc-scout-comparison-warning" class="muted">只是两次观察差，不代表净产量、战利品或当前库存。</p>
    <div id="npc-scout-comparison-results" hidden=""></div>
  </section>'''


def initial_comparison_controls():
    return [
      {'id':'npc-scout-comparison-other','type':'select-one','value':'','disabled':True,'visible':False},
      {'id':'npc-scout-comparison-run','type':'button','value':'','disabled':True,'visible':False},
      {'id':'npc-scout-comparison-cancel','type':'button','value':'','disabled':False,'visible':False}]


# The whole two-opener shape is checked before any legacy browser action can
# select the original rehearsal opener. This is a read-only DOM witness.
MESSAGE_OPENERS_SAMPLE_JS=r'''row => ({children:row.children.length,
 controls:[...row.querySelectorAll('input,select,textarea,button')].map(e=>({
  html:e.outerHTML,tag:e.tagName,type:e.type,value:e.value,disabled:e.disabled,
  direct:e.parentElement===row,index:[...row.children].indexOf(e)}))})'''


def typed_message_openers(comparison_disabled=False):
    assert type(comparison_disabled) is bool
    comparison_html=COMPARISON_OPENER_HTML.replace('>',' disabled="">',1) if comparison_disabled else COMPARISON_OPENER_HTML
    return {'children':5,'controls':[
      {'html':REHEARSAL_OPENER_HTML,'tag':'BUTTON','type':'button','value':'','disabled':False,'direct':True,'index':3},
      {'html':comparison_html,'tag':'BUTTON','type':'button','value':'','disabled':comparison_disabled,'direct':True,'index':4}]}


def initial_message_panel_html(origin,message_html):
    """Bind the complete added container, including hidden data and all wrappers."""
    return ('<section id="space-messages" class="tab-panel space-panel" data-tab-panel="messages" aria-labelledby="space-messages-title">'
      +f'<div class="panel-head"><h2 id="space-messages-title">航行消息</h2><p class="space-location">{dom_text(origin)}</p></div>'
      +f'<p class="muted">{INTRO}</p><div id="space-message-list">{message_html}</div>'
      +initial_rehearsal_html()+COMPARISON_NOTICE_HTML+'\n  '+closed_comparison_html()+f'<h3 class="group-title">NPC 轨道战报</h3><p class="muted">{HISTORY}</p>'
      +f'<details class="npc-battle-rules"><summary>战斗规则</summary><p class="muted">{RULES}</p></details>'
      +'<div id="npc-battle-reports"></div></section>')


def initial_rehearsal_controls():
    return [
      {'id':'npc-rehearsal-formation','type':'select-one','value':'','disabled':True,'visible':False},
      {'id':'npc-rehearsal-copy','type':'button','value':'','disabled':True,'visible':False}]+[
      {'id':'npc-rehearsal-ship-'+ident,'type':'number','value':'0','disabled':True,'visible':False} for ident,_ in FLYING_SHIPS]+[
      {'id':'npc-rehearsal-speed','type':'select-one','value':'100','disabled':True,'visible':False},
      {'id':'npc-rehearsal-run','type':'button','value':'','disabled':True,'visible':False},
      {'id':'npc-rehearsal-cancel','type':'button','value':'','disabled':False,'visible':False},
      {'id':'npc-rehearsal-fill','type':'button','value':'','disabled':True,'visible':False}]

# Reviewed 24-unit catalog, independent of the candidate's quote/presenter code.
# This adapter is deliberately limited to the fresh count=1 parity trajectory.
MANUAL_UNIT_CATALOG = (
    ('small_cargo', '小型运输舰', (2000, 2000, 0)),
    ('large_cargo', '大型运输舰', (6000, 6000, 0)),
    ('light_fighter', '轻型战斗机', (3000, 1000, 0)),
    ('heavy_fighter', '重型战斗机', (6000, 4000, 0)),
    ('cruiser', '巡洋舰', (20000, 7000, 2000)),
    ('battleship', '战列舰', (45000, 15000, 0)),
    ('battlecruiser', '战列巡洋舰', (30000, 40000, 15000)),
    ('bomber', '轰炸机', (50000, 25000, 15000)),
    ('destroyer', '毁灭者', (60000, 50000, 15000)),
    ('deathstar', '死星', (5000000, 4000000, 1000000)),
    ('recycler', '回收船', (10000, 6000, 2000)),
    ('espionage_probe', '间谍卫星', (0, 1000, 0)),
    ('solar_satellite', '太阳能卫星', (0, 2000, 500)),
    ('colony_ship', '殖民船', (10000, 20000, 10000)),
    ('rocket_launcher', '火箭发射器', (2000, 0, 0)),
    ('light_laser', '轻型激光炮', (1500, 500, 0)),
    ('heavy_laser', '重型激光炮', (6000, 2000, 0)),
    ('gauss_cannon', '高斯炮', (20000, 15000, 2000)),
    ('ion_cannon', '离子炮', (2000, 6000, 0)),
    ('plasma_turret', '等离子炮塔', (50000, 50000, 30000)),
    ('small_shield_dome', '小型护盾罩', (10000, 10000, 0)),
    ('large_shield_dome', '大型护盾罩', (50000, 50000, 0)),
    ('anti_ballistic_missile', '反弹道导弹', (8000, 0, 2000)),
    ('interplanetary_missile', '星际导弹', (12500, 2500, 10000)),
)
MANUAL_ORIGINAL_BINDINGS = ('ucard', 'uqty', 'ubuild', 'umax', 'ufill', 'ureason')
MANUAL_ADDED_BINDINGS = ('umode-hint', 'uquote', 'utotal', 'upay', 'umanual-reason')
MANUAL_HINT = '建造输入的数量；选择模式只更新报价。'


def _manual_order_html(ident, name, *, current, reason='', maximum='', disabled=False):
    attr_reason = dom_text(reason).replace('"', '&quot;')
    if current:
        quantity = f'<input type="text" value="1" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="{name}数量" aria-describedby="umode-hint-{ident}" data-bind="uqty-{ident}">'
    else:
        quantity = f'<input type="number" min="1" step="1" value="1" inputmode="numeric" aria-label="{name}数量" data-bind="uqty-{ident}">'
    buttons = []
    for mode, bind, label, title in (
        ('count', 'ubuild', '建造', '预览输入数量的整批报价' if current else attr_reason),
        ('max', 'umax', '最大' if current else maximum, '预览按当前资源能造的最大数量' if current else attr_reason),
        ('fill', 'ufill', '补到', '预览补到输入总量的报价（本星已有 + 排队中计入）' if current else '补到输入的数量（已有 + 排队中计入）')):
        pressed = f' aria-pressed="{str(mode == "count").lower()}"' if current else ''
        disabled_attr = ' disabled=""' if disabled and not current else ''
        action = 'manual-unit-mode' if current else 'build-units'
        buttons.append(f'<button type="button" class="unit-btn" data-action="{action}" data-mode="{mode}"{pressed} data-id="{ident}" data-bind="{bind}-{ident}" title="{title}"{disabled_attr}>{label}</button>')
    return '<div class="unit-order">\n          ' + '\n          '.join([quantity, *buttons]) + '\n        </div>'


def _manual_added_html(ident, summary, total, reason, disabled):
    disabled_attr = ' disabled=""' if disabled else ''
    return (f'<p class="muted unit-mode-hint" id="umode-hint-{ident}" data-bind="umode-hint-{ident}">{MANUAL_HINT}</p>\n        '
        '<div class="unit-confirm">\n          '
        f'<p class="btn-cost unit-quote" data-bind="uquote-{ident}">{dom_text(summary)}</p>\n          '
        f'<p class="btn-cost unit-total" data-bind="utotal-{ident}">{total}</p>\n          '
        f'<button type="button" class="unit-btn unit-pay" data-action="manual-unit-pay" data-id="{ident}" data-bind="upay-{ident}"{disabled_attr}>支付并入队</button>\n        </div>\n        '
        f'<p class="btn-cost unit-reason" data-bind="umanual-reason-{ident}" role="status">{dom_text(reason)}</p>')


def _manual_input(current=False):
    return {'id': '', 'action': None, 'type': 'text' if current else 'number', 'value': '1',
            'disabled': False, 'checked': False, 'text': None}


def _manual_button(text, disabled=False, current=False, pay=False):
    return {'id': '', 'action': 'manual-unit-pay' if pay else 'manual-unit-mode' if current else 'build-units',
            'type': 'button', 'value': '', 'disabled': disabled, 'checked': None, 'text': text}


def _assert_manual_identity(evidence, current):
    assert set(evidence['manualUnits']) == {'identity', 'cards'}
    ids = [item[0] for item in MANUAL_UNIT_CATALOG]
    assert len(ids) == len(set(ids)) == 24
    expected = {
        'panels': {'shipyard': 1, 'defense': 1},
        'bindings': {prefix: [f'{prefix}-{ident}' for ident in ids] if current or prefix in MANUAL_ORIGINAL_BINDINGS else []
                     for prefix in (*MANUAL_ORIGINAL_BINDINGS, *MANUAL_ADDED_BINDINGS)},
        'actions': {'build-units': 0 if current else 72, 'manual-unit-mode': 72 if current else 0,
                    'manual-unit-pay': 24 if current else 0},
        'hintIds': [f'umode-hint-{ident}' for ident in ids] if current else [],
    }
    assert exact_copied_data(evidence['manualUnits']['identity'], expected), 'Unique, ordered 24-unit native identity required'


def normalize_manual_unit_display(snapshot, evidence, state, side, legacy=None):
    """Exact old controls -> fresh count=1 quote delta, copied evidence only.

    The historical pair supplies the actual original eligibility/max/reason,
    never a candidate-derived substitute. Both sides' full original controls
    are bound before projection. Catalog prices are literal independent data.
    Every remaining card byte/text/control and all queue/status data survives.
    This cannot accept a revisited, stale, protected or changed-quantity quote.
    """
    assert side in ('before', 'after') and snapshot['tab'] == evidence['tab'] in ('shipyard', 'defense')
    current = side == 'after'
    _assert_manual_identity(evidence, current)
    if current:
        assert legacy is not None and set(legacy) == {'snapshot', 'evidence'}
        normalize_manual_unit_display(legacy['snapshot'], legacy['evidence'], state, 'before')
        assert legacy['snapshot']['tab'] == snapshot['tab']
    else:
        assert legacy is None
    out, copied = deepcopy(snapshot), deepcopy(evidence)
    catalog = MANUAL_UNIT_CATALOG[:14] if snapshot['tab'] == 'shipyard' else MANUAL_UNIT_CATALOG[14:]
    rows = evidence['manualUnits']['cards']
    assert len(rows) == len(catalog)
    replacements = []
    home = next(planet for planet in state['planets'] if planet['id'] == state['activePlanetId'])
    coord = home['coordinates']
    summary = f"当前星球 {home['name']} [{coord['galaxy']}:{coord['system']}:{coord['position']}] · 本次新增 1"
    last_index = -1
    for number, (row, (ident, name, price)) in enumerate(zip(rows, catalog)):
        old = legacy['evidence']['manualUnits']['cards'][number] if current else row
        assert set(row) == {'id', 'html', 'text', 'children', 'placement', 'orderHTML', 'orderText', 'reasonHTML', 'reasonText', 'additionHTML', 'quoteVisible', 'controls'}
        assert row['id'] == ident
        assert type(row['children']) is int and row['children'] == (12 if current else 9)
        assert row['placement'] is True
        assert exact_copied_data(row['quoteVisible'], [True, True, True] if current else None)
        assert row['reasonHTML'] == f'<p class="btn-cost unit-reason" data-bind="ureason-{ident}">{dom_text(row["reasonText"])}</p>'
        assert row['reasonText'] and row['html'].count(row['reasonHTML']) == 1
        controls = row['controls']
        assert len(controls) == (5 if current else 4)
        disabled = old['controls'][1]['snapshot']['disabled']
        assert type(disabled) is bool
        maximum = old['controls'][2]['snapshot']['text']
        # Historical labels are part of that native oracle, never max=39 for
        # every unit or a value copied out of the new fixed-label buttons.
        assert type(maximum) is str and maximum.startswith('最大 ')
        amount = maximum[3:].replace(',', '')
        assert amount.isascii() and amount.isdecimal() and str(int(amount)) == amount
        assert maximum == f'最大 {int(amount):,}' and 0 <= int(amount) <= 1000000
        assert (int(amount) == 0) is disabled
        reason = old['reasonText']
        assert (reason == f'可造 {int(amount):,}') is (not disabled)
        assert row['reasonText'] == reason
        expected_controls = [_manual_input(current)] + [
            _manual_button(label, False if current else disabled, current)
            for label in ('建造', '最大' if current else maximum, '补到')]
        if current:
            expected_controls.append(_manual_button('支付并入队', disabled, pay=True))
        for offset, (control, expected) in enumerate(zip(controls, expected_controls)):
            assert set(control) == {'index', 'native', 'visible', 'snapshot'}
            index = control['index']
            assert type(index) is int and index > last_index
            if offset: assert index == controls[0]['index'] + offset
            last_index = index
            assert control['native'] is True and control['visible'] is True
            assert exact_copied_data(control['snapshot'], expected)
            assert index < len(out['inputs']) and exact_copied_data(out['inputs'][index], expected)
        expected_order = _manual_order_html(ident, name, current=current, reason=reason, maximum=maximum, disabled=disabled)
        assert row['orderHTML'] == expected_order
        assert row['orderText'] == '\n'.join(['建造', '最大' if current else maximum, '补到'])
        old_region = old['orderHTML'] + '\n        ' + old['reasonHTML']
        if current:
            total = ' · '.join(f'{label} {value:,}' for label, value in zip(('金属', '晶体', '重氢'), price))
            manual_reason = reason if disabled else ''
            expected_addition = _manual_added_html(ident, summary, total, manual_reason, disabled)
            assert row['additionHTML'] == expected_addition, 'Complete fresh quote, full canonical price, one pay button and exact reason required'
            new_region = expected_order + '\n        ' + expected_addition + '\n        ' + row['reasonHTML']
            # Bind the literal changed region to its exact card before touching
            # copied full-panel HTML. Retain all unrelated bytes for comparison.
            assert row['html'].count(new_region) == 1
            projected_card = replace_once(row['html'], new_region, old_region)
            assert projected_card == old['html'], 'Every remaining original card DOM byte must match'
            copied['panelHTML'] = replace_once(copied['panelHTML'], row['html'], projected_card)
            assert row['text'].count(row['orderText']) == 1 and old['text'].count(old['orderText']) == 1
            prefix, tail = row['text'].split(row['orderText'])
            old_prefix, old_tail = old['text'].split(old['orderText'])
            assert prefix == old_prefix, 'Every original non-control card text byte must match'
            # Native block/grid layout may emit one or two linebreaks; no text
            # or whitespace outside this complete approved tail is normalized.
            ordered_text_projection(row['orderText'] + tail, [(part, part) for part in [row['orderText'], MANUAL_HINT, summary, total, '支付并入队', *([manual_reason] if manual_reason else []), reason]])
            out['text'] = replace_once(out['text'], row['text'], prefix + old['orderText'] + old_tail)
            replacements.append((controls[0]['index'], controls[-1]['index'] + 1,
                                 [deepcopy(control['snapshot']) for control in old['controls']]))
        else:
            assert row['additionHTML'] is None and row['html'].count(old_region) == 1
            assert row['html'].count(row['orderHTML']) == 1
            assert row['text'].count(row['orderText']) == 1
            prefix, tail = row['text'].split(row['orderText'])
            assert prefix
            parts_exact(row['orderText'] + tail, [row['orderText'], reason])
        assert evidence['panelHTML'].count(row['html']) == 1
        assert snapshot['text'].count(row['text']) == 1
    for start, stop, original in reversed(replacements):
        out['inputs'][start:stop] = original
    if current:
        assert len(out['inputs']) == len(legacy['snapshot']['inputs']), 'Only one added payment per card changes control count'
    return out, copied


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


def ordered_text_projection(text,parts,adjacent_button_boundary=None):
    """Preserve exact native paragraph gaps while projecting identified rows."""
    cursor=0;result=''
    for index,(native,prior) in enumerate(parts):
        assert native
        gap=''
        if index:
            while cursor<len(text) and text[cursor]=='\n':gap+='\n';cursor+=1
            allowed=('', '\n', '\n\n') if index==adjacent_button_boundary else ('\n','\n\n')
            assert gap in allowed
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
                parts.extend([REHEARSAL_OPENER_HTML,COMPARISON_OPENER_HTML]);child_texts.extend([OPEN_REHEARSAL,OPEN_COMPARISON])
                controls=[{'tag':'BUTTON','type':'button','disabled':False,'text':text} for text in (OPEN_REHEARSAL,OPEN_COMPARISON)]
            assert row['key']==(message['id'] if is_scout else None)
            opening=f'<article class="space-message" data-message-id="{escape(message["id"],quote=True)}">' if is_scout else '<article class="space-message">'
        else:
            assert set(message)=={'id','at','text'} and row['key'] is None
            opening='<article class="space-message">'
        assert exact_copied_data(row['controls'],controls) and row['html']==opening+''.join(parts)+'</article>'
        assert exact_copied_data(row['children'],[{'html':html,'text':text} for html,text in zip(parts,child_texts)])
        # Only the verified new adjacent button pair may be inline. Original
        # paragraphs and all other row/list boundaries keep their strict gaps.
        ordered_text_projection(row['text'],[(text,text) for text in child_texts],
                                4 if len(controls)==2 else None)
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
  const prefixes=['ucard','uqty','ubuild','umax','ufill','ureason','umode-hint','uquote','utotal','upay','umanual-reason'];
  const quoteVisible=e=>{
   if(!e||document.hidden||!visible(e)||![...e.getClientRects()].some(r=>r.width>0&&r.height>0))return false;
   for(let a=e;a;a=a.parentElement){const style=getComputedStyle(a);
    if(a.getAttribute('aria-hidden')==='true'||style.visibility==='hidden'||style.visibility==='collapse'||style.opacity==='0'||style.contentVisibility==='hidden')return false;}
   return true;
  };
  const describe=e=>({index:inputs.indexOf(e),native:e instanceof HTMLInputElement||e instanceof HTMLButtonElement,visible:visible(e),
   snapshot:{id:e.id,action:e.dataset.action??e.dataset.space??null,type:e.type,value:e.value,disabled:e.disabled,checked:e.checked??null,text:e.tagName==='BUTTON'?e.textContent:null}});
  result.manualUnits={identity:{
   panels:Object.fromEntries(['shipyard','defense'].map(t=>[t,document.querySelectorAll(`[data-tab-panel="${t}"]`).length])),
   bindings:Object.fromEntries(prefixes.map(prefix=>[prefix,[...document.querySelectorAll(`[data-bind^="${prefix}-"]`)].map(e=>e.dataset.bind)])),
   actions:Object.fromEntries(['build-units','manual-unit-mode','manual-unit-pay'].map(action=>[action,document.querySelectorAll(`[data-action="${action}"]`).length])),
   hintIds:[...document.querySelectorAll('[id^="umode-hint-"]')].map(e=>e.id)},
   cards:[...grid.children].map(card=>{
    const children=[...card.children],order=children[7],reason=children.at(-1),addition=children.slice(8,-1),id=card.dataset.bind?.slice(6);
    return {id,html:card.outerHTML,text:card.innerText,children:children.length,
     placement:card.matches('article.bld.unit-card')&&card.parentElement===grid&&children[6]?.matches('details.unit-rf')&&
      order?.matches('div.unit-order')&&order.children.length===4&&reason?.matches(`p.btn-cost.unit-reason[data-bind="ureason-${id}"]`)&&
      (addition.length===0||(addition.length===3&&addition[0].matches(`p.unit-mode-hint[data-bind="umode-hint-${id}"]`)&&
       addition[1].matches('div.unit-confirm')&&addition[1].children.length===3&&addition[2].matches(`p.unit-reason[data-bind="umanual-reason-${id}"]`))),
     orderHTML:order?.outerHTML,orderText:order?.innerText,reasonHTML:reason?.outerHTML,reasonText:reason?.textContent,
     additionHTML:addition.length?addition.map(e=>e.outerHTML).join('\n        '):null,
     quoteVisible:addition.length?[...addition[1].children].map(quoteVisible):null,
     controls:[...card.querySelectorAll('input,select,textarea,button')].map(describe)};
   })};
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
  const comparison=panel.querySelector('#npc-scout-comparison-panel'),comparisonNotice=panel.querySelector('#npc-scout-comparison-notice');
  const source=list??panel,rows=[...source.children];
  result.current=!!list;result.messageHTML=source.innerHTML;result.messageText=source.innerText;
  result.messages={count:list?document.querySelectorAll('#space-message-list').length:document.querySelectorAll('[data-tab-panel="messages"]').length,html:source.innerHTML,text:source.innerText,
   rows:rows.filter(row=>row.matches('article.space-message')).map(row=>({html:row.outerHTML,text:row.innerText,key:row.getAttribute('data-message-id'),direct:row.parentElement===source,
    children:[...row.children].map(e=>({html:e.outerHTML,text:e.innerText})),controls:[...row.querySelectorAll('input,select,textarea,button')].map(e=>({tag:e.tagName,type:e.type,disabled:e.disabled,text:e.textContent}))}))};
  if(list)result.addition={counts:{panels:document.querySelectorAll('#space-messages').length,lists:document.querySelectorAll('#space-message-list').length,titles:document.querySelectorAll('#space-messages-title').length,reports:document.querySelectorAll('#npc-battle-reports').length,rules:document.querySelectorAll('.npc-battle-rules').length},headHTML:head.outerHTML,heading:head.querySelector('h2').textContent,origin:head.querySelector('.space-location').textContent,headText:head.innerText,intro:head.nextElementSibling.textContent,
   title:comparison?.nextElementSibling.textContent,history:comparison?.nextElementSibling.nextElementSibling.textContent,rulesText:rules.querySelector('p').textContent,summary:rules.querySelector('summary').textContent,closed:!rules.open,reportHTML:reports.innerHTML,
   exactOrder:panel.children.length===10&&panel.children[0]===head&&panel.children[2]===list&&panel.children[3]===rehearsal&&panel.children[4]===comparisonNotice&&panel.children[5]===comparison&&panel.children[8]===rules&&panel.children[9]===reports,
   comparisonNotice:comparisonNotice?{count:document.querySelectorAll('#npc-scout-comparison-notice').length,html:comparisonNotice.outerHTML,hidden:comparisonNotice.hidden,visible:visible(comparisonNotice),exactOrder:comparisonNotice.previousElementSibling===rehearsal&&comparisonNotice.nextElementSibling===comparison}:null,
   comparison:comparison?{count:document.querySelectorAll('#npc-scout-comparison-panel').length,html:comparison.outerHTML,hidden:comparison.hidden,visible:visible(comparison),
    exactIds:[...comparison.querySelectorAll('[id]')].every(e=>document.querySelectorAll('#'+e.id).length===1),
    controls:[...comparison.querySelectorAll('input,select,textarea,button')].map(e=>({id:e.id,type:e.type,value:e.value,disabled:e.disabled,visible:visible(e)}))}:null,
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
            assert a['closed'] is True and a['reportHTML']=='' and a['exactOrder'] is True
            assert exact_copied_data(a['rehearsal'],{'count':1,'html':initial_rehearsal_html(),'hidden':True,'visible':False,'exactIds':True,'controls':initial_rehearsal_controls()})
            assert exact_copied_data(a['comparisonNotice'],{'count':1,'html':COMPARISON_NOTICE_HTML,'hidden':True,'visible':False,'exactOrder':True})
            assert exact_copied_data(a['comparison'],{'count':1,'html':closed_comparison_html(),'hidden':True,'visible':False,'exactIds':True,'controls':initial_comparison_controls()})
            parts_exact(a['headText'],['航行消息',origin])
            parts_exact(out['text'],[a['headText'],INTRO,evidence['messageText'],'NPC 轨道战报',HISTORY,'战斗规则'])
            out['text']=historical_text
        else:assert out['text']==evidence['messageText']
        # The paired old/current assertion compares every original message node.
        out['historicalMessageHTML']=historical_html
    return out
