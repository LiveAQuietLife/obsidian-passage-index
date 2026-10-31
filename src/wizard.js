// Passage Index — Bible wizard: turn a translation from the Free Use Bible API into notes.
// No Obsidian code: planBible() returns the folders and files to create, so the format can
// be tested from node. The plugin (main.js) does the downloading and writing.
//
// Format (decided 2026-10-30; see design notes, *Bible wizard*):
//   {root}/{SHORT}/{Book}/{Book} {ch}.md   (other translations: "{Book} {ch} ({SHORT}).md")
//   # {Book} {ch}, then each verse as "###### {v}" with its text on the next line
//   (Bible Study Kit style, so Bible Linker and Local Bible Ref can read it).
const { BIBLE } = require("./books");
const { USFM, verseText } = require("./bible");

// SBL abbreviations for the short-name aliases ("Rev 1").
const ABBR = [
  "Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1 Sam", "2 Sam", "1 Kgs", "2 Kgs",
  "1 Chr", "2 Chr", "Ezra", "Neh", "Esth", "Job", "Ps", "Prov", "Eccl", "Song", "Isa", "Jer", "Lam",
  "Ezek", "Dan", "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech",
  "Mal", "Matt", "Mark", "Luke", "John", "Acts", "Rom", "1 Cor", "2 Cor", "Gal", "Eph", "Phil", "Col",
  "1 Thess", "2 Thess", "1 Tim", "2 Tim", "Titus", "Phlm", "Heb", "Jas", "1 Pet", "2 Pet", "1 John",
  "2 John", "3 John", "Jude", "Rev",
];

const DEFAULT_OPTIONS = {
  root: "Bible",       // top folder
  main: true,          // main translation: plain names ("Revelation 1"); otherwise suffixed
  numbered: false,     // "66. Revelation" book folders
  sections: false,     // section headings ("## The Seven Golden Lampstands")
  footnotes: false,    // translation footnotes as [^n]
  nav: true,           // previous/next chapter links above and below the text
  index: true,         // a note per book, and one for the whole translation
  aliases: true,       // "Rev 1" and "Revelation 1"
  breadcrumbs: false,  // up / previous / next properties (Breadcrumbs plugin)
};

// File and folder names can't hold these.
const safe = (s) => s.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim();
const yamlStr = (s) => JSON.stringify(String(s));
const link = (target, text) => (text && text !== target ? `[[${target}|${text}]]` : `[[${target}]]`);

// The books in a download, with their names, abbreviations and canonical numbers.
// Bible books take PI's names (books.js); others (Apocrypha) keep the API's name.
function bookList(complete) {
  let extra = 66;
  return (complete.books || []).map((b) => {
    const i = USFM.indexOf(b.id);
    if (i >= 0) return { code: b.id, num: i + 1, name: BIBLE[i][1], abbr: ABBR[i], api: b };
    const name = safe(b.commonName || b.name || b.id);
    return { code: b.id, num: ++extra, name, abbr: name, api: b };
  }).sort((a, b) => a.num - b.num);
}

