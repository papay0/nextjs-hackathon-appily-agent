/**
 * Type definitions for file operations
 */

import { ActionType } from '../utils/action-queue';

export interface Operation {
  type: ActionType;
  path: string;
  content: string;
}

export interface OperationTrackers {
  created: string[];
  edited: string[];
  deleted: string[];
  commands: string[];
  texts: string[];
} 