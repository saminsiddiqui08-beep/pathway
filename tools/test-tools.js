// Checking the Toolkit's tools: the deadline converter against clock changes published by NIST, the New
// Zealand government and the European Commission, the money plan's sums worked out by hand, English
// and grade verdicts against the published rules and tables, and that the tool checks catch each kind
// of mistake. Run with node tools/test-tools.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isoDay, readDay } from "../www/app/dates.js";
import { convert, gapWords, offsetWords } from "../www/features/deadline/convert.js";
import { comparableOf, comparisons, halfBand, oldRangeOf, scoreProblem, verdict } from "../www/features/english/check.js";
import { alevelVerdict, hscVerdict, percentRange, readWith, tariffPoints } from "../www/features/grades/reading.js";
import { gatherItems, monthsOf, priceItems, ratesFor, savingsPlan } from "../www/features/money/budget.js";
import { toolContext, validateDeadline, validateEnglish, validateGrades, validateMoney, validateScholarships, validateVisa, validateWords } from "./validate-tools.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const DEADLINE = read("www/data/tools/deadline.json");
const MONEY = read("www/data/tools/money.json");
const ENGLISH = read("www/data/tools/english.json");
const GRADES = read("www/data/tools/grades.json");
const WORDS = read("www/data/tools/words.json");
const VISA = read("www/data/tools/visa.json");
const SCHOLARSHIPS = read("www/data/scholarships/us.json");
const CONTEXT = toolContext();
const D = readDay;

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

function inDhaka(day, time, zone) {
  const result = convert({ day: D(day), time, zone, home: "Asia/Dhaka" });
  return { ...result, at: `${isoDay(result.here.day)} ${result.here.time}` };
}

function testDeadline() {
  const ny = inDhaka("2026-11-01", "23:59", "America/New_York");
  check("11:59 p.m. in New York on 1 November 2026 is 10:59 a.m. the next day in Dhaka", ny.at === "2026-11-02 10:59" && ny.dayShift === 1, ny.at);
  check("and the clocks going back that night are found", ny.change?.minutes === -60 && isoDay(ny.change.day) === "2026-11-01");
  const nz = inDhaka("2027-01-01", "23:59", "Pacific/Auckland");
  check("11:59 p.m. in Auckland on 1 January 2027 is 4:59 p.m. the same day in Dhaka", nz.at === "2027-01-01 16:59" && nz.dayShift === 0, nz.at);
  check("Auckland is 7 hours ahead of Dhaka in summer", nz.apart === -420);
  const fi = inDhaka("2027-01-21", "15:00", "Europe/Helsinki");
  check("3 p.m. in Helsinki on 21 January 2027 is 7 p.m. in Dhaka", fi.at === "2027-01-21 19:00" && fi.change === null, fi.at);
  const twice = inDhaka("2026-11-01", "01:30", "America/New_York");
  check("a time that happens twice takes the first, the earlier", twice.repeated && twice.at === "2026-11-01 11:30", twice.at);
  const never = inDhaka("2027-03-14", "02:30", "America/New_York");
  check("a time that never happens moves on past the jump", never.skipped && never.at === "2027-03-14 13:30" && never.there.time === "03:30", never.at);
  check("UTC is 6 hours behind Dhaka", inDhaka("2027-01-15", "00:00", "UTC").at === "2027-01-15 06:00");
  check("Türkiye keeps one clock all year", inDhaka("2027-07-01", "12:00", "Europe/Istanbul").apart === 180 && inDhaka("2027-01-01", "12:00", "Europe/Istanbul").apart === 180);

  // Holding the converter to the published clock changes for 2026 to 2028
  const changes = [
    ["America/New_York", "2026-03-08", 60], ["America/New_York", "2026-11-01", -60], ["America/New_York", "2027-03-14", 60], ["America/New_York", "2027-11-07", -60],
    ["America/Los_Angeles", "2028-03-12", 60], ["America/Chicago", "2028-11-05", -60],
    ["Europe/Helsinki", "2026-03-29", 60], ["Europe/Helsinki", "2026-10-25", -60], ["Europe/London", "2027-10-31", -60], ["Europe/Helsinki", "2028-03-26", 60],
    ["Pacific/Auckland", "2026-09-27", 60], ["Pacific/Auckland", "2027-04-04", -60], ["Pacific/Auckland", "2027-09-26", 60], ["Pacific/Auckland", "2028-04-02", -60],
  ];
  for (const [zone, day, minutes] of changes) {
    const found = convert({ day: D(day) + 2, time: "12:00", zone, home: "Asia/Dhaka" }).change;
    check(`${zone} changes its clocks on ${day}`, found && isoDay(found.day) === day && found.minutes === minutes, JSON.stringify(found && { day: isoDay(found.day), minutes: found.minutes }));
  }
  check("Kuala Lumpur has no clock change to report", convert({ day: D("2027-03-14"), time: "12:00", zone: "Asia/Kuala_Lumpur", home: "Asia/Dhaka" }).change === null);
  for (const place of DEADLINE.places.filter((item) => item.zone)) {
    const result = convert({ day: D("2027-07-01"), time: "12:00", zone: place.zone, home: "Asia/Dhaka" });
    check(`${place.name} converts to Dhaka time`, Number.isFinite(result.here.day) && /^[0-2]\d:[0-5]\d$/.test(result.here.time));
  }
  check("a distance from UTC reads as people say it", offsetWords(-300) === "5 hours behind UTC" && offsetWords(330) === "5.5 hours ahead of UTC" && offsetWords(0) === "the same as UTC");
  check("a gap between clocks reads as people say it", gapWords(660) === "11 hours" && gapWords(-30) === "30 minutes" && gapWords(330) === "5 hours 30 minutes");
}

