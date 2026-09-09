# Apple Health bridge -- Shortcuts recipe (Git #3322)

HealthKit is exclusively a native iOS framework -- no web app/PWA can read it directly. The real
bridge is Apple's own Shortcuts app: it can read HealthKit samples *and* make real HTTP requests,
so a Shortcuts automation posts a real oxygen/heart-rate reading straight into shanes-life.

## 1. Get a real link

In the app: **Settings -> Connected -> Apple Health**, name the Shortcut (e.g. "Pulse Ox
reading") and tap **Create Shortcuts link**. Copy the URL shown -- it's shown exactly once. It
looks like:

```
https://<your-shanes-life-host>/hooks/health-metrics/slhealthhook_<random>
```

That URL is the whole credential -- anyone with it can post readings for your account, so treat
it like a password. Revoke it from the same screen if it ever leaks.

## 2. Build the Shortcut

Open the Shortcuts app -> **+** -> build these steps in order:

1. **Get Latest Health Sample** -- Sample Type: `Blood Oxygen Saturation` (for SpO2) or `Heart
   Rate` (for heart rate).
2. **Get Details of Health Sample** -- from the result of step 1, get **Value** (a number) and
   **Start Date** (the real timestamp HealthKit recorded the sample at).
3. **Text** -- build the JSON body:
   ```
   {"metric":"spo2","value":[Value],"recordedAt":"[Start Date, ISO 8601 format]"}
   ```
   Use `heart_rate` instead of `spo2` for the heart-rate variant. In the Text step, insert the
   **Value** and **Start Date** variables from step 2 where the brackets are. Shortcuts' "Format"
   option on a Date variable lets you pick ISO 8601 directly.
4. **Get Contents of URL**:
   - URL: the link from step 1 above.
   - Method: `POST`.
   - Headers: `Content-Type: application/json`.
   - Request Body: `Text` -> the JSON built in step 3.

That's the whole recipe -- no OAuth, no app password, just the one bearer link baked into the
Shortcut's own POST action.

## 3. Automate it

Add the Shortcut to a real **Automation** (Shortcuts app -> Automation tab -> **+**):

- **Time of Day** -- run it on a schedule (e.g. morning/evening pulse-ox check), or
- **Health** condition trigger (iOS 17+, if your device offers a metric-based automation
  trigger) -- run it when a new sample of that type is recorded.

Either way, turn off "Ask Before Running" once you've confirmed it works, so it fires silently.

## 4. Verify

Run the Shortcut manually once. **Settings -> Connected -> Apple Health** should show the new
reading in the recent-readings list within a few seconds, with the correct real timestamp (the
HealthKit sample's own Start Date, not "just now").

## Real, honest scope note

This bridge only ingests and displays readings (issue #3322 items 1-4). Correlating a reading
against #3321's medication usage log (item 5) is explicitly deferred until both real data
sources exist and is real, separate follow-up work -- not built here.
