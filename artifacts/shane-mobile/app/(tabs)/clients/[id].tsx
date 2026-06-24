import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

const SUB_TABS = ["Overview", "Health", "M365", "AI Actions", "Credentials"] as const;
type SubTab = typeof SUB_TABS[number];

interface ClientDetail {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  status: string | null;
  healthScore?: number | null;
  phone?: string | null;
  notes?: string | null;
  activeServices?: string[];
}

interface CommandCenter {
  licenses?: { name: string; count: number }[];
  readinessScore?: number;
  blockers?: string[];
  recommendations?: string[];
}

interface NBAction {
  id: number;
  title: string;
  description?: string;
  priority?: string;
}

interface Credential {
  id: number;
  label: string;
  tenantId?: string;
  clientId?: string;
  status?: string;
}

function healthColor(score: number | null | undefined, colors: ReturnType<typeof useColors>) {
  if (score === null || score === undefined) return colors.mutedForeground;
  if (score >= 75) return colors.success;
  if (score >= 50) return colors.warning;
  return colors.destructive;
}

export default function ClientDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SubTab>("Overview");
  const [refreshing, setRefreshing] = useState(false);
  const clientId = parseInt(id, 10);

  const { data: client, isLoading: clientLoading, error: clientError, refetch: refetchClient } = useQuery<ClientDetail>({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}`);
      if (!res.ok) throw new Error("Client not found");
      const json = await res.json() as { client?: ClientDetail } | ClientDetail;
      return ("client" in json ? json.client : json) as ClientDetail;
    },
    enabled: !isNaN(clientId),
  });

  const { data: commandCenter, isLoading: ccLoading, refetch: refetchCC } = useQuery<CommandCenter>({
    queryKey: ["client-command-center", clientId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/clients/${clientId}/command-center`);
      if (!res.ok) return {};
      return res.json() as Promise<CommandCenter>;
    },
    enabled: !isNaN(clientId) && activeTab === "M365",
  });

  const { data: actions, isLoading: actionsLoading, refetch: refetchActions } = useQuery<NBAction[]>({
    queryKey: ["client-nba", clientId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/ai/next-best-actions?entityType=client&entityId=${clientId}&status=pending`);
      if (!res.ok) return [];
      const json = await res.json() as { actions?: NBAction[] } | NBAction[];
      return Array.isArray(json) ? json : (json.actions ?? []);
    },
    enabled: !isNaN(clientId) && activeTab === "AI Actions",
  });

  const { data: credentials, isLoading: credLoading, refetch: refetchCred } = useQuery<Credential[]>({
    queryKey: ["client-credentials", clientId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/azure-credentials?clientId=${clientId}`);
      if (!res.ok) return [];
      const json = await res.json() as { credentials?: Credential[] } | Credential[];
      return Array.isArray(json) ? json : (json.credentials ?? []);
    },
    enabled: !isNaN(clientId) && activeTab === "Credentials",
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchClient(), refetchCC(), refetchActions(), refetchCred()]);
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const displayName = name ? decodeURIComponent(name) : (client?.name ?? client?.email ?? "Client");
  const initials = displayName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.topCenter}>
          <View style={[styles.topAvatar, { backgroundColor: colors.primary + "22" }]}>
            <Text style={[styles.topAvatarText, { color: colors.primary }]}>{initials || "C"}</Text>
          </View>
          <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/(tabs)/more/messages/${clientId}?name=${encodeURIComponent(displayName)}`)}
          hitSlop={8}
        >
          <Feather name="message-circle" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Sub-tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.subTabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        contentContainerStyle={styles.subTabContent}
      >
        {SUB_TABS.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[
              styles.subTab,
              activeTab === tab && [styles.subTabActive, { borderBottomColor: colors.primary }],
            ]}
          >
            <Text style={[styles.subTabText, { color: activeTab === tab ? colors.primary : colors.mutedForeground }]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {clientError ? (
        <ErrorBanner message="Could not load client" onRetry={refetchClient} />
      ) : clientLoading ? (
        <ListSkeleton count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === "Overview" && (
            <OverviewTab client={client} colors={colors} />
          )}
          {activeTab === "Health" && (
            <HealthTab clientId={clientId} fetchWithAuth={fetchWithAuth} colors={colors} />
          )}
          {activeTab === "M365" && (
            ccLoading ? <ListSkeleton count={3} /> : <M365Tab data={commandCenter} colors={colors} />
          )}
          {activeTab === "AI Actions" && (
            actionsLoading ? <ListSkeleton count={3} /> : <AIActionsTab actions={actions ?? []} colors={colors} onResolve={async (aid) => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              await fetchWithAuth(`/api/ai/next-best-actions/${aid}/resolve`, { method: "POST", body: JSON.stringify({ status: "resolved" }) });
              await refetchActions();
            }} />
          )}
          {activeTab === "Credentials" && (
            credLoading ? <ListSkeleton count={2} /> : <CredentialsTab
              credentials={credentials ?? []}
              colors={colors}
              onRun={() => router.push(`/(tabs)/more/script-runner?clientId=${clientId}`)}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

function OverviewTab({ client, colors }: { client: ClientDetail | undefined; colors: ReturnType<typeof useColors> }) {
  if (!client) return null;
  return (
    <View>
      <SectionHeader title="Client Info" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Card>
          <InfoRow label="Email" value={client.email} colors={colors} />
          {client.phone && <InfoRow label="Phone" value={client.phone} colors={colors} />}
          {client.company && <InfoRow label="Company" value={client.company} colors={colors} />}
          <InfoRow label="Status" value={client.status ?? "Active"} colors={colors} />
        </Card>
        {client.healthScore !== null && client.healthScore !== undefined && (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Health Score</Text>
              <Text style={{ color: healthColor(client.healthScore, colors), fontFamily: "Inter_700Bold", fontSize: 22 }}>
                {client.healthScore}%
              </Text>
            </View>
          </Card>
        )}
        {client.notes && (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 }}>NOTES</Text>
            <Text style={{ color: colors.text, fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 }}>{client.notes}</Text>
          </Card>
        )}
      </View>
    </View>
  );
}

function HealthTab({ clientId, fetchWithAuth, colors }: { clientId: number; fetchWithAuth: (p: string, i?: RequestInit) => Promise<Response>; colors: ReturnType<typeof useColors> }) {
  const { data, isLoading } = useQuery({
    queryKey: ["client-health", clientId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/clients/${clientId}/health/trends`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (isLoading) return <ListSkeleton count={3} />;

  const trends = (data as { scores?: { date: string; score: number }[] } | null)?.scores ?? [];

  return (
    <View>
      <SectionHeader title="Health Trend" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {trends.length === 0 ? (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center", padding: 16 }}>
              No health data available yet
            </Text>
          </Card>
        ) : (
          trends.slice(-7).map((t: { date: string; score: number }, i: number) => (
            <Card key={i}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {new Date(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </Text>
                <Text style={{ color: healthColor(t.score, colors), fontFamily: "Inter_700Bold", fontSize: 16 }}>
                  {t.score}%
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, marginTop: 8 }}>
                <View style={{ height: 4, width: `${t.score}%`, backgroundColor: healthColor(t.score, colors), borderRadius: 2 }} />
              </View>
            </Card>
          ))
        )}
      </View>
    </View>
  );
}

