"""Strict read-only projection of the untouched, inactive Energy Challenge panel.

This is a display compatibility adapter, not challenge/native acceptance. It
checks a complete independent markup model against original browser witnesses,
then removes precisely that one verified block from copied evidence. State,
storage, clocks, old controls and other DOM bytes are never normalized here.
"""
from copy import deepcopy
from fractions import Fraction
import hashlib
import json
from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re

DEFAULT = {'model': 'energy-tightening-v1', 'nextAttemptId': 1, 'active': None, 'completion': None}
TITLE = '能源紧缩 · 可选挑战'
SUMMARY = '矿场耗能翻倍。完成后永久解锁第 3 个普通建筑 / 研究总队列槽。'
RULE_TITLE = '规则与读档说明'
RULES = (
    '挑战中，所有星球的矿场耗能 ×2；发电不变。自动曲率不可启用，其它自动化照常运行。',
    '只计挑战开始后，所有星球生产后实际保留的净增量：金属 ×1、晶体 ×3、重氢 ×10。满仓溢出、领取、运输及交易不计分。每次贡献按 10⁻¹² 分向下取整，目标 1,000,000 分。',
    '入场后须实际付款并完成母星的金属矿、晶体矿、重氢合成器和太阳能电站各一次；结束时这四项仍须至少 1 级。',
    '完成仍须达到普通曲率门槛，并手动确认发射。首次完成永久解锁第 3 个普通建筑 / 研究总队列槽；不会自动领奖。',
    '读档保留进行中的限制、分数与完工记录；导入不会额外计分或领奖。完成记录跨普通曲率保留，重新开始归零。',
)
BUTTONS = (('enter', '核对入场并发射'), ('finish', '核对完成并发射'), ('abandon', '核对放弃'),
           ('confirm', '继续，核对最新结果'), ('cancel', '取消核对'))
BUILDINGS = (('metal_mine', '金属矿'), ('crystal_mine', '晶体矿'), ('deuterium_synth', '重氢合成器'), ('solar_plant', '太阳能电站'))
SOURCE_SHA256 = {
    'src/ui/energy-challenge-panel.ts': '7bdd33f26390bb980ced1b26a830f726c5325733f7fd884ee73aa79305048cd5',
    'src/ui/energy-challenge-present.ts': '4f03d524044fc4fbe06ecd03b55591ed1aee6e63c3d418406a0738eb9f265001',
    'src/ui/energy-challenge.css': '02318a51aeb80ada0961303e2734f8608fb26d8ea1c50d856cb0d727895ffed8',
    'src/game/energy-challenge.ts': '31edcd696d330769f2de9704c72d453e6074773b7276fb1040fbfbbe2d2d7ccf',
}
SOURCE_FRAGMENTS = {
    'src/ui/energy-challenge-panel.ts': (
        'panel.setAttribute("aria-labelledby", "energy-challenge-title"); anchor.insertAdjacentElement("afterend", panel);',
        'const reviewPanel = make("section", "review", panel); reviewPanel.hidden = true;',
        'if (!intact() || !visible()) return;',
        'home.hidden = model.phase !== "active"; load.hidden = model.phase !== "active"; checklist.hidden = model.phase !== "active";',
    ),
    'src/ui/space-panel.ts': (
        'const prestigePreview=installPrestigePreview(root);\n  const energyChallengePanel=installEnergyChallengePanel(root,onAction);',
    ),
    'src/main.ts': ('view.updateEnergyChallenge(state, ready, saveSession.message);',),
}


def assert_energy_challenge_source_contract(root=None):
    root = Path(root) if root else Path(__file__).resolve().parents[1]
    hashes = {}
    for name in SOURCE_SHA256.keys() | SOURCE_FRAGMENTS.keys():
        path = root / name
        assert path.is_file() and not path.is_symlink(), 'Ordinary production source required'
        raw = path.read_bytes(); hashes[name] = hashlib.sha256(raw).hexdigest()
        if name in SOURCE_SHA256:
            assert hashes[name] == SOURCE_SHA256[name], 'Unreviewed energy display source drift: ' + name
        for fragment in SOURCE_FRAGMENTS.get(name, ()):
            assert raw.decode().count(fragment) == 1, 'Missing/changed unique energy display contract: ' + name
    return hashes


def _node(tag, name, text='', attrs='', children=''):
    return '<' + tag + ' id="energy-challenge-' + name + '"' + attrs + '>' + escape(text, quote=False) + children + '</' + tag + '>'


