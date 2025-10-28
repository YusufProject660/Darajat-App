import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { gameService } from './game.service';
import { ClientEvents, InterServerEvents, ServerEvents, SocketData } from '../types/game.types';

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
    console.log('🌐 WebSocket server is now listening for connections on path: /ws/socket.io');
    
    this.io.on('connection', (socket: Socket<ClientEvents, ServerEvents, InterServerEvents, SocketData>) => {
      console.log('✅ New WebSocket connection - ID:', socket.id);
      console.log('👥 Total connected clients:', this.io.engine.clientsCount);

      // Store player and room information in the socket
      socket.data = {
        playerId: '',
        roomCode: ''
      };

      // Handle joining a room
      socket.on('join_room', ({ roomCode, playerName, isHost = false }, callback) => {
        console.log(`join_room event received:`, { roomCode, playerName, isHost });
        try {
          let room: any;
          let player: any;

          if (isHost) {
            console.log(`Creating new room with code: ${roomCode}`);
            room = gameService.createRoom(playerName, roomCode);
            player = room.players[0];
          } else {
            console.log(`Joining existing room: ${roomCode}`);
            const result = gameService.joinRoom(roomCode, playerName);
            if (!result) {
              const errorMsg = 'Failed to join room. It may not exist or the game has already started.';
              console.error(errorMsg);
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

          console.log(`Player ${playerName} (${player.id}) joined room ${room.code}`);
          console.log(`Emitting room_joined event to socket ${socket.id}`);
          
          // Send room data to the joining player
          socket.emit('room_joined', { 
            room: room,
            player: player 
          });

          // Notify other players in the room
          if (!isHost) {
            console.log(`Notifying other players in room ${room.code} about new player`);
            socket.to(room.code).emit('player_joined', { 
              players: room.players 
            });
          }

          if (callback) callback({ success: true, room, player });
        } catch (error) {
          console.error('Error in join_room:', error);
          const errorMsg = error instanceof Error ? error.message : 'An unknown error occurred';
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
          console.error('Error starting game:', error);
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
          console.error('Error submitting answer:', error);
          socket.emit('error', { message: 'An error occurred while submitting your answer.' });
        }
      });

      // Handle chat messages
      socket.on('send_message', ({ message }) => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) {
          console.error('Missing roomCode or playerId in socket data');
          return;
        }

        console.log(`Received message from player ${playerId} in room ${roomCode}:`, message);
        
        const room = gameService.getRoom(roomCode);
        if (!room) {
          console.error(`Room ${roomCode} not found`);
          return;
        }

        const player = room.players.find(p => p.id === playerId);
        if (!player) {
          console.error(`Player ${playerId} not found in room ${roomCode}`);
          return;
        }

        const chatMessage = {
          sender: player.name,
          message: message,
          timestamp: new Date().toISOString()
        };

        console.log('Broadcasting chat message to room', roomCode, ':', chatMessage);
        
        // Broadcast to all clients in the room, including the sender
        this.io.in(roomCode).emit('chat_message', chatMessage);
      });

      // Handle player ready status
      socket.on('player_ready', ({ isReady }) => {
        const { roomCode, playerId } = socket.data;
        if (!roomCode || !playerId) return;

        const room = gameService.getRoom(roomCode);
        if (!room) return;

        const player = room.players.find(p => p.id === playerId);
        if (player) {
          player.isReady = isReady;
          // Notify all players about the updated player list
          this.io.to(roomCode).emit('player_joined', { players: room.players });
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        console.log('❌ Client disconnected - ID:', socket.id, 'Reason:', reason);
        console.log('👥 Remaining connected clients:', this.io.engine.clientsCount);
        
        // Handle player disconnection
        const { roomCode, playerId } = socket.data;
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

  private handlePlayerDisconnect(_roomCode: string, playerId: string, _socketId: string): void {
    const result = gameService.removePlayer(playerId);
    if (!result) return;

    const { roomCode: removedRoomCode, wasHost } = result;
    const room = gameService.getRoom(removedRoomCode);
    
    if (room) {
      if (wasHost && room.players.length > 0) {
        // Notify players about the new host
        this.io.to(removedRoomCode).emit('player_joined', { players: room.players });
      }
      
      // Notify remaining players that a player has left
      this.io.to(removedRoomCode).emit('player_left', {
        playerId,
        players: room.players
      });
    }

    console.log(`Player ${playerId} disconnected from room ${removedRoomCode}`);
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