// Passage Index — Obsidian plugin entry point.
const { Plugin, ItemView, PluginSettingTab, Setting, TFile, TFolder, MarkdownView, Menu, Modal, MarkdownRenderChild, Notice, setIcon, requestUrl, normalizePath, editorLivePreviewField } = require("obsidian");
const { StateEffect, StateField } = require("@codemirror/state");
const { Decoration, EditorView, ViewPlugin, WidgetType } = require("@codemirror/view");

// Verse numbers in Bible chapter notes, Live Preview. The notes keep "###### 3" lines (so
// [[Genesis 1#3]] links work); in a note whose frontmatter has `bible-chapter`, PI hides each
// such line (unless the cursor is on it) and draws a small "3" at the start of the verse's
// first line instead. Themes can't restyle it into a heading bar, because it isn't one.
class VerseNumber extends WidgetType {
  constructor(n) { super(); this.n = n; }
  eq(other) { return other.n === this.n; }
  toDOM() { const s = document.createElement("span"); s.className = "pi-vnum"; s.textContent = this.n; return s; }
}
const verseHeadLine = Decoration.line({ class: "pi-verse-head" });
const hideText = Decoration.replace({});
function verseNumberExtension(plugin) {
  const build = (view) => {
    const style = plugin.settings.verseNumbers;
    if (style !== "margin" && style !== "inline") return Decoration.none;
    if (editorLivePreviewField && !view.state.field(editorLivePreviewField, false)) return Decoration.none; // source mode
    const doc = view.state.doc;
    if (!/^---\n[\s\S]*?bible-chapter[\s\S]*?\n---/.test(doc.sliceString(0, Math.min(doc.length, 1000)))) return Decoration.none;
    const sel = view.state.selection.main;
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = doc.lineAt(pos);
        const m = /^###### (\d+)\s*$/.exec(line.text);
        if (m && line.number < doc.lines && !(sel.from <= line.to && sel.to >= line.from)) {
          const next = doc.line(line.number + 1);
          ranges.push(verseHeadLine.range(line.from));
          if (line.to > line.from) ranges.push(hideText.range(line.from, line.to));
          ranges.push(Decoration.widget({ widget: new VerseNumber(m[1]), side: -1 }).range(next.from));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  };
  return ViewPlugin.fromClass(class {
    constructor(view) { this.decorations = build(view); }
    update(u) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some((t) => t.reconfigured)) this.decorations = build(u.view); }
  }, { decorations: (v) => v.decorations });
}
const { createReader, format } = require("./reader");
const { PassageIndex, sortTopics } = require("./passage-index");
const { passageText, trimBible, sectionOf, translationInfo, downloadUrl, TRANSLATIONS, LICENSES } = require("./bible");
const { BOOKS } = require("./books");
const { coverage, marks, level } = require("./coverage");
const BOOK_NAME = Object.fromEntries(BOOKS.map((b) => [b[0], b[1]]));
const { planBible, DEFAULT_OPTIONS: WIZARD_DEFAULTS } = require("./wizard");
const VALID_ID = /^[A-Za-z0-9_-]+$/; // translation ids become file names
// Today in the user's own time zone (toISOString would give the UTC date, a day ahead in the evening).
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The translation list as a grouped <select>: optgroups by group, "✓" on downloaded ones,
// and an "Other" entry that takes any API id.
function fillTranslationSelect(selectEl, has, current) {
  const known = TRANSLATIONS.some((t) => t.id === current);
  let group = "", parent = selectEl;
  for (const t of TRANSLATIONS) {
    if (t.group !== group) { group = t.group; parent = selectEl.createEl("optgroup", { attr: { label: group } }); }
    parent.createEl("option", { value: t.id, text: `${t.short} — ${t.name}${has(t.id) ? "  ✓" : ""}` });
  }
  selectEl.createEl("option", { value: "__other", text: known || !current ? "Other (enter an id)…" : `Other: ${current}${has(current) ? "  ✓" : ""}` });
  selectEl.value = known ? current : "__other";
}

const VIEW_TYPE = "passage-index-pane";
const lo = (r) => r.c1 * 1000 + (r.v1 ?? 0);
const hi = (r) => r.c2 * 1000 + (r.v2 ?? 999);
const covers = (outer, r) => outer.book === r.book && lo(outer) <= lo(r) && hi(r) <= hi(outer);
const DEFAULTS = {
  excludedFolders: [], flashSeconds: 3, ignorePhrases: [], hideBroad: true, hideChapter: true, broadChapters: 2,
  // A topic note: frontmatter `topicProperty` has one of `topicValues`, or the note is in one of `topicFolders`.
  topicProperty: "type", topicValues: ["topic"], topicFolders: [],
  // Frontmatter property listing references a note cites only in passing (pi-ignore: [Acts 11:28]).
  ignoreProperty: "pi-ignore",
  // Verse pop-up: Ctrl + hover a passage label. The text comes from a translation downloaded
  // into the plugin folder (bibles/<id>.json).
  versePopup: true, bibleTranslation: "BSB", closeOnCtrlRelease: false,
  // Bibles the wizard has written into the vault: [{ id, short, name, base, chapters, options, created }].
  bibles: [],
  // Add wizard Bible folders to Obsidian's "Excluded files" (Files and links), so search isn't
  // flooded with verses. searchHidden lists the entries PI added, so it only removes its own.
  hideBiblesFromSearch: true, searchHidden: [],
  // How verse numbers look in wizard chapter notes: "heading" (theme decides), "margin", "inline".
  verseNumbers: "margin",
  // Open wizard Bible notes (chapter, book, index) in reading view.
  bibleReadingView: true,
  // "Open in…" targets (see OPEN_IN) and an optional version per target (blank = its default).
  openIn: { logos: true, biblegateway: false, blb: false, step: false },
  openInVersion: {},
  // Group the pane's passages by section, using this downloaded translation's headings ("" = off).
  sectionsFrom: "",
  // The pane's last tab: "index" or "map".
  paneTab: "index",
};

// "Open in…": a passage in an outside Bible tool. Logos goes through ref.ly, which opens the
// Logos app when it's installed and the Logos website when not. Only the Bible's 66 books.
const plainRef = (r) => {
  let s = `${r.bookName} ${r.c1}`;
  if (r.v1 != null) s += `:${r.v1}`;
  if (r.c2 !== r.c1) s += `-${r.c2}${r.v2 != null ? `:${r.v2}` : ""}`;
  else if (r.v2 != null && r.v2 !== r.v1) s += `-${r.v2}`;
  return s;
};
const OPEN_IN = [
  { id: "logos", name: "Logos", url: (r, v) => {
    let s = `${r.bookName.replace(/\s+/g, "")}${r.c1}`;
    if (r.v1 != null) s += `.${r.v1}`;
    if (r.c2 !== r.c1) s += `-${r.c2}${r.v2 != null ? `.${r.v2}` : ""}`;
    else if (r.v2 != null && r.v2 !== r.v1) s += `-${r.v2}`;
    return `https://ref.ly/${s}${v ? `;${v.toLowerCase()}` : ""}`;
  } },
  { id: "biblegateway", name: "Bible Gateway", url: (r, v) =>
    `https://www.biblegateway.com/passage/?search=${encodeURIComponent(plainRef(r))}${v ? `&version=${encodeURIComponent(v)}` : ""}` },
  { id: "blb", name: "Blue Letter Bible", url: (r, v) =>
    `https://www.blueletterbible.org/search/preSearch.cfm?Criteria=${encodeURIComponent(plainRef(r))}${v ? `&t=${encodeURIComponent(v)}` : ""}` },
  { id: "step", name: "STEP Bible", url: (r, v) =>
    `https://www.stepbible.org/?q=${v ? `version=${encodeURIComponent(v)}|` : ""}reference=${encodeURIComponent(plainRef(r))}` },
];
function addOpenIn(menu, plugin, ref) {
  if (!ref || ref.book > 66) return false;
  const s = plugin.settings;
  const on = OPEN_IN.filter((t) => s.openIn?.[t.id]);
  for (const t of on) {
    menu.addItem((i) => i.setTitle(`Open in ${t.name}`).setIcon("external-link")
      .onClick(() => window.open(t.url(ref, (s.openInVersion?.[t.id] || "").trim()))));
  }
  return on.length > 0;
}

