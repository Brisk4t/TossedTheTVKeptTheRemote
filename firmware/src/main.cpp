#include "main.h"
#include "settings.h"
#include "webserial.h"

// Runtime configuration (loaded from JSON with defaults)
uint8_t RECV_PIN = IR_RECEIVE_PIN;
uint32_t mode_change = MODE_CHANGE_CODE;
uint8_t LED_PIN_CONFIG = LED_PIN;
uint32_t COLOR_CONFIG[MODE_COUNT] = {0, 0, 0, 0, 0};
uint32_t COLOR_RAW[MODE_COUNT] = {
  DEFAULT_MODE_COLOR_0, DEFAULT_MODE_COLOR_1, DEFAULT_MODE_COLOR_2,
  DEFAULT_MODE_COLOR_3, DEFAULT_MODE_COLOR_4
};
uint8_t numModes = 2;
uint8_t LED_BRIGHTNESS_CONFIG = LED_BRIGHTNESS_PERCENT;
bool HANDLE_REPEAT_CONFIG = HANDLE_REPEAT;
uint8_t REPEAT_DELAY_REPORTS = REPEAT_INITIAL_DELAY_REPORTS;

// IR Repeat handling
uint32_t lastCode = 0; // Last received IR code for handling repeats
uint8_t repeatCount = 0; // Count of repeated reports

// Current mode index
uint8_t currentMode = 0;

// Mode names (persisted in settings.json, editable from UI)
char modeNames[MODE_COUNT][20] = {
  "Mode 1", "Mode 2", "Mode 3", "Mode 4", "Mode 5"
};

// Layout data stored as raw JSON for pass-through (firmware does not process this)
char layoutsJson[4096] = "[]";

// Runtime slots (loaded from JSON files)
IRSlot    modeSlots[MODE_COUNT][MAX_MAPPINGS];
ComboStep comboData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS];

// ------------------------------
// USB HID (Adafruit TinyUSB)

Adafruit_USBD_HID usb_hid;

uint8_t const hid_report_desc[] = {
  TUD_HID_REPORT_DESC_KEYBOARD(HID_REPORT_ID(1)),
  TUD_HID_REPORT_DESC_CONSUMER(HID_REPORT_ID(2))
};

void setupUsbHid() {
  usb_hid.setPollInterval(2);
  usb_hid.setReportDescriptor(hid_report_desc, sizeof(hid_report_desc));
  usb_hid.begin();
}

bool asciiToHid(uint8_t ascii, uint8_t* modifier, uint8_t* keycode) {
  *modifier = 0;
  switch (ascii) {
    case 'a' ... 'z':
      *keycode = (uint8_t)(ascii - 'a' + 0x04);
      return true;
    case 'A' ... 'Z':
      *keycode = (uint8_t)(ascii - 'A' + 0x04);
      *modifier = 0x02; // left shift
      return true;
    case '1' ... '9':
      *keycode = (uint8_t)(ascii - '1' + 0x1E);
      return true;
    case '0':
      *keycode = 0x27;
      return true;
    case ' ':
      *keycode = 0x2C;
      return true;
    case '\n':
    case '\r':
      *keycode = 0x28;
      return true;
    case '\t':
      *keycode = 0x2B;
      return true;
    case '-':
      *keycode = 0x2D;
      return true;
    case '=':
      *keycode = 0x2E;
      return true;
    case '[':
      *keycode = 0x2F;
      return true;
    case ']':
      *keycode = 0x30;
      return true;
    case '\\':
      *keycode = 0x31;
      return true;
    case ';':
      *keycode = 0x33;
      return true;
    case '\'':
      *keycode = 0x34;
      return true;
    case '`':
      *keycode = 0x35;
      return true;
    case ',':
      *keycode = 0x36;
      return true;
    case '.':
      *keycode = 0x37;
      return true;
    case '/':
      *keycode = 0x38;
      return true;
    case '!':
      *keycode = 0x1E;
      *modifier = 0x02;
      return true;
    case '@':
      *keycode = 0x1F;
      *modifier = 0x02;
      return true;
    case '#':
      *keycode = 0x20;
      *modifier = 0x02;
      return true;
    case '$':
      *keycode = 0x21;
      *modifier = 0x02;
      return true;
    case '%':
      *keycode = 0x22;
      *modifier = 0x02;
      return true;
    case '^':
      *keycode = 0x23;
      *modifier = 0x02;
      return true;
    case '&':
      *keycode = 0x24;
      *modifier = 0x02;
      return true;
    case '*':
      *keycode = 0x25;
      *modifier = 0x02;
      return true;
    case '(':
      *keycode = 0x26;
      *modifier = 0x02;
      return true;
    case ')':
      *keycode = 0x27;
      *modifier = 0x02;
      return true;
    case '_':
      *keycode = 0x2D;
      *modifier = 0x02;
      return true;
    case '+':
      *keycode = 0x2E;
      *modifier = 0x02;
      return true;
    case '{':
      *keycode = 0x2F;
      *modifier = 0x02;
      return true;
    case '}':
      *keycode = 0x30;
      *modifier = 0x02;
      return true;
    case '|':
      *keycode = 0x31;
      *modifier = 0x02;
      return true;
    case ':':
      *keycode = 0x33;
      *modifier = 0x02;
      return true;
    case '"':
      *keycode = 0x34;
      *modifier = 0x02;
      return true;
    case '~':
      *keycode = 0x35;
      *modifier = 0x02;
      return true;
    case '<':
      *keycode = 0x36;
      *modifier = 0x02;
      return true;
    case '>':
      *keycode = 0x37;
      *modifier = 0x02;
      return true;
    case '?':
      *keycode = 0x38;
      *modifier = 0x02;
      return true;
    default:
      return false;
  }
}

