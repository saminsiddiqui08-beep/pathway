// Checking the five roadmap files and the Toolkit guides against the facts, the plans and the writing rules.
// Usage: node tools/validate-roadmaps.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDay } from "../www/app/dates.js";
import { createFacts } from "../www/app/facts.js";
import { fillText, insertsIn, InsertError, isYearForm, KINDS, resolve } from "../www/features/roadmaps/inserts.js";

const FORMAT = 1;
const SECTIONS = 17;
const BLOCK_TYPES = new Set(["p", "heading", "list", "checklist", "table", "widget", "button", "fold"]);
const WIDGETS = new Set(["routeFinder", "englishPicker", "myList", "permitCalculator", "sources", "fieldPicker", "filter"]);
// Naming the guides and tools a link may open; "scholarships" waits in the data until that tab is built
const LINKS = new Set(["profile", "olympiads", "research", "costs", "money", "deadline", "grades", "english", "words", "visa", "scholarships"]);
// Naming the tools the Toolkit can open, each with its own module and data file
export const TOOLS = new Set(["grades", "english", "deadline", "words", "money", "visa"]);
const TEMPLATES = new Set(["sit", "sat"]);
const MARKS = new Set(["needs", "recommends", "none", "optional", "check", "depends"]);
const BANNED = [
  ["\u2014", "a long dash"], ["\u2013", "a short dash"], ["\u00B7", "a middle dot"], ["!", "an exclamation mark"],
  ["\u2192", "an arrow"], ["\u2190", "an arrow"], ["\u21D2", "an arrow"], ["\u2018", "a curly quote"], ["\u2019", "a curly quote"],
  ["\u201C", "a curly quote"], ["\u201D", "a curly quote"],
];
// Finding typed amounts, written "NZD 850", "RM750", "9,600 EUR" or "800 US dollars", and taka figures
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const AMOUNT = new RegExp(String.raw`\b(?:(?:USD|EUR|NZD|MYR|TRY|BDT|GBP|RM) ?(${NUMBER})(?: (?:to|or) (?:(?:USD|EUR|NZD|MYR|TRY|RM) ?)?(${NUMBER}))?|(${NUMBER})(?: (?:to|or) (${NUMBER}))? (?:USD|EUR|NZD|MYR|TRY|BDT|GBP|US dollars|dollars|euros|lira))\b`, "g");
// Checking every year section for each HSC year a student may hold, from the latest exams over to class 9
const TEMPLATE_YEARS = [2026, 2027, 2028, 2029, 2030, 2031];
// Filling every text as on the day the facts were last checked
const CHECK_DAY = "2026-10-22";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));

// Walking every text in a block with the facts it may draw on: its own citations, and in a table
// the citations of its whole row
function* textsOf(block) {
  if (typeof block.text === "string") {
    yield { item: block, cites: block.cite ?? [], template: block.template };
  }
  for (const item of block.items ?? []) {
    yield { item, cites: item.cite ?? [], template: item.template ?? block.template };
  }
  for (const row of block.rows ?? []) {
    const cites = row.flatMap((cell) => cell.cite ?? []);
    for (const cell of row) {
      yield { item: cell, cites, template: block.template };
    }
  }
}

function factText(facts, ref) {
  if (!facts.has(ref)) {
    return "";
  }
  const record = facts.fact(ref);
  return JSON.stringify([record.value ?? null, record.note ?? null, ...(record.values ?? []).map((entry) => [entry.value, entry.note])]);
}

export function validateRoadmap(code, roadmap, { facts, steps, sources }) {
  const problems = [];
  const where = (section, detail) => `${code} section ${section?.number ?? "?"}: ${detail}`;
  if (roadmap?.format !== FORMAT) {
    problems.push(`${code}: format must be ${FORMAT}`);
    return problems;
  }
  if (roadmap.roadmap !== code || JSON.stringify(roadmap.facts) !== JSON.stringify(["bd", code]) || !Number.isInteger(roadmap.cycle) || !roadmap.title) {
    problems.push(`${code}: roadmap, title, facts or cycle is wrong`);
  }
  const sections = Array.isArray(roadmap.sections) ? roadmap.sections : [];
  if (sections.length !== SECTIONS || sections.some((section, index) => section.number !== index + 1)) {
    problems.push(`${code}: needs ${SECTIONS} sections, numbered in order`);
  }
  const ids = sections.map((section) => section.id);
  if (new Set(ids).size !== ids.length) {
    problems.push(`${code}: section ids are used twice`);
  }
  for (const section of sections) {
    if (!section.id || !section.station || !section.title) {
      problems.push(where(section, "needs an id, a title and a station label"));
    }
    problems.push(...sectionProblems(section, roadmap.cycle, { facts, steps, sources }, where));
    if (section.blocks?.some((block) => block.type === "fold")) {
      problems.push(where(section, "folded parts belong only in guides"));
    }
  }
  return problems;
}

