import { readSetting, writeSetting, setBarStyle } from "./native.js";
import { ms, token, reducedMotion } from "./motion.js";

const SETTING_KEY = "theme";
const CACHE_KEY = "pathway.theme";
const CHOICES = ["system", "light", "dark"];
const ICON_FOR = { system: "theme-system", light: "theme-light", dark: "theme-dark" };
const LABEL_FOR = { system: "Match phone", light: "Light", dark: "Dark" };

// Starting the wave at half the width of the selected station, so it grows out of the ring itself
const RING_RADIUS = 11;
const SEARCH_STEPS = 24;

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
let choice = "system";
let barTimer = 0;
let quietTimer = 0;

function resolve(value) {
  if (value === "system") {
    return darkQuery.matches ? "dark" : "light";
  }
  return value;
}

function paintPage(resolved) {
  document.documentElement.dataset.theme = resolved;
}

// Changing the theme with CSS fades switched off (base.css), so the wave is the only motion. Left
// on, every button and tab would fade between the two colour sets, and the phone would redraw
// them on every frame of the wave. The fades return once the wave has finished
function repaint(resolved) {
  const page = document.documentElement;
  page.classList.add("is-retheming");
  paintPage(resolved);
  window.clearTimeout(quietTimer);
  quietTimer = window.setTimeout(() => page.classList.remove("is-retheming"), ms("--dur-reveal"));
}

function paintBars(resolved) {
  window.clearTimeout(barTimer);
  setBarStyle(resolved === "dark");
}

function syncControls() {
  for (const button of document.querySelectorAll(".theme-button")) {
    button.querySelector("use").setAttribute("href", `icons/sprite.svg#${ICON_FOR[choice]}`);
    button.setAttribute("aria-label", `Appearance, currently ${LABEL_FOR[choice]}`);
  }

  const radio = document.querySelector(`input[name="theme"][value="${choice}"]`);
  radio.checked = true;

  const note = document.querySelector("[data-system-note]");
  note.textContent = darkQuery.matches ? "Your phone is using dark mode" : "Your phone is using light mode";
}

function remember(value) {
  writeSetting(SETTING_KEY, value);
  try {
    localStorage.setItem(CACHE_KEY, value);
  } catch {
    // Losing only the start-up copy; Preferences still holds the choice
  }
}

// Finding when a cubic-bezier curve reaches a given progress, so the clock icons can change
// colour at the exact moment the wave passes under them
function timeForProgress(curve, progress) {
  const [x1, y1, x2, y2] = curve.match(/[\d.]+/g).map(Number);
  const point = (a, b, s) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < SEARCH_STEPS; step += 1) {
    const middle = (low + high) / 2;
    if (point(y1, y2, middle) < progress) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return point(x1, x2, (low + high) / 2);
}

function fade(resolved) {
  const transition = document.startViewTransition(() => repaint(resolved));
  paintBars(resolved);
  transition.ready
    .then(() => {
      document.documentElement.animate(
        { opacity: [0, 1] },
        { duration: ms("--dur-enter"), easing: token("--ease-out"), pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // Ignoring a skipped transition, which has already applied the theme
    });
}

// Growing the new theme outward from the station that was tapped, like lights coming on across a map
function reveal(resolved, origin) {
  if (!document.startViewTransition) {
    repaint(resolved);
    paintBars(resolved);
    return;
  }
  if (reducedMotion() || !origin) {
    fade(resolved);
    return;
  }

  const duration = ms("--dur-reveal");
  const curve = token("--ease-reveal");
  const radius = Math.hypot(
    Math.max(origin.x, window.innerWidth - origin.x),
    Math.max(origin.y, window.innerHeight - origin.y)
  );

  // Switching the status bar icons when the wave's edge has covered this distance, at the bar's middle
  const toStatusBar = Math.hypot(origin.x - window.innerWidth / 2, origin.y);
  const progress = Math.min(1, Math.max(0, (toStatusBar - RING_RADIUS) / (radius - RING_RADIUS)));
  window.clearTimeout(barTimer);
  barTimer = window.setTimeout(() => setBarStyle(resolved === "dark"), timeForProgress(curve, progress) * duration);

  const transition = document.startViewTransition(() => repaint(resolved));
  transition.ready
    .then(() => {
      document.documentElement.animate(
        {
          clipPath: [
            `circle(${RING_RADIUS}px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        },
        { duration, easing: curve, pseudoElement: "::view-transition-new(root)" }
      );
    })
    .catch(() => {
      // Ignoring a skipped transition, which has already applied the theme; the icons still follow on their timer
    });
}

function centreOf(element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function choose(next, origin) {
  if (!CHOICES.includes(next) || next === choice) {
    return;
  }
  const before = document.documentElement.dataset.theme;
  choice = next;
  remember(next);
  syncControls();

  const after = resolve(next);
  if (after !== before) {
    reveal(after, origin);
  }
}

export async function initTheme() {
  const saved = await readSetting(SETTING_KEY);
  let cached = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // Keeping the default when storage is unavailable, as there is no start-up copy
  }

  // Trusting Preferences first, and falling back to the start-up copy only if it is empty
  if (CHOICES.includes(saved)) {
    choice = saved;
  } else if (CHOICES.includes(cached)) {
    choice = cached;
    writeSetting(SETTING_KEY, cached);
  }

  const resolved = resolve(choice);
  paintPage(resolved);
  paintBars(resolved);
  syncControls();

  for (const radio of document.querySelectorAll('input[name="theme"]')) {
    radio.addEventListener("change", () => {
      choose(radio.value, centreOf(radio.nextElementSibling));
    });
  }

  darkQuery.addEventListener("change", () => {
    syncControls();
    if (choice === "system") {
      reveal(resolve("system"), null);
    }
  });
}
