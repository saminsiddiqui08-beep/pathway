// Drawing the parts every Toolkit tool shares: chips, steppers, number fields, folded parts and the
// short line of stations a result is drawn on, so every tool looks and behaves alike
import { concealClose, followersOf, revealOpen, shownPart } from "../../app/reveal.js";
import { esc, glue } from "../timeline/words.js";

export function icon(name, extra = "") {
  return `<svg class="icon${extra}" aria-hidden="true"><use href="icons/sprite.svg#${name}"></use></svg>`;
}

// Offering one choice from a few as chips; options are [value, label] pairs
export function chips(field, options, chosen, label) {
  return `<div class="tool-field" role="group" aria-labelledby="${esc(field)}-label">
    <p class="field-label" id="${esc(field)}-label">${esc(label)}</p>
    <div class="chips">${options.map(([value, words]) => `<button type="button" class="chip" aria-pressed="${value === chosen}" data-action="tool-pick" data-field="${esc(field)}" data-value="${esc(value)}">${esc(words)}</button>`).join("")}</div>
  </div>`;
}

// Showing a number with buttons to lower and raise it by one step, as the Plan tab's questions do. An
// inline stepper sits on one line with its label, for short lists of counts; "about" names what is
// counted for screen readers when the label alone would not. A score the student has not given yet
// is null and reads "Not set", so no number on screen is ever a guess
const UNSET = "Not set";

function valueText(value, digits, suffix) {
  return value === null ? UNSET : `${value.toFixed(digits)}${suffix}`;
}

export function stepper({ field, value, min, max, step, digits = 0, label, about = "", suffix = "", note = "", inline = false }) {
  const unset = value === null;
  return `<div class="tool-field${inline ? " is-inline" : ""}" data-stepper="${esc(field)}">
    <p class="field-label" id="${esc(field)}-label">${about ? `<span class="visually-hidden">${esc(about)}, </span>` : ""}${esc(label)}</p>
    <div class="stepper" role="group" aria-labelledby="${esc(field)}-label">
      <button type="button" class="stepper-button" data-action="tool-step" data-field="${esc(field)}" data-delta="-1" aria-label="Lower by ${step}${esc(suffix)}"${!unset && value <= min ? " disabled" : ""}>${icon("minus")}</button>
      <output class="stepper-value${unset ? " is-unset" : ""}" aria-live="polite">${esc(valueText(value, digits, suffix))}</output>
      <button type="button" class="stepper-button" data-action="tool-step" data-field="${esc(field)}" data-delta="1" aria-label="Raise by ${step}${esc(suffix)}"${!unset && value >= max ? " disabled" : ""}>${icon("plus")}</button>
    </div>
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
  </div>`;
}

// Showing a stepper's new value in place, so the button keeps focus and a screen reader hears the
// number. When the button just tapped has reached its limit, focus moves to the other one
export function updateStepper(scope, field, value, { min, max, digits = 0, suffix = "" }, tapped) {
  const element = scope.querySelector(`[data-stepper="${CSS.escape(field)}"]`);
  if (!element) {
    return;
  }
  const output = element.querySelector(".stepper-value");
  output.textContent = valueText(value, digits, suffix);
  output.classList.toggle("is-unset", value === null);
  const [lower, raise] = element.querySelectorAll(".stepper-button");
  lower.disabled = value !== null && value <= min;
  raise.disabled = value !== null && value >= max;
  if (tapped?.disabled) {
    (tapped === lower ? raise : lower).focus({ preventScroll: true });
  }
}

// Moving a stepper's value by one step, kept inside its limits and free of rounding dust. The first
// tap on a score not yet set starts it at a typical value instead of the bottom of the scale
export function stepValue(value, delta, { min, max, step, digits = 0, start = min }) {
  if (value === null) {
    return start;
  }
  const next = Math.min(max, Math.max(min, value + delta * step));
  return Number(next.toFixed(digits));
}

