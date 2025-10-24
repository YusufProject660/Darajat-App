import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ErrorResponse } from '../../utils/errorResponse';
import { GameRoom } from './models/gameRoom.model';
import { Deck } from './models/deck.model';
import { Question } from './models/question.model';
import { generateUniqueRoomCode } from './utils/generateRoomCode';
import { IUser } from '../users/user.model';

interface IRequestWithUser extends Request {
  user?: IUser;
}

interface ICategorySettings {
  [key: string]: {
    enabled: boolean;
    difficulty: 'easy' | 'medium' | 'hard';
  };
}



/**
 * @desc    Create a new game room
 * @route   POST /api/game/create
 * @access  Private
 */
// In game.controller.ts, update the createGame function with this improved version:
const toObjectId = (id: string | mongoose.Types.ObjectId) =>
  typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;

export const createGame = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return next(new ErrorResponse('User not authenticated', 401));
    }

    // Define valid difficulties
    const validDifficulties = ['easy', 'medium', 'hard'] as const;

    // Case-insensitive destructuring of request body
    const requestCategories = req.body.categories || req.body.Categories;
    const { numberOfQuestions = 10, maximumPlayers = 4 } = req.body;

    // Validate request
    if (!requestCategories || Object.keys(requestCategories).length === 0) {
      return next(new ErrorResponse('At least one category must be specified', 400));
    }

    // Process categories with case-insensitive matching
    const enabledCategories = Object.entries(requestCategories)
      .filter(([_, settings]) => {
        const enabled = settings?.enabled || settings?.Enabled;
        return enabled === true || enabled === 'true';
      })
      .map(([category, settings]) => {
        const difficulty = (settings?.difficulty || settings?.Difficulty || 'easy').toLowerCase();
        return {
          category: category.trim(),
          difficulty: validDifficulties.includes(difficulty as any) 
            ? difficulty as 'easy' | 'medium' | 'hard' 
            : 'easy'
        };
      });

    if (enabledCategories.length === 0) {
      return next(new ErrorResponse('No valid categories enabled', 400));
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
      return next(new ErrorResponse('No decks found for the requested categories', 400));
    }

    console.log(`Found ${decks.length} decks for categories: ${categoryNames.join(', ')}`);

    // Group decks by category for easier access
    const decksByCategory = decks.reduce((acc, deck) => {
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
      return next(new ErrorResponse('No questions found in any of the selected categories', 400));
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
      
      return next(new ErrorResponse(errorMessage, 400));
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
    next(new ErrorResponse('Failed to create game room', 500));
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
      return next(new ErrorResponse('User not authenticated', 401));
    }

    const { roomCode } = req.body;
    const userId = req.user._id;
    const username = req.user.username;
    const avatar = req.user.avatar;

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
    
    if (!gameRoom) {
      await session.abortTransaction();
      return next(new ErrorResponse('Invalid room code or game not available', 404));
    }

    // Check if game is joinable
    if (gameRoom.status !== 'waiting') {
      await session.abortTransaction();
      return next(new ErrorResponse('Game is not accepting new players', 400));
    }

    // Check if already joined
    const alreadyJoined = gameRoom.players.some(
      player => player.userId.toString() === userId.toString()
    );

    if (alreadyJoined) {
      await session.abortTransaction();
      return next(new ErrorResponse('You have already joined this game', 400));
    }

    // Check if room is full
    if (gameRoom.players.length >= gameRoom.settings.maximumPlayers) {
      await session.abortTransaction();
      return next(new ErrorResponse('Game room is full', 400));
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
        players: gameRoom.players.map(player => ({
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
      .lean();

    if (!gameRoom) {
      return next(new ErrorResponse('Game room not found', 404));
    }

    res.status(200).json({
      success: true,
      data: gameRoom
    });
  } catch (error) {
    next(error);
  }
};
export const getGameLobby = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    
    if (!roomCode) {
      return next(new ErrorResponse('Room code is required', 400));
    }

    const gameRoom = await GameRoom.findOne({ roomCode })
      .populate('players.userId', 'username avatar')
      .select('-questions -results -__v')
      .lean();

    if (!gameRoom) {
      return next(new ErrorResponse('Game room not found or expired', 404));
    }

    // Get the first enabled category and its difficulty
    const enabledCategories = Object.entries(gameRoom.settings.categories)
      .filter(([_, settings]) => settings.enabled)
      .map(([category, settings]) => ({ category, difficulty: settings.difficulty }));

    const firstCategory = enabledCategories[0] || { category: 'General', difficulty: 'medium' };

    // Prepare the response
    const response = {
      success: true,
      game: {
        roomCode: gameRoom.roomCode,
        gameName: gameRoom.settings.gameName || 'Trivia Game',
        description: gameRoom.settings.description || 'Test your knowledge!',
        hostId: gameRoom.hostId,
        category: firstCategory.category,
        difficulty: firstCategory.difficulty,
        numberOfQuestions: gameRoom.settings.numberOfQuestions,
        timer: gameRoom.settings.timer || '30s',
        playersLimit: gameRoom.settings.maximumPlayers,
        players: gameRoom.players.map(player => ({
          userId: player.userId._id,
          username: player.username || (player.userId as any).username,
          avatar: player.avatar || (player.userId as any).avatar
        })),
        status: gameRoom.status
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

/**
 * @desc    Leave a game room
 * @route   POST /api/game/leave
 * @access  Private
 */
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
export const getQuestions = async (req: IGetQuestionsRequest, res: Response, next: NextFunction) => {
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
      (player) => player.userId.toString() === userId.toString()
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
    const formattedQuestions = gameRoom.questions.map((question: any, index) => {
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
    return next(new ErrorResponse('User not authenticated', 401));
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
      player => player.userId.toString() === userId.toString()
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
    next(new ErrorResponse('Failed to leave game room', 500));
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
      return next(new ErrorResponse('Missing required fields', 400));
    }

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('User not authenticated', 401));
    }

    // Find the game room
    const gameRoom = await GameRoom.findOne({ roomCode }).session(session);
    if (!gameRoom) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('Game room not found', 404));
    }

    // Check if game is active
    if (gameRoom.status !== 'active') {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('Game is not active', 400));
    }

    // Check if user is a player in this game
    const player = gameRoom.players.find(p => p.userId.toString() === userId.toString());
    if (!player) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('You are not a player in this game', 403));
    }

    // Check if the question exists in this game
    const questionObjectId = new mongoose.Types.ObjectId(questionId);
    if (!gameRoom.questions.some(q => q.toString() === questionId)) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('Question not found in this game', 404));
    }

    // Check if player already answered this question
    const alreadyAnswered = gameRoom.answeredQuestions?.some(
      aq => aq.playerId.toString() === userId.toString() && 
            aq.questionId.toString() === questionId
    ) || false;

    if (alreadyAnswered) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('You have already answered this question', 400));
    }

    // Get the question details
    const question = await Question.findById(questionId).session(session);
    if (!question) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('Question not found', 404));
    }

    // Check if time has expired (assuming question has a timer in seconds)
    const questionTimer = 30; // Default 30 seconds per question
    if (timeTaken > questionTimer) {
      await session.abortTransaction();
      session.endSession();
      return next(new ErrorResponse('Time\'s up!', 400));
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
      aq => aq.playerId.toString() === userId.toString()
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

// Interface for game summary request
interface IGameSummaryRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

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
      return next(new ErrorResponse('User not authenticated', 401));
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
      .lean();

    if (!gameRoom) {
      return next(new ErrorResponse('Game not found', 404));
    }

    if (gameRoom.status !== 'finished') {
      return res.status(400).json({
        success: false,
        message: 'Game summary not available. The game is not yet complete.',
      });
    }

    const player = gameRoom.players.find(p => 
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
    next(new ErrorResponse('Server error', 500));
  }
};


