import { GameRoom } from '../models/gameRoom.model';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar looking characters
const CODE_LENGTH = 5;

/**
 * Generates a unique room code that doesn't exist in the database
 * @returns Promise<string> A unique room code
 */
export const generateUniqueRoomCode = async (): Promise<string> => {
  const maxAttempts = 10;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const code = generateRandomCode();
    const exists = await GameRoom.exists({ roomCode: code });
    
    if (!exists) {
      return code;
    }
    
    attempts++;
    
    // If we've tried many times, wait a bit before trying again
    if (attempts > 3) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  throw new Error('Failed to generate a unique room code after multiple attempts');
};

/**
 * Generates a random room code
 * @returns string A random room code
 */
const generateRandomCode = (): string => {
  let result = '';
  const charsLength = CHARS.length;
  
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * charsLength));
  }
  
  return result;
};
