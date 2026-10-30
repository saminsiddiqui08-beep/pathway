// The deadline tool: a deadline from a university's page, turned into the same moment on the
// student's own clock, offline, with clock changes and midnight explained
import { formatDay, formatTime, readDate } from "../../app/dates.js";
import { esc } from "../timeline/words.js";
import { chips, fold, infoButton, stations, toggleFold } from "../toolkit/parts.js";
import { convert, gapWords, offsetWords, phoneZone, weekday } from "./convert.js";

const SAVE_KEY = "tool.deadline";
const SAVED_VERSION = 1;
// Colouring the countdown as urgent only this close, as the Plan tab does
const URGENT_DAYS = 14;
const MIDNIGHT = "midnight";
const START_OF_DAY = "00:00";

function cityOf(zone) {
  return zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");
}

function dayWords(day) {
  return `${weekday(day)} ${formatDay(day)}`;
}

export async function createTool(host) {
  const data = await host.fetchJson("tools/deadline.json");
  const homeZone = phoneZone(data.home.zone);
  const homeName = homeZone === data.home.zone ? data.home.name : cityOf(homeZone);
  const state = { place: null, date: "", time: "23:59", folds: new Set() };
  let body = null;

  const placeOf = (id) => data.places.find((item) => item.id === id) ?? null;

  async function load() {
    const saved = await host.readData(SAVE_KEY);
    const code = host.plan()?.code;
    state.place = data.countries[code] ?? data.places[1].id;
    if (saved?.version === SAVED_VERSION) {
      state.place = placeOf(saved.place) ? saved.place : state.place;
      state.date = typeof saved.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.date) ? saved.date : "";
      state.time = saved.time === MIDNIGHT || /^\d{2}:\d{2}$/.test(saved.time ?? "") ? saved.time : state.time;
    }
  }

  function save() {
    host.save(SAVE_KEY, { version: SAVED_VERSION, place: state.place, date: state.date, time: state.time });
  }

  function abbreviations() {
    return `<ul class="tool-plain-list">${data.places.filter((item) => item.shows).map((item) => `<li><button class="tool-pick-row" type="button" data-action="tool-pick" data-field="place" data-value="${esc(item.id)}" aria-pressed="${item.id === state.place}">
        <span class="tool-pick-words">${esc(item.shows.join(", "))}</span><span class="tool-pick-name">${esc(item.name)}</span></button></li>`).join("")}</ul>
      <p class="note">GMT is the same as UTC. In summer, a UK page that says GMT may mean UK time, so check the page.</p>`;
  }

  function controls() {
    const timeChoices = data.times.map(([value, words]) => [value, words]);
    const custom = state.time !== MIDNIGHT && !data.times.some(([value]) => value === state.time);
    return `<p class="lead tool-lead">Turn a deadline on a university's page into the same moment on your own clock.</p>
      ${chips("place", data.places.map((item) => [item.id, item.name]), state.place, "Where is the deadline set?")}
      ${fold({ id: "abbreviations", title: "What does the page say?", summary: "Match EST, BST or NZDT to a place", open: state.folds.has("abbreviations"), body: abbreviations })}
      <label class="date-field tool-field"><span class="field-label">Deadline date</span><input type="date" data-field="date" value="${esc(state.date)}"></label>
      ${chips("time", timeChoices, custom ? null : state.time, "Deadline time")}
      <label class="date-field tool-field is-quiet"><span class="field-label">Another time</span><input type="time" data-field="time" value="${esc(custom ? state.time : "")}"></label>`;
  }

  function countdown(result) {
    const now = Date.now();
    if (result.instant <= now) {
      return `<p class="tool-line">This deadline has passed.</p>`;
    }
    const days = result.here.day - host.today();
    const words = days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
    const urgent = days <= URGENT_DAYS;
    return `<p class="tool-line"><strong class="${urgent ? "is-urgent" : ""}">${esc(words)}.</strong> <span class="soft">Pathway suggests submitting a day early, so a slow connection or a busy portal cannot make you late.</span></p>`;
  }

  // Naming the clock change near a deadline by its date, and saying whether it moves this deadline
  function changeLine(result, place) {
    const change = result.change;
    if (!change) {
      return "";
    }
    const way = change.minutes > 0 ? "forward" : "back";
    const size = Math.abs(change.minutes) === 60 ? "one hour" : gapWords(change.minutes);
    const gap = Math.abs(change.day - result.there.day);
    const relation = gap === 0 ? "the same day as this deadline" : gap === 1 ? `the day ${change.before ? "before" : "after"} this deadline` : `${gap} days ${change.before ? "before" : "after"} this deadline`;
    const effect = change.before ? "Pathway has counted it in the times above." : "It does not move this deadline, but check the time again for any later one.";
    return `<p class="tool-line">Clocks in ${esc(place.city)} go ${way} ${size} on ${esc(dayWords(change.day))}, ${esc(relation)}. ${esc(effect)}</p>`;
  }

  function oddTime(result, place) {
    if (result.skipped) {
      return `<p class="tool-line">That time does not exist in ${esc(place.city)} that night, because the clocks jump forward. Pathway uses ${esc(formatTime(result.there.time))}, the moment just after the jump.</p>`;
    }
    if (result.repeated) {
      return `<p class="tool-line">That time happens twice in ${esc(place.city)} that night, because the clocks go back. Pathway uses the first, the earlier one.</p>`;
    }
    return "";
  }

  function workings(result, place) {
    return `<dl class="tool-sums">
        <div><dt>${esc(place.city)} on that date</dt><dd>${esc(offsetWords(result.zoneOffset))}</dd></div>
        <div><dt>${esc(homeName)} on that date</dt><dd>${esc(offsetWords(result.homeOffset))}</dd></div>
        <div><dt>Between the two</dt><dd>${esc(gapWords(result.apart))}</dd></div>
      </dl>
      <p class="note">Worked out on this phone from its own time zone data, so it needs no internet.</p>`;
  }

  // Explaining midnight, which can mean the start or the end of a day, and giving the later reading too
  function midnightLine(day, zone) {
    if (state.time !== MIDNIGHT) {
      return "";
    }
    const end = convert({ day: day + 1, time: START_OF_DAY, zone, home: homeZone });
    return `<p class="tool-line">Midnight can mean the start or the end of ${esc(formatDay(day, { year: false }))}. Pathway shows the start, the earlier one, so you are never late. If the page means the end of the day, it is ${esc(formatTime(end.here.time))} on ${esc(dayWords(end.here.day))} in ${esc(homeName)}.</p>`;
  }

  function resultHtml() {
    const place = placeOf(state.place);
    if (!state.date) {
      return `<p class="tool-empty">Choose the deadline's date to see it on your own clock.</p>`;
    }
    const day = readDate(state.date).first;
    const time = state.time === MIDNIGHT ? START_OF_DAY : state.time;
    if (!place.zone) {
      return `${stations([{ state: "here", html: `<p class="tool-stop-label">Your deadline, ${esc(homeName)}</p><p class="tool-big">${esc(formatTime(time))}</p><p class="tool-stop-date">${esc(dayWords(day))}</p>` }])}
        ${midnightLine(day, homeZone)}<p class="tool-line">${esc(place.note)}${infoButton(place.cite)}</p>`;
    }
    const result = convert({ day, time, zone: place.zone, home: homeZone });
    const shift = result.dayShift === 0 ? "the same day" : result.dayShift > 0 ? "the next day" : "the day before";
    const midnight = midnightLine(day, place.zone);
    const route = stations([
      { state: "hollow", html: `<p class="tool-stop-label">Their deadline, ${esc(place.city)}</p><p class="tool-stop-time">${esc(formatTime(result.there.time))}, ${esc(dayWords(result.there.day))}</p>` },
      { state: "here", html: `<p class="tool-stop-label">Your deadline, ${esc(homeName)}</p><p class="tool-big">${esc(formatTime(result.here.time))}</p><p class="tool-stop-date">${esc(dayWords(result.here.day))}, ${esc(shift)}</p>` },
    ], { label: "The deadline on both clocks" });
    return `${route}${midnight}${oddTime(result, place)}${changeLine(result, place)}${countdown(result)}
      ${fold({ id: "workings", title: "How Pathway worked this out", summary: `${esc(gapWords(result.apart))} apart on that date`, open: state.folds.has("workings"), body: () => workings(result, place) })}`;
  }

  function render() {
    body.innerHTML = `${controls()}<div class="tool-result" id="deadline-result" aria-live="polite">${resultHtml()}</div>`;
  }

  function renderResult() {
    body.querySelector("#deadline-result").innerHTML = resultHtml();
  }

  function workingsBody() {
    const place = placeOf(state.place);
    const time = state.time === MIDNIGHT ? START_OF_DAY : state.time;
    return workings(convert({ day: readDate(state.date).first, time, zone: place.zone, home: homeZone }), place);
  }

  return {
    async mount(element) {
      body = element;
      await load();
      render();
    },
    async click(trigger) {
      const { action, field, value } = trigger.dataset;
      if (action === "tool-pick") {
        state[field] = value;
        save();
        render();
        body.querySelector(`[data-action="tool-pick"][data-field="${CSS.escape(field)}"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
      } else if (action === "tool-fold") {
        const id = trigger.dataset.fold;
        const opening = !state.folds.has(id);
        if (opening) {
          state.folds.add(id);
        } else {
          state.folds.delete(id);
        }
        toggleFold(body, id, opening, id === "abbreviations" ? abbreviations : workingsBody);
      } else if (action === "tool-facts") {
        await host.showFacts(trigger.dataset.facts.split(" "));
      }
    },
    input(event) {
      const field = event.target.dataset?.field;
      if (field === "date" && event.type === "change") {
        state.date = /^\d{4}-\d{2}-\d{2}$/.test(event.target.value) ? event.target.value : "";
      } else if (field === "time" && /^\d{2}:\d{2}$/.test(event.target.value)) {
        state.time = event.target.value;
        for (const chip of body.querySelectorAll(`[data-action="tool-pick"][data-field="time"]`)) {
          chip.setAttribute("aria-pressed", String(chip.dataset.value === state.time));
        }
      } else {
        return;
      }
      save();
      renderResult();
    },
    refresh() {
      renderResult();
    },
  };
}
