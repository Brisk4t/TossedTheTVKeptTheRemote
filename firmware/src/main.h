#pragma once
#include <Arduino.h>
#include <Adafruit_TinyUSB.h>
#include <Adafruit_NeoPixel.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include "irhandler.h"

// LED Settings (defaults - overridden by JSON if present)
#define LED_PIN              16
#define LED_BRIGHTNESS_PERCENT 10
#define DEFAULT_MODE_COLOR_0 0x290118
#define DEFAULT_MODE_COLOR_1 0x012329
#define DEFAULT_MODE_COLOR_2 0x122900
#define DEFAULT_MODE_COLOR_3 0x291200
#define DEFAULT_MODE_COLOR_4 0x001229

// LittleFS
#define MAPPINGS_CONFIG_FILE "/settings.json"
