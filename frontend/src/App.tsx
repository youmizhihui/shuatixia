/**
 * App.tsx — 路由与布局壳
 */
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import BankDetail from './pages/BankDetail';
import Practice from './pages/Practice';
import Paper from './pages/Paper';
import Wrong from './pages/Wrong';
import Favorites from './pages/Favorites';
import Stats from './pages/Stats';
import Import from './pages/Import';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/banks/:id" element={<BankDetail />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/paper/new" element={<Paper />} />
        <Route path="/paper/:id" element={<Paper />} />
        <Route path="/wrong" element={<Wrong />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/import" element={<Import />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
