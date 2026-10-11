import { npcBattleDetails, npcBattleRounds, type NpcBattleReportsView } from "./npc-battle-present";

export function npcBattlePanelHtml(): string {
  return `<h3 class="group-title">NPC 轨道战报</h3><p class="muted">保留 60 份终端历史与全部尚未交付的战报。</p><details class="npc-battle-rules"><summary>战斗规则</summary><p class="muted">按舰种聚合结算，最多六轮。阵亡舰船永久损失，幸存者下一场恢复完整船体与护盾。仅获胜且有幸存舰船才装载战利品；按幸存货舱分配，返抵原出发星球后一次入库。空驻军收集为 0 回合。NPC 不会主动袭击母星。</p></details><div id="npc-battle-reports"></div>`;
}

/** Keyed details preserve focus/open state. Reading or expanding never resolves a battle. */
export function installNpcBattlePanel(root: HTMLElement) {
  const list = root.querySelector<HTMLElement>("#npc-battle-reports")!;
  const panel = root.querySelector<HTMLElement>("#space-messages")!;
  type Row = { node: HTMLDetailsElement; summary: HTMLElement; body: HTMLElement; rounds: HTMLDetailsElement; roundBody: HTMLElement; model: NpcBattleReportsView[number]; populated: boolean; roundsPopulated: boolean };
  const rows = new Map<number, Row>();
  let pending: number | null = null;
  const visible = () => !panel.hidden && !document.hidden && root.isConnected && list.isConnected && root.contains(list);
  function populate(row: Row) {
    if (!visible() || !row.node.open || rows.get(row.model.id) !== row) return;
    if (!row.populated) {
      for (const value of Object.values(npcBattleDetails(row.model.report))) {
        const p = document.createElement("p"); p.textContent = value; row.body.append(p);
      }
      row.populated = true;
    }
    if (!row.rounds.open || row.roundsPopulated) return;
    const values = npcBattleRounds(row.model.report);
    if (!values.length) row.roundBody.textContent = "无驻军收集，本次没有战斗回合。";
    else {
      const table = document.createElement("table"); table.className = "ov-table npc-round-table";
      table.innerHTML = "<thead><tr><th>回合</th><th>我方剩余</th><th>NPC 剩余</th><th>我方输出</th><th>NPC 输出</th></tr></thead>";
      const body = document.createElement("tbody");
      for (const value of values) {
        const tr = document.createElement("tr");
        for (const text of Object.values(value)) { const td = document.createElement("td"); td.textContent = text; tr.append(td); }
        body.append(tr);
      }
      table.append(body); row.roundBody.append(table);
    }
    row.roundsPopulated = true;
  }
  function update(models: NpcBattleReportsView) {
    if (!visible()) return;
    const current = new Set(models.map(model => model.id));
    for (const [id, row] of rows) if (!current.has(id)) { row.node.remove(); rows.delete(id); }
    let previous: Element | null = null;
    for (const model of models) {
      let row = rows.get(model.id);
      if (!row) {
        const node = document.createElement("details"); node.className = "ov-card npc-battle-report"; node.dataset.npcReport = String(model.id);
        const summary = document.createElement("summary"), body = document.createElement("div"), rounds = document.createElement("details"), roundSummary = document.createElement("summary"), roundBody = document.createElement("div");
        rounds.dataset.npcRounds = String(model.id); roundSummary.textContent = "逐回合数据";
        roundBody.className = "space-table-scroll"; roundBody.tabIndex = 0; roundBody.setAttribute("role", "region"); roundBody.setAttribute("aria-label", "战斗回合数据，可横向滚动");
        rounds.append(roundSummary, roundBody); node.append(summary, body, rounds);
        row = { node, summary, body, rounds, roundBody, model, populated: false, roundsPopulated: false }; rows.set(model.id, row);
        const owned = row;
        node.addEventListener("toggle", () => populate(owned)); rounds.addEventListener("toggle", () => populate(owned));
      }
      row.model = model;
      if (row.summary.textContent !== model.summary) row.summary.textContent = model.summary;
      const next: Element | null = previous ? previous.nextElementSibling : list.firstElementChild;
      if (next !== row.node) list.insertBefore(row.node, next);
      previous = row.node;
      if (pending === model.id) { row.node.open = true; row.summary.focus(); row.node.scrollIntoView({ block: "nearest" }); pending = null; }
      populate(row);
    }
  }
  return {
    update,
    focus(id: number) { pending = id; const row = rows.get(id); if (row && visible()) { row.node.open = true; row.summary.focus(); row.node.scrollIntoView({ block: "nearest" }); populate(row); pending = null; } },
    invalidate() { rows.clear(); list.replaceChildren(); pending = null; },
  };
}
