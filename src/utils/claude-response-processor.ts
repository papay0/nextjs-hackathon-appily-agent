/**
 * Utilities for processing Claude API responses and tracking generated files
 */
import { ClaudeResponseStats, GeneratedFileTracker } from '../types/claude';
import { logInfo, logSection, logError, logAction, logWarning } from './logging';
import { ActionQueue, ActionType } from './action-queue';
import { FirestoreLogger } from './firestore-logger';
import path from 'path';
import fs from 'fs-extra';
import { calculateTokensPerSecond, formatTokensPerSecond } from './timing';
import { RequestCostTracker } from './request-cost';

/**
 * Processes a response chunk from Claude API
 */
export class ResponseProcessor {
  private chunkBuffer = '';
  private fullResponse = '';
  private chunkCount = 0;
  private firstChunkTime = 0;
  private lastChunkTime = 0;
  private createCount = 0;
  private editCount = 0;
  private deleteCount = 0;
  private commandCount = 0;
  private textCount = 0;
  private generatedFiles: GeneratedFileTracker;
  private currentFileAction: { type: string; path: string; content: string } | null = null;
  private streamingContent = '';
  private showRealTimeDisplay: boolean;
  private requestTracker: RequestCostTracker;
  private actionQueue: ActionQueue | null = null;
  private requestInfo: { 
    systemMessage: string; 
    messages: Array<{ role: string; content: string }> 
  } | null = null;
  private firestoreLogger?: FirestoreLogger;
  
  // Token tracking properties
  private totalOutputTokens = 0;
  private currentTokensPerSecond = 0;
  private lastSpeedReportTime = 0;
  private speedReportIntervalMs = 1000; // 1 second between speed reports
  private latestReportedSpeed = 0; // Store latest reported speed
  private hasReportedInitialSpeed = false; // Track if we've reported initial speed
  private minimumTimeBeforeFirstReport = 3000; // 3 seconds minimum before first report

  constructor(initialGeneratedFiles: GeneratedFileTracker, showRealTimeDisplay: boolean, requestTracker: RequestCostTracker, firestoreLogger?: FirestoreLogger) {
    this.generatedFiles = { ...initialGeneratedFiles };
    this.showRealTimeDisplay = showRealTimeDisplay;
    this.requestTracker = requestTracker;
    this.firestoreLogger = firestoreLogger;
    
    // Log the start of processing
    if (this.showRealTimeDisplay) {
      logInfo('🚀 Starting real-time processing of Claude response...');
    }
    
    // Initialize the time for first speed report
    this.lastSpeedReportTime = performance.now();
  }

  /**
   * Store the request information for debugging
   */
  setRequestInfo(systemMessage: string, messages: Array<{ role: string; content: string }>): void {
    this.requestInfo = { systemMessage, messages };
  }

  /**
   * Set the action queue for processing actions
   */
  setActionQueue(queue: ActionQueue | null): void {
    this.actionQueue = queue;
  }

  /**
   * Initialize and set the action queue with the project directory
   */
  initializeActionQueue(projectDir: string): void {
    this.actionQueue = new ActionQueue(projectDir, this.firestoreLogger);
  }

  /**
   * Get the current token speed
   */
  getCurrentTokenSpeed(): number {
    return this.currentTokensPerSecond;
  }

  /**
   * Get the latest reported token speed for final summary
   */
  getLatestReportedSpeed(): number {
    return this.latestReportedSpeed > 0 ? this.latestReportedSpeed : this.currentTokensPerSecond;
  }

