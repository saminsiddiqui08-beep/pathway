// The money plan: what applying and getting a visa cost in taka, placed on the months of the
// student's plan, with the exchange rate they choose, ticks for what is paid, and how much to save
import { dayFromParts, formatDay, formatMonth, isoDay, monthStart, readDay } from "../../app/dates.js";
import { moneyText, takaText } from "../../app/money.js";
import { RATE_FACTS } from "../roadmaps/inserts.js";
import { inline } from "../roadmaps/render.js";
import { esc } from "../timeline/words.js";
import { chips, fold, icon, infoButton, numberField, readNumber, stations, stepValue, stepper, toggleFold, updateStepper } from "../toolkit/parts.js";
import { gatherItems, MAX_SITTINGS, monthsOf, priceItems, ratesFor, savingsPlan } from "./budget.js";

const SAVE_KEY = "tool.money";
const SAVED_VERSION = 1;
const LIVE_URL = "https://open.er-api.com/v6/latest/USD";
const LIVE_CREDIT = "https://www.exchangerate-api.com";
// Giving up on today's rate after this long, so a weak connection never leaves the button waiting
const LIVE_TIMEOUT = 8000;
// Calling a fetched rate old after this many days, when the student's bank will have moved on
const LIVE_STALE_DAYS = 30;
const LIVE_FIRST = "Needs the internet once. Pathway keeps the rate for when you are offline.";
const LIVE_OLD = "This rate is more than a month old. Check again when you are online.";
// Offering "what if the taka falls" in these steps, up to this share
const FALL_STEP = 5;
const FALL_MAX = 30;
const FALL_LIMITS = { min: 0, max: FALL_MAX, step: FALL_STEP };
// Waiting this long after the last key press before redrawing the answer, so typing stays smooth
const TYPING_PAUSE = 250;
const CSS_MAX = 20;
const PROGRAMMES_MAX = 10;
const CURRENCY_WORDS = { USD: "US dollar", EUR: "euro", TRY: "Turkish lira", MYR: "Malaysian ringgit", NZD: "New Zealand dollar" };
const RATE_MODES = [["official", "Bangladesh Bank"], ["live", "Today's rate"], ["bank", "My bank's rate"]];
const GROUP_WORDS = { tests: "Tests", apply: "Applications", aid: "Aid forms", after: "After an offer", own: "Your own items" };

function emptySaved(country) {
  return { version: SAVED_VERSION, country, rateMode: "official", live: null, bank: {}, saved: null, monthly: null, fall: 0, items: {}, own: [] };
}

// Keeping only the parts of saved data that still make sense, so damaged data can never break the tool
function cleanSaved(value, countries) {
  if (!value || value.version !== SAVED_VERSION) {
    return null;
  }
  const clean = emptySaved(countries.includes(value.country) ? value.country : countries[0]);
  clean.rateMode = RATE_MODES.some(([mode]) => mode === value.rateMode) ? value.rateMode : "official";
  clean.live = value.live && typeof value.live.on === "string" && value.live.rates && typeof value.live.rates === "object" ? value.live : null;
  clean.bank = value.bank && typeof value.bank === "object" ? Object.fromEntries(Object.entries(value.bank).filter(([, rate]) => typeof rate === "number" && rate > 0)) : {};
  clean.saved = typeof value.saved === "number" ? value.saved : null;
  clean.monthly = typeof value.monthly === "number" ? value.monthly : null;
  clean.fall = Number.isInteger(value.fall) && value.fall >= 0 && value.fall <= FALL_MAX ? value.fall : 0;
  clean.items = value.items && typeof value.items === "object" ? value.items : {};
  clean.own = Array.isArray(value.own) ? value.own.filter((item) => item && typeof item.id === "string") : [];
  return clean;
}

function amountWords(item) {
  return item.currency === "BDT" ? takaText(item.amount) : moneyText(item.currency, item.amount);
}

// Writing an amount with its taka figure after it, softer, as the roadmaps write money, kept together
// so the two read as one line and wrap only when the screen is too narrow
function amountHtml(item) {
  if (typeof item.amount !== "number") {
    return `<span class="money-price soft">Not entered</span>`;
  }
  if (item.currency === "BDT") {
    return `<span class="money-price"><span class="money-amount">${esc(takaText(item.amount))}</span></span>`;
  }
  return `<span class="money-price"><span class="money-amount">${esc(moneyText(item.currency, item.amount))}</span> <span class="approx">(about ${esc(takaText(item.taka))})</span></span>`;
}

