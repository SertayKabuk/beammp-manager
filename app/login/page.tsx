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

export default async function LoginPage() {
  const session = await auth()

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
          </form>
        </CardContent>
      </Card>
    </main>
  )
}