import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Feather } from "@expo/vector-icons";

export interface QuickAccessItem {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  route: string;
}

interface QuickAccessContextValue {
  items: QuickAccessItem[];
  loaded: boolean;
  hintSeen: boolean;
  isPinned: (route: string) => boolean;
  addItem: (item: QuickAccessItem) => void;
  removeItem: (route: string) => void;
  reorder: (newOrder: QuickAccessItem[]) => void;
  dismissHint: () => void;
}

const STORAGE_KEY = "@quick_access_items_v2";
const HINT_SEEN_KEY = "@quick_access_hint_seen";

export const DEFAULT_ITEMS: QuickAccessItem[] = [
  { label: "Clients", icon: "users", route: "/(tabs)/clients" },
  { label: "Pipeline", icon: "trending-up", route: "/(tabs)/pipeline" },
  { label: "Projects", icon: "grid", route: "/(tabs)/projects" },
  { label: "Messages", icon: "message-circle", route: "/(tabs)/more/messages" },
  { label: "Script Runner", icon: "terminal", route: "/(tabs)/more/script-runner" },
  { label: "Analytics", icon: "bar-chart-2", route: "/(tabs)/more/analytics" },
];

const QuickAccessContext = createContext<QuickAccessContextValue | null>(null);

export function QuickAccessProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<QuickAccessItem[]>(DEFAULT_ITEMS);
  const [loaded, setLoaded] = useState(false);
  const [hintSeen, setHintSeen] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [stored, hint] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(HINT_SEEN_KEY),
        ]);
        if (stored) {
          const parsed = JSON.parse(stored) as QuickAccessItem[];
          // Accept any valid array, including empty (user may have removed all items)
          if (Array.isArray(parsed)) {
            setItems(parsed);
          }
        }
        setHintSeen(hint === "true");
      } catch {
        // use defaults
      } finally {
        setLoaded(true);
      }
    }
    void load();
  }, []);

  const persist = useCallback((next: QuickAccessItem[]) => {
    setItems(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => null);
  }, []);

  const isPinned = useCallback((route: string) => items.some((i) => i.route === route), [items]);

  const addItem = useCallback(
    (item: QuickAccessItem) => {
      if (isPinned(item.route)) return;
      persist([...items, item]);
    },
    [items, isPinned, persist]
  );

  const removeItem = useCallback(
    (route: string) => {
      persist(items.filter((i) => i.route !== route));
    },
    [items, persist]
  );

  const reorder = useCallback((newOrder: QuickAccessItem[]) => persist(newOrder), [persist]);

  const dismissHint = useCallback(() => {
    setHintSeen(true);
    AsyncStorage.setItem(HINT_SEEN_KEY, "true").catch(() => null);
  }, []);

  const value = useMemo<QuickAccessContextValue>(
    () => ({ items, loaded, hintSeen, isPinned, addItem, removeItem, reorder, dismissHint }),
    [items, loaded, hintSeen, isPinned, addItem, removeItem, reorder, dismissHint]
  );

  return <QuickAccessContext.Provider value={value}>{children}</QuickAccessContext.Provider>;
}

export function useQuickAccess(): QuickAccessContextValue {
  const ctx = useContext(QuickAccessContext);
  if (!ctx) throw new Error("useQuickAccess must be used within QuickAccessProvider");
  return ctx;
}
