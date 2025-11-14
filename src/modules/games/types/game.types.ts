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
  question: string;
  options: string[];
  correctAnswer: number;
  timeLimit: number; // in seconds
  category?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  explanation?: string;
  source?: string;
  deckId?: string;
  deck?: string;
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
  // Room Events
  'room:join': (data: { roomCode: string; playerName: string; isHost?: boolean }, callback?: (response: { success: boolean; room?: any; player?: any; error?: string }) => void) => void;
  'room:leave': () => void;
  
  // Game Events
  'game:start': () => void;
  'game:end': () => void;
  'game:pause': () => void;
  'game:resume': () => void;
  
  // Player Actions
  'player:ready': (data: { isReady: boolean }) => void;
  'answer:submit': (data: { answer: string }) => void;
  'question:next': () => void;
  
  // Chat
  'chat:send': (data: { message: string }) => void;
  
  // System
  'disconnect': () => void;
}

export interface ServerEvents {
  // Room Events
  'room:joined': (data: { room: GameRoom; player: Player }) => void;
  'room:updated': (data: { room: GameRoom }) => void;
  'room:left': () => void;
  
  // Player Events
  'player:joined': (data: { player: Player; players: Player[] }) => void;
  'player:left': (data: { playerId: string; players: Player[]; newHostId?: string }) => void;
  'player:disconnected': (data: { playerId: string; reason?: string }) => void;
  'player:ready': (data: { playerId: string; isReady: boolean }) => void;
  
  // Game Events
  'game:started': (data: { firstQuestion: Question; timeLimit: number }) => void;
  'game:ended': (data: { 
    leaderboard: Array<{ 
      id: string; 
      name: string; 
      score: number; 
      isHost: boolean;
    }>;
    totalQuestions: number;
    players: Array<{
      id: string;
      username: string;
      score: number;
      isHost: boolean;
    }>;
  }) => void;
  'game:paused': () => void;
  'game:resumed': () => void;
  
  // Question Events
  'question:new': (data: { 
    question: Question; 
    questionIndex: number; 
    totalQuestions: number;
    timeLimit: number;
  }) => void;
  'question:timeout': () => void;
  'question:answered': (data: { 
    playerId: string;
    isCorrect: boolean; 
    correctAnswer: string; 
    score: number;
  }) => void;
  
  // Leaderboard Events
  'leaderboard:updated': (data: { 
    leaderboard: Array<{ 
      id: string; 
      name: string; 
      score: number;
      isHost: boolean;
    }> 
  }) => void;
  
  // Chat Events
  'chat:message': (data: { 
    sender: string; 
    message: string; 
    timestamp: string;
    playerId: string;
  }) => void;
  
  // Error Events
  'error:general': (data: { 
    code: string;
    message: string;
    details?: any;
  }) => void;
  
  'error:validation': (data: {
    field: string;
    message: string;
    code: string;
  }) => void;
  
  'error:game': (data: {
    code: string;
    message: string;
    recoverable: boolean;
  }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketUser {
  id: string;
  username: string;
  avatar?: string;
  isHost?: boolean;
}

export interface SocketData {
  playerId: string;
  roomCode: string;
  user: SocketUser;
  socketId?: string;
  joinedAt?: number;
}
