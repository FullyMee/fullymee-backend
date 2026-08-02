require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./src/config/db.js');
const User = require('./src/models/user.model.js');
const ConfessionPost = require('./src/models/confessionPost.model.js');
const ConfessionRoomMember = require('./src/models/confessionRoomMember.model.js');
const ConfessionReply = require('./src/models/confessionReply.model.js');

async function updateAliases() {
  await connectDB();
  const users = await User.find({}).lean();
  console.log('Users found:', users.length);
  
  for (const user of users) {
    if (!user.username) continue;
    
    const uid = user.id;
    const username = user.username;
    
    const p = await ConfessionPost.updateMany({ author: uid }, { $set: { alias: username } });
    const m = await ConfessionRoomMember.updateMany({ userId: uid }, { $set: { alias: username } });
    const r = await ConfessionReply.updateMany({ authorUserId: uid }, { $set: { alias: username } });
    
    console.log('Updated for', username, 'Posts:', p.modifiedCount, 'Members:', m.modifiedCount, 'Replies:', r.modifiedCount);
  }
  
  console.log('Done');
  process.exit(0);
}
updateAliases().catch(console.error);
