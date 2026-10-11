import { big } from "../game/decimal";
import { activePlanet } from "../game/empire";
import { npcAt } from "../game/galaxy";
import { quoteFlight, type FleetRequest } from "../game/fleet";
import type { GameState } from "../game/types";

/** Ephemeral DOM authority. Neither datasets nor saved fleet IDs grant permission. */
export interface NpcActionAuthority { readonly nonce: number }
export type NpcAttackUiAction =
  | { type: "send-fleet"; request: FleetRequest; npcAuthority: NpcActionAuthority }
  | { type: "recall-fleet" | "npc-retry-dock"; id: number; npcAuthority: NpcActionAuthority };
type LiveCapability = { epoch: number; originId: string; kind: "route" | "recall" | "retry"; key: string; phase: string; retired: boolean };
type Issued = { action: NpcAttackUiAction; button: HTMLButtonElement; epoch: number; originId: string; draft: string; request: string | null };
const draftRetired = "存档、来源或保护状态已改变；请实际修改攻击草稿，或重新从银河选择攻击目标。";

export function installNpcAttackControls(root: HTMLElement, readRequest: () => FleetRequest, onAction: (action: NpcAttackUiAction) => void) {
  function get<T extends HTMLElement = HTMLElement>(selector: string): T { const node = root.querySelector<T>(selector); if (!node) throw Error(`缺少攻击控件 ${selector}`); return node; }
  const panel = get("#space-fleet"), galaxy = get("#space-galaxy"), list = get("#space-fleets");
  const mission = get<HTMLSelectElement>("#flight-mission"), send = get<HTMLButtonElement>("#space-send"), clear = get<HTMLButtonElement>('[data-space="attack-clear-cargo"]');
  const options = get("#npc-attack-options"), status = get("#npc-attack-draft-status");
  const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ship],#flight-mission,#flight-speed,#flight-galaxy,#flight-system,#flight-position,#cargo-metal,#cargo-crystal,#cargo-deuterium")];
  const cargo = ["metal", "crystal", "deuterium"].map(id => get<HTMLInputElement>(`#cargo-${id}`));
  const mounted = [panel, galaxy, list, send, clear, options, status, ...inputs];
  let state: GameState | null = null, writable = false, observed = false, mountRetired = false;
  let epoch = 0, nonce = 0, worldKey = "", originId = "", lastDraft = "", retiredReason = "", quoteOK = false;
  let issued = new WeakMap<NpcActionAuthority, Issued>();
  const capabilities = new WeakMap<HTMLButtonElement, LiveCapability>();
  const live = new Map<HTMLButtonElement, LiveCapability>();
  const watched = new Set<Node>();
  const signature = () => JSON.stringify(inputs.map(input => input.value));
  const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
  const isAttack = () => mission.value === "attack";
  function cargoHasContent() {
    // Inspect retained raw fields, even after a removed ancestor. Calling the
    // form reader here could throw while retiring a partly replaced form.
    return cargo.some(input => {
      const value = input.value.trim();
      return value.length >= 100 || !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !big(value).eq(0);
    });
  }
  function phaseOf(id: number) {
    const fleet = state?.fleets.find(value => value.id === id), phase = fleet?.npcAttack?.phase;
    return fleet?.mission === "attack" && phase ? { fleet, phase, key: JSON.stringify(phase) } : null;
  }
  function liveEligible(button: HTMLButtonElement, cap: LiveCapability) {
    if (!state || !writable || mountRetired || cap.retired || cap.epoch !== epoch || !button.isConnected || !root.contains(button)) return false;
    if (cap.kind === "route") {
      if (!galaxy.contains(button)) return false;
      const values = cap.key.split(":").map(Number);
      return !!npcAt(state, { galaxy: values[0]!, system: values[1]!, position: values[2]! });
    }
    const actual = phaseOf(Number(cap.key));
    return list.contains(button) && !!actual && actual.fleet.originId === cap.originId && actual.key === cap.phase
      && (cap.kind === "recall" ? actual.phase.kind === "outbound" && actual.fleet.remaining > 0
        : actual.phase.kind === "returning" && actual.phase.dockBlocked && actual.fleet.remaining === 0);
  }
  function sync() {
    const attack = isAttack(); options.hidden = !attack;
    for (const input of cargo) input.readOnly = attack;
    clear.hidden = !attack || !cargoHasContent();
    clear.disabled = !writable || mountRetired || !state;
    if (attack) {
      send.textContent = "付费出征";
      send.disabled = !writable || mountRetired || !!retiredReason || !quoteOK || !state;
      text(status, mountRetired ? "攻击控件已被替换，请重新载入页面。" : retiredReason || (cargoHasContent() ? "攻击须空载；清空仅修改草稿。" : ""));
    } else send.textContent = "派遣舰队";
    for (const [button, cap] of live) button.disabled = !liveEligible(button, cap);
  }
  function watch(node: Node) {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) if (!watched.has(parent)) { observer.observe(parent, { childList: true }); watched.add(parent); }
  }
  function retireRemoved(records: MutationRecord[]) {
    let changed = false;
    for (const record of records) for (const removed of record.removedNodes) {
      if (!(removed instanceof Element)) continue;
      if (mounted.some(node => removed === node || removed.contains(node))) { mountRetired = true; issued = new WeakMap(); }
      for (const [button, cap] of live) if (removed === button || removed.contains(button)) { cap.retired = true; button.disabled = true; live.delete(button); changed = true; }
    }
    if (mountRetired) { observer.disconnect(); sync(); }
    else if (changed) { observer.disconnect(); watched.clear(); for (const node of mounted) watch(node); for (const button of live.keys()) watch(button); }
  }
  const observer = new MutationObserver(retireRemoved);
  for (const node of mounted) watch(node);
  function intact() {
    retireRemoved(observer.takeRecords());
    return !mountRetired && root.isConnected && mounted.every(node => node.isConnected && root.contains(node)
      && (node.id ? root.querySelector(`#${node.id}`) === node : node === clear ? root.querySelector('[data-space="attack-clear-cargo"]') === node : root.querySelector(`[data-ship="${node.dataset.ship}"]`) === node));
  }
  function active() { return intact() && !document.hidden && !panel.hidden && !!state && writable; }
  function edited(explicitRoute = false) {
    if (!intact()) return;
    const next = signature(), changed = next !== lastDraft; lastDraft = next;
    if ((changed || explicitRoute) && state && writable && !panel.hidden && !document.hidden) { retiredReason = ""; issued = new WeakMap(); }
    quoteOK = false; sync();
  }
  for (const type of ["input", "change"]) root.addEventListener(type, event => {
    if (!inputs.includes(event.target as HTMLInputElement) || type === "change" && !(event.target instanceof HTMLSelectElement)) return;
    edited();
  });
  function mint(button: HTMLButtonElement, action: Omit<Extract<NpcAttackUiAction, { type: "send-fleet" }>, "npcAuthority"> | { type: "recall-fleet" | "npc-retry-dock"; id: number }) {
    const authority = Object.freeze({ nonce: ++nonce });
    const complete = { ...action, npcAuthority: authority } as NpcAttackUiAction;
    issued.set(authority, { action: complete, button, epoch, originId, draft: signature(), request: complete.type === "send-fleet" ? JSON.stringify(complete.request) : null });
    onAction(complete);
  }
  return {
    edited,
    retirePending() { issued = new WeakMap(); },
    paint(ok: boolean) { quoteOK = ok; intact(); sync(); },
    observe(next: GameState, ready: boolean, protection: string) {
      const key = `${next.universe.seed}:${next.stats.launches}`, nextOrigin = activePlanet(next).id;
      if (observed && (key !== worldKey || nextOrigin !== originId || writable !== ready)) {
        epoch++; issued = new WeakMap(); retiredReason = !ready ? `${protection || "存档受保护"}；恢复后请重新确认攻击草稿。` : draftRetired;
        lastDraft = signature();
        for (const [button, cap] of live) { cap.retired = true; button.disabled = true; }
      }
      if (!observed) lastDraft = signature();
      state = next; writable = ready; observed = true; worldKey = key; originId = nextOrigin;
      if (!ready) retiredReason = `${protection || "存档受保护"}；恢复后请重新确认攻击草稿。`;
      // No quoting, battle formatting or wallet observation on a skipped frame.
      if (!ready || retiredReason || mountRetired) sync();
      else for (const [button, cap] of live) if (!liveEligible(button, cap)) button.disabled = true;
    },
    register(button: HTMLButtonElement, kind: LiveCapability["kind"], key: string) {
      intact();
      if (capabilities.has(button) || mountRetired || !state) return;
      const actual = kind === "route" ? null : phaseOf(Number(key));
      const cap: LiveCapability = { epoch, kind, key, originId: actual?.fleet.originId ?? originId, phase: actual?.key ?? "", retired: !writable };
      capabilities.set(button, cap); live.set(button, cap); watch(button); button.disabled = !liveEligible(button, cap);
    },
    route(button: HTMLButtonElement, navigate: () => void) {
      if (!intact() || galaxy.hidden || document.hidden || button.disabled) return;
      const cap = capabilities.get(button);
      if (!cap || cap.kind !== "route" || !liveEligible(button, cap) || button.dataset.coordinate !== cap.key || button.dataset.mission !== "attack") return;
      navigate(); edited(true);
    },
    clearCargo(button: HTMLButtonElement) {
      if (button !== clear || clear.disabled || !active() || !isAttack()) return;
      for (const input of cargo) input.value = "0";
      edited();
    },
    send(button: HTMLButtonElement) {
      if (button !== send || send.disabled || !active() || !isAttack() || retiredReason) return;
      const request = readRequest();
      // A displayed quote is information only. The actual latest state decides.
      if (!quoteFlight(state!, request).ok) { quoteOK = false; sync(); return; }
      mint(button, { type: "send-fleet", request });
    },
    fleetAction(button: HTMLButtonElement, kind: "recall" | "retry") {
      if (!active() || button.disabled) return;
      const cap = capabilities.get(button);
      if (!cap || cap.kind !== kind || !liveEligible(button, cap) || button.dataset.fleet !== cap.key) return;
      mint(button, { type: kind === "recall" ? "recall-fleet" : "npc-retry-dock", id: Number(cap.key) });
    },
    consume(action: NpcAttackUiAction, current: GameState) {
      const entry = issued.get(action.npcAuthority); issued.delete(action.npcAuthority);
      if (!entry || entry.action !== action || current !== state || !active() || entry.epoch !== epoch || entry.originId !== originId || entry.button.disabled) return false;
      if (action.type === "send-fleet") return entry.button === send && !retiredReason && isAttack() && entry.draft === signature() && entry.request === JSON.stringify(action.request) && entry.request === JSON.stringify(readRequest()) && quoteFlight(current, action.request).ok;
      const cap = capabilities.get(entry.button);
      return !!cap && cap.kind === (action.type === "recall-fleet" ? "recall" : "retry") && cap.key === String(action.id) && liveEligible(entry.button, cap);
    },
    completeSend(ok: boolean) {
      if (!ok) return;
      for (const input of inputs) if (input.dataset.ship) input.value = "0";
      lastDraft = signature(); retiredReason = "舰队已出发；请重新编成后再出征。"; issued = new WeakMap(); quoteOK = false; sync();
    },
    invalidate() {
      epoch++; issued = new WeakMap(); lastDraft = signature(); retiredReason = draftRetired;
      for (const [button, cap] of live) { cap.retired = true; button.disabled = true; }
      state = null; quoteOK = false; sync();
    },
    get writable() { return writable; },
    get generation() { return epoch; },
  };
}
