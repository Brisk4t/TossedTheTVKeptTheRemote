// ── DOM refs ──────────────────────────────────────────────────
const statusEl        = document.getElementById("status");
const logEl           = document.getElementById("log");
const logToggleBtn    = document.getElementById("logToggle");
const editor          = document.getElementById("jsonEditor");
const remoteGrid      = document.getElementById("remoteGrid");
const labelInput      = document.getElementById("labelInput");
const irInput         = document.getElementById("irInput");
const keyPresetSelect = document.getElementById("keyPresetSelect");
const keyInput        = document.getElementById("keyInput");
const typeSelect      = document.getElementById("typeSelect");
const learnBtn        = document.getElementById("learnBtn");
const clearBtn        = document.getElementById("clearBtn");
const jsonPanel       = document.getElementById("jsonPanel");
const toggleJsonBtn   = document.getElementById("toggleJsonBtn");
const modeColorPicker = document.getElementById("modeColorPicker");
const layoutSelect    = document.getElementById("layoutSelect");
const addLayoutBtn    = document.getElementById("addLayoutBtn");
const newLayoutForm   = document.getElementById("newLayoutForm");
const layoutNameInput = document.getElementById("layoutNameInput");
const layoutColsInput = document.getElementById("layoutColsInput");
const layoutCountInput= document.getElementById("layoutCountInput");
const saveLayoutBtn   = document.getElementById("saveLayoutBtn");
const cancelLayoutBtn = document.getElementById("cancelLayoutBtn");
const connectBtn      = document.getElementById("connectBtn");
const disconnectBtn   = document.getElementById("disconnectBtn");
const getBtn          = document.getElementById("getBtn");
const applyBtn        = document.getElementById("applyBtn");

// ── Constants ─────────────────────────────────────────────────
const MAX_MAPPINGS = 20;
const MAX_MODES    = 5;
const STORAGE_KEY  = "ir-hid-layout";
const LAYOUTS_KEY  = "ir-hid-layouts";

const DEFAULT_MODE_COLORS = [
  "0x290118", "0x012329", "0x122900", "0x291200", "0x001229",
];

const DEFAULT_LAYOUTS = [
  { name: "5×4 Grid", columns: 5, count: 20 },
  { name: "4×4 Grid", columns: 4, count: 16 },
  { name: "3×3 Grid", columns: 3, count: 9  },
];

// ── State ─────────────────────────────────────────────────────
let port, reader, writer;
let readLoopActive   = false;
let currentModeIndex = 0;
let selectedIndex    = 0;
let learnArmed       = false;
let layouts          = [...DEFAULT_LAYOUTS];
let currentLayoutIndex = 0;

const defaultLabels = Array.from({ length: MAX_MAPPINGS }, (_, i) => `B${i + 1}`);
let labels   = [...defaultLabels];
let settings = null;

// ── Color helpers ─────────────────────────────────────────────
function settingsColorToCss(hex) {
  return "#" + hex.replace(/^0x/i, "").slice(-6).padStart(6, "0");
}

function cssColorToSettings(css) {
  return "0x" + css.replace("#", "").toUpperCase();
}

function updateModeColorPicker() {
  const colors = settings?.led?.modeColors;
  const raw = (colors && colors[currentModeIndex])
    ?? DEFAULT_MODE_COLORS[currentModeIndex]
    ?? "0x000000";
  modeColorPicker.value = settingsColorToCss(raw);
}

// ── Preset helpers ────────────────────────────────────────────
function findPreset(key, type) {
  if (!key) return "custom";
  const target = `${type}:${key.toUpperCase()}`;
  for (const opt of keyPresetSelect.options) {
    if (opt.value !== "custom" && opt.value.toUpperCase() === target) return opt.value;
  }
  return "custom";
}