// Temporary highlight of the reference after opening a result.
const flashEffect = StateEffect.define();
const flashMark = Decoration.mark({ class: "pi-flash" });
const flashField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashEffect)) deco = e.value ? Decoration.set([flashMark.range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

class PassageIndexPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.reader = createReader();
    this.index = new PassageIndex(this.reader, this.settings);
    this.ready = false;
    this.pending = new Map();

    this.registerView(VIEW_TYPE, (leaf) => new PassagePane(leaf, this));
    this.registerEditorExtension(flashField);
    // Kept in an array so a settings change can swap it and refresh open editors.
    this.verseExt = [verseNumberExtension(this)];
    this.registerEditorExtension(this.verseExt);
    // Hover previews use Obsidian's Page Preview. No modifier key needed by default;
    // this can be changed under Settings → Page preview → Passage Index.
    this.registerHoverLinkSource(VIEW_TYPE, { display: "Passage Index", defaultMod: false });
    this.addRibbonIcon("book-open-text", "Open Passage Index", () => this.activateView());
    this.addCommand({ id: "open-pane", name: "Open pane", callback: () => this.activateView() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => this.buildIndex() });
    // Coverage map in a note: a live `pi-map` code block naming a book.
    this.mapBlocks = new Set();
    this.registerMarkdownCodeBlockProcessor("pi-map", (source, el, ctx) => ctx.addChild(new MapBlock(el, this, source, ctx.sourcePath)));
    this.addCommand({
      id: "insert-coverage-map", name: "Insert coverage map",
      editorCallback: (editor, info) => {
        const main = info?.file ? this.index.files.get(info.file.path)?.main?.find((r) => r.book <= 66) : null;
        const book = main ? BOOK_NAME[main.book] : "Genesis";
        const pre = editor.getLine(editor.getCursor().line).trim() ? "\n\n" : "";
        const fence = "```";
        editor.replaceSelection(`${pre}${fence}pi-map\n${book}\n${fence}\n`);
      },
    });
    this.addCommand({
      id: "toggle-ignore", name: "Ignore (or stop ignoring) the reference at the cursor in this note",
      editorCallback: (editor, info) => {
        const t = this.ignoreTargets(editor, info?.file);
        if (!t) { new Notice("Passage Index: no reference at the cursor."); return; }
        if (t.add.length) this.setIgnored(t.file, t.add, true); else this.setIgnored(t.file, t.remove, false);
      },
    });
    // Right-click a reference (or select one or more) to add it to, or remove it from, the note's ignore property.
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const t = this.ignoreTargets(editor, info?.file);
      if (!t) return;
      const list = (rs) => rs.map(format).join(", ");
      if (t.add.length) menu.addItem((i) => i.setTitle(`Passage Index: ignore ${list(t.add)} in this note`).setIcon("eye-off")
        .onClick(() => this.setIgnored(t.file, t.add, true)));
      if (t.remove.length) menu.addItem((i) => i.setTitle(`Passage Index: stop ignoring ${list(t.remove)}`).setIcon("eye")
        .onClick(() => this.setIgnored(t.file, t.remove, false)));
    }));
    this.settingTab = new PassageIndexSettings(this.app, this);
    this.addSettingTab(this.settingTab);

    this.app.workspace.onLayoutReady(() => {
      // Listen for changes first, so a slow or failed build never leaves the index frozen.
      this.registerEvent(this.app.vault.on("modify", (f) => this.queue(f)));
      this.registerEvent(this.app.vault.on("create", (f) => this.queue(f)));
      this.registerEvent(this.app.metadataCache.on("changed", (f) => this.queue(f)));
      this.registerEvent(this.app.vault.on("delete", (f) => { this.index.remove(f.path); this.refreshViews(); }));
      this.registerEvent(this.app.vault.on("rename", (f, oldPath) => { this.index.remove(oldPath); this.queue(f); }));
      this.buildIndex();
      this.syncSearchExclusions().catch((e) => console.warn("Passage Index: couldn't update Excluded files:", e));
    });
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshViews()));
    // Verse-number style for wizard chapter notes, as a class on <body> (styles.css), also in
    // pop-out windows.
    this.applyVerseStyle();
    this.registerEvent(this.app.workspace.on("window-open", (_w, win) => this.applyVerseStyle(win.document.body)));
    // Wizard Bible notes open in reading view (setting). Only when a note is opened, so
    // switching to editing yourself sticks until you open another chapter.
    this.registerEvent(this.app.workspace.on("file-open", (file) => this.openBibleInReading(file)));
  }

  openBibleInReading(file) {
    if (!this.settings.bibleReadingView || !(file instanceof TFile)) return;
    const cls = this.app.metadataCache.getFileCache(file)?.frontmatter?.cssclasses;
    const list = Array.isArray(cls) ? cls : cls ? String(cls).split(/[\s,]+/) : [];
    if (!list.some((c) => c === "bible-chapter" || c === "bible-book" || c === "bible-index")) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file !== file || view.getMode() === "preview") return;
    const st = view.leaf.getViewState();
    view.leaf.setViewState({ ...st, state: { ...st.state, mode: "preview" } });
  }

  // "margin" / "inline" add body.pi-verses-margin / body.pi-verses-inline; "heading" adds
  // nothing, leaving verse headings to the theme. A theme can target these classes too.
  applyVerseStyle(body = document.body) {
    const v = this.settings.verseNumbers;
    body.toggleClass("pi-verses-margin", v === "margin");
    body.toggleClass("pi-verses-inline", v === "inline");
  }

  onunload() {
    document.body.removeClass("pi-verses-margin", "pi-verses-inline");
    for (const t of this.pending.values()) window.clearTimeout(t);
    // An open wizard belongs to this copy of the plugin; after a reload its settings would be
    // stale (2026-10-30: a Bible written during a reload was dropped from the list). Close it.
    this.openWizard?.close();
  }

  isExcluded(path) {
    return this.settings.excludedFolders.some((f) => f && (path === f || path.startsWith(f.replace(/\/$/, "") + "/")));
  }

  // Read live from Obsidian's metadata cache, so changing the setting needs no rebuild.
  // Matching ignores case and a leading "#", so `tags: [topic]` works with property "tags".
  isTopic(path) {
    const s = this.settings;
    const inFolder = (s.topicFolders || []).some((f) => f && path.startsWith(f.replace(/\/$/, "") + "/"));
    if (inFolder) return true;
    const key = (s.topicProperty || "").trim();
    const want = (s.topicValues || []).map((v) => v.trim().replace(/^#/, "").toLowerCase()).filter(Boolean);
    if (!key || !want.length) return false;
    const f = this.app.vault.getAbstractFileByPath(path);
    const v = f instanceof TFile ? this.app.metadataCache.getFileCache(f)?.frontmatter?.[key] : undefined;
    if (v == null) return false;
    return (Array.isArray(v) ? v : String(v).split(",")).some((x) => x != null && want.includes(String(x).trim().replace(/^#/, "").toLowerCase()));
  }

  async indexFile(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this.isExcluded(file.path)) { this.index.remove(file.path); return; }
    const text = await this.app.vault.cachedRead(file);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const ignoreKey = (this.settings.ignoreProperty || "").trim();
    this.index.setFile(file.path, text, file.basename, fm?.passage, ignoreKey ? fm?.[ignoreKey] : undefined);
  }

  // The note's ignore property, parsed into ranges (read live from the metadata cache).
  ignoredRanges(file) {
    const key = (this.settings.ignoreProperty || "").trim();
    const v = key ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[key] : undefined;
    return (v == null ? [] : (Array.isArray(v) ? v : [v])).flatMap((o) => (o == null ? [] : this.reader.parse(String(o))));
  }

  // References under the cursor, or overlapping the selection, read the way the index reads
  // them (so link targets and "Not references" phrases are skipped). The note's own main
  // passage is never offered. Returns { file, add, remove } or null.
  ignoreTargets(editor, file) {
    if (!(file instanceof TFile) || file.extension !== "md" || !editor) return null;
    const from = editor.posToOffset(editor.getCursor("from")), to = editor.posToOffset(editor.getCursor("to"));
    const main = this.index.files.get(file.path)?.main || [];
    const refs = [];
    for (const r of this.reader.parse(this.index.mask(editor.getValue()))) {
      const hit = from === to ? r.start <= from && from <= r.end : r.start < to && r.end > from;
      if (!hit || main.some((m) => covers(m, r))) continue;
      if (!refs.some((x) => format(x) === format(r))) refs.push(r);
    }
    if (!refs.length) return null;
    const ign = this.ignoredRanges(file);
    const isIgnored = (r) => ign.some((i) => covers(i, r));
    return { file, add: refs.filter((r) => !isIgnored(r)), remove: refs.filter(isIgnored) };
  }

  // Add references to (on) or remove them from (off) the note's ignore property. Removing a
  // reference removes every entry that covers it (e.g. a whole-chapter "Acts 11").
  async setIgnored(file, refs, on) {
    const key = (this.settings.ignoreProperty || "").trim();
    if (!key) { new Notice("Passage Index: set an Ignore property in settings first."); return; }
    const entryCovers = (x, r) => this.reader.parse(String(x)).some((i) => covers(i, r));
    let removed = [];
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      let list = (fm[key] == null ? [] : (Array.isArray(fm[key]) ? fm[key] : [fm[key]])).filter((x) => x != null).map(String);
      if (on) {
        for (const r of refs) if (!list.some((x) => entryCovers(x, r))) list.push(format(r));
      } else {
        removed = list.filter((x) => refs.some((r) => entryCovers(x, r)));
        list = list.filter((x) => !removed.includes(x));
      }
      if (list.length) fm[key] = list; else delete fm[key];
    });
    const names = refs.map(format).join(", ");
    new Notice(on ? `Passage Index: ignoring ${names} in this note.`
      : `Passage Index: no longer ignoring ${names}` + (removed.some((x) => !refs.some((r) => format(r) === x)) ? ` (removed ${removed.join(", ")})` : "") + ".");
  }

  // Build the whole index. A note that can't be read (error, or no answer within 5 s)
  // is skipped and reported, instead of stopping the build. Starting a new build
  // cancels any build still running.
  async buildIndex() {
    const gen = (this.buildGen = (this.buildGen || 0) + 1);
    this.ready = false;
    const index = new PassageIndex(this.reader, this.settings);
    this.index = index;
    const files = this.app.vault.getMarkdownFiles();
    this.progress = { done: 0, total: files.length };
    this.skipped = [];
    this.refreshViews();
    const t0 = Date.now();
    const timeout = (ms) => new Promise((_, rej) => window.setTimeout(() => rej(new Error("timed out")), ms));
    try {
      for (let i = 0; i < files.length; i++) {
        if (gen !== this.buildGen) return; // superseded by a newer build
        try {
          await Promise.race([this.indexFile(files[i]), timeout(5000)]);
        } catch (e) {
          this.skipped.push(files[i].path);
          console.warn(`Passage Index: skipped ${files[i].path}:`, e);
        }
        this.progress.done = i + 1;
        if (i % 100 === 99) { await new Promise((r) => window.setTimeout(r, 0)); this.refreshViews(); }
      }
    } finally {
      if (gen === this.buildGen) {
        this.ready = true;
        const s = index.stats();
        this.lastBuild = `${s.notes} notes, ${s.refs} references, ${Date.now() - t0} ms` +
          (this.skipped.length ? `, ${this.skipped.length} skipped (see console)` : "");
        this.refreshViews();
      }
    }
  }

  // Re-index a changed file after a short pause, so typing doesn't re-scan on every key.
  queue(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return;
    if (this.isExcluded(file.path) && !this.index.files.has(file.path)) return; // e.g. a wizard Bible being written
    window.clearTimeout(this.pending.get(file.path));
    this.pending.set(file.path, window.setTimeout(async () => {
      this.pending.delete(file.path);
      try { await this.indexFile(file); } catch (e) { console.warn(`Passage Index: couldn't re-index ${file.path}:`, e); }
      this.refreshViews();
    }, 1500));
  }

  refreshViews() {
    // A pane in a hidden tab may still be a deferred placeholder without render();
    // it renders itself when shown (onOpen). Never let a refresh stop an index build.
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      try { if (typeof leaf.view?.render === "function") leaf.view.render(); }
      catch (e) { console.warn("Passage Index: couldn't refresh pane:", e); }
    }
    for (const m of this.mapBlocks || []) {
      try { m.render(); } catch (e) { console.warn("Passage Index: couldn't refresh map:", e); }
    }
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  // Open a result in a new tab and jump to the line, without covering the note being read.
  // Then highlight the reference for a few seconds.
  async openResult(path, line, col, refText, where = "tab") {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const leaf = where === "split" ? this.app.workspace.getLeaf("split", "vertical") : this.app.workspace.getLeaf("tab");
    await leaf.openFile(file, line >= 0 ? { eState: { line } } : {});
    this.showRef(leaf.view, line, col, refText);
  }

  // Scroll a note's view to a reference and highlight it for a few seconds.
  showRef(view, line, col, refText) {
    if (line < 0 || !(view instanceof MarkdownView)) return;
    if (view.getMode() === "preview") { view.setEphemeralState({ line }); return; }
    if (!view.editor) return;
    const editor = view.editor;
    if (line >= editor.lineCount()) return;

    // Find the reference on the line. The note may have been edited since indexing,
    // so look for the text near the remembered column, then anywhere on the line.
    const lineStr = editor.getLine(line);
    let ch = -1;
    if (refText) {
      ch = lineStr.slice(col).startsWith(refText) ? col : lineStr.indexOf(refText);
    }
    const from = { line, ch: ch >= 0 ? ch : 0 };
    const to = { line, ch: ch >= 0 ? ch + refText.length : lineStr.length };
    editor.setCursor(from);
    editor.scrollIntoView({ from, to }, true);

    const cm = editor.cm; // CodeMirror 6 view (source and live preview modes)
    if (!cm || view.getMode() !== "source") return;
    window.clearTimeout(this.flashTimer);
    cm.dispatch({ effects: flashEffect.of({ from: editor.posToOffset(from), to: editor.posToOffset(to) }) });
    this.flashTimer = window.setTimeout(() => {
      try { cm.dispatch({ effects: flashEffect.of(null) }); } catch (e) { /* tab closed */ }
    }, (this.settings.flashSeconds || 3) * 1000);
  }

  // The pane's group header: show where the note being read cites this passage. Each
  // click on the same group moves on to the next place.
  showInNote(file, g) {
    const places = this.index.placesIn(file.path, g.ref);
    if (!places.length) { new Notice(`${g.label} isn't cited in the body of this note.`); return; }
    const key = file.path + "|" + g.key;
    this.cycle = this.cycle?.key === key ? { key, i: (this.cycle.i + 1) % places.length } : { key, i: 0 };
    const p = places[this.cycle.i];
    const leaf = this.leafFor(file);
    if (!leaf) return;
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.showRef(leaf.view, p.line, p.col, p.text);
    if (places.length > 1) new Notice(`${g.label}: ${this.cycle.i + 1} of ${places.length}`, 1500);
  }

  // The open tab showing this note: the most recent one if it is, otherwise any.
  leafFor(file) {
    const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    if (recent?.view instanceof MarkdownView && recent.view.file?.path === file.path) return recent;
    return this.app.workspace.getLeavesOfType("markdown").find((l) => l.view.file?.path === file.path) || null;
  }

  // Bible text for the verse pop-up. Each translation is one file, bibles/<id>.json, in the
  // plugin's own folder. That folder isn't part of the vault's file list, so the Vault API
  // can't see it; the adapter is the way to read and write there.
  bibleDir() { return normalizePath(`${this.manifest.dir}/bibles`); }
  biblePath(id) { return normalizePath(`${this.bibleDir()}/${id}.json`); }

  // Ids of the translations downloaded so far, in catalog order (custom ids last). Cached;
  // a download or delete clears the cache.
  async downloadedBibles() {
    if (!this.downloadedIds) {
      const adapter = this.app.vault.adapter;
      let ids = [];
      if (await adapter.exists(this.bibleDir())) {
        const { files } = await adapter.list(this.bibleDir());
        ids = files.map((f) => f.split("/").pop()).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
      }
      const order = (x) => { const i = TRANSLATIONS.findIndex((t) => t.id === x); return i < 0 ? 999 : i; };
      this.downloadedIds = ids.sort((a, b) => order(a) - order(b));
    }
    return [...this.downloadedIds];
  }

  // A translation, read on first use and kept (one at a time). Null if it isn't downloaded.
  loadBible(id = this.settings.bibleTranslation) {
    if (!VALID_ID.test(id || "")) return Promise.resolve(null);
    if (this.bibleCache?.id === id) return Promise.resolve(this.bibleCache.bible);
    if (this.bibleLoading?.id !== id) {
      const path = this.biblePath(id);
      const adapter = this.app.vault.adapter;
      const promise = (async () => {
        if (!(await adapter.exists(path))) return null;
        return JSON.parse(await adapter.read(path));
      })().catch((e) => { console.error(`Passage Index: couldn't read ${path}:`, e); return null; })
        .then((b) => {
          if (this.bibleLoading?.promise === promise) this.bibleLoading = null;
          if (b) this.bibleCache = { id, bible: b };
          return b;
        });
      this.bibleLoading = { id, promise };
    }
    return this.bibleLoading.promise;
  }

  // Section headings for grouping the pane, kept apart from the pop-up's Bible (which may be
  // another translation): only the headings and chapter lengths. undefined = not loaded yet;
  // null = not downloaded, or downloaded before 0.0.35 (no headings).
  sectionsCache(id) {
    return this.sectionData?.id === id ? this.sectionData.data : undefined;
  }
  async loadSections(id) {
    if (this.sectionData?.id === id) return this.sectionData.data;
    if (this.sectionLoading?.id === id) return this.sectionLoading.promise;
    const promise = (async () => {
      let data = null;
      try {
        const path = this.biblePath(id);
        if (VALID_ID.test(id || "") && await this.app.vault.adapter.exists(path)) {
          const b = JSON.parse(await this.app.vault.adapter.read(path));
          if (b.sections && Object.keys(b.sections).length) {
            const books = {};
            for (const [k, chs] of Object.entries(b.books || {})) books[k] = chs.map((c) => ({ length: c.length }));
            data = { sections: b.sections, books };
          }
        }
      } catch (e) { console.error(`Passage Index: couldn't read section headings from ${id}:`, e); }
      this.sectionData = { id, data };
      this.sectionLoading = null;
      return data;
    })();
    this.sectionLoading = { id, promise };
    return promise;
  }

  // Download a translation from the Free Use Bible API (bible.helloao.org), trim it, and
  // store it. The only time Passage Index goes online, and only when asked. True if it worked.
  async downloadBible(id) {
    if (!VALID_ID.test(id || "")) { new Notice(`Passage Index: "${id}" isn't a valid translation id.`); return false; }
    this.downloading = this.downloading || new Set();
    if (this.downloading.has(id)) return false;
    this.downloading.add(id);
    const info = translationInfo(id);
    const notice = new Notice(`Passage Index: downloading the ${info.short}…`, 0);
    try {
      const res = await requestUrl({ url: downloadUrl(id) });
      notice.setMessage(`Passage Index: preparing the ${info.short}…`);
      const bible = trimBible(res.json, info.short);
      if (!Object.keys(bible.books).length) throw new Error("the download has no books");
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.bibleDir()))) await adapter.mkdir(this.bibleDir());
      const json = JSON.stringify(bible);
      await adapter.write(this.biblePath(id), json);
      this.downloadedIds = null;
      if (this.bibleCache?.id === id) this.bibleCache = null;
      if (this.sectionData?.id === id) { this.sectionData = null; this.refreshViews(); }
      notice.setMessage(`Passage Index: the ${info.short} is ready (${(json.length / 1e6).toFixed(1)} MB).`);
      window.setTimeout(() => notice.hide(), 4000);
      return true;
    } catch (e) {
      console.error(`Passage Index: couldn't download ${id}:`, e);
      const why = e?.status === 404 ? "No translation has that id." : e?.status ? `The server answered ${e.status}.` : "Check your internet connection.";
      notice.setMessage(`Passage Index: couldn't download the ${info.short}. ${why}`);
      window.setTimeout(() => notice.hide(), 8000);
      return false;
    } finally {
      this.downloading.delete(id);
    }
  }

  async deleteBible(id) {
    if (!VALID_ID.test(id || "")) return;
    const path = this.biblePath(id);
    if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
    this.downloadedIds = null;
    if (this.bibleCache?.id === id) this.bibleCache = null;
    if (this.sectionData?.id === id) { this.sectionData = null; this.refreshViews(); }
  }

  // --- Bible wizard: a whole translation written into the vault as notes (optional) ---

  // The raw translation from the API (the wizard needs the headings and footnotes that the
  // pop-up's trimmed copy drops). Throws with a readable message.
  async fetchComplete(id) {
    if (!VALID_ID.test(id || "")) throw new Error(`"${id}" isn't a valid translation id.`);
    try {
      return (await requestUrl({ url: downloadUrl(id) })).json;
    } catch (e) {
      throw new Error(e?.status === 404 ? "No translation has that id." : e?.status ? `The server answered ${e.status}.` : "Couldn't connect. Check your internet connection.");
    }
  }

  // Planned notes whose names are already used elsewhere in the vault ("Revelation", "Daniel 7"),
  // which would make links like [[Revelation]] ambiguous.
  nameConflicts(plan) {
    const names = new Set(plan.files.map((f) => f.path.split("/").pop().replace(/\.md$/, "").toLowerCase()));
    return this.app.vault.getMarkdownFiles()
      .filter((f) => !f.path.startsWith(plan.base + "/") && names.has(f.basename.toLowerCase()))
      .map((f) => f.path);
  }

  // Write a plan's notes. Existing notes at the same paths are replaced (regenerate). The
  // translation's folder is added to the excluded folders first, so the index skips it.
  // onProgress(done, total); stops early if shouldStop() returns true. Returns notes written.
  async writeBible(plan, entry, onProgress, shouldStop) {
    const s = this.settings;
    if (!this.isExcluded(plan.base + "/x.md")) { s.excludedFolders.push(plan.base); await this.saveSettings(); }
    const vault = this.app.vault;
    for (const dir of plan.folders) {
      const p = normalizePath(dir);
      if (!vault.getAbstractFileByPath(p)) await vault.createFolder(p);
    }
    let done = 0;
    for (const f of plan.files) {
      if (shouldStop?.()) break;
      const p = normalizePath(f.path);
      const existing = vault.getAbstractFileByPath(p);
      if (existing instanceof TFile) await vault.process(existing, () => f.content);
      else await vault.create(p, f.content);
      done++;
      if (done % 25 === 0) { onProgress?.(done, plan.files.length); await new Promise((r) => window.setTimeout(r, 0)); }
    }
    onProgress?.(done, plan.files.length);
    s.bibles = (s.bibles || []).filter((b) => b.base !== entry.base).concat(done ? [entry] : []);
    await this.saveSettings();
    await this.syncSearchExclusions();
    return done;
  }

  // Remove a wizard Bible: its folder goes to the trash (Obsidian's trash setting decides where).
  async removeBible(entry) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(entry.base));
    if (folder instanceof TFolder) {
      if (this.app.fileManager.trashFile) await this.app.fileManager.trashFile(folder);
      else await this.app.vault.trash(folder, true);
    }
    this.settings.bibles = (this.settings.bibles || []).filter((b) => b.base !== entry.base);
    this.settings.excludedFolders = this.settings.excludedFolders.filter((f) => f !== entry.base);
    await this.saveSettings();
    await this.syncSearchExclusions();
  }

  // Regenerate a wizard Bible with the options it was made with (downloads it again).
  async regenerateBible(entry) {
    const notice = new Notice(`Passage Index: downloading the ${entry.short}…`, 0);
    try {
      const plan = planBible(await this.fetchComplete(entry.id), entry.options, entry.short, entry.name);
      const n = await this.writeBible(plan, { ...entry, chapters: plan.chapters, created: localDate() },
        (d, t) => notice.setMessage(`Passage Index: writing the ${entry.short}… ${d} of ${t}`));
      notice.setMessage(`Passage Index: the ${entry.short} was regenerated (${n} notes).`);
    } catch (e) {
      console.error("Passage Index: regenerate failed:", e);
      notice.setMessage(`Passage Index: couldn't regenerate the ${entry.short}. ${e.message || ""}`);
    }
    window.setTimeout(() => notice.hide(), 6000);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  // Keep Obsidian's "Excluded files" in step with the wizard Bibles: add their folders when the
  // setting is on, take out only the entries PI added when it's off or a Bible is removed.
  // Entries the user added themselves are never touched.
  async syncSearchExclusions() {
    const vault = this.app.vault;
    if (typeof vault.getConfig !== "function" || typeof vault.setConfig !== "function") return;
    const s = this.settings;
    const want = s.hideBiblesFromSearch ? (s.bibles || []).map((b) => b.base.replace(/\/$/, "") + "/") : [];
    const mine = s.searchHidden || [];
    const current = Array.isArray(vault.getConfig("userIgnoreFilters")) ? vault.getConfig("userIgnoreFilters") : [];
    const next = current.filter((f) => !mine.includes(f) || want.includes(f));
    const added = [];
    for (const f of want) if (!next.includes(f)) { next.push(f); added.push(f); }
    // Remember ours: ones we just added, plus ones we added earlier and still want.
    s.searchHidden = want.filter((f) => added.includes(f) || mine.includes(f));
    if (next.length !== current.length || next.some((f, i) => f !== current[i])) vault.setConfig("userIgnoreFilters", next);
    await this.saveSettings();
  }
}

