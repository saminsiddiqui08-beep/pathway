import { addMonths, dayFromParts, daysInMonth, formatDay, formatMonth, partsFromDay, readDate, readDay, shift } from "../../app/dates.js";
import { dateRange, durationOf, observedEntry } from "../../app/facts.js";
import { moneyText } from "../../app/money.js";

// Refusing any other plan format outright, instead of planning it wrongly
export const PLAN_FORMAT = 1;

// Following the approved urgency rules: red only when a step's latest start is this close or has passed,
// and "Little spare time" below this much slack, never red on its own
const URGENT_DAYS = 14;
const LITTLE_SPARE_DAYS = 21;
// Showing no urgency at all for a step more than this many days away, such as a class 9 student's
// application, since nothing that far ahead needs the student yet
const CALM_BEYOND_DAYS = 365;

const INTAKE_OPTIONS = 4;
const MONTH_SEARCH = 120;

// Generating SAT months this many years past the year of the last listed test
const PATTERN_YEARS = 4;
const STAGES = ["prepare", "test", "apply", "results", "permit", "arrive"];
const TEST_NAMES = { ielts: "IELTS", toefl: "TOEFL iBT", duolingo: "the Duolingo English Test", pte: "PTE Academic" };
const RESULT_FACTS = { ielts: "bd/ielts.bd.resultTime", toefl: "bd/toefl.resultTime", duolingo: "bd/duolingo.resultTime", pte: "bd/pte.resultTime" };

export class PlanError extends Error { }

// Signalling a date that cannot be found in the facts, such as an intake beyond the last researched cycle
class MissingFact extends Error { }

function matches(when, ctx) {
  if (!when) {
    return true;
  }
  return Object.entries(when).every(([field, wanted]) => {
    if (field === "ieltsAtLeast") {
      return ctx.englishTest === "ielts" && ctx.englishStatus === "score" && ctx.englishScore >= wanted;
    }
    // Counting a held SAT score only when it reaches the minimum; any other SAT answer passes
    if (field === "satScoreAtLeast") {
      return ctx.satStatus !== "score" || ctx.satScore >= wanted;
    }
    // Telling apart a student still at school in the intake year, whose final certificate comes late
    if (field === "schoolInIntakeYear") {
      return (Number(ctx.schoolYear) === ctx.cycle) === wanted;
    }
    return (Array.isArray(wanted) ? wanted : [wanted]).includes(ctx[field]);
  });
}

// Accepting one value, or a list of { when, value } choices where the first match wins
function pick(field, ctx) {
  if (Array.isArray(field) && field.length > 0 && field.every((item) => item && typeof item === "object" && "value" in item)) {
    const chosen = field.find((item) => matches(item.when, ctx));
    return chosen ? chosen.value : null;
  }
  return field ?? null;
}

// Leaving out soft dependencies, which order the route on screen but never make a plan late
function afterIds(step, ctx) {
  return (step.after ?? [])
    .filter((item) => typeof item === "string" || (!item.soft && matches(item.when, ctx)))
    .map((item) => (typeof item === "string" ? item : item.step));
}

// Reading a date range cautiously in the planned run and hopefully in the shortest run:
// a deadline as its first (or last) day, something waited for as its last (or first) day
function readRange(range, role, mode) {
  // Taking a window's opening as its first day in both runs: if it opens late, it also closes late
  if (role === "opens") {
    return range.first;
  }
  const cautious = mode === "planned";
  if (role === "deadline") {
    return cautious ? range.first : range.last;
  }
  return cautious ? range.last : range.first;
}

function assumptionOf(env, id) {
  const found = env.assumptions[id];
  if (!found) {
    throw new PlanError(`No assumption ${id}`);
  }
  env.usedAssumptions.add(id);
  return found;
}

// Dropping planned-only assumptions in the shortest run, so they never decide reachability
function activeAssumption(env, id) {
  const found = assumptionOf(env, id);
  return found.mode === "planned" && env.mode === "minimal" ? null : found;
}

function keyFor(env, factRecord) {
  switch (factRecord.keyedBy) {
    case "cycle":
      return String(env.ctx.cycle);
    case "hscYear":
      return String(env.ctx.schoolYear);
    default:
      throw new PlanError(`Cannot choose a key for ${factRecord.ref}`);
  }
}

// Resolving a date reference to a range of days, or null when it does not apply in this run
function resolveDate(ref, env) {
  if (ref === null || ref === undefined) {
    return null;
  }
  let range;
  let basis;
  if (ref.fact) {
    const record = env.facts.fact(ref.fact);
    const key = record.values ? keyFor(env, record) : null;
    const entry = env.facts.entry(ref.fact, key);
    if (!entry) {
      throw new MissingFact(`${ref.fact} has no value for ${key}`);
    }
    range = dateRange(entry.value, ref.part ?? (record.kind === "window" ? "to" : "date"));
    basis = { status: entry.status, refs: [{ ref: ref.fact, key }] };
  } else if (ref.cycleDate) {
    const [month, day] = ref.cycleDate.split("-").map(Number);
    const dayNumber = dayFromParts(env.ctx.cycle + (ref.yearOffset ?? 0), month, day);
    range = { first: dayNumber, last: dayNumber, precision: "day" };
    basis = { status: "planning", refs: [] };
    if (ref.assumption) {
      assumptionOf(env, ref.assumption);
    }
  } else if (ref.start) {
    range = env.start.range;
    basis = env.start.basis;
  } else if (ref.route) {
    // Preferring the student's own application deadline, when they entered one, to the route's
    const routeDeadline = env.ownRoute ?? resolveDate(env.route.deadline, env);
    if (!routeDeadline) {
      return null;
    }
    range = routeDeadline.range;
    basis = routeDeadline.basis;
  } else if (ref.step) {
    const target = env.fixedRanges.get(ref.step);
    if (!target) {
      return null;
    }
    range = target.range;
    basis = target.basis;
  } else if (ref.intake) {
    range = env.intakeRange;
    basis = { status: "answer", refs: [] };
  } else if (ref.monthOf) {
    const record = env.facts.fact(ref.monthOf);
    if (!record.value.months.includes(ref.month)) {
      throw new PlanError(`${ref.monthOf} has no month ${ref.month}`);
    }
    const year = env.ctx.cycle + (ref.yearOffset ?? 0);
    range = { first: dayFromParts(year, ref.month, 1), last: dayFromParts(year, ref.month, daysInMonth(year, ref.month)), precision: "month" };
    basis = { status: record.status, refs: [{ ref: ref.monthOf, key: null }] };
  } else {
    throw new PlanError(`Unknown date reference ${JSON.stringify(ref)}`);
  }
  if (ref.offset) {
    const offset = resolveOffset(ref.offset, env);
    if (offset === null) {
      return null;
    }
    range = {
      first: shift(range.first, offset.amount, offset.unit, offset.direction),
      last: shift(range.last, offset.amount, offset.unit, offset.direction),
      precision: range.precision,
    };
  }
  return { range, basis };
}

// Reading an offset written with an assumption as "this long before", always
function resolveOffset(offset, env) {
  if (offset.assumption) {
    const found = activeAssumption(env, offset.assumption);
    return found ? { amount: found.amount, unit: found.unit, direction: -1 } : null;
  }
  return { amount: Math.abs(offset.amount), unit: offset.unit, direction: Math.sign(offset.amount) || 1 };
}

const ZERO = { amount: 0, unit: "days" };

function resolveDuration(ref, env) {
  if (!ref) {
    return ZERO;
  }
  if (ref.fact) {
    const record = env.facts.fact(ref.fact);
    const entry = ref.observed ? observedEntry(record, env.today) : record;
    return durationOf(entry.value, ref.variant ?? null);
  }
  if (ref.assumption) {
    const found = activeAssumption(env, ref.assumption);
    if (!found) {
      return ZERO;
    }
    const amount = typeof found.amount === "object" ? found.amount[env.ctx[ref.by]] : found.amount;
    return { amount, unit: found.unit };
  }
  return { amount: ref.amount, unit: ref.unit };
}

