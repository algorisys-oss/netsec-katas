import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"

const KEY = "netsec-katas:theme"

export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  )

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    try {
      localStorage.setItem(KEY, dark ? "dark" : "light")
    } catch {
      // ignore
    }
  }, [dark])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle dark mode"
      onClick={() => setDark((d) => !d)}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}
