import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../../../config/env';
import User from '../../users/user.model';
import { gameService } from './game.service';
import { ClientEvents, InterServerEvents, ServerEvents, SocketData } from '../types/game.types';
import { logger } from '../../../utils/logger';

export class SocketService {
  private static instance: SocketService;
  private io: SocketIOServer<ClientEvents, ServerEvents, InterServerEvents, SocketData>;
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();

  private constructor(_server: HttpServer, io: SocketIOServer) {
    this.io = io;
    this.initializeSocket();
  }

  public static getInstance(server?: HttpServer, io?: SocketIOServer): SocketService {
    if (!SocketService.instance && server && io) {
      // The Socket.IO server is already configured in app.ts
      SocketService.instance = new SocketService(server, io);
    }
    return SocketService.instance;
  }

  private async handlePlayerDisconnect(socket: Socket, playerId: string, roomCode: string): Promise<void> {
    if (!roomCode || !playerId || !socket?.id) {
      logger.warn('Invalid disconnect parameters', { roomCode, playerId, socketId: socket?.id });
      return;
    }
    try {
      logger.info('Player disconnecting from game', {
        roomCode,
        playerId,
        socketId: socket.id,
        timestamp: new Date().toISOString()
      });

      // Notify other players in the room about the disconnection
      this.io.to(roomCode).emit('player:disconnected', {
        playerId,
        timestamp: new Date().toISOString(),
        reason: 'connection_lost'
      });

      // Update game state through game service
      await gameService.handlePlayerDisconnect(socket, playerId, roomCode);

      // Clean up any active timers for this player
      const timerKey = `${roomCode}:${playerId}`;
      const existingTimer = this.activeTimers.get(timerKey);
      
      // Notify other players in the room
      socket.to(roomCode).emit('player:left', { playerId });
      
      // Clean up the room if empty
      const sockets = await this.io?.in(roomCode).fetchSockets();
      if (sockets && sockets.length === 0) {
        logger.info(`Room ${roomCode} is empty, cleaning up...`);
        try {
          await gameService.cleanupRoom(roomCode);
        } catch (error) {
          logger.error('Error cleaning up room:', error);
        }
      }
    } catch (error) {
      logger.error('Error handling player disconnect:', error);
    }
  }

  private validateSocketData(data: any): data is SocketData {
    if (typeof data !== 'object' || data === null) {
      return false;
    }

    const requiredFields = {
      playerId: 'string',
      roomCode: 'string',
      user: 'object'
    };

    // Check required fields exist and have correct types
    for (const [field, type] of Object.entries(requiredFields)) {
      if (!(field in data) || typeof data[field] !== type) {
        logger.warn(`Invalid socket data: missing or invalid field '${field}'`, { data });
        return false;
      }
    }

    // Validate user object
    const user = data.user;
    if (!user.id || typeof user.id !== 'string' || !user.username || typeof user.username !== 'string') {
      logger.warn('Invalid user data in socket', { user });
      return false;
    }

    return true;
  }

  private getSocketData(socket: Socket): SocketData {
    if (!socket.data) {
      throw new Error('No data found in socket');
    }
    
    if (!this.validateSocketData(socket.data)) {
      logger.error('Invalid socket data structure', { socketData: socket.data });
      throw new Error('Invalid socket data structure');
    }
    
    return socket.data;
  }

