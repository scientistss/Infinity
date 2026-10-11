"""Strict copied-evidence adapter for one fixed legacy facilities fixture.

This module never accesses a browser, filesystem, storage, or clock. The JS
sampler is read-only. Call normalize_demolition_display before the existing
terraformer facilities adapter, and archive the untouched evidence separately.
"""
from copy import deepcopy
from html.parser import HTMLParser

BUILDINGS = (
    'metal_mine', 'crystal_mine', 'deuterium_synth', 'solar_plant', 'fusion_reactor',
    'metal_storage', 'crystal_storage', 'deuterium_tank', 'robotics_factory',
    'nanite_factory', 'shipyard', 'research_lab', 'missile_silo',
)
LEVELS = dict(zip(BUILDINGS, (0, 0, 0, 0, 0, 4, 4, 4, 2, 0, 2, 2, 0)))
LABEL = '拆除一级…'
JOB_HTML = '<section id="demolition-job" class="demolition-job" hidden=""><h3 id="demolition-job-title"></h3><p id="demolition-job-time"></p><p id="demolition-job-fee"></p><p>施工中保留原等级与功能，本星不能新增建筑工作。完工不返还历史投入。</p><div id="demolition-job-actions" class="demolition-actions"></div><p id="demolition-job-reason" class="demolition-reason" role="status"></p></section>'
REVIEW_HTML = '<section id="demolition-review" class="demolition-review" aria-labelledby="demolition-review-title" hidden=""><h3 id="demolition-review-title">拆除核对</h3><p id="demolition-review-fee"></p><p id="demolition-review-time"></p><ul id="demolition-review-losses"></ul><p id="demolition-review-reason" class="demolition-reason" role="status"></p><div class="demolition-actions" id="demolition-review-actions"></div></section>'

# Independently sample the native tree. No clone mutation or selector filtering
# is used to manufacture invariant DOM; Python removes only verified strings.
FACILITY_DEMOLITION_SAMPLE_JS = r'''() => {
  const panel=document.querySelector('[data-tab-panel="facilities"]');
  const visible=e=>{
    if(!e)return false;
    for(let a=e;a;a=a.parentElement){
      if(a.hidden||getComputedStyle(a).display==='none')return false;
      if(a instanceof HTMLDetailsElement&&!a.open){
        const summary=[...a.children].find(n=>n.tagName==='SUMMARY');
        if(!summary?.contains(e))return false;
      }
    }
    return e.getClientRects().length>0&&!['hidden','collapse'].includes(getComputedStyle(e).visibility);
  };
  const inputs=[...panel.querySelectorAll('input,select,textarea,button')].filter(visible);
  const rows=[...panel.querySelectorAll('.demolition-entry')];
  const work=panel.querySelector('#demolition-job'),review=panel.querySelector('#demolition-review');
  const title=panel.querySelector(':scope > h3.group-title');
  return {
    panelHTML:panel.outerHTML,
    counts:{rows:rows.length,buttons:panel.querySelectorAll('[data-demolish]').length,
      work:document.querySelectorAll('#demolition-job').length,review:document.querySelectorAll('#demolition-review').length,
      confirm:document.querySelectorAll('[data-demolition-confirm]').length,cancel:document.querySelectorAll('[data-cancel-demolition]').length},
    exactSectionPlacement:!!work&&!!review&&work.parentElement===panel&&review.parentElement===panel&&
      work.nextElementSibling===review&&review.nextElementSibling===title&&title.textContent==='资源建筑',
    sections:[work,review].filter(Boolean).map(e=>({id:e.id,html:e.outerHTML,hidden:e.hidden,visible:visible(e)})),
    rows:rows.map(row=>{
      const button=row.querySelector('button'),card=row.parentElement,buy=row.previousElementSibling;
      return {building:button?.dataset.demolish,rowHTML:row.outerHTML,rowHidden:row.hidden,rowVisible:visible(row),
        cardBinding:card?.dataset.bind,cardText:card?.innerText,buyText:buy?.innerText,
        exactPlacement:card?.matches('article.bld')&&card.lastElementChild===row&&buy?.matches('button.buy-btn')&&
          buy.dataset.action==='enqueue'&&buy.dataset.id===button?.dataset.demolish&&row.children.length===1&&
          row.firstElementChild===button&&document.querySelectorAll('[data-demolish="'+button?.dataset.demolish+'"]').length===1,
        button:{tag:button?.tagName,id:button?.id,type:button?.type,value:button?.value,disabled:button?.disabled,
          hidden:button?.hidden,visible:visible(button),text:button?.textContent,index:inputs.indexOf(button)}};
    }),
    protocolWarnings:[...document.querySelectorAll('[data-demolition-slot-warning]')].map(e=>({
      index:e.dataset.demolitionSlotWarning,hidden:e.hidden,text:e.textContent,
      exactPlacement:e.parentElement?.dataset.bind==='slot-controls-'+e.dataset.demolitionSlotWarning&&e.parentElement.lastElementChild===e})),
  };
}'''


