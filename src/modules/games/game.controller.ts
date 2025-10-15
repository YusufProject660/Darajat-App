import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../../utils/errorResponse';
import { GameRoom } from './models/gameRoom.model';
import { Deck } from './models/deck.model';
import { Question } from './models/question.model';
import { generateUniqueRoomCode } from './utils/generateRoomCode';
import { IUser } from '../users/user.model';
import mongoose from 'mongoose';

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
export const createGame = async (req: IRequestWithUser, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      return next(new ErrorResponse('User not authenticated', 401));
    }

    const { categories, numberOfQuestions, maximumPlayers } = req.body;
    console.log(categories, numberOfQuestions, maximumPlayers)

    // Get enabled categories
    const enabledCategories = Object.entries(categories as ICategorySettings)
      .filter(([_, value]) => value.enabled)
      .map(([category, settings]) => ({
        category,
        difficulty: settings.difficulty
      }));
      console.log("these are enabled category", enabledCategories)

    // Find active decks for the enabled categories and difficulties
    const deckQueries = enabledCategories.map(({ category, difficulty }) => ({
      category,
      difficulty,
      status: 'active'
    }));
    console.log("these are deck queries", deckQueries)
    const decks = await Deck.find({
      $or: deckQueries
    });

    if (decks.length === 0) {
      return next(new ErrorResponse('No active decks found for the selected categories', 400));
    }

    // Get deck IDs for the query
    // const deckIds = decks.map(deck => deck._id);

    // Calculate questions per category (distribute questions evenly)
    const questionsPerCategory = Math.ceil(numberOfQuestions / enabledCategories.length);
    console.log("these are questions per category", questionsPerCategory)
    // Get questions from each category
    let questions: any[] = [];
    console.log("these are decks", decks)
    
    for (const { category, difficulty } of enabledCategories) {
      const categoryDecks = decks.filter(d => 
        d.category == category && d.difficulty == difficulty
      );
      console.log("these are category decks", categoryDecks)
      
      // if (categoryDecks.length === 0) continue;
      const rawdeckIds = categoryDecks.map(d => (d._id));
      console.log("these are deck ids", rawdeckIds)
      const deckIds = rawdeckIds.map(id => id.toString());
      console.log("these are deck ids", deckIds)
      
      const categoryQuestions = await Question.aggregate([
        { 
          $match: { 
            deckId: { $in: deckIds },
            // difficulty: difficulty,
            // status: 'active' // Ensure we only get active questions
          } 
        },
        // { $sample: { size: questionsPerCategory } }
      ]);
      console.log("these are category questions", categoryQuestions)
      
      questions = [...questions, ...categoryQuestions];
    }
    console.log("these are questions", questions)
    // If we couldn't get enough questions, return an error
    if (questions.length < numberOfQuestions) {
      return next(new ErrorResponse('Not enough questions available for the selected categories', 400));
    }

    // Limit to the requested number of questions
    const selectedQuestions = questions.slice(0, numberOfQuestions);
    const questionIds = selectedQuestions.map(q => q._id);
    console.log("these are question ids", questionIds)

    // Generate a unique room code
    const roomCode = await generateUniqueRoomCode();

    // Create the game room
    const gameRoom = await GameRoom.create({
      hostId: req.user._id,
      roomCode,
      players: [{
        userId: req.user._id,
        username: req.user.username,
        avatar: req.user.avatar,
        isHost: true,
        score: 0
      }],
      settings: {
        numberOfQuestions,
        maximumPlayers,
        categories
      },
      questions: questionIds,
      status: 'waiting',
      results: []
    });

    // Populate the questions for the response
    const populatedGameRoom = await GameRoom.findById(gameRoom._id)
      .select('-__v')
      .populate({
        path: 'players.userId',
        select: 'username avatar'
      });

    res.status(201).json({
      success: true,
      message: 'Game room created successfully',
      game: populatedGameRoom,
      questions: selectedQuestions



    });
  } catch (error) {
    next(error);
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