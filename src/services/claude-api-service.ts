/**
 * Service for interacting with the Claude AI API
 */
import { streamText } from 'ai';
import dotenv from 'dotenv';
import { logSuccess, logError, logInfo, logSection, logAction, logWarning } from '../utils/logging';
import { ResponseProcessor } from '../utils/claude-response-processor';
import { FirestoreLogger } from '../utils/firestore-logger';
import { ClaudeMessage, GeneratedFileTracker, OpenRouterMessage } from '../types/claude';
import chalk from 'chalk';
import { formatDuration } from '../utils/timing';
import { v4 as uuidv4 } from 'uuid';
import { ActionQueue } from '../utils/action-queue';
import path from 'path';
import { initializeAIModel } from './ai-model-service';
import { RequestCostTracker } from '../utils/request-cost';
import { OpenRouterService } from './open-router-service';
dotenv.config();

/**
 * Estimate token count for input messages
 * @param systemMessage - System message
 * @param messages - User and assistant messages
 * @returns Approximate token count
 */
function estimateInputTokens(systemMessage: string, messages: ClaudeMessage[]): number {
  // A very rough estimate: ~4 chars per token for English text
  const systemTokens = Math.ceil(systemMessage.length / 4);
  const messageTokens = messages.reduce((sum, msg) => {
    return sum + Math.ceil((msg.content as string).length / 4);
  }, 0);
  
  // Add some overhead for message formatting
  return systemTokens + messageTokens + 200;
}

/**
 * Format Claude messages for the AI SDK
 */
