const { connectDB } = require('../src/config/db');
const Message = require('../src/models/message.model');
const Conversation = require('../src/models/conversation.model');

async function run() {
  await connectDB();
  const convo = await Conversation.findOne().sort({ id: -1 }).lean();
  if (!convo) {
    console.log('No conversations found');
    process.exit(0);
  }
  const conversationId = convo.id;
  console.log('Inspecting conversationId:', conversationId);
  const total = await Message.countDocuments({ conversationId });
  console.log('Total messages for conversation:', total);

  // check across collection for any clientMessageId that matches c_10000_ pattern
  const samplePattern = 'c_10000_';
  const matches = await Message.find({ clientMessageId: { $regex: '^c_\\d+_\\d+' } }).limit(20).lean();
  console.log('Sample clientMessageId matches across collection (limit 20):', matches.map((m) => m.clientMessageId));

  const totalWithPattern = await Message.countDocuments({ clientMessageId: { $regex: '^c_\\d+_\\d+' } });
  console.log('Total messages with load clientMessageId pattern:', totalWithPattern);

  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(2); });