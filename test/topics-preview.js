// Preview the Topics section for a note, using a real vault.
// Run: node test/topics-preview.js "passages/66. Revelation/Revelation 1v7-8.md" [vault path] [--all]
// A topic is a note whose frontmatter has `type: topic` (the plugin's default setting).
// --all also shows topics reached only by chapter mentions or broad matches.
const fs = require("fs");
const path = require("path");
const { createReader } = require("../src/reader");
const { PassageIndex, sortTopics } = require("../src/passage-index");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const target = args[0];
const VAULT = args[1] || process.env.PI_VAULT;
if (!VAULT) { console.error("Give the vault path as the second argument, or set PI_VAULT."); process.exit(1); }
const showAll = process.argv.includes("--all");

const idx = new PassageIndex(createReader(), { broadChapters: 2 });
const topics = new Set();
const links = new Set(); // link targets (by name) in the target note
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) {
      const rel = path.relative(VAULT, p).split(path.sep).join("/");
      const text = fs.readFileSync(p, "utf8");
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (fm && /^type:\s*["']?topic["']?\s*$/mi.test(fm[1])) topics.add(rel);
      if (rel === target) for (const m of text.matchAll(/\[\[([^\]|#]+)/g)) links.add(m[1].split("/").pop().trim());
      idx.setFile(rel, text, e.name.replace(/\.md$/, ""));
    }
  }
})(VAULT);

const hidden = (v) => !showAll && (v.broad || v.chapterOnly);
const list = [];
let nHidden = 0;
for (const t of idx.topicsFor(target, (p) => topics.has(p))) {
  const via = t.via.filter((v) => !hidden(v));
  if (!via.length) { nHidden++; continue; }
  list.push({ ...t, via, linked: links.has(path.basename(t.path, ".md")) });
}
sortTopics(list);
console.log(`TOPICS for: ${target}  (${topics.size} topic notes in vault)\n`);
for (const t of list) {
  console.log(`  ${path.basename(t.path, ".md")}${t.linked ? "  [linked]" : ""}`);
  console.log(`      via ${t.via.map((v) => `${v.passage}${v.isMain ? "*" : ""} (${v.matchLabel})`).join(" · ")}`);
  const b = t.via[0];
  if (b.lineText) console.log(`      "${b.lineText.slice(Math.max(0, b.lineCol - 40), b.lineCol + 80)}"`);
}
if (!list.length) console.log("  (none)");
if (nHidden) console.log(`\n  ${nHidden} hidden (chapter mentions / broad matches) — run with --all`);
