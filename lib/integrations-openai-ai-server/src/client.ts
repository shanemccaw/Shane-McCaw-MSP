import OpenAI from "openai";

// Lazily construct the client on first real use, not at module import time.
// Throwing here at module load (when the env vars are unset) meant any file
// that transitively imported this module -- including via vitest collection --
// blew up just from being imported, before a caller ever touched the client.
let _openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (_openai) return _openai;

  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }

  _openai = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return _openai;
}

// Proxy preserves the existing `openai.foo.bar()` call shape for every
// consumer while deferring real construction (and the env-var check) until
// the first property access.
export const openai = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getOpenAIClient(), prop, receiver);
  },
});
