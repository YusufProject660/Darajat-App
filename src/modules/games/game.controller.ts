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
export const getGameRoom = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    
    const gameRoom = await GameRoom.findOne({ roomCode: code.toUpperCase() })
      .select('-__v')
      .populate({
        path: 'players.userId',
        select: 'username avatar'
      });

    if (!gameRoom) {
      return next(new ErrorResponse('Game room not found', 404));
    }

    res.status(200).json({
      success: true,
      game: gameRoom
    });
  } catch (error) {
    next(error);
  }
};
