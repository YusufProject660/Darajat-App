import express, { Request, Response, NextFunction } from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { isHost, isGameInLobby } from '../../middlewares/game.middleware';
import { validateCreateGame, validateJoinGame } from './validations/game.validations';

// Middleware to handle method not allowed
export const methodNotAllowed = (req: Request, res: Response, next: NextFunction) => {
  const routePath = req.path;
  
  // Determine the allowed method based on the route
  let allowedMethod = 'POST'; // Default to POST for backward compatibility
  
  if (routePath.includes('/lobby/') || routePath.startsWith('/summary/') || routePath.startsWith('/leaderboard/')) {
    allowedMethod = 'GET';
  } else if (routePath === '/create' || routePath === '/join') {
    allowedMethod = 'POST';
  }
  
  if (req.method !== allowedMethod) {
    return res.status(200).json({
      status: 0,
      message: `Invalid request method. Only ${allowedMethod} is allowed for this endpoint.`
    });
  }
  return next();
};

// Middleware to validate PATCH method for specific routes
export const validatePatchMethod = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'PATCH') {
    return res.status(200).json({
      status: 0,
      message: 'Method not allowed. Use PATCH for this endpoint.'
    });
  }
  return next();
};
import {
  createGame, 
  getGameRoom, 
  joinGame, 
  getGameLobby,
  getMyGames, 
  leaveGame,
  getQuestions,
  getGameSummary,
  getGameLeaderboard,
  finishGame,
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
router.route('/create')
  .post(protect, validateCreateGame, createGame)
  .all(methodNotAllowed);

/**
 * @route   POST /api/game/join
 * @desc    Join an existing game room
 * @access  Private
 */
router.route('/join')
  .post(protect, validateJoinGame, joinGame)
  .all(methodNotAllowed);

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
router.route('/lobby/:roomCode')
  .get(protect, getGameLobby)
  .all(methodNotAllowed);


// Add this route with other routes
/**
 * @route   POST /api/game/leave
 * @desc    Leave a game room
 * @access  Private
 */
router.route('/leave')
  .post(protect, leaveGame)
  .all(methodNotAllowed);

/**
 * @route   GET /api/game/questions/:roomCode
 * @desc    Get all questions for a game room
 * @access  Private
 */
router.route('/questions/:roomCode')
  .get(protect, getQuestions)
  .all(methodNotAllowed);


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
/**
 * @route   PATCH /api/game/finish/:roomCode
 * @desc    Finish a game and update player stats
 * @access  Private
 */

/**
 * @route   GET /api/game/my-games
 * @desc    Get all games created by the logged-in user
 * @access  Private
 */
router.get('/my-games', protect, getMyGames);

// Host-only routes
router.patch('/finish/:roomCode', validatePatchMethod, protect, isHost, finishGame);

/**
 * @route   PATCH /api/game/:roomCode/ready
 * @desc    Toggle player's ready status
 * @access  Private
 */
router.route('/:roomCode/ready')
  .patch(protect, (req: Request, res: Response, next: NextFunction) => {
    return toggleReadyStatus(req as any, res, next);
  })
  .all(methodNotAllowed);


/**
 * @route   POST /api/game/:roomCode/players/:playerId/kick
 * @desc    Kick a player from the game (Host only)
 * @access  Private
 */
router.route('/:roomCode/players/:playerId/kick')
  .post(protect, isHost, kickPlayer)
  .all((_req: Request, res: Response) => {
    res.status(200).json({
      status: 0,
      message: 'Method not allowed. Use POST for this endpoint.'
    });
  });

/**
 * @route   PATCH /api/game/settings/:roomCode
 * @desc    Update game settings
 * @access  Private (Host only)
 */
router.route('/settings/:roomCode')
  .patch(validatePatchMethod, protect, isHost, updateGameSettings)
  .all(methodNotAllowed);


/**
 * @route   GET /api/game/leaderboard/:roomCode
 * @desc    Get the leaderboard for a completed game
 * @access  Private
 */
router.get('/leaderboard/:roomCode', protect, getGameLeaderboard);

export default router;
