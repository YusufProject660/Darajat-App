export interface Player {
  id: string;
  userId: string;
  username: string;
  avatar?: string;
  score: number;
  isHost: boolean;
  isReady?: boolean;
  socketId?: string;
  currentAnswer?: string;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  timeLimit: number; // in seconds
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface GameRoom {
  id: string;
  roomCode: string;
  hostId: string;
  players: Player[];
  questions: Question[];
  status: 'waiting' | 'active' | 'finished';
  currentQuestionIndex: number;
  settings: {
    numberOfQuestions: number;
    maximumPlayers: number;
    categories: {
      [key: string]: {
        enabled: boolean;
        difficulty: 'easy' | 'medium' | 'hard';
      };
    };
  };
  answeredQuestions: Array<{
    playerId: string;
    questionId: string;
    selectedOption: string;
    isCorrect: boolean;
    timeTaken: number;
  }>;
  results: Array<{
    userId: string;
    correctAnswers: number;
    totalTime: number;
  }>;
  startTime?: number;
  endTime?: number;
  createdAt: number;
  updatedAt: number;
}

export interface GameState {
  status: GameRoom['status'];
  players: Player[];
  currentQuestion?: Question;
  questionIndex?: number;
  totalQuestions?: number;
  timeRemaining?: number;
  leaderboard?: Array<{ id: string; name: string; score: number }>;
  settings?: GameRoom['settings'];
}

// WebSocket event types
export interface ClientEvents {
  // Client to Server
  'join_room': (data: { roomCode: string; playerName: string; isHost?: boolean }, callback?: (response: { success: boolean; room?: any; player?: any; error?: string }) => void) => void;
  'start_game': () => void;
  'submit_answer': (data: { answer: string }) => void;
  'next_question': () => void;
  'end_game': () => void;
  'player_ready': (data: { isReady: boolean }) => void;
  'disconnect': () => void;
  'send_message': (data: { message: string }) => void;
}

export interface ServerEvents {
  // Server to Client
  'room_joined': (data: { room: GameRoom; player: Player }) => void;
  'player_joined': (data: { players: Player[] }) => void;
  'player_left': (data: { playerId: string; players: Player[] }) => void;
  'game_started': (data: { firstQuestion: Question; timeLimit: number }) => void;
  'new_question': (data: { question: Question; questionIndex: number; totalQuestions: number }) => void;
  'time_update': (data: { timeRemaining: number }) => void;
  'answer_result': (data: { isCorrect: boolean; correctAnswer: string; score: number }) => void;
  'leaderboard_update': (data: { leaderboard: Array<{ id: string; name: string; score: number }> }) => void;
  'game_ended': (data: { leaderboard: Array<{ id: string; name: string; score: number }> }) => void;
  'error': (data: { message: string }) => void;
  'chat_message': (data: { sender: string; message: string; timestamp: string }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId: string;
  roomCode: string;
}
