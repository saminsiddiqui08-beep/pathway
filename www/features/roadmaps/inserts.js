// Filling a roadmap's text with values from the facts, so a corrected fact corrects every sentence that
// shows it. Nothing here touches the screen, so the same code runs in the app and in the checks
import { formatDay, formatMonth, monthName, readDate } from "../../app/dates.js";
import { dateRange, durationOf } from "../../app/facts.js";
import { moneyText, takaText } from "../../app/money.js";
import { dateWithPreposition, dateWords, joinWords } from "../timeline/words.js";

// Matching "{money:nz/visa.fee}", "{date:nz/uni.otago.closing@+1}" and "{hscYear+1}"
export const INSERT = /\{(\w+(?:[+-]\d)?)(?::([^}]+))?\}/g;
export const KINDS = new Set(["money", "taka", "date", "whenDate", "fromDate", "toDate", "window", "rank", "number", "duration", "months", "fact", "rate", "hscYear", "cycle"]);
// Naming the inserts that only make sense in a section written for the student's own HSC year
const YEAR_FORMS = /^hscYear(?:[+-]\d)?$/;
const CURRENCY_NAMES = { USD: "US dollar", EUR: "euro", TRY: "Turkish lira", MYR: "Malaysian ringgit", NZD: "New Zealand dollar" };
export const RATE_FACTS = { USD: "bd/fx.usd", EUR: "bd/fx.eur", TRY: "bd/fx.try", MYR: "bd/fx.myr", NZD: "bd/fx.nzd" };
const UNIT_WORDS = { days: "days", workingDays: "working days", businessDays: "business days", weeks: "weeks", months: "months", years: "years" };

export class InsertError extends Error { }

// Splitting "nz/uni.otago.closing@+1" into the fact and how many years past the student's year it is
function keyed(argument) {
  const [ref, offset] = argument.split("@");
  return { ref, offset: offset ? Number(offset) : 0 };
}

// Reading the latest value of a fact whose values change, such as a fee for each academic year
function latest(facts, ref) {
  const record = facts.fact(ref);
  if (!record.values) {
    return record.value;
  }
  return record.values.reduce((best, item) => (item.key > best.key ? item : best)).value;
}

// Reading an amount: a fact, one of its variants ("ref#label"), or a typed one such as "850 NZD"
function amountOf(facts, term) {
  const typed = /^(\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(term);
  if (typed) {
    return { amount: Number(typed[1]), currency: typed[2] };
  }
  const [ref, label] = term.split("#");
  if (!facts.has(ref)) {
    throw new InsertError(`No fact ${ref}`);
  }
  const value = latest(facts, ref);
  const amount = label === undefined ? value?.amount : value?.variants?.find((item) => item.label === label)?.amount;
  if (typeof amount !== "number" || !value.currency) {
    throw new InsertError(`No amount in ${term}`);
  }
  return { amount, currency: value.currency };
}

// Adding up "a+b" and multiplying by "*2", for sums such as a year's fees from a semester's
export function sumOf(facts, argument) {
  const [terms, factor] = argument.split("*");
  const parts = terms.split("+").map((term) => amountOf(facts, term));
  const currency = parts[0].currency;
  if (parts.some((part) => part.currency !== currency)) {
    throw new InsertError(`Mixed currencies in ${argument}`);
  }
  const multiplier = factor === undefined ? 1 : Number(factor);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new InsertError(`Bad multiplier in ${argument}`);
  }
  return { amount: parts.reduce((total, part) => total + part.amount, 0) * multiplier, currency };
}

export function rateOf(facts, currency) {
  const ref = RATE_FACTS[currency];
  if (!ref || !facts.has(ref)) {
    throw new InsertError(`No exchange rate for ${currency}`);
  }
  const record = facts.fact(ref);
  const newest = record.values.reduce((best, item) => (item.key > best.key ? item : best));
  return { rate: newest.value.number, on: readDate(newest.key).first, label: record.label };
}

// Choosing the value of a dated fact: for the student's own year in a year section, otherwise for the
// roadmap's intake year, or the HSC year before it
function entryFor(facts, argument, ctx) {
  const { ref, offset } = keyed(argument);
  if (!facts.has(ref)) {
    throw new InsertError(`No fact ${ref}`);
  }
  const record = facts.fact(ref);
  if (!record.values) {
    return { record, entry: record };
  }
  let key;
  if (record.keyedBy === "cycle") {
    key = (ctx.templateYear ?? ctx.cycle) + offset;
  } else if (record.keyedBy === "hscYear") {
    key = (ctx.templateYear ?? ctx.cycle - 1) + offset;
  } else {
    throw new InsertError(`${ref} is not keyed by a year`);
  }
  return { record, entry: facts.entry(ref, key) };
}

function shownDate(range, status) {
  return { day: range.first, precision: range.precision, status };
}

// Describing a window: "from 7 to 15 November 2026", or "between August and September 2027"
function windowWords(value) {
  const from = readDate(value.from);
  const to = readDate(value.to);
  if (from.precision === "month" || to.precision === "month") {
    return from.first === to.first ? `in ${formatMonth(from.first)}` : `between ${formatMonth(from.first, { year: false })} and ${formatMonth(to.first)}`;
  }
  const sameYear = formatDay(from.first).slice(-4) === formatDay(to.first).slice(-4);
  const sameMonth = sameYear && formatMonth(from.first) === formatMonth(to.first);
  if (sameMonth) {
    return `from ${formatDay(from.first).split(" ")[0]} to ${formatDay(to.first)}`;
  }
  return `from ${formatDay(from.first, { year: !sameYear })} to ${formatDay(to.first)}`;
}

