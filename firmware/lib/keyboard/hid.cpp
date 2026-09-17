#include "hid.h"
#include <Adafruit_TinyUSB.h>
#include <Arduino.h>

// ------------------------------
// USB HID (Adafruit TinyUSB)

Adafruit_USBD_HID usb_hid;

uint16_t RELEASE_KEY_TIMEOUT_CONFIG = RELEASE_KEY_TIMEOUT;

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

void sendKeyboardDown(uint8_t keycode, uint8_t modifier) {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t keycodes[6] = {keycode, 0, 0, 0, 0, 0};
  tud_hid_keyboard_report(1, modifier, keycodes);
}

void sendKeyboardUp() {
  if (!TinyUSBDevice.mounted()) return;
  uint8_t empty[6] = {0};
  tud_hid_keyboard_report(1, 0, empty);
}

void sendConsumerDown(uint16_t key) {
  if (!TinyUSBDevice.mounted()) return;
  tud_hid_report(2, &key, sizeof(key));
}

void sendConsumerUp() {
  if (!TinyUSBDevice.mounted()) return;
  uint16_t empty = 0;
  tud_hid_report(2, &empty, sizeof(empty));
}

void sendKeyboardReport(uint8_t keycode, uint8_t modifier) {
  sendKeyboardDown(keycode, modifier);
  delay(10);
  sendKeyboardUp();
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
  sendConsumerDown(key);
  delay(10);
  sendConsumerUp();
}

// ------------------------------
// HID hold state machine

struct HidHeldKey {
  uint8_t  type;
  uint16_t key;
  uint8_t  mods;
  bool     held;
  uint32_t lastTime;
};

static HidHeldKey heldKey = {0, 0, 0, false, 0};

void hidKeyRelease() {
  if (!heldKey.held) return;
  if (heldKey.type == SLOT_KEYBOARD) {
    sendKeyboardUp();
  } else if (heldKey.type == SLOT_CONSUMER) {
    sendConsumerUp();
  }
  heldKey.held = false;
}

void hidKeyPress(uint8_t type, uint16_t key, uint8_t mods) {
  if (heldKey.held && (heldKey.type != type || heldKey.key != key || heldKey.mods != mods)) {
    hidKeyRelease();
  }
  if (type == SLOT_KEYBOARD) {
    sendKeyboardDown((uint8_t)key, mods);
  } else if (type == SLOT_CONSUMER) {
    sendConsumerDown(key);
  }
  heldKey = {type, key, mods, true, millis()};
}

void hidKeyRepeat() {
  if (!heldKey.held) return;
  if (heldKey.type == SLOT_KEYBOARD) {
    sendKeyboardDown((uint8_t)heldKey.key, heldKey.mods);
  } else if (heldKey.type == SLOT_CONSUMER) {
    sendConsumerDown(heldKey.key);
  }
  heldKey.lastTime = millis();
}

void hidKeyKeepAlive() {
  if (!heldKey.held) return;
  heldKey.lastTime = millis();
}

void hidKeyTick() {
  if (heldKey.held && (millis() - heldKey.lastTime > RELEASE_KEY_TIMEOUT_CONFIG)) {
    hidKeyRelease();
  }
}
