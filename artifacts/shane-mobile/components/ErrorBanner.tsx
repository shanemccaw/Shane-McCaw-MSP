import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ErrorBannerProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorBanner({ message = "Something went wrong", onRetry }: ErrorBannerProps) {
  const colors = useColors();
  const { user } = useAuth();
  const router = useRouter();

  const handleRetry = () => {
    if (!user) {
      router.replace("/login?reason=session_expired");
      return;
    }
    onRetry?.();
  };

  const btnLabel = user ? "Retry" : "Sign In";

  return (
    <View style={[styles.banner, { backgroundColor: colors.destructive + "18", borderColor: colors.destructive + "44" }]}>
      <Feather name="alert-circle" size={16} color={colors.destructive} />
      <Text style={[styles.text, { color: colors.destructive }]} numberOfLines={2}>
        {message}
      </Text>
      {onRetry && (
        <Pressable onPress={handleRetry} style={[styles.btn, { borderColor: colors.destructive + "66" }]}>
          <Text style={[styles.btnText, { color: colors.destructive }]}>{btnLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  btn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  btnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});
