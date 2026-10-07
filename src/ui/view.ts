import { mountView as mountLegacy, type GameView, type UiAction } from "./controls-view";
import type { ViewModel } from "./present";
import type { EmpireView } from "./empire-present";
import { activeBuildings } from "../game/content";
import { RESEARCH, RESEARCH_GROUP_LABEL } from "../data/research";
import { NAV_GROUPS, PAGE_META, matchesQuery, orbitalPoint, stageFor, slotStatus } from "./command-model";
import { escapeAttribute as esc, GAME_VERSION } from "./art";
export type { UiAction } from "./controls-view";

function node<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const n = root.querySelector<T>(selector);
  if (!n) throw new Error(`Missing command UI: ${selector}`);
  return n;
}
function element(tag: string, className: string, markup = ""): HTMLElement {
  const n = document.createElement(tag); n.className = className; n.innerHTML = markup; return n;
}
function text(root: ParentNode, selector: string, value: string): void {
  const n = node(root, selector); if (n.textContent !== value) n.textContent = value;
}
const GLYPHS: Record<string, string> = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  facilities: "M3 21V9l6-4v5l6-4v7l6-3v11H3zM7 17h1m4 0h1m4 0h1",
  research: "M9 3h6m-5 0v7l-6 9q-1 2 2 2h12q3 0 2-2l-6-9V3M8 15h8",
  shipyard: "M3 17l9 4 9-4M6 16V6h12v10M9 6V3h6v3M9 11h6",
  defense: "M12 2l8 4v6q-1 7-8 10-7-3-8-10V6zM8 12l3 3 5-6",
  fleet: "M3 20L12 3l9 17-9-4-9 4zM12 3v13",
  empire: "M3 21h18M5 21V9h5v12m4 0V3h5v18M5 13h5m4-6h5m-5 5h5",
  galaxy: "M12 2a10 10 0 1 0 10 10M8 8c-7 5-7 12-2 11 9-1 19-13 14-15-3-1-8 1-12 4M10 12h4m-2-2v4",
  messages: "M3 5h18v14H3zM3 5l9 8 9-8",
  protocol: "M3 4h6v6H3zM15 14h6v6h-6zM6 10v7h9M9 7h9v7",
  curvature: "M4 12a8 8 0 1 1 8 8M4 12V5m0 7h7M12 7v5l3 3",
  arcade: "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l3 3m6 6l3 3M6 18l3-3m6-6l3-3M12 9l3 3-3 3-3-3z",
  darkmatter: "M12 3l8 9-8 9-8-9 8-9zM4 12h16M12 3v18",
  achievements: "M8 3h8v7q0 6-4 6t-4-6V3M8 5H4v3q0 4 5 4m7-7h4v3q0 4-5 4M12 16v5m-4 0h8",
  save: "M4 3h13l4 4v14H3V3h1zM7 3v6h10V3M7 21v-7h10v7",
};
function glyph(id: string): string {
  return `<svg class="cc-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GLYPHS[id] ?? GLYPHS.overview}"/></svg>`;
}
interface InspectorRow { id: string; name: string; group: string }
interface InspectorValue { id: string; level: string; cost: string; time: string; reason: string; locked: boolean; canEnqueue: boolean }

