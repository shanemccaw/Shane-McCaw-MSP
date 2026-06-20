import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";

interface WizardSelection {
  stepId?: string;
  stepTitle?: string;
  label?: string;
  value?: string | string[];
  [key: string]: unknown;
}

interface OrderWorkflowStep {
  id?: string;
  title?: string;
  description?: string;
  [key: string]: unknown;
}

interface PurchaseDetail {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  paidAt: string | null;
  createdAt: string;
  stripeSessionId: string | null;
  client: {
    id: number | null;
    name: string | null;
    email: string | null;
    company: string | null;
  };
  project: { id: number; name: string | null } | null;
  contracts: Array<{
    contractId: number;
    serviceName: string | null;
    wizardSelections: WizardSelection[] | null;
    orderWorkflow: OrderWorkflowStep[] | null;
  }>;
}

function statusColor(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case "paid": return { bg: "#D1FAE5", text: "#065F46", label: "Paid" };
    case "pending": return { bg: "#FEF3C7", text: "#92400E", label: "Pending" };
    case "draft": return { bg: "#E5E7EB", text: "#374151", label: "Draft" };
    case "due": return { bg: "#DBEAFE", text: "#1E40AF", label: "Due" };
    case "overdue": return { bg: "#FEE2E2", text: "#991B1B", label: "Overdue" };
    default: return { bg: "#E5E7EB", text: "#374151", label: status };
  }
}

function formatAmount(amount: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value ?? "—"}</Text>
    </View>
  );
}

function selectionDisplayValue(value: string | string[] | undefined): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function WizardSelectionsCard({ selections }: { selections: WizardSelection[] }) {
  if (selections.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Order Configuration</Text>
      <View style={styles.card}>
        {selections.map((sel, i) => {
          const label = sel.stepTitle ?? sel.label ?? sel.stepId ?? `Step ${i + 1}`;
          const val = sel.value !== undefined ? selectionDisplayValue(sel.value as string | string[]) : "—";
          return (
            <React.Fragment key={String(sel.stepId ?? i)}>
              {i > 0 && <View style={styles.divider} />}
              <InfoRow label={label} value={val} />
            </React.Fragment>
          );
        })}
      </View>
    </View>
  );
}

function OrderWorkflowCard({ steps }: { steps: OrderWorkflowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Fulfillment Steps</Text>
      <View style={styles.card}>
        {steps.map((step, i) => (
          <React.Fragment key={String(step.id ?? i)}>
            {i > 0 && <View style={styles.divider} />}
            <View style={styles.workflowStep}>
              <View style={styles.stepBullet}>
                <Text style={styles.stepNum}>{i + 1}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>{step.title ?? `Step ${i + 1}`}</Text>
                {step.description ? (
                  <Text style={styles.stepDesc}>{step.description}</Text>
                ) : null}
              </View>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data, isLoading, error, refetch } = useQuery<PurchaseDetail>({
    queryKey: ["admin-purchase", id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/purchases/${id}`);
      if (!res.ok) throw new Error("Failed to load order");
      return res.json() as Promise<PurchaseDetail>;
    },
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0078D4" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Feather name="alert-circle" size={40} color="#E53E3E" />
        <Text style={styles.errorText}>Could not load order</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const { bg, text: badgeText, label } = statusColor(data.status);

  // Gather all wizard selections and workflow steps across contracts
  const allSelections = data.contracts.flatMap(c => c.wizardSelections ?? []);
  const allWorkflowSteps = data.contracts.flatMap(c => c.orderWorkflow ?? []);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#0A2540" />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {data.invoiceNumber}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <Text style={styles.heroAmount}>{formatAmount(data.amount)}</Text>
            <View style={[styles.badge, { backgroundColor: bg }]}>
              <Text style={[styles.badgeText, { color: badgeText }]}>{label}</Text>
            </View>
          </View>
          {data.description && (
            <Text style={styles.heroDesc}>{data.description}</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Client</Text>
          <View style={styles.card}>
            <InfoRow label="Name" value={data.client.name} />
            <View style={styles.divider} />
            <InfoRow label="Email" value={data.client.email} />
            {data.client.company && (
              <>
                <View style={styles.divider} />
                <InfoRow label="Company" value={data.client.company} />
              </>
            )}
          </View>
        </View>

        {data.contracts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Services Purchased</Text>
            <View style={styles.card}>
              {data.contracts.map((c, i) => (
                <React.Fragment key={c.contractId}>
                  {i > 0 && <View style={styles.divider} />}
                  <InfoRow label={`Service ${i + 1}`} value={c.serviceName} />
                </React.Fragment>
              ))}
            </View>
          </View>
        )}

        {allSelections.length > 0 && (
          <WizardSelectionsCard selections={allSelections} />
        )}

        {allWorkflowSteps.length > 0 && (
          <OrderWorkflowCard steps={allWorkflowSteps} />
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Details</Text>
          <View style={styles.card}>
            <InfoRow label="Invoice #" value={data.invoiceNumber} />
            <View style={styles.divider} />
            <InfoRow label="Created" value={formatDate(data.createdAt)} />
            {data.paidAt && (
              <>
                <View style={styles.divider} />
                <InfoRow label="Paid at" value={formatDate(data.paidAt)} />
              </>
            )}
            {data.project && (
              <>
                <View style={styles.divider} />
                <InfoRow label="Project" value={data.project.name} />
              </>
            )}
            {data.stripeSessionId && (
              <>
                <View style={styles.divider} />
                <InfoRow label="Stripe session" value={data.stripeSessionId} />
              </>
            )}
          </View>
        </View>

        {data.client.id && (
          <Pressable
            style={({ pressed }) => [styles.messageBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/messages/${data.client.id}`)}
          >
            <Feather name="message-circle" size={18} color="#fff" />
            <Text style={styles.messageBtnText}>Message client</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9FC",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#F7F9FC",
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: "#6B7E96",
  },
  retryBtn: {
    backgroundColor: "#0078D4",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#F7F9FC",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  topTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    flex: 1,
    textAlign: "center",
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  heroCard: {
    backgroundColor: "#0A2540",
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroAmount: {
    fontSize: 32,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  heroDesc: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8FA3B8",
    marginTop: 8,
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#6B7E96",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#0A2540",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#6B7E96",
    minWidth: 100,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#0A2540",
    flex: 1,
    textAlign: "right",
    flexWrap: "wrap",
  },
  divider: {
    height: 1,
    backgroundColor: "#F0F4F8",
    marginHorizontal: 16,
  },
  workflowStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#E8F0FB",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  stepNum: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#0078D4",
  },
  stepBody: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
  },
  stepDesc: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7E96",
    marginTop: 3,
  },
  messageBtn: {
    backgroundColor: "#0078D4",
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
    shadowColor: "#0078D4",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  messageBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
  },
});
