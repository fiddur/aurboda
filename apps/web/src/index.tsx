import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { render } from 'preact'
import { LocationProvider, Route, Router, useLocation } from 'preact-iso'

import { Footer } from './components/Footer.jsx'
import { Header } from './components/Header.jsx'
import { Sidebar } from './components/Sidebar.jsx'
import { isEmbedded } from './embed.js'
import { lazyPage } from './lazyPage.js'
import { NotFound } from './pages/_404.jsx'
import { shouldShowNav } from './shell.js'
import { auth } from './state/auth.js'
import { queryClient } from './state/queryClient.js'
import './style.css'

const ActivityTypeMeta = lazyPage(() => import('./pages/ActivityTypeMeta/index.jsx'), 'ActivityTypeMeta')
const ActivityTypes = lazyPage(() => import('./pages/ActivityTypes/index.jsx'), 'ActivityTypes')
const AddData = lazyPage(() => import('./pages/AddData/index.jsx'), 'AddData')
const AdminSettings = lazyPage(() => import('./pages/AdminSettings/index.jsx'), 'AdminSettings')
const AuditLog = lazyPage(() => import('./pages/AuditLog/index.jsx'), 'AuditLog')
const Challenges = lazyPage(() => import('./pages/Challenges/index.jsx'), 'Challenges')
const ChallengeJoin = lazyPage(() => import('./pages/Challenges/Join.jsx'), 'ChallengeJoin')
const Chart = lazyPage(() => import('./pages/Chart/index.jsx'), 'Chart')
const Correlations = lazyPage(() => import('./pages/Correlations/index.jsx'), 'Correlations')
const Data = lazyPage(() => import('./pages/Data/index.jsx'), 'Data')
const ActivityWatchAndroidSource = lazyPage(
  () => import('./pages/DataSources/ActivityWatchAndroidSource.jsx'),
  'ActivityWatchAndroidSource',
)
const ActivityWatchDesktopSource = lazyPage(
  () => import('./pages/DataSources/ActivityWatchDesktopSource.jsx'),
  'ActivityWatchDesktopSource',
)
const AndroidAppSource = lazyPage(
  () => import('./pages/DataSources/AndroidAppSource.jsx'),
  'AndroidAppSource',
)
const AurbodaSource = lazyPage(() => import('./pages/DataSources/AurbodaSource.jsx'), 'AurbodaSource')
const CalendarsSource = lazyPage(() => import('./pages/DataSources/CalendarsSource.jsx'), 'CalendarsSource')
const GarminSource = lazyPage(() => import('./pages/DataSources/GarminSource.jsx'), 'GarminSource')
const GravlSource = lazyPage(() => import('./pages/DataSources/GravlSource.jsx'), 'GravlSource')
const DataSources = lazyPage(() => import('./pages/DataSources/index.jsx'), 'DataSources')
const LastFmSource = lazyPage(() => import('./pages/DataSources/LastFmSource.jsx'), 'LastFmSource')
const OuraSource = lazyPage(() => import('./pages/DataSources/OuraSource.jsx'), 'OuraSource')
const OwnTracksSource = lazyPage(() => import('./pages/DataSources/OwnTracksSource.jsx'), 'OwnTracksSource')
const RescueTimeSource = lazyPage(
  () => import('./pages/DataSources/RescueTimeSource.jsx'),
  'RescueTimeSource',
)
const StravaSource = lazyPage(() => import('./pages/DataSources/StravaSource.jsx'), 'StravaSource')
const DeductionRules = lazyPage(() => import('./pages/DeductionRules/index.jsx'), 'DeductionRules')
const DeductionRuleDetail = lazyPage(
  () => import('./pages/DeductionRules/RuleDetail.jsx'),
  'DeductionRuleDetail',
)
const EntityDetail = lazyPage(() => import('./pages/EntityDetail/index.jsx'), 'EntityDetail')
const Feed = lazyPage(() => import('./pages/Feed/index.jsx'), 'Feed')
const FoodItemDetail = lazyPage(() => import('./pages/FoodItems/FoodItemDetail.jsx'), 'FoodItemDetail')
const FoodItems = lazyPage(() => import('./pages/FoodItems/index.jsx'), 'FoodItems')
const Goals = lazyPage(() => import('./pages/Goals/index.jsx'), 'Goals')
const Home = lazyPage(() => import('./pages/Home/index.jsx'), 'Home')
const Login = lazyPage(() => import('./pages/Login/index.jsx'), 'Login')
const Meals = lazyPage(() => import('./pages/Meals/index.jsx'), 'Meals')
const MealDetail = lazyPage(() => import('./pages/Meals/MealDetail.jsx'), 'MealDetail')
const MealTypeMeta = lazyPage(() => import('./pages/MealTypeMeta/index.jsx'), 'MealTypeMeta')
const MetricMeta = lazyPage(() => import('./pages/MetricMeta/index.jsx'), 'MetricMeta')
const Places = lazyPage(() => import('./pages/Places/index.jsx'), 'Places')
const Privacy = lazyPage(() => import('./pages/Privacy/index.jsx'), 'Privacy')
const PublicResource = lazyPage(() => import('./pages/PublicDashboard/index.jsx'), 'PublicResource')
const PublicProfile = lazyPage(() => import('./pages/PublicProfile/index.jsx'), 'PublicProfile')
const AddReport = lazyPage(() => import('./pages/Reports/AddReport.jsx'), 'AddReport')
const Reports = lazyPage(() => import('./pages/Reports/index.jsx'), 'Reports')
const ReportDetail = lazyPage(() => import('./pages/Reports/ReportDetail.jsx'), 'ReportDetail')
const CategoryDetail = lazyPage(
  () => import('./pages/ScreentimeCategories/CategoryDetail.jsx'),
  'CategoryDetail',
)
const ScreentimeCategories = lazyPage(
  () => import('./pages/ScreentimeCategories/index.jsx'),
  'ScreentimeCategories',
)
const Settings = lazyPage(() => import('./pages/Settings/index.jsx'), 'Settings')
const SharedDashboards = lazyPage(() => import('./pages/SharedDashboards/index.jsx'), 'SharedDashboards')
const Signup = lazyPage(() => import('./pages/Signup/index.jsx'), 'Signup')
const Sleep = lazyPage(() => import('./pages/Sleep/index.jsx'), 'Sleep')
const Terms = lazyPage(() => import('./pages/Terms/index.jsx'), 'Terms')
const Timeline = lazyPage(() => import('./pages/Timeline/index.jsx'), 'Timeline')

