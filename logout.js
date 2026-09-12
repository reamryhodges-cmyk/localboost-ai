export async function onRequestPost(context) {
  try {
    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    let token = "";

    for (const part of cookieHeader.split(";")) {
      const cookie = part.trim();

      if (
        cookie.startsWith(
          "localboost_session="
        )
      ) {
        token =
          cookie.substring(
            "localboost_session=".length
          );

        break;
      }
    }

    if (context.env.DB && token) {
      try {
        await context.env.DB
          .prepare(
            "DELETE FROM sessions WHERE token = ?"
          )
          .bind(token)
          .run();
      } catch (databaseError) {
        console.log(
          "Logout database error:",
          databaseError.message
        );
      }
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

    return new Response(
      JSON.stringify({
        success: false,
        error: "Logout failed.",
        details: error.message
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
