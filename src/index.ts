/**
 * Main API entry point for the code generation service.
 * 
 * This file implements an Express.js server that provides a /generate endpoint
 * for automated code generation using Claude AI.
 */
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs-extra';
import path from 'path';
import { GenerateRequest } from './types/api';
import { createNextProject } from './project-manager';
import { measureTime } from './utils/timing';
import { createHeader, logSuccess, logError, logGenerationSummary, logInfo } from './utils/logging';
import { generateProjectCode } from './services/code-generation';
import { getCurrentModelKey, initializeAIModel } from './services/ai-model-service';
import { streamText } from 'ai';
import { RequestCostTracker } from './utils/request-cost';
import { resolveProjectPath } from './utils/path-utils';
import { FirestoreLogger } from './utils/firestore-logger';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { getEnhancedPrompt } from './utils/prompt/enhance-and-generate';
import { OpenRouterService } from './services/open-router-service';
import { getSystemMessage } from './utils/prompt/claude-system-message';
import { formatMessagesForOpenRouter } from './services/claude-api-service';
import { ProjectStorageService } from './services/project-storage-service-new';
import { DualFileStorage } from './services/storage/file-storage';

// Parse command line arguments
const args = process.argv.slice(2);
const showRealTimeDisplay = !args.includes('--no-realtime');

// Initialize Express app
const app = express();