function AppShell() {
  const { path } = useLocation()
  // Embedded in the native app's WebView: the app supplies navigation, so hide
  // all web chrome (header, sidebar, footer) and just render page content.
  const embedded = isEmbedded()
  const showNav = !embedded && shouldShowNav(path, Boolean(auth.value.token))

  return (
    <>
      {showNav && <Header />}
      {showNav && <Sidebar />}
      <div class="app-content">
        <main>
          <Router>
            <Route path="/u/:username/:slug" component={PublicResource} />
            <Route path="/u/:username" component={PublicProfile} />
            <Route path="/shared-dashboards" component={SharedDashboards} />
            <Route path="/challenges/join" component={ChallengeJoin} />
            <Route path="/challenges" component={Challenges} />
            <Route path="/" component={Home} />
            <Route path="/login" component={Login} />
            <Route path="/signup" component={Signup} />
            <Route path="/privacy" component={Privacy} />
            <Route path="/terms" component={Terms} />
            <Route path="/goals" component={Goals} />
            <Route path="/timeline" component={Timeline} />
            <Route path="/data" component={Data} />
            <Route path="/add" component={AddData} />
            <Route path="/food-items/:id" component={FoodItemDetail} />
            <Route path="/food-items" component={FoodItems} />
            <Route path="/meals/:id" component={MealDetail} />
            <Route path="/meals" component={Meals} />
            <Route path="/meal-type/:name" component={MealTypeMeta} />
            <Route path="/reports/add" component={AddReport} />
            <Route path="/reports/:id" component={ReportDetail} />
            <Route path="/reports" component={Reports} />
            <Route path="/detail/:type/:id" component={EntityDetail} />
            <Route path="/feed" component={Feed} />
            <Route path="/activity-type/:name" component={ActivityTypeMeta} />
            <Route path="/metric/:metricName" component={MetricMeta} />
            <Route path="/sleep" component={Sleep} />
            <Route path="/correlations" component={Correlations} />
            <Route path="/chart" component={Chart} />
            <Route path="/places" component={Places} />
            <Route path="/data-sources" component={DataSources} />
            <Route path="/data-sources/aurboda" component={AurbodaSource} />
            <Route path="/data-sources/android-app" component={AndroidAppSource} />
            <Route path="/data-sources/oura" component={OuraSource} />
            <Route path="/data-sources/garmin" component={GarminSource} />
            <Route path="/data-sources/strava" component={StravaSource} />
            <Route path="/data-sources/gravl" component={GravlSource} />
            <Route path="/data-sources/activitywatch-desktop" component={ActivityWatchDesktopSource} />
            <Route path="/data-sources/activitywatch-android" component={ActivityWatchAndroidSource} />
            <Route path="/data-sources/rescue-time" component={RescueTimeSource} />
            <Route path="/data-sources/lastfm" component={LastFmSource} />
            <Route path="/data-sources/owntracks" component={OwnTracksSource} />
            <Route path="/data-sources/calendars" component={CalendarsSource} />
            <Route path="/activity-types" component={ActivityTypes} />
            <Route path="/deduction-rules/:id" component={DeductionRuleDetail} />
            <Route path="/deduction-rules" component={DeductionRules} />
            <Route path="/screentime-categories/:id" component={CategoryDetail} />
            <Route path="/screentime-categories" component={ScreentimeCategories} />
            <Route path="/settings" component={Settings} />
            <Route path="/audit-log" component={AuditLog} />
            <Route path="/admin" component={AdminSettings} />
            <Route path="/help" component={DataSources} />
            <Route default component={NotFound} />
          </Router>
        </main>
        {!embedded && <Footer />}
      </div>
    </>
  )
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocationProvider>
        <AppShell />
        <ReactQueryDevtools initialIsOpen={false} />
      </LocationProvider>
    </QueryClientProvider>
  )
}

render(<App />, document.getElementById('app')!)
