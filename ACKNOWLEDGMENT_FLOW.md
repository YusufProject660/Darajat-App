# 📨 Acknowledgment Flow - Complete Guide

## 🔄 Kaise Kaam Karta Hai

### Step-by-Step Flow:

```
1. Backend Event Emit (with taskId)
   ↓
2. Frontend Receive Event
   ↓
3. Frontend Check: taskId hai?
   ↓
4. Frontend Emit: message:ack
   ↓
5. Backend Track Acknowledgment
   ↓
6. Backend Check: Sab ne acknowledge kar diya?
   ↓
7. Backend Emit: buffer:cleared (sender ko)
```

---

## 📤 Frontend Se Acknowledgment Kaise Bhejte Hain

### Example 1: `player:removed` Event

```javascript
// Frontend (player1.html, player2.html, etc.)
socket.on('player:removed', (data) => {
    // 1. Pehle check karo: Kya tum hi remove ho gaye?
    const currentUserId = currentUser?.user_id || currentUser?._id;
    if (data.playerId === currentUserId) {
        // Agar tum hi remove ho, toh acknowledgment mat bhejo
        return; // ❌ Acknowledgment nahi bhejega
    }
    
    // 2. Check karo: taskId hai kya?
    if (data.taskId) {
        // ✅ taskId hai, toh acknowledgment bhejo
        socket.emit('message:ack', { 
            taskId: data.taskId 
        }, (response) => {
            // Backend se response aayega
            if (response && response.success) {
                log('✅ Player removed message acknowledged', 'success');
                
                // Optional: Check if all players acknowledged
                if (response.allAcknowledged) {
                    log('🎉 All players received the message!', 'success');
                }
            }
        });
    }
    
    // 3. UI update karo
    updateLobby();
});
```

### Example 2: `player:joined` Event

```javascript
socket.on('player:joined', (data) => {
    // UI update
    updatePlayersList(data.players);
    
    // Acknowledgment bhejo agar taskId hai
    if (data.taskId) {
        socket.emit('message:ack', { 
            taskId: data.taskId 
        }, (response) => {
            if (response && response.success) {
                log('✅ Player joined message acknowledged', 'success');
            }
        });
    }
});
```

### Example 3: `question:answered` Event

```javascript
socket.on('question:answered', (data) => {
    // Show answer in UI
    showAnswer(data);
    
    // Acknowledgment bhejo
    if (data.taskId) {
        socket.emit('message:ack', { 
            taskId: data.taskId 
        }, (response) => {
            if (response && response.success) {
                log('✅ Answer message acknowledged', 'success');
            }
        });
    }
});
```

---

## 🔧 Backend Me Kya Hota Hai

### Backend Handler (socket.handler.ts:1139)

```typescript
// Backend listens for acknowledgment
socket.on('message:ack', async (data: { taskId: string }, callback) => {
    try {
        // 1. Get receiver ID (jo acknowledge kar raha hai)
        const receiverId = socket.data.user.id;
        const { taskId } = data;

        // 2. Validate
        if (!taskId) {
            return callback?.({ success: false, error: 'Task ID is required' });
        }

        // 3. Track acknowledgment
        const allAcknowledged = await bufferManager.acknowledgeMessage(taskId, receiverId);

        // 4. Response bhejo
        callback?.({ 
            success: true, 
            allAcknowledged  // true = sab ne acknowledge kar diya
        });
    } catch (error) {
        callback?.({ success: false, error: error.message });
    }
});
```

### Buffer Manager Process

```typescript
// bufferManager.acknowledgeMessage()
async acknowledgeMessage(taskId: string, receiverId: string): Promise<boolean> {
    // 1. Buffer find karo
    const buffer = this.buffers.get(taskId);
    
    // 2. Check: Kya ye receiver expected receivers me hai?
    if (!buffer.expectedReceivers.has(receiverId)) {
        return false; // Invalid receiver
    }
    
    // 3. Acknowledgment add karo
    buffer.acknowledgedBy.add(receiverId);
    
    // 4. Database update
    await MessageBuffer.updateOne(
        { taskId },
        { 
            $addToSet: { acknowledgedBy: receiverId },
            status: buffer.acknowledgedBy.size === buffer.expectedReceivers.size 
                ? 'delivered' 
                : 'pending'
        }
    );
    
    // 5. Check: Sab ne acknowledge kar diya?
    if (buffer.acknowledgedBy.size === buffer.expectedReceivers.size) {
        await this.clearBuffer(taskId); // Buffer clear karo
        return true; // ✅ Sab ne acknowledge kar diya
    }
    
    return false; // ⏳ Abhi aur players ka wait karo
}
```

---

## 📋 Complete Example Flow

### Scenario: Player 1 leaves room

