# Shane's Life design handoff: read first
The design is `Shanes Life - First Slice Prototype.dc.html`. Build every screen from it. The template is one `<x-dc>` rendered for two phones; each screen is an `<sc-if value="{{ d.showX }}">` block and `door()` in the logic class computes the `d.*` values (README.md, "Where each screen lives in the prototype").

`archive/` is exploration history. Every screen there has since been redesigned in the prototype. Never build from, or reconcile against, anything in `archive/`.

Also current: `Shanes Life 18 - Widget.dc.html` (the widget page) and `Shanes Life 19 - Vault Autofill.dc.html` (the Chrome add-on's screens).

When a screenshot, a README section and the prototype disagree, the prototype wins. README.md has the full notes.
