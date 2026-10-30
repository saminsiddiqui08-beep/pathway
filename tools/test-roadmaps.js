// Checking the roadmaps: the real files pass, each kind of mistake is caught, and the inserts fill
// in exactly the figures and dates the facts hold. Run with node tools/test-roadmaps.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readDay } from "../www/app/dates.js";
import { createFacts } from "../www/app/facts.js";
import { moneyText, takaText } from "../www/app/money.js";
import { fillText, resolve } from "../www/features/roadmaps/inserts.js";
import { inline, keyOf, listLabel, planAnswers, roadmapHtml, rowKey, sectionBody } from "../www/features/roadmaps/render.js";
import { glue } from "../www/features/timeline/words.js";
import { indexGuides, validateGuide, validateGuideIndex, validateRoadmap } from "./validate-roadmaps.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const COMMON = read("www/data/common/plan.json");
const BD = read("www/data/common/bd.json");
const CODES = read("www/data/countries/index.json").countries.map((country) => country.code);
const TODAY = readDay("2026-10-22");
const GUIDE_INDEX = read("www/data/guides/index.json");
const GUIDES = Object.fromEntries(indexGuides(GUIDE_INDEX).map((item) => [item.id, read(`www/data/guides/${item.id}.json`)]));
const factsDoc = (code) => (code === "bd" ? BD : read(`www/data/countries/${code}/facts.json`));

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function setup(code) {
  const doc = read(`www/data/countries/${code}/facts.json`);
  const plan = read(`www/data/countries/${code}/plan.json`);
  return {
    facts: createFacts({ bd: BD, [code]: doc }),
    steps: new Set([...COMMON.steps, ...plan.steps].map((step) => step.id)),
    sources: new Set([...Object.keys(BD.sources).map((id) => `bd/${id}`), ...Object.keys(doc.sources).map((id) => `${code}/${id}`)]),
  };
}

function section(roadmap, number) {
  return roadmap.sections.find((item) => item.number === number);
}

// Breaking one roadmap in one way per case, with a piece of the problem the validator must report
const CASES = [
  { name: "a section missing", code: "nz", edit: (r) => { r.sections.pop(); }, expect: "needs 17 sections" },
  { name: "a citation of no fact", code: "us", edit: (r) => { section(r, 1).blocks[1].items[0].cite = ["us/no.such"]; }, expect: "cites no fact us/no.such" },
  { name: "a link to no plan step", code: "fi", edit: (r) => { section(r, 9).planSteps.push("fi.nothing"); }, expect: "links to no plan step fi.nothing" },
  { name: "a typed taka figure", code: "tr", edit: (r) => { section(r, 1).blocks[0].text += " About ৳2.5 lakh."; }, expect: "types a taka figure" },
  { name: "a typed amount no fact holds", code: "my", edit: (r) => { section(r, 1).blocks[0].text += " Fees start at RM9,999."; }, expect: "types RM9,999, which no cited fact holds" },
  { name: "an amount typed instead of inserted", code: "nz", edit: (r) => { section(r, 9).blocks[0].items[7].text = "Pay NZD 851."; }, expect: "types NZD 851" },
  { name: "a long dash", code: "us", edit: (r) => { section(r, 2).blocks[1].text += " One \u2014 two."; }, expect: "contains a long dash" },
  { name: "a curly quote", code: "fi", edit: (r) => { section(r, 2).blocks[1].text += " \u201CSix\u201D."; }, expect: "contains a curly quote" },
  { name: "an unknown insert", code: "my", edit: (r) => { section(r, 1).blocks[0].text += " {price:my/pass.bond}."; }, expect: "unknown insert {price:my/pass.bond}" },
  { name: "a year insert outside a year section", code: "tr", edit: (r) => { section(r, 1).blocks[0].text += " In {hscYear}."; }, expect: "belongs only in a year section" },
  { name: "a variant that does not exist", code: "nz", edit: (r) => { section(r, 1).blocks[1].items[0].text += " {money:nz/tuition.auckland#Law}."; }, expect: "No amount in nz/tuition.auckland#Law" },
  { name: "a route finder for the wrong table", code: "my", edit: (r) => { section(r, 3).blocks.find((b) => b.id === "routeFinder").tables[0].pop(); }, expect: "does not match the table after it" },
  { name: "an English picker without a final mark", code: "us", edit: (r) => { section(r, 6).blocks.find((b) => b.id === "englishPicker").marks[2].pop(); }, expect: "ending with one for every answer" },
  { name: "an unknown widget", code: "fi", edit: (r) => { section(r, 7).blocks.push({ type: "widget", id: "quiz" }); }, expect: "unknown widget quiz" },
  { name: "a wrong format", code: "us", edit: (r) => { r.format = 2; }, expect: "format must be 1" },
  { name: "a link to no guide", code: "us", edit: (r) => { section(r, 1).blocks[0].link = "quiz"; }, expect: "unknown link quiz" },
  { name: "a folded part in a roadmap", code: "fi", edit: (r) => { section(r, 2).blocks.push({ type: "fold", title: "More", blocks: [{ type: "p", text: "Text." }] }); }, expect: "folded parts belong only in guides" },
];

