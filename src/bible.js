// Passage Index — Bible text for the verse pop-up. No Obsidian code, so it can be tested
// and used from node (tools/trim-bible.js) as well as the plugin.
//
// Stored format (bibles/<id>.json in the plugin folder):
//   { id, short, name, books: { GEN: [ [verse1, verse2, …], … ], … } }
// A chapter is an array indexed by verse − 1. A verse is a string; "\n" starts a new line,
// and a leading "\t" per level indents a poetry line. Verses the translation leaves out
// (e.g. Matt 17:21 in the BSB) are null.

// USFM book codes, in the order of the Bible ids 1–66 in books.js.
const USFM = [
  "GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH",
  "EZR", "NEH", "EST", "JOB", "PSA", "PRO", "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS",
  "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH",
  "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV",
];
// Apocrypha in books.js (ids 101–108). 4 Ezra (109) is 2 Esdras 3–14, so it isn't mapped.
const EXTRA_USFM = { 101: "TOB", 102: "JDT", 103: "WIS", 104: "SIR", 105: "BAR", 106: "1MA", 107: "2MA", 108: "2ES" };
// Greek Esther and Daniel (with the additions) stand in when a Septuagint has no EST/DAN.
const ALT_USFM = { EST: "ESG", DAN: "DAG" };

// Translations offered in settings, all from the Free Use Bible API (bible.helloao.org).
// license (from the API's own license data): pd = public domain; credit = free, credit the
// translation; credit-nd = credit, no changes, no commercial use; terms = no data, see the link.
// sections: true = has section headings good enough to group by (surveyed 2026-10-31: BSB 100%
// of chapters have a heading at the start, LEB 92%, TCENT 90%; NET 6% because the free NET
// leaves out chapter-start headings; all others have none).
const API = "https://bible.helloao.org/api";
const EB = "https://ebible.org/Scriptures/details.php?id=";
const TRANSLATIONS = [
  { id: "BSB", short: "BSB", name: "Berean Standard Bible", group: "Modern", license: "pd", sections: true, url: "https://berean.bible/" },
  { id: "eng_msb", short: "MSB", name: "Majority Standard Bible", group: "Modern", license: "pd", url: EB + "engmsb" },
  { id: "ENGWEBP", short: "WEB", name: "World English Bible", group: "Modern", license: "pd", url: EB + "engwebp" },
  { id: "eng_webpb", short: "WEBBE", name: "World English Bible, British Edition", group: "Modern", license: "pd", url: EB + "engwebpb" },
  { id: "eng_webc", short: "WEBC", name: "World English Bible, Catholic Edition", group: "Modern", license: "pd", url: EB + "eng-web-c" },
  { id: "eng_wmb", short: "WMB", name: "World Messianic Bible", group: "Modern", license: "pd", url: EB + "engwmb" },
  { id: "eng_net", short: "NET", name: "NET Bible", group: "Modern", license: "terms", url: EB + "engnet" },
  { id: "eng_leb", short: "LEB", name: "Lexham English Bible", group: "Modern", license: "credit-nd", sections: true, url: "https://web.archive.org/web/20250803060528/https://lexhampress.com/LEB-License" },
  { id: "eng_fbv", short: "FBV", name: "Free Bible Version", group: "Modern", license: "credit", url: EB + "engfbv" },
  { id: "eng_lsv", short: "LSV", name: "Literal Standard Version", group: "Literal", license: "credit", url: EB + "englsv" },
  { id: "eng_ylt", short: "YLT", name: "Young's Literal Translation", group: "Literal", license: "pd", url: EB + "engylt" },
  { id: "eng_ulb", short: "ULB", name: "Unlocked Literal Bible", group: "Literal", license: "credit", url: EB + "engULB" },
  { id: "eng_kjv", short: "KJV", name: "King James Version", group: "Classic", license: "pd", url: EB + "eng-kjv2006" },
  { id: "eng_asv", short: "ASV", name: "American Standard Version (1901)", group: "Classic", license: "pd", url: EB + "eng-asv" },
  { id: "eng_rv5", short: "RV", name: "Revised Version (1885)", group: "Classic", license: "pd", url: EB + "eng-rv" },
  { id: "eng_dby", short: "Darby", name: "Darby Translation", group: "Classic", license: "pd", url: EB + "engDBY" },
  { id: "eng_wbs", short: "Webster", name: "Webster Bible", group: "Classic", license: "pd", url: EB + "engwebster" },
  { id: "eng_gnv", short: "Geneva", name: "Geneva Bible (1599)", group: "Classic", license: "pd", url: EB + "enggnv" },
  { id: "eng_dra", short: "DRA", name: "Douay-Rheims (1899)", group: "Classic", license: "pd", url: EB + "engDRA" },
  { id: "eng_bre", short: "Brenton", name: "Brenton English Septuagint (LXX numbering)", group: "Old Testament only", license: "pd", url: EB + "eng-Brenton" },
  { id: "eng_jps", short: "JPS", name: "JPS Tanakh (1917)", group: "Old Testament only", license: "pd", url: EB + "engjps" },
  { id: "eng_tnt", short: "Tyndale", name: "Tyndale New Testament", group: "New Testament only", license: "pd", url: EB + "engtnt" },
  { id: "eng_tce", short: "TCENT", name: "Text-Critical English New Testament", group: "New Testament only", license: "credit", sections: true, url: EB + "engtcent" },
  { id: "GHT", short: "GHT", name: "Garth's Hyper-literal Translation", group: "New Testament only", license: "terms", url: "https://www.wiebefamily.org/GHT.htm" },
];
const LICENSES = {
  pd: "Public domain.",
  credit: "Free to use; credit the translation.",
  "credit-nd": "Free to read; credit required; no changes or commercial use.",
  terms: "See the publisher's terms.",
};
function translationInfo(id) {
  return TRANSLATIONS.find((t) => t.id === id) || { id, short: id, name: id, group: "Other", license: "terms", url: "" };
}
function downloadUrl(id) {
  return API + "/" + encodeURIComponent(id) + "/complete.json";
}

