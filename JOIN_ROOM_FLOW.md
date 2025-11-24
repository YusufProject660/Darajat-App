# Join Room API - Complete Flow Documentation

## Overview
Complete flow documentation for join room API and related socket events.

---

## 1. HTTP API - Join Room

### Endpoint
```
POST /api/game/join
```

### Request
```json
{
  "roomCode": "ABC123"
}
```

### Response
```json
{
  "status": 1,
  "message": "Game joined successfully",
  "data": {
    "roomCode": "ABC123",
    "categories": {...},
    "numberOfQuestions": 10,
    "players": [
      {
        "userId": {
          "_id": "690487b541cb52d1e972ac79",
          "username": "test1201@example.com"
        },
        "username": "test1201@example.com",
        "avatar": "",
        "isHost": false,
        "is_me": false,
        "_id": "69202d57487942392ab93020"
      }
    ],
    "status": "waiting"
  }
}
```

**Backend Action:**
- Line 290: `gameService.joinRoom()` - Add player to DB
- Line 300: `io.to(roomCode).emit('player:joined', {...})` - Notify other players

---

## 2. Socket Events Flow

### Step 1: Socket Connection (If Not Connected)

**Frontend:**
```javascript
const socket = io('ws://localhost:3000', {
  auth: { token: 'jwt_token' }
});
```

**Backend:**
- `authenticateSocket()` middleware runs
- Verifies JWT, gets user from DB
- Attaches user to `socket.data`

---

### Step 2: Join Room via Socket

**Frontend Emit:**
```javascript
socket.emit('room:join', {
  roomCode: 'ABC123',
  playerName: 'John',
  isHost: false
}, (response) => {
  if (response.success) {
    console.log('Joined:', response.room);
  }
});
```

**Backend Listen:**
- Handler: `socket.on('room:join', ...)` (Line 514)
- Function: `handleJoinRoom()` (Line 109)
- Actions:
  1. Validate roomCode & playerName
  2. Join room in DB
  3. `socket.join(roomCode)`
  4. Create buffer (if receivers exist)
  5. Broadcast `player:joined` to others
  6. Callback with success

---

### Step 3: Other Players Receive Notification

**Backend Emit:**
```typescript
socket.to(roomCode).emit('player:joined', {
  player: { id, userId, username, avatar, score, isHost },
  players: [...],
  taskId: "uuid-123",  // If buffer created
  senderId: "user123"
});
```

**Frontend Listen:**
```javascript
socket.on('player:joined', (data) => {
  // Update players list
  updatePlayersList(data.players);
  
  // MUST Acknowledge if taskId exists
  if (data.taskId) {
    socket.emit('message:ack', { 
      taskId: data.taskId 
    }, (response) => {
      if (response.allAcknowledged) {
        console.log('All players received!');
      }
    });
  }
});
```

---

### Step 4: Acknowledgment Flow

**Frontend Emit:**
```javascript
socket.emit('message:ack', { 
  taskId: data.taskId 
}, (response) => {
  console.log('Acknowledged:', response.allAcknowledged);
});
```

**Backend Listen:**
- Handler: `socket.on('message:ack', ...)` (Line 524)
- Actions:
  1. Get receiverId from `socket.data.user.id`
  2. `bufferManager.acknowledgeMessage(taskId, receiverId)`
  3. Track acknowledgment in memory + DB
  4. Check: All acknowledged?
  5. If yes → `clearBuffer()`
  6. Return `{ success: true, allAcknowledged: true/false }`

**Backend Process:**
```typescript
// bufferManager.acknowledgeMessage()
1. Find buffer by taskId
2. Add receiverId to acknowledgedBy
3. Update DB
4. Check: acknowledgedBy.size === expectedReceivers.size?
5. If yes → clearBuffer() → Emit 'buffer:cleared'
```

---

### Step 5: Buffer Cleared Notification

**Backend Emit (to sender only):**
```typescript
senderSocket.emit('buffer:cleared', {
  taskId: "uuid-123",
  roomCode: "ABC123",
  eventName: "player:joined"
});
```

**Frontend Listen (sender only):**
```javascript
socket.on('buffer:cleared', (data) => {
  if (data.eventName === 'player:joined') {
    console.log('✅ All players received your join notification!');
  }
});
```

---

## 3. Complete Flow Diagram

