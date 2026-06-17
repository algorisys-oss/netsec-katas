import { useState } from "react"
import { Link, Outlet } from "react-router"
import { Menu, ShieldCheck } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function RootLayout() {
  const [open, setOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Toggle navigation"
          onClick={() => setOpen((o) => !o)}
        >
          <Menu />
        </Button>
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-5 text-emerald-500" />
          <span>NetSec Katas</span>
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl">
        <aside
          className={cn(
            "w-full shrink-0 border-r md:w-72",
            open ? "block" : "hidden md:block",
          )}
        >
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
            <AppSidebar onNavigate={() => setOpen(false)} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-8 md:px-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
