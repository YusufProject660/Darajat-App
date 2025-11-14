// src/modules/games/services/game.service.ts
import { Server } from 'socket.io';
import { Socket } from 'socket.io';
import { Model, Types } from 'mongoose';
import { GameRoom, IGameRoom, IPlayer, IAnsweredQuestion } from '../models/gameRoom.model';
import { logger } from '../../../utils/logger';

// Extend the IGameService interface to include our methods
interface IGameService {
  initialize(io: Server): void;
  createRoom(hostName: string, roomCode: string): Promise<IGameRoom>;
  startGame(roomCode: string, userId: string): Promise<IGameRoom>;
  joinRoom(roomCode: string, playerData: Partial<IPlayer>): Promise<IGameRoom>;
  toggleReady(roomCode: string, userId: string): Promise<IGameRoom>;
  submitAnswer(
    roomCode: string, 
    userId: string, 
    questionId: string, 
    answer: any
  ): Promise<{ correct: boolean; score: number }>;
  getGameState(roomCode: string, forceRefresh?: boolean): Promise<IGameRoom | null>;
  // TODO: Implement cleanup method
  cleanup(): Promise<void>;
}

type SocketCallback = (response: { 
  success: boolean; 
  error?: string; 
  data?: any;
}) => void;

class GameService implements IGameService {
  private io: Server | null = null;
  private socketService: any = null; // Store the socket service instance
  // REVIEW: Replace any with proper type for MongoDB ChangeStream
  private changeStream: any = null;
  private gameRoomModel: Model<IGameRoom>;
  private gameRooms: Map<string, IGameRoom> = new Map();
  private readonly CACHE_TTL = 1000 * 60 * 30; // 30 minutes TTL for cache entries

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
        this.gameRooms.set(room.roomCode, room);
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
        const lastUpdated = new Date(room.updatedAt || 0).getTime();
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
  private async getRoom(roomCode: string): Promise<IGameRoom | null> {
    // Check cache first
    const cachedRoom = this.gameRooms.get(roomCode);
    if (cachedRoom) return cachedRoom;

    // If not in cache, try to get from DB
    try {
      const room = await this.gameRoomModel.findOne({ roomCode }).lean();
      if (room) {
        this.gameRooms.set(roomCode, room);
      }
      return room;
    } catch (error) {
      logger.error(`Error getting room ${roomCode}:`, error);
      return null;
    }
  }

  /**
   * Update both cache and database with room data
   */
  private async updateRoom(roomCode: string, updates: Partial<IGameRoom>): Promise<IGameRoom | null> {
    try {
      const updatedRoom = await this.gameRoomModel.findOneAndUpdate(
        { roomCode },
        { ...updates, updatedAt: new Date() },
        { new: true, lean: true }
      );

      if (updatedRoom) {
        this.gameRooms.set(roomCode, updatedRoom);
      } else {
        this.gameRooms.delete(roomCode);
      }

      return updatedRoom;
    } catch (error) {
      logger.error(`Error updating room ${roomCode}:`, error);
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
        this.gameRooms.set(roomCode, room);
      } else {
        this.gameRooms.delete(roomCode);
      }
      return room;
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

      if (!room.players || room.players.length < 1) {
        throw new Error('Cannot start a game without players');
      }

      // Check if all players are ready
      const allReady = room.players.every(player => player.isReady);
      if (!allReady) {
        throw new Error('All players must be ready to start the game');
      }

      // Update room status
      room.status = 'active';
      room.currentQuestion = 0;
      room.startedAt = new Date();
      
      // If no questions are loaded, generate some
      if (!room.questions || room.questions.length === 0) {
        // This is a simplified example - in a real app, you'd fetch questions
        // based on the room's settings
        room.questions = [];
        // Add your question generation logic here
      }

      await room.save({ session });
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
          isHost: room.players.length === 0, // First player is host
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

      // Broadcast update to all clients in the room
      if (this.io) {
        this.io.to(roomCode).emit('player:joined', {
          success: true,
          data: formattedRoom
        });
      }

      return formattedRoom;
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
    answer: any
  ): Promise<{ correct: boolean; score: number }> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();

