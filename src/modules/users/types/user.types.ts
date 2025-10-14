import { Document } from 'mongoose';

export interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  avatar?: string;
  googleId?: string;
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  role: 'player' | 'admin';
  matchPassword(enteredPassword: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role: 'player' | 'admin';
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData extends LoginCredentials {
  username: string;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: 'player' | 'admin';
  };
}

export interface TokenPayload {
  id: string;
  role: 'player' | 'admin';
  iat: number;
  exp: number;
}

// For updating user profile
export interface UpdateProfileData {
  username?: string;
  email?: string;
  avatar?: string;
  currentPassword?: string;
  newPassword?: string;
}

// For admin operations
export interface AdminUpdateUserData {
  role?: 'player' | 'admin';
  isActive?: boolean;
  stats?: {
    gamesPlayed?: number;
    accuracy?: number;
    bestScore?: number;
  };
}
