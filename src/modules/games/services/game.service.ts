// src/modules/games/services/game.service.ts
import { Server } from 'socket.io';
import { Socket } from 'socket.io';
import { Model, Types } from 'mongoose';
import { GameRoom, IGameRoom, IPlayer } from '../models/gameRoom.model';
import { Question } from '../models/question.model';
import { GameHistory } from '../models/gameHistory.model';
import User from '../../users/user.model';
import { logger } from '../../../utils/logger';

// Extend the IGameService interface to include our methods
interface IGameService {
  initialize(io: Server): void;
  createRoom(
    hostName: string, 
    roomCode: string, 
    hostId: string,
    settings?: {
      numberOfQuestions?: number;
      maximumPlayers?: number;
      categories?: { [key: string]: { enabled: boolean; difficulty: 'easy' | 'medium' | 'hard' } };
    }
  ): Promise<IGameRoom>;
  startGame(roomCode: string, userId: string): Promise<IGameRoom>;
  joinRoom(roomCode: string, playerData: Partial<IPlayer>): Promise<IGameRoom>;
  toggleReady(roomCode: string, userId: string): Promise<IGameRoom>;
  submitAnswer(
    roomCode: string, 
    userId: string, 
    questionId: string, 
    answer: any,
    timeTaken?: number
  ): Promise<{ correct: boolean; score: number; allPlayersAnswered: boolean }>;
  getGameState(roomCode: string, forceRefresh?: boolean): Promise<IGameRoom | null>;
  cleanup(): Promise<void>;
}

class GameService implements IGameService {
  private io: Server | null = null;
  // REVIEW: Replace any with proper type for MongoDB ChangeStream
  private changeStream: any = null;
  private gameRoomModel: Model<IGameRoom>;
  private gameRooms: Map<string, IGameRoom> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes TTL for cache entries
  // @ts-ignore - Used by setSocketService method
  private socketService: any = null;

