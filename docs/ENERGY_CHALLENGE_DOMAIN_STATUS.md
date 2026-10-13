# Energy tightening domain checkpoint

Unreleased, unmounted domain and v9/r16 persistence checkpoint based on the
atomic building-template source checkpoint `56c16a1c73e24347919141c2b789655ae59e82cb`.
This branch is not the development or deployed version.

Implemented: doubled mine energy demand; bounded downward-quantized production
score; four actual paid home-building completion proofs; explicit one-use
entry, abandonment and successful finish; one additional ordinary queue slot;
automatic-curvature restrictions; complete supported historical migration and
protected rejection of unknown r15 data. See `ENERGY_CHALLENGE_SPEC.md` for the
exact rules and limitations.

Local Node 24 verification on 2026-10-13: 251 tests in the four domain, score,
save and migration files passed. An additional 22 UI tests passed in the larger
local integration workspace, but that UI is not included in this checkpoint.
Independent Python arithmetic review checked 36,216 rational-oracle cases and
6,000 subdivision cases. Those are not native browser or final CI acceptance.

The whole-workspace TypeScript check is still red on legacy fixture-generator
current-revision literals and a Node-only diagnostic script's type imports.
The natural two-curvature route, inactive-world differential, native controls,
four widths, complete legacy gates and final source identities remain pending.
No release, development-branch promotion or Site update is authorized by this
checkpoint alone. Historical r15 recovery remains outside this implementation.
