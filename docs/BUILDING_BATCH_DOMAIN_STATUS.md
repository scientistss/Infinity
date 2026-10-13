# Multi-planet building template: domain checkpoint

This checkpoint adds an unmounted domain API for one explicit application of an existing building template to 2–4 distinct owned planets. Each resulting ordinary finite order keeps a fixed local payer, target and independent resource caps. Registration is atomic and does not pay the caps in advance. No save field or migration is introduced.

This is a source recovery checkpoint, not a playable release. The published game remains 0.6.30-alpha.1 at 6f73735534ffc1b0e47a01935d8c6e3ff786c989. UI integration, new native acceptance, complete current production provenance and the full required cloud gate are still pending.

On 2026-10-13, the new domain suite passed 54 tests with local Node v24.19.0. It covers independent payment goldens, fixed identities, whole-batch rejection, paid and paused coverage, capacity/exhaustion, exact no-op, strict readback, later local scheduling, and cancellation. This local result does not substitute for Node 22 CI or native browser evidence.

The unchanged public baseline was also tested locally: 4,630 of 4,632 tests passed. Two pre-existing large loops exceeded their unchanged 5-second and 15-second limits in this environment, with the targeted rerun reporting the same timeouts. The published candidate and promotion CI results remain historical facts; no new full-green result is claimed here.

Follow-on implementation must keep the whole batch invisible until the existing SaveSession write/readback succeeds. An uncertain storage write must preserve the original visible state and recovery bytes under protection; it cannot promise automatic rollback of bytes already written by the browser. Explicit zero-op must not write a save.