// Send a raw USB HID keycode with an optional modifier byte.
// This is the primary function used for slot execution.
void sendKeyboardReport(uint8_t keycode, uint8_t modifier = 0) {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t keycodes[6] = {keycode, 0, 0, 0, 0, 0};
  tud_hid_keyboard_report(1, modifier, keycodes);
  delay(10);
  uint8_t empty[6] = {0};
  tud_hid_keyboard_report(1, 0, empty);
}

// Legacy ASCII → HID wrapper (used only for text output, not slot execution).
void sendKeyboardKey(uint8_t ascii) {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t modifier = 0, keycode = 0;
  if (ascii < 0x20) {
    keycode = ascii;
  } else if (!asciiToHid(ascii, &modifier, &keycode)) {
    return;
  }
  sendKeyboardReport(keycode, modifier);
}

void sendConsumerKey(uint16_t key) {
  if (!TinyUSBDevice.mounted()) return;
  tud_hid_report(2, &key, sizeof(key));
  delay(10);
  uint16_t empty = 0;
  tud_hid_report(2, &empty, sizeof(empty));
}

// ------------------------------
// Helpers

// Convert hex color code to RGB (returns as uint32_t in GRB format for NeoPixel)
uint32_t hexToRGB(uint32_t hexColor, uint32_t brightnessPercent = 100) {
  uint8_t r = ((hexColor >> 16) & 0xFF) * brightnessPercent / 100;
  uint8_t g = ((hexColor >> 8) & 0xFF) * brightnessPercent / 100;
  uint8_t b = (hexColor & 0xFF) * brightnessPercent / 100;
  return (((uint32_t)g << 16) | ((uint32_t)r << 8) | b); // GRB format
}

void clearModeSlots(uint8_t modeIndex) {
  if (modeIndex >= MODE_COUNT) return;
  for (uint8_t i = 0; i < MAX_MAPPINGS; i++) {
    modeSlots[modeIndex][i] = {0, 0, SLOT_NONE, 0};
    for (uint8_t s = 0; s < MAX_COMBO_STEPS; s++)
      comboData[modeIndex][i][s] = {0, 0, 0};
  }
}

int findSlotIndex(uint8_t modeIndex, uint32_t code) {
  if (modeIndex >= MODE_COUNT) return -1;
  for (uint8_t i = 0; i < MAX_MAPPINGS; i++) {
    if (modeSlots[modeIndex][i].type != SLOT_NONE && modeSlots[modeIndex][i].irCode == code) {
      return i;
    }
  }
  return -1;
}

