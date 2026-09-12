export async function onRequestPost(context) {
  try {
    if (!context.env.DB) {
      return Response.json(
        {
          error: "Database is not connected."
        },
        {
          status: 500
        }
      );
    }

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const cookies = Object.fromEntries(
      cookieHeader
        .split(";")
        .map(cookie => cookie.trim())
        .filter(Boolean)
        .map(cookie => {
          const equalsIndex = cookie.indexOf("=");

          if (equalsIndex === -1) {
            return [cookie, ""];
          }

          return [
            cookie.slice(0, equalsIndex),
            cookie.slice(equalsIndex + 1)
          ];
        })
    );

    const token =
      cookies.localboost_session || "";

    if (token) {
      await context.env.DB
        .prepare(
          "DELETE FROM sessions WHERE token = ?"
        )
        .bind(token)
        .run();
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Logged out successfully."
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie":
            "localboost_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
        }
      }
    );

  } catch (error) {
    console.log(
      "Logout error:",
      error.message
    );

    return Response.json(
      {
        error: "Something went wrong logging out."
      },
      {
        status: 500
      }
    );
  }
}
