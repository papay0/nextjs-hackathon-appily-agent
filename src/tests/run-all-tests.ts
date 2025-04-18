/**
 * Run all tests sequentially
 * 
 * This script runs all the test files one after another
 * and reports the overall results.
 */
import { logInfo, logSuccess, logError, createHeader } from '../utils/logging';
import fs from 'fs-extra';
import path from 'path';
import { performance } from 'perf_hooks';

// Import all the test modules
import('./test-path-utils');
import('./test-command-execution');
import('./test-request-cost');
import('./test-timing');

/**
 * Run a test file
 * @param testFile - Path to the test file
 */
async function runTestFile(testFile: string): Promise<void> {
  const testPath = path.resolve(__dirname, testFile);
  
  if (!fs.existsSync(testPath)) {
    logError(`Test file not found: ${testPath}`);
    return;
  }
  
  try {
    logInfo(createHeader(`RUNNING TEST: ${path.basename(testFile)}`));
    const testModule = await import(testPath);
    
    // If the module has a runTests function, run it
    if (typeof testModule.runTests === 'function') {
      await testModule.runTests();
    } else {
      // Otherwise, just execute the module
      logInfo(`Test file ${testFile} has no runTests function. Executing as script.`);
    }
  } catch (error) {
    logError(`Error running test ${testFile}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run all tests
 */
async function runAllTests(): Promise<void> {
  const startTime = performance.now();
  
  logInfo(createHeader('STARTING ALL TESTS'));
  
  // Identify all test files
  const testFiles = fs.readdirSync(__dirname)
    .filter(file => file.startsWith('test-') && file.endsWith('.ts') && file !== 'test-utils.ts')
    .map(file => `./${file}`);
  
  logInfo(`Found ${testFiles.length} test files to run:`);
  testFiles.forEach(file => logInfo(`- ${file}`));
  
  // Run each test file
  for (const testFile of testFiles) {
    await runTestFile(testFile);
  }
  
  // Log summary
  const duration = Math.round(performance.now() - startTime);
  logInfo(createHeader('TEST SUMMARY'));
  logSuccess(`Completed all ${testFiles.length} test files in ${Math.round(duration / 1000)} seconds`);
}

// Run all tests when this script is executed directly
if (require.main === module) {
  logInfo('Starting all tests...');
  runAllTests().catch(err => logError('Error in test runner', err));
} 