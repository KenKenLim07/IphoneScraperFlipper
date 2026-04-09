import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>Not found</CardTitle>
          <CardDescription>The listing you requested does not exist (or was removed).</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/listings">Back to listings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
