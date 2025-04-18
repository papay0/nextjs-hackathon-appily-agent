/**
 * Main code generation service using Claude API
 */
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { formatDuration, measureTime } from '../utils/timing';
import {
  logInfo,
  logSuccess,
  logWarning,
  logError,
  logSection,
  createHeader
} from '../utils/logging';
import { ProcessError } from '../types/api';
import { generateCode } from '../claude-client';
import { formatProjectForClaude, collectProjectFiles } from './project-formatter';
import { deployToR2 } from '../utils/cloudflare-r2-deploy';
import { ResponseProcessor } from '../utils/claude-response-processor';
import { GeneratedFileTracker } from '../types/claude';
import { RequestCostTracker } from '../utils/request-cost';
import { readProjectFileAsync } from '../utils/path-utils';
import { FirestoreLogger } from '../utils/firestore-logger';
import { UserPrompt } from '../types/user-prompt';

/**
 * Core code generation function implementing the retry logic
 * @param projectDir - Path to the project directory
 * @param newPrompt - The new prompt from the user
 * @param isFollowUp - Whether this is a follow-up request
 * @param existingConversation - Optional existing conversation history from previous requests
 * @param showRealTimeDisplay - Whether to show real-time display of file changes
 * @returns Object containing generation results
 */
export async function generateProjectCode(
  projectDir: string, 
  newPrompt: string,
  isFollowUp = false,
  existingConversation: Array<{ role: string; content: string; timestamp: Date; isFollowUp?: boolean }> = [],
  showRealTimeDisplay = true,
  modelKey: string,
  requestTracker: RequestCostTracker,
  firestoreLogger: FirestoreLogger
): Promise<{
  projectFiles: Record<string, string>;
  lintError: string | null;
  buildError: string | null;
  attempts: number;
  success: boolean;
  timings: Record<string, number>;
  generatedConversation?: {
    userPrompt: string;
    assistantResponse: string;
  };
  deployUrl?: string;
  hasActualLintErrors: boolean;
  responseProcessor: ResponseProcessor;
}> {
  const totalStart = performance.now();
  const timings: Record<string, number> = {};
  
  // Log the start of code generation
  firestoreLogger.info(`Starting ${isFollowUp ? 'follow-up' : 'initial'} code generation`);
  
  // Set up variables for retry loop
  const MAX_RETRIES = 5; // 0-based index, so this means 6 attempts total (initial + 5 retries)
  let retryCount = 0;
  let success = false;
  let lintError: string | null = null;
  let buildError: string | null = null;
  let hasActualLintErrors = false; // Flag to track if there are actual lint errors
  
  // Initialize generated files tracker for this request
  let generatedFiles: GeneratedFileTracker = {};
  
  // Convert existing conversation to UserPrompt objects
  const formattedExistingConversation = existingConversation.map(msg => {
    if (msg.role === 'user') {
      // For user messages, create a UserPrompt with follow-up status
      return new UserPrompt(msg.content, undefined, msg.isFollowUp);
    } else {
      // For assistant messages, create a UserPrompt with just the content
      return new UserPrompt(msg.content);
    }
  });
  
  // Create session conversation history for this request and its retries
  // Start with the current prompt as a UserPrompt object
  const sessionConversationHistory: UserPrompt[] = [
    new UserPrompt(newPrompt, undefined, isFollowUp)
  ];
  
  // Combine with existing conversation if there is one
  const combinedConversationHistory = [...formattedExistingConversation, ...sessionConversationHistory];
  
  // Store generated conversation for returning
  const generatedConversation = {
    userPrompt: newPrompt,
    assistantResponse: ''
  };
  
  // 1. Get initial project structure
  firestoreLogger.info(`Getting ${isFollowUp ? 'existing' : 'initial'} project structure`);
  let projectStructure = await measureTime(async () => 
    formatProjectForClaude(projectDir), 
    `Getting ${isFollowUp ? 'existing' : 'initial'} project structure`);
  
  // 2. Initial code generation
  logInfo(createHeader(`STEP: ${isFollowUp ? 'Follow-up' : 'Initial'} Code Generation`));
  firestoreLogger.info(`Starting ${isFollowUp ? 'follow-up' : 'initial'} code generation with AI model`);
  let claudeResponseData = await measureTime(async () => 
    generateCode(projectStructure, combinedConversationHistory, modelKey, generatedFiles, showRealTimeDisplay, requestTracker, projectDir, firestoreLogger),
    "Claude API request");
  
  // Extract response and update generated files
  let claudeResponse = claudeResponseData.response;
  generatedFiles = claudeResponseData.updatedGeneratedFiles;
  firestoreLogger.info(`Received AI model response with ${Object.keys(generatedFiles).length} files`);
  const responseProcessor = claudeResponseData.responseProcessor;
  
  // Add Claude's response to conversation as a UserPrompt
  sessionConversationHistory.push(new UserPrompt(claudeResponse));
  generatedConversation.assistantResponse = claudeResponse;
  timings.initialGeneration = Math.round(performance.now() - totalStart);
  
  // 3. Apply changes, check, and retry loop
  while (retryCount <= MAX_RETRIES) {
    const attemptStart = performance.now();
    logInfo(createHeader(`ATTEMPT ${retryCount + 1} of ${MAX_RETRIES + 1}`));
    
    // No need to reset the project during retries - we'll keep Claude's implementation
    // and just apply the fixes
    
    // For the first attempt, or if we have a new Claude response for retries
    if (claudeResponse) {
      // We're fully relying on the real-time action queue to process all operations
      // from Claude's response, which happens during the streaming response.
      // No need for sequential processing here anymore.
      
      // Just clear the response so we don't reprocess on next iteration
      claudeResponse = '';
    }
    
    // Wait for the action queue to complete all operations before continuing
    if (responseProcessor) {
      const actionQueue = responseProcessor.getActionQueue();
      if (actionQueue) {
        logInfo('⏳ Waiting for all queue operations to complete before linting and building...');
        await actionQueue.waitUntilComplete();
        logInfo('✅ All queue operations completed successfully');
      }
    }
    
    // Run linter with --fix and handle warnings differently from errors
    lintError = null;
    logInfo('Running linter with --fix...');
    firestoreLogger.info('Running linter with automatic fixes...');
    
    try {
      // Remove process.chdir and use cwd parameter directly
      
      try {
        const lintOutput = execSync('npm run lint:fix', { 
          cwd: projectDir, // Explicitly set working directory
          stdio: 'pipe', 
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024 // Increase buffer size to 10MB
        });
        
        // No errors detected since we didn't throw an exception
        hasActualLintErrors = false;
        lintError = '';
        
        // Show lint output for informational purposes only
        if (lintOutput.trim()) {
          logSuccess('✓ Linting completed with no errors');
          firestoreLogger.success('Linting completed with no errors');
          logSection('LINT OUTPUT', lintOutput, 'success');
        }
      } catch (lintExecError) {
        const typedError = lintExecError as ProcessError;
        
        // Linting failed - assume there are actual lint errors
        hasActualLintErrors = true;
        lintError = typedError.stdout || '';
        
        logError('❌ Linting failed');
        firestoreLogger.warning('Linting found issues that need to be fixed');
        
        // Show full lint output
        if (typedError.stdout) {
          logSection('LINT OUTPUT', typedError.stdout, 'error');
        }
        
        // If there's stderr, add it to the lint output
        if (typedError.stderr && typedError.stderr.trim()) {
          logSection('STDERR OUTPUT', typedError.stderr, 'error');
          if (lintError) {
            lintError += '\n\n' + typedError.stderr;
          } else {
            lintError = typedError.stderr;
          }
        }
      }
    } catch (error) {
      // This catch block will only trigger for non-ESLint errors (e.g. if npm run lint:fix fails to execute)
      console.error(error);
      
      // For execution errors, always consider it an actual error
      hasActualLintErrors = true;
      lintError = error instanceof Error ? error.message : String(error);
      
      // Capture detailed lint error output for Claude
      let detailedLintErrorOutput = "";
      if ((error as ProcessError).stdout) {
        const stdout = (error as ProcessError).stdout;
        detailedLintErrorOutput += `Lint output:\n${stdout}\n\n`;
      }
      if ((error as ProcessError).stderr) {
        detailedLintErrorOutput += `Lint error details:\n${(error as ProcessError).stderr}\n\n`;
      }
      
      // Store detailed lint errors for potential retries
      if (detailedLintErrorOutput) {
        lintError = detailedLintErrorOutput;
      }
    }
    
    // Try to build the project if linting succeeded
    buildError = null;
    logInfo(createHeader('STEP: Building Project'));
    logInfo('Building project...');
    firestoreLogger.info('Building project...');
    
    try {
      // Remove process.chdir and use cwd parameter directly
      
      try {
        const buildOutput = execSync('npm run build', { 
          cwd: projectDir, // Explicitly set working directory
          stdio: 'pipe', 
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024 // Increase buffer size to 10MB
        });
        
        logSuccess('✓ Build succeeded!');
        firestoreLogger.success('Build succeeded!');
        
        // Always save build output to pass to Claude
        buildError = buildOutput;
        
        logSection('BUILD OUTPUT', buildOutput, 'success');
        
        // If we get here, everything is good
        success = true;
        // Break out of the loop if successful
        break;
        
      } catch (buildExecError) {
        const typedError = buildExecError as ProcessError;
        logError('✗ Build failed');
        
        // Capture build output for error details
        let buildErrorDetails = '';
        
        if (typedError.stdout) {
          buildErrorDetails += typedError.stdout;
        }
        
        if (typedError.stderr) {
          buildErrorDetails += '\n' + typedError.stderr;
        }
        
        // Send detailed error to Firestore logger
        firestoreLogger.error('Build failed', { buildError: buildErrorDetails }); // Pass details
        
        // Capture both stdout and stderr for Claude
        buildError = '';
        
        if (typedError.stdout) {
          logSection('BUILD OUTPUT (stdout)', typedError.stdout, 'warning');
          buildError += `Build output:\n${typedError.stdout}\n\n`;
        }
        
        if (typedError.stderr) {
          logSection('BUILD ERRORS (stderr)', typedError.stderr, 'error');
          buildError += `Error details:\n${typedError.stderr}`;
        }
        
        throw typedError;
      }
      
    } catch (error) {
      // Store the error message
      buildError = error instanceof Error ? error.message : String(error);
      logError('Build error summary:', buildError);
      
      // Capture output for Claude from the error object
      if ((error as ProcessError).stdout) {
        buildError = `Build output:\n${(error as ProcessError).stdout}\n\n`;
      }
      if ((error as ProcessError).stderr) {
        buildError += `Error details:\n${(error as ProcessError).stderr}\n\n`;
      }
      
      // Check if we've reached the maximum retries
      if (retryCount < MAX_RETRIES) {
        // Increment retry count for the next attempt
        retryCount++;
        
        // Get updated project structure - now with Claude's current implementation
        projectStructure = await measureTime(async () => 
          formatProjectForClaude(projectDir), 
          "Getting updated project structure");
        
        // Combine lint and build errors for a comprehensive retry prompt
        let errorDetails = "";
        
        if (lintError) {
          errorDetails += `LINTING OUTPUT:\n${lintError}\n\n`;
        }
        
        if (buildError) {
          errorDetails += `BUILD OUTPUT:\n${buildError}\n\n`;
        }
        
        // Try to identify specific files with errors
        const filesWithErrors: Set<string> = new Set();
        
        // Extract filenames from error messages using regex
        const filePatterns = [
          /([a-zA-Z0-9_\-/.]+\.tsx?)\((\d+),(\d+)\)/g,  // TypeScript errors: file.ts(line,col)
          /([a-zA-Z0-9_\-/.]+\.tsx?):\s*line\s*(\d+)/g,  // ESLint errors: file.ts: line X
          /([a-zA-Z0-9_\-/.]+\.tsx?):(\d+):(\d+)/g,     // Other format: file.ts:line:col
          /Error in ([a-zA-Z0-9_\-/.]+\.tsx?)/g         // Generic: Error in file.ts
        ];
        
        for (const pattern of filePatterns) {
          const errorText = errorDetails;
          let match;
          while ((match = pattern.exec(errorText)) !== null) {
            filesWithErrors.add(match[1]);
          }
        }
        
        // Add file content for files with errors if they exist
        if (filesWithErrors.size > 0) {
          errorDetails += "\n\nCONTENT OF FILES WITH ERRORS:\n";
          
          for (const file of filesWithErrors) {
            try {
              const filePath = path.join(projectDir, file);
              if (fs.existsSync(filePath)) {
                const content = await readProjectFileAsync(projectDir, file);
                errorDetails += `\nFile: ${file}\n\`\`\`\n${content}\n\`\`\`\n`;
              }
            } catch {
              // Skip if we can't read the file
            }
          }
        }
        
        // Get command history from the ResponseProcessor's ActionQueue
        if (responseProcessor) {
          const actionQueue = responseProcessor.getActionQueue();
          if (actionQueue) {
            const commandHistory = actionQueue.getCommandHistory();
            if (commandHistory.length > 0) {
              errorDetails += "\n\nCOMMAND HISTORY:\n";
              for (const cmd of commandHistory) {
                errorDetails += `\nCommand: ${cmd.command}\nSuccess: ${cmd.success ? 'Yes' : 'No'}\n`;
                if (cmd.stdout && cmd.stdout.trim()) {
                  errorDetails += `Output:\n\`\`\`\n${cmd.stdout.trim()}\n\`\`\`\n`;
                }
                if (cmd.stderr && cmd.stderr.trim()) {
                  errorDetails += `Error output:\n\`\`\`\n${cmd.stderr.trim()}\n\`\`\`\n`;
                }
              }
            }
          }
        }
        
        // Create retry prompt with detailed error information
        const retryPromptText = `I need you to fix the following errors in the code you generated. This is retry attempt ${retryCount}/${MAX_RETRIES}. If all retry attempts fail, the system will abort your generation, so please focus on fixing these errors:\n\n${errorDetails}`;
        const retryPrompt = new UserPrompt(retryPromptText, undefined, true);
        
        // Add our retry request to the conversation history
        sessionConversationHistory.push(retryPrompt);
        
        logInfo(createHeader(`STEP: Retry #${retryCount} Code Generation`));
        firestoreLogger.info(`Starting retry attempt ${retryCount} of ${MAX_RETRIES}`);
        claudeResponseData = await measureTime(async () => 
          generateCode(projectStructure, [...formattedExistingConversation, ...sessionConversationHistory], modelKey, generatedFiles, showRealTimeDisplay, requestTracker, projectDir, firestoreLogger),
          "Claude API request for retry");
        
        // Extract response and update generated files
        claudeResponse = claudeResponseData.response;
        generatedFiles = claudeResponseData.updatedGeneratedFiles;
        
        // Add Claude's response to conversation as a UserPrompt
        sessionConversationHistory.push(new UserPrompt(claudeResponse));
        
        // Update the generated conversation with the latest retry
        generatedConversation.assistantResponse = claudeResponse;
      } else {
        // If we've reached the max retries, we're done with attempts
        break;
      }
    }
    
    timings[`attempt${retryCount}`] = Math.round(performance.now() - attemptStart);
    
    // If successful, we'll have broken out of the loop earlier
    // If we've reached the maximum retries, we'll have broken out after the final attempt
  }
  
  // Collect the final project files
  logInfo(createHeader('STEP: Collecting Results'));
  firestoreLogger.info('Collecting final project files');
  
  // Deploy to R2 if build was successful
  let deployUrl: string | undefined;
  if (success) {
    // Ensure any remaining queue operations are complete before deploying
    if (responseProcessor) {
      const actionQueue = responseProcessor.getActionQueue();
      if (actionQueue) {
        logInfo('⏳ Ensuring all queue operations are complete before deploying...');
        await actionQueue.waitUntilComplete();
        logInfo('✅ Queue is empty, proceeding with deployment');
      }
    }
    
    logInfo(createHeader('STEP: Deploying to Cloudflare R2'));
    firestoreLogger.info('Deploying project to Cloudflare R2');
    deployUrl = await measureTime(async () => {
      // Extract project ID from path if available
      const projectId = path.basename(projectDir);
      const url = await deployToR2(projectDir, projectId);
      if (url.startsWith('Not deployed:')) {
        logWarning(`R2 deployment: ${url}`);
      } else {
        logSuccess(`Project deployed to: ${url}`);
        firestoreLogger.success(`Project deployed to: ${url}`);
      }
      return url;
    }, "Deploying to Cloudflare R2");
    timings.deployToR2 = Math.round(performance.now() - (totalStart + timings.total));
  }
  
  // Calculate total time
  const totalDuration = Math.round(performance.now() - totalStart);
  logSuccess(`Total execution time: [${formatDuration(totalDuration)}]`);
  firestoreLogger.info(`Total execution time: ${formatDuration(totalDuration)}`);
  timings.total = totalDuration;
  
  // Save final result and update status (moved outside the loop)
  const finalProjectFiles = await collectProjectFiles(projectDir);
  const generationResultData = { // Renamed to avoid conflict before removing property
    projectFiles: finalProjectFiles,
    lintError,
    buildError,
    attempts: retryCount + 1,
    success,
    timings: { ...timings, total: Math.round(performance.now() - totalStart) },
    generatedConversation,
    deployUrl,
    hasActualLintErrors
    // Removed responseProcessor from the object to be saved
  };

  if (success) {
    firestoreLogger.end('Code generation completed successfully.', generationResultData); // Pass data without processor
  } else {
    // Error should have already been logged and status updated by logger.error
    // Just save the (failed) result here
    await firestoreLogger.saveResult(generationResultData); // Pass data without processor
  }

  // Return the full result including the processor for internal use if needed by caller
  return {
    ...generationResultData, // Spread the data that was saved
    responseProcessor // Add the processor back for the return value only
  };
} 