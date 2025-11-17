import mongoose from 'mongoose';
import { connectDB } from '../config/db';

// Interface for Dashboard document
interface IDashboard extends mongoose.Document {
  banner: {
    title: string;
    description: string;
    createButtonText: string;
    image: string;
  };
  actions: {
    joinGameText: string;
    howToPlayLink: string;
  };
}

// Interface for Game document
interface IGame extends mongoose.Document {
  id: string;
  title: string;
  description: string;
  image: string;
  status: 'available' | 'coming_soon' | 'maintenance';
}

// Dashboard Schema
const dashboardSchema = new mongoose.Schema<IDashboard>({
  banner: {
    title: { type: String, required: true },
    description: { type: String, required: true },
    createButtonText: { type: String, required: true },
    image: { type: String, required: true }
  },
  actions: {
    joinGameText: { type: String, required: true },
    howToPlayLink: { type: String, required: true }
  }
});

// Game Schema
const gameSchema = new mongoose.Schema<IGame>({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  image: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'coming_soon', 'maintenance'],
    default: 'available'
  }
});

// Models
const Dashboard = mongoose.models.Dashboard || mongoose.model<IDashboard>('Dashboard', dashboardSchema);
const Game = mongoose.models.Game || mongoose.model<IGame>('Game', gameSchema);

// Seed data
const seedDashboard = async (): Promise<void> => {
  const dashboardData = {
    banner: {
      title: 'Play Games',
      description: 'Choose your game & start playing',
      createButtonText: 'Create a game',
      image: 'https://darajat.com/assets/banner.png'
    },
    actions: {
      joinGameText: 'Join Game',
      howToPlayLink: 'https://darajat.com/help/how-to-play'
    }
  };

  try {
    await Dashboard.deleteMany({});
    await Dashboard.create(dashboardData);
    console.log('✅ Dashboard data seeded successfully');
  } catch (error) {
    console.error('❌ Error seeding dashboard data:', error);
    throw error;
  }
};

const seedGames = async (): Promise<void> => {
  const gamesData = [
    {
      id: 'trivia_rush',
      title: 'Trivia Rush',
      description: 'Test your Islamic knowledge',
      image: 'https://darajat.com/assets/trivia.png',
      status: 'available' as const
    },
    {
      id: 'act_it',
      title: 'Act It',
      description: 'Act out clues for your team',
      image: 'https://darajat.com/assets/actit.png',
      status: 'coming_soon' as const
    },
    {
      id: 'quran_quiz',
      title: 'Quran Quiz',
      description: 'Test your Quranic knowledge',
      image: 'https://darajat.com/assets/quran-quiz.png',
      status: 'available' as const
    },
    {
      id: 'hadith_challenge',
      title: 'Hadith Challenge',
      description: 'How well do you know the hadith?',
      image: 'https://darajat.com/assets/hadith.png',
      status: 'available' as const
    }
  ];

  try {
    await Game.deleteMany({});
    await Game.insertMany(gamesData);
    console.log('✅ Games data seeded successfully');
  } catch (error) {
    console.error('❌ Error seeding games data:', error);
    throw error;
  }
};

const seedDatabase = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('🔌 Connected to MongoDB');

    // Seed data
    await seedDashboard();
    await seedGames();
    
    console.log('🎉 Database seeding completed successfully');
  } catch (error) {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
  } finally {
    // Close the connection
    await mongoose.disconnect();
    console.log('🔌 MongoDB connection closed');
  }
};

// Run the seeder
seedDatabase();