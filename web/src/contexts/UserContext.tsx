import React, { createContext, useState, useContext, useEffect } from 'react';
import { User, getUser } from '../services/db/users';
import Cookies from 'js-cookie';
import { useNavigate } from 'react-router-dom';

interface UserContextType {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  login: (user: User) => void;
  logout: () => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const checkLoginCookie = async () => {
      const userId = Cookies.get('currentUserId');
      if (userId) {
        const user = await getUser(parseInt(userId, 10));
        setCurrentUser(user || null);
      }
      setIsLoading(false);
    };

    checkLoginCookie();
  }, []);

  const login = (user: User) => {
    setCurrentUser(user);
    Cookies.set('currentUserId', user.id.toString(), { expires: 7 });
    navigate('/profile');
  };

  const logout = () => {
    setCurrentUser(null);
    Cookies.remove('currentUserId');
    navigate('/login');
  };

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser, login, logout, isLoading }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};