function M365Tab({ data, colors }: { data: CommandCenter | undefined; colors: ReturnType<typeof useColors> }) {
  return (
    <View>
      <SectionHeader title="M365 Profile" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {data?.readinessScore !== undefined && (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: 6 }}>
              READINESS SCORE
            </Text>
            <Text style={{ color: colors.primary, fontSize: 28, fontFamily: "Inter_700Bold" }}>
              {data.readinessScore}%
            </Text>
          </Card>
        )}
        {(data?.licenses?.length ?? 0) > 0 && (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: 8 }}>
              LICENSES
            </Text>
            {data?.licenses?.map((l, i) => (
              <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13 }}>{l.name}</Text>
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>{l.count}</Text>
              </View>
            ))}
          </Card>
        )}
        {(data?.blockers?.length ?? 0) > 0 && (
          <Card>
            <Text style={{ color: colors.warning, fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: 8 }}>
              BLOCKERS
            </Text>
            {data?.blockers?.map((b, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 3 }}>
                <Feather name="alert-triangle" size={13} color={colors.warning} />
                <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>{b}</Text>
              </View>
            ))}
          </Card>
        )}
        {(data?.recommendations?.length ?? 0) > 0 && (
          <Card>
            <Text style={{ color: colors.primary, fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, marginBottom: 8 }}>
              RECOMMENDATIONS
            </Text>
            {data?.recommendations?.map((r, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 3 }}>
                <Feather name="check-circle" size={13} color={colors.primary} />
                <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>{r}</Text>
              </View>
            ))}
          </Card>
        )}
        {!data?.readinessScore && !data?.licenses?.length && !data?.blockers?.length && (
          <Card>
            <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular", padding: 12 }}>
              M365 data not available — connect the Microsoft Graph integration first
            </Text>
          </Card>
        )}
      </View>
    </View>
  );
}

