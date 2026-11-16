// Passage Index — the index and the grouping/ranking used by the pane.
// No Obsidian dependencies, so it can be tested with plain Node.

import { format } from "./reader.js";

const blank = (s) => s.replace(/[^\n]/g, " ");
const lo = (r) => r.c1 * 1000 + (r.v1 ?? 0);
const hi = (r) => r.c2 * 1000 + (r.v2 ?? 999);
const sameRange = (a, b) => a.book === b.book && lo(a) === lo(b) && hi(a) === hi(b);
const overlaps = (a, b) => a.book === b.book && lo(a) <= hi(b) && lo(b) <= hi(a);

// How a found reference relates to the group's passage. Lower rank = shown first.
const MATCH = {
  exact:    { rank: 0, label: "exact" },
  within:   { rank: 1, label: "inside" },        // e.g. 11:17 inside 11:15–19
  contains: { rank: 2, label: "contains" },      // e.g. 11:12–25 contains 11:17
  overlap:  { rank: 3, label: "overlaps" },
  chapter:  { rank: 4, label: "chapter" },       // chapter-only reference ("Mark 11")
};

function matchType(group, ref) {
  if (sameRange(group, ref)) return "exact";
  if (ref.v1 === null && group.v1 !== null) return "chapter";
  if (lo(ref) >= lo(group) && hi(ref) <= hi(group)) return "within";
  if (lo(ref) <= lo(group) && hi(ref) >= hi(group)) return "contains";
  return "overlap";
}

// ---- Intertext Register -------------------------------------------------------------
// Reads the note's "## Intertexts" section and open "#intertext" tasks. Writes nothing.
// The section heading can be any level; its text must match one of `headings` (case ignored).
const INTERTEXT_HEADINGS = ["Intertexts", "Intertext"];
const RELATION = {
  quotes:        { rank: 0, test: /\bquot/i },
  "alludes to":  { rank: 1, test: /\ballu/i },
  echoes:        { rank: 2, test: /\becho/i },
  unspecified:   { rank: 3, test: null },
};
const relRank = (r) => RELATION[r].rank;
const plainLinks = (s) => s.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2").replace(/\[\[([^\]]*)\]\]/g, "$1").trim();

// "(quotes; France 2002, 445)" -> relation "quotes", citation "France 2002, 445".
// "(DBI, 769)" -> relation unspecified, citation "DBI, 769".
// Read after the indexed reference (its column), not the first match of its text: the same
// text can appear earlier, e.g. in a masked link target (bug 3).
function readLine(lineText, ref) {
  const at = ref.col >= 0 && lineText.startsWith(ref.text, ref.col) ? ref.col : lineText.indexOf(ref.text);
  const after = lineText.slice(at + ref.text.length);
  let relation = "unspecified", citation = "", description = "";
  const parens = [...after.matchAll(/\(((?:\[\[[^\]]*\]\]|[^()])*)\)/g)].map((m) => m[1]);
  const first = parens[0];
  if (first != null) {
    const [head, ...tail] = first.split(";");
    const hit = Object.keys(RELATION).find((k) => RELATION[k].test?.test(head));
    if (hit) { relation = hit; citation = tail.join(";"); }
  }
  // A trailing "(…, page)" is a citation (e.g. after a description).
  if (!citation && parens.length && (relation === "unspecified" || parens.length > 1)) citation = parens[parens.length - 1];
  const dash = after.match(/\s[—–-]\s+(.*)$/);
  if (dash) description = dash[1].replace(/\s*\((?:\[\[[^\]]*\]\]|[^()])*\)\s*$/, "");
  return { relation, citation: plainLinks(citation), description: plainLinks(description) };
}

