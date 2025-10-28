import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { AppError } from '../../utils/appError';
import { GameRoom, IPlayer, IAnsweredQuestion } from './models/gameRoom.model';
import { Deck } from './models/deck.model';
import User from '../users/user.model';
import { Question } from './models/question.model';
import { generateUniqueRoomCode } from './utils/generateRoomCode';
import { IUser } from '../users/user.model';

interface IGameLobbyRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

interface IRequestWithUser extends Request {
  user?: IUser;
}



/**
 * @desc    Create a new game room
 * @route   POST /api/game/create
 * @access  Private
 */
export const createGame = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return next(new AppError('User not authenticated', 401));
    }

    // Define valid difficulties
    const validDifficulties = ['easy', 'medium', 'hard'] as const;

    // Case-insensitive destructuring of request body
    const requestCategories = req.body.categories || req.body.Categories;
    const { numberOfQuestions = 10, maximumPlayers = 4 } = req.body;

    // Validate request
    if (!requestCategories || Object.keys(requestCategories).length === 0) {
      return next(new AppError('At least one category must be specified', 400));
    }

    // Process categories with case-insensitive matching
    const enabledCategories = Object.entries(requestCategories)
      .filter(([_, settings]: [string, any]) => {
        const enabled = settings?.enabled || settings?.Enabled;
        return enabled === true || enabled === 'true';
      })
      .map(([category, settings]: [string, any]) => {
        const difficulty = (settings?.difficulty || settings?.Difficulty || 'easy').toLowerCase();
        return {
          category: category.trim(),
          difficulty: validDifficulties.includes(difficulty as any) 
            ? difficulty as 'easy' | 'medium' | 'hard' 
            : 'easy'
        };
      });

    if (enabledCategories.length === 0) {
      return next(new AppError('No valid categories enabled', 400));
    }

    console.log('Processing categories:', enabledCategories);

    // Get all decks for the requested categories
    const categoryNames = enabledCategories.map(ec => ec.category);
    const decks = await Deck.find({
      $or: [
        { category: { $in: categoryNames } },
        { name: { $in: categoryNames } }
      ]
    }).lean();

    if (decks.length === 0) {
      return next(new AppError('No decks found for the requested categories', 400));
    }

    console.log(`Found ${decks.length} decks for categories: ${categoryNames.join(', ')}`);

    // Group decks by category for easier access
    const decksByCategory = decks.reduce((acc: Record<string, any[]>, deck: any) => {
      const categories = [
        deck.category?.toLowerCase(),
        deck.name?.toLowerCase()
      ].filter(Boolean) as string[];
      
      categories.forEach(cat => {
        if (!acc[cat]) {
          acc[cat] = [];
        }
        acc[cat].push(deck);
      });
      
      return acc;
    }, {} as Record<string, any[]>);

    // First, collect all questions from all categories
    let allQuestions: any[] = [];
    const availableCategories: string[] = [];
    const categoryQuestionMap: { [key: string]: any[] } = {};

    // First pass: Get all available questions for each category
    for (const { category, difficulty } of enabledCategories) {
      const categoryKey = category.toLowerCase();
      const categoryDecks = decksByCategory[categoryKey];
      
      if (!categoryDecks || categoryDecks.length === 0) {
        console.warn(`No decks found for category: ${category}`);
        continue;
      }

      const deckIds = categoryDecks.map(deck => deck._id.toString());
      const queryDifficulty = difficulty.toLowerCase() as 'easy' | 'medium' | 'hard';

      console.log(`Fetching questions for category: ${category}, difficulty: ${queryDifficulty}`);

      // First try with exact difficulty
      let questions = await Question.aggregate([
        { 
          $match: {
            deckId: { $in: deckIds },
            difficulty: queryDifficulty,
            category: { $regex: new RegExp(`^${category}$`, 'i') }
          } 
        },
        { $sample: { size: numberOfQuestions } }
      ]).allowDiskUse(true);

      // If not enough questions, try any difficulty
      if (questions.length < numberOfQuestions) {
        const moreQuestions = await Question.aggregate([
          { 
            $match: {
              deckId: { $in: deckIds },
              category: { $regex: new RegExp(`^${category}$`, 'i') },
              _id: { $nin: questions.map(q => q._id) }
            } 
          },
          { $sample: { size: numberOfQuestions - questions.length } }
        ]).allowDiskUse(true);
        
        questions = [...questions, ...moreQuestions];
      }

      if (questions.length > 0) {
        categoryQuestionMap[category] = questions;
        allQuestions = [...allQuestions, ...questions];
        availableCategories.push(category);
        console.log(`Found ${questions.length} questions for ${category}`);
      } else {
        console.warn(`No questions found for ${category} in any deck`);
      }
    }

    // If no questions found in any category, return error
    if (allQuestions.length === 0) {
      return next(new AppError('No questions found in any of the selected categories', 400));
    }

    // Distribute questions fairly among categories
    const finalQuestions: any[] = [];
    const questionsPerCategory = Math.ceil(numberOfQuestions / availableCategories.length);
    
    // Take questions from each category in a round-robin fashion
    for (let i = 0; i < questionsPerCategory; i++) {
      for (const category of availableCategories) {
        if (categoryQuestionMap[category] && categoryQuestionMap[category].length > 0) {
          const question = categoryQuestionMap[category].pop();
          finalQuestions.push(question);
          
          // Stop if we have enough questions
          if (finalQuestions.length >= numberOfQuestions) {
            break;
          }
        }
      }
      
      // Stop if we have enough questions
      if (finalQuestions.length >= numberOfQuestions) {
        break;
      }
    }

    allQuestions = finalQuestions.slice(0, numberOfQuestions);

    // Final check if we have enough questions
    if (allQuestions.length < numberOfQuestions) {
      const errorMessage = `Not enough questions available. Found ${allQuestions.length} out of ${numberOfQuestions} requested.\n` +
        `Requested categories: ${enabledCategories.map(ec => `${ec.category} (${ec.difficulty})`).join(', ')}\n` +
        (availableCategories.length > 0 
          ? `Available categories with questions: ${availableCategories.join(', ')}` 
          : 'No questions found in any category. Please check if the decks have questions.');
      
      return next(new AppError(errorMessage, 400));
    }

    // Shuffle and limit questions
    const shuffledQuestions = allQuestions
      .sort(() => 0.5 - Math.random())
      .slice(0, numberOfQuestions);

    // Create game room
    const roomCode = await generateUniqueRoomCode();
    
    // Format categories as a map
    const categoriesMap = enabledCategories.reduce((acc, { category, difficulty }) => {
      acc[category] = { enabled: true, difficulty };
      return acc;
    }, {} as Record<string, { enabled: boolean; difficulty: 'easy' | 'medium' | 'hard' }>);

    const gameRoom = new GameRoom({
      roomCode,
      hostId: req.user._id,  // Using hostId instead of host to match schema
      players: [{
        userId: req.user._id,
        username: req.user.username,
        isHost: true,
        score: 0
      }],
      questions: shuffledQuestions.map(q => q._id), // Store only question IDs
      currentQuestion: 0,
      status: 'waiting',
      settings: {
        categories: categoriesMap,
        numberOfQuestions,
        maximumPlayers
      }
    });

    await gameRoom.save();

    res.status(201).json({
      success: true,
      message: 'Game room created successfully',
      data: {
        roomCode,
        questions: shuffledQuestions
      }
    });

  } catch (error) {
    console.error('Error in createGame:', error);
    next(new AppError('Failed to create game room', 500));
  }
};

