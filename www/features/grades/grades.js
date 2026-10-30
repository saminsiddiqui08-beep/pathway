// Checking school results: how universities read an HSC or A level result, on the scales they publish,
// and where the student stands against each university's own rule. Comparisons are approximate and
// named; every verdict comes from the results the student enters
import { esc } from "../timeline/words.js";
import { chips, fold, icon, infoButton, numberField, readNumber, stepper, stepValue, toggleFold, updateStepper, withInfo } from "../toolkit/parts.js";
import { alevelVerdict, bestGrades, hscVerdict, percentRange, readWith, tariffPoints } from "./reading.js";

const SAVE_KEY = "tool.grades";
const SAVED_VERSION = 1;
// Allowing as many subjects as a mark sheet or a set of A levels can hold
const HSC_SUBJECTS_MAX = 12;
const ALEVEL_MAX = 6;
const GPA_LOWEST = 1;
// Waiting this long after the last key press before redrawing the answer, so typing stays smooth
const TYPING_PAUSE = 250;
const STATES = {
  meets: ["Meets", "tick"], below: ["Below", "minus"], no: ["Not accepted", "close"], ask: ["Ask them", ""],
  needs: ["Add results", ""], open: ["No set minimum", ""], sat: ["Uses the SAT", ""],
};
const APPROXIMATE = "An approximate comparison, for your own understanding. Universities always use your real results.";
const LETTER_ORDER = ["A", "B", "C", "F"];

function emptySaved(system, country) {
  return { version: SAVED_VERSION, system, gpa: null, counts: {}, board: "cambridge", aCounts: {}, asCounts: {}, country };
}

function cleanCounts(value, grades, most) {
  return Object.fromEntries(grades.filter((grade) => Number.isInteger(value?.[grade]) && value[grade] > 0 && value[grade] <= most).map((grade) => [grade, value[grade]]));
}

// Keeping only saved values that still make sense, so damaged data can never break the tool
function cleanSaved(value, codes, data) {
  if (!value || value.version !== SAVED_VERSION || !["hsc", "alevel"].includes(value.system)) {
    return null;
  }
  const clean = emptySaved(value.system, codes.includes(value.country) ? value.country : codes[0]);
  clean.gpa = typeof value.gpa === "number" && value.gpa >= GPA_LOWEST && value.gpa <= data.hsc.gpaMax ? value.gpa : null;
  clean.counts = cleanCounts(value.counts, data.hsc.bands.map(([grade]) => grade), HSC_SUBJECTS_MAX);
  clean.board = value.board === "edexcel" ? "edexcel" : "cambridge";
  clean.aCounts = cleanCounts(value.aCounts, data.alevel.grades, ALEVEL_MAX);
  clean.asCounts = cleanCounts(value.asCounts, data.alevel.asGrades, ALEVEL_MAX);
  return clean;
}

function points(value) {
  return value.toFixed(1);
}

// Wording a range so a single value is not written twice
function spread(low, high, write) {
  return write(low) === write(high) ? write(low) : `${write(low)} to ${write(high)}`;
}

// Wording a reading in letters, adding up the subjects that read the same: "A in 5 subjects, B or C in
// 1 subject", or "A in all 12 subjects", so a count is never read as part of a grade
function letterWords(read) {
  const totals = new Map();
  for (const item of read.letters) {
    const words = [...item.letters].sort((a, b) => LETTER_ORDER.indexOf(a) - LETTER_ORDER.indexOf(b)).join(" or ");
    totals.set(words, (totals.get(words) ?? 0) + item.count);
  }
  const groups = [...totals];
  if (groups.length === 1 && groups[0][1] > 1) {
    return `${groups[0][0]} in all ${groups[0][1]} subjects`;
  }
  return groups.map(([words, count]) => `${words} in ${count} ${count === 1 ? "subject" : "subjects"}`).join(", ");
}

