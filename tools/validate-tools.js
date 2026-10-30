// Checking the Toolkit's tools against the facts, the plans, the roadmaps and the writing rules: every
// fee a tool shows comes from a fact, every typed figure, minimum and comparison is held by a fact it
// cites, every quoted rule is written in its fact, every plan step, section and university it names
// exists, and every time zone converts on the phone
// Usage: node tools/validate-tools.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDay } from "../www/app/dates.js";
import { createFacts } from "../www/app/facts.js";
import { fillText, InsertError, RATE_FACTS, sumOf } from "../www/features/roadmaps/inserts.js";
import { LINK_WORDS, rowKey } from "../www/features/roadmaps/render.js";
import { TOOLS } from "./validate-roadmaps.js";

const FORMAT = 1;
const BANNED = [
  ["\u2014", "a long dash"], ["\u2013", "a short dash"], ["\u00B7", "a middle dot"], ["!", "an exclamation mark"],
  ["\u2192", "an arrow"], ["\u2190", "an arrow"], ["\u21D2", "an arrow"], ["\u2018", "a curly quote"], ["\u2019", "a curly quote"],
  ["\u201C", "a curly quote"], ["\u201D", "a curly quote"],
];
const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
// Filling every text as on the day the facts were last checked
const CHECK_DAY = "2026-10-25";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));

function* stringsIn(node, path = "") {
  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) {
      yield* stringsIn(value, `${path}[${index}]`);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      yield* stringsIn(value, `${path}.${key}`);
    }
  } else if (typeof node === "string") {
    yield [path, node];
  }
}

function writingProblems(name, doc) {
  const problems = [];
  for (const [where, text] of stringsIn(doc)) {
    for (const [char, label] of BANNED) {
      if (text.includes(char)) {
        problems.push(`${name}${where}: contains ${label}`);
      }
    }
  }
  return problems;
}

// Gathering the words of a fact, its notes included, to look a typed figure up in
function factWords(facts, ref) {
  if (!facts.has(ref)) {
    return "";
  }
  const record = facts.fact(ref);
  return JSON.stringify([record.value ?? null, record.note ?? null, ...(record.values ?? []).map((entry) => [entry.value, entry.note])]);
}

// Telling whether a number is written in a fact's words, as "6", "6.0", "4.00" or "12,000"
function holdsNumber(words, number) {
  const forms = new Set([String(number), number.toFixed(1), number.toFixed(2), String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",")]);
  return [...forms].some((form) => new RegExp(`(?<![\\d.])${form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\d])`).test(words));
}

// Gathering the words of every fact a part cites, to look its figures and quotes up in
function citedWords(facts, cite) {
  return (cite ?? []).map((ref) => factWords(facts, ref)).join(" ");
}

