// Passage Index — reference reader.
// One reader shared by the index and the pane (design notes: "one shared reader").
// Plain JS, no dependencies.
//
//   import { createReader } from "./reader.js";
//   const reader = createReader();          // uses books.js
//   reader.parse("See Dan 9:27; 11:31; 12:11 and Mark 13:14a.")
//   reader.parseName("Isaiah 56v7")          // filenames, incl. "v" and "." styles
//
// Each reference: { book, bookName, c1, v1, c2, v2, start, end, line, text }
//   v1/v2 are null for chapter-only references ("Mark 13", "Mark 13–14").

import { BOOKS } from "./books.js";

const SP = "[ \\t\\u00a0]";               // space, tab or no-break space (never a line break)
const MAX_CH = 151;
const MAX_V = 176;
// Books with one chapter: a bare number is a verse ("Jude 6", "2 Jn 8").
const SINGLE_CHAPTER = new Set([31, 57, 63, 64, 65]);

const NUMBER_FORMS = {
  1: ["1", "1st", "I", "First"],
  2: ["2", "2nd", "II", "Second"],
  3: ["3", "3rd", "III", "Third"],
  4: ["4", "4th", "IV", "Fourth"],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (s) => s.replace(/[\s\u00a0]+/g, " ").replace(/\.$/, "").toLowerCase();

function buildAliases(books) {
  const map = new Map(); // normalized alias -> { id, name, verseOnly }
  const add = (alias, id, name, verseOnly = false) => {
    const key = norm(alias);
    if (!map.has(key)) map.set(key, { id, name, verseOnly });
  };
  for (const [id, name, ...rest] of books) {
    for (const item of rest) {
      if (typeof item === "string") add(item, id, name);
      else if (item.alias) add(item.alias, id, name, !!item.verseOnly);
      else if (item.num) {
        for (const n of item.names) {
          for (const p of NUMBER_FORMS[item.num]) {
            add(`${p} ${n}`, id, name);
            if (/^\d/.test(p) && /^\d$/.test(p)) add(`${p}${n}`, id, name); // "1Sam"
          }
        }
      }
    }
  }
  return map;
}

function createReader(books = BOOKS) {
  const aliases = buildAliases(books);
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const alt = keys.map((k) => escapeRe(k).replace(/ /g, `${SP}+`)).join("|");
  // Book, then a period and/or space, then a digit. ("NA28" and "Ge1.1" don't count.)
  const bookSrc = `(?<![\\p{L}\\p{N}])(${alt})(?:\\.${SP}*|${SP}+)(?=\\d)`;
  const bookRe = new RegExp(bookSrc, "giu");
  const bookAt = new RegExp(bookSrc, "iuy"); // does a book name start exactly here?
  const startsBook = (text, pos) => {
    bookAt.lastIndex = pos;
    const m = bookAt.exec(text);
    return !!(m && aliases.has(norm(m[1])));
  };

  function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
    return starts;
  }
  function lineOf(starts, pos) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid; else hi = mid - 1;
    }
    return lo; // 0-based
  }

  // Sticky sub-patterns used while walking a reference body.
  const reNum = /(\d{1,3})(?![\d])/y;
  // Chapter/verse separator: "13:14", "13: 14", "13.14", "13v14", and European "5,1" (no space).
  const reSep = /(?:[.v,]|:[ \u00a0]?)(?=\d)/y;
  const reSuffix = /(?:ff?|[a-d])(?![\p{L}])/uy; // 14a, 14b, 22f, 22ff
  // Range dash. Spaces are allowed around - and –, but a spaced em dash ("35 — 8") is punctuation.
  const reDash = new RegExp(`(?:${SP}*[-\\u2010-\\u2013\\u2212]${SP}*|\\u2014|\\u2015)(?=\\d)`, "y");
  // "and" / "&" also chain ("Isa 41:4, 44:6 and 48:12"), but only to a full chapter:verse item,
  // so "Rev 1:17 and 2 others" isn't read as a chapter.
  const AND = `(?:,?${SP}*(?:and|&)${SP}+|${SP}*&${SP}*)`;
  const reList = new RegExp(`(?:${SP}*([,;])${SP}*|${AND}())(?=\\d)`, "y");
  // Inside parentheses after a reference: "Zech 14 (cf. 14:4; also 14:21)". Filler words like
  // "cf." and "also" may come before each item; only full chapter:verse items count there.
  const FILL = `(?:(?:cf|see|also|esp|compare)\\.?${SP}+)*`;
  const reOpen = new RegExp(`${SP}*\\(${SP}*()${FILL}(?=\\d)`, "iy");
  const reListP = new RegExp(`(?:${SP}*([,;])${SP}*|${AND}())${FILL}(?=\\d)`, "iy");

  function at(re, text, pos) {
    re.lastIndex = pos;
    const m = re.exec(text);
    return m ? { m, end: re.lastIndex } : null;
  }

  // Read "N" or "N<sep>M" at pos. Returns { a, b, end } (b null if no sep).
  function readCV(text, pos) {
    const n1 = at(reNum, text, pos);
    if (!n1) return null;
    let a = +n1.m[1], b = null, end = n1.end;
    const s = at(reSep, text, end);
    if (s) {
      const n2 = at(reNum, text, s.end);
      if (n2) { b = +n2.m[1]; end = n2.end; }
    }
    if (b !== null) { const suf = at(reSuffix, text, end); if (suf) end = suf.end; }
    if (/\p{L}/u.test(text[end] || "")) return null; // "11Q19", "4QpIsa" — not a reference
    return { a, b, end };
  }

  function parse(text) {
    const out = [];
    const starts = lineStarts(text);
    bookRe.lastIndex = 0;
    let m;
    while ((m = bookRe.exec(text))) {
      const bookText = m[1];
      const firstLetter = bookText.match(/\p{L}/u);
      if (firstLetter && firstLetter[0] !== firstLetter[0].toUpperCase()) continue; // "mark 3" in prose
      const info = aliases.get(norm(bookText));
      if (!info) continue;
      // Skip anything inside a URL ("...?ref=BibleCJB.Ge1.1&off=...").
      const tokStart = Math.max(text.lastIndexOf(" ", m.index), text.lastIndexOf("\n", m.index)) + 1;
      if (/:\/\/|[=?&]/.test(text.slice(tokStart, m.index))) continue;

      let pos = bookRe.lastIndex;
      const first = readCV(text, pos);
      if (!first) continue;
      const single = SINGLE_CHAPTER.has(info.id);
      if (single && first.b === null) { first.b = first.a; first.a = 1; }
      if (first.a < 1 || first.a > MAX_CH) continue;
      if (info.verseOnly && first.b === null) continue;

      const refs = [];
      const push = (c1, v1, c2, v2, s, e) => {
        if (v1 !== null && (v1 < 1 || v1 > MAX_V)) return false;
        refs.push({ book: info.id, bookName: info.name, c1, v1, c2, v2, start: s, end: e });
        return true;
      };

      // First reference (with optional range).
      let c = first.a, v = first.b, end = first.end, refStart = m.index;
      let c2 = c, v2 = v;
      // A dash before a numbered book is punctuation, not a range: "Isa 53:7 - 1 Pet 2:22".
      const d = at(reDash, text, end);
      if (d && !startsBook(text, d.end)) {
        const r = readCV(text, d.end);
        if (r) {
          if (single && r.b === null) { v2 = r.a; }                // Jude 5–7
          else if (v === null) { c2 = r.a; v2 = r.b; }              // 13–14, 13–14:2
          else if (r.b === null) { v2 = r.a; }                 // 13:14–16
          else { c2 = r.a; v2 = r.b; }                         // 13:14–14:2
          end = r.end;
        }
      }
      if (c2 < c || (c2 === c && v !== null && v2 !== null && v2 < v)) { c2 = c; v2 = v; }
      if (!push(c, v, c2, v2, refStart, end)) continue;
      let curC = c2, hasVerse = v !== null, inParen = false;

      // Chained references: "; 11:31; 12:11", ", 16", "; 14", and "(cf. 14:4; 14:21)".
      for (;;) {
        let l = at(inParen ? reListP : reList, text, end);
        let opening = false;
        if (!l && !inParen) { l = at(reOpen, text, end); opening = !!l; }
        if (!l) break;
        const isAnd = l.m[1] === undefined && l.m[2] === "";
        const sep = isAnd ? "and" : l.m[1];
        if (startsBook(text, l.end)) break;                         // "; 1 Cor 1:22" — a new book
        const r = readCV(text, l.end);
        if (!r) break;
        if (isAnd && r.b === null && !single) break;                // "and 2 others" isn't a reference
        if ((opening || (inParen && !(sep === "," && hasVerse))) && r.b === null) break;  // "(2 times)" isn't a reference
        if (opening) inParen = true;
        let rc, rv;
        if (r.b !== null) { rc = r.a; rv = r.b; }                 // c:v
        else if (single || (sep === "," && hasVerse)) { rc = curC; rv = r.a; } // verse in same chapter
        else { rc = r.a; rv = null; }                              // chapter
        if (rc < 1 || rc > MAX_CH) break;
        if (rv === null && info.verseOnly) break;
        let rc2 = rc, rv2 = rv, rend = r.end;
        const d2 = at(reDash, text, rend);
        if (d2 && !startsBook(text, d2.end)) {
          const r2 = readCV(text, d2.end);
          if (r2) {
            if (rv === null) { rc2 = r2.a; rv2 = r2.b; }
            else if (r2.b === null) { rv2 = r2.a; }
            else { rc2 = r2.a; rv2 = r2.b; }
            rend = r2.end;
          }
        }
        if (!push(rc, rv, rc2, rv2, l.end, rend)) break;
        curC = rc2; hasVerse = rv !== null; end = rend;
      }

      for (const r of refs) {
        r.line = lineOf(starts, r.start);
        r.text = text.slice(r.start, r.end);
        out.push(r);
      }
      bookRe.lastIndex = end;
    }
    return out;
  }

  // Filenames use the same reader ("Isaiah 56v7", "Mark 1.12-13 Hub",
  // "The Son of Man Coming on the Clouds (Matt 24.30)").
  function parseName(name) {
    return parse(name.replace(/\.md$/i, "")).map((r) => ({ ...r, line: -1 }));
  }

  return { parse, parseName };
}

// Does reference a overlap reference b? (chapter-only = whole chapter)
function overlaps(a, b) {
  if (a.book !== b.book) return false;
  const lo = (r) => r.c1 * 1000 + (r.v1 ?? 0);
  const hi = (r) => r.c2 * 1000 + (r.v2 ?? 999);
  return lo(a) <= hi(b) && lo(b) <= hi(a);
}

function format(r) {
  let s = `${r.bookName} ${r.c1}`;
  if (r.v1 !== null) s += `:${r.v1}`;
  if (r.c2 !== r.c1) s += `–${r.c2}${r.v2 !== null ? ":" + r.v2 : ""}`;
  else if (r.v2 !== null && r.v2 !== r.v1) s += `–${r.v2}`;
  return s;
}

export { createReader, overlaps, format };
