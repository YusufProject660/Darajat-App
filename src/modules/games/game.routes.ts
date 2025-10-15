import express from 'express';
import { protect } from '../../middlewares/auth.middleware';
import { validateCreateGame } from './validations/game.validations';
import { createGame, getGameRoom } from './game.controller';

const router = express.Router();

/**
 * @route   POST /api/game/create
 * @desc    Create a new game room
 * @access  Private
 */
router.post('/create', protect, validateCreateGame, createGame);

/**
 * @route   GET /api/game/room/:code
 * @desc    Get game room details by code
 * @access  Private
 */
router.get('/room/:code', protect, getGameRoom);

export default router;
