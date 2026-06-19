import { useEffect } from "react";

const DEFAULT_OG_IMAGE = "/opengraph.jpg";
const SITE_NAME = "Shane McCaw Consulting";

interface SEOMetaProps {
  title: string;
  description: string;
  ogImage?: string;
  ogUrl?: string;
}

function setMeta(property: string, content: string, isName = false) {
  const attr = isName ? "name" : "property";
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

export function SEOMeta({ title, description, ogImage = DEFAULT_OG_IMAGE, ogUrl }: SEOMetaProps) {
  useEffect(() => {
    document.title = title;

    setMeta("description", description, true);

    setMeta("og:type", "website");
    setMeta("og:site_name", SITE_NAME);
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:image", ogImage);
    if (ogUrl) setMeta("og:url", ogUrl);

    setMeta("twitter:card", "summary_large_image", true);
    setMeta("twitter:title", title, true);
    setMeta("twitter:description", description, true);
    setMeta("twitter:image", ogImage, true);
  }, [title, description, ogImage, ogUrl]);

  return null;
}
