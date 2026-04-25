import { ShieldCheck } from "lucide-react"
import { redirect } from "next/navigation"

import { auth, signIn } from "@/auth"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function getErrorMessage(error: string | undefined) {
  switch (error) {
    case "not-allowed":
      return "This Google account is not in ALLOWED_EMAILS for the manager container."
    case "missing-allowlist":
      return "ALLOWED_EMAILS is empty or missing inside the manager container. Add it to the container environment and try again."
    case "missing-email":
      return "Google did not return an email address for this account."
    case "AccessDenied":
      return "Access was denied by the sign-in rules. In this app that usually means ALLOWED_EMAILS is missing or your email is not listed."
    default:
      return null
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth()
  const params = await searchParams
  const errorMessage = getErrorMessage(params.error)

  if (session) {
    redirect("/")
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-6" />
          </div>
          <div className="space-y-1">
            <CardTitle>BeamMP Manager</CardTitle>
            <CardDescription>
              Sign in with an approved Google account to manage maps and mounted
              BeamMP mods.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form
            action={async () => {
              "use server"
              await signIn("google", { redirectTo: "/" })
            }}
            className="space-y-4"
          >
            <Button type="submit" className="w-full" size="lg">
              Continue with Google
            </Button>

            <p className="text-sm text-muted-foreground">
              Access is restricted to emails listed in <code>ALLOWED_EMAILS</code>.
            </p>

            {errorMessage ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}