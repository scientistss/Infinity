"""Exact pre-RAF autosave clock census; pure Python, no native execution."""
from copy import deepcopy
import json
import unittest
import energy_challenge_solar_census as S

URL='https://example.invalid/Infinity/'


def preframe_chain():
    def raw(counter,saved,last):
        return json.dumps({'version':9,'revision':16,'savedAt':saved,'lastTickAt':last,'state':{'counter':counter}})
    initial=raw(0,S.EPOCH,S.EPOCH);durable=initial;events=[];receipts=[]
    def write(new):
        nonlocal durable
        receipts.append({'kind':'updated','storageId':{'securityOrigin':'https://example.invalid','isLocalStorage':True},
                         'key':S.C.KEY,'oldValue':durable,'newValue':new})
        durable=new
    for i in range(23):
        context=i+3;document=f'00000000-0000-0000-0000-{i:012x}';at=S.EPOCH+(1000 if i else 0)
        def add(kind,**fields):
            events.append({'kind':kind,'sequence':len(events),'executionContextId':context,'documentId':document,'mode':'ready',**fields})
        add('source-read',raw=durable,constructorNow=at)
        add('ready',primaryRaw=durable,backupRaw=None,state={'counter':i},startupClock={'wallAt':at,'frameAt':0},
            lastTickAt=at,loaded={'rawSeconds':0,'appliedSeconds':0})
        if i==0:
            add('frame',now=0,gapSeconds=0,lastTickAtBefore=S.EPOCH)
            add('frame-end',now=0,lastTickAt=S.EPOCH,state={'counter':0})
            add('persist-input',background=True,nextStatus='已自动保存')
            new=raw(0,S.EPOCH+1000,S.EPOCH)
            add('save-input',expectedRaw=durable,state={'counter':0},savedAt=S.EPOCH+1000,lastTickAt=S.EPOCH)
            add('save-result',ok=True,candidateRaw=new,expectedRaw=new,primaryRaw=new,backupRaw=None,savedAt=S.EPOCH+1000,lastTickAt=S.EPOCH,visibleState={'counter':0})
            write(new)
            add('frame',now=1000,gapSeconds=1,lastTickAtBefore=S.EPOCH)
            add('frame-end',now=1000,lastTickAt=S.EPOCH+1000,state={'counter':0})
            at+=1000
        new=raw(i+1,at,at)
        add('save-input',expectedRaw=durable,state={'counter':i+1},savedAt=at,lastTickAt=at)
        add('save-result',ok=True,candidateRaw=new,expectedRaw=new,primaryRaw=new,backupRaw=None,savedAt=at,lastTickAt=at)
        write(new)
    records=[{'index':1,'api':'createInitialState','traceStart':0,'observationSequence':3,'traceEnd':4},
             {'index':2,'api':'tick','traceStart':4,'observationSequence':8,'traceEnd':9}]
    return initial,events,receipts,durable,records


