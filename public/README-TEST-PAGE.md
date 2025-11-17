# 🎮 Game Test Page - Usage Instructions

## 📍 How to Access

1. **Start your server:**
   ```bash
   npm run dev
   # or
   npm start
   ```

2. **Open in browser:**
   ```
   http://localhost:5000/game-test.html
   ```

---

## 🚀 Step-by-Step Usage

### Step 1: Login
1. Enter your **email** and **password**
2. Click **"Login"** button
3. Wait for success message
4. You'll see your user info displayed

### Step 2: Socket Connection
1. After login, socket will **automatically connect**
2. You'll see "Socket connected!" message
3. Socket ID will be displayed in logs

### Step 3: Create Room
1. Enter a **Room Code** (or leave empty for auto-generated)
2. Enter your **Player Name**
3. Click **"Create Room"** button
4. Room will be created and you'll see room info

### Step 4: Join Room (In Another Tab/Browser)
1. Open the same page in **another browser tab/window**
2. Login with **different user** (or same user)
3. Enter the **Room Code** from Step 3
4. Enter your **Player Name**
5. Click **"Join Room"** button
6. You'll see both players in the room

---

## 📋 Features

✅ **Login** - Authenticate and get JWT token  
✅ **Socket Connection** - Real-time WebSocket connection  
✅ **Create Room** - Create a new game room  
✅ **Join Room** - Join an existing room  
✅ **Real-time Logs** - See all socket events  
✅ **Room Info** - View all players in the room  

---

## 🔍 What You'll See in Logs

- ✅ Socket connection/disconnection
- 👤 Player joined events
- ✅ Answer submissions
- 👋 Player disconnections
- 🎮 Game started/ended events
- ❓ New questions
- ❌ Error messages

---

## 🎯 Testing Scenarios

### Scenario 1: Single User Test
1. Login → Connect → Create Room
2. Check logs for events
3. Room info will show you as host

### Scenario 2: Multi-User Test
1. **Tab 1:** Login → Connect → Create Room (as Host)
2. **Tab 2:** Login → Connect → Join Room (as Player)
3. Both tabs will see each other in room
4. Watch logs for `player:joined` events

### Scenario 3: Error Testing
1. Try joining non-existent room
2. Try creating room without socket connection
3. Check error messages in logs

---

## 🛠️ Troubleshooting

### Socket Not Connecting?
- Check if server is running
- Check browser console for errors
- Verify JWT token is valid
- Check CORS settings

### Can't Login?
- Verify email/password is correct
- Check API endpoint: `/api/auth/login`
- Check server logs for errors

### Room Not Creating?
- Make sure socket is connected
- Check room code format
- Verify player name is provided

---

## 📝 Notes

- **Server URL:** http://localhost:5000
- **Socket Path:** /ws/socket.io
- **API Endpoint:** /api/auth/login
- All events are logged in real-time
- Room info updates automatically

---

**🎉 Happy Testing!**

