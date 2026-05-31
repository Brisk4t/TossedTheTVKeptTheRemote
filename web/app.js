// ── DOM refs ──────────────────────────────────────────────────
const logEl           = document.getElementById("log");
const logToggleBtn    = document.getElementById("logToggle");
const editor          = document.getElementById("jsonEditor");
const remoteGrid      = document.getElementById("remoteGrid");
const labelInput      = document.getElementById("labelInput");
const irInput         = document.getElementById("irInput");
const keyPresetSelect  = document.getElementById("keyPresetSelect");
const comboEditor      = document.getElementById("comboEditor");
const comboStepList    = document.getElementById("comboStepList");
const comboCaptureBtn  = document.getElementById("comboCaptureBtn");
const learnBtn        = document.getElementById("learnBtn");
const clearBtn        = document.getElementById("clearBtn");
const jsonPanel       = document.getElementById("jsonPanel");
const toggleJsonBtn   = document.getElementById("toggleJsonBtn");
const modeColorPicker      = document.getElementById("modeColorPicker");
const modeColorSwatch      = document.getElementById("modeColorSwatch");
const hueDropdown          = document.getElementById("hueDropdown");
const huePickerWrap        = document.getElementById("huePickerWrap");
const ledBrightnessSlider  = document.getElementById("ledBrightnessSlider");
const ledBrightnessValue   = document.getElementById("ledBrightnessValue");
const addLayoutBtn         = document.getElementById("addLayoutBtn");
const editLayoutBtn   = document.getElementById("editLayoutBtn");
const layoutEditBar   = document.getElementById("layoutEditBar");
const addSlotBtn      = document.getElementById("addSlotBtn");
const autoAddBtn      = document.getElementById("autoAddBtn");
const layoutEditHint  = document.getElementById("layoutEditHint");
const doneEditBtn     = document.getElementById("doneEditBtn");
const newLayoutForm   = document.getElementById("newLayoutForm");
const layoutNameInput = document.getElementById("layoutNameInput");
const saveLayoutBtn   = document.getElementById("saveLayoutBtn");
const cancelLayoutBtn = document.getElementById("cancelLayoutBtn");
const detailTitle     = document.getElementById("detailTitle");
const mainLayout      = document.getElementById("mainLayout");
const connectBtn      = document.getElementById("connectBtn");
const applyBtn        = document.getElementById("applyBtn");

// ── Constants ─────────────────────────────────────────────────
const MAX_MAPPINGS = 20;
const MAX_MODES    = 5;
const LABELS_KEY   = "ir-hid-labels";

// Vivid full-brightness hues — firmware scales them down with brightnessPercent
const DEFAULT_MODE_COLORS = [
  "0xFF0040", "0x0080FF", "0x00FF80", "0xFF8000", "0xFF00FF",
];

// browser event.key → USB HID {type, key}
const KEY_TO_HID = {
  "AudioVolumeUp":      { type: "consumer", key: "0xE9" },
  "AudioVolumeDown":    { type: "consumer", key: "0xEA" },
  "AudioVolumeMute":    { type: "consumer", key: "0xE2" },
  "MediaPlayPause":     { type: "consumer", key: "0xCD" },
  "MediaTrackNext":     { type: "consumer", key: "0xB5" },
  "MediaTrackPrevious": { type: "consumer", key: "0xB6" },
  "MediaStop":          { type: "consumer", key: "0xB7" },
  "ArrowRight":         { type: "keyboard", key: "0x4F" },
  "ArrowLeft":          { type: "keyboard", key: "0x50" },
  "ArrowUp":            { type: "keyboard", key: "0x52" },
  "ArrowDown":          { type: "keyboard", key: "0x51" },
  "Home":               { type: "keyboard", key: "0x4A" },
  "End":                { type: "keyboard", key: "0x4D" },
  "PageUp":             { type: "keyboard", key: "0x4B" },
  "PageDown":           { type: "keyboard", key: "0x4E" },
  "Enter":              { type: "keyboard", key: "0x28" },
  "Escape":             { type: "keyboard", key: "0x29" },
  "Backspace":          { type: "keyboard", key: "0x2A" },
  "Tab":                { type: "keyboard", key: "0x2B" },
  "Delete":             { type: "keyboard", key: "0x4C" },
  " ":                  { type: "keyboard", key: "0x2C" },
  "F1":  { type: "keyboard", key: "0x3A" }, "F2":  { type: "keyboard", key: "0x3B" },
  "F3":  { type: "keyboard", key: "0x3C" }, "F4":  { type: "keyboard", key: "0x3D" },
  "F5":  { type: "keyboard", key: "0x3E" }, "F6":  { type: "keyboard", key: "0x3F" },
  "F7":  { type: "keyboard", key: "0x40" }, "F8":  { type: "keyboard", key: "0x41" },
  "F9":  { type: "keyboard", key: "0x42" }, "F10": { type: "keyboard", key: "0x43" },
  "F11": { type: "keyboard", key: "0x44" }, "F12": { type: "keyboard", key: "0x45" },
};

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
let savedSettingsJSON = null;
let autoAddActive = false;
let autoAddStep   = null;   // "ir" | "hid"
let autoAddIrCode = null;
let captureComboActive = false;
let comboSteps  = [];  // [{ type, key, mods? }]
let pendingMods = 0;   // bitmask from UI modifier toggles

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

