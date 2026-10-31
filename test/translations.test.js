// Other translations from the Free Use Bible API. Downloads aren't kept in the project:
// pass a folder of complete.json files named <id>.json.
// Run: node test/translations.test.js <folder>
const fs = require("fs");
const path = require("path");
const { createReader } = require("../src/reader");
const { trimBible, passageText, TRANSLATIONS } = require("../src/bible");

const dir = process.argv[2];
if (!dir) { console.error("Usage: node test/translations.test.js <folder of <id>.json>"); process.exit(1); }
const reader = createReader();
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : (fail++, console.log("FAIL", name, extra)); };
const load = (id) => {
  const f = path.join(dir, id + ".json");
  return fs.existsSync(f) ? trimBible(JSON.parse(fs.readFileSync(f, "utf8"))) : null;
};
const look = (b, s) => passageText(b, reader.parse(s)[0]);
const first = (b, s) => look(b, s).verses[0]?.text || "";

const kjv = load("eng_kjv");
if (kjv) {
  check("KJV short label", kjv.short === "KJV", kjv.short);
  check("KJV words of Jesus kept", /Blessed are the poor in spirit/.test(first(kjv, "Matt 5:3")), first(kjv, "Matt 5:3"));
  check("KJV Dan 12:3", /firmament/.test(first(kjv, "Dan 12:3")));
}
const web = load("ENGWEBP");
if (web) check("WEB words of Jesus (poetry) kept", /poor in spirit/.test(first(web, "Matt 5:3")), first(web, "Matt 5:3"));
const bre = load("eng_bre");
if (bre) {
  check("Brenton Psalm title kept (LXX: title is v1)", /Psalm of David/.test(first(bre, "Ps 3:1")), first(bre, "Ps 3:1"));
  check("Brenton has Tobit", look(bre, "Tobit 1:1").ok);
  check("Brenton has Sirach", look(bre, "Sir 1:1").ok);
  check("Brenton Daniel (Greek, DAG)", look(bre, "Dan 12:3").ok, look(bre, "Dan 12:3").note);
  check("Brenton has no NT", !look(bre, "Matt 5:3").ok && /doesn't include/.test(look(bre, "Matt 5:3").note));
}
const dra = load("eng_dra");
if (dra) check("Douay-Rheims 1 Maccabees", look(dra, "1 Macc 1:1").ok);
const jps = load("eng_jps");
if (jps) check("JPS Dan 12:3", /firmament/.test(first(jps, "Dan 12:3")));
const net = load("eng_net");
if (net) check("NET Dan 12:3 as poetry", first(net, "Dan 12:3").split("\n").length === 4, JSON.stringify(first(net, "Dan 12:3")));
const leb = load("eng_leb");
if (leb) check("LEB Dan 12:3 joins around notes", /for the many will be like the stars/.test(first(leb, "Dan 12:3")), first(leb, "Dan 12:3"));
const lsv = load("eng_lsv");
if (lsv) check("LSV Dan 12:3", /expanse/.test(first(lsv, "Dan 12:3")));

// Every file in the folder: trims, and no suspicious joins.
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const b = load(f.replace(/\.json$/, ""));
  let n = 0, empty = 0;
  for (const chs of Object.values(b.books)) for (const ch of chs) for (const v of ch) {
    if (v === "") empty++;
    if (v && /  |\w\s[,.;:]|\n[,.;:]/.test(v)) n++; // "— ;" is the JPS's own style
  }
  check(`${b.short}: no double spaces / space before punctuation`, n === 0, n);
  check(`${b.short}: no empty verses`, empty === 0, empty);
}
console.log(`${pass} passed, ${fail} failed (catalog: ${TRANSLATIONS.length} translations)`);
process.exit(fail ? 1 : 0);
