import { usePushSubscription } from "@/lib/usePushSubscription";

export default function ShanePlayground() {
  const { state, busy, handleEnable, handleDisable } = usePushSubscription();

  const label =
    state === "loading" ? "Loading…" :
    state === "unsupported" ? "Notifications unsupported" :
    state === "denied" ? "Notifications blocked" :
    state === "subscribed" ? "Disable Notifications" :
    "Allow Notifications";

  const disabled = busy || state === "loading" || state === "unsupported" || state === "denied";

  return (
    <div className="min-h-screen w-full bg-black flex items-center justify-center">
      <button
        onClick={() => void (state === "subscribed" ? handleDisable() : handleEnable())}
        disabled={disabled}
        className="text-white text-lg font-medium border border-white/30 rounded-lg px-6 py-3 hover:bg-white/10 transition-colors disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
