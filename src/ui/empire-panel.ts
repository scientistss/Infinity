import { artUrl } from "./art";
import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { big } from "../game/decimal";
import { MISSIONS, MISSION_LABEL, type FleetRequest, type Mission } from "../game/fleet";
import { GALAXY } from "../game/galaxy";
import type { EmpireView } from "./empire-present";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (id: string, value: number, min: number, max: number) => `<input type="number" id="${id}" min="${min}" max="${max}" value="${value}" step="1" inputmode="numeric">`;
export function planetSelectorHtml(): string {
  return `<div class="planet-toolbar"><label for="active-planet">当前星球</label><select id="active-planet" aria-label="当前星球"></select><span id="active-coordinate"></span><span class="muted">库存独立 · 研究共享</span></div>`;
}
export function empirePanelsHtml(): string {
  return `<section class="tab-panel" data-tab-panel="empire" hidden>
    <div class="expansion-hero"><p class="kicker">帝国控制台 / P4 基础版</p><h2>从一个世界，到星际网络</h2><p id="expansion-guide"></p></div>
    <div class="empire-metrics"><div><span>殖民容量</span><strong id="colony-status"></strong></div><div><span>航行网络</span><strong id="fleet-status"></strong></div><div><span>时间基准</span><strong>经济 ×600 / 舰队 ×120</strong></div></div>
    <h3 class="group-title">殖民地总览</h3><div class="empire-scroll"><table class="empire-table"><thead><tr><th>星球</th><th>坐标 / 环境</th><th>金属 / 秒</th><th>晶体 / 秒</th><th>重氢 / 秒</th><th>能源 / 队列</th></tr></thead><tbody id="empire-planets"></tbody></table></div>
    <p class="empire-note">所有星球同时生产和建造，无需停留在当前页面。现有协议卡只作用于当前选中的星球；跨星球卡片尚未开放。</p>
    <button type="button" class="danger" data-action="abandon-colony" id="abandon-colony" hidden>放弃当前殖民地</button>
    <p class="empire-note">本版开放银河、运输、部署、殖民、侦察和消息。回收、舰队充能、商人、军官、星图重置及战斗未开放。</p>
  </section>
  <section class="tab-panel" data-tab-panel="galaxy" hidden>
    <div class="panel-head"><h2>银河导航</h2><p id="galaxy-dimensions"></p></div>
    <div class="galaxy-controls"><label for="browse-galaxy">银河 ${num("browse-galaxy",1,1,GALAXY.galaxies)}</label><label for="browse-system">恒星系 ${num("browse-system",50,1,GALAXY.systems)}</label><button type="button" data-action="galaxy-prev" aria-label="上一恒星系">上一系</button><button type="button" data-action="galaxy-browse">定位</button><button type="button" data-action="galaxy-next" aria-label="下一恒星系">下一系</button></div>
    <div class="galaxy-legend"><span>己方</span><span>NPC 邻居</span><span>未占据</span><span>坐标环形相接 · NPC 布局由种子确定</span></div>
    <div id="galaxy-rows" class="galaxy-rows"></div>
    <p class="empire-note">第 16 位为深空预留区域；本版尚未接入舰队充能。侦察只生成报告，不会触发战斗。</p>
  </section>
  <section class="tab-panel" data-tab-panel="fleet" hidden>
    <div class="panel-head"><h2>舰队指挥</h2><p id="fleet-panel-status"></p></div>
    <div class="fleet-layout"><div class="fleet-composer"><h3>派遣新舰队</h3>
      <div class="flight-fields"><label>任务<select id="flight-mission">${MISSIONS.map((m) => `<option value="${m}">${MISSION_LABEL[m]}</option>`).join("")}</select></label><label>速度<select id="flight-speed">${[100,90,80,70,60,50,40,30,20,10].map((n) => `<option>${n}</option>`).join("")}</select></label>
      <label>银河${num("flight-galaxy",1,1,GALAXY.galaxies)}</label><label>恒星系${num("flight-system",50,1,GALAXY.systems)}</label><label>位置${num("flight-position",9,1,GALAXY.positions)}</label></div>
      <details open><summary>选择舰船</summary><div class="flight-ships">${SHIP_IDS.filter((id) => id !== "solar_satellite").map((id) => `<label><span>${unitById(id).nameZh}<small id="available-${id}">可用 0</small></span>${num(`flight-ship-${id}`,0,0,1e15)}</label>`).join("")}</div></details>
      <div class="flight-fields cargo-fields"><label>金属<input id="flight-metal" type="text" value="0" inputmode="decimal" placeholder="例如 1e6"></label><label>晶体<input id="flight-crystal" type="text" value="0" inputmode="decimal"></label><label>重氢<input id="flight-deuterium" type="text" value="0" inputmode="decimal"></label></div>
      <p class="empire-note">货物支持科学计数法。出发一次性扣除往返燃料，部署也预留两程；召回不退燃料。</p>
      <div class="flight-buttons"><button type="button" data-action="preview-flight">计算航程</button><button type="button" data-action="send-fleet">派遣舰队</button></div>
      <p class="flight-feedback" id="flight-feedback" role="status"></p>
    </div><div><h3>在途舰队</h3><div id="fleets-list" class="fleets-list"></div></div></div>
  </section>
  <section class="tab-panel" data-tab-panel="messages" hidden><div class="panel-head"><h2>航行日志</h2><p>按游戏时间记录；最多保留最近 ${GALAXY.maxMessages} 条消息</p></div><div id="fleet-messages" class="fleet-messages"></div></section>`;
}
export function readFlight(root: HTMLElement): FleetRequest {
  const value = (id: string) => (root.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement).value;
  const amount = (id: string) => { try { return big(value(id)); } catch { return big(NaN); } };
  const ships: Partial<Record<ShipId, number>> = {};
  for (const id of SHIP_IDS) if (id !== "solar_satellite") ships[id] = Number(value(`flight-ship-${id}`));
  return { mission: value("flight-mission") as Mission, target: { galaxy: Number(value("flight-galaxy")), system: Number(value("flight-system")), position: Number(value("flight-position")) }, speedPercent: Number(value("flight-speed")), ships, cargo: { metal: amount("flight-metal"), crystal: amount("flight-crystal"), deuterium: amount("flight-deuterium") } };
}
export function setFlightTarget(root: HTMLElement, coordinate: string, mission: string): void {
  const [g,s,p] = coordinate.split(":");
  for (const [id,value] of [["flight-galaxy",g],["flight-system",s],["flight-position",p],["flight-mission",mission]]) (root.querySelector(`#${id}`) as HTMLInputElement).value = value!;
  const feedback = root.querySelector("#flight-feedback");
  if (feedback) feedback.textContent = "目标已填入。请选择舰船和货物后计算航程。";
}
function html(root: HTMLElement, id: string, value: string): void {
  const element = root.querySelector(`#${id}`) as HTMLElement;
  if (element.dataset.markup !== value) { element.innerHTML = value; element.dataset.markup = value; }
}
function text(root: HTMLElement, id: string, value: string): void {
  const element = root.querySelector(`#${id}`) as HTMLElement;
  if (element.textContent !== value) element.textContent = value;
}
export function updateEmpirePanel(root: HTMLElement, m: EmpireView, status: string): void {
  html(root, "active-planet", m.planets.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} [${p.coordinate}]</option>`).join(""));
  const select = root.querySelector("#active-planet") as HTMLSelectElement;
  if (select.value !== m.activeId) select.value = m.activeId;
  text(root,"active-coordinate",`[${m.activeCoordinate}]`);
  text(root,"hero-location",`${m.activeName} · [${m.activeCoordinate}]`);
  text(root,"expansion-guide",m.guide);
  text(root,"colony-status",m.colonyStatus); text(root,"fleet-status",m.fleetStatus);
  text(root,"fleet-panel-status",`${m.activeName} · ${m.fleetStatus} · ${m.colonyStatus}`);
  text(root,"galaxy-dimensions",m.dimensions);
  text(root,"flight-feedback",status);
  (root.querySelector("#abandon-colony") as HTMLElement).hidden = !m.canAbandon;
  const table = root.querySelector("#empire-planets") as HTMLElement;
  const planetKey = m.planets.map((p) => p.id).join("|");
  if (table.dataset.ids !== planetKey) {
    table.innerHTML = m.planets.map((p) => `<tr data-planet-row="${esc(p.id)}"><td><button type="button" data-action="select-planet" data-planet="${esc(p.id)}"></button></td><td><span></span><small></small></td><td><span></span><small></small></td><td><span></span><small></small></td><td><span></span><small></small></td><td><span></span><small></small></td></tr>`).join("");
    table.dataset.ids = planetKey;
  }
  for (const [i, row] of Array.from(table.querySelectorAll("tr")).entries()) {
    const p = m.planets[i]!;
    row.classList.toggle("selected", p.active);
    const button = row.querySelector("button")!;
    if (button.textContent !== p.name) button.textContent = p.name;
    const cells = row.querySelectorAll("td");
    const values = [[`[${p.coordinate}]`, p.climate], ...p.resources.map((n,j) => [n, `${p.rates[j]!.startsWith("-") ? "" : "+"}${p.rates[j]} / 秒`]), [p.energy,p.queue]];
    for (let j=0;j<values.length;j++) {
      const cell=cells[j+1]!;
      for (const [k,tag] of ["span","small"].entries()) {
        const node=cell.querySelector(tag)!; const value=values[j]![k]!;
        if (node.textContent !== value) node.textContent=value;
      }
    }
  }
  for (const ship of m.ships) text(root,`available-${ship.id}`,`可用 ${ship.available.toLocaleString("zh-CN")}`);
  html(root,"galaxy-rows",m.rows.map((r) => `<article class="galaxy-row ${r.kind}"><div class="orbit-index">${String(r.position).padStart(2,"0")}</div><img class="orbit-preview" src="${artUrl(r.kind === "own" ? "colony" : r.kind === "npc" ? "homeworld" : "deep-space")}" alt="" aria-hidden="true" width="42" height="42" loading="lazy" decoding="async" /><div class="orbit-name"><strong>${esc(r.name)}</strong><span>[${r.coordinate}] · ${esc(r.faction)}</span></div><div class="orbit-actions">${r.planetId ? `<button type="button" data-action="select-planet" data-planet="${esc(r.planetId)}" ${r.selected ? "disabled" : ""}>${r.selected ? "当前" : "切换"}</button>${r.selected ? "" : `<button type="button" data-route="${r.coordinate}" data-mission="transport">运输</button>`}` : `<button type="button" data-route="${r.coordinate}" data-mission="scout">侦察</button>${r.kind === "empty" ? `<button type="button" data-route="${r.coordinate}" data-mission="colonize" ${r.reserved ? "disabled" : ""}>殖民</button>` : ""}`}</div></article>`).join(""));
  const list = root.querySelector("#fleets-list") as HTMLElement;
  const fleetKey = m.fleets.map((f) => f.id).join("|");
  if (list.dataset.ids !== fleetKey) {
    list.innerHTML = m.fleets.length ? m.fleets.map((f) => `<article class="flight-card" data-flight="${f.id}"><header><strong></strong><span></span></header><p data-flight-route></p><p class="muted" data-flight-ships></p><small data-flight-cargo></small><progress max="100" value="0" aria-label="飞行进度"></progress><button type="button" data-action="recall-fleet" data-fleet="${f.id}">召回</button></article>`).join("") : `<div class="empty-space">当前没有在途舰队。<p>前往银河选择目标，或在左侧输入坐标。</p></div>`;
    list.dataset.ids = fleetKey;
  }
  for (const [i,card] of Array.from(list.querySelectorAll("article")).entries()) {
    const f=m.fleets[i]!;
    const values: Array<[string,string]> = [["header strong",`#${f.id} ${f.mission} · ${f.phase}`],["header span",f.remaining],["[data-flight-route]",`${f.origin} → [${f.coordinate}]`],["[data-flight-ships]",f.ships],["[data-flight-cargo]",`货物（金 / 晶 / 氘）：${f.cargo}`]];
    for (const [selector,value] of values) { const node=card.querySelector(selector)!; if(node.textContent!==value)node.textContent=value; }
    (card.querySelector("progress") as HTMLProgressElement).value=f.progress;
    const button=card.querySelector("button")!;
    button.disabled=f.returning;
    if(button.textContent!==(f.returning ? "正在返航" : "召回"))button.textContent=f.returning ? "正在返航" : "召回";
  }
  html(root,"fleet-messages",m.messages.length ? m.messages.map((n) => `<article><time>游戏时间 ${esc(n.when)}</time><p>${esc(n.text)}</p></article>`).join("") : `<div class="empty-space">尚无航行记录。首次派遣后，这里会显示出发、抵达与侦察报告。</div>`);
}