function formatMessagesForAiSdk(messages: ClaudeMessage[]) {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

/**
 * Format messages for the OpenRouter API
 */
export function formatMessagesForOpenRouter(messages: OpenRouterMessage[]) {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

export async function streamResponse(
  systemMessage: string,
  messages: ClaudeMessage[], 
  modelKey: string,
  responseProcessor: ResponseProcessor,
  requestTracker: RequestCostTracker,
  projectDir?: string, // Add optional project directory parameter
  firestoreLogger?: FirestoreLogger // Changed parameter type
): Promise<{
  fullResponse: string;
  generatedFiles: GeneratedFileTracker;
  stats: { streamStart: number; streamEnd: number; apiCallStart: number; totalStreamDuration: number; }
}> {

    // Use direct logging instead of spinner but only for initialization
    if (!projectDir) {
      // Only log this if we're not using the queue (to avoid clutter)
      logInfo('Starting AI API request...');
    }

    // Generate a unique request ID
  const requestId = uuidv4();
  
  // Estimate input tokens and start tracking the request
  const inputTokens = estimateInputTokens(systemMessage, messages);
  requestTracker.startRequest(requestId, "AI code generation", inputTokens, modelKey);

  try {
    // Store request info for debugging
    responseProcessor.setRequestInfo(systemMessage, messages);
    
    // Initialize action queue if project directory is provided
    let actionQueue: ActionQueue | null = null;
    if (projectDir) {
      actionQueue = new ActionQueue(projectDir, firestoreLogger);
      responseProcessor.setActionQueue(actionQueue);
      logInfo(`Action queue initialized for project: ${path.basename(projectDir)}`);
      firestoreLogger?.info(`Action queue initialized for project: ${path.basename(projectDir)}`);
    }
    
    // Log that we are saving the request info
    logAction('DEBUG', 'Saving request info for debugging purposes');
    
    // Call AI API using the OpenRouter SDK with streaming
    const apiCallStart = performance.now();

    
    // Format messages for the OpenRouter SDK
    const formattedMessages = formatMessagesForOpenRouter(messages);
    
    // Store the request information for debugging before making the API call
    responseProcessor.setRequestInfo(systemMessage, [
      { role: 'system', content: systemMessage },
      ...formattedMessages
    ]);
    
    const streamStart = performance.now();
    const openai = new OpenRouterService();
    
    let stream;
    let chunkCount = 0;
    let hasContent = false;
    let savedDebugFile = '';
    
    try {
      // Attempt to create the stream
      try {
        stream = await openai.getOpenAI().chat.completions.create(
          {
            model: modelKey,
            messages: [
              { role: 'system', content: systemMessage },
              ...formattedMessages
            ],
            stream: true,
          }
        );
      } catch (streamError) {
        // Save debug info before propagating the token limit error
        logError('Error creating stream:', streamError);
        savedDebugFile = await responseProcessor.saveDebugInfo();
        logInfo(`Saved debug information to ${savedDebugFile} for token limit analysis`);
        
        // Rethrow for the outer catch block to handle
        throw streamError;
      }
      
      // Process the stream chunks
      for await (const chunk of stream) {
        if (chunk.choices[0].delta.content) {
          await responseProcessor.processChunk(chunk.choices[0].delta.content);
          chunkCount++;
          hasContent = true;
        }
      }
      } catch (error) {
        logError('Error processing text stream:', error);
        
        // Save debug information even if we failed to process the first chunk
        try {
          savedDebugFile = await responseProcessor.saveDebugInfo();
          logInfo(`Saved debug information to ${savedDebugFile} before rethrowing error`);
        } catch (debugError) {
          logError('Failed to save debug info during error handling:', debugError);
        }
        
        throw error;
      }

      // Get timing information
    const streamEnd = performance.now();
    const totalStreamDuration = Math.round(streamEnd - streamStart);
    const totalDuration = Math.round(streamEnd - apiCallStart);
    
    // Get full response and validate it's not empty
    const fullResponse = responseProcessor.getFullResponse();
    
    // Check if the response is essentially empty despite receiving chunks
    // This can happen if the AI only returns whitespace or control characters
    if (!hasContent || fullResponse.trim().length === 0) {
      logError('AI returned an empty or whitespace-only response - this indicates an API issue or content filtering');
      requestTracker.completeRequest(requestId, 0, modelKey, true); // Mark as error
      throw new Error('AI API returned an empty response - please check API keys and rate limits');
    }
    
    // Estimate output tokens (again using the rough 4 chars per token)
    const outputTokens = Math.ceil(fullResponse.length / 4);
    requestTracker.completeRequest(requestId, outputTokens, modelKey, false);
    
    // Log success and get response stats
    logSuccess('AI model response received successfully');
    const stats = responseProcessor.getResponseStats();
    
    // Log stats
    logSection('AI MODEL RESPONSE STATS', 
      `- Total length: ${stats.totalLength} characters\n` +
      `- Action counts from regex: CREATE=${chalk.yellow(stats.actionCounts.create)}, EDIT=${chalk.blue(stats.actionCounts.edit)}, DELETE=${chalk.red(stats.actionCounts.delete)}, COMMAND=${chalk.magenta(stats.actionCounts.command)}\n` +
      `- Tracking ${stats.generatedFilesCount} generated files`
    );
    
    // Save debug info if not already saved during error handling
    if (!savedDebugFile) {
      savedDebugFile = await responseProcessor.saveDebugInfo();
    }
    logInfo(`Saved full AI model response for debugging to ${savedDebugFile}`);
    
    // Log timing information
    logSuccess(`Streaming completed: ${chunkCount} chunks [${formatDuration(totalStreamDuration)}]`);
    logSuccess(`Total AI model API interaction [${formatDuration(totalDuration)}]`);
    
    // Add a warning if no CREATE/EDIT actions were found but we got a response
    if (stats.actionCounts.create === 0 && stats.actionCounts.edit === 0 && fullResponse.length > 0) {
      logWarning('No CREATE or EDIT actions found in AI model response. The response might be malformed.');
    }
    
    // Return the full response
    return {
      fullResponse,
      generatedFiles: responseProcessor.getGeneratedFiles(),
      stats: {
        streamStart,
        streamEnd,
        apiCallStart,
        totalStreamDuration
      }
    };
  } catch (error) {
    logError('Error streaming response:', error);
    throw error;
  }
}

/**
 * Process a streaming response from Claude API
 */
export async function streamClaudeResponse(
  systemMessage: string,
  messages: ClaudeMessage[], 
  modelKey: string,
  responseProcessor: ResponseProcessor,
  requestTracker: RequestCostTracker,
  projectDir?: string, // Add optional project directory parameter
  firestoreLogger?: FirestoreLogger // Changed parameter type
): Promise<{
  fullResponse: string;
  generatedFiles: GeneratedFileTracker;
  stats: { streamStart: number; streamEnd: number; apiCallStart: number; totalStreamDuration: number; }
}> {
  // Use direct logging instead of spinner but only for initialization
  if (!projectDir) {
    // Only log this if we're not using the queue (to avoid clutter)
    logInfo('Starting AI API request...');
  }
  
  // Initialize variable to track saved debug file
  let savedDebugFile = '';
  
  // Generate a unique request ID
  const requestId = uuidv4();
  
  // Estimate input tokens and start tracking the request
  const inputTokens = estimateInputTokens(systemMessage, messages);
  requestTracker.startRequest(requestId, "AI code generation", inputTokens, modelKey);
  
  try {
    // Store request info for debugging
    responseProcessor.setRequestInfo(systemMessage, messages);
    
    // Initialize action queue if project directory is provided
    let actionQueue: ActionQueue | null = null;
    if (projectDir) {
      actionQueue = new ActionQueue(projectDir, firestoreLogger);
      responseProcessor.setActionQueue(actionQueue);
      logInfo(`Action queue initialized for project: ${path.basename(projectDir)}`);
      firestoreLogger?.info(`Action queue initialized for project: ${path.basename(projectDir)}`);
    }
    
    // Log that we are saving the request info
    logAction('DEBUG', 'Saving request info for debugging purposes');
    
    // Call AI API using the AI SDK with streaming
    const apiCallStart = performance.now();
    
    // Initialize the AI model using our service
    const { model, maxTokens } = initializeAIModel(modelKey);
    
    // Format messages for the AI SDK
    const formattedMessages = formatMessagesForAiSdk(messages);
    
    const streamStart = performance.now();
    
    // Stream the response using AI SDK with full stream for better error handling
    const { fullStream } = await streamText({
      model,
      system: systemMessage,
      messages: formattedMessages,
      maxTokens,
    });
    
    let chunkCount = 0;
    let hasContent = false;
    
    try {
      for await (const part of fullStream) {
        if (part.type === "reasoning") {
          // Process reasoning content with visual distinction in logs
          if (part.textDelta && part.textDelta.trim().length > 0) {
            // Log reasoning with a distinct format
            logInfo(chalk.cyan(`[AI Reasoning] ${part.textDelta}`));
            // Process the reasoning text with a flag indicating it's reasoning
            await responseProcessor.processChunk(part.textDelta, true);
            chunkCount++;
            hasContent = true;
          }
        } else if (part.type === "redacted-reasoning") {
          // Process reasoning content with visual distinction in logs
          if (part.data && part.data.trim().length > 0) {
            // Log reasoning with a distinct format
            logInfo(chalk.cyan(`[AI Reasoning] ${part.data}`));
            // Process the reasoning text with a flag indicating it's reasoning
            await responseProcessor.processChunk(part.data, true);
            chunkCount++;
            hasContent = true;
           }
         } else if (part.type === "text-delta") {
          // Process text delta content - same as regular text
          if (part.textDelta && part.textDelta.trim().length > 0) {
            await responseProcessor.processChunk(part.textDelta);
            chunkCount++;
            hasContent = true;
          }
        }
      }
      
    } catch (streamError) {
      logError('Error processing text stream:', streamError);
      let errorDetails = '';
      let errorType = 'Unknown';
      
      // Try to extract detailed error information from streamError
      if (streamError instanceof Error) {
        // Check for specific AI SDK error patterns
        const errorMessage = streamError.message;
        // Store the message for debugging
        errorDetails = errorMessage;
        
        // Try to extract more specific error information from the error object 
        if ('cause' in streamError && streamError.cause) {
          const cause = streamError.cause;
          
          // Log the entire error object for debugging
          logInfo(`Full error object: ${JSON.stringify(cause, Object.getOwnPropertyNames(cause), 2)}`);
          
          if (typeof cause === 'object' && cause !== null) {
            // Extract error code and type if available
            if ('code' in cause) errorDetails += ` (Code: ${String(cause.code)})`;
            if ('type' in cause) errorType = String(cause.type);
            
            // If there's a nested error with a response
            if ('response' in cause && cause.response) {
              const response = cause.response;
              // Log the entire response object for debugging
              logInfo(`API response object: ${JSON.stringify(response, Object.getOwnPropertyNames(response), 2)}`);
              
              if (typeof response === 'object' && response !== null) {
                // Extract status and statusText if available
                if ('status' in response) errorDetails += ` (Status: ${String(response.status)})`;
                if ('statusText' in response) errorDetails += ` (${String(response.statusText)})`;
                
                // Try to extract error details from response body if available
                if ('data' in response && response.data) {
                  const data = response.data;
                  logInfo(`Response data: ${JSON.stringify(data, null, 2)}`);
                  
                  if (typeof data === 'object' && data !== null) {
                    if ('error' in data && typeof data.error === 'object' && data.error !== null) {
                      const error = data.error;
                      if ('message' in error) errorDetails += ` (API: ${String(error.message)})`;
                      if ('type' in error) errorType = String(error.type);
                    }
                  }
                }
              }
            }
          }
        }
      }
      
      // Check fullStream for error parts as a backup
      try {
        for await (const part of fullStream) {
          if ('type' in part && part.type === 'error' && 'error' in part) {
            // Safely access the error property with proper type checking
            const errorObj = part.error;
            errorDetails += ` [Stream error: ${
              errorObj instanceof Error ? errorObj.message : String(errorObj)
            }]`;
            
            // If there are additional properties in the error object, log them
            if (errorObj instanceof Error && 'code' in errorObj) {
              errorType = String(errorObj.code);
            }
          }
        }
      } catch (fullStreamError) {
        // If we can't access the fullStream either, log that too
        logError(`Failed to process fullStream for error details: ${String(fullStreamError)}`);
      }
      
      // Determine error category based on all collected information
      let errorCategory = 'Unknown Error';
      if (errorType.includes('rate_limit') || errorType.includes('quota') || 
          errorDetails.includes('rate limit') || errorDetails.includes('quota') ||
          errorDetails.includes('429')) {
        errorCategory = 'Rate Limit Error';
      } else if (errorType.includes('auth') || errorType.includes('key') || 
                errorDetails.includes('authentication') || errorDetails.includes('key') ||
                errorDetails.includes('401')) {
        errorCategory = 'Authentication Error';
      } else if (errorType.includes('content') || errorType.includes('filter') || 
                errorDetails.includes('content') || errorDetails.includes('policy') ||
                errorDetails.includes('400')) {
        errorCategory = 'Content Policy Error';
      } else if (errorType.includes('timeout') || errorDetails.includes('timeout') || 
                errorDetails.includes('network') || errorDetails.includes('ECONNREFUSED') ||
                errorDetails.includes('504')) {
        errorCategory = 'Network Error';
      }
      
      // Log the detailed error information
      logError(`${errorCategory} with details: ${errorDetails}`);
      
      // Mark the request as errored in the tracker
      requestTracker.completeRequest(requestId, 0, modelKey, true);
      
      // Throw an error with the detailed information
      throw new Error(`AI API error (${errorCategory}): ${errorDetails}\n\nTroubleshooting:\n- Check your API key and network connection\n- Try again in a few minutes if rate limited\n- Modify your prompt if content was filtered`);
    }
    
    // Get timing information
    const streamEnd = performance.now();
    const totalStreamDuration = Math.round(streamEnd - streamStart);
    const totalDuration = Math.round(streamEnd - apiCallStart);
    
    // Get full response and validate it's not empty
    const fullResponse = responseProcessor.getFullResponse();
    
    // Check if the response is essentially empty despite receiving chunks
    // This can happen if the AI only returns whitespace or control characters
    if (!hasContent || fullResponse.trim().length === 0) {
      logError('AI returned an empty or whitespace-only response - this indicates an API issue or content filtering');
      requestTracker.completeRequest(requestId, 0, modelKey, true); // Mark as error
      throw new Error('AI API returned an empty response - please check API keys and rate limits');
    }
    
    // Estimate output tokens (again using the rough 4 chars per token)
    const outputTokens = Math.ceil(fullResponse.length / 4);
    requestTracker.completeRequest(requestId, outputTokens, modelKey, false);
    
    // Log success and get response stats
    logSuccess('AI model response received successfully');
    const stats = responseProcessor.getResponseStats();
    
    // Log stats
    logSection('AI MODEL RESPONSE STATS', 
      `- Total length: ${stats.totalLength} characters\n` +
      `- Action counts from regex: CREATE=${chalk.yellow(stats.actionCounts.create)}, EDIT=${chalk.blue(stats.actionCounts.edit)}, DELETE=${chalk.red(stats.actionCounts.delete)}, COMMAND=${chalk.magenta(stats.actionCounts.command)}\n` +
      `- Tracking ${stats.generatedFilesCount} generated files`
    );
    
    // Save debug info if not already saved during error handling
    if (!savedDebugFile) {
      savedDebugFile = await responseProcessor.saveDebugInfo();
    }
    logInfo(`Saved full AI model response for debugging to ${savedDebugFile}`);
    
    // Log timing information
    logSuccess(`Streaming completed: ${chunkCount} chunks [${formatDuration(totalStreamDuration)}]`);
    logSuccess(`Total AI model API interaction [${formatDuration(totalDuration)}]`);
    
    // Add a warning if no CREATE/EDIT actions were found but we got a response
    if (stats.actionCounts.create === 0 && stats.actionCounts.edit === 0 && fullResponse.length > 0) {
      logWarning('No CREATE or EDIT actions found in AI model response. The response might be malformed.');
    }
    
    // Return the full response
    return {
      fullResponse,
      generatedFiles: responseProcessor.getGeneratedFiles(),
      stats: {
        streamStart,
        streamEnd,
        apiCallStart,
        totalStreamDuration
      }
    };
  } catch (error) {
    logError('Error calling AI API, full error:', error);
    // Determine if this is a network error, API error, or other type
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Create a categorized error message
    let errorCategory = 'Unknown Error';
    if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      errorCategory = 'Network Error';
    } else if (errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
      errorCategory = 'Rate Limit Error';
    } else if (errorMessage.includes('authentication') || errorMessage.includes('key')) {
      errorCategory = 'Authentication Error';
    } else if (errorMessage.includes('content') || errorMessage.includes('filter') || errorMessage.includes('policy')) {
      errorCategory = 'Content Policy Error';
    }
    
    // Log the error with category
    logError(`${errorCategory} calling AI API:`, error);
    
    // Mark the request as errored in the tracker
    requestTracker.completeRequest(requestId, 0, modelKey, true);
    
    // Throw an enhanced error with troubleshooting guidance
    throw new Error(`Failed to generate code (${errorCategory}): ${errorMessage}\n\nTroubleshooting:\n- Check your API key and network connection\n- Try again in a few minutes if rate limited\n- Modify your prompt if content was filtered, full error: ${error}`);
  }
} 