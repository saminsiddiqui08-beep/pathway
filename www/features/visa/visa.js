// Preparing for the visa step: whether each country interviews student applicants, what the US
// interview day holds, what a refusal means, and practice questions whose answers the student writes
// and keeps on the phone
import { esc } from "../timeline/words.js";
import { chips, fold, icon, infoButton, stations, toggleFold, withInfo } from "../toolkit/parts.js";

const SAVE_KEY = "tool.visa";
const SAVED_VERSION = 1;
// Keeping each written answer to a length that suits a spoken reply of a few sentences
const NOTE_LENGTH = 600;
// Saving a written answer this long after the last key press, so typing never waits for storage
const TYPING_PAUSE = 400;

function emptySaved(country) {
  return { version: SAVED_VERSION, country, notes: {}, ready: [] };
}

// Keeping only saved answers and ticks for questions that still exist
function cleanSaved(value, codes, cards) {
  if (!value || value.version !== SAVED_VERSION) {
    return null;
  }
  const ids = new Set(cards.map((one) => one.id));
  const clean = emptySaved(codes.includes(value.country) ? value.country : codes[0]);
  clean.notes = Object.fromEntries(Object.entries(value.notes ?? {}).filter(([id, text]) => ids.has(id) && typeof text === "string").map(([id, text]) => [id, text.slice(0, NOTE_LENGTH)]));
  clean.ready = Array.isArray(value.ready) ? value.ready.filter((id) => ids.has(id)) : [];
  return clean;
}

