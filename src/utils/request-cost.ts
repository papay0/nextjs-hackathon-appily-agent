/**
 * Utilities for tracking and displaying request costs
 */
import { calculateTokenCost, formatCost, formatDuration, generateCostSummary, calculateTokensPerSecond } from './timing';
import { createHeader, logInfo } from './logging';
import chalk from 'chalk';
import { getCurrentModelKey } from '../services/ai-model-service';

interface RequestStats {
  requestId: string;
  startTime: number;
  endTime?: number;
  inputTokens: number;
  outputTokens: number;
  description: string;
  hasError?: boolean;
  modelKey: string;
  currentOutputTokens?: number;
  currentDuration?: number;
  firstTokenTime?: number;  // Time when first token was received
  lastTokenTime?: number;   // Time when last token was received
}

/**
 * Service for tracking requests and their costs
 */
export class RequestCostTracker {
  private requests: RequestStats[] = [];
  private modelKey: string = getCurrentModelKey();
  
  /**
   * Start tracking a new request
   * @param requestId - Unique identifier for the request
   * @param description - Description of the request
   * @param inputTokens - Number of input tokens (if known)
   * @param modelKey - The model identifier key
   * @returns The request ID
   */
  startRequest(requestId: string, description: string, inputTokens = 0, modelKey: string): string {
    this.requests.push({
      requestId,
      startTime: performance.now(),
      inputTokens,
      outputTokens: 0,
      description,
      modelKey,
      currentOutputTokens: 0,
      currentDuration: 0
    });
    this.modelKey = modelKey;
    return requestId;
  }
  
  /**
   * Update the token generation speed tracking for the most recent request
   * @param outputTokens - Current total output tokens
   * @param durationMs - Current duration in milliseconds
   * @param isFirstToken - Whether this is the first token being processed
   */
  updateOutputTokensSpeed(outputTokens: number, durationMs: number, isFirstToken = false): void {
    const latestRequest = this.requests[this.requests.length - 1];
    
    if (latestRequest) {
      // Track first token time
      if (isFirstToken && !latestRequest.firstTokenTime) {
        latestRequest.firstTokenTime = performance.now();
      }
      
      // Always update last token time
      latestRequest.lastTokenTime = performance.now();
      
      latestRequest.currentOutputTokens = outputTokens;
      latestRequest.currentDuration = durationMs;
    }
  }
  
  /**
   * Complete a request and record output tokens
   * @param requestId - ID of the request to complete
   * @param outputTokens - Number of output tokens
   * @param isError - Whether the request ended with an error
   * @param inputTokens - Updated input token count (if needed)
   * @param modelKey - Optional override for the model key (only needed if changing from the one set in startRequest)
   */
  completeRequest(requestId: string, outputTokens: number, modelKey: string, isError?: boolean, inputTokens?: number): void {
    const request = this.requests.find(r => r.requestId === requestId);
    
    if (!request) {
      throw new Error(`Request with ID ${requestId} not found`);
    }
    
    request.endTime = performance.now();
    request.outputTokens = outputTokens;
    
    if (!request.currentOutputTokens || request.currentOutputTokens < outputTokens) {
      request.currentOutputTokens = outputTokens;
    }
    
    if (!request.currentDuration) {
      request.currentDuration = request.endTime - request.startTime;
    }
    
    // Ensure lastTokenTime is set if not already
    if (!request.lastTokenTime) {
      request.lastTokenTime = request.endTime;
    }
    
    if (inputTokens !== undefined) {
      request.inputTokens = inputTokens;
    }
    
    request.modelKey = modelKey;
    
    if (isError) {
      request.hasError = isError;
    }
  }
  
  /**
   * Get statistics for a specific request
   * @param requestId - ID of the request
   * @returns Request statistics or undefined if not found
   */
  getRequestStats(requestId: string): RequestStats | undefined {
    return this.requests.find(r => r.requestId === requestId);
  }
  
  /**
   * Get total token usage and cost across all requests
   */
  getTotalStats(): {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    totalDuration: number;
    totalCost: number;
    inputCost: number;
    outputCost: number;
    outputTokensPerSecond: number;
  } {
    const totalInputTokens = this.requests.reduce((sum, req) => sum + req.inputTokens, 0);
    const totalOutputTokens = this.requests.reduce((sum, req) => sum + req.outputTokens, 0);
    const totalRequests = this.requests.length;
    
    // Calculate total request duration (for API cost purposes)
    const totalDuration = this.requests.reduce((sum, req) => {
      if (req.endTime) {
        return sum + (req.endTime - req.startTime);
      }
      return sum;
    }, 0);
    
    const { inputCost, outputCost, totalCost } = calculateTokenCost(totalInputTokens, totalOutputTokens, this.modelKey);
    
    // Calculate a proper weighted average of token speeds based on STREAMING duration (not total duration)
    let outputTokensPerSecond = 0;
    
    // Method: Calculate per-request speeds using stream time (first to last token) and use weighted average
    let totalWeightedSpeed = 0;
    let totalTokensForWeighting = 0;
    
    this.requests.forEach(req => {
      // Only use requests that have both first and last token timestamps
      if (req.firstTokenTime && req.lastTokenTime && !req.hasError && req.outputTokens > 0) {
        // Use stream duration rather than total request duration
        const streamDuration = req.lastTokenTime - req.firstTokenTime;
        
        if (streamDuration > 0) {
          const speed = calculateTokensPerSecond(req.outputTokens, streamDuration);
          totalWeightedSpeed += speed * req.outputTokens;
          totalTokensForWeighting += req.outputTokens;
        }
      }
    });
    
    if (totalTokensForWeighting > 0) {
      // Use weighted average based on stream duration
      outputTokensPerSecond = totalWeightedSpeed / totalTokensForWeighting;
    } else {
      // Fallback: If no valid stream timing data, use a reasonable estimate
      outputTokensPerSecond = totalDuration > 0 ? calculateTokensPerSecond(totalOutputTokens, totalDuration) : 0;
    }
    
    return {
      totalInputTokens,
      totalOutputTokens,
      totalRequests,
      totalDuration,
      totalCost,
      inputCost,
      outputCost,
      outputTokensPerSecond
    };
  }
  