bool parseKeyValue(JsonVariant keyVar, uint16_t* outKey) {
  if (keyVar.is<const char*>()) {
    const char* keyStr = keyVar.as<const char*>();
    size_t len = strlen(keyStr);
    if (len == 1) {
      *outKey = (uint8_t)keyStr[0];
      return true;
    }
    if (len > 2 && keyStr[0] == '0' && (keyStr[1] == 'x' || keyStr[1] == 'X')) {
      *outKey = (uint16_t)strtoul(keyStr, NULL, 16);
      return true;
    }
    *outKey = (uint16_t)atoi(keyStr);
    return true;
  }
  if (keyVar.is<int>()) {
    *outKey = (uint16_t)keyVar.as<int>();
    return true;
  }
  return false;
}

uint8_t parseSlotType(JsonVariant typeVar) {
  if (typeVar.is<const char*>()) {
    const char* typeStr = typeVar.as<const char*>();
    if (strcmp(typeStr, "keyboard") == 0)    return SLOT_KEYBOARD;
    if (strcmp(typeStr, "consumer") == 0)    return SLOT_CONSUMER;
    if (strcmp(typeStr, "mode_switch") == 0) return SLOT_MODE_SWITCH;
    if (strcmp(typeStr, "combo") == 0)       return SLOT_COMBO;
  }
  if (typeVar.is<uint8_t>()) {
    uint8_t typeVal = typeVar.as<uint8_t>();
    if (typeVal <= SLOT_MODE_SWITCH) return typeVal;
  }
  return SLOT_NONE;
}

void applyIrSettings(JsonObject ir) {
  if (ir["modeChangeCode"].is<const char*>())
    mode_change = strtoul((const char*)ir["modeChangeCode"], NULL, 16);
  if (ir["receivePin"].is<uint8_t>())
    RECV_PIN = ir["receivePin"];
  if (ir["handleRepeat"].is<bool>())
    HANDLE_REPEAT_CONFIG = ir["handleRepeat"];
  if (ir["repeatInitialDelayReports"].is<uint8_t>())
    REPEAT_DELAY_REPORTS = ir["repeatInitialDelayReports"];
  if (ir["modeCount"].is<uint8_t>()) {
    uint8_t mc = ir["modeCount"].as<uint8_t>();
    if (mc >= 1 && mc <= MODE_COUNT) numModes = mc;
  }
}

void applyLedSettings(JsonObject led) {
  if (led["pin"].is<uint8_t>())
    LED_PIN_CONFIG = led["pin"];
  if (led["brightnessPercent"].is<uint8_t>())
    LED_BRIGHTNESS_CONFIG = led["brightnessPercent"];

  if (led["modeColors"].is<JsonArray>()) {
    JsonArray colors = led["modeColors"].as<JsonArray>();
    uint8_t idx = 0;
    for (JsonVariant c : colors) {
      if (idx >= MODE_COUNT) break;
      if (c.is<const char*>())
        COLOR_RAW[idx] = strtoul(c.as<const char*>(), NULL, 16);
      idx++;
    }
  } else {
    // Legacy two-key format
    if (led["keyboardModeColor"].is<const char*>())
      COLOR_RAW[0] = strtoul((const char*)led["keyboardModeColor"], NULL, 16);
    if (led["consumerModeColor"].is<const char*>())
      COLOR_RAW[1] = strtoul((const char*)led["consumerModeColor"], NULL, 16);
  }

  for (uint8_t i = 0; i < MODE_COUNT; i++)
    COLOR_CONFIG[i] = hexToRGB(COLOR_RAW[i], LED_BRIGHTNESS_CONFIG);
}

