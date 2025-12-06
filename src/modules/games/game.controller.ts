import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

import { AppError } from '../../utils/appError';
import { GameRoom, IPlayer, IAnsweredQuestion } from './models/gameRoom.model';
import { Deck } from './models/deck.model';
import { DashboardGame } from '../dashboard/models/dashboard-game.model';
import {gameService} from './services/game.service';
import User from '../users/user.model';
import { Question } from './models/question.model';
import { generateUniqueRoomCode } from './utils/generateRoomCode';
import { IUser } from '../users/user.model';
import { logger } from '../../utils/logger';
import { bufferManager } from './utils/bufferManager';

/**
 * Clean up game object before sending in response
 */
const cleanGameResponse = (game: any) => {
  const cleanedGame = JSON.parse(JSON.stringify(game));
  
  // Remove the specified fields
  const fieldsToRemove = [
    'results',
    'currentQuestion',
    'answeredQuestions',
    'stats',
    'createdAt',
    'updatedAt',
    '__v'
  ];
  
  // Remove the fields if they exist
  fieldsToRemove.forEach(field => {
    if (field in cleanedGame) {
      delete cleanedGame[field];
    }
  });

  // Rename _id to game_id for the game object
  if (cleanedGame._id) {
    cleanedGame.game_id = cleanedGame._id;
    delete cleanedGame._id;
  }

  // Rename _id to question_id in questions array and add option IDs
  if (Array.isArray(cleanedGame.questions)) {
    cleanedGame.questions = cleanedGame.questions.map((question: any) => {
      if (question._id) {
        const updatedQuestion = { ...question };
        updatedQuestion.question_id = updatedQuestion._id;
        delete updatedQuestion._id;
        
        // Store original options array before formatting
        const originalOptions = Array.isArray(updatedQuestion.options) 
          ? [...updatedQuestion.options] 
          : [];
        
        // Add option IDs to options array
        if (Array.isArray(updatedQuestion.options)) {
          updatedQuestion.options = updatedQuestion.options.map((option: string, index: number) => ({
            option_id: index,
            text: option
          }));
        }
        
        // Add correctAnswer with option_id and text
        if (updatedQuestion.correctAnswer !== undefined && originalOptions.length > 0) {
          const correctAnswerIndex = updatedQuestion.correctAnswer;
          updatedQuestion.correctAnswer = {
            option_id: correctAnswerIndex,
            text: originalOptions[correctAnswerIndex] || ''
          };
        }
        
        // Remove deck and deckId fields
        delete updatedQuestion.deck;
        delete updatedQuestion.deckId;
        
        return updatedQuestion;
      }
      return question;
    });
  }

  // Remove 'enabled' field from categories (keep only difficulty)
  if (cleanedGame.settings?.categories && typeof cleanedGame.settings.categories === 'object') {
    const cleanedCategories: any = {};
    for (const [category, config] of Object.entries(cleanedGame.settings.categories)) {
      if (config && typeof config === 'object' && 'difficulty' in config) {
        cleanedCategories[category] = {
          difficulty: (config as any).difficulty
        };
      }
    }
    cleanedGame.settings.categories = cleanedCategories;
  }
  
  return cleanedGame;
};


interface IGameRequest extends Request {
  user?: IUser;
  body: {
    categories: Record<string, boolean>;
    numberOfQuestions?: number;
    maximumPlayers?: number;
    gameId?: string;
  };
  [key: string]: any;
}


interface IRequestWithUser extends Request {
  user?: IUser;
  body: {
    roomCode: string;
    avatar?: string;
  };
}

interface IGameLobbyRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

interface IFinishGameRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

/**
 * @desc    Create a new game room
 * @route   POST /api/game/create
 * @access  Private
 */
const createGame = async (req: IGameRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    const { categories = {}, numberOfQuestions = 10, maximumPlayers = 4, gameId } = req.body;

    // Validate gameId
    if (!gameId) {
      return res.apiError('Game ID is required', 'GAME_ID_REQUIRED');
    }

    // Find game by ID (from dashboard games collection)
    const game = await DashboardGame.findOne({ id: gameId });
    if (!game) {
      logger.error('[createGame] 400: Game not found', { gameId });
      return res.apiError('Game not found', 'GAME_NOT_FOUND');
    }

    // Check if game is available
    if (game.status !== 'available') {
      logger.error('[createGame] 400: Game not available', { gameId, status: game.status });
      return res.apiError(`Game is ${game.status}`, 'GAME_NOT_AVAILABLE');
    }

    if (typeof numberOfQuestions !== 'number' || numberOfQuestions < 1 || numberOfQuestions > 60) {
      return res.apiError('Number of questions must be between 1 and 60', 'INVALID_INPUT');
    }

    if (isNaN(Number(maximumPlayers)) || !Number.isInteger(Number(maximumPlayers)) || 
        Number(maximumPlayers) < 2 || Number(maximumPlayers) > 10) {
      return res.apiError('Maximum players must be an integer between 2 and 10', 'INVALID_INPUT');
    }

    const processedCategories = new Map();
    const enabledCategories: Array<{category: string, difficulty: string}> = [];

    for (const [category, settings] of Object.entries(categories as Record<string, any>)) {
      if (settings?.enabled) {
        processedCategories.set(category, {
          enabled: true,
          difficulty: settings.difficulty
        });
        enabledCategories.push({
          category: settings.name || category.toLowerCase(),
          difficulty: settings.difficulty || 'easy'
        });
      } else {
        processedCategories.set(category, {
          enabled: false,
          difficulty: 'easy'
        });
      }
    }

    if (enabledCategories.length === 0) {
      logger.error('[createGame] 400: no enabled categories after processing');
      return res.apiError('At least one category must be enabled', 'NO_CATEGORIES_ENABLED');
    }

    // Get questions for the selected categories (purana system - no game filter)
    const questionPromises = enabledCategories.map(async ({ category, difficulty }) => {
      const decks = await Deck.find({
        $or: [
          { category: { $regex: new RegExp(category, 'i') } },
          { name: { $regex: new RegExp(category, 'i') } }
        ]
      });

      if (!Array.isArray(decks) || decks.length === 0) return [];

      const deckIds = decks.map(deck => deck._id);
      
      // First try to get questions with exact difficulty match
      let questions = await Question.find({
        deckId: { $in: deckIds },
        difficulty: difficulty.toLowerCase()
      }).limit(numberOfQuestions);

      // If not enough questions, get any difficulty
      if ((questions?.length || 0) < numberOfQuestions) {
        const additionalQuestions = await Question.find({
          deckId: { $in: deckIds },
          _id: { $nin: (questions || []).map(q => q._id) }
        }).limit(numberOfQuestions - (questions?.length || 0));
        
        questions = [...(questions || []), ...additionalQuestions];
      }

      return questions;
    });

    const questionsResults = await Promise.all(questionPromises);
    const allQuestions = questionsResults.flat();

    if (allQuestions.length === 0) {
      logger.error('[createGame] 400: no questions found');
      return res.apiError('No questions found for the selected categories', 'NOT_FOUND');
    }

    // Shuffle and limit questions
    const shuffledQuestions = allQuestions
      .sort(() => 0.5 - Math.random())
      .slice(0, numberOfQuestions);

    if (shuffledQuestions.length === 0) {
      logger.error('[createGame] 400: shuffledQuestions empty');
      return res.apiError('No questions found for the selected categories and difficulty levels', 'NOT_FOUND');
    }

    // Create game room
    const roomCode = await generateUniqueRoomCode();
    
    try {
      const newRoom = new GameRoom({
        hostId: req.user._id,
        roomCode,
        gameId: game.id, // Store gameId for join response
        settings: {
          categories: processedCategories,
          numberOfQuestions,
          maximumPlayers
        },
        players: [{
          userId: req.user._id,
          username: req.user.username || 'Player',
          isHost: true,
          score: 0,
          avatar: req.user.avatar || ''
        }],
        questions: shuffledQuestions.map(q => q._id),
        status: 'waiting',
        answeredQuestions: [],
        results: []
      });

      const saved = await newRoom.save();
      
      // Socket join for host
      const io = (req as any).app?.get('io');
      if (io && req.user) {
        const userId = req.user._id.toString();
        const allSockets = await io.fetchSockets();
        const userSocket = allSockets.find((socket: any) => {
          const socketUserId = socket.data?.user?.id || socket.data?.user?._id?.toString();
          return socketUserId === userId;
        });

        if (userSocket) {
          await userSocket.join(roomCode);
          userSocket.data.roomCode = roomCode;
          userSocket.data.playerId = userId;
          logger.info('✅ Host socket joined room via API', { userId, roomCode });
        }
      }
      
      const populatedGame = await GameRoom.findById(saved._id)
        .populate({
          path: 'players.userId',
          select: 'username avatar'
        })
        .populate('questions')
        .lean() as any;

      if (populatedGame?.settings) {
        populatedGame.settings.categories = Object.fromEntries(processedCategories);
      }

      // Add game details to response
      const cleanedResponse = cleanGameResponse(populatedGame);
      cleanedResponse.game = {
        id: game.id,
        name: game.title,
        title: game.title,
        image: game.image,
        description: game.description,
        status: game.status
      };
      cleanedResponse.maximumPlayers = maximumPlayers;

      return res.apiSuccess(cleanedResponse, 'Game created successfully');
    } catch (error) {
      logger.error('Error in createGame:', error);
      return res.apiError('Failed to create game room', 'GAME_CREATION_FAILED');
    }
  } catch (error) {
    logger.error('Unexpected error in createGame:', error);
    return res.apiError('An unexpected error occurred', 'INTERNAL_SERVER_ERROR');
  }
};