function hueToHex(hue) {
  const h = ((hue % 360) + 360) % 360 / 360;
  const q = 1, p = 0; // HSL(h, 100%, 50%)
  const ch = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const r = Math.round(ch(h + 1/3) * 255);
  const g = Math.round(ch(h)       * 255);
  const b = Math.round(ch(h - 1/3) * 255);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function hexToHue(css) {
  const r = parseInt(css.slice(1,3), 16) / 255;
  const g = parseInt(css.slice(3,5), 16) / 255;
  const b = parseInt(css.slice(5,7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else                h = (r - g) / d + 4;
  return Math.round(h * 60) % 360;
}
function cssColorToSettings(css) {
  return "0x" + css.replace("#", "").toUpperCase();
}
function updateModeColorPicker() {
  const colors = settings?.led?.modeColors;
  const raw = (colors && colors[currentModeIndex])
    ?? DEFAULT_MODE_COLORS[currentModeIndex] ?? "0xFF0040";
  const hue = hexToHue(settingsColorToCss(raw));
  const hueColor = hueToHex(hue);
  modeColorPicker.value = hue;
  modeColorPicker.style.setProperty("--thumb-color", hueColor);
  modeColorSwatch.style.background = hueColor;
  ledBrightnessSlider.style.accentColor = hueColor;

  const pct = settings?.led?.brightnessPercent ?? 10;
  ledBrightnessSlider.value    = pct;
  ledBrightnessValue.textContent = `${pct}%`;
}

// ── Key helpers ───────────────────────────────────────────────
function keyEventToHid(e) {
  let base = KEY_TO_HID[e.key];
  if (!base) {
    const k = e.key.toLowerCase();
    if (k.length === 1 && k >= "a" && k <= "z")
      base = { type: "keyboard", key: "0x" + (0x04 + k.charCodeAt(0) - 97).toString(16).toUpperCase() };
    else if (k >= "1" && k <= "9")
      base = { type: "keyboard", key: "0x" + (0x1E + k.charCodeAt(0) - 49).toString(16).toUpperCase() };
    else if (k === "0")
      base = { type: "keyboard", key: "0x27" };
  }
  if (!base) return null;
  const modsNum = (e.ctrlKey ? 0x01 : 0) | (e.shiftKey ? 0x02 : 0) |
                  (e.altKey  ? 0x04 : 0) | (e.metaKey  ? 0x08 : 0);
  return modsNum ? { ...base, mods: "0x" + modsNum.toString(16).toUpperCase() } : { ...base };
}
function getHidLabel(type, key, mods) {
  if (!key) return null;
  const modsNum  = mods ? parseInt(mods, 16) : 0;
  const typeNorm = (type || "keyboard").toUpperCase();
  const keyNorm  = normalizeHex(key).toUpperCase();
  for (const opt of keyPresetSelect.options) {
    if (opt.value === "custom" || opt.value === "mode_switch") continue;
    const parts   = opt.value.split(":");
    const optType = parts[0].toUpperCase();
    const optKey  = parts[1] ? normalizeHex(parts[1]).toUpperCase() : "";
    const optMods = parts[2] ? parseInt(parts[2], 16) : 0;
    if (optType === typeNorm && optKey === keyNorm && optMods === modsNum) return opt.textContent;
  }
  return null;
}
function getHidKeyLabel(type, key, mods) {
  const label = getHidLabel(type, key, mods);
  if (label) return label;
  const code = parseInt(key, 16);
  if (type === "keyboard") {
    if (code >= 0x04 && code <= 0x1D) return String.fromCharCode(65 + code - 0x04);
    if (code >= 0x1E && code <= 0x26) return String(code - 0x1E + 1);
    if (code === 0x27) return "0";
  }
  return key || "?";
}
function slotDataFromSlot(slot) {
  if (slot.type === "combo") return { type: "combo", steps: (slot.steps || []).map(s => ({ ...s })) };
  const d = { type: slot.type || "keyboard", key: slot.key || "" };
  if (slot.mods) d.mods = slot.mods;
  return d;
}
function comboStepsToSlotData() {
  if (comboSteps.length === 0) return { type: "keyboard", key: "" };
  if (comboSteps.length === 1) {
    const { type, key, mods } = comboSteps[0];
    return mods ? { type, key, mods } : { type, key };
  }
  return { type: "combo", steps: comboSteps.map(s => ({ ...s })) };
}
function renderComboSteps() {
  comboStepList.innerHTML = "";
  comboSteps.forEach((step, i) => {
    if (i > 0) {
      const arr = document.createElement("span");
      arr.className = "combo-arrow";
      arr.textContent = "→";
      comboStepList.appendChild(arr);
    }
    const chip = document.createElement("div");
    chip.className = "combo-step";
    if (step.mods) {
      const m = parseInt(step.mods, 16);
      [["Ctrl", 0x01], ["Shift", 0x02], ["Alt", 0x04], ["Meta", 0x08]].forEach(([name, bit]) => {
        if (!(m & bit)) return;
        const s = document.createElement("span");
        s.className = "combo-mod";
        s.textContent = name;
        chip.appendChild(s);
      });
    }
    const kl = document.createElement("span");
    kl.className = "combo-key-label";
    kl.textContent = getHidKeyLabel(step.type, step.key, step.mods);
    chip.appendChild(kl);
    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "combo-step-remove";
    rm.textContent = "×";
    rm.addEventListener("click", () => { comboSteps.splice(i, 1); renderComboSteps(); updateSlotFromInputs(); });
    chip.appendChild(rm);
    comboStepList.appendChild(chip);
  });
}
function startComboCapture() {
  captureComboActive = true;
  comboCaptureBtn.textContent = "Press a key…";
  comboCaptureBtn.classList.add("capturing");
}
function stopComboCapture() {
  captureComboActive = false;
  pendingMods = 0;
  document.querySelectorAll(".combo-mod-toggle").forEach(b => b.classList.remove("active"));
  comboCaptureBtn.textContent = "+ Add Key";
  comboCaptureBtn.classList.remove("capturing");
}

// ── Preset helpers ────────────────────────────────────────────
function normalizeHex(hex) {
  // "0x00E9" → "0xE9", "0x04" → "0x4", "0x0" → "0x0"
  return hex.replace(/^0x0*([0-9a-fA-F])/i, "0x$1");
}

function findPreset(key, type, mods) {
  if (type === "mode_switch") return "mode_switch";
  if (!key) return "custom";
  const modsNum  = mods ? parseInt(mods, 16) : 0;
  const typeNorm = (type || "keyboard").toUpperCase();
  const keyNorm  = normalizeHex(key).toUpperCase();
  for (const opt of keyPresetSelect.options) {
    if (opt.value === "custom" || opt.value === "mode_switch") continue;
    const parts   = opt.value.split(":");
    const optType = parts[0].toUpperCase();
    const optKey  = parts[1] ? normalizeHex(parts[1]).toUpperCase() : "";
    const optMods = parts[2] ? parseInt(parts[2], 16) : 0;
    if (optType === typeNorm && optKey === keyNorm && optMods === modsNum) return opt.value;
  }
  return "custom";
}
function applyPresetUi(preset) {
  comboEditor.style.display = preset === "custom" ? "flex" : "none";
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
  connectBtn.textContent = connected ? "Connected" : "Click to Connect";
  connectBtn.classList.toggle("is-connected", connected);
  mainLayout.classList.toggle("locked", !connected);
  checkApplyBtn();
  learnBtn.disabled = !connected;
  clearBtn.disabled = !connected;
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
    await getSettings();
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
    savedSettingsJSON = JSON.stringify(settings);
    checkApplyBtn();
    return;
  }

  if (payload.event === "learn") {
    if (autoAddActive && autoAddStep === "ir") {
      autoAddIrCode = payload.code;
      autoAddStep = "hid";
      updateAutoAddHint();
      logLine(`Auto-Add: got IR ${payload.code} — press a keyboard key.`);
      return;
    }
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
          setSlotByIrCode(currentModeIndex, payload.code, slotDataFromSlot(oldSlot));
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
  savedSettingsJSON = JSON.stringify(settings);
  checkApplyBtn();
  await sendCommand({ op: "set", data: settings });
}

function syncEditor() {
  editor.value = JSON.stringify(settings, null, 2);
  checkApplyBtn();
}

function checkApplyBtn() {
  applyBtn.disabled = !port || savedSettingsJSON === null ||
                      JSON.stringify(settings) === savedSettingsJSON;
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
      modeColors: ["0xFF0040", "0x0080FF"],
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

function setSlotByIrCode(modeIndex, irCode, slotData) {
  if (!irCode) return;
  ensureSettings();
  const slots = settings.modes[modeIndex].slots;
  const idx = slots.findIndex(s => s.irCode === irCode);
  const entry = { irCode, ...slotData };
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
    btn.title = "Click active tab to rename";

    const dotColor = settingsColorToCss(
      settings?.led?.modeColors?.[i] ?? DEFAULT_MODE_COLORS[i] ?? "0xFF0040"
    );
    const dot = document.createElement("span");
    dot.className = "mode-color-dot";
    dot.style.background = dotColor;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(mode.name || `Mode ${i + 1}`));

    btn.addEventListener("click", () => {
      if (i === currentModeIndex) startRenameMode(i);
      else switchMode(i);
    });
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

function startRenameMode(index) {
  const tabsEl = document.getElementById("modeTabs");
  const btn = [...tabsEl.querySelectorAll(".tab:not(.tab-add)")][index];
  if (!btn || btn.querySelector("input")) return;

  const prev = settings.modes[index].name || `Mode ${index + 1}`;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "tab-rename-input";
  inp.value = prev;
  btn.textContent = "";
  btn.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = () => {
    const name = inp.value.trim() || prev;
    settings.modes[index].name = name;
    syncEditor();
    renderTabs();
  };
  inp.addEventListener("blur",    commit);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { inp.blur(); }
    if (e.key === "Escape") { inp.value = prev; inp.blur(); }
    e.stopPropagation();
  });
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
    btn.className = "layout-tab" + (i === currentLayoutIndex ? " active" : "");
    btn.textContent = layout.name || `Layout ${i + 1}`;
    btn.title = layoutEditMode && i === currentLayoutIndex
      ? "Click to rename" : "";
    btn.addEventListener("click", () => {
      if (layoutEditMode && i === currentLayoutIndex) startRenameLayout(i);
      else switchLayout(i);
    });
    tabsEl.appendChild(btn);
  });
  tabsEl.appendChild(addLayoutBtn);
}

