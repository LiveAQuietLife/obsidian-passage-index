// Build: combine src/*.js into one main.js (Obsidian loads a single file).
// Run: node build.js <version>     e.g. node build.js 0.0.1
// Output: dist/main.js, manifest.json, styles.css (upload these to the GitHub release);
// also updates manifest.json at the repo root.
const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error("Usage: node build.js <x.y.z>"); process.exit(1); }

const SRC = path.join(__dirname, "src");
const modules = ["books", "reader", "passage-index", "coverage", "bible", "wizard", "main"];
let out = `/* Passage Index ${version} — built ${new Date().toISOString().slice(0, 10)}. Source: src/ */\n"use strict";\n`;
out += "const __mods = {};\nconst __cache = {};\n";
out += `function __req(name) {
  if (name === "obsidian" || name.startsWith("@codemirror/")) return require(name);
  const key = name.replace(/^\\.\\//, "");
  if (__cache[key]) return __cache[key].exports;
  const module = (__cache[key] = { exports: {} });
  __mods[key](module, module.exports, __req);
  return module.exports;
}\n`;
for (const m of modules) {
  const code = fs.readFileSync(path.join(SRC, m + ".js"), "utf8");
  out += `\n__mods[${JSON.stringify(m)}] = function (module, exports, require) {\n${code}\n};\n`;
}
out += `\nmodule.exports = __req("main");\n`;

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
