/**
 * Timing utilities for measuring execution time of functions
 */
import { logInfo, logSuccess, logError } from './logging';
import { AVAILABLE_AI_MODELS, ModelPricing } from '../types/ai-models';

/**
 * Get pricing for a specific model
 * @param modelKey - The model identifier key from AVAILABLE_AI_MODELS
 * @returns ModelPricing object with input and output prices
 */
export function getModelPricing(modelKey: string): ModelPricing {
  // Get pricing from model config, or use default values if model not found
  const modelConfig = AVAILABLE_AI_MODELS[modelKey];
  
  if (!modelConfig) {
    console.warn(`Model pricing not found for "${modelKey}", using Claude 3.7 Sonnet pricing as default`);
    return {
      input: 3,   // Default: $3 per million input tokens
      output: 15  // Default: $15 per million output tokens
    };
  }
  
  return modelConfig.pricing;
}

/**
 * Format milliseconds into a human-readable string
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  // For very small durations
  if (ms < 1000) {
    return `${ms}ms`;
  }
  
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  // Format with appropriate units
  const parts: string[] = [];
  
  // Add hours if present
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  
  // Add minutes if present or if we have hours and seconds
  if (minutes > 0 || (hours > 0 && seconds > 0)) {
    parts.push(`${minutes}m`);
  }
  
  // Add seconds
  if (seconds > 0 || parts.length === 0) {
    // Show decimal seconds for durations under 10 seconds when no hours present
    if (hours === 0 && ms < 10000) {
      // For exactly 10 seconds, don't show the decimal
      if (ms === 10000) {
        parts.push('10s');
      } else {
        const secondsWithDecimal = (ms / 1000).toFixed(1);
        parts.push(`${secondsWithDecimal}s`);
      }
    } else {
      parts.push(`${seconds}s`);
    }
  }
  
  return parts.join(' ');
}

/**
 * Calculate token cost in USD
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param modelKey - The model identifier key to use for pricing
 * @returns Object with input, output, and total costs
 */
export function calculateTokenCost(
  inputTokens: number, 
  outputTokens: number, 
  modelKey: string
): {
  inputCost: number;
  outputCost: number;
  totalCost: number;
} {
  const pricing = getModelPricing(modelKey);
  
  const inputCost = (inputTokens / 1000000) * pricing.input;
  const outputCost = (outputTokens / 1000000) * pricing.output;
  const totalCost = inputCost + outputCost;
  
  return {
    inputCost,
    outputCost,
    totalCost
  };
}

/**
 * Format cost in USD with appropriate precision
 * @param cost - Cost in USD
 * @returns Formatted cost string
 */
export function formatCost(cost: number): string {
  // For very small costs (<1¢), show 4 decimal places
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  // For small costs (<$1), show 2 decimal places
  else if (cost < 1) {
    return `$${cost.toFixed(2)}`;
  }
  // For larger costs, show 2 decimal places
  else {
    return `$${cost.toFixed(2)}`;
  }
}

/**
 * Generate a cost summary string
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param modelKey - The model identifier key to use for pricing
 * @returns Formatted cost summary string
 */
export function generateCostSummary(
  inputTokens: number, 
  outputTokens: number,
  modelKey: string
): string {
  const { inputCost, outputCost, totalCost } = calculateTokenCost(inputTokens, outputTokens, modelKey);
  
  return `Cost: ${formatCost(totalCost)} (Input: ${formatCost(inputCost)} for ${inputTokens} tokens, Output: ${formatCost(outputCost)} for ${outputTokens} tokens)`;
}

/**
 * Calculate tokens per second rate
 * @param tokens - Number of tokens
 * @param durationMs - Duration in milliseconds
 * @returns Tokens per second rate (fixed to 2 decimal places)
 */
export function calculateTokensPerSecond(tokens: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  
  const tokensPerSecond = tokens / (durationMs / 1000);
  return parseFloat(tokensPerSecond.toFixed(2));
}

/**
 * Format tokens per second into a readable string
 * @param tokensPerSecond - Tokens per second rate
 * @returns Formatted tokens per second string
 */
export function formatTokensPerSecond(tokensPerSecond: number): string {
  return `${tokensPerSecond.toFixed(2)} tokens/sec`;
}

/**
 * Utility function to measure execution time of a function
 * @param fn - Function to measure
 * @param label - Label for logging
 * @returns The result of the measured function
 */
export async function measureTime<T>(fn: () => Promise<T>, label: string): Promise<T> {
  logInfo(`${label}...`);
  
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    logSuccess(`✓ ${label} [${formatDuration(duration)}]`);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    logError(`✗ ${label} failed [${formatDuration(duration)}]`);
    throw error;
  }
} 