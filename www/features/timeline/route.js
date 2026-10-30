// Drawing a built plan: the plan at a glance, the route as an ordered list, the out-of-reach card,
// and the content of the source panel. timeline.js decides when to draw, and the code here decides how
import { formatDay, formatMonth, formatTime, monthEnd, monthsBetween, monthStart, partsFromDay, readDate, toDhaka } from "../../app/dates.js";
import { ms, reducedMotion, token } from "../../app/motion.js";
import { dateWithPreposition, dateWords, esc, glue, intakeName, lowerFirst, monthHeading, plural, todayLabel } from "./words.js";

const STAGES = [["prepare", "Prepare"], ["test", "Test"], ["apply", "Apply"], ["results", "Results"], ["permit", "Permit"], ["arrive", "Arrive"]];
const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const THIS_MONTH_LIMIT = 3;
// Staggering stations that fill together: milliseconds between each, and the most the last one waits,
// however many steps were marked done at once
const MARKER_STAGGER = 45;
const MARKER_STAGGER_TOTAL = 240;
// Capping a slide at this share of the screen height. Anything moving further fades in from
// ARRIVE_DISTANCE pixels away instead, so a long move never sweeps across the steps in between
const GLIDE_LIMIT = 0.5;
const ARRIVE_DISTANCE = 24;
const ZONE_PLACES = {
  "America/New_York": "New York", UTC: "UTC", "Europe/Helsinki": "Finland", "Europe/Istanbul": "Türkiye",
  "Asia/Kuala_Lumpur": "Malaysia", "Pacific/Auckland": "New Zealand", "Asia/Dhaka": "Dhaka",
};

function icon(name, extra = "") {
  return `<svg class="icon${extra}" aria-hidden="true"><use href="icons/sprite.svg#${name}"></use></svg>`;
}

function count(number, one, many) {
  return number < NUMBER_WORDS.length ? `${NUMBER_WORDS[number]} ${number === 1 ? one : many}` : `${number} ${many}`;
}

// Finding the steps that need the student this month: open steps they act on, due or starting by month end
export function needsThisMonth(result, today) {
  const end = monthEnd(today);
  return result.steps.filter((step) => !step.done && !step.undated && step.kind !== "wait" && step.kind !== "event"
    && ((step.latestStart !== null && step.latestStart <= end) || step.date.day <= end));
}

function statusSentence(result, today) {
  if (result.counts.total > 0 && result.counts.done === result.counts.total) {
    return "Every step is done. Your plan stays here if anything changes.";
  }
  const urgent = result.steps.filter((step) => step.urgency === "urgent" && !step.done).length;
  const month = needsThisMonth(result, today).length;
  const monthText = month === 0 ? "Nothing needs you this month." : `${count(month, "step needs", "steps need")} you this month.`;
  if (result.tight) {
    return `You can still make it, with little spare time. ${monthText}`;
  }
  if (urgent > 0) {
    return `${count(urgent, "step needs", "steps need")} you now. ${month > urgent ? monthText : ""}`.trim();
  }
  return `You're on track. ${monthText}`;
}

function dateLine(step, today, { strong = true } = {}) {
  if (step.undated) {
    return `<span>Date not published yet</span>`;
  }
  if (step.done) {
    return `<span>Done on ${esc(formatDay(Number(step.doneOn), { year: false }))}</span>`;
  }
  const words = esc(dateWords(step.date, today));
  const shown = strong ? `<strong>${words}</strong>` : words;
  if (step.kind === "wait" || step.kind === "event") {
    return `<span>${step.date.precision === "month" || words.startsWith("around") ? "Expected" : "Expected by"} ${shown}</span>`;
  }
  // Saying plainly, in the warning colour, that the planned date has passed, so it never reads as a
  // date still ahead. The words carry the meaning too, so the colour is never needed alone
  if (isLate(step, today)) {
    const when = step.date.precision === "day" && today - step.date.day === 1 ? "yesterday" : words;
    return `<span><strong class="date-late">Do it now</strong>, it was planned for ${when}</span>`;
  }
  // Reading a booked test as booked until its day, then as taken, until the score is entered
  if ((step.id === "english.test" && step.english?.booked) || (step.id === "sat.test" && step.sat?.booked)) {
    return `<span>${step.date.day < today ? "Taken on" : "Booked for"} ${shown}</span>`;
  }
  if (step.id === "english.test" || step.id === "sat.test") {
    return step.id === "sat.test" ? `<span>Test day ${shown}</span>` : `<span>Take it by ${shown}</span>`;
  }
  return `<span>Do by ${shown}</span>`;
}

function infoButton(step) {
  if (step.undated) {
    return "";
  }
  return `<button class="info-button" type="button" data-action="source" data-step="${esc(step.id)}" aria-label="Where this date comes from">${icon("info")}</button>`;
}

// Spotting an open task whose planned date has passed, leaving booked tests to their own wording
function isLate(step, today) {
  return !step.done && !step.undated && step.kind !== "wait" && step.kind !== "event" && step.date.day < today && !step.english?.booked && !step.sat?.booked;
}

// Leaving out "Needs you now" when the date line already says "Do it now", so it is never said twice
function badges(step, today) {
  if (step.done || step.undated) {
    return "";
  }
  if (step.urgency === "urgent" && !isLate(step, today)) {
    return `<span class="badge is-urgent">Needs you now</span>`;
  }
  if (step.urgency === "little") {
    return `<span class="badge">${icon("clock", " is-small")}Little spare time</span>`;
  }
  if (step.warning) {
    return `<span class="badge">${icon("clock", " is-small")}May come late</span>`;
  }
  return "";
}

// Giving a date's clock time in its own zone and in Dhaka: "Closes at 11:59 p.m., Dhaka time"
function clockWords(clock) {
  const verb = clock.closes ? "Closes" : "Starts";
  if (clock.zone === "Asia/Dhaka") {
    return `${verb} at ${formatTime(clock.time)}, Dhaka time.`;
  }
  const dhaka = toDhaka(clock.day, clock.time, clock.zone);
  const otherDay = dhaka.day !== clock.day ? ` on ${formatDay(dhaka.day, { year: false })}` : "";
  return `${verb} at ${formatTime(clock.time)} ${ZONE_PLACES[clock.zone] ?? clock.zone} time, which is ${formatTime(dhaka.time)}${otherDay} in Dhaka.`;
}

