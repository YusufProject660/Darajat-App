const mongoose = require('mongoose');
require('dotenv').config();

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
  }
};

// Games data
const gamesData = [
  {
    id: "trivia_rush",
    title: "Trivia Rush",
    description: "Test your Islamic knowledge",
    image: "https://darajat.com/assets/trivia.png",
    status: "available"
  },
  {
    id: "act_it",
    title: "Act It",
    description: "Act out clues of your team",
    image: "https://darajat.com/assets/actit.png",
    status: "coming_soon"
  }
];

const initializeData = async () => {
  try {
    await connectDB();
    
    // Get models
    const Dashboard = mongoose.model('Dashboard');
    const Game = mongoose.model('Game');
    
    // Clear existing data
    await Dashboard.deleteMany({});
    await Game.deleteMany({});
    
    // Insert dashboard data
    await Dashboard.create(dashboardData);
    
    // Insert games data
    await Game.insertMany(gamesData);
    
    console.log('Dashboard and games data initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error initializing data:', error);
    process.exit(1);
  }
};

initializeData();
