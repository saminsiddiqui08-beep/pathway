// Working out a money plan: what each payment is, how much it is in taka, when it falls due on the
// student's plan, and how much to set aside each month to meet every payment in time. Nothing here
// touches the screen, so the checks run the same code in Node
import { dayFromParts, monthStart, partsFromDay } from "../../app/dates.js";
import { rateOf, sumOf } from "../roadmaps/inserts.js";

// Rounding monthly savings up to this many taka, so the figure is easy to act on
const SAVING_STEP = 100;
// Allowing up to this many sittings of one test, which covers every honest retake plan
export const MAX_SITTINGS = 5;

// Reading an amount from the data: a fact ("us/visa.fee.sevis"), a sum of facts, or a typed figure
// ("100 MYR") whose fact the data cites
function amountOf(facts, item) {
  if (item.typed) {
    const [amount, currency] = item.typed.split(" ");
    return { amount: Number(amount), currency };
  }
  return sumOf(facts, item.fee);
}

// Finding when a payment falls due on the plan: a test's fee when it is booked, any other on its
// step's date. Returns null when the plan has no date for it
function stepDay(plan, id, booking = false) {
  const step = plan?.result?.steps?.find((item) => item.id === id);
  if (!step || step.undated || !step.date) {
    return { day: null, done: Boolean(step?.done) };
  }
  const day = booking && step.latestStart !== null && step.latestStart !== undefined ? Math.min(step.latestStart, step.date.day) : step.date.day;
  return { day, done: Boolean(step.done) };
}

// Counting the sittings the plan expects of a test: one for a test still to take, none once a score
// is held, and whatever the student has set instead
function plannedSittings(test, plan, saved) {
  if (Number.isInteger(saved?.count)) {
    return saved.count;
  }
  const answers = plan?.answers;
  if (test.id === "sat") {
    return ["none", "booked"].includes(answers?.sat?.status) ? 1 : 0;
  }
  const english = answers?.english;
  const chosen = english?.test ?? "ielts";
  return ["none", "booked"].includes(english?.status) && chosen === test.plan ? 1 : 0;
}

// Pricing several sittings, using the cheaper price for a pair where the test sells one
function sittingsCost(facts, test, count) {
  const one = sumOf(facts, test.fee);
  if (!test.pair || count < 2) {
    return { amount: one.amount * count, currency: one.currency };
  }
  const pair = sumOf(facts, test.pair);
  return { amount: pair.amount * Math.floor(count / 2) + one.amount * (count % 2), currency: one.currency };
}

// Gathering every payment for one country, from the plan, My list and what the student has entered
export function gatherItems({ data, facts, code, plan, list, saved }) {
  const country = data.countries[code];
  const own = saved.items ?? {};
  const forPlan = plan?.code === code && plan?.result?.status === "ok" ? plan : null;
  const items = [];

  for (const test of data.tests.filter((item) => !item.countries || item.countries.includes(code))) {
    const id = `test.${test.id}`;
    const count = plannedSittings(test, forPlan, own[id]);
    const when = stepDay(forPlan, test.step, true);
    const cost = sittingsCost(facts, test, count);
    items.push({ id, group: "tests", name: test.name, count, counted: count > 0, ...cost, ...when, refs: refsOf(test), note: test.note ?? "" });
  }

  const apply = stepDay(forPlan, country.applyStep);
  const needsAid = ["need", "help"].includes(forPlan?.answers?.aid);
  if (country.once) {
    items.push({ id: `apply.${country.once.id}`, group: "apply", name: country.once.name, counted: true, ...amountOf(facts, country.once), ...apply, refs: refsOf(country.once), note: country.once.note ?? "" });
  }
  for (const university of country.universities.filter((item) => list.has(item.key))) {
    const id = `apply.${university.key}`;
    const mine = own[id] ?? {};
    const known = university.fee || university.typed;
    const programmes = university.perProgramme ? (Number.isInteger(mine.count) ? mine.count : 1) : 1;
    const cost = known ? amountOf(facts, university) : { amount: mine.amount ?? null, currency: mine.currency ?? country.currency };
    // Taking a fee the university waives for every aid applicant as waived, when the plan says the
    // student applies for aid, until the student says otherwise
    const byAid = typeof mine.waived !== "boolean" && Boolean(university.waivedForAid) && needsAid;
    const waived = mine.waived === true || byAid;
    items.push({
      id, group: "apply", name: university.name, key: university.key, ...cost, amount: cost.amount === null ? null : cost.amount * programmes,
      count: university.perProgramme ? programmes : undefined, perProgramme: Boolean(university.perProgramme),
      waived, waivedByAid: byAid, missing: !known && cost.amount === null, typedByStudent: !known, counted: !waived,
      ...apply, refs: refsOf(university), waiver: university.waiver ?? null,
    });
  }

  if (country.aid) {
    const id = `aid.${country.aid.id}`;
    const mine = own[id] ?? {};
    const count = Number.isInteger(mine.count) ? mine.count : needsAid ? items.filter((item) => item.group === "apply" && item.key).length : 0;
    const first = sumOf(facts, country.aid.fee);
    const extra = sumOf(facts, country.aid.extra);
    items.push({
      id, group: "aid", name: country.aid.name, count, counted: count > 0, guessed: !Number.isInteger(mine.count) && needsAid,
      amount: count === 0 ? 0 : first.amount + extra.amount * (count - 1), currency: first.currency, ...stepDay(forPlan, country.aid.step), refs: [country.aid.fee.split("#")[0]],
    });
  }

  for (const after of country.after) {
    const id = `after.${after.id}`;
    const mine = own[id] ?? {};
    const cost = after.ask ? { amount: mine.amount ?? null, currency: mine.currency ?? country.currency } : amountOf(facts, after);
    items.push({ id, group: "after", name: after.name, ...cost, missing: cost.amount === null, typedByStudent: Boolean(after.ask), counted: cost.amount !== null, ...stepDay(forPlan, after.step), refs: refsOf(after), note: after.note ?? "" });
  }

  for (const extra of saved.own ?? []) {
    const day = /^\d{4}-\d{2}$/.test(extra.month ?? "") ? dayOfMonth(extra.month) : null;
    items.push({ id: `own.${extra.id}`, group: "own", name: extra.name || "Your own item", amount: extra.amount ?? null, currency: extra.currency ?? "BDT", missing: extra.amount === null || extra.amount === undefined, counted: typeof extra.amount === "number", day, done: false, refs: [], ownId: extra.id, month: extra.month ?? "" });
  }

  // Taking a payment the student has ticked, or whose plan step is done, as paid
  for (const item of items) {
    const mark = own[item.id]?.paid;
    item.paid = typeof mark === "boolean" ? mark : item.done === true;
  }
  return items;
}

