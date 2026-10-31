// Verse lookup against the stored BSB. Run: node test/bible.test.js [bibles/BSB.json]
const fs = require("fs");
const path = require("path");
const { createReader, format } = require("../src/reader");
const { passageText } = require("../src/bible");

const file = process.argv[2] || path.join(__dirname, "..", "bibles", "BSB.json");
const bible = JSON.parse(fs.readFileSync(file, "utf8"));
const reader = createReader();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : (fail++, console.log("FAIL", name, extra)); };
const look = (s) => { const r = reader.parse(s)[0]; if (!r) throw new Error("no parse: " + s); return passageText(bible, r); };
const show = (s) => {
  const t = look(s);
  console.log(`\n== ${s} → ${format(reader.parse(s)[0])}${t.more ? ` (+${t.more} more)` : ""}${t.note ? " [" + t.note + "]" : ""}`);
  for (const x of t.verses) console.log(`  ${x.c}:${x.v} ${x.text === null ? "(not in text)" : x.text.replace(/\n/g, " / ").replace(/\t/g, "  ")}`);
  return t;
};

let t = show("Dan 12:3");
check("Dan 12:3 one verse", t.ok && t.verses.length === 1 && /shine like the brightness/.test(t.verses[0].text));
t = show("Dan 7:9");
check("Dan 7:9 poetry lines", t.verses[0].text.includes("\n") && t.verses[0].text.includes("\tand the Ancient of Days"));
t = show("Dan 10:6"); check("Dan 10:6", t.ok);
t = show("Ezek 43:2"); check("Ezek 43:2", t.ok && /many waters/.test(t.verses[0].text));
t = show("Rev 1:20"); check("Rev 1:20", t.ok);
t = show("Rev 1:12-16");
check("Rev 1:12-16 five verses", t.verses.length === 5 && t.more === 0);
check("footnote join has a space", /Son of Man, dressed/.test(t.verses[1].text), t.verses[1].text);
t = show("Mark 14:62-15:1");
check("cross-chapter", t.verses.length === 12 && t.verses[11].c === 15 && t.verses[11].v === 1 && t.more === 0);
t = show("Daniel 7");
check("chapter-only: 3 verses + more", t.verses.length === 3 && t.more === 25, t.more);
t = show("Matt 17:20-22");
check("left-out verse is null", t.verses.length === 3 && t.verses[1].text === null);
t = show("Ps 119");
check("long chapter capped", t.verses.length === 3 && t.more === 173);
check("poem line split by a footnote is rejoined", t.verses[0].text.startsWith("Blessed are those whose way"), t.verses[0].text);
t = show("Isa 40:1-31");
check("range capped at 12", t.verses.length === 12 && t.more === 19);
t = show("Jude 9"); check("one-chapter book", t.ok && /Michael/.test(t.verses[0].text));
t = show("Rev 1:21"); check("verse past chapter end", !t.ok);
t = show("1 Enoch 1:9"); check("extra-biblical: no text", !t.ok && /doesn.t include this book/.test(t.note));

t = show("Matt 2:6");
check("closing quote stays on its line (Matt 2:6)", /Israel\.’”$/.test(t.verses[0].text), JSON.stringify(t.verses[0].text.slice(-30)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
