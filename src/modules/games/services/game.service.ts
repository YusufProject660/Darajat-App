// src/modules/games/services/game.service.ts
import { Server } from 'socket.io';
// UNUSED: Socket is imported but not used
// import { Socket } from 'socket.io';
import { Model, Types } from 'mongoose';
import { GameRoom, IGameRoom, IPlayer, IAnsweredQuestion } from '../models/gameRoom.model';
import { logger } from '../../../utils/logger';

// Extend the IGameService interface to include our methods
interface IGameService {
  initialize(io: Server): void;
  startGame(roomCode: string, userId: string): Promise<IGameRoom>;
  joinRoom(roomCode: string, playerData: Partial<IPlayer>): Promise<IGameRoom>;
  toggleReady(roomCode: string, userId: string): Promise<IGameRoom>;
  submitAnswer(
    roomCode: string, 
    userId: string, 
    questionId: string, 
    answer: any
  ): Promise<{ correct: boolean; score: number }>;
  getGameState(roomCode: string): Promise<IGameRoom | null>;
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
  // REVIEW: Replace any with proper type for MongoDB ChangeStream
  private changeStream: any = null;
  // UNUSED: Property declared but not used
  // private activeRooms = new Map<string, NodeJS.Timeout>();
  private gameRoomModel: Model<IGameRoom>;

  constructor() {
    this.gameRoomModel = GameRoom as unknown as Model<IGameRoom>;
    this.setupChangeStreams();
  }

  /**
   * Initialize the game service with Socket.IO instance
   * @param io Socket.IO server instance
   */
  public initialize(io: Server): void {
    this.io = io;
    this.setupSocketListeners();
  }

  /**
   * Set up MongoDB change streams for real-time updates
   */
  private setupChangeStreams(): void {
    if (this.changeStream) {
      this.changeStream.close();
    }

    if (process.env.NODE_ENV === 'test') {
      logger.info('Skipping change stream setup in test environment');
      return;
    }

    try {
      this.changeStream = this.gameRoomModel.watch([], {
        fullDocument: 'updateLookup'
      });

      this.changeStream.on('change', async (change: any) => {
        try {
          if (!this.io) return;

          const roomCode = change.fullDocument?.roomCode;
          if (!roomCode) return;

          // Get the latest room data
          const room = await this.gameRoomModel.findOne({ roomCode })
            .populate('players.userId', 'username avatar')
            .lean();

          if (!room) return;

          // Broadcast the update to all clients in the room
          this.io.to(roomCode).emit('game:update', {
            success: true,
            data: room
          });
        } catch (error) {
          logger.error('Error in change stream:', error);
        }
      });

      this.changeStream.on('error', (error: Error) => {
        logger.error('Change stream error:', error);
        // Attempt to reconnect after a delay
        setTimeout(() => this.setupChangeStreams(), 5000);
      });
    } catch (error: any) {
      const message = error && error.message ? error.message : String(error);
      logger.warn('Change stream disabled (non-replica or test env):' + message);
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
        if (room.players.length >= (room.settings?.maximumPlayers || 4)) {
          throw new Error('Room is full');
        }

        const newPlayer: IPlayer = {
          userId: userId,
          username: playerData.username,
          avatar: playerData.avatar,
          score: 0,
          isHost: room.players.length === 0, // First player is host
          isReady: false
        };

        room.players.push(newPlayer);
      }

      const updatedRoom = await room.save({ session });
      await session.commitTransaction();
      
      // Format player data, extracting usernames from emails if needed
      const formattedRoom = {
        ...updatedRoom.toObject(),
        players: updatedRoom.players.map((player: any) => ({
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

      return updatedRoom.toObject();
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
   * Get the current game state
   */
  public async getGameState(roomCode: string): Promise<IGameRoom | null> {
    try {
      const room = await this.gameRoomModel.findOne({ roomCode })
        .populate('players.userId', 'username avatar')
        .populate({
          path: 'questions',
          populate: { path: 'category' }
        })
        .lean();

      return room;
    } catch (error) {
      logger.error(`Error getting game state for room ${roomCode}:`, error);
      throw error;
    }
  }

  /**
   * Set up socket event listeners
   */
  private setupSocketListeners(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      logger.info(`New socket connection: ${socket.id}`);

      // Handle player joining a room
      socket.on('join_room', async (
        { roomCode, playerData }: { roomCode: string; playerData: Partial<IPlayer> },
        callback: SocketCallback
      ) => {
        try {
          const room = await this.joinRoom(roomCode, playerData);
          socket.join(roomCode);
          
          // Store room and player info on the socket
          socket.data = {
            ...socket.data,
            roomCode,
            playerId: playerData.userId
          };

          callback({
            success: true,
            data: room
          });
        } catch (error) {
          callback({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to join room'
          });
        }
      });

      // Handle player ready status
      socket.on('player_ready', async (data: { isReady: boolean }, callback: SocketCallback) => {
        try {
          const roomCode = socket.data?.roomCode;
          const playerId = socket.data?.playerId;
          
          if (!roomCode || !playerId) {
            return callback({ 
              success: false, 
              error: 'Not in a room or player ID not found' 
            });
          }

          const room = await this.toggleReady(roomCode, playerId);
          callback({ 
            success: true, 
            data: { 
              playerId,
              isReady: data.isReady,
              room 
            } 
          });
        } catch (error) {
          callback({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to toggle ready status' 
          });
        }
      });

      // Handle answer submission
      socket.on('submit_answer', async (
        { questionId, answer }: { questionId: string; answer: any },
        callback: SocketCallback
      ) => {
        try {
          const roomCode = socket.data?.roomCode;
          const playerId = socket.data?.playerId;
          
          if (!roomCode || !playerId) {
            return callback({ 
              success: false, 
              error: 'Not in a room or player ID not found' 
            });
          }

          const result = await this.submitAnswer(roomCode, playerId, questionId, answer);
          callback({ 
            success: true, 
            data: result 
          });
        } catch (error) {
          callback({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to submit answer' 
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const roomCode = socket.data?.roomCode;
        const playerId = socket.data?.playerId;
        
        if (roomCode && playerId) {
          this.handlePlayerDisconnect(socket, playerId, roomCode);
        }
        
        logger.info(`Socket disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Handle player disconnection
   */
  private async handlePlayerDisconnect(socket: Socket, playerId: string, roomCode: string): Promise<void> {
    try {
      logger.info(`Player ${playerId} disconnected from room ${roomCode}`);
      
      // In a real app, you might want to mark the player as inactive
      // or handle the disconnection based on your game's requirements
      
      // Broadcast player left event
      if (this.io) {
        this.io.to(roomCode).emit('player:left', {
          success: true,
          data: {
            playerId,
            roomCode
          }
        });
      }
    } catch (error) {
      logger.error(`Error handling player disconnect:`, error);
    }
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    // TODO: Implement cleanup logic for resources
    // This should close any open connections and clean up resources
    if (this.changeStream) {
      await this.changeStream.close();
    }
    // Add any additional cleanup logic here
    // For example, you might want to close any open database connections or file handles
    // You can also use this method to clean up any other resources that were allocated during the game
    this.activeRooms.forEach(clearTimeout);
    this.activeRooms.clear();
  }
}

// ... (rest of the code remains the same)
const gameService = new GameService();

export { gameService };
