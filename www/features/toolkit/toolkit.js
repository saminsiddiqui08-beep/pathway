// Connecting the Toolkit tab: its main sections, each opening to the tools and guides inside it. A
// guide is drawn from its content data with the same parts as a roadmap section; a tool is its own
// module, loaded only when it is first opened, so the app starts no slower for having many tools.
// A guide or a tool can be opened from a roadmap, another guide or another tool
import { today as phoneToday } from "../../app/dates.js";
import { createFacts } from "../../app/facts.js";
import { readData, readSetting, writeData, writeSetting } from "../../app/native.js";
import { concealClose, followersOf, revealOpen, shownPart } from "../../app/reveal.js";
import { firstHscYear, showFactPanel } from "../roadmaps/roadmaps.js";
import { foldBodyHtml, sectionBody } from "../roadmaps/render.js";
import { esc } from "../timeline/words.js";

const checksKey = (id) => `guide.checks.${id}`;
const fieldKey = (id) => `guide.field.${id}`;
// Numbering the stops of the profile guide's timeline: class 9 and 10, class 11, class 12, a gap year
const STOP_CLASS_9_10 = 0;
const STOP_CLASS_11 = 1;
const STOP_CLASS_12 = 2;
const STOP_GAP_YEAR = 3;
// Showing a tool's facts for the intake year the roadmaps are written for
const TOOL_CYCLE = 2027;

// Loading each tool's code only when the student first opens it
const TOOLS = {
  grades: () => import("../grades/grades.js"),
  english: () => import("../english/english.js"),
  deadline: () => import("../deadline/deadline.js"),
  words: () => import("../words/words.js"),
  money: () => import("../money/money.js"),
  visa: () => import("../visa/visa.js"),
};

let screen = null;
let root = null;
let hooks = { getPlan: () => null, showToolkit: () => { }, openRoadmap: () => { } };
const data = { index: null, docs: {}, guides: new Map(), all: null, countries: null };
const state = { view: "list", id: null, sections: new Set(), answers: {}, checks: new Set(), folds: new Set(), today: null, seen: null };
let tool = null;
let saving = Promise.resolve();

function icon(name, extra = "") {
  return `<svg class="icon${extra}" aria-hidden="true"><use href="icons/sprite.svg#${name}"></use></svg>`;
}

async function fetchJson(path) {
  const response = await fetch(`data/${path}`);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function factsDoc(code) {
  data.docs[code] ??= await fetchJson(code === "bd" ? "common/bd.json" : `countries/${code}/facts.json`);
  return data.docs[code];
}

async function countries() {
  data.countries ??= (await fetchJson("countries/index.json")).countries;
  return data.countries;
}

// Reading every facts file once, for the tools, which draw on every country at once
async function allFacts() {
  if (!data.all) {
    const codes = ["bd", ...(await countries()).map((item) => item.code)];
    const docs = Object.fromEntries(await Promise.all(codes.map(async (code) => [code, await factsDoc(code)])));
    data.all = createFacts(docs);
  }
  return data.all;
}

async function guide(id) {
  if (!data.guides.has(id)) {
    const doc = await fetchJson(`guides/${id}.json`);
    if (doc.format !== 1) {
      throw new Error(`Guide ${id} has format ${doc.format}`);
    }
    const docs = Object.fromEntries(await Promise.all(doc.facts.map(async (code) => [code, await factsDoc(code)])));
    data.guides.set(id, { doc, facts: createFacts(docs) });
  }
  return data.guides.get(id);
}

function entryOf(id) {
  for (const section of data.index.sections) {
    const found = section.guides.find((item) => item.id === id);
    if (found) {
      return found;
    }
  }
  return null;
}

function setView(view) {
  state.view = view;
  screen.classList.toggle("is-detail", view !== "list");
}

// Marking the stop of the student's current class in the profile guide's timeline
function classStation(facts) {
  const school = hooks.getPlan()?.answers?.school;
  if (school?.system !== "hsc") {
    return null;
  }
  const next = firstHscYear(facts, state.today);
  if (school.year < next) {
    return STOP_GAP_YEAR;
  }
  const ahead = school.year - next;
  return ahead === 0 ? STOP_CLASS_12 : ahead === 1 ? STOP_CLASS_11 : STOP_CLASS_9_10;
}

function toolRows(section) {
  return `<ul class="tool-list">${section.guides.map((item) => `<li><button class="tool-row" type="button" data-action="guide-open" data-guide="${esc(item.id)}">
      <span class="tool-text"><span class="tool-title">${esc(item.title)}</span><span class="tool-summary">${esc(item.summary)}</span></span>
      ${icon("chevron", " is-soft")}
    </button></li>`).join("")}</ul>`;
}

// Drawing the Toolkit's main sections, each a station that opens to the tools and guides inside it,
// so the tab stays short and tidy however many tools it holds
function renderList() {
  root.innerHTML = `<p class="lead">Guides and tools for every country, to use alongside each roadmap.</p>
    <div class="tool-sections">${data.index.sections.map((section) => {
    const open = state.sections.has(section.id);
    return `<section class="tool-section${open ? " is-open" : ""}" data-section="${esc(section.id)}" aria-labelledby="tool-title-${esc(section.id)}">
      <h3 class="tool-section-head"><button class="tool-toggle" type="button" data-action="tool-toggle" data-section="${esc(section.id)}" aria-expanded="${open}" id="tool-title-${esc(section.id)}">
        <span class="tool-stop" aria-hidden="true"></span>
        <span class="tool-text"><span class="tool-section-title">${esc(section.title)}</span><span class="tool-summary">${esc(section.summary)}</span></span>
        ${icon("chevron", " tool-chevron")}
      </button></h3>
      ${open ? toolRows(section) : ""}
    </section>`;
  }).join("")}</div>`;
}

// Opening or closing a main section, the way a roadmap section opens
function toggleToolSection(id) {
  const element = root.querySelector(`.tool-section[data-section="${CSS.escape(id)}"]`);
  const section = data.index.sections.find((item) => item.id === id);
  if (!element || !section) {
    return;
  }
  const opening = !state.sections.has(id);
  const followers = followersOf(element, root);
  const toggle = element.querySelector(".tool-toggle");
  element.classList.toggle("is-open", opening);
  toggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    state.sections.add(id);
    element.insertAdjacentHTML("beforeend", toolRows(section));
    revealOpen(element.lastElementChild, followers);
  } else {
    state.sections.delete(id);
    concealClose(shownPart(element, ".tool-list"), followers);
  }
}