/**
 * @desc    Get game room by code
 * @route   GET /api/game/room/:code
 * @access  Private
 */
/**
 * @desc    Join an existing game room
 * @route   POST /api/game/join
 * @access  Private
 */
export const joinGame = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (!req.user) {
      return next(new AppError('User not authenticated', 401));
    }

    const { roomCode } = req.body;
    const userId = req.user._id;
    const username = req.user.username;
    const avatar = req.user.avatar;

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
    
    if (!gameRoom) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Invalid room code or game not available', 404));
    }

    // Check if game is joinable
    if (gameRoom.status !== 'waiting') {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Game is not accepting new players', 400));
    }

    // Check if already joined
    const alreadyJoined = gameRoom.players.some(
      (player: IPlayer) => player.userId.toString() === userId.toString()
    );

    if (alreadyJoined) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('You have already joined this game', 400));
    }

    // Check if room is full
    if (gameRoom.players.length >= gameRoom.settings.maximumPlayers) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Game room is full', 400));
    }

    // Add player to the game
    gameRoom.players.push({
      userId,
      username,
      avatar,
      score: 0,
      isHost: false
    });

    await gameRoom.save({ session });
    await session.commitTransaction();

    // Format the response
    const response = {
      success: true,
      message: 'Joined the game successfully',
      game: {
        roomCode: gameRoom.roomCode,
        categories: gameRoom.settings.categories,
        numberOfQuestions: gameRoom.settings.numberOfQuestions,
        players: gameRoom.players.map((player: IPlayer) => ({
          username: player.username,
          avatar: player.avatar
        })),
        status: gameRoom.status
      }
    };

    res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    next(error);
  } finally {
    session.endSession();
  }
};

