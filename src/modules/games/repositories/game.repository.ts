import { ClientSession, Types } from 'mongoose';
import { GameRoom as GameRoomModel } from '../models/gameRoom.model';
import { GameRoom, Player } from '../types/game.types';

type RepositoryOptions = {
  session?: ClientSession;
};

export class GameRepository {
  // Convert MongoDB document to GameRoom
  private toGameRoom(doc: any): GameRoom {
    // Helper function to extract user ID from different possible formats
    const extractUserId = (userData: any): string => {
      if (!userData) return '';
      
      // If it's already a string or number
      if (typeof userData !== 'object') return String(userData);
      
      // If it's an ObjectId
      if (userData._id) return userData._id.toString();
      
      // If it has an id property
      if (userData.id) return String(userData.id);
      
      // If it's a plain object with stringified data
      try {
        const str = JSON.stringify(userData);
        if (str !== '{}') {
          const parsed = JSON.parse(str);
          if (parsed._id) return String(parsed._id);
          if (parsed.id) return String(parsed.id);
        }
      } catch {
        // If stringify/parse fails, continue to default
      }
      
      // Last resort - try to stringify the object
      return String(userData);
    };

    // Convert hostId to string
    const hostId = extractUserId(doc.hostId);
    
    // Process players array
    const players = (doc.players || []).map((p: any) => {
      const playerId = p._id?.toString() || extractUserId(p.userId) || '';
      const playerUserId = extractUserId(p.userId);
      
      return {
        id: playerId,
        userId: playerUserId,
        username: p.username || '',
        score: p.score || 0,
        isHost: Boolean(p.isHost),
        isReady: Boolean(p.isReady),
        socketId: p.socketId,
        avatar: p.avatar || ''
      };
    });
    
    return {
      id: doc._id?.toString() || '',
      roomCode: doc.roomCode,
      hostId,
      status: doc.status,
      settings: doc.settings || {
        maxPlayers: 10,
        questionTimeLimit: 30,
        totalQuestions: 10,
        category: 'general',
        difficulty: 'medium',
        categories: {}
      },
      players,
      questions: doc.questions || [],
      answeredQuestions: doc.answeredQuestions || [],
      currentQuestionIndex: doc.currentQuestionIndex ?? -1,
      results: doc.results || {},
      startTime: doc.startedAt ? new Date(doc.startedAt).getTime() : undefined,
      endTime: doc.finishedAt ? new Date(doc.finishedAt).getTime() : undefined,
      createdAt: doc.createdAt ? new Date(doc.createdAt).getTime() : Date.now(),
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now()
    };
  }

  // Convert GameRoom to MongoDB document
  private toMongoDoc(room: Partial<GameRoom>): any {
    return {
      roomCode: room.roomCode,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      players: room.players?.map(p => ({
        userId: p.userId || p.id,
        username: p.username,
        score: p.score,
        isHost: p.isHost,
        isReady: p.isReady,
        socketId: p.socketId
      })) || [],
      questions: room.questions || [],
      answeredQuestions: room.answeredQuestions || [],
      currentQuestionIndex: room.currentQuestionIndex ?? -1,
      results: room.results || {},
      startedAt: room.startTime ? new Date(room.startTime) : undefined,
      finishedAt: room.endTime ? new Date(room.endTime) : undefined
    };
  }

  // Start a new database session
  async startSession() {
    return await GameRoomModel.startSession();
  }

  // Create a new game room
  async createRoom(roomData: Partial<GameRoom>, options?: RepositoryOptions): Promise<GameRoom> {
    const newRoom = new GameRoomModel(this.toMongoDoc(roomData));
    const savedRoom = await newRoom.save({ session: options?.session });
    return this.toGameRoom(savedRoom);
  }

  // Get a game room by ID with optional population
  async getRoom(roomId: string, options: { 
    populate?: (string | { path: string, populate?: any })[];
    session?: ClientSession;
  } = {}): Promise<GameRoom | null> {
    try {
      let query = GameRoomModel.findById(roomId);
      
      // Apply session if provided
      if (options.session) {
        query = query.session(options.session);
      }
      
      // Apply population if specified
      if (options.populate && options.populate.length > 0) {
        options.populate.forEach(populateOpt => {
          if (typeof populateOpt === 'string') {
            query = query.populate(populateOpt);
          } else if (populateOpt && typeof populateOpt === 'object') {
            query = query.populate(populateOpt);
          }
        });
      }
      
      const room = await query.lean().exec();
      return room ? this.toGameRoom(room) : null;
    } catch (error) {
      console.error('Error in getRoom:', error);
      throw error;
    }
  }

