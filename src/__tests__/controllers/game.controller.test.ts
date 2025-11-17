import request from 'supertest';
import { Server } from 'http';
import mongoose from 'mongoose';
import {
initTestApp,
closeTestApp,
createTestUser,
getAuthToken,
clearTestData
} from '../../test/test-utils';
import { GameRoom } from '../../modules/games/models/gameRoom.model';
import { Deck } from '../../modules/games/models/deck.model';
import { Question } from '../../modules/games/models/question.model';

// ---- Mock the Mongoose Models ----
jest.mock('../../modules/games/models/deck.model');
jest.mock('../../modules/games/models/question.model');
jest.mock('../../modules/games/models/gameRoom.model');

const MockedDeck = Deck as jest.Mocked<typeof Deck>;
const MockedQuestion = Question as jest.Mocked<typeof Question>;
const MockedGameRoom = GameRoom as jest.Mocked<typeof GameRoom>;

// ---- Helper: Create mock query chain ----
const createMockQuery = (mockData: any) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(mockData),
  exec: jest.fn().mockResolvedValue(mockData),
  then: jest.fn().mockImplementation(function(resolve: (val: any) => any, reject?: (err: any) => any) {
    return Promise.resolve(mockData).then(resolve, reject);
  }),
});

// ---- Increase test timeout ----
jest.setTimeout(20000);

describe('Game Controller', () => {
let server: Server;
let authToken: string;
let testUser: any;

beforeAll(async () => {
const { server: testServer } = await initTestApp();
server = testServer;

testUser = await createTestUser({
  username: `gametestuser_${Date.now()}`,
  email: `gametest_${Date.now()}@example.com`
});

authToken = await getAuthToken(testUser);

const mockDeck = {
  _id: new mongoose.Types.ObjectId(),
  name: 'Test Deck',
  category: 'quran',
  difficulty: 'easy',
  status: 'active',
  questionCount: 2,
  gameId: new mongoose.Types.ObjectId()
};

const mockQuestion = {
  _id: new mongoose.Types.ObjectId(),
  text: 'Test Question 1',
  options: ['A', 'B', 'C', 'D'],
  correctAnswer: 0,
  explanation: 'Test explanation',
  source: 'Test source',
  difficulty: 'easy',
  deckId: new mongoose.Types.ObjectId(),
  category: 'quran'
};

MockedDeck.find.mockReturnValue(createMockQuery([mockDeck]) as any);
MockedQuestion.find.mockReturnValue(createMockQuery([mockQuestion]) as any);


});

afterAll(async () => {
await clearTestData();
await closeTestApp();
});

afterEach(async () => {
jest.clearAllMocks();
await GameRoom.deleteMany({});
});

// ---- CREATE GAME ----
describe('POST /api/game/create', () => {
it('should create a new game room with valid data', async () => {
  const mockSave = jest.fn().mockImplementation(function(this: any) {
    return Promise.resolve(this);
  });

  const mockGameRoom = {
    _id: new mongoose.Types.ObjectId(),
    roomCode: 'ABC123',
    hostId: testUser._id,
    players: [
      {
        userId: testUser._id,
        username: testUser.username,
        isHost: true,
        score: 0,
        _id: new mongoose.Types.ObjectId()
      }
    ],
    settings: {
      numberOfQuestions: 5,
      maximumPlayers: 4,
      categories: {
        quran: { enabled: true, difficulty: 'easy' },
        Salah: { enabled: true, difficulty: 'easy' },
        Fiqh: { enabled: true, difficulty: 'medium' },
        Prophets: { enabled: true, difficulty: 'hard' },
        Sawm: { enabled: true, difficulty: 'medium' }
      }
    },
    status: 'waiting',
    questions: [new mongoose.Types.ObjectId()],
    answeredQuestions: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    save: mockSave,
    populate: jest.fn().mockImplementation(function(this: any) { return Promise.resolve(this); }),
    toObject: function() {
      return {
        _id: this._id,
        roomCode: this.roomCode,
        hostId: this.hostId,
        status: this.status,
        players: this.players,
        settings: this.settings,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt
      };
    }
  };

  // Mock the GameRoom model to return our mock instance
  const mockGameRoomInstance = new GameRoom(mockGameRoom);
  jest.spyOn(GameRoom.prototype, 'save').mockResolvedValue(mockGameRoomInstance as any);
  jest.spyOn(GameRoom.prototype, 'toObject').mockReturnValue(mockGameRoom.toObject() as any);

  // Mock the findOne to return null (no existing game with this code)
  MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery(null) as any);

  const response = await request(server)
    .post('/api/game/create')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      categories: {
        quran: { enabled: true, difficulty: 'easy' },
        Salah: { enabled: true, difficulty: 'easy' },
        Fiqh: { enabled: true, difficulty: 'medium' },
        Prophets: { enabled: true, difficulty: 'hard' },
        Sawm: { enabled: true, difficulty: 'medium' }
      },
      numberOfQuestions: 5,
      maximumPlayers: 4
    })
    .expect(201);

  expect(response.status).toBe(201);
  expect(response.body).toHaveProperty('status', 'success');
  expect(response.body.data).toHaveProperty('roomCode', 'ABC123');
  expect(response.body.data.players).toHaveLength(1);
  expect(response.body.data.players[0].userId).toBe(testUser._id.toString());
  expect(response.body.data.settings.numberOfQuestions).toBe(5);
  expect(response.body.data.settings.maximumPlayers).toBe(4);
});

it('should return 400 if no categories are provided', async () => {
  const response = await request(server)
    .post('/api/game/create')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ categories: {} })
    .expect(400);

  expect(response.body.status).toBe('error');
  // Align with current validator message
  expect(response.body.message).toContain('At least one category must be enabled');
});


});

