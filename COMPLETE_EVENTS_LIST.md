# 📡 COMPLETE SOCKET EVENTS LIST

## 🔴 CLIENT → SERVER EVENTS (Emit Karo)

### 1. `room:join`
**Location**: `socket.handler.ts:357`
**Purpose**: Room create karna ya join karna
**Data**:
```javascript
{
  roomCode: string,      // Required: Room code
  playerName: string,    // Required: Player name
  isHost?: boolean       // Optional: true = create room, false = join room
}
```
**Callback Response**:
```javascript
{
  success: boolean,
  room?: {
    roomCode: string,
    status: string,
    players: Array,
    hostId: string
  },
  player?: {
    userId: string,
    username: string,
    isHost: boolean,
    score: number
  },
  error?: string
}
```
**Test**:
```javascript
socket.emit('room:join', {
  roomCode: 'TEST123',
  playerName: 'Player1',
  isHost: true
}, (response) => {
  console.log('Response:', response);
});
```

---

### 2. `answer:submit`
**Location**: `socket.handler.ts:362`
**Purpose**: Question ka answer submit karna
**Data**:
```javascript
{
  questionId: string,    // Required: Question ID
  answer: any           // Required: Answer (string, number, etc.)
}
```
**Callback Response**:
```javascript
{
  success: boolean,
  data?: {
    correct: boolean,
    score: number
  },
  error?: string
}
```
**Test**:
```javascript
socket.emit('answer:submit', {
  questionId: 'question_id_here',
  answer: 'A'
}, (response) => {
  console.log('Response:', response);
});
```

---

### 3. `disconnect`
**Location**: `socket.handler.ts:367`
**Purpose**: Socket disconnect karna
**Data**: None
**Test**:
```javascript
socket.disconnect();
```

---

## 🟢 SERVER → CLIENT EVENTS (Listen Karo)

### 1. `player:joined`
**Location**: `socket.handler.ts:175`, `game.service.ts:367`
**When**: Jab koi naya player room mein join kare
**Data**:
```javascript
{
  player: {
    id: string,
    userId: string,
    username: string,
    avatar?: string,
    score: number,
    isHost: boolean
  },
  players: Array<{
    id: string,
    userId: string,
    username: string,
    avatar?: string,
    score: number,
    isHost: boolean
  }>
}
```
**Listen**:
```javascript
socket.on('player:joined', (data) => {
  console.log('New player:', data.player);
  console.log('All players:', data.players);
});
```

---

### 2. `question:answered`
**Location**: `socket.handler.ts:252`, `game.controller.ts:1108`
**When**: Jab koi player answer submit kare
**Data**:
```javascript
{
  playerId: string,
  isCorrect: boolean,
  score: number
}
```
**Listen**:
```javascript
socket.on('question:answered', (data) => {
  console.log('Player answered:', data.playerId);
  console.log('Correct:', data.isCorrect);
  console.log('Score:', data.score);
});
```

---

### 3. `player:disconnected`
**Location**: `socket.handler.ts:305`, `game.service.ts:636`
**When**: Jab koi player disconnect ho
**Data**:
```javascript
{
  playerId: string,
  timestamp?: string,
  reason?: string
}
```
**Listen**:
```javascript
socket.on('player:disconnected', (data) => {
  console.log('Player disconnected:', data.playerId);
  console.log('Reason:', data.reason);
});
```

---

### 4. `game:started`
**Location**: `game.controller.ts:1243`
**When**: Jab game start ho
**Data**:
```javascript
{
  firstQuestion: {
    _id: string,
    question: string,
    options: Array,
    category: string,
    difficulty: string
  },
  timeLimit: number,
  totalQuestions: number
}
```
**Listen**:
```javascript
socket.on('game:started', (data) => {
  console.log('Game started!');
  console.log('First question:', data.firstQuestion);
  console.log('Time limit:', data.timeLimit);
});
```

---

### 5. `question:new`
**Location**: `game.controller.ts:1131`
**When**: Jab naya question aaye
**Data**:
```javascript
{
  question: {
    _id: string,
    question: string,
    options: Array,
    category: string,
    difficulty: string
  },
  questionIndex: number,
  totalQuestions: number,
  timeLimit: number
}
```
**Listen**:
```javascript
socket.on('question:new', (data) => {
  console.log('New question:', data.question);
  console.log('Question', data.questionIndex, 'of', data.totalQuestions);
});
```

---

### 6. `game:ended`
**Location**: `game.controller.ts:1150`
**When**: Jab game end ho
**Data**:
```javascript
{
  leaderboard: Array<{
    id: string,
    name: string,
    score: number,
    isHost: boolean
  }>,
  totalQuestions: number,
  players: Array<{
    id: string,
    username: string,
    score: number,
    isHost: boolean
  }>
}
```
**Listen**:
```javascript
socket.on('game:ended', (data) => {
  console.log('Game ended!');
  console.log('Leaderboard:', data.leaderboard);
});
```

---

