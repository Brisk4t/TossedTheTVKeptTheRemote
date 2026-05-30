#include "settings.h"
#include "webserial.h"

namespace {
String serialLine;
bool learnPending = false;

void sendJsonResponse(JsonDocument& doc) {
  serializeJson(doc, Serial);
  Serial.print("\n");
}

void handleSerialCommand(const String& line) {
  StaticJsonDocument<JSON_DOC_SIZE> req;
  DeserializationError error = deserializeJson(req, line);
  StaticJsonDocument<JSON_DOC_SIZE> res;

  if (error) {
    res["ok"] = false;
    res["error"] = "json_parse";
    sendJsonResponse(res);
    return;
  }

  const char* op = req["op"] | "";

  if (strcmp(op, "get") == 0) {
    res["ok"] = true;
    JsonObject data = res["data"].to<JsonObject>();
    buildSettingsJson(data);
    sendJsonResponse(res);
    return;
  }

  if (strcmp(op, "set") == 0) {
    if (!req["data"].is<JsonObject>()) {
      res["ok"] = false;
      res["error"] = "missing_data";
      sendJsonResponse(res);
      return;
    }

    JsonObject data = req["data"].as<JsonObject>();
    applySettingsFromJson(data);
    updateLED();

    bool persist = req["persist"] | true;
    if (persist && !saveSettingsToFS()) {
      res["ok"] = false;
      res["error"] = "save_failed";
      sendJsonResponse(res);
      return;
    }

    res["ok"] = true;
    sendJsonResponse(res);
    return;
  }

  if (strcmp(op, "save") == 0) {
    bool saved = saveSettingsToFS();
    res["ok"] = saved;
    if (!saved) res["error"] = "save_failed";
    sendJsonResponse(res);
    return;
  }

  if (strcmp(op, "ping") == 0) {
    res["ok"] = true;
    res["device"] = "ir-hid";
    sendJsonResponse(res);
    return;
  }

  if (strcmp(op, "learn") == 0) {
    learnPending = true;
    res["ok"] = true;
    res["event"] = "learn_pending";
    sendJsonResponse(res);
    return;
  }

  res["ok"] = false;
  res["error"] = "unknown_op";
  sendJsonResponse(res);
}

void handleSerialCommands() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (serialLine.length() > 0) {
        handleSerialCommand(serialLine);
        serialLine = "";
      }
      continue;
    }

    if (serialLine.length() < JSON_DOC_SIZE) {
      serialLine += c;
    } else {
      serialLine = "";
    }
  }
}
} // namespace

void webSerialInit() {
  serialLine = "";
}

void webSerialTick() {
  handleSerialCommands();
}

bool webSerialConsumeIrCode(uint32_t code) {
  if (!learnPending) return false;
  if (code == 0x00) return false;

  StaticJsonDocument<JSON_DOC_SIZE> res;
  char codeStr[12];
  snprintf(codeStr, sizeof(codeStr), "0x%08X", code);
  res["ok"] = true;
  res["event"] = "learn";
  res["code"] = codeStr;
  sendJsonResponse(res);

  learnPending = false;
  return true;
}
