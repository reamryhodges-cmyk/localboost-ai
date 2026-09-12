export async function onRequestGet(context) {
  try {
    if (!context.env.DB) {
      return Response.json(
        {
          loggedIn: false,
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

    if (!token) {
      return Response.json({
        loggedIn: false
      });
    }

    const session = await context.env.DB
      .prepare(`
        SELECT
          sessions.id AS session_id,
          sessions.expires_at,
          users.id,
          users.email,
          users.business_name,
          users.plan,
          users.generations_used
        FROM sessions
        JOIN users
          ON users.id = sessions.user_id
        WHERE sessions.token = ?
      `)
      .bind(token)
      .first();

    if (!session) {
      return Response.json({
        loggedIn: false
      });
    }

    const expiry =
      new Date(session.expires_at).getTime();

    if (
      Number.isNaN(expiry) ||
      expiry <= Date.now()
    ) {
      await context.env.DB
        .prepare(
          "DELETE FROM sessions WHERE token = ?"
        )
        .bind(token)
        .run();

      return new Response(
        JSON.stringify({
          loggedIn: false
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
    }

    return Response.json({
      loggedIn: true,
      user: {
        id: session.id,
        email: session.email,
        businessName: session.business_name,
        plan: session.plan,
        generationsUsed: session.generations_used
      }
    });

  } catch (error) {
    console.log(
      "Session check error:",
      error.message
    );

    return Response.json(
      {
        loggedIn: false,
        error: "Could not check login session."
      },
      {
        status: 500
      }
    );
  }
}
