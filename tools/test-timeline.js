// Checking the planner in Node: calendar arithmetic, the plan files against the facts, named
// scenarios whose expected dates were worked out by hand from the facts, and a sweep over
// thousands of answer combinations that every plan must survive. Run with node tools/test-timeline.js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  addMonths, addYears, formatDay, formatTime, isoDay, monthsBetween, partsFromDay, readDate, readDay, shift, toDhaka,
} from "../www/app/dates.js";
import { createFacts, FACTS_FORMAT, FactsError, observedEntry } from "../www/app/facts.js";
import { answerProblems, buildPlan, describeRange, intakeOptions, lastIntakeDay, moneyWords } from "../www/features/timeline/engine.js";
import { schoolYears } from "../www/features/timeline/setup.js";
import { lowerFirst } from "../www/features/timeline/words.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));
const COUNTRIES = read("www/data/countries/index.json").countries.map((country) => country.code);
const COMMON = read("www/data/common/plan.json");
const BD = read("www/data/common/bd.json");
const DOCS = Object.fromEntries(COUNTRIES.map((code) => [code, read(`www/data/countries/${code}/facts.json`)]));
const PLANS = Object.fromEntries(COUNTRIES.map((code) => [code, read(`www/data/countries/${code}/plan.json`)]));
// Holding plan text to the writing rules: no long or short dash, middle dot, exclamation mark, arrow or curly quote
const BANNED = /[\u2014\u2013\u00b7!\u2190\u2192\u21d2\u2018\u2019\u201c\u201d]/;

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

function factsFor(code) {
  return createFacts({ bd: BD, [code]: DOCS[code] });
}

const D = readDay;
const BASE = { school: { system: "hsc", year: 2026 }, english: { status: "none" }, sat: { status: "none" }, tier: "balanced", aid: "no", passport: "valid" };
// Planning from the day after the facts were last checked, since an earlier day is a wrong clock
const TODAY = "2026-10-22";

function plan(code, answers, today = TODAY, ticks = {}, overrides = {}) {
  return buildPlan({ common: COMMON, plan: PLANS[code], facts: factsFor(code), answers: { country: code, ...BASE, ...answers }, today: D(today), ticks, overrides });
}

function stepOf(result, id) {
  return result.steps?.find((step) => step.id === id) ?? null;
}

function testDates() {
  // Checking calendar arithmetic across leap years, month ends and year ends
  let roundTrips = true;
  for (let day = D("2026-01-01"); day <= D("2031-12-31"); day += 1) {
    if (D(isoDay(day)) !== day) {
      roundTrips = false;
    }
  }
  check("every day from 2026 to 2031 reads back as itself", roundTrips);
  check("29 February 2028 exists", isoDay(D("2028-02-29")) === "2028-02-29");
  check("29 February 2027 is refused", (() => { try { D("2027-02-29"); return false; } catch { return true; } })());
  check("month 13 is refused", (() => { try { readDate("2027-13"); return false; } catch { return true; } })());
  check("a year after 29 February 2028 is 28 February 2029", isoDay(addYears(D("2028-02-29"), 1)) === "2029-02-28");
  check("a month after 31 January 2027 is 28 February 2027", isoDay(addMonths(D("2027-01-31"), 1)) === "2027-02-28");
  check("31 December plus one day crosses the year", isoDay(shift(D("2026-12-31"), 1, "days")) === "2027-01-01");
  check("2.5 months is 78 days", shift(0, 2.5, "months") === 78);
  check("8 weeks is 56 days", shift(0, 8, "weeks") === 56);
  check("a month-only value covers the whole month", readDate("2028-02").last - readDate("2028-02").first === 28);
  // Comparing working weeks: after Thursday 8 October 2026 Bangladesh's next working day is Sunday,
  // and after Friday 9 October a US office's is Monday
  check("Bangladesh working days skip Friday and Saturday", isoDay(shift(D("2026-10-08"), 1, "workingDays")) === "2026-10-11");
  check("US business days skip Saturday and Sunday", isoDay(shift(D("2026-10-09"), 1, "businessDays")) === "2026-10-12");
  check("three calendar months after 27 September 2027 is 27 December 2027", isoDay(shift(D("2027-09-27"), 3, "calendarMonths")) === "2027-12-27");
  check("and after 30 November it is the last day of February", isoDay(shift(D("2026-11-30"), 3, "calendarMonths")) === "2027-02-28");
  check("working days count backwards too", isoDay(shift(D("2026-10-11"), 1, "workingDays", -1)) === "2026-10-08");
  check("21 working days from Saturday 3 October 2026 end on Sunday 1 November", isoDay(shift(D("2026-10-03"), 21, "workingDays")) === "2026-11-01");

  // Converting to Dhaka time, which is 6 hours ahead of UTC all year, while New York moves between
  // 4 and 5 hours behind
  const summer = toDhaka(D("2026-10-23"), "23:59", "America/New_York");
  check("23:59 in New York in October is 9:59 the next morning in Dhaka", isoDay(summer.day) === "2026-10-24" && summer.time === "09:59");
  const winter = toDhaka(D("2026-12-01"), "23:59", "America/New_York");
  check("23:59 in New York in December is 10:59 the next morning in Dhaka", isoDay(winter.day) === "2026-12-02" && winter.time === "10:59");
  const before = toDhaka(D("2027-03-01"), "17:59", "UTC");
  const after = toDhaka(D("2027-03-01"), "18:00", "UTC");
  check("17:59 UTC is 23:59 the same day in Dhaka", isoDay(before.day) === "2027-03-01" && before.time === "23:59");
  check("18:00 UTC is midnight the next day in Dhaka", isoDay(after.day) === "2027-03-02" && after.time === "00:00");

  // Checking that every zone the validators allow converts offline, so a new zone cannot break the app
  const source = readFileSync(`${ROOT}tools/validate-facts.js`, "utf8");
  const zones = [...source.match(/const ZONES = new Set\(\[(.*?)\]\)/)[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  check("the validator lists seven zones", zones.length === 7, zones.join(", "));
  for (const zone of zones) {
    const noon = toDhaka(D("2027-07-01"), "12:00", zone);
    check(`${zone} converts to Dhaka time`, Number.isFinite(noon.day) && /^[0-2][0-9]:[0-5][0-9]$/.test(noon.time));
  }
  check("Dhaka converts to itself", toDhaka(D("2027-07-01"), "12:00", "Asia/Dhaka").time === "12:00");

  // Formatting times, dates and ranges
  check("times read as people say them", formatTime("09:59") === "9:59\u00A0a.m." && formatTime("00:05") === "12:05\u00A0a.m." && formatTime("12:00") === "12:00\u00A0p.m.");
  check("dates keep day and month together", formatDay(D("2027-01-07")) === "7\u00A0January 2027");
  check("months between counts whole months", monthsBetween(D("2026-10-03"), D("2027-08-30")) === 10 && monthsBetween(D("2027-01-31"), D("2027-02-28")) === 0);
  check("ranges are described honestly", describeRange(D("2026-11-07"), D("2026-11-15"), "day") === "between 7 and 15\u00A0November 2026"
    && describeRange(readDate("2027-08").first, readDate("2027-09").last, "month") === "between August and September 2027");
}

function testFacts() {
  // Reading the facts format and the longest wait observed
  check("facts files are in the format this app reads", [BD, ...Object.values(DOCS)].every((doc) => doc.format === FACTS_FORMAT));
  check("a facts file in another format is refused", (() => { try { createFacts({ bd: { ...BD, format: 2 } }); return false; } catch (error) { return error instanceof FactsError; } })());
  const wait = factsFor("us").fact("us/visa.dhaka.interviewWait");
  check("the longest Dhaka wait seen in the last 12 months is 2.5 months", observedEntry(wait, D(TODAY)).value.max === 2.5);
  check("a stale app still plans for the longest wait it knows", observedEntry(wait, D("2028-01-01")).value.max === 2.5);
}

// Listing the answers, placeholders and stages a plan file may use
const KNOWN_FIELDS = new Set(["country", "cycle", "route", "system", "schoolYear", "schoolSession", "englishStatus", "englishTest", "englishScore", "englishDate", "satStatus", "satDate", "satScore", "aid", "tier", "passport", "ieltsAtLeast", "satScoreAtLeast", "schoolInIntakeYear"]);
const KNOWN_VARS = new Set(["test", "resultDays", "satWhen", "registerBy", "scoreDays", "lastSat", "exam", "year", "when", "score", "date", "until", "money"]);
const PLACEHOLDER = /\{(\w+)(?::([^}]+))?\}/g;
const STAGES = new Set(["prepare", "test", "apply", "results", "permit", "arrive"]);

// Walking every object in a plan file along with its path, for the failure messages
function* walk(node, path = "") {
  if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) {
      yield* walk(value, `${path}[${index}]`);
    }
  } else if (node && typeof node === "object") {
    yield [path, node];
    for (const [key, value] of Object.entries(node)) {
      yield* walk(value, `${path}.${key}`);
    }
  }
}

