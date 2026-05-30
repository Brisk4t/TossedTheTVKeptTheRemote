#include "main.h"
#include "settings.h"
#include "webserial.h"

// Runtime configuration (loaded from JSON with defaults)
uint8_t RECV_PIN = IR_RECEIVE_PIN;
uint32_t mode_change = MODE_CHANGE_CODE;
uint8_t LED_PIN_CONFIG = LED_PIN;
uint32_t COLOR_CONSUMER_CONFIG = 0;
uint32_t COLOR_KEYBOARD_CONFIG = 0;
uint32_t CONSUMER_COLOR_RAW = CONSUMER_MODE_LED;
uint32_t KEYBOARD_COLOR_RAW = KEYBOARD_MODE_LED;
uint8_t LED_BRIGHTNESS_CONFIG = LED_BRIGHTNESS_PERCENT;
bool HANDLE_REPEAT_CONFIG = HANDLE_REPEAT;
uint8_t REPEAT_DELAY_REPORTS = REPEAT_INITIAL_DELAY_REPORTS;

// IR Repeat handling
uint32_t lastCode = 0; // Last received IR code for handling repeats
uint8_t repeatCount = 0; // Count of repeated reports

// Current mode: false = keyboard, true = consumer/media
bool useConsumer = true;

// Runtime key maps (loaded from JSON files)
IRKeyboard keyboardMap[MAX_MAPPINGS];
uint8_t keyboardMapCount = 0;
IRConsumer consumerMap[MAX_MAPPINGS];
uint8_t consumerMapCount = 0;

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