// Breaking one Toolkit guide in one way per case
const field = (g) => g.blocks.find((block) => block.id === "fieldPicker").fields[0];
const GUIDE_CASES = [
  { name: "a subject with no blocks", guide: "profile", edit: (g) => { field(g).blocks = []; }, expect: "the subject picker needs" },
  { name: "a long dash in a subject's name", guide: "profile", edit: (g) => { field(g).label += " \u2014 more"; }, expect: "contains a long dash" },
  { name: "a citation of no fact inside a subject", guide: "profile", edit: (g) => { field(g).blocks.find((block) => block.type === "list").items[0].cite = ["bd/no.such"]; }, expect: "cites no fact bd/no.such" },
  { name: "a row tagged with no filter option", guide: "olympiads", edit: (g) => { g.blocks.find((block) => block.type === "table").rows[0][0].tags = ["sport"]; }, expect: "needs tags from its options" },
  { name: "a filter option that shows nothing", guide: "olympiads", edit: (g) => { g.blocks.find((block) => block.id === "filter").options.push(["art", "Art"]); }, expect: "must show at least one row" },
  { name: "a guide without a title", guide: "research", edit: (g) => { delete g.title; }, expect: "format, guide, title, cycle or blocks is wrong" },
  { name: "a folded part with no title", guide: "costs", edit: (g) => { delete g.blocks.find((block) => block.type === "fold").title; }, expect: "a folded part needs a title and blocks" },
  { name: "a folded part inside another", guide: "costs", edit: (g) => { const outer = g.blocks.find((block) => block.type === "fold"); outer.blocks.push(structuredClone(outer)); }, expect: "cannot sit inside another part" },
  { name: "a citation of no fact inside a folded part", guide: "costs", edit: (g) => { g.blocks.find((block) => block.type === "fold").blocks[0].items[0].cite = ["bd/no.such"]; }, expect: "cites no fact bd/no.such" },
];

// Reading the facts a guide names, as the Toolkit does
function guideContext(guide) {
  const docs = Object.fromEntries(guide.facts.map((code) => [code, factsDoc(code)]));
  return { facts: createFacts(docs), steps: new Set(), sources: new Set(Object.entries(docs).flatMap(([code, doc]) => Object.keys(doc.sources).map((id) => `${code}/${id}`))) };
}

