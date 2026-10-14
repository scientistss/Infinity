# Energy tightening: first playable contract

Status: accepted and released at [6af7a5e85a522ba89478c5e95d919a2c04fb2e55](https://github.com/scientistss/Infinity/commit/6af7a5e85a522ba89478c5e95d919a2c04fb2e55)
(0.6.32-alpha.1 / v9/r16), with all twelve required jobs and their aggregate
successful in [run 38505882754](https://github.com/scientistss/Infinity/actions/runs/38505882754). The exact artifact was separately verified and deployed successfully; the
additional promotion run is tracked separately in [current status](ENERGY_CHALLENGE_DOMAIN_STATUS.md).
These are this project's explicit challenge rules, not a claim about OGame.
Only fully validated same-lineage r2–r14 sources migrate; unknown r15 is protected.

## Player loop

UI path: 曲率 → 能源紧缩 → 核对入场并发射 → 继续，核对最新结果 →
final native confirmation. Review alone does not reset. For completion use
核对完成并发射; for abandonment use 核对放弃.

Both entry and successful finish perform the ordinary curvature reset: old
planets, stock, local units and fleets are cleared; paid unfinished work is
cancelled without refund. Completed research, curvature upgrades, banked dark
matter, items and saved designs follow the existing retention rules. Read the
fresh final confirmation for complete losses. Entry explicitly disables every
enabled automatic-curvature action, including locked slots; configuration stays.
Other cards retain their enabled settings.

At an ordinary, legally available manual curvature, the player may explicitly
choose to reset and enter **Energy tightening**. All player mines demand twice
their ordinary energy. Supply formulas, prices, storage, actual supply gates,
and the ordinary curvature reward are unchanged. Solar, satellite and fusion
strategies therefore retain their actual costs and tradeoffs.

The goal is 1,000,000 production points, plus new paid completions of the home
planet's metal mine, crystal mine, deuterium synthesizer and solar plant. All
four must still have level at least one when completing the challenge. Old
levels, cancelled jobs, direct level changes and merely queued work are not
completion proof. Actual accelerated completion uses the same paid-job hook.

The player then explicitly confirms a second legal curvature to finish. Its
ordinary reward and reset occur once, together with a bounded completion
receipt. That receipt raises each planet's building queue and the one empire-wide
research queue from two total positions to three, counting the active job.
Each building queue and the shared research queue remain serial, one active
job each; this is not three simultaneous builds/researches. The shipyard's
separate ten-order cap is unchanged. An active challenge still permits two.
Old legal 3–5-job paid queues are preserved and continue normally; only new
admissions use the current cap, so an over-cap queue must first drain below
that cap. Manual, protocol and finite-plan payments use the same admission check.
The completed receipt survives ordinary curvature; a new game clears it.

## Conservative production points

Only the pure production integration boundary counts. For each segment,
planet and resource, use the canonical wallet values before and after storage
limits and fusion consumption. Count the nonnegative net retained difference,
weighted metal 1, crystal 3, deuterium 10. Collection, packs, trade, transfers,
returning fleets, refunds and storage overflow do not count.

Each weighted positive contribution is rounded **down** to 10^-12 points.
Persist a canonical integer-unit string from 0 to 10^18, capped at the goal.
There is no epsilon, nearest rounding, or modification of the actual wallet.
Before the separate goal cap, quantization alone discards strictly fewer than
N × 10^-12 points for N contributing terms; production beyond the completed
goal is intentionally not retained as additional progress. Splitting a fixed
nonnegative contribution cannot award extra units; arbitrary simulation
segmentations are not claimed to produce bit-identical wallets or scores.

Scientific exponents are compared without allocating exponent-sized strings.
In particular, 1,000,000 minus 1e-1000 scores 10^18 minus one unit and is not a
completed goal. Legitimate extreme input must not freeze ordinary simulation.

## State, authority and migration matrix

| Operation/source | Required result |
| --- | --- |
| Fresh game or fully validated r2–r14 source | Inactive, zero score, no reward; all existing migration semantics preserved |
| Unknown r15 or unknown model/fields | Protected rejection with original bytes retained |
| Manual entry | Ordinary legal curvature, at least four issuable paid-job IDs, new attempt ID/home identity/job floor, empty proofs and zero score |
| Active production | Only the bounded score changes in the production hook |
| Actual home paid-job completion | Record one bounded proof for that building, tied to this attempt and post-entry job identity |
| Explicit abandonment | Keep the same economy and queues; discard this attempt, no reset/refund/reward |
| Manual successful finish | One ordinary curvature plus a complete receipt; ordinary queue capacity becomes three |
| Subsequent ordinary curvature | Keep the completed receipt and reward |
| New game | Clear the attempt and receipt |
| Cancelled/stale/duplicate/protected action or failed save/readback | Do not adopt a new phase, reward or economic candidate |

The model is `energy-tightening-v1`, with a bounded next-attempt counter and
mutually exclusive active/completion records. Proofs retain only four actual
paid jobs, not an unbounded event history. The finish receipt includes the
winning attempt, exact goal score, home levels, job ceiling, completion time
and ordinary gain. Strict readers validate their relationships; a standalone
completed flag cannot grant a queue position. This is local save consistency,
not cryptographic proof against a person rewriting an entire self-consistent
offline save. Active and completed records must also agree with the existing
curvature flag/count and monotonic paid-job floor; a completion receipt cannot
claim a finish after the current curvature job floor.

The four-ID entry check is necessary, not a guarantee that a chosen strategy
can finish. Curvature preserves the paid-job counter. The four first-level
proof buildings have no additional construction prerequisites and cost
408 metal / 144 crystal in the ordinary undiscounted catalog, within the new
home planet's 500 / 500 starting resources. Further production, storage and
resource-disposal choices still obey the ordinary economy and its limits.

Entry explicitly confirms disabling every enabled automatic-curvature card,
including locked slots, while preserving its configuration. During the
challenge it cannot be enabled or executed. Abandonment and completion leave
it disabled until the player manually enables it again. Other cards retain
their enabled settings. Finite plans remain usable during the challenge,
subject to the ordinary reset termination rules on entry and completion.

Review is an ephemeral UI intent. Final confirmation uses current consequences
and a fresh one-use domain quote synchronously, then the existing SaveSession
write/readback before adoption. Hidden/replaced controls, world/import/reset,
protection and active-planet changes retire old authority. A storage write of
unknown outcome does not imply disk rollback; visible state and recoverable
originals follow the existing protection contract.

## Required acceptance

Independent score goldens and bounded exponent tests; new-game to two legal
curvatures through paid production; solar and satellite routes; actual third
queue payments; cancellation/acceleration and auto-curvature guards; full
r2–r14 migrations, malformed receipts and unknown-revision protection; save,
backup, readback and cross-tab failures; four-width native controls; and all
existing required gates at the final source SHA. Earlier isolated timing
experiments establish a plausible route only, not this implementation's pass.