// Showing "Start by" only for steps that take time, since the date shown is when they must be finished
function startLine(step, today) {
  if (step.done || step.undated || step.kind === "wait" || step.kind === "event" || step.latestStart === null || step.latestStart >= step.date.day) {
    return "";
  }
  const start = Math.max(step.latestStart, today);
  if (start === step.date.day) {
    return "";
  }
  return `<p class="step-start">Start by ${esc(formatDay(start, { year: false }))}</p>`;
}

function stagesLine(result) {
  const current = result.steps.find((step) => step.id === result.current);
  const currentIndex = current ? STAGES.findIndex(([id]) => id === current.stage) : STAGES.length - 1;
  const label = current ? STAGES[currentIndex][1].toLowerCase() : "arrive";
  const items = STAGES.map(([id, name], index) => {
    const state = index < currentIndex ? "done" : index === currentIndex ? "here" : "ahead";
    return `<li class="stage is-${state}${id === "arrive" ? " is-terminus" : ""}"><span class="stage-dot"></span><span class="stage-name">${name}</span></li>`;
  });
  return `<div class="stages" role="img" aria-label="Your route: you are at the ${label} stage, ${currentIndex + 1} of 6">
    <span class="stages-rail" aria-hidden="true"></span>
    <span class="stages-travelled" aria-hidden="true" style="--reached: ${currentIndex / (STAGES.length - 1)}"></span>
    <ol aria-hidden="true">${items.join("")}</ol>
  </div>`;
}

function shapingRow(answer, head, rest) {
  return `<li><button class="shaping-row" type="button" data-action="change-answer" data-answer="${esc(answer)}">
      <span><span class="shaping-head">${esc(head)}</span>${rest ? `<span class="shaping-rest">${esc(rest)}</span>` : ""}</span>${icon("chevron", " is-soft")}
    </button></li>`;
}

function shapingRows(result, ctx) {
  const intake = ctx.answers.intake;
  const shownIntake = lowerFirst(intakeName(ctx.code, ctx.intake));
  const intakeRow = intake?.soonest
    ? shapingRow("intake", "You asked for the soonest intake you can make.", shownIntake ? `Pathway found ${shownIntake}.` : "")
    : shapingRow("intake", `You want to start in ${shownIntake}.`, "");
  return intakeRow + (result.shaping ?? []).map((item) => {
    const split = item.text.indexOf(". ");
    const head = split === -1 ? item.text : item.text.slice(0, split + 1);
    const rest = split === -1 ? "" : item.text.slice(split + 2);
    return shapingRow(item.answer, head, rest);
  }).join("");
}

// Showing the answers under an out-of-reach card too, so the one that matters can be changed
export function renderAnswers(result, ctx, { title = "What shaped this plan" } = {}) {
  return `<h3 class="shaping-title">${esc(title)}</h3>
    <ul class="shaping-list">${shapingRows(result, ctx)}</ul>`;
}

export function renderStartOver() {
  return `<section class="start-over" aria-labelledby="start-over-title">
    <h3 class="start-over-title" id="start-over-title">Start again</h3>
    <p class="note">Removes your answers, the steps you marked done and your own dates for every country, so you can begin again from the first screen. Pathway asks before removing anything.</p>
    <button class="button-secondary is-danger" type="button" data-action="start-over">Start over</button>
  </section>`;
}

// Writing when a date the student waits for may come: "31 August 2028", or "the end of August 2028"
// for a date known only by its month
function comesWords(reason) {
  return reason.comes === "month" ? `the end of ${formatMonth(reason.earliest)}` : formatDay(reason.earliest);
}

// Saying why "The soonest I can make" passed over an earlier intake, in one line
function skippedWords(skipped, ctx) {
  const name = intakeName(ctx.code, skipped);
  const reason = skipped.reason;
  if (reason?.comes && Number.isFinite(reason.due) && Number.isFinite(reason.earliest) && reason.due >= ctx.today) {
    return `${name} is out of reach, so Pathway planned the next intake. \u201C${reason.title}\u201D is needed by ${formatDay(reason.due)}, but it may not happen until ${comesWords(reason)}.`;
  }
  if (reason && Number.isFinite(reason.due) && Number.isFinite(reason.earliest) && reason.due >= ctx.today) {
    return `${name} is out of reach, so Pathway planned the next intake. \u201C${reason.title}\u201D is needed by ${formatDay(reason.due)}, and the earliest it can be done is ${formatDay(reason.earliest)}.`;
  }
  if (reason && Number.isFinite(reason.due)) {
    return `${name} is out of reach, so Pathway planned the next intake. \u201C${reason.title}\u201D needed to be done by ${formatDay(reason.due)}.`;
  }
  return `${name} is out of reach, so Pathway planned the next intake.`;
}

// Naming the step with the least room, without quoting a calm date that has already passed
function tightWords(because, today) {
  const step = because.title;
  if (because.comes && Number.isFinite(because.due) && because.due >= today && Number.isFinite(because.earliest)) {
    return `\u201C${step}\u201D has the least room. Pathway's usual timing needs it by ${formatDay(because.due)}, but it may not happen until ${comesWords(because)}.`;
  }
  if (Number.isFinite(because.due) && because.due >= today && Number.isFinite(because.earliest)) {
    return `\u201C${step}\u201D has the least room. Pathway's usual timing needs it by ${formatDay(because.due)}, and the earliest it can be done is ${formatDay(because.earliest)}.`;
  }
  return `\u201C${step}\u201D has the least room. Pathway's usual time for it no longer fits, so the dates below are the latest that still work.`;
}

