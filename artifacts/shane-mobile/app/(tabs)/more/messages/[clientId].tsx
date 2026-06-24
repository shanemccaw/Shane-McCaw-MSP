import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Message {
  id: number;
  clientUserId: number;
  senderUserId: number;
  body: string;
  readByAdmin: boolean;
  readByClient: boolean;
  createdAt: string;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ConversationScreen() {
  const { clientId, name } = useLocalSearchParams<{ clientId: string; name?: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);
  const clientIdNum = parseInt(clientId, 10);

  useFocusEffect(
    useCallback(() => {
      Notifications.setBadgeCountAsync(0).catch(() => null);
    }, []),
  );

  const { data: messages, isLoading } = useQuery<Message[]>({
    queryKey: ["admin-messages", clientIdNum],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/messages?clientId=${clientIdNum}`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<Message[]>;
    },
    refetchInterval: 8000,
    enabled: !isNaN(clientIdNum),
  });

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetchWithAuth("/api/portal/messages", {
        method: "POST",
        body: JSON.stringify({ body, clientId: clientIdNum }),
      });
      if (!res.ok) throw new Error("Send failed");
      return res.json() as Promise<Message>;
    },
    onMutate: async (body) => {
      const optimistic: Message = {
        id: Date.now(),
        clientUserId: clientIdNum,
        senderUserId: -1,
        body,
        readByAdmin: true,
        readByClient: false,
        createdAt: new Date().toISOString(),
      };
      await qc.cancelQueries({ queryKey: ["admin-messages", clientIdNum] });
      const prev = qc.getQueryData<Message[]>(["admin-messages", clientIdNum]);
      qc.setQueryData<Message[]>(["admin-messages", clientIdNum], (old) => [...(old ?? []), optimistic]);
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(["admin-messages", clientIdNum], ctx.prev);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-messages", clientIdNum] });
      void qc.invalidateQueries({ queryKey: ["admin-conversations"] });
    },
  });

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sendMutation.isPending) return;
    setText("");
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMutation.mutate(body);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [text, sendMutation]);

  const reversed = messages ? [...messages].reverse() : [];
  const displayName = name ? decodeURIComponent(name) : "Client";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.topCenter}>
          <View style={[styles.topAvatar, { backgroundColor: colors.primary + "22" }]}>
            <Text style={[styles.topAvatarText, { color: colors.primary }]}>
              {displayName[0]?.toUpperCase() ?? "C"}
            </Text>
          </View>
          <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>{displayName}</Text>
        </View>
        <Pressable
          onPress={() => router.push(`/(tabs)/clients/${clientIdNum}?name=${encodeURIComponent(displayName)}`)}
          hitSlop={8}
        >
          <Feather name="user" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={0}>
        {isLoading && !messages ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={reversed}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => {
              const isShane = item.senderUserId !== item.clientUserId;
              return (
                <View style={[styles.bubbleWrapper, isShane ? styles.bubbleRight : styles.bubbleLeft]}>
                  <View style={[
                    styles.bubble,
                    isShane
                      ? [styles.shaneBubble, { backgroundColor: colors.primary }]
                      : [styles.clientBubble, { backgroundColor: colors.card, borderColor: colors.border }],
                  ]}>
                    <Text style={[styles.bubbleText, { color: isShane ? colors.primaryForeground : colors.text }]}>
                      {item.body}
                    </Text>
                  </View>
                  <Text style={[styles.bubbleTime, { color: colors.mutedForeground }, isShane ? styles.bubbleTimeRight : styles.bubbleTimeLeft]}>
                    {formatTime(item.createdAt)}
                  </Text>
                </View>
              );
            }}
            inverted
            contentContainerStyle={styles.msgList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Feather name="message-circle" size={40} color={colors.border} />
                <Text style={[styles.emptyChatText, { color: colors.mutedForeground }]}>Start the conversation</Text>
              </View>
            }
          />
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8, backgroundColor: colors.card, borderTopColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            style={[styles.textInput, { backgroundColor: colors.secondary, borderColor: colors.border, color: colors.text }]}
            placeholder="Message…"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
            returnKeyType="send"
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: colors.primary },
              (!text.trim() || sendMutation.isPending) && [styles.sendBtnDisabled, { backgroundColor: colors.border }],
              pressed && text.trim() && { opacity: 0.8 },
            ]}
            onPress={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Feather name="send" size={18} color={!text.trim() ? colors.mutedForeground : colors.primaryForeground} />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  topCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  topAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  topAvatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  topTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", maxWidth: 180 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  msgList: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  bubbleWrapper: { marginBottom: 10, maxWidth: "80%" },
  bubbleLeft: { alignSelf: "flex-start" },
  bubbleRight: { alignSelf: "flex-end" },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  shaneBubble: { borderBottomRightRadius: 4 },
  clientBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 3 },
  bubbleTimeLeft: { paddingLeft: 4 },
  bubbleTimeRight: { textAlign: "right", paddingRight: 4 },
  emptyChat: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyChatText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, gap: 8 },
  textInput: { flex: 1, minHeight: 44, maxHeight: 120, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, fontSize: 15, fontFamily: "Inter_400Regular", borderWidth: 1.5 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sendBtnDisabled: {},
});
