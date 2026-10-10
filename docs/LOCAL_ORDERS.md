# Finite local plans

Local plans authorize a fixed, finite goal on one selected paying/executing planet:

- Buildings: reach a specified finished level on that planet.
- Research: reach an empire research level, paid by the selected planet and using its lab.
- Shipyard: build an additional specified number of ships or defenses for this plan. Existing inventory does not count toward the quantity.

Local mode does not dispatch shipments or transfer resources. Explicit single-source authorization is a separate optional mode described in [bounded transport](TRANSPORT_ORDERS.md). Selecting another planet never moves a plan or changes its payer.

## Authorization and budgets

Creating a plan does not spend resources. Each form has a single-use creation number; repeated clicks cannot create the same authorization twice. Edit the form or start a new plan to obtain another creation number. A plan's target, payer, quantity and three resource budgets are fixed. Pausing or continuing never resets its spending or grants more budget.

The scheduler pays through the same real building, research and shipyard queues as manual actions. A plan owns at most one paid queue entry at a time. Existing manual or protocol building/research entries can cover the goal, but their costs are never adopted into the plan's ledger. Each shipyard batch is a finite affordable part of the remaining goal, chosen with bounded binary search.

Net committed spending is `charged − refunded`, independently for metal, crystal and deuterium. It must stay within the authorized budget. Only a successful economic refund increases the refund ledger. Cancelled units already completed remain spent. Repricing refunds are the exact decimal difference between old and new paid snapshots; shipyard refunds use the saved per-unit price times the unfinished count. Historical charge and refund totals remain available until the finished record is dismissed.

Budgets and ledgers accept nonnegative decimal amounts, including scientific notation, up to `1e190` and 18 fractional decimal places. Inputs are bounded to 256 characters. Unsupported precision or an out-of-range cumulative ledger is rejected rather than rounded. This exact accounting describes economic price quotes; the underlying inventory wallet still uses floating-point large-number arithmetic. Each positive plan debit or refund must move the wallet in the correct direction and match its quote within a relative tolerance of `1e-9`. An unrepresentable transfer pauses the plan without consuming money or an identity. Wallet rounding dust is never added to the ledger.

## Scheduling and conflicts

Running plans are checked every 10 simulated seconds in both live and offline play. The first check occurs ten seconds after an idle scheduler is activated. A pass visits plans by ascending stable plan ID and makes at most one enqueue attempt per plan. Between passes, normal queues continue to work. With no running plans, the scheduler creates no simulation boundaries.

At a shared boundary, existing queue completions, fleet arrivals, beacon rewards, event-triggered protocols and periodic protocols keep their existing priority. The plan pass follows them. Thus manual work and protocols can occupy capacity or spend resources before plans. There is no promise that competing plans receive equal resources.

Insufficient resources, prerequisites, queue capacity or remaining budget leave a plan waiting. There is no hidden top-up. Precision or identity failures pause it. Limits are 32 unfinished plans, 100 retained records, target level 1,000 and additional unit quantity 1,000,000. Only one unfinished plan can target a planet/building pair, a planet/unit pair, or an empire-wide research technology. Dismiss finished records to free history capacity; stable IDs are never reused.

## Pause, cancellation and lifecycle

- Pause blocks new payment while already-paid work continues.
- Continue uses the original goal, progress and remaining budget.
- Cancel refunds and removes the exact owned paid job, then ends the plan. If refunding cannot safely succeed, all queue/refund changes are rejected, the original job remains, and the plan pauses.
- Cancelling a plan's paid queue entry directly pauses its owner, preserving completed unit credit.
- Queue cancellation uses planet, queue kind and globally stable job ID. Stale controls cannot cancel whatever later occupies the same array position.
- Dark matter and item acceleration call the same completion bookkeeping as elapsed simulation time. Repeated completion notifications cannot award the same units twice.
- Colonial prestige terminates unfinished plans and drops their paid work without inventing refunds. It retains charge/refund history and both next-ID counters, and resets scheduler time.
- A colony with an unfinished plan cannot be abandoned, including when the plan is paused. End that plan first.

Every shipyard enqueue also reserves safe integer headroom for stock, queued units and known inbound return/deployment ships. If another reward consumes capacity later, completion produces only a safe quantity and keeps the paid remainder waiting. This is a shipyard guard, not a claim that every unrelated legacy reward source has been redesigned.

## Saves

Revision 6 persists authorizations, fixed payer/target fields, exact ledgers, stable queue identities and ship completion watermarks. Current saves must have matching real paid jobs and ownership receipts. Invalid relationships are rejected rather than silently recreated. Legacy queue migration assigns deterministic identities without inventing historical completion or changing old costs and timers.
