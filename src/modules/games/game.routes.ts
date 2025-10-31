import express, { Request, Response } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { isHost, isGameInLobby } from '../../middlewares/game.middleware';
import { validateCreateGame, validateJoinGame } from './validations/game.validations';
import { IUser } from '../users/user.model';
import {
  createGame, 
  getGameRoom, 
  joinGame, 
  getGameLobby, 
  leaveGame,
  getQuestions,
  submitAnswer,
  getGameSummary,
  getGameLeaderboard,
  finishGame,
  startGame,
  kickPlayer,
  updateGameSettings,
  toggleReadyStatus
} from './game.controller';

const router = express.Router();

/**
 * @route   POST /api/game/create
 * @desc    Create a new game room
 * @access  Private
 */
router.post('/create', protect, validateCreateGame, createGame);

/**
 * @route   POST /api/game/join
 * @desc    Join an existing game room
 * @access  Private
 */
router.post('/join', protect, validateJoinGame, joinGame);

/**
 * @route   GET /api/game/room/:code
 * @desc    Get game room details by code
 * @access  Private
 */
router.get('/room/:code', protect, getGameRoom);
/**
 * @route   GET /api/game/lobby/:roomCode
 * @desc    Get game lobby details by room code
 * @access  Private
 */
router.get('/lobby/:roomCode', protect, getGameLobby);


// Add this route with other routes
/**
 * @route   POST /api/game/leave
 * @desc    Leave a game room
 * @access  Private
 */
router.post('/leave', protect, leaveGame);

/**
 * @route   GET /api/game/questions/:roomCode
 * @desc    Get all questions for a game room
 * @access  Private
 */
router.get('/questions/:roomCode', protect, getQuestions);

/**
 * @route   POST /api/game/submit-answer
 * @desc    Submit an answer to a question
 * @access  Private
 */
router.post('/submit-answer', protect, submitAnswer);

/**
 * @route   GET /api/game/summary/:roomCode
 * @desc    Get game summary for the logged-in user
 * @access  Private
 */
router.get('/summary/:roomCode', protect, getGameSummary);

/**
 * @route   GET /api/game/leaderboard/:roomCode
 * @desc    Get the leaderboard for a completed game
 * @access  Private
 */
router.get('/leaderboard/:roomCode', protect, getGameLeaderboard);

/**
 * @route   PATCH /api/games/finish/:roomCode
 * @desc    Finish a game and update player stats
 * @access  Private
 */

interface IFinishGameRequest extends Request {
  params: {
    roomCode: string;
  };
  user?: IUser;
}

// Host-only routes
router.patch('/finish/:roomCode', protect, isHost, (req: IFinishGameRequest, res: Response, next) => finishGame(req, res, next));

/**
 * @route   PATCH /api/game/:roomCode/ready
 * @desc    Toggle player's ready status
 * @access  Private
 */
router.patch('/:roomCode/ready', protect, (req: Request, res: Response, next: NextFunction) => toggleReadyStatus(req, res, next));

/**
 * @route   POST /api/game/:roomCode/start
 * @desc    Start the game (Host only)
 * @access  Private
 */
router.post('/:roomCode/start', protect, isHost, isGameInLobby, startGame);

/**
 * @route   POST /api/game/:roomCode/players/:playerId/kick
 * @desc    Kick a player from the game (Host only)
 * @access  Private
 */
router.post('/:roomCode/players/:playerId/kick', protect, isHost, kickPlayer);

/**
 * @route   PATCH /api/game/:roomCode/settings
 * @desc    Update game settings (Host only)
 * @access  Private
 */
router.patch('/:roomCode/settings', protect, isHost, isGameInLobby, updateGameSettings);

export default router;
