import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "@/lib/sw/register";

// Normalize deep links of the form `#/search?q=foo` (where the search portion
// is glued to the hash) into `?q=foo#/search` (where wouter's hash hook
// expects the search portion in `location.search`). Without this, pasting a
// shareable search URL bypasses the route matcher and renders 404.
if (typeof window !== "undefined") {
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  if (qIdx > 0) {
    const newHash = hash.slice(0, qIdx);
    const search = hash.slice(qIdx);
    const url = new URL(window.location.href);
    url.hash = newHash;
    url.search = search;
    window.history.replaceState(null, "", url.href);
  }
}

registerServiceWorker();

createRoot(document.getElementById("root")!).render(<App />);
