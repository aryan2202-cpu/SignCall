import { createHash } from "node:crypto";

const MODEL_PREFERENCES = [
  "gemini-3.5-flash-lite",
  "gemini-2.0-flash-lite",
  "gemini-3.8-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.0-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const availableModelsCache = new Map();
const availableModelsRequests = new Map();

async function listAvailableModels(apiKey, fetchImpl) {
  const cacheKey = createHash("sha256").update(apiKey).digest("hex");
  const cached = availableModelsCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.models;
  }
  const pendingRequest = availableModelsRequests.get(cacheKey);
  if (pendingRequest) return pendingRequest;

  const request = fetchAvailableModels(apiKey, fetchImpl);
  availableModelsRequests.set(cacheKey, request);
  try {
    const models = await request;
    availableModelsCache.set(cacheKey, {
      models,
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    });
    return models;
  } finally {
    availableModelsRequests.delete(cacheKey);
  }
}

async function fetchAvailableModels(apiKey, fetchImpl) {
  const response = await fetchImpl(
    "https://generativelanguage.googleapis.com/v1beta/models",
    {
      headers: { "x-goog-api-key": apiKey },
    }
  );
  const responseBody = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      typeof payload?.error?.message === "string"
        ? payload.error.message.slice(0, 500)
        : "";
    throw new Error(
      `Could not list Gemini models (HTTP ${response.status})${detail ? `: ${detail}` : "."}`
    );
  }

  const models = Array.isArray(payload?.models)
    ? payload.models
        .filter(
          (entry) =>
            typeof entry.name === "string" &&
            entry.name.startsWith("models/gemini-") &&
            !/(?:tts|transcrib|live)/i.test(entry.name) &&
            Array.isArray(entry.supportedGenerationMethods) &&
            entry.supportedGenerationMethods.includes("generateContent")
        )
        .map((entry) => entry.name.slice("models/".length))
    : [];

  if (models.length === 0) {
    throw new Error("Gemini returned no models that support generateContent for this API key.");
  }

  return models;
}

function chooseModel(models, preferredModel) {
  if (preferredModel && models.includes(preferredModel)) return preferredModel;

  for (const preference of MODEL_PREFERENCES) {
    if (models.includes(preference)) return preference;
  }

  return (
    models.find((name) => /flash/i.test(name)) ||
    models[0]
  );
}

function orderModels(models, preferredModel) {
  const first = chooseModel(models, preferredModel);
  const remaining = models.filter((name) => name !== first);
  remaining.sort((left, right) => {
    const leftRank = MODEL_PREFERENCES.indexOf(left);
    const rightRank = MODEL_PREFERENCES.indexOf(right);
    return (leftRank === -1 ? Infinity : leftRank) - (rightRank === -1 ? Infinity : rightRank);
  });
  return [first, ...remaining];
}

function isUnavailableModelError(status, message) {
  return (
    status === 404 &&
    /model.{0,100}(?:not found|no longer available|not supported)|(?:not found|no longer available).{0,100}model/i.test(
      message
    )
  );
}

function removeUnavailableModel(apiKey, model) {
  const cacheKey = createHash("sha256").update(apiKey).digest("hex");
  const cached = availableModelsCache.get(cacheKey);
  if (cached) {
    cached.models = cached.models.filter((entry) => entry !== model);
  }
}

export async function interpretGestures({
  frames,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const parts = [
    {
      text: [
        "Interpret this time-ordered sequence of camera images showing the signer, hands, and any visible facial expression.",
        "Recognize the complete signed message from the visual sequence; do not restrict interpretation to a preset gesture, pose, or vocabulary list.",
        "Use motion between frames, hand shape, orientation, position, facial expression, and context. Do not assume a particular sign language or silently substitute spoken-language gestures for signs.",
        "Recognize culturally meaningful greetings when visible. In particular, palms pressed together in front of the chest or face is commonly the Indian greeting Namaste; do not label that pose Hello or a waving gesture unless the frames show a wave.",
        "Return the clearest concise English transcript you can infer and a relevant, respectful conversational reply.",
        "Keep the reply to one short sentence so it can be returned quickly.",
        "Do not invent words when the meaning is unclear. State that it is unclear in the transcript and ask for repetition or clarification in the reply.",
        "This is an experimental vision model, not certified sign-language translation. Never claim certainty you do not have.",
        'Return only JSON matching {"transcript":"...","reply":"..."}',
      ].join(" "),
    },
  ];

  for (const [index, frame] of frames.entries()) {
    parts.push({
      text: `Frame ${index + 1}${Number.isFinite(frame.capturedAtMs) ? ` at ${frame.capturedAtMs} ms` : ""}.`,
    });
    parts.push({
      inline_data: {
        mime_type: frame.mimeType,
        data: frame.data,
      },
    });
  }

  const models = await listAvailableModels(apiKey, fetchImpl);
  const candidateModels = orderModels(models, model);
  let response;
  let payload;
  let selectedModel;

  for (const candidateModel of candidateModels) {
    const endpoint = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent`
    );
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 160,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              transcript: { type: "STRING" },
              reply: { type: "STRING" },
            },
            required: ["transcript", "reply"],
          },
        },
      }),
    });
    const responseBody = await response.text();
    try {
      payload = JSON.parse(responseBody);
    } catch {
      payload = null;
    }

    if (response.ok) {
      selectedModel = candidateModel;
      break;
    }

    const detail =
      typeof payload?.error?.message === "string"
        ? payload.error.message.slice(0, 500)
        : "";
    if (isUnavailableModelError(response.status, detail)) {
      removeUnavailableModel(apiKey, candidateModel);
      continue;
    }
    throw new Error(
      `Gemini model "${candidateModel}" request failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`
    );
  }

  if (!response?.ok || !selectedModel) {
    throw new Error(
      `None of the available Gemini models could process this request. Tried: ${candidateModels.join(", ")}.`
    );
  }

  const responseText = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();

  if (!responseText) {
    throw new Error("Gemini returned no gesture interpretation.");
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("Gemini returned an invalid transcript response.");
  }

  if (
    typeof result.transcript !== "string" ||
    !result.transcript.trim() ||
    typeof result.reply !== "string" ||
    !result.reply.trim()
  ) {
    throw new Error("Gemini returned an incomplete transcript response.");
  }

  return {
    transcript: result.transcript.trim(),
    reply: result.reply.trim(),
    model: selectedModel,
  };
}

export function validateGestureFrames(frames) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 8) {
    return "Send between 1 and 8 gesture frames.";
  }

  for (const frame of frames) {
    if (
      !frame ||
      frame.mimeType !== "image/jpeg" ||
      typeof frame.data !== "string" ||
      frame.data.length < 1 ||
      frame.data.length > 400_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)
    ) {
      return "A gesture frame is invalid or too large.";
    }

    if (
      frame.capturedAtMs !== undefined &&
      (!Number.isFinite(frame.capturedAtMs) || frame.capturedAtMs < 0)
    ) {
      return "A gesture frame contains an invalid timestamp.";
    }
  }

  return null;
}
