#include "main.h"

// Runtime configuration (loaded from JSON with defaults)
uint8_t RECV_PIN = IR_RECEIVE_PIN;
uint32_t mode_change = MODE_CHANGE_CODE;
uint8_t LED_PIN_CONFIG = LED_PIN;
uint32_t COLOR_CONSUMER_CONFIG = 0;
uint32_t COLOR_KEYBOARD_CONFIG = 0;
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

// Load settings from JSON (IR, LED, etc.)
void loadSettings() {
  if (!LittleFS.exists(MAPPINGS_CONFIG_FILE)) {
    Serial.println("settings.json not found, using defaults");
    COLOR_CONSUMER_CONFIG = hexToRGB(CONSUMER_MODE_LED, LED_BRIGHTNESS_PERCENT);
    COLOR_KEYBOARD_CONFIG = hexToRGB(KEYBOARD_MODE_LED, LED_BRIGHTNESS_PERCENT);
    return;
  }

  File file = LittleFS.open(MAPPINGS_CONFIG_FILE, "r");
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    COLOR_CONSUMER_CONFIG = hexToRGB(CONSUMER_MODE_LED, LED_BRIGHTNESS_PERCENT);
    COLOR_KEYBOARD_CONFIG = hexToRGB(KEYBOARD_MODE_LED, LED_BRIGHTNESS_PERCENT);
    return;
  }

  // Load IR settings
  if (doc["ir"].is<JsonObject>()) {
    JsonObject ir = doc["ir"];
    if (ir["modeChangeCode"].is<const char*>())
      mode_change = strtoul((const char*)ir["modeChangeCode"], NULL, 16);
    if (ir["receivePin"].is<uint8_t>())
      RECV_PIN = ir["receivePin"];
    if (ir["handleRepeat"].is<bool>())
      HANDLE_REPEAT_CONFIG = ir["handleRepeat"];
    if (ir["repeatInitialDelayReports"].is<uint8_t>())
      REPEAT_DELAY_REPORTS = ir["repeatInitialDelayReports"];
  }

  // Load LED settings
  if (doc["led"].is<JsonObject>()) {
    JsonObject led = doc["led"];
    if (led["pin"].is<uint8_t>())
      LED_PIN_CONFIG = led["pin"];
    if (led["brightnessPercent"].is<uint8_t>())
      LED_BRIGHTNESS_CONFIG = led["brightnessPercent"];
    
    uint32_t keyboardColor = KEYBOARD_MODE_LED;
    uint32_t consumerColor = CONSUMER_MODE_LED;
    
    if (led["keyboardModeColor"].is<const char*>())
      keyboardColor = strtoul((const char*)led["keyboardModeColor"], NULL, 16);
    if (led["consumerModeColor"].is<const char*>())
      consumerColor = strtoul((const char*)led["consumerModeColor"], NULL, 16);
    
    COLOR_KEYBOARD_CONFIG = hexToRGB(keyboardColor, LED_BRIGHTNESS_CONFIG);
    COLOR_CONSUMER_CONFIG = hexToRGB(consumerColor, LED_BRIGHTNESS_CONFIG);
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
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  JsonArray mappings = doc["keyboard"];
  keyboardMapCount = 0;

  for (JsonObject mapping : mappings) {
    if (keyboardMapCount >= MAX_MAPPINGS) break;

    const char* irCodeStr = mapping["irCode"];

    keyboardMap[keyboardMapCount].irCode = strtoul(irCodeStr, NULL, 16);

    // Accept formats for key:
    // - number: 42
    // - hex string: "0x2A"
    // - single-char string: "a"
    uint8_t keyVal = 0;
    if (mapping["key"].is<const char*>()) {
      const char* keyStr = mapping["key"];
      size_t len = strlen(keyStr);
      if (len == 1) {
        // single printable character, use ASCII (works with Keyboard.press)
        keyVal = (uint8_t)keyStr[0];
      } else if (len > 2 && keyStr[0] == '0' && (keyStr[1] == 'x' || keyStr[1] == 'X')) {
        // hex string
        keyVal = (uint8_t)strtoul(keyStr, NULL, 16);
      } else {
        // fallback: parse as decimal
        keyVal = (uint8_t)atoi(keyStr);
      }
    } else if (mapping["key"].is<int>()) {
      keyVal = (uint8_t)mapping["key"];
    }

    keyboardMap[keyboardMapCount].key = keyVal;

    Serial.print("Keyboard mapping - IR: 0x");
    Serial.print(keyboardMap[keyboardMapCount].irCode, HEX);
    Serial.print(" -> Key: ");
    if (keyVal >= 32 && keyVal <= 126) {
      // printable ASCII
      Serial.print("'\"");
      Serial.print((char)keyVal);
      Serial.print("\"'");
    } else {
      Serial.print(keyVal);
    }
    Serial.println();

    keyboardMapCount++;
  }

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
  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.print("JSON parse error: ");
    Serial.println(error.c_str());
    return;
  }

  JsonArray mappings = doc["consumer"];
  consumerMapCount = 0;

  for (JsonObject mapping : mappings) {
    if (consumerMapCount >= MAX_MAPPINGS) break;
    
    const char* irCodeStr = mapping["irCode"];
    
    consumerMap[consumerMapCount].irCode = strtoul(irCodeStr, NULL, 16);
    
    // Handle both hex string and direct number formats
    if (mapping["key"].is<const char*>()) {
      const char* keyStr = mapping["key"];
      consumerMap[consumerMapCount].consumerKey = strtoul(keyStr, NULL, 16);
    } else {
      consumerMap[consumerMapCount].consumerKey = mapping["key"];
    }
    
    Serial.print("Consumer mapping - IR: 0x");
    Serial.print(consumerMap[consumerMapCount].irCode, HEX);
    Serial.print(" -> Key: 0x");
    Serial.println(consumerMap[consumerMapCount].consumerKey, HEX);
    
    consumerMapCount++;
  }

  Serial.print("Loaded ");
  Serial.print(consumerMapCount);
  Serial.println(" consumer mappings");
}


// ------------------------------
// Send consumer key using Keyboard consumer API
void consumerWrite(uint16_t keycode) {
  Keyboard.consumerPress(keycode);
  delay(50);
  Keyboard.consumerRelease();
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
  Keyboard.begin();

  // Initialize LED
  strip.begin();
  strip.show();
  updateLED();

  Serial.println("Ready to receive IR codes.");
}

// ------------------------------
void loop() {
  if (IrReceiver.decode()) {
    uint32_t code = IrReceiver.decodedIRData.decodedRawData;
    Serial.print("IR code: 0x");
    Serial.println(code, HEX);

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
          Keyboard.press(key);
          delay(50);
          Keyboard.releaseAll();
          Serial.print("Sent keyboard key: ");
          Serial.println(key, HEX);
        }
      }
    }
    
    IrReceiver.resume(); // ready for next code
  }
}
