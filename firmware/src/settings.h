#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#define JSON_DOC_SIZE 8192

void applySettingsFromJson(JsonObject doc);
void buildSettingsJson(JsonObject doc);
bool saveSettingsToFS();
void updateLED();
