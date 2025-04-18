/**
 * Claude AI Client Module
 * 
 * This module handles all interactions with the Claude AI API for code generation.
 * It provides:
 * 
 * 1. API Communication:
 *    - Manages Claude API connections
 *    - Handles streaming responses
 *    - Processes system messages and prompts
 * 
 * 2. Response Processing:
 *    - Parses Claude's responses into actionable operations
 *    - Tracks file changes across multiple attempts
 *    - Maintains conversation history
 * 
 * 3. Performance Monitoring:
 *    - Tracks API response times
 *    - Monitors chunk processing
 *    - Provides detailed timing information
 * 
 * 4. Error Handling:
 *    - Manages API errors gracefully
 *    - Provides detailed error logging
 *    - Implements retry mechanisms
 * 
 * The module uses streaming to process Claude's responses in real-time,
 * allowing for immediate feedback and progress tracking during code generation.
 */

import { getSystemMessage } from './utils/prompt/claude-system-message';
import { UserPrompt } from './types/user-prompt';
import { ClaudeMessage, GeneratedFileTracker } from './types/claude';
import { streamResponse } from './services/claude-api-service';
import { logSuccess, logError } from './utils/logging';
import { formatDuration } from './utils/timing';
import { ResponseProcessor } from './utils/claude-response-processor';
import { RequestCostTracker } from './utils/request-cost';
import { FirestoreLogger } from './utils/firestore-logger';
import path from 'path';

/**
 * Generate code using Claude AI
 * 
 * @param projectStructure Structure information about the project
 * @param conversations Array of conversation messages or objects
 * @param modelKey The model key to use for generation
 * @param generatedFiles Tracked files from previous attempts
 * @param showRealTimeDisplay Whether to show real-time streaming display
 * @param projectDir Optional project directory for action queue handling
 * @returns Object containing full response from Claude and updated generatedFiles
 */
export async function generateCode(
  projectStructure: string, 
  conversations: UserPrompt[],
  modelKey: string,
  generatedFiles: GeneratedFileTracker = {},
  showRealTimeDisplay = true,
  requestTracker: RequestCostTracker,
  projectDir?: string,
  firestoreLogger?: FirestoreLogger,
): Promise<{
  response: string;
  updatedGeneratedFiles: GeneratedFileTracker;
  responseProcessor: ResponseProcessor;
  requestTracker: RequestCostTracker;
}> {
  const totalStart = performance.now();
  
  try {
    // Format the system message
    // Extract the project folder name from projectDir if available
    let projectPath = '';
    if (projectDir) {
      projectPath = path.basename(projectDir);
    }
    
    // Pass the project path to getSystemMessage for asset prefix configuration
    const systemMessage = getSystemMessage(projectStructure, generatedFiles, projectPath);
    
    // Format the conversation for Claude
    const messages: ClaudeMessage[] = [];
    
    // Add conversation history (alternating between user and assistant roles)
    conversations.forEach((message, index) => {
      const role = index % 2 === 0 ? "user" : "assistant";
      
      if (role === "user") {
        // Handle user messages with follow-up context if needed
        let content = message.formattedPrompt;
        
        // Add follow-up context prefix if this is a follow-up request
        if (message.isFollowUp) {
          content = "This is a follow-up request for an existing project. Please modify the current implementation rather than starting from scratch.\n\n" + content;
        }
        
        messages.push({ role, content } as ClaudeMessage);
      } else {
        // Handle assistant messages - use userPrompt for assistant messages to maintain context
        // This assumes assistant messages are stored in UserPrompt objects where userPrompt contains the full response
        let content = message.userPrompt;
        
        // Filter out the CREATE/EDIT/DELETE action code to save on tokens
        content = content.replace(
          /<action type="(CREATE|EDIT|DELETE)"([^>]*)>([\s\S]*?)<\/action>/g,
          (match, actionType, attributes) => {
            // Extract the path if it exists
            const pathMatch = attributes.match(/path="([^"]+)"/);  
            const path = pathMatch ? pathMatch[1] : '[unknown path]';
            
            return `<action_placeholder type="${actionType}" path="${path}">[Code content omitted to optimize token usage]</action_placeholder>`;
          }
        );
        
        messages.push({ role, content } as ClaudeMessage);
      }
    });

    const responseProcessor = new ResponseProcessor(generatedFiles, showRealTimeDisplay, requestTracker, firestoreLogger);
    
    // Call the Claude API and process the streaming response
    const { fullResponse, generatedFiles: updatedGeneratedFiles } = await streamResponse(
      systemMessage,
      messages,
      modelKey,
      responseProcessor,
      requestTracker,
      projectDir,
      firestoreLogger
    );
    
    // Log the total generation time
    const elapsedTime = Math.round(performance.now() - totalStart);
    logSuccess(`Total code generation time [${formatDuration(elapsedTime)}]`);
    
    return {
      response: fullResponse,
      updatedGeneratedFiles,
      responseProcessor,
      requestTracker,
    };
  } catch (error) {
    const errorTime = Math.round(performance.now() - totalStart);
    
    // Log the error with timing information
    logError(`Error in generateCode after [${formatDuration(errorTime)}]`);
    
    if (error instanceof Error) {
      throw error; // Preserve the original error with its troubleshooting information
    } else {
      throw new Error(`An unexpected error occurred: ${String(error)}`);
    }
  }
}