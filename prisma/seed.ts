import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const circuits = [
    {
      title: 'ESP32 Weather Station with OLED & BME280',
      description: 'Healthy ESP32 DevKit V1 weather station with SSD1306 OLED and BME280 sensor wired on safe pins (I2C on GPIO21/22).',
      boardId: 'esp32-devkit-v1',
      healthScore: 100,
      stateJson: JSON.stringify({
        board: { id: 'esp32-devkit-v1', name: 'ESP32 DevKit V1' },
        components: [
          { id: 'u1', type: 'board', ref: 'ESP32 DevKit V1' },
          { id: 'u2', type: 'display', ref: 'SSD1306 OLED', interface: 'I2C', address: '0x3C' },
          { id: 'u3', type: 'sensor', ref: 'BME280', interface: 'I2C', address: '0x76' }
        ],
        connections: [
          { from: 'u1.3V3', to: 'u2.VCC', net: '3V3' },
          { from: 'u1.GND', to: 'u2.GND', net: 'GND' },
          { from: 'u1.GPIO21', to: 'u2.SDA', net: 'I2C_SDA' },
          { from: 'u1.GPIO22', to: 'u2.SCL', net: 'I2C_SCL' },
          { from: 'u1.3V3', to: 'u3.VCC', net: '3V3' },
          { from: 'u1.GND', to: 'u3.GND', net: 'GND' },
          { from: 'u1.GPIO21', to: 'u3.SDA', net: 'I2C_SDA' },
          { from: 'u1.GPIO22', to: 'u3.SCL', net: 'I2C_SCL' }
        ],
        diagnostics: []
      })
    },
    {
      title: 'Arduino Obstacle Robot with HC-SR04 & Servo',
      description: 'Arduino Uno R3 robot with HC-SR04 ultrasonic sensor and SG90 servo for obstacle avoidance.',
      boardId: 'arduino-uno-r3',
      healthScore: 98,
      stateJson: JSON.stringify({
        board: { id: 'arduino-uno-r3', name: 'Arduino Uno R3' },
        components: [
          { id: 'u1', type: 'board', ref: 'Arduino Uno R3' },
          { id: 'u2', type: 'sensor', ref: 'HC-SR04', interface: 'digital' },
          { id: 'u3', type: 'actuator', ref: 'SG90 Servo', interface: 'PWM' }
        ],
        connections: [
          { from: 'u1.5V', to: 'u2.VCC', net: '5V' },
          { from: 'u1.GND', to: 'u2.GND', net: 'GND' },
          { from: 'u1.D9', to: 'u2.TRIG', net: 'TRIG' },
          { from: 'u1.D10', to: 'u2.ECHO', net: 'ECHO' },
          { from: 'u1.5V', to: 'u3.VCC', net: '5V' },
          { from: 'u1.GND', to: 'u3.GND', net: 'GND' },
          { from: 'u1.D6', to: 'u3.SIGNAL', net: 'SERVO_PWM' }
        ],
        diagnostics: []
      })
    },
    {
      title: 'Deliberate Buggy Circuit Demo: ESP32 Strapping Trap',
      description: 'ESP32 circuit with GPIO12 pulled HIGH causing flash voltage selection boot failure (strapping pin trap).',
      boardId: 'esp32-devkit-v1',
      healthScore: 25,
      stateJson: JSON.stringify({
        board: { id: 'esp32-devkit-v1', name: 'ESP32 DevKit V1' },
        components: [
          { id: 'u1', type: 'board', ref: 'ESP32 DevKit V1' },
          { id: 'u2', type: 'sensor', ref: 'Generic Digital Sensor' }
        ],
        connections: [
          { from: 'u1.3V3', to: 'u2.VCC', net: '3V3' },
          { from: 'u1.GND', to: 'u2.GND', net: 'GND' },
          { from: 'u1.GPIO12', to: 'u2.OUT', net: 'SENSOR_OUT' },
          { from: 'u1.GPIO12', to: 'u1.3V3', net: 'PULLUP_HIGH', note: 'External pull-up holds GPIO12 HIGH at boot' }
        ],
        diagnostics: [
          {
            severity: 'CRITICAL',
            code: 'ESP32_STRAPPING_GPIO12_HIGH',
            message: 'GPIO12 is a strapping pin; pulling it HIGH at boot selects 1.8V flash voltage and can prevent boot on 3.3V flash modules.',
            pins: ['GPIO12'],
            recommendation: 'Move signal off GPIO12 or ensure it is LOW at boot; use GPIO13/14/27 etc. for general IO.'
          }
        ]
      })
    }
  ]

  await prisma.circuit.deleteMany()
  await prisma.circuit.createMany({ data: circuits })
  console.log('Seeded circuits:', circuits.length)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
