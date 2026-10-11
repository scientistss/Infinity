import { coordinateKey, coordinateRandom, homeCoordinates, SPACE, type Coordinates } from "./galaxy";
import { initialNpcGarrison, isNpcCoordinates, isNpcGarrison, isNpcUniverseSeed, survivingNpcGarrison, type NpcGarrison } from "./npc-garrison";
import { isNpcResourceTuple, npcLootEligibility, NPC_WALLET_CAPS, NPC_WALLET_INITIAL_STOCK, NPC_WALLET_RATES, type NpcResourceTuple } from "./npc-loot";

export const NPC_WALLET_MODEL = "npc-wallet-garrison-v1";
export const NPC_WALLET_HORIZON = 12_000;
/** World-size ceiling only. The admitted storage limit must be supplied explicitly. */
export const NPC_WALLET_WORLD_SITE_CEILING = 7_500;

export interface NpcWalletAnchor { readonly stock: NpcResourceTuple; readonly mark: number }
export interface NpcWalletSite extends NpcWalletAnchor { readonly garrison: NpcGarrison }
export interface NpcWalletState {
  readonly model: typeof NPC_WALLET_MODEL;
  readonly now: number;
  readonly baseline: NpcWalletAnchor;
  readonly sites: Readonly<Record<string, NpcWalletSite>>;
}
export interface NpcWalletContext {
  readonly seed: number;
  readonly siteLimit: number;
  readonly playerCoordinates: readonly Coordinates[];
}
export interface NpcWalletSnapshot {
  readonly key: string;
  readonly stock: NpcResourceTuple;
  readonly garrison: NpcGarrison;
}

// Context is transient, not serialized. A factory-validated immutable context
// makes target membership O(1), without changing the minimal persistent schema.
const contextOccupied = new WeakMap<NpcWalletContext, ReadonlySet<string>>();

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return plain(value) && Reflect.ownKeys(value).length === names.length && names.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return !!field && "value" in field && field.enumerable;
  });
}
const stockCopy = (stock: NpcResourceTuple): NpcResourceTuple => Object.freeze([stock[0], stock[1], stock[2]]);
const anchor = (stock: NpcResourceTuple, mark: number): NpcWalletAnchor => Object.freeze({ stock: stockCopy(stock), mark });

export function createNpcWalletContext(seed: number, siteLimit: number, playerCoordinates: readonly Coordinates[]): NpcWalletContext {
  if (!isNpcUniverseSeed(seed) || !Number.isSafeInteger(siteLimit) || siteLimit < 1 || siteLimit > NPC_WALLET_WORLD_SITE_CEILING
    || !Array.isArray(playerCoordinates) || Object.getPrototypeOf(playerCoordinates) !== Array.prototype
    || playerCoordinates.length > NPC_WALLET_WORLD_SITE_CEILING
    || Reflect.ownKeys(playerCoordinates).length !== playerCoordinates.length + 1) {
    throw new TypeError("Invalid NPC wallet context");
  }
  const occupied = new Set<string>(), detached: Coordinates[] = [];
  for (let i = 0; i < playerCoordinates.length; i += 1) {
    const field = Object.getOwnPropertyDescriptor(playerCoordinates, String(i));
    if (!field || !("value" in field) || !field.enumerable || !isNpcCoordinates(field.value)) throw new TypeError("Invalid NPC player coordinate");
    const c = field.value, key = coordinateKey(c);
    if (occupied.has(key)) throw new TypeError("Duplicate NPC player coordinate");
    occupied.add(key); detached.push(Object.freeze({ galaxy: c.galaxy, system: c.system, position: c.position }));
  }
  occupied.add(coordinateKey(homeCoordinates(seed)));
  const context = Object.freeze({ seed, siteLimit, playerCoordinates: Object.freeze(detached) });
  contextOccupied.set(context, occupied);
  return context;
}

