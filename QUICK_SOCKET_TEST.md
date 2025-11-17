# ⚡ QUICK SOCKET TESTING - STEP BY STEP

## 🎯 FASTEST WAY TO TEST

### Step 1: Get Token (Postman)
```
POST http://localhost:5000/api/auth/login
Body: { "email": "test@example.com", "password": "password" }
Copy: data.token
```

### Step 2: Open Browser Console (F12)
```javascript
// Load Socket.IO
const script = document.createElement('script');
script.src = 'https://cdn.socket.io/4.5.4/socket.io.min.js';
document.head.appendChild(script);

// Wait 2 seconds, then connect
setTimeout(() => {
  const socket = io('http://localhost:5000/ws', {
    auth: { token: 'PASTE_YOUR_TOKEN_HERE' },
    transports: ['websocket', 'polling'],
    path: '/ws/socket.io'
  });

  // Listen to all events
  socket.on('connect', () => console.log('✅ Connected:', socket.id));
  socket.on('player:joined', (d) => console.log('👤 Player Joined:', d));
  socket.on('question:answered', (d) => console.log('✅ Answer:', d));
  socket.on('player:disconnected', (d) => console.log('👋 Disconnected:', d));
  socket.on('error:general', (d) => console.error('❌ Error:', d));
  socket.on('error:game', (d) => console.error('🎮 Game Error:', d));

  // Store socket globally
  window.socket = socket;
  console.log('✅ Socket ready! Use window.socket to test events');
}, 2000);
```

### Step 3: Test Events
```javascript
// Test 1: Join Room (Create)
window.socket.emit('room:join', {
  roomCode: 'TEST' + Date.now(),
  playerName: 'Player1',
  isHost: true
}, (r) => console.log('📥 Response:', r));

// Test 2: Join Room (Join Existing)
window.socket.emit('room:join', {
  roomCode: 'TEST123',
  playerName: 'Player2',
  isHost: false
}, (r) => console.log('📥 Response:', r));

// Test 3: Submit Answer
window.socket.emit('answer:submit', {
  questionId: 'test_id',
  answer: 'A'
}, (r) => console.log('📥 Response:', r));

// Test 4: Disconnect
window.socket.disconnect();
```

---

## 📋 ALL AVAILABLE EVENTS

### Client → Server (Emit Karo)
| Event | Data | Callback |
|-------|------|----------|
| `room:join` | `{roomCode, playerName, isHost}` | ✅ |
| `answer:submit` | `{questionId, answer}` | ✅ |
| `disconnect` | - | ❌ |

### Server → Client (Listen Karo)
| Event | When | Data |
|-------|------|------|
| `player:joined` | New player joins | `{player, players}` |
| `question:answered` | Answer submitted | `{playerId, isCorrect, score}` |
| `player:disconnected` | Player leaves | `{playerId, reason}` |
| `error:general` | General error | `{code, message}` |
| `error:game` | Game error | `{code, message, recoverable}` |

---

## 🔍 WHAT TO CHECK IN SERVER CONSOLE

### Connection:
```
═══════════════════════════════════════════════════════════
🔌 SOCKET.IO INITIALIZATION
═══════════════════════════════════════════════════════════
✅ Socket.IO server initialized successfully
```

### User Connect:
```
═══════════════════════════════════════════════════════════
🆕 NEW USER CONNECTED
═══════════════════════════════════════════════════════════
Socket ID: abc123
User Data: {userId, username, email}
```

### Authentication:
```
═══════════════════════════════════════════════════════════
🔐 SOCKET AUTHENTICATED
═══════════════════════════════════════════════════════════
User ID: ...
Username: ...
```

### Room Join:
```
═══════════════════════════════════════════════════════════
🎮 ROOM JOIN ATTEMPT
═══════════════════════════════════════════════════════════
Room Code: TEST123
Player Name: Player1
Is Host: true
```

### Success:
```
═══════════════════════════════════════════════════════════
✅ PLAYER JOINED ROOM SUCCESSFULLY
═══════════════════════════════════════════════════════════
Player Data: {...}
Total Players in Room: 1
```

---

## ✅ TESTING CHECKLIST

- [ ] Socket connects successfully
- [ ] Authentication works (JWT token)
- [ ] `room:join` as host creates room
- [ ] `room:join` as player joins room
- [ ] `player:joined` event received
- [ ] `answer:submit` works (if game started)
- [ ] `question:answered` event received
- [ ] `disconnect` works properly
- [ ] `player:disconnected` event received
- [ ] Error events work (`error:general`, `error:game`)

---

## 🐛 COMMON ISSUES

### Issue: Connection Failed
**Fix**: Check server URL, port, and path

### Issue: Authentication Failed
**Fix**: Check JWT token is valid and not expired

### Issue: Events Not Working
**Fix**: Make sure socket is connected (`socket.connected === true`)

### Issue: No Response
**Fix**: Check callback function is provided

---

**🎉 Ready to test! Copy-paste karo aur test karo!**

