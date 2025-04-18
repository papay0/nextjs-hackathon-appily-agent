/**
 * Logging utilities
 */
import chalk from 'chalk';
import { formatDuration } from './timing';

/**
 * Create a styled header with a title
 * @param title - Title text
 * @returns Formatted header
 */
export function createHeader(title: string): string {
  return `\n${chalk.bgBlue.white(' ' + title + ' ')}\n${chalk.blue('='.repeat(title.length + 4))}\n`;
}

/**
 * Log an action with a highlighted background based on the action type
 * @param actionType - Type of action (CREATE, EDIT, DELETE, COMMAND, TEXT)
 * @param message - Message to log
 */
export function logAction(actionType: string, message: string): void {
  let background;
  let emoji;
  
  switch (actionType.toUpperCase()) {
    case 'COMMAND':
      background = chalk.bgMagenta.white;
      emoji = '🔄';
      break;
    case 'CREATE':
      background = chalk.bgGreen.white;
      emoji = '➕';
      break;
    case 'EDIT':
      background = chalk.bgBlue.white;
      emoji = '✏️';
      break;
    case 'DELETE':
      background = chalk.bgRed.white;
      emoji = '🗑️';
      break;
    case 'TEXT':
      background = chalk.bgCyan.white;
      emoji = '📝';
      break;
    default:
      background = chalk.bgGray.white;
      emoji = 'ℹ️';
  }
  
  console.log(`${emoji} ${background(` ${actionType} `)} ${message}`);
}

/**
 * Create a colored section with content
 * @param title - Section title
 * @param content - Section content
 * @param type - Type of section (info, success, warning, error)
 */
export function logSection(title: string, content: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  // Choose color based on type
  const colorFn = 
    type === 'success' ? chalk.green :
    type === 'warning' ? chalk.yellow :
    type === 'error' ? chalk.red :
    chalk.cyan;
  
  // Log section header
  console.log(`\n${colorFn('====')} ${colorFn.bold(title)} ${colorFn('====')}`);
  
  // Log content
  console.log(content);
  
  // Log section footer
  console.log(`${colorFn('==================================')}\n`);
}

/**
 * Log an info message
 * @param message - Message to log
 * @param data - Optional data to log
 */
export function logInfo(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(chalk.cyan('ℹ'), message, data);
  } else {
    console.log(chalk.cyan('ℹ'), message);
  }
}

/**
 * Log a success message
 * @param message - Message to log
 * @param data - Optional data to log
 */
export function logSuccess(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(chalk.green('✓'), message, data);
  } else {
    console.log(chalk.green('✓'), message);
  }
}

/**
 * Log a warning message
 * @param message - Message to log
 * @param data - Optional data to log
 */
export function logWarning(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(chalk.yellow('⚠'), message, data);
  } else {
    console.log(chalk.yellow('⚠'), message);
  }
}

/**
 * Log an error message
 * @param message - Message to log
 * @param data - Optional data to log
 */
export function logError(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.log(chalk.red('✗'), message, data);
  } else {
    console.log(chalk.red('✗'), message);
  }
}

/**
 * Log a summary of code generation
 */
export function logGenerationSummary(
  success: boolean, 
  attempts: number, 
  lintError: string | null, 
  buildError: string | null,
  fileCount: number,
  totalDuration: number,
  inputTokens: number,
  outputTokens: number,
  hasActualLintErrors: boolean = false
): void {
  logInfo(createHeader('GENERATION SUMMARY'));
  
  // Overall status
  if (success) {
    logSuccess('✓ Success');
  } else {
    logError('✗ Failed');
  }
  
  // Attempts
  logInfo(`Attempts: ${chalk.cyan(attempts)}`);
  
  // Files generated
  logInfo(`Files generated/modified: ${chalk.cyan(fileCount)}`);
  
  // Errors and warnings
  if (lintError) {
    if (hasActualLintErrors) {
      logWarning(`Lint warnings: ${chalk.yellow('Yes')}`);
    } else {
      logInfo(`Lint output: ${chalk.cyan('Available (probably just warnings)')}`);
    }
  } else {
    logSuccess(`Lint output: ${chalk.green('None')}`);
  }
  
  if (buildError) {
    if (!success) {
      logError(`Build errors: ${chalk.red('Yes')}`);
    } else {
      logInfo(`Build output: ${chalk.cyan('Available (successful)')}`);
    }
  } else {
    logSuccess(`Build output: ${chalk.green('None')}`);
  }
  
  // Duration
  logInfo(`Total duration: ${chalk.cyan(formatDuration(totalDuration))}`);
  
  // Token usage
  logInfo(`Input tokens: ${chalk.magenta(inputTokens)}`);
  logInfo(`Output tokens: ${chalk.magenta(outputTokens)}`);
  logInfo(`Total tokens: ${chalk.magenta(inputTokens + outputTokens)}`);
  
  logInfo(chalk.blue('='.repeat(50)));
} 