function readIntertexts(lines, bodyRefs, headings) {
  const names = new Set((headings?.length ? headings : INTERTEXT_HEADINGS).map((s) => s.trim().toLowerCase()));
  const byLine = new Map();
  for (const r of bodyRefs) {
    if (!byLine.has(r.line)) byLine.set(r.line, []);
    byLine.get(r.line).push(r);
  }
  const intertexts = [], openTasks = [];
  let inSection = 0; // heading level of the open "Intertexts" section, or 0
  lines.forEach((raw, i) => {
    const h = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { inSection = names.has(h[2].toLowerCase()) ? h[1].length : (inSection && h[1].length > inSection ? inSection : 0); return; }
    const refs = byLine.get(i) || [];
    if (/^\s*[-*+]\s+\[ \]\s/.test(raw) && /(^|\s)#intertext\b/i.test(raw)) {
      if (refs.length) openTasks.push({ line: i, refs, lineText: refs[0].lineText });
      return;
    }
    if (inSection && /^\s*[-*+]\s+(?!\[.\]\s)/.test(raw) && refs.length) {
      const r = refs[0];
      intertexts.push({ target: r, line: i, col: r.col, refText: r.text, lineText: r.lineText, ...readLine(raw, r) });
    }
  });
  return { intertexts, openTasks };
}

class PassageIndex {
  // opts (read live, so setting changes apply on the next re-index):
  //   ignorePhrases: strings that look like references but aren't citations ("Mark 1–8" as a book title)
  //   broadChapters: a match spanning more chapters than this is "broad" (default 2)
  constructor(reader, opts = {}) {
    this.reader = reader;
    this.opts = opts;
    this.files = new Map();  // path -> { path, refs: [...], main: [...] }
    this.byBook = new Map(); // book id -> Set(path)
    this.version = 0;        // bumped on every change, so results can be reused until then
  }

  // text: full file contents; basename: file name without extension;
  // override: optional frontmatter `passage` value (string or array).
  // ignore: optional frontmatter list of references this note cites only in passing
  //   (e.g. ["Acts 11:28"]). Body references inside them are dropped, so the note gets no
  //   group for them and doesn't appear under them in other notes. A chapter covers its verses.
  setFile(path, text, basename, override, ignore) {
    this.remove(path);
    const lines = text.split("\n");
    // Links in frontmatter (e.g. project: "[[Mark 13v1-37 — …]]") are relationships, not
    // citations, so blank them out (keeping offsets and line numbers intact).
    const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
    const scan = this.mask(fm ? fm[0].replace(/\[\[[^\]]*\]\]/g, (s) => " ".repeat(s.length)) + text.slice(fm[0].length) : text);
    const ignored = (ignore == null ? [] : (Array.isArray(ignore) ? ignore : [ignore]))
      .flatMap((o) => (o == null ? [] : this.reader.parse(String(o))))
      .map((r) => ({ book: r.book, bookName: r.bookName, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 }));
    const isIgnored = (r) => ignored.some((i) => i.book === r.book && lo(i) <= lo(r) && hi(r) <= hi(i));
    const bodyRefs = this.reader.parse(scan).filter((r) => !isIgnored(r)).map((r) => ({
      book: r.book, bookName: r.bookName, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2,
      line: r.line, text: r.text,
      col: r.start - (scan.lastIndexOf("\n", r.start - 1) + 1), // column within the line
      lineText: (lines[r.line] || "").trim().slice(0, 2000),
    }));
    // Where the reference sits in the trimmed line, so the pane can centre its preview on it.
    for (const r of bodyRefs) {
      const raw = lines[r.line] || "";
      r.lineCol = r.col - (raw.length - raw.trimStart().length);
    }
    let main = [];
    const ov = override == null ? [] : (Array.isArray(override) ? override : [override]);
    for (const o of ov) main.push(...this.reader.parse(String(o)));
    if (!main.length) main = this.reader.parseName(this.maskPhrases(basename));
    main = main.map((r) => ({ book: r.book, bookName: r.bookName, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 }));

    // The main passage also counts as a reference of the note (for notes that never
    // repeat their own passage in the body).
    const refs = [...bodyRefs];
    for (const m of main) if (!refs.some((r) => sameRange(r, m))) refs.push({ ...m, line: -1, text: format(m), lineText: "" });

