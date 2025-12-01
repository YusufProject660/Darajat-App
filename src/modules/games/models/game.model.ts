import mongoose, { Document, Schema } from 'mongoose';

export interface IGame extends Document {
  name: string;
  decks: mongoose.Types.ObjectId[];
  createdAt: Date;
}

const gameSchema = new Schema<IGame>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    decks: [{
      type: Schema.Types.ObjectId,
      ref: 'Deck',
      required: true,
    }],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const Game = mongoose.models.Game || mongoose.model<IGame>('Game', gameSchema);