// Configure CORS - place this before other middleware
// Define allowed origins based on environment
const productionOrigins = ['https://appily.dev', 'https://www.appily.dev'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Always allow production domains
    if (productionOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Always allow localhost for development and testing
    if (origin && (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:'))) {
      return callback(null, true);
    }
    
    // Log rejected origins in production for monitoring
    if (process.env.NODE_ENV === 'production') {
      console.warn(`CORS rejected origin: ${origin}`);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization'],
  credentials: true // Include if you need to support cookies/auth
}));

// Add explicit CORS handling for streaming endpoint
app.options('/generate', cors());
app.options('*', cors());

app.use(bodyParser.json({ limit: '50mb' }));

/**
 * Format an enhanced prompt using the data received from the frontend
 * This function takes pre-processed data from the frontend and formats it
 * into a structured prompt for the AI model
 * 
 * @param originalPrompt - Original user prompt
 * @param projectSummary - Concise project description
 * @param features - Array of selected features
 * @returns A structured prompt string combining the original prompt with enhanced data
 */
function formatEnhancedPromptFromData(
  originalPrompt: string,
  projectSummary?: string,
  features?: string[]
): string {
  // Start with the original prompt
  let formattedPrompt = `Original request: ${originalPrompt}\n\n`;

  // Add project summary if provided
  if (projectSummary) {
    formattedPrompt += `Project summary: ${projectSummary}\n\n`;
  }

  // Add selected features if available
  if (features && features.length > 0) {
    formattedPrompt += "Selected features:\n";
    features.forEach((feature, index) => {
      formattedPrompt += `${index + 1}. ${feature}\n`;
    });
  }

  // Add clear instructions for the AI model
  formattedPrompt += `\nPlease build the application described above, implementing all the selected features.`;

  return formattedPrompt;
}

/**
 * Check if the given directory contains a Next.js project
 * @param projectDir - Directory to check
 * @returns true if directory appears to be a Next.js project
 */
async function isNextjsProject(projectDir: string): Promise<boolean> {
  console.error('Checking if project is a Next.js project');
  try {
    // Check for package.json
    const packageJsonPath = resolveProjectPath(projectDir, 'package.json');
    console.error(packageJsonPath);
    if (!await fs.pathExists(packageJsonPath)) {
      console.error('Package.json not found');
      return false;
    }
    
    // Check if it looks like a Next.js project by looking at package.json
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    console.warn(packageJson);
    const hasNextjsDependency = 
      (packageJson.dependencies && packageJson.dependencies['next']) || 
      (packageJson.devDependencies && packageJson.devDependencies['next']);
    
    // If it has nextjs as a dependency, consider it a Next.js project
    // We don't need to check for src/ directory or specific config files
    return hasNextjsDependency;
  } catch (error) {
    logError(`Error detecting Next.js project:`, error);
    return false;
  }
}

app.post('/enhance-prompt', async (req: express.Request, res: express.Response) => {
  const { prompt } = req.body;
  const start = performance.now();
  const enhancedPrompt = await getEnhancedPrompt(prompt, 'anthropic/claude-3.7-sonnet');
  // const enhancedPrompt = await getEnhancedPrompt(prompt, 'openai/gpt-4o-mini');
  const time = performance.now() - start;
  
  res.status(200).json({ enhancedPrompt, time });
});

app.post('/test-open-router', async (req: express.Request, res: express.Response) => {
  const { modelKey } = req.body;
  
  const openai = new OpenRouterService();

  const dummyProjectStructure = `
  /src
    /components
      Header.tsx
      Footer.tsx
    /pages
      Home.tsx
      About.tsx
    App.tsx
    main.tsx
  package.json
  nextjs.config.ts
  `;
  
  const dummyPreviousFiles = {
    'src/App.tsx': 'function App() { return <div>Hello World</div>; }\nexport default App;',
    'src/components/Header.tsx': 'export function Header() { return <header>App Header</header>; }'
  };
  
  // Get the system message
  const systemMessage = getSystemMessage(dummyProjectStructure, dummyPreviousFiles, '');

  const userPrompt = "Add a dark mode toggle to the Header component";

  const formattedMessages = formatMessagesForOpenRouter([{ role: 'user', content: userPrompt }]);

    const stream = await openai.getOpenAI().chat.completions.create(
      {
        model: modelKey,
        messages: [
          { role: 'system', content: systemMessage },
          ...formattedMessages
        ],
        stream: true,
      }
    );

    let text = '';
    try {
      for await (const chunk of stream) {
        if (chunk.choices[0].delta.content) {
          text += chunk.choices[0].delta.content;
        }
      }
    } catch (error) {
      logError('Error processing text stream:', error);
      throw error;
    }
  
  res.json({ text: text });
  
});

app.post('/test', async (req: express.Request, res: express.Response) => {
  const { modelKey } = req.body;
  initializeAIModel(modelKey);
  
  // Create dummy project structure and previously generated files
  const dummyProjectStructure = `
  /src
    /components
      Header.tsx
      Footer.tsx
    /pages
      Home.tsx
      About.tsx
    App.tsx
    main.tsx
  package.json
  nextjs.config.ts
  `;
  
  const dummyPreviousFiles = {
    'src/App.tsx': 'function App() { return <div>Hello World</div>; }\nexport default App;',
    'src/components/Header.tsx': 'export function Header() { return <header>App Header</header>; }'
  };
  
  // Get the system message
  const systemMessage = getSystemMessage(dummyProjectStructure, dummyPreviousFiles, '');
  
  // User prompt for testing
  const userPrompt = "Add a dark mode toggle to the Header component";
  
  const { fullStream } = await streamText({
    model: openrouter.chat(modelKey),
    system: systemMessage,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: undefined,
  });

  let totalText = '';
  for await (const part of fullStream) {
    if (part.type === 'text-delta') {
      totalText += part.textDelta;
    }
  }

  res.json({ text: totalText });
});

// Firebase connection test endpoint
app.get('/firebase-test', async (req: express.Request, res: express.Response) => {
  try {
    // Import the Firebase admin config
    const { getFirestore, isFirebaseEnabled, initializeFirebaseAdmin } = require('./config/firebase-admin-config');
    
    // Check if Firebase is enabled
    if (!isFirebaseEnabled()) {
      return res.status(400).json({
        success: false,
        message: 'Firebase is not enabled. Set FIREBASE_STORAGE_ENABLED=true in your .env file.'
      });
    }
    
    // Try to initialize Firebase Admin
    const app = await initializeFirebaseAdmin();
    if (!app) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initialize Firebase Admin. Check your credentials and configuration.'
      });
    }
    
    // Try to get Firestore and write a test document
    const firestore = await getFirestore();
    if (!firestore) {
      return res.status(500).json({
        success: false,
        message: 'Failed to get Firestore instance'
      });
    }
    
    // Try to write a test document
    await firestore.collection('firebase-tests').doc('connection-test').set({
      timestamp: new Date(),
      message: 'Firebase connection test successful'
    });
    
    // Read the test document back
    const docRef = await firestore.collection('firebase-tests').doc('connection-test').get();
    
    return res.status(200).json({
      success: true,
      message: 'Firebase connection test successful',
      data: docRef.data()
    });
  } catch (error) {
    console.error('Firebase test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Firebase test failed with error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Main API endpoint
// Import auth middleware
import { verifyFirebaseAuth } from './middleware/auth-middleware';

// Add detailed header debugging before auth middleware
app.post('/generate', verifyFirebaseAuth, async (req: express.Request, res: express.Response) => {
  // Extract project ID from the request body or generate a new one
  const { newPrompt, cleanup = false, clientProjectId, modelKey = getCurrentModelKey(), enhancePrompt = true } = req.body as GenerateRequest;
  
  // Ensure client provides a project ID
  if (!clientProjectId) {
    res.status(400).json({ error: 'clientProjectId is required' });
    return;
  }
  
  const responseProjectId = clientProjectId;
  
  // Create a FirestoreLogger instance
  let firestoreLogger: FirestoreLogger;
  try {
      firestoreLogger = new FirestoreLogger(responseProjectId, true, 'Generate');
      // Initialize Firestore document BEFORE sending response
      await firestoreLogger.initialize(); 
      logInfo(`FirestoreLogger initialized successfully for ${responseProjectId}`);
  } catch (loggerOrInitError: unknown) {
      const errorMessage = loggerOrInitError instanceof Error ? loggerOrInitError.message : String(loggerOrInitError);
      logError(`Failed to initialize FirestoreLogger or project doc for ${responseProjectId}:`, loggerOrInitError);
      // Return an immediate error if logger/init fails
      return res.status(500).json({ 
          projectId: responseProjectId, 
          status: 'error', 
          error: `Failed to initialize backend: ${errorMessage}` 
      });
  }

  // --- Run Generation Synchronously ---
  try {
      logInfo(createHeader(`PROCESSING STARTED FOR PROJECT: ${responseProjectId}`));
      // Use the already created firestoreLogger instance
      
      // --- Log the initiating user message FIRST --- 
      await firestoreLogger.logHumanMessage(newPrompt);
      
      // Log initial status update to chat
      await firestoreLogger.logAssistantMessage('Code generation process starting...', 'status_update');
      
      const totalStart = performance.now();
      const timings: Record<string, number> = {};
      
      // Get user ID from auth middleware - THIS NEEDS ACCESS TO req.auth
      const userId = req.auth?.userId;

      // Double-check that we have a valid userId
      if (!userId) {
          // Log error to Firestore
          await firestoreLogger.error('Background task error: No authenticated user ID found');
          return res.status(401).json({ 
              projectId: responseProjectId, 
              status: 'error', 
              error: 'No authenticated user ID found'
          });
      }

      logInfo(`Handling generation for user: ${userId}, project: ${clientProjectId}`);
      await firestoreLogger.info(`Handling generation for user: ${userId}`);
      
      // Determine project directory
      let projectDir: string;
      let isNewProject = true;
      let conversationHistory: { role: string; content: string; timestamp: Date }[] = [];
      
      // Create fresh instances for each request 
      const projectStorage = new ProjectStorageService();
      const fileStorage = new DualFileStorage();
      
      // Check if this project already exists and has a directory
      const existingProject = await projectStorage.getProject(clientProjectId);
      // Treat as follow-up ONLY if project exists AND has a directory
      const isFollowUp = !!existingProject && !!existingProject.directory;
      
      if (isFollowUp) {
          if (!existingProject) {
             await firestoreLogger.error(`Project with ID ${clientProjectId} not found.`);
             return res.status(404).json({
                 projectId: responseProjectId,
                 status: 'error',
                 error: `Project with ID ${clientProjectId} not found.`
             });
          }
          const existingDir = existingProject.directory || '';
          projectDir = existingDir;
          isNewProject = false;
          conversationHistory = existingProject.conversationHistory || [];
          if (existingProject?.ownerId && existingProject.ownerId !== userId) {
             await firestoreLogger.error('Not authorized to access this project.');
             return res.status(403).json({
                 projectId: responseProjectId,
                 status: 'error',
                 error: 'Not authorized to access this project.'
             });
          }
          
          // Ensure project directory exists on the local filesystem
          // This is crucial for stateless environments like Cloud Run where containers are ephemeral
          console.error('Checking if project directory exists:', projectDir);
          if (!projectDir || !(await fs.pathExists(projectDir))) {
              console.error('Project directory does not exist locally, downloading from storage...');
              await firestoreLogger.info('Project directory not found locally, downloading from storage...');
              
              try {
                  // Try to create the directory 
                  await fs.ensureDir(projectDir);
              } catch (error) {
                  // If we can't create at the original location, use a guaranteed writable location
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  console.error(`Cannot create directory at original path: ${projectDir}, error: ${error}`);
                  await firestoreLogger.warning(`Cannot access original project directory: ${errorMessage}`);
                  
                  // Create a new project directory in the os-tmp location
                  const tempDir = path.join(process.cwd(), 'temp');
                  const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
                  projectDir = path.join(tempDir, `project-${uniqueId}`);
                  
                  console.error(`Using alternative project directory: ${projectDir}`);
                  await firestoreLogger.info(`Using alternative project directory: ${projectDir}`);
                  
                  // Create the alternative directory
                  await fs.ensureDir(projectDir);
                  
                  // Update the project record with the new directory
                  if (existingProject) {
                      existingProject.directory = projectDir;
                      await projectStorage.saveProject(existingProject);
                      await firestoreLogger.info(`Updated project record with new directory location`);
                  }
              }
              
              try {
                  // Download project files from storage to the local filesystem
                  await fileStorage.downloadProjectFiles(clientProjectId, projectDir);
                  await firestoreLogger.info('Successfully downloaded project files from storage.');
                  console.error('Files downloaded from storage to:', projectDir);
              } catch (error) {
                  const errorMessage = error instanceof Error ? error.message : String(error);
                  await firestoreLogger.error(`Failed to download project files: ${errorMessage}`);
                  return res.status(500).json({
                      projectId: responseProjectId,
                      status: 'error',
                      error: `Failed to download project files: ${errorMessage}`
                  });
              }
          }
          
          console.error('Checking if project is a Next.js project');
          console.error(projectDir);
          if (!projectDir || !(await isNextjsProject(projectDir))) {
             await firestoreLogger.error('Project directory not found or is not a valid Next.js project.');
             return res.status(404).json({
                 projectId: responseProjectId,
                 status: 'error',
                 error: 'Project directory not found or is not a valid Next.js project.'
             });
          }
          logInfo(`Using existing project with ID: ${clientProjectId}`);
          // Log status update to chat
          await firestoreLogger.logAssistantMessage('Resuming existing project.', 'status_update');
          
      } else {
          isNewProject = true;
          const tempDir = path.join(__dirname, '..', 'temp');
          await fs.ensureDir(tempDir);
          const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          projectDir = path.join(tempDir, `project-${uniqueId}`);
          await fs.ensureDir(projectDir);
          
          // Extract projectSummary from enhancedData if available
          const enhancedData = req.body.enhancedData;
          const projectSummary = enhancedData?.projectSummary || newPrompt;
          
          logInfo(`Creating new project metadata in storage with ID: ${clientProjectId}`);
          try {
              await projectStorage.createProject(clientProjectId, projectDir, userId, projectSummary);
              logInfo(`Successfully created project metadata in storage`);
              // Log status update to chat
              await firestoreLogger.logAssistantMessage('Created new project entry.', 'status_update');
          } catch (error) {
              logError(`Failed to create project metadata:`, error);
              await firestoreLogger.warning(`Failed to create project metadata: ${error instanceof Error ? error.message : String(error)}`);
          }
          logInfo(createHeader('STEP: Creating Next.js Project'));
          timings.createProject = await measureTime(async () => {
              await createNextProject(projectDir, uniqueId);
              return Math.round(performance.now() - totalStart);
          }, "Creating Next.js project");
      }

      const requestTracker = new RequestCostTracker();
    
      let enhancedPrompt = newPrompt;

      // Extract enhancedData from request
      const enhancedData = req.body.enhancedData;
      
      // Check if we have pre-enhanced data from the frontend
      if (enhancedData && !isFollowUp) {
          // Log that we're using pre-enhanced data from the frontend
          await firestoreLogger.info('Using pre-enhanced data from frontend');
          logInfo('Using pre-enhanced data from frontend');
          
          // Extract project summary and selected features
          const { projectSummary, features } = enhancedData;
          
          // Log the selected features
          if (features && features.length > 0) {
              await firestoreLogger.info(`Selected features (${features.length}): ${features.join(', ')}`);
              logInfo(`Selected features (${features.length}): ${features.join(', ')}`);
          }
          
          // Format the enhanced prompt using the frontend-provided data
          enhancedPrompt = formatEnhancedPromptFromData(newPrompt, projectSummary, features);
          
          await firestoreLogger.success('Successfully used frontend-enhanced prompt data');
          logSuccess('Successfully used frontend-enhanced prompt data');
      }
      // Use the existing enhancePrompt logic only if enhancedData is not provided
      else if (enhancePrompt && !isFollowUp && !enhancedData) {
          // Log status update to chat
          await firestoreLogger.logAssistantMessage('Enhancing user prompt...', 'status_update');
          try {
              const userPromptResult = await getEnhancedPrompt(newPrompt, 'openai/gpt-4o-mini');
              enhancedPrompt = userPromptResult.formattedPrompt;
              await firestoreLogger.success('Successfully enhanced website prompt');
              await firestoreLogger.info('Enhanced prompt:' + userPromptResult.enhancedPrompt);
          } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              await firestoreLogger.error(`Error enhancing prompt, using original prompt instead: ${errorMessage}`);
              enhancedPrompt = newPrompt;
          }
      }
      
      if (!cleanup) {
          try {
              logInfo(`Storing user prompt in conversation history for project ${clientProjectId}`);
              await projectStorage.addConversationMessage(clientProjectId, 'user', newPrompt, isFollowUp);
              await firestoreLogger.info('Stored user prompt.');
          } catch (error) {
              logError(`Failed to store user prompt in conversation history:`, error);
              await firestoreLogger.warning(`Failed to store user prompt: ${error instanceof Error ? error.message : String(error)}`);
          }
      }
      
      // Log status before starting generation
      await firestoreLogger.logAssistantMessage('Generating project code...', 'status_update');

      // Generate code - MUST call logger.end() or logger.error() before returning
      const {
          projectFiles,
          lintError,
          buildError,
          attempts,
          success,
          timings: generationTimings,
          generatedConversation,
          hasActualLintErrors,
          responseProcessor
      } = await generateProjectCode(projectDir, enhancedPrompt, !isNewProject, conversationHistory, showRealTimeDisplay, modelKey, requestTracker, firestoreLogger);
      
      // Merge timings
      Object.assign(timings, generationTimings);
      
      // Store assistant response (if successful and not cleanup)
      if (success && !cleanup && generatedConversation?.assistantResponse) {
          try {
             await projectStorage.addConversationMessage(clientProjectId, 'assistant', generatedConversation.assistantResponse, false);
             await firestoreLogger.info('Stored assistant response.');
          } catch (error) {
              logError(`Failed to store assistant response:`, error);
              await firestoreLogger.warning(`Failed to store assistant response: ${error instanceof Error ? error.message : String(error)}`);
          }
      }
      
      // Upload project files (if successful and not cleanup)
      if (success && !cleanup) {
          try {
              // Log status update to chat
              await firestoreLogger.logAssistantMessage('Uploading project files to storage...', 'status_update');
              await fileStorage.uploadProjectFiles(clientProjectId, projectDir, firestoreLogger);
              await firestoreLogger.success('Project files uploaded successfully.'); // Keep success log for main logs
          } catch (error) {
              await firestoreLogger.error(`Error uploading files: ${error instanceof Error ? error.message : String(error)}`);
          }
      }
      
      // Clean up temporary directory (only if cleanup and new project)
      if (cleanup && isNewProject) {
          await measureTime(async () => {
              await fs.remove(projectDir);
          }, "Cleaning up temporary directory");
      } else if (!cleanup) {
          logSuccess(`Project files saved in: ${projectDir}`);
          await firestoreLogger.success(`Project files available in directory: ${projectDir}`);
      }
      
      // Calculate total time
      const totalDuration = Math.round(performance.now() - totalStart);
      
      // Get token usage and cost calculation data
      const costSummaryData = requestTracker.getCostSummaryData();
      
      // Display request cost summary (server logs only)
      requestTracker.displayCostSummary();
      
      // Print final summary (server logs only)
      logGenerationSummary(
          success,
          attempts,
          lintError,
          buildError,
          Object.keys(projectFiles).length,
          totalDuration,
          costSummaryData.totalInputTokens,
          costSummaryData.totalOutputTokens,
          hasActualLintErrors
      );
      
      // Log final token speed (server logs only)
      const latestSpeed = responseProcessor.getLatestReportedSpeed();
      logInfo(`Final token generation speed: ${latestSpeed.toFixed(2)} tokens/sec`);
      await firestoreLogger.info(`Final token generation speed: ${latestSpeed.toFixed(2)} tokens/sec`);
      
      logInfo(createHeader(`PROCESSING FINISHED FOR PROJECT: ${responseProjectId} - Success: ${success}`));

      // --- Send Final Response After Processing --- 
      return res.status(200).json({ 
          projectId: responseProjectId, 
          status: success ? 'completed' : 'error',
          success: success
      });

  } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logError(`Unhandled error in task for project ${responseProjectId}:`, error);
      // Ensure logger is defined before using
      if (firestoreLogger) {
        // Log error to Firestore and set status to error
        await firestoreLogger.error(`Unhandled task error: ${errorMessage}`);
        // Ensure end is called to finalize status if error didn't trigger it
        await firestoreLogger.end('Code generation failed due to unhandled error.'); 
      } else {
        // Fallback console log if logger failed early
        console.error(`[${responseProjectId}] Task failed before logger initialization.`);
      }
      
      // Send error response
      return res.status(500).json({
          projectId: responseProjectId,
          status: 'error',
          error: errorMessage
      });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logSuccess(`Coding agent server running on port ${PORT}`);
});