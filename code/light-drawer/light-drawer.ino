/*
  Light-Up Drawer
  Arduino Uno, HC-SR04 ultrasonic distance sensor, one LED, 9 V battery.

  The sensor sits at the back of the drawer housing and looks at the rear wall
  of the drawer. Drawer closed = rear wall is close. Drawer pulled out = rear
  wall moves away. When the distance grows past a threshold the light turns on.

  Wiring
    HC-SR04  VCC -> 5V    GND -> GND    TRIG -> D9    ECHO -> D10
    LED      D6 -> 220 ohm resistor -> LED anode, LED cathode -> GND
    9 V battery -> Arduino barrel jack (VIN)
*/

// ---- Pin map -------------------------------------------------------------
const uint8_t TRIG_PIN = 9;
const uint8_t ECHO_PIN = 10;
const uint8_t LED_PIN  = 6;      // PWM pin so the light can fade

// ---- Tuning --------------------------------------------------------------
const float OPEN_CM   = 8.0;     // Farther than this = drawer is open
const float CLOSED_CM = 5.0;     // Closer than this  = drawer is closed
const unsigned long SAMPLE_MS   = 60;        // Time between sensor pings
const unsigned long ECHO_WAIT_US = 12000;    // Give up on an echo after 12 ms (about 2 m)
const unsigned long AUTO_OFF_MS = 120000;    // Light off after 2 min if drawer is left open
const uint8_t FADE_STEP = 15;                // Brightness change per sample

// ---- State ---------------------------------------------------------------
bool drawerOpen = false;
unsigned long openedAt = 0;
unsigned long lastSample = 0;
uint8_t brightness = 0;
float history[3] = {0, 0, 0};    // Last three readings, for the median filter
uint8_t historyIndex = 0;

// Fire one ultrasonic ping and return the distance in centimetres.
// Returns -1 if no echo came back in time.
float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, ECHO_WAIT_US);
  if (echoUs == 0) return -1;

  // Sound travels about 0.0343 cm per microsecond. The ping goes out and
  // comes back, so the one-way distance is half the round trip.
  return echoUs * 0.0343 / 2.0;
}

// Middle value of three numbers. One bad reading cannot move the result.
float median3(float a, float b, float c) {
  if ((a >= b && a <= c) || (a <= b && a >= c)) return a;
  if ((b >= a && b <= c) || (b <= a && b >= c)) return b;
  return c;
}

void setup() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  analogWrite(LED_PIN, 0);
}

void loop() {
  unsigned long nowMs = millis();
  if (nowMs - lastSample < SAMPLE_MS) return;
  lastSample = nowMs;

  // 1. Measure, and ignore pings that got no echo.
  float cm = readDistanceCm();
  if (cm > 0) {
    history[historyIndex] = cm;
    historyIndex = (historyIndex + 1) % 3;
  }
  float distance = median3(history[0], history[1], history[2]);

  // 2. Decide open or closed. Two thresholds with a gap between them
  //    (hysteresis) stop the light from flickering when the drawer sits
  //    right at the edge.
  if (!drawerOpen && distance > OPEN_CM) {
    drawerOpen = true;
    openedAt = nowMs;
  } else if (drawerOpen && distance > 0 && distance < CLOSED_CM) {
    drawerOpen = false;
  }

  // 3. Light on while open, unless it has been open for too long.
  bool wantLight = drawerOpen && (nowMs - openedAt < AUTO_OFF_MS);

  // 4. Fade toward the wanted state instead of snapping.
  if (wantLight && brightness < 255) {
    brightness = (brightness > 255 - FADE_STEP) ? 255 : brightness + FADE_STEP;
  } else if (!wantLight && brightness > 0) {
    brightness = (brightness < FADE_STEP) ? 0 : brightness - FADE_STEP;
  }
  analogWrite(LED_PIN, brightness);
}
