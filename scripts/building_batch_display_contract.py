"""Fail-closed, read-only projection of the new unopened batch disclosure.

The independently written literal below is source-bound, then compared with the
complete native DOM. Only that verified final block is removed from copied
orders evidence. This adapter never runs inside CPU samples or modifies a DOM.
"""
from copy import deepcopy
from html.parser import HTMLParser
from pathlib import Path
import json
import re

SUMMARY = '建筑模板 · 2–4 星球一次应用'
LEGACY_SUMMARY = '建筑意图模板 · 保存目标，按需创建有限计划'
ACTIONS = (
    ('fill-quotes', '按当前报价填写独立预算'),
    ('review', '核对本次整批应用'),
    ('clear', '清空本次选择'),
    ('apply', '确认整批登记有限计划'),
    ('cancel-review', '取消本次核对'),
)
# Literal markup, not obtained by evaluating/importing the production renderer.
INITIAL_HTML = '''<details id="building-template-batch" class="building-template-batch"><summary>建筑模板 · 2–4 星球一次应用</summary>
    <p class="muted">选择已保存的建筑目标，再明确勾选 2–4 个现有星球。每星固定本地付款 / 执行，整批成功或整批不创建；不运输、不补前置、不自动续开。</p>
    <p id="building-template-batch-status" role="status" aria-live="polite"></p>
    <label class="batch-template-label">已保存模板<select id="building-template-batch-template"><option value="">请明确选择模板</option></select></label>
    <p id="building-template-batch-selection" class="muted">尚未选择星球（需 2–4 个）。</p>
    <div id="building-template-batch-planets" class="batch-planet-choices"></div>
    <p class="muted">逐星、逐建筑、逐资源独立预算，默认 0。顶部切星不会改选定星球或预算；已有队列与计划保留原付款和授权。</p>
    <div id="building-template-batch-budgets" class="batch-budgets"></div>
    <div class="batch-actions"><button type="button" id="building-template-batch-fill-quotes" data-building-template-batch-action="fill-quotes" disabled="">按当前报价填写独立预算</button><button type="button" id="building-template-batch-review" data-building-template-batch-action="review" disabled="">核对本次整批应用</button><button type="button" id="building-template-batch-clear" data-building-template-batch-action="clear" disabled="">清空本次选择</button></div>
    <section id="building-template-batch-review-panel" hidden=""><h3>本次整批核对</h3>
      <p id="building-template-batch-review-summary"></p><p id="building-template-batch-total-budget"></p>
      <p>固定上限，逐星实际入队时付款；登记不扣款。各项额度不共享、不自动追加，资源或预算不足时等待。</p>
      <div id="building-template-batch-review-planets" class="batch-review-planets"></div>
      <div class="batch-actions"><button type="button" id="building-template-batch-apply" data-building-template-batch-action="apply" disabled="">确认整批登记有限计划</button><button type="button" id="building-template-batch-cancel-review" data-building-template-batch-action="cancel-review" disabled="">取消本次核对</button></div>
    </section></details>'''
IDS = tuple(re.findall(r'\bid="([^"]+)"', INITIAL_HTML))


