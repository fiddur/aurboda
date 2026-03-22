import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { render } from 'preact'
import { LocationProvider, Route, Router } from 'preact-iso'

import { Footer } from './components/Footer.jsx'
import { Header } from './components/Header.jsx'
import { NotFound } from './pages/_404.jsx'
import { AddData } from './pages/AddData/index.jsx'
import { AdminSettings } from './pages/AdminSettings/index.jsx'
import { Correlations } from './pages/Correlations/index.jsx'
import { Data } from './pages/Data/index.jsx'
import { ActivityWatchAndroidSource } from './pages/DataSources/ActivityWatchAndroidSource.jsx'
import { ActivityWatchDesktopSource } from './pages/DataSources/ActivityWatchDesktopSource.jsx'
import { AndroidAppSource } from './pages/DataSources/AndroidAppSource.jsx'
import { AurbodaSource } from './pages/DataSources/AurbodaSource.jsx'
import { CalendarsSource } from './pages/DataSources/CalendarsSource.jsx'
import { GarminSource } from './pages/DataSources/GarminSource.jsx'
import { DataSources } from './pages/DataSources/index.jsx'
import { LastFmSource } from './pages/DataSources/LastFmSource.jsx'
import { OuraSource } from './pages/DataSources/OuraSource.jsx'
import { OwnTracksSource } from './pages/DataSources/OwnTracksSource.jsx'
import { RescueTimeSource } from './pages/DataSources/RescueTimeSource.jsx'
import { EntityDetail } from './pages/EntityDetail/index.jsx'
import { ExerciseMeta } from './pages/ExerciseMeta/index.jsx'
import { Goals } from './pages/Goals/index.jsx'
import { Home } from './pages/Home/index.jsx'
import { HrZones } from './pages/HrZones/index.jsx'
import { Login } from './pages/Login/index.jsx'
import { MetricMeta } from './pages/MetricMeta/index.jsx'
import { Places } from './pages/Places/index.jsx'
import { AddReport } from './pages/Reports/AddReport.jsx'
import { Reports } from './pages/Reports/index.jsx'
import { ReportDetail } from './pages/Reports/ReportDetail.jsx'
import { CategoryDetail } from './pages/ScreentimeCategories/CategoryDetail.jsx'
import { ScreentimeCategories } from './pages/ScreentimeCategories/index.jsx'
import { Settings } from './pages/Settings/index.jsx'
import { Signup } from './pages/Signup/index.jsx'
import { Sleep } from './pages/Sleep/index.jsx'
import { TagMeta } from './pages/TagMeta/index.jsx'
import { Timeline } from './pages/Timeline/index.jsx'
import { Trends } from './pages/Trends/index.jsx'
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
            <Route path="/data" component={Data} />
            <Route path="/add" component={AddData} />
            <Route path="/reports/add" component={AddReport} />
            <Route path="/reports/:id" component={ReportDetail} />
            <Route path="/reports" component={Reports} />
            <Route path="/detail/:type/:id" component={EntityDetail} />
            <Route path="/tag/:tagKey" component={TagMeta} />
            <Route path="/exercise/:type" component={ExerciseMeta} />
            <Route path="/metric/:metricName" component={MetricMeta} />
            <Route path="/sleep" component={Sleep} />
            <Route path="/correlations" component={Correlations} />
            <Route path="/trends" component={Trends} />
            <Route path="/places" component={Places} />
            <Route path="/data-sources" component={DataSources} />
            <Route path="/data-sources/aurboda" component={AurbodaSource} />
            <Route path="/data-sources/android-app" component={AndroidAppSource} />
            <Route path="/data-sources/oura" component={OuraSource} />
            <Route path="/data-sources/garmin" component={GarminSource} />
            <Route path="/data-sources/activitywatch-desktop" component={ActivityWatchDesktopSource} />
            <Route path="/data-sources/activitywatch-android" component={ActivityWatchAndroidSource} />
            <Route path="/data-sources/rescue-time" component={RescueTimeSource} />
            <Route path="/data-sources/lastfm" component={LastFmSource} />
            <Route path="/data-sources/owntracks" component={OwnTracksSource} />
            <Route path="/data-sources/calendars" component={CalendarsSource} />
            <Route path="/screentime-categories/:id" component={CategoryDetail} />
            <Route path="/screentime-categories" component={ScreentimeCategories} />
            <Route path="/settings" component={Settings} />
            <Route path="/admin" component={AdminSettings} />
            <Route path="/help" component={DataSources} />
            <Route default component={NotFound} />
          </Router>
        </main>
        <Footer />
        <ReactQueryDevtools initialIsOpen={false} />
      </LocationProvider>
    </QueryClientProvider>
  )
}

render(<App />, document.getElementById('app')!)