// ---- Coverage map ---------------------------------------------------------------------
// Drawn by the pane's Map tab and by `pi-map` code blocks. Two levels: a book's chapters,
// then one chapter's verses. Shade = mentions (0 / 1 / 2–3 / 4+); a dot = some note's main
// passage; an outline = the note being read. Click a verse for the notes that cite it.
const MAP_ABBR = ["Gen", "Exod", "Lev", "Num", "Deut", "Josh", "Judg", "Ruth", "1 Sam", "2 Sam", "1 Kgs", "2 Kgs",
  "1 Chr", "2 Chr", "Ezra", "Neh", "Esth", "Job", "Ps", "Prov", "Eccl", "Song", "Isa", "Jer", "Lam", "Ezek", "Dan",
  "Hos", "Joel", "Amos", "Obad", "Jonah", "Mic", "Nah", "Hab", "Zeph", "Hag", "Zech", "Mal",
  "Matt", "Mark", "Luke", "John", "Acts", "Rom", "1 Cor", "2 Cor", "Gal", "Eph", "Phil", "Col", "1 Thess", "2 Thess",
  "1 Tim", "2 Tim", "Titus", "Phlm", "Heb", "Jas", "1 Pet", "2 Pet", "1 John", "2 John", "3 John", "Jude", "Rev"];
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// Mentions per book (for shading the book picker), one pass over the index.
function bookTotals(index) {
  const t = new Map();
  for (const e of index.files.values()) for (const r of e.refs) t.set(r.book, (t.get(r.book) || 0) + 1);
  return t;
}

// state: { book, chapter, verse, picking } (changed in place). opts:
//   file: the note being read (outlined), or null
//   rerender(): redraw after a state change
//   hoverParent: a Component for Obsidian's page preview
//   wireVerse(el, g): Ctrl + hover pop-up (the pane only)
function drawMap(el, plugin, state, opts) {
  const index = plugin.index;
  const wrap = el.createDiv({ cls: "pi-map" });
  const nav = wrap.createDiv({ cls: "pi-map-nav" });
  const name = BOOK_NAME[state.book] || "";

  if (state.chapter) {
    const back = nav.createDiv({ cls: "pi-map-back clickable-icon", attr: { "aria-label": `Back to ${name}` } });
    setIcon(back, "arrow-left");
    back.addEventListener("click", () => { state.chapter = null; state.verse = null; opts.rerender(); });
  }
  const pick = nav.createDiv({ cls: "pi-map-book" + (state.picking ? " is-open" : ""), text: state.chapter ? `${name} ${state.chapter}` : name });
  setIcon(pick.createSpan({ cls: "pi-map-caret" }), state.picking ? "chevron-up" : "chevron-down");
  pick.setAttr("aria-label", "Choose a book");
  pick.addEventListener("click", () => { state.picking = !state.picking; opts.rerender(); });
  // Back to where this map started (the note's book, or the block's book/chapter).
  const home = opts.home;
  if (home && (state.book !== home.book || state.chapter !== home.chapter || state.verse || state.picking)) {
    const h = nav.createDiv({ cls: "pi-map-home clickable-icon", attr: { "aria-label": opts.file && !opts.block ? "Back to this note" : "Back to the start" } });
    setIcon(h, "locate");
    h.addEventListener("click", () => { Object.assign(state, home, { verse: null, picking: false }); opts.rerender(); });
  }

  if (state.picking) {
    const totals = bookTotals(index);
    for (const [label, from, to] of [["Old Testament", 1, 39], ["New Testament", 40, 66]]) {
      wrap.createDiv({ cls: "pi-map-label", text: label });
      const grid = wrap.createDiv({ cls: "pi-map-books" });
      for (let b = from; b <= to; b++) {
        const n = totals.get(b) || 0;
        const cell = grid.createDiv({ cls: `pi-map-bk pi-lv${level(Math.ceil(n / 4))}` + (b === state.book ? " is-current" : ""),
          text: MAP_ABBR[b - 1], attr: { "aria-label": `${BOOK_NAME[b]}: ${plural(n, "mention")}` } });
        cell.addEventListener("click", () => { Object.assign(state, { book: b, chapter: null, verse: null, picking: false }); opts.rerender(); });
      }
    }
    return;
  }

  const cov = coverage(index, state.book, { broadChapters: plugin.settings.broadChapters || 2 });
  if (!cov) { wrap.createDiv({ cls: "pi-empty", text: `No map for ${name || "this book"} (Bible books only).` }); return; }
  const mine = opts.file ? marks(index.files.get(opts.file.path)?.main || [], state.book) : { chapters: new Set(), verses: new Set() };
  const bookName = BOOK_NAME[state.book];

  if (!state.chapter) {
    const covered = cov.chapters.filter((c) => c.mentions).length;
    wrap.createDiv({ cls: "pi-map-sum", text: `${covered} of ${plural(cov.chapters.length, "chapter")} mentioned` });
    const grid = wrap.createDiv({ cls: "pi-map-grid" });
    for (const ch of cov.chapters) {
      const vs = ch.verse.filter((v) => v.mentions).length;
      const cell = grid.createDiv({ cls: `pi-map-sq pi-lv${level(ch.mentions)}` + (mine.chapters.has(ch.c) ? " is-mine" : ""),
        text: String(ch.c),
        attr: { "aria-label": `${bookName} ${ch.c}: ${plural(ch.mentions, "mention")} in ${plural(ch.notes.size, "note")}; ${vs} of ${ch.verses} verses` } });
      if (ch.isMain) cell.createSpan({ cls: "pi-map-dot" });
      cell.addEventListener("click", () => { state.chapter = ch.c; state.verse = null; opts.rerender(); });
      opts.wireVerse?.(cell, { label: `${bookName} ${ch.c}`, ref: { book: state.book, bookName, c1: ch.c, v1: null, c2: ch.c, v2: null } });
    }
    legend(wrap);
    return;
  }

  const ch = cov.chapters[state.chapter - 1];
  if (!ch) { state.chapter = null; opts.rerender(); return; }
  const covered = ch.verse.filter((v) => v.mentions).length;
  wrap.createDiv({ cls: "pi-map-sum", text: `${covered} of ${plural(ch.verses, "verse")} mentioned` +
    (ch.chapterMentions ? ` · ${plural(ch.chapterMentions, "whole-chapter mention")}` : "") });
  const grid = wrap.createDiv({ cls: "pi-map-grid" });
  for (const v of ch.verse) {
    const cell = grid.createDiv({ cls: `pi-map-sq pi-lv${level(v.mentions)}` + (mine.verses.has(`${ch.c}:${v.v}`) ? " is-mine" : "") +
      (state.verse === v.v ? " is-selected" : ""), text: String(v.v),
      attr: { "aria-label": `${bookName} ${ch.c}:${v.v}: ${plural(v.mentions, "mention")} in ${plural(v.notes.size, "note")}` } });
    if (v.isMain) cell.createSpan({ cls: "pi-map-dot" });
    cell.addEventListener("click", () => { state.verse = state.verse === v.v ? null : v.v; opts.rerender(); });
    opts.wireVerse?.(cell, { label: `${bookName} ${ch.c}:${v.v}`, ref: { book: state.book, bookName, c1: ch.c, v1: v.v, c2: ch.c, v2: v.v } });
  }
  legend(wrap);

  // The notes: for the selected verse, or the whole-chapter mentions when none is selected.
  const v = state.verse ? ch.verse[state.verse - 1] : null;
  const notes = v ? v.notes : ch.chapterNotes;
  if (!v && !notes.size) { wrap.createDiv({ cls: "pi-none", text: "Click a verse to list its notes." }); return; }
  wrap.createDiv({ cls: "pi-map-label", text: v ? `${bookName} ${ch.c}:${v.v} — ${plural(notes.size, "note")}` : `Whole-chapter mentions — ${plural(notes.size, "note")}` });
  const list = wrap.createDiv({ cls: "pi-list" });
  const sorted = [...notes.values()].sort((a, b) => (b.count - a.count) || a.path.localeCompare(b.path));
  if (!sorted.length) list.createDiv({ cls: "pi-none", text: "No notes." });
  for (const n of sorted) {
    const item = list.createDiv({ cls: "pi-item" + (opts.file?.path === n.path ? " is-about" : "") });
    const top = item.createDiv({ cls: "pi-item-top" });
    top.createSpan({ cls: "pi-name", text: n.path.split("/").pop().replace(/\.md$/, "") });
    const meta = top.createSpan({ cls: "pi-meta" });
    if (plugin.isTopic(n.path)) meta.createSpan({ cls: "pi-tag pi-topic", text: "topic" });
    if (n.count > 1) meta.createSpan({ cls: "pi-tag", text: `×${n.count}` });
    meta.createSpan({ cls: "pi-folder", text: n.path.includes("/") ? n.path.split("/")[0] : "/" });
    item.addEventListener("click", () => plugin.openResult(n.path, n.line, n.col, n.refText));
    item.addEventListener("mouseover", (event) => {
      plugin.app.workspace.trigger("hover-link", { event, source: VIEW_TYPE, hoverParent: opts.hoverParent, targetEl: item,
        linktext: n.path, sourcePath: opts.file?.path || "", state: n.line >= 0 ? { scroll: n.line } : undefined });
    });
  }
}

