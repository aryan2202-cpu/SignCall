import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerHelpQuestion,
  interpretGestures,
  validateSignLanguage,
  validateGestureFrames,
} from "./gestureAi.js";

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

function successfulGeneration(
  transcript = "Hello.",
  reply = "Hello! How can I help you?",
  expression = "Smiling; appears happy"
) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify({ transcript, expression, reply }) }],
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
  assert.match(validateGestureFrames([]), /between 1 and 8/);
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
      Array.from({ length: 9 }, () => ({ mimeType: "image/jpeg", data: "AQID" }))
    ),
    /between 1 and 8/
  );
});

test("only accepts the supported sign language choices", () => {
  assert.equal(validateSignLanguage("ISL"), null);
  assert.equal(validateSignLanguage("ASL"), null);
  assert.equal(validateSignLanguage("BSL"), null);
  assert.match(validateSignLanguage("universal"), /Choose Indian Sign Language/);
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

  assert.equal(result.transcript, "Hello.");
  assert.equal(result.expression, "Smiling; appears happy");
  assert.equal(result.reply, "Hello! How can I help you?");
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
  assert.match(requestBody.contents[0].parts[0].text, /Indian Sign Language \(ISL\)/);
  assert.match(requestBody.contents[0].parts[0].text, /Sign languages are distinct/);
  assert.match(requestBody.contents[0].parts[0].text, /make your best effort to understand the likely meaning/);
  assert.match(requestBody.contents[0].parts[0].text, /reply itself briefly acknowledge uncertainty/);
  assert.match(requestBody.contents[0].parts[0].text, /only when no usable signing information is visible across the frames/);
  assert.match(requestBody.contents[0].parts[0].text, /does not train the model or guarantee fluency/);
  assert.match(requestBody.contents[0].parts[0].text, /repeated side-to-side movement of an open hand/);
  assert.match(requestBody.contents[0].parts[0].text, /A single raised open palm without visible movement is not enough/);
  assert.match(requestBody.contents[0].parts[0].text, /Carefully inspect the face in every frame/);
  assert.match(requestBody.contents[0].parts[0].text, /visible anger, happiness, sadness/);
  assert.match(requestBody.contents[0].parts[0].text, /concise English transcript of the sign/);
  assert.doesNotMatch(requestBody.contents[0].parts[0].text, /Namaste/);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
  assert.equal(requestBody.generationConfig.maxOutputTokens, 160);
  assert.deepEqual(Object.keys(requestBody.generationConfig.responseSchema.properties), [
    "transcript",
    "expression",
    "reply",
  ]);
  assert.deepEqual(requestBody.generationConfig.responseSchema.required, [
    "transcript",
    "expression",
    "reply",
  ]);
});

test("targets the selected ASL or BSL without confusing them with each other", async (t) => {
  for (const [signLanguage, name] of [
    ["ASL", "American Sign Language (ASL)"],
    ["BSL", "British Sign Language (BSL)"],
  ]) {
    await t.test(signLanguage, async () => {
      let generationPrompt = "";
      await interpretGestures({
        frames,
        signLanguage,
        apiKey: `test-${signLanguage.toLowerCase()}-key`,
        fetchImpl: async (_url, options) => {
          if (!options.method) return jsonResponse(availableModels());
          generationPrompt = JSON.parse(options.body).contents[0].parts[0].text;
          return jsonResponse(successfulGeneration());
        },
      });

      assert.match(generationPrompt, new RegExp(name.replace(/[()]/g, "\\$&")));
      assert.match(generationPrompt, /do not substitute or mix signs from another language/);
      assert.match(generationPrompt, /does not train the model or guarantee fluency/);
    });
  }
});

test("rejects unsupported sign language values before requesting Gemini", async () => {
  await assert.rejects(
    interpretGestures({
      frames,
      signLanguage: "universal",
      apiKey: "test-unsupported-language",
      fetchImpl: async () => {
        throw new Error("Must not request Gemini for an unsupported sign language");
      },
    }),
    /Choose Indian Sign Language/
  );
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

test("reports a stalled Gemini request instead of hanging", async () => {
  await assert.rejects(
    interpretGestures({
      frames,
      apiKey: "test-timeout-key",
      fetchImpl: async (_url, options) => {
        if (!options.method) return jsonResponse(availableModels());
        throw new DOMException("The request timed out", "TimeoutError");
      },
    }),
    /Gemini request timed out after 25 seconds/
  );
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

test("answers help questions using only recent chat context and private server credentials", async () => {
  const requests = [];
  const result = await answerHelpQuestion({
    messages: [
      { role: "user", content: "How does the call work?" },
      { role: "assistant", content: "You can create a room or join an existing one." },
      { role: "user", content: "How do I join?" },
    ],
    apiKey: "test-help-key",
    fetchImpl: async (url, options) => {
      requests.push({ url: new URL(url), options });
      if (!options.method) return jsonResponse(availableModels());
      return jsonResponse({
        candidates: [
          { content: { parts: [{ text: "Enter your name and the room code, then select Join Room." }] } },
        ],
      });
    },
  });

  assert.equal(result.answer, "Enter your name and the room code, then select Join Room.");
  assert.equal(result.model, "gemini-3.5-flash-lite");
  const requestBody = JSON.parse(requests[1].options.body);
  assert.equal(requestBody.contents.length, 3);
  assert.equal(requestBody.contents[0].role, "user");
  assert.equal(requestBody.contents[1].role, "model");
  assert.equal(requestBody.contents[2].role, "user");
  assert.match(requestBody.system_instruction.parts[0].text, /Never ask users to share API keys/);
  assert.equal(requests[1].options.headers["x-goog-api-key"], "test-help-key");
});

test("rejects invalid or oversized help chat history", async () => {
  await assert.rejects(
    answerHelpQuestion({
      messages: [{ role: "user", content: "x".repeat(1001) }],
      apiKey: "test-help-invalid",
      fetchImpl: async () => {
        throw new Error("Must not request Gemini for invalid chat history");
      },
    }),
    /up to 8 valid recent help chat messages/
  );
  await assert.rejects(
    answerHelpQuestion({
      messages: [{ role: "assistant", content: "No user question" }],
      apiKey: "test-help-invalid-role",
      fetchImpl: async () => {
        throw new Error("Must not request Gemini without a user question");
      },
    }),
    /up to 8 valid recent help chat messages/
  );
});

test("accepts a long assistant reply as recent help context", async () => {
  const previousAnswer = "Here is a detailed explanation. ".repeat(50);
  const result = await answerHelpQuestion({
    messages: [
      { role: "user", content: "How does this work?" },
      { role: "assistant", content: previousAnswer },
      { role: "user", content: "Is it safe?" },
    ],
    apiKey: "test-help-long-answer",
    fetchImpl: async (_url, options) => {
      if (!options.method) return jsonResponse(availableModels());
      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.contents[1].parts[0].text, previousAnswer.trim());
      assert.equal(requestBody.contents[2].parts[0].text, "Is it safe?");
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "Yes, with these precautions." }] } }],
      });
    },
  });

  assert.equal(result.answer, "Yes, with these precautions.");
});
