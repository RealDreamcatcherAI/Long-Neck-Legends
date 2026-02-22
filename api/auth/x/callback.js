// api/auth/x/callback.js
// Vercel Serverless Function (Node)
// Handles X OAuth callback, exchanges code for token, fetches user, postsMessage to opener, closes popup.

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

function clearCookie(res, name) {
  const parts = [
    `${name}=`,
    "Max-Age=0",
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
    "Secure",
  ];
  const prev = res.getHeader("Set-Cookie");
  const next = Array.isArray(prev) ? prev.concat([parts.join("; ")]) : prev ? [prev, parts.join("; ")] : [parts.join("; ")];
  res.setHeader("Set-Cookie", next);
}

function htmlResponse(ok, payload, message) {
  const safeMsg = (message || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dataJson = payload ? JSON.stringify(payload).replace(/</g, "\\u003c") : "{}";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${ok ? "Connected" : "Error"}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0b0b18;color:#eaeafd;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
    .card{max-width:520px;width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:18px}
    .title{font-weight:800;letter-spacing:0.6px;margin:0 0 8px}
    .muted{opacity:0.75;margin:0 0 14px;line-height:1.4}
    code{background:rgba(0,0,0,0.35);padding:2px 6px;border-radius:8px}
  </style>
</head>
<body>
  <div class="card">
    <h3 class="title">${ok ? "X Connected ✅" : "X Connect Failed ❌"}</h3>
    <p class="muted">${safeMsg || (ok ? "You can close this window." : "Please try again.")}</p>
    <p class="muted" style="font-size:12px">This window will auto-close.</p>
  </div>

  <script>
    (function(){
      try {
        var payload = ${dataJson};
        if (window.opener && payload && payload.type) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch(e) {}
      setTimeout(function(){ window.close(); }, 350);
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const APP_ORIGIN = process.env.APP_ORIGIN; // https://longnecklegends.xyz
    const X_CLIENT_ID = process.env.X_CLIENT_ID;
    const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET; // required for confidential clients
    const X_REDIRECT_URI = process.env.X_REDIRECT_URI;

    if (!APP_ORIGIN || !X_CLIENT_ID || !X_CLIENT_SECRET || !X_REDIRECT_URI) {
      res.status(500).send("Missing env vars: APP_ORIGIN, X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI");
      return;
    }

    const { code, state, error, error_description } = req.query || {};

    const cookies = parseCookies(req);
    const expectedState = cookies.x_oauth_state;
    const codeVerifier = cookies.x_oauth_verifier;

    // Clear cookies no matter what
    clearCookie(res, "x_oauth_state");
    clearCookie(res, "x_oauth_verifier");
    clearCookie(res, "x_oauth_wallet");

    if (error) {
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, `${error}: ${error_description || ""}`)
      );
      return;
    }

    if (!code || !state) {
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, "Missing code/state from X.")
      );
      return;
    }

    if (!expectedState || state !== expectedState) {
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, "State mismatch. Please try again.")
      );
      return;
    }

    if (!codeVerifier) {
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, "Missing PKCE verifier cookie. Please try again.")
      );
      return;
    }

    // Exchange code -> token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: code.toString(),
      redirect_uri: X_REDIRECT_URI,
      client_id: X_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const basic = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64");
    const tokenResp = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basic}`,
      },
      body: tokenBody.toString(),
    });

    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson.access_token) {
      console.error("X token exchange failed:", tokenResp.status, tokenJson);
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, "Token exchange failed. Check your X app settings + redirect URI.")
      );
      return;
    }

    // Fetch user
    const meResp = await fetch("https://api.twitter.com/2/users/me?user.fields=profile_image_url,name,username", {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });

    const meJson = await meResp.json();
    if (!meResp.ok || !meJson.data) {
      console.error("X /users/me failed:", meResp.status, meJson);
      res.status(200).setHeader("Content-Type", "text/html").send(
        htmlResponse(false, { type: "x_error" }, "Could not fetch X profile.")
      );
      return;
    }

    const user = meJson.data;

    // Post message back to opener (your dashboard)
    const payload = {
      type: "x_connected",
      id: user.id,
      username: user.username,
      name: user.name,
      profile_image_url: user.profile_image_url,
    };

    res.status(200).setHeader("Content-Type", "text/html").send(
      htmlResponse(true, payload, `Connected as @${user.username}`)
    );
  } catch (e) {
    console.error("X callback error:", e);
    res.status(200).setHeader("Content-Type", "text/html").send(
      htmlResponse(false, { type: "x_error" }, "Unexpected error during X callback.")
    );
  }
}