// ---- JOIN GAME ----
describe('POST /api/game/join', () => {
  let testGame: any;
  let newUser: any;
  let newUserToken: string;

  beforeEach(async () => {
    // Create a test game
    testGame = {
      _id: new mongoose.Types.ObjectId(),
      roomCode: 'TEST01',
      hostId: testUser._id,
      players: [
        {
          userId: testUser._id,
          username: testUser.username,
          isHost: true,
          score: 0,
          _id: new mongoose.Types.ObjectId()
        }
      ],
      settings: {
        categories: { quran: { enabled: true, difficulty: 'easy' } },
        numberOfQuestions: 5,
        maximumPlayers: 4
      },
      status: 'waiting',
      save: jest.fn().mockImplementation(function(this: any) {
        return Promise.resolve(this);
      }),
      toObject: function() {
        return {
          ...this,
          players: this.players.map((p: any) => ({
            ...p,
            userId: p.userId.toString(),
            _id: p._id.toString()
          }))
        };
      }
    };

    // Create a new user for testing join
    newUser = await createTestUser({
      username: `joingameuser_${Date.now()}`,
      email: `join_${Date.now()}@test.com`
    });
    newUserToken = await getAuthToken(newUser);

    // Mock the GameRoom model
    MockedGameRoom.findOne.mockImplementation((query: any) => {
      if (query.roomCode === 'TEST01') {
        return createMockQuery(testGame) as any;
      }
      return createMockQuery(null) as any;
    });
  });

  it('should allow a user to join an existing game', async () => {
    const response = await request(server)
      .post('/api/game/join')
      .set('Authorization', `Bearer ${newUserToken}`)
      .send({ roomCode: 'TEST01' })
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.data.roomCode).toBe('TEST01');
    expect(response.body.data.players).toHaveLength(2);
    expect(response.body.data.players[1].username).toBe(newUser.username);
  });

  it('should return 404 if game does not exist', async () => {
    const response = await request(server)
      .post('/api/game/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ roomCode: 'NONEXIST' })
      .expect(404);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toContain('Game room not found');
  });

  it('should return 400 if game is already in progress', async () => {
    // Update game status to 'in_progress'
    testGame.status = 'in_progress';
    
    const response = await request(server)
      .post('/api/game/join')
      .set('Authorization', `Bearer ${newUserToken}`)
      .send({ roomCode: 'TEST01' })
      .expect(400);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toContain('Game has already started');
  });

  it('should return 400 if game is full', async () => {
    // Fill up the game with players
    testGame.players = Array(4).fill(0).map((_, i) => ({
      userId: new mongoose.Types.ObjectId(),
      username: `player${i + 1}`,
      isHost: i === 0,
      score: 0,
      _id: new mongoose.Types.ObjectId()
    }));
    
    const response = await request(server)
      .post('/api/game/join')
      .set('Authorization', `Bearer ${newUserToken}`)
      .send({ roomCode: 'TEST01' })
      .expect(400);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toContain('Game is full');
  });


});

