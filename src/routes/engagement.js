const express = require('express');
const { PrismaClient } = require('../../generated/prisma/client');
const prismaClient = new PrismaClient();
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');

console.log('🎯 Initializing engagement routes...');

const router = express.Router();
const jwtSecret = process.env.JWT_SECRET || 'supersecret';

console.log(`🔐 JWT Secret: ${jwtSecret ? '✅ Set' : '❌ Missing'}`);

// Helper to decrypt tokens
function decryptTokens(encrypted) {
  console.log('🔓 Attempting to decrypt tokens...');
  try {
    const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(jwtSecret.padEnd(32)), Buffer.alloc(16));
    const decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');
    const tokens = JSON.parse(decrypted);
    console.log('✅ Tokens decrypted successfully');
    return tokens;
  } catch (error) {
    console.log('❌ Failed to decrypt tokens:', error.message);
    return null;
  }
}

// POST /engagement/add
router.post('/add', async (req, res) => {
  console.log('📝 POST /engagement/add - Creating new engagement...');
  console.log('📋 Request body:', req.body);
  
  const { tweetUrl } = req.body;
  if (!tweetUrl) {
    console.log('❌ Missing tweetUrl in request body');
    return res.status(400).json({ error: 'tweetUrl required' });
  }
  
  console.log(`🎯 Creating engagement for tweet: ${tweetUrl}`);
  
  try {
    // Create engagement
    console.log('💾 Creating engagement record in database...');
    const engagement = await prismaClient.engagement.create({
      data: { tweetUrl },
    });
    console.log(`✅ Engagement created with ID: ${engagement.id}`);
    
    // Fetch all users with tokens
    console.log('👥 Fetching all users from database...');
    const users = await prismaClient.user.findMany();
    console.log(`📊 Found ${users.length} users`);
    
    const engagedUserIds = [];
    console.log('🔄 Processing users for engagement...');
    
    for (const user of users) {
      console.log(`\n👤 Processing user ${user.id} (${user.twitterId || 'no twitter ID'})...`);
      
      const tokens = decryptTokens(user.oauthTokens);
      if (!tokens) {
        console.log(`❌ User ${user.id}: No valid tokens, skipping`);
        continue;
      }
      
      const tweetId = extractTweetId(tweetUrl);
      if (!tweetId) {
        console.log(`❌ Could not extract tweet ID from URL: ${tweetUrl}`);
        continue;
      }
      
      try {
        console.log(`📡 User ${user.id}: Creating Twitter client...`);
        const client = new TwitterApi(tokens.accessToken);
        
        console.log(`❤️ User ${user.id}: Liking tweet ${tweetId}...`);
        await client.v2.like(user.twitterId, tweetId);
        console.log(`✅ User ${user.id}: Tweet liked successfully`);
        
        console.log(`🔄 User ${user.id}: Retweeting tweet ${tweetId}...`);
        await client.v2.retweet(user.twitterId, tweetId);
        console.log(`✅ User ${user.id}: Tweet retweeted successfully`);
        
        engagedUserIds.push(user.id);
        console.log(`✅ User ${user.id}: Engagement completed successfully`);
        
      } catch (err) {
        console.log(`⚠️ User ${user.id}: Engagement failed - ${err.message}`);
        console.log(`🔍 Error details for user ${user.id}:`, err);
        continue;
      }
    }
    
    // Update engagement with engagedUserIds
    console.log(`\n💾 Updating engagement ${engagement.id} with ${engagedUserIds.length} engaged users...`);
    await prismaClient.engagement.update({
      where: { id: engagement.id },
      data: { engagedUserIds },
    });
    console.log(`✅ Engagement ${engagement.id} updated successfully`);
    
    console.log(`🎉 Engagement creation completed:`);
    console.log(`   - Engagement ID: ${engagement.id}`);
    console.log(`   - Tweet URL: ${tweetUrl}`);
    console.log(`   - Engaged Users: ${engagedUserIds.length}`);
    
    res.json({ success: true, engagementId: engagement.id, engagedUserIds });
    
  } catch (error) {
    console.log('❌ Error creating engagement:', error.message);
    console.log('🔍 Error details:', error);
    res.status(500).json({ error: 'Failed to create engagement' });
  }
});

// GET /engagement/list
router.get('/list', async (req, res) => {
  console.log('📋 GET /engagement/list - Fetching all engagements...');
  
  try {
    console.log('💾 Querying database for engagements...');
    const engagements = await prismaClient.engagement.findMany({ 
      orderBy: { createdAt: 'desc' } 
    });
    
    console.log(`✅ Retrieved ${engagements.length} engagements from database`);
    
    // Log summary of engagements
    engagements.forEach((engagement, index) => {
      console.log(`   ${index + 1}. ID: ${engagement.id}, Tweet: ${engagement.tweetUrl}, Engaged: ${engagement.engagedUserIds?.length || 0} users`);
    });
    
    res.json({ engagements });
    
  } catch (error) {
    console.log('❌ Error fetching engagements:', error.message);
    console.log('🔍 Error details:', error);
    res.status(500).json({ error: 'Failed to fetch engagements' });
  }
});

function extractTweetId(url) {
  console.log(`🔍 Extracting tweet ID from URL: ${url}`);
  const match = url.match(/status\/(\d+)/);
  const tweetId = match ? match[1] : null;
  console.log(`📝 Extracted tweet ID: ${tweetId}`);
  return tweetId;
}

console.log('✅ Engagement routes initialized');

module.exports = router; 