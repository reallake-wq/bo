import { clip, env } from "./util.mjs";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_FLASH_MODEL = "deepseek-v4-flash";
export const DEEPSEEK_PRO_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_RESEARCH_MODELS = [DEEPSEEK_FLASH_MODEL, DEEPSEEK_PRO_MODEL];

function cleanBaseUrl(value) {
  return String(value || DEEPSEEK_BASE_URL).replace(/\/+$/, "");
}

const CHANNELS = [
  {
    name: "deepseek-official",
    label: "DeepSeek Official",
    baseUrl: cleanBaseUrl(env("DEEPSEEK_API_BASE_URL")),
    model: DEEPSEEK_PRO_MODEL,
    keyEnv: "DEEPSEEK_API_KEY"
  }
];

export function channelsForRuntime() {
  return [...CHANNELS];
}

export function configuredChannels() {
  return channelsForRuntime().map((channel, index) => ({
    ...channel,
    priority: index + 1,
    configured: Boolean(env(channel.keyEnv))
  }));
}

export async function discoverResearchModels(limit = 2) {
  return DEEPSEEK_RESEARCH_MODELS.slice(0, limit);
}

function modelsForChannel(channel, options) {
  if (options.model) return [options.model];
  if (Array.isArray(options.models) && options.models.length) return options.models;
  return [channel.model];
}

async function notifyAttempt(options, payload) {
  try {
    await options.onAttempt?.(payload);
  } catch {
    // Progress callbacks must never break the model request itself.
  }
}

function isStreamResponse(response) {
  return /text\/event-stream/i.test(response.headers.get("content-type") || "");
}

function parseStreamDelta(payload) {
  return payload?.choices?.[0]?.delta?.content ?? payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? "";
}

async function readStreamContent(response, { controller, options, attempt, model, channel, startedAt }) {
  if (!response.body?.getReader) throw new Error("stream response body is not readable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? 90000;
  const streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? 45000;
  const streamMaxMs = options.streamMaxMs ?? options.timeoutMs ?? 240000;
  const progressEveryMs = options.streamProgressEveryMs ?? 3000;
  const progressEveryChars = options.streamProgressEveryChars ?? 1200;

  let content = "";
  let buffer = "";
  let firstToken = false;
  let lastProgressAt = 0;
  let lastProgressChars = 0;
  let abortReason = "";

  const maxTimer = setTimeout(() => {
    abortReason = `stream exceeded ${Math.round(streamMaxMs / 1000)}s`;
    controller.abort();
  }, streamMaxMs);

  let idleTimer;
  const armIdle = (ms, reason) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortReason = reason;
      controller.abort();
    }, ms);
  };
  armIdle(firstTokenTimeoutMs, `no first token within ${Math.round(firstTokenTimeoutMs / 1000)}s`);

  const notifyStreamProgress = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < progressEveryMs && content.length - lastProgressChars < progressEveryChars) return;
    lastProgressAt = now;
    lastProgressChars = content.length;
    await notifyAttempt(options, {
      attempt,
      status: "stream-progress",
      model,
      channel,
      receivedChars: content.length,
      elapsedMs: now - startedAt,
      lastOutputAt: new Date(now).toISOString(),
      error: `streaming, received about ${content.length} chars`
    });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\n\n+/);
      buffer = events.pop() || "";
      for (const event of events) {
        const lines = event
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));
        for (const line of lines) {
          const data = line.replace(/^data:\s*/, "");
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data);
            const delta = parseStreamDelta(payload);
            if (!delta) continue;
            if (!firstToken) {
              firstToken = true;
              await notifyAttempt(options, {
                attempt,
                status: "first-token",
                model,
                channel,
                elapsedMs: Date.now() - startedAt,
                error: "first token received"
              });
            }
            content += delta;
            armIdle(streamIdleTimeoutMs, `stream idle for ${Math.round(streamIdleTimeoutMs / 1000)}s`);
            await notifyStreamProgress();
          } catch {
            // Ignore malformed SSE frames and keep reading.
          }
        }
      }
    }
    await notifyStreamProgress(true);
  } catch (error) {
    if (abortReason) {
      const next = new Error(abortReason);
      next.name = "StreamTimeoutError";
      throw next;
    }
    throw error;
  } finally {
    clearTimeout(maxTimer);
    clearTimeout(idleTimer);
  }

  if (!content.trim()) throw new Error("stream returned empty content");
  return content;
}

