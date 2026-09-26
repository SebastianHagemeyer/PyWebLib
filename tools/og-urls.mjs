#!/usr/bin/env node
/*
 * Print the URL for every card in og-cards.json, ready to open and screenshot.
 *
 *   node tools/og-urls.mjs              against http://localhost:8000
 *   node tools/og-urls.mjs 8777         against another port
 *
 * No dependencies and no browser automation, the same rule the rest of the
 * repo follows: a teaching repo a student can clone and open. Screenshotting
 * is a manual step, done once or twice a year. tools/README.md has it.
 */
import { readFileSync } from "node:fs";

const port = process.argv[2] || "8000";
const { cards } = JSON.parse(readFileSync(new URL("og-cards.json", import.meta.url), "utf8"));

for (const c of cards) {
  const q = new URLSearchParams();
  q.set("t", c.t);
  q.set("s", c.s);
  if (c.pill) q.set("pill", c.pill);
  if (c.art && c.art !== "snake") q.set("art", c.art);
  console.log("\n" + c.file + "   (" + c.used_by + ")");
  console.log("http://localhost:" + port + "/tools/og-card.html?" + q);
}
console.log("\n" + cards.length + " card(s). Viewport 1200x630, save into assets/og/.");
