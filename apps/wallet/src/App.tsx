import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { TourOverlay, adoptTourFromUrl, advanceTourFrom, useTourStop } from "@vgw/tour";
import { SessionProvider, useSession } from "./session";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import { TOUR_ORIGINS } from "./services/demoSites";
import { Welcome } from "./pages/Welcome";
import { Home } from "./pages/Home";
import { CredentialDetail } from "./pages/CredentialDetail";
import { Offer } from "./pages/Offer";
import { Present } from "./pages/Present";
import { Settings } from "./pages/Settings";

/**
 * The guided tour on the wallet. Cross-origin arrivals carry ?tour=; internal
 * navigations drop query params, so the adopted sessionStorage state is what
 * persists. Two stops complete on wallet-side events rather than links —
 * "create" on reaching the unlocked home, "offer" on the accepted
 * credential's detail page — and an active tour warms the prover's WASM so
 * tier 2 doesn't pay the cold start mid-ceremony.
 */
function TourController() {
  const location = useLocation();
  const { locked } = useSession();
  const stop = useTourStop();
  const active = stop !== null;

  useEffect(() => {
    adoptTourFromUrl(location.search);
  }, [location]);

  useEffect(() => {
    if (stop === null) return;
    if (stop.id === "create" && !locked && location.pathname === "/") {
      advanceTourFrom("create");
    }
    if (stop.id === "offer" && location.pathname.startsWith("/credentials/")) {
      advanceTourFrom("offer");
    }
  }, [stop, locked, location]);

  useEffect(() => {
    if (!active) return;
    import("@vgw/zk/prove")
      .then((zk) => void zk.warmAgeProver())
      .catch(() => {});
  }, [active]);

  return <TourOverlay origins={TOUR_ORIGINS} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell>
          {/* Issuer-controlled JSON reaches render; a hostile value must not
              blank the whole wallet (declarative Routes has no built-in boundary). */}
          <ErrorBoundary>
            <Routes>
              <Route path="/welcome" element={<Welcome />} />
              <Route path="/" element={<Home />} />
              <Route path="/credentials/:id" element={<CredentialDetail />} />
              <Route path="/offer" element={<Offer />} />
              <Route path="/present" element={<Present />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
          <TourController />
        </Shell>
      </SessionProvider>
    </BrowserRouter>
  );
}
