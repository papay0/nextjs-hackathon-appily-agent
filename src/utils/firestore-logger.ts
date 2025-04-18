/**
 * FirestoreLogger - A utility for sending log messages to Firestore
 * 
 * This logger works alongside StreamLogger to provide persistence for logs.
 * It maintains the same interface as StreamLogger for consistent usage.
 */
import * as admin from 'firebase-admin';
import { getFirestore } from '../config/firebase-admin-config';
import { logInfo, logSuccess, logWarning, logError } from './logging';
import { CodeTracker } from './code-tracker';

// Define LogLevel and LogData locally if they were from stream-logger
type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'debug';
type LogData = Record<string, unknown>; // Changed from any to unknown

// Define LogMessage structure used internally
interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO string format
  data?: LogData;
}

// Define ChatMessage structure for Firestore chat logs
type ChatSender = 'human' | 'assistant';
interface BaseChatMessage {
  sender: ChatSender;
  content: string;
  timestamp: string; // ISO string format
}

interface HumanChatMessage extends BaseChatMessage {
  sender: 'human';
}

// Define assistant message types
export type AssistantMessageType = 
  | 'status_update' 
  | 'llm_text' 
  | 'follow_up' 
  | 'initial_prompt'; // Added for the initial user prompt

interface AssistantChatMessage extends BaseChatMessage {
  sender: 'assistant';
  type: AssistantMessageType;
}

type ChatMessage = HumanChatMessage | AssistantChatMessage;

/**
 * Service for logging messages to Firestore
 */
export class FirestoreLogger {
  private projectId: string;
  private logToConsole: boolean;
  private logPrefix: string;
  private db: admin.firestore.Firestore | null = null;
  private codeTracker: CodeTracker;

  /**
   * Create a new FirestoreLogger instance
   * 
   * @param projectId - Project ID to associate logs with
   * @param logToConsole - Whether to also log messages to the console (default: true)
   * @param logPrefix - Optional prefix for console logs to identify the source
   */
  constructor(projectId: string, logToConsole = true, logPrefix = '') {
    // Validate projectId
    if (!projectId) {
      throw new Error('clientProjectId cannot be null or undefined');
    }

    this.projectId = projectId;
    this.logToConsole = logToConsole;
    this.logPrefix = logPrefix ? `[${logPrefix}] ` : '';
    this.codeTracker = new CodeTracker(projectId);
  }

