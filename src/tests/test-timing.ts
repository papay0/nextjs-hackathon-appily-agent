/**
 * Test file for the timing utilities
 */
import { formatDuration, formatCost, calculateTokenCost, generateCostSummary } from '../utils/timing';
import { logInfo, createHeader } from '../utils/logging';
import { getCurrentModelKey } from '../services/ai-model-service';

// Test cases for duration formatting
const durationTestCases = [
  // Small durations
  0,                // 0ms
  1,                // 1ms
  50,               // 50ms
  999,              // 999ms
  
  // Seconds
  1000,             // 1.0s
  1500,             // 1.5s
  5432,             // 5.4s
  9999,             // 10.0s
  10000,            // 10s
  59999,            // 59s
  
  // Minutes
  60000,            // 1m
  61000,            // 1m 1s
  62500,            // 1m 2s
  90000,            // 1m 30s
  3599999,          // 59m 59s
  
  // Hours
  3600000,          // 1h
  3601000,          // 1h 0m 1s
  3661000,          // 1h 1m 1s
  7322000,          // 2h 2m 2s
  86400000,         // 24h
  90061000,         // 25h 1m 1s
];

// Test cases for token cost calculation
const tokenTestCases = [
  { inputTokens: 100, outputTokens: 200 },          // Very small request
  { inputTokens: 1000, outputTokens: 2000 },        // Small request
  { inputTokens: 10000, outputTokens: 5000 },       // Medium request
  { inputTokens: 100000, outputTokens: 50000 },     // Large request
  { inputTokens: 1000000, outputTokens: 500000 },   // Very large request
  { inputTokens: 2000000, outputTokens: 1000000 },  // Massive request
];

// Print duration test results
logInfo(createHeader('DURATION FORMATTING TEST'));
logInfo('Testing duration formatting:');
durationTestCases.forEach(ms => {
  logInfo(`${ms.toString().padEnd(10)} → ${formatDuration(ms)}`);
});

// Print cost formatting test results
logInfo(createHeader('TOKEN COST TEST'));
logInfo('Testing token cost calculation:');
const currentModelKey = getCurrentModelKey();
tokenTestCases.forEach(({ inputTokens, outputTokens }) => {
  const { inputCost, outputCost, totalCost } = calculateTokenCost(inputTokens, outputTokens, currentModelKey);
  logInfo(`Input: ${inputTokens.toString().padEnd(8)} tokens (${formatCost(inputCost)})`);
  logInfo(`Output: ${outputTokens.toString().padEnd(7)} tokens (${formatCost(outputCost)})`);
  logInfo(`Total cost: ${formatCost(totalCost)}`);
  logInfo(generateCostSummary(inputTokens, outputTokens, currentModelKey));
  logInfo('---');
}); 