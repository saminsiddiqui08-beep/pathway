// Drawing a roadmap or a Toolkit guide from its content data: the list of countries, the station line,
// the sections and every interactive part. Nothing here touches the screen, so the same answers always
// draw the same page
import { moneyText, takaText } from "../../app/money.js";
import { dateWithPreposition, esc, glue, joinWords } from "../timeline/words.js";
import { fillText, rateOf, sumOf } from "./inserts.js";

const MARK_WORDS = {
  needs: "Needs a test", recommends: "Recommends one", none: "No test needed", optional: "Optional", check: "Check the rule", depends: "Depends on your programme",
};
const TEST_WORDS = { ielts: "IELTS", toefl: "TOEFL iBT", duolingo: "the Duolingo English Test", pte: "PTE Academic" };
// Naming the button that opens each Toolkit guide or tool from a roadmap or another guide
export const LINK_WORDS = {
  profile: "Read Building your profile", olympiads: "See Olympiads and competitions", research: "Read Doing research",
  costs: "Read What a year really costs", money: "Open Your money plan", deadline: "Open Deadline in Dhaka time",
  grades: "Open Check your grades", english: "Open Check your English score", words: "Open Words explained", visa: "Open Your visa interview",
};
// Keeping a tick's saved key short, while still telling every checklist line apart
const KEY_LENGTH = 48;

function icon(name, extra = "") {
  return `<svg class="icon${extra}" aria-hidden="true"><use href="icons/sprite.svg#${name}"></use></svg>`;
}

// Filling a text from the facts and allowing **bold**, the only markup roadmap text may hold
export function inline(text, ctx, template = null) {
  const filled = fillText(text, { ...ctx, templateYear: template ? ctx.years[template] : undefined });
  return esc(filled).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// Putting each part of a table value on its own line, so "Arts NZD 42,236; commerce NZD 51,020" reads
// as a short list instead of a wall of text, with the taka figure in brackets set softer than the
// amount itself. A value whose bold text crosses a break is left whole
function cellHtml(text, ctx, template = null) {
  const html = inline(text, ctx, template).replace(/\((about ৳[^()]*)\)/g, `<span class="approx">($1)</span>`);
  const parts = html.split("; ");
  const balanced = parts.every((part) => (part.match(/<strong>/g) ?? []).length === (part.match(/<\/strong>/g) ?? []).length);
  if (parts.length < 2 || !balanced) {
    return html;
  }
  return parts.map((part) => `<span class="cell-line">${part}</span>`).join("");
}

// Telling whether a part written for one HSC year is shown: "sat" only while that year's students
// are still to start, and "sit" always, for the student's own year or the next HSC
function shows(template, ctx) {
  return !template || ctx.years[template] !== null;
}

function infoButton(cite, id) {
  if (!cite || cite.length === 0) {
    return "";
  }
  return `<button class="info-button" type="button" data-action="roadmap-facts" data-facts="${esc(cite.join(" "))}" aria-label="Where this comes from" data-from="${esc(id)}">${icon("info")}</button>`;
}

function linkButton(link) {
  return link && LINK_WORDS[link] ? `<button class="text-button roadmap-link" type="button" data-action="roadmap-link" data-link="${link}">${esc(LINK_WORDS[link])}</button>` : "";
}

// Keying a checklist line or a university by its words, so a tick survives a reordered list
export function keyOf(text) {
  return text.replace(/\{[^}]*\}/g, "").replace(/\*\*/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, KEY_LENGTH);
}

// Matching a university across tables: "University of Auckland", "Auckland" and "Auckland University
// of Technology (AUT)" become "auckland", "auckland" and "aut". A row whose words cannot tell, such as
// "Victoria" for Victoria University of Wellington, carries its key in the data
export function rowKey(cell) {
  return cell.key ?? universityKey(cell.text);
}

export function universityKey(text) {
  const plain = text.replace(/\*\*/g, "").replace(/\{[^}]*\}/g, "").trim();
  const short = /\(([A-Z]{2,6})\)/.exec(plain);
  if (short) {
    return short[1].toLowerCase();
  }
  return plain.toLowerCase().replace(/\buniversity\b|\bof\b|\bthe\b|\bcollege\b|\binternational\b|\bmalaysia\b/g, " ").replace(/[^a-zÀ-ɏ]+/g, " ").trim();
}

