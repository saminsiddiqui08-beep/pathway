// Drawing the questions that build a plan, one per screen, and reading taps into the draft.
// timeline.js decides which questions to ask and saves the answers
import { isoDay, partsFromDay, readDay } from "../../app/dates.js";
import { dateWords, esc, intakeName, TEST_NAMES } from "./words.js";

// Asking about school before the intake, because the intakes offered depend on the school system
export const ALL_QUESTIONS = ["country", "school", "intake", "english", "sat", "tier", "aid", "passport"];
// Limiting how far ahead a booked test may be, in days. timeline.js uses the same limit for "Already booked?"
export const BOOKED_AHEAD_DAYS = 730;

const SCALES = {
  ielts: { min: 1, max: 9, step: 0.5, digits: 1, start: 6.5, help: "IELTS scores run from 1 to 9 in steps of 0.5." },
  toefl: { min: 1, max: 6, step: 0.5, digits: 1, start: 4.5, help: "TOEFL scores run from 1 to 6 in steps of 0.5, its scale since January 2026." },
  duolingo: { min: 10, max: 160, step: 5, digits: 0, start: 115, help: "Duolingo scores run from 10 to 160 in steps of 5." },
  pte: { min: 10, max: 90, step: 1, digits: 0, start: 60, help: "PTE scores run from 10 to 90." },
};
const SAT_SCALE = { min: 400, max: 1600, step: 10, digits: 0, start: 1200, help: "SAT scores run from 400 to 1600 in steps of 10." };

const WHY_INTAKE = {
  us: "Most students in the USA begin in August, so Pathway plans for that intake.",
  fi: "Most students in Finland begin in late August, so Pathway plans for that intake.",
  tr: "Universities in Türkiye begin in late September, so Pathway plans for that intake.",
  my: "Malaysian universities set their own intakes, so choose the month you want to start.",
  nz: "New Zealand's academic year begins in March, so Pathway plans for Semester One.",
};
const WHY_INTAKE_FOUNDATION = {
  my: "With the HSC, Pathway plans a foundation year first, so choose the month it starts.",
  nz: "With the HSC, Pathway plans a foundation programme first. The year shown is when your degree begins.",
};
// Saying where a student can go without an English test, so "Not needed" is never a guess
const WAIVER_HELP = {
  us: "Harvard and Bowdoin need no English test, and several universities waive it after English-medium schooling. Check each of your universities' rules before you choose this.",
  fi: "On the SAT route, Helsinki, Aalto, Turku, Tampere, Oulu and Jyväskylä's business programme need no separate English test. Universities of applied sciences and LUT do, so their routes are left out.",
};
const WHY_SAT = {
  us: "Many US universities accept the SAT, and a good score can help.",
  fi: "Finnish universities can admit on an SAT score alone, which brings results earlier.",
  tr: "METU accepts the SAT when school results come too late.",
};

export function questionsFor(plan) {
  return ALL_QUESTIONS.filter((key) => key !== "sat" || Boolean(plan?.asksSat));
}

// Checking whether a question has a complete answer in the draft. ctx says whether this country
// offers "Not needed" for English and which English tests it accepts
export function answered(key, draft, today, ctx = {}) {
  switch (key) {
    case "country":
      return Boolean(draft.country);
    case "start":
      return draft.startChoice === "reuse" || draft.startChoice === "fresh";
    case "school":
      return Boolean(draft.school?.system && Number.isInteger(draft.school?.year));
    case "intake":
      return Boolean(draft.intake && (draft.intake.soonest || draft.intake.cycle || draft.intake.month));
    case "english": {
      const english = draft.english;
      if (!english?.status) {
        return false;
      }
      if (english.status === "waived") {
        return Boolean(ctx.englishWaiver);
      }
      if (english.test && ctx.englishTests && !ctx.englishTests.includes(english.test)) {
        return false;
      }
      if (english.status === "booked") {
        return Boolean(english.test) && validTestDate(english.date, today);
      }
      return english.status === "none" || (Boolean(english.test) && typeof english.score === "number" && validTakenMonth(english.taken, today));
    }
    case "sat": {
      const sat = draft.sat;
      if (!sat?.status) {
        return false;
      }
      if (sat.status === "booked") {
        return validTestDate(sat.date, today);
      }
      return sat.status !== "score" || typeof sat.score === "number";
    }
    default:
      return Boolean(draft[key]);
  }
}

// Accepting a score month from this month back to ten years ago
function validTakenMonth(text, today) {
  if (typeof text !== "string" || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return false;
  }
  const { year, month } = partsFromDay(today);
  const asked = Number(text.slice(0, 4)) * 12 + Number(text.slice(5, 7));
  const now = year * 12 + month;
  return asked <= now && asked >= now - 120;
}

