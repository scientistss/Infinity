import { DEEP } from "../data/deep-space";
import { BOARD, BET_SYMBOLS, isArcadeSymbol, LUCKY_TABLE } from "../data/arcade";
import { SHIP_IDS, type ShipId } from "../data/units";
import { INVENTORY_IDS } from "../data/dark-matter";
import { validCoordinates, coordinateKey } from "./galaxy";
import { big, isValidAmount } from "./decimal";
import type { GameState } from "./types";
import type { ChargeOrder, ChargeReceipt, DeepState, ShipCounts } from "./deep-state";
import type { BattleResult, BattleRound } from "./encounter-combat";
import type { RunOutcome, LightRoll } from "./arcade";
function obj(x:unknown):Record<string,unknown>{if(!x||typeof x!=="object"||Array.isArray(x))throw Error("深空数据格式错误");return x as Record<string,unknown>;}
function num(x:unknown,max=1e200,min=0):number {if(typeof x!=="number"||!Number.isFinite(x)||x<min||x>max)throw Error("深空数值无效");return x;}
function int(x:unknown,max=Number.MAX_SAFE_INTEGER,min=0):number{const n=num(x,max,min);if(!Number.isInteger(n))throw Error("深空整数无效");return n;}
function text(x:unknown,max=100):string{if(typeof x!=="string"||!x.length||x.length>max)throw Error("深空文本无效");return x;}
function bool(x:unknown):boolean{if(typeof x!=="boolean")throw Error("深空标记无效");return x;}
function list(x:unknown,max:number):unknown[]{if(!Array.isArray(x)||x.length>max)throw Error("深空列表无效");return x;}
function money(x:unknown):string{const s=text(x);if(!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(s)||!isValidAmount(big(s)))throw Error("深空资源无效");return s;}
const id=(x:unknown)=>{const s=text(x);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(s))throw Error("深空 ID 无效");return s;};
function unique<T>(items:T[],key:(item:T)=>string):T[]{if(new Set(items.map(key)).size!==items.length)throw Error("深空记录重复");return items;}
function light(x:unknown):LightRoll{const r=obj(x);return {tile:int(r.tile,23),big:bool(r.big),u:num(r.u,1),v:num(r.v,1)};}
function outcome(x:unknown):RunOutcome{
 const r=obj(x),main=light(r.main);let lucky:RunOutcome["lucky"]=null;
 if(r.lucky!==null){const l=obj(r.lucky);if(!LUCKY_TABLE.some(row=>row.kind===l.kind))throw Error("送灯类型无效");lucky={kind:l.kind as NonNullable<RunOutcome["lucky"]>["kind"],lights:list(l.lights,6).map(light)};}
 if(r.forced!==null&&r.forced!=="empty"&&r.forced!=="jackpot")throw Error("充能保底无效");
 return {main,lucky,forced:r.forced as RunOutcome["forced"]};
}
function ships(x:unknown):ShipCounts{const result:ShipCounts={};for(const [k,v]of Object.entries(obj(x))){if(!SHIP_IDS.includes(k as ShipId)||k==="solar_satellite")throw Error("战报舰种无效");result[k as ShipId]=int(v,1e12);}return result;}
function battle(x:unknown):BattleResult|null{
 if(x===null)return null;const b=obj(x);
 if(b.mode!=="squadron-v1"||!["attacker","defender","draw"].includes(String(b.winner)))throw Error("战报模式无效");
 const a=ships(b.attackerBefore),d=ships(b.defenderBefore),aa=ships(b.attackerAfter),dd=ships(b.defenderAfter);
 for(const s of SHIP_IDS)if((aa[s]??0)>(a[s]??0)||(dd[s]??0)>(d[s]??0))throw Error("战报舰船无故增加");
 const rounds=list(b.rounds,6).map((x,i):BattleRound=>{const r=obj(x);if(r.round!==i+1)throw Error("战报回合错误");return {round:i+1,attacker:int(r.attacker),defender:int(r.defender),attackDamage:num(r.attackDamage),defendDamage:num(r.defendDamage)};});
 return {mode:"squadron-v1",winner:b.winner as BattleResult["winner"],attackerBefore:a,defenderBefore:d,attackerAfter:aa,defenderAfter:dd,rounds};
}
export function readReceipt(x:unknown):ChargeReceipt{
 const r=obj(x);const lights=list(r.lights,7).map(x=>{const l=obj(x);if(!isArcadeSymbol(l.symbol))throw Error("回放符号无效");const tile=int(l.tile,23);if(BOARD[tile]!==l.symbol)throw Error("回放落点与符号不一致");return {tile,symbol:l.symbol,big:bool(l.big),paid:bool(l.paid)};});
 if(!lights.length)throw Error("回放没有落点");
 return {reportId:id(r.reportId),originId:id(r.originId),lines:list(r.lines,DEEP.maxReceiptLines).map(s=>text(s,1000)),lights};
}
export function readCharge(x:unknown):ChargeOrder {
 const c=obj(x);if(!["outbound","holding","return"].includes(String(c.phase)))throw Error("充能阶段无效");
 const rawBets=obj(c.bets),bets={metal:0,crystal:0,deuterium:0,drifter:0};
 for(const s of BET_SYMBOLS)bets[s]=int(rawBets[s],12);
 const total=Object.values(bets).reduce((a,b)=>a+b,0),stake=num(c.stake),betUnit=num(c.betUnit);
 if(total>12||Math.abs(stake-total*betUnit)>Math.max(1e-8,stake*1e-12))throw Error("充能押注不守恒");
 const items:ChargeOrder["items"]={};for(const [k,v]of Object.entries(obj(c.items))){if(!(INVENTORY_IDS as readonly string[]).includes(k))throw Error("充能道具无效");items[k]=int(v,100);}
 const result:ChargeOrder={slots:int(c.slots,3,1),phase:c.phase as ChargeOrder["phase"],cargoFactor:num(c.cargoFactor,51,1),bets,stake,betUnit,dm:int(c.dm,100000),items,offerId:c.offerId===null?null:id(c.offerId),reportId:c.reportId===null?null:id(c.reportId)};
 if((result.phase!=="return"||!result.reportId)&&(result.dm||Object.values(items).some(n=>n)||result.offerId||result.reportId))throw Error("未结束充能不应持有奖励");
 return result;
}
export function readDeepState(x:unknown,state:GameState):DeepState {
 const r=obj(x),completed=int(r.completed),lastBlackhole=int(r.lastBlackhole,completed),now=state.totalTime.toNumber();
 const reports=unique(list(r.reports,DEEP.reportLimit).map(x=>{
  const p=obj(x);if(!isArcadeSymbol(p.symbol)||!isArcadeSymbol(p.rawSymbol)||!validCoordinates(p.target,true))throw Error("充能报告目标或符号无效");
  const o=outcome(p.outcome);if(BOARD[o.main.tile]!==p.symbol)throw Error("战报符号与落点不一致");
  if(typeof p.protection!=="string"||p.protection.length>300)throw Error("保护说明无效");
  return {id:id(p.id),fleetId:int(p.fleetId,Number.MAX_SAFE_INTEGER,1),originId:id(p.originId),at:num(p.at,now+1e-6),target:{...p.target},slots:int(p.slots,3,1),rawSymbol:p.rawSymbol,symbol:p.symbol,protection:p.protection,outcome:o,lines:list(p.lines,DEEP.maxReceiptLines).map(s=>text(s,1000)),returned:bool(p.returned),destroyed:bool(p.destroyed),battle:battle(p.battle)};
 }),r=>r.id);
 const offers=unique(list(r.offers,DEEP.offerLimit).map(x=>{
  const o=obj(x),planetId=id(o.planetId);if(!state.planets.some(p=>p.id===planetId))throw Error("商人所在星球不存在");
  const ratios=obj(o.ratios);const startsAt=num(o.startsAt,1e200,-1),expiresAt=num(o.expiresAt,1e200,-1);
  if(startsAt===-1?expiresAt!==-1:startsAt<0||expiresAt<startsAt)throw Error("商人到期时间无效");
  return {id:id(o.id),planetId,startsAt,expiresAt,remainingMe:money(o.remainingMe),ratios:{metal:num(ratios.metal,3.45,2.55),crystal:num(ratios.crystal,2.3,1.7),deuterium:num(ratios.deuterium,1.15,.85)}};
 }),o=>o.id);
 const nextOfferId=int(r.nextOfferId,Number.MAX_SAFE_INTEGER-1,1);
 if(offers.some(o=>!/^merchant-\d+$/.test(o.id)||Number(o.id.slice(9))>=nextOfferId))throw Error("商人编号可能重复");
 const debris=unique(list(r.debris,DEEP.debrisLimit).map(x=>{const d=obj(x);if(!validCoordinates(d.target,true))throw Error("残骸坐标无效");return {target:{...d.target},metal:money(d.metal),crystal:money(d.crystal)};}),d=>coordinateKey(d.target));
 return {seed:int(r.seed,0xffffffff),completed,lastBlackhole,emptyStreak:int(r.emptyStreak,1000000),jackpotStreak:int(r.jackpotStreak,1000000),nextOfferId,reports,offers,debris};
}