// Wording the add button of a university, so the words always match the state
export function listLabel(inList, name) {
  return `${inList ? "Remove from my list" : "Add to my list"}: ${name}`;
}

function planStepLine(item, ctx) {
  const step = ctx.plan?.result?.steps?.find((one) => item.planSteps?.includes(one.id));
  if (!step) {
    return "";
  }
  const when = step.done ? "Done" : step.undated ? "Date not published yet" : `In your plan ${dateWithPreposition(step.date, ctx.today) || ""}`.trim();
  return `<span class="roadmap-plan-step"><span class="roadmap-plan-dot" aria-hidden="true"></span>${esc(when)}
    <button class="text-button" type="button" data-action="roadmap-open-step" data-step="${esc(step.id)}">Open in your plan</button></span>`;
}

function listItems(block, ctx, id) {
  return block.items
    .filter((item) => shows(item.template ?? block.template, ctx))
    .map((item) => `<li><div class="roadmap-item-body"><span class="roadmap-item-text">${glue(inline(item.text, ctx, item.template ?? block.template), infoButton(item.cite, id))}</span>${planStepLine(item, ctx)}${linkButton(item.link)}</div></li>`)
    .join("");
}

// Drawing a list as a short route, with "You are here" on the stop ctx.stationHere names, such as the
// student's class in the guide's timeline
function stationList(block, ctx) {
  const here = ctx.stationHere ?? null;
  return `<ol class="guide-route">${block.items.map((item, n) => `<li class="guide-stop${n === here ? " is-here" : ""}"><span class="guide-marker" aria-hidden="true"></span><p>${n === here ? `<span class="visually-hidden">You are here: </span>` : ""}${inline(item.text, ctx)}</p></li>`).join("")}</ol>`;
}

function checklist(block, ctx, id) {
  return `<ul class="roadmap-checklist">${block.items.map((item) => {
    const key = keyOf(item.text);
    const done = ctx.checks.has(key);
    return `<li><label class="roadmap-check">
      <input class="station-input" type="checkbox" data-action="roadmap-check" data-key="${esc(key)}"${done ? " checked" : ""}>
      <span class="roadmap-box" aria-hidden="true">${icon("tick")}</span>
      <span class="roadmap-item-text">${inline(item.text, ctx)}</span>
    </label>${infoButton(item.cite, id)}</li>`;
  }).join("")}</ul>`;
}

// Drawing a table as one card per row, with each value under its column's name, so nothing on a
// phone needs scrolling sideways. A row a filter leaves out is hidden; one that does not fit is faded
function table(block, ctx, id, marks = null) {
  const rows = block.rows.map((row, index) => {
    const cites = row.flatMap((cell) => cell.cite ?? []);
    const [first, ...rest] = row;
    const key = rowKey(first);
    const inList = ctx.list.has(key);
    const mark = marks?.[index];
    const state = mark?.state ? ` is-${mark.state}` : "";
    const name = first.text.replace(/\*\*/g, "");
    const add = block.listable
      ? `<button class="roadmap-add" type="button" data-action="roadmap-list" data-key="${esc(key)}" data-name="${esc(name)}" aria-pressed="${inList}" aria-label="${esc(listLabel(inList, name))}">${icon(inList ? "tick" : "plus")}</button>`
      : "";
    return `<li class="roadmap-row${state}" data-row="${index}" data-key="${esc(key)}"${mark?.state === "hidden" ? " hidden" : ""}>
      <div class="roadmap-row-head"><p class="roadmap-row-title">${inline(first.text, ctx, block.template)}</p>${mark?.label ? `<span class="badge${mark.state === "plan" ? " is-plan" : ""}">${esc(mark.label)}</span>` : ""}${infoButton(cites, id)}${add}</div>
      ${rest.length > 0 ? `<dl class="roadmap-row-cells">${rest.map((cell, n) => `<div><dt>${esc(block.head[n + 1])}</dt><dd>${cellHtml(cell.text, ctx, block.template)}</dd></div>`).join("")}</dl>` : ""}
      ${mark?.warning ? `<p class="roadmap-warning">${icon("clock", " is-small")}<span>${esc(mark.warning)}</span></p>` : ""}
    </li>`;
  }).join("");
  return `<ul class="roadmap-table" aria-label="${esc(block.head.join(", "))}">${rows}</ul>`;
}