```
[Frontend] POST /api/game/join
    ↓
[Backend] Process join (DB update)
    ↓
[Backend] Emit 'player:joined' (Socket)
    ↓
[Frontend] Listen 'player:joined'
    ↓
[Frontend] Update UI
    ↓
[Frontend] Emit 'message:ack' (if taskId exists)
    ↓
[Backend] Track acknowledgment
    ↓
[Backend] Check: All acknowledged?
    ├─ NO → Wait for more
    └─ YES → clearBuffer()
        ↓
[Backend] Emit 'buffer:cleared' (to sender)
    ↓
[Frontend] Listen 'buffer:cleared' (sender only)
    ↓
✅ Complete
```

---

## 4. Event Summary

### Frontend Events

| Event | Direction | When | Action |
|-------|-----------|------|--------|
| `room:join` | Emit | Join room | Send join request |
| `message:ack` | Emit | Receive message | Acknowledge receipt |
| `player:joined` | Listen | Player joins | Update UI + Acknowledge |
| `buffer:cleared` | Listen | All acknowledged | Show confirmation |
| `error:general` | Listen | Error occurs | Show error |
| `error:game` | Listen | Game error | Show error |

### Backend Events

| Event | Direction | When | Handler |
|-------|-----------|------|---------|
| `room:join` | Listen | Join request | `handleJoinRoom()` |
| `message:ack` | Listen | Acknowledgment | Direct handler |
| `player:joined` | Emit | Player joins | Broadcast to room |
| `buffer:cleared` | Emit | All acknowledged | Notify sender |
| `error:general` | Emit | Validation error | Error handler |
| `error:game` | Emit | Game error | Error handler |

---

## 5. Acknowledgment System

### When Buffer is Created
- Condition: Receivers exist (other players in room)
- Action: Generate UUID (taskId), store in memory + DB
- Broadcast: Include `taskId` in `player:joined` event

### When Buffer is NOT Created
- Condition: No receivers (first player)
- Action: Normal emit (no buffer tracking)

### Acknowledgment Process
1. Receiver gets `player:joined` with `taskId`
2. Receiver emits `message:ack` with `taskId`
3. Server tracks acknowledgment
4. When all acknowledged → Clear buffer
5. Sender gets `buffer:cleared` notification

---

## 6. Frontend Implementation

```javascript
// Setup socket
const socket = io('ws://localhost:3000', {
  auth: { token: 'jwt_token' }
});

// Listen for player joined
socket.on('player:joined', (data) => {
  updatePlayersList(data.players);
  
  // Acknowledge if taskId exists
  if (data.taskId) {
    socket.emit('message:ack', { taskId: data.taskId });
  }
});

// Listen for buffer cleared (sender only)
socket.on('buffer:cleared', (data) => {
  console.log('All players received!', data);
});

// Join room
socket.emit('room:join', {
  roomCode: 'ABC123',
  playerName: 'John'
}, (response) => {
  if (response.success) {
    console.log('Joined:', response.room);
  }
});
```

---

## 7. Backend Implementation

### Socket Handlers (socket.handler.ts)

**Line 514:** `socket.on('room:join', ...)` - Join room handler
**Line 524:** `socket.on('message:ack', ...)` - Acknowledgment handler
**Line 313/326:** `socket.to(roomCode).emit('player:joined', ...)` - Broadcast
**Line 132 (bufferManager):** `senderSocket.emit('buffer:cleared', ...)` - Notify sender

### HTTP API (game.controller.ts)

**Line 273:** `joinGame()` - Join room API
**Line 300:** `io.to(roomCode).emit('player:joined', ...)` - Socket broadcast

---

## 8. Key Points

1. **HTTP API** - Database update + Socket broadcast
2. **Socket Join** - Real-time room join with buffer tracking
3. **Acknowledgment** - Track who received message
4. **Buffer System** - UUID tracking, DB persistence
5. **Sender Notification** - Know when all received

---

## 9. Error Handling

### Frontend Errors
- `error:general` - Validation errors
- `error:game` - Game-specific errors

### Backend Errors
- Validation errors → `error:general`
- Game errors → `error:game`
- All errors logged in backend

---

## 10. Database Records

### Message Buffer (MongoDB)
```javascript
{
  taskId: "uuid-123",
  roomCode: "ABC123",
  senderId: "user123",
  eventName: "player:joined",
  expectedReceivers: ["user456", "user789"],
  acknowledgedBy: ["user456", "user789"],
  status: "cleared"
}
```

---

## End of Flow Documentation