def assert_building_batch_source_contract(root=None):
    """Bind this reviewed literal to the current constructor and folded host gate."""
    root = Path(root) if root else Path(__file__).resolve().parents[1]
    source = (root / 'src/ui/building-template-batch-panel.ts').read_text()
    constructor = re.findall(r'export function buildingTemplateBatchPanelHtml\(\): string \{\n  return `([^`]+)`;\n\}', source)
    assert len(constructor) == 1, 'Unique literal batch constructor required'
    button_source = 'const button = (action: ActionName, label: string) => `<button type="button" id="building-template-batch-${action}" data-building-template-batch-action="${action}" disabled>${label}</button>`;'
    assert source.count(button_source) == 1, 'Exact initial batch action constructor required'
    markup = constructor[0]
    for action, label in ACTIONS:
        token = '${button("' + action + '", "' + label + '")}'
        assert markup.count(token) == 1, 'Exact unique initial action expansion required'
        markup = markup.replace(token, '<button type="button" id="building-template-batch-' + action + '" data-building-template-batch-action="' + action + '" disabled="">' + label + '</button>', 1)
    assert '${' not in markup, 'No unreviewed dynamic initial batch content'
    # Native HTML serialization expands boolean attributes. observe() enables
    # only the unselected select; all five action buttons remain disabled.
    markup = markup.replace('id="building-template-batch-template" disabled', 'id="building-template-batch-template"')
    markup = markup.replace('id="building-template-batch-review-panel" hidden>', 'id="building-template-batch-review-panel" hidden="">')
    assert markup == INITIAL_HTML, 'Complete independent initial batch literal drift'
    assert source.count('select.disabled = !usable;') == 1
    host = (root / 'src/ui/space-panel.ts').read_text()
    assert host.count('ordersPanelHtml()+researchTemplatesPanelHtml()+buildingTemplatesPanelHtml()+buildingTemplateBatchPanelHtml()') == 1
    assert host.count('if(!el(root,"#space-orders").hidden&&el<HTMLDetailsElement>(root,"#building-template-batch").open)buildingTemplateBatchPanel.update(state,writable);') == 1
    assert host.count('const buildingTemplateBatchPanel=installBuildingTemplateBatchPanel(root,onAction);') == 1


# Native identity and permission witnesses are gathered independently of the
# literal. Geometry alone is insufficient for descendants of folded details.
SAMPLE_JS = r'''() => {
  const panel=document.querySelector('#space-orders'), nodes=[...document.querySelectorAll('#building-template-batch')], addition=nodes[0];
  const visible=e=>{
    if(!e)return false;
    for(let a=e;a;a=a.parentElement){
      if(a.hidden||getComputedStyle(a).display==='none')return false;
      if(a instanceof HTMLDetailsElement&&!a.open){
        const summary=[...a.children].find(n=>n.tagName==='SUMMARY');
        if(a!==e&&!summary?.contains(e))return false;
      }
    }
    return e.getClientRects().length>0&&!['hidden','collapse'].includes(getComputedStyle(e).visibility);
  };
  const controls=panel?[...panel.querySelectorAll('input,select,textarea,button')].filter(visible):[];
  const summary=addition?.querySelector(':scope > summary');
  const ids=__IDS__;
  return {panelHTML:panel?.outerHTML,panelText:panel?.innerText,panelCount:document.querySelectorAll('#space-orders').length,
    panelNative:panel instanceof HTMLElement&&panel.tagName==='SECTION',panelVisible:visible(panel),
    counts:Object.fromEntries(ids.map(id=>[id,document.querySelectorAll('#'+id).length])),
    visibleControls:controls.map(e=>({id:e.id,action:e.dataset.action??e.dataset.space??null,type:e.type,value:e.value,disabled:e.disabled,checked:e.checked??null,text:e.tagName==='BUTTON'?e.textContent:null})),
    addition:addition?{html:addition.outerHTML,native:addition instanceof HTMLDetailsElement,connected:addition.isConnected,
      hidden:addition.hidden,open:addition.open,visible:visible(addition),text:addition.innerText,
      exactPlacement:addition.parentElement===panel&&panel.lastElementChild===addition&&addition.nextSibling===null&&
        addition.previousElementSibling?.id==='building-templates'&&addition.previousElementSibling instanceof HTMLDetailsElement&&
        !addition.previousElementSibling.open&&document.querySelectorAll('#building-templates').length===1,
      ids:[addition,...addition.querySelectorAll('[id]')].map(e=>e.id),
      summary:{html:summary?.outerHTML,native:summary?.tagName==='SUMMARY',direct:summary?.parentElement===addition,
        first:addition.firstElementChild===summary,count:addition.querySelectorAll('summary').length,visible:visible(summary)},
      controlCount:addition.querySelectorAll('input,select,textarea,button,a,[contenteditable],[onclick],[data-action],[data-space]').length,
      controls:[...addition.querySelectorAll('input,select,textarea,button')].map(e=>({id:e.id,tag:e.tagName,
        native:e instanceof HTMLSelectElement||e instanceof HTMLButtonElement,connected:e.isConnected,
        type:e.type,value:e.value,disabled:e.disabled,hidden:e.hidden,visible:visible(e),checked:e.checked??null,
        index:controls.indexOf(e),text:e.textContent,action:e.dataset.buildingTemplateBatchAction??null,
        selectedIndex:e instanceof HTMLSelectElement?e.selectedIndex:null,
        options:e instanceof HTMLSelectElement?[...e.options].map(o=>({html:o.outerHTML,native:o instanceof HTMLOptionElement,
          direct:o.parentElement===e,value:o.value,text:o.textContent,selected:o.selected,disabled:o.disabled})):null}))}:null};
}'''.replace('__IDS__', repr(list(IDS)))