// Checking a guide for the Toolkit, which holds the same blocks as one roadmap section
export function validateGuide(name, guide, context) {
  if (guide?.format !== FORMAT || guide.guide !== name || !Array.isArray(guide.blocks) || !guide.title || !Number.isInteger(guide.cycle)) {
    return [`${name}: format, guide, title, cycle or blocks is wrong`];
  }
  return sectionProblems({ number: 1, blocks: guide.blocks }, guide.cycle, context, (section, detail) => `${name}: ${detail}`);
}

// Listing every guide and tool in the Toolkit's main sections
export function indexEntries(index) {
  return (Array.isArray(index?.sections) ? index.sections : []).flatMap((section) => (Array.isArray(section.guides) ? section.guides : []));
}

// Listing only the guides, which have content files of their own
export function indexGuides(index) {
  return indexEntries(index).filter((item) => item.kind !== "tool");
}

// Checking the Toolkit's main sections and the guides in them: each section and each guide named
// once, each with a title and a line about it
export function validateGuideIndex(index, guides) {
  const problems = [];
  if (index?.format !== FORMAT || !Array.isArray(index.sections) || index.sections.length === 0) {
    return ["guides/index.json: format or sections is wrong"];
  }
  const sectionIds = index.sections.map((section) => section.id);
  if (new Set(sectionIds).size !== sectionIds.length) {
    problems.push("guides/index.json: a section is listed twice");
  }
  for (const section of index.sections) {
    if (!section.id || !section.title || !section.summary || !Array.isArray(section.guides) || section.guides.length === 0) {
      problems.push(`guides/index.json: section ${section.id} needs an id, a title, a summary and its guides`);
    }
  }
  const all = indexEntries(index);
  const ids = all.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    problems.push("guides/index.json: a guide is listed twice");
  }
  for (const item of all) {
    if (item.kind !== undefined && item.kind !== "tool") {
      problems.push(`guides/index.json: ${item.id} has an unknown kind ${item.kind}`);
    }
    for (const text of [item.title, item.summary].filter((one) => typeof one === "string")) {
      for (const [char, label] of BANNED) {
        if (text.includes(char)) {
          problems.push(`guides/index.json: ${item.id} contains ${label}`);
        }
      }
    }
    if (!item.title || !item.summary) {
      problems.push(`guides/index.json: ${item.id} needs a title and a summary`);
    } else if (item.kind === "tool" && !TOOLS.has(item.id)) {
      problems.push(`guides/index.json: ${item.id} is listed as a tool, but no such tool exists`);
    } else if (item.kind !== "tool" && guides[item.id]?.title !== item.title) {
      problems.push(`guides/index.json: ${item.id} has a different title from its guide`);
    }
  }
  for (const link of LINKS) {
    if (link !== "scholarships" && !ids.includes(link)) {
      problems.push(`guides/index.json: no guide or tool ${link}, which links point to`);
    }
  }
  return problems;
}

// Checking the words a widget shows that are not texts of their own: questions, notes and labels
function widgetWords(block) {
  return [block.question, block.note, ...(block.fields ?? []).map((field) => field.label), ...(block.options ?? []).map((option) => option[1])].filter((text) => typeof text === "string");
}

