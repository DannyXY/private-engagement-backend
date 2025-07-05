const { PrismaClient } = require('../generated/prisma/client');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const cron = require('node-cron');
const prisma = new PrismaClient();

const jwtSecret = process.env.JWT_SECRET || 'supersecret';

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

async function tryRefreshTwitterToken(user, tokens) {
  console.log(`🔄 Attempting to refresh Twitter tokens for user ${user.id}...`);
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.log('❌ Missing Twitter client credentials');
    return null;
  }
  
  try {
    console.log('📡 Creating Twitter API client for refresh...');
    const client = new TwitterApi({ clientId, clientSecret });
    
    console.log('🔄 Calling Twitter refresh OAuth2 token...');
    const refreshResponse = await client.refreshOAuth2Token(tokens.refreshToken);
    
    const newTokens = {
      accessToken: refreshResponse.accessToken,
      refreshToken: refreshResponse.refreshToken,
      expiresIn: refreshResponse.expiresIn,
      scope: refreshResponse.scope,
    };
    
    console.log('✅ Twitter tokens refreshed successfully');
    console.log(`📊 New token expires in: ${refreshResponse.expiresIn} seconds`);
    
    // Encrypt and store new tokens
    console.log('🔐 Encrypting new tokens...');
    const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(jwtSecret.padEnd(32)), Buffer.alloc(16));
    const encryptedTokens = cipher.update(JSON.stringify(newTokens), 'utf8', 'hex') + cipher.final('hex');
    
    console.log('💾 Storing encrypted tokens in database...');
    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { oauthTokens: encryptedTokens } 
    });
    
    console.log('✅ New tokens stored successfully');
    return newTokens;
  } catch (err) {
    console.log('❌ Failed to refresh Twitter tokens:', err.message);
    console.log('🔍 Error details:', err);
    return null;
  }
}

function extractTweetId(url) {
  console.log(`🔍 Extracting tweet ID from URL: ${url}`);
  const match = url.match(/status\/(\d+)/);
  const tweetId = match ? match[1] : null;
  console.log(`📝 Extracted tweet ID: ${tweetId}`);
  return tweetId;
}

async function validateAndRefreshTokensForUsers(users) {
  console.log(`👥 Validating tokens for ${users.length} users...`);
  const validUsers = [];
  
  for (const user of users) {
    console.log(`\n🔍 Processing user ${user.id} (${user.twitterId || 'no twitter ID'})...`);
    
    const tokens = decryptTokens(user.oauthTokens);
    if (!tokens) {
      console.log(`❌ User ${user.id}: No valid tokens found, skipping`);
      continue;
    }
    
    try {
      console.log(`🔐 User ${user.id}: Testing access token...`);
      const client = new TwitterApi(tokens.accessToken);
      await client.v2.me();
      console.log(`✅ User ${user.id}: Token is valid`);
      validUsers.push({ ...user, tokens });
    } catch (err) {
      console.log(`⚠️ User ${user.id}: Token validation failed - ${err.message}`);
      
      if (err.code === 401 || (err.response && err.response.status === 401)) {
        console.log(`🔄 User ${user.id}: Attempting token refresh...`);
        // Try to refresh
        const refreshed = await tryRefreshTwitterToken(user, tokens);
        if (refreshed) {
          console.log(`✅ User ${user.id}: Token refreshed successfully`);
          validUsers.push({ ...user, tokens: refreshed });
        } else {
          console.log(`❌ User ${user.id}: Token refresh failed, skipping user`);
        }
      } else {
        console.log(`❌ User ${user.id}: Unexpected error during validation:`, err.message);
      }
    }
  }
  
  console.log(`📊 Token validation complete. ${validUsers.length}/${users.length} users have valid tokens`);
  return validUsers;
}