```
┌─────────────────────────────────────────────────────────┐
│ STEP 1: Backend Emit                                    │
└─────────────────────────────────────────────────────────┘
Backend: socket.to(roomCode).emit('player:removed', {
    playerId: "user123",
    reason: "left",
    players: [...],
    taskId: "uuid-abc-123",  // ← Buffer created
    senderId: "user123"
});

┌─────────────────────────────────────────────────────────┐
│ STEP 2: Frontend Receive (Player 2)                     │
└─────────────────────────────────────────────────────────┘
Player 2: socket.on('player:removed', (data) => {
    // Check: Kya main remove hua?
    if (data.playerId === currentUserId) {
        return; // ❌ Nahi, acknowledgment mat bhejo
    }
    
    // Check: taskId hai?
    if (data.taskId) {
        // ✅ Haan, acknowledgment bhejo
        socket.emit('message:ack', { 
            taskId: data.taskId 
        });
    }
});

┌─────────────────────────────────────────────────────────┐
│ STEP 3: Frontend Emit Acknowledgment                    │
└─────────────────────────────────────────────────────────┘
Frontend → Backend:
socket.emit('message:ack', { 
    taskId: "uuid-abc-123" 
}, (response) => {
    console.log(response);
    // { success: true, allAcknowledged: false }
});

┌─────────────────────────────────────────────────────────┐
│ STEP 4: Backend Process                                  │
└─────────────────────────────────────────────────────────┘
Backend:
1. Get receiverId from socket.data.user.id
2. Call bufferManager.acknowledgeMessage(taskId, receiverId)
3. Add receiverId to acknowledgedBy list
4. Check: Sab ne acknowledge kar diya?
   - NO → Return { allAcknowledged: false }
   - YES → Clear buffer, emit 'buffer:cleared' to sender

┌─────────────────────────────────────────────────────────┐
│ STEP 5: All Acknowledged (if all players responded)     │
└─────────────────────────────────────────────────────────┘
Backend → Sender (Player 1):
socket.emit('buffer:cleared', {
    taskId: "uuid-abc-123",
    roomCode: "ABC123",
    eventName: "player:removed"
});

Frontend (Player 1 - Sender):
socket.on('buffer:cleared', (data) => {
    log('✅ All players received your message!', 'success');
});
```

---

## ⚠️ Important Points

### 1. **Kis Ko Acknowledgment Bhejna Hai?**

✅ **Bhejo:**
- Jo event receive kiya
- Jo room me hai
- Jo expected receiver hai

❌ **Mat Bhejo:**
- Jo event send kiya (sender)
- Jo remove/kick ho gaya
- Jo room me nahi hai

### 2. **Kis Event Me Acknowledgment Bhejna Hai?**

Agar event me `taskId` hai, toh acknowledgment bhejo:
- ✅ `player:joined` (with taskId)
- ✅ `player:removed` (with taskId)
- ✅ `question:answered` (with taskId)
- ✅ `question:leaderboard` (with taskId)

### 3. **Code Pattern (Har Event Ke Liye Same)**

```javascript
socket.on('EVENT_NAME', (data) => {
    // 1. Check: Kya tum hi affected ho?
    if (data.playerId === currentUserId && shouldNotAcknowledge) {
        return; // ❌ Don't acknowledge
    }
    
    // 2. Check: taskId hai?
    if (data.taskId) {
        // ✅ Acknowledgment bhejo
        socket.emit('message:ack', { 
            taskId: data.taskId 
        }, (response) => {
            if (response && response.success) {
                log('✅ Message acknowledged', 'success');
            }
        });
    }
    
    // 3. UI update
    updateUI(data);
});
```

---

## 🎯 Current Implementation Status

### ✅ Already Implemented:
- `player:joined` - Acknowledgment ✅
- `question:answered` - Acknowledgment ✅
- `question:leaderboard` - Acknowledgment ✅
- `player:removed` - Acknowledgment ✅ (just added)

### 📝 Code Location:

**Frontend:**
- `public/player1.html` - Line 787-792
- `public/player2.html` - Line 626-631, 649-654
- `public/player3.html` - Line 536-541, 559-564

**Backend:**
- `src/modules/games/socket.handler.ts` - Line 1139-1163
- `src/modules/games/utils/bufferManager.ts` - Line 81-124

---

## 💡 Summary

**Frontend se acknowledgment bhejne ke liye:**

1. Event receive karo
2. Check karo: `taskId` hai?
3. Agar hai, toh:
   ```javascript
   socket.emit('message:ack', { taskId: data.taskId }, callback);
   ```
4. Backend automatically track karega
5. Jab sab ne acknowledge kar diya, sender ko `buffer:cleared` event milega

**Simple hai!** Bas `taskId` check karo aur `message:ack` emit karo! 🚀

