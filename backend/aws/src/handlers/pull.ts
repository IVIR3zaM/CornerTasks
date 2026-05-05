import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { json } from '../lib/response';
import type { SkeletonResponse } from '../types/api';

export async function handler(_event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body: SkeletonResponse = { ok: true, todo: 'iteration 5', route: 'pull' };
  return json(200, body);
}
