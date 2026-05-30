const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const editor = document.getElementById("jsonEditor");
const remoteGrid = document.getElementById("remoteGrid");
const labelInput = document.getElementById("labelInput");
const irInput = document.getElementById("irInput");
const keyInput = document.getElementById("keyInput");
const learnBtn = document.getElementById("learnBtn");
const clearBtn = document.getElementById("clearBtn");
const jsonPanel = document.getElementById("jsonPanel");
const toggleJsonBtn = document.getElementById("toggleJsonBtn");

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const getBtn = document.getElementById("getBtn");
const applyBtn = document.getElementById("applyBtn");
const saveBtn = document.getElementById("saveBtn");

let port;
let reader;
let writer;
let readLoopActive = false;
let currentLayer = "keyboard";
let selectedIndex = 0;
let learnArmed = false;
const MAX_MAPPINGS = 20;
const STORAGE_KEY = "ir-hid-layout";

const defaultLabels = Array.from({ length: MAX_MAPPINGS }, (_, i) => `B${i + 1}`);
let labels = [...defaultLabels];
let settings = null;

function logLine(text) {
  const line = document.createElement("div");
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setConnected(connected) {
  statusEl.textContent = connected ? "Connected" : "Disconnected";
  statusEl.style.color = connected ? "#7bd8d6" : "#e0b45c";
  disconnectBtn.disabled = !connected;
  getBtn.disabled = !connected;
  applyBtn.disabled = !connected;
  saveBtn.disabled = !connected;
  learnBtn.disabled = !connected;
  clearBtn.disabled = !connected;
}

async function connect() {
  try {
    port = await navigator.serial.requestPort();
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
    if (reader) {
      await reader.cancel();
      reader.releaseLock();
    }
    if (writer) {
      writer.releaseLock();
    }
    if (port) {
      await port.close();
    }
  } catch (err) {
    logLine(`Disconnect error: ${err.message}`);
  } finally {
    port = null;
    reader = null;
    writer = null;
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
      if (!line.trim()) continue;
      handleResponse(line);
    }
  }
}

