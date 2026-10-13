"""Python/Git-only contracts for exact recycle additions to existing parity gates.

Independent copied DOM witnesses exercise the actual Python adapter. Benchmark
checks freeze its reviewed JavaScript assertions and preserve every old source
byte; they do not execute JavaScript or claim native/browser/benchmark success.
"""
import ast
import copy
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = '6b985b88ec6b263a3eeb8f34252525383a9f110f'
RUNNER = 'scripts/browser-render-scheduling.py'
BENCHMARK = 'scripts/benchmark-presentation.mjs'
BASE_HASHES = {RUNNER: 'f644a21d8f19dd3ba84c4a1db80bedeafd844a5da43722cad84f707d82b83770',
              BENCHMARK: 'bf5ac59cfac570ec8d79d72aafeb3ed43876efbc900898011a0a9f1e86a93194'}
# Independently transcribed approved static HTML, never a production constructor.
EMPTY = '''<div id="recycle-preview" class="recycle-preview muted" hidden="">
    <p data-recycle="summary"></p>
    <details data-recycle="details"><summary>回收估算详情</summary>
      <p data-recycle="target"></p><p data-recycle="field"></p>
      <p data-recycle="capacity"></p><p data-recycle="room"></p>
      <p data-recycle="leftovers"></p><p data-recycle="notice"></p>
    </details>
    <p data-recycle="protection" hidden=""></p>
  </div>'''
BEFORE = '''<section id="space-fleet" class="tab-panel space-panel" data-tab-panel="fleet"><div class="space-columns"><div class="ov-card">固定舰船</div><div class="ov-card"><h3>固定任务</h3><select id="flight-mission"><option value="colonize">殖民</option></select><div id="transport-load-helper" hidden=""><p>原有隐藏文本</p></div>
    <p id="charge-risk-preview" class="muted" hidden=""></p><p id="charge-capacity-preview" class="muted" hidden=""></p><p id="space-quote" class="space-quote" aria-live="polite">原有报价</p><button type="button" id="space-send" data-space="send" disabled="">派遣舰队</button></div></div><p role="status">原有状态</p></section>'''
INSERT = '<p id="charge-risk-preview" class="muted" hidden=""></p>'
BENCHMARK_HELPER = '''// Only this frozen transport workload may adapt the new empty read-only field.
function historicalRecyclePreview(view, kind, draft) {
  assert.ok(kind === "full" || kind === "fleet", "recycle adapter is fleet-only");
  assert.equal(draft.mission, "transport", "recycle adapter requires the fixed non-recycle workload");
  const keys = Object.keys(view), index = keys.indexOf("recyclePreview");
  assert.equal(keys.filter(key => key === "recyclePreview").length, 1, "one own recycle preview field");
  assert.equal(index, 4, "recycle preview retains the exact declared model position");
  assert.deepEqual(keys.slice(2, 6), ["isCharge", "chargePreview", "recyclePreview", kind === "full" ? "origin" : "slots"],
    "recycle preview retains both original adjacent keys");
  assert.equal(view.recyclePreview, null, "the fixed transport workload has no active recycle preview");
  const result = structuredClone(view);
  delete result.recyclePreview;
  return result;
}
'''
BENCHMARK_OLD = '  const result=structuredClone(view);'
BENCHMARK_NEW = "  const result=kind==='full'||kind==='fleet' ? historicalRecyclePreview(view,kind,request) : structuredClone(view);"
BENCHMARK_NOTE = ' The fixed transport draft independently requires exactly one null recyclePreview at its declared full/fleet model key position before removing only that field; active previews and every other field remain outside that exception.'
RUNNER_ADAPTER_SHA = '4f3e7c0cf716c3057bd6caae379dae46293e61a27645c67b538945cc05834d12'
RUNNER_INTEGRATION_SHA = '09be4370c98e997a6d5835948ea846b7a44c81aa5da5a8f70037c7c07f70dd0f'
RUNNER_METADATA_SHA = 'fe80c7a293590d163fba752ee41286672eca30ef0078c2696aeef07debee15cc'


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def baseline(path):
    value = subprocess.check_output(['git', '-C', str(ROOT), 'show', BASE+':'+path]).decode()
    assert digest(value) == BASE_HASHES[path]
    return value


