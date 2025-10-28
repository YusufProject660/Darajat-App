const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/darajat';
const client = new MongoClient(uri);

async function seedDashboard() {
  try {
    await client.connect();
    const db = client.db();
    
    // Clear existing data
    await db.collection('dashboards').deleteMany({});
    await db.collection('games').deleteMany({});

    // Insert dashboard data with embedded games
    await db.collection('dashboards').insertOne({
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
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    });

    console.log('✅ Dashboard data seeded successfully');
  } catch (err) {
    console.error('❌ Dashboard seed failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seedDashboard();
