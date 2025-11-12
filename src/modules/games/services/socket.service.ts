import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
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


  private logEvent(socket: Socket, event: string, data?: any) {
    const logData: any = {
      event,
      socketId: socket.id,
      room: socket.data.roomCode,
      playerId: socket.data.playerId
    };

    if (data !== undefined) {
      logData.payloadSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
      logData.data = data;
    }

    logger.info(`📡 [${event}]`, logData);
  }

  private handleError(socket: Socket, error: Error, context: string) {
    logger.error(`❌ [${context}]`, {
      error: error.message,
      stack: error.stack,
      socketId: socket.id,
      room: socket.data.roomCode
    });

    // Send error to client
    socket.emit('error', {
      message: `Error in ${context}: ${error.message}`,
      code: 'SOCKET_ERROR'
    });
  }

  private initializeSocket(): void {
    logger.info('🚀 WebSocket server is now listening for connections on path: /ws/socket.io');
    
    this.io.on('connection', (socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>) => {
      const connectionTime = new Date();
      logger.info('🆕 New WebSocket connection', { 
        socketId: socket.id,
        clientCount: this.io.engine.clientsCount,
        handshake: socket.handshake,
        connectionTime: connectionTime.toISOString()
      });

      // Store player and room information in the socket
      socket.data = {
        playerId: '',
        roomCode: ''
      };

      // Log when client is authenticated (if using authentication)
      socket.on('authenticated', () => {
        logger.info('🔑 Client authenticated', { socketId: socket.id });
      });

      // Handle joining a room
      socket.on('join_room', async ({ roomCode, playerName, isHost = false }, callback) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        
        try {
          this.logEvent(socket, 'join_room_attempt', { roomCode, playerName, isHost, requestId });
          
          let room: any;
          let player: any;

          if (isHost) {
            logger.info('🎮 Creating new room', { requestId, roomCode, playerName });
            room = await gameService.createRoom(playerName, roomCode);
            player = room.players[0];
          } else {
            logger.info('🚪 Joining existing room', { requestId, roomCode, playerName });
            const result = await gameService.joinRoom(roomCode, playerName);
            if (!result) {
              const errorMsg = 'Failed to join room. It may not exist or the game has already started.';
              logger.warn('❌ Failed to join room', { requestId, roomCode, error: errorMsg });
              socket.emit('error', { message: errorMsg });
              if (callback) callback({ success: false, error: errorMsg });
              return;
            }
            room = result.room;
            player = result.player;
          }

          // Join the socket room
          await socket.join(room.code);
          
          // Store player and room info
          socket.data = {
            playerId: player.id,
            roomCode: room.code
          };

          logger.info('✅ Player joined room', { 
            requestId, 
            playerName, 
            playerId: player.id, 
            roomCode: room.code, 
            socketId: socket.id,
            activeRooms: Array.from(socket.rooms)
          });
          
          // Send room data to the joining player
          socket.emit('room_joined', { 
            room: room,
            player: player 
          });

          // Notify other players in the room
          if (!isHost) {
            socket.to(room.code).emit('player_joined', { 
              players: room.players 
            });
          }

          if (callback) callback({ success: true, room, player });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
          logger.error('❌ Error in join_room', { 
            requestId, 
            error: errorMsg, 
            stack: error instanceof Error ? error.stack : undefined 
          });
          socket.emit('error', { message: errorMsg });
          if (callback) callback({ success: false, error: errorMsg });
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
          this.handlePlayerDisconnect(roomCode, playerId, socket.id);
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