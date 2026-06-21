import { useState, useEffect } from "react";

export interface EngagementProject {
  id: number;
  title: string;
  priceRange: string;
  description: string | null;
  triggeredBy: string[];
  sowItems: string[];
  sortOrder: number;
  isVisible: boolean;
}

export function useEngagementProjects() {
  const [projects, setProjects] = useState<EngagementProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/public/engagement-projects")
      .then(r => r.ok ? r.json() as Promise<EngagementProject[]> : Promise.resolve([]))
      .then(data => setProjects(data))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  }, []);

  return { projects, loading };
}