/** Mount once, then retain the existing interactive controls and their action handlers. */
function inspector(root: HTMLElement, page: string, prefix: string, rows: InspectorRow[]) {
  const panel = node(root, `[data-tab-panel="${page}"]`);
  const cards = rows.map(r => node(panel, `[data-bind="${prefix}-${r.id}"]`));
  const layout = element("div", "cc-inspector", `<div class="cc-index"><label class="cc-search">筛选${page === "facilities" ? "建筑" : "科技"}<input type="search" id="cc-search-${page}" placeholder="输入名称…" autocomplete="off" /></label><div class="cc-filter" role="group" aria-label="分类"></div><div class="cc-index-head"><span>项目 / 等级</span><span>建造状态</span></div><div class="cc-index-list"></div><p class="cc-no-results" hidden>没有匹配项目。请修改名称或分类。</p></div><div class="cc-inspector-detail" id="cc-detail-${page}" role="region" aria-label="所选${page === "facilities" ? "建筑" : "研究"}详情"><p class="cc-eyebrow">详情与操作</p></div>`);
  const list = node(layout, ".cc-index-list"), detail = node(layout, ".cc-inspector-detail");
  const groups = ["全部", ...new Set(rows.map(r => r.group))];
  node(layout, ".cc-filter").innerHTML = groups.map((g,i) => `<button type="button" data-filter="${esc(g)}" aria-pressed="${i === 0}">${esc(g)}</button>`).join("");
  list.innerHTML = rows.map((r,i) => `<button type="button" class="cc-index-row" data-inspect="${r.id}" aria-controls="cc-detail-${page}" aria-pressed="false"><span class="cc-row-code">${String(i + 1).padStart(2,"0")}</span><span class="cc-row-title"><strong>${esc(r.name)}</strong><small data-row-level></small></span><span class="cc-row-meta"><span data-row-state></span><small data-row-time></small></span></button>`).join("");
  cards.forEach(c => {
    detail.append(c);
    const explanation = c.querySelector(".bld-blurb");
    const payback = c.querySelector(".bld-payback");
    if (explanation || payback) {
      const d = element("details", "cc-technical", "<summary>说明与效率</summary>");
      if (explanation) d.append(explanation); if (payback) d.append(payback);
      c.append(d);
    }
  });
  panel.querySelectorAll(":scope > .bld-grid, :scope > .group-title").forEach(n => n.remove());
  panel.append(layout);
  let selected = rows[0]!.id, query = "", group = "全部";
  try { const saved = localStorage.getItem(`infinity.ui.inspect.${page}`); if (rows.some(r=>r.id===saved)) selected=saved!; } catch { /* Optional UI preference. */ }
  function apply() {
    const shown = rows.filter(r => (group === "全部" || r.group === group) && matchesQuery(r.name,r.id,query));
    if (shown.length && !shown.some(r=>r.id===selected)) selected=shown[0]!.id;
    for (const [i,r] of rows.entries()) {
      const b = node<HTMLButtonElement>(list, `[data-inspect="${r.id}"]`);
      b.hidden=!shown.includes(r); b.setAttribute("aria-pressed",String(r.id===selected));
      cards[i]!.hidden=r.id!==selected || !shown.length;
    }
    node(layout,".cc-no-results").hidden=shown.length>0;
    detail.hidden=!shown.length;
    for(const b of layout.querySelectorAll<HTMLElement>("[data-filter]")) b.setAttribute("aria-pressed",String(b.dataset.filter===group));
  }
  list.addEventListener("click",event=>{
    const b=(event.target as Element).closest<HTMLElement>("[data-inspect]"); if(!b)return;
    selected=b.dataset.inspect!;apply();
    try{localStorage.setItem(`infinity.ui.inspect.${page}`,selected);}catch{ /* Optional. */ }
  });
  list.addEventListener("keydown",event=>{
    if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
    const buttons=Array.from(list.querySelectorAll<HTMLButtonElement>("button:not([hidden])"));
    const i=buttons.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;
    event.preventDefault();
    const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(i+(event.key==="ArrowDown"?1:-1)+buttons.length)%buttons.length;
    buttons[next]?.focus();buttons[next]?.click();
  });
  node<HTMLInputElement>(layout,"input").addEventListener("input",event=>{query=(event.target as HTMLInputElement).value;apply();});
  node(layout,".cc-filter").addEventListener("click",event=>{const b=(event.target as Element).closest<HTMLElement>("[data-filter]");if(b){group=b.dataset.filter!;apply();}});
  apply();
  return (values: InspectorValue[])=>{
    for(const v of values){
      const b=node(list,`[data-inspect="${v.id}"]`);
      text(b,"[data-row-level]",`等级 ${v.level}`);
      text(b,"[data-row-time]",v.time.replace(/^(建造|研究)时间\s*/,""));
      text(b,"[data-row-state]",v.locked?"待解锁":v.canEnqueue?"可升级":"待资源 / 队列");
      b.classList.toggle("available",v.canEnqueue);b.classList.toggle("is-locked",v.locked);
      b.title=`${v.cost} · ${v.reason}`;
    }
  };
}