// Accepting a booking from today to two years ahead. A test already sat is entered as a score instead
function validTestDate(text, today) {
  let day;
  try {
    day = readDay(text);
  } catch {
    return false;
  }
  return day >= today && day <= today + BOOKED_AHEAD_DAYS;
}

function progressLine(questions, index, colour) {
  const count = questions.length;
  const stations = questions.map((key, i) => {
    const left = (i / (count - 1)) * 100;
    const state = i < index ? "done" : i === index ? "here" : "ahead";
    return `<span class="setup-station is-${state}" style="left: ${left}%"></span>`;
  });
  const reached = (index / (count - 1)) * 100;
  return `<div class="setup-line" aria-hidden="true" style="--route: ${colour}">
    <span class="setup-rail"></span><span class="setup-travelled" style="width: ${reached}%"></span>${stations.join("")}
  </div>`;
}

function option({ name, value, checked, label, note, colour }) {
  const style = colour ? ` style="--route: var(${colour})"` : "";
  return `<label class="choice"${style}>
    <input class="station-input" type="radio" name="${name}" value="${esc(value)}"${checked ? " checked" : ""} data-action="pick" data-field="${name}">
    <span class="station" aria-hidden="true"></span>
    <span class="option-text"><span class="option-label">${esc(label)}</span>${note ? `<span class="option-note">${esc(note)}</span>` : ""}</span>
  </label>`;
}

function segmented(name, label, choices, current) {
  return `<div class="segmented" role="radiogroup" aria-label="${esc(label)}">${choices
    .map(([value, text]) => `<button type="button" role="radio" aria-checked="${value === current}" data-action="pick" data-field="${name}" data-value="${esc(value)}">${esc(text)}</button>`)
    .join("")}</div>`;
}

function stepper(field, scale, value, label) {
  const shown = typeof value === "number" ? value : scale.start;
  return `<p class="field-label" id="${field}-label">${esc(label)}</p>
    <div class="stepper" role="group" aria-labelledby="${field}-label">
      <button type="button" class="stepper-button" data-action="step" data-field="${field}" data-delta="-1" aria-label="Lower by ${scale.step}"${shown <= scale.min ? " disabled" : ""}>
        <svg class="icon" aria-hidden="true"><use href="icons/sprite.svg#minus"></use></svg>
      </button>
      <output class="stepper-value" aria-live="polite">${shown.toFixed(scale.digits)}</output>
      <button type="button" class="stepper-button" data-action="step" data-field="${field}" data-delta="1" aria-label="Raise by ${scale.step}"${shown >= scale.max ? " disabled" : ""}>
        <svg class="icon" aria-hidden="true"><use href="icons/sprite.svg#plus"></use></svg>
      </button>
    </div>
    <p class="note">${esc(scale.help)}</p>`;
}

function dateField(field, value, today) {
  return `<label class="date-field">
    <span class="field-label">Test date</span>
    <input type="date" data-action="date" data-field="${field}" value="${esc(value ?? "")}" min="${isoDay(today)}" max="${isoDay(today + BOOKED_AHEAD_DAYS)}">
  </label>`;
}

// Naming each HSC year by the class a student is in now. A new school year starts in January, but
// class 11 starts only after the SSC, so from January until that year's HSC exams end there is one
// more class to name
function hscYears(ctx) {
  const firstAhead = ctx.firstHscYear;
  const beforeExams = partsFromDay(ctx.today).year === firstAhead;
  const notes = beforeExams
    ? ["Exams finished", "Class 12 now", "Class 11 now", "SSC this year", "Class 10 now", "Class 9 now"]
    : ["Exams finished", "Class 12 now", "Class 11 now", "Class 10 now", "Class 9 now"];
  return notes.map((note, index) => ({ year: firstAhead - 1 + index, note }));
}

export function schoolYears(system, ctx) {
  return system === "alevel" ? alevelYears(ctx) : system === "hsc" ? hscYears(ctx) : [];
}

function alevelYears(ctx) {
  const { year, month } = partsFromDay(ctx.today);
  // Counting this calendar year as the final one until the end of June, and next year after that
  const finalYear = month <= 6 ? year : year + 1;
  const notes = { [-1]: "Results out", 0: "Final year now", 1: "One more year after this one", 2: "Two more years", 3: "Three more years" };
  return [-1, 0, 1, 2, 3].map((offset) => ({ year: finalYear + offset, note: notes[offset] }));
}

