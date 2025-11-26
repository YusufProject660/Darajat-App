import mongoose, { Document, Schema } from 'mongoose';

export interface IDeck extends Document {
  gameId: mongoose.Types.ObjectId;
  name: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  status: 'active' | 'inactive';
  questionCount: number;
  createdAt: Date;
}

const deckSchema = new Schema<IDeck>({
  gameId: { type: Schema.Types.ObjectId, ref: 'Game', required: true },
  name: { type: String, required: true },
  category: { 
    type: String, 
    required: true,
    enum: ['prophets', 'fiqh']
  },
  difficulty: {
    type: String,
    required: true,
    enum: ['easy', 'medium', 'hard']
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  questionCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// Index for faster querying
deckSchema.index({ gameId: 1, status: 1, category: 1, difficulty: 1 });

export const Deck = mongoose.model<IDeck>('Deck', deckSchema);
