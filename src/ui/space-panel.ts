import { installManualUnitControls, type ManualUnitUiAction } from "./manual-unit-controls";
import { installNpcAttackControls, type NpcActionAuthority, type NpcAttackUiAction } from "./npc-attack-controls";
import { updateLabBlockersProtection } from "./lab-blockers-panel";
import { installNpcBattlePanel, npcBattlePanelHtml } from "./npc-battle-panel";
import { installNpcScoutComparisonPanel, npcScoutComparisonPanelHtml } from "./npc-scout-comparison-panel";
import { isNpcScoutComparisonMessage } from "./npc-scout-comparison-model";
import { installNpcRehearsalPanel, npcRehearsalPanelHtml, NPC_REHEARSAL_FLYING_IDS, NPC_REHEARSAL_UNAVAILABLE, type NpcRehearsalDraft } from "./npc-rehearsal-panel";
import { installExpansionNavigation } from "./expansion-navigation";
import { installDemolitionPanel, type DemolitionUiAction } from "./demolition-panel";
import { installProtocolSafety } from "./protocol-safety";
import { installPrestigePreview } from "./prestige-preview";
import { formationsPanelHtml, installFormationsPanel, type FormationUiAction } from "./formations-panel";
import type { FleetFormation } from "../game/formation-state";
import { researchTemplatesPanelHtml, installResearchTemplatesPanel } from "./research-templates-panel";
import type { ResearchTemplateAction } from "../game/research-template-state";
import { buildingTemplatesPanelHtml, installBuildingTemplatesPanel } from "./building-templates-panel";
import type { BuildingTemplateAction } from "../game/building-template-state";
import { ordersPanelHtml, installOrdersPanel } from "./orders-panel";
import type { OrderAction } from "../game/order-state";
import { deepPanelHtml, installDeepPanel, type DeepAction } from "./deep-panel";
import { mountView as mountOriginal, type UiAction as OriginalAction } from "./planet-selector";
import { SPACE, wrap, coordinateKey, type Coordinates } from "../game/galaxy";
import { emptyCargo, quoteFlight, type FleetMessage, type FleetRequest, type Mission } from "../game/fleet";
import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { big } from "../game/decimal";
import { activePlanet } from "../game/empire";
import { formatDuration } from "../game/format";
import { npcRemainderView, transportLoadView } from "./space-present";
import { fillTransportCargo } from "./transport-load-model";
import type { SpaceView, SpaceGalaxyView, SpaceFleetView, SpaceMessagesView } from "./space-present";
import { RESOURCE_IDS, type GameState } from "../game/types";
export type UiAction = OriginalAction | ManualUnitUiAction | DeepAction | OrderAction | ResearchTemplateAction | BuildingTemplateAction | FormationUiAction | DemolitionUiAction | {type:"send-fleet";request:FleetRequest;npcAuthority?:NpcActionAuthority} | {type:"recall-fleet";id:number;npcAuthority?:NpcActionAuthority} | {type:"npc-retry-dock";id:number;npcAuthority:NpcActionAuthority} | {type:"abandon-colony";id:string};
const TABS=[{id:"orders",label:"计划",icon:"protocol_card.webp"},{id:"galaxy",label:"银河",icon:"tech.webp"},{id:"fleet",label:"舰队",icon:"shipyard.svg"},{id:"messages",label:"消息",icon:"save.webp"},{id:"deep",label:"深空",icon:"ring_machine.webp"}];
const enc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
function el<T extends HTMLElement=HTMLElement>(root:ParentNode,sel:string):T {const n=root.querySelector<T>(sel);if(!n)throw Error(`缺少界面节点 ${sel}`);return n;}
function put(root:ParentNode,sel:string,value:string){const n=el(root,sel);if(n.textContent!==value)n.textContent=value;}
function html(root:ParentNode,sel:string,value:string){const n=el(root,sel);if(n.dataset.signature!==value){n.innerHTML=value;n.dataset.signature=value;}}
const entry=(label:string,id:string,min:number,max:number,value:number)=>`<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" value="${value}" step="1" /></label>`;

/** The mounted view and the focused DOM test use this same narrow renderer. */
export function installSpaceChrome(root: HTMLElement, syncTabs: () => void) {
  return function updateSpaceChrome(origin: string, status: string) {
    syncTabs();
    for (const node of root.querySelectorAll<HTMLElement>(".space-location")) if (node.textContent !== origin) node.textContent = origin;
    for (const node of root.querySelectorAll<HTMLElement>(".space-status")) if (node.textContent !== status) node.textContent = status;
  };
}

/** Only the pending-right text is patched; existing controls and open details survive ticks. */
export function updateNpcRemainderDetail(row: HTMLElement, model: ReturnType<typeof npcRemainderView>): void {
  let details = row.querySelector<HTMLDetailsElement>(".npc-resource-remainder");
  if (!model) { details?.remove(); return; }
  if (!details) {
    details = document.createElement("details"); details.className = "npc-resource-remainder";
    const summary = document.createElement("summary"); summary.textContent = "不足 1 的待结算权益";
    const exact = document.createElement("p"); exact.className = "npc-remainder-exact";
    const notice = document.createElement("p"); notice.className = "npc-remainder-notice muted";
    details.append(summary, exact, notice); row.append(details);
  }
  put(details, ".npc-remainder-exact", model.exactText);
  put(details, ".npc-remainder-notice", model.notice);
}

