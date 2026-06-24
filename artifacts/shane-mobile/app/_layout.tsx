import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { Redirect, Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toast } from "@/components/Toast";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

SplashScreen.preventAutoHideAsync();

// Register all 8 notification categories
async function registerNotificationCategories() {
  const categories: Array<{ id: string; actions: Notifications.NotificationAction[] }> = [
    {
      id: "MESSAGE",
      actions: [
        {
          identifier: "REPLY",
          buttonTitle: "Reply",
          textInput: { submitButtonTitle: "Send", placeholder: "Message…" },
        },
        { identifier: "MARK_READ", buttonTitle: "Mark Read" },
      ],
    },
    {
      id: "NEW_LEAD",
      actions: [
        { identifier: "VIEW_LEAD", buttonTitle: "View Lead" },
        { identifier: "CONVERT", buttonTitle: "Qualify" },
      ],
    },
    {
      id: "RUNBOOK_COMPLETED",
      actions: [
        { identifier: "VIEW_RESULTS", buttonTitle: "View Results" },
        { identifier: "ANALYZE_AI", buttonTitle: "Analyze with AI" },
      ],
    },
    {
      id: "HEALTH_ALERT",
      actions: [
        { identifier: "VIEW_CLIENT", buttonTitle: "View Client" },
        { identifier: "RUN_SCRIPT", buttonTitle: "Run Script" },
      ],
    },
    {
      id: "NEXT_BEST_ACTION",
      actions: [
        { identifier: "MARK_DONE", buttonTitle: "Mark Done" },
        { identifier: "SNOOZE", buttonTitle: "Snooze" },
      ],
    },
    {
      id: "STRIPE_PURCHASE",
      actions: [{ identifier: "VIEW_PURCHASE", buttonTitle: "View Purchase" }],
    },
    {
      id: "CONTRACT_SIGNED",
      actions: [{ identifier: "VIEW_CONTRACT", buttonTitle: "View Contract" }],
    },
    {
      id: "QUIZ_LEAD",
      actions: [
        { identifier: "VIEW_QUIZ", buttonTitle: "View Lead" },
        { identifier: "CREATE_LEAD", buttonTitle: "Create Lead" },
      ],
    },
  ];

  await Promise.allSettled(
    categories.map((cat) =>
      Notifications.setNotificationCategoryAsync(cat.id, cat.actions)
    )
  );
}

registerNotificationCategories().catch(() => null);

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});

