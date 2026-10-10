export const MAX_GESTURE_FRAMES = 8;

export function addGestureFrame(frames, seenCount, frame, random = Math.random) {
  const nextSeenCount = seenCount + 1;
  const nextFrames = [...frames];

  if (nextFrames.length < MAX_GESTURE_FRAMES) {
    nextFrames.push(frame);
  } else {
    const replacementIndex = Math.floor(random() * nextSeenCount);
    if (replacementIndex < MAX_GESTURE_FRAMES) {
      nextFrames[replacementIndex] = frame;
    }
  }

  return {
    frames: nextFrames,
    seenCount: nextSeenCount,
  };
}

export function orderGestureFrames(frames) {
  return [...frames].sort((first, second) => first.capturedAtMs - second.capturedAtMs);
}
