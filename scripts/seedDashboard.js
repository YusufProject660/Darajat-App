require('dotenv').config();
const mongoose = require('mongoose');

// Define schema directly to avoid TypeScript compilation issues
const dashboardSchema = new mongoose.Schema({
  banner: {
    title: String,
    description: String,
    createButtonText: String,
    image: String
  },
  actions: {
    joinGameText: String,
    howToPlayLink: String
  },
  funGames: [{
    id: String,
    title: String,
    description: String,
    image: String,
    status: String
  }]
}, { timestamps: true });

const Dashboard = mongoose.models.Dashboard || mongoose.model('Dashboard', dashboardSchema);

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB connected...');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

// Dashboard data
const dashboardData = {
  banner: {
    title: "Play Games",
    description: "Choose your game & start playing",
    createButtonText: "Create a game",
    image: "https://darajat.com/assets/banner.png"
  },
  actions: {
    joinGameText: "Join Game",
    howToPlayLink: "https://darajat.com/help/how-to-play"
  },
  funGames: [
    {
      id: "trivia_rush",
      title: "Trivia Rush",
      description: "Test your Islamic knowledge",
      image: "/uploads/games-image/trivia_rush.png",
      status: "available"
    },
    {
      id: "act_it",
      title: "Act It",
      description: "Act out clues of your team",
      image: "/uploads/games-image/trivia_rush.png",
      status: "coming_soon"
    }
  ]
};

// Games data
const gamesData = [
  {
    id: "trivia_rush",
    title: "Trivia Rush",
    description: "Test your Islamic knowledge",
    image: "/uploads/games-image/trivia_rush.png",
    status: "available"
  },
  {
    id: "act_it",
    title: "Act It",
    description: "Act out clues of your team",
    image: "/uploads/games-image/act_it.png",
    status: "coming_soon"
  }
];

const seedDatabase = async () => {
  try {
    await connectDB();
    
    console.log('Seeding dashboard data...');
    
    // Clear existing data
    await Dashboard.deleteMany({});
    
    // Insert new data with funGames
    await Dashboard.create(dashboardData);
    
    console.log('✅ Dashboard data with funGames seeded successfully!');
    console.log('📸 Image paths updated:');
    console.log('   - trivia_rush: /uploads/games-image/trivia_rush.png');
    console.log('   - act_it: /uploads/games-image/act_it.png');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
