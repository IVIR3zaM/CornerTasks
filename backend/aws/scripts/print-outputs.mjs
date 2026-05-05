#!/usr/bin/env node
// Print the deployed stack's ApiUrl and WebUrl. Invoked at the end of the
// deploy:dev / deploy:prod scripts so users see what to paste into the app.

import { execFileSync } from 'node:child_process';

const stage = process.env.STAGE ?? 'dev';
const stack = `cornertasks-${stage}`;
const region = process.env.AWS_REGION;
if (!region) {
  console.error('AWS_REGION is required.');
  process.exit(2);
}

const raw = execFileSync(
  'aws',
  ['cloudformation', 'describe-stacks', '--stack-name', stack, '--region', region, '--output', 'json'],
  { encoding: 'utf8' }
);
const outputs = Object.fromEntries(
  (JSON.parse(raw).Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue])
);

console.log('');
console.log(`Stack:   ${stack}`);
console.log(`ApiUrl:  ${outputs.ApiUrl ?? '(missing)'}`);
console.log(`WebUrl:  ${outputs.WebUrl ?? '(missing)'}`);
console.log('');
console.log('Paste ApiUrl into the app: Settings → Cloud Sync → paste ApiUrl → Enable.');
