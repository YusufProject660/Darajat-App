import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../../config/env';
import User from '../users/user.model';
import { gameService } from './services/game.service';
import { ClientEvents, InterServerEvents, ServerEvents, SocketData } from './types/game.types';
import { logger } from '../../utils/logger';

/**
 * Authenticate socket connection using JWT token
 */
async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
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
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string; userId?: string; username: string; [key: string]: any };
    const userId = decoded.id || decoded.userId;
    
    if (!userId) {
      return next(new Error('Authentication error: Invalid token'));
    }

    // Get room code from handshake (optional for initial connection)
    const roomCode = socket.handshake.query.roomCode as string;

    // Get user from database
    const user = await User.findById(new Types.ObjectId(userId)).select('-password');
    
    if (!user) {
      logger.warn('User not found for token', { userId, socketId: socket.id });
      return next(new Error('Authentication error: User not found'));
    }

    // Attach user to socket
    socket.data = {
      playerId: user._id.toString(),
      roomCode: roomCode || '',
      user: {
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
      }
    } as SocketData;

    // Console log for socket authentication
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🔐 SOCKET AUTHENTICATED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('User ID:', user._id.toString());
    console.log('Username:', user.username);
    console.log('Email:', user.email);
    console.log('Avatar:', user.avatar || 'No avatar');
    console.log('Role:', user.role || 'player');
    console.log('Socket ID:', socket.id);
    console.log('Room Code from handshake:', roomCode || 'Not provided');
    console.log('Socket Data Attached:', {
      playerId: user._id.toString(),
      roomCode: roomCode || '',
      user: {
        id: user._id.toString(),
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role || 'player'
      }
    });
    console.log('═══════════════════════════════════════════════════════════');

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

/**
 * Handle player joining a room
 */
