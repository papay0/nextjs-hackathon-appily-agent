/**
 * Test file for the request cost tracker
 */
import { logInfo, logError } from '../utils/logging';
import { getCurrentModelKey } from '../services/ai-model-service';
import { RequestCostTracker } from '../utils/request-cost';
// Simulate a series of API requests
async function simulateRequests() {
  const requestTracker = new RequestCostTracker();
  // First request - short with few tokens
  const req1 = requestTracker.startRequest('req-001', 'Simple completion request', 500, getCurrentModelKey());
  await new Promise(resolve => setTimeout(resolve, 1200)); // Simulate 1.2s processing
  requestTracker.completeRequest(req1, 300, getCurrentModelKey());
  
  // Second request - medium with more tokens
  const req2 = requestTracker.startRequest('req-002', 'Medium chat completion', 3500, getCurrentModelKey());
  await new Promise(resolve => setTimeout(resolve, 3500)); // Simulate 3.5s processing
  requestTracker.completeRequest(req2, 1800, getCurrentModelKey());
  
  // Third request - large with many tokens
  const req3 = requestTracker.startRequest('req-003', 'Complex code generation', 15000, getCurrentModelKey());
  await new Promise(resolve => setTimeout(resolve, 8000)); // Simulate 8s processing
  requestTracker.completeRequest(req3, 25000, getCurrentModelKey());
  
  // Fourth request - very large with many tokens
  const req4 = requestTracker.startRequest('req-004', 'Large document summarization', 75000, getCurrentModelKey());
  await new Promise(resolve => setTimeout(resolve, 12000)); // Simulate 12s processing
  requestTracker.completeRequest(req4, 18000, getCurrentModelKey());
  
  // Display the cost summary
  requestTracker.displayCostSummary();
}

// Run the simulation
logInfo('Starting request cost simulation...');
simulateRequests().catch(err => logError('Error in simulation', err)); 