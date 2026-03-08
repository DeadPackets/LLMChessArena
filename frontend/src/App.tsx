import { lazy, Suspense } from "react";
import { Routes, Route, useParams } from "react-router-dom";
import Layout from "./components/layout/Layout";

const GameListPage = lazy(() => import("./pages/GameListPage"));
const GameViewerPage = lazy(() => import("./pages/GameViewerPage"));
const GameEmbedPage = lazy(() => import("./pages/GameEmbedPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const ModelDetailPage = lazy(() => import("./pages/ModelDetailPage"));
const CostDashboardPage = lazy(() => import("./pages/CostDashboardPage"));
const HeadToHeadPage = lazy(() => import("./pages/HeadToHeadPage"));
const OpeningExplorerPage = lazy(() => import("./pages/OpeningExplorerPage"));

/** Forces full remount of GameViewerPage when gameId changes (e.g. rematch) */
function GameViewerPageKeyed() {
  const { gameId } = useParams<{ gameId: string }>();
  return <GameViewerPage key={gameId} />;
}

function RouteFallback() {
  return (
    <div className="spinner-page">
      <div className="spinner-lg" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Embed route — no Layout wrapper (no header/nav) */}
        <Route path="/embed/:gameId" element={<GameEmbedPage />} />

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
    </Suspense>
  );
}