  /**
   * Get just the token counts for cost calculation
   * @returns Object with total input and output token counts
   */
  getTokenCounts(): { inputTokens: number; outputTokens: number } {
    const totalInputTokens = this.requests.reduce((sum, req) => sum + req.inputTokens, 0);
    const totalOutputTokens = this.requests.reduce((sum, req) => sum + req.outputTokens, 0);
    
    return {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens
    };
  }
  
  /**
   * Get the calculated cost summary data without formatting
   * @returns Object with total tokens, costs, duration, and model key
   */
  getCostSummaryData(): { 
    totalInputTokens: number; 
    totalOutputTokens: number; 
    totalCost: number; 
    inputCost: number; 
    outputCost: number; 
    totalDuration: number;
    modelKey: string;
    outputTokensPerSecond: number;
  } {
    const stats = this.getTotalStats();
    
    return {
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      totalCost: stats.totalCost,
      inputCost: stats.inputCost,
      outputCost: stats.outputCost,
      totalDuration: stats.totalDuration,
      modelKey: this.modelKey,
      outputTokensPerSecond: stats.outputTokensPerSecond
    };
  }
  
  /**
   * Gets the current output tokens per second for logging after operations
   * @returns The current output tokens per second rate
   */
  getOutputTokenSpeed(): number {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      const request = this.requests[i];
      // Use stream times if available
      if (request.firstTokenTime && request.lastTokenTime && 
          !request.hasError && request.currentOutputTokens) {
        const streamDuration = request.lastTokenTime - request.firstTokenTime;
        if (streamDuration > 0) {
          return calculateTokensPerSecond(request.currentOutputTokens, streamDuration);
        }
      }
      
      // Fall back to old method if stream times aren't available
      if (!request.hasError && request.currentOutputTokens && request.currentDuration && request.currentDuration > 0) {
        return calculateTokensPerSecond(request.currentOutputTokens, request.currentDuration);
      }
    }
    
    const stats = this.getTotalStats();
    return stats.outputTokensPerSecond;
  }
  
  /**
   * Display a summary of all requests and costs
   */
  displayCostSummary(): void {
    logInfo(createHeader('REQUEST COST SUMMARY'));
    
    this.requests.forEach((req, index) => {
      const duration = req.endTime ? req.endTime - req.startTime : undefined;
      
      // Calculate stream duration (first to last token) for proper token speed
      const streamDuration = (req.firstTokenTime && req.lastTokenTime) ? 
        (req.lastTokenTime - req.firstTokenTime) : undefined;
      
      const { inputCost, outputCost, totalCost } = calculateTokenCost(req.inputTokens, req.outputTokens, req.modelKey);
      
      const statusIndicator = req.hasError 
        ? chalk.red('❌ ') 
        : chalk.green('✓ ');
      
      logInfo(`${statusIndicator}Request #${index + 1}: ${req.description}`);
      logInfo(`  ID: ${req.requestId}`);
      logInfo(`  Model: ${req.modelKey}`);
      
      if (duration) {
        logInfo(`  Duration: ${formatDuration(duration)}`);
      }
      
      // Additionally show stream duration if different
      if (streamDuration && Math.abs(streamDuration - (duration || 0)) > 100) {
        logInfo(`  Stream duration: ${formatDuration(streamDuration)}`);
      }
      
      logInfo(`  Input tokens: ${req.inputTokens} (${formatCost(inputCost)})`);
      logInfo(`  Output tokens: ${req.outputTokens} (${formatCost(outputCost)})`);
      
      logInfo(`  Total cost: ${formatCost(totalCost)}`);
    });
    
    // Display total summary
    const stats = this.getTotalStats();
    const totalCostSummary = generateCostSummary(stats.totalInputTokens, stats.totalOutputTokens, this.modelKey);
    
    logInfo('\nSUMMARY:');
    logInfo(`Total requests: ${stats.totalRequests}`);
    logInfo(`Total duration: ${formatDuration(stats.totalDuration)}`);
    
    logInfo(totalCostSummary);
  }
}