export const getGameRoom = async (req: Request, res: Response, next: NextFunction) => {
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
    const response = {
      success: true,
      data: {
        ...gameRoom,
        category,
        difficulty,
        players: gameRoom.players.map((player: any) => ({
          userId: player.userId?._id,
          username: player.username || player.userId?.username,
          avatar: player.avatar || player.userId?.avatar
        }))
      }
    };

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};

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
export const getQuestions = async (req: IGetQuestionsRequest, res: Response) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized - User not authenticated',
      });
    }

    // Find the game room with populated questions
   const gameRoom = await GameRoom.findOne({ roomCode })
  .populate({
    path: 'questions',
    select: 'text question options correctAnswer explanation difficulty category timerInSeconds',
    options: { lean: true }
  });
  

    if (!gameRoom) {
      return res.status(404).json({
        success: false,
        message: 'Invalid room code or game not found.',
      });
    }

    // Check if user is a participant in this room
    const isParticipant = gameRoom.players.some(
      (player: IPlayer) => player.userId.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not a participant in this game room.',
      });
    }

    // Check if game has started
    if (gameRoom.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Game has not started yet or already finished.'
      });
    }

    // Debug log the questions array
    console.log('Raw questions data:', JSON.stringify(gameRoom.questions, null, 2));

    // Format questions as per requirements
    const formattedQuestions = gameRoom.questions.map((question: any, index: number) => {
      // Log each question's available fields
      console.log(`Question ${index + 1} fields:`, Object.keys(question));
      
      return {
        questionId: question._id,
        questionNumber: index + 1,
        questionText: question.text || question.question || 'No question text available',
        questionType: 'multiple-choice',
        options: question.options || [],
        timerInSeconds: question.timerInSeconds || 30,
        difficulty: question.difficulty || 'easy',
        category: question.category || 'General'
      };
    });
    
    console.log('Formatted questions:', JSON.stringify(formattedQuestions, null, 2));


    return res.status(200).json({
      success: true,
      data: {
        questions: formattedQuestions,
        totalQuestions: formattedQuestions.length,
        roomCode: gameRoom.roomCode,
        gameStatus: gameRoom.status
      }
    });

  } catch (error: any) {
    console.error('Error fetching questions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while fetching questions',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const leaveGame = async (req: ILeaveGameRequest, res: Response, next: NextFunction) => {
  const { roomCode } = req.body;
  const userId = req.user?._id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  try {
    // Find the game room by roomCode
    const gameRoom = await GameRoom.findOne({ roomCode });

    // Check if game room exists
    if (!gameRoom) {
      return res.status(404).json({
        success: false,
        message: 'Game room not found or already started.'
      });
    }

    // Check if game has already started
    if (gameRoom.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: 'Game room not found or already started.'
      });
    }

    // Find player index in the game room
    const playerIndex = gameRoom.players.findIndex(
      (player: IPlayer) => player.userId.toString() === userId.toString()
    );

    // If player not found in the game
    if (playerIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'You are not in this game room.'
      });
    }

    // Remove player from the game
    gameRoom.players.splice(playerIndex, 1);

    // If the leaving player was the host and there are other players, assign a new host
    if (gameRoom.players.length > 0 && gameRoom.hostId.toString() === userId.toString()) {
      gameRoom.hostId = gameRoom.players[0].userId;
      gameRoom.players[0].isHost = true;
    }

    // If no players left, delete the game room
    if (gameRoom.players.length === 0) {
      await GameRoom.deleteOne({ _id: gameRoom._id });
      return res.status(201).json({
        success: true,
        message: 'You have left the game room. The game room has been closed as it is now empty.'
      });
    }

    // Save the updated game room
    await gameRoom.save();

    res.status(201).json({
      success: true,
      message: 'You have left the game room successfully.'
    });

  } catch (error) {
    console.error('Leave game error:', error);
    next(new AppError('Failed to leave game room', 500));
  }
};

