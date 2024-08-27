import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useUser } from '../contexts/UserContext';

const redirectPath = '/login';

const ProtectedRoute = () => {
  const { currentUser, isLoading } = useUser();
  const location = useLocation();

  if (isLoading) {
    return <></>;
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
};

export default ProtectedRoute;