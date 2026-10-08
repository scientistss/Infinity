import { deepPanelHtml, installDeepPanel, type DeepAction } from "./deep-panel";
import { mountView as mountOriginal, type UiAction as OriginalAction } from "./planet-selector";
import { SPACE, wrap, coordinateKey, type Coordinates } from "../game/galaxy";
import { emptyCargo, type FleetRequest, type Mission } from "../game/fleet";
import { SHIP_IDS, unitById, type ShipId } from "../data/units";
import { big } from "../game/decimal";
import type { SpaceView } from "./space-present";
export type UiAction = OriginalAction | DeepAction | {type:"send-fleet";request:FleetRequest} | {type:"recall-fleet";id:number} | {type:"abandon-colony";id:string};
const TABS=[{id:"galaxy",label:"银河",icon:"tech.webp"},{id:"fleet",label:"舰队",icon:"shipyard.svg"},{id:"messages",label:"消息",icon:"save.webp"},{id:"deep",label:"深空",icon:"ring_machine.webp"}];
const enc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
function el<T extends HTMLElement=HTMLElement>(root:ParentNode,sel:string):T {const n=root.querySelector<T>(sel);if(!n)throw Error(`缺少界面节点 ${sel}`);return n;}
function put(root:ParentNode,sel:string,value:string){const n=el(root,sel);if(n.textContent!==value)n.textContent=value;}
function html(root:ParentNode,sel:string,value:string){const n=el(root,sel);if(n.dataset.signature!==value){n.innerHTML=value;n.dataset.signature=value;}}
const entry=(label:string,id:string,min:number,max:number,value:number)=>`<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" value="${value}" step="1" /></label>`;

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
    <p class="muted">NPC 当前仅提供基础侦察，不会反击；第 16 位可派舰充能，也可回收战斗残骸。殖民地属性使用当前开发版生成曲线。</p>
  `)+make("fleet","舰队指挥",`
    <p id="space-slots" class="chip"></p>
    <div class="space-columns"><div class="ov-card"><h3>1 · 编成舰队</h3><div class="space-ships">${SHIP_IDS.filter(id=>id!=="solar_satellite").map(id=>`<label class="space-ship"><span>${unitById(id).nameZh}<small id="available-${id}"></small></span><input type="number" min="0" max="${SPACE.maxShips}" step="1" value="0" data-ship="${id}" aria-label="${unitById(id).nameZh}派遣数量" /></label>`).join("")}</div></div>
    <div class="ov-card"><h3>2 · 任务与航程</h3><div class="space-controls"><label>任务<select id="flight-mission"><option value="colonize">殖民</option><option value="transport">运输</option><option value="deploy">部署</option><option value="scout">侦察</option><option value="charge">深空充能</option><option value="recycle">残骸回收</option></select></label><label>速度<select id="flight-speed">${[100,90,80,70,60,50,40,30,20,10].map(n=>`<option value="${n}">${n}%</option>`).join("")}</select></label></div>
    <div class="space-controls">${entry("目标银河","flight-galaxy",1,5,1)}${entry("恒星系","flight-system",1,100,50)}${entry("位置","flight-position",1,16,9)}</div>
    <div id="charge-options" class="ov-card"><label>深空驻留（1 段 = 60 游戏秒）<select id="charge-slots"><option value="1">1 段 · 60 秒</option><option value="2">2 段 · 120 秒</option><option value="3">3 段 · 180 秒</option></select></label><label><span><input type="checkbox" id="charge-bets" /> 复制星环机当前常驻押注，出发时扣除</span></label><p class="muted">可能遭遇海盗/异星战损。未受保护的黑洞会摧毁整支舰队。取消未完成充能会返还押注，不返还燃料。</p></div>
    <h3>3 · 装载货物</h3><div class="space-cargo">${[["metal","金属"],["crystal","晶体"],["deuterium","重氢"]].map(([id,label])=>`<label>${label}<input type="text" inputmode="decimal" id="cargo-${id}" value="0" aria-label="装载${label}" /></label>`).join("")}</div>
    <p id="charge-risk-preview" class="muted"></p><p id="charge-capacity-preview" class="muted"></p><p id="space-quote" class="space-quote" aria-live="polite"></p><button type="button" id="space-send" data-space="send">派遣舰队</button><p class="space-status" role="status"></p>
    <details><summary>燃料与殖民规则</summary><p class="muted">出发一次扣除舰船、货物和预付往返燃料；部署也预付往返，召回不退燃料。燃料占货舱。运输和部署仅限自己的星球。殖民成功消耗 1 艘殖民船，其余舰船返航；名额和坐标在出发时预留。充能结果在驻留结束时确定；货物和奖励返航后进入出发星球。</p></details></div></div>
    <h3 class="group-title">在途舰队</h3><div id="space-fleets" class="space-fleets"></div>
    <h3 class="group-title">帝国星球</h3><div id="space-planets"></div>
  `)+make("messages","航行消息",`<p class="muted">按游戏时间记录派遣、抵达、侦察和返航；保留最近 ${SPACE.maxMessages} 条。</p><div id="space-messages"></div>`)+make("deep","深空任务与贸易",deepPanelHtml()));
  const updateDeep=installDeepPanel(root,onAction,()=>target(coordinateKey({...origin,position:16}),"charge"));
  let cursor:Coordinates={galaxy:1,system:50,position:8},selected:string|null=null,initialized=false,origin:Coordinates=cursor;
  let model:SpaceView|null=null;
  function choose(id:string){
    selected=id;for(const b of root.querySelectorAll<HTMLElement>("[data-tab]")){const active=b.dataset.tab===id;b.classList.toggle("active",active);b.setAttribute("aria-selected",String(active));}
    for(const p of root.querySelectorAll<HTMLElement>("[data-tab-panel]"))p.hidden=p.dataset.tabPanel!==id;
  }
  function number(id:string):number{return Number(el<HTMLInputElement>(root,`#${id}`).value);}
  function request():FleetRequest {
    const ships:Partial<Record<ShipId,number>>={};for(const i of root.querySelectorAll<HTMLInputElement>("[data-ship]"))ships[i.dataset.ship as ShipId]=Number(i.value);
    const cargo=emptyCargo();for(const id of ["metal","crystal","deuterium"] as const){const value=el<HTMLInputElement>(root,`#cargo-${id}`).value.trim();cargo[id]=/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)&&value.length<100?big(value):big(-1);}
    return {mission:el<HTMLSelectElement>(root,"#flight-mission").value as Mission,target:{galaxy:number("flight-galaxy"),system:number("flight-system"),position:number("flight-position")},ships,cargo,speedPercent:number("flight-speed"),holdSlots:number("charge-slots"),chargeWithBets:el<HTMLInputElement>(root,"#charge-bets").checked};
  }
  function target(key:string,mission:string){const [g,s,p]=key.split(":");for(const [id,v]of [["galaxy",g],["system",s],["position",p]])el<HTMLInputElement>(root,`#flight-${id}`).value=v!;el<HTMLSelectElement>(root,"#flight-mission").value=mission;choose("fleet");}
  root.addEventListener("click",event=>{
    const b=event.target instanceof Element?event.target.closest<HTMLButtonElement>("button"):null;if(!b||b.disabled)return;
    if(b.dataset.spaceTab){event.stopImmediatePropagation();choose(b.dataset.spaceTab);return;}
    if(b.dataset.tab){selected=null;return;}
    if(b.dataset.space){event.stopImmediatePropagation();const a=b.dataset.space;
      if(a==="prev"||a==="next"||a==="browse"||a==="home"){
        const g=number("browse-galaxy"),s=number("browse-system");
        if(a!=="home"&&(!Number.isInteger(g)||g<1||g>5||!Number.isInteger(s)||s<1||s>100)){put(root,"#space-browse-error","银河需为 1–5，恒星系需为 1–100 的整数");return;}
        cursor=a==="home"?{...origin}:{galaxy:g,system:wrap(s+(a==="prev"?-1:a==="next"?1:0),100),position:8};el<HTMLInputElement>(root,"#browse-galaxy").value=String(cursor.galaxy);el<HTMLInputElement>(root,"#browse-system").value=String(cursor.system);put(root,"#space-browse-error","");
      }
      if(a==="route")target(b.dataset.coordinate!,b.dataset.mission!);
      if(a==="select")onAction({type:"select-planet",id:b.dataset.planet!});
      if(a==="send")onAction({type:"send-fleet",request:request()});
      if(a==="recall")onAction({type:"recall-fleet",id:Number(b.dataset.fleet)});
      if(a==="abandon")onAction({type:"abandon-colony",id:b.dataset.planet!});
    }
  },true);
  return {...original, updateDeep, readRequest:request, cursor:()=>({...cursor}),
    setOrigin(c:Coordinates){origin=c;if(!initialized){cursor={...c};el<HTMLInputElement>(root,"#browse-galaxy").value=String(c.galaxy);el<HTMLInputElement>(root,"#browse-system").value=String(c.system);initialized=true;}},
    updateSpace(value:SpaceView,status:string){
      model=value;
      el(root,"#charge-options").hidden=!model.isCharge;
      put(root,"#charge-risk-preview",model.chargePreview.risk);
      put(root,"#charge-capacity-preview",model.chargePreview.capacity);
      el(root,"#charge-risk-preview").hidden=!model.isCharge;
      el(root,"#charge-capacity-preview").hidden=!model.isCharge;
      if(selected)choose(selected);
      for(const n of root.querySelectorAll<HTMLElement>(".space-location"))if(n.textContent!==model.origin)n.textContent=model.origin;
      for(const n of root.querySelectorAll<HTMLElement>(".space-status"))if(n.textContent!==status)n.textContent=status;
      put(root,"#space-slots",model.slots);put(root,"#space-range",`${model.phase} · 种子 ${model.seed}`);
      put(root,"#space-quote",model.quote.text);el<HTMLButtonElement>(root,"#space-send").disabled=!model.quote.ok;
      for(const ship of model.ships)put(root,`#available-${ship.id}`,`现有 ${ship.count.toLocaleString("en-US")} 艘`);
      const route=(key:string,m:string,label:string)=>`<button type="button" data-space="route" data-coordinate="${key}" data-mission="${m}">${label}</button>`;
      html(root,"#space-worlds",model.rows.map(row=>`<tr class="space-world ${row.planetId?"space-owned":""}"><td>${row.position}</td><td>${enc(row.name)}<small>[${row.key}]</small></td><td>${row.kind}</td><td>${row.properties}</td><td>${row.bonus}</td><td><div class="space-actions">${row.planetId?`<button type="button" data-space="select" data-planet="${enc(row.planetId)}">切换</button>`:""}${row.canColonize?route(row.key,"colonize","殖民"):""}${row.canScout?route(row.key,"scout","侦察"):""}${row.canTransport?route(row.key,"transport","运输"):""}${row.position===16?route(row.key,"charge","深空充能"):""}</div></td></tr>`).join(""));
      const signature=model.fleets.map(f=>`${f.id}:${f.canRecall}`).join("|");const list=el(root,"#space-fleets");
      if(list.dataset.fleetSignature!==signature){list.dataset.fleetSignature=signature;list.innerHTML=model.fleets.length?model.fleets.map(f=>`<div class="space-flight ov-card" data-flight="${f.id}"><strong class="flight-title"></strong><span class="flight-route muted"></span><strong class="flight-time"></strong><button type="button" data-space="recall" data-fleet="${f.id}" ${f.canRecall?"":"disabled"}>${f.canRecall?"召回":"返航中"}</button><div class="queue-bar"><span class="flight-progress"></span></div><small class="flight-detail muted" style="grid-column:1/-1"></small></div>`).join(""):'<p class="muted">暂无在途舰队。选择目标并编成第一支舰队。</p>';}
      for(const f of model.fleets){const row=el(list,`[data-flight="${f.id}"]`);put(row,".flight-title",f.title);put(row,".flight-route",f.route);put(row,".flight-time",f.remaining);put(row,".flight-detail",f.detail);el(row,".flight-progress").style.width=`${f.progress}%`;}
      const planets=el(root,"#space-planets");
      const planetSignature=JSON.stringify(model.planets.map(p=>[p.id,p.name,p.coordinate,p.selected]));
      if(planets.dataset.planets!==planetSignature){
        planets.dataset.planets=planetSignature;
        planets.innerHTML=model.planets.map(p=>`<div class="space-planet" data-world-id="${enc(p.id)}"><strong>${enc(p.name)} [${p.coordinate}]</strong><span class="planet-stock"></span><div class="space-actions"><button type="button" data-space="select" data-planet="${enc(p.id)}" ${p.selected?"disabled":""}>${p.selected?"当前星球":"切换"}</button>${p.canAbandon?`<button type="button" class="danger" data-space="abandon" data-planet="${enc(p.id)}">放弃</button>`:""}</div></div>`).join("");
      }
      for(const p of model.planets)put(planets,`[data-world-id="${p.id}"] .planet-stock`,p.stock);
      html(root,"#space-messages",model.messages.length?model.messages.map(m=>`<article class="space-message"><small>${m.time}</small><p>${enc(m.text)}</p></article>`).join(""):'<p class="muted">尚无航行记录。</p>');
    }
  };
}
