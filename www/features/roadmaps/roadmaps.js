// Connecting the roadmaps to the Countries tab: the list of countries, each roadmap with its station
// line, the information panel, ticks and "My list", and the links to and from the Plan tab and the
// Toolkit guides
import { dayFromParts, readDate, today as phoneToday } from "../../app/dates.js";
import { createFacts } from "../../app/facts.js";
import { ms, reducedMotion } from "../../app/motion.js";
import { readData, writeData } from "../../app/native.js";
import { concealClose, followersOf, revealOpen, shownPart } from "../../app/reveal.js";
import { openSheet } from "../../app/sheet.js";
import { renderFactList } from "../timeline/route.js";
import { intakeName } from "../timeline/words.js";
import { resolve } from "./inserts.js";
import { countryListHtml, listDetails, listLabel, roadmapHtml, sectionBody, sectionBodyHtml } from "./render.js";

const checksKey = (code) => `roadmap.checks.${code}`;
const listKey = (code) => `roadmap.list.${code}`;
// Showing the year section for students whose HSC is over until the July after it, the last intake
// they can still be planning for
const SAT_SHOWN_UNTIL_MONTH = 7;
// Treating a section as the one in view once its top passes this share of the screen's height
const IN_VIEW_SHARE = 0.3;
// Moving the station line this share of the remaining distance every 1/120 of a second, so it follows
// the page smoothly, at the same pace on any screen, and turns at once when the page changes direction
const FOLLOW_SHARE = 0.18;
const FOLLOW_FRAME = 1000 / 120;
// Counting no more than this many milliseconds between two frames, so a pause cannot make the line leap
const FOLLOW_MAX_GAP = 50;

let screen = null;
let root = null;
let hooks = { getPlan: () => null, makePlan: () => { }, openPlan: () => { }, openPlanStep: () => { }, showCountries: () => { }, openGuide: () => { } };
const data = { index: null, bd: null, roadmaps: new Map() };
const state = { view: "list", code: null, open: new Set(), current: null, answers: {}, checks: new Set(), list: new Set(), listOpen: new Set(), today: null, seen: null };
let watching = null;
let held = false;
let following = 0;
let saving = Promise.resolve();

