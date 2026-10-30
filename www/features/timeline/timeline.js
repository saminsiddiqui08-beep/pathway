// Connecting the planner to the Plan tab: loading the rules and facts, keeping answers and ticks,
// choosing what to show, and answering every tap. The plan itself is never saved; it is rebuilt
// from the facts, the answers and today's date every time
import { addYears, formatDay, isoDay, readDate, readDay, today as phoneToday } from "../../app/dates.js";
import { createFacts, FactsError } from "../../app/facts.js";
import { readData, readSetting, removeSetting, tapFeedback, writeData, writeSetting } from "../../app/native.js";
import { reducedMotion } from "../../app/motion.js";
import { concealClose, followersOf, revealOpen, shownPart } from "../../app/reveal.js";
import { closeSheet, isSheetOpen, onSheetClose, openSheet } from "../../app/sheet.js";
import { answerProblems, buildPlan, intakeOptions, lastIntakeDay, PlanError } from "./engine.js";
import { animateChange, animateToggle, drawLine, measure, placeLine, renderGlance, renderMessage, renderOutOfReach, renderPlanMore, renderRoute, renderSource, renderStartOver, renderStepItem } from "./route.js";
import { ALL_QUESTIONS, answered, applyInput, BOOKED_AHEAD_DAYS, intakeNote, questionsFor, renderQuestion } from "./setup.js";
import { initReminders, markAsked, recheckReminders, rememberPlan, reminderAction, remindersAsked, remindersAvailable, remindersOn, showReminders, syncReminders } from "./reminders.js";
import { esc, intakeName } from "./words.js";

const SAVED_KEY = "plan.saved";
// Setting aside saved answers that cannot be read, never deleting them, so an update can recover them
const UNREADABLE_KEY = "plan.saved.unreadable";
// Versioning the shape of the saved answers. A future update that changes it raises this number and adds a
// step to upgradeSaved, so every student's answers carry forward through every update
const SAVED_VERSION = 1;
const ticksKey = (code) => `plan.ticks.${code}`;
const ownKey = (code) => `plan.own.${code}`;
// Matching an own deadline's saved name: step, route and intake
const OWN_DEADLINE_KEY = /^[^@]+@[^@]+@[^@]+$/;
// Waiting this long after the last change before rescheduling reminders, in milliseconds
const REMINDER_SYNC_DELAY = 900;
// Letting an own deadline or start date run this many years past the start of the last intake in the
// facts, so even a class 9 student can enter one. A booked test uses the questions' own limit,
// BOOKED_AHEAD_DAYS
const OWN_AHEAD_YEARS = 1;
// Sharing these answers about the student across every country. Competitiveness, the intake, the SAT
// and the chosen route belong to each country
const COMMON_ANSWERS = ["school", "english", "aid", "passport"];

let root = null;
let screen = null;
const data = { index: null, common: null, bd: null, countries: new Map() };
const state = {
  mode: "loading",
  today: null,
  saved: null,
  ticks: {},
  own: {},
  result: null,
  openSteps: new Set(),
  drawn: false,
  setup: null,
  ownDate: null,
  pendingTick: null,
  pendingOpen: null,
  answersOpen: false,
};
let showPlanTab = () => { };
let openRoadmapAt = () => { };
// Counting rebuilt plans, so the roadmaps redraw only when the plan they show has changed
let planVersion = 0;

