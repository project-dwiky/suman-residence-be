// Firebase Admin import helper to avoid circular dependencies
let adminInstance: any = null;

export function getFirebaseAdmin() {
  if (!adminInstance) {
    try {
      // Import Firebase Admin SDK
      const admin = require('firebase-admin');
      
      // Initialize Firebase Admin if not already initialized
      if (!admin.apps.length) {
        const serviceAccount = require('../firebase-service-account.json'); // Adjust path as needed
        
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL || "https://your-project.firebaseio.com"
        });
      }
      
      adminInstance = {
        db: admin.firestore(),
        admin: admin
      };
    } catch (error) {
      console.error('Failed to initialize Firebase Admin:', error);
      throw new Error('Firebase Admin not available');
    }
  }
  return adminInstance;
}

// Export db instance
export const db = getFirebaseAdmin()?.db;
