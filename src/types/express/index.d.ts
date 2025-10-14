import { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      user?: {
        _id: Types.ObjectId | string;
        role: 'player' | 'admin';
      } | null;
    }
  }
}
