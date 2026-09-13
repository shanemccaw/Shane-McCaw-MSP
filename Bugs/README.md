# Repository Bug Reports (`/Bugs`)

This directory contains structured JSON bug reports exported directly from the **Visual Test Tracker** tool in **BuildConsole**.

## Directory Structure
- `MSP_Console/` - Bug reports, logs, and telemetry for the MSP Desktop Console and agent tooling.
- `Portal/` - Bug reports and telemetry for the Client & Reseller Portals.
- `Admin-Panel/` - Bug reports and telemetry for the Admin Control Panel.
- `Marketing/` - Bug reports for the public website and marketing funnels.
- `MSP_Marketing/` - Bug reports and telemetry for the MSP Marketing site and public web assets.

Each area folder contains bug report JSON files and an `attachments/` subfolder with bundled screenshots.

## Exported JSON Schema
Each bug report is exported as an individual JSON document containing:
- **`metadata`**: URL, page title, browser runtime, OS version, viewport size, user agent, timestamps, and performance signals (LCP, page load time, TTFB).
- **`notes`**: Summary, formatted Markdown notes, expected behavior, and actual behavior.
- **`reproSteps`**: Numbered text steps and automated user interaction breadcrumbs (clicks, inputs, button presses, SPA navigations, form submissions).
- **`screenshots`**: Screenshot metadata, relative repo paths, and original capture paths.
- **`logs`**: Console logs with stack traces, and network failure logs (HTTP status codes, URLs, request durations, and payload sizes).
