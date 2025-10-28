require('ts-node/register');
require('dotenv').config();
const mongoose = require('mongoose');

// Import models using TypeScript import syntax
const { Dashboard } = require('../src/modules/dashboard/dashboard.model');
const { DashboardGame } = require('../src/modules/dashboard/models/dashboard-game.model');

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

const seedDatabase = async () => {
  try {
    await connectDB();
    
    console.log('Seeding dashboard data...');
    
    // Clear existing data
    await Dashboard.deleteMany({});
    await DashboardGame.deleteMany({});
    
    // Insert new data
    await Dashboard.create(dashboardData);
    await DashboardGame.insertMany(gamesData);
    
    console.log('✅ Dashboard data seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
};

seedDatabase();
