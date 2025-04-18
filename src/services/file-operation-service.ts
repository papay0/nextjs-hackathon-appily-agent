/**
 * Service for executing file operations (create, edit, delete, command)
 */
import fs from 'fs-extra';
import path from 'path';
import execa from 'execa';
import chalk from 'chalk';
import { Operation, OperationTrackers } from '../types/file-operations';
import { logSuccess, logError, logWarning, logInfo, logSection, logAction } from '../utils/logging';
import { formatDuration } from '../utils/timing';
import { ActionType } from '../utils/action-queue';
import { createPatch } from 'diff';
import { FirestoreLogger } from '../utils/firestore-logger';
import { resolveProjectPath, readProjectFileAsync, writeProjectFileAsync, deleteProjectFileAsync, fileExistsInProject } from '../utils/path-utils';

// Threshold for considering a file as "meaningfully changed" (percentage of lines)
const MEANINGFUL_CHANGE_THRESHOLD = 0.01; // 1% of lines changed

/**
 * Generate a colored diff between two strings
 * @param filePath - Path to the file being compared
 * @param oldContent - Original content
 * @param newContent - New content
 * @param showFullDiff - Whether to show the full diff or just a summary
 * @returns Object with the colorized diff and stats
 */
function generateColoredDiff(
  filePath: string, 
  oldContent: string, 
  newContent: string,
  showFullDiff = true
): { 
  diff: string, 
  linesChanged: number, 
  totalLines: number, 
  percentChanged: number,
  hasChanges: boolean
} {
  // Generate the unified diff
  const patchText = createPatch(
    filePath,
    oldContent,
    newContent,
    'Original',
    'Modified'
  );

  // Split into lines
  const lines = patchText.split('\n');

  // Count the changed lines (starting with + or -)
  const addedLines = lines.filter((line: string) => line.startsWith('+')).length;
  const removedLines = lines.filter((line: string) => line.startsWith('-')).length;
  // We don't count the +++ and --- header lines
  const linesChanged = addedLines + removedLines - 2;
  
  // Total lines in the original file
  const totalLines = oldContent.split('\n').length;
  
  // Calculate percentage of change
  const percentChanged = totalLines > 0 ? (linesChanged / (totalLines * 2)) * 100 : 0;
  
  // Check if there's any real change
  const hasChanges = oldContent !== newContent;

  // Colorize the diff
  let coloredDiff = lines.map((line: string) => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return chalk.green(line);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return chalk.red(line);
    } else if (line.startsWith('@')) {
      return chalk.cyan(line);
    }
    return chalk.gray(line);
  }).join('\n');

  // Truncate diff if not showing full
  if (!showFullDiff && lines.length > 15) {
    const firstLines = lines.slice(0, 7);
    const lastLines = lines.slice(-7);
    
    coloredDiff = [
      ...firstLines.map((line: string) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return chalk.green(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          return chalk.red(line);
        } else if (line.startsWith('@')) {
          return chalk.cyan(line);
        }
        return chalk.gray(line);
      }),
      chalk.yellow(`\n... ${lines.length - 14} more lines ...\n`),
      ...lastLines.map((line: string) => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return chalk.green(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          return chalk.red(line);
        } else if (line.startsWith('@')) {
          return chalk.cyan(line);
        }
        return chalk.gray(line);
      })
    ].join('\n');
  }
  
  return {
    diff: coloredDiff,
    linesChanged,
    totalLines,
    percentChanged,
    hasChanges
  };
}

/**
 * Execute operations sequentially
 * @param projectDir - Project directory to operate in
 * @param operations - Array of operations to execute
 * @param trackers - Trackers for different operation types
 * @returns A set of all modified file paths
 */
