/**
 * ============================================================================
 * CLOUDFLARE PAGES FUNCTION: MICRO-PUENTE WEB PUSH VAPID (functions/push.js)
 * Llaves VAPID pre-incrustadas listas para producción (Zero-Config en Cloudflare)
 * Powered by DPixART Arte y Diseño
 * ============================================================================
 */

const DEFAULT_VAPID_PUBLIC = "BEDHGO3GNIc-2jExDZhCuj6_KShteOFgQlWi3pwceDsmiO8nLN9kLJRK6vbFgozmZ36zWiH5UrOG5oB_aawY9Pg";
const DEFAULT_VAPID_PRIVATE_JWK = {
  "kty": "EC",
  "crv": "P-256",
  "x": "QMcY7cY0hz7aMTENmEK6Pr8pKG144WBCVaLenBx4OyY",
  "y": "iO8nLN9kLJRK6vbFgozmZ36zWiH5UrOG5oB_aawY9Pg",
  "d": "rKdK57AhQp6myeUCrOwHQAl995Xb32U576_R6SLfVQY",
  "ext": true,
  "key_ops": ["sign"]
};

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      status: 'online',
      service: 'DPixART Multi-Caregiver Web Push Bridge',
      vapid_public_key: DEFAULT_VAPID_PUBLIC
    }, null, 2),
    { headers: { 'Content-Type': 'application/json;charset=utf-8' } }
  );
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const subscription = body.subscription;

    if (!subscription || !subscription.endpoint) {
      return new Response(JSON.stringify({ status: 'error', message: 'Suscripción inválida' }), { status: 400 });
    }

    const vapidPublicKey = (context.env && context.env.VAPID_PUBLIC_KEY) ? context.env.VAPID_PUBLIC_KEY : DEFAULT_VAPID_PUBLIC;
    const vapidPrivateJwk = (context.env && context.env.VAPID_PRIVATE_JWK)
      ? JSON.parse(context.env.VAPID_PRIVATE_JWK)
      : DEFAULT_VAPID_PRIVATE_JWK;
    const vapidSubject = (context.env && context.env.VAPID_SUBJECT) ? context.env.VAPID_SUBJECT : 'mailto:ventas@dpixart.com';

    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
    const exp = Math.floor(Date.now() / 1000) + (12 * 3600);

    const jwtHeader = objectToBase64Url({ typ: 'JWT', alg: 'ES256' });
    const jwtPayload = objectToBase64Url({ aud: audience, exp: exp, sub: vapidSubject });
    const unsignedToken = `${jwtHeader}.${jwtPayload}`;

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      vapidPrivateJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      privateKey,
      new TextEncoder().encode(unsignedToken)
    );

    const jwt = `${unsignedToken}.${arrayBufferToBase64Url(signatureBuffer)}`;

    const pushResponse = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'TTL': '3600',
        'Urgency': 'high',
        'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
        'Content-Length': '0'
      }
    });

    return new Response(
      JSON.stringify({
        status: pushResponse.ok ? 'success' : 'push_rejected',
        http_code: pushResponse.status
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ status: 'error', message: err.toString() }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function objectToBase64Url(obj) {
  const str = JSON.stringify(obj);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}