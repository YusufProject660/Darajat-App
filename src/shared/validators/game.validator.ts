import Joi from 'joi';
import { IGameRoom, IPlayer } from '../types/game.types';

export const playerSchema = Joi.object<IPlayer>({
  userId: Joi.alternatives().try(
    Joi.string().required(),
    Joi.object().required()
  ),
  username: Joi.string().required(),
  avatar: Joi.string().optional(),
  score: Joi.number().default(0),
  isHost: Joi.boolean().default(false),
  isReady: Joi.boolean().default(false)
});

export const gameRoomSchema = Joi.object<IGameRoom>({
  roomCode: Joi.string().required(),
  hostId: Joi.alternatives().try(
    Joi.string().required(),
    Joi.object().required()
  ),
  players: Joi.array().items(playerSchema).default([]),
  status: Joi.string().valid('waiting', 'active', 'completed', 'finished').default('waiting'),
  settings: Joi.object({
    numberOfQuestions: Joi.number().min(1).max(10).default(10),
    maximumPlayers: Joi.number().min(1).default(4),
    categories: Joi.object().pattern(
      Joi.string(),
      Joi.object({
        enabled: Joi.boolean().default(false),
        difficulty: Joi.string().valid('easy', 'medium', 'hard').default('medium')
      })
    )
  }),
  currentQuestion: Joi.number().min(0).optional(),
  answeredQuestions: Joi.array().items(Joi.object()).default([]),
  finishedAt: Joi.date().optional()
});

export const validatePlayer = (player: IPlayer) => {
  return playerSchema.validate(player, { abortEarly: false });
};

export const validateGameRoom = (room: Partial<IGameRoom>) => {
  return gameRoomSchema.validate(room, { abortEarly: false });
};