export function renderGlance(result, ctx) {
  const { today, country } = ctx;
  const months = monthsBetween(today, result.start.day);
  const startWords = dateWithPreposition(result.start, today, { year: true });
  const month = needsThisMonth(result, today);
  const shown = month.slice(0, THIS_MONTH_LIMIT);
  const monthItems = shown.map((step) => `<li class="month-step">
      <span class="mini-station${step.id === result.current ? " is-here" : ""}" aria-hidden="true"></span>
      <div>
        <h4 class="month-title">${esc(step.title)}${step.id === result.current ? `<span class="visually-hidden">, your next step</span>` : ""}</h4>
        ${step.text ? `<p class="month-text">${esc(step.text.split(/(?<=\.) /)[0])}</p>` : ""}
        <div class="date-row">${glue(dateLine(step, today), infoButton(step))}${badges(step, today)}</div>
      </div>
    </li>`).join("");
  const next = result.steps.find((step) => step.id === result.current);
  const nothing = next
    ? `<p class="month-empty">Your next step: ${esc(lowerFirst(next.title))}, ${esc(dateWithPreposition(next.date, today) || "when its date is published")}.</p>`
    : `<p class="month-empty">Every step is done.</p>`;
  const more = month.length > shown.length ? `<p class="note">And ${plural(month.length - shown.length, "more step", "more steps")} in your route below.</p>` : "";
  const tight = result.tight && result.tightBecause ? `<p class="tight-note">${icon("clock", " is-small")}<span>${esc(tightWords(result.tightBecause, today))}</span></p>` : "";

  return `<div class="glance">
    <div class="plan-for">
      <button class="country-chip" type="button" data-action="switch-country" style="--route: var(${country.line}); --route-text: var(${country.text})" aria-label="${esc(country.name)}, switch country">
        <span class="chip-dot" aria-hidden="true"></span>${esc(country.name)}${icon("chevron")}
      </button>
      <span class="plan-intake">${esc(intakeName(ctx.code, ctx.intake))}${result.route && result.routes.length > 1 ? `, ${esc(lowerFirst(result.route.title))}` : ""}</span>
    </div>
    <p class="plan-status">${esc(statusSentence(result, today))}</p>
    ${result.mostlyExpected ? `<p class="note plan-expected">Your plan uses expected dates for your year. Pathway updates them every year.</p>` : ""}
    ${result.skipped ? `<p class="tight-note">${icon("info", " is-small")}<span>${esc(skippedWords(result.skipped, ctx))}</span></p>` : ""}
    ${tight}
    <div class="plan-facts">
      <p><span class="fact-figure">${months === 0 ? "Under a month" : plural(months, "month", "months")}</span><span class="fact-label">until ${result.route?.id === "foundation" ? "your foundation year begins" : "studies begin"} ${esc(startWords)}</span></p>
      <p><span class="fact-figure" data-done-count>${result.counts.done} of ${result.counts.total}</span><span class="fact-label">steps done</span></p>
    </div>
    ${stagesLine(result)}
    <div class="section-head"><h3>This month</h3><span>${esc(formatMonth(today))}</span></div>
    ${shown.length > 0 ? `<ol class="month-list">${monthItems}</ol>${more}` : nothing}
  </div>`;
}

// Drawing what follows the route: the answers behind the plan, folded away until asked for, then
// reminders, the other routes open to the student and the roadmap's other intakes
export function renderPlanMore(result, ctx) {
  const open = Boolean(ctx.answersOpen);
  return `<div class="plan-more">
    <button class="disclosure" type="button" data-action="toggle-answers" aria-expanded="${open}" aria-controls="plan-answers">
      <span class="disclosure-text"><span class="disclosure-title">What shaped this plan</span><span class="disclosure-note">${open ? "Tap an answer to change it" : "Your answers, and what each one changed"}</span></span>${icon("chevron", " disclosure-chevron")}
    </button>
    ${open ? `<ul class="shaping-list" id="plan-answers">${shapingRows(result, ctx)}</ul>` : ""}
    ${ctx.reminders ? `<button class="shaping-row reminder-row" type="button" data-action="reminders">
      <span><span class="shaping-head">Reminders</span><span class="shaping-rest">${ctx.reminders.on ? "On. Tap to change them" : "Off. Pathway can remind you before each step"}</span></span>${icon("chevron", " is-soft")}
    </button>` : ""}
    ${routeChoices(result, ctx)}
    ${otherIntakes(result)}
  </div>`;
}

// Pointing to the roadmap's other intakes and routes. A plan by start month already uses the month
// the student chose, so it mentions only the other routes
function otherIntakes(result) {
  const [note, label] = result.month
    ? ["Pathway plans for the start month you chose. Other routes are explained in the roadmap.", "Read about other routes"]
    : ["Pathway plans for the main intake. Smaller intakes and other routes are explained in the roadmap.", "Read about other intakes"];
  return `<div class="route-choices"><p class="note">${note}</p>
      <button class="text-button" type="button" data-action="open-roadmap" data-section="other-routes">${label}</button></div>`;
}

// Offering the other open ways in, such as the early round or Türkiye Bursları, as a plain choice
function routeChoices(result, ctx) {
  const others = result.routes.filter((route) => route.reachable && route.id !== result.route?.id);
  if (others.length === 0) {
    return "";
  }
  return `<div class="route-choices"><p class="note">Also open to you:</p>${others
    .map((route) => `<button class="text-button" type="button" data-action="choose-route" data-route="${esc(route.id)}">Plan for the ${esc(lowerFirst(route.title))} instead</button>`)
    .join("")}${ctx.preferredRoute ? `<button class="text-button" type="button" data-action="choose-route" data-route="">Let Pathway choose</button>` : ""}</div>`;
}

function stepActions(step, ctx) {
  const actions = [];
  actions.push(step.done
    ? `<button class="button-secondary is-compact" type="button" data-action="untick" data-step="${esc(step.id)}">Mark as not done</button>`
    : `<button class="button-primary is-compact" type="button" data-action="tick" data-step="${esc(step.id)}">Mark as done</button>`);
  const test = step.id === "english.test" ? "english" : step.id === "sat.test" ? "sat" : null;
  const booked = test && ctx.answers[test]?.status === "booked";
  if (!step.done && test && !booked) {
    actions.push(`<button class="text-button" type="button" data-action="own-date" data-kind="${test}" data-step="${esc(step.id)}">Already booked?</button>`);
  }
  // Letting a booking move, and once the test is sat, asking for its score instead
  if (!step.done && booked) {
    actions.push(`<button class="text-button" type="button" data-action="change-answer" data-answer="${test}">${step.date.day < ctx.today ? "Enter your score" : "Change your test date"}</button>`);
  }
  if (!step.done && step.ownable) {
    actions.push(`<button class="text-button" type="button" data-action="own-date" data-kind="deadline" data-step="${esc(step.id)}">${step.ownDeadline ? "Change your date" : "Use your own date"}</button>`);
  }
  if (!step.done && step.stage === "arrive" && step.hard && ctx.ownStartAllowed) {
    actions.push(`<button class="text-button" type="button" data-action="own-date" data-kind="start" data-step="${esc(step.id)}">${ctx.ownStart ? "Change your start date" : "Enter your start date"}</button>`);
  }
  return `<div class="step-actions">${actions.join("")}</div>`;
}