// Making a plan the way the Plan tab hands one over, with the steps the money plan reads
function fakePlan(code, steps, answers) {
  return { code, answers, result: { status: "ok", steps: steps.map(([id, day, extra = {}]) => ({ id, date: { day: D(day) }, latestStart: null, done: false, undated: false, ...extra })) } };
}

function testMoney() {
  const { facts } = CONTEXT;
  const today = D("2026-10-25");
  const plan = fakePlan("us", [
    ["english.test", "2026-11-20", { latestStart: D("2026-11-06") }],
    ["sat.test", "2026-12-05", { latestStart: D("2026-11-20") }],
    ["us.css", "2026-12-15"],
    ["us.apply", "2027-01-01"],
    ["us.sevis", "2027-04-20"],
  ], { english: { status: "none", test: "ielts" }, sat: { status: "none" }, aid: "need" });
  const list = new Set(["mit", "yale", "bowdoin"]);
  const items = gatherItems({ data: MONEY, facts, code: "us", plan, list, saved: { items: {}, own: [] } });
  const byId = Object.fromEntries(items.map((item) => [item.id, item]));
  check("one IELTS sitting is planned, at its fee in taka", byId["test.ielts"].count === 1 && byId["test.ielts"].amount === 31100 && byId["test.ielts"].currency === "BDT");
  check("its fee falls when the test is booked", isoDay(byId["test.ielts"].day) === "2026-11-06");
  check("the SAT fee adds its international fee", byId["test.sat"].amount === 111 && byId["test.sat"].currency === "USD");
  check("no TOEFL is counted for an IELTS plan", byId["test.toefl"].count === 0 && !byId["test.toefl"].counted);
  check("MIT's fee comes from its fact", byId["apply.mit"].amount === 75);
  check("Yale's fee is missing, never guessed", byId["apply.yale"].missing && byId["apply.yale"].amount === null);
  check("universities not on My list are left out", !byId["apply.harvard"]);
  check("Bowdoin's fee counts as waived for a student applying for aid", byId["apply.bowdoin"].waived && byId["apply.bowdoin"].waivedByAid && !byId["apply.bowdoin"].counted);
  const unwaived = gatherItems({ data: MONEY, facts, code: "us", plan, list, saved: { items: { "apply.bowdoin": { waived: false } }, own: [] } }).find((item) => item.id === "apply.bowdoin");
  check("until the student says it is not waived", unwaived.counted && !unwaived.waivedByAid && unwaived.amount === 70);
  const noAid = gatherItems({ data: MONEY, facts, code: "us", plan: { ...plan, answers: { ...plan.answers, aid: "no" } }, list, saved: { items: {}, own: [] } }).find((item) => item.id === "apply.bowdoin");
  check("and a student not applying for aid pays it", noAid.counted && !noAid.waived);
  check("the CSS Profile is counted for the 3 universities on My list", byId["aid.css"].count === 3 && byId["aid.css"].amount === 25 + 16 * 2 && byId["aid.css"].guessed);
  check("an enrolment deposit waits for the student's figure", byId["after.deposit"].missing && !byId["after.deposit"].counted);

  const rates = ratesFor({ facts, mode: "official", live: null, bank: {}, currencies: ["USD"] });
  check("Bangladesh Bank's rate is the default", rates.USD.rate === 123.65 && rates.USD.from === "bank-of-bangladesh");
  const bank = ratesFor({ facts, mode: "bank", live: null, bank: { USD: 125.5 }, currencies: ["USD", "EUR"] });
  check("the student's own bank rate replaces it, and a missing one falls back", bank.USD.rate === 125.5 && bank.EUR.from === "bank-of-bangladesh");
  const live = ratesFor({ facts, mode: "live", live: { on: "2026-10-25", rates: { USD: 123.7 } }, bank: {}, currencies: ["USD"] });
  check("today's rate is used once fetched", live.USD.rate === 123.7 && live.USD.from === "live");

  const priced = priceItems(items, rates);
  const mit = priced.find((item) => item.id === "apply.mit");
  check("a fee in dollars is turned into taka", Math.abs(mit.taka - 75 * 123.65) < 0.001);
  const fallen = priceItems(items, rates, 0.1).find((item) => item.id === "apply.mit");
  check("a weaker taka raises a dollar fee", Math.abs(fallen.taka - 75 * 123.65 * 1.1) < 0.001);
  check("but never a fee charged in taka", priceItems(items, rates, 0.1).find((item) => item.id === "test.ielts").taka === 31100);

  const { months, undated } = monthsOf(priced, today);
  const names = months.map((month) => isoDay(month.start).slice(0, 7));
  check("payments fall into the months of the plan", JSON.stringify(names) === JSON.stringify(["2026-11", "2026-12", "2027-01", "2027-04"]), JSON.stringify(names));
  check("payments the plan cannot date wait at the end", undated.length === 0 || undated.every((item) => item.day === null));
  const november = months[0].due;
  check("November holds IELTS and the SAT", Math.abs(november - (31100 + 111 * 123.65)) < 0.001);
  // Saving from this month, October, so November's payments have two months of saving behind them
  const plan2 = savingsPlan(months, today, 0, 0);
  let due = 0;
  const hardest = Math.max(...months.map((month, index) => {
    due += month.due;
    return due / ([2, 3, 4, 7][index]);
  }));
  check("the monthly saving meets every month on time, starting this month", plan2.needed === Math.ceil(hardest / 100) * 100 && plan2.short !== null, `${plan2.needed} against ${hardest}`);
  const steady = savingsPlan(months, today, 0, plan2.needed);
  check("and saving that much each month never runs short", steady.short === null);
  const enough = savingsPlan(months, today, 10000000, 0);
  check("money already saved can cover everything", enough.needed === 0 && enough.short === null);

  const paid = gatherItems({ data: MONEY, facts, code: "us", plan: fakePlan("us", [["english.test", "2026-11-20", { done: true }]], { english: { status: "booked", test: "ielts" } }), list: new Set(), saved: { items: {}, own: [] } });
  check("a test whose step is done counts as paid", paid.find((item) => item.id === "test.ielts").paid);
  const ticked = gatherItems({ data: MONEY, facts, code: "us", plan, list, saved: { items: { "test.ielts": { paid: true }, "apply.mit": { waived: true } }, own: [] } });
  check("a tick marks a payment paid, and a waiver takes a fee out", ticked.find((item) => item.id === "test.ielts").paid && !ticked.find((item) => item.id === "apply.mit").counted);
  const pair = gatherItems({ data: MONEY, facts, code: "us", plan, list, saved: { items: { "test.duolingo": { count: 3 } }, own: [] } }).find((item) => item.id === "test.duolingo");
  check("three Duolingo tests cost a pair and one more", pair.amount === 118 + 70);
  const my = gatherItems({ data: MONEY, facts, code: "my", plan: null, list: new Set(["monash", "universiti malaya"]), saved: { items: {}, own: [] } });
  check("a typed fee is read from the data, and Universiti Malaya's from its fact", my.find((item) => item.id === "apply.monash").amount === 100 && my.find((item) => item.id === "apply.universiti malaya").amount === 500);
  check("with no plan, nothing is dated", my.every((item) => item.day === null));
  const own = gatherItems({ data: MONEY, facts, code: "fi", plan: null, list: new Set(), saved: { items: {}, own: [{ id: "a", name: "Flight", amount: 85000, currency: "BDT", month: "2027-07" }] } });
  check("a student's own item is counted in its month", own.some((item) => item.id === "own.a" && item.counted && isoDay(item.day) === "2027-07-01"));
  check("Finland's joint application fee is counted once", own.filter((item) => item.id === "apply.joint").length === 1);
}