/**
 * @desc    Join an existing game room
 * @route   POST /api/game/join
 * @access  Private
 */
const joinGame = async (req: IRequestWithUser, res: Response) => {
  try {
    if (!req.user) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    const { roomCode } = req.body;
    
    if (!roomCode || typeof roomCode !== 'string' || roomCode.trim() === '') {
      return res.apiError('Room code is required', 'INVALID_ROOM_CODE');
    }

    const userId = req.user._id;
    const username = req.user.username;
    const avatar = req.body.avatar || req.user.avatar || '';

    console.log('═══════════════════════════════════════════════════════════');
    console.log('🎮 [JOIN GAME API] Starting player join process...');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('👤 User ID:', userId.toString());
    console.log('👤 Username:', username);
    console.log('🏠 Room Code:', roomCode);

    // ⭐ STEP 1: CHECK Socket.IO available hai ya nahi
    const io = (req as any).app?.get('io');
    console.log('🔌 Socket.IO Available:', !!io);
    
    if (!io) {
      console.log('❌ [ERROR] Socket.IO not available!');
      logger.error('Socket.IO not available for join game', { userId: userId.toString(), roomCode });
      return res.apiError('Socket connection is required. Please connect to socket first.', 'SOCKET_NOT_CONNECTED');
    }

    // ⭐ STEP 2: CHECK User ka socket connected hai ya nahi
    const allSockets = await io.fetchSockets();
    console.log('📊 Total Connected Sockets:', allSockets.length);
    
    const userSocket = allSockets.find((socket: any) => {
      const socketUserId = socket.data?.user?.id || socket.data?.user?._id?.toString();
      return socketUserId === userId.toString();
    });

    // ⭐ CHECK: Agar socket connected nahi hai, to return kar do
    if (!userSocket) {
      console.log('❌ [ERROR] Socket not connected for user!');
      console.log('💡 User needs to connect socket first');
      logger.warn('⚠️ Socket not connected for user', { userId: userId.toString() });
      return res.apiError('Socket connection is required. Please connect to socket first before joining the game.', 'SOCKET_NOT_CONNECTED');
    }

    console.log('✅ [SOCKET] User socket found! Socket connected.');
    console.log('📋 Socket ID:', userSocket.id);
    console.log('📋 Socket Data:', {
      userId: userSocket.data?.user?.id,
      username: userSocket.data?.user?.username,
      roomCode: userSocket.data?.roomCode
    });

    try {
      // ⭐ STEP 3: DB ENTRY - Player ko room me add karo
      console.log('💾 [DB] Adding player to room in database...');
      const updatedRoom = await gameService.joinRoom(roomCode.trim().toUpperCase(), {
        userId: userId as any,
        username,
        avatar,
        isReady: false,
        score: 0
      });
      console.log('✅ [DB] Player added to room successfully!');
      console.log('📊 Total Players in Room:', updatedRoom.players?.length || 0);
      console.log('🔍 [DEBUG] Updated Room Players:', JSON.stringify(updatedRoom.players?.map((p: any) => ({
        userId: p.userId,
        userIdType: typeof p.userId,
        userIdString: p.userId?.toString?.(),
        username: p.username,
        isHost: p.isHost
      })), null, 2));
      console.log('🔍 [DEBUG] Host ID:', updatedRoom.hostId?.toString());

      // ⭐ STEP 4: SOCKET JOIN ROOM - DB entry ke baad socket se room join karo
      console.log('🔌 [SOCKET] Joining socket to room...');
      await userSocket.join(roomCode);
      userSocket.data.roomCode = roomCode;
      userSocket.data.playerId = userId.toString();
      
      console.log('✅ [SOCKET] Socket joined room:', roomCode);
      console.log('📋 Active Rooms:', Array.from(userSocket.rooms));
      logger.info('✅ Socket joined room via API', { userId: userId.toString(), roomCode });

      // Fetch fresh room data to ensure we have proper player structure
      const freshRoom = await GameRoom.findOne({ roomCode: roomCode.trim().toUpperCase() }).lean() as any;
      const hostIdForEvent = freshRoom?.hostId?.toString() || updatedRoom.hostId?.toString();
      
      // Prepare player joined data
      const playerJoinedData = {
        player: {
          id: userId.toString(),
          userId: userId.toString(),
          username: username,
          avatar: avatar || '',
          score: 0,
          isHost: hostIdForEvent === userId.toString()
        },
        players: (freshRoom?.players || updatedRoom.players || []).map((p: any) => {
          // Extract userId properly - handle ObjectId, string, or populated object
          let playerUserId: string = '';
          
          // Try multiple ways to extract userId
          if (p.userId) {
            // If userId is ObjectId
            if (p.userId.toString && typeof p.userId.toString === 'function') {
              playerUserId = p.userId.toString();
            }
            // If userId is already string
            else if (typeof p.userId === 'string') {
              playerUserId = p.userId;
            }
            // If userId is object with _id
            else if (p.userId._id) {
              playerUserId = p.userId._id.toString();
            }
            // Last resort: convert to string
            else {
              playerUserId = String(p.userId);
            }
          }
          
          // If still empty, log for debugging
          if (!playerUserId) {
            console.log('⚠️ [WARNING] Could not extract userId for player:', {
              username: p.username,
              userId: p.userId,
              userIdType: typeof p.userId,
              _id: p._id
            });
          }
          
          // Check if player is host by comparing with hostId (ensure both are strings)
          const hostIdStr = hostIdForEvent?.toString() || '';
          let isHost = false;
          
          if (hostIdStr && playerUserId) {
            // Compare both as strings (normalize both)
            const normalizedPlayerId = playerUserId.toString().trim();
            const normalizedHostId = hostIdStr.toString().trim();
            isHost = normalizedPlayerId === normalizedHostId;
          }
          
          // Fallback to p.isHost if hostId comparison didn't work
          if (!isHost && p.isHost === true) {
            isHost = true;
          }
          
          return {
            id: playerUserId || p._id?.toString() || '',
            userId: playerUserId || p._id?.toString() || '', // Ensure userId is always included
            username: p.username || '',
            avatar: p.avatar || '',
            score: p.score || 0,
            isHost: isHost
          };
        })
      };

      console.log('📦 [DATA] Player joined data prepared:', {
        player: playerJoinedData.player,
        totalPlayers: playerJoinedData.players.length
      });

      // Get all receivers (except sender) - Buffer logic
      const socketsInRoom = await io.in(roomCode).fetchSockets();
      console.log('👥 [RECEIVERS] Checking for receivers in room:', roomCode);
      console.log('📊 Total Sockets in Room:', socketsInRoom.length);
      
      const receiverIds = socketsInRoom
        .filter((s: any) => s.data?.user?.id && s.data.user.id !== userId.toString())
        .map((s: any) => s.data.user.id);

      console.log('📊 [RECEIVERS] Receiver IDs:', receiverIds);
      console.log('📊 [RECEIVERS] Receiver Count:', receiverIds.length);

      // Create buffer if there are receivers
      if (receiverIds.length > 0) {
        console.log('📦 [BUFFER] Creating buffer for', receiverIds.length, 'receivers...');
        
        const taskId = await bufferManager.createBuffer(
          roomCode,
          userId.toString(),
          'player:joined',
          playerJoinedData,
          receiverIds
        );

        console.log('✅ [BUFFER] Buffer created with taskId:', taskId);

        // Broadcast with taskId (joining player ko chod kar sab ko)
        console.log('📤 [EMIT] Broadcasting player:joined event with buffer...');
        console.log('📋 [EMIT] TaskId:', taskId);
        console.log('📋 [EMIT] Sender ID:', userId.toString());
        console.log('📋 [EMIT] Receivers:', receiverIds);
        
        // Joining player ko exclude karke sab ko event bhejo
        userSocket.to(roomCode).emit('player:joined', {
          ...playerJoinedData,
          taskId,
          senderId: userId.toString()
        } as any);

        console.log('✅ [EMIT] player:joined event sent with buffer!');
        logger.info('📤 Player joined event sent with buffer', { 
          taskId, 
          roomCode, 
          receiverCount: receiverIds.length 
        });
      } else {
        // No receivers, normal emit (joining player ko chod kar)
        console.log('📤 [EMIT] No receivers found - sending normal emit (no buffer)');
        userSocket.to(roomCode).emit('player:joined', playerJoinedData);
        console.log('✅ [EMIT] player:joined event sent (no buffer tracking)');
      }
      
      console.log('═══════════════════════════════════════════════════════════');

      // Populate players and questions for response
      const populatedRoom = await GameRoom.findById(updatedRoom._id)
        .populate({
          path: 'players.userId',
          select: 'username avatar'
        })
        .populate('questions')
        .lean() as any;

      // Format players with is_me field
      const hostId = populatedRoom?.hostId?.toString() || updatedRoom.hostId?.toString();
      const formattedPlayers = (populatedRoom?.players || []).map((p: any) => {
        const playerUserId = p.userId?._id?.toString() || p.userId?.toString() || p.userId;
        const currentUserId = userId.toString();
        const isMe = playerUserId === currentUserId;
        // Check if player is host by comparing with hostId
        const isHost = hostId && (playerUserId === hostId || p.isHost === true);

        return {
          userId: p.userId ? {
            _id: p.userId._id?.toString() || p.userId.toString(),
            username: p.userId.username || p.username
          } : {
            _id: p.userId?.toString() || p.userId,
            username: p.username
          },
          username: p.username,
          avatar: p.avatar || '',
          isHost: isHost || false,
          is_me: isMe,
          _id: p._id?.toString() || p._id
        };
      });

      // Format questions same as create room (using cleanGameResponse logic)
      let formattedQuestions: any[] = [];
      if (Array.isArray(populatedRoom?.questions)) {
        formattedQuestions = populatedRoom.questions.map((question: any) => {
          if (!question._id) return question;
          
          const updatedQuestion: any = { ...question };
          updatedQuestion.question_id = updatedQuestion._id?.toString() || updatedQuestion._id;
          delete updatedQuestion._id;
          
          // Store original options array before formatting
          const originalOptions = Array.isArray(updatedQuestion.options) 
            ? [...updatedQuestion.options] 
            : [];
          
          // Add option IDs to options array (same as create room)
          if (Array.isArray(updatedQuestion.options)) {
            updatedQuestion.options = updatedQuestion.options.map((option: string, index: number) => ({
              option_id: index,
              text: option
            }));
          }
          
          // Add correctAnswer with option_id and text (same as create room)
          if (updatedQuestion.correctAnswer !== undefined && originalOptions.length > 0) {
            const correctAnswerIndex = updatedQuestion.correctAnswer;
            updatedQuestion.correctAnswer = {
              option_id: correctAnswerIndex,
              text: originalOptions[correctAnswerIndex] || ''
            };
          }
          
          // Remove deck and deckId fields (same as create room)
          delete updatedQuestion.deck;
          delete updatedQuestion.deckId;
          
          return updatedQuestion;
        });
      }

      // Clean categories - remove 'enabled' field, keep only 'difficulty'
      let cleanedCategories: any = {};
      const rawCategories = populatedRoom?.settings?.categories || updatedRoom.settings?.categories;
      if (rawCategories && typeof rawCategories === 'object') {
        for (const [category, config] of Object.entries(rawCategories)) {
          if (config && typeof config === 'object' && 'difficulty' in config) {
            cleanedCategories[category] = {
              difficulty: (config as any).difficulty
            };
          }
        }
      }

      // Get game info if gameId exists
      let gameInfo: any = null;
      const roomGameId = populatedRoom?.gameId || updatedRoom.gameId;
      if (roomGameId) {
        const game = await DashboardGame.findOne({ id: roomGameId });
        if (game) {
          gameInfo = {
            id: game.id,
            name: game.title,
            title: game.title,
            image: game.image,
            description: game.description,
            status: game.status
          };
        }
      }

      const responseData: any = {
        roomCode: populatedRoom?.roomCode || updatedRoom.roomCode,
        categories: cleanedCategories,
        numberOfQuestions: populatedRoom?.settings?.numberOfQuestions || updatedRoom.settings?.numberOfQuestions,
        players: formattedPlayers,
        questions: formattedQuestions,
        status: populatedRoom?.status || updatedRoom.status
      };

      // Add game info and maximumPlayers if available
      if (gameInfo) {
        responseData.game = gameInfo;
      }
      if (populatedRoom?.settings?.maximumPlayers || updatedRoom.settings?.maximumPlayers) {
        responseData.maximumPlayers = populatedRoom?.settings?.maximumPlayers || updatedRoom.settings?.maximumPlayers;
      }

      return res.apiSuccess(responseData, 'Game joined successfully');
    } catch (error: any) {
      if (error.message === 'Room not found') {
        return res.apiError('Game room not found', 'ROOM_NOT_FOUND');
      }
      if (error.message === 'Game has finished. Please join a new game.') {
        return res.apiError('Game has finished. Please join a new game.', 'GAME_FINISHED');
      }
      if (error.message === 'Game has already started') {
        return res.apiError('Game has already started', 'GAME_ALREADY_STARTED');
      }
      if (error.message.includes('already')) {
        return res.apiError('You have already joined this game', 'ALREADY_JOINED');
      }
      if (error.message === 'Room is full') {
        return res.apiError('Game is full', 'GAME_FULL');
      }
      throw error;
    }
  } catch (error) {
    return res.apiError('Failed to join game', 'JOIN_GAME_ERROR');
  }
};

const getGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;

    const gameRoom = await GameRoom.findOne({ roomCode: code })
      .select('-questions') // Don't send questions in the initial room data
      .lean() as any;

    if (!gameRoom) {
      return next(new AppError('Game room not found', 404));
    }

    // Get the first enabled category and its difficulty
    const enabledCategory = Object.entries(gameRoom.categories || {}).find(
      ([, settings]: [string, any]) => settings.enabled
    );

    if (!enabledCategory) {
      return next(new AppError('No enabled categories found', 400));
    }

    const [category, settings]: [string, any] = enabledCategory;
    const difficulty = settings.difficulty;

    // Prepare the response
    const responseData = {
      ...gameRoom,
      category,
      difficulty,
      players: gameRoom.players.map((player: any) => ({
        userId: player.userId?._id,
        username: player.username || player.userId?.username,
        avatar: player.avatar || player.userId?.avatar
      }))
    };

    return res.apiSuccess(responseData, 'Game room created successfully');
  } catch (error) {
    return res.apiError('Failed to get game room', 'INTERNAL_ERROR');
  }
};

// Leave game request interface
interface ILeaveGameRequest extends Request {
  body: {
    roomCode: string;
  };
  user?: IUser;
}

interface IGetQuestionsRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

/**
 * @desc    Get all questions for a game room
 * @route   GET /api/game/questions/:roomCode
 * @access  Private
 */
 const getQuestions = async (req: IGetQuestionsRequest, res: Response) => {
  try {
    const { roomCode } = req.params;

    if (!req.user) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    // Find the game room first
    const gameRoom = await GameRoom.findOne({ roomCode });

    if (!gameRoom) {
      return res.apiError('Game room not found', 'NOT_FOUND');
    }

    const questionIds = gameRoom.questions.map((id: any) => id.toString());
    const questions = await Question.find(
      { _id: { $in: questionIds } },
      'question options difficulty category correctAnswer explanation source'
    ).lean();

    const isPlayer = gameRoom.players.some(
      (player: IPlayer) => player.userId.toString() === req.user!._id.toString()
    );

    if (!isPlayer) {
      return res.apiError('You are not a player in this game', 'FORBIDDEN');
    }

    const formattedQuestions = questions.map((q: any) => ({
      _id: q._id,
      question: q.question || 'No question available',
      options: q.options || [],
      difficulty: q.difficulty || 'medium',
      category: q.category || 'General',
      explanation: q.explanation,
      source: q.source
    }));

    return res.apiSuccess({
      roomCode: gameRoom.roomCode,
      questions: formattedQuestions,
      totalQuestions: gameRoom.settings?.numberOfQuestions || formattedQuestions.length
    }, 'Questions retrieved successfully');
  } catch (error: unknown) {
    logger.error('Error getting questions:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return res.apiError('Failed to get questions', 'SERVER_ERROR', 
      process.env.NODE_ENV === 'development' ? { error: errorMessage } : undefined
    );
  }
};

