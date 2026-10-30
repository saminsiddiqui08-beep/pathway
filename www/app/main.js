import { App } from "./native.js";
import { initTheme } from "./theme.js";
import { initTabs, switchTab, currentTab } from "./tabs.js";
import { initSheet, openSheet, closeSheet, isSheetOpen } from "./sheet.js";
import { currentPlan, handlePlanBack, initTimeline, openStep, planFor, refresh } from "../features/timeline/timeline.js";
import { handleRoadmapBack, initRoadmaps, openRoadmap, refreshRoadmaps } from "../features/roadmaps/roadmaps.js";
import { handleToolkitBack, initToolkit, openGuide, refreshToolkit } from "../features/toolkit/toolkit.js";
import { initScholarships } from "../features/scholarships/scholarships.js";

// Waiting this long past midnight before moving "today" on, so the phone's clock has surely turned, in seconds
const MIDNIGHT_MARGIN = 2;

// Giving Android's back gesture one clear order: close the panel, go back one question, from a
// roadmap to the list of countries or from a guide to the list of tools, return to Plan, then leave
function handleBack() {
  if (isSheetOpen()) {
    closeSheet();
  } else if (currentTab() === "plan" && handlePlanBack()) {
    return;
  } else if (currentTab() === "countries" && handleRoadmapBack()) {
    return;
  } else if (currentTab() === "toolkit" && handleToolkitBack()) {
    return;
  } else if (currentTab() !== "plan") {
    switchTab("plan");
  } else {
    App.minimizeApp();
  }
}

function handleAction(event) {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) {
    return;
  }
  if (trigger.dataset.action === "open-sheet") {
    openSheet(trigger.dataset.sheet);
  } else if (trigger.dataset.action === "close-sheet") {
    closeSheet();
  }
}

function showPage() {
  requestAnimationFrame(() => {
    document.documentElement.classList.remove("is-booting");
  });
}

// Rebuilding the plan, then the roadmaps and the guides that show it, for a new day or a changed plan
function refreshAll() {
  return refresh()
    .then(() => Promise.all([refreshRoadmaps(), refreshToolkit()]))
    .catch((error) => console.error("Could not refresh the plan", error));
}

// Moving "today" on at midnight while Pathway stays open, so dates and limits never belong to
// yesterday. A phone asleep at midnight is caught by the resume listener instead
function watchMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, MIDNIGHT_MARGIN);
  window.setTimeout(() => {
    refreshAll().finally(watchMidnight);
  }, next.getTime() - now.getTime());
}

// Keeping the page itself still: only the screens scroll, so if anything ever scrolls the whole page,
// such as focus moving to a hidden part, it is put straight back and the tab bar stays where it belongs
function pinPage() {
  window.addEventListener("scroll", () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  }, { passive: true });
}

async function start() {
  initSheet();
  initTabs();
  pinPage();
  document.addEventListener("click", handleAction);
  App?.addListener("backButton", handleBack);

  // Coming back to the app on a new day moves "today" on and rebuilds the plan, the roadmaps and the guides
  App?.addListener("resume", refreshAll);
  watchMidnight();

  // Drawing the roadmaps and guides again as a finger lands on their tab, before the swap begins, so a
  // plan made meanwhile shows on them and the motion never waits for the drawing
  document.querySelector(".tabbar").addEventListener("pointerdown", (event) => {
    const tab = event.target.closest(".tab")?.dataset.tab;
    if (tab === "countries") {
      refreshRoadmaps().catch((error) => console.error("Could not refresh the roadmaps", error));
    } else if (tab === "toolkit") {
      refreshToolkit().catch((error) => console.error("Could not refresh the guides", error));
    }
  });

  await initTheme();
  await Promise.all([
    document.fonts.ready,
    initTimeline({ onShowPlan: () => switchTab("plan"), onOpenRoadmap: (code, section) => openRoadmap(code, section) }),
    initRoadmaps({
      getPlan: currentPlan,
      makePlan: (code) => planFor(code),
      openPlan: (code) => planFor(code),
      openPlanStep: (code, step) => openStep(code, step),
      showCountries: () => switchTab("countries"),
      openGuide: (id) => openGuide(id),
    }),
    initToolkit({
      getPlan: currentPlan,
      showToolkit: () => switchTab("toolkit"),
      openRoadmap: (code, section) => openRoadmap(code, section),
    }),
    initScholarships({ openRoadmap: (code, section) => openRoadmap(code, section) }),
  ]);
}

start()
  .catch((error) => {
    console.error("Pathway failed to start cleanly", error);
  })
  .finally(showPage);
