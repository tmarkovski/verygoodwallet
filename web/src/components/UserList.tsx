import { removeUser, updateUser, User } from '../services/db/users';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrashCan } from '@fortawesome/free-regular-svg-icons';
import { ReactComponent as WalletIcon } from '../assets/wallet.svg';
import { useUser } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../services/auth';
import { useLayout } from '../contexts/LayoutContext';
import { useLogging } from '../hooks/logging';
import posthog from 'posthog-js';
import { useState, useRef } from 'react';

interface UserListProps {
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  onLogin: (user: User) => void;
}

const UserList: React.FC<UserListProps> = ({ users, setUsers, onLogin }) => {
  const { setCurrentUser } = useUser();
  const navigate = useNavigate();
  const { logError } = useLogging();
  const { setIsBusy, setMessage } = useLayout();
  const { login } = useAuth();
  const [focusedUserId, setFocusedUserId] = useState<number | null>(null);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleRemoveUser = async (userId: number) => {
    setIsBusy(true);
    setTimeout(async () => {
      if (window.confirm('Are you sure you want to remove this user?')) {
        await removeUser(userId);
        setUsers(users.filter(user => user.id !== userId));
      }
      setIsBusy(false);
    }, 100); // 500ms delay
  };

  const handleUserLogin = async (user: User) => {
    setIsBusy(true);
    try {
      const { credential } = await login(user);

      if (credential) {
        // Authentication successful
        const updatedUser = {
          ...user,
          lastSeen: new Date()
        };
        await updateUser(updatedUser);
        onLogin(updatedUser);
      } else {
        console.error('No credential result');
        posthog.capture('login_failed', { method: 'UserList' });
      }
    } catch (error) {
      console.error('Error during user login:', error);
      logError('Error during user login', error as Error, 'UserList');
      posthog.capture('login_failed', { method: 'UserList', error: error });
    } finally {
      setIsBusy(false);
    }
  };

  const handleTouchStart = (userId: number) => {
    setFocusedUserId(userId);
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
    }
  };

  const handleTouchEnd = () => {
    touchTimeoutRef.current = setTimeout(() => {
      setFocusedUserId(null);
    }, 3000); // 3 seconds delay
  };

  const getUserInitials = (name: string) => {
    const names = name.split(' ');
    if (names.length > 1) {
      return `${names[0][0]}${names[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getColorFromName = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = hash % 360;
    return `hsl(${hue}, 70%, 80%)`;
  };

  const formatLastSeen = (lastSeen: Date) => {
    if (!lastSeen) return 'Never';

    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - lastSeen.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;

    return lastSeen.toLocaleDateString();
  };

  return (
    <div className="flex flex-col items-center justify-start md:min-h-screen pt-4 sm:justify-center sm:pt-0">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <WalletIcon className="w-12 h-12 text-white" />
        </div>

        {users.length === 0 ? (
          <div className="text-left">
            <h1 className="text-2xl font-bold text-white mb-2">Hello.</h1>
            <p className="text-gray-300">Create a new account to get started with our amazing features!</p>
            <p className="text-gray-300">Enjoy secure authentication, personalized experiences, and more.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome back!</h1>
            <p className="text-gray-300 mb-4">Tap a user account to login.</p>

            <div className="h-8"></div>

            <div className="flex flex-col gap-4">
              {users.map((user) => (
                <div key={user.id} className="relative group">
                  <button
                    onClick={() => handleUserLogin(user)}
                    onTouchStart={() => handleTouchStart(user.id)}
                    onTouchEnd={handleTouchEnd}
                    // onFocus={() => handleTouchStart(user.id)}
                    // onBlur={handleTouchEnd}
                    className="flex items-center w-full p-4 rounded-full transition-all duration-200 bg-gray-800/50 hover:bg-white/10 backdrop-blur-md"
                  >
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold text-gray-600 mr-4 flex-shrink-0"
                      style={{ backgroundColor: getColorFromName(user.name) }}
                    >
                      {getUserInitials(user.name)}
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-col text-left">
                        <div className="font-semibold text-white truncate">
                          {user.name}
                        </div>
                        <div className="text-sm italic text-gray-400">
                          {focusedUserId === user.id ? "Tap again to login" : formatLastSeen(user.lastSeen)}
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    className="absolute top-1/2 right-4 transform -translate-y-1/2 p-2 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:text-gray-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveUser(user.id);
                    }}
                  >
                    <FontAwesomeIcon icon={faTrashCan} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UserList;