import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Seed the initial theme class synchronously from the OS preference to avoid a
// flash of the wrong theme before React mounts, same pattern as the other
// front-end artifacts in this repo.
if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);