// Reading the English answer for this country: a test it does not accept, or "not needed" where
// Pathway cannot know that, is planned as no score yet, and the plan says why
function englishFor(answers, plan) {
  const english = answers.english ?? { status: "none" };
  const allowed = plan?.englishTests ?? Object.keys(TEST_NAMES);
  if (english.status === "waived" && !plan?.englishWaiver) {
    return { english: { status: "none", test: english.test }, note: "englishWaivedElsewhere" };
  }
  if (english.test && !allowed.includes(english.test)) {
    return { english: { status: "none" }, note: "englishNotAccepted", refused: english.test };
  }
  return { english, note: null };
}

function buildContext(answers, cycle, route, plan = null) {
  const { english, note, refused } = englishFor(answers, plan);
  const school = answers.school;
  return {
    country: answers.country,
    cycle,
    route,
    system: school?.system,
    schoolYear: school?.year,
    schoolSession: school?.session ?? "summer",
    englishStatus: english.status,
    englishTest: english.test ?? "ielts",
    englishScore: english.score ?? null,
    englishDate: english.date ?? null,
    englishTaken: english.taken ?? null,
    englishExpires: null,
    englishNote: note,
    englishRefused: refused ?? null,
    satStatus: answers.sat?.status ?? "no",
    satDate: answers.sat?.date ?? null,
    satScore: answers.sat?.score ?? null,
    aid: answers.aid,
    tier: answers.tier,
    passport: answers.passport,
  };
}

function stepTable(common, plan) {
  const table = new Map();
  for (const step of common.steps) {
    table.set(step.id, { ...step, common: true });
  }
  for (const step of plan.steps) {
    if (table.has(step.id)) {
      throw new PlanError(`Step ${step.id} is defined twice`);
    }
    table.set(step.id, { ...step, common: false });
  }
  return table;
}

// Choosing the steps that apply, with dependencies passing through steps that do not
function chooseSteps(table, ctx) {
  const applies = (step) => matches(step.when, ctx);
  const resolved = new Map();

  function realDeps(id, seen = new Set()) {
    if (seen.has(id)) {
      throw new PlanError(`Steps wait for each other in a loop at ${id}`);
    }
    const step = table.get(id);
    if (!step) {
      throw new PlanError(`Unknown step ${id}`);
    }
    if (applies(step)) {
      return [id];
    }
    return afterIds(step, ctx).flatMap((dep) => realDeps(dep, new Set([...seen, id])));
  }

  const chosen = new Set([...table.values()].filter((step) => !step.common && applies(step)).map((step) => step.id));
  const queue = [...chosen];
  while (queue.length > 0) {
    const id = queue.pop();
    const deps = [...new Set(afterIds(table.get(id), ctx).flatMap((dep) => realDeps(dep)))];
    resolved.set(id, deps);
    for (const dep of deps) {
      if (!chosen.has(dep)) {
        chosen.add(dep);
        queue.push(dep);
      }
    }
  }

  // Ordering so every step comes after the steps it waits for
  const order = [];
  const state = new Map();
  function visit(id, path) {
    if (state.get(id) === "done") {
      return;
    }
    if (state.get(id) === "active") {
      throw new PlanError(`Steps wait for each other in a loop: ${[...path, id].join(" > ")}`);
    }
    state.set(id, "active");
    for (const dep of resolved.get(id)) {
      visit(dep, [...path, id]);
    }
    state.set(id, "done");
    order.push(id);
  }
  const tableOrder = [...table.keys()];
  for (const id of tableOrder.filter((item) => chosen.has(item))) {
    visit(id, []);
  }
  return { order, deps: resolved };
}

function satCandidates(env) {
  const record = env.facts.fact("bd/sat.administrations");
  const scoreDelay = durationOf(env.facts.fact("bd/sat.scoreDelay").value);
  const registerLead = env.facts.fact("bd/sat.registerLead").value.number;
  const lateLead = env.facts.fact("bd/sat.lateRegisterLead").value.number;
  const listed = record.values.map((item) => {
    const test = readDay(item.value.test);
    const register = item.value.register ? readDay(item.value.register) : test - registerLead;
    const late = item.value.lateRegister ? readDay(item.value.lateRegister) : test - lateLead;
    const scores = item.value.scoresColleges ? readDay(item.value.scoresColleges) : shift(test, scoreDelay.amount, scoreDelay.unit);
    return { test, testLast: test, precision: "day", register: env.mode === "planned" ? register : late, regular: register, late, scores, status: item.status, key: item.key };
  });

  // Filling in College Board's usual months after the last listed test, read as whole months:
  // the cautious run counts registration back from the first day and scores on from the last
  const pattern = env.facts.fact("bd/sat.monthPattern").value.months;
  const lastListed = listed.length > 0 ? listed[listed.length - 1].test : env.today;
  const lastYear = partsFromDay(lastListed).year;
  const generated = [];
  for (let year = lastYear; year <= lastYear + PATTERN_YEARS; year += 1) {
    for (const month of [...pattern].sort((a, b) => a - b)) {
      const first = dayFromParts(year, month, 1);
      const last = dayFromParts(year, month, daysInMonth(year, month));
      if (first <= lastListed) {
        continue;
      }
      const cautious = env.mode === "planned";
      const test = cautious ? last : first;
      generated.push({
        test: first,
        testLast: last,
        precision: "month",
        register: cautious ? first - registerLead : last - lateLead,
        regular: first - registerLead,
        late: last - lateLead,
        scores: shift(test, scoreDelay.amount, scoreDelay.unit),
        status: "expected",
        key: `${year}-${String(month).padStart(2, "0")}`,
      });
    }
  }
  return [...listed, ...generated];
}

function englishTiming(env) {
  const test = env.ctx.englishTest ?? assumptionOf(env, "defaultTest").value;
  // Booking a centre test 2 weeks ahead in the calm plan (Duolingo needs no booking); the shortest run
  // allows only the week TOEFL's regular registration needs
  const booking = assumptionOf(env, env.mode === "planned" ? "englishBooking" : "englishBookingShortest").amount[test];
  const result = durationOf(env.facts.fact(RESULT_FACTS[test]).value);
  const send = test === "toefl" ? durationOf(env.facts.fact("bd/toefl.toInstitutions").value) : null;
  return { test, booking, result, send };
}

// Adding the result wait, plus any sending time, to a test day
function englishReady(timing, testDay) {
  let ready = shift(testDay, timing.result.amount, timing.result.unit);
  if (timing.send) {
    ready = shift(ready, timing.send.amount, timing.send.unit);
  }
  return ready;
}

function englishLatestTest(timing, readyBy) {
  let day = readyBy;
  if (timing.send) {
    day = shift(day, timing.send.amount, timing.send.unit, -1);
  }
  return shift(day, timing.result.amount, timing.result.unit, -1);
}

// Spanning the HSC result window, or both A level boards' result days for the student's series
function schoolRange(env) {
  const { system, schoolYear, schoolSession } = env.ctx;
  if (system === "hsc") {
    const entry = env.facts.entry("bd/hsc.results", schoolYear);
    const finished = entry ? null : finishedSchool(env, "bd/hsc.results", schoolYear);
    if (finished) {
      return finished;
    }
    if (!entry) {
      throw new MissingFact(`No HSC ${schoolYear} results in the facts`);
    }
    return { range: { first: dateRange(entry.value, "from").first, last: dateRange(entry.value, "to").last, precision: "day" }, basis: { status: entry.status, refs: [{ ref: "bd/hsc.results", key: String(schoolYear) }] } };
  }
  const series = schoolSession === "winter"
    ? [["bd/alevel.cambridge.results", `${schoolYear}-11`], ["bd/alevel.edexcel.results", `${schoolYear}-10`]]
    : [["bd/alevel.cambridge.results", `${schoolYear}-06`], ["bd/alevel.edexcel.results", `${schoolYear}-06`]];
  const found = series.map(([ref, key]) => ({ ref, key, entry: env.facts.entry(ref, key) }));
  if (found.every((item) => !item.entry) && found.every((item) => finishedSchool(env, item.ref, item.key))) {
    return finishedSchool(env, found[0].ref, found[0].key);
  }
  if (found.some((item) => !item.entry)) {
    throw new MissingFact(`No A level ${schoolYear} ${schoolSession} results in the facts`);
  }
  const ranges = found.map((item) => dateRange(item.entry.value));
  return {
    range: { first: Math.min(...ranges.map((range) => range.first)), last: Math.max(...ranges.map((range) => range.last)), precision: ranges.some((range) => range.precision === "month") ? "month" : "day" },
    basis: { status: found.some((item) => item.entry.status === "expected") ? "expected" : found[0].entry.status, refs: found.map(({ ref, key }) => ({ ref, key })) },
  };
}

