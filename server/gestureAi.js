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
const GEMINI_REQUEST_TIMEOUT_MS = 25_000;
const MAX_HELP_USER_MESSAGE_LENGTH = 1000;
const MAX_HELP_ASSISTANT_MESSAGE_LENGTH = 4000;
const HELP_SYSTEM_PROMPT = [
  "You are the SignCall website help assistant.",
  "Help first-time visitors and call participants understand how to use this app.",
  "Features: enter a display name, create a room or join with a room code/invite link, allow camera and microphone access, join a LiveKit video call with up to five participants, use Gemini AI sign/gesture interpretation and visible facial-expression cues, read transcripts and AI replies, read replies aloud, type messages, copy invite links, download transcripts, and adjust accessibility settings such as caption size, voice, and sign detection.",
  "Gesture interpretation samples camera frames and may take time or make mistakes; users can press Finish & reply or retry saved frames after an error. It is experimental and not certified sign-language translation.",
  "Give clear, friendly, concise, step-by-step guidance. Do not claim to see the user's screen, access their camera, change settings for them, or perform actions. Do not invent features or deployment/account status. If a user reports a problem, suggest relevant checks and ask for the exact visible error when needed.",
  "Never ask users to share API keys, passwords, or secrets. For account, billing, or hosting issues, direct them to the appropriate provider dashboard.",
].join(" ");
const availableModelsCache = new Map();
const availableModelsRequests = new Map();

async function fetchGemini(fetchImpl, url, options = {}) {
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
    });
    const body = await response.text();
    return { response, body };
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error("Gemini request timed out after 25 seconds. Please retry.");
    }
    throw error;
  }
}

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
  const { response, body: responseBody } = await fetchGemini(
    fetchImpl,
    "https://generativelanguage.googleapis.com/v1beta/models",
    {
      headers: { "x-goog-api-key": apiKey },
    }
  );
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

export function validateHelpMessages(messages) {
  if (
    !Array.isArray(messages) ||
    messages.length < 1 ||
    messages.length > 8 ||
    messages.some(
      (message) =>
        !message ||
        !["user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        !message.content.trim() ||
        message.content.length >
          (message.role === "user"
            ? MAX_HELP_USER_MESSAGE_LENGTH
            : MAX_HELP_ASSISTANT_MESSAGE_LENGTH)
    ) ||
    messages[messages.length - 1]?.role !== "user"
  ) {
    return "Send up to 8 valid recent help chat messages, ending with your question.";
  }
  return null;
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
        "Interpret these time-ordered images of a person's hands, body, and face. Identify the specific sign or casual/social gesture from hand shape, orientation, location, motion, and context; support an open vocabulary and do not default to Hello. A static open palm is not a wave. If unclear, describe what is visible rather than inventing a translation.",
        "Carefully inspect the face in every frame, not just the hands. Explicitly consider anger: lowered or knitted brows, narrowed eyes, a tense jaw, or pressed lips can indicate an angry-looking expression. Also consider happiness, sadness, surprise, fear, and confusion from visible facial cues.",
        "In the expression field, name the best-supported visible emotion (for example 'Angry-looking: brows lowered and lips pressed') rather than only listing facial features. If the face is too small, obscured, or ambiguous, say 'Not clearly visible' instead of guessing.",
        "Use the apparent emotion as context for a considerate, empathetic reply to the sign, but do not change the sign transcript based only on the face. Describe an apparent expression, not certain knowledge of the person's true feelings or mental state.",
        "Return a very concise transcript, expression, and one short relevant reply. This is experimental, not certified sign-language translation.",
        'Return only JSON matching {"transcript":"...","expression":"...","reply":"..."}',
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
    const generation = await fetchGemini(fetchImpl, endpoint, {
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
              expression: { type: "STRING" },
              reply: { type: "STRING" },
            },
            required: ["transcript", "expression", "reply"],
          },
        },
      }),
    });
    response = generation.response;
    const responseBody = generation.body;
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
    typeof result.expression !== "string" ||
    !result.expression.trim() ||
    typeof result.reply !== "string" ||
    !result.reply.trim()
  ) {
    throw new Error("Gemini returned an incomplete transcript response.");
  }

  return {
    transcript: result.transcript.trim(),
    expression: result.expression.trim(),
    reply: result.reply.trim(),
    model: selectedModel,
  };
}

export async function answerHelpQuestion({
  messages,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const validationError = validateHelpMessages(messages);
  if (validationError) throw new Error(validationError);

  const conversation = messages.slice(-8);
  while (conversation[0]?.role === "assistant") conversation.shift();
  if (conversation.length === 0 || conversation[conversation.length - 1].role !== "user") {
    throw new Error("The help conversation must end with your question.");
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
    const generation = await fetchGemini(fetchImpl, endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: HELP_SYSTEM_PROMPT }],
        },
        contents: conversation.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content.trim() }],
        })),
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 280,
        },
      }),
    });
    response = generation.response;
    try {
      payload = JSON.parse(generation.body);
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
      `Help assistant request failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`
    );
  }

  if (!response?.ok || !selectedModel) {
    throw new Error("No available Gemini model could answer the help request.");
  }

  const answer = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!answer) {
    throw new Error("The help assistant returned an empty answer. Please try again.");
  }

  return { answer, model: selectedModel };
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