function occupied(context: NpcWalletContext): ReadonlySet<string> {
  const result = contextOccupied.get(context);
  if (!result) throw new TypeError("NPC wallet context must come from createNpcWalletContext");
  return result;
}
function target(coordinate: Coordinates, context: NpcWalletContext): string {
  const owned = occupied(context);
  if (!isNpcCoordinates(coordinate)) throw new TypeError("Invalid NPC coordinate");
  const key = coordinateKey(coordinate);
  if (owned.has(key) || coordinateRandom(context.seed, coordinate) >= SPACE.npcDensity) throw new TypeError("Target is not a current NPC");
  return key;
}
function coordinateFromKey(key: string): Coordinates | null {
  if (!/^[1-9]\d*:[1-9]\d*:[1-9]\d*$/.test(key)) return null;
  const [galaxy, system, position] = key.split(":").map(Number);
  const c = { galaxy, system, position };
  return isNpcCoordinates(c) && coordinateKey(c) === key ? c : null;
}
function validAnchor(value: unknown, now: number, site = false): value is NpcWalletAnchor {
  return fields(value, site ? ["stock", "mark", "garrison"] : ["stock", "mark"])
    && isNpcResourceTuple(value.stock) && typeof value.mark === "number" && Number.isFinite(value.mark)
    && value.mark >= 0 && value.mark <= now;
}
function validHeader(value: unknown): value is NpcWalletState {
  return fields(value, ["model", "now", "baseline", "sites"]) && value.model === NPC_WALLET_MODEL
    && typeof value.now === "number" && Number.isFinite(value.now) && value.now >= 0 && value.now < NPC_WALLET_HORIZON
    && validAnchor(value.baseline, value.now) && plain(value.sites);
}
function assertHeader(state: NpcWalletState): void {
  if (!validHeader(state)) throw new TypeError("Invalid NPC wallet header");
}
function siteAt(state: NpcWalletState, key: string, c: Coordinates, context: NpcWalletContext): NpcWalletSite | undefined {
  const field = Object.getOwnPropertyDescriptor(state.sites, key);
  if (!field) return undefined;
  if (!("value" in field) || !field.enumerable || !validAnchor(field.value, state.now, true)
    || !isNpcGarrison((field.value as NpcWalletSite).garrison, context.seed, c)) throw new TypeError("Invalid NPC wallet site");
  return field.value as NpcWalletSite;
}

/** Full O(sites) boundary validation. Call before adopting untrusted decoded data. */
export function isNpcWalletState(value: unknown, context: NpcWalletContext): value is NpcWalletState {
  occupied(context);
  if (!validHeader(value)) return false;
  const keys = Reflect.ownKeys(value.sites);
  if (keys.length > context.siteLimit) return false;
  for (const key of keys) {
    if (typeof key !== "string") return false;
    const c = coordinateFromKey(key);
    if (!c) return false;
    try { target(c, context); siteAt(value, key, c, context); } catch { return false; }
  }
  return true;
}

/** Strict detached import, with no repair, projection, migration or re-anchoring. */
export function readNpcWalletState(value: unknown, context: NpcWalletContext): NpcWalletState {
  if (!isNpcWalletState(value, context)) throw new TypeError("Invalid NPC wallet state");
  const sites: Record<string, NpcWalletSite> = {};
  for (const key of Object.keys(value.sites)) {
    const site = value.sites[key];
    sites[key] = Object.freeze({ ...anchor(site.stock, site.mark), garrison: Object.freeze({ ...site.garrison }) });
  }
  return Object.freeze({ model: NPC_WALLET_MODEL, now: value.now, baseline: anchor(value.baseline.stock, value.baseline.mark), sites: Object.freeze(sites) });
}

export function createNpcWallet(): NpcWalletState {
  return Object.freeze({ model: NPC_WALLET_MODEL, now: 0, baseline: anchor(NPC_WALLET_INITIAL_STOCK, 0), sites: Object.freeze({}) });
}

/** Copy an already-accepted r12 snapshot's resources once. This does not validate or read an r12 save. */
export function npcWalletFromSnapshot(resources: Readonly<{ metal: number; crystal: number; deuterium: number }>): NpcWalletState {
  if (!fields(resources, ["metal", "crystal", "deuterium"])) throw new TypeError("Invalid NPC snapshot resources");
  const stock: NpcResourceTuple = [resources.metal, resources.crystal, resources.deuterium];
  if (!isNpcResourceTuple(stock)) throw new TypeError("Invalid NPC snapshot resources");
  return Object.freeze({ model: NPC_WALLET_MODEL, now: 0, baseline: anchor(stock, 0), sites: Object.freeze({}) });
}

function projectAnchor(value: NpcWalletAnchor, now: number): NpcResourceTuple {
  const elapsed = now - value.mark;
  return Object.freeze([
    Math.min(NPC_WALLET_CAPS[0], value.stock[0] + NPC_WALLET_RATES[0] * elapsed),
    Math.min(NPC_WALLET_CAPS[1], value.stock[1] + NPC_WALLET_RATES[1] * elapsed),
    Math.min(NPC_WALLET_CAPS[2], value.stock[2] + NPC_WALLET_RATES[2] * elapsed),
  ]);
}

