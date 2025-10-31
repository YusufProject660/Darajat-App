import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

import { AppError } from '../../utils/appError';
import { GameRoom, IPlayer, IAnsweredQuestion } from './models/gameRoom.model';
import { Deck } from './models/deck.model';
import {gameService} from './services/game.service';
// UNUSED: Not used in the  code
// import User from '../users/user.model';
import { Question } from './models/question.model';
import { generateUniqueRoomCode } from './utils/generateRoomCode';
import { IUser } from '../users/user.model';
import { logger } from '../../utils/logger';


interface IGameRequest extends Request {
  user?: IUser;
  body: {
    categories: Record<string, boolean>;
    numberOfQuestions?: number;
    maximumPlayers?: number;
  };
  [key: string]: any;
}


interface IRequestWithUser extends Request {
  user?: IUser;
  body: {
    roomCode: string;
  };
}

interface IGameLobbyRequest extends Request {
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
 const createGame = async (req: IGameRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    // Validate request body
    const { categories = {}, numberOfQuestions = 10, maximumPlayers = 4 } = req.body;
    
    // UNUSED: Variables declared but not used
    // const questionsToShuffle: any[] = [];
    // let currentQuestionIndex = 0;
    // let gameStatus = 'waiting';

    // Validate categories structure
    if (!categories || typeof categories !== 'object' || Object.keys(categories).length === 0) {
      logger.error('[createGame] 400: categories missing or empty');
      return res.status(400).json({
        status: 'error',
        message: 'At least one category must be enabled'
      });
    }

    // Validate number of questions
    if (typeof numberOfQuestions !== 'number' || numberOfQuestions < 1 || numberOfQuestions > 10) {
      logger.error('[createGame] 400: invalid numberOfQuestions');
      return res.apiError('Number of questions must be between 1 and 10', 'INVALID_INPUT');
    }

    // Validate maximum players
    if (typeof maximumPlayers !== 'number' || maximumPlayers < 2 || maximumPlayers > 10) {
      logger.error('[createGame] 400: invalid maximumPlayers');
      return res.apiError('Maximum players must be between 2 and 10', 'INVALID_INPUT');
    }

    // Process categories into the required format and collect enabled categories
    const processedCategories = new Map();
    const enabledCategories: Array<{category: string, difficulty: string}> = [];

    for (const [category, settings] of Object.entries(categories as Record<string, any>)) {
      if (settings && typeof settings === 'object' && settings.enabled) {
        const difficulty = ['easy', 'medium', 'hard'].includes(settings.difficulty?.toLowerCase())
          ? settings.difficulty.toLowerCase()
          : 'easy';
          
        processedCategories.set(category, {
          enabled: true,
          difficulty: difficulty
        });
        
        enabledCategories.push({
          category,
          difficulty
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
      return res.status(400).json({
        status: 'error',
        message: 'At least one category must be enabled'
      });
    }

    // Get questions for the selected categories
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
      
      // Populate the game with questions and player details
      const populatedGame = await GameRoom.findById(saved._id)
        .populate({
          path: 'players.userId',
          select: 'username avatar'
        })
        .populate('questions')
        .lean();

      // Convert the Map to a plain object for the response
      if (populatedGame) {
        populatedGame.settings.categories = Object.fromEntries(processedCategories);
      }

      // Use the centralized response format
      return res.apiSuccess(populatedGame, 'Game created successfully');
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
 const joinGame = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return res.apiError('User not authenticated', 'UNAUTHORIZED');
    }

    const { roomCode } = req.body;
    const userId = req.user._id;
    const username = req.user.username;
    const avatar = req.user.avatar;

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode });
    
    if (!gameRoom) {
      return res.apiError('Game room not found', 'ROOM_NOT_FOUND');
    }

    // Check if game is joinable
    if (gameRoom.status !== 'waiting') {
      return res.apiError('Game has already started', 'GAME_ALREADY_STARTED');
    }

    // Check if already joined
    const alreadyJoined = gameRoom.players.some(
      (player: IPlayer) => player.userId.toString() === userId.toString()
    );

    if (alreadyJoined) {
      return res.apiError('You have already joined this game', 'ALREADY_JOINED');
    }

    // Check if room is full
    const currentPlayersCount = Array.isArray(gameRoom.players) ? gameRoom.players.length : 0;
    const maxPlayersAllowed = gameRoom.settings?.maximumPlayers || 0;
    if (currentPlayersCount >= maxPlayersAllowed) {
      return res.apiError('Game is full', 'GAME_FULL');
    }

    // Add player to the game
    gameRoom.players.push({
      userId,
      username,
      avatar,
      score: 0,
      isHost: false
    });

    await gameRoom.save();

    // Format the response data
    const responseData = {
      roomCode: gameRoom.roomCode,
      categories: gameRoom.settings.categories,
      numberOfQuestions: gameRoom.settings.numberOfQuestions,
      players: gameRoom.players.map((player: IPlayer) => ({
        username: player.username,
        avatar: player.avatar
      })),
      status: gameRoom.status
    };

    // Use centralized success response
    return res.apiSuccess(responseData, 'Game joined successfully');
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

// Submit answer request interface
interface ISubmitAnswerRequest extends Request {
  body: {
    roomCode: string;
    questionId: string;
    selectedOption: number;
    timeTaken: number;
  };
  user?: IUser;
}

// UNUSED: Not used in the visible code
// interface PlayerStats {
//   userId: string;
//   username: string;
//   avatar?: string;
//   points: number;
//   accuracy: number;
//   averageTime: number;
//   correctAnswers: number;
//   totalQuestionsAnswered: number;
// }

/**
 * @desc    Get all questions for a game room
 * @route   GET /api/game/questions/:roomCode
 * @access  Private
 */
 const getQuestions = async (req: IGetQuestionsRequest, res: Response) => {
  try {
    const { roomCode } = req.params;

    if (!req.user) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated'
      });
    }