interface ISubmitAnswerRequest extends Request {
  body: {
    roomCode: string;
    questionId: string;
    selectedOption: string;
    timeTaken: number;
  };
  user?: IUser;
}

/**
 * @desc    Submit an answer to a question
 * @route   POST /api/game/submit-answer
 * @access  Private
 */
 export const submitAnswer = async (req: ISubmitAnswerRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { roomCode, questionId, selectedOption, timeTaken } = req.body;
    const userId = req.user?._id;

    // Validate request
    if (!roomCode || !questionId || selectedOption === undefined || timeTaken === undefined) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Missing required fields', 400));
    }

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('User not authenticated', 401));
    }

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
    if (!gameRoom) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Game room not found', 404));
    }

    // Check if game is active
    if (gameRoom.status !== 'active') {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Game is not active', 400));
    }

    // Check if user is a player in this game
    const player = gameRoom.players.find((p: IPlayer) => p.userId.toString() === userId.toString());
    if (!player) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('You are not a player in this game', 403));
    }

    // Check if the question exists in this game
    if (!gameRoom.questions.some((q: mongoose.Types.ObjectId) => q.toString() === questionId)) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Question not found in this game', 404));
    }

    // Check if player already answered this question
    const alreadyAnswered = gameRoom.answeredQuestions?.some(
      (aq: IAnsweredQuestion) => aq.playerId.toString() === userId.toString() && 
            aq.questionId.toString() === questionId
    ) || false;

    if (alreadyAnswered) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('You have already answered this question', 400));
    }

    // Get the question details
    const question = await Question.findById(questionId).session(session);
    if (!question) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Question not found', 404));
    }

    // Check if time has expired (assuming question has a timer in seconds)
    const questionTimer = 30; // Default 30 seconds per question
    if (timeTaken > questionTimer) {
      await session.abortTransaction();
      session.endSession();
      return next(new AppError('Time\'s up!', 400));
    }

    // Check if answer is correct
    const selectedOptionIndex = question.options.findIndex(opt => opt === selectedOption);
    const isCorrect = selectedOptionIndex === question.correctAnswer;

    // Calculate score: 10 points for each correct answer
    const scoreEarned = isCorrect ? 10 : 0;

    // Update player's score
    player.score += scoreEarned;

    // Initialize answeredQuestions array if it doesn't exist
    if (!gameRoom.answeredQuestions) {
      gameRoom.answeredQuestions = [];
    }

    // Record the answer
    gameRoom.answeredQuestions.push({
      playerId: userId,
      questionId: question._id,
      selectedOption: selectedOptionIndex,
      isCorrect,
      timeTaken,
      answeredAt: new Date()
    } as any);

    // Save changes
    await gameRoom.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Prepare response
    const questionsAnswered = gameRoom.answeredQuestions.filter(
      (aq: IAnsweredQuestion) => aq.playerId.toString() === userId.toString()
    ).length;

    res.status(200).json({
      success: true,
      message: 'Answer submitted successfully',
      result: {
        isCorrect,
        correctAnswer: question.options[question.correctAnswer]
      },
      playerStats: {
        currentScore: player.score,
        questionsAnswered
      }
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    next(error);
  }
};