  /**
   * Initializes the project document in Firestore.
   * Creates the document or updates the status if it already exists.
   * Ensures the document exists before proceeding.
   */
  async initialize(): Promise<void> {
    try {
      this.db = await getFirestore();
      if (!this.db) {
        throw new Error('Firestore is not initialized or accessible.');
      }

      // Set/Update project document with merge: true
      // This creates if not exists, updates status if exists, preserving other fields.
      const projectRef = this.db.collection('projects').doc(this.projectId);
      
      // First check if document exists
      const doc = await projectRef.get();
      
      if (!doc.exists) {
        // If document doesn't exist, create it with an empty codeFiles array
        await projectRef.set({
          status: 'running',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // If document exists, just update status and timestamp
        await projectRef.update({
          status: 'running',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
      
      logInfo(`FirestoreLogger initialized and project ${this.projectId} status set to running.`);

    } catch (error) {
      logError(`Error initializing project ${this.projectId} in Firestore:`, error);
      // Rethrow the error so the caller can handle it (e.g., return 500 to client)
      throw error;
    }
  }

  /**
   * Send a log message to Firestore
   * 
   * @param level - Log level (info, success, warning, error, debug)
   * @param message - The message to log
   * @param data - Optional data to include with the log
   */
  private async log(level: LogLevel, message: string, data?: LogData): Promise<void> {
    // Create the log message object
    const logMessage: LogMessage = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(data !== undefined && { data })
    };

    // Log to console if enabled
    if (this.logToConsole) {
      const consoleMessage = `${this.logPrefix}${message}`;
      
      switch (level) {
        case 'info':
          logInfo(consoleMessage, data);
          break;
        case 'success':
          logSuccess(consoleMessage, data);
          break;
        case 'warning':
          logWarning(consoleMessage, data);
          break;
        case 'error':
          logError(consoleMessage, data);
          break;
        case 'debug':
          // Use regular console.log for debug messages
          console.log(`🔍 DEBUG: ${consoleMessage}`, data !== undefined ? data : '');
          break;
      }
    }

    // Save to Firestore
    try {
      if (!this.db) {
        this.db = await getFirestore();
        if (!this.db) {
          console.error('Firestore is not initialized');
          return;
        }
      }

      // Write to logs collection
      await this.db.collection(`projects/${this.projectId}/logs`).add({
        ...logMessage,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Update project timestamp
      await this.db.doc(`projects/${this.projectId}`).update({
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error writing log to Firestore:', error);
    }
  }

  /**
   * Log an informational message
   * 
   * @param message - The message to log
   * @param data - Optional data to include
   */
  async info(message: string, data?: LogData): Promise<void> {
    await this.log('info', message, data);
  }

  /**
   * Log a success message
   * 
   * @param message - The message to log
   * @param data - Optional data to include
   */
  async success(message: string, data?: LogData): Promise<void> {
    await this.log('success', message, data);
  }

  /**
   * Log a warning message
   * 
   * @param message - The message to log
   * @param data - Optional data to include
   */
  async warning(message: string, data?: LogData): Promise<void> {
    await this.log('warning', message, data);
  }

  /**
   * Log an error message
   * 
   * @param message - The message to log
   * @param data - Optional data to include
   */
  async error(message: string, data?: LogData): Promise<void> {
    await this.log('error', message, data);
    
    // Update project status to error
    await this.updateProjectStatus('error');
  }

  /**
   * Log a debug message (only visible in development)
   * 
   * @param message - The message to log
   * @param data - Optional data to include
   */
  async debug(message: string, data?: LogData): Promise<void> {
    await this.log('debug', message, data);
  }

  /**
   * Send a progress update to the client
   * 
   * @param step - Current step number
   * @param totalSteps - Total number of steps
   * @param message - Description of the current step
   */
  async progress(step: number, totalSteps: number, message: string): Promise<void> {
    await this.log('info', message, { progress: { step, totalSteps } });
  }

  /**
   * Log a file creation operation
   * 
   * @param filePath - Path to the file being created
   * @param message - Optional message about the operation
   */
  async fileCreated(filePath: string, message?: string): Promise<void> {
    await this.log('info', message || `Created file: ${filePath}`, {
      file: {
        filePath,
        operation: 'create'
      }
    });
  }

  /**
   * Log a file creation operation with code tracking
   * 
   * @param filePath - Path to the file being created
   * @param fullPath - Absolute path to the file
   * @param content - Content of the file
   * @param message - Optional message about the operation
   */
  async fileCreatedWithCode(filePath: string, fullPath: string, content: string, message?: string): Promise<void> {
    // First log the file operation as usual
    await this.log('info', message || `Created file: ${filePath}`, {
      file: {
        filePath,
        operation: 'create'
      }
    });
    
    // No need to track the code file here - we'll use the new streaming API instead
  }

  /**
   * Log a file edit operation
   * 
   * @param filePath - Path to the file being edited
   * @param message - Optional message about the operation
   */
  async fileEdited(filePath: string, message?: string): Promise<void> {
    await this.log('info', message || `Edited file: ${filePath}`, {
      file: {
        filePath,
        operation: 'edit'
      }
    });
  }

  /**
   * Log a file edit operation with code tracking
   * 
   * @param filePath - Path to the file being edited
   * @param fullPath - Absolute path to the file
   * @param content - Content of the file
   * @param message - Optional message about the operation
   */
  async fileEditedWithCode(filePath: string, fullPath: string, content: string, message?: string): Promise<void> {
    // First log the file operation as usual
    await this.log('info', message || `Edited file: ${filePath}`, {
      file: {
        filePath,
        operation: 'edit'
      }
    });
    
    // No need to track the code file here - we'll use the new streaming API instead
  }

  /**
   * Log a file deletion operation
   * 
   * @param filePath - Path to the file being deleted
   * @param message - Optional message about the operation
   */
  async fileDeleted(filePath: string, message?: string): Promise<void> {
    await this.log('info', message || `Deleted file: ${filePath}`, {
      file: {
        filePath,
        operation: 'delete'
      }
    });
  }

  /**
   * Log a command execution
   * 
   * @param command - The command being executed
   * @param cwd - Optional working directory
   * @param message - Optional message about the command
   */
  async commandExecuted(command: string, cwd?: string, message?: string): Promise<void> {
    await this.log('info', message || 'Executing command', {
      command: {
        command,
        cwd
      }
    });
  }

  /**
   * End the logging session with an optional final message
   * 
   * @param message - Optional final message
   * @param result - Optional result data to store
   */
  async end(message?: string, result?: Record<string, unknown>): Promise<void> {
    if (message) {
      await this.success(message);
    }
    
    // Update project status to complete
    await this.updateProjectStatus('complete');
    
    // Save final result if provided
    if (result) {
      await this.saveResult(result);
    }
  }
  
  /**
   * Update the project status in Firestore
   * 
   * @param status - New status value
   */
  private async updateProjectStatus(status: 'pending' | 'running' | 'complete' | 'error'): Promise<void> {
    try {
      if (!this.db) {
        this.db = await getFirestore();
        if (!this.db) {
          console.error('Firestore is not initialized');
          return;
        }
      }
      
      await this.db.doc(`projects/${this.projectId}`).update({
        status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating project status in Firestore:', error);
    }
  }
  
  /**
   * Save the final result to Firestore
   * 
   * @param result - Result data to store
   */
  async saveResult(result: Record<string, unknown>): Promise<void> {
    try {
      if (!this.db) {
        this.db = await getFirestore();
        if (!this.db) {
          console.error('Firestore is not initialized');
          return;
        }
      }
      
      await this.db.doc(`projects/${this.projectId}/result/data`).set(result, { merge: true });
    } catch (error) {
      console.error('Error saving result to Firestore:', error);
    }
  }

  // --- Chat Logging Methods ---

  /**
   * Logs a chat message (human or assistant) to Firestore.
   * Internal method to handle writing to the 'chat' subcollection.
   * 
   * @param messageData - The chat message object to log.
   */
  private async _logChatMessage(messageData: Omit<HumanChatMessage, 'timestamp'> | Omit<AssistantChatMessage, 'timestamp'>): Promise<void> {
    // Explicitly type chatMessage based on sender - helps TS discriminate the union
    const chatMessage: ChatMessage = {
      ...messageData,
      timestamp: new Date().toISOString(),
    };

    try {
      if (!this.db) {
        this.db = await getFirestore();
        if (!this.db) {
          console.error('Firestore is not initialized for chat logging');
          return;
        }
      }

      // Write to chat subcollection
      await this.db.collection(`projects/${this.projectId}/chat`).add({
        ...chatMessage,
        createdAt: admin.firestore.FieldValue.serverTimestamp() // Use server timestamp for ordering
      });

      // Update project timestamp (indicates activity)
      await this.db.doc(`projects/${this.projectId}`).update({
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

    } catch (error) {
      // Use the main logger's error handling if available, otherwise console
      const errorMessage = `Error writing chat message to Firestore for project ${this.projectId}:`;
      if (this.logToConsole) {
        logError(errorMessage, error);
      } else {
        console.error(errorMessage, error);
      }
      // Decide if we should rethrow or handle differently based on desired behavior
    }
  }

  /**
   * Logs a message from the human user.
   * 
   * @param message - The user's message content.
   */
  async logHumanMessage(message: string): Promise<void> {
    await this._logChatMessage({
      sender: 'human',
      content: message,
    });
  }
  
  /**
   * Logs the initial user prompt that started the process.
   * Stored as an assistant message of type 'initial_prompt'.
   * 
   * @param prompt - The initial user prompt.
   */
  async logInitialPrompt(prompt: string): Promise<void> {
    await this.logAssistantMessage(prompt, 'initial_prompt');
  }

  /**
   * Logs a message from the AI assistant.
   * 
   * @param message - The assistant's message content.
   * @param type - The type of assistant message (e.g., 'status_update', 'llm_text').
   */
  async logAssistantMessage(message: string, type: AssistantMessageType): Promise<void> {
    await this._logChatMessage({
      sender: 'assistant',
      content: message,
      type: type,
    });

    // Additionally, log status updates to the regular log stream if desired
    if (type === 'status_update' && this.logToConsole) {
        logInfo(`${this.logPrefix}${message}`); // Use existing console logger
    }
  }

  /**
   * Get the project ID for this logger
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Start tracking a code file
   * 
   * @param path - File path
   * @param operation - Operation type (create or edit)
   */
  async startCodeTracking(path: string, operation: 'create' | 'edit'): Promise<void> {
    await this.codeTracker.startFileTracking(path, operation);
  }

  /**
   * Update content for a tracked code file
   * 
   * @param path - File path
   * @param content - Current content
   */
  async updateCodeContent(path: string, content: string): Promise<void> {
    await this.codeTracker.updateFileContent(path, content);
  }

  /**
   * Complete tracking for a code file
   * 
   * @param path - File path
   * @param finalContent - Final content
   */
  async completeCodeTracking(path: string, finalContent: string): Promise<void> {
    await this.codeTracker.completeFileTracking(path, finalContent);
  }
}