// ---- LOBBY ----
describe('GET /api/game/lobby/:roomCode', () => {
  let mockGameRoom: any;

  beforeEach(() => {
    mockGameRoom = {
      _id: new mongoose.Types.ObjectId(),
      roomCode: 'LOBBY01',
      hostId: testUser._id,
      players: [
        {
          userId: { _id: testUser._id, username: testUser.username },
          username: testUser.username,
          isHost: true,
          score: 0,
          _id: new mongoose.Types.ObjectId()
        }
      ],
      settings: {
        categories: {
          quran: { enabled: true, difficulty: 'easy' }
        },
        numberOfQuestions: 5,
        maximumPlayers: 4
      },
      status: 'waiting',
      questions: [new mongoose.Types.ObjectId()],
      answeredQuestions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      toObject: function() {
        return {
          ...this,
          _id: this._id.toString(),
          hostId: this.hostId.toString(),
          players: this.players.map((p: any) => ({
            ...p,
            userId: p.userId._id ? { _id: p.userId._id.toString(), username: p.userId.username } : p.userId.toString(),
            _id: p._id.toString()
          })),
          questions: this.questions.map((q: any) => q.toString())
        };
      }
    };

    // Mock the GameRoom model
    MockedGameRoom.findOne.mockImplementation((query: any) => {
      if (query.roomCode === 'LOBBY01') {
        return createMockQuery(mockGameRoom) as any;
      }
      return createMockQuery(null) as any;
    });
  });

  it('should return game lobby details', async () => {
    const response = await request(server)
      .get('/api/game/lobby/LOBBY01')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.status).toBe('success');
    expect(response.body.data.roomCode).toBe('LOBBY01');
    expect(response.body.data.gameStatus).toBe('waiting');
    expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
  });

  it('should return 404 if game room does not exist', async () => {
    MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery(null) as any);

    const response = await request(server)
      .get('/api/game/lobby/NONEXIST')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    expect(response.body.status).toBe('error');
    expect(response.body.message).toContain('Game room not found');
  });

  it('should include leaderboard and metadata in the response', async () => {
    const response = await request(server)
      .get('/api/game/lobby/LOBBY01')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.data).toHaveProperty('leaderboard');
    expect(response.body.data).toHaveProperty('currentQuestion');
    expect(response.body.data).toHaveProperty('totalQuestions');
  });


});

// ---- QUESTIONS ----
describe('GET /api/game/questions/:roomCode', () => {
it('should return questions for a game', async () => {
const mockQuestions = [
{
_id: new mongoose.Types.ObjectId(),
text: 'Test Question',
options: ['A', 'B', 'C', 'D'],
correctAnswer: 0,
explanation: 'Test',
source: 'Test',
difficulty: 'easy',
category: 'quran',
deckId: new mongoose.Types.ObjectId()
}
];

  const mockRoom = {
    roomCode: 'QUEST01',
    players: [ { userId: testUser._id } ],
    questions: mockQuestions.map((q) => ({ _id: q._id, text: q.text, options: q.options, difficulty: q.difficulty, category: q.category })),
    settings: { numberOfQuestions: 1 },
  };

  MockedGameRoom.findOne.mockReturnValue(createMockQuery(mockRoom) as any);
  MockedQuestion.find.mockReturnValue(createMockQuery(mockQuestions) as any);

  const response = await request(server)
    .get('/api/game/questions/QUEST01')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);

  expect(response.body.status).toBe('success');
  expect(response.body.data.questions).toHaveLength(1);
});


});