class _Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.roots, self.stack = [], []
        self.feed(html)
        self.close()
        assert not self.stack, 'Complete native HTML required'

    def handle_starttag(self, tag, attrs):
        assert len(dict(attrs)) == len(attrs), 'Duplicate attribute'
        node = {'tag': tag, 'attrs': dict(attrs), 'children': []}
        (self.stack[-1]['children'] if self.stack else self.roots).append(node)
        if tag not in ('area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'):
            self.stack.append(node)

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1]['tag'] == tag, 'Exact native element nesting required'
        self.stack.pop()


def expected_controls():
    common = dict(native=True, connected=True, hidden=False, visible=False, checked=None, index=-1)
    select = dict(common, id='building-template-batch-template', tag='SELECT', type='select-one', value='', disabled=False,
                  text='请明确选择模板', action=None, selectedIndex=0,
                  options=[dict(html='<option value="">请明确选择模板</option>', native=True, direct=True,
                                value='', text='请明确选择模板', selected=True, disabled=False)])
    return [select] + [dict(common, id='building-template-batch-' + action, tag='BUTTON', type='button', value='',
                            disabled=True, text=label, action=action, selectedIndex=None, options=None) for action, label in ACTIONS]


def _exact(actual, expected):
    return json.dumps(actual, sort_keys=True, ensure_ascii=False) == json.dumps(expected, sort_keys=True, ensure_ascii=False)


def normalize_building_batch_display(projected, evidence, state, side):
    """Keep raw witnesses untouched; return copied snapshot and panel HTML."""
    assert side in ('before', 'after') and projected['tab'] == 'orders'
    assert evidence['panelCount'] == 1 and evidence['panelNative'] is True and evidence['panelVisible'] is True
    assert evidence['panelText'] == projected['text']
    assert evidence['visibleControls'] == projected['inputs']
    assert evidence['panelHTML'] == projected['orderQuoteEvidence']['panelHTML']
    tree = _Tree(evidence['panelHTML']).roots
    assert len(tree) == 1 and tree[0]['tag'] == 'section' and tree[0]['attrs'].get('id') == 'space-orders'
    result = deepcopy(projected)
    if side == 'before':
        assert 'buildingTemplates' not in state
        assert _exact(evidence['counts'], dict.fromkeys(IDS, 0)) and evidence['addition'] is None
        assert not any(identifier in evidence['panelHTML'] for identifier in IDS)
        return result, evidence['panelHTML']
    assert _exact(state['buildingTemplates'], {'nextTemplateId': 1, 'templates': []}), 'Only unchanged empty legacy library qualifies'
    assert _exact(evidence['counts'], dict.fromkeys(IDS, 1))
    actual = evidence['addition']
    expected = dict(html=INITIAL_HTML, native=True, connected=True, hidden=False, open=False, visible=True,
                    text=SUMMARY, exactPlacement=True, ids=list(IDS), controlCount=6, controls=expected_controls(),
                    summary=dict(html='<summary>' + SUMMARY + '</summary>', native=True, direct=True, first=True, count=1, visible=True))
    assert _exact(actual, expected), 'Complete native initial batch DOM, identities and permissions must match'
    children = tree[0]['children']
    assert len(children) >= 2 and children[-1]['attrs'].get('id') == 'building-template-batch'
    assert children[-2]['tag'] == 'details' and children[-2]['attrs'].get('id') == 'building-templates'
    html = evidence['panelHTML']
    tail = INITIAL_HTML + '</section>'
    assert html.endswith(tail) and html.count(INITIAL_HTML) == 1, 'Unique exact terminal batch bytes required'
    suffix = '\n' + SUMMARY
    assert result['text'].endswith(suffix) and result['text'].count(SUMMARY) == 1
    result['text'] = result['text'][:-len(suffix)]
    remainder = html[:-len(tail)] + '</section>'
    assert remainder == html[:html.index(INITIAL_HTML)] + html[html.index(INITIAL_HTML) + len(INITIAL_HTML):]
    # Full unprojected orderQuoteEvidence remains available for the later native
    # DOM/storage/clock equality check; never compare a real DOM to a projection.
    assert result['inputs'] == projected['inputs'] and result['shared'] == projected['shared']
    assert result['orderQuoteEvidence'] == projected['orderQuoteEvidence']
    return result, remainder