function legend(wrap) {
  const l = wrap.createDiv({ cls: "pi-map-legend" });
  for (const [lv, t] of [[0, "0"], [1, "1"], [2, "2–3"], [3, "4+"]]) {
    const k = l.createSpan({ cls: "pi-map-key" });
    k.createSpan({ cls: `pi-map-swatch pi-lv${lv}` });
    k.appendText(t);
  }
  const d = l.createSpan({ cls: "pi-map-key" });
  d.createSpan({ cls: "pi-map-swatch has-dot" }).createSpan({ cls: "pi-map-dot" });
  d.appendText("main passage");
  const m = l.createSpan({ cls: "pi-map-key" });
  m.createSpan({ cls: "pi-map-swatch is-mine" });
  m.appendText("this note");
}

// `pi-map` code block: a live map in a note. The block's text names the book, optionally a
// chapter ("Revelation" or "Revelation 1"). It redraws when the index changes.
class MapBlock extends MarkdownRenderChild {
  constructor(el, plugin, source, sourcePath) {
    super(el);
    this.plugin = plugin;
    this.sourcePath = sourcePath;
    const text = source.trim().split("\n")[0].trim();
    const r = text && (plugin.reader.parse(text)[0] || plugin.reader.parse(`${text} 1`)[0]);
    const chapterGiven = r && /\d\s*$/.test(text) && plugin.reader.parse(text)[0];
    this.state = r ? { book: r.book, chapter: chapterGiven ? r.c1 : null, verse: null, picking: false } : null;
    this.home = this.state && { ...this.state };
    this.text = text;
  }
  onload() { this.plugin.mapBlocks.add(this); this.render(); }
  onunload() { this.plugin.mapBlocks.delete(this); }
  render() {
    const el = this.containerEl;
    el.empty();
    el.addClass("passage-index", "pi-map-block");
    if (!this.state) { el.createDiv({ cls: "pi-empty", text: `pi-map: name a book, e.g. "Revelation" (got "${this.text}").` }); return; }
    if (!this.plugin.ready) { el.createDiv({ cls: "pi-empty", text: "Building index…" }); return; }
    const f = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
    drawMap(el, this.plugin, this.state, { file: f instanceof TFile ? f : null, rerender: () => this.render(), hoverParent: this, home: this.home, block: true });
  }
}

