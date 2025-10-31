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
      SocketService.instance = new SocketService(server, io);
    }
    return SocketService.instance;
  }

  private initializeSocket(): void {
    logger.info('WebSocket server is now listening for connections on path: /ws/socket.io');
    
    this.io.on('connection', (socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>) => {
      logger.info('New WebSocket connection', { socketId: socket.id, clientCount: this.io.engine.clientsCount });

      // Store player and room information in the socket
      socket.data = {
        playerId: '',
        roomCode: ''
      };

      // Handle joining a room
      socket.on('join_room', ({ roomCode, playerName, isHost = false }, callback) => {
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        logger.info('join_room event received', { requestId, roomCode, playerName, isHost });
        
        try {
          let room: any;
          let player: any;

          if (isHost) {
            logger.info('Creating new room', { requestId, roomCode, playerName });
            room = gameService.createRoom(playerName, roomCode);
            player = room.players[0];
          } else {
            logger.info('Joining existing room', { requestId, roomCode, playerName });
            const result = gameService.joinRoom(roomCode, playerName);
            if (!result) {
              const errorMsg = 'Failed to join room. It may not exist or the game has already started.';
              logger.warn('Failed to join room', { requestId, roomCode, error: errorMsg });
              socket.emit('error', { message: errorMsg });
              if (callback) callback({ success: false, error: errorMsg });
              return;
            }
            room = result.room;
            player = result.player;
          }

          // Join the socket room
          socket.join(room.code);
          
          // Store player and room info
          socket.data = {
            playerId: player.id,
            roomCode: room.code
          };

          logger.info('Player joined room', { 
            requestId, 
            playerName, 
            playerId: player.id, 
            roomCode: room.code, 
            socketId: socket.id 
          });
          
          // Send room data to the joining player
          socket.emit('room_joined', { 
            room: room,
            player: player 
          });

          // Notify other players in the room
          if (!isHost) {
            logger.debug('Notifying other players about new player', { 
              requestId, 
              roomCode: room.code, 
              playerCount: room.players.length 
            });
            socket.to(room.code).emit('player_joined', { 
              players: room.players 
            });
          }

          if (callback) callback({ success: true, room, player });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
          logger.error('Error in join_room', { 
            requestId, 
            error: errorMsg, 
            stack: error instanceof Error ? error.stack : undefined 
          });
          socket.emit('error', { message: errorMsg });
          if (callback) callback({ success: false, error: errorMsg });
        }
      });

      // Handle starting the game
      socket.on('start_game', () => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) return;

        try {
          const room = gameService.getRoom(roomCode);
          if (!room) {
            socket.emit('error', { message: 'Room not found.' });
            return;
          }

          const player = room.players.find(p => p.id === playerId);
          if (!player?.isHost) {
            socket.emit('error', { message: 'Only the host can start the game.' });
            return;
          }

          const updatedRoom = gameService.startGame(roomCode, playerId);
          if (!updatedRoom) {
            socket.emit('error', { message: 'Failed to start the game.' });
            return;
          }

          // Notify all players that the game has started
          this.io.to(roomCode).emit('game_started', {
            firstQuestion: updatedRoom.questions[0],
            timeLimit: updatedRoom.questions[0].timeLimit
          });

          // Start the timer for the first question
          this.startQuestionTimer(roomCode, updatedRoom.questions[0].timeLimit);

        } catch (error) {
          logger.error('Error starting game', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined 
          });
          socket.emit('error', { message: 'An error occurred while starting the game.' });
        }
      });

      // Handle answer submission
      socket.on('submit_answer', ({ answer }) => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) return;

        try {
          const result = gameService.submitAnswer(roomCode, playerId, answer);
          if (!result) {
            socket.emit('error', { message: 'Failed to submit answer.' });
            return;
          }

          // Notify the player about their answer result
          socket.emit('answer_result', result);

          // Update the leaderboard for all players
          this.updateLeaderboard(roomCode);

        } catch (error) {
          logger.error('Error submitting answer', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            roomCode: socket.data.roomCode,
            playerId: socket.data.playerId
          });
          socket.emit('error', { message: 'An error occurred while submitting your answer.' });
        }
      });

      // Handle chat messages
      socket.on('send_message', ({ message }) => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          logger.warn('Missing roomCode or playerId in socket data', { roomCode, playerId });
          return;
        }

        logger.debug('Received chat message', { roomCode, playerId, message });
        
        const room = gameService.getRoom(roomCode);
        if (!room) {
          logger.warn('Room not found', { roomCode });
          return;
        }

        const player = room.players.find(p => p.id === playerId);
        if (!player) {
          logger.warn('Player not found in room', { roomCode, playerId });
          return;
        }

        const chatMessage = {
          sender: player.name,
          message: message,
          timestamp: new Date().toISOString()
        };

        logger.debug('Broadcasting chat message', { roomCode, message: chatMessage });
        
        // Broadcast to all clients in the room, including the sender
        this.io.in(roomCode).emit('chat_message', chatMessage);
      });

      // Handle player ready status
      socket.on('player_ready', async ({ isReady }, callback) => {
        const { roomCode, playerId } = socket.data;
        const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        
        logger.debug('Player ready status changed', { 
          requestId,
          roomCode, 
          playerId, 
          isReady 
        });
        
        if (!roomCode || !playerId) {
          logger.warn('Missing roomCode or playerId in player_ready event', { requestId });
          return callback?.({
            success: false,
            error: 'Missing room code or player ID'
          });
        }

        try {
          const room = gameService.getRoom(roomCode);
          if (!room) {
            logger.warn('Room not found for player_ready', { requestId, roomCode });
            return callback?.({
              success: false,
              error: 'Room not found'
            });
          }

          const player = room.players.find(p => p.id === playerId);
          if (!player) {
            logger.warn('Player not found in room', { requestId, roomCode, playerId });
            return callback?.({
              success: false,
              error: 'Player not found in room'
            });
          }

          // Update player's ready status
          player.isReady = Boolean(isReady);
          room.updatedAt = Date.now();
          
          // Get all players with their ready status
          const players = room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            isHost: p.isHost,
            isReady: p.isReady || false
          }));

          // Broadcast updated player list to all clients in the room
          this.io.to(roomCode).emit('players_updated', { players });
          
          logger.debug('Player ready status updated', { 
            requestId, 
            roomCode, 
            playerId, 
            isReady: player.isReady 
          });
          
          callback?.({
            success: true,
            isReady: player.isReady,
            message: `You are now ${player.isReady ? 'ready' : 'not ready'}`
          });
        } catch (error) {
          logger.error('Error handling player_ready event', { 
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined 
          });
          callback?.({
            success: false,
            error: 'Failed to update ready status'
          });
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        const { roomCode, playerId } = socket.data;
        
        logger.info('Client disconnected', { 
          socketId: socket.id, 
          reason, 
          roomCode,
          playerId,
          remainingClients: this.io.engine.clientsCount 
        });
        
        // Handle player disconnection
        if (roomCode && playerId) {
          this.handlePlayerDisconnect(roomCode, playerId, socket.id);
        }
      });
    });
  }

  private startQuestionTimer(roomCode: string, duration: number): void {
    // Clear any existing timer for this room
    this.clearRoomTimer(roomCode);

    let timeRemaining = duration;
    
    // Send initial time update
    this.io.to(roomCode).emit('time_update', { timeRemaining });

    // Update time every second
    const timer = setInterval(() => {
      timeRemaining--;
      
      if (timeRemaining <= 0) {
        clearInterval(timer);
        this.handleTimeUp(roomCode);
      } else {
        this.io.to(roomCode).emit('time_update', { timeRemaining });
      }
    }, 1000);

    // Store the timer so we can clear it later
    this.activeTimers.set(roomCode, timer as unknown as NodeJS.Timeout);
  }

  private async handleTimeUp(roomCode: string): Promise<void> {
    const room = gameService.getRoom(roomCode);
    if (!room || room.status !== 'playing') return;

    // Move to next question or end game
    const nextQuestion = gameService.nextQuestion(roomCode);
    
    if (nextQuestion) {
      // Send the next question to all players
      this.io.to(roomCode).emit('new_question', {
        question: nextQuestion,
        questionIndex: room.currentQuestionIndex,
        totalQuestions: room.questions.length
      });

      // Start timer for the next question
      this.startQuestionTimer(roomCode, nextQuestion.timeLimit);
    } else {
      // Game over
      this.io.to(roomCode).emit('game_ended', {
        leaderboard: this.getLeaderboard(room)
      });
    }
  }

  private updateLeaderboard(roomCode: string): void {
    const room = gameService.getRoom(roomCode);
    if (!room) return;

    this.io.to(roomCode).emit('leaderboard_update', {
      leaderboard: this.getLeaderboard(room)
    });
  }

  private getLeaderboard(room: any): Array<{ id: string; name: string; score: number }> {
    return room.players
      .map((player: any) => ({
        id: player.id,
        name: player.name,
        score: player.score
      }))
      .sort((a: any, b: any) => b.score - a.score);
  }

  private clearRoomTimer(roomCode: string): void {
    const timer = this.activeTimers.get(roomCode);
    if (timer) {
      clearInterval(timer);
      this.activeTimers.delete(roomCode);
    }
  }

  private handlePlayerDisconnect(roomCode: string, playerId: string, socketId: string): void {
    logger.info('Player disconnected from room', { roomCode, playerId, socketId });
    
    const room = gameService.getRoom(roomCode);
    if (!room) {
      logger.warn('Room not found during player disconnect', { roomCode });
      return;
    }

    const player = room.players.find(p => p.id === playerId);
    if (!player) {
      logger.warn('Player not found in room during disconnect', { roomCode, playerId });
      return;
    }

    if (player.isHost) {
      logger.info('Host left room, cleaning up', { roomCode, playerId });
      // Handle host disconnection
      this.cleanupRoom(roomCode);
      this.io.to(roomCode).emit('host_disconnected');
    } else {
      // Remove player from room
      room.players = room.players.filter(p => p.id !== playerId);
      logger.info('Player removed from room', { roomCode, playerId });
      
      // Notify other players
      this.io.to(roomCode).emit('player_left', { playerId });
    }
  }

  private cleanupRoom(roomCode: string): void {
    logger.info('Cleaning up room', { roomCode });
    // Clear any active timers
    this.clearRoomTimer(roomCode);
    // Remove room from active rooms
    gameService.removeRoom(roomCode);
  }

  // Clean up all resources when shutting down
  public cleanup(): void {
    this.activeTimers.forEach((timer) => clearInterval(timer));
    this.activeTimers.clear();
  }
}

export const initializeSocket = (server: HttpServer, io: SocketIOServer): void => {
  SocketService.getInstance(server, io);
};

export const getSocketService = (): SocketService => {
  return SocketService.getInstance();
};