// Treating a school year earlier than every year in the facts as finished, results included.
// Placing it on the day before today means nothing waits for it and it is not shown
function finishedSchool(env, ref, wanted) {
  const keys = env.facts.keys(ref);
  if (keys.length > 0 && String(wanted) < keys[0]) {
    return { range: { first: env.today - 1, last: env.today - 1, precision: "day" }, basis: { status: "answer", refs: [] } };
  }
  return null;
}

// Finding when the final school exams end: the HSC timetable, or the month of the A level series
function examsRange(env) {
  const { system, schoolYear, schoolSession } = env.ctx;
  if (system === "hsc") {
    const entry = env.facts.entry("bd/hsc.exams", schoolYear);
    if (!entry) {
      const finished = finishedSchool(env, "bd/hsc.exams", schoolYear);
      if (finished) {
        return finished;
      }
      throw new MissingFact(`No HSC ${schoolYear} exams in the facts`);
    }
    return { range: dateRange(entry.value, "to"), basis: { status: entry.status, refs: [{ ref: "bd/hsc.exams", key: String(schoolYear) }] } };
  }
  const month = schoolSession === "winter" ? 11 : 6;
  const first = dayFromParts(Number(schoolYear), month, 1);
  if (dayFromParts(Number(schoolYear), month, daysInMonth(Number(schoolYear), month)) < env.today) {
    return { range: { first: env.today - 1, last: env.today - 1, precision: "day" }, basis: { status: "answer", refs: [] } };
  }
  return { range: { first, last: dayFromParts(Number(schoolYear), month, daysInMonth(Number(schoolYear), month)), precision: "month" }, basis: { status: "answer", refs: [] } };
}

function earlierOf(a, b) {
  return b && (!a || b.day < a.day) ? b : a;
}

// Running one pass of the critical path method for one cycle, route and mode
function runOnce(env) {
  const { table, order, deps, today, ticks } = env;
  const successors = new Map(order.map((id) => [id, []]));
  for (const id of order) {
    for (const dep of deps.get(id)) {
      successors.get(dep).push(id);
    }
  }

  // Resolving fixed dates first, because other steps may count from them
  env.fixedRanges = new Map();
  const info = new Map();
  for (const id of order) {
    const step = table.get(id);
    const item = { id, step, deps: deps.get(id), done: Boolean(ticks[id]), doneOn: ticks[id] ? readDay(ticks[id]) : null };
    if (step.special === "school") {
      item.fixed = schoolRange(env);
    } else if (step.special === "exams") {
      item.fixed = examsRange(env);
    } else if (step.fixed) {
      item.fixed = resolveDate(pick(step.fixed, env.ctx), env);
    }
    if (item.fixed) {
      env.fixedRanges.set(id, item.fixed);
    }
    info.set(id, item);
  }

  for (const id of order) {
    const item = info.get(id);
    const { step } = item;
    item.duration = resolveDuration(pick(step.duration, env.ctx), env);
    const spare = step.spare ? resolveDuration(step.spare, env) : ZERO;
    item.spare = spare;
    const own = ownable(step, env) ? ownDateFor(env, id) : null;
    const ownDeadline = own ? { range: readDate(own), basis: { status: "own", refs: [] } } : resolveDate(pick(step.deadline, env.ctx), env);
    item.deadline = ownDeadline ? { day: readRange(ownDeadline.range, "deadline", env.mode), precision: ownDeadline.range.precision, status: ownDeadline.basis.status, refs: ownDeadline.basis.refs } : null;
    const opens = resolveDate(pick(step.opens, env.ctx), env);
    item.opens = opens ? { day: readRange(opens.range, "opens", env.mode), precision: opens.range.precision, status: opens.basis.status, refs: opens.basis.refs } : null;
    if (item.fixed) {
      item.fixedStart = { day: readRange(item.fixed.range, "deadline", env.mode), precision: item.fixed.range.precision, status: item.fixed.basis.status, refs: item.fixed.basis.refs };
      item.fixedEnd = { day: readRange(item.fixed.range, "wait", env.mode), precision: item.fixed.range.precision, status: item.fixed.basis.status, refs: item.fixed.basis.refs };
    }
  }

  // Moving a finish forward, or a latest finish back, through a step's spare time
  const withSpare = (point, spare) => (point ? { ...point, day: shift(point.day, spare.amount, spare.unit) } : point);
  const minusSpare = (point, spare) => (point ? { ...point, day: shift(point.day, spare.amount, spare.unit, -1) } : point);
  const todayPoint = { day: today, precision: "day", status: "today", refs: [] };

  // Walking forward from today to find the earliest each step can start and finish
  const englishTimingCache = { value: null };
  for (const id of order) {
    const item = info.get(id);
    const { step } = item;
    let start = todayPoint;
    item.driver = null;
    if (item.opens && item.opens.day > start.day) {
      start = item.opens;
    }
    for (const dep of item.deps) {
      const before = info.get(dep);
      if (before.step.undated) {
        continue;
      }
      const ready = withSpare(before.finish, before.spare);
      if (ready && ready.day > start.day) {
        start = ready;
        item.driver = dep;
      }
    }
    item.start = start;
    if (item.done) {
      item.finish = { day: Math.min(item.doneOn, today), precision: "day", status: "done", refs: [] };
      continue;
    }
    if (step.undated) {
      item.finish = null;
      continue;
    }
    if (item.fixed) {
      item.finish = item.fixedEnd;
      item.blocked = start.day > item.fixedStart.day && start.day > today;
      continue;
    }
    if (step.special === "sat") {
      item.candidates = satCandidates(env);
      // Keeping only the booked sitting, already registered for, so registration never lies ahead
      if (env.ctx.satStatus === "booked" && env.ctx.satDate) {
        const bookedDay = readDay(env.ctx.satDate);
        item.candidates = item.candidates.filter((candidate) => candidate.test === bookedDay);
        if (item.candidates.length === 0) {
          item.candidates = [{ test: bookedDay, register: bookedDay, regular: bookedDay, late: bookedDay, scores: shift(bookedDay, 17, "days"), status: "answer", key: env.ctx.satDate }];
        }
        item.candidates.forEach((candidate) => { candidate.register = Math.min(candidate.register, today); });
      }
      const booked = env.ctx.satStatus === "booked" && env.ctx.satDate;
      item.firstTest = booked
        ? item.candidates[0]
        : item.candidates.find((candidate) => candidate.register >= today && candidate.test >= start.day) ?? null;
      item.finish = item.firstTest ? { day: item.firstTest.scores, precision: "day", status: item.firstTest.status, refs: [{ ref: "bd/sat.administrations", key: item.firstTest.key }] } : { day: Infinity, precision: "day", status: "none", refs: [] };
      continue;
    }
    if (step.special === "english") {
      englishTimingCache.value ??= englishTiming(env);
      const timing = englishTimingCache.value;
      item.english = timing;
      if (env.ctx.englishStatus === "booked" && env.ctx.englishDate) {
        const testDay = readDay(env.ctx.englishDate);
        item.testDay = testDay;
        item.finish = { day: Math.max(englishReady(timing, testDay), today), precision: "day", status: "answer", refs: [] };
      } else {
        const testDay = start.day + timing.booking;
        item.testDay = testDay;
        item.finish = { day: englishReady(timing, testDay), precision: "day", status: start.status, refs: [] };
      }
      continue;
    }
    item.finish = { ...start, day: shift(start.day, item.duration.amount, item.duration.unit) };
  }

  // Walking backward to find the latest each step can finish and start without missing a deadline
  for (const id of [...order].reverse()) {
    const item = info.get(id);
    const { step } = item;
    let latest = item.deadline;
    for (const after of successors.get(id)) {
      const later = info.get(after);
      if (later.step.undated) {
        continue;
      }
      latest = earlierOf(latest, later.latestStart);
    }
    item.latestFinish = minusSpare(latest, item.spare);
    const end = item.latestFinish;
    if (item.done || step.undated) {
      item.latestStart = null;
      continue;
    }
    if (item.fixed) {
      item.latestStart = item.fixedStart;
      continue;
    }
    if (step.special === "sat") {
      const usable = item.candidates.filter((candidate) => !end || candidate.scores <= end.day);
      item.lastTest = usable.length > 0 ? usable[usable.length - 1] : null;
      item.latestStart = item.lastTest ? { day: item.lastTest.test, precision: item.lastTest.precision, status: item.lastTest.status, refs: [] } : { day: -Infinity, precision: "day", status: "none", refs: [] };
      const satBooked = item.lastTest && env.ctx.satStatus === "booked" && env.ctx.satDate;
      // Releasing a booked SAT already sat: nothing waits on its day any more, and it is never urgent
      if (satBooked && item.lastTest.test < today) {
        item.latestStart = null;
        item.urgentBy = null;
        continue;
      }
      // Marking a booked SAT as a fixed day: anything it waits for must be ready by then
      if (satBooked) {
        item.latestStart = { ...item.latestStart, booked: "sat" };
      }
      item.urgentBy = item.lastTest ? item.lastTest.register : null;
      continue;
    }
    if (step.special === "english") {
      const timing = item.english;
      if (env.ctx.englishStatus === "booked" && env.ctx.englishDate && item.testDay < today) {
        // Releasing a booked test already sat, so a passport it needed can no longer be late for it
        item.latestStart = null;
      } else if (env.ctx.englishStatus === "booked" && env.ctx.englishDate) {
        // Holding a booked test to its day, with or without a deadline after it: a passport it needs
        // must arrive by then. The mark lets the explanation say the booking is the problem
        item.latestStart = { day: item.testDay, precision: "day", status: "answer", refs: [], booked: "english" };
      } else if (!end) {
        item.latestStart = null;
      } else {
        item.latestTest = englishLatestTest(timing, end.day);
        item.latestStart = { ...end, day: item.latestTest - timing.booking };
      }
      continue;
    }
    item.latestStart = end ? { ...end, day: shift(end.day, item.duration.amount, item.duration.unit, -1) } : null;
  }

  // Marking every step that cannot fit, and the chain of steps that pushed the first one late
  let failure = null;
  for (const id of order) {
    const item = info.get(id);
    // Letting an optional event, which nothing waits for, never decide that a plan fails
    if (item.done || item.step.undated || item.step.optional) {
      continue;
    }
    let late;
    if (item.fixed) {
      late = item.blocked || (item.latestFinish && item.fixedEnd.day > item.latestFinish.day);
    } else if (item.step.special === "sat") {
      late = !item.firstTest || !item.lastTest || item.firstTest.test > item.lastTest.test;
    } else {
      late = Boolean(item.latestFinish) && item.finish.day > item.latestFinish.day;
    }
    // Judging a strict step by the cautious reading of the dates it waits for, even in the shortest run:
    // HSC results expected "in August or September" cannot be counted on for an early August deadline
    if (!late && item.step.strict && item.latestFinish && !item.done) {
      const ready = Math.max(today, ...item.deps.map((dep) => {
        const before = info.get(dep);
        return before.fixed ? readRange(before.fixed.range, "wait", "planned") : before.finish?.day ?? -Infinity;
      }));
      item.strictFinish = shift(ready, item.duration.amount, item.duration.unit);
      late = item.strictFinish > item.latestFinish.day;
    }
    item.late = late;
    if (late && !failure) {
      const chain = [];
      let cursor = id;
      while (cursor) {
        chain.unshift(cursor);
        cursor = info.get(cursor).driver;
      }
      failure = { step: id, chain };
    }
  }
  return { info, failure };
}