/**
 * @desc    Get game summary for a specific room
 * @route   GET /api/game/summary/:roomCode
 * @access  Private
 */
const getGameSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Fetch game room with populated questions and answeredQuestions
    const gameRoom = await GameRoom.findOne({ roomCode })
      .populate({
        path: 'questions',
        select: 'question options correctAnswer explanation category difficulty',
        options: { sort: { _id: 1 } },
      })
      .populate({
        path: 'answeredQuestions.questionId',
        select: 'question options correctAnswer explanation'
      })
      .lean() as any;

    if (!gameRoom) {
      return res.status(200).json({
        status: 0,
        message: 'Game not found'
      });
    }

    if (gameRoom.status !== 'finished') {
      return res.apiError('Game summary not available. The game is not yet complete.', 'GAME_NOT_COMPLETE');
    }

    const player = gameRoom.players.find((p: any) => 
      p.userId && p.userId.toString() === userId.toString()
    );
    
    if (!player) {
      return res.apiError('You are not authorized to view the summary for this game.', 'UNAUTHORIZED');
    }

    // Create a map of question IDs to questions for quick lookup
    const questionMap = new Map();
    gameRoom.questions.forEach((q: any) => {
      if (q && q._id) {
        questionMap.set(q._id.toString(), q);
      }
    });

    // Get user's answers
    const userAnswers = gameRoom.answeredQuestions
      .filter((aq: any) => 
        aq.playerId && 
        aq.playerId.toString() === userId.toString() && 
        aq.questionId
      )
      .reduce((acc: any, aq: any) => {
        const questionId = aq.questionId._id 
          ? aq.questionId._id.toString() 
          : aq.questionId.toString();
        acc[questionId] = aq;
        return acc;
      }, {});

    // Prepare question summaries
    const questionSummaries = gameRoom.questions.map((q: any) => {
      if (!q) return null;
      
      const questionId = q._id.toString();
      const answer = userAnswers[questionId];
      const questionText = q.question || 'Question not found';
      const options = Array.isArray(q.options) ? q.options : [];
      
      // Handle correct answer
      let correctAnswerIndex = 0;
      if (typeof q.correctAnswer === 'number') {
        correctAnswerIndex = q.correctAnswer;
      } else if (q.correctAnswer && typeof q.correctAnswer === 'string') {
        correctAnswerIndex = parseInt(q.correctAnswer, 10) || 0;
      }

      // Handle user's selected answer
      let selectedOptionIndex = -1;
      if (answer) {
        if (typeof answer.selectedOption === 'number') {
          selectedOptionIndex = answer.selectedOption;
        } else if (typeof answer.selectedOption === 'string') {
          selectedOptionIndex = parseInt(answer.selectedOption, 10);
        }
      }

      const isCorrect = answer ? answer.isCorrect : false;
      const timeTaken = answer?.timeTaken || 0;
      const explanation = q.explanation || 'No explanation available';

      return {
        question: questionText,
        options: [...options],
        yourAnswer: selectedOptionIndex >= 0 && selectedOptionIndex < options.length 
          ? options[selectedOptionIndex] 
          : 'Not answered',
        rightAnswer: options[correctAnswerIndex] || 'Not available',
        isCorrect,
        timeTaken,
        explanation,
        questionId
      };
    }).filter(Boolean); // Remove any null entries

    // Calculate statistics
    const correctAnswers = questionSummaries.filter((q: any) => q.isCorrect).length;
    const wrongAnswers = questionSummaries.filter((q: any) => !q.isCorrect && q.yourAnswer !== 'Not answered').length;
    const skippedAnswers = questionSummaries.filter((q: any) => q.yourAnswer === 'Not answered').length;
    const totalQuestions = questionSummaries.length;
    const totalScore = correctAnswers * 10;
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

    // Calculate rank_badge
    const sortedPlayers = [...gameRoom.players]
      .filter(p => p.userId) // Filter out any invalid player entries
      .sort((a, b) => (b.score || 0) - (a.score || 0));
      
    const rank_badge = sortedPlayers.findIndex(p => 
      p.userId && p.userId.toString() === userId.toString()
    ) + 1;

    return res.apiSuccess({
      totalScore,
      accuracy,
      correctAnswers,
      wrongAnswers,
      skippedAnswers,
      totalQuestions,
      rank_badge,
      questions: questionSummaries
    });

  } catch (error) {
    logger.error('Error getting game summary:', error);
    return res.apiError(
      'Server error', 
      'INTERNAL_ERROR',
      process.env.NODE_ENV === 'development' ? { details: error instanceof Error ? error.message : 'Unknown error' } : undefined
    );
  }
};

