/**
 * Code tracking for Firebase
 * 
 * This utility allows tracking code files in Firebase in real-time,
 * enabling streaming updates to the frontend as files are created or edited.
 */
import * as admin from 'firebase-admin';
import { getFirestore } from '../config/firebase-admin-config';
import { logInfo, logError } from './logging';
import path from 'path';

// File status
export type CodeFileStatus = 'streaming' | 'complete';

// Language metadata for syntax highlighting
export interface CodeFile {
  path: string;           // File path (e.g. app/home/page.tsx)
  content: string;        // File content
  language: string;       // Language for syntax highlighting
  status: CodeFileStatus; // streaming or complete
  operation: 'create' | 'edit';
  timestamp: string;      // ISO timestamp
  createdAt?: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

/**
 * Detect language for syntax highlighting based on file extension
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  
  // Map common extensions to languages
  const extensionMap: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.md': 'markdown',
    '.py': 'python',
    '.rb': 'ruby',
    '.java': 'java',
    '.go': 'go',
    '.rs': 'rust',
    '.php': 'php',
    '.c': 'c',
    '.cpp': 'cpp',
    '.cs': 'csharp',
    '.swift': 'swift',
    '.sh': 'shell',
    '.bash': 'bash',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.toml': 'toml',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.vue': 'vue',
    '.svelte': 'svelte',
  };
  
  return extensionMap[ext] || 'plaintext';
}

/**
 * Class for code file tracking in Firebase
 */
export class CodeTracker {
  private projectId: string;
  private db: admin.firestore.Firestore | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  /**
   * Ensure Firestore connection is initialized
   */
  private async ensureFirestore(): Promise<admin.firestore.Firestore> {
    if (!this.db) {
      this.db = await getFirestore();
      if (!this.db) {
        throw new Error('Failed to initialize Firestore for code tracking');
      }
    }
    return this.db;
  }

  /**
   * Create a safe ID for Firestore document
   */
  private getSafeId(filePath: string): string {
    // Replace characters that are invalid in Firestore IDs
    return filePath.replace(/[/.]/g, '_');
  }

  /**
   * Start tracking a code file with 'streaming' status
   * 
   * @param filePath - File path
   * @param operation - Operation type (create or edit)
   */
  async startFileTracking(filePath: string, operation: 'create' | 'edit'): Promise<void> {
    try {
      const db = await this.ensureFirestore();
      const safeId = this.getSafeId(filePath);
      
      // Create the code file object
      const codeFile: CodeFile = {
        path: filePath,
        content: '', // Initially empty, will be updated with content later
        language: detectLanguage(filePath),
        status: 'streaming',
        operation,
        timestamp: new Date().toISOString(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      // Add to the codefiles subcollection
      await db.collection(`projects/${this.projectId}/codefiles`).doc(safeId).set(codeFile);
      
      logInfo(`Started tracking ${operation} for file: ${filePath}`);
    } catch (error) {
      logError(`Error tracking file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Update file content during streaming
   * 
   * @param filePath - File path
   * @param content - Current content
   */
  async updateFileContent(filePath: string, content: string): Promise<void> {
    try {
      const db = await this.ensureFirestore();
      const safeId = this.getSafeId(filePath);
      
      // Update only the content field
      await db.collection(`projects/${this.projectId}/codefiles`).doc(safeId).update({
        content,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
    } catch (error) {
      logError(`Error updating file content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Complete file tracking by updating status to 'complete'
   * 
   * @param filePath - File path
   * @param finalContent - Final file content
   */
  async completeFileTracking(filePath: string, finalContent: string): Promise<void> {
    try {
      const db = await this.ensureFirestore();
      const safeId = this.getSafeId(filePath);
      
      // Update the file status and final content
      await db.collection(`projects/${this.projectId}/codefiles`).doc(safeId).update({
        content: finalContent,
        status: 'complete',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      logInfo(`Completed tracking for file: ${filePath}`);
    } catch (error) {
      logError(`Error completing file tracking: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} 