function startRenameLayout(index) {
  const tabsEl = document.getElementById("layoutTabs");
  const btn = [...tabsEl.querySelectorAll(".layout-tab")][index];
  if (!btn || btn.querySelector("input")) return;

  const prev = settings.layouts[index]?.name || `Layout ${index + 1}`;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "tab-rename-input";
  inp.value = prev;
  btn.textContent = "";
  btn.appendChild(inp);
  inp.focus();
  inp.select();

  const commit = () => {
    const name = inp.value.trim() || prev;
    settings.layouts[index].name = name;
    syncEditor();
    renderLayoutTabs();
  };
  inp.addEventListener("blur",    commit);
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  inp.blur();
    if (e.key === "Escape") { inp.value = prev; inp.blur(); }
    e.stopPropagation();
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
  detailTitle.textContent = (irCode && labels[irCode]) ? labels[irCode] : "Selected Button";

  const isCombo = slot.type === "combo";
  const preset  = isCombo ? "custom" : findPreset(slot.key, slot.type || "keyboard", slot.mods || "");
  keyPresetSelect.value = preset;

  if (preset === "custom") {
    if (isCombo && slot.steps) {
      comboSteps = slot.steps.map(s => ({ ...s }));
    } else if (slot.type && slot.key) {
      comboSteps = [{ type: slot.type, key: slot.key, ...(slot.mods ? { mods: slot.mods } : {}) }];
    } else {
      comboSteps = [];
    }
    renderComboSteps();
  } else {
    comboSteps = [];
  }

  applyPresetUi(preset);
}

