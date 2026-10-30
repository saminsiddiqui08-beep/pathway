// Breaking copies of the real facts in one way at a time and checking the validator catches each one.
// Usage: node tools/test-validator.js
//        node tools/test-validator.js --write-cases DIR   also writes every broken copy, so the
//        Python reference can be run on the same files and its output compared line by line
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { flatName, readRepo, validateFiles } from "./validate-facts.js";

const DATA = fileURLToPath(new URL("../www/data", import.meta.url));
const encoder = new TextEncoder();

function fact(data, id) {
  const found = data.facts.filter((item) => item.id === id);
  if (found.length !== 1) {
    throw new Error(`test setup: fact ${id} found ${found.length} times`);
  }
  return found[0];
}

function entry(data, id, key) {
  const found = fact(data, id).values.filter((item) => item.key === key);
  if (found.length !== 1) {
    throw new Error(`test setup: ${id} [${key}] found ${found.length} times`);
  }
  return found[0];
}

function bytesOf(data) {
  return encoder.encode(`${JSON.stringify(data, null, 2)}\n`);
}

// Breaking one file per case, either through its parsed data (edit) or its raw bytes (raw)
const CASES = [
  { name: "Windows line endings", code: "my", raw: (text) => text.replaceAll("\n", "\r\n"), expect: "facts-my.json: has Windows line endings" },
  { name: "byte order mark", code: "tr", raw: (text) => `\uFEFF${text}`, expect: "facts-tr.json: starts with a byte order mark" },
  { name: "invalid UTF-8", code: "nz", bytes: (bytes) => new Uint8Array([...bytes, 0xff]), expect: "facts-nz.json: is not valid UTF-8" },
  { name: "invalid JSON", code: "fi", raw: (text) => text.replace("{", "{,"), expect: "facts-fi.json: is not valid JSON" },
  { name: "missing top field", code: "my", edit: (d) => { delete d.title; }, expect: "facts-my.json: missing title" },
  { name: "long dash", code: "us", edit: (d) => { fact(d, "visa.fee.application").label += " \u2014 new"; }, expect: "contains a long dash" },
  { name: "short dash", code: "nz", edit: (d) => { fact(d, "visa.fee").note = "6\u201312 weeks"; }, expect: "contains a short dash" },
  { name: "middle dot", code: "tr", edit: (d) => { fact(d, "tb.covers").note = "Tuition \u00b7 stipend"; }, expect: "contains a middle dot" },
  { name: "exclamation mark", code: "fi", edit: (d) => { fact(d, "app.fee").note = "Pay it!"; }, expect: "contains an exclamation mark" },
  { name: "wrong format", code: "my", edit: (d) => { d.format = 2; }, expect: "facts-my.json: format must be 1" },
  { name: "file field mismatch", code: "bd", edit: (d) => { d.file = "countries/bd"; }, expect: "facts-bd.json: file field does not match the file name" },
  { name: "bad checked date", code: "my", edit: (d) => { d.checked = "2026-13-01"; }, expect: "facts-my.json: bad date 2026-13-01" },
  { name: "sources not an object", code: "my", edit: (d) => { d.sources = []; }, expect: "facts-my.json: sources must be an object and facts a list" },
  { name: "unclassified source", code: "my", edit: (d) => { d.sources["new-guide"] = { ...d.sources["emgs-process"] }; fact(d, "pass.val").source = "new-guide"; }, expect: "my/new-guide: source is not classified in SOURCE_OWNER" },
  { name: "source missing a field", code: "tr", edit: (d) => { delete d.sources["metu-dates"].publisher; }, expect: "tr/metu-dates: source is missing publisher" },
  { name: "fact without id", code: "my", edit: (d) => { delete fact(d, "pass.medical").id; }, expect: "facts-my.json: fact number 8 has no id" },
  { name: "id used twice", code: "my", edit: (d) => { fact(d, "pass.val").id = "pass.medical"; }, expect: "my/pass.medical: id used twice" },
  { name: "unknown kind", code: "my", edit: (d) => { fact(d, "pass.val").kind = "paragraph"; }, expect: "my/pass.val: unknown kind paragraph" },
  { name: "empty label", code: "nz", edit: (d) => { fact(d, "visa.fee").label = ""; }, expect: "nz/visa.fee: label is empty" },
  { name: "both value and values", code: "my", edit: (d) => { fact(d, "pass.val").values = []; }, expect: "my/pass.val: needs exactly one of value or values" },
  { name: "empty values", code: "nz", edit: (d) => { fact(d, "app.closing").values = []; }, expect: "nz/app.closing: values must be a list of entries" },
  { name: "unknown keyedBy", code: "nz", edit: (d) => { fact(d, "app.closing").keyedBy = "intake"; }, expect: "nz/app.closing: unknown keyedBy intake" },
  { name: "key used twice", code: "nz", edit: (d) => { entry(d, "app.closing", "2029").key = "2028"; }, expect: "nz/app.closing: key 2028 used twice" },
  { name: "key not fitting keyedBy", code: "nz", edit: (d) => { entry(d, "app.closing", "2030").key = "30"; }, expect: "nz/app.closing: key 30 does not fit keyedBy cycle" },
  { name: "missing entry field", code: "my", edit: (d) => { delete fact(d, "pass.val").where; }, expect: "my/pass.val: missing where" },
  { name: "unknown status", code: "my", edit: (d) => { fact(d, "pass.val").status = "likely"; }, expect: "my/pass.val: unknown status likely" },
  { name: "list as status", code: "my", edit: (d) => { fact(d, "pass.val").status = []; }, expect: "my/pass.val: unknown status" },
  { name: "unknown source", code: "my", edit: (d) => { fact(d, "pass.val").source = "nowhere"; }, expect: "my/pass.val: unknown source nowhere" },
  { name: "confirmed but not official", code: "my", edit: (d) => { fact(d, "pass.processing").status = "confirmed"; fact(d, "pass.processing").source = "prothomalo-agents"; }, expect: "my/pass.processing: confirmed, but its source is not official" },
  { name: "expected without a note", code: "nz", edit: (d) => { entry(d, "app.closing", "2028").note = ""; }, expect: "nz/app.closing [2028]: expected values need a note" },
  { name: "not verified", code: "bd", edit: (d) => { fact(d, "sat.registerLead").verified = null; }, expect: "bd/sat.registerLead: not verified" },
  { name: "verified before checked", code: "my", edit: (d) => { fact(d, "pass.val").verified = "2026-09-01"; }, expect: "my/pass.val: verified before it was checked" },
  { name: "bad verified date", code: "my", edit: (d) => { fact(d, "pass.val").verified = "yesterday"; }, expect: "my/pass.val: bad date yesterday" },
  { name: "institution not named", code: "fi", edit: (d) => { fact(d, "term.helsinki.orientation").label = "Studies begin"; }, expect: "fi/term.helsinki.orientation [2027]: belongs to University of Helsinki, but the label does not name it" },
  { name: "value not an object", code: "my", edit: (d) => { fact(d, "pass.val").value = "text"; }, expect: "my/pass.val: value must be an object" },
  { name: "test key differs from test day", code: "bd", edit: (d) => { entry(d, "sat.administrations", "2027-10-09").value.test = "2027-10-02"; }, expect: "bd/sat.administrations [2027-10-09]: key must equal the test day" },
  { name: "duration without max", code: "my", edit: (d) => { delete fact(d, "pass.processing").value.max; }, expect: "my/pass.processing: duration needs a max" },
  { name: "duration max as text", code: "fi", edit: (d) => { fact(d, "permit.processing").value.max = "90"; }, expect: "fi/permit.processing: duration needs a max" },
  { name: "duration min above max", code: "my", edit: (d) => { fact(d, "pass.processing").value.min = 9; }, expect: "my/pass.processing: min is larger than max" },
  { name: "unknown duration unit", code: "my", edit: (d) => { fact(d, "pass.processing").value.unit = "fortnights"; }, expect: "my/pass.processing: duration needs a known unit" },
  { name: "variants not a list", code: "nz", edit: (d) => { fact(d, "foundation.uoaic.length").value.variants = {}; }, expect: "nz/foundation.uoaic.length: variants must be a list of objects" },
  { name: "variant min above max", code: "nz", edit: (d) => { fact(d, "foundation.uoaic.length").value.variants[1].min = 10; }, expect: "nz/foundation.uoaic.length: min is larger than max" },
  { name: "money without currency", code: "nz", edit: (d) => { delete fact(d, "visa.fee").value.currency; }, expect: "nz/visa.fee: amount needs a currency" },
  { name: "amount true", code: "nz", edit: (d) => { fact(d, "visa.fee").value.amount = true; }, expect: "nz/visa.fee: amount must be a number" },
  { name: "number as text", code: "fi", edit: (d) => { fact(d, "app.sat.minimum").value.number = "1100"; }, expect: "fi/app.sat.minimum: number must be a number" },
  { name: "empty text", code: "my", edit: (d) => { fact(d, "pass.val").value.text = ""; }, expect: "my/pass.val: text is empty" },
  { name: "months repeated", code: "my", edit: (d) => { fact(d, "foundation.mufy.intakes").value.months = [1, 7, 7]; }, expect: "my/foundation.mufy.intakes: months must be distinct numbers from 1 to 12" },
  { name: "months out of range", code: "my", edit: (d) => { fact(d, "foundation.mufy.intakes").value.months = [0, 7]; }, expect: "my/foundation.mufy.intakes: months must be distinct numbers from 1 to 12" },
  { name: "months as a number", code: "my", edit: (d) => { fact(d, "foundation.mufy.intakes").value.months = 7; }, expect: "my/foundation.mufy.intakes: months must be distinct numbers from 1 to 12" },
  { name: "window ends before it starts", code: "tr", edit: (d) => { entry(d, "tb.window", "2026").value.to = "2026-01-01"; }, expect: "tr/tb.window [2026]: window ends before it starts" },
  { name: "window missing to", code: "tr", edit: (d) => { delete entry(d, "tb.window", "2027").value.to; }, expect: "tr/tb.window [2027]: window needs from and to" },
  { name: "date missing", code: "nz", edit: (d) => { delete entry(d, "term.s1.start", "2027").value.date; }, expect: "nz/term.s1.start [2027]: date needs a date" },
  { name: "time without zone", code: "bd", edit: (d) => { delete entry(d, "alevel.cambridge.results", "2026-11").value.zone; }, expect: "bd/alevel.cambridge.results [2026-11]: zone must be one of ZONES" },
  { name: "badly written time", code: "bd", edit: (d) => { entry(d, "alevel.cambridge.results", "2026-11").value.time = "6am"; }, expect: "bd/alevel.cambridge.results [2026-11]: time must be HH:MM" },
  { name: "unknown zone", code: "bd", edit: (d) => { entry(d, "sat.administrations", "2026-11-07").value.zone = "Eastern Time"; }, expect: "bd/sat.administrations [2026-11-07]: zone must be one of ZONES" },
  { name: "impossible date", code: "nz", edit: (d) => { entry(d, "app.closing", "2027").value.date = "2026-02-30"; }, expect: "nz/app.closing [2027]: bad date 2026-02-30" },
  { name: "Bengali digits", code: "nz", edit: (d) => { entry(d, "app.closing", "2027").value.date = "\u09e8\u09e6\u09e8\u09ec-12-08"; }, expect: "nz/app.closing [2027]: bad date" },
  { name: "expected day too far ahead", code: "tr", edit: (d) => { entry(d, "term.metu.classes", "2028").value.date = "2028-09-25"; }, expect: "tr/term.metu.classes [2028]: expected date more than a year ahead must be a month only" },
  { name: "date outside its cycle", code: "fi", edit: (d) => { entry(d, "term.helsinki.orientation", "2027").value.date = "2025-08-30"; }, expect: "fi/term.helsinki.orientation [2027]: date 2025-08-30 is outside cycle 2027" },
  { name: "horizon cut short", code: "tr", edit: (d) => { fact(d, "term.metu.classes").values.pop(); }, expect: "tr/term.metu.classes: stops at cycle 2031; it must reach 2032" },
  { name: "HSC years cut short", code: "bd", edit: (d) => { fact(d, "hsc.exams").values.pop(); }, expect: "bd/hsc.exams: stops at HSC year 2030; it must reach 2031" },
  { name: "A level series cut short", code: "bd", edit: (d) => { fact(d, "alevel.cambridge.results").values.splice(-2); }, expect: "bd/alevel.cambridge.results: stops at series year 2030; it must reach 2031" },
  { name: "academic year behind", code: "bd", edit: (d) => { entry(d, "sat.fee", "2026").key = "2025"; }, expect: "bd/sat.fee: stops at academic year 2025; it must reach 2026" },
  { name: "academic years with a gap", code: "bd", edit: (d) => { fact(d, "sat.fee").values.unshift({ ...entry(d, "sat.fee", "2026"), key: "2024" }); }, expect: "bd/sat.fee: academic years must follow each other with no gaps" },
  { name: "academic year too far ahead", code: "bd", edit: (d) => { entry(d, "sat.fee", "2026").key = "2028"; }, expect: "bd/sat.fee: academic year 2028 is more than a year ahead" },
  { name: "academic year expected", code: "bd", edit: (d) => { entry(d, "sat.fee", "2026").status = "expected"; }, expect: "bd/sat.fee [2026]: a value for an academic year must be published, not expected" },
  { name: "academic year on a number", code: "bd", edit: (d) => { fact(d, "sat.fee").kind = "number"; }, expect: "bd/sat.fee: only money facts can be keyed by academicYear" },
  { name: "source address not https", code: "nz", edit: (d) => { d.sources["uoa-closing"].url = d.sources["uoa-closing"].url.replace("https:", "http:"); }, expect: "nz/uoa-closing: source url must be an https address" },
  { name: "source address missing", code: "nz", edit: (d) => { d.sources["uoa-closing"].url = null; }, expect: "nz/uoa-closing: source url must be an https address" },
  { name: "file checked after its values", code: "my", edit: (d) => { d.checked = "2026-10-15"; }, expect: "facts-my.json: checked 2026-10-15 is later than its oldest value, checked 2026-10-02" },
  { name: "latest observation older than the file", code: "nz", edit: (d) => { entry(d, "visa.processing", "2026-10-21").checked = "2026-10-10"; }, expect: "facts-nz.json: checked 2026-10-21 is later than its oldest value, checked 2026-10-10" },
  { name: "classified source removed", code: "nz", edit: (d) => { delete d.sources["inz-xray"]; }, expect: "nz/inz-xray: listed in the validator, but the file has no such source" },
  { name: "owned fact removed", code: "nz", edit: (d) => { d.facts = d.facts.filter((item) => item.id !== "uni.lincoln.qsRank"); }, expect: "nz/uni.lincoln.qsRank: listed in the validator, but the file has no such fact" },
  { name: "unused source", code: "nz", edit: (d) => { d.facts = d.facts.filter((item) => ![item, ...(item.values ?? [])].some((one) => one.source === "up-overview-2026")); }, expect: "nz/up-overview-2026: source is used by no fact and is not listed as reference only" },
  { name: "missing file", code: "nz", drop: true, expect: "nz/uoa-calendar: listed in the validator, but facts-nz.json is missing" },
];