function testFiles() {
  for (const code of CODES) {
    const problems = validateRoadmap(code, read(`www/data/countries/${code}/roadmap.json`), setup(code));
    check(`${code}: the real roadmap passes`, problems.length === 0, problems.slice(0, 3).join("; "));
  }
  for (const testCase of CASES) {
    const roadmap = read(`www/data/countries/${testCase.code}/roadmap.json`);
    testCase.edit(roadmap);
    const problems = validateRoadmap(testCase.code, roadmap, setup(testCase.code));
    check(`caught: ${testCase.name}`, problems.some((problem) => problem.includes(testCase.expect)), JSON.stringify(problems.slice(0, 3)));
  }
  for (const [id, guide] of Object.entries(GUIDES)) {
    const problems = validateGuide(id, guide, guideContext(guide));
    check(`guide ${id}: the real guide passes`, problems.length === 0, problems.slice(0, 3).join("; "));
  }
  check("the real list of guides passes", validateGuideIndex(GUIDE_INDEX, GUIDES).length === 0, validateGuideIndex(GUIDE_INDEX, GUIDES).join("; "));
  const renamed = structuredClone(GUIDE_INDEX);
  renamed.sections[0].guides[0].title = "Something else";
  check("caught: a guide listed under another title", validateGuideIndex(renamed, GUIDES).some((problem) => problem.includes("has a different title")));
  const twice = structuredClone(GUIDE_INDEX);
  twice.sections.push(structuredClone(twice.sections[0]));
  check("caught: a section listed twice", validateGuideIndex(twice, GUIDES).some((problem) => problem.includes("section is listed twice")));
  const bare = structuredClone(GUIDE_INDEX);
  delete bare.sections[0].summary;
  check("caught: a section with no summary", validateGuideIndex(bare, GUIDES).some((problem) => problem.includes("needs an id, a title, a summary")));
  const ghost = structuredClone(GUIDE_INDEX);
  ghost.sections[0].guides.push({ id: "quiz", kind: "tool", title: "Quiz", summary: "Not built" });
  check("caught: a tool listed that does not exist", validateGuideIndex(ghost, GUIDES).some((problem) => problem.includes("no such tool exists")));
  const kinds = structuredClone(GUIDE_INDEX);
  kinds.sections[0].guides[0].kind = "game";
  check("caught: an unknown kind of entry", validateGuideIndex(kinds, GUIDES).some((problem) => problem.includes("unknown kind game")));
  for (const testCase of GUIDE_CASES) {
    const guide = structuredClone(GUIDES[testCase.guide]);
    testCase.edit(guide);
    const problems = validateGuide(testCase.guide, guide, guideContext(guide));
    check(`caught: ${testCase.name}`, problems.some((problem) => problem.includes(testCase.expect)), JSON.stringify(problems.slice(0, 3)));
  }
}

function testInserts() {
  const us = setup("us").facts;
  const nz = setup("nz").facts;
  const tr = setup("tr").facts;
  const ctx = (facts, extra = {}) => ({ facts, today: TODAY, cycle: 2027, ...extra });
  check("an amount reads with its currency", resolve("money", "us/visa.fee.sevis", ctx(us)) === "USD 350");
  check("a sum of two facts: the SAT with its international fee", resolve("money", "bd/sat.fee+bd/sat.internationalFee", ctx(us)) === "USD 111");
  check("taka at Bangladesh Bank's rate", resolve("taka", "us/visa.fee.sevis", ctx(us)) === takaText(350 * 123.65) && takaText(350 * 123.65) === "৳43,300");
  check("large sums in lakh and crore", takaText(699426) === "৳6.99 lakh" && takaText(11330544) === "৳1.13 crore");
  check("a round lakh reads without .00", takaText(3000000) === "৳30 lakh" && takaText(10000000) === "৳1 crore");
  check("a semester's fee made a year's", resolve("taka", "tr/tuition.metu#Engineering, architecture, and mathematics and science programmes*2", ctx(tr)) === takaText(2400 * 123.65));
  check("a fee keeps its cents below 1,000", moneyText("NZD", 312.36) === "NZD 312.36" && moneyText("NZD", 42236.4) === "NZD 42,236");
  check("a window in days", resolve("window", "bd/hsc.results", ctx(us, { templateYear: 2026 })) === "from 7 to 15 November 2026");
  check("a window known by month", resolve("window", "bd/hsc.results", ctx(us, { templateYear: 2027 })) === "between August and September 2027");
  check("a date with its preposition, a year after the student's HSC", resolve("whenDate", "nz/uni.otago.closing@+1", ctx(nz, { templateYear: 2026 })) === "on\u00A015\u00A0November 2026");
  check("a month only, years ahead", resolve("whenDate", "nz/uni.otago.closing@+1", ctx(nz, { templateYear: 2029 })) === "in November 2029");
  check("the exchange rate says where it comes from", resolve("rate", "NZD", ctx(nz)).includes("worked out through the US dollar") && resolve("rate", "USD", ctx(us)).includes("Bangladesh Bank's rate"));
  check("a year section fills in the student's years", fillText("Plan for March {hscYear+1}, after HSC {hscYear}.", ctx(nz, { templateYear: 2030 })) === "Plan for March 2031, after HSC 2030.");
  check("a sentence citing a fact that is gone is left out, never breaking the page", fillText("Kept. Wait {duration:nz/no.such}. Also {fact:nz/no.such}. Kept too.", ctx(nz)) === "Kept. Kept too.");
  check("a sentence whose date the facts do not hold is left out", fillText("First. Otago closes {whenDate:nz/uni.otago.closing@+1}. Last.", ctx(nz, { templateYear: 2040 })) === "First. Last.");
  // Filling every roadmap, as on the day the facts were last checked, with no brace left over
  for (const code of CODES) {
    const { facts } = setup(code);
    const roadmap = read(`www/data/countries/${code}/roadmap.json`);
    let broken = 0;
    for (const sec of roadmap.sections) {
      for (const block of sec.blocks) {
        const texts = [block.text, ...(block.items ?? []).map((item) => item.text), ...(block.rows ?? []).flat().map((cell) => cell.text)].filter(Boolean);
        for (const text of texts) {
          for (const year of block.template ? [2026, 2030, 2031] : [undefined]) {
            if (/[{}]/.test(fillText(text, ctx(facts, { templateYear: year })))) {
              broken += 1;
            }
          }
        }
      }
    }
    check(`${code}: every text fills in completely`, broken === 0, `${broken} texts`);
  }
}