function AIActionsTab({ actions, colors, onResolve }: { actions: NBAction[]; colors: ReturnType<typeof useColors>; onResolve: (id: number) => Promise<void> }) {
  return (
    <View>
      <SectionHeader title="AI Recommendations" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {actions.length === 0 ? (
          <Card>
            <View style={{ alignItems: "center", padding: 16, gap: 8 }}>
              <Feather name="check-circle" size={24} color={colors.success} />
              <Text style={{ color: colors.text, fontFamily: "Inter_500Medium" }}>All caught up for this client</Text>
            </View>
          </Card>
        ) : actions.map((a) => (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{a.title}</Text>
                {a.description && (
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4, lineHeight: 18 }}>
                    {a.description}
                  </Text>
                )}
              </View>
              <Pressable onPress={() => void onResolve(a.id)} hitSlop={8}>
                <Feather name="check" size={18} color={colors.success} />
              </Pressable>
            </View>
            {a.priority === "high" && (
              <View style={{ marginTop: 8 }}>
                <Badge label="High priority" variant="danger" />
              </View>
            )}
          </Card>
        ))}
      </View>
    </View>
  );
}

function CredentialsTab({ credentials, colors, onRun }: { credentials: Credential[]; colors: ReturnType<typeof useColors>; onRun: () => void }) {
  return (
    <View>
      <SectionHeader title="Azure Credentials" />
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        {credentials.length === 0 ? (
          <Card>
            <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular", padding: 12 }}>
              No credentials stored for this client
            </Text>
          </Card>
        ) : credentials.map((c) => (
          <Card key={c.id}>
            <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{c.label}</Text>
            {c.tenantId && <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 3 }}>Tenant: {c.tenantId}</Text>}
            {c.status && <Badge label={c.status} variant={c.status === "active" ? "success" : "muted"} />}
          </Card>
        ))}
        <Pressable
          onPress={onRun}
          style={({ pressed }) => [
            styles.runBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Feather name="terminal" size={16} color={colors.primaryForeground} />
          <Text style={[styles.runBtnText, { color: colors.primaryForeground }]}>Run Script for Client</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border + "66" }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: "Inter_500Medium", fontSize: 13, flex: 1, textAlign: "right" }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  topCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  topAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  topAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  topTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", maxWidth: 180 },
  subTabBar: { borderBottomWidth: 1, maxHeight: 46 },
  subTabContent: { paddingHorizontal: 16, gap: 0 },
  subTab: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  subTabActive: {},
  subTabText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  scroll: { paddingTop: 4 },
  runBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 8,
  },
  runBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