def entry_status(state):
    assert type(state['orders']['nextJobId']) is int and 1 <= state['orders']['nextJobId'] <= 2**53 - 1
    if 2**53 - 1 - state['orders']['nextJobId'] < 4:
        return False, '剩余付费任务编号不足以完成母星四项建设，不能进入挑战'
    score = sum(Fraction(state['lifetime'][r]) * w for r, w in zip(('metal', 'crystal', 'deuterium'), (1, 3, 10)))
    score *= Fraction(5, 4) if state['curvature']['score_boost'] > 0 else 1
    return (True, '可手动曲率并进入挑战') if score >= 1000000 else (False, '须达到普通曲率门槛后，手动曲率并进入挑战')


def expected_html(state, painted):
    """Independent exact node/text/attribute model; imports no game renderer."""
    assert json.dumps(state['energyChallenge'], sort_keys=True) == json.dumps(DEFAULT, sort_keys=True)
    eligible, status = entry_status(state)
    home = next((p for p in state['planets'] if p['id'] == 'homeworld'), None)
    home_text = ('母星：' + home['name'] + ' [' + ':'.join(str(home['coordinates'][k]) for k in ('galaxy', 'system', 'position')) + ']') if home else '母星：母星暂不可用'
    def button(name, label):
        attrs = ' type="button"'
        if not (painted and name == 'enter' and eligible): attrs += ' disabled=""'
        if painted and name in ('finish', 'abandon'): attrs += ' hidden=""'
        return _node('button', name, label, attrs)
    content = _node('h3', 'title', TITLE if painted else '', ' tabindex="-1"')
    content += _node('p', 'summary', SUMMARY if painted else '')
    content += _node('p', 'home', home_text if painted else '', ' hidden=""' if painted else '')
    checks = ''.join(_node('li', 'check-' + str(i),
        ('未完成 · ' + label + '：本次尚未付费完工，当前 ' + str(home['buildings'][building] if home else 0) + ' 级') if painted else '',
        ' data-complete="false"' if painted else '') for i, (building, label) in enumerate(BUILDINGS))
    content += _node('ul', 'checklist', attrs=' hidden=""' if painted else '', children=checks)
    content += _node('p', 'load', '读档继续限制与进度；仅手动确认发射可完成。' if painted else '', ' hidden=""' if painted else '')
    content += _node('p', 'status', status if painted else '', ' role="status" aria-live="polite"')
    content += _node('div', 'actions', attrs=' class="energy-challenge-actions"', children=''.join(button(*b) for b in BUTTONS[:3]))
    content += _node('details', 'rules', children=_node('summary', 'rules-title', RULE_TITLE) + ''.join(_node('p', 'rule-' + str(i), rule) for i, rule in enumerate(RULES)))
    review = _node('h3', 'review-title') + _node('p', 'review-summary')
    review += _node('details', 'review-details', children=_node('summary', 'review-details-title', '本次重置、保留与协议卡明细') + _node('ul', 'review-lines'))
    review += _node('p', 'review-notice', '这一步仅核对。继续后将显示最新结果，仍需最后确认。')
    review += _node('div', 'review-actions', attrs=' class="energy-challenge-actions"', children=''.join(button(*b) for b in BUTTONS[3:]))
    content += _node('section', 'review', attrs=' hidden=""', children=review)
    return '<section id="energy-challenge" class="energy-challenge" aria-labelledby="energy-challenge-title">' + content + '</section>'


# Identifier order is fixed by the constructor, independently of native counts.
IDS = ('energy-challenge', 'energy-challenge-title', 'energy-challenge-summary', 'energy-challenge-home',
       'energy-challenge-checklist', *(f'energy-challenge-check-{i}' for i in range(4)), 'energy-challenge-load',
       'energy-challenge-status', 'energy-challenge-actions', *(f'energy-challenge-{name}' for name, _ in BUTTONS[:3]),
       'energy-challenge-rules', 'energy-challenge-rules-title', *(f'energy-challenge-rule-{i}' for i in range(5)),
       'energy-challenge-review', 'energy-challenge-review-title', 'energy-challenge-review-summary',
       'energy-challenge-review-details', 'energy-challenge-review-details-title', 'energy-challenge-review-lines',
       'energy-challenge-review-notice', 'energy-challenge-review-actions', *(f'energy-challenge-{name}' for name, _ in BUTTONS[3:]))