// Checking that a quote, which the tool shows as the rule's own words, is written in a fact it cites
function quoteProblems(where, quote, cite, facts) {
  if (typeof quote !== "string" || quote.length === 0) {
    return [`${where}: needs a quote from the fact it cites`];
  }
  return citedWords(facts, cite).includes(quote.replace(/"/g, '\\"')) ? [] : [`${where}: quotes words no cited fact holds: ${quote}`];
}

// Checking that a typed amount such as "100 MYR" is written in a fact it cites
function typedProblems(where, typed, cite, facts) {
  const match = /^(\d+(?:\.\d+)?) ([A-Z]{3})$/.exec(typed ?? "");
  if (!match || !RATE_FACTS[match[2]]) {
    return [`${where}: a typed amount must read like "100 MYR", in a currency Pathway has a rate for`];
  }
  const held = (cite ?? []).map((ref) => factWords(facts, ref)).join(" ");
  const number = match[1];
  const grouped = number.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return held.includes(number) || held.includes(grouped) ? [] : [`${where}: types ${typed}, which no cited fact holds`];
}

function feeProblems(where, fee, facts) {
  try {
    sumOf(facts, fee);
    return [];
  } catch (error) {
    if (error instanceof InsertError) {
      return [`${where}: ${error.message}`];
    }
    throw error;
  }
}

function citeProblems(where, cite, facts) {
  return (cite ?? []).filter((ref) => !facts.has(ref)).map((ref) => `${where}: cites no fact ${ref}`);
}

export function validateDeadline(doc, { facts }) {
  const name = "tools/deadline.json";
  if (doc?.format !== FORMAT || doc.tool !== "deadline" || !Array.isArray(doc.places)) {
    return [`${name}: format, tool or places is wrong`];
  }
  const problems = writingProblems(name, doc);
  const ids = doc.places.map((place) => place.id);
  if (new Set(ids).size !== ids.length) {
    problems.push(`${name}: a place is listed twice`);
  }
  for (const place of doc.places) {
    if (!place.id || !place.name) {
      problems.push(`${name}: every place needs an id and a name`);
    }
    if (place.zone === null) {
      if (!place.note) {
        problems.push(`${name}: ${place.id} has no zone, so it needs a note`);
      }
    } else {
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone: place.zone }).format(0);
      } catch {
        problems.push(`${name}: ${place.id} has a zone this phone cannot read: ${place.zone}`);
      }
      if (!place.city || !Array.isArray(place.shows) || place.shows.length === 0) {
        problems.push(`${name}: ${place.id} needs a city and the letters a page may show`);
      }
    }
    problems.push(...citeProblems(`${name}: ${place.id}`, place.cite, facts));
  }
  for (const [code, id] of Object.entries(doc.countries ?? {})) {
    if (!ids.includes(id)) {
      problems.push(`${name}: country ${code} points to no place ${id}`);
    }
  }
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: doc.home?.zone }).format(0);
  } catch {
    problems.push(`${name}: the home zone cannot be read`);
  }
  for (const [value, words] of doc.times ?? []) {
    if (value !== "midnight" && !TIME.test(value)) {
      problems.push(`${name}: time ${value} must be HH:MM or midnight`);
    }
    if (!words) {
      problems.push(`${name}: time ${value} needs words`);
    }
  }
  return problems;
}

export function validateMoney(doc, { facts, steps, listable }) {
  const name = "tools/money.json";
  if (doc?.format !== FORMAT || doc.tool !== "money" || !doc.countries || !Array.isArray(doc.tests) || !Number.isInteger(doc.cycle)) {
    return [`${name}: format, tool, cycle, tests or countries is wrong`];
  }
  const problems = writingProblems(name, doc);
  const today = readDay(CHECK_DAY);
  const testIds = doc.tests.map((test) => test.id);
  if (new Set(testIds).size !== testIds.length) {
    problems.push(`${name}: a test is listed twice`);
  }
  for (const test of doc.tests) {
    problems.push(...feeProblems(`${name}: test ${test.id}`, test.fee, facts));
    if (test.pair) {
      problems.push(...feeProblems(`${name}: test ${test.id}`, test.pair, facts));
    }
    if (!steps.common.has(test.step) && !Object.values(steps.countries).some((set) => set.has(test.step))) {
      problems.push(`${name}: test ${test.id} names no plan step ${test.step}`);
    }
    for (const code of test.countries ?? []) {
      if (!doc.countries[code]) {
        problems.push(`${name}: test ${test.id} names no country ${code}`);
      }
    }
  }
  for (const [code, country] of Object.entries(doc.countries)) {
    const where = `${name}: ${code}`;
    const has = (step) => steps.common.has(step) || steps.countries[code]?.has(step);
    if (!steps.countries[code]) {
      problems.push(`${where}: no such country`);
      continue;
    }
    if (!RATE_FACTS[country.currency]) {
      problems.push(`${where}: Pathway has no rate for ${country.currency}`);
    }
    if (!has(country.applyStep)) {
      problems.push(`${where}: names no plan step ${country.applyStep}`);
    }
    if (country.once) {
      problems.push(...feeProblems(`${where} ${country.once.id}`, country.once.fee, facts));
    }
    const keys = (country.universities ?? []).map((item) => item.key);
    if (new Set(keys).size !== keys.length) {
      problems.push(`${where}: a university is listed twice`);
    }
    for (const university of country.universities ?? []) {
      const at = `${where} ${university.key}`;
      if (!listable[code]?.has(university.key)) {
        problems.push(`${at}: is not a university My list can hold in the ${code} roadmap`);
      }
      if (university.fee) {
        problems.push(...feeProblems(at, university.fee, facts));
      } else if (university.typed) {
        problems.push(...typedProblems(at, university.typed, university.cite, facts), ...citeProblems(at, university.cite, facts));
      } else if (university.fee !== null) {
        problems.push(`${at}: needs a fee, a typed fee with a citation, or null when Pathway has none`);
      }
      if (university.waiver && !facts.has(university.waiver)) {
        problems.push(`${at}: names no waiver fact ${university.waiver}`);
      }
      if (university.waivedForAid !== undefined && (university.waivedForAid !== true || !university.waiver)) {
        problems.push(`${at}: a fee waived for aid applicants must say true and cite the waiver fact that says so`);
      }
    }
    if (country.aid) {
      problems.push(...feeProblems(`${where} ${country.aid.id}`, country.aid.fee, facts), ...feeProblems(`${where} ${country.aid.id}`, country.aid.extra, facts));
      if (!has(country.aid.step)) {
        problems.push(`${where} ${country.aid.id}: names no plan step ${country.aid.step}`);
      }
    }
    for (const after of country.after ?? []) {
      const at = `${where} ${after.id}`;
      if (after.ask) {
        if (!after.note) {
          problems.push(`${at}: an amount the student enters needs a note saying where to find it`);
        }
      } else {
        problems.push(...feeProblems(at, after.fee, facts));
      }
      problems.push(...citeProblems(at, after.cite, facts));
      if (!has(after.step)) {
        problems.push(`${at}: names no plan step ${after.step}`);
      }
    }
    const show = country.show;
    if (!show?.text) {
      problems.push(`${where}: needs a line on the money to show`);
    } else {
      problems.push(...citeProblems(`${where} show`, show.cite, facts));
      const filled = fillText(show.text, { facts, today, cycle: doc.cycle });
      if (/[{}]/.test(filled) || filled.length < show.text.replace(/\{[^}]*\}/g, "").length) {
        problems.push(`${where} show: an insert has no value`);
      }
    }
  }
  if (!Array.isArray(doc.notIncluded) || doc.notIncluded.length === 0) {
    problems.push(`${name}: needs the list of costs not included`);
  }
  return problems;
}


