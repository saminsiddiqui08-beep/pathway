// Opening every source link in the facts files and reporting the ones that no longer work, so a moved or
// removed page is found before a student taps it. It needs an internet connection. Many official sites
// refuse checks that do not come from a person's browser; those are counted, not listed, unless --all
// is given. A few sites even answer "gone" to such checks, so open a BROKEN link in a browser before
// replacing it.
// Usage: node tools/check-links.js [--all]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Giving each page this long to answer, in milliseconds
const TIMEOUT = 20000;
// Opening this many pages at a time, so no site is flooded
const AT_ONCE = 6;
// Asking as a phone's browser does, since some sites refuse requests that do not look like one
const BROWSER = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
// Treating these answers as a site that is there but turned the check away
const REFUSED = new Set([401, 403, 405, 429, 503]);
const SHOW_ALL = process.argv.includes("--all");

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}${path}`, "utf8"));

function sources() {
  const files = { bd: "www/data/common/bd.json" };
  for (const { code } of read("www/data/countries/index.json").countries) {
    files[code] = `www/data/countries/${code}/facts.json`;
  }
  return Object.entries(files).flatMap(([code, path]) => Object.entries(read(path).sources).map(([id, source]) => ({ ref: `${code}/${id}`, url: source.url })));
}

async function check({ ref, url }) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": BROWSER, accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    await response.body?.cancel();
    if (response.status === 404 || response.status === 410) {
      return { ref, url, verdict: "broken", detail: `the page is gone (${response.status})` };
    }
    if (REFUSED.has(response.status)) {
      return { ref, url, verdict: "refused", detail: `the site refused an automatic check (${response.status})` };
    }
    if (!response.ok) {
      return { ref, url, verdict: "check", detail: `the site answered ${response.status}; open it in a browser` };
    }
    return { ref, url, verdict: "ok" };
  } catch (error) {
    const code = error.cause?.code ?? error.name;
    if (code === "ENOTFOUND") {
      return { ref, url, verdict: "check", detail: "the site's name was not found; open it in a browser" };
    }
    return { ref, url, verdict: "refused", detail: `no answer to an automatic check (${code})` };
  }
}

async function main() {
  const list = sources();
  const results = [];
  for (let start = 0; start < list.length; start += AT_ONCE) {
    results.push(...await Promise.all(list.slice(start, start + AT_ONCE).map(check)));
  }
  const broken = results.filter((item) => item.verdict === "broken");
  const unsure = results.filter((item) => item.verdict === "check");
  const refused = results.filter((item) => item.verdict === "refused");
  console.log(`${results.length} links: ${results.length - broken.length - unsure.length - refused.length} work, ${broken.length} broken, ${unsure.length} to check by hand, ${refused.length} refused an automatic check`);
  for (const item of [...broken, ...unsure, ...(SHOW_ALL ? refused : [])]) {
    const word = { broken: "BROKEN", check: "CHECK ", refused: "REFUSED" }[item.verdict];
    console.log(`${word} ${item.ref}: ${item.detail}\n       ${item.url}`);
  }
  if (refused.length > 0 && !SHOW_ALL) {
    console.log(`Many official sites turn away checks that do not come from a browser. Run "npm run links -- --all" to list those ${refused.length} too.`);
  }
  return broken.length > 0 ? 1 : 0;
}

process.exitCode = await main();