def assert_exact_runner_transition(current):
    start = current.index('# This is an independently reviewed DOM literal, not the production constructor.')
    end = current.index('def snapshot(page, ', start)
    addition = current[start:end]
    assert digest(addition) == RUNNER_ADAPTER_SHA, 'Reviewed independent witness/adapter drift'
    restored = current[:start]+current[end:]
    start = restored.index("        if result['tab']=='fleet':\n            recycle=page.evaluate(RECYCLE_DISPLAY_SAMPLE_JS)")
    end = restored.index("        if result['tab'] in ('shipyard','defense'):", start)
    integration = restored[start:end]
    assert digest(integration) == RUNNER_INTEGRATION_SHA, 'Raw-first integration drift'
    restored = restored[:start]+restored[end:]
    lines = [line for line in restored.splitlines(keepends=True) if "'parityRecyclePreviewException':" in line]
    assert len(lines) == 1 and digest(lines[0]) == RUNNER_METADATA_SHA
    restored = restored.replace(lines[0], '', 1)
    assert restored == baseline(RUNNER), 'Every previous render assertion must remain byte-exact'


def assert_exact_benchmark_transition(current):
    assert current.count(BENCHMARK_HELPER) == 1, 'Exact reviewed null-only assertion sequence required'
    assert current.count(BENCHMARK_NEW) == 1 and current.count(BENCHMARK_NOTE) == 1
    restored = current.replace(BENCHMARK_HELPER, '', 1).replace(BENCHMARK_NEW, BENCHMARK_OLD, 1).replace(BENCHMARK_NOTE, '', 1)
    assert restored == baseline(BENCHMARK), 'Every previous model/state/timing assertion must remain byte-exact'


def adapter():
    source = (ROOT/RUNNER).read_text()
    nodes = [node for node in ast.parse(source).body
             if isinstance(node, ast.FunctionDef) and node.name in ('normalize_recycle_display', 'exact_state')
             or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'EMPTY_RECYCLE_PREVIEW_HTML' for target in node.targets)]
    scope = {'copy': copy, 'json': json, 'HTMLParser': HTMLParser}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), RUNNER, 'exec'), scope)
    return scope['normalize_recycle_display']


def specimen(current=True):
    snapshot = {'tab': 'fleet', 'text': '固定任务\n殖民\n原有报价\n派遣舰队\n原有状态',
                'shared': {'status': '已保存到本地', 'amount-metal': '7.80e4'},
                'inputs': [{'id': 'flight-mission', 'action': None, 'type': 'select-one', 'value': 'colonize', 'disabled': False, 'checked': None, 'text': None},
                           {'id': 'space-send', 'action': 'send', 'type': 'button', 'value': '', 'disabled': True, 'checked': None, 'text': '派遣舰队'}]}
    html = BEFORE.replace(INSERT, EMPTY+INSERT, 1) if current else BEFORE
    evidence = {'tab': 'fleet', 'panelHTML': html, 'oldHiddenData': {'note': '原有隐藏文本', 'all': [0, False, None]}}
    addition = {'html': EMPTY, 'native': True, 'connected': True, 'identity': True, 'hidden': True,
                'visible': False, 'children': 3, 'controls': 0, 'exactPlacement': True,
                'details': {'native': True, 'hidden': False, 'open': False, 'visible': False, 'count': 1, 'children': 7,
                            'direct': True, 'summaryHTML': '<summary>回收估算详情</summary>', 'summaryChildren': 0},
                'fields': [{'key': key, 'count': 1, 'native': True, 'connected': True, 'children': 0, 'text': '',
                            'hidden': key == 'protection', 'visible': False, 'direct': True}
                           for key in ['summary', 'target', 'field', 'capacity', 'room', 'leftovers', 'notice', 'protection']]}
    witness = {'panelHTML': html,
               'counts': {'panels': 1, 'ids': 1 if current else 0, 'classes': 1 if current else 0, 'prefix': 1 if current else 0, 'bindings': 9 if current else 0},
               'mission': {'count': 1, 'native': True, 'connected': True, 'owned': True, 'value': 'colonize'},
               'addition': addition if current else None}
    return snapshot, evidence, witness, 'after' if current else 'before'


def edit_html(pair, old, new):
    pair[1]['panelHTML'] = pair[1]['panelHTML'].replace(old, new, 1)
    pair[2]['panelHTML'] = pair[1]['panelHTML']


