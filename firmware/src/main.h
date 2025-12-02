#include <Arduino.h>
#include <IRremote.hpp>
#include <Keyboard.h>
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


struct IRKeyboard
{
  uint32_t irCode;
  uint8_t key;
};

// Consumer/media mapping
struct IRConsumer
{
  uint32_t irCode;
  uint16_t consumerKey; // 16-bit HID usage
};

// Runtime arrays (loaded from JSON)
extern IRKeyboard keyboardMap[MAX_MAPPINGS];
extern uint8_t keyboardMapCount;
extern IRConsumer consumerMap[MAX_MAPPINGS];
extern uint8_t consumerMapCount;