async function fetchJson(path) {
  const response = await fetch(`data/${path}`);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function country(code) {
  if (!data.roadmaps.has(code)) {
    const [roadmap, facts] = await Promise.all([fetchJson(`countries/${code}/roadmap.json`), fetchJson(`countries/${code}/facts.json`)]);
    if (roadmap.format !== 1) {
      throw new Error(`Roadmap ${code} has format ${roadmap.format}`);
    }
    data.roadmaps.set(code, { roadmap, facts: createFacts({ bd: data.bd, [code]: facts }) });
  }
  return data.roadmaps.get(code);
}

function info(code) {
  return data.index.countries.find((item) => item.code === code);
}

// Finding the first HSC whose exams are still ahead, as the Plan tab's questions do
export function firstHscYear(facts, today) {
  const record = facts.fact("bd/hsc.exams");
  const ahead = record.values.find((entry) => readDate(entry.value.to).last >= today);
  return ahead ? Number(ahead.key) : Number(record.values[record.values.length - 1].key) + 1;
}

// Choosing the years the year sections are written for: the plan's HSC year, or the next HSC
function years(facts, plan) {
  const next = firstHscYear(facts, state.today);
  const own = plan?.answers?.school?.system === "hsc" ? plan.answers.school.year : null;
  const sit = own !== null && own >= next ? own : next;
  const finished = next - 1;
  const stillStarting = state.today < dayFromParts(next, SAT_SHOWN_UNTIL_MONTH, 1);
  const sat = (own === null || own === finished) && stillStarting ? finished : null;
  return { sit, sat };
}

function planFor(code) {
  const plan = hooks.getPlan();
  return plan && plan.code === code && plan.result?.status === "ok" ? plan : null;
}

function renderCtx(code, facts, roadmap) {
  const plan = planFor(code);
  return {
    facts, today: state.today, cycle: roadmap.cycle, years: years(facts, plan), plan, code,
    answers: state.answers, checks: state.checks, list: state.list, listOpen: state.listOpen, tableMarks: [],
  };
}

// Hiding the tab's own title inside a roadmap, whose head already names the country
function setView(view) {
  state.view = view;
  screen.classList.toggle("is-detail", view === "roadmap");
}

async function renderList() {
  const plan = hooks.getPlan();
  const words = plan?.result?.status === "ok" ? intakeName(plan.code, plan.result.month ? { month: plan.result.month } : { cycle: plan.result.cycle }) : "";
  root.innerHTML = countryListHtml(data.index.countries, plan?.result?.status === "ok" ? plan.code : null, words);
  stopWatching();
}

async function renderRoadmap() {
  const { roadmap, facts } = await country(state.code);
  root.innerHTML = roadmapHtml(roadmap, renderCtx(state.code, facts, roadmap), info(state.code), state.open, state.current);
  placeHere(state.current, false);
  centreStation(state.current, false);
  watchSections();
}

// Redrawing one section in place after an answer, a tick or a pick, so the page never jumps
async function renderSection(id) {
  const { roadmap, facts } = await country(state.code);
  const section = roadmap.sections.find((item) => item.id === id);
  const element = root.querySelector(`.roadmap-section[data-section="${CSS.escape(id)}"] .roadmap-section-body:not([data-leaving])`);
  if (section && element) {
    element.innerHTML = sectionBody(section, renderCtx(state.code, facts, roadmap), roadmap);
  }
}

async function loadSaved(code) {
  const checks = await readData(checksKey(code));
  const list = await readData(listKey(code));
  state.checks = new Set(Array.isArray(checks) ? checks.filter((item) => typeof item === "string") : []);
  state.list = new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
}

// Saving in the background, one write after another, so the screen answers a tap at once and a quick
// second tap can never be overtaken by the first one's save
function queueSave(key, set) {
  saving = saving.then(() => writeData(key, [...set])).catch((error) => console.warn("Could not save", key, error));
}

export async function openRoadmap(code, sectionId = null) {
  hooks.showCountries();
  if (state.code !== code) {
    state.code = code;
    state.answers = {};
    state.listOpen = new Set();
    state.open = new Set([data.roadmaps.get(code)?.roadmap.sections[0].id ?? "at-a-glance"]);
    await loadSaved(code);
  }
  const { roadmap } = await country(code);
  setView("roadmap");
  const first = roadmap.sections[0].id;
  state.open.add(sectionId ?? first);
  state.current = sectionId ?? first;
  held = false;
  await renderRoadmap();
  if (sectionId) {
    scrollToSection(sectionId, false);
  } else {
    screen.scrollTo({ top: 0 });
    root.querySelector("#roadmap-title")?.focus({ preventScroll: true });
  }
}

// Scrolling to a section. "You are here" goes straight to the chosen section and stays there, while
// the page glides and after it stops, until the student scrolls the page themselves. A section near
// the end may not reach the top of the screen, so the scroll alone could point at another one
function scrollToSection(id, smooth = true) {
  const element = root.querySelector(`#roadmap-${CSS.escape(id)}`);
  if (!element) {
    return;
  }
  held = true;
  const behavior = smooth && !reducedMotion() ? "smooth" : "auto";
  element.scrollIntoView({ block: "start", behavior });
  element.querySelector(".roadmap-toggle")?.focus({ preventScroll: true });
}

// Letting the scroll move "you are here" again once the student touches or scrolls the page
function releaseHold() {
  held = false;
}

// Choosing the section in view: the last one whose top has passed a line across the screen. Near the
// end of the page the line moves down to the bottom of the screen, so short last sections such as
// Sources each get their turn in order instead of the ring leaping to the last one
function sectionInView() {
  const sections = [...root.querySelectorAll(".roadmap-section")];
  const box = screen.getBoundingClientRect();
  const remaining = screen.scrollHeight - screen.scrollTop - screen.clientHeight;
  const limit = box.height * IN_VIEW_SHARE;
  const line = box.top + limit + Math.max(0, box.height - limit - remaining);
  return sections.filter((section) => section.getBoundingClientRect().top <= line).pop() ?? sections[0];
}

// Keeping "you are here" on the station of the section in view while the student scrolls. The work
// is done once per frame, however many scroll events arrive
function watchSections() {
  stopWatching();
  let queued = false;
  const update = () => {
    queued = false;
    if (held) {
      return;
    }
    const id = sectionInView()?.dataset.section;
    if (id && id !== state.current) {
      state.current = id;
      moveStation(id);
    }
  };
  const onScroll = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  screen.addEventListener("scroll", onScroll, { passive: true });
  watching = onScroll;
}

function stopWatching() {
  if (watching) {
    screen.removeEventListener("scroll", watching);
    watching = null;
  }
}

function moveStation(id) {
  for (const station of root.querySelectorAll(".roadmap-station")) {
    const button = station.querySelector("button");
    const here = button.dataset.section === id;
    station.classList.toggle("is-here", here);
    if (here) {
      button.setAttribute("aria-current", "location");
    } else {
      button.removeAttribute("aria-current");
    }
  }
  placeHere(id, true);
  centreStation(id, true);
}

function stationOf(id) {
  return root.querySelector(`.roadmap-station button[data-section="${CSS.escape(id ?? "")}"]`)?.parentElement ?? null;
}

// Sliding the "you are here" ring along the line to a station; CSS gives the slide its timing
function placeHere(id, animate) {
  const station = stationOf(id);
  const ring = root.querySelector(".roadmap-here");
  if (!station || !ring) {
    return;
  }
  ring.classList.toggle("is-instant", !animate || reducedMotion());
  ring.style.transform = `translateX(${station.offsetLeft + station.offsetWidth / 2}px)`;
}

// Scrolling the station line sideways so the station in view sits in its middle. While the page keeps
// moving, the line keeps following the newest target instead of starting a new scroll each time
function centreStation(id, smooth) {
  const station = stationOf(id);
  const line = station?.closest("ol");
  if (!line) {
    return;
  }
  const target = Math.max(0, Math.min(line.scrollWidth - line.clientWidth, station.offsetLeft - line.clientWidth / 2 + station.offsetWidth / 2));
  cancelAnimationFrame(following);
  if (!smooth || reducedMotion()) {
    line.scrollLeft = target;
    return;
  }
  let last = performance.now();
  const step = (now) => {
    const share = 1 - (1 - FOLLOW_SHARE) ** (Math.min(FOLLOW_MAX_GAP, Math.max(0, now - last)) / FOLLOW_FRAME);
    last = now;
    const left = line.scrollLeft;
    const gap = target - left;
    if (Math.abs(gap) < 1) {
      line.scrollLeft = target;
      return;
    }
    line.scrollLeft = left + gap * share;
    following = requestAnimationFrame(step);
  };
  following = requestAnimationFrame(step);
}

// Opening or closing a section in place, as a step opens on the Plan tab: the arrow turns, the number
// fills, the content is uncovered from the top down and the sections below glide with it
async function toggleSection(id) {
  const { roadmap, facts } = await country(state.code);
  const opening = !state.open.has(id);
  const element = root.querySelector(`#roadmap-${CSS.escape(id)}`);
  const section = roadmap.sections.find((item) => item.id === id);
  if (!element || !section) {
    return;
  }
  const followers = followersOf(element, root);
  const toggle = element.querySelector(".roadmap-toggle");
  element.classList.toggle("is-open", opening);
  toggle.setAttribute("aria-expanded", String(opening));
  if (opening) {
    state.open.add(id);
    element.insertAdjacentHTML("beforeend", sectionBodyHtml(section, renderCtx(state.code, facts, roadmap), roadmap));
    revealOpen(element.lastElementChild, followers);
  } else {
    state.open.delete(id);
    concealClose(shownPart(element, ".roadmap-section-body"), followers);
  }
  toggle.focus({ preventScroll: true });
}

async function jump(id) {
  if (!state.open.has(id)) {
    await toggleSection(id);
  }
  state.current = id;
  moveStation(id);
  scrollToSection(id);
}

// Choosing which value of a dated fact the panel shows: the roadmap's intake year, or the latest
function keyFor(facts, ref, cycle) {
  const record = facts.fact(ref);
  if (!record.values) {
    return null;
  }
  if (record.keyedBy === "cycle") {
    return String(cycle);
  }
  if (record.keyedBy === "hscYear") {
    return String(cycle - 1);
  }
  return record.values.reduce((best, item) => (item.key > best.key ? item : best)).key;
}

// Listing facts in the information panel, each with its value where it can be written as words
export function showFactPanel(refs, facts, today, cycle) {
  const items = refs.filter((ref) => facts.has(ref)).map((ref) => {
    let words;
    try {
      words = resolve("fact", ref, { facts, today, cycle });
    } catch {
      words = null;
    }
    return { ref, key: keyFor(facts, ref, cycle), words };
  });
  document.getElementById("facts-body").innerHTML = renderFactList(items, facts, today);
  openSheet("facts-sheet");
}

// Showing every add button for a university in its new state at once, without redrawing the page
function markListButtons(key, inList) {
  for (const button of root.querySelectorAll(`.roadmap-add[data-key="${CSS.escape(key)}"]`)) {
    button.setAttribute("aria-pressed", String(inList));
    button.setAttribute("aria-label", listLabel(inList, button.dataset.name ?? ""));
    button.querySelector("use")?.setAttribute("href", `icons/sprite.svg#${inList ? "tick" : "plus"}`);
  }
}

// Redrawing only the open sections that hold "My list", since every other section shows the change
// through its buttons alone. The redraw waits until the tap's own motion has finished, and several
// quick taps cost one redraw
let listTimer = 0;

function scheduleMyLists() {
  window.clearTimeout(listTimer);
  listTimer = window.setTimeout(() => {
    renderMyLists().catch(reportError);
  }, reducedMotion() ? 0 : ms("--dur-expand"));
}

async function renderMyLists() {
  const { roadmap } = await country(state.code);
  for (const section of roadmap.sections) {
    if (state.open.has(section.id) && section.blocks.some((block) => block.type === "widget" && block.id === "myList")) {
      await renderSection(section.id);
    }
  }
}

// Opening or closing one card on "My list", the way a section opens
async function toggleCard(trigger) {
  const { roadmap, facts } = await country(state.code);
  const key = trigger.dataset.key;
  const card = trigger.closest(".mylist-card");
  const opening = !state.listOpen.has(key);
  const followers = followersOf(card, root);
  card.classList.toggle("is-open", opening);
  trigger.setAttribute("aria-expanded", String(opening));
  if (opening) {
    state.listOpen.add(key);
    card.insertAdjacentHTML("beforeend", listDetails(key, renderCtx(state.code, facts, roadmap), roadmap));
    revealOpen(card.lastElementChild, followers);
  } else {
    state.listOpen.delete(key);
    concealClose(shownPart(card, ".mylist-details"), followers);
  }
}

async function onClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }
  const { action } = trigger.dataset;
  const sectionId = trigger.closest(".roadmap-section")?.dataset.section;
  switch (action) {
    case "roadmap-open":
      await openRoadmap(trigger.dataset.country);
      break;
    case "roadmap-back":
      await showList();
      break;
    case "roadmap-toggle":
      await toggleSection(trigger.dataset.section);
      break;
    case "roadmap-jump":
      await jump(trigger.dataset.section);
      break;
    case "roadmap-facts": {
      const { roadmap, facts } = await country(state.code);
      showFactPanel(trigger.dataset.facts.split(" "), facts, state.today, roadmap.cycle);
      break;
    }
    case "roadmap-answer": {
      const widget = trigger.dataset.widget;
      const answers = { ...(state.answers[widget] ?? {}) };
      answers[trigger.dataset.question] = answers[trigger.dataset.question] === trigger.dataset.value ? undefined : trigger.dataset.value;
      state.answers[widget] = answers;
      await renderSection(sectionId);
      root.querySelector(`[data-action="roadmap-answer"][data-widget="${CSS.escape(widget)}"][data-question="${CSS.escape(trigger.dataset.question)}"][data-value="${CSS.escape(trigger.dataset.value)}"]`)?.focus({ preventScroll: true });
      break;
    }
    case "roadmap-pick": {
      const widget = trigger.dataset.widget;
      const index = Number(trigger.dataset.index);
      const picked = new Set(state.answers[widget]?.picked ?? []);
      if (trigger.dataset.single) {
        const was = picked.has(index);
        picked.clear();
        if (!was) {
          picked.add(index);
        }
      } else if (picked.has(index)) {
        picked.delete(index);
      } else {
        picked.add(index);
      }
      state.answers[widget] = { picked: [...picked] };
      await renderSection(sectionId);
      root.querySelector(`[data-action="roadmap-pick"][data-widget="${CSS.escape(widget)}"][data-index="${index}"]`)?.focus({ preventScroll: true });
      break;
    }
    case "roadmap-check": {
      const key = trigger.dataset.key;
      if (trigger.checked) {
        state.checks.add(key);
      } else {
        state.checks.delete(key);
      }
      queueSave(checksKey(state.code), state.checks);
      break;
    }
    case "roadmap-list": {
      const key = trigger.dataset.key;
      const inList = !state.list.has(key);
      if (inList) {
        state.list.add(key);
      } else {
        state.list.delete(key);
      }
      markListButtons(key, inList);
      queueSave(listKey(state.code), state.list);
      // Letting a card taken off "My list" leave at once, with the cards below rising into its place
      const card = trigger.closest(".mylist-card");
      if (card && !inList) {
        state.listOpen.delete(key);
        concealClose(card, followersOf(card, root));
      }
      scheduleMyLists();
      break;
    }
    case "mylist-toggle":
      await toggleCard(trigger);
      break;
    case "roadmap-make-plan":
      if (planFor(state.code)) {
        hooks.openPlan(state.code);
      } else {
        hooks.makePlan(state.code);
      }
      break;
    case "roadmap-open-step":
      hooks.openPlanStep(state.code, trigger.dataset.step);
      break;
    case "roadmap-link":
      await hooks.openGuide(trigger.dataset.link);
      break;
    default:
      break;
  }
}

