export default async function handler(req, res) {
  const code      = String(req.query.code  || "");
  const stateRaw  = String(req.query.state || "");
  const errorParam = String(req.query.error || "");

  const dashboardBase = process.env.DASHBOARD_URL || "https://longnecklegends.xyz/dashboard.html";
  const origin        = process.env.APP_ORIGIN    || "https://longnecklegends.xyz";

  // ── User denied or Discord error ───────────────────────────────────────────
  if (errorParam) {
    return redirectOrClose(res, dashboardBase, origin, { error: true });
  }

  if (!code || !stateRaw) {
    return res.status(400).send("Missing code or state.");
  }

  // ── Decode wallet from state ───────────────────────────────────────────────
  // start.js encodes { wallet, nonce } as base64url in the state param.
  // This replaces the cookie approach which breaks on mobile (SameSite=Lax).
  let wallet = "";
  try {
    const decoded = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
    wallet = String(decoded.wallet || "");
  } catch (e) {
    return res.status(400).send("Invalid state param. Please try connecting again.");
  }

  if (!wallet) {
    return res.status(400).send("Wallet missing from state. Please try connecting again.");
  }

  // ── 1. Exchange code for access token ─────────────────────────────────────
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
    return redirectOrClose(res, dashboardBase, origin, { error: true });
  }

  // ── 2. Fetch Discord user ──────────────────────────────────────────────────
  const meResp = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const me = await meResp.json();

  if (!me || !me.id) {
    console.error("[Discord callback] Failed to fetch Discord user");
    return redirectOrClose(res, dashboardBase, origin, { error: true });
  }

  // ── 3. Build display tag ───────────────────────────────────────────────────
  const discordTag =
    (me.global_name && String(me.global_name).trim())
      ? String(me.global_name).trim()
      : (me.username && me.discriminator && me.discriminator !== "0")
        ? `${me.username}#${me.discriminator}`
        : (me.username || "");

  const discordId = String(me.id);

  // ── 4. Save to Supabase server-side ───────────────────────────────────────
  // Writing here means mobile users never lose their Discord link even if
  // the redirect loses URL params or the dashboard tab was refreshed.
  if (process.env.LNL_SUPA_URL && process.env.LNL_SUPA_KEY) {
    try {
      const supaUrl = process.env.LNL_SUPA_URL;
      const supaKey = process.env.LNL_SUPA_KEY;

      // Find profile_id from wallet_links
      const linkRes = await fetch(
        `${supaUrl}/rest/v1/wallet_links?wallet=eq.${encodeURIComponent(wallet)}&select=profile_id&limit=1`,
        {
          headers: {
            apikey:        supaKey,
            Authorization: `Bearer ${supaKey}`
          }
        }
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
          const errText = await patchRes.text();
          console.warn("[Discord callback] Supabase PATCH failed:", errText);
        }
      } else {
        // Wallet not in wallet_links yet — user hasn't connected wallet on dashboard.
        // Discord info will still be passed via redirect params so dashboard can save it.
        console.warn(`[Discord callback] No wallet_links entry for ${wallet.slice(0, 6)}...`);
      }
    } catch (e) {
      // Non-fatal — still redirect with params so dashboard can save on its end
      console.error("[Discord callback] Supabase error:", e.message || e);
    }
  } else {
    console.warn("[Discord callback] LNL_SUPA_URL or LNL_SUPA_KEY not set — skipping Supabase save");
  }

  // ── 5. Respond: redirect on mobile, postMessage on desktop ────────────────
  return redirectOrClose(res, dashboardBase, origin, {
    error:    false,
    id:       discordId,
    username: me.username      || "",
    global_name: me.global_name || "",
    discord_tag: discordTag,
    wallet
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// redirectOrClose
// On desktop: the OAuth opened in a popup — postMessage back and close.
// On mobile:  no opener — redirect to dashboard with params in the URL.
// We can't detect desktop vs mobile server-side, so we return a smart HTML page
// that tries postMessage first, and falls back to redirect if opener is null.
// ─────────────────────────────────────────────────────────────────────────────
function redirectOrClose(res, dashboardBase, origin, data) {
  res.setHeader("Content-Type", "text/html");

  if (data.error) {
    // Error case — redirect always (safe on both desktop and mobile)
    res.end(`<!DOCTYPE html>
<html>
<head><title>Discord Auth Failed</title></head>
<body>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: "discord_error" }, ${JSON.stringify(origin)});
    window.close();
  } else {
    window.location.href = ${JSON.stringify(dashboardBase + "?discord_error=1")};
  }
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:4rem;">
  Something went wrong. Redirecting…
</p>
</body>
</html>`);
    return;
  }

  // Build redirect URL for mobile fallback
  const returnParams = new URLSearchParams({
    discord_connected: "1",
    discord_user:      data.discord_tag || data.username || "",
    discord_id:        data.id          || ""
  });
  const redirectUrl = `${dashboardBase}?${returnParams.toString()}`;

  // Payload for desktop postMessage
  const payload = {
    type:          "discord_connected",
    id:            data.id          || "",
    discord_id:    data.id          || "",
    username:      data.username    || "",
    global_name:   data.global_name || "",
    discord_tag:   data.discord_tag || "",
    wallet:        data.wallet      || ""
  };

  res.end(`<!DOCTYPE html>
<html>
<head><title>Connecting Discord…</title></head>
<body>
<script>
(function () {
  var payload  = ${JSON.stringify(payload)};
  var target   = ${JSON.stringify(origin)};
  var fallback = ${JSON.stringify(redirectUrl)};

  if (window.opener) {
    // Desktop popup flow — postMessage back to parent and close
    try {
      window.opener.postMessage(payload, target);
    } catch(e) {}
    window.close();
  } else {
    // Mobile / redirect flow — go back to dashboard with params in URL
    window.location.replace(fallback);
  }
})();
</script>
<p style="font-family:sans-serif;color:#888;text-align:center;margin-top:4rem;">
  Discord connected — redirecting…
</p>
</body>
</html>`);
}
