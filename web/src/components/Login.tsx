import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import UserList from './UserList';
import { useUser } from '../contexts/UserContext';
import Cookies from 'js-cookie';
import { getUsers, User } from "../services/db/users";
import CreateUser from './CreateUser';

const LoginLayout: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const { setCurrentUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [isCreateUserFocused, setIsCreateUserFocused] = useState(false);

  useEffect(() => {
    const fetchUsers = async () => {
      const fetchedUsers = await getUsers();
      setUsers(fetchedUsers);
    };
    fetchUsers();
  }, []);

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    Cookies.set('currentUserId', user.id.toString(), { expires: 7 }); // Convert user.id to string
    const origin = (location.state as any)?.from?.pathname || '/';
    navigate(origin);
  };

  return (
    <div className="gradient-bg min-h-screen">
      <div className="gradients-container">
        <div className="g1"></div>
        <div className="g2"></div>
        <div className="g3"></div>
        <div className="g4"></div>
        <div className="g5"></div>
        <div className="interactive"></div>
      </div>
      <div className="relative z-10 flex flex-col md:flex-row">
        {/* User List - Left on desktop, top on mobile */}
        <div className="md:w-1/2 text-white p-8 md:p-0"> {/* Added padding here */}
          <div className="w-full">
            <UserList users={users} setUsers={setUsers} onLogin={handleLogin} />
          </div>
        </div>

        {/* Create User - Right on desktop, bottom on mobile */}
        <div className="w-full md:w-2/3 flex items-center justify-center md:p-4 mt-12">
          <div className={`w-full mt-12 md:p-12 md:mt-0 md:max-w-xl space-y-8 backdrop-blur-md p-8 md:rounded-3xl shadow-lg transition-colors duration-200 ${
            isCreateUserFocused ? 'bg-white/10' : 'bg-gray-800/50'
          }`}>
            <CreateUser onFocusChange={setIsCreateUserFocused} onCreateUser={handleLogin} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginLayout;
