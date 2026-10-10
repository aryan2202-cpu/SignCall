import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addGestureFrame,
  MAX_GESTURE_FRAMES,
  orderGestureFrames,
} from "./gestureFrames.js";

test("retains a bounded representative sample across a long gesture sequence", () => {
  let frames = [];
  let seenCount = 0;

  for (let index = 0; index < 100; index += 1) {
    const next = addGestureFrame(
      frames,
      seenCount,
      { capturedAtMs: index * 400 },
      () => 0
    );
    frames = next.frames;
    seenCount = next.seenCount;
  }

  assert.equal(seenCount, 100);
  assert.equal(frames.length, MAX_GESTURE_FRAMES);
  assert.deepEqual(
    orderGestureFrames(frames).map((frame) => frame.capturedAtMs),
    [
      ...Array.from({ length: MAX_GESTURE_FRAMES - 1 }, (_, index) => (index + 1) * 400),
      99 * 400,
    ]
  );
});

test("orders sampled frames chronologically before interpretation", () => {
  const frames = [
    { capturedAtMs: 800 },
    { capturedAtMs: 0 },
    { capturedAtMs: 400 },
  ];

  assert.deepEqual(
    orderGestureFrames(frames).map((frame) => frame.capturedAtMs),
    [0, 400, 800]
  );
  assert.deepEqual(frames.map((frame) => frame.capturedAtMs), [800, 0, 400]);
});
