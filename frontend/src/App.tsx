import { Routes, Route, useParams } from "react-router-dom";
import Layout from "./components/layout/Layout";
import GameListPage from "./pages/GameListPage";
import GameViewerPage from "./pages/GameViewerPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import ModelDetailPage from "./pages/ModelDetailPage";
import CostDashboardPage from "./pages/CostDashboardPage";
import HeadToHeadPage from "./pages/HeadToHeadPage";
import OpeningExplorerPage from "./pages/OpeningExplorerPage";

/** Forces full remount of GameViewerPage when gameId changes (e.g. rematch) */
function GameViewerPageKeyed() {
  const { gameId } = useParams<{ gameId: string }>();
  return <GameViewerPage key={gameId} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<GameListPage />} />
        <Route path="/game/:gameId" element={<GameViewerPageKeyed />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/costs" element={<CostDashboardPage />} />
        <Route path="/head-to-head" element={<HeadToHeadPage />} />
        <Route path="/openings" element={<OpeningExplorerPage />} />
        <Route path="/model/*" element={<ModelDetailPage />} />
      </Route>
    </Routes>
  );
}
