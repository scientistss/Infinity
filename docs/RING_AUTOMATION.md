# Bounded ring automation

Automatic ring reveals require a fresh, explicit batch authorization. Equipping or enabling a card, changing a parameter, receiving a beacon, and loading an old save never creates that authorization. The ring still opens at Astrophysics 1; the automatic runner unlocks after ten manual reveals. New runner cards start disabled and reveal one ticket per eligible pass.

## What an authorization contains

- A fixed source planet.
- The exact ordered IDs of a chosen prefix of currently stored tickets.
- A frozen copy of the standing bets.
- A maximum gross deuterium spend and a cumulative spent amount.
- One shared completion cursor, even when several runner slots are enabled.

The count must be positive, within current storage capacity, and no larger than the current queue. Caps are finite, nonnegative decimal strings. An already armed batch cannot be replaced by another arm request: stop or finish it first. This also makes repeated clicks or action retries harmless.

The card's `all` setting means all remaining tickets in the authorized snapshot. Newly issued beacons, topups, bonus tickets, charge receipts, and tickets created by a tailwind are outside the snapshot. They require another explicit authorization.

## Before each automatic reveal

The game checks the source, ticket identities and order, remaining cursor, frozen bets, cap and cumulative spend. It calculates the next actual stake using current production on the fixed source world. If that stake exceeds either the remaining gross allowance or the source's wallet, the batch stops without consuming a ticket or falling back to an unbet reveal. Winnings never replenish the spending allowance. Extremely large numeric settlement inputs stop before a ticket is consumed.

The gross-spend ledger and cap comparisons use exact decimal arithmetic. A tiny debit cannot disappear into a large previously spent amount. The existing resource wallet uses floating mantissas, so an automatic debit must decrease that wallet and agree with the quoted amount within one part per billion. Unsupported precision stops the batch before settlement.

Settlement and jackpot selection both use the frozen bets. The player's current planet selection and standing bets are restored afterward. Charge receipts replay already-settled events and cost zero; they never pay or deduct a second time.

Each result is first computed as an immutable candidate and checked against the current save validator. If a reward would exceed inventory, ship, or another persistence limit, the candidate is discarded. The original ticket, wallet, random state, and completion cursor remain unchanged, and the batch stops with a reason.

## Stop boundaries

A manual reveal, manual bet change, clearing bets, stopping or disabling the runner, clearing or replacing its slot, changing its parameters, a successful prestige, or abandonment of its source stops the batch. Stopping disables every run-lights slot. Completion and validation failures also stop it. The completed count, gross spend, original ticket list and bounded stop reason remain available for review. Toggling a stopped card on cannot revive its authority.

Manual odds, pre-rolled outcomes, pity, payouts and the existing insufficient-funds manual behavior are unchanged. Automated bet-edit actions are unavailable and old runtime cards fail closed.

## Identity and persistence

Each ticket receives a positive safe integer ID at issuance. IDs are monotonic and never generated during reveal. The maximum safe integer is an exhausted counter, not an issued ID. In-flight charges reserve both queue capacity and ID capacity. Exhausted topups and charge dispatches are rejected before payment; an invalid exhausted due charge returns without a reroll and refunds its existing escrow at arrival.

Revision 4 persists IDs and batch authority. Earlier revisions receive deterministic IDs and have old run-lights and automatic bet-edit cards disabled before offline catch-up. A current armed save must preserve its exact remaining queue prefix, valid source, cap, spent amount and frozen bets. A stopped batch remains reviewable even if its old source no longer exists.


## Progressive manual-first controls

The actual manual unlock progress is shown beside the manual reveal buttons. Reaching the displayed threshold alone does not grant a card, equip a slot, or authorize spending: the view follows the actual unlock and slot state. Until a usable runner is equipped, an empty automation form is hidden and its fields disabled; manual controls and bets stay available under their existing rules. Equipped controls remain visible even when the ticket queue is empty.

An existing batch, including a stopped or completed batch, keeps its fixed source, completion count, gross spend and stop reason visible. An armed batch keeps its stop button outside the setup region. Hiding or showing controls preserves the input nodes and creates no new authorization. The existing save-session action guard and domain checks still decide whether an action may run.

## 存档保护中的星环操作

存档写入、读回校验失败或观察到另一标签页修改时，本页模拟和自动执行遵守 SaveSession 的冻结状态。星环中的开奖、押注、加注、授权、停止及自动输入同步禁用；概率、历史和原件导出仍可查看。保护提示直接显示保存会话原因，不因随后导出成功而消失。

冻结保留已保存的批次记录，并不伪装成一次成功停止。恢复必须走既有的已验证导入／重新开始或刷新路径，按当前实际状态重新计算权限；不会把旧界面的可用状态恢复到新世界。正常刷新可以保留合法、尚未完成的已保存授权；明确停止、曲率清除或替换后失效的旧批次不会由界面重建。

若当前槽已经写入但读回结果不确定，仍须区分当前磁盘内容与本页保留原件。跨标签冲突不能通过点击“停止”或再次授权绕过；先导出本页原件，再按保护提示恢复。