// complete.json + options → { base, indexName, folders: [path], files: [{ path, content }], chapters, books }
// short / name: the translation's label and full name (from PI's catalog when known).
function planBible(complete, options = {}, short, name) {
  const o = { ...DEFAULT_OPTIONS, ...options };
  const t = complete.translation || {};
  const tr = safe(short || t.shortName || t.id || "Bible");
  const trName = safe(name || t.englishName || t.name || tr);
  const root = (o.root || "Bible").split("/").map(safe).filter(Boolean).join("/") || "Bible";
  const base = `${root}/${tr}`;
  const sfx = o.main ? "" : ` (${tr})`;
  const books = bookList(complete);
  const folders = [root, base];
  const files = [];
  let chapters = 0;

  const bookFolder = (bk) => `${base}/${o.numbered ? `${String(bk.num).padStart(2, "0")}. ` : ""}${bk.name}`;
  const chName = (bk, c) => `${bk.name} ${c}${sfx}`;
  // Book notes always carry the translation ("Revelation (BSB)"): study vaults often have
  // their own "Revelation" note already. Chapter notes keep plain names for the main one.
  const bookNote = (bk) => `${bk.name} (${tr})`;

  books.forEach((bk, bi) => {
    const dir = bookFolder(bk);
    folders.push(dir);
    const chs = bk.api.chapters || [];
    chs.forEach((c, ci) => {
      const n = c.chapter.number || ci + 1;
      chapters++;
      // Previous/next run across books, so Malachi 4 leads to Matthew 1.
      const prev = ci > 0 ? { bk, n: chs[ci - 1].chapter.number || ci } :
        bi > 0 ? { bk: books[bi - 1], n: (books[bi - 1].api.chapters || []).length } : null;
      const next = ci < chs.length - 1 ? { bk, n: chs[ci + 1].chapter.number || ci + 2 } :
        bi < books.length - 1 ? { bk: books[bi + 1], n: 1 } : null;
      files.push({ path: `${dir}/${chName(bk, n)}.md`, content: chapterNote(bk, n, c.chapter, { o, tr, sfx, prev, next, chName, bookNote, trName }) });
    });
    if (o.index) files.push({ path: `${dir}/${bookNote(bk)}.md`, content: bookIndex(bk, chs, { o, tr, chName, bookNote, trName, sfx }) });
  });
  if (o.index) files.push({ path: `${base}/${trName}.md`, content: bibleIndex(books, { o, tr, chName, bookNote, trName }) });
  return { base, root, tr, trName, indexPath: o.index ? `${base}/${trName}.md` : null, folders, files, chapters, books: books.length };
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || (Array.isArray(v) && !v.length)) continue;
    lines.push(Array.isArray(v) ? `${k}: [${v.map(yamlStr).join(", ")}]` : `${k}: ${typeof v === "number" ? v : yamlStr(v)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function chapterNote(bk, n, chapter, { o, tr, sfx, prev, next, chName, bookNote }) {
  // Short-name aliases: "Rev 1" (or "Rev 1 (KJV)"), plus "Psalm 23" for the Psalms.
  const aliases = [];
  if (o.aliases) {
    if (bk.abbr !== bk.name) aliases.push(`${bk.abbr} ${n}${sfx}`);
    if (bk.num === 19) aliases.push(`Psalm ${n}${sfx}`);
  }
  const fm = { translation: tr, book: bk.name, chapter: n, aliases, tags: ["bible"], cssclasses: ["bible-chapter"] };
  if (o.breadcrumbs) {
    fm.up = o.index ? `[[${bookNote(bk)}]]` : undefined;
    fm.previous = prev ? `[[${chName(prev.bk, prev.n)}]]` : undefined;
    fm.next = next ? `[[${chName(next.bk, next.n)}]]` : undefined;
  }

  // Footnotes, numbered from 1 in each chapter.
  const notes = new Map(), noteText = new Map((chapter.footnotes || []).map((f) => [f.noteId, f.text]));
  const onNote = o.footnotes ? (id) => {
    if (!noteText.has(id)) return "";
    if (!notes.has(id)) notes.set(id, notes.size + 1);
    return `[^${notes.get(id)}]`;
  } : undefined;

  const out = [frontmatter(fm), `# ${bk.name} ${n}`, ""];
  const navLine = () => [
    prev ? link(chName(prev.bk, prev.n), `← ${prev.bk.name} ${prev.n}`) : null,
    o.index ? link(bookNote(bk), bk.name) : null,
    next ? link(chName(next.bk, next.n), `${next.bk.name} ${next.n} →`) : null,
  ].filter(Boolean).join(" | ");
  if (o.nav) out.push(navLine(), "", "***", "");

  const plain = (content) => content.map((x) => (typeof x === "string" ? x : x && typeof x.text === "string" ? x.text : "")).join(" ").replace(/\s+/g, " ").trim();
  // Verses follow each other with no empty line between them ("###### 1", text, "###### 2",
  // text…), so they read one verse per line. A verse's text still ends at the next heading,
  // which is all Bible Linker needs. Section headings and Psalm titles get empty lines around.
  const gap = () => { if (out[out.length - 1] !== "") out.push(""); };
  for (const it of chapter.content || []) {
    if (it.type === "heading" && o.sections) {
      const h = plain(it.content);
      if (h) { gap(); out.push(`## ${h}`, ""); }
    } else if (it.type === "hebrew_subtitle") {
      // A Psalm's title is part of the text: kept as an italic line before verse 1.
      const h = plain(it.content);
      if (h) { gap(); out.push(`*${h}*`, ""); }
    } else if (it.type === "verse") {
      const text = verseText(it.content, onNote);
      if (!text) continue; // left out of this translation (e.g. Luke 17:36 in the WEB)
      // Poetry: one line per line. An indent is a small tag that PI's styles widen
      // (.pi-indent). Reading view strips whitespace at the start of a line, even an em space
      // or "&emsp;", and leading tabs or spaces could turn the line into code.
      const body = text.split("\n").map((l) => l.replace(/^\t+/, (m) => '<span class="pi-indent"></span>'.repeat(m.length))).join("\n");
      out.push(`###### ${it.number}`, body);
    }
  }
  gap();
  if (o.nav) out.push("***", "", navLine(), "");
  if (notes.size) {
    out.push("");
    for (const [id, num] of notes) out.push(`[^${num}]: ${String(noteText.get(id)).replace(/\s+/g, " ").trim()}`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n*$/, "\n");
}

function bookIndex(bk, chs, { o, tr, chName, bookNote, trName, sfx }) {
  const fm = { translation: tr, book: bk.name, aliases: o.aliases && bk.abbr !== bk.name ? [`${bk.abbr}${sfx}`] : [], tags: ["bible"], cssclasses: ["bible-book"] };
  if (o.breadcrumbs) fm.up = `[[${trName}]]`;
  const nums = chs.map((c, i) => c.chapter.number || i + 1);
  return [
    frontmatter(fm),
    `# ${bk.name}`,
    "",
    `${link(trName)} · ${nums.length} chapter${nums.length > 1 ? "s" : ""}`,
    "",
    nums.map((n) => link(chName(bk, n), String(n))).join(" · "),
    "",
  ].join("\n");
}

function bibleIndex(books, { tr, chName, bookNote, trName, o }) {
  const fm = { translation: tr, tags: ["bible"], cssclasses: ["bible-index"] };
  const lines = [frontmatter(fm), `# ${trName}`, ""];
  const ot = books.filter((b) => b.num <= 39), nt = books.filter((b) => b.num >= 40 && b.num <= 66), other = books.filter((b) => b.num > 66);
  const section = (title, list) => {
    if (!list.length) return;
    lines.push(`## ${title}`, "");
    for (const b of list) lines.push(`- ${link(bookNote(b), b.name)}: ${(b.api.chapters || []).map((c, i) => link(chName(b, c.chapter.number || i + 1), String(c.chapter.number || i + 1))).join(" ")}`);
    lines.push("");
  };
  section("Old Testament", ot);
  section("New Testament", nt);
  section("Other books", other);
  return lines.join("\n");
}

module.exports = { DEFAULT_OPTIONS, ABBR, planBible, bookList };
