#!/usr/bin/env node
// Parses the colour tokens out of src/app/globals.css and asserts WCAG contrast
// for every pairing the UI actually renders — in both themes.
//
//   npm run check:contrast
//
// This exists because the previous scheme hardcoded one shade per semantic
// colour for both themes, so text-emerald-500 measured 7.2:1 in dark and 2.5:1
// in light. A number nobody checks is a number that drifts.

import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

// --- colour maths (WCAG 2.1 relative luminance) ----------------------------
const toRgb = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const channel = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = toRgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
/** Flatten `fg` at `alpha` over `bg` — what `bg-success/15` actually paints. */
const over = (fg, bg, alpha) => {
  const [f, b] = [toRgb(fg), toRgb(bg)];
  return "#" + f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
};

// --- token extraction ------------------------------------------------------
function tokens(selector) {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`Missing block: ${selector}`);
  const body = CSS.slice(start, CSS.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]));
}

const themes = {
  light: tokens(":root {"),
  dark: tokens(":root.dark {"),
};

// The two dark blocks (OS preference + explicit .dark) must never drift.
const osDark = tokens(":root:not(.light):not(.dark) {");
const drift = Object.keys({ ...osDark, ...themes.dark }).filter((k) => osDark[k] !== themes.dark[k]);

// --- the assertions --------------------------------------------------------
// AA is 4.5:1 for body text, 3:1 for large text and for non-text UI boundaries
// (WCAG 1.4.11) such as input edges and focus rings.
const TEXT = 4.5;
const NONTEXT = 3;

const checks = (t) => [
  ["foreground on background", t.foreground, t.background, TEXT],
  ["foreground on card", t.foreground, t.card, TEXT],
  ["foreground on surface", t.foreground, t.surface, TEXT],
  ["muted on background", t.muted, t.background, TEXT],
  ["muted on card", t.muted, t.card, TEXT],
  ["muted on surface", t.muted, t.surface, TEXT],
  ["muted on sidebar", t.muted, t.sidebar, TEXT],
  ["muted on hover fill", t.muted, t.hover, TEXT],

  ["brand text on card", t.brand, t.card, TEXT],
  ["brand text on background", t.brand, t.background, TEXT],
  ["brand text on surface", t.brand, t.surface, TEXT],
  ["on-brand on brand-solid", t["on-brand"], t["brand-solid"], TEXT],
  ["on-brand on brand-hover", t["on-brand"], t["brand-hover"], TEXT],
  ["on-brand on brand-2-solid", t["on-brand"], t["brand-2-solid"], TEXT],
  ["brand-2 text on card", t["brand-2"], t.card, TEXT],

  ["border-strong vs card", t["border-strong"], t.card, NONTEXT],
  ["border-strong vs surface", t["border-strong"], t.surface, NONTEXT],
  ["focus ring (brand) vs card", t.brand, t.card, NONTEXT],
  ["focus ring (brand) vs background", t.brand, t.background, NONTEXT],

  ...["success", "warning", "danger", "info"].flatMap((k) => [
    [`${k} text on card`, t[k], t.card, TEXT],
    [`${k} text on surface`, t[k], t.surface, TEXT],
    // Badges paint the same colour at low alpha behind their own text.
    [`${k} text on ${k}/10 badge`, t[k], over(t[k], t.card, 0.1), TEXT],
    [`${k} text on ${k}/20 badge`, t[k], over(t[k], t.card, 0.2), TEXT],
    [`on-status on solid ${k}`, t["on-status"], t[k], TEXT],
  ]),
];

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  console.log(`\n\x1b[1m${name.toUpperCase()}\x1b[0m`);
  for (const [label, fg, bg, min] of checks(t)) {
    if (!fg || !bg) {
      console.log(`  \x1b[31m?\x1b[0m ${label} — token missing`);
      failed++;
      continue;
    }
    const r = contrast(fg, bg);
    const ok = r >= min;
    if (!ok) failed++;
    const mark = ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`  ${mark} ${label.padEnd(32)} ${r.toFixed(2).padStart(6)}:1  (min ${min})`);
  }
}

// --- no raw palette colours in components ----------------------------------
// The token layer only holds if nothing bypasses it. This is the guard that
// stops `text-emerald-500` from creeping back in.
const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW = new RegExp(
  `\\b(?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|shadow|decoration|placeholder|caret)-(?:${HUES})-\\d{2,3}\\b`,
  "g",
);
const { readdirSync, statSync } = await import("node:fs");
const { join } = await import("node:path");
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") || p.endsWith(".ts") ? [p] : [];
  });

const offenders = [];
for (const file of walk(new URL("../src", import.meta.url).pathname)) {
  const hits = readFileSync(file, "utf8").match(RAW);
  if (hits) offenders.push([file.replace(/.*\/src\//, "src/"), [...new Set(hits)]]);
}
if (offenders.length) {
  console.log("\n\x1b[31m✗ raw palette colours bypass the token layer:\x1b[0m");
  for (const [f, hits] of offenders) console.log(`    ${f}: ${hits.join(", ")}`);
  failed += offenders.length;
}

if (drift.length) {
  console.log(`\n\x1b[31m✗ dark tokens differ between .dark and prefers-color-scheme: ${drift.join(", ")}\x1b[0m`);
  failed += drift.length;
}

console.log(
  failed
    ? `\n\x1b[31m${failed} contrast check(s) failed.\x1b[0m`
    : `\n\x1b[32mAll contrast checks passed.\x1b[0m`,
);
process.exit(failed ? 1 : 0);
