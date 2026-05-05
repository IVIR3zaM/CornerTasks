#!/usr/bin/env node
// Sync apps/web/dist/ into the stack's S3 bucket and invalidate CloudFront.
// Reads the bucket name and distribution ID from the deployed stack outputs
// so we never hard-code stack-owned identifiers.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(here, '../../../apps/web/dist');
const stage = process.env.STAGE ?? 'prod';
const stack = `cornertasks-${stage}`;
const region = process.env.AWS_REGION;
if (!region) {
  console.error('AWS_REGION is required.');
  process.exit(2);
}
if (!existsSync(distDir)) {
  console.error(`No web build at ${distDir}. Run \`cd apps/web && npm run build\` first.`);
  process.exit(2);
}

function awsJson(args) {
  const raw = execFileSync('aws', [...args, '--region', region, '--output', 'json'], { encoding: 'utf8' });
  return JSON.parse(raw);
}

const outputs = Object.fromEntries(
  (awsJson(['cloudformation', 'describe-stacks', '--stack-name', stack]).Stacks?.[0]?.Outputs ?? [])
    .map((o) => [o.OutputKey, o.OutputValue])
);

const bucket = outputs.WebBucketName;
const distribution = outputs.WebDistributionId;
if (!bucket || !distribution) {
  console.error(`Stack ${stack} is missing WebBucketName / WebDistributionId outputs.`);
  process.exit(2);
}

console.log(`Syncing ${distDir} → s3://${bucket} ...`);
execFileSync('aws', ['s3', 'sync', distDir, `s3://${bucket}`, '--delete', '--region', region], {
  stdio: 'inherit'
});

console.log(`Invalidating CloudFront distribution ${distribution} ...`);
execFileSync(
  'aws',
  ['cloudfront', 'create-invalidation', '--distribution-id', distribution, '--paths', '/*', '--region', region],
  { stdio: 'inherit' }
);

console.log('Done.');