function questionBody(key, draft, ctx) {
  const today = ctx.today;
  switch (key) {
    // Asking a student who starts a plan for a second country whether to keep the answers about them
    case "start": {
      const name = ctx.countries.find((country) => country.code === draft.country)?.name ?? "this country";
      const different = ctx.asksSat ? "when to start, the SAT and how competitive your universities are" : "when to start and how competitive your universities are";
      return {
        title: `How do you want to start your ${name} plan?`,
        why: "Your school, English test, financial aid and passport are about you, so Pathway uses the same answers for every country.",
        body: `<fieldset class="choices"><legend class="visually-hidden">How to start</legend>${[
          option({ name: "startChoice", value: "reuse", checked: draft.startChoice === "reuse", label: "Use my answers", note: `Answer only what is different for ${name}: ${different}` }),
          option({ name: "startChoice", value: "fresh", checked: draft.startChoice === "fresh", label: "Answer every question again", note: "Your new answers about you also update your other countries' plans" }),
        ].join("")}</fieldset>`,
      };
    }
    case "country":
      return {
        title: "Where do you want to study?",
        why: "Each country has its own deadlines, tests and visa steps. You can switch later, and each country keeps its own progress.",
        body: `<fieldset class="choices"><legend class="visually-hidden">Choose a country</legend>${ctx.countries
          .map((country) => option({ name: "country", value: country.code, checked: draft.country === country.code, label: country.name, colour: country.line }))
          .join("")}</fieldset>`,
      };
    case "school": {
      const system = draft.school?.system ?? null;
      const years = schoolYears(system, ctx);
      const series = system === "alevel"
        ? `<p class="field-label">Your final series</p>${segmented("session", "Your final A level series", [["summer", "May or June"], ["winter", "October or November"]], draft.school?.session ?? "summer")}`
        : "";
      return {
        title: "Where are you now?",
        why: "Your final exams decide when your results arrive, and some routes wait for them.",
        body: `${segmented("system", "Your school system", [["hsc", "HSC"], ["alevel", "A levels"]], system)}
          ${series}
          ${years.length > 0 ? `<fieldset class="choices"><legend class="visually-hidden">The year you finish school</legend>${years
            .map((item) => option({ name: "year", value: item.year, checked: draft.school?.year === item.year, label: `${system === "hsc" ? "HSC" : "A levels"} ${item.year}`, note: item.note }))
            .join("")}</fieldset>` : ""}`,
      };
    }
    case "intake": {
      const foundation = draft.school?.system === "hsc" && WHY_INTAKE_FOUNDATION[draft.country];
      const options = ctx.intakeOptions;
      const picked = draft.intake;
      const rows = options.map((item) => {
        const value = item.month ?? String(item.cycle);
        const checked = Boolean(picked && !picked.soonest && (picked.month ?? String(picked.cycle)) === value);
        return option({ name: "intake", value, checked, label: intakeName(draft.country, item), note: item.note });
      });
      rows.push(option({ name: "intake", value: "soonest", checked: Boolean(picked?.soonest), label: "The soonest I can make", note: "Pathway finds the first intake that fits your answers" }));
      return {
        title: "When do you want to start?",
        why: foundation || WHY_INTAKE[draft.country],
        body: options.length > 0
          ? `<fieldset class="choices is-intake"><legend class="visually-hidden">Choose your intake</legend>${rows.join("")}</fieldset>`
          : `<p class="lead">This version of Pathway has no intakes left to plan for this country. An update brings the next years' dates.</p>`,
      };
    }
    case "english": {
      const english = draft.english ?? {};
      // Showing no answer chosen where "Not needed" was given for a country that offers it
      const status = english.status === "waived" && !ctx.englishWaiver ? null : english.status ?? null;
      const test = english.test ?? null;
      const tests = Object.entries(TEST_NAMES).filter(([value]) => !ctx.englishTests || ctx.englishTests.includes(value));
      let detail = "";
      if (status === "none") {
        detail = `<p class="reading">Pathway will plan when to prepare for and take a test. It plans for IELTS unless you choose another.</p>`;
      }
      if (status === "waived") {
        detail = `<p class="reading">${esc(WAIVER_HELP[draft.country] ?? "")}</p>
          <p class="note">Pathway plans no English test for this country. Your plans for other countries still include one where it is needed.</p>`;
      }
      if (status && status !== "waived") {
        detail += `<p class="field-label">${status === "none" ? "Planning a different test?" : "Which test?"}</p>
          <div class="chips">${tests
            .map(([value, name]) => `<button type="button" class="chip" aria-pressed="${(test ?? (status === "none" ? "ielts" : null)) === value}" data-action="pick" data-field="test" data-value="${value}">${name}</button>`)
            .join("")}</div>`;
      }
      if (status === "score" && test) {
        detail += stepper("score", SCALES[test], english.score, "Overall score");
        const { year, month } = partsFromDay(today);
        const thisMonth = `${year}-${String(month).padStart(2, "0")}`;
        const earliest = `${year - 10}-${String(month).padStart(2, "0")}`;
        detail += `<label class="date-field">
          <span class="field-label">When did you take it?</span>
          <input type="month" data-action="date" data-field="englishTaken" value="${esc(english.taken ?? "")}" min="${earliest}" max="${thisMonth}">
        </label>
        <p class="note">Scores are valid for two years, so Pathway checks this one is still valid when your applications close.</p>`;
      }
      if (status === "booked" && test) {
        detail += dateField("englishDate", english.date, today);
      }
      return {
        title: "Your English test",
        why: "Universities and visas ask for an English score. Tell Pathway where you are, and your plan fills in the rest.",
        body: `${segmented("englishStatus", "Your English test status", [["none", "Not taken"], ["booked", "Booked"], ["score", "Have a score"], ...(ctx.englishWaiver ? [["waived", "Not needed"]] : [])], status)}${detail}`,
      };
    }
    case "sat": {
      const sat = draft.sat ?? {};
      let detail = "";
      if (sat.status === "score") {
        detail = stepper("satScore", SAT_SCALE, sat.score, "Total score");
      } else if (sat.status === "booked") {
        detail = dateField("satDate", sat.date, today);
      }
      return {
        title: "The SAT",
        why: WHY_SAT[draft.country] ?? "",
        body: `<fieldset class="choices"><legend class="visually-hidden">The SAT</legend>${[
          ["no", "Not planning to sit it"], ["none", "Planning to, not taken yet"], ["booked", "Booked"], ["score", "Have a score"],
        ].map(([value, label]) => option({ name: "satStatus", value, checked: sat.status === value, label })).join("")}</fieldset>${detail}`,
      };
    }
    case "tier": {
      const name = ctx.countries.find((country) => country.code === draft.country)?.name;
      return {
        title: name ? `How competitive are your universities in ${name}?` : "How competitive are your universities?",
        why: "This changes how many applications and how much essay time Pathway suggests, not your dates. Each country keeps its own answer.",
        body: `<fieldset class="choices"><legend class="visually-hidden">How competitive</legend>${[
          ["reach", "Mostly very competitive"], ["balanced", "A balanced mix"], ["safe", "Mostly less competitive"],
        ].map(([value, label]) => option({ name: "tier", value, checked: draft.tier === value, label })).join("")}</fieldset>`,
      };
    }
    case "aid":
      return {
        title: "Do you need financial aid?",
        why: "Aid deadlines often come first, so this can move your plan earlier.",
        body: `<fieldset class="choices"><legend class="visually-hidden">Financial aid</legend>${[
          ["need", "I need it to go"], ["help", "It would help"], ["no", "My family can pay"],
        ].map(([value, label]) => option({ name: "aid", value, checked: draft.aid === value, label })).join("")}</fieldset>`,
      };
    case "passport":
      return {
        title: "Your passport",
        why: "Every student visa needs a passport, and some tests need one first. A regular e-passport takes up to 21 working days.",
        body: `<fieldset class="choices"><legend class="visually-hidden">Your passport</legend>${[
          ["valid", "I have a valid passport", null],
          ["applied", "I have applied for one", null],
          ["nid", "Not yet, but I have a smart NID card", "The card with a chip, which IELTS accepts"],
          ["none", "Neither yet", null],
        ].map(([value, label, note]) => option({ name: "passport", value, checked: draft.passport === value, label, note })).join("")}</fieldset>`,
      };
    default:
      return { title: "", why: "", body: "" };
  }
}