async function readJsonContent(response, controller, timeoutMs) {
  const bodyTimer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = await response.json();
    return payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "";
  } finally {
    clearTimeout(bodyTimer);
  }
}

export async function callModel(messages, options = {}) {
  const errors = [];
  const timeoutMs = options.timeoutMs ?? 120000;
  const totalTimeoutMs = options.totalTimeoutMs ?? options.maxTotalMs ?? 0;
  const startedAt = Date.now();
  const deadline = totalTimeoutMs > 0 ? startedAt + totalTimeoutMs : Number.POSITIVE_INFINITY;
  const allowedChannels = Array.isArray(options.channelNames) && options.channelNames.length ? new Set(options.channelNames) : null;
  const preferStream = options.stream !== false;
  const thinking =
    options.thinking ||
    (String(env("DEEPSEEK_THINKING_MODE") || "disabled").toLowerCase() === "enabled"
      ? { type: "enabled" }
      : { type: "disabled" });
  let attempt = 0;

  for (const channel of channelsForRuntime(options.runtimeMode)) {
    if (allowedChannels && !allowedChannels.has(channel.name)) continue;
    const apiKey = env(channel.keyEnv);
    if (!apiKey) continue;
    const models = modelsForChannel(channel, options);

    for (const model of models) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        errors.push(`model call total budget exhausted after ${Math.round(totalTimeoutMs / 1000)}s`);
        throw new Error(errors.join("\n"));
      }

      attempt += 1;
      const attemptTimeoutMs = Math.max(3000, Math.min(timeoutMs, remainingMs));
      await notifyAttempt(options, {
        attempt,
        status: "start",
        model,
        channel: channel.name,
        timeoutMs: attemptTimeoutMs,
        remainingMs: Math.max(0, remainingMs)
      });

      const controller = new AbortController();
      const headerTimeoutMs = preferStream ? Math.min(options.headerTimeoutMs ?? 30000, attemptTimeoutMs) : attemptTimeoutMs;
      let abortReason = "";
      const timer = setTimeout(() => {
        abortReason = `no response headers within ${Math.round(headerTimeoutMs / 1000)}s`;
        controller.abort();
      }, headerTimeoutMs);

      try {
        const response = await fetch(`${channel.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages,
            thinking,
            temperature: options.temperature ?? 0.25,
            max_tokens: options.maxTokens ?? 12000,
            ...(thinking?.type === "enabled" && options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
            ...(preferStream ? { stream: true } : {})
          }),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!response.ok) {
          const text = await response.text();
          errors.push(`${channel.name}/${model}: HTTP ${response.status} ${clip(text, 300)}`);
          await notifyAttempt(options, {
            attempt,
            status: "http-error",
            model,
            channel: channel.name,
            error: `HTTP ${response.status}`
          });
          continue;
        }

        await notifyAttempt(options, {
          attempt,
          status: "headers",
          model,
          channel: channel.name,
          elapsedMs: Date.now() - startedAt,
          error: "response headers received"
        });

        const content = preferStream && isStreamResponse(response)
          ? await readStreamContent(response, {
              controller,
              options,
              attempt,
              model,
              channel: channel.name,
              startedAt
            })
          : await readJsonContent(response, controller, attemptTimeoutMs);

        if (!content) {
          errors.push(`${channel.name}/${model}: empty response`);
          await notifyAttempt(options, {
            attempt,
            status: "empty",
            model,
            channel: channel.name,
            error: "empty response"
          });
          continue;
        }

        await notifyAttempt(options, {
          attempt,
          status: "success",
          model,
          channel: channel.name
        });

        return {
          content,
          model,
          channel: channel.name
        };
      } catch (error) {
        const message = abortReason && error?.name === "AbortError" ? abortReason : error?.message || String(error);
        errors.push(`${channel.name}/${model}: ${message}`);
        await notifyAttempt(options, {
          attempt,
          status: "error",
          model,
          channel: channel.name,
          error: error?.name === "AbortError" ? `timeout after ${Math.round(attemptTimeoutMs / 1000)}s` : error?.message || String(error)
        });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  throw new Error(errors.length ? errors.join("\n") : "No configured DeepSeek API key. Set DEEPSEEK_API_KEY.");
}

export function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("model returned empty content");
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error("model output is not parseable JSON");
  }
}
