// Preview what the pane would show for a note, using the real vault.
// Run: PI_VAULT=/path/to/vault node test/pane-preview.js "Notes/abomination (bdelygma) in Mark 13v14.md" [--all]
const fs = require("fs");
const path = require("path");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");

const VAULT = process.env.PI_VAULT;
if (!VAULT) { console.error("Set PI_VAULT to the vault folder, e.g. PI_VAULT=\"/path/to/vault\" node test/pane-preview.js ..."); process.exit(1); }
const target = process.argv[2];
const showAll = process.argv.includes("--all");

const idx = new PassageIndex(createReader());
const fmPassage = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const p = m && m[1].match(/^passage:[ \t]*(.*)((?:\n[ \t]*-.*)*)/m);
  if (!p) return undefined;
  const list = p[2].split("\n").map((s) => s.replace(/^[ \t]*-[ \t]*/, "").trim()).filter(Boolean);
  return p[1].trim() ? p[1].trim() : list.length ? list : undefined;
};
const t0 = Date.now();
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) {
      const rel = path.relative(VAULT, p).split(path.sep).join("/");
      const text = fs.readFileSync(p, "utf8");
      idx.setFile(rel, text, e.name.replace(/\.md$/, ""), fmPassage(text));
    }
  }
})(VAULT);
const s = idx.stats();
console.log(`Indexed ${s.notes} notes, ${s.refs} references in ${Date.now() - t0} ms\n`);

const groups = idx.groupsFor(target);
console.log(`PANE for: ${target}\n`);
for (const g of groups) {
  console.log(`${g.open ? "▾" : "▸"} ${g.label}${g.isMain ? "  (main passage)" : ""}  · ${g.notes.length} notes`);
  if (!g.open && !showAll) continue;
  for (const n of g.notes.slice(0, 12)) {
    const folder = n.path.split("/")[0];
    const tag = [n.about ? "ABOUT" : "", n.matchLabel, n.more ? `+${n.more}` : "", n.otherGroups ? `also in ${n.otherGroups}` : ""].filter(Boolean).join(" · ");
    console.log(`    ${path.basename(n.path, ".md").slice(0, 70)}  [${folder}]  {${tag}}`);
    if (n.lineText) console.log(`        "${n.lineText.slice(0, 110)}"`);
  }
  if (g.notes.length > 12) console.log(`    … ${g.notes.length - 12} more`);
}