// Naming what a payment is counted for when it is paid more than once: sittings, colleges or programmes
function countWords(item) {
  if (!(item.count > 1)) {
    return "";
  }
  const noun = item.group === "tests" ? "sittings" : item.group === "aid" ? "colleges" : "programmes";
  return `${item.count} ${noun}`;
}

function sumOfTaka(items) {
  return items.filter((item) => item.counted && typeof item.taka === "number").reduce((sum, item) => sum + item.taka, 0);
}

export async function createTool(host) {
  const [data, facts, countryList] = await Promise.all([host.fetchJson("tools/money.json"), host.facts(), host.countries()]);
  const codes = countryList.map((item) => item.code);
  const state = { saved: emptySaved(codes[0]), list: new Set(), folds: new Set(), message: "", busy: false };
  let body = null;
  let typing = 0;

  const country = () => state.saved.country;
  const countryName = (code = country()) => countryList.find((item) => item.code === code)?.name ?? code;

  async function loadList() {
    const list = await host.readData(`roadmap.list.${country()}`);
    state.list = new Set(Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  }

  async function load() {
    const saved = cleanSaved(await host.readData(SAVE_KEY), codes);
    const planCode = host.plan()?.code;
    state.saved = saved ?? emptySaved(codes.includes(planCode) ? planCode : codes[0]);
    if (!saved && codes.includes(planCode)) {
      state.saved.country = planCode;
    }
    await loadList();
  }

  function save() {
    host.save(SAVE_KEY, state.saved);
  }

  function mine(id) {
    state.saved.items[id] ??= {};
    return state.saved.items[id];
  }

  // Working everything out afresh from the plan, My list and the student's entries
  function compute() {
    const plan = host.plan();
    const raw = gatherItems({ data, facts, code: country(), plan, list: state.list, saved: state.saved });
    const currencies = [...new Set([data.countries[country()].currency, ...raw.map((item) => item.currency)])].filter((code) => RATE_FACTS[code]);
    const rates = ratesFor({ facts, mode: state.saved.rateMode, live: state.saved.live, bank: state.saved.bank, currencies });
    const items = priceItems(raw, rates, state.saved.fall / 100);
    const plain = priceItems(raw, rates, 0);
    const today = host.today();
    const { months, undated, undatedTotal } = monthsOf(items, today);
    const planned = plan?.code === country() && plan?.result?.status === "ok";
    return { plan, planned, items, plain, rates, currencies, months, undated, undatedTotal, today };
  }

  function summaryHtml(view) {
    const { items, planned, months, plan } = view;
    const applying = items.filter((item) => ["tests", "apply", "aid"].includes(item.group));
    const after = items.filter((item) => item.group === "after" || item.group === "own");
    const universities = items.filter((item) => item.group === "apply" && item.key).length;
    const applyTotal = sumOfTaka(applying);
    const afterTotal = sumOfTaka(after);
    const missing = items.filter((item) => item.group === "apply" && item.missing && item.counted).length;
    const paid = items.filter((item) => item.paid && item.counted && typeof item.taka === "number").reduce((sum, item) => sum + item.taka, 0);
    if (applyTotal === 0 && afterTotal === 0) {
      return `<p class="tool-answer">Nothing is counted yet.</p>
        <p class="tool-line">Add universities to My list in the ${esc(countryName())} roadmap, and set your tests under What is counted, to see what applying costs.</p>
        <button class="button-secondary is-compact" type="button" data-action="tool-roadmap">Open the ${esc(countryName())} roadmap</button>`;
    }
    const subject = universities > 0 ? `Applying to your ${universities === 1 ? "university" : `${universities} universities`}` : "Your tests and applications";
    const dated = months.filter((month) => month.items.some((item) => ["tests", "apply", "aid"].includes(item.group)));
    const span = dated.length === 0 ? "" : dated.length === 1 ? `, in ${formatMonth(dated[0].start)}` : `, from ${formatMonth(dated[0].start, { year: false })} to ${formatMonth(dated[dated.length - 1].start)}`;
    const lines = [];
    if (afterTotal > 0) {
      lines.push(`After an offer, about ${takaText(afterTotal)} more for your visa and arrival.`);
    }
    if (paid > 0) {
      lines.push(`${takaText(paid)} of this is paid.`);
    }
    if (missing > 0) {
      lines.push(`Not counted yet: ${missing === 1 ? "one fee" : `${missing} fees`} Pathway does not have. Enter ${missing === 1 ? "it" : "them"} under What is counted.`);
    }
    if (!planned) {
      lines.push(plan?.code && plan.code !== country()
        ? `Your plan is for ${countryName(plan.code)}, so these payments have no dates yet. Make a plan for ${countryName()} to place them in months.`
        : `Make a plan for ${countryName()} on the Plan tab to place these payments in months.`);
    }
    return `<p class="tool-answer">${esc(subject)} costs about <strong>${esc(takaText(applyTotal))}</strong>${esc(span)}.</p>
      ${lines.map((line) => `<p class="tool-line">${esc(line)}</p>`).join("")}`;
  }

  function rateLine(view) {
    const main = data.countries[country()].currency;
    const rate = view.rates[main];
    const mode = state.saved.rateMode;
    const detail = mode === "official" || rate.from === "bank-of-bangladesh"
      ? `Bangladesh Bank, ${formatDay(rate.on)}${infoButton([RATE_FACTS[main]])}`
      : rate.from === "live" ? `Rates by <a href="${LIVE_CREDIT}">Exchange Rate API</a>, ${esc(formatDay(readDay(rate.on)))}` : "Your bank's rate";
    return `<p class="tool-line money-rate"><span class="money-amount">৳${esc(rate.rate.toFixed(2))}</span> to the ${esc(CURRENCY_WORDS[main])}. <span class="soft">${detail}</span></p>`;
  }

  function liveButtonWords() {
    return state.busy ? "Checking" : state.saved.live ? "Check again" : "Check today's rate";
  }

  // Choosing the one line under the rate check: the outcome of the last check, or else what the
  // student needs to know about today's rate. One line in one place, so a check never moves the page
  function liveNote(today) {
    const live = state.saved.live;
    if (state.message) {
      return state.message;
    }
    if (!live) {
      return LIVE_FIRST;
    }
    return today - readDay(live.on) > LIVE_STALE_DAYS ? LIVE_OLD : "";
  }

  function rateHtml(view) {
    const mode = state.saved.rateMode;
    let extra = "";
    if (mode === "live") {
      extra = `<div class="money-rate-actions"><button class="button-secondary is-compact" type="button" data-action="tool-live">${liveButtonWords()}</button></div>`;
    } else if (mode === "bank") {
      extra = view.currencies.map((code) => numberField({ field: `bank.${code}`, value: state.saved.bank[code] ?? "", label: `Taka for one ${CURRENCY_WORDS[code]}`, prefix: "৳", placeholder: view.rates[code].from === "bank" ? "" : view.rates[code].rate.toFixed(2) })).join("")
        + `<p class="note">Your bank's rate for students is usually a little above Bangladesh Bank's. Where you leave a box empty, Pathway uses Bangladesh Bank's.</p>`;
    }
    return `${chips("rate", RATE_MODES, mode, "Exchange rate")}
      <div id="money-rate-line">${rateLine(view)}</div>${extra}
      <p class="note money-message" aria-live="polite">${mode === "live" ? esc(liveNote(view.today)) : ""}</p>`;
  }

  function itemRow(item) {
    const done = item.paid;
    return `<li class="money-item"><label class="roadmap-check money-check">
        <input class="station-input" type="checkbox" data-action="tool-paid" data-id="${esc(item.id)}"${done ? " checked" : ""}>
        <span class="roadmap-box" aria-hidden="true">${icon("tick")}</span>
        <span class="money-item-text"><span class="money-item-name">${esc(item.name)}${countWords(item) ? ` <span class="soft">${countWords(item)}</span>` : ""}</span>${amountHtml(item)}${done ? `<span class="visually-hidden">, paid</span>` : ""}</span>
      </label>${infoButton(item.refs)}</li>`;
  }

  function routeHtml(view) {
    const { months, undated, undatedTotal, today } = view;
    if (months.length === 0 && undated.length === 0) {
      return "";
    }
    const thisMonth = monthStart(today);
    const stops = months.map((month) => {
      const allPaid = month.items.every((item) => item.paid);
      const stateName = allPaid ? "done" : month.start === thisMonth ? "here" : "hollow";
      const label = month.start === thisMonth ? `This month, ${formatMonth(month.start)}` : formatMonth(month.start);
      return {
        state: stateName,
        html: `<div class="money-month-head"><p class="tool-stop-label">${esc(label)}</p><p class="money-month-total">${esc(takaText(month.total))}</p></div>
          <ul class="money-items">${month.items.map(itemRow).join("")}</ul>`,
      };
    });
    // Marking where the student is now when nothing falls due this month, so the line still says "you are here"
    const later = months.findIndex((month) => month.start > thisMonth);
    if (later !== -1 && !months.some((month) => month.start === thisMonth)) {
      stops.splice(later, 0, {
        state: "here",
        html: `<p class="tool-stop-label">This month, ${esc(formatMonth(thisMonth))}</p><p class="note money-quiet">Nothing is due this month.</p>`,
      });
    }
    if (undated.length > 0) {
      stops.push({
        state: "dashed",
        html: `<div class="money-month-head"><p class="tool-stop-label">Not dated yet</p><p class="money-month-total">${esc(takaText(undatedTotal))}</p></div>
          <ul class="money-items">${undated.map(itemRow).join("")}</ul>`,
      });
    }
    return `<h3 class="tool-heading">Month by month</h3>${stations(stops, { label: "Payments by month" })}
      <p class="note">Tick a payment when it is paid. A step marked done on your plan counts as paid.</p>`;
  }

  function countedBody() {
    const view = compute();
    const groups = ["tests", "apply", "aid", "after"].map((group) => {
      const items = view.plain.filter((item) => item.group === group);
      if (items.length === 0) {
        return "";
      }
      return `<div class="money-group"><h4 class="money-group-title">${GROUP_WORDS[group]}</h4><ul class="money-edit-list">${items.map(editRow).join("")}</ul></div>`;
    }).join("");
    const none = view.plain.every((item) => item.group !== "apply" || !item.key)
      ? `<p class="note">Universities come from My list in the ${esc(countryName())} roadmap.</p><button class="text-button" type="button" data-action="tool-roadmap">Open the ${esc(countryName())} roadmap</button>`
      : "";
    return `${groups}${none}${ownHtml()}`;
  }

  function headHtml(item) {
    return `<div class="money-edit-head"><span class="money-item-name">${esc(item.name)}</span>${typeof item.amount === "number" && item.counted !== false ? amountHtml(item) : ""}${infoButton(item.refs)}</div>`;
  }

  function aidNote(item) {
    return `<p class="note money-edit-note">${item.guessed ? "Pathway counted your universities on My list, because your plan says you need aid. " : ""}Each college says whether it asks for the CSS Profile.</p>`;
  }

  // Giving each count its limits in one place, for drawing the stepper and for moving it
  function countLimits(item) {
    return item.group === "aid" ? { min: 0, max: CSS_MAX, step: 1 } : item.perProgramme ? { min: 1, max: PROGRAMMES_MAX, step: 1 } : { min: 0, max: MAX_SITTINGS, step: 1 };
  }

  function countStepper(item, label) {
    return stepper({ field: `count.${item.id}`, value: item.count, ...countLimits(item), label, about: item.name, inline: true });
  }

  function editRow(item) {
    const head = headHtml(item);
    if (item.group === "tests") {
      return `<li class="money-edit" data-id="${esc(item.id)}">${head}${countStepper(item, "Sittings")}${item.note ? `<p class="note">${esc(item.note)}</p>` : ""}</li>`;
    }
    if (item.group === "aid") {
      return `<li class="money-edit" data-id="${esc(item.id)}">${head}${countStepper(item, "Colleges you send it to")}${aidNote(item)}</li>`;
    }
    const parts = [head];
    if (item.typedByStudent) {
      const currency = item.currency;
      parts.push(numberField({ field: `amount.${item.id}`, value: state.saved.items[item.id]?.amount ?? "", label: item.group === "apply" ? "Fee not in Pathway: enter it" : "Enter the amount", prefix: currency }));
    }
    if (item.perProgramme) {
      parts.push(countStepper(item, "Programmes"));
    }
    if (item.waivedByAid) {
      parts.push(`<p class="note">Counted as waived, because your plan says you will apply for financial aid and ${esc(item.name)} waives the fee for every aid applicant.</p>`);
    }
    if (item.group === "apply" && item.key) {
      parts.push(`<div class="money-waiver"><button type="button" class="chip" aria-pressed="${item.waived}" data-action="tool-waive" data-id="${esc(item.id)}">Fee waived</button>${item.waiver ? `<button class="text-button" type="button" data-action="tool-facts" data-facts="${esc(item.waiver)}">How to ask for a waiver</button>` : ""}</div>`);
    }
    if (item.note) {
      parts.push(`<p class="note">${esc(item.note)}</p>`);
    }
    return `<li class="money-edit" data-id="${esc(item.id)}">${parts.join("")}</li>`;
  }

  function ownHtml() {
    const main = data.countries[country()].currency;
    const rows = state.saved.own.map((item) => `<li class="money-edit money-own">
        ${numberField({ field: `own.${item.id}.amount`, value: item.amount ?? "", label: "Amount", prefix: item.currency === "BDT" ? "৳" : item.currency })}
        <label class="tool-field tool-text-field"><span class="field-label">What it is</span><input type="text" data-field="own.${esc(item.id)}.name" value="${esc(item.name ?? "")}" maxlength="60" placeholder="Flight to ${esc(countryName())}"></label>
        <div class="chips">${["BDT", main, "USD"].filter((code, index, all) => all.indexOf(code) === index).map((code) => `<button type="button" class="chip" aria-pressed="${item.currency === code}" data-action="tool-own-currency" data-id="${esc(item.id)}" data-value="${code}">${code === "BDT" ? "Taka" : code}</button>`).join("")}</div>
        <label class="date-field tool-field"><span class="field-label">Month</span><input type="month" data-field="own.${esc(item.id)}.month" value="${esc(item.month ?? "")}"></label>
        <button class="text-button" type="button" data-action="tool-own-remove" data-id="${esc(item.id)}">Remove this item</button>
      </li>`).join("");
    return `<div class="money-group"><h4 class="money-group-title">${GROUP_WORDS.own}</h4>${rows ? `<ul class="money-edit-list">${rows}</ul>` : `<p class="note">Add anything else you will pay, such as a flight or a deposit.</p>`}
      <button class="button-secondary is-compact" type="button" data-action="tool-own-add">Add an item</button></div>`;
  }

  function savingResult() {
    const view = compute();
    const saved = state.saved.saved ?? 0;
    const monthly = state.saved.monthly;
    const plan = savingsPlan(view.months, view.today, saved, monthly ?? 0);
    const lines = [];
    if (plan.due === 0) {
      lines.push("Nothing is due on your plan's dates yet.");
    } else if (plan.needed === 0) {
      lines.push(`What you have saved already covers every payment on your plan's dates.`);
    } else {
      lines.push(`Saving <strong>${esc(takaText(plan.needed))} a month</strong>, starting this month, covers every payment on time.`);
      if (monthly !== null) {
        lines.push(plan.short
          ? `With ${esc(takaText(monthly))} a month, you would be about ${esc(takaText(plan.short.gap))} short in ${esc(formatMonth(plan.short.start))}.`
          : `${esc(takaText(monthly))} a month is enough for every payment on time.`);
      }
    }
    if (view.undatedTotal > 0) {
      lines.push(`${esc(takaText(view.undatedTotal))} has no date yet, so it is not in this figure.`);
    }
    return lines.map((line) => `<p class="tool-line">${line}</p>`).join("");
  }

  function savingBody() {
    return `${numberField({ field: "saved", value: state.saved.saved ?? "", label: "Saved already", prefix: "৳" })}
      ${numberField({ field: "monthly", value: state.saved.monthly ?? "", label: "You can save each month", prefix: "৳", note: "Leave it empty to see the amount you would need." })}
      <div id="money-saving" aria-live="polite">${savingResult()}</div>`;
  }

  function whatIfResult() {
    const view = compute();
    const fall = state.saved.fall;
    const before = sumOfTaka(view.plain);
    const after = sumOfTaka(view.items);
    if (fall === 0) {
      return `<p class="tool-line">Raise the figure to see how a weaker taka changes your total.</p>`;
    }
    return `<p class="tool-line">If the taka falls ${fall}%, everything counted here costs about <strong>${esc(takaText(after))}</strong> instead of ${esc(takaText(before))}. Fees charged in taka stay the same.</p>`;
  }

  function whatIfBody() {
    return `${stepper({ field: "fall", value: state.saved.fall, ...FALL_LIMITS, label: "Taka falls by", suffix: "%" })}
      <div id="money-whatif" aria-live="polite">${whatIfResult()}</div>`;
  }

  function showBody() {
    const show = data.countries[country()].show;
    const ctx = { facts, today: host.today(), cycle: data.cycle };
    return `<p class="reading">${inline(show.text, ctx)}${infoButton(show.cite)}</p>
      <p class="reading">Never borrow money only to show it. Officers can ask where it came from, and false documents can lead to a refusal.</p>`;
  }

  function notIncludedBody() {
    return `<ul class="tool-plain-list is-dotted">${data.notIncluded.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>`;
  }

  const FOLDS = {
    counted: { title: "What is counted", summary: () => "Tests, fees, waivers and your own items", body: countedBody },
    saving: { title: "Saving for it", summary: () => "How much to set aside each month", body: savingBody },
    whatif: { title: "What if the taka falls?", summary: () => "See how the exchange rate changes the total", body: whatIfBody },
    show: { title: "Money you show, not spend", summary: () => "Proof of money for the visa or permit", body: showBody },
    excluded: { title: "Not included", summary: () => "Costs to plan for yourself", body: notIncludedBody },
  };

  function foldsHtml() {
    return Object.entries(FOLDS).map(([id, part]) => fold({ id, title: part.title, summary: esc(part.summary()), open: state.folds.has(id), body: part.body })).join("");
  }

  function render() {
    const view = compute();
    const countries = countryList.map((item) => [item.code, item.name]);
    const line = countryList.find((item) => item.code === country())?.line;
    body.style.setProperty("--route", line ? `var(${line})` : "var(--line)");
    body.innerHTML = `<p class="lead tool-lead">What applying and getting your visa cost in taka, month by month, and how to save for it.</p>
      ${chips("country", countries, country(), "Country")}
      <div class="tool-result" id="money-summary" aria-live="polite">${summaryHtml(view)}</div>
      <div class="money-rate-box">${rateHtml(view)}</div>
      <div id="money-route">${routeHtml(view)}</div>
      ${foldsHtml()}
      <div class="money-copy"><button class="button-secondary is-compact" type="button" data-action="tool-copy">Copy as text</button><span class="note" id="money-copied" aria-live="polite"></span></div>`;
  }

  // Redrawing only the answers, never the fields being typed in, so the keyboard stays open
  function renderLive() {
    const view = compute();
    body.querySelector("#money-summary").innerHTML = summaryHtml(view);
    body.querySelector("#money-route").innerHTML = routeHtml(view);
    const line = body.querySelector("#money-rate-line");
    if (line) {
      line.innerHTML = rateLine(view);
    }
    const saving = body.querySelector("#money-saving");
    if (saving) {
      saving.innerHTML = savingResult();
    }
    const whatIf = body.querySelector("#money-whatif");
    if (whatIf) {
      whatIf.innerHTML = whatIfResult();
    }
  }

  function redraw(focusSelector) {
    render();
    if (focusSelector) {
      body.querySelector(focusSelector)?.focus({ preventScroll: true });
    }
  }

  // Showing the state of a rate check in place: the button's words and the line under it. Nothing else
  // changes, so nothing on the screen moves, and a screen reader hears the new line
  function showCheck() {
    const button = body.querySelector('[data-action="tool-live"]');
    const note = body.querySelector(".money-message");
    if (!button || !note) {
      redraw();
      return;
    }
    button.textContent = liveButtonWords();
    note.textContent = liveNote(host.today());
  }

  function offlineWords() {
    return `Your phone is offline, so Pathway is using ${state.saved.live ? "the rate it saved before" : "Bangladesh Bank's rate"}. Check again when you are online.`;
  }

  // Fetching today's rates from the open rate service, once, and keeping them for offline use. A new
  // rate changes every taka figure, so the whole plan is redrawn; a failed check changes only its line
  async function fetchLive() {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), LIVE_TIMEOUT);
    try {
      const response = await fetch(LIVE_URL, { signal: controller.signal, cache: "no-store" });
      const answer = await response.json();
      if (answer.result !== "success" || typeof answer.rates?.BDT !== "number") {
        throw new Error("No rates in the answer");
      }
      const rates = {};
      for (const code of Object.keys(RATE_FACTS)) {
        if (typeof answer.rates[code] === "number" && answer.rates[code] > 0) {
          rates[code] = answer.rates.BDT / answer.rates[code];
        }
      }
      const on = new Date(answer.time_last_update_unix * 1000);
      state.saved.live = { on: isoDay(dayFromParts(on.getUTCFullYear(), on.getUTCMonth() + 1, on.getUTCDate())), rates };
      state.message = "Today's rate is saved on this phone.";
      state.busy = false;
      save();
      redraw(`[data-action="tool-live"]`);
    } catch {
      state.message = `Pathway could not reach the rate service, so it is using ${state.saved.live ? "the rate it saved before" : "Bangladesh Bank's rate"}.`;
      state.busy = false;
      showCheck();
    } finally {
      window.clearTimeout(timer);
    }
  }

  // Checking today's rate when the student asks. With the phone offline, the answer comes at once
  // and no request is made. A tap while a check runs is ignored
  async function checkLive() {
    if (state.busy) {
      return;
    }
    if (navigator.onLine === false) {
      state.message = offlineWords();
      showCheck();
      return;
    }
    state.busy = true;
    state.message = "";
    showCheck();
    await fetchLive();
  }

  function copyText() {
    const view = compute();
    const lines = [`Money plan for ${countryName()}`];
    const main = data.countries[country()].currency;
    lines.push(`Rate: ৳${view.rates[main].rate.toFixed(2)} to the ${CURRENCY_WORDS[main]}`);
    for (const month of view.months) {
      lines.push("", `${formatMonth(month.start)}: ${takaText(month.total)}`);
      lines.push(...month.items.map((item) => `- ${item.name}: ${amountWords(item)}${item.currency === "BDT" ? "" : ` (about ${takaText(item.taka)})`}${item.paid ? ", paid" : ""}`));
    }
    if (view.undated.length > 0) {
      lines.push("", `Not dated yet: ${takaText(view.undatedTotal)}`);
      lines.push(...view.undated.map((item) => `- ${item.name}: ${amountWords(item)}`));
    }
    lines.push("", `Total: about ${takaText(sumOfTaka(view.items))}`);
    return lines.join("\n");
  }

  async function copy() {
    const text = copyText();
    let done;
    try {
      await navigator.clipboard.writeText(text);
      done = true;
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      Object.assign(area.style, { position: "absolute", left: "-9999px", top: "0" });
      body.append(area);
      area.select();
      done = document.execCommand("copy");
      area.remove();
    }
    body.querySelector("#money-copied").textContent = done ? "Copied. Paste it into a message." : "Your phone did not allow copying.";
  }

  // Moving a count or the "what if" figure, then showing the new value in place and redrawing only
  // the answers that depend on it, so focus stays on the button just tapped
  function stepField(field, delta, tapped) {
    if (field === "fall") {
      state.saved.fall = stepValue(state.saved.fall, delta, FALL_LIMITS);
      save();
      updateStepper(body, field, state.saved.fall, { ...FALL_LIMITS, suffix: "%" }, tapped);
      renderLive();
      return;
    }
    const id = field.slice("count.".length);
    const item = compute().plain.find((one) => one.id === id);
    if (!item) {
      return;
    }
    const limits = countLimits(item);
    mine(id).count = stepValue(item.count, delta, limits);
    save();
    updateStepper(body, field, mine(id).count, limits, tapped);
    const now = compute().plain.find((one) => one.id === id);
    const row = body.querySelector(`.money-edit[data-id="${CSS.escape(id)}"]`);
    if (row && now) {
      row.querySelector(".money-edit-head").outerHTML = headHtml(now);
      row.querySelector(".money-edit-note")?.replaceWith(document.createRange().createContextualFragment(aidNote(now)));
    }
    renderLive();
  }

  return {
    async mount(element) {
      body = element;
      await load();
      render();
    },
    async click(trigger) {
      const { action, field, value, id } = trigger.dataset;
      switch (action) {
        case "tool-pick": {
          if (field === "country") {
            state.saved.country = value;
            await loadList();
          } else if (field === "rate") {
            state.saved.rateMode = value;
            state.message = "";
          }
          save();
          // Choosing today's rate for the first time checks it at once. The check's state is drawn
          // with everything else, so the screen changes once on the tap and once with the answer
          const checking = field === "rate" && value === "live" && !state.saved.live && !state.busy && navigator.onLine !== false;
          if (field === "rate" && value === "live" && !state.saved.live && navigator.onLine === false) {
            state.message = offlineWords();
          }
          state.busy ||= checking;
          redraw(`[data-action="tool-pick"][data-field="${CSS.escape(field)}"][data-value="${CSS.escape(value)}"]`);
          if (checking) {
            await fetchLive();
          }
          break;
        }
        case "tool-live":
          await checkLive();
          break;
        case "tool-step":
          stepField(field, Number(trigger.dataset.delta), trigger);
          break;
        case "tool-paid":
          mine(id).paid = trigger.checked;
          save();
          renderLive();
          body.querySelector(`[data-action="tool-paid"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
          break;
        case "tool-waive":
          mine(id).waived = !compute().plain.find((one) => one.id === id)?.waived;
          save();
          redraw(`[data-action="tool-waive"][data-id="${CSS.escape(id)}"]`);
          break;
        case "tool-own-add": {
          const ownId = `i${Date.now().toString(36)}`;
          state.saved.own.push({ id: ownId, name: "", amount: null, currency: "BDT", month: "" });
          save();
          redraw(`[data-field="own.${ownId}.amount"]`);
          break;
        }
        case "tool-own-remove":
          state.saved.own = state.saved.own.filter((item) => item.id !== id);
          save();
          redraw(`[data-action="tool-own-add"]`);
          break;
        case "tool-own-currency": {
          const item = state.saved.own.find((one) => one.id === id);
          if (item) {
            item.currency = value;
            save();
            redraw(`[data-action="tool-own-currency"][data-id="${CSS.escape(id)}"][data-value="${CSS.escape(value)}"]`);
          }
          break;
        }
        case "tool-roadmap":
          host.openRoadmap(country(), "ways-to-study");
          break;
        case "tool-copy":
          await copy();
          break;
        case "tool-fold": {
          const fid = trigger.dataset.fold;
          const opening = !state.folds.has(fid);
          if (opening) {
            state.folds.add(fid);
          } else {
            state.folds.delete(fid);
          }
          toggleFold(body, fid, opening, FOLDS[fid].body);
          break;
        }
        case "tool-facts":
          await host.showFacts(trigger.dataset.facts.split(" "));
          break;
        default:
          break;
      }
    },
    input(event) {
      const field = event.target.dataset?.field;
      if (!field) {
        return;
      }
      const text = event.target.value;
      if (field === "saved" || field === "monthly") {
        state.saved[field] = readNumber(text);
      } else if (field.startsWith("bank.")) {
        const number = readNumber(text);
        if (number && number > 0) {
          state.saved.bank[field.slice(5)] = number;
        } else {
          delete state.saved.bank[field.slice(5)];
        }
      } else if (field.startsWith("amount.")) {
        mine(field.slice(7)).amount = readNumber(text);
      } else if (field.startsWith("own.")) {
        const [, ownId, part] = field.split(".");
        const item = state.saved.own.find((one) => one.id === ownId);
        if (!item) {
          return;
        }
        item[part] = part === "amount" ? readNumber(text) : part === "month" ? (/^\d{4}-\d{2}$/.test(text) ? text : "") : text.slice(0, 60);
      } else {
        return;
      }
      save();
      window.clearTimeout(typing);
      typing = window.setTimeout(renderLive, TYPING_PAUSE);
    },
    async refresh() {
      await loadList();
      renderLive();
    },
    leave() {
      window.clearTimeout(typing);
    },
  };
}
