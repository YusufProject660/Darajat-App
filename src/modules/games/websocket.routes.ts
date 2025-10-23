import { Router } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';
import mongoose from 'mongoose';
import { Question } from './models/question.model';
import { Deck } from './models/deck.model';

interface Player {
  socketId: string;
  userId: string;
  username: string;
  score: number;
  isHost: boolean;
  answered: boolean;
}

interface RoomState {
  roomId: string;
  hostId: string;
  players: Player[];
  questions: any[];
  currentQuestionIndex: number;
  isStarted: boolean;
  timer?: NodeJS.Timeout;
}

// In-memory store for game rooms
const gameRooms = new Map<string, RoomState>();

// Fetch questions from MongoDB by deck/category/difficulty with random sampling
async function fetchQuestionsFromDB(params: {
  deckIds: string[];
  category?: string; // 'all' by default
  difficulty?: 'easy' | 'medium' | 'hard' | 'all';
  limit?: number; // default 10
}): Promise<any[]> {
  const { deckIds, category = 'all', difficulty = 'all', limit = 10 } = params;

  if (!deckIds || deckIds.length === 0) {
    throw new Error('deckIds are required');
  }

  const match: any = {
    deckId: { $in: deckIds.map((id) => new mongoose.Types.ObjectId(id)) }
  };

  if (category && category !== 'all') {
    match.category = category;
  }
  if (difficulty && difficulty !== 'all') {
    match.difficulty = difficulty;
  }

  const pipeline: any[] = [
    { $match: match },
    { $sample: { size: Math.max(1, limit) } },
    {
      $project: {
        _id: 1,
        text: 1,
        options: 1,
        correctAnswer: 1,
        category: 1,
        difficulty: 1
      }
    }
  ];

  const results = await Question.aggregate(pipeline).exec();
  return results.map((q: any) => ({
    id: String(q._id),
    text: q.text,
    options: q.options,
    correctAnswer: q.correctAnswer,
    category: q.category,
    difficulty: q.difficulty
  }));
}

// Helper function to get room state for clients
function getRoomStateForClients(room: RoomState) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    isStarted: room.isStarted,
    currentQuestion: room.questions[room.currentQuestionIndex] || null,
    players: room.players.map(player => ({
      id: player.userId,
      username: player.username,
      score: player.score,
      isHost: player.isHost,
      answered: player.answered
    }))
  };
}

// Helper function to log all active rooms
function logActiveRooms() {
  console.log('\n[DEBUG] ====== ACTIVE ROOMS ======');
  if (gameRooms.size === 0) {
    console.log('[DEBUG] No active rooms');
    return;
  }
  
  gameRooms.forEach((room, code) => {
    console.log(`[DEBUG] Room: ${code} (${room.players.length} players, ${room.isStarted ? 'started' : 'waiting'})`);
    room.players.forEach(p => {
      console.log(`  - ${p.username} (${p.userId})${p.isHost ? ' [HOST]' : ''}`);
    });
  });
  console.log('===============================\n');
}

