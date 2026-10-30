// Checking an English score: where it stands on the other tests' scales and the CEFR, from the test
// owners' own tables, and what each university on Pathway asks for. Every verdict comes from the score
// the student holds, never from a comparison
import { addMonths, formatMonth, isoMonth, readDate, today as phoneToday } from "../../app/dates.js";
import { moneyText, takaText } from "../../app/money.js";
import { fillText, rateOf, sumOf } from "../roadmaps/inserts.js";
import { esc } from "../timeline/words.js";
import { chips, fold, icon, infoButton, stepper, stepValue, toggleFold, updateStepper, withInfo } from "../toolkit/parts.js";
import { SECTIONS, comparableOf, comparisons, overallRange, scaleOf, scoreProblem, scoreText, sectionScaleOf, verdict } from "./check.js";

const SAVE_KEY = "tool.english";
const SAVED_VERSION = 1;
const TEST_IDS = ["ielts", "toefl", "pte", "duolingo"];
const SECTION_WORDS = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };
// Naming each verdict in words, with a shape beside it, so its meaning never rests on colour
const STATES = {
  meets: ["Meets", "tick"], below: ["Below", "minus"], no: ["Not accepted", "close"], ask: ["Ask them", ""],
  needs: ["Add sections", ""], open: ["No set minimum", ""], noTest: ["No test needed", "tick"],
};
const APPROXIMATE = "An approximate comparison, for your own understanding. Universities always use your real results or the test you actually took.";
const COMPARABLE_NOTE = "Optional. Reports until January 2028 show it. Without it, Pathway uses the middle of the range your overall matches, as ETS does.";
const MONTH_FORMAT = /^\d{4}-\d{2}$/;

function emptySaved(test, country) {
  return { version: SAVED_VERSION, test, scale: "new", overall: null, sections: {}, lowest: null, comparable: null, taken: "", country };
}