// Listing the routes to try, in order; a route the student chose comes first when it is open to them
function routeList(plan, ctx, preferred = null) {
  const order = pick(plan.routeOrder, ctx);
  const routes = plan.routes ?? [{ id: "main" }];
  const ordered = (order ? order.map((id) => routes.find((route) => route.id === id)) : routes)
    .filter((route) => route && matches(route.when, { ...ctx, route: route.id }));
  const chosen = ordered.find((route) => route.id === preferred);
  return chosen ? [chosen, ...ordered.filter((route) => route !== chosen)] : ordered;
}

function startFor(plan, route, env) {
  const ownStart = env.overrides.starts?.[intakeKey(env)];
  if (ownStart) {
    return { range: readDate(ownStart), basis: { status: "own", refs: [] } };
  }
  const ref = pick(route.start, env.ctx) ?? plan.start;
  const resolved = resolveDate(ref, env);
  if (!resolved) {
    throw new PlanError("A plan needs a start date");
  }
  return resolved;
}

function intakeRangeFor(answers) {
  const month = answers.intake?.month;
  if (!month) {
    return null;
  }
  return readDate(month);
}

// Naming the intake as own dates do: the start month where a plan offers months (Malaysia),
// otherwise the intake year
function intakeKey(env) {
  return env.answers.intake?.month ?? String(env.ctx.cycle);
}

// Keying the student's own date as "step@route@intake": the early and regular rounds have
// different deadlines, and every intake has its own, so a date never carries into another
function ownDateFor(env, id) {
  return env.overrides.deadlines?.[`${id}@${env.route.id}@${intakeKey(env)}`] ?? null;
}

// Allowing the student's own date only where the plan file marks a step with ownDate: steps whose
// date a university sets, such as the application deadline. Pathway's own advice, such as
// choosing universities 8 weeks before the first deadline, has no "own date". The step must also
// be using a planning date in this route, because an official date needs no replacing
function ownable(step, env) {
  return pick(step.ownDate, env.ctx) === true && Boolean(pick(step.planning, env.ctx));
}

// Treating an own date on the step whose deadline is the route's deadline as the student's own
// application deadline. It replaces the route's deadline for every step that counts from it,
// so the essays and the list of universities move with it
function ownRouteDeadline(env) {
  for (const step of env.table.values()) {
    const deadline = pick(step.deadline, env.ctx);
    const own = deadline?.route && !deadline.offset && matches(step.when, env.ctx) && ownable(step, env) ? ownDateFor(env, step.id) : null;
    if (own) {
      return { range: readDate(own), basis: { status: "own", refs: [] } };
    }
  }
  return null;
}

function makeEnv(base, cycle, route, mode) {
  const ctx = buildContext(base.answers, cycle, route.id, base.plan);
  const env = {
    ...base,
    ctx,
    route,
    mode,
    usedAssumptions: new Set(),
    intakeRange: intakeRangeFor(base.answers),
  };
  // Settling the own deadline and the start first, since English validity is measured against them
  env.ownRoute = ownRouteDeadline(env);
  env.start = startFor(base.plan, route, env);
  applyEnglishValidity(env);
  const { order, deps } = chooseSteps(base.table, ctx);
  env.order = order;
  env.deps = deps;
  return env;
}

const VALIDITY_FACTS = { ielts: "bd/ielts.validity", toefl: "bd/toefl.validity", duolingo: "bd/duolingo.validity", pte: "bd/pte.validity" };

// Counting a held English score only while it is valid when applications close (or, with no
// application deadline, when studies begin). The planned run reads the month a score was taken
// as its first day, so it expires as early as it could; the shortest run reads it as its last day
function applyEnglishValidity(env) {
  const { ctx } = env;
  if (ctx.englishStatus !== "score" || !ctx.englishTaken) {
    return;
  }
  const taken = readDate(ctx.englishTaken);
  const validity = durationOf(env.facts.fact(VALIDITY_FACTS[ctx.englishTest]).value);
  const expires = shift(env.mode === "planned" ? taken.first : taken.last, validity.amount, validity.unit);
  const deadline = pick(env.route.deadline, ctx);
  const needed = deadline ? env.ownRoute ?? resolveDate(deadline, env) : env.start;
  ctx.englishExpires = expires;
  if (needed && expires <= readRange(needed.range, "deadline", env.mode)) {
    ctx.englishStatus = "none";
    ctx.englishExpired = true;
  }
}

