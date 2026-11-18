import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import LandingPage from './components/LandingPage';
import DashboardPage from './components/DashboardPage';
import { api } from './api';

export default function App() {
  const [activePage, setActivePage] = useState('landing');
  const [catalog, setCatalog] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [telemetry, setTelemetry] = useState(null);

  useEffect(() => {
    api.getCatalog(setTelemetry).then(setCatalog).catch(console.error);
    api.getSyncStatus().then(setSyncStatus).catch(console.error);
  }, []);

  useEffect(() => {
    if (!syncStatus?.is_syncing) return;
    const timer = setInterval(async () => {
      try {
        const latest = await api.getSyncStatus();
        setSyncStatus(latest);
        if (!latest.is_syncing) {
          const updatedCatalog = await api.getCatalog(setTelemetry);
          setCatalog(updatedCatalog);
        }
      } catch (err) {
        console.error(err);
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [syncStatus?.is_syncing]);

  const handleTriggerSync = useCallback(async () => {
    try {
      const res = await api.triggerSync();
      if (res?.status) setSyncStatus(res.status);
    } catch (err) {
      console.error('Sync trigger failed:', err);
    }
  }, []);

  return (
    <>
      {/* Strictly Farmers on Landing Page, Pure Greenery (Zero Humans) on Dashboard */}
      <div
        className={`page-backdrop ${
          activePage === 'landing' ? 'backdrop-farmers' : 'backdrop-greenery'
        }`}
      />
      <div className="backdrop-overlay-light" />

      <Navbar
        activePage={activePage}
        onNavigate={setActivePage}
        syncStatus={syncStatus}
        onTriggerSync={handleTriggerSync}
        telemetry={telemetry}
      />

      {activePage === 'landing' ? (
        <LandingPage
          onLaunchDashboard={() => setActivePage('dashboard')}
          catalog={catalog}
          syncStatus={syncStatus}
        />
      ) : (
        <DashboardPage
          catalog={catalog}
          onTelemetry={setTelemetry}
          syncCompletedAt={syncStatus?.last_completed_at}
        />
      )}
    </>
  );
}