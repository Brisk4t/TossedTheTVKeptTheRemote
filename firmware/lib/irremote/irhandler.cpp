#include "irhandler.h"
#include <IRremote.hpp>
#include "webserial.h"

uint8_t RECV_PIN = IR_RECEIVE_PIN;
uint32_t mode_change = MODE_CHANGE_CODE;
uint8_t currentMode = 0;
uint8_t numModes = 2;
char modeNames[MODE_COUNT][20] = {
  "Layer 1", "Layer 2", "Layer 3", "Layer 4", "Layer 5"
};
bool HANDLE_REPEAT_CONFIG = HANDLE_REPEAT;
uint8_t REPEAT_DELAY_REPORTS = REPEAT_INITIAL_DELAY_REPORTS;

static uint32_t lastCode = 0;
static uint8_t repeatCount = 0;

IRSlot    modeSlots[MODE_COUNT][MAX_MAPPINGS];
ComboStep comboData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS];
char      slotTextData[MODE_COUNT][MAX_MAPPINGS][MAX_TEXT_STEP_LEN];
char      comboTextData[MODE_COUNT][MAX_MAPPINGS][MAX_COMBO_STEPS][MAX_TEXT_STEP_LEN];

void clearModeSlots(uint8_t modeIndex) {
  if (modeIndex >= MODE_COUNT) return;
  for (uint8_t i = 0; i < MAX_MAPPINGS; i++) {
    modeSlots[modeIndex][i] = {0, 0, SLOT_NONE, 0};
    slotTextData[modeIndex][i][0] = '\0';
    for (uint8_t s = 0; s < MAX_COMBO_STEPS; s++) {
      comboData[modeIndex][i][s] = {0, 0, 0};
      comboTextData[modeIndex][i][s][0] = '\0';
    }
  }
}

int findSlotIndex(uint8_t modeIndex, uint32_t code) {
  if (modeIndex >= MODE_COUNT) return -1;
  for (uint8_t i = 0; i < MAX_MAPPINGS; i++) {
    if (modeSlots[modeIndex][i].type != SLOT_NONE && modeSlots[modeIndex][i].irCode == code) {
      return i;
    }
  }
  return -1;
}

bool parseKeyValue(JsonVariant keyVar, uint16_t* outKey) {
  if (keyVar.is<const char*>()) {
    const char* keyStr = keyVar.as<const char*>();
    size_t len = strlen(keyStr);
    if (len == 1) {
      *outKey = (uint8_t)keyStr[0];
      return true;
    }
    if (len > 2 && keyStr[0] == '0' && (keyStr[1] == 'x' || keyStr[1] == 'X')) {
      *outKey = (uint16_t)strtoul(keyStr, NULL, 16);
      return true;
    }
    *outKey = (uint16_t)atoi(keyStr);
    return true;
  }
  if (keyVar.is<int>()) {
    *outKey = (uint16_t)keyVar.as<int>();
    return true;
  }
  return false;
}

uint8_t parseSlotType(JsonVariant typeVar) {
  if (typeVar.is<const char*>()) {
    const char* typeStr = typeVar.as<const char*>();
    if (strcmp(typeStr, "keyboard") == 0)    return SLOT_KEYBOARD;
    if (strcmp(typeStr, "consumer") == 0)    return SLOT_CONSUMER;
    if (strcmp(typeStr, "mode_switch") == 0) return SLOT_MODE_SWITCH;
    if (strcmp(typeStr, "combo") == 0)       return SLOT_COMBO;
    if (strcmp(typeStr, "text") == 0)        return SLOT_TEXT;
  }
  if (typeVar.is<uint8_t>()) {
    uint8_t typeVal = typeVar.as<uint8_t>();
    if (typeVal <= SLOT_MODE_SWITCH) return typeVal;
  }
  return SLOT_NONE;
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
  if (ir["modeCount"].is<uint8_t>()) {
    uint8_t mc = ir["modeCount"].as<uint8_t>();
    if (mc >= 1 && mc <= MODE_COUNT) numModes = mc;
  }
}

