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
const addLayoutBtn    = document.getElementById("addLayoutBtn");
const editLayoutBtn   = document.getElementById("editLayoutBtn");
const layoutEditBar   = document.getElementById("layoutEditBar");
const addSlotBtn      = document.getElementById("addSlotBtn");
const doneEditBtn     = document.getElementById("doneEditBtn");
const newLayoutForm   = document.getElementById("newLayoutForm");
const layoutNameInput = document.getElementById("layoutNameInput");
const saveLayoutBtn   = document.getElementById("saveLayoutBtn");
const cancelLayoutBtn = document.getElementById("cancelLayoutBtn");
const connectBtn      = document.getElementById("connectBtn");
const disconnectBtn   = document.getElementById("disconnectBtn");
const getBtn          = document.getElementById("getBtn");
const applyBtn        = document.getElementById("applyBtn");

// ── Constants ─────────────────────────────────────────────────
const MAX_MAPPINGS = 20;
const MAX_MODES    = 5;
const LABELS_KEY   = "ir-hid-labels";

const DEFAULT_MODE_COLORS = [
  "0x290118", "0x012329", "0x122900", "0x291200", "0x001229",
];

// ── State ─────────────────────────────────────────────────────
let port, reader, writer;
let readLoopActive      = false;
let currentModeIndex    = 0;
let currentLayoutIndex  = 0;
let selectedBtnIdx      = null;   // index into getCurrentLayout().buttons
let learnArmed          = false;
let layoutEditMode      = false;
let draggedBtnIdx       = null;   // index in buttons array being dragged

// Labels are keyed by irCode → label string, stored in localStorage
let labels = {};

let settings = null;

// ── Label helpers ─────────────────────────────────────────────
function getLabel(irCode) {
  if (!irCode) return "—";
  return labels[irCode] || irCode.slice(-4).toUpperCase();
}
function setLabel(irCode, text) { if (irCode) labels[irCode] = text; }
function saveLabels() { localStorage.setItem(LABELS_KEY, JSON.stringify(labels)); }
function loadLabels() {
  try { labels = JSON.parse(localStorage.getItem(LABELS_KEY) || "{}") || {}; } catch {}
}

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
    ?? DEFAULT_MODE_COLORS[currentModeIndex] ?? "0x000000";
  modeColorPicker.value = settingsColorToCss(raw);
}

// ── Preset helpers ────────────────────────────────────────────
function normalizeHex(hex) {
  // "0x00E9" → "0xE9", "0x04" → "0x4", "0x0" → "0x0"
  return hex.replace(/^0x0*([0-9a-fA-F])/i, "0x$1");
}

function findPreset(key, type) {
  if (type === "mode_switch") return "mode_switch";
  if (!key) return "custom";
  const target = `${type}:${normalizeHex(key)}`.toUpperCase();
  for (const opt of keyPresetSelect.options) {
    if (opt.value !== "custom" && opt.value !== "mode_switch" &&
        opt.value.toUpperCase() === target) return opt.value;
  }
  return "custom";
}
function applyPresetUi(preset) {
  const isModeSwitch = preset === "mode_switch";
  const isCustom     = preset === "custom";
  keyInput.style.display = isCustom ? "" : "none";
  typeSelect.closest("label").style.display = isModeSwitch ? "none" : "";
  if (!isModeSwitch && !isCustom) typeSelect.value = preset.split(":")[0];
}