// Drawing one question screen. ctx holds questions, index, today, countries, intakeOptions,
// firstHscYear, colour, single, asksSat, englishWaiver and englishTests
export function renderQuestion(key, draft, ctx) {
  const { title, why, body } = questionBody(key, draft, ctx);
  const ready = answered(key, draft, ctx.today, ctx);
  const last = ctx.index === ctx.questions.length - 1;
  const button = ctx.single ? "Save" : last && key !== "start" ? "Make my plan" : "Continue";
  return `<div class="setup">
    <div class="setup-head">
      <button class="icon-button back-button" type="button" data-action="setup-back" aria-label="${ctx.index === 0 && !ctx.single ? "Back to the start" : "Previous question"}">
        <svg class="icon" aria-hidden="true"><use href="icons/sprite.svg#back"></use></svg>
      </button>
      <span class="setup-count">${ctx.single ? "Change your answer" : `Question ${ctx.index + 1} of ${ctx.questions.length}`}</span>
    </div>
    ${ctx.single ? "" : progressLine(ctx.questions, ctx.index, ctx.colour)}
    <h2 class="setup-title" id="setup-title" tabindex="-1">${esc(title)}</h2>
    ${why ? `<p class="setup-why">${esc(why)}</p>` : ""}
    <div class="setup-body">${body}</div>
    <div class="setup-actions">
      <button class="button-primary" type="button" data-action="setup-next"${ready ? "" : " disabled"}>${button}</button>
    </div>
  </div>`;
}

