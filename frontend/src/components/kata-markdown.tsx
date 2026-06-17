import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

interface KataMarkdownProps {
  content: string
  className?: string
}

// Renders kata markdown with GitHub-flavored tables and preserves the ASCII
// diagrams in fenced code blocks (monospace, horizontally scrollable).
export function KataMarkdown({ content, className }: KataMarkdownProps) {
  return (
    <div
      className={cn(
        "prose prose-neutral max-w-none dark:prose-invert",
        "prose-headings:scroll-mt-20 prose-headings:font-semibold",
        "prose-h2:mt-10 prose-h2:border-b prose-h2:pb-2",
        "prose-a:text-primary prose-a:underline-offset-4",
        "prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:border prose-pre:border-border prose-pre:bg-muted prose-pre:text-foreground",
        "prose-table:block prose-table:overflow-x-auto prose-table:text-sm",
        "prose-th:text-left",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