  /**
   * Process a chunk of text from Claude's streaming response
   */
  async processChunk(text: string, isReasoning: boolean = false): Promise<string> {
    this.chunkCount++;
    const now = performance.now();
    
    // Record timing for first chunk
    if (this.chunkCount === 1) {
      this.firstChunkTime = now;
    }
    
    // Add text to the full response and the buffer
    this.fullResponse += text;
    this.chunkBuffer += text;
    
    // If we're tracking a file, add text to streaming content too
    if (this.currentFileAction && 
        (this.currentFileAction.type === 'CREATE' || this.currentFileAction.type === 'EDIT')) {
      this.streamingContent += text;
      
      // Update Firebase with streaming content if available
      if (this.firestoreLogger && this.currentFileAction.path) {
        await this.firestoreLogger.updateCodeContent(
          this.currentFileAction.path,
          this.streamingContent
        );
      }
    }
    
    // Estimate tokens in this chunk (approximate: ~4 chars per token)
    const chunkTokens = Math.ceil(text.length / 4);
    this.totalOutputTokens += chunkTokens;
    
    // Update tokens per second calculation
    if (now > this.firstChunkTime) {
      const elapsedSeconds = (now - this.firstChunkTime) / 1000;
      if (elapsedSeconds > 0) {
        this.currentTokensPerSecond = calculateTokensPerSecond(this.totalOutputTokens, now - this.firstChunkTime);
        
        // Update the global token tracker with these incremental values
        if (this.totalOutputTokens > 0) {
          this.requestTracker.updateOutputTokensSpeed(
            this.totalOutputTokens, 
            now - this.firstChunkTime,
            this.chunkCount === 1 // Pass isFirstToken=true for the first chunk
          );
        }
        
        // Check if we should show the first report (after minimum time threshold)
        const timeSinceFirstChunk = now - this.firstChunkTime;
        const shouldReportInitialSpeed = !this.hasReportedInitialSpeed && timeSinceFirstChunk >= this.minimumTimeBeforeFirstReport;
        
        // Check if it's time to report speed (every second after the initial report)
        if (shouldReportInitialSpeed || (this.hasReportedInitialSpeed && now - this.lastSpeedReportTime >= this.speedReportIntervalMs)) {
          this.latestReportedSpeed = this.currentTokensPerSecond; // Store latest speed
          logInfo(`Current token generation speed: ${formatTokensPerSecond(this.currentTokensPerSecond)}`);
          this.lastSpeedReportTime = now;
          this.hasReportedInitialSpeed = true;
        }
      }
    }
    
    // Safety check for excessively large buffer size 
    // (only log a warning, don't truncate)
    if (this.chunkBuffer.length > 10000000) { // 10MB
      logWarning(`Chunk buffer exceeds 10MB (${(this.chunkBuffer.length / 1000000).toFixed(2)}MB). This may indicate a problem with action tag detection.`);
    }
    
    // Process buffer for action tags
    await this.processActionTags();
    
    // Update last chunk time
    this.lastChunkTime = now;
    
    // Return a context message for logging
    return this.getContextMessage(isReasoning);
  }

  /**
   * Process action tags from the buffer
   */
  private async processActionTags(): Promise<void> {
    // First, check if we're in the middle of collecting a file action
    if (this.currentFileAction) {
      // Look for the closing tag
      const closingTag = `</action>`;
      const closingIndex = this.chunkBuffer.indexOf(closingTag);
      
      if (closingIndex !== -1) {
        // Extract the content up to the closing tag
        const newContent = this.chunkBuffer.substring(0, closingIndex);
        this.currentFileAction.content += newContent;
        
        // Check for potential nested action tags which indicate malformed content
        if (newContent.includes('<action type="')) {
          logWarning(`⚠️ Potential malformed nested action tag detected in ${this.currentFileAction.type} action for ${this.currentFileAction.path || 'unknown path'}`);
          // Continue processing anyway - we'll take what we can get
        }
        
        // Update the file content in Firebase during streaming for CREATE or EDIT
        if (this.firestoreLogger && 
            this.currentFileAction.path && 
            (this.currentFileAction.type === 'CREATE' || this.currentFileAction.type === 'EDIT')) {
          await this.firestoreLogger.updateCodeContent(
            this.currentFileAction.path, 
            this.currentFileAction.content
          );
        }
        
        // Store the file in generatedFiles if it's CREATE or EDIT
        if ((this.currentFileAction.type === 'CREATE' || 
             this.currentFileAction.type === 'EDIT') && 
            this.currentFileAction.path) {
          this.generatedFiles[this.currentFileAction.path] = this.currentFileAction.content;
        }
        
        // Complete code tracking before adding to the queue
        if (this.firestoreLogger && 
            this.currentFileAction.path && 
            (this.currentFileAction.type === 'CREATE' || this.currentFileAction.type === 'EDIT')) {
          await this.firestoreLogger.completeCodeTracking(
            this.currentFileAction.path, 
            this.currentFileAction.content
          );
        }
        
        // Add the action to the queue if available
        if (this.actionQueue && (this.currentFileAction.type === 'CREATE' || 
                                this.currentFileAction.type === 'EDIT' ||
                                this.currentFileAction.type === 'DELETE' ||
                                this.currentFileAction.type === 'COMMAND' ||
                                this.currentFileAction.type === 'TEXT')) {
          await this.actionQueue.addAction(
            this.currentFileAction.type as ActionType,
            this.currentFileAction.path,
            this.currentFileAction.content
          );
        }
        
        // Reset current file action and remove from buffer
        this.currentFileAction = null;
        // Reset streaming content on completion
        this.streamingContent = '';
        this.chunkBuffer = this.chunkBuffer.substring(closingIndex + closingTag.length);
        
        // Continue processing for other tags
        await this.processActionTags();
        return;
      } else {
        // No closing tag found, keep the content but don't clear buffer
        // This way we'll keep looking for the closing tag in future chunks
        return;
      }
    }
    
    // If we're not currently collecting a file, look for new action tags
    const actionStartRegex = /<action type="(CREATE|EDIT|DELETE|COMMAND|TEXT)"(?:\s+path="([^"]+)")?\s*>/;
    const match = this.chunkBuffer.match(actionStartRegex);
    
