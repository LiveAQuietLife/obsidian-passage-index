# Contributing to Passage Index

Thanks for taking a look. Passage Index is a niche plugin: it grew out of the way I study the Bible in Obsidian, with a note per passage, topic notes, notes on scholars and plenty of cross-references. I don't assume everyone works that way, so if your setup is different and the plugin doesn't fit it, I'd like to hear about it.

## Suggestions and questions

Open an [issue](https://github.com/LiveAQuietLife/obsidian-passage-index/issues). It helps to say:

- what you were trying to do, and how your notes are set up (folders, filenames, properties);
- what Passage Index did, and what you expected instead.

Ideas that come from a different way of studying are especially welcome. I read every one, though I can't promise to reply to each or to build everything.

## Bugs

Please include:

- your Passage Index version (Settings → Community plugins) and Obsidian version;
- the exact text involved, if it's about reading references: the line from your note, or the note's filename. For example, "`Rom 8:28, 30` is read as Romans 8:28 only".
- any errors in the developer console (Ctrl+Shift+I, then the Console tab).

Leave out anything private. A made-up note that shows the problem is just as good.

## Pull requests

Please open an issue first, so we can agree on the change before you spend time on it. Then:

- Keep each pull request to one change.
- Add or update a test when you change how references are read (`test/reader.test.js`) or how notes are matched.
- Make sure the tests pass.

### Building and testing

You need Node.js 22.12 or later (the tests load the ES-module source directly).

```bash
npm install
node build.js 0.0.0          # writes dist/main.js, manifest.json and styles.css
node test/reader.test.js     # each test file runs on its own
```

The tests are `test/*.test.js`. `bible.test.js` needs a downloaded translation (`bibles/BSB.json`), which isn't in the repo, so skip it if you don't have one.

To try a build, copy the three files in `dist/` into your vault's `.obsidian/plugins/passage-index/` folder and reload the plugin. Use a test vault rather than the one you study in.

## License

Contributions are released under the [MIT License](LICENSE), the same as the plugin.