SAMPLE_JS = r'''() => {
 const path=e=>{const p=[];for(;e&&e!==document;e=e.parentElement){if(!e.parentElement){p.push(e.tagName);break;}p.push(e.tagName+':'+[...e.parentElement.children].indexOf(e));}return p.reverse().join('/');};
 const visible=e=>{if(!e)return false;for(let a=e;a;a=a.parentElement){if(a.hidden||getComputedStyle(a).display==='none')return false;if(a instanceof HTMLDetailsElement&&!a.open&&a!==e){const s=[...a.children].find(n=>n.tagName==='SUMMARY');if(!s?.contains(e))return false;}}return e.getClientRects().length>0&&!['hidden','collapse'].includes(getComputedStyle(e).visibility);};
 const field=e=>({path:path(e),value:e.value??null,checked:e.checked??null,disabled:e.disabled??null,open:e.open??null,selectionStart:e.selectionStart??null,selectionEnd:e.selectionEnd??null,selected:e instanceof HTMLSelectElement?[...e.options].map(o=>o.selected):null});
 const input=e=>({id:e.id,action:e.dataset.action??e.dataset.space??null,type:e.type,value:e.value,disabled:e.disabled,checked:e.checked??null,text:e.tagName==='BUTTON'?e.textContent:null});
 const panel=document.querySelector('[data-tab-panel="curvature"]'),anchor=document.querySelector('.prestige-panel'),addition=document.querySelector('#energy-challenge'),next=document.querySelector('#prestige-preview');
 const controls=[...document.querySelectorAll('input,select,textarea,button,details')];
 return {bodyHTML:document.body.outerHTML,bodyText:document.body.innerText,bodyPath:path(document.body),bodyFields:controls.map(field),bodyFocus:path(document.activeElement),
  panelHTML:panel?.outerHTML,panelText:panel?.innerText,panelPath:path(panel),panelCount:document.querySelectorAll('[data-tab-panel="curvature"]').length,panelNative:panel instanceof HTMLElement&&panel.tagName==='SECTION',panelVisible:visible(panel),
  visibleControls:panel?[...panel.querySelectorAll('input,select,textarea,button')].filter(visible).map(input):[],
  anchorCount:document.querySelectorAll('.prestige-panel').length,anchorHTML:anchor?.outerHTML,anchorPath:path(anchor),
  counts:Object.fromEntries(__IDS__.map(id=>[id,document.querySelectorAll('#'+id).length])),prefixCount:document.querySelectorAll('[id="energy-challenge"],[id^="energy-challenge-"]').length,
  addition:addition?{html:addition.outerHTML,text:addition.innerText,textContent:addition.textContent,path:path(addition),parentPath:path(addition.parentElement),
   native:addition instanceof HTMLElement&&addition.tagName==='SECTION',connected:addition.isConnected,hidden:addition.hidden,visible:visible(addition),
   exactPlacement:addition.parentElement===panel&&addition.previousElementSibling===anchor&&anchor.nextSibling===addition&&addition.nextSibling===next&&next?.parentElement===panel&&document.querySelectorAll('#prestige-preview').length===1,
   ids:[addition,...addition.querySelectorAll('[id]')].map(e=>e.id),
   fields:[...addition.querySelectorAll('input,select,textarea,button,details')].map(field),
   controls:[...addition.querySelectorAll('button')].map(e=>({id:e.id,native:e instanceof HTMLButtonElement,connected:e.isConnected,type:e.type,value:e.value,disabled:e.disabled,hidden:e.hidden,visible:visible(e),text:e.textContent})),
   interactiveCount:addition.querySelectorAll('input,select,textarea,button,details,a,[contenteditable],[onclick],[data-action],[data-space]').length,
   rulesOpen:addition.querySelector('#energy-challenge-rules')?.open,reviewHidden:addition.querySelector('#energy-challenge-review')?.hidden,reviewDetailsOpen:addition.querySelector('#energy-challenge-review-details')?.open}:null};
}'''.replace('__IDS__', repr(list(IDS)))


class _Tree(HTMLParser):
    """Complete tree including text/comments; no lossy regex DOM sanitization."""
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}
    def __init__(self, html):
        super().__init__(convert_charrefs=True); self.roots, self.stack = [], []
        self.feed(html); self.close(); assert not self.stack, 'Incomplete native HTML'
    def _append(self, node):
        (self.stack[-1]['children'] if self.stack else self.roots).append(node)
    def handle_starttag(self, tag, attrs):
        assert len(dict(attrs)) == len(attrs), 'Duplicate native attribute'
        node = {'tag': tag, 'attrs': dict(attrs), 'children': []}; self._append(node)
        if tag not in self.VOID: self.stack.append(node)
    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1]['tag'] == tag, 'Malformed native nesting'
        self.stack.pop()
    def handle_data(self, data): self._append(data)
    def handle_comment(self, data): self._append({'comment': data})
    def handle_decl(self, data): self._append({'declaration': data})


