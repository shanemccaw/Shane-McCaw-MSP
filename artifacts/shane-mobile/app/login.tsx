import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";

const SEC_BADGES = [
  { emoji: "🔒", label: "Encrypted" },
  { emoji: "🛡️", label: "MFA Protected" },
  { emoji: "⚡", label: "Zero Trust" },
  { emoji: "🏛️", label: "NASA-grade" },
];

const COMP_BADGES = ["HIPAA", "SOC 2", "FINRA", "CMMC"];

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const sessionExpired = reason === "session_expired";

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 32,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── TOP: Hero branding ── */}
        <View style={styles.heroSection}>
          <View style={styles.logoCircle}>
            <Feather name="shield" size={32} color="#FFFFFF" />
          </View>
          <Text style={styles.appName}>Shane McCaw</Text>
          <Text style={styles.tagline}>Admin Portal</Text>
          <Text style={styles.taglineSub}>Microsoft 365 Architecture</Text>
        </View>

        {/* ── MIDDLE: Secure Login pill + session banner + form card ── */}
        <View style={styles.middleSection}>
          {/* Secure Login pill — always visible */}
          <View style={styles.secureLoginPill}>
            <Feather name="lock" size={11} color="#0078D4" />
            <Text style={styles.secureLoginText}>Secure Login</Text>
          </View>

          {sessionExpired && (
            <View style={styles.sessionBanner}>
              <Feather name="clock" size={14} color="#0078D4" />
              <Text style={styles.sessionBannerText}>
                Your session expired — please sign in again
              </Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign in</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="admin@example.com"
                placeholderTextColor="#8FA3B8"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={[styles.input, styles.passwordInput]}
                  placeholder="••••••••"
                  placeholderTextColor="#8FA3B8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeButton}
                  hitSlop={8}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={18}
                    color="#6B7E96"
                  />
                </Pressable>
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={14} color="#E53E3E" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.loginBtn,
                pressed && styles.loginBtnPressed,
                loading && styles.loginBtnDisabled,
              ]}
              onPress={handleLogin}
              disabled={loading}
              testID="login-button"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.loginBtnText}>Sign in</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* ── BOTTOM: Trust / security badges ── */}
        <View style={styles.bottomSection}>
          <View style={styles.badgesRow}>
            {SEC_BADGES.map(({ emoji, label }) => (
              <View key={label} style={styles.secBadge}>
                <Text style={styles.badgeEmoji}>{emoji}</Text>
                <Text style={styles.secBadgeText}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.compBadgesRow}>
            {COMP_BADGES.map((b) => (
              <View key={b} style={styles.compBadge}>
                <Text style={styles.compBadgeText}>{b}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A2540",
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },

  /* ── TOP ── */
  heroSection: {
    alignItems: "center",
    paddingBottom: 8,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: "#0078D4",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#0078D4",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  appName: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.3,
  },
  tagline: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#8FA3B8",
    marginTop: 4,
  },
  taglineSub: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#0078D4",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 3,
  },

  /* ── MIDDLE ── */
  middleSection: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 20,
  },
  secureLoginPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 5,
    backgroundColor: "rgba(0,120,212,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,120,212,0.28)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 14,
  },
  secureLoginText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#60AAFF",
    letterSpacing: 0.3,
  },
  sessionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#0078D422",
    borderWidth: 1,
    borderColor: "#0078D455",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  sessionBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#60AAFF",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardTitle: {
    fontSize: 20,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    marginBottom: 20,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#6B7E96",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderWidth: 1.5,
    borderColor: "#D6E0EC",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: "#0A2540",
    backgroundColor: "#F7F9FC",
  },
  passwordWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 48,
  },
  eyeButton: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF5F5",
    borderWidth: 1,
    borderColor: "#FEB2B2",
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#C53030",
    flex: 1,
  },
  loginBtn: {
    backgroundColor: "#0078D4",
    borderRadius: 12,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    shadowColor: "#0078D4",
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  loginBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  loginBtnDisabled: {
    opacity: 0.7,
  },
  loginBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  /* ── BOTTOM ── */
  bottomSection: {
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  badgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  secBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeEmoji: {
    fontSize: 11,
    lineHeight: 14,
  },
  secBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.52)",
  },
  compBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
  },
  compBadge: {
    backgroundColor: "rgba(0,120,212,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,120,212,0.22)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  compBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "rgba(0,180,216,0.80)",
  },
});
