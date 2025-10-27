import mongoose from 'mongoose';
import { config } from './env';

export const connectDB = async (): Promise<mongoose.Connection> => {
  try {
    const conn = await mongoose.connect(config.mongoURI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    return conn.connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;
