/**
 * Queue system for processing actions from Claude responses
 */
import {
  logWarning,
  logError,
  logInfo,
  logSuccess,
  logSection
} from './logging';
import { executeCommand, applyFileChange } from '../services/file-operation-service';
import { FirestoreLogger } from './firestore-logger';
import chalk from 'chalk';

export type ActionType = 'CREATE' | 'EDIT' | 'DELETE' | 'COMMAND' | 'TEXT';

export interface QueuedAction {
  type: ActionType;
  path?: string;
  content: string;
  processed: boolean;
  timestamp: number;
  retryCount: number;
  id?: string; // Add unique ID for tracking command execution
}

export interface CommandResult {
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  timestamp: number;
  actionId?: string; // Reference to the original action that triggered this command
}

/**
 * Action queue for processing actions in order
 */
export class ActionQueue {
  private queue: QueuedAction[] = [];
  private isProcessing: boolean = false;
  private projectDir: string;
  private paused: boolean = false;
  private MAX_RETRIES = 3; // Maximum number of retries for any action
  private commandHistory: CommandResult[] = []; // Store command execution results
  private pendingCommands: Set<string> = new Set(); // Track currently executing commands by their action IDs
  private queueEmptyResolvers: Array<() => void> = []; // Resolvers for waitUntilComplete promises
  private firestoreLogger?: FirestoreLogger; // Renamed property

  constructor(projectDir: string, firestoreLogger?: FirestoreLogger) {
    this.projectDir = projectDir;
    this.firestoreLogger = firestoreLogger;
  }

  /**
   * Get command history for passing to Claude
   */
  getCommandHistory(): CommandResult[] {
    return this.commandHistory;
  }