    // Find the game room first
    const gameRoom = await GameRoom.findOne({ roomCode });

    if (!gameRoom) {
      return res.apiError('Game room not found', 'NOT_FOUND');
    }

    // Get question IDs from the room
    const questionIds = gameRoom.questions.map(id => id.toString());
    
    // Fetch questions with all necessary fields
    const questions = await Question.find(
      { _id: { $in: questionIds } },
      'question options difficulty category correctAnswer explanation source'
    ).lean();
    
    logger.debug('Fetched questions:', { questions });

    if (!gameRoom) {
      return res.apiError('Game room not found', 'NOT_FOUND');
    }

    // Check if user is a player in this game
    const isPlayer = gameRoom.players.some(
      player => player.userId.toString() === req.user!._id.toString()
    );

    if (!isPlayer) {
      return res.apiError('You are not a player in this game', 'FORBIDDEN');
    }

    // Map questions to ensure consistent response format
    const formattedQuestions = questions.map(q => {
      // Debug log each question
      logger.debug('Processing question:', {
        id: q._id,
        hasQuestion: !!q.question,
        question: q.question,
        options: q.options?.length
      });
      
      return {
        _id: q._id,
        questionText: q.question || 'No question text available',
        // text: q.question || 'No question text available',
        options: q.options || [],
        difficulty: q.difficulty || 'medium',
        category: q.category || 'General',
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        source: q.source
      };
    });

    return res.apiSuccess({
      roomCode: gameRoom.roomCode,
      questions: formattedQuestions,
      currentQuestion: gameRoom.currentQuestion || 0,
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
        select: 'text question options correctAnswer explanation category difficulty',
        options: { sort: { _id: 1 } },
      })
      .populate({
        path: 'answeredQuestions.questionId',
        select: 'text question options correctAnswer explanation'
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
      const questionText = q.text || q.question || 'Question not found';
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
    const totalQuestions = questionSummaries.length;
    const totalScore = correctAnswers * 10;
    const accuracy = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;

    // Calculate rank
    const sortedPlayers = [...gameRoom.players]
      .filter(p => p.userId) // Filter out any invalid player entries
      .sort((a, b) => (b.score || 0) - (a.score || 0));
      
    const rank = sortedPlayers.findIndex(p => 
      p.userId && p.userId.toString() === userId.toString()
    ) + 1;

    return res.apiSuccess({
      totalScore,
      accuracy,
      correctAnswers,
      totalQuestions,
      rank,
      questions: questionSummaries
    });

  } catch (error) {
    logger.error('Error getting game summary:', error);
    return res.apiError(
      'Server error', 
      'INTERNAL_ERROR',
      process.env.NODE_ENV === 'development' ? { details: error.message } : undefined
    );
  }
};

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

    // Find the game room with populated players
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

