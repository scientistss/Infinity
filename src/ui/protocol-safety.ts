import { protocolSentence, slotUnlockHint, unlockedSlotCount } from "../automation/engine";
import type { GameState } from "../game/types";

export function protocolSlotPermissions(state: GameState, index: number, writable: boolean) {
  const open = unlockedSlotCount(state), card = state.protocols.slots[index]?.card;
  const unlocked = index >= 0 && index < open;
  return {
    unlocked, present: !!card,
    canToggle: writable && !!card && (unlocked || card.enabled),
    canClear: writable && !!card,
    canEdit: writable && unlocked,
    canMoveUp: writable && unlocked && index > 0,
    canMoveDown: writable && unlocked && index + 1 < open,
  };
}

/** Locked cards remain visible and removable; they never gain new authority here. */
export function installProtocolSafety(root: HTMLElement) {
  let state: GameState | null = null, writable = false;
  let lastSlots: GameState["protocols"]["slots"] | null = null, lastOpen = -1, lastWritable = false;
  const slots = [...root.querySelectorAll<HTMLElement>("[data-slot]")].map(node => {
    const index = Number(node.dataset.slot);
    const controls = node.querySelector<HTMLElement>(`[data-bind="slot-controls-${index}"]`)!;
    const lock = node.querySelector<HTMLElement>(`[data-bind="slot-lock-${index}"]`)!;
    const enabled = node.querySelector<HTMLInputElement>(`[data-bind="slot-enabled-${index}"]`)!;
    const sentence = node.querySelector<HTMLElement>(`[data-bind="slot-sentence-${index}"]`)!;
    const params = node.querySelector<HTMLElement>(`[data-bind="slot-params-${index}"]`)!;
    const clear = node.querySelector<HTMLButtonElement>('[data-action="slot-clear"]')!;
    const warning = document.createElement("p");
    warning.dataset.demolitionSlotWarning = String(index); warning.hidden = true;
    controls.append(warning);
    return { node, index, controls, lock, enabled, sentence, params, clear, warning };
  });
  const put = (node: HTMLElement, text: string) => { if (node.textContent !== text) node.textContent = text; };
  function update() {
    if (!state) return;
    for (const slot of slots) {
      const card = state.protocols.slots[slot.index]?.card;
      const permissions = protocolSlotPermissions(state, slot.index, writable);
      const unlocked = permissions.unlocked;
      slot.lock.hidden = unlocked;
      if (!unlocked) put(slot.lock, slotUnlockHint(state, slot.index));
      slot.controls.hidden = !unlocked && !card;
      slot.enabled.checked = card?.enabled ?? false;
      // A saved enabled locked card can only transition to explicitly off.
      slot.enabled.disabled = !permissions.canToggle;
      slot.clear.disabled = !writable || (!unlocked && !card);
      if (!unlocked && card) put(slot.sentence, protocolSentence(card));
      slot.warning.hidden = unlocked || !card;
      if (!unlocked && card) put(slot.warning, card.enabled
        ? "此槽已回锁，配置与启用状态保留，当前不执行。解锁后可能重建目标；可先关闭或卸下。"
        : "此槽已回锁，配置已关闭且保留；解锁不会自动启用。可卸下，不能启用、装配或修改。" );
      for (const input of slot.params.querySelectorAll<HTMLSelectElement>("select")) input.disabled = !permissions.canEdit;
      for (const button of slot.node.querySelectorAll<HTMLButtonElement>('[data-action="slot-move"]')) {
        // Keep the original unlocked-slot presentation. The shared engine also
        // rejects moves into a locked destination; locked sources cannot move.
        button.disabled = !permissions.canEdit;
      }
      const drag = slot.node.querySelector<HTMLElement>("[data-slot-drag]");
      if (drag) drag.draggable = writable && unlocked;
    }
  }
  for (const type of ["click", "change", "input", "drop", "dragstart"]) root.addEventListener(type, event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const slot = target.closest<HTMLElement>("[data-slot]");
    if (!slot || !state) return;
    const index = Number(slot.dataset.slot), card = state.protocols.slots[index]?.card;
    const open = unlockedSlotCount(state);
    const clearing = type === "click" && !!target.closest('[data-action="slot-clear"]');
    const turningOff = (type === "change" || type === "input") && target instanceof HTMLInputElement && target.dataset.field === "enabled" && !target.checked && !!card?.enabled;
    const offControl = type === "click" && !!card?.enabled && !!target.closest("label.check");
    if (!writable || (index >= open && !clearing && !turningOff && !offControl)) {
      event.preventDefault(); event.stopImmediatePropagation(); update();
    }
  }, true);
  return {
    update,
    observe(next: GameState, ready: boolean) {
      state = next; writable = ready;
      const open = unlockedSlotCount(next);
      if (lastSlots !== next.protocols.slots || lastOpen !== open || lastWritable !== ready) update();
      lastSlots = next.protocols.slots; lastOpen = open; lastWritable = ready;
    },
  };
}