    if (match && match.index !== undefined) {
      const actionType = match[1].toUpperCase();
      const actionPath = match[2] || '';
      
      // Handle TEXT action
      if (actionType === 'TEXT') {
        // Extract the text between the opening and closing tags
        const openingTag = match[0];
        const textStart = match.index + openingTag.length;
        const closingTag = '</action>';
        const closingIndex = this.chunkBuffer.indexOf(closingTag, textStart);
        
        if (closingIndex !== -1) {
          // Extract text content
          const textContent = this.chunkBuffer.substring(textStart, closingIndex).trim();
          
          // Log that we found a TEXT action
          logAction('TEXT', `Found action (adding to queue)`);
          
          // Add TEXT action to the queue instead of processing immediately
          if (this.actionQueue) {
            await this.actionQueue.addAction(
              'TEXT' as ActionType,
              '',
              textContent
            );
          } else {
            // If no queue is available, display directly as fallback
            logSection('AI EXPLANATION', textContent, 'info');
          }
          
          // Count text actions
          this.textCount++;
          
          // Remove this action from the buffer and continue processing
          this.chunkBuffer = this.chunkBuffer.substring(closingIndex + closingTag.length);
          await this.processActionTags();
          return;
        }
        
        // If we can't find the closing tag, we'll wait for more chunks
        return;
      }
      
      // Handle COMMAND action - similar to TEXT but with different logging
      if (actionType === 'COMMAND') {
        // Extract the command between the opening and closing tags
        const openingTag = match[0];
        const commandStart = match.index + openingTag.length;
        const closingTag = '</action>';
        const closingIndex = this.chunkBuffer.indexOf(closingTag, commandStart);
        
        if (closingIndex !== -1) {
          // Extract command content
          const commandContent = this.chunkBuffer.substring(commandStart, closingIndex).trim();
          
          // Set as current action so it gets added to the queue at the end
          this.currentFileAction = {
            type: actionType,
            path: '',
            content: commandContent
          };
          
          // Count command actions
          this.commandCount++;
          
          // Remove the opening tag from the buffer
          this.chunkBuffer = this.chunkBuffer.substring(match.index + match[0].length);
          
          // Continue processing this buffer
          await this.processActionTags();
          return;
        }
        
        // If we can't find the closing tag, we'll wait for more chunks
        return;
      }
      
      // Check if this is a file-related action
      if ((actionType === 'CREATE' || actionType === 'EDIT' || actionType === 'DELETE') && 
          (actionType !== 'DELETE' || actionPath)) {
        // Start tracking this file action
        this.currentFileAction = {
          type: actionType,
          path: actionPath,
          content: ''
        };
        
        // Reset streaming content for new file
        this.streamingContent = '';
        
        // Log the start of CREATE/EDIT actions
        if (actionType === 'CREATE') {
          logAction('CREATE', `Detected start of CREATE action for: ${actionPath}...`);
          this.firestoreLogger?.info(`Creating: ${actionPath}...`);
          
          // Start code tracking with 'streaming' status for CREATE
          if (this.firestoreLogger && actionPath) {
            this.firestoreLogger.startCodeTracking(actionPath, 'create');
          }
        } else if (actionType === 'EDIT') {
          logAction('EDIT', `Detected start of EDIT action for: ${actionPath}...`);
          this.firestoreLogger?.info(`Editing: ${actionPath}...`);
          
          // Start code tracking with 'streaming' status for EDIT
          if (this.firestoreLogger && actionPath) {
            this.firestoreLogger.startCodeTracking(actionPath, 'edit');
          }
        }
        
        // Remove the opening tag from the buffer
        this.chunkBuffer = this.chunkBuffer.substring(match.index + match[0].length);
        
        // Continue processing this buffer
        await this.processActionTags();
        return;
      }
    }
    
