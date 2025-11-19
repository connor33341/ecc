import { ChatRoom } from './chatroom';
import { AuthManager } from './auth';
import type { Env } from './types';

export { ChatRoom };

const authManager = new AuthManager();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Handle CORS preflight requests
 */
function handleOptions(request: Request): Response {
  return new Response(null, {
    headers: corsHeaders,
  });
}

/**
 * Main worker handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Initialize AuthManager with KV
    authManager.setKV(env.SESSIONS);
    
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // API Routes
    if (url.pathname.startsWith('/api/')) {
      return handleAPIRequest(request, env, url);
    }

    // WebSocket route - forward to Durable Object
    if (url.pathname === '/ws') {
      return handleWebSocketRequest(request, env, url);
    }

    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders 
    });
  },
};

/**
 * Handle API requests
 */
async function handleAPIRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  // Clean up expired challenges and sessions periodically
  if (Math.random() < 0.01) {
    authManager.cleanup();
  }

  // Get challenge endpoint
  if (url.pathname === '/api/auth/challenge' && request.method === 'GET') {
    const sessionId = crypto.randomUUID();
    const challenge = authManager.generateChallenge();
    authManager.storeChallenge(sessionId, challenge);

    return new Response(
      JSON.stringify({ sessionId, challenge }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  // Verify proof endpoint
  if (url.pathname === '/api/auth/verify' && request.method === 'POST') {
    try {
      const { sessionId, proof, address, expiresAt } = await request.json() as {
        sessionId: string;
        proof: string;
        address: string;
        expiresAt?: number | null;
      };

      const result = await authManager.verifyProof(sessionId, proof, address, expiresAt);

      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            address: result.address,
            sessionId,
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      } else {
        return new Response(
          JSON.stringify({ success: false, error: result.error }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Session validation endpoint
  if (url.pathname === '/api/auth/session' && request.method === 'GET') {
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      return new Response(
        JSON.stringify({ valid: false, error: 'Missing sessionId' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const session = await authManager.getSession(sessionId);

    if (session) {
      return new Response(
        JSON.stringify({
          valid: true,
          address: session.address,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      return new Response(
        JSON.stringify({ valid: false, error: 'Session not found or expired' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Logout endpoint
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    try {
      const { sessionId } = await request.json() as { sessionId: string };
      await authManager.removeSession(sessionId);

      return new Response(
        JSON.stringify({ success: true }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } catch (error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  }

  return new Response('Not Found', {
    status: 404,
    headers: corsHeaders,
  });
}

/**
 * Handle WebSocket requests
 */
async function handleWebSocketRequest(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  console.log('[WS] WebSocket upgrade request received');
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    console.log('[WS] Missing sessionId');
    return new Response('Missing sessionId', { 
      status: 400,
      headers: corsHeaders 
    });
  }

  console.log('[WS] Verifying session:', sessionId);
  // Verify session
  const session = await authManager.getSession(sessionId);

  if (!session) {
    console.log('[WS] Invalid or expired session');
    return new Response('Invalid or expired session', { 
      status: 401,
      headers: corsHeaders 
    });
  }

  console.log('[WS] Session valid for address:', session.address);

  // Get Durable Object instance
  console.log('[WS] Getting Durable Object instance');
  const id = env.CHAT_ROOM.idFromName('global-chat');
  const stub = env.CHAT_ROOM.get(id);

  // Forward request to Durable Object with address and expiresAt
  // Modify URL to include session address and expiry
  const newUrl = new URL(request.url);
  newUrl.searchParams.set('address', session.address);
  if (session.expiresAt) {
    newUrl.searchParams.set('expiresAt', session.expiresAt.toString());
  }

  console.log('[WS] Forwarding to Durable Object, URL:', newUrl.toString());
  // For WebSocket upgrades, we need to pass the original request
  // but with the modified URL
  const newRequest = new Request(newUrl.toString(), request);

  console.log('[WS] Request upgrade header:', request.headers.get('Upgrade'));
  const response = await stub.fetch(newRequest);
  console.log('[WS] Durable Object response status:', response.status);
  return response;
}
