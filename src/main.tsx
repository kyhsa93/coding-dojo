import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// New deployments take effect on the next page load; the problem set grows weekly so no prompt is needed.
registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* The list's search box is bound to the URL; a transition would make it lag and break Korean IME composition. */}
    <HashRouter useTransitions={false}>
      <App />
    </HashRouter>
  </StrictMode>,
);