export async function executeOperationsSequentially(
  projectDir: string,
  operations: Operation[],
  trackers: OperationTrackers
): Promise<Set<string>> {
  const modifiedFiles = new Set<string>();
  
  try {
    logInfo(`Starting operations execution...`);
    
    for (let i = 0; i < operations.length; i++) {
      const operation = operations[i];
      
      // Log current operation to show progress
      logAction(operation.type, `Processing operation ${i+1}/${operations.length}${operation.path ? ': ' + operation.path : ''}`);
      
      if (operation.type === 'COMMAND') {
        // Execute command and store result for potential error handling
        const commandResult = await executeCommand(projectDir, operation.content);
        trackers.commands.push(`${operation.content.substring(0, 50)}${operation.content.length > 50 ? '...' : ''} (${commandResult.success ? 'succeeded' : 'failed'})`);
      } else if (operation.type === 'TEXT') {
        // Display text section
        logSection('AI EXPLANATION', operation.content, 'info');
        trackers.texts.push(operation.content.substring(0, 50) + (operation.content.length > 50 ? '...' : ''));
      } else {
        // Apply file change
        const fileStart = performance.now();
        
        // Apply the file change 
        await applyFileChange(projectDir, operation.type, operation.path, operation.content);
        
        const fileDuration = Math.round(performance.now() - fileStart);
        
        if (operation.path) {
          if (operation.type === 'CREATE') {
            logAction('CREATE', `Created file: ${operation.path} [${formatDuration(fileDuration)}]`);
          } else if (operation.type === 'EDIT') {
            logAction('EDIT', `Edited file: ${operation.path} [${formatDuration(fileDuration)}]`);
          } else if (operation.type === 'DELETE') {
            logAction('DELETE', `Deleted file: ${operation.path} [${formatDuration(fileDuration)}]`);
          } else {
            logAction(operation.type, `${operation.path} [${formatDuration(fileDuration)}]`);
          }
          
          modifiedFiles.add(operation.path);
          
          // Track operation by type
          if (operation.type === 'CREATE') {
            trackers.created.push(operation.path);
          } else if (operation.type === 'EDIT') {
            trackers.edited.push(operation.path);
          } else if (operation.type === 'DELETE') {
            trackers.deleted.push(operation.path);
          }
        }
      }
    }
    
    logSuccess(`All operations completed successfully`);
    return modifiedFiles;
  } catch (error) {
    logError(`Error executing operation: ${error instanceof Error ? error.message : String(error)}`);
    throw error; // Rethrow to stop execution
  }
}

/**
 * Execute a command
 * @param projectDir - Project directory
 * @param command - Command to execute
 * @param timeoutMs - Timeout in milliseconds (default: 20 seconds)
 * @returns Object containing command output and status
 */
export async function executeCommand(projectDir: string, command: string, timeoutMs = 20000, firestoreLogger?: FirestoreLogger): Promise<{
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
}> {
  // Log start of command execution
  // Clean the command string by replacing multiple newlines with a single space
  let cleanedCommand = command.trim().replace(/\s*\n+\s*/g, ' ');
  
  // Check for duplicated commands (common with AI-generated commands)
  if (cleanedCommand.length > 20) {
    // First check for exact duplication (same command repeated twice)
    const halfLength = Math.floor(cleanedCommand.length / 2);
    const firstHalf = cleanedCommand.substring(0, halfLength);
    const secondHalf = cleanedCommand.substring(halfLength);
    
    // If the second half starts with the same content as the first half
    if (secondHalf.startsWith(firstHalf.substring(0, Math.min(20, firstHalf.length)))) {
      cleanedCommand = firstHalf.trim();
    } else {
      // Check for common patterns in AI-generated commands
      // Look for repeated npm/npx commands
      const npmMatch = cleanedCommand.match(/(npm\s+(install|run)|npx\s+[\w@.-]+)\s+([\w\s@.-]+)(\s+\1\s+\3)/i);
      if (npmMatch) {
        // Found a duplication, fix it by removing the second occurrence
        cleanedCommand = cleanedCommand.replace(npmMatch[4], '');
      }
      
      // Look for repeated shadcn commands specifically
      const shadcnMatch = cleanedCommand.match(/(npx\s+shadcn@latest\s+add\s+--yes\s+--overwrite\s+--path=[\w/.-]+)(\s+[\w\s-]+)(\s+\1)/i);
      if (shadcnMatch) {
        // Found a shadcn duplication, fix it
        cleanedCommand = shadcnMatch[1] + shadcnMatch[2];
      }
    }
  }
  logAction('COMMAND', `Started running: ${cleanedCommand} in directory: ${projectDir}`);
  firestoreLogger?.commandExecuted(cleanedCommand, projectDir);
  
  try {
    
    // Split the command into command and args
    const parts = cleanedCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    
    // Create a buffer to collect command output
    let outputBuffer = '';
    let stderrBuffer = '';
    
    // Execute command with stdout/stderr streaming (but collect for final display)
    const subprocess = execa(cmd, args, {
      cwd: projectDir,
      timeout: timeoutMs,
      stdio: ['inherit', 'pipe', 'pipe'], // Capture stdout and stderr but inherit stdin
      shell: true,
      maxBuffer: 10 * 1024 * 1024 // Increase buffer size to 10MB
    });
    
    // Stream stdout but collect it for later display
    if (subprocess.stdout) {
      subprocess.stdout.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
      });
    }
    
    // Stream stderr but collect it
    if (subprocess.stderr) {
      subprocess.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderrBuffer += chunk;
      });
    }
    
    // Wait for the command to complete
    await subprocess;
    
    // Log success with emoji and include output
    logAction('COMMAND', `Executed successfully: ${cleanedCommand}`);
    firestoreLogger?.success(`Command executed successfully: ${cleanedCommand}`);
    
    // Display the output below the success message
    if (outputBuffer.trim()) {
      logInfo(chalk.gray(outputBuffer.trim()));
    }
    
    // Always log stderr if it exists and wasn't empty
    if (stderrBuffer.trim()) {
      logWarning(`Command had stderr output (${stderrBuffer.split('\n').length} lines):`);
      logWarning(chalk.yellow(stderrBuffer.trim()));
    }
    
    return {
      success: true,
      command: cleanedCommand,
      stdout: outputBuffer,
      stderr: stderrBuffer
    };
    
  } catch (error) {
    // Log failure
    logAction('COMMAND', `Execution failed: ${command.trim()}`);
    
    let stdout = '';
    let stderr = '';
    
    // Log any error output from the command
    if (error instanceof Error && 'stdout' in error) {
      stdout = error.stdout as string || '';
      if (stdout && stdout.trim()) {
        logWarning(`Command output (${stdout.split('\n').length} lines):`);
        logInfo(chalk.gray(stdout.trim()));
      }
    }
    
    if (error instanceof Error && 'stderr' in error) {
      stderr = error.stderr as string || '';
      if (stderr && stderr.trim()) {
        logError(`Command error output (${stderr.split('\n').length} lines):`);
        logError(chalk.red(stderr.trim()));
      }
    }
    
    logError(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
    
    return {
      success: false,
      command: cleanedCommand,
      stdout,
      stderr: stderr || (error instanceof Error ? error.message : String(error))
    };
  }
}

