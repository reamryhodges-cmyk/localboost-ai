export async function onRequestPost(context) {
  const token = getCookie(
    context.request.headers.get("Cookie") || "",
    "localboost_session"
  );

  if (token && context.env.DB) {
    try {
      await context.env.DB.prepare(
        "DELETE FROM sessions WHERE token = ?"
      ).bind(token).run();
    } catch (error) {
      console.error("Logout session deletion error:", error);
      return json(
        { success: false, error: "Could not securely log out." },
        500,
        true
      );
    }
  }

  return json(
    { success: true, message: "Logged out successfully." },
    200,
    true
  );
}

function getCookie(header, name) {
  const prefix = `${name}=`;
  const item = String(header || "")
    .split(";")
    .map(value => value.trim())
    .find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : "";
}

function json(data, status, clearCookie) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "no-store",
        "Set-Cookie":
          clearCookie
            ? "localboost_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
            : ""
      }
    }
  );
}
