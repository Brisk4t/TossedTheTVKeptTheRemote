#include <Arduino.h>
#include <IRremote.hpp>
#include <Adafruit_TinyUSB.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

// IR Settings (defaults - overridden by JSON if present)
#define MODE_CHANGE_CODE 0xC40387EE
#define IR_RECEIVE_PIN 28
#define HANDLE_REPEAT true
#define REPEAT_INITIAL_DELAY_REPORTS 5 // Count delay in number of reports

// LED Settings (defaults - overridden by JSON if present)
#define LED_PIN              16
#define LED_BRIGHTNESS_PERCENT 10
// Default LED colors per mode (RGB hex)
#define DEFAULT_MODE_COLOR_0 0x290118
#define DEFAULT_MODE_COLOR_1 0x012329
#define DEFAULT_MODE_COLOR_2 0x122900
#define DEFAULT_MODE_COLOR_3 0x291200
#define DEFAULT_MODE_COLOR_4 0x001229

// LittleFS config file
#define MAPPINGS_CONFIG_FILE "/settings.json"
#define MAX_MAPPINGS      20
#define MODE_COUNT         5
#define MAX_COMBO_STEPS    8
#define MAX_TEXT_STEP_LEN 48


enum IRSlotType : uint8_t {
  SLOT_NONE        = 0,
  SLOT_KEYBOARD    = 1,
  SLOT_CONSUMER    = 2,
  SLOT_MODE_SWITCH = 3,
  SLOT_COMBO       = 4,
  SLOT_TEXT        = 5
};

// One step inside a combo sequence
struct ComboStep {
  uint16_t key;
  uint8_t  type;  // SLOT_KEYBOARD or SLOT_CONSUMER
  uint8_t  mods;  // USB HID modifier byte
};

struct IRSlot {
  uint32_t irCode;
  uint16_t key;   // For SLOT_COMBO: step count. Otherwise: HID usage ID.
  uint8_t  type;
  uint8_t  mods;  // USB HID modifier byte (keyboard slots only)
};

// Runtime slots (loaded from JSON)
extern IRSlot    modeSlots[MODE_COUNT][MAX_MAPPINGS];
extern ComboStep comboData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS];
extern char      slotTextData[MODE_COUNT][MAX_MAPPINGS][MAX_TEXT_STEP_LEN];
extern char      comboTextData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS][MAX_TEXT_STEP_LEN];