function PushSetup() {
  const { user, fetchWithAuth } = useAuth();
  const router = useRouter();
  const registered = useRef(false);
  const [toastMsg, setToastMsg] = useState("");
  const [toastKey, setToastKey] = useState(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!user) return;

    async function handleNotificationData(
      data: Record<string, string | undefined>,
      actionIdentifier?: string,
      userText?: string
    ) {
      // Handle specific action identifiers
      if (actionIdentifier === "REPLY" && userText && data.clientId) {
        try {
          await fetchWithAuth("/api/portal/messages", {
            method: "POST",
            body: JSON.stringify({ body: userText, clientId: parseInt(data.clientId, 10) }),
          });
        } catch {
          // Silent
        }
        return;
      }

      if (actionIdentifier === "MARK_DONE" && data.actionId) {
        await fetchWithAuth(`/api/ai/next-best-actions/${data.actionId}/resolve`, {
          method: "POST",
          body: JSON.stringify({ status: "resolved" }),
        }).catch(() => null);
        return;
      }

      // Screen-based deep linking
      const screen = data.screen;

      if (screen === "purchase" && data.id) {
        try {
          const res = await fetchWithAuth(`/api/admin/purchases/${data.id}`);
          if (res.status === 404) {
            router.push("/(tabs)/more/purchases");
            showToast("This purchase is no longer available");
            return;
          }
        } catch {
          /* Network error */
        }
        router.push(`/(tabs)/more/purchases/${data.id}`);
      } else if (screen === "purchases") {
        router.push("/(tabs)/more/purchases");
      } else if (screen === "conversation" && data.clientId) {
        try {
          const res = await fetchWithAuth(`/api/portal/messages?clientId=${data.clientId}`);
          if (res.status === 404) {
            router.push("/(tabs)/more/messages");
            showToast("This conversation is no longer available");
            return;
          }
        } catch {
          /* Network error */
        }
        router.push(`/(tabs)/more/messages/${data.clientId}?name=${encodeURIComponent(data.name ?? "Client")}`);
      } else if (screen === "messages") {
        router.push("/(tabs)/more/messages");
      } else if (screen === "lead" && data.id) {
        router.push(`/(tabs)/pipeline/leads/${data.id}`);
      } else if (screen === "pipeline") {
        router.push("/(tabs)/pipeline");
      } else if (screen === "client" && data.id) {
        router.push(`/(tabs)/clients/${data.id}?name=${encodeURIComponent(data.name ?? "Client")}`);
      } else if (screen === "project" && data.id) {
        router.push(`/(tabs)/projects/${data.id}`);
      } else if (screen === "runbook" && data.jobId) {
        router.push(`/(tabs)/more/script-runner?jobId=${data.jobId}`);
      } else if (screen === "contract" && data.id) {
        router.push("/(tabs)/more/contracts");
      } else if (screen === "quiz" && data.id) {
        router.push(`/(tabs)/pipeline/quiz/${data.id}`);
      } else if (screen === "inbox") {
        router.push("/(tabs)/more/inbox");
      } else if (screen === "analytics") {
        router.push("/(tabs)/more/analytics");
      }
      // Legacy routes kept for backwards compatibility
      else if (screen === "order" && data.id) {
        router.push(`/(tabs)/more/purchases/${data.id}`);
      } else if (screen === "orders") {
        router.push("/(tabs)/more/purchases");
      } else if (screen === "EmailActivity") {
        router.push("/(tabs)/more/inbox");
      }
    }

    const LAST_HANDLED_KEY = "lastHandledNotificationId";
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        const notifId = response.notification.request.identifier;
        const lastHandled = await AsyncStorage.getItem(LAST_HANDLED_KEY).catch(() => null);
        if (lastHandled === notifId) return;
        await AsyncStorage.setItem(LAST_HANDLED_KEY, notifId).catch(() => null);
        const data = response.notification.request.content.data as Record<string, string | undefined>;
        await handleNotificationData(data, response.actionIdentifier, response.userText);
      })
      .catch(() => null);

    const receiveSub = Notifications.addNotificationReceivedListener(async (notification) => {
      const data = notification.request.content.data as Record<string, string | undefined>;
      const isRelevant = [
        "purchase", "purchases", "conversation", "messages", "lead", "client", "project",
        "runbook", "quiz", "order", "orders", "EmailActivity", "inbox",
      ].includes(data.screen ?? "");
      if (!isRelevant) return;
      try {
        const current = await Notifications.getBadgeCountAsync();
        await Notifications.setBadgeCountAsync(current + 1);
      } catch {
        /* Badge is best-effort */
      }
    });

    const tapSub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      await handleNotificationData(data, response.actionIdentifier, response.userText);
    });

    return () => {
      receiveSub.remove();
      tapSub.remove();
    };
  }, [user, router, fetchWithAuth, showToast]);

  useEffect(() => {
    if (!user || registered.current) return;
    registered.current = true;

    void (async () => {
      try {
        const existingPerms = await Notifications.getPermissionsAsync() as unknown as { status?: string; ios?: { status?: number } };
        const isGranted = (perms: typeof existingPerms) =>
          (perms as unknown as Record<string, unknown>)["status"] === "granted"
          || ((perms as unknown as { ios?: { status?: number } }).ios?.status ?? 0) >= 2;
        if (!isGranted(existingPerms)) {
          const newPerms = await Notifications.requestPermissionsAsync() as unknown as typeof existingPerms;
          if (!isGranted(newPerms)) return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
        if (!tokenData?.data) return;

        await fetchWithAuth("/api/admin/device-tokens", {
          method: "POST",
          body: JSON.stringify({ token: tokenData.data, platform: "ios" }),
        });
      } catch {
        /* Push setup is best-effort */
      }
    })();
  }, [user, fetchWithAuth]);

  return <Toast message={toastMsg} toastKey={toastKey} />;
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  if (!user) {
    return (
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
      </Stack>
    );
  }

  return (
    <>
      <PushSetup />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <RootLayoutNav />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
