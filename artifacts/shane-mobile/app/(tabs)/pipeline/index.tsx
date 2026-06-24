import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

type PipelineTab = "Leads" | "Opportunities" | "Quiz Leads";

interface Lead {
  id: number;
  name: string | null;
  email: string;
  company?: string | null;
  status: string;
  source?: string | null;
  fitScore?: number | null;
  createdAt?: string;
}

interface Opportunity {
  id: number;
  name: string;
  clientName?: string | null;
  stage?: string | null;
  value?: number | null;
  fitScore?: number | null;
  painScore?: number | null;
  urgencyScore?: number | null;
  workflowType?: string | null;
  createdAt?: string;
}

interface QuizLead {
  id: number;
  contactName?: string | null;
  contactEmail?: string | null;
  quizType?: string | null;
  tier?: string | null;
  totalScore?: number | null;
  contacted?: boolean | null;
  createdAt?: string;
}

function scoreColor(score: number | null | undefined, colors: ReturnType<typeof useColors>) {
  if (!score) return colors.mutedForeground;
  if (score >= 75) return colors.success;
  if (score >= 50) return colors.warning;
  return colors.destructive;
}

function fmt(n: number | undefined | null): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function timeAgo(str: string | undefined): string {
  if (!str) return "";
  const d = Math.floor((Date.now() - new Date(str).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PipelineScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<PipelineTab>("Leads");
  const [refreshing, setRefreshing] = useState(false);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: leads, isLoading: leadsLoading, error: leadsError, refetch: refetchLeads } = useQuery<Lead[]>({
    queryKey: ["leads"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/leads?limit=50");
      if (!res.ok) throw new Error("Failed to load leads");
      const json = await res.json() as { leads?: Lead[] } | Lead[];
      return Array.isArray(json) ? json : (json.leads ?? []);
    },
    staleTime: 60000,
  });

  const { data: opps, isLoading: oppsLoading, error: oppsError, refetch: refetchOpps } = useQuery<Opportunity[]>({
    queryKey: ["opportunities"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/opportunities?limit=50");
      if (!res.ok) throw new Error("Failed to load opportunities");
      const json = await res.json() as { opportunities?: Opportunity[] } | Opportunity[];
      return Array.isArray(json) ? json : (json.opportunities ?? []);
    },
    staleTime: 60000,
  });

  const { data: quizLeads, isLoading: quizLoading, error: quizError, refetch: refetchQuiz } = useQuery<QuizLead[]>({
    queryKey: ["quiz-leads"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/quiz-leads?limit=50");
      if (!res.ok) throw new Error("Failed to load quiz leads");
      const json = await res.json() as { leads?: QuizLead[] } | QuizLead[];
      return Array.isArray(json) ? json : (json.leads ?? []);
    },
    staleTime: 60000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchLeads(), refetchOpps(), refetchQuiz()]);
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetchLeads, refetchOpps, refetchQuiz]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Pipeline</Text>
      </View>

      {/* Funnel summary */}
      <View style={[styles.funnelRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.funnelItem}>
          <Text style={[styles.funnelNum, { color: colors.primary }]}>{leads?.length ?? "—"}</Text>
          <Text style={[styles.funnelLabel, { color: colors.mutedForeground }]}>Leads</Text>
        </View>
        <View style={[styles.funnelDivider, { backgroundColor: colors.border }]} />
        <View style={styles.funnelItem}>
          <Text style={[styles.funnelNum, { color: colors.primary }]}>{opps?.length ?? "—"}</Text>
          <Text style={[styles.funnelLabel, { color: colors.mutedForeground }]}>Opps</Text>
        </View>
        <View style={[styles.funnelDivider, { backgroundColor: colors.border }]} />
        <View style={styles.funnelItem}>
          <Text style={[styles.funnelNum, { color: colors.primary }]}>{quizLeads?.length ?? "—"}</Text>
          <Text style={[styles.funnelLabel, { color: colors.mutedForeground }]}>Quiz</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {(["Leads", "Opportunities", "Quiz Leads"] as PipelineTab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setActiveTab(t)}
            style={[styles.tabBtn, activeTab === t && [styles.tabBtnActive, { borderBottomColor: colors.primary }]]}
          >
            <Text style={[styles.tabBtnText, { color: activeTab === t ? colors.primary : colors.mutedForeground }]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "Leads" && (
        leadsError ? <ErrorBanner message="Could not load leads" onRetry={refetchLeads} /> :
        leadsLoading ? <ListSkeleton count={4} /> :
        <FlatList
          data={leads ?? []}
          keyExtractor={(l) => String(l.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/(tabs)/pipeline/leads/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.name ?? item.email}</Text>
                <Badge label={item.status} variant={item.status === "qualified" ? "success" : item.status === "rejected" ? "danger" : "default"} />
              </View>
              {item.company && <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{item.company}</Text>}
              <View style={styles.cardMeta}>
                {item.fitScore !== null && item.fitScore !== undefined && (
                  <Text style={{ color: scoreColor(item.fitScore, colors), fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                    Fit {item.fitScore}%
                  </Text>
                )}
                {item.source && <Badge label={item.source} variant="muted" />}
                <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (leads?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={<EmptyState icon="user-plus" title="No leads yet" subtitle="Leads will appear as inquiries come in" />}
        />
      )}

      {activeTab === "Opportunities" && (
        oppsError ? <ErrorBanner message="Could not load opportunities" onRetry={refetchOpps} /> :
        oppsLoading ? <ListSkeleton count={4} /> :
        <FlatList
          data={opps ?? []}
          keyExtractor={(o) => String(o.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/(tabs)/pipeline/opportunities/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.cardValue, { color: colors.success }]}>{fmt(item.value)}</Text>
              </View>
              {item.clientName && <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>{item.clientName}</Text>}
              <View style={styles.cardMeta}>
                {item.stage && <Badge label={item.stage} variant="info" />}
                {item.fitScore !== null && item.fitScore !== undefined && (
                  <Text style={{ color: scoreColor(item.fitScore, colors), fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                    Score {item.fitScore}%
                  </Text>
                )}
                <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (opps?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={<EmptyState icon="trending-up" title="No opportunities" subtitle="Qualified leads become opportunities" />}
        />
      )}

      {activeTab === "Quiz Leads" && (
        quizError ? <ErrorBanner message="Could not load quiz leads" onRetry={refetchQuiz} /> :
        quizLoading ? <ListSkeleton count={4} /> :
        <FlatList
          data={quizLeads ?? []}
          keyExtractor={(q) => String(q.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
              onPress={() => router.push(`/(tabs)/pipeline/quiz/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{item.contactName ?? item.contactEmail ?? "Anonymous"}</Text>
                {item.totalScore !== null && item.totalScore !== undefined && (
                  <Text style={[styles.cardValue, { color: scoreColor(item.totalScore, colors) }]}>{item.totalScore}%</Text>
                )}
              </View>
              <View style={styles.cardMeta}>
                {item.quizType && <Badge label={item.quizType} variant="info" />}
                {item.tier && <Badge label={`Tier ${item.tier}`} variant="default" />}
                <Badge label={item.contacted ? "Contacted" : "New"} variant={item.contacted ? "success" : "warning"} />
                <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (quizLeads?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={<EmptyState icon="help-circle" title="No quiz leads" subtitle="Quiz submissions will appear here" />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  funnelRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1 },
  funnelItem: { flex: 1, alignItems: "center" },
  funnelNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  funnelLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  funnelDivider: { width: 1, marginVertical: 4 },
  tabBar: { flexDirection: "row", borderBottomWidth: 1 },
  tabBtn: { flex: 1, paddingVertical: 11, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnActive: {},
  tabBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { padding: 16, gap: 8, paddingBottom: 100 },
  card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 4 },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  cardTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: "auto" },
  cardValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
});