function guideCtx(doc, facts) {
  return {
    facts, today: state.today, cycle: doc.cycle, years: { sit: null, sat: null }, plan: null, code: null,
    answers: state.answers, checks: state.checks, folds: state.folds, list: new Set(), tableMarks: [], stationHere: classStation(facts),
  };
}

function bodyHtml(doc, facts) {
  return sectionBody({ id: doc.guide, blocks: doc.blocks }, guideCtx(doc, facts), { sections: [] });
}

function headHtml(title) {
  return `<div class="roadmap-head">
      <button class="icon-button back-button" type="button" data-action="guide-back" aria-label="All tools">${icon("back")}</button>
      <h2 class="guide-title" id="guide-title" tabindex="-1">${esc(title)}</h2>
    </div>`;
}

async function renderGuide() {
  const { doc, facts } = await guide(state.id);
  root.innerHTML = `<div class="guide">${headHtml(doc.title)}<div class="guide-body" id="guide-body">${bodyHtml(doc, facts)}</div></div>`;
}

// Redrawing the guide's content after a pick, leaving its head and the page's place alone
async function renderBody() {
  const { doc, facts } = await guide(state.id);
  const body = root.querySelector("#guide-body");
  if (body) {
    body.innerHTML = bodyHtml(doc, facts);
  }
}

// Opening or closing one folded part of a guide in place, as a roadmap section opens
async function toggleFold(id) {
  const { doc, facts } = await guide(state.id);
  const element = root.querySelector(`.guide-fold[data-fold="${CSS.escape(id)}"]`);
  const block = doc.blocks[Number(id.slice(id.lastIndexOf("-") + 1))];
  if (!element || block?.type !== "fold") {
    return;
  }
  const opening = !state.folds.has(id);
  const followers = followersOf(element, root);
  element.classList.toggle("is-open", opening);
  element.querySelector(".guide-fold-toggle").setAttribute("aria-expanded", String(opening));
  if (opening) {
    state.folds.add(id);
    element.insertAdjacentHTML("beforeend", foldBodyHtml(block, guideCtx(doc, facts), { sections: [] }, id));
    revealOpen(element.lastElementChild, followers);
  } else {
    state.folds.delete(id);
    concealClose(shownPart(element, ".guide-fold-body"), followers);
  }
}

async function loadGuideState(id, doc) {
  const checks = await readData(checksKey(id));
  state.checks = new Set(Array.isArray(checks) ? checks.filter((item) => typeof item === "string") : []);
  state.answers = {};
  state.folds = new Set();
  const picker = doc.blocks.find((block) => block.type === "widget" && block.id === "fieldPicker");
  const field = picker ? await readSetting(fieldKey(id)) : null;
  if (picker && picker.fields.some((item) => item.id === field)) {
    state.answers[`${id}:field`] = { value: field };
  }
}

function queueSave(write) {
  saving = saving.then(write).catch((error) => console.warn("Could not save a Toolkit choice", error));
}

// Giving a tool what it may use from the rest of the app, and nothing more
const host = {
  today: () => state.today,
  plan: () => hooks.getPlan(),
  facts: allFacts,
  countries,
  fetchJson,
  readData,
  save: (key, value) => queueSave(() => writeData(key, value)),
  showFacts: async (refs) => showFactPanel(refs, await allFacts(), state.today, TOOL_CYCLE),
  openEntry: (id) => openGuide(id),
  openRoadmap: (code, section) => hooks.openRoadmap(code, section),
};

