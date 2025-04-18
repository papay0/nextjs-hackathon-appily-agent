/**
 * Test file for command execution without process.chdir
 * 
 * This test validates that:
 * 1. Commands execute correctly using cwd parameter instead of process.chdir
 * 2. Concurrent commands in different directories don't interfere with each other
 * 3. Command output is correctly captured
 */
import * as path from 'path';
import fs from 'fs-extra';
import { executeCommand } from '../services/file-operation-service';
import { logInfo, logError, logSuccess, createHeader } from '../utils/logging';

// Test configuration
const TEST_ROOT = path.resolve(__dirname, '../../temp/command-test');
const TEST_DIRS = [
  path.join(TEST_ROOT, 'project-A'),
  path.join(TEST_ROOT, 'project-B')
];

/**
 * Setup test environment
 */
async function setupTestEnvironment() {
  logInfo('Setting up test environment...');
  
  // Create test root if it doesn't exist
  await fs.ensureDir(TEST_ROOT);
  
  // Create test project directories
  for (const dir of TEST_DIRS) {
    await fs.ensureDir(dir);
    logInfo(`Created test directory: ${dir}`);
    
    // Create a package.json with test scripts in each directory
    const packageJson = {
      name: `test-${path.basename(dir)}`,
      version: "1.0.0",
      scripts: {
        "test-pwd": "pwd",
        "test-echo": "echo Hello from $(basename $(pwd))",
        "test-write": "echo Test file content > test-output.txt"
      }
    };
    
    await fs.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    
    logInfo(`Created package.json in ${dir}`);
  }
}

/**
 * Clean up test environment
 */
async function cleanupTestEnvironment() {
  logInfo('Cleaning up test environment...');
  
  // Remove test root and all contents
  if (fs.existsSync(TEST_ROOT)) {
    await fs.remove(TEST_ROOT);
    logInfo(`Removed test directory: ${TEST_ROOT}`);
  }
}

/**
 * Test basic command execution
 */
