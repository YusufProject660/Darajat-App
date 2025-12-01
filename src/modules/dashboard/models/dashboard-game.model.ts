import mongoose, { Document, Schema } from 'mongoose';

export interface IDashboardGame extends Document {
  id: string;
  title: string;
  description: string;
  image: string;
  status: 'available' | 'coming_soon' | 'maintenance';
}

const dashboardGameSchema = new Schema<IDashboardGame>({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  image: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'coming_soon', 'maintenance'],
    default: 'available',
    required: true
  }
}, { timestamps: true });

export const DashboardGame = mongoose.models.DashboardGame || 
  mongoose.model<IDashboardGame>('DashboardGame', dashboardGameSchema, 'games');