function testPlanFiles() {
  // Checking each plan file's references against its facts, assumptions and steps
  for (const code of COUNTRIES) {
    const planDoc = PLANS[code];
    const facts = factsFor(code);
    const steps = [...COMMON.steps, ...planDoc.steps];
    const ids = steps.map((step) => step.id);
    const assumptions = { ...COMMON.assumptions, ...planDoc.assumptions };
    check(`${code}: plan file is format 1 and names itself`, planDoc.format === 1 && planDoc.plan === code);
    check(`${code}: step ids are unique`, new Set(ids).size === ids.length);
    for (const [path, node] of walk({ common: COMMON, plan: planDoc })) {
      for (const key of ["fact", "monthOf"]) {
        if (typeof node[key] === "string") {
          check(`${code}: ${path}.${key} names a real fact`, facts.has(node[key]), node[key]);
        }
      }
      if (Array.isArray(node.facts) && node.facts.every((item) => typeof item === "string")) {
        for (const ref of node.facts) {
          if (ref.startsWith("bd/") || ref.startsWith(`${code}/`)) {
            check(`${code}: ${path} lists a real fact`, facts.has(ref), ref);
          }
        }
      }
      if (typeof node.assumption === "string") {
        check(`${code}: ${path} names a real assumption`, Object.hasOwn(assumptions, node.assumption), node.assumption);
      }
      if (node.when && typeof node.when === "object") {
        for (const field of Object.keys(node.when)) {
          check(`${code}: ${path}.when uses a known answer`, KNOWN_FIELDS.has(field), field);
        }
      }
      if (typeof node.step === "string") {
        check(`${code}: ${path} waits for a real step`, ids.includes(node.step), node.step);
      }
    }
    for (const step of steps) {
      check(`${code}: ${step.id} has a known stage`, STAGES.has(step.stage), step.stage);
      for (const dep of step.after ?? []) {
        const id = typeof dep === "string" ? dep : dep.step;
        check(`${code}: ${step.id} waits for a real step`, ids.includes(id), id);
      }
      for (const text of [step.title, step.text, step.warnLate, ...(step.tasks ?? []), ...(step.taskWhen ?? []).map((task) => task.task), ...(step.textWhen ?? []).map((line) => line.text)]) {
        for (const [, name, argument] of (text ?? "").matchAll(PLACEHOLDER)) {
          check(`${code}: ${step.id} uses a known placeholder`, KNOWN_VARS.has(name), name);
          if (name === "money" && (argument.startsWith("bd/") || argument.startsWith(`${code}/`))) {
            check(`${code}: ${step.id} names a real amount`, moneyWords(facts, argument) !== null, argument);
          }
        }
        check(`${code}: ${step.id} text follows the writing rules`, !BANNED.test(text ?? ""), text);
      }
      if (step.ownDate !== undefined) {
        check(`${code}: ${step.id} takes an own date only with a planning date`, step.ownDate === true && Boolean(step.planning));
      }
      const planning = step.planning;
      for (const id of Array.isArray(planning) ? planning.map((item) => item.value) : planning ? [planning] : []) {
        check(`${code}: ${step.id} planning date names a real assumption`, Object.hasOwn(assumptions, id), id);
      }
    }
    const arrive = planDoc.steps.find((step) => step.stage === "arrive" && step.hard);
    check(`${code}: arrival waits for the final school exams`, Boolean(arrive?.after?.includes("school.exams")));
    check(`${code}: cycles come from a real fact`, planDoc.intake === "month" || facts.has(planDoc.cycles));
  }
  // Holding the shaping lines to the same writing rules and placeholders
  for (const text of [...Object.values(COMMON.shaping), ...COUNTRIES.flatMap((code) => Object.values(PLANS[code].shaping ?? {}))]) {
    check("shaping lines follow the writing rules", !BANNED.test(text), text);
    for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
      check("shaping lines use known placeholders", KNOWN_VARS.has(name), name);
    }
  }
  for (const code of COUNTRIES) {
    for (const key of Object.keys(PLANS[code].shaping ?? {})) {
      check(`${code}: its own shaping line replaces a real one`, Object.hasOwn(COMMON.shaping, key), key);
    }
  }
  // Holding every typed amount in a step to a fact the step lists, so a corrected fact cannot leave a
  // stale figure behind; amounts from the facts are written as {money:...} instead
  const AMOUNT = /\b(?:USD|EUR|NZD|MYR|TRY|BDT|GBP|RM) ?[0-9][0-9,.]*/g;
  for (const code of COUNTRIES) {
    const facts = factsFor(code);
    const shown = (ref) => {
      if (!facts.has(ref)) {
        return "";
      }
      const record = facts.fact(ref);
      return JSON.stringify(record.value ?? record.values).replace(/"amount":([0-9]+)/g, (match, amount) => ` ${Number(amount).toLocaleString("en-US")} ${amount} `);
    };
    for (const step of [...COMMON.steps, ...PLANS[code].steps]) {
      const listed = [...(step.facts ?? []), ...(step.factsWhen ?? []).flatMap((group) => group.facts)];
      const texts = [step.title, step.text, ...(step.tasks ?? []), ...(step.taskWhen ?? []).map((task) => task.task), ...(step.textWhen ?? []).map((line) => line.text)];
      for (const text of texts) {
        for (const [amount] of (text ?? "").replace(PLACEHOLDER, "").matchAll(AMOUNT)) {
          const figure = amount.replace(/^[A-Z]+ ?/, "");
          check(`${code}: ${step.id} types ${amount} only where a listed fact holds it`, listed.some((ref) => shown(ref).includes(amount) || (shown(ref).includes(figure) && shown(ref).includes(amount.slice(0, 3)))), amount);
        }
      }
    }
  }
  const finlandRoute = PLANS.fi.routes.find((route) => route.id === "sat");
  check("Finland's SAT minimum in the rules matches the fact", finlandRoute.when.satScoreAtLeast === factsFor("fi").fact("fi/app.sat.minimum").value.number);
}

