import { mkdir } from 'fs/promises';

export async function ensureAuthDir() {
  try {
    await mkdir('whatsapp-auth', { recursive: true });
    console.log('Authentication directory created or already exists');
  } catch (error) {
    console.error('Failed to create auth directory:', error);
  }
}