// Explaining where a date with a planning assumption comes from. An own date that the steps after
// it cannot wait for is shown as the earlier date, and the line says why, so the change is never invisible
function planningWords(step, today) {
  if (!step.ownDeadline) {
    return `Pathway's planning date. ${step.planning.text}`;
  }
  if (step.ownDay !== null && step.ownDay > step.date.day) {
    return `Your own date is ${formatDay(step.ownDay)}. Pathway shows ${dateWords(step.date, today)}, because the steps after it need the time until your studies begin. Change your date to ${formatDay(step.date.day)} or earlier.`;
  }
  return "Your own date.";
}

// Pointing a step to the section of the country's roadmap that explains it in depth
function roadmapLink(step, ctx) {
  const section = ctx.roadmapSection?.(step.id);
  if (!section) {
    return "";
  }
  return `<button class="text-button step-roadmap" type="button" data-action="open-roadmap" data-section="${esc(section)}">Read more in the ${esc(ctx.country.name)} roadmap</button>`;
}

function stepDetails(step, ctx) {
  const because = step.because ? ctx.becauseText(step.because) : null;
  return `<div class="step-details">
    ${startLine(step, ctx.today)}
    ${step.clock ? `<p class="step-start">${esc(clockWords(step.clock))}</p>` : ""}
    ${step.text ? `<p class="step-text">${esc(step.text)}</p>` : ""}
    ${step.warning ? `<p class="tight-note">${icon("clock", " is-small")}<span>${esc(step.warning)}</span></p>` : ""}
    ${because ? `<p class="step-because">Because you said: <span>${esc(because)}</span></p>` : ""}
    ${step.planning ? `<p class="step-planning">${esc(planningWords(step, ctx.today))}</p>` : ""}
    ${step.tasks.length > 0 ? `<ul class="step-tasks">${step.tasks.map((task) => `<li>${esc(task)}</li>`).join("")}</ul>` : ""}
    ${roadmapLink(step, ctx)}
    ${stepActions(step, ctx)}
  </div>`;
}

function stepItem(step, ctx, isCurrent, expanded) {
  const state = step.done ? "done" : isCurrent ? "here" : step.undated ? "undated" : "ahead";
  const stateWords = step.done ? "Done" : isCurrent ? "Your next step" : step.undated ? "Date not published" : "Upcoming";
  const marker = step.hard && !step.done && !isCurrent ? "bar" : "station";
  const title = `<span class="visually-hidden">${stateWords}: </span><span class="step-title">${esc(step.title)}</span>`;
  // Making the next step's title a heading, since that step is always open and a button would do
  // nothing. Every other title opens and closes its step, with an arrow that says so
  const head = isCurrent
    ? `<h4 class="step-head" tabindex="-1">${title}</h4>`
    : `<button class="step-head" type="button" data-action="toggle-step" data-step="${esc(step.id)}" aria-expanded="${expanded}">${title}${icon("chevron", " step-chevron")}</button>`;
  return `<li class="route-step is-${state}${expanded ? " is-open" : ""}${step.hard ? " is-hard" : ""}" data-step="${esc(step.id)}">
    <span class="route-marker is-${marker}" aria-hidden="true">${step.done ? icon("tick") : ""}</span>
    <div class="step-card">
      ${head}
      <div class="date-row">${glue(dateLine(step, ctx.today, { strong: step.hard || isCurrent }), infoButton(step))}${badges(step, ctx.today)}</div>
      ${expanded ? stepDetails(step, ctx) : ""}
    </div>
  </li>`;
}

// Redrawing one step after it opens or closes, leaving the rest of the plan alone
export function renderStepItem(result, ctx, stepId) {
  const step = result.steps.find((item) => item.id === stepId);
  if (!step) {
    return null;
  }
  const isCurrent = step.id === result.current;
  return stepItem(step, ctx, isCurrent, isCurrent || ctx.openSteps.has(step.id));
}

// Grouping the route by month. Steps still open from past months are gathered calmly just above this month
export function renderRoute(result, ctx) {
  const { today, openSteps } = ctx;
  const thisMonth = monthStart(today);
  const groups = [];
  const overdue = [];
  for (const step of result.steps) {
    const anchor = step.done && step.doneOn !== null ? step.doneOn : step.undated ? null : step.date.day;
    if (!step.done && anchor !== null && anchor < thisMonth) {
      overdue.push(step);
      continue;
    }
    const key = anchor === null ? groups[groups.length - 1]?.key ?? thisMonth : Math.max(monthStart(anchor), step.done ? monthStart(anchor) : thisMonth);
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, steps: [] };
      groups.push(group);
    }
    group.steps.push(step);
  }
  if (!groups.some((group) => group.key === thisMonth)) {
    groups.push({ key: thisMonth, steps: [] });
  }
  groups.sort((a, b) => a.key - b.key);

  const items = [];
  const pushSteps = (steps) => {
    for (const step of steps) {
      const isCurrent = step.id === result.current;
      items.push(stepItem(step, ctx, isCurrent, isCurrent || openSteps.has(step.id)));
    }
  };
  for (const group of groups) {
    if (group.key === thisMonth && overdue.length > 0) {
      const from = overdue[0].date.day;
      items.push(`<li class="route-month is-overdue"><span>Still open from ${esc(formatMonth(from, { year: partsYear(from) !== partsYear(today) }))}</span></li>`);
      pushSteps(overdue);
    }
    items.push(`<li class="route-month"><span>${esc(monthHeading(group.key))}</span>${group.key === thisMonth ? `<span class="today-label">${esc(todayLabel(today))}</span>` : ""}</li>`);
    pushSteps(group.steps);
  }

  return `<section class="route" aria-labelledby="route-title">
    <h3 class="route-title" id="route-title">Your route</h3>
    <p class="note">${result.counts.done} of ${result.counts.total} steps done for ${esc(ctx.country.name)}, ${esc(lowerFirst(intakeName(ctx.code, ctx.intake)))}</p>
    <div class="route-map">
      <span class="route-rail" aria-hidden="true"></span>
      <span class="route-travelled" aria-hidden="true"></span>
      <ol class="route-list">${items.join("")}</ol>
    </div>
  </section>`;
}

