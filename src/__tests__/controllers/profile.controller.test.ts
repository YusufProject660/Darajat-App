import request from 'supertest';
import { Server } from 'http';
import { initTestApp, closeTestApp, createTestUser, getAuthToken, clearTestData } from '../../test/test-utils';

import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

describe('Profile Controller', () => {
  let server: Server;
  let authToken: string;
  let testUser: any;

  beforeAll(async () => {
    // Initialize test app and server
    const { server: testServer } = await initTestApp();
    server = testServer;
    
    // Create a test user and get auth token
    testUser = await createTestUser({
      username: 'profiletest',
      email: 'profile@test.com',
      stats: {
        gamesPlayed: 5,
        accuracy: 85,
        bestScore: 1000
      },
      avatar: 'http://example.com/avatar.jpg'
    });
    
    authToken = await getAuthToken(testUser);
  });

  afterAll(async () => {
    // Clean up test data and close connections
    await clearTestData();
    await closeTestApp();
  });

  afterEach(async () => {
    // Clear all mocks after each test
    jest.clearAllMocks();
  });

  describe('GET /api/user/profile', () => {
    it('should return 401 if no token is provided', async () => {
      const response = await request(server)
        .get('/api/user/profile')
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Not authorized, no token');
    });

    it('should return 401 if token is invalid', async () => {
      const response = await request(server)
        .get('/api/user/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Not authorized, token failed');
    });

    it('should return 404 if user not found', async () => {
      // Create a valid token for a non-existent user
      const nonExistentUser = {
        _id: new mongoose.Types.ObjectId(),
        email: 'nonexistent@test.com'
      };
      
      // Generate a token manually to avoid the test user creation
      const invalidToken = jwt.sign(
        { id: nonExistentUser._id, email: nonExistentUser.email },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: '1d' }
      );

      const response = await request(server)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body).toEqual({ message: 'User not found' });
    });

    it('should return user profile with valid token', async () => {
      const response = await request(server)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'User profile fetched successfully',
        data: {
          userId: testUser._id.toString(),
          fullName: testUser.username,
          email: testUser.email,
          username: testUser.username,
          avatarUrl: testUser.avatar,
          stats: {
            gamesPlayed: testUser.stats.gamesPlayed,
            accuracy: testUser.stats.accuracy,
            bestScore: testUser.stats.bestScore
          }
        }
      });
    });

    it('should not include sensitive information in the response', async () => {
      const response = await request(server)
        .get('/api/user/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Check that sensitive fields are not included
      const userData = response.body.data;
      expect(userData).not.toHaveProperty('password');
      expect(userData).not.toHaveProperty('resetToken');
      expect(userData).not.toHaveProperty('resetTokenExpires');
      expect(userData).not.toHaveProperty('__v');
    });
  });
});
