// Before anything else listens for keys.
import "./desktop/keys";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Desktop } from "./desktop/Desktop";
import { useViewport } from "./desktop/hooks";
import { Mobile } from "./Mobile";
import "./styles.css";

/** The full pretend Mac needs room for Clipt's editor. */
function Site() {
  const { w, h } = useViewport();
  return w >= 900 && h >= 600 ? <Desktop /> : <Mobile />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
);