function cleanFiles() {
  return readRepo(DATA).map((file) => ({ code: file.code, name: flatName(file.code), bytes: file.bytes }));
}

function brokenFiles(testCase) {
  const files = cleanFiles();
  const index = files.findIndex((file) => file.code === testCase.code);
  if (index === -1) {
    throw new Error(`test setup: no file for ${testCase.code}`);
  }
  if (testCase.drop) {
    files.splice(index, 1);
    return files;
  }
  const original = files[index].bytes;
  let bytes;
  if (testCase.edit) {
    const data = JSON.parse(new TextDecoder().decode(original));
    testCase.edit(data);
    bytes = bytesOf(data);
  } else if (testCase.raw) {
    bytes = encoder.encode(testCase.raw(new TextDecoder().decode(original)));
  } else {
    bytes = testCase.bytes(original);
  }
  files[index] = { ...files[index], bytes };
  return files;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function run(writeTo) {
  let failures = 0;
  const clean = validateFiles(cleanFiles(), flatName);
  if (clean.problems.length > 0) {
    failures += 1;
    console.log(`FAIL the real data should pass, but has: ${clean.problems.join("; ")}`);
  } else {
    console.log(`pass the real data passes (${clean.summary})`);
  }

  for (const [number, testCase] of CASES.entries()) {
    const files = brokenFiles(testCase);
    const { problems } = validateFiles(files, flatName);
    const caught = problems.some((problem) => problem.includes(testCase.expect));
    if (!caught) {
      failures += 1;
      console.log(`FAIL ${testCase.name}: expected "${testCase.expect}", got ${JSON.stringify(problems)}`);
    } else {
      console.log(`pass ${testCase.name}`);
    }
    if (writeTo) {
      const folder = join(writeTo, `${String(number + 1).padStart(2, "0")}-${slug(testCase.name)}`);
      mkdirSync(folder, { recursive: true });
      for (const file of files) {
        writeFileSync(join(folder, file.name), file.bytes);
      }
    }
  }

  console.log(`\n${CASES.length + 1 - failures} of ${CASES.length + 1} checks passed`);
  return failures === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
process.exitCode = run(args[0] === "--write-cases" ? args[1] : null);
