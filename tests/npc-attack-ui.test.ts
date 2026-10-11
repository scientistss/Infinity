import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { big } from "../src/game/decimal";
import { activePlanet } from "../src/game/empire";
import { advanceFleets, emptyCargo, nextFleetEvent, sendFleet, type FleetRequest, type Mission } from "../src/game/fleet";
import * as fleetRules from "../src/game/fleet";
import { createInitialState } from "../src/game/state";
import { npcBattleDetails, npcBattleReportsView, npcBattleRounds } from "../src/ui/npc-battle-present";
import { installNpcAttackControls, type NpcAttackUiAction } from "../src/ui/npc-attack-controls";
import { spaceFleetView, spaceGalaxyView } from "../src/ui/space-present";

const TARGET = { galaxy: 1, system: 56, position: 6 };
function ready() {
  const state = createInitialState(20261010, 97531), planet = activePlanet(state);
  planet.resources = { metal: big(1e6), crystal: big(1e6), deuterium: big(1e6) }; planet.buildings.shipyard = 2;
  Object.assign(planet.units, { light_fighter: 1000, small_cargo: 1000 });
  Object.assign(state.research.levels, { combustion_drive: 2, computer_tech: 100, weapons_tech: 1 });
  return state;
}
const request = (): FleetRequest => ({ mission: "attack", target: TARGET, ships: { light_fighter: 20, small_cargo: 2 }, cargo: emptyCargo(), speedPercent: 100 });
function battle() { const launch = sendFleet(ready(), request()); expect(launch.ok, launch.reason).toBe(true); return advanceFleets(launch.state, nextFleetEvent(launch.state)); }

