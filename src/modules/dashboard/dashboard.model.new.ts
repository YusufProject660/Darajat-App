import mongoose, { Document, Schema, Model } from 'mongoose';

// Interface for Dashboard Game
export interface IDashboardGame {
  id: string;
  title: string;
  description: string;
  image: string;
  status: 'available' | 'coming_soon' | 'maintenance';
}

// Interface for Dashboard
export interface IDashboard extends Document {
  banner: {
    title: string;
    description: string;
    createButtonText: string;
    image: string;
  };
  actions: {
    joinGameText: string;
    howToPlayLink: string;
  };
  funGames: IDashboardGame[];
  createdAt: Date;
  updatedAt: Date;
}

// Game Schema
const gameSchema = new Schema<IDashboardGame>({
  id: { type: String, required: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  image: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'coming_soon', 'maintenance'],
    default: 'available',
    required: true
  }
}, { _id: false });

// Main Dashboard Schema
const dashboardSchema = new Schema<IDashboard>(
  {
    banner: {
      title: { type: String, required: true },
      description: { type: String, required: true },
      createButtonText: { type: String, required: true },
      image: { type: String, required: true }
    },
    actions: {
      joinGameText: { type: String, required: true },
      howToPlayLink: { type: String, required: true }
    },
    funGames: [gameSchema]
  },
  { 
    timestamps: true 
  }
);

// Export the model
export const Dashboard: Model<IDashboard> = 
  mongoose.models.Dashboard || 
  mongoose.model<IDashboard>('Dashboard', dashboardSchema);