// Checking that "My list" gathers each university's rows from every table, and nothing else
function testMyList() {
  const gathered = (code, key) => read(`www/data/countries/${code}/roadmap.json`).sections
    .flatMap((sec) => sec.blocks.filter((block) => block.type === "table").flatMap((block) => block.rows.filter((row) => rowKey(row[0]) === key).map((row) => `${sec.number} ${row[0].text}`)));
  for (const code of CODES) {
    const roadmap = read(`www/data/countries/${code}/roadmap.json`);
    const keys = roadmap.sections[2].blocks.filter((block) => block.listable).flatMap((block) => block.rows.map((row) => rowKey(row[0])));
    check(`${code}: every university in Ways to study has its own key`, keys.length > 0 && new Set(keys).size === keys.length);
  }
  check("Victoria's rows join Victoria University of Wellington", gathered("nz", "victoria wellington").length === 5, JSON.stringify(gathered("nz", "victoria wellington")));
  check("Auckland's foundation college stays out of the University of Auckland", !gathered("nz", "auckland").some((row) => row.includes("College")));
  check("UTM's rows join Universiti Teknologi Malaysia", gathered("my", "universiti teknologi").length === 5);
  check("a short name in brackets is the key", rowKey({ text: "Auckland University of Technology (AUT)" }) === "aut" && gathered("nz", "aut").length === 5);
  check("Harvard's rows join across tables", gathered("us", "harvard").length === 2);
}