function testScenarios() {
  // Planning the USA for autumn 2027 with IELTS not taken and a valid passport
  const us = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } });
  check("USA 2027 is reachable", us.status === "ok", us.status);
  check("USA plans the regular round first", us.route?.id === "regular");
  check("USA: applications by 1 January 2027", isoDay(stepOf(us, "us.apply").date.day) === "2027-01-01");
  check("USA: the deadline shows Harvard's time, 11:59 p.m. in Dhaka", stepOf(us, "us.apply").clock?.time === "23:59" && stepOf(us, "us.apply").clock.zone === "Asia/Dhaka" && stepOf(us, "us.apply").clock.closes === true);
  // Taking IELTS by 27 December 2027, since results take up to 5 days and the 2028 regular
  // deadline is read as 1 January 2028
  const us28 = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" } });
  check("USA 2028: IELTS by 27 December 2027", isoDay(stepOf(us28, "english.test")?.date.day) === "2027-12-27", isoDay(stepOf(us28, "english.test")?.date.day));
  check("USA: the fees in a step come from the facts", stepOf(us, "us.sevis").tasks.includes("Pay the SEVIS fee of USD 350") && stepOf(us, "us.sevis").tasks.includes("Pay the visa fee of USD 185"), stepOf(us, "us.sevis").tasks.join("; "));
  check("USA: accepting an offer asks for a deposit only if the university does", stepOf(us, "us.accept").title === "Accept your offer" && stepOf(us, "us.accept").tasks.includes("Pay a deposit if your university asks for one"));
  check("USA: classes assumed to start on 15 August 2027", isoDay(us.start.day) === "2027-08-15");
  check("USA: no SAT steps when the student is not sitting it", !stepOf(us, "sat.test") && !stepOf(us, "sat.prepare"));

  // Comparing eight months left with no IELTS against two years left with IELTS 7.5
  const eight = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } }, "2026-12-05");
  const two = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7.5, taken: "2026-06" } });
  check("eight months left, no IELTS: reachable but marked urgent", eight.status === "ok" && stepOf(eight, "english.test")?.urgency === "urgent");
  check("two years left, IELTS 7.5: no English test, nothing urgent", two.status === "ok" && !stepOf(two, "english.test") && two.steps.every((step) => step.urgency !== "urgent"));

  // Trying the early round with no passport and no smart NID: the passport (21 working days, until
  // 1 November) must come before IELTS, so the result cannot arrive by 1 November 2026
  const early = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, passport: "none", route: "early" });
  check("USA early round without a passport is out of reach, so the regular round is planned", early.route?.id === "regular" && early.routes.find((route) => route.id === "early").reachable === false);
  const earlyOk = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7, taken: "2026-06" }, route: "early" });
  check("USA early round with a score in hand is planned when chosen", earlyOk.route?.id === "early", earlyOk.route?.id);

  // Fitting the SAT into the US regular round: 10 weeks of preparation from 22 October ends on 31 December,
  // after the last usable test (5 December), so the plan is tight but reachable
  const usSat = plan("us", { intake: { cycle: 2027 }, english: { status: "score", test: "ielts", score: 7, taken: "2026-06" } });
  check("USA with SAT preparation is reachable but tight", usSat.status === "ok" && usSat.tight === true);
  check("the tight reason is the SAT preparation", usSat.tightBecause?.step === "sat.prepare", usSat.tightBecause?.step);
  // Showing the last SAT that still counts. In the planned run the first test after 10 weeks of
  // preparation is 6 March 2027, too late, so the route shows 5 December 2026, registration by 20 November
  check("the SAT shown is the last one that still counts: 5 December 2026", isoDay(stepOf(usSat, "sat.test").sat.test) === "2026-12-05" && isoDay(stepOf(usSat, "sat.test").sat.registerBy) === "2026-11-20");
  check("preparation is never shown after its test", stepOf(usSat, "sat.prepare").date.day <= stepOf(usSat, "sat.test").date.day);

  // Closing Finland's SAT route after late registration: the last usable SAT is 5 December 2026, with
  // late registration until 24 November
  const fiOpen = plan("fi", { intake: { cycle: 2027 } }, "2026-11-24");
  check("Finland on 24 November: the SAT route is still reachable", fiOpen.route?.id === "sat", fiOpen.route?.id);
  const fiClosed = plan("fi", { intake: { cycle: 2027 } }, "2026-11-25");
  check("Finland on 25 November: the SAT route has closed, the UAS exam route is planned", fiClosed.route?.id === "uas", fiClosed.route?.id);
  const fiNoSat = plan("fi", { intake: { cycle: 2027 }, sat: { status: "no" } });
  check("Finland without the SAT never plans the SAT route", fiNoSat.route?.id !== "sat" && !fiNoSat.routes.some((route) => route.id === "sat"));
  const fiLow = plan("fi", { intake: { cycle: 2027 }, sat: { status: "score", score: 1050 } });
  check("Finland with an SAT score below 1100 does not plan the SAT route", fiLow.route?.id !== "sat");
  check("Finland 2027: orientation on 30 August 2027", isoDay(fiOpen.start.day) === "2027-08-30");
  check("Finland: the residence permit leaves room for 90 days before arrival", stepOf(fiOpen, "fi.permit") && stepOf(fiOpen, "fi.arrive").date.day >= stepOf(fiOpen, "fi.delhi").date.day + 90);

  // Planning Türkiye for HSC 2026 with no aid needed, on the direct route. Decisions by 15 August 2027
  // plus up to 45 days for the visa reach 29 September, two days after classes begin, so the visa step
  // warns instead of putting the intake out of reach
  const trDirect = plan("tr", { intake: { cycle: 2027 }, sat: { status: "no" } });
  check("Türkiye HSC 2026: direct route", trDirect.route?.id === "direct", `${trDirect.route?.id} ${trDirect.tight}`);
  check("Türkiye: the visa warns that it may come after classes begin", stepOf(trDirect, "tr.visa")?.warning?.startsWith("Your visa may not arrive before classes"));
  check("Türkiye: the visa documents are ready when decisions arrive", ["tr.attest", "tr.medical", "tr.funds"].every((id) => stepOf(trDirect, id)?.date.day <= stepOf(trDirect, "tr.decision").date.day));
  check("Türkiye: state health insurance within 3 months of 27 September 2027", isoDay(stepOf(trDirect, "tr.health")?.date.day) === "2027-12-27", isoDay(stepOf(trDirect, "tr.health")?.date.day));
  check("Türkiye: METU's fee comes from the facts", stepOf(trDirect, "tr.apply").tasks.includes("Pay the USD 55 fee"));
  // Turning to Türkiye Bursları for HSC 2027: results come in August or September, after METU closes
  // on 12 July, and the certificate cannot be attested before decisions arrive
  const trLate = plan("tr", { intake: { cycle: 2027 }, school: { system: "hsc", year: 2027 } });
  check("Türkiye HSC 2027: Türkiye Bursları is planned", trLate.route?.id === "tb", trLate.route?.id);
  check("Türkiye HSC 2027: the direct routes are shown as out of reach", trLate.routes.filter((route) => route.id !== "tb").every((route) => !route.reachable));
  const trAid = plan("tr", { intake: { cycle: 2027 }, aid: "need", sat: { status: "no" } });
  check("Türkiye with aid needed tries Türkiye Bursları first", trAid.route?.id === "tb");
  check("Türkiye Bursları's interviews and results are named by month, without a date", stepOf(trAid, "tr.tbAfter")?.undated && stepOf(trAid, "tr.tbAfter").text.includes("April to June"));
  // Showing the TR-YÖS sitting on the SAT route until its month has passed, never holding the plan up
  const trSat = plan("tr", { intake: { cycle: 2028 }, sat: { status: "none" }, route: "directSat" });
  check("Türkiye: the TR-YÖS sitting is shown on the SAT route", trSat.route?.id === "directSat" && Boolean(stepOf(trSat, "tr.tryos")), trSat.route?.id);
  const trSatLater = plan("tr", { intake: { cycle: 2028 }, sat: { status: "none" }, route: "directSat" }, "2028-05-02");
  check("and is left out once the sitting has passed", trSatLater.status !== "ok" || !stepOf(trSatLater, "tr.tryos"));

  // Planning Malaysia, A levels, March 2027, when Monash's February intake begins classes: the student
  // pass takes up to 8 weeks and applying 4 months before the start (28 October 2026) is still ahead
  const my = plan("my", { intake: { month: "2027-03" }, school: { system: "alevel", year: 2026 }, english: { status: "score", test: "ielts", score: 6.5, taken: "2026-06" } });
  check("Malaysia A levels March 2027: degree route, reachable", my.status === "ok" && my.route?.id === "degree" && !my.tight, `${my.status} ${my.route?.id} ${my.tight}`);
  check("Malaysia: medical screening comes 7 days after arrival", stepOf(my, "my.medical").date.day === stepOf(my, "my.arrive").date.day + 7);
  check("Malaysia: the visa is applied for online", stepOf(my, "my.visa").text.startsWith("Apply online through Malaysia's eVISA system"));
  check("Malaysia: the personal bond comes from the facts", stepOf(my, "my.pass").tasks.includes("Pay the MYR 750 personal bond"));
  const myHsc = intakeOptions({ common: COMMON, plan: PLANS.my, facts: factsFor("my"), answers: { ...BASE, country: "my" }, today: D(TODAY) });
  check("Malaysia HSC: January, July and August lead to a foundation year, February and September straight into a degree", myHsc.length === 4
    && myHsc.every((option) => (option.route === "foundation" ? ["01", "07", "08"] : ["02", "09"]).includes(option.month.slice(5))) && myHsc.some((option) => option.route === "degreeHsc"), JSON.stringify(myHsc));
  const myDirect = plan("my", { intake: { month: "2027-02" } });
  check("Malaysia HSC 2026, February 2027: straight into a degree after the results", myDirect.status === "ok" && myDirect.route?.id === "degreeHsc" && myDirect.deps["my.apply"].includes("school.results"), `${myDirect.status} ${myDirect.route?.id}`);
  // Offering an HSC 2027 student February 2028 first for a degree, because UTM waits for final results
  const my27 = plan("my", { intake: { soonest: true }, school: { system: "hsc", year: 2027 } });
  check("Malaysia HSC 2027, the soonest: a degree from February 2028, or a foundation year that starts sooner", my27.status === "ok" && (my27.month === "2028-02" || my27.route?.id === "foundation"), `${my27.month} ${my27.route?.id}`);
  const myDuo = plan("my", { intake: { month: "2027-07" }, english: { status: "score", test: "duolingo", score: 120, taken: "2026-06" } });
  check("Malaysia does not count a Duolingo score, so IELTS is planned", Boolean(stepOf(myDuo, "english.test")) && myDuo.shaping.find((item) => item.answer === "english").text.startsWith("The Duolingo English Test does not count"));

  // Taking an HSC student straight into a degree in New Zealand, with Otago's closing date, after the results
  const nz = plan("nz", { intake: { cycle: 2027 } });
  check("New Zealand HSC 2026: straight into a degree", nz.status === "ok" && nz.route?.id === "directHsc", `${nz.status} ${nz.route?.id}`);
  check("New Zealand: the application waits for HSC results and uses Otago's closing date", nz.deps["nz.apply"].includes("school.results") && stepOf(nz, "nz.apply").refs.some((item) => item.ref === "nz/uni.otago.closing" && item.key === "2027"));
  check("New Zealand: Otago's date is Pathway's planning date, so it takes the student's own", stepOf(nz, "nz.apply").planning?.id === "otagoDate" && stepOf(nz, "nz.apply").ownable);
  check("New Zealand: arrival a week before AUT's start on 22 February 2027", isoDay(nz.start.day) === "2027-02-22" && isoDay(stepOf(nz, "nz.arrive").date.day) === "2027-02-15");
  check("New Zealand: the visa fee comes from the facts", stepOf(nz, "nz.visa").tasks.includes("Pay the NZD 850 fee"));
  check("New Zealand: the X-ray waits for the offer", nz.deps["nz.xray"].includes("nz.offer"));
  const nzA = plan("nz", { intake: { cycle: 2027 }, school: { system: "alevel", year: 2026 }, aid: "need" });
  check("New Zealand A levels: the direct route with Auckland's date, and no scholarship route", nzA.route?.id === "direct" && !nzA.routes.some((route) => route.id === "scholarship"), nzA.route?.id);
  const nz27 = plan("nz", { intake: { soonest: true }, school: { system: "hsc", year: 2027 } });
  check("New Zealand HSC 2027, the soonest: 2028, since applications wait for the results", nz27.status === "ok" && nz27.cycle === 2028, `${nz27.status} ${nz27.cycle}`);

  // Letting the shortest booking decide reachability: on 17 December 2026, one week to book plus 5 days
  // reaches 29 December, before 1 January; on 21 December it reaches 2 January, too late
  const lateDec = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } }, "2026-12-17");
  check("USA on 17 December: IELTS still fits with a one-week booking, tight", lateDec.status === "ok" && lateDec.cycle === 2027 && lateDec.tight === true, `${lateDec.status} ${lateDec.cycle} ${lateDec.tight}`);
  const tooLate = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } }, "2026-12-21");
  check("USA on 21 December: IELTS can no longer arrive by 1 January", tooLate.status === "outOfReach" || tooLate.cycle !== 2027);

  // Searching New Zealand's soonest intake after HSC 2026 with no passport: 2027 needs the passport
  // (21 working days), the police certificate (30) and the visa, which cannot all fit before February.
  // 2028 fits, and the plan says why 2027 was passed over
  const nzSoon = plan("nz", { intake: { soonest: true }, passport: "none" });
  check("New Zealand HSC, no passport, the soonest I can make: 2028", nzSoon.status === "ok" && nzSoon.cycle === 2028, `${nzSoon.status} ${nzSoon.cycle}`);
  check("and the plan names the step that put 2027 out of reach", nzSoon.skipped?.cycle === 2027 && Boolean(nzSoon.skipped.reason?.title), JSON.stringify(nzSoon.skipped?.reason?.step));
  const nzLate = plan("nz", { intake: { cycle: 2027 }, passport: "none" });
  check("New Zealand 2027 with no passport is out of reach, with the next intake that fits", nzLate.status === "outOfReach" && nzLate.next?.cycle === 2028, `${nzLate.status} ${nzLate.next?.cycle}`);

  // Finding the soonest US intake, which is 2027
  const soon = plan("us", { intake: { soonest: true }, sat: { status: "no" } });
  check("USA, the soonest I can make: 2027", soon.cycle === 2027);

  // Checking a deadline that is today, and the day after it
  const today = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7, taken: "2026-06" } }, "2027-01-01");
  check("a deadline that is today is still reachable", today.status === "ok", today.status);
  check("a deadline that is today is urgent", stepOf(today, "us.apply")?.urgency === "urgent");
  const tomorrow = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7, taken: "2026-06" } }, "2027-01-02");
  check("the day after the deadline, the intake is out of reach or moved", tomorrow.status === "outOfReach" || tomorrow.cycle !== 2027);

  // Booking an English test whose result comes after the deadline
  const booked = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "booked", test: "ielts", date: "2027-01-10" } });
  check("a test booked after the deadline puts the intake out of reach and names the test", booked.status === "outOfReach" && booked.reason?.chain.some((link) => link.id === "english.test"));

  // Reporting a wrong clock and facts that have run out
  check("a phone clock before the facts were checked is reported", plan("us", { intake: { cycle: 2027 } }, "2026-09-30").status === "clockWrong");
  check("facts that have run out are reported", plan("us", { intake: { cycle: 2032 } }, "2032-02-01").status === "factsEnded");

  // Building a plan on 29 February
  const leap = plan("us", { intake: { cycle: 2029 }, sat: { status: "no" } }, "2028-02-29");
  check("a plan builds on 29 February", leap.status === "ok", leap.status);

  // Applying ticks and own dates
  const ticked = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, passport: "none" }, TODAY, { "passport.get": TODAY });
  check("a ticked step is done and counted", stepOf(ticked, "passport.get")?.done === true && ticked.counts.done === 1);
  check("the next open step is never a done one", ticked.current !== "passport.get");
  const own = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } }, TODAY, {}, { deadlines: { "us.apply@regular@2027": "2026-12-15" } });
  check("an own deadline replaces the planning date", isoDay(stepOf(own, "us.apply").date.day) === "2026-12-15" && stepOf(own, "us.apply").ownDeadline);
  const ownStart = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } }, TODAY, {}, { starts: { 2027: "2027-08-25" } });
  check("an own start date replaces 15 August", isoDay(ownStart.start.day) === "2027-08-25");

  // Moving every step that counts from an own application deadline, in its own round only
  const usBase = { intake: { cycle: 2027 }, sat: { status: "no" } };
  const later = plan("us", usBase, TODAY, {}, { deadlines: { "us.apply@regular@2027": "2027-01-15" } });
  const calm = plan("us", usBase, TODAY);
  check("an own deadline moves the application", isoDay(stepOf(later, "us.apply").date.day) === "2027-01-15" && stepOf(later, "us.apply").ownDeadline);
  check("and the essays that count from it", isoDay(stepOf(later, "us.essays").date.day) === "2027-01-15", isoDay(stepOf(later, "us.essays").date.day));
  check("and the list of universities before them", stepOf(later, "us.list").date.day > stepOf(calm, "us.list").date.day);
  const otherRound = plan("us", usBase, TODAY, {}, { deadlines: { "us.apply@early@2027": "2026-11-10" } });
  check("an own date for the early round leaves the regular round alone", isoDay(stepOf(otherRound, "us.apply").date.day) === "2027-01-01" && !stepOf(otherRound, "us.apply").ownDeadline);
  const legacy = plan("us", usBase, TODAY, {}, { deadlines: { "us.apply": "2026-12-15" } });
  check("an own date saved without its round and intake is ignored", isoDay(stepOf(legacy, "us.apply").date.day) === "2027-01-01");
  // Keeping an own date to one intake: it never carries into another intake or the soonest search
  const nextYear = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" } }, TODAY, {}, { deadlines: { "us.apply@regular@2027": "2027-01-15" } });
  check("an own date for 2027 leaves the 2028 intake alone", nextYear.route?.id === "regular" && isoDay(stepOf(nextYear, "us.apply").date.day) === "2028-01-01", `${nextYear.route?.id}`);
  const myOther = plan("my", { intake: { month: "2027-07" }, school: { system: "alevel", year: 2026 }, english: { status: "score", test: "ielts", score: 6.5, taken: "2026-06" } }, TODAY, {}, { deadlines: { "my.apply@degree@2027-03": "2026-10-26" } });
  check("an own date for March leaves July alone", !stepOf(myOther, "my.apply")?.ownDeadline);
  const ownStartOther = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" } }, TODAY, {}, { starts: { 2027: "2027-08-25" } });
  check("an own start date for 2027 leaves 2028 alone", isoDay(ownStartOther.start.day) === "2028-08-15");

  // Listing what each step waits for, so the app can ask about earlier steps still open
  check("the plan says which steps each step waits for", calm.deps["us.apply"].includes("us.essays") && calm.deps["us.essays"].includes("us.list"), JSON.stringify(calm.deps["us.apply"]));

  // Offering own dates only for deadlines that others set
  const listOwn = plan("us", usBase, TODAY, {}, { deadlines: { "us.list@regular@2027": "2026-11-11" } });
  check("an own date on Pathway's advice is ignored", stepOf(listOwn, "us.list").date.day === stepOf(calm, "us.list").date.day && !stepOf(listOwn, "us.list").ownDeadline);
  check("own dates are offered for deadlines that others set", stepOf(calm, "us.apply").ownable && !stepOf(calm, "us.list").ownable);
  const earlyScores = plan("us", { intake: { cycle: 2027 }, route: "early", english: { status: "score", test: "ielts", score: 7, taken: "2026-06" } }, TODAY);
  check("the early round's score date can be the student's own", stepOf(earlyScores, "us.satScores")?.ownable === true, earlyScores.route?.id);
  check("Malaysia's application takes the student's own date", stepOf(my, "my.apply")?.ownable === true);
  const myOwn = plan("my", { intake: { month: "2027-03" }, school: { system: "alevel", year: 2026 }, english: { status: "score", test: "ielts", score: 6.5, taken: "2026-06" } }, TODAY, {}, { deadlines: { "my.apply@degree@2027-03": "2026-10-26" } });
  check("and the student's own date is used when the steps after it allow", isoDay(stepOf(myOwn, "my.apply").date.day) === "2026-10-26" && stepOf(myOwn, "my.apply").ownDeadline);
  const farLater = plan("us", usBase, TODAY, {}, { deadlines: { "us.apply@regular@2027": "2027-03-01" } });
  // Showing a date later than the steps after it allow as the latest date that works, and saying so
  check("an own date later than the steps after it allow keeps the earlier date", farLater.status === "ok" && isoDay(stepOf(farLater, "us.apply").date.day) === "2027-01-29" && isoDay(stepOf(farLater, "us.apply").ownDay) === "2027-03-01");
  const fiOwn = plan("fi", { intake: { cycle: 2027 } }, "2026-11-01", {}, { deadlines: { "fi.apply@sat@2027": "2027-01-05" } });
  check("Finland's SAT round takes an own application date", fiOwn.route?.id === "sat" && isoDay(stepOf(fiOwn, "fi.apply").date.day) === "2027-01-05", fiOwn.route?.id);

  // Keeping damaged answers away from the dates
  check("missing answers are listed", JSON.stringify(plan("us", { tier: undefined, intake: { cycle: 2027 } }).problems) === JSON.stringify(["tier"]));
  check("an IELTS score off the half-band scale is refused", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, english: { status: "score", test: "ielts", score: 7.3, taken: "2026-06" } }, PLANS.us).includes("english"));
  check("a Duolingo score off the 5-point scale is refused", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, english: { status: "score", test: "duolingo", score: 117, taken: "2026-06" } }, PLANS.us).includes("english"));
  check("a Duolingo score on the scale is accepted", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, english: { status: "score", test: "duolingo", score: 115, taken: "2026-06" } }, PLANS.us).length === 0);
  check("an SAT score above 1600 is refused", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, sat: { status: "score", score: 1610 } }, PLANS.us).includes("sat"));
  check("answers for another country are refused", answerProblems({ ...BASE, country: "fi", intake: { cycle: 2027 } }, PLANS.us).includes("country"));
  check("no answers at all are refused", answerProblems(null, PLANS.us).length > 0);

  // Making sure the school line follows the calendar
  const line = (result) => result.shaping.find((item) => item.answer === "school").text;
  check("HSC 2026 on 3 October 2026: exams over, results expected", line(plan("us", { intake: { cycle: 2027 }, sat: { status: "no" } })) === "You sat the HSC in 2026. Your results are expected between 7 and 15\u00A0November 2026.");
  check("HSC 2027 on 3 October 2026: exams still ahead", line(plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, school: { system: "hsc", year: 2027 } })).startsWith("You sit the HSC in 2027."));
  check("HSC 2025: results out", line(plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, school: { system: "hsc", year: 2025 } })) === "You sat the HSC in 2025, and your results are out.");

  // Waiting for a passport before TOEFL and PTE in Bangladesh; IELTS also accepts a smart NID card
  const after = (result, id) => result.steps.find((step) => step.id === id);
  const toeflNid = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, passport: "nid", english: { status: "none", test: "toefl" } });
  check("TOEFL with only an NID card waits for the passport", after(toeflNid, "passport.get") && after(toeflNid, "english.test").date.day >= after(toeflNid, "passport.get").date.day);
  const pteNone = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, passport: "none", english: { status: "none", test: "pte" } });
  check("PTE with no passport waits for the passport", after(pteNone, "english.test").date.day >= after(pteNone, "passport.get").date.day);
  check("PTE shows Pearson's ID rule", after(pteNone, "english.test").facts.includes("bd/pte.id"));
  // Comparing IELTS and TOEFL on 5 December 2026: IELTS booked 14 days ahead with results 5 days later
  // lands on 24 December, in time for 1 January. TOEFL must first wait 21 working days for a passport
  const ieltsNid = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, passport: "nid" }, "2026-12-05");
  check("IELTS with a smart NID card does not wait for the passport", ieltsNid.status === "ok" && ieltsNid.cycle === 2027, ieltsNid.status);
  const toeflLate = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, passport: "nid", english: { status: "none", test: "toefl" } }, "2026-12-05");
  check("TOEFL with only an NID card waits for the passport, so 2027 is out of reach", toeflLate.status === "outOfReach", toeflLate.status);

  // Requiring a held score to be valid when applications close (1 January 2027 for the USA).
  // Taken in December 2024, it expires at the start of December 2026, so a new test is planned
  const old = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7, taken: "2024-12" } });
  check("an IELTS score from December 2024 is too old for 1 January 2027, so a new test is planned", after(old, "english.test") !== undefined);
  check("and the plan says why", old.shaping.find((item) => item.answer === "english").text.startsWith("Your score of 7 in IELTS expires around December 2026"));
  const fresh = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 7, taken: "2025-06" } });
  check("a score from June 2025 is still valid, so no test is planned", after(fresh, "english.test") === undefined);
  check("and the plan says until when", fresh.shaping.find((item) => item.answer === "english").text.includes("valid until about June 2027"));
  check("a held score without its month is asked again", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, english: { status: "score", test: "ielts", score: 7 } }, PLANS.us, D(TODAY)).includes("english"));
  check("a month in the future is refused", answerProblems({ ...BASE, country: "us", intake: { cycle: 2027 }, english: { status: "score", test: "ielts", score: 7, taken: "2026-11" } }, PLANS.us, D(TODAY)).includes("english"));

  // Reading the English line for every test, including "the Duolingo English Test"
  for (const test of ["ielts", "toefl", "duolingo", "pte"]) {
    const score = { ielts: 7, toefl: 5, duolingo: 120, pte: 65 }[test];
    for (const english of [{ status: "none", test }, { status: "booked", test, date: "2026-11-20" }, { status: "score", test, score, taken: "2025-06" }, { status: "score", test, score, taken: "2024-12" }]) {
      const text = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english }).shaping.find((item) => item.answer === "english").text;
      check(`the English line reads naturally: ${test}, ${english.status}${english.taken ? ` from ${english.taken}` : ""}`, text.length > 0 && !/\ba (?:the|IELTS)\b|\bYour the\b|Test test|the the/.test(text), text);
    }
  }
  check("the Duolingo score line in full", plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "duolingo", score: 120, taken: "2025-06" } }).shaping.find((item) => item.answer === "english").text === "You have a score of 120 in the Duolingo English Test, valid until about June 2027. So no English test is planned.");

  // Treating a booking whose day has passed as sat, so the line asks for the score instead
  const englishLine = (english, today) => plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english }, today).shaping.find((item) => item.answer === "english").text;
  check("a booking still ahead reads as booked", englishLine({ status: "booked", test: "ielts", date: "2026-11-20" }, TODAY).startsWith("You have booked IELTS for 20"));
  check("a booking whose day has passed reads as sat", englishLine({ status: "booked", test: "ielts", date: "2026-11-20" }, "2026-11-21").startsWith("You sat IELTS on 20"));
  check("but not on the day itself", englishLine({ status: "booked", test: "ielts", date: "2026-11-20" }, "2026-11-20").startsWith("You have booked IELTS"));
  const satLine = plan("fi", { intake: { cycle: 2027 }, sat: { status: "booked", date: "2026-11-07" } }, "2026-11-08").shaping.find((item) => item.answer === "sat").text;
  check("the same for the SAT", satLine.startsWith("You sat the SAT on 7") && satLine.endsWith("Enter your score here when it arrives."), satLine);

  // Keeping a booking on its own day, and letting a test already sat hold nothing back
  const lateBooking = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, english: { status: "booked", test: "ielts", date: "2028-01-03" } });
  check("a booked test keeps its own day even after a planning deadline", isoDay(stepOf(lateBooking, "english.test").date.day) === "2028-01-03");
  const satAlready = plan("us", { intake: { cycle: 2027 }, passport: "none", sat: { status: "no" }, english: { status: "booked", test: "toefl", date: "2026-10-20" } });
  check("a test sat before today with no passport yet still gives a plan", satAlready.status === "ok", satAlready.status);
  check("and the test sat is not urgent", stepOf(satAlready, "english.test").urgency === null, String(stepOf(satAlready, "english.test").urgency));
  const satAlreadySat = plan("fi", { intake: { cycle: 2027 }, sat: { status: "booked", date: "2026-10-03" } }, TODAY);
  check("a booked SAT already sat is not urgent either", satAlreadySat.status !== "ok" || stepOf(satAlreadySat, "sat.test")?.urgency === null, String(stepOf(satAlreadySat, "sat.test")?.urgency));

  // Ordering school results after the exams, so marking the results done asks about the exams
  const examsAhead = plan("tr", { intake: { cycle: 2028 }, school: { system: "hsc", year: 2027 }, sat: { status: "no" }, route: "direct" });
  check("the results wait for the exams", examsAhead.deps["school.results"]?.includes("school.exams"), JSON.stringify(examsAhead.deps["school.results"]));

  // Showing a booked test on its booked day, even when the deadline is known only by month
  const bookedDuo = plan("us", { intake: { cycle: 2028 }, sat: { status: "no" }, english: { status: "booked", test: "duolingo", date: "2027-01-30" } });
  const duoStep = stepOf(bookedDuo, "english.test");
  check("a booked test is shown on its booked day", duoStep && isoDay(duoStep.date.day) === "2027-01-30" && duoStep.date.precision === "day", duoStep && JSON.stringify(duoStep.date));
  check("the Duolingo step lists Duolingo's facts and no IELTS facts", duoStep && duoStep.facts.includes("bd/duolingo.resultTime") && !duoStep.facts.some((ref) => ref.startsWith("bd/ielts")), duoStep?.facts.join(", "));
  const ieltsStep = stepOf(plan("us", { intake: { cycle: 2028 }, sat: { status: "no" } }), "english.test");
  check("the IELTS step still lists IELTS's facts", ieltsStep.facts.includes("bd/ielts.bd.resultTime") && ieltsStep.facts.includes("bd/ielts.bd.id"));

  // Keeping the title of every done step, including "Take the SAT" whose date is no longer worked out
  const satPlan = plan("us", { intake: { cycle: 2028 } });
  const allTicked = plan("us", { intake: { cycle: 2028 } }, TODAY, Object.fromEntries(satPlan.steps.map((step) => [step.id, TODAY])));
  check("every step done: no step loses its title", allTicked.steps.every((step) => step.title && !/\{/.test(step.title)), allTicked.steps.filter((step) => !step.title).map((step) => step.id).join(", "));
  check("a done SAT step reads \"Take the SAT\"", stepOf(allTicked, "sat.test")?.title === "Take the SAT", stepOf(allTicked, "sat.test")?.title);

  // Listing every answer for an intake out of reach, so the one that matters can be changed
  const reach = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "booked", test: "ielts", date: "2027-01-30" } });
  check("an out-of-reach result lists the answers", reach.status === "outOfReach" && reach.shaping?.some((item) => item.answer === "english") && reach.shaping.some((item) => item.answer === "tier"), reach.status);
  const missingFacts = plan("us", { intake: { cycle: 2033 } });
  check("a result with no plan still lists its answers when it has any", missingFacts.status !== "outOfReach" || Array.isArray(missingFacts.shaping));

  // Naming a test booked before the passport it needs as a booking problem, not an intake problem:
  // PTE needs a passport, which arrives up to 21 working days after 22 October, after the 30 October test
  const clash = plan("fi", { intake: { cycle: 2030 }, school: { system: "hsc", year: 2028 }, sat: { status: "no" }, passport: "applied", english: { status: "booked", test: "pte", date: "2026-10-30" } });
  check("a test booked before the passport arrives is named as the problem", clash.status === "outOfReach" && clash.reason?.booked === "english" && clash.reason.bookedTest === "pte" && isoDay(clash.reason.due) === "2026-10-30", `${clash.status} ${clash.reason?.booked}`);
  check("and no later intake is offered, because the booking must move", clash.next === null);
  const noClash = plan("fi", { intake: { cycle: 2030 }, school: { system: "hsc", year: 2028 }, sat: { status: "no" }, passport: "valid", english: { status: "booked", test: "pte", date: "2026-10-30" } });
  check("the same booking with a valid passport plans normally", noClash.status === "ok", noClash.status);
  const ieltsNidBooked = plan("fi", { intake: { cycle: 2030 }, school: { system: "hsc", year: 2028 }, sat: { status: "no" }, passport: "nid", english: { status: "booked", test: "ielts", date: "2026-10-30" } });
  check("IELTS booked with a smart NID card does not wait for the passport", ieltsNidBooked.status === "ok", ieltsNidBooked.status);

  // Keeping a month's capital inside a sentence; seasons and step titles lose theirs
  check("a month keeps its capital: \"Show my March 2029 plan\"", lowerFirst("March 2029") === "March 2029");
  check("a season loses its capital: \"autumn 2028\"", lowerFirst("Autumn 2028") === "autumn 2028" && lowerFirst("Take IELTS") === "take IELTS" && lowerFirst("IELTS") === "IELTS");

  // Planning how many applications to make, with each country's own advice
  const advice = (code, answers) => plan(code, answers).shaping.find((item) => item.answer === "tier").text;
  check("USA, very competitive: 12 to 20 applications", advice("us", { intake: { cycle: 2028 }, sat: { status: "no" }, tier: "reach" }).includes("12 to 20 applications"));
  check("Finland: all six programmes", advice("fi", { intake: { cycle: 2028 } }).includes("up to six programmes"));
  check("New Zealand: 3 to 5 universities", advice("nz", { intake: { cycle: 2029 } }).includes("3 to 5"));

  // Making sure the same answers always give the same plan
  check("a plan for next year's intake is not described as mostly expected", us.mostlyExpected === false);
  check("planning is deterministic", JSON.stringify(plan("fi", { intake: { cycle: 2028 } })) === JSON.stringify(plan("fi", { intake: { cycle: 2028 } })));
}

