import React, { createContext, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

// Global testbed selection (MSP → customer) for the Simulator Studio. Every
// panel that used to keep its own selectedTestbedId/testbed list now reads
// this context instead — the header picker in SimulatorStudioPage is the one
// place the selection is made.

export interface TestbedMsp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: "active" | "suspended" | "trial";
  isTestbed: boolean;
}

export interface TestbedCustomer {
  id: number;
  mspId: number;
  name: string;
  domain: string | null;
  isTestbed: boolean;
}

interface TestbedContextType {
  msps: TestbedMsp[];
  /** All testbed customers, narrowed to the selected MSP when one is picked. An MSP is not required — a testbed customer doesn't have to have one assigned. */
  customers: TestbedCustomer[];
  loadingMsps: boolean;
  loadingCustomers: boolean;
  selectedMspId: number | null;
  selectedCustomerId: number | null;
  selectedCustomer: TestbedCustomer | null;
  setSelectedMsp: (mspId: number | null) => void;
  setSelectedCustomer: (customerId: number | null) => void;
}

const STORAGE_KEY = "simulator-testbed-selection";

function readStoredSelection(): { mspId: number | null; customerId: number | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mspId: typeof parsed?.mspId === "number" ? parsed.mspId : null,
        customerId: typeof parsed?.customerId === "number" ? parsed.customerId : null,
      };
    }
  } catch {}
  return { mspId: null, customerId: null };
}

const TestbedContext = createContext<TestbedContextType | undefined>(undefined);

export function useTestbedContext() {
  const context = useContext(TestbedContext);
  if (!context) {
    throw new Error("useTestbedContext must be used within a TestbedProvider");
  }
  return context;
}

export function TestbedProvider({ children }: { children: React.ReactNode }) {
  const { fetchWithAuth } = useAuth();

  const [msps, setMsps] = useState<TestbedMsp[]>([]);
  const [customers, setCustomers] = useState<TestbedCustomer[]>([]);
  const [loadingMsps, setLoadingMsps] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedMspId, setSelectedMspId] = useState<number | null>(() => readStoredSelection().mspId);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(
    () => readStoredSelection().customerId,
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ mspId: selectedMspId, customerId: selectedCustomerId }),
      );
    } catch {}
  }, [selectedMspId, selectedCustomerId]);

  useEffect(() => {
    let cancelled = false;
    setLoadingMsps(true);
    fetchWithAuth("/api/admin/msps?limit=100&isTestbed=true")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setMsps(d.msps ?? []);
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load testbed MSPs");
      })
      .finally(() => {
        if (!cancelled) setLoadingMsps(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  useEffect(() => {
    // Testbed customers are filtered on is_testbed only — a testbed customer
    // doesn't have to have an MSP assigned. The MSP dropdown, when set, just
    // narrows this same list client-side; it never gates the fetch.
    let cancelled = false;
    setLoadingCustomers(true);
    fetchWithAuth("/api/admin/testbeds")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list: TestbedCustomer[] = d.testbeds ?? [];
        setCustomers(list);
        // Drop a restored/stale customer that no longer exists in the list —
        // never leave a stale customer selected silently.
        setSelectedCustomerId((prev) =>
          prev != null && !list.some((c) => c.id === prev) ? null : prev,
        );
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load testbed customers");
      })
      .finally(() => {
        if (!cancelled) setLoadingCustomers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const setSelectedMsp = (mspId: number | null) => {
    // Narrowing the MSP filter can hide the current customer selection;
    // drop it rather than leave a selection the dropdown no longer shows.
    if (mspId !== selectedMspId) {
      const stillVisible =
        selectedCustomerId != null &&
        customers.some((c) => c.id === selectedCustomerId && (mspId == null || c.mspId === mspId));
      if (!stillVisible) setSelectedCustomerId(null);
    }
    setSelectedMspId(mspId);
  };

  const visibleCustomers = selectedMspId == null ? customers : customers.filter((c) => c.mspId === selectedMspId);

  const selectedCustomer =
    selectedCustomerId != null ? (customers.find((c) => c.id === selectedCustomerId) ?? null) : null;

  return (
    <TestbedContext.Provider
      value={{
        msps,
        customers: visibleCustomers,
        loadingMsps,
        loadingCustomers,
        selectedMspId,
        selectedCustomerId,
        selectedCustomer,
        setSelectedMsp,
        setSelectedCustomer: setSelectedCustomerId,
      }}
    >
      {children}
    </TestbedContext.Provider>
  );
}
