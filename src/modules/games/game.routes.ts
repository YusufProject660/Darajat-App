import express, { Request, Response } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { validateCreateGame, validateJoinGame } from './validations/game.validations';
import { 
  createGame, 
  getGameRoom, 
  joinGame, 
  getGameLobby, 
  leaveGame,
  getQuestions,
  submitAnswer,
  getGameSummary
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

export default router;
