import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { JwtAlg } from '../../../core/src/lib/jwt';

export interface SigningKey {
  alg: JwtAlg;
  kid: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

let cached: SigningKey | null = null;

export function setSigningKey(k: SigningKey | null): void {
  cached = k;
}

export async function getSigningKey(): Promise<SigningKey> {
  if (cached) return cached;
  const alg = (process.env.JWT_ALG as JwtAlg) ?? 'EdDSA';
  const stage = process.env.STAGE ?? 'dev';
  const kid = `ct-server-${stage}`;

  if (alg === 'HS256') {
    const secretParam = process.env.JWT_SECRET_SSM_PARAM ?? `/cornertasks/${stage}/jwt-hs256-secret`;
    const secret = await readSsmString(secretParam, true);
    const bytes = Buffer.from(secret, 'utf8');
    cached = { alg, kid, privateKey: bytes, publicKey: bytes };
    return cached;
  }

  const privParam = process.env.JWT_PRIVATE_SSM_PARAM ?? `/cornertasks/${stage}/jwt-signing-key`;
  const pubParam = process.env.JWT_PUBLIC_SSM_PARAM ?? `/cornertasks/${stage}/jwt-signing-key-public`;
  const priv = await readSsmString(privParam, true);
  const pub = await readSsmString(pubParam, false);
  cached = {
    alg,
    kid,
    privateKey: Buffer.from(priv, 'base64'),
    publicKey: Buffer.from(pub, 'base64')
  };
  return cached;
}

async function readSsmString(name: string, withDecryption: boolean): Promise<string> {
  const ssm = new SSMClient({});
  const out = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: withDecryption }));
  if (!out.Parameter?.Value) throw new Error(`SSM parameter ${name} missing`);
  return out.Parameter.Value;
}