function choices(question, value, widget) {
  return `<div class="roadmap-question"><p class="field-label">${esc(question.text)}</p>
    <div class="chips">${question.options.map(([option, label]) => `<button type="button" class="chip" aria-pressed="${value === option}" data-action="roadmap-answer" data-widget="${esc(widget)}" data-question="${esc(question.id)}" data-value="${esc(option)}">${esc(label)}</button>`).join("")}</div></div>`;
}

// Answering a route finder's questions from the student's plan, where the plan can tell
export function planAnswers(questions, ctx) {
  const plan = ctx.plan;
  if (!plan?.answers) {
    return {};
  }
  const answers = plan.answers;
  const results = plan.result?.steps?.find((step) => step.id === "school.results");
  const resultsOut = !results || results.done || results.date.day < ctx.today;
  const found = {};
  for (const question of questions) {
    const from = {
      system: answers.school?.system,
      sat: answers.sat ? (answers.sat.status === "no" ? "no" : "yes") : undefined,
      aid: answers.aid === "need" ? "yes" : answers.aid === "help" ? "partly" : answers.aid === "no" ? "no" : undefined,
      results: answers.school?.system === "alevel" ? "alevel" : resultsOut ? "hscOut" : "hscWaiting",
      resultsOut: resultsOut ? "yes" : "no",
      route: { sat: "sat", lut: "lut", uas: "uas" }[plan.result?.route?.id],
    }[question.plan];
    if (from !== undefined && question.options.some(([option]) => option === from)) {
      found[question.id] = from;
    }
  }
  return found;
}

function fits(row, answers, questions) {
  return Object.entries(row.fits ?? {}).every(([id, wanted]) => {
    const question = questions.find((item) => item.id === id);
    const asked = !question.when || Object.entries(question.when).every(([other, values]) => values.includes(answers[other]));
    return !asked || answers[id] === undefined || wanted.includes(answers[id]);
  });
}

function routeFinder(block, ctx, sectionId) {
  const answers = { ...planAnswers(block.questions, ctx), ...ctx.answers[`${sectionId}:route`] };
  const asked = block.questions.filter((question) => !question.when || Object.entries(question.when).every(([id, values]) => values.includes(answers[id])));
  const anything = Object.keys(answers).length > 0;
  const planRoute = ctx.plan?.result?.route?.id;
  const marks = block.tables.map((rows) => rows.map((row) => {
    const isPlan = planRoute && row.planRoutes?.includes(planRoute);
    if (isPlan) {
      return { state: "plan", label: "Your plan" };
    }
    return anything ? { state: fits(row, answers, block.questions) ? "fit" : "dim" } : null;
  }));
  ctx.tableMarks.push(...marks);
  return `<div class="roadmap-widget" data-widget="${esc(sectionId)}:route">
    <p class="roadmap-widget-title">Find your route</p>
    ${asked.map((question) => choices(question, answers[question.id], `${sectionId}:route`)).join("")}
    ${anything ? `<p class="note">The routes that fit your answers are shown in full, and the others are faded.${ctx.plan?.answers ? " Your plan's answers are used where they fit." : ""}</p>` : ""}
  </div>`;
}

function englishPicker(block, ctx, sectionId, tableBlock) {
  const widget = `${sectionId}:english`;
  const answers = ctx.answers[widget] ?? {};
  if (block.mode === "ask") {
    const given = { ...planAnswers(block.questions, ctx), ...answers };
    const all = block.questions.every((question) => given[question.id] !== undefined);
    const marks = block.marks.map((rules) => {
      if (!all) {
        return null;
      }
      const rule = rules.find((one) => !one.when || Object.entries(one.when).every(([id, values]) => values.includes(given[id])));
      return { state: rule.mark === "needs" ? "fit" : "", label: MARK_WORDS[rule.mark] };
    });
    ctx.tableMarks.push(marks);
    return `<div class="roadmap-widget">
      <p class="roadmap-widget-title">Do you need a test?</p>
      ${block.questions.map((question) => choices(question, given[question.id], widget)).join("")}
      ${all ? `<p class="note">Each university below now says what it asks of you. Check its own rule before you book.</p>` : ""}
    </div>`;
  }
  // Ticking universities highlights their rows and warns when the student's test is not accepted
  const picked = new Set(answers.picked ?? []);
  const test = ctx.plan?.answers?.english?.test ?? null;
  const marks = tableBlock.rows.map((row, index) => {
    const refused = test && block.refuses[index]?.includes(test);
    const state = picked.size === 0 ? "" : picked.has(index) ? "fit" : "dim";
    return { state, warning: refused && (picked.size === 0 || picked.has(index)) ? `Does not accept ${TEST_WORDS[test]}, the test in your plan.` : null };
  });
  ctx.tableMarks.push(marks);
  return `<div class="roadmap-widget">
    <p class="roadmap-widget-title">Which universities are you applying to?</p>
    <div class="chips">${tableBlock.rows.map((row, index) => `<button type="button" class="chip" aria-pressed="${picked.has(index)}" data-action="roadmap-pick" data-widget="${esc(widget)}" data-index="${index}">${esc(fillText(row[0].text, ctx).replace(/\*\*/g, ""))}</button>`).join("")}</div>
    ${block.note && picked.size > 0 ? `<p class="note">${esc(block.note)}</p>` : ""}
  </div>`;
}

