<div align="center">

# Tossed The TV — Kept The Remote
<div>
  	<img src="https://img.shields.io/badge/-Raspberry_Pi-C51A4A?style=for-the-badge&logo=Raspberry-Pi" alt="Raspberry Pi"/>
  	<img src="https://img.shields.io/badge/c++-%2300599C.svg?style=for-the-badge&logo=c%2B%2B&logoColor=white" alt="C++"/>
  	<img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript"/>
	<img src="https://img.shields.io/badge/PlatformIO-%23222.svg?style=for-the-badge&logo=platformio&logoColor=%23f5822a" alt="PlatformIO"/>
</div>

### There are way too many old TV remotes in the garbage dump.... And way too many overpriced "powerpoint clickers" on Amazon. Its quite appalling. 


All you need is $5, an RP2040 and 5 minutes to turn that old, suspiciously sticky T.V. remote into a fully functional _USB Keyboard / Clicker / Thingy_ that you can reprogram on the fly like your favorite **hackerman keyboard**.  
</div>

![App](/images/app.png)


The firmware receives IR codes from a standard 38 kHz receiver and translates them to USB HID reports based on a JSON configuration stored on the device's filesystem. A browser-based config tool communicates over Web Serial to let you map buttons, learn IR codes, and arrange layouts.


# Hardware 🛠️

* USB-Capable microcontroller / dev board RP2040 board Pico, Pico W, RP2040-Zero, etc.
* IR receiver 38 kHz module (TSOPxx or equivalent).
* NeoPixel LED Single WS2812 for layer colour feedback.

**Wiring (defaults — all configurable in settings)**

| RP2040 Pin | Component | Component Pin |
|------------|-----------|---------------|
| GPIO 28 | IR receiver | OUT |
| GPIO 16 | NeoPixel | DIN |


# Quick Start

>[!NOTE] **Web Serial is Chromium only** must use a Chromium-based browser (Chrome / Edge / Brave). Firefox does not support Web Serial.

>[!TIP] Pre-built `.uf2` images are available on the [Releases](../../releases) page — download the latest and drag it onto the board's USB mass-storage drive.