// Trying one route in one cycle: the shortest run decides reachability, the planned run the dates
function tryRoute(base, cycle, route) {
  try {
    const minimalEnv = makeEnv(base, cycle, route, "minimal");
    const minimal = runOnce(minimalEnv);
    if (minimal.failure) {
      return { route, cycle, reachable: false, run: minimal, env: minimalEnv };
    }
    const plannedEnv = makeEnv(base, cycle, route, "planned");
    const planned = runOnce(plannedEnv);
    if (!planned.failure) {
      return { route, cycle, reachable: true, tight: false, run: planned, env: plannedEnv };
    }
    return { route, cycle, reachable: true, tight: true, tightBecause: explain({ run: planned, env: plannedEnv }), run: planned, env: plannedEnv };
  } catch (error) {
    if (error instanceof MissingFact) {
      return { route, cycle, reachable: false, missing: error.message };
    }
    throw error;
  }
}

function cycleKeys(plan, facts) {
  return facts.keys(plan.cycles).map(Number).sort((a, b) => a - b);
}

// Finding the last day the facts plan studies to begin: the start of the last intake, or for a plan
// by start month, the end of the year after the last HSC in the facts. Own dates may run a year past it
export function lastIntakeDay({ common, plan, facts }) {
  if (plan.intake === "month") {
    return dayFromParts(Math.max(...facts.keys("bd/hsc.exams").map(Number)) + 1, 12, 31);
  }
  const cycle = cycleKeys(plan, facts).at(-1);
  const env = { facts, ctx: { cycle }, assumptions: { ...common.assumptions, ...plan.assumptions }, usedAssumptions: new Set(), mode: "planned" };
  return resolveDate(plan.start, env).range.last;
}

// Offering the next intakes whose application period has not ended, by the hopeful reading,
// with at most one route for each intake
export function intakeOptions({ common, plan, facts, answers, today }) {
  checkPlan(common);
  checkPlan(plan);
  const base = { common, plan, facts, answers, today, table: stepTable(common, plan), assumptions: { ...common.assumptions, ...plan.assumptions }, ticks: {}, overrides: {} };
  if (plan.intake === "month") {
    return nextMonths(plan, base);
  }
  const examsOver = schoolEnds(base);
  if (examsOver === null) {
    return [];
  }
  const options = [];
  for (const cycle of cycleKeys(plan, facts)) {
    const routes = routeList(plan, buildContext(answers, cycle, null, plan));
    for (const route of routes) {
      const env = { ...base, ctx: buildContext(answers, cycle, route.id, plan), route, mode: "minimal", usedAssumptions: new Set() };
      let deadline;
      let start;
      try {
        start = resolveDate(pick(route.start, env.ctx) ?? plan.start, env);
        // Falling back to the start date for a route with no application deadline
        deadline = resolveDate(route.deadline ?? null, env) ?? start;
      } catch (error) {
        if (error instanceof MissingFact) {
          continue;
        }
        throw error;
      }
      // Skipping an intake that begins before the final school exams end, which no student can make
      if (start.range.last < examsOver) {
        continue;
      }
      if (readRange(deadline.range, "deadline", "minimal") >= today) {
        options.push({ cycle, route: route.id, deadline: { first: deadline.range.first, last: deadline.range.last, precision: deadline.range.precision, status: deadline.basis.status, refs: deadline.basis.refs } });
        break;
      }
    }
    if (options.length === INTAKE_OPTIONS) {
      break;
    }
  }
  return options;
}

// Finding the earliest day the student's final exams can end, by the hopeful reading, or null when
// the facts do not reach the student's school year
function schoolEnds(base) {
  const env = { ...base, ctx: buildContext(base.answers, null, null, base.plan) };
  try {
    return examsRange(env).range.first;
  } catch (error) {
    if (error instanceof MissingFact) {
      return null;
    }
    throw error;
  }
}

function routeMonths(route, facts) {
  return route.months?.fact ? facts.fact(route.months.fact).value.months : route.months?.list ?? [];
}

// Keeping a month-based route to the start months it offers; an intake by year fits every route
function offersMonth(route, month, facts) {
  return !month || routeMonths(route, facts).includes(Number(month.slice(5, 7)));
}

// Listing the start months a month-based plan offers, from next month or the month after the final
// exams end, whichever is later. Each month goes to the first route that offers it, and the search
// stops after ten years of months
function nextMonths(plan, base) {
  const routes = routeList(plan, buildContext(base.answers, null, null, plan));
  const examsOver = schoolEnds(base);
  if (routes.length === 0 || examsOver === null) {
    return [];
  }
  const options = [];
  const from = partsFromDay(Math.max(base.today, examsOver));
  let cursor = addMonths(dayFromParts(from.year, from.month, 1), 1);
  for (let step = 0; step < MONTH_SEARCH && options.length < INTAKE_OPTIONS; step += 1) {
    const { year, month } = partsFromDay(cursor);
    const route = routes.find((item) => routeMonths(item, base.facts).includes(month));
    if (route) {
      options.push({ month: `${year}-${String(month).padStart(2, "0")}`, route: route.id });
    }
    cursor = addMonths(cursor, 1);
  }
  return options;
}

export function checkPlan(doc) {
  if (doc?.format !== PLAN_FORMAT) {
    throw new PlanError(`Plan file ${doc?.plan} has format ${doc?.format}, but this app reads format ${PLAN_FORMAT}`);
  }
}

// Matching "{test}" and "{money:nz/visa.fee}", a name with an optional argument
const PLACEHOLDER = /\{(\w+)(?::([^}]+))?\}/g;

// Giving a placeholder's value: a plain one, or one worked out from its argument, such as an amount
// read from the facts, so a corrected fact can never leave a stale figure in a step
function valueOf(vars, name, argument) {
  const value = vars[name];
  if (typeof value === "function") {
    return argument === undefined ? null : value(argument);
  }
  return argument === undefined ? value : null;
}

// Dropping any sentence whose placeholders have no value, so no gap is ever shown
function fill(text, vars) {
  if (!text) {
    return text;
  }
  const sentences = text.split(/(?<=\.) /);
  const known = (name, argument) => valueOf(vars, name, argument) !== undefined && valueOf(vars, name, argument) !== null;
  return sentences
    .filter((sentence) => [...sentence.matchAll(PLACEHOLDER)].every(([, name, argument]) => known(name, argument)))
    .map((sentence) => sentence.replace(PLACEHOLDER, (match, name, argument) => String(valueOf(vars, name, argument))))
    .join(" ");
}

// Writing an amount from the facts as "EUR 9,600", or one variant of it, written "fact#label"
export function moneyWords(facts, argument) {
  const [ref, label] = argument.split("#");
  if (!facts?.has(ref)) {
    return null;
  }
  const value = facts.fact(ref).value;
  const amount = label ? value?.variants?.find((item) => item.label === label)?.amount : value?.amount;
  if (typeof amount !== "number" || !value.currency) {
    return null;
  }
  return moneyText(value.currency, amount);
}

// Keeping a title's other words when a placeholder has no value: "Take the SAT {satWhen}" for a step
// already marked done reads "Take the SAT", where a sentence with a gap would be dropped
function fillTitle(text, vars) {
  if (!text) {
    return text;
  }
  return text.replace(/\s*\{(\w+)(?::([^}]+))?\}/g, (match, name, argument) => {
    const value = valueOf(vars, name, argument);
    return value !== undefined && value !== null ? match.replace(/\{.*\}/, String(value)) : "";
  }).trim();
}

// Showing the first SAT the student can prepare for, unless it comes too late,
// in which case the last one that still counts, which gives the most preparation possible
function shownTest(item) {
  if (item.firstTest && (!item.lastTest || item.firstTest.test <= item.lastTest.test)) {
    return item.firstTest;
  }
  return item.lastTest ?? item.firstTest ?? null;
}

function stepVars(item, ctx, facts = null) {
  const vars = { money: (argument) => moneyWords(facts, argument) };
  const test = shownTest(item);
  if (item.english) {
    vars.test = TEST_NAMES[item.english.test];
    vars.resultDays = item.english.result.amount + (item.english.send ? ` days, plus up to ${item.english.send.amount} business` : "");
  } else {
    const test = ctx.englishTest ?? "ielts";
    vars.test = TEST_NAMES[test];
  }
  const satName = (candidate) => (candidate.precision === "month" ? `in ${formatMonth(candidate.test)}` : `on ${formatDay(candidate.test)}`);
  if (test) {
    vars.satWhen = satName(test);
    vars.registerBy = test.precision === "month" ? `around ${formatDay(test.regular)}` : formatDay(test.regular);
    vars.scoreDays = test.precision === "month" ? 17 : test.scores - test.test;
  }
  if (item.lastTest) {
    vars.lastSat = satName(item.lastTest);
  }
  vars.exam = ctx.system === "hsc" ? "HSC" : "A level";
  return vars;
}

