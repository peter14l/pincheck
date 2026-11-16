# PinCheck — Pre-Flight Hardware Linter

**Catch circuit wiring mistakes before you build — like a spell-checker for your hardware projects.**

---

## What PinCheck Does

PinCheck helps you design working circuits without the guesswork. Type what you want to build ("connect an OLED display and ultrasonic sensor to my ESP32"), and PinCheck gives you a verified wiring diagram, safety checks, and ready-to-run code. Think of it as a friendly co-pilot that catches mistakes before you solder a single wire.

---

## Key Features

| Feature | What It Means for You |
|---------|----------------------|
| **Prompt-to-Circuit** | Describe your project in plain English, get a complete wiring diagram instantly |
| **Interactive Schematic** | Drag and drop components on a visual canvas — no schematic reading skills needed |
| **Fault Injection** | Simulate what happens when a wire comes loose or a sensor fails — safely, on screen |
| **Auto-Generated Firmware** | Copy-paste C++ (Arduino) or MicroPython code that works with your exact wiring |
| **Share & Save** | Save your circuits, share links with teammates, pick up where you left off |
| **Safety Checks** | Automatic warnings for voltage mismatches, pin collisions, and current budget overflows |

---

## Supported Hardware

**Boards:**
- ESP32 (all popular variants)
- Arduino Uno
- Raspberry Pi Pico

**Components (growing library):**
- OLED displays (SSD1306, SH1106)
- Ultrasonic distance sensors (HC-SR04)
- Servo motors (standard & continuous rotation)
- LEDs, buttons, potentiometers
- Temperature & humidity sensors (DHT11/22)
- And more added regularly!

---

## How to Use It (3 Simple Steps)

1. **Describe** — Type what you're building: *"ESP32 with OLED and ultrasonic sensor"*
2. **Review** — PinCheck shows the wiring diagram, highlights any issues, and suggests fixes
3. **Build** — Copy the generated code, wire it up, and upload — done!

---

## Who It's For

- **Students** learning electronics — get unstuck faster, learn by doing
- **Educators** — create verified lab circuits in minutes, not hours
- **Hobbyists & makers** — prototype confidently, avoid fried components
- **Hackathon teams** — go from idea to working hardware in record time

---

## Tech Stack (Brief & Non-Technical)

PinCheck runs entirely in your browser as a web app. Your circuits are saved locally in a lightweight database on your machine — no cloud accounts, no internet required after the first load. Built with modern web technologies for a smooth, responsive experience.

---

## Embarko Student Challenge 2026

PinCheck was built for the **Embarko Student Challenge 2026** — a showcase of student innovation in embedded systems and developer tools. We're proud to represent the next generation of hardware hackers making electronics more accessible for everyone.

---

## Getting Started

```bash
# 1. Clone the project
git clone <your-repo-url>
cd pincheck

# 2. Install dependencies (one-time)
npm install

# 3. Start the app
npm run dev
```

Then open **http://localhost:3000** in your browser. That's it — start describing circuits!

---

## Contributing

Found a bug? Want a new component supported? Open an issue or pull request — we welcome ideas from students, educators, and makers alike.

---

## License

MIT — free to use, modify, and share.

---

*Built with ❤️ for the Embarko Student Challenge 2026*
