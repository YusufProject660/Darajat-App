# Create Room API - Complete Flow Documentation

## Overview
Complete flow documentation for create room API including request validation, question fetching, room creation, and response formatting.

---

## 1. HTTP API - Create Room

### Endpoint
```
POST /api/game/create
```

### Authentication
- **Required:** Yes (JWT Token in Authorization header)
- **Access:** Private

### Request Headers
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

### Request Body
```json
{
  "categories": {
    "quran": {
      "enabled": true,
      "difficulty": "medium",
      "name": "Quran"
    },
    "hadith": {
      "enabled": true,
      "difficulty": "easy",
      "name": "Hadith"
    },
    "history": {
      "enabled": false,
      "difficulty": "hard"
    }
  },
  "numberOfQuestions": 10,
  "maximumPlayers": 4
}
```

### Response
```json
{
  "status": 1,
  "message": "Game created successfully",
  "data": {
    "game_id": "507f1f77bcf86cd799439011",
    "roomCode": "ABC123",
    "hostId": "690487b541cb52d1e972ac79",
    "settings": {
      "categories": {
        "quran": {
          "enabled": true,
          "difficulty": "medium"
        },
        "hadith": {
          "enabled": true,
          "difficulty": "easy"
        }
      },
      "numberOfQuestions": 10,
      "maximumPlayers": 4
    },
    "players": [
      {
        "userId": {
          "_id": "690487b541cb52d1e972ac79",
          "username": "host@example.com"
        },
        "username": "host@example.com",
        "avatar": "",
        "isHost": true,
        "score": 0
      }
    ],
    "questions": [
      {
        "question_id": "507f1f77bcf86cd799439011",
        "question": "What is the meaning of...?",
        "options": [
          { "option_id": 0, "text": "Option A" },
          { "option_id": 1, "text": "Option B" },
          { "option_id": 2, "text": "Option C" },
          { "option_id": 3, "text": "Option D" }
        ],
        "correctAnswer": {
          "option_id": 1,
          "text": "Option B"
        },
        "difficulty": "medium",
        "category": "quran"
      }
    ],
    "status": "waiting"
  }
}
```

---

## 2. Backend Flow - Step by Step

### Location
**File:** `src/modules/games/game.controller.ts`  
**Function:** `createGame` (Line 125-266)

---

### Step 1: Authentication Check
**Line 127-129**
```typescript
if (!req.user) {
  return res.apiError('User not authenticated', 'UNAUTHORIZED');
}
```
- **Action:** Verify user is authenticated via JWT middleware
- **Error:** Returns `UNAUTHORIZED` if user not authenticated

---

### Step 2: Extract Request Data
**Line 131**
```typescript
const { categories = {}, numberOfQuestions = 10, maximumPlayers = 4 } = req.body;
```
- **Action:** Extract request body parameters
- **Defaults:**
  - `categories`: `{}` (empty object)
  - `numberOfQuestions`: `10`
  - `maximumPlayers`: `4`

---

### Step 3: Validate numberOfQuestions
**Line 133-135**
```typescript
if (typeof numberOfQuestions !== 'number' || numberOfQuestions < 1 || numberOfQuestions > 60) {
  return res.apiError('Number of questions must be between 1 and 60', 'INVALID_INPUT');
}
```
- **Validation:**
  - Must be a number
  - Range: 1 to 60
- **Error:** Returns `INVALID_INPUT` if validation fails

---

### Step 4: Validate maximumPlayers
**Line 137-140**
```typescript
if (isNaN(Number(maximumPlayers)) || !Number.isInteger(Number(maximumPlayers)) || 
    Number(maximumPlayers) < 2 || Number(maximumPlayers) > 10) {
  return res.apiError('Maximum players must be an integer between 2 and 10', 'INVALID_INPUT');
}
```
- **Validation:**
  - Must be a valid number
  - Must be an integer
  - Range: 2 to 10
- **Error:** Returns `INVALID_INPUT` if validation fails

---

