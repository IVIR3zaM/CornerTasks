#!/usr/bin/env node
// One-shot bootstrapper. Generates a per-deploy signing key and writes it
// to SSM Parameter Store. Re-run after `JwtAlg` flips between EdDSA / HS256.

import { SSMClient, PutParameterCommand } from '@aws-sdk/client-ssm';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const stage = process.env.STAGE ?? 'dev';
const alg = process.env.JWT_ALG ?? 'EdDSA';
const region = process.env.AWS_REGION ?? 'us-east-1';
const ssm = new SSMClient({ region });

async function put(name, value, type) {
  await ssm.send(
    new PutParameterCommand({
      Name: name,
      Value: value,
      Type: type,
      Overwrite: true
    })
  );
  console.log(`wrote ${name}`);
}

if (alg === 'HS256') {
  const secret = randomBytes(32).toString('base64url');
  await put(`/cornertasks/${stage}/jwt-hs256-secret`, secret, 'SecureString');
} else {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pub = publicKey.export({ type: 'spki', format: 'der' });
  await put(`/cornertasks/${stage}/jwt-signing-key`, priv.subarray(priv.length - 32).toString('base64'), 'SecureString');
  await put(`/cornertasks/${stage}/jwt-signing-key-public`, pub.subarray(pub.length - 32).toString('base64'), 'String');
}
console.log('done');