export async function createTool(host) {
  const [data, countryList] = await Promise.all([host.fetchJson("tools/grades.json"), host.countries()]);
  const codes = countryList.map((item) => item.code);
  const state = { saved: null, list: new Set(), folds: new Set(), gpaText: "" };
  let body = null;
  let typing = 0;

  const saved = () => state.saved;
  const countryName = (code) => countryList.find((item) => item.code === code)?.name ?? code;
  const bandGrades = data.hsc.bands.map(([grade]) => grade);

  function fromPlan() {
    const plan = host.plan();
    const system = plan?.answers?.school?.system === "alevel" ? "alevel" : "hsc";
    return emptySaved(system, codes.includes(plan?.code) ? plan.code : codes[0]);
  }

  async function loadList() {
    const list = await host.readData(`roadmap.list.${saved().country}`);
    state.list = new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  }

  function save() {
    host.save(SAVE_KEY, state.saved);
  }

  function results() {
    const s = saved();
    return { gpa: s.gpa, counts: s.counts, board: s.board, aCounts: s.aCounts, asCounts: s.asCounts };
  }

  function countStepper(field, grade, value, about) {
    return stepper({ field, value, min: 0, max: field.startsWith("count.") ? HSC_SUBJECTS_MAX : ALEVEL_MAX, step: 1, label: grade, about, inline: true });
  }

  function hscCountsBody() {
    const s = saved();
    return `${bandGrades.map((grade) => countStepper(`count.${grade}`, grade, s.counts[grade] ?? 0, "Subjects at")).join("")}
      <p class="note">Count each compulsory subject on your mark sheet once. Universities may count subjects differently, so treat the result as a guide.</p>`;
  }

  function asBody() {
    const s = saved();
    return `${data.alevel.asGrades.map((grade) => countStepper(`as.${grade}`, grade, s.asCounts[grade] ?? 0, "AS levels at")).join("")}
      <p class="note">AS levels count towards New Zealand's tariff for Cambridge International.</p>`;
  }

  function countsSummary(counts, one, many, empty) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    return total === 0 ? empty : `${total} ${total === 1 ? one : many}`;
  }

  const FOLDS = {
    subjects: { title: "Your subject grades", summary: () => countsSummary(saved().counts, "subject", "subjects", "Optional, for your average marks and the US scale"), body: hscCountsBody },
    as: { title: "AS levels", summary: () => countsSummary(saved().asCounts, "AS level", "AS levels", "Optional, for New Zealand's tariff"), body: asBody },
  };

  function foldHtml(id) {
    const part = FOLDS[id];
    return fold({ id, title: part.title, summary: esc(part.summary()), open: state.folds.has(id), body: part.body });
  }

  function controlsHtml() {
    const s = saved();
    const parts = [chips("system", Object.entries(data.systems), s.system, "Your school results")];
    if (s.system === "hsc") {
      parts.push(numberField({ field: "gpa", value: state.gpaText || (s.gpa === null ? "" : s.gpa.toFixed(2)), label: "Your HSC GPA, as printed", placeholder: "4.83", note: "Out of 5. Leave it empty until your results are out." }));
      parts.push(`<p class="note tool-field-error" id="grades-gpa-error" aria-live="polite"></p>`);
      parts.push(foldHtml("subjects"));
    } else {
      parts.push(chips("board", Object.entries(data.boards), s.board, "Exam board"));
      parts.push(`<div class="tool-field"><p class="field-label">A level grades</p>${data.alevel.grades.map((grade) => countStepper(`a.${grade}`, grade, s.aCounts[grade] ?? 0, "A levels at")).join("")}</div>`);
      parts.push(foldHtml("as"));
    }
    return parts.join("");
  }

  // Placing HSC results on the scales universities publish: average marks from the grade bands, and
  // the readings Texas State and Western Kentucky publish
  function hscReading() {
    const s = saved();
    const range = percentRange(s.counts, data.hsc.bands);
    const head = s.gpa !== null ? `<p class="tool-answer">GPA <strong>${esc(s.gpa.toFixed(2))}</strong> out of ${data.hsc.gpaMax}.</p>` : "";
    if (!range) {
      return `${head}<p class="${head ? "note" : "tool-empty"}">Add your subject grades to see your average marks and the US 4.0 scale. A GPA alone cannot tell Pathway each subject's marks.</p>`;
    }
    const rows = [`<div><dt>Average marks</dt><dd>${withInfo(esc(spread(range.low, range.high, (value) => `${Math.round(value)}%`)), [data.hsc.cite])}</dd></div>`];
    for (const reading of data.readings) {
      const read = readWith(reading, s.counts, data.hsc.bands);
      const value = read.points ? `${spread(read.points.low, read.points.high, points)} on the US 4.0 scale` : letterWords(read);
      rows.push(`<div><dt>${esc(reading.name)}</dt><dd>${withInfo(esc(value), [reading.cite])}</dd></div>`);
    }
    rows.push(`<div><dt>UK and ECTS</dt><dd class="is-plain">None for school results</dd></div>`);
    return `${head}<dl class="tool-sums">${rows.join("")}</dl><p class="note">${esc(APPROXIMATE)}</p><p class="note">${esc(data.unsupported)}</p>`;
  }

  function alevelReading() {
    const s = saved();
    const best = bestGrades(s.aCounts, data.alevel.grades);
    if (best.length === 0) {
      return `<p class="tool-empty">Add your A level grades to see where they stand.</p>`;
    }
    const rows = [];
    if (s.board === "cambridge") {
      const tariff = tariffPoints(s.aCounts, s.asCounts, data.alevel);
      rows.push(`<div><dt>New Zealand tariff</dt><dd>${withInfo(`Up to ${tariff.counted} points`, [data.alevel.tariff.cite, data.alevel.units.cite])}</dd></div>`);
    }
    rows.push(`<div><dt>US 4.0 scale</dt><dd class="is-plain">No published method</dd></div>`);
    rows.push(`<div><dt>UK and ECTS</dt><dd class="is-plain">None for school results</dd></div>`);
    const tariffNote = s.board === "cambridge" ? " The tariff counts your best six units, as Victoria does; each university counts its own way." : "";
    return `<p class="tool-answer">Your best ${best.length === 1 ? "grade" : best.length >= 3 ? "three" : "two"}: <strong>${esc(best.slice(0, 3).join(""))}</strong>.</p>
      <dl class="tool-sums">${rows.join("")}</dl>
      <p class="note">${esc(APPROXIMATE)}${esc(tariffNote)}</p>
      <p class="note">${esc(data.unsupported)}</p>`;
  }

  function verdictOf(rule) {
    const s = saved();
    if (s.system === "hsc") {
      return rule.hsc ? { ...hscVerdict(rule.hsc, results(), data), notes: [rule.hsc.note].filter(Boolean) } : null;
    }
    return rule.alevel ? alevelVerdict(rule.alevel, results(), data) : null;
  }

  // Quoting the rule itself where there is nothing to compare, such as results that are not accepted
  function quoteOf(rule) {
    const own = saved().system === "hsc" ? rule.hsc : rule.alevel?.find((one) => one.boards.includes(saved().board));
    return own?.quote ? `"${own.quote.charAt(0).toUpperCase()}${own.quote.slice(1).replace(/\.$/, "")}."` : "";
  }

  function verdictRow(rule, result, mine) {
    const [words, shape] = STATES[result.state];
    const lines = result.words.length > 0 ? result.words : ["no", "sat", "open"].includes(result.state) ? [quoteOf(rule)] : [];
    return `<li class="verdict-row is-${result.state}">
      <div class="verdict-head"><p class="verdict-name">${esc(rule.name)}<span class="verdict-for">${esc(rule.for)}</span>${mine ? `<span class="visually-hidden">, on your list</span>` : ""}</p>
        <span class="verdict-side"><span class="verdict-tag">${shape ? icon(shape, " is-small") : ""}${esc(words)}</span>${infoButton(rule.cite.concat(...(rule.alevel ?? []).map((one) => one.cite ?? [])))}</span></div>
      ${lines.length > 0 ? `<ul class="verdict-reasons">${lines.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
      ${(result.notes ?? []).map((note) => `<p class="note">${esc(note)}</p>`).join("")}
    </li>`;
  }

  function verdictsHtml() {
    const s = saved();
    const code = s.country;
    const checked = data.rules.filter((rule) => rule.country === code).map((rule) => ({ rule, result: verdictOf(rule) })).filter((item) => item.result);
    if (code === "us") {
      return `<p class="tool-line">US universities read your whole record, and Pathway's sources give no minimum grades for them.</p>
        <p class="tool-line">${withInfo("On the Common App, if your school's GPA scale is not among the options, leave the GPA field blank and explain your school's grading in Additional Information.", ["us/app.commonApp.gpa"])}</p>`;
    }
    if (checked.length === 0) {
      return `<p class="note">Pathway has no rules for ${esc(data.systems[s.system])} in ${esc(countryName(code))} yet.</p>`;
    }
    const mine = checked.filter((item) => item.rule.key && state.list.has(item.rule.key));
    const others = checked.filter((item) => !mine.includes(item));
    const group = (title, items, onList) => (items.length === 0 ? "" : `<p class="verdict-group">${esc(title)}</p><ul class="verdict-list">${items.map((item) => verdictRow(item.rule, item.result, onList)).join("")}</ul>`);
    return `${group("On your list", mine, true)}${group(mine.length > 0 ? "Others on Pathway" : `In ${countryName(code)} on Pathway`, others, false)}
      <p class="note">Meeting a minimum makes you eligible to apply; it does not promise a place.</p>`;
  }

  function readingHtml() {
    return saved().system === "hsc" ? hscReading() : alevelReading();
  }

  function render() {
    const s = saved();
    body.innerHTML = `<p class="lead tool-lead">See how universities read your school results, and where you stand against their rules.</p>
      <div class="tool-controls" id="grades-controls">${controlsHtml()}</div>
      <div class="tool-result" id="grades-reading" aria-live="polite">${readingHtml()}</div>
      <h3 class="tool-heading">What universities ask for</h3>
      ${chips("country", countryList.map((item) => [item.code, item.name]), s.country, "Country")}
      <div class="tool-stack" id="grades-verdicts">${verdictsHtml()}</div>`;
  }

  function renderAnswers() {
    body.querySelector("#grades-reading").innerHTML = readingHtml();
    body.querySelector("#grades-verdicts").innerHTML = verdictsHtml();
    for (const id of Object.keys(FOLDS)) {
      const summary = body.querySelector(`.tool-fold[data-fold="${id}"] .tool-fold-summary`);
      if (summary) {
        summary.textContent = FOLDS[id].summary();
      }
    }
  }

  // Finding where a count lives: HSC subjects, A levels or AS levels
  function countsOf(field) {
    const s = saved();
    const [kind, grade] = [field.slice(0, field.indexOf(".")), field.slice(field.indexOf(".") + 1)];
    return { holder: kind === "count" ? s.counts : kind === "a" ? s.aCounts : s.asCounts, grade, max: kind === "count" ? HSC_SUBJECTS_MAX : ALEVEL_MAX };
  }

  return {
    async mount(element) {
      body = element;
      state.saved = cleanSaved(await host.readData(SAVE_KEY), codes, data) ?? fromPlan();
      await loadList();
      render();
    },
    async click(trigger) {
      const { action, field, value } = trigger.dataset;
      const s = saved();
      switch (action) {
        case "tool-pick":
          if (field === "country") {
            s.country = value;
            await loadList();
          } else {
            s[field] = value;
          }
          save();
          render();
          body.querySelector(`[data-action="tool-pick"][data-field="${CSS.escape(field)}"][data-value="${CSS.escape(value)}"]`)?.focus({ preventScroll: true });
          break;
        case "tool-step": {
          const { holder, grade, max } = countsOf(field);
          const limits = { min: 0, max, step: 1 };
          const next = stepValue(holder[grade] ?? 0, Number(trigger.dataset.delta), limits);
          if (next === 0) {
            delete holder[grade];
          } else {
            holder[grade] = next;
          }
          save();
          updateStepper(body, field, next, limits, trigger);
          renderAnswers();
          break;
        }
        case "tool-fold": {
          const id = trigger.dataset.fold;
          const opening = !state.folds.has(id);
          if (opening) {
            state.folds.add(id);
          } else {
            state.folds.delete(id);
          }
          toggleFold(body, id, opening, FOLDS[id].body);
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
      if (event.target.dataset?.field !== "gpa") {
        return;
      }
      state.gpaText = event.target.value;
      const number = readNumber(event.target.value);
      const valid = number !== null && number >= GPA_LOWEST && number <= data.hsc.gpaMax;
      saved().gpa = valid ? number : null;
      const error = body.querySelector("#grades-gpa-error");
      error.textContent = event.target.value.trim() !== "" && !valid ? `A GPA as printed is between ${GPA_LOWEST.toFixed(2)} and ${data.hsc.gpaMax.toFixed(2)}.` : "";
      save();
      window.clearTimeout(typing);
      typing = window.setTimeout(renderAnswers, TYPING_PAUSE);
    },
    async refresh() {
      await loadList();
      renderAnswers();
    },
    leave() {
      window.clearTimeout(typing);
    },
  };
}
