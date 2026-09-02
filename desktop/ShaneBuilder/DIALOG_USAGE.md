# ShaneBuilder dialogs — never `MessageBox.Show`, always `AppDialog`

**Every ShaneBuilder call site that would reach for `System.Windows.MessageBox.Show(...)`
uses `ShaneBuilder.AppDialog` instead.** No exceptions, no "just this once" native
`MessageBox.Show`.

## Why this exists

`MessageBox.Show` renders with the OS's native chrome — a title bar, system font, and
colors that come from Windows, not from ShaneBuilder's own design system. Every other
top-level window in ShaneBuilder (`MainWindow`, toast notifications) uses the real
custom-chrome pattern (`WindowChromeHelper`, `Themes/Colors.xaml` `Brush.*` tokens,
`Themes/Typography.xaml` `FontSize.*` tokens from #2147). A native `MessageBox.Show`
call breaks that consistency the instant it appears on screen — it looks like a
different, older application popped up over ShaneBuilder.

`AppDialog` (Git #2179) exists precisely so ShaneBuilder code has a real, already-built
alternative before it ever needs one — there is no excuse to reach for the native
dialog "temporarily." See `AppDialog.xaml` / `AppDialog.xaml.cs` for the real
implementation this doc's examples are pulled from.

## The three call-site methods

`AppDialog` exposes a static call-site API only — you never construct it directly.

### `AppDialog.Alert` — OK-only informational/error dialog

Direct replacement for `MessageBox.Show(message, title, MessageBoxButton.OK, image)`.

```csharp
// Replaces: MessageBox.Show("Something went wrong.", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
AppDialog.Alert(this, "Something went wrong.", "Error", AppDialogIcon.Error);

// Info, no icon override needed (defaults to AppDialogIcon.Info):
AppDialog.Alert(this, "Saved successfully.", "Saved");
```

### `AppDialog.Confirm` — Yes/No (or Yes/No/Cancel) confirmation

Direct replacement for a `MessageBox.Show(...) != MessageBoxResult.Yes` guard-return
call site. Returns `true` only for an explicit Yes click — a Cancel, a No, or closing
the window (Alt+F4, title-bar close, Escape) all return `false`.

```csharp
// Replaces:
//   var result = MessageBox.Show("Delete this item?", "Confirm Delete",
//       MessageBoxButton.YesNo, MessageBoxImage.Question);
//   if (result != MessageBoxResult.Yes) return;
if (!AppDialog.Confirm(this, "Delete this item?", "Confirm Delete"))
    return;

// Yes/No/Cancel variant:
if (!AppDialog.Confirm(this, "Discard unsaved changes?", "Unsaved Changes",
        AppDialogButtons.YesNoCancel))
    return;
```

### `AppDialog.Input` — single-line text-input dialog

No native `MessageBox` equivalent exists for this — it's the same slot a hand-rolled
input dialog or a third-party control would otherwise fill. Returns the entered text,
or `null` if canceled/closed without confirming.

```csharp
var name = AppDialog.Input(this, "Enter a name for this profile:", "New Profile", defaultText: "Untitled");
if (name == null)
    return; // user canceled
```

## Call-site rules

- First parameter is always the owner `Window?` — pass `this` from the calling window
  so the dialog centers over it (`WindowStartupLocation="CenterOwner"`) and inherits
  its taskbar behavior.
- `AppDialogIcon` (`None`, `Info`, `Warning`, `Error`, `Question`) controls the glyph —
  pick the one that matches the message's real severity, not just the default.
- `AppDialogButtons` only applies to `Confirm` (`YesNo` default, or `YesNoCancel`).
- All three block the caller (`ShowDialog()`), exactly like `MessageBox.Show` — no
  async call-site changes are needed when converting an existing call.