describe("NPC attack historical presentation", () => {
  it("routes only real NPC rows without exposing live stock or garrison", () => {
    const state = ready(), before = JSON.stringify(state);
    const rows = spaceGalaxyView(state, TARGET).rows;
    expect(rows.find(row => row.position === 6)?.canRouteAttack).toBe(true);
    expect(rows.find(row => row.position === 16)?.canRouteAttack).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/garrison|stock|驻军数量|当前资源/);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("shows exact fuel, quotas, origin, actual returning ships and loot", () => {
    const state = battle(), before = JSON.stringify(state), view = spaceFleetView(state, request());
    expect(view.isAttack).toBe(true); expect(view.attackQuota).toContain("攻击 1/64 · 目标账 1/512");
    expect(view.quote.text).toContain(`往返燃料 ${fleetRules.quoteFlight(state, request()).fuel.toString()} 重氢`);
    expect(view.fleets[0].phase).toBe("战后返航"); expect(view.fleets[0].canRecall).toBe(false);
    expect(view.fleets[0].detail).toContain(`金属 ${state.fleets[0].cargo.metal.toString()}`);
    expect(JSON.stringify(state)).toBe(before);
  });
  it("keeps all battle content historical across current tech/stock/name changes", () => {
    const state = battle(), report = state.npcBattles.reports[0], before = npcBattleDetails(report), rounds = npcBattleRounds(report);
    activePlanet(state).name = "另一个来源名"; state.research.levels.weapons_tech = 99;
    activePlanet(state).resources.metal = big(1); const snapshot = JSON.stringify(state);
    expect(npcBattleDetails(report)).toEqual(before); expect(npcBattleRounds(report)).toEqual(rounds);
    expect(before.source).toContain(report.originId); expect(before.tech).not.toContain("武器 99");
    expect(before.loot).toContain(`金属 ${report.loot[0]}`); expect(JSON.stringify(before)).not.toContain("stockBefore");
    expect(JSON.stringify(state)).toBe(snapshot);
  });
  it("labels blocked delivery independently and keeps the whole cargo visible", () => {
    const state = battle(), fleet = state.fleets[0];
    fleet.remaining = 0; fleet.npcAttack = { ...fleet.npcAttack!, phase: { kind: "returning", reason: "battle", dockBlocked: true } };
    const view = spaceFleetView(state, request());
    expect(view.fleets[0].remaining).toBe("入港受阻"); expect(view.fleets[0].detail).toContain("舰船与货物仍在舰队");
    expect(view.fleets[0].canRetryDock).toBe(true); expect(npcBattleReportsView(state)[0].delivery).toBe("入港受阻");
    state.fleets = []; expect(npcBattleReportsView(state)[0].delivery).toBe("交付状态不可确认");
  });
  it("shows saved zero-round collection and retains all live reports beyond 60", () => {
    const state = battle(), original = state.npcBattles.reports[0];
    const empty = { ...original, battle: { ...original.battle, defenderBefore: {}, defenderAfter: {}, rounds: [] } };
    state.npcBattles = { ...state.npcBattles, reports: Array.from({ length: 124 }, (_, i) => ({ ...empty, fleetId: i + 1, delivery: i < 60 ? "delivered" as const : "returning" as const })) };
    const view = npcBattleReportsView(state);
    expect(view).toHaveLength(124); expect(view[0].summary).toContain("无驻军收集 · 0 回合");
    expect(npcBattleRounds(empty)).toEqual([]);
  });
});

/** Controller double only. The GitHub native suite is the layout/interaction witness. */
class NodeDouble {
  parentElement: NodeDouble | null = null; children: NodeDouble[] = [];
  dataset: Record<string,string> = {}; listeners = new Map<string, Array<(event:{target:NodeDouble}) => void>>();
  hidden=false;disabled=false;readOnly=false;textContent="";value="";connectedRoot=false;
  constructor(public id="") {}
  get parentNode():NodeDouble|null{return this.parentElement;}
  get isConnected():boolean{return this.connectedRoot||!!this.parentElement?.isConnected;}
  contains(node:NodeDouble):boolean{return node===this||this.children.some(child=>child.contains(node));}
  append(child:NodeDouble){child.parentElement?.remove(child);child.parentElement=this;this.children.push(child);}
  remove(child:NodeDouble){this.children=this.children.filter(value=>value!==child);child.parentElement=null;for(const observer of ObserverDouble.instances)if(observer.parents.has(this))observer.records.push({removedNodes:[child]} as unknown as MutationRecord);}
  matches(selector:string):boolean {
    if(selector.startsWith("#"))return this.id===selector.slice(1);
    if(selector==="[data-ship]")return !!this.dataset.ship;
    const match=/^\[data-(ship|space)="(.+)"\]$/.exec(selector);return !!match&&this.dataset[match[1]]===match[2];
  }
  querySelectorAll(selector:string):NodeDouble[]{const result:NodeDouble[]=[];const visit=(node:NodeDouble)=>{for(const child of node.children){if(selector.split(",").some(part=>child.matches(part)))result.push(child);visit(child);}};visit(this);return result;}
  querySelector(selector:string){return this.querySelectorAll(selector)[0]??null;}
  addEventListener(type:string,callback:(event:{target:NodeDouble})=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),callback]);}
  emit(type:string,target:NodeDouble=this){for(const listener of this.listeners.get(type)??[])listener({target});}
}
class SelectDouble extends NodeDouble {}
class ObserverDouble {
  static instances:ObserverDouble[]=[]; parents=new Set<NodeDouble>();records:MutationRecord[]=[];
  constructor(_callback:MutationCallback){ObserverDouble.instances.push(this);}
  observe(parent:NodeDouble,options:MutationObserverInit){expect(options).toEqual({childList:true});this.parents.add(parent);}
  disconnect(){this.parents.clear();}takeRecords(){const records=this.records;this.records=[];return records;}
}
const asButton=(node:NodeDouble)=>node as unknown as HTMLButtonElement;
function controlsFixture(initialize = true) {
  const doc=new NodeDouble();doc.connectedRoot=true;const body=new NodeDouble();doc.append(body);const root=new NodeDouble("app");body.append(root);
  const make=(id:string,parent=root,value="",select=false)=>{const node=select?new SelectDouble(id):new NodeDouble(id);node.value=value;parent.append(node);return node;};
  const panel=make("space-fleet"),galaxy=make("space-galaxy"),list=make("space-fleets",panel);galaxy.hidden=true;
  const mission=make("flight-mission",panel,"attack",true),speed=make("flight-speed",panel,"100",true);
  const g=make("flight-galaxy",panel,"1"),s=make("flight-system",panel,"56"),p=make("flight-position",panel,"6");
  const ship=make("",panel,"20");ship.dataset.ship="light_fighter";
  const cargoShip=make("",panel,"2");cargoShip.dataset.ship="small_cargo";
  const metal=make("cargo-metal",panel,"0"),crystal=make("cargo-crystal",panel,"0"),deuterium=make("cargo-deuterium",panel,"0");
  const options=make("npc-attack-options",panel),status=make("npc-attack-draft-status",options),send=make("space-send",panel),clear=make("",panel);clear.dataset.space="attack-clear-cargo";
  const state=ready(),actions:NpcAttackUiAction[]=[];
  const read=():FleetRequest=>({mission:mission.value as Mission,target:{galaxy:Number(g.value),system:Number(s.value),position:Number(p.value)},ships:{light_fighter:Number(ship.value),small_cargo:Number(cargoShip.value)},cargo:{metal:big(Number.isFinite(Number(metal.value))&&metal.value.trim()?metal.value:-1),crystal:big(Number.isFinite(Number(crystal.value))&&crystal.value.trim()?crystal.value:-1),deuterium:big(Number.isFinite(Number(deuterium.value))&&deuterium.value.trim()?deuterium.value:-1)},speedPercent:Number(speed.value)});
  const controls=installNpcAttackControls(root as unknown as HTMLElement,read,action=>actions.push(action));
  const edit=(node:NodeDouble,value:string,type="input")=>{node.value=value;root.emit(type,node);};
  const paint=()=>controls.paint(fleetRules.quoteFlight(state,read()).ok);
  expect(fleetRules.quoteFlight(state,read()).ok,fleetRules.quoteFlight(state,read()).reason).toBe(true);
  if (initialize) { controls.observe(state,true,"");paint(); }
  return {doc,body,root,panel,galaxy,list,options,mission,speed,ship,metal,crystal,deuterium,send,clear,status,state,actions,controls,edit,paint,read,make};
}
// Count setter calls, including redundant same-value writes that would still
// reach the DOM. These are work-count witnesses, not browser timing claims.
function trackDomWrites(...nodes: NodeDouble[]) {
  const writes = vi.fn();
  for (const node of nodes) for (const property of ["hidden", "disabled", "readOnly", "textContent"] as const) {
    let value = node[property];
    Object.defineProperty(node, property, {
      configurable: true, get: () => value,
      set(next: typeof value) { writes(node.id, property, next); value = next; },
    });
  }
  return writes;
}
function liveFleetFixture(kind: "recall" | "retry" = "recall", count = 4, renewDraft = true) {
  const f = controlsFixture(), state = sendFleet(f.state, f.read()).state, original = state.fleets[0];
  state.fleets = Array.from({ length: count }, (_, index) => ({
    ...original, id: index + 1, remaining: kind === "recall" ? 1 : 0,
    npcAttack: { ...original.npcAttack!, phase: kind === "recall" ? { kind: "outbound" as const } : { kind: "returning" as const, reason: "battle" as const, dockBlocked: true } },
  }));
  f.controls.observe(state, true, "");
  if (renewDraft) f.edit(f.ship, "21");
  const buttons = state.fleets.map(fleet => {
    const button = f.make("", f.list); button.dataset.fleet = String(fleet.id);
    f.controls.register(asButton(button), kind, button.dataset.fleet);
    expect(button.disabled).toBe(false);
    return button;
  });
  return { ...f, state, buttons };
}
beforeEach(()=>{ObserverDouble.instances=[];vi.stubGlobal("Element",NodeDouble);vi.stubGlobal("HTMLSelectElement",SelectDouble);vi.stubGlobal("MutationObserver",ObserverDouble);vi.stubGlobal("document",{hidden:false});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("NPC ephemeral paid-action controls",()=>{
  it("preserves raw cargo until explicit draft-only clear, and restores editing on transport",()=>{
    const f=controlsFixture(),before=JSON.stringify(f.state);f.edit(f.mission,"transport","change");f.edit(f.metal,"001.250");f.edit(f.crystal,"nonsense");
    f.edit(f.mission,"attack","change");f.paint();expect(f.metal.value).toBe("001.250");expect(f.crystal.value).toBe("nonsense");expect(f.metal.readOnly).toBe(true);expect(f.send.disabled).toBe(true);
    f.edit(f.mission,"transport","change");expect(f.metal.readOnly).toBe(false);expect(f.crystal.value).toBe("nonsense");
    f.edit(f.mission,"attack","change");f.controls.clearCargo(asButton(f.clear));expect([f.metal.value,f.crystal.value,f.deuterium.value]).toEqual(["0","0","0"]);expect(f.actions).toHaveLength(0);expect(JSON.stringify(f.state)).toBe(before);
  });
  it("consumes the exact dispatch action once, rejects copies and clears ships only after success",()=>{
    const f=controlsFixture();f.controls.send(asButton(f.send));const action=f.actions[0];expect(action).toBeDefined();
    expect(f.controls.consume({...action},f.state)).toBe(false);
    // The copied token consumes neither the original draft nor any economics.
    f.controls.send(asButton(f.send));const fresh=f.actions[1];expect(f.controls.consume(fresh,f.state)).toBe(true);expect(f.controls.consume(fresh,f.state)).toBe(false);
    f.controls.completeSend(false);expect(f.ship.value).toBe("20");f.controls.completeSend(true);expect(f.ship.value).toBe("0");f.paint();expect(f.send.disabled).toBe(true);
    f.controls.send(asButton(f.send));expect(f.actions).toHaveLength(2);
  });
  it("rechecks current rules and rejects altered payload or edited drafts after callback issuance",()=>{
    const f=controlsFixture();f.controls.send(asButton(f.send));f.edit(f.ship,"21");expect(f.controls.consume(f.actions[0],f.state)).toBe(false);
    f.paint();expect(fleetRules.quoteFlight(f.state,f.read()).ok,fleetRules.quoteFlight(f.state,f.read()).reason).toBe(true);f.controls.send(asButton(f.send));const action=f.actions[1];if(action.type==="send-fleet")action.request.target={galaxy:1,system:56,position:7};expect(f.controls.consume(action,f.state)).toBe(false);
    f.state.research.levels.weapons_tech=0;f.send.disabled=false;f.controls.send(asButton(f.send));expect(f.actions).toHaveLength(2);
  });
  it("protects synchronously without a quote and needs a real edit after recovery",()=>{
    const f=controlsFixture(),quote=vi.spyOn(fleetRules,"quoteFlight");f.controls.observe(f.state,false,"存档写入失败");expect(quote).not.toHaveBeenCalled();expect(f.send.disabled).toBe(true);expect(f.status.textContent).toContain("存档写入失败");
    f.edit(f.ship,"21");f.controls.observe(f.state,true,"");f.paint();f.root.emit("input",f.ship);expect(f.send.disabled).toBe(true);
    f.edit(f.ship,"22");f.paint();expect(f.send.disabled).toBe(false);
  });
  it("invalidates same-seed imports and rejects old callback even after new real edits",()=>{
    const f=controlsFixture();f.controls.send(asButton(f.send));const action=f.actions[0];f.controls.invalidate();f.controls.observe(f.state,true,"");f.paint();expect(f.send.disabled).toBe(true);
    f.edit(f.ship,"21");f.paint();expect(f.send.disabled).toBe(false);expect(f.controls.consume(action,f.state)).toBe(false);
  });
  it.each(["button","same-id","panel","body"])("retires removed and reinserted %s before the observer callback",kind=>{
    const f=controlsFixture();if(kind==="body"){f.doc.remove(f.body);f.doc.append(f.body);}else if(kind==="panel"){f.root.remove(f.panel);f.root.append(f.panel);}else{f.panel.remove(f.send);f.panel.append(kind==="same-id"?new NodeDouble("space-send"):f.send);}
    f.send.disabled=false;f.controls.send(asButton(f.send));expect(f.actions).toHaveLength(0);f.edit(f.ship,"21");f.paint();expect(f.send.disabled).toBe(true);
  });
  it("requires visible original controls and checks live recall phase on both sides",()=>{
    const f=controlsFixture(),launch=sendFleet(f.state,f.read());expect(launch.ok).toBe(true);const state=launch.state;f.controls.observe(state,true,"");
    const button=f.make("",f.list);button.dataset.fleet=String(state.fleets[0].id);f.controls.register(asButton(button),"recall",button.dataset.fleet);
    f.controls.fleetAction(asButton(button),"recall");expect(f.actions).toHaveLength(1);state.fleets[0].remaining=0;expect(f.controls.consume(f.actions[0],state)).toBe(false);
    state.fleets[0].remaining=1;f.panel.hidden=true;button.disabled=false;f.controls.fleetAction(asButton(button),"recall");expect(f.actions).toHaveLength(1);
  });
  it("does not re-authorize old live buttons after remove/reinsert or protection",()=>{
    const f=controlsFixture(),state=sendFleet(f.state,f.read()).state;f.controls.observe(state,true,"");const b=f.make("",f.list);b.dataset.fleet=String(state.fleets[0].id);f.controls.register(asButton(b),"recall",b.dataset.fleet);
    f.list.remove(b);f.list.append(b);b.disabled=false;f.controls.fleetAction(asButton(b),"recall");f.controls.register(asButton(b),"recall",b.dataset.fleet);expect(f.actions).toHaveLength(0);
    f.controls.observe(state,false,"保护");f.controls.observe(state,true,"");b.disabled=false;f.controls.fleetAction(asButton(b),"recall");expect(f.actions).toHaveLength(0);
  });

  it("requires the current NPC route node and lets explicit rerouting renew an unchanged draft",()=>{
    const f=controlsFixture();f.controls.invalidate();f.controls.observe(f.state,true,"");f.panel.hidden=true;f.galaxy.hidden=false;
    const button=f.make("",f.galaxy);button.dataset.coordinate="1:56:6";button.dataset.mission="attack";f.controls.register(asButton(button),"route",button.dataset.coordinate);
    let navigations=0;const navigate=()=>{navigations++;f.panel.hidden=false;f.galaxy.hidden=true;};
    const clone=f.make("",f.galaxy);clone.dataset={...button.dataset};f.controls.route(asButton(clone),navigate);expect(navigations).toBe(0);
    f.controls.route(asButton(button),navigate);f.paint();expect(navigations).toBe(1);expect(f.send.disabled).toBe(false);
    expect(f.ship.value).toBe("20");expect(f.metal.value).toBe("0");
  });
  it("authenticates blocked docking against the current fleet and rejects a second stale callback",()=>{
    const f=controlsFixture(),state=battle(),fleet=state.fleets[0];fleet.remaining=0;fleet.npcAttack={...fleet.npcAttack!,phase:{kind:"returning",reason:"battle",dockBlocked:true}};
    f.controls.observe(state,true,"");const button=f.make("",f.list);button.dataset.fleet=String(fleet.id);f.controls.register(asButton(button),"retry",button.dataset.fleet);
    f.controls.fleetAction(asButton(button),"retry");expect(f.actions).toHaveLength(1);expect(f.controls.consume(f.actions[0],state)).toBe(true);
    state.fleets=[];expect(f.controls.consume(f.actions[0],state)).toBe(false);button.disabled=false;f.controls.fleetAction(asButton(button),"retry");expect(f.actions).toHaveLength(1);
  });
});


describe("NPC observer bounded work and authority counterexamples", () => {
  it.each([true, false])("synchronizes the first ready=%s observation even while hidden, without quoting", ready => {
    const f = controlsFixture(false), quote = vi.spyOn(fleetRules, "quoteFlight");
    f.panel.hidden = true; vi.stubGlobal("document", { hidden: true });
    f.controls.observe(f.state, ready, "只读存档");
    expect(f.options.hidden).toBe(false); expect(f.metal.readOnly).toBe(true); expect(f.clear.hidden).toBe(true);
    expect(f.send.textContent).toBe("付费出征"); expect(f.send.disabled).toBe(true); expect(f.clear.disabled).toBe(!ready);
    expect(f.status.textContent).toBe(ready ? "" : "只读存档；恢复后请重新确认攻击草稿。");
    expect(quote).not.toHaveBeenCalled();
    if (!ready) {
      f.controls.observe(f.state, false, "新的保护原因");
      expect(f.status.textContent).toContain("新的保护原因");
    }
  });

  it.each([true, false])("builds one fresh index per observe for 64 live fleet buttons (renewed draft=%s)", renewDraft => {
    const f = liveFleetFixture("recall", 64, renewDraft);
    const iterate = vi.spyOn(f.state.fleets, Symbol.iterator), find = vi.spyOn(f.state.fleets, "find"), quote = vi.spyOn(fleetRules, "quoteFlight");
    const writes = trackDomWrites(f.options, f.metal, f.crystal, f.deuterium, f.send, f.clear, f.status, ...f.buttons);
    f.controls.observe(f.state, true, "");
    expect(iterate).toHaveBeenCalledTimes(1); expect(find).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled();
    f.state.fleets[63].remaining = 0;
    f.controls.observe(f.state, true, "");
    expect(iterate).toHaveBeenCalledTimes(2); expect(find).not.toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled();
    expect(f.buttons[63].disabled).toBe(true); expect(f.buttons.slice(0, 63).every(button => !button.disabled)).toBe(true);
    expect(writes.mock.calls).toEqual([["", "disabled", true]]);
  });

  it.each(["none", "route", "retired", "removed"])("does not scan fleets with %s live fleet capabilities", situation => {
    const f = liveFleetFixture("recall", situation === "none" || situation === "route" ? 0 : 4);
    if (situation === "route") {
      const route = f.make("", f.galaxy); route.dataset.coordinate = "1:56:6"; route.dataset.mission = "attack";
      f.controls.register(asButton(route), "route", route.dataset.coordinate);
    } else if (situation === "retired") {
      f.controls.observe(f.state, false, "保护"); f.controls.observe(f.state, true, "");
    } else if (situation === "removed") {
      for (const button of f.buttons) f.list.remove(button);
      f.controls.paint(false); // Flush the removal records using the ordinary intact guard.
    }
    const iterate = vi.spyOn(f.state.fleets, Symbol.iterator), find = vi.spyOn(f.state.fleets, "find");
    f.controls.observe(f.state, true, ""); f.controls.observe(f.state, true, "");
    expect(iterate).not.toHaveBeenCalled(); expect(find).not.toHaveBeenCalled();
  });

  it.each(["panel", "document"])("does no redundant DOM writes while %s is hidden and still repairs changed properties", hidden => {
    const f = liveFleetFixture();
    f.controls.observe(f.state, false, "保护");
    if (hidden === "panel") f.panel.hidden = true; else vi.stubGlobal("document", { hidden: true });
    const writes = trackDomWrites(f.options, f.metal, f.crystal, f.deuterium, f.send, f.clear, f.status, ...f.buttons);
    const quote = vi.spyOn(fleetRules, "quoteFlight");
    for (let i = 0; i < 10; i++) f.controls.observe(f.state, false, "保护");
    expect(writes).not.toHaveBeenCalled(); expect(quote).not.toHaveBeenCalled();
    f.send.disabled = false; f.buttons[0].disabled = false; f.options.hidden = true; f.metal.readOnly = false; f.send.textContent = "错误标题";
    writes.mockClear(); f.controls.observe(f.state, false, "保护");
    expect(f.send.disabled).toBe(true); expect(f.buttons[0].disabled).toBe(true); expect(f.options.hidden).toBe(false);
    expect(f.metal.readOnly).toBe(true); expect(f.send.textContent).toBe("付费出征"); expect(writes).toHaveBeenCalledTimes(5);
  });

  it("skips same-value setters during repeated paint, input and mission synchronization", () => {
    const f = controlsFixture(), writes = trackDomWrites(f.options, f.metal, f.crystal, f.deuterium, f.send, f.clear, f.status);
    f.controls.paint(true); f.controls.paint(true); expect(writes).not.toHaveBeenCalled();
    f.root.emit("input", f.ship); expect(writes.mock.calls).toEqual([["space-send", "disabled", true]]);
    writes.mockClear(); f.root.emit("input", f.ship); expect(writes).not.toHaveBeenCalled();
    f.edit(f.mission, "transport", "change"); expect(f.send.textContent).toBe("派遣舰队"); expect(f.options.hidden).toBe(true);
    writes.mockClear(); f.root.emit("change", f.mission); expect(writes).not.toHaveBeenCalled();
  });

  it.each(["recall", "retry"] as const)("keeps first-match semantics for duplicate fleet IDs in %s", kind => {
    const f = liveFleetFixture(kind, 1), first = f.state.fleets[0], button = f.buttons[0];
    const ineligible = { ...first, mission: "transport" as const };
    f.state.fleets = [first, ineligible];
    f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(false);
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(1);
    f.state.fleets = [ineligible, first];
    f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(true);
    button.disabled = false;
    expect(f.controls.consume(f.actions[0], f.state)).toBe(false);
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(1);
  });

  it("does not give Map's NaN equality to malformed fleet keys", () => {
    const f = liveFleetFixture("recall", 1), button = f.make("", f.list);
    f.state.fleets[0].id = NaN; button.dataset.fleet = "NaN";
    f.controls.register(asButton(button), "recall", "NaN");
    button.disabled = false; f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(true);
    button.disabled = false; f.controls.fleetAction(asButton(button), "recall"); expect(f.actions).toHaveLength(0);
  });

  it.each(["recall", "retry"] as const)("does not retain an observe index across %s actions, phase changes or array replacement", kind => {
    const f = liveFleetFixture(kind, 1), button = f.buttons[0], original = f.state.fleets[0];
    f.controls.observe(f.state, true, "");
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(1);
    // Change the same object after issuance, without another observation.
    if (kind === "recall") original.remaining = 0;
    else Object.assign(original.npcAttack!.phase, { dockBlocked: false });
    expect(f.controls.consume(f.actions[0], f.state)).toBe(false);
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(1);
    original.remaining = kind === "recall" ? 1 : 0;
    original.npcAttack = { ...original.npcAttack!, phase: kind === "recall" ? { kind: "outbound" } : { kind: "returning", reason: "battle", dockBlocked: true } };
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(2);
    f.state.fleets = [];
    expect(f.controls.consume(f.actions[1], f.state)).toBe(false);
    f.controls.fleetAction(asButton(button), kind); expect(f.actions).toHaveLength(2);
    f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(true);
  });

  it.each(["panel", "document"])("keeps hidden %s handlers and consumption closed while observing live phase changes", hidden => {
    const f = liveFleetFixture(), button = f.buttons[0];
    f.controls.fleetAction(asButton(button), "recall"); expect(f.actions).toHaveLength(1);
    if (hidden === "panel") f.panel.hidden = true; else vi.stubGlobal("document", { hidden: true });
    expect(f.controls.consume(f.actions[0], f.state)).toBe(false);
    f.controls.fleetAction(asButton(button), "recall"); expect(f.actions).toHaveLength(1);
    f.state.fleets[0].remaining = 0; f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(true);
    f.state.fleets[0].remaining = 1; f.controls.observe(f.state, true, "");
    // This fixture renewed its draft: the ordinary observe branch only disables.
    // Same-epoch sync can re-enable a recovered phase; epoch retirement is separate.
    expect(button.disabled).toBe(true);
    f.panel.hidden = false; vi.stubGlobal("document", { hidden: false });
    f.controls.fleetAction(asButton(button), "recall"); expect(f.actions).toHaveLength(1);
  });

  it.each(["visible", "panel-hidden", "document-hidden"].flatMap(visibility =>
    ["seed", "origin", "protection", "same-seed-import"].map(change => ({ visibility, change })),
  ))("cannot revive old buttons or issued actions after $change while $visibility", ({ visibility, change }) => {
    const f = liveFleetFixture(), button = f.buttons[0], generation = f.controls.generation;
    f.controls.fleetAction(asButton(button), "recall"); const old = f.actions[0];
    if (visibility === "panel-hidden") f.panel.hidden = true;
    else if (visibility === "document-hidden") vi.stubGlobal("document", { hidden: true });
    // Observe every A→B→A transition while hidden, then challenge the old capability
    // only after visibility is restored, so the hidden guard cannot mask revival.
    if (change === "seed") {
      const seed = f.state.universe.seed;
      f.state.universe.seed++; f.controls.observe(f.state, true, "");
      f.state.universe.seed = seed; f.controls.observe(f.state, true, "");
    } else if (change === "origin") {
      const planet = activePlanet(f.state), id = planet.id;
      planet.id = "other-origin"; f.state.activePlanetId = planet.id; f.controls.observe(f.state, true, "");
      planet.id = id; f.state.activePlanetId = id; f.controls.observe(f.state, true, "");
    } else if (change === "protection") {
      f.controls.observe(f.state, false, "保护"); f.controls.observe(f.state, true, "");
    } else {
      // Explicit import invalidation applies even with the same seed, IDs and object.
      f.controls.invalidate(); f.controls.observe(f.state, true, "");
    }
    expect(f.controls.generation).toBeGreaterThan(generation); expect(button.disabled).toBe(true);
    f.panel.hidden = false; vi.stubGlobal("document", { hidden: false });
    f.edit(f.ship, "22"); f.controls.paint(true); button.disabled = false;
    f.controls.register(asButton(button), "recall", button.dataset.fleet);
    f.controls.fleetAction(asButton(button), "recall"); expect(f.actions).toHaveLength(1);
    expect(f.controls.consume(old, f.state)).toBe(false);
    f.controls.observe(f.state, true, ""); expect(button.disabled).toBe(true);
    const fresh = f.make("", f.list); fresh.dataset.fleet = button.dataset.fleet;
    f.controls.register(asButton(fresh), "recall", fresh.dataset.fleet);
    f.controls.fleetAction(asButton(fresh), "recall"); expect(f.actions).toHaveLength(2);
    expect(f.controls.consume(f.actions[1], f.state)).toBe(true);
  });

  it.each(["button", "wrapper", "panel", "body"])("flushes pending %s removal records before handlers and consume", removed => {
    const f = liveFleetFixture(), button = f.buttons[0];
    const wrapper = f.make("", f.list);
    if (removed === "wrapper") {
      // Use a newly registered node whose ancestor is already present at registration.
      const nested = f.make("", wrapper); nested.dataset.fleet = button.dataset.fleet;
      f.controls.register(asButton(nested), "recall", nested.dataset.fleet); f.buttons[0] = nested;
    }
    const target = f.buttons[0]; f.controls.fleetAction(asButton(target), "recall"); expect(f.actions).toHaveLength(1);
    const node = removed === "button" ? target : removed === "wrapper" ? wrapper : removed === "panel" ? f.panel : f.body;
    const parent = node.parentElement!; parent.remove(node); parent.append(node);
    target.disabled = false;
    expect(f.controls.consume(f.actions[0], f.state)).toBe(false);
    target.disabled = false; f.controls.fleetAction(asButton(target), "recall"); expect(f.actions).toHaveLength(1);
    f.controls.register(asButton(target), "recall", target.dataset.fleet);
    f.controls.fleetAction(asButton(target), "recall"); expect(f.actions).toHaveLength(1);
  });
});