/** Stable draft inputs, fresh per-click arithmetic, and a small DOM capability boundary. */
export function installTransportLoadControls(root:HTMLElement,readRequest:()=>FleetRequest) {
  const panel=el(root,"#space-fleet"),helper=el(root,"#transport-load-helper");
  const summary=el(root,"#transport-load-summary"),reason=el(root,"#transport-load-reason");
  const mission=el<HTMLSelectElement>(root,"#flight-mission");
  const inputs=[...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-ship],#flight-mission,#flight-speed,#flight-galaxy,#flight-system,#flight-position,#cargo-metal,#cargo-crystal,#cargo-deuterium")];
  const cargo=RESOURCE_IDS.map(id=>({id,input:el<HTMLInputElement>(root,`#cargo-${id}`),button:el<HTMLButtonElement>(root,`#transport-fill-${id}`)}));
  const mounted=[panel,helper,summary,reason,...inputs,...cargo.map(item=>item.button)];
  let state:GameState|null=null,writable=false,observed=false,mountRetired=false;
  let worldKey:string|null=null,retiredReason="",lastDraft="";
  let shown:ReturnType<typeof transportLoadView>=null;
  const text=(node:HTMLElement,value:string)=>{if(node.textContent!==value)node.textContent=value;};
  const signature=()=>JSON.stringify(inputs.map(input=>input.value));
  function syncGuard() {
    const hidden=mission.value!=="transport";
    if(helper.hidden!==hidden)helper.hidden=hidden;
    for(const item of cargo){
      const disabled=mountRetired||!writable||!state||!!retiredReason||hidden||!shown?.maxima[item.id].ok;
      if(item.button.disabled!==disabled)item.button.disabled=disabled;
    }
    if(mountRetired)text(reason,"运输装载控件已更换，请重新载入页面。");
    else if(retiredReason)text(reason,retiredReason);
  }
  function retireRemoved(records:MutationRecord[]) {
    if(mountRetired)return;
    for(const record of records)for(const removed of record.removedNodes){
      if(!(removed instanceof Element)||!mounted.some(node=>removed===node||removed.contains(node)))continue;
      mountRetired=true;shown=null;observer.disconnect();syncGuard();return;
    }
  }
  const observer=new MutationObserver(retireRemoved);
  // Only the direct parents of capability nodes and their ancestors. No root
  // subtree observer, fleet-card scan, or hidden-panel projection on a frame.
  const watched=new Set<Node>();
  for(const node of mounted)for(let parent=node.parentNode;parent;parent=parent.parentNode){
    if(!watched.has(parent)){observer.observe(parent,{childList:true});watched.add(parent);}
  }
  function controlsMounted() {
    retireRemoved(observer.takeRecords());
    return !mountRetired&&root.isConnected&&mounted.every(node=>node.isConnected&&root.contains(node)
      &&(node.id?root.querySelector(`#${node.id}`)===node:root.querySelector(`[data-ship="${node.dataset.ship}"]`)===node));
  }
  function update() {
    syncGuard();
    if(!controlsMounted()||helper.hidden||panel.hidden||document.hidden||!state)return;
    shown=transportLoadView(state,readRequest());
    if(shown){
      text(summary,shown.summary);
      if(!retiredReason)text(reason,shown.reason);
      for(const item of cargo)item.button.title=shown.maxima[item.id].reason;
    }
    syncGuard();
  }
  function edited() {
    if(!controlsMounted())return;
    const next=signature();
    // Delayed blur/change events and untouched values never renew an imported
    // or protected draft. Editing while protected cannot pre-authorize recovery.
    if(next!==lastDraft){lastDraft=next;if(state&&writable)retiredReason="";}
    update();
  }
  for(const type of ["input","change"])root.addEventListener(type,event=>{
    if(!inputs.includes(event.target as HTMLInputElement))return;
    if(type==="change"&&!(event.target instanceof HTMLSelectElement))return;
    edited();
  });
  for(const item of cargo)item.button.addEventListener("click",()=>{
    if(!controlsMounted()||item.button.disabled||panel.hidden||helper.hidden||document.hidden||mission.value!=="transport"||!state||!writable||retiredReason)return;
    // Never fill from the last painted maximum: stock, origin, engines, speed,
    // target and all three cargo fields are read again for this exact click.
    const result=fillTransportCargo(state,readRequest(),item.id);
    if(!result.ok||result.amount===null){update();text(reason,result.reason);return;}
    item.input.value=result.amount.toString();
    lastDraft=signature();
    update();
  });
  function invalidate(message="存档或世界已替换；请修改运输草稿后重新计算。") {
    lastDraft=signature();retiredReason=message;shown=null;state=null;syncGuard();
  }
  syncGuard();
  return {
    update,edited,invalidate,
    observe(next:GameState,ready:boolean,protectionMessage:string) {
      const nextWorld=`${next.universe.seed}:${next.stats.launches}`;
      if(worldKey!==null&&worldKey!==nextWorld)invalidate();
      if(!ready){
        if(!observed||writable)lastDraft=signature();
        retiredReason=`${protectionMessage||"存档受保护"}；恢复后请修改运输草稿再计算。`;
      }else if(observed&&!writable&&retiredReason){
        lastDraft=signature();retiredReason="存档保护状态已改变；请修改运输草稿后重新计算。";
      }
      if(!observed)lastDraft=signature();
      state=next;writable=ready;observed=true;worldKey=nextWorld;
      // Protection is applied synchronously even when rendering is skipped.
      // Normal frames only retain current references, never build a preview.
      if(!ready||retiredReason||mountRetired)syncGuard();
    },
  };
}