export async function createTool(host) {
  const [data, countryList] = await Promise.all([host.fetchJson("tools/visa.json"), host.countries()]);
  const codes = countryList.map((item) => item.code);
  const state = { saved: null, open: new Set(), message: "" };
  let body = null;
  let typing = 0;

  const saved = () => state.saved;
  const country = () => data.countries[saved().country];
  const countryName = (code) => countryList.find((item) => item.code === code)?.name ?? code;

  function save() {
    host.save(SAVE_KEY, state.saved);
  }

  function answerHtml() {
    const place = country();
    return `<h3 class="tool-heading">Will you have an interview?</h3>
      <p class="tool-answer visa-answer">${withInfo(esc(place.answer), place.cite)}</p>
      <button class="text-button" type="button" data-action="tool-roadmap">Read the ${esc(countryName(saved().country))} roadmap's visa section</button>`;
  }

  // Drawing the interview day as a short line of stations, from the days before to the decision
  function dayHtml() {
    const stops = data.day.map((stop) => ({
      state: "hollow",
      html: `<p class="tool-stop-label">${esc(stop.title)}</p><p class="tool-line">${withInfo(esc(stop.text), stop.cite)}</p>`,
    }));
    return `<h3 class="tool-heading">The interview day</h3>${stations(stops, { label: "The interview day" })}`;
  }

  function refusedBody() {
    return data.refused.map((part) => `<p class="field-label visa-refused-title">${esc(part.title)}</p><p class="reading">${withInfo(esc(part.text), part.cite)}</p>`).join("");
  }

  function cardBody(card) {
    const note = saved().notes[card.id] ?? "";
    const ready = saved().ready.includes(card.id);
    return `<p class="field-label">A good answer</p>
      <ul class="tool-plain-list is-dotted">${card.good.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      <label class="tool-field tool-text-field"><span class="field-label">Your answer, in your own words</span>
        <textarea data-field="note.${esc(card.id)}" maxlength="${NOTE_LENGTH}" rows="3">${esc(note)}</textarea></label>
      <div class="visa-card-foot"><button type="button" class="chip" aria-pressed="${ready}" data-action="tool-ready" data-value="${esc(card.id)}">${ready ? icon("tick", " is-small") : ""}Ready</button>${infoButton(card.cite)}</div>`;
  }

  function cardSummary(card) {
    return saved().ready.includes(card.id) ? "Ready" : card.why;
  }

  function cardHtml(card) {
    const ready = saved().ready.includes(card.id);
    return `<li class="visa-card${ready ? " is-ready" : ""}" data-card="${esc(card.id)}">${fold({ id: card.id, title: card.question, summary: esc(cardSummary(card)), open: state.open.has(card.id), body: () => cardBody(card) })}</li>`;
  }

  function progressText() {
    const ready = saved().ready.length;
    return `${ready} of ${data.cards.length} ready`;
  }

  function practiceHtml() {
    const place = country();
    if (!place.practice) {
      return "";
    }
    return `<h3 class="tool-heading">Practice</h3>
      <p class="note">${withInfo(esc(data.practiceIntro), data.practiceCite)}</p>
      ${place.practiceNote ? `<p class="note">${esc(place.practiceNote)}</p>` : ""}
      <div class="visa-practice-bar"><p class="visa-progress" id="visa-progress">${esc(progressText())}</p><button class="button-secondary is-compact" type="button" data-action="tool-ask">Ask me one</button></div>
      <p class="note visa-message" id="visa-message" aria-live="polite">${esc(state.message)}</p>
      <ul class="visa-cards">${data.cards.map(cardHtml).join("")}</ul>
      <p class="note">Your answers are saved on this phone and never sent to Pathway. Practise saying them aloud; never read a script at the interview.</p>`;
  }

  function render() {
    const code = saved().country;
    body.innerHTML = `<p class="lead tool-lead">Whether you will have a visa interview, what the day holds, and practice for it.</p>
      ${chips("country", countryList.map((item) => [item.code, item.name]), code, "Country")}
      <div class="tool-result">${answerHtml()}</div>
      ${code === "us" ? dayHtml() : ""}
      ${practiceHtml()}
      ${code === "us" ? fold({ id: "refused", title: "If you are refused", summary: "What 214(b) and 221(g) mean, and what to do next", open: state.open.has("refused"), body: refusedBody }) : ""}`;
  }

  // Refreshing a question's ready state in place, so the list never jumps while the student works
  function updateCard(id) {
    const item = body.querySelector(`.visa-card[data-card="${CSS.escape(id)}"]`);
    const card = data.cards.find((one) => one.id === id);
    if (!item || !card) {
      return;
    }
    const ready = saved().ready.includes(id);
    item.classList.toggle("is-ready", ready);
    item.querySelector(".tool-fold-summary").textContent = cardSummary(card);
    const chip = item.querySelector('[data-action="tool-ready"]');
    if (chip) {
      chip.setAttribute("aria-pressed", String(ready));
      chip.innerHTML = `${ready ? icon("tick", " is-small") : ""}Ready`;
    }
    body.querySelector("#visa-progress").textContent = progressText();
  }

  // Choosing a question not yet marked ready, opening it and bringing it into view
  function askOne() {
    const left = data.cards.filter((card) => !saved().ready.includes(card.id));
    const pool = left.length > 0 ? left : data.cards;
    const card = pool[Math.floor(Math.random() * pool.length)];
    state.message = left.length > 0 ? "" : "Every question is ready. Here is one to go over again.";
    body.querySelector("#visa-message").textContent = state.message;
    if (!state.open.has(card.id)) {
      state.open.add(card.id);
      toggleFold(body, card.id, true, () => cardBody(card));
    }
    const item = body.querySelector(`.visa-card[data-card="${CSS.escape(card.id)}"]`);
    item?.scrollIntoView({ block: "start" });
    item?.querySelector(".tool-fold-toggle")?.focus({ preventScroll: true });
  }

  return {
    async mount(element) {
      body = element;
      const planCode = host.plan()?.code;
      state.saved = cleanSaved(await host.readData(SAVE_KEY), codes, data.cards) ?? emptySaved(codes.includes(planCode) ? planCode : codes[0]);
      render();
    },
    async click(trigger) {
      const { action, field, value } = trigger.dataset;
      switch (action) {
        case "tool-pick":
          if (field === "country") {
            saved().country = value;
            state.message = "";
            save();
            render();
            body.querySelector(`[data-action="tool-pick"][data-field="country"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
          }
          break;
        case "tool-ready": {
          const ready = new Set(saved().ready);
          if (ready.has(value)) {
            ready.delete(value);
          } else {
            ready.add(value);
          }
          saved().ready = data.cards.map((card) => card.id).filter((id) => ready.has(id));
          save();
          updateCard(value);
          break;
        }
        case "tool-ask":
          askOne();
          break;
        case "tool-roadmap":
          host.openRoadmap(saved().country, country().section);
          break;
        case "tool-fold": {
          const id = trigger.dataset.fold;
          const opening = !state.open.has(id);
          if (opening) {
            state.open.add(id);
          } else {
            state.open.delete(id);
          }
          const card = data.cards.find((one) => one.id === id);
          toggleFold(body, id, opening, card ? () => cardBody(card) : refusedBody);
          break;
        }
        case "tool-facts":
          await host.showFacts(trigger.dataset.facts.split(" "));
          break;
        default:
          break;
      }
    },
    input(event) {
      const field = event.target.dataset?.field ?? "";
      if (!field.startsWith("note.")) {
        return;
      }
      const id = field.slice("note.".length);
      const text = event.target.value.slice(0, NOTE_LENGTH);
      if (text.trim() === "") {
        delete saved().notes[id];
      } else {
        saved().notes[id] = text;
      }
      window.clearTimeout(typing);
      typing = window.setTimeout(save, TYPING_PAUSE);
    },
    async refresh() { },
    leave() {
      if (typing) {
        window.clearTimeout(typing);
        save();
      }
    },
  };
}