  /**
   * Generate a unique ID
   */
  private generateActionId(): string {
    return `action-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wait until the queue is completely empty and all commands have finished processing
   * Returns a promise that resolves when everything is done
   */
  async waitUntilComplete(timeoutMs: number = 300000): Promise<void> {
    // If queue is already empty and no pending commands, resolve immediately
    if (this.queue.length === 0 && !this.hasPendingCommands()) {
      logInfo('✅ Queue already empty, no need to wait');
      return Promise.resolve();
    }

    logInfo(`⏳ Waiting for queue to complete (${this.queue.length} items, ${this.pendingCommands.size} pending commands)`);
    
    // Create a promise that will resolve when the queue is empty
    return new Promise<void>((resolve) => {
      // Add resolver to the list
      this.queueEmptyResolvers.push(resolve);
      
      // Set timeout to prevent indefinite waiting
      const timeout = setTimeout(() => {
        // Remove this resolver from the list
        const index = this.queueEmptyResolvers.indexOf(resolve);
        if (index !== -1) {
          this.queueEmptyResolvers.splice(index, 1);
        }
        
        logWarning(`⚠️ Timeout waiting for queue to complete after ${timeoutMs}ms`);
        logInfo(`Queue state at timeout: ${this.queue.length} items, ${this.pendingCommands.size} pending commands`);
        
        // Resolve anyway to prevent blocking the process
        resolve();
      }, timeoutMs);
      
      // If everything completes successfully, clear the timeout
      const clearTimeoutWrapper = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      // Replace the resolver with one that also clears the timeout
      const index = this.queueEmptyResolvers.indexOf(resolve);
      if (index !== -1) {
        this.queueEmptyResolvers[index] = clearTimeoutWrapper;
      }
    });
  }

  /**
   * Check if all queue operations are complete
   */
  private checkIfComplete(): boolean {
    const isComplete = this.queue.length === 0 && !this.hasPendingCommands() && !this.isProcessing;
    
    // If queue is complete and we have waiting resolvers, resolve them
    if (isComplete && this.queueEmptyResolvers.length > 0) {
      logInfo('✅ Queue processing complete, resolving all waiters');
      
      // Call all resolvers
      const resolvers = [...this.queueEmptyResolvers];
      this.queueEmptyResolvers = [];
      
      // Execute resolvers on next tick to avoid potential issues
      setTimeout(() => {
        resolvers.forEach(resolve => resolve());
      }, 0);
    }
    
    return isComplete;
  }

  /**
   * Add an action to the queue
   */
  async addAction(type: ActionType, path: string | undefined, content: string): Promise<void> {
    // Create queued action with unique ID
    const action: QueuedAction = {
      type,
      path,
      content,
      processed: false,
      timestamp: Date.now(),
      retryCount: 0,
      id: this.generateActionId()
    };
    
    // Create display identifier for action
    const actionIdentifier = path || content.substring(0, Math.min(30, content.length)) + (content.length > 30 ? '...' : '');
    
    // Log that we're adding to queue
    logInfo(`📥 Adding ${chalk.cyan(type)} action to queue: ${actionIdentifier}`);
    
    // Add to queue
    this.queue.push(action);
    
    // Start processing if not already started
    if (!this.isProcessing && !this.paused) {
      this.startProcessing();
    }
  }

  /**
   * Check if there are any pending commands
   */
  private hasPendingCommands(): boolean {
    return this.pendingCommands.size > 0;
  }

  /**
   * Start processing the queue
   */
  async startProcessing(): Promise<void> {
    if (this.isProcessing || this.paused) {
      return;
    }
    
    if (this.queue.length === 0) {
      logInfo(`📭 Queue is empty, nothing to process`);
      this.checkIfComplete(); // Check if we're completely done
      return;
    }
    
    logInfo(`🚀 Starting queue processing (${this.queue.length} actions in queue)`);
    
    this.isProcessing = true;
    
    try {
      while (this.queue.length > 0 && !this.paused) {
        const action = this.queue[0];
        
        // If there are pending commands, wait until they complete before processing next action
        if (this.hasPendingCommands()) {
          logInfo(`⏳ Waiting for ${this.pendingCommands.size} pending command(s) to complete before processing next action`);
          // Skip processing for now, we'll retry on the next tick
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        // Check if we've exceeded the retry limit
        if (action.retryCount >= this.MAX_RETRIES) {
          logError(`❌ Action exceeded maximum retry count (${this.MAX_RETRIES}). Skipping to prevent infinite loop: ${action.type}`);
          this.queue.shift(); // Remove from queue
          continue;
        }
        
        if (!action.processed) {
          const success = await this.processAction(action);
          
          if (success) {
            action.processed = true;
          } else {
            // Increment retry count
            action.retryCount++;
            
            if (action.retryCount >= this.MAX_RETRIES) {
              logWarning(`⚠️ Action processing failed after ${action.retryCount} attempts and will be skipped: ${action.type}`);
              action.processed = true;
            } else {
              logWarning(`⚠️ Action processing failed. Will retry (attempt ${action.retryCount + 1}/${this.MAX_RETRIES}): ${action.type}`);
              // Move to end of queue for retry
              this.queue.push(this.queue.shift()!);
              continue; // Skip removing from queue since we moved it
            }
          }
        }
        
        // For COMMAND actions, we don't remove them from the queue until they complete
        // This happens in the command execution callback
        if (action.processed && (action.type !== 'COMMAND' || !this.pendingCommands.has(action.id!))) {
          this.queue.shift();
        }
      }
    } catch (error) {
      logError(`❌ Error processing action queue: ${error instanceof Error ? error.message : String(error)}`);
      logInfo(`🔍 Queue status: ${this.queue.length} remaining actions, ${this.pendingCommands.size} pending commands`);
    } finally {
      this.isProcessing = false;
      
      // Check if everything is complete
      this.checkIfComplete();
      
      // If pending commands exist, schedule check to resume processing
      if (this.hasPendingCommands()) {
        setTimeout(() => {
          if (!this.isProcessing && !this.paused && (this.queue.length > 0 || this.hasPendingCommands())) {
            this.startProcessing();
          }
        }, 1000);
      } else {
        // Log completion
        logInfo(`✓ Queue processing complete. Queue length: ${this.queue.length}`);
        
        // If new items were added during processing, start again
        if (this.queue.length > 0 && !this.paused) {
          this.startProcessing();
        }
      }
    }
  }

  /**
   * Process a single action
   * @returns True if processing was successful, false otherwise
   */
  private async processAction(action: QueuedAction): Promise<boolean> {
    try {
      // Create display identifier for action
      const actionIdentifier = action.path || action.content.substring(0, Math.min(30, action.content.length)) + (action.content.length > 30 ? '...' : '');
      
      // Log dequeuing
      logInfo(`📤 Dequeuing ${chalk.cyan(action.type)} action from queue: ${actionIdentifier}`);
      
      // Log execution start
      logInfo(`🔄 Executing ${chalk.cyan(action.type)} action: ${actionIdentifier}`);
      
      switch (action.type) {
        case 'COMMAND': {
          // Don't execute command if we already have pending commands
          if (this.hasPendingCommands()) {
            logInfo(`⏳ Deferring command execution until pending commands complete: ${actionIdentifier}`);
            return false;
          }

          // Mark command as pending
          this.pendingCommands.add(action.id!);
          
          try {
            // Execute command and wait for it to complete
            const commandResult = await executeCommand(this.projectDir, action.content, 20000, this.firestoreLogger);
            
            // Store command result in history with reference to original action
            this.commandHistory.push({
              ...commandResult,
              timestamp: Date.now(),
              actionId: action.id
            });
            
            // Log command completion with token speed
            if (commandResult.success) {
              logSuccess(`✅ Command completed successfully: ${actionIdentifier}`);
            } else {
              logError(`❌ Command failed: ${actionIdentifier}`);
            }
            
            // Add a 2-second delay after command execution to allow file system operations to settle
            logInfo(`⏱️ Adding 2-second delay after command execution`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Remove from pending commands
            this.pendingCommands.delete(action.id!);
            
            // Check if everything is complete
            this.checkIfComplete();
            
            return true;
          } catch (error) {
            logError(`❌ Error executing command: ${error instanceof Error ? error.message : String(error)}`);
            this.pendingCommands.delete(action.id!);
            
            // Check if everything is complete
            this.checkIfComplete();
            
            return false;
          }
        }
          
        case 'CREATE':
        case 'EDIT':
        case 'DELETE':
          if (!action.path) {
            logWarning(`Action ${action.type} requires a path but none was provided`);
            return false;
          }
          
          // Apply file change
          await applyFileChange(this.projectDir, action.type, action.path, action.content, this.firestoreLogger);
          break;
          
        case 'TEXT':
          // Handle TEXT action - display in terminal
          logSection('AI EXPLANATION', action.content, 'info');
          await this.firestoreLogger?.logAssistantMessage(action.content, 'llm_text');
          break;
          
        default:
          logWarning(`Unknown action type: ${action.type}`);
          return false;
      }
      
      // Log completion with no token speed
      logSuccess(`✅ Completed ${chalk.cyan(action.type)} action: ${actionIdentifier}`);
      
      // Check if everything is complete
      this.checkIfComplete();
      
      return true;
    } catch (error) {
      logError(`❌ Error processing ${action.type} action: ${error instanceof Error ? error.message : String(error)}`);
      return false; // Return false instead of re-throwing to allow queue to continue
    }
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    if (!this.paused) {
      logInfo(`⏸️ Queue processing paused`);
      this.paused = true;
    }
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    if (this.paused) {
      logInfo(`▶️ Queue processing resumed`);
      this.paused = false;
      if ((this.queue.length > 0 || this.hasPendingCommands()) && !this.isProcessing) {
        this.startProcessing();
      }
    }
  }

  /**
   * Get the current queue status
   */
  getStatus(): { queueLength: number; isProcessing: boolean; paused: boolean; pendingCommands: number; isComplete: boolean } {
    const isComplete = this.queue.length === 0 && !this.hasPendingCommands() && !this.isProcessing;
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      paused: this.paused,
      pendingCommands: this.pendingCommands.size,
      isComplete
    };
  }
} 