function upperFirst(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Quoting the words of the rule itself where there is no score to compare, such as a test not accepted
function quoteOf(rule, test) {
  const quote = rule.noTest ?? rule.tests?.[test]?.quote ?? "";
  return quote ? `"${quote.charAt(0).toUpperCase()}${quote.slice(1).replace(/\.$/, "")}."` : "";
}

function isScore(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Keeping only saved values that still make sense, so damaged data can never break the tool
function cleanSaved(value, codes) {
  if (!value || value.version !== SAVED_VERSION || !TEST_IDS.includes(value.test)) {
    return null;
  }
  const clean = emptySaved(value.test, codes.includes(value.country) ? value.country : codes[0]);
  clean.scale = value.scale === "old" ? "old" : "new";
  clean.overall = isScore(value.overall) ? value.overall : null;
  clean.sections = Object.fromEntries(SECTIONS.filter((name) => isScore(value.sections?.[name])).map((name) => [name, value.sections[name]]));
  clean.lowest = isScore(value.lowest) ? value.lowest : null;
  clean.comparable = isScore(value.comparable) ? value.comparable : null;
  clean.taken = MONTH_FORMAT.test(value.taken ?? "") ? value.taken : "";
  return clean;
}

export async function createTool(host) {
  const [data, facts, countryList] = await Promise.all([host.fetchJson("tools/english.json"), host.facts(), host.countries()]);
  const codes = countryList.map((item) => item.code);
  const state = { saved: null, list: new Set(), folds: new Set() };
  let body = null;

  const saved = () => state.saved;
  const test = () => data.tests[saved().test];
  const countryName = (code) => countryList.find((item) => item.code === code)?.name ?? code;

  // Starting from the score in the student's plan, when the plan holds one and nothing is saved yet
  function fromPlan() {
    const plan = host.plan();
    const english = plan?.answers?.english;
    const country = codes.includes(plan?.code) ? plan.code : codes[0];
    const chosen = TEST_IDS.includes(english?.test) ? english.test : "ielts";
    const fresh = emptySaved(chosen, country);
    if (english?.status === "score" && isScore(english.score)) {
      fresh.overall = english.score;
      fresh.taken = MONTH_FORMAT.test(english.taken ?? "") ? english.taken : "";
    }
    return fresh;
  }

  async function loadList() {
    const list = await host.readData(`roadmap.list.${saved().country}`);
    state.list = new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  }

  function save() {
    host.save(SAVE_KEY, state.saved);
  }

  function score() {
    const s = saved();
    return {
      test: s.test, scale: s.scale, overall: s.overall,
      sections: s.sections, comparable: s.test === "toefl" && s.scale === "new" ? s.comparable : null,
      ...(s.test === "duolingo" ? { lowest: s.lowest } : {}),
    };
  }

  function scoreControls() {
    const s = saved();
    const t = test();
    const scale = scaleOf(t, s);
    const parts = [chips("test", TEST_IDS.map((id) => [id, data.tests[id].name]), s.test, "Your test")];
    if (t.scales) {
      parts.push(chips("scale", Object.entries(t.scales).map(([id, one]) => [id, one.label]), s.scale, "The scale on your score report"));
    }
    parts.push(stepper({ field: "overall", value: s.overall, ...scale, label: "Overall score" }));
    if (t.scales && s.scale === "new") {
      parts.push(stepper({ field: "comparable", value: s.comparable, ...t.scales.old, label: "The 0 to 120 score on your report", note: COMPARABLE_NOTE, inline: true }));
    }
    return parts.join("");
  }

  function sectionsBody() {
    const s = saved();
    const t = test();
    const scale = sectionScaleOf(t, s);
    if (t.lowest) {
      return `${stepper({ field: "lowest", value: s.lowest, ...scale, label: "Your lowest subscore", inline: true })}
        <p class="note">Some universities set a minimum for every subscore, so your lowest one is enough.</p>`;
    }
    const any = SECTIONS.some((name) => isScore(s.sections[name]));
    return `${SECTIONS.map((name) => stepper({ field: `section.${name}`, value: s.sections[name] ?? null, ...scale, label: SECTION_WORDS[name], about: t.name, inline: true })).join("")}
      ${any ? `<button class="text-button" type="button" data-action="tool-clear-sections">Clear section scores</button>` : ""}`;
  }

  // Finding a problem with the scores entered, such as four bands that cannot give the overall
  function problem() {
    return scoreProblem(score(), data);
  }

  // Judging scores only when they can all be on one report, so no verdict rests on a typing slip
  function canJudge() {
    return isScore(saved().overall) && problem()?.state !== "wrong";
  }

  function sectionsSummary() {
    const s = saved();
    const misfit = problem()?.state === "wrong" && problem().about === "sections";
    if (test().lowest) {
      return !isScore(s.lowest) ? "Optional, for subscore minimums" : `Lowest subscore ${s.lowest}${misfit ? ", which does not fit your overall" : ""}`;
    }
    const count = SECTIONS.filter((name) => isScore(s.sections[name])).length;
    return count === 0 ? "Optional, for section minimums" : `${count} of 4 added${misfit ? `, which do${count === 1 ? "es" : ""} not fit your overall` : ""}`;
  }

  // Saying until when the score can be used, counting two years from the month it was taken
  function validityLine() {
    const s = saved();
    if (!s.taken) {
      return "";
    }
    const validity = facts.fact(test().validity).value.max;
    const until = addMonths(readDate(s.taken).first, validity * 12);
    const passed = until <= phoneToday();
    return `<p class="tool-line">${passed
      ? `Taken in ${esc(formatMonth(readDate(s.taken).first))}, so most universities no longer accept it.`
      : `Most universities accept it until about <strong>${esc(formatMonth(until))}</strong>.`}</p>
      ${passed ? "" : `<p class="note">${withInfo("Some count two years back from when you start, so check each.", [test().validity])}</p>`}`;
  }

  function fixButton(words) {
    return `<button class="button-secondary is-compact" type="button" data-action="tool-fix">${esc(words)}</button>`;
  }

  // Saying what does not fit, why, and what to check, with one tap to put it right where there is one
  function problemHtml(found) {
    const [first, ...rest] = found.lines;
    return `<div class="tool-alert">${found.state === "wrong" ? `<p class="tool-answer">These scores do not fit together.</p>` : ""}
      <p class="tool-line">${withInfo(esc(first), found.cite)}</p>
      ${rest.map((line) => `<p class="tool-line">${esc(line)}</p>`).join("")}
      ${found.fix ? fixButton(found.fix.words) : ""}</div>`;
  }

  // Offering the overall score that all four sections give, before the student sets one
  function suggestionHtml() {
    const range = overallRange(score(), data);
    if (!range?.exact) {
      return `<p class="tool-empty">Set your overall score to see where it stands.</p>`;
    }
    const value = scoreText(range.from, scaleOf(test(), saved()).digits);
    const plural = test().sectionWord === "band" ? "bands" : "section scores";
    return `<p class="tool-empty">${range.kind === "sum" ? `Your four ${plural} add up to ${value}.` : `Your four ${plural} give an overall of ${value}.`}</p>
      ${fixButton(`Use ${value} as my overall`)}`;
  }

  function resultHtml() {
    const s = saved();
    if (!isScore(s.overall)) {
      return suggestionHtml();
    }
    const found = problem();
    if (found?.state === "wrong") {
      return problemHtml(found);
    }
    const { level, lines } = comparisons(score(), data);
    const cites = [...new Set([level?.cite, ...lines.map((line) => line.cite)].filter(Boolean))];
    const headline = level?.level
      ? `About <strong>${esc(level.level)}</strong> on the CEFR${level.border ? `, on the border with ${esc(level.border)}` : ""}.`
      : "Your score is outside the comparison tables.";
    return `${found ? problemHtml(found) : ""}<p class="tool-answer">${headline}</p>
      ${lines.length > 0 ? `<dl class="tool-sums english-compare">${lines.map((line) => `<div><dt>${esc(line.test)}</dt><dd>${esc(line.words)} <span class="soft">(${esc(line.by)})</span></dd></div>`).join("")}</dl>` : ""}
      <p class="note">${withInfo(esc(APPROXIMATE), cites)}</p>
      ${validityLine()}`;
  }

  function rulesFor(code) {
    const rules = data.rules.filter((rule) => rule.country === code);
    const mine = rules.filter((rule) => rule.key && state.list.has(rule.key));
    return { mine, others: rules.filter((rule) => !mine.includes(rule)) };
  }

  function verdictRow(rule, mine) {
    const result = canJudge() ? verdict(rule, score(), data) : null;
    const [words, shape] = result ? STATES[result.state] : ["", ""];
    const reasons = !result ? [] : result.parts.length > 0
      ? result.parts.filter((part) => part.state !== "meets" || result.state === "meets").map((part) => part.words)
      : [quoteOf(rule, saved().test)].filter(Boolean);
    return `<li class="verdict-row${result ? ` is-${result.state}` : ""}">
      <div class="verdict-head"><p class="verdict-name">${esc(rule.name)}${mine ? `<span class="visually-hidden">, on your list</span>` : ""}</p>
        <span class="verdict-side">${result ? `<span class="verdict-tag">${shape ? icon(shape, " is-small") : ""}${esc(words)}</span>` : ""}${infoButton(rule.cite)}</span></div>
      ${reasons.length > 0 ? `<ul class="verdict-reasons">${reasons.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
      ${rule.note ? `<p class="note">${esc(rule.note)}</p>` : ""}
    </li>`;
  }

  function verdictsHtml() {
    const code = saved().country;
    const { mine, others } = rulesFor(code);
    if (mine.length + others.length === 0) {
      return `<p class="note">Pathway has no English rules for ${esc(countryName(code))} yet.</p>`;
    }
    const lead = canJudge() ? "" : `<p class="note">${isScore(saved().overall) ? "Fix the scores above to see a verdict for each." : "Set your overall score to see a verdict for each."}</p>`;
    const group = (title, rules, onList) => (rules.length === 0 ? "" : `<p class="verdict-group">${esc(title)}</p><ul class="verdict-list">${rules.map((rule) => verdictRow(rule, onList)).join("")}</ul>`);
    return `${lead}${group("On your list", mine, true)}${group(mine.length > 0 ? "Others on Pathway" : `In ${countryName(code)} on Pathway`, others, false)}
      <p class="note">Only universities whose English rule Pathway has checked are shown. Verdicts compare your own score with each rule.</p>`;
  }

  function feeWords(t) {
    const { amount, currency } = sumOf(facts, t.fee);
    const money = currency === "BDT" ? takaText(amount) : `${moneyText(currency, amount)} (about ${takaText(amount * rateOf(facts, currency).rate)})`;
    return t.feeNote ? `${money}, ${t.feeNote}` : money;
  }

  // Comparing the four tests on what a student in Bangladesh pays, brings and waits for, and on how
  // many of the country's universities on Pathway list each one
  function fitBody() {
    const code = saved().country;
    const rules = data.rules.filter((rule) => rule.country === code && !rule.noTest);
    const ctx = { facts, today: host.today(), cycle: data.cycle };
    return `<ul class="english-fit">${TEST_IDS.map((id) => {
      const t = data.tests[id];
      const listed = rules.filter((rule) => rule.tests?.[id] && rule.tests[id].accepted !== false).length;
      return `<li class="english-fit-test"><p class="english-fit-name">${esc(t.name)}</p>
        <dl class="tool-sums">
          <div><dt>Fee</dt><dd>${withInfo(esc(feeWords(t)), [t.fee.split("#")[0]])}</dd></div>
          <div><dt>ID in Bangladesh</dt><dd>${withInfo(esc(t.idWords), [t.id])}</dd></div>
          <div><dt>Result</dt><dd>${esc(upperFirst(fillText(`{duration:${t.results}}`, ctx)))}</dd></div>
          <div><dt>Valid for</dt><dd>${esc(upperFirst(fillText(`{duration:${t.validity}}`, ctx)))}</dd></div>
          ${rules.length > 0 ? `<div><dt>In ${esc(countryName(code))}</dt><dd>Listed by ${listed} of the ${rules.length} on Pathway</dd></div>` : ""}
        </dl></li>`;
    }).join("")}</ul>`;
  }

  const FOLDS = {
    sections: { title: "Section scores", summary: () => sectionsSummary(), body: sectionsBody },
    fit: { title: "Which test fits you?", summary: () => "Fees, ID and results time for each test", body: fitBody },
  };

  function foldHtml(id) {
    const part = FOLDS[id];
    return fold({ id, title: part.title, summary: esc(part.summary()), open: state.folds.has(id), body: part.body });
  }

  function render() {
    const s = saved();
    body.innerHTML = `<p class="lead tool-lead">See where your English score stands, and what each university on Pathway asks for.</p>
      <div class="tool-controls">${scoreControls()}</div>
      ${foldHtml("sections")}
      <label class="date-field tool-field"><span class="field-label">The month you took it</span><input type="month" data-field="taken" value="${esc(s.taken)}" max="${esc(isoMonth(host.today()))}"><span class="note">Optional, to see until when it can be used.</span></label>
      <div class="tool-result" id="english-result" aria-live="polite">${resultHtml()}</div>
      <h3 class="tool-heading">What universities ask for</h3>
      ${chips("country", countryList.map((item) => [item.code, item.name]), s.country, "Country")}
      <div class="tool-stack" id="english-verdicts">${verdictsHtml()}</div>
      ${foldHtml("fit")}`;
  }

  // Redrawing the answers after a change, leaving the controls in place so focus stays put
  function renderAnswers() {
    body.querySelector("#english-result").innerHTML = resultHtml();
    body.querySelector("#english-verdicts").innerHTML = verdictsHtml();
    const summary = body.querySelector('.tool-fold[data-fold="sections"] .tool-fold-summary');
    if (summary) {
      summary.textContent = sectionsSummary();
    }
    const fit = body.querySelector('.tool-fold[data-fold="fit"] .tool-fold-body');
    if (fit) {
      fit.innerHTML = fitBody();
    }
  }

  // Reading a stepper's limits. The first tap on a score not yet set starts it where it most likely is:
  // an overall at what the four sections give, a section or the 0 to 120 score at what the overall
  // suggests, so the first number shown already fits
  function limitsOf(field) {
    const s = saved();
    const t = test();
    if (field === "overall") {
      const range = overallRange(score(), data);
      const scale = scaleOf(t, s);
      return range?.exact ? { ...scale, start: range.from } : scale;
    }
    if (field === "comparable") {
      return isScore(s.overall) ? { ...t.scales.old, start: comparableOf(s.overall, data.compare.toeflOld.rows)[0] } : t.scales.old;
    }
    const scale = sectionScaleOf(t, s);
    if (!isScore(s.overall)) {
      return scale;
    }
    const near = t.scales && s.scale === "old" ? Math.round(s.overall / SECTIONS.length) : s.overall;
    return { ...scale, start: Math.min(scale.max, Math.max(scale.min, near)) };
  }

  function readField(field) {
    const s = saved();
    if (field.startsWith("section.")) {
      return s.sections[field.slice("section.".length)] ?? null;
    }
    return s[field];
  }

  function writeField(field, value) {
    const s = saved();
    if (field.startsWith("section.")) {
      s.sections[field.slice("section.".length)] = value;
    } else {
      s[field] = value;
    }
  }

  function redraw(focusSelector) {
    render();
    if (focusSelector) {
      body.querySelector(focusSelector)?.focus({ preventScroll: true });
    }
  }

  return {
    async mount(element) {
      body = element;
      state.saved = cleanSaved(await host.readData(SAVE_KEY), codes) ?? fromPlan();
      await loadList();
      render();
    },
    async click(trigger) {
      const { action, field, value } = trigger.dataset;
      const s = saved();
      switch (action) {
        case "tool-pick":
          if (field === "test" && value !== s.test) {
            // Starting a new test from a clean slate, since its scale and sections differ
            Object.assign(s, { test: value, scale: "new", overall: null, sections: {}, lowest: null, comparable: null });
          } else if (field === "scale" && value !== s.scale) {
            Object.assign(s, { scale: value, overall: null, sections: {}, comparable: null });
          } else if (field === "country") {
            s.country = value;
            await loadList();
          }
          save();
          redraw(`[data-action="tool-pick"][data-field="${CSS.escape(field)}"][data-value="${CSS.escape(value)}"]`);
          break;
        case "tool-step": {
          const limits = limitsOf(field);
          const next = stepValue(readField(field), Number(trigger.dataset.delta), limits);
          writeField(field, next);
          save();
          updateStepper(body, field, next, limits, trigger);
          renderAnswers();
          break;
        }
        case "tool-fix": {
          // Putting right what the check found: using the overall the sections give, or clearing a
          // 0 to 120 score that cannot be on the same report
          const found = problem();
          const fix = found?.fix ?? (!isScore(s.overall) && overallRange(score(), data)?.exact ? { field: "overall", value: overallRange(score(), data).from } : null);
          if (!fix) {
            break;
          }
          writeField(fix.field, fix.value);
          save();
          updateStepper(body, fix.field, fix.value, limitsOf(fix.field));
          renderAnswers();
          body.querySelector(`[data-action="tool-step"][data-field="${fix.field}"][data-delta="1"]`)?.focus({ preventScroll: true });
          break;
        }
        case "tool-clear-sections": {
          s.sections = {};
          save();
          const holder = body.querySelector('.tool-fold[data-fold="sections"] .tool-fold-body');
          if (holder) {
            holder.innerHTML = sectionsBody();
          }
          renderAnswers();
          body.querySelector('[data-action="tool-step"][data-field="section.listening"][data-delta="1"]')?.focus({ preventScroll: true });
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
      if (event.target.dataset?.field !== "taken") {
        return;
      }
      const text = event.target.value;
      saved().taken = MONTH_FORMAT.test(text) ? text : "";
      save();
      renderAnswers();
    },
    async refresh() {
      await loadList();
      renderAnswers();
    },
    leave() { },
  };
}