// ── Log ───────────────────────────────────────────────────────
function logLine(text) {
  const line = document.createElement("div");
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
logToggleBtn.addEventListener("click", () => {
  const v = logEl.classList.toggle("visible");
  logToggleBtn.querySelector(".chevron").innerHTML = v ? "&#9650;" : "&#9660;";
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
  } catch (err) { logLine(`Connect failed: ${err.message}`); }
}

async function disconnect() {
  readLoopActive = false;
  try {
    if (reader) { await reader.cancel(); reader.releaseLock(); }
    if (writer) { writer.releaseLock(); }
    if (port)   { await port.close(); }
  } catch (err) { logLine(`Disconnect error: ${err.message}`); }
  finally { port = null; reader = null; writer = null; setConnected(false); }
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
    for (const line of lines) { if (line.trim()) handleResponse(line); }
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
    currentLayoutIndex = Math.min(currentLayoutIndex, settings.layouts.length - 1);
    renderTabs();
    renderLayoutTabs();
    renderGrid();
    if (selectedBtnIdx !== null) selectButton(selectedBtnIdx);
    updateModeColorPicker();
    return;
  }

  if (payload.event === "learn") {
    if (!learnArmed) return;
    const layout = getCurrentLayout();
    const btn = layout.buttons[selectedBtnIdx];
    if (btn) {
      const oldCode = btn.irCode;
      btn.irCode = payload.code;
      // Transfer action from old code to new code in active mode
      if (oldCode && oldCode !== payload.code) {
        const oldSlot = getSlotByIrCode(currentModeIndex, oldCode);
        if (oldSlot.type) {
          setSlotByIrCode(currentModeIndex, payload.code, { type: oldSlot.type, key: oldSlot.key });
          removeSlotByIrCode(currentModeIndex, oldCode);
        }
      }
    }
    learnArmed = false;
    syncEditor();
    renderGrid();
    if (selectedBtnIdx !== null) selectButton(selectedBtnIdx);
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

function syncEditor() { editor.value = JSON.stringify(settings, null, 2); }

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
    layouts: [
      { name: "Default Layout", buttons: [] },
    ],
  };
}

function ensureSettings() {
  if (!settings) settings = defaultSettings();

  // Migrate legacy mode format
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
    settings.modes.push({ name: `Mode ${settings.modes.length + 1}`, slots: [] });
  }
  settings.modes.forEach((mode) => {
    if (!Array.isArray(mode.slots)) mode.slots = [];
    // Remove empty padding — modes use irCode lookup, not index
    mode.slots = mode.slots.filter(s => s && s.irCode);
  });

  if (!settings.led) settings.led = defaultSettings().led;
  if (!Array.isArray(settings.led.modeColors)) {
    const km = settings.led.keyboardModeColor || DEFAULT_MODE_COLORS[0];
    const cm = settings.led.consumerModeColor || DEFAULT_MODE_COLORS[1];
    settings.led.modeColors = [km, cm];
    delete settings.led.keyboardModeColor;
    delete settings.led.consumerModeColor;
  }
  while (settings.led.modeColors.length < settings.modes.length) {
    settings.led.modeColors.push(DEFAULT_MODE_COLORS[settings.led.modeColors.length] || "0x000000");
  }

  if (!settings.ir) settings.ir = defaultSettings().ir;
  settings.ir.modeCount = settings.modes.length;

  // Ensure layouts
  if (!Array.isArray(settings.layouts) || settings.layouts.length === 0) {
    settings.layouts = defaultSettings().layouts;
  }
  settings.layouts.forEach((layout) => {
    if (!Array.isArray(layout.buttons)) layout.buttons = [];
    layout.buttons.forEach((btn) => {
      if (btn.x === undefined) btn.x = 0;
      if (btn.y === undefined) btn.y = 0;
      if (btn.irCode === undefined) btn.irCode = "";
    });
  });
}

// ── Mode slot helpers (keyed by irCode) ───────────────────────
function getSlotByIrCode(modeIndex, irCode) {
  if (!irCode) return { irCode: "", type: "keyboard", key: "" };
  const slots = settings?.modes[modeIndex]?.slots || [];
  return slots.find(s => s.irCode === irCode) || { irCode, type: "", key: "" };
}

function setSlotByIrCode(modeIndex, irCode, { type, key }) {
  if (!irCode) return;
  ensureSettings();
  const slots = settings.modes[modeIndex].slots;
  const idx = slots.findIndex(s => s.irCode === irCode);
  const entry = { irCode, type: type || "keyboard", key: key || "" };
  if (idx >= 0) slots[idx] = entry;
  else if (slots.length < MAX_MAPPINGS) slots.push(entry);
  else logLine("Mode is full (20 bindings max).");
}

function removeSlotByIrCode(modeIndex, irCode) {
  if (!irCode) return;
  ensureSettings();
  settings.modes[modeIndex].slots = settings.modes[modeIndex].slots.filter(s => s.irCode !== irCode);
}

