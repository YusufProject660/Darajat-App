import { v4 as uuidv4 } from 'uuid';
import { GameRoom, Player, Question } from '../types/game.types';
import { generateRoomCode } from '../utils/generateRoomCode';

class GameService {
  private rooms: Map<string, GameRoom> = new Map();
  private playerRoomMap: Map<string, string> = new Map(); // playerId -> roomCode
  private questionCache: Question[] = []; // In a real app, this would come from a database

  // Initialize with some sample questions (in a real app, fetch from a database)
  constructor() {
    this.initializeSampleQuestions();
  }

  private initializeSampleQuestions(): void {
    this.questionCache = [
      {
        id: '1',
        text: 'What is the capital of France?',
        options: ['London', 'Berlin', 'Paris', 'Madrid'],
        correctAnswer: 'Paris',
        timeLimit: 30,
        category: 'Geography',
        difficulty: 'easy'
      },
      // Add more sample questions...
    ];
  }

  createRoom(hostName: string, roomCode: string = ''): GameRoom {
    const finalRoomCode = roomCode || generateRoomCode();
    const hostId = uuidv4();
    
    const newRoom: GameRoom = {
      id: uuidv4(),
      code: finalRoomCode,
      status: 'lobby',
      players: [{
        id: hostId,
        name: hostName,
        score: 0,
        isHost: true,
        isReady: false
      }],
      questions: [...this.questionCache], // In a real app, fetch questions based on criteria
      currentQuestionIndex: -1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.rooms.set(newRoom.code, newRoom);
    this.playerRoomMap.set(hostId, newRoom.code);

    return newRoom;
  }

  joinRoom(roomCode: string, playerName: string): { room: GameRoom; player: Player } | null {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'lobby') return null;

    const playerId = uuidv4();
    const newPlayer: Player = {
      id: playerId,
      name: playerName,
      score: 0,
      isHost: false,
      isReady: false
    };

    room.players.push(newPlayer);
    room.updatedAt = Date.now();
    this.playerRoomMap.set(playerId, roomCode);

    return { room, player: newPlayer };
  }

  startGame(roomCode: string, playerId: string): GameRoom | null {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'lobby') return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player || !player.isHost) return null;

    // Ensure we have enough players and questions
    if (room.players.length < 1) return null;
    if (room.questions.length === 0) return null;

    room.status = 'playing';
    room.currentQuestionIndex = 0;
    room.updatedAt = Date.now();

    return room;
  }

  submitAnswer(roomCode: string, playerId: string, answer: string): { isCorrect: boolean; correctAnswer: string; score: number } | null {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;

    const currentQuestion = room.questions[room.currentQuestionIndex];
    const isCorrect = answer === currentQuestion.correctAnswer;
    
    if (isCorrect) {
      player.score += 10; // Base points, can be adjusted
      // Bonus for quick answers could be added here
    }

    player.currentAnswer = answer;
    room.updatedAt = Date.now();

    return {
      isCorrect,
      correctAnswer: currentQuestion.correctAnswer,
      score: player.score
    };
  }

  nextQuestion(roomCode: string): Question | null {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing') return null;

    room.currentQuestionIndex++;
    room.updatedAt = Date.now();

    if (room.currentQuestionIndex >= room.questions.length) {
      this.endGame(roomCode);
      return null;
    }

    return room.questions[room.currentQuestionIndex];
  }

  endGame(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    room.status = 'ended';
    room.endTime = Date.now();
    room.updatedAt = Date.now();

    // Clean up after some time
    setTimeout(() => {
      this.cleanupRoom(roomCode);
    }, 30 * 60 * 1000); // 30 minutes after game ends
  }

  private cleanupRoom(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Remove all players from the player-room mapping
    room.players.forEach(player => {
      this.playerRoomMap.delete(player.id);
    });

    // Remove the room
    this.rooms.delete(roomCode);
  }

  getRoom(roomCode: string): GameRoom | undefined {
    return this.rooms.get(roomCode);
  }

  getPlayerRoom(playerId: string): GameRoom | undefined {
    const roomCode = this.playerRoomMap.get(playerId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  removePlayer(playerId: string): { roomCode: string; wasHost: boolean } | null {
    const roomCode = this.playerRoomMap.get(playerId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return null;

    const wasHost = room.players[playerIndex].isHost;
    
    // Remove player from the room
    room.players.splice(playerIndex, 1);
    this.playerRoomMap.delete(playerId);
    room.updatedAt = Date.now();

    // If no players left, clean up the room
    if (room.players.length === 0) {
      this.cleanupRoom(roomCode);
    } 
    // If host left and there are other players, assign new host
    else if (wasHost) {
      room.players[0].isHost = true;
    }

    return { roomCode, wasHost };
  }
}

export const gameService = new GameService();
