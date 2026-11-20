// node test/coverage.test.js
const assert = require("assert");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const { coverage, alsoCited, marks, level, versesIn, chaptersIn } = require("../src/coverage");
let n = 0;
const t = (name, fn) => { fn(); n++; };

t("table", () => {
  assert.strictEqual(chaptersIn(66), 22); assert.strictEqual(versesIn(66, 1), 20);
  assert.strictEqual(chaptersIn(19), 150); assert.strictEqual(versesIn(43, 21), 25);
  assert.strictEqual(chaptersIn(101), 0);
});
t("level", () => assert.deepStrictEqual([0, 1, 2, 3, 4, 9].map(level), [0, 1, 2, 2, 3, 3]));

const idx = new PassageIndex(createReader(), {});
idx.setFile("a.md", "See Rev 1:17 and Rev 1:17-18. Also Rev 2.", "Revelation 1v17-18");
idx.setFile("b.md", "Rev 1:18; Rev 1-22 is long.", "Topic");
const cov = coverage(idx, 66);
t("verse counts", () => {
  const ch = cov.chapters[0];
  assert.strictEqual(ch.verse[16].mentions, 2); // a: 1:17 and 1:17-18 (main = same range, not added twice)
  assert.strictEqual(ch.verse[17].mentions, 2); // a 1:17-18, b 1:18
  assert.strictEqual(ch.verse[16].notes.get("a.md").count, 2);
  assert.strictEqual(ch.verse[0].mentions, 0);
});
t("chapter-only and broad go to the chapter", () => {
  assert.strictEqual(cov.chapters[1].chapterMentions, 2); // Rev 2 (a) + Rev 1-22 (b)
  assert.strictEqual(cov.chapters[1].verse[0].mentions, 0);
  assert.strictEqual(cov.chapters[21].chapterMentions, 1);
});
t("main", () => {
  assert.ok(cov.chapters[0].isMain && cov.chapters[0].verse[16].isMain && !cov.chapters[0].verse[18].isMain);
});
t("marks", () => {
  const m = marks(idx.files.get("a.md").main, 66);
  assert.deepStrictEqual([...m.chapters], [1]); assert.deepStrictEqual([...m.verses], ["1:17", "1:18"]);
});
t("apocrypha null", () => assert.strictEqual(coverage(idx, 101), null));

// "Also cited with"
const ix = new PassageIndex(createReader(), {});
ix.setFile("r1.md", "Rev 1:7 echoes Dan 7:13 and Zech 12:10. Also Rev 1:13 and Rev 22:13.", "Revelation 1v7");
ix.setFile("r2.md", "Rev 1:13 with Dan 7:9-10 and Dan 7:13. See Gen 1-11 too.", "Son of Man");
ix.setFile("r3.md", "Rev 1 overview; Rev 1-22 is broad; Isa 44:6.", "Overview");
ix.setFile("rt.md", "- Rev 1:7 with Ps 2:7", "Rabbit trails");
t("also cited: chapter", () => {
  const a = alsoCited(ix, { book: 66, c: 1, v: null }, { skip: "rt.md" });
  assert.strictEqual(a.notes, 3);
  const keys = a.entries.map((x) => `${x.book}:${x.c}:${x.notes.length}`);
  // Dan 7 (2 notes) first; Rev 1 itself left out; Gen 1-11 broad, left out; Rev 22 from r3's "Rev 1-22"? no (broad).
  assert.deepStrictEqual(keys, ["27:7:2", "23:44:1", "38:12:1", "66:22:1"]);
  const dan = a.entries[0].notes.find((n) => n.path === "r2.md");
  assert.deepStrictEqual(dan.refs, ["7:9–10", "7:13"]);
  assert.ok(!a.entries.some((x) => x.book === 19), "rabbit note skipped");
});
t("also cited: verse", () => {
  const a = alsoCited(ix, { book: 66, c: 1, v: 7 });
  assert.strictEqual(a.notes, 2); // r1 and the rabbit note; r3's chapter-only "Rev 1" doesn't count
  assert.ok(!a.entries.some((x) => x.book === 66 && x.c === 1), "same chapter left out");
  assert.ok(a.entries.some((x) => x.book === 66 && x.c === 22));
  const b = alsoCited(ix, { book: 66, c: 1, v: 13 });
  assert.strictEqual(b.entries[0].book, 27); assert.strictEqual(b.entries[0].notes.length, 2);
});
t("alsoCited reused until a note changes (bug 16)", () => {
  const ix = new PassageIndex(createReader(), {});
  ix.setFile("a.md", "Rev 1:7; Dan 7:13.", "A");
  const f = { book: 66, c: 1, v: 7 };
  const a1 = alsoCited(ix, f), a2 = alsoCited(ix, { ...f });
  assert.strictEqual(a1, a2);
  assert.notStrictEqual(alsoCited(ix, f, { broadChapters: 5 }), a1); // options are part of the key
  ix.setFile("b.md", "Rev 1:7; Zech 12:10.", "B");
  const a3 = alsoCited(ix, f);
  assert.notStrictEqual(a3, a1);
  assert.strictEqual(a3.notes, 2); assert.strictEqual(a3.entries.length, 2);
  ix.remove("b.md");
  assert.strictEqual(alsoCited(ix, f).notes, 1);
});
console.log(`coverage: ${n} passed`);
