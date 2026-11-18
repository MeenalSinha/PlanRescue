import { NextResponse, type NextRequest } from 'next/server';

/**
 * Global API Middleware for Cross-Origin WebXR Clients
 *
 * Allows the hosted PlanRescue Spatial WebXR application (e.g. on GitHub Pages)
 * to communicate seamlessly with the production PlanRescue API.
 */
export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '*';

  // Handle preflight OPTIONS requests immediately
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'true',
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  return response;
}

export { proxy as middleware };

export const config = {
  matcher: '/api/:path*',
};