function rule(code, key) {
  return ENGLISH.rules.find((one) => one.country === code && one.key === key);
}

function score(test, overall, extra = {}) {
  return { test, scale: "new", overall, sections: {}, comparable: null, ...(test === "duolingo" ? { lowest: null } : {}), ...extra };
}

const all = (value) => ({ listening: value, reading: value, writing: value, speaking: value });

function testEnglish() {
  const otago = rule("nz", "otago");
  check("IELTS 6.5 with every band 6.5 meets Otago's rule", verdict(otago, score("ielts", 6.5, { sections: all(6.5) }), ENGLISH).state === "meets");
  const low = verdict(otago, score("ielts", 6, { sections: { ...all(6), writing: 5 } }), ENGLISH);
  check("a writing band of 5.0 falls below Otago's 5.5, and says so", low.state === "below" && low.parts.some((part) => part.words.includes("Writing 5.0")), JSON.stringify(low));
  check("without its bands, an overall score that meets still asks for the bands", verdict(rule("fi", "helsinki"), score("ielts", 7), ENGLISH).state === "needs");
  check("IELTS at METU is not accepted", verdict(rule("tr", "metu"), score("ielts", 7), ENGLISH).state === "no");
  check("a test a rule does not name is a question to ask", verdict(rule("fi", "helsinki"), score("duolingo", 130), ENGLISH).state === "ask");
  const bilkent = rule("tr", "bilkent");
  check("ETS places TOEFL 5 at 95 to 106 on the old scale", JSON.stringify(oldRangeOf(5, ENGLISH.compare.toeflOld.rows)) === "[95,106]");
  check("TOEFL 5 meets Bilkent's old-scale 87, since all of 95 to 106 clears it", verdict(bilkent, score("toefl", 5), ENGLISH).state === "meets");
  check("TOEFL 4.5 matches 86 to 94, and its report shows the middle, 90, which clears Bilkent's 87", verdict(bilkent, score("toefl", 4.5), ENGLISH).state === "meets");
  check("TOEFL 4 matches 72 to 85, and its report shows 78 or 79, below 87", verdict(bilkent, score("toefl", 4), ENGLISH).state === "below");
  const oldRule = (overall) => ({ tests: { toefl: { old: { overall } } } });
  check("TOEFL 4's 78 or 79 meets an old-scale 78", verdict(oldRule(78), score("toefl", 4), ENGLISH).state === "meets");
  const between = verdict(oldRule(79), score("toefl", 4), ENGLISH);
  check("against an old-scale 79, TOEFL 4's 78 or 79 leaves the report to decide", between.state === "ask" && between.parts[0].words.includes("78 or 79"), JSON.stringify(between));
  check("TOEFL 4's 78 or 79 falls below an old-scale 80", verdict(oldRule(80), score("toefl", 4), ENGLISH).state === "below");
  check("the comparable score on the report settles it", verdict(bilkent, score("toefl", 4.5, { comparable: 90 }), ENGLISH).state === "meets");
  check("an old-scale score against a new-scale rule is a question to ask", verdict(rule("fi", "oulu"), score("toefl", 80, { scale: "old" }), ENGLISH).state === "ask");
  check("a writing minimum on the old scale cannot be read from new scores", verdict(rule("tr", "boğaziçi"), score("toefl", 4.5, { sections: all(4) }), ENGLISH).state === "ask");
  check("Duolingo 105 with a lowest subscore of 95 meets Otago's rule", verdict(otago, score("duolingo", 105, { lowest: 95 }), ENGLISH).state === "meets");
  check("a lowest subscore of 90 falls below it", verdict(otago, score("duolingo", 105, { lowest: 90 }), ENGLISH).state === "below");
  check("PTE 50 with every skill at 45 meets Otago's rule", verdict(otago, score("pte", 50, { sections: all(45) }), ENGLISH).state === "meets");
  check("Aalto asks for no test", verdict(rule("fi", "aalto"), score("ielts", 6), ENGLISH).state === "noTest");
  check("Princeton names the test but sets no minimum", verdict(rule("us", "princeton"), score("pte", 60), ENGLISH).state === "open");

  const seven = comparisons(score("ielts", 7), ENGLISH);
  const line = (result, test) => result.lines.find((one) => one.test === test)?.words;
  check("IELTS 7 is C1, and ETS, Pearson and Duolingo place it", seven.level.level === "C1" && line(seven, "TOEFL iBT") === "about 5.0" && line(seven, "TOEFL iBT, old scale") === "about 95 to 106" && line(seven, "PTE Academic") === "about 63 to 70" && line(seven, "Duolingo English Test") === "about 130 to 135", JSON.stringify(seven));
  check("IELTS 6.5 sits on the border of B2 and C1", comparisons(score("ielts", 6.5), ENGLISH).level.border === "C1");
  const three = comparisons(score("toefl", 3), ENGLISH);
  check("TOEFL 3 falls between IELTS 5.0 and 5.5 in ETS's table, and is B1", line(three, "IELTS") === "between 5.0 and 5.5" && three.level.level === "B1", JSON.stringify(three));
  check("an old TOEFL 100 matches 5 on the new scale", line(comparisons(score("toefl", 100, { scale: "old" }), ENGLISH), "TOEFL iBT, new scale") === "about 5.0");
  const pte = comparisons(score("pte", 60), ENGLISH);
  check("PTE 60 is about IELTS 6.5, and B2 or C1 in Pearson's overlapping ranges", line(pte, "IELTS") === "about 6.5" && pte.level.level === "B2 or C1", JSON.stringify(pte));
  check("Duolingo 50 is A1 to A2", comparisons(score("duolingo", 50), ENGLISH).level.level === "A1 to A2");
  check("Duolingo 160 is C2 and IELTS 8.5 to 9.0", line(comparisons(score("duolingo", 160), ENGLISH), "IELTS") === "about 8.5 to 9.0");
  check("a new TOEFL 4.5 shows 90 on the old scale, as ETS says", line(comparisons(score("toefl", 4.5), ENGLISH), "TOEFL iBT, old scale") === "90, on your report");
  check("a new TOEFL 4 shows 78 or 79 on the old scale", line(comparisons(score("toefl", 4), ENGLISH), "TOEFL iBT, old scale") === "78 or 79, on your report");
}