// Player statistics interface
interface PlayerStats {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar?: string;
  points: number;
  accuracy: number;
  averageTime: number;
  timeTaken: number; // ⭐ Total timeTaken (sum of all questions)
  correctAnswers: number;
  totalQuestionsAnswered: number;
}

// Interface for game leaderboard request
interface IGameLeaderboardRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

/**
 * @desc    Get the leaderboard for a completed game
 * @route   GET /api/game/leaderboard/:roomCode
 * @access  Private
 */
const getGameLeaderboard = async (req: IGameLeaderboardRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;

    if (!req.user) {
      return res.status(200).json({
        status: 0,
        message: 'User not authenticated'
      });
    }

    const gameRoom = await GameRoom.findOne({ roomCode })
      .populate({
        path: 'players.userId',
        select: 'username avatar'
      });

    if (!gameRoom) {
      return res.status(200).json({
        status: 0,
        message: 'Game room not found'
      });
    }

    // Allow leaderboard for active games if all questions are answered
    if (gameRoom.status !== 'finished' && gameRoom.status !== 'active') {
      return res.status(200).json({
        status: 0,
        message: 'Leaderboard not available. The game room was not found or the game is not yet complete.'
      });
    }

    // For active games, check if all questions are answered
    if (gameRoom.status === 'active') {
      const totalQuestions = gameRoom.questions?.length || 0;
      if (totalQuestions === 0) {
        return res.status(200).json({
          status: 0,
          message: 'Leaderboard not available. No questions in this game.'
        });
      }

      // For active games, show leaderboard if at least one player has answered all questions
      // Use unique question IDs to avoid counting duplicates
      const playersWithAllAnswers = gameRoom.players.filter((player: any) => {
        if (!player.userId) return false;
        
        const playerAnswers = gameRoom.answeredQuestions?.filter(
          (aq: any) => aq.playerId && aq.playerId.toString() === player.userId.toString()
        ) || [];
        
        // Get unique question IDs answered by this player
        const uniqueQuestionIds = new Set(
          playerAnswers.map((aq: any) => aq.questionId?.toString()).filter(Boolean)
        );
        
        // Check if player has answered all unique questions
        const hasAllQuestions = uniqueQuestionIds.size === totalQuestions;
        
        // Log for debugging
        logger.info(`Player ${player.userId.toString()}: answered ${uniqueQuestionIds.size}/${totalQuestions} unique questions`);
        
        return hasAllQuestions;
      });

      // Log for debugging
      logger.info(`Leaderboard check for room ${roomCode}: totalQuestions=${totalQuestions}, playersWithAllAnswers=${playersWithAllAnswers.length}, totalAnswers=${gameRoom.answeredQuestions?.length || 0}`);

      // If no player has completed all questions, still show leaderboard with current progress
      // Frontend calls this after game completion, so we should allow it
      if (playersWithAllAnswers.length === 0) {
        logger.info(`No players completed all questions for room ${roomCode}, but showing leaderboard with current progress`);
        // Continue to show leaderboard - don't block it
      }
    }

    const userId = req.user!._id.toString();
    const isParticipant = gameRoom.players.some((player: any) => 
      player.userId && player.userId._id.toString() === userId
    );

    if (!isParticipant) {
      return res.status(200).json({
        status: 0,
        message: 'You are not authorized to view this leaderboard.'
      });
    }

    const playerStats: PlayerStats[] = [];
    
    for (const player of gameRoom.players as IPlayer[]) {
      // Skip if userId is not populated or is a string
      if (!player.userId || typeof player.userId === 'string') {
        continue;
      }

      // Ensure userId is populated and has the correct type
      const userId = player.userId as unknown as { _id: mongoose.Types.ObjectId; username?: string; avatar?: string };
      
      // Get all answers for this player
      const playerAnswers = gameRoom.answeredQuestions.filter(
        (aq: IAnsweredQuestion) => aq.playerId && aq.playerId.toString() === userId._id.toString()
      );

      const correctAnswers = playerAnswers.filter((a: IAnsweredQuestion) => a.isCorrect).length;
      const totalQuestionsAnswered = playerAnswers.length;
      const totalTimeTaken = playerAnswers.reduce((sum: number, a: IAnsweredQuestion) => sum + (a.timeTaken || 0), 0);

      // Calculate accuracy (percentage of correct answers, 0 if no answers)
      const accuracy = totalQuestionsAnswered > 0 
        ? Math.round((correctAnswers / totalQuestionsAnswered) * 100) 
        : 0;

      // Calculate average time per question (in seconds, rounded)
      const averageTime = totalQuestionsAnswered > 0
        ? Math.round(totalTimeTaken / totalQuestionsAnswered) // timeTaken already in seconds
        : 0;

      const playerStat: PlayerStats = {
        userId: userId._id,
        username: userId.username || 'Unknown',
        avatar: userId.avatar,
        points: player.score || 0,
        accuracy,
        averageTime,
        timeTaken: totalTimeTaken, // ⭐ Total timeTaken (sum of all questions)
        correctAnswers,
        totalQuestionsAnswered
      };
      playerStats.push(playerStat);
    }

    // Sort players by: points (desc), accuracy (desc), averageTime (asc)
    const sortedPlayers = [...playerStats].sort((a, b) => {
      // First by points (descending)
      if (a.points !== b.points) {
        return b.points - a.points;
      }
      
      // If points are equal, by accuracy (descending)
      if (a.accuracy !== b.accuracy) {
        return b.accuracy - a.accuracy;
      }
      
      // If accuracy is also equal, by averageTime (ascending)
      return a.averageTime - b.averageTime;
    });

    // Add rank_badge: Top 3 get 1,2,3, rest get -1. Score 0 = -1
    const leaderboard = sortedPlayers.map((player, index) => ({
      rank_badge: (player.points > 0 && index < 3) ? index + 1 : -1,
      userId: player.userId,
      username: player.username,
      avatar: player.avatar ||"" ,
      points: player.points,
      score: player.points, // Alias for backward compatibility
      accuracy: player.accuracy,
      averageTime: player.averageTime,
      timeTaken: player.timeTaken, // ⭐ Total timeTaken (sum of all questions)
      correctAnswers: player.correctAnswers,
      totalQuestionsAnswered: player.totalQuestionsAnswered
    }));

    return res.status(200).json({
      status: 1,
      message: 'Leaderboard fetched successfully.',
      data: {
        leaderboard: {
          players: leaderboard
        }
      }
    });
  } catch (error) {
    logger.error('Error in getGameLeaderboard:', error);
    return next(new AppError('Failed to get game leaderboard', 500));
  }
};

