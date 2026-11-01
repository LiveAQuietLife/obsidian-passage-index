// Build: bundle src/*.js into one main.js with esbuild (Obsidian loads a single file).
// Needs: npm install (once).
// Run: node build.js <version>     e.g. node build.js 0.0.1
// Output: dist/main.js, manifest.json, styles.css (upload these to the GitHub release);
// also updates manifest.json at the repo root.
const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error("Usage: node build.js <x.y.z>"); process.exit(1); }

const SRC = path.join(__dirname, "src");
// src/ is ES modules; esbuild bundles them into one CommonJS file. Obsidian supplies
// "obsidian" and "@codemirror/*" at runtime, so they stay as require() calls.
const result = require("esbuild").buildSync({
  entryPoints: [path.join(SRC, "main.js")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  banner: { js: `/* Passage Index ${version} — built ${new Date().toISOString().slice(0, 10)}. Source: src/ */` },
  write: false,
  logLevel: "warning",
});
const out = result.outputFiles[0].text;

const manifest = {
  id: "passage-index",
  name: "Passage Index",
  version,
  minAppVersion: "1.5.0",
  description: "A side pane that follows your reading and shows every note touching the passages in the current note.",
  author: "LiveAQuietLife",
  isDesktopOnly: true,
};

const dir = path.join(__dirname, "dist");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "main.js"), out);
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.copyFileSync(path.join(SRC, "styles.css"), path.join(dir, "styles.css"));
fs.writeFileSync(path.join(__dirname, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// Sanity checks: the bundle parses, and the CSS comments balance.
new Function("require", "module", "exports", out);
const css = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
const opens = (css.match(/\/\*/g) || []).length, closes = (css.match(/\*\//g) || []).length;
if (opens !== closes) { console.error(`styles.css: ${opens} "/*" vs ${closes} "*/"`); process.exit(1); }
console.log(`Built ${version}: main.js ${out.length} bytes; CSS comments balanced (${opens}).`);
