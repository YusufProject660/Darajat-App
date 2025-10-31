import { Types } from 'mongoose';

export interface IPlayer {
  userId: Types.ObjectId | string;
  username: string;
  avatar?: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
}

export interface IGameRoom {
  _id?: Types.ObjectId;
  roomCode: string;
  hostId: Types.ObjectId | string;
  players: IPlayer[];
  status: 'waiting' | 'active' | 'completed' | 'finished';
  settings?: {
    numberOfQuestions: number;
    maximumPlayers: number;
    categories: {
      [key: string]: {
        enabled: boolean;
        difficulty?: 'easy' | 'medium' | 'hard';
      };
    };
  };
  questions?: any[]; // Adjust the type based on your question schema
  currentQuestion?: number;
  answeredQuestions?: any[]; // Adjust the type based on your answer schema
  finishedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IGameService {
  initialize(io: any): void;
  startGame(roomCode: string, userId: string): Promise<IGameRoom>;
  // Add other necessary method signatures
}

export interface IGameRepository {
  getRoomByCode(code: string, options?: any): Promise<IGameRoom | null>;
  updateRoom(roomCode: string, update: Partial<IGameRoom>): Promise<IGameRoom | null>;
  // Add other necessary repository method signatures
}
