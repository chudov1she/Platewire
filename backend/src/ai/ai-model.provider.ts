import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

export type AgentRole = 'decision' | 'curation';

/**
 * Builds an OpenAI-compatible chat model (works against Ollama's OpenAI
 * shim, OpenAI itself, or any compatible gateway). Decision and curation
 * agents get independent model/temperature knobs because they have very
 * different jobs: decision needs low-temperature, fast, per-game judgment;
 * curation needs slower, more analytical reasoning over aggregate stats.
 */
@Injectable()
export class AiModelProvider {
  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return (this.config.get<string>('AI_ENABLED') ?? 'true').toLowerCase() === 'true';
  }

  build(role: AgentRole): ChatOpenAI {
    const rawBase = this.config.get<string>('AI_BASE_URL') ?? 'https://ollama.com';
    const baseURL = rawBase.replace(/\/$/, '').endsWith('/v1')
      ? rawBase.replace(/\/$/, '')
      : `${rawBase.replace(/\/$/, '')}/v1`;

    const modelKey = role === 'decision' ? 'AI_DECISION_MODEL' : 'AI_CURATION_MODEL';
    const tempKey = role === 'decision' ? 'AI_DECISION_TEMPERATURE' : 'AI_CURATION_TEMPERATURE';
    const defaultModel = role === 'decision' ? 'glm-5.2:cloud' : 'glm-5.2:cloud';
    const defaultTemp = role === 'decision' ? 0.1 : 0.3;

    return new ChatOpenAI({
      apiKey: this.config.get<string>('AI_API_KEY') ?? '',
      model: this.config.get<string>(modelKey) ?? defaultModel,
      temperature: Number(this.config.get(tempKey) ?? defaultTemp),
      configuration: { baseURL },
      timeout: Number(this.config.get('AI_TIMEOUT_SECONDS') ?? 90) * 1000,
    });
  }

  maxToolRounds(): number {
    return Number(this.config.get('AI_MAX_TOOL_ROUNDS') ?? 6);
  }

  modelName(role: AgentRole): string {
    const modelKey = role === 'decision' ? 'AI_DECISION_MODEL' : 'AI_CURATION_MODEL';
    return this.config.get<string>(modelKey) ?? 'glm-5.2:cloud';
  }
}
