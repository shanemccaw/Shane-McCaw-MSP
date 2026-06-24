import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface Task {
  id: number;
  title: string;
  status: string;
  dueDate?: string | null;
  priority?: string | null;
}

interface ProjectDetail {
  id: number;
  name: string;
  clientName?: string | null;
  clientId?: number | null;
  status: string;
  phase?: string | null;
  progress?: number | null;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  tasks?: Task[];
}

const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;

function taskStatusVariant(s: string) {
  if (s === "done") return "success" as const;
  if (s === "in_progress") return "info" as const;
  if (s === "review") return "warning" as const;
  return "muted" as const;
}

function priorityColor(p: string | null | undefined, colors: ReturnType<typeof useColors>) {
  if (p === "high") return colors.destructive;
  if (p === "medium") return colors.warning;
  return colors.mutedForeground;
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const projectId = parseInt(id, 10);

  const { data: project, isLoading, error, refetch } = useQuery<ProjectDetail>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/engagement-projects/${projectId}`);
      if (!res.ok) throw new Error("Project not found");
      const json = await res.json() as { project?: ProjectDetail } | ProjectDetail;
      return ("project" in json ? json.project : json) as ProjectDetail;
    },
    enabled: !isNaN(projectId),
  });

  const { data: aiSummary, isLoading: aiLoading, refetch: refetchAI } = useQuery<{ summary?: string; risks?: string[]; nextSteps?: string[] }>({
    queryKey: ["project-ai-summary", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/status-reports/ai-draft", {
        method: "POST",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: showAI && !isNaN(projectId),
    staleTime: 300000,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: string }) => {
      const res = await fetchWithAuth(`/api/admin/engagement-projects/${projectId}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update task");
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    if (showAI) await refetchAI();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch, refetchAI, showAI]);

  const tasks = project?.tasks ?? [];
  const tasksByStatus = TASK_STATUSES.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s] = tasks.filter((t) => t.status === s);
    return acc;
  }, {});

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          {project?.name ?? "Project"}
        </Text>
        <Pressable onPress={() => setShowAI((v) => !v)} hitSlop={8}>
          <Feather name="cpu" size={22} color={showAI ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>

      {error ? (
        <ErrorBanner message="Could not load project" onRetry={refetch} />
      ) : isLoading ? (
        <ListSkeleton count={4} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Header card */}
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Card>
              <View style={styles.projHeader}>
                <View style={{ flex: 1 }}>
                  <Badge label={project?.status?.replace("_", " ") ?? "active"} variant={project?.status === "active" ? "success" : "muted"} />
                  {project?.phase && (
                    <Text style={[styles.projPhase, { color: colors.mutedForeground }]}>Phase: {project.phase}</Text>
                  )}
                </View>
                {project?.progress !== null && project?.progress !== undefined && (
                  <Text style={[styles.projProgress, { color: colors.primary }]}>{project.progress}%</Text>
                )}
              </View>
              {project?.clientName && (
                <Text style={[styles.projClient, { color: colors.mutedForeground }]}>
                  <Feather name="users" size={12} /> {project.clientName}
                </Text>
              )}
              {project?.dueDate && (
                <Text style={[styles.projDue, { color: colors.mutedForeground }]}>
                  Due: {new Date(project.dueDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </Text>
              )}
            </Card>
          </View>

          {/* AI Summary */}
          {showAI && (
            <>
              <SectionHeader title="AI Weekly Summary" />
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                {aiLoading ? (
                  <Card><ActivityIndicator size="small" color={colors.primary} /></Card>
                ) : (
                  <Card elevated>
                    {aiSummary?.summary && (
                      <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                        {aiSummary.summary}
                      </Text>
                    )}
                    {(aiSummary?.risks?.length ?? 0) > 0 && (
                      <View style={{ marginTop: 10 }}>
                        <Text style={{ color: colors.warning, fontFamily: "Inter_600SemiBold", fontSize: 12, marginBottom: 4 }}>RISKS</Text>
                        {aiSummary?.risks?.map((r, i) => (
                          <Text key={i} style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 18 }}>• {r}</Text>
                        ))}
                      </View>
                    )}
                    {!aiSummary?.summary && !aiSummary?.risks?.length && (
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
                        No AI summary available yet
                      </Text>
                    )}
                  </Card>
                )}
              </View>
            </>
          )}

          {/* Kanban */}
          <SectionHeader
            title="Tasks"
            right={
              <Pressable
                onPress={() => Alert.alert("Add Task", "Use the web Admin Panel to add tasks to this project")}
              >
                <Feather name="plus" size={18} color={colors.primary} />
              </Pressable>
            }
          />
          {TASK_STATUSES.map((status) => {
            const statusTasks = tasksByStatus[status] ?? [];
            if (statusTasks.length === 0) return null;
            return (
              <View key={status} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                <Text style={[styles.kanbanLabel, { color: colors.mutedForeground }]}>
                  {status.replace("_", " ").toUpperCase()} · {statusTasks.length}
                </Text>
                <View style={{ gap: 6, marginTop: 6 }}>
                  {statusTasks.map((task) => (
                    <Pressable
                      key={task.id}
                      style={[styles.taskCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => {
                        const nextStatus = status === "todo" ? "in_progress" : status === "in_progress" ? "review" : status === "review" ? "done" : "todo";
                        Alert.alert(
                          "Update Task",
                          `Move "${task.title}" to ${nextStatus.replace("_", " ")}?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Move",
                              onPress: () => {
                                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                updateTaskMutation.mutate({ taskId: task.id, status: nextStatus });
                              },
                            },
                          ]
                        );
                      }}
                    >
                      <View style={styles.taskRow}>
                        <View style={[styles.priorityDot, { backgroundColor: priorityColor(task.priority, colors) }]} />
                        <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={2}>{task.title}</Text>
                        <Badge label={status.replace("_", " ")} variant={taskStatusVariant(status)} size="sm" />
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}

          {tasks.length === 0 && (
            <View style={{ alignItems: "center", padding: 24 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
                No tasks yet. Add tasks from the web Admin Panel.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
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
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", marginHorizontal: 8 },
  scroll: {},
  projHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  projProgress: { fontSize: 28, fontFamily: "Inter_700Bold" },
  projPhase: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  projClient: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 6 },
  projDue: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 3 },
  kanbanLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  taskCard: { borderRadius: 10, padding: 12, borderWidth: 1 },
  taskRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  priorityDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  taskTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
});
