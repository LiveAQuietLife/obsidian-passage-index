// Passage Index — coverage map data. Which chapters and verses of a book the indexed notes
// mention, and how often. No Obsidian code, so it can be tested with plain Node.
//
// Counts every mention (a note citing Rev 1:17 three times adds 3), from the same index the
// pane uses, so excluded folders are left out here too. A verse range counts for each verse
// in it. Chapter-only mentions ("Rev 1") and broad ranges (more than `broadChapters`
// chapters) count for the chapter, not its verses, so they don't paint whole books.

// Verses per chapter, books 1–66 (English versification; generated from the BSB by
// tools/verse-counts.js).
const VERSES = [
  /* 1 GEN */ "31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26",
  /* 2 EXO */ "22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38",
  /* 3 LEV */ "17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34",
  /* 4 NUM */ "54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13",
  /* 5 DEU */ "46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12",
  /* 6 JOS */ "18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33",
  /* 7 JDG */ "36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25",
  /* 8 RUT */ "22,23,18,22",
  /* 9 1SA */ "28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13",
  /* 10 2SA */ "27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25",
  /* 11 1KI */ "53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53",
  /* 12 2KI */ "18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30",
  /* 13 1CH */ "54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30",
  /* 14 2CH */ "17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23",
  /* 15 EZR */ "11,70,13,24,17,22,28,36,15,44",
  /* 16 NEH */ "11,20,32,23,19,19,73,18,38,39,36,47,31",
  /* 17 EST */ "22,23,15,17,14,14,10,17,32,3",
  /* 18 JOB */ "22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17",
  /* 19 PSA */ "6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6",
  /* 20 PRO */ "33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31",
  /* 21 ECC */ "18,26,22,16,20,12,29,17,18,20,10,14",
  /* 22 SNG */ "17,17,11,16,16,13,13,14",
  /* 23 ISA */ "31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24",
  /* 24 JER */ "19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34",
  /* 25 LAM */ "22,22,66,22,22",
  /* 26 EZK */ "28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35",
  /* 27 DAN */ "21,49,30,37,31,28,28,27,27,21,45,13",
  /* 28 HOS */ "11,23,5,19,15,11,16,14,17,15,12,14,16,9",
  /* 29 JOL */ "20,32,21",
  /* 30 AMO */ "15,16,15,13,27,14,17,14,15",
  /* 31 OBA */ "21",
  /* 32 JON */ "17,10,10,11",
  /* 33 MIC */ "16,13,12,13,15,16,20",
  /* 34 NAM */ "15,13,19",
  /* 35 HAB */ "17,20,19",
  /* 36 ZEP */ "18,15,20",
  /* 37 HAG */ "15,23",
  /* 38 ZEC */ "21,13,10,14,11,15,14,23,17,12,17,14,9,21",
  /* 39 MAL */ "14,17,18,6",
  /* 40 MAT */ "25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20",
  /* 41 MRK */ "45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20",
  /* 42 LUK */ "80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53",
  /* 43 JHN */ "51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25",
  /* 44 ACT */ "26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31",
  /* 45 ROM */ "32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27",
  /* 46 1CO */ "31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24",
  /* 47 2CO */ "24,17,18,18,21,18,16,24,15,18,33,21,14",
  /* 48 GAL */ "24,21,29,31,26,18",
  /* 49 EPH */ "23,22,21,32,33,24",
  /* 50 PHP */ "30,30,21,23",
  /* 51 COL */ "29,23,25,18",
  /* 52 1TH */ "10,20,13,18,28",
  /* 53 2TH */ "12,17,18",
  /* 54 1TI */ "20,15,16,16,25,21",
  /* 55 2TI */ "18,26,17,22",
  /* 56 TIT */ "16,15,15",
  /* 57 PHM */ "25",
  /* 58 HEB */ "14,18,19,16,14,20,28,13,28,39,40,29,25",
  /* 59 JAS */ "27,26,18,17,20",
  /* 60 1PE */ "25,25,22,19,14",
  /* 61 2PE */ "21,22,18",
  /* 62 1JN */ "10,29,24,21,21",
  /* 63 2JN */ "13",
  /* 64 3JN */ "14",
  /* 65 JUD */ "25",
  /* 66 REV */ "20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21",
];
const COUNTS = VERSES.map((s) => s.split(",").map(Number));
const versesIn = (book, c) => COUNTS[book - 1]?.[c - 1] || 0;
const chaptersIn = (book) => COUNTS[book - 1]?.length || 0;