void applySlotsFromArray(uint8_t modeIndex, JsonArray slots) {
  if (modeIndex >= MODE_COUNT) return;
  clearModeSlots(modeIndex);

  uint8_t slotIndex = 0;
  for (JsonObject slot : slots) {
    if (slotIndex >= MAX_MAPPINGS) break;
    if (!slot["irCode"].is<const char*>()) { slotIndex++; continue; }

    const char* irCodeStr = slot["irCode"];
    uint32_t irCode = strtoul(irCodeStr, NULL, 16);
    uint8_t typeVal = parseSlotType(slot["type"]);
    if (typeVal == SLOT_NONE) { slotIndex++; continue; }

    if (typeVal == SLOT_COMBO) {
      if (!slot["steps"].is<JsonArray>()) { slotIndex++; continue; }
      uint8_t stepCount = 0;
      for (JsonObject step : slot["steps"].as<JsonArray>()) {
        if (stepCount >= MAX_COMBO_STEPS) break;
        uint8_t stepType = parseSlotType(step["type"]);
        if (stepType != SLOT_KEYBOARD && stepType != SLOT_CONSUMER) continue;
        uint16_t stepKey = 0;
        if (!parseKeyValue(step["key"], &stepKey)) continue;
        uint8_t stepMods = 0;
        if (step["mods"].is<const char*>())
          stepMods = (uint8_t)strtoul(step["mods"].as<const char*>(), NULL, 16);
        comboData[modeIndex][slotIndex][stepCount] = {stepKey, stepType, stepMods};
        stepCount++;
      }
      modeSlots[modeIndex][slotIndex] = {irCode, stepCount, SLOT_COMBO, 0};
      slotIndex++;
      continue;
    }

    uint16_t keyVal = 0;
    if (typeVal != SLOT_MODE_SWITCH && !parseKeyValue(slot["key"], &keyVal)) {
      slotIndex++; continue;
    }
    uint8_t modsVal = 0;
    if (slot["mods"].is<const char*>())
      modsVal = (uint8_t)strtoul(slot["mods"].as<const char*>(), NULL, 16);

    modeSlots[modeIndex][slotIndex] = {irCode, keyVal, typeVal, modsVal};
    slotIndex++;
  }
}

void applyLegacyMappings(uint8_t modeIndex, JsonArray keyboard, JsonArray consumer) {
  if (modeIndex >= MODE_COUNT) return;
  clearModeSlots(modeIndex);

  uint8_t slotIndex = 0;
  for (JsonObject mapping : keyboard) {
    if (slotIndex >= MAX_MAPPINGS) break;
    if (!mapping["irCode"].is<const char*>()) continue;
    uint16_t keyVal = 0;
    if (!parseKeyValue(mapping["key"], &keyVal)) continue;

    modeSlots[modeIndex][slotIndex].irCode = strtoul(mapping["irCode"], NULL, 16);
    modeSlots[modeIndex][slotIndex].key = keyVal;
    modeSlots[modeIndex][slotIndex].type = SLOT_KEYBOARD;
    slotIndex++;
  }

  for (JsonObject mapping : consumer) {
    if (slotIndex >= MAX_MAPPINGS) break;
    if (!mapping["irCode"].is<const char*>()) continue;
    uint16_t keyVal = 0;
    if (!parseKeyValue(mapping["key"], &keyVal)) continue;

    modeSlots[modeIndex][slotIndex].irCode = strtoul(mapping["irCode"], NULL, 16);
    modeSlots[modeIndex][slotIndex].key = keyVal;
    modeSlots[modeIndex][slotIndex].type = SLOT_CONSUMER;
    slotIndex++;
  }
}

void applyModeNamesFromArray(JsonArray modes) {
  uint8_t idx = 0;
  for (JsonObject mode : modes) {
    if (idx >= MODE_COUNT) break;
    if (mode["name"].is<const char*>()) {
      strlcpy(modeNames[idx], mode["name"].as<const char*>(), sizeof(modeNames[idx]));
    }
    idx++;
  }
}