    try {
      const room = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (!room) {
        throw new Error('Room not found');
      }

      if (room.status !== 'active') {
        throw new Error('Game is not active');
      }

      const player = room.players.find(p => p.userId.toString() === userId);
      if (!player) {
        throw new Error('Player not found in room');
      }

      // Check if player has already answered this question
      const existingAnswer = room.answeredQuestions?.find(
        aq => aq.playerId.toString() === userId && aq.questionId.toString() === questionId
      );

      if (existingAnswer) {
        throw new Error('You have already answered this question');
      }

      // In a real app, you would validate the answer against the question
      // For now, we'll just assume the answer is correct and award points
      const isCorrect = true; // Replace with actual answer validation
      const pointsEarned = isCorrect ? 10 : 0;
      
      // Update player score
      player.score += pointsEarned;

      // Record the answer
      const answeredQuestion: IAnsweredQuestion = {
        playerId: new Types.ObjectId(userId),
        questionId: new Types.ObjectId(questionId),
        selectedOption: answer,
        isCorrect,
        timeTaken: 0, // In a real app, track time taken
        answeredAt: new Date()
      };

      if (!room.answeredQuestions) {
        room.answeredQuestions = [];
      }
      room.answeredQuestions.push(answeredQuestion);

      // Move to next question if all players have answered
      const allPlayersAnswered = room.players.every(p => 
        room.answeredQuestions?.some(aq => 
          aq.playerId.toString() === p.userId.toString() && 
          aq.questionId.toString() === questionId
        )
      );

      if (allPlayersAnswered && room.currentQuestion !== undefined) {
        room.currentQuestion++;
        
        // Check if game is over
        if (room.currentQuestion >= (room.questions?.length || 0)) {
          room.status = 'finished';
          room.finishedAt = new Date();
          
          // Calculate final scores and results
          room.results = room.players.map(player => ({
            userId: new Types.ObjectId(player.userId.toString()),
            correctAnswers: room.answeredQuestions?.filter(aq => 
              aq.playerId.toString() === player.userId.toString() && aq.isCorrect
            ).length || 0,
            totalTime: 0 // In a real app, track total time
          }));
        }
      }

      await room.save({ session });
      await session.commitTransaction();

      // Broadcast update to all clients in the room
      if (this.io) {
        this.io.to(roomCode).emit('answer:submitted', {
          success: true,
          data: {
            playerId: userId,
            questionId,
            isCorrect,
            score: player.score,
            room
          }
        });
      }

      return { correct: isCorrect, score: player.score };
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error submitting answer in room ${roomCode}:`, error);
      throw error;
    } finally {
      session.endSession();
    }
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

      // If there are no players left, delete the room
      if (room.players.length === 0) {
        await this.gameRoomModel.deleteOne({ roomCode });
        logger.info(`Room ${roomCode} has been deleted`);
        
        // Notify all clients in the room that it's been closed
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
   * Set up socket event listeners
   * NOTE: Socket listeners are now handled by SocketService to avoid duplicate connection handlers
   * This method is kept for backward compatibility but does nothing
   */
  private setupSocketListeners(): void {
    // Socket listeners are now handled by SocketService
    // This method is kept for backward compatibility
    logger.info('Socket listeners are handled by SocketService');
  }

  /**
   * Handle player disconnection
   * NOTE: This method is called by SocketService when a player disconnects
   */
  public async handlePlayerDisconnect(socket: Socket, playerId: string, roomCode: string): Promise<void> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();

    try {
      logger.info(`Player ${playerId} disconnected from room ${roomCode}`);
      
      // Get the room and player before removing them
      const room = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (!room) {
        await session.abortTransaction();
        return;
      }
      
      const player = room.players.find((p: IPlayer) => p.userId.toString() === playerId.toString());
      if (!player) {
        await session.abortTransaction();
        return;
      }
      
      // Check if the disconnected player was the host
      const wasHost = player.isHost;
      let newHostId: string | undefined;
      
      // Remove player from the room
      room.players = room.players.filter((p: IPlayer) => p.userId.toString() !== playerId.toString());
      
      // If host left and there are remaining players, assign a new host
      if (wasHost && room.players.length > 0) {
        const newHost = room.players[0];
        newHost.isHost = true;
        newHostId = newHost.userId.toString();
        room.hostId = new Types.ObjectId(newHostId);
      }
      
      // Save the updated room
      await room.save({ session });
      await session.commitTransaction();
      
      // Update cache
      this.gameRooms.set(roomCode, room.toObject());
      
      // If no players left, clean up the room
      if (room.players.length === 0) {
        await this.cleanupRoom(roomCode);
        return;
      }
      
      // Notify remaining players
      if (this.io) {
        this.io.to(roomCode).emit('player:disconnected', {
          playerId,
          reason: 'disconnected',
          newHostId,
          players: room.players
        });
        
        // If game was in progress, update game state
        if (room.status === 'active' || room.status === 'in_progress') {
          this.io.to(roomCode).emit('game:player_disconnected', {
            playerId,
            newHostId,
            remainingPlayers: room.players.length
          });
        }
      }
      
    } catch (error) {
      await session.abortTransaction();
      logger.error(`Error handling player disconnect:`, error);
      
      // Notify the client about the error if the socket is still connected
      if (socket && socket.connected) {
        socket.emit('error:game', {
          code: 'DISCONNECT_ERROR',
          message: 'An error occurred while handling disconnection',
          recoverable: true
        });
      }
    } finally {
      session.endSession();
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

  public async createRoom(hostName: string, roomCode: string, hostId: string): Promise<IGameRoom> {
    const session = await this.gameRoomModel.startSession();
    session.startTransaction();
    
    try {
      // Check if room already exists
      const existingRoom = await this.gameRoomModel.findOne({ roomCode }).session(session);
      if (existingRoom) {
        throw new Error('Room already exists');
      }

      // Create new game room
      const newRoom = new this.gameRoomModel({
        roomCode,
        hostId,
        players: [{
          userId: hostId,
          username: hostName,
          isHost: true,
          isReady: false,
          score: 0,
          answeredQuestions: []
        }],
        gameState: 'waiting',
        currentQuestion: null,
        questions: [],
        startTime: null,
        endTime: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await newRoom.save({ session });
      await session.commitTransaction();
      
      // Update cache
      const roomData = this.toGameRoom(newRoom);
      this.gameRooms.set(roomCode, roomData);
      
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
    
    // Clean up any other resources
    logger.info('Game service cleanup completed');
    // TODO: Implement cleanup logic for resources
    // This should close any open connections and clean up resources
    if (this.changeStream) {
      await this.changeStream.close();
    }
    // Clean up socket service reference
    this.socketService = null;
    // Add any additional cleanup logic here
    // For example, you might want to close any open database connections or file handles
    // You can also use this method to clean up any other resources that were allocated during the game
  }
}

// ... (rest of the code remains the same)
const gameService = new GameService();

export { gameService };