/**
 * @desc    Get game lobby details by room code
 * @route   GET /api/game/lobby/:roomCode
 * @access  Private
 */
export const getGameLobby = async (req: IGameLobbyRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return next(new AppError('User not authenticated', 401));
    }

    const gameRoom = await GameRoom.findOne({ roomCode })
      .select('-questions') // Don't send questions in the lobby
      .populate('players.userId', 'username avatar')
      .lean() as any;

    if (!gameRoom) {
      return next(new AppError('Game room not found', 404));
    }

    // Check if user is a participant
    const isParticipant = gameRoom.players.some(
      (player: any) => player.userId && player.userId._id.toString() === userId.toString()
    );

    if (!isParticipant) {
      return next(new AppError('You are not a participant in this game', 403));
    }

    res.status(200).json({
      success: true,
      data: {
        roomCode: gameRoom.roomCode,
        host: gameRoom.host || gameRoom.hostId,
        status: gameRoom.status,
        players: gameRoom.players.map((player: any) => ({
          userId: player.userId?._id,
          username: player.username || (player.userId as any)?.username,
          avatar: player.avatar || (player.userId as any)?.avatar,
          score: player.score || 0
        })),
        maxPlayers: gameRoom.maxPlayers || gameRoom.settings?.maximumPlayers,
        currentPlayers: gameRoom.players.length,
        gameSettings: gameRoom.gameSettings || gameRoom.settings
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get game summary for the logged-in user
 * @route   GET /api/game/summary/:roomCode
 * @access  Private
 */
export const getGameSummary = async (req: Request, res: Response, next: NextFunction) => {
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
      return next(new AppError('Game not found', 404));
    }

    if (gameRoom.status !== 'finished') {
      return res.status(400).json({
        success: false,
        message: 'Game summary not available. The game is not yet complete.',
      });
    }

    const player = gameRoom.players.find((p: any) => 
      p.userId && p.userId.toString() === userId.toString()
    );
    
    if (!player) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view the summary for this game.',
      });
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

    return res.status(200).json({
      success: true,
      message: 'Game summary fetched successfully.',
      summary: {
        totalScore,
        accuracy,
        correctAnswers,
        totalQuestions,
        rank,
        questions: questionSummaries,
      },
    });

  } catch (error) {
    console.error('Error getting game summary:', error);
    next(new AppError('Server error', 500));
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
export const getGameLeaderboard = async (req: IGameLeaderboardRequest, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = req.user?._id;

    if (!userId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Find the game room
    const gameRoom = await GameRoom.findOne({ 
      roomCode: roomCode.toUpperCase() 
    }).populate('players.userId', 'username avatar');

    // Check if game room exists
    if (!gameRoom) {
      return res.status(404).json({
        success: false,
        message: 'Leaderboard not available. The game room was not found or the game is not yet complete.'
      });
    }

    // Check if game is completed
    if (gameRoom.status !== 'finished') {
      return res.status(400).json({
        success: false,
        message: 'Leaderboard not available. The game room was not found or the game is not yet complete.'
      });
    }

    // Check if user is a participant in this game
    const isParticipant = gameRoom.players.some((player: any) => 
      player.userId && player.userId._id.toString() === userId.toString()
    );

    if (!isParticipant) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to view this leaderboard.'
      });
    }

    // Define an interface for player stats
    interface PlayerStats {
      userId: mongoose.Types.ObjectId;
      username: string;
      avatar?: string;
      points: number;
      accuracy: number;
      averageTime: number;
      correctAnswers: number;
      totalQuestionsAnswered: number;
    };

    // Calculate player stats
    const playerStats: PlayerStats[] = [];
    
    for (const player of gameRoom.players as any[]) {
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

      playerStats.push({
        userId: userId._id,
        username: userId.username || 'Unknown',
        avatar: userId.avatar,
        points: player.score || 0,
        accuracy,
        averageTime,
        correctAnswers,
        totalQuestionsAnswered
      });
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
      success: true,
      message: 'Leaderboard fetched successfully.',
      leaderboard: {
        players: leaderboard
      }
    });

  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    next(new AppError('Failed to fetch leaderboard', 500));
  }
};

