/**
 * Test file for path utilities and race condition fixes
 * 
 * This test validates:
 * 1. Path resolution works correctly
 * 2. File operations are thread-safe without process.chdir()
 * 3. Security validations prevent path traversal
 * 4. Concurrent operations don't interfere with each other
 */
import fs from 'fs-extra';
import path from 'path';
import { 
  resolveProjectPath, 
  fileExistsInProject,
  readProjectFileAsync, 
  writeProjectFileAsync, 
  deleteProjectFileAsync 
} from '../utils/path-utils';
import { logInfo, logError, logSuccess, createHeader } from '../utils/logging';

// Test directories
const TEST_DIR = path.join(process.cwd(), 'temp', 'path-utils-test');
const TEST_DIRS = [
  path.join(TEST_DIR, 'project-A'),
  path.join(TEST_DIR, 'project-B'),
  path.join(TEST_DIR, 'project-C')
];

/**
 * Set up the test environment
 */
async function setupTestEnvironment() {
  logInfo('Setting up test environment...');
  
  // Ensure the test directory exists
  await fs.ensureDir(TEST_DIR);
  
  // Create test project directories
  for (const dir of TEST_DIRS) {
    await fs.ensureDir(dir);
    logInfo(`Created test directory: ${dir}`);
  }
}

/**
 * Clean up the test environment
 */
