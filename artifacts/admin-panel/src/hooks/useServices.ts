import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface WizardOption {
  id: string;
  label: string;
  description?: string;
  priceAdjustment: number;
}

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  options: WizardOption[];
}

export interface ServiceRow {
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string[] | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  durationDays: number | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  isPublic: boolean;
  visibility: "public" | "private" | "landing_page_only";
  createdAt: string;
  serviceType: string | null;
  tagline: string | null;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  iconName: string | null;
  pageHref: string | null;
  sortOrder: number;
  tier: string | null;
  orderWorkflow: WizardStep[] | null;
  workflowTemplateId: number | null;
  overviewPdfKey: string | null;
  overviewPdfGeneratedAt: string | null;
}

export type ServiceUpdate = Omit<ServiceRow, "id" | "createdAt" | "orderWorkflow" | "overviewPdfKey" | "overviewPdfGeneratedAt">;
export type ServiceCreate = { name: string; slug: string; billingType: "one_time" | "recurring_monthly" };

export const SERVICES_QUERY_KEY = ["services"] as const;

export function useServices() {
  const { fetchWithAuth } = useAuth();
  return useQuery<ServiceRow[]>({
    queryKey: SERVICES_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/services");
      if (!res.ok) throw new Error("Failed to fetch services");
      return res.json() as Promise<ServiceRow[]>;
    },
  });
}

export function useService(id: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery<ServiceRow>({
    queryKey: ["services", id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/services/${id!}`);
      if (!res.ok) throw new Error("Service not found");
      return res.json() as Promise<ServiceRow>;
    },
    enabled: id !== null,
  });
}

export function useCreateService() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<ServiceRow, Error, ServiceCreate>({
    mutationFn: async (data) => {
      const res = await fetchWithAuth("/api/admin/services", {
        method: "POST",
        body: JSON.stringify(data),
      });
      const body = await res.json() as ServiceRow & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Create failed");
      return body;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: SERVICES_QUERY_KEY }); },
  });
}

export function useUpdateService() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<ServiceRow, Error, { id: number; data: Partial<ServiceUpdate> }>({
    mutationFn: async ({ id, data }) => {
      const res = await fetchWithAuth(`/api/admin/services/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
      const body = await res.json() as ServiceRow & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Update failed");
      return body;
    },
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
      void qc.invalidateQueries({ queryKey: ["services", id] });
    },
  });
}

export function useDeleteService() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const res = await fetchWithAuth(`/api/admin/services/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Delete failed");
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: SERVICES_QUERY_KEY }); },
  });
}