function factWords(facts, ref, ctx) {
  const record = facts.fact(ref);
  switch (record.kind) {
    case "text":
      return latest(facts, ref).text;
    case "money": {
      const value = latest(facts, ref);
      return value.variants ? value.variants.map((item) => `${item.label}: ${moneyText(value.currency, item.amount)}`).join("; ") : moneyText(value.currency, value.amount);
    }
    case "number":
      return String(latest(facts, ref).number);
    case "duration":
      return durationWords(latest(facts, ref));
    case "months":
      return joinWords(latest(facts, ref).months.map(monthName));
    case "date":
    case "window":
      return resolve("window", ref, { ...ctx, facts }) ?? null;
    default:
      throw new InsertError(`Cannot show ${ref}`);
  }
}

function durationWords(value) {
  const longest = durationOf(value, value.variants ? value.variants[value.variants.length - 1].label : null);
  return `up to ${longest.amount} ${UNIT_WORDS[longest.unit]}`;
}

// Working out one insert. Returns null when the facts have no value for it, so the sentence is left out
export function resolve(kind, argument, ctx) {
  const { facts, today } = ctx;
  if ((kind === "duration" || kind === "months" || kind === "fact") && !facts.has(argument)) {
    throw new InsertError(`No fact ${argument}`);
  }
  switch (kind) {
    case "money": {
      const { amount, currency } = sumOf(facts, argument);
      return moneyText(currency, amount);
    }
    case "taka": {
      const { amount, currency } = sumOf(facts, argument);
      return takaText(amount * rateOf(facts, currency).rate);
    }
    case "date":
    case "whenDate": {
      const { record, entry } = entryFor(facts, argument, ctx);
      if (!entry) {
        return null;
      }
      const range = dateRange(entry.value, record.kind === "window" ? "to" : "date");
      const date = shownDate(range, entry.status);
      return kind === "date" ? dateWords(date, today, { year: true }) : dateWithPreposition(date, today, { year: true });
    }
    case "fromDate":
    case "toDate": {
      const { entry } = entryFor(facts, argument, ctx);
      if (!entry) {
        return null;
      }
      return dateWithPreposition(shownDate(dateRange(entry.value, kind === "fromDate" ? "from" : "to"), entry.status), today, { year: true });
    }
    case "window": {
      const { record, entry } = entryFor(facts, argument, ctx);
      if (!entry) {
        return null;
      }
      if (record.kind === "date") {
        return dateWithPreposition(shownDate(dateRange(entry.value, "date"), entry.status), today, { year: true });
      }
      return windowWords(entry.value);
    }
    case "rank":
    case "number":
      return facts.has(argument) ? String(latest(facts, argument).number) : null;
    case "duration":
      return durationWords(latest(facts, argument));
    case "months":
      return joinWords(latest(facts, argument).months.map(monthName));
    case "fact":
      return factWords(facts, argument, ctx);
    case "rate": {
      const { rate, on, label } = rateOf(facts, argument);
      const how = /worked out/.test(label) ? ", worked out through the US dollar," : ", Bangladesh Bank's rate,";
      return `Taka figures use ৳${rate.toFixed(2)} to the ${CURRENCY_NAMES[argument]}${how} on ${formatDay(on)}.`;
    }
    case "cycle":
      return String(ctx.cycle);
    default:
      throw new InsertError(`Unknown insert ${kind}`);
  }
}

// Reading the year forms: "{hscYear}", "{hscYear+1}" and "{hscYear-1}"
function yearValue(name, ctx) {
  const match = /^hscYear([+-]\d)?$/.exec(name);
  if (!match || ctx.templateYear === undefined || ctx.templateYear === null) {
    return null;
  }
  return String(ctx.templateYear + Number(match[1] ?? 0));
}

// Filling a text, leaving out any sentence with an insert that has no value or cannot be read, so no
// gap or brace is ever shown. The checks report an insert that cannot be read before the app ships
export function fillText(text, ctx) {
  const value = (name, argument) => {
    try {
      return YEAR_FORMS.test(name) && argument === undefined ? yearValue(name, ctx) : resolve(name, argument, ctx);
    } catch (error) {
      if (error instanceof InsertError) {
        return null;
      }
      throw error;
    }
  };
  return text
    .split(/(?<=\.) /)
    .map((sentence) => {
      let missing = false;
      const filled = sentence.replace(INSERT, (match, name, argument) => {
        const found = value(name, argument);
        if (found === null || found === undefined) {
          missing = true;
          return "";
        }
        return found;
      });
      return missing ? null : filled;
    })
    .filter((sentence) => sentence !== null)
    .join(" ");
}

// Listing the inserts in a text, for the checks
export function insertsIn(text) {
  return [...text.matchAll(INSERT)].map(([whole, name, argument]) => ({ whole, name, argument }));
}

export function isYearForm(name) {
  return YEAR_FORMS.test(name);
}