// ── Layout helpers ────────────────────────────────────────────
function getCurrentLayout() {
  ensureSettings();
  return settings.layouts[currentLayoutIndex] ?? settings.layouts[0];
}

// ── Mode tabs ─────────────────────────────────────────────────
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
  if (selectedBtnIdx !== null) selectButton(selectedBtnIdx);
  updateModeColorPicker();
}

function addMode() {
  ensureSettings();
  if (settings.modes.length >= MAX_MODES) return;
  settings.modes.push({ name: `Mode ${settings.modes.length + 1}`, slots: [] });
  settings.led.modeColors.push(DEFAULT_MODE_COLORS[settings.modes.length - 1] || "0x000000");
  settings.ir.modeCount = settings.modes.length;
  syncEditor();
  switchMode(settings.modes.length - 1);
}

// ── Layout tabs ───────────────────────────────────────────────
function renderLayoutTabs() {
  const tabsEl = document.getElementById("layoutTabs");
  tabsEl.innerHTML = "";
  (settings?.layouts || []).forEach((layout, i) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (i === currentLayoutIndex ? " active" : "");
    btn.textContent = layout.name || `Layout ${i + 1}`;
    btn.addEventListener("click", () => switchLayout(i));
    tabsEl.appendChild(btn);
  });
}

function switchLayout(index) {
  currentLayoutIndex = index;
  selectedBtnIdx = null;
  setLayoutEditMode(false);
  renderLayoutTabs();
  renderGrid();
  clearDetailPanel();
}

// ── Grid ──────────────────────────────────────────────────────
function renderGrid() {
  const layout  = getCurrentLayout();
  const buttons = layout.buttons || [];

  const maxX = buttons.length > 0 ? Math.max(...buttons.map(b => b.x)) : -1;
  const maxY = buttons.length > 0 ? Math.max(...buttons.map(b => b.y)) : -1;
  const canvasCols = Math.max(maxX + (layoutEditMode ? 2 : 1), layoutEditMode ? 4 : 1);
  const canvasRows = Math.max(maxY + (layoutEditMode ? 2 : 1), layoutEditMode ? 3 : 1);

  remoteGrid.style.setProperty("--layout-cols", canvasCols);
  remoteGrid.innerHTML = "";

  if (layoutEditMode) {
    const occupied = new Set(buttons.map(b => `${b.x},${b.y}`));
    for (let row = 0; row < canvasRows; row++) {
      for (let col = 0; col < canvasCols; col++) {
        if (occupied.has(`${col},${row}`)) continue;
        const cell = document.createElement("div");
        cell.className = "drop-cell";
        cell.style.gridColumn = col + 1;
        cell.style.gridRow    = row + 1;
        cell.dataset.col = col;
        cell.dataset.row = row;
        cell.addEventListener("dragover",  (e) => { e.preventDefault(); cell.classList.add("drag-over"); });
        cell.addEventListener("dragleave", ()  => cell.classList.remove("drag-over"));
        cell.addEventListener("drop", (e) => {
          e.preventDefault();
          cell.classList.remove("drag-over");
          dropBtnToPosition(draggedBtnIdx, parseInt(cell.dataset.col), parseInt(cell.dataset.row));
        });
        remoteGrid.appendChild(cell);
      }
    }
  }

  buttons.forEach((btn, idx) => {
    const slot      = getSlotByIrCode(currentModeIndex, btn.irCode);
    const hasAction = slot.type && slot.type !== "";
    const isSelected = idx === selectedBtnIdx;
    const button = document.createElement("button");
    button.className = "slot" + (isSelected ? " active" : "");
    button.style.gridColumn = btn.x + 1;
    button.style.gridRow    = btn.y + 1;

    if (layoutEditMode) {
      button.draggable = true;
      button.classList.add("slot-editing");
      button.innerHTML = `
        <span class="slot-drag-handle" title="Drag to move">&#10495;</span>
        <div class="slot-label">${getLabel(btn.irCode)}</div>
        <span class="slot-remove" title="Remove">&times;</span>
      `;
      button.querySelector(".slot-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeButtonFromLayout(idx);
      });
      button.addEventListener("dragstart", (e) => {
        draggedBtnIdx = idx;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => button.classList.add("dragging"), 0);
      });
      button.addEventListener("dragend", () => { draggedBtnIdx = null; button.classList.remove("dragging"); });
      button.addEventListener("dragover",  (e) => { e.preventDefault(); button.classList.add("drag-over"); });
      button.addEventListener("dragleave", () => button.classList.remove("drag-over"));
      button.addEventListener("drop", (e) => {
        e.preventDefault();
        button.classList.remove("drag-over");
        if (draggedBtnIdx !== null && draggedBtnIdx !== idx) swapButtons(draggedBtnIdx, idx);
      });
    } else {
      const actionTag = hasAction
        ? (slot.type === "mode_switch" ? "mode switch" : `${slot.type}: ${slot.key}`)
        : "";
      button.innerHTML = `
        <div>${getLabel(btn.irCode)}</div>
        <small>${btn.irCode ? btn.irCode.slice(-8) : "No code"}${actionTag ? ` &bull; ${actionTag}` : ""}</small>
      `;
      button.addEventListener("click", () => selectButton(idx));
    }

    remoteGrid.appendChild(button);
  });
}

