// Opening and closing a part of a page as one movement, the way a step opens on the Plan tab: the
// content is uncovered from the top down while everything after it glides down at the same pace, and
// closing runs the same movement backwards. Roadmap sections, the Toolkit's sections and folded
// parts, the cards on My list, "What shaped this plan" and the scholarship list all move this way. A
// tap in the middle of a movement turns it around from where it is on the screen, so fast taps never
// leave a copy behind
import { ms, reducedMotion, token } from "./motion.js";

// Letting the words appear soon after the uncovering begins and finish well before it ends, so they
// are never still fading in while the movement settles, which read as a pause
const FADE_FROM = 0.1;
const FADE_TO = 0.55;
// Keeping the closing content fully visible for most of the movement, then fading it
const FADE_OUT_FROM = 0.6;
// Giving a movement turned around part way at least this share of the full time, so even a short
// way back still reads as a movement rather than a jump
const SHORTEST_SHARE = 0.4;
// Marking content on its way out. It stays on the page only until its movement ends, and a new copy
// of the same content is never mistaken for it
export const LEAVING = "data-leaving";
// Naming each glide, so a new one can take over from one still running
const GLIDE = "pathway-glide";

function timing(share = 1) {
  return { duration: ms("--dur-expand") * Math.max(SHORTEST_SHARE, Math.min(1, share)), easing: token("--ease-unfold") };
}

// Finding the content of a part that is on the page now, never the content on its way out
export function shownPart(element, selector) {
  for (const child of element.children) {
    if (child.matches(selector) && !child.hasAttribute(LEAVING)) {
      return child;
    }
  }
  return null;
}

// Remembering where everything after a part sits on the screen, up to the edge of the page it
// belongs to. A part still gliding is read where it is seen, so a new glide starts from there
export function followersOf(element, scope) {
  const list = [];
  for (let node = element; node && node !== scope; node = node.parentElement) {
    for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
      list.push({ element: next, top: next.getBoundingClientRect().top });
    }
  }
  return list;
}

// Reading how much of a part is uncovered and how strongly it shows at this moment, so a movement
// turned around continues from exactly what the student sees
function shown(element) {
  const style = getComputedStyle(element);
  const height = element.getBoundingClientRect().height;
  const inset = /inset\(([^)]*)\)/.exec(style.clipPath);
  let covered = 0;
  if (inset) {
    const values = inset[1].trim().split(/\s+/).map((value) => Number.parseFloat(value) || 0);
    const top = values[0];
    const bottom = values[[0, 0, 2, 2][Math.min(values.length, 4) - 1]];
    covered = top + bottom;
  }
  return { visible: Math.max(0, Math.min(height, height - covered)), opacity: Number.parseFloat(style.opacity) };
}

// Gliding each follower from where it was seen. A glide still running is replaced, and one off the
// screen before and after is left alone
function glide(followers, timed) {
  for (const { element } of followers) {
    for (const running of element.getAnimations()) {
      if (running.id === GLIDE) {
        running.cancel();
      }
    }
  }
  const bottom = window.innerHeight;
  for (const { element, top: was } of followers) {
    const now = element.getBoundingClientRect().top;
    const dy = was - now;
    const seen = (top) => top < bottom && top > -element.offsetHeight;
    if (Math.abs(dy) > 0.5 && (seen(was) || seen(now))) {
      const moving = element.animate({ transform: [`translateY(${dy}px)`, "translateY(0)"] }, timed);
      moving.id = GLIDE;
    }
  }
}

// Uncovering content just placed on the page. followers must be read before it was placed. When the
// same part was still closing, the uncovering starts from how much of it was still showing
export function revealOpen(body, followers) {
  if (!body) {
    return;
  }
  let from = null;
  for (const leaving of [...body.parentElement.children].filter((child) => child !== body && child.hasAttribute(LEAVING))) {
    from ??= shown(leaving);
    leaving.getAnimations().forEach((animation) => animation.cancel());
    leaving.remove();
  }
  if (reducedMotion()) {
    return;
  }
  const height = body.getBoundingClientRect().height;
  const start = from ? Math.min(from.visible, height) : 0;
  const timed = timing(height > 0 ? 1 - start / height : 1);
  body.animate({ clipPath: [`inset(0 0 ${height - start}px 0)`, "inset(0 0 0 0)"] }, timed);
  if (!from) {
    body.animate({ opacity: [0, 0, 1, 1], offset: [0, FADE_FROM, FADE_TO, 1] }, timed);
  } else if (from.opacity < 1) {
    body.animate({ opacity: [from.opacity, 1, 1], offset: [0, FADE_TO, 1] }, timed);
  }
  glide(followers, timed);
}

// Taking content off the page: it is lifted out of the flow where it sits, covered from the bottom
// up while the parts after it rise, then removed. followers must be read before this is called. The
// content's parent must be positioned. When the content was still opening, the covering starts from
// how much of it was showing
export function concealClose(body, followers) {
  if (!body) {
    return;
  }
  if (reducedMotion()) {
    body.remove();
    return;
  }
  const height = body.getBoundingClientRect().height;
  const from = shown(body);
  body.getAnimations().forEach((animation) => animation.cancel());
  const place = { top: `${body.offsetTop}px`, left: `${body.offsetLeft}px`, width: `${body.offsetWidth}px` };
  body.setAttribute(LEAVING, "");
  body.setAttribute("aria-hidden", "true");
  body.inert = true;
  Object.assign(body.style, { position: "absolute", ...place, margin: "0", pointerEvents: "none" });
  const timed = timing(height > 0 ? from.visible / height : 1);
  const held = { ...timed, fill: "forwards" };
  const shrink = body.animate({ clipPath: [`inset(0 0 ${height - from.visible}px 0)`, `inset(0 0 ${height}px 0)`] }, held);
  body.animate({ opacity: [from.opacity, from.opacity, 0], offset: [0, FADE_OUT_FROM, 1] }, held);
  shrink.finished.then(() => body.remove(), () => { });
  glide(followers, timed);
}
