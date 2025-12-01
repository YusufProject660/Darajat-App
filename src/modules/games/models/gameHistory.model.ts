import mongoose, { Document, Schema } from 'mongoose';
import { IAnsweredQuestion } from './gameRoom.model';

export interface IGameHistory extends Document {
  roomCode: string;
  hostId: mongoose.Types.ObjectId;
  players: Array<{
    userId: mongoose.Types.ObjectId;
    username: string;
    avatar?: string;
    finalScore: number;
    correctAnswers: number;
    totalTime: number;
    accuracy: number;
  }>;
  questions: mongoose.Types.ObjectId[];
  answeredQuestions: IAnsweredQuestion[];
  settings: {
    numberOfQuestions: number;
    maximumPlayers: number;
    categories: { [key: string]: { enabled: boolean; difficulty: 'easy' | 'medium' | 'hard' } };
  };
  startedAt: Date;
  finishedAt: Date;
  createdAt: Date;
}

const gameHistorySchema = new Schema<IGameHistory>({
  roomCode: { type: String, required: true, index: true },
  hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  players: [{
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    avatar: String,
    finalScore: { type: Number, default: 0 },
    correctAnswers: { type: Number, default: 0 },
    totalTime: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 }
  }],
  questions: [{ type: Schema.Types.ObjectId, ref: 'Question' }],
  answeredQuestions: [{
    playerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    questionId: { type: Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOption: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    timeTaken: { type: Number, required: true },
    answeredAt: { type: Date, default: Date.now }
  }],
  settings: {
    numberOfQuestions: { type: Number, required: true },
    maximumPlayers: { type: Number, required: true },
    categories: {
      type: Map,
      of: new Schema({
        enabled: { type: Boolean, required: true },
        difficulty: { type: String, enum: ['easy', 'medium', 'hard'], required: true }
      }),
      required: true
    }
  },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

gameHistorySchema.index({ 'players.userId': 1 });
gameHistorySchema.index({ finishedAt: -1 });

export const GameHistory = mongoose.models.GameHistory || mongoose.model<IGameHistory>('GameHistory', gameHistorySchema);

