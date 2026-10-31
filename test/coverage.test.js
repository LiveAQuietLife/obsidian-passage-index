// node test/coverage.test.js
const assert = require("assert");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const { coverage, marks, level, versesIn, chaptersIn } = require("../src/coverage");
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
console.log(`coverage: ${n} passed`);
