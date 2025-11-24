import mongoose, { Document, Schema } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export interface IMessageBuffer extends Document {
  taskId: string;
  roomCode: string;
  senderId: string;
  eventName: string;
  payload: any;
  expectedReceivers: string[];
  acknowledgedBy: string[];
  status: 'pending' | 'delivered' | 'cleared';
  createdAt: Date;
  clearedAt?: Date;
}

const messageBufferSchema = new Schema<IMessageBuffer>({
  taskId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    default: () => uuidv4()
  },
  roomCode: { type: String, required: true, index: true },
  senderId: { type: String, required: true },
  eventName: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  expectedReceivers: [{ type: String, required: true }],
  acknowledgedBy: [{ type: String, default: [] }],
  status: { 
    type: String, 
    enum: ['pending', 'delivered', 'cleared'], 
    default: 'pending',
    index: true
  },
  clearedAt: { type: Date }
}, {
  timestamps: true,
  expires: 3600
});

export const MessageBuffer = mongoose.models.MessageBuffer || mongoose.model<IMessageBuffer>('MessageBuffer', messageBufferSchema);

