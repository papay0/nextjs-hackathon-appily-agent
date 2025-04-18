/**
 * AI Model Service Module
 * 
 * This module provides a unified interface for working with different AI models:
 * - Anthropic (Claude)
 * - OpenAI (GPT)
 * - Google (Gemini)
 * 
 * It handles:
 * - Model configuration and selection
 * - Provider initialization
 * - API key validation
 * - Model initialization
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { AIProvider, AVAILABLE_AI_MODELS, AIModelConfig } from '../types/ai-models';
import { logInfo, logError } from '../utils/logging';
import { deepseek } from '@ai-sdk/deepseek';
import { openrouter } from '@openrouter/ai-sdk-provider';

// The default model to use if none is specified
export const DEFAULT_MODEL_KEY = 'claude-3-7-sonnet';

// Get configuration for current model from environment variable or default
export const getCurrentModelKey = (): string => {
  return process.env.AI_MODEL || DEFAULT_MODEL_KEY;
};

/**
 * Get the AI model configuration for the specified model key
 */
export const getModelConfig = (modelKey: string): AIModelConfig => {
  const config = AVAILABLE_AI_MODELS[modelKey];
  
  if (!config) {
    // If model not found, fall back to default
    logError(`Model "${modelKey}" not found in available models. Using default: ${DEFAULT_MODEL_KEY}`);
    return AVAILABLE_AI_MODELS[DEFAULT_MODEL_KEY];
  }
  
  return config;
};

/**
 * Validate that the API key for the specified provider is available
 */
const validateApiKey = (config: AIModelConfig): void => {
  const apiKey = process.env[config.apiKeyEnvName];
  
  if (!apiKey) {
    throw new Error(`${config.apiKeyEnvName} environment variable is not set`);
  }
};

/**
 * Return type for initialize AI model, including both the model and its configuration
 */
export interface AIModelWithConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any; // The initialized model
  maxTokens?: number; // The maximum tokens the model supports
}

/**
 * Initialize the AI model based on the provided configuration
 */
export const initializeAIModel = (modelKey: string): AIModelWithConfig => {
  const config = getModelConfig(modelKey);
  validateApiKey(config);
  
  // Log which model we're using
  logInfo(`Using AI model: ${config.model} (${config.provider}) with max tokens: ${config.maxTokens}`);
  
  let provider;
  let model;
  
  // Initialize the appropriate provider based on the configuration
  switch (config.provider) {
    case AIProvider.ANTHROPIC: {
      provider = createAnthropic({
        apiKey: process.env[config.apiKeyEnvName]
      });
      model = provider(config.model);
      break;
    }
      
    case AIProvider.OPENAI: {
      // Verify OpenAI API key is set
      if (!process.env[config.apiKeyEnvName]) {
        throw new Error(`${config.apiKeyEnvName} not set`);
      }
      
      // Use the imported openai provider directly
      model = openai(config.model);
      break;
    }
      
    case AIProvider.GEMINI: {
        // Verify OpenAI API key is set
        if (!process.env[config.apiKeyEnvName]) {
          throw new Error(`${config.apiKeyEnvName} not set`);
        }
        
        // Use the imported openai provider directly
        model = google(config.model);
        break;
    }

    case AIProvider.GROQ: {
      // Verify Groq API key is set
      if (!process.env[config.apiKeyEnvName]) {
        throw new Error(`${config.apiKeyEnvName} not set`);
      }

      model = groq(config.model);
      break;
    }

    case AIProvider.DEEPSEEK: {
      // Verify DeepSeek API key is set
      if (!process.env[config.apiKeyEnvName]) {
        throw new Error(`${config.apiKeyEnvName} not set`);
      }

      model = deepseek(config.model);
      break;
    }

    case AIProvider.OPEN_ROUTER: {
      // Verify OpenRouter API key is set
      if (!process.env[config.apiKeyEnvName]) {
        throw new Error(`${config.apiKeyEnvName} not set`);
      }

      model = openrouter.chat(config.model);
      break;
    }
      
    default: {
      // This should never happen due to the type system, but we include it for safety
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unsupported AI provider: ${exhaustiveCheck}`);
    }
  }
  
  return { 
    model,
    maxTokens: config.maxTokens
  };
}; 