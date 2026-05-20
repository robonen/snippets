const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const uid = '<API_KEY_UID>';
const privateKeyBase64 = '<PRIVATE_KEY_BASE64>';

const privateKeyPem = Buffer.from(privateKeyBase64, 'base64').toString('utf8');

const jwtToken = jwt.sign(
  {
    exp: Math.floor(Date.now() / 1000) + 60
  },
  privateKeyPem,
  { algorithm: 'RS256' }
);

console.log(jwtToken);