// 0 / 1 / 2–3 / 4+ → level 0–3.
const level = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);

function addNote(map, path, r) {
  const n = map.get(path);
  if (n) { n.count++; return; }
  map.set(path, { path, count: 1, line: r.line, col: r.col ?? 0, refText: r.text, lineText: r.lineText, lineCol: r.lineCol });
}

// index: a PassageIndex. Returns null for a book without a verse table (books 67+), else
// { book, chapters: [{ c, verses, mentions, chapterMentions, notes: Map, chapterNotes: Map,
//   isMain, verse: [{ v, mentions, notes: Map, isMain }] }] } (arrays indexed from 0).
// isMain: some note has this as (part of) its main passage. Notes maps: path → { count, line, … }.
function coverage(index, book, { broadChapters = 2 } = {}) {
  const n = chaptersIn(book);
  if (!n) return null;
  const chapters = [];
  for (let c = 1; c <= n; c++) {
    const verse = [];
    for (let v = 1; v <= versesIn(book, c); v++) verse.push({ v, mentions: 0, notes: new Map(), isMain: false });
    chapters.push({ c, verses: verse.length, mentions: 0, chapterMentions: 0, notes: new Map(), chapterNotes: new Map(), isMain: false, verse });
  }
  const each = (r, fn) => {
    for (let c = Math.max(1, r.c1); c <= Math.min(n, r.c2); c++) {
      const ch = chapters[c - 1];
      const from = c === r.c1 ? r.v1 : 1;
      const to = c === r.c2 && r.v2 != null ? r.v2 : ch.verses;
      fn(ch, Math.max(1, from), Math.min(ch.verses, to));
    }
  };
  for (const path of index.byBook.get(book) || []) {
    const e = index.files.get(path);
    if (!e) continue;
    for (const r of e.refs) {
      if (r.book !== book) continue;
      const wide = r.v1 == null || r.c2 - r.c1 + 1 > broadChapters;
      each(r, (ch, from, to) => {
        ch.mentions++;
        addNote(ch.notes, path, r);
        if (wide) { ch.chapterMentions++; addNote(ch.chapterNotes, path, r); return; }
        for (let v = from; v <= to; v++) { ch.verse[v - 1].mentions++; addNote(ch.verse[v - 1].notes, path, r); }
      });
    }
    for (const m of e.main) {
      if (m.book !== book) continue;
      each(m, (ch, from, to) => {
        ch.isMain = true;
        if (m.v1 != null) for (let v = from; v <= to; v++) ch.verse[v - 1].isMain = true;
      });
    }
  }
  return { book, chapters };
}

// Which chapters / verses of `book` the given refs cover (for outlining the current note).
// Returns { chapters: Set(c), verses: Set("c:v") }.
function marks(refs, book) {
  const chapters = new Set(), verses = new Set();
  for (const r of refs) {
    if (r.book !== book) continue;
    for (let c = r.c1; c <= r.c2; c++) {
      chapters.add(c);
      if (r.v1 == null) continue;
      const from = c === r.c1 ? r.v1 : 1;
      const to = c === r.c2 && r.v2 != null ? r.v2 : versesIn(book, c);
      for (let v = from; v <= to; v++) verses.add(`${c}:${v}`);
    }
  }
  return { chapters, verses };
}

export { coverage, marks, level, versesIn, chaptersIn };
