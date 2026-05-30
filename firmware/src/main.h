#include <Arduino.h>
#include <IRremote.hpp>
#include <Adafruit_TinyUSB.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

// IR Settings (defaults - overridden by JSON if present)
#define MODE_CHANGE_CODE 0xC40387EE
#define IR_RECEIVE_PIN 1
#define HANDLE_REPEAT true
#define REPEAT_INITIAL_DELAY_REPORTS 5 // Count delay in number of reports

// LED Settings (defaults - overridden by JSON if present)
#define LED_PIN        16
#define KEYBOARD_MODE_LED   0x290118  
#define CONSUMER_MODE_LED   0x012329 
#define LED_BRIGHTNESS_PERCENT 10

// LittleFS config file
#define MAPPINGS_CONFIG_FILE "/settings.json"
#define MAX_MAPPINGS 20
#define MODE_COUNT 2


enum IRSlotType : uint8_t {
  SLOT_NONE = 0,
  SLOT_KEYBOARD = 1,
  SLOT_CONSUMER = 2
};

struct IRSlot
{
  uint32_t irCode;
  uint16_t key;
  uint8_t type;
};

// Runtime slots (loaded from JSON)
extern IRSlot modeSlots[MODE_COUNT][MAX_MAPPINGS];


