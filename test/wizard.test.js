// Bible wizard output. Run: node test/wizard.test.js <BSB complete.json> [KJV complete.json] [--show "Revelation 1"]
const fs = require("fs");
const { planBible } = require("../src/wizard");

const [bsbFile, kjvFile] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !process.argv[process.argv.indexOf(a) - 1]?.startsWith("--show"));
const showIdx = process.argv.indexOf("--show");
const show = showIdx > 0 ? process.argv[showIdx + 1] : null;
if (!bsbFile) { console.error("Usage: node test/wizard.test.js <BSB complete.json> [KJV complete.json] [--show \"Revelation 1\"]"); process.exit(1); }
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : (fail++, console.log("FAIL", name, extra)); };
const file = (plan, p) => plan.files.find((f) => f.path === p)?.content || "";

const bsb = JSON.parse(fs.readFileSync(bsbFile, "utf8"));
const p = planBible(bsb, {}, "BSB", "Berean Standard Bible");
check("1,189 chapters", p.chapters === 1189, p.chapters);
check("66 books", p.books === 66);
check("files = chapters + books + 1 index", p.files.length === 1189 + 66 + 1, p.files.length);
check("unique paths", new Set(p.files.map((f) => f.path.toLowerCase())).size === p.files.length);
const rev1 = file(p, "Bible/BSB/Revelation/Revelation 1.md");
check("Rev 1 path", !!rev1);
check("Rev 1 title", rev1.includes("\n# Revelation 1\n"));
check("Rev 1 verse 12 heading then text", /\n###### 12\nThen I turned to see the voice/.test(rev1));
check("Rev 1 no blank line inside a verse", !/###### \d+\n\n/.test(rev1));
check("Rev 1 frontmatter", rev1.startsWith('---\ntranslation: "BSB"\nbook: "Revelation"\nchapter: 1\naliases: ["Rev 1"]\ntags: ["bible"]\ncssclasses: ["bible-chapter"]\n---'), rev1.slice(0, 200));
check("Rev 1 nav", rev1.includes("[[Jude 1|← Jude 1]] | [[Revelation (BSB)|Revelation]] | [[Revelation 2|Revelation 2 →]]"), rev1.match(/.*Revelation 2 →.*/)?.[0]);
check("Rev 1 no section headings by default", !/\n## /.test(rev1));
check("Rev 1 no footnotes by default", !rev1.includes("[^"));
check("Rev 22 has no next", !/→/.test(file(p, "Bible/BSB/Revelation/Revelation 22.md")));
const ps3 = file(p, "Bible/BSB/Psalms/Psalms 3.md");
check("Psalm title kept in italics", ps3.includes("*A Psalm of David, when he fled from his son Absalom.*"));
check("Psalm alias", ps3.includes('aliases: ["Ps 3", "Psalm 3"]'), ps3.match(/aliases.*/)?.[0]);
check("Poetry indent as a pi-indent span", /\n<span class="pi-indent"><\/span>How many rise up against me!/.test(ps3), JSON.stringify(ps3.slice(ps3.indexOf("###### 1"), ps3.indexOf("###### 1") + 120)));
check("Book index (always suffixed)", file(p, "Bible/BSB/Revelation/Revelation (BSB).md").includes("[[Revelation 22|22]]"));
check("Bible index", file(p, "Bible/BSB/Berean Standard Bible.md").includes("- [[Genesis (BSB)|Genesis]]: [[Genesis 1|1]]"));
const matt17 = file(p, "Bible/BSB/Matthew/Matthew 17.md");
check("left-out verse skipped (Matt 17:21)", matt17.includes("###### 20") && !matt17.includes("###### 21\n") && matt17.includes("###### 22"));

const q = planBible(bsb, { main: false, numbered: true, sections: true, footnotes: true, breadcrumbs: true }, "BSB", "Berean Standard Bible");
const r1 = file(q, "Bible/BSB/66. Revelation/Revelation 1 (BSB).md");
check("suffixed + numbered path", !!r1);
check("section heading", r1.includes("\n## Prologue\n"));
check("footnote marker after its word", /###### 1\n[^\n]*soon\[\^1\] come to pass/.test(r1), r1.match(/###### 1\n.*/)?.[0]);
check("footnote markers numbered in order", /###### 4\n[\s\S]*?Asia:\[\^2\][\s\S]*?spirits\[\^3\]/.test(r1), r1.match(/###### 4\n[^#]*/)?.[0]);
check("footnote definitions", /\n\[\^1\]: Or suddenly or quickly/.test(r1));
check("breadcrumbs", r1.includes('up: "[[Revelation (BSB)]]"') && r1.includes('next: "[[Revelation 2 (BSB)]]"'));
check("suffixed alias", r1.includes('aliases: ["Rev 1 (BSB)"]'));
check("suffixed nav", r1.includes("[[Revelation 2 (BSB)|Revelation 2 →]]"));

const off = planBible(bsb, { nav: false, index: false, aliases: false }, "BSB");
check("index off: chapters only", off.files.length === 1189);
check("nav off", !file(off, "Bible/BSB/Revelation/Revelation 1.md").includes("→"));
check("aliases off", !file(off, "Bible/BSB/Revelation/Revelation 1.md").includes("aliases"));

if (kjvFile) {
  const kjv = planBible(JSON.parse(fs.readFileSync(kjvFile, "utf8")), { main: false }, "KJV", "King James Version");
  check("KJV chapters", kjv.chapters === 1189, kjv.chapters);
  check("KJV words of Jesus", file(kjv, "Bible/KJV/Matthew/Matthew 5 (KJV).md").includes("Blessed are the poor in spirit"));
}
if (show) {
  const f = p.files.find((x) => x.path.endsWith(`/${show}.md`));
  console.log(f ? `\n----- ${f.path}\n${f.content.slice(0, 1800)}` : `(no ${show})`);
}
const bytes = p.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
console.log(`${pass} passed, ${fail} failed. BSB default: ${p.files.length} files, ${(bytes / 1e6).toFixed(1)} MB.`);
process.exit(fail ? 1 : 0);