function refsOf(item) {
  if (item.cite) {
    return item.cite;
  }
  return item.fee ? [...new Set(item.fee.split(/[+]/).map((part) => part.split("#")[0]))] : [];
}

function dayOfMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return dayFromParts(year, number, 1);
}

// Choosing the taka rate for each currency: Bangladesh Bank's from the facts, today's rate the
// student fetched, or the student's own bank's, falling back to Bangladesh Bank's where one is missing
export function ratesFor({ facts, mode, live, bank, currencies }) {
  const rates = { BDT: { rate: 1, from: "taka" } };
  for (const currency of currencies) {
    const official = rateOf(facts, currency);
    let chosen = { rate: official.rate, from: "bank-of-bangladesh", on: official.on };
    if (mode === "live" && live?.rates?.[currency]) {
      chosen = { rate: live.rates[currency], from: "live", on: live.on };
    } else if (mode === "bank" && typeof bank?.[currency] === "number" && bank[currency] > 0) {
      chosen = { rate: bank[currency], from: "bank" };
    }
    rates[currency] = chosen;
  }
  return rates;
}

// Putting a taka figure on every payment, raised by a "what if" share when the taka falls
export function priceItems(items, rates, fall = 0) {
  return items.map((item) => {
    if (typeof item.amount !== "number") {
      return { ...item, taka: null };
    }
    const rate = rates[item.currency]?.rate ?? null;
    const factor = item.currency === "BDT" ? 1 : 1 + fall;
    return { ...item, taka: rate === null ? null : item.amount * rate * factor };
  });
}

// Grouping the payments still to make by month: anything late or due this month goes in this month,
// and payments the plan cannot date yet go at the end
export function monthsOf(items, today) {
  const thisMonth = monthStart(today);
  const months = new Map();
  const undated = [];
  for (const item of items.filter((one) => one.counted && typeof one.taka === "number")) {
    if (item.day === null || item.day === undefined) {
      undated.push(item);
      continue;
    }
    const start = item.paid ? monthStart(item.day) : Math.max(thisMonth, monthStart(item.day));
    if (!months.has(start)) {
      months.set(start, []);
    }
    months.get(start).push(item);
  }
  const ordered = [...months.entries()].sort(([a], [b]) => a - b).map(([start, list]) => ({
    start,
    items: list,
    total: list.reduce((sum, item) => sum + item.taka, 0),
    due: list.filter((item) => !item.paid).reduce((sum, item) => sum + item.taka, 0),
  }));
  return { months: ordered, undated, undatedTotal: undated.reduce((sum, item) => sum + item.taka, 0) };
}

// Counting the months from this month to another, this month being the first
function monthIndex(start, today) {
  const a = partsFromDay(monthStart(today));
  const b = partsFromDay(start);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

// Working out savings: the monthly amount that meets every dated payment in time, and the first month
// that falls short with the student's own monthly figure. Saving happens at the start of each month
export function savingsPlan(months, today, saved, monthly) {
  let due = 0;
  let needed = 0;
  let short = null;
  for (const month of months.filter((item) => item.due > 0)) {
    const index = monthIndex(month.start, today);
    if (index < 0) {
      continue;
    }
    due += month.due;
    const savingMonths = index + 1;
    needed = Math.max(needed, (due - saved) / savingMonths);
    const available = saved + monthly * savingMonths;
    if (short === null && due > available + 0.5) {
      short = { start: month.start, gap: due - available };
    }
  }
  return { needed: Math.max(0, Math.ceil(needed / SAVING_STEP) * SAVING_STEP), short, due };
}
