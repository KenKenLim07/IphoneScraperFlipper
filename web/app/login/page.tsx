import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default async function Login({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = (Array.isArray(sp.next) ? sp.next[0] : sp.next) || "/listings";
  const hasError = (Array.isArray(sp.error) ? sp.error[0] : sp.error) === "1";

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>
            Details and the seller link are gated. Ask the owner for the shared password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/api/auth/login" className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="password">
                Shared password
              </label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
              {hasError ? (
                <p className="mt-2 text-sm text-red-500">Incorrect password. Try again.</p>
              ) : null}
            </div>
            <Button type="submit" className="w-full">
              Continue
            </Button>
            <div className="text-center text-xs text-muted-foreground">
              <Link className="underline underline-offset-4 hover:text-foreground" href="/listings">
                Back to listings
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
