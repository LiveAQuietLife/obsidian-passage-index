// Run: node test/reader.test.js
const { createReader, format, overlaps } = require("../src/reader");
const reader = createReader();

const cases = [
  // [input, expected formatted refs]
  ["Mark 11:17", ["Mark 11:17"]],
  ["Mk 11:17", ["Mark 11:17"]],
  ["Isa 41:4, 44:6 and 48:12 where", ["Isaiah 41:4", "Isaiah 44:6", "Isaiah 48:12"]],
  ["Isa 41:4 & 44:6", ["Isaiah 41:4", "Isaiah 44:6"]],
  ["Rev 1:17 and 2 others", ["Revelation 1:17"]],
  ["Mark 11.17", ["Mark 11:17"]],
  ["Isa. 56:7", ["Isaiah 56:7"]],
  ["Isaiah 56:7", ["Isaiah 56:7"]],
  ["see [[Isaiah 56v7]]", ["Isaiah 56:7"]],
  ["Mark 11:15–19", ["Mark 11:15–19"]],
  ["Mark 11:15-19", ["Mark 11:15–19"]],
  ["Mark 13", ["Mark 13"]],
  ["Mark 13–14", ["Mark 13–14"]],
  ["Mark 13:14a", ["Mark 13:14"]],
  ["Dan 9:27; 11:31; 12:11", ["Daniel 9:27", "Daniel 11:31", "Daniel 12:11"]],
  ["Phil 1:21–26; 3:20", ["Philippians 1:21–26", "Philippians 3:20"]],
  ["Rom 8:28, 30", ["Romans 8:28", "Romans 8:30"]],
  ["Mark 14:62–15:1", ["Mark 14:62–15:1"]],
  ["1 Sam 16:7", ["1 Samuel 16:7"]],
  ["1Sam 16:7", ["1 Samuel 16:7"]],
  ["II Kings 2:11", ["2 Kings 2:11"]],
  ["1 Cor. 15:3-5", ["1 Corinthians 15:3–5"]],
  ["Song of Solomon 2:4", ["Song of Solomon 2:4"]],
  ["Lk 16:15 and Rev 21:27", ["Luke 16:15", "Revelation 21:27"]],
  ["Rev 17:4–5", ["Revelation 17:4–5"]],
  ["Zech 14 (cf. 14:4; also 14:21)", ["Zechariah 14", "Zechariah 14:4", "Zechariah 14:21"]],
  ["Zech 14 (14:4–5, 8)", ["Zechariah 14", "Zechariah 14:4–5", "Zechariah 14:8"]],
  ["Zech 14 (2 times)", ["Zechariah 14"]],
  ["Jude 5 (3 times)", ["Jude 1:5"]],
  ["Dan 7:9 (see 10:6) and Rev 1:14", ["Daniel 7:9", "Daniel 10:6", "Revelation 1:14"]],
  ["The Son of Man Coming on the Clouds (Matt 24.30)", ["Matthew 24:30"]],
  ["1 En. 46:1", ["1 Enoch 46:1"]],
  ["Jub 1:23", ["Jubilees 1:23"]],
  ["Sir 24:8", ["Sirach 24:8"]],
  ["1 Macc 1:54", ["1 Maccabees 1:54"]],
  ["4 Ezra 13:3", ["4 Ezra 13:3"]],
  ["T. Levi 18:2", ["T. Levi 18:2"]],
  ["1QS 3:13", ["1QS 3:13"]],
  ["Gen 1:1‑ 3", ["Genesis 1:1–3"]],
  ["Rom 1:16; 1 Cor 1:22–24", ["Romans 1:16", "1 Corinthians 1:22–24"]],
  ["Exod 22:31; 1 Kgs 21:23; 22:38; 2 Kgs 9:36", ["Exodus 22:31", "1 Kings 21:23", "1 Kings 22:38", "2 Kings 9:36"]],
  ["(Mk 13:9; 2 Jn 8)", ["Mark 13:9", "2 John 1:8"]],
  ["Jude 6, 9", ["Jude 1:6", "Jude 1:9"]],
  ["Lev 19:31, 20:27", ["Leviticus 19:31", "Leviticus 20:27"]],
  ["Dan 11:31, 12:11", ["Daniel 11:31", "Daniel 12:11"]],
  ["1 Enoch 17–19; 32.3; 2 Enoch 65.10", ["1 Enoch 17–19", "1 Enoch 32:3", "2 Enoch 65:10"]],
  // Things that must NOT match
  ["Mark 5,1–20", ["Mark 5:1–20"]],
  ["Revelation 7: 14", ["Revelation 7:14"]],
  ["Mark 13:9, 10", ["Mark 13:9", "Mark 13:10"]],
  ["Isaiah 42, 49, 50", ["Isaiah 42", "Isaiah 49", "Isaiah 50"]],
  ["Mark\n14", []],
  ["The Greek above is the NA28 text", []],
  ["(Ezek 40–48; 11Q19)", ["Ezekiel 40–48"]],
  ["https://ref.ly/logosres/x?ref=BibleCJB.Ge1.1&off=23012", []],
  ["Exodus 15:22ff and Isa 35:1ff.", ["Exodus 15:22", "Isaiah 35:1"]],
  ["[[Notes/Isaiah 56v7|Isa 56:7]]", ["Isaiah 56:7", "Isaiah 56:7"]],
  ["We mark 3 places.", []],
  ["Mt. Olivet Discourse", []],
  ["I am 5 years old", []],
  ["Am 5:24", ["Amos 5:24"]],
  ["Mark 2026 notes", []],
  ["Mr. Smith", []],
  // 0.1.2: a dash before a numbered book is punctuation, not a range.
  ["Isa 53:1 - 2 Pet 2:22", ["Isaiah 53:1", "2 Peter 2:22"]],
  ["Isa 53:7 - 1 Pet 2:22", ["Isaiah 53:7", "1 Peter 2:22"]],
  ["Ps 110:1 – 1 Cor 15:25", ["Psalms 110:1", "1 Corinthians 15:25"]],
  ["Gen 3 - 1 John 3:8", ["Genesis 3", "1 John 3:8"]],
  ["Dan 9:27; 11:31 - 2 Thess 2:4", ["Daniel 9:27", "Daniel 11:31", "2 Thessalonians 2:4"]],
  ["Gen 1:1 - 2:3", ["Genesis 1:1–2:3"]],
  ["Mark 13:1 - 37", ["Mark 13:1–37"]],
  // 0.1.2: short aliases that are also words count only with chapter:verse.
  ["Is 1 enough?", []],
  ["Re 3 times", []],
  ["Da 2 Kings", []],
  ["Is 53:5", ["Isaiah 53:5"]],
  ["Re 1:8", ["Revelation 1:8"]],
  ["Da 7:13", ["Daniel 7:13"]],
];