function dropBtnToPosition(btnIdx, x, y) {
  if (btnIdx === null || btnIdx === undefined) return;
  const layout = getCurrentLayout();
  const btn = layout.buttons[btnIdx];
  if (btn) { btn.x = x; btn.y = y; syncEditor(); renderGrid(); }
}

function swapButtons(idxA, idxB) {
  const layout = getCurrentLayout();
  const a = layout.buttons[idxA];
  const b = layout.buttons[idxB];
  if (a && b) {
    [a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y];
    syncEditor();
    renderGrid();
  }
}

function addButtonToLayout() {
  const layout = getCurrentLayout();
  const occupied = new Set(layout.buttons.map(b => `${b.x},${b.y}`));
  const maxX = layout.buttons.length > 0 ? Math.max(...layout.buttons.map(b => b.x)) + 1 : 5;
  let x = 0, y = 0;
  while (occupied.has(`${x},${y}`)) { x++; if (x >= maxX) { x = 0; y++; } }
  layout.buttons.push({ irCode: "", x, y });
  syncEditor();
  renderGrid();
}

function removeButtonFromLayout(idx) {
  const layout = getCurrentLayout();
  layout.buttons.splice(idx, 1);
  if (selectedBtnIdx === idx) { selectedBtnIdx = null; clearDetailPanel(); }
  else if (selectedBtnIdx > idx) selectedBtnIdx--;
  syncEditor();
  renderGrid();
}

// ── Slot selection ────────────────────────────────────────────
function selectButton(idx) {
  selectedBtnIdx = idx;
  renderGrid();

  const layout = getCurrentLayout();
  const btn    = layout.buttons[idx];
  if (!btn) return;

  const irCode = btn.irCode || "";
  const slot   = getSlotByIrCode(currentModeIndex, irCode);

  labelInput.value = irCode ? (labels[irCode] || "") : "";
  irInput.value    = irCode;

  const type   = slot.type || "keyboard";
  const preset = findPreset(slot.key, type);
  keyPresetSelect.value = preset;
  keyInput.value        = slot.key || "";
  applyPresetUi(preset);
  if (preset !== "mode_switch") typeSelect.value = type;
}

function clearDetailPanel() {
  labelInput.value      = "";
  irInput.value         = "";
  keyPresetSelect.value = "custom";
  keyInput.value        = "";
  keyInput.style.display = "";
  typeSelect.closest("label").style.display = "";
  typeSelect.value = "keyboard";
}

function updateSlotFromInputs() {
  const layout = getCurrentLayout();
  const btn    = layout.buttons[selectedBtnIdx];
  if (!btn) return;

  const irCode = irInput.value.trim();
  if (irCode && irCode !== btn.irCode) {
    // IR code changed manually — update layout and transfer action
    const oldCode = btn.irCode;
    btn.irCode = irCode;
    if (oldCode) {
      const oldSlot = getSlotByIrCode(currentModeIndex, oldCode);
      if (oldSlot.type) {
        setSlotByIrCode(currentModeIndex, irCode, { type: oldSlot.type, key: oldSlot.key });
        removeSlotByIrCode(currentModeIndex, oldCode);
      }
    }
  }

  const code = btn.irCode;
  if (labelInput.value.trim()) setLabel(code, labelInput.value.trim());

  let key, type;
  const preset = keyPresetSelect.value;
  if (preset === "mode_switch") {
    key = ""; type = "mode_switch";
  } else if (preset !== "custom") {
    const [pType, pCode] = preset.split(":");
    key = pCode; type = pType; typeSelect.value = type;
  } else {
    key = keyInput.value.trim(); type = typeSelect.value;
  }

  if (code) setSlotByIrCode(currentModeIndex, code, { type, key });
  saveLabels();
  syncEditor();
  renderGrid();
}

