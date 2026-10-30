import { ms, token, reducedMotion } from "./motion.js";

// Keeping one bottom panel open at a time; any <dialog class="sheet"> can be opened by its id
let sheet = null;
let running = [];
let closing = false;
const closeListeners = new Map();

function partsOf(dialog) {
  return { panel: dialog.querySelector(".sheet-panel"), scrim: dialog.querySelector(".sheet-scrim") };
}

function stopRunning() {
  for (const animation of running) {
    animation.cancel();
  }
  running = [];
}

export function isSheetOpen() {
  return Boolean(sheet?.open);
}

export function openSheetId() {
  return isSheetOpen() ? sheet.id : null;
}

// Running a function after a panel has fully closed, such as returning focus or saving a choice
export function onSheetClose(id, listener) {
  closeListeners.set(id, listener);
}

export async function openSheet(id) {
  const next = document.getElementById(id);
  if (!next) {
    return;
  }
  if (sheet && sheet !== next && sheet.open) {
    if (closing) {
      // Finishing another panel's exit at once if it is still leaving, so it can never stay behind
      const leaving = sheet;
      stopRunning();
      leaving.close();
      closing = false;
      closeListeners.get(leaving.id)?.();
    } else {
      await closeSheet();
    }
  }
  if (next.open && !closing) {
    return;
  }

  // Reopening mid-close continues from where the panel is, instead of jumping back down
  const { panel, scrim } = partsOf(next);
  const reopening = closing && sheet === next;
  const panelFrom = reopening ? getComputedStyle(panel).transform : "translateY(100%)";
  const scrimFrom = reopening ? Number(getComputedStyle(scrim).opacity) : 0;
  stopRunning();
  closing = false;
  sheet = next;
  if (!next.open) {
    next.showModal();
  }
  next.querySelector(".sheet-panel")?.scrollTo(0, 0);

  if (reducedMotion()) {
    running = [next.animate({ opacity: [0, 1] }, { duration: ms("--dur-leave"), easing: "linear" })];
    return;
  }

  running = [
    scrim.animate({ opacity: [scrimFrom, 1] }, { duration: ms("--dur-sheet"), easing: token("--ease-out") }),
    panel.animate(
      { transform: [panelFrom === "none" ? "translateY(0)" : panelFrom, "translateY(0)"] },
      { duration: ms("--dur-sheet"), easing: token("--ease-sheet") }
    ),
  ];
}

export async function closeSheet() {
  if (!sheet?.open || closing) {
    return;
  }
  const current = sheet;
  const { panel, scrim } = partsOf(current);
  closing = true;
  stopRunning();

  // Leaving fast, because the panel still blocks taps until it has fully gone
  const options = { duration: ms("--dur-sheet-exit"), easing: token("--ease-in"), fill: "forwards" };
  running = reducedMotion()
    ? [current.animate({ opacity: [1, 0] }, options)]
    : [
      scrim.animate({ opacity: [1, 0] }, options),
      panel.animate({ transform: ["translateY(0)", "translateY(100%)"] }, options),
    ];

  try {
    await Promise.all(running.map((animation) => animation.finished));
  } catch {
    // Stopping here when openSheet cancelled the close and has taken over the panel
    return;
  }
  current.close();
  stopRunning();
  closing = false;
  closeListeners.get(current.id)?.();
}

export function initSheet() {
  // Routing Escape and similar requests through the animation, since they would close a dialog instantly
  for (const dialog of document.querySelectorAll("dialog.sheet")) {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeSheet();
    });
  }
}