function clearDetailPanel() {
  detailTitle.textContent = "Selected Button";
  labelInput.value      = "";
  irInput.value         = "";
  keyPresetSelect.value = "custom";
  comboSteps  = [];
  pendingMods = 0;
  stopComboCapture();
  renderComboSteps();
  applyPresetUi("custom");
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
        setSlotByIrCode(currentModeIndex, irCode, slotDataFromSlot(oldSlot));
        removeSlotByIrCode(currentModeIndex, oldCode);
      }
    }
  }

  const code = btn.irCode;
  if (labelInput.value.trim()) setLabel(code, labelInput.value.trim());
  detailTitle.textContent = labelInput.value.trim() || "Selected Button";

  const preset = keyPresetSelect.value;
  let slotData;
  if (preset === "mode_switch") {
    slotData = { type: "mode_switch", key: "" };
  } else if (preset !== "custom") {
    const parts = preset.split(":");
    slotData = { type: parts[0], key: parts[1] };
    if (parts[2]) slotData.mods = parts[2];
  } else {
    slotData = comboStepsToSlotData();
  }

  if (code) setSlotByIrCode(currentModeIndex, code, slotData);
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
  if (!active) stopAutoAdd();
  editLayoutBtn.style.display = active ? "none" : "";
  layoutEditBar.style.display = active ? "flex" : "none";
  renderLayoutTabs();
  renderGrid();
}