// Interface for finish game request
interface IFinishGameRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

/**
 * @desc    Finish a game and update player stats
 * @route   PATCH /api/games/finish/:roomCode
 * @access  Private
 */
export const finishGame = async (req: IFinishGameRequest, res: Response, next: NextFunction) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { roomCode } = req.params;
    
    // Input validation
    if (!roomCode || typeof roomCode !== 'string' || roomCode.trim() === '') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: 'Room code is required',
        statusCode: 400
      });
    }

    // Find the game room with case-insensitive search
    const gameRoom = await GameRoom.findOne({ 
      roomCode: { $regex: new RegExp(`^${roomCode}$`, 'i') }
    })
      .populate<{ players: IPlayer[] }>('players.userId', 'stats')
      .session(session);

    if (!gameRoom) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `Game room with code '${roomCode}' not found`,
        statusCode: 404
      });
    }

    // Check game status
    if (gameRoom.status === 'finished') {
      await session.abortTransaction();
      session.endSession();
      return res.status(409).json({
        success: false,
        message: `Game '${roomCode}' has already been completed`,
        status: gameRoom.status,
        finishedAt: gameRoom.finishedAt,
        statusCode: 409
      });
    }

    // Additional validation - check if game has started
    if (gameRoom.status !== 'active') {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Game '${roomCode}' is not in a finishable state. Current status: ${gameRoom.status}`,
        statusCode: 400
      });
    }

    // Calculate stats
    const totalQuestions = gameRoom.questions.length;
    const answered = gameRoom.answeredQuestions || [];
    const correct = answered.filter((q: any) => q.isCorrect).length;
    const totalTime = answered.reduce((sum: number, q: any) => sum + (q.timeTaken || 0), 0);
    const accuracy = totalQuestions > 0 ? Math.round((correct / totalQuestions) * 100) : 0;

    // Update game room status
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
      averageTimePerQuestion: answered.length > 0 ? totalTime / answered.length : 0
    };

    await gameRoom.save({ session });

    // Update player stats
    const updatePromises = gameRoom.players.map(async (player: any) => {
      if (!player.userId) return null;
      
      const playerAnswers = answered.filter((a: any) => 
        a.playerId && a.playerId.toString() === player.userId.toString()
      );
      
      const playerCorrect = playerAnswers.filter((a: any) => a.isCorrect).length;

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
      const user = await User.findById(player.userId).session(session);
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

      return User.findByIdAndUpdate(player.userId, update, { new: true, session });
    });

    await Promise.all(updatePromises);
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      success: true,
      message: 'Game finished and stats updated successfully',
      data: {
        roomCode: gameRoom.roomCode,
        status: gameRoom.status,
        finishedAt: gameRoom.finishedAt,
        stats: gameRoom.stats,
        playersUpdated: gameRoom.players.length
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return next(error);
  }
};

// export {
//   createGame,
//   joinGame,
//   getGameRoom,
//   getQuestions,
//   leaveGame,
//   submitAnswer,
//   getGameLobby,
//   getGameSummary,
//   getGameLeaderboard,
//   finishGame
// };