/** The real-form handoff and message identity adapter. It owns no send action.
 * A separate host token changes only on an explicitly adopted world. Ordinary
 * immutable state objects and matching saved IDs never define that boundary. */
export function installSpaceNpcRehearsal(root: HTMLElement, afterFill: (state: GameState) => void) {
  const list = el(root, "#space-message-list"), fleetPanel = el(root, "#space-fleet");
  const notice = el(root, "#npc-rehearsal-draft-notice");
  const mission = el<HTMLSelectElement>(root, "#flight-mission"), speed = el<HTMLSelectElement>(root, "#flight-speed");
  const targets = ["galaxy", "system", "position"].map(id => el<HTMLInputElement>(root, `#flight-${id}`));
  const cargo = RESOURCE_IDS.map(id => el<HTMLInputElement>(root, `#cargo-${id}`));
  const ships = NPC_REHEARSAL_FLYING_IDS.map(id => ({ id, node: el<HTMLInputElement>(root, `[data-ship="${id}"]`) }));
  const mounted = [fleetPanel, notice, mission, speed, ...targets, ...cargo, ...ships.map(ship => ship.node)];
  let state: GameState | null = null, writable = false, protection = "", world: object = {};
  let previousOrigin = "", previousWritable: boolean | null = null, retiredMount = false;
  let controller: ReturnType<typeof installNpcRehearsalPanel> | null = null;
  let comparison: ReturnType<typeof installNpcScoutComparisonPanel> | null = null;
  const rows = new Map<FleetMessage, HTMLElement>();
  const watched = new Set<Node>();
  function removed(records: MutationRecord[]) {
    for (const record of records) for (const node of record.removedNodes) {
      if (node instanceof Element && mounted.some(control => node === control || node.contains(control))) {
        retiredMount = true; controller?.invalidate("舰队草稿控件已被替换，请重新载入页面。"); observer.disconnect(); return;
      }
    }
  }
  const observer = new MutationObserver(removed);
  for (const node of mounted) for (let parent = node.parentNode; parent; parent = parent.parentNode) if (!watched.has(parent)) {
    watched.add(parent); observer.observe(parent, { childList: true });
  }
  function intact() {
    removed(observer.takeRecords());
    return !retiredMount && root.isConnected && mounted.every(node => node.isConnected && root.contains(node)
      && (node.id ? root.querySelector(`#${node.id}`) === node : ships.some(ship => ship.node === node && root.querySelector(`[data-ship="${ship.id}"]`) === node)))
      && root.querySelectorAll("[data-ship]").length === NPC_REHEARSAL_FLYING_IDS.length;
  }
  const request = (draft: NpcRehearsalDraft): FleetRequest => ({ mission: "attack", target: { ...draft.target }, ships: { ...draft.ships }, speedPercent: draft.speedPercent, cargo: emptyCargo() });
  const clearNotice = () => { notice.hidden = true; notice.textContent = ""; };
  function retire() { controller?.invalidate(); comparison?.invalidate(); for (const row of rows.values()) row.remove(); rows.clear(); }
  function observe(next: GameState, ready: boolean, reason: string) {
    const nextOrigin = activePlanet(next).id;
    if (state && (nextOrigin !== previousOrigin || ready !== previousWritable)) retire();
    state = next; writable = ready; protection = reason; previousOrigin = nextOrigin; previousWritable = ready;
    if (!controller) controller = installNpcRehearsalPanel(root, {
      readContext() {
        const current = state!, planet = activePlanet(current), levels = current.research.levels;
        return { adoptedWorld: world, messages: current.messages, origin: { id: planet.id, name: planet.name, coordinates: planet.coordinates }, landedShips: planet.units, formations: current.formations.entries,
          completedTech: { weapons: levels.weapons_tech, shields: levels.shielding_tech, armour: levels.armour_tech }, completedHyperspaceLevel: levels.hyperspace_tech, writable, protectionReason: protection };
      },
      quoteAttack(draft) {
        if (!state || !writable || activePlanet(state).id !== draft.originId || !intact()) return { ok: false, reason: protection || "当前星球、存档或舰队控件已改变。" };
        const quote = quoteFlight(state, request(draft));
        return { ok: quote.ok, reason: quote.reason };
      },
      fillDraft(draft, consume) {
        // Cache every original node before consuming. Never discover/write a
        // replacement node halfway through the transaction, and never dispatch.
        const current = state, adopted = world;
        if (!current || !writable || activePlanet(current).id !== draft.originId || !intact()) return { ok: false, reason: "舰队草稿或当前来源已改变，未填入。" };
        const quote = quoteFlight(current, request(draft));
        if (!quote.ok) return quote;
        if (!consume() || state !== current || world !== adopted || !writable || activePlanet(current).id !== draft.originId || !intact()) return { ok: false, reason: "演练审阅已失效，未填入。" };
        mission.value = "attack"; speed.value = String(draft.speedPercent);
        targets[0]!.value = String(draft.target.galaxy); targets[1]!.value = String(draft.target.system); targets[2]!.value = String(draft.target.position);
        for (const ship of ships) ship.node.value = String(draft.ships[ship.id]);
        for (const field of cargo) field.value = "0";
        afterFill(current);
        notice.textContent = "仅已填入，尚未派遣或付款。请核对最新航程报价，再单独点击付费出征。"; notice.hidden = false;
        return { ok: true, reason: "仅已填入，尚未派遣或付款。" };
      },
    });
    if (!comparison && root.querySelector("#npc-scout-comparison-panel")) comparison = installNpcScoutComparisonPanel(root, {
      readContext: () => ({ adoptedWorld: world, messages: state!.messages, writable, protectionReason: protection }),
    });
    controller.observe(); comparison?.observe();
    // Hidden message pages must not retain evicted typed history in a UI map.
    const retained = new Set(next.messages);
    for (const [message, row] of rows) if (!retained.has(message)) { row.remove(); rows.delete(message); }
  }
  function updateMessages() {
    if (!state || !controller || el(root, "#space-messages").hidden || document.hidden) return;
    const retained = new Set(state.messages);
    for (const [message, row] of rows) if (!retained.has(message)) { row.remove(); rows.delete(message); }
    // Empty placeholders are not capabilities and are removed only on transition.
    if (state.messages.length && !rows.size) list.replaceChildren();
    let previous: Element | null = null;
    for (const message of state.messages.slice().reverse()) {
      let row = rows.get(message);
      if (!row) {
        row = document.createElement("article"); row.className = "space-message";
        const time = document.createElement("small"), body = document.createElement("p"), historical = document.createElement("p");
        time.textContent = `游戏 ${formatDuration(Math.floor(message.at))}`; body.textContent = message.text; historical.className = "muted";
        const snapshot = message.npcScoutSnapshot;
        row.append(time, body);
        if (snapshot || message.id.startsWith("scout-")) {
          // The legacy ID is display classification only. It cannot create
          // historical data, a rehearsal button, or any action authority.
          row.dataset.messageId = message.id;
          historical.textContent = snapshot ? `历史情报，之后可能变化 · 抵达时间 ${snapshot.observedAt} 秒 · ${snapshot.model}` : NPC_REHEARSAL_UNAVAILABLE;
          row.append(historical);
        }
        rows.set(message, row);
        const next: Element | null = previous ? previous.nextElementSibling : list.firstElementChild; list.insertBefore(row, next);
        if (snapshot) { const button = document.createElement("button"); button.type = "button"; button.textContent = "打开历史侦察演练"; row.append(button); controller.registerReport(button, message); }
        if (comparison && isNpcScoutComparisonMessage(message)) { const button = document.createElement("button"); button.type = "button"; button.textContent = "历史对照"; button.dataset.npcScoutComparison = ""; row.append(button); comparison.registerReport(button, message); }
      } else {
        const next: Element | null = previous ? previous.nextElementSibling : list.firstElementChild;
        if (next !== row) list.insertBefore(row, next);
      }
      previous = row;
    }
    if (!state.messages.length && list.textContent !== "尚无航行记录。") { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = "尚无航行记录。"; list.replaceChildren(empty); }
  }
  for (const type of ["input", "change"]) root.addEventListener(type, event => {
    if (mounted.includes(event.target as HTMLElement)) clearNotice();
  });
  return {
    observe, updateMessages, retire, clearNotice,
    close() { controller?.close(); comparison?.close(); },
    adoptWorld() { retire(); world = {}; clearNotice(); },
  };
}