const TEST_IDS = ["ielts", "toefl", "pte", "duolingo"];
// Tying each way of working out an overall score, which the English check knows, to the words its
// cited fact must hold, so the check can never follow a rule the test owner does not state
const SCORING_WORDS = { average: "rounded to the nearest half band", sum: "sum of the four section scores", whole: "not an average", average5: "nearest 5" };

function scoringProblems(where, scoring, facts) {
  if (!scoring || !Object.hasOwn(SCORING_WORDS, scoring.kind)) {
    return [`${where}: scoring needs a kind Pathway knows (${Object.keys(SCORING_WORDS).join(", ")})`];
  }
  const words = factWords(facts, scoring.cite);
  if (!words) {
    return [`${where}: scoring cites no fact ${scoring.cite}`];
  }
  return words.includes(SCORING_WORDS[scoring.kind]) ? [] : [`${where}: scoring ${scoring.kind} is not what ${scoring.cite} says`];
}
const SECTION_NAMES = ["overall", "each", "listening", "reading", "writing", "speaking"];

// Checking every figure in one English rule against the fact it cites
function thresholdProblems(where, rule, words) {
  const problems = [];
  for (const [name, value] of Object.entries(rule)) {
    if (!SECTION_NAMES.includes(name) || typeof value !== "number") {
      problems.push(`${where}: ${name} is not a score Pathway can check`);
    } else if (!holdsNumber(words, value)) {
      problems.push(`${where}: ${name} ${value} is in no cited fact`);
    }
  }
  return problems;
}

