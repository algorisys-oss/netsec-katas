import { useEffect, useState } from "react"
import { Link, Outlet, useNavigate } from "react-router"
import { Github, Menu, Search, ShieldCheck, Star } from "lucide-react"

import { AppSidebar } from "@/components/app-sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const REPO_URL = "https://github.com/algorisys-oss/netsec-katas"

export function RootLayout() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  // Press "/" anywhere (outside a field) to jump to search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      const typing =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable
      if (e.key === "/" && !typing) {
        e.preventDefault()
        navigate("/search")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])

  return (
    <div className="flex min-h-screen flex-col bg-background">
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
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            asChild
            className="gap-2 text-muted-foreground"
          >
            <Link to="/search" aria-label="Search katas">
              <Search className="size-4" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">
                /
              </kbd>
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="gap-1.5 text-muted-foreground"
          >
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="Star this project on GitHub"
            >
              <Star className="size-4" />
              <span className="hidden sm:inline">Star</span>
            </a>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1">
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

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          <p>
            © {new Date().getFullYear()} Algorisys Technologies Pvt Ltd. All
            rights reserved.
          </p>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <Github className="size-4" /> Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  )
}