function galaxyMap(root: HTMLElement) {
  const panel=node(root,'[data-tab-panel="galaxy"]');
  const layout=element("div","cc-galaxy",`<div class="cc-system"><div class="cc-map-heading"><span class="cc-eyebrow">恒星系示意 · 非比例</span><strong id="cc-system-name"></strong></div><div class="cc-orbital" role="group" aria-label="选择行星位置"><div class="cc-orbit cc-orbit-1"></div><div class="cc-orbit cc-orbit-2"></div><div class="cc-orbit cc-orbit-3"></div><div class="cc-star" aria-hidden="true"></div>${Array.from({length:15},(_,i)=>{const p=orbitalPoint(i+1);return `<button type="button" class="cc-world" data-position="${i+1}" style="left:${p.x}%;top:${p.y}%" aria-pressed="false"><span class="cc-world-dot" aria-hidden="true"></span><span class="cc-world-index">${String(i+1).padStart(2,"0")}</span><span class="cc-world-label"></span></button>`;}).join("")}</div><div class="cc-map-key"><span class="own">己方</span><span class="npc">NPC 邻居</span><span class="empty">未占据</span></div></div><aside class="cc-world-detail" aria-label="选中位置详情"><p class="cc-eyebrow">目标情报</p><div class="cc-planet-portrait" aria-hidden="true"></div><p id="cc-world-coordinate"></p><h3 id="cc-world-name"></h3><p id="cc-world-faction"></p><p id="cc-world-note"></p><div id="cc-world-actions"><button type="button" data-action="select-planet">切换星球</button><button type="button" data-route="" data-mission="scout">侦察</button><button type="button" data-route="" data-mission="colonize">殖民</button><button type="button" data-route="" data-mission="transport">运输</button></div></aside>`);
  const legend=node(panel,".galaxy-legend");legend.hidden=true;
  legend.after(layout);
  const table=node(panel,"#galaxy-rows");const d=element("details","cc-coordinate-list","<summary>坐标列表与快捷操作</summary>");table.before(d);d.append(table);
  let m:EmpireView|null=null, selected=8, system="";
  function render(){
    if(!m)return;
    const r=m.rows.find(r=>r.position===selected)??m.rows[0]!;
    text(root,"#cc-system-name",`${String(m.cursor.galaxy).padStart(2,"0")} / ${String(m.cursor.system).padStart(3,"0")}`);
    text(root,"#cc-world-coordinate",`[${r.coordinate}]`);text(root,"#cc-world-name",r.name);text(root,"#cc-world-faction",r.faction);
    text(root,"#cc-world-note",r.kind==="own"?"独立库存与建造队列。研究成果由帝国共享。":r.kind==="npc"?"可派遣侦察舰获取基础情报；当前版本不会触发战斗。":r.reserved?"殖民任务已出发，抵达后建立新殖民地。":"派遣殖民船建立新据点。可用名额以天体物理研究为准。");
    node(layout,".cc-planet-portrait").dataset.kind=r.kind;
    for(const row of m.rows){
      const b=node<HTMLButtonElement>(layout,`[data-position="${row.position}"]`);
      text(b,".cc-world-label",row.kind==="empty"?"未占据":row.name);b.dataset.kind=row.kind;b.classList.toggle("reserved",row.reserved);
      b.setAttribute("aria-pressed",String(row.position===selected));b.setAttribute("aria-label",`${row.position} 号位置：${row.name}，${row.faction}`);b.title=`[${row.coordinate}] ${row.name}`;
    }
    for(const b of layout.querySelectorAll<HTMLButtonElement>("#cc-world-actions button")){
      if(b.dataset.action){b.hidden=r.kind!=="own";b.dataset.planet=r.planetId;b.disabled=r.selected;b.textContent=r.selected?"当前星球":"切换星球";}
      else{b.dataset.route=r.coordinate;b.hidden=b.dataset.mission==="transport"?r.kind!=="own"||r.selected:b.dataset.mission==="colonize"?r.kind!=="empty":r.kind==="own";b.disabled=b.dataset.mission==="colonize"&&r.reserved;}
    }
  }
  layout.addEventListener("click",event=>{const b=(event.target as Element).closest<HTMLElement>("[data-position]");if(b){selected=Number(b.dataset.position);render();}});
  return (value:EmpireView)=>{m=value;const key=`${m.cursor.galaxy}:${m.cursor.system}`;if(key!==system){system=key;selected=m.rows.find(r=>r.selected)?.position??8;}render();};
}