class PassagePane extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.openState = new Map(); // remember which groups the user opened/closed, per note
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Passage Index"; }
  getIcon() { return "book-open-text"; }
  async onOpen() {
    // Verse pop-up: Ctrl pressed while already over a passage label shows it; Esc closes it.
    const isMod = (evt) => evt.key === "Control" || evt.key === "Meta";
    this.registerDomEvent(window, "keydown", (evt) => {
      if (evt.key === "Escape") this.hideVerse();
      else if (isMod(evt) && this.plugin.settings.versePopup && this.verseHover && !this.versePop) {
        this.showVerse(this.verseHover.label, this.verseHover.g);
      }
    });
    // Optional: releasing Ctrl closes the pop-up, unless the pointer is on it (reading, scrolling).
    this.registerDomEvent(window, "keyup", (evt) => {
      const p = this.versePop;
      if (isMod(evt) && p && this.plugin.settings.closeOnCtrlRelease && !this.verseMenuOpen && !p.el.matches(":hover")) this.hideVerse();
    });
    this.registerDomEvent(this.contentEl, "scroll", () => this.hideVerse(), { capture: true });
    // A click anywhere outside the pop-up (and its menu) closes it.
    this.registerDomEvent(document, "mousedown", (evt) => {
      const p = this.versePop;
      if (p && !this.verseMenuOpen && !p.el.contains(evt.target)) this.hideVerse();
    });
    this.render();
  }
  async onClose() { this.hideVerse(); }

  // The Map tab. Follows reading: opening another note moves the map to that note's main
  // passage book (or the book it cites first); the book picker shows any other book.
  renderMap(el, file) {
    if (this.mapFile !== file.path) {
      this.mapFile = file.path;
      const e = this.plugin.index.files.get(file.path);
      const r = e?.main.find((x) => x.book <= 66) || e?.refs.find((x) => x.book <= 66);
      this.mapState = { book: r?.book || this.mapState?.book || 1, chapter: null, verse: null, picking: false };
      this.mapHome = { book: this.mapState.book, chapter: null };
    }
    drawMap(el, this.plugin, this.mapState, { home: this.mapHome,
      file, hoverParent: this,
      rerender: () => this.render(),
      wireVerse: (cell, g) => this.wireVerse(cell, g),
    });
  }

  render() {
    const el = this.contentEl;
    this.hideVerse();
    this.verseHover = null;
    el.empty();
    el.addClass("passage-index");
    const file = this.app.workspace.getActiveFile();

    if (!this.plugin.ready) {
      const p = this.plugin.progress;
      el.createDiv({ cls: "pi-empty", text: p ? `Building index… ${p.done} of ${p.total} notes` : "Building index…" });
      const again = el.createEl("button", { text: "Rebuild now" });
      again.addEventListener("click", () => this.plugin.buildIndex());
      return;
    }
    if (!file || file.extension !== "md") { el.createDiv({ cls: "pi-empty", text: "Open a note to see related passages." }); return; }

    const groups = this.plugin.index.groupsFor(file.path);
    const head = el.createDiv({ cls: "pi-head" });
    const titleRow = head.createDiv({ cls: "pi-title-row" });
    titleRow.createDiv({ cls: "pi-title", text: file.basename });
    const main = groups.filter((g) => g.isMain).map((g) => g.label);
    head.createDiv({ cls: "pi-sub", text: main.length ? `Main passage: ${main.join("; ")}` : "No main passage (topic note)" });
    const ignored = this.plugin.index.ignoredFor(file.path);
    if (ignored.length) head.createDiv({ cls: "pi-sub pi-ignored", text: `Ignoring: ${ignored.join("; ")}` });

    // Index | Map tabs (the last one used is remembered).
    const tab = this.plugin.settings.paneTab === "map" ? "map" : "index";
    const tabs = head.createDiv({ cls: "pi-tabs" });
    for (const [id, text] of [["index", "Index"], ["map", "Map"]]) {
      const t = tabs.createDiv({ cls: "pi-tab" + (tab === id ? " is-active" : ""), text });
      t.addEventListener("click", async () => {
        if (tab === id) { if (id === "map") { this.mapFile = null; this.render(); } return; }
        this.plugin.settings.paneTab = id;
        await this.plugin.saveSettings();
        this.render();
      });
    }
    if (tab === "map") { this.renderMap(el, file); return; }

    // Broad matches ("Mark 1–8") and chapter-only mentions ("Matthew 24" under Matt 24:3)
    // can be hidden, in the passage groups and in Topics alike.
    const hideBroad = this.hideBroad ?? this.plugin.settings.hideBroad;
    const hideChapter = hideBroad && this.plugin.settings.hideChapter;
    const isHidden = (n) => (hideBroad && n.broad) || (hideChapter && n.chapterOnly);

    this.renderIntertexts(el, file);
    this.renderTopics(el, file, isHidden);

    if (!groups.length) { el.createDiv({ cls: "pi-empty", text: "No scripture references in this note." }); return; }

    const dets = [];
    const setAll = (open, except) => { for (const d of dets) if (d !== except && !(except && d.contains(except))) d.open = open; };
    const tools = titleRow.createDiv({ cls: "pi-tools" });
    const btn = (icon, label, fn) => {
      const b = tools.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      b.addEventListener("click", fn);
    };
    btn("chevrons-down-up", "Collapse all", () => setAll(false));
    btn("chevrons-up-down", "Expand all", () => setAll(true));
    btn(hideBroad ? "filter" : "filter-x", hideBroad ? "Show hidden matches" : "Hide broad matches and chapter mentions",
      () => { this.hideBroad = !hideBroad; this.render(); });

    const remembered = this.openState.get(file.path) || {};
    const remember = (det, key) => {
      det.addEventListener("toggle", () => {
        const st = this.openState.get(file.path) || {};
        st[key] = det.open;
        this.openState.set(file.path, st);
      });
    };
    const renderGroup = (parent, g) => {
      // Hidden matches are counted so the group can offer to show them.
      const nBroad = hideBroad ? g.notes.filter((n) => n.broad).length : 0;
      const nChapter = hideChapter ? g.notes.filter((n) => n.chapterOnly && !n.broad).length : 0;
      const hidden = nBroad + nChapter;
      if (hidden) g.notes = g.notes.filter((n) => !isHidden(n));
      const det = parent.createEl("details", { cls: "pi-group" + (g.isMain ? " is-main" : "") + (g.notes.length ? "" : " is-empty") });
      dets.push(det);
      det.open = remembered[g.key] ?? g.open;
      remember(det, g.key);
      const sum = det.createEl("summary");
      setIcon(sum.createSpan({ cls: "pi-chevron" }), "chevron-right");
      const label = sum.createSpan({ cls: "pi-passage", text: g.label });
      // Clicking the passage itself shows it in this note (and opens the group);
      // the chevron and the rest of the header still open and close it.
      const nPlaces = this.plugin.index.placesIn(file.path, g.ref).length;
      if (nPlaces) {
        label.addClass("is-jump");
        label.setAttr("aria-label", nPlaces > 1 ? `Show in this note (${nPlaces} places; click again for the next)` : "Show in this note");
        label.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          if (!det.open) det.open = true;
          this.plugin.showInNote(file, g);
        });
      }
      this.wireVerse(label, g);
      sum.createSpan({ cls: "pi-count", text: String(g.notes.length),
        attr: hidden ? { "aria-label": hiddenText(nChapter, nBroad) } : {} });
      sum.addEventListener("contextmenu", (evt) => {
        evt.preventDefault();
        this.groupMenu(evt, g, det, setAll, file);
      });

      const list = det.createDiv({ cls: "pi-list" });
      for (const n of g.notes) {
        const item = list.createDiv({ cls: "pi-item" + (n.about ? " is-about" : "") });
        const top = item.createDiv({ cls: "pi-item-top" });
        top.createSpan({ cls: "pi-name", text: n.path.split("/").pop().replace(/\.md$/, "") });
        const meta = top.createSpan({ cls: "pi-meta" });
        if (n.about) meta.createSpan({ cls: "pi-tag pi-about", text: "about" });
        if (this.plugin.isTopic(n.path)) meta.createSpan({ cls: "pi-tag pi-topic", text: "topic" });
        meta.createSpan({ cls: `pi-tag pi-${n.match}`, text: n.matchLabel });
        if (n.otherGroups) meta.createSpan({ cls: "pi-tag pi-multi", text: `+${n.otherGroups}`, attr: { "aria-label": `Also under ${n.otherGroups} other passage(s) in this note` } });
        meta.createSpan({ cls: "pi-folder", text: n.path.includes("/") ? n.path.split("/")[0] : "/" });
        this.previewLine(item, n);
        this.wireItem(item, n, file);
      }
      if (!g.notes.length) list.createDiv({ cls: "pi-none", text: "No other notes." });
      if (hidden) {
        const more = list.createDiv({ cls: "pi-none pi-broad", text: `${hiddenText(nChapter, nBroad)} — show` });
        more.addEventListener("click", () => { this.hideBroad = false; this.render(); });
      }
    };

    // Group by section (setting): passages in the same section of the chosen translation go
    // under its heading. The main passage stays first; a passage alone in its section, or
    // before the book's first heading, stays as it is (the heading is its tooltip).
    const secId = this.plugin.settings.sectionsFrom;
    const secBible = secId ? this.plugin.sectionsCache(secId) : null;
    if (secId && secBible === undefined) this.plugin.loadSections(secId).then(() => this.render());
    if (!secBible) { for (const g of groups) renderGroup(el, g); }
    else {
      const buckets = [];
      const byKey = new Map();
      for (const g of groups) {
        const s = !g.isMain && g.ref.book <= 66 ? sectionOf(secBible, g.ref) : null;
        const key = s && `sec:${s.book}:${s.c1}:${s.v1}`;
        if (s && byKey.has(key)) { byKey.get(key).groups.push(g); continue; }
        const b = { s, key, groups: [g] };
        buckets.push(b);
        if (s) byKey.set(key, b);
      }
      for (const b of buckets) {
        if (!b.s || b.groups.length < 2) {
          for (const g of b.groups) renderGroup(el, g);
          if (b.s) el.lastElementChild?.querySelector(".pi-passage")?.setAttr("title", b.s.title);
          continue;
        }
        const s = b.s;
        const det = el.createEl("details", { cls: "pi-section" });
        dets.push(det);
        det.open = remembered[b.key] ?? false;
        remember(det, b.key);
        const sum = det.createEl("summary");
        setIcon(sum.createSpan({ cls: "pi-chevron" }), "chevron-right");
        const t = sum.createSpan({ cls: "pi-section-title" });
        t.createSpan({ text: s.title });
        const name = BOOK_NAME[s.book] || "";
        const range = s.c1 === s.c2 ? `${s.c1}:${s.v1}–${s.v2}` : `${s.c1}:${s.v1}–${s.c2}:${s.v2}`;
        t.createSpan({ cls: "pi-section-range", text: ` ${name} ${range}` });
        const n = b.groups.reduce((a, g) => a + g.notes.length, 0);
        sum.createSpan({ cls: "pi-count", text: String(b.groups.length),
          attr: { "aria-label": `${b.groups.length} passages in this section${n ? `, ${n} notes` : ""}` } });
        const inner = det.createDiv({ cls: "pi-section-list" });
        for (const g of b.groups) renderGroup(inner, g);
      }
    }
    if (this.plugin.lastBuild) el.createDiv({ cls: "pi-foot", text: `Index: ${this.plugin.lastBuild}` });
  }

  // Verse pop-up: Ctrl (Cmd on a Mac) + hover a passage label shows its text beside the
  // pane. It stays while the pointer is on the label or the pop-up (so a long passage can
  // be scrolled), and closes on leaving, Esc, scrolling the pane, or a re-render.
  wireVerse(label, g) {
    const mod = (evt) => (evt.ctrlKey || evt.metaKey) && this.plugin.settings.versePopup;
    label.addEventListener("mouseenter", (evt) => {
      this.verseHover = { label, g };
      if (mod(evt)) this.showVerse(label, g);
    });
    label.addEventListener("mousemove", (evt) => {
      if (mod(evt) && this.versePop?.label !== label) this.showVerse(label, g);
    });
    label.addEventListener("mouseleave", () => {
      if (this.verseHover?.label === label) this.verseHover = null;
      this.scheduleHideVerse();
    });
  }

  // sticky: opened from the translation menu or the Download button, where the pointer may
  // not be on the pop-up yet. It stays until the pointer has been on it and left, Esc, or a
  // click elsewhere.
  async showVerse(label, g, id = this.plugin.settings.bibleTranslation, sticky = false) {
    this.hideVerse();
    const pop = label.ownerDocument.body.createDiv({ cls: "pi-verse-popup" });
    this.versePop = { el: pop, label, sticky };
    pop.addEventListener("mouseenter", () => { if (this.versePop?.el === pop) this.versePop.sticky = false; });
    // Hide Obsidian's "Show in this note" tooltip while the pop-up is open (styles.css).
    label.ownerDocument.body.addClass("pi-verse-open");
    pop.addEventListener("mouseleave", () => this.scheduleHideVerse());
    const info = translationInfo(id);
    const head = pop.createDiv({ cls: "pi-verse-head" });
    const refEl = head.createSpan({ cls: "pi-verse-ref", text: g.label });
    // "Open in…" button: straight there when one target is on, a menu when several.
    const targets = OPEN_IN.filter((t) => this.plugin.settings.openIn?.[t.id]);
    if (targets.length && g.ref && g.ref.book <= 66) {
      const btn = refEl.createSpan({ cls: "pi-verse-openin",
        attr: { "aria-label": targets.length === 1 ? `Open in ${targets[0].name}` : "Open in…" } });
      setIcon(btn, "external-link");
      btn.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const menu = new Menu();
        addOpenIn(menu, this.plugin, g.ref);
        if (targets.length === 1) { this.hideVerse(); window.open(targets[0].url(g.ref, (this.plugin.settings.openInVersion?.[targets[0].id] || "").trim())); return; }
        this.verseMenuOpen = true;
        menu.onHide(() => { this.verseMenuOpen = false; this.scheduleHideVerse(); });
        menu.showAtMouseEvent(evt);
      });
    }
    // Tabs for the downloaded translations: one click switches.
    this.verseTabs(head.createDiv({ cls: "pi-verse-trs" }), label, g, id);
    const body = pop.createDiv({ cls: "pi-verse-body pi-verse-note", text: "Loading…" });
    this.placeVerse(pop, label);

    if (!VALID_ID.test(id || "")) {
      body.setText("Choose a translation in Passage Index settings.");
      this.placeVerse(pop, label);
      return;
    }
    const bible = await this.plugin.loadBible(id);
    if (this.versePop?.el !== pop) return; // closed or replaced while loading
    body.empty();
    if (!bible) {
      // Not downloaded yet: offer to download it here (the only network use, on request).
      body.setText(`The ${info.short} isn't downloaded yet.`);
      const btn = body.createEl("button", { cls: "pi-verse-download", text: `Download the ${info.short}` });
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.setText("Downloading…");
        const ok = await this.plugin.downloadBible(id);
        if (this.versePop?.el !== pop) return;
        if (ok) this.showVerse(label, g, id, true);
        else { btn.disabled = false; btn.setText("Try again"); }
      });
      this.placeVerse(pop, label);
      return;
    }
    const t = passageText(bible, g.ref);
    if (!t.ok) { body.setText(t.note); this.placeVerse(pop, label); return; }
    body.removeClass("pi-verse-note");

    // Poetry (any verse with line breaks) gets one block per verse; prose flows as a paragraph.
    const poetry = t.verses.some((x) => x.text && x.text.includes("\n"));
    const text = body.createDiv({ cls: "pi-verse-text" + (poetry ? " is-poetry" : "") });
    const multiChapter = t.verses.some((x) => x.c !== t.verses[0].c);
    t.verses.forEach((x, i) => {
      const v = text.createSpan({ cls: "pi-verse" });
      const newChapter = multiChapter && (i === 0 || x.c !== t.verses[i - 1].c);
      v.createEl("sup", { cls: "pi-verse-num", text: newChapter ? `${x.c}:${x.v}` : String(x.v) });
      if (x.text === null) { v.createSpan({ cls: "pi-verse-missing", text: `(not in the ${bible.short || bible.id})` }); }
      else {
        x.text.split("\n").forEach((line, j) => {
          if (j) v.createEl("br");
          const indent = line.match(/^\t*/)[0].length;
          v.appendText(" ".repeat(indent) + line.slice(indent));
        });
      }
      if (!poetry) text.appendText(" ");
    });
    if (t.more) body.createDiv({ cls: "pi-verse-more", text: `… ${t.more} more verse${t.more > 1 ? "s" : ""}` });
    this.placeVerse(pop, label);
  }

  // Beside the pane (to its left in the right sidebar), level with the label, kept on screen.
  placeVerse(pop, label) {
    const win = label.ownerDocument.defaultView || window;
    const pane = this.containerEl.getBoundingClientRect();
    const at = label.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight, gap = 8;
    let left = pane.left - w - gap;
    if (left < gap) left = Math.min(pane.right + gap, win.innerWidth - w - gap);
    const top = Math.max(gap, Math.min(at.top - gap, win.innerHeight - h - gap));
    pop.setCssProps({ "--pi-pop-left": `${Math.max(gap, left)}px`, "--pi-pop-top": `${top}px` });
  }

  // Translation tabs in the pop-up header: one per downloaded translation (catalog order,
  // so each keeps its place), the current one highlighted. One click switches, and the one
  // picked becomes the default. Past MAX tabs, the rest go behind "…". "+" opens settings.
  async verseTabs(el, label, g, current) {
    const MAX = 6;
    const ids = await this.plugin.downloadedBibles();
    if (current && !ids.includes(current)) ids.unshift(current); // chosen but not downloaded yet
    let shown = ids.slice(0, MAX);
    if (!shown.includes(current)) shown = [...shown.slice(0, MAX - 1), current];
    const rest = ids.filter((x) => !shown.includes(x));
    const pick = async (id) => {
      if (id === current) return;
      this.plugin.settings.bibleTranslation = id;
      await this.plugin.saveSettings();
      this.showVerse(label, g, id, true);
    };
    for (const id of shown) {
      const t = translationInfo(id);
      const tab = el.createSpan({ cls: "pi-verse-tr" + (id === current ? " is-active" : ""), text: t.short,
        attr: { "aria-label": t.name + (id === current ? "" : ". Click to switch.") } });
      tab.addEventListener("click", (evt) => { evt.stopPropagation(); pick(id); });
    }
    if (rest.length) {
      const more = el.createSpan({ cls: "pi-verse-tr", text: "…", attr: { "aria-label": `${rest.length} more` } });
      more.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const menu = new Menu();
        for (const id of rest) {
          const t = translationInfo(id);
          menu.addItem((i) => i.setTitle(`${t.short} — ${t.name}`).onClick(() => pick(id)));
        }
        this.verseMenuOpen = true;
        menu.onHide(() => { this.verseMenuOpen = false; this.scheduleHideVerse(); });
        menu.showAtMouseEvent(evt);
      });
    }
    const add = el.createSpan({ cls: "pi-verse-tr pi-verse-add", attr: { "aria-label": "Download more translations" } });
    setIcon(add, "plus");
    add.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.hideVerse();
      if (this.plugin.settingTab) this.plugin.settingTab.tab = "verse";
      this.app.setting?.open?.();
      this.app.setting?.openTabById?.(this.plugin.manifest.id);
    });
  }

  scheduleHideVerse() {
    window.clearTimeout(this.verseTimer);
    this.verseTimer = window.setTimeout(() => {
      const p = this.versePop;
      if (p && !p.sticky && !this.verseMenuOpen && !p.el.matches(":hover") && !p.label.matches(":hover")) this.hideVerse();
    }, 250);
  }

  hideVerse() {
    window.clearTimeout(this.verseTimer);
    this.versePop?.el.ownerDocument.body.removeClass("pi-verse-open");
    this.versePop?.el.remove();
    this.versePop = null;
  }

  // The line where the reference sits, centred on the reference (it may be far into a long line).
  previewLine(item, n) {
    if (!n.lineText) { item.createDiv({ cls: "pi-line pi-faint", text: "In the note's title" }); return; }
    const line = item.createDiv({ cls: "pi-line" });
    const i = n.lineCol >= 0 && n.lineText.startsWith(n.refText, n.lineCol) ? n.lineCol : n.lineText.indexOf(n.refText);
    if (i >= 0) {
      line.appendText(clip(n.lineText.slice(0, i), 60, true));
      line.createEl("mark", { text: n.refText });
      line.appendText(clip(n.lineText.slice(i + n.refText.length), 80, false));
    } else line.appendText(clip(n.lineText, 140, false));
    if (n.more) line.createSpan({ cls: "pi-more", text: ` (+${n.more} more)` });
  }

  // Click opens at the line; right-click menu; hover preview scrolled to the line.
  wireItem(item, n, file) {
    item.addEventListener("click", () => this.plugin.openResult(n.path, n.line, n.col, n.refText));
    item.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      this.itemMenu(evt, n, file);
    });
    item.addEventListener("mouseover", (event) => {
      this.app.workspace.trigger("hover-link", {
        event, source: VIEW_TYPE, hoverParent: this, targetEl: item,
        linktext: n.path, sourcePath: file.path,
        state: n.line >= 0 ? { scroll: n.line } : undefined,
      });
    });
  }

  // Topics: every topic note reached through any passage this note cites, listed once.
  // Not-yet-linked topics come first; ones the note already links to are tagged "linked".
  // Hidden when there are none.
  renderTopics(el, file, isHidden) {
    const all = this.plugin.index.topicsFor(file.path, (p) => this.plugin.isTopic(p));
    if (!all.length) return;
    const links = this.app.metadataCache.resolvedLinks[file.path] || {};
    const topics = [];
    let nHidden = 0;
    for (const t of all) {
      const via = t.via.filter((v) => !isHidden(v));
      if (!via.length) { nHidden++; continue; }
      topics.push({ ...t, via, linked: !!links[t.path] });
    }
    sortTopics(topics);

    const det = el.createEl("details", { cls: "pi-group pi-topics" + (topics.length ? "" : " is-empty") });
    const remembered = this.openState.get(file.path) || {};
    det.open = remembered["__topics"] ?? false;
    det.addEventListener("toggle", () => {
      const st = this.openState.get(file.path) || {};
      st["__topics"] = det.open;
      this.openState.set(file.path, st);
    });
    const sum = det.createEl("summary");
    setIcon(sum.createSpan({ cls: "pi-chevron" }), "chevron-right");
    sum.createSpan({ cls: "pi-passage", text: "Topics" });
    sum.createSpan({ cls: "pi-count", text: String(topics.length),
      attr: nHidden ? { "aria-label": `${nHidden} hidden` } : {} });
    const list = det.createDiv({ cls: "pi-list" });

    for (const t of topics) {
      const best = t.via[0];
      const n = { ...best, path: t.path };
      const item = list.createDiv({ cls: "pi-item pi-topic-row" + (t.linked ? " is-linked" : "") });
      const top = item.createDiv({ cls: "pi-item-top" });
      top.createSpan({ cls: "pi-name", text: t.path.split("/").pop().replace(/\.md$/, "") });
      const meta = top.createSpan({ cls: "pi-meta" });
      if (t.linked) meta.createSpan({ cls: "pi-tag pi-linked", text: "linked", attr: { "aria-label": "This note already links to it" } });
      const via = item.createDiv({ cls: "pi-via" });
      via.appendText("via ");
      t.via.forEach((v, i) => {
        if (i) via.appendText(" · ");
        via.createSpan({ cls: "pi-via-ref" + (v.isMain ? " is-main" : ""), text: v.passage,
          attr: { "aria-label": `${v.matchLabel}: ${v.refText}` } });
      });
      this.previewLine(item, n);
      this.wireItem(item, n, file);
    }
    if (!topics.length) list.createDiv({ cls: "pi-none", text: "No topics." });
    if (nHidden) {
      const more = list.createDiv({ cls: "pi-none pi-broad",
        text: `${nHidden} topic${nHidden > 1 ? "s" : ""} reached only by chapter mentions or broad matches hidden — show` });
      more.addEventListener("click", () => { this.hideBroad = false; this.render(); });
    }
  }

  // Intertext Register: Uses / Used by / Open, above the passage groups. Hidden when empty.
  renderIntertexts(el, file) {
    const { uses, usedBy, open } = this.plugin.index.intertextsFor(file.path);
    if (!uses.length && !usedBy.length && !open.length) return;
    const det = el.createEl("details", { cls: "pi-group pi-intertexts" });
    const remembered = this.openState.get(file.path) || {};
    det.open = remembered["__intertexts"] ?? false;
    det.addEventListener("toggle", () => {
      const st = this.openState.get(file.path) || {};
      st["__intertexts"] = det.open;
      this.openState.set(file.path, st);
    });
    const sum = det.createEl("summary");
    setIcon(sum.createSpan({ cls: "pi-chevron" }), "chevron-right");
    sum.createSpan({ cls: "pi-passage", text: "Intertexts" });
    sum.createSpan({ cls: "pi-count", text: String(uses.length + usedBy.length + open.length) });
    const list = det.createDiv({ cls: "pi-list" });

    // Uses rows go to the target passage's note (n.home); other rows go to the line in the other note.
    const row = (n, fill) => {
      const item = list.createDiv({ cls: "pi-item pi-it-row" });
      fill(item);
      const go = n.home ? { ...n, path: n.home, line: -1 } : n;
      if (n.home === null) item.setAttr("aria-label", "No note for this passage yet; opens the line in this note");
      item.addEventListener("click", () => this.plugin.openResult(go.path, go.line, go.col, go.refText));
      item.addEventListener("contextmenu", (evt) => { evt.preventDefault(); this.itemMenu(evt, go, file); });
      item.addEventListener("mouseover", (event) => {
        this.app.workspace.trigger("hover-link", {
          event, source: VIEW_TYPE, hoverParent: this, targetEl: item,
          linktext: go.path, sourcePath: file.path, state: go.line >= 0 ? { scroll: go.line } : undefined,
        });
      });
    };
    const relTag = (parent, rel) => parent.createSpan({ cls: `pi-tag pi-rel pi-rel-${rel.replace(/\s+/g, "-")}`, text: rel });
    const extra = (item, n) => {
      const bits = [n.description, n.citation && `(${n.citation})`].filter(Boolean).join(" ");
      if (bits) item.createDiv({ cls: "pi-line", text: clip(bits, 140, false) });
    };

    if (uses.length) {
      list.createDiv({ cls: "pi-it-head", text: "Uses" });
      for (const n of uses) row(n, (item) => {
        const top = item.createDiv({ cls: "pi-item-top" });
        top.createSpan({ cls: "pi-name", text: n.passage });
        relTag(top.createSpan({ cls: "pi-meta" }), n.relation);
        extra(item, n);
      });
    }
    if (usedBy.length) {
      list.createDiv({ cls: "pi-it-head", text: "Used by" });
      for (const n of usedBy) row(n, (item) => {
        const top = item.createDiv({ cls: "pi-item-top" });
        top.createSpan({ cls: "pi-name", text: n.passage });
        const meta = top.createSpan({ cls: "pi-meta" });
        relTag(meta, n.relation);
        if (n.noteName !== n.passage && n.noteName.replace(/(\d)v(\d)/g, "$1:$2") !== n.passage) meta.createSpan({ cls: "pi-folder", text: n.noteName });
        extra(item, n);
      });
    }
    if (open.length) {
      list.createDiv({ cls: "pi-it-head", text: "Open" });
      for (const n of open) row(n, (item) => {
        item.addClass("pi-open");
        const text = n.lineText.replace(/^[-*+]\s+\[ \]\s*/, "").replace(/\s*#intertext\b/gi, "");
        const line = item.createDiv({ cls: "pi-it-task" });
        // Questions read from the start; the matching reference is highlighted if it fits.
        const shown = clip(text, 180, false);
        const i = shown.indexOf(n.refText);
        if (i >= 0) {
          line.appendText("○ " + shown.slice(0, i));
          line.createEl("mark", { text: n.refText });
          line.appendText(shown.slice(i + n.refText.length));
        } else line.appendText("○ " + shown);
        item.createDiv({ cls: "pi-folder", text: n.noteName });
      });
    }
  }

  // Right-click on a passage heading.
  groupMenu(evt, g, det, setAll, file) {
    const menu = new Menu();
    const name = (p) => p.split("/").pop().replace(/\.md$/, "");
    const tfile = (p) => this.app.vault.getAbstractFileByPath(p);

    // Notes whose own main passage is exactly this one (e.g. the verse note or a question note).
    const homes = g.notes.filter((n) => n.about && n.match === "exact").slice(0, 5);
    for (const n of homes) {
      menu.addItem((i) => i.setTitle(`Open “${name(n.path)}”`).setIcon("file-text")
        .onClick(() => this.plugin.openResult(n.path, -1)));
    }
    if (homes.length) menu.addSeparator();
    if (addOpenIn(menu, this.plugin, g.ref)) menu.addSeparator();

    if (this.plugin.index.placesIn(file.path, g.ref).length) {
      menu.addItem((i) => i.setTitle("Show in this note").setIcon("locate").onClick(() => this.plugin.showInNote(file, g)));
    }
    menu.addItem((i) => i.setTitle(`Copy “${g.label}”`).setIcon("copy")
      .onClick(() => this.copy(g.label, "Passage copied")));
    if (g.notes.length) {
      menu.addItem((i) => i.setTitle(`Copy links to these ${g.notes.length} notes`).setIcon("links-coming-in")
        .onClick(() => {
          const links = g.notes.map((n) => tfile(n.path)).filter(Boolean)
            .map((f) => "- " + this.app.fileManager.generateMarkdownLink(f, file.path));
          this.copy(links.join("\n"), `${links.length} links copied`);
        }));
    }
    if (g.notes.length && g.notes.length <= 10) {
      menu.addItem((i) => i.setTitle(`Open all ${g.notes.length} in new tabs`).setIcon("layers")
        .onClick(async () => { for (const n of g.notes) await this.plugin.openResult(n.path, n.line, n.col, n.refText); }));
    }
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Collapse the others").setIcon("chevrons-down-up")
      .onClick(() => { setAll(false, det); det.open = true; }));
    menu.addItem((i) => i.setTitle("Collapse all").setIcon("chevrons-down-up").onClick(() => setAll(false)));
    menu.addItem((i) => i.setTitle("Expand all").setIcon("chevrons-up-down").onClick(() => setAll(true)));
    menu.showAtMouseEvent(evt);
  }

  // Right-click on a result.
  itemMenu(evt, n, file) {
    const f = this.app.vault.getAbstractFileByPath(n.path);
    if (!(f instanceof TFile)) return;
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus")
      .onClick(() => this.plugin.openResult(n.path, n.line, n.col, n.refText, "tab")));
    menu.addItem((i) => i.setTitle("Open to the right").setIcon("separator-vertical")
      .onClick(() => this.plugin.openResult(n.path, n.line, n.col, n.refText, "split")));
    menu.addSeparator();
    if (f.path !== file.path) {
      menu.addItem((i) => i.setTitle("Insert link at cursor").setIcon("link-2")
        .onClick(() => this.insertLink(f, file)));
    }
    menu.addItem((i) => i.setTitle("Copy link").setIcon("link")
      .onClick(() => this.copy(this.app.fileManager.generateMarkdownLink(f, file.path), "Link copied")));
    if (n.lineText) {
      menu.addItem((i) => i.setTitle("Copy this line").setIcon("copy")
        .onClick(() => this.copy(n.lineText, "Line copied")));
    }
    const explorer = this.app.internalPlugins?.getPluginById?.("file-explorer");
    if (explorer?.enabled) {
      menu.addItem((i) => i.setTitle("Reveal in file explorer").setIcon("folder-open")
        .onClick(() => explorer.instance.revealInFolder(f)));
    }
    // Let other plugins (e.g. Hover Editor) add their usual file items.
    this.app.workspace.trigger("file-menu", menu, f, "passage-index", this.leaf);
    menu.showAtMouseEvent(evt);
  }

  // Puts a link to `target` at the cursor in the note the pane is showing (`file`). The editor
  // keeps its cursor and selection while the pane has focus, so this lands where you were
  // typing. Selected text becomes the display text. Follows the vault's link settings. In
  // reading view (no cursor) the link is copied instead. Nothing is written without the click.
  insertLink(target, file) {
    const views = this.app.workspace.getLeavesOfType("markdown").map((l) => l.view)
      .filter((v) => v instanceof MarkdownView && v.file?.path === file.path);
    const recent = this.app.workspace.getMostRecentLeaf?.()?.view;
    const view = views.find((v) => v === recent && v.getMode() === "source")
      || views.find((v) => v.getMode() === "source");
    const sel = view ? view.editor.getSelection() : "";
    const alias = sel && !sel.includes("\n") ? sel : undefined;
    const link = this.app.fileManager.generateMarkdownLink(target, file.path, undefined, alias);
    if (!view) { this.copy(link, "Note is in reading view: link copied"); return; }
    view.editor.replaceSelection(link);
    this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
  }

  async copy(text, msg) {
    await navigator.clipboard.writeText(text);
    new Notice(msg);
  }
}

