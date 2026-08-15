// Runtime-neutral HTTP request/response shapes. Structurally identical to
// `APIGatewayProxyEventV2` / `APIGatewayProxyResultV2` in the fields the core
// handlers actually read/write, so a Lambda event satisfies `HttpEvent`
// without a cast and the Node adapter (backend/server) can build one from an
// `IncomingMessage`.

export interface HttpEvent {
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  requestContext: {
    domainName: string;
    stage: string;
    http: {
      method: string;
      path: string;
    };
  };
}

export interface HttpResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}