const BOOKED_NAMES = { ielts: "IELTS", toefl: "TOEFL iBT", duolingo: "Duolingo English Test", pte: "PTE Academic", sat: "SAT" };

// Handling a booked test that comes before something it needs, such as a passport. The booking has
// to move, so the card says so and offers to change the test date, instead of a later intake
function renderBookingConflict(result, ctx) {
  const reason = result.reason;
  const test = BOOKED_NAMES[reason.booked === "sat" ? "sat" : reason.bookedTest] ?? "test";
  const answer = reason.booked === "sat" ? "sat" : "english";
  const sentence = `\u201C${reason.title}\u201D can be done by ${formatDay(reason.earliest)} at the earliest, but your ${test} on ${formatDay(reason.due)} needs it first. Book a later test date, then tell Pathway the new date.`;
  return `<section class="reach-card" aria-labelledby="reach-title">
    <h3 id="reach-title">Your ${esc(test)} booking does not fit</h3>
    <p class="reading">${esc(sentence)}</p>
    ${collision(ctx.today, reason.earliest, reason.due, "Your test")}
    <button class="button-primary" type="button" data-action="change-answer" data-answer="${answer}">Change your test date</button>
    <p class="note">Every intake waits for this booking, so a later intake does not help until the date moves.</p>
  </section>
  <div class="reach-answers">${renderAnswers(result, ctx, { title: "Your answers" })}</div>`;
}

