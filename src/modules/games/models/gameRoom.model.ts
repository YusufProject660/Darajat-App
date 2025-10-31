import mongoose, { Document, Schema } from 'mongoose';

export interface IPlayer {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar?: string;
  score: number;
  isHost: boolean;
  isReady: boolean;
}

export interface IAnsweredQuestion {
  playerId: mongoose.Types.ObjectId;
  questionId: mongoose.Types.ObjectId;
  selectedOption: number;
  isCorrect: boolean;
  timeTaken: number;
  answeredAt: Date;
}

export interface IGameRoom extends Document {
  hostId: mongoose.Types.ObjectId;
  roomCode: string;
  players: IPlayer[];
  settings: {
    numberOfQuestions: number;
    maximumPlayers: number;
    categories: {
      [key: string]: {
        enabled: boolean;
        difficulty: 'easy' | 'medium' | 'hard';
      };
    };
  };
  questions: mongoose.Types.ObjectId[];
  status: 'waiting' | 'active' | 'finished';
  results: Array<{
    userId: mongoose.Types.ObjectId;
    correctAnswers: number;
    totalTime: number;
  }>;
  currentQuestion?: number;
  answeredQuestions: IAnsweredQuestion[];
  finishedAt?: Date;
  stats?: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
    totalTime: number;
    totalQuestions: number;
    correctAnswers: number;
    averageTimePerQuestion: number;
  };
  // Legacy properties for backward compatibility
  categories?: any;
  host?: mongoose.Types.ObjectId;
  maxPlayers?: number;
  gameSettings?: any;
  createdAt: Date;
}

const playerSchema = new Schema<IPlayer>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  avatar: String,
  score: { type: Number, default: 0 },
  isHost: { type: Boolean, default: false },
  isReady: { type: Boolean, default: false }
});

const gameRoomSchema = new Schema<IGameRoom>({
  hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  roomCode: { type: String, required: true, unique: true, uppercase: true },
  players: [playerSchema],
  settings: {
    numberOfQuestions: { type: Number, required: true, min: 1, max: 10 },
    maximumPlayers: { type: Number, required: true, min: 2, max: 10 },
    categories: {
      type: Map,
      of: new Schema({
        enabled: { type: Boolean, required: true },
        difficulty: {
          type: String,
          required: true,
          enum: ['easy', 'medium', 'hard']
        }
      }),
      required: true
    }
  },
  questions: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
  status: {
    type: String,
    enum: ['waiting', 'active', 'finished'],
    default: 'waiting'
  },
  results: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    correctAnswers: { type: Number, default: 0 },
    totalTime: { type: Number, default: 0 }
  }],
  currentQuestion: { type: Number, default: 0 },
  answeredQuestions: [{
    playerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOption: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    timeTaken: { type: Number, required: true },
    answeredAt: { type: Date, default: Date.now }
  }],
  finishedAt: { type: Date },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    totalTime: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    averageTimePerQuestion: { type: Number, default: 0 }
  },
  createdAt: { type: Date, default: Date.now }
});

// No need for explicit index as we already have unique: true in the schema
export const GameRoom = mongoose.models.GameRoom || mongoose.model<IGameRoom>('GameRoom', gameRoomSchema);
