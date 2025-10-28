import { App } from '../app';
import http from 'http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User, { IUser } from '../modules/users/user.model';

let testApp: App;
let testServer: http.Server;

/**
 * Initialize the test application
 */
export const initTestApp = async (): Promise<{ app: App; server: http.Server }> => {
  process.env.NODE_ENV = 'test';
  
  testApp = new App();
  testServer = await testApp.initialize();
  
  return { app: testApp, server: testServer };
};

/**
 * Close the test application
 */
export const closeTestApp = async (): Promise<void> => {
  if (testServer) {
    await new Promise<void>((resolve, reject) => {
      testServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Close the default Mongoose connection
  await mongoose.connection.close();
};

/**
 * Create a test user in the database
 * @param userData - Optional user data to override defaults
 * @returns The created user document
 */
export const createTestUser = async (userData: Partial<IUser> = {}): Promise<IUser> => {
  const defaultUser: Partial<IUser> = {
    username: `testuser${Date.now()}`,
    email: `test-${Date.now()}@example.com`,
    password: 'password123',
    role: 'player',
    stats: {
      gamesPlayed: 0,
      accuracy: 0,
      bestScore: 0,
      totalCorrectAnswers: 0,
      totalQuestionsAnswered: 0,
      totalTimePlayed: 0,
      averageAccuracy: 0
    },
    ...userData
  };

  if (defaultUser.password) {
    defaultUser.password = await bcrypt.hash(defaultUser.password, 10);
  }

  const user = new User(defaultUser);
  await user.save();
  return user;
};

/**
 * Generate a JWT token for a user
 * @param user - The user object (must have at least an id)
 * @returns A JWT token
 */
export const getAuthToken = (user: { id: string; [key: string]: any }): string => {
  const payload = { id: user.id };
  return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
    expiresIn: '1h'
  });
};

/**
 * Clear all test data from the database
 */
export const clearTestData = async (): Promise<void> => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearTestData can only be used in test environment');
  }

  const collections = mongoose.connection.collections;
  
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};
