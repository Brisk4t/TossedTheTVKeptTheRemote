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
const STORAGE_KEY  = "ir-hid-layout";
const LAYOUTS_KEY  = "ir-hid-layouts";

const DEFAULT_MODE_COLORS = [
  "0x290118", "0x012329", "0x122900", "0x291200", "0x001229",
];

// Default layouts use the new {name, buttons:[{slot,col,row}]} format
const DEFAULT_LAYOUTS = [
  {
    name: "5×4 Grid",
    buttons: Array.from({ length: 20 }, (_, i) => ({ slot: i, col: i % 5, row: Math.floor(i / 5) })),
  },
  {
    name: "4×4 Grid",
    buttons: Array.from({ length: 16 }, (_, i) => ({ slot: i, col: i % 4, row: Math.floor(i / 4) })),
  },
  {
    name: "3×3 Grid",
    buttons: Array.from({ length: 9 }, (_, i) => ({ slot: i, col: i % 3, row: Math.floor(i / 3) })),
  },
];

// ── State ─────────────────────────────────────────────────────
let port, reader, writer;
let readLoopActive     = false;
let currentModeIndex   = 0;
let selectedIndex      = 0;
let learnArmed         = false;
let layouts            = DEFAULT_LAYOUTS.map(migrateLayout);
let currentLayoutIndex = 0;
let layoutEditMode     = false;
let draggedSlot        = null;   // slot index being dragged

const defaultLabels = Array.from({ length: MAX_MAPPINGS }, (_, i) => `B${i + 1}`);
let labels   = [...defaultLabels];
let settings = null;

// ── Layout migration ──────────────────────────────────────────
// Converts old {name, columns, count} format to {name, buttons:[…]}
function migrateLayout(layout) {
  if (Array.isArray(layout.buttons)) return layout;
  const cols = layout.columns || 5;
  const count = layout.count || 0;
  return {
    name: layout.name,
    buttons: Array.from({ length: count }, (_, i) => ({
      slot: i, col: i % cols, row: Math.floor(i / cols),
    })),
  };
}

function getCurrentLayout() {
  return layouts[currentLayoutIndex] || { name: "Default", buttons: [] };
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
    ?? DEFAULT_MODE_COLORS[currentModeIndex]
    ?? "0x000000";
  modeColorPicker.value = settingsColorToCss(raw);
}

// ── Preset helpers ────────────────────────────────────────────
function findPreset(key, type) {
  if (type === "mode_switch") return "mode_switch";
  if (!key) return "custom";
  const target = `${type}:${key.toUpperCase()}`;
  for (const opt of keyPresetSelect.options) {
    if (opt.value !== "custom" && opt.value !== "mode_switch" &&
        opt.value.toUpperCase() === target) return opt.value;
  }
  return "custom";
}

function applyPresetUi(preset) {
  const isModeSwitch = preset === "mode_switch";
  const isCustom     = preset === "custom";
  keyInput.style.display              = isCustom  ? "" : "none";
  typeSelect.closest("label").style.display = isModeSwitch ? "none" : "";
  if (!isModeSwitch && !isCustom) {
    const [type] = preset.split(":");
    typeSelect.value = type;
  }
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

// Editor is always the source of truth on Apply
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

  if (!Array.isArray(settings.led.modeColors)) {
    const km = settings.led.keyboardModeColor || DEFAULT_MODE_COLORS[0];
    const cm = settings.led.consumerModeColor || DEFAULT_MODE_COLORS[1];
    settings.led.modeColors = [km, cm];
    delete settings.led.keyboardModeColor;
    delete settings.led.consumerModeColor;
  }

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
    if (Array.isArray(parsed) && parsed.length > 0) {
      layouts = parsed.map(migrateLayout);
    }
  } catch {}
}

function renderLayoutTabs() {
  const tabsEl = document.getElementById("layoutTabs");
  tabsEl.innerHTML = "";
  layouts.forEach((layout, i) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (i === currentLayoutIndex ? " active" : "");
    btn.textContent = layout.name;
    btn.addEventListener("click", () => switchLayout(i));
    tabsEl.appendChild(btn);
  });
}

