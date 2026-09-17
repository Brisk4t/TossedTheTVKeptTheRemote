#include "main.h"
#include "settings.h"
#include "webserial.h"

// LED runtime config
uint8_t  LED_PIN_CONFIG        = LED_PIN;
uint8_t  LED_BRIGHTNESS_CONFIG = LED_BRIGHTNESS_PERCENT;
uint16_t LED_ORDER_CONFIG      = NEO_GRB;
char     LED_ORDER_STR[4]      = "GRB";
uint32_t COLOR_CONFIG[MODE_COUNT] = {0, 0, 0, 0, 0};
uint32_t COLOR_RAW[MODE_COUNT] = {
  DEFAULT_MODE_COLOR_0, DEFAULT_MODE_COLOR_1, DEFAULT_MODE_COLOR_2,
  DEFAULT_MODE_COLOR_3, DEFAULT_MODE_COLOR_4
};

Adafruit_NeoPixel strip(1, LED_PIN, NEO_GRB + NEO_KHZ800);

// Layout data stored as raw JSON for pass-through (firmware does not process this)
char layoutsJson[4096] = "[]";

// ------------------------------
// Helpers

static const struct { const char* name; uint16_t type; } kColorOrders[] = {
  { "RGB", NEO_RGB }, { "RBG", NEO_RBG },
  { "GRB", NEO_GRB }, { "GBR", NEO_GBR },
  { "BRG", NEO_BRG }, { "BGR", NEO_BGR },
};

static bool parseColorOrder(const char* str) {
  for (const auto& o : kColorOrders) {
    if (strcasecmp(str, o.name) == 0) {
      if (LED_ORDER_CONFIG == o.type) return false;
      LED_ORDER_CONFIG = o.type;
      strlcpy(LED_ORDER_STR, o.name, sizeof(LED_ORDER_STR));
      return true;
    }
  }
  return false;
}

uint32_t hexToRGB(uint32_t hexColor, uint32_t brightnessPercent = 100) {
  uint8_t r = ((hexColor >> 16) & 0xFF) * brightnessPercent / 100;
  uint8_t g = ((hexColor >> 8) & 0xFF) * brightnessPercent / 100;
  uint8_t b = (hexColor & 0xFF) * brightnessPercent / 100;
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}

void applyLedSettings(JsonObject led) {
  bool reinit = false;

  if (led["pin"].is<uint8_t>()) {
    uint8_t p = led["pin"];
    if (p != LED_PIN_CONFIG) { LED_PIN_CONFIG = p; reinit = true; }
  }
  if (led["brightnessPercent"].is<uint8_t>())
    LED_BRIGHTNESS_CONFIG = led["brightnessPercent"];
  if (led["colorOrder"].is<const char*>())
    if (parseColorOrder(led["colorOrder"].as<const char*>())) reinit = true;

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

  if (reinit) {
    strip.setPin(LED_PIN_CONFIG);
    strip.updateType(LED_ORDER_CONFIG | NEO_KHZ800);
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
  ir["releaseKeyTimeout"] = RELEASE_KEY_TIMEOUT_CONFIG;

  JsonObject led = doc["led"].to<JsonObject>();
  led["pin"] = LED_PIN_CONFIG;
  led["colorOrder"] = LED_ORDER_STR;
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

  strip.setPin(LED_PIN_CONFIG);
  strip.updateType(LED_ORDER_CONFIG | NEO_KHZ800);
  strip.begin();
  strip.show();
  updateLED();

  Serial.println("Ready to receive IR codes.");
}

// ------------------------------
void loop() {
  webSerialTick();
  TinyUSBDevice.task();
  hidKeyTick();
  irremoteTick();
}