function testImprovements() {
  // Leaving out the English test where the student's universities need none, only where Pathway offers that
  const waived = plan("us", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "waived" } });
  check("USA, no English test needed: none is planned", waived.status === "ok" && !stepOf(waived, "english.test") && !stepOf(waived, "english.prepare"));
  check("and the plan says so", waived.shaping.find((item) => item.answer === "english").text.startsWith("You said your universities need no English test, so none is planned"));
  const waivedTr = plan("tr", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "waived" } });
  check("Türkiye, the same answer: a test is still planned, and the plan says why", Boolean(stepOf(waivedTr, "english.test")) && waivedTr.shaping.find((item) => item.answer === "english").text.includes("universities here ask for one"));
  const waivedFi = plan("fi", { intake: { cycle: 2028 }, english: { status: "waived" } });
  check("Finland, no English test needed: only the SAT route is open", waivedFi.route?.id === "sat" && waivedFi.routes.every((route) => route.id === "sat"), JSON.stringify(waivedFi.routes));
  check("and the attachments ask for no English result", !stepOf(waivedFi, "fi.attachments").tasks.includes("Upload your English test result"));
  check("the English result is asked for when a test is planned", stepOf(plan("fi", { intake: { cycle: 2028 } }), "fi.attachments").tasks.includes("Upload your English test result"));

  // Listing Türkiye's arrival after the decision it waits for, even when both are known only by month
  const trTight = plan("tr", { intake: { cycle: 2028 }, school: { system: "hsc", year: 2027 }, route: "direct" });
  const order = trTight.steps?.map((step) => step.id) ?? [];
  check("Türkiye 2028, direct: arrival is listed after the decision, and the plan is tight because of it", trTight.tight && trTight.tightBecause?.step === "tr.decision" && order.indexOf("tr.decision") < order.indexOf("tr.arrive"), JSON.stringify({ tight: trTight.tight, because: trTight.tightBecause, order }));
  check("and the note says the decision may come after it is needed, by its month", trTight.tightBecause.comes === "month" && trTight.tightBecause.earliest > trTight.tightBecause.due);
  const usEarly = plan("us", { intake: { cycle: 2027 }, school: { system: "hsc", year: 2028 }, sat: { status: "no" } });
  check("an intake before the exams end names the exams, which end after they are needed", usEarly.status === "outOfReach" && usEarly.reason?.step === "school.exams" && usEarly.reason.comes !== null && usEarly.reason.earliest > usEarly.reason.due, JSON.stringify(usEarly.reason));

  // Following Finland's rules: no Duolingo for universities of applied sciences, LUT's rolling admission
  const duoFi = plan("fi", { intake: { cycle: 2028 }, sat: { status: "no" }, english: { status: "score", test: "duolingo", score: 120, taken: "2026-06" } });
  check("Finland with a Duolingo score: the UAS exam route is not open", !duoFi.routes.some((route) => route.id === "uas"), JSON.stringify(duoFi.routes));
  const lut = plan("fi", { intake: { cycle: 2028 }, sat: { status: "no" }, route: "lut" });
  check("Finland: LUT's rolling admission can be planned", lut.status === "ok" && lut.route?.id === "lut", `${lut.status} ${lut.route?.id}`);
  check("LUT: the result comes a month after applying, with no joint application attachments", !stepOf(lut, "fi.attachments") && stepOf(lut, "fi.results").date.day >= stepOf(lut, "fi.apply").date.day + 31);
  check("LUT: applications open with LUT's window", isoDay(stepOf(lut, "fi.apply").opens.day) === "2027-09-01", isoDay(stepOf(lut, "fi.apply").opens?.day));
  check("Finland: no certificate route, which was not open to Bangladeshi students", !PLANS.fi.routes.some((route) => route.id === "certificate"));
  const uas = plan("fi", { intake: { cycle: 2027 }, sat: { status: "no" }, english: { status: "score", test: "ielts", score: 6.5, taken: "2026-06" } });
  check("Finland: the UAS exam shows its time, noon in Finland", uas.route?.id === "uas" && stepOf(uas, "fi.uasExam").clock?.time === "12:00" && stepOf(uas, "fi.uasExam").clock.closes === false, uas.route?.id);
  check("Finland: the permit fee and the service fee come from the facts", stepOf(uas, "fi.permitApply").tasks.includes("Pay the EUR 600 fee") && stepOf(uas, "fi.delhi").tasks.includes("Pay the EUR 20 service fee"));
  check("Finland: the permit money comes from the facts", stepOf(uas, "fi.funds").text.startsWith("EUR 9,600 for living costs"));
  // Waiting for the final certificate only when the student is still at school in the intake year
  check("Finland HSC 2026: no final certificate step, since school is finished", !stepOf(uas, "fi.finalDocuments"));
  const fiLate = plan("fi", { intake: { cycle: 2027 }, school: { system: "hsc", year: 2027 } });
  check("Finland HSC 2027 for 2027: out of reach because of the final certificate", fiLate.status === "outOfReach" && fiLate.reason?.step === "fi.finalDocuments" && isoDay(fiLate.reason.due) === "2027-08-10" && fiLate.next?.cycle === 2028, `${fiLate.status} ${fiLate.reason?.step}`);
  check("and the earliest date named is when the results may come, never before the deadline", fiLate.reason.earliest > fiLate.reason.due);
  const fiSoon = plan("fi", { intake: { soonest: true }, school: { system: "hsc", year: 2027 } });
  check("Finland HSC 2027, the soonest: 2028, with the reason 2027 was passed over", fiSoon.cycle === 2028 && fiSoon.skipped?.cycle === 2027 && fiSoon.skipped.reason?.step === "fi.finalDocuments");
  const fiAlevel = plan("fi", { intake: { soonest: true }, school: { system: "alevel", year: 2027 } });
  check("Finland A levels 2027: results in August also come after 10 August", fiAlevel.cycle === 2028, String(fiAlevel.cycle));

  // Measuring the own-date limit from the last intake in the facts
  check("the last US intake in the facts starts on 15 August 2032", isoDay(lastIntakeDay({ common: COMMON, plan: PLANS.us, facts: factsFor("us") })) === "2032-08-15");
  check("the last New Zealand intake in the facts starts in February 2032", isoDay(lastIntakeDay({ common: COMMON, plan: PLANS.nz, facts: factsFor("nz") })).startsWith("2032-02"));
  check("Malaysia's own dates reach the end of the year after the last HSC in the facts", isoDay(lastIntakeDay({ common: COMMON, plan: PLANS.my, facts: factsFor("my") })) === "2032-12-31");
}

