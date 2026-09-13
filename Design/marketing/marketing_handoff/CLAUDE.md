# Project rules

## Build inside the shell, not beside it

`Customer Portal Shell.dc.html` is the product. All new modules, sections and
screens are built **directly in the shell** — as a nav item plus its section —
not as a standalone `.dc.html` page to be imported later.

Do not create new top-level pages unless explicitly asked. If a piece of work
genuinely needs its own file, ask first.

Every new module gets, in the same pass:
- a left-nav entry in the right group
- an `active === '<key>'` flag and its section in the template
- the shell's own width, padding, type scale and colour language — it must look
  native to the shell on the first pass, not after a retrofit

Existing standalone module pages (`Ownership`, `Change Control`,
`Microsoft Changes`) are imported into the shell and edited in place.