// ── Log ───────────────────────────────────────────────────────
function logLine(text) {
  const line = document.createElement("div");
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

logToggleBtn.addEventListener("click", () => {
  const visible = logEl.classList.toggle("visible");
  logToggleBtn.querySelector(".chevron").innerHTML = visible ? "&#9650;" : "&#9660;";
});

// ── Connection ────────────────────────────────────────────────
function setConnected(connected) {
  statusEl.textContent   = connected ? "Connected" : "Disconnected";
  statusEl.style.color   = connected ? "#7bd8d6" : "#e0b45c";
  disconnectBtn.disabled = !connected;
  getBtn.disabled        = !connected;
  applyBtn.disabled      = !connected;
  learnBtn.disabled      = !connected;
  clearBtn.disabled      = !connected;
}

async function connect() {
  try {
    port   = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    setConnected(true);
    logLine("Connected to device.");
    startReadLoop();
  } catch (err) {
    logLine(`Connect failed: ${err.message}`);
  }
}

async function disconnect() {
  readLoopActive = false;
  try {
    if (reader) { await reader.cancel(); reader.releaseLock(); }
    if (writer) { writer.releaseLock(); }
    if (port)   { await port.close(); }
  } catch (err) {
    logLine(`Disconnect error: ${err.message}`);
  } finally {
    port = null; reader = null; writer = null;
    setConnected(false);
  }
}

async function startReadLoop() {
  if (!reader) return;
  readLoopActive = true;
  const decoder = new TextDecoder();
  let buffer = "";

  while (readLoopActive) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) handleResponse(line);
    }
  }
}

function handleResponse(line) {
  logLine(`<= ${line}`);
  if (!line.trim().startsWith("{")) return;
  let payload;
  try { payload = JSON.parse(line); } catch { logLine("Response parse error."); return; }

  if (payload.data) {
    settings = payload.data;
    ensureSettings();
    editor.value = JSON.stringify(settings, null, 2);
    renderTabs();
    renderGrid();
    selectSlot(selectedIndex);
    updateModeColorPicker();
    return;
  }

  if (payload.event === "learn") {
    if (!learnArmed) return;
    const slot = getSlot(currentModeIndex, selectedIndex);
    setSlot(currentModeIndex, selectedIndex, { irCode: payload.code, key: slot.key, type: slot.type });
    learnArmed = false;
    syncEditor();
    renderGrid();
    selectSlot(selectedIndex);
    logLine("Learned IR code.");
  }
}

async function sendCommand(obj) {
  if (!writer) return;
  const encoder = new TextEncoder();
  const message = JSON.stringify(obj) + "\n";
  logLine(`=> ${message.trim()}`);
  await writer.write(encoder.encode(message));
}

async function getSettings() { await sendCommand({ op: "get" }); }

// Editor is always the source of truth — parse it first so manual JSON edits are honoured
async function applySettings() {
  try {
    const parsed = JSON.parse(editor.value);
    settings = parsed;
    ensureSettings();
  } catch {
    ensureSettings();
    logLine("JSON parse error — sending current settings.");
  }
  syncEditor();
  await sendCommand({ op: "set", data: settings });
}

// Keep the JSON editor in sync whenever settings changes via the UI
function syncEditor() {
  editor.value = JSON.stringify(settings, null, 2);
}

// ── Settings ──────────────────────────────────────────────────
function defaultSettings() {
  return {
    ir: {
      modeChangeCode: "0xC40387EE",
      modeCount: 2,
      receivePin: 28,
      handleRepeat: true,
      repeatInitialDelayReports: 5,
    },
    led: {
      pin: 16,
      modeColors: ["0x290118", "0x012329"],
      brightnessPercent: 10,
    },
    modes: [
      { name: "Mode 1", slots: [] },
      { name: "Mode 2", slots: [] },
    ],
  };
}

function ensureSettings() {
  if (!settings) settings = defaultSettings();

  // Migrate legacy top-level keyboard/consumer arrays
  if (!Array.isArray(settings.modes)) {
    const lk = settings.keyboard || [];
    const lc = settings.consumer || [];
    settings.modes = [
      { name: "Mode 1", slots: [] },
      { name: "Mode 2", slots: [] },
    ];
    lk.forEach((e) => settings.modes[0].slots.push({ irCode: e.irCode, type: "keyboard", key: e.key }));
    lc.forEach((e) => settings.modes[0].slots.push({ irCode: e.irCode, type: "consumer", key: e.key }));
    delete settings.keyboard;
    delete settings.consumer;
  }

  while (settings.modes.length < 2) {
    const idx = settings.modes.length;
    settings.modes.push({ name: `Mode ${idx + 1}`, slots: [] });
  }

  settings.modes.forEach((mode) => {
    if (!Array.isArray(mode.slots)) mode.slots = [];
    while (mode.slots.length < MAX_MAPPINGS) mode.slots.push({});
  });

  if (!settings.led) settings.led = defaultSettings().led;

  // Migrate legacy keyboardModeColor / consumerModeColor to modeColors array
  if (!Array.isArray(settings.led.modeColors)) {
    const km = settings.led.keyboardModeColor || DEFAULT_MODE_COLORS[0];
    const cm = settings.led.consumerModeColor || DEFAULT_MODE_COLORS[1];
    settings.led.modeColors = [km, cm];
    delete settings.led.keyboardModeColor;
    delete settings.led.consumerModeColor;
  }

  // Ensure one color entry per mode
  while (settings.led.modeColors.length < settings.modes.length) {
    const idx = settings.led.modeColors.length;
    settings.led.modeColors.push(DEFAULT_MODE_COLORS[idx] || "0x000000");
  }

  if (!settings.ir) settings.ir = defaultSettings().ir;
  settings.ir.modeCount = settings.modes.length;
}

