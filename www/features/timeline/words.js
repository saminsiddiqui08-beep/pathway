// Turning the engine's day numbers into words, by one set of rules, so every screen agrees.
// Display rule 1: precision matches certainty
import { dayFromParts, formatDay, formatMonth, partsFromDay } from "../../app/dates.js";

const NBSP = "\u00A0";
export const EXPECTED_WINDOW_DAYS = 365;

export const TEST_NAMES = { ielts: "IELTS", toefl: "TOEFL", duolingo: "Duolingo", pte: "PTE" };

// Escaping text for HTML, so no fact or answer can ever become markup
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Keeping a small button, such as the information button, on the same line as the last word before
// it, so it never sits alone on a line of its own. The word and the button stay inside any bold or
// other markup the text ends with, so the markup stays whole
export function glue(html, button) {
  if (!button) {
    return html;
  }
  const match = /([^\s<>]+)((?:<\/[a-z]+>)*)\s*$/.exec(html);
  if (!match) {
    return html + button;
  }
  return `${html.slice(0, match.index)}<span class="glue">${match[1]}${button}</span>${match[2]}`;
}

// Writing a date as the student should read it: the day when it is certain, "around" the day when it
// is expected within a year, and the month alone when it is expected further ahead or only known by month
export function dateWords(date, today, { year = "auto" } = {}) {
  if (!date || !Number.isFinite(date.day)) {
    return "";
  }
  const showYear = year === true || (year === "auto" && partsFromDay(date.day).year !== partsFromDay(today).year);
  const expected = date.status === "expected";
  if (date.precision === "month" || (expected && date.day - today > EXPECTED_WINDOW_DAYS)) {
    return showYear ? formatMonth(date.day) : formatMonth(date.day, { year: false });
  }
  const day = formatDay(date.day, { year: showYear });
  return expected ? `around ${day}` : day;
}

// Putting "by", "on" or "in" in front of the same date, so it reads naturally in a sentence
export function dateWithPreposition(date, today, options) {
  const words = dateWords(date, today, options);
  if (!words) {
    return "";
  }
  if (words.startsWith("around")) {
    return words;
  }
  return /^[0-9]/.test(words) ? `on${NBSP}${words}` : `in ${words}`;
}

export function monthHeading(day) {
  return formatMonth(day);
}

export function todayLabel(day) {
  return `Today, ${formatDay(day, { year: false })}`;
}

// Naming the engine's intake choice: "Autumn 2027", "March 2027" or "July 2027"
export function intakeName(code, choice) {
  if (!choice) {
    return "";
  }
  if (choice.month) {
    return formatMonth(dayFromParts(Number(choice.month.slice(0, 4)), Number(choice.month.slice(5, 7)), 1));
  }
  if (code === "nz") {
    return `March ${choice.cycle}`;
  }
  return `Autumn ${choice.cycle}`;
}

const MONTH_NAME = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/;

// Starting a title used inside a sentence in lower case ("take IELTS", "autumn 2028"), unless its
// first word is a name: "IELTS", "Türkiye" or a month such as "March 2029"
export function lowerFirst(text) {
  if (!text || /^[A-Z]{2,}\b/.test(text) || /^Türkiye\b/.test(text) || MONTH_NAME.test(text)) {
    return text;
  }
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// Joining a list as people write it: "a", "a and b", "a, b and c"
export function joinWords(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
