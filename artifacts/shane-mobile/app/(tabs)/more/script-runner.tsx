import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface Runbook {
  id: number;
  name: string;
  description?: string | null;
  governanceArea?: string | null;
}

interface RunbookJob {
  id: number;
  runbookId?: number;
  runbookName?: string | null;
  status: string;
  createdAt?: string;
  output?: string | null;
}

interface Client {
  id: number;
  name: string | null;
  email: string;
  company?: string | null;
}

interface AIAnalysis {
  summary?: string;
  risks?: string[];
  recommendations?: string[];
  nextSteps?: string[];
}

function timeAgo(str: string | undefined): string {
  if (!str) return "";
  const d = Math.floor((Date.now() - new Date(str).getTime()) / 60000);
  if (d < 1) return "now";
  if (d < 60) return `${d}m ago`;
  return `${Math.floor(d / 60)}h ago`;
}

export default function ScriptRunnerScreen() {
  const { clientId: presetClientId } = useLocalSearchParams<{ clientId?: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedClientId, setSelectedClientId] = useState<number | null>(presetClientId ? parseInt(presetClientId, 10) : null);
  const [selectedRunbookId, setSelectedRunbookId] = useState<number | null>(null);
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [jobStatus, setJobStatus] = useState<string>("");
  const [aiAnalysis, setAIAnalysis] = useState<AIAnalysis | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const outputScrollRef = useRef<ScrollView>(null);

  const { data: runbooks, isLoading: runbooksLoading, error: runbooksError } = useQuery<Runbook[]>({
    queryKey: ["runbooks"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/runbooks");
      if (!res.ok) throw new Error("Failed to load runbooks");
      const json = await res.json() as { runbooks?: Runbook[] } | Runbook[];
      return Array.isArray(json) ? json : (json.runbooks ?? []);
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["admin-clients-simple"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/clients");
      if (!res.ok) return [];
      const json = await res.json() as { clients?: Client[] } | Client[];
      return Array.isArray(json) ? json : (json.clients ?? []);
    },
  });

  const { data: history, refetch: refetchHistory } = useQuery<RunbookJob[]>({
    queryKey: ["runbook-history"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/runbook-jobs/history?limit=10");
      if (!res.ok) return [];
      const json = await res.json() as { jobs?: RunbookJob[] } | RunbookJob[];
      return Array.isArray(json) ? json : (json.jobs ?? []);
    },
    enabled: showHistory,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRunbookId) throw new Error("No runbook selected");
      const body: Record<string, unknown> = { runbookId: selectedRunbookId };
      if (selectedClientId) body.clientId = selectedClientId;
      const res = await fetchWithAuth("/api/admin/runbook-jobs", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to start job");
      return res.json() as Promise<{ jobId?: number; id?: number }>;
    },
    onSuccess: (data) => {
      const jobId = data.jobId ?? data.id;
      if (!jobId) return;
      setRunningJobId(jobId);
      setOutput(["Starting runbook…"]);
      setJobStatus("running");
      setAIAnalysis(null);
      startPolling(jobId);
    },
    onError: (err) => {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed to start runbook");
    },
  });

  const startPolling = useCallback((jobId: number) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetchWithAuth(`/api/admin/runbook-jobs/output?jobId=${jobId}`);
        if (!res.ok) return;
        const data = await res.json() as { output?: string | string[]; status?: string };
        const lines = Array.isArray(data.output) ? data.output : [data.output ?? ""].filter(Boolean);
        setOutput(lines as string[]);
        if (data.status) setJobStatus(data.status);
        if (data.status === "completed" || data.status === "failed") {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          void Haptics.notificationAsync(
            data.status === "completed" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
          );
          void refetchHistory();
        }
        setTimeout(() => outputScrollRef.current?.scrollToEnd({ animated: true }), 100);
      } catch {
        // Keep polling
      }
    }, 2000);
  }, [fetchWithAuth, refetchHistory]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const analyzeWithAI = async () => {
    if (!runningJobId) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const res = await fetchWithAuth("/api/admin/scripts/analyze", {
      method: "POST",
      body: JSON.stringify({ jobId: runningJobId, output: output.join("\n") }),
    });
    if (res.ok) {
      setAIAnalysis(await res.json() as AIAnalysis);
    }
  };

  const selectedRunbook = runbooks?.find((r) => r.id === selectedRunbookId);
  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Script Runner</Text>
        <Pressable onPress={() => { setShowHistory((v) => !v); if (!showHistory) void refetchHistory(); }}>
          <Feather name="clock" size={20} color={showHistory ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {runbooksError && <ErrorBanner message="Could not load runbooks" />}

        {/* Client picker */}
        <SectionHeader title="Client (optional)" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
          <Pressable
            onPress={() => setSelectedClientId(null)}
            style={[styles.chip, { borderColor: !selectedClientId ? colors.primary : colors.border, backgroundColor: !selectedClientId ? colors.primary + "18" : colors.card }]}
          >
            <Text style={[styles.chipText, { color: !selectedClientId ? colors.primary : colors.text }]}>None</Text>
          </Pressable>
          {clients?.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setSelectedClientId(c.id)}
              style={[styles.chip, { borderColor: selectedClientId === c.id ? colors.primary : colors.border, backgroundColor: selectedClientId === c.id ? colors.primary + "18" : colors.card }]}
            >
              <Text style={[styles.chipText, { color: selectedClientId === c.id ? colors.primary : colors.text }]}>
                {c.name ?? c.company ?? c.email}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Runbook picker */}
        <SectionHeader title="Runbook" />
        {runbooksLoading ? (
          <ListSkeleton count={3} />
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {(runbooks ?? []).map((rb) => (
              <Pressable
                key={rb.id}
                onPress={() => setSelectedRunbookId(rb.id)}
                style={[
                  styles.runbookCard,
                  {
                    backgroundColor: selectedRunbookId === rb.id ? colors.primary + "18" : colors.card,
                    borderColor: selectedRunbookId === rb.id ? colors.primary : colors.border,
                  },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.runbookName, { color: colors.text }]}>{rb.name}</Text>
                  {rb.description && (
                    <Text style={[styles.runbookDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{rb.description}</Text>
                  )}
                </View>
                {rb.governanceArea && <Badge label={rb.governanceArea} variant="info" />}
                {selectedRunbookId === rb.id && (
                  <Feather name="check-circle" size={16} color={colors.primary} />
                )}
              </Pressable>
            ))}
            {(runbooks?.length ?? 0) === 0 && (
              <Card>
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" }}>
                  No runbooks configured
                </Text>
              </Card>
            )}
          </View>
        )}

        {/* Run button */}
        <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
          <Pressable
            onPress={() => {
              if (!selectedRunbookId) {
                Alert.alert("Select a runbook", "Please select a runbook to run");
                return;
              }
              Alert.alert(
                "Confirm",
                `Run "${selectedRunbook?.name}"${selectedClient ? ` for ${selectedClient.name ?? selectedClient.email}` : ""}?`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Run",
                    style: "destructive",
                    onPress: () => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                      runMutation.mutate();
                    },
                  },
                ]
              );
            }}
            disabled={runMutation.isPending || jobStatus === "running"}
            style={({ pressed }) => [
              styles.runBtn,
              { backgroundColor: colors.primary },
              (runMutation.isPending || jobStatus === "running") && { opacity: 0.5 },
              pressed && { opacity: 0.8 },
            ]}
          >
            {runMutation.isPending || jobStatus === "running" ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather name="play" size={18} color={colors.primaryForeground} />
            )}
            <Text style={[styles.runBtnText, { color: colors.primaryForeground }]}>
              {jobStatus === "running" ? "Running…" : "Run Runbook"}
            </Text>
          </Pressable>
        </View>

        {/* Output console */}
        {output.length > 0 && (
          <>
            <View style={styles.consoleHeader}>
              <SectionHeader title="Live Output" />
              <Badge
                label={jobStatus || "running"}
                variant={jobStatus === "completed" ? "success" : jobStatus === "failed" ? "danger" : "info"}
              />
            </View>
            <ScrollView
              ref={outputScrollRef}
              style={[styles.console, { backgroundColor: "#000", borderColor: colors.border }]}
              nestedScrollEnabled
            >
              {output.map((line, i) => (
                <Text key={i} style={styles.consoleLine}>{line}</Text>
              ))}
            </ScrollView>

            {(jobStatus === "completed" || jobStatus === "failed") && (
              <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                <Pressable
                  onPress={() => void analyzeWithAI()}
                  style={({ pressed }) => [
                    styles.aiBtn,
                    { backgroundColor: colors.card, borderColor: colors.primary },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Feather name="cpu" size={16} color={colors.primary} />
                  <Text style={[styles.aiBtnText, { color: colors.primary }]}>Analyze with AI</Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {/* AI Analysis */}
        {aiAnalysis && (
          <>
            <SectionHeader title="AI Analysis" />
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              {aiAnalysis.summary && (
                <Card elevated>
                  <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>{aiAnalysis.summary}</Text>
                </Card>
              )}
              {(aiAnalysis.risks?.length ?? 0) > 0 && (
                <Card>
                  <Text style={{ color: colors.warning, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>RISKS</Text>
                  {aiAnalysis.risks?.map((r, i) => (
                    <Text key={i} style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13 }}>• {r}</Text>
                  ))}
                </Card>
              )}
              {(aiAnalysis.nextSteps?.length ?? 0) > 0 && (
                <Card>
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 6 }}>NEXT STEPS</Text>
                  {aiAnalysis.nextSteps?.map((s, i) => (
                    <Text key={i} style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13 }}>• {s}</Text>
                  ))}
                </Card>
              )}
            </View>
          </>
        )}

        {/* History */}
        {showHistory && (
          <>
            <SectionHeader title="Job History" />
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              {(history ?? []).map((job) => (
                <Pressable
                  key={job.id}
                  style={[styles.historyRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => {
                    setRunningJobId(job.id);
                    if (job.output) setOutput([job.output]);
                    setJobStatus(job.status);
                    setAIAnalysis(null);
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.historyName, { color: colors.text }]}>{job.runbookName ?? `Job #${job.id}`}</Text>
                    <Text style={[styles.historyTime, { color: colors.mutedForeground }]}>{timeAgo(job.createdAt)}</Text>
                  </View>
                  <Badge label={job.status} variant={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "info"} />
                </Pressable>
              ))}
              {(history?.length ?? 0) === 0 && (
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular", padding: 12 }}>
                  No job history yet
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1 },
  scroll: {},
  pickerRow: { paddingHorizontal: 16, paddingBottom: 4, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5 },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  runbookCard: { borderRadius: 14, padding: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  runbookName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  runbookDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3, lineHeight: 17 },
  runBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14 },
  runBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  consoleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 16 },
  console: { marginHorizontal: 16, borderRadius: 10, padding: 12, maxHeight: 250, borderWidth: 1 },
  consoleLine: { color: "#00FF41", fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 18, fontVariant: ["tabular-nums"] },
  aiBtn: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1.5 },
  aiBtnText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  historyRow: { borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", borderWidth: 1 },
  historyName: { fontSize: 13, fontFamily: "Inter_500Medium" },
  historyTime: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
});