export function renderOutOfReach(result, ctx) {
  const { today } = ctx;
  const name = intakeName(ctx.code, ctx.intake);
  const reason = result.reason;
  if (reason?.booked && Number.isFinite(reason.earliest) && Number.isFinite(reason.due)) {
    return renderBookingConflict(result, ctx);
  }
  let sentence = "Pathway's facts do not reach this intake yet, so it cannot be planned.";
  let drawing = "";
  if (reason && Number.isFinite(reason.earliest) && Number.isFinite(reason.due) && reason.due < today) {
    // Using the past tense for a date already gone, with nothing to draw against today
    sentence = `\u201C${reason.title}\u201D needed to be done by ${formatDay(reason.due)}, which has passed. The earliest it can be done now is ${formatDay(reason.earliest)}.`;
  } else if (reason?.comes && Number.isFinite(reason.earliest) && Number.isFinite(reason.due)) {
    sentence = `\u201C${reason.title}\u201D is needed by ${formatDay(reason.due)}, but it may not happen until ${comesWords(reason)}.`;
    drawing = collision(today, reason.earliest, reason.due);
  } else if (reason && Number.isFinite(reason.earliest) && Number.isFinite(reason.due)) {
    sentence = `\u201C${reason.title}\u201D can be done by ${formatDay(reason.earliest)} at the earliest, but it is needed by ${formatDay(reason.due)}.`;
    drawing = collision(today, reason.earliest, reason.due);
  } else if (reason && reason.satFirst === null && reason.step === "sat.test") {
    sentence = "No SAT date left can get your scores to universities in time.";
  }
  const next = result.next;
  const nextName = next ? intakeName(ctx.code, next) : null;
  return `<section class="reach-card" aria-labelledby="reach-title">
    <h3 id="reach-title">${esc(name)} is out of reach</h3>
    <p class="reading">${esc(sentence)}</p>
    ${drawing}
    ${next ? `<div class="reach-next"><p class="note">Your next intake that fits</p><h4>${esc(nextName)}</h4></div>
      <button class="button-primary" type="button" data-action="use-next">Show my ${esc(lowerFirst(nextName))} plan</button>`
      : `<p class="note">No later intake in Pathway's facts fits these answers yet.</p>`}
    ${ctx.ownInUse ? `<button class="button-secondary" type="button" data-action="own-clear">Use Pathway's dates again</button>
      <p class="note">You entered your own dates for this intake, and they may be why it no longer fits.</p>` : ""}
    <p class="note">Or change one of your answers below, such as your intake or your test date.</p>
  </section>
  <div class="reach-answers">${renderAnswers(result, ctx, { title: "Your answers" })}</div>`;
}

// Sketching the collision: today, the deadline bar, and a dashed stretch on to the earliest date
function collision(today, earliest, due, dueLabel = "Needed by") {
  const span = Math.max(earliest, due) - today || 1;
  const at = (day) => Math.min(100, Math.max(0, ((day - today) / span) * 100));
  const label = `Today is ${formatDay(today, { year: false })}. It is needed by ${formatDay(due, { year: false })}, and the earliest it can be done is ${formatDay(earliest, { year: false })}.`;
  return `<div class="collision" role="img" aria-label="${esc(label)}">
    <span class="collision-solid" style="width: ${at(due)}%"></span>
    <span class="collision-late" style="left: ${at(due)}%; width: ${at(earliest) - at(due)}%"></span>
    <span class="collision-today"></span>
    <span class="collision-bar" style="left: ${at(due)}%"></span>
    <span class="collision-end" style="left: ${at(earliest)}%"></span>
    <span class="collision-label is-due${at(due) > 70 ? " is-right" : at(due) < 30 ? " is-left" : ""}" style="left: ${at(due)}%">${esc(dueLabel)} ${esc(formatDay(due, { year: false }))}</span>
    <span class="collision-label is-today">Today</span>
    <span class="collision-label is-end">Earliest ${esc(formatDay(earliest, { year: false }))}</span>
  </div>`;
}

export function renderMessage(title, text, action = null) {
  return `<section class="message-card"><h3>${esc(title)}</h3><p class="reading">${esc(text)}</p>${action ? `<button class="button-primary" type="button" data-action="${action.action}">${esc(action.label)}</button>` : ""}</section>`;
}

function statusWords(entry, source) {
  if (entry.status === "confirmed") {
    return "Confirmed by the official source";
  }
  if (entry.status === "reported") {
    return `Reported by ${source?.publisher ?? "another organisation"}`;
  }
  return "Expected";
}

function partsYear(day) {
  return partsFromDay(day).year;
}

// Showing a deadline's own time and zone beside the same moment in Dhaka
function timesBlock(day, time, zone, label) {
  const dhaka = toDhaka(day, time, zone);
  return `<div class="source-times"><p><span>${esc(label)}, ${esc(ZONE_PLACES[zone] ?? zone)} time</span><strong>${esc(formatTime(time))}, ${esc(formatDay(day, { year: false }))}</strong></p>
    <p><span>In Dhaka</span><strong>${esc(formatTime(dhaka.time))}, ${esc(formatDay(dhaka.day, { year: false }))}</strong></p></div>`;
}

// Naming a page called just "Apply" or "Visa" with its publisher, so the link never reads like a button
function linkText(source) {
  return source.title.trim().split(/\s+/).length <= 2 ? `${source.publisher}: ${source.title}` : source.title;
}

function factBlock(ref, key, facts, today, { main = false, words = null } = {}) {
  if (!facts.has(ref)) {
    return "";
  }
  const fact = facts.fact(ref);
  const entry = facts.entry(ref, key);
  if (!entry) {
    return "";
  }
  const source = facts.source(ref, entry);
  const value = entry.value;
  let times = "";
  if (value.time && value.zone && value.date && readDate(value.date).precision === "day") {
    times = timesBlock(readDate(value.date).first, value.time, value.zone, "Published");
  } else if (value.time && value.zone && value.register) {
    times = timesBlock(readDate(value.register).first, value.time, value.zone, "Registration closes");
  }
  return `<div class="source-fact${main ? " is-main" : ""}">
    <p class="source-label">${esc(fact.label)}</p>
    ${words ? `<p class="source-value">${esc(words)}</p>` : ""}
    ${times}
    <p class="source-status">${icon(entry.status === "confirmed" ? "confirmed" : "info", " is-small")}${esc(statusWords(entry, source))}</p>
    ${entry.status === "expected" && entry.note ? `<p class="note">${esc(entry.note)}</p>` : ""}
    ${source ? `<p class="source-from"><span class="note">Source</span><a href="${esc(source.url)}">${esc(linkText(source))}</a><span class="note">${esc(source.publisher)}. Checked on ${esc(formatDay(readDate(entry.checked).first))}</span></p>` : ""}
  </div>`;
}

// Listing facts with their sources and the day each was checked, for a roadmap's information panel
export function renderFactList(items, facts, today) {
  return `${items.map(({ ref, key, words }) => factBlock(ref, key, facts, today, { words })).join("")}
    <p class="reading">Check the official site before you act.</p>`;
}

export function renderSource(step, facts, today) {
  const dateRefs = step.date?.refs ?? [];
  const main = dateRefs.find((item) => item.ref) ?? null;
  const sourceUrl = main && facts.has(main.ref) ? facts.source(main.ref, facts.entry(main.ref, main.key) ?? {})?.url : null;
  let how = "";
  if (!main && step.english?.booked) {
    how = `<p class="reading">This is the day you booked. Pathway counts the rest of your plan from it.</p>`;
  } else if (!main && step.date?.status === "own") {
    how = `<p class="reading">This comes from the date you entered. Pathway plans the steps before it for your date.</p>`;
  } else if (!main) {
    how = `<p class="reading">Pathway worked this date back from the steps after it, so every later step still fits.</p>`;
  }
  const keyOf = (ref) => (step.refs ?? []).find((item) => item.ref === ref)?.key ?? null;
  const related = (step.facts ?? []).filter((ref) => (!main || ref !== main.ref) && (!facts.has(ref) || !facts.fact(ref).values || keyOf(ref) !== null));
  return `<p class="source-step">${esc(step.title)}</p>
    <p class="source-date">${esc(dateWords(step.date, today, { year: true }))}</p>
    ${how}
    ${step.planning && !step.ownDeadline ? `<p class="step-planning">Pathway's planning date. ${esc(step.planning.text)}</p>` : ""}
    ${main ? factBlock(main.ref, main.key, facts, today, { main: true }) : ""}
    ${related.length > 0 ? `<p class="source-related">Facts this step uses</p>${related.map((ref) => factBlock(ref, keyOf(ref), facts, today)).join("")}` : ""}
    <p class="reading">Dates can change. Check the official site before you act.</p>
    ${sourceUrl ? `<a class="button-secondary" href="${esc(sourceUrl)}">Open the official page${icon("external", " is-small")}</a>` : ""}`;
}

// Keying each route item by a name that survives a redraw
function itemKey(item) {
  return item.dataset.step ?? `month ${item.textContent}`;
}

// Placing the route line: the faded rail runs through every station, the coloured part reaches
// the ring, so the line visibly travels as far as the student has come. Every position is read before
// anything is written, so the phone works out the layout once. With collect, it also returns where
// each item and the ring are on screen, for animating a change without measuring again
export function placeLine(root, { collect = false } = {}) {
  const map = root.querySelector(".route-map");
  if (!map) {
    return null;
  }
  const markers = [...map.querySelectorAll(".route-marker")];
  if (markers.length === 0) {
    return null;
  }
  const top = map.getBoundingClientRect().top;
  const centre = (element) => {
    const box = element.getBoundingClientRect();
    return box.top + box.height / 2 - top;
  };
  const first = centre(markers[0]);
  const last = centre(markers[markers.length - 1]);
  const here = map.querySelector(".route-step.is-here .route-marker");
  const reach = here ? centre(here) : last;
  const layout = { first, reach, mapTop: top, ring: here ? here.getBoundingClientRect().top : null, items: new Map() };
  if (collect) {
    for (const item of map.querySelector(".route-list").children) {
      const box = item.getBoundingClientRect();
      layout.items.set(itemKey(item), { top: box.top, bottom: box.bottom });
    }
  }
  const rail = map.querySelector(".route-rail");
  const travelled = map.querySelector(".route-travelled");
  rail.style.top = `${first}px`;
  rail.style.height = `${Math.max(0, last - first)}px`;
  travelled.style.top = `${first}px`;
  travelled.style.height = `${Math.max(0, reach - first)}px`;
  // Allowing for scroll: a shorter rail can make the page shorter, and the browser then pulls the
  // scroll back, so the positions just read are moved by however far the map itself moved
  const drift = collect ? map.getBoundingClientRect().top - top : 0;
  if (drift !== 0) {
    layout.mapTop += drift;
    layout.ring = layout.ring === null ? null : layout.ring + drift;
    for (const box of layout.items.values()) {
      box.top += drift;
      box.bottom += drift;
    }
  }
  return layout;
}

// Drawing the line in when the plan first appears
export function drawLine(root) {
  const travelled = root.querySelector(".route-travelled");
  if (!travelled || reducedMotion()) {
    return;
  }
  travelled.animate({ transform: ["scaleY(0)", "scaleY(1)"] }, { duration: ms("--dur-draw"), easing: token("--ease-draw") });
}

// Remembering where everything is before a step changes, so the change can be animated. Given a
// step, also where its card, title and date line are, for opening or closing it smoothly
export function measure(root, stepId = null) {
  const map = root.querySelector(".route-map");
  const layout = { first: 0, reach: 0, mapTop: 0, ring: null, items: new Map(), showing: new Set() };
  if (!map) {
    return layout;
  }
  layout.mapTop = map.getBoundingClientRect().top;
  const travelled = map.querySelector(".route-travelled");
  const box = travelled.getBoundingClientRect();
  layout.first = box.top - layout.mapTop;
  layout.reach = layout.first + box.height;
  const ring = map.querySelector(".route-step.is-here .route-marker");
  layout.ring = ring ? ring.getBoundingClientRect().top : null;
  layout.showing = new Set([...map.querySelectorAll(".step-card .step-details")].map((details) => details.closest(".route-step").dataset.step));
  for (const item of map.querySelector(".route-list").children) {
    const itemBox = item.getBoundingClientRect();
    layout.items.set(itemKey(item), { top: itemBox.top, bottom: itemBox.bottom });
  }
  layout.parts = stepId ? stepParts(root, stepId) : null;
  return layout;
}

// Measuring a step's card, title, date line and arrow against the step's own top-left corner
function stepParts(root, stepId) {
  const step = root.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"]`);
  if (!step) {
    return null;
  }
  const origin = step.getBoundingClientRect();
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top - origin.top, bottom: rect.bottom - origin.top, left: rect.left - origin.left, right: rect.right - origin.left };
  };
  // Reading the live card only, never the closing copy beside it
  const card = step.querySelector(".step-card");
  const chevron = card.querySelector(".step-chevron");
  const details = card.querySelector(".step-details");
  const ghost = step.querySelector(".step-ghost");
  return {
    card: box(card),
    head: box(card.querySelector(".step-head")),
    date: box(card.querySelector(".date-row")),
    chevron: chevron ? box(chevron) : null,
    // Catching a step mid-motion: the part of the card still showing, and how far its details had
    // faded in, so the next motion carries on from there instead of jumping
    shown: visibleBox(card, box(card)),
    detailsShown: details ? Number(getComputedStyle(details).opacity) : 0,
    ghost: ghost && Number(getComputedStyle(ghost).opacity) > 0.05 ? visibleBox(ghost, box(ghost)) : null,
  };
}

