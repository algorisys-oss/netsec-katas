import { createBrowserRouter, RouterProvider } from "react-router"

import { RootLayout } from "@/routes/root-layout"
import { HomePage } from "@/routes/home-page"
import { KataPage } from "@/routes/kata-page"
import { SearchPage } from "@/routes/search-page"
import { NotFoundPage } from "@/routes/not-found-page"

// Under GitHub Pages the app lives at /<repo>/; Vite exposes that as BASE_URL.
const baseUrl = import.meta.env.BASE_URL
const basename = baseUrl === "/" ? undefined : baseUrl.replace(/\/$/, "")

const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <RootLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: "search", element: <SearchPage /> },
        { path: "kata/:id", element: <KataPage /> },
        { path: "*", element: <NotFoundPage /> },
      ],
    },
  ],
  { basename },
)

export function App() {
  return <RouterProvider router={router} />
}
