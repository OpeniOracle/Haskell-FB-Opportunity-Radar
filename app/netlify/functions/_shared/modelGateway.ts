/**
 * The model gateway (ADR 0003).
 *
 * Provider-neutral by construction: the domain speaks in `ModelRequest` and
 * `ModelOutcome`, and no provider name, SDK type or wire format appears anywhere
 * outside an adapter in this file. Anthropic Direct is the pilot provider;
 * Bedrock and Vertex are declared in the type so that adding one is an adapter,
 * not a refactor of everything that calls a model.
 *
 * FAILS CLOSED. If the credential is absent, or the provider errors, or the
 * response does not satisfy the schema, the result is a refusal — never a
 * fabricated classification. An empty extraction is a correct answer; an
 * invented one reaches a user as intelligence.
 *
 * The replay-cache key is computed here, over every input that can change the
 * answer. `structuredContextDigest` is the one most easily forgotten and the
 * most dangerous: classification prompts include resolved account and facility
 * context, so the same article legitimately classifies differently once a
 * facility resolves. Without it in the key, the cache pins the pre-resolution
 * answer forever (C25).
 */
import { modelEnv, type ModelEnv } from './env.js'

export type ModelTask = 'extract' | 'classify' | 'align' | 'summarize' | 'cluster'

export interface ModelRequest {
  readonly task: ModelTask
  readonly systemInstructions: string
  readonly input: string
  /** Digest of the resolved entity context folded into the prompt. */
  readonly structuredContextDigest: string
  readonly contentHash: string
  readonly preprocessingVersion: string
  readonly schemaVersion: string
  readonly taxonomyVersion: string
  readonly maxOutputTokens?: number
}

export type ModelRefusal =
  | 'no_credential'
  | 'provider_error'
  | 'invalid_output'
  | 'refused_by_model'

export type ModelOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly replayKey: string; readonly cached: boolean }
  | { readonly ok: false; readonly reason: ModelRefusal; readonly detail: string }

export interface ModelGateway {
  readonly available: boolean
  readonly describe: string
  run<T>(request: ModelRequest, parse: (raw: unknown) => T | null): Promise<ModelOutcome<T>>
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Every effective input, in a fixed order, so the key is reproducible. */
export async function replayKey(request: ModelRequest, env: ModelEnv): Promise<string> {
  const instructionsHash = await sha256Hex(request.systemInstructions)
  return sha256Hex(
    [
      request.contentHash,
      request.preprocessingVersion,
      request.task,
      env.provider,
      env.modelId,
      env.promptVersion,
      request.schemaVersion,
      request.taxonomyVersion,
      request.structuredContextDigest,
      instructionsHash,
    ].join(' '),
  )
}

/**
 * The unavailable gateway.
 *
 * Returned when no credential is configured. Every call refuses, so the stages
 * that need a model fail closed and the stages that do not are unaffected. This
 * is what lets the rest of the pipeline be built and run without inventing a
 * classification to stand in for the missing one.
 */
export function unavailableGateway(detail: string): ModelGateway {
  return {
    available: false,
    describe: 'unavailable',
    async run() {
      return { ok: false, reason: 'no_credential', detail }
    },
  }
}

interface AnthropicContentBlock {
  readonly type: string
  readonly text?: string
}

/** The only provider-specific code in the system. */
function anthropicAdapter(env: ModelEnv): ModelGateway {
  return {
    available: true,
    describe: `anthropic:${env.modelId}`,
    async run<T>(request: ModelRequest, parse: (raw: unknown) => T | null) {
      const key = await replayKey(request, env)
      let response: Response
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: env.modelId,
            max_tokens: request.maxOutputTokens ?? 4096,
            system: request.systemInstructions,
            messages: [{ role: 'user', content: request.input }],
          }),
        })
      } catch (error) {
        return {
          ok: false,
          reason: 'provider_error',
          detail: error instanceof Error ? error.message : String(error),
        }
      }

      if (!response.ok) {
        const text = await response.text()
        return {
          ok: false,
          reason: 'provider_error',
          detail: `HTTP ${response.status}: ${text.slice(0, 500)}`,
        }
      }

      const payload = (await response.json()) as { content?: AnthropicContentBlock[] }
      const text = (payload.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('')

      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return { ok: false, reason: 'invalid_output', detail: 'Model output was not JSON.' }
      }

      const value = parse(raw)
      if (value === null) {
        return {
          ok: false,
          reason: 'invalid_output',
          detail: 'Model output did not satisfy the expected schema.',
        }
      }
      return { ok: true, value, replayKey: key, cached: false }
    },
  }
}

/**
 * Resolve the configured gateway.
 *
 * Never throws for a missing credential. An unavailable gateway is a legitimate
 * runtime state the caller must handle, not an error that stops a deploy.
 */
export function modelGateway(): ModelGateway {
  const env = modelEnv()
  if (!env) {
    return unavailableGateway(
      'MODEL_API_KEY is not set. Classification stages fail closed and no classification is fabricated.',
    )
  }
  switch (env.provider) {
    case 'anthropic':
      return anthropicAdapter(env)
    case 'bedrock':
    case 'vertex':
      return unavailableGateway(
        `MODEL_PROVIDER="${env.provider}" has no adapter yet. Anthropic Direct is the approved pilot provider.`,
      )
  }
}