let fail = 0;
for (const [input, want] of cases) {
  const got = reader.parse(input).map(format);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL  ${JSON.stringify(input)}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`); }
}

// Filenames
const names = [
  ["Isaiah 56v7.md", ["Isaiah 56:7"]],
  ["Mark 1.12-13 Hub.md", ["Mark 1:12–13"]],
  ["Mark 13v1-37 — The Mt. Olivet Discourse.md", ["Mark 13:1–37"]],
  ["Deuteronomy 32.8 and the sons of God.md", ["Deuteronomy 32:8"]],
];
for (const [input, want] of names) {
  const got = reader.parseName(input).map(format);
  if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log(`FAIL  name ${input}\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`); }
}

// Range overlap
const [a] = reader.parse("Mark 11:17"), [b] = reader.parse("Mark 11:15–19"), [c] = reader.parse("Mark 11"), [d] = reader.parse("Mark 12:1");
const ov = [[a, b, true], [a, c, true], [d, b, false], [d, c, false]];
for (const [x, y, want] of ov) if (overlaps(x, y) !== want) { fail++; console.log(`FAIL  overlap ${format(x)} / ${format(y)}`); }

console.log(fail ? `\n${fail} failing` : `All ${cases.length + names.length + ov.length} passed`);
process.exit(fail ? 1 : 0);
