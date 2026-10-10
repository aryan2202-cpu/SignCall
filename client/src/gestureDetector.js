/**
 * SignCall Real-Time Gesture Recognition & Landmark Drawing
 * Geometric classifier for the app's supported hand-pose vocabulary.
 * These pose labels are a limited demo vocabulary, not full sign-language translation.
 *
 * Vocabulary: Hello, Yes, No, OK, Peace, I Love You, You, Wait,
 *             Stop, Cool, Phone, Please
 */

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],          // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],          // Index finger
  [5, 9], [9, 10], [10, 11], [11, 12],     // Middle finger
  [9, 13], [13, 14], [14, 15], [15, 16],   // Ring finger
  [13, 17], [17, 18], [18, 19], [19, 20],  // Pinky finger
  [0, 17],                                 // Palm base
];

function dist2D(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Draw hand skeleton connections and joint nodes on canvas
 */
export function drawHandLandmarks(ctx, landmarks, width, height) {
  if (!ctx || !landmarks || landmarks.length < 21) return;

  ctx.save();

  // Draw bone connections
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(6, 182, 212, 0.95)"; // Vibrant Cyan
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [start, end] of HAND_CONNECTIONS) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];
    if (p1 && p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }
  }

  // Draw landmark joint points
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i];
    if (!lm) continue;
    ctx.beginPath();
    const isTip = [4, 8, 12, 16, 20].includes(i);
    const radius = isTip ? 6 : 4;
    ctx.arc(lm.x * width, lm.y * height, radius, 0, 2 * Math.PI);
    ctx.fillStyle = isTip ? "#a855f7" : "#06b6d4"; // Violet fingertips, Cyan joints
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Classify the supported pose vocabulary using relative landmark distances.
 */
export function classifyGesture(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;

  // Compare fingertip reach from each finger's base so tilted hands still work.
  const isFingerExtended = (tip, pip, mcp) =>
    dist2D(landmarks[tip], landmarks[mcp]) >
    dist2D(landmarks[pip], landmarks[mcp]) * 1.12;
  const indexOpen = isFingerExtended(8, 6, 5);
  const middleOpen = isFingerExtended(12, 10, 9);
  const ringOpen = isFingerExtended(16, 14, 13);
  const pinkyOpen = isFingerExtended(20, 18, 17);

  const thumbOpen =
    dist2D(landmarks[4], landmarks[5]) >
    dist2D(landmarks[3], landmarks[5]) * 1.15;

  // Scale the pinch threshold to the user's hand size in the camera frame.
  const palmWidth = dist2D(landmarks[5], landmarks[17]);
  const isOkPinch =
    palmWidth > 0 &&
    dist2D(landmarks[4], landmarks[8]) < palmWidth * 0.3;

  // Count of open main fingers (excluding thumb)
  const openCount  = [indexOpen, middleOpen, ringOpen, pinkyOpen].filter(Boolean).length;

  // ─── 1. OK Sign ───────────────────────────────────────────────────
  // Thumb–index pinch + at least middle & pinky extended
  if (isOkPinch && middleOpen && pinkyOpen) {
    return { name: "OK", label: "👌 OK" };
  }

  // ─── 2. Hello (Open Palm) ─────────────────────────────────────────
  // All 5 digits open, no pinch
  if (openCount === 4 && thumbOpen && !isOkPinch) {
    return { name: "Hello", label: "👋 Hello" };
  }

  // ─── 3. Stop ──────────────────────────────────────────────────────
  // 4 fingers open, thumb tucked (palm out)
  if (openCount === 4 && !thumbOpen) {
    return { name: "Stop", label: "✋ Stop" };
  }

  // ─── 4. Peace / V-Sign ────────────────────────────────────────────
  // Index + Middle open; Ring + Pinky closed
  if (indexOpen && middleOpen && !ringOpen && !pinkyOpen) {
    return { name: "Peace", label: "✌️ Peace" };
  }

  // ─── 5. I Love You (ASL) ──────────────────────────────────────────
  // Index + Pinky + Thumb open; Middle + Ring closed
  if (indexOpen && pinkyOpen && !middleOpen && !ringOpen && thumbOpen) {
    return { name: "I Love You", label: "🤟 I Love You" };
  }

  // ─── 6. Cool / Rock ──────────────────────────────────────────────
  // Index + Pinky open; Thumb + Middle + Ring closed
  if (indexOpen && pinkyOpen && !middleOpen && !ringOpen && !thumbOpen) {
    return { name: "Cool", label: "🤘 Cool" };
  }

  // ─── 7. Phone / Call ──────────────────────────────────────────────
  // Thumb + Pinky open; Index + Middle + Ring closed
  if (!indexOpen && !middleOpen && !ringOpen && pinkyOpen && thumbOpen) {
    return { name: "Phone", label: "🤙 Phone" };
  }

  // ─── 8. Please ────────────────────────────────────────────────────
  // Index + Thumb open; Middle + Ring + Pinky closed  (L-shape)
  if (indexOpen && !middleOpen && !ringOpen && !pinkyOpen && thumbOpen) {
    return { name: "Please", label: "🙏 Please" };
  }

  // ─── 9. You / Point ──────────────────────────────────────────────
  // Index only; Thumb closed
  if (indexOpen && !middleOpen && !ringOpen && !pinkyOpen && !thumbOpen) {
    return { name: "You", label: "👉 You" };
  }

  // ─── 10. Thumbs Up (Yes) ──────────────────────────────────────────
  // All 4 fingers closed, thumb pointing up (tip well above its IP)
  if (openCount === 0 && landmarks[4].y < landmarks[2].y - 0.04) {
    return { name: "Yes", label: "👍 Yes" };
  }

  // ─── 11. Thumbs Down (No) ─────────────────────────────────────────
  // All 4 fingers closed, thumb pointing down (tip below wrist)
  if (openCount === 0 && landmarks[4].y > landmarks[0].y + 0.02) {
    return { name: "No", label: "👎 No" };
  }

  // ─── 12. Fist / Wait ──────────────────────────────────────────────
  // All 5 digits closed
  if (openCount === 0 && !thumbOpen) {
    return { name: "Wait", label: "✊ Wait" };
  }

  return null;
}