  private logEvent(socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>, event: string, data?: unknown) {
    try {
      const socketData = this.getSocketData(socket);
      const logData = {
        event,
        socketId: socket.id,
        room: socketData.roomCode,
        playerId: socketData.playerId,
        ...(data !== undefined && {
          payloadSize: typeof data === 'string' ? data.length : JSON.stringify(data).length,
          data
        })
      };

      logger.info(`📡 [${event}]`, logData);
    } catch (error) {
      logger.error('Failed to log event', {
        event,
        socketId: socket.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private handleError(socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>, error: Error, context: string) {
    try {
      const roomCode = this.getSocketData(socket).roomCode;
      logger.error(`❌ [${context}]`, {
        error: error.message,
        stack: error.stack,
        socketId: socket.id,
        room: roomCode
      });

      // Send error to client
      socket.emit('error', {
        message: `Error in ${context}: ${error.message}`,
        code: 'SOCKET_ERROR'
      });
    } catch (err) {
      // Fallback in case we can't even get socket data
      logger.error(`❌ [${context}] Failed to handle error`, {
        originalError: error.message,
        socketId: socket.id,
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }

  private async authenticateSocket(socket: Socket, next: (err?: Error) => void) {
    try {
      const token = socket.handshake.auth.token || 
                   (socket.handshake.headers.authorization?.split(' ')[1]);
      
      if (!token) {
        logger.warn('Socket connection attempt without token', { 
          socketId: socket.id,
          auth: socket.handshake.auth,
          headers: socket.handshake.headers
        });
        return next(new Error('Authentication error: No token provided'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.secret) as { userId: string; username: string; [key: string]: any };
      
      // Get room code from handshake
      const roomCode = socket.handshake.query.roomCode as string;
      if (!roomCode) {
        throw new Error('Room code is required');
      }
      

      // Get user from database
      const user = await User.findById(new Types.ObjectId(decoded.id)).select('-password');
      
      if (!user) {
        logger.warn('User not found for token', { userId: decoded.id, socketId: socket.id });
        return next(new Error('Authentication error: User not found'));
      }

      // Attach user to socket for use in connection handler
      socket.data.user = {
        _id: user._id,
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role || 'player',
        stats: user.stats || {
          gamesPlayed: 0,
          accuracy: 0,
          bestScore: 0
        }
      };

      logger.info('Socket authenticated', { 
        userId: user._id, 
        username: user.username,
        socketId: socket.id 
      });
      
      next();
    } catch (error) {
      logger.error('Socket authentication error', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        socketId: socket.id 
      });
      next(new Error('Authentication error: Invalid or expired token'));
    }
  }

  private initializeSocket(): void {
    logger.info('🚀 WebSocket server is now listening for connections on path: /ws/socket.io');
    
    // Apply authentication middleware
    this.io.use((socket, next) => this.authenticateSocket(socket as Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>, next));
    
    this.io.on('connection', (socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>) => {
      const connectionTime = new Date();
      logger.info('🆕 New WebSocket connection', { 
        socketId: socket.id,
        clientCount: this.io.engine.clientsCount,
        handshake: socket.handshake,
        connectionTime: connectionTime.toISOString()
      });

      // Initialize socket data with default values
      socket.data = {
        playerId: '',
        roomCode: ''
      } as SocketData;

      // Log when client is authenticated (if using authentication)
      socket.on('authenticated', () => {
        logger.info('🔑 Client authenticated', { socketId: socket.id });
      });

      // Handle joining a room
      socket.on('room:join', async ({ roomCode, playerName, isHost = false }, callback) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const safeCallback = (response: any) => {
          try {
            if (typeof callback === 'function') {
              callback(response);
            }
          } catch (err) {
            logger.error('Error in room:join callback', {
              requestId,
              error: err instanceof Error ? err.message : 'Unknown error',
              response
            });
          }
        };
        
        try {
          if (!roomCode || !playerName) {
            const errorMsg = 'Room code and player name are required';
            logger.warn('❌ Invalid join request', { requestId, roomCode, playerName });
            socket.emit('error', { message: errorMsg });
            return safeCallback({ success: false, error: errorMsg });
          }

          this.logEvent(socket, 'join_room_attempt', { roomCode, playerName, isHost, requestId });
          
          let room: any;
          let player: any;

          try {
            if (isHost) {
              logger.info('🎮 Creating new room', { requestId, roomCode, playerName });
              room = await gameService.createRoom(playerName, roomCode);
              player = room.players[0];
            } else {
              logger.info('🚪 Joining existing room', { requestId, roomCode, playerName });
              const updatedRoom = await gameService.joinRoom(roomCode, { 
                username: playerName,
                userId: new Types.ObjectId(),
                isReady: false,
                score: 0
              });
              
              if (!updatedRoom) {
                const errorMsg = 'Failed to join room. It may not exist or the game has already started.';
                throw new Error(errorMsg);
              }
              
              room = updatedRoom;
              // Find the player that was just added (should be the last one in the array)
              player = updatedRoom.players[updatedRoom.players.length - 1];
            }

            // Join the socket room
            await socket.join(room.code);
            
            // Store player and room info with type safety
            const socketData: SocketData = {
              playerId: player.id,
              roomCode: room.code
            };
            socket.data = socketData;

            logger.info('✅ Player joined room', { 
              requestId, 
              playerName, 
              playerId: player.id,
              roomCode: room.code,
              socketId: socket.id,
              activeRooms: Array.from(socket.rooms)
            });
            
            // Successfully joined the room
            safeCallback({ 
              success: true,
              room,
              player
            });
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
            logger.error('❌ Error in room:join', { 
              requestId, 
              error: errorMsg, 
              stack: error instanceof Error ? error.stack : undefined
            });
            safeCallback({ success: false, error: errorMsg });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
          logger.error('❌ Error in room:join', { 
            requestId, 
            error: errorMsg, 
            stack: error instanceof Error ? error.stack : undefined
          });
          safeCallback({ success: false, error: errorMsg });
        }
      });

      // Handle answer submission
      socket.on('answer:submit', async (
        data: { questionId: string; answer: any },
        callback: (response: { success: boolean; error?: string; data?: any }) => void
      ) => {
        try {
          if (!socket.data) {
            return callback?.({ success: false, error: 'Socket data not available' });
          }
          
          const { questionId, answer } = data;
          const roomCode = this.getSocketData(socket).roomCode;
          const playerId = this.getSocketData(socket).playerId;
          
          if (!roomCode || !playerId) {
            return callback?.({ 
              success: false, 
              error: 'Not in a room or player ID not found' 
            });
          }

          const result = await gameService.submitAnswer(roomCode, playerId, questionId, answer);
          
          // Notify all players about the answer
          this.io.to(roomCode).emit('question:answered', {
            playerId,
            isCorrect: result.correct,
            score: result.score
          });
          
          // Note: updateLeaderboard method doesn't exist in GameService, removed for now
          // If needed, implement updateLeaderboard method in GameService
          
          callback?.({ 
            success: true, 
            data: result 
          });
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to submit answer';
          this.handleError(socket, error, 'answer:submit');
          callback?.({
            success: false,
            error: errorMessage
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        const { roomCode, playerId } = socket.data;
        const connectionDuration = new Date().getTime() - connectionTime.getTime();
        
        logger.info('👋 Client disconnected', { 
          socketId: socket.id, 
          reason,
          roomCode,
          playerId,
          connectionDuration: `${connectionDuration}ms`,
          activeConnections: this.io.engine.clientsCount
        });

        // Handle player disconnection from game
        if (roomCode && playerId) {
          this.handlePlayerDisconnect(socket, playerId, roomCode);
        }
      });

      // Handle errors
      socket.on('error', (error) => {
        logger.error('🔥 Socket error', {
          socketId: socket.id,
          error: error.message,
          stack: error.stack
        });
      });

      // Log all incoming messages
      socket.onAny((event, ...args) => {
        if (event !== 'heartbeat') { // Skip heartbeat logs to reduce noise
          this.logEvent(socket, `RECEIVED_${event}`, args);
        }
      });
    });

    // Add global error handlers
    this.io.engine.on('connection_error', (error) => {
      logger.error('🚨 Engine connection error', {
        error: error.message,
        stack: error.stack,
        description: error.description,
        context: error.context
      });
    });

    // Log server stats periodically
    setInterval(() => {
      const sockets = this.io.sockets.sockets;
      const roomCount = this.io.sockets.adapter.rooms.size;
      
      logger.info('📊 Server Stats', {
        timestamp: new Date().toISOString(),
        activeConnections: this.io.engine.clientsCount,
        activeRooms: roomCount,
        memoryUsage: process.memoryUsage()
      });
    }, 300000); // Every 5 minutes
  }

  // ... rest of your SocketService methods ...
}

// Helper function to initialize socket service
export function initializeSocket(server: HttpServer, io: SocketIOServer): SocketService {
  // Socket.IO is already configured in app.ts
  // Just return the service instance
  return SocketService.getInstance(server, io);
}