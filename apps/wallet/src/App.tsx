import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { SessionProvider } from "./session";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Shell } from "./components/Shell";
import { Welcome } from "./pages/Welcome";
import { Home } from "./pages/Home";
import { CredentialDetail } from "./pages/CredentialDetail";
import { Offer } from "./pages/Offer";
import { Present } from "./pages/Present";
import { Settings } from "./pages/Settings";

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
        </Shell>
      </SessionProvider>
    </BrowserRouter>
  );
}