export function validateEnglish(doc, { facts, listable, codes }) {
  const name = "tools/english.json";
  if (doc?.format !== FORMAT || doc.tool !== "english" || !doc.tests || !doc.compare || !Array.isArray(doc.rules)) {
    return [`${name}: format, tool, tests, compare or rules is wrong`];
  }
  const problems = writingProblems(name, doc);
  for (const id of TEST_IDS) {
    const test = doc.tests[id];
    if (!test) {
      problems.push(`${name}: no test ${id}`);
      continue;
    }
    problems.push(...feeProblems(`${name}: test ${id}`, test.fee, facts), ...citeProblems(`${name}: test ${id}`, [test.id, test.results, test.validity], facts));
    if (test.scales) {
      for (const scale of Object.keys(test.scales)) {
        problems.push(...scoringProblems(`${name}: test ${id} ${scale}`, test.scoring?.[scale], facts));
      }
      problems.push(...citeProblems(`${name}: test ${id} comparable`, [test.scoring?.comparable], facts));
    } else {
      problems.push(...scoringProblems(`${name}: test ${id}`, test.scoring, facts));
    }
  }
  for (const [id, table] of Object.entries(doc.compare)) {
    const words = factWords(facts, table.cite);
    if (!words) {
      problems.push(`${name}: table ${id} cites no fact ${table.cite}`);
      continue;
    }
    const values = [...table.rows.flat(), ...(table.border ?? []).flat(), ...(table.below ? [table.below.from, table.below.to, table.below.cefr, ...table.below.ielts, ...table.below.toefl] : [])];
    for (const value of values) {
      if (typeof value === "number" ? !holdsNumber(words, value) : !words.includes(value)) {
        problems.push(`${name}: table ${id} has ${value}, which ${table.cite} does not hold`);
      }
    }
  }
  for (const rule of doc.rules) {
    const where = `${name}: ${rule.name}`;
    if (!codes.includes(rule.country)) {
      problems.push(`${where}: no country ${rule.country}`);
    }
    if (rule.key !== undefined && !listable[rule.country]?.has(rule.key)) {
      problems.push(`${where}: ${rule.key} is not a university My list can hold`);
    }
    problems.push(...citeProblems(where, rule.cite, facts));
    const words = citedWords(facts, rule.cite);
    if (rule.noTest) {
      problems.push(...quoteProblems(where, rule.noTest, rule.cite, facts));
      continue;
    }
    for (const [test, wanted] of Object.entries(rule.tests ?? {})) {
      const at = `${where} ${test}`;
      if (!TEST_IDS.includes(test)) {
        problems.push(`${at}: no such test`);
      } else if (typeof wanted.accepted === "boolean") {
        problems.push(...quoteProblems(at, wanted.quote, rule.cite, facts));
      } else if (test === "toefl") {
        if (!wanted.new && !wanted.old) {
          problems.push(`${at}: a TOEFL rule needs the new scale, the old scale or both`);
        }
        for (const scale of ["new", "old"].filter((one) => wanted[one])) {
          problems.push(...thresholdProblems(`${at} ${scale}`, wanted[scale], words));
        }
      } else {
        problems.push(...thresholdProblems(at, wanted, words));
      }
    }
  }
  return problems;
}

const GRADE_ORDER = ["A*", "A", "B", "C", "D", "E"];
const BOARDS = ["cambridge", "edexcel"];

function oneRuleProblems(where, rule, cite, facts, extra = []) {
  const problems = [];
  if (rule.ask !== undefined && typeof rule.ask !== "string") {
    problems.push(`${where}: an ask needs words`);
  }
  problems.push(...quoteProblems(where, rule.quote, cite, facts));
  const words = citedWords(facts, [...cite, ...extra]);
  for (const field of ["gpa", "percent", "tariff"].filter((one) => rule[one] !== undefined)) {
    if (!holdsNumber(words, rule[field])) {
      problems.push(`${where}: ${field} ${rule[field]} is in no cited fact`);
    }
  }
  for (const grade of rule.grades ?? []) {
    if (!GRADE_ORDER.includes(grade)) {
      problems.push(`${where}: no grade ${grade}`);
    }
  }
  return problems;
}