// One verse from the Free Use Bible API into the stored string.
// Content items: strings (prose), { text, poem: level } (a poetry line), { lineBreak },
// { noteId } (footnote marker, dropped), and other { text } items kept as prose:
// { wordsOfJesus } (KJV, WEB) and { descriptive } (e.g. Brenton's Psalm titles).
// onNote(noteId) → text to insert for a footnote marker (e.g. "[^3]"); omit to drop markers.
function verseText(content, onNote) {
  let s = "";
  const newLine = () => { if (s && !s.endsWith("\n")) s += "\n"; };
  // The API's strings are trimmed: join with a space unless punctuation makes it wrong.
  const join = (x) => (s && !s.endsWith("\n") && !/^[\s,.;:!?’”)]/.test(x) && !/[\s(“‘—]$/.test(s) ? " " : "") + x;
  // A footnote marker can split one poem line in two ("Blessed" [note] "are those…",
  // Ps 119:1 BSB): rejoin when the next piece, at the same level, starts in lowercase.
  let poem = 0, afterNote = false;
  for (const x of content) {
    if (typeof x === "string" || (x && !x.poem && typeof x.text === "string")) {
      const t = typeof x === "string" ? x : x.text;
      // A closing quote or punctuation after a poem line belongs on that line (Matt 2:6 BSB: ”).
      if (s.endsWith("\n") && /^[,.;:!?’”)\]]/.test(t)) s = s.slice(0, -1);
      s += join(t);
      poem = 0;
    } else if (x && x.poem) {
      // Rejoin a piece that starts with punctuation (LEB) or continues after a note.
      if (s.endsWith("\n") && (/^[,.;:!?’”)\]]/.test(x.text) || (afterNote && poem === x.poem && /^[a-z]/.test(x.text)))) {
        s = s.slice(0, -1);
        s += join(x.text);
      }
      else { newLine(); s += "\t".repeat(Math.max(0, x.poem - 1)) + x.text; }
      s += "\n";
      poem = x.poem;
    } else if (x && x.lineBreak) {
      newLine();
      poem = 0;
    } else if (x && x.noteId !== undefined && onNote) {
      // The marker goes right after the word it follows, before any line break.
      const mark = onNote(x.noteId) || "";
      s = s.endsWith("\n") ? s.slice(0, -1) + mark + "\n" : s + mark;
    }
    afterNote = !!(x && typeof x === "object" && x.noteId !== undefined);
  }
  // Tidy stray spaces before punctuation in the source ("the land , tie", NET).
  // A footnote marker goes after closing quotes and brackets: Israel.’”[^2], not Israel.’[^2]”.
  return s.replace(/\n+$/, "").replace(/[  ]+\n/g, "\n").replace(/(\w) ([,.;:!?])/g, "$1$2")
    .replace(/((?:\[\^\d+\])+)([’”)\]]+)/g, "$2$1").trim();
}

