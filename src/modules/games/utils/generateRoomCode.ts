import mongoose from 'mongoose';
import { GameRoom } from '../models/gameRoom.model';

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluded similar looking characters
const CODE_LENGTH = 5;

/**
 * Generates a random room code
 * @returns string A random room code
 */
export const generateRoomCode = (): string => {
  let result = '';
  const charactersLength = CHARS.length;
  
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CHARS.charAt(Math.floor(Math.random() * charactersLength));
  }
  
  return result;
};

export const generateUniqueRoomCode = async (): Promise<string> => {
  const maxAttempts = 10;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    const code = generateRoomCode();
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
