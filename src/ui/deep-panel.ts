import { installDeepDashboard } from "./deep-dashboard";
import { installRingVisual } from "./ring-visual";
import pkg from "../../package.json";
import type { GameState, ResourceId } from "../game/types";
import { DEEP, chargeChances } from "../data/deep-space";
import { arcadeSymbolDef, ARCADE_SYMBOLS } from "../data/arcade";
import { coordinateKey } from "../game/galaxy";
import { expeditionSlots, storedRunLimit, chargeReservations, chargeDeliveryStatus } from "../game/deep-state";
import { tradeQuote } from "../game/merchant";
import { formatDuration, formatAmount } from "../game/format";
import { big } from "../game/decimal";
export type DeepAction={type:"summon-merchant"}|{type:"trade";offer:string;sell:ResourceId;buy:ResourceId;amount:string}|{type:"export-legacy"};
const enc=(s:string)=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const resources='<option value="metal">金属</option><option value="crystal">晶体</option><option value="deuterium">重氢</option>';
export function deepPanelHtml():string{return `
 <p class="muted">充能是有风险的舰队任务，不是免费信标。结果在驻留结束时预掷并保存；战损立即结算，货物、暗物质、道具与商人联络返航后归入出发星球。星环机按钮只回放已结算凭证，不会再次发奖。</p>
 <div class="space-controls"><button type="button" data-deep="charge">派舰前往当前星系深空</button><button type="button" data-deep="arcade">查看星环机回放</button></div>
 <p class="chip" id="deep-status"></p><p class="muted" id="deep-protection"></p>
 <div class="ov-card"><h3>商人 · 固定报价与真实成交</h3><p class="muted">基准 3 金属 : 2 晶体 : 1 重氢，各项 ±15% 浮动；手续费 3%，固定报价生效 10 分钟。仅在停靠星球成交；报价过期、资源或仓库不足时不扣费。</p>
 <div class="space-controls"><button type="button" data-deep="summon">呼叫商人 · ${DEEP.merchantCallDm} 暗物质</button><label>当前有效报价<select id="deep-offer"></select></label><label>出售<select id="deep-sell">${resources}</select></label><label>购入<select id="deep-buy">${resources}</select></label><label>出售数量<input id="deep-amount" value="1000" inputmode="decimal" /></label><button type="button" id="deep-trade" data-deep="trade">确认成交</button></div><p id="deep-trade-quote" role="status"></p><p class="space-status" role="status"></p><div id="deep-offers"></div></div>
 <h3 class="group-title">残骸与回收</h3><p class="muted">战斗损失舰船的金属和晶体成本各有 30% 进入残骸。回收量受回收船与全队空余货舱共同限制，返航后入库；黑洞不会产生残骸。</p><div id="deep-debris"></div>
 <h3 class="group-title">深空航行与战斗报告</h3><p class="muted">下列为实际任务结果。海盗和异星使用六回合编队聚合战斗：双方同时攻击、每回合护盾恢复、舰体损伤累积，快速射击按几何期望加权；不是逐舰随机射击模拟器。仅本支派遣舰队承担风险，不会袭击离线母星。</p><div id="deep-reports"></div>
 <details><summary>驻留时长、公开概率与保护规则</summary><p class="muted">1 段 = ${DEEP.segmentSeconds} 游戏秒；每多驻留一段，空域减少 4 个百分点，转给金属 +2、晶体 +1、重氢 +1。以下是基础概率，保护与保底会改变实际落点，曲率不会改表。未指定数值为当前开发调参值。</p>
 <table class="ov-table"><thead><tr><th>事件</th><th>1 段</th><th>2 段</th><th>3 段</th></tr></thead><tbody>${ARCADE_SYMBOLS.map(id=>`<tr><td>${arcadeSymbolDef(id).nameZh}</td>${[1,2,3].map(n=>`<td>${chargeChances(n)[id]}%</td>`).join("")}</tr>`).join("")}</tbody></table>
 <p>前 20 次充能不出黑洞；黑洞后 30 次不再出；结算时本支舰队价值超过帝国可飞行舰队 50% 时改判乱流。保护不免除海盗/异星战损。未受保护的黑洞会摧毁整支充能舰队。</p></details>`;}
