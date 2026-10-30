// Finding the plugins Capacitor injects on the phone; in a desktop browser they are simply missing
const plugins = window.Capacitor?.Plugins ?? {};

export const App = plugins.App ?? null;
export const LocalNotifications = plugins.LocalNotifications ?? null;
const Preferences = plugins.Preferences ?? null;
const SystemBars = plugins.SystemBars ?? null;
const Haptics = plugins.Haptics ?? null;

export async function readSetting(key) {
  if (!Preferences) {
    return null;
  }
  try {
    const { value } = await Preferences.get({ key });
    return value;
  } catch (error) {
    console.warn("Could not read setting", key, error);
    return null;
  }
}

export async function writeSetting(key, value) {
  if (!Preferences) {
    return;
  }
  try {
    await Preferences.set({ key, value });
  } catch (error) {
    console.warn("Could not save setting", key, error);
  }
}

// Telling Android the page is DARK draws light icons on it, and LIGHT the opposite
export function setBarStyle(isDark) {
  if (!SystemBars) {
    return;
  }
  SystemBars.setStyle({ style: isDark ? "DARK" : "LIGHT" }).catch((error) => {
    console.warn("Could not style the system bars", error);
  });
}

export async function removeSetting(key) {
  if (!Preferences) {
    return;
  }
  try {
    await Preferences.remove({ key });
  } catch (error) {
    console.warn("Could not remove setting", key, error);
  }
}

// Reading saved data written by writeData; anything missing or damaged reads as null, never as an error
export async function readData(key) {
  const text = await readSetting(key);
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    console.warn("Saved data was damaged and has been ignored", key);
    return null;
  }
}

export async function writeData(key, value) {
  await writeSetting(key, JSON.stringify(value));
}

// Giving a short, soft tap when a step is marked done
export function tapFeedback() {
  if (!Haptics) {
    return;
  }
  Haptics.impact({ style: "LIGHT" }).catch((error) => {
    console.warn("Could not vibrate", error);
  });
}
