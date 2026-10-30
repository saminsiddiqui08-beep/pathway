// Comparing an English score with each university's rule, and placing it on the other tests' scales
// with the test owners' own tables. Nothing here touches the screen, so the checks run the same code
// in Node. A verdict comes only from the score the student holds; a comparison is never used for one
export const SECTIONS = ["listening", "reading", "writing", "speaking"];
const SECTION_WORDS = { listening: "Listening", reading: "Reading", writing: "Writing", speaking: "Speaking" };
const STATE_ORDER = ["below", "ask", "needs", "meets"];

// Writing a score the way its test writes it: IELTS and the new TOEFL with one decimal, the rest whole
export function scoreText(value, digits) {
  return value.toFixed(digits);
}

// Finding the scale a TOEFL score is on, and the scale of every other test
export function scaleOf(test, score) {
  return test.scales ? test.scales[score.scale] : test.scale;
}

export function sectionScaleOf(test, score) {
  if (test.lowest) {
    return test.lowest;
  }
  return test.scales ? test.sections[score.scale] : test.sections;
}

// Reading the band on the new TOEFL scale that a total on the old scale matches, from ETS's table
export function bandOfOld(old, rows) {
  return rows.find(([, from]) => old >= from)?.[0] ?? null;
}

// Reading the range of old totals that one new TOEFL band matches, from ETS's table
export function oldRangeOf(band, rows) {
  const index = rows.findIndex(([value]) => value === band);
  if (index < 0) {
    return null;
  }
  const from = rows[index][1];
  const to = index === 0 ? 120 : rows[index - 1][1] - 1;
  return [from, to];
}

// Reading the comparable score a report on the new scale shows: ETS prints the middle of the range the
// band matches on the old scale. ETS lists no number for each band, so where the middle falls between
// two whole numbers, both are kept
export function comparableOf(band, rows) {
  const range = oldRangeOf(band, rows);
  if (!range) {
    return null;
  }
  const middle = (range[0] + range[1]) / 2;
  return [Math.floor(middle), Math.ceil(middle)];
}

function eitherOf([low, high]) {
  return low === high ? String(low) : `${low} or ${high}`;
}

// Checking one minimum: met, missed, or not yet entered
function against(value, minimum) {
  if (value === null || value === undefined) {
    return "needs";
  }
  return value >= minimum ? "meets" : "below";
}

// Checking a rule on the same scale as the score. A rule holds an overall minimum and any of: one
// minimum for every section ("each"), or minimums for named sections
function onScale(rule, score, digits, word) {
  const parts = [];
  if (rule.overall !== undefined) {
    const state = against(score.overall, rule.overall);
    parts.push({ state, words: state === "below" ? `Overall ${scoreText(score.overall, digits)} is below ${scoreText(rule.overall, digits)}` : `Overall at least ${scoreText(rule.overall, digits)}` });
  }
  const sections = score.lowest !== undefined ? null : SECTIONS;
  if (rule.each !== undefined) {
    if (!sections) {
      const state = against(score.lowest, rule.each);
      parts.push({ state, words: state === "below" ? `Your lowest ${word} ${scoreText(score.lowest, digits)} is below ${scoreText(rule.each, digits)}` : state === "needs" ? `Every ${word} at least ${scoreText(rule.each, digits)}: add your lowest ${word}` : `Every ${word} at least ${scoreText(rule.each, digits)}` });
    } else {
      const states = sections.map((name) => [name, against(score.sections?.[name], rule.each)]);
      const low = states.filter(([, state]) => state === "below").map(([name]) => `${SECTION_WORDS[name]} ${scoreText(score.sections[name], digits)}`);
      const state = low.length > 0 ? "below" : states.some(([, one]) => one === "needs") ? "needs" : "meets";
      parts.push({ state, words: state === "below" ? `${low.join(" and ")} below ${scoreText(rule.each, digits)}` : state === "needs" ? `Every ${word} at least ${scoreText(rule.each, digits)}: add your ${word} scores` : `Every ${word} at least ${scoreText(rule.each, digits)}` });
    }
  }
  for (const name of SECTIONS.filter((one) => rule[one] !== undefined)) {
    const value = score.sections?.[name];
    const state = against(value, rule[name]);
    parts.push({ state, words: state === "below" ? `${SECTION_WORDS[name]} ${scoreText(value, digits)} is below ${scoreText(rule[name], digits)}` : state === "needs" ? `${SECTION_WORDS[name]} at least ${scoreText(rule[name], digits)}: add your ${SECTION_WORDS[name].toLowerCase()} score` : `${SECTION_WORDS[name]} at least ${scoreText(rule[name], digits)}` });
  }
  return parts;
}

