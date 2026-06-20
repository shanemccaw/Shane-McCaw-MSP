import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function MessageBubble({ msg, isShane }: { msg: Message; isShane: boolean }) {
  return (
    <View style={[styles.bubbleWrapper, isShane ? styles.bubbleRight : styles.bubbleLeft]}>
      <View style={[styles.bubble, isShane ? styles.shaneBubble : styles.clientBubble]}>
        <Text style={[styles.bubbleText, isShane ? styles.shaneBubbleText : styles.clientBubbleText]}>
          {msg.body}
        </Text>
      </View>
      <Text style={[styles.bubbleTime, isShane ? styles.bubbleTimeRight : styles.bubbleTimeLeft]}>
        {formatTime(msg.createdAt)}
      </Text>
    </View>
  );
}

export default function ConversationScreen() {
  const { clientId, name } = useLocalSearchParams<{ clientId: string; name?: string }>();
  const { fetchWithAuth } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);
  const clientIdNum = parseInt(clientId, 10);

  // Clear the app icon badge whenever Shane opens a conversation
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

  useEffect(() => {
    if (messages) {
      void qc.invalidateQueries({ queryKey: ["admin-conversations"] });
    }
  }, [messages, qc]);

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
      qc.setQueryData<Message[]>(["admin-messages", clientIdNum], (old) => [
        ...(old ?? []),
        optimistic,
      ]);
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["admin-messages", clientIdNum], ctx.prev);
      }
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
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color="#0A2540" />
        </Pressable>
        <View style={styles.topCenter}>
          <View style={styles.topAvatar}>
            <Text style={styles.topAvatarText}>
              {displayName[0]?.toUpperCase() ?? "C"}
            </Text>
          </View>
          <Text style={styles.topTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {isLoading && !messages ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#0078D4" />
          </View>
        ) : (
          <FlatList
            data={reversed}
            keyExtractor={(item) => String(item.id)}
            renderItem={({ item }) => {
              const isShane = item.senderUserId !== item.clientUserId;
              return <MessageBubble msg={item} isShane={isShane} />;
            }}
            inverted
            contentContainerStyle={styles.msgList}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!!messages && messages.length > 0}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Feather name="message-circle" size={40} color="#D6E0EC" />
                <Text style={styles.emptyChatText}>
                  Start the conversation
                </Text>
              </View>
            }
          />
        )}

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <TextInput
            ref={inputRef}
            style={styles.textInput}
            placeholder="Message…"
            placeholderTextColor="#8FA3B8"
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
              (!text.trim() || sendMutation.isPending) && styles.sendBtnDisabled,
              pressed && text.trim() && styles.sendBtnPressed,
            ]}
            onPress={handleSend}
            disabled={!text.trim() || sendMutation.isPending}
            testID="send-button"
          >
            {sendMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Feather name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9FC",
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F7",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#F7F9FC",
    alignItems: "center",
    justifyContent: "center",
  },
  topCenter: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  topAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#0A2540",
    alignItems: "center",
    justifyContent: "center",
  },
  topAvatarText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  topTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    maxWidth: 180,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  msgList: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
  },
  bubbleWrapper: {
    marginBottom: 10,
    maxWidth: "80%",
  },
  bubbleLeft: {
    alignSelf: "flex-start",
  },
  bubbleRight: {
    alignSelf: "flex-end",
  },
  bubble: {
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  shaneBubble: {
    backgroundColor: "#0078D4",
    borderBottomRightRadius: 4,
  },
  clientBubble: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 4,
    shadowColor: "#0A2540",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  shaneBubbleText: {
    color: "#FFFFFF",
  },
  clientBubbleText: {
    color: "#0A2540",
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "#9DB4C8",
    marginTop: 3,
  },
  bubbleTimeLeft: {
    paddingLeft: 4,
  },
  bubbleTimeRight: {
    textAlign: "right",
    paddingRight: 4,
  },
  emptyChat: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 12,
  },
  emptyChatText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#9DB4C8",
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#EEF2F7",
    gap: 8,
  },
  textInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: "#F7F9FC",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#0A2540",
    borderWidth: 1.5,
    borderColor: "#D6E0EC",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#0078D4",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0078D4",
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  sendBtnDisabled: {
    backgroundColor: "#C5D5E8",
    shadowOpacity: 0,
    elevation: 0,
  },
  sendBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
});
