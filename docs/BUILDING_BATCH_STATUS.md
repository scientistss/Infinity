# Multi-planet building template candidate

This candidate integrates one explicit application of a saved building template
to 2–4 selected owned planets. Each ordinary finite order retains its own fixed
local payer, goals and resource caps. The confirmation shows the total cap and
each planet's shortfall. Registration does not prepay construction or create
transport, recurring work, or a shared wallet.

The whole domain batch is prepared privately. The UI adopts it only after the
existing SaveSession write/readback succeeds. An uncertain write preserves the
original visible state under protection and retains recovery bytes; it does not
claim to roll back browser storage. Completed or already-covered goals are an
explicit no-op, including no save write.

The earlier domain-only checkpoint is
`a0a212cab84c5ac4419016a99912da220c31d8b1`. The published baseline remains
`6f73735534ffc1b0e47a01935d8c6e3ff786c989`, version 0.6.30-alpha.1. This candidate
uses 0.6.31-alpha.1 and retains save v9/r14. It is not a released version until
all eight required CI jobs and their exact-identity aggregate succeed.

## Local observations on 2026-10-13

- Node v24.19.0: 71 new domain, presenter and DOM-double tests passed. The wider
  focused source/presenter group passed 92 tests. TypeScript and the complete
  build passed, producing 62 hashed assets.
- The first complete local run passed 4,706 of 4,709 tests. One exact historical
  host-text assertion needed the newly approved retirement call; that assertion
  subsequently passed without changing its ordering or safety requirements.
  Two unchanged large-loop tests exceeded their original 5-second and
  15-second timeouts, also on the targeted follow-up. The earlier clean baseline
  had two timeouts, but not the same pair. These observations do not establish
  a complete local or cloud pass; no test limit was increased.
- The independent fixed-seed natural route starts with ordinary initial
  resources, pays for progression and real colonization, and reaches two
  planets. Its original diagnostic covered 2,520 logical seconds, four
  independently priced batch jobs, and exact final ownership. This is
  compressed simulation, not human wall-clock play.
- Additional synthetic 3/4-planet, capacity and authority cases are explicitly
  labeled. The final clean producer and native acceptance must be rerun at the
  final commit; earlier diagnostic hashes are not release evidence.

The required native job contains 25 fixed scenarios, including an unobserved
natural control, actual paid-job/owning-task identities, full-state protection
witnesses, exact storage-byte no-ops, and four viewport widths. It preserves raw
HTTP/V8 sources, screenshots and per-document event records. The aggregate
reopens those originals, the complete source ZIP and all assets, and requires
all eight jobs at the same source/build/runtime identity.

See [the bounded contract and evidence design](BUILDING_BATCH_SPEC.md). No
native browser or full CI success is claimed by this source checkpoint.
