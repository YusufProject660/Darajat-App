import mongoose, { Document, Schema } from 'mongoose';

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
}

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
  }
}, { timestamps: true });

export const Dashboard = mongoose.models.Dashboard || 
  mongoose.model<IDashboard>('Dashboard', dashboardSchema);
