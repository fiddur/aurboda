import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { render } from 'preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import { Footer } from './components/Footer.jsx'
import { Header } from './components/Header.jsx'
import { AdminSettings } from './pages/AdminSettings/index.jsx'
import { Goals } from './pages/Goals/index.jsx'
import { Home } from './pages/Home/index.jsx'
import { HrZones } from './pages/HrZones/index.jsx'
import { Login } from './pages/Login/index.jsx'
import { Places } from './pages/Places/index.jsx'
import { Settings } from './pages/Settings/index.jsx'
import { Signup } from './pages/Signup/index.jsx'
import { Timeline } from './pages/Timeline/index.jsx'
import { NotFound } from './pages/_404.jsx'
import { queryClient } from './state/queryClient.js'
import './style.css'

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocationProvider>
        <Header />
        <main>
          <Router>
            <Route path="/" component={Home} />
            <Route path="/login" component={Login} />
            <Route path="/signup" component={Signup} />
            <Route path="/goals" component={Goals} />
            <Route path="/hr-zones" component={HrZones} />
            <Route path="/timeline" component={Timeline} />
            <Route path="/places" component={Places} />
            <Route path="/settings" component={Settings} />
            <Route path="/admin" component={AdminSettings} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Footer />
        <ReactQueryDevtools initialIsOpen={false} />
      </LocationProvider>
    </QueryClientProvider>
  )
}

render(<App />, document.getElementById('app'))
