import assert from "node:assert/strict";
import { test } from "node:test";
import { interpretGestures, validateGestureFrames } from "./gestureAi.js";

const frames = [
  {
    mimeType: "image/jpeg",
    data: "AQID",
    capturedAtMs: 0,
  },
];

function availableModels(names = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
]) {
  return {
    models: names.map((name) => ({
      name: `models/${name}`,
      supportedGenerationMethods: ["generateContent"],
    })),
  };
}

function successfulGeneration(transcript = "Namaste.", reply = "Namaste!") {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ transcript, reply }) }],
        },
      },
    ],
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("validates a bounded list of JPEG gesture frames", () => {
  assert.equal(validateGestureFrames(frames), null);
  assert.match(validateGestureFrames([]), /between 1 and 12/);
  assert.match(
    validateGestureFrames([{ mimeType: "image/png", data: "AQID" }]),
    /invalid or too large/
  );
  assert.match(
    validateGestureFrames([{ mimeType: "image/jpeg", data: "a".repeat(400_001) }]),
    /invalid or too large/
  );
  assert.match(
    validateGestureFrames(
      Array.from({ length: 13 }, () => ({ mimeType: "image/jpeg", data: "AQID" }))
    ),
    /between 1 and 12/
  );
});

test("discovers an available model and sends the camera frames to it", async () => {
  const requests = [];
  const result = await interpretGestures({
    frames,
    apiKey: "test-discovery-key",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (requests.length === 1) {
        return jsonResponse(availableModels());
      }
      return jsonResponse(successfulGeneration());
    },
  });

  assert.equal(result.transcript, "Namaste.");
  assert.equal(result.reply, "Namaste!");
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/v1beta/models");
  assert.equal(requests[0].options.headers["x-goog-api-key"], "test-discovery-key");
  assert.equal(
    requests[1].url.pathname,
    "/v1beta/models/gemini-3.5-flash-lite:generateContent"
  );
  assert.equal(requests[1].options.headers["x-goog-api-key"], "test-discovery-key");
  const requestBody = JSON.parse(requests[1].options.body);
  assert.equal(requestBody.contents[0].parts[2].inline_data.data, "AQID");
  assert.match(requestBody.contents[0].parts[0].text, /do not restrict interpretation/);
  assert.match(requestBody.contents[0].parts[0].text, /palms pressed together.*Namaste/);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
});

test("prefers a configured model only when the API key has access to it", async () => {
  const requestedModels = [];
  await interpretGestures({
    frames,
    apiKey: "test-configured-key",
    model: "gemini-2.0-flash",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requestedModels.push(parsed.pathname);
      return requestedModels.length === 1
        ? jsonResponse(availableModels())
        : jsonResponse(successfulGeneration());
    },
  });
  assert.equal(
    requestedModels[1],
    "/v1beta/models/gemini-2.0-flash:generateContent"
  );
});

test("falls back from an unavailable configured model to an available vision model", async () => {
  let generationUrl;
  let calls = 0;
  const result = await interpretGestures({
    frames,
    apiKey: "test-fallback-key",
    model: "gemini-3.0-flash",
    fetchImpl: async (url, options) => {
      calls += 1;
      if (calls === 1) return jsonResponse(availableModels());
      generationUrl = new URL(url);
      return jsonResponse(successfulGeneration());
    },
  });

  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(
    generationUrl.pathname,
    "/v1beta/models/gemini-3.5-flash-lite:generateContent"
  );
});

test("retries a request when the configured model is retired despite appearing in ListModels", async () => {
  const generationModels = [];
  const result = await interpretGestures({
    frames,
    apiKey: "test-retired-model-key",
    model: "gemini-2.5-flash-lite",
    fetchImpl: async (url, options) => {
      const parsedUrl = new URL(url);
      if (options.method !== "POST") {
        return jsonResponse(
          availableModels([
            "gemini-2.5-flash-lite",
            "gemini-3.5-flash-lite",
            "gemini-3.8-flash",
          ])
        );
      }

      const modelName = parsedUrl.pathname.match(/models\/([^:]+)/)?.[1];
      generationModels.push(modelName);
      if (modelName === "gemini-2.5-flash-lite") {
        return jsonResponse(
          {
            error: {
              message:
                "This model is no longer available to new users. Use gemini-3.5-flash-lite.",
            },
          },
          404
        );
      }
      return jsonResponse(successfulGeneration());
    },
  });

  assert.deepEqual(generationModels, [
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash-lite",
  ]);
  assert.equal(result.model, "gemini-3.5-flash-lite");
});

test("caches the model list between gesture interpretation requests", async () => {
  let listCalls = 0;
  let generationCalls = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method !== "POST") {
      listCalls += 1;
      return jsonResponse(availableModels());
    }
    generationCalls += 1;
    return jsonResponse(successfulGeneration());
  };

  await interpretGestures({ frames, apiKey: "test-key", fetchImpl });
  await interpretGestures({ frames, apiKey: "test-key", fetchImpl });

  assert.equal(listCalls, 1);
  assert.equal(generationCalls, 2);
});

test("does not call Gemini without a server API key", async () => {
  let wasCalled = false;
  await assert.rejects(
    interpretGestures({
      frames,
      apiKey: "",
      fetchImpl: async () => {
        wasCalled = true;
      },
    }),
    /GEMINI_API_KEY/
  );
  assert.equal(wasCalled, false);
});

test("reports model-list errors and malformed generation responses", async () => {
  await assert.rejects(
    interpretGestures({
      frames,
      apiKey: "test-invalid-key",
      fetchImpl: async () =>
        jsonResponse(
          { error: { message: "API key is invalid." } },
          401
        ),
    }),
    /Could not list Gemini models \(HTTP 401\): API key is invalid/
  );

  await assert.rejects(
    interpretGestures({
      frames,
      apiKey: "test-malformed-key",
      fetchImpl: async (_url, options) => {
        if (options.method !== "POST") return jsonResponse(availableModels());
        return jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"transcript":"Hello"}' }] } }],
        });
      },
    }),
    /incomplete transcript/
  );
});