export function validateGrades(doc, { facts, listable, codes }) {
  const name = "tools/grades.json";
  if (doc?.format !== FORMAT || doc.tool !== "grades" || !doc.hsc || !doc.alevel || !Array.isArray(doc.rules)) {
    return [`${name}: format, tool, hsc, alevel or rules is wrong`];
  }
  const problems = writingProblems(name, doc);
  const bandWords = factWords(facts, doc.hsc.cite);
  for (const [grade, from, to, points] of doc.hsc.bands) {
    if (!bandWords.includes(`${grade} for ${from} to ${to}`) || !holdsNumber(bandWords, points)) {
      problems.push(`${name}: band ${grade} is not as ${doc.hsc.cite} gives it`);
    }
  }
  for (const reading of doc.readings) {
    const words = factWords(facts, reading.cite);
    for (const [from, to, letter, points] of reading.rows) {
      if (!words.includes(`${from} to ${to}`) || !words.includes(` ${letter}`) || (points !== undefined && !holdsNumber(words, points))) {
        problems.push(`${name}: ${reading.name} row ${from} to ${to} is not as ${reading.cite} gives it`);
      }
    }
  }
  const tariff = factWords(facts, doc.alevel.tariff.cite);
  for (const [kind, table] of [["A level", doc.alevel.tariff.aLevel], ["AS level", doc.alevel.tariff.as]]) {
    for (const [grade, points] of Object.entries(table)) {
      if (!tariff.includes(`${grade} ${points}`)) {
        problems.push(`${name}: ${kind} ${grade} ${points} is not in ${doc.alevel.tariff.cite}`);
      }
    }
  }
  if (!factWords(facts, doc.alevel.units.cite).includes("six")) {
    problems.push(`${name}: the unit rule is not in ${doc.alevel.units.cite}`);
  }
  for (const rule of doc.rules) {
    const where = `${name}: ${rule.name}, ${rule.for}`;
    if (!codes.includes(rule.country)) {
      problems.push(`${where}: no country ${rule.country}`);
    }
    if (rule.key !== undefined && !listable[rule.country]?.has(rule.key)) {
      problems.push(`${where}: ${rule.key} is not a university My list can hold`);
    }
    problems.push(...citeProblems(where, rule.cite, facts));
    if (!rule.hsc && !rule.alevel) {
      problems.push(`${where}: needs an HSC rule, A level rules or both`);
    }
    if (rule.hsc) {
      problems.push(...oneRuleProblems(`${where} HSC`, rule.hsc, rule.cite, facts));
    }
    for (const one of rule.alevel ?? []) {
      if (!Array.isArray(one.boards) || one.boards.length === 0 || one.boards.some((board) => !BOARDS.includes(board))) {
        problems.push(`${where} A levels: boards must be cambridge, edexcel or both`);
      }
      problems.push(...citeProblems(`${where} A levels`, one.cite, facts), ...oneRuleProblems(`${where} A levels`, one, rule.cite, facts, one.cite ?? []));
    }
  }
  return problems;
}

export function validateWords(doc, { facts, codes }) {
  const name = "tools/words.json";
  if (doc?.format !== FORMAT || doc.tool !== "words" || !Array.isArray(doc.words) || !Array.isArray(doc.places)) {
    return [`${name}: format, tool, places or words is wrong`];
  }
  const problems = writingProblems(name, doc);
  const places = new Set(doc.places.map(([code]) => code));
  const ids = new Set();
  const terms = new Set();
  for (const word of doc.words) {
    const where = `${name}: ${word.id}`;
    if (ids.has(word.id) || terms.has(word.term)) {
      problems.push(`${where}: listed twice`);
    }
    ids.add(word.id);
    terms.add(word.term);
    if (!word.term || !word.meaning || !Array.isArray(word.also) || typeof word.forYou !== "string") {
      problems.push(`${where}: needs a term, other names, a meaning and a line for the student`);
    }
    if (!Array.isArray(word.where) || word.where.length === 0 || word.where.some((code) => !places.has(code) || (code !== "all" && code !== "bd" && !codes.includes(code)))) {
      problems.push(`${where}: names a place Pathway does not filter by`);
    }
    if (!Array.isArray(word.cite) || word.cite.length === 0) {
      problems.push(`${where}: needs at least one fact`);
    }
    problems.push(...citeProblems(where, word.cite, facts));
    if (word.link !== undefined && !LINK_WORDS[word.link]) {
      problems.push(`${where}: links to no guide or tool ${word.link}`);
    }
  }
  for (const word of doc.words) {
    for (const id of word.related ?? []) {
      if (!ids.has(id) || id === word.id) {
        problems.push(`${name}: ${word.id} is related to no word ${id}`);
      }
    }
  }
  return problems;
}

export function validateVisa(doc, { facts, codes, sections }) {
  const name = "tools/visa.json";
  if (doc?.format !== FORMAT || doc.tool !== "visa" || !doc.countries || !Array.isArray(doc.cards)) {
    return [`${name}: format, tool, countries or cards is wrong`];
  }
  const problems = writingProblems(name, doc);
  for (const code of codes) {
    const place = doc.countries[code];
    if (!place?.answer) {
      problems.push(`${name}: ${code} needs an answer`);
      continue;
    }
    problems.push(...citeProblems(`${name}: ${code}`, place.cite, facts));
    if (!sections[code]?.has(place.section)) {
      problems.push(`${name}: ${code} links to no roadmap section ${place.section}`);
    }
  }
  for (const part of [...doc.day, ...doc.refused]) {
    if (!part.title || !part.text || !part.cite?.length) {
      problems.push(`${name}: every part needs a title, words and a fact`);
    }
    problems.push(...citeProblems(`${name}: ${part.title}`, part.cite, facts));
  }
  problems.push(...citeProblems(`${name}: practice`, doc.practiceCite, facts));
  const ids = doc.cards.map((card) => card.id);
  if (new Set(ids).size !== ids.length) {
    problems.push(`${name}: a question is listed twice`);
  }
  for (const card of doc.cards) {
    if (!card.question || !card.why || !Array.isArray(card.good) || card.good.length === 0) {
      problems.push(`${name}: ${card.id} needs a question, a reason and what a good answer shows`);
    }
    problems.push(...citeProblems(`${name}: ${card.id}`, card.cite, facts));
  }
  return problems;
}