class _Tokens(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.value = []

    def handle_starttag(self, tag, attrs):
        assert len(dict(attrs)) == len(attrs), 'Duplicate HTML attribute'
        self.value.append(('start', tag, sorted(attrs)))

    def handle_endtag(self, tag):
        self.value.append(('end', tag))

    def handle_data(self, data):
        self.value.append(('text', data))

    def handle_comment(self, data):
        self.value.append(('comment', data))


def _tokens(html):
    parser = _Tokens()
    parser.feed(html)
    parser.close()
    return parser.value


def expected_row_html(building):
    hidden = LEVELS[building] == 0
    return ('<div class="demolition-entry"' + (' hidden=""' if hidden else '') + '>'
            '<button type="button" data-demolish="' + building + '"' +
            (' disabled="" hidden=""' if hidden else '') + '>' + LABEL + '</button></div>')


def normalize_demolition_display(projected, evidence, state, side):
    """Return a copy with only independently verified demolition additions removed."""
    assert side in ('before', 'after')
    assert projected['tab'] == 'facilities'
    planet = next(p for p in state['planets'] if p['id'] == state['activePlanetId'])
    assert planet['id'] == 'homeworld'
    assert {key: planet['buildings'][key] for key in BUILDINGS} == LEVELS
    assert planet['buildings']['terraformer'] == 0
    assert planet.get('demolition') is None
    assert all(('demolition' not in p) if side == 'before' else ('demolition' in p and p['demolition'] is None) for p in state['planets'])
    assert len(planet['buildQueue']) == 1
    assert (planet['buildQueue'][0]['building'], planet['buildQueue'][0]['targetLevel']) == ('metal_storage', 5)
    slots = state['protocols']['slots']
    assert len(slots) == 12 and slots[0]['card']['id'] == 'auto_collect' and slots[0]['card']['enabled'] is True
    assert all(slot['card'] is None for slot in slots[1:])
    result = deepcopy(projected)
    if side == 'before':
        assert evidence['counts'] == dict(rows=0, buttons=0, work=0, review=0, confirm=0, cancel=0)
        assert evidence['rows'] == evidence['sections'] == evidence['protocolWarnings'] == []
        assert LABEL not in projected['text']
        return result
    assert evidence['counts'] == dict(rows=13, buttons=13, work=1, review=1, confirm=0, cancel=0)
    assert evidence['exactSectionPlacement'] is True
    assert len(evidence['sections']) == 2
    fragments = []
    for actual, identifier, expected in zip(evidence['sections'], ('demolition-job', 'demolition-review'), (JOB_HTML, REVIEW_HTML)):
        assert actual['id'] == identifier and actual['hidden'] is True and actual['visible'] is False
        assert _tokens(actual['html']) == _tokens(expected)
        fragments.append(actual['html'])
    assert evidence['protocolWarnings'] == [dict(index=str(index), hidden=True, text='', exactPlacement=True) for index in range(12)]
    assert [row['building'] for row in evidence['rows']] == list(BUILDINGS)
    assert projected['text'].count(LABEL) == 6
    removed_indexes = []
    for row in evidence['rows']:
        building = row['building']
        shown = LEVELS[building] > 0
        assert row['cardBinding'] == 'bld-' + building and row['exactPlacement'] is True
        assert row['rowHidden'] is not shown and row['rowVisible'] is shown
        assert _tokens(row['rowHTML']) == _tokens(expected_row_html(building))
        button = row['button']
        assert {key: button[key] for key in ('tag', 'id', 'type', 'value', 'disabled', 'hidden', 'visible', 'text')} == dict(
            tag='BUTTON', id='', type='button', value='', disabled=not shown, hidden=not shown, visible=shown, text=LABEL)
        fragments.append(row['rowHTML'])
        if not shown:
            assert button['index'] == -1
            continue
        index = button['index']
        assert isinstance(index, int) and index >= 0 and index not in removed_indexes
        assert projected['inputs'][index] == dict(id='', action=None, type='button', value='', disabled=False, checked=None, text=LABEL)
        removed_indexes.append(index)
        card_text, buy_text = row['cardText'], row['buyText']
        assert card_text.count(LABEL) == 1 and card_text.endswith(LABEL)
        assert buy_text and card_text.count(buy_text) == 1 and result['text'].count(card_text) == 1
        end = card_text.index(buy_text) + len(buy_text)
        assert card_text[end:-len(LABEL)] in ('\n', '\n\n')
        result['text'] = result['text'].replace(card_text, card_text[:end], 1)
    assert len(removed_indexes) == 6 and LABEL not in result['text']
    result['inputs'] = [value for index, value in enumerate(result['inputs']) if index not in removed_indexes]
    html = evidence['panelHTML']
    for fragment in fragments:
        assert html.count(fragment) == 1
        html = html.replace(fragment, '', 1)
    if 'facilityEvidence' in result:
        facility = result['facilityEvidence']
        assert facility['panelHTML'] == evidence['panelHTML']
        facility['panelHTML'] = html
        normalized = []
        for child in facility['invariantDOM']:
            if child.get('html') in fragments[:2]:
                continue
            if 'children' in child:
                for index, card in enumerate(child['children']):
                    for fragment in fragments[2:]:
                        card = card.replace(fragment, '', 1)
                    child['children'][index] = card
            normalized.append(child)
        facility['invariantDOM'] = normalized
        for control in facility['controls']:
            assert control['index'] not in removed_indexes
            control['index'] -= sum(index < control['index'] for index in removed_indexes)
    return result