/**
 * Apply a single file change
 * @param projectDir - Project directory
 * @param action - Action type (CREATE, EDIT, DELETE)
 * @param filePath - Relative file path
 * @param content - File content
 * @param firestoreLogger - Optional FirestoreLogger for client-side updates
 */
export async function applyFileChange(
  projectDir: string, 
  action: ActionType, 
  filePath: string, 
  content: string,
  firestoreLogger?: FirestoreLogger
): Promise<void> {
  // Clean up filePath if it contains additional text
  filePath = filePath.replace(/^[^a-zA-Z0-9/._-]+/, '').trim();
  
  // Construct absolute file path using our safe path utility
  const fullPath = resolveProjectPath(projectDir, filePath);
  
  try {
    switch (action) {
      case 'CREATE': {
        // Ensure directory exists
        await fs.ensureDir(path.dirname(fullPath));
        
        // Log file creation
        if (firestoreLogger) {
          await firestoreLogger.fileCreated(filePath);
        }
        
        // Write file using our async utility function
        await writeProjectFileAsync(projectDir, filePath, content);
        logAction('CREATE', `Created: ${filePath}`);
        logSection('CONTENT', content, 'success');
        
        break;
      }
        
      case 'EDIT': {
        // Ensure directory exists
        await fs.ensureDir(path.dirname(fullPath));
        
        // Check if file exists
        let oldContent = '';
        try {
          if (await fileExistsInProject(projectDir, filePath)) {
            oldContent = await readProjectFileAsync(projectDir, filePath);
          }
        } catch (error) {
          logWarning(`Could not read existing file ${filePath} for comparison: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Generate diff to check if there are meaningful changes
        const diffInfo = generateColoredDiff(filePath, oldContent, content);
        
        // Check if there are actual changes
        if (!diffInfo.hasChanges) {
          logWarning(`⚠️  No meaningful changes detected for ${filePath}, skipping write.`);
          
          // Skip writing the file if it's identical
          return;
        }
        
        // Check if changes are meaningful (above threshold)
        if (diffInfo.percentChanged < MEANINGFUL_CHANGE_THRESHOLD) {
          logWarning(`⚠️ ${chalk.yellow('MINIMAL EDIT')}: Changes to ${filePath} are minimal (${diffInfo.percentChanged.toFixed(2)}% of file changed). Consider checking if this edit was necessary.`);
        }
        
        // Show the diff in console
        logSection('DIFF', diffInfo.diff, 'info');
        
        // Log file edit
        if (firestoreLogger) {
          await firestoreLogger.fileEdited(filePath);
        }
        
        // Write the file using our async utility function
        await writeProjectFileAsync(projectDir, filePath, content);
        logAction('EDIT', `Edited: ${filePath}`);
        
        break;
      }
        
      case 'DELETE': {
        // Check if file exists before deleting
        if (await fileExistsInProject(projectDir, filePath)) {
          logAction('DELETE', `Deleting: ${filePath}`);
          if (firestoreLogger) {
            await firestoreLogger.fileDeleted(filePath);
          }
          await deleteProjectFileAsync(projectDir, filePath);
        } else {
          logWarning(`File does not exist: ${filePath}`);
        }
        break;
      }
        
      default: {
        logWarning(`Unknown action type: ${action}`);
      }
    }
  } catch (error) {
    logError(`Error applying ${action} to ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
} 