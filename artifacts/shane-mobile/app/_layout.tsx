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
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

SplashScreen.preventAutoHideAsync();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const queryClient = new QueryClient();

function PushSetup() {
  const { user, fetchWithAuth } = useAuth();
  const router = useRouter();
  const registered = useRef(false);

  useEffect(() => {
    if (!user) return;

    function handleNotificationData(data: Record<string, string | undefined>) {
      if (data.screen === "order" && data.id) {
        router.push(`/orders/${data.id}`);
      } else if (data.screen === "conversation" && data.clientId) {
        router.push(`/messages/${data.clientId}`);
      } else if (data.screen === "orders") {
        router.push("/(tabs)/orders");
      }
    }

    // Cold-start: launched by tapping a push notification while app was terminated.
    // We persist the last-handled notification identifier so that normal relaunches
    // (force-quit then reopen) don't re-navigate to a stale notification.
    const LAST_HANDLED_KEY = "lastHandledNotificationId";
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        const notifId = response.notification.request.identifier;
        const lastHandled = await AsyncStorage.getItem(LAST_HANDLED_KEY).catch(() => null);
        if (lastHandled === notifId) return;
        await AsyncStorage.setItem(LAST_HANDLED_KEY, notifId).catch(() => null);
        const data = response.notification.request.content.data as Record<string, string | undefined>;
        handleNotificationData(data);
      })
      .catch(() => null);

    // Foreground / background tap routing
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string | undefined>;
      handleNotificationData(data);
    });

    return () => tapSub.remove();
  }, [user, router]);

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
        // Push setup is best-effort
      }
    })();
  }, [user, fetchWithAuth]);

  return null;
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
