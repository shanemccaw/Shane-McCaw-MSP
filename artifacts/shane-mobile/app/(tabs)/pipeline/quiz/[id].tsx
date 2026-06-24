import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  Alert,
  Pressable,
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

interface QuizLeadDetail {
  id: number;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactCompany?: string | null;
  quizType?: string | null;
  tier?: string | null;
  totalScore?: number | null;
  contacted?: boolean | null;
  createdAt?: string;
  categoryBreakdown?: Record<string, number>;
  aiAnalysis?: string | null;
  transcript?: { question: string; answer: string }[];
}

function scoreColor(s: number | null | undefined, colors: ReturnType<typeof useColors>) {
  if (!s) return colors.mutedForeground;
  if (s >= 75) return colors.success;
  if (s >= 50) return colors.warning;
  return colors.destructive;
}

export default function QuizLeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const quizId = parseInt(id, 10);

  const { data, isLoading, error, refetch } = useQuery<QuizLeadDetail>({
    queryKey: ["quiz-lead", quizId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/quiz-leads/${quizId}`);
      if (!res.ok) throw new Error("Quiz lead not found");
      const json = await res.json() as { lead?: QuizLeadDetail } | QuizLeadDetail;
      return ("lead" in json ? json.lead : json) as QuizLeadDetail;
    },
    enabled: !isNaN(quizId),
  });

  const markContactedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/quiz-leads/${quizId}`, {
        method: "PATCH",
        body: JSON.stringify({ contacted: true }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quiz-lead", quizId] });
      void qc.invalidateQueries({ queryKey: ["quiz-leads"] });
    },
  });

  const createLeadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          name: data?.contactName,
          email: data?.contactEmail,
          company: data?.contactCompany,
          phone: data?.contactPhone,
          source: "quiz",
        }),
      });
      if (!res.ok) throw new Error("Failed to create lead");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["leads"] });
      Alert.alert("Lead Created", "This quiz submission has been converted to a lead");
    },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          {data?.contactName ?? data?.contactEmail ?? "Quiz Lead"}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {error ? (
        <ErrorBanner message="Could not load quiz lead" onRetry={refetch} />
      ) : isLoading ? (
        <ListSkeleton count={4} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {/* Contact */}
          <SectionHeader title="Contact" />
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Card>
              {data?.contactEmail && <InfoRow label="Email" value={data.contactEmail} colors={colors} />}
              {data?.contactPhone && <InfoRow label="Phone" value={data.contactPhone} colors={colors} />}
              {data?.contactCompany && <InfoRow label="Company" value={data.contactCompany} colors={colors} />}
              {data?.quizType && <InfoRow label="Quiz Type" value={data.quizType} colors={colors} />}
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 6 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>Contacted</Text>
                <Badge label={data?.contacted ? "Yes" : "Not yet"} variant={data?.contacted ? "success" : "warning"} />
              </View>
            </Card>
          </View>

          {/* Score */}
          <SectionHeader title="Score" />
          <View style={{ paddingHorizontal: 16 }}>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
                <Text style={{ color: scoreColor(data?.totalScore, colors), fontSize: 40, fontFamily: "Inter_700Bold" }}>
                  {data?.totalScore ?? "—"}
                </Text>
                <View style={{ flex: 1 }}>
                  {data?.tier && <Badge label={`Tier ${data.tier}`} variant="info" size="md" />}
                </View>
              </View>
              {data?.categoryBreakdown && Object.entries(data.categoryBreakdown).map(([cat, score]) => (
                <View key={cat} style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>{cat}</Text>
                    <Text style={{ color: scoreColor(score as number, colors), fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{score}</Text>
                  </View>
                  <View style={{ height: 3, backgroundColor: colors.border, borderRadius: 1 }}>
                    <View style={{ height: 3, width: `${Math.min(score as number, 100)}%`, backgroundColor: scoreColor(score as number, colors), borderRadius: 1 }} />
                  </View>
                </View>
              ))}
            </Card>
          </View>

          {/* AI Analysis */}
          {data?.aiAnalysis && (
            <>
              <SectionHeader title="AI Analysis" />
              <View style={{ paddingHorizontal: 16 }}>
                <Card elevated>
                  <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                    {data.aiAnalysis}
                  </Text>
                </Card>
              </View>
            </>
          )}

          {/* Transcript */}
          {(data?.transcript?.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Quiz Answers" />
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {data?.transcript?.map((item, i) => (
                  <Card key={i}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 4 }}>
                      {item.question}
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
                      {item.answer}
                    </Text>
                  </Card>
                ))}
              </View>
            </>
          )}

          {/* Actions */}
          <SectionHeader title="Actions" />
          <View style={{ paddingHorizontal: 16, gap: 8, marginBottom: 16 }}>
            {!data?.contacted && (
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  markContactedMutation.mutate();
                }}
                style={({ pressed }) => [styles.btn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
              >
                <Feather name="phone" size={16} color={colors.primaryForeground} />
                <Text style={[styles.btnText, { color: colors.primaryForeground }]}>Mark as Contacted</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => Alert.alert(
                "Create Lead",
                `Convert ${data?.contactName ?? data?.contactEmail} to a lead?`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Create", onPress: () => createLeadMutation.mutate() },
                ]
              )}
              style={({ pressed }) => [styles.btn, { backgroundColor: colors.success, opacity: pressed ? 0.8 : 1 }]}
            >
              <Feather name="user-plus" size={16} color="#fff" />
              <Text style={[styles.btnText, { color: "#fff" }]}>Create Lead</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border + "55" }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>{label}</Text>
      <Text style={{ color: colors.text, fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, textAlign: "right" }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", marginHorizontal: 8 },
  scroll: {},
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13 },
  btnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
});