/**
 * @desc    Finish a game and update player stats
 * @route   PATCH /api/games/finish/:roomCode
 * @access  Private
 */
const finishGame = async (req: IFinishGameRequest, res: Response) => {
  const { roomCode } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    logger.info(`Finishing game for room: ${roomCode}`);
    
    // Input validation
    if (!roomCode || typeof roomCode !== 'string' || roomCode.trim() === '') {
      logger.warn('Invalid room code provided');
      return res.apiError('Room code is required', 'INVALID_ROOM_CODE');
    }

    // Find the game room with case-insensitive search
    const gameRoom = await GameRoom.findOne({ 
      roomCode: { $regex: new RegExp(`^${roomCode}$`, 'i') }
    })
      .populate<{ players: IPlayer[] }>('players.userId', 'stats')
      .session(session);

    if (!gameRoom) {
      logger.warn(`Game room not found: ${roomCode}`);
      return res.apiError('Game not found', 'GAME_NOT_FOUND');
    }

    // Check game status
    if (gameRoom.status === 'finished' || gameRoom.status === 'completed') {
      logger.warn(`Game already finished: ${roomCode}`);
      return res.apiError('Game is already finished', 'GAME_ALREADY_FINISHED');
    }

    // Additional validation - check if game has started
    if (gameRoom.status !== 'active') {
      logger.warn(`Game not in finishable state: ${roomCode}, status: ${gameRoom.status}`);
      return res.apiError('Game is not in a finishable state', 'INVALID_GAME_STATE', {
        currentStatus: gameRoom.status
      });
    }

    // Validate game data
    if (!gameRoom.players || !Array.isArray(gameRoom.players)) {
      logger.error(`Invalid players data for room: ${roomCode}`);
      throw new Error('Invalid game room state: missing or invalid players array');
    }

    // Calculate stats
    const totalQuestions = Array.isArray(gameRoom.questions) ? gameRoom.questions.length : 0;
    const answered = Array.isArray(gameRoom.answeredQuestions) ? gameRoom.answeredQuestions : [];
    const correct = answered.filter((q: any) => q.isCorrect).length;
    const totalTime = answered.reduce((sum: number, q: any) => sum + (q.timeTaken || 0), 0);
    const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    logger.info(`Calculated stats - Questions: ${totalQuestions}, Correct: ${correct}, Accuracy: ${accuracy}%`);

    // Update game room status - must be one of: 'waiting', 'active', or 'finished'
    gameRoom.status = 'finished';
    gameRoom.finishedAt = new Date();
    
    // Update game stats
    gameRoom.stats = {
      gamesPlayed: 1,
      accuracy,
      bestScore: correct,
      totalTime,
      totalQuestions,
      correctAnswers: correct,
      averageTimePerQuestion: answered.length > 0 ? Math.round(totalTime / answered.length) : 0
    };

    // Save game room updates within the transaction
    await gameRoom.save({ session });
    logger.info(`Game room ${roomCode} marked as completed`);

    // Update player stats with error handling for each player
    // ⭐ IMPORTANT: Only update stats for players who COMPLETED the game (answered all questions)
    const totalQuestionsInGame = totalQuestions;
    const updatePromises = gameRoom.players.map(async (player: IPlayer) => {
      if (!player.userId) {
        logger.warn('Player missing userId, skipping update');
        return null;
      }
      
      try {
        const playerId = player.userId.toString();
        const playerAnswers = answered.filter((a: any) => 
          a.playerId && a.playerId.toString() === playerId
        );
        
        // Get unique question IDs answered by this player
        const uniqueQuestionIds = new Set(playerAnswers.map((a: any) => a.questionId?.toString()).filter(Boolean));
        const questionsAnswered = uniqueQuestionIds.size;
        
        // ⭐ CRITICAL: Only update stats if player answered ALL questions (completed the game)
        if (questionsAnswered < totalQuestionsInGame) {
          logger.info(`Player ${playerId} did not complete the game (answered ${questionsAnswered}/${totalQuestionsInGame} questions). Skipping stats update.`, {
            roomCode,
            playerId,
            questionsAnswered,
            totalQuestionsInGame
          });
          return null; // Don't count incomplete games
        }
        
        const playerCorrect = playerAnswers.filter((a: any) => a.isCorrect).length;
        const playerAccuracy = playerAnswers.length > 0 
          ? Math.round((playerCorrect / playerAnswers.length) * 100) 
          : 0;
          
        logger.debug(`Updating stats for player who completed game ${playerId}: ${playerCorrect} correct out of ${playerAnswers.length}, accuracy: ${playerAccuracy}%`);

        // First get current user stats to calculate running totals
        const user = await User.findById(playerId).session(session);
        if (!user) {
          logger.warn(`User not found for player ID: ${playerId}`);
          return null;
        }

        const currentStats = user.stats || {
          gamesPlayed: 0,
          accuracy: 0,
          bestScore: 0
        };

        // Calculate the new stats
        const playerTotalCorrect = playerAnswers.filter((a: any) => a.isCorrect).length;
        const playerTotalQuestions = playerAnswers.length;
        const playerTotalTime = playerAnswers.reduce((sum: number, a: any) => sum + (a.timeTaken || 0), 0);

        // Calculate new accuracy and best score
        const newAccuracy = playerTotalQuestions > 0 
          ? Math.round((playerTotalCorrect / playerTotalQuestions) * 100) 
          : 0;
        const newBestScore = Math.max(currentStats.bestScore || 0, player.score || 0);

        // Calculate new totals
        const newTotalCorrect = (currentStats.totalCorrectAnswers || 0) + playerTotalCorrect;
        const newTotalQuestions = (currentStats.totalQuestionsAnswered || 0) + playerTotalQuestions;
        const newTotalTime = (currentStats.totalTimePlayed || 0) + playerTotalTime;

        // Prepare the update with all stats fields
        const update = {
          $inc: { 
            'stats.gamesPlayed': 1,
            'stats.totalCorrectAnswers': playerTotalCorrect,
            'stats.totalQuestionsAnswered': playerTotalQuestions,
            'stats.totalTimePlayed': playerTotalTime
          },
          $set: {
            'stats.accuracy': newAccuracy,
            'stats.bestScore': newBestScore
          }
        };

        logger.debug(`Updating user ${playerId} stats:`, {
          oldStats: {
            accuracy: currentStats.accuracy,
            bestScore: currentStats.bestScore,
            totalCorrectAnswers: currentStats.totalCorrectAnswers || 0,
            totalQuestionsAnswered: currentStats.totalQuestionsAnswered || 0,
            totalTimePlayed: currentStats.totalTimePlayed || 0
          },
          newStats: {
            accuracy: newAccuracy,
            bestScore: newBestScore,
            totalCorrectAnswers: newTotalCorrect,
            totalQuestionsAnswered: newTotalQuestions,
            totalTimePlayed: newTotalTime
          },
          currentGame: {
            correct: playerTotalCorrect,
            questions: playerTotalQuestions,
            time: playerTotalTime
          }
        });

        return User.findByIdAndUpdate(playerId, update, { new: true, session });
      } catch (error) {
        logger.error(`Error updating player ${player.userId} stats:`, error);
        return null; // Continue with other players if one fails
      }
    });

    // Wait for all player updates to complete
    const results = await Promise.all(updatePromises);
    const successfulUpdates = results.filter(r => r !== null).length;
    
    // Commit the transaction
    await session.commitTransaction();
    logger.info(`Successfully finished game ${roomCode}. Updated ${successfulUpdates} players.`);

    return res.status(200).json({
      status: 1,
      message: 'Game finished successfully',
      data: {
        roomCode: gameRoom.roomCode,
        status: gameRoom.status,
        finishedAt: gameRoom.finishedAt,
        stats: gameRoom.stats,
        playersUpdated: successfulUpdates,
        totalPlayers: gameRoom.players.length
      }
    });
  } catch (error) {
    // Rollback the transaction on error
    await session.abortTransaction();
    
    // Log the full error for debugging
    logger.error('Error finishing game:', error);
    
    // Return appropriate error response
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.apiError(
      'Failed to finish game',
      'FINISH_GAME_ERROR',
      process.env.NODE_ENV === 'development' ? { details: errorMessage } : undefined
    );
  } finally {
    // End the session
    session.endSession();
  }
}

