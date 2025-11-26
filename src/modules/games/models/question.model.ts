import mongoose, { Document, Schema } from 'mongoose';

export interface IQuestion extends Document {
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  source: string;
  difficulty: 'easy' | 'medium' | 'hard';
  deckId: mongoose.Types.ObjectId;
  category: string;
  createdAt: Date;
}

const questionSchema = new Schema<IQuestion>({
  question: { type: String, required: true, trim: true },
  options: { 
    type: [String], 
    required: true,
    validate: {
      validator: (options: string[]) => options.length === 4,
      message: 'Question must have exactly 4 options'
    }
  },
  correctAnswer: { 
    type: Number, 
    required: true,
    min: 0,
    max: 3,
    validate: {
      validator: function(this: IQuestion, value: number) {
        return value >= 0 && value < this.options.length;
      },
      message: 'Correct answer must be a valid option index'
    }
  },
  explanation: { type: String, required: true },
  source: { type: String, required: true },
  difficulty: {
    type: String,
    required: true,
    enum: ['easy', 'medium', 'hard']
  },
  deckId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Deck',
    required: true,
    index: true
  },
  category: {
    type: String,
    required: true,
    enum: ['prophets', 'fiqh'],
    index: true
  },
  createdAt: { type: Date, default: Date.now }
});

// Compound index for efficient querying
questionSchema.index({ deckId: 1, difficulty: 1, _id: 1 });

// Middleware to update the question count in the associated deck
questionSchema.post('save', async function(doc) {
  const Deck = mongoose.model('Deck');
  await Deck.findByIdAndUpdate(doc.deckId, { 
    $inc: { questionCount: 1 } 
  });
});

// Add index for better query performance
questionSchema.index({ deckId: 1, difficulty: 1, status: 1 });

export const Question = mongoose.model<IQuestion>('Question', questionSchema);
