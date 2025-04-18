/**
 * File Management Module
 * 
 * This module handles all file system operations for the code generation service.
 * It provides:
 * 
 * 1. File Operations:
 *    - Creates new files
 *    - Updates existing files
 *    - Deletes files
 *    - Manages file permissions
 * 
 * 2. Project Structure Management:
 *    - Processes Claude's file change instructions
 *    - Maintains project directory structure
 *    - Handles file path resolution
 * 
 * 3. Command Execution:
 *    - Runs npm/yarn commands
 *    - Manages command timeouts
 *    - Handles command output and errors
 * 
 * 4. Operation Tracking:
 *    - Logs all file changes
 *    - Tracks operation success/failure
 *    - Provides detailed operation summaries
 * 
 * The module implements robust error handling and provides detailed
 * logging for debugging and monitoring purposes.
 */

import { logSuccess, logError, logInfo, logSection } from './utils/logging';
import { parseTagBasedOperations } from './utils/operation-parser';
import { executeOperationsSequentially } from './services/file-operation-service';
import { OperationTrackers } from './types/file-operations';
import chalk from 'chalk';
import { formatDuration } from './utils/timing';

// Re-export resetProject for backward compatibility
export { resetProject } from './services/project-reset-service';

/**
 * Process code changes and commands from Claude's response in sequential order
 * @param projectDir - Project directory path
 * @param claudeResponse - Response from Claude
 * @returns Set of modified file paths
 */
export async function processCodeChanges(projectDir: string, claudeResponse: string): Promise<Set<string>> {
  logInfo('Processing code changes...');

  try {
    // Parse all operations from the response
    const startParse = performance.now();
    const operations = parseTagBasedOperations(claudeResponse);
    const parseDuration = Math.round(performance.now() - startParse);
    logSuccess(chalk.green(`Operations parsed successfully [${formatDuration(parseDuration)}]`));
    
    // Log detailed operations summary for debugging
    logSection('OPERATIONS SUMMARY', operations.map((op, index) => {
      if (op.type === 'COMMAND') {
        return chalk.magenta(`[${index}] ${op.type}: ${op.content.substring(0, 50)}${op.content.length > 50 ? '...' : ''}`);
      } else if (op.type === 'CREATE') {
        return chalk.green(`[${index}] ${op.type}: ${op.path}`);
      } else if (op.type === 'EDIT') {
        return chalk.blue(`[${index}] ${op.type}: ${op.path}`);
      } else if (op.type === 'DELETE') {
        return chalk.red(`[${index}] ${op.type}: ${op.path}`);
      } else if (op.type === 'TEXT') {
        return chalk.cyan(`[${index}] ${op.type}: ${op.content.substring(0, 50)}${op.content.length > 50 ? '...' : ''}`);
      } else {
        return `[${index}] ${op.type}: ${op.path}`;
      }
    }).join('\n'));
    
    // Execute operations sequentially
    logInfo(chalk.cyan('Executing operations...'));
    const startExecute = performance.now();
    const trackers: OperationTrackers = {
      created: [],
      edited: [],
      deleted: [],
      commands: [],
      texts: []
    };
    
    const modifiedFiles = await executeOperationsSequentially(projectDir, operations, trackers);
    const executeDuration = Math.round(performance.now() - startExecute);
    logSuccess(chalk.green(`Operations executed successfully [${formatDuration(executeDuration)}]`));
    
    // Print summary of changes with colors
    logSection('Summary of Changes', [
      trackers.created.length ? chalk.green(`Created files: ${trackers.created.join(', ')}`) : '',
      trackers.edited.length ? chalk.blue(`Edited files: ${trackers.edited.join(', ')}`) : '',
      trackers.deleted.length ? chalk.yellow(`Deleted files: ${trackers.deleted.join(', ')}`) : '',
      trackers.commands.length ? chalk.magenta(`Executed commands: ${trackers.commands.join(', ')}`) : '',
      trackers.texts.length ? chalk.cyan(`AI explanations: ${trackers.texts.length}`) : '',
      chalk.green(`Modified ${modifiedFiles.size} files: ${Array.from(modifiedFiles).join(', ')}`)
    ].filter(Boolean).join('\n'));
    
    const totalDuration = Math.round(performance.now() - startParse);
    logSuccess(`Total processing time [${formatDuration(totalDuration)}]`);
    
    return modifiedFiles;
  } catch (error) {
    logError(chalk.red('Error processing changes:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    throw new Error(`Failed to process changes: ${error instanceof Error ? error.message : String(error)}`);
  }
}