// Finding the clock time of a date that comes straight from a fact with a time, such as Harvard's
// 11:59 p.m. deadline or the UAS exam at noon, so the step can show it with Dhaka time
function clockFor(env, date, item) {
  if (date.precision !== "day") {
    return null;
  }
  for (const { ref, key } of [...(date.refs ?? []), ...(item.deadline?.refs ?? [])]) {
    const value = env.facts.has(ref) ? env.facts.entry(ref, key)?.value : null;
    if (value?.time && value.zone && value.date && readDate(value.date).precision === "day" && readDate(value.date).first === date.day) {
      return { day: date.day, time: value.time, zone: value.zone, closes: !item.fixed };
    }
  }
  return null;
}

function present(result, base) {
  const { run, env } = result;
  const { info } = run;
  const ctx = env.ctx;
  const steps = [];
  const todayDay = base.today;
  for (const id of env.order) {
    const item = info.get(id);
    const { step } = item;

    // Skipping school exams and results already behind today, which need nothing from the student
    if ((step.special === "school" || step.special === "exams") && item.fixedEnd && item.fixedEnd.day < todayDay && !item.done) {
      continue;
    }
    // Hiding a wait that is over, including a zero-length one that nothing earlier holds up
    const happened = item.finish && (item.finish.day < todayDay || (item.duration.amount === 0 && item.finish.day <= todayDay && item.driver === null));
    if (step.kind === "wait" && !item.fixed && !step.undated && happened && !item.done) {
      continue;
    }
    const vars = stepVars(item, ctx, env.facts);
    const text = [step.text, ...(step.textWhen ?? []).filter((line) => matches(line.when, ctx)).map((line) => line.text)].filter(Boolean).join(" ");
    const tasks = [...(step.tasks ?? []), ...(step.taskWhen ?? []).filter((task) => matches(task.when, ctx)).map((task) => task.task)];
    const facts = [...(step.facts ?? []), ...(step.factsWhen ?? []).filter((group) => matches(group.when, ctx)).flatMap((group) => group.facts)];
    const planningId = pick(step.planning, ctx);
    let date = null;
    let by = null;
    if (!step.undated) {
      if (item.fixed) {
        date = item.fixedEnd;
      } else if (step.special === "sat" && shownTest(item)) {
        const test = shownTest(item);
        date = { day: test.test, precision: test.precision, status: test.status, refs: [{ ref: "bd/sat.administrations", key: test.key }] };
      } else if (step.special === "english" && item.testDay !== undefined && ctx.englishStatus === "booked" && ctx.englishDate) {
        // Showing the student's own booking as the exact day they know, whatever the deadline's precision
        date = { day: item.testDay, precision: "day", status: "answer", refs: [] };
      } else if (step.special === "english" && item.testDay !== undefined) {
        const testBy = item.latestTest ?? item.testDay;
        date = { ...(item.latestFinish ?? item.finish), day: Math.max(testBy, item.testDay) };
      } else {
        date = item.latestFinish && Number.isFinite(item.latestFinish.day) ? item.latestFinish : item.finish;
      }
      by = item.latestFinish ?? null;
    }
    // Leaving out an optional event, such as a TR-YÖS sitting, once its day has passed unused
    if (step.optional && !item.done && date && date.day < todayDay) {
      continue;
    }
    // Measuring no spare time for a step held back only by its window opening
    const waitsForOpening = Boolean(item.opens) && item.driver === null && item.opens.day >= todayDay;
    const spareDays = !waitsForOpening && item.latestFinish && item.finish && Number.isFinite(item.finish.day) ? item.latestFinish.day - item.finish.day : null;
    let urgency = null;
    const urgentDay = item.urgentBy ?? item.latestStart?.day;
    if (!item.done && !step.undated && Number.isFinite(urgentDay)) {
      if (urgentDay <= todayDay + URGENT_DAYS) {
        urgency = "urgent";
      } else if (spareDays !== null && spareDays < LITTLE_SPARE_DAYS) {
        urgency = "little";
      }
    }
    if (date && date.day - todayDay > CALM_BEYOND_DAYS) {
      urgency = null;
    }
    // Warning when a wait may run past the start of studies, such as a visa decided late
    const startDay = readRange(env.start.range, "deadline", env.mode);
    const warning = step.warnLate && !item.done && item.finish && Number.isFinite(item.finish.day) && item.finish.day > startDay ? fill(step.warnLate, vars) : null;
    steps.push({
      durationDays: date ? Math.max(0, shift(0, item.duration.amount, item.duration.unit)) : 0,
      id,
      title: fillTitle(step.title, vars),
      text: fill(text, vars),
      clock: date && !item.done ? clockFor(env, date, item) : null,
      warning,
      tasks: tasks.map((task) => fill(task, vars)),
      stage: step.stage,
      kind: step.kind ?? "task",
      hard: Boolean(step.hard),
      undated: Boolean(step.undated),
      because: step.because ?? null,
      planning: planningId ? { id: planningId, ...env.assumptions[planningId] } : null,
      ownable: ownable(step, env),
      ownDeadline: ownable(step, env) && Boolean(ownDateFor(env, id)),
      ownDay: ownable(step, env) && ownDateFor(env, id) ? readDate(ownDateFor(env, id)).first : null,
      date,
      by,
      opens: item.opens,
      earliest: item.finish && Number.isFinite(item.finish.day) ? item.finish.day : null,
      latestStart: item.latestStart && Number.isFinite(item.latestStart.day) ? item.latestStart.day : null,
      spare: spareDays,
      urgency,
      done: item.done,
      doneOn: item.doneOn,
      facts,
      refs: [...(date?.refs ?? []), ...(item.deadline?.refs ?? [])],
      sat: shownTest(item) ? { test: shownTest(item).test, precision: shownTest(item).precision, registerBy: shownTest(item).regular, lateBy: shownTest(item).late, scores: shownTest(item).scores, last: item.lastTest?.test ?? null, booked: ctx.satStatus === "booked" } : null,
      english: item.english ? { test: item.english.test, testBy: item.latestTest ?? null, earliestTest: item.testDay, booked: ctx.englishStatus === "booked" } : null,
    });
  }

  // Keeping the shown dates in order along every dependency: a step with no deadline of its own
  // comes after the steps it waits for, and no step is shown after a step that waits for it.
  // A booked test is the exception and keeps the day the student booked
  const byId = new Map(steps.map((step) => [step.id, step]));
  const shown = (id) => byId.get(id);
  const booked = (step) => step.english?.booked || step.sat?.booked;
  for (const id of env.order) {
    const step = shown(id);
    const item = info.get(id);
    if (!step || !step.date || step.done || item.fixed || item.latestFinish || booked(step)) {
      continue;
    }
    const before = env.deps.get(id).map(shown).filter((other) => other && other.date && !other.done);
    if (before.length > 0) {
      const ready = Math.max(...before.map((other) => other.date.day));
      step.date = { ...step.date, day: Math.max(step.date.day, ready + step.durationDays) };
    }
  }
  for (const id of [...env.order].reverse()) {
    const step = shown(id);
    const item = info.get(id);
    if (!step || !step.date || step.done || item.fixed || step.kind === "wait" || booked(step)) {
      continue;
    }
    const after = env.order.filter((other) => env.deps.get(other).includes(id)).map(shown).filter((other) => other && other.date && !other.done);
    if (after.length > 0) {
      const needed = Math.min(...after.map((other) => other.date.day - other.durationDays));
      step.date = { ...step.date, day: Math.min(step.date.day, needed) };
    }
  }
  for (const step of steps) {
    delete step.durationDays;
  }

  // Ordering by date, so the route reads from today to arrival; an undated step follows
  // the last step it waits for
  const dated = withinMonths(steps.filter((step) => !step.undated).sort((a, b) => a.date.day - b.date.day || env.order.indexOf(a.id) - env.order.indexOf(b.id)), env.deps);
  for (const step of steps.filter((item) => item.undated)) {
    const deps = env.deps.get(step.id);
    const index = Math.max(...deps.map((dep) => dated.findIndex((item) => item.id === dep)));
    dated.splice(index + 1, 0, step);
  }

  const current = dated.find((step) => !step.done) ?? null;
  const sourced = dated.filter((step) => !step.done && !step.undated && ["confirmed", "reported", "expected"].includes(step.date.status));
  const stages = STAGES.map((stage) => {
    const inStage = dated.filter((step) => step.stage === stage);
    return { id: stage, total: inStage.length, done: inStage.filter((step) => step.done).length };
  });
  return {
    steps: dated,
    current: current ? current.id : null,
    counts: { done: dated.filter((step) => step.done).length, total: dated.length },
    // Telling a plan whose dates from the facts are mostly expected, such as a class 9 student's, so it
    // can say so once. Dates worked out from the student's answers or Pathway's planning count for neither
    mostlyExpected: sourced.length > 0 && sourced.filter((step) => step.date.status === "expected").length * 2 >= sourced.length,
    stages,
    // Passing on what each step waits for, so the app can ask about earlier steps when one is marked done
    deps: Object.fromEntries(env.order.map((id) => [id, env.deps.get(id)])),
    assumptions: [...env.usedAssumptions].map((id) => ({ id, ...env.assumptions[id] })).filter((item) => item.label),
  };
}

