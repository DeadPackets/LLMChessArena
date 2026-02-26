import { Routes, Route } from "react-router-dom";
import Layout from "./components/layout/Layout";
import GameListPage from "./pages/GameListPage";
import GameViewerPage from "./pages/GameViewerPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ModelDetailPage from "./pages/ModelDetailPage";
import CostDashboardPage from "./pages/CostDashboardPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<GameListPage />} />
        <Route path="/game/:gameId" element={<GameViewerPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/costs" element={<CostDashboardPage />} />
        <Route path="/model/*" element={<ModelDetailPage />} />
      </Route>
    </Routes>
  );
}