// Checking that scores which cannot be on one report are caught, using the test owners' own rules
// and their worked examples, and that real combinations pass
function testScoreProblems() {
  const facts = CONTEXT.facts;
  const says = (ref, ...parts) => parts.every((part) => JSON.stringify(facts.fact(ref).value).includes(part));
  check("rounding to the nearest half band matches IELTS's and ETS's examples", [[6.25, 6.5], [3.875, 4], [6.125, 6], [6.75, 7], [5.125, 5], [6.625, 6.5]].every(([average, band]) => halfBand(average) === band));
  check("IELTS's own example, 6.5, 6.5, 5.0 and 7.0, gives 6.5 and passes", says("bd/ielts.overall", "6.5, 6.5, 5.0 and 7.0", "6.25") && scoreProblem(score("ielts", 6.5, { sections: { listening: 6.5, reading: 6.5, writing: 5, speaking: 7 } }), ENGLISH) === null);
  const seven = scoreProblem(score("ielts", 7, { sections: { listening: 6, reading: 5.5, writing: 5, speaking: 5.5 } }), ENGLISH);
  check("an overall of 7.0 from bands of 6.0, 5.5, 5.0 and 5.5 cannot be, and 5.5 is offered", seven?.state === "wrong" && seven.lines[0].includes("give 5.5, not 7.0") && seven.lines[1].includes("needs to be higher") && seven.fix?.value === 5.5, JSON.stringify(seven));
  const low = scoreProblem(score("ielts", 5, { sections: all(7) }), ENGLISH);
  check("an overall of 5.0 from four bands of 7.0 asks for a lower band", low?.state === "wrong" && low.lines[1].includes("needs to be lower"), JSON.stringify(low));
  const part = scoreProblem(score("ielts", 9, { sections: { writing: 5 } }), ENGLISH);
  check("with writing 5.0 alone, an overall above 8.0 cannot be, and nothing is offered", part?.state === "wrong" && part.lines[0].includes("at most 8.0") && part.fix === null, JSON.stringify(part));
  check("with writing 5.0 alone, an overall of 8.0 can be", scoreProblem(score("ielts", 8, { sections: { writing: 5 } }), ENGLISH) === null);
  check("ETS's examples hold: 5.125 gives 5 and 5.25 gives 5.5", says("bd/toefl.overall", "5.125 gives 5", "5.25 gives 5.5") && scoreProblem(score("toefl", 5.5, { sections: { listening: 5.5, reading: 5, writing: 5.5, speaking: 5 } }), ENGLISH) === null);
  check("a new TOEFL 5.0 from four sections of 4.0 cannot be", scoreProblem(score("toefl", 5, { sections: all(4) }), ENGLISH)?.state === "wrong");
  const comparable = scoreProblem(score("toefl", 4, { comparable: 110 }), ENGLISH);
  check("a new TOEFL 4.0 with 110 on the old scale cannot be on one report", comparable?.state === "wrong" && comparable.about === "comparable" && comparable.lines[0].includes("72 to 85") && comparable.lines[0].includes("78 or 79") && comparable.fix?.value === null, JSON.stringify(comparable));
  check("a new TOEFL 4.0 with 79 on the old scale can be", scoreProblem(score("toefl", 4, { comparable: 79 }), ENGLISH) === null);
  check("ETS's example: a 4.5 comes with a 90", says("bd/toefl.comparable", "4.5", "90") && JSON.stringify(comparableOf(4.5, ENGLISH.compare.toeflOld.rows)) === "[90,90]");
  const sum = scoreProblem(score("toefl", 110, { scale: "old", sections: { listening: 25, reading: 25, writing: 25, speaking: 20 } }), ENGLISH);
  check("an old TOEFL 110 from sections adding up to 95 cannot be, and 95 is offered", sum?.state === "wrong" && sum.lines[0].includes("add up to 95, not 110") && sum.fix?.value === 95, JSON.stringify(sum));
  check("an old TOEFL 100 with three sections of 30 can be", scoreProblem(score("toefl", 100, { scale: "old", sections: { listening: 30, reading: 30, writing: 30 } }), ENGLISH) === null);
  const pte = scoreProblem(score("pte", 79, { sections: { listening: 60, reading: 65, writing: 70, speaking: 62 } }), ENGLISH);
  check("a PTE overall above all four skills is worth a second look, not ruled out", pte?.state === "check" && pte.lines[0].includes("higher than all four"), JSON.stringify(pte));
  check("a PTE overall among its skills passes", scoreProblem(score("pte", 65, { sections: { listening: 60, reading: 65, writing: 70, speaking: 62 } }), ENGLISH) === null);
  check("a PTE overall with a skill missing is not questioned", scoreProblem(score("pte", 79, { sections: { listening: 60 } }), ENGLISH) === null);
  check("a Duolingo lowest subscore above the overall cannot be", scoreProblem(score("duolingo", 110, { lowest: 120 }), ENGLISH)?.state === "wrong");
  check("a Duolingo lowest subscore of 10 allows an overall of at most 125", scoreProblem(score("duolingo", 130, { lowest: 10 }), ENGLISH)?.lines[0].includes("at most 125") && scoreProblem(score("duolingo", 125, { lowest: 10 }), ENGLISH) === null);
  check("scores with no sections are never questioned", ["ielts", "toefl", "pte", "duolingo"].every((test) => scoreProblem(score(test, test === "ielts" ? 7 : test === "toefl" ? 4 : test === "pte" ? 60 : 110), ENGLISH) === null));
}

