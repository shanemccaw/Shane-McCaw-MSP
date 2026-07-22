import { useState, useEffect } from "react";

export interface VersionInfo {
  major: number;
  minor: number;
  build: number;
  hash: string;
  version: string;
  display: string;
}

const FALLBACK_VERSION_INFO: VersionInfo = {
  major: 1,
  minor: 0,
  build: 0,
  hash: "unknown",
  version: "1.0.0",
  display: "1.0.0 (unknown)",
};

/** Fetches the real, live build version from the running api-server at mount. */
export function useVersionInfo(): VersionInfo {
  const [versionInfo, setVersionInfo] = useState<VersionInfo>(FALLBACK_VERSION_INFO);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/version")
      .then((r) => (r.ok ? (r.json() as Promise<VersionInfo>) : Promise.reject()))
      .then((data) => {
        if (!cancelled && data && typeof data.display === "string") {
          setVersionInfo(data);
        }
      })
      .catch(() => {
        // keep the fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return versionInfo;
}