// Finding the part of an element that its inset clip-path leaves showing, in the same terms as its box
function visibleBox(element, rect) {
  const inset = getComputedStyle(element).clipPath.match(/^inset\(([^)]*?)(?: round [^)]*)?\)$/);
  if (!inset) {
    return rect;
  }
  const values = inset[1].trim().split(/\s+/).map(Number.parseFloat);
  const [top, right = top, bottom = top, left = right] = values;
  return { top: rect.top + top, right: rect.right - right, bottom: rect.bottom - bottom, left: rect.left + left };
}

// Gliding every item that moved from where it was. Items off screen before and after are left
// alone. The returned map says how far each item moved, or null for one that faded in, so things
// inside it can allow for that
function glideItems(list, before, after, timing) {
  const screenBottom = window.innerHeight;
  const limit = screenBottom * GLIDE_LIMIT;
  const seen = (box) => box.bottom > 0 && box.top < screenBottom;
  const shift = new Map();
  for (const item of list.children) {
    const key = itemKey(item);
    const was = before.items.get(key);
    const now = after.items.get(key);
    if (!was || !now) {
      continue;
    }
    const dy = was.top - now.top;
    if (Math.abs(dy) <= 0.5 || !(seen(was) || seen(now))) {
      continue;
    }
    if (Math.abs(dy) > limit) {
      shift.set(key, null);
      item.animate({ transform: [`translateY(${Math.sign(dy) * ARRIVE_DISTANCE}px)`, "translateY(0)"], opacity: [0, 1] }, timing);
    } else {
      shift.set(key, dy);
      item.animate({ transform: [`translateY(${dy}px)`, "translateY(0)"] }, timing);
    }
  }
  return shift;
}

// Moving the ring from where it was, less its step's own glide. A step that fades into place
// brings its ring with it, and a ring too far away fades in
function glideRing(list, before, after, shift, timing) {
  const hereStep = list.querySelector(".route-step.is-here");
  const ring = hereStep?.querySelector(".route-marker");
  const own = shift.get(hereStep?.dataset.step);
  if (!ring || before.ring === null || after.ring === null || own === null) {
    return;
  }
  const dy = before.ring - after.ring - (own ?? 0);
  if (Math.abs(dy) > window.innerHeight * GLIDE_LIMIT) {
    ring.animate({ opacity: [0, 1] }, timing);
  } else if (Math.abs(dy) > 1) {
    ring.animate({ transform: [`translateY(${dy}px)`, "translateY(0)"] }, timing);
  }
}

// Growing or shrinking the coloured line from where its end was, following the map if the map moved
function glideLine(travelled, before, after, timing) {
  if (!travelled || before.reach < before.first) {
    return;
  }
  const length = after.reach - after.first;
  const wasLength = before.reach - before.first;
  const moved = before.mapTop + before.first - (after.mapTop + after.first);
  // Fading in after a long move, along with the steps around it
  if (length > 0 && Math.abs(moved) > window.innerHeight * GLIDE_LIMIT) {
    travelled.animate({ opacity: [0, 1] }, timing);
    return;
  }
  if (length > 0 && (Math.abs(length - wasLength) > 0.5 || Math.abs(moved) > 0.5)) {
    travelled.animate({ transform: [`translateY(${moved}px) scaleY(${wasLength / length})`, "translateY(0) scaleY(1)"] }, timing);
  }
}