export function createWebSocketRouter(io: SocketIOServer) {
  const router = Router();

  // Log active rooms periodically for debugging
  setInterval(logActiveRooms, 30000); // Log every 30 seconds

  // Status endpoint
  router.get('/status', (_req, res) => {
    try {
      res.json({
        status: 'ok',
        connected: true,
        message: 'Socket.IO service is running',
        clientsCount: io.engine?.clientsCount || 0,
        activeRooms: gameRooms.size
      });
    } catch (error) {
      console.error('Error checking socket service status:', error);
      res.status(500).json({
        status: 'error',
        connected: false,
        message: 'Error checking socket service status'
      });
    }
  });

  // List decks endpoint (so clients can fetch deckIds without remembering them)
  router.get('/decks', async (req, res) => {
    try {
      const { category, difficulty, status } = (req.query || {}) as Record<string, string | undefined>;

      const filter: any = {};
      if (typeof status === 'string' && status.length > 0) {
        filter.status = status;
      } else {
        filter.status = 'active';
      }
      if (typeof category === 'string' && category !== 'all' && category.length > 0) {
        filter.category = category;
      }
      if (typeof difficulty === 'string' && difficulty !== 'all' && difficulty.length > 0) {
        filter.difficulty = difficulty;
      }

      const decks = await Deck.find(filter)
        .select('_id name category difficulty status questionCount createdAt')
        .sort({ createdAt: -1 })
        .lean();

      res.json({ success: true, decks });
    } catch (error) {
      console.error('Error fetching decks:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch decks' });
    }
  });

  // Initialize socket connection
  io.on('connection', (socket: Socket) => {
    console.log(`Player connected: ${socket.id}`);

    // Handle room creation
    socket.on('create_room', (data: { roomCode: string; playerName: string }, callback: (response: any) => void) => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      console.log(`[${requestId}] Create room request:`, data);
      
      if (!data || !data.roomCode || !data.playerName) {
        console.error(`[${requestId}] Invalid create_room data:`, data);
        return callback({
          success: false,
          error: 'Room code and player name are required',
          requestId
        });
      }

      const { roomCode, playerName } = data;
      const trimmedRoomCode = roomCode.trim().toUpperCase();
      const trimmedPlayerName = playerName.trim();
      
      try {
        console.log(`[${requestId}] Creating room ${trimmedRoomCode} for player ${trimmedPlayerName}`);
        
        // Check if room already exists (case-insensitive)
        const existingRoom = Array.from(gameRooms.entries())
          .find(([code]) => code.toUpperCase() === trimmedRoomCode);
          
        if (existingRoom) {
          console.log(`[${requestId}] Room ${trimmedRoomCode} already exists`);
          return callback({
            success: false,
            error: 'Room already exists',
            requestId
          });
        }
        
        // Create new room and add host as first player
        const player: Player = {
          socketId: socket.id,
          userId: `user-${Date.now()}`,
          username: trimmedPlayerName,
          score: 0,
          isHost: true,
          answered: false
        };

        const room: RoomState = {
          roomId: trimmedRoomCode,
          hostId: socket.id,
          players: [player],
          questions: [],
          currentQuestionIndex: -1,
          isStarted: false
        };
        
        gameRooms.set(trimmedRoomCode, room);
        socket.join(trimmedRoomCode);
        
        // Store player data in socket
        socket.data = {
          playerId: player.userId,
          roomCode: trimmedRoomCode,
          isHost: true,
          username: player.username,
          requestId
        };
        
        // Get room state for response
        const roomState = getRoomStateForClients(room);
        
        // Send success response with room state
        const response = {
          success: true,
          roomCode: trimmedRoomCode,
          isHost: true,
          players: roomState.players,
          isStarted: false,
          requestId,
          timestamp: new Date().toISOString()
        };
        
        console.log(`[${requestId}] Room ${trimmedRoomCode} created successfully`);
        callback(response);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${requestId}] Error creating room:`, errorMsg, error);
        
        callback({
          success: false,
          error: 'Failed to create room',
          details: errorMsg,
          requestId,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Join room handler with enhanced debugging and error handling
    socket.on('join_room', async (data: { roomCode: string; playerName: string }, callback: (response: any) => void) => {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      console.log(`[${requestId}] Join room request:`, data);

      try {
        const { roomCode, playerName } = data;
        
        // Input validation
        if (!roomCode || !playerName) {
          console.error(`[${requestId}] Missing required fields`);
          return callback({ 
            success: false, 
            error: 'Room code and player name are required',
            requestId,
            timestamp: new Date().toISOString()
          });
        }

        const trimmedRoomCode = roomCode.trim().toUpperCase();
        const trimmedPlayerName = playerName.trim();

        // Find room (case-insensitive)
        const [actualRoomCode, room] = Array.from(gameRooms.entries())
          .find(([code]) => code.toUpperCase() === trimmedRoomCode) || [];

        if (!room) {
          console.error(`[${requestId}] Room not found: ${trimmedRoomCode}`);
          return callback({ 
            success: false, 
            error: 'Room not found. Please check the room code.',
            requestId,
            timestamp: new Date().toISOString()
          });
        }

        const resolvedRoomCode = actualRoomCode as string;

        // Check if game has started
        if (room.isStarted) {
          console.error(`[${requestId}] Game already started in room: ${actualRoomCode}`);
          return callback({ 
            success: false, 
            error: 'Game has already started in this room',
            requestId,
            timestamp: new Date().toISOString()
          });
        }

        // Check if username is taken (case-insensitive)
        const existingPlayer = room.players.find(
          p => p.username.toLowerCase() === trimmedPlayerName.toLowerCase()
        );

        if (existingPlayer) {
          console.error(`[${requestId}] Username already taken: ${trimmedPlayerName}`);
          return callback({ 
            success: false, 
            error: 'Username already taken in this room',
            suggestedName: `${trimmedPlayerName}${Math.floor(100 + Math.random() * 900)}`,
            requestId,
            timestamp: new Date().toISOString()
          });
        }

        // Create new player
        const player: Player = {
          socketId: socket.id,
          userId: `user-${Date.now()}`,
          username: trimmedPlayerName,
          score: 0,
          isHost: false,
          answered: false
        };

        try {
          // Join the room
          await socket.join(resolvedRoomCode);
          room.players.push(player);

          // Store player data in socket
          socket.data = {
            playerId: player.userId,
            roomCode: resolvedRoomCode,
            isHost: false,
            username: player.username,
            requestId
          };

          // Get room state for response
          const roomState = getRoomStateForClients(room);

          // Notify all clients in the room
          io.to(resolvedRoomCode).emit('player_joined', {
            player: {
              id: player.userId,
              username: player.username,
              isHost: player.isHost,
              score: player.score
            },
            room: roomState,
            timestamp: new Date().toISOString()
          });

          console.log(`[${requestId}] Player ${player.userId} joined room ${resolvedRoomCode}`);

          // Send success response
          callback({
            success: true,
            roomCode: resolvedRoomCode,
            isHost: false,
            players: roomState.players,
            isStarted: room.isStarted,
            requestId,
            timestamp: new Date().toISOString()
          });

        } catch (joinError) {
          console.error(`[${requestId}] Error joining socket room:`, joinError);
          throw new Error('Failed to join room. Please try again.');
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[${requestId}] Error in join_room:`, errorMsg, error);
        callback({ 
          success: false, 
          error: errorMsg,
          requestId,
          timestamp: new Date().toISOString()
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      
      const { roomCode, playerId } = socket.data || {};
      if (!roomCode) return;
      
      const room = gameRooms.get(roomCode);
      if (!room) return;
      
      // Remove player from the room
      const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIndex === -1) return;
      
      const player = room.players[playerIndex];
      room.players.splice(playerIndex, 1);
      
      console.log(`Player ${playerId} left room ${roomCode}`);
      
      // If no players left, remove the room
      if (room.players.length === 0) {
        gameRooms.delete(roomCode);
        console.log(`Room ${roomCode} closed (no players left)`);
        return;
      }
      
      // If host left, assign new host
      if (socket.id === room.hostId) {
        const newHost = room.players[0];
        newHost.isHost = true;
        room.hostId = newHost.socketId;
        
        // Notify all players about new host
        io.to(roomCode).emit('host_changed', {
          newHostId: newHost.socketId,
          newHostName: newHost.username,
          timestamp: new Date().toISOString()
        });
      }
      
      // Update remaining players
      io.to(roomCode).emit('player_left', {
        playerId: socket.id,
        players: room.players.map(p => ({
          id: p.userId,
          username: p.username,
          score: p.score,
          isHost: p.isHost
        })),
        timestamp: new Date().toISOString()
      });
    });

    // Handle starting the game
    socket.on('start_game', async (data: { roomCode: string; deckIds?: string[]; category?: string; difficulty?: 'easy' | 'medium' | 'hard' | 'all'; limit?: number; questionCount?: number }, callback: Function) => {
      console.log('start_game event received:', data);
      try {
        const { roomCode } = data;
        let deckIds = data.deckIds || [];
        const category = data.category ?? 'all';
        const difficulty = (data.difficulty as any) ?? 'all';
        const limit = (typeof data.questionCount === 'number' ? data.questionCount : data.limit) ?? 10;
        console.log('Processing start_game for room:', roomCode);
        console.log('Available rooms:', Array.from(gameRooms.keys()));
        
        const room = gameRooms.get(roomCode);
        
        if (!room) {
          console.error('Room not found:', roomCode);
          return callback({ 
            success: false, 
            error: 'Room not found',
            details: `Room ${roomCode} does not exist`
          });
        }
        
        console.log('Room found, checking host status...');
        
        // Check if the requester is the host
        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) {
          console.error('Player not found in room:', socket.id);
          return callback({ 
            success: false, 
            error: 'Player not found in room',
            details: 'Your session might have expired'
          });
        }
        
        if (!player.isHost) {
          console.error('Non-host player attempted to start the game:', player.username);
          return callback({ 
            success: false, 
            error: 'Only the host can start the game',
            details: 'You must be the host to start the game'
          });
        }

        // Check if there are enough players
        if (room.players.length < 1) {
          console.error('Not enough players to start the game');
          return callback({
            success: false,
            error: 'Need at least 1 player to start the game',
            details: 'Invite more players before starting'
          });
        }

        // If deckIds not provided, derive from category/difficulty
        if ((!deckIds || deckIds.length === 0) && (category !== 'all' || difficulty !== 'all')) {
          const deckFilter: any = { status: 'active' };
          if (category !== 'all') deckFilter.category = category;
          if (difficulty !== 'all') deckFilter.difficulty = difficulty;
          const decks = await Deck.find(deckFilter).select('_id').lean();
          deckIds = decks.map(d => String(d._id));
        }

        // Validate required filters
        if (!deckIds || deckIds.length === 0) {
          return callback({ success: false, error: 'No decks found for selected filters', details: { category, difficulty } });
        }

        // Load questions from the database
        const questions = await fetchQuestionsFromDB({
          deckIds,
          category,
          difficulty: (['easy','medium','hard','all'] as const).includes(difficulty as any) ? (difficulty as any) : 'all',
          limit
        });

        if (!questions.length) {
          return callback({
            success: false,
            error: 'No questions found for the selected filters',
            details: { deckIds, category, difficulty, limit }
          });
        }

        // Start the game
        room.isStarted = true;
        room.currentQuestionIndex = 0;
        room.questions = questions;
        
        // Notify all players that the game has started
        io.to(roomCode).emit('game_started', {
          roomCode,
          questionCount: room.questions.length,
          totalQuestions: room.questions.length,
          players: room.players.map(p => ({
            id: p.userId,
            username: p.username,
            isHost: p.isHost,
            score: p.score
          }))
        });
        
        // Send the first question immediately
        sendQuestion(io, roomCode);
        
        callback({
          success: true,
          message: 'Game started successfully',
          roomCode,
          questionCount: room.questions.length,
          totalQuestions: room.questions.length
        });
        
      } catch (error) {
        console.error('Error starting game:', error);
        callback({
          success: false,
          error: 'Failed to start game',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // Handle answer submission
    socket.on('submit_answer', (data: { roomCode: string; answer: number; questionIndex: number }) => {
      console.log('submit_answer event received:', data);
      try {
        const { roomCode, answer, questionIndex } = data;
        const room = gameRooms.get(roomCode);
        
        if (!room) {
          console.error('Room not found for answer submission:', roomCode);
          return;
        }
        
        const player = room.players.find(p => p.socketId === socket.id);
        if (!player) {
          console.error('Player not found for answer submission');
          return;
        }
        
        // Check if player already answered
        if (player.answered) {
          console.log('Player already answered this question');
          return;
        }
        
        // Get current question
        const currentQuestion = room.questions[room.currentQuestionIndex];
        if (!currentQuestion) {
          console.error('No current question found');
          return;
        }
        
        // Check if answer is correct
        const isCorrect = answer === currentQuestion.correctAnswer;
        
        // Update player status
        player.answered = true;
        if (isCorrect) {
          player.score += 10;
        }
        
        console.log(`Player ${player.username} answered: ${answer}, correct: ${currentQuestion.correctAnswer}, isCorrect: ${isCorrect}`);
        
        // Send result back to the player
        socket.emit('answer_result', {
          isCorrect,
          correctAnswer: currentQuestion.options[currentQuestion.correctAnswer],
          score: player.score
        });
        
        // Update leaderboard immediately
        updateLeaderboard(io, room);
        
        // Move to next question after a brief delay to show feedback
        console.log('Player answered, moving to next question after brief delay');
        // Clear current timer
        if (room.timer) {
          clearTimeout(room.timer);
        }
        // Wait 2 seconds to show feedback, then move to next question
        setTimeout(() => {
          nextQuestion(io, roomCode);
        }, 2000);
        
      } catch (error) {
        console.error('Error submitting answer:', error);
        socket.emit('error', { message: 'An error occurred while submitting your answer.' });
      }
    });

  }); // End of io.on('connection')

  // Helper function to send question to all players in a room
  async function sendQuestion(io: any, roomId: string) {
    const room = gameRooms.get(roomId);
    if (!room || !room.isStarted) return;

    const question = room.questions[room.currentQuestionIndex];
    if (!question) {
      // No more questions, end game
      endGame(io, roomId);
      return;
    }

    // Reset player answer status
    room.players.forEach(player => {
      player.answered = false;
    });

    // Send question to all players
    io.to(roomId).emit('question', {
      question: question.question || question.text,
      options: question.options,
      questionNumber: room.currentQuestionIndex + 1,
      totalQuestions: room.questions.length,
      category: question.category
    });

    // Set timer for question (30 seconds)
    room.timer = setTimeout(() => {
      nextQuestion(io, roomId);
    }, 30000);
  }

  // Helper function to move to next question
  function nextQuestion(io: any, roomId: string) {
    const room = gameRooms.get(roomId);
    if (!room) return;

    room.currentQuestionIndex++;
    
    if (room.currentQuestionIndex < room.questions.length) {
      sendQuestion(io, roomId);
    } else {
      endGame(io, roomId);
    }
  }

  // Helper function to update leaderboard
  function updateLeaderboard(io: any, room: RoomState) {
    const leaderboard = room.players
      .map(player => ({
        id: player.userId,
        username: player.username,
        score: player.score
      }))
      .sort((a, b) => b.score - a.score);

    io.to(room.roomId).emit('leaderboardUpdate', { leaderboard });
  }

  // Helper function to end the game
  function endGame(io: any, roomId: string) {
    const room = gameRooms.get(roomId);
    if (!room) return;

    // Calculate final scores
    const leaderboard = room.players
      .map(player => ({
        id: player.userId,
        username: player.username,
        score: player.score
      }))
      .sort((a, b) => b.score - a.score);

    // Send final results with enhanced leaderboard data
    io.to(roomId).emit('game_ended', { 
      leaderboard,
      totalQuestions: room.questions.length,
      players: room.players.map(player => ({
        id: player.userId,
        username: player.username,
        score: player.score,
        isHost: player.isHost
      }))
    });

    // Clean up
    if (room.timer) clearTimeout(room.timer);
    gameRooms.delete(roomId);
  }

  return router;
}