function clearSlot() {
  const layout = getCurrentLayout();
  const btn    = layout.buttons[selectedBtnIdx];
  if (!btn) return;
  if (btn.irCode) removeSlotByIrCode(currentModeIndex, btn.irCode);
  btn.irCode = "";
  syncEditor();
  renderGrid();
  selectButton(selectedBtnIdx);
}

async function requestLearn() {
  if (selectedBtnIdx === null) { logLine("Select a button first."); return; }
  learnArmed = true;
  await sendCommand({ op: "learn" });
  logLine("Waiting for IR code...");
}

// ── Layout edit mode ──────────────────────────────────────────
function setLayoutEditMode(active) {
  layoutEditMode = active;
  editLayoutBtn.textContent = active ? "Exit Edit" : "Edit Layout";
  layoutEditBar.style.display = active ? "flex" : "none";
  renderLayoutTabs();
  renderGrid();
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
  if (!settings?.led) return;
  if (!Array.isArray(settings.led.modeColors)) {
    settings.led.modeColors = Array.from({ length: settings.modes?.length || 2 },
      (_, i) => DEFAULT_MODE_COLORS[i] || "0x000000");
  }
  while (settings.led.modeColors.length <= currentModeIndex)
    settings.led.modeColors.push("0x000000");
  settings.led.modeColors[currentModeIndex] = cssColorToSettings(modeColorPicker.value);
  syncEditor();
});

editLayoutBtn.addEventListener("click", () => setLayoutEditMode(!layoutEditMode));
doneEditBtn.addEventListener("click",   () => setLayoutEditMode(false));
addSlotBtn.addEventListener("click",    addButtonToLayout);

addLayoutBtn.addEventListener("click", () => newLayoutForm.classList.toggle("visible"));
cancelLayoutBtn.addEventListener("click", () => newLayoutForm.classList.remove("visible"));
saveLayoutBtn.addEventListener("click", () => {
  const name = layoutNameInput.value.trim();
  if (!name) { logLine("Please enter a layout name."); return; }
  ensureSettings();
  settings.layouts.push({ name, buttons: [] });
  currentLayoutIndex = settings.layouts.length - 1;
  syncEditor();
  renderLayoutTabs();
  newLayoutForm.classList.remove("visible");
  layoutNameInput.value = "";
  setLayoutEditMode(true);
});

keyPresetSelect.addEventListener("change", () => {
  const val = keyPresetSelect.value;
  applyPresetUi(val);
  if (val === "custom") { keyInput.focus(); return; }
  if (val !== "mode_switch") { const [, code] = val.split(":"); keyInput.value = code; }
  updateSlotFromInputs();
});

keyInput.addEventListener("input", () => {
  keyPresetSelect.value = "custom";
  applyPresetUi("custom");
  updateSlotFromInputs();
});

// irInput is now editable — changing it reassigns the layout button's IR code
irInput.addEventListener("change", updateSlotFromInputs);

typeSelect.addEventListener("change", () => {
  const val = keyPresetSelect.value;
  if (val !== "custom" && val !== "mode_switch") {
    const [presetType] = val.split(":");
    if (typeSelect.value !== presetType) { keyPresetSelect.value = "custom"; applyPresetUi("custom"); }
  }
  updateSlotFromInputs();
});

labelInput.addEventListener("input", updateSlotFromInputs);

// ── Init ──────────────────────────────────────────────────────
setConnected(false);
loadLabels();
settings = defaultSettings();
editor.value = JSON.stringify(settings, null, 2);
layoutEditBar.style.display = "none";
renderTabs();
renderLayoutTabs();
renderGrid();
clearDetailPanel();
updateModeColorPicker();