/** O(1) trusted-state read: it checks the header and selected record, not every unrelated site. */
export function projectNpc(state: NpcWalletState, coordinate: Coordinates, context: NpcWalletContext): NpcWalletSnapshot {
  assertHeader(state);
  const key = target(coordinate, context), site = siteAt(state, key, coordinate, context);
  return Object.freeze({ key, stock: projectAnchor(site ?? state.baseline, state.now),
    garrison: site ? Object.freeze({ ...site.garrison }) : initialNpcGarrison(context.seed, coordinate) });
}

/**
 * Trusted-state advance: ordinary steps are O(1), crossing steps O(sites).
 * The adopted segment END is authoritative. Never split a segment at H or
 * relocate on reads. Different segment partitions can change future rounding.
 */
export function advanceNpcWallet(state: NpcWalletState, seconds: number, context: NpcWalletContext): NpcWalletState {
  assertHeader(state); occupied(context);
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) throw new TypeError("Invalid NPC adopted segment");
  if (seconds === 0) return state;
  const full = seconds >= NPC_WALLET_HORIZON;
  const endpoint = full ? 0 : state.now + seconds;
  if (!full && endpoint < NPC_WALLET_HORIZON) return endpoint === state.now ? state : Object.freeze({ ...state, now: endpoint });
  if (!isNpcWalletState(state, context)) throw new TypeError("Invalid NPC wallet state");
  const settled = (wallet: NpcWalletAnchor) => anchor(full ? NPC_WALLET_CAPS : projectAnchor(wallet, endpoint), 0);
  const sites: Record<string, NpcWalletSite> = {};
  for (const key of Object.keys(state.sites)) sites[key] = Object.freeze({ ...settled(state.sites[key]), garrison: state.sites[key].garrison });
  return Object.freeze({ model: NPC_WALLET_MODEL, now: 0, baseline: settled(state.baseline), sites: Object.freeze(sites) });
}

/** Pure dispatch candidate only. The caller must adopt it atomically with successful payment. */
export function materializeNpcAtPaidLaunch(state: NpcWalletState, coordinate: Coordinates, context: NpcWalletContext): NpcWalletState {
  if (!isNpcWalletState(state, context)) throw new TypeError("Invalid NPC wallet state");
  const key = target(coordinate, context);
  if (Object.hasOwn(state.sites, key)) return state;
  if (Object.keys(state.sites).length >= context.siteLimit) throw new RangeError("NPC materialized site limit reached");
  const site = Object.freeze({ ...anchor(projectAnchor(state.baseline, state.now), state.now), garrison: initialNpcGarrison(context.seed, coordinate) });
  return Object.freeze({ ...state, sites: Object.freeze({ ...state.sites, [key]: site }) });
}

/**
 * Atomic local arrival candidate: permanent losses plus only actually loaded
 * integers. A zero-loot result deliberately does NOT re-anchor the wallet.
 * This differs from the exploratory prototype's debit(0).
 */
export function debitNpcAtArrival(
  state: NpcWalletState, coordinate: Coordinates, loot: NpcResourceTuple, survivors: NpcGarrison, context: NpcWalletContext,
): NpcWalletState {
  if (!isNpcWalletState(state, context)) throw new TypeError("Invalid NPC wallet state");
  const key = target(coordinate, context), site = siteAt(state, key, coordinate, context);
  if (!site) throw new TypeError("NPC arrival requires a materialized site");
  const garrison = survivingNpcGarrison(site.garrison, survivors, context.seed, coordinate);
  const before = projectAnchor(site, state.now), eligible = npcLootEligibility(before);
  if (!isNpcResourceTuple(loot) || loot.some((amount, i) => !Number.isSafeInteger(amount) || amount > eligible[i])) throw new TypeError("Invalid NPC integer loot debit");
  const positive = loot.some(amount => amount > 0);
  if (!positive && garrison.light_fighter === site.garrison.light_fighter && garrison.heavy_fighter === site.garrison.heavy_fighter) return state;
  // Each integer debit is <= half of bounded stock: the remaining subtraction
  // is exact in this Number domain. Retain the represented conservation check.
  const after: NpcResourceTuple = [before[0] - loot[0], before[1] - loot[1], before[2] - loot[2]];
  if (after.some((amount, i) => amount < 0 || amount + loot[i] !== before[i])) throw new TypeError("NPC loot debit cannot be represented exactly");
  const next = Object.freeze({ ...(positive ? anchor(after, state.now) : { stock: site.stock, mark: site.mark }), garrison });
  return Object.freeze({ ...state, sites: Object.freeze({ ...state.sites, [key]: next }) });
}
