#pragma once
#include <stdint.h>

#define RELEASE_KEY_TIMEOUT 200

extern uint16_t RELEASE_KEY_TIMEOUT_CONFIG;

enum IRSlotType : uint8_t {
  SLOT_NONE        = 0,
  SLOT_KEYBOARD    = 1,
  SLOT_CONSUMER    = 2,
  SLOT_MODE_SWITCH = 3,
  SLOT_COMBO       = 4,
  SLOT_TEXT        = 5
};

void setupUsbHid();
bool asciiToHid(uint8_t ascii, uint8_t* modifier, uint8_t* keycode);
void sendKeyboardReport(uint8_t keycode, uint8_t modifier = 0);
void sendKeyboardKey(uint8_t ascii);
void sendConsumerKey(uint16_t key);

// HID hold state machine
void hidKeyPress(uint8_t type, uint16_t key, uint8_t mods);
void hidKeyRepeat();
void hidKeyRelease();
void hidKeyKeepAlive();
void hidKeyTick();