// Describing a range in words: "on 7 January 2027", "between 7 and 15 November 2026",
// "in August 2027" or "between August and September 2027"
export function describeRange(first, last, precision) {
  if (precision === "month") {
    const a = partsFromDay(first);
    const b = partsFromDay(last);
    if (a.year === b.year && a.month === b.month) {
      return `in ${formatMonth(first)}`;
    }
    return a.year === b.year ? `between ${formatMonth(first, { year: false })} and ${formatMonth(last)}` : `between ${formatMonth(first)} and ${formatMonth(last)}`;
  }
  if (first === last) {
    return `on ${formatDay(first)}`;
  }
  const a = partsFromDay(first);
  const b = partsFromDay(last);
  if (a.year === b.year && a.month === b.month) {
    return `between ${a.day} and ${formatDay(last)}`;
  }
  return `between ${formatDay(first, { year: a.year !== b.year })} and ${formatDay(last)}`;
}

function shaping(base, result, schoolDate) {
  const ctx = result.env.ctx;
  const items = [];
  const testName = TEST_NAMES[ctx.englishTest ?? "ielts"];
  // Following the calendar for the school line: before the exams, after them, and once results are out
  const when = schoolDate ? describeRange(schoolDate.first, schoolDate.last, schoolDate.precision) : null;
  const resultsOut = !schoolDate || schoolDate.last < base.today;
  const examsOver = resultsOut || (schoolDate?.examsEnd ?? Infinity) < base.today;
  const phase = resultsOut ? "Done" : examsOver ? "Sat" : "";
  if (ctx.system === "hsc") {
    items.push({ key: `systemHsc${phase}`, answer: "school", vars: { year: ctx.schoolYear, when }, date: schoolDate });
  } else if (ctx.system === "alevel") {
    items.push({ key: `systemAlevel${phase}`, answer: "school", vars: { year: ctx.schoolYear, when }, date: schoolDate });
  }
  // Treating a booked test whose day has passed as sat, with its score still to be entered
  const alreadySat = (date) => Boolean(date) && readDay(date) < base.today;
  const english = ctx.englishExpired ? "englishExpired" : ctx.englishNote ?? { none: "englishNone", booked: alreadySat(ctx.englishDate) ? "englishTaken" : "englishBooked", score: "englishScore", waived: "englishWaived" }[ctx.englishStatus];
  const until = ctx.englishExpires !== null ? formatMonth(ctx.englishExpires) : null;
  items.push({ key: english, answer: "english", vars: { test: testName, score: ctx.englishScore, until, date: ctx.englishDate ? formatDay(readDay(ctx.englishDate)) : null } });
  const usesSat = Boolean(base.plan.asksSat);
  if (usesSat) {
    const key = { none: "satNone", booked: alreadySat(ctx.satDate) ? "satTaken" : "satBooked", score: "satScore", no: "satNo" }[ctx.satStatus];
    items.push({ key, answer: "sat", vars: { score: ctx.satScore, date: ctx.satDate ? formatDay(readDay(ctx.satDate)) : null } });
  }
  items.push({ key: { reach: "tierReach", balanced: "tierBalanced", safe: "tierSafe" }[ctx.tier], answer: "tier", vars: {} });
  items.push({ key: { need: "aidNeed", help: "aidHelp", no: "aidNo" }[ctx.aid], answer: "aid", vars: {} });
  items.push({ key: { none: "passportNone", applied: "passportApplied", nid: "passportNid", valid: "passportValid" }[ctx.passport], answer: "passport", vars: {} });
  // Letting a country's plan word a line its own way, such as how many applications to make
  const texts = { ...base.common.shaping, ...(base.plan.shaping ?? {}) };
  return items.filter((item) => item.key).map((item) => ({ ...item, text: fill(texts[item.key], item.vars) }));
}

// Giving each score scale as lowest, highest and step
const SCALES = { ielts: [1, 9, 0.5], toefl: [1, 6, 0.5], duolingo: [10, 160, 5], pte: [10, 90, 1] };
const SAT_SCALE = [400, 1600, 10];

function onScale(value, [low, high, step]) {
  return typeof value === "number" && value >= low && value <= high && Math.abs((value - low) / step - Math.round((value - low) / step)) < 1e-9;
}

// Checking the month a score was taken: a real month, not in the future, and within the last ten years
function takenOk(text, today) {
  if (typeof text !== "string" || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(text)) {
    return false;
  }
  if (today === null) {
    return true;
  }
  const first = readDate(text).first;
  return first <= today && first >= addMonths(today, -120);
}

function isDay(text) {
  try {
    return readDate(text).precision === "day";
  } catch {
    return false;
  }
}

// Listing what is missing or damaged in a set of answers; an empty list means the plan can be built
export function answerProblems(answers, plan, today = null) {
  const problems = [];
  const one = (value, options) => options.includes(value);
  if (!answers || typeof answers !== "object") {
    return ["answers"];
  }
  if (answers.country !== plan.plan) {
    problems.push("country");
  }
  const intake = answers.intake;
  const intakeOk = intake && (intake.soonest === true
    || (plan.intake === "month" ? /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(intake.month ?? "") : Number.isInteger(intake.cycle)));
  if (!intakeOk) {
    problems.push("intake");
  }
  const school = answers.school;
  if (!school || !one(school.system, ["hsc", "alevel"]) || !Number.isInteger(school.year) || (school.system === "alevel" && school.session !== undefined && !one(school.session, ["summer", "winter"]))) {
    problems.push("school");
  }
  const english = answers.english;
  const englishOk = english && (english.status === "none" || english.status === "waived"
    ? english.test === undefined || one(english.test, Object.keys(SCALES))
    : one(english.test, Object.keys(SCALES)) && (english.status === "booked" ? isDay(english.date) : english.status === "score" && onScale(english.score, SCALES[english.test]) && takenOk(english.taken, today)));
  if (!englishOk) {
    problems.push("english");
  }
  if (plan.asksSat) {
    const sat = answers.sat;
    const satOk = sat && (one(sat.status, ["no", "none"]) || (sat.status === "booked" && isDay(sat.date)) || (sat.status === "score" && onScale(sat.score, SAT_SCALE)));
    if (!satOk) {
      problems.push("sat");
    }
  }
  if (!one(answers.tier, ["reach", "balanced", "safe"])) {
    problems.push("tier");
  }
  if (!one(answers.aid, ["need", "help", "no"])) {
    problems.push("aid");
  }
  if (!one(answers.passport, ["valid", "applied", "nid", "none"])) {
    problems.push("passport");
  }
  return problems;
}