// ---- SUBMIT ANSWER ----
describe('POST /api/game/submit-answer', () => {
it('should accept a correct answer and update score', async () => {
const mockGame = {
_id: new mongoose.Types.ObjectId(),
roomCode: 'SUBMIT01',
hostId: testUser._id,
players: [
{
userId: testUser._id,
username: testUser.username,
isHost: true,
score: 0,
answeredQuestions: []
}
],
currentQuestion: 0,
questions: [new mongoose.Types.ObjectId()],
save: jest.fn().mockResolvedValue(true)
};

  MockedGameRoom.findOne.mockReturnValue(createMockQuery(mockGame) as any);
  (Question as any).findById = jest.fn().mockResolvedValue({
    _id: mockGame.questions[0],
    correctAnswer: 0,
    toObject() {
      return this;
    }
  });

  const response = await request(server)
    .post('/api/game/submit-answer')
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      roomCode: 'SUBMIT01',
      questionId: mockGame.questions[0],
      selectedOption: 0,
      timeTaken: 5
    })
    .expect(200);

  expect(response.body.status).toBe('success');
  expect(response.body.data.isCorrect).toBe(true);
});


});

// ---- LEADERBOARD ----
describe('GET /api/game/leaderboard/:roomCode', () => {
it('should return the game leaderboard', async () => {
const mockGame = {
roomCode: 'LEADER01',
status: 'finished',
players: [
{ userId: { _id: testUser._id, username: testUser.username }, score: 100 },
{ userId: { _id: new mongoose.Types.ObjectId(), username: 'player2' }, score: 80 }
],
answeredQuestions: [],
settings: { numberOfQuestions: 2 },
toObject() {
return this;
}
};

  MockedGameRoom.findOne.mockReturnValue(createMockQuery(mockGame) as any);

  const response = await request(server)
    .get('/api/game/leaderboard/LEADER01')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);

  expect(response.body.status).toBe('success');
  expect(Array.isArray(response.body.data.leaderboard)).toBe(true);
  expect(response.body.data.leaderboard).toHaveLength(2);
});

it('should return 404 if game not found', async () => {
  MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery(null) as any);

  const response = await request(server)
    .get('/api/game/leaderboard/NOTFOUND')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(404);

  expect(response.body.status).toBe('error');
  expect(response.body.message).toContain('Game room not found');
});


});

// ---- FINISH GAME ----
describe('PATCH /api/game/finish/:roomCode', () => {
it('should finish a game and update player stats', async () => {
const gameId = new mongoose.Types.ObjectId();

  const mockGame = {
    _id: gameId,
    roomCode: 'FINISH01',
    status: 'in_progress',
    players: [{ userId: testUser._id, username: 'testuser', score: 10, correctAnswers: 2 }],
    settings: {
      numberOfQuestions: 5,
      maximumPlayers: 4,
      categories: ['quran'],
      difficulty: 'easy'
    },
    currentQuestion: 4,
    questions: [new mongoose.Types.ObjectId()],
    startTime: new Date(),
    hostId: testUser._id,
    save: jest.fn().mockResolvedValue(true),
    toObject() {
      return { ...this, status: 'completed', endTime: new Date() };
    }
  };

  MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery(mockGame) as any);
  MockedGameRoom.findByIdAndUpdate.mockResolvedValueOnce({
    ...mockGame,
    status: 'completed',
    endTime: new Date()
  } as any);

  const response = await request(server)
    .patch('/api/game/finish/FINISH01')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);

  expect(response.body.status).toBe('success');
  expect(response.body.data.status).toBe('completed');
});

it('should return 404 if game not found', async () => {
  MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery(null) as any);

  const response = await request(server)
    .patch('/api/game/finish/NOTFOUND')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(404);

  expect(response.body.status).toBe('error');
  expect(response.body.message).toContain('Game not found');
});

it('should return 400 if game is already finished', async () => {
  MockedGameRoom.findOne.mockReturnValueOnce(createMockQuery({
    status: 'completed',
    toObject: () => ({ status: 'completed' })
  }) as any);

  const response = await request(server)
    .patch('/api/game/finish/ALREADYDONE')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(400);

  expect(response.body.status).toBe('error');
  expect(response.body.message).toContain('Game is already finished');
});


});
});