// Reading one tap or change into the draft. It returns false only for a field it does not know
export function applyInput(draft, element) {
  const field = element.dataset.field;
  const value = element.dataset.value ?? element.value;
  switch (field) {
    case "country":
      if (draft.country !== value) {
        draft.country = value;
        draft.intake = null;
      }
      return true;
    case "system":
      if (draft.school?.system !== value) {
        draft.school = { system: value, year: null, ...(value === "alevel" ? { session: "summer" } : {}) };
        draft.intake = null;
      }
      return true;
    case "session":
      draft.school = { ...draft.school, session: value };
      draft.intake = null;
      return true;
    case "year":
      draft.school = { ...draft.school, year: Number(value) };
      draft.intake = null;
      return true;
    case "intake":
      draft.intake = value === "soonest" ? { soonest: true } : /^[0-9]{4}-[0-9]{2}$/.test(value) ? { month: value } : { cycle: Number(value) };
      return true;
    case "englishStatus": {
      const before = draft.english ?? {};
      if (value === "waived") {
        draft.english = { status: "waived" };
        return true;
      }
      // Leaving IELTS unset when no test is taken yet, since the plan assumes it; a booking or score
      // starts from IELTS unless another test was chosen
      draft.english = { status: value, test: value === "none" ? before.test === "ielts" ? undefined : before.test : before.test ?? "ielts" };
      if (value === "score") {
        draft.english.score = before.score ?? SCALES[draft.english.test].start;
        if (before.taken) {
          draft.english.taken = before.taken;
        }
      }
      if (value === "booked" && before.date) {
        draft.english.date = before.date;
      }
      return true;
    }
    case "test": {
      const english = { ...(draft.english ?? { status: "none" }), test: value };
      // Asking for the month again, because a different test means a different score
      delete english.taken;
      if (english.status === "none" && value === "ielts") {
        delete english.test;
      }
      if (english.status === "score") {
        english.score = SCALES[value].start;
      }
      draft.english = english;
      return true;
    }
    case "englishDate":
      draft.english = { ...draft.english, date: value };
      return true;
    case "englishTaken":
      draft.english = { ...draft.english, taken: value };
      return true;
    case "satStatus": {
      const before = draft.sat ?? {};
      draft.sat = { status: value };
      if (value === "score") {
        draft.sat.score = before.score ?? SAT_SCALE.start;
      }
      if (value === "booked" && before.date) {
        draft.sat.date = before.date;
      }
      return true;
    }
    case "satDate":
      draft.sat = { ...draft.sat, date: value };
      return true;
    case "score":
    case "satScore": {
      const scale = field === "score" ? SCALES[draft.english.test] : SAT_SCALE;
      const holder = field === "score" ? draft.english : draft.sat;
      const current = typeof holder.score === "number" ? holder.score : scale.start;
      // Snapping to the scale's step and rounding away floating-point drift
      const next = Math.round((current + Number(element.dataset.delta) * scale.step) / scale.step) * scale.step;
      holder.score = Math.min(scale.max, Math.max(scale.min, Number(next.toFixed(1))));
      return true;
    }
    case "startChoice":
    case "tier":
    case "aid":
    case "passport":
      draft[field] = value;
      return true;
    default:
      return false;
  }
}

// Writing the note under each intake at honest precision: when applications close, or when the
// foundation year starts
export function intakeNote(code, option, today) {
  const deadline = option.deadline;
  if (!deadline) {
    return "";
  }
  const date = { day: deadline.first, precision: deadline.precision, status: deadline.status };
  const when = dateWords(date, today, { year: true });
  const byMonth = deadline.precision === "month";
  const expected = deadline.status === "expected" || byMonth;
  if (option.route === "foundation") {
    return `Foundation starts ${byMonth ? "in " : ""}${when}${expected ? ", dates expected" : ""}`;
  }
  // Saying "dates expected" only for a month, since an expected day already reads "around"
  return `Applications close ${byMonth ? "in " : ""}${when}${byMonth ? ", dates expected" : ""}`;
}