/** Add new tabs without altering original template, stylesheet, card positions or assets. */
export function mountView(root:HTMLElement,onAction:(a:UiAction)=>void) {
  const original=mountOriginal(root,onAction);
  const tabs=el(root,".tabs"),main=el(root,"main.wrap");
  for(const t of TABS){
    const b=document.createElement("button");b.type="button";b.className="tab";b.dataset.tab=t.id;b.dataset.spaceTab=t.id;b.setAttribute("role","tab");b.setAttribute("aria-selected","false");b.setAttribute("aria-controls",`space-${t.id}`);
    b.innerHTML=`<img class="icon icon-tab" src="${import.meta.env.BASE_URL}icons/${t.icon}" alt="" /><span>${t.label}</span>`;tabs.append(b);
  }
  const make=(id:string,title:string,body:string)=>`<section id="space-${id}" class="tab-panel space-panel" data-tab-panel="${id}" aria-labelledby="space-${id}-title" hidden><div class="panel-head"><h2 id="space-${id}-title">${title}</h2><p class="space-location"></p></div>${body}</section>`;
  main.insertAdjacentHTML("beforeend",make("galaxy","银河导航",`
    <div class="space-controls">${entry("银河","browse-galaxy",1,5,1)}${entry("恒星系","browse-system",1,100,50)}<button type="button" data-space="prev">上一星系</button><button type="button" data-space="browse">查看</button><button type="button" data-space="next">下一星系</button><button type="button" data-space="home">当前星球</button></div>
    <p class="muted" id="space-range"></p><p class="space-error" id="space-browse-error" role="status"></p>
    <div class="space-table-scroll" role="region" aria-label="银河坐标列表，可横向滚动" tabindex="0"><table class="ov-table space-table"><thead><tr><th>位置</th><th>星球 / 目标</th><th>状态</th><th>温度与格子</th><th>矿产加成</th><th>操作</th></tr></thead><tbody id="space-worlds"></tbody></table></div>
    <p class="muted">侦察查看抵达时的历史情报；攻击 NPC 轨道驻军可能永久损失舰船。第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。</p>
  `)+make("fleet","舰队指挥",`
    <p id="space-slots" class="chip"></p>
    <p id="formation-dispatch-source" class="muted" hidden></p><p id="npc-rehearsal-draft-notice" class="npc-rehearsal-draft-notice muted" role="status" hidden></p>${formationsPanelHtml()}
    <div class="space-columns"><div class="ov-card"><h3>1 · 编成舰队</h3><div class="space-ships">${SHIP_IDS.filter(id=>id!=="solar_satellite").map(id=>`<label class="space-ship"><span>${unitById(id).nameZh}<small id="available-${id}"></small></span><input type="number" min="0" max="${SPACE.maxShips}" step="1" value="0" data-ship="${id}" aria-label="${unitById(id).nameZh}派遣数量" /></label>`).join("")}</div></div>
    <div class="ov-card"><h3>2 · 任务与航程</h3><div class="space-controls"><label>任务<select id="flight-mission"><option value="colonize">殖民</option><option value="transport">运输</option><option value="deploy">部署</option><option value="scout">侦察</option><option value="attack">NPC 轨道攻击</option><option value="charge">深空充能</option><option value="recycle">残骸回收</option></select></label><label>速度<select id="flight-speed">${[100,90,80,70,60,50,40,30,20,10].map(n=>`<option value="${n}">${n}%</option>`).join("")}</select></label></div>
    <div class="space-controls">${entry("目标银河","flight-galaxy",1,5,1)}${entry("恒星系","flight-system",1,100,50)}${entry("位置","flight-position",1,16,9)}</div>
    <div id="charge-options" class="ov-card"><label>深空驻留（1 段 = 60 游戏秒）<select id="charge-slots"><option value="1">1 段 · 60 秒</option><option value="2">2 段 · 120 秒</option><option value="3">3 段 · 180 秒</option></select></label><label><span><input type="checkbox" id="charge-bets" /> 复制星环机当前常驻押注，出发时扣除</span></label><p class="muted">可能遭遇海盗/异星战损。未受保护的黑洞会摧毁整支舰队。取消未完成充能会返还押注，不返还燃料。</p></div>
    <div id="npc-attack-options" hidden><p class="muted">武器技术 1 级 · 空载出航。空载出发，战后按幸存货舱装载；被毁舰船永久损失。</p><p id="npc-attack-quota" class="chip"></p><p id="npc-attack-draft-status" class="space-error" role="status"></p></div>
    <h3>3 · 装载货物</h3><div class="space-cargo">${[["metal","金属"],["crystal","晶体"],["deuterium","重氢"]].map(([id,label])=>`<label>${label}<input type="text" inputmode="decimal" id="cargo-${id}" value="0" aria-label="装载${label}" /></label>`).join("")}</div>
    <button type="button" data-space="attack-clear-cargo" hidden>清空货物草稿</button>
    <div id="transport-load-helper" hidden><div class="space-cargo">${[["metal","金属"],["crystal","晶体"],["deuterium","重氢"]].map(([id,label])=>`<button type="button" id="transport-fill-${id}" aria-label="${label}装至上限" disabled>装至上限</button>`).join("")}</div><p id="transport-load-summary" class="muted"></p><p id="transport-load-reason" class="muted" role="status"></p></div>
    <p id="charge-risk-preview" class="muted"></p><p id="charge-capacity-preview" class="muted"></p><p id="space-quote" class="space-quote" aria-live="polite"></p><button type="button" id="space-send" data-space="send">派遣舰队</button><p class="space-status" role="status"></p>
    <details><summary>燃料与殖民规则</summary><p class="muted">出发一次扣除舰船、货物和预付往返燃料；部署也预付往返，召回不退燃料。燃料占货舱。运输和部署仅限自己的星球。殖民成功消耗 1 艘殖民船，其余舰船返航；名额和坐标在出发时预留。充能结果在驻留结束时确定；货物和奖励返航后进入出发星球。</p></details></div></div>
    <h3 class="group-title">在途舰队</h3><div id="space-fleets" class="space-fleets"></div>
    <h3 class="group-title">帝国星球</h3><div id="space-planets"></div>
  `)+make("messages","航行消息",`<p class="muted">按游戏时间记录派遣、抵达、侦察和返航；保留最近 ${SPACE.maxMessages} 条。</p><div id="space-message-list"></div>${npcRehearsalPanelHtml()}${npcScoutComparisonPanelHtml()}${npcBattlePanelHtml()}`)+make("deep","深空任务与贸易",deepPanelHtml())+make("orders","有限计划与单源运输",ordersPanelHtml()+researchTemplatesPanelHtml()+buildingTemplatesPanelHtml()));
  const orderPanel=installOrdersPanel(root,onAction);
  const templatePanel=installResearchTemplatesPanel(root,onAction);
  const buildingTemplatePanel=installBuildingTemplatesPanel(root,onAction);
  const formationPanel=installFormationsPanel(root,onAction);
  const prestigePreview=installPrestigePreview(root);
  const expansionNavigation=installExpansionNavigation(root);
  const demolitionPanel=installDemolitionPanel(root,onAction);
  const protocolSafety=installProtocolSafety(root);
  const manualUnits=installManualUnitControls(root,onAction);
  let filledFormation: Pick<FleetFormation,"id" | "revision" | "name"> | null = null;
  function clearFormationFill(){if(!filledFormation)return;for(const input of root.querySelectorAll<HTMLInputElement>("[data-ship]"))input.value="0";filledFormation=null;put(root,"#formation-dispatch-source","");el(root,"#formation-dispatch-source").hidden=true;}
  // Each surface owns its rendered capabilities; rebuilding the fleet tab must
  // not retire the deep dashboard's stable, focused timer controls.
  let deepFleetButtons = new WeakMap<HTMLButtonElement, number>();
  const updateDeep=installDeepPanel(root,onAction,()=>target(coordinateKey({...origin,position:16}),"charge"),{
    register(button,id){deepFleetButtons.set(button,id);},
    retire(button){deepFleetButtons.delete(button);},
  });
  let cursor:Coordinates={galaxy:1,system:50,position:8},selected:string|null=null,initialized=false,origin:Coordinates=cursor;
  let fleetButtons = new WeakMap<HTMLButtonElement, number>();
  function choose(id:string){
    npcAttack.retirePending();
    if(id!=="messages")npcRehearsal.close();
    selected=id;for(const b of root.querySelectorAll<HTMLElement>("[data-tab]")){const active=b.dataset.tab===id;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active));}
    for(const p of root.querySelectorAll<HTMLElement>("[data-tab-panel]"))p.hidden=p.dataset.tabPanel!==id;
  }
  function number(id:string):number{return Number(el<HTMLInputElement>(root,`#${id}`).value);}
  function request():FleetRequest {
    const ships:Partial<Record<ShipId,number>>={};for(const i of root.querySelectorAll<HTMLInputElement>("[data-ship]"))ships[i.dataset.ship as ShipId]=Number(i.value);
    const cargo=emptyCargo();for(const id of ["metal","crystal","deuterium"] as const){const value=el<HTMLInputElement>(root,`#cargo-${id}`).value.trim();cargo[id]=/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)&&value.length<100?big(value):big(-1);}
    return {mission:el<HTMLSelectElement>(root,"#flight-mission").value as Mission,target:{galaxy:number("flight-galaxy"),system:number("flight-system"),position:number("flight-position")},ships,cargo,speedPercent:number("flight-speed"),holdSlots:number("charge-slots"),chargeWithBets:el<HTMLInputElement>(root,"#charge-bets").checked};
  }
  const transportLoad=installTransportLoadControls(root,request);
  const npcAttack=installNpcAttackControls(root,request,onAction);
  const npcBattle=installNpcBattlePanel(root);
  const npcRehearsal=installSpaceNpcRehearsal(root,current=>{
    filledFormation=null;put(root,"#formation-dispatch-source","");el(root,"#formation-dispatch-source").hidden=true;
    transportLoad.invalidate("已替换为空载攻击草稿。");transportLoad.observe(current,true,"");
    choose("fleet");transportLoad.edited();npcAttack.edited(true);
  });
  function target(key:string,mission:string){npcRehearsal.clearNotice();const [g,s,p]=key.split(":");for(const [id,v]of [["galaxy",g],["system",s],["position",p]])el<HTMLInputElement>(root,`#flight-${id}`).value=v!;el<HTMLSelectElement>(root,"#flight-mission").value=mission;choose("fleet");transportLoad.edited();npcAttack.edited();}
  root.addEventListener("click",event=>{
    const b=event.target instanceof Element?event.target.closest<HTMLButtonElement>("button"):null;if(!b||b.disabled)return;
    if(b.dataset.spaceTab){event.stopImmediatePropagation();choose(b.dataset.spaceTab);return;}
    if(b.dataset.tab){npcAttack.retirePending();npcRehearsal.close();selected=null;return;}
    if(b.dataset.space){event.stopImmediatePropagation();const a=b.dataset.space;
      if(a==="prev"||a==="next"||a==="browse"||a==="home"){
        const g=number("browse-galaxy"),s=number("browse-system");
        if(a!=="home"&&(!Number.isInteger(g)||g<1||g>5||!Number.isInteger(s)||s<1||s>100)){put(root,"#space-browse-error","银河需为 1–5，恒星系需为 1–100 的整数");return;}
        cursor=a==="home"?{...origin}:{galaxy:g,system:wrap(s+(a==="prev"?-1:a==="next"?1:0),100),position:8};el<HTMLInputElement>(root,"#browse-galaxy").value=String(cursor.galaxy);el<HTMLInputElement>(root,"#browse-system").value=String(cursor.system);put(root,"#space-browse-error","");
      }
      if(a==="route"){if(b.dataset.mission==="attack")npcAttack.route(b,()=>target(b.dataset.coordinate!,"attack"));else target(b.dataset.coordinate!,b.dataset.mission!);}
      if(a==="attack-clear-cargo"){npcAttack.clearCargo(b);transportLoad.edited();}
      if(a==="npc-retry-dock")npcAttack.fleetAction(b,"retry");
      if(a==="npc-report"){choose("messages");npcBattle.focus(Number(b.dataset.report));}
      if(a==="select")onAction({type:"select-planet",id:b.dataset.planet!});
      if(a==="send"){if(request().mission==="attack")npcAttack.send(b);else onAction({type:"send-fleet",request:request()});}
      if(a==="recall"){
        if(b.dataset.npcAttack==="true"){npcAttack.fleetAction(b,"recall");return;}
        const id=Number(b.dataset.fleet);
        const authorized=(fleetButtons.get(b)===id&&el(root,"#space-fleets").contains(b))
          ||(deepFleetButtons.get(b)===id&&el(root,"#deep-flight-list").contains(b));
        if(authorized&&Number.isSafeInteger(id)&&id>0)onAction({type:"recall-fleet",id});
      }
      if(a==="abandon")onAction({type:"abandon-colony",id:b.dataset.planet!});
    }
  },true);
  const updateSpaceChrome=installSpaceChrome(root,()=>{if(selected)choose(selected);});
  function updateSpaceGalaxy(model:SpaceGalaxyView){
    put(root,"#space-range",`${model.phase} · 种子 ${model.seed}`);
    const worlds=el(root,"#space-worlds");
    if(worlds.dataset.npcEpoch!==String(npcAttack.generation)){delete worlds.dataset.signature;worlds.dataset.npcEpoch=String(npcAttack.generation);}
    const route=(key:string,m:string,label:string)=>`<button type="button" data-space="route" data-coordinate="${key}" data-mission="${m}">${label}</button>`;
    html(root,"#space-worlds",model.rows.map(row=>`<tr class="space-world ${row.planetId?"space-owned":""}"><td>${row.position}</td><td>${enc(row.name)}<small>[${row.key}]</small></td><td>${row.kind}</td><td>${row.properties}</td><td>${row.bonus}</td><td><div class="space-actions">${row.planetId?`<button type="button" data-space="select" data-planet="${enc(row.planetId)}">切换</button>`:""}${row.canColonize?route(row.key,"colonize","殖民"):""}${row.canScout?route(row.key,"scout","侦察"):""}${row.canRouteAttack?route(row.key,"attack","攻击"):""}${row.canTransport?route(row.key,"transport","运输"):""}${row.position===16?route(row.key,"charge","深空充能"):""}</div></td></tr>`).join(""));
    for(const button of worlds.querySelectorAll<HTMLButtonElement>('[data-mission="attack"]'))npcAttack.register(button,"route",button.dataset.coordinate!);
  }
  function updateSpaceFleet(model:SpaceFleetView){
    transportLoad.update();
    el(root,"#charge-options").hidden=!model.isCharge;
    put(root,"#charge-risk-preview",model.chargePreview.risk);
    put(root,"#charge-capacity-preview",model.chargePreview.capacity);
    el(root,"#charge-risk-preview").hidden=!model.isCharge;
    el(root,"#charge-capacity-preview").hidden=!model.isCharge;
    put(root,"#space-slots",model.slots);
    put(root,"#space-quote",model.quote.text);el<HTMLButtonElement>(root,"#space-send").disabled=!npcAttack.writable||!model.quote.ok;
    put(root,"#npc-attack-quota",model.attackQuota);npcAttack.paint(model.quote.ok);
    for(const ship of model.ships)put(root,`#available-${ship.id}`,`现有 ${ship.count.toLocaleString("en-US")} 艘`);
    const signature=`${npcAttack.generation}|${model.fleets.map(f=>`${f.id}:${f.canRecall}:${f.canRetryDock}:${f.reportId}:${f.isAttack}`).join("|")}`;const list=el(root,"#space-fleets");
    if(list.dataset.fleetSignature!==signature){
      fleetButtons=new WeakMap<HTMLButtonElement,number>();list.dataset.fleetSignature=signature;
      list.innerHTML=model.fleets.length?model.fleets.map(f=>`<div class="space-flight ov-card" data-flight="${f.id}"><strong class="flight-title"></strong><span class="flight-route muted"></span><strong class="flight-time"></strong><div class="space-actions">${f.isAttack?`${f.canRecall?`<button type="button" data-space="recall" data-npc-attack="true" data-fleet="${f.id}">召回</button>`:""}${f.canRetryDock?`<button type="button" data-space="npc-retry-dock" data-fleet="${f.id}">重试入港</button>`:""}${f.reportId!==null?`<button type="button" data-space="npc-report" data-report="${f.reportId}">查看战报</button>`:""}`:`<button type="button" data-space="recall" data-fleet="${f.id}" ${f.canRecall?"":"disabled"}>${f.canRecall?"召回":"返航中"}</button>`}</div><div class="queue-bar"><span class="flight-progress"></span></div><small class="flight-detail muted" style="grid-column:1/-1"></small></div>`).join(""):'<p class="muted">暂无在途舰队。选择目标并编成第一支舰队。</p>';
      for(const button of list.querySelectorAll<HTMLButtonElement>('[data-space="recall"]')){
        if(button.dataset.npcAttack==="true")npcAttack.register(button,"recall",button.dataset.fleet!);
        else fleetButtons.set(button,Number(button.dataset.fleet));
      }
      for(const button of list.querySelectorAll<HTMLButtonElement>('[data-space="npc-retry-dock"]'))npcAttack.register(button,"retry",button.dataset.fleet!);
    }
    for(const f of model.fleets){const row=el(list,`[data-flight="${f.id}"]`);put(row,".flight-title",f.title);put(row,".flight-route",f.route);put(row,".flight-time",f.remaining);put(row,".flight-detail",f.detail);el(row,".flight-progress").style.width=`${f.progress}%`;}

    const planets=el(root,"#space-planets");
    const planetSignature=JSON.stringify(model.planets.map(p=>[p.id,p.name,p.coordinate,p.selected]));
    if(planets.dataset.planets!==planetSignature){
      planets.dataset.planets=planetSignature;
      planets.innerHTML=model.planets.map(p=>`<div class="space-planet" data-world-id="${enc(p.id)}"><strong>${enc(p.name)} [${p.coordinate}]</strong><span class="planet-stock"></span><div class="space-actions"><button type="button" data-space="select" data-planet="${enc(p.id)}" ${p.selected?"disabled":""}>${p.selected?"当前星球":"切换"}</button>${p.canAbandon?`<button type="button" class="danger" data-space="abandon" data-planet="${enc(p.id)}">放弃</button>`:""}</div></div>`).join("");
    }
    for(const p of model.planets){const row=el(planets,`[data-world-id="${p.id}"]`);put(row,".planet-stock",p.stock);updateNpcRemainderDetail(row,p.npcRemainder);}
  }
  function updateSpaceMessages(model:SpaceMessagesView){
    npcBattle.update(model.npcReports);
    npcRehearsal.updateMessages();
  }
  return {...original, update(model: Parameters<typeof original.update>[0]){original.update(model);manualUnits.update(model.shipyard);}, updateDeep, updateDemolition:demolitionPanel.update.bind(demolitionPanel), updateDemolitionOffline:demolitionPanel.updateOffline, completeDemolitionAction:demolitionPanel.complete, updateProtocolSafety:protocolSafety.update, updateOrders:orderPanel.update, updateResearchTemplates(state:GameState,writable:boolean){
      templatePanel.observe(state,writable);
      if(!el(root,"#space-orders").hidden&&el<HTMLDetailsElement>(root,"#research-templates").open)templatePanel.update(state,writable);
    }, completeResearchTemplateAction:templatePanel.completeAction, updateBuildingTemplates(state:GameState,writable:boolean){
      buildingTemplatePanel.observe(state,writable);
      if(!el(root,"#space-orders").hidden&&el<HTMLDetailsElement>(root,"#building-templates").open)buildingTemplatePanel.update(state,writable);
    }, completeBuildingTemplateAction:buildingTemplatePanel.completeAction, updateFormations(state:GameState,writable:boolean){
      formationPanel.observe(state,writable);
      if(!el(root,"#space-fleet").hidden&&el<HTMLDetailsElement>(root,"#fleet-formations").open)formationPanel.update(state,writable);
    }, completeFormationAction:formationPanel.completeAction, updatePrestigePreview:prestigePreview.update, invalidatePrestigePreview:prestigePreview.invalidate, updateExpansionNavigation:expansionNavigation.update,
    observeContexts(state:GameState,writable:boolean,protectionMessage:string){manualUnits.observe(state,writable,protectionMessage);updateLabBlockersProtection(root,writable,protectionMessage);demolitionPanel.observe(state,writable);protocolSafety.observe(state,writable);transportLoad.observe(state,writable,protectionMessage);npcAttack.observe(state,writable,protectionMessage);npcRehearsal.observe(state,writable,protectionMessage);orderPanel.observe(state,writable);templatePanel.observe(state,writable);buildingTemplatePanel.observe(state,writable);formationPanel.observe(state,writable);updateDeep.observeRing(state,writable,protectionMessage);},
    fillFormationShips(formation:FleetFormation){npcRehearsal.clearNotice();for(const input of root.querySelectorAll<HTMLInputElement>("[data-ship]"))input.value=String(formation.ships[input.dataset.ship as keyof FleetFormation["ships"]]??0);filledFormation={id:formation.id,revision:formation.revision,name:formation.name};put(root,"#formation-dispatch-source",`已填入 #${formation.id} ${formation.name} · 修订 ${formation.revision} 的数量快照，可继续手动编辑。`);el(root,"#formation-dispatch-source").hidden=false;transportLoad.edited();npcAttack.edited();},
    invalidateOrderAuthority(){manualUnits.invalidate();npcRehearsal.retire();demolitionPanel.invalidate();expansionNavigation.invalidate();prestigePreview.invalidate();clearFormationFill();transportLoad.invalidate();npcAttack.invalidate();npcBattle.invalidate();formationPanel.invalidateAuthority();original.invalidateOrderAuthority();orderPanel.invalidateOrderAuthority();templatePanel.invalidateAuthority();buildingTemplatePanel.invalidateAuthority();updateDeep.invalidateFleetAuthority();deepFleetButtons=new WeakMap<HTMLButtonElement,number>();fleetButtons=new WeakMap<HTMLButtonElement,number>();const list=el(root,"#space-fleets");list.replaceChildren();delete list.dataset.fleetSignature;},
    retireNpcRehearsal:npcRehearsal.retire,adoptNpcRehearsalWorld:npcRehearsal.adoptWorld,
    retireManualUnits:manualUnits.invalidate,
    consumeManualUnitAction(action:ManualUnitUiAction,state:GameState){return manualUnits.consume(action,state);},
    consumeNpcAttackAction(action:UiAction,state:GameState){return "npcAuthority" in action&&!!action.npcAuthority&&npcAttack.consume(action as NpcAttackUiAction,state);},
    completeNpcAttackSend(ok:boolean){npcAttack.completeSend(ok);if(ok)npcRehearsal.clearNotice();}, retireNpcPending:npcAttack.retirePending,
    readRequest:request, cursor:()=>({...cursor}),
    setOrigin(c:Coordinates){origin=c;if(!initialized){cursor={...c};el<HTMLInputElement>(root,"#browse-galaxy").value=String(c.galaxy);el<HTMLInputElement>(root,"#browse-system").value=String(c.system);initialized=true;}},
    updateSpace(value:SpaceView,status:string){
      updateSpaceChrome(value.origin,status);
      updateSpaceGalaxy(value);
      updateSpaceFleet(value);
      updateSpaceMessages(value);
    },
    updateSpaceChrome, updateSpaceGalaxy, updateSpaceFleet, updateSpaceMessages,
  };
}
