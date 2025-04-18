/* eslint-disable no-unused-vars */
 
/**
 * Type definitions for AI model providers and models
 */

/**
 * Available AI providers
 */
// These enums are used indirectly via string values
export enum AIProvider {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  GEMINI = 'gemini',
  GROQ = 'groq',
  DEEPSEEK = 'deepseek',
  OPEN_ROUTER = 'openrouter'
}

/**
 * Anthropic model options
 */
export enum AnthropicModel {
  CLAUDE_3_7_SONNET = 'claude-3-7-sonnet-20250219',
  CLAUDE_3_5_SONNET = 'claude-3-5-sonnet-20240620'
}

/**
 * OpenAI model options
 */
export enum OpenAIModel {
  GPT4O = 'gpt-4o',
  GPT4O_MINI = 'gpt-4o-mini',
  O3_MINI = 'o3-mini'
}

/**
 * Groq model options
 */
export enum GroqModel {
  DEEPSEEK_R1_DISTILL_LLAMA_70B = 'deepseek-r1-distill-llama-70b'
}

/**
 * Gemini model options
 */
export enum GeminiModel {
  GEMINI_1_5_PRO = 'gemini-1.5-pro-latest',
  GEMINI_1_5_FLASH = 'gemini-1.5-flash-latest',
  GEMINI_2_0_FLASH = 'gemini-2.0-flash-exp',
  GEMINI_2_5_PRO = 'gemini-2.5-pro-exp-03-25'
}

export enum DeepSeekModel {
  DEEPSEEK_REASONER = 'deepseek-reasoner',
  DEEPSEEK_CHAT = 'deepseek-chat'
}

export enum OpenRouterModel {
  CLAUDE_3_7_SONNET = 'anthropic/claude-3.7-sonnet',
  LLAMA_4_MAVERICK = 'meta-llama/llama-4-maverick',
  LLAMA_4_SCOUT = 'meta-llama/llama-4-scout'
}

/**
 * Pricing information for models (USD per million tokens)
 */
export interface ModelPricing {
  input: number;
  output: number;
}

/**
 * Union type of all model types
 */
export type AIModel = AnthropicModel | OpenAIModel | GeminiModel | GroqModel | DeepSeekModel | OpenRouterModel;

/**
 * Configuration for the AI model
 */
export interface AIModelConfig {
  provider: AIProvider;
  model: AIModel;
  apiKeyEnvName: string;
  maxTokens?: number;
  pricing: ModelPricing;
}

/**
 * Available AI model configurations
 */
export const AVAILABLE_AI_MODELS: Record<string, AIModelConfig> = {
  'claude-3-7-sonnet': {
    provider: AIProvider.ANTHROPIC,
    model: AnthropicModel.CLAUDE_3_7_SONNET,
    apiKeyEnvName: 'ANTHROPIC_API_KEY',
    maxTokens: 64000,
    pricing: {
      input: 3,  // $3 per million input tokens
      output: 15 // $15 per million output tokens
    }
  },
  'claude-3-5-sonnet': {
    provider: AIProvider.ANTHROPIC,
    model: AnthropicModel.CLAUDE_3_5_SONNET,
    apiKeyEnvName: 'ANTHROPIC_API_KEY',
    maxTokens: 32000,
    pricing: {
      input: 3,
      output: 15
    }
  },
  'gpt-4o': {
    provider: AIProvider.OPENAI,
    model: OpenAIModel.GPT4O,
    apiKeyEnvName: 'OPENAI_API_KEY',
    pricing: {
      input: 2.5,
      output: 10
    }
  },
  'gpt-4o-mini': {
    provider: AIProvider.OPENAI,
    model: OpenAIModel.GPT4O_MINI,
    apiKeyEnvName: 'OPENAI_API_KEY',
    pricing: {
      input: 0.15,
      output: 0.6
    }
  },
  'o3-mini': {
    provider: AIProvider.OPENAI,
    model: OpenAIModel.O3_MINI,
    apiKeyEnvName: 'OPENAI_API_KEY',
    pricing: {
      input: 1.1,
      output: 4.4
    }
  },
  'gemini-1-5-pro': {
    provider: AIProvider.GEMINI,
    model: GeminiModel.GEMINI_1_5_PRO,
    apiKeyEnvName: 'GOOGLE_GENERATIVE_AI_API_KEY',
    maxTokens: 32000,
    pricing: {
      input: 1.25,
      output: 5
    }
  },
  'gemini-2-0-flash': {
    provider: AIProvider.GEMINI,
    model: GeminiModel.GEMINI_2_0_FLASH,
    apiKeyEnvName: 'GOOGLE_GENERATIVE_AI_API_KEY',
    maxTokens: 32000,
    pricing: {
      input: 0.1,
      output: 0.7
    }
  },
  'gemini-2-5-pro': {
    provider: AIProvider.GEMINI,
    model: GeminiModel.GEMINI_2_5_PRO,
    apiKeyEnvName: 'GOOGLE_GENERATIVE_AI_API_KEY',
    maxTokens: 32000,
    pricing: {
      input: 3, // I actually don't know the price, we don't know yet!
      output: 15
    }
  },
  'deepseek-r1-distill-llama-70b': {
    provider: AIProvider.GROQ,
    model: GroqModel.DEEPSEEK_R1_DISTILL_LLAMA_70B,
    apiKeyEnvName: 'GROQ_API_KEY',
    maxTokens: 8000,
    pricing: {
      input: 0.75,
      output: 0.99
    }
  },
  'deepseek-reasoner': {
    provider: AIProvider.DEEPSEEK,
    model: DeepSeekModel.DEEPSEEK_REASONER,
    apiKeyEnvName: 'DEEPSEEK_API_KEY',
    pricing: {
      input: 0.55,
      output: 2.19
    }
  },
  'deepseek-chat': {
    provider: AIProvider.DEEPSEEK,
    model: DeepSeekModel.DEEPSEEK_CHAT,
    apiKeyEnvName: 'DEEPSEEK_API_KEY',
    pricing: {
      input: 0.2,
      output: 1.1
    }
  },
  'anthropic/claude-3.7-sonnet': {
    provider: AIProvider.OPEN_ROUTER,
    model: OpenRouterModel.CLAUDE_3_7_SONNET,
    apiKeyEnvName: 'OPENROUTER_API_KEY',
    maxTokens: 64000,
    pricing: {
      input: 3,  // $3 per million input tokens
      output: 15 // $15 per million output tokens
    }
  },
  'meta-llama/llama-4-maverick': {
    provider: AIProvider.OPEN_ROUTER,
    model: OpenRouterModel.LLAMA_4_MAVERICK,
    apiKeyEnvName: 'OPENROUTER_API_KEY',
    pricing: {
      input: 0.2,
      output: 0.6
    }
  },
  'meta-llama/llama-4-scout': {
    provider: AIProvider.OPEN_ROUTER,
    model: OpenRouterModel.LLAMA_4_SCOUT,
    apiKeyEnvName: 'OPENROUTER_API_KEY',
    pricing: {
      input: 0.1,
      output: 0.3
    }
  }
}