// Asking for a number the student types, such as a fee or a monthly saving, with the phone's number pad
export function numberField({ field, value, label, prefix = "", note = "", placeholder = "" }) {
  return `<label class="tool-field tool-number">
    <span class="field-label">${esc(label)}</span>
    <span class="tool-number-box">${prefix ? `<span class="tool-number-prefix" aria-hidden="true">${esc(prefix)}</span>` : ""}<input type="text" inputmode="decimal" autocomplete="off" data-field="${esc(field)}" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}"></span>
    ${note ? `<span class="note">${esc(note)}</span>` : ""}
  </label>`;
}

// Reading a typed number, allowing the commas people type in large amounts; anything else is no number
export function readNumber(text) {
  const plain = String(text ?? "").replace(/[,\s৳]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(plain)) {
    return null;
  }
  return Number(plain);
}

export function infoButton(refs) {
  if (!refs || refs.length === 0) {
    return "";
  }
  return `<button class="info-button" type="button" data-action="tool-facts" data-facts="${esc(refs.join(" "))}" aria-label="Where this comes from">${icon("info")}</button>`;
}

// Putting the information button after a line's last word, so it never sits alone on a line
export function withInfo(html, refs) {
  return glue(html, infoButton(refs));
}

// Drawing a folded part: a title the student taps, and the content below it only once it is open
export function fold({ id, title, summary = "", open, body }) {
  return `<section class="tool-fold${open ? " is-open" : ""}" data-fold="${esc(id)}">
    <h3 class="tool-fold-head"><button class="tool-fold-toggle" type="button" data-action="tool-fold" data-fold="${esc(id)}" aria-expanded="${open}">
      <span class="tool-fold-text"><span class="tool-fold-title">${esc(title)}</span>${summary ? `<span class="tool-fold-summary">${summary}</span>` : ""}</span>${icon("chevron", " tool-fold-chevron")}
    </button></h3>
    ${open ? `<div class="tool-fold-body">${body()}</div>` : ""}
  </section>`;
}

// Opening or closing a folded part in place, with the same movement as a roadmap section
export function toggleFold(scope, id, opening, body) {
  const element = scope.querySelector(`.tool-fold[data-fold="${CSS.escape(id)}"]`);
  if (!element) {
    return;
  }
  const followers = followersOf(element, scope);
  element.classList.toggle("is-open", opening);
  element.querySelector(".tool-fold-toggle").setAttribute("aria-expanded", String(opening));
  if (opening) {
    element.insertAdjacentHTML("beforeend", `<div class="tool-fold-body">${body()}</div>`);
    revealOpen(element.lastElementChild, followers);
  } else {
    concealClose(shownPart(element, ".tool-fold-body"), followers);
  }
}

// Drawing a short line of stations; each stop gives its state ("done", "here", "hollow" or "dashed")
// in words for screen readers as well as in its shape
const STOP_WORDS = { done: "Done", here: "", hollow: "", dashed: "" };
export function stations(stops, { label = "" } = {}) {
  return `<ol class="tool-route"${label ? ` aria-label="${esc(label)}"` : ""}>${stops.map((stop) => `<li class="tool-route-stop is-${stop.state}"><span class="tool-marker" aria-hidden="true">${stop.state === "done" ? icon("tick") : ""}</span>
      <div class="tool-stop-body">${STOP_WORDS[stop.state] ? `<span class="visually-hidden">${STOP_WORDS[stop.state]}: </span>` : ""}${stop.html}</div></li>`).join("")}</ol>`;
}

// Putting focus back on the control just tapped after its part of the screen is redrawn
export function refocus(scope, action, field, value) {
  const selector = `[data-action="${action}"][data-field="${CSS.escape(field)}"]${value === undefined ? "" : `[data-value="${CSS.escape(String(value))}"]`}`;
  scope.querySelector(selector)?.focus({ preventScroll: true });
}
