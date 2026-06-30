import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDistanceToNow } from "date-fns";

interface Notification {
  id: number;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  linkPath: string | null;
  createdAt: string;
}

function typeIcon(type: string): React.ReactNode {
  if (type === "lead_created") {
    return (
      <div className="w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
    );
  }
  if (type === "quiz_lead_created") {
    return (
      <div className="w-7 h-7 rounded-full bg-purple-500/15 border border-purple-500/25 flex items-center justify-center flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    );
  }
  if (type === "purchase_created") {
    return (
      <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      </div>
    );
  }
  if (type === "message") {
    return (
      <div className="w-7 h-7 rounded-full bg-sky-500/15 border border-sky-500/25 flex items-center justify-center flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>
    );
  }
  if (type === "invoice") {
    return (
      <div className="w-7 h-7 rounded-full bg-yellow-500/15 border border-yellow-500/25 flex items-center justify-center flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-[#30363D] border border-[#484F58] flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5 text-[#7D8590]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>
  );
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

// ─── Push Notification Toggle ─────────────────────────────────────────────────

type PushState = "unsupported" | "loading" | "denied" | "subscribed" | "unsubscribed";

const LS_PUSH_ENDPOINT = "admin_push_endpoint";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function PushNotificationToggle({ fetchWithAuth }: { fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"] }) {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const swRegRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }

    const storedEndpoint = localStorage.getItem(LS_PUSH_ENDPOINT);
    if (storedEndpoint) {
      setState("subscribed");
    } else {
      setState("unsubscribed");
    }

    navigator.serviceWorker
      .register("/admin-panel/sw.js", { scope: "/admin-panel/" })
      .then((reg) => { swRegRef.current = reg; })
      .catch(() => { setState("unsupported"); });
  }, []);

  const handleEnable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") {
        setState("unsubscribed");
        return;
      }

      let reg = swRegRef.current;
      if (!reg) {
        reg = await navigator.serviceWorker.register("/admin-panel/sw.js", { scope: "/admin-panel/" });
        swRegRef.current = reg;
      }

      const vapidRes = await fetchWithAuth("/api/push/vapid-public-key");
      if (!vapidRes.ok) throw new Error("Could not fetch VAPID key");
      const { publicKey } = await vapidRes.json() as { publicKey: string };

      const keyArray = urlBase64ToUint8Array(publicKey);
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyArray.buffer.slice(keyArray.byteOffset, keyArray.byteOffset + keyArray.byteLength) as ArrayBuffer,
      });

      const json = subscription.toJSON();
      const subRes = await fetchWithAuth("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subscription.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      });

      if (!subRes.ok) {
        await subscription.unsubscribe();
        throw new Error("Failed to save push subscription on server");
      }

      localStorage.setItem(LS_PUSH_ENDPOINT, subscription.endpoint);
      setState("subscribed");
    } catch {
      setState("unsubscribed");
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      const endpoint = localStorage.getItem(LS_PUSH_ENDPOINT);
      if (endpoint) {
        await fetchWithAuth("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        });
        localStorage.removeItem(LS_PUSH_ENDPOINT);
      }

      const reg = swRegRef.current;
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("unsubscribed");
    } finally {
      setBusy(false);
    }
  };

  if (state === "unsupported") return null;

  return (
    <div className="px-4 py-2.5 border-t border-[#30363D] flex-shrink-0">
      {state === "denied" ? (
        <p className="text-[10px] text-[#7D8590] leading-snug">
          Browser notifications blocked. Allow them in your browser settings and reload.
        </p>
      ) : state === "subscribed" ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-[10px] text-[#7D8590]">Browser notifications active</span>
          </div>
          <button
            onClick={() => void handleDisable()}
            disabled={busy}
            className="text-[10px] font-medium text-[#484F58] hover:text-red-400 transition-colors disabled:opacity-50"
          >
            Disable
          </button>
        </div>
      ) : (
        <button
          onClick={() => void handleEnable()}
          disabled={busy || state === "loading"}
          className="w-full flex items-center gap-2 text-[10px] font-medium text-[#0078D4] hover:text-[#58A6FF] transition-colors disabled:opacity-50"
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          Enable browser notifications
        </button>
      )}
    </div>
  );
}

interface NotificationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}

export default function NotificationDrawer({
  open,
  onOpenChange,
  onUnreadCountChange,
}: NotificationDrawerProps) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/notifications");
      if (res.ok) {
        const data = await res.json() as Notification[];
        setNotifications(data);
        onUnreadCountChange(data.filter(n => !n.read).length);
      }
    } catch {}
  }, [fetchWithAuth, onUnreadCountChange]);

  useEffect(() => {
    void loadNotifications();
    const id = setInterval(() => void loadNotifications(), 30_000);
    return () => clearInterval(id);
  }, [loadNotifications]);

  // Listen for SW navigate messages when a push notification is clicked
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "NAVIGATE" && event.data.path) {
        navigate(event.data.path as string);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate]);

  const markRead = async (id: number) => {
    try {
      await fetchWithAuth(`/api/notifications/${id}/read`, { method: "PATCH" });
    } catch {}
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    onUnreadCountChange(notifications.filter(n => !n.read && n.id !== id).length);
  };

  const markAllRead = async () => {
    try {
      await fetchWithAuth("/api/notifications/read-all", { method: "PATCH" });
    } catch {}
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    onUnreadCountChange(0);
  };

  const handleRowClick = async (n: Notification) => {
    await markRead(n.id);
    onOpenChange(false);
    if (n.linkPath) {
      navigate(n.linkPath);
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] bg-[#161B22] border-l border-[#30363D] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-[#30363D] flex-shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm font-semibold text-[#E6EDF3] flex items-center gap-2">
              Notifications
              {unreadCount > 0 && (
                <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </SheetTitle>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[10px] font-medium text-[#0078D4] hover:text-[#58A6FF] transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center px-6">
              <div className="w-10 h-10 rounded-full bg-[#1C2128] border border-[#30363D] flex items-center justify-center mb-3">
                <svg className="w-5 h-5 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <p className="text-xs font-medium text-[#7D8590]">No notifications yet</p>
              <p className="text-[10px] text-[#484F58] mt-1">New leads, quiz completions, and purchases will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#21262D]">
              {notifications.map(n => (
                <li key={n.id}>
                  <button
                    onClick={() => void handleRowClick(n)}
                    className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#1C2128] ${
                      !n.read ? "bg-[#0078D4]/5" : ""
                    }`}
                  >
                    {typeIcon(n.type)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-xs leading-snug truncate ${!n.read ? "font-semibold text-[#E6EDF3]" : "font-medium text-[#7D8590]"}`}>
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0 mt-1" />
                        )}
                      </div>
                      {n.body && (
                        <p className="text-[10px] text-[#484F58] mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-[10px] text-[#484F58] mt-1">{relativeTime(n.createdAt)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <PushNotificationToggle fetchWithAuth={fetchWithAuth} />
      </SheetContent>
    </Sheet>
  );
}