class PreframeAutosaveClock(unittest.TestCase):
    def test_distinct_exact_write_wall_and_accounted_snapshot_preserve_complete_chain(self):
        first,events,receipts,last,records=preframe_chain()
        self.assertEqual(S.validate_storage(events,receipts,first,URL,records=records),last)
        self.assertEqual(S.preframe_autosave_wall(events,records,5,S.EPOCH),S.EPOCH+1000)
        self.assertEqual((events[5]['savedAt'],events[5]['lastTickAt']),(S.EPOCH+1000,S.EPOCH))
        with self.assertRaises(AssertionError):S.validate_storage(events,receipts,first,URL)

    def test_background_scope_identity_frame_and_clock_tampering_rejected(self):
        first,events,receipts,last,records=preframe_chain()
        mutations={
            'not-background':lambda e,r,s:e[4].update(background=False),
            'numeric-background':lambda e,r,s:e[4].update(background=1),
            'not-interval-autosave':lambda e,r,s:e[4].update(nextStatus='已保存到本地'),
            'wrong-persist-kind':lambda e,r,s:e[4].update(kind='action'),
            'wrong-save-context':lambda e,r,s:e[5].update(executionContextId=4),
            'wrong-prior-document':lambda e,r,s:e[3].update(documentId='other-document'),
            'wrong-next-document':lambda e,r,s:e[7].update(documentId='other-document'),
            'wrong-next-context':lambda e,r,s:e[7].update(executionContextId=4),
            'cross-record-persist':lambda e,r,s:r[1].update(traceStart=5),
            'cross-record-frame':lambda e,r,s:r[1].update(traceEnd=8),
            'wrong-record-observation':lambda e,r,s:r[1].update(observationSequence=7),
            'overlapping-record':lambda e,r,s:r[0].update(traceEnd=6),
            'not-tick-record':lambda e,r,s:r[1].update(api='enqueue'),
            'wrong-record-index':lambda e,r,s:r[1].update(index=3),
            'duplicate-owning-record':lambda e,r,s:r.append({**r[1],'index':3}),
            'autosave-mutated-visible-state':lambda e,r,s:e[6].update(visibleState={'counter':9}),
            'wrong-previous-full-state':lambda e,r,s:e[3].update(state={'counter':9}),
            'previous-observation-from-other-document':lambda e,r,s:e[3].update(documentId='old'),
            'tick-not-one':lambda e,r,s:e[7].update(gapSeconds=2),
            'boolean-tick':lambda e,r,s:e[7].update(gapSeconds=True),
            'fractional-tick':lambda e,r,s:e[7].update(gapSeconds=1.00000001),
            'wrong-frame-now':lambda e,r,s:e[7].update(now=1001),
            'wrong-frame-end-now':lambda e,r,s:e[8].update(now=1001),
            'wrong-frame-start-watermark':lambda e,r,s:e[7].update(lastTickAtBefore=S.EPOCH+1),
            'wrong-frame-end-watermark':lambda e,r,s:e[8].update(lastTickAt=S.EPOCH+999),
            'missing-next-full-state':lambda e,r,s:e[8].update(state=None),
            'protected-frame':lambda e,r,s:e[7].update(mode='protected'),
            'wrong-trace-sequence':lambda e,r,s:e[7].update(sequence=8),
            'saved-at-plus-one':lambda e,r,s:e[5].update(savedAt=S.EPOCH+1001),
            'saved-at-minus-one':lambda e,r,s:e[5].update(savedAt=S.EPOCH+999),
            'saved-at-two-ticks':lambda e,r,s:e[5].update(savedAt=S.EPOCH+2000),
            'last-tick-consumed-early':lambda e,r,s:e[5].update(lastTickAt=S.EPOCH+1000),
            'result-write-time-mismatch':lambda e,r,s:e[6].update(savedAt=S.EPOCH),
            'result-watermark-mismatch':lambda e,r,s:e[6].update(lastTickAt=S.EPOCH+1000),
            'failed-save-result':lambda e,r,s:e[6].update(ok=False),
            'storage-old-chain-tampered':lambda e,r,s:s[0].update(oldValue='tampered'),
            'storage-new-chain-tampered':lambda e,r,s:s[0].update(newValue='tampered'),
            'storage-write-missing':lambda e,r,s:s.pop(0),
            'storage-write-extra':lambda e,r,s:s.append(deepcopy(s[-1])),
        }
        for label,mutate in mutations.items():
            e,r,s=deepcopy(events),deepcopy(records),deepcopy(receipts);mutate(e,r,s)
            with self.subTest(label=label),self.assertRaises(AssertionError):S.validate_storage(e,s,first,URL,records=r)

    def test_extra_positive_frame_cannot_hide_after_owning_tick_observation(self):
        first,events,receipts,last,records=preframe_chain()
        events.insert(9,{'kind':'frame','sequence':9,'executionContextId':3,'documentId':events[7]['documentId'],
                         'mode':'ready','gapSeconds':1,'now':2000,'lastTickAtBefore':S.EPOCH+1000})
        for i,e in enumerate(events):e['sequence']=i
        records[1]['traceEnd']=10
        with self.assertRaises(AssertionError):S.validate_storage(events,receipts,first,URL,records=records)

    def test_native_saved_bytes_retain_both_exact_timestamps(self):
        first,events,receipts,last,records=preframe_chain()
        for field,value in [('savedAt',S.EPOCH),('lastTickAt',S.EPOCH+1000)]:
            e=deepcopy(events);raw=json.loads(e[6]['candidateRaw']);raw[field]=value
            for key in ('candidateRaw','expectedRaw','primaryRaw'):e[6][key]=json.dumps(raw)
            with self.subTest(field=field),self.assertRaises(AssertionError):S.validate_storage(e,receipts,first,URL,records=records)


if __name__=='__main__':unittest.main()