async function testBasicCommandExecution() {
  logInfo(createHeader('TESTING BASIC COMMAND EXECUTION'));
  
  const testDir = TEST_DIRS[0];
  let passed = 0;
  let failed = 0;
  
  // Test simple npm script execution with pwd command
  try {
    const result = await executeCommand(testDir, 'npm run test-pwd');
    
    if (result.success) {
      logSuccess('✓ Command executed successfully');
      passed++;
      
      // Check that the output contains the correct directory
      if (result.stdout.includes(testDir)) {
        logSuccess(`✓ Command output shows correct directory: ${result.stdout.trim()}`);
        passed++;
      } else {
        logError(`✗ Command output doesn't show correct directory. Expected to include ${testDir}, got: ${result.stdout.trim()}`);
        failed++;
      }
    } else {
      logError(`✗ Command execution failed: ${result.stderr}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error during command execution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test echo command to verify shell execution
  try {
    const result = await executeCommand(testDir, 'npm run test-echo');
    
    if (result.success) {
      logSuccess('✓ Echo command executed successfully');
      passed++;
      
      // Check that the output contains correct project name
      const expectedOutput = `Hello from ${path.basename(testDir)}`;
      if (result.stdout.includes(expectedOutput)) {
        logSuccess(`✓ Echo command output is correct: ${result.stdout.trim()}`);
        passed++;
      } else {
        logError(`✗ Echo command output is incorrect. Expected to include "${expectedOutput}", got: ${result.stdout.trim()}`);
        failed++;
      }
    } else {
      logError(`✗ Echo command execution failed: ${result.stderr}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error during echo command execution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test file creation via command
  try {
    const result = await executeCommand(testDir, 'npm run test-write');
    
    if (result.success) {
      logSuccess('✓ Write command executed successfully');
      passed++;
      
      // Check that the file was created in the correct directory
      const outputFile = path.join(testDir, 'test-output.txt');
      if (fs.existsSync(outputFile)) {
        const content = fs.readFileSync(outputFile, 'utf8');
        if (content.includes('Test file content')) {
          logSuccess(`✓ File was created with correct content in the correct directory`);
          passed++;
        } else {
          logError(`✗ File was created but content is incorrect. Expected "Test file content", got: ${content}`);
          failed++;
        }
      } else {
        logError(`✗ File was not created in the expected directory: ${outputFile}`);
        failed++;
      }
    } else {
      logError(`✗ Write command execution failed: ${result.stderr}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error during write command execution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  logInfo(`Basic command execution tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Test concurrent command execution
 */
async function testConcurrentCommandExecution() {
  logInfo(createHeader('TESTING CONCURRENT COMMAND EXECUTION'));
  
  const projectA = TEST_DIRS[0];
  const projectB = TEST_DIRS[1];
  
  let passed = 0;
  let failed = 0;
  
  // Run concurrent commands that write to files in different directories
  logInfo('Running concurrent commands in different directories...');
  
  const commandA = async () => {
    return executeCommand(projectA, 'echo "Project A content" > concurrent-test.txt');
  };
  
  const commandB = async () => {
    return executeCommand(projectB, 'echo "Project B content" > concurrent-test.txt');
  };
  
  try {
    // Execute commands concurrently
    const [resultA, resultB] = await Promise.all([commandA(), commandB()]);
    
    // Verify both commands succeeded
    if (resultA.success && resultB.success) {
      logSuccess('✓ Both concurrent commands executed successfully');
      passed++;
      
      // Verify file contents in both directories
      const fileA = path.join(projectA, 'concurrent-test.txt');
      const fileB = path.join(projectB, 'concurrent-test.txt');
      
      if (fs.existsSync(fileA) && fs.existsSync(fileB)) {
        const contentA = fs.readFileSync(fileA, 'utf8').trim();
        const contentB = fs.readFileSync(fileB, 'utf8').trim();
        
        if (contentA === 'Project A content' && contentB === 'Project B content') {
          logSuccess('✓ Concurrent commands created files with correct content in respective directories');
          passed++;
        } else {
          logError(`✗ File content mismatch:\n  - Project A: ${contentA} (expected "Project A content")\n  - Project B: ${contentB} (expected "Project B content")`);
          failed++;
        }
      } else {
        if (!fs.existsSync(fileA)) {
          logError(`✗ File not created in Project A: ${fileA}`);
          failed++;
        }
        if (!fs.existsSync(fileB)) {
          logError(`✗ File not created in Project B: ${fileB}`);
          failed++;
        }
      }
    } else {
      if (!resultA.success) {
        logError(`✗ Command in Project A failed: ${resultA.stderr}`);
        failed++;
      }
      if (!resultB.success) {
        logError(`✗ Command in Project B failed: ${resultB.stderr}`);
        failed++;
      }
    }
  } catch (error) {
    logError(`✗ Error during concurrent command execution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test many concurrent commands
  logInfo('Running multiple concurrent commands...');
  
  const commands = [];
  const numCommands = 5;
  
  for (let i = 0; i < numCommands; i++) {
    commands.push(executeCommand(projectA, `echo "Concurrent A-${i}" > concurrent-A-${i}.txt`));
    commands.push(executeCommand(projectB, `echo "Concurrent B-${i}" > concurrent-B-${i}.txt`));
  }
  
  try {
    const results = await Promise.all(commands);
    
    // Check if all commands succeeded
    const allSucceeded = results.every(result => result.success);
    
    if (allSucceeded) {
      logSuccess(`✓ All ${commands.length} concurrent commands executed successfully`);
      passed++;
      
      // Verify all files were created with correct content
      let filesCorrect = true;
      
      for (let i = 0; i < numCommands; i++) {
        const fileA = path.join(projectA, `concurrent-A-${i}.txt`);
        const fileB = path.join(projectB, `concurrent-B-${i}.txt`);
        
        if (!fs.existsSync(fileA)) {
          logError(`✗ File not created in Project A: concurrent-A-${i}.txt`);
          filesCorrect = false;
        } else {
          const contentA = fs.readFileSync(fileA, 'utf8').trim();
          if (contentA !== `Concurrent A-${i}`) {
            logError(`✗ File content mismatch in Project A: concurrent-A-${i}.txt\n  Expected: "Concurrent A-${i}"\n  Got: "${contentA}"`);
            filesCorrect = false;
          }
        }
        
        if (!fs.existsSync(fileB)) {
          logError(`✗ File not created in Project B: concurrent-B-${i}.txt`);
          filesCorrect = false;
        } else {
          const contentB = fs.readFileSync(fileB, 'utf8').trim();
          if (contentB !== `Concurrent B-${i}`) {
            logError(`✗ File content mismatch in Project B: concurrent-B-${i}.txt\n  Expected: "Concurrent B-${i}"\n  Got: "${contentB}"`);
            filesCorrect = false;
          }
        }
      }
      
      if (filesCorrect) {
        logSuccess(`✓ All ${numCommands * 2} files created with correct content in respective directories`);
        passed++;
      } else {
        logError(`✗ Some files are missing or have incorrect content`);
        failed++;
      }
    } else {
      const failedCount = results.filter(result => !result.success).length;
      logError(`✗ ${failedCount} of ${commands.length} commands failed`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error during multiple concurrent command execution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  logInfo(`Concurrent command execution tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await setupTestEnvironment();
    
    const basicResults = await testBasicCommandExecution();
    const concurrentResults = await testConcurrentCommandExecution();
    
    const totalPassed = basicResults.passed + concurrentResults.passed;
    const totalFailed = basicResults.failed + concurrentResults.failed;
    
    logInfo(createHeader('TEST SUMMARY'));
    logInfo(`Basic Command Execution: ${basicResults.passed} passed, ${basicResults.failed} failed`);
    logInfo(`Concurrent Command Execution: ${concurrentResults.passed} passed, ${concurrentResults.failed} failed`);
    logInfo(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
    
    if (totalFailed === 0) {
      logSuccess('All command execution tests passed!');
    } else {
      logError(`${totalFailed} command execution tests failed!`);
    }
  } finally {
    await cleanupTestEnvironment();
  }
}

// Run all tests (this will only actually run when the file is executed directly)
if (require.main === module) {
  logInfo('Starting command execution tests...');
  runTests().catch(err => logError('Error in tests', err));
} else {
  // When imported, export the test functions
  module.exports = {
    runTests,
    testBasicCommandExecution,
    testConcurrentCommandExecution
  };
} 