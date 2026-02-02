// ============================================================================
// They Voted For This — Frontend Application
// ============================================================================
// Pure vanilla JS. No framework. No build step.
// Communicates with Cloudflare Workers API.
// ============================================================================

// ---- CONFIG ----
// Change this to your deployed worker URL
const API_URL = "https://they-voted-for-this.YOUR_SUBDOMAIN.workers.dev";

// ---- STATE ----
let session = {
  serverId: null,
  playerId: null,
  playerToken: null,
  playerRole: null,
  playerName: null,
};

let currentView = null;
let pollInterval = null;
let selectedAction = null;

// ============================================================================
// PERSISTENCE
// ============================================================================

function saveSession() {
  localStorage.setItem("tvft_session", JSON.stringify(session));
}

function loadSession() {
  const stored = localStorage.getItem("tvft_session");
  if (stored) {
    try {
      session = JSON.parse(stored);
      return true;
    } catch { }
  }
  return false;
}

function clearSession() {
  session = { serverId: null, playerId: null, playerToken: null, playerRole: null, playerName: null };
  localStorage.removeItem("tvft_session");
}

// ============================================================================
// API CALLS
// ============================================================================

async function apiCall(method, path, body = null) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_URL}${path}`, opts);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function createServer(playerName, playerRole) {
  const data = await apiCall("POST", "/server/create", { playerName, playerRole });
  session.serverId = data.serverId;
  session.playerId = data.playerId;
  session.playerToken = data.playerToken;
  session.playerRole = playerRole;
  session.playerName = playerName;
  saveSession();
  return data;
}

async function joinServer(serverId, playerName, playerRole) {
  const data = await apiCall("POST", `/server/${serverId}/join`, { playerName, playerRole });
  session.serverId = serverId;
  session.playerId = data.playerId;
  session.playerToken = data.playerToken;
  session.playerRole = playerRole;
  session.playerName = playerName;
  saveSession();
  return data;
}

async function getPlayerView() {
  return apiCall("GET", `/server/${session.serverId}/view?playerId=${session.playerId}&token=${session.playerToken}`);
}

async function getServerStatus() {
  return apiCall("GET", `/server/${session.serverId}/status`);
}

async function submitAction(actionType, params = {}) {
  return apiCall("POST", `/server/${session.serverId}/action`, {
    playerId: session.playerId,
    playerToken: session.playerToken,
    action: { action_type: actionType, params },
  });
}

// ============================================================================
// ACTION DEFINITIONS
// ============================================================================

const ACTIONS = {
  citizen: [
    { type: "work", label: "Work", params: [] },
    { type: "consume", label: "Consume", params: [] },
    { type: "vote_law", label: "Vote on Law", params: [
      { name: "law_id", type: "text", label: "Law ID" },
      { name: "vote", type: "select", label: "Vote", options: ["for", "against", "abstain"] },
    ]},
    { type: "join_movement", label: "Join Movement", params: [
      { name: "movement_id", type: "text", label: "Movement ID" },
    ]},
    { type: "leave_movement", label: "Leave Movement", params: [] },
  ],
  business_owner: [
    { type: "produce", label: "Produce", params: [] },
    { type: "set_wages", label: "Set Wages", params: [
      { name: "wage_level", type: "number", label: "Wage Level (0.1-10)" },
    ]},
    { type: "lobby", label: "Lobby", params: [
      { name: "politician_id", type: "text", label: "Politician ID" },
      { name: "amount", type: "number", label: "Amount" },
    ]},
    { type: "evade_taxes", label: "Evade Taxes", params: [] },
    { type: "comply_taxes", label: "Comply", params: [] },
  ],
  politician: [
    { type: "propose_law", label: "Propose Law", params: [
      { name: "text", type: "textarea", label: "Law Text (free-form)" },
    ]},
    { type: "vote_law_politician", label: "Vote on Law", params: [
      { name: "law_id", type: "text", label: "Law ID" },
      { name: "vote", type: "select", label: "Vote", options: ["for", "against", "abstain"] },
    ]},
    { type: "allocate_budget", label: "Allocate Budget", params: [
      { name: "welfare", type: "number", label: "Welfare (0-1)" },
      { name: "infrastructure", type: "number", label: "Infrastructure (0-1)" },
      { name: "enforcement", type: "number", label: "Enforcement (0-1)" },
      { name: "education", type: "number", label: "Education (0-1)" },
      { name: "discretionary", type: "number", label: "Discretionary (0-1)" },
    ]},
    { type: "publish_statement", label: "Statement", params: [
      { name: "text", type: "textarea", label: "Statement Text" },
    ]},
  ],
};

// ============================================================================
// UI RENDERING
// ============================================================================

function $(id) { return document.getElementById(id); }

function showScreen(screen) {
  $("setup-screen").classList.toggle("hidden", screen !== "setup");
  $("game-screen").classList.toggle("hidden", screen !== "game");
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function renderView(data) {
  const view = data.view;
  currentView = view;

  // Meta bar
  $("meta-tick").textContent = view.tick;
  $("meta-role").textContent = view.role.replace("_", " ");
  $("meta-phase").textContent = data.phase;
  $("meta-wealth").textContent = view.wealth.toFixed(0);

  // Deadline countdown
  updateCountdown(data.tickDeadline);

  // Headlines
  const headlinesEl = $("headlines-list");
  headlinesEl.innerHTML = "";
  for (const h of view.headlines) {
    const div = document.createElement("div");
    div.className = "headline";
    div.innerHTML = `
      <div class="headline-text">${escapeHtml(h.text)}</div>
      <span class="headline-bias bias-${h.bias}">${h.bias}</span>
    `;
    headlinesEl.appendChild(div);
  }

  // Rumors
  const rumorsEl = $("rumors-list");
  rumorsEl.innerHTML = "";
  for (const r of view.rumors) {
    const div = document.createElement("div");
    div.className = "rumor";
    div.textContent = r.text;
    rumorsEl.appendChild(div);
  }

  // Market signals
  const ms = view.market_signals;
  $("signal-price").textContent = ms.price_trend;
  $("signal-price").className = `signal-value signal-${ms.price_trend === "rising" ? "rising" : ms.price_trend === "falling" ? "falling" : "stable"}`;
  $("signal-availability").textContent = ms.availability;
  $("signal-availability").className = `signal-value signal-${ms.availability === "shortage" ? "bad" : ms.availability === "scarce" ? "warn" : "good"}`;

  // Government signals
  const gs = view.government_signals;
  $("signal-approval").textContent = gs.approval_vague;
  $("signal-approval").className = `signal-value signal-${gs.approval_vague === "crisis" ? "bad" : gs.approval_vague === "unpopular" ? "warn" : "good"}`;
  $("signal-laws").textContent = gs.active_laws;

  // Role-specific
  const rsEl = $("role-specific");
  rsEl.innerHTML = "";
  for (const [key, val] of Object.entries(view.role_specific)) {
    const div = document.createElement("div");
    div.className = "signal-card";
    div.innerHTML = `
      <div class="signal-label">${key.replace(/_/g, " ")}</div>
      <div class="signal-value">${val}</div>
    `;
    rsEl.appendChild(div);
  }

  // Actions
  renderActions(view.role);

  // Status bar
  $("status-phase").textContent = data.phase;
  const dot = $("status-dot");
  dot.className = `status-dot ${data.phase === "accepting_actions" ? "online" : "processing"}`;
}

function renderActions(role) {
  const actions = ACTIONS[role] || [];
  const grid = $("action-grid");
  grid.innerHTML = "";

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = "action-btn";
    btn.textContent = action.label;
    btn.onclick = () => selectAction(action);
    grid.appendChild(btn);
  }

  $("action-params").classList.add("hidden");
}

function selectAction(action) {
  selectedAction = action;

  // Highlight selected
  document.querySelectorAll(".action-btn").forEach((btn, i) => {
    const actions = ACTIONS[session.playerRole] || [];
    btn.classList.toggle("selected", actions[i]?.type === action.type);
  });

  const paramsEl = $("action-params");

  if (action.params.length === 0) {
    // No params — submit immediately
    paramsEl.classList.add("hidden");
    doSubmitAction(action.type, {});
    return;
  }

  // Show param form
  paramsEl.classList.remove("hidden");
  paramsEl.innerHTML = "";

  for (const param of action.params) {
    const group = document.createElement("div");
    group.className = "form-group";

    const label = document.createElement("label");
    label.textContent = param.label;
    group.appendChild(label);

    let input;
    if (param.type === "select") {
      input = document.createElement("select");
      for (const opt of param.options || []) {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        input.appendChild(option);
      }
    } else if (param.type === "textarea") {
      input = document.createElement("textarea");
    } else {
      input = document.createElement("input");
      input.type = param.type;
    }

    input.id = `param-${param.name}`;
    group.appendChild(input);
    paramsEl.appendChild(group);
  }

  const submitBtn = document.createElement("button");
  submitBtn.className = "btn btn-primary";
  submitBtn.textContent = `Submit ${action.label}`;
  submitBtn.onclick = () => {
    const params = {};
    for (const param of action.params) {
      const el = $(`param-${param.name}`);
      if (!el) continue;
      let val = el.value;
      if (param.type === "number") val = parseFloat(val);
      params[param.name] = val;
    }

    // Special case: allocate_budget sends nested allocation
    if (action.type === "allocate_budget") {
      doSubmitAction(action.type, { allocation: params });
    } else {
      doSubmitAction(action.type, params);
    }
  };
  paramsEl.appendChild(submitBtn);
}

async function doSubmitAction(type, params) {
  try {
    const result = await submitAction(type, params);
    showToast(`Action submitted (${result.pendingCount} pending)`);
    $("action-params").classList.add("hidden");
  } catch (err) {
    showToast(err.message, "error");
  }
}

function updateCountdown(deadline) {
  const remaining = new Date(deadline) - Date.now();
  if (remaining <= 0) {
    $("meta-countdown").textContent = "processing...";
    return;
  }
  const hours = Math.floor(remaining / 3600000);
  const mins = Math.floor((remaining % 3600000) / 60000);
  $("meta-countdown").textContent = `${hours}h ${mins}m`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// POLLING
// ============================================================================

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const data = await getPlayerView();
      renderView(data);
    } catch (err) {
      console.warn("Poll failed:", err.message);
    }
  }, 10000); // every 10 seconds
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============================================================================
// SETUP HANDLERS
// ============================================================================

function initSetup() {
  $("btn-create").onclick = async () => {
    const name = $("setup-name").value.trim();
    const role = $("setup-role").value;
    if (!name) { showToast("Enter your name", "error"); return; }

    try {
      $("btn-create").disabled = true;
      $("btn-create").textContent = "Creating...";
      await createServer(name, role);
      showToast("Server created!");
      enterGame();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      $("btn-create").disabled = false;
      $("btn-create").textContent = "Create New Server";
    }
  };

  $("btn-join").onclick = async () => {
    const name = $("setup-name").value.trim();
    const role = $("setup-role").value;
    const serverId = $("setup-server-id").value.trim();
    if (!name) { showToast("Enter your name", "error"); return; }
    if (!serverId) { showToast("Enter server ID", "error"); return; }

    try {
      $("btn-join").disabled = true;
      $("btn-join").textContent = "Joining...";
      await joinServer(serverId, name, role);
      showToast("Joined server!");
      enterGame();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      $("btn-join").disabled = false;
      $("btn-join").textContent = "Join Server";
    }
  };

  $("btn-disconnect").onclick = () => {
    stopPolling();
    clearSession();
    showScreen("setup");
  };
}

async function enterGame() {
  showScreen("game");
  $("player-name-display").textContent = session.playerName;

  try {
    const data = await getPlayerView();
    renderView(data);
  } catch (err) {
    showToast("Failed to load view: " + err.message, "error");
  }

  startPolling();
}

// ============================================================================
// INIT
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initSetup();

  // Resume existing session
  if (loadSession() && session.serverId && session.playerId) {
    enterGame();
  } else {
    showScreen("setup");
  }
});