    // Check if game is completed
    if (gameRoom.status !== 'finished') {
      return res.status(200).json({
        status: 0,
        message: 'Leaderboard not available. The game room was not found or the game is not yet complete.'
      });
    }

    // Check if user is a participant in this game
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

    // Calculate player stats
    const playerStats: PlayerStats[] = [];
    
    // Ensure we have a valid game room
    if (!gameRoom) {
      return res.status(200).json({
        status: 0,
        message: 'Game room not found'
      });
    }
    
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
        ? Math.round(totalTimeTaken / totalQuestionsAnswered / 1000) // Convert ms to seconds
        : 0;

      const playerStat: PlayerStats = {
        userId: userId._id,
        username: userId.username || 'Unknown',
        avatar: userId.avatar,
        points: player.score || 0,
        accuracy,
        averageTime,
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

    // Add ranks
    const leaderboard = sortedPlayers.map((player, index) => ({
      rank: index + 1,
      userId: player.userId,
      username: player.username,
      avatar: player.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.username)}&background=random`,
      points: player.points,
      accuracy: player.accuracy,
      averageTime: player.averageTime
    }));

    res.status(200).json({
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
    next(new AppError('Failed to get game leaderboard', 500));
  }
};

/**
 * @desc    Finish a game and update player stats
 * @route   PATCH /api/games/finish/:roomCode
 * @access  Private
 */
const finishGame = async (req: IFinishGameRequest, res: Response, next: NextFunction) => {
  const { roomCode } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    logger.info(`Finishing game for room: ${roomCode}`);
    
    // Input validation
    if (!roomCode || typeof roomCode !== 'string' || roomCode.trim() === '') {
      logger.warn('Invalid room code provided');
      return res.status(200).json({
        status: 0,
        message: 'Room code is required',
        error: 'INVALID_ROOM_CODE'
      });
    }

    // Find the game room with case-insensitive search
    const gameRoom = await GameRoom.findOne({ 
      roomCode: { $regex: new RegExp(`^${roomCode}$`, 'i') }
    })
      .populate<{ players: IPlayer[] }>('players.userId', 'stats')
      .session(session);

    if (!gameRoom) {
      logger.warn(`Game room not found: ${roomCode}`);
      return res.status(200).json({
        status: 0,
        message: 'Game not found',
        error: 'GAME_NOT_FOUND'
      });
    }

    // Check game status
    if (gameRoom.status === 'finished' || gameRoom.status === 'completed') {
      logger.warn(`Game already finished: ${roomCode}`);
      return res.status(200).json({
        status: 0,
        message: 'Game is already finished',
        error: 'GAME_ALREADY_FINISHED'
      });
    }

    // Additional validation - check if game has started
    if (gameRoom.status !== 'active') {
      logger.warn(`Game not in finishable state: ${roomCode}, status: ${gameRoom.status}`);
      return res.status(200).json({
        status: 0,
        message: 'Game is not in a finishable state',
        error: 'INVALID_GAME_STATE',
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
        
        const playerCorrect = playerAnswers.filter((a: any) => a.isCorrect).length;
        logger.debug(`Updating stats for player ${playerId}: ${playerCorrect} correct out of ${playerAnswers.length}`);

        const update: any = {
          $inc: { 
            'stats.gamesPlayed': 1,
            'stats.totalCorrectAnswers': playerCorrect,
            'stats.totalQuestionsAnswered': playerAnswers.length,
            'stats.totalTimePlayed': totalTime
          },
          $max: { 'stats.bestScore': player.score || 0 }
        };

        // Calculate new average accuracy
        const user = await User.findById(playerId).session(session);
        if (user) {
          const currentTotalCorrect = user.stats?.totalCorrectAnswers || 0;
          const currentTotalQuestions = user.stats?.totalQuestionsAnswered || 0;
          const newTotalCorrect = currentTotalCorrect + playerCorrect;
          const newTotalQuestions = currentTotalQuestions + playerAnswers.length;
          
          update.$set = {
            ...update.$set,
            'stats.averageAccuracy': newTotalQuestions > 0 
              ? Math.round((newTotalCorrect / newTotalQuestions) * 100)
              : 0
          };
        }

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
    return res.status(500).json({ 
      status: 0, 
      message: 'Failed to finish game',
      error: 'FINISH_GAME_ERROR',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
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
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated'
      });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
      
      if (!gameRoom) {
        await session.abortTransaction();
        return res.status(404).json({
          status: 'error',
          message: 'Game room not found'
        });
      }

      // Remove player from the game
      const playerIndex = gameRoom.players.findIndex(
        (p: any) => p.userId.toString() === userId.toString()
      );

      if (playerIndex === -1) {
        await session.abortTransaction();
        return res.status(400).json({
          status: 'error',
          message: 'You are not in this game'
        });
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

      return res.status(200).json({
        status: 'success',
        message: 'Successfully left the game',
        data: {
          roomCode,
          status: gameRoom.status
        }
      });
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: 'Failed to leave game'
    });
  }
};

// Submit answer implementation
 const submitAnswer = async (req: ISubmitAnswerRequest, res: Response) => {
  try {
    const { roomCode, questionId, selectedOption, timeTaken } = req.body;
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        status: 'error',
        message: 'User not authenticated'
      });
    }

    try {
      // Find the game room and question
      const [gameRoom, question] = await Promise.all([
        GameRoom.findOne({ roomCode }),
        Question.findById(questionId)
      ]);

      if (!gameRoom) {
        return res.status(200).json({
          status: 0,
          message: 'Game room not found'
        });
      }

      if (!question) {
        return res.status(200).json({
          status: 0,
          message: 'Question not found'
        });
      }

      // Check if game is active
      if (gameRoom.status !== 'active') {
        return res.status(200).json({
          status: 0,
          message: 'Game is not active'
        });
      }

      // Check if user is a player in this game
      const player = gameRoom.players.find(
        (p: any) => p.userId.toString() === userId.toString()
      );

      if (!player) {
        return res.status(200).json({
          status: 0,
          message: 'You are not a player in this game'
        });
      }

      // Check if already answered this question
      const alreadyAnswered = gameRoom.answeredQuestions.some(
        (aq: any) => 
          aq.playerId.toString() === userId.toString() && 
          aq.questionId.toString() === questionId
      );

      if (alreadyAnswered) {
        return res.status(200).json({
          status: 0,
          message: 'You have already answered this question'
        });
      }

      // Check if answer is correct
      const isCorrect = question.correctAnswer === selectedOption;
      const points = isCorrect ? 10 : 0;

      // Update player score
      player.score += points;

      // Add to answered questions
      gameRoom.answeredQuestions.push({
        playerId: userId,
        questionId,
        selectedOption,
        isCorrect,
        timeTaken,
        answeredAt: new Date()
      });

      await gameRoom.save();

      return res.status(200).json({
        status: 1,
        message: 'Answer submitted successfully',
        data: {
          isCorrect,
          correctAnswer: question.correctAnswer,
          score: player.score,
          explanation: question.explanation || ''
        }
      });
    } catch (error) {
      throw error;
    }
  } catch (error: any) {
    return res.status(200).json({
      status: 0,
      message: error.message || 'Failed to submit answer'
    });
  }
};

// Explicitly export all functions
// @desc    Start a game
// @route   POST /api/game/:roomCode/start
// @access  Private (Host only)
const startGame = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = (req as any).user?._id;

    // Find the game room
    const game = await GameRoom.findOne({ roomCode });
    if (!game) {
      return res.status(200).json({
        status: 0,
        message: 'Game room not found',
        data: {}
      });
    }

    // Check if the user is the host
    const isHost = game.players.some(
      p => p.userId.toString() === userId.toString() && p.isHost
    );

    if (!isHost) {
      return res.status(200).json({
        status: 0,
        message: 'Only the host can start the game',
        data: {}
      });
    }

    // Check if all players are ready
    const allPlayersReady = game.players.every(player => player.isReady || player.isHost);
    if (!allPlayersReady) {
      return res.status(200).json({
        status: 0,
        message: 'All players must be ready before starting the game',
        data: {}
      });
    }

    // Check if there are at least 2 players
    if (game.players.length < 2) {
      return res.status(200).json({
        status: 0,
        message: 'At least 2 players are required to start the game',
        data: {}
      });
    }

    logger.info(`Starting game for room: ${game.roomCode}, user: ${userId}`);
    
    // Start the game and get updated room with populated data
    const updatedGame = await gameService.startGame(game.roomCode, userId);
    
    if (!updatedGame) {
      throw new Error('Failed to start game: No game data returned');
    }

    // Log the successful start
    logger.info('Game started successfully', {
      gameId: updatedGame._id,
      status: updatedGame.status,
      playerCount: updatedGame.players?.length || 0,
      questionCount: updatedGame.questions?.length || 0
    });

    // Extract the first question if available
    const firstQuestion = updatedGame.questions?.[0] 
      ? {
          _id: updatedGame.questions[0]._id?.toString(),
          questionText: updatedGame.questions[0].questionText,
          options: updatedGame.questions[0].options,
          category: updatedGame.questions[0].category,
          difficulty: updatedGame.questions[0].difficulty,
          timeLimit: updatedGame.questions[0].timeLimit
        }
      : null;
    
    // Return the success response with 200 status code
    return res.status(200).json({
      status: 1,
      message: 'Game started successfully',
      data: {
        game: {
          id: updatedGame._id.toString(),
          roomCode: updatedGame.roomCode,
          status: updatedGame.status,
          playerCount: updatedGame.players?.length || 0,
          questionCount: updatedGame.questions?.length || 0,
          currentQuestionIndex: updatedGame.currentQuestionIndex || 0,
          settings: updatedGame.settings || {}
        },
        firstQuestion,
        totalQuestions: updatedGame.questions?.length || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Kick a player from the game
// @route   POST /api/game/:roomCode/players/:playerId/kick
// @access  Private (Host only)
const kickPlayer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { playerId } = req.params;
    const game = (req as any).game;
    
    // Check if player exists in the game
    const playerIndex = game.players.findIndex(
      (p: IPlayer) => p.userId.toString() === playerId
    );
    
    if (playerIndex === -1) {
      return res.status(200).json({
        status: 0,
        message: 'Player not found in this game'
      });
    }
    
    // Remove player from the game
    game.players.splice(playerIndex, 1);
    await game.save();
    
    // TODO: Notify the kicked player via WebSocket
    
    res.status(200).json({
      status: 1,
      message: 'Player has been kicked from the game',
      data: {}
    });
  } catch (error) {
    res.status(200).json({
      status: 0,
      message: error.message || 'Failed to kick player'
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
    const io = req.app.get('io');

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

    // Get the game room with populated players using gameService
    const gameRoom = await GameRoom.findOne({ roomCode })
      .populate('players.userId')
      .populate('hostId')
      .lean();

    if (!gameRoom) {
      return next(new AppError('Game room not found', 200));
    }

    // Check if the user is a player in this game
    const isPlayer = gameRoom.players.some(player => player.userId._id.toString() === userId.toString());
    
    if (!isPlayer && gameRoom.hostId.toString() !== userId.toString()) {
      return next(new AppError('You are not a member of this game', 403));
    }

    // Prepare the response
    const response = {
      roomCode: gameRoom.roomCode,
      status: gameRoom.status,
      host: {
        id: gameRoom.hostId._id,
        username: typeof gameRoom.hostId === 'object' ? (gameRoom.hostId as any).username : 'Unknown'
      },
      players: gameRoom.players.map(player => ({
        id: player.userId._id,
        username: player.userId.username,
        avatar: player.avatar,
        isHost: player.isHost,
        isReady: player.isReady,
        score: player.score
      })),
      settings: {
        maxPlayers: gameRoom.settings.maximumPlayers,
        numberOfQuestions: gameRoom.settings.numberOfQuestions,
        selectedCategories: Object.entries(gameRoom.settings.categories || {})
          .filter(([_, cat]) => cat.enabled)
          .map(([id, cat]) => ({
            id,
            difficulty: cat.difficulty
          }))
      },
      currentPlayers: gameRoom.players.length,
      isFull: gameRoom.players.length >= gameRoom.settings.maximumPlayers,
      gameStarted: gameRoom.status !== 'waiting'
    };

    res.apiSuccess(response);
  } catch (error) {
    logger.error('Error in getGameLobby:', error);
    next(new AppError('Failed to get game lobby', 500));
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

    // Emit socket event to notify other players
    // This requires your socket implementation to be set up
    // io.to(roomCode).emit('playerReadyStatusChanged', {
    //   playerId: userId,
    //   isReady
    // });

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
  toggleReadyStatus,
  getGameLobby,
  leaveGame,
  getQuestions,
  submitAnswer,
  getGameSummary,
  getGameLeaderboard,
  finishGame,
  startGame,
  kickPlayer,
  updateGameSettings
};
