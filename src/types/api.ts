/* eslint-disable no-unused-vars */
/**
 * Type definitions for the code generation API
 */

/**
 * Represents a single message in the conversation history
 */
export interface ConversationMessage {
  /** The role of the message sender (user or assistant) */
  role: 'user' | 'assistant';
  /** The content of the message */
  content: string;
  /** Timestamp when the message was created */
  timestamp: Date;
  /** Whether this was a follow-up to an existing project */
  isFollowUp?: boolean;
}

/**
 * Request structure for the code generation API
 */
export interface GenerateRequest {
  /** The new prompt to send to Claude */
  newPrompt: string;
  /** Required client-generated UUID for the project */
  clientProjectId: string;
  /** Optional flag to control cleanup of temporary files */
  cleanup?: boolean;
  /** Optional model key to specify which AI model to use */
  modelKey?: string;
  /** Optional flag to control whether to enhance the prompt */
  enhancePrompt?: boolean;
}

/**
 * Authentication information attached to requests
 */
export interface AuthInfo {
  /** Firebase user ID extracted from verified token */
  userId: string;
}

/**
 * Project storage status
 */
export enum ProjectStatus {
  INITIALIZING = 'initializing',
  GENERATING = 'generating',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

/**
 * Project entry in storage
 */
export interface ProjectEntry {
  /** Unique identifier for the project */
  id: string;
  /** Path to the project directory (local) */
  directory?: string;
  /** When the project was created */
  createdAt: Date;
  /** When the project was last accessed */
  lastAccessedAt: Date;
  /** Complete conversation history for the project */
  conversationHistory: ConversationMessage[];
  /** The user ID of the project owner */
  ownerId?: string;
  /** The current status of the project */
  status?: ProjectStatus;
  /** Summary description of the project */
  projectSummary?: string;
}

/**
 * Detailed summary of the generation process results and metadata.
 */
export interface GenerationSummary {
  /** Whether all checks passed successfully */
  success: boolean;
  /** Number of attempts made to generate valid code */
  attempts: number;
  /** Linting errors if any occurred */
  lintError?: string | null;
  /** Build errors if any occurred */
  buildError?: string | null;
  /** Number of project files generated or modified */
  fileCount: number;
  /** Total duration of the entire generation process in milliseconds */
  totalDurationMs: number;
  /** Total number of input tokens used */
  inputTokens: number;
  /** Total number of output tokens generated */
  outputTokens: number;
  /** Calculated cost for input tokens */
  inputCost: number;
  /** Calculated cost for output tokens */
  outputCost: number;
  /** Total calculated cost for the request */
  totalCost: number;
  /** The AI model key used for generation */
  modelKey: string;
  /** Whether there were actual lint warnings/errors (vs just output) */
  hasActualLintErrors?: boolean;
  /** Timing information for each major step in the process */
  timings: Record<string, number>;
  /** Output tokens per second */
  outputTokensPerSecond: number;
}

/**
 * Response structure from the code generation API
 */
export interface GenerateResponse {
  /** Dictionary of project files with paths as keys and contents as values */
  // projectFiles: Record<string, string>;
  /** Path to the generated project directory if not cleaned up */
  projectDir?: string;
  /** Unique ID for the project to use in follow-up requests */
  projectId: string;
  /** The conversation history for this project */
  // conversationHistory?: ConversationMessage[];
  /** URL of the deployed project on Cloudflare R2 */
  deployUrl?: string;
  /** Detailed summary of the generation process */
  generationSummary: GenerationSummary;
}

/**
 * Extended Error type for process errors with stdout/stderr
 */
export interface ProcessError extends Error {
  /** Standard output from the process */
  stdout?: string;
  /** Standard error from the process */
  stderr?: string;
} 