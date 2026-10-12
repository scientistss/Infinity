# Parallel native acceptance

## r14 acceptance scheduling

The `d3798afa99ac0f7c0d89579b79792a21855c62df` candidate ran
[CI 38201857023](https://github.com/scientistss/Infinity/actions/runs/38201857023).
Its independent scout and orbital jobs succeeded. The `verify` job completed
3,934 unit tests and the preceding native functional suites, but its final paired
performance measurement was interrupted at the 45-minute job boundary. The job
conclusion is **cancelled**, not successful. Five complete performance runs and
part of the next run do not constitute the required paired performance result.
The original logs and artifact remain evidence of that incomplete attempt.

The acceptance workflow now divides the old native command sequence between two
isolated runners:

- `verify`: render scheduling, migration quota, SaveSession and replay oracles,
  NPC observations, building authority, and ring protection.
- `verify-continuation`: ordinary demolition, quotes, transport loading,
  terraforming, research network, natural ring progression, prepared imports,
  background/accounted time, expansion, curvature, formations, research and
  building templates, orders, the original space/deep-space/ring suites, and the
  complete paired presentation-performance measurement.
- `npc-orbital`: the complete independent paid-battle and report UI acceptance.
- `scout-rehearsal`: the complete independent historical-observation, three-public-
  sample rehearsal, draft authority, storage protection and four-width acceptance.

Both legacy runners repeat the exact source checkout, dependency installation,
build, unit tests, domain/fixture preparation and fixed historical source setup.
This repeats setup work; it does not replace any browser assertion with a build
or unit result. Browser command order within each group and each suite's original
watchdog, observation windows and input arguments remain unchanged. The
performance script itself is unchanged and runs on its own runner after the
continuation's functional tests; it never competes with another job on that
runner. Each suite creates its own browser/context and does not consume a prior
suite's localStorage. The HTTP services and fixture files required by either
sequence are prepared separately in each runner.

`required-gates` requires **all four** job conclusions to equal `success`. It
also requires identical nonempty SHA-256 identities for source, built assets,
release metadata and Node runtime across all four jobs, plus identical complete
orbital fixture-pool identities across both legacy runners and `npc-orbital`.
The scout fixture identity remains mandatory. A missing, skipped, cancelled or
failed job, or any identity disagreement, rejects the aggregate.

Artifacts have distinct names. Both legacy jobs retain always-uploaded source,
built files and whichever reports were actually produced; absent reports cannot
be treated as passing evidence. Publishing still requires the exact candidate's
complete aggregate and artifact review. This scheduling change does not make
any earlier incomplete candidate successful, change gameplay, shorten tests,
extend the 45-minute legacy job limit or waive a performance failure.
