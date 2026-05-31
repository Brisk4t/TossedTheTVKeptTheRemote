#pragma once
#include <stdint.h>
#include <ArduinoJson.h>

// IR Settings (defaults — overridden by JSON if present)
#define MODE_CHANGE_CODE 0xC40387EE
#define IR_RECEIVE_PIN 28
#define HANDLE_REPEAT true
#define REPEAT_INITIAL_DELAY_REPORTS 5

// Slot / mode sizing
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

struct ComboStep {
  uint16_t key;
  uint8_t  type;
  uint8_t  mods;
};

struct IRSlot {
  uint32_t irCode;
  uint16_t key;   // For SLOT_COMBO: step count. Otherwise: HID usage ID.
  uint8_t  type;
  uint8_t  mods;
};

// IR state
extern uint8_t  RECV_PIN;
extern uint32_t mode_change;
extern uint8_t  currentMode;
extern uint8_t  numModes;
extern char     modeNames[MODE_COUNT][20];
extern bool     HANDLE_REPEAT_CONFIG;
extern uint8_t  REPEAT_DELAY_REPORTS;

// Slot data arrays
extern IRSlot    modeSlots[MODE_COUNT][MAX_MAPPINGS];
extern ComboStep comboData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS];
extern char      slotTextData[MODE_COUNT][MAX_MAPPINGS][MAX_TEXT_STEP_LEN];
extern char      comboTextData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS][MAX_TEXT_STEP_LEN];

// Callbacks into main.cpp — defined there, called by irremoteTick
void updateLED();
void sendKeyboardReport(uint8_t keycode, uint8_t modifier = 0);
void sendKeyboardKey(uint8_t ascii);
void sendConsumerKey(uint16_t key);

// IR module API
void clearModeSlots(uint8_t modeIndex);
int  findSlotIndex(uint8_t modeIndex, uint32_t code);
bool parseKeyValue(JsonVariant keyVar, uint16_t* outKey);
uint8_t parseSlotType(JsonVariant typeVar);
void applyIrSettings(JsonObject ir);
void applySlotsFromArray(uint8_t modeIndex, JsonArray slots);
void applyModeNamesFromArray(JsonArray modes);
void irremoteSetup();
void irremoteTick();
