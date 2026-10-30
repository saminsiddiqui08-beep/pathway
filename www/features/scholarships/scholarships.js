// Connecting the Scholarships tab: a first list of US universities known for generous aid to
// international students, grouped by whether asking for aid can affect admission. Every line rests
// on a university's own page, shown through the information button
import { today } from "../../app/dates.js";
import { createFacts } from "../../app/facts.js";
import { showFactPanel } from "../roadmaps/roadmaps.js";
import { esc } from "../timeline/words.js";
import { fold, toggleFold, withInfo } from "../toolkit/parts.js";

const DATA_FORMAT = 1;
const WORDS_ID = "words";

let root = null;
let hooks = { openRoadmap: () => { } };
const state = { data: null, facts: null, words: [], open: new Set() };

async function fetchJson(path) {
  const response = await fetch(`data/${path}`);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

async function load() {
  const data = await fetchJson("scholarships/us.json");
  if (data.format !== DATA_FORMAT) {
    throw new Error(`The scholarship list has format ${data.format}`);
  }
  const [docs, words] = await Promise.all([
    Promise.all(data.facts.map(async (code) => [code, await fetchJson(code === "bd" ? "common/bd.json" : `countries/${code}/facts.json`)])),
    fetchJson("tools/words.json"),
  ]);
  state.data = data;
  state.facts = createFacts(Object.fromEntries(docs));
  state.words = data.words.map((id) => words.words.find((word) => word.id === id)).filter(Boolean);
}

function factText(ref) {
  return state.facts.fact(ref).value.text;
}

function universityBody(item) {
  return item.cite.map((ref) => `<p class="reading">${withInfo(esc(factText(ref)), [ref])}</p>`).join("");
}

function wordsBody() {
  return `<dl class="scholarships-words">${state.words.map((word) => `<div><dt>${esc(word.term)}</dt><dd>${withInfo(esc(word.meaning), word.cite)}</dd></div>`).join("")}</dl>`;
}

const WORDS_FOLD = { title: "What these words mean", summary: "Need-blind, need-aware and full need", body: wordsBody };

function universityFold(item) {
  return fold({ id: item.key, title: item.name, summary: esc(item.summary), open: state.open.has(item.key), body: () => universityBody(item) });
}

// Drawing the list: a short explanation, the words it uses, then one group of universities per policy
function render() {
  const { data } = state;
  root.innerHTML = `<p class="lead">US universities that give generous aid to international students, with the source and the date checked for every line.</p>
    <p class="note scholarships-intro">A first list of ${data.universities.length} universities. More universities, and more about each one's aid, will follow.</p>
    <ul class="scholarships-list">
      <li>${fold({ id: WORDS_ID, title: WORDS_FOLD.title, summary: esc(WORDS_FOLD.summary), open: state.open.has(WORDS_ID), body: WORDS_FOLD.body })}</li>
    </ul>
    ${data.groups.map((group) => `<section class="scholarships-group" aria-labelledby="scholarships-${esc(group.id)}">
      <h2 class="tool-heading" id="scholarships-${esc(group.id)}">${esc(group.title)}</h2>
      <ul class="scholarships-list">${data.universities.filter((item) => item.group === group.id).map((item) => `<li>${universityFold(item)}</li>`).join("")}</ul>
    </section>`).join("")}
    <div class="scholarships-foot">
      <button class="text-button" type="button" data-action="scholarships-roadmap">Read the USA roadmap's aid section</button>
      <p class="note">Aid rules change. Check the official site before you act.</p>
    </div>`;
}

function bodyFor(id) {
  if (id === WORDS_ID) {
    return WORDS_FOLD.body;
  }
  const item = state.data.universities.find((one) => one.key === id);
  return item ? () => universityBody(item) : null;
}

function onClick(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger || !state.data) {
    return;
  }
  const { action } = trigger.dataset;
  if (action === "tool-fold") {
    const id = trigger.dataset.fold;
    const body = bodyFor(id);
    if (!body) {
      return;
    }
    const opening = !state.open.has(id);
    if (opening) {
      state.open.add(id);
    } else {
      state.open.delete(id);
    }
    toggleFold(root, id, opening, body);
  } else if (action === "tool-facts") {
    showFactPanel(trigger.dataset.facts.split(" "), state.facts, today(), state.data.cycle);
  } else if (action === "scholarships-roadmap") {
    hooks.openRoadmap(state.data.country, state.data.roadmapSection);
  }
}

export async function initScholarships(options) {
  hooks = { ...hooks, ...options };
  root = document.getElementById("scholarships-root");
  root.addEventListener("click", onClick);
  try {
    await load();
    render();
  } catch (error) {
    console.error("The scholarship list stopped", error);
    root.innerHTML = `<section class="message-card"><h3>Pathway could not read its scholarship list</h3><p class="reading">Close Pathway and open it again. If this keeps happening, reinstall the app.</p></section>`;
  }
}