    // If we reach here, there are no complete action tags to process
    // Wait for the next chunk
  }

  /**
   * Get a context message for the current processing state
   */
  private getContextMessage(isReasoning: boolean = false): string {
    // Return a simple 'Processing' message rather than detailed context
    // This helps reduce log noise
    return isReasoning ? 'Processing reasoning' : 'Processing';
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Just log if real-time display was enabled
    if (this.showRealTimeDisplay) {
      logInfo('✓ Streaming completed: ' + this.chunkCount + ' chunks');
    }
  }

  /**
   * Calculate final response statistics
   */
  getResponseStats(): ClaudeResponseStats {
    // Count action tags in the final response using regex
    const createMatches = this.fullResponse.match(/<action type="CREATE"/g) || [];
    const editMatches = this.fullResponse.match(/<action type="EDIT"/g) || [];
    const deleteMatches = this.fullResponse.match(/<action type="DELETE"/g) || [];
    const commandMatches = this.fullResponse.match(/<action type="COMMAND"/g) || [];
    const textMatches = this.fullResponse.match(/<action type="TEXT"/g) || [];
    
    // Count generated files by type
    const generatedFilesCount = Object.keys(this.generatedFiles).length;
    
    return {
      totalLength: this.fullResponse.length,
      actionCounts: {
        create: createMatches.length,
        edit: editMatches.length,
        delete: deleteMatches.length,
        command: commandMatches.length,
        text: textMatches.length
      },
      generatedFilesCount
    };
  }

  /**
   * Get the full Claude response
   */
  getFullResponse(): string {
    return this.fullResponse;
  }

  /**
   * Get the dictionary of generated files
   */
  getGeneratedFiles(): GeneratedFileTracker {
    return { ...this.generatedFiles };
  }

  /**
   * Get the action queue
   */
  getActionQueue(): ActionQueue | null {
    return this.actionQueue;
  }

  /**
   * Save the full Claude response for debugging purposes
   * @returns The path to the debug file
   */
  async saveDebugInfo(): Promise<string> {
    try {
      // Create debug directory in fixed location (two levels up from current file)
      const debugDir = path.join(__dirname, '..', '..', 'debug');
      await fs.ensureDir(debugDir);
      
      // Create unique identifier for this debug session
      const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      
      // Create a per-generation debug subfolder
      const generationDir = path.join(debugDir, `debug-${uniqueId}`);
      await fs.ensureDir(generationDir);
      
      // Create files in the generation-specific directory
      const responseFilename = `claude-response.txt`;
      const responseFilepath = path.join(generationDir, responseFilename);
      
      // Log the full response for debugging before saving
      logInfo(`Full response length before saving: ${this.fullResponse.length} characters`);
      
      // Write full response to file with retry logic for concurrent access
      let retries = 3;
      while (retries > 0) {
        try {
          await fs.writeFile(responseFilepath, this.fullResponse);
          break;
        } catch (error) {
          retries--;
          if (retries === 0) throw error;
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Save request info if available
      if (this.requestInfo) {
        const requestFilename = `claude-request.json`;
        const requestFilepath = path.join(generationDir, requestFilename);
        
        // Format request info for better readability
        const formattedRequestInfo = {
          systemMessage: this.requestInfo.systemMessage,
          messages: this.requestInfo.messages.map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        };
        
        // Write request info to file with retry logic
        retries = 3;
        while (retries > 0) {
          try {
            await fs.writeFile(
              requestFilepath, 
              JSON.stringify(formattedRequestInfo, null, 2)
            );
            break;
          } catch (error) {
            retries--;
            if (retries === 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        // Create a combined debug info file with both request and response
        const combinedFilename = `claude-debug.md`;
        const combinedFilepath = path.join(generationDir, combinedFilename);
        
        // Format the combined content with Markdown
        // Extract timestamp from uniqueId (it's the part before the hyphen)
        const timestamp = parseInt(uniqueId.split('-')[0]);
        const combinedContent = `# Claude Debug Info ${new Date(timestamp).toISOString()}

## System Message
\`\`\`
${this.requestInfo.systemMessage}
\`\`\`

## Messages
${this.requestInfo.messages.map((msg, i) => `
### Message ${i+1} (${msg.role})
\`\`\`
${msg.content}
\`\`\`
`).join('\n')}

## Response
\`\`\`
${this.fullResponse}
\`\`\`
`;
        
        // Write combined content with retry logic
        retries = 3;
        while (retries > 0) {
          try {
            await fs.writeFile(combinedFilepath, combinedContent);
            break;
          } catch (error) {
            retries--;
            if (retries === 0) throw error;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        
        // Log file paths relative to the generation directory for cleaner output
        logAction('DEBUG', `Saved request info to ${path.relative(process.cwd(), requestFilepath)}`);
        logAction('DEBUG', `Saved combined debug info to ${path.relative(process.cwd(), combinedFilepath)}`);
      }
      
      // Verify file was written successfully
      if (await fs.pathExists(responseFilepath)) {
        const stats = await fs.stat(responseFilepath);
        logInfo(`Response file size: ${stats.size} bytes`);
      }
      
      return responseFilepath;
    } catch (error) {
      logError(`Failed to save debug info: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 