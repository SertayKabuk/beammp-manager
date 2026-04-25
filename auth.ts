import NextAuth from "next-auth"
import Google from "next-auth/providers/google"

function getAllowedEmails() {
  return new Set(
    (process.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  )
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      const email = (
        user.email ??
        (typeof profile?.email === "string" ? profile.email : "")
      )
        .trim()
        .toLowerCase()

      const allowedEmails = getAllowedEmails()

      if (!email) {
        return false
      }

      if (allowedEmails.size === 0) {
        return false
      }

      return allowedEmails.has(email)
    },
  },
})