1. Download the most recently leased ```*.uf2``` file.
2. Hold the ```BOOTSEL``` / ```BOOT``` button on the RP20xx board and plug it in to your computer / press reset (if already plugged in)
3. Copy the ```*.uf2``` to the newly discovered USB-Drive
4. Navigate to [The TTVKTR webapp](https://brisk4t.github.io/TossedTheTVKeptTheRemote/).
5. Connect and start adding buttons to the layout.


# Config UI

![Customize](/images/customize.png)

The config UI is deployed to GitHub Pages at **https://brisk4t.github.io/TossedTheTVKeptTheRemote/**. You can also open `web/index.html` locally in any Chromium-based browser (Chrome, Edge) — Web Serial is required.

1. Click **Click to Connect** and select the device's serial port.
2. Settings load automatically from the device.
3. Use the **Layers** tabs to switch between mapping contexts.
4. Select a button in the grid, then assign a key from the dropdown or compose a custom combo.
5. Click **Apply** to write changes back to the device.

## Layout editing

![Layouts](/images/layouts.png)

Each layer can have one or more **layouts** — named grids of buttons. Enter edit mode with **Edit Layout** to drag buttons around, add/remove slots, or use **Auto-Add** to rapidly bind IR codes to keys by pressing remote buttons followed by the target keyboard key.

### Key types

| Type | Description |
|------|-------------|
| Preset | Single keyboard or consumer HID key from the dropdown |
| Custom | Compose a sequence of keys and modifiers using the combo editor |
| Mode Switch | Advance to the next layer |

## Combos:

![Combos](/images/combos.png)

- Modifier chips (Ctrl / Shift / Alt / Win) toggled before capturing a key
- Multiple steps chained with `→` (e.g. `Ctrl+A → Delete → Tab`)
- Text steps that type a literal string character by character


# Repository layout

```
firmware/
  platformio.ini        — PlatformIO build config
  src/
    main.cpp / main.h   — Core firmware
    webserial.cpp/.h    — JSON serial protocol handler
    settings.h          — JSON doc size and function declarations
  data/
    settings.json       — Runtime config (flashed to LittleFS)
web/
  index.html            — Config UI
  app.js                — All UI logic
  styles.css            — Styles
```


## Build from source & flash

To build from source, requires [PlatformIO](https://platformio.org/).

```powershell
cd firmware
pio run -t upload              # build and upload firmware
pio run -t uploadfs            # build and upload data partition (settings.json)
```

For UF2 boards: `pio run -e pico` and `pio run -e pico -t buildfs` produce `firmware.uf2` and `littlefs.uf2` inside `.pio/build/pico/`. Concatenate them (`cat firmware.uf2 littlefs.uf2 > firmware_with_fs.uf2`) and drag the combined file onto the board's mass-storage drive.


## Settings format

Settings are stored as JSON on LittleFS at `/settings.json`. The web UI reads and writes this format over serial.

```json
{
  "ir": {
    "modeChangeCode": "0xC40387EE",
    "modeCount": 2,
    "receivePin": 28,
    "handleRepeat": true,
    "repeatInitialDelayReports": 5
  },
  "led": {
    "pin": 16,
    "modeColors": ["0xFF0040", "0x0080FF"],
    "brightnessPercent": 10
  },
  "modes": [
    {
      "name": "Layer 1",
      "slots": [
        { "irCode": "0xC40387EE", "type": "consumer", "key": "0xCD" },
        { "irCode": "0x...",      "type": "keyboard",  "key": "0x28" },
        { "irCode": "0x...",      "type": "keyboard",  "key": "0x1D", "mods": "0x01" },
        { "irCode": "0x...",      "type": "mode_switch" },
        { "irCode": "0x...",      "type": "text",  "value": "hello world" },
        { "irCode": "0x...",      "type": "combo", "steps": [
          { "type": "keyboard", "key": "0x04", "mods": "0x01" },
          { "type": "keyboard", "key": "0x4C" }
        ]}
      ]
    }
  ],
  "layouts": [
    {
      "name": "Default Layout",
      "buttons": [
        { "irCode": "0x...", "x": 0, "y": 0 },
        { "irCode": "0x...", "x": 1, "y": 0 }
      ]
    }
  ]
}
```

### Slot types

| `type` | Required fields | Notes |
|--------|----------------|-------|
| `keyboard` | `key` (USB HID usage ID) | Optional `mods` byte (Ctrl=0x01, Shift=0x02, Alt=0x04, Win=0x08) |
| `consumer` | `key` (USB HID consumer usage ID) | Volume, media, etc. |
| `mode_switch` | — | Cycles to the next layer |
| `text` | `value` (string) | Sends each character as individual keystrokes |
| `combo` | `steps` (array) | Each step is a `keyboard`/`consumer`/`text` entry |

### Firmware limits

| Limit | Value |
|-------|-------|
| Max layers | 5 |
| Max buttons per layer | 20 |
| Max steps per combo | 8 |
| Max text length per step | 48 characters |


## Troubleshooting

**No IR codes received** — check receiver wiring (VCC/GND/OUT) and ensure the module is running at 3.3 V, not 5 V.


**Settings not persisting** — ensure the data partition was flashed (`pio run -t uploadfs`). The firmware falls back to defaults if `settings.json` is absent.

**HID not recognised** — verify the correct PlatformIO environment is selected for your board. RP2040 boards require TinyUSB; check `platformio.ini`.


## Acknowledgements (Praise the open source)

- **[IRremote](https://github.com/Arduino-IRremote/Arduino-IRremote)** — IR receive/decode library by the Arduino-IRremote team
- **[ArduinoJson](https://arduinojson.org/)** — JSON serialisation library by Benoît Blanchon
- **[Adafruit NeoPixel](https://github.com/adafruit/Adafruit_NeoPixel)** — WS2812 driver library by Adafruit
- **[arduino-pico](https://github.com/earlephilhower/arduino-pico)** — RP2040 Arduino core (TinyUSB, LittleFS) by Earle F. Philhower III
- **[platform-raspberrypi](https://github.com/maxgerhardt/platform-raspberrypi)** — PlatformIO platform for RP2040 by Maxim Gerhardt
- **[Adafruit pIRkey](https://www.adafruit.com/product/3364)** — They tried but alas, not everyone wants to learn micropython.
