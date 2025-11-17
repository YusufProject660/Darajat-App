# 🔌 SOCKET.IO TESTING GUIDE - POSTMAN

## 📋 TABLE OF CONTENTS
1. [Prerequisites](#prerequisites)
2. [Postman Setup](#postman-setup)
3. [Authentication](#authentication)
4. [Connection Setup](#connection-setup)
5. [Event Testing](#event-testing)

---

## 🔧 PREREQUISITES

### Step 1: Get JWT Token
1. **Open Postman**
2. **Create New Request**: `POST /api/auth/login`
3. **URL**: `http://localhost:5000/api/auth/login` (ya apna server URL)
4. **Body** (raw JSON):
```json
{
  "email": "test@example.com",
  "password": "yourpassword"
}
```
5. **Send Request**
6. **Copy the token** from response:
```json
{
  "status": 1,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

## 📡 POSTMAN SETUP

### Step 1: Install Socket.IO Client (Postman doesn't support WebSocket directly)
**Option A: Use Postman WebSocket (if available)**
- Postman latest version mein WebSocket support hai
- New Request → WebSocket

**Option B: Use Browser Console (Recommended)**
- Chrome DevTools use karo
- Ya koi WebSocket client tool use karo

**Option C: Use Online Tool**
- https://amritb.github.io/socketio-client-tool/
- Ya https://socket.io/docs/v4/client-api/

---

## 🔐 AUTHENTICATION

### Socket Connection requires JWT Token

**Connection URL Format:**
```
ws://localhost:5000/ws/socket.io/?EIO=4&transport=websocket
```

**Authentication Methods:**
1. **Via Handshake Auth** (Recommended):
```javascript
const socket = io('http://localhost:5000/ws', {
  auth: {
    token: 'YOUR_JWT_TOKEN_HERE'
  },
  transports: ['websocket', 'polling']
});
```

2. **Via Authorization Header**:
```javascript
const socket = io('http://localhost:5000/ws', {
  extraHeaders: {
    Authorization: 'Bearer YOUR_JWT_TOKEN_HERE'
  },
  transports: ['websocket', 'polling']
});
```

---

## 🚀 CONNECTION SETUP

### Browser Console Method (Easiest)

1. **Open Browser Console** (F12)
2. **Load Socket.IO Client**:
```html
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
```

3. **Connect to Socket**:
```javascript
// Replace YOUR_JWT_TOKEN with actual token
const socket = io('http://localhost:5000/ws', {
  auth: {
    token: 'YOUR_JWT_TOKEN_HERE'
  },
  transports: ['websocket', 'polling'],
  path: '/ws/socket.io'
});

// Connection Events
socket.on('connect', () => {
  console.log('✅ Connected! Socket ID:', socket.id);
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection Error:', error);
});

socket.on('disconnect', (reason) => {
  console.log('👋 Disconnected:', reason);
});
```

---

## 📨 EVENT TESTING GUIDE

### ✅ EVENT 1: `room:join` (Client → Server)

**Purpose**: User ko room mein join karana

**Step-by-Step:**
1. **Socket connect karo** (upar wala code use karo)
2. **Event emit karo**:
```javascript
socket.emit('room:join', {
  roomCode: 'TEST123',
  playerName: 'TestPlayer',
  isHost: true  // true for creating room, false for joining
}, (response) => {
  console.log('Room Join Response:', response);
});
```

**Expected Response:**
```json
{
  "success": true,
  "room": {
    "roomCode": "TEST123",
    "status": "waiting",
    "players": [...],
    "hostId": "user_id_here"
  },
  "player": {
    "userId": "user_id_here",
    "username": "TestPlayer",
    "isHost": true,
    "score": 0
  }
}
```

**Server Events You'll Receive:**
- `player:joined` - Other players ko notify hoga

**Console Logs You'll See:**
```
═══════════════════════════════════════════════════════════
🎮 ROOM JOIN ATTEMPT
═══════════════════════════════════════════════════════════
Request ID: req-...
Room Code: TEST123
Player Name: TestPlayer
Is Host: true
User ID: ...
Username: ...
Socket ID: ...
═══════════════════════════════════════════════════════════
```

---

### ✅ EVENT 2: `answer:submit` (Client → Server)

**Purpose**: Question ka answer submit karna

**Prerequisites:**
- Room mein join hona chahiye
- Game start hona chahiye
- Question available hona chahiye

**Step-by-Step:**
1. **Pehle room join karo** (Event 1)
2. **Game start karo** (via API ya controller)
3. **Answer submit karo**:
```javascript
socket.emit('answer:submit', {
  questionId: 'question_id_here',
  answer: 'A'  // ya jo bhi answer format hai
}, (response) => {
  console.log('Answer Submit Response:', response);
});
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "correct": true,
    "score": 10
  }
}
```

**Server Events You'll Receive:**
- `question:answered` - Sab players ko notify hoga

**Console Logs You'll See:**
```
📢 Broadcasting question:answered event
```

---

### ✅ EVENT 3: `disconnect` (Client → Server)

**Purpose**: Socket disconnect karna

**Step-by-Step:**
```javascript
socket.disconnect();
```

**Server Events:**
- `player:disconnected` - Other players ko notify hoga

**Console Logs You'll See:**
```
👋 Client disconnected
Socket ID: ...
Room Code: ...
Player ID: ...
```

---

## 📥 SERVER EVENTS (Listen Karo)

### Event 1: `player:joined`
**When**: Jab koi naya player room mein join kare

**Listen:**
```javascript
socket.on('player:joined', (data) => {
  console.log('👤 New Player Joined:', data);
  // data.player - new player info
  // data.players - all players in room
});
```

**Expected Data:**
```json
{
  "player": {
    "id": "user_id",
    "userId": "user_id",
    "username": "PlayerName",
    "avatar": "avatar_url",
    "score": 0,
    "isHost": false
  },
  "players": [
    {
      "id": "user_id_1",
      "username": "Player1",
      "score": 0,
      "isHost": true
    },
    {
      "id": "user_id_2",
      "username": "Player2",
      "score": 0,
      "isHost": false
    }
  ]
}
```

---

### Event 2: `question:answered`
**When**: Jab koi player answer submit kare

**Listen:**
```javascript
socket.on('question:answered', (data) => {
  console.log('✅ Answer Submitted:', data);
  // data.playerId - who answered
  // data.isCorrect - correct ya nahi
  // data.score - points earned
});
```

**Expected Data:**
```json
{
  "playerId": "user_id",
  "isCorrect": true,
  "score": 10
}
```

---

### Event 3: `player:disconnected`
**When**: Jab koi player disconnect ho

**Listen:**
```javascript
socket.on('player:disconnected', (data) => {
  console.log('👋 Player Disconnected:', data);
  // data.playerId - who disconnected
  // data.reason - reason for disconnect
});
```

**Expected Data:**
```json
{
  "playerId": "user_id",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "reason": "connection_lost"
}
```

---

### Event 4: `error:general`
**When**: General error aaye

**Listen:**
```javascript
socket.on('error:general', (data) => {
  console.error('❌ Error:', data);
  // data.code - error code
  // data.message - error message
});
```

**Expected Data:**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Room code and player name are required"
}
```

---

### Event 5: `error:game`
**When**: Game-related error aaye

**Listen:**
```javascript
socket.on('error:game', (data) => {
  console.error('🎮 Game Error:', data);
  // data.code - error code
  // data.message - error message
  // data.recoverable - can recover or not
});
```

**Expected Data:**
```json
{
  "code": "SOCKET_ERROR",
  "message": "Error in answer:submit: ...",
  "recoverable": true
}
```

---

## 🧪 COMPLETE TESTING SCRIPT

### Full Test Script (Copy-Paste Ready)

```javascript
// ============================================
// STEP 1: Load Socket.IO (Browser Console)
// ============================================
// Pehle ye script tag add karo ya CDN se load karo
// <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

// ============================================
// STEP 2: Get JWT Token (Postman se)
// ============================================
// POST http://localhost:5000/api/auth/login
// Body: { "email": "test@example.com", "password": "password" }
// Response se token copy karo

// ============================================
// STEP 3: Connect Socket
// ============================================
const JWT_TOKEN = 'YOUR_TOKEN_HERE'; // Postman se copy karo

const socket = io('http://localhost:5000/ws', {
  auth: {
    token: JWT_TOKEN
  },
  transports: ['websocket', 'polling'],
  path: '/ws/socket.io'
});

// ============================================
// STEP 4: Setup Event Listeners
// ============================================

// Connection Events
socket.on('connect', () => {
  console.log('✅ CONNECTED! Socket ID:', socket.id);
  console.log('📡 Ready to send events!');
});

socket.on('connect_error', (error) => {
  console.error('❌ Connection Error:', error.message);
});

socket.on('disconnect', (reason) => {
  console.log('👋 Disconnected:', reason);
});

// Server Events
socket.on('player:joined', (data) => {
  console.log('👤 PLAYER JOINED:', data);
});

socket.on('question:answered', (data) => {
  console.log('✅ ANSWER SUBMITTED:', data);
});

socket.on('player:disconnected', (data) => {
  console.log('👋 PLAYER DISCONNECTED:', data);
});

socket.on('error:general', (data) => {
  console.error('❌ GENERAL ERROR:', data);
});

socket.on('error:game', (data) => {
  console.error('🎮 GAME ERROR:', data);
});

// ============================================
// STEP 5: Test Events
// ============================================

// Test 1: Join Room (Create New Room)
function testJoinRoomAsHost() {
  console.log('🧪 Testing: Join Room as Host');
  socket.emit('room:join', {
    roomCode: 'TEST' + Date.now(),
    playerName: 'TestHost',
    isHost: true
  }, (response) => {
    console.log('📥 Room Join Response:', response);
    if (response.success) {
      console.log('✅ Room created successfully!');
      window.roomCode = response.room.roomCode; // Store for later
    }
  });
}

// Test 2: Join Room (Join Existing Room)
function testJoinRoomAsPlayer() {
  console.log('🧪 Testing: Join Room as Player');
  const roomCode = window.roomCode || 'TEST123';
  socket.emit('room:join', {
    roomCode: roomCode,
    playerName: 'TestPlayer',
    isHost: false
  }, (response) => {
    console.log('📥 Room Join Response:', response);
  });
}

// Test 3: Submit Answer
function testSubmitAnswer() {
  console.log('🧪 Testing: Submit Answer');
  socket.emit('answer:submit', {
    questionId: 'test_question_id',
    answer: 'A'
  }, (response) => {
    console.log('📥 Answer Submit Response:', response);
  });
}

// Test 4: Disconnect
function testDisconnect() {
  console.log('🧪 Testing: Disconnect');
  socket.disconnect();
}

// ============================================
// STEP 6: Run Tests
// ============================================
// Browser console mein ye functions call karo:

// testJoinRoomAsHost();      // Room create karo
// testJoinRoomAsPlayer();    // Room join karo
// testSubmitAnswer();        // Answer submit karo
// testDisconnect();           // Disconnect karo
```

---

## 📊 TESTING CHECKLIST

### Connection Tests
- [ ] Socket connect ho raha hai
- [ ] JWT token authenticate ho raha hai
- [ ] Connection error handle ho raha hai
- [ ] Disconnect properly ho raha hai

### Room Events
- [ ] `room:join` (as host) - Room create ho raha hai
- [ ] `room:join` (as player) - Room join ho raha hai
- [ ] `player:joined` event receive ho raha hai
- [ ] Multiple players join kar sakte hain

### Game Events
- [ ] `answer:submit` - Answer submit ho raha hai
- [ ] `question:answered` event receive ho raha hai
- [ ] Score update ho raha hai

### Error Handling
- [ ] Invalid room code - Error aata hai
- [ ] Missing data - Validation error aata hai
- [ ] `error:general` event receive hota hai
- [ ] `error:game` event receive hota hai

---

## 🔍 DEBUGGING TIPS

### Issue 1: Connection Failed
**Check:**
- Server running hai?
- URL sahi hai? (`http://localhost:5000/ws`)
- Path sahi hai? (`/ws/socket.io`)
- CORS issue toh nahi?

### Issue 2: Authentication Failed
**Check:**
- JWT token valid hai?
- Token expire toh nahi hua?
- Token format sahi hai? (`Bearer token` ya direct `token`)

### Issue 3: Events Not Working
**Check:**
- Socket connected hai? (`socket.connected` check karo)
- Event name exact match karta hai?
- Data format sahi hai?
- Server console logs check karo

### Issue 4: No Response from Server
**Check:**
- Callback function provide kiya?
- Server event listeners setup hain?
- Network tab mein WebSocket connection check karo

---

## 📝 NOTES

1. **Postman WebSocket Support**: Latest Postman version mein WebSocket support hai, but Socket.IO specific testing ke liye browser console better hai

2. **Multiple Connections**: Ek hi browser mein multiple tabs open karke multiple players test kar sakte ho

3. **Token Expiry**: JWT token expire ho sakta hai, naya token generate karo

4. **Room Codes**: Unique room codes use karo testing ke liye

5. **Server Logs**: Server console mein detailed logs dikhenge jo debugging mein help karenge

---

## 🎯 QUICK START COMMANDS

### Browser Console (Copy-Paste)

```javascript
// 1. Connect
const socket = io('http://localhost:5000/ws', {
  auth: { token: 'YOUR_TOKEN' },
  transports: ['websocket', 'polling'],
  path: '/ws/socket.io'
});

// 2. Listen
socket.on('connect', () => console.log('✅ Connected:', socket.id));
socket.on('player:joined', (d) => console.log('👤 Player:', d));
socket.on('error:general', (d) => console.error('❌ Error:', d));

// 3. Join Room
socket.emit('room:join', {
  roomCode: 'TEST123',
  playerName: 'Player1',
  isHost: true
}, (r) => console.log('Response:', r));
```

---

## ✅ SUCCESS INDICATORS

### Connection Success:
- Console mein "✅ CONNECTED!" dikhega
- Socket ID print hoga
- Server console mein "🆕 NEW USER CONNECTED" dikhega

### Room Join Success:
- Response mein `success: true` hoga
- Room data milega
- Server console mein "✅ PLAYER JOINED ROOM SUCCESSFULLY" dikhega

### Answer Submit Success:
- Response mein `success: true` hoga
- Score data milega
- Server console mein "📢 Broadcasting question:answered" dikhega

---

**🎉 Testing Complete! Ab sab events test kar sakte ho!**

