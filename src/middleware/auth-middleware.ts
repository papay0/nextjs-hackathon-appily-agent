/**
 * Firebase authentication middleware
 * 
 * This middleware verifies Firebase authentication tokens and attaches user info to the request.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthInfo } from '../types/api';
import { logError } from '../utils/logging';
import { getFirebaseAdmin } from '../config/firebase-admin-config';

// Extend Express Request to include auth info
declare global {
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

/**
 * Middleware to verify Firebase authentication tokens
 * 
 * @param req - Express request
 * @param res - Express response
 * @param next - Express next function
 */
export async function verifyFirebaseAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logError('Missing or invalid authentication token');
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Extract the token
    const token = authHeader.split('Bearer ')[1];
    
    try {
      // Get the Firebase Admin SDK instance
      const admin = await getFirebaseAdmin();
      
      if (!admin) {
        logError('Firebase Admin SDK not initialized');
        res.status(500).json({ error: 'Authentication service unavailable' });
        return;
      }
      
      // Verify the token
      const decodedToken = await admin.auth().verifyIdToken(token);
      
      // Attach the user ID to the request
      req.auth = { userId: decodedToken.uid };
      
      next();
    } catch (error) {
      logError('Error verifying Firebase token:', error);
      res.status(401).json({ error: 'Invalid authentication token' });
      return;
    }
  } catch (error) {
    logError('Error in auth middleware:', error);
    res.status(500).json({ error: 'Internal server error during authentication' });
    return;
  }
}