// Gathering what the roadmap says about one university on "My list", from every table that names it,
// grouped under the section each fact comes from
function listGroups(key, roadmap) {
  const groups = [];
  for (const section of roadmap.sections) {
    for (const one of section.blocks.filter((item) => item.type === "table")) {
      for (const row of one.rows.filter((item) => rowKey(item[0]) === key)) {
        let group = groups.find((item) => item.station === section.station);
        if (!group) {
          group = { station: section.station, cells: [] };
          groups.push(group);
        }
        group.cells.push(...row.slice(1).map((cell, n) => ({ head: one.head[n + 1], text: cell.text })));
      }
    }
  }
  return groups;
}

// Drawing what the roadmap says about one university on "My list", under one small heading for each
// section, so a section's name is never repeated on every line
export function listDetails(key, ctx, roadmap) {
  return `<div class="mylist-details">${listGroups(key, roadmap).map((group) => `<div class="mylist-group"><p class="mylist-station">${esc(group.station)}</p>
    <dl class="roadmap-row-cells">${group.cells.map((item) => `<div><dt>${esc(item.head)}</dt><dd>${cellHtml(item.text, ctx)}</dd></div>`).join("")}</dl></div>`).join("")}</div>`;
}

// Showing "My list" as one short card for each university, named with the sections that say something
// about it. Tapping a card opens what each section says, so the list stays short until it is needed
function myList(block, ctx, roadmap) {
  const chosen = [...ctx.list];
  if (chosen.length === 0) {
    return `<div class="roadmap-widget"><p class="roadmap-widget-title">My list</p>
      <p class="note">Add universities with the ${icon("plus", " is-small is-inline")} button in Ways to study, and their dates, fees and rules gather here.</p></div>`;
  }
  const rows = roadmap.sections.flatMap((section) => section.blocks.filter((item) => item.type === "table").flatMap((item) => item.rows));
  const cards = chosen.map((key) => {
    const title = rows.find((row) => rowKey(row[0]) === key)?.[0].text ?? key;
    const name = title.replace(/\*\*/g, "");
    const open = ctx.listOpen?.has(key) ?? false;
    const stations = listGroups(key, roadmap).map((group) => group.station);
    return `<li class="roadmap-row is-fit mylist-card${open ? " is-open" : ""}" data-key="${esc(key)}"><div class="roadmap-row-head">
        <button class="mylist-toggle" type="button" data-action="mylist-toggle" data-key="${esc(key)}" aria-expanded="${open}">
          <span class="mylist-name"><span class="roadmap-row-title">${inline(title, ctx)}</span><span class="mylist-sections">${esc(joinWords(stations))}</span></span>${icon("chevron", " mylist-chevron")}
        </button>
        <button class="roadmap-add" type="button" data-action="roadmap-list" data-key="${esc(key)}" data-name="${esc(name)}" aria-pressed="true" aria-label="${esc(listLabel(true, name))}">${icon("tick")}</button></div>
      ${open ? listDetails(key, ctx, roadmap) : ""}</li>`;
  }).join("");
  const over = block.limit && chosen.length > block.limit
    ? `<p class="roadmap-warning">${icon("clock", " is-small")}<span>You have ${chosen.length} here. The joint application takes up to ${block.limit} programmes, so you will choose ${block.limit} of these when you apply.</span></p>`
    : "";
  return `<div class="roadmap-widget"><p class="roadmap-widget-title">My list</p>${over}<p class="note">Tap a university to see what each section says about it.</p><ul class="roadmap-table mylist">${cards}</ul></div>`;
}

