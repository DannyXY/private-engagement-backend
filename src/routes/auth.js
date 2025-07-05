const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const crypto = require('crypto');
const { PrismaClient } = require('../../generated/prisma/client');
const prismaClient = new PrismaClient();
const jwt = require('jsonwebtoken');

console.log('🔐 Initializing auth routes...');

const router = express.Router();

const clientId = process.env.TWITTER_CLIENT_ID;
const clientSecret = process.env.TWITTER_CLIENT_SECRET;
const callbackUrl = process.env.TWITTER_CALLBACK_URL;
const jwtSecret = process.env.JWT_SECRET || 'supersecret';

console.log('📋 Auth configuration:');
console.log(`   - Client ID: ${clientId ? '✅ Set' : '❌ Missing'}`);
console.log(`   - Client Secret: ${clientSecret ? '✅ Set' : '❌ Missing'}`);
console.log(`   - Callback URL: ${callbackUrl || '❌ Missing'}`);
console.log(`   - JWT Secret: ${jwtSecret ? '✅ Set' : '❌ Missing'}`);

// PKCE helpers
function base64URLEncode(str) {
  return str.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function generateCodeVerifier() {
  return base64URLEncode(crypto.randomBytes(32));
}
function generateCodeChallenge(codeVerifier) {
  return base64URLEncode(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );
}

// In-memory store for code_verifier (replace with Redis/DB in production)
const codeVerifiers = {};

// Step 1: Redirect user to Twitter for OAuth login
router.get('/login', (req, res) => {
  console.log('🔗 OAuth login initiated...');
  
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString('hex');
  
  console.log(`📝 Generated PKCE parameters:`);
  console.log(`   - State: ${state}`);
  console.log(`   - Code Verifier: ${codeVerifier.substring(0, 10)}...`);
  console.log(`   - Code Challenge: ${codeChallenge.substring(0, 10)}...`);
  
  codeVerifiers[state] = codeVerifier;

  const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=tweet.read%20users.read%20like.write%20tweet.write%20offline.access` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  console.log(`🌐 Redirecting to Twitter OAuth URL...`);
  console.log(`📡 OAuth URL: ${url.substring(0, 100)}...`);
  
  res.redirect(url);
});

// Step 2: Handle callback from Twitter
router.get('/callback', async (req, res) => {
  console.log('🔄 OAuth callback received...');
  console.log(`📋 Query parameters:`, req.query);
  
  const { state, code } = req.query;
  const codeVerifier = codeVerifiers[state];
  
  if (!codeVerifier) {
    console.log('❌ Invalid state parameter - no code verifier found');
    return res.status(400).send('Invalid state');
  }
  
  console.log(`✅ State validation passed for state: ${state}`);

  try {
    console.log('📡 Creating Twitter API client for OAuth exchange...');
    const client = new TwitterApi({
      clientId,
      clientSecret,
    });
    
    console.log('🔄 Exchanging authorization code for tokens...');
    const { client: loggedClient, accessToken, refreshToken, expiresIn, scope } = await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: callbackUrl,
    });
    
    console.log('✅ OAuth token exchange successful');
    console.log(`📊 Token details:`);
    console.log(`   - Expires in: ${expiresIn} seconds`);
    console.log(`   - Scope: ${scope}`);
    
    // Get user info
    console.log('👤 Fetching user information from Twitter...');
    const { data: user } = await loggedClient.v2.me();
    console.log(`✅ User info retrieved: ${user.username} (${user.id})`);
    
    // Encrypt tokens
    console.log('🔐 Encrypting OAuth tokens...');
    const tokens = JSON.stringify({ accessToken, refreshToken, expiresIn, scope });
    const cipher = crypto.createCipheriv('aes-256-ctr', Buffer.from(jwtSecret.padEnd(32)), Buffer.alloc(16));
    const encryptedTokens = cipher.update(tokens, 'utf8', 'hex') + cipher.final('hex');
    console.log('✅ Tokens encrypted successfully');
    
    // Upsert user in DB
    console.log('💾 Upserting user in database...');
    const dbUser = await prismaClient.user.upsert({
      where: { twitterId: user.id },
      update: { oauthTokens: encryptedTokens, username: user.username },
      create: {
        twitterId: user.id,
        username: user.username,
        oauthTokens: encryptedTokens,
      },
    });
    console.log(`✅ User ${dbUser.id} saved/updated in database`);
    
    // Generate JWT
    console.log('🎫 Generating JWT token...');
    const jwtToken = jwt.sign({ id: dbUser.id, username: dbUser.username }, jwtSecret, { expiresIn: '7d' });
    console.log('✅ JWT token generated successfully');
    
    // Clean up code verifier
    delete codeVerifiers[state];
    console.log(`🧹 Cleaned up code verifier for state: ${state}`);
    
    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const redirectUrl = `${frontendUrl}/?token=${jwtToken}`;
    console.log(`🌐 Redirecting to frontend: ${frontendUrl}/?token=***`);
    
    res.redirect(redirectUrl);
  } catch (err) {
    console.log('❌ OAuth callback error:', err.message);
    console.log('🔍 Error details:', err);
    res.status(500).send('OAuth error');
  }
});

// Middleware to authenticate JWT
function authenticateJWT(req, res, next) {
  console.log('🔍 Authenticating JWT token...');
  
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    console.log('❌ No authorization header found');
    return res.status(401).json({ error: 'No token' });
  }
  
  const token = authHeader.split(' ')[1];
  if (!token) {
    console.log('❌ No token found in authorization header');
    return res.status(401).json({ error: 'No token' });
  }
  
  try {
    console.log('🔐 Verifying JWT token...');
    const decoded = jwt.verify(token, jwtSecret);
    console.log(`✅ JWT token valid for user: ${decoded.username} (${decoded.id})`);
    req.user = decoded;
    next();
  } catch (error) {
    console.log('❌ JWT token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// GET /auth/profile
router.get('/profile', authenticateJWT, async (req, res) => {
  console.log(`👤 Fetching profile for user ${req.user.id}...`);
  
  try {
    const user = await prismaClient.user.findUnique({ where: { id: req.user.id } });
    if (!user) {
      console.log(`❌ User ${req.user.id} not found in database`);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`✅ Profile retrieved for user: ${user.username} (${user.id})`);
    res.json({ id: user.id, username: user.username });
  } catch (error) {
    console.log('❌ Error fetching user profile:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

console.log('✅ Auth routes initialized');

module.exports = router; 