  /**
   * Set up MongoDB change streams to listen for real-time updates to game rooms
   * This allows us to keep the in-memory cache in sync with the database
   */
  private async setupChangeStreams(): Promise<void> {
    try {
      // Close existing change stream if it exists
      if (this.changeStream) {
        await this.changeStream.close();
      }

      // Create a change stream that watches for all changes to game rooms
      this.changeStream = this.gameRoomModel.watch([], { fullDocument: 'updateLookup' });

      // Handle change events
      this.changeStream.on('change', (change: any) => {
        try {
          const roomCode = change.documentKey?.roomCode || change.fullDocument?.roomCode;
          
          if (!roomCode) return;

          switch (change.operationType) {
            case 'insert':
            case 'update':
            case 'replace':
              // Update the cache with the latest room data
              if (change.fullDocument) {
                this.gameRooms.set(roomCode, this.toGameRoom(change.fullDocument));
              }
              break;
            case 'delete':
              // Remove the room from cache if it was deleted
              this.gameRooms.delete(roomCode);
              break;
          }
        } catch (error) {
          logger.error('Error processing change stream event:', error);
        }
      });

      // Handle errors
      this.changeStream.on('error', (error: Error) => {
        logger.error('Change stream error:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => this.setupChangeStreams(), 5000);
      });

      logger.info('MongoDB change stream initialized');
    } catch (error) {
      logger.error('Failed to set up change streams:', error);
      // Retry after a delay if there's an error
      setTimeout(() => this.setupChangeStreams(), 5000);
    }
  }

  constructor() {
    this.gameRoomModel = GameRoom as unknown as Model<IGameRoom>;
    this.initializeCache().catch(error => {
      logger.error('Error initializing game room cache:', error);
    });
    this.setupChangeStreams();
    this.setupCacheCleanup();
  }

  /**
   * Initialize the game service with Socket.IO instance
   * @param io Socket.IO server instance
   */
  public initialize(io: Server): void {
    this.io = io;
    // Socket listeners are now handled by SocketService
  }

  /**
   * Set up MongoDB change streams for real-time updates
   */
  /**
   * Initialize the in-memory cache with active game rooms from the database
   */
  private async initializeCache(): Promise<void> {
    try {
      const activeRooms = await this.gameRoomModel.find({
        status: { $in: ['waiting', 'active'] },
        updatedAt: { $gt: new Date(Date.now() - this.CACHE_TTL) }
      }).lean();
      
      activeRooms.forEach(room => {
        this.gameRooms.set(room.roomCode, room as any);
      });
      
      logger.info(`Initialized game room cache with ${activeRooms.length} active rooms`);
    } catch (error) {
      logger.error('Failed to initialize game room cache:', error);
      throw error;
    }
  }

  /**
   * Set up periodic cleanup of expired cache entries
   */
  private setupCacheCleanup(): void {
    // Run cleanup every 5 minutes
    setInterval(() => {
      const now = Date.now();
      let removedCount = 0;
      
      for (const [roomCode, room] of this.gameRooms.entries()) {
        const lastUpdated = new Date((room as any).updatedAt || 0).getTime();
        if (now - lastUpdated > this.CACHE_TTL) {
          this.gameRooms.delete(roomCode);
          removedCount++;
        }
      }
      
      if (removedCount > 0) {
        logger.info(`Cleaned up ${removedCount} expired cache entries`);
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Get a room from cache or database
   */
  // @ts-ignore - Reserved for future use
  private async _getRoom(_roomCode: string): Promise<IGameRoom | null> {
    // Check cache first
    const cachedRoom = this.gameRooms.get(_roomCode);
    if (cachedRoom) return cachedRoom;

    // If not in cache, try to get from DB
    try {
      const room = await this.gameRoomModel.findOne({ roomCode: _roomCode }).lean();
      if (room) {
        this.gameRooms.set(_roomCode, room as any);
      }
      return room as any;
    } catch (error) {
      logger.error(`Error getting room ${_roomCode}:`, error);
      return null;
    }
  }

  /**
   * Update both cache and database with room data
   */
  // @ts-ignore - Reserved for future use
  private async _updateRoom(_roomCode: string, _updates: Partial<IGameRoom>): Promise<IGameRoom | null> {
    try {
      const updatedRoom = await this.gameRoomModel.findOneAndUpdate(
        { roomCode: _roomCode },
        { ..._updates, updatedAt: new Date() },
        { new: true, lean: true }
      );

      if (updatedRoom) {
        this.gameRooms.set(_roomCode, updatedRoom as any);
      } else {
        this.gameRooms.delete(_roomCode);
      }

      return updatedRoom as any;
    } catch (error) {
      logger.error(`Error updating room ${_roomCode}:`, error);
      return null;
    }
  }

  public async getGameState(roomCode: string, forceRefresh = false): Promise<IGameRoom | null> {
    // If not forcing refresh, try to get from cache first
    if (!forceRefresh) {
      const cachedRoom = this.gameRooms.get(roomCode);
      if (cachedRoom) return cachedRoom;
    }
    
    // If not in cache or forcing refresh, get from database
    try {
      const room = await this.gameRoomModel.findOne({ roomCode }).lean();
      if (room) {
        this.gameRooms.set(roomCode, room as any);
      } else {
        this.gameRooms.delete(roomCode);
      }
      return room as any;
    } catch (error) {
      logger.error(`Error getting game state for room ${roomCode}:`, error);
      return null;
    }
  }

  /**
   * Start a game room
   */
  public async startGame(roomCode: string, userId: string): Promise<IGameRoom> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();

    try {
      // Find and validate the room
      const room = await this.gameRoomModel.findOne({ roomCode })
        .populate('players.userId', 'username avatar')
        .session(session);

      if (!room) {
        throw new Error('Room not found');
      }

      // Verify the user is the host by comparing string representations of the IDs
      if (room.hostId.toString() !== userId.toString()) {
        throw new Error('Only the host can start the game');
      }

      // Verify game can be started
      if (room.status !== 'waiting') {
        throw new Error(`Game is already ${room.status}`);
      }

      if (!room.players || room.players.length < 2) {
        throw new Error('At least 2 players are required to start the game');
      }

      // Update room status
      room.status = 'active';
      room.currentQuestion = 0;

      await room.save({ session });
      (room as any).startedAt = new Date();
      await session.commitTransaction();

      logger.info(`Game started - Room: ${roomCode}`);
      return room.toObject();
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error starting game - Room: ${roomCode}`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Handle player joining a game room
   */
  public async joinRoom(roomCode: string, playerData: Partial<IPlayer>): Promise<IGameRoom> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();

    try {
      // Validate player data
      if (!playerData.userId || !playerData.username) {
        throw new Error('Player ID and username are required');
      }
      
      // Ensure userId is a valid ObjectId
      const userId = new Types.ObjectId(playerData.userId.toString());

      // Find the room
      const room = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (!room) {
        throw new Error('Room not found');
      }

      // Check if game has already started
      if (room.status !== 'waiting') {
        throw new Error('Game has already started');
      }

      // Check if room is full
      if (room.players.length >= (room.settings?.maximumPlayers || 4)) {
        throw new Error('Room is full');
      }

      // Check if player already exists in the room
      const existingPlayer = room.players.find(p => 
        p.userId.toString() === userId.toString()
      );

      if (existingPlayer) {
        // Player rejoining, update their data
        Object.assign(existingPlayer, {
          ...playerData,
          isReady: existingPlayer.isReady,
          score: existingPlayer.score
        });
      } else {
        // New player joining
        const newPlayer: IPlayer = {
          userId: userId,
          username: playerData.username || 'Player',
          avatar: playerData.avatar,
          score: 0,
          isHost: room.hostId.toString() === userId.toString(),
          isReady: false
        };
        room.players.push(newPlayer);
      }

      const updatedRoom = await room.save({ session });
      await session.commitTransaction();
      
      // Update cache
      this.gameRooms.set(roomCode, updatedRoom.toObject());
      
      // Format player data, extracting usernames from emails if needed
      const formattedRoom = {
        ...updatedRoom.toObject(),
        players: updatedRoom.players.map((player: any) => ({
          ...player,
          username: player.username.includes('@') 
            ? player.username.split('@')[0]  // Take part before @ if it's an email
            : player.username
        }))
      };

      // Console log for new player joining
      const newPlayerData = existingPlayer ? 'Rejoining player' : 'New player';
      console.log('═══════════════════════════════════════════════════════════');
      console.log('👤 NEW PLAYER JOINED ROOM (from game.service)');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Type:', newPlayerData);
      console.log('Room Code:', roomCode);
      console.log('Player Data:', {
        userId: playerData.userId?.toString(),
        username: playerData.username,
        avatar: playerData.avatar,
        isHost: room.players.length === 0,
        score: 0
      });
      console.log('Total Players in Room:', updatedRoom.players.length);
      console.log('All Players:', updatedRoom.players.map((p: any) => ({
        userId: p.userId?.toString(),
        username: p.username,
        isHost: p.isHost,
        score: p.score
      })));
      console.log('Room Status:', updatedRoom.status);
      console.log('═══════════════════════════════════════════════════════════');

      return formattedRoom as any;
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error joining room ${roomCode}:`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Toggle player ready status
   */
  public async toggleReady(roomCode: string, userId: string): Promise<IGameRoom> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();

    try {
      const room = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (!room) {
        throw new Error('Room not found');
      }

      const player = room.players.find(p => p.userId.toString() === userId);
      if (!player) {
        throw new Error('Player not found in room');
      }

      // Toggle ready status
      player.isReady = !player.isReady;

      const updatedRoom = await room.save({ session });
      await session.commitTransaction();

      // Broadcast update to all clients in the room
      if (this.io) {
        this.io.to(roomCode).emit('player:ready', {
          success: true,
          data: {
            playerId: userId,
            isReady: player.isReady,
            room: updatedRoom
          }
        });
      }

      return updatedRoom.toObject();
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error toggling ready status in room ${roomCode}:`, error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Submit an answer to the current question
   */
  public async submitAnswer(
    roomCode: string,
    userId: string,
    questionId: string,
    answer: any,
    timeTaken: number = 0
  ): Promise<{ correct: boolean; score: number; allPlayersAnswered: boolean }> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Validate question first
        const question = await Question.findById(questionId);
        if (!question) {
          throw new Error('Question not found');
        }

        // Handle timeout case (null answer) - use -1 for no answer
        const selectedOption = answer === null ? -1 : answer;
        const isCorrect = answer !== null && question.correctAnswer === answer;
        const pointsEarned = isCorrect ? 10 : 0;

        // Prepare the answer document
        const answeredQuestion = {
          playerId: new Types.ObjectId(userId),
          questionId: new Types.ObjectId(questionId),
          selectedOption: selectedOption,
          isCorrect,
          timeTaken: timeTaken,
          answeredAt: new Date()
        };

        // Atomic update: Check duplicate, push answer, increment score
        // This prevents write conflicts by using atomic operations
        const room = await this.gameRoomModel.findOneAndUpdate(
          {
            roomCode,
            status: 'active',
            'players.userId': new Types.ObjectId(userId),
            answeredQuestions: {
              $not: {
                $elemMatch: {
                  playerId: new Types.ObjectId(userId),
                  questionId: new Types.ObjectId(questionId)
                }
              }
            }
          },
          {
            $push: { answeredQuestions: answeredQuestion },
            $inc: { 'players.$[player].score': pointsEarned }
          },
          {
            arrayFilters: [{ 'player.userId': new Types.ObjectId(userId) }],
            new: true
          }
        );

        if (!room) {
          // Check if already answered or room not found
          const checkRoom = await this.gameRoomModel.findOne({ roomCode });
          if (!checkRoom) {
            throw new Error('Room not found');
          }
          if (checkRoom.status !== 'active') {
            throw new Error('Game is not active');
          }
          
          const existingAnswer = checkRoom.answeredQuestions?.find(
            (aq: any) => aq.playerId.toString() === userId && aq.questionId.toString() === questionId
          );
          if (existingAnswer) {
            throw new Error('You have already answered this question');
          }
          
          throw new Error('Player not found in room');
        }

        // Get updated player score
        const player = room.players.find((p: any) => p.userId.toString() === userId);
        const finalScore = player?.score || 0;

        // Check if all players have answered
        const allPlayersAnswered = room.players.every((p: any) => 
          room.answeredQuestions?.some((aq: any) => 
            aq.playerId.toString() === p.userId.toString() && 
            aq.questionId.toString() === questionId
          )
        );

        return { correct: isCorrect, score: finalScore, allPlayersAnswered };
      } catch (error: any) {
        // Retry on write conflict or duplicate key error
        if (error.message?.includes('Write conflict') || 
            error.message?.includes('E11000') ||
            error.code === 11000) {
          retryCount++;
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 50; // Exponential backoff: 100ms, 200ms, 400ms
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        logger.error(`Error submitting answer in room ${roomCode}:`, error);
        throw error;
      }
    }

    throw new Error('Failed to submit answer after retries');
  }

  /**
   * Archive game history before cleanup
   */
  private async archiveGameHistory(room: IGameRoom): Promise<void> {
    if (!room.answeredQuestions?.length) return;

    const playerHistory = room.players.map(player => {
      const answers = room.answeredQuestions.filter(aq => aq.playerId.toString() === player.userId.toString());
      const correct = answers.filter(a => a.isCorrect).length;
      const totalTime = answers.reduce((sum, a) => sum + a.timeTaken, 0);
      
      return {
        userId: player.userId,
        username: player.username,
        avatar: player.avatar,
        finalScore: player.score,
        correctAnswers: correct,
        totalTime,
        accuracy: answers.length > 0 ? Math.round((correct / answers.length) * 100) : 0
      };
    });

    await GameHistory.create({
      roomCode: room.roomCode,
      hostId: room.hostId,
      players: playerHistory,
      questions: room.questions,
      answeredQuestions: room.answeredQuestions,
      settings: room.settings,
      startedAt: room.createdAt,
      finishedAt: room.finishedAt || new Date()
    });

    logger.info(`Game history archived for room ${room.roomCode}`);
  }

  /**
   * Update player stats after game
   */
  private async updatePlayerStats(room: IGameRoom): Promise<void> {
    const updates = room.players.map(async player => {
      const answers = room.answeredQuestions.filter(aq => aq.playerId.toString() === player.userId.toString());
      const correct = answers.filter(a => a.isCorrect).length;
      const total = answers.length;
      const totalTime = answers.reduce((sum, a) => sum + a.timeTaken, 0);

      if (total === 0) return;

      const user = await User.findById(player.userId);
      if (!user) return;

      const newTotalCorrect = (user.stats.totalCorrectAnswers || 0) + correct;
      const newTotalQuestions = (user.stats.totalQuestionsAnswered || 0) + total;
      const newAccuracy = newTotalQuestions > 0 ? Math.round((newTotalCorrect / newTotalQuestions) * 100) : 0;
      const newBestScore = Math.max(user.stats.bestScore || 0, player.score);

      await User.findByIdAndUpdate(player.userId, {
        $inc: {
          'stats.gamesPlayed': 1,
          'stats.totalCorrectAnswers': correct,
          'stats.totalQuestionsAnswered': total,
          'stats.totalTimePlayed': totalTime
        },
        $set: {
          'stats.accuracy': newAccuracy,
          'stats.bestScore': newBestScore
        }
      });
    });

    await Promise.all(updates);
    logger.info(`Player stats updated for room ${room.roomCode}`);
  }

  /**
   * Clean up a room when it's empty
   * @param roomCode The room code to clean up
   */
  public async cleanupRoom(roomCode: string): Promise<void> {
    try {
      const room = await this.gameRoomModel.findOne({ roomCode });
      if (!room) {
        logger.warn(`Room ${roomCode} not found for cleanup`);
        return;
      }

      if (room.players.length === 0) {
        if (room.status === 'active' || room.status === 'finished') {
          await this.archiveGameHistory(room);
          await this.updatePlayerStats(room);
        }
        
        await this.gameRoomModel.deleteOne({ roomCode });
        logger.info(`Room ${roomCode} has been deleted`);
        
        this.io?.to(roomCode).emit('room:closed', {
          success: true,
          message: 'Room has been closed due to inactivity'
        });
      }
    } catch (error) {
      logger.error(`Error cleaning up room ${roomCode}:`, error);
      throw error;
    }
  }


  /**
   * Handle player disconnection
   * NOTE: This method is called by SocketService when a player disconnects
   */
  public async handlePlayerDisconnect(socket: Socket, playerId: string, roomCode: string): Promise<void> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        logger.info(`Player ${playerId} disconnected from room ${roomCode}`);
        
        // Get the room first
        const room = await this.gameRoomModel.findOne({ roomCode });
        if (!room) {
          return;
        }
        
        const player = room.players.find((p: IPlayer) => p.userId.toString() === playerId.toString());
        if (!player) {
          return;
        }
        
        // Check if the disconnected player was the host
        const wasHost = player.isHost;
        let newHostId: string | undefined;
        
        // Use atomic operation to remove player
        const updateOps: any = {
          $pull: { players: { userId: new Types.ObjectId(playerId) } }
        };
        
        // If host left and there are remaining players, assign a new host
        if (wasHost && room.players.length > 1) {
          // Find first non-disconnecting player to be new host
          const remainingPlayers = room.players.filter((p: IPlayer) => p.userId.toString() !== playerId.toString());
          if (remainingPlayers.length > 0) {
            const newHost = remainingPlayers[0];
            newHostId = newHost.userId.toString();
            updateOps.$set = {
              hostId: new Types.ObjectId(newHostId),
              'players.$[player].isHost': true
            };
            updateOps.arrayFilters = [{ 'player.userId': new Types.ObjectId(newHostId) }];
          }
        }
        
        // Atomic update
        const updatedRoom = await this.gameRoomModel.findOneAndUpdate(
          { roomCode, 'players.userId': new Types.ObjectId(playerId) },
          updateOps,
          { new: true }
        );
        
        if (!updatedRoom) {
          // Retry if update failed
          retryCount++;
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 50;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return;
        }
        
        // Update cache
        this.gameRooms.set(roomCode, updatedRoom.toObject());
        
        // If no players left, clean up the room
        if (updatedRoom.players.length === 0) {
          await this.cleanupRoom(roomCode);
          return;
        }
        
        // Notify remaining players
        if (this.io) {
          const playersList = updatedRoom.players.map((p: IPlayer) => ({
            id: p.userId.toString(),
            userId: p.userId.toString(),
            username: p.username,
            avatar: p.avatar,
            score: p.score || 0,
            isHost: p.isHost || false
          }));

          this.io.to(roomCode).emit('player:removed', {
            playerId,
            reason: 'disconnected',
            players: playersList,
            newHostId,
            roomCode
          } as any);
          
          // If game was in progress, update game state
          if (updatedRoom.status === 'active') {
            this.io.to(roomCode).emit('game:player_disconnected', {
              playerId,
              newHostId,
              remainingPlayers: updatedRoom.players.length
            });
          }
        }
        
        return; // Success, exit retry loop
      } catch (error: any) {
        // Retry on write conflict
        if (error.message?.includes('Write conflict') || 
            error.message?.includes('E11000') ||
            error.code === 11000) {
          retryCount++;
          if (retryCount < maxRetries) {
            const delay = Math.pow(2, retryCount) * 50;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        logger.error(`Error handling player disconnect:`, error);
        
        // Notify the client about the error if the socket is still connected
        if (socket && socket.connected) {
          socket.emit('error:game', {
            code: 'DISCONNECT_ERROR',
            message: 'An error occurred while handling disconnection',
            recoverable: true
          });
        }
        throw error;
      }
    }
  }

  /**
   * Convert a raw room object to IGameRoom
   * @param room Raw room object from database
   * @returns Formatted IGameRoom object
   */
  private toGameRoom(room: any): IGameRoom {
    return {
      ...room,
      _id: room._id.toString(),
      hostId: room.hostId.toString(),
      players: room.players.map((player: any) => ({
        ...player,
        userId: player.userId.toString(),
        _id: player._id?.toString()
      })),
      settings: {
        ...room.settings,
        categories: room.settings?.categories || {}
      },
      questions: room.questions || [],
      answeredQuestions: room.answeredQuestions || [],
      results: room.results || [],
      createdAt: room.createdAt || new Date(),
      updatedAt: room.updatedAt || new Date(),
      startedAt: room.startedAt,
      finishedAt: room.finishedAt
    } as IGameRoom;
  }

  public async createRoom(
    hostName: string, 
    roomCode: string, 
    hostId: string,
    settings?: {
      numberOfQuestions?: number;
      maximumPlayers?: number;
      categories?: { [key: string]: { enabled: boolean; difficulty: 'easy' | 'medium' | 'hard' } };
    }
  ): Promise<IGameRoom> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();
    
    try {
      // Check if room already exists
      const existingRoom = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (existingRoom) {
        throw new Error('Room already exists');
      }

      // Default settings if not provided
      const defaultCategories = {
        quran: { enabled: true, difficulty: 'medium' as const },
        hadith: { enabled: false, difficulty: 'medium' as const },
        history: { enabled: false, difficulty: 'medium' as const },
        fiqh: { enabled: false, difficulty: 'medium' as const },
        seerah: { enabled: false, difficulty: 'medium' as const }
      };

      const finalSettings = {
        numberOfQuestions: settings?.numberOfQuestions || 10,
        maximumPlayers: settings?.maximumPlayers || 4,
        categories: settings?.categories || defaultCategories
      };

      // Ensure at least one category is enabled
      const enabledCategories = Object.entries(finalSettings.categories).filter(([_, config]) => config.enabled);
      if (enabledCategories.length === 0) {
        // Enable quran by default if none enabled
        finalSettings.categories.quran = { enabled: true, difficulty: 'medium' };
      }

      // Convert categories object to Map for Mongoose
      const categoriesMap = new Map();
      for (const [category, config] of Object.entries(finalSettings.categories)) {
        categoriesMap.set(category, config);
      }

      // Create new game room
      const newRoom = new this.gameRoomModel({
        roomCode,
        hostId,
        settings: {
          numberOfQuestions: finalSettings.numberOfQuestions,
          maximumPlayers: finalSettings.maximumPlayers,
          categories: categoriesMap
        },
        players: [{
          userId: hostId,
          username: hostName,
          isHost: true,
          isReady: false,
          score: 0,
          answeredQuestions: []
        }],
        status: 'waiting',
        currentQuestion: 0,
        questions: [],
        answeredQuestions: [],
        results: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await newRoom.save({ session });
      await session.commitTransaction();
      
      // Update cache
      const roomData = this.toGameRoom(newRoom);
      this.gameRooms.set(roomCode, roomData);
      
      // Console log for room creation
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🏠 NEW ROOM CREATED (from game.service)');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Room Code:', roomCode);
      console.log('Host ID:', hostId);
      console.log('Host Name:', hostName);
      console.log('Room Status:', newRoom.status || 'waiting');
      console.log('Players Count:', newRoom.players.length);
      console.log('Host Player Data:', {
        userId: newRoom.players[0]?.userId?.toString(),
        username: newRoom.players[0]?.username,
        isHost: newRoom.players[0]?.isHost,
        score: newRoom.players[0]?.score
      });
      console.log('═══════════════════════════════════════════════════════════');
      
      return roomData;
    } catch (error) {
      await session.abortTransaction();
      logger.error('Error creating room:', error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Clean up resources
   */
  /**
   * Set the socket service instance for real-time communication
   * @param socketService The socket service instance
   * NOTE: Socket connection handlers are now managed by SocketService to avoid duplicates
   */
  public setSocketService(socketService: any): void {
    this.socketService = socketService;
    logger.info('Socket service set in GameService');
    
    if (socketService && socketService.io) {
      this.io = socketService.io;
      // Socket listeners are now handled by SocketService, not here
      // This prevents duplicate connection handlers
    } else {
      logger.warn('Socket service or io instance not available');
    }
  }

  public async cleanup(): Promise<void> {
    // Close the change stream
    if (this.changeStream) {
      await this.changeStream.close();
    }
    
    // Clear the in-memory cache
    this.gameRooms.clear();
    
    // Clean up socket service reference
    this.socketService = null;
    
    logger.info('Game service cleanup completed');
  }
}

const gameService = new GameService();

export { gameService };
