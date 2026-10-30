// Explaining the words on university and visa pages in plain language: searchable, filtered by
// country, each meaning resting on the facts it cites and leading to related words
import { LINK_WORDS } from "../roadmaps/render.js";
import { esc } from "../timeline/words.js";
import { chips, fold, infoButton, toggleFold, withInfo } from "../toolkit/parts.js";

// Waiting this long after the last key press before filtering, so typing stays smooth
const TYPING_PAUSE = 150;
const SAVE_KEY = "tool.words";
const SAVED_VERSION = 1;

// Reducing a text to plain lowercase letters and digits, so "I-20", "i20" and "I 20" all match
function plain(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9*]+/g, "");
}

// Scoring how well a word matches the search: its name first, then its other names, then its meaning
function rank(word, query) {
  if (!query) {
    return 1;
  }
  const names = [word.term, ...word.also].map(plain);
  if (names.some((name) => name.startsWith(query))) {
    return 3;
  }
  if (names.some((name) => name.includes(query))) {
    return 2;
  }
  return plain(word.meaning).includes(query) ? 1 : 0;
}

export async function createTool(host) {
  const data = await host.fetchJson("tools/words.json");
  const byId = new Map(data.words.map((word) => [word.id, word]));
  const places = data.places.map(([code]) => code);
  const state = { place: "all", query: "", open: new Set() };
  let body = null;
  let typing = 0;

  function shown() {
    const query = plain(state.query);
    return data.words
      .filter((word) => state.place === "all" || word.where.includes("all") || word.where.includes(state.place))
      .map((word) => ({ word, score: rank(word, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.word.term.localeCompare(b.word.term))
      .map((item) => item.word);
  }

  function wordBody(word) {
    const related = word.related.map((id) => byId.get(id)).filter(Boolean);
    const link = word.link && LINK_WORDS[word.link] ? `<button class="text-button" type="button" data-action="tool-open" data-value="${esc(word.link)}">${esc(LINK_WORDS[word.link])}</button>` : "";
    return `${word.forYou ? `<p class="reading words-for-you">${withInfo(`<strong>For you:</strong> ${esc(word.forYou)}`, word.cite)}</p>` : ""}
      ${related.length > 0 ? `<div class="words-related"><p class="field-label">Related</p><div class="chips">${related.map((one) => `<button type="button" class="chip" data-action="tool-word" data-value="${esc(one.id)}">${esc(one.term)}</button>`).join("")}</div></div>` : ""}
      ${link || !word.forYou ? `<div class="words-foot">${link}${word.forYou ? "" : infoButton(word.cite)}</div>` : ""}`;
  }

  function wordHtml(word) {
    const title = word.also.length > 0 ? `${word.term} (${word.also.join(", ")})` : word.term;
    return `<li class="words-item" data-word="${esc(word.id)}">${fold({ id: word.id, title, summary: esc(word.meaning), open: state.open.has(word.id), body: () => wordBody(word) })}</li>`;
  }

  function listHtml() {
    const words = shown();
    const count = words.length === data.words.length ? `${words.length} words` : `${words.length} of ${data.words.length} words`;
    if (words.length === 0) {
      return `<p class="tool-empty">No word matches "${esc(state.query.trim())}". Try a shorter part of it, or choose All.</p>`;
    }
    return `<p class="note words-count">${esc(count)}</p><ul class="words-list">${words.map(wordHtml).join("")}</ul>`;
  }

  function render() {
    body.innerHTML = `<p class="lead tool-lead">Plain meanings for the words on university and visa pages.</p>
      <label class="tool-field tool-text-field words-search"><span class="field-label">Search</span><input type="search" data-field="search" autocomplete="off" placeholder="Such as I-20 or need-blind" value="${esc(state.query)}"></label>
      ${chips("place", data.places, state.place, "Where it is used")}
      <div id="words-list" aria-live="polite">${listHtml()}</div>`;
  }

  function renderList() {
    body.querySelector("#words-list").innerHTML = listHtml();
  }

  // Opening a related word: showing it whatever the filter, opening it and bringing it into view
  function goTo(id) {
    const word = byId.get(id);
    if (!word) {
      return;
    }
    if (!shown().includes(word)) {
      state.query = "";
      state.place = "all";
      render();
    }
    state.open.add(id);
    renderList();
    const item = body.querySelector(`.words-item[data-word="${CSS.escape(id)}"]`);
    item?.scrollIntoView({ block: "start" });
    item?.querySelector(".tool-fold-toggle")?.focus({ preventScroll: true });
  }

  return {
    async mount(element) {
      body = element;
      const saved = await host.readData(SAVE_KEY);
      if (saved?.version === SAVED_VERSION && places.includes(saved.place)) {
        state.place = saved.place;
      }
      render();
    },
    async click(trigger) {
      const { action, field, value } = trigger.dataset;
      switch (action) {
        case "tool-pick":
          if (field === "place") {
            state.place = value;
            host.save(SAVE_KEY, { version: SAVED_VERSION, place: value });
            body.querySelectorAll('[data-action="tool-pick"][data-field="place"]').forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.value === value)));
            renderList();
          }
          break;
        case "tool-fold": {
          const id = trigger.dataset.fold;
          const opening = !state.open.has(id);
          if (opening) {
            state.open.add(id);
          } else {
            state.open.delete(id);
          }
          toggleFold(body, id, opening, () => wordBody(byId.get(id)));
          break;
        }
        case "tool-word":
          goTo(value);
          break;
        case "tool-open":
          await host.openEntry(value);
          break;
        case "tool-facts":
          await host.showFacts(trigger.dataset.facts.split(" "));
          break;
        default:
          break;
      }
    },
    input(event) {
      if (event.target.dataset?.field !== "search") {
        return;
      }
      state.query = event.target.value;
      window.clearTimeout(typing);
      typing = window.setTimeout(renderList, TYPING_PAUSE);
    },
    async refresh() { },
    leave() {
      window.clearTimeout(typing);
    },
  };
}
