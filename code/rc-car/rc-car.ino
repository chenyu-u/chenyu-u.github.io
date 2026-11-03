/*
  Custom RC Car
  Arduino Uno + sensor shield, one L298N dual motor controller, four 3-6 V gear
  motors, Bluetooth serial module, driven from the Dabble phone app (Gamepad module).

  Drive layout: tank drive. The two left motors are wired in parallel on channel A
  and the two right motors are wired in parallel on channel B, so each side always
  turns together. The car turns by running the sides at different speeds, the same
  way a tank does.

  Wiring
    Bluetooth TX  -> D2   (Arduino receives here)
    Bluetooth RX  -> D3   (Arduino transmits here)
    L298N channel A (left):   ENA -> D5 (PWM)   IN1 -> D4   IN2 -> D7
    L298N channel B (right):  ENB -> D6 (PWM)   IN3 -> D8   IN4 -> D12
    All grounds tied together.
*/

#define CUSTOM_SETTINGS
#define INCLUDE_GAMEPAD_MODULE
#include <Dabble.h>

// ---- Pin map -------------------------------------------------------------
const uint8_t BT_RX_PIN = 2;
const uint8_t BT_TX_PIN = 3;

const uint8_t LEFT_EN   = 5;    // ENA: PWM speed, left pair
const uint8_t LEFT_FWD  = 4;
const uint8_t LEFT_REV  = 7;

const uint8_t RIGHT_EN  = 6;    // ENB: PWM speed, right pair
const uint8_t RIGHT_FWD = 8;
const uint8_t RIGHT_REV = 12;

// ---- Tuning --------------------------------------------------------------
const int SPEED_CRUISE = 170;   // 0 to 255. Default driving speed. About 4.7 V at the motors.
const int SPEED_BOOST  = 215;   // Held while the Triangle button is down. About 6 V at the motors.
const int SPEED_TURN   = 150;   // Spin-in-place speed. Lower is easier to control.
const int RAMP_STEP    = 12;    // Largest change in PWM per control cycle.
const unsigned long CYCLE_MS = 20;   // Control loop period (50 Hz).

// ---- State ---------------------------------------------------------------
int leftTarget = 0,  rightTarget = 0;    // What the driver is asking for, -255 to 255
int leftNow    = 0,  rightNow    = 0;    // What the motors are actually getting
unsigned long lastCycle = 0;

// Send one signed speed to one side of the car.
// Positive = forward, negative = reverse, zero = coast to a stop.
void driveSide(uint8_t enPin, uint8_t fwdPin, uint8_t revPin, int speed) {
  digitalWrite(fwdPin, speed > 0 ? HIGH : LOW);
  digitalWrite(revPin, speed < 0 ? HIGH : LOW);
  analogWrite(enPin, abs(speed));
}

// Move "now" toward "target" by at most RAMP_STEP so the motors never see a
// sudden jump from full forward to full reverse.
int ramp(int now, int target) {
  if (target > now) return min(now + RAMP_STEP, target);
  if (target < now) return max(now - RAMP_STEP, target);
  return now;
}

void setup() {
  pinMode(LEFT_EN, OUTPUT);   pinMode(LEFT_FWD, OUTPUT);   pinMode(LEFT_REV, OUTPUT);
  pinMode(RIGHT_EN, OUTPUT);  pinMode(RIGHT_FWD, OUTPUT);  pinMode(RIGHT_REV, OUTPUT);
  driveSide(LEFT_EN,  LEFT_FWD,  LEFT_REV,  0);
  driveSide(RIGHT_EN, RIGHT_FWD, RIGHT_REV, 0);

  Dabble.begin(9600, BT_RX_PIN, BT_TX_PIN);   // Match the Bluetooth module's baud rate.
}

void loop() {
  Dabble.processInput();    // Read whatever the phone has sent since last time.

  // 1. Turn button state into a target speed for each side.
  int speed = GamePad.isTrianglePressed() ? SPEED_BOOST : SPEED_CRUISE;

  if (!Dabble.isAppConnected()) {          // Phone out of range or app closed: stop.
    leftTarget = 0;             rightTarget = 0;
  } else if (GamePad.isUpPressed()) {
    leftTarget = speed;         rightTarget = speed;
  } else if (GamePad.isDownPressed()) {
    leftTarget = -speed;        rightTarget = -speed;
  } else if (GamePad.isLeftPressed()) {    // Left side backward, right side forward.
    leftTarget = -SPEED_TURN;   rightTarget = SPEED_TURN;
  } else if (GamePad.isRightPressed()) {
    leftTarget = SPEED_TURN;    rightTarget = -SPEED_TURN;
  } else {                                 // Nothing held: stop.
    leftTarget = 0;             rightTarget = 0;
  }

  // 2. Every 20 ms, step the real motor output toward the target.
  unsigned long nowMs = millis();
  if (nowMs - lastCycle >= CYCLE_MS) {
    lastCycle = nowMs;
    leftNow  = ramp(leftNow,  leftTarget);
    rightNow = ramp(rightNow, rightTarget);
    driveSide(LEFT_EN,  LEFT_FWD,  LEFT_REV,  leftNow);
    driveSide(RIGHT_EN, RIGHT_FWD, RIGHT_REV, rightNow);
  }
}