// Offering one choice from a list as rows of stations, for choices whose names are too long for chips
function optionRows(options, chosen, widget) {
  return `<div class="roadmap-options" role="group">${options.map((item) => `<button type="button" class="roadmap-option" aria-pressed="${item.index === chosen}" data-action="roadmap-pick" data-single="true" data-widget="${esc(widget)}" data-index="${item.index}"><span class="roadmap-option-stop" aria-hidden="true"></span><span>${esc(item.name)}</span></button>`).join("")}</div>`;
}

// Working out the money a Finnish residence permit needs, with a university's tuition paid or not
function permitCalculator(ctx, roadmap, sectionId) {
  const money = roadmap.sections.find((section) => section.id === sectionId);
  const fees = money.blocks.find((item) => item.type === "table");
  const options = fees.rows.map((row, index) => ({ index, name: fillText(row[0].text, ctx).replace(/\*\*/g, ""), fee: /\{money:([^}]+)\}/.exec(row[1]?.text ?? "")?.[1] ?? null })).filter((option) => option.fee);
  const chosen = ctx.answers[`${sectionId}:permit`]?.picked?.[0];
  const option = options.find((item) => item.index === chosen);
  let result = "";
  if (option) {
    const living = sumOf(ctx.facts, "fi/permit.funds");
    const fee = sumOf(ctx.facts, option.fee);
    const both = living.amount + fee.amount;
    const rate = rateOf(ctx.facts, "EUR").rate;
    result = `<dl class="roadmap-sums">
      <div><dt>First-year tuition</dt><dd>${esc(moneyText("EUR", fee.amount))}, about ${esc(takaText(fee.amount * rate))}</dd></div>
      <div><dt>Living money for the permit</dt><dd>${esc(moneyText("EUR", living.amount))}, about ${esc(takaText(living.amount * rate))}</dd></div>
      <div class="is-total"><dt>In your account, tuition not yet paid</dt><dd>${esc(moneyText("EUR", both))}, about ${esc(takaText(both * rate))}</dd></div>
      <div class="is-total"><dt>In your account, tuition paid</dt><dd>${esc(moneyText("EUR", living.amount))}, with the receipt attached</dd></div>
    </dl><p class="note">Some universities take money off for accepting or paying early; see Aid.</p>`;
  }
  return `<div class="roadmap-widget"><p class="roadmap-widget-title">What to hold for the permit</p>
    <p class="note">Choose a university.</p>${optionRows(options, chosen, `${sectionId}:permit`)}${result}</div>`;
}

// Listing every source the roadmap's facts rest on, from the facts files, so none is ever missed
function sourceList(ctx, roadmap) {
  const refs = new Set(roadmap.sections.flatMap((section) => section.blocks.flatMap((item) => [item, ...(item.items ?? []), ...(item.rows ?? []).flat()].flatMap((one) => one.cite ?? []))));
  const seen = new Map();
  for (const ref of refs) {
    if (!ctx.facts.has(ref)) {
      continue;
    }
    const record = ctx.facts.fact(ref);
    for (const entry of record.values ?? [record]) {
      const source = ctx.facts.source(ref, entry);
      if (source && !seen.has(source.url)) {
        seen.set(source.url, source);
      }
    }
  }
  const sorted = [...seen.values()].sort((a, b) => a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title));
  return `<ul class="roadmap-sources">${sorted.map((source) => `<li><a href="${esc(source.url)}">${esc(source.title)}</a><span class="note">${esc(source.publisher)}</span></li>`).join("")}</ul>`;
}

