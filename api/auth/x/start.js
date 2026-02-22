// api/auth/x/start.js
// Vercel Serverless Function (Node)
// Starts X (Twitter) OAuth 2.0 w/ PKCE and redirects to X authorization screen.

import crypto from "crypto";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function sha256Base64Url(str) {
  const hash = crypto.createHash("sha256").update(str).digest();
  return base64url(hash);
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  header.split(";").forEach((p) => {
    const idx = p.indexOf("=");
    if (idx === -1) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (!k) return;
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const {
    maxAge = 600,
    path = "/",
    httpOnly = true,
    secure = true,
    sameSite = "Lax",
  } = opts;

  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAge}`,
    `Path=${path}`,
    `SameSite=${sameSite}`,
  ];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");

  const prev = res.getHeader("Set-Cookie");
  const next = Array.isArray(prev) ? prev.concat([parts.join("; ")]) : prev ? [prev, parts.join("; ")] : [parts.join("; ")];
  res.setHeader("Set-Cookie", next);
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const APP_ORIGIN = process.env.APP_ORIGIN; // e.g. https://longnecklegends.xyz
    const X_CLIENT_ID = process.env.X_CLIENT_ID;
    const X_REDIRECT_URI = process.env.X_REDIRECT_URI; // e.g. https://longnecklegends.xyz/api/auth/x/callback

    if (!APP_ORIGIN || !X_CLIENT_ID || !X_REDIRECT_URI) {
      res.status(500).send("Missing env vars: APP_ORIGIN, X_CLIENT_ID, X_REDIRECT_URI");
      return;
    }

    const wallet = (req.query.wallet || "").toString().trim();
    if (!wallet) {
      res.status(400).send("Missing wallet");
      return;
    }

    // PKCE
    const codeVerifier = randomString(48);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const state = randomString(24);

    // Store PKCE verifier + state in short-lived HttpOnly cookies (same site)
    setCookie(res, "x_oauth_state", state, { maxAge: 600 });
    setCookie(res, "x_oauth_verifier", codeVerifier, { maxAge: 600 });
    setCookie(res, "x_oauth_wallet", wallet, { maxAge: 600 });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: X_CLIENT_ID,
      redirect_uri: X_REDIRECT_URI,
      scope: "users.read tweet.read offline.access",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (e) {
    console.error("X start error:", e);
    res.status(500).send("X start error");
  }
}