// Leave game implementation
 const leaveGame = async (req: ILeaveGameRequest, res: Response) => {
  try {
    const { roomCode } = req.body;
    const userId = req.user?._id;

    if (!userId) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
      
      if (!gameRoom) {
        await session.abortTransaction();
        return res.apiError('Game room not found', 'ROOM_NOT_FOUND');
      }

      // Remove player from the game
      const playerIndex = gameRoom.players.findIndex(
        (p: any) => p.userId.toString() === userId.toString()
      );

      if (playerIndex === -1) {
        await session.abortTransaction();
        return res.apiError('You are not in this game', 'NOT_IN_GAME');
      }

      // If host is leaving, assign new host or end game
      if (gameRoom.players[playerIndex].isHost) {
        if (gameRoom.players.length > 1) {
          // Assign new host (next player)
          const newHostIndex = playerIndex === 0 ? 1 : 0;
          gameRoom.players[newHostIndex].isHost = true;
        } else {
          // Last player, end the game
          gameRoom.status = 'finished';
          gameRoom.finishedAt = new Date();
        }
      }

      // Remove player from the game
      gameRoom.players.splice(playerIndex, 1);

      // If no players left, end the game
      if (gameRoom.players.length === 0) {
        gameRoom.status = 'finished';
        gameRoom.finishedAt = new Date();
      }

      await gameRoom.save({ session });
      await session.commitTransaction();

      return res.apiSuccess({}, 'Successfully left the game');
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return res.apiError('Failed to leave game', 'LEAVE_GAME_ERROR');
  }
};



// @desc    Kick a player from the game
// @route   POST /api/game/:roomCode/players/:playerId/kick
// @access  Private (Host only)
const kickPlayer = async (req: Request, res: Response) => {
  try {
    const { playerId } = req.params;
    const game = (req as any).game;
    
    const playerIndex = game.players.findIndex(
      (p: IPlayer) => p.userId.toString() === playerId
    );
    
    if (playerIndex === -1) {
      return res.status(200).json({
        status: 0,
        message: 'Player not found in this game'
      });
    }
    
    const wasHost = game.players[playerIndex].isHost;
    game.players.splice(playerIndex, 1);
    
    if (wasHost && game.players.length > 0) {
      game.players[0].isHost = true;
      game.hostId = game.players[0].userId;
    }
    
    await game.save();
    
    const io = (req as any).app?.get('io');
    if (io) {
      io.to(game.roomCode).emit('player:left', { playerId });
    }
    
    return res.status(200).json({
      status: 1,
      message: 'Player has been kicked from the game',
      data: {}
    });
  } catch (error) {
    return res.status(200).json({
      status: 0,
      message: error instanceof Error ? error.message : 'Failed to kick player'
    });
  }
};

// Joi-based validation is defined lazily inside updateGameSettings to avoid
// loading Joi at module import time, which can cause issues in some test envs.

