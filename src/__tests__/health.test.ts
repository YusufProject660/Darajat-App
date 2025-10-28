import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { Server } from 'http';
import { initTestApp, closeTestApp } from '../test/test-utils';

describe('Health Check', () => {
  let server: Server;

  beforeAll(async (): Promise<void> => {
    // Initialize test app and get server instance
    const { server: testServer } = await initTestApp();
    server = testServer;
  });

  afterAll(async (): Promise<void> => {
    // Close the test app
    await closeTestApp();
  });

  it('should return 200 and status ok for health check', async (): Promise<void> => {
    const response = await request(server).get('/health');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