void applySettingsFromJson(JsonObject doc) {
  if (doc["ir"].is<JsonObject>())
    applyIrSettings(doc["ir"].as<JsonObject>());
  if (doc["led"].is<JsonObject>())
    applyLedSettings(doc["led"].as<JsonObject>());
  if (doc["layouts"].is<JsonArray>())
    serializeJson(doc["layouts"], layoutsJson, sizeof(layoutsJson));
  if (doc["modes"].is<JsonArray>())
    applyModeNamesFromArray(doc["modes"].as<JsonArray>());
  if (doc["modes"].is<JsonArray>()) {
    JsonArray modes = doc["modes"].as<JsonArray>();
    uint8_t idx = 0;
    for (JsonObject mode : modes) {
      if (idx >= MODE_COUNT) break;
      if (mode["slots"].is<JsonArray>()) {
        applySlotsFromArray(idx, mode["slots"].as<JsonArray>());
      } else if (mode["keyboard"].is<JsonArray>() || mode["consumer"].is<JsonArray>()) {
        JsonArray keyboard = mode["keyboard"].is<JsonArray>() ? mode["keyboard"].as<JsonArray>() : JsonArray();
        JsonArray consumer = mode["consumer"].is<JsonArray>() ? mode["consumer"].as<JsonArray>() : JsonArray();
        applyLegacyMappings(idx, keyboard, consumer);
      }
      idx++;
    }
  } else if (doc["keyboard"].is<JsonArray>() || doc["consumer"].is<JsonArray>()) {
    JsonArray keyboard = doc["keyboard"].is<JsonArray>() ? doc["keyboard"].as<JsonArray>() : JsonArray();
    JsonArray consumer = doc["consumer"].is<JsonArray>() ? doc["consumer"].as<JsonArray>() : JsonArray();
    applyLegacyMappings(0, keyboard, consumer);
  }
}

void formatHex(char* out, size_t outSize, uint32_t value, uint8_t width) {
  char fmt[8];
  snprintf(fmt, sizeof(fmt), "0x%%0%dX", width);
  snprintf(out, outSize, fmt, value);
}

void buildSettingsJson(JsonObject doc) {
  JsonObject ir = doc["ir"].to<JsonObject>();
  char modeChangeStr[12];
  formatHex(modeChangeStr, sizeof(modeChangeStr), mode_change, 8);
  ir["modeChangeCode"] = modeChangeStr;
  ir["modeCount"] = numModes;
  ir["receivePin"] = RECV_PIN;
  ir["handleRepeat"] = HANDLE_REPEAT_CONFIG;
  ir["repeatInitialDelayReports"] = REPEAT_DELAY_REPORTS;

  JsonObject led = doc["led"].to<JsonObject>();
  led["pin"] = LED_PIN_CONFIG;
  led["brightnessPercent"] = LED_BRIGHTNESS_CONFIG;

  JsonArray modeColors = led["modeColors"].to<JsonArray>();
  for (uint8_t i = 0; i < numModes; i++) {
    char colorStr[12];
    formatHex(colorStr, sizeof(colorStr), COLOR_RAW[i], 6);
    modeColors.add(colorStr);
  }

  // Re-emit stored layout data (pass-through, firmware does not process this)
  DynamicJsonDocument tempLayouts(4096);
  if (deserializeJson(tempLayouts, layoutsJson) == DeserializationError::Ok) {
    doc["layouts"].set(tempLayouts.as<JsonVariant>());
  } else {
    doc["layouts"].to<JsonArray>();
  }

  JsonArray modes = doc["modes"].to<JsonArray>();
  for (uint8_t modeIndex = 0; modeIndex < numModes; modeIndex++) {
    JsonObject mode = modes.add<JsonObject>();
    mode["name"] = modeNames[modeIndex];
    JsonArray slots = mode["slots"].to<JsonArray>();

    for (uint8_t i = 0; i < MAX_MAPPINGS; i++) {
      IRSlot current = modeSlots[modeIndex][i];
      if (current.type == SLOT_NONE) continue;

      JsonObject slot = slots.add<JsonObject>();
      char irCodeStr[12];
      formatHex(irCodeStr, sizeof(irCodeStr), current.irCode, 8);
      slot["irCode"] = irCodeStr;

      if (current.type == SLOT_KEYBOARD) {
        slot["type"] = "keyboard";
        char keyStr[6];
        formatHex(keyStr, sizeof(keyStr), current.key, 2);
        slot["key"] = keyStr;
        if (current.mods) {
          char modsStr[6];
          formatHex(modsStr, sizeof(modsStr), current.mods, 2);
          slot["mods"] = modsStr;
        }
      } else if (current.type == SLOT_CONSUMER) {
        slot["type"] = "consumer";
        char keyStr[8];
        formatHex(keyStr, sizeof(keyStr), current.key, 4);
        slot["key"] = keyStr;
      } else if (current.type == SLOT_MODE_SWITCH) {
        slot["type"] = "mode_switch";
      } else if (current.type == SLOT_COMBO) {
        slot["type"] = "combo";
        JsonArray steps = slot["steps"].to<JsonArray>();
        uint8_t stepCount = (uint8_t)current.key;
        for (uint8_t s = 0; s < stepCount && s < MAX_COMBO_STEPS; s++) {
          ComboStep cs = comboData[modeIndex][i][s];
          JsonObject step = steps.add<JsonObject>();
          char keyStr[8];
          if (cs.type == SLOT_KEYBOARD) {
            step["type"] = "keyboard";
            formatHex(keyStr, sizeof(keyStr), cs.key, 2);
          } else {
            step["type"] = "consumer";
            formatHex(keyStr, sizeof(keyStr), cs.key, 4);
          }
          step["key"] = keyStr;
          if (cs.mods) {
            char modsStr[6];
            formatHex(modsStr, sizeof(modsStr), cs.mods, 2);
            step["mods"] = modsStr;
          }
        }
      }
    }
  }
}

