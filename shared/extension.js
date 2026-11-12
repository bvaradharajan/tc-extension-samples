/* global TrimbleConnectWorkspace */
(function () {
  "use strict";

  const config = Object.assign({ kind: "project", requestPermission: false, title: "Sample extension" }, window.EXT_CONFIG || {});
  const isViewer = config.kind === "viewer";
  const EXTENSION_ROUTE_PATTERN = /\/projects\/[^/]+\/extension\/[^/]+/;
  const MAX_LOG_ENTRIES = 50;

  let API;
  let autoRequestScheduled = false;
  const eventLog = [];

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function renderLayout() {
    document.title = config.title;
    const body = document.body;
    body.appendChild(el("h1", {}, config.title));

    const badges = el("p");
    badges.appendChild(el("span", { class: "badge" }, isViewer ? "3D viewer extension" : "Project extension"));
    badges.appendChild(el("span", { class: "badge" }, config.requestPermission ? "requestPermission: yes" : "requestPermission: no"));
    body.appendChild(badges);

    body.appendChild(el("p", { id: "status" }, "Connecting to Trimble Connect…"));

    body.appendChild(el("h2", {}, "Context"));
    const table = el("table");
    const tbody = el("tbody");
    [
      ["Project", "projectInfo"],
      ["Host route", "routeInfo"],
    ]
      .concat(isViewer ? [["Selection", "selectionInfo"], ["Camera", "cameraInfo"]] : [])
      .forEach(([label, id]) => {
        const row = el("tr");
        row.appendChild(el("th", {}, label));
        const cell = el("td");
        cell.appendChild(el("code", { id }, "—"));
        row.appendChild(cell);
        tbody.appendChild(row);
      });
    table.appendChild(tbody);
    body.appendChild(table);

    if (isViewer) {
      body.appendChild(el("button", { id: "refreshViewerBtn", type: "button", disabled: "" }, "Refresh selection and camera"));
    }

    body.appendChild(el("h2", {}, "Access token"));
    if (config.requestPermission) {
      body.appendChild(
        el(
          "p",
          { class: "muted" },
          isViewer
            ? 'Calls extension.requestPermission("accesstoken") automatically when this viewer panel becomes visible.'
            : 'Calls extension.requestPermission("accesstoken") automatically when you open this extension from project navigation.',
        ),
      );
      body.appendChild(el("button", { id: "requestBtn", type: "button", disabled: "" }, "Request access token again"));
      body.appendChild(el("button", { id: "checkBtn", type: "button", disabled: "" }, "Check permission status"));
      body.appendChild(el("pre", { id: "result" }, "Waiting for connection…"));
      body.appendChild(
        el(
          "p",
          { class: "muted" },
          "To see the dialog again after Allow/Deny: Apps & Capabilities → row menu → Reset permission.",
        ),
      );
    } else {
      body.appendChild(
        el("p", { class: "muted" }, "This extension never calls extension.requestPermission, so no Allow/Deny dialog should appear."),
      );
      body.appendChild(
        el("pre", { id: "result" }, "No access token requested. If the host pushes one via the extension.accessToken event, its scope is shown below."),
      );
    }

    body.appendChild(el("h2", {}, "Token scope"));
    body.appendChild(el("p", { id: "tokenScope", class: "muted" }, "No access token received yet."));
    body.appendChild(el("pre", { id: "tokenClaims" }, "Decoded JWT claims appear here once a token is received."));

    body.appendChild(el("h2", {}, "Workspace events"));
    body.appendChild(el("pre", { id: "eventLog" }, "No events yet."));
  }

  function setText(id, text, className) {
    const node = document.getElementById(id);
    if (!node) {
      return;
    }
    node.textContent = text;
    if (className !== undefined) {
      node.className = className;
    }
  }

  function setResult(message, className) {
    setText("result", message, className || "");
  }

  function isTokenString(value) {
    return typeof value === "string" && value !== "Denied" && value !== "Pending" && value !== "reset" && value.split(".").length === 3;
  }

  function maskToken(token) {
    return token.slice(0, 12) + "…" + token.slice(-6);
  }

  function decodeJwtPayload(token) {
    try {
      const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
      const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_error) {
      return null;
    }
  }

  function formatEpoch(seconds) {
    return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() + " (" + seconds + ")" : "—";
  }

  function showTokenClaims(token, source) {
    const claims = decodeJwtPayload(token);
    if (!claims) {
      setText("tokenScope", "Received a token from " + source + ", but it is not a decodable JWT.", "warn");
      setText("tokenClaims", "");
      return;
    }
    const rawScope = claims.scope !== undefined ? claims.scope : claims.scp;
    const scopes = Array.isArray(rawScope) ? rawScope : typeof rawScope === "string" ? rawScope.split(" ").filter(Boolean) : [];
    setText(
      "tokenScope",
      scopes.length > 0 ? "scope: " + scopes.join(" ") : "Token has no scope / scp claim.",
      scopes.length > 0 ? "ok" : "warn",
    );
    setText(
      "tokenClaims",
      [
        "source:     " + source,
        "token:      " + maskToken(token),
        "scope:      " + (scopes.length > 0 ? scopes.join("\n            ") : "—"),
        "aud:        " + JSON.stringify(claims.aud),
        "azp:        " + (claims.azp || claims.client_id || "—"),
        "sub:        " + (claims.sub || "—"),
        "iss:        " + (claims.iss || "—"),
        "iat:        " + formatEpoch(claims.iat),
        "exp:        " + formatEpoch(claims.exp),
      ].join("\n"),
    );
    console.info("[" + config.title + "] access token claims from " + source, claims);
  }

  function logEvent(event, args) {
    let data;
    try {
      const payload = args && args.data !== undefined ? args.data : args;
      data = JSON.stringify(isTokenString(payload) ? maskToken(payload) : payload);
    } catch (_error) {
      data = String(args);
    }
    if (data && data.length > 300) {
      data = data.slice(0, 300) + "…";
    }
    eventLog.unshift(new Date().toLocaleTimeString() + "  " + event + (data ? "  " + data : ""));
    eventLog.length = Math.min(eventLog.length, MAX_LOG_ENTRIES);
    setText("eventLog", eventLog.join("\n"));
  }

  function onWorkspaceEvent(event, args) {
    logEvent(event, args);
    if (event === "extension.accessToken" && args && isTokenString(args.data)) {
      showTokenClaims(args.data, "extension.accessToken event");
    }
    if (config.requestPermission && event === "extension.accessToken" && args && args.data === "reset") {
      whenExtensionActivated(() => void requestAccessToken());
    }
    if (isViewer && event === "viewer.onSelectionChanged") {
      void refreshViewerInfo();
    }
  }

  function isFrameVisible() {
    const frame = window.frameElement;
    if (!frame) {
      return document.visibilityState !== "hidden";
    }
    const style = window.getComputedStyle(frame);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /** Parent pathname from hash router (#/projects/…) or browser router. null if cross-origin. */
  function getParentPathname() {
    try {
      const parentLoc = window.parent.location;
      const hash = parentLoc.hash || "";
      if (hash.startsWith("#/")) {
        return hash.slice(1).split("?")[0];
      }
      return parentLoc.pathname;
    } catch (_error) {
      return null;
    }
  }

  function shouldAutoRequestAccessToken() {
    if (!isFrameVisible()) {
      return false;
    }
    if (isViewer) {
      return true;
    }
    const path = getParentPathname();
    return path === null || EXTENSION_ROUTE_PATTERN.test(path);
  }

  function whenExtensionActivated(run) {
    if (shouldAutoRequestAccessToken()) {
      run();
      return;
    }

    setResult(
      isViewer
        ? "Connected — waiting until this viewer panel is visible…"
        : "Connected — waiting until you open this extension from project navigation…",
      "muted",
    );

    let pollTimer;
    function check() {
      if (shouldAutoRequestAccessToken()) {
        cleanup();
        run();
      }
    }
    function cleanup() {
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", check);
    }

    document.addEventListener("visibilitychange", check);
    pollTimer = setInterval(check, 500);
  }

  function summarizeToken(token) {
    if (token === "Denied") {
      return { text: "Denied — user chose not to grant an access token.", className: "error" };
    }
    if (token === "Pending") {
      return { text: "Pending — respond to the Allow/Deny dialog in Trimble Connect.", className: "warn" };
    }
    if (!token || typeof token !== "string") {
      return { text: "Unexpected response: " + String(token), className: "warn" };
    }
    return {
      text: "Allowed — access token received (masked): " + maskToken(token),
      className: "ok",
    };
  }

  async function requestAccessToken() {
    if (!API) {
      return;
    }
    setResult('Calling extension.requestPermission("accesstoken")…', "warn");
    try {
      const token = await API.extension.requestPermission("accesstoken");
      const summary = summarizeToken(token);
      setResult(summary.text, summary.className);
      if (isTokenString(token)) {
        showTokenClaims(token, 'requestPermission("accesstoken")');
      }
    } catch (error) {
      setResult("requestPermission failed: " + (error && error.message ? error.message : String(error)), "error");
    }
  }

  async function checkPermission() {
    if (!API || typeof API.extension.getPermission !== "function") {
      setResult("getPermission is not available on this host.", "warn");
      return;
    }
    try {
      const token = await API.extension.getPermission("accesstoken");
      const summary = summarizeToken(token);
      setResult('getPermission("accesstoken"): ' + summary.text, summary.className);
      if (isTokenString(token)) {
        showTokenClaims(token, 'getPermission("accesstoken")');
      }
    } catch (error) {
      setResult("getPermission failed: " + (error && error.message ? error.message : String(error)), "error");
    }
  }

  async function registerProjectNavMenu() {
    await API.ui.setMenu({
      title: config.title,
      icon: new URL("../../shared/favicon-project.svg", window.location.href).href,
      command: "sample-extension",
    });
  }

  async function refreshProjectInfo() {
    try {
      const project = await API.project.getProject();
      setText("projectInfo", project ? (project.name || "(unnamed)") + " — " + project.id : "No project");
    } catch (error) {
      setText("projectInfo", "getProject failed: " + (error && error.message ? error.message : String(error)), "error");
    }
    const path = getParentPathname();
    setText("routeInfo", path === null ? "(cross-origin, not readable)" : path);
  }

  async function refreshViewerInfo() {
    if (!API) {
      return;
    }
    try {
      const selection = await API.viewer.getSelection();
      const count = (selection || []).reduce((total, model) => total + ((model.objectRuntimeIds || []).length || 0), 0);
      setText("selectionInfo", count + " object(s) in " + (selection || []).length + " model(s)");
    } catch (error) {
      setText("selectionInfo", "getSelection failed: " + (error && error.message ? error.message : String(error)), "error");
    }
    try {
      const camera = await API.viewer.getCamera();
      setText("cameraInfo", camera ? JSON.stringify({ position: camera.position, target: camera.target }) : "—");
    } catch (error) {
      setText("cameraInfo", "getCamera failed: " + (error && error.message ? error.message : String(error)), "error");
    }
  }

  async function init() {
    renderLayout();

    if (typeof TrimbleConnectWorkspace === "undefined") {
      setText("status", "Workspace API script failed to load.", "error");
      return;
    }

    if (window.parent === window) {
      setText("status", "Not embedded — add this extension's manifest.json in Trimble Connect to run it.", "warn");
      setResult("Open this page from Trimble Connect to use the Workspace API.", "muted");
      return;
    }

    try {
      API = await TrimbleConnectWorkspace.connect(window.parent, onWorkspaceEvent);
      if (!API || !API.extension) {
        throw new Error("Workspace API did not return an extension API — is this page embedded by Trimble Connect?");
      }
    } catch (error) {
      setText("status", "Connect failed — open this extension from Trimble Connect.", "error");
      setResult(error && error.message ? error.message : String(error), "error");
      return;
    }

    setText("status", "Connected via Workspace API.", "ok");

    if (!isViewer) {
      try {
        await registerProjectNavMenu();
      } catch (error) {
        logEvent("ui.setMenu failed", error && error.message ? error.message : String(error));
      }
    }

    void refreshProjectInfo();

    if (isViewer) {
      const refreshBtn = document.getElementById("refreshViewerBtn");
      refreshBtn.disabled = false;
      refreshBtn.addEventListener("click", () => void refreshViewerInfo());
      void refreshViewerInfo();
    }

    if (config.requestPermission) {
      const requestBtn = document.getElementById("requestBtn");
      const checkBtn = document.getElementById("checkBtn");
      requestBtn.disabled = false;
      checkBtn.disabled = false;
      requestBtn.addEventListener("click", () => void requestAccessToken());
      checkBtn.addEventListener("click", () => void checkPermission());
      if (!autoRequestScheduled) {
        autoRequestScheduled = true;
        whenExtensionActivated(() => void requestAccessToken());
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
