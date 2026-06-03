import { Outlet } from "react-router-dom";
import Header from "./Header";
import { LiveAnnouncer } from "../shared/LiveAnnouncer";

export default function Layout() {
  return (
    <LiveAnnouncer>
      <Header />
      <main className="app-content">
        <Outlet />
      </main>
    </LiveAnnouncer>
  );
}