void applySlotsFromArray(uint8_t modeIndex, JsonArray slots) {
  if (modeIndex >= MODE_COUNT) return;
  clearModeSlots(modeIndex);

  uint8_t slotIndex = 0;
  for (JsonObject slot : slots) {
    if (slotIndex >= MAX_MAPPINGS) break;
    if (!slot["irCode"].is<const char*>()) { slotIndex++; continue; }

    const char* irCodeStr = slot["irCode"];
    uint32_t irCode = strtoul(irCodeStr, NULL, 16);
    uint8_t typeVal = parseSlotType(slot["type"]);
    if (typeVal == SLOT_NONE) { slotIndex++; continue; }

    if (typeVal == SLOT_TEXT) {
      if (!slot["value"].is<const char*>()) { slotIndex++; continue; }
      strlcpy(slotTextData[modeIndex][slotIndex], slot["value"].as<const char*>(), MAX_TEXT_STEP_LEN);
      modeSlots[modeIndex][slotIndex] = {irCode, 0, SLOT_TEXT, 0};
      slotIndex++;
      continue;
    }

    if (typeVal == SLOT_COMBO) {
      if (!slot["steps"].is<JsonArray>()) { slotIndex++; continue; }
      uint8_t stepCount = 0;
      for (JsonObject step : slot["steps"].as<JsonArray>()) {
        if (stepCount >= MAX_COMBO_STEPS) break;
        uint8_t stepType = parseSlotType(step["type"]);
        if (stepType == SLOT_TEXT) {
          if (!step["value"].is<const char*>()) continue;
          strlcpy(comboTextData[modeIndex][slotIndex][stepCount], step["value"].as<const char*>(), MAX_TEXT_STEP_LEN);
          comboData[modeIndex][slotIndex][stepCount] = {0, SLOT_TEXT, 0};
          stepCount++;
          continue;
        }
        if (stepType != SLOT_KEYBOARD && stepType != SLOT_CONSUMER) continue;
        uint16_t stepKey = 0;
        if (!parseKeyValue(step["key"], &stepKey)) continue;
        uint8_t stepMods = 0;
        if (step["mods"].is<const char*>())
          stepMods = (uint8_t)strtoul(step["mods"].as<const char*>(), NULL, 16);
        comboData[modeIndex][slotIndex][stepCount] = {stepKey, stepType, stepMods};
        stepCount++;
      }
      modeSlots[modeIndex][slotIndex] = {irCode, stepCount, SLOT_COMBO, 0};
      slotIndex++;
      continue;
    }

    uint16_t keyVal = 0;
    if (typeVal != SLOT_MODE_SWITCH && !parseKeyValue(slot["key"], &keyVal)) {
      slotIndex++; continue;
    }
    uint8_t modsVal = 0;
    if (slot["mods"].is<const char*>())
      modsVal = (uint8_t)strtoul(slot["mods"].as<const char*>(), NULL, 16);

    modeSlots[modeIndex][slotIndex] = {irCode, keyVal, typeVal, modsVal};
    slotIndex++;
  }
}

void applyModeNamesFromArray(JsonArray modes) {
  uint8_t idx = 0;
  for (JsonObject mode : modes) {
    if (idx >= MODE_COUNT) break;
    if (mode["name"].is<const char*>()) {
      strlcpy(modeNames[idx], mode["name"].as<const char*>(), sizeof(modeNames[idx]));
    }
    idx++;
  }
}

void irremoteSetup() {
  IrReceiver.begin(RECV_PIN, ENABLE_LED_FEEDBACK);
}

void irremoteTick() {
  if (!IrReceiver.decode()) return;

  uint32_t code = IrReceiver.decodedIRData.decodedRawData;
  Serial.print("IR code: 0x");
  Serial.println(code, HEX);

  if (webSerialConsumeIrCode(code)) {
    IrReceiver.resume();
    return;
  }

  if (code == 0x00 && HANDLE_REPEAT_CONFIG) {
    if (repeatCount < REPEAT_DELAY_REPORTS) {
      repeatCount++;
      IrReceiver.resume();
      return;
    }
    code = lastCode;
  } else {
    lastCode = code;
    repeatCount = 0;
  }

  if (code == mode_change) {
    currentMode = (currentMode + 1) % numModes;
    updateLED();
    Serial.print("Mode switched: ");
    Serial.println(currentMode == 0 ? "Mode 1" : "Mode 2");
  } else {
    int slotIndex = findSlotIndex(currentMode, code);
    if (slotIndex >= 0) {
      IRSlot slot = modeSlots[currentMode][slotIndex];
      if (slot.type == SLOT_KEYBOARD) {
        sendKeyboardReport((uint8_t)slot.key, slot.mods);
        Serial.print("Sent keyboard key: 0x");
        Serial.print(slot.key, HEX);
        if (slot.mods) { Serial.print(" mods: 0x"); Serial.print(slot.mods, HEX); }
        Serial.println();
      } else if (slot.type == SLOT_CONSUMER) {
        sendConsumerKey(slot.key);
        Serial.print("Sent consumer key: 0x");
        Serial.println(slot.key, HEX);
      } else if (slot.type == SLOT_MODE_SWITCH) {
        currentMode = (currentMode + 1) % numModes;
        updateLED();
        Serial.print("Slot mode switch: ");
        Serial.println(currentMode);
      } else if (slot.type == SLOT_TEXT) {
        const char* text = slotTextData[currentMode][slotIndex];
        for (uint8_t c = 0; text[c] != '\0'; c++) {
          sendKeyboardKey((uint8_t)text[c]);
          delay(10);
        }
        Serial.print("Sent text: ");
        Serial.println(text);
      } else if (slot.type == SLOT_COMBO) {
        uint8_t stepCount = (uint8_t)slot.key;
        for (uint8_t s = 0; s < stepCount && s < MAX_COMBO_STEPS; s++) {
          ComboStep cs = comboData[currentMode][slotIndex][s];
          if (cs.type == SLOT_TEXT) {
            const char* text = comboTextData[currentMode][slotIndex][s];
            for (uint8_t c = 0; text[c] != '\0'; c++) {
              sendKeyboardKey((uint8_t)text[c]);
              delay(10);
            }
          } else if (cs.type == SLOT_KEYBOARD) {
            sendKeyboardReport((uint8_t)cs.key, cs.mods);
          } else if (cs.type == SLOT_CONSUMER) {
            sendConsumerKey(cs.key);
          }
          delay(20);
        }
        Serial.print("Sent combo (");
        Serial.print(stepCount);
        Serial.println(" steps)");
      }
    }
  }

  IrReceiver.resume();
}