// Planning for class 9 and 10 students, whose plans reach years ahead
function testClassNine() {
  for (const code of COUNTRIES) {
    for (const year of [2030, 2031]) {
      const school = { system: "hsc", year };
      const facts = factsFor(code);
      const options = intakeOptions({ common: COMMON, plan: PLANS[code], facts, answers: { ...BASE, country: code, school }, today: D(TODAY) });
      const first = options[0];
      const firstYear = first ? first.cycle ?? Number(first.month.slice(0, 4)) : null;
      check(`${code} HSC ${year}: intakes are offered, none before the exams end`, options.length > 0 && firstYear >= year, JSON.stringify(options.map((option) => option.cycle ?? option.month)));
      for (const intake of [{ soonest: true }, first?.month ? { month: first.month } : { cycle: first?.cycle }]) {
        const result = plan(code, { intake, school });
        const label = `${code} HSC ${year}, ${intake.soonest ? "the soonest" : "the first intake offered"}`;
        if (intake.soonest) {
          check(`${label}: a plan is made`, result.status === "ok", result.status);
        } else {
          check(`${label}: a plan, or the next intake that fits`, result.status === "ok" || (result.status === "outOfReach" && Boolean(result.next)), result.status);
        }
        const body = result.status === "ok" ? result : result.plan;
        if (!body) {
          continue;
        }
        check(`${label}: no urgency for steps more than a year away`, body.steps.every((step) => step.undated || step.date.day - D(TODAY) <= 365 || step.urgency === null));
        if (result.status === "ok") {
          check(`${label}: the plan says its dates are expected`, result.mostlyExpected === true);
        }
      }
    }
  }
  // Naming school years by class in both halves of the year: after the HSC exams end, and from January
  const notes = (today, firstHscYear) => schoolYears("hsc", { today: D(today), firstHscYear }).map((item) => `${item.year} ${item.note}`).join(", ");
  check("on 22 October 2026, class 9 sits the HSC in 2030", notes("2026-10-22", 2027) === "2026 Exams finished, 2027 Class 12 now, 2028 Class 11 now, 2029 Class 10 now, 2030 Class 9 now", notes("2026-10-22", 2027));
  check("in March 2027, class 10 sits the HSC in 2030 and class 9 in 2031", notes("2027-03-15", 2027) === "2026 Exams finished, 2027 Class 12 now, 2028 Class 11 now, 2029 SSC this year, 2030 Class 10 now, 2031 Class 9 now", notes("2027-03-15", 2027));
  check("on the day after the 2027 exams end, the year moves on", notes("2027-07-14", 2028) === "2027 Exams finished, 2028 Class 12 now, 2029 Class 11 now, 2030 Class 10 now, 2031 Class 9 now", notes("2027-07-14", 2028));
}