function hiddenText(nChapter, nBroad) {
  const parts = [];
  if (nChapter) parts.push(`${nChapter} chapter mention${nChapter > 1 ? "s" : ""}`);
  if (nBroad) parts.push(`${nBroad} broad match${nBroad > 1 ? "es" : ""}`);
  return parts.join(", ") + " hidden";
}

function clip(s, n, fromStart) {
  s = s.replace(/\s+/g, " ");
  if (s.length <= n) return s;
  return fromStart ? "…" + s.slice(s.length - n) : s.slice(0, n) + "…";
}

// "Bring in the Bible": a step-by-step window that writes a whole translation into the vault.
// Steps: translation → layout → options → review (download, plan, name check) → create.
class BibleWizard extends Modal {
  constructor(app, plugin, onDone) {
    super(app);
    this.plugin = plugin;
    this.onDone = onDone;
    const bibles = plugin.settings.bibles || [];
    this.hasMain = bibles.some((b) => b.options?.main);
    this.state = { step: 0, id: "BSB", options: { ...WIZARD_DEFAULTS, main: !this.hasMain } };
  }

  onOpen() {
    this.plugin.openWizard = this;
    this.modalEl.addClass("pi-wizard");
    this.titleEl.setText("Bring in the Bible");
    this.draw();
  }
  onClose() {
    this.stop = true;
    if (this.plugin.openWizard === this) this.plugin.openWizard = null;
    this.contentEl.empty();
  }

  draw() {
    const el = this.contentEl;
    el.empty();
    const steps = ["Translation", "Layout", "Options", "Review"];
    const st = this.state;
    const bar = el.createDiv({ cls: "pi-wizard-steps" });
    steps.forEach((name, i) => bar.createSpan({ cls: "pi-wizard-step" + (i === st.step ? " is-active" : i < st.step ? " is-done" : ""), text: `${i + 1}. ${name}` }));
    const body = el.createDiv({ cls: "pi-wizard-body" });
    [() => this.stepTranslation(body), () => this.stepLayout(body), () => this.stepOptions(body), () => this.stepReview(body)][st.step]();
  }

  footer(body, { back = true, next = "Next", onNext } = {}) {
    const f = new Setting(body).setClass("pi-wizard-footer");
    if (back && this.state.step > 0) f.addButton((b) => b.setButtonText("Back").onClick(() => { this.state.step--; this.draw(); }));
    if (next) f.addButton((b) => b.setButtonText(next).setCta().onClick(onNext || (() => { this.state.step++; this.draw(); })));
    return f;
  }

  example() {
    const { options: o, id } = this.state;
    const short = translationInfo(id).short;
    const root = (o.root || "Bible").replace(/^\/+|\/+$/g, "") || "Bible";
    return `${root}/${short}/${o.numbered ? "66. " : ""}Revelation/Revelation 1${o.main ? "" : ` (${short})`}.md`;
  }

  stepTranslation(body) {
    const st = this.state;
    body.createEl("p", { text: "Write a whole translation into your vault as notes: one note per chapter, each verse a small heading you can link to, like [[Revelation 1#12]]. It's optional, and Settings → Bible can remove it again." });
    const known = TRANSLATIONS.some((t) => t.id === st.id);
    new Setting(body).setName("Translation").addDropdown((d) => {
      fillTranslationSelect(d.selectEl, () => false, st.id);
      d.onChange((v) => { st.id = v === "__other" ? "" : v; this.draw(); });
    });
    if (!known) {
      new Setting(body).setName("Translation id").setDesc("Any id from bible.helloao.org's list of translations, e.g. eng_kjv.")
        .addText((t) => t.setPlaceholder("eng_kjv").setValue(st.id).onChange((v) => { st.id = v.trim(); }));
    }
    const info = translationInfo(st.id);
    if (st.id) {
      const d = body.createDiv({ cls: "setting-item-description pi-wizard-note" });
      d.appendText(`${info.name}. ${LICENSES[info.license]} `);
      if (info.url) d.createEl("a", { text: "Terms", href: info.url });
      d.createEl("br");
      d.appendText("Downloads about 4–9 MB from bible.helloao.org when you reach the last step.");
      const already = (this.plugin.settings.bibles || []).find((b) => b.id === st.id);
      if (already) {
        d.createEl("br");
        d.createSpan({ cls: "mod-warning", text: `Already in your vault at ${already.base}. Continuing regenerates it, replacing those notes.` });
      }
    }
    this.footer(body, { onNext: () => {
      if (!VALID_ID.test(st.id || "")) { new Notice("Choose a translation, or enter a valid id."); return; }
      // Regenerating keeps the earlier layout unless changed.
      const already = (this.plugin.settings.bibles || []).find((b) => b.id === st.id);
      if (already?.options) st.options = { ...WIZARD_DEFAULTS, ...already.options };
      st.step++;
      this.draw();
    } });
  }