// Marking as done: the station fills, the line extends, the ring moves on to the next step, the
// steps below glide to their new places instead of jumping, and the count ticks up. Marking as not
// done runs the same motion backwards. With reduced motion, things change with a short fade and
// nothing moves
export function animateChange(root, before, after, stepIds, done = true) {
  const list = root.querySelector(".route-list");
  if (!list || !after) {
    return;
  }
  const changed = [...list.querySelectorAll(".route-step")].filter((item) => stepIds.includes(item.dataset.step)).map((item) => item.querySelector(".route-marker"));
  const hereStep = list.querySelector(".route-step.is-here");
  const ring = hereStep?.querySelector(".route-marker");
  const travelled = root.querySelector(".route-travelled");
  const counts = root.querySelectorAll("[data-done-count]");
  const newDetails = hereStep && !before.showing.has(hereStep.dataset.step) ? hereStep.querySelector(".step-card .step-details") : null;

  if (reducedMotion()) {
    const fade = { duration: ms("--dur-leave"), easing: "linear" };
    for (const element of [...changed, ring, newDetails, ...counts]) {
      element?.animate({ opacity: [0, 1] }, fade);
    }
    return;
  }

  const duration = ms("--dur-done");
  const easing = token("--ease-out");
  const timing = { duration, easing };

  const shift = glideItems(list, before, after, timing);
  // Staggering several steps marked done together, so they fill one after another down the route,
  // like progress travelling along the line, instead of all at once
  const gap = changed.length > 1 ? Math.min(MARKER_STAGGER, MARKER_STAGGER_TOTAL / (changed.length - 1)) : 0;
  changed.forEach((marker, index) => {
    marker.animate({ transform: [done ? "scale(0.6)" : "scale(1.25)", "scale(1)"] }, { ...timing, delay: index * gap, fill: "backwards" });
  });
  glideLine(travelled, before, after, timing);

  glideRing(list, before, after, shift, timing);
  newDetails?.animate({ opacity: [0, 1], transform: ["translateY(-6px)", "translateY(0)"] }, { duration: ms("--dur-enter"), easing });

  for (const element of counts) {
    element.animate({ transform: [done ? "translateY(40%)" : "translateY(-40%)", "translateY(0)"], opacity: [0, 1] }, timing);
  }
}

// Opening or closing a step as one smooth movement: the card grows down from the title as its
// details fade in, or a copy of it shrinks and fades when closing. The title and date slide to their
// new places, the arrow turns, and the steps below glide out of the way, so nothing jumps
export function animateToggle(root, before, after, stepId, open, ghost = null) {
  const list = root.querySelector(".route-list");
  const step = list?.querySelector(`.route-step[data-step="${CSS.escape(stepId)}"]`);
  const was = before.parts;
  const now = step ? stepParts(root, stepId) : null;
  if (!step || !was || !now || !after || reducedMotion()) {
    return;
  }
  const timing = { duration: ms("--dur-expand"), easing: token("--ease-standard") };
  const radius = token("--radius-control");
  const shift = glideItems(list, before, after, timing);
  glideLine(root.querySelector(".route-travelled"), before, after, timing);
  glideRing(list, before, after, shift, timing);

  // Sliding the title and date line
  const moved = (key) => ({ x: was[key].left - now[key].left, y: was[key].top - now[key].top });
  for (const [selector, key] of [[".step-card .step-head", "head"], [".step-card .date-row", "date"]]) {
    const { x, y } = moved(key);
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      step.querySelector(selector).animate({ transform: [`translate(${x}px, ${y}px)`, "translate(0, 0)"] }, timing);
    }
  }

  // Moving the arrow from its own old place, less the title's slide that it shares, while it turns.
  // It sits at the end of the title, which changes width as the card's padding changes
  const chevron = step.querySelector(".step-card .step-chevron");
  if (chevron && was.chevron && now.chevron) {
    const head = moved("head");
    const own = moved("chevron");
    const from = `translate(${own.x - head.x}px, ${own.y - head.y}px) rotate(${open ? 90 : -90}deg)`;
    chevron.animate({ transform: [from, `translate(0, 0) rotate(${open ? -90 : 90}deg)`] }, timing);
  }

  // Expressing how far one box sits inside another as a clip-path inset. Where the inner box reaches
  // further out, the inset is negative, so nothing near the edge, such as the arrow, is ever cut off
  const insetFrom = (outer, inner) => [inner.top - outer.top, outer.right - inner.right, outer.bottom - inner.bottom, inner.left - outer.left]
    .map((value) => `${Math.round(value * 10) / 10}px`).join(" ");

  if (open) {
    // Revealing the card from the size the closed step took up, growing downwards. If the step was
    // still closing, it grows back from the part of the closing copy that was still showing
    const card = step.querySelector(".step-card");
    const style = getComputedStyle(card);
    const from = was.ghost ?? was.card;
    const surface = was.ghost ? [style.backgroundColor, style.backgroundColor] : ["transparent", style.backgroundColor];
    const edge = was.ghost ? [style.borderTopColor, style.borderTopColor] : ["transparent", style.borderTopColor];
    card.animate({
      clipPath: [`inset(${insetFrom(now.card, from)} round ${radius})`, `inset(0 0 0 0 round ${radius})`],
      backgroundColor: surface,
      borderColor: edge,
    }, timing);
    step.querySelector(".step-card .step-details")?.animate({ opacity: [0, 0, 1], offset: [0, 0.2, 1] }, timing);
    return;
  }

  // Closing with a copy of the open card, kept only for the motion, that shrinks up into the closed
  // step while its details fade. The steps below rise with it, and the real title and date stay live
  if (!ghost) {
    return;
  }
  // Keeping only its own class, so the closed step's styles never reshape it
  ghost.className = "step-ghost";
  ghost.setAttribute("aria-hidden", "true");
  ghost.inert = true;
  for (const part of ghost.querySelectorAll(".step-head, .date-row")) {
    part.style.visibility = "hidden";
  }
  Object.assign(ghost.style, { top: `${was.card.top}px`, left: `${was.card.left}px`, width: `${was.card.right - was.card.left}px` });
  // Placing it before the real card, which is drawn over it, so the live title and date stay on top
  step.querySelector(".step-card").before(ghost);
  const held = { ...timing, fill: "forwards" };
  // Starting from whatever an unfinished opening revealed
  const shrink = ghost.animate({
    clipPath: [`inset(${insetFrom(was.card, was.shown)} round ${radius})`, `inset(${insetFrom(was.card, now.card)} round ${radius})`],
    opacity: [1, 1, 0],
    offset: [0, 0.6, 1],
  }, held);
  ghost.querySelector(".step-details")?.animate({ opacity: [was.detailsShown, 0, 0], offset: [0, 0.45, 1] }, held);
  shrink.finished.catch(() => { }).finally(() => ghost.remove());
}
