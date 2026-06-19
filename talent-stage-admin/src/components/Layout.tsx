import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ToastContainer from './Toast';
import ConfirmDialog from './ConfirmDialog';

export default function Layout() {
  return (
    <div className="admin-panel">
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
