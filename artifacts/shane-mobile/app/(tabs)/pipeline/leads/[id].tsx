import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface LeadDetail {
  id: number;
  name: string | null;
  email: string;
  company?: string | null;
  phone?: string | null;
  source?: string | null;
  status: string;
  notes?: string | null;
  fitScore?: number | null;
  painScore?: number | null;
  maturityScore?: number | null;
  intentScore?: number | null;
  urgencyScore?: number | null;
  createdAt?: string;
}

interface AISignals {
  summary?: string;
  engagementLevel?: string;
  recommendedAction?: string;
  scores?: Record<string, number>;
}

function scoreBar(label: string, score: number | null | undefined, colors: ReturnType<typeof useColors>) {
  const s = score ?? 0;
  const color = s >= 70 ? colors.success : s >= 50 ? colors.warning : colors.destructive;
  return (
    <View key={label} style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>{label}</Text>
        <Text style={{ color, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{score ?? "—"}</Text>
      </View>
      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
        <View style={{ height: 4, width: `${Math.min(s, 100)}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const leadId = parseInt(id, 10);

  const { data: lead, isLoading, error, refetch } = useQuery<LeadDetail>({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/leads/${leadId}`);
      if (!res.ok) throw new Error("Lead not found");
      const json = await res.json() as { lead?: LeadDetail } | LeadDetail;
      return ("lead" in json ? json.lead : json) as LeadDetail;
    },
    enabled: !isNaN(leadId),
  });

  const { data: signals, isLoading: signalsLoading } = useQuery<AISignals>({
    queryKey: ["lead-signals", leadId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/leads/${leadId}/derive-signals`);
      if (!res.ok) return {};
      return res.json() as Promise<AISignals>;
    },
    enabled: !isNaN(leadId),
    staleTime: 300000,
  });

  const convertMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/leads/${leadId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "qualified" }),
      });
      if (!res.ok) throw new Error("Failed to qualify lead");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      void qc.invalidateQueries({ queryKey: ["lead", leadId] });
      Alert.alert("Lead Qualified", "Lead has been marked as qualified");
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          {lead?.name ?? lead?.email ?? "Lead"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {error ? (
        <ErrorBanner message="Could not load lead" onRetry={refetch} />
      ) : isLoading ? (
        <ListSkeleton count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Contact info */}
          <SectionHeader title="Contact" />
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Card>
              <View style={{ gap: 8 }}>
                <Row label="Email" value={lead?.email ?? ""} colors={colors} />
                {lead?.phone && <Row label="Phone" value={lead.phone} colors={colors} />}
                {lead?.company && <Row label="Company" value={lead.company} colors={colors} />}
                {lead?.source && <Row label="Source" value={lead.source} colors={colors} />}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>Status</Text>
                  <Badge label={lead?.status ?? "new"} variant={lead?.status === "qualified" ? "success" : lead?.status === "rejected" ? "danger" : "default"} size="md" />
                </View>
              </View>
            </Card>
          </View>

          {/* AI Scores */}
          <SectionHeader title="AI Scoring Panel" />
          <View style={{ paddingHorizontal: 16 }}>
            <Card elevated>
              {scoreBar("Fit Score", lead?.fitScore, colors)}
              {scoreBar("Pain Score", lead?.painScore, colors)}
              {scoreBar("Maturity Score", lead?.maturityScore, colors)}
              {scoreBar("Intent Score", lead?.intentScore, colors)}
              {scoreBar("Urgency Score", lead?.urgencyScore, colors)}
            </Card>
          </View>

          {/* AI Signals */}
          {signalsLoading ? null : signals && (
            <>
              <SectionHeader title="AI Analysis" />
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {signals.summary && (
                  <Card>
                    <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                      {signals.summary}
                    </Text>
                  </Card>
                )}
                {signals.recommendedAction && (
                  <Card>
                    <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>
                      RECOMMENDED ACTION
                    </Text>
                    <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                      {signals.recommendedAction}
                    </Text>
                  </Card>
                )}
              </View>
            </>
          )}

          {/* Notes */}
          {lead?.notes && (
            <>
              <SectionHeader title="Notes" />
              <View style={{ paddingHorizontal: 16 }}>
                <Card>
                  <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                    {lead.notes}
                  </Text>
                </Card>
              </View>
            </>
          )}

          {/* Actions */}
          <SectionHeader title="Actions" />
          <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
            {lead?.status !== "qualified" && (
              <Pressable
                onPress={() => Alert.alert(
                  "Qualify Lead",
                  `Mark ${lead?.name ?? lead?.email} as qualified?`,
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Qualify",
                      onPress: () => {
                        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        convertMutation.mutate();
                      },
                    },
                  ]
                )}
                style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="user-check" size={16} color="#fff" />
                <Text style={styles.actionBtnText}>Qualify Lead</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push(`/(tabs)/more/messages?prefill=true&email=${encodeURIComponent(lead?.email ?? "")}`)}
              style={({ pressed }) => [styles.actionBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="message-circle" size={16} color="#fff" />
              <Text style={styles.actionBtnText}>Send Message</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" }} numberOfLines={1}>{value}</Text>
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
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", marginHorizontal: 8 },
  scroll: {},
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13 },
  actionBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