def _elements(node): return [child for child in node['children'] if isinstance(child, dict) and 'tag' in child]


def _walk(node, path):
    yield path, node
    for i, child in enumerate(_elements(node)):
        yield from _walk(child, path + '/' + child['tag'].upper() + ':' + str(i))


def _text(node): return ''.join(child if isinstance(child, str) else _text(child) if 'tag' in child else '' for child in node['children'])


def _fields(node, path):
    result = []
    for name, child in _walk(node, path):
        if child['tag'] not in ('button', 'details'): continue
        assert set(child['attrs']) <= {'id', 'type', 'disabled', 'hidden'}, 'Unexpected addition control attributes'
        result.append({'path': name, 'value': '' if child['tag'] == 'button' else None, 'checked': None,
                       'disabled': 'disabled' in child['attrs'] if child['tag'] == 'button' else None,
                       'open': False if child['tag'] == 'details' else None, 'selectionStart': None, 'selectionEnd': None, 'selected': None})
    return result


def _shift(path, addition_path):
    parent, leaf = addition_path.rsplit('/', 1); index = int(leaf.rsplit(':', 1)[1])
    assert path != addition_path and not path.startswith(addition_path + '/'), 'Focus/old field cannot be inside removed addition'
    if path.startswith(parent + '/'):
        rest = path[len(parent) + 1:]; first, sep, tail = rest.partition('/')
        tag, number = first.rsplit(':', 1)
        if int(number) > index:
            return parent + '/' + tag + ':' + str(int(number) - 1) + (sep + tail if sep else '')
    return path


def _remove_exact(html, block):
    assert html.count(block) == 1, 'Unique complete native addition bytes required'
    start = html.index(block)
    return html[:start] + html[start + len(block):]