### Step 5: Process Categories
**Line 142-161**
```typescript
const processedCategories = new Map();
const enabledCategories: Array<{category: string, difficulty: string}> = [];

for (const [category, settings] of Object.entries(categories as Record<string, any>)) {
  if (settings?.enabled) {
    // Enabled category
    processedCategories.set(category, {
      enabled: true,
      difficulty: settings.difficulty
    });
    enabledCategories.push({
      category: settings.name || category.toLowerCase(),
      difficulty: settings.difficulty || 'easy'
    });
  } else {
    // Disabled category
    processedCategories.set(category, {
      enabled: false,
      difficulty: 'easy'
    });
  }
}
```
- **Action:**
  - Loop through all categories
  - Separate enabled and disabled categories
  - Store enabled categories in `enabledCategories` array
  - Store all categories (enabled/disabled) in `processedCategories` Map
- **Note:** Disabled categories are stored but not used for question fetching

---

### Step 6: Validate At Least One Category Enabled
**Line 163-166**
```typescript
if (enabledCategories.length === 0) {
  logger.error('[createGame] 400: no enabled categories after processing');
  return res.apiError('At least one category must be enabled', 'NO_CATEGORIES_ENABLED');
}
```
- **Validation:** At least one category must be enabled
- **Error:** Returns `NO_CATEGORIES_ENABLED` if no categories enabled

---

### Step 7: Fetch Questions from Categories
**Line 169-198**
```typescript
const questionPromises = enabledCategories.map(async ({ category, difficulty }) => {
  // 1. Find decks matching category
  const decks = await Deck.find({
    $or: [
      { category: { $regex: new RegExp(category, 'i') } },
      { name: { $regex: new RegExp(category, 'i') } }
    ]
  });

  if (!Array.isArray(decks) || decks.length === 0) return [];

  const deckIds = decks.map(deck => deck._id);
  
  // 2. First try to get questions with exact difficulty match
  let questions = await Question.find({
    deckId: { $in: deckIds },
    difficulty: difficulty.toLowerCase()
  }).limit(numberOfQuestions);

  // 3. If not enough questions, get any difficulty
  if ((questions?.length || 0) < numberOfQuestions) {
    const additionalQuestions = await Question.find({
      deckId: { $in: deckIds },
      _id: { $nin: (questions || []).map(q => q._id) }
    }).limit(numberOfQuestions - (questions?.length || 0));
    
    questions = [...(questions || []), ...additionalQuestions];
  }

  return questions;
});
```
- **Action (per enabled category):**
  1. **Find Decks:** Search decks by category name (case-insensitive)
  2. **Get Questions (Exact Difficulty):** Fetch questions matching exact difficulty
  3. **Get Additional Questions:** If not enough, fetch from any difficulty
- **Strategy:** Prioritize exact difficulty match, fallback to any difficulty

---

### Step 8: Combine All Questions
**Line 200-201**
```typescript
const questionsResults = await Promise.all(questionPromises);
const allQuestions = questionsResults.flat();
```
- **Action:**
  - Wait for all category promises to resolve
  - Flatten array of question arrays into single array
- **Result:** Combined list of all questions from all enabled categories

---

### Step 9: Validate Questions Found
**Line 203-206**
```typescript
if (allQuestions.length === 0) {
  logger.error('[createGame] 400: no questions found');
  return res.apiError('No questions found for the selected categories', 'NOT_FOUND');
}
```
- **Validation:** At least one question must be found
- **Error:** Returns `NOT_FOUND` if no questions found

---

### Step 10: Shuffle and Limit Questions
**Line 209-211**
```typescript
const shuffledQuestions = allQuestions
  .sort(() => 0.5 - Math.random())
  .slice(0, numberOfQuestions);
```
- **Action:**
  1. Shuffle questions randomly using `Math.random()`
  2. Limit to `numberOfQuestions` count
- **Result:** Random selection of questions

---