bool saveSettingsToFS() {
  DynamicJsonDocument doc(JSON_DOC_SIZE);
  JsonObject root = doc.to<JsonObject>();
  buildSettingsJson(root);

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "w");
  if (!file) {
    return false;
  }

  serializeJsonPretty(doc, file);
  file.close();
  return true;
}

// Load settings from JSON (IR, LED, etc.)
void loadSettings() {
  if (!LittleFS.exists(MAPPINGS_CONFIG_FILE)) {
    Serial.println("settings.json not found, using defaults");
    for (uint8_t i = 0; i < MODE_COUNT; i++)
      COLOR_CONFIG[i] = hexToRGB(COLOR_RAW[i], LED_BRIGHTNESS_PERCENT);
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  DynamicJsonDocument doc(JSON_DOC_SIZE);
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    for (uint8_t i = 0; i < MODE_COUNT; i++)
      COLOR_CONFIG[i] = hexToRGB(COLOR_RAW[i], LED_BRIGHTNESS_PERCENT);
    return;
  }

  // Load IR settings
  if (doc["ir"].is<JsonObject>()) {
    JsonObject ir = doc["ir"];
    applyIrSettings(ir);
  }

  // Load LED settings
  if (doc["led"].is<JsonObject>()) {
    JsonObject led = doc["led"];
    applyLedSettings(led);
  }

  // Store layout data for pass-through to web UI
  if (doc["layouts"].is<JsonArray>()) {
    serializeJson(doc["layouts"], layoutsJson, sizeof(layoutsJson));
  }

  Serial.println("Settings loaded from JSON");
}

