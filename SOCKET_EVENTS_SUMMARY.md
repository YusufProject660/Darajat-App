# 📊 Socket Events Summary - Darajat Game

## 🔢 Total Count

- **Frontend Emit (Client → Server):** 7 events (actively used)
- **Backend Emit (Server → Client):** 8 events (actively used)
- **Frontend Listen (Client receives):** 12 events
- **Backend Listen (Server receives):** 10 events

---

## 📤 FRONTEND EMIT (Client → Server)

### Actively Used Events (7):

1. **`room:join`** - Room join karta hai
   - Location: `socket.handler.ts:961`
   - Handler: `handleJoinRoom()`

2. **`room:leave`** - Room se leave karta hai
   - Location: `socket.handler.ts:966`
   - Handler: `handleLeaveRoom()`
   - Frontend: `player1.html`, `player2.html`, `player3.html`

3. **`room:kick`** - Host player ko kick karta hai
   - Location: `socket.handler.ts:971`
   - Handler: `handleKickPlayer()`
   - Frontend: `player1.html`, `player2.html`, `player3.html`

4. **`game:start`** - Host game start karta hai
   - Location: `socket.handler.ts:976`
   - Frontend: `player1.html`, `game-test.html`, `socket-test.html`

5. **`answer:submit`** - Player answer submit karta hai (timeout bhi isi se handle hota hai - `answer: null` se)
   - Location: `socket.handler.ts:1034`
   - Handler: `handleSubmitAnswer()`
   - Frontend: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`
   - Note: Timeout case me `answer: null` bhejte hain

6. **`question:leaderboard`** - Question leaderboard request karta hai
   - Location: `socket.handler.ts:1125`
   - Frontend: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

7. **`message:ack`** - Message acknowledgment (buffer system)
   - Location: `socket.handler.ts:1190`
   - Frontend: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

### Defined but Not Used:
- `game:end` - Not implemented
- `game:pause` - Not implemented
- `game:resume` - Not implemented
- `player:ready` - Not implemented
- `question:next` - Not implemented
- `chat:send` - Not implemented

---

## 📥 BACKEND EMIT (Server → Client)

### Actively Used Events (8):

1. **`player:joined`** - Jab koi player join karta hai
   - Location: `socket.handler.ts:339, 354`
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

2. **`player:left`** - Jab player leave karta hai
   - Location: `socket.handler.ts:700+` (in `handleLeaveRoom`)
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

3. **`player:removed`** - Jab player kick/disconnect hota hai
   - Location: `socket.handler.ts:700+` (in `handleKickPlayer`, `handleDisconnect`)
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `socket-test.html`

4. **`game:started`** - Game start hone par
   - Location: `socket.handler.ts:1022`
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

5. **`question:answered`** - Jab koi player answer submit karta hai
   - Location: `socket.handler.ts:526, 533, 1100, 1107`
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

6. **`all:answered`** - Jab sab players ne answer submit kar diya
   - Location: `socket.handler.ts:538, 1112`
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

7. **`question:leaderboard`** - Question leaderboard data
   - Location: `socket.handler.ts:1168, 1175`
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

8. **`game:ended`** - Game end hone par
   - Location: `game.service.ts` (via socket emit)
   - Frontend Listen: `player1.html`, `player2.html`, `player3.html`, `game-test.html`, `socket-test.html`

### Error Events:

9. **`error:general`** - General errors
   - Location: `socket.handler.ts:148`
   - Frontend Listen: `socket-test.html`

10. **`error:game`** - Game-specific errors
    - Location: `socket.handler.ts:555, 700, 858`, `game.service.ts:785`
    - Frontend Listen: `socket-test.html`

### Defined but Not Used:
- `room:joined` - Not used (HTTP API handles this)
- `room:updated` - Not implemented
- `room:left` - Not used
- `player:disconnected` - Not used (using `player:removed` instead)
- `player:ready` - Not implemented
- `game:paused` - Not implemented
- `game:resumed` - Not implemented
- `question:new` - Not used (frontend fetches via HTTP API)
- `question:timeout` - Not used
- `leaderboard:updated` - Not implemented
- `chat:message` - Not implemented
- `error:validation` - Not used
- `buffer:cleared` - Used but not in types (for buffer acknowledgment)

---

## 👂 FRONTEND LISTEN (Client receives from Server)

### System Events (3):
1. **`connect`** - Socket connection established
2. **`connect_error`** - Connection error
3. **`disconnect`** - Socket disconnected

### Game Events (9):
4. **`player:joined`** - New player joined room
5. **`player:left`** - Player left room
6. **`player:removed`** - Player removed/kicked
7. **`player:ready`** - Player ready status changed
8. **`game:started`** - Game started
9. **`question:answered`** - Player answered question
10. **`all:answered`** - All players answered
11. **`question:leaderboard`** - Question leaderboard received
12. **`game:ended`** - Game ended

### Error Events (3):
13. **`error`** - General socket error
14. **`error:general`** - General application error
15. **`error:game`** - Game-specific error

**Total Frontend Listen: 15 events**

---

## 👂 BACKEND LISTEN (Server receives from Client)

### System Events (2):
1. **`connection`** (io.on) - New socket connection
2. **`disconnect`** - Client disconnected
3. **`error`** - Socket error

### Game Events (7):
4. **`room:join`** - Client wants to join room
5. **`room:leave`** - Client wants to leave room
6. **`room:kick`** - Host wants to kick player
7. **`game:start`** - Host wants to start game
8. **`answer:submit`** - Client submitting answer (timeout bhi isi se - `answer: null`)
9. **`question:leaderboard`** - Request for question leaderboard
10. **`message:ack`** - Message acknowledgment (buffer system)

**Total Backend Listen: 10 events**

---

## 📋 Event Flow Summary

### Room Management Flow:
```
Frontend: room:join → Backend: Listen → Backend: Emit player:joined → Frontend: Listen
Frontend: room:leave → Backend: Listen → Backend: Emit player:left → Frontend: Listen
Frontend: room:kick → Backend: Listen → Backend: Emit player:removed → Frontend: Listen
```

### Game Flow:
```
Frontend: game:start → Backend: Listen → Backend: Emit game:started → Frontend: Listen
Frontend: answer:submit → Backend: Listen → Backend: Emit question:answered → Frontend: Listen
Backend: Emit all:answered → Frontend: Listen
Frontend: question:leaderboard → Backend: Listen → Backend: Emit question:leaderboard → Frontend: Listen
Backend: Emit game:ended → Frontend: Listen
```

### Buffer/Acknowledgment Flow:
```
Backend: Emit player:joined (with taskId) → Frontend: Listen
Frontend: message:ack → Backend: Listen
Backend: Emit buffer:cleared → Frontend: Listen (sender only)
```

---

## 🎯 Key Points

1. **Frontend se Backend:** 7 events actively use ho rahe hain
2. **Backend se Frontend:** 8 events actively emit ho rahe hain
3. **Frontend Listen:** 15 events (3 system + 9 game + 3 error)
4. **Backend Listen:** 11 events (2 system + 8 game + 1 error)

5. **Buffer System:** `message:ack` aur `buffer:cleared` events buffer acknowledgment ke liye use ho rahe hain

6. **HTTP API Integration:** Room join/create HTTP API se hota hai, phir socket events se real-time updates aate hain

7. **Not Implemented:** Chat, pause/resume, ready check, etc. - future features ke liye defined hain but use nahi ho rahe

---

## 📝 Notes

- System events (`connect`, `disconnect`, `error`) automatically handle hote hain
- Most game logic HTTP API se handle hota hai, socket events real-time updates ke liye
- Buffer system ensures message delivery confirmation
- Error handling via `error:general` aur `error:game` events