// @desc    Update game settings
// @route   PATCH /api/game/:roomCode/settings
// @access  Private (Host only)
const updateGameSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const { categories, numberOfQuestions, maximumPlayers } = req.body;
    const game = (req as any).game;
    const io = (req as any).app?.get('io');

    // Validate request body
    const { default: Joi } = await import('joi');
    const gameSettingsSchema = {
      numberOfQuestions: Joi.number().integer().min(1).max(10).messages({
        'number.base': 'Number of questions must be a number',
        'number.integer': 'Number of questions must be an integer',
        'number.min': 'Number of questions must be at least 1',
        'number.max': 'Number of questions cannot exceed 10'
      }),
      maximumPlayers: Joi.number().integer().min(2).max(10).messages({
        'number.base': 'Maximum players must be a number',
        'number.integer': 'Maximum players must be an integer',
        'number.min': 'Maximum players must be at least 2',
        'number.max': 'Maximum players cannot exceed 10'
      }),
      categories: Joi.object().pattern(
        Joi.string(),
        Joi.object({
          enabled: Joi.boolean().required(),
          difficulty: Joi.string().valid('easy', 'medium', 'hard').required()
        })
      ).min(1).messages({
        'object.min': 'At least one category must be enabled',
        'object.base': 'Categories must be an object',
        'any.required': 'Categories are required'
      })
    };

    const schema = Joi.object({
      ...(numberOfQuestions !== undefined && { numberOfQuestions: gameSettingsSchema.numberOfQuestions }),
      ...(maximumPlayers !== undefined && { maximumPlayers: gameSettingsSchema.maximumPlayers }),
      ...(categories && { categories: gameSettingsSchema.categories })
    }).min(1).messages({
      'object.min': 'At least one setting must be provided',
      'any.required': 'At least one setting must be provided'
    });

    const { error } = schema.validate({ categories, numberOfQuestions, maximumPlayers }, { abortEarly: false });
    
    if (error) {
      const errorMessages = error.details.map(detail => detail.message);
      return next(new AppError(`Invalid input: ${errorMessages.join('; ')}`, 400));
    }

    // Check if game is in lobby state
    if (game.status !== 'waiting') {
      return next(new AppError('Game settings can only be changed in the lobby', 400));
    }

    // Check if maximumPlayers is not less than current players count
    if (maximumPlayers && maximumPlayers < game.players.length) {
      return next(
        new AppError(
          `Cannot set maximum players to ${maximumPlayers} because there are already ${game.players.length} players in the game`,
          400
        )
      );
    }

    // Update settings
    const updateData: any = {};
    
    if (categories) {
      // Convert categories object to Map format if it's not already
      const categoriesMap = new Map();
      for (const [category, settings] of Object.entries(categories)) {
        categoriesMap.set(category, settings);
      }
      updateData['settings.categories'] = categoriesMap;
    }
    
    if (numberOfQuestions !== undefined) {
      updateData['settings.numberOfQuestions'] = numberOfQuestions;
    }
    
    if (maximumPlayers !== undefined) {
      updateData['settings.maximumPlayers'] = maximumPlayers;
    }

    // Update game with new settings
    const updatedGame = await GameRoom.findOneAndUpdate(
      { roomCode },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedGame) {
      return next(new AppError('Game not found', 404));
    }
    
    // Notify all players in the room about the settings update
    if (io) {
      io.to(roomCode).emit('settingsUpdated', {
        settings: {
          categories: updatedGame.settings.categories,
          numberOfQuestions: updatedGame.settings.numberOfQuestions,
          maximumPlayers: updatedGame.settings.maximumPlayers
        }
      });
    }
    
    res.apiSuccess({
      settings: {
        categories: updatedGame.settings.categories,
        numberOfQuestions: updatedGame.settings.numberOfQuestions,
        maximumPlayers: updatedGame.settings.maximumPlayers
      }
    }, 'Game settings updated successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get game lobby details by room code
 * @route   GET /api/game/lobby/:roomCode
 * @access  Private
 */
const getGameLobby = async (req: IGameLobbyRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return next(new AppError('User not authenticated', 401));
    }

    const gameRoom = await GameRoom.findOne({ roomCode })
      .populate('players.userId', 'firstName username email avatar')
      .populate('hostId', 'firstName username email avatar')
      .lean() as any;

    if (!gameRoom) {
      return next(new AppError('Game room not found', 404));
    }

    const isPlayer = gameRoom.players?.some((player: any) => 
      player.userId?._id?.toString() === userId.toString()
    );
    
    if (!isPlayer && gameRoom.hostId?.toString() !== userId.toString()) {
      return next(new AppError('You are not a member of this game', 403));
    }

    const getDisplayName = (user: any) => {
      if (user?.firstName) return user.firstName;
      if (user?.email) return user.email.split('@')[0];
      return user?.username || 'Unknown';
    };

    const response = {
      roomCode: gameRoom.roomCode,
      status: gameRoom.status,
      host: {
        id: gameRoom.hostId?._id || gameRoom.hostId,
        username: getDisplayName(gameRoom.hostId)
      },
      players: (gameRoom.players || []).map((player: any) => ({
        id: player.userId?._id || player.userId,
        username: getDisplayName(player.userId) || player.username,
        avatar: player.avatar,
        isHost: player.isHost,
        isReady: player.isReady,
        score: player.score
      })),
      settings: {
        maxPlayers: gameRoom.settings?.maximumPlayers,
        numberOfQuestions: gameRoom.settings?.numberOfQuestions,
        selectedCategories: Object.entries(gameRoom.settings?.categories || {})
          .filter(([_, cat]: [string, any]) => cat?.enabled)
          .map(([id, cat]: [string, any]) => ({
            id,
            difficulty: cat?.difficulty
          }))
      },
      currentPlayers: gameRoom.players?.length || 0,
      isFull: (gameRoom.players?.length || 0) >= (gameRoom.settings?.maximumPlayers || 0),
      gameStarted: gameRoom.status !== 'waiting'
    };

    return res.apiSuccess(response);
  } catch (error) {
    logger.error('Error in getGameLobby:', error);
    return next(new AppError('Failed to get game lobby', 500));
  }
};

// Interface for get my games request
interface IGetMyGamesRequest extends Request {
  user?: IUser;
  query: {
    page?: string;
    limit?: string;
  };
}

/**
 * @desc    Get all games created by the logged-in user
 * @route   GET /api/game/my-games
 * @access  Private
 */
const getMyGames = async (req: IGetMyGamesRequest, res: Response) => {
  try {
    const userId = req.user?._id;
    
    // Check if user ID exists
    if (!userId) {
      return res.status(401).json({
        status: 0,
        message: "User ID not found from token"
      });
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Find games where the user is the host
    const games = await GameRoom.find({ hostId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    if (!games || games.length === 0) {
      return res.status(200).json({
        status: 1,
        message: "No games found for this user",
        data: []
      });
    }

    const formattedGames = games.map((game: any) => {
      const enabledCategories = Object.entries(game.settings?.categories || {})
        .filter(([_, cat]: [string, any]) => cat?.enabled)
        .map(([category]) => category);

      const players = game.players?.map((player: any) => ({
        username: player.username,
        score: player.score || 0,
        isHost: player.userId?.toString() === game.hostId?.toString()
      })) || [];

      return {
        roomCode: game.roomCode,
        hostId: game.hostId,
        playersCount: game.players?.length || 0,
        players,
        categories: enabledCategories,
     
        numberOfQuestions: game.settings?.numberOfQuestions || 10, // Default to 10 if not set
        maximumPlayers: game.settings?.maximumPlayers || 10, // Default to 10 if not set
        createdAt: game.createdAt
      };
    });

    return res.status(200).json({
      status: 1,
      message: "Games fetched successfully",
      data: formattedGames
    });
  } catch (error) {
    logger.error('Error fetching user games:', error);
    return res.apiError('Something went wrong', 'FETCH_GAMES_ERROR');
  }
};

// Interface for toggle ready status request
interface IToggleReadyStatusRequest extends Request {
  params: {
    roomCode: string;
  };
  body: {
    isReady: boolean;
  };
  user?: IUser;
}

/**
 * @desc    Toggle player's ready status
 * @route   PATCH /api/game/:roomCode/ready
 * @access  Private
 */
const toggleReadyStatus = async (req: IToggleReadyStatusRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const { isReady } = req.body;
    const userId = req.user?._id;

    if (!userId) {
      return next(new AppError('User not authenticated', 401));
    }

    if (typeof isReady !== 'boolean') {
      return next(new AppError('isReady must be a boolean value', 400));
    }

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode });
    if (!gameRoom) {
      return next(new AppError('Game room not found', 404));
    }

    // Check if game has already started
    if (gameRoom.status !== 'waiting') {
      return next(new AppError('Game has already started', 400));
    }

    // Find the player in the game room
    const playerIndex = gameRoom.players.findIndex(
      (p: IPlayer) => p.userId.toString() === userId.toString()
    );

    if (playerIndex === -1) {
      return next(new AppError('You are not a player in this game', 403));
    }

    // Toggle the ready status
    gameRoom.players[playerIndex].isReady = isReady;
    await gameRoom.save();

    const io = (req as any).app?.get('io');
    if (io) {
      io.to(roomCode).emit('player:ready', {
        playerId: userId.toString(),
        isReady
      });
    }

    res.apiSuccess({
      playerId: userId,
      isReady,
      message: `You are now ${isReady ? 'ready' : 'not ready'}`
    });
  } catch (error) {
    logger.error('Error in toggleReadyStatus:', error);
    next(new AppError('Failed to update ready status', 500));
  }
};

export {
  createGame,
  getGameRoom,
  joinGame,
  leaveGame,
  getQuestions,
  getGameSummary,
  getGameLeaderboard,
  finishGame,
  kickPlayer,
  updateGameSettings,
  getGameLobby,
  toggleReadyStatus,
  getMyGames
};