function switchLayout(index) {
  currentLayoutIndex = index;
  const layout = getCurrentLayout();
  if (!layout.buttons.find(b => b.slot === selectedIndex)) {
    selectedIndex = layout.buttons[0]?.slot ?? 0;
  }
  setLayoutEditMode(false);
  renderLayoutTabs();
  renderGrid();
  selectSlot(selectedIndex);
}

function setLayoutEditMode(active) {
  layoutEditMode = active;
  editLayoutBtn.textContent = active ? "Exit Edit" : "Edit Layout";
  layoutEditBar.style.display = active ? "flex" : "none";
  renderLayoutTabs();
  renderGrid();
}

// ── Grid ──────────────────────────────────────────────────────
function renderGrid() {
  const layout  = getCurrentLayout();
  const buttons = layout.buttons || [];

  const maxCol = buttons.length > 0 ? Math.max(...buttons.map(b => b.col)) : -1;
  const maxRow = buttons.length > 0 ? Math.max(...buttons.map(b => b.row)) : -1;

  // In edit mode show extra empty cells so there's always space to drop
  const canvasCols = Math.max(maxCol + (layoutEditMode ? 2 : 1), layoutEditMode ? 4 : 1);
  const canvasRows = Math.max(maxRow + (layoutEditMode ? 2 : 1), layoutEditMode ? 3 : 1);

  remoteGrid.style.setProperty("--layout-cols", canvasCols);
  remoteGrid.innerHTML = "";

  if (layoutEditMode) {
    const occupied = new Set(buttons.map(b => `${b.col},${b.row}`));
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
        cell.addEventListener("drop",      (e) => {
          e.preventDefault();
          cell.classList.remove("drag-over");
          dropToPosition(parseInt(cell.dataset.col), parseInt(cell.dataset.row));
        });
        remoteGrid.appendChild(cell);
      }
    }
  }

  for (const btn of buttons) {
    const slot      = getSlot(currentModeIndex, btn.slot);
    const typeLabel = slot.irCode ? slot.type : "";
    const button    = document.createElement("button");
    button.className    = "slot" + (btn.slot === selectedIndex ? " active" : "");
    button.style.gridColumn = btn.col + 1;
    button.style.gridRow    = btn.row + 1;
    button.dataset.slotIndex = btn.slot;

    if (layoutEditMode) {
      button.draggable = true;
      button.classList.add("slot-editing");
      button.innerHTML = `
        <span class="slot-drag-handle" title="Drag to move">&#10495;</span>
        <div class="slot-label">${labels[btn.slot]}</div>
        <span class="slot-remove" title="Remove">&times;</span>
      `;
      button.querySelector(".slot-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeButtonFromLayout(btn.slot);
      });
      button.addEventListener("dragstart", (e) => {
        draggedSlot = btn.slot;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => button.classList.add("dragging"), 0);
      });
      button.addEventListener("dragend", () => {
        draggedSlot = null;
        button.classList.remove("dragging");
      });
      button.addEventListener("dragover",  (e) => { e.preventDefault(); button.classList.add("drag-over"); });
      button.addEventListener("dragleave", () => button.classList.remove("drag-over"));
      button.addEventListener("drop",      (e) => {
        e.preventDefault();
        button.classList.remove("drag-over");
        if (draggedSlot !== null && draggedSlot !== btn.slot) swapButtons(draggedSlot, btn.slot);
      });
    } else {
      button.innerHTML = `
        <div>${labels[btn.slot]}</div>
        <small>${slot.irCode || "Unassigned"}${typeLabel ? ` &bull; ${typeLabel}` : ""}</small>
      `;
      button.addEventListener("click", () => selectSlot(btn.slot));
    }

    remoteGrid.appendChild(button);
  }
}

function dropToPosition(col, row) {
  if (draggedSlot === null) return;
  const layout = getCurrentLayout();
  const btn = layout.buttons.find(b => b.slot === draggedSlot);
  if (btn) { btn.col = col; btn.row = row; saveLayouts(); renderGrid(); }
}

function swapButtons(slotA, slotB) {
  const layout = getCurrentLayout();
  const a = layout.buttons.find(b => b.slot === slotA);
  const b = layout.buttons.find(b => b.slot === slotB);
  if (a && b) {
    [a.col, a.row, b.col, b.row] = [b.col, b.row, a.col, a.row];
    saveLayouts();
    renderGrid();
  }
}