### Step 11: Validate Shuffled Questions
**Line 213-216**
```typescript
if (shuffledQuestions.length === 0) {
  logger.error('[createGame] 400: shuffledQuestions empty');
  return res.apiError('No questions found for the selected categories and difficulty levels', 'NOT_FOUND');
}
```
- **Validation:** Final check that shuffled questions exist
- **Error:** Returns `NOT_FOUND` if empty (shouldn't happen, but safety check)

---

### Step 12: Generate Unique Room Code
**Line 219**
```typescript
const roomCode = await generateUniqueRoomCode();
```
- **Function:** `src/modules/games/utils/generateRoomCode.ts`
- **Action:**
  1. Generate random 5-character code (A-Z, 2-9, excluding similar chars)
  2. Check if code exists in database
  3. Retry up to 10 times if duplicate found
  4. Return unique code
- **Format:** `ABC123` (5 characters, uppercase letters and numbers)

---

### Step 13: Create Game Room in Database
**Line 222-241**
```typescript
const newRoom = new GameRoom({
  hostId: req.user._id,                    // Host user ID
  roomCode,                                 // Unique room code
  settings: {
    categories: processedCategories,        // All categories (enabled/disabled)
    numberOfQuestions,                      // Number of questions
    maximumPlayers                          // Maximum players allowed
  },
  players: [{                               // Host as first player
    userId: req.user._id,
    username: req.user.username || 'Player',
    isHost: true,
    score: 0,
    avatar: req.user.avatar || ''
  }],
  questions: shuffledQuestions.map(q => q._id),  // Question IDs only
  status: 'waiting',                        // Initial status
  answeredQuestions: [],                    // Empty initially
  results: []                               // Empty initially
});

const saved = await newRoom.save();
```
- **Action:**
  - Create new `GameRoom` document
  - Host automatically added as first player with `isHost: true`
  - Store question IDs (not full objects)
  - Set initial status to `'waiting'`
- **Database:** MongoDB save operation

---

### Step 14: Populate Room Data
**Line 245-251**
```typescript
const populatedGame = await GameRoom.findById(saved._id)
  .populate({
    path: 'players.userId',
    select: 'username avatar'
  })
  .populate('questions')
  .lean() as any;
```
- **Action:**
  1. Find saved room by ID
  2. Populate `players.userId` with user data (username, avatar)
  3. Populate `questions` with full question objects
  4. Convert to plain JavaScript object (`.lean()`)
- **Result:** Room with full player and question data

---

### Step 15: Format Categories
**Line 253-255**
```typescript
if (populatedGame?.settings) {
  populatedGame.settings.categories = Object.fromEntries(processedCategories);
}
```
- **Action:** Convert `Map` to plain object for JSON response
- **Reason:** Maps don't serialize well in JSON

---

### Step 16: Clean and Format Response
**Line 257**
```typescript
return res.apiSuccess(cleanGameResponse(populatedGame), 'Game created successfully');
```
- **Function:** `cleanGameResponse()` (Line 44-85)
- **Action:**
  1. **Rename `_id` to `question_id`** in questions array
  2. **Format Options:**
     - Convert options array to objects with `option_id` and `text`
     - Remove `value` field if exists
  3. **Format Correct Answer:**
     - Convert from index number to object with `option_id` and `text`
  4. **Remove Fields:**
     - Delete `deck` field
     - Delete `deckId` field
  5. **Return:** Formatted response

---

## 3. Response Formatting Details

### cleanGameResponse Function
**Location:** `src/modules/games/game.controller.ts` (Line 44-85)

#### Question Formatting
```typescript
// Before
{
  "_id": "507f1f77bcf86cd799439011",
  "question": "What is...?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctAnswer": 1,
  "deck": {...},
  "deckId": "..."
}

// After
{
  "question_id": "507f1f77bcf86cd799439011",
  "question": "What is...?",
  "options": [
    { "option_id": 0, "text": "Option A" },
    { "option_id": 1, "text": "Option B" },
    { "option_id": 2, "text": "Option C" },
    { "option_id": 3, "text": "Option D" }
  ],
  "correctAnswer": {
    "option_id": 1,
    "text": "Option B"
  }
  // deck and deckId removed
}
```

---

## 4. Error Handling

### Possible Errors

1. **UNAUTHORIZED** (Line 128)
   - **Cause:** User not authenticated
   - **Message:** "User not authenticated"

2. **INVALID_INPUT** (Line 134, 139)
   - **Cause:** Invalid `numberOfQuestions` or `maximumPlayers`
   - **Messages:**
     - "Number of questions must be between 1 and 60"
     - "Maximum players must be an integer between 2 and 10"

3. **NO_CATEGORIES_ENABLED** (Line 165)
   - **Cause:** No categories enabled in request
   - **Message:** "At least one category must be enabled"

4. **NOT_FOUND** (Line 205, 215)
   - **Cause:** No questions found for selected categories
   - **Messages:**
     - "No questions found for the selected categories"
     - "No questions found for the selected categories and difficulty levels"

5. **GAME_CREATION_FAILED** (Line 260)
   - **Cause:** Database error during room creation
   - **Message:** "Failed to create game room"

6. **INTERNAL_SERVER_ERROR** (Line 264)
   - **Cause:** Unexpected error
   - **Message:** "An unexpected error occurred"

---

## 5. Database Models Used

### GameRoom Model
**Location:** `src/modules/games/models/gameRoom.model.ts`

**Fields Created:**
- `hostId`: ObjectId (User ID)
- `roomCode`: String (Unique 5-character code)
- `settings.categories`: Map/Object
- `settings.numberOfQuestions`: Number
- `settings.maximumPlayers`: Number
- `players`: Array of player objects
- `questions`: Array of Question ObjectIds
- `status`: String ('waiting', 'playing', 'finished')
- `answeredQuestions`: Array
- `results`: Array

### Deck Model
**Location:** `src/modules/games/models/deck.model.ts`

**Used For:**
- Finding decks by category name
- Getting deck IDs for question lookup

### Question Model
**Location:** `src/modules/games/models/question.model.ts`

**Used For:**
- Fetching questions by deck and difficulty
- Storing question IDs in room

---

## 6. Key Functions

### generateUniqueRoomCode()
**Location:** `src/modules/games/utils/generateRoomCode.ts` (Line 21-42)

**Flow:**
1. Generate random 5-character code
2. Check if code exists in database
3. If exists, retry (max 10 attempts)
4. Return unique code

**Code Format:**
- Characters: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
- Length: 5 characters
- Excludes: `I`, `O`, `0`, `1` (to avoid confusion)

---

## 7. Socket Events

### Note
**Create Room API does NOT emit any socket events.**

Socket events are only used for:
- Real-time player join/leave notifications
- Game state updates
- Answer submissions

These happen **after** room creation, typically when:
- Players join via `joinGame` API or `room:join` socket event
- Game starts
- Players submit answers

---

## 8. Frontend Integration

### Example Request
```javascript
const createRoom = async () => {
  const response = await fetch('/api/game/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      categories: {
        quran: {
          enabled: true,
          difficulty: 'medium',
          name: 'Quran'
        },
        hadith: {
          enabled: true,
          difficulty: 'easy',
          name: 'Hadith'
        }
      },
      numberOfQuestions: 10,
      maximumPlayers: 4
    })
  });

  const data = await response.json();
  if (data.status === 1) {
    console.log('Room created:', data.data.roomCode);
    // Use data.data.roomCode to join room
  }
};
```

---

## 9. Summary Flow Diagram

```
1. POST /api/game/create
   ↓
2. Authentication Check
   ↓
3. Extract & Validate Request Data
   ↓
4. Process Categories (enabled/disabled)
   ↓
5. Fetch Questions from Enabled Categories
   ↓
6. Shuffle & Limit Questions
   ↓
7. Generate Unique Room Code
   ↓
8. Create GameRoom in Database
   ↓
9. Populate Room Data (players, questions)
   ↓
10. Format Response (cleanGameResponse)
   ↓
11. Return Success Response
```

---

## 10. Important Notes

1. **No Socket Events:** Create room API is pure HTTP REST, no socket emissions
2. **Host Auto-Added:** Host is automatically added as first player with `isHost: true`
3. **Question Shuffling:** Questions are randomly shuffled before limiting
4. **Difficulty Fallback:** If exact difficulty questions not found, falls back to any difficulty
5. **Room Code Uniqueness:** Room code generation retries up to 10 times if duplicate found
6. **Response Formatting:** Questions are formatted with `option_id` and `correctAnswer` as objects
7. **Database Storage:** Only question IDs stored in room, full objects populated on fetch

---

## 11. Testing Checklist

- [ ] Valid request with all fields
- [ ] Request with missing optional fields (uses defaults)
- [ ] Invalid `numberOfQuestions` (out of range)
- [ ] Invalid `maximumPlayers` (out of range)
- [ ] No categories enabled
- [ ] Categories with no matching questions
- [ ] Unauthenticated request
- [ ] Multiple categories enabled
- [ ] Room code uniqueness (multiple simultaneous requests)
- [ ] Response format validation (options, correctAnswer structure)

---

**End of Documentation**

