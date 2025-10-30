// src/modules/games/services/game.service.ts
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { GameRoom, Player, SocketData, Question } from '../types/game.types';
import { gameRepository } from '../repositories/game.repository';
import { GameRoomModel } from '../models/gameRoom.model';
import { logger } from '../../../utils/logger';

type SocketCallback = (response: { success: boolean; error?: string; [key: string]: any }) => void;

class GameService {
  private io: Server | null = null;
  private changeStream: any = null;

  /**
   * Starts a game room
   * @param roomCode The room code to start
   * @param userId The ID of the user starting the game
   * @returns Promise with the updated game room with populated questions
   */
  async startGame(roomCode: string, userId: string) {
    try {
      // Get the room with populated players and questions
      const room = await gameRepository.getRoomByCode(roomCode, { 
        populate: [
          'players.userId',
          { 
            path: 'questions',
            populate: { path: 'category' }
          }
        ]
      });
      
      if (!room) {
        throw new Error('Room not found');
      }
      
      console.log('Starting game - Room ID:', room.id);
      console.log('Requesting user ID:', userId);
      console.log('Room players:', JSON.stringify(room.players, null, 2));

      // If no questions are loaded, fetch them based on settings
      if (!room.questions || room.questions.length === 0) {
        const deckIds = Object.entries(room.settings?.categories || {})
          .filter(([_, cat]) => cat?.enabled)
          .map(([id]) => id);

        if (deckIds.length === 0) {
          throw new Error('No categories selected for the game');
        }

        // Get the number of questions from settings or use a default
        const questionLimit = room.settings?.numberOfQuestions || 10;
        
        // Fetch questions from the database
        const questions = await Question.aggregate([
          { 
            $match: { 
              deckId: { $in: deckIds.map(id => new mongoose.Types.ObjectId(id)) },
              // Add any additional filters like difficulty here if needed
            } 
          },
          { $sample: { size: questionLimit } },
          {
            $project: {
              _id: 1,
              questionText: 1,
              options: 1,
              correctAnswer: 1,
              category: 1,
              difficulty: 1,
              timeLimit: 1
            }
          }
        ]).exec();

        if (!questions || questions.length === 0) {
          throw new Error('No questions found for the selected categories');
        }

        // Update the room with the fetched questions
        await gameRepository.updateRoom(room.id, { 
          questions: questions.map(q => ({
            ...q,
            _id: q._id.toString()
          }))
        });

        // Refresh the room with the updated questions
        const updatedRoom = await gameRepository.getRoom(room.id, {
          populate: [
            'players.userId',
            { 
              path: 'questions',
              populate: { path: 'category' }
            }
          ]
        });

        if (!updatedRoom) {
          throw new Error('Failed to update room with questions');
        }

        // Update the room reference with the updated data
        Object.assign(room, updatedRoom);
    }

    // Debug log to help diagnose issues
    console.log('Starting game - Room ID:', room.id);
    console.log('Requesting user ID:', userId);
    console.log('Room players:', JSON.stringify(room.players.map(p => ({
      userId: p.userId,
      isHost: p.isHost,
      username: p.username
    })), null, 2));

    // Debug log the player user IDs with more details
    console.log('All player user IDs:', JSON.stringify(room.players.map(p => {
      let userIdValue;
      let userIdString;
      
      if (p.userId) {
        if (typeof p.userId === 'object' && p.userId !== null) {
          // If it's an object, try to get _id or id property
          const userObj = p.userId as any;
          userIdValue = userObj._id || userObj.id || '[object Object]';
          userIdString = typeof userIdValue === 'object' 
            ? userIdValue.toString() 
            : String(userIdValue);
        } else {
          // It's a primitive, convert to string
          userIdValue = p.userId;
          userIdString = String(p.userId);
        }
      } else {
        userIdValue = p.userId;
        userIdString = String(p.userId);
      }
      
      return {
        playerUserId: userIdValue,
        playerUserIdString: userIdString,
        isHost: p.isHost,
        userIdType: typeof p.userId,
        requestedUserId: userId,
        requestedUserIdString: userId.toString(),
        requestedUserIdType: typeof userId
      };
    }), null, 2));

    // Check if the requesting user is the host
    const isHost = room.players.some(p => {
      if (!p.isHost) return false; // Skip if not a host
      
      let playerUserId: string | undefined;
      
      // Handle different userId formats
      if (!p.userId) {
        console.log('Player has no userId');
        return false;
      }
      
      try {
        // Handle ObjectId or string
        if (typeof p.userId === 'object') {
          // Try to get _id or id property
          const userObj = p.userId as any;
          if (userObj._id) {
            playerUserId = userObj._id.toString();
          } else if (userObj.id) {
            playerUserId = userObj.id.toString();
          } else {
            // If it's a plain object without _id or id, try to stringify and parse
            const userIdStr = JSON.stringify(p.userId);
            if (userIdStr !== '{}') { // If not an empty object
              try {
                const parsed = JSON.parse(userIdStr);
                playerUserId = parsed._id || parsed.id || userIdStr;
              } catch {
                playerUserId = userIdStr;
              }
            } else {
              playerUserId = p.userId.toString();
            }
          }
        } else {
          // It's a primitive
          playerUserId = String(p.userId);
        }
        
        // Normalize both IDs for comparison
        const normalizedPlayerId = playerUserId?.replace(/[\"\']/g, '');
        const normalizedRequestedId = userId.toString().replace(/[\"\']/g, '');
        
        console.log('Comparing IDs:', {
          playerUserId,
          normalizedPlayerId,
          requestedUserId: userId,
          normalizedRequestedId,
          isMatch: normalizedPlayerId === normalizedRequestedId
        });
        
        return normalizedPlayerId === normalizedRequestedId;
        
      } catch (error) {
        console.error('Error comparing user IDs:', error);
        return false;
      }
    });
    
    if (!isHost) {
      throw new Error('Only the host can start the game');
    }

      // Validate game can be started
      if (!room.players?.length) {
        throw new Error('Cannot start a game without players');
      }
      
      if (!room.questions?.length) {
        throw new Error('No questions loaded for this game');
      }

      // Prepare update data
      const updateData = {
        status: 'active',
        currentQuestionIndex: 0,
        startedAt: new Date(),
        finishedAt: undefined
      };

      // Update the room status
      const updatedGame = await gameRepository.updateRoom(room.id, updateData);
      
      if (!updatedGame) {
        throw new Error('Failed to update game status');
      }

      // Get the updated game with populated data
      const populatedGame = await gameRepository.getRoom(updatedGame.id, {
        populate: [
          'players.userId',
          { 
            path: 'questions',
            populate: { path: 'category' }
          }
        ]
      });

      if (!populatedGame) {
        throw new Error('Failed to load game data after update');
      }

      console.log('✅ Game started with', {
        players: populatedGame.players?.length || 0,
        questions: populatedGame.questions?.length || 0,
      });

      return populatedGame;
    } catch (error) {
      console.error('Error in startGame:', error);
      throw error;
    }
  }

  setSocketServer(io: Server) {
    this.io = io;
    this.setupSocketListeners();
    this.setupChangeStream().catch(err => {
      logger.error('Failed to start change stream', { error: err instanceof Error ? err.message : String(err) });
    });
  }

  private async generateUniqueRoomCode(): Promise<string> {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    let exists: boolean;

    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
      }
      exists = !!(await gameRepository.getRoomByCode(code));
    } while (exists);

    return code;
  }

  private async updateRoomAndEmit(roomId: string, update: Partial<GameRoom>): Promise<GameRoom | null> {
    const updatedRoom = await gameRepository.updateRoom(roomId, update);
    // change stream will broadcast; return updated room for callers that need it
    return updatedRoom;
  }

  async createRoom(hostName: string, hostId: string, settings: any = {}): Promise<GameRoom> {
    const roomCode = await this.generateUniqueRoomCode();
    const playerId = uuidv4();

    const newRoom: Partial<GameRoom> = {
      roomCode,
      hostId,
      players: [
        {
          id: playerId,
          userId: hostId,
          username: hostName,
          score: 0,
          isHost: true,
          isReady: true,
          socketId: undefined
        }
      ],
      questions: [],
      status: 'waiting',
      currentQuestionIndex: -1,
      settings: {
        numberOfQuestions: settings.numberOfQuestions || 10,
        maximumPlayers: settings.maximumPlayers || 10,
        categories: settings.categories || {
          general: { enabled: true, difficulty: 'medium' }
        }
      },
      answeredQuestions: [],
      results: []
    };

    const createdRoom = await gameRepository.createRoom(newRoom);
    if (!createdRoom) {
      throw new Error('Failed to create room');
    }

    return createdRoom;
  }

  private async setupChangeStream() {
    if (!this.io) return;

    try {
      // Close existing change stream if any
      if (this.changeStream) {
        logger.debug('Closing existing change stream');
        try {
          await this.changeStream.close();
        } catch (err) {
          logger.warn('Error closing existing change stream', { error: err instanceof Error ? err.message : String(err) });
        }
      }

      logger.info('Setting up change stream for game rooms');

      // Watch the GameRoom collection. fullDocument ensures we can emit the current document.
      this.changeStream = GameRoomModel.watch([], { fullDocument: 'updateLookup' });

      this.changeStream.on('change', async (change: any) => {
        try {
          logger.debug('Change stream event received', {
            operationType: change.operationType,
            documentId: change.documentKey?._id?.toString()
          });

          if (!change.documentKey) return;

          const roomId = change.documentKey._id.toString();

          // For updates/inserts/replace emit the full room
          if (['update', 'replace', 'insert'].includes(change.operationType)) {
            const room = await gameRepository.getRoom(roomId);
            if (room) {
              logger.debug('Emitting room_updated event', {
                roomId,
                playerCount: room.players?.length || 0,
                status: room.status
              });
              this.io?.to(roomId).emit('room_updated', room);
            }
          }

          // For deletes, notify clients in that room (they should handle being kicked out)
          if (change.operationType === 'delete') {
            logger.info('Room deleted, emitting room_deleted', { roomId });
            this.io?.to(roomId).emit('room_deleted', { roomId });
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error('Error in change stream handler', {
            error: errorMessage,
            stack: errorStack,
            change: JSON.stringify(change)
          });
        }
      });

      this.changeStream.on('error', (error: Error) => {
        logger.error('Change stream error', {
          error: error.message,
          stack: error.stack
        });
      });

      this.changeStream.on('end', () => {
        logger.warn('Change stream ended');
      });

      logger.info('Change stream setup completed');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to setup change stream', {
        error: errorMessage,
        stack: errorStack
      });
      throw error;
    }
  }

  private async handlePlayerDisconnect(socket: Socket, playerId: string, roomId: string) {
    const logContext: Record<string, any> = { playerId, roomId, socketId: socket.id };

    try {
      logger.info('Handling player disconnect', logContext);

      const room = await gameRepository.getRoom(roomId);
      if (!room) {
        logger.warn('Room not found during player disconnect', logContext);
        return;
      }

      const player = room.players.find(p => p.id === playerId);
      if (!player) {
        logger.warn('Player not found in room during disconnect', logContext);
        return;
      }

      logContext['playerName'] = player.username;
      logContext['isHost'] = player.isHost;

      // Only remove player if game hasn't started
      if (room.status === 'waiting') {
        logger.debug('Removing player from waiting room', logContext);

        const session = await gameRepository.startSession();
        try {
          await session.startTransaction();

          // Remove player from room
          const updatedRoom = await gameRepository.removePlayer(roomId, playerId, { session });
          if (!updatedRoom) {
            throw new Error('Failed to remove player from room');
          }

          // If no players left, delete the room
          if (updatedRoom.players.length <= 0) {
            logger.info('Deleting empty room', { roomId, playerCount: updatedRoom.players.length });
            await gameRepository.deleteRoom(roomId, { session });
            await session.commitTransaction();
            return;
          }

          // If host left, assign new host
          if (player?.isHost) {
            const newHost = updatedRoom.players.find(p => p.id !== playerId);
            if (newHost) {
              logger.info('Assigning new host', {
                ...logContext,
                newHostId: newHost.id,
                newHostName: newHost.username
              });
              await gameRepository.updatePlayer(roomId, newHost.id, { isHost: true }, { session });
            }
          }

          await session.commitTransaction();
          logger.info('Player removed from room', {
            ...logContext,
            remainingPlayers: updatedRoom.players.length
          });

          // Notify remaining players - change stream may also emit an update; this is safe
          this.io?.to(roomId).emit('player_left', {
            playerId,
            players: updatedRoom.players
          });
        } catch (error: unknown) {
          await session.abortTransaction();
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          logger.error('Error in player disconnect transaction', {
            ...logContext,
            error: errorMessage,
            stack: errorStack
          });
        } finally {
          try {
            await session.endSession();
          } catch (err) {
            logger.warn('Error ending session', { error: err instanceof Error ? err.message : String(err) });
          }
        }
      } else {
        // In-game disconnection - clear socketId but keep player in the game
        logger.info('Marking player as disconnected (in-game)', logContext);
        await gameRepository.updatePlayer(roomId, playerId, { socketId: undefined });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error('Error handling player disconnect', {
        ...logContext,
        error: errorMessage,
        stack: errorStack
      });
    }
  }

  private setupSocketListeners() {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      const connectionContext = { socketId: socket.id };
      logger.info('New socket connection', connectionContext);

      // Local per-socket data (avoid relying only on in-memory global maps)
      const socketData: SocketData = {
        playerId: '',
        roomCode: ''
      };

      // Disconnect handling
      socket.on('disconnect', async () => {
        try {
          if (socketData.playerId && socketData.roomCode) {
            const room = await gameRepository.getRoomByCode(socketData.roomCode);
            if (room) {
              await this.handlePlayerDisconnect(socket, socketData.playerId, room.id);
            }
          }
        } catch (err) {
          logger.error('Error during socket disconnect handler', { error: err instanceof Error ? err.message : String(err) });
        }
      });

      // Join room
      socket.on('join_room', async (data: { roomCode: string; playerName: string; userId: string }, callback: SocketCallback) => {
        try {
          const room = await gameRepository.getRoomByCode(data.roomCode);
          if (!room) {
            return callback({ success: false, error: 'Room not found' });
          }

          if (room.status !== 'waiting') {
            return callback({ success: false, error: 'Game has already started' });
          }

          // If client reconnecting (same userId present), update socketId
          const existingPlayer = room.players.find(p => p.id === data.userId || p.userId === data.userId);
          if (existingPlayer) {
            await gameRepository.updatePlayer(room.id, existingPlayer.id, { socketId: socket.id });
            socketData.playerId = existingPlayer.id;
            socketData.roomCode = room.roomCode;
            socket.data.playerId = existingPlayer.id;
            socket.data.roomCode = room.roomCode;
            socket.join(room.id);
            return callback({ success: true, room, player: existingPlayer });
          }

          if (room.players.length >= room.settings.maximumPlayers) {
            return callback({ success: false, error: 'Room is full' });
          }

          // Create new player object
          const newPlayer: Player = {
            id: data.userId,
            userId: data.userId,
            username: data.playerName,
            score: 0,
            isHost: false,
            isReady: false,
            socketId: socket.id
          };

          // Use transaction for atomic add
          const session = await gameRepository.startSession();
          try {
            await session.startTransaction();

            const updatedRoom = await gameRepository.addPlayer(room.id, newPlayer, { session });
            if (!updatedRoom) {
              throw new Error('Failed to add player to room');
            }

            await session.commitTransaction();

            // Update socket data
            socketData.playerId = newPlayer.id;
            socketData.roomCode = room.roomCode;
            socket.data.playerId = newPlayer.id;
            socket.data.roomCode = room.roomCode;
            socket.join(room.id);

            // change stream will notify others, but return success to caller
            return callback({ success: true, room: updatedRoom, player: newPlayer });
          } catch (error: unknown) {
            await session.abortTransaction();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : undefined;

            logger.error('Error in join_room transaction', {
              error: errorMessage,
              stack: errorStack,
              roomCode: data.roomCode,
              playerName: data.playerName,
              userId: data.userId
            });
            return callback({ success: false, error: 'Failed to join room' });
          } finally {
            try {
              await session.endSession();
            } catch (err) {
              logger.warn('Error ending session in join_room', { error: err instanceof Error ? err.message : String(err) });
            }
          }
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          logger.error('Unexpected error in join_room', {
            error: errorMessage,
            stack: errorStack,
            roomCode: data?.roomCode,
            userId: data?.userId
          });
          return callback({ success: false, error: 'Internal server error' });
        }
      });

      // Start game (host only)
      socket.on('start_game', async (_data: any, callback: SocketCallback) => {
        try {
          const roomCode = socket.data?.roomCode || socketData.roomCode;
          const playerId = socket.data?.playerId || socketData.playerId;

          if (!roomCode || !playerId) {
            return callback({ success: false, error: 'Not in a room' });
          }

          const updatedRoom = await this.startGame(roomCode, playerId);
          
          // Emit game started event to all players in the room
          this.io?.to(updatedRoom.id).emit('game_started', {
            game: updatedRoom,
            firstQuestion: updatedRoom.questions[0] || null,
            totalQuestions: updatedRoom.questions.length,
            timeLimit: 30 // default time limit in seconds
          });

          return callback({ success: true });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          logger.error('Error in start_game', {
            error: errorMessage,
            stack: errorStack,
            roomCode: socket.data?.roomCode,
            playerId: socket.data?.playerId
          });
          return callback({ success: false, error: 'Internal server error' });
        }
      });

      // Submit answer
      socket.on('submit_answer', async (data: { questionId: string; answer: string; timeTaken: number }, callback: SocketCallback) => {
        try {
          const roomCode = socket.data?.roomCode || socketData.roomCode;
          if (!roomCode) {
            return callback({ success: false, error: 'Not in a room' });
          }

          const room = await gameRepository.getRoomByCode(roomCode);
          if (!room) {
            return callback({ success: false, error: 'Room not found' });
          }

          const player = room.players.find(p => p.id === socket.data?.playerId || p.id === socketData.playerId);
          if (!player) {
            return callback({ success: false, error: 'Player not found' });
          }

          const currentQuestion = room.questions[room.currentQuestionIndex];
          if (!currentQuestion) {
            return callback({ success: false, error: 'No active question' });
          }

          const isCorrect = currentQuestion.correctAnswer === data.answer;
          const scoreEarned = isCorrect ? Math.max(10, 100 - Math.floor(data.timeTaken / 1000)) : 0;

          const updatedPlayers = room.players.map(p =>
            p.id === player.id ? { ...p, score: (p.score || 0) + scoreEarned } : p
          );

          const answeredQuestion = {
            playerId: player.id,
            questionId: data.questionId,
            selectedOption: data.answer,
            isCorrect,
            timeTaken: data.timeTaken
          };

          const updatedRoom = await gameRepository.updateRoom(room.id, {
            players: updatedPlayers,
            answeredQuestions: [...(room.answeredQuestions || []), answeredQuestion]
          });

          if (!updatedRoom) {
            return callback({ success: false, error: 'Failed to submit answer' });
          }

          // Notify the player about their answer
          socket.emit('answer_result', {
            isCorrect,
            correctAnswer: currentQuestion.correctAnswer,
            score: (player.score || 0) + scoreEarned
          });

          return callback({ success: true });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          logger.error('Error handling answer submission', {
            error: errorMessage,
            stack: errorStack,
            questionId: data?.questionId,
            roomCode: socket.data?.roomCode,
            playerId: socket.data?.playerId
          });
          return callback({ success: false, error: 'Failed to process answer' });
        }
      });

      // Player ready/unready
      socket.on('player_ready', async (data: { isReady: boolean }, callback: SocketCallback) => {
        try {
          const roomCode = socket.data?.roomCode || socketData.roomCode;
          if (!roomCode) {
            return callback({ success: false, error: 'Not in a room' });
          }

          const room = await gameRepository.getRoomByCode(roomCode);
          if (!room) {
            return callback({ success: false, error: 'Room not found' });
          }

          const playerId = socket.data?.playerId || socketData.playerId;
          const updatedPlayers = room.players.map(p => (p.id === playerId ? { ...p, isReady: data.isReady } : p));

          const updatedRoom = await gameRepository.updateRoom(room.id, {
            players: updatedPlayers
          });

          if (!updatedRoom) {
            return callback({ success: false, error: 'Failed to update player status' });
          }

          this.io?.to(room.id).emit('player_updated', {
            players: updatedRoom.players
          });

          return callback({ success: true });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const errorStack = error instanceof Error ? error.stack : undefined;

          logger.error('Error in player_ready', {
            error: errorMessage,
            stack: errorStack,
            roomCode: socket.data?.roomCode,
            playerId: socket.data?.playerId,
            isReady: data?.isReady
          });
          return callback({ success: false, error: 'Internal server error' });
        }
      });
    });
  }
}

export const gameService = new GameService();