async function showList() {
  setView("list");
  await renderList();
  screen.scrollTo({ top: 0 });
  root.querySelector(`[data-country="${CSS.escape(state.code ?? "")}"]`)?.focus({ preventScroll: true });
}

// Handling Android's back gesture: from a roadmap back to the list of countries
export function handleRoadmapBack() {
  if (state.view === "roadmap") {
    showList();
    return true;
  }
  return false;
}

// Drawing the Countries tab again when it is opened, so a plan made meanwhile shows on it. Nothing
// is redrawn when neither the plan nor the day has changed, so the page stays exactly where it was
export async function refreshRoadmaps() {
  const seen = `${hooks.getPlan()?.version ?? 0} ${phoneToday()}`;
  if (seen === state.seen) {
    return;
  }
  state.seen = seen;
  state.today = phoneToday();
  if (state.view === "roadmap") {
    await renderRoadmap();
  } else {
    await renderList();
  }
}

export async function initRoadmaps(options) {
  hooks = { ...hooks, ...options };
  screen = document.getElementById("screen-countries");
  root = document.getElementById("countries-root");
  state.today = phoneToday();
  screen.addEventListener("click", (event) => {
    onClick(event).catch(reportError);
  });
  for (const type of ["touchstart", "wheel", "keydown"]) {
    screen.addEventListener(type, releaseHold, { passive: true });
  }
  try {
    [data.index, data.bd] = await Promise.all([fetchJson("countries/index.json"), fetchJson("common/bd.json")]);
    await renderList();
  } catch (error) {
    reportError(error);
  }
}

function reportError(error) {
  console.error("The roadmaps stopped", error);
  setView("list");
  root.innerHTML = `<section class="message-card"><h3>Pathway could not read its roadmaps</h3><p class="reading">Close Pathway and open it again. If this keeps happening, reinstall the app.</p></section>`;
}
