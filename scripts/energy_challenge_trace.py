"""Energy-specific adapter for the audited read-only native clock observer.

No browser, Node, network or state mutation runs while preparing this plan.
The existing frame grammar is reused from an isolated module, with only the
independently strict r16 handler and serializer recognizers supplied by caller.
"""
from copy import deepcopy
from dataclasses import replace
import importlib.util
from pathlib import Path
import re
import sys
from types import SimpleNamespace

_NAME = '_energy_native_frame_trace_base'
_spec = importlib.util.spec_from_file_location(_NAME, Path(__file__).with_name('native_frame_trace.py'))
BASE = importlib.util.module_from_spec(_spec)
sys.modules[_NAME] = BASE
_spec.loader.exec_module(BASE)
class NativeFrameTrace(BASE.NativeFrameTrace):
    """Expose original binding/resolution receipts and optional host-only capture."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_event = None

    def _record(self, row):
        count = len(self.events)
        super()._record(row)
        if len(self.events) != count and self.on_event is not None:
            try:
                self.on_event(deepcopy(self.events[-1]))
            except (AssertionError, KeyError, ValueError, TypeError) as error:
                self.failures.append({'hostBoundaryCapture': str(error)})

    def snapshot(self):
        return {**super().snapshot(), 'bindingName': self.binding,
                'scriptParsed': deepcopy(self.scripts), 'resolutions': deepcopy(self.resolutions),
                'probeBindings': [{'breakpointId': ident, 'kind': row['probe'].kind,
                    'request': {'url': self.plan.url, **location(self.plan.source, row['probe'].start),
                                'condition': row['condition']}}
                    for ident, row in self.bindings.items()]}


def freeze_manual_boundary(observer, storage_events, marker):
    """Copy host evidence at the callback boundary; never stop native clocks/RAF."""
    prefix = through_manual_save(observer.events, marker)
    assert prefix == observer.events, 'Capture must occur synchronously at the manual result'
    snapshot = observer.snapshot()
    assert snapshot['events'] == prefix and not snapshot['failures']
    storage = deepcopy(storage_events)
    writes = [row['newValue'] for row in storage
              if row.get('key') == KEY and row['kind'] in ('added', 'updated')]
    return {'trace': snapshot, 'storageEvents': storage, 'writes': writes,
            'marker': marker, 'endSequence': prefix[-1]['sequence']}

to_replay_epoch = BASE.to_replay_epoch
through_manual_save = BASE.through_manual_save
location = BASE.location
source_offset = BASE.source_offset
KEY = 'infinity.original-p4.save.v1'


def class_end(source, start):
    """Bound a minified class, treating its quoted/template text as opaque."""
    assert source[start]=='{';depth=0;quote=None;escaped=False
    for index in range(start,len(source)):
        char=source[index]
        if quote:
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char==quote:quote=None
        elif char in ('"',"'",'`'):quote=char
        elif char=='{':depth+=1
        elif char=='}':
            depth-=1
            if depth==0:return index+1
        elif char=='/':
            # Its only unquoted slash is division by a numeric time unit.
            # Comments/regex require a different audited grammar.
            assert re.match(r'/[0-9]',source[index:]), 'Unsupported slash in SaveSession class'
    raise AssertionError('Unterminated original SaveSession class')


def prepare_plan(url, body, digest, handlers, serializers):
    BASE._RING = SimpleNamespace(production_action_handlers=handlers, production_serializers=serializers)
    plan = BASE.prepare_plan(url, body, digest)
    handler = handlers(plan.source)[0]
    state, session = handler.group('state'), handler.group('session')
    serializer = serializers(plan.source)[0].group('name')
    # Independently require the complete transaction, including its successful
    # native write, readback equality, and only then expectedRaw adoption.
    ident = BASE.ID
    write = BASE.unique(
        rf'writeCandidate\((?P<raw>{ident}),(?P<preserve>{ident})\)\{{if\(!this.store\)return this.blocked\(\);'
        rf'try\{{if\(this.expectedRaw===void 0&&\(this.expectedRaw=this.store.getItem\((?P<key>{ident})\),'
        rf'this.protectedRaw=this.expectedRaw\),this.compareCurrent\(\),(?P=preserve)&&this.expectedRaw!==null\)'
        rf'\{{const (?P<backup>{ident})={ident}\(this.store,this.expectedRaw\);'
        rf'if\(this.store.getItem\((?P=backup)\)!==this.expectedRaw\)throw new Error\("原存档备份校验失败"\)\}}'
        rf'if\(this.compareCurrent\(\),(?P=raw)!==this.expectedRaw&&this.store.setItem\((?P=key),(?P=raw)\),'
        rf'this.store.getItem\((?P=key)\)!==(?P=raw)\)throw new Error\("当前存档写入后校验失败"\);'
        rf'return this.expectedRaw=(?P=raw),this.protectedRaw=null,this.mode="ready",this.notice=null,'
        rf'this.message="已保存到本地",\{{ok:!0\}}\}}catch\((?P<error>{ident})\)'
        rf'\{{return (?P=error) instanceof {ident}\?this.conflict\(\):this.protect\((?P=error)\)\}}\}}',
        plan.source, 'complete compare/native write/native readback/adopt transaction')
    instance=BASE.unique(re.escape(session)+rf'=new (?P<class>{ident})\(',plan.source,'original session class binding')
    constructor=BASE.unique(r'class '+re.escape(instance.group('class'))+rf'\{{constructor\(',plan.source,'original write owner')
    start=plan.source.index('{',constructor.start());end=class_end(plan.source,start)
    assert start<write.start()<write.end()<end, 'Write/readback transaction must belong to the observed SaveSession class'
    read=next(probe for probe in plan.probes if probe.kind=='source-read')
    save=next(probe for probe in plan.probes if probe.kind=='save-result')
    assert start<read.start<save.start<write.start(), 'Original constructor/saveCurrent/writeCandidate member order required'
    probes = []
    for probe in plan.probes:
        payload = probe.payload
        if probe.kind == 'ready':
            payload += (f',loaded:(({{state,gains,...rest}})=>({{...rest,gains:{{metal:gains.metal.toString(),'
                        f'crystal:gains.crystal.toString(),deuterium:gains.deuterium.toString()}}}}))({session}.loaded),'
                        f'primaryRaw:localStorage.getItem("{KEY}"),backupRaw:localStorage.getItem("{KEY}.backup")')
        elif probe.kind == 'save-result':
            payload += f',visibleState:{serializer}({state}),primaryRaw:localStorage.getItem("{KEY}"),backupRaw:localStorage.getItem("{KEY}.backup")'
        probes.append(replace(probe, payload=payload))
    return replace(plan, probes=tuple(probes))
