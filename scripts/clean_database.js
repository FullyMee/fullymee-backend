require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { connectDB, mongoose } = require('../src/config/db');

async function cleanDatabase() {
    console.log('==============================================');
    console.log('   STARTING FULL DATABASE CLEANING PROCESS    ');
    console.log('==============================================\n');

    await connectDB();

    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);

    console.log(`Found ${collectionNames.length} collections in database.`);

    for (const name of collectionNames) {
        // Skip system collections if any
        if (name.startsWith('system.')) continue;

        try {
            const count = await mongoose.connection.db.collection(name).countDocuments();
            await mongoose.connection.db.collection(name).deleteMany({});
            console.log(`✓ Cleared collection: ${name.padEnd(30)} (${count} documents removed)`);
        } catch (err) {
            console.error(`✗ Error clearing collection ${name}:`, err.message);
        }
    }

    console.log('\nAll collections have been completely cleared.');

    // Re-seed official confession rooms
    console.log('\n--- Seeding fresh official rooms ---');
    try {
        const { execSync } = require('child_process');
        const seedOutput = execSync('node scripts/seed50Rooms.js', {
            cwd: require('path').resolve(__dirname, '..'),
            encoding: 'utf-8'
        });
        console.log(seedOutput);
    } catch (err) {
        console.warn('Note: Could not run seed50Rooms.js automatically:', err.message);
    }

    console.log('\n==============================================');
    console.log('   DATABASE CLEANING & SEEDING COMPLETED!    ');
    console.log('==============================================');

    await mongoose.connection.close();
    process.exit(0);
}

cleanDatabase().catch((err) => {
    console.error('Fatal error during database cleaning:', err);
    process.exit(1);
});