function el<T extends HTMLElement=HTMLElement>(r:ParentNode,s:string):T{const n=r.querySelector<T>(s);if(!n)throw Error(`缺少深空节点 ${s}`);return n;}
function put(r:ParentNode,s:string,t:string){const n=el(r,s);if(n.textContent!==t)n.textContent=t;}
function html(r:ParentNode,s:string,t:string){const n=el(r,s);if(n.dataset.signature===t)return;const open=[...n.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.report);n.innerHTML=t;n.dataset.signature=t;for(const d of n.querySelectorAll<HTMLDetailsElement>('details'))if(open.includes(d.dataset.report))d.open=true;}
export function installDeepPanel(root:HTMLElement,onAction:(a:DeepAction)=>void, openCharge:()=>void){
 el<HTMLSelectElement>(root,"#deep-buy").value="crystal";
 const kicker=root.querySelector(".brand .kicker");if(kicker)kicker.textContent=`Planet surface · v${pkg.version}`;
 const save=root.querySelector('[data-tab-panel="save"]');
 save?.insertAdjacentHTML('beforeend','<p class="muted">以前指挥界面版本的存档仍保存在原键中，不会自动清除或混合导入。</p><button type="button" data-deep="export-legacy">导出旧站原始存档</button>');
 const arcade=root.querySelector('[data-tab-panel="arcade"]');
 arcade?.insertAdjacentHTML('afterbegin','<p class="muted">信标规则保持原样；舰队充能请到“深空”或“舰队”页。充能回放不再次发奖，奖励在舰队返航后进入出发星球。统计含两类回放，不应直接与信标概率对比。</p>');
 const updateRing=installRingVisual(root);
 const updateDashboard=installDeepDashboard(root);
 root.addEventListener('click',e=>{
  const b=e.target instanceof Element?e.target.closest<HTMLButtonElement>('[data-deep]'):null;if(!b||b.disabled)return;
  const a=b.dataset.deep;
  if(a==="summon")onAction({type:"summon-merchant"});
  if(a==="trade")onAction({type:"trade",offer:el<HTMLSelectElement>(root,'#deep-offer').value,sell:el<HTMLSelectElement>(root,'#deep-sell').value as ResourceId,buy:el<HTMLSelectElement>(root,'#deep-buy').value as ResourceId,amount:el<HTMLInputElement>(root,'#deep-amount').value.trim()});
  if(a==="export-legacy")onAction({type:"export-legacy"});
  if(a==="arcade")root.querySelector<HTMLButtonElement>('[data-tab="arcade"]')?.click();
  if(a==="charge")openCharge();
 });
 return (state:GameState)=>{
  updateRing(state);
  if(el(root,'#space-deep').hidden)return;
  const d=state.deepSpace,now=state.totalTime.toNumber();
  put(root,'#deep-status',`已完成充能 ${d.completed} 次 · 远征 ${state.fleets.filter(f=>f.mission==="charge").length}/${expeditionSlots(state)} · 待揭晓 ${state.arcade.runs.length} + 预留 ${chargeReservations(state)}/${storedRunLimit(state)}`);
  put(root,'#deep-protection',d.completed<20?`新手黑洞保护：还剩 ${20-d.completed} 次。保护不包括海盗或异星战斗。`:d.lastBlackhole&&d.completed-d.lastBlackhole<30?`黑洞冷却保护：还剩 ${30-(d.completed-d.lastBlackhole)} 次。`:'黑洞新手/冷却保护已结束；超过全帝国舰队价值 50% 的保护在事件结算时判定。');
  const active=d.offers.filter(o=>o.planetId===state.activePlanetId&&o.startsAt>=0&&o.expiresAt>now&&big(o.remainingMe).gt(0)),select=el<HTMLSelectElement>(root,'#deep-offer'),sig=active.map(o=>o.id).join('|');
  if(select.dataset.signature!==sig){const previous=select.value;select.innerHTML=active.map(o=>`<option value="${o.id}">${o.id}</option>`).join('')||'<option value="">暂无有效报价</option>';if(active.some(o=>o.id===previous))select.value=previous;select.dataset.signature=sig;}
  const q=tradeQuote(state,select.value,el<HTMLSelectElement>(root,'#deep-sell').value as ResourceId,el<HTMLSelectElement>(root,'#deep-buy').value as ResourceId,el<HTMLInputElement>(root,'#deep-amount').value.trim());
  put(root,'#deep-trade-quote',q.reason);el<HTMLButtonElement>(root,'#deep-trade').disabled=!q.ok;
  html(root,'#deep-offers',d.offers.filter(o=>o.startsAt<0||o.expiresAt>now).map(o=>`<p>${enc(o.id)} · ${enc(state.planets.find(p=>p.id===o.planetId)?.name??o.planetId)} · ${o.ratios.metal.toFixed(3)} : ${o.ratios.crystal.toFixed(3)} : ${o.ratios.deuterium.toFixed(3)} · 余额 ${formatAmount(big(o.remainingMe))} 金属当量 · ${o.startsAt<0?'等待舰队返航':`剩余 ${formatDuration(Math.ceil(o.expiresAt-now))}`}</p>`).join('')||'<p class="muted">尚无商人联络。深空商船事件可免费获得，也可花暗物质呼叫。</p>');
  html(root,'#deep-debris',d.debris.map(f=>`<div class="space-planet"><strong>[${coordinateKey(f.target)}]</strong><span>金属 ${formatAmount(big(f.metal))} · 晶体 ${formatAmount(big(f.crystal))}</span><button type="button" data-space="route" data-coordinate="${coordinateKey(f.target)}" data-mission="recycle">派遣回收船</button></div>`).join('')||'<p class="muted">暂无残骸。只有真实遭遇战造成的舰船损失才会生成残骸。</p>');
  html(root,'#deep-reports',d.reports.slice().reverse().map(r=>`<details class="ov-card" data-report="${r.id}"><summary>#${r.fleetId} · ${arcadeSymbolDef(r.symbol).nameZh} · [${coordinateKey(r.target)}] · ${r.slots} 段 · ${chargeDeliveryStatus(state,r)}</summary><ul>${r.lines.map(t=>`<li>${enc(t)}</li>`).join('')}</ul>${r.battle?`<div class="space-table-scroll"><table class="ov-table"><thead><tr><th>回合</th><th>己方剩余</th><th>敌方剩余</th><th>己方输出</th><th>敌方输出</th></tr></thead><tbody>${r.battle.rounds.map(b=>`<tr><td>${b.round}</td><td>${b.attacker}</td><td>${b.defender}</td><td>${formatAmount(big(b.attackDamage))}</td><td>${formatAmount(big(b.defendDamage))}</td></tr>`).join('')}</tbody></table></div>`:''}</details>`).join('')||'<p class="muted">派出第一支充能舰队后，这里会记录实际结果、保护判定与战报。</p>');
  updateDashboard(state);
 };
}
