// node test/coverage.test.js
const assert = require("assert");
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const { coverage, alsoCited, verseStar, marks, level, versesIn, chaptersIn } = require("../src/coverage");
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

// Verse star
{
  const { format } = require("../src/reader");
  const ix = new PassageIndex(createReader(), {});
  ix.setFile("p/Revelation 1v7-8.md", "Zech 12:10; Matt 24:30. Rev 1:4 and Dan 7.", "Revelation 1v7-8");
  ix.setFile("q/Mourning.md", "Rev 1:7 recalls Zech 12:10-13:1 and John 19:37. Matt 24:30-31.", "Mourning");
  ix.setFile("q/Smyrna.md", "Rev 1:7-8; Zech 12:12. Gen 1-50 is broad. Matt 1:1.", "Smyrna");
  ix.setFile("p/Revelation - Index.md", "Rev 1:7; Zech 12:10; Isa 6:1.", "Revelation - Index");
  ix.setFile("q/Other.md", "Rev 1:12; Isa 6:1.", "Other");
  ix.setFile("q/Chapter only.md", "Rev 1; Isa 40:1.", "Chapter only");
  const isHub = (p) => p.endsWith("Index.md");
  const focus = { book: 66, c1: 1, v1: 7, c2: 1, v2: 7 };
  const st = verseStar(ix, focus, { isHub, hubKey: "index" });
  const label = (d) => format(d.ref);
  t("star: notes on the verse; hubs, other verses and chapter-only notes left out", () => {
    assert.strictEqual(st.notes, 3); assert.strictEqual(st.hubs, 1);
    assert.ok(!st.dots.some((d) => d.book === 23)); // Isa 6:1 (hub), Isa 40:1 (note on Rev 1 only)
    assert.ok(!st.dots.some((d) => d.book === 66)); // Rev 1:4: the focus chapter
  });
  t("star: other chapters of the focus book are kept", () => {
    const ix2 = new PassageIndex(createReader(), {});
    ix2.setFile("a.md", "Rev 1:7; Rev 1:4; Rev 2:10.", "A");
    assert.deepStrictEqual(verseStar(ix2, focus).dots.map(label), ["Revelation 2:10"]);
  });
  t("star: overlapping ranges merge; the dot takes the most-cited, then narrowest form", () => {
    const z = st.dots.find((d) => d.book === 38);
    assert.strictEqual(label(z), "Zechariah 12:10");
    assert.strictEqual(z.notes.length, 3); assert.strictEqual(z.forms, 3);
    assert.deepStrictEqual(z.notes.find((n) => n.path === "q/Mourning.md").refs, ["12:10–13:1"]);
    const m = st.dots.find((d) => d.book === 40 && d.ref.c1 === 24);
    assert.strictEqual(label(m), "Matthew 24:30"); assert.strictEqual(m.notes.length, 2);
  });
  t("star: on a tie, the dot takes the passage a note is about (bug 20)", () => {
    const ix3 = new PassageIndex(createReader(), {});
    ix3.setFile("Revelation 2v8-11.md", "Echoes back to Isa 41:4.\n\nPrison in Rev 2:10.", "Revelation 2v8-11");
    ix3.setFile("Revelation 1v4-6.md", "Beale: Isa 41:4. The Spirit addresses the churches (Rev 2:7, 11, 17).", "Revelation 1v4-6");
    const s = verseStar(ix3, { book: 23, c1: 41, v1: 4, c2: 41, v2: 4 });
    const d = s.dots.find((x) => x.book === 66 && x.ref.c1 === 2 && x.notes.length === 2);
    assert.strictEqual(label(d), "Revelation 2:8–11");
    // No note about it: the old rule (narrowest, then earliest) still holds, as for Zech 12:10 above.
    const ix4 = new PassageIndex(createReader(), {});
    ix4.setFile("a.md", "Isa 41:4; Rev 2:10.", "A");
    ix4.setFile("b.md", "Isa 41:4; Rev 2:10-11.", "B");
    assert.strictEqual(label(verseStar(ix4, { book: 23, c1: 41, v1: 4, c2: 41, v2: 4 }).dots[0]), "Revelation 2:10");
  });
  t("star: a long note links only what it cites near the focus (paragraph, verse heading)", () => {
    const ix5 = new PassageIndex(createReader(), {});
    const isa = { book: 23, c1: 41, v1: 4, c2: 41, v2: 4 };
    ix5.setFile("Revelation 1v4-6.md", [
      "Beale: Exod 3:14 with Isa 41:4; 44:6.", "- Deut 32:39 comes up too.", "",
      "The seven spirits: Zech 4:10 and Rev 5:6.", "",
      "### 1:5 \"the firstborn\"", "Ps 89:27.", "", "More on 1:5: Col 1:18.", "#### Detail", "Isa 55:3.", "",
      "### 1:6 \"a kingdom\"", "Exod 19:6.",
    ].join("\n"), "Revelation 1v4-6");
    const books = (s) => s.dots.map((d) => format(d.ref));
    // Same paragraph (a list with no blank line counts as one), and the note's own passage.
    assert.deepStrictEqual(books(verseStar(ix5, isa)), ["Exodus 3:14", "Deuteronomy 32:39", "Isaiah 44:6", "Revelation 1:4–6"]);
    // A verse heading: its section (sub-headings too), not the next verse's.
    const s15 = verseStar(ix5, { book: 66, c1: 1, v1: 5, c2: 1, v2: 5 });
    assert.deepStrictEqual(books(s15), ["Psalms 89:27", "Isaiah 55:3", "Colossians 1:18"]);
  });
  t("star: a heading with a full reference marks its section, in any note", () => {
    const ix7 = new PassageIndex(createReader(), {});
    ix7.setFile("Sermon.md", "## Rev 3:5 the book of life\nExod 32:32.\n\nPs 69:28.\n### Notes\nDan 12:1.\n## Revelation 3:6\nMatt 1:1.\n## Grace\nJohn 1:16.",
      "Sermon on Sardis");
    const s = verseStar(ix7, { book: 66, c1: 3, v1: 5, c2: 3, v2: 5 });
    assert.deepStrictEqual(s.dots.map((d) => format(d.ref)), ["Exodus 32:32", "Psalms 69:28", "Daniel 12:1"]);
  });
  t("star: short notes about the focus and topic notes link everything they cite", () => {
    const ix6 = new PassageIndex(createReader(), {});
    ix6.setFile("Isaiah 41v4.md", "Isa 44:6.\n\nRev 1:17.", "Isaiah 41v4");
    ix6.setFile("Topic.md", "Isa 41:4.\n\nRev 22:13.", "First and Last");
    const isa = { book: 23, c1: 41, v1: 4, c2: 41, v2: 4 };
    assert.deepStrictEqual(verseStar(ix6, isa).dots.map((d) => format(d.ref)), ["Isaiah 44:6", "Revelation 1:17"]);
    const withTopic = verseStar(ix6, isa, { isTopic: (p) => p === "Topic.md", hubKey: "t" });
    assert.deepStrictEqual(withTopic.dots.map((d) => format(d.ref)), ["Isaiah 44:6", "Revelation 1:17", "Revelation 22:13"]);
  });
  t("star: chapter-only and broad refs are not dots; Bible order", () => {
    assert.deepStrictEqual(st.dots.map(label), ["Zechariah 12:10", "Matthew 1:1", "Matthew 24:30", "John 19:37"]);
  });
  t("star: a range focus; reuse until a note changes", () => {
    const r = verseStar(ix, { book: 38, c1: 12, v1: 10, c2: 12, v2: 14 });
    assert.strictEqual(r.notes, 4); // the hub counts when isHub isn't given
    assert.ok(r.dots.some((d) => d.book === 66 && d.ref.v1 === 7));
    assert.strictEqual(verseStar(ix, focus, { isHub, hubKey: "index" }), st);
    ix.setFile("q/New.md", "Rev 1:7; Ps 2:9.", "New");
    assert.strictEqual(verseStar(ix, focus, { isHub, hubKey: "index" }).notes, 4);
  });
}
t("alsoCited leaves hub notes out", () => {
  const ix = new PassageIndex(createReader(), {});
  ix.setFile("a.md", "Rev 1:7; Dan 7:13.", "A");
  ix.setFile("Revelation - Index.md", "Rev 1:7; Dan 7:13; Zech 12:10.", "Revelation - Index");
  const f = { book: 66, c: 1, v: null };
  assert.strictEqual(alsoCited(ix, f).notes, 2);
  const h = alsoCited(ix, f, { isHub: (p) => p.includes("Index"), hubKey: "index" });
  assert.strictEqual(h.notes, 1); assert.deepStrictEqual(h.entries.map((x) => `${x.book}:${x.c}`), ["27:7"]);
});
t("alsoCited counts only what a note on another passage cites near the focus (0.4.0)", () => {
  const ix = new PassageIndex(createReader(), {});
  // A long note on Daniel 7: Rev 1:7 in one paragraph, other things elsewhere.
  ix.setFile("Daniel 7v13-14.md", ["Coming with the clouds.", "", "Rev 1:7 takes it up with Zech 12:10.", "", "Elsewhere: Ps 110:1 and Mark 14:62.", "", "### 7:9", "Ezek 1:26."].join("\n"), "Daniel 7v13-14");
  // A note on Revelation 1: everything counts.
  ix.setFile("Revelation 1v7-8.md", ["Dan 7:13.", "", "Later: Rev 22:13 and Isa 41:4."].join("\n"), "Revelation 1v7-8");
  // A topic note: everything counts.
  ix.setFile("Son of Man.md", ["Rev 1:13.", "", "Matt 24:30."].join("\n"), "Son of Man");
  // A long note on Matthew with a verse heading on Rev 1.
  ix.setFile("Matthew 24v29-31.md", ["Isa 13:10.", "", "### Rev 1:7 the same pairing", "Zech 12:10 again.", "", "## Other", "Luke 21:27."].join("\n"), "Matthew 24v29-31");
  const a = alsoCited(ix, { book: 66, c: 1, v: null }, { isTopic: (p) => p.startsWith("Son"), hubKey: "t" });
  const ch = (b, c) => a.entries.find((x) => x.book === b && x.c === c)?.notes.map((x) => x.path).sort() || [];
  assert.strictEqual(a.notes, 4);
  assert.deepStrictEqual(ch(38, 12), ["Daniel 7v13-14.md", "Matthew 24v29-31.md"]); // same paragraph; under the Rev 1:7 heading
  assert.deepStrictEqual(ch(19, 110), [], "another paragraph of the Daniel note");
  assert.deepStrictEqual(ch(26, 1), [], "under another verse heading");
  assert.deepStrictEqual(ch(27, 7), ["Daniel 7v13-14.md", "Revelation 1v7-8.md"]); // the Daniel note's own main passage; the Rev note
  assert.deepStrictEqual(ch(23, 41), ["Revelation 1v7-8.md"], "a note on Rev 1 counts whole");
  assert.deepStrictEqual(ch(40, 24), ["Matthew 24v29-31.md", "Son of Man.md"]); // Matthew's own passage; the topic note whole
  assert.deepStrictEqual(ch(23, 13), [], "Matthew's first paragraph isn't near Rev 1");
  assert.deepStrictEqual(ch(42, 21), [], "Matthew's other section");
});
console.log(`coverage: ${n} passed`);
