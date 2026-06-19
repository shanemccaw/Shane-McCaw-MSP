# Publishing Articles on Shane McCaw Consulting

This folder holds every article that appears on the **Resources** page. Each article is a plain Markdown (`.md`) file. No code changes are needed to publish — just add a file and the site picks it up automatically.

---

## Frontmatter fields

Every article must start with a **frontmatter block** — the section between the `---` lines at the very top of the file. All five fields are required.

```
---
slug: your-article-slug
category: Copilot AI Tips
title: "Your Full Article Title Here"
summary: "One or two sentences that appear on the Resources card. Keep it under 200 characters."
date: June 19, 2026
---
```

| Field | What it does | Notes |
|-------|-------------|-------|
| `slug` | URL path for the article | Lowercase, hyphens only, no spaces. Must be **unique** across all articles. Example: `copilot-rollout-failing` |
| `category` | Filter tab on the Resources page | Must match one of the five categories exactly (see below) |
| `title` | Headline shown on the card and article page | Wrap in quotes if it contains a colon |
| `summary` | Preview text shown on the Resources card | Plain text, no Markdown |
| `date` | Publication date shown on the article page | Written format: `June 19, 2026` |

### Valid categories

Copy one of these exactly — spelling and capitalisation must match:

- `Copilot AI Tips`
- `M365 Best Practices`
- `Power Platform How-Tos`
- `Governance & Compliance`
- `Digital Transformation`

---

## Supported Markdown elements

### Headings

Use `##` for main section headings and `###` for sub-sections. Avoid `#` (H1) — the article title already serves as H1.

```markdown
## Main Section

### Sub-section
```

### Paragraphs

Just write. A blank line between blocks creates a new paragraph.

### Bold and italic

```markdown
**bold text**
_italic text_
```

### Bullet lists

```markdown
- First item
- Second item
- Third item
```

### Numbered lists

```markdown
1. First step
2. Second step
3. Third step
```

### Blockquotes (callout boxes)

Use `>` to highlight a fix, tip, or takeaway. These render as a styled callout on the article page.

```markdown
> Fix: Run a SharePoint permission report and remediate sites with overly broad access before enabling Copilot for any users.
```

### Inline code

```markdown
Use `backticks` for commands, file names, or technical terms.
```

---

## How to add a new article — step by step

1. **Create the file.** In this folder (`src/content/articles/`), create a new `.md` file. Name it the same as your `slug` — for example, `my-new-article.md`.

2. **Paste in the frontmatter.** Copy the template below, fill in every field, and make sure `slug` matches the filename (without `.md`).

3. **Write the article body.** After the closing `---` of the frontmatter, leave a blank line, then write your content using the Markdown elements above.

4. **Save the file.** The site automatically includes the new article on the Resources page the next time it is built or reloaded. No code changes are needed.

5. **Verify.** Open the Resources page and confirm the card appears in the correct category filter.

---

## Article template

Copy and paste this as a starting point:

```markdown
---
slug: your-slug-here
category: M365 Best Practices
title: "Your Article Title Here"
summary: "A brief description of what the reader will learn. Aim for one or two sentences."
date: June 19, 2026
---

Opening paragraph — set the context and explain why this topic matters to your reader.

## First Major Section

Body of the first section. Write as many paragraphs as needed.

> Tip: Use blockquotes to call out the single most actionable takeaway from each section.

## Second Major Section

Body of the second section.

- Key point one
- Key point two
- Key point three

## Third Major Section

Body of the third section.

### A sub-topic within this section

More detail here.

## Conclusion

Wrap up with the core message and, where appropriate, a call to action (e.g. link to a service page or invite the reader to book a call).
```

---

## Common mistakes to avoid

- **Slug mismatch** — the `slug` field and the filename must be identical (minus `.md`). If they differ, the article link will 404.
- **Wrong category spelling** — an article with an unrecognised category will not appear in any filter tab. Copy the category name exactly from the list above.
- **Missing frontmatter field** — if any of the five fields is absent the article may fail to load. Double-check all five are present.
- **Forgetting the closing `---`** — the frontmatter block needs both an opening and a closing `---`.
- **Using `#` for a top-level heading** — the page already renders the `title` field as H1. Start section headings with `##`.