async function handleJoinRoom(
  _io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>,
  data: { 
    roomCode: string; 
    playerName: string; 
    isHost?: boolean;
    settings?: {
      numberOfQuestions?: number;
      maximumPlayers?: number;
      categories?: { [key: string]: { enabled: boolean; difficulty: 'easy' | 'medium' | 'hard' } };
    };
  },
  callback?: (response: { success: boolean; room?: any; player?: any; error?: string }) => void
) {
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
    const { roomCode, playerName, isHost = false } = data;
    const socketData = socket.data;

    if (!roomCode || !playerName) {
      const errorMsg = 'Room code and player name are required';
      logger.warn('❌ Invalid join request', { requestId, roomCode, playerName });
      socket.emit('error:general', { code: 'VALIDATION_ERROR', message: errorMsg });
      return safeCallback({ success: false, error: errorMsg });
    }

    if (!socketData || !socketData.user) {
      const errorMsg = 'Socket not authenticated';
      return safeCallback({ success: false, error: errorMsg });
    }

    const userId = socketData.user.id;
    const username = socketData.user.username || playerName;

    // Console log for room join attempt
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎮 ROOM JOIN ATTEMPT');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Request ID:', requestId);
    console.log('Room Code:', roomCode);
    console.log('Player Name:', playerName);
    console.log('Is Host:', isHost);
    console.log('User ID:', userId);
    console.log('Username:', username);
    console.log('Socket ID:', socket.id);
    console.log('═══════════════════════════════════════════════════════════');

    logger.info('🎮 Room join attempt', { requestId, roomCode, playerName, isHost, userId });

    let room: any;
    let player: any;

    try {
      if (isHost) {
        console.log('🎮 CREATING NEW ROOM');
        console.log('Host Name:', username);
        console.log('Room Code:', roomCode);
        console.log('Host ID:', userId);
        console.log('Settings:', data.settings || 'Using defaults');
        
        logger.info('🎮 Creating new room', { requestId, roomCode, playerName, userId, settings: data.settings });
        // createRoom expects (hostName, roomCode, hostId, settings?)
        room = await gameService.createRoom(username, roomCode, userId, data.settings);
        player = room.players?.[0];
        
        console.log('✅ Room Created Successfully');
        console.log('Room Data:', {
          roomCode: room.roomCode,
          status: room.status,
          playersCount: room.players?.length || 0,
          hostId: room.hostId
        });
      } else {
        console.log('🚪 JOINING EXISTING ROOM');
        console.log('Room Code:', roomCode);
        console.log('Player Data:', {
          userId: userId,
          username: username,
          avatar: socketData.user.avatar,
          isReady: false,
          score: 0
        });
        
        logger.info('🚪 Joining existing room', { requestId, roomCode, playerName, userId });
        // Fix: joinRoom expects (roomCode, playerData) where playerData has userId
        const updatedRoom = await gameService.joinRoom(roomCode, { 
          userId: new Types.ObjectId(userId),
          username: username,
          isReady: false,
          score: 0,
          avatar: socketData.user.avatar
        });
        
        if (!updatedRoom) {
          const errorMsg = 'Failed to join room. It may not exist or the game has already started.';
          console.error('❌ Failed to join room:', errorMsg);
          throw new Error(errorMsg);
        }
        
        room = updatedRoom;
        // Find the player that was just added
        player = updatedRoom.players?.find((p: any) => 
          p.userId?.toString() === userId || p.userId === userId
        ) || updatedRoom.players?.[updatedRoom.players.length - 1];
        
        console.log('✅ Successfully Joined Room');
        console.log('Room Status:', room.status);
        console.log('Total Players:', room.players?.length || 0);
      }

      // Join the socket room
      await socket.join(roomCode);
      
      // Update socket data
      socket.data.roomCode = roomCode;
      socket.data.playerId = userId;

      // Console log for successful room join
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ PLAYER JOINED ROOM SUCCESSFULLY');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Player Data:', {
        playerId: userId,
        username: username,
        avatar: socketData.user.avatar,
        isHost: isHost || false,
        score: 0
      });
      console.log('Room Code:', roomCode);
      console.log('Socket ID:', socket.id);
      console.log('Active Rooms:', Array.from(socket.rooms));
      console.log('Total Players in Room:', room.players?.length || 0);
      console.log('All Players in Room:', (room.players || []).map((p: any) => ({
        userId: p.userId?.toString() || p.userId,
        username: p.username,
        isHost: p.isHost,
        score: p.score || 0
      })));
      console.log('═══════════════════════════════════════════════════════════');

      logger.info('✅ Player joined room', { 
        requestId, 
        playerName, 
        playerId: userId,
        roomCode,
        socketId: socket.id,
        activeRooms: Array.from(socket.rooms),
        totalPlayers: room.players?.length || 0
      });
      
      // Notify other players in the room
      console.log('📢 Broadcasting player:joined event to other players in room:', roomCode);
      socket.to(roomCode).emit('player:joined', {
        player: {
          id: userId,
          userId: userId,
          username: username,
          avatar: socketData.user.avatar,
          score: 0,
          isHost: room.hostId?.toString() === userId || isHost || false
        },
        players: (room.players || []).map((p: any) => ({
          id: p.userId?.toString() || p.userId || p.id,
          userId: p.userId?.toString() || p.userId || p.id,
          username: p.username,
          avatar: p.avatar,
          score: p.score || 0,
          isHost: p.isHost || false
        }))
      });
      console.log('✅ Event broadcasted to', room.players?.length - 1 || 0, 'other players');
      
      // Successfully joined the room
      safeCallback({ 
        success: true,
        room: {
          ...room,
          code: room.roomCode || roomCode
        },
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
      error: errorMsg
    });
    safeCallback({ success: false, error: errorMsg });
  }
}

/**
 * Handle answer submission
 */
