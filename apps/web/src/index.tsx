import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { render } from 'preact'
import { LocationProvider, Route, Router } from 'preact-iso'
import { Header } from './components/Header.jsx'
import { Home } from './pages/Home/index.jsx'
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
            <Route path="/timeline" component={Timeline} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <ReactQueryDevtools initialIsOpen={false} />
      </LocationProvider>
    </QueryClientProvider>
  )
}

render(<App />, document.getElementById('app'))
