import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// The MSP Console is an all-day operator surface and ships in the design
// system's dark mode only (Design/MSP_Console README, "The design system") —
// there is no light variant, so force `.dark` rather than following the OS.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<App />);