// Returning the first rule a result breaks, or null when it keeps them all
function invariants(label, result, todayDay) {
  const statuses = new Set(["ok", "outOfReach", "clockWrong", "factsEnded", "needsAnswers"]);
  if (!statuses.has(result.status)) {
    return `unknown status ${result.status}`;
  }
  const body = result.status === "ok" ? result : result.plan;
  if (result.status === "outOfReach" && !result.reason && !result.missing) {
    return "out of reach without a reason";
  }
  if (!body) {
    return null;
  }
  const text = JSON.stringify(body);
  if (/\{\w+\}|undefined|NaN|Infinity|null null/.test(text.replace(/"(first|last|day|earliest|latestStart|spare|due|satFirst|satLast|doneOn|testBy|earliestTest|last)":null/g, ""))) {
    return "a placeholder, undefined, NaN or Infinity leaked into the plan";
  }
  // Allowing a step shown by its month alone to follow, within that month, the step it waits for
  let previous = null;
  const sameMonth = (a, b) => partsFromDay(a.date.day).year === partsFromDay(b.date.day).year && partsFromDay(a.date.day).month === partsFromDay(b.date.day).month;
  for (const step of body.steps) {
    if (!step.title || /\{/.test(step.title)) {
      return `step ${step.id} has no proper title`;
    }
    if (step.undated) {
      continue;
    }
    if (!step.date || !Number.isFinite(step.date.day)) {
      return `step ${step.id} has no date`;
    }
    if (previous && step.date.day < previous.date.day && !(sameMonth(step, previous) && (step.date.precision === "month" || previous.date.precision === "month"))) {
      return `step ${step.id} is out of date order`;
    }
    if (!previous || step.date.day >= previous.date.day) {
      previous = step;
    }
    if (step.done && step.urgency) {
      return `done step ${step.id} is marked urgent`;
    }
    if (step.urgency && step.date.day - todayDay > 365) {
      return `step ${step.id}, more than a year away, is marked urgent`;
    }
    if (/[{}]/.test(`${step.text ?? ""} ${step.tasks.join(" ")} ${step.warning ?? ""}`)) {
      return `step ${step.id} shows a placeholder`;
    }
  }
  if (result.status === "ok") {
    if (body.current && body.steps.find((step) => step.id === body.current)?.done) {
      return "the next step is a done one";
    }
    if (!Number.isFinite(result.start.day) || result.start.day < todayDay - 400) {
      return "the start date is missing or long past";
    }
    if (result.tight && !result.tightBecause) {
      return "tight without a reason";
    }
  }
  return null;
}

function testSweep() {
  // Sweeping every answer combination for each country on one day
  let runs = 0;
  let bad = 0;
  const today = TODAY;
  const englishChoices = [
    { status: "none" }, { status: "none", test: "duolingo" },
    { status: "booked", test: "ielts", date: "2026-11-14" }, { status: "booked", test: "toefl", date: "2027-03-20" },
    { status: "score", test: "ielts", score: 6, taken: "2026-06" }, { status: "score", test: "pte", score: 65, taken: "2026-06" },
    { status: "score", test: "duolingo", score: 120, taken: "2026-06" }, { status: "waived" },
  ];
  const satChoices = [{ status: "no" }, { status: "none" }, { status: "booked", date: "2026-12-05" }, { status: "score", score: 1250 }];
  const schools = [
    { system: "hsc", year: 2026 }, { system: "hsc", year: 2027 }, { system: "hsc", year: 2028 }, { system: "hsc", year: 2029 },
    { system: "hsc", year: 2030 }, { system: "hsc", year: 2031 }, { system: "hsc", year: 2025 },
    { system: "alevel", year: 2026 }, { system: "alevel", year: 2027, session: "winter" }, { system: "alevel", year: 2028 },
    { system: "alevel", year: 2031 },
  ];
  for (const code of COUNTRIES) {
    const facts = factsFor(code);
    for (const school of schools) {
      const options = intakeOptions({ common: COMMON, plan: PLANS[code], facts, answers: { ...BASE, country: code, school }, today: D(today) });
      const intakes = [{ soonest: true }, ...options.map((option) => (option.month ? { month: option.month } : { cycle: option.cycle }))];
      for (const intake of intakes) {
        for (const english of englishChoices) {
          for (const sat of PLANS[code].asksSat ? satChoices : [{ status: "no" }]) {
            for (const passport of ["valid", "applied", "nid", "none"]) {
              for (const [tier, aid] of [["reach", "need"], ["balanced", "help"], ["safe", "no"]]) {
                runs += 1;
                const answers = { country: code, school, intake, english, sat, passport, tier, aid };
                let result;
                try {
                  result = buildPlan({ common: COMMON, plan: PLANS[code], facts, answers, today: D(today) });
                } catch (error) {
                  bad += 1;
                  if (bad <= 5) {
                    console.log(`FAIL sweep crashed for ${JSON.stringify(answers)}: ${error.stack.split("\n").slice(0, 3).join(" ")}`);
                  }
                  continue;
                }
                const problem = invariants(code, result, D(today));
                if (problem) {
                  bad += 1;
                  if (bad <= 5) {
                    console.log(`FAIL sweep ${problem} for ${JSON.stringify(answers)}`);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  check(`all ${runs} answer combinations plan without breaking an invariant`, bad === 0, `${bad} broken`);

  // Stepping a week at a time through two years, for one student per country, so month and year
  // boundaries are crossed
  let dayRuns = 0;
  let dayBad = 0;
  for (let day = D(TODAY); day <= D("2028-10-22"); day += 7) {
    for (const [code, year] of COUNTRIES.flatMap((item) => [[item, 2027], [item, 2030]])) {
      dayRuns += 1;
      const answers = { ...BASE, country: code, intake: { soonest: true }, school: { system: "hsc", year } };
      try {
        const result = buildPlan({ common: COMMON, plan: PLANS[code], facts: factsFor(code), answers, today: day });
        const problem = invariants(code, result, day);
        if (problem) {
          dayBad += 1;
          if (dayBad <= 3) {
            console.log(`FAIL ${code} on ${isoDay(day)}: ${problem}`);
          }
        }
      } catch (error) {
        dayBad += 1;
        if (dayBad <= 3) {
          console.log(`FAIL ${code} on ${isoDay(day)} crashed: ${error.message}`);
        }
      }
    }
  }
  check(`${dayRuns} plans across two years of weeks keep every invariant`, dayBad === 0, `${dayBad} broken`);
}

testDates();
testFacts();
testPlanFiles();
testScenarios();
testImprovements();
testClassNine();
testSweep();
console.log(`\n${passed} of ${passed + failed} checks passed`);
process.exitCode = failed === 0 ? 0 : 1;
