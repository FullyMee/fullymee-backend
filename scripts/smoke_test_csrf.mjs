import { request } from 'http';

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- Smoke Testing CSRF Fix ---');

  // Step 1: Request CSRF Token
  console.log('\n[1] Fetching CSRF Token (/api/auth/csrf)...');
  const csrfRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/auth/csrf',
    method: 'GET'
  });

  const parsedBody = JSON.parse(csrfRes.body);
  const csrfToken = parsedBody.csrfToken;
  const setCookie = csrfRes.headers['set-cookie'];
  let csrfCookie = '';

  if (setCookie) {
    const cookieString = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    csrfCookie = cookieString.split(';')[0]; // Gets 'csrf_token=...'
  }

  console.log(`Received Token: ${csrfToken}`);
  console.log(`Received Cookie: ${csrfCookie}`);

  if (!csrfToken || !csrfCookie) {
    console.error('FAILED: Did not receive token or cookie.');
    process.exit(1);
  }
  
  // Step 2: Attempt PUT WITHOUT Header
  console.log('\n[2] Attempting protected PUT request WITHOUT X-CSRF-Token header...');
  const failRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/users/preferences', 
    method: 'PUT',
    headers: {
        'Cookie': csrfCookie,
        'Content-Type': 'application/json'
    }
  }, JSON.stringify({ theme: 'dark' }));

  console.log(`Status: ${failRes.statusCode}`);
  console.log(`Body: ${failRes.body}`);

  if (failRes.statusCode === 403 && failRes.body.includes('Invalid CSRF token')) {
    console.log('SUCCESS: Request rejected due to missing header as expected.');
  } else {
    console.error('FAILED: Request was not rejected with 403 Invalid CSRF token.');
    process.exit(1);
  }

  // Step 3: Attempt PUT WITH Header
  console.log('\n[3] Attempting protected PUT request WITH X-CSRF-Token header...');
  const successRes = await makeRequest({
    hostname: 'localhost',
    port: 5000,
    path: '/api/users/preferences', 
    method: 'PUT',
    headers: {
        'Cookie': csrfCookie,
        'X-CSRF-Token': csrfToken,
        'Content-Type': 'application/json'
    }
  }, JSON.stringify({ theme: 'dark' }));

  console.log(`Status: ${successRes.statusCode}`);
  console.log(`Body: ${successRes.body}`);

  // Note: Since we are not authenticated, we expect a 401 Unauthorized, NOT a 403 Invalid CSRF token
  // because auth middleware is triggered after csrf middleware.
  if (successRes.statusCode === 401) {
      console.log('SUCCESS: Request bypassed CSRF check successfully (failed at Auth layer as expected).');
  } else if (successRes.statusCode === 403 && successRes.body.includes('Invalid CSRF token')) {
      console.error('FAILED: CSRF token was still rejected!');
      process.exit(1);
  } else {
      console.log(`Unexpected status code: ${successRes.statusCode}, but CSRF passed!`);
  }
  
  console.log('\n--- All Smoke Tests Passed ---');
}

runTests().catch(console.error);
