#include <HX711.h>
const int dataPin=3;
const int clockPin=2;
long value=0;
HX711 scale;
void setup() {
  Serial.begin(9600);
  scale.begin(dataPin, clockPin);
}
void loop() {
  value=scale.read();
  Serial.println(value);
  delay(100);
}