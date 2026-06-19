import { useEffect } from "react";

const DEFAULT_OG_IMAGE = "/og-image.png";
const SITE_NAME = "Shane McCaw Consulting";

interface SEOMetaProps {
  title: string;
  description: string;
  ogImage?: string;
  ogUrl?: string;
  jsonLd?: object | object[];
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

export function SEOMeta({ title, description, ogImage = DEFAULT_OG_IMAGE, ogUrl, jsonLd }: SEOMetaProps) {
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

  useEffect(() => {
    if (!jsonLd) return;
    const scriptId = "jsonld-page";
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
    return () => {
      document.getElementById(scriptId)?.remove();
    };
  }, [jsonLd]);

  return null;
}
