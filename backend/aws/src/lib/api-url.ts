import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// The "audience" for the DID-Auth flow is the URL that the request actually
// hit. Deriving it from the request rather than baking it into the Lambda's
// env vars avoids a CloudFormation circular dependency between Functions and
// the HttpApi (Function → HttpApi for the URL, HttpApi → Function for the
// auto-generated invoke permissions).
export function audienceFromEvent(event: APIGatewayProxyEventV2): string {
  const ctx = event.requestContext;
  return `https://${ctx.domainName}/${ctx.stage}`;
}
