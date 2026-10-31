// Scan the vault with our reader and compare against conVERsum's index.
// Run: PI_VAULT=/path/to/vault node test/compare-conversum.js [--show N]
// Compares at the level of (note, book, start chapter, start verse); chapter-only = verse 1.
// Whole-book references in conVERsum (no chapter in its text) are counted separately.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createReader } = require("../src/reader");

const VAULT = process.env.PI_VAULT;
if (!VAULT) { console.error("Set PI_VAULT to the vault folder, e.g. PI_VAULT=\"/path/to/vault\" node test/compare-conversum.js ..."); process.exit(1); }
const DB = path.join(VAULT, ".obsidian/plugins/conversum/conversum-index.db");
const SKIP = (name) => name.startsWith("."); // Obsidian ignores dot-folders too
const show = +(process.argv[process.argv.indexOf("--show") + 1] || 15);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const reader = createReader();
const ours = new Map(); // key -> {file, text, line}
const t0 = Date.now();
const files = walk(VAULT);
let refCount = 0;
for (const f of files) {
  const rel = path.relative(VAULT, f).split(path.sep).join("/");
  const text = fs.readFileSync(f, "utf8");
  const refs = [...reader.parseName(path.basename(f)), ...reader.parse(text)];
  refCount += refs.length;
  for (const r of refs) {
    if (r.book > 66) continue; // conVERsum is Bible-only
    const key = `${rel}|${r.book}|${r.c1}|${r.v1 ?? 1}`;
    if (!ours.has(key)) ours.set(key, { rel, text: r.text, line: r.line });
  }
}
const ms = Date.now() - t0;

const db = new DatabaseSync(DB, { readOnly: true });
const theirs = new Map();
let wholeBook = 0;
for (const row of db.prepare(`select o.file_path f, d.book_id b, d.chapter c, d.start_verse v, d.formatted t
                              from ref_occurrences o join ref_detail d on d.range_key=o.range_key`).all()) {
  if (!/\d/.test(row.t.replace(/^[123]\s/, ""))) { wholeBook++; continue; }
  if (!fs.existsSync(path.join(VAULT, row.f))) continue;
  theirs.set(`${row.f}|${row.b}|${row.c}|${row.v || 1}`, row.t); // conVERsum sometimes stores chapter-only as verse 0
}

const both = [...ours.keys()].filter((k) => theirs.has(k));
const onlyOurs = [...ours.keys()].filter((k) => !theirs.has(k));
const onlyTheirs = [...theirs.keys()].filter((k) => !ours.has(k));

console.log(`Notes scanned: ${files.length}   references read: ${refCount}   time: ${ms} ms`);
console.log(`Bible note/verse pairs — ours: ${ours.size}   conVERsum: ${theirs.size} (+${wholeBook} whole-book, not compared)`);
console.log(`Agree: ${both.length}   only ours: ${onlyOurs.length}   only conVERsum: ${onlyTheirs.length}\n`);

const sample = (arr) => arr.sort(() => Math.random() - 0.5).slice(0, show);
console.log("— Only conVERsum (possible misses) —");
for (const k of sample(onlyTheirs)) console.log(`  ${theirs.get(k)}   ${k.split("|")[0]}`);
console.log("\n— Only ours (possible false matches, or things conVERsum misses) —");
for (const k of sample(onlyOurs)) { const o = ours.get(k); console.log(`  "${o.text}"  line ${o.line + 1}   ${o.rel}`); }
