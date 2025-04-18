/**
 * Type definitions for Claude AI API interactions
 */

export interface ClaudeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ClaudeResponseStats {
  totalLength: number;
  actionCounts: {
    create: number;
    edit: number;
    delete: number;
    command: number;
    text: number;
  };
  generatedFilesCount: number;
}

export interface GeneratedFileTracker {
  [filePath: string]: string;
} 