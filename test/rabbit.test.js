// Run: node test/rabbit.test.js
// Rabbit trails: which lines of the rabbit-trails note come back in a note's pane.
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const idx = new PassageIndex(createReader(), { broadChapters: 2 });

const R = "Rabbit trails.md";
idx.setFile(R, [
  "- Daniel 7:13 — why does John join it to Zech 12:10? (from [[Revelation 1v7-8]], 2026-11-14)",
  "- Psalms 68:4 (from [[Rider on the Clouds Motif]], 2026-11-14)",
  "- Isaiah 53:7 — lamb (2026-11-14)",
].join("\n"), "Rabbit trails");
idx.setFile("Revelation 1v7-8.md", "Coming with the clouds.", "Revelation 1v7-8");
idx.setFile("Daniel 7v9-14.md", "The Ancient of Days.", "Daniel 7v9-14");
idx.setFile("Zech.md", "Zech 12:10 — they will look on me.", "Zech");
idx.setFile("Survey.md", "An overview of Isaiah 40-66.", "Survey");
idx.setFile("Rider.md", "Psalm 68:4 rides the clouds; Dan 7:13 too.", "Rider");

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const lines = (path, from) => idx.parkedFor(path, R, from).map((x) => [x.line, x.passage, x.fromHere]);

check("saved passage comes back in a note on it", lines("Daniel 7v9-14.md"), [[0, "Daniel 7:13", false]]);
check("only the first reference counts (Zech in the reason doesn't)", lines("Zech.md"), []);
check("the 'from' link isn't read as the saved passage", lines("Revelation 1v7-8.md"), []);
check("lines saved from a note show there (fromLines)", lines("Revelation 1v7-8.md", [0]), [[0, "Daniel 7:13", true]]);
check("a broad reference doesn't pull lines in", lines("Survey.md"), []);
check("several lines, in note order", lines("Rider.md"), [[0, "Daniel 7:13", false], [1, "Psalms 68:4", false]]);
check("nothing in the rabbit-trails note itself", lines(R), []);
check("no rabbit-trails note: nothing", idx.parkedFor("Rider.md", "Missing.md"), []);

check("the tab lists every saved line, in note order", idx.parkedAll(R).map((x) => [x.line, x.passage]),
  [[0, "Daniel 7:13"], [1, "Psalms 68:4"], [2, "Isaiah 53:7"]]);
check("no rabbit-trails note: empty tab", idx.parkedAll("Missing.md"), []);

// The Map leaves the rabbit-trails note out (Isaiah 53:7 is saved there and nowhere else).
const { coverage } = require("../src/coverage");
const isa = (skip) => coverage(idx, 23, { broadChapters: 2, skip }).chapters[52].verse[6].mentions;
check("Map counts the saved passage without skip", isa(null), 1);
check("Map leaves the rabbit-trails note out", isa(R), 0);

console.log(fail ?`${fail} failed, ${pass} passed` : `All ${pass} passed`);
process.exit(fail ? 1 : 0);
