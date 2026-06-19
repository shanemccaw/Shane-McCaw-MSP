export interface Article {
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  content: string;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { data: {}, content: raw };

  const yamlBlock = match[1];
  const content = match[2];
  const data: Record<string, string> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }

  return { data, content };
}

const rawFiles = import.meta.glob<{ default: string }>(
  "../content/articles/*.md",
  { query: "?raw", eager: true }
);

export const articles: Article[] = Object.values(rawFiles)
  .map((mod) => {
    const { data, content } = parseFrontmatter(mod.default);
    return {
      slug: data.slug ?? "",
      category: data.category ?? "",
      title: data.title ?? "",
      summary: data.summary ?? "",
      date: data.date ?? "",
      content,
    };
  })
  .filter((a) => a.slug && a.title && a.date)
  .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