function grades(extra = {}) {
  return { gpa: null, counts: {}, board: "cambridge", aCounts: {}, asCounts: {}, ...extra };
}

function gradeRule(key, what) {
  return GRADES.rules.find((one) => one.key === key && one.for === what);
}

function testGrades() {
  const range = percentRange({ "A+": 3, A: 2, "A-": 1 }, GRADES.hsc.bands);
  check("three A+, two A and one A- mean 73% to 88% on average", Math.round(range.low) === 73 && Math.round(range.high) === 88, JSON.stringify(range));
  const [txst, wku] = GRADES.readings;
  const c = readWith(txst, { C: 1 }, GRADES.hsc.bands);
  check("Texas State can read a C, 40 to 49 marks, as B or C", c.points.low === 2 && c.points.high === 3 && JSON.stringify(c.letters[0].letters.sort()) === '["B","C"]', JSON.stringify(c));
  check("Western Kentucky can read a D, 33 to 39 marks, as C or F", JSON.stringify(readWith(wku, { D: 1 }, GRADES.hsc.bands).letters[0].letters.sort()) === '["C","F"]');
  const otago = gradeRule("otago", "Direct entry");
  check("a GPA of 4.83 meets Otago's 4.0", hscVerdict(otago.hsc, grades({ gpa: 4.83 }), GRADES).state === "meets");
  check("a GPA of 3.9 falls below it", hscVerdict(otago.hsc, grades({ gpa: 3.9 }), GRADES).state === "below");
  check("no GPA yet asks for one", hscVerdict(otago.hsc, grades(), GRADES).state === "needs");
  const sabanci = GRADES.rules.find((one) => one.key === "sabancı");
  check("all A+ meets an 80% rule", hscVerdict(sabanci.hsc, grades({ counts: { "A+": 6 } }), GRADES).state === "meets");
  check("all A, 70 to 79, falls below it", hscVerdict(sabanci.hsc, grades({ counts: { A: 6 } }), GRADES).state === "below");
  check("a mix either side of 80% is a question to ask", hscVerdict(sabanci.hsc, grades({ counts: { "A+": 3, A: 3 } }), GRADES).state === "ask");
  const points = tariffPoints({ "A*": 1, A: 1, B: 1 }, { A: 1 }, GRADES.alevel);
  check("A*AB with an AS level at A counts 360 of a possible 420 tariff points", points.counted === 360 && points.total === 420, JSON.stringify(points));
  const metu = GRADES.rules.find((one) => one.key === "metu");
  check("A*AB meets METU's ABB", alevelVerdict(metu.alevel, grades({ aCounts: { "A*": 1, A: 1, B: 1 } }), GRADES).state === "meets");
  check("ACC falls below it", alevelVerdict(metu.alevel, grades({ aCounts: { A: 1, C: 2 } }), GRADES).state === "below");
  check("EEE gives 120 tariff points but falls below Otago's D in three groups", alevelVerdict(otago.alevel, grades({ aCounts: { E: 3 } }), GRADES).state === "below");
  check("DDD meets Otago's tariff rule", alevelVerdict(otago.alevel, grades({ aCounts: { D: 3 } }), GRADES).state === "meets");
  check("Pearson Edexcel at Otago is a question to ask", alevelVerdict(otago.alevel, grades({ board: "edexcel", aCounts: { A: 3 } }), GRADES).state === "ask");
  check("Aalto admits school leavers on the SAT", hscVerdict(GRADES.rules.find((one) => one.key === "aalto").hsc, grades(), GRADES).state === "sat");
}

