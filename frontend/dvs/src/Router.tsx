import { lazy, Suspense } from "react"
import App from "./App"
const StaffApp = lazy(() => import("./staff/StaffApp"))
export default function Router() {
  const route = window.location.pathname.replace(/\/+$/, "").split("/").pop()
  if (route === "admin" || route === "results")
    return (
      <Suspense
        fallback={
          <div
            className="app"
            style={{ display: "grid", placeItems: "center" }}
            role="status"
          >
            جارٍ التحميل…
          </div>
        }
      >
        <StaffApp view={route} />
      </Suspense>
    )
  return <App />
}
