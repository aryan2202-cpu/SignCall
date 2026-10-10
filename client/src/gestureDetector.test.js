import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyGesture } from "./gestureDetector.js";

function makeHand({ index, middle, ring, pinky, thumb }) {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  const fingers = [
    { base: 5, pip: 6, tip: 8, x: 0.4, open: index },
    { base: 9, pip: 10, tip: 12, x: 0.46, open: middle },
    { base: 13, pip: 14, tip: 16, x: 0.52, open: ring },
    { base: 17, pip: 18, tip: 20, x: 0.58, open: pinky },
  ];

  landmarks[0] = { x: 0.49, y: 0.85 };
  for (const finger of fingers) {
    landmarks[finger.base] = { x: finger.x, y: 0.55 };
    landmarks[finger.pip] = { x: finger.x, y: 0.4 };
    landmarks[finger.tip] = {
      x: finger.x,
      y: finger.open ? 0.2 : 0.48,
    };
  }

  landmarks[3] = { x: 0.35, y: 0.58 };
  landmarks[4] = thumb
    ? { x: 0.28, y: 0.5 }
    : { x: 0.42, y: 0.56 };
  return landmarks;
}

function rotateHand(landmarks, radians) {
  const center = landmarks[0];
  return landmarks.map(({ x, y }) => {
    const dx = x - center.x;
    const dy = y - center.y;
    return {
      x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
  });
}

test("classifies a peace pose when the hand is tilted", () => {
  const peace = makeHand({
    index: true,
    middle: true,
    ring: false,
    pinky: false,
    thumb: false,
  });
  const tiltedPeace = rotateHand(peace, Math.PI / 3);

  assert.equal(classifyGesture(peace).name, "Peace");
  assert.equal(classifyGesture(tiltedPeace).name, "Peace");
});

test("classifies an open palm and rejects incomplete landmarks", () => {
  const openPalm = makeHand({
    index: true,
    middle: true,
    ring: true,
    pinky: true,
    thumb: true,
  });

  assert.equal(classifyGesture(openPalm).name, "Hello");
  assert.equal(classifyGesture(openPalm.slice(0, 20)), null);
  assert.equal(classifyGesture(null), null);
});
