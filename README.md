# Appily Agent

I build an AI agent that is building Next.js application, focusing on mobile web apps, fixing errors, and hosting them.
User input --> enhancement from LLM --> building apps and fixing bugs using LLM --> host website --> return URL to user
I also built the [website](https://www.appily.dev) (hosted on Verlce) and an Expo mobile app to create web apps.

Two ways to access the code generation experience:
1. Through the web app, available on https://www.appily.dev
2. Via the native mobile app, I just submitted to the App Store so it can take a few days.

## TLDR for the hackathon, if you should read one thing:

- The user enters a prompt, it will get enhanced with a checklist to refine the features
- This agent receives this enhanced prompt
- then it will git clone this Next.js template: [https://github.com/papay0/appily-template-next-js](https://github.com/papay0/appily-template-next-js)
- do 5 loops of code generation with LLM like
```
while (npm run build !== success && number of try <= 5) {
    new project files = await llm.send(files)
      .streamToFirebase()
    npm run lint --fix // just to fix the most basic warnings
    numner of try += 1
}
```
- upload the `out/` directory to R2 (Cloudflare)
- upload everything to firebase to that so that the web and mobile native client can have the streaming of the code gen, logs, messages, and metadata

## Demo

### Mobile

[![IMAGE ALT TEXT](http://img.youtube.com/vi/YMkLgnCzAD0/0.jpg)](http://www.youtube.com/watch?v=YMkLgnCzAD0 "
Appily mobile demo")

### Web

[![IMAGE ALT TEXT](http://img.youtube.com/vi/FRugepeYY9g/0.jpg)](http://www.youtube.com/watch?v=FRugepeYY9g "
Appily web demo")

## Link of the 4 repos
- [Appily-agent](https://github.com/papay0/nextjs-hackahton-appily-agent)
- [Appily-expo](https://github.com/papay0/nextjs-hackahton-appily-expo)
- [Appily-next](https://github.com/papay0/nextjs-hackahton-appily-next)
- [Appily-firebase](https://github.com/papay0/nextjs-hackahton-appily-firebase)

## More details

- I'm using Nextjs for the web client, using Shadcn for the UI
- I'm using Expo for the mobile app
- I'm generating Nextjs projects with Appily agent because it looks like it has the best LLM code gen results, and it's the easier to configure Shadcn and Claude Sonnet 3.7 understands it very well.
- I'm using Clerk for authentication with Google Auth
- I have 4 repos to make it works
  - Appily-agent: this one, hosted on a Google Cloud Run environment that auto-scales with amount of users
  - Appily-expo: the Expo mobile app code
  - Appily-next: the web client, with landing page + code gen
  - Appily-firebase: for Cloud Functions to enhance the prompt from the user
- I was initially using the AI SDK but found that it was hard to get good error handlings, too generic, and didn't find a good way to understand all the different errors from different models, so I switched to OpenRouter implementation using the OpenAI SDK

## Features

- Creates Next.js React TypeScript projects using the official template
- Generates complete web applications from natural language descriptions
- Handles file creation, modification, and deletion
- Automatically tests builds and requests fixes for errors (with multiple retries)
- Runs ESLint and TypeScript type checking before each build
- Automatically installs npm packages mentioned in AI responses
- Maintains conversation history for context
- Real-time streaming of AI responses with real-time code generation
- Persistent project storage with Firebase integration
- Authentication with Firebase Authentication
- Supports multiple AI providers (Anthropic Claude, OpenAI, and more via OpenRouter)
- Stateless architecture for cloud deployment (Google Cloud Run)
- Follow-up conversations for iterative development

## Supported AI Models

The agent supports the following AI models:

- **Anthropic Claude**
  - claude-3-7-sonnet
  - claude-3-5-sonnet
- **OpenAI**
  - gpt-4o
  - gpt-4o-mini
- **More models via OpenRouter**
  - Various models accessible through OpenRouter

Select your preferred model by setting the `AI_MODEL` environment variable in your `.env` file.

## Storage Options

The agent supports multiple storage options:

- **Local Filesystem Storage** - Store generated files on the local filesystem (default)
- **Firebase Storage** - Store files in Firebase Storage for cloud persistence
- **Dual Storage** - Use both local and Firebase storage simultaneously

Enable Firebase Storage by setting `FIREBASE_STORAGE_ENABLED=true` in your `.env` file.

## Authentication

The agent uses Firebase Authentication to secure API endpoints. The `/generate` endpoint requires a valid Firebase ID token to be provided in the Authorization header.

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy the `.env.template` file to `.env` and configure your settings:
   ```
   cp .env.template .env
   ```
4. Edit the `.env` file with your API keys and configuration:
   - AI API keys (Anthropic, OpenAI, etc.)
   - Firebase configuration (for storage and authentication)
   - Server port and other settings

## Firebase Configuration

To use Firebase features (storage and authentication), you'll need to:

1. Create a Firebase project in the Firebase console
2. Set up Firebase Authentication
3. Set up Firebase Storage
4. Get your service account key (for local development)
5. Configure the following environment variables:
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
   FIREBASE_STORAGE_ENABLED=true
   FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./firebase-service-account-key.json
   ```

In cloud environments like Google Cloud Run, you can use Application Default Credentials instead of a service account key.

## Running the Server

Start the server with:

```
npm start
```

For development with auto-reload:

```
npm run dev
```

Build the TypeScript code:

```
npm run build
```

Run linting:

```
npm run lint:fix
```

The server runs on port 3000 by default (configurable via PORT in .env).

## API Endpoints

### `/generate` - Generate or update a project

**Method:** POST  
**Authentication:** Requires Firebase authentication token  
**Request:**

```json
{
  "newPrompt": "Create a simple to-do list application with Next.js",
  "clientProjectId": "unique-project-id",
  "modelKey": "claude-3-7-sonnet",
  "enhancePrompt": true,
  "cleanup": false,
  "enhancedData": {
    "projectSummary": "A Next.js to-do list application",
    "features": ["User authentication", "Task categories", "Due dates"]
  }
}
```

**Response:**

```json
{
  "projectId": "unique-project-id",
  "status": "completed",
  "success": true
}
```

### `/firebase-test` - Test Firebase connectivity

**Method:** GET  
**Response:** Status of Firebase connectivity

## Deploying to Google Cloud Run

The application is designed for stateless operation and can be deployed to Google Cloud Run:

1. Build and push the Docker image:
   ```
   gcloud builds submit --tag gcr.io/[PROJECT_ID]/appily-agent
   ```

2. Deploy to Cloud Run:
   ```
   gcloud run deploy appily-agent \
     --image gcr.io/[PROJECT_ID]/appily-agent \
     --platform managed \
     --set-env-vars ANTHROPIC_API_KEY=[YOUR_API_KEY],FIREBASE_STORAGE_ENABLED=true
   ```

## Project Storage Architecture

The system uses a dual storage approach:

1. **Metadata** - Project metadata is stored in Firebase Firestore
2. **Files** - Files can be stored in:
   - Local filesystem (for development)
   - Firebase Storage (for production)
   - Both simultaneously (dual storage)

For follow-up conversations in stateless environments, the system:
1. Retrieves project metadata from Firestore
2. Downloads project files from Firebase Storage
3. Ensures files exist locally before processing
4. Uploads modified files back to Firebase Storage after generation

## Limitations

- Large projects may exceed the context window of the AI models
- Complex build errors might require multiple iterations to fix
- File storage is limited to what the AI can process in its context window

## License

MIT