// Showing the part of a guide written for the subject the student picks. The pick is remembered on
// the phone, so the guide opens on it next time
function fieldPicker(block, ctx, section, roadmap) {
  const widget = `${section.id}:field`;
  const chosen = ctx.answers[widget]?.value ?? null;
  const field = block.fields.find((item) => item.id === chosen);
  const body = field ? nestedBody({ id: `${section.id}-${field.id}`, blocks: field.blocks }, ctx, roadmap) : "";
  return `<div class="roadmap-widget guide-picker" data-widget="${esc(widget)}">
    <p class="roadmap-widget-title">${esc(block.question)}</p>
    <div class="chips">${block.fields.map((item) => `<button type="button" class="chip" aria-pressed="${item.id === chosen}" data-action="guide-field" data-widget="${esc(widget)}" data-value="${esc(item.id)}">${esc(item.label)}</button>`).join("")}</div>
    ${field ? "" : `<p class="note">${esc(block.note)}</p>`}
  </div>${field ? `<div class="guide-field">${body}</div>` : ""}`;
}

// Folding a part of a guide behind its title, so a long guide reads as a short list of questions and
// each answer opens only when it is wanted
function fold(block, ctx, roadmap, id) {
  const open = ctx.folds?.has(id) ?? false;
  return `<section class="guide-fold${open ? " is-open" : ""}" data-fold="${esc(id)}">
    <h4 class="guide-fold-head"><button class="guide-fold-toggle" type="button" data-action="guide-fold" data-fold="${esc(id)}" aria-expanded="${open}">
      <span class="guide-fold-text"><span class="guide-fold-title">${inline(block.title, ctx)}</span>${block.summary ? `<span class="guide-fold-summary">${inline(block.summary, ctx)}</span>` : ""}</span>${icon("chevron", " guide-fold-chevron")}
    </button></h4>
    ${open ? foldBodyHtml(block, ctx, roadmap, id) : ""}
  </section>`;
}

export function foldBodyHtml(block, ctx, roadmap, id) {
  return `<div class="guide-fold-body">${nestedBody({ id, blocks: block.blocks }, ctx, roadmap)}</div>`;
}

// Filtering the table after it by a tag on each row's first cell; "all" shows every row
function filter(block, ctx, section, tableBlock) {
  const widget = `${section.id}:filter`;
  const chosen = ctx.answers[widget]?.value ?? block.options[0][0];
  ctx.tableMarks.push(tableBlock.rows.map((row) => (chosen === "all" || row[0].tags?.includes(chosen) ? null : { state: "hidden" })));
  return `<div class="roadmap-filter"><p class="field-label">${esc(block.question)}</p>
    <div class="chips">${block.options.map(([value, label]) => `<button type="button" class="chip" aria-pressed="${value === chosen}" data-action="guide-filter" data-widget="${esc(widget)}" data-value="${esc(value)}">${esc(label)}</button>`).join("")}</div></div>`;
}

function blockHtml(block, ctx, section, roadmap, id) {
  if (!shows(block.template, ctx)) {
    return "";
  }
  switch (block.type) {
    case "heading":
      return `<h4 class="roadmap-heading">${inline(block.text, ctx, block.template)}</h4>`;
    case "p": {
      // Leaving out a pointer to a part of Pathway that is not built yet, since a word on screen is a promise
      if (block.link && !LINK_WORDS[block.link]) {
        return "";
      }
      return `<p class="${block.rates ? "note roadmap-rates" : "reading"}">${glue(inline(block.text, ctx, block.template), infoButton(block.cite, id))}</p>${linkButton(block.link)}`;
    }
    case "list":
      if (block.stations) {
        return stationList(block, ctx);
      }
      return block.ordered ? `<ol class="roadmap-steps">${listItems(block, ctx, id)}</ol>` : `<ul class="roadmap-list">${listItems(block, ctx, id)}</ul>`;
    case "checklist":
      return checklist(block, ctx, id);
    case "fold":
      return fold(block, ctx, roadmap, id);
    case "table":
      return table(block, ctx, id);
    case "button":
      return `<button class="button-primary roadmap-plan-button" type="button" data-action="roadmap-make-plan">${esc(ctx.plan ? "Open my plan" : block.text)}</button>`;
    case "widget": {
      const next = section.blocks.slice(section.blocks.indexOf(block) + 1).find((item) => item.type === "table");
      switch (block.id) {
        case "routeFinder":
          return routeFinder(block, ctx, section.id);
        case "englishPicker":
          return englishPicker(block, ctx, section.id, next);
        case "myList":
          return myList(block, ctx, roadmap);
        case "permitCalculator":
          return permitCalculator(ctx, roadmap, section.id);
        case "fieldPicker":
          return fieldPicker(block, ctx, section, roadmap);
        case "filter":
          return filter(block, ctx, section, next);
        default:
          return sourceList(ctx, roadmap);
      }
    }
    default:
      return "";
  }
}

