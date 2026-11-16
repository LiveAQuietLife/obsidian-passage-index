// node test/gaps.test.js — the Gaps tab: cited passages with no note of their own.
const assert = require("assert");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
let n = 0;
const t = (name, fn) => { fn(); n++; };

const ix = new PassageIndex(createReader(), {});
ix.setFile("a.md", "Rev 1:7 echoes Dan 7:13 and Zech 12:10. Daniel 7:13 again. Dan 7:13-14 too. See Dan 2.", "Revelation 1v7-8");
ix.setFile("b.md", "Dan 7:13 and Rev 1:9 and Isa 44:6. Gen 1-11 is broad.", "Son of Man");
ix.setFile("c.md", "Zech 12:10 here.", "Isaiah 44v1-8");
ix.setFile("rt.md", "- Ps 2:7 — why (from a)", "Rabbit trails");
const rows = ix.unwritten("rt.md");
const by = (p) => rows.find((r) => r.passage === p);

t("written passages left out", () => {
  assert.ok(!by("Revelation 1:7"), "Rev 1:7 has Revelation 1v7-8");
  assert.ok(!by("Isaiah 44:6"), "inside Isaiah 44v1-8");
});
t("overlap counts as written", () => {
  ix.setFile("d.md", "Rev 1:8-9.", "Topic d");
  assert.ok(!ix.unwritten("rt.md").some((r) => r.passage === "Revelation 1:8–9"));
  ix.remove("d.md");
});
t("not about: listed", () => {
  assert.ok(by("Revelation 1:9"));
  assert.strictEqual(by("Daniel 7:13").notes.length, 2);
});
t("spellings merged, count per note, first place kept", () => {
  const a = by("Daniel 7:13").notes.find((x) => x.path === "a.md");
  assert.strictEqual(a.count, 2);
  assert.strictEqual(a.refText, "Dan 7:13");
});
t("nested range is its own row", () => assert.ok(by("Daniel 7:13–14")));
t("chapter-only, broad and rabbit note left out", () => {
  assert.ok(!rows.some((r) => r.ref.v1 == null));
  assert.ok(!rows.some((r) => r.ref.book === 1));
  assert.ok(!rows.some((r) => r.ref.book === 19));
});
t("order: most notes, then Bible order", () => {
  assert.deepStrictEqual(rows.map((r) => `${r.passage} ${r.notes.length}`),
    ["Daniel 7:13 2", "Zechariah 12:10 2", "Daniel 7:13–14 1", "Revelation 1:9 1"]);
});
// Bug 15: the result is reused until a note changes.
t("reused while nothing changes", () => assert.strictEqual(ix.unwritten("rt.md"), ix.unwritten("rt.md")));
t("rebuilt after a note is added, changed or removed", () => {
  const before = ix.unwritten("rt.md");
  ix.setFile("e.md", "Nothing here.", "Daniel 7v13-14");
  const added = ix.unwritten("rt.md");
  assert.notStrictEqual(added, before);
  assert.ok(!added.some((r) => r.ref.book === 27), "Daniel 7:13 rows gone once a note on it exists");
  ix.setFile("e.md", "Nothing here.", "Topic e");
  assert.ok(ix.unwritten("rt.md").some((r) => r.passage === "Daniel 7:13"), "back when the note changes");
  ix.setFile("e.md", "Nothing here.", "Daniel 7v13-14");
  ix.remove("e.md");
  assert.ok(ix.unwritten("rt.md").some((r) => r.passage === "Daniel 7:13"), "back when the note is removed");
});
t("not reused for another skip note or broadChapters", () => {
  const a = ix.unwritten("rt.md");
  assert.ok(ix.unwritten(null).some((r) => r.passage === "Psalms 2:7"), "rabbit note counted without skip");
  assert.notStrictEqual(ix.unwritten("rt.md"), a);
  ix.setFile("f.md", "Rom 1:18-3:20.", "Topic f");
  assert.ok(!ix.unwritten("rt.md").some((r) => r.passage.startsWith("Romans")), "3 chapters: broad, left out");
  ix.opts.broadChapters = 3;
  assert.ok(ix.unwritten("rt.md").some((r) => r.passage.startsWith("Romans")), "listed once broadChapters is 3");
  delete ix.opts.broadChapters;
  ix.remove("f.md");
});
console.log(`gaps: ${n} passed`);