def normalize_legacy_building_library(projected, evidence, projected_panel_html):
    """The prior r9 folded-summary exception, after exact batch-only projection."""
    assert projected['tab'] == 'orders'
    assert evidence['count'] == 1 and evidence['native'] is True and evidence['connected'] is True
    assert evidence['parentId'] == 'space-orders' and evidence['open'] is False
    assert evidence['text'] == LEGACY_SUMMARY and evidence['summary'] == LEGACY_SUMMARY
    children = _Tree(projected_panel_html).roots[0]['children']
    assert children[-1]['tag'] == 'details' and children[-1]['attrs'].get('id') == 'building-templates'
    assert projected_panel_html.endswith(evidence['html'] + '</section>')
    assert projected_panel_html.count(evidence['html']) == 1
    suffix = '\n' + LEGACY_SUMMARY
    assert projected['text'].endswith(suffix) and projected['text'].count(LEGACY_SUMMARY) == 1
    result = deepcopy(projected)
    result['text'] = result['text'][:-len(suffix)]
    return result


def building_batch_render_contract_before(current: str) -> str:
    """Project only the pinned complete runner transition for old source seals.

    Callers pass copied source, so mutation tests cannot accidentally verify the
    clean worktree instead. Both full files and the complete contextual delta
    are pinned before returning the immutable public predecessor.
    """
    import difflib
    import hashlib
    import subprocess
    root = Path(__file__).resolve().parents[1]
    path = 'scripts/browser-render-scheduling.py'
    digest = lambda text: hashlib.sha256(text.encode('utf-8')).hexdigest()
    if isinstance(current, str) and digest(current) != '686f5d4a43c2b7913bc256749194e3800fe02b977e93b0de6c6e2e2642110744':
        from test_energy_challenge_provenance import project_bytes
        current = project_bytes(path, current.encode('utf-8')).decode('utf-8')
    assert isinstance(current, str) and digest(current) == '686f5d4a43c2b7913bc256749194e3800fe02b977e93b0de6c6e2e2642110744', 'Exact complete reviewed batch runner required'
    before = subprocess.check_output(['git', '--no-replace-objects', '-C', str(root), 'show',
                                      '6f73735534ffc1b0e47a01935d8c6e3ff786c989:' + path]).decode('utf-8')
    assert digest(before) == '6e7e4e40acc8ac6ba8edc2bb450919612d8b19e287aa97057305ee6ee65af044', 'Immutable public complete render runner changed'
    delta = ''.join(difflib.unified_diff(before.splitlines(keepends=True), current.splitlines(keepends=True),
                                       fromfile='a/' + path, tofile='b/' + path, n=3))
    assert digest(delta) == '89d003a3e77834164eca7c467d11e5ab3a305364dc14f42ce92a19d6b89c6ee1', 'Exact complete batch display projection transition required'
    return before
