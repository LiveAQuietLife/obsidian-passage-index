// Preview the pane's Intertexts section for notes in the real vault.
// Run: PI_VAULT=/path/to/vault node test/intertext-preview.js "Passages/Mark 11v17.md" ["Passages/Isaiah 56v7.md" ...]
const fs = require("fs");
const path = require("path");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");

const VAULT = process.env.PI_VAULT;
if (!VAULT) { console.error("Set PI_VAULT to the vault folder, e.g. PI_VAULT=\"/path/to/vault\" node test/intertext-preview.js ..."); process.exit(1); }
const idx = new PassageIndex(createReader());
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__Support") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) idx.setFile(path.relative(VAULT, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8"), e.name.slice(0, -3));
  }
})(VAULT);
let lines = 0, tasks = 0;
for (const f of idx.files.values()) { lines += f.intertexts.length; tasks += f.openTasks.length; }
console.log(`Intertext lines: ${lines}; open #intertext tasks: ${tasks}\n`);
for (const target of process.argv.slice(2)) {
  const { uses, usedBy, open } = idx.intertextsFor(target);
  console.log(`== ${target}`);
  for (const u of uses) console.log(`  Uses     ${u.relation.padEnd(11)} ${u.passage.padEnd(14)} ${u.citation ? "(" + u.citation + ")" : ""} ${u.description ? "— " + u.description : ""}`);
  for (const u of usedBy) console.log(`  Used by  ${u.relation.padEnd(11)} ${u.passage.padEnd(14)} ← ${u.noteName}`);
  for (const o of open) console.log(`  Open     ○ ${o.lineText.slice(0, 80)}…  (${o.noteName.slice(0, 40)})`);
  if (!uses.length && !usedBy.length && !open.length) console.log("  (section hidden)");
}