    const bodyStart = fm ? fm[0].split(String.fromCharCode(10)).length : 0; // first line after the frontmatter
    const entry = { path, refs, main, bodyStart, ignored: ignored.map(format), ...readIntertexts(lines, bodyRefs, this.opts.intertextHeadings) };
    this.files.set(path, entry);
    this.version++;
    for (const r of refs) {
      if (!this.byBook.has(r.book)) this.byBook.set(r.book, new Set());
      this.byBook.get(r.book).add(path);
    }
  }

  // Blank out text that looks like a reference but isn't a citation, keeping offsets.
  // Wikilinks: the target is a note name ([[Joel Marcus - Mark 1-8|Marcus]]), so only the
  // display text counts. A link without display text counts only if the note's name starts
  // with a passage ([[Mark 1v15]], [[Passages/Mark 1v21-28 — Worksheet]]).
  mask(text) {
    text = text.replace(/!?\[\[([^\]|\n]*)(\|[^\]\n]*)?\]\]/g, (m, target, alias) => {
      if (alias) {
        const bar = m.length - 2 - alias.length;
        return blank(m.slice(0, bar + 1)) + alias.slice(1) + "  ";
      }
      const hash = target.indexOf("#");
      const pathPart = hash >= 0 ? target.slice(0, hash) : target;
      const name = pathPart.slice(pathPart.lastIndexOf("/") + 1);
      const r = this.reader.parse(name)[0];
      if (!r || r.start !== 0) return blank(m);
      const from = m.indexOf("[[") + 2 + (pathPart.length - name.length);
      return blank(m.slice(0, from)) + name + blank(m.slice(from + name.length));
    });
    return this.maskPhrases(text);
  }

  maskPhrases(text) {
    for (const p of this.opts.ignorePhrases || []) {
      const words = String(p).trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const src = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-–—]/g, "[-–—]")).join("\\s+");
      text = text.replace(new RegExp(src, "gi"), blank);
    }
    return text;
  }

  remove(path) {
    const e = this.files.get(path);
    if (!e) return;
    for (const r of e.refs) this.byBook.get(r.book)?.delete(path);
    this.files.delete(path);
    this.version++;
  }

  rename(oldPath, newPath, text, basename, override, ignore) {
    this.remove(oldPath);
    this.setFile(newPath, text, basename, override, ignore);
  }

  // Where the note itself cites a passage (same range), in reading order. Frontmatter
  // (e.g. ref: Revelation 1:1-3) doesn't count as a place.
  placesIn(path, ref) {
    const e = this.files.get(path);
    if (!e) return [];
    return e.refs.filter((r) => r.line >= (e.bodyStart || 0) && sameRange(r, ref))
      .sort((a, b) => (a.line - b.line) || (a.col - b.col));
  }

  // The references a note's ignore property names (formatted), for the pane header.
  ignoredFor(path) {
    return this.files.get(path)?.ignored || [];
  }

  // The notes citing a passage (any passage, not only one a note cites: the pane's passage
  // view uses this too), each with its closest match. skipPath: a note to leave out.
  // Returns [{ path, about, broad, match, matchLabel, line, col, lineText, lineCol,
  //            chapterOnly, refText, more }], "about" notes first, then by match.
  notesFor(ref, skipPath = null) {
    const notes = [];
    for (const other of this.byBook.get(ref.book) || []) {
      if (other === skipPath) continue;
      const oe = this.files.get(other);
      let best = null, count = 0;
      for (const r of oe.refs) {
        if (!overlaps(ref, r)) continue;
        count++;
        const mt = matchType(ref, r);
        // Prefer the best match type; among equals, prefer a body line over the filename.
        if (!best || MATCH[mt].rank < MATCH[best.mt].rank ||
            (MATCH[mt].rank === MATCH[best.mt].rank && best.r.line < 0 && r.line >= 0)) best = { mt, r };
      }
      if (!best) continue;
      const about = oe.main.some((m) => overlaps(m, ref));
      // Broad: even the best match spans many chapters ("Mark 1–8"). The pane can hide these.
      const broad = best.mt !== "exact" && best.r.c2 - best.r.c1 + 1 > (this.opts.broadChapters || 2);
      notes.push({
        path: other, about, broad, match: best.mt, matchLabel: MATCH[best.mt].label,
        line: best.r.line, col: best.r.col ?? 0, lineText: best.r.lineText, lineCol: best.r.lineCol,
        chapterOnly: best.mt === "chapter", refText: best.r.text, more: count - 1,
      });
    }
    return notes.sort((a, b) =>
      (b.about - a.about) || (MATCH[a.match].rank - MATCH[b.match].rank) ||
      a.path.localeCompare(b.path));
  }

  // Rabbit trails: lines of the rabbit-trails note (parkPath) whose saved passage touches a
  // passage this note cites. Only the first reference on a line is the saved passage (later
  // ones are the reason, or the "from" link). This note's broad references (more than
  // broadChapters chapters) don't pull lines in. fromLines: line numbers to include anyway
  // (lines saved from this note), marked fromHere.
  // Returns [{ path, line, col, lineText, lineCol, refText, passage, fromHere }] in note order.
  parkedFor(path, parkPath, fromLines = []) {
    const e = this.files.get(path);
    if (!e || path === parkPath) return [];
    const wide = this.opts.broadChapters || 2;
    const mine = e.refs.filter((r) => r.c2 - r.c1 + 1 <= wide);
    const from = new Set(fromLines);
    return this.parkedAll(parkPath)
      .filter((x) => from.has(x.line) || mine.some((m) => overlaps(m, x.ref)))
      .map((x) => ({ ...x, fromHere: from.has(x.line) }));
  }

  // Every saved line of the rabbit-trails note (any line with a reference; its first one is
  // the saved passage), in note order.
  // Returns [{ path, line, col, lineText, lineCol, refText, passage, ref }].
  parkedAll(parkPath) {
    const pe = this.files.get(parkPath);
    if (!pe) return [];
    const first = new Map();
    for (const r of pe.refs) {
      if (r.line < (pe.bodyStart || 0)) continue;
      const f = first.get(r.line);
      if (!f || r.col < f.col) first.set(r.line, r);
    }
    return [...first.values()].sort((a, b) => a.line - b.line)
      .map((r) => ({ path: parkPath, line: r.line, col: r.col, lineText: r.lineText, lineCol: r.lineCol,
        refText: r.text, passage: format(r), ref: { book: r.book, bookName: r.bookName, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 } }));
  }

  // The Gaps tab: verse references your notes cite that no note is about. "About" = some
  // note's main passage overlaps it (Rev 1:7–9 counts as written if Revelation 1v7-8 exists).
  // Left out: chapter-only references ("Daniel 2"), broad ones (more than broadChapters
  // chapters), and the note at skipPath (the rabbit-trails note). One row per distinct range
  // ("Dan 7:13" and "Dan 7:13–14" are two rows); spellings of the same range are merged.
  // Returns [{ key, ref, passage, notes: [{ path, line, col, refText, lineText, lineCol, count }] }],
  // cited by most notes first, then Bible order. Each row's notes by name.
  // The result is reused until a note changes (this.version), so treat it as read-only.
  unwritten(skipPath = null) {
    const wide = this.opts.broadChapters || 2;
    const key = `${this.version}|${skipPath}|${wide}`;
    if (this._gaps?.key === key) return this._gaps.rows;
    // Main passages by book, so each check only looks at notes on the same book (bug 15).
    const mains = new Map();
    for (const e of this.files.values()) {
      if (e.path === skipPath) continue;
      for (const m of e.main) {
        if (!mains.has(m.book)) mains.set(m.book, []);
        mains.get(m.book).push(m);
      }
    }
    // Each book's mains sorted by start, with the furthest end so far: a reference overlaps
    // some main iff, among mains starting at or before its end, the furthest end reaches its start.
    const spans = new Map();
    for (const [book, ms] of mains) {
      ms.sort((a, b) => lo(a) - lo(b));
      let far = -1;
      spans.set(book, { starts: ms.map(lo), far: ms.map((m) => (far = Math.max(far, hi(m)))) });
    }
    const written = (r) => {
      const s = spans.get(r.book);
      if (!s) return false;
      const end = hi(r);
      let a = 0, b = s.starts.length; // first start > end
      while (a < b) { const mid = (a + b) >> 1; if (s.starts[mid] <= end) a = mid + 1; else b = mid; }
      return a > 0 && s.far[a - 1] >= lo(r);
    };
    const rows = this.unwrittenRows(skipPath, wide, written);
    this._gaps = { key, rows };
    return rows;
  }

  unwrittenRows(skipPath, wide, written) {
    const rows = new Map();
    for (const e of this.files.values()) {
      if (e.path === skipPath) continue;
      for (const r of e.refs) {
        if (r.v1 == null || r.c2 - r.c1 + 1 > wide) continue;
        const key = `${r.book}:${r.c1}:${r.v1}:${r.c2}:${r.v2}`;
        let row = rows.get(key);
        if (!row) {
          if (written(r)) continue;
          const ref = { book: r.book, bookName: r.bookName, c1: r.c1, v1: r.v1, c2: r.c2, v2: r.v2 };
          rows.set(key, (row = { key, ref, passage: format(ref), notes: new Map() }));
        }
        const n = row.notes.get(e.path);
        // The first place in the body (the filename's main passage, line -1, only if none).
        if (!n) row.notes.set(e.path, { path: e.path, line: r.line, col: r.col ?? 0, refText: r.text, lineText: r.lineText, lineCol: r.lineCol, count: 1 });
        else {
          n.count++;
          if ((n.line < 0 && r.line >= 0) || (r.line >= 0 && (r.line < n.line || (r.line === n.line && (r.col ?? 0) < n.col)))) {
            Object.assign(n, { line: r.line, col: r.col ?? 0, refText: r.text, lineText: r.lineText, lineCol: r.lineCol });
          }
        }
      }
    }
    const name = (p) => p.split("/").pop();
    return [...rows.values()]
      .map((x) => ({ ...x, notes: [...x.notes.values()].sort((a, b) => name(a.path).localeCompare(name(b.path))) }))
      .sort((a, b) => (b.notes.length - a.notes.length) || (a.ref.book - b.ref.book) || (lo(a.ref) - lo(b.ref)) || (hi(a.ref) - hi(b.ref)));
  }

  // Groups for the pane (design: Option C).
  // Returns [{ key, label, ref, isMain, open, notes: [{ path, about, match, matchLabel,
  //            line, lineText, refText, more, otherGroups }] }]
  groupsFor(path) {
    const e = this.files.get(path);
    if (!e) return [];

    // One group per distinct passage cited in the note.
    const groups = [];
    for (const r of e.refs) {
      if (groups.some((g) => sameRange(g.ref, r))) continue;
      const isMain = e.main.some((m) => sameRange(m, r));
      groups.push({ key: format(r), label: format(r), ref: r, isMain });
    }

    for (const g of groups) g.notes = this.notesFor(g.ref, path);

    // Mark notes that appear under several passages.
    const seen = new Map();
    for (const g of groups) for (const n of g.notes) seen.set(n.path, (seen.get(n.path) || 0) + 1);
    for (const g of groups) for (const n of g.notes) n.otherGroups = seen.get(n.path) - 1;

    // Order: main passage(s) first and open; the rest collapsed, in canonical order.
    const canon = (a, b) => (a.ref.book - b.ref.book) || (lo(a.ref) - lo(b.ref)) || (hi(a.ref) - hi(b.ref));
    const main = groups.filter((g) => g.isMain).sort(canon);
    const rest = groups.filter((g) => !g.isMain).sort(canon);
    main.forEach((g) => (g.open = false)); // 0.0.30: everything starts collapsed
    rest.forEach((g) => (g.open = false));
    return [...main, ...rest];
  }

  // The Intertexts section of the pane.
  //   uses:   this note's own "## Intertexts" lines
  //   usedBy: other notes' intertext lines that point into this note's main passage
  //   open:   other notes' open #intertext tasks naming this note's main passage
  //           (verse references only; a bare chapter like "Zech 14" doesn't count)
  intertextsFor(path) {
    const e = this.files.get(path);
    if (!e) return { uses: [], usedBy: [], open: [] };
    const canon = (a, b) => (a.book - b.book) || (lo(a) - lo(b)) || (hi(a) - hi(b));
    const name = (p) => p.split("/").pop().replace(/\.md$/, "");
    const hitsMain = (r) => e.main.some((m) => overlaps(m, r) && !(r.v1 === null && m.v1 !== null));

    // A Uses row opens the target passage's own note (e.g. Isaiah 56v7), if there is one.
    const homeOf = (ref) => {
      let best = null;
      for (const oe of this.files.values()) {
        if (oe.path === path) continue;
        const m = oe.main.find((x) => sameRange(x, ref)) || oe.main.find((x) => overlaps(x, ref) && lo(x) <= lo(ref) && hi(x) >= hi(ref));
        if (!m) continue;
        const score = (sameRange(m, ref) ? 0 : 2) + (this.reader.parseName(name(oe.path))[0]?.start === 0 ? 0 : 1);
        if (!best || score < best.score || (score === best.score && oe.path.length < best.path.length)) best = { path: oe.path, score };
      }
      return best && best.path;
    };
    const uses = e.intertexts.map((it) => ({ ...it, path, passage: format(it.target), ref: it.target, home: homeOf(it.target) }))
      .sort((a, b) => (relRank(a.relation) - relRank(b.relation)) || canon(a.ref, b.ref));

    const usedBy = [], open = [];
    if (e.main.length) {
      for (const oe of this.files.values()) {
        if (oe.path === path) continue;
        for (const it of oe.intertexts) {
          if (!hitsMain(it.target)) continue;
          const src = oe.main[0];
          usedBy.push({ ...it, path: oe.path, passage: src ? oe.main.map(format).join("; ") : name(oe.path),
            ref: src || it.target, noteName: name(oe.path) });
        }
        for (const t of oe.openTasks) {
          const r = t.refs.find(hitsMain);
          if (!r) continue;
          open.push({ path: oe.path, line: t.line, col: r.col, refText: r.text, lineText: t.lineText, noteName: name(oe.path) });
        }
      }
    }
    usedBy.sort((a, b) => (relRank(a.relation) - relRank(b.relation)) || canon(a.ref, b.ref));
    open.sort((a, b) => a.noteName.localeCompare(b.noteName) || a.line - b.line);
    return { uses, usedBy, open };
  }

  // The Topics section of the pane: topic notes reached through any passage this note
  // cites, each listed once with the passages it shares ("via"). isTopic(path) decides
  // what counts as a topic (the plugin reads frontmatter/folders), so this module stays
  // Obsidian-free. Filtering of broad/chapter-only matches is left to the caller.
  topicsFor(path, isTopic) {
    const topics = new Map();
    for (const g of this.groupsFor(path)) {
      for (const n of g.notes) {
        if (!isTopic(n.path)) continue;
        if (!topics.has(n.path)) topics.set(n.path, { path: n.path, via: [] });
        topics.get(n.path).via.push({ ...n, passage: g.label, isMain: g.isMain });
      }
    }
    for (const t of topics.values()) {
      t.via.sort((a, b) => (b.isMain - a.isMain) || (MATCH[a.match].rank - MATCH[b.match].rank));
    }
    return [...topics.values()];
  }

  stats() {
    let refs = 0;
    for (const e of this.files.values()) refs += e.refs.length;
    return { notes: this.files.size, refs };
  }
}

// Topics not yet linked from the note first (they're the ones to consider), then by how
// many of the note's passages they share, then by the closest match, then by name.
function sortTopics(topics) {
  const name = (p) => p.split("/").pop();
  return topics.sort((a, b) => (!!a.linked - !!b.linked) || (b.via.length - a.via.length) ||
    (MATCH[a.via[0].match].rank - MATCH[b.via[0].match].rank) || name(a.path).localeCompare(name(b.path)));
}

export { PassageIndex, matchType, MATCH, RELATION, INTERTEXT_HEADINGS, readLine, sortTopics };