// Drawing one section's content, handing each widget's row marks to the tables after it
export function sectionBody(section, ctx, roadmap) {
  ctx.tableMarks = [];
  return section.blocks.map((block, index) => {
    if (block.type === "table" && ctx.tableMarks.length > 0) {
      return table(block, ctx, `${section.id}-${index}`, ctx.tableMarks.shift());
    }
    return blockHtml(block, ctx, section, roadmap, `${section.id}-${index}`);
  }).join("");
}

// Drawing blocks inside a widget without disturbing the marks the outer section is handing on
function nestedBody(section, ctx, roadmap) {
  const outer = ctx.tableMarks;
  const html = sectionBody(section, ctx, roadmap);
  ctx.tableMarks = outer;
  return html;
}

export function sectionHtml(section, ctx, roadmap, open) {
  return `<section class="roadmap-section${open ? " is-open" : ""}" id="roadmap-${esc(section.id)}" data-section="${esc(section.id)}" aria-labelledby="roadmap-title-${esc(section.id)}">
    <h3 class="roadmap-section-head"><button class="roadmap-toggle" type="button" data-action="roadmap-toggle" data-section="${esc(section.id)}" aria-expanded="${open}" id="roadmap-title-${esc(section.id)}">
      <span class="roadmap-number" aria-hidden="true">${section.number}</span><span class="roadmap-section-title">${esc(section.title)}</span>${icon("chevron", " roadmap-chevron")}
    </button></h3>
    ${open ? sectionBodyHtml(section, ctx, roadmap) : ""}
  </section>`;
}

export function sectionBodyHtml(section, ctx, roadmap) {
  return `<div class="roadmap-section-body">${sectionBody(section, ctx, roadmap)}</div>`;
}

// Drawing the station line: one stop per section, to jump between them. "You are here" is one ring
// that slides along the line to the section in view, so it never jumps from stop to stop
export function stationLine(roadmap, current) {
  return `<nav class="roadmap-stations" aria-label="Sections of this roadmap"><ol>${roadmap.sections.map((section) => `<li class="roadmap-station${section.id === current ? " is-here" : ""}">
      <button type="button" data-action="roadmap-jump" data-section="${esc(section.id)}"${section.id === current ? ` aria-current="location"` : ""}><span class="roadmap-stop" aria-hidden="true"></span><span class="roadmap-stop-label">${esc(section.station)}</span></button>
    </li>`).join("")}<li class="roadmap-here" aria-hidden="true"></li></ol></nav>`;
}

export function roadmapHtml(roadmap, ctx, info, openSections, current) {
  return `<div class="roadmap" style="--route: var(${info.line}); --route-text: var(${info.text})">
    <div class="roadmap-head">
      <button class="icon-button back-button" type="button" data-action="roadmap-back" aria-label="All countries">${icon("back")}</button>
      <h2 class="roadmap-title" id="roadmap-title" tabindex="-1"><span class="chip-dot" aria-hidden="true"></span>${esc(roadmap.title)}</h2>
    </div>
    ${stationLine(roadmap, current)}
    ${roadmap.sections.map((section) => sectionHtml(section, ctx, roadmap, openSections.has(section.id))).join("")}
  </div>`;
}

// Drawing the first screen of the Countries tab: the five roadmaps, with the student's own one marked
export function countryListHtml(countries, planCode, planWords) {
  return `<p class="lead">Step-by-step roadmaps for studying in the USA, Finland, Türkiye, Malaysia and New Zealand, each checked against official sources.</p>
    <ul class="roadmap-countries">${countries.map((country) => `<li><button class="roadmap-country" type="button" data-action="roadmap-open" data-country="${esc(country.code)}" style="--route: var(${country.line})">
      <span class="station" aria-hidden="true"></span>
      <span class="option-text"><span class="option-label">${esc(country.name)}</span>${country.code === planCode ? `<span class="option-note">Your plan: ${esc(planWords)}</span>` : ""}</span>
      ${icon("chevron", " is-soft")}
    </button></li>`).join("")}</ul>
    <p class="note">Figures are checked against each official source, with the date of the check beside every one.</p>`;
}
