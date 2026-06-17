import { Link } from "react-router"

import { Button } from "@/components/ui/button"

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Kata not found</h1>
      <p className="text-muted-foreground">
        That kata doesn’t exist (yet). Check the sidebar for what’s available.
      </p>
      <Button asChild>
        <Link to="/">Back to home</Link>
      </Button>
    </div>
  )
}
