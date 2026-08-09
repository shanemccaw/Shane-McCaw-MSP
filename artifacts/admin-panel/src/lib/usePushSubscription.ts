import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { logger } from "@/lib/logger";

const log = logger.child({ channel: "admin.shell" });

export type PushState = "unsupported" | "loading" | "denied" | "subscribed" | "unsubscribed";

const LS_PUSH_ENDPOINT = "admin_push_endpoint";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** Real push-subscription flow, shared by NotificationDrawer.tsx and ShanePlayground.tsx. */
export function usePushSubscription() {
  const { fetchWithAuth } = useAuth();
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
    setState(storedEndpoint ? "subscribed" : "unsubscribed");

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
      log.info("push subscription enabled");
    } catch (err) {
      log.warn({ err: String(err) }, "push subscription enable failed");
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
      log.info("push subscription disabled");
    } catch {
      setState("unsubscribed");
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, handleEnable, handleDisable };
}