async function fetchJson(path) {
  const response = await fetch(`data/${path}`);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function loadCommon() {
  [data.index, data.common, data.bd] = await Promise.all([fetchJson("countries/index.json"), fetchJson("common/plan.json"), fetchJson("common/bd.json")]);
}

// Loading each country's plan, facts and roadmap once, then reusing them
async function country(code) {
  if (!data.countries.has(code)) {
    const [plan, facts, roadmap] = await Promise.all([fetchJson(`countries/${code}/plan.json`), fetchJson(`countries/${code}/facts.json`), fetchJson(`countries/${code}/roadmap.json`)]);
    data.countries.set(code, { plan, facts: createFacts({ bd: data.bd, [code]: facts }), sections: stepSections(roadmap) });
  }
  return data.countries.get(code);
}

// Finding the roadmap section each plan step reads more about: the first section that names it,
// leaving the step-by-step list, which names every step, for steps no other section names
function stepSections(roadmap) {
  const found = new Map();
  const general = [];
  for (const section of roadmap.sections ?? []) {
    for (const step of section.planSteps ?? []) {
      if (section.id === "step-by-step") {
        general.push([step, section.id]);
      } else if (!found.has(step)) {
        found.set(step, section.id);
      }
    }
  }
  for (const [step, id] of general) {
    if (!found.has(step)) {
      found.set(step, id);
    }
  }
  return found;
}

function countryInfo(code) {
  return data.index.countries.find((item) => item.code === code);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Bringing answers saved by any earlier version up to today's shape. Version 1 needs no change:
// competitiveness moved to each country in this version, and answersFor still reads the old place
function upgradeSaved(value) {
  if (!isRecord(value) || !Number.isInteger(value.version) || value.version < 1 || value.version > SAVED_VERSION) {
    return null;
  }
  if (!isRecord(value.common) || !isRecord(value.countries) || typeof value.country !== "string") {
    return null;
  }
  return value;
}

// Reading the saved answers. Returns { saved } when they can be used, { newer: true } when a newer
// version of Pathway wrote them (they are left untouched), or { saved: null } when there are none
// or they could not be read
async function readSaved() {
  const text = await readSetting(SAVED_KEY);
  if (!text) {
    return { saved: null };
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (isRecord(value) && Number.isInteger(value.version) && value.version > SAVED_VERSION) {
    return { newer: true };
  }
  const saved = upgradeSaved(value);
  if (saved && countryInfo(saved.country)) {
    return { saved };
  }
  // Keeping a copy before clearing, so nothing a student typed is ever lost for good
  console.warn("Saved answers could not be read and were set aside");
  await writeSetting(UNREADABLE_KEY, text);
  await removeSetting(SAVED_KEY);
  return { saved: null };
}

// Gathering a country's answers. Plans saved before competitiveness moved to each country keep
// their shared answer
function answersFor(saved, code = saved.country) {
  const own = saved.countries[code] ?? {};
  return { country: code, ...saved.common, tier: own.tier ?? saved.common.tier ?? null, intake: own.intake ?? null, sat: own.sat ?? null, route: own.route ?? null };
}

// Splitting the answers into those shared by every country and those kept for this one
function storeAnswers(answers) {
  const saved = state.saved ?? { version: SAVED_VERSION, country: answers.country, common: {}, countries: {} };
  saved.country = answers.country;
  for (const key of COMMON_ANSWERS) {
    if (answers[key] !== undefined && answers[key] !== null) {
      saved.common[key] = answers[key];
    }
  }
  const own = saved.countries[answers.country] ?? {};
  own.intake = answers.intake ?? own.intake ?? null;
  if (answers.sat) {
    own.sat = answers.sat;
  }
  if (answers.tier) {
    own.tier = answers.tier;
  }
  saved.countries[answers.country] = own;
  state.saved = saved;
  return writeData(SAVED_KEY, saved);
}

// Accepting only a real "YYYY-MM-DD" date, since anything else was damaged and must be dropped
function isSavedDay(text) {
  try {
    return readDate(text).precision === "day";
  } catch {
    return false;
  }
}

async function loadCountryState(code) {
  const ticks = await readData(ticksKey(code));
  const own = await readData(ownKey(code));
  state.ticks[code] = ticks && typeof ticks === "object" && !Array.isArray(ticks)
    ? Object.fromEntries(Object.entries(ticks).filter(([, day]) => isSavedDay(day)))
    : {};
  const cleanOwn = isRecord(own) ? own : {};
  // Keeping own deadlines only when named "step@route@intake", so deadlines saved by test versions
  // without an intake in their name cannot carry over. Start dates are named by their intake
  state.own[code] = {
    deadlines: Object.fromEntries(Object.entries(isRecord(cleanOwn.deadlines) ? cleanOwn.deadlines : {}).filter(([key, day]) => OWN_DEADLINE_KEY.test(key) && isSavedDay(day))),
    starts: Object.fromEntries(Object.entries(isRecord(cleanOwn.starts) ? cleanOwn.starts : {}).filter(([, day]) => isSavedDay(day))),
  };
}

// Rebuilding the plan for the chosen country and queueing a reminder update
async function build() {
  const answers = answersFor(state.saved);
  const { plan, facts } = await country(answers.country);
  if (!state.ticks[answers.country]) {
    await loadCountryState(answers.country);
  }
  const own = state.own[answers.country];
  state.result = buildPlan({
    common: data.common, plan, facts, answers, today: state.today,
    ticks: state.ticks[answers.country],
    overrides: { deadlines: own.deadlines, starts: own.starts },
  });
  scheduleReminderSync(answers.country);
  planVersion += 1;
  return state.result;
}

// Keeping reminders in step with the plan as it is now. The update waits until taps and animations
// have settled, so several quick changes cost one update and never compete with the motion on screen
let reminderTimer = 0;

function scheduleReminderSync(code) {
  window.clearTimeout(reminderTimer);
  const result = state.result;
  const today = state.today;
  rememberPlan(result, code, today);
  reminderTimer = window.setTimeout(() => {
    syncReminders(result, code, today).catch((error) => console.warn("Could not refresh reminders", error));
  }, REMINDER_SYNC_DELAY);
}

// Finding the first HSC year whose exams are still ahead, or the year after the last one listed
function firstHscYear() {
  const record = createFacts({ bd: data.bd }).fact("bd/hsc.exams");
  const ahead = record.values.find((entry) => readDate(entry.value.to).last >= state.today);
  return ahead ? Number(ahead.key) : Number(record.values[record.values.length - 1].key) + 1;
}

// Reading whether a country offers "Not needed" for English and which tests it accepts
function englishRules(code) {
  const plan = code ? data.countries.get(code)?.plan : null;
  return { englishWaiver: Boolean(plan?.englishWaiver), englishTests: plan?.englishTests ?? null };
}

function setScreenMode(mode) {
  state.mode = mode;
  screen.classList.toggle("is-setup", mode === "setup");
}

// Painting the whole Plan tab in the chosen country's colour. The colour is written only when it
// changes: writing it again, even unchanged, makes the phone restyle every element of the plan
function paintCountry(code) {
  const info = code ? countryInfo(code) : null;
  const colours = { "--route": info ? `var(${info.line})` : "var(--line)", "--route-text": info ? `var(${info.text})` : "var(--ink)" };
  for (const [name, value] of Object.entries(colours)) {
    if (root.style.getPropertyValue(name) !== value) {
      root.style.setProperty(name, value);
    }
  }
}

// Drawing the Plan tab. For a plan, returns where the route's items ended up when collect is set
function render({ animateLine = false, patch = false, collect = false, update = false } = {}) {
  paintCountry(state.mode === "setup" ? state.setup?.draft.country : state.mode === "plan" ? state.saved?.country : null);
  if (state.mode === "setup") {
    renderSetup(update);
    return null;
  }
  if (state.mode === "welcome") {
    root.innerHTML = welcomeHtml();
    return null;
  }
  if (state.mode === "error") {
    root.innerHTML = renderMessage("Pathway could not read its plan data", "Close Pathway and open it again. If this keeps happening, reinstall the app.", null);
    return null;
  }
  if (state.mode === "newer") {
    root.innerHTML = renderMessage("Your plan needs the latest Pathway", "A newer version of Pathway saved your plan on this phone. Update Pathway from the Play Store to open it. Your answers are kept safe until then.", null);
    return null;
  }
  return renderPlan(animateLine, patch, collect);
}

// Updating the plan in place: parts whose HTML is unchanged stay exactly where they are, a part
// moves only when its place changed, and only what differs is replaced. Marking a step done then
// touches a few elements instead of rebuilding the screen. Returns false when either version lacks
// one of the parts
function patchPlan(html) {
  const next = document.createElement("template");
  next.innerHTML = html;
  const parts = [".glance", ".route > .note", ".route-list", ".plan-more", ".start-over"].map((selector) => [root.querySelector(selector), next.content.querySelector(selector)]);
  if (parts.some(([before, after]) => !before || !after)) {
    return false;
  }
  for (const [before, after] of parts) {
    if (before.outerHTML === after.outerHTML) {
      continue;
    }
    if (before.matches(".glance, .route-list")) {
      patchChildren(before, after);
    } else {
      before.replaceWith(after);
    }
  }
  return true;
}

// Making a list's children match a new version, reusing every child whose HTML is unchanged.
// A reused child that is already in its place is not touched at all, so the phone does not have
// to work out its style and layout again
function patchChildren(parent, wanted) {
  const unused = new Map();
  for (const child of parent.children) {
    const html = child.outerHTML;
    unused.set(html, [...(unused.get(html) ?? []), child]);
  }
  const items = [...wanted.children].map((item) => unused.get(item.outerHTML)?.shift() ?? item);
  const staying = new Set(items);
  // Stepping over children about to be removed, so the children after them stay put
  const skipLeaving = (node) => {
    let next = node;
    while (next && !staying.has(next)) {
      next = next.nextElementSibling;
    }
    return next;
  };
  let cursor = skipLeaving(parent.firstElementChild);
  for (const item of items) {
    if (item === cursor) {
      cursor = skipLeaving(cursor.nextElementSibling);
    } else {
      parent.insertBefore(item, cursor);
    }
  }
  for (const left of unused.values()) {
    for (const child of left) {
      child.remove();
    }
  }
}

// Laying out Pathway's own map: one dark line leaves "You are here", USA and New Zealand branch first,
// then Finland and Malaysia, and Türkiye continues straight. Tapping a country's line starts its plan
const MAP_ROWS = {
  us: { y: 42, path: "M64 146 L168 42 L320 42" },
  fi: { y: 94, path: "M98 146 L150 94 L320 94" },
  tr: { y: 146, path: "M105 146 L320 146" },
  my: { y: 198, path: "M98 146 L150 198 L320 198" },
  nz: { y: 250, path: "M64 146 L168 250 L320 250" },
};

function welcomeHtml() {
  const rows = data.index.countries.filter((item) => MAP_ROWS[item.code]);
  const lines = rows.map((item) => `<path d="${MAP_ROWS[item.code].path}" style="stroke: var(${item.line})"/>`).join("");
  const stations = rows.map((item) => `<circle cx="320" cy="${MAP_ROWS[item.code].y}" r="9" style="fill: var(--paper); stroke: var(${item.line})" stroke-width="4"/><circle cx="320" cy="${MAP_ROWS[item.code].y}" r="3.5" style="fill: var(${item.line})"/>`).join("");
  const labels = rows.map((item) => `<text x="184" y="${MAP_ROWS[item.code].y - 11}" style="fill: var(${item.text})">${esc(item.name)}</text>`).join("");
  const picks = rows.map((item) => `<button class="welcome-pick" type="button" data-action="start" data-country="${item.code}" style="top: ${((MAP_ROWS[item.code].y - 26) / 266) * 100}%" aria-label="Make a plan for ${esc(item.name)}"></button>`).join("");
  return `<div class="welcome">
    <div class="welcome-map">
      <svg viewBox="0 0 350 266" role="img" aria-label="One route from you branches into five countries: ${esc(rows.map((item) => item.name).join(", "))}">
        <g fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${lines}</g>
        <path d="M28 146 L105 146" fill="none" style="stroke: var(--here-stub)" stroke-width="6"/>
        ${stations}
        <circle cx="28" cy="146" r="16" style="fill: var(--paper)"/>
        <circle cx="28" cy="146" r="10.5" style="fill: var(--paper); stroke: var(--here-ring)" stroke-width="4"/>
        <circle cx="28" cy="146" r="3.5" style="fill: var(--here-ring)"/>
        <text x="8" y="182" font-size="12" font-weight="700" style="fill: var(--here-text)">You are here</text>
        <g font-size="14" font-weight="600">${labels}</g>
      </svg>
      ${picks}
    </div>
    <p class="welcome-lead">Tell Pathway where and when you want to study. It lays out every step, month by month, working back from the real deadlines.</p>
    <p class="note">Up to eight short questions. Every date in your plan shows where it comes from, and your answers are never sent to Pathway.</p>
    <div class="setup-actions"><button class="button-primary" type="button" data-action="start">Make my plan</button></div>
  </div>`;
}

// Drawing a plan, or the message that replaces it when the clock is wrong or no intakes are left
function renderPlan(animateLine, patch = false, collect = false) {
  const result = state.result;
  const code = state.saved.country;
  const info = countryInfo(code);
  if (result.status === "clockWrong") {
    root.innerHTML = renderMessage("Your phone's date looks wrong",
      `Your phone says today is ${readableDay(state.today)}, but Pathway's dates were checked on ${readableDay(result.checked)}. Set the right date in your phone's settings, then try again.`,
      { action: "retry", label: "Try again" });
    return null;
  }
  if (result.status === "factsEnded") {
    root.innerHTML = renderMessage("No intakes left in this version", `This version of Pathway has no ${info.name} intakes left to plan. An update brings the next years' dates.`, { action: "change-country", label: "Choose another country" });
    return null;
  }
  const ctx = planCtx();
  if (result.status === "outOfReach") {
    root.innerHTML = `${headHtml(info, ctx)}${renderOutOfReach(result, ctx)}${renderStartOver()}`;
    return null;
  }
  const html = `${renderGlance(result, ctx)}${renderRoute(result, ctx)}${renderPlanMore(result, ctx)}${renderStartOver()}`;
  if (!(patch && patchPlan(html))) {
    root.innerHTML = html;
  }
  const layout = placeLine(root, { collect });
  if (animateLine && !state.drawn) {
    state.drawn = true;
    drawLine(root);
  }
  return layout;
}

// Gathering what route.js needs. A "soonest" intake answer is shown as the intake the plan settled on
function planCtx() {
  const result = state.result;
  const code = state.saved.country;
  const answers = answersFor(state.saved);
  return {
    today: state.today,
    code,
    country: countryInfo(code),
    intake: answers.intake?.soonest ? (result.month ? { month: result.month } : { cycle: result.cycle }) : answers.intake,
    answers,
    openSteps: state.openSteps,
    answersOpen: state.answersOpen,
    preferredRoute: answers.route,
    ownStart: Boolean(state.own[code]?.starts[planIntake()]),
    ownInUse: ownDatesInUse(),
    ownStartAllowed: code === "us",
    becauseText: (answer) => becauseText(answer, answers),
    reminders: remindersAvailable() ? { on: remindersOn() } : null,
    roadmapSection: (stepId) => data.countries.get(code)?.sections.get(stepId) ?? null,
  };
}

function headHtml(info, ctx) {
  return `<div class="plan-for">
    <button class="country-chip" type="button" data-action="switch-country" style="--route: var(${info.line}); --route-text: var(${info.text})" aria-label="${esc(info.name)}, switch country"><span class="chip-dot" aria-hidden="true"></span>${esc(info.name)}<svg class="icon" aria-hidden="true"><use href="icons/sprite.svg#chevron"></use></svg></button>
    <span class="plan-intake">${esc(intakeName(ctx.code, ctx.intake))}</span>
  </div>`;
}

function readableDay(day) {
  return formatDay(day);
}

// Wording "Because you said" in the student's own terms
function becauseText(answer, answers) {
  switch (answer) {
    case "english":
      return { none: "no English score yet", booked: "your English test is booked", score: "you have an English score" }[answers.english?.status] ?? null;
    case "sat":
      return { none: "you plan to sit the SAT", booked: "your SAT is booked", score: "you have an SAT score", no: "no SAT" }[answers.sat?.status] ?? null;
    case "passport":
      return { none: "no passport yet", applied: "your passport is on its way", nid: "you have a smart NID card", valid: "you have a valid passport" }[answers.passport] ?? null;
    case "tier":
      return { reach: "mostly very competitive universities", balanced: "a balanced mix of universities", safe: "mostly less competitive universities" }[answers.tier] ?? null;
    case "aid":
      return { need: "you need financial aid", help: "financial aid would help", no: "your family can pay" }[answers.aid] ?? null;
    case "system":
      return answers.school?.system === "hsc" ? `you sit the HSC in ${answers.school.year}` : `you finish A levels in ${answers.school?.year}`;
    default:
      return null;
  }
}

async function startSetup({ draft, queue, single = false, index = 0, exitTo, full = !single }) {
  state.setup = { draft, queue, single, index, exitTo, full };
  setScreenMode("setup");
  await prepareQuestion();
  render();
  focusQuestion();
}

async function prepareQuestion() {
  const setup = state.setup;
  const key = setup.queue[setup.index];
  setup.options = [];
  if (setup.draft.country) {
    const { plan, facts } = await country(setup.draft.country);
    if (setup.full) {
      // Rebuilding the question list for the country, since the SAT is asked only where it matters
      const keys = questionsFor(plan);
      setup.queue = keys;
      setup.index = Math.max(0, keys.indexOf(key));
    }
    // Offering intakes only once the school system and final year are known
    if (key === "intake" && setup.draft.school?.system && Number.isInteger(setup.draft.school.year)) {
      setup.options = intakeOptions({ common: data.common, plan, facts, answers: setup.draft, today: state.today })
        .map((option) => ({ ...option, note: intakeNote(setup.draft.country, option, state.today) }));
    }
  }
}

// Drawing the question. After an answer changes, the question already on screen is updated in
// place instead of replaced, so the chosen station grows into place and the held row's highlight
// fades out, exactly as the theme panel's choices do
function renderSetup(update = false) {
  const setup = state.setup;
  const key = setup.queue[setup.index];
  const info = setup.draft.country ? countryInfo(setup.draft.country) : null;
  const html = renderQuestion(key, setup.draft, {
    questions: setup.queue,
    index: setup.index,
    single: setup.single,
    today: state.today,
    countries: data.index.countries,
    intakeOptions: setup.options,
    firstHscYear: firstHscYear(),
    ...englishRules(setup.draft.country),
    colour: info ? `var(${info.line})` : "var(--line)",
    asksSat: Boolean(setup.draft.country && data.countries.get(setup.draft.country)?.plan.asksSat),
  });
  if (update && root.firstElementChild) {
    const next = document.createElement("template");
    next.innerHTML = html;
    morphChildren(root, next.content);
  } else {
    root.innerHTML = html;
  }
}

// Making a part of the screen match new HTML while keeping every element that can stay, so
// focus, transitions and the browser's own state carry on. Elements are matched by position
function morph(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName) {
    from.replaceWith(to);
    return;
  }
  if (from.nodeType === Node.TEXT_NODE || from.nodeType === Node.COMMENT_NODE) {
    if (from.data !== to.data) {
      from.data = to.data;
    }
    return;
  }
  // Checking fields anyway, since their live state can differ from markup that looks equal
  if (from.isEqualNode(to) && !(from instanceof HTMLInputElement)) {
    return;
  }
  for (const { name } of [...from.attributes]) {
    if (!to.hasAttribute(name)) {
      from.removeAttribute(name);
    }
  }
  for (const { name, value } of [...to.attributes]) {
    if (from.getAttribute(name) !== value) {
      from.setAttribute(name, value);
    }
  }
  // Setting a field's live state as well, because it is a property and not an attribute
  if (from instanceof HTMLInputElement) {
    if (from.type === "radio" || from.type === "checkbox") {
      from.checked = to.hasAttribute("checked");
    } else if (from.value !== (to.getAttribute("value") ?? "")) {
      from.value = to.getAttribute("value") ?? "";
    }
  }
  morphChildren(from, to);
}

function morphChildren(from, to) {
  const before = [...from.childNodes];
  const after = [...to.childNodes];
  after.forEach((node, index) => {
    if (index < before.length) {
      morph(before[index], node);
    } else {
      from.appendChild(node);
    }
  });
  for (const node of before.slice(after.length)) {
    node.remove();
  }
}

function focusQuestion() {
  screen.scrollTo({ top: 0 });
  root.querySelector("#setup-title")?.focus({ preventScroll: true });
}

async function setupNext() {
  const setup = state.setup;
  const key = setup.queue[setup.index];
  if (!answered(key, setup.draft, state.today, englishRules(setup.draft.country))) {
    return;
  }
  if (key === "start") {
    await chooseStart();
  }
  // Asking the intake again, because a new country or school year can change the intakes offered
  if ((key === "country" || key === "school") && !setup.draft.intake && setup.single && !setup.queue.includes("intake")) {
    setup.queue.push("intake");
  }
  if (setup.index < setup.queue.length - 1) {
    setup.index += 1;
    await prepareQuestion();
    render();
    focusQuestion();
    return;
  }
  await finishSetup();
}

// Following "How do you want to start your plan?": keeping the answers about the student and asking
// only what belongs to the new country, or asking every question from the beginning
async function chooseStart() {
  const setup = state.setup;
  const code = setup.draft.country;
  const { plan } = await country(code);
  // Keeping the answers as they were, so going back and choosing "Use my answers" still finds them
  setup.kept ??= structuredClone(setup.draft);
  if (setup.draft.startChoice === "fresh") {
    setup.draft = { country: code, startChoice: "fresh" };
    setup.queue = ["start", ...questionsFor(plan).filter((key) => key !== "country")];
    return;
  }
  setup.draft = { ...setup.kept, startChoice: "reuse" };
  setup.queue = reuseQueue(plan);
}

function reuseQueue(plan) {
  return ["start", "intake", ...(plan.asksSat ? ["sat"] : []), "tier"];
}

async function finishSetup() {
  const draft = state.setup.draft;
  const { plan } = await country(draft.country);
  const answers = { ...draft };
  delete answers.startChoice;
  const problems = answerProblems(answers, plan);
  if (problems.length > 0) {
    // Asking only what is still missing, keeping every good answer
    state.setup.queue = problems.filter((key) => key !== "country");
    state.setup.index = 0;
    state.setup.single = true;
    state.setup.full = false;
    await prepareQuestion();
    render();
    focusQuestion();
    return;
  }
  const newCountry = state.saved?.country !== answers.country;
  await storeAnswers(answers);
  await loadCountryState(draft.country);
  state.setup = null;
  if (newCountry) {
    state.openSteps.clear();
    state.drawn = false;
  }
  setScreenMode("plan");
  await build();
  render({ animateLine: true });
  screen.scrollTo({ top: 0 });
  // Offering reminders only once, after the first plan, when the line has drawn down to the student
  if (remindersAvailable() && !remindersAsked() && state.result.status === "ok") {
    window.setTimeout(() => {
      // Skipping the offer if the student opened a panel or moved to another screen meanwhile
      if (state.mode === "plan" && !isSheetOpen() && state.result?.status === "ok") {
        markAsked().catch((error) => console.warn("Could not save the reminders offer", error));
        showReminders(state.result, state.today);
      }
    }, 900);
  }
}

async function setupBack() {
  const setup = state.setup;
  if (setup.index > 0) {
    setup.index -= 1;
    await prepareQuestion();
    render();
    focusQuestion();
    return;
  }
  await leaveSetup();
}

async function leaveSetup() {
  const exitTo = state.setup?.exitTo ?? "welcome";
  state.setup = null;
  if (exitTo === "plan" && state.saved) {
    setScreenMode("plan");
    await build();
  } else {
    setScreenMode("welcome");
  }
  render();
  screen.scrollTo({ top: 0 });
}

async function rebuildAndRender({ patch = false, collect = false } = {}) {
  await build();
  return render({ patch, collect });
}

// Keeping the tapped step where it was on screen after a redraw. When several steps change at once,
// the plan above can grow or shrink a lot, and the screen would otherwise jump to another place.
// The measured positions are moved by the same amount, so the motion still starts from the screen
function keepInView(stepId, before, after) {
  const was = before.items.get(stepId);
  const now = after?.items.get(stepId);
  if (!was || !now) {
    return;
  }
  const scrolled = screen.scrollTop;
  screen.scrollTop = scrolled + now.top - was.top;
  const moved = screen.scrollTop - scrolled;
  if (moved === 0) {
    return;
  }
  after.mapTop -= moved;
  after.ring = after.ring === null ? null : after.ring - moved;
  for (const box of after.items.values()) {
    box.top -= moved;
    box.bottom -= moved;
  }
}

// Stopping motion still running from a quick earlier tap once the screen has been measured, so
// the next movement starts from what was on screen instead of jumping. Only what the next movement
// takes over is stopped: steps gliding in the list, the line and the ring, and everything inside a
// step being opened or closed again. Any other step keeps opening or closing on its own
function stopRouteMotion(stepId = null) {
  const map = root.querySelector(".route-map");
  if (!map) {
    return;
  }
  const ring = map.querySelector(".route-step.is-here .route-marker");
  const step = stepId ? map.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"]`) : null;
  for (const animation of map.getAnimations({ subtree: true })) {
    const target = animation.effect?.target;
    if (target?.parentElement?.classList.contains("route-list") || target?.classList.contains("route-travelled") || target === ring || step?.contains(target)) {
      animation.cancel();
    }
  }
  step?.querySelector(".step-ghost")?.remove();
}

async function tick(stepIds, done) {
  // Taking the tapped step from the end of the list; any others are the steps before it
  const stepId = stepIds[stepIds.length - 1];
  const code = state.saved.country;
  const ticks = { ...state.ticks[code] };
  for (const id of stepIds) {
    if (done) {
      ticks[id] = isoDay(state.today);
    } else {
      delete ticks[id];
    }
    state.openSteps.delete(id);
  }
  state.ticks[code] = ticks;
  // Saving alongside the redraw, so the tap is answered at once
  const saving = writeData(ticksKey(code), ticks);
  const before = measure(root);
  stopRouteMotion();
  const after = await rebuildAndRender({ patch: true, collect: true });
  keepInView(stepId, before, after);
  animateChange(root, before, after, stepIds, done);
  // Returning focus to the step's title, since the pressed button is gone and focus would fall to
  // the top of the page
  root.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"] .step-card .step-head`)?.focus({ preventScroll: true });
  if (done) {
    tapFeedback();
  }
  await saving;
}

// Collecting the earlier steps that a step waits for, directly or through others, that are not marked done:
// the student's own tasks and the things they wait for, such as results. Marking a step done
// never marks these by itself, because steps sometimes happen in a different order, such as
// applying before an English result arrives, so the student is asked
function openStepsBefore(stepId) {
  const result = state.result;
  const found = new Set();
  const queue = [...(result.deps?.[stepId] ?? [])];
  while (queue.length > 0) {
    const id = queue.pop();
    if (!found.has(id)) {
      found.add(id);
      queue.push(...(result.deps?.[id] ?? []));
    }
  }
  return result.steps.filter((step) => found.has(step.id) && !step.done);
}

// Asking, when a step is marked done before the steps it comes after, whether those are done too
function showStepsBefore(stepId, before) {
  const step = state.result.steps.find((item) => item.id === stepId);
  state.pendingTick = { stepId, before: before.map((item) => item.id) };
  const many = before.length > 1;
  document.getElementById("steps-body").innerHTML = `
    <p class="reading">\u201C${esc(step.title)}\u201D comes after ${many ? "these steps, which are" : "this step, which is"} not marked done yet:</p>
    <ul class="steps-before">${before.map((item) => `<li>${esc(item.title)}</li>`).join("")}</ul>
    <p class="note">Pathway marks ${many ? "them" : "it"} done only if you say so, because steps sometimes happen in a different order.</p>
    <button class="button-primary" type="button" data-action="tick-all">${many ? `Mark all ${before.length + 1} steps as done` : "Mark both steps as done"}</button>
    <button class="button-secondary" type="button" data-action="tick-one">Only this step</button>`;
  openSheet("steps-sheet");
}

async function tickPending(withBefore) {
  const pending = state.pendingTick;
  state.pendingTick = null;
  await closeSheet();
  if (pending && state.mode === "plan") {
    await tick(withBefore ? [...pending.before, pending.stepId] : [pending.stepId], true);
  }
}

function showSource(stepId) {
  const step = state.result?.steps.find((item) => item.id === stepId);
  if (!step) {
    return;
  }
  const facts = data.countries.get(state.saved.country).facts;
  document.getElementById("source-body").innerHTML = renderSource(step, facts, state.today);
  openSheet("source-sheet");
}

// Naming the intake on screen as own dates name it: the start month, or the intake year
function planIntake() {
  return state.result?.month ?? String(state.result?.cycle);
}

// Keeping own dates for each route and intake, because the early and regular rounds, and every
// intake, have their own deadlines. The name is fixed when the panel opens, so a redraw meanwhile
// can never save the date under another route
function ownKeyFor(stepId) {
  return `${stepId}@${state.result?.route?.id ?? "main"}@${planIntake()}`;
}

// Checking whether any own date belongs to the intake on screen, so an out-of-reach card can offer
// to drop them
function ownDatesInUse() {
  const own = state.own[state.saved.country];
  const intake = planIntake();
  return Boolean(own?.starts[intake]) || Object.keys(own?.deadlines ?? {}).some((key) => key.endsWith(`@${intake}`));
}

// Removing every own date for the intake on screen, from the out-of-reach card
async function clearOwnDates() {
  const code = state.saved.country;
  const intake = planIntake();
  const own = state.own[code];
  const next = {
    deadlines: Object.fromEntries(Object.entries(own.deadlines).filter(([key]) => !key.endsWith(`@${intake}`))),
    starts: Object.fromEntries(Object.entries(own.starts).filter(([key]) => key !== intake)),
  };
  state.own[code] = next;
  await writeData(ownKey(code), next);
  await rebuildAndRender();
  screen.scrollTo({ top: 0 });
}

// Opening or closing "What shaped this plan" in place, the way a step opens: the answers are uncovered
// from the top down while everything below glides, and closing runs the same movement backwards
function toggleAnswers() {
  const button = root.querySelector("[data-action='toggle-answers']");
  state.answersOpen = !state.answersOpen;
  if (!button) {
    render({ patch: true });
    return;
  }
  const followers = followersOf(button, root);
  const fresh = document.createElement("template");
  fresh.innerHTML = renderPlanMore(state.result, planCtx());
  button.replaceChildren(...fresh.content.querySelector("[data-action='toggle-answers']").childNodes);
  button.setAttribute("aria-expanded", String(state.answersOpen));
  if (state.answersOpen) {
    button.after(fresh.content.querySelector("#plan-answers"));
    revealOpen(button.nextElementSibling, followers);
  } else {
    concealClose(shownPart(button.parentElement, "#plan-answers"), followers);
  }
  button.focus({ preventScroll: true });
}

// Finding the latest own date the plan can use for a step. A later date is held back by the steps
// after it, so it would change nothing: the plan is built once with the furthest date allowed, and
// the step's date in that plan is as late as it can go
function latestUsefulDay(stepId, key, furthest) {
  const answers = answersFor(state.saved);
  const { plan, facts } = data.countries.get(answers.country);
  const own = state.own[answers.country];
  try {
    const trial = buildPlan({
      common: data.common, plan, facts, answers, today: state.today,
      ticks: state.ticks[answers.country],
      overrides: { deadlines: { ...own.deadlines, [key]: isoDay(furthest) }, starts: own.starts },
    });
    const day = trial.steps?.find((item) => item.id === stepId)?.date?.day;
    return Number.isFinite(day) ? Math.min(day, furthest) : furthest;
  } catch (error) {
    console.warn("Could not work out the latest own date", error);
    return furthest;
  }
}

// Opening the "own date" panel: a booked test date, a university's own deadline, or the I-20 start date
function showOwnDate(kind, stepId) {
  const step = state.result.steps.find((item) => item.id === stepId);
  const own = state.own[state.saved.country];
  const titles = {
    english: ["When is your test?", "Enter the date you booked. Your plan then counts from it."],
    sat: ["When is your SAT?", "Enter the test date you booked. Your plan then counts from it."],
    deadline: ["Your own date", "Enter the date your universities set for this step. If they set different dates, enter the earliest. Pathway then plans every step before it for your date. Steps you have marked done stay done."],
    start: ["Your start date", "Enter the program start date on your I-20. Pathway then plans for it instead of 15 August."],
  };
  const key = kind === "deadline" ? ownKeyFor(stepId) : kind === "start" ? planIntake() : null;
  const current = kind === "deadline" ? own.deadlines[key] : kind === "start" ? own.starts[key] : null;
  const booked = kind === "english" || kind === "sat";
  const earliest = state.today;
  const { plan, facts } = data.countries.get(state.saved.country);
  const furthest = booked ? state.today + BOOKED_AHEAD_DAYS : addYears(lastIntakeDay({ common: data.common, plan, facts }), OWN_AHEAD_YEARS);
  const latest = kind === "deadline" ? latestUsefulDay(stepId, key, furthest) : furthest;
  state.ownDate = { kind, stepId, key, earliest, latest };
  const [title, text] = titles[kind];
  // Saying how late an own date can be, or that no later date can be used at all for a step that has
  // run out of time, so a date that would change nothing can never be chosen
  const open = latest >= earliest;
  const limit = !open
    ? `<p class="note">Pathway cannot use a later date for this step: the steps after it already need all the time until your studies begin.</p>`
    : latest < furthest
      ? `<p class="note">The latest date Pathway can use here is ${esc(formatDay(latest))}. A later date would change nothing, because the steps after this one need the time until your studies begin.</p>`
      : "";
  document.getElementById("own-sheet-title").textContent = title;
  document.getElementById("own-body").innerHTML = `
    <p class="reading">${esc(text)}</p>
    ${step ? `<p class="note">${esc(step.title)}</p>` : ""}
    ${open ? `<label class="date-field"><span class="field-label">Date</span>
      <input type="date" id="own-date-input" value="${esc(current ?? "")}" min="${isoDay(earliest)}" max="${isoDay(latest)}"></label>` : ""}
    ${limit}
    ${open ? `<p class="field-error" id="own-date-error" hidden>${booked ? "Choose a date between today and two years from now." : `Choose a date between today and ${esc(formatDay(latest))}.`}</p>
    <button class="button-primary" type="button" data-action="own-save">Save</button>` : ""}
    ${current ? `<button class="button-secondary" type="button" data-action="own-remove">Use Pathway's date</button>` : ""}`;
  openSheet("own-sheet");
}

async function saveOwnDate(remove = false) {
  const { kind, stepId, key, earliest, latest } = state.ownDate;
  const code = state.saved.country;
  const input = document.getElementById("own-date-input");
  let value = null;
  if (!remove) {
    try {
      value = isoDay(readDay(input.value));
    } catch {
      value = null;
    }
    const day = value ? readDay(value) : null;
    if (day === null || day < earliest || day > latest) {
      document.getElementById("own-date-error").hidden = false;
      return;
    }
  }
  // Keeping a booked test in the answers rather than with own dates, since the questions ask for it too
  if (kind === "english" || kind === "sat") {
    const answers = answersFor(state.saved);
    if (kind === "english") {
      await storeAnswers({ ...answers, english: { status: "booked", test: answers.english?.test ?? "ielts", date: value } });
    } else {
      await storeAnswers({ ...answers, sat: { status: "booked", date: value } });
    }
  } else {
    const own = { deadlines: { ...state.own[code].deadlines }, starts: { ...state.own[code].starts } };
    const list = kind === "deadline" ? own.deadlines : own.starts;
    if (remove) {
      delete list[key];
    } else {
      list[key] = value;
    }
    state.own[code] = own;
    await writeData(ownKey(code), own);
  }
  await closeSheet();
  await rebuildAndRender();
  // Returning focus to the step the date belongs to, since the whole plan was redrawn
  focusStep(stepId);
}

function focusStep(stepId) {
  if (stepId) {
    root.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"] .step-card .step-head`)?.focus({ preventScroll: true });
  }
}

function showSwitch() {
  const current = state.saved.country;
  document.getElementById("switch-body").innerHTML = `<fieldset class="choices"><legend class="visually-hidden">Choose a country</legend>${data.index.countries
    .map((item) => {
      const kept = item.code !== current && state.saved.countries[item.code]?.intake;
      return `<label class="choice" style="--route: var(${item.line})">
        <input class="station-input" type="radio" name="switch" value="${item.code}"${item.code === current ? " checked" : ""} data-action="switch-to">
        <span class="station" aria-hidden="true"></span>
        <span class="option-text"><span class="option-label">${esc(item.name)}</span>${kept ? `<span class="option-note">Your ${esc(item.name)} plan is kept</span>` : ""}</span>
      </label>`;
    }).join("")}</fieldset>
    <p class="note">Each country keeps its own ticks, so switching back restores your progress.</p>
    <div class="switch-start-over">
      <p class="note">Want to begin again with new answers?</p>
      <button class="button-secondary is-danger" type="button" data-action="start-over">Start over</button>
    </div>`;
  openSheet("switch-sheet");
}

async function switchTo(code) {
  await closeSheet();
  if (code === state.saved.country) {
    return;
  }
  const { plan } = await country(code);
  const answers = answersFor(state.saved, code);
  if (!answers.intake) {
    // Starting a first plan for this country, taking competitiveness from the current country's answer
    const draft = { ...answers, tier: answers.tier ?? answersFor(state.saved).tier, startChoice: null };
    await startSetup({ draft, queue: reuseQueue(plan), exitTo: "plan", full: false });
    return;
  }
  if (plan.asksSat && !answers.sat) {
    await startSetup({ draft: { ...answers }, queue: ["sat"], single: true, exitTo: "plan" });
    return;
  }
  state.saved.country = code;
  await writeData(SAVED_KEY, state.saved);
  state.openSteps.clear();
  state.drawn = false;
  await build();
  render({ animateLine: true });
  screen.scrollTo({ top: 0 });
}

async function changeAnswer(key) {
  const answers = answersFor(state.saved);
  const draft = structuredClone(answers);
  // Opening on "Have a score" once a booked test's day has passed, since its score comes next
  const test = key === "english" || key === "sat" ? draft[key] : null;
  if (test?.status === "booked" && readDay(test.date) < state.today) {
    applyInput(draft, { dataset: { field: `${key}Status`, value: "score" } });
  }
  // Asking the intake again after the school, since the school year decides which intakes are offered
  const queue = key === "school" ? ["school", "intake"] : [key === "system" ? "school" : key];
  await startSetup({ draft, queue, single: true, exitTo: "plan" });
}

async function chooseRoute(routeId) {
  const code = state.saved.country;
  const own = state.saved.countries[code] ?? {};
  if (routeId) {
    own.route = routeId;
  } else {
    delete own.route;
  }
  state.saved.countries[code] = own;
  await writeData(SAVED_KEY, state.saved);
  await rebuildAndRender();
  screen.scrollTo({ top: 0 });
}

function showStartOver() {
  openSheet("confirm-sheet");
}

// Removing every answer, tick and own date, cancelling reminders, and returning to the first screen.
// The reminder settings themselves are kept, so a new plan follows the same choices
async function startOver() {
  await closeSheet();
  await removeSetting(SAVED_KEY);
  for (const { code } of data.index.countries) {
    await removeSetting(ticksKey(code));
    await removeSetting(ownKey(code));
  }
  window.clearTimeout(reminderTimer);
  await syncReminders(null, null, state.today);
  state.saved = null;
  state.ticks = {};
  state.own = {};
  state.result = null;
  state.openSteps.clear();
  state.drawn = false;
  setScreenMode("welcome");
  render();
  screen.scrollTo({ top: 0 });
}

// Moving to the next intake that fits, from the out-of-reach card
async function useNext() {
  const next = state.result?.next;
  if (!next) {
    return;
  }
  const answers = answersFor(state.saved);
  await storeAnswers({ ...answers, intake: next.month ? { month: next.month } : { cycle: next.cycle } });
  await rebuildAndRender();
  screen.scrollTo({ top: 0 });
}

async function onClick(event) {
  // Handling the reminders panel first, since its buttons carry data-reminders instead of data-action
  const reminder = event.target.closest("[data-reminders]");
  if (reminder) {
    const message = await reminderAction(reminder.dataset.reminders);
    if (message === null) {
      await closeSheet();
      if (state.mode === "plan") {
        render();
      }
    } else if (message) {
      showReminders(state.result, state.today, message);
    }
    return;
  }
  const trigger = event.target.closest("[data-action]");
  if (!trigger || !screen.contains(trigger) && !trigger.closest("dialog")) {
    return;
  }
  const { action } = trigger.dataset;
  switch (action) {
    case "start": {
      const draft = state.saved ? answersFor(state.saved) : {};
      if (trigger.dataset.country) {
        draft.country = trigger.dataset.country;
        draft.intake = state.saved?.countries[draft.country]?.intake ?? null;
      }
      await startSetup({ draft, queue: [...ALL_QUESTIONS], index: trigger.dataset.country ? 1 : 0, exitTo: state.saved ? "plan" : "welcome" });
      break;
    }
    case "pick":
      if (trigger.tagName === "BUTTON" && state.setup && applyInput(state.setup.draft, trigger)) {
        await refreshQuestion();
      }
      break;
    case "step":
      if (state.setup && applyInput(state.setup.draft, trigger)) {
        await refreshQuestion();
      }
      break;
    case "setup-next":
      await setupNext();
      break;
    case "setup-back":
      await setupBack();
      break;
    case "toggle-step": {
      const id = trigger.dataset.step;
      // Keeping the next step always open, so a tap on its title changes nothing
      if (id === state.result?.current) {
        break;
      }
      if (state.openSteps.has(id)) {
        state.openSteps.delete(id);
      } else {
        state.openSteps.add(id);
      }
      // Redrawing only this step, which keeps the tap quick on long plans
      const item = root.querySelector(`.route-step[data-step="${CSS.escape(id)}"]`);
      const html = state.mode === "plan" && state.result?.status === "ok" && item ? renderStepItem(state.result, planCtx(), id) : null;
      if (html) {
        const open = state.openSteps.has(id);
        const before = measure(root, id);
        stopRouteMotion(id);
        // Copying the open card when closing, so it can shrink away instead of vanishing
        const ghost = open ? null : item.querySelector(".step-card")?.cloneNode(true);
        item.outerHTML = html;
        const after = placeLine(root, { collect: true });
        animateToggle(root, before, after, id, open, ghost);
      } else {
        render();
      }
      root.querySelector(`.route-step[data-step="${CSS.escape(id)}"] .step-card .step-head`)?.focus({ preventScroll: true });
      break;
    }
    case "tick": {
      const before = openStepsBefore(trigger.dataset.step);
      if (before.length > 0) {
        showStepsBefore(trigger.dataset.step, before);
      } else {
        await tick([trigger.dataset.step], true);
      }
      break;
    }
    case "tick-all":
      await tickPending(true);
      break;
    case "tick-one":
      await tickPending(false);
      break;
    case "untick":
      await tick([trigger.dataset.step], false);
      break;
    case "source":
      showSource(trigger.dataset.step);
      break;
    case "own-date":
      showOwnDate(trigger.dataset.kind, trigger.dataset.step);
      break;
    case "own-save":
      await saveOwnDate(false);
      break;
    case "own-remove":
      await saveOwnDate(true);
      break;
    case "own-clear":
      await clearOwnDates();
      break;
    case "switch-country":
      showSwitch();
      break;
    case "change-country":
      await startSetup({ draft: { ...answersFor(state.saved), country: null, intake: null }, queue: ["country", "intake"], single: true, exitTo: "plan" });
      break;
    case "change-answer":
      await changeAnswer(trigger.dataset.answer);
      break;
    case "choose-route":
      await chooseRoute(trigger.dataset.route);
      break;
    case "open-roadmap":
      openRoadmapAt(state.saved.country, trigger.dataset.section);
      break;
    case "use-next":
      await useNext();
      break;
    case "retry":
      await refresh(true);
      break;
    case "toggle-answers":
      toggleAnswers();
      break;
    case "reminders":
      // Rechecking first, as notifications may have been switched off in Android's settings
      // since the plan was drawn
      if (await recheckReminders()) {
        render();
      }
      showReminders(state.result, state.today);
      break;
    case "start-over":
      showStartOver();
      break;
    case "start-over-confirm":
      await startOver();
      break;
    default:
      break;
  }
}

async function onChange(event) {
  const input = event.target;
  if (input.dataset.action === "switch-to") {
    await switchTo(input.value);
    return;
  }
  if (!state.setup || !input.dataset.field) {
    return;
  }
  if (applyInput(state.setup.draft, input)) {
    await refreshQuestion(input.type === "date" ? null : input.name);
  }
}

// Redrawing the question after an answer changes, keeping focus where the student was
async function refreshQuestion(focusName = null) {
  const key = state.setup.queue[state.setup.index];
  // Preparing the question again only where the answer can change the intakes or the question list
  if (key === "school" || key === "intake" || key === "country") {
    await prepareQuestion();
  }
  const active = document.activeElement;
  const field = active?.dataset?.field;
  const value = active?.dataset?.value ?? active?.value;
  const fieldsBefore = root.querySelector(".setup-body")?.childElementCount ?? 0;
  render({ update: true });
  const again = focusName
    ? root.querySelector(`input[name="${CSS.escape(focusName)}"]:checked`)
    : field ? root.querySelector(`[data-field="${CSS.escape(field)}"]${value !== undefined && active.tagName === "BUTTON" ? `[data-value="${CSS.escape(String(value))}"]` : ""}`) : null;
  again?.focus({ preventScroll: true });
  // Bringing fields that have just appeared, such as the score after "Have a score", into view
  // above the button at the bottom, so nobody has to discover them by scrolling
  const body = root.querySelector(".setup-body");
  if (body && body.childElementCount > fieldsBefore) {
    body.lastElementChild.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }
}

// Handling Android's back gesture: one question back while answering, then out of the questions.
// Returns true when the Plan tab used the gesture
export function handlePlanBack() {
  if (state.mode === "setup" && state.setup) {
    setupBack();
    return true;
  }
  return false;
}

// Rebuilding when the app returns on a new day, or when asked to try again. Coming back also
// checks whether notifications were switched off in Android's settings meanwhile
export async function refresh(force = false) {
  const remindersChanged = await recheckReminders().catch(() => false);
  const now = phoneToday();
  if (!force && now === state.today) {
    if (remindersChanged && state.mode === "plan") {
      render();
    }
    return;
  }
  state.today = now;
  // Closing any question about earlier steps, since it belongs to the plan as it was
  if (state.pendingTick) {
    state.pendingTick = null;
    await closeSheet();
  }
  if (state.mode === "plan" && state.saved) {
    await rebuildAndRender();
  } else if (state.mode === "setup") {
    await prepareQuestion();
    render();
  }
}

// Telling the roadmaps which plan is on screen, so they can show its dates and mark its route
export function currentPlan() {
  if (state.mode !== "plan" || !state.saved || !state.result) {
    return null;
  }
  return { code: state.saved.country, result: state.result, answers: answersFor(state.saved), version: planVersion };
}

// Answering "Make my plan for this country" from a roadmap: a first plan asks the questions, starting
// from the answers already given for another country, and a country with a plan opens it
export async function planFor(code) {
  showPlanTab();
  if (state.mode === "loading") {
    return;
  }
  if (state.saved) {
    if (code !== state.saved.country || state.mode !== "plan") {
      await switchTo(code);
    }
    return;
  }
  await startSetup({ draft: { country: code, intake: null }, queue: [...ALL_QUESTIONS], index: 1, exitTo: "welcome" });
}

// Opening the plan at one step when a reminder is tapped. A tap during loading waits until the
// plan is ready
export async function openStep(code, stepId) {
  if (state.mode === "loading") {
    state.pendingOpen = { code, stepId };
    return;
  }
  showPlanTab();
  if (!state.saved || state.mode === "setup") {
    return;
  }
  if (code !== state.saved.country && state.saved.countries[code]?.intake) {
    await switchTo(code);
  }
  if (stepId && state.result?.steps?.some((step) => step.id === stepId)) {
    state.openSteps.add(stepId);
    render();
    root.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"]`)?.scrollIntoView({ block: "center" });
  }
}

export async function initTimeline({ onShowPlan, onOpenRoadmap } = {}) {
  showPlanTab = onShowPlan ?? showPlanTab;
  openRoadmapAt = onOpenRoadmap ?? openRoadmapAt;
  screen = document.getElementById("screen-plan");
  root = document.getElementById("plan-root");
  state.today = phoneToday();
  screen.addEventListener("click", (event) => {
    onClick(event).catch(reportError);
  });
  screen.addEventListener("change", (event) => {
    onChange(event).catch(reportError);
  });
  // Listening on every panel too, since the panels sit outside the Plan tab's screen
  for (const id of ["source-sheet", "own-sheet", "switch-sheet", "reminders-sheet", "confirm-sheet", "steps-sheet"]) {
    const dialog = document.getElementById(id);
    dialog.addEventListener("click", (event) => {
      onClick(event).catch(reportError);
    });
    dialog.addEventListener("change", (event) => {
      onChange(event).catch(reportError);
    });
  }
  onSheetClose("own-sheet", () => {
    state.ownDate = null;
  });
  onSheetClose("steps-sheet", () => {
    state.pendingTick = null;
  });
  window.addEventListener("resize", () => {
    if (state.mode === "plan") {
      placeLine(root);
    }
  });

  try {
    // Treating reminders as an extra: if they cannot start, the plan still opens without them
    await initReminders(openStep).catch((error) => console.warn("Could not start reminders", error));
    await loadCommon();
    const stored = await readSaved();
    if (stored.newer) {
      setScreenMode("newer");
      render();
      return;
    }
    state.saved = stored.saved;
    if (state.saved) {
      await loadCountryState(state.saved.country);
      const { plan } = await country(state.saved.country);
      // Asking again for any saved answer this version cannot use, before showing a plan
      const problems = answerProblems(answersFor(state.saved), plan);
      if (problems.length > 0) {
        await startSetup({ draft: answersFor(state.saved), queue: problems.filter((key) => key !== "country"), single: true, exitTo: "welcome" });
        return;
      }
      setScreenMode("plan");
      await build();
      render({ animateLine: true });
      if (state.pendingOpen) {
        const { code, stepId } = state.pendingOpen;
        state.pendingOpen = null;
        await openStep(code, stepId);
      }
    } else {
      setScreenMode("welcome");
      render();
    }
  } catch (error) {
    reportError(error);
  }
}

function reportError(error) {
  // Showing a calm message instead of a half-drawn plan for any failure, while the console keeps
  // the details
  console.error("The Plan tab stopped", error instanceof PlanError || error instanceof FactsError ? error.message : error);
  setScreenMode("error");
  render();
}
