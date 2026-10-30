import { readDate } from "./dates.js";

// Accepting only this facts format; a file in any other format is refused, never shown wrongly
export const FACTS_FORMAT = 1;

// Using the largest value seen within this many days, for values that change often
const OBSERVED_WINDOW_DAYS = 365;

export class FactsError extends Error { }

// Building one lookup from the loaded files; a reference reads "us/app.deadline.regular"
export function createFacts(docs) {
  const byRef = new Map();
  const sources = new Map();
  let checked = null;
  for (const [code, doc] of Object.entries(docs)) {
    if (doc?.format !== FACTS_FORMAT) {
      throw new FactsError(`Facts file ${code} has format ${doc?.format}, but this app reads format ${FACTS_FORMAT}`);
    }
    const fileChecked = readDate(doc.checked).first;
    checked = checked === null ? fileChecked : Math.max(checked, fileChecked);
    for (const [id, source] of Object.entries(doc.sources)) {
      sources.set(`${code}/${id}`, source);
    }
    for (const fact of doc.facts) {
      byRef.set(`${code}/${fact.id}`, { ...fact, code, ref: `${code}/${fact.id}` });
    }
  }

  function fact(ref) {
    const found = byRef.get(ref);
    if (!found) {
      throw new FactsError(`No fact ${ref}`);
    }
    return found;
  }

  // Finding one entry of a fact: the fact itself, or the value with the given key
  function entry(ref, key) {
    const found = fact(ref);
    if (!found.values) {
      return found;
    }
    return found.values.find((item) => item.key === String(key)) ?? null;
  }

  function keys(ref) {
    return (fact(ref).values ?? []).map((item) => item.key);
  }

  function source(ref, chosen) {
    return sources.get(`${fact(ref).code}/${chosen.source}`) ?? null;
  }

  return { fact, entry, keys, source, checked, has: (ref) => byRef.has(ref) };
}

// Reading a date or window value as a range of days; "part" picks from or to in a window
export function dateRange(value, part = "date") {
  const text = value[part];
  if (!text) {
    throw new FactsError(`Value has no ${part}`);
  }
  return readDate(text);
}

// Reading the longest figure, which the plan always uses; a variant is chosen by its label
export function durationOf(value, variantLabel = null) {
  if (value.variants) {
    const variant = value.variants.find((item) => item.label === variantLabel);
    if (!variant) {
      throw new FactsError(`No variant ${variantLabel}`);
    }
    return { amount: variant.max, unit: value.unit };
  }
  return { amount: value.max, unit: value.unit };
}

// Taking the largest observedOn value seen in the 12 months before today, or every observation if
// none is that recent, so an old app stays cautious instead of guessing
export function observedEntry(factRecord, todayDay) {
  const dated = factRecord.values.map((item) => ({ item, day: readDate(item.key).first }));
  const recent = dated.filter(({ day }) => day <= todayDay && day > todayDay - OBSERVED_WINDOW_DAYS);
  const pool = recent.length > 0 ? recent : dated;
  return pool.reduce((best, current) => (current.item.value.max > best.item.value.max ? current : best)).item;
}

// Loading every facts file the plan needs, through any function that fetches JSON
export async function loadFacts(fetchJson, files) {
  const docs = {};
  await Promise.all(Object.entries(files).map(async ([code, path]) => {
    docs[code] = await fetchJson(path);
  }));
  return createFacts(docs);
}
