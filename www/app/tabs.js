import { ms, token, reducedMotion } from "./motion.js";

const ORDER = ["plan", "countries", "scholarships", "toolkit"];
const TRAVEL = 24;
const LEAVE_FADE_END = 0.3;
const ENTER_FADE_START = 0.12;
const STRETCH = 1.7;
const STRETCH_PEAK = 0.35;
const WARM_TIMEOUT = 700;

const tabbar = document.querySelector(".tabbar");
const indicator = tabbar.querySelector(".tab-indicator");
let current = "plan";
let activeSwap = null;
let warmed = null;
let warmTimer = 0;

function screenFor(name) {
  return document.querySelector(`[data-screen="${name}"]`);
}

function tabFor(name) {
  return tabbar.querySelector(`[data-tab="${name}"]`);
}

function indicatorX(name) {
  const bar = tabbar.getBoundingClientRect();
  const tab = tabFor(name).getBoundingClientRect();
  return tab.left - bar.left + tab.width / 2 - indicator.offsetWidth / 2;
}

function placeIndicator() {
  indicator.style.transform = `translateX(${indicatorX(current)}px)`;
}

function promote(screen) {
  screen.style.willChange = "transform, opacity";
}

function demote(screen) {
  screen.style.willChange = "";
}

// Preparing the next screen the moment a finger lands, about a tenth of a second before the tap
// registers, so the first frame of motion never waits for the phone to draw a whole screen
function warm(name) {
  if (name === current || name === warmed || activeSwap || reducedMotion()) {
    return;
  }
  cool();
  const screen = screenFor(name);
  screen.hidden = false;
  screen.style.opacity = "0";
  screen.style.pointerEvents = "none";
  promote(screen);
  promote(screenFor(current));
  warmed = name;
  warmTimer = window.setTimeout(cool, WARM_TIMEOUT);
}

// Undoing a warm-up when the touch turned into a scroll or a press elsewhere
function cool() {
  window.clearTimeout(warmTimer);
  if (!warmed) {
    return;
  }
  const screen = screenFor(warmed);
  screen.style.opacity = "";
  screen.style.pointerEvents = "";
  if (warmed !== current) {
    screen.hidden = true;
    demote(screen);
  }
  demote(screenFor(current));
  warmed = null;
}

// Ending the running swap at once, cleanup included, so a fast second tap always starts clean
function settle() {
  if (!activeSwap) {
    return;
  }
  const swap = activeSwap;
  activeSwap = null;
  for (const animation of swap.animations) {
    if (animation.playState === "running" || animation.playState === "paused") {
      animation.finish();
    }
    animation.cancel();
  }
  swap.cleanup();
}

function glide(fromX, toX) {
  indicator.style.transform = `translateX(${toX}px)`;
  const moving = indicator.animate(
    { transform: [`translateX(${fromX}px)`, `translateX(${toX}px)`] },
    { duration: ms("--dur-swap"), easing: token("--ease-out") }
  );

  // Stretching the bar as it leaves, like a train pulling away, then letting it settle at the next stop
  const stretching = indicator.animate(
    [
      { transform: "scaleX(1)" },
      { transform: `scaleX(${STRETCH})`, offset: STRETCH_PEAK },
      { transform: "scaleX(1)" },
    ],
    { duration: ms("--dur-swap"), easing: token("--ease-stretch"), pseudoElement: "::before" }
  );
  return [moving, stretching];
}

function swapScreens(from, to, fromX, toX) {
  const leaving = screenFor(from);
  const arriving = screenFor(to);
  const direction = Math.sign(ORDER.indexOf(to) - ORDER.indexOf(from));

  arriving.hidden = false;
  arriving.style.opacity = "";
  arriving.style.pointerEvents = "";

  if (reducedMotion()) {
    leaving.hidden = true;
    indicator.style.transform = `translateX(${toX}px)`;
    const fade = arriving.animate({ opacity: [0, 1] }, { duration: ms("--dur-leave"), easing: "linear" });
    activeSwap = { animations: [fade], cleanup: () => { } };
  } else {
    promote(leaving);
    promote(arriving);

    // Moving both screens the same distance on the same curve, so the swap reads as one camera move
    const timing = { duration: ms("--dur-swap"), easing: token("--ease-out") };
    const leave = leaving.animate(
      [
        { transform: "translateX(0)", opacity: 1 },
        { opacity: 0, offset: LEAVE_FADE_END },
        { transform: `translateX(${-direction * TRAVEL}px)`, opacity: 0 },
      ],
      { ...timing, fill: "forwards" }
    );
    const enter = arriving.animate(
      [
        { transform: `translateX(${direction * TRAVEL}px)`, opacity: 0 },
        { opacity: 0, offset: ENTER_FADE_START },
        { transform: "translateX(0)", opacity: 1 },
      ],
      timing
    );

    activeSwap = {
      animations: [leave, enter, ...glide(fromX, toX)],
      cleanup: () => {
        if (current !== from) {
          leaving.hidden = true;
        }
        demote(leaving);
        demote(arriving);
      },
    };
  }

  const swap = activeSwap;
  Promise.all(swap.animations.map((animation) => animation.finished))
    .then(() => {
      if (activeSwap === swap) {
        settle();
      }
    })
    .catch(() => {
      // Ignoring a cancel from settle(), which has already tidied up
    });
}

export function currentTab() {
  return current;
}

export function switchTab(name) {
  if (!ORDER.includes(name)) {
    return;
  }

  // Tapping the tab you are already on takes you back to the top of it
  if (name === current) {
    cool();
    screenFor(name).scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    return;
  }

  settle();

  // Keeping a warm-up for this screen, but undoing one for any other, such as when back sends you to Plan
  if (warmed === name) {
    window.clearTimeout(warmTimer);
    warmed = null;
  } else {
    cool();
  }

  const from = current;
  const fromX = indicatorX(from);
  const toX = indicatorX(name);
  current = name;

  tabFor(from).removeAttribute("aria-current");
  tabFor(name).setAttribute("aria-current", "page");
  swapScreens(from, name, fromX, toX);
}

export function initTabs() {
  tabbar.addEventListener("pointerdown", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) {
      warm(tab.dataset.tab);
    }
  });

  tabbar.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) {
      switchTab(tab.dataset.tab);
    }
  });

  placeIndicator();
  window.addEventListener("resize", () => {
    settle();
    placeIndicator();
  });
}