// Breaking the tools' data in one way per case, with a piece of the problem the checks must report
const MONEY_CASES = [
  { name: "a fee waived for aid applicants with no waiver fact", edit: (d) => { delete d.countries.us.universities.find((item) => item.key === "bowdoin").waiver; }, expect: "waived for aid applicants" },
  { name: "a fee that cites no fact", edit: (d) => { d.countries.us.universities[0].fee = "us/app.fee.nothing"; }, expect: "No fact us/app.fee.nothing" },
  { name: "a university My list cannot hold", edit: (d) => { d.countries.nz.universities[0].key = "nowhere"; }, expect: "is not a university My list can hold" },
  { name: "a typed fee no fact holds", edit: (d) => { d.countries.my.universities[2].typed = "999 MYR"; }, expect: "types 999 MYR" },
  { name: "a plan step that does not exist", edit: (d) => { d.countries.fi.after[0].step = "fi.nothing"; }, expect: "names no plan step fi.nothing" },
  { name: "a long dash", edit: (d) => { d.notIncluded.push("Flights \u2014 later"); }, expect: "contains a long dash" },
];
const DEADLINE_CASES = [
  { name: "a time zone the phone cannot read", edit: (d) => { d.places[1].zone = "America/Nowhere"; }, expect: "cannot read" },
  { name: "a country pointing to no place", edit: (d) => { d.countries.us = "mars"; }, expect: "points to no place mars" },
  { name: "a place listed twice", edit: (d) => { d.places.push({ ...d.places[1] }); }, expect: "listed twice" },
];