// Drawing the guides without a screen: every subject, every folded part open, the filter, and "You are
// here" on the timeline
function testGuides() {
  const facts = createFacts({ bd: BD, us: factsDoc("us") });
  const base = { facts, today: TODAY, years: { sit: null, sat: null }, plan: null, checks: new Set(), list: new Set(), tableMarks: [] };
  for (const [id, guide] of Object.entries(GUIDES)) {
    const picker = guide.blocks.find((block) => block.id === "fieldPicker");
    const folds = new Set(guide.blocks.map((block, index) => (block.type === "fold" ? `${id}-${index}` : null)).filter(Boolean));
    const own = guideContext(guide).facts;
    for (const subject of picker ? picker.fields : [null]) {
      const answers = subject ? { [`${id}:field`]: { value: subject.id } } : {};
      const html = sectionBody({ id, blocks: guide.blocks }, { ...base, facts: own, cycle: guide.cycle, answers, folds, stationHere: 1 }, { sections: [] });
      const text = html.replace(/<[^>]+>/g, " ");
      check(`guide ${id}${subject ? `, ${subject.label}` : ""}: draws with no brace or "undefined"`, !/[{}]|undefined|NaN/.test(text) && (!subject || html.includes(`class="guide-field"`)));
      check(`guide ${id}: every folded part opens with its content`, (html.match(/class="guide-fold-body"/g) ?? []).length === folds.size);
    }
  }
  const costs = sectionBody({ id: "costs", blocks: GUIDES.costs.blocks }, { ...base, facts: guideContext(GUIDES.costs).facts, cycle: 2027, answers: {} }, { sections: [] });
  check("the cost guide starts with every part folded", costs.includes("guide-fold-toggle") && !costs.includes("guide-fold-body") && (costs.match(/aria-expanded="false"/g) ?? []).length === GUIDES.costs.blocks.filter((block) => block.type === "fold").length);
  const profile = sectionBody({ id: "profile", blocks: GUIDES.profile.blocks }, { ...base, cycle: 2027, answers: {}, stationHere: 2 }, { sections: [] });
  check("the profile guide asks for a subject before showing one", profile.includes("guide-picker") && !profile.includes(`class="guide-field"`));
  check("the timeline marks the student's class", (profile.match(/guide-stop is-here/g) ?? []).length === 1);
  const olympiads = (value) => sectionBody({ id: "olympiads", blocks: GUIDES.olympiads.blocks }, { ...base, cycle: 2027, answers: { "olympiads:filter": { value } } }, { sections: [] });
  const shown = (html) => (html.match(/<li class="roadmap-row"[^>]*data-key="[^"]*">/g) ?? []).length;
  check("the olympiad filter shows every row for every subject", shown(olympiads("all")) === GUIDES.olympiads.blocks.find((block) => block.type === "table").rows.length);
  check("and only computing olympiads for computing", shown(olympiads("computing")) === 3, String(shown(olympiads("computing"))));
}

// Drawing pages without a screen: bold and escaping, stable tick keys, plan answers, and a whole roadmap
function testRender() {
  const { facts } = setup("nz");
  const ctx = { facts, today: TODAY, cycle: 2027, years: { sit: 2027, sat: 2026 }, plan: null, answers: {}, checks: new Set(), list: new Set(), tableMarks: [] };
  check("bold is drawn and markup is escaped", inline("**Fees** <b>&</b>", ctx) === "<strong>Fees</strong> &lt;b&gt;&amp;&lt;/b&gt;");
  check("a tick's key ignores inserts, bold and punctuation", keyOf("**Passport**, valid for {money:nz/visa.fee}!") === "passport valid for");
  check("an add button's words follow its state", listLabel(true, "Otago") === "Remove from my list: Otago" && listLabel(false, "Otago") === "Add to my list: Otago");
  const plan = { answers: { school: { system: "hsc", year: 2026 }, sat: { status: "no" }, aid: "help" }, result: { route: { id: "lut" }, steps: [{ id: "school.results", done: false, date: { day: TODAY + 30 } }] } };
  const answers = planAnswers([{ id: "a", plan: "aid", options: [["partly", ""]] }, { id: "s", plan: "sat", options: [["no", ""]] }, { id: "r", plan: "results", options: [["hscWaiting", ""]] }, { id: "o", plan: "route", options: [["lut", ""]] }], { ...ctx, plan });
  check("a route finder takes its answers from the plan", JSON.stringify(answers) === JSON.stringify({ a: "partly", s: "no", r: "hscWaiting", o: "lut" }), JSON.stringify(answers));
  for (const code of CODES) {
    const roadmap = read(`www/data/countries/${code}/roadmap.json`);
    const all = new Set(roadmap.sections.map((sec) => sec.id));
    const html = roadmapHtml(roadmap, { ...ctx, facts: setup(code).facts }, { line: "--line-nz", text: "--text-nz" }, all, roadmap.sections[0].id);
    const text = html.replace(/<[^>]+>/g, " ");
    check(`${code}: the whole roadmap draws, every section open, with no brace or "undefined"`, (html.match(/class="roadmap-section-body"/g) ?? []).length === 17 && !/[{}]|undefined|NaN/.test(text));
    const listed = roadmap.sections.some((sec) => sec.blocks.some((block) => block.type === "table" && block.rows.some((row) => row.slice(1).some((cell) => cell.text.includes("; ")))));
    check(`${code}: long table values are split into lines`, html.includes("cell-line") === listed);
    check(`${code}: no typed amount puts its currency last`, !/\b\d[\d,]* (?:EUR|USD|NZD|MYR|TRY)\b/.test(text.replace(/\{[^}]*\}/g, "")) && !/\bRM\d/.test(text));
    const cells = roadmap.sections.flatMap((sec) => sec.blocks.filter((block) => block.type === "table").flatMap((block) => block.rows.flatMap((row) => row.slice(1))));
    check(`${code}: every taka figure in a table sits in brackets after its amount`, !cells.some((cell) => cell.text.includes(", about {taka")), cells.find((cell) => cell.text.includes(", about {taka"))?.text);
    check(`${code}: the taka figures in brackets are set softer`, !html.includes("(about ৳") || html.includes(`<span class="approx">(about ৳`));
  }
  check("an information button stays on the line of the word before it", glue("since 2004.", "[i]") === `since <span class="glue">2004.[i]</span>`);
  check("and stays inside bold text it ends", glue("Do by <strong>13 December</strong>", "[i]") === `Do by <strong>13 <span class="glue">December[i]</span></strong>`);
}

testFiles();
testInserts();
testMyList();
testGuides();
testRender();
console.log(`\n${passed} of ${passed + failed} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
