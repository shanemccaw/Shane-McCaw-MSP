/**
 * MSP Console scaffold placeholder (#2668). This app mounts at /msp-console/ and
 * has no chrome/design yet — this issue's own scope stop is "a working, empty,
 * correctly-registered app that other Features' wire work can build into," not a
 * real landing page. A real one replaces this once Design lands for this app
 * (see #2667 — MSP Console Shell — and #1485's own README for the .dc.html
 * convention this repo builds real pages against).
 */
export default function IndexPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">MSP Console</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This app is scaffolded and running, with no chrome or pages built yet. Real
        surfaces land under Epic #1571 (MSP Operator Portal) and Feature #2667 (MSP
        Console Shell).
      </p>
    </div>
  );
}