async function cleanupTestEnvironment() {
  logInfo('Cleaning up test environment...');
  
  try {
    // Remove the test directory and all contents
    if (await fs.pathExists(TEST_DIR)) {
      await fs.remove(TEST_DIR);
      logInfo(`Removed test directory: ${TEST_DIR}`);
    }
  } catch (error) {
    logError(`Error cleaning up: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Test path resolution
 */
function testPathResolution() {
  logInfo(createHeader('TESTING PATH RESOLUTION'));
  
  const testDir = TEST_DIRS[0];
  let passed = 0;
  let failed = 0;
  
  // Test simple path resolution
  try {
    const resolved = resolveProjectPath(testDir, 'file.txt');
    const expected = path.join(testDir, 'file.txt');
    
    if (resolved === expected) {
      logSuccess(`✓ Resolved: file.txt -> ${resolved}`);
      passed++;
    } else {
      logError(`✗ Resolution failed: file.txt -> ${resolved}, expected ${expected}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in path resolution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test subdirectory resolution
  try {
    const resolved = resolveProjectPath(testDir, 'dir/file.txt');
    const expected = path.join(testDir, 'dir/file.txt');
    
    if (resolved === expected) {
      logSuccess(`✓ Resolved: dir/file.txt -> ${resolved}`);
      passed++;
    } else {
      logError(`✗ Resolution failed: dir/file.txt -> ${resolved}, expected ${expected}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in path resolution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test leading dot-slash resolution
  try {
    const resolved = resolveProjectPath(testDir, './file.txt');
    const expected = path.join(testDir, 'file.txt');
    
    if (resolved === expected) {
      logSuccess(`✓ Resolved: ./file.txt -> ${resolved}`);
      passed++;
    } else {
      logError(`✗ Resolution failed: ./file.txt -> ${resolved}, expected ${expected}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in path resolution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test absolute path within project
  try {
    const absolute = path.join(testDir, 'file.txt');
    const resolved = resolveProjectPath(testDir, absolute);
    
    if (resolved === absolute) {
      logSuccess(`✓ Resolved: ${absolute} -> ${resolved}`);
      passed++;
    } else {
      logError(`✗ Resolution failed: ${absolute} -> ${resolved}, expected ${absolute}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in path resolution: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test path traversal prevention
  try {
    resolveProjectPath(testDir, '../forbidden.txt');
    logError('✗ Path traversal not prevented');
    failed++;
  } catch {
    logSuccess('✓ Path traversal correctly prevented');
    passed++;
  }
  
  // Test absolute path outside project
  try {
    resolveProjectPath(testDir, '/tmp/forbidden.txt');
    logError('✗ Absolute path outside project not prevented');
    failed++;
  } catch {
    logSuccess('✓ Absolute path outside project correctly prevented');
    passed++;
  }
  
  logInfo(`Path resolution tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Test file operations
 */
async function testFileOperations() {
  logInfo(createHeader('TESTING FILE OPERATIONS'));
  
  const testDir = TEST_DIRS[0];
  let passed = 0;
  let failed = 0;
  
  // Test file write and exists check
  try {
    await writeProjectFileAsync(testDir, 'test.txt', 'Hello, world!');
    if (await fileExistsInProject(testDir, 'test.txt')) {
      logSuccess('✓ File write and exists check passed');
      passed++;
    } else {
      logError('✗ File write failed - file does not exist');
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in file write test: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test nested directory creation
  try {
    await writeProjectFileAsync(testDir, 'nested/dir/test.txt', 'Nested file content');
    if (await fileExistsInProject(testDir, 'nested/dir/test.txt')) {
      logSuccess('✓ Nested directory creation passed');
      passed++;
    } else {
      logError('✗ Nested directory creation failed - file does not exist');
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in nested directory test: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test file read
  try {
    const content = await readProjectFileAsync(testDir, 'test.txt');
    if (content === 'Hello, world!') {
      logSuccess('✓ File read passed');
      passed++;
    } else {
      logError(`✗ File read failed - expected "Hello, world!", got "${content}"`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in file read test: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  // Test file delete
  try {
    await deleteProjectFileAsync(testDir, 'test.txt');
    if (!(await fileExistsInProject(testDir, 'test.txt'))) {
      logSuccess('✓ File delete passed');
      passed++;
    } else {
      logError('✗ File delete failed - file still exists');
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in file delete test: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  logInfo(`File operations tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Test concurrent file operations
 */
async function testConcurrentOperations() {
  logInfo(createHeader('TESTING CONCURRENT OPERATIONS'));
  
  const projectA = TEST_DIRS[0];
  const projectB = TEST_DIRS[1];
  const projectC = TEST_DIRS[2];
  
  let passed = 0;
  let failed = 0;
  
  // Create test files to start
  await writeProjectFileAsync(projectA, 'concurrent.txt', 'Project A');
  await writeProjectFileAsync(projectB, 'concurrent.txt', 'Project B');
  await writeProjectFileAsync(projectC, 'concurrent.txt', 'Project C');
  
  // Run concurrent operations
  const operationsA = async () => {
    try {
      for (let i = 0; i < 10; i++) {
        await writeProjectFileAsync(projectA, `file-${i}.txt`, `Content A-${i}`);
        await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
      }
      return { projectDir: projectA, success: true };
    } catch (error) {
      return { projectDir: projectA, success: false, error };
    }
  };
  
  const operationsB = async () => {
    try {
      for (let i = 0; i < 10; i++) {
        await writeProjectFileAsync(projectB, `file-${i}.txt`, `Content B-${i}`);
        await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
      }
      return { projectDir: projectB, success: true };
    } catch (error) {
      return { projectDir: projectB, success: false, error };
    }
  };
  
  const operationsC = async () => {
    try {
      for (let i = 0; i < 10; i++) {
        await writeProjectFileAsync(projectC, `file-${i}.txt`, `Content C-${i}`);
        await new Promise(resolve => setTimeout(resolve, 1)); // Small delay
      }
      return { projectDir: projectC, success: true };
    } catch (error) {
      return { projectDir: projectC, success: false, error };
    }
  };
  
  // Run all operations concurrently
  logInfo('Running concurrent file operations...');
  const results = await Promise.all([
    operationsA(),
    operationsB(),
    operationsC()
  ]);
  
  // Verify results
  for (const result of results) {
    if (result.success) {
      // Check that files were created with correct content
      let dirIntegrityPassed = true;
      for (let i = 0; i < 10; i++) {
        const projectId = result.projectDir.split('/').pop();
        const projectLetter = projectId?.split('-')[1];
        const expectedContent = `Content ${projectLetter}-${i}`;
        
        try {
          const actualContent = await readProjectFileAsync(result.projectDir, `file-${i}.txt`);
          if (actualContent !== expectedContent) {
            logError(`✗ Content mismatch in ${result.projectDir}/file-${i}.txt: Expected "${expectedContent}", got "${actualContent}"`);
            dirIntegrityPassed = false;
          }
        } catch (error) {
          logError(`✗ Error reading file in ${result.projectDir}: ${error instanceof Error ? error.message : String(error)}`);
          dirIntegrityPassed = false;
        }
      }
      
      if (dirIntegrityPassed) {
        logSuccess(`✓ Concurrent operations on ${result.projectDir} passed`);
        passed++;
      } else {
        logError(`✗ Concurrent operations on ${result.projectDir} failed - file integrity check failed`);
        failed++;
      }
    } else {
      logError(`✗ Concurrent operations on ${result.projectDir} failed: ${
        result.error instanceof Error ? result.error.message : String(result.error)
      }`);
      failed++;
    }
  }
  
  // Check that each project's concurrent.txt file has the right content (was not affected by other operations)
  try {
    const contentA = await readProjectFileAsync(projectA, 'concurrent.txt');
    const contentB = await readProjectFileAsync(projectB, 'concurrent.txt');
    const contentC = await readProjectFileAsync(projectC, 'concurrent.txt');
    
    if (contentA === 'Project A' && contentB === 'Project B' && contentC === 'Project C') {
      logSuccess('✓ Project isolation test passed - original files maintained integrity');
      passed++;
    } else {
      logError(`✗ Project isolation test failed - file contents were affected by concurrent operations:\n` +
        `  Project A: ${contentA}\n` +
        `  Project B: ${contentB}\n` +
        `  Project C: ${contentC}`);
      failed++;
    }
  } catch (error) {
    logError(`✗ Error in project isolation test: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  
  logInfo(`Concurrent operations tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Run all tests
 */
async function runTests() {
  try {
    await setupTestEnvironment();
    
    const pathResults = testPathResolution();
    const fileResults = await testFileOperations();
    const concurrentResults = await testConcurrentOperations();
    
    const totalPassed = pathResults.passed + fileResults.passed + concurrentResults.passed;
    const totalFailed = pathResults.failed + fileResults.failed + concurrentResults.failed;
    
    logInfo(createHeader('TEST SUMMARY'));
    logInfo(`Path Resolution: ${pathResults.passed} passed, ${pathResults.failed} failed`);
    logInfo(`File Operations: ${fileResults.passed} passed, ${fileResults.failed} failed`);
    logInfo(`Concurrent Operations: ${concurrentResults.passed} passed, ${concurrentResults.failed} failed`);
    logInfo(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
    
    if (totalFailed === 0) {
      logSuccess('All tests passed!');
    } else {
      logError(`${totalFailed} tests failed!`);
    }
  } finally {
    await cleanupTestEnvironment();
  }
}

// Run the tests
logInfo('Starting path utilities and race condition tests...');
runTests().catch(err => logError('Error in tests', err)); 