async function openTool(id, item) {
  const module = await TOOLS[id]();
  root.innerHTML = `<div class="guide tool" data-tool="${esc(id)}">${headHtml(item.title)}<div class="tool-body" id="tool-body"></div></div>`;
  tool = await module.createTool(host);
  await tool.mount(root.querySelector("#tool-body"));
}

function leaveTool() {
  tool?.leave?.();
  tool = null;
}

// Opening a guide or a tool, from the Toolkit list, a roadmap, a guide or another tool
export async function openGuide(id) {
  hooks.showToolkit();
  const item = entryOf(id);
  if (!item) {
    return;
  }
  leaveTool();
  if (item.kind === "tool") {
    state.id = id;
    setView("tool");
    await openTool(id, item);
  } else {
    const { doc } = await guide(id);
    if (state.id !== id || state.view === "tool") {
      state.id = id;
      await loadGuideState(id, doc);
    }
    setView("guide");
    await renderGuide();
  }
  screen.scrollTo({ top: 0 });
  root.querySelector("#guide-title")?.focus({ preventScroll: true });
}

async function showList() {
  const from = state.id;
  leaveTool();
  const holder = data.index.sections.find((section) => section.guides.some((item) => item.id === from));
  if (holder) {
    state.sections.add(holder.id);
  }
  setView("list");
  renderList();
  screen.scrollTo({ top: 0 });
  root.querySelector(`[data-guide="${CSS.escape(from ?? "")}"]`)?.focus({ preventScroll: true });
}

async function onGuideClick(action, trigger) {
  switch (action) {
    case "roadmap-link":
      await openGuide(trigger.dataset.link);
      break;
    case "roadmap-facts": {
      const { doc, facts } = await guide(state.id);
      showFactPanel(trigger.dataset.facts.split(" "), facts, state.today, doc.cycle);
      break;
    }
    case "guide-fold":
      await toggleFold(trigger.dataset.fold);
      break;
    case "roadmap-check": {
      const key = trigger.dataset.key;
      if (trigger.checked) {
        state.checks.add(key);
      } else {
        state.checks.delete(key);
      }
      const id = state.id;
      const checks = [...state.checks];
      queueSave(() => writeData(checksKey(id), checks));
      break;
    }
    case "guide-field":
    case "guide-filter": {
      const widget = trigger.dataset.widget;
      const value = trigger.dataset.value;
      // Tapping the chosen subject again folds it away; a filter always keeps one choice
      const next = action === "guide-field" && state.answers[widget]?.value === value ? null : value;
      state.answers[widget] = { value: next };
      if (action === "guide-field") {
        const id = state.id;
        queueSave(() => writeSetting(fieldKey(id), next ?? ""));
      }
      await renderBody();
      root.querySelector(`[data-action="${action}"][data-widget="${CSS.escape(widget)}"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
      break;
    }
    default:
      break;
  }
}

async function onClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }
  const { action } = trigger.dataset;
  switch (action) {
    case "guide-open":
      await openGuide(trigger.dataset.guide);
      break;
    case "guide-back":
      await showList();
      break;
    case "tool-toggle":
      toggleToolSection(trigger.dataset.section);
      break;
    default:
      if (state.view === "tool" && tool) {
        await tool.click(trigger, event);
      } else if (state.view === "guide") {
        await onGuideClick(action, trigger);
      }
      break;
  }
}

// Handing typing and changed fields to the open tool, which updates its answer as the student types
function onInput(event) {
  if (state.view === "tool" && tool?.input) {
    Promise.resolve(tool.input(event)).catch(reportError);
  }
}

// Handling Android's back gesture: from a guide or a tool back to the list of tools
export function handleToolkitBack() {
  if (state.view !== "list") {
    showList();
    return true;
  }
  return false;
}

// Drawing the open guide or tool again when the plan or the day changes, so both follow the plan
export async function refreshToolkit() {
  const seen = `${hooks.getPlan()?.version ?? 0} ${phoneToday()}`;
  if (seen === state.seen) {
    return;
  }
  state.seen = seen;
  state.today = phoneToday();
  if (state.view === "guide") {
    await renderBody();
  } else if (state.view === "tool") {
    await tool?.refresh?.();
  }
}

export async function initToolkit(options) {
  hooks = { ...hooks, ...options };
  screen = document.getElementById("screen-toolkit");
  root = document.getElementById("toolkit-root");
  state.today = phoneToday();
  screen.addEventListener("click", (event) => {
    onClick(event).catch(reportError);
  });
  screen.addEventListener("input", onInput);
  screen.addEventListener("change", onInput);
  try {
    data.index = await fetchJson("guides/index.json");
    if (data.index.format !== 1) {
      throw new Error(`The guide list has format ${data.index.format}`);
    }
    // Starting with every main section closed, so the Toolkit opens on a short, clean list
    renderList();
  } catch (error) {
    reportError(error);
  }
}

function reportError(error) {
  console.error("The Toolkit stopped", error);
  leaveTool();
  setView("list");
  root.innerHTML = `<section class="message-card"><h3>Pathway could not read its guides</h3><p class="reading">Close Pathway and open it again. If this keeps happening, reinstall the app.</p></section>`;
}
