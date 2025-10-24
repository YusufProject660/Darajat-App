import mongoose, { Document, Schema } from 'mongoose';

export interface IPlayer {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar?: string;
  score: number;
  isHost: boolean;
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
  answeredQuestions: Array<{
    playerId: mongoose.Types.ObjectId;
    questionId: mongoose.Types.ObjectId;
    isCorrect: boolean;
    timeTaken: number;
    answeredAt: Date;
  }>;
  createdAt: Date;
}

const playerSchema = new Schema<IPlayer>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  username: { type: String, required: true },
  avatar: String,
  score: { type: Number, default: 0 },
  isHost: { type: Boolean, default: false }
});

const gameRoomSchema = new Schema<IGameRoom>({
  hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  roomCode: { type: String, required: true, unique: true, uppercase: true },
  players: [playerSchema],
  settings: {
    numberOfQuestions: { type: Number, required: true, min: 1 },
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
    isCorrect: { type: Boolean, required: true },
    timeTaken: { type: Number, required: true },
    answeredAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

// No need for explicit index as we already have unique: true in the schema
export const GameRoom = mongoose.model<IGameRoom>('GameRoom', gameRoomSchema);