// ── Slots ─────────────────────────────────────────────────────
function getSlot(modeIndex, index) {
  ensureSettings();
  const slot = settings.modes[modeIndex]?.slots[index] || {};
  return { irCode: slot.irCode || "", type: slot.type || "keyboard", key: slot.key || "" };
}

function setSlot(modeIndex, index, data) {
  ensureSettings();
  settings.modes[modeIndex].slots[index] = {
    irCode: data.irCode || "",
    type:   data.type   || "keyboard",
    key:    data.key    || "",
  };
}

// ── Tabs ──────────────────────────────────────────────────────
function renderTabs() {
  const tabsEl = document.getElementById("modeTabs");
  tabsEl.innerHTML = "";

  (settings?.modes || []).forEach((mode, i) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (i === currentModeIndex ? " active" : "");
    btn.textContent = mode.name || `Mode ${i + 1}`;
    btn.addEventListener("click", () => switchMode(i));
    tabsEl.appendChild(btn);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "tab tab-add";
  addBtn.textContent = "+";
  addBtn.title = "Add Mode";
  addBtn.disabled = (settings?.modes?.length ?? 0) >= MAX_MODES;
  addBtn.addEventListener("click", addMode);
  tabsEl.appendChild(addBtn);
}

function switchMode(index) {
  currentModeIndex = index;
  renderTabs();
  renderGrid();
  selectSlot(selectedIndex);
  updateModeColorPicker();
}

function addMode() {
  ensureSettings();
  if (settings.modes.length >= MAX_MODES) return;
  const newIndex = settings.modes.length;
  settings.modes.push({
    name: `Mode ${newIndex + 1}`,
    slots: Array.from({ length: MAX_MAPPINGS }, () => ({})),
  });
  settings.led.modeColors.push(DEFAULT_MODE_COLORS[newIndex] || "0x000000");
  settings.ir.modeCount = settings.modes.length;
  syncEditor();
  switchMode(newIndex);
}

// ── Layouts ───────────────────────────────────────────────────
function saveLayouts() { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts)); }

function loadLayouts() {
  const raw = localStorage.getItem(LAYOUTS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) layouts = parsed;
  } catch {}
}

function renderLayoutSelect() {
  layoutSelect.innerHTML = "";
  layouts.forEach((layout, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = layout.name;
    layoutSelect.appendChild(opt);
  });
  layoutSelect.value = currentLayoutIndex;
}

// ── Grid ──────────────────────────────────────────────────────
function renderGrid() {
  const layout = layouts[currentLayoutIndex] || DEFAULT_LAYOUTS[0];
  remoteGrid.style.setProperty("--layout-cols", layout.columns);
  remoteGrid.innerHTML = "";

  for (let i = 0; i < layout.count; i++) {
    const slot      = getSlot(currentModeIndex, i);
    const typeLabel = slot.irCode ? slot.type : "";
    const button    = document.createElement("button");
    button.className = "slot" + (i === selectedIndex ? " active" : "");
    button.dataset.index = i;
    button.innerHTML = `
      <div>${labels[i]}</div>
      <small>${slot.irCode || "Unassigned"}${typeLabel ? ` &bull; ${typeLabel}` : ""}</small>
    `;
    button.addEventListener("click", () => selectSlot(i));
    remoteGrid.appendChild(button);
  }
}

function selectSlot(index) {
  selectedIndex = index;
  renderGrid();

  const slot  = getSlot(currentModeIndex, index);
  labelInput.value = labels[index] || "";
  irInput.value    = slot.irCode || "";
  typeSelect.value = slot.type || "keyboard";

  const preset = findPreset(slot.key, slot.type || "keyboard");
  keyPresetSelect.value  = preset;
  keyInput.value         = slot.key || "";
  keyInput.style.display = preset === "custom" ? "" : "none";
}

