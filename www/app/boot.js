// Running before the first paint, so the page is born in the right theme.
// Preferences is the real store; this copy only exists because Preferences answers too late for the first frame
(() => {
  const CACHE_KEY = "pathway.theme";
  let choice = "system";

  try {
    const saved = localStorage.getItem(CACHE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      choice = saved;
    }
  } catch {
    // Falling back to the phone's own setting when storage is unavailable
  }

  const phoneIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = choice === "dark" || (choice === "system" && phoneIsDark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
