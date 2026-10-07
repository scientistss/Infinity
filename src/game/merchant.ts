import { DEEP } from "../data/deep-space";
import { activePlanet, withPlanet } from "./empire";
import { economy } from "./economy";
import { big, isValidAmount } from "./decimal";
import { Rng } from "./rng";
import { RESOURCE_IDS, type GameState, type ResourceId } from "./types";
import type { MerchantOffer } from "./deep-state";
export function createOffer(state:GameState,planetId:string,seed:number,active:boolean):{state:GameState;id:string} {
  const now=state.totalTime.toNumber(),rng=new Rng(seed);
  const offers=state.deepSpace.offers.filter(o=>o.startsAt<0||o.expiresAt>now);
  if(offers.length>=DEEP.offerLimit)throw Error("商人报价数量已满");
  const id=`merchant-${state.deepSpace.nextOfferId}`;
  const ratios={metal:3*(.85+.3*rng.next()),crystal:2*(.85+.3*rng.next()),deuterium:.85+.3*rng.next()};
  const offer:MerchantOffer={id,planetId,startsAt:active?now:-1,expiresAt:active?now+DEEP.merchantSeconds:-1,ratios,remainingMe:String(DEEP.merchantBudget)};
  return {id,state:{...state,deepSpace:{...state.deepSpace,offers:[...offers,offer],nextOfferId:state.deepSpace.nextOfferId+1}}};
}
export function summonMerchant(state:GameState) {
  const fail=(reason:string)=>({state,ok:false,reason});
  if(state.research.levels.astrophysics<1)return fail("需要天体物理学 1 级");
  const now=state.totalTime.toNumber();
  if(state.deepSpace.offers.some(o=>o.planetId===state.activePlanetId&&o.startsAt>=0&&o.expiresAt>now&&big(o.remainingMe).gt(0)))return fail("当前星球已有有效商人，先使用其报价");
  if(state.darkMatter.lt(DEEP.merchantCallDm))return fail(`暗物质不足，需要 ${DEEP.merchantCallDm}`);
  if(state.deepSpace.offers.filter(o=>o.startsAt<0||o.expiresAt>now).length>=DEEP.offerLimit)return fail("商人列表已满");
  const rng=new Rng(state.deepSpace.seed);const seed=Math.floor(rng.next()*4294967296);
  const result=createOffer({...state,darkMatter:state.darkMatter.sub(DEEP.merchantCallDm),deepSpace:{...state.deepSpace,seed:rng.seed}},state.activePlanetId,seed,true);
  return {state:result.state,ok:true,reason:"商人已到港，报价固定 10 分钟，可分次成交"};
}
export function tradeQuote(state:GameState,id:string,sell:ResourceId,buy:ResourceId,amount:string) {
  const fail=(reason:string)=>({ok:false,reason,received:big(0),spent:big(0),volume:big(0)});
  const offer=state.deepSpace.offers.find(o=>o.id===id),now=state.totalTime.toNumber();
  if(!offer||offer.startsAt<0||offer.expiresAt<=now)return fail("报价不存在、未到港或已过期");
  if(offer.planetId!==state.activePlanetId)return fail("请先切换到商人停靠的星球");
  if(!RESOURCE_IDS.includes(sell)||!RESOURCE_IDS.includes(buy)||sell===buy)return fail("需要两种不同的资源");
  if(typeof amount!=="string"||amount.length>100||!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(amount))return fail("数量格式无效");
  const spent=big(amount);
  if(!isValidAmount(spent)||spent.lte(0)||!spent.eq(spent.floor()))return fail("数量必须为正整数");
  const volume=spent.mul(3/offer.ratios[sell]),received=spent.mul(offer.ratios[buy]/offer.ratios[sell]*(1-DEEP.merchantFee)).floor();
  if(received.lt(1))return fail("成交数量太小");
  if(volume.gt(offer.remainingMe))return fail("超出商人剩余交易额度");
  const planet=activePlanet(state);
  if(planet.resources[sell].lt(spent))return fail("出售资源不足");
  if(planet.resources[buy].add(received).gt(economy(state).caps[buy]))return fail("接收仓库容量不足");
  return {ok:true,reason:`可换取 ${received.toString()}（已扣 3% 手续费）`,received,spent,volume};
}
export function trade(state:GameState,id:string,sell:ResourceId,buy:ResourceId,amount:string) {
  const q=tradeQuote(state,id,sell,buy,amount);if(!q.ok)return {state,ok:false,reason:q.reason};
  const resources={...activePlanet(state).resources};resources[sell]=resources[sell].sub(q.spent);resources[buy]=resources[buy].add(q.received);
  const next=withPlanet(state,{resources});
  return {state:{...next,deepSpace:{...next.deepSpace,offers:next.deepSpace.offers.map(o=>o.id===id?{...o,remainingMe:big(o.remainingMe).sub(q.volume).max(0).toString()}:o)}},ok:true,reason:"交易已完成，未计入自然产出"};
}
