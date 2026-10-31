// Run: node test/mask.test.js
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const idx = new PassageIndex(createReader(), { ignorePhrases: ["Mark 1-8", "Mark 8-16"], broadChapters: 2 });
const refsOf = (text, name = "x") => { idx.setFile("t.md", text, name); return idx.files.get("t.md").refs.map((r) => r.text); };
const cases = [
  ["[[Joel Marcus - Mark 1-8|Marcus 2000]], 123", []],
  ["[[Joel Marcus - Mark 1-8]]", []],
  ["See [[Passages/Mark 1v15|Mark 1:15]].", ["Mark 1:15"]],
  ["See [[Mark 1v15]].", ["Mark 1v15"]],
  ["See [[Passages/Mark 1v21-28 — Observation Worksheet]].", ["Mark 1v21-28"]],
  ["[[What is the new teaching in Mark 1v27]]", []],
  ["Marcus, *Mark 1–8*, 172; cf. Mark 1:15", ["Mark 1:15"]],
  ["![[Isaiah 56v7#Notes]] (quotes)", ["Isaiah 56v7"]],
  ["Mark 1:14–15; Mark 1:1–8", ["Mark 1:14–15", "Mark 1:1–8"]],
];
let fail = 0;
for (const [t, want] of cases) {
  const got = refsOf(t);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log("FAIL", t, "→", got, "want", want); }
}
// Filename of a source note named for a commentary title isn't its main passage.
idx.setFile("s.md", "body", "Joel Marcus - Mark 1-8");
if (idx.files.get("s.md").main.length) { fail++; console.log("FAIL basename main", idx.files.get("s.md").main); }
// Broad flag
idx.setFile("a.md", "Mark 1:15", "Mark 1v15");
idx.setFile("b.md", "Mark 1–3", "b");
idx.setFile("c.md", "Mark 1–2", "c");
idx.setFile("d.md", "Mark 1", "d");
const g = idx.groupsFor("a.md").find((g) => g.isMain);
const broad = Object.fromEntries(g.notes.map((n) => [n.path, n.broad]));
const wantB = { "b.md": true, "c.md": false, "d.md": false };
for (const k in wantB) if (broad[k] !== wantB[k]) { fail++; console.log("FAIL broad", k, broad[k]); }
console.log(fail ? `${fail} failed` : `all ${cases.length + 4} passed`);
process.exit(fail ? 1 : 0);
