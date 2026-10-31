// Print the verse-count table for src/coverage.js from a stored Bible (bibles/<id>.json).
// Run: node tools/verse-counts.js bibles/BSB.json
const fs = require("fs");
const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const { USFM } = require("../src/bible");
const rows = USFM.map((code) => (b.books[code] || []).map((ch) => (ch || []).length).join(","));
console.log("const VERSES = [\n" + rows.map((r, i) => `  /* ${i + 1} ${USFM[i]} */ "${r}",`).join("\n") + "\n];");