async function handleSubmitAnswer(
  io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>,
  data: { questionId: string; answer: any },
  callback?: (response: { success: boolean; error?: string; data?: any }) => void
) {
  try {
    const socketData = socket.data;
    
    if (!socketData || !socketData.user) {
      return callback?.({ success: false, error: 'Socket not authenticated' });
    }
    
    const { questionId, answer } = data;
    const roomCode = socketData.roomCode;
    const playerId = socketData.playerId || socketData.user.id;
    
    if (!roomCode || !playerId) {
      return callback?.({ 
        success: false, 
        error: 'Not in a room or player ID not found' 
      });
    }

    const result = await gameService.submitAnswer(roomCode, playerId, questionId, answer);
    
    // Notify all players about the answer
    io.to(roomCode).emit('question:answered', {
      playerId,
      isCorrect: result.correct,
      score: result.score
    });
    
    callback?.({ 
      success: true, 
      data: result 
    });
  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to submit answer';
    logger.error('Error submitting answer', {
      error: errorMessage,
      socketId: socket.id,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    socket.emit('error:game', {
      code: 'SOCKET_ERROR',
      message: `Error in answer:submit: ${errorMessage}`,
      recoverable: true
    });
    
    callback?.({
      success: false,
      error: errorMessage
    });
  }
}

/**
 * Handle player disconnection
 */
async function handleDisconnect(
  io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>
) {
  const socketData = socket.data;
  const roomCode = socketData?.roomCode;
  const playerId = socketData?.playerId || socketData?.user?.id;

  logger.info('👋 Client disconnected', { 
    socketId: socket.id, 
    roomCode,
    playerId,
    activeConnections: io.engine.clientsCount
  });

  // Handle player disconnection from game
  if (roomCode && playerId) {
    try {
      // Update game state through game service (it will emit the disconnect event)
      await gameService.handlePlayerDisconnect(socket, playerId, roomCode);

      // Clean up the room if empty
      const sockets = await io.in(roomCode).fetchSockets();
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
}

/**
 * Setup socket handlers - Main entry point
 */
export function setupSocketHandlers(io: SocketIOServer<ClientEvents, ServerEvents, InterServerEvents, SocketData>): void {
  logger.info('🚀 WebSocket server is now listening for connections on path: /ws/socket.io');
  
  // Apply authentication middleware
  io.use((socket, next) => authenticateSocket(socket as Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>, next));
  
  // Handle new connections
  io.on('connection', (socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>) => {
    const connectionTime = new Date();
    
    // Console log for new user connection
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🆕 NEW USER CONNECTED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Socket ID:', socket.id);
    console.log('Connection Time:', connectionTime.toISOString());
    console.log('Total Active Connections:', io.engine.clientsCount);

    // Initialize socket data with default values if not set by auth
    if (!socket.data) {
      socket.data = {
        playerId: '',
        roomCode: ''
      } as SocketData;
    }
    
    // Log user data if available
    if (socket.data?.user) {
      console.log('User Data:', {
        userId: socket.data.user.id,
        username: socket.data.user.username,
        email: socket.data.user.email,
        avatar: socket.data.user.avatar,
        role: socket.data.user.role
      });
    } else {
      console.log('⚠️ User data not available yet (will be set after authentication)');
    }
    console.log('═══════════════════════════════════════════════════════════');
    
    logger.info('🆕 New WebSocket connection', { 
      socketId: socket.id,
      clientCount: io.engine.clientsCount,
      connectionTime: connectionTime.toISOString(),
      userData: socket.data?.user || null
    });

    // Handle joining a room
    socket.on('room:join', async (data, callback) => {
      await handleJoinRoom(io, socket, data, callback);
    });

    // Handle answer submission
    socket.on('answer:submit' as any, async (data: { questionId: string; answer: any }, callback?: (response: { success: boolean; error?: string; data?: any }) => void) => {
      await handleSubmitAnswer(io, socket, data, callback);
    });

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      logger.info('👋 Client disconnecting', { 
        socketId: socket.id, 
        reason,
        connectionDuration: `${new Date().getTime() - connectionTime.getTime()}ms`
      });
      await handleDisconnect(io, socket);
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('🔥 Socket error', {
        socketId: socket.id,
        error: error.message,
        stack: error.stack
      });
    });
  });

  // Add global error handlers
  io.engine.on('connection_error', (error) => {
    logger.error('🚨 Engine connection error', {
      error: error.message,
      stack: error.stack,
      description: error.description,
      context: error.context
    });
  });

  // Log server stats periodically (every 5 minutes)
  setInterval(() => {
    const roomCount = io.sockets.adapter.rooms.size;
    
    logger.info('📊 Server Stats', {
      timestamp: new Date().toISOString(),
      activeConnections: io.engine.clientsCount,
      activeRooms: roomCount,
      memoryUsage: process.memoryUsage()
    });
  }, 300000);
}