class RecycleDisplayContractTests(unittest.TestCase):
    def test_exact_current_maps_to_complete_independent_old_snapshot_and_dom_without_mutation(self):
        old, new = specimen(False), specimen(True)
        saved = copy.deepcopy(new)
        projected = adapter()(*new)
        self.assertEqual(projected, adapter()(*old))
        self.assertEqual(projected, old[:2])
        self.assertEqual(new, saved)
        self.assertIsNot(projected[0]['inputs'], new[0]['inputs'])
        self.assertIsNot(projected[1]['oldHiddenData'], new[1]['oldHiddenData'])

    def test_all_identity_counts_reject_missing_duplicate_and_scalar_type_drift(self):
        for field in specimen()[2]['counts']:
            for value in (0, 2, True, '1', None):
                sample = specimen(); sample[2]['counts'][field] = value
                with self.subTest(field=field, value=value), self.assertRaises(AssertionError): adapter()(*sample)

    def test_non_recycle_draft_is_bound_to_unique_native_connected_owner(self):
        for field, value in [('value', 'recycle'), ('value', 'transport'), ('count', 2), ('count', 0), ('native', False), ('connected', False), ('owned', False), ('native', 1)]:
            sample = specimen(); sample[2]['mission'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(AssertionError): adapter()(*sample)

    def test_full_structure_attributes_actions_text_and_nested_nodes_reject(self):
        mutations = [('class="recycle-preview muted"', 'class="recycle-preview muted extra"'),
                     ('hidden=""', ''), ('id="recycle-preview"', 'id="recycle-preview" data-action="send"'),
                     ('data-recycle="target"', 'data-recycle="target" onclick="send()"'),
                     ('回收估算详情', '回收估算详情 已激活'), ('<summary>回收估算详情</summary>', '<summary><span>回收估算详情</span></summary>'),
                     ('<p data-recycle="field"></p>', '<p data-recycle="field">金属 1</p>'),
                     ('<details data-recycle="details">', '<details data-recycle="details" open="">'),
                     ('<p data-recycle="room"></p>', '<button data-recycle="room">操作</button>'),
                     ('<p data-recycle="notice"></p>', '<p data-recycle="notice"></p><p hidden="">未知内容</p>')]
        for old, new in mutations:
            sample = specimen(); altered = EMPTY.replace(old, new, 1)
            sample[2]['addition']['html'] = altered; edit_html(sample, EMPTY, altered)
            with self.subTest(old=old), self.assertRaises(AssertionError): adapter()(*sample)

    def test_each_blank_field_and_native_property_remains_independently_asserted(self):
        for index in range(8):
            for field, value in [('text', 'stale data'), ('count', 2), ('children', 1), ('native', False), ('connected', False), ('direct', False), ('visible', True)]:
                sample = specimen(); sample[2]['addition']['fields'][index][field] = value
                with self.subTest(index=index, field=field), self.assertRaises(AssertionError): adapter()(*sample)
        for field, value in [('hidden', False), ('hidden', 1), ('visible', True), ('children', 4), ('controls', 1), ('exactPlacement', False), ('identity', False), ('native', False), ('connected', False)]:
            sample = specimen(); sample[2]['addition'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): adapter()(*sample)

    def test_details_are_unique_closed_unhidden_native_empty_except_exact_summary(self):
        for field, value in [('native', False), ('hidden', True), ('open', True), ('visible', True), ('count', 2), ('children', 8), ('direct', False), ('summaryHTML', '<summary>其他</summary>'), ('summaryChildren', 1)]:
            sample = specimen(); sample[2]['addition']['details'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError): adapter()(*sample)

    def test_copied_full_html_rejects_missing_duplicate_moved_split_or_extra_binding_even_with_spoofed_counts(self):
        for kind in ('missing', 'duplicate', 'moved', 'split', 'extra-binding', 'wrong-right', 'wrong-parent-witness', 'moved-pair', 'nested', 'before-transport'):
            sample = specimen()
            if kind == 'missing': edit_html(sample, EMPTY, '')
            if kind == 'duplicate': edit_html(sample, EMPTY, EMPTY+EMPTY)
            if kind == 'moved': edit_html(sample, EMPTY+INSERT, INSERT+EMPTY)
            if kind == 'split': edit_html(sample, EMPTY+INSERT, EMPTY+'<p hidden="">未知</p>'+INSERT)
            if kind == 'extra-binding': edit_html(sample, '</section>', '<p data-recycle="target"></p></section>')
            if kind == 'wrong-right': edit_html(sample, INSERT, INSERT.replace('muted', 'changed'))
            if kind == 'wrong-parent-witness': sample[2]['addition']['exactPlacement'] = False
            if kind == 'moved-pair':
                edit_html(sample, EMPTY+INSERT, '')
                edit_html(sample, '</section>', EMPTY+INSERT+'</section>')
            if kind == 'nested': edit_html(sample, EMPTY+INSERT, '<div>'+EMPTY+INSERT+'</div>')
            if kind == 'before-transport':
                edit_html(sample, EMPTY+INSERT, '')
                edit_html(sample, '<div id="transport-load-helper"', EMPTY+INSERT+'<div id="transport-load-helper"')
            with self.subTest(kind=kind), self.assertRaises(AssertionError): adapter()(*sample)

    def test_whole_remainder_changes_are_never_sanitized_and_fail_original_full_comparator(self):
        for kind in ('hidden', 'attribute', 'visible-text', 'control', 'status', 'resources', 'old-evidence'):
            sample = specimen()
            if kind == 'hidden': edit_html(sample, '原有隐藏文本', '未知隐藏文本')
            if kind == 'attribute': edit_html(sample, 'class="space-quote"', 'class="space-quote" data-extra="yes"')
            if kind == 'visible-text': sample[0]['text'] += '\n额外内容'
            if kind == 'control': sample[0]['inputs'][1]['disabled'] = False
            if kind == 'status': sample[0]['shared']['status'] = '已改变'
            if kind == 'resources': sample[0]['shared']['amount-metal'] = '0'
            if kind == 'old-evidence': sample[1]['oldHiddenData']['all'].append('unknown')
            projected = adapter()(*sample)
            with self.subTest(kind=kind): self.assertNotEqual(projected, specimen(False)[:2])

    def test_historical_side_forbids_even_hidden_recycle_additions(self):
        for kind in ('count', 'addition', 'html', 'mission'):
            sample = specimen(False)
            if kind == 'count': sample[2]['counts']['ids'] = 1
            if kind == 'addition': sample[2]['addition'] = specimen()[2]['addition']
            if kind == 'html': edit_html(sample, INSERT, EMPTY+INSERT)
            if kind == 'mission': sample[2]['mission']['value'] = 'recycle'
            with self.subTest(kind=kind), self.assertRaises(AssertionError): adapter()(*sample)

    def test_fixed_source_mapping_preserves_all_previous_runner_assertions_byte_for_byte(self):
        source = (ROOT/RUNNER).read_text()
        assert_exact_runner_transition(source)
        for old, new in [("hidden:preview.hidden", "hidden:true"), ('preview.previousElementSibling===left', 'true'),
                         ('result,evidence=normalize_recycle_display(result,evidence,recycle,npc_base)', 'pass'),
                         ("check('fresh visible text/control parity: '+name,equal)", 'pass')]:
            self.assertIn(old, source)
            with self.subTest(old=old), self.assertRaises(AssertionError): assert_exact_runner_transition(source.replace(old,new,1))
        self.assertLess(source.index("(out/recycle_artifact).write_text"), source.index('result,evidence=normalize_recycle_display'))
        self.assertIn('==original_panel_html)', source)

    def test_benchmark_fixed_null_model_assertions_and_all_prior_comparisons_are_retained(self):
        source = (ROOT/BENCHMARK).read_text()
        assert_exact_benchmark_transition(source)
        # These are exact source mutations, not claims of JavaScript execution.
        for old, new in [('assert.equal(draft.mission, "transport"', 'assert.notEqual(draft.mission, "recycle"'),
                         ('assert.equal(view.recyclePreview, null', 'assert.notEqual(view.recyclePreview, undefined'),
                         ('assert.equal(index, 4', 'assert.ok(index >= 0'),
                         ('assert.equal(keys.filter(key => key === "recyclePreview").length, 1', 'assert.ok(true'),
                         ('keys.slice(2, 6)', 'keys.slice(2, 5)'), ('delete result.recyclePreview;', 'delete result.recyclePreview;delete result.unknown;'),
                         ('const result = structuredClone(view);', 'const result = view;')]:
            with self.subTest(old=old), self.assertRaises(AssertionError): assert_exact_benchmark_transition(source.replace(old, new, 1))
        self.assertIn('const request = deepFreeze({ mission: "transport"', source)
        self.assertIn('assert.deepEqual({ ...historicalSpace(currentFullSpace,"full")', source)
        self.assertIn('normalizedOriginalSpace[key], `space split ${key}`)', source)


if __name__ == '__main__':
    unittest.main()
