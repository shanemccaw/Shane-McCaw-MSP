import { useState, useCallback, useRef } from "react";

/**
 * Returns [copied, handleCopy] where handleCopy accepts the text to copy.
 * `copied` flips to true for `resetMs` milliseconds (default 2000) after a
 * successful write, then resets automatically.
 */
export function useCopyToClipboard(resetMs = 2000): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), resetMs);
    }).catch(() => {});
  }, [resetMs]);

  return [copied, handleCopy];
}