def project_energy_challenge_display(evidence, state, side):
    """Return only independently checked copied HTML/text/field projections."""
    assert side in ('before', 'after')
    assert_energy_challenge_source_contract()
    assert evidence['panelCount'] == 1 and evidence['panelNative'] is True and evidence['anchorCount'] == 1
    body = _Tree(evidence['bodyHTML']).roots
    assert len(body) == 1 and body[0]['tag'] == 'body'
    nodes = dict(_walk(body[0], evidence['bodyPath']))
    assert evidence['panelPath'] in nodes and evidence['anchorPath'] in nodes, 'Native panel/anchor path is not present in complete body'
    panel = nodes[evidence['panelPath']]; assert panel['tag'] == 'section' and panel['attrs'].get('data-tab-panel') == 'curvature'
    assert _Tree(evidence['panelHTML']).roots == [panel]
    anchor = nodes[evidence['anchorPath']]
    assert anchor['tag'] == 'div' and anchor['attrs'].get('class') == 'prestige-panel'
    assert _Tree(evidence['anchorHTML']).roots == [anchor]
    actual_ids = [node['attrs']['id'] for node in nodes.values() if node['attrs'].get('id', '').startswith('energy-challenge-') or node['attrs'].get('id') == 'energy-challenge']
    result = {key: deepcopy(evidence[key]) for key in ('bodyHTML', 'panelHTML', 'panelText', 'bodyFields', 'bodyFocus', 'visibleControls')}
    if side == 'before':
        assert 'energyChallenge' not in state, 'Historical source must not already contain challenge authority'
        assert evidence['addition'] is None and evidence['counts'] == dict.fromkeys(IDS, 0) and evidence['prefixCount'] == 0 and actual_ids == []
        return result
    assert json.dumps(state.get('energyChallenge'), sort_keys=True) == json.dumps(DEFAULT, sort_keys=True), 'Only exact untouched inactive challenge state qualifies'
    assert evidence['counts'] == dict.fromkeys(IDS, 1) and evidence['prefixCount'] == len(IDS) and actual_ids == list(IDS)
    addition = evidence['addition']; painted = evidence['panelVisible']
    assert type(painted) is bool
    expected = _Tree(expected_html(state, painted)).roots[0]
    assert addition['native'] is True and addition['connected'] is True and addition['hidden'] is False and addition['visible'] is painted
    assert addition['exactPlacement'] is True and addition['parentPath'] == evidence['panelPath'] and addition['ids'] == list(IDS)
    assert addition['rulesOpen'] is False and addition['reviewHidden'] is True and addition['reviewDetailsOpen'] is False
    assert addition['interactiveCount'] == 7
    assert _Tree(addition['html']).roots == [expected], 'Complete default inactive panel structure/text/attributes changed'
    assert addition['path'] in nodes and nodes[addition['path']] == expected and addition['textContent'] == _text(expected)
    children = _elements(panel); pos = children.index(expected)
    assert 0 < pos < len(children) - 1 and children[pos - 1] == anchor and children[pos + 1]['attrs'].get('id') == 'prestige-preview', 'Incorrect native insertion boundary'
    assert addition['path'] == evidence['panelPath'] + '/SECTION:' + str(pos)
    eligible, status = entry_status(state)
    controls = [{'id': 'energy-challenge-' + name, 'native': True, 'connected': True, 'type': 'button', 'value': '',
                 'disabled': not (painted and name == 'enter' and eligible), 'hidden': painted and name in ('finish', 'abandon'),
                 'visible': painted and name == 'enter', 'text': label} for name, label in BUTTONS]
    assert addition['controls'] == controls, 'Native challenge control permissions changed'
    assert addition['fields'] == _fields(expected, addition['path']), 'Native hidden/default field properties changed'
    addition_paths = {row['path'] for row in addition['fields']}
    all_field_paths = [path for path, node in nodes.items() if node['tag'] in ('input', 'select', 'textarea', 'button', 'details')]
    assert [row['path'] for row in evidence['bodyFields']] == all_field_paths, 'Full native field census differs from complete body'
    assert [row for row in evidence['bodyFields'] if row['path'] in addition_paths] == addition['fields']
    assert len({row['path'] for row in evidence['bodyFields']}) == len(evidence['bodyFields'])
    result['bodyHTML'] = _remove_exact(evidence['bodyHTML'], addition['html'])
    result['panelHTML'] = _remove_exact(evidence['panelHTML'], addition['html'])
    assert _Tree(result['bodyHTML']).roots and _Tree(result['panelHTML']).roots
    result['bodyFields'] = [{**deepcopy(row), 'path': _shift(row['path'], addition['path'])}
                            for row in evidence['bodyFields'] if row['path'] not in addition_paths]
    result['bodyFocus'] = _shift(evidence['bodyFocus'], addition['path'])
    if painted:
        # HTML, all text nodes and permissions were already checked exactly.
        # Browser line-break whitespace is retained verbatim outside this one
        # contiguous block; at most its own one leading separator is removed.
        assert re.sub(r'\s+', ' ', addition['text']).strip() == ' '.join((TITLE, SUMMARY, status, BUTTONS[0][1], RULE_TITLE))
        text = evidence['panelText']; block = addition['text']
        assert text.count(block) == 1 and '\n' + block + '\n' in text
        result['panelText'] = text.replace('\n' + block, '', 1)
        enter = {'id': 'energy-challenge-enter', 'action': None, 'type': 'button', 'value': '', 'disabled': not eligible, 'checked': None, 'text': BUTTONS[0][1]}
        assert evidence['visibleControls'].count(enter) == 1
        result['visibleControls'] = [deepcopy(row) for row in evidence['visibleControls'] if row != enter]
    else:
        assert addition['text'] == addition['textContent'], 'Hidden unpainted panel cannot carry a previous review/render'
        assert not any(row.get('id', '').startswith('energy-challenge') for row in evidence['visibleControls'])
        # A hidden panel innerText equals textContent and includes hidden rows.
        result['panelText'] = _remove_exact(evidence['panelText'], addition['text'])
    return result


def normalize_energy_challenge_display(snapshot, evidence, state, side):
    """Copy a whole-body fleet snapshot or a visible curvature-tab snapshot.

    Whole-body storage/raw/events/time are left byte-for-byte untouched. Caller
    must separately enforce the existing complete state/migration contracts.
    """
    projection = project_energy_challenge_display(evidence, state, side)
    result = deepcopy(snapshot)
    if 'html' in snapshot:
        assert snapshot['html'] == evidence['bodyHTML'] and snapshot['fields'] == evidence['bodyFields'] and snapshot['focus'] == evidence['bodyFocus'], 'Whole-body witness is not the actual snapshot'
        result['html'], result['fields'], result['focus'] = projection['bodyHTML'], projection['bodyFields'], projection['bodyFocus']
    else:
        assert snapshot.get('tab') == 'curvature' and snapshot['text'] == evidence['panelText'] and snapshot['inputs'] == evidence['visibleControls'], 'Visible curvature witness is not the actual snapshot'
        assert evidence['panelVisible'] is True
        result['text'], result['inputs'] = projection['panelText'], projection['visibleControls']
        if 'panelHTML' in result:
            assert result['panelHTML'] == evidence['panelHTML']; result['panelHTML'] = projection['panelHTML']
    return result