// Load mode mappings from JSON file
void loadMappings() {
  if (!LittleFS.exists(MAPPINGS_CONFIG_FILE)) {
    Serial.println("Error: settings.json not found!");
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  DynamicJsonDocument doc(JSON_DOC_SIZE);
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  if (doc["modes"].is<JsonArray>()) {
    JsonArray modes = doc["modes"].as<JsonArray>();
    applyModeNamesFromArray(modes);
    uint8_t idx = 0;
    for (JsonObject mode : modes) {
      if (idx >= MODE_COUNT) break;
      if (mode["slots"].is<JsonArray>()) {
        applySlotsFromArray(idx, mode["slots"].as<JsonArray>());
      } else if (mode["keyboard"].is<JsonArray>() || mode["consumer"].is<JsonArray>()) {
        JsonArray keyboard = mode["keyboard"].is<JsonArray>() ? mode["keyboard"].as<JsonArray>() : JsonArray();
        JsonArray consumer = mode["consumer"].is<JsonArray>() ? mode["consumer"].as<JsonArray>() : JsonArray();
        applyLegacyMappings(idx, keyboard, consumer);
      }
      idx++;
    }
    Serial.println("Loaded mode mappings");
    return;
  }

  if (doc["keyboard"].is<JsonArray>() || doc["consumer"].is<JsonArray>()) {
    JsonArray keyboard = doc["keyboard"].is<JsonArray>() ? doc["keyboard"].as<JsonArray>() : JsonArray();
    JsonArray consumer = doc["consumer"].is<JsonArray>() ? doc["consumer"].as<JsonArray>() : JsonArray();
    applyLegacyMappings(0, keyboard, consumer);
    Serial.println("Loaded legacy mappings into Mode 1");
  }
}


// ------------------------------
// Send consumer key using TinyUSB HID
void consumerWrite(uint16_t keycode) {
  sendConsumerKey(keycode);
}

// Led
Adafruit_NeoPixel strip(1, LED_PIN, NEO_GRB + NEO_KHZ800);

// Update LED based on current mode
void updateLED()
{
  strip.setPixelColor(0, COLOR_CONFIG[currentMode < MODE_COUNT ? currentMode : 0]);
  strip.show();
}

// ------------------------------
void setup()
{
  Serial.begin(115200);
  webSerialInit();
  
  // Initialize LittleFS and load settings
  if (!LittleFS.begin()) {
    Serial.println("LittleFS mount failed!");
  } else {
    Serial.println("LittleFS mounted");
    loadSettings();
    for (uint8_t i = 0; i < MODE_COUNT; i++) {
      clearModeSlots(i);
    }
    loadMappings();
  }
  
  IrReceiver.begin(RECV_PIN, ENABLE_LED_FEEDBACK);
  setupUsbHid();

  // Initialize LED
  strip.begin();
  strip.show();
  updateLED();

  Serial.println("Ready to receive IR codes.");
}

// ------------------------------
void loop() {
  webSerialTick();
  TinyUSBDevice.task();
  if (IrReceiver.decode()) {
    uint32_t code = IrReceiver.decodedIRData.decodedRawData;
    Serial.print("IR code: 0x");
    Serial.println(code, HEX);

    if (webSerialConsumeIrCode(code)) {
      IrReceiver.resume();
      return;
    }

    // If remote sends 0x00, treat it as repeating the last button
    if (code == 0x00 && HANDLE_REPEAT_CONFIG) {
      if (repeatCount < REPEAT_DELAY_REPORTS) {
        repeatCount++;
        IrReceiver.resume();
        return;
      }
      code = lastCode;
    }
    
    else {
      lastCode = code; // update last code
      repeatCount = 0; // reset repeat count once a new code is received
    }

    // Check for mode change button
    if (code == mode_change) {
      currentMode = (currentMode + 1) % numModes;
      updateLED();
      Serial.print("Mode switched: ");
      Serial.println(currentMode == 0 ? "Mode 1" : "Mode 2");
    }

    // Handle key press based on current mode
    else {
      int slotIndex = findSlotIndex(currentMode, code);
      if (slotIndex >= 0) {
        IRSlot slot = modeSlots[currentMode][slotIndex];
        if (slot.type == SLOT_KEYBOARD) {
          sendKeyboardReport((uint8_t)slot.key, slot.mods);
          Serial.print("Sent keyboard key: 0x");
          Serial.print(slot.key, HEX);
          if (slot.mods) { Serial.print(" mods: 0x"); Serial.print(slot.mods, HEX); }
          Serial.println();
        } else if (slot.type == SLOT_CONSUMER) {
          consumerWrite(slot.key);
          Serial.print("Sent consumer key: 0x");
          Serial.println(slot.key, HEX);
        } else if (slot.type == SLOT_MODE_SWITCH) {
          currentMode = (currentMode + 1) % numModes;
          updateLED();
          Serial.print("Slot mode switch: ");
          Serial.println(currentMode);
        } else if (slot.type == SLOT_COMBO) {
          uint8_t stepCount = (uint8_t)slot.key;
          for (uint8_t s = 0; s < stepCount && s < MAX_COMBO_STEPS; s++) {
            ComboStep cs = comboData[currentMode][slotIndex][s];
            if (cs.type == SLOT_KEYBOARD) {
              sendKeyboardReport((uint8_t)cs.key, cs.mods);
            } else if (cs.type == SLOT_CONSUMER) {
              consumerWrite(cs.key);
            }
            delay(20);
          }
          Serial.print("Sent combo (");
          Serial.print(stepCount);
          Serial.println(" steps)");
        }
      }
    }
    
    IrReceiver.resume(); // ready for next code
  }
}
