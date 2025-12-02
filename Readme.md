You know that feeling when you think, huh I think I..

# Tossed the TV but Kept the Remote
  <img src="https://img.shields.io/badge/-Arduino-00979D?style=for-the-badge&logo=Arduino&logoColor=white&logoSize=auto" alt="Arduino"/>
  <img src="https://img.shields.io/badge/-Raspberry_Pi-C51A4A?style=for-the-badge&logo=Raspberry-Pi" alt="Raspberry Pi"/>
  <img src="https://img.shields.io/badge/c++-%2300599C.svg?style=for-the-badge&logo=c%2B%2B&logoColor=white&logoSize=auto" alt="C++"/>

### Yeah that's what this is for.
Turn an RP2040 (or other USB-capable MCU) into a USB HID device that receives IR remote codes and maps them to USB HID commands. Reuse old TV remotes as media remotes for media centers, HTPCs, and mind control(?).

**Key Features**
- **IR to HID mapping**: Receive IR codes from a standard IR receiver and map them to Consumer/Keyboard HID usages (play/pause, volume, next track, etc.).
- **PlatformIO-based firmware**: Build and flash using PlatformIO (`firmware/` contains `platformio.ini` and source).
- **Configurable mappings**: Mapping file located at `firmware/data/settings.json` (JSON format).
- **RP2040-first**: Tested on RP2040 boards (Pico, Pico W, etc.), but design supports any USB-capable MCU supported by PlatformIO.

**Repository Layout**
- `firmware/`: PlatformIO project with firmware source.
	- `platformio.ini`: Build configuration and environments.
	- `src/`: Firmware source (`main.cpp`, `main.h`, ...).
	- `data/`: Optional data partition for runtime-configurable files (e.g. `settings.json`).
- `Readme.md`: This file.

**Hardware**
- MCU: RP2040 (recommended) or any USB-capable MCU supported by PlatformIO.
- IR receiver: standard 38 kHz receiver module (e.g., TSOP382xx series).
- Wiring (typical):
	- **IR module VCC**: `3.3V` (do NOT use 5V with RP2040)
	- **IR module GND**: `GND`
	- **IR module OUT**: connect to a free GPIO pin (for example `1`, specify the pin in settings.json).

Note: Exact GPIO used by the firmware may be configurable. Check `firmware/src/main.cpp` or `firmware/data/settings.json` for the configured pin.


![RP2040](https://www.waveshare.com/img/devkit/RP2040-Zero/RP2040-Zero-details-7.jpg)

**Build & Flash (PlatformIO)**

From the `firmware/` folder you can build and upload with PlatformIO. Example PowerShell commands:

```powershell
cd firmware
run --target buildunified --environment pico          # build
pio run -t upload  # build and upload (selected environment in platformio.ini)
pio device monitor --baud 115200  # open serial monitor
```

If your board uses UF2 flashing (typical for many RP2040 workflows) and PlatformIO doesn't upload automatically, you can build and copy the generated `firmware_with_fs.uf2` file to the board's mass-storage drive.

**Configuration: `settings.json`**

The firmware loads mapping rules from `firmware/data/settings.json` when present. The format is a simple JSON object that maps IR codes (strings) to HID action names. Example:

```json
{
	"0x00FFA25D": "a",
	"0x00FF629D": " ",
	"0x00FFA857": "0xCD",
}
```

- **IR code keys**: The IR codes depend on your remote and decoder (often printed as hex). Capture them with the serial monitor (see below).


**Capturing IR codes**
- Open the serial monitor:

```powershell
cd firmware
pio device monitor --baud 115200
```

- Power the board and press a button on your remote while watching the monitor — the firmware will print the received IR code (hex). Use that hex string as the key in `settings.json`.


**Troubleshooting**
- No IR codes printed: check wiring (VCC/GND/OUT), ensure receiver is oriented correctly and running at 3.3V.
- Incorrect codes / noise: try different IR libraries or adjust receiver placement.
- HID not recognized by host: ensure the MCU firmware enumerates as a USB HID device; verify platformio environment matches your board.

**Extending & Customizing**
- Add or change mappings in `firmware/data/settings.json` and reboot the board (or re-flash if your build doesn't include a data partition).
- Add support for new HID actions by updating the firmware HID mapping table (`src` code).
- Refer to [The Arduino Keboard Library Source](https://github.com/arduino-libraries/Keyboard/blob/master/src/Keyboard.h) as a reference for raw HID code (used when the key you're trying to press is a non-printing character e.g. Arrow Keys)