function updateSlotFromInputs() {
  const slot = getSlot(currentModeIndex, selectedIndex);
  labels[selectedIndex] = labelInput.value.trim() || defaultLabels[selectedIndex];
  setSlot(currentModeIndex, selectedIndex, {
    irCode: slot.irCode,
    key:    keyInput.value.trim(),
    type:   typeSelect.value,
  });
  saveLabels();
  syncEditor();
  renderGrid();
}

function saveLabels() { localStorage.setItem(STORAGE_KEY, JSON.stringify(labels)); }

function loadLabels() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === MAX_MAPPINGS) labels = parsed;
  } catch { labels = [...defaultLabels]; }
}

async function requestLearn() {
  learnArmed = true;
  await sendCommand({ op: "learn" });
  logLine("Waiting for IR code...");
}

function clearSlot() {
  setSlot(currentModeIndex, selectedIndex, { irCode: "", key: "", type: "keyboard" });
  syncEditor();
  renderGrid();
  selectSlot(selectedIndex);
}

// ── Event listeners ───────────────────────────────────────────
connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
getBtn.addEventListener("click", getSettings);
applyBtn.addEventListener("click", applySettings);
learnBtn.addEventListener("click", requestLearn);
clearBtn.addEventListener("click", clearSlot);
toggleJsonBtn.addEventListener("click", () => jsonPanel.classList.toggle("visible"));

modeColorPicker.addEventListener("input", () => {
  if (!settings.led) settings.led = {};
  if (!Array.isArray(settings.led.modeColors)) {
    settings.led.modeColors = Array.from(
      { length: settings.modes?.length || 2 },
      (_, i) => DEFAULT_MODE_COLORS[i] || "0x000000"
    );
  }
  while (settings.led.modeColors.length <= currentModeIndex) {
    settings.led.modeColors.push("0x000000");
  }
  settings.led.modeColors[currentModeIndex] = cssColorToSettings(modeColorPicker.value);
  syncEditor();
});

// Layout controls
layoutSelect.addEventListener("change", () => {
  currentLayoutIndex = Number(layoutSelect.value);
  const layout = layouts[currentLayoutIndex];
  if (selectedIndex >= layout.count) selectedIndex = 0;
  renderGrid();
  selectSlot(selectedIndex);
});

addLayoutBtn.addEventListener("click", () => newLayoutForm.classList.toggle("visible"));
cancelLayoutBtn.addEventListener("click", () => newLayoutForm.classList.remove("visible"));

saveLayoutBtn.addEventListener("click", () => {
  const name    = layoutNameInput.value.trim();
  const columns = parseInt(layoutColsInput.value, 10);
  const count   = parseInt(layoutCountInput.value, 10);
  if (!name || !columns || !count || columns < 1 || columns > 10 || count < 1 || count > MAX_MAPPINGS) {
    logLine("Invalid layout: provide a name, 1–10 columns, 1–20 buttons.");
    return;
  }
  layouts.push({ name, columns, count });
  currentLayoutIndex = layouts.length - 1;
  saveLayouts();
  renderLayoutSelect();
  renderGrid();
  newLayoutForm.classList.remove("visible");
  layoutNameInput.value  = "";
  layoutColsInput.value  = "";
  layoutCountInput.value = "";
});

// Key preset controls
keyPresetSelect.addEventListener("change", () => {
  const val = keyPresetSelect.value;
  if (val === "custom") {
    keyInput.style.display = "";
    keyInput.focus();
    return;
  }
  const [type, code] = val.split(":");
  keyInput.value         = code;
  keyInput.style.display = "none";
  typeSelect.value       = type;
  updateSlotFromInputs();
});

keyInput.addEventListener("input", () => {
  keyPresetSelect.value  = "custom";
  keyInput.style.display = "";
  updateSlotFromInputs();
});

typeSelect.addEventListener("change", () => {
  if (keyPresetSelect.value !== "custom") {
    const [presetType] = keyPresetSelect.value.split(":");
    if (typeSelect.value !== presetType) {
      keyPresetSelect.value  = "custom";
      keyInput.style.display = "";
    }
  }
  updateSlotFromInputs();
});

labelInput.addEventListener("input", updateSlotFromInputs);

// ── Init ──────────────────────────────────────────────────────
setConnected(false);
loadLabels();
loadLayouts();
settings = defaultSettings();
editor.value = JSON.stringify(settings, null, 2);
renderLayoutSelect();
renderTabs();
renderGrid();
selectSlot(0);
updateModeColorPicker();
