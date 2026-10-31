// Trim a complete.json from the Free Use Bible API into the plugin's stored format.
// Run: node tools/trim-bible.js <complete.json> <out.json>
//   e.g. node tools/trim-bible.js BSB-complete.json bibles/BSB.json
// Source: https://bible.helloao.org/api/BSB/complete.json (public domain; no key needed).
const fs = require("fs");
const path = require("path");
const { trimBible } = require("../src/bible");

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("Usage: node tools/trim-bible.js <complete.json> <out.json>"); process.exit(1); }
const bible = trimBible(JSON.parse(fs.readFileSync(src, "utf8")));
fs.mkdirSync(path.dirname(out), { recursive: true });
const json = JSON.stringify(bible);
fs.writeFileSync(out, json);
let verses = 0, missing = 0;
for (const chs of Object.values(bible.books)) for (const ch of chs) for (const v of ch) (v === null ? missing++ : verses++);
console.log(`${bible.id}: ${Object.keys(bible.books).length} books, ${verses} verses (${missing} left out), ${(json.length / 1e6).toFixed(1)} MB → ${out}`);
