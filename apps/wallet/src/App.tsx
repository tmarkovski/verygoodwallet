import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { SessionProvider } from "./session";
import { Shell } from "./components/Shell";
import { Welcome } from "./pages/Welcome";
import { Home } from "./pages/Home";
import { CredentialDetail } from "./pages/CredentialDetail";
import { Offer } from "./pages/Offer";
import { Settings } from "./pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Shell>
          <Routes>
            <Route path="/welcome" element={<Welcome />} />
            <Route path="/" element={<Home />} />
            <Route path="/credentials/:id" element={<CredentialDetail />} />
            <Route path="/offer" element={<Offer />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      </SessionProvider>
    </BrowserRouter>
  );
}
