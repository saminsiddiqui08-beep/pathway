const cache = new Map();
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// Holding Android's "Remove animations" setting as MainActivity last reported it. The WebView reads
// the setting only when Pathway starts, so without this a change made while Pathway is open would
// apply only after a restart. Null until Android reports a change
let phoneSetting = null;

// Reading timing values from tokens.css once, so CSS and JavaScript can never disagree
export function token(name) {
  if (!cache.has(name)) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, value);
  }
  return cache.get(name);
}

export function ms(name) {
  return Number.parseFloat(token(name));
}

export function reducedMotion() {
  return phoneSetting ?? reducedQuery.matches;
}

// Marking the page, so the CSS follows the same setting as the JavaScript
function markPage() {
  document.documentElement.dataset.motion = reducedMotion() ? "reduced" : "full";
}

markPage();
reducedQuery.addEventListener("change", () => {
  phoneSetting = null;
  markPage();
});
window.addEventListener("pathwayMotion", (event) => {
  if (typeof event.reduced === "boolean") {
    phoneSetting = event.reduced;
    markPage();
  }
});
