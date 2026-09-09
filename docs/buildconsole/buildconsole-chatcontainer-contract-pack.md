# Contract Pack — Chat Document Container + Tool Rail (BuildConsole)

> **Notice for UI designers (e.g. Claude Design).**
> This document is the authoritative specification for the **Chat Document Container** surface of
> the BuildConsole desktop app — the 5-band native WPF chrome that wraps one live claude.ai chat
> tab. It is extracted **directly from the shipped code**, not from the original design intent:
> `desktop/BuildConsole/Controls/ChatDocumentContainer.xaml`,
> `desktop/BuildConsole/Controls/ChatDocumentContainer.xaml.cs`, and
> `desktop/BuildConsole/Controls/IChatSendableTool.cs`, plus the real supporting services those
> files call. Every control, colour, data source, status vocabulary and interaction below has real
> backing logic in C#/.NET 8 WPF.
>
> You have **full creative freedom over visual appearance** (spacing, grouping, typography,
> micro-interactions). You have **zero freedom over what data exists**. A value with no real source
> renders as its honest empty state (`#—`, `Messages: —`, a hidden band) — never a fabricated
> placeholder. Where a control is deliberately collapsed until it has real work to do, that is a
> real state, not an omission.
>
> Sub-issue of **#3013** (Feature: BuildConsole Contract Packs); the surface itself is Git **#2548**
> (BuildConsole port of ShaneBuilder's #2209). Original design source: ShaneBuilder's
> `wpf-handoff/README-ClaudeChat.md`. **The code below supersedes that README wherever they
> disagree** — this pack documents what actually shipped.

---

## 1. What this surface is

`ChatDocumentContainer` is a `UserControl` that hosts exactly **one Claude chat tab**. There is one
container instance per chat tab (`ChatDocumentContainer.xaml.cs:42`), which is what makes per-tab
state — the composer draft, the cached tool instances, the cross-epic question list — structural
rather than dictionary-keyed: switching tabs switches the whole container.

The **message thread and the primary composer inside the chat are the real claude.ai site**, hosted
in a `WebView2` that `MainWindow.OpenChatTab` injects into the container's `ChatBodyHost` slot via
`SetBody(FrameworkElement)` (`ChatDocumentContainer.xaml.cs:157-161`). This container does **not**
re-implement a transcript. Everything it draws is **native WPF chrome around** that live web view.

The shell is a 5-row `Grid` (`ChatDocumentContainer.xaml:71-461`):

| Row | Band | Palette | Default visibility |
| :-- | :--- | :------ | :----------------- |
| 0 | **Context bar** (epic + status counts + context gauge + icon cluster + wrench) | **Cool** (shell) | Always visible |
| 1 | **Breadcrumb / Share bar** | Warm | Always visible |
| 2 | **Inspector warning notice** (transient) | Warm | Collapsed |
| 3 | **Body**: live claude.ai `WebView2` (centre) + **tool rail** (right sibling) | Warm | Web view always; rail 0px until opened |
| 4 | **App-owned Composer** (+ Inspector blocking overlay) | Warm | Collapsed until a draft or return address exists |

### 1.1 The load-bearing palette split — do not harmonise

Band 0 is the **only** band on the cool shell palette (`#12151c` family). Every other band uses the
warm **Claude family** (`#1a1a19` / `#1e1e1c` / `#232320`). The XAML header comment is explicit:
"Only band 0 stays on the cool shell palette… Do NOT harmonise the palette split"
(`ChatDocumentContainer.xaml:8-16`). This intentional two-tone (cool BuildConsole shell vs warm
claude.ai chrome) is a real design invariant, not drift.

---

## 2. Data models & backing sources

Nothing on this surface is fixture data. The real backing types:

### 2.1 `BoardChat` — the tab's backing row (`Services/BuildTrackerApiClient.cs:103-130`)

The container is constructed with one `BoardChat` (`ctor` at `ChatDocumentContainer.xaml.cs:118`).
Fields this surface actually reads:

| Field | Type | Used for |
| :---- | :--- | :------- |
| `Id` | `int` (bt_chats PK) | Passed to `ChatDockService.BuildAsync` for the Detected panel. `0` unless loaded via the direct-Postgres board path. |
| `ConversationId` | `string` | The stable **per-tab key** (`TabId`, line 151); the context-meter store key; the claude.ai chat URL fallback. |
| `Title` | `string` | Breadcrumb "Chat" label; cross-epic stamp label. |
| `ClaudeUrl` | `string` | The Share button's copied link; the Detected panel's chat URL. Empty → Share button hides. |

> **There is no `model` / `effort` column on `bt_chats`.** The old static "Sonnet 5 / Medium" labels
> under the composer were removed for exactly this reason — a chat tab is not 1:1 with a queued
> build's model/effort, so there is no live per-tab value to bind. Do not re-add those labels
> (`ChatDocumentContainer.xaml:425-431`).

### 2.2 `CrossEpicQuestion` (`ChatDocumentContainer.xaml.cs:18-32`)

In-memory model for the §7 cross-epic round trip. Fields: `Id` (GUID), `ToEpic`/`ToEpicName`/
`ToConversationId`, `FromEpic`/`FromEpicName`/`FromConversationId` (the **required return address**),
`Question`, `State`, `Answer`. `State` is the enum **`CrossEpicState`** with exactly two values:
**`Asked`** and **`AnswerReady`**. This list lives only for the container's lifetime — it is not
persisted.

### 2.3 Context / status data sources (all live, no fixtures)

| Surface value | Real source | Citation |
| :------------ | :---------- | :------- |
| Epic number + name | `MainWindow.LeftSidebar.GetEpicForChat(chat)` → `BoardEpic.GithubNumber` / `.Title` | `xaml.cs:191-195` |
| `N verifying` / `N in-flight` / `N queued` | `MainWindow.BuildQueuePanel.CurrentQueueItems`, scoped to the epic's children | `xaml.cs:244-261` |
| `N blocked` | GitHub board label signal: `LeftSidebar.CurrentBoardIssues` where `IsBlocked` on the epic's children | `xaml.cs:239-241` |
| `X/Y complete` | GitHub's own sub-issue rollup on the epic node (`SubIssueCompleted` / `SubIssueCount`), else child count | `xaml.cs:264-273` |
| Context gauge tokens + message count | `ChatContextMeterStore.Get(conversationId)` first, then `MainWindow.TryGetLiveContextMeter(webview,…)` fallback | `xaml.cs:301-343` |

The verifying/in-flight/queued counts come from the **live build queue** (the precise "actively
building" source) while blocked comes from the **GitHub board label**, deliberately so the two do
not double-count the same issue (`xaml.cs:236-241`).

---

## 3. Band 0 — Context bar (COOL)

`Border` at `Grid.Row=0`, `Panel.ZIndex=40`, background `#12151c`, 1px bottom border `#21262d`
(`ChatDocumentContainer.xaml:82-85`). ZIndex 40 + `ClipToBounds=false` are load-bearing so the
wrench `Popup` paints **over** the warm body below rather than being clipped (`xaml:80-81`).

### 3.1 Background context gauge sweep (`CtxBarFill`, `xaml:88-90`)

A left-anchored `Border`, `Opacity=0.16`, background/border the warm accent `#d97757`, whose `Width`
is set to `pct * CtxBarBorder.ActualWidth` where `pct = min(1, used / 900000)` (`xaml.cs:396-397`).
It is the "fill" behind the whole bar showing fraction of context budget consumed. Repainted on
`SizeChanged` (`xaml:85`, `xaml.cs:406`).

### 3.2 Left cluster — `WrapPanel` (`xaml:97-134`), left→right

| Control | `x:Name` | Content / state | Source |
| :------ | :------- | :-------------- | :----- |
| Epic number | `CtxEpicNum` | `#{n}` or **`#—`** when unresolved; Consolas 17 ExtraBold, `#fde047`; **clickable** | `xaml.cs:193` |
| Epic name | `CtxEpicName` | Epic title, `#8b93a1`; collapsed when empty | `xaml.cs:194-195` |
| divider | — | 1×16 `#262c36` | static |
| Verifying count | `CtxStatVerifying` | `"{n} verifying"`, `#8fa7c4` | `xaml.cs:276` |
| In-flight count | `CtxStatInFlight` | `"{n} in-flight"`, `#6a8fb5` | `xaml.cs:277` |
| Queued count | `CtxStatQueued` | `"{n} queued"`, `#8b949e` | `xaml.cs:278` |
| Blocked count | `CtxStatBlocked` | `"{n} blocked"`, `#e8746f` | `xaml.cs:279` |
| Complete count | `CtxStatComplete` | `"{x}/{y} complete"` (or `"{n} complete"` when no total), Bold `#7fb08a` | `xaml.cs:280` |
| divider | — | 1×16 `#262c36` | static |
| Plan tier pill | `CtxPlanPill` / `CtxPlanPillText` | "Pro" chip on `#1e2233`/`#2e344e`; **collapsed by default** (no live source wires it visible today) | `xaml:120-125` |
| Context gauge | `CtxGauge` | `"{used}k / 900k ctx"`, Consolas 11, colour = tier colour | `xaml.cs:355-382` |
| Messages | `CtxMessages` | `"Messages: {n}"` or **`Messages: —`** | `xaml.cs:288-289` |
| Active time | `CtxActive` | `"Active: {d}d {h}h {m}m"` since container construction | `xaml.cs:283-286` |

The epic number and (see §4) the breadcrumb "Chat" both fire `CtxEpic_Click`, which opens
`https://github.com/shanemccaw/Shane-McCaw-MSP/issues/{EpicNumber}` in the system browser
(`xaml.cs:408-420`). No-op when no epic is resolved.

### 3.3 Right cluster — `StackPanel` (`xaml:136-195`), left→right

1. **`BtnStartNewChat`** (`xaml:140-152`) — red `#e8746f` pill, text "Start New Chat", **collapsed by
   default**. Shown only when `conversationTokens >= 60_000` (`xaml.cs:386`). Click runs the real
   archive + handoff-pointer flow `MainWindow.StartNewChatWithHandoffAsync(chat, oldTab, epic)`
   (`xaml.cs:428-445`); falls back to `OpenOrCreateEpicChat` only if this container's own tab can't
   be resolved. Its tooltip carries the live tier label, exact conversation token count, an estimated
   dollar cost (`tokens × $3/1M`), and remaining-to-critical tokens (`xaml.cs:388-394`).
2. **`BtnDetected`** (⌸, glyph `E9D2`) with **`DetectedDot`** accent dot (`xaml:154-164`) — toggles
   the Detected-in-this-chat rail panel (§5.1). The dot (`#d97757`) shows only when undismissed items
   exist **and** the panel is closed (`xaml.cs:796-801`).
3. **`BtnFloaty`** (⧉, glyph `E8A7`, `xaml:166-171`) — pops this conversation into the always-on-top
   Floating Chat window via `MainWindow.OpenFloatingChatWindow(chat)` (`xaml.cs:447`).
4. **`BtnWrench`** (⚒, glyph `E90F`, always amber `#e2984a`, always carries a dotted accent, `xaml:
   172-182`) — toggles `WrenchPopup` (§5).

### 3.4 Wrench popup (`WrenchPopup`, `xaml:183-194`)

Placement `Bottom`, `StaysOpen=false`, `AllowsTransparency=true`, offset `-160,6`, 200px wide, warm
rail background `#232320`, drop shadow. Its `StackPanel` (`WrenchMenuItems`) is built in code
(`BuildWrenchMenu`, `xaml.cs:470-521`) from the static **tool identity table** (`Tools`,
`xaml.cs:102-116`):

| id | Label | Glyph colour | Rail behaviour today |
| :- | :---- | :----------- | :------------------- |
| `logs` | Log Peek | `#7fb08a` | **Real** — hosts `LogPeekView` |
| `api-local` | API Runner | `#c084fc` | Stub |
| `api-read` | Graph Read | `#00b4d8` | Stub |
| `api-write` | Graph Write | `#e2593f` | Stub |
| `gitdoctor` | Git Doctor | `#e2593f` | **Real** — hosts `GitDoctorMiniView` |
| `gitmap` | Git Map | `#6a8fb5` | Stub |
| `health` | Repo Health | `#e0a879` | Stub |
| `sql` | SQL Runner | `#38bdf8` | Stub |
| `ps` | PowerShell | `#4f8ff0` | Stub |
| `terminal` | Terminal | `#6ee7b7` | **Real** — hosts `TerminalView` |
| `json` | JSON Viewer | `#c084fc` | Stub |
| `files` | Windows File Browser | `#7dc4f5` | Stub |

> The glyph strings in the `Tools` tuple are Segoe MDL2 code points that render empty in this
> markdown; they are real in the app. Each stub tool is its **own** sibling Feature under Epic
> **#1202**; only Terminal (#2769), Log Peek (#2787) and Git Doctor mini (#2799) have real internals
> so far. Adding a new real tool is a one-row change to `Tools` plus a branch in `OpenTool`.

Below the tool rows, a divider then **"Ask another epic's chat…"** (accent `#d97757`,
`xaml.cs:510-520`) triggers the cross-epic question flow (§7).

---

## 4. Band 1 — Breadcrumb / Share bar (WARM)

`Border` `Grid.Row=1`, background `#1a1a19`, bottom border `#302f2d` (`xaml:200-248`). A near-replica
of claude.ai's own top chrome.

- Breadcrumb (`xaml:208-226`): home glyph → **"Shane McCaw SaaS"** (static product label) → `/` →
  `CrumbEpic` (`"#{n} — {title}"`, bold bright, **collapsed** when no epic resolves) → `CrumbEpicSep`
  → **`CrumbChat`** (the chat title, underlined, clickable → `CtxEpic_Click`) → chevron. `CrumbChat`
  is set from `chat.Title` (or "New Chat") at construction (`xaml.cs:128`) and re-derived on refresh.
- **`BtnShare`** (`xaml:227-246`) — pill "Share" with copy glyph. Click copies `chat.ClaudeUrl` to
  the clipboard and toasts success; **if `ClaudeUrl` is empty the button hides itself** rather than
  copying a fake link (`xaml.cs:449-464`). Honest-empty, not a dead pill.

---

## 5. Body — the tool rail (Band 3, right column)

The body row is a 2-column `Grid` (`xaml:265-359`): column 0 `*` = the live claude.ai `WebView2`
(`ChatBodyHost`), column 1 = **`RailColumn`**, whose width is **`0` when nothing is open and `280`
when a panel is open** (`SetRailOpen`, `xaml.cs:710-713`). The rail hosts **exactly one thing at a
time** — `_chatToolOpen` (a wrench tool id) and `_detectedOpen` are mutually exclusive
(`xaml.cs:65-68`).

### 5.1 Rail header (shared across every panel, `xaml:281-315`)

36px header, left→right: **`RailGlyph`** (panel icon, colour set per panel) + **`RailTitle`**; then a
right-docked action cluster, each collapsible:

| Header action | `x:Name` | Shown when | Behaviour |
| :------------ | :------- | :--------- | :-------- |
| Send to Chat (share glyph `E72A`, accent) | `RailSendToChat` | Hosted tool implements `IChatSendableTool` **and** has non-empty content right now | Sends that content to the active chat (§6) |
| Refresh (`E72C`) | `RailRefresh` | Detected panel open | `RefreshDetectedAsync()` |
| Maximize (`E740`) | `RailMaximize` | `logs` or `gitdoctor` open | Opens that tool's full document tab |
| Close (`E711`) | `RailClose` | Always | `CloseRail()` |

**Maximize targets** (`xaml.cs:682-697`): `logs` → `MainWindow.OpenLogViewerTab()`; `gitdoctor` →
`MainWindow.OpenGitDoctorTab()` (a full-width Editor tab, #2809). Every other tool's maximize is a
dead icon, so it is **collapsed** for them rather than shown inert (`xaml.cs:541`).

### 5.2 Detected-in-this-chat panel (`DetectedScroller`, `xaml:327-338`)

Opened by `BtnDetected` (`OpenDetected`, `xaml.cs:659-676`). Two stacked regions:

- **Cross-epic question cards** (`CrossEpicCards`, top, own `ScrollViewer`, `MaxHeight=220`) — see §7.
- **`DetectedDockHost`** (fills remaining space) — hosts the real, already-shipped **`ChatDockPanel`**
  populated by **`ChatDockService.BuildAsync(db, chatUrl, chat.Id, queueItems)`**
  (`xaml.cs:719-746`): the mentioned-issues + pinned-questions dock. No new backend — it reuses the
  landed ChatDock service.

> Structural note (#2683): `DetectedDockHost` must **not** be wrapped in an outer `ScrollViewer` —
> `ChatDockPanel` owns its own internal scroller, and nesting a second one made the mouse wheel fight
> between them (`xaml:319-326`).

Per-item actions wired in `RenderDock` (`xaml.cs:751-788`), all real:

| Action | Real path |
| :----- | :-------- |
| Open issue | `MainWindow.OpenGitDetailByNumberAsync(n)` — in-app Git detail tab, **not** a browser |
| Resolve pin | `MainWindow.SendToChatAsync(chat, reply)` — posts the reply into the chat |
| Dispatch | `IssueDispatchService.DispatchAsync(QueueDb, item.Number)` — the real queue path |
| Dismiss | Adds to the in-memory `_dismissed` set and re-renders against the cached `_lastDockData` (no GitHub round-trip, #2682) |
| Send to discuss | `MainWindow.SendToChatAsync(chat, "Let's discuss #{n} — {title}")` |

`_hasUndismissed` (which drives the ⌸ accent dot) recomputes as: any dock item not in `_dismissed`,
**or** any pinned question, **or** any cross-epic question (`xaml.cs:737-739`).

### 5.3 Real tool hosts vs stub (`OpenTool`, `xaml.cs:525-588`)

`OpenTool` sets the header glyph/title, decides Maximize visibility, then chooses the body:

- **`terminal`** → lazily creates and **caches `_terminalView`** (a real persistent local shell), sets
  it as `ToolHost.Content`. Cached per chat tab so a running `npm install` / long `git` op **survives
  rail close/reopen** instead of restarting (`xaml.cs:74-79`, `549-555`).
- **`logs`** → lazily creates and caches **`_logPeekView`** (`LogPeekView`); a running LIVE/BURST tail
  and checked lines survive reopen (`xaml.cs:80-84`, `556-562`).
- **`gitdoctor`** → lazily creates and caches **`_gitDoctorMiniView`** (`GitDoctorMiniView` on the
  #2798 `GitDoctorService`); its in-panel "send findings" writes into **this tab's composer** via
  `AppendToComposer` (the never-auto-send invariant); calls `EnsureLoaded()` (`xaml.cs:85-90`,
  `563-577`).
- **every other id** → `ToolHost` collapsed, **`ToolStubBody`** shown (`xaml:339-349`): an honest
  empty panel reading "This tool ships as its own Feature under #1202" / "The container shell, header
  and rail behaviour are wired and ready." (`xaml.cs:578-583`).

Three panels are mutually exclusive in the body Grid (`xaml:317-356`): `DetectedScroller`,
`ToolStubBody`, `ToolHost`. `CloseRail()` clears both open flags and 0-widths the column
(`xaml.cs:701-708`).

---

## 6. `IChatSendableTool` — the generic Send-to-Chat contract

**File: `Controls/IChatSendableTool.cs` (Git #2783).**

```csharp
public interface IChatSendableTool
{
    // The tool's current real output/selection to send into the active chat's composer,
    // or null/empty when there's genuinely nothing to send right now. Called fresh every
    // time the rail header needs to decide show/enable, and again immediately before the
    // actual send — never cached.
    string? GetSendableContent();
}
```

Any control hosted in `ToolHost` opts into the rail-header **Send to Chat** icon with **zero
per-tool wiring**: the container checks `ToolHost.Content is IChatSendableTool` and calls
`GetSendableContent()`. Nothing in the rail header needs to know which tool is hosted.

- **Visibility** (`UpdateSendToChatAffordance`, `xaml.cs:596-602`): the icon shows only when
  `ToolHost` is visible, its content implements `IChatSendableTool`, **and** `GetSendableContent()`
  is non-empty. Recomputed on every rail transition (open/close/switch) and on the 30s tick, so a
  tool whose output changes while the rail sits open (e.g. Terminal mid-command) doesn't leave the
  icon stale for long.
- **Click** (`RailSendToChat_Click`, `xaml.cs:610-630`): **re-reads `GetSendableContent()` fresh at
  click time** (content can change between the 30s refresh and the click), then routes through the
  shared `MainWindow.SendTextToActiveClaudeChatAsync(...)` — the exact same active-chat
  composer-injection path used by the SQL Runner (#940) and Log Viewer (#2786). Empty content →
  toast "Nothing to send yet."

**First and only real implementer today: `TerminalView`** (`Controls/TerminalView.xaml.cs:21,
127-133`). Its `GetSendableContent()` returns the output pane's **selection if non-empty** (Shane
deliberately selected that text), otherwise the pane's **full output history**, otherwise `null` —
both paths read straight out of `OutputBox`, never fabricated.

### 6.1 `SendToTool(toolId, text)` — external inbound (`xaml.cs:632-651`)

Public entry for `MainWindow`'s `BT_SEND_TO_TOOL` handler (the shell-block tool-picker dropdown):
opens/focuses this tab's rail with `toolId` active and hands it the block's real text. Reuses the
same cached-per-tab instance so a sent command lands in the tab's **live** session. Currently only
`terminal` is wired — it runs a multi-line block as a real queued sequence
(`TerminalView.RunQueue(text)`). Unknown id → toast.

---

## 7. Band 4 — App-owned Composer

`Grid.Row=4` (`ComposerBand`, `xaml:368-460`). **Collapsed by default** and stays collapsed until
there is a real draft **or** a pending cross-epic return address (`UpdateComposerBandVisibility`,
`xaml.cs:838-843`). claude.ai's own composer on the live page above already handles ordinary
typing/sending; this band's only job is staging a tool's "send to chat" write or a cross-epic answer.

Structure (`xaml:371-436`):

- **`ComposerReturnBar`** (`xaml:374-387`) — accent-bordered bar shown when a cross-epic question was
  written into **this** tab; carries the return-address text and a clear (×) button.
- **Composer pill** (`xaml:388-424`) — rounded `#2a2a27` input with a paperclip glyph, the
  **`ChatComposer`** `TextBox` (`AcceptsReturn`, 22–120px, accent caret `#d97757`), and
  **`BtnComposerSend`** (send glyph, accent).
- Disclaimer row: "Claude is AI and can make mistakes. Please double-check responses."

### 7.1 Draft model & send

- `DraftText` / `TabId` (`xaml.cs:809, 151`) — the draft **is** this tab's draft; one container per
  tab makes the §8 per-tab draft dictionary structural.
- **`AppendToComposer(text, returnAddress?)`** (`xaml.cs:814-831`) — the single write entry every
  tool and the cross-epic flow uses. Appends after a blank line (never overwrites), focuses, and, if
  a return address is given, raises `ComposerReturnBar`. **Never auto-sends** (the §5 invariant).
- **Send** (`ChatComposer_PreviewKeyDown` + `BtnComposerSend_Click` → `SendComposerAsync`,
  `xaml.cs:857-912`): **Enter sends, Shift+Enter newlines.** Send resolves the **live** `WebView2`
  from the hosted body subtree at send time (`ResolveWebView`, `xaml.cs:165-178`) — a background
  reopen-swap can dispose the original, so a captured reference would go stale — then drives the real
  DOM bridge: `FloatingChatBridgeScript.BuildInsertScript(text)` (expects `"inserted"`), a 220ms
  delay, then `FloatingChatBridgeScript.SubmitScript`. On success it clears **only this tab's** draft
  and the return bar. Failures toast honestly ("The live chat view isn't ready yet." / "Couldn't
  reach the claude.ai composer to send.").

### 7.2 Cross-epic question round trip (§7 of the design)

Started from the wrench "Ask another epic's chat…" (`StartCrossEpicQuestion`, `xaml.cs:918-959`):

1. `MainWindow.GetOtherOpenChatEpics(conversationId)` lists other open epic chats. None → toast "Open
   another epic's chat tab first…".
2. `CrossEpicAskDialog` collects a target + question.
3. A **stamped** question (`**Question from {from}**` … `_Answer here, then take it back to #N._`) is
   written into the **destination** tab's composer via `MainWindow.AppendToChatComposer(targetConvId,
   stamped, returnAddress:…)` — **never auto-sent**, with a return bar raised there.
4. A `CrossEpicQuestion` is added to `_questions`, and the Detected panel opens showing a card.

Cards (`BuildCrossEpicCard`, `xaml.cs:968-1051`) have two visual states matching `CrossEpicState`:

- **`Asked`** → amber `#e2b039` border, header "WAITING ON THAT CHAT", a **"Bring the answer back"**
  button that reveals a paste box + "Answer captured" confirm (the DOM one-shot read of another tab's
  last turn is **deliberately not wired** in this container issue; manual paste is the sanctioned
  fallback, `xaml.cs:1021-1023`).
- **`AnswerReady`** → green `#7fb08a` border, header "ANSWER READY", shows the captured answer and a
  **"Paste answer into this chat"** button that `AppendToComposer`s a formatted answer block and
  removes the card.

---

## 8. Band 2 & the Inspector states (§9)

Two visual Inspector states only — **there is no inspector engine in this container**; these are
public hooks driven from outside (`xaml.cs:1088-1109`):

- **`ShowInspectorWarning(message)`** → the transient **`InspectorWarningNotice`** band (`Grid.Row=2`,
  `xaml:253-263`): a centred amber-icon notice above the body. It lives in its **own row** (not
  floating over the body) precisely because the body is a `WebView2` whose native child paints over
  any WPF sibling in the same cell (airspace) — a floating overlay there would be invisible
  (`xaml:250-252`).
- **`ShowInspectorBlocking()`** → **`InspectorBlockingOverlay`** (`xaml:441-459`), which covers **only
  the composer band**. Because it is native WPF over a native band there is no airspace problem, and
  the transcript above stays readable. It forces `ComposerBand` visible so the overlay isn't hidden
  with a collapsed band (`xaml.cs:1094-1102`). Shows a spinner-style card: "Inspector is asking Claude
  a question…" / "You'll get control back once Claude responds".
- **`ClearInspector()`** hides both and re-evaluates composer-band visibility.

---

## 9. The context gauge — real maths, two independent threshold sets

`UpdateGauge()` (`xaml.cs:355-398`) and its constants (`xaml.cs:44-57`) are the one real chat-context
indicator (the old separate `meterState` banner in `MainWindow` is retired, #2727).

**Budget / fill scale** (overhead-inclusive):

```
used = FixedOverhead(40_000) + conversationTokens + draftTokens
draftTokens      = ChatComposer.Text.Length × 0.28   (CharsPerTokenFactor)
conversationTokens = ChatContextMeterStore value, else live meter, else 0
pct  = min(1, used / ContextBudget)      ContextBudget = 900_000
CtxGauge.Text = "{FormatK(used)} / {FormatK(900_000)} ctx"      → e.g. "≈40k / 900k ctx"
```

`ContextBudget` is `900_000` (Git #2802: Sonnet 5's real 1M window less a deliberate safety margin).
The "900k" label is **derived from the constant**, not a second hardcoded string.

**Colour / "Start New Chat" tiers** — a **deliberately separate** set of *raw conversation-token*
thresholds (ported verbatim from the retired banner, **not** a percentage of the budget, so they do
**not** scale with `ContextBudget`) (`xaml.cs:373-386`):

| Raw conversation tokens | Tier label | Gauge colour | Start New Chat |
| :---------------------- | :--------- | :----------- | :------------- |
| `< 60_000` | Normal | `#A6E3A1` (green) | hidden |
| `≥ 60_000` | Getting long | `#F9E2AF` (yellow) | **shown** |
| `≥ 85_000` | Very long | `#FAB387` (peach) | shown |
| `≥ 100_000` | Critical | `#F38BA8` (red) | shown |

The four hex values match the app's own `GreenBrush`/`YellowBrush`/`PeachBrush`/`RedBrush`
(`Themes/DarkTheme.xaml`) so the gauge reads as the same real palette.

### 9.1 The meter resolution chain (`ResolveConversationMeter`, `xaml.cs:301-343`)

Reads the **persisted `ChatContextMeterStore`** (keyed on `ConversationId`) first; falls back to the
**live in-memory meter** for this tab's `WebView2` via `MainWindow.TryGetLiveContextMeter(...)` when
the store has no entry; returns `haveData=false` only when neither has anything (a genuinely empty
upstream, not a frozen reader). It logs which source answered — `persisted-store` /
`live-meter-fallback` / `none` — on the `system.core.chat-context` channel, throttled to source
changes (`xaml.cs:330-340`). This is both the gauge's and "Messages:"'s source, so they stay
consistent.

### 9.2 What keeps the bar live (Git #2802)

A `DispatcherTimer` at **30s** (`xaml.cs:142-145`) ticks `RefreshContext()` + `UpdateSendToChatAffordance()`.
`Loaded` starts the timer and calls `RefreshContext()` **once immediately** (so a tab reselect
doesn't wait 30s); `Unloaded` stops it. `RefreshContext()` (`xaml.cs:187-219`) recomputes epic label,
breadcrumb, the epic-scoped status counts, active time and gauge — all from live data, safe to call
repeatedly. `UpdateGauge()` also fires on composer `TextChanged` and on context-bar `SizeChanged`.

---

## 10. Interaction & data invariants (the rules a redesign must preserve)

1. **The transcript + primary composer are the real claude.ai site** (WebView2 in `ChatBodyHost`).
   Do not re-skin them as native chrome; you are designing the chrome *around* them.
2. **Cool band 0 vs warm bands 1–4 is intentional** and must not be harmonised (`xaml:8-16`).
3. **Nothing is fabricated.** No epic → `#—` and a collapsed breadcrumb epic. No meter data →
   `Messages: —` and the 40k floor. No `ClaudeUrl` → Share hides. A stub tool shows the honest
   "ships as its own Feature under #1202" body, never fake output.
4. **The rail holds exactly one thing** — a wrench tool **or** the Detected panel — and is **0px wide
   when closed** (`RailColumn` 0/280).
5. **Tools never auto-send.** Every tool and the cross-epic flow writes into the app-owned composer
   via `AppendToComposer`; the human presses Send. The rail Send-to-Chat icon is the one deliberate
   one-click path, and even it re-reads content fresh at click time.
6. **The composer band is on-demand**, collapsed until a draft or a cross-epic return address exists.
7. **Per-tab state is structural** (one container per tab): the composer draft, the cached
   `TerminalView`/`LogPeekView`/`GitDoctorMiniView`, and the `_questions` list all belong to this tab
   and survive rail close/reopen without restarting live sessions.
8. **Enter sends, Shift+Enter newlines** in the app-owned composer.
9. **The two threshold sets are independent**: the 40k+/900k budget fill vs the raw-token
   60k/85k/100k colour+handoff tiers. Changing the budget must not silently move the handoff tiers.
10. **`GetSendableContent()` is called fresh, never cached** — both for the icon's show/enable
    decision and immediately before the send.

---

## 11. Real palette (exact hex, from `UserControl.Resources`, `xaml:18-45`)

| Key | Hex | Role |
| :-- | :-- | :--- |
| `Cool.CtxBg` | `#12151c` | Context bar background (only cool band) |
| `Cool.CtxBorder` | `#21262d` | Context bar bottom border |
| `Cool.Divider` | `#262c36` | In-bar dividers |
| `Cool.EpicNum` | `#fde047` | Epic number (yellow) |
| `Cool.EpicName` | `#8b93a1` | Epic name |
| `Cool.Verifying` | `#8fa7c4` | Verifying count / plan pill text |
| `Cool.InFlight` | `#6a8fb5` | In-flight count |
| `Cool.Queued` | `#8b949e` | Queued count |
| `Cool.Blocked` | `#e8746f` | Blocked count / Start-New-Chat pill |
| `Cool.Complete` | `#7fb08a` | Complete count |
| `Cool.PillBg` / `Cool.PillBorder` | `#1e2233` / `#2e344e` | Plan tier pill |
| `Warm.Chrome` | `#1a1a19` | Breadcrumb + composer band chrome |
| `Warm.Transcript` | `#1e1e1c` | Root/body background |
| `Warm.Rail` | `#232320` | Tool rail + wrench popup |
| `Warm.Border` | `#302f2d` | Warm borders |
| `Warm.PopBorder` | `#35342f` | Popup borders |
| `Warm.Accent` | `#d97757` | Claude accent (gauge fill, caret, send, return bar) |
| `Warm.Bubble` | `#2a2a27` | Composer pill / cards |
| `Warm.Input` | `#0d0f10` | Input backgrounds |
| `Warm.TextBright` | `#ece9e4` | Bright text |
| `Warm.TextBody` | `#dedbd5` | Body text |
| `Warm.TextMuted` | `#c2c0bc` | Muted text |
| `Warm.TextDim` | `#7a7975` | Dim text |
| `Warm.TextFaint` | `#5a5955` | Faint text |
| `Warm.WrenchAmber` | `#e2984a` | Wrench glyph (always amber) |

Gauge tier colours (`#A6E3A1` / `#F9E2AF` / `#FAB387` / `#F38BA8`) and cross-epic card accents
(`#e2b039` asked / `#7fb08a` ready) are set in code-behind, not the resource dictionary, and mirror
`Themes/DarkTheme.xaml`.

---

## 12. Logging channels this surface writes

| Channel | Where |
| :------ | :---- |
| `chat.container` | RefreshContext / share / send / open-issue / start-new-chat fallback errors (`xaml.cs` throughout) |
| `system.core.chat-context` | The `[link 5]` meter-source diagnostic, throttled to source changes (`xaml.cs:333`) |
| `tool-rail.send-to-chat` | The rail Send-to-Chat injection (`xaml.cs:628`) |

---

## 13. Honest gaps / not-wired-here (real, by design)

- **Cross-epic auto-read** of another tab's last assistant turn is intentionally **not** wired in
  this container issue — manual paste is the sanctioned fallback (`xaml.cs:1021-1023`).
- **Plan tier pill** (`CtxPlanPill`) ships collapsed; no live source sets it visible in this file.
- **9 of 12 wrench tools** are honest stubs — Log Peek, Git Doctor mini and Terminal are the only real
  internals so far; each remaining tool is its own sibling Feature under #1202.
- **No `model`/`effort` per-tab labels** — there is no backing column; deliberately dropped rather
  than faked (`xaml:425-431`).

_Extracted from the shipped code on 2026-09-06 against `ChatDocumentContainer.xaml`/`.xaml.cs` and
`IChatSendableTool.cs`. Where any statement here disagrees with `README-ClaudeChat.md`, the code — and
therefore this pack — is authoritative._