  stepLayout(body) {
    const { options: o } = this.state;
    const ex = body.createDiv({ cls: "pi-wizard-example" });
    const showEx = () => ex.setText(`Example: ${this.example()}`);
    new Setting(body).setName("Folder").setDesc("Top folder for Bibles in your vault. Each translation gets its own folder inside it.")
      .addText((t) => t.setPlaceholder("Bible").setValue(o.root).onChange((v) => { o.root = v.trim() || "Bible"; showEx(); }));
    const otherMain = (this.plugin.settings.bibles || []).find((b) => b.options?.main && b.id !== this.state.id);
    new Setting(body).setName("Main translation")
      .setDesc(otherMain
        ? `Your main Bible is the ${otherMain.short}, so this one gets its name added: Revelation 1 (${translationInfo(this.state.id).short}). Remove the ${otherMain.short} first to change that.`
        : "Gets plain names (Revelation 1), so [[Revelation 1]] means this Bible. Turn off to add the translation to every name, e.g. Revelation 1 (KJV).")
      .addToggle((t) => { t.setValue(o.main && !otherMain).setDisabled(!!otherMain).onChange((v) => { o.main = v; showEx(); }); if (otherMain) o.main = false; });
    new Setting(body).setName("Number the book folders").setDesc("Adds 01.–66. to the book folders (66. Revelation) so the file explorer lists books in Bible order instead of A–Z. Links aren't affected. Leave off if you use the Local Bible Ref plugin, which expects plain folder names.")
      .addToggle((t) => t.setValue(o.numbered).onChange((v) => { o.numbered = v; showEx(); }));
    body.appendChild(ex);
    showEx();
    this.footer(body);
  }

  stepOptions(body) {
    const { options: o } = this.state;
    const toggle = (key, name, desc) => new Setting(body).setName(name).setDesc(desc).addToggle((t) => t.setValue(o[key]).onChange((v) => { o[key] = v; }));
    toggle("sections", "Section headings", "Headings like \"The Seven Golden Lampstands\", where the translation has them. If you use the Bible Linker plugin, set its verse heading level to 6 and verse offset to −1.");
    toggle("footnotes", "Translation footnotes", "Notes such as \"Or suddenly\" or \"Hebrew …\", as footnotes at the end of each chapter.");
    toggle("nav", "Previous and next links", "A line like ← Jude 1 | Revelation | Revelation 2 → above and below the text.");
    toggle("index", "Book and Bible index notes", "A note per book listing its chapters, and one note listing all the books.");
    toggle("aliases", "Short-name aliases", "\"Rev 1\" and \"Psalm 23\", so typing [[Rev 1 finds the chapter.");
    toggle("breadcrumbs", "Breadcrumbs properties", "up, previous and next in each note's properties, for the Breadcrumbs plugin.");
    this.footer(body);
  }

  async stepReview(body) {
    const st = this.state;
    const info = translationInfo(st.id);
    const status = body.createDiv({ cls: "pi-wizard-status", text: `Downloading the ${info.short}…` });
    let plan;
    try {
      // Download once per translation; the plan is redone if options changed.
      if (st.completeId !== st.id) { st.complete = await this.plugin.fetchComplete(st.id); st.completeId = st.id; }
      plan = planBible(st.complete, st.options, info.short, TRANSLATIONS.some((t) => t.id === st.id) ? info.name : undefined);
    } catch (e) {
      status.setText(`Couldn't download the ${info.short}. ${e.message || ""}`);
      this.footer(body, { next: null });
      return;
    }
    if (this.state.step !== 3 || !body.isConnected) return; // moved on while downloading
    status.empty();
    const mb = (plan.files.reduce((n, f) => n + f.content.length, 0) / 1e6).toFixed(1);
    const nBooks = st.options.index ? plan.books : 0;
    status.createEl("p", { text: `Creates ${plan.files.length.toLocaleString()} notes in ${plan.base}: ${plan.chapters.toLocaleString()} chapters` +
      (nBooks ? `, ${nBooks} book notes and an index note (${plan.trName})` : "") + `, about ${mb} MB.` });
    status.createEl("p", { cls: "setting-item-description", text: `Passage Index will skip ${plan.base} (it's added to the excluded folders), so the Bible doesn't fill the pane.` });
    const conflicts = this.plugin.nameConflicts(plan);
    if (conflicts.length) {
      const w = status.createDiv({ cls: "pi-wizard-warning" });
      w.createEl("p", { text: `${conflicts.length} note${conflicts.length > 1 ? "s" : ""} elsewhere in your vault already ${conflicts.length > 1 ? "use these names" : "uses one of these names"}, so links like [[${conflicts[0].split("/").pop().replace(/\.md$/, "")}]] could point to either:` });
      const ul = w.createEl("ul");
      for (const c of conflicts.slice(0, 6)) ul.createEl("li", { text: c });
      if (conflicts.length > 6) ul.createEl("li", { text: `…and ${conflicts.length - 6} more` });
      if (st.options.main) w.createEl("p", { text: "To avoid this, go back and turn off \"Main translation\": every name then gets the translation added." });
    }
    const progress = body.createDiv({ cls: "pi-wizard-progress" });
    this.footer(body, { next: "Create", onNext: () => this.create(plan, progress, body) });
  }

