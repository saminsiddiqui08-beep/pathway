// Reading school results the ways universities read them: an HSC percentage range from subject grades,
// the named US readings, New Zealand's tariff, and each university's rule. Nothing here touches the
// screen, so the checks run the same code in Node. A verdict comes only from the student's own results
const STATE_ORDER = ["meets", "ask", "needs", "below"];

// Turning counts of subject grades into the range of average marks they allow, from the grade bands
export function percentRange(counts, bands) {
  let subjects = 0;
  let low = 0;
  let high = 0;
  for (const [grade, from, to] of bands) {
    const count = counts[grade] ?? 0;
    subjects += count;
    low += from * count;
    high += to * count;
  }
  return subjects === 0 ? null : { subjects, low: low / subjects, high: high / subjects };
}

// Reading each subject grade with one university's own table. A grade whose marks span two of its
// rows can be read either way, so the result is a range of points and a list of possible letters
export function readWith(reading, counts, bands) {
  let subjects = 0;
  let low = 0;
  let high = 0;
  const letters = [];
  for (const [grade, from, to] of bands) {
    const count = counts[grade] ?? 0;
    if (count === 0) {
      continue;
    }
    const rows = reading.rows.filter(([rowFrom, rowTo]) => rowFrom <= to && rowTo >= from);
    subjects += count;
    if (reading.points) {
      low += Math.min(...rows.map((row) => row[3])) * count;
      high += Math.max(...rows.map((row) => row[3])) * count;
    }
    letters.push({ count, letters: rows.map((row) => row[2]) });
  }
  if (subjects === 0) {
    return null;
  }
  return { subjects, letters, points: reading.points ? { low: low / subjects, high: high / subjects } : null };
}

// Listing the student's A level grades from best to worst
export function bestGrades(counts, order) {
  return order.flatMap((grade) => Array(counts[grade] ?? 0).fill(grade));
}

// Counting tariff points the way Victoria counts them: the best six units, an A level being two units
// and an AS level one. Also the plain total of every grade, which no university's count can exceed
export function tariffPoints(aCounts, asCounts, alevel) {
  const items = [
    ...bestGrades(aCounts, alevel.grades).map((grade) => ({ units: alevel.units.aLevel, points: alevel.tariff.aLevel[grade] })),
    ...bestGrades(asCounts, alevel.asGrades).map((grade) => ({ units: alevel.units.as, points: alevel.tariff.as[grade] })),
  ];
  const best = Array(alevel.units.most + 1).fill(0);
  for (const item of items) {
    for (let units = alevel.units.most; units >= item.units; units -= 1) {
      best[units] = Math.max(best[units], best[units - item.units] + item.points);
    }
  }
  return { counted: Math.max(...best), total: items.reduce((sum, item) => sum + item.points, 0), any: items.length > 0 };
}

// Checking grades against a rule such as BBC: the student's best grades must each reach the grade
// in the same place
function gradesMeet(best, wanted, order) {
  return best.length >= wanted.length && wanted.every((grade, index) => order.indexOf(best[index]) <= order.indexOf(grade));
}

function joined(grades) {
  return grades.join("");
}

// Checking one HSC rule against the GPA and subject grades the student entered
export function hscVerdict(rule, results, data) {
  if (rule.accepted === false) {
    return { state: "no", words: [] };
  }
  if (rule.sat) {
    return { state: "sat", words: [] };
  }
  if (rule.eligible) {
    return { state: "open", words: [] };
  }
  if (rule.ask) {
    return { state: "ask", words: [rule.ask] };
  }
  if (rule.gpa !== undefined) {
    const wanted = rule.gpa.toFixed(2);
    if (typeof results.gpa !== "number") {
      return { state: "needs", words: [`A GPA of at least ${wanted}`] };
    }
    return results.gpa >= rule.gpa
      ? { state: "meets", words: [`A GPA of at least ${wanted}`] }
      : { state: "below", words: [`Your GPA ${results.gpa.toFixed(2)} is below ${wanted}`] };
  }
  const range = percentRange(results.counts, data.hsc.bands);
  if (!range) {
    return { state: "needs", words: [`At least ${rule.percent}%: add your subject grades`] };
  }
  const low = Math.round(range.low);
  const high = Math.round(range.high);
  if (range.low >= rule.percent) {
    return { state: "meets", words: [`At least ${rule.percent}%: your grades mean ${low}% or more`] };
  }
  if (range.high < rule.percent) {
    return { state: "below", words: [`At least ${rule.percent}%: your grades mean ${high}% at most`] };
  }
  return { state: "ask", words: [`At least ${rule.percent}%: your grades mean ${low}% to ${high}%, so ask how it reads your GPA`] };
}

// Checking one A level rule: grades such as BBC, or tariff points with grades beside them
function oneAlevel(rule, results, data) {
  const { alevel } = data;
  if (rule.accepted === false) {
    return { state: "no", words: [] };
  }
  if (rule.sat) {
    return { state: "sat", words: [] };
  }
  if (rule.ask) {
    return { state: "ask", words: [rule.ask] };
  }
  const best = bestGrades(results.aCounts, alevel.grades);
  if (best.length === 0) {
    return { state: "needs", words: ["Add your A level grades"] };
  }
  const words = [];
  let state = "meets";
  if (rule.grades) {
    const met = gradesMeet(best, rule.grades, alevel.grades);
    words.push(met ? `${joined(rule.grades)} or better` : `${joined(rule.grades)} or better: your best ${rule.grades.length === 1 ? "is" : "are"} ${joined(best.slice(0, rule.grades.length))}`);
    state = met ? "meets" : "below";
  }
  if (rule.tariff !== undefined) {
    const points = tariffPoints(results.aCounts, results.asCounts, alevel);
    if (points.total < rule.tariff) {
      words.push(`${rule.tariff} tariff points: yours come to ${points.total}`);
      state = "below";
    } else if (points.counted >= rule.tariff) {
      words.push(`${rule.tariff} tariff points: up to ${points.counted}`);
    } else {
      words.push(`${rule.tariff} tariff points: between ${points.counted} and ${points.total}, depending on how it counts`);
      state = state === "below" ? "below" : "ask";
    }
  }
  return { state, words };
}

// Checking every A level rule a university gives for the student's board. Meeting any one of them is
// enough, so the best result among them stands
export function alevelVerdict(rules, results, data) {
  const mine = rules.filter((rule) => rule.boards.includes(results.board));
  if (mine.length === 0) {
    return null;
  }
  const checked = mine.map((rule) => ({ ...oneAlevel(rule, results, data), note: rule.note }));
  const special = checked.find((one) => ["no", "sat"].includes(one.state));
  if (special && checked.length === 1) {
    return special;
  }
  const state = STATE_ORDER.find((one) => checked.some((item) => item.state === one)) ?? "ask";
  const best = checked.filter((item) => item.state === state);
  return { state, words: best.flatMap((item) => item.words), notes: best.map((item) => item.note).filter(Boolean) };
}
