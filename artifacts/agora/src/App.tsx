import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Communities from "@/pages/communities";
import CommunityDetail from "@/pages/community-detail";
import PostDetail from "@/pages/post-detail";
import Submit from "@/pages/submit";
import Profile from "@/pages/profile";
import Settings from "@/pages/settings";
import Login from "@/pages/login";
import Messages from "@/pages/messages";
import SearchPage from "@/pages/search";
import Privacy from "@/pages/privacy";
import Inbox from "@/pages/inbox";
import Nearby from "@/pages/nearby";
import Bookmarks from "@/pages/bookmarks";
import AdminPanel from "@/pages/admin";
import ModerationPanel from "@/pages/moderation";
import { Layout } from "@/components/layout";
import { PanicWipeHandler } from "@/components/panic-wipe";
import { SwUpdatePrompt } from "@/components/sw-update-prompt";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/communities" component={Communities} />
        <Route path="/community/:identifier" component={CommunityDetail} />
        <Route path="/post/:eventId" component={PostDetail} />
        <Route path="/submit" component={Submit} />
        <Route path="/profile/:npub" component={Profile} />
        <Route path="/messages/:npub" component={Messages} />
        <Route path="/messages" component={Messages} />
        <Route path="/settings" component={Settings} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/inbox" component={Inbox} />
        <Route path="/nearby" component={Nearby} />
        <Route path="/bookmarks" component={Bookmarks} />
        <Route path="/admin" component={AdminPanel} />
        <Route path="/moderation" component={ModerationPanel} />
        <Route path="/search" component={SearchPage} />
        <Route path="/login" component={Login} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter hook={useHashLocation}>
          <PanicWipeHandler />
          <SwUpdatePrompt />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
