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

// Reverse lines: "quoted by", "alluded to by", "echoed by".
const rev = (line) => {
  idx.setFile("Mark 14v62.md", ["## Intertexts", line].join("\n"), "Mark 14v62");
  const x = idx.files.get("Mark 14v62.md").intertexts[0];
  return [x.relation, x.reverse, x.citation, x.description];
};
check("quoted by", rev("- Acts 13:33 (quoted by; Bratcher 1991, 29) — raising Jesus"), ["quotes", true, "Bratcher 1991, 29", "raising Jesus"]);
check("alluded to by", rev("- Matt 3:17 (alluded to by)"), ["alludes to", true, "", ""]);
check("echoed by", rev("- Rev 2:18 (echoed by; Beale 1999, 259)"), ["echoes", true, "Beale 1999, 259", ""]);
check("forward is not reverse", rev("- Dan 7:13 (quotes; France 2002, 612)"), ["quotes", false, "France 2002, 612", ""]);
check("'by' in the citation doesn't count", rev("- Dan 7:13 (quotes; cited by France 2002, 612)"), ["quotes", false, "cited by France 2002, 612", ""]);

// Where reverse lines show in the pane.
const ix = new PassageIndex(createReader(), { broadChapters: 2 });
const lists = (path) => {
  const r = ix.intertextsFor(path);
  return { uses: r.uses.map((x) => `${x.passage} ${x.relation}`), usedBy: r.usedBy.map((x) => `${x.passage} ${x.relation}`) };
};
ix.setFile("Psalm 2v7-9.md", ["## Intertexts", "- 2 Sam 7:14 (alludes to)", "- Acts 13:33 (quoted by)", "- Rev 2:27 (quoted by)"].join("\n"), "Psalm 2v7-9");
check("own reverse lines go under Used by", lists("Psalm 2v7-9.md"),
  { uses: ["2 Samuel 7:14 alludes to"], usedBy: ["Acts 13:33 quotes", "Revelation 2:27 quotes"] });
ix.setFile("Acts 13v32-33.md", "Some text.", "Acts 13v32-33");
check("another note's view: the reverse line shows under Uses", lists("Acts 13v32-33.md"),
  { uses: ["Psalms 2:7–9 quotes"], usedBy: [] });
ix.setFile("Revelation 2v24-29.md", ["## Intertexts", "- Psalm 2:9 (quotes)"].join("\n"), "Revelation 2v24-29");
check("recorded at both ends: listed once", lists("Psalm 2v7-9.md"),
  { uses: ["2 Samuel 7:14 alludes to"], usedBy: ["Acts 13:33 quotes", "Revelation 2:24–29 quotes"] });
check("recorded at both ends, other end: listed once", lists("Revelation 2v24-29.md"),
  { uses: ["Psalms 2:9 quotes"], usedBy: [] });

// Add intertext…: the line written, and where it goes.
const { intertextLine, addIntertextLine } = require("../src/passage-index");
check("line: forward with citation and note",
  intertextLine({ passage: "2 Sam 7:14", relation: "alludes to", reverse: false, citation: "Kidner 1973, 68", description: "the Davidic covenant" }),
  "- 2 Sam 7:14 (alludes to; Kidner 1973, 68) — the Davidic covenant");
check("line: reverse, nothing else", intertextLine({ passage: "Acts 13:33", relation: "quotes", reverse: true }), "- Acts 13:33 (quoted by)");
check("line: no kind, citation only", intertextLine({ passage: "Ps 110:1", relation: "unspecified", citation: "DBI, 769" }), "- Ps 110:1 (DBI, 769)");
check("line: no kind, nothing else", intertextLine({ passage: "Ps 110:1", relation: "" }), "- Ps 110:1");
check("line: parentheses dropped from the citation", intertextLine({ passage: "Matt 3:17", relation: "echoes", reverse: true, citation: "France (2007), 122" }), "- Matt 3:17 (echoed by; France 2007, 122)");
// Every kind, both ways, reads back as written.
for (const relation of ["quotes", "alludes to", "echoes"]) for (const reverse of [false, true]) {
  const line = intertextLine({ passage: "Acts 13:33", relation, reverse, citation: "Bratcher 1991, 29", description: "raising Jesus" });
  check(`round trip: ${line}`, rev(line), [relation, reverse, "Bratcher 1991, 29", "raising Jesus"]);
}

const L = "- Acts 13:33 (quoted by)";
check("insert: end of the section, before the next heading",
  addIntertextLine("# Ps 2\n\n## Intertexts\n\n- 2 Sam 7:14 (alludes to)\n\n## Notes\n\nText.\n", L),
  "# Ps 2\n\n## Intertexts\n\n- 2 Sam 7:14 (alludes to)\n- Acts 13:33 (quoted by)\n\n## Notes\n\nText.\n");
check("insert: section last in the note",
  addIntertextLine("## Intertexts\n- 2 Sam 7:14\n", L), "## Intertexts\n- 2 Sam 7:14\n- Acts 13:33 (quoted by)\n");
check("insert: empty section, next heading straight after",
  addIntertextLine("### Intertexts\n## Notes\n", L), "### Intertexts\n\n- Acts 13:33 (quoted by)\n\n## Notes\n");
check("insert: a deeper heading stays inside the section",
  addIntertextLine("## Intertexts\n- A 1:1\n### Later\n- B 2:2\n## Notes\n", L), "## Intertexts\n- A 1:1\n### Later\n- B 2:2\n- Acts 13:33 (quoted by)\n\n## Notes\n");
check("insert: no section, adds one at the end",
  addIntertextLine("---\ntags: x\n---\nText.\n\n\n", L), "---\ntags: x\n---\nText.\n\n## Intertexts\n\n- Acts 13:33 (quoted by)\n");
check("insert: heading name from settings",
  addIntertextLine("Text.", L, ["Cross-references"]), "Text.\n\n## Cross-references\n\n- Acts 13:33 (quoted by)\n");
check("insert: matching heading in a code block is skipped",
  addIntertextLine("```\n## Intertexts\n```\n", L), "```\n## Intertexts\n```\n\n## Intertexts\n\n- Acts 13:33 (quoted by)\n");
check("insert: CRLF note keeps CRLF",
  addIntertextLine("## Intertexts\r\n- A 1:1\r\n", L), "## Intertexts\r\n- A 1:1\r\n- Acts 13:33 (quoted by)\r\n");

console.log(fail ? `${fail} failed, ${pass} passed` : `All ${pass} passed`);
process.exit(fail ? 1 : 0);