### 7. `player:left`
**Location**: `game.controller.ts:1302`
**When**: Jab koi player room se leave kare
**Data**:
```javascript
{
  playerId: string
}
```
**Listen**:
```javascript
socket.on('player:left', (data) => {
  console.log('Player left:', data.playerId);
});
```

---

### 8. `player:ready`
**Location**: `game.controller.ts:1649`, `game.service.ts:435`
**When**: Jab player ready ho jaye
**Data**:
```javascript
{
  playerId: string,
  isReady: boolean
}
```
**Listen**:
```javascript
socket.on('player:ready', (data) => {
  console.log('Player ready:', data.playerId, data.isReady);
});
```

---

### 9. `settingsUpdated`
**Location**: `game.controller.ts:1423`
**When**: Jab room settings update ho
**Data**: (Check controller for exact format)
**Listen**:
```javascript
socket.on('settingsUpdated', (data) => {
  console.log('Settings updated:', data);
});
```

---

### 10. `error:general`
**Location**: `socket.handler.ts:112`
**When**: General error aaye
**Data**:
```javascript
{
  code: string,
  message: string,
  details?: any
}
```
**Listen**:
```javascript
socket.on('error:general', (data) => {
  console.error('Error:', data.code, data.message);
});
```

---

### 11. `error:game`
**Location**: `socket.handler.ts:270`, `game.service.ts:659`
**When**: Game-related error aaye
**Data**:
```javascript
{
  code: string,
  message: string,
  recoverable: boolean
}
```
**Listen**:
```javascript
socket.on('error:game', (data) => {
  console.error('Game error:', data.code, data.message);
  console.log('Recoverable:', data.recoverable);
});
```

---

## 📊 EVENT FLOW DIAGRAM

```
CLIENT                          SERVER
  |                               |
  |--- room:join ---------------->|
  |                               |-- Authenticate
  |                               |-- Create/Join Room
  |                               |-- Emit: player:joined
  |<-- player:joined -------------|
  |                               |
  |--- answer:submit ------------>|
  |                               |-- Process Answer
  |                               |-- Emit: question:answered
  |<-- question:answered ---------|
  |                               |
  |--- disconnect ---------------->|
  |                               |-- Cleanup
  |                               |-- Emit: player:disconnected
  |<-- player:disconnected -------|
```

---

## 🧪 COMPLETE TEST SCRIPT

```javascript
// ============================================
// SETUP
// ============================================
const socket = io('http://localhost:5000/ws', {
  auth: { token: 'YOUR_JWT_TOKEN' },
  transports: ['websocket', 'polling'],
  path: '/ws/socket.io'
});

// ============================================
// LISTEN TO ALL EVENTS
// ============================================
socket.on('connect', () => {
  console.log('✅ Connected:', socket.id);
});

socket.on('player:joined', (d) => console.log('👤 Player Joined:', d));
socket.on('question:answered', (d) => console.log('✅ Answer:', d));
socket.on('player:disconnected', (d) => console.log('👋 Disconnected:', d));
socket.on('game:started', (d) => console.log('🎮 Game Started:', d));
socket.on('question:new', (d) => console.log('❓ New Question:', d));
socket.on('game:ended', (d) => console.log('🏁 Game Ended:', d));
socket.on('player:left', (d) => console.log('👋 Player Left:', d));
socket.on('player:ready', (d) => console.log('✅ Player Ready:', d));
socket.on('settingsUpdated', (d) => console.log('⚙️ Settings Updated:', d));
socket.on('error:general', (d) => console.error('❌ Error:', d));
socket.on('error:game', (d) => console.error('🎮 Game Error:', d));

// ============================================
// TEST EVENTS
// ============================================

// 1. Join Room
socket.emit('room:join', {
  roomCode: 'TEST123',
  playerName: 'Player1',
  isHost: true
}, (r) => console.log('Room Join:', r));

// 2. Submit Answer
socket.emit('answer:submit', {
  questionId: 'q123',
  answer: 'A'
}, (r) => console.log('Answer Submit:', r));

// 3. Disconnect
socket.disconnect();
```

---

## ✅ TESTING CHECKLIST

### Connection
- [ ] Socket connects
- [ ] Authentication works
- [ ] Connection error handled

### Room Events
- [ ] `room:join` (host) - Creates room
- [ ] `room:join` (player) - Joins room
- [ ] `player:joined` - Received when player joins
- [ ] `player:left` - Received when player leaves
- [ ] `player:disconnected` - Received on disconnect

### Game Events
- [ ] `game:started` - Received when game starts
- [ ] `question:new` - Received for new question
- [ ] `answer:submit` - Submits answer
- [ ] `question:answered` - Received when answer submitted
- [ ] `game:ended` - Received when game ends

### Player Events
- [ ] `player:ready` - Received when player ready

### Error Events
- [ ] `error:general` - Received on general errors
- [ ] `error:game` - Received on game errors

---

**🎉 All events documented! Ab test kar sakte ho!**