function sectionProblems(section, cycle, { facts, steps, sources }, where, nested = false) {
  const problems = [];
  const today = readDay(CHECK_DAY);
  for (const step of section.planSteps ?? []) {
    if (!steps.has(step)) {
      problems.push(where(section, `links to no plan step ${step}`));
    }
  }
  for (const block of section.blocks ?? []) {
    if (!BLOCK_TYPES.has(block.type)) {
      problems.push(where(section, `unknown block type ${block.type}`));
      continue;
    }
    for (const item of [block, ...(block.items ?? [])]) {
      if (item.template !== undefined && !TEMPLATES.has(item.template)) {
        problems.push(where(section, `unknown template ${item.template}`));
      }
    }
    if (block.type === "widget" && !WIDGETS.has(block.id)) {
      problems.push(where(section, `unknown widget ${block.id}`));
    }
    if (block.type === "button" && block.action !== "makePlan") {
      problems.push(where(section, `unknown button ${block.action}`));
    }
    problems.push(...widgetProblems(block, section, where));
    for (const text of widgetWords(block)) {
      for (const [char, label] of BANNED) {
        if (text.includes(char)) {
          problems.push(where(section, `contains ${label}: ${text.slice(0, 60)}`));
        }
      }
    }
    // Checking each subject's own blocks in a guide's subject picker by the same rules
    for (const field of block.id === "fieldPicker" ? block.fields ?? [] : []) {
      problems.push(...sectionProblems({ number: section.number, blocks: field.blocks ?? [] }, cycle, { facts, steps, sources }, where, true));
    }
    // Checking a folded part's title and its blocks, which may not hold another folded part
    if (block.type === "fold") {
      if (nested) {
        problems.push(where(section, "a folded part cannot sit inside another part"));
      }
      if (!block.title || !Array.isArray(block.blocks) || block.blocks.length === 0) {
        problems.push(where(section, "a folded part needs a title and blocks"));
      }
      for (const text of [block.title, block.summary].filter((one) => typeof one === "string")) {
        for (const [char, label] of BANNED) {
          if (text.includes(char)) {
            problems.push(where(section, `contains ${label}: ${text.slice(0, 60)}`));
          }
        }
      }
      problems.push(...sectionProblems({ number: section.number, blocks: block.blocks ?? [] }, cycle, { facts, steps, sources }, where, true));
    }
    for (const { item, cites, template } of textsOf(block)) {
      const text = item.text;
      for (const [char, label] of BANNED) {
        if (text.includes(char)) {
          problems.push(where(section, `contains ${label}: ${text.slice(0, 60)}`));
        }
      }
      if (item.link !== undefined && !LINKS.has(item.link)) {
        problems.push(where(section, `unknown link ${item.link}`));
      }
      for (const ref of item.cite ?? []) {
        if (!facts.has(ref)) {
          problems.push(where(section, `cites no fact ${ref}`));
        }
      }
      for (const ref of item.sources ?? []) {
        if (!sources.has(ref)) {
          problems.push(where(section, `cites no source ${ref}`));
        }
      }
      for (const step of item.planSteps ?? []) {
        if (!steps.has(step)) {
          problems.push(where(section, `links to no plan step ${step}`));
        }
      }
      for (const { whole, name, argument } of insertsIn(text)) {
        if (isYearForm(name) || (name === "date" || name === "whenDate" || name === "fromDate" || name === "toDate" || name === "window") && argument?.includes("@")) {
          if (!template) {
            problems.push(where(section, `${whole} belongs only in a year section`));
          }
          if (isYearForm(name)) {
            continue;
          }
        }
        if (!KINDS.has(name)) {
          problems.push(where(section, `unknown insert ${whole}`));
          continue;
        }
        const years = template ? TEMPLATE_YEARS : [null];
        for (const year of years) {
          try {
            const value = resolve(name, argument, { facts, today, cycle, templateYear: year ?? undefined });
            if ((value === null || value === "") && !template) {
              problems.push(where(section, `${whole} has no value`));
            }
          } catch (error) {
            if (!(error instanceof InsertError)) {
              throw error;
            }
            problems.push(where(section, `${whole}: ${error.message}`));
            break;
          }
        }
      }
      // Allowing a typed amount only where a cited fact holds it, and never a typed taka figure
      const plain = text.replace(/\{[^}]*\}/g, "");
      if (plain.includes("৳")) {
        problems.push(where(section, `types a taka figure: ${text.slice(0, 80)}`));
      }
      const held = cites.map((ref) => factText(facts, ref)).join(" ");
      for (const match of plain.matchAll(AMOUNT)) {
        for (const number of match.slice(1).filter(Boolean)) {
          if (!held.includes(number)) {
            problems.push(where(section, `types ${match[0]}, which no cited fact holds`));
          }
        }
      }
      // Filling every text, and every year section for each year, so no brace can reach the screen
      for (const year of template ? TEMPLATE_YEARS : [undefined]) {
        const filled = fillText(text, { facts, today, cycle, templateYear: year });
        if (/[{}]/.test(filled)) {
          problems.push(where(section, `leaves a brace after filling: ${filled.slice(0, 60)}`));
        }
      }
    }
  }
  return problems;
}

