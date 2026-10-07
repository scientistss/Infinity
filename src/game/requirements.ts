import { activePlanet } from "./empire";
/**
 * Prerequisite checks shared by buildings and research. Only finished levels count (OGame rule):
 * an order still in a queue does not satisfy a requirement.
 */
import { buildingById, isBuildingId } from "../data/buildings";
import { isResearchId, researchById } from "../data/research";
import type { GameState } from "./types";

export interface Requirement {
  kind: "building" | "research";
  id: string;
  level: number;
}

export function requirementName(req: Requirement): string {
  if (req.kind === "building" && isBuildingId(req.id)) return buildingById(req.id).nameZh;
  if (req.kind === "research" && isResearchId(req.id)) return researchById(req.id).nameZh;
  return req.id;
}

export function requirementLevel(state: GameState, req: Requirement): number {
  if (req.kind === "building" && isBuildingId(req.id)) return activePlanet(state).buildings[req.id];
  if (req.kind === "research" && isResearchId(req.id)) return state.research.levels[req.id];
  return 0;
}

/** Unmet requirements as "能源技术 等级 3". */
export function missingRequirements(state: GameState, requires: readonly Requirement[]): string[] {
  const missing: string[] = [];
  for (const req of requires) {
    if (requirementLevel(state, req) < req.level) missing.push(`${requirementName(req)} 等级 ${req.level}`);
  }
  return missing;
}