// Checking a new-scale TOEFL score against a rule written only on the old scale. The comparable total
// on the score report settles the overall minimum. Without it, the report's number is the middle of
// the band's range on the old scale; when that middle falls between two numbers, both must clear the
// minimum to meet it and both must fall short to miss it. Section minimums on the old scale cannot be
// checked from new scores
function newAgainstOld(rule, score, rows) {
  const parts = [];
  if (rule.overall !== undefined) {
    if (typeof score.comparable === "number") {
      const state = against(score.comparable, rule.overall);
      parts.push({ state, words: state === "below" ? `The ${score.comparable} on your report is below ${rule.overall} on the old scale` : `${rule.overall} on the old scale` });
    } else {
      const shown = comparableOf(score.overall, rows);
      const state = shown[0] >= rule.overall ? "meets" : shown[1] < rule.overall ? "below" : "ask";
      parts.push({
        state,
        words: state === "meets" ? `${rule.overall} on the old scale: your report shows ${eitherOf(shown)}`
          : state === "below" ? `The ${eitherOf(shown)} on your report is below ${rule.overall} on the old scale`
            : `${rule.overall} on the old scale: your report shows ${eitherOf(shown)}, so the number on it decides`,
      });
    }
  }
  const named = ["each", ...SECTIONS].filter((name) => rule[name] !== undefined);
  if (named.length > 0) {
    parts.push({ state: "ask", words: "Its section minimums are on the old 0 to 120 scale, so ask how it reads new section scores" });
  }
  return parts;
}