// Reading everything the checks hold the tools against
export function toolContext() {
  const index = read("www/data/countries/index.json").countries;
  const bd = read("www/data/common/bd.json");
  const docs = { bd };
  const steps = { common: new Set(read("www/data/common/plan.json").steps.map((step) => step.id)), countries: {} };
  const listable = {};
  const sections = {};
  for (const { code } of index) {
    docs[code] = read(`www/data/countries/${code}/facts.json`);
    steps.countries[code] = new Set(read(`www/data/countries/${code}/plan.json`).steps.map((step) => step.id));
    const roadmap = read(`www/data/countries/${code}/roadmap.json`);
    sections[code] = new Set(roadmap.sections.map((section) => section.id));
    listable[code] = new Set(roadmap.sections.flatMap((section) => section.blocks.filter((block) => block.type === "table" && block.listable).flatMap((block) => block.rows.map((row) => rowKey(row[0])))));
  }
  const words = new Set(read("www/data/tools/words.json").words.map((word) => word.id));
  return { facts: createFacts(docs), steps, listable, sections, words, codes: index.map((item) => item.code) };
}

// Checking the Scholarships tab's list: every group and university is named once, every line rests
// on a text fact, every word exists in the word list, and the roadmap section it links to exists
export function validateScholarships(doc, { facts, codes, sections, words }) {
  const name = "scholarships/us.json";
  if (doc?.format !== FORMAT || !codes.includes(doc.country) || !Array.isArray(doc.groups) || !Array.isArray(doc.universities)) {
    return [`${name}: format, country, groups or universities is wrong`];
  }
  const problems = writingProblems(name, doc);
  if (!sections[doc.country]?.has(doc.roadmapSection)) {
    problems.push(`${name}: no roadmap section ${doc.roadmapSection}`);
  }
  for (const id of doc.words ?? []) {
    if (!words.has(id)) {
      problems.push(`${name}: no word ${id} in the word list`);
    }
  }
  const groups = doc.groups.map((group) => group.id);
  const keys = doc.universities.map((item) => item.key);
  for (const [label, list] of [["group", groups], ["university", keys]]) {
    for (const twice of new Set(list.filter((id, index) => list.indexOf(id) !== index))) {
      problems.push(`${name}: ${label} ${twice} is listed twice`);
    }
  }
  for (const item of doc.universities) {
    const where = `${name}: ${item.name}`;
    if (!groups.includes(item.group)) {
      problems.push(`${where}: no group ${item.group}`);
    }
    if (!item.summary || !Array.isArray(item.cite) || item.cite.length === 0) {
      problems.push(`${where}: needs a summary and at least one fact`);
      continue;
    }
    problems.push(...citeProblems(where, item.cite, facts));
    for (const ref of item.cite.filter((one) => facts.has(one) && typeof facts.fact(one).value?.text !== "string")) {
      problems.push(`${where}: ${ref} is not a text fact`);
    }
  }
  return problems;
}

export const VALIDATORS = { grades: validateGrades, english: validateEnglish, deadline: validateDeadline, words: validateWords, money: validateMoney, visa: validateVisa };

function main() {
  const context = toolContext();
  let problems = [];
  for (const tool of TOOLS) {
    if (!VALIDATORS[tool]) {
      problems.push(`${tool}: no checks for this tool`);
      continue;
    }
    problems = problems.concat(VALIDATORS[tool](read(`www/data/tools/${tool}.json`), context));
  }
  problems = problems.concat(validateScholarships(read("www/data/scholarships/us.json"), context));
  console.log(`${TOOLS.size} tools and the scholarship list`);
  console.log(problems.length > 0 ? problems.join("\n") : "No problems found.");
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
