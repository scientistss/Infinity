/** Synthetic component boundary only. No production entry point imports this file.
 * Real DOM, real panel and domain reducers; observation/replay is test-controlled.
 * This is not evidence of whole-app SaveSession protection or recovery.
 */
import { buildingTemplatesPanelHtml, installBuildingTemplatesPanel } from "../src/ui/building-templates-panel";
import { applyBuildingTemplateAction, buildingTemplateAuthorityKey, createBuildingTemplate, editBuildingTemplate } from "../src/game/building-templates";
import { createOrderTask, pauseOrderTask, resumeOrderTask } from "../src/game/orders";
import { createInitialState } from "../src/game/state";
import { createPlanet } from "../src/game/planet";
import { serializeState } from "../src/game/save";
import type { GameState } from "../src/game/types";
import type { BuildingTemplateAction } from "../src/game/building-template-state";

const scenario = new URLSearchParams(location.search).get("case") ?? "normal-enter";
const root = document.querySelector<HTMLElement>("#component")!;
root.innerHTML = buildingTemplatesPanelHtml();
const panel = root.querySelector<HTMLDetailsElement>("#building-templates")!;
const payer = root.querySelector<HTMLSelectElement>("#building-template-payer")!;
function accepted<T extends {ok: boolean; reason: string; state: GameState}>(result: T): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}
let state = createInitialState(0x11112222, 0x33334444);
state = {...state, planets: [...state.planets, createPlanet("authority-colony", {galaxy: 1, system: 2, position: 8})]};
state = accepted(createBuildingTemplate(state, {name: "Authority fixture", goals: [
  {building: "metal_mine", targetLevel: 3}, {building: "crystal_mine", targetLevel: 2},
]}, state.buildingTemplates.nextTemplateId));
if (scenario === "order-aba") {
  state = accepted(createOrderTask(state, {kind: "building", building: "metal_mine", targetLevel: 3,
    planetId: "homeworld", budget: {metal: "0", crystal: "0", deuterium: "0"}, expectedNextTaskId: state.orders.nextTaskId}));
  state = accepted(pauseOrderTask(state, 1));
}
const initialState = serializeState(state);
const actions: {action: BuildingTemplateAction; ok: boolean; reason: string; createdTaskIds: number[]}[] = [];
const observations: object[] = [];
const submissions: object[] = [];
let writable = true;
const controller = installBuildingTemplatesPanel(root, action => {
  const result = applyBuildingTemplateAction(state, action);
  actions.push({action, ok: result.ok, reason: result.reason, createdTaskIds: result.createdTaskIds});
  state = result.state;
  controller.completeAction(result.reason, result.ok);
  controller.update(state, writable);
});
root.addEventListener("submit", event => {
  const submit = event as SubmitEvent;
  submissions.push({trusted: event.isTrusted, submitter: submit.submitter?.id ?? null});
}, true);
controller.update(state, true);
panel.open = true;
let oldControl: HTMLButtonElement | null = null;
let oldParent: Node | null = null;
function observe(label: string) {
  controller.observe(state, writable);
  observations.push({label, writable, folded: !panel.open, payer: payer.value,
    authorityKey: buildingTemplateAuthorityKey(state, 1, payer.value), state: serializeState(state),
    reviewHidden: root.querySelector<HTMLElement>("#building-template-review-panel")!.hidden,
    confirmDisabled: root.querySelector<HTMLButtonElement>("#building-template-confirm-apply")!.disabled});
}
function retain(selector: string) {
  oldControl = root.querySelector<HTMLButtonElement>(selector);
  if (!oldControl || oldControl.disabled || !oldControl.isConnected) throw new Error("Expected live original control: " + selector);
  oldParent = oldControl.parentNode;
}
function replay() {
  if (!oldControl) throw new Error("Capture a live control first");
  const wasConnected = oldControl.isConnected, wasDisabled = oldControl.disabled;
  // Explicit adversarial same-node reinsertion and disabled-attribute tampering.
  // The production handler must reject this even though DOM flags are writable.
  if (!oldControl.isConnected) oldParent!.appendChild(oldControl);
  oldControl.disabled = false;
  oldControl.dispatchEvent(new MouseEvent("click", {bubbles: true}));
  return {wasConnected, wasDisabled, replayed: true};
}
function transition() {
  const a = state;
  panel.open = false;
  observe("A: folded original");
  if (scenario === "order-aba") {
    state = accepted(resumeOrderTask(state, 1)); observe("B: real resumeOrderTask");
    state = accepted(pauseOrderTask(state, 1)); observe("A: real pauseOrderTask");
  } else if (scenario === "template-edit-aba" || scenario === "template-snapshot-replay") {
    state = accepted(editBuildingTemplate(state, 1, 1, {name: "Edited intermediate template", goals: [{building: "solar_plant", targetLevel: 2}]}));
    observe("B: real editBuildingTemplate");
    if (scenario === "template-edit-aba") {
      const original = a.buildingTemplates.templates[0]!;
      state = accepted(editBuildingTemplate(state, 1, 2, {name: original.name, goals: original.goals}));
      observe("A intent restored by real editBuildingTemplate, revision increases to 3");
    } else { state = a; observe("A: synthetic prior-state replay (no production rollback claim)"); }
  } else if (scenario === "payer-aba") {
    payer.value = "authority-colony"; observe("B: execution-payer value changed without a change event");
    payer.value = "homeworld"; observe("A: execution-payer value restored without a change event");
  } else if (scenario.startsWith("protected-")) {
    writable = false; observe("B: synthetic observe(false), not a SaveSession transition");
    writable = true; observe("A: synthetic observe(true), not a SaveSession recovery");
  } else throw new Error("No observation transition for " + scenario);
  panel.open = true;
}
function detachEditor() {
  const editor = root.querySelector<HTMLFormElement>("#building-template-editor")!;
  const parent = editor.parentNode!, next = editor.nextSibling;
  editor.remove(); parent.insertBefore(editor, next);
  // No submitter was the original bypass. Dispatch in the same task, before the
  // observer callback; fixed authorized() drains MutationObserver.takeRecords().
  editor.dispatchEvent(new SubmitEvent("submit", {bubbles: true, cancelable: true}));
}
function detachPanel() {
  const parent = panel.parentNode!, next = panel.nextSibling;
  panel.remove(); parent.insertBefore(panel, next);
  return replay();
}
Object.assign(window, {__buildingAuthority: {
  retain, transition, replay, detachEditor, detachPanel,
  snapshot: () => ({scenario, initialState, state: serializeState(state), actions, observations, submissions,
    reviewHidden: root.querySelector<HTMLElement>("#building-template-review-panel")!.hidden,
    applyHidden: root.querySelector<HTMLElement>("#building-template-apply")!.hidden,
    confirmDisabled: root.querySelector<HTMLButtonElement>("#building-template-confirm-apply")!.disabled}),
}});
