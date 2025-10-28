import mongoose, { Document, Schema } from 'mongoose';

export interface IDashboardGame {
  id: string;
  title: string;
  description: string;
  image: string;
  status: 'available' | 'coming_soon' | 'maintenance';
}

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
}

const dashboardGameSchema = new Schema<IDashboardGame>({
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

const dashboardSchema = new Schema<IDashboard>({
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
  funGames: [dashboardGameSchema]
}, { timestamps: true });

export const Dashboard = mongoose.models.Dashboard || 
  mongoose.model<IDashboard>('Dashboard', dashboardSchema);