  async create(plan, progress, body) {
    const st = this.state;
    const info = translationInfo(st.id);
    body.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    progress.empty();
    const bar = progress.createEl("progress", { attr: { max: String(plan.files.length), value: "0" } });
    const text = progress.createDiv({ text: "Starting…" });
    this.stop = false;
    const cancel = progress.createEl("button", { text: "Stop" });
    cancel.addEventListener("click", () => { this.stop = true; cancel.disabled = true; });
    const entry = { id: st.id, short: info.short, name: plan.trName, base: plan.base, chapters: plan.chapters,
      options: { ...st.options }, created: localDate() };
    let n = 0;
    try {
      n = await this.plugin.writeBible(plan, entry, (d, t) => { bar.value = d; text.setText(`${d.toLocaleString()} of ${t.toLocaleString()} notes`); }, () => this.stop);
    } catch (e) {
      console.error("Passage Index: Bible wizard failed:", e);
      text.setText(`Something went wrong after ${n} notes: ${e.message || e}`);
      return;
    }
    cancel.remove();
    const done = n === plan.files.length;
    text.setText(done ? `Done: ${n.toLocaleString()} notes in ${plan.base}.` : `Stopped after ${n.toLocaleString()} notes. Run the wizard again to finish (it replaces what's there).`);
    this.onDone?.();
    new Setting(progress)
      .addButton((b) => b.setButtonText("Close").onClick(() => this.close()))
      .addButton((b) => {
        b.setButtonText(plan.indexPath ? "Open the index" : "Open Revelation 1").setCta().onClick(async () => {
          const target = plan.indexPath || plan.files.find((f) => / 1( \(|\.md)/.test(f.path) && f.path.includes("/Revelation"))?.path;
          const file = target && this.app.vault.getAbstractFileByPath(normalizePath(target));
          if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
          this.close();
        });
        if (!done) b.setDisabled(true);
      });
  }
}

class PassageIndexSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.tab = "index"; }

  // Tabs across the top; each draws its own section. The open tab is remembered while
  // Obsidian runs (the pop-up's "+" opens the Verse pop-up tab).
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const tabs = [
      ["index", "Index", (el) => this.displayIndex(el)],
      ["pane", "Pane", (el) => this.displayPane(el)],
      ["topics", "Topics", (el) => this.displayTopics(el)],
      ["verse", "Verse pop-up", (el) => this.displayVerse(el)],
      ["bible", "Bible", (el) => this.displayBible(el)],
      ["openin", "Open in", (el) => this.displayOpenIn(el)],
    ];
    if (!tabs.some(([id]) => id === this.tab)) this.tab = "index";
    const bar = containerEl.createDiv({ cls: "pi-settings-tabs", attr: { role: "tablist" } });
    for (const [id, name] of tabs) {
      const b = bar.createEl("button", { cls: "pi-settings-tab" + (id === this.tab ? " is-active" : ""), text: name,
        attr: { role: "tab", "aria-selected": String(id === this.tab) } });
      b.addEventListener("click", () => { this.tab = id; this.display(); });
    }
    tabs.find(([id]) => id === this.tab)[2](containerEl.createDiv({ cls: "pi-settings-body" }));
  }

  // Closing settings after changing what gets indexed rebuilds the index, with a notice.
  hide() {
    super.hide?.();
    if (!this.needsRebuild) return;
    this.needsRebuild = false;
    const notice = new Notice("Passage Index: settings changed, re-reading your notes…", 0);
    this.plugin.buildIndex().then(() => {
      notice.setMessage(`Passage Index: index rebuilt (${this.plugin.lastBuild || "done"}).`);
      window.setTimeout(() => notice.hide(), 4000);
    });
  }

  // What gets indexed, and how references are read. Changes here take effect when settings
  // close (hide() rebuilds).
  displayIndex(el) {
    const changed = () => { this.needsRebuild = true; };
    el.createDiv({ cls: "setting-item-description pi-settings-intro",
      text: "Changes on this tab take effect when you close settings: Passage Index re-reads your notes then, and tells you when it's done." });
    new Setting(el)
      .setName("Excluded folders")
      .setDesc("One folder per line; folders inside them are excluded too. Notes here are never indexed. Bibles you add from the Bible tab are listed here for you. If you keep Bible text from somewhere else (another plugin, an imported Bible), add its folder, or every verse in it will crowd the pane.")
      .addTextArea((t) => {
        t.setValue(this.plugin.settings.excludedFolders.join("\n"));
        t.inputEl.rows = 6;
        t.onChange(async (v) => {
          this.plugin.settings.excludedFolders = v.split("\n").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          changed();
        });
      });
    new Setting(el)
      .setName("Not references")
      .setDesc("One phrase per line. Text that looks like a passage but isn't one, such as the title of a book you cite: for Mathews, Genesis 1–11:26, add \"Genesis 1–11:26\". Hyphens and dashes match each other; case is ignored.")
      .addTextArea((t) => {
        t.setValue((this.plugin.settings.ignorePhrases || []).join("\n"));
        t.inputEl.rows = 4;
        t.onChange(async (v) => {
          this.plugin.settings.ignorePhrases = v.split("\n").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          changed();
        });
      });
    new Setting(el)
      .setName("Ignore property")
      .setDesc("Frontmatter property listing references a note cites only in passing, e.g. pi-ignore: [Acts 11:28, Acts 25:27]. The note gets no group for them, and it won't appear under them in other notes. A chapter (Acts 11) covers all its verses. Tip: right-click a reference in a note to add it.")
      .addText((t) => t.setPlaceholder("pi-ignore").setValue(this.plugin.settings.ignoreProperty || "")
        .onChange(async (v) => { this.plugin.settings.ignoreProperty = v.trim(); await this.plugin.saveSettings(); changed(); }));
    new Setting(el)
      .setName("Rebuild index")
      .setDesc("Re-read every note now. You rarely need this: notes are re-read as you edit them, and settings changes rebuild on their own. Use it if the pane ever looks out of date.")
      .addButton((b) => b.setButtonText("Rebuild").onClick(async () => {
        b.setDisabled(true).setButtonText("Rebuilding…");
        this.needsRebuild = false;
        await this.plugin.buildIndex();
        b.setDisabled(false).setButtonText("Rebuild");
        new Notice(`Passage Index: index rebuilt (${this.plugin.lastBuild || "done"}).`);
      }));
  }

  // What the pane shows, and opening results.
  displayPane(el) {
    const sec = new Setting(el)
      .setName("Group passages by section (pericopes)")
      .setDesc("Each translation divides the text into its own sections (pericopes), each with a heading such as \"The Triumphal Entry\". Turn this on to group the pane's passages under those headings. Only three translations offer their headings for free use: BSB, LEB and TCENT (New Testament only). You can pick any of them, whatever translation you read. The one you pick must be downloaded first, in the Verse pop-up tab; you don't have to use it in the pop-up.");
    sec.addDropdown(async (d) => {
      const s = this.plugin.settings;
      d.addOption("", "Off");
      const ids = await this.plugin.downloadedBibles();
      for (const t of TRANSLATIONS.filter((x) => x.sections)) {
        d.addOption(t.id, `${t.short} — ${t.name}${ids.includes(t.id) ? "" : " (not downloaded)"}`);
      }
      if (s.sectionsFrom && !TRANSLATIONS.some((x) => x.sections && x.id === s.sectionsFrom)) d.addOption(s.sectionsFrom, `${translationInfo(s.sectionsFrom).short} (no usable headings)`);
      d.setValue(s.sectionsFrom || "");
      d.onChange(async (v) => { s.sectionsFrom = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); });
    });
    // The chapter-only toggle only works with broad hiding on (the pane hides both or neither),
    // so it and the slider show only then.
    const s = this.plugin.settings;
    const redraw = () => { el.empty(); this.displayPane(el); };
    new Setting(el)
      .setName("Hide broad matches")
      .setDesc("Hide notes that only cite a wide passage around this one (e.g. Mark 1–8 when you're on Mark 4:3). To see hidden notes, click the filter button at the top of the pane; that shows them only until you click it again, and doesn't change this setting.")
      .addToggle((t) => t.setValue(s.hideBroad)
        .onChange(async (v) => { s.hideBroad = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); redraw(); }));
    if (s.hideBroad) {
      new Setting(el)
        .setName("Broad means more than … chapters")
        .setDesc("A passage wider than this many chapters counts as broad. Default: 2.")
        .addSlider((x) => x.setLimits(1, 10, 1).setValue(s.broadChapters).setDynamicTooltip()
          .onChange(async (v) => { s.broadChapters = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
      new Setting(el)
        .setName("Hide chapter-only mentions")
        .setDesc("Hide notes that mention only the chapter, with no verse (e.g. Matt 24 when you're on Matt 24:3). The filter button shows these too.")
        .addToggle((t) => t.setValue(s.hideChapter)
          .onChange(async (v) => { s.hideChapter = v; await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    }
    new Setting(el)
      .setName("Highlight duration")
      .setDesc("Seconds the reference stays highlighted after opening a result.")
      .addSlider((s) => s.setLimits(1, 10, 1).setValue(this.plugin.settings.flashSeconds).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.flashSeconds = v; await this.plugin.saveSettings(); }));
    // Hover previews of results and topics use Obsidian's Page preview, which decides whether
    // Ctrl is needed. Point there rather than duplicating the setting.
    new Setting(el)
      .setName("Hover previews")
      .setDesc("Point at a note in the pane to see a preview of it. No key is needed. If you'd rather hold Ctrl (Cmd on a Mac) first, click the button and turn on Passage Index in Page preview.")
      .addButton((b) => b.setButtonText("Open Page preview settings").onClick(() => {
        const pp = this.app.internalPlugins?.getPluginById?.("page-preview");
        if (!pp?.enabled) { new Notice("Page preview is turned off under Core plugins."); return; }
        this.app.setting?.openTabById?.("page-preview");
      }));
  }

  // Bible wizard: open it, and manage the Bibles it has written (open, regenerate, remove).
  displayBible(el) {
    el.empty();
    const redraw = () => this.displayBible(el);
    new Setting(el)
      .setName("Bring in the Bible")
      .setDesc("Optional. Writes a whole translation into your vault as notes: one per chapter, each verse a small heading you can link to ([[Revelation 1#12]]). The format works with the Bible Linker and Local Bible Ref plugins.")
      .addButton((b) => b.setButtonText("Open the wizard…").setCta().onClick(() => new BibleWizard(this.app, this.plugin, redraw).open()));
    new Setting(el)
      .setName("Verse numbers")
      .setDesc("How verse numbers look in Bible chapter notes. Links like [[Genesis 1#3]] work with every choice. \"As headings\" leaves them to your theme.")
      .addDropdown((d) => d
        .addOption("margin", "In the margin")
        .addOption("inline", "At verse start")
        .addOption("heading", "As headings")
        .setValue(this.plugin.settings.verseNumbers || "margin")
        .onChange(async (v) => { this.plugin.settings.verseNumbers = v; await this.plugin.saveSettings(); this.plugin.applyVerseStyle();
          this.plugin.verseExt.length = 0; this.plugin.verseExt.push(verseNumberExtension(this.plugin)); this.app.workspace.updateOptions(); }));
    new Setting(el)
      .setName("Open Bible chapters in reading view")
      .setDesc("Chapter, book and index notes open ready to read. You can still switch to editing; it stays that way until you open another chapter.")
      .addToggle((t) => t.setValue(this.plugin.settings.bibleReadingView)
        .onChange(async (v) => { this.plugin.settings.bibleReadingView = v; await this.plugin.saveSettings(); }));
    new Setting(el)
      .setName("Keep Bibles out of search")
      .setDesc("Adds each Bible's folder to Obsidian's Excluded files (Settings → Files and links), so searching for a reference finds your notes, not every verse. Excluded notes are also left out of the graph and shown lower in the quick switcher and link suggestions; links to them still work. Turning this off removes only the folders Passage Index added.")
      .addToggle((t) => t.setValue(this.plugin.settings.hideBiblesFromSearch)
        .onChange(async (v) => { this.plugin.settings.hideBiblesFromSearch = v; await this.plugin.syncSearchExclusions(); }));

    const bibles = this.plugin.settings.bibles || [];
    if (!bibles.length) {
      el.createDiv({ cls: "setting-item-description pi-settings-empty", text: "No Bible in this vault yet." });
      return;
    }
    new Setting(el).setName("In this vault").setHeading();
    // Two-click confirm for actions that replace or remove notes.
    const confirmButton = (b, label, confirmLabel, action) => {
      let armed = false;
      b.setButtonText(label).onClick(async () => {
        if (!armed) {
          armed = true;
          b.setButtonText(confirmLabel).setWarning();
          window.setTimeout(() => { if (armed) { armed = false; b.setButtonText(label); b.buttonEl.removeClass("mod-warning"); } }, 4000);
          return;
        }
        armed = false;
        b.setDisabled(true);
        await action();
        redraw();
      });
    };
    for (const entry of bibles) {
      const folder = this.app.vault.getAbstractFileByPath(normalizePath(entry.base));
      new Setting(el)
        .setName(`${entry.short}: ${entry.name}${entry.options?.main ? " (main)" : ""}`)
        .setDesc(folder ? `${entry.base} · ${entry.chapters} chapters · made ${entry.created}` : `${entry.base} is missing (moved or deleted?).`)
        .addButton((b) => b.setButtonText("Open").onClick(async () => {
          const idx = (this.app.vault.getAbstractFileByPath(normalizePath(entry.base)) instanceof TFolder)
            && this.app.vault.getMarkdownFiles().find((f) => f.path.startsWith(entry.base + "/") && f.parent?.path === entry.base);
          if (idx) await this.app.workspace.getLeaf("tab").openFile(idx);
          else new Notice(`Passage Index: no index note in ${entry.base}.`);
        }))
        .addButton((b) => confirmButton(b, "Regenerate", `Yes, regenerate the ${entry.short}`, () => this.plugin.regenerateBible(entry)))
        .addButton((b) => confirmButton(b, "Remove", `Yes, remove the ${entry.short}`, () => this.plugin.removeBible(entry)));
    }
    el.createDiv({ cls: "setting-item-description", text: "Regenerate downloads the translation again and rewrites its notes, replacing anything you've written in them. Remove moves the translation's folder to the trash." });
  }

  // Which notes count as topics (read live; no rebuild needed).
  displayTopics(el) {
    new Setting(el)
      .setName("Topic property")
      .setDesc("Frontmatter property that marks a topic note, e.g. type (type: topic) or tags (tags: [topic]). Leave empty to use folders only.")
      .addText((t) => t.setPlaceholder("type").setValue(this.plugin.settings.topicProperty || "")
        .onChange(async (v) => { this.plugin.settings.topicProperty = v.trim(); await this.plugin.saveSettings(); this.plugin.refreshViews(); }));
    new Setting(el)
      .setName("Topic values")
      .setDesc("Values of that property that mean \"topic\", separated by commas (e.g. topic, concept, theme). Case is ignored.")
      .addText((t) => t.setPlaceholder("topic").setValue((this.plugin.settings.topicValues || []).join(", "))
        .onChange(async (v) => {
          this.plugin.settings.topicValues = v.split(",").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));
    new Setting(el)
      .setName("Topic folders")
      .setDesc("One folder per line. Every note in these folders also counts as a topic.")
      .addTextArea((t) => {
        t.setValue((this.plugin.settings.topicFolders || []).join("\n"));
        t.inputEl.rows = 3;
        t.onChange(async (v) => {
          this.plugin.settings.topicFolders = v.split("\n").map((s) => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });
  }

  // Verse pop-up: on/off, closing, translation, and downloads. Drawn in its own container so
  // it can redraw itself (after a download or delete) without redrawing the whole tab.
  // "Open in…": which outside tools appear when you right-click a passage heading or use the
  // pop-up's button, and an optional version for each.
  displayOpenIn(el) {
    const s = this.plugin.settings;
    s.openIn = Object.assign({}, DEFAULTS.openIn, s.openIn);
    s.openInVersion = Object.assign({}, s.openInVersion);
    el.createDiv({ cls: "setting-item-description pi-settings-intro",
      text: "Right-click a passage heading in the pane, or click the arrow in the verse pop-up, to open the passage in one of these. Logos opens the app if it's installed, otherwise the Logos website." });
    const hints = { logos: "e.g. esv, niv, nasb95 (blank = your Logos default)", biblegateway: "e.g. NIV, ESV (blank = its default)",
      blb: "e.g. KJV, ESV (blank = its default)", step: "e.g. ESV, NIV (blank = its default)" };
    for (const t of OPEN_IN) {
      new Setting(el).setName(t.name).setDesc(`Version: ${hints[t.id]}`)
        .addText((x) => x.setPlaceholder("default").setValue(s.openInVersion[t.id] || "")
          .onChange(async (v) => { s.openInVersion[t.id] = v.trim(); await this.plugin.saveSettings(); }))
        .addToggle((x) => x.setValue(!!s.openIn[t.id])
          .onChange(async (v) => { s.openIn[t.id] = v; await this.plugin.saveSettings(); }));
    }
  }

  async displayVerse(el) {
    el.empty();
    const s = this.plugin.settings;
    const save = () => this.plugin.saveSettings();
    new Setting(el)
      .setName("Show the verse pop-up")
      .setDesc("Hold Ctrl (Cmd on a Mac) and hover a passage in the pane to read its text.")
      .addToggle((t) => t.setValue(s.versePopup).onChange(async (v) => { s.versePopup = v; await save(); }));
    new Setting(el)
      .setName("Close when Ctrl is released")
      .setDesc("Off: the pop-up stays until the pointer moves away, so you can let go of Ctrl and keep reading.")
      .addToggle((t) => t.setValue(s.closeOnCtrlRelease).onChange(async (v) => { s.closeOnCtrlRelease = v; await save(); }));

    const downloaded = await this.plugin.downloadedBibles();
    const has = (id) => downloaded.includes(id);
    const known = TRANSLATIONS.some((t) => t.id === s.bibleTranslation);
    // These copies and the wizard's Bible notes are different things; say so.
    el.createDiv({ cls: "setting-item-description pi-settings-intro",
      text: "Translations here are small hidden copies used only by the pop-up (kept in the plugin folder, not as notes). To put a whole Bible into your vault as notes, use the Bible tab." });
    const info = translationInfo(s.bibleTranslation);

    // Translation: grouped list, "✓" marks downloaded ones; "Other" takes any API id.
    new Setting(el)
      .setName("Pop-up translation")
      .setDesc("The translation the verse pop-up shows. Pick one from the list to download it; the ones you already have are marked ✓ and listed below. In the pop-up itself, its tabs switch between them.")
      .addDropdown((d) => {
        fillTranslationSelect(d.selectEl, has, s.bibleTranslation);
        d.onChange(async (v) => {
          if (v === "__other") { s.bibleTranslation = ""; } else s.bibleTranslation = v;
          await save();
          this.displayVerse(el);
        });
      });

    if (!known) {
      new Setting(el)
        .setName("Translation id")
        .setDesc(createFragment((f) => {
          f.appendText("Any id from the Free Use Bible API's ");
          f.createEl("a", { text: "list of translations", href: "https://bible.helloao.org/api/available_translations.json" });
          f.appendText(" (e.g. eng_kjv, or another language). Letters, digits, - and _ only.");
        }))
        .addText((t) => t.setPlaceholder("eng_kjv").setValue(s.bibleTranslation).onChange(async (v) => {
          s.bibleTranslation = v.trim();
          await save();
        }));
    }

    // The chosen translation: license and status. Download only when it isn't there yet;
    // once downloaded, a small refresh icon (rarely needed) and Delete.
    const id = s.bibleTranslation;
    if (id) {
      const status = new Setting(el)
        .setName(has(id) ? `${info.short}: ready for the pop-up` : `${info.short}: not downloaded`)
        .setDesc(createFragment((f) => {
          f.appendText(LICENSES[info.license] + " ");
          if (info.url) f.createEl("a", { text: "Terms", href: info.url });
          if (!has(id)) {
            f.createEl("br");
            f.appendText("Downloads from bible.helloao.org (about 4–9 MB). Passage Index goes online only when you click Download.");
          }
        }));
      if (!has(id)) {
        status.addButton((b) => b.setButtonText("Download").setCta().onClick(async () => {
          b.setDisabled(true).setButtonText("Downloading…");
          await this.plugin.downloadBible(id);
          this.displayVerse(el);
        }));
      } else {
        status.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip(`Download a fresh copy of the ${info.short} (only needed if the source is updated)`)
          .onClick(async () => { b.setDisabled(true); await this.plugin.downloadBible(id); this.displayVerse(el); }));
        status.addExtraButton((b) => b.setIcon("trash").setTooltip(`Delete the ${info.short}`)
          .onClick(async () => { await this.plugin.deleteBible(id); this.displayVerse(el); }));
      }
    }

    // The other downloaded translations, one row each with Delete.
    for (const d of downloaded.filter((x) => x !== id)) {
      const t = translationInfo(d);
      new Setting(el).setName(`${t.short}: ready for the pop-up`).setDesc(`${t.name}. Switch to it with the tabs in the pop-up, or the list above.`)
        .addExtraButton((b) => b.setIcon("refresh-cw").setTooltip(`Download a fresh copy of the ${t.short}`)
          .onClick(async () => { b.setDisabled(true); await this.plugin.downloadBible(d); this.displayVerse(el); }))
        .addExtraButton((b) => b.setIcon("trash").setTooltip(`Delete the ${t.short}`)
          .onClick(async () => { await this.plugin.deleteBible(d); this.displayVerse(el); }));
    }
  }
}

module.exports = PassageIndexPlugin;
