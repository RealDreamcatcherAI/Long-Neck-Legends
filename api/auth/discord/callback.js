export default async function handler(req, res) {
  const code       = String(req.query.code  || "");
  const stateRaw   = String(req.query.state || "");
  const errorParam = String(req.query.error || "");

  const appOrigin     = process.env.APP_ORIGIN || "https://longnecklegends.xyz";
  const defaultReturn = process.env.DASHBOARD_URL || (appOrigin + "/dashboard.html");

  // ── User denied or Discord error ────────────────────────────────────────────
  if (errorParam) {
    return redirectOrClose(res, defaultReturn, appOrigin, { error: true });
  }

  if (!code || !stateRaw) {
    return res.status(400).send("Missing code or state.");
  }

  // ── Decode state — contains wallet, nonce, and returnUrl ────────────────────
  let wallet    = "";
  let returnUrl = "";
  try {
    const decoded = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
    wallet    = String(decoded.wallet    || "");
    returnUrl = String(decoded.returnUrl || "");
  } catch (e) {
    return res.status(400).send("Invalid state. Please try connecting again.");
  }

  if (!wallet) {
    return res.status(400).send("Wallet missing from state. Please try connecting again.");
  }

  // Use returnUrl from state if valid, otherwise fall back to default
  // Only allow returns to our own origin for security
  let dashboardBase = defaultReturn;
  if (returnUrl && returnUrl.startsWith(appOrigin)) {
    dashboardBase = returnUrl;
  }

  // ── 1. Exchange code for access token ───────────────────────────────────────
  const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type:    "authorization_code",
      code,
      redirect_uri:  process.env.DISCORD_REDIRECT_URI
    })
  });

  const tokenJson = await tokenResp.json();
  if (!tokenJson.access_token) {
    console.error("[Discord callback] Token exchange failed:", tokenJson);
    return redirectOrClose(res, dashboardBase, appOrigin, { error: true });
  }

  // ── 2. Fetch Discord user ────────────────────────────────────────────────────
  const meResp = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const me = await meResp.json();

  if (!me || !me.id) {
    console.error("[Discord callback] Failed to fetch Discord user");
    return redirectOrClose(res, dashboardBase, appOrigin, { error: true });
  }

  // ── 3. Build display tag ─────────────────────────────────────────────────────
  const discordTag =
    (me.global_name && String(me.global_name).trim())
      ? String(me.global_name).trim()
      : (me.username && me.discriminator && me.discriminator !== "0")
        ? `${me.username}#${me.discriminator}`
        : (me.username || "");

  const discordId = String(me.id);

  // ── 4. Save to Supabase server-side ─────────────────────────────────────────
  // Writing here means the Discord ID is saved regardless of what happens
  // to the browser tab after the redirect
  if (process.env.LNL_SUPA_URL && process.env.LNL_SUPA_KEY) {
    try {
      const supaUrl = process.env.LNL_SUPA_URL;
      const supaKey = process.env.LNL_SUPA_KEY;

      const linkRes = await fetch(
        `${supaUrl}/rest/v1/wallet_links?wallet=eq.${encodeURIComponent(wallet)}&select=profile_id&limit=1`,
        { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } }
      );
      const links = await linkRes.json();

      if (Array.isArray(links) && links.length > 0) {
        const profileId = links[0].profile_id;
        const patchRes = await fetch(
          `${supaUrl}/rest/v1/profiles?id=eq.${profileId}`,
          {
            method: "PATCH",
            headers: {
              apikey:         supaKey,
              Authorization:  `Bearer ${supaKey}`,
              "Content-Type": "application/json",
              Prefer:         "return=minimal"
            },
            body: JSON.stringify({
              discord_id:       discordId,
              discord_username: discordTag
            })
          }
        );
        if (patchRes.ok) {
          console.log(`[Discord callback] Saved ${discordTag} (${discordId}) → profile ${profileId}`);
        } else {
          console.warn("[Discord callback] Supabase PATCH failed:", await patchRes.text());
        }
      } else {
        console.warn(`[Discord callback] No wallet_links entry for ${wallet.slice(0, 6)}...`);
      }
    } catch (e) {
      console.error("[Discord callback] Supabase error:", e.message || e);
    }
  }

  // ── 5. Respond ───────────────────────────────────────────────────────────────
  return redirectOrClose(res, dashboardBase, appOrigin, {
    error:       false,
    id:          discordId,
    username:    me.username     || "",
    global_name: me.global_name  || "",
    discord_tag: discordTag,
    wallet
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart responder — postMessage on desktop popup, redirect on mobile/tab
// ─────────────────────────────────────────────────────────────────────────────
function redirectOrClose(res, dashboardBase, origin, data) {
  res.setHeader("Content-Type", "text/html");

  if (data.error) {
    res.end(`<!DOCTYPE html><html><head><title>Discord Auth Failed</title></head><body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "discord_error" }, ${JSON.stringify(origin)});
    window.close();
  } else {
    window.location.replace(${JSON.stringify(dashboardBase + "?discord_error=1")});
  }
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:4rem;">Something went wrong. Redirecting…</p>
</body></html>`);
    return;
  }

  const returnParams = new URLSearchParams({
    discord_connected: "1",
    discord_user:      data.discord_tag || data.username || "",
    discord_id:        data.id          || ""
  });
  const redirectUrl = `${dashboardBase}?${returnParams.toString()}`;

  const payload = {
    type:        "discord_connected",
    id:          data.id          || "",
    discord_id:  data.id          || "",
    username:    data.username    || "",
    global_name: data.global_name || "",
    discord_tag: data.discord_tag || "",
    wallet:      data.wallet      || ""
  };

  res.end(`<!DOCTYPE html><html><head><title>Connecting Discord…</title></head><body>
<script>
(function(){
  var payload  = ${JSON.stringify(payload)};
  var target   = ${JSON.stringify(origin)};
  var fallback = ${JSON.stringify(redirectUrl)};
  if (window.opener) {
    try { window.opener.postMessage(payload, target); } catch(e) {}
    window.close();
  } else {
    window.location.replace(fallback);
  }
})();
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:4rem;">Discord connected — redirecting…</p>
</body></html>`);
}
