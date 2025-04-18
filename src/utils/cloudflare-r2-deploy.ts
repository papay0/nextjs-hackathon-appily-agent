/**
 * Utility for deploying built projects to Cloudflare R2
 */
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { logSuccess, logInfo, logError } from './logging';

/**
 * Get the appropriate content type based on file extension
 */
function getContentType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const contentTypes: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    txt: 'text/plain',
    pdf: 'application/pdf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    otf: 'font/otf',
    xml: 'application/xml',
  };

  return contentTypes[ext] || 'application/octet-stream';
}

/**
 * Generate the R2 public URL
 */
function getR2PublicUrl(keyPrefix: string): string {
  const publicId = process.env.R2_PUBLIC_ID || ''; // Get from environment variable
  if (!publicId) {
    return 'R2_PUBLIC_ID not configured';
  }
  
  return `https://pub-${publicId}.r2.dev/${keyPrefix}/index.html`;
}

/**
 * List all files in a directory recursively
 */
function listFilesInDirectory(dirPath: string, basePath: string = ''): string[] {
  let files: string[] = [];
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const relativePath = path.join(basePath, entry.name);
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      files = files.concat(listFilesInDirectory(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  
  return files;
}

/**
 * Deploy the built project to Cloudflare R2
 */
export async function deployToR2(projectDir: string, projectId: string): Promise<string> {
  try {
    logInfo('Building project for deployment...');
    
    // Run the build command
    execSync('npm run build', { 
      stdio: 'pipe', 
      encoding: 'utf8',
      cwd: projectDir 
    });
    
    logSuccess('Project built successfully');
    
    // Check if required environment variables are set
    const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
    const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    const R2_BUCKET = process.env.R2_BUCKET || 'appily-dev';
    
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !CLOUDFLARE_ACCOUNT_ID) {
      logError('Missing required Cloudflare R2 credentials');
      return 'Not deployed: Missing R2 credentials';
    }
    
    // Initialize S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
    
    // Use the project ID directly since it's already unique
    const deployId = projectId;
    const staticFolderPath = path.join(projectDir, 'out');
    
    if (!fs.existsSync(staticFolderPath)) {
      logError('Build directory does not exist');
      return 'Not deployed: Build failed';
    }
    
    logInfo(`Uploading built project to R2 (ID: ${deployId})...`);
    
    // Get all files in the static folder
    const files = listFilesInDirectory(staticFolderPath);
    
    // Upload each file to R2
    const uploadPromises = files.map(async (relativePath) => {
      const filePath = path.join(staticFolderPath, relativePath);
      const fileContent = fs.readFileSync(filePath);
      
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: R2_BUCKET,
          Key: `${deployId}/${relativePath}`,
          Body: fileContent,
          ContentType: getContentType(relativePath),
        },
      });
      
      await upload.done();
      return relativePath;
    });
    
    await Promise.all(uploadPromises);
    
    const deployUrl = getR2PublicUrl(deployId);
    logSuccess(`Project deployed successfully to ${deployUrl}`);
    
    return deployUrl;
  } catch (error) {
    logError('Failed to deploy project to R2', error);
    return 'Not deployed: Error occurred';
  }
} 