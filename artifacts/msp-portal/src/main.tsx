import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Seed the initial theme class synchronously from the OS preference to avoid a
// flash of the wrong theme before React mounts. ThemeProvider owns the class
// from mount onward and overrides this with the account's stored preference
// once the session loads.
if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
  document.documentElement.classList.add("dark");
}

createRoot(document.getElementById("root")!).render(<App />);