function widgetProblems(block, section, where) {
  const problems = [];
  if (block.type !== "widget") {
    return problems;
  }
  const after = section.blocks.slice(section.blocks.indexOf(block) + 1).filter((item) => item.type === "table");
  if (block.id === "routeFinder") {
    const questions = new Set((block.questions ?? []).map((question) => question.id));
    (block.tables ?? []).forEach((rows, index) => {
      if (!after[index] || after[index].rows.length !== rows.length) {
        problems.push(where(section, `route finder table ${index + 1} does not match the table after it`));
      }
      for (const row of rows) {
        for (const id of Object.keys(row.fits ?? {})) {
          if (!questions.has(id)) {
            problems.push(where(section, `route finder names no question ${id}`));
          }
        }
      }
    });
  }
  if (block.id === "fieldPicker") {
    const fields = Array.isArray(block.fields) ? block.fields : [];
    const ids = fields.map((field) => field.id);
    if (fields.length < 2 || !block.question || !block.note || new Set(ids).size !== ids.length || fields.some((field) => !field.id || !field.label || !Array.isArray(field.blocks) || field.blocks.length === 0)) {
      problems.push(where(section, "the subject picker needs a question, a note and at least two subjects, each with an id, a label and blocks"));
    }
  }
  if (block.id === "filter") {
    const values = (block.options ?? []).map((option) => option[0]);
    if (!after[0] || values[0] !== "all" || !block.question) {
      problems.push(where(section, "a filter needs a question, \"all\" as its first option and a table after it"));
    } else if (after[0].rows.some((row) => !Array.isArray(row[0].tags) || row[0].tags.length === 0 || row[0].tags.some((tag) => !values.includes(tag) || tag === "all"))) {
      problems.push(where(section, "every row after a filter needs tags from its options"));
    } else if (values.slice(1).some((value) => !after[0].rows.some((row) => row[0].tags.includes(value)))) {
      problems.push(where(section, "every filter option must show at least one row"));
    }
  }
  if (block.id === "englishPicker") {
    const rows = block.mode === "ask" ? block.marks : block.refuses;
    if (!after[0] || !Array.isArray(rows) || after[0].rows.length !== rows.length) {
      problems.push(where(section, "the English picker does not match the table after it"));
    }
    for (const rules of block.mode === "ask" ? block.marks : []) {
      if (!rules.length || rules.some((rule) => !MARKS.has(rule.mark)) || rules[rules.length - 1].when) {
        problems.push(where(section, "each English picker row needs marks ending with one for every answer"));
      }
    }
  }
  return problems;
}

function main() {
  const index = read("www/data/countries/index.json").countries;
  const common = read("www/data/common/plan.json");
  const bd = read("www/data/common/bd.json");
  let problems = [];
  for (const { code } of index) {
    const doc = read(`www/data/countries/${code}/facts.json`);
    const facts = createFacts({ bd, [code]: doc });
    const plan = read(`www/data/countries/${code}/plan.json`);
    const steps = new Set([...common.steps, ...plan.steps].map((step) => step.id));
    const sources = new Set([...Object.keys(bd.sources).map((id) => `bd/${id}`), ...Object.keys(doc.sources).map((id) => `${code}/${id}`)]);
    problems = problems.concat(validateRoadmap(code, read(`www/data/countries/${code}/roadmap.json`), { facts, steps, sources }));
  }
  const guideIndex = read("www/data/guides/index.json");
  const guides = Object.fromEntries(indexGuides(guideIndex).map((item) => [item.id, read(`www/data/guides/${item.id}.json`)]));
  problems = problems.concat(validateGuideIndex(guideIndex, guides));
  for (const [id, guide] of Object.entries(guides)) {
    const docs = Object.fromEntries((guide.facts ?? []).map((code) => [code, code === "bd" ? bd : read(`www/data/countries/${code}/facts.json`)]));
    problems = problems.concat(validateGuide(id, guide, {
      facts: createFacts(docs), steps: new Set(), sources: new Set(Object.entries(docs).flatMap(([code, doc]) => Object.keys(doc.sources).map((source) => `${code}/${source}`))),
    }));
  }
  console.log(`${index.length} roadmaps and ${Object.keys(guides).length} guides`);
  console.log(problems.length > 0 ? problems.join("\n") : "No problems found.");
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
