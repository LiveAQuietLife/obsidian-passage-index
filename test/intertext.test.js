// Run: node test/intertext.test.js
// Intertext lines: relation, citation and description are read after the indexed reference.
const { createReader } = require("../src/reader");
const { PassageIndex } = require("../src/passage-index");
const idx = new PassageIndex(createReader(), { broadChapters: 2 });

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL ${name}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
};
const read = (lines) => {
  idx.setFile("Mark 14v62.md", ["## Intertexts", ...lines].join("\n"), "Mark 14v62");
  return idx.files.get("Mark 14v62.md").intertexts.map((x) => [x.refText, x.relation, x.citation, x.description]);
};

check("plain line", read(["- Dan 7:13 (quotes; France 2002, 612) — Son of Man"]),
  [["Dan 7:13", "quotes", "France 2002, 612", "Son of Man"]]);
check("citation only", read(["- Ps 110:1 (DBI, 769)"]),
  [["Ps 110:1", "unspecified", "DBI, 769", ""]]);
// Bug 3: the same text earlier on the line, not indexed (masked link target).
check("same text earlier in a link target", read(["- [[Son of Man#Dan 7:13 (echoes)|Son of Man]]: Dan 7:13 (quotes; France 2002, 612)"]),
  [["Dan 7:13", "quotes", "France 2002, 612", ""]]);
check("same text earlier, indented and with CRLF", read(["  - [[Son of Man#Dan 7:13 (echoes)|motif]]: Dan 7:13 (alludes; Marcus, 1008)\r"]),
  [["Dan 7:13", "alludes to", "Marcus, 1008", ""]]);

console.log(fail ? `${fail} failed, ${pass} passed` : `All ${pass} passed`);
process.exit(fail ? 1 : 0);