  // Get a game room by room code with optional population
  async getRoomByCode(roomCode: string, options: {
    populate?: (string | { path: string, populate?: any })[];
    session?: ClientSession;
  } = {}): Promise<GameRoom | null> {
    try {
      let query = GameRoomModel.findOne({ roomCode });
      
      if (options.session) {
        query = query.session(options.session);
      }
      
      // Always populate players.userId by default
      if (!options.populate) {
        options.populate = [];
      }
      
      // Apply population
      options.populate.forEach(populateOpt => {
        if (typeof populateOpt === 'string') {
          query = query.populate(populateOpt);
        } else if (populateOpt && typeof populateOpt === 'object') {
          query = query.populate(populateOpt);
        }
      });
      
      const room = await query.lean().exec();
      return room ? this.toGameRoom(room) : null;
    } catch (error) {
      console.error('Error in getRoomByCode:', error);
      throw error;
    }
  }

  // Update a game room
  async updateRoom(
    roomId: string, 
    update: Partial<GameRoom>,
    options?: RepositoryOptions
  ): Promise<GameRoom | null> {
    const query = GameRoomModel.findByIdAndUpdate(
      roomId,
      { $set: this.toMongoDoc(update) },
      { new: true, runValidators: true }
    );
    
    if (options?.session) {
      query.session(options.session);
    }
    
    const updated = await query.lean().exec();
    return updated ? this.toGameRoom(updated) : null;
  }

  // Add a player to a room
  async addPlayer(
    roomId: string, 
    player: Player,
    options?: RepositoryOptions
  ): Promise<GameRoom | null> {
    const query = GameRoomModel.findByIdAndUpdate(
      roomId,
      {
        $push: {
          players: {
            userId: player.id,
            username: player.username,
            score: player.score || 0,
            isHost: player.isHost || false,
            isReady: player.isReady || false,
            socketId: player.socketId
          }
        }
      },
      { new: true }
    );
    
    if (options?.session) {
      query.session(options.session);
    }
    
    const updated = await query.lean().exec();
    return updated ? this.toGameRoom(updated) : null;
  }

  // Remove a player from a room
  async removePlayer(
    roomId: string, 
    playerId: string,
    options?: RepositoryOptions
  ): Promise<GameRoom | null> {
    const query = GameRoomModel.findByIdAndUpdate(
      roomId,
      {
        $pull: { players: { userId: playerId } }
      },
      { new: true }
    );
    
    if (options?.session) {
      query.session(options.session);
    }
    
    const updated = await query.lean().exec();
    return updated ? this.toGameRoom(updated) : null;
  }

  // Update player data in a room
  async updatePlayer(
    roomId: string,
    playerId: string,
    update: Partial<Player>,
    options?: RepositoryOptions
  ): Promise<GameRoom | null> {
    const playerUpdate: Record<string, any> = {};
    
    // Map player fields to MongoDB document structure
    if (update.username !== undefined) playerUpdate['players.$.username'] = update.username;
    if (update.score !== undefined) playerUpdate['players.$.score'] = update.score;
    if (update.isHost !== undefined) playerUpdate['players.$.isHost'] = update.isHost;
    if (update.isReady !== undefined) playerUpdate['players.$.isReady'] = update.isReady;
    if (update.socketId !== undefined) playerUpdate['players.$.socketId'] = update.socketId;
    
    const query = GameRoomModel.findOneAndUpdate(
      { _id: roomId, 'players.userId': playerId },
      { $set: playerUpdate },
      { new: true }
    );
    
    if (options?.session) {
      query.session(options.session);
    }
    
    const updated = await query.lean().exec();
    return updated ? this.toGameRoom(updated) : null;
  }

  // Delete a room
  async deleteRoom(roomId: string, options?: RepositoryOptions): Promise<boolean> {
    const query = GameRoomModel.findByIdAndDelete(roomId);
    
    if (options?.session) {
      query.session(options.session);
    }
    
    const result = await query.exec();
    return result !== null;
  }
}

export const gameRepository = new GameRepository();