function addButtonToLayout() {
  const layout = getCurrentLayout();
  const usedSlots = new Set(layout.buttons.map(b => b.slot));
  let nextSlot = -1;
  for (let i = 0; i < MAX_MAPPINGS; i++) {
    if (!usedSlots.has(i)) { nextSlot = i; break; }
  }
  if (nextSlot === -1) { logLine("All slots are already in this layout."); return; }

  // Place at first empty position in reading order across the canvas width
  const maxCol = layout.buttons.length > 0 ? Math.max(...layout.buttons.map(b => b.col)) + 1 : 5;
  const occupied = new Set(layout.buttons.map(b => `${b.col},${b.row}`));
  let col = 0, row = 0;
  while (occupied.has(`${col},${row}`)) {
    col++;
    if (col >= maxCol) { col = 0; row++; }
  }

  layout.buttons.push({ slot: nextSlot, col, row });
  saveLayouts();
  renderGrid();
}

function removeButtonFromLayout(slotIndex) {
  const layout = getCurrentLayout();
  layout.buttons = layout.buttons.filter(b => b.slot !== slotIndex);
  saveLayouts();
  renderGrid();
}

// ── Slot selection ────────────────────────────────────────────
function selectSlot(index) {
  selectedIndex = index;
  renderGrid();

  const slot   = getSlot(currentModeIndex, index);
  labelInput.value = labels[index] || "";
  irInput.value    = slot.irCode || "";

  const preset = findPreset(slot.key, slot.type || "keyboard");
  keyPresetSelect.value = preset;
  keyInput.value        = slot.key || "";
  applyPresetUi(preset);

  if (preset !== "mode_switch") {
    typeSelect.value = slot.type || "keyboard";
  }
}

function updateSlotFromInputs() {
  const slot = getSlot(currentModeIndex, selectedIndex);
  labels[selectedIndex] = labelInput.value.trim() || defaultLabels[selectedIndex];

  let key, type;
  const preset = keyPresetSelect.value;
  if (preset === "mode_switch") {
    key = ""; type = "mode_switch";
  } else if (preset !== "custom") {
    const [pType, pCode] = preset.split(":");
    key = pCode; type = pType;
    typeSelect.value = type;
  } else {
    key = keyInput.value.trim();
    type = typeSelect.value;
  }

  setSlot(currentModeIndex, selectedIndex, { irCode: slot.irCode, key, type });
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

editLayoutBtn.addEventListener("click", () => setLayoutEditMode(!layoutEditMode));
doneEditBtn.addEventListener("click",   () => setLayoutEditMode(false));
addSlotBtn.addEventListener("click",    addButtonToLayout);

addLayoutBtn.addEventListener("click", () => newLayoutForm.classList.toggle("visible"));
cancelLayoutBtn.addEventListener("click", () => newLayoutForm.classList.remove("visible"));

saveLayoutBtn.addEventListener("click", () => {
  const name = layoutNameInput.value.trim();
  if (!name) { logLine("Please enter a layout name."); return; }
  layouts.push({ name, buttons: [] });
  currentLayoutIndex = layouts.length - 1;
  saveLayouts();
  renderLayoutTabs();
  newLayoutForm.classList.remove("visible");
  layoutNameInput.value = "";
  setLayoutEditMode(true);   // immediately enter edit mode so user can add buttons
});

// Key preset controls
keyPresetSelect.addEventListener("change", () => {
  const val = keyPresetSelect.value;
  applyPresetUi(val);
  if (val === "custom") { keyInput.focus(); return; }
  if (val !== "mode_switch") {
    const [, code] = val.split(":");
    keyInput.value = code;
  }
  updateSlotFromInputs();
});

keyInput.addEventListener("input", () => {
  keyPresetSelect.value = "custom";
  applyPresetUi("custom");
  updateSlotFromInputs();
});

typeSelect.addEventListener("change", () => {
  const val = keyPresetSelect.value;
  if (val !== "custom" && val !== "mode_switch") {
    const [presetType] = val.split(":");
    if (typeSelect.value !== presetType) {
      keyPresetSelect.value = "custom";
      applyPresetUi("custom");
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
layoutEditBar.style.display = "none";
renderLayoutTabs();
renderTabs();
renderGrid();
selectSlot(0);
updateModeColorPicker();
