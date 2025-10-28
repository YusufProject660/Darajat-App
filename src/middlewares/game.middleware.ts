import { Request, Response, NextFunction } from 'express';
import { GameRoom } from '../modules/games/models/gameRoom.model';
import { AppError } from '../utils/appError';

export const isHost = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return next(new AppError('Authentication required', 401));
    }
    
    const game = await GameRoom.findOne({ roomCode });
    if (!game) {
      return next(new AppError('Game not found', 404));
    }
    
    if (game.hostId.toString() !== userId.toString()) {
      return next(new AppError('Only the host can perform this action', 403));
    }
    
    // Attach game to request for use in controllers
    (req as any).game = game;
    next();
  } catch (error) {
    next(error);
  }
};

export const isGameInLobby = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { roomCode } = req.params;
    const game = await GameRoom.findOne({ roomCode });
    
    if (!game) {
      return next(new AppError('Game not found', 404));
    }
    
    if (game.status !== 'waiting') {
      return next(new AppError('Game has already started', 400));
    }
    
    (req as any).game = game;
    next();
  } catch (error) {
    next(error);
  }
};
