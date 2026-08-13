# adminv2 design source

Provenance for the Simulator Studio shell built at
[artifacts/admin-panel/src/adminv2/](../../artifacts/admin-panel/src/adminv2/).

Source: Claude Design project **M365 Admin Panel Framework**,
`6fa4614a-4819-46db-989d-bb89ea01d84e`
(<https://claude.ai/design/p/6fa4614a-4819-46db-989d-bb89ea01d84e>).

Note this is a *different* project from the `Design/_ds/` design system
(`25314893-05d9-45d6-bcae-ad11c1b78a39`), which it links for fonts and spacing
but deliberately overrides for colour — the design system is navy/blue, this
shell is neutral grey.

| file | what |
|---|---|
| `handoff.md` | The reasoning. Read this first. |
| `Admin Shell.dc.html` | The clickable specification. Complete. |
| `Admin Shell v1 (endpoints experiment).dc.html` | The superseded first pass. |

## Reading `Admin Shell.dc.html`

It is a **bundled export**: the outer file is a loader, and the real document is
a JSON-escaped string on the last long line. It is 1.6 MB on disk and 1.12 MB /
13,748 lines once unwrapped, so `grep` on the raw file will not behave. Unwrap
it first:

```js
const lines = fs.readFileSync("Admin Shell.dc.html", "utf8").split(/\r?\n/);
const raw = lines[409];                       // the one very long line
const html = JSON.parse(raw.slice(raw.indexOf('"'), raw.lastIndexOf('"') + 1));
```

The design MCP's `get_file` caps reads at 256 KiB, so **fetching this file
through the MCP silently truncates it at 262,086 bytes** — about line 3,157,
mid-attribute inside the document-viewer column. Everything below that cut is
lost, and that includes the command palette, the peek overlay, the galleries and
the status bar. If you are working from an MCP read rather than this file, you
do not have those four.

## Layout of the unwrapped document

Markup, then one `<script type="text/x-dc">` holding all the state and the
computed styles.

| lines | section |
|---|---|
| 1152 | title bar |
| 1191 | ribbon tabs |
| 1219 | ribbon body |
| 1265 | workspace, left panel, centre |
| 4173 | bottom panel |
| 4228 | right panel |
| 4346 | modal · 4387 context menu · 4399 celebration · 4427 floating console |
| 4463 | **gallery** |
| 4664 | **command palette** (`cp.*`) |
| 4701 | **peek** (`pk.*`) |
| 4784 | status bar |
| 12395+ | palette / peek / gallery computed styles |
| 13140+ | gallery computed styles |

The computed styles are where the real values live — `cp.winStyle`,
`pk.factsStyle`, `galStyle` and so on. The markup only names the bindings.