/** Structure and presentation only: all economic actions still use the original view. */
export function mountView(root: HTMLElement,onAction:(action:UiAction)=>void):GameView {
  let forcePaint=true,lastPaint=-Infinity;
  const legacy=mountLegacy(root,action=>{forcePaint=true;onAction(action);});
  root.classList.add("command-ui");
  const shell=element("div","cc-shell");
  const sidebar=element("aside","cc-sidebar",`<div class="cc-brand"><span aria-hidden="true">∞</span><div>INFINITY<small>星际殖民计划</small></div><button type="button" id="cc-nav-close" aria-label="关闭导航">×</button></div>`);sidebar.id="cc-sidebar";
  const stage=element("div","cc-stage"),work=element("div","cc-workarea");
  const top=node(root,".topbar"),main=node(root,"main.wrap"),nav=node(root,".tabs"),planet=node(root,".planet-toolbar");
  sidebar.append(planet);
  for(const panel of main.querySelectorAll<HTMLElement>("[data-tab-panel]")) panel.id=`page-${panel.dataset.tabPanel}`;
  const buttons=new Map(Array.from(nav.querySelectorAll<HTMLButtonElement>("[data-tab]")).map(b=>[b.dataset.tab!,b]));
  nav.innerHTML="";nav.setAttribute("aria-orientation","vertical");
  for(const group of NAV_GROUPS){
    const section=element("div","cc-nav-group",`<p>${group.label}</p>`);
    for(const id of group.tabs){const b=buttons.get(id)!;b.innerHTML=`${glyph(id)}<span>${b.querySelector("span")!.textContent}</span>`;b.setAttribute("aria-controls",`page-${id}`);section.append(b);}
    nav.append(section);
  }
  sidebar.append(nav);
  sidebar.append(element("footer","cc-sidebar-footer",`<span class="cc-local-dot"></span>本地运行 <span class="release-badge">v${GAME_VERSION}</span><small>指挥界面 v1</small>`));
  // Destructive prestige action belongs with its explanation, never next to routine controls.
  node(root,'[data-tab-panel="curvature"] .prestige-panel').append(node(root,".launch-box"));
  node(top,".brand").remove();
  const mobile=element("div","cc-mobile-bar",`<button type="button" id="cc-nav-toggle" aria-controls="cc-sidebar" aria-expanded="false">☰ <span>导航</span></button><strong>INFINITY</strong><button type="button" data-open-page="save">存档</button>`);top.prepend(mobile);
  const hero=node(root,".command-hero"),location=node(hero,"#hero-location");
  const heading=element("header","cc-pagehead",`<div><p class="cc-breadcrumb" id="cc-breadcrumb"></p><h2 class="cc-page-title" id="hero-title"></h2><p id="cc-page-description"></p></div><div class="cc-location"><span class="cc-local-dot"></span></div>`);
  hero.remove();node(heading,".cc-location").append(location);main.prepend(heading);
  const rail=element("aside","cc-rail",`<div class="cc-rail-heading"><h2>运行队列</h2><span id="cc-queue-count"></span></div><p class="cc-rail-planet" id="cc-rail-planet"></p><div class="cc-health"><span id="cc-health-title"></span><p id="cc-health-detail"></p></div>`);
  rail.append(node(root,'[data-bind="queue-list-ov"]').closest(".queue-panel")!,node(root,'[data-bind="rqueue-wrap-ov"]'),node(root,'[data-bind="squeue-wrap-ov"]'));
  rail.append(element("div","cc-activity",`<h3>操作反馈</h3><p id="cc-action-status" role="status" aria-live="polite"></p><p class="cc-rail-note">建造与生产持续运行，无需停留在当前页面。</p>`));
  for(const q of main.querySelectorAll<HTMLElement>(".queue-panel")) q.classList.add("cc-local-queue");
  work.append(main,rail);stage.append(top,work);shell.append(sidebar,stage);
  const backdrop=element("button","cc-nav-backdrop");backdrop.id="cc-nav-backdrop";backdrop.setAttribute("aria-label","关闭导航");backdrop.setAttribute("type","button");backdrop.hidden=true;
  root.append(shell,backdrop);
  const updateBuildings=inspector(root,"facilities","bld",activeBuildings().map(d=>({id:d.id,name:d.nameZh,group:d.category==="resource"?"资源与能源":"基础设施"})));
  const updateResearch=inspector(root,"research","rcard",RESEARCH.map(d=>({id:d.id,name:d.nameZh,group:RESEARCH_GROUP_LABEL[d.group]})));
  // Fold long rules without removing any information or data bindings.
  for(const page of ["facilities","research","protocol"]){
    const panel=node(root,`[data-tab-panel="${page}"]`);
    const prose=page==="facilities"?panel.querySelector(".panel-head p"):panel.querySelector(":scope > .blurb, :scope > .lede");
    if(prose){const d=element("details","cc-rules","<summary>规则与帮助</summary>");d.append(prose);panel.append(d);}
  }
  const updateGalaxy=galaxyMap(root);
  const protocol=node(root,'[data-tab-panel="protocol"]'),catalog=node(protocol,".catalog-row"),slots=node(protocol,".protocol-slots");
  const protocolLayout=element("div","cc-protocol-layout"),library=element("aside","cc-library",`<h3>规则库</h3><p>点击规则，装入首个空槽位。</p><label class="cc-show-locked"><input type="checkbox" id="cc-show-locked" />显示未解锁规则</label>`);
  library.append(catalog);protocolLayout.append(slots,library);protocol.append(protocolLayout);
  const lockedSummary=element("p","cc-locked-summary");lockedSummary.id="cc-locked-summary";slots.after(lockedSummary);protocolLayout.append(library);
  for(const slot of slots.querySelectorAll<HTMLElement>(".protocol-slot")){
    const feedback=element("span","cc-slot-status");node(slot,".slot-controls").append(feedback);
  }
  let model:ViewModel|null=null,lastTab="",menuOpen=false;
  const mq=matchMedia("(max-width: 760px)");
  function menu(open:boolean){
    menuOpen=mq.matches&&open;shell.classList.toggle("cc-menu-open",menuOpen);sidebar.inert=mq.matches&&!menuOpen;
    backdrop.hidden=!menuOpen;node(root,"#cc-nav-toggle").setAttribute("aria-expanded",String(menuOpen));
    if(menuOpen){sidebar.setAttribute("role","dialog");sidebar.setAttribute("aria-modal","true");sidebar.setAttribute("aria-label","主导航");node(sidebar,"#cc-nav-close").focus();stage.inert=true;}
    else{stage.inert=false;sidebar.removeAttribute("role");sidebar.removeAttribute("aria-modal");}
  }
  mq.addEventListener("change",()=>{if(!mq.matches)menu(false);else sidebar.inert=!menuOpen;});menu(false);
  function pageChanged(){
    const active=node<HTMLElement>(root,"[data-tab-panel]:not([hidden])").dataset.tabPanel!;
    const changed=lastTab!==active;
    if(!changed&&node(root,".cc-page-title").textContent===(PAGE_META[active]??PAGE_META.facilities!)[0])return;
    lastTab=active;shell.dataset.page=active;
    const meta=PAGE_META[active]??PAGE_META.facilities!;
    text(root,".cc-page-title",meta[0]);text(root,"#cc-page-description",meta[1]);text(root,"#cc-breadcrumb",`${NAV_GROUPS.find(g=>(g.tabs as readonly string[]).includes(active))?.label??"帝国"} / ${meta[0]}`);
    for(const [id,b]of buttons){b.tabIndex=id===active?0:-1;}
    if(menuOpen&&changed){menu(false);node<HTMLButtonElement>(root,"#cc-nav-toggle").focus();}
  }
  function updateProtocols(m:ViewModel){
    const showLocked=node<HTMLInputElement>(root,"#cc-show-locked").checked;
    for(const c of m.catalog) node(root,`[data-bind="catalog-${c.id}"]`).hidden=!c.unlocked&&!showLocked;
    let locked=0;
    for(const s of m.slots){
      const card=node(root,`[data-slot="${s.index}"]`);card.classList.toggle("cc-slot-locked",!s.unlocked);card.classList.toggle("cc-slot-empty",!s.sentence);
      if(!s.unlocked){locked++;continue;}
      text(card,".cc-slot-status",slotStatus(s.enabled,s.sentence,s.lamp));card.dataset.state=!s.enabled?"off":s.lamp;
      const params=node(card,".slot-params");
      if(params.dataset.ccKey!==s.fieldsKey || !params.querySelector(".cc-stage-block")){
        const fields=Array.from(params.querySelectorAll<HTMLElement>(".param"));
        params.replaceChildren();
        for(const [id,label]of [["trigger","01 · 触发"],["condition","02 · 条件"],["action","03 · 动作"]]){
          const block=element("div","cc-stage-block",`<h4>${label}</h4>`);
          const grouped=fields.filter(f=>stageFor(node<HTMLSelectElement>(f,"select").dataset.path!)===id);
          if(grouped.length)block.append(...grouped);else block.append(element("p","cc-stage-empty",s.sentence?(id==="condition"?"无需附加条件":"由规则模板定义"):"从规则库装入"));
          params.append(block);
        }
        params.dataset.ccKey=s.fieldsKey;
      }
    }
    text(root,"#cc-locked-summary",locked?`${locked} 个后续槽位待解锁 · ${m.slots.find(s=>!s.unlocked)?.lockHint??""}`: "所有协议槽位已解锁");
  }
  root.addEventListener("click",event=>{
    const b=(event.target as Element).closest<HTMLElement>("button");if(!b)return;forcePaint=true;
    if(b.id==="cc-nav-toggle")menu(!menuOpen);
    if(b.id==="cc-nav-close"||b.id==="cc-nav-backdrop"){menu(false);node<HTMLButtonElement>(root,"#cc-nav-toggle").focus();}
    if(b.dataset.openPage)buttons.get(b.dataset.openPage)?.click();
    if(b.dataset.tab&&menuOpen){menu(false);node<HTMLButtonElement>(root,"#cc-nav-toggle").focus();}
    pageChanged();
  });
  root.addEventListener("keydown",event=>{
    if(event.key==="Escape"&&menuOpen){event.preventDefault();menu(false);node<HTMLButtonElement>(root,"#cc-nav-toggle").focus();}
    if(event.key==="Tab"&&menuOpen){
      const focusable=Array.from(sidebar.querySelectorAll<HTMLElement>('button:not([hidden]):not(:disabled),select')).filter(n=>n.getClientRects().length>0 && n.tabIndex>=0);
      const first=focusable[0],last=focusable.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
    if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)&&nav.contains(document.activeElement)){
      const visible=Array.from(buttons.values()).filter(b=>!b.hidden);const i=visible.indexOf(document.activeElement as HTMLButtonElement);if(i<0)return;
      event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?visible.length-1:(i+(event.key==="ArrowDown"?1:-1)+visible.length)%visible.length;
      visible[next]?.focus();visible[next]?.click();
    }
  });
  node(root,"#cc-show-locked").addEventListener("change",()=>{if(model)updateProtocols(model);});
  pageChanged();
  return {...legacy,update(m){
    const now=performance.now();if(!forcePaint&&now-lastPaint<80)return;lastPaint=now;forcePaint=false;
    legacy.update(m);model=m;pageChanged();if(lastTab==="facilities")updateBuildings(m.buildings);if(lastTab==="research")updateResearch(m.research.items);
    text(root,"#cc-rail-planet",`${m.empire.activeName} · [${m.empire.activeCoordinate}]`);
    const count=m.queue.items.length+m.research.queue.items.length+m.shipyard.queue.items.length;
    text(root,"#cc-queue-count",String(count).padStart(2,"0"));
    text(root,"#cc-action-status",m.status);
    text(root,"#cc-health-title",m.energyShort?"能源供给不足":"能源运行正常");
    text(root,"#cc-health-detail",m.energyShort?"矿产按能源效率降额。升级供电设施或调整产量。":"当前供给满足需求，可继续扩建产线。");
    node(root,".cc-health").classList.toggle("warning",m.energyShort);
    for(const group of nav.querySelectorAll<HTMLElement>(".cc-nav-group"))group.hidden=!group.querySelector("button:not([hidden])");
    if(lastTab==="galaxy")updateGalaxy(m.empire);
    if(lastTab==="protocol")updateProtocols(m);
  }};
}