function updateAutoAddHint() {
  if (!autoAddActive) {
    layoutEditHint.textContent = "Drag to rearrange • × to remove";
    return;
  }
  layoutEditHint.textContent = autoAddStep === "ir"
    ? "Press a remote button…"
    : "Press the keyboard key…";
}

function startAutoAdd() {
  if (settings.modes[currentModeIndex].slots.length >= MAX_MAPPINGS) {
    logLine("Auto-Add: slot limit reached."); return;
  }
  autoAddActive = true;
  autoAddStep   = "ir";
  autoAddIrCode = null;
  addSlotBtn.disabled    = true;
  autoAddBtn.textContent = "Stop";
  updateAutoAddHint();
  sendCommand({ op: "learn" });
  logLine("Auto-Add: press a remote button…");
}

function stopAutoAdd() {
  if (!autoAddActive) return;
  autoAddActive = false;
  autoAddStep   = null;
  autoAddIrCode = null;
  addSlotBtn.disabled    = false;
  autoAddBtn.textContent = "Auto-Add";
  updateAutoAddHint();
  logLine("Auto-Add stopped.");
}

// ── Event listeners ───────────────────────────────────────────
connectBtn.addEventListener("click", () => { if (port) disconnect(); else connect(); });
applyBtn.addEventListener("click", applySettings);
learnBtn.addEventListener("click", requestLearn);
clearBtn.addEventListener("click", clearSlot);
toggleJsonBtn.addEventListener("click", () => jsonPanel.classList.toggle("visible"));

modeColorSwatch.addEventListener("click", () => hueDropdown.classList.toggle("open"));
document.addEventListener("click", (e) => {
  if (!huePickerWrap.contains(e.target)) hueDropdown.classList.remove("open");
  if (captureComboActive && !comboEditor.contains(e.target)) stopComboCapture();
});