async function processEngagements() {
  console.log('\n🚀 Starting engagement processing...');
  
  console.log('📋 Fetching pending engagements...');
  const pending = await prisma.engagement.findMany({ where: { engagedUserIds: { equals: [] } } });
  console.log(`📊 Found ${pending.length} pending engagements`);
  
  if (pending.length === 0) {
    console.log('✅ No pending engagements to process');
    return;
  }
  
  for (const engagement of pending) {
    console.log(`\n🎯 Processing engagement ${engagement.id} for tweet: ${engagement.tweetUrl}`);
    
    console.log('👥 Fetching all users...');
    let users = await prisma.user.findMany({});
    console.log(`📊 Found ${users.length} total users`);
    
    console.log('🔐 Validating user tokens...');
    users = await validateAndRefreshTokensForUsers(users);
    
    const engagedUserIds = [];
    console.log(`\n🔄 Processing ${users.length} valid users for engagement...`);
    
    for (const user of users) {
      console.log(`\n👤 Processing user ${user.id} (${user.twitterId || 'no twitter ID'})...`);
      
      const tokens = user.tokens || decryptTokens(user.oauthTokens);
      if (!tokens) {
        console.log(`❌ User ${user.id}: No valid tokens, skipping`);
        continue;
      }
      
      const tweetId = extractTweetId(engagement.tweetUrl);
      if (!tweetId) {
        console.log(`❌ Could not extract tweet ID from URL: ${engagement.tweetUrl}`);
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
        
        if (err.code === 401 || (err.response && err.response.status === 401)) {
          console.log(`🔄 User ${user.id}: Token expired, attempting refresh...`);
          const refreshed = await tryRefreshTwitterToken(user, tokens);
          if (refreshed) {
            try {
              console.log(`📡 User ${user.id}: Creating refreshed Twitter client...`);
              const refreshedClient = new TwitterApi(refreshed.accessToken);
              
              console.log(`❤️ User ${user.id}: Liking tweet ${tweetId} with refreshed token...`);
              await refreshedClient.v2.like(user.twitterId, tweetId);
              console.log(`✅ User ${user.id}: Tweet liked successfully with refreshed token`);
              
              console.log(`🔄 User ${user.id}: Retweeting tweet ${tweetId} with refreshed token...`);
              await refreshedClient.v2.retweet(user.twitterId, tweetId);
              console.log(`✅ User ${user.id}: Tweet retweeted successfully with refreshed token`);
              
              engagedUserIds.push(user.id);
              console.log(`✅ User ${user.id}: Engagement completed successfully after token refresh`);
            } catch (refreshErr) {
              console.log(`❌ User ${user.id}: Engagement failed even after token refresh:`, refreshErr.message);
            }
          } else {
            console.log(`❌ User ${user.id}: Token refresh failed, skipping user`);
          }
        } else if (err.code === 429 || (err.response && err.response.status === 429)) {
          console.log(`⏰ User ${user.id}: Rate limited, marking as engaged anyway`);
          engagedUserIds.push(user.id);
        } else {
          console.log(`❌ User ${user.id}: Unexpected error during engagement:`, err.message);
        }
      }
    }
    
    console.log(`\n💾 Updating engagement ${engagement.id} with ${engagedUserIds.length} engaged users...`);
    await prisma.engagement.update({ 
      where: { id: engagement.id }, 
      data: { engagedUserIds } 
    });
    console.log(`✅ Engagement ${engagement.id} updated successfully`);
  }
  
  console.log('\n🎉 Engagement processing cycle completed');
}

if (require.main === module) {
  console.log('🚀 Starting private engager worker...');
  console.log('⏰ Setting up cron job to run every minute...');
  
  cron.schedule('* * * * *', async () => {
    console.log('\n⏰ Cron job triggered - starting engagement processing...');
    try {
      await processEngagements();
      console.log('✅ Cron job completed successfully');
    } catch (error) {
      console.log('❌ Cron job failed with error:', error);
    }
  });
  
  console.log('✅ Private engager worker started with cron (every minute).');
}

module.exports = { processEngagements }; 