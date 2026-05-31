#include "main.h"
#include "settings.h"
#include "webserial.h"

// LED runtime config
uint8_t LED_PIN_CONFIG = LED_PIN;
uint8_t LED_BRIGHTNESS_CONFIG = LED_BRIGHTNESS_PERCENT;
uint32_t COLOR_CONFIG[MODE_COUNT] = {0, 0, 0, 0, 0};
uint32_t COLOR_RAW[MODE_COUNT] = {
  DEFAULT_MODE_COLOR_0, DEFAULT_MODE_COLOR_1, DEFAULT_MODE_COLOR_2,
  DEFAULT_MODE_COLOR_3, DEFAULT_MODE_COLOR_4
};

// Layout data stored as raw JSON for pass-through (firmware does not process this)
char layoutsJson[4096] = "[]";

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

void sendKeyboardReport(uint8_t keycode, uint8_t modifier) {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t keycodes[6] = {keycode, 0, 0, 0, 0, 0};
  tud_hid_keyboard_report(1, modifier, keycodes);
  delay(10);
  uint8_t empty[6] = {0};
  tud_hid_keyboard_report(1, 0, empty);
}

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

uint32_t hexToRGB(uint32_t hexColor, uint32_t brightnessPercent = 100) {
  uint8_t r = ((hexColor >> 16) & 0xFF) * brightnessPercent / 100;
  uint8_t g = ((hexColor >> 8) & 0xFF) * brightnessPercent / 100;
  uint8_t b = (hexColor & 0xFF) * brightnessPercent / 100;
  return (((uint32_t)g << 16) | ((uint32_t)r << 8) | b); // GRB format
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
  }

  for (uint8_t i = 0; i < MODE_COUNT; i++)
    COLOR_CONFIG[i] = hexToRGB(COLOR_RAW[i], LED_BRIGHTNESS_CONFIG);
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
      if (mode["slots"].is<JsonArray>())
        applySlotsFromArray(idx, mode["slots"].as<JsonArray>());
      idx++;
    }
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
      } else if (current.type == SLOT_TEXT) {
        slot["type"] = "text";
        slot["value"] = slotTextData[modeIndex][i];
      } else if (current.type == SLOT_COMBO) {
        slot["type"] = "combo";
        JsonArray steps = slot["steps"].to<JsonArray>();
        uint8_t stepCount = (uint8_t)current.key;
        for (uint8_t s = 0; s < stepCount && s < MAX_COMBO_STEPS; s++) {
          ComboStep cs = comboData[modeIndex][i][s];
          JsonObject step = steps.add<JsonObject>();
          if (cs.type == SLOT_TEXT) {
            step["type"] = "text";
            step["value"] = comboTextData[modeIndex][i][s];
            continue;
          }
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

  if (doc["ir"].is<JsonObject>()) {
    JsonObject ir = doc["ir"];
    applyIrSettings(ir);
  }

  if (doc["led"].is<JsonObject>()) {
    JsonObject led = doc["led"];
    applyLedSettings(led);
  }

  if (doc["layouts"].is<JsonArray>()) {
    serializeJson(doc["layouts"], layoutsJson, sizeof(layoutsJson));
  }

  Serial.println("Settings loaded from JSON");
}

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
      if (mode["slots"].is<JsonArray>())
        applySlotsFromArray(idx, mode["slots"].as<JsonArray>());
      idx++;
    }
    Serial.println("Loaded mode mappings");
  }
}

// ------------------------------
// LED

Adafruit_NeoPixel strip(1, LED_PIN, NEO_GRB + NEO_KHZ800);

void updateLED() {
  strip.setPixelColor(0, COLOR_CONFIG[currentMode < MODE_COUNT ? currentMode : 0]);
  strip.show();
}

// ------------------------------
void setup() {
  Serial.begin(115200);
  webSerialInit();

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

  irremoteSetup();
  setupUsbHid();

  strip.begin();
  strip.show();
  updateLED();

  Serial.println("Ready to receive IR codes.");
}

// ------------------------------
void loop() {
  webSerialTick();
  TinyUSBDevice.task();
  irremoteTick();
}