function handleResponse(line) {
  logLine(`<= ${line}`);
  if (!line.trim().startsWith("{")) {
    return;
  }
  let payload;
  try {
    payload = JSON.parse(line);
  } catch (err) {
    logLine("Response parse error.");
    return;
  }

  if (payload.data) {
    settings = payload.data;
    editor.value = JSON.stringify(payload.data, null, 2);
    renderGrid();
    selectSlot(selectedIndex);
    return;
  }

  if (payload.event === "learn") {
    if (!learnArmed) return;
    const slot = getSlot(selectedIndex);
    setSlot(selectedIndex, {
      irCode: payload.code,
      key: slot.key,
      consumerKey: slot.consumerKey,
    });
    learnArmed = false;
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

async function getSettings() {
  await sendCommand({ op: "get" });
}

async function applySettings(persist) {
  const data = buildSettingsFromUi();
  editor.value = JSON.stringify(data, null, 2);
  await sendCommand({ op: "set", data, persist });
}

function buildSettingsFromUi() {
  const base = settings || {};
  const payload = {
    ir: base.ir || {
      modeChangeCode: "0xC40387EE",
      receivePin: 1,
      handleRepeat: true,
      repeatInitialDelayReports: 5,
    },
    led: base.led || {
      pin: 16,
      keyboardModeColor: "0x290118",
      consumerModeColor: "0x012329",
      brightnessPercent: 10,
    },
    keyboard: [],
    consumer: [],
  };

  for (let i = 0; i < MAX_MAPPINGS; i += 1) {
    const slot = getSlot(i);
    if (slot.irCode && slot.key) {
      payload.keyboard.push({ irCode: slot.irCode, key: slot.key });
    }
    if (slot.irCode && slot.consumerKey) {
      payload.consumer.push({ irCode: slot.irCode, key: slot.consumerKey });
    }
  }

  settings = payload;
  return payload;
}

function getSlot(index) {
  if (!settings) {
    settings = { keyboard: [], consumer: [] };
  }

  const keyboardEntry = settings.keyboard?.[index];
  const consumerEntry = settings.consumer?.[index];
  return {
    irCode: keyboardEntry?.irCode || consumerEntry?.irCode || "",
    key: keyboardEntry?.key || "",
    consumerKey: consumerEntry?.key || "",
  };
}

function setSlot(index, data) {
  if (!settings) {
    settings = { keyboard: [], consumer: [] };
  }

  while (settings.keyboard.length <= index) {
    settings.keyboard.push({});
  }
  while (settings.consumer.length <= index) {
    settings.consumer.push({});
  }

  const irCode = data.irCode || "";
  settings.keyboard[index] = {
    irCode,
    key: data.key || settings.keyboard[index]?.key || "",
  };
  settings.consumer[index] = {
    irCode,
    key: data.consumerKey || settings.consumer[index]?.key || "",
  };
}

function renderGrid() {
  remoteGrid.innerHTML = "";
  for (let i = 0; i < MAX_MAPPINGS; i += 1) {
    const slot = getSlot(i);
    const button = document.createElement("button");
    button.className = "slot";
    button.dataset.index = i;
    button.innerHTML = `
      <div>${labels[i]}</div>
      <small>${slot.irCode || "Unassigned"}</small>
    `;
    if (i === selectedIndex) {
      button.classList.add("active");
    }
    button.addEventListener("click", () => selectSlot(i));
    remoteGrid.appendChild(button);
  }
}

function selectSlot(index) {
  selectedIndex = index;
  renderGrid();

  const slot = getSlot(index);
  labelInput.value = labels[index] || "";
  irInput.value = slot.irCode || "";

  if (currentLayer === "keyboard") {
    keyInput.value = slot.key || "";
  } else {
    keyInput.value = slot.consumerKey || "";
  }
}

function updateSlotFromInputs() {
  const slot = getSlot(selectedIndex);
  const label = labelInput.value.trim() || defaultLabels[selectedIndex];
  labels[selectedIndex] = label;
  const updated = {
    irCode: slot.irCode,
    key: slot.key,
    consumerKey: slot.consumerKey,
  };

  if (currentLayer === "keyboard") {
    updated.key = keyInput.value.trim();
  } else {
    updated.consumerKey = keyInput.value.trim();
  }

  setSlot(selectedIndex, updated);
  saveLabels();
  renderGrid();
}

function saveLabels() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

function loadLabels() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === MAX_MAPPINGS) {
      labels = parsed;
    }
  } catch (err) {
    labels = [...defaultLabels];
  }
}

async function requestLearn() {
  learnArmed = true;
  await sendCommand({ op: "learn" });
  logLine("Waiting for IR code...");
}

function clearSlot() {
  setSlot(selectedIndex, { irCode: "", key: "", consumerKey: "" });
  renderGrid();
  selectSlot(selectedIndex);
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
getBtn.addEventListener("click", getSettings);
applyBtn.addEventListener("click", () => applySettings(false));
saveBtn.addEventListener("click", () => applySettings(true));
learnBtn.addEventListener("click", requestLearn);
clearBtn.addEventListener("click", clearSlot);
toggleJsonBtn.addEventListener("click", () => {
  jsonPanel.classList.toggle("visible");
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((btn) => btn.classList.remove("active"));
    tab.classList.add("active");
    currentLayer = tab.dataset.layer;
    selectSlot(selectedIndex);
  });
});

labelInput.addEventListener("input", updateSlotFromInputs);
keyInput.addEventListener("input", updateSlotFromInputs);

setConnected(false);
loadLabels();
settings = {
  ir: {
    modeChangeCode: "0xC40387EE",
    receivePin: 1,
    handleRepeat: true,
    repeatInitialDelayReports: 5,
  },
  led: {
    pin: 16,
    keyboardModeColor: "0x290118",
    consumerModeColor: "0x012329",
    brightnessPercent: 10,
  },
  keyboard: [{ irCode: "0xC40A87EE", key: "0xDA" }],
  consumer: [{ irCode: "0xC40A87EE", key: "0xE9" }],
};
editor.value = JSON.stringify(settings, null, 2);
renderGrid();
selectSlot(0);
