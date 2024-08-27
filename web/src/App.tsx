import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import "./App.css";
import Layout from "./Layout";
import LoginLayout from "./components/Login";
import Profile from "./pages/Profile";
import { UserProvider } from "./contexts/UserContext";
import ProtectedRoute from "./components/ProtectedRoute";
import CreateCredential from "./pages/CreateCredential";
import CredentialList from "./pages/CredentialList";
import CredentialDetails from "./pages/CredentialDetails";
import { LayoutProvider } from "./contexts/LayoutContext";
import ReactGA from "react-ga4";
import { useLocation } from "react-router-dom";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY || "phc_mu5U3NhGcuMjewXyK18bJ6hdSAuZFCMut218KXzSIyz", {
  api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
  person_profiles: "identified_only", // or 'always' to create profiles for anonymous users as well
  loaded: (posthog) => {
    if (process.env.NODE_ENV === "development") posthog.debug(); // debug mode in development
  },
});

// Initialize GA4 with your measurement ID
ReactGA.initialize("G-WB5E65BC3Q"); // Replace with your actual Google Analytics measurement ID

function App() {
  const location = useLocation();

  useEffect(() => {
    ReactGA.send({ hitType: "pageview", page: location.pathname });
  }, [location]);

  return (
    <PostHogProvider client={posthog}>
      <UserProvider>
        <LayoutProvider>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route element={<ProtectedRoute />}>
                <Route index element={<CredentialList />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/credentials/new" element={<CreateCredential />} />
                <Route path="/credentials" element={<CredentialList />} />
                <Route path="/credentials/:id" element={<CredentialDetails />} />
              </Route>
            </Route>
            <Route path="login" element={<LoginLayout />} />
          </Routes>
        </LayoutProvider>
      </UserProvider>
    </PostHogProvider>
  );
}

export default App;