const ENGLISH_CASES = [
  { name: "a minimum no fact holds", edit: (d) => { d.rules.find((one) => one.key === "otago").tests.ielts.overall = 6.5; }, expect: "overall 6.5 is in no cited fact" },
  { name: "a refusal no fact states", edit: (d) => { d.rules.find((one) => one.key === "metu").tests.ielts.quote = "IELTS is never accepted."; }, expect: "quotes words no cited fact holds" },
  { name: "a comparison no table gives", edit: (d) => { d.compare.ieltsToefl.rows[4][1] = 4.25; }, expect: "4.25" },
  { name: "a university My list cannot hold", edit: (d) => { d.rules[0].key = "nowhere"; }, expect: "is not a university My list can hold" },
  { name: "an overall rule the test owner does not state", edit: (d) => { d.tests.pte.scoring.kind = "average"; }, expect: "scoring average is not what bd/pte.overall says" },
  { name: "an overall rule Pathway does not know", edit: (d) => { d.tests.ielts.scoring.kind = "median"; }, expect: "scoring needs a kind" },
];
const GRADES_CASES = [
  { name: "a grade band unlike the board's", edit: (d) => { d.hsc.bands[0][1] = 81; }, expect: "band A+" },
  { name: "a GPA minimum no fact holds", edit: (d) => { d.rules.find((one) => one.key === "otago").hsc.gpa = 4.2; }, expect: "gpa 4.2 is in no cited fact" },
  { name: "a reading unlike the university's table", edit: (d) => { d.readings[0].rows[1][0] = 50; }, expect: "Texas State University row 50 to 59" },
  { name: "an exam board Pathway does not know", edit: (d) => { d.rules[0].alevel[0].boards = ["aqa"]; }, expect: "boards must be" },
  { name: "tariff points unlike the table", edit: (d) => { d.alevel.tariff.aLevel.B = 90; }, expect: "B 90" },
];
const WORDS_CASES = [
  { name: "a related word that does not exist", edit: (d) => { d.words[0].related.push("nothing"); }, expect: "related to no word nothing" },
  { name: "a meaning resting on no fact", edit: (d) => { d.words[0].cite = ["us/nothing"]; }, expect: "cites no fact us/nothing" },
  { name: "a word listed twice", edit: (d) => { d.words.push({ ...d.words[0] }); }, expect: "listed twice" },
  { name: "a link to no tool", edit: (d) => { d.words[0].link = "nowhere"; }, expect: "links to no guide or tool" },
];
const VISA_CASES = [
  { name: "a roadmap section that does not exist", edit: (d) => { d.countries.fi.section = "visa"; }, expect: "no roadmap section visa" },
  { name: "a question listed twice", edit: (d) => { d.cards.push({ ...d.cards[0] }); }, expect: "listed twice" },
  { name: "an answer resting on no fact", edit: (d) => { d.countries.nz.cite = ["nz/nothing"]; }, expect: "cites no fact nz/nothing" },
];
const SCHOLARSHIP_CASES = [
  { name: "a university resting on no fact", edit: (d) => { d.universities[0].cite = ["us/nothing"]; }, expect: "cites no fact us/nothing" },
  { name: "a line resting on a fact with no text", edit: (d) => { d.universities[0].cite = ["us/app.fee.mit"]; }, expect: "is not a text fact" },
  { name: "a university listed twice", edit: (d) => { d.universities.push({ ...d.universities[0] }); }, expect: "listed twice" },
  { name: "a group that does not exist", edit: (d) => { d.universities[0].group = "nowhere"; }, expect: "no group nowhere" },
  { name: "a word not in the word list", edit: (d) => { d.words.push("nothing"); }, expect: "no word nothing" },
  { name: "a roadmap section that does not exist", edit: (d) => { d.roadmapSection = "nowhere"; }, expect: "no roadmap section nowhere" },
];

function testChecks() {
  const tools = [
    ["money", MONEY, validateMoney, MONEY_CASES], ["deadline", DEADLINE, validateDeadline, DEADLINE_CASES], ["English", ENGLISH, validateEnglish, ENGLISH_CASES],
    ["grades", GRADES, validateGrades, GRADES_CASES], ["words", WORDS, validateWords, WORDS_CASES], ["visa", VISA, validateVisa, VISA_CASES],
    ["scholarship", SCHOLARSHIPS, validateScholarships, SCHOLARSHIP_CASES],
  ];
  for (const [name, real, validate, cases] of tools) {
    const found = validate(real, CONTEXT);
    check(`the real ${name} data passes`, found.length === 0, found.slice(0, 3).join("; "));
    for (const testCase of cases) {
      const doc = structuredClone(real);
      testCase.edit(doc);
      const problems = validate(doc, CONTEXT);
      check(`caught: ${testCase.name} (${name})`, problems.some((problem) => problem.includes(testCase.expect)), JSON.stringify(problems.slice(0, 3)));
    }
  }
}

testDeadline();
testMoney();
testEnglish();
testScoreProblems();
testGrades();
testChecks();
console.log(`\n${passed} of ${passed + failed} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
