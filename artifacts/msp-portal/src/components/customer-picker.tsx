/**
 * CustomerPicker — shared customer selector for the MSP Portal.
 *
 * Fetches the current MSP's active customers and renders a searchable-by-scroll
 * Select. Reports both the selected customer's internal numeric id (used as
 * `customerId` or the confusingly-named `tenantId` field on some older API
 * routes — see Sales Offer Engine) and their real Azure AD tenant GUID, so
 * callers can auto-fill the GUID instead of asking the admin to type or guess it.
 *
 * Replaces two previously-independent, drifted implementations:
 *  - sales-bundles.tsx's AssignDialog (had the right shape, but hardcoded
 *    mspId=0 in its fetch URL, which only worked for PlatformAdmin sessions)
 *  - offers.tsx's GenerateDialog (had no picker at all — a raw type="number"
 *    input that couldn't accept a real tenant GUID)
 */

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface PickerCustomer {
  id: number;
  name: string;
  domain?: string;
  tenantId?: string;
  status: string;
}

interface CustomerPickerProps {
  value: string;
  onChange: (customerId: string, customer: PickerCustomer | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function CustomerPicker({ value, onChange, placeholder = "Select a customer…", disabled }: CustomerPickerProps) {
  const { user, fetchWithAuth } = useAuth();
  const [customers, setCustomers] = useState<PickerCustomer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user?.mspId) return;
    setLoading(true);
    fetchWithAuth(`/api/msp/v1/msps/${user.mspId}/customers?limit=200`)
      .then((r) => r.json())
      .then((data: { data?: PickerCustomer[] }) => setCustomers(data.data ?? []))
      .catch(() => setCustomers([]))
      .finally(() => setLoading(false));
  }, [user?.mspId, fetchWithAuth]);

  if (loading) return <Skeleton className="h-10 w-full" />;

  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v, customers.find((c) => String(c.id) === v))}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {customers.filter((c) => c.status === "active").map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}{c.domain ? ` (${c.domain})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}