// Building the plan for a student, the engine's public entry point. Nothing here reads the clock,
// the screen or storage: everything arrives as arguments, so the same answers always give the same plan
export function buildPlan({ common, plan, facts, answers, today, ticks = {}, overrides = {} }) {
  checkPlan(common);
  checkPlan(plan);
  // Catching a wrong device clock, since today cannot come before the day the facts were checked
  if (today < facts.checked) {
    return { status: "clockWrong", checked: facts.checked };
  }
  const problems = answerProblems(answers, plan, today);
  if (problems.length > 0) {
    return { status: "needsAnswers", problems };
  }
  const base = {
    common, plan, facts, answers, today, ticks, overrides,
    table: stepTable(common, plan),
    assumptions: { ...common.assumptions, ...plan.assumptions },
  };

  const options = intakeOptions({ common, plan, facts, answers, today });
  if (options.length === 0) {
    return { status: "factsEnded" };
  }

  // Trying every offered intake for "soonest", otherwise only the one the student chose
  let candidates;
  if (plan.intake === "month") {
    const chosen = answers.intake?.soonest ? options.map((option) => option.month) : [answers.intake?.month];
    candidates = chosen.map((month) => ({ cycle: Number(month.slice(0, 4)), month }));
  } else {
    const chosen = answers.intake?.soonest ? options.map((option) => option.cycle) : [answers.intake?.cycle];
    candidates = chosen.map((cycle) => ({ cycle }));
  }

  const attempts = [];
  for (const candidate of candidates) {
    const cycleBase = candidate.month ? { ...base, answers: { ...answers, intake: { month: candidate.month } } } : base;
    const routes = routeList(plan, buildContext(cycleBase.answers, candidate.cycle, null, plan), answers.route ?? null).filter((route) => offersMonth(route, candidate.month, base.facts));
    const tried = routes.map((route) => tryRoute(cycleBase, candidate.cycle, route));
    attempts.push({ candidate, tried, cycleBase });
    const chosen = tried.find((attempt) => attempt.reachable);
    if (chosen) {
      return finish(cycleBase, chosen, tried, candidate, attempts.length > 1 ? skippedIntake(attempts[0]) : null);
    }
  }

  // Explaining with the preferred route when nothing fits, and finding the next intake that does
  const { candidate, tried, cycleBase } = attempts[0];
  const explained = tried.find((attempt) => attempt.run) ?? tried[0];
  const reason = explained?.run ? explain(explained) : null;
  // Offering no later intake when a booked test comes before something it needs:
  // every intake fails the same way, so the booking has to move
  const next = reason?.booked ? null : findNext(base, options, candidate);
  return {
    status: "outOfReach",
    cycle: candidate.cycle,
    month: candidate.month ?? null,
    route: explained ? { id: explained.route.id, title: explained.route.title } : null,
    missing: explained?.missing ?? null,
    reason,
    next,
    routes: tried.map((attempt) => ({ id: attempt.route.id, title: attempt.route.title, reachable: attempt.reachable })),
    plan: explained?.run ? present(explained, cycleBase) : null,
    shaping: shapingFor(cycleBase, explained, candidate.cycle),
  };
}

function findNext(base, options, candidate) {
  const later = base.plan.intake === "month"
    ? options.filter((option) => option.month > candidate.month)
    : options.filter((option) => option.cycle > candidate.cycle);
  for (const option of later) {
    const answers = option.month ? { ...base.answers, intake: { month: option.month } } : { ...base.answers, intake: { cycle: option.cycle } };
    const nextBase = { ...base, answers };
    const routes = routeList(base.plan, buildContext(answers, option.cycle ?? Number(option.month.slice(0, 4)), null, base.plan)).filter((route) => offersMonth(route, option.month, base.facts));
    const reachable = routes.map((route) => tryRoute(nextBase, option.cycle ?? Number(option.month.slice(0, 4)), route)).find((attempt) => attempt.reachable);
    if (reachable) {
      return option.month ? { month: option.month, route: reachable.route.id } : { cycle: option.cycle, route: reachable.route.id };
    }
  }
  return null;
}

function explain(attempt) {
  const { info, failure } = attempt.run;
  const failed = info.get(failure.step);
  const title = (id) => fillTitle(info.get(id).step.title, stepVars(info.get(id), attempt.env.ctx, attempt.env.facts));
  const point = (value) => (value && Number.isFinite(value.day) ? value.day : null);
  // Telling apart a fixed date that comes too late, such as decisions after the day travel is needed,
  // from one the steps before it cannot reach in time
  const comesLate = Boolean(failed.fixed) && !failed.blocked;
  let earliest = failed.strictFinish ?? point(failed.finish);
  let due = point(failed.latestFinish);
  if (failed.fixed && !comesLate) {
    earliest = point(failed.start);
    due = point(failed.fixedStart);
  } else if (comesLate) {
    earliest = point(failed.fixedEnd);
  }
  return {
    step: failure.step,
    title: title(failure.step),
    chain: failure.chain.map((id) => ({ id, title: title(id), earliest: point(info.get(id).finish) })),
    earliest,
    due,
    comes: comesLate ? failed.fixedEnd.precision : null,
    satFirst: failed.firstTest?.test ?? null,
    satLast: failed.lastTest?.test ?? null,
    // Naming "english" or "sat" when the date that cannot be met is a test the student booked
    booked: failed.fixed ? null : failed.latestFinish?.booked ?? null,
    bookedTest: !failed.fixed && failed.latestFinish?.booked === "english" ? attempt.env.ctx.englishTest : null,
  };
}

function examsEnd(env) {
  try {
    return examsRange(env).range.last;
  } catch (error) {
    if (error instanceof MissingFact) {
      return null;
    }
    throw error;
  }
}

// Writing the lines under "What shaped this plan", for a plan that was built or one that is out of reach.
// An attempt that stopped at a missing fact has no run, so its lines come from the answers alone
function shapingFor(base, attempt, cycle) {
  const env = attempt?.env ?? { ctx: buildContext(base.answers, cycle, attempt?.route?.id ?? null, base.plan) };
  let school = null;
  if (attempt?.env && env.ctx.system) {
    try {
      school = schoolRange(env);
    } catch (error) {
      if (!(error instanceof MissingFact)) {
        throw error;
      }
    }
  }
  const schoolDate = school ? { first: school.range.first, last: school.range.last, precision: school.range.precision, status: school.basis.status, examsEnd: attempt?.env ? examsEnd(env) : null } : null;
  return shaping(base, { env }, schoolDate);
}

// Putting a step after the steps it waits for when both fall in the same month and either is shown
// by its month alone, so a tight plan never lists "Travel to Türkiye" above the decision it needs.
// Days shown in full keep their order, and every month keeps one heading
function withinMonths(sorted, deps) {
  const monthOf = (step) => {
    const { year, month } = partsFromDay(step.date.day);
    return year * 12 + month;
  };
  const result = [];
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end < sorted.length && monthOf(sorted[end]) === monthOf(sorted[start])) {
      end += 1;
    }
    const left = sorted.slice(start, end);
    while (left.length > 0) {
      const waiting = (step) => left.some((other) => other !== step && deps.get(step.id).includes(other.id) && (step.date.precision === "month" || other.date.precision === "month"));
      const next = left.findIndex((step) => !waiting(step));
      result.push(...left.splice(next === -1 ? 0 : next, 1));
    }
    start = end;
  }
  return result;
}

// Saying why "The soonest I can make" passed over the first intake offered, so a plan that starts a
// year later than the student hoped explains itself in one line
function skippedIntake({ candidate, tried }) {
  const explained = tried.find((attempt) => attempt.run) ?? tried[0];
  return {
    cycle: candidate.cycle,
    month: candidate.month ?? null,
    reason: explained?.run ? explain(explained) : null,
  };
}

function finish(base, chosen, tried, candidate, skipped = null) {
  const presented = present(chosen, base);
  const start = chosen.env.start;
  return {
    status: "ok",
    cycle: candidate.cycle,
    month: candidate.month ?? null,
    skipped,
    tight: chosen.tight,
    tightBecause: chosen.tightBecause ?? null,
    route: { id: chosen.route.id, title: chosen.route.title, text: chosen.route.text },
    routes: tried.map((attempt) => ({ id: attempt.route.id, title: attempt.route.title, reachable: attempt.reachable })),
    start: { day: readRange(start.range, "deadline", "planned"), precision: start.range.precision, status: start.basis.status, refs: start.basis.refs },
    shaping: shapingFor(base, chosen, candidate.cycle),
    ...presented,
  };
}
