import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../../config/env';
import User from '../users/user.model';
import { gameService } from './services/game.service';
import { GameRoom } from './models/gameRoom.model';
import { Question } from './models/question.model';
import { ClientEvents, InterServerEvents, ServerEvents, SocketData } from './types/game.types';
import { logger } from '../../utils/logger';
import { bufferManager } from './utils/bufferManager';

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
  io: SocketIOServer,
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
      
      // Notify other players in the room with buffer tracking
      console.log('═══════════════════════════════════════════════════════════');
      console.log('📢 [SOCKET HANDLER] Broadcasting player:joined event...');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🏠 Room Code:', roomCode);
      console.log('👤 User ID:', userId);
      console.log('👤 Username:', username);
      
      // Get all receivers (except sender)
      const socketsInRoom = await io.in(roomCode).fetchSockets();
      console.log('📊 Total Sockets in Room:', socketsInRoom.length);
      
      const receiverIds = socketsInRoom
        .filter(s => s.data?.user?.id && s.data.user.id !== userId)
        .map(s => s.data.user.id);

      console.log('👥 [RECEIVERS] Receiver IDs:', receiverIds);
      console.log('📊 [RECEIVERS] Receiver Count:', receiverIds.length);

      const hostIdForEvent = room.hostId?.toString();
      const playerJoinedData = {
        player: {
          id: userId,
          userId: userId,
          username: username,
          avatar: socketData.user.avatar,
          score: 0,
          isHost: hostIdForEvent === userId || isHost || false
        },
        players: (room.players || []).map((p: any) => {
          // Extract userId properly - handle ObjectId, string, or populated object
          let playerUserId: string;
          if (p.userId?._id) {
            playerUserId = p.userId._id.toString();
          } else if (p.userId?.toString) {
            playerUserId = p.userId.toString();
          } else if (typeof p.userId === 'string') {
            playerUserId = p.userId;
          } else {
            playerUserId = p.id || '';
          }
          
          // Check if player is host by comparing with hostId (ensure both are strings)
          const hostIdStr = hostIdForEvent?.toString() || '';
          const isHostPlayer = hostIdStr && (
            playerUserId === hostIdStr || 
            playerUserId.toString() === hostIdStr ||
            p.isHost === true
          );
          
          return {
            id: playerUserId,
            userId: playerUserId, // Ensure userId is always included
            username: p.username,
            avatar: p.avatar || '',
            score: p.score || 0,
            isHost: !!isHostPlayer // Convert to boolean explicitly
          };
        })
      };

      console.log('📦 [DATA] Player joined data prepared:', {
        player: playerJoinedData.player,
        totalPlayers: playerJoinedData.players.length
      });

      // Create buffer if there are receivers
      if (receiverIds.length > 0) {
        console.log('📦 [BUFFER] Creating buffer for', receiverIds.length, 'receivers...');
        
        const taskId = await bufferManager.createBuffer(
          roomCode,
          userId,
          'player:joined',
          playerJoinedData,
          receiverIds
        );

        console.log('✅ [BUFFER] Buffer created with taskId:', taskId);

        // Broadcast with taskId
        console.log('📤 [EMIT] Broadcasting player:joined event with buffer...');
        console.log('📋 [EMIT] TaskId:', taskId);
        console.log('📋 [EMIT] Sender ID:', userId);
        console.log('📋 [EMIT] Receivers:', receiverIds);
        
        socket.to(roomCode).emit('player:joined', {
          ...playerJoinedData,
          taskId,
          senderId: userId
        } as any);

        console.log('✅ [EMIT] player:joined event sent with buffer!');
        logger.info('📤 Player joined event sent with buffer', { 
          taskId, 
          roomCode, 
          receiverCount: receiverIds.length 
        });
      } else {
        // No receivers, normal emit (existing flow)
        console.log('📤 [EMIT] No receivers found - sending normal emit (no buffer)');
        socket.to(roomCode).emit('player:joined', playerJoinedData);
        console.log('✅ [EMIT] player:joined event sent (no buffer tracking)');
      }
      
      console.log('✅ [SOCKET HANDLER] Event broadcasted to', receiverIds.length || room.players?.length - 1 || 0, 'other players');
      console.log('═══════════════════════════════════════════════════════════');
      
      // Successfully joined the room - Convert to serializable object
      const serializableRoom = {
        roomCode: room.roomCode || roomCode,
        status: room.status,
        hostId: room.hostId?.toString() || room.hostId,
        players: (room.players || []).map((p: any) => ({
          userId: p.userId?.toString() || p.userId,
          username: p.username,
          avatar: p.avatar || '',
          score: p.score || 0,
          isHost: p.isHost || false,
          isReady: p.isReady || false
        })),
        code: room.roomCode || roomCode
      };

      const serializablePlayer = player ? {
        userId: player.userId?.toString() || player.userId,
        username: player.username,
        avatar: player.avatar || '',
        score: player.score || 0,
        isHost: player.isHost || false,
        isReady: player.isReady || false
      } : null;

      safeCallback({ 
        success: true,
        room: serializableRoom,
        player: serializablePlayer
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
 * Prepare leaderboard data for a specific question
 */
async function prepareQuestionLeaderboard(
  roomCode: string,
  questionId: string
): Promise<{
  leaderboard: Array<{
    playerId: string;
    username: string;
    avatar?: string;
    hasAnswered: boolean;
    isCorrect: boolean;
    selectedOption: number | null;
    score: number;
    timeTaken: number;
  }>;
  correctAnswer: number;
  totalPlayers: number;
  answeredPlayers: number;
}> {
  const room = await GameRoom.findOne({ roomCode });
  if (!room) {
    throw new Error('Room not found');
  }

  const question = await Question.findById(questionId);
  const correctAnswer = question?.correctAnswer ?? 0;

  const leaderboard = room.players.map((player: any) => {
    // Find answer for this player and question
    const answer = room.answeredQuestions?.find((aq: any) =>
      aq.playerId.toString() === player.userId.toString() &&
      aq.questionId.toString() === questionId
    );

    return {
      playerId: player.userId.toString(),
      username: player.username,
      avatar: player.avatar,
      hasAnswered: !!answer,
      isCorrect: answer?.isCorrect || false,
      selectedOption: answer?.selectedOption ?? null,
      score: player.score || 0,
      timeTaken: answer?.timeTaken || 0
    };
  });

  // Sort by score (descending)
  leaderboard.sort((a: any, b: any) => b.score - a.score);

  return {
    leaderboard,
    correctAnswer,
    totalPlayers: room.players.length,
    answeredPlayers: leaderboard.filter((p: any) => p.hasAnswered).length
  };
}

/**
 * Handle answer submission
 */
async function handleSubmitAnswer(
  io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>,
  data: { questionId: string; answer: any; timeTaken?: number },
  callback?: (response: { success: boolean; error?: string; data?: any }) => void
) {
  try {
    const socketData = socket.data;
    
    if (!socketData || !socketData.user) {
      return callback?.({ success: false, error: 'Socket not authenticated' });
    }
    
    const { questionId, answer, timeTaken = 0 } = data;
    const roomCode = socketData.roomCode;
    const playerId = socketData.playerId || socketData.user.id;
    
    if (!roomCode || !playerId) {
      return callback?.({ 
        success: false, 
        error: 'Not in a room or player ID not found' 
      });
    }

    const result = await gameService.submitAnswer(roomCode, playerId, questionId, answer, timeTaken);
    
    // Get question to get correctAnswer
    const question = await Question.findById(questionId);
    const correctAnswer = question?.correctAnswer?.toString() || '';
    
    // Get all receivers (except sender)
    const socketsInRoom = await io.in(roomCode).fetchSockets();
    const receiverIds = socketsInRoom
      .filter(s => s.data?.user?.id && s.data.user.id !== playerId)
      .map(s => s.data.user.id);

    const answerData = {
      playerId,
      isCorrect: result.correct,
      correctAnswer: correctAnswer,
      score: result.score
    };

    // Create buffer if there are receivers
    if (receiverIds.length > 0) {
      const taskId = await bufferManager.createBuffer(
        roomCode,
        playerId,
        'question:answered',
        answerData,
        receiverIds
      );

      // Broadcast with taskId (except sender)
      socket.to(roomCode).emit('question:answered', {
        ...answerData,
        taskId,
        senderId: playerId
      } as any);
    } else {
      // No receivers, normal emit (except sender)
      socket.to(roomCode).emit('question:answered', answerData);
    }
    
    // If all players answered, emit signal
    if (result.allPlayersAnswered) {
      io.to(roomCode).emit('all:answered', {
        questionId: questionId
      });
    }
    
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
 * Handle player leaving room
 */
async function handleLeaveRoom(
  io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>,
  data?: { roomCode?: string },
  callback?: (response: { success: boolean; error?: string }) => void
) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚪 [LEAVE ROOM] Event received');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    const socketData = socket.data;
    if (!socketData || !socketData.user) {
      console.log('❌ [ERROR] Socket not authenticated');
      return callback?.({ success: false, error: 'Socket not authenticated' });
    }

    const userId = socketData.user.id;
    const roomCode = data?.roomCode || socketData.roomCode;

    console.log('👤 User ID:', userId);
    console.log('👤 Username:', socketData.user.username);
    console.log('🏠 Room Code:', roomCode);

    if (!roomCode) {
      console.log('❌ [ERROR] Room code not found');
      return callback?.({ success: false, error: 'Room code not found' });
    }

    const session = await GameRoom.startSession();
    session.startTransaction();

    try {
      const room = await GameRoom.findOne({ roomCode }).session(session);
      if (!room) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Room not found:', roomCode);
        return callback?.({ success: false, error: 'Room not found' });
      }

      const player = room.players.find((p: any) => p.userId.toString() === userId);
      if (!player) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Player not in room');
        return callback?.({ success: false, error: 'Player not in room' });
      }

      const wasHost = player.isHost;
      let newHostId: string | undefined;

      console.log('📋 Player Info:', {
        userId: userId,
        username: player.username,
        isHost: wasHost,
        totalPlayersBefore: room.players.length
      });

      room.players = room.players.filter((p: any) => p.userId.toString() !== userId);

      console.log('📊 Players after removal:', room.players.length);

      if (wasHost && room.players.length > 0) {
        const newHost = room.players[0];
        newHost.isHost = true;
        newHostId = newHost.userId.toString();
        room.hostId = new Types.ObjectId(newHostId);
        console.log('👑 [HOST CHANGE] New host assigned:', newHostId);
        console.log('👑 [HOST CHANGE] New host username:', newHost.username);
      } else if (room.players.length === 0) {
        room.status = 'finished';
        room.finishedAt = new Date();
        console.log('🏁 [GAME FINISHED] No players left, game finished');
      }

      await room.save({ session });
      await session.commitTransaction();
      console.log('✅ [DB] Room updated successfully');

      await socket.leave(roomCode);
      socket.data.roomCode = '';
      console.log('🔌 [SOCKET] Socket left room:', roomCode);

      if (room.players.length === 0) {
        console.log('🧹 [CLEANUP] Cleaning up empty room...');
        await gameService.cleanupRoom(roomCode);
        console.log('✅ [CLEANUP] Room cleaned up');
        return callback?.({ success: true });
      }

      const playersList = room.players.map((p: any) => ({
        id: p.userId.toString(),
        userId: p.userId.toString(),
        username: p.username,
        avatar: p.avatar,
        score: p.score || 0,
        isHost: p.isHost || false
      }));

      const removedData = {
        playerId: userId,
        reason: 'left' as const,
        players: playersList,
        newHostId,
        roomCode
      };

      // Get receivers (all remaining players - leaving player already left room, but filter for safety)
      const remainingSockets = await io.in(roomCode).fetchSockets();
      const receiverIds = remainingSockets
        .filter(s => s.data?.user?.id && s.data.user.id !== userId) // Exclude leaving player
        .map(s => s.data.user.id);

      // Create buffer if receivers exist
      if (receiverIds.length > 0) {
        const taskId = await bufferManager.createBuffer(
          roomCode,
          userId,
          'player:removed',
          removedData,
          receiverIds
        );
        // Use socket.to() to explicitly exclude the leaving player (already left, but extra safety)
        socket.to(roomCode).emit('player:removed', {
          ...removedData,
          taskId,
          senderId: userId
        } as any);
      } else {
        socket.to(roomCode).emit('player:removed', removedData as any);
      }

      console.log('✅ [EMIT] player:removed event sent to', room.players.length, 'remaining players');
      console.log('✅ [SUCCESS] Player left room successfully');
      console.log('═══════════════════════════════════════════════════════════');

      callback?.({ success: true });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error: any) {
    console.log('❌ [ERROR] Error in room:leave:', error.message);
    console.log('═══════════════════════════════════════════════════════════');
    logger.error('Error in room:leave', { error: error.message });
    socket.emit('error:game', {
      code: 'LEAVE_ERROR',
      message: error.message || 'Failed to leave room',
      recoverable: true
    });
    callback?.({ success: false, error: error.message || 'Failed to leave room' });
  }
}

/**
 * Handle host kicking a player
 */
async function handleKickPlayer(
  io: SocketIOServer,
  socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>,
  data: { roomCode: string; playerId: string },
  callback?: (response: { success: boolean; error?: string }) => void
) {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('👢 [KICK PLAYER] Event received');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    const socketData = socket.data;
    if (!socketData || !socketData.user) {
      console.log('❌ [ERROR] Socket not authenticated');
      return callback?.({ success: false, error: 'Socket not authenticated' });
    }

    const currentUserId = socketData.user.id;
    const { roomCode, playerId } = data;

    console.log('👤 Host User ID:', currentUserId);
    console.log('👤 Host Username:', socketData.user.username);
    console.log('🎯 Target Player ID:', playerId);
    console.log('🏠 Room Code:', roomCode);

    if (!roomCode || !playerId) {
      console.log('❌ [ERROR] Room code and player ID are required');
      return callback?.({ success: false, error: 'Room code and player ID are required' });
    }

    const session = await GameRoom.startSession();
    session.startTransaction();

    try {
      const room = await GameRoom.findOne({ roomCode }).session(session);
      if (!room) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Room not found:', roomCode);
        return callback?.({ success: false, error: 'Room not found' });
      }

      const currentPlayer = room.players.find((p: any) => p.userId.toString() === currentUserId);
      if (!currentPlayer || !currentPlayer.isHost) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Only host can kick players');
        console.log('📋 Current Player:', {
          userId: currentUserId,
          isHost: currentPlayer?.isHost || false
        });
        return callback?.({ success: false, error: 'Only host can kick players' });
      }

      const targetPlayer = room.players.find((p: any) => p.userId.toString() === playerId);
      if (!targetPlayer) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Player not found in room');
        return callback?.({ success: false, error: 'Player not found in room' });
      }

      if (targetPlayer.isHost) {
        await session.abortTransaction();
        console.log('❌ [ERROR] Cannot kick the host');
        return callback?.({ success: false, error: 'Cannot kick the host' });
      }

      console.log('📋 Target Player Info:', {
        userId: playerId,
        username: targetPlayer.username,
        isHost: targetPlayer.isHost,
        totalPlayersBefore: room.players.length
      });

      room.players = room.players.filter((p: any) => p.userId.toString() !== playerId);

      console.log('📊 Players after kick:', room.players.length);

      await room.save({ session });
      await session.commitTransaction();
      console.log('✅ [DB] Room updated successfully');

      const socketsInRoom = await io.in(roomCode).fetchSockets();
      const targetSocket = socketsInRoom.find(s => s.data?.user?.id === playerId);
      
      if (targetSocket) {
        console.log('🔌 [SOCKET] Target socket found, removing from room...');
        await targetSocket.leave(roomCode);
        targetSocket.data.roomCode = '';
        console.log('✅ [SOCKET] Target socket removed from room');
        
        console.log('📤 [EMIT] Sending player:removed to kicked player...');
        targetSocket.emit('player:removed', {
          playerId,
          reason: 'kicked',
          players: room.players.map((p: any) => ({
            id: p.userId.toString(),
            userId: p.userId.toString(),
            username: p.username,
            avatar: p.avatar,
            score: p.score || 0,
            isHost: p.isHost || false
          })),
          roomCode
        } as any);
        console.log('✅ [EMIT] player:removed sent to kicked player');
      } else {
        console.log('⚠️ [WARNING] Target socket not found (player may have disconnected)');
      }

      const playersList = room.players.map((p: any) => ({
        id: p.userId.toString(),
        userId: p.userId.toString(),
        username: p.username,
        avatar: p.avatar,
        score: p.score || 0,
        isHost: p.isHost || false
      }));

      const removedData = {
        playerId,
        reason: 'kicked' as const,
        players: playersList,
        roomCode
      };

      // Get receivers (all remaining players except kicked player and host)
      // Note: Kicked player already left room, but filter for safety
      const receiverIds = socketsInRoom
        .filter(s => s.data?.user?.id && s.data.user.id !== playerId && s.data.user.id !== currentUserId)
        .map(s => s.data.user.id);

      // Create buffer if receivers exist
      if (receiverIds.length > 0) {
        const taskId = await bufferManager.createBuffer(
          roomCode,
          currentUserId,
          'player:removed',
          removedData,
          receiverIds
        );
        // Use socket.to() to explicitly exclude kicked player (already left, but extra safety)
        socket.to(roomCode).emit('player:removed', {
          ...removedData,
          taskId,
          senderId: currentUserId
        } as any);
      } else {
        socket.to(roomCode).emit('player:removed', removedData as any);
      }

      console.log('✅ [EMIT] player:removed event sent to', room.players.length, 'remaining players');
      console.log('✅ [SUCCESS] Player kicked successfully');
      console.log('═══════════════════════════════════════════════════════════');

      callback?.({ success: true });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error: any) {
    console.log('❌ [ERROR] Error in room:kick:', error.message);
    console.log('═══════════════════════════════════════════════════════════');
    logger.error('Error in room:kick', { error: error.message });
    socket.emit('error:game', {
      code: 'KICK_ERROR',
      message: error.message || 'Failed to kick player',
      recoverable: true
    });
    callback?.({ success: false, error: error.message || 'Failed to kick player' });
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
  
  // Initialize buffer manager
  bufferManager.initialize(io);
  
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

    // Handle leaving a room
    socket.on('room:leave' as any, async (data?: { roomCode?: string }, callback?: (response: { success: boolean; error?: string }) => void) => {
      await handleLeaveRoom(io, socket, data, callback);
    });

    // Handle kicking a player (host only)
    socket.on('room:kick' as any, async (data: { roomCode: string; playerId: string }, callback?: (response: { success: boolean; error?: string }) => void) => {
      await handleKickPlayer(io, socket, data, callback);
    });

    // Handle game start (host only)
    socket.on('game:start' as any, async (data?: any, callback?: (response: { success: boolean; error?: string; data?: any }) => void) => {
      try {
        // Handle case where callback is passed as first parameter (no data)
        if (typeof data === 'function') {
          callback = data;
          data = {};
        }

        const socketData = socket.data;
        if (!socketData || !socketData.user) {
          return callback?.({ success: false, error: 'Socket not authenticated' });
        }

        const userId = socketData.user.id;
        const roomCode = socketData.roomCode;

        if (!roomCode) {
          return callback?.({ success: false, error: 'Not in a room' });
        }

        const game = await GameRoom.findOne({ roomCode });
        if (!game) {
          return callback?.({ success: false, error: 'Game room not found' });
        }

        const isHost = game.players.some(
          (p: any) => p.userId.toString() === userId && p.isHost
        );

        if (!isHost) {
          return callback?.({ success: false, error: 'Only the host can start the game' });
        }

        if (game.status !== 'waiting') {
          return callback?.({ success: false, error: `Game is already started ${game.status}` });
        }

        if (game.players.length < 2) {
          return callback?.({ success: false, error: 'At least 2 players are required to start the game' });
        }

        const updatedGame = await gameService.startGame(roomCode, userId);
        if (!updatedGame) {
          return callback?.({ success: false, error: 'Failed to start game' });
        }

        io.to(roomCode).emit('game:started', {
          totalQuestions: game.questions?.length || 0
        });

        callback?.({ success: true, data: { roomCode, status: 'active' } });
      } catch (error: any) {
        logger.error('Error starting game via socket', { error: error.message });
        callback?.({ success: false, error: error.message || 'Failed to start game' });
      }
    });

    // Handle answer submission (including timeout - null answer means timeout)
    socket.on('answer:submit' as any, async (data: { questionId: string; answer: any; timeTaken?: number }, callback?: (response: { success: boolean; error?: string; data?: any }) => void) => {
      await handleSubmitAnswer(io, socket, data, callback);
    });

    // Handle question leaderboard request
    socket.on('question:leaderboard' as any, async (data: { questionId: string }, callback?: (response: { success: boolean; error?: string; data?: any }) => void) => {
      try {
        const socketData = socket.data;
        if (!socketData || !socketData.user) {
          return callback?.({ success: false, error: 'Socket not authenticated' });
        }

        const { questionId } = data;
        const roomCode = socketData.roomCode;
        const playerId = socketData.playerId || socketData.user.id;

        if (!roomCode || !playerId) {
          return callback?.({ success: false, error: 'Not in a room or player ID not found' });
        }

        // Prepare leaderboard data
        const leaderboardData = await prepareQuestionLeaderboard(roomCode, questionId);
        
        // Get all receivers (except sender)
        const socketsInRoom = await io.in(roomCode).fetchSockets();
        const receiverIds = socketsInRoom
          .filter(s => s.data?.user?.id && s.data.user.id !== playerId)
          .map(s => s.data.user.id);

        const leaderboardPayload = {
          questionId: questionId,
          leaderboard: leaderboardData.leaderboard,
          correctAnswer: leaderboardData.correctAnswer,
          totalPlayers: leaderboardData.totalPlayers,
          answeredPlayers: leaderboardData.answeredPlayers
        };

        // Create buffer if there are receivers
        if (receiverIds.length > 0) {
          const taskId = await bufferManager.createBuffer(
            roomCode,
            playerId,
            'question:leaderboard',
            leaderboardPayload,
            receiverIds
          );

          // Broadcast with taskId (except sender)
          socket.to(roomCode).emit('question:leaderboard', {
            ...leaderboardPayload,
            taskId,
            senderId: playerId
          } as any);
        } else {
          // No receivers, normal emit (except sender)
          socket.to(roomCode).emit('question:leaderboard', leaderboardPayload);
        }

        // Send to requester as well (without buffer)
        callback?.({ 
          success: true, 
          data: leaderboardPayload 
        });
      } catch (error: any) {
        logger.error('Error getting question leaderboard', { error: error.message });
        callback?.({ success: false, error: error.message || 'Failed to get leaderboard' });
      }
    });

    // Handle message acknowledgment
    socket.on('message:ack' as any, async (data: { taskId: string }, callback?: (response: { success: boolean; allAcknowledged?: boolean; error?: string }) => void) => {
      try {
        const socketData = socket.data;
        if (!socketData || !socketData.user) {
          return callback?.({ success: false, error: 'Socket not authenticated' });
        }

        const receiverId = socketData.user.id;
        const { taskId } = data;

        if (!taskId) {
          return callback?.({ success: false, error: 'Task ID is required' });
        }

        // Acknowledge message
        const allAcknowledged = await bufferManager.acknowledgeMessage(taskId, receiverId);

        logger.info('✅ Message acknowledged', { taskId, receiverId, allAcknowledged });

        callback?.({ success: true, allAcknowledged });
      } catch (error: any) {
        logger.error('Error acknowledging message', { error: error.message });
        callback?.({ success: false, error: error.message });
      }
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