modeColorPicker.addEventListener("input", () => {
  if (!settings?.led) return;
  if (!Array.isArray(settings.led.modeColors)) {
    settings.led.modeColors = Array.from({ length: settings.modes?.length || 2 },
      (_, i) => DEFAULT_MODE_COLORS[i] || "0xFF0040");
  }
  while (settings.led.modeColors.length <= currentModeIndex)
    settings.led.modeColors.push(DEFAULT_MODE_COLORS[currentModeIndex] || "0xFF0040");
  const hueColor = hueToHex(parseInt(modeColorPicker.value));
  modeColorPicker.style.setProperty("--thumb-color", hueColor);
  modeColorSwatch.style.background = hueColor;
  settings.led.modeColors[currentModeIndex] = cssColorToSettings(hueColor);
  ledBrightnessSlider.style.accentColor = hueColor;
  renderTabs();
  syncEditor();
});

ledBrightnessSlider.addEventListener("input", () => {
  const val = parseInt(ledBrightnessSlider.value, 10);
  ledBrightnessValue.textContent = `${val}%`;
  if (!settings?.led) return;
  settings.led.brightnessPercent = val;
  syncEditor();
});

editLayoutBtn.addEventListener("click", () => setLayoutEditMode(!layoutEditMode));
doneEditBtn.addEventListener("click",   () => setLayoutEditMode(false));
addSlotBtn.addEventListener("click", addButtonToLayout);
autoAddBtn.addEventListener("click", () => { if (autoAddActive) stopAutoAdd(); else startAutoAdd(); });

document.addEventListener("keydown", (e) => {
  // Combo capture for the detail panel
  if (captureComboActive) {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    if (e.key === "Escape") { e.preventDefault(); stopComboCapture(); return; }
    const hid = keyEventToHid(e);
    if (!hid) { logLine(`Unrecognized key "${e.key}"`); return; }
    e.preventDefault();
    const physMods = hid.mods ? parseInt(hid.mods, 16) : 0;
    const modsNum  = pendingMods | physMods;
    const step = { type: hid.type, key: hid.key };
    if (modsNum) step.mods = "0x" + modsNum.toString(16).toUpperCase();
    comboSteps.push(step);
    renderComboSteps();
    stopComboCapture();
    updateSlotFromInputs();
    return;
  }

  // Auto-Add HID step
  if (!autoAddActive || autoAddStep !== "hid") return;
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

  const hid = keyEventToHid(e);
  if (!hid) { logLine(`Auto-Add: unrecognized key "${e.key}" — try again.`); return; }
  e.preventDefault();

  const layout = getCurrentLayout();
  const occupied = new Set(layout.buttons.map(b => `${b.x},${b.y}`));
  const maxX = layout.buttons.length > 0 ? Math.max(...layout.buttons.map(b => b.x)) + 1 : 5;
  let x = 0, y = 0;
  while (occupied.has(`${x},${y}`)) { x++; if (x >= maxX) { x = 0; y++; } }
  layout.buttons.push({ irCode: autoAddIrCode, x, y });

  setSlotByIrCode(currentModeIndex, autoAddIrCode, slotDataFromSlot(hid));

  const label = getHidLabel(hid.type, hid.key, hid.mods);
  if (label) setLabel(autoAddIrCode, label);

  syncEditor();
  saveLabels();
  renderGrid();
  logLine(`Auto-Add: ${autoAddIrCode} → ${hid.type}:${hid.key}${hid.mods ? `+${hid.mods}` : ""}${label ? ` (${label})` : ""}`);

  if (settings.modes[currentModeIndex].slots.length >= MAX_MAPPINGS) {
    logLine("Auto-Add: slot limit reached — stopping.");
    stopAutoAdd();
    return;
  }

  autoAddStep   = "ir";
  autoAddIrCode = null;
  updateAutoAddHint();
  sendCommand({ op: "learn" });
  logLine("Auto-Add: press next remote button…");
});

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
  if (val === "custom") { comboSteps = []; renderComboSteps(); }
  applyPresetUi(val);
  if (val !== "custom" && val !== "mode_switch") updateSlotFromInputs();
});

comboCaptureBtn.addEventListener("click", () => {
  if (captureComboActive) stopComboCapture();
  else startComboCapture();
});

document.querySelectorAll(".combo-mod-toggle").forEach(btn => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const bit = parseInt(btn.dataset.bit);
    pendingMods ^= bit;
    btn.classList.toggle("active", !!(pendingMods & bit));
  });
});

// irInput is now editable — changing it reassigns the layout button's IR code
irInput.addEventListener("change", updateSlotFromInputs);


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