// Rounding an average of four half bands to the nearest half band, a quarter rounding up, the way
// IELTS and ETS round. An average of half bands is always an exact binary fraction, so this never
// drifts
export function halfBand(average) {
  return Math.floor(average * 2 + 0.5) / 2;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Finding how a score's test works out its overall score: from the average of the sections, from
// their sum, or from the whole test
export function scoringOf(test, score) {
  return test.scales ? test.scoring[score.scale] : test.scoring;
}

// Working out the overall scores the entered sections allow, the way the test owner does. A section
// not entered may hold anything on its scale, so the answer is the lowest and the highest overall
// still possible, and it is exact once all four are in. Null when the sections cannot decide it
export function overallRange(score, data) {
  const test = data.tests[score.test];
  const kind = scoringOf(test, score).kind;
  if (kind !== "average" && kind !== "sum") {
    return null;
  }
  const scale = sectionScaleOf(test, score);
  const known = SECTIONS.map((name) => score.sections?.[name]).filter(isNumber);
  const total = known.reduce((sum, value) => sum + value, 0);
  const missing = SECTIONS.length - known.length;
  const [low, high] = [total + missing * scale.min, total + missing * scale.max];
  const exact = missing === 0;
  return kind === "sum" ? { from: low, to: high, exact, kind } : { from: halfBand(low / 4), to: halfBand(high / 4), exact, kind };
}

// Rounding up to the next multiple of 5, as Duolingo rounds its overall score
function upToFive(value) {
  return Math.ceil(value / 5) * 5;
}

// Checking that the scores entered can all be on one score report. Returns null when they can, or a
// problem: "wrong" when the test owner's own rule rules the combination out, so no comparison or
// verdict is shown, and "check" when it is only worth a second look. Each problem names its rule's
// fact, says what to check, and may offer one tap that puts it right
export function scoreProblem(score, data) {
  const test = data.tests[score.test];
  const scoring = scoringOf(test, score);
  const overall = score.overall;
  if (!isNumber(overall)) {
    return null;
  }
  const digits = scaleOf(test, score).digits;
  const text = (value) => scoreText(value, digits);
  const range = overallRange(score, data);
  if (range && (overall < range.from || overall > range.to)) {
    const higher = overall > range.to;
    const plural = test.sectionWord === "band" ? "bands" : "section scores";
    const single = test.sectionWord === "band" ? "band" : "section score";
    const rule = range.kind === "sum"
      ? "On the 0 to 120 scale, the overall score is the four section scores added up."
      : `${score.test === "ielts" ? "IELTS" : "ETS"} works out the overall as the average of the four ${plural}, rounded to the nearest half band.`;
    const found = range.exact
      ? `Your four ${plural} ${range.kind === "sum" ? "add up to" : "give"} ${text(range.from)}, not ${text(overall)}.`
      : `With the ${plural} you added, the overall can be ${higher ? `at most ${text(range.to)}` : `at least ${text(range.from)}`}, so ${text(overall)} is not possible.`;
    return {
      state: "wrong", about: "sections", cite: [scoring.cite],
      lines: [`${rule} ${found}`, `For an overall of ${text(overall)}, at least one ${single} needs to be ${higher ? "higher" : "lower"}. Check your score report.`],
      fix: range.exact ? { field: "overall", value: range.from, words: `Use ${text(range.from)} as my overall` } : null,
    };
  }
  if (test.scales && score.scale === "new" && isNumber(score.comparable)) {
    const [from, to] = oldRangeOf(overall, data.compare.toeflOld.rows);
    if (score.comparable < from || score.comparable > to) {
      const shown = comparableOf(overall, data.compare.toeflOld.rows);
      return {
        state: "wrong", about: "comparable", cite: [data.compare.toeflOld.cite, test.scoring.comparable],
        lines: [`An overall of ${text(overall)} matches ${from} to ${to} on the old scale, and the report shows the middle of that range, ${eitherOf(shown)}. So ${score.comparable} cannot be on the same report.`, "Check the 0 to 120 score on your report, or clear it."],
        fix: { field: "comparable", value: null, words: "Clear the 0 to 120 score" },
      };
    }
  }
  if (scoring.kind === "average5" && isNumber(score.lowest)) {
    const most = upToFive((score.lowest + 3 * test.lowest.max) / 4);
    if (score.lowest > overall || overall > most) {
      return {
        state: "wrong", about: "sections", cite: [scoring.cite],
        lines: [score.lowest > overall
          ? `Duolingo works out the overall as the average of the four subscores, so your lowest subscore cannot be higher than your overall. You entered ${score.lowest} and ${overall}.`
          : `Duolingo works out the overall as the average of the four subscores. Even with the other three at ${test.lowest.max}, a lowest subscore of ${score.lowest} gives an overall of at most ${most}, not ${overall}.`,
          "Check both numbers on your score report."],
        fix: null,
      };
    }
  }
  if (scoring.kind === "whole") {
    const values = SECTIONS.map((name) => score.sections?.[name]);
    if (values.every(isNumber) && (overall > Math.max(...values) || overall < Math.min(...values))) {
      return {
        state: "check", about: "sections", cite: [scoring.cite],
        lines: [`Your overall of ${overall} is ${overall > Math.max(...values) ? "higher" : "lower"} than all four of your skill scores. Pearson does not work out the overall as an average, but all five come from the same test, so check each number against your score report.`],
        fix: null,
      };
    }
  }
  return null;
}

function summary(parts) {
  return STATE_ORDER.find((state) => parts.some((part) => part.state === state)) ?? "meets";
}

// Checking one university's rule for the student's test. Returns the state ("meets", "below", "no",
// "ask", "needs", "open" or "noTest") and the lines that explain it
export function verdict(rule, score, data) {
  if (rule.noTest) {
    return { state: "noTest", parts: [] };
  }
  const test = data.tests[score.test];
  const wanted = rule.tests?.[score.test];
  if (!wanted) {
    return { state: "ask", parts: [{ state: "ask", words: `Pathway's source for this rule does not name ${test.name}` }] };
  }
  if (wanted.accepted === false) {
    return { state: "no", parts: [] };
  }
  if (wanted.accepted === true) {
    return { state: "open", parts: [] };
  }
  const digits = sectionScaleOf(test, score).digits;
  let parts;
  if (!test.scales) {
    parts = onScale(wanted, score, digits, test.sectionWord);
  } else if (wanted[score.scale]) {
    parts = onScale(wanted[score.scale], score, digits, test.sectionWord);
  } else if (score.scale === "new" && wanted.old) {
    parts = newAgainstOld(wanted.old, score, data.compare.toeflOld.rows);
  } else {
    parts = [{ state: "ask", words: "Its TOEFL rule is on the new 1 to 6 scale only, so ask how it reads a score on the old scale" }];
  }
  return { state: summary(parts), parts };
}

function nearest(value, rows) {
  return rows.find(([at]) => at === value) ?? null;
}

// Placing an IELTS band on the CEFR, with the borders the IELTS chart marks
function ieltsLevel(band, compare) {
  const row = nearest(band, compare.ieltsCefr.rows);
  if (!row) {
    return { level: band < 4 ? "Below B1" : null, border: null };
  }
  const border = compare.ieltsCefr.border.find(([at]) => at === band)?.[1] ?? null;
  return { level: row[1], border };
}

function range(from, to, digits = 0) {
  return from === to ? scoreText(from, digits) : `${scoreText(from, digits)} to ${scoreText(to, digits)}`;
}

// Placing the student's score on the other tests' scales and the CEFR, each line naming whose table
// it comes from. Tests with no table between them are compared through IELTS only, never directly
export function comparisons(score, data) {
  const { compare } = data;
  const lines = [];
  let level;
  if (score.test === "ielts") {
    const band = score.overall;
    level = { ...ieltsLevel(band, compare), by: "IELTS", cite: compare.ieltsCefr.cite };
    const toefl = nearest(band, compare.ieltsToefl.rows);
    if (toefl) {
      lines.push({ test: "TOEFL iBT", words: `about ${scoreText(toefl[1], 1)}`, by: "ETS", cite: compare.ieltsToefl.cite });
      const old = oldRangeOf(toefl[1], compare.toeflOld.rows);
      lines.push({ test: "TOEFL iBT, old scale", words: `about ${range(old[0], old[1])}`, by: "ETS", cite: compare.toeflOld.cite });
    }
    const pte = nearest(band, compare.ieltsPte.rows);
    if (pte) {
      lines.push({ test: "PTE Academic", words: `about ${range(pte[1], pte[2])}`, by: "Pearson", cite: compare.ieltsPte.cite });
    }
    const det = compare.duolingo.rows.filter((row) => band >= row[2] && band <= row[3]).map((row) => row[0]);
    if (det.length > 0) {
      lines.push({ test: "Duolingo English Test", words: `about ${range(Math.min(...det), Math.max(...det))}`, by: "Duolingo", cite: compare.duolingo.cite });
    } else if (band <= compare.duolingo.below.ielts[1]) {
      lines.push({ test: "Duolingo English Test", words: `about ${compare.duolingo.below.to} or below`, by: "Duolingo", cite: compare.duolingo.cite });
    }
  } else if (score.test === "toefl") {
    const band = score.scale === "new" ? score.overall : bandOfOld(score.overall, compare.toeflOld.rows);
    if (score.scale === "old") {
      lines.push({ test: "TOEFL iBT, new scale", words: `about ${scoreText(band, 1)}`, by: "ETS", cite: compare.toeflOld.cite });
    } else {
      const shown = typeof score.comparable === "number" ? [score.comparable, score.comparable] : comparableOf(band, compare.toeflOld.rows);
      lines.push({ test: "TOEFL iBT, old scale", words: `${eitherOf(shown)}, on your report`, by: "ETS", cite: compare.toeflOld.cite });
    }
    level = { level: nearest(band, compare.toeflCefr.rows)?.[1] ?? null, border: null, by: "ETS", cite: compare.toeflCefr.cite };
    const ielts = compare.ieltsToefl.rows.filter(([, toefl]) => toefl === band).map(([one]) => one);
    if (ielts.length > 0) {
      lines.push({ test: "IELTS", words: `about ${range(Math.min(...ielts), Math.max(...ielts), 1)}`, by: "ETS", cite: compare.ieltsToefl.cite });
    } else {
      const above = compare.ieltsToefl.rows.filter(([, toefl]) => toefl > band).at(-1);
      const below = compare.ieltsToefl.rows.find(([, toefl]) => toefl < band);
      lines.push({ test: "IELTS", words: above && below ? `between ${scoreText(below[0], 1)} and ${scoreText(above[0], 1)}` : `below ${scoreText(compare.ieltsToefl.rows.at(-1)[0], 1)}`, by: "ETS", cite: compare.ieltsToefl.cite });
    }
  } else if (score.test === "pte") {
    const value = score.overall;
    const row = compare.ieltsPte.rows.find(([, from, to]) => value >= from && value <= to);
    lines.push({ test: "IELTS", words: row ? `about ${scoreText(row[0], 1)}` : value < compare.ieltsPte.rows.at(-1)[1] ? `below ${scoreText(compare.ieltsPte.rows.at(-1)[0], 1)}` : null, by: "Pearson", cite: compare.ieltsPte.cite });
    const levels = compare.pteCefr.rows.filter(([, from, to]) => value >= from && value <= to).map(([one]) => one);
    level = { level: levels.length === 0 ? (value < compare.pteCefr.rows[0][1] ? "Below A2" : null) : levels.join(" or "), border: null, by: "Pearson", cite: compare.pteCefr.cite };
  } else {
    const value = score.overall;
    const row = compare.duolingo.rows.find(([at]) => at === value);
    if (row) {
      level = { level: row[1], border: null, by: "Duolingo", cite: compare.duolingo.cite };
      lines.push({ test: "IELTS", words: `about ${range(row[2], row[3], 1)}`, by: "Duolingo", cite: compare.duolingo.cite });
      lines.push({ test: "TOEFL iBT, old scale", words: `about ${range(row[4], row[5])}`, by: "Duolingo", cite: compare.duolingo.cite });
    } else {
      const low = compare.duolingo.below;
      level = { level: low.cefr, border: null, by: "Duolingo", cite: compare.duolingo.cite };
      lines.push({ test: "IELTS", words: `about ${range(low.ielts[0], low.ielts[1])}`, by: "Duolingo", cite: compare.duolingo.cite });
      lines.push({ test: "TOEFL iBT, old scale", words: `about ${range(low.toefl[0], low.toefl[1])}`, by: "Duolingo", cite: compare.duolingo.cite });
    }
  }
  return { level, lines: lines.filter((line) => line.words) };
}
