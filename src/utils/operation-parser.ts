/**
 * Utilities for parsing operations from Claude's response
 */
import { logInfo, logWarning, logSuccess } from './logging';
import { Operation } from '../types/file-operations';
import chalk from 'chalk';
import { ActionType } from './action-queue';

/**
 * Parse tag-based operations from Claude's response
 * @param claudeResponse - Response from Claude
 * @returns Array of operations
 */
export function parseTagBasedOperations(claudeResponse: string): Operation[] {
  const operations: Operation[] = [];
  logInfo('Parsing operations from Claude response...');
  
  // Define regex patterns to match action tags
  const actionRegex = /<action type="([^"]+)"(?:\s+path="([^"]+)")?>([\s\S]*?)<\/action>/g;
  
  // Find all action tags using regex
  let match;
  while ((match = actionRegex.exec(claudeResponse)) !== null) {
    const type = match[1].toUpperCase() as ActionType;
    const path = match[2] || '';
    const content = match[3].trim();
    
    // Check if this operation was already added
    const isDuplicate = operations.some(op => 
      op.type === type && op.path === path && op.content.substring(0, 50) === content.substring(0, 50)
    );
    
    if (!isDuplicate) {
      operations.push({
        type,
        path,
        content
      });
    } else {
      logWarning(`⚠️ Skipping duplicate operation for ${path}`);
    }
  }
  
  logSuccess(chalk.green(`Parsing complete: Found ${operations.length} operations`));
  
  return operations;
} 