// complete.json from the API → the stored format.
// Section headings are kept in `sections: { DAN: [[c, v, "title"], …] }`: each heading with the
// verse it comes before (copies downloaded before 0.0.35 have none).
function trimBible(complete, short) {
  const t = complete.translation || {};
  const books = {};
  const sections = {};
  for (const b of complete.books || []) {
    const heads = [];
    books[b.id] = (b.chapters || []).map((c, ci) => {
      const verses = [];
      let pending = null;
      for (const it of c.chapter.content) {
        if (it.type === "heading") {
          const h = (it.content || []).map((x) => (typeof x === "string" ? x : x?.text || "")).join(" ").replace(/\s+/g, " ").trim();
          if (h) pending = pending ? `${pending}: ${h}` : h;
        }
        // A verse with only a footnote (Luke 17:36 in the WEB) is left out of the text.
        if (it.type === "verse") {
          verses[it.number - 1] = verseText(it.content) || null;
          if (pending) { heads.push([c.chapter.number || ci + 1, it.number, pending]); pending = null; }
        }
      }
      for (let i = 0; i < verses.length; i++) if (verses[i] === undefined) verses[i] = null;
      return verses;
    });
    if (heads.length) sections[b.id] = heads;
  }
  const id = t.id || t.shortName;
  return { id, short: short || translationInfo(id).short, name: t.englishName || t.name, books, sections };
}

// The section a reference starts in: { title, book, c1, v1, c2, v2 } (where the section starts
// and ends), or null when the translation has no heading before it (or no headings at all).
function sectionOf(bible, ref) {
  const code = ref.book >= 1 && ref.book <= 66 ? USFM[ref.book - 1] : EXTRA_USFM[ref.book];
  const heads = code && bible?.sections && (bible.sections[code] || bible.sections[ALT_USFM[code]]);
  const chapters = code && (bible.books[code] || bible.books[ALT_USFM[code]]);
  if (!heads || !chapters) return null;
  const at = ref.c1 * 1000 + (ref.v1 ?? 1);
  let i = -1;
  for (let k = 0; k < heads.length && heads[k][0] * 1000 + heads[k][1] <= at; k++) i = k;
  if (i < 0) return null;
  const [c1, v1, title] = heads[i];
  let c2, v2;
  if (i + 1 < heads.length) {
    [c2, v2] = heads[i + 1];
    if (v2 > 1) v2--;
    else { c2--; v2 = chapters[c2 - 1]?.length || 1; }
  } else { c2 = chapters.length; v2 = chapters[c2 - 1]?.length || 1; }
  return { title, book: ref.book, c1, v1, c2, v2 };
}

// The text of a reference ({ book, c1, v1, c2, v2 } from the reader).
// Returns { ok, verses: [{ c, v, text }], more, note }:
//   - text is null for a verse the translation leaves out;
//   - a chapter-only reference ("Daniel 7") gives the first `chapterVerses` verses, more > 0;
//   - a long range stops after `maxVerses`, with more = the number not shown.
function passageText(bible, ref, { chapterVerses = 3, maxVerses = 12 } = {}) {
  const label = bible.short || bible.id;
  const code = ref.book >= 1 && ref.book <= 66 ? USFM[ref.book - 1] : EXTRA_USFM[ref.book];
  const chapters = code && (bible.books[code] || bible.books[ALT_USFM[code]]);
  if (!chapters) return { ok: false, verses: [], more: 0, note: `The ${label} doesn't include this book.` };

  const verses = [];
  let total = 0;
  let limit = maxVerses;
  const add = (c, v) => {
    total++;
    if (verses.length < limit) verses.push({ c, v, text: chapters[c - 1][v - 1] ?? null });
  };
  if (ref.v1 === null) {
    // Chapter-only: the opening verses of the first chapter, then "…".
    limit = chapterVerses;
    const ch = chapters[ref.c1 - 1];
    if (!ch) return { ok: false, verses: [], more: 0, note: `The ${label} has no chapter ${ref.c1}.` };
    for (let v = 1; v <= ch.length; v++) add(ref.c1, v);
    for (let c = ref.c1 + 1; c <= ref.c2 && chapters[c - 1]; c++) total += chapters[c - 1].length;
  } else {
    for (let c = ref.c1; c <= ref.c2; c++) {
      const ch = chapters[c - 1];
      if (!ch) break;
      const from = c === ref.c1 ? ref.v1 : 1;
      const to = c === ref.c2 && ref.v2 !== null ? Math.min(ref.v2, ch.length) : ch.length;
      for (let v = from; v <= to; v++) add(c, v);
    }
  }
  if (!verses.length) return { ok: false, verses: [], more: 0, note: `Not found in the ${label}.` };
  return { ok: true, verses, more: total - verses.length, note: "" };
}

module.exports = { USFM, TRANSLATIONS, LICENSES, translationInfo, downloadUrl, verseText, trimBible, passageText, sectionOf };