void sendKeyboardKey(uint8_t key) {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t keycodes[6] = {0};
  keycodes[0] = key;
  tud_hid_keyboard_report(1, 0, keycodes);
  delay(10);
  uint8_t empty[6] = {0};
  tud_hid_keyboard_report(1, 0, empty);
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

int findKeyboardKey(uint32_t code) {
  for (uint8_t i = 0; i < keyboardMapCount; i++)
    if (keyboardMap[i].irCode == code)
      return keyboardMap[i].key;
  return -1;
}

uint16_t findConsumerKey(uint32_t code) {
  for (uint8_t i = 0; i < consumerMapCount; i++)
    if (consumerMap[i].irCode == code)
      return consumerMap[i].consumerKey;
  return 0;
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
}

void applyLedSettings(JsonObject led) {
  if (led["pin"].is<uint8_t>())
    LED_PIN_CONFIG = led["pin"];
  if (led["brightnessPercent"].is<uint8_t>())
    LED_BRIGHTNESS_CONFIG = led["brightnessPercent"];

  uint32_t keyboardColor = KEYBOARD_COLOR_RAW;
  uint32_t consumerColor = CONSUMER_COLOR_RAW;

  if (led["keyboardModeColor"].is<const char*>())
    keyboardColor = strtoul((const char*)led["keyboardModeColor"], NULL, 16);
  if (led["consumerModeColor"].is<const char*>())
    consumerColor = strtoul((const char*)led["consumerModeColor"], NULL, 16);

  KEYBOARD_COLOR_RAW = keyboardColor;
  CONSUMER_COLOR_RAW = consumerColor;
  COLOR_KEYBOARD_CONFIG = hexToRGB(keyboardColor, LED_BRIGHTNESS_CONFIG);
  COLOR_CONSUMER_CONFIG = hexToRGB(consumerColor, LED_BRIGHTNESS_CONFIG);
}

void applyKeyboardMappings(JsonArray mappings) {
  keyboardMapCount = 0;

  for (JsonObject mapping : mappings) {
    if (keyboardMapCount >= MAX_MAPPINGS) break;

    const char* irCodeStr = mapping["irCode"];
    keyboardMap[keyboardMapCount].irCode = strtoul(irCodeStr, NULL, 16);

    uint8_t keyVal = 0;
    if (mapping["key"].is<const char*>()) {
      const char* keyStr = mapping["key"];
      size_t len = strlen(keyStr);
      if (len == 1) {
        keyVal = (uint8_t)keyStr[0];
      } else if (len > 2 && keyStr[0] == '0' && (keyStr[1] == 'x' || keyStr[1] == 'X')) {
        keyVal = (uint8_t)strtoul(keyStr, NULL, 16);
      } else {
        keyVal = (uint8_t)atoi(keyStr);
      }
    } else if (mapping["key"].is<int>()) {
      keyVal = (uint8_t)mapping["key"];
    }

    keyboardMap[keyboardMapCount].key = keyVal;
    keyboardMapCount++;
  }
}

void applyConsumerMappings(JsonArray mappings) {
  consumerMapCount = 0;

  for (JsonObject mapping : mappings) {
    if (consumerMapCount >= MAX_MAPPINGS) break;

    const char* irCodeStr = mapping["irCode"];
    consumerMap[consumerMapCount].irCode = strtoul(irCodeStr, NULL, 16);

    if (mapping["key"].is<const char*>()) {
      const char* keyStr = mapping["key"];
      consumerMap[consumerMapCount].consumerKey = strtoul(keyStr, NULL, 16);
    } else {
      consumerMap[consumerMapCount].consumerKey = mapping["key"];
    }

    consumerMapCount++;
  }
}

void applySettingsFromJson(JsonObject doc) {
  if (doc["ir"].is<JsonObject>())
    applyIrSettings(doc["ir"].as<JsonObject>());
  if (doc["led"].is<JsonObject>())
    applyLedSettings(doc["led"].as<JsonObject>());
  if (doc["keyboard"].is<JsonArray>())
    applyKeyboardMappings(doc["keyboard"].as<JsonArray>());
  if (doc["consumer"].is<JsonArray>())
    applyConsumerMappings(doc["consumer"].as<JsonArray>());
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
  ir["receivePin"] = RECV_PIN;
  ir["handleRepeat"] = HANDLE_REPEAT_CONFIG;
  ir["repeatInitialDelayReports"] = REPEAT_DELAY_REPORTS;

  JsonObject led = doc["led"].to<JsonObject>();
  led["pin"] = LED_PIN_CONFIG;
  led["brightnessPercent"] = LED_BRIGHTNESS_CONFIG;

  char keyboardColorStr[12];
  char consumerColorStr[12];
  formatHex(keyboardColorStr, sizeof(keyboardColorStr), KEYBOARD_COLOR_RAW, 8);
  formatHex(consumerColorStr, sizeof(consumerColorStr), CONSUMER_COLOR_RAW, 8);
  led["keyboardModeColor"] = keyboardColorStr;
  led["consumerModeColor"] = consumerColorStr;

  JsonArray keyboard = doc["keyboard"].to<JsonArray>();
  for (uint8_t i = 0; i < keyboardMapCount; i++) {
    JsonObject mapping = keyboard.add<JsonObject>();
    char irCodeStr[12];
    char keyStr[6];
    formatHex(irCodeStr, sizeof(irCodeStr), keyboardMap[i].irCode, 8);
    formatHex(keyStr, sizeof(keyStr), keyboardMap[i].key, 2);
    mapping["irCode"] = irCodeStr;
    mapping["key"] = keyStr;
  }

  JsonArray consumer = doc["consumer"].to<JsonArray>();
  for (uint8_t i = 0; i < consumerMapCount; i++) {
    JsonObject mapping = consumer.add<JsonObject>();
    char irCodeStr[12];
    char keyStr[8];
    formatHex(irCodeStr, sizeof(irCodeStr), consumerMap[i].irCode, 8);
    formatHex(keyStr, sizeof(keyStr), consumerMap[i].consumerKey, 4);
    mapping["irCode"] = irCodeStr;
    mapping["key"] = keyStr;
  }
}

bool saveSettingsToFS() {
  StaticJsonDocument<JSON_DOC_SIZE> doc;
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
    KEYBOARD_COLOR_RAW = KEYBOARD_MODE_LED;
    CONSUMER_COLOR_RAW = CONSUMER_MODE_LED;
    COLOR_CONSUMER_CONFIG = hexToRGB(CONSUMER_MODE_LED, LED_BRIGHTNESS_PERCENT);
    COLOR_KEYBOARD_CONFIG = hexToRGB(KEYBOARD_MODE_LED, LED_BRIGHTNESS_PERCENT);
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    KEYBOARD_COLOR_RAW = KEYBOARD_MODE_LED;
    CONSUMER_COLOR_RAW = CONSUMER_MODE_LED;
    COLOR_CONSUMER_CONFIG = hexToRGB(CONSUMER_MODE_LED, LED_BRIGHTNESS_PERCENT);
    COLOR_KEYBOARD_CONFIG = hexToRGB(KEYBOARD_MODE_LED, LED_BRIGHTNESS_PERCENT);
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

  Serial.println("Settings loaded from JSON");
}

// Load keyboard mappings from JSON file
void loadKeyboardMappings() {
  if (!LittleFS.exists(MAPPINGS_CONFIG_FILE)) {
    Serial.println("Error: settings.json not found!");
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  JsonArray mappings = doc["keyboard"];
  applyKeyboardMappings(mappings);

  Serial.print("Loaded ");
  Serial.print(keyboardMapCount);
  Serial.println(" keyboard mappings");
}

// Load consumer mappings from JSON file
void loadConsumerMappings() {
  if (!LittleFS.exists(MAPPINGS_CONFIG_FILE)) {
    Serial.println("Error: settings.json not found!");
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  StaticJsonDocument<JSON_DOC_SIZE> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  JsonArray mappings = doc["consumer"];
  applyConsumerMappings(mappings);

  Serial.print("Loaded ");
  Serial.print(consumerMapCount);
  Serial.println(" consumer mappings");
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
  if (useConsumer){
    strip.setPixelColor(0, COLOR_CONSUMER_CONFIG); // Consumer Control
  }

  else {
    strip.setPixelColor(0, COLOR_KEYBOARD_CONFIG); // Keyboard
  }
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
    loadKeyboardMappings();
    loadConsumerMappings();
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
      useConsumer = !useConsumer;
      updateLED();
      Serial.print("Mode switched: ");
      Serial.println(useConsumer ? "Consumer/Media" : "Keyboard");
    }

    // Handle key press based on current mode
    else {
      if (useConsumer) {
        uint16_t consumerKey = findConsumerKey(code);
        if (consumerKey) {
          consumerWrite(consumerKey);
          Serial.print("Sent consumer key: ");
          Serial.println(consumerKey, HEX);
        }
      }

      else {
        int key = findKeyboardKey(code);
        if (key != -1) {
          sendKeyboardKey((uint8_t)key);
          Serial.print("Sent keyboard key: ");
          Serial.println(key, HEX);
        }
      }
    }
    
    IrReceiver.resume(); // ready for next code
  }
}
