require('dotenv').config();
const { connectDB, mongoose } = require('../src/config/db');
const User = require('../src/models/user.model');
const authService = require('../src/services/auth.service');
const { OAuth2Client } = require('google-auth-library');

async function testGoogleAuthSeparation() {
    console.log('--- STARTING GOOGLE AUTH INTENT SEPARATION TEST ---');
    await connectDB();

    const testEmail = `test_google_${Date.now()}@example.com`;
    const testGoogleSub = `sub_${Date.now()}`;

    // Mock verifyIdToken on OAuth2Client prototype for deterministic testing
    const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
    OAuth2Client.prototype.verifyIdToken = async function() {
        return {
            getPayload: () => ({
                email: testEmail,
                email_verified: true,
                sub: testGoogleSub
            })
        };
    };

    try {
        // Ensure test user does not exist in DB
        await User.deleteOne({ email: testEmail });

        // 1. TEST SIGNIN WITH NON-EXISTENT USER
        console.log('\n[Test 1] Attempting Sign In with non-existent Google user...');
        try {
            await authService.loginWithGoogle('mock-id-token', 'signin');
            console.error('FAIL: Expected signin to fail for non-existent user, but it succeeded!');
            process.exit(1);
        } catch (err) {
            if (err.code === 'GOOGLE_SIGNIN_NO_ACCOUNT' && err.message.includes('User does not exist, sign up first')) {
                console.log('PASS [Test 1]: Correctly blocked sign-in and threw GOOGLE_SIGNIN_NO_ACCOUNT:', err.message);
            } else {
                console.error('FAIL: Unexpected error received:', err);
                process.exit(1);
            }
        }

        // Verify that no user was created in the database during signin
        const checkUser1 = await User.findOne({ email: testEmail });
        if (!checkUser1) {
            console.log('PASS [Test 1]: Confirmed no new user was created in database.');
        } else {
            console.error('FAIL: User was unexpectedly created in database during signin!');
            process.exit(1);
        }

        // 2. TEST SIGNUP WITH NEW USER
        console.log('\n[Test 2] Attempting Sign Up with new Google user...');
        const signupResult = await authService.loginWithGoogle('mock-id-token', 'signup');
        if (signupResult && signupResult.user && signupResult.user.email === testEmail && signupResult.token) {
            console.log(`PASS [Test 2]: Successfully registered new user: ${signupResult.user.username} (${signupResult.user.email})`);
        } else {
            console.error('FAIL [Test 2]: Signup failed to return expected user or token:', signupResult);
            process.exit(1);
        }

        // 3. TEST SIGNIN WITH NOW-EXISTING USER
        console.log('\n[Test 3] Attempting Sign In with now-existing Google user...');
        const signinResult = await authService.loginWithGoogle('mock-id-token', 'signin');
        if (signinResult && signinResult.user && signinResult.user.email === testEmail && signinResult.token) {
            console.log(`PASS [Test 3]: Successfully logged in existing user: ${signinResult.user.username}`);
        } else {
            console.error('FAIL [Test 3]: Signin failed for existing user:', signinResult);
            process.exit(1);
        }

        // 4. CLEANUP TEST DATA
        await User.deleteOne({ email: testEmail });
        console.log('\nCleaned up test user successfully.');
        console.log('\n--- ALL GOOGLE AUTH TESTS PASSED PERFECTLY! ---');

    } finally {
        OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
        await mongoose.connection.close();
    }
}

testGoogleAuthSeparation().catch((err) => {
    console.error('Test